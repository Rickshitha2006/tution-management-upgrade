/* ==========================================================================
   Smart Academy System — staff.js
   Staff team list, daily staff attendance, and the monthly salary sheet.

   Salary rule (kept simple and visible to the user):
     paid days  = present + paid leave + 0.5 × half days   (never above working days)
     earned     = monthly salary × paid days ÷ working days  (rounded to the rupee)
     net pay    = earned + bonus − advance/deduction         (never below zero)
   Working days default to the days in the month minus Sundays and can be
   changed per staff member per month. Holidays from the holiday calendar:
     paid holiday   -> credited as a paid day, whatever the attendance says
     unpaid holiday -> not credited (unless the person actually worked it)
   ========================================================================== */

const TM_STAFF_STATUSES = ["Present", "Half Day", "Absent", "Leave"];
const TM_STAFF_STATUS_CLASS = { Present: "present", "Half Day": "half", Absent: "absent", Leave: "leave" };
const TM_STAFF_STATUS_LABEL = { Present: "Present", "Half Day": "Half day", Absent: "Absent", Leave: "Leave" };

let tmStaff = [];
let tmStaffAttDraft = {};          // staffId -> status ("" = not marked) for the selected date
let tmSalaryMonth = tmThisMonthKey();
let tmSalaryAttendance = [];
let tmSalaryPayroll = [];
let tmSalaryRows = [];
let tmSalarySettings = null;
let tmSalaryActiveId = null;
let tmStaffHolidays = [];          // every holiday on the calendar
let tmHistMonth = tmThisMonthKey();
let tmHistAttendance = [];

function tmStaffHolMap() { return tmHolidayMap(tmStaffHolidays, "staff"); }

/* ---------------------------- pure salary helpers ---------------------------- */

function tmStaffDefaultWorkingDays(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  let sundays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(y, m - 1, d).getDay() === 0) sundays++;
  }
  return daysInMonth - sundays;
}

function tmStaffShiftMonth(monthKey, delta) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return tmMonthKey(d.getFullYear(), d.getMonth());
}

/**
 * Computes one staff member's salary figures for a month.
 * `saved` is the stored payroll row (if any); `overrides` are values typed
 * into the salary dialog and win over saved values. A row already marked
 * Paid is frozen and returned exactly as stored.
 * `holidays` is a { "YYYY-MM-DD": holiday } map for staff (see tmHolidayMap).
 */
function tmStaffCalcMonth(member, monthKey, attendance, saved, overrides, holidays) {
  if (saved && saved.status === "Paid" && !overrides) {
    const holidayDays = saved.holidayDays || 0;
    return {
      staffId: member.id, name: member.name, role: member.role || "", locked: true, status: "Paid",
      workingDays: saved.workingDays, presentDays: saved.presentDays, halfDays: saved.halfDays,
      leaveDays: saved.leaveDays, absentDays: saved.absentDays, holidayDays, unmarkedDays: 0,
      baseSalary: saved.baseSalary, bonus: saved.bonus, deduction: saved.deduction,
      paidDays: Math.min(saved.workingDays, saved.presentDays + saved.leaveDays + saved.halfDays * 0.5 + holidayDays),
      earned: Math.max(0, saved.netPay - saved.bonus + saved.deduction), netPay: saved.netPay,
      paidDate: saved.paidDate, mode: saved.mode, notes: saved.notes, savedId: saved.id,
    };
  }

  const hmap = holidays || {};
  const isSunday = (ds) => new Date(ds + "T00:00:00").getDay() === 0;
  const paidHoliday = (ds) => !!hmap[ds] && hmap[ds].paidForStaff && !isSunday(ds);

  const mine = attendance.filter((a) => a.staffId === member.id && a.date.startsWith(monthKey));
  // On a paid holiday the day is credited below, so the attendance mark for that day is not counted twice.
  const counted = mine.filter((a) => !paidHoliday(a.date));
  const count = (st) => counted.filter((a) => a.status === st).length;
  const o = overrides || {};
  const num = (v, fallback) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? fallback : Number(v));

  let holidayDays = 0, unpaidHolidayOff = 0;
  const markedDates = new Set(mine.map((a) => a.date));
  Object.keys(hmap).forEach((ds) => {
    if (!ds.startsWith(monthKey) || isSunday(ds)) return;
    if (hmap[ds].paidForStaff) holidayDays += 1;
    else if (!markedDates.has(ds)) unpaidHolidayOff += 1;   // closed and unpaid: neither paid nor "not marked"
  });

  const present = count("Present"), half = count("Half Day"), leave = count("Leave"), absent = count("Absent");
  const workingDays = num(o.workingDays, saved && saved.workingDays ? saved.workingDays : tmStaffDefaultWorkingDays(monthKey));
  const baseSalary = Math.max(0, num(o.baseSalary, saved ? saved.baseSalary : member.monthlySalary));
  const bonus = Math.max(0, num(o.bonus, saved ? saved.bonus : 0));
  const deduction = Math.max(0, num(o.deduction, saved ? saved.deduction : 0));

  const paidDays = Math.min(workingDays, present + leave + half * 0.5 + holidayDays);
  const earned = workingDays > 0 ? Math.round((baseSalary * paidDays) / workingDays) : 0;
  const netPay = Math.max(0, earned + bonus - deduction);

  return {
    staffId: member.id, name: member.name, role: member.role || "", locked: false, status: "Pending",
    workingDays, presentDays: present, halfDays: half, leaveDays: leave, absentDays: absent, holidayDays,
    unmarkedDays: Math.max(0, workingDays - (present + half + leave + absent + holidayDays + unpaidHolidayOff)),
    baseSalary, bonus, deduction, paidDays, earned, netPay,
    paidDate: "", mode: saved ? saved.mode : "", notes: saved ? saved.notes : "", savedId: saved ? saved.id : null,
  };
}

function tmFmtDays(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/* ---------------------------- page init ---------------------------- */

async function tmInitStaffPage() {
  tmSalarySettings = await tmRequireSetup();
  if (!tmSalarySettings) return;
  tmRenderBottomNav("staff");

  document.getElementById("staffAttDate").value = tmTodayStr();
  tmWireStaffControls();

  try {
    tmStaffHolidays = await TMDB.getHolidays().catch(() => []);
    await tmReloadStaff();
    await tmLoadStaffAttendanceForDate();
    await tmLoadSalary();
    await tmLoadStaffHistory();
  } catch (err) {
    tmToast(err.message || "Could not load staff data.", 4000);
  }

  const tab = tmGetQueryParam("tab");
  if (tab === "attendance") bootstrap.Tab.getOrCreateInstance(document.getElementById("staffatt-tab")).show();
  if (tab === "salary") bootstrap.Tab.getOrCreateInstance(document.getElementById("salary-tab")).show();
  if (tab === "history") bootstrap.Tab.getOrCreateInstance(document.getElementById("staffhist-tab")).show();
  if (tmGetQueryParam("add") === "1") tmOpenStaffModal(null);
}

function tmWireStaffControls() {
  document.getElementById("staffSearchInput").addEventListener("input", tmRenderStaffList);
  document.getElementById("btnAddStaff").addEventListener("click", () => tmOpenStaffModal(null));
  document.getElementById("staffForm").addEventListener("submit", tmSubmitStaffForm);
  document.getElementById("btnDeleteStaff").addEventListener("click", tmDeleteStaffConfirmed);
  document.getElementById("staffListContainer").addEventListener("click", (e) => {
    const card = e.target.closest("[data-staff-id]");
    if (card) tmOpenStaffModal(card.dataset.staffId);
  });

  // attendance
  document.getElementById("staffAttDate").addEventListener("change", tmLoadStaffAttendanceForDate);
  document.getElementById("btnStaffAllPresent").addEventListener("click", () => {
    tmActiveStaff().forEach((m) => (tmStaffAttDraft[m.id] = "Present"));
    tmRenderStaffAttendance();
  });
  document.getElementById("btnSaveStaffAtt").addEventListener("click", tmSaveStaffAttendance);
  document.getElementById("btnStaffDayPrev").addEventListener("click", () => tmShiftStaffDay(-1));
  document.getElementById("btnStaffDayNext").addEventListener("click", () => tmShiftStaffDay(1));
  document.getElementById("btnStaffDayToday").addEventListener("click", () => { document.getElementById("staffAttDate").value = tmTodayStr(); tmLoadStaffAttendanceForDate(); });

  // history
  document.getElementById("histMonthInput").value = tmHistMonth;
  document.getElementById("histMonthInput").addEventListener("change", (e) => { if (e.target.value) { tmHistMonth = e.target.value; tmLoadStaffHistory(); } });
  document.getElementById("btnHistPrev").addEventListener("click", () => { tmHistMonth = tmStaffShiftMonth(tmHistMonth, -1); tmLoadStaffHistory(); });
  document.getElementById("btnHistNext").addEventListener("click", () => { tmHistMonth = tmStaffShiftMonth(tmHistMonth, 1); tmLoadStaffHistory(); });
  document.getElementById("btnHistThisMonth").addEventListener("click", () => { tmHistMonth = tmThisMonthKey(); tmLoadStaffHistory(); });
  document.getElementById("histStaffSelect").addEventListener("change", tmRenderStaffHistory);
  document.getElementById("btnHistExport").addEventListener("click", tmExportStaffHistory);
  document.getElementById("staffAttList").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-status]");
    if (!btn) return;
    const id = btn.dataset.staffId;
    tmStaffAttDraft[id] = tmStaffAttDraft[id] === btn.dataset.status ? "" : btn.dataset.status;
    tmRenderStaffAttendance();
  });

  // salary
  document.getElementById("btnSalaryPrev").addEventListener("click", () => tmChangeSalaryMonth(-1));
  document.getElementById("btnSalaryNext").addEventListener("click", () => tmChangeSalaryMonth(1));
  document.getElementById("btnExportSalary").addEventListener("click", tmExportSalarySheet);
  document.getElementById("salaryTableWrap").addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-staff-id]");
    if (row) tmOpenSalaryModal(row.dataset.staffId);
  });
  ["salWorkingDays", "salBase", "salBonus", "salDeduction"].forEach((id) =>
    document.getElementById(id).addEventListener("input", tmRecalcSalaryModal)
  );
  document.getElementById("btnSalarySave").addEventListener("click", () => tmSaveSalary("Pending"));
  document.getElementById("btnSalaryTogglePaid").addEventListener("click", tmToggleSalaryPaid);
  document.getElementById("btnSalaryPayslip").addEventListener("click", tmDownloadPayslip);
}

function tmActiveStaff() {
  return tmStaff.filter((m) => m.active !== false);
}

async function tmReloadStaff() {
  tmStaff = await TMDB.getAllStaff();
  tmRenderStaffList();
}

/* ---------------------------- team tab ---------------------------- */

function tmRenderStaffList() {
  const q = (document.getElementById("staffSearchInput").value || "").trim().toLowerCase();
  const active = tmActiveStaff();
  document.getElementById("teamActiveCount").textContent = active.length;
  document.getElementById("teamInactiveCount").textContent = tmStaff.length - active.length;
  document.getElementById("teamPayroll").textContent = tmFormatCurrency(active.reduce((s, m) => s + (m.monthlySalary || 0), 0));

  const rows = tmStaff.filter((m) => !q || (m.name + " " + (m.role || "")).toLowerCase().includes(q));
  const el = document.getElementById("staffListContainer");
  if (rows.length === 0) {
    el.innerHTML = tmStaff.length === 0
      ? `<div class="tm-empty">No staff added yet. Add your first teacher or assistant to start tracking attendance and salary.</div>`
      : `<div class="tm-empty">No staff match this search.</div>`;
    return;
  }
  el.innerHTML = rows
    .map((m) => `
      <div class="tm-index-card ${m.active === false ? "inactive" : ""}" data-staff-id="${m.id}" style="cursor:pointer;">
        <div class="d-flex justify-content-between align-items-start gap-2">
          <span class="tm-name-row">${tmAvatar(m.name)}<span class="name">${tmEscapeHtml(m.name)}</span></span>
          ${m.active === false ? '<span class="tm-badge neutral">Inactive</span>' : ""}
        </div>
        <div class="meta">${tmEscapeHtml(m.role || "No role set")}${m.phone ? " · " + tmEscapeHtml(m.phone) : ""}</div>
        <div class="stat-row">
          <span><strong>${tmFormatCurrency(m.monthlySalary)}</strong> / month</span>
          ${m.joiningDate ? `<span class="tm-muted">Joined ${tmFormatDate(m.joiningDate)}</span>` : ""}
        </div>
      </div>`)
    .join("");
}

function tmOpenStaffModal(id) {
  const m = id ? tmStaff.find((s) => s.id === id) : null;
  document.getElementById("staffModalTitle").textContent = m ? "Edit staff" : "Add staff";
  document.getElementById("staffForm").dataset.editId = m ? m.id : "";
  document.getElementById("staffName").value = m ? m.name : "";
  document.getElementById("staffRole").value = m ? m.role : "";
  document.getElementById("staffPhone").value = m ? m.phone : "";
  document.getElementById("staffJoining").value = m ? m.joiningDate : tmTodayStr();
  document.getElementById("staffSalary").value = m ? m.monthlySalary : "";
  document.getElementById("staffNotes").value = m ? m.notes : "";
  document.getElementById("staffActive").checked = m ? m.active !== false : true;
  document.getElementById("btnDeleteStaff").classList.toggle("d-none", !m);
  bootstrap.Modal.getOrCreateInstance(document.getElementById("staffModal")).show();
}

async function tmSubmitStaffForm(e) {
  e.preventDefault();
  const form = e.target;
  const name = document.getElementById("staffName").value.trim();
  const salary = Number(document.getElementById("staffSalary").value);
  if (!name) return tmToast("Enter the staff member's name.");
  if (!(salary >= 0) || document.getElementById("staffSalary").value === "") return tmToast("Enter a monthly salary (0 or more).");

  const payload = {
    name,
    role: document.getElementById("staffRole").value.trim(),
    phone: document.getElementById("staffPhone").value.trim(),
    joiningDate: document.getElementById("staffJoining").value,
    monthlySalary: salary,
    notes: document.getElementById("staffNotes").value.trim(),
    active: document.getElementById("staffActive").checked,
  };

  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    if (form.dataset.editId) await TMDB.updateStaff(form.dataset.editId, payload);
    else await TMDB.addStaff(payload);
    bootstrap.Modal.getOrCreateInstance(document.getElementById("staffModal")).hide();
    tmToast(form.dataset.editId ? "Staff updated." : "Staff added.");
    await tmReloadStaff();
    tmRenderStaffAttendance();
    await tmLoadSalary();
    tmPopulateHistStaffSelect();
    tmRenderStaffHistory();
  } catch (err) {
    tmToast(err.message || "Could not save staff.", 3500);
  } finally {
    btn.disabled = false;
  }
}

async function tmDeleteStaffConfirmed() {
  const id = document.getElementById("staffForm").dataset.editId;
  const m = tmStaff.find((s) => s.id === id);
  if (!m) return;
  if (!confirm(`Delete ${m.name}? Their attendance and salary records will also be deleted. Mark them inactive instead if you only want to hide them.`)) return;
  try {
    await TMDB.deleteStaff(id);
    bootstrap.Modal.getOrCreateInstance(document.getElementById("staffModal")).hide();
    tmToast("Staff deleted.");
    await tmReloadStaff();
    tmRenderStaffAttendance();
    await tmLoadSalary();
  } catch (err) {
    tmToast(err.message || "Could not delete staff.", 3500);
  }
}

/* ---------------------------- attendance tab ---------------------------- */

async function tmLoadStaffAttendanceForDate() {
  const date = document.getElementById("staffAttDate").value || tmTodayStr();
  const d = new Date(date + "T00:00:00");
  document.getElementById("staffAttDateLabel").innerHTML = d.toLocaleDateString("en-IN", { weekday: "long" }) + "<small>" + tmFormatDate(date) + "</small>";
  const records = await TMDB.getStaffAttendanceForDate(date);
  tmStaffAttDraft = {};
  records.forEach((r) => (tmStaffAttDraft[r.staffId] = r.status));
  tmRenderStaffHolidayBanner(date);
  tmRenderStaffAttendance();
}

function tmShiftStaffDay(delta) {
  const input = document.getElementById("staffAttDate");
  const d = new Date((input.value || tmTodayStr()) + "T00:00:00");
  d.setDate(d.getDate() + delta);
  input.value = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  tmLoadStaffAttendanceForDate();
}

function tmRenderStaffHolidayBanner(date) {
  const el = document.getElementById("staffHolidayBanner");
  const h = tmStaffHolMap()[date];
  const isSunday = new Date(date + "T00:00:00").getDay() === 0;
  if (h && !isSunday) {
    el.className = "tm-banner " + (h.type === "Rain" ? "rain" : "");
    el.innerHTML = `<span><strong>Holiday: ${tmEscapeHtml(h.name)}.</strong> ${h.paidForStaff ? "Paid for staff, so salary is not affected." : "Unpaid for staff: this day is not credited in the salary sheet unless someone actually works."}</span><a class="btn btn-tm-outline btn-sm" href="holidays.html">Calendar</a>`;
  } else if (isSunday) {
    el.className = "tm-banner";
    el.innerHTML = `<span><strong>Sunday.</strong> Weekly off. Mark attendance only for staff who worked.</span>`;
  } else {
    el.className = "tm-banner d-none";
    el.innerHTML = "";
  }
}

function tmRenderStaffAttendance() {
  const el = document.getElementById("staffAttList");
  const active = tmActiveStaff();

  const present = active.filter((m) => tmStaffAttDraft[m.id] === "Present" || tmStaffAttDraft[m.id] === "Half Day").length;
  const away = active.filter((m) => tmStaffAttDraft[m.id] === "Absent" || tmStaffAttDraft[m.id] === "Leave").length;
  const marked = present + away;
  const rate = marked > 0 ? Math.round((present / marked) * 100) : 0;
  const setT = (id, v) => { const x = document.getElementById(id); if (x) x.textContent = v; };
  setT("staffAttKpiTotal", active.length); setT("staffAttKpiPresent", present); setT("staffAttKpiAbsent", away);
  setT("staffAttKpiUnmarked", active.length - marked + " not marked"); setT("staffAttKpiRate", rate + "%");
  const bar = document.getElementById("staffAttRateBar"); if (bar) bar.style.width = rate + "%";
  if (active.length === 0) {
    el.innerHTML = `<div class="tm-empty">No active staff yet. Add staff in the Team tab to mark attendance.</div>`;
    return;
  }
  el.innerHTML = active
    .map((m) => {
      const current = tmStaffAttDraft[m.id] || "";
      const buttons = TM_STAFF_STATUSES.map(
        (s) => `<button type="button" data-staff-id="${m.id}" data-status="${s}" class="${TM_STAFF_STATUS_CLASS[s]} ${current === s ? "selected" : ""}" aria-pressed="${current === s}">${TM_STAFF_STATUS_LABEL[s]}</button>`
      ).join("");
      return `<div class="tm-attend-row tm-staff-row">
        <div class="tm-name-row">${tmAvatar(m.name)}<div class="min-w-0"><div class="student-name">${tmEscapeHtml(m.name)}</div>${m.role ? `<div class="tm-muted" style="font-size:0.8rem;">${tmEscapeHtml(m.role)}</div>` : ""}</div></div>
        <div class="tm-attend-toggle">${buttons}</div>
      </div>`;
    })
    .join("");
}

async function tmSaveStaffAttendance() {
  const date = document.getElementById("staffAttDate").value;
  if (!date) return tmToast("Choose a date first.");
  const records = tmActiveStaff().map((m) => ({ staffId: m.id, status: tmStaffAttDraft[m.id] || "" }));
  const btn = document.getElementById("btnSaveStaffAtt");
  btn.disabled = true;
  try {
    await TMDB.saveStaffAttendance(date, records);
    tmToast("Staff attendance saved.");
    await tmLoadSalary();
    await tmLoadStaffHistory();
  } catch (err) {
    tmToast(err.message || "Could not save attendance.", 3500);
  } finally {
    btn.disabled = false;
  }
}

/* ---------------------------- salary tab ---------------------------- */

async function tmChangeSalaryMonth(delta) {
  tmSalaryMonth = tmStaffShiftMonth(tmSalaryMonth, delta);
  await tmLoadSalary();
}

async function tmLoadSalary() {
  document.getElementById("salaryMonthLabel").textContent = tmFormatMonthKey(tmSalaryMonth);
  try {
    [tmSalaryAttendance, tmSalaryPayroll] = await Promise.all([
      TMDB.getStaffAttendanceForMonth(tmSalaryMonth),
      TMDB.getStaffPayrollForMonth(tmSalaryMonth),
    ]);
  } catch (err) {
    tmToast(err.message || "Could not load the salary sheet.", 3500);
    return;
  }
  tmComputeSalaryRows();
  tmRenderSalaryTable();
}

function tmComputeSalaryRows() {
  const savedByStaff = {};
  tmSalaryPayroll.forEach((p) => (savedByStaff[p.staffId] = p));
  tmSalaryRows = tmStaff
    .filter((m) => m.active !== false || savedByStaff[m.id])
    .map((m) => tmStaffCalcMonth(m, tmSalaryMonth, tmSalaryAttendance, savedByStaff[m.id], null, tmStaffHolMap()));
}

function tmRenderSalaryTable() {
  const wrap = document.getElementById("salaryTableWrap");
  const rows = tmSalaryRows;
  const totalNet = rows.reduce((s, r) => s + r.netPay, 0);
  const totalPaid = rows.filter((r) => r.status === "Paid").reduce((s, r) => s + r.netPay, 0);
  document.getElementById("salaryTotalNet").textContent = tmFormatCurrency(totalNet);
  document.getElementById("salaryTotalPaid").textContent = tmFormatCurrency(totalPaid);
  document.getElementById("salaryTotalPending").textContent = tmFormatCurrency(totalNet - totalPaid);

  if (rows.length === 0) {
    wrap.innerHTML = `<div class="tm-empty m-3">No staff to show for this month. Add staff in the Team tab.</div>`;
    return;
  }
  wrap.innerHTML = `<table class="tm-month-table">
    <thead><tr><th>Staff</th><th class="num">Paid days</th><th class="num">Salary</th><th class="num">Bonus</th><th class="num">Deduction</th><th class="num">Net pay</th><th>Status</th></tr></thead>
    <tbody>${rows
      .map(
        (r) => `<tr class="clickable" data-staff-id="${r.staffId}">
          <td><strong>${tmEscapeHtml(r.name)}</strong>${r.unmarkedDays > 0 && !r.locked ? `<div class="tm-muted" style="font-size:0.72rem;">${tmFmtDays(r.unmarkedDays)} day(s) not marked</div>` : ""}</td>
          <td class="num">${tmFmtDays(r.paidDays)} / ${tmFmtDays(r.workingDays)}</td>
          <td class="num">${tmFormatCurrency(r.baseSalary)}</td>
          <td class="num">${r.bonus ? tmFormatCurrency(r.bonus) : "–"}</td>
          <td class="num">${r.deduction ? tmFormatCurrency(r.deduction) : "–"}</td>
          <td class="num"><strong>${tmFormatCurrency(r.netPay)}</strong></td>
          <td><span class="tm-badge ${r.status === "Paid" ? "success" : "warning"}">${r.status}</span></td>
        </tr>`
      )
      .join("")}</tbody>
    <tfoot><tr><td>Total</td><td></td><td class="num">${tmFormatCurrency(rows.reduce((s, r) => s + r.baseSalary, 0))}</td><td></td><td></td><td class="num">${tmFormatCurrency(totalNet)}</td><td></td></tr></tfoot>
  </table>`;
}

/* ---------------------------- salary dialog ---------------------------- */

function tmOpenSalaryModal(staffId) {
  const row = tmSalaryRows.find((r) => r.staffId === staffId);
  if (!row) return;
  tmSalaryActiveId = staffId;

  document.getElementById("salaryModalTitle").textContent = row.name;
  document.getElementById("salaryModalSub").textContent = (row.role ? row.role + " · " : "") + tmFormatMonthKey(tmSalaryMonth);
  document.getElementById("salWorkingDays").value = row.workingDays;
  document.getElementById("salBase").value = row.baseSalary;
  document.getElementById("salBonus").value = row.bonus || "";
  document.getElementById("salDeduction").value = row.deduction || "";
  document.getElementById("salPaidDate").value = row.paidDate || tmTodayStr();
  document.getElementById("salMode").value = row.mode || "Cash";
  document.getElementById("salNotes").value = row.notes || "";

  const locked = row.locked;
  ["salWorkingDays", "salBase", "salBonus", "salDeduction", "salPaidDate", "salMode", "salNotes"].forEach(
    (id) => (document.getElementById(id).disabled = locked)
  );
  document.getElementById("salaryLockedNote").classList.toggle("d-none", !locked);
  document.getElementById("btnSalarySave").classList.toggle("d-none", locked);
  const toggle = document.getElementById("btnSalaryTogglePaid");
  toggle.textContent = locked ? "Mark as pending" : "Mark as paid";
  toggle.className = "btn " + (locked ? "btn-tm-outline" : "btn-tm-primary");

  document.getElementById("salaryAttSummary").innerHTML = [
    ["Present", row.presentDays], ["Half day", row.halfDays], ["Leave", row.leaveDays], ["Absent", row.absentDays], ["Holiday", row.holidayDays || 0],
  ].map(([l, v]) => `<div class="tm-stat-tile" style="padding:10px;"><div class="value" style="font-size:1.2rem;">${tmFmtDays(v)}</div><div class="label">${l}</div></div>`).join("");

  tmRecalcSalaryModal();
  bootstrap.Modal.getOrCreateInstance(document.getElementById("salaryModal")).show();
}

function tmReadSalaryInputs() {
  return {
    workingDays: document.getElementById("salWorkingDays").value,
    baseSalary: document.getElementById("salBase").value,
    bonus: document.getElementById("salBonus").value,
    deduction: document.getElementById("salDeduction").value,
  };
}

function tmCurrentSalaryCalc() {
  const member = tmStaff.find((m) => m.id === tmSalaryActiveId);
  if (!member) return null;
  const saved = tmSalaryPayroll.find((p) => p.staffId === member.id) || null;
  return tmStaffCalcMonth(member, tmSalaryMonth, tmSalaryAttendance, saved && saved.status === "Paid" ? { ...saved, status: "Pending" } : saved, tmReadSalaryInputs(), tmStaffHolMap());
}

function tmRecalcSalaryModal() {
  const calc = tmCurrentSalaryCalc();
  if (!calc) return;
  document.getElementById("salPaidDays").textContent = tmFmtDays(calc.paidDays) + " of " + tmFmtDays(calc.workingDays);
  document.getElementById("salEarned").textContent = tmFormatCurrency(calc.earned);
  document.getElementById("salNet").textContent = tmFormatCurrency(calc.netPay);
}

async function tmSaveSalary(status) {
  const row = tmSalaryRows.find((r) => r.staffId === tmSalaryActiveId);
  const calc = row && row.locked && status === "Paid" ? row : tmCurrentSalaryCalc();
  if (!calc) return;
  if (!(calc.workingDays > 0)) return tmToast("Working days must be more than 0.");

  const paidDate = document.getElementById("salPaidDate").value;
  if (status === "Paid" && !paidDate) return tmToast("Choose the date the salary was paid.");

  const body = {
    staffId: calc.staffId, month: tmSalaryMonth, workingDays: calc.workingDays,
    presentDays: calc.presentDays, halfDays: calc.halfDays, leaveDays: calc.leaveDays, absentDays: calc.absentDays, holidayDays: calc.holidayDays || 0,
    baseSalary: calc.baseSalary, bonus: calc.bonus, deduction: calc.deduction, netPay: calc.netPay,
    status, paidDate: status === "Paid" ? paidDate : "", mode: document.getElementById("salMode").value,
    notes: document.getElementById("salNotes").value.trim(),
  };
  try {
    await TMDB.saveStaffPayroll(body);
    bootstrap.Modal.getOrCreateInstance(document.getElementById("salaryModal")).hide();
    tmToast(status === "Paid" ? "Marked as paid." : "Salary saved.");
    await tmLoadSalary();
  } catch (err) {
    tmToast(err.message || "Could not save the salary.", 3500);
  }
}

async function tmToggleSalaryPaid() {
  const row = tmSalaryRows.find((r) => r.staffId === tmSalaryActiveId);
  if (!row) return;
  if (row.locked) {
    // Unlock: re-save the stored figures as pending so they can be edited.
    const saved = tmSalaryPayroll.find((p) => p.staffId === row.staffId);
    try {
      await TMDB.saveStaffPayroll({ ...saved, status: "Pending", paidDate: "" });
      bootstrap.Modal.getOrCreateInstance(document.getElementById("salaryModal")).hide();
      tmToast("Marked as pending.");
      await tmLoadSalary();
    } catch (err) {
      tmToast(err.message || "Could not update the salary.", 3500);
    }
    return;
  }
  await tmSaveSalary("Paid");
}

/* ---------------------------- exports ---------------------------- */

function tmExportSalarySheet() {
  if (tmSalaryRows.length === 0) return tmToast("There is nothing to export for this month.");
  const center = (tmSalarySettings && tmSalarySettings.tuitionCenterName) || "Smart Academy System";
  const rows = [
    [center + " — Staff salary sheet — " + tmFormatMonthKey(tmSalaryMonth)],
    [],
    ["Staff", "Role", "Working days", "Present", "Half day", "Leave", "Absent", "Paid holidays", "Paid days", "Monthly salary", "Earned", "Bonus", "Deduction", "Net pay", "Status", "Paid on", "Mode"],
  ];
  tmSalaryRows.forEach((r) =>
    rows.push([r.name, r.role, r.workingDays, r.presentDays, r.halfDays, r.leaveDays, r.absentDays, r.holidayDays || 0, r.paidDays, r.baseSalary, r.earned, r.bonus, r.deduction, r.netPay, r.status, r.paidDate ? tmFormatDate(r.paidDate) : "", r.mode || ""])
  );
  rows.push([], ["Total", "", "", "", "", "", "", "", tmSalaryRows.reduce((s, r) => s + r.baseSalary, 0), "", "", "", tmSalaryRows.reduce((s, r) => s + r.netPay, 0)]);
  tmDownloadCsv(`salary-sheet-${tmSalaryMonth}.csv`, rows);
}

async function tmDownloadPayslip() {
  const calc = tmCurrentSalaryCalc();
  const row = tmSalaryRows.find((r) => r.staffId === tmSalaryActiveId);
  const d = row && row.locked ? row : calc;
  const member = tmStaff.find((m) => m.id === tmSalaryActiveId);
  if (!d || !member) return;

  try {
    const jsPDF = await tmLoadJsPdf();
    const settings = tmSalarySettings || {};
    const centerName = settings.tuitionCenterName || "Smart Academy System";
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    tmDrawPageBorder(doc);
    let y = await tmDrawReportHeader(doc, settings, "SALARY SLIP", tmFormatMonthKey(tmSalaryMonth));

    const L = TM_PDF_MARGIN_MM, R = TM_PDF_PAGE_WIDTH_MM - TM_PDF_MARGIN_MM;
    const line = (label, value, bold) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(bold ? 11.5 : 10.5);
      doc.setTextColor(30, 30, 30);
      doc.text(label, L, y);
      doc.text(String(value), R, y, { align: "right" });
      y += bold ? 9 : 7.5;
    };
    const rule = () => { doc.setDrawColor(210, 210, 210); doc.line(L, y - 4, R, y - 4); };

    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(47, 43, 147);
    doc.text(member.name, L, y); y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(90, 90, 90);
    doc.text([member.role, member.phone].filter(Boolean).join("  |  ") || " ", L, y); y += 10;

    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(47, 43, 147);
    doc.text("ATTENDANCE", L, y); y += 7;
    line("Working days", tmFmtDays(d.workingDays));
    line("Present", tmFmtDays(d.presentDays));
    line("Half days", tmFmtDays(d.halfDays));
    line("Paid leave", tmFmtDays(d.leaveDays));
    line("Absent", tmFmtDays(d.absentDays));
    line("Paid holidays", tmFmtDays(d.holidayDays || 0));
    line("Paid days", tmFmtDays(d.paidDays), true);
    y += 3;

    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(47, 43, 147);
    doc.text("EARNINGS AND DEDUCTIONS", L, y); y += 7;
    line("Monthly salary", tmFormatCurrencyForPdf(d.baseSalary));
    line("Earned for attendance", tmFormatCurrencyForPdf(d.earned));
    line("Bonus", tmFormatCurrencyForPdf(d.bonus));
    line("Advance / deduction", "- " + tmFormatCurrencyForPdf(d.deduction));
    rule();
    line("Net pay", tmFormatCurrencyForPdf(d.netPay), true);
    y += 2;
    const paid = row && row.locked;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(90, 90, 90);
    doc.text(paid ? `Paid on ${tmFormatDate(row.paidDate)}${row.mode ? " by " + row.mode : ""}` : "Payment status: pending", L, y);

    await tmDrawSignatureBlock(doc, settings, y);
    tmStampFootersAndPageNumbers(doc, centerName, tmFormatMonthKey(tmSalaryMonth));
    await tmDownloadOrSharePdf(doc, `${tmSanitizeFilename(member.name)}-Salary-Slip-${tmSalaryMonth}.pdf`, "Salary slip — " + member.name);
  } catch (err) {
    tmToast(err.message || "Could not create the payslip.", 3500);
  }
}


/* ---------------------------- history (monthly register) ---------------------------- */

async function tmLoadStaffHistory() {
  document.getElementById("histMonthInput").value = tmHistMonth;
  try {
    tmHistAttendance = await TMDB.getStaffAttendanceForMonth(tmHistMonth);
  } catch (err) {
    tmToast(err.message || "Could not load attendance history.", 3500);
    tmHistAttendance = [];
  }
  tmPopulateHistStaffSelect();
  tmRenderStaffHistory();
}

function tmPopulateHistStaffSelect() {
  const sel = document.getElementById("histStaffSelect");
  const current = sel.value;
  sel.innerHTML = `<option value="">All staff</option>` + tmStaff.map((m) => `<option value="${m.id}">${tmEscapeHtml(m.name)}</option>`).join("");
  if (current && tmStaff.some((m) => m.id === current)) sel.value = current;
}

function tmHistRows() {
  const only = document.getElementById("histStaffSelect").value;
  return tmStaff.filter((m) => (only ? m.id === only : m.active !== false || tmHistAttendance.some((a) => a.staffId === m.id)));
}

function tmRenderStaffHistory() {
  const [y, mo] = tmHistMonth.split("-").map(Number);
  const dim = new Date(y, mo, 0).getDate();
  const hmap = tmStaffHolMap();
  const rows = tmHistRows();
  const code = { Present: ["P", "c-P"], "Half Day": ["½", "c-H"], Leave: ["L", "c-L"], Absent: ["A", "c-A"] };

  let tp = 0, th = 0, tl = 0, ta = 0;
  const dayHead = [];
  for (let d = 1; d <= dim; d++) {
    const ds = tmHistMonth + "-" + String(d).padStart(2, "0");
    const dow = new Date(y, mo - 1, d).getDay();
    dayHead.push(`<th class="${dow === 0 ? "sunhead" : ""}" title="${tmFormatDate(ds)}">${d}<div style="font-weight:600;opacity:.7">${"SMTWTFS"[dow]}</div></th>`);
  }

  const body = rows
    .map((m) => {
      const mine = tmHistAttendance.filter((a) => a.staffId === m.id);
      const byDate = {};
      mine.forEach((a) => (byDate[a.date] = a.status));
      let p = 0, h = 0, l = 0, a = 0;
      mine.forEach((r) => { if (r.status === "Present") p++; else if (r.status === "Half Day") h++; else if (r.status === "Leave") l++; else if (r.status === "Absent") a++; });
      tp += p; th += h; tl += l; ta += a;
      const calc = tmStaffCalcMonth(m, tmHistMonth, tmHistAttendance, null, null, hmap);
      let cells = "";
      for (let d = 1; d <= dim; d++) {
        const ds = tmHistMonth + "-" + String(d).padStart(2, "0");
        const dow = new Date(y, mo - 1, d).getDay();
        const st = byDate[ds];
        const hol = hmap[ds];
        if (st) cells += `<td class="${code[st][1]}" title="${tmFormatDate(ds)}: ${st}${hol ? " (holiday: " + tmEscapeHtml(hol.name) + ")" : ""}">${code[st][0]}</td>`;
        else if (hol && dow !== 0) cells += `<td class="c-HOL t-${hol.type}" title="${tmEscapeHtml(hol.name)} (${hol.paidForStaff ? "paid" : "unpaid"} holiday)">●</td>`;
        else if (dow === 0) cells += `<td class="c-S">–</td>`;
        else cells += `<td></td>`;
      }
      return `<tr><td class="name">${tmEscapeHtml(m.name)}${m.active === false ? ' <span class="tm-muted" style="font-weight:600">(inactive)</span>' : ""}</td>${cells}<td class="sum">${p}</td><td class="sum">${h}</td><td class="sum">${l}</td><td class="sum">${a}</td><td class="sum paid">${tmFmtDays(calc.paidDays)}</td></tr>`;
    })
    .join("");

  document.getElementById("histKpiPresent").textContent = tmFmtDays(tp);
  document.getElementById("histKpiHalf").textContent = tmFmtDays(th);
  document.getElementById("histKpiLeave").textContent = tmFmtDays(tl);
  document.getElementById("histKpiAbsent").textContent = tmFmtDays(ta);

  const el = document.getElementById("staffRegister");
  if (rows.length === 0) {
    el.innerHTML = `<div class="tm-empty m-3">No staff to show. Add staff in the Team tab.</div>`;
    return;
  }
  el.innerHTML = `<table class="reg"><thead><tr><th class="name">Staff</th>${dayHead.join("")}<th class="sum" title="Present days">P</th><th class="sum" title="Half days">½</th><th class="sum" title="Paid leave">L</th><th class="sum" title="Absent days">A</th><th class="sum" title="Paid days incl. paid holidays">Paid</th></tr></thead><tbody>${body}</tbody></table>`;
}

function tmExportStaffHistory() {
  const [y, mo] = tmHistMonth.split("-").map(Number);
  const dim = new Date(y, mo, 0).getDate();
  const hmap = tmStaffHolMap();
  const rows = tmHistRows();
  if (rows.length === 0) return tmToast("There is nothing to export.");
  const head = ["Staff"];
  for (let d = 1; d <= dim; d++) head.push(String(d));
  head.push("Present", "Half days", "Leave", "Absent", "Paid days");
  const short = { Present: "P", "Half Day": "1/2", Leave: "L", Absent: "A" };
  const out = [["Staff attendance register — " + tmFormatMonthKey(tmHistMonth)], [], head];
  rows.forEach((m) => {
    const mine = tmHistAttendance.filter((a) => a.staffId === m.id);
    const by = {}; mine.forEach((a) => (by[a.date] = a.status));
    const cells = [];
    for (let d = 1; d <= dim; d++) {
      const ds = tmHistMonth + "-" + String(d).padStart(2, "0");
      const dow = new Date(y, mo - 1, d).getDay();
      cells.push(by[ds] ? short[by[ds]] : hmap[ds] && dow !== 0 ? "Hol" : dow === 0 ? "Sun" : "");
    }
    const calc = tmStaffCalcMonth(m, tmHistMonth, tmHistAttendance, null, null, hmap);
    out.push([m.name, ...cells, mine.filter((a) => a.status === "Present").length, mine.filter((a) => a.status === "Half Day").length, mine.filter((a) => a.status === "Leave").length, mine.filter((a) => a.status === "Absent").length, calc.paidDays]);
  });
  tmDownloadCsv(`staff-attendance-${tmHistMonth}.csv`, out);
}
