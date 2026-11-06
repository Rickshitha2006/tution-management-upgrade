/* ==========================================================================
   Tuition Manager — db.js  (Cloudflare-backed)
   ==========================================================================
   This file used to be a promise-based wrapper around IndexedDB. It has
   been upgraded to talk to the Cloudflare Worker API (see /worker) so the
   same account's data is shared across devices, but every method name and
   return shape is UNCHANGED — students.js, attendance.js, fees.js,
   reports.js, backup.js, settings.js and app.js all call TMDB exactly as
   they did before and did not need to be rewritten.

   Cloud writes require an internet connection (see README/DEPLOYMENT —
   this is a deliberate simplicity trade-off). Reads are cached in memory
   for the lifetime of the page and mirrored into localStorage so the app
   can still show last-known data if a page loads while briefly offline.

   The pre-cloud implementation of this file (IndexedDB-based) now lives
   at js/legacy-local-db.js, used only by js/migrate.js to import any
   pre-existing on-device data into the cloud account on first login.
   ========================================================================== */

const TM_TOKEN_KEY = "tm_auth_token";
const TM_USER_KEY = "tm_auth_user";
const TM_OFFLINE_CACHE_KEY = "tm_offline_cache_v1";

/* ---------------------------- auth/session helpers ---------------------------- */

const TMAuth = {
  getToken() {
    return localStorage.getItem(TM_TOKEN_KEY);
  },
  getUser() {
    try {
      return JSON.parse(localStorage.getItem(TM_USER_KEY) || "null");
    } catch {
      return null;
    }
  },
  isLoggedIn() {
    return !!TMAuth.getToken();
  },
  setSession(token, user) {
    localStorage.setItem(TM_TOKEN_KEY, token);
    localStorage.setItem(TM_USER_KEY, JSON.stringify(user));
  },
  clearSession() {
    localStorage.removeItem(TM_TOKEN_KEY);
    localStorage.removeItem(TM_USER_KEY);
    localStorage.removeItem(TM_OFFLINE_CACHE_KEY);
  },

  async register(email, password) {
    const data = await tmApiFetch("/api/auth/register", { method: "POST", body: { email, password }, skipAuth: true });
    TMAuth.setSession(data.token, data.user);
    // The recovery code is returned ONLY here and is never stored in the browser.
    return { ...data.user, recoveryCode: data.recoveryCode };
  },

  async login(email, password) {
    const data = await tmApiFetch("/api/auth/login", { method: "POST", body: { email, password }, skipAuth: true });
    TMAuth.setSession(data.token, data.user);
    return data.user;
  },

  async authOptions() {
    try {
      return await tmApiFetch("/api/auth/options", { skipAuth: true });
    } catch {
      return { recoveryCode: true, emailReset: false };
    }
  },

  /** Sets a new password using the recovery code. Returns { recoveryCode } — a NEW code to save. */
  async recoverWithCode(email, recoveryCode, password) {
    return tmApiFetch("/api/auth/recover", { method: "POST", body: { email, recoveryCode, password }, skipAuth: true });
  },

  /** Logged in: makes a new recovery code (needs the current password). */
  async newRecoveryCode(password) {
    return tmApiFetch("/api/auth/recovery-code", { method: "POST", body: { password } });
  },

  async forgotPassword(email) {
    return tmApiFetch("/api/auth/forgot", { method: "POST", body: { email }, skipAuth: true });
  },

  async resetPassword(token, password) {
    return tmApiFetch("/api/auth/reset", { method: "POST", body: { token, password }, skipAuth: true });
  },

  async logout() {
    try {
      await tmApiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore network errors on logout — we clear the local session regardless */
    }
    TMAuth.clearSession();
  },
};

/**
 * Redirects to the login page, preserving the page the user was on so we
 * can send them back after they sign in.
 */
function tmGoToLogin() {
  const base = typeof tmBasePath === "function" ? tmBasePath() : "./";
  const here = window.location.pathname.split("/").pop() || "dashboard.html";
  if (here !== "login.html") {
    window.location.href = base + "login.html?next=" + encodeURIComponent(here);
  }
}

/**
 * Low-level fetch wrapper: attaches the bearer token, sends/parses JSON,
 * and sends the user back to login.html if the session is missing/expired.
 */
async function tmApiFetch(path, options = {}) {
  if (typeof TM_API_BASE === "undefined" || !TM_API_BASE || TM_API_BASE.includes("YOUR-SUBDOMAIN")) {
    throw new Error("Cloud backend is not configured yet — edit js/config.js with your deployed Worker URL.");
  }

  const headers = { "Content-Type": "application/json" };
  if (!options.skipAuth) {
    const token = TMAuth.getToken();
    if (!token) {
      tmGoToLogin();
      throw new Error("Not logged in.");
    }
    headers.Authorization = "Bearer " + token;
  }

  let response;
  try {
    response = await fetch(TM_API_BASE + path, {
      method: options.method || "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (networkErr) {
    throw new Error("Could not reach the cloud server. Check your internet connection and try again.");
  }

  if (response.status === 401 && !options.skipAuth) {
    TMAuth.clearSession();
    tmGoToLogin();
    throw new Error("Session expired. Please log in again.");
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    /* no body */
  }

  if (!response.ok) {
    throw new Error((data && data.error) || "Request failed (" + response.status + ").");
  }
  return data;
}

/* ---------------------------- tiny offline read cache ---------------------------- */
// Not a sync engine — just remembers the last successful GET of each
// collection so the app has *something* to show if opened offline.
// Cloud writes still require a connection (tmApiFetch throws otherwise).

function tmReadOfflineCache() {
  try {
    return JSON.parse(localStorage.getItem(TM_OFFLINE_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function tmWriteOfflineCache(key, value) {
  const cache = tmReadOfflineCache();
  cache[key] = value;
  try {
    localStorage.setItem(TM_OFFLINE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* storage full/unavailable — safe to ignore, this is best-effort only */
  }
}

async function tmFetchWithOfflineFallback(cacheKey, path) {
  try {
    const data = await tmApiFetch(path);
    tmWriteOfflineCache(cacheKey, data);
    return data;
  } catch (err) {
    const cache = tmReadOfflineCache();
    if (cache[cacheKey] !== undefined) return cache[cacheKey];
    throw err;
  }
}

/* ---------------------------- TMDB — same interface as before ---------------------------- */

const TMDB = {
  /* ---------------------------- Settings ---------------------------- */

  getSettings() {
    return tmFetchWithOfflineFallback("settings", "/api/settings");
  },

  saveSettings(settings) {
    return tmApiFetch("/api/settings", { method: "PUT", body: settings });
  },

  /* ---------------------------- Students ---------------------------- */

  addStudent(student) {
    return tmApiFetch("/api/students", { method: "POST", body: student });
  },

  updateStudent(id, updates) {
    return tmApiFetch("/api/students/" + encodeURIComponent(id), { method: "PUT", body: updates });
  },

  deleteStudent(id) {
    return tmApiFetch("/api/students/" + encodeURIComponent(id), { method: "DELETE" });
  },

  getAllStudents() {
    return tmFetchWithOfflineFallback("students", "/api/students");
  },

  /* ---------------------------- Attendance ---------------------------- */

  getAttendanceForDate(date) {
    return tmApiFetch("/api/attendance?date=" + encodeURIComponent(date));
  },

  getAllAttendance() {
    return tmFetchWithOfflineFallback("attendance", "/api/attendance");
  },

  /**
   * Creates or updates a single attendance record for a student/date pair.
   * The Worker stamps `markedAt` with the current time whenever the status
   * newly becomes "Present" (see worker/src/index.js) and returns the full
   * record, so callers get the timestamp back immediately — no extra
   * round trip needed.
   */
  markAttendance(studentId, date, status) {
    return tmApiFetch("/api/attendance", { method: "POST", body: { studentId, date, status } });
  },

  /* ---------------------------- Payments ---------------------------- */

  addPayment(payment) {
    return tmApiFetch("/api/payments", { method: "POST", body: payment });
  },

  deletePayment(id) {
    return tmApiFetch("/api/payments/" + encodeURIComponent(id), { method: "DELETE" });
  },

  getAllPayments() {
    return tmFetchWithOfflineFallback("payments", "/api/payments");
  },

  /* ---------------------------- Staff (attendance + salary sheet) ---------------------------- */

  getAllStaff() {
    return tmFetchWithOfflineFallback("staff", "/api/staff");
  },

  addStaff(member) {
    return tmApiFetch("/api/staff", { method: "POST", body: member });
  },

  updateStaff(id, updates) {
    return tmApiFetch("/api/staff/" + encodeURIComponent(id), { method: "PUT", body: updates });
  },

  deleteStaff(id) {
    return tmApiFetch("/api/staff/" + encodeURIComponent(id), { method: "DELETE" });
  },

  getStaffAttendanceForDate(date) {
    return tmApiFetch("/api/staff-attendance?date=" + encodeURIComponent(date));
  },

  getStaffAttendanceForMonth(monthKey) {
    return tmApiFetch("/api/staff-attendance?month=" + encodeURIComponent(monthKey));
  },

  getAllStaffAttendance() {
    return tmFetchWithOfflineFallback("staffAttendance", "/api/staff-attendance");
  },

  /** records: [{ staffId, status }] where status is Present | Half Day | Absent | Leave | "" (clear). */
  saveStaffAttendance(date, records) {
    return tmApiFetch("/api/staff-attendance", { method: "POST", body: { date, records } });
  },

  getStaffPayrollForMonth(monthKey) {
    return tmApiFetch("/api/staff-payroll?month=" + encodeURIComponent(monthKey));
  },

  getAllStaffPayroll() {
    return tmFetchWithOfflineFallback("staffPayroll", "/api/staff-payroll");
  },

  saveStaffPayroll(row) {
    return tmApiFetch("/api/staff-payroll", { method: "PUT", body: row });
  },

  deleteStaffPayroll(id) {
    return tmApiFetch("/api/staff-payroll/" + encodeURIComponent(id), { method: "DELETE" });
  },

  /* ---------------------------- Holiday calendar ---------------------------- */

  async getHolidays(from, to) {
    const q = from || to ? "?from=" + encodeURIComponent(from || "") + "&to=" + encodeURIComponent(to || "") : "";
    const list = await tmFetchWithOfflineFallback("holidays" + q, "/api/holidays" + q);
    return Array.isArray(list) ? list : [];   // an older backend without holidays must not break pages
  },

  /** holiday: { date | startDate+endDate, name, type, appliesTo, paidForStaff } */
  addHoliday(holiday) {
    return tmApiFetch("/api/holidays", { method: "POST", body: holiday });
  },

  updateHoliday(id, updates) {
    return tmApiFetch("/api/holidays/" + encodeURIComponent(id), { method: "PUT", body: updates });
  },

  deleteHoliday(id) {
    return tmApiFetch("/api/holidays/" + encodeURIComponent(id), { method: "DELETE" });
  },

  /* ---------------------------- Bulk / Backup ---------------------------- */

  async exportAllData() {
    const [settings, students, attendance, payments, staff, staffAttendance, staffPayroll, holidays] = await Promise.all([
      TMDB.getSettings(),
      TMDB.getAllStudents(),
      TMDB.getAllAttendance(),
      TMDB.getAllPayments(),
      TMDB.getAllStaff(),
      TMDB.getAllStaffAttendance(),
      TMDB.getAllStaffPayroll(),
      TMDB.getHolidays(),
    ]);
    return {
      appName: "Smart Academy System",
      exportVersion: 4,
      exportedAt: new Date().toISOString(),
      data: { settings, students, attendance, payments, staff, staffAttendance, staffPayroll, holidays },
    };
  },

  async restoreAllData(payload) {
    if (!payload || !payload.data) {
      throw new Error("Invalid backup file: missing 'data' section.");
    }
    const { settings, students, attendance, payments, staff, staffAttendance, staffPayroll, holidays } = payload.data;
    if (!Array.isArray(students) || !Array.isArray(attendance) || !Array.isArray(payments)) {
      throw new Error("Invalid backup file: students, attendance and payments must be lists.");
    }
    await tmApiFetch("/api/bulk/restore", { method: "POST", body: { settings, students, attendance, payments, staff, staffAttendance, staffPayroll, holidays } });
    return true;
  },

  async clearAllData() {
    await tmApiFetch("/api/bulk/clear", { method: "POST" });
    return true;
  },
};
