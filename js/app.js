/* ==========================================================================
   Smart Academy System — app.js
   Shared app-shell logic used on every page: service worker registration,
   bottom navigation, topbar branding, and first-time setup gating.
   ========================================================================== */

/**
 * Returns the base path this app is deployed under, so links, the
 * manifest and the service worker work correctly on GitHub Pages
 * subpaths like https://username.github.io/tuition-manager/.
 */
function tmBasePath() {
  const path = window.location.pathname;
  const dir = path.substring(0, path.lastIndexOf("/") + 1);
  return dir;
}

function tmRegisterServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register(tmBasePath() + "service-worker.js")
        .catch((err) => console.warn("Service worker registration failed:", err));
    });
  }
}

/**
 * Tries to push any queued offline attendance marks (see
 * tmFlushOfflineAttendanceQueue in js/utils.js) once when the page loads,
 * and again automatically whenever the browser regains a connection —
 * so a queued mark from a patchy-WiFi moment doesn't just sit there
 * until the user happens to revisit the Attendance page. Called on
 * every page (alongside tmRegisterServiceWorker) since connectivity can
 * come back while the user is anywhere in the app.
 */
function tmRegisterOfflineSync() {
  if (!TMAuth.isLoggedIn()) return;

  const trySync = () => {
    tmFlushOfflineAttendanceQueue().then((count) => {
      if (count > 0) tmToast(count + " queued attendance record(s) synced.");
      if (typeof tmRefreshOfflineQueueBanner === "function") tmRefreshOfflineQueueBanner();
    });
  };

  trySync();
  window.addEventListener("online", trySync);
}

/* Inline SVG icons (stroke-based, inherit the text colour). */
const TM_ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  students: '<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/>',
  attendance: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3"/><path d="m9 15 2 2 4-4"/>',
  fees: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1"/>',
  staff: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17.5" cy="9" r="2.4"/><path d="M17 14.5c2.4.2 4 1.9 4 4.5"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3"/><path d="M8 14h2M12 14h2M16 14h2M8 17h2M12 17h2"/>',
  reports: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  money: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1"/>',
};

/** Returns an inline <svg> string for a named icon. */
function tmIcon(name, size) {
  const px = size ? ` width="${size}" height="${size}"` : "";
  return `<svg class="tm-icon" viewBox="0 0 24 24"${px} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TM_ICONS[name] || ""}</svg>`;
}

/**
 * Injects the navigation into #tmBottomNav (if present on the page) and
 * highlights the current page. On phones it is a bottom tab bar; on
 * desktop the same element is styled as a left sidebar with the brand.
 */
function tmRenderBottomNav(activePage) {
  const container = document.getElementById("tmBottomNav");
  if (!container) return;

  const base = tmBasePath();
  const items = [
    { key: "home", label: "Home", icon: "home", href: "dashboard.html" },
    { key: "students", label: "Students", icon: "students", href: "students.html" },
    { key: "attendance", label: "Attendance", icon: "attendance", href: "attendance.html" },
    { key: "fees", label: "Fees", icon: "fees", href: "fees.html" },
    { key: "staff", label: "Staff", icon: "staff", href: "staff.html" },
    { key: "holidays", label: "Calendar", icon: "calendar", href: "holidays.html", hideMobile: true },
    { key: "reports", label: "Reports", icon: "reports", href: "reports.html" },
    { key: "settings", label: "Settings", icon: "settings", href: "settings.html", desktopOnly: true },
  ];

  const brand = `<div class="tm-nav-brand">
      <span class="tm-logo-mark">${tmIcon("students")}</span>
      <div><div class="title">Smart Academy</div><div class="sub">Management System</div></div>
    </div>`;

  container.innerHTML =
    brand +
    items
      .map((item) => {
        const cls = [item.key === activePage ? "active" : "", item.desktopOnly ? "desktop-only" : "", item.hideMobile ? "hide-mobile" : ""].filter(Boolean).join(" ");
        return `<a href="${base}${item.href}" class="${cls}">${tmIcon(item.icon)}<span>${item.label}</span></a>`;
      })
      .join("") +
    `<div class="tm-nav-footer">Your data is stored privately in your own account.</div>`;
}

/**
 * Loads settings and fills in any topbar elements with the tuition
 * center's name and staff name. Returns the settings object (or null).
 */
async function tmLoadHeaderInfo() {
  const settings = await TMDB.getSettings();
  const nameEl = document.getElementById("tmCenterName");
  const staffEl = document.getElementById("tmStaffName");
  if (settings) {
    if (nameEl) nameEl.textContent = settings.tuitionCenterName || "Smart Academy System";
    if (staffEl) staffEl.textContent = settings.staffName ? "Staff: " + settings.staffName : "";
    const greetEl = document.getElementById("tmHeroGreeting");
    if (greetEl) {
      const h = new Date().getHours();
      const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
      greetEl.textContent = part + (settings.staffName ? ", " + settings.staffName : "");
    }
    const dateEl = document.getElementById("tmHeroDate");
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  } else {
    if (nameEl) nameEl.textContent = "Smart Academy System";
  }
  return settings;
}

/**
 * For pages other than dashboard.html: if setup has not been completed yet,
 * redirect the user back to the setup screen.
 */
async function tmRequireSetup() {
  if (!TMAuth.isLoggedIn()) {
    tmGoToLogin();
    return null;
  }
  const settings = await TMDB.getSettings();
  if (!settings || !settings.setupComplete) {
    window.location.href = tmBasePath() + "dashboard.html";
    return null;
  }
  return settings;
}

/**
 * Some mobile browsers miscalculate (or don't support) 100dvh, which
 * can leave a modal's footer buttons below the visible screen — the
 * CSS in style.css handles most cases, but this JS fix is the
 * reliable fallback: it pins every open modal's height to the
 * viewport height actually visible right now (via the visualViewport
 * API where available, which also accounts for the on-screen
 * keyboard), on every page, on every device.
 */
function tmFixModalViewportHeights() {
  function apply() {
    const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.querySelectorAll(".modal.show .modal-content").forEach((el) => {
      el.style.maxHeight = Math.max(240, viewportHeight - 24) + "px";
    });
  }
  document.addEventListener("shown.bs.modal", apply);
  document.addEventListener("show.bs.modal", () => setTimeout(apply, 0));
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", apply);
    window.visualViewport.addEventListener("scroll", apply);
  }
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", () => setTimeout(apply, 300));
}
tmFixModalViewportHeights();

/* ---------------------------- Dashboard (dashboard.html) ---------------------------- */

async function tmInitDashboard() {
  if (!TMAuth.isLoggedIn()) {
    tmGoToLogin();
    return;
  }

  const settings = await TMDB.getSettings();

  const setupScreen = document.getElementById("tmSetupScreen");
  const dashboardScreen = document.getElementById("tmDashboardScreen");

  if (!settings || !settings.setupComplete) {
    setupScreen.classList.remove("d-none");
    dashboardScreen.classList.add("d-none");
    tmWireSetupForm();
    return;
  }

  setupScreen.classList.add("d-none");
  dashboardScreen.classList.remove("d-none");
  await tmLoadHeaderInfo();
  tmRenderBottomNav("home");
  await tmRenderDashboardStats();
}

function tmWireSetupForm() {
  const form = document.getElementById("tmSetupForm");
  if (!form) return;

  tmWireImagePreview("setupLogo", "setupLogoPreview", tmProcessLogoFile);
  tmWireImagePreview("setupHeadSignature", "setupHeadSignaturePreview", tmProcessSignatureFile);
  tmWireImagePreview("setupStaffSignature", "setupStaffSignaturePreview", tmProcessSignatureFile);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const centerName = document.getElementById("setupCenterName").value.trim();
    const staffName = document.getElementById("setupStaffName").value.trim();
    const contact = document.getElementById("setupContact").value.trim();
    const address = document.getElementById("setupAddress").value.trim();
    const headName = document.getElementById("setupHeadName").value.trim();

    if (!centerName || !staffName) {
      tmToast("Please enter the tuition center name and staff name.");
      return;
    }

    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;

    try {
      await TMDB.saveSettings({
        tuitionCenterName: centerName,
        staffName: staffName,
        contactNumber: contact,
        address: address,
        headName: headName,
        logoData: document.getElementById("setupLogoPreview").dataset.processed || "",
        headSignatureData: document.getElementById("setupHeadSignaturePreview").dataset.processed || "",
        staffSignatureData: document.getElementById("setupStaffSignaturePreview").dataset.processed || "",
        setupComplete: true,
      });

      tmToast("Setup complete. Welcome!");
      setTimeout(() => tmInitDashboard(), 400);
    } catch (err) {
      tmToast(err.message || "Could not save setup. Please try again.");
      submitBtn.disabled = false;
    }
  });
}

/**
 * Wires a file input + <img> preview pair: on file selection, runs the
 * image through the given processor (logo resize, or signature
 * background-removal+crop — see js/image-processing.js), shows the
 * processed result in the preview, and stashes the resulting data URL on
 * preview.dataset.processed so the caller can read it back at submit
 * time without reprocessing. Used on both the first-time setup form and
 * the Settings page.
 */
function tmWireImagePreview(inputId, previewId, processorFn) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  if (!input || !preview) return;

  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const dataUrl = await processorFn(file);
      preview.src = dataUrl;
      preview.dataset.processed = dataUrl;
      preview.classList.remove("d-none");
    } catch (err) {
      tmToast(err.message || "Could not process that image.");
      input.value = "";
    }
  });
}

async function tmRenderDashboardStats() {
  const [students, allAttendance, allPayments, staffList, staffToday, holidayList] = await Promise.all([
    TMDB.getAllStudents(),
    TMDB.getAllAttendance(),
    TMDB.getAllPayments(),
    TMDB.getAllStaff().catch(() => []),
    TMDB.getStaffAttendanceForDate(tmTodayStr()).catch(() => []),
    TMDB.getHolidays().catch(() => []),
  ]);

  const activeStudents = students.filter((s) => s.active !== false);
  const today = tmTodayStr();
  const todayAttendance = allAttendance.filter((a) => a.date === today);
  const todayPresent = todayAttendance.filter((a) => a.status === "Present").length;
  const todayAbsent = todayAttendance.filter((a) => a.status === "Absent").length;

  let totalCollected = 0;
  activeStudents.forEach((student) => {
    const studentPayments = allPayments.filter((p) => p.studentId === student.id);
    totalCollected += tmFeesSummary(student, studentPayments).totalPaid;
  });

  document.getElementById("statTotalStudents").textContent = activeStudents.length;
  document.getElementById("statTodayPresent").textContent = todayPresent;
  document.getElementById("statTodayAbsent").textContent = todayAbsent;
  document.getElementById("statFeesCollected").textContent = tmFormatCurrency(totalCollected);

  const activeStaff = staffList.filter((m) => m.active !== false);
  const staffIn = staffToday.filter((a) => a.status === "Present" || a.status === "Half Day").length;
  const staffTotalEl = document.getElementById("statActiveStaff");
  const staffInEl = document.getElementById("statStaffIn");
  if (staffTotalEl) staffTotalEl.textContent = activeStaff.length;
  if (staffInEl) staffInEl.textContent = staffIn + "/" + activeStaff.length;

  // Reminder cards
  const remindersEl = document.getElementById("tmReminders");
  const reminders = [];
  const todayStr = tmTodayStr();
  const studentHoliday = tmHolidayMap(holidayList, "students")[todayStr];
  const staffHoliday = tmHolidayMap(holidayList, "staff")[todayStr];
  const todayHoliday = studentHoliday || staffHoliday;
  if (todayHoliday) {
    reminders.push(
      `<div class="tm-card"><strong>Holiday today: ${tmEscapeHtml(todayHoliday.name)}</strong><p class="mb-0 tm-muted">${studentHoliday && staffHoliday ? "No classes and no staff attendance today." : studentHoliday ? "No classes today." : "Staff holiday today."} <a href="holidays.html">Open calendar</a></p></div>`
    );
  } else {
    const upcoming = holidayList.filter((h) => h.date > todayStr).sort((x, y) => x.date.localeCompare(y.date))[0];
    if (upcoming) {
      const days = Math.round((new Date(upcoming.date + "T00:00:00") - new Date(todayStr + "T00:00:00")) / 86400000);
      if (days <= 14) {
        reminders.push(
          `<div class="tm-card"><strong>Upcoming holiday: ${tmEscapeHtml(upcoming.name)}</strong><p class="mb-0 tm-muted">${tmFormatDate(upcoming.date)}, in ${days} day${days === 1 ? "" : "s"}. <a href="holidays.html">Open calendar</a></p></div>`
        );
      }
    }
  }
  if (!studentHoliday && activeStudents.length > 0 && todayAttendance.length < activeStudents.length) {
    reminders.push(
      `<div class="tm-card"><strong>Student attendance</strong><p class="mb-0 tm-muted">Today's attendance has not been completed. <a href="attendance.html">Mark it now</a></p></div>`
    );
  }
  if (!staffHoliday && activeStaff.length > 0 && staffToday.length < activeStaff.length) {
    reminders.push(
      `<div class="tm-card"><strong>Staff attendance</strong><p class="mb-0 tm-muted">Today's staff attendance has not been completed. <a href="staff.html?tab=attendance">Mark it now</a></p></div>`
    );
  }
  remindersEl.innerHTML = reminders.length
    ? reminders.join("")
    : `<div class="tm-card tm-muted">All caught up. Nothing needs your attention today.</div>`;

  // Recent payments list
  const recentPaymentsEl = document.getElementById("tmRecentPaymentsList");
  const studentMap = {};
  students.forEach((s) => (studentMap[s.id] = s));
  const recentPayments = allPayments.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);
  if (recentPayments.length === 0) {
    recentPaymentsEl.innerHTML = `<div class="tm-empty"><span class="emoji">💰</span>No payments recorded yet.</div>`;
  } else {
    recentPaymentsEl.innerHTML = recentPayments
      .map((p) => {
        const student = studentMap[p.studentId];
        return `
      <div class="tm-index-card">
        <div class="d-flex justify-content-between align-items-center">
          <span class="tm-name-row">${tmAvatar(student ? student.name : "?")}<span class="name">${tmEscapeHtml(student ? student.name : "Unknown student")}</span></span>
          <span class="tm-amount">${tmFormatCurrency(p.amount)}</span>
        </div>
        <div class="meta">${tmFormatDateShort(p.date)}</div>
      </div>`;
      })
      .join("");
  }

  // Today's attendance status list
  const todayListEl = document.getElementById("tmTodayAttendanceList");
  if (activeStudents.length === 0) {
    todayListEl.innerHTML = `<div class="tm-empty"><span class="emoji">👨‍🎓</span>No students added yet.</div>`;
  } else {
    todayListEl.innerHTML = activeStudents
      .slice(0, 8)
      .map((student) => {
        const record = todayAttendance.find((a) => a.studentId === student.id);
        let badge = `<span class="tm-badge neutral">Not marked</span>`;
        if (record && record.status === "Present") badge = `<span class="tm-badge success">Present</span>`;
        if (record && record.status === "Absent") badge = `<span class="tm-badge danger">Absent</span>`;
        return `<div class="tm-index-card">
          <div class="d-flex justify-content-between align-items-center">
            <span class="tm-name-row">${tmAvatar(student.name)}<span class="name">${tmEscapeHtml(student.name)}</span></span>
            ${badge}
          </div>
        </div>`;
      })
      .join("");
  }
}
