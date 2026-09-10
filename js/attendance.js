/* ==========================================================================
   Tuition Manager — attendance.js
   ========================================================================== */

let tmAttStudents = [];
let tmAttRecordsForDate = [];
let tmAttPendingChanges = {}; // studentId -> "Present" | "Absent"
let tmAttAllRecords = [];

async function tmInitAttendancePage() {
  await tmRequireSetup();
  await tmLoadHeaderInfo();
  tmRenderBottomNav("attendance");

  const dateInput = document.getElementById("attendanceDate");
  dateInput.value = tmTodayStr();
  dateInput.addEventListener("change", tmLoadAttendanceForDate);

  document.getElementById("btnMarkAllPresent").addEventListener("click", tmMarkAllPresent);
  document.getElementById("btnSaveAttendance").addEventListener("click", tmSaveAttendance);

  document.getElementById("historyStudentSelect").addEventListener("change", tmRenderAttendanceHistory);
  document.getElementById("historyRangeSelect").addEventListener("change", tmOnHistoryRangeChange);
  document.getElementById("historyCustomStart").addEventListener("change", tmRenderAttendanceHistory);
  document.getElementById("historyCustomEnd").addEventListener("change", tmRenderAttendanceHistory);
  document.getElementById("btnExportAttendanceCsv").addEventListener("click", tmExportAttendanceExcel);

  tmAttStudents = await TMDB.getAllStudents();
  tmAttAllRecords = await TMDB.getAllAttendance();
  tmPopulateStudentSelect();
  await tmLoadAttendanceForDate();
  tmRenderAttendanceHistory();

  const studentParam = tmGetQueryParam("student");
  if (studentParam) {
    const tabTrigger = document.getElementById("history-tab");
    bootstrap.Tab.getOrCreateInstance(tabTrigger).show();
    document.getElementById("historyStudentSelect").value = studentParam;
    tmRenderAttendanceHistory();
  }
}

function tmPopulateStudentSelect() {
  const select = document.getElementById("historyStudentSelect");
  const activeStudents = tmAttStudents.slice().sort((a, b) => a.name.localeCompare(b.name));
  select.innerHTML =
    `<option value="">All students</option>` +
    activeStudents.map((s) => `<option value="${s.id}">${tmEscapeHtml(s.name)}</option>`).join("");
}

/* ---------------------------- Mark attendance tab ---------------------------- */

async function tmLoadAttendanceForDate() {
  const date = document.getElementById("attendanceDate").value || tmTodayStr();
  document.getElementById("attendanceDateLabel").textContent = tmFormatDate(date);

  tmAttRecordsForDate = await TMDB.getAttendanceForDate(date);
  tmAttPendingChanges = {};
  tmAttRecordsForDate.forEach((r) => {
    tmAttPendingChanges[r.studentId] = r.status;
  });

  tmRenderAttendanceMarkingList();
}

function tmRenderAttendanceMarkingList() {
  const container = document.getElementById("attendanceMarkList");
  const activeStudents = tmAttStudents.filter((s) => s.active !== false).sort((a, b) => a.name.localeCompare(b.name));

  if (activeStudents.length === 0) {
    container.innerHTML = `<div class="tm-empty"><span class="emoji">👨‍🎓</span>No active students. Add students first.</div>`;
    return;
  }

  container.innerHTML = activeStudents
    .map((student) => {
      const status = tmAttPendingChanges[student.id];
      return `
      <div class="tm-attend-row">
        <span class="student-name">${tmEscapeHtml(student.name)}</span>
        <div class="tm-attend-toggle">
          <button type="button" class="present ${status === "Present" ? "selected" : ""}" onclick="tmSetAttendanceStatus('${student.id}','Present')">Present</button>
          <button type="button" class="absent ${status === "Absent" ? "selected" : ""}" onclick="tmSetAttendanceStatus('${student.id}','Absent')">Absent</button>
        </div>
      </div>`;
    })
    .join("");
}

function tmSetAttendanceStatus(studentId, status) {
  tmAttPendingChanges[studentId] = status;
  tmRenderAttendanceMarkingList();
}

function tmMarkAllPresent() {
  tmAttStudents
    .filter((s) => s.active !== false)
    .forEach((s) => {
      tmAttPendingChanges[s.id] = "Present";
    });
  tmRenderAttendanceMarkingList();
  tmToast("All students marked present. Adjust any absences, then save.");
}

async function tmSaveAttendance() {
  const date = document.getElementById("attendanceDate").value || tmTodayStr();
  const entries = Object.entries(tmAttPendingChanges);

  if (entries.length === 0) {
    tmToast("Mark at least one student before saving.");
    return;
  }

  await Promise.all(entries.map(([studentId, status]) => TMDB.markAttendance(studentId, date, status)));
  tmToast("Attendance saved for " + tmFormatDate(date) + ".");

  tmAttAllRecords = await TMDB.getAllAttendance();
  tmRenderAttendanceHistory();
}

/* ---------------------------- History tab ---------------------------- */

function tmOnHistoryRangeChange() {
  const range = document.getElementById("historyRangeSelect").value;
  const customWrap = document.getElementById("historyCustomWrap");
  customWrap.classList.toggle("d-none", range !== "custom");
  tmRenderAttendanceHistory();
}

function tmHistoryDateBounds() {
  const range = document.getElementById("historyRangeSelect").value;
  const today = new Date();
  if (range === "today") {
    const t = tmTodayStr();
    return [t, t];
  }
  if (range === "week") {
    return [tmStartOfWeekStr(today), tmTodayStr()];
  }
  if (range === "month") {
    return [tmStartOfMonthStr(today), tmEndOfMonthStr(today)];
  }
  if (range === "custom") {
    const start = document.getElementById("historyCustomStart").value || "";
    const end = document.getElementById("historyCustomEnd").value || "";
    return [start, end];
  }
  return ["", ""]; // all time
}

function tmRenderAttendanceHistory() {
  const [start, end] = tmHistoryDateBounds();
  const studentId = document.getElementById("historyStudentSelect").value;

  let records = tmAttAllRecords.filter((r) => tmDateInRange(r.date, start, end));
  if (studentId) records = records.filter((r) => r.studentId === studentId);

  const stats = tmAttendanceStats(records);
  // "Total Classes" means how many days attendance was taken — NOT how
  // many student-day records exist. With "All students" selected, one
  // day with 2 students marked produces 2 records, which would double
  // (or N-times) count the day if we used stats.total here. Count
  // unique dates instead so it stays correct regardless of how many
  // students are included in the filter.
  const uniqueClassDays = new Set(records.map((r) => r.date)).size;
  document.getElementById("historyStatTotal").textContent = uniqueClassDays;
  document.getElementById("historyStatPresent").textContent = stats.present;
  document.getElementById("historyStatAbsent").textContent = stats.absent;
  document.getElementById("historyStatPct").textContent = stats.percentage + "%";

  const listEl = document.getElementById("attendanceHistoryList");
  if (records.length === 0) {
    listEl.innerHTML = `<div class="tm-empty"><span class="emoji">📭</span>No attendance records for this filter.</div>`;
    return;
  }

  const studentMap = {};
  tmAttStudents.forEach((s) => (studentMap[s.id] = s.name));

  // Group records by date, so each date gets its own table instead of one
  // long mixed list — easier to scan "who was present on 30 Aug" at a glance.
  const byDate = {};
  records.forEach((r) => {
    if (!byDate[r.date]) byDate[r.date] = [];
    byDate[r.date].push(r);
  });
  const dates = Object.keys(byDate).sort((a, b) => (a < b ? 1 : -1)); // newest first

  listEl.innerHTML = dates
    .slice(0, 60)
    .map((date) => {
      const dayRecords = byDate[date].sort((a, b) =>
        (studentMap[a.studentId] || "").localeCompare(studentMap[b.studentId] || "")
      );
      const dayPresent = dayRecords.filter((r) => r.status === "Present").length;
      const dayTotal = dayRecords.length;
      const rows = dayRecords
        .map((r) => {
          // markedAt is only set for "Present" records saved by the cloud
          // Worker (see worker/src/index.js); older/legacy records simply
          // don't have one, and Absent records never do — in both cases
          // this stays blank rather than showing a made-up time.
          const time = r.status === "Present" ? tmFormatTime12h(r.markedAt) : "";
          return `
        <div class="d-flex justify-content-between align-items-center border-bottom py-2">
          <span>${tmEscapeHtml(studentMap[r.studentId] || "Unknown student")}</span>
          <span class="d-flex align-items-center gap-2">
            ${time ? `<span class="tm-muted" style="font-size:0.8rem;">${time}</span>` : ""}
            <span class="tm-badge ${r.status === "Present" ? "success" : "danger"}">${r.status}</span>
          </span>
        </div>`;
        })
        .join("");
      return `
      <div class="tm-card mb-3">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <h3 class="h6 mb-0">${tmFormatDate(date)}</h3>
          <span class="tm-badge neutral">${dayPresent}/${dayTotal} present</span>
        </div>
        ${rows}
      </div>`;
    })
    .join("");
}

/**
 * Exports a proper .xlsx workbook (not CSV): one worksheet PER MONTH,
 * each laid out as a register grid — one row per student, one column
 * per calendar day (1, 2, 3 …), with "P"/"A" in the cells. When the
 * data crosses into a new month, a new sheet is created for it,
 * instead of stacking every date into a single sheet.
 *
 * Respects whichever student/date-range filter is currently selected
 * on the History tab.
 */
async function tmExportAttendanceExcel() {
  let ExcelJS;
  try {
    ExcelJS = await tmLoadExcelJs();
  } catch (err) {
    tmToast(err.message);
    return;
  }

  const [start, end] = tmHistoryDateBounds();
  const filterStudentId = document.getElementById("historyStudentSelect").value;
  let records = tmAttAllRecords.filter((r) => tmDateInRange(r.date, start, end));
  if (filterStudentId) records = records.filter((r) => r.studentId === filterStudentId);

  if (records.length === 0) {
    tmToast("No attendance records to export for this filter.");
    return;
  }

  const settings = (await TMDB.getSettings()) || {};
  const studentsInScope = filterStudentId ? tmAttStudents.filter((s) => s.id === filterStudentId) : tmAttStudents;

  const workbook = tmBuildAttendanceWorkbook(ExcelJS, settings, studentsInScope, records);
  await tmDownloadWorkbook(workbook, `attendance-${tmTodayStr()}.xlsx`);
}
