# Deployment Guide — Cloudflare Cloud Sync Upgrade

## 🆕 What's new in THIS upgrade (branding + signatures + PDF reports)

You already have the Worker + D1 backend deployed and working. This
upgrade only adds: a tuition logo, head/staff signatures (with automatic
background removal), an individual-report PDF download, and a new
"Monthly (All Students)" PDF report. **You do not need to redo the
Worker deploy from scratch** — just run one more migration and redeploy.

From your `worker` folder:

```powershell
cd worker
npm run db:migrate:remote
npm run deploy
```

That's it for the backend — `db:migrate:remote` runs the new
`migrations/0002_branding.sql` (adds four columns to the `settings`
table; existing rows are untouched, they just get empty values for the
new fields), and `npm run deploy` re-uploads the Worker with the updated
API code that reads/writes them.

For the frontend: since `js/config.js` already points at your deployed
Worker, there's nothing to reconfigure — just commit and push the
updated files (see "How to push this into GitHub" from earlier in this
conversation) and redeploy/refresh however you're hosting the frontend
(GitHub Pages / Cloudflare Pages).

**Try it:** Settings → scroll to "Tuition Center Information" → upload a
logo and/or signatures → Save Changes → go to Reports → "Monthly (All)"
tab → pick a month → Generate & Download PDF.

---

This upgrade adds account login and cross-device cloud sync to Tuition
Manager, backed by a Cloudflare Worker + D1 database. **The UI, theme,
navigation, Settings features and every existing screen are unchanged** —
see "What changed" at the bottom for the precise list of new/edited files.

> **Note on the theme:** your upgrade brief asked to keep the existing
> "green and white theme." The repository as uploaded actually uses a
> navy-blue-and-cream theme (`#1E3A5F` / `#F5F3ED`, see `css/style.css`).
> Nothing in this upgrade touches colors, fonts, spacing or layout — the
> existing theme (whichever one that is) is preserved exactly. If you do
> have a green-and-white version elsewhere, let me know and I'll re-apply
> this upgrade on top of that version instead.

---

## 1. Prerequisites

- A free Cloudflare account.
- Node.js installed locally (for the `wrangler` CLI).
- Your existing GitHub repo (`Rickshitha2006/tuition-manager`) cloned locally.

Install Wrangler (Cloudflare's CLI) once, globally or per-project:

```bash
npm install -g wrangler
wrangler login
```

`wrangler login` opens a browser window to authorize the CLI against your
Cloudflare account — no API keys to copy/paste, nothing to put in GitHub.

---

## 2. Deploy the backend (Worker + D1)

All backend code lives in the new `worker/` folder.

```bash
cd worker
npm install
```

### 2.1 Create the D1 database

```bash
wrangler d1 create tuition-manager-db
```

This prints a block like:

```
[[d1_databases]]
binding = "DB"
database_name = "tuition-manager-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copy the `database_id` value into `worker/wrangler.toml`, replacing
`REPLACE_WITH_YOUR_D1_DATABASE_ID`.

### 2.2 Run the schema migration

```bash
npm run db:migrate:remote
```

(This runs `worker/migrations/0001_init.sql` against your live D1
database — the same file also under version control in your repo, per
your requirement to keep migrations in the repository.)

### 2.3 Deploy the Worker

```bash
npm run deploy
```

Wrangler prints the Worker's URL, e.g.:

```
https://tuition-manager-api.<your-subdomain>.workers.dev
```

**Copy this URL** — you need it in the next step.

No secrets need to be configured anywhere (passwords are hashed with
PBKDF2 via the Workers runtime's built-in Web Crypto, and sessions are
random tokens stored in D1 — there are no API keys or credentials for
this project). If you ever add one later, use `wrangler secret put NAME`
— never put it in `wrangler.toml` or any frontend file.

---

## 3. Point the frontend at your Worker

Open `js/config.js` in the repo root and set it to the URL from step 2.3:

```js
const TM_API_BASE = "https://tuition-manager-api.<your-subdomain>.workers.dev";
```

This is the **only** file you need to edit. Nothing else references the
Worker URL directly.

---

## 4. Deploy the frontend (Cloudflare Pages)

You can keep using GitHub Pages if you prefer — nothing about the
frontend requires Cloudflare specifically. To use Cloudflare Pages
instead (recommended, since you're already on Cloudflare for the API):

1. Push your repo (including your edited `js/config.js`) to GitHub.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages →
   Connect to Git** → select your `tuition-manager` repo.
3. Build settings: **Framework preset: None**, **Build command:
   (leave blank)**, **Build output directory: `/`** (the repo root — this
   is a static site with no build step).
4. Deploy. Cloudflare gives you a `*.pages.dev` URL (and you can attach a
   custom domain later from the same project settings).

> The `worker/` folder is backend code and is **not** part of what Pages
> serves — Pages only serves your existing HTML/CSS/JS/icons at the repo
> root, exactly as GitHub Pages did.

---

## 5. First login on each device

1. Open the deployed site → you'll land on `login.html` (new — matches
   the existing setup-screen styling) → tap **"Create one"** to register
   with an email and password.
2. You'll be taken through the same first-time center-name/staff-name
   setup screen as before, then the same dashboard.
3. If this device had data from *before* this upgrade (old local
   IndexedDB data), you'll be asked once whether to import it into your
   new account — see "Data migration" below.
4. On a second device: open the site, log in with the **same email and
   password** → the same students/attendance/fees appear automatically.

---

## 6. Data migration (existing local data)

If a device already had Tuition Manager data saved locally (in the old
`TuitionManagerDB` IndexedDB database) from before this upgrade,
`js/migrate.js` detects it the first time you log in on that device *and*
your cloud account is still empty, and asks:

> "We found existing student, attendance and fee data saved on this
> device from before cloud sync was added. Import it into your account
> now?"

- **Old data is never silently deleted or overwritten.** It stays in the
  browser's IndexedDB either way — this only *copies* it into your cloud
  account.
- If you skip the prompt, or need to do it again later (e.g. on a device
  where you dismissed it, or after clearing the browser's localStorage
  flag), go to **Settings → Import Data From This Device** and confirm.
- This import always *replaces* your current cloud data (same semantics
  as **Restore from Backup**), so it's meant for the very first sync of a
  device's old data — not as a periodic merge.

---

## 7. What changed (file list)

**New files:**
- `worker/` — the entire Cloudflare Worker + D1 backend (`src/index.js`,
  `src/crypto.js`, `wrangler.toml`, `package.json`,
  `migrations/0001_init.sql`).
- `login.html` — login/register screen, styled with the existing
  `.tm-setup-wrap`/`.tm-setup-card` classes (no new visual design).
- `js/config.js` — the one line you edit with your Worker URL.
- `js/legacy-local-db.js` — your original IndexedDB code, unchanged
  except renamed from `TMDB` to `TMLegacyLocalDB`, kept only so old local
  data can still be read for migration.
- `js/migrate.js` — the one-time local-data-import flow described above.
- `DEPLOYMENT.md`, `.gitignore` — this file, and a gitignore covering
  `node_modules/`, Wrangler's local dev state, and anything secret.

**Edited files (all logic-only — no visual/markup changes beyond what's
noted):**
- `js/db.js` — rewritten to call the Worker API instead of IndexedDB.
  **Every method name and return shape is identical to before**
  (`TMDB.getAllStudents()`, `TMDB.markAttendance()`, `TMDB.saveSettings()`,
  etc.), so `students.js`, `attendance.js`, `fees.js`, `reports.js`,
  `backup.js` and `settings.js` needed **zero changes** to their logic.
- `js/app.js` — `tmRequireSetup()` and `tmInitDashboard()` now redirect to
  `login.html` if there's no active session, before doing anything else.
- `js/attendance.js` — Attendance History rows now show a small muted
  time (e.g. `5:42 PM`) next to the existing Present/Absent badge, when
  a record has one. No layout/markup changes beyond that one line.
- `js/utils.js` — added one helper, `tmFormatTime12h()`, used only by the
  above. The Excel/CSV export builders (`tmBuildAttendanceWorkbook`, etc.)
  were **not touched** — they already only ever read `date`/`studentId`/
  `status`, so the new `markedAt` field was never at risk of appearing in
  an export.
- `index.html`, `attendance.html`, `fees.html`, `reports.html`,
  `students.html`, `settings.html` — added `<script>` tags for
  `js/config.js` (and, on `login.html`/`settings.html`,
  `js/legacy-local-db.js` + `js/migrate.js`). One outdated privacy
  sentence on the first-time setup screen was updated to reflect cloud
  sync. No CSS, colors, spacing, or component markup changed.
- `settings.html` / `js/settings.js` — added one new "Account" card
  (email + Log Out) and one new "Import Data From This Device" card,
  using the exact same `.tm-card`/`.tm-section-title`/`btn-tm-outline`
  classes as every other section on that page. **Export Data, Load Data
  (Restore), Restore Data, Clear All Data, Load Demo Data and Remove Demo
  Data are all still there, unrenamed, doing what they did before** — just
  reading/writing the cloud now instead of IndexedDB. A few sentences on
  that page describing "local-only" storage were updated to describe
  cloud sync instead (no layout change).
- `service-worker.js` — cache list updated for the new files; requests to
  the Worker API are now explicitly never cached by the service worker
  (so one account's data can never be served to a different account
  signed in later on a shared device), and the cache-version bumped so
  everyone gets the update on next load.
- `README.md` — one note at the top pointing here; original content
  otherwise untouched (some of its "local-only, no backend" claims are
  now superseded by this file, as noted inline).

**Not touched at all:** `css/style.css`, `manifest.json`, `icons/`,
`students.html`/`attendance.html`/`fees.html`/`reports.html` markup
(beyond the one script tag each), `js/students.js`, `js/fees.js`,
`js/reports.js`, `js/backup.js` business logic.

---

## 8. Security notes

- Passwords are hashed with PBKDF2-SHA256 (100,000 iterations, random
  16-byte salt per user) using the Workers runtime's native Web Crypto —
  never stored or logged in plaintext, never sent to the frontend.
- Sessions are opaque random 256-bit tokens stored server-side in D1
  (`sessions` table), not JWTs — logging out deletes the row immediately,
  so there's nothing to "expire" client-side that could still be replayed.
  Sessions otherwise expire after 30 days (`SESSION_DAYS` in
  `worker/src/index.js`).
- Every students/attendance/payments read or write is scoped with
  `WHERE user_id = ?` against the authenticated session's user — a
  student/attendance/payment ID alone is never sufficient to read or
  modify a record; ownership is re-checked against the database on every
  request (see `getOwnedStudent`/`getOwnedAttendance`/`getOwnedPayment`
  in `worker/src/index.js`).
- `Clear All Data` and the local-data migration/restore endpoints only
  ever delete or insert rows scoped to the authenticated user's `user_id`
  — never the whole table, never another account's rows.
- No secrets, API keys, or credentials exist anywhere in this project to
  accidentally commit — nothing needs to go in `wrangler secret put` or
  GitHub Actions secrets for the current feature set.

---

## 9. Known limitations (by design, per the brief)

- **Cloud writes require an internet connection.** If you're offline,
  adding a student, marking attendance, or recording a payment will show
  an error toast (via the existing `tmToast()`/`alert()` patterns) rather
  than silently queuing — building a full offline write-sync engine was
  explicitly out of scope. Reads (viewing your last-loaded data) still
  work offline via a small local cache in `js/db.js`.
- **Legacy attendance records never get a fabricated timestamp.** Only
  attendance marked *after* this upgrade gets a real `markedAt` value;
  older records simply show no time in Attendance History, as specified.
- Session length is 30 days; there's no "remember me" toggle since every
  session already lasts 30 days by default.

---

## 10. Testing checklist

Manual test pass to run after deploying (mirrors the acceptance criteria
in the original brief):

- [ ] Register a new account on Device 1; complete first-time setup.
- [ ] Add a student, mark them Present → Attendance History shows the
      correct local time next to the badge.
- [ ] Export Attendance (Excel) → confirm the workbook has **no** time
      column (open it and check — it should look identical to before).
- [ ] Log in with the same email/password on Device 2 (or a private/
      incognito window) → same student, same attendance, same timestamp
      appear after the page loads.
- [ ] On Device 2, change that student's attendance to Absent, then back
      to Present → Device 1 shows the new status/time after a refresh.
- [ ] Record a payment on one device → appears on the other after refresh.
- [ ] Settings → Export Data, Load Demo Data, Remove Demo Data, Clear All
      Data, Backup All Data, Restore from Backup — each still works and
      only affects your own account's data.
- [ ] Try loading a second, unrelated account and confirm it sees none of
      the first account's students/attendance/fees.
- [ ] Install as a PWA (desktop and/or Android) and confirm it still
      opens standalone with its icon.
- [ ] Turn off Wi-Fi/data, reopen the app → last-loaded data still shows;
      try adding a student → get a clear error instead of a silent no-op.

I was not able to run this checklist myself (I don't have a live
Cloudflare account, D1 instance, or two physical devices to test
against) — please run through it after deploying and let me know if
anything doesn't behave as described, so I can fix it directly rather
than guessing.
