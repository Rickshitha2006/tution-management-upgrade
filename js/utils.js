/* ==========================================================================
   Tuition Manager — utils.js
   Shared helper functions used across all pages.
   ========================================================================== */

/* ---------------------------- Formatting ---------------------------- */

function tmFormatCurrency(amount) {
  const value = Number(amount) || 0;
  return "₹" + value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function tmFormatDate(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function tmFormatDateShort(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

/**
 * Formats an ISO 8601 UTC timestamp (as stored in the `markedAt` field of
 * an attendance record) as a local 12-hour clock time, e.g. "5:42 PM".
 * Returns "" for missing/invalid input so callers can skip rendering it
 * (used for legacy attendance records that predate this feature — see
 * worker/migrations/0001_init.sql).
 */
function tmFormatTime12h(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
}

function tmTodayStr() {
  return tmDateToStr(new Date());
}

function tmDateToStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function tmMonthLabel(year, monthIndex) {
  const d = new Date(year, monthIndex, 1);
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function tmMonthLabelShort(year, monthIndex) {
  const d = new Date(year, monthIndex, 1);
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

/**
 * "YYYY-MM" key for a given year/month-index (0-based month, like Date).
 */
function tmMonthKey(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function tmMonthKeyFromDateStr(dateStr) {
  return dateStr && dateStr.length >= 7 ? dateStr.slice(0, 7) : "";
}

function tmThisMonthKey() {
  const now = new Date();
  return tmMonthKey(now.getFullYear(), now.getMonth());
}

/**
 * Which month a payment counts against. Uses the explicit "forMonth"
 * a staff member picked (e.g. paying August's fee in September), and
 * falls back to the payment date's month for older records saved
 * before that field existed.
 */
function tmPaymentMonthKey(payment) {
  return payment.forMonth || tmMonthKeyFromDateStr(payment.date);
}

function tmFormatMonthKey(key) {
  if (!key) return "-";
  const [y, m] = key.split("-").map(Number);
  return tmMonthLabel(y, m - 1);
}

/**
 * Fee status for one student in one specific month, derived only from
 * data the app already has (monthlyFee + payments tagged for that month
 * via tmPaymentMonthKey) — never an invented due-date/billing judgement.
 * Used by the fee reminder feature (js/fees.js) to decide whether a
 * "Remind" button should appear for the current month.
 */
function tmFeeStatusForMonth(student, payments, monthKey) {
  const monthlyFee = Number(student.monthlyFee) || 0;
  const paidForMonth = payments
    .filter((p) => tmPaymentMonthKey(p) === monthKey)
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  if (monthlyFee <= 0) {
    return { paidForMonth, monthlyFee, status: paidForMonth > 0 ? "PAID" : "NOT_TRACKED" };
  }
  if (paidForMonth <= 0) return { paidForMonth, monthlyFee, status: "PENDING" };
  if (paidForMonth >= monthlyFee) return { paidForMonth, monthlyFee, status: "PAID" };
  return { paidForMonth, monthlyFee, status: "PARTIAL" };
}

/**
 * Cleans a phone number the user entered (spaces, dashes, a leading "+",
 * an optional "91") down to a plain 91XXXXXXXXXX string suitable for a
 * wa.me/sms: link. Returns null if it doesn't look like a valid 10-digit
 * Indian mobile number — callers should treat that as "no usable number
 * on file" rather than guessing.
 */
function tmNormalizeIndianPhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d]/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length !== 10) return null;
  return "91" + digits;
}

/** Builds a wa.me link that opens WhatsApp with the message pre-filled — no API, no account, just a URL. */
function tmBuildWhatsAppLink(phone, message) {
  const normalized = tmNormalizeIndianPhone(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

/** Builds an sms: link that opens the phone's Messages app with the text pre-filled (mobile only). */
function tmBuildSmsLink(phone, message) {
  const normalized = tmNormalizeIndianPhone(phone);
  if (!normalized) return null;
  return `sms:+${normalized}?body=${encodeURIComponent(message)}`;
}

function tmEscapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ---------------------------- Toast ---------------------------- */

function tmToast(message, duration = 2200) {
  let el = document.getElementById("tmToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "tmToast";
    el.className = "tm-toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove("show"), duration);
}

/* ---------------------------- Attendance calculations ---------------------------- */

function tmAttendanceStats(attendanceRecords) {
  const total = attendanceRecords.length;
  const present = attendanceRecords.filter((r) => r.status === "Present").length;
  const absent = attendanceRecords.filter((r) => r.status === "Absent").length;
  const pct = total > 0 ? Math.round((present / total) * 1000) / 10 : 0;
  return { total, present, absent, percentage: pct };
}

/* ---------------------------- Fee calculations ---------------------------- */

/**
 * Plain payment totals for a student — no due/pending/overpaid
 * calculation. This app only tracks what was actually paid; it does
 * not try to infer what "should" have been paid by a given date.
 */
function tmFeesSummary(student, payments) {
  const totalPaid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const paymentsCount = payments.length;
  const lastPayment = payments.reduce((latest, p) => {
    if (!latest) return p;
    return p.date > latest.date ? p : latest;
  }, null);
  return { totalPaid, paymentsCount, lastPayment };
}

/**
 * Groups a set of payments by the month they were recorded FOR
 * (payment.forMonth), summing amounts per month. Used for the fees
 * export workbook's per-month breakdown — purely informational, not
 * a due/paid/pending judgement.
 */
function tmPaymentsByMonth(payments) {
  const map = {};
  payments.forEach((p) => {
    const key = tmPaymentMonthKey(p);
    if (!key) return;
    map[key] = Math.round(((map[key] || 0) + (Number(p.amount) || 0)) * 100) / 100;
  });
  return map;
}

/* ---------------------------- CSV export ---------------------------- */

/**
 * Wraps a value so that Excel/Sheets treats it as literal text instead
 * of auto-converting it — e.g. long phone numbers becoming "8.15E+09"
 * in scientific notation, IDs losing leading zeros, or plain date
 * strings being reformatted as a date serial that shows as "#######"
 * when the column is too narrow. Produces an Excel "forced text"
 * formula like =\"9000000001\", which the existing CSV cell-escaping
 * in tmDownloadCsv quotes correctly since it contains a double quote.
 */
function tmExcelSafeText(value) {
  if (value === undefined || value === null || value === "") return "";
  return '="' + String(value).replace(/"/g, '""') + '"';
}

function tmDownloadCsv(filename, rows) {
  // rows: array of arrays. Escapes commas/quotes/newlines per CSV spec.
  const csvContent = rows
    .map((row) =>
      row
        .map((cell) => {
          const val = cell === undefined || cell === null ? "" : String(cell);
          if (/[",\n]/.test(val)) {
            return '"' + val.replace(/"/g, '""') + '"';
          }
          return val;
        })
        .join(",")
    )
    .join("\r\n");

  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  tmDownloadBlob(blob, filename);
}

function tmDownloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------------------------- Excel (.xlsx) export ---------------------------- */

/**
 * Excel worksheet names: max 31 characters, and can't contain
 * \ / ? * [ ] : — trims/cleans a label down to something Excel accepts.
 */
function tmSheetSafeName(name) {
  return String(name).replace(/[\\/?*[\]:]/g, "-").slice(0, 31);
}

const TM_BRAND_NAVY = "FF1E3A5F";
const TM_BRAND_AMBER = "FFF0A202";
const TM_BRAND_PAPER = "FFF5F3ED";
const TM_WEEKEND_FILL = "FFEDEBE3";

/**
 * Writes an ExcelJS workbook to disk as a real .xlsx file (not CSV),
 * via the same download-as-blob helper used elsewhere in the app.
 */
async function tmDownloadWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  tmDownloadBlob(blob, filename);
}

/**
 * Styles row 1 of a sheet as a bold white-on-navy header band, and
 * freezes it (plus however many leading columns) so it stays in view
 * while scrolling — the "professional report" look.
 */
function tmStyleHeaderRow(sheet, rowNumber, freezeCols) {
  const row = sheet.getRow(rowNumber);
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TM_BRAND_NAVY } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: TM_BRAND_AMBER } } };
  });
  row.height = 22;
  sheet.views = [{ state: "frozen", xSplit: freezeCols || 0, ySplit: rowNumber }];
}

async function tmLoadExcelJs() {
  if (window.ExcelJS) return window.ExcelJS;
  throw new Error("Excel export library failed to load. Check your internet connection and try again.");
}

/**
 * Builds a proper .xlsx attendance workbook: one worksheet PER MONTH,
 * laid out as a register grid (one row per student, one column per
 * calendar day). Shared by the Attendance page export and the
 * Settings page's full-data export, so both produce the same format.
 */
function tmBuildAttendanceWorkbook(ExcelJS, settings, students, records) {
  const studentsSorted = students.slice().sort((a, b) => a.name.localeCompare(b.name));

  const byMonth = {}; // "YYYY-MM" -> { studentId -> { day -> "Present"/"Absent" } }
  records.forEach((r) => {
    const monthKey = tmMonthKeyFromDateStr(r.date);
    const day = Number(r.date.slice(8, 10));
    if (!byMonth[monthKey]) byMonth[monthKey] = {};
    if (!byMonth[monthKey][r.studentId]) byMonth[monthKey][r.studentId] = {};
    byMonth[monthKey][r.studentId][day] = r.status;
  });
  const monthKeys = Object.keys(byMonth).sort();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = settings.staffName || "Tuition Manager";
  workbook.created = new Date();

  monthKeys.forEach((monthKey) => {
    const [y, m] = monthKey.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const sheet = workbook.addWorksheet(tmSheetSafeName(tmMonthLabelShort(y, m - 1)));

    const dayCols = [];
    for (let d = 1; d <= daysInMonth; d++) dayCols.push({ header: String(d), key: "d" + d, width: 4 });

    sheet.columns = [
      { header: "Student Name", key: "name", width: 24 },
      ...dayCols,
      { header: "Present", key: "present", width: 10 },
      { header: "Absent", key: "absent", width: 10 },
      { header: "%", key: "pct", width: 8 },
    ];

    sheet.insertRow(1, [
      `${settings.tuitionCenterName || "Tuition Manager"} — Attendance — ${tmMonthLabel(y, m - 1)}`,
    ]);
    sheet.mergeCells(1, 1, 1, sheet.columns.length);
    sheet.getRow(1).font = { bold: true, italic: true, color: { argb: "FF14283F" } };
    sheet.getRow(1).height = 20;

    const monthData = byMonth[monthKey];
    studentsSorted.forEach((student) => {
      const dayStatuses = monthData[student.id] || {};
      const row = { name: student.name };
      let present = 0;
      let total = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const status = dayStatuses[d];
        if (status === "Present") {
          row["d" + d] = "P";
          present += 1;
          total += 1;
        } else if (status === "Absent") {
          row["d" + d] = "A";
          total += 1;
        } else {
          row["d" + d] = "";
        }
      }
      row.present = present;
      row.absent = total - present;
      row.pct = total > 0 ? Math.round((present / total) * 1000) / 10 : "";
      sheet.addRow(row);
    });

    // Light shading on weekend day-columns (data rows only — the header
    // row already has its own navy styling) so the grid reads like a
    // real attendance register at a glance.
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(y, m - 1, d).getDay();
      if (dow === 0 || dow === 6) {
        sheet.getColumn(1 + d).eachCell((cell, rowNumber) => {
          if (rowNumber > 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TM_WEEKEND_FILL } };
        });
      }
    }

    tmStyleHeaderRow(sheet, 2, 1);
    sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: sheet.columns.length } };
  });

  return workbook;
}

/**
 * Builds a proper .xlsx payments workbook with two sheets:
 *  1. "Fees Summary" — one row per student, one column per calendar
 *     month that has at least one recorded payment, each cell showing
 *     what that student paid FOR that month (via payment.forMonth),
 *     regardless of which date they paid on, plus a running total.
 *  2. "Payment Log" — every individual payment transaction, in date
 *     order, for a plain audit trail.
 * Shared by the Fees page export and the Settings page's full-data
 * export, so both produce the same format.
 */
function tmBuildPaymentsWorkbook(ExcelJS, settings, students, payments) {
  const studentsSorted = students.slice().sort((a, b) => a.name.localeCompare(b.name));

  const monthKeySet = new Set();
  const perStudent = studentsSorted.map((student) => {
    const studentPayments = payments.filter((p) => p.studentId === student.id);
    const summary = tmFeesSummary(student, studentPayments);
    const paidByMonth = tmPaymentsByMonth(studentPayments);
    Object.keys(paidByMonth).forEach((key) => monthKeySet.add(key));
    return { student, summary, paidByMonth };
  });
  const monthKeys = Array.from(monthKeySet).sort();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = settings.staffName || "Tuition Manager";
  workbook.created = new Date();

  /* ---- Sheet 1: Fees Summary ---- */
  const summarySheet = workbook.addWorksheet(tmSheetSafeName("Fees Summary"));
  const monthCols = monthKeys.map((key) => ({ header: tmFormatMonthKey(key), key, width: 14 }));
  summarySheet.columns = [
    { header: "Student Name", key: "name", width: 24 },
    { header: "Student ID", key: "studentId", width: 14 },
    ...monthCols,
    { header: "Total Paid", key: "totalPaid", width: 14 },
  ];

  summarySheet.insertRow(1, [
    `${settings.tuitionCenterName || "Tuition Manager"} — Fees Summary — generated ${tmFormatDate(tmTodayStr())}`,
  ]);
  summarySheet.mergeCells(1, 1, 1, summarySheet.columns.length);
  summarySheet.getRow(1).font = { bold: true, italic: true, color: { argb: "FF14283F" } };
  summarySheet.getRow(1).height = 20;

  perStudent.forEach(({ student, summary, paidByMonth }) => {
    const row = { name: student.name, studentId: student.studentId || "" };
    monthKeys.forEach((key) => {
      row[key] = key in paidByMonth ? paidByMonth[key] : "";
    });
    row.totalPaid = summary.totalPaid;
    summarySheet.addRow(row);
  });

  monthCols.forEach((c, i) => {
    summarySheet.getColumn(3 + i).numFmt = "#,##0.00";
  });
  summarySheet.getColumn("totalPaid").numFmt = "#,##0.00";
  tmStyleHeaderRow(summarySheet, 2, 2);
  summarySheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: summarySheet.columns.length } };

  /* ---- Sheet 2: Payment Log ---- */
  const logSheet = workbook.addWorksheet(tmSheetSafeName("Payment Log"));
  logSheet.columns = [
    { header: "Payment Date", key: "date", width: 14 },
    { header: "Student Name", key: "name", width: 24 },
    { header: "Fee For Month", key: "forMonth", width: 16 },
    { header: "Amount (₹)", key: "amount", width: 14 },
    { header: "Mode", key: "mode", width: 14 },
    { header: "Reference", key: "reference", width: 18 },
    { header: "Notes", key: "notes", width: 26 },
  ];

  const studentMap = {};
  studentsSorted.forEach((s) => (studentMap[s.id] = s.name));
  const logRows = payments.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  logSheet.insertRow(1, [
    `${settings.tuitionCenterName || "Tuition Manager"} — Payment Log — generated ${tmFormatDate(tmTodayStr())}`,
  ]);
  logSheet.mergeCells(1, 1, 1, logSheet.columns.length);
  logSheet.getRow(1).font = { bold: true, italic: true, color: { argb: "FF14283F" } };
  logSheet.getRow(1).height = 20;

  logRows.forEach((p) => {
    logSheet.addRow({
      date: tmFormatDate(p.date),
      name: studentMap[p.studentId] || "Unknown",
      forMonth: tmFormatMonthKey(tmPaymentMonthKey(p)),
      amount: Number(p.amount) || 0,
      mode: p.mode || "",
      reference: p.reference || "",
      notes: p.notes || "",
    });
  });
  logSheet.getColumn("amount").numFmt = "#,##0.00";
  tmStyleHeaderRow(logSheet, 2, 2);
  logSheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: logSheet.columns.length } };

  return workbook;
}

/* ---------------------------- Query helpers ---------------------------- */

function tmGetQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

/* ---------------------------- Date range filters ---------------------------- */

function tmDateInRange(dateStr, startStr, endStr) {
  if (startStr && dateStr < startStr) return false;
  if (endStr && dateStr > endStr) return false;
  return true;
}

function tmStartOfWeekStr(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = d.getDate() - day;
  const start = new Date(d.setDate(diff));
  return tmDateToStr(start);
}

function tmStartOfMonthStr(date = new Date()) {
  return tmDateToStr(new Date(date.getFullYear(), date.getMonth(), 1));
}

function tmEndOfMonthStr(date = new Date()) {
  return tmDateToStr(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

/* ---------------------------- offline attendance queue ---------------------------- */
// Lets "Mark Attendance" keep working with patchy/no internet: a failed
// save is queued in localStorage instead of lost, and gets pushed to the
// cloud automatically once a connection is available again (see
// tmFlushOfflineAttendanceQueue, called from js/app.js on page load and
// on the browser's "online" event, and from js/attendance.js right after
// a save that couldn't reach the server). No extra API calls are made
// beyond the ones that would happen anyway once online — this only
// delays some of them.

const TM_OFFLINE_ATTENDANCE_QUEUE_KEY = "tm_offline_attendance_queue";

function tmGetOfflineAttendanceQueue() {
  try {
    return JSON.parse(localStorage.getItem(TM_OFFLINE_ATTENDANCE_QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function tmSaveOfflineAttendanceQueue(queue) {
  try {
    localStorage.setItem(TM_OFFLINE_ATTENDANCE_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* storage full/unavailable — best effort only, never blocks marking attendance */
  }
}

/**
 * Queues one attendance mark for later sync, replacing any earlier
 * queued mark for the same student+date — mirrors the server's own
 * upsert-by-student-and-date behavior, so re-marking the same day before
 * it even syncs just updates the queued entry instead of stacking dupes.
 */
function tmQueueOfflineAttendance(studentId, date, status) {
  const queue = tmGetOfflineAttendanceQueue().filter((q) => !(q.studentId === studentId && q.date === date));
  queue.push({ studentId, date, status, queuedAt: new Date().toISOString() });
  tmSaveOfflineAttendanceQueue(queue);
}

/**
 * Attempts to push every queued attendance mark to the cloud. Each entry
 * succeeds or fails independently — anything that still fails (still
 * offline) stays queued for the next attempt, so this is safe to call
 * repeatedly (every page load, every "back online" event) without
 * risking a partial queue getting stuck or duplicated.
 * Returns the number of entries successfully synced this call.
 */
async function tmFlushOfflineAttendanceQueue() {
  const queue = tmGetOfflineAttendanceQueue();
  if (queue.length === 0) return 0;

  const stillQueued = [];
  let syncedCount = 0;
  for (const entry of queue) {
    try {
      await TMDB.markAttendance(entry.studentId, entry.date, entry.status);
      syncedCount++;
    } catch {
      stillQueued.push(entry);
    }
  }
  tmSaveOfflineAttendanceQueue(stillQueued);
  return syncedCount;
}
