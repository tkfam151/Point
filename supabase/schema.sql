-- ============================================================================
-- Star Points — database setup for Supabase
-- Paste this whole file into Supabase > SQL Editor and press "Run".
-- It is safe to run again later (it will not delete your data).
-- ============================================================================

-- ---------- Tables ----------------------------------------------------------

create table if not exists public.students (
  id         bigint generated always as identity primary key,
  name       text not null,
  stars      integer not null default 0 check (stars >= 0),
  created_at timestamptz not null default now()
);
create unique index if not exists students_name_key on public.students (lower(name));

create table if not exists public.codes (
  id         bigint generated always as identity primary key,
  code       text not null unique,
  max_uses   integer not null check (max_uses > 0),
  uses       integer not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.code_claims (
  id         bigint generated always as identity primary key,
  code_id    bigint not null references public.codes (id) on delete cascade,
  student_id bigint not null references public.students (id) on delete cascade,
  stars      integer not null check (stars > 0),
  created_at timestamptz not null default now(),
  unique (code_id, student_id)
);

create table if not exists public.rewards (
  id         bigint generated always as identity primary key,
  name       text not null,
  cost       integer not null check (cost > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.redemptions (
  id          bigint generated always as identity primary key,
  student_id  bigint not null references public.students (id) on delete cascade,
  reward_id   bigint references public.rewards (id) on delete set null,
  reward_name text not null,
  cost        integer not null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.app_settings (
  key   text primary key,
  value text not null
);

-- Teacher password. Default is "admin". To change it later, run:
--   update public.app_settings
--   set value = encode(sha256(convert_to('NEW-PASSWORD', 'UTF8')), 'hex')
--   where key = 'teacher_password_hash';
insert into public.app_settings (key, value)
values ('teacher_password_hash', encode(sha256(convert_to('admin', 'UTF8')), 'hex'))
on conflict (key) do nothing;

-- ---------- Lock the tables -------------------------------------------------
-- Nobody can read or write the tables directly from the website.
-- Everything goes through the functions below, which check the rules.

alter table public.students     enable row level security;
alter table public.codes        enable row level security;
alter table public.code_claims  enable row level security;
alter table public.rewards      enable row level security;
alter table public.redemptions  enable row level security;
alter table public.app_settings enable row level security;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on public.students, public.codes, public.code_claims, public.rewards, public.redemptions, public.app_settings from %I', r);
    end if;
  end loop;
end $$;

-- ---------- Helper ----------------------------------------------------------

create or replace function public._require_teacher(p_password text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from app_settings
    where key = 'teacher_password_hash'
      and value = encode(sha256(convert_to(coalesce(p_password, ''), 'UTF8')), 'hex')
  ) then
    raise exception 'Wrong teacher password';
  end if;
end $$;

-- ---------- Student functions -----------------------------------------------

create or replace function public.search_students(p_query text)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x), '[]'::json) from (
    select id, name, stars
    from students
    where length(btrim(coalesce(p_query, ''))) >= 1
      and position(lower(btrim(p_query)) in lower(name)) > 0
    order by (position(lower(btrim(p_query)) in lower(name)) = 1) desc, name
    limit 20
  ) x;
$$;

create or replace function public.student_view(p_student_id bigint)
returns json language plpgsql stable security definer set search_path = public as $$
declare result json;
begin
  select json_build_object(
    'student', json_build_object('id', s.id, 'name', s.name, 'stars', s.stars),
    'pending_stars', coalesce((select sum(cost) from redemptions
                               where student_id = s.id and status = 'pending'), 0),
    'rewards', coalesce((select json_agg(json_build_object('id', r.id, 'name', r.name, 'cost', r.cost)
                                         order by r.cost, r.name) from rewards r), '[]'::json),
    'requests', coalesce((select json_agg(x) from (
                   select id, reward_name, cost, status, created_at
                   from redemptions where student_id = s.id
                   order by created_at desc limit 10) x), '[]'::json)
  ) into result
  from students s where s.id = p_student_id;

  if result is null then
    raise exception 'Student not found';
  end if;
  return result;
end $$;

create or replace function public.claim_code(p_student_id bigint, p_code text, p_stars integer)
returns json language plpgsql security definer set search_path = public as $$
declare
  c codes%rowtype;
  new_total integer;
begin
  if p_stars is null or p_stars < 1 or p_stars > 100 then
    raise exception 'Enter a number of stars between 1 and 100';
  end if;
  if not exists (select 1 from students where id = p_student_id) then
    raise exception 'Student not found';
  end if;

  select * into c from codes
  where code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'))
  for update;

  if not found then
    raise exception 'That code is not correct. Check with your teacher.';
  end if;
  if c.expires_at <= now() then
    raise exception 'That code has expired. Ask your teacher for a new one.';
  end if;
  if exists (select 1 from code_claims where code_id = c.id and student_id = p_student_id) then
    raise exception 'You have already used this code.';
  end if;
  if c.uses >= c.max_uses then
    raise exception 'This code has already been used by the maximum number of students.';
  end if;

  insert into code_claims (code_id, student_id, stars) values (c.id, p_student_id, p_stars);
  update codes set uses = uses + 1 where id = c.id;
  update students set stars = stars + p_stars where id = p_student_id
  returning stars into new_total;

  return json_build_object('stars', new_total, 'added', p_stars);
end $$;

create or replace function public.request_reward(p_student_id bigint, p_reward_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare
  s students%rowtype;
  r rewards%rowtype;
  pending integer;
begin
  select * into s from students where id = p_student_id for update;
  if not found then raise exception 'Student not found'; end if;
  select * into r from rewards where id = p_reward_id;
  if not found then raise exception 'That reward is no longer available.'; end if;

  select coalesce(sum(cost), 0) into pending
  from redemptions where student_id = s.id and status = 'pending';

  if s.stars - pending < r.cost then
    raise exception 'You do not have enough stars for this reward yet.';
  end if;

  insert into redemptions (student_id, reward_id, reward_name, cost)
  values (s.id, r.id, r.name, r.cost);
  return json_build_object('ok', true);
end $$;

-- ---------- Teacher functions -----------------------------------------------

create or replace function public.teacher_dashboard(p_password text)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform _require_teacher(p_password);
  return json_build_object(
    'students', coalesce((select json_agg(json_build_object('id', id, 'name', name, 'stars', stars)
                                          order by lower(name)) from students), '[]'::json),
    'codes', coalesce((select json_agg(x) from (
                select id, code, max_uses, uses,
                       greatest(0, floor(extract(epoch from expires_at - now())))::int as seconds_left
                from codes where expires_at > now() order by created_at desc) x), '[]'::json),
    'rewards', coalesce((select json_agg(json_build_object('id', id, 'name', name, 'cost', cost)
                                         order by cost, name) from rewards), '[]'::json),
    'pending', coalesce((select json_agg(x) from (
                select d.id, s.name as student_name, s.stars as student_stars,
                       d.reward_name, d.cost, d.created_at
                from redemptions d join students s on s.id = d.student_id
                where d.status = 'pending' order by d.created_at) x), '[]'::json),
    'claims', coalesce((select json_agg(x) from (
                select s.name as student_name, c.code, k.stars, k.created_at
                from code_claims k
                join students s on s.id = k.student_id
                join codes c on c.id = k.code_id
                order by k.created_at desc limit 40) x), '[]'::json),
    'history', coalesce((select json_agg(x) from (
                select s.name as student_name, d.reward_name, d.cost, d.status, d.resolved_at
                from redemptions d join students s on s.id = d.student_id
                where d.status <> 'pending' order by d.resolved_at desc limit 30) x), '[]'::json)
  );
end $$;

create or replace function public.teacher_add_students(p_password text, p_names text[])
returns json language plpgsql security definer set search_path = public as $$
declare
  n text;
  added integer := 0;
  skipped integer := 0;
begin
  perform _require_teacher(p_password);
  foreach n in array coalesce(p_names, '{}') loop
    n := btrim(regexp_replace(n, '\s+', ' ', 'g'));
    continue when n = '';
    if length(n) > 80 then raise exception 'Name is too long: %', left(n, 30); end if;
    if exists (select 1 from students where lower(name) = lower(n)) then
      skipped := skipped + 1;
    else
      insert into students (name) values (n);
      added := added + 1;
    end if;
  end loop;
  return json_build_object('added', added, 'skipped', skipped);
end $$;

create or replace function public.teacher_update_student(p_password text, p_student_id bigint, p_name text, p_stars integer)
returns json language plpgsql security definer set search_path = public as $$
declare n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  perform _require_teacher(p_password);
  if n = '' or length(n) > 80 then raise exception 'Please enter a valid name'; end if;
  if p_stars is null or p_stars < 0 then raise exception 'Stars cannot be less than 0'; end if;
  if exists (select 1 from students where lower(name) = lower(n) and id <> p_student_id) then
    raise exception 'Another student already has that name';
  end if;
  update students set name = n, stars = p_stars where id = p_student_id;
  if not found then raise exception 'Student not found'; end if;
  return json_build_object('ok', true);
end $$;

create or replace function public.teacher_delete_student(p_password text, p_student_id bigint)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform _require_teacher(p_password);
  delete from students where id = p_student_id;
  return json_build_object('ok', true);
end $$;

create or replace function public.teacher_create_code(p_password text, p_max_uses integer)
returns json language plpgsql security definer set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 32 letters, no 0/O/1/I
  raw bytea;
  new_code text;
begin
  perform _require_teacher(p_password);
  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 1000 then
    raise exception 'Number of students must be between 1 and 1000';
  end if;
  loop
    raw := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    new_code := '';
    for i in 0..5 loop
      new_code := new_code || substr(alphabet, (get_byte(raw, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from codes where code = new_code);
  end loop;
  insert into codes (code, max_uses, expires_at)
  values (new_code, p_max_uses, now() + interval '15 minutes');
  return json_build_object('code', new_code);
end $$;

create or replace function public.teacher_end_code(p_password text, p_code_id bigint)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform _require_teacher(p_password);
  update codes set expires_at = now() where id = p_code_id and expires_at > now();
  return json_build_object('ok', true);
end $$;

create or replace function public.teacher_save_reward(p_password text, p_reward_id bigint, p_name text, p_cost integer)
returns json language plpgsql security definer set search_path = public as $$
declare n text := btrim(coalesce(p_name, ''));
begin
  perform _require_teacher(p_password);
  if n = '' or length(n) > 80 then raise exception 'Please enter a reward name'; end if;
  if p_cost is null or p_cost < 1 then raise exception 'Reward must cost at least 1 star'; end if;
  if p_reward_id is null then
    insert into rewards (name, cost) values (n, p_cost);
  else
    update rewards set name = n, cost = p_cost where id = p_reward_id;
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function public.teacher_delete_reward(p_password text, p_reward_id bigint)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform _require_teacher(p_password);
  delete from rewards where id = p_reward_id;
  return json_build_object('ok', true);
end $$;

create or replace function public.teacher_resolve_redemption(p_password text, p_redemption_id bigint, p_approve boolean)
returns json language plpgsql security definer set search_path = public as $$
declare
  d redemptions%rowtype;
  s students%rowtype;
begin
  perform _require_teacher(p_password);
  select * into d from redemptions where id = p_redemption_id for update;
  if not found or d.status <> 'pending' then
    raise exception 'This request was already handled';
  end if;
  if p_approve then
    select * into s from students where id = d.student_id for update;
    if s.stars < d.cost then
      raise exception '% only has % stars (needs %)', s.name, s.stars, d.cost;
    end if;
    update students set stars = stars - d.cost where id = s.id;
    update redemptions set status = 'approved', resolved_at = now() where id = d.id;
  else
    update redemptions set status = 'rejected', resolved_at = now() where id = d.id;
  end if;
  return json_build_object('ok', true);
end $$;

-- ---------- Permissions -----------------------------------------------------

revoke all on function public._require_teacher(text) from public;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public._require_teacher(text) from %I', r);
      execute format('grant usage on schema public to %I', r);
      execute format('grant execute on function
        public.search_students(text),
        public.student_view(bigint),
        public.claim_code(bigint, text, integer),
        public.request_reward(bigint, bigint),
        public.teacher_dashboard(text),
        public.teacher_add_students(text, text[]),
        public.teacher_update_student(text, bigint, text, integer),
        public.teacher_delete_student(text, bigint),
        public.teacher_create_code(text, integer),
        public.teacher_end_code(text, bigint),
        public.teacher_save_reward(text, bigint, text, integer),
        public.teacher_delete_reward(text, bigint),
        public.teacher_resolve_redemption(text, bigint, boolean)
        to %I', r);
    end if;
  end loop;
end $$;

-- Tell the API to pick up the new functions straight away.
notify pgrst, 'reload schema';
