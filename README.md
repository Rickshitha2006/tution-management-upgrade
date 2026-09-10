# 🎓 Tuition Manager

> **A simple, secure and cloud-synced tuition management PWA for managing students, attendance and fees from any device.**

Tuition Manager is a lightweight Progressive Web App (PWA) designed to replace a traditional tuition teacher's paper notebook with a simple digital system.

The application allows you to manage **students, daily attendance, attendance history, attendance marking times, fees, reports and backups** from a phone or computer.

The latest version adds **account login, Cloudflare cloud storage and cross-device synchronization** while keeping the original application UI and user experience unchanged.

---

## ✨ What's New

The latest version upgrades the original local-only application with cloud functionality.

### ☁️ Cloud Sync

* Cloud-based student data
* Cloud-based attendance records
* Cloud-based fee records
* Data synchronized across multiple devices
* Same account can be used on different phones/computers
* Data remains available after changing devices

### 🔐 Account Login

* Secure user account login
* Passwords are securely handled
* Each account has its own separate data
* Users cannot access another user's records

### 🕐 Attendance Timestamp

Attendance now records the **exact time when a student is marked Present**.

Example:

```text
Arun
Present
10 Sep 2026 • 5:42 PM
```

This makes it easier to identify students who arrive early or late.

**Important:** Attendance timestamps are shown only inside the application's Attendance History. They are **not included in Excel/CSV exports**.

### 📱 Multi-Device Support

The same account can be used on multiple devices.

For example:

```text
Phone 1
   ↓
Login
   ↓
Add Student
   ↓
Mark Attendance
   ↓
Cloudflare D1
   ↑
   │
Phone 2
   ↑
Login with same account
   ↑
Same data
```

Changes made on one device can be accessed from another device using the same account.

---

# 🎯 1. What is Tuition Manager?

Tuition Manager is a simple digital register for tuition teachers.

Instead of maintaining:

* Student notebooks
* Attendance notebooks
* Fee notebooks
* Separate backup files

everything can be managed from one application.

The application is designed to remain **simple and easy to use**, similar to maintaining a physical tuition register.

---

# 🚀 2. Features

## 👨‍🎓 Student Management

* Add students
* Edit student details
* Delete students
* Search students
* View student profiles
* Parent information
* Phone numbers
* Monthly fee
* Joining date
* Notes
* Student status

---

## 📝 Attendance Management

* Daily attendance
* Mark Present / Absent
* Mark All Present
* Edit attendance
* Attendance history
* Attendance percentage
* Today / Week / Month / Custom / Year filters
* Attendance records synchronized to the cloud

### 🕐 Attendance Marking Time

Whenever a student is marked **Present**, the application records the actual time.

Example:

```text
10 Sep 2026
Arun       Present     5:42 PM
Rahul      Present     6:18 PM
Priya      Present     5:35 PM
```

This makes it easy to identify late arrivals.

The timestamp:

* Is stored securely in the cloud
* Appears in Attendance History
* Synchronizes across devices
* Is not included in Excel/CSV exports

---

# 💰 3. Fee Management

Manage tuition fee payments from one place.

Features include:

* Monthly fee tracking
* Record payments
* Cash
* UPI
* Bank Transfer
* Other payment methods
* Paid / Pending status
* Pending balance
* Overpaid calculation
* Payment history
* Fee reports

---

# 📊 4. Reports

Generate useful reports for tuition management.

Available reports include:

### Student Reports

View individual student information and payment/attendance details.

### Attendance Reports

View attendance summaries with date and month/year filters.

### Fee Reports

View payment and pending-fee information.

Reports can be printed or saved as PDF using the browser's print functionality.

---

# 🔎 5. Global Search

Search across important student information including:

* Student name
* Student ID
* Parent name
* Phone number

---

# 💾 6. Backup & Restore

The application includes data management tools inside Settings.

### Backup

Create a backup of your tuition data.

### Restore

Restore previously backed-up data when required.

### Export Data

Export tuition information in the existing supported format.

### Load Data

Import previously exported data.

### Clear All Data

Remove the current account's data after confirmation.

### Demo Data

Load demo records for testing.

Demo data can also be removed when testing is complete.

---

# ☁️ 7. Cloud Architecture

The latest version uses Cloudflare for the backend.

```text
                    ┌──────────────────┐
                    │     User Device  │
                    │   Phone/Desktop  │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Cloudflare Pages │
                    │    Frontend      │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Cloudflare Worker│
                    │   API + Auth     │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  Cloudflare D1   │
                    │   Cloud Database │
                    └──────────────────┘
```

### Technologies

* HTML5
* CSS3
* Bootstrap 5
* Vanilla JavaScript
* Cloudflare Pages
* Cloudflare Workers
* Cloudflare D1
* Progressive Web App (PWA)

---

# 🔐 8. Data Security

Each user account has its own data.

The backend verifies authentication before allowing access to:

* Students
* Attendance
* Attendance timestamps
* Fees
* Backups
* Other account data

User passwords are not stored as plain text.

Cloudflare credentials and private secrets are not exposed in the frontend.

---

# 📱 9. Multi-Device Usage

You can use the same account on multiple devices.

### Example

On Device 1:

```text
Login
↓
Add Arun
↓
Monthly Fee: ₹500
↓
Mark Present
↓
Attendance Time: 5:42 PM
```

On Device 2:

```text
Login with same account
↓
Arun appears
↓
₹500 fee appears
↓
Present appears
↓
5:42 PM appears in Attendance History
```

If attendance or fee information is changed on one device, the updated cloud data can be accessed from the other device.

---

# 📤 10. Excel / CSV Export

The application supports data export for use with:

* Microsoft Excel
* Google Sheets
* Other spreadsheet applications

### Important

Attendance marking timestamps are **not exported**.

For example, the application may display:

```text
Arun | Present | 5:42 PM
```

inside Attendance History.

But the exported data remains:

```text
Date | Student | Attendance
10 Sep 2026 | Arun | Present
```

There is no timestamp column.

This keeps the existing export format clean and compatible.

---

# 📲 11. Progressive Web App

Tuition Manager is an installable PWA.

It can be installed on supported mobile and desktop devices.

After installation, it can appear like a normal application on the device.

### Android

1. Open the live application in Chrome.
2. Open the browser menu.
3. Select **Install App** or **Add to Home Screen**.
4. Confirm installation.
5. Launch Tuition Manager from the home screen.

---

# 🌐 12. Deployment

The project source code is maintained on GitHub.

The recommended production architecture is:

```text
GitHub
   ↓
Cloudflare Pages
   ↓
Cloudflare Worker
   ↓
Cloudflare D1
```

GitHub is used for source-code management and version control.

Cloudflare provides the application hosting and cloud backend.

---

# 🛠️ 13. Local Development

Clone the repository:

```bash
git clone https://github.com/Rickshitha2006/tution-management-upgrade.git
```

Enter the project:

```bash
cd tution-management-upgrade
```

For the frontend, a simple local web server can be used.

### Python

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

For Cloudflare Worker development, use the Cloudflare development tools/configuration included in the project.

---

# 📁 14. Project Structure

The project structure may vary slightly as the cloud backend is integrated, but the main architecture is:

```text
tution-management-upgrade/
│
├── index.html
├── students.html
├── attendance.html
├── fees.html
├── reports.html
├── settings.html
│
├── css/
│   └── style.css
│
├── js/
│   ├── app.js
│   ├── db.js
│   ├── utils.js
│   ├── students.js
│   ├── attendance.js
│   ├── fees.js
│   ├── reports.js
│   ├── backup.js
│   └── settings.js
│
├── worker/
│   ├── src/
│   │   └── ...
│   ├── migrations/
│   │   └── ...
│   └── wrangler.toml
│
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
│
├── manifest.json
├── service-worker.js
├── DEPLOYMENT.md
└── README.md
```

The exact structure should follow the current implementation.

---

# 🔄 15. Original Local Storage

The original version of Tuition Manager used browser-based IndexedDB storage.

The upgraded version introduces cloud storage through Cloudflare D1.

Existing local data should be migrated safely when moving to the cloud version.

The application should never silently delete existing tuition records during migration.

---

# ⚙️ 16. Settings

The existing Settings functionality is preserved.

Settings includes functionality such as:

* Center information
* Staff information
* Backup
* Restore
* Export Data
* Load Data
* Clear All Data
* Load Demo Data
* Remove Demo Data

These features continue to operate for the currently authenticated account.

**Clear All Data only affects the logged-in user's data.**

---

# 🎨 17. UI & Design

The application's original interface is intentionally preserved.

The upgrade does **not** replace the original design with a new dashboard.

The following remain consistent:

* Green and white theme
* Navigation
* Cards
* Buttons
* Forms
* Icons
* Typography
* Spacing
* Attendance interface
* Fee interface
* Student interface
* Settings interface
* Mobile responsiveness
* Desktop responsiveness

The main additions are:

* Account login
* Cloud synchronization
* Multi-device access
* Attendance marking timestamp

---

# 📡 18. Internet & Cloud Sync

The original application was designed around local/offline storage.

The upgraded version uses cloud synchronization for shared multi-device data.

An internet connection is required when communicating with the cloud backend.

The application should never falsely indicate that a cloud change has synchronized when the device is offline.

---

# 🧪 19. Testing

Important functionality to test before daily use:

### Authentication

* Registration
* Login
* Logout
* Invalid login
* Session handling

### Students

* Add
* Edit
* Delete
* Search
* Sort
* Filter

### Attendance

* Present
* Absent
* Mark All Present
* Attendance history
* Date filters
* Attendance percentage
* Attendance timestamp

### Fees

* Add payment
* Paid
* Pending
* Payment history
* Fee calculations

### Settings

* Export
* Load
* Restore
* Clear All Data
* Load Demo Data
* Remove Demo Data

### Multi-device

* Login on Device 1
* Add student
* Mark attendance
* Verify timestamp
* Login on Device 2
* Verify the same student/data
* Modify data on Device 2
* Verify the update on Device 1

---

# 💡 20. Example Daily Workflow

A typical tuition session can be managed like this:

### Before Class

Open Tuition Manager.

```text
Dashboard
↓
Attendance
↓
Mark All Present
```

### During Class

Mark students who are absent.

The application records the time when each Present attendance is marked.

Example:

```text
Arun       Present     5:35 PM
Rahul      Present     5:48 PM
Priya      Present     6:12 PM
Kavin      Absent
```

This makes late arrivals easy to identify from Attendance History.

### Fee Collection

```text
Fees
↓
Add Payment
↓
Select Student
↓
Enter Amount
↓
Select Payment Mode
↓
Save
```

### End of Month

Use:

```text
Reports
↓
Attendance / Fees
```

and export or print the required information.

---

# 🆓 21. Cost

The project is designed to operate using free-tier services and does not require:

* Paid hosting
* Paid database
* Monthly subscription
* MongoDB
* Render
* Supabase
* Firebase

Actual free-tier limits and provider policies can change over time, so production usage should remain within the applicable Cloudflare limits.

---

# 🔮 22. Future Improvements

Possible future features include:

* Parent notifications
* WhatsApp-ready payment reminders
* More detailed late-arrival reports
* Monthly attendance summaries
* Fee reminders
* Additional reporting
* Custom domain
* Additional staff accounts

These can be added without changing the core purpose of the application.

---

# 👩‍💻 23. Project Purpose

Tuition Manager was created to solve a simple real-world problem:

> **Replacing paper-based tuition records with an easy-to-use digital system.**

Instead of maintaining separate notebooks for:

* Students
* Attendance
* Fees
* Payments
* Reports

Tuition Manager brings these everyday tasks into one simple application.

The cloud upgrade extends this idea by allowing the same account and data to be used across multiple devices.

---

# 📌 24. Repository

GitHub Repository:

https://github.com/Rickshitha2006/tution-management-upgrade

---

# 📄 License

Free to use, modify and share for tuition management purposes.

---

## ⭐ Tuition Manager

**Simple. Digital. Cloud-synced. Built for everyday tuition management.**
