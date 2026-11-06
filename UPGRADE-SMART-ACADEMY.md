# Smart Academy System — upgrade notes

This upgrade adds **Staff attendance and a monthly salary sheet**, and gives the whole
app a new look. Your students, attendance, fees, reports, login, backup and PDF
features keep working exactly as before.

## What's new

### Staff module (new page: `staff.html`)
- **Team** — add staff with name, role/subject, phone, joining date, monthly salary,
  notes and an active switch. Search, edit, mark inactive, or delete.
- **Attendance** — one tap per staff member per day: Present, Half day, Absent or Leave.
  "All present" shortcut. Tap a selected status again to clear it.
- **Salary sheet** — pick a month and see every staff member's paid days, salary,
  bonus, deduction, net pay and status in one table, with totals
  (total payable / paid / pending).
  - Tap a row to adjust working days, salary, bonus and advance/deduction,
    then **Save**, **Mark as paid** (with date and mode) or download a **Payslip PDF**.
  - **Download salary sheet** exports the month as CSV (opens in Excel).
  - Pending months follow attendance automatically; a month marked **Paid is locked**
    until you mark it pending again.

Salary rule:

```
paid days = present + paid leave + 0.5 × half days   (never above working days)
earned    = monthly salary × paid days ÷ working days
net pay   = earned + bonus − advance/deduction        (never below 0)
```

Working days default to the days in the month minus Sundays and can be changed per
staff member per month.

### Dashboard
Two new tiles (Staff in today, Active staff), a staff attendance quick action and a
reminder when today's staff attendance has not been marked.

### New design
- Deep pine and mist palette, Sora + Plus Jakarta Sans typography.
- Phones keep the bottom tab bar (now with a Staff tab); desktops get a left sidebar.
- New app icons, new PDF/Excel colours, app name "Smart Academy System".

## Your data stays private to your account

Every table (including the new staff tables) stores a `user_id`, and **every** query in
the Worker filters by the logged-in account. The Worker re-checks that any staff id
belongs to the caller before reading or writing it, so one account can never see,
change or delete another account's data. Backup, restore and "Clear all data" also
act only on the signed-in account.

If an academy wants its data in **its own Cloudflare account** (fully separate
database), that academy deploys its own copy of this project: follow `DEPLOYMENT.md`
with their own Cloudflare login and put their own Worker URL in `js/config.js`.

## Files added or changed

**New:** `staff.html`, `js/staff.js`, `worker/migrations/0003_staff.sql`,
this file.

**Changed:** `css/style.css` (new theme), `js/app.js` (navigation, icons, dashboard),
`js/db.js` (staff API + backup), `worker/src/index.js` (staff routes, restore, clear),
`service-worker.js` (cache list, version bump), `index.html`, `login.html`,
`settings.html` and other pages (branding, icons), `manifest.json`, icons,
`js/pdf-reports.js` and `js/utils.js` (brand colours only).

**Database:** one additive migration (`0003_staff.sql`) creating `staff`,
`staff_attendance` and `staff_payroll`. No existing table is altered.

## How to deploy the upgrade

1. Apply the new migration to your live database (from the `worker` folder):

   ```bash
   wrangler d1 migrations apply tuition-manager-db --remote
   ```

   (Keep the database name from your `wrangler.toml`; it was not renamed.)
2. Deploy the Worker:

   ```bash
   wrangler deploy
   ```

3. Upload the frontend files (everything outside `worker/`) to your hosting as before.
   `js/config.js` already points at your Worker URL.
4. Open the app once online so the service worker picks up the new cache version
   (`smart-academy-v14`). On phones, close and reopen the installed app once.

## Backups
Backups are now version 3 and include staff, staff attendance and salary records.
Older backup files still restore normally and leave your staff data untouched.

## Design refresh (v2)
Dashboard greeting banner with search, coloured icon tiles, initials avatars on every
student/staff/payment row, a split-screen sign-in page, and a network-first service
worker so new versions always show immediately. Layouts were tested at 320, 375, 768,
1024 and 1440 px wide on every page with no sideways scrolling.

If you still see the old look, clear the old cached copy once: open DevTools (F12) →
Application → Service Workers → Unregister, then Storage → Clear site data, and reload.

## v3: real website + new identity
- **Public website** at `index.html`: hero, features, product previews, how it works,
  security, free pricing and FAQ, with its own stylesheet (`css/site.css`).
- **The app dashboard moved to `dashboard.html`.** The website's "Log in" and "Get started"
  buttons lead to the login page and then the dashboard. Signed-in visitors see
  "Open dashboard" instead.
- **New identity:** deep indigo with a teal accent, Playfair Display headings, Manrope body text.
- **New app layout:** a website-style top navigation bar on desktop; the tab bar on phones.
- **Free hosting guide:** see `FREE-HOSTING.md`.

## v4: email password reset, indigo theme, professional Attendance and Fees
- **Forgot password by email**, free via Brevo: see `EMAIL-SETUP.md`. New migration
  `0004_password_reset.sql`; new page `reset-password.html`.
- **Colour identity changed** from burgundy to deep indigo with a teal accent.
- **Attendance:** date navigation, summary cards with attendance rate, search and status
  filters, a roster table with segmented Present/Absent controls and marked-at times, a
  sticky "unsaved changes" bar (saves only what changed), and a cleaner History tab.
- **Fees:** month navigation, Expected / Collected / Pending / Collection-rate cards,
  status filters, a fee table with balance per student, and quick Add payment and
  Send reminder actions. On phones the tables become cards.

## v5: holiday calendar, staff history, visible Save, cache-proofing
- **Holiday calendar** (`holidays.html`, "Calendar" in the menu): the owner marks festival,
  rain, public or other holidays, for one day or a range, for students, staff or both.
  - Student attendance shows a holiday banner and the history lists holidays.
  - **Staff salary follows the calendar.** A *paid* holiday is credited as a paid day, so
    salary is unaffected. An *unpaid* holiday is not credited (unless the person worked),
    so that day is deducted. Sundays stay weekly offs.
  - The dashboard shows today's holiday or the next one within 14 days, and stops asking
    for attendance on a holiday.
- **Staff attendance history:** a monthly register (staff × days) with P / ½ / L / A
  codes, holidays and Sundays, totals, estimated paid days and Excel export.
- **Attendance:** an always-visible **Save attendance** button (plus the unsaved-changes bar);
  summary cards update live as you mark; staff attendance got the same cards, day
  navigation and Save button.
- **Stale-file fix:** all scripts and styles are versioned (`?v=14`) and the service worker
  revalidates with the server, so an old cached file can no longer mix with new pages.
- **Database:** `0005_holidays.sql` adds the holidays table and a paid-holidays column on
  salary rows. Backups are version 4 and include holidays.

If a page looks old or buttons do nothing, see "Old version still showing?" in README.md.
