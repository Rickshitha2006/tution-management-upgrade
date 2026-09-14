/* ==========================================================================
   Tuition Manager — app.js
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
 * Injects the bottom navigation bar into #tmBottomNav (if present on the page)
 * and highlights the current page.
 */
function tmRenderBottomNav(activePage) {
  const container = document.getElementById("tmBottomNav");
  if (!container) return;

  const base = tmBasePath();
  const items = [
    { key: "home", label: "Home", icon: "🏠", href: "index.html" },
    { key: "students", label: "Students", icon: "👨‍🎓", href: "students.html" },
    { key: "attendance", label: "Attendance", icon: "📅", href: "attendance.html" },
    { key: "fees", label: "Fees", icon: "💰", href: "fees.html" },
    { key: "reports", label: "Reports", icon: "📊", href: "reports.html" },
  ];

  container.innerHTML = items
    .map((item) => {
      const activeClass = item.key === activePage ? "active" : "";
      return `<a href="${base}${item.href}" class="${activeClass}">
        <span class="icon">${item.icon}</span>
        <span>${item.label}</span>
      </a>`;
    })
    .join("");
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
    if (nameEl) nameEl.textContent = settings.tuitionCenterName || "Tuition Manager";
    if (staffEl) staffEl.textContent = settings.staffName ? "Staff: " + settings.staffName : "";
  } else {
    if (nameEl) nameEl.textContent = "Tuition Manager";
  }
  return settings;
}

/**
 * For pages other than index.html: if setup has not been completed yet,
 * redirect the user back to the setup screen.
 */
async function tmRequireSetup() {
  if (!TMAuth.isLoggedIn()) {
    tmGoToLogin();
    return null;
  }
  const settings = await TMDB.getSettings();
  if (!settings || !settings.setupComplete) {
    window.location.href = tmBasePath() + "index.html";
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

/* ---------------------------- Dashboard (index.html) ---------------------------- */

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
  const [students, allAttendance, allPayments] = await Promise.all([
    TMDB.getAllStudents(),
    TMDB.getAllAttendance(),
    TMDB.getAllPayments(),
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

  // Reminder cards
  const remindersEl = document.getElementById("tmReminders");
  const reminders = [];
  if (activeStudents.length > 0 && todayAttendance.length < activeStudents.length) {
    reminders.push(
      `<div class="tm-card"><strong>📅 Attendance</strong><p class="mb-0 tm-muted">Today's attendance has not been completed.</p></div>`
    );
  }
  remindersEl.innerHTML = reminders.length
    ? reminders.join("")
    : `<div class="tm-card tm-muted">All caught up. 🎉</div>`;

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
          <span class="name">${tmEscapeHtml(student ? student.name : "Unknown student")}</span>
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
            <span class="name">${tmEscapeHtml(student.name)}</span>
            ${badge}
          </div>
        </div>`;
      })
      .join("");
  }
}
