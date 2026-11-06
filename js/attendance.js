/* ==========================================================================
   Tuition Manager — attendance.js
   ========================================================================== */

let tmAttStudents = [];
let tmAttRecordsForDate = [];
let tmAttPendingChanges = {}; // studentId -> "Present" | "Absent"
let tmAttAllRecords = [];
let tmAttSaved = {};   // studentId -> status as stored for the selected date
let tmAttFilter = "all";
let tmAttHolidays = [];
let tmAttQuery = "";

async function tmInitAttendancePage() {
  await tmRequireSetup();
  await tmLoadHeaderInfo();
  tmRenderBottomNav("attendance");

  const dateInput = document.getElementById("attendanceDate");
  dateInput.value = tmTodayStr();
  dateInput.addEventListener("change", tmLoadAttendanceForDate);

  document.getElementById("btnMarkAllPresent").addEventListener("click", tmMarkAllPresent);
  document.querySelectorAll("[data-save-att]").forEach((b) => b.addEventListener("click", tmSaveAttendance));
  document.getElementById("btnDiscardAtt").addEventListener("click", tmDiscardAttendanceChanges);
  document.getElementById("btnDayPrev").addEventListener("click", () => tmShiftAttendanceDay(-1));
  document.getElementById("btnDayNext").addEventListener("click", () => tmShiftAttendanceDay(1));
  document.getElementById("btnDayToday").addEventListener("click", () => { dateInput.value = tmTodayStr(); tmLoadAttendanceForDate(); });
  document.getElementById("attSearch").addEventListener("input", (e) => { tmAttQuery = e.target.value.trim().toLowerCase(); tmRenderAttendanceMarkingList(); });
  document.getElementById("attFilters").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    tmAttFilter = btn.dataset.filter;
    document.querySelectorAll("#attFilters .tm-filter").forEach((b) => b.classList.toggle("active", b === btn));
    tmRenderAttendanceMarkingList();
  });

  document.getElementById("historyStudentSelect").addEventListener("change", tmRenderAttendanceHistory);
  document.getElementById("historyRangeSelect").addEventListener("change", tmOnHistoryRangeChange);
  document.getElementById("historyCustomStart").addEventListener("change", tmRenderAttendanceHistory);
  document.getElementById("historyCustomEnd").addEventListener("change", tmRenderAttendanceHistory);
  document.getElementById("btnExportAttendanceCsv").addEventListener("click", tmExportAttendanceExcel);

  tmAttStudents = await TMDB.getAllStudents();
  tmAttAllRecords = await TMDB.getAllAttendance();
  tmAttHolidays = await TMDB.getHolidays().catch(() => []);
  tmPopulateStudentSelect();
  await tmLoadAttendanceForDate();
  tmRenderAttendanceHistory();
  tmRefreshOfflineQueueBanner();

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
  const d = new Date(date + "T00:00:00");
  document.getElementById("attendanceDateLabel").innerHTML =
    d.toLocaleDateString("en-IN", { weekday: "long" }) + "<small>" + tmFormatDate(date) + "</small>";

  tmAttRecordsForDate = await TMDB.getAttendanceForDate(date);
  tmAttPendingChanges = {};
  tmAttRecordsForDate.forEach((r) => {
    tmAttPendingChanges[r.studentId] = r.status;
  });
  tmAttSaved = { ...tmAttPendingChanges };
  tmRenderHolidayBanner(date);
  tmRenderAttendanceMarkingList();
}

function tmRenderHolidayBanner(date) {
  const el = document.getElementById("attHolidayBanner");
  if (!el) return;
  const h = tmHolidayMap(tmAttHolidays, "students")[date];
  const isSunday = new Date(date + "T00:00:00").getDay() === 0;
  if (h) {
    el.className = "tm-banner " + (h.type === "Rain" ? "rain" : "");
    el.innerHTML = `<span><strong>Holiday: ${tmEscapeHtml(h.name)}.</strong> No classes today, so attendance is not required.</span><a class="btn btn-tm-outline btn-sm" href="holidays.html">Calendar</a>`;
  } else if (isSunday) {
    el.className = "tm-banner";
    el.innerHTML = `<span><strong>Sunday.</strong> This is a weekly off. Mark attendance only if you held a class.</span>`;
  } else {
    el.className = "tm-banner d-none";
    el.innerHTML = "";
  }
}

function tmShiftAttendanceDay(delta) {
  const input = document.getElementById("attendanceDate");
  const d = new Date((input.value || tmTodayStr()) + "T00:00:00");
  d.setDate(d.getDate() + delta);
  input.value = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  tmLoadAttendanceForDate();
}

function tmAttDirtyIds() {
  return Object.keys(tmAttPendingChanges).filter((id) => tmAttPendingChanges[id] !== tmAttSaved[id]);
}

function tmRenderAttendanceMarkingList() {
  const container = document.getElementById("attendanceMarkList");
  const all = tmAttStudents.filter((s) => s.active !== false).sort((a, b) => a.name.localeCompare(b.name));

  // Summary numbers always cover everyone on the roll, whatever the filter.
  const present = all.filter((s) => tmAttPendingChanges[s.id] === "Present").length;
  const absent = all.filter((s) => tmAttPendingChanges[s.id] === "Absent").length;
  const unmarked = all.length - present - absent;
  const marked = present + absent;
  const rate = marked > 0 ? Math.round((present / marked) * 100) : 0;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("attKpiTotal", all.length); set("attKpiPresent", present); set("attKpiAbsent", absent);
  set("attKpiUnmarked", unmarked + " not marked"); set("attKpiRate", rate + "%");
  set("attCountAll", all.length); set("attCountPresent", present); set("attCountAbsent", absent); set("attCountUnmarked", unmarked);
  const bar = document.getElementById("attRateBar"); if (bar) bar.style.width = rate + "%";

  tmRenderAttendanceSaveBar();

  if (all.length === 0) {
    container.innerHTML = `<div class="tm-empty">No active students yet. Add students first, then come back to mark attendance.</div>`;
    return;
  }

  let rows = all;
  if (tmAttQuery) rows = rows.filter((s) => (s.name + " " + (s.studentId || "")).toLowerCase().includes(tmAttQuery));
  if (tmAttFilter === "Present") rows = rows.filter((s) => tmAttPendingChanges[s.id] === "Present");
  else if (tmAttFilter === "Absent") rows = rows.filter((s) => tmAttPendingChanges[s.id] === "Absent");
  else if (tmAttFilter === "Unmarked") rows = rows.filter((s) => !tmAttPendingChanges[s.id]);

  if (rows.length === 0) {
    container.innerHTML = `<div class="tm-empty">No students match this view.</div>`;
    return;
  }

  const recordByStudent = {};
  tmAttRecordsForDate.forEach((r) => (recordByStudent[r.studentId] = r));

  container.innerHTML = `<div class="tm-datatable dt-att" style="--cols: 44px minmax(0,2.2fr) minmax(0,1fr) 230px;">
    <div class="dt-head"><div>#</div><div>Student</div><div>Marked at</div><div class="num">Status</div></div>
    ${rows
      .map((student, i) => {
        const status = tmAttPendingChanges[student.id];
        const rec = recordByStudent[student.id];
        const time = rec && rec.status === "Present" && status === "Present" && rec.markedAt ? tmFormatTime12h(rec.markedAt) : "—";
        return `
      <div class="dt-row">
        <div class="dt-cell dt-idx">${i + 1}</div>
        <div class="dt-cell main"><span class="tm-name-row">${tmAvatar(student.name)}<span class="min-w-0"><span class="nm">${tmEscapeHtml(student.name)}</span>${student.studentId ? `<span class="sub">ID ${tmEscapeHtml(student.studentId)}</span>` : ""}</span></span></div>
        <div class="dt-cell dt-time">${time}</div>
        <div class="dt-cell dt-act">
          <div class="tm-seg2" role="group" aria-label="Attendance for ${tmEscapeHtml(student.name)}">
            <button type="button" class="present ${status === "Present" ? "on" : ""}" aria-pressed="${status === "Present"}" onclick="tmSetAttendanceStatus('${student.id}','Present')">Present</button>
            <button type="button" class="absent ${status === "Absent" ? "on" : ""}" aria-pressed="${status === "Absent"}" onclick="tmSetAttendanceStatus('${student.id}','Absent')">Absent</button>
          </div>
        </div>
      </div>`;
      })
      .join("")}
  </div>`;
}

function tmRenderAttendanceSaveBar() {
  const dirty = tmAttDirtyIds().length;
  const bar = document.getElementById("attSaveBar");
  if (!bar) return;
  bar.classList.toggle("show", dirty > 0);
  document.getElementById("attDirtyText").textContent = dirty + " unsaved change" + (dirty === 1 ? "" : "s");
  document.getElementById("attDirtyDate").textContent = "For " + tmFormatDate(document.getElementById("attendanceDate").value || tmTodayStr());
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
  tmToast("Everyone marked present. Change any absences, then save.");
}

function tmDiscardAttendanceChanges() {
  tmAttPendingChanges = { ...tmAttSaved };
  tmRenderAttendanceMarkingList();
}

async function tmSaveAttendance() {
  const date = document.getElementById("attendanceDate").value || tmTodayStr();
  const dirtyIds = tmAttDirtyIds();

  if (dirtyIds.length === 0) {
    tmToast("No changes to save.");
    return;
  }

  let savedCount = 0;
  let queuedCount = 0;
  const saveButtons = document.querySelectorAll("[data-save-att]");
  saveButtons.forEach((b) => (b.disabled = true));

  for (const studentId of dirtyIds) {
    const status = tmAttPendingChanges[studentId];
    try {
      await TMDB.markAttendance(studentId, date, status);
      savedCount++;
    } catch (err) {
      // No connection right now — queue it instead of losing the mark.
      // See tmQueueOfflineAttendance in js/utils.js; it syncs
      // automatically once the connection comes back (js/app.js).
      tmQueueOfflineAttendance(studentId, date, status);
      // Display-only patch so History shows the queued mark right away,
      // flagged as not yet confirmed by the server.
      tmAttAllRecords = tmAttAllRecords.filter((r) => !(r.studentId === studentId && r.date === date));
      tmAttAllRecords.push({
        id: "offline-" + studentId + "-" + date,
        studentId,
        date,
        status,
        markedAt: status === "Present" ? new Date().toISOString() : null,
        pendingSync: true,
      });
      queuedCount++;
    }
    tmAttSaved[studentId] = status;
  }
  saveButtons.forEach((b) => (b.disabled = false));

  if (queuedCount > 0) {
    tmToast(`${savedCount} saved, ${queuedCount} queued offline — they'll sync automatically once you're back online.`);
  } else {
    tmToast("Attendance saved for " + tmFormatDate(date) + ".");
    tmAttAllRecords = await TMDB.getAllAttendance();
    tmAttRecordsForDate = await TMDB.getAttendanceForDate(date);
  }

  tmRenderAttendanceMarkingList();
  tmRenderAttendanceHistory();
  tmRefreshOfflineQueueBanner();
}

/** Shows/hides the small banner on the Attendance page when marks are waiting to sync. */
function tmRefreshOfflineQueueBanner() {
  const banner = document.getElementById("offlineQueueBanner");
  if (!banner) return;
  const count = tmGetOfflineAttendanceQueue().length;
  if (count > 0) {
    banner.textContent = `⏳ ${count} attendance record(s) waiting to sync — they'll upload automatically once you're back online.`;
    banner.classList.remove("d-none");
  } else {
    banner.classList.add("d-none");
  }
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
  const hb = document.getElementById("histRateBar"); if (hb) hb.style.width = stats.percentage + "%";

  const listEl = document.getElementById("attendanceHistoryList");
  const holMap = tmHolidayMap(tmAttHolidays, "students");
  const holDates = Object.keys(holMap).filter((d) => tmDateInRange(d, start, end) && new Date(d + "T00:00:00").getDay() !== 0);
  const sub = document.getElementById("historyStatSub");
  if (sub) sub.textContent = holDates.length ? `Days attendance was taken · ${holDates.length} holiday${holDates.length === 1 ? "" : "s"}` : "Days attendance was taken";
  if (records.length === 0 && holDates.length === 0) {
    listEl.innerHTML = `<div class="tm-empty">No attendance records for this filter.</div>`;
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
  const dates = Array.from(new Set([...Object.keys(byDate), ...holDates])).sort((a, b) => (a < b ? 1 : -1)); // newest first

  listEl.innerHTML = dates
    .slice(0, 60)
    .map((date) => {
      const hol = holMap[date];
      if (!byDate[date]) {
        return `
      <div class="tm-datatable dt-hist mb-3">
        <div class="dt-title"><strong>${tmFormatDate(date)}</strong><span class="tm-badge warning">Holiday · ${tmEscapeHtml(hol.name)}</span></div>
      </div>`;
      }
      const dayRecords = byDate[date].sort((a, b) =>
        (studentMap[a.studentId] || "").localeCompare(studentMap[b.studentId] || "")
      );
      const dayPresent = dayRecords.filter((r) => r.status === "Present").length;
      const dayTotal = dayRecords.length;
      const rows = dayRecords
        .map((r) => {
          // markedAt is only set for "Present" records saved by the cloud Worker;
          // older records and Absent records stay blank rather than showing a made-up time.
          const time = r.status === "Present" ? tmFormatTime12h(r.markedAt) : "";
          const pendingTag = r.pendingSync ? `<span class="tm-muted" style="font-size:0.75rem;" title="Not yet synced to the cloud">Waiting to sync</span>` : "";
          const name = studentMap[r.studentId] || "Unknown student";
          return `
        <div class="dt-row" style="--cols: minmax(0,2fr) 1fr 120px;">
          <div class="dt-cell main"><span class="tm-name-row">${tmAvatar(name)}<span class="nm">${tmEscapeHtml(name)}</span></span></div>
          <div class="dt-cell dt-time">${pendingTag}${time ? time : ""}</div>
          <div class="dt-cell dt-act"><span class="tm-badge ${r.status === "Present" ? "success" : "danger"}">${r.status}</span></div>
        </div>`;
        })
        .join("");
      const pct = dayTotal ? Math.round((dayPresent / dayTotal) * 100) : 0;
      return `
      <div class="tm-datatable dt-hist mb-3">
        <div class="dt-title">
          <strong>${tmFormatDate(date)}${hol ? ` <span class="tm-badge warning ms-2">Holiday · ${tmEscapeHtml(hol.name)}</span>` : ""}</strong>
          <span class="d-flex align-items-center gap-2"><span class="tm-progress sm"><span style="width:${pct}%"></span></span><span class="tm-badge neutral">${dayPresent}/${dayTotal} present · ${pct}%</span></span>
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
