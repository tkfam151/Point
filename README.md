# ★ Star Points

A simple class reward website.

- **Students** open `/`, search for their name, see their stars as stamp cards
  (10 stamps per card), key in the teacher's code to add stars, and request rewards.
- **Teachers** open `/teacher`, log in with the password `admin`, add students,
  create 15-minute class codes, create rewards and approve reward requests.

The website is plain HTML/CSS/JavaScript (hosted on GitHub Pages) and the data
lives in Supabase.

## Setup (about 10 minutes, one time only)

### 1. Create the database

1. Go to [supabase.com](https://supabase.com), sign in and create a **New project**.
2. In the project, open **SQL Editor**, click **New query**.
3. Copy everything from [`supabase/schema.sql`](supabase/schema.sql), paste it in and press **Run**.
   You should see "Success".

### 2. Connect the website

1. In Supabase open **Project Settings → API** (or the **Connect** button).
2. Copy the **Project URL** and the **anon / publishable** key.
3. Open [`config.js`](config.js) in this repository and paste them in:

   ```js
   window.APP_CONFIG = {
     SUPABASE_URL: "https://abcdefgh.supabase.co",
     SUPABASE_ANON_KEY: "eyJ...",
   };
   ```

   This key is designed to be public. Never paste the **service_role / secret** key here.

### 3. Turn on GitHub Pages

1. In this repository on GitHub open **Settings → Pages**.
2. Under **Build and deployment** choose **Deploy from a branch**, pick the branch
   that has these files (normally `main`) and the folder `/ (root)`, then **Save**.
3. After a minute the site is live at:
   - Students: `https://<your-username>.github.io/Point/`
   - Teachers: `https://<your-username>.github.io/Point/teacher`

## How it works

| Thing | Rule |
| --- | --- |
| Class code | Teacher chooses how many students can use it. It stops working after 15 minutes (or when the teacher presses **End code now**). |
| Adding stars | The student types the code and the number of stars the teacher tells them (1–100). Each student can use a code once. |
| Stamp cards | Every 10 stars fills one card. Full cards are shown small under the current card. |
| Rewards | The student presses **Redeem** to send a request. Stars are only taken off when the teacher presses **Approve**. |
| Mistakes | The teacher can use **−1 / +1** or **Edit** to fix any student's stars. **Recent activity** shows who added how many stars. |

## Changing the teacher password

Run this in the Supabase SQL Editor (replace `NEW-PASSWORD`):

```sql
update public.app_settings
set value = encode(sha256(convert_to('NEW-PASSWORD', 'UTF8')), 'hex')
where key = 'teacher_password_hash';
```

## Good to know

- The password and the 15-minute limit are checked inside the database, not in the
  browser, so they cannot be skipped by looking at the website's code.
- Students do not log in. Anyone can pick any name, so a student could add stars to a
  friend's name while a code is valid. Rewards always need the teacher's approval.
- `admin` is an easy password to guess. Change it if the site is shared outside class.
