# 🎓 Smart Academy System

### A Smarter Way to Manage Your Academy

Smart Academy System is a modern, cloud-based academy management application designed to simplify everyday tuition and coaching centre operations.

It replaces traditional paper-based record keeping with a digital platform where administrators can manage students, attendance, fees, staff records, salary details, and reports from a single application.

Built as a Progressive Web App (PWA), it works across mobile phones, tablets, and desktop devices.

---

## ✨ Key Features

### 👨‍🎓 1. Student Management
- Add, edit, and delete student records.
- Maintain student and parent details.
- Store contact numbers, joining dates, and monthly fees.
- Search and manage student information.
- Track individual student profiles and status.

### 📝 2. Attendance Management
- Record daily student attendance.
- Mark students as Present or Absent.
- Mark all students present at once.
- View attendance history.
- Calculate attendance percentages.
- Filter records by day, week, month, year, or custom date.
- Record the exact time when a student is marked Present.

### 💰 3. Fee Management
- Track monthly tuition fees.
- Record student payments.
- Support Cash, UPI, Bank Transfer, and other payment methods.
- Monitor paid and pending fees.
- Calculate remaining balances and overpayments.
- View individual payment histories.

### 👩‍🏫 4. Staff Management
- Maintain teacher and staff information.
- Record daily staff attendance.
- Track Present, Half Day, Absent, and Leave statuses.
- Manage monthly salary records.
- Calculate salary adjustments using bonuses and advances.
- Track paid and pending salaries.
- Export salary records to CSV.
- Generate PDF salary slips.

### 📊 5. Reports & Analytics
- Student reports.
- Attendance summaries.
- Fee collection reports.
- Pending payment details.
- Staff attendance summaries.
- Salary reports.
- Print reports or save them as PDF.

### 🔍 6. Global Search
Quickly find important records using:
- Student name.
- Student ID.
- Parent name.
- Phone number.

### ☁️ 7. Cloud Storage & Synchronization
- Store records using Cloudflare D1.
- Synchronize data across multiple devices.
- Access the same account from different devices.
- Keep each user's records separate.
- Retrieve saved information after logging in again.

### 🔐 8. Authentication & Data Security
- Account registration and login.
- Password handling through the backend.
- Separate data for each user account.
- Authentication checks for protected operations.
- Private backend credentials are not exposed in frontend code.

### 💾 9. Backup & Restore
- Create backups of academy records.
- Restore previously saved data.
- Export and load data.
- Clear account data when required.
- Load demo records for testing.

### 📱 10. Progressive Web App
- Installable on supported devices.
- Mobile-friendly interface.
- Responsive desktop layout.
- App-like experience through the browser.
- Service worker support.

---

## 🛠️ Technology Stack

| Technology | Purpose |
|---|---|
| HTML5 | Page structure |
| CSS3 | Styling and layouts |
| Bootstrap 5 | Responsive UI components |
| JavaScript | Application functionality |
| Cloudflare Pages | Frontend hosting |
| Cloudflare Workers | Backend API |
| Cloudflare D1 | Cloud database |
| Progressive Web App | Installable application |
| Service Worker | Application caching |

---

## 🏗️ System Architecture

The application follows a cloud-based architecture.

```text
        User Device
       Mobile / Desktop
              |
              v
      Cloudflare Pages
          Frontend
              |
              v
      Cloudflare Workers
        Backend API
       Authentication
              |
              v
        Cloudflare D1
        Cloud Database
```

Each account accesses its own records through the authenticated backend.

---

## 📂 Project Structure

```text
tution-management-upgrade/
│
├── index.html
├── dashboard.html
├── login.html
├── students.html
├── attendance.html
├── fees.html
├── staff.html
├── reports.html
├── holidays.html
├── settings.html
├── reset-password.html
│
├── css/
│
├── js/
│
├── worker/
│   ├── src/
│   ├── migrations/
│   └── wrangler.toml
│
├── icons/
│
├── manifest.json
├── service-worker.js
│
├── DEPLOYMENT.md
├── FREE-HOSTING.md
├── EMAIL-SETUP.md
└── README.md
```

---

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/Rickshitha2006/tution-management-upgrade.git
```

### 2. Navigate to the Project

```bash
cd tution-management-upgrade
```

### 3. Run the Frontend Locally

Make sure Python is installed.

```bash
python -m http.server 8090
```

### 4. Open in Browser

Visit:

```text
http://localhost:8090
```

The public landing page is `index.html`, and the application dashboard is `dashboard.html`.

### 5. Configure the Backend

The cloud backend requires Cloudflare configuration.

Refer to these project guides:

- `DEPLOYMENT.md` – Backend and deployment instructions.
- `FREE-HOSTING.md` – Cloudflare hosting setup.
- `EMAIL-SETUP.md` – Email password-reset configuration.

**Note:** Running the frontend locally does not automatically configure the Cloudflare backend. Complete the backend setup before using cloud-based features.

---

## ☁️ Cloud Deployment

The recommended deployment architecture is:

1. Push the source code to GitHub.
2. Deploy the frontend using Cloudflare Pages.
3. Configure the Cloudflare Worker.
4. Create and configure the Cloudflare D1 database.
5. Apply the required database migrations.
6. Configure authentication and application secrets.
7. Test login, student records, attendance, fees, and staff operations.

Refer to `DEPLOYMENT.md` for the complete setup procedure.

---

## 🔒 Data Privacy

Smart Academy follows an account-based data separation approach.

- Each account has its own records.
- Backend authentication protects account-specific operations.
- Users should only access their own academy information.
- Private credentials should remain in backend environment settings.
- Cloud synchronization requires an internet connection.

---

## 🎯 Project Objective

The main objective of Smart Academy System is to make tuition centre administration easier, faster, and more organized.

Instead of maintaining separate notebooks and spreadsheets for students, attendance, fees, staff, and salaries, everything can be managed through one centralized digital platform.

The project combines a simple user experience with cloud-based storage to support everyday academy operations.

---

## 🔮 Future Enhancements

- Automated fee reminders.
- WhatsApp notifications.
- Parent communication portal.
- Advanced attendance analytics.
- More detailed financial reports.
- Additional staff management options.
- Improved backup and recovery features.

---

## 👩‍💻 Developer

**Rickshitha A**

B.Sc. Computer Science with Artificial Intelligence

GitHub: [@Rickshitha2006](https://github.com/Rickshitha2006)

**Project Repository:**  
https://github.com/Rickshitha2006/tution-management-upgrade

---

⭐ If you find this project useful, consider giving the repository a star!

**Smart Academy System — Manage Smarter. Teach Better.**
