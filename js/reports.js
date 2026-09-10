/* ==========================================================================
   Tuition Manager — reports.js
   ========================================================================== */

let tmReportStudents = [];
let tmReportAttendance = [];
let tmReportPayments = [];
let tmReportSettings = null;

async function tmInitReportsPage() {
  tmReportSettings = await tmRequireSetup();
  await tmLoadHeaderInfo();
  tmRenderBottomNav("reports");

  [tmReportStudents, tmReportAttendance, tmReportPayments] = await Promise.all([
    TMDB.getAllStudents(),
    TMDB.getAllAttendance(),
    TMDB.getAllPayments(),
  ]);

  tmPopulateReportStudentSelect();
  tmPopulateMonthYearSelects();

  document.getElementById("studentReportSelect").addEventListener("change", tmRenderStudentReport);
  document.getElementById("btnPrintStudentReport").addEventListener("click", () => window.print());

  document.getElementById("attReportStudentSelect").addEventListener("change", tmRenderAttendanceReport);
  document.getElementById("attReportRange").addEventListener("change", tmRenderAttendanceReport);
  document.getElementById("attReportMonth").addEventListener("change", tmRenderAttendanceReport);
  document.getElementById("attReportYear").addEventListener("change", tmRenderAttendanceReport);
  document.getElementById("attReportStart").addEventListener("change", tmRenderAttendanceReport);
  document.getElementById("attReportEnd").addEventListener("change", tmRenderAttendanceReport);

  document.getElementById("feesReportStudentSelect").addEventListener("change", tmRenderFeesReport);
  document.getElementById("feesReportMonth").addEventListener("change", tmRenderFeesReport);
  document.getElementById("feesReportYear").addEventListener("change", tmRenderFeesReport);

  tmRenderStudentReport();
  tmRenderAttendanceReport();
  tmRenderFeesReport();
}

function tmPopulateReportStudentSelect() {
  const select = document.getElementById("studentReportSelect");
  const sorted = tmReportStudents.slice().sort((a, b) => a.name.localeCompare(b.name));
  select.innerHTML = sorted.map((s) => `<option value="${s.id}">${tmEscapeHtml(s.name)}</option>`).join("");

  const options = `<option value="">All students</option>` +
    sorted.map((s) => `<option value="${s.id}">${tmEscapeHtml(s.name)}</option>`).join("");
  document.getElementById("attReportStudentSelect").innerHTML = options;
  document.getElementById("feesReportStudentSelect").innerHTML = options;
}

function tmPopulateMonthYearSelects() {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const now = new Date();
  const years = [];
  for (let y = now.getFullYear() - 3; y <= now.getFullYear() + 1; y++) years.push(y);

  ["attReportMonth", "feesReportMonth"].forEach((id) => {
    const el = document.getElementById(id);
    el.innerHTML =
      `<option value="">All months</option>` +
      months.map((m, i) => `<option value="${i}" ${i === now.getMonth() ? "" : ""}>${m}</option>`).join("");
  });

  ["attReportYear", "feesReportYear"].forEach((id) => {
    const el = document.getElementById(id);
    el.innerHTML = years.map((y) => `<option value="${y}" ${y === now.getFullYear() ? "selected" : ""}>${y}</option>`).join("");
  });
}

/* ---------------------------- Student report ---------------------------- */

function tmRenderStudentReport() {
  const studentId = document.getElementById("studentReportSelect").value;
  const student = tmReportStudents.find((s) => s.id === studentId);
  const wrap = document.getElementById("studentReportContent");
  if (!student) {
    wrap.innerHTML = `<div class="tm-empty"><span class="emoji">👨‍🎓</span>Add a student to generate a report.</div>`;
    return;
  }

  const attendance = tmReportAttendance.filter((a) => a.studentId === studentId);
  const payments = tmReportPayments
    .filter((p) => p.studentId === studentId)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const attStats = tmAttendanceStats(attendance);
  const feeSummary = tmFeesSummary(student, payments);

  const centerName = tmReportSettings?.tuitionCenterName || "Tuition Manager";

  wrap.innerHTML = `
    <div class="tm-card tm-print-report">
      <div class="text-center mb-3">
        <div class="text-uppercase fw-bold" style="letter-spacing:0.05em; color:var(--color-ink);">${tmEscapeHtml(centerName)}</div>
        <div class="tm-muted" style="font-size:0.85rem;">Student Report</div>
      </div>
      <div class="tm-divider"></div>
      <p class="mb-1"><strong>Student:</strong> ${tmEscapeHtml(student.name)}</p>
      ${student.studentId ? `<p class="mb-1"><strong>Student ID:</strong> ${tmEscapeHtml(student.studentId)}</p>` : ""}
      ${student.parentName ? `<p class="mb-1"><strong>Parent:</strong> ${tmEscapeHtml(student.parentName)}</p>` : ""}
      <div class="tm-divider"></div>

      <div class="tm-section-title"><span>Attendance</span><span class="rule"></span></div>
      <p class="mb-1">Total Classes: <strong>${attStats.total}</strong></p>
      <p class="mb-1">Present: <strong>${attStats.present}</strong></p>
      <p class="mb-1">Absent: <strong>${attStats.absent}</strong></p>
      <p class="mb-1">Attendance: <strong>${attStats.percentage}%</strong></p>
      <div class="tm-divider"></div>

      <div class="tm-section-title"><span>Fees</span><span class="rule"></span></div>
      <p class="mb-1">Total Paid: <strong>${tmFormatCurrency(feeSummary.totalPaid)}</strong></p>
      <p class="mb-1">Payments Recorded: <strong>${feeSummary.paymentsCount}</strong></p>
      <div class="tm-divider"></div>

      <div class="tm-section-title"><span>Payment History</span><span class="rule"></span></div>
      ${
        payments.length === 0
          ? '<p class="tm-muted">No payments recorded.</p>'
          : payments.map((p) => `<p class="mb-1">${tmFormatDateShort(p.date)} — ${tmFormatCurrency(p.amount)} — ${tmEscapeHtml(p.mode)}</p>`).join("")
      }
      <div class="tm-divider"></div>
      <p class="tm-muted mb-0" style="font-size:0.8rem;">Generated: ${tmFormatDate(tmTodayStr())}</p>
    </div>
  `;
}

/* ---------------------------- Attendance report ---------------------------- */

function tmAttendanceReportBounds() {
  const range = document.getElementById("attReportRange").value;
  if (range === "custom") {
    return [document.getElementById("attReportStart").value, document.getElementById("attReportEnd").value];
  }
  const monthVal = document.getElementById("attReportMonth").value;
  const yearVal = parseInt(document.getElementById("attReportYear").value, 10);
  if (monthVal !== "") {
    const start = tmDateToStr(new Date(yearVal, parseInt(monthVal, 10), 1));
    const end = tmDateToStr(new Date(yearVal, parseInt(monthVal, 10) + 1, 0));
    return [start, end];
  }
  // whole year
  return [tmDateToStr(new Date(yearVal, 0, 1)), tmDateToStr(new Date(yearVal, 11, 31))];
}

function tmRenderAttendanceReport() {
  const range = document.getElementById("attReportRange").value;
  document.getElementById("attReportMonthYearWrap").classList.toggle("d-none", range !== "monthYear");
  document.getElementById("attReportCustomWrap").classList.toggle("d-none", range !== "custom");

  let start = "", end = "";
  if (range === "monthYear") {
    [start, end] = tmAttendanceReportBounds();
  } else if (range === "custom") {
    start = document.getElementById("attReportStart").value;
    end = document.getElementById("attReportEnd").value;
  }
  // range === "all" leaves start/end empty

  const records = tmReportAttendance.filter((r) => tmDateInRange(r.date, start, end));
  const activeStudents = tmReportStudents.filter((s) => s.active !== false);

  const studentId = document.getElementById("attReportStudentSelect").value;
  if (studentId) {
    tmRenderAttendanceReportForStudent(studentId, records);
    return;
  }
  document.getElementById("attReportAggregateView").classList.remove("d-none");
  document.getElementById("attReportStudentView").classList.add("d-none");

  const today = tmTodayStr();
  const todayRecords = tmReportAttendance.filter((r) => r.date === today);
  const todayPresent = todayRecords.filter((r) => r.status === "Present").length;
  const todayAbsent = todayRecords.filter((r) => r.status === "Absent").length;

  // Average attendance % across students (based on filtered records)
  let avgSum = 0;
  let avgCount = 0;
  const lowAttendance = [];
  activeStudents.forEach((student) => {
    const studentRecords = records.filter((r) => r.studentId === student.id);
    if (studentRecords.length === 0) return;
    const stats = tmAttendanceStats(studentRecords);
    avgSum += stats.percentage;
    avgCount += 1;
    if (stats.percentage < 75) {
      lowAttendance.push({ student, percentage: stats.percentage });
    }
  });
  const avgAttendance = avgCount > 0 ? Math.round((avgSum / avgCount) * 10) / 10 : 0;

  document.getElementById("attReportTotalStudents").textContent = activeStudents.length;
  document.getElementById("attReportTodayPresent").textContent = todayPresent;
  document.getElementById("attReportTodayAbsent").textContent = todayAbsent;
  document.getElementById("attReportAverage").textContent = avgAttendance + "%";

  lowAttendance.sort((a, b) => a.percentage - b.percentage);
  const lowEl = document.getElementById("attReportLowList");
  lowEl.innerHTML = lowAttendance.length
    ? lowAttendance
        .map(
          (item) =>
            `<div class="d-flex justify-content-between border-bottom py-2">
              <span>${tmEscapeHtml(item.student.name)}</span>
              <span class="tm-badge danger">${item.percentage}%</span>
            </div>`
        )
        .join("")
    : `<p class="tm-muted">No students below 75% attendance in this period.</p>`;
}

/**
 * Single-student view of the Attendance report: swaps out the
 * aggregate stat grid / low-attendance list for that student's own
 * stats plus a day-by-day history, respecting whichever date range
 * is currently selected.
 */
function tmRenderAttendanceReportForStudent(studentId, recordsInRange) {
  document.getElementById("attReportAggregateView").classList.add("d-none");
  document.getElementById("attReportStudentView").classList.remove("d-none");

  const student = tmReportStudents.find((s) => s.id === studentId);
  const records = recordsInRange
    .filter((r) => r.studentId === studentId)
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first

  const stats = tmAttendanceStats(records);
  document.getElementById("attReportStudentTotal").textContent = stats.total;
  document.getElementById("attReportStudentPresent").textContent = stats.present;
  document.getElementById("attReportStudentAbsent").textContent = stats.absent;
  document.getElementById("attReportStudentPct").textContent = stats.percentage + "%";

  document.getElementById("attReportStudentHistoryTitle").textContent =
    "Attendance History" + (student ? " — " + student.name : "");

  const listEl = document.getElementById("attReportStudentHistoryList");
  listEl.innerHTML = records.length
    ? records
        .map(
          (r) => `
        <div class="d-flex justify-content-between align-items-center border-bottom py-2">
          <span>${tmFormatDate(r.date)}</span>
          <span class="tm-badge ${r.status === "Present" ? "success" : "danger"}">${r.status}</span>
        </div>`
        )
        .join("")
    : `<p class="tm-muted">No attendance records for this student in this period.</p>`;
}

/* ---------------------------- Fees report ---------------------------- */

function tmRenderFeesReport() {
  const monthVal = document.getElementById("feesReportMonth").value;
  const yearVal = parseInt(document.getElementById("feesReportYear").value, 10);

  let start = "", end = "";
  if (monthVal !== "") {
    start = tmDateToStr(new Date(yearVal, parseInt(monthVal, 10), 1));
    end = tmDateToStr(new Date(yearVal, parseInt(monthVal, 10) + 1, 0));
  } else {
    start = tmDateToStr(new Date(yearVal, 0, 1));
    end = tmDateToStr(new Date(yearVal, 11, 31));
  }

  const studentMap = {};
  tmReportStudents.forEach((s) => (studentMap[s.id] = s));

  const studentId = document.getElementById("feesReportStudentSelect").value;

  let paymentsInRange = tmReportPayments
    .filter((p) => tmDateInRange(p.date, start, end))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (studentId) paymentsInRange = paymentsInRange.filter((p) => p.studentId === studentId);

  const totalCollectedInRange = paymentsInRange.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  document.getElementById("feesReportCollected").textContent = tmFormatCurrency(totalCollectedInRange);
  document.getElementById("feesReportCount").textContent = paymentsInRange.length;

  const selectedStudent = studentId ? studentMap[studentId] : null;
  document.getElementById("feesReportHistoryTitle").textContent =
    "Payment History" + (selectedStudent ? " — " + selectedStudent.name : "");

  const listEl = document.getElementById("feesReportPendingList");
  listEl.innerHTML = paymentsInRange.length
    ? paymentsInRange
        .map((p) => {
          const student = studentMap[p.studentId];
          return `<div class="d-flex justify-content-between border-bottom py-2">
              <span>${tmEscapeHtml(student ? student.name : "Unknown student")} <span class="tm-muted">· ${tmFormatDateShort(p.date)}</span></span>
              <span class="tm-amount">${tmFormatCurrency(p.amount)}</span>
            </div>`;
        })
        .join("")
    : `<p class="tm-muted">No payments recorded in this period.</p>`;
}
