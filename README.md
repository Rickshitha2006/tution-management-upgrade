# 🎓 Tuition Manager

> **Update:** This app now supports account login and cross-device cloud
> sync via a Cloudflare Worker + D1, on top of the exact same UI. See
> [`DEPLOYMENT.md`](DEPLOYMENT.md) for what changed and how to deploy it.
> Everything below describes the original local-only version; sections 3–4
> and 15 (IndexedDB, no backend, local-only privacy) are superseded by
> `DEPLOYMENT.md`.

A free, offline, installable Progressive Web App (PWA) that replaces a tuition
teacher's paper notebook. Manage students, daily attendance, fees, and
generate simple parent-ready reports — all from a phone, with no internet
connection required after the first load.

Tuition Manager is **generic**: the first time it is opened, it asks for
your tuition center's name and your name. It contains no hard-coded center,
teacher, or student data, so anyone can install it and start using it
immediately for their own tuition center.

---

## 1. What is Tuition Manager?

It is a single-teacher, single-phone digital register. It is not a school
management system with logins, batches, or multiple staff accounts — it is
designed to be as simple as a physical notebook, just digital.

## 2. Features

- First-time setup for your tuition center's name, staff name, contact and address
- Add, edit, delete, search and view students
- Daily attendance with a "Mark All Present" shortcut, and full attendance history with filters (today / week / month / custom / year)
- Attendance percentage per student, automatically calculated
- Fees: monthly fee tracking, payment recording (Cash / UPI / Bank Transfer / Other), pending/overpaid calculation
- Student, Attendance, and Fees reports — printable / savable as PDF
- Dashboard with quick actions and reminders (pending fees, incomplete attendance)
- Global search across students, IDs, parent names and phone numbers
- Backup to a JSON file and restore from a JSON file
- CSV export for students, attendance and payments (opens in Excel/Sheets)
- Demo data you can load and remove for testing
- Clear-all-data option with strong confirmation
- Installable on Android as a standalone app
- Works fully offline after the first visit
- 100% free — no subscription, no trial period, no ads, no artificial limits

## 3. Technologies used

- HTML5, CSS3, Bootstrap 5 (styling and modals)
- Vanilla JavaScript (no frameworks, no build step)
- IndexedDB for on-device storage
- A Service Worker for offline caching (PWA)

No backend, server, or cloud database is used anywhere in this project.

## 4. How IndexedDB works (in this app)

The browser has a small built-in database engine called IndexedDB.
Tuition Manager creates one database, `TuitionManagerDB`, with four stores:

- `settings` — your tuition center's configuration (one record)
- `students` — one record per student
- `attendance` — one record per student per date
- `payments` — one record per payment received

All of this lives inside your browser/phone's storage. Nothing is sent to
any server. See `js/db.js` for the full implementation.

## 5. How to run locally

You need a simple local web server (service workers and IndexedDB don't
always behave correctly when opening `index.html` directly with
`file://`). Any of these work:

```bash
# Option A: Python (already installed on most systems)
cd tuition-manager
python3 -m http.server 8000
# then open http://localhost:8000 in your browser

# Option B: Node.js
npx serve tuition-manager
```

## 6. How to deploy to GitHub Pages

1. Create a free GitHub account if you don't have one.
2. Create a new repository, e.g. named `tuition-manager`.
3. Upload all the files in this project (keeping the folder structure) to
   that repository.
4. Go to **Repository → Settings → Pages**.
5. Under "Build and deployment", select **Deploy from a branch**.
6. Select branch **main** and folder **/ (root)**.
7. Click **Save**.
8. Wait a minute or two for GitHub to deploy the site.

Your app will be available at:

```
https://YOUR-USERNAME.github.io/tuition-manager/
```

(Replace `YOUR-USERNAME` with your actual GitHub username.) All file paths
in this project are relative, so it works correctly even though GitHub
Pages hosts your project in a sub-folder rather than at the root domain.

## 7. How to install as a PWA on Android

1. Open your GitHub Pages URL in Chrome on your Android phone.
2. Wait for the page to fully load.
3. Tap the Chrome menu (⋮) in the top-right corner.
4. Tap **"Install app"** or **"Add to Home screen"** (the exact wording
   depends on your Android/Chrome version).
5. Confirm the install.
6. Open **Tuition Manager** from your phone's home screen — it will now
   behave like a normal app, with its own icon and no browser address bar.

## 8. How to add students

Go to **Students → + Add Student**, fill in the student's name (required)
and any optional details (parent name/phone, monthly fee, joining date,
notes), then tap **Save Student**.

## 9. How to mark attendance

Go to **Attendance**. Today's date is selected automatically. Tap
**Mark All Present**, then tap **Absent** for any students who are not
present, and tap **Save Attendance**. You can change the date to mark or
edit attendance for a different day at any time.

## 10. How to record fees

Go to **Fees → + Add Payment**, choose the student, enter the amount, date
and payment mode, then tap **Save Payment**. The student's pending balance
updates immediately.

## 11. How to generate reports

Go to **Reports**. Choose the **Student** tab for an individual,
parent-ready report, or the **Attendance** / **Fees** tabs for
center-wide summaries with month/year filters. Use **Print Report** to
print it or save it as a PDF using your browser's built-in "Save as PDF"
option in the print dialog.

## 12. How backup works

Go to **Settings → Backup All Data**. This downloads a JSON file named
`tuition-manager-backup-YYYY-MM-DD.json` containing all your settings,
students, attendance and payment records.

## 13. How restore works

Go to **Settings → Restore from Backup**, and select a previously saved
backup JSON file. You'll be asked to confirm, since restoring **replaces**
all current data on the device. The app validates the file before
importing it and shows an error if it is not a valid Tuition Manager
backup.

## 14. How to move data to a new phone

- **Old phone:** Settings → Backup All Data
- **New phone:** Install Tuition Manager → Settings → Restore from Backup
  → select the backup file

## 15. Privacy & limitations

This is a **local-only** application. Student, attendance and fee data is
stored only in the browser storage of the specific device/browser you are
using — it is never uploaded anywhere. GitHub Pages only hosts the
application's code (the HTML/CSS/JS files); it does not store or see your
data.

Because of this:

- If you use the app on two different phones, they will **not**
  automatically share data. Use Backup/Restore to move data between
  devices.
- If you reset your phone or clear your browser's site data without
  backing up first, your data will be lost. Please take regular backups
  (Settings → Backup All Data).
- Building a shared, always-in-sync, multi-device version would require a
  backend/cloud database, which is intentionally **not** part of this
  project so it can remain free and simple.

## 16. Offline functionality

After your first successful visit, a service worker caches the app's
files. From then on, you can add students, mark attendance, record
payments, search, view reports, and back up/restore data — all without an
internet connection, because your data lives in IndexedDB on your device.

## 17. GitHub Pages limitations

GitHub Pages is a static file host — it serves your HTML/CSS/JS files
exactly as uploaded. It cannot run a backend, so all logic in this app
runs entirely in the browser. This is by design.

---

## Project structure

```
tuition-manager/
├── index.html          Dashboard + first-time setup
├── students.html        Student list, add/edit, profile
├── attendance.html      Mark attendance + history
├── fees.html             Fee summaries + payments
├── reports.html          Student / Attendance / Fees reports
├── settings.html         Center info, backup/restore, demo data
├── css/style.css
├── js/
│   ├── app.js            App shell: nav, header, setup, dashboard
│   ├── db.js              IndexedDB wrapper (all data access)
│   ├── utils.js           Formatting, date & fee-calculation helpers
│   ├── students.js
│   ├── attendance.js
│   ├── fees.js
│   ├── reports.js
│   ├── backup.js          Backup / restore / demo data / clear data
│   └── settings.js
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
├── manifest.json
├── service-worker.js
└── README.md
```

## License

Free to use, modify and share for any tuition center.
