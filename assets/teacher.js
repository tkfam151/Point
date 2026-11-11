// Teacher page: log in, manage students, class codes, rewards and requests.

const app = $("#app");
const logoutBtn = $("#logout");
const PW_KEY = "starpoints.teacher";

let password = null;
let data = null; // last dashboard from the server
let loadedAt = 0; // when `data` arrived, for the code countdowns
let filter = "";
let refreshTimer;

// ---------- Login ----------

function showLogin() {
  password = null;
  data = null;
  clearInterval(refreshTimer);
  try {
    sessionStorage.removeItem(PW_KEY);
  } catch {}
  logoutBtn.hidden = true;

  const input = h("input", { id: "pw", type: "password", autocomplete: "current-password", required: true });
  const btn = h("button", { type: "submit" }, "Log in");
  app.replaceChildren(
    h(
      "section",
      { class: "panel" },
      h("h2", {}, "Teacher login"),
      h(
        "form",
        {
          onsubmit: async (ev) => {
            ev.preventDefault();
            btn.disabled = true;
            await login(input.value);
            btn.disabled = false;
          },
        },
        h("label", { for: "pw" }, "Password"),
        input,
        h("div", { class: "row", style: "margin-top:16px" }, btn)
      )
    )
  );
  input.focus();
}

async function login(pw) {
  try {
    const d = await rpc("teacher_dashboard", { p_password: pw });
    password = pw;
    try {
      sessionStorage.setItem(PW_KEY, pw);
    } catch {}
    logoutBtn.hidden = false;
    setData(d);
    buildDashboard();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (!document.hidden) reload();
    }, 8000);
  } catch (e) {
    toast(e.message, "err");
    if (password === null && !$("#pw")) showLogin();
  }
}

// ---------- Data ----------

function setData(d) {
  data = d;
  loadedAt = Date.now();
}

async function reload() {
  if (!password) return;
  try {
    setData(await rpc("teacher_dashboard", { p_password: password }));
    renderAll();
  } catch (e) {
    if (/password/i.test(e.message)) showLogin();
  }
}

// Runs a teacher action, then refreshes the page data.
async function act(fn, args, okMessage) {
  try {
    const out = await rpc(fn, { p_password: password, ...args });
    if (okMessage) toast(typeof okMessage === "function" ? okMessage(out) : okMessage);
    await reload();
    return out;
  } catch (e) {
    toast(e.message, "err");
    if (/password/i.test(e.message)) showLogin();
    return null;
  }
}

// ---------- Layout (built once, so typing is never interrupted) ----------

function buildDashboard() {
  // Class code
  const usesInput = h("input", { id: "max-uses", type: "number", min: "1", max: "1000", value: "30", required: true });
  const codePanel = h(
    "section",
    { class: "panel" },
    h("h2", {}, "Class code"),
    h("p", { class: "muted" }, "A code works for 15 minutes. Tell students how many stars to key in."),
    h(
      "form",
      {
        class: "row",
        onsubmit: (ev) => {
          ev.preventDefault();
          act("teacher_create_code", { p_max_uses: parseInt(usesInput.value, 10) }, "New code created");
        },
      },
      h("div", { class: "grow" }, h("label", { for: "max-uses" }, "Valid for how many students"), usesInput),
      h("button", { type: "submit" }, "Create code")
    ),
    h("div", { id: "codes" })
  );

  // Reward requests
  const pendingPanel = h(
    "section",
    { class: "panel" },
    h("h2", {}, "Reward requests"),
    h("div", { id: "pending" })
  );

  // Students
  const namesInput = h("textarea", { id: "names", placeholder: "One name per line", required: true });
  const filterInput = h("input", {
    id: "filter",
    type: "search",
    placeholder: "Search students…",
    oninput: (ev) => {
      filter = ev.target.value.trim().toLowerCase();
      renderStudents();
    },
  });
  const studentsPanel = h(
    "section",
    { class: "panel" },
    h("h2", { id: "students-title" }, "Students"),
    h(
      "form",
      {
        onsubmit: async (ev) => {
          ev.preventDefault();
          const names = namesInput.value.split("\n").map((n) => n.trim()).filter(Boolean);
          if (!names.length) return;
          const out = await act("teacher_add_students", { p_names: names }, (o) =>
            `Added ${plural(o.added, "student")}` + (o.skipped ? ` (${o.skipped} already on the list)` : "")
          );
          if (out) namesInput.value = "";
        },
      },
      h("label", { for: "names" }, "Add students"),
      namesInput,
      h("div", { class: "add-actions" }, h("button", { type: "submit" }, "Add students"))
    ),
    filterInput,
    h("ul", { class: "list", id: "students" })
  );

  // Rewards
  const rewardName = h("input", { id: "reward-name", placeholder: "e.g. Sticker", maxlength: "80", required: true });
  const rewardCost = h("input", { id: "reward-cost", type: "number", min: "1", placeholder: "10", required: true });
  const rewardsPanel = h(
    "section",
    { class: "panel" },
    h("h2", {}, "Rewards"),
    h(
      "form",
      {
        class: "row",
        onsubmit: async (ev) => {
          ev.preventDefault();
          const out = await act(
            "teacher_save_reward",
            { p_reward_id: null, p_name: rewardName.value, p_cost: parseInt(rewardCost.value, 10) },
            "Reward added"
          );
          if (out) {
            rewardName.value = "";
            rewardCost.value = "";
          }
        },
      },
      h("div", { class: "grow" }, h("label", { for: "reward-name" }, "Reward"), rewardName),
      h("div", { class: "narrow" }, h("label", { for: "reward-cost" }, "Stars needed"), rewardCost),
      h("button", { type: "submit" }, "Add")
    ),
    h("ul", { class: "list", id: "rewards" })
  );

  // Activity
  const activityPanel = h(
    "section",
    { class: "panel" },
    h("h2", {}, "Recent activity"),
    h("ul", { class: "list", id: "activity" })
  );

  // Two columns on iPad and Mac; on iPhone they stack in this order.
  app.replaceChildren(
    h(
      "div",
      { class: "grid" },
      h("div", { class: "col" }, codePanel, pendingPanel, rewardsPanel),
      h("div", { class: "col" }, studentsPanel, activityPanel)
    )
  );
  renderAll();
}

// ---------- Rendering the changing parts ----------

function renderAll() {
  if (!data || !$("#codes")) return;
  renderCodes();
  renderPending();
  renderStudents();
  renderRewards();
  renderActivity();
}

function secondsLeft(code) {
  return Math.max(0, code.seconds_left - Math.floor((Date.now() - loadedAt) / 1000));
}
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function renderCodes() {
  const live = data.codes.filter((c) => secondsLeft(c) > 0);
  $("#codes").replaceChildren(
    ...(live.length
      ? live.map((c) =>
          h(
            "div",
            { class: "code-box" },
            h("div", { class: "code" }, c.code),
            h(
              "div",
              { class: "meta" },
              "Expires in ",
              h("b", { "data-code-id": c.id }, clock(secondsLeft(c))),
              ` · used by ${c.uses} of ${plural(c.max_uses, "student")}`
            ),
            h(
              "button",
              { type: "button", class: "ghost small", onclick: () => act("teacher_end_code", { p_code_id: c.id }, "Code ended") },
              "End code now"
            )
          )
        )
      : [h("p", { class: "empty" }, "No active code.")])
  );
}

function tickCodes() {
  if (!data) return;
  let expired = false;
  for (const c of data.codes) {
    const el = document.querySelector(`[data-code-id="${c.id}"]`);
    if (!el) continue;
    const s = secondsLeft(c);
    el.textContent = clock(s);
    if (s <= 0) expired = true;
  }
  if (expired) renderCodes();
}

function renderPending() {
  $("#pending").replaceChildren(
    data.pending.length
      ? h(
          "ul",
          { class: "list" },
          data.pending.map((p) =>
            h(
              "li",
              {},
              h(
                "div",
                { class: "main" },
                h("strong", {}, p.student_name),
                " wants ",
                h("strong", {}, p.reward_name),
                h("div", { class: "muted" }, `Costs ★ ${p.cost} · has ★ ${p.student_stars} · ${timeAgo(p.created_at)}`)
              ),
              h(
                "div",
                { class: "actions" },
                h(
                  "button",
                  {
                    type: "button",
                    class: "small",
                    onclick: () =>
                      act("teacher_resolve_redemption", { p_redemption_id: p.id, p_approve: true }, `Approved — ${plural(p.cost, "star")} taken off`),
                  },
                  "Approve"
                ),
                h(
                  "button",
                  {
                    type: "button",
                    class: "danger small",
                    onclick: () => act("teacher_resolve_redemption", { p_redemption_id: p.id, p_approve: false }, "Request rejected"),
                  },
                  "Reject"
                )
              )
            )
          )
        )
      : h("p", { class: "empty" }, "No requests waiting.")
  );
}

function renderStudents() {
  $("#students-title").textContent = `Students (${data.students.length})`;
  const shown = data.students.filter((s) => s.name.toLowerCase().includes(filter));
  const bump = (s, by) =>
    act("teacher_update_student", { p_student_id: s.id, p_name: s.name, p_stars: Math.max(0, s.stars + by) });

  $("#students").replaceChildren(
    ...(shown.length
      ? shown.map((s) =>
          h(
            "li",
            {},
            h("div", { class: "main" }, s.name),
            h("span", { class: "pill stars-num" }, `★ ${s.stars}`),
            h(
              "div",
              { class: "actions" },
              h("button", { type: "button", class: "ghost small", "aria-label": `Remove 1 star from ${s.name}`, disabled: s.stars < 1, onclick: () => bump(s, -1) }, "−1"),
              h("button", { type: "button", class: "ghost small", "aria-label": `Give 1 star to ${s.name}`, onclick: () => bump(s, 1) }, "+1"),
              h("button", { type: "button", class: "ghost small", onclick: () => openEdit(s) }, "Edit")
            )
          )
        )
      : [h("li", { class: "empty" }, data.students.length ? "No student matches your search." : "No students yet. Add some above.")])
  );
}

function renderRewards() {
  $("#rewards").replaceChildren(
    ...(data.rewards.length
      ? data.rewards.map((r) =>
          h(
            "li",
            {},
            h("div", { class: "main" }, r.name),
            h("span", { class: "pill" }, `★ ${r.cost}`),
            h(
              "button",
              {
                type: "button",
                class: "danger small",
                onclick: () => {
                  if (confirm(`Delete the reward "${r.name}"?`)) act("teacher_delete_reward", { p_reward_id: r.id }, "Reward deleted");
                },
              },
              "Delete"
            )
          )
        )
      : [h("li", { class: "empty" }, "No rewards yet.")])
  );
}

function renderActivity() {
  const items = [
    ...data.claims.map((c) => ({
      at: c.created_at,
      node: [h("strong", {}, c.student_name), ` added ★ ${c.stars} with code ${c.code}`],
    })),
    ...data.history.map((r) => ({
      at: r.resolved_at,
      node: [
        h("strong", {}, r.student_name),
        r.status === "approved" ? ` redeemed ${r.reward_name} (★ ${r.cost})` : ` — request for ${r.reward_name} rejected`,
      ],
    })),
  ]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 40);

  $("#activity").replaceChildren(
    ...(items.length
      ? items.map((i) => h("li", {}, h("div", { class: "main" }, i.node), h("span", { class: "muted" }, timeAgo(i.at))))
      : [h("li", { class: "empty" }, "Nothing yet.")])
  );
}

// ---------- Edit student dialog ----------

const dialog = $("#edit-dialog");
let editing = null;

function openEdit(student) {
  editing = student;
  $("#edit-name").value = student.name;
  $("#edit-stars").value = student.stars;
  dialog.showModal();
}

$("#edit-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const out = await act(
    "teacher_update_student",
    { p_student_id: editing.id, p_name: $("#edit-name").value, p_stars: parseInt($("#edit-stars").value, 10) },
    "Student saved"
  );
  if (out) dialog.close();
});
$("#edit-cancel").addEventListener("click", () => dialog.close());
$("#edit-delete").addEventListener("click", async () => {
  if (!confirm(`Delete ${editing.name} and all their stars? This cannot be undone.`)) return;
  const out = await act("teacher_delete_student", { p_student_id: editing.id }, "Student deleted");
  if (out) dialog.close();
});

// ---------- Start ----------

logoutBtn.addEventListener("click", showLogin);
setInterval(tickCodes, 1000);

if (!isConfigured()) {
  showSetupNotice(app);
} else {
  let saved = null;
  try {
    saved = sessionStorage.getItem(PW_KEY);
  } catch {}
  showLogin();
  if (saved) login(saved);
}
