/* ==========================================================================
   Smart Academy System — holidays.js
   Holiday calendar: festival / rain / public / other holidays. Students'
   attendance and the staff salary sheet both read from this calendar.
   ========================================================================== */

const TM_HOL_TYPES = { Festival: "Festival", Rain: "Rain", Public: "Public", Other: "Other" };
let tmHolMonth = tmThisMonthKey();
let tmHolList = [];
let tmHolEditing = null;

async function tmInitHolidaysPage() {
  const settings = await tmRequireSetup();
  if (!settings) return;
  tmRenderBottomNav("holidays");

  document.getElementById("holMonthInput").value = tmHolMonth;
  document.getElementById("holMonthInput").addEventListener("change", (e) => { if (e.target.value) { tmHolMonth = e.target.value; tmHolRender(); } });
  document.getElementById("btnHolPrev").addEventListener("click", () => tmHolShift(-1));
  document.getElementById("btnHolNext").addEventListener("click", () => tmHolShift(1));
  document.getElementById("btnHolToday").addEventListener("click", () => { tmHolMonth = tmThisMonthKey(); tmHolRender(); });
  document.getElementById("btnHolAdd").addEventListener("click", () => tmHolOpenModal(null, tmHolDefaultDate()));
  document.getElementById("btnHolQuick").addEventListener("click", tmHolQuickAdd);
  document.getElementById("holForm").addEventListener("submit", tmHolSubmit);
  document.getElementById("btnHolDelete").addEventListener("click", tmHolDelete);
  document.getElementById("holApplies").addEventListener("change", tmHolSyncPaidVisibility);
  document.getElementById("calGrid").addEventListener("click", (e) => {
    const cell = e.target.closest("[data-date]");
    if (!cell) return;
    const h = tmHolList.find((x) => x.date === cell.dataset.date);
    tmHolOpenModal(h || null, cell.dataset.date);
  });
  document.getElementById("holList").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-hol-id]");
    if (!btn) return;
    tmHolOpenModal(tmHolList.find((x) => x.id === btn.dataset.holId) || null, "");
  });

  try {
    tmHolList = await TMDB.getHolidays();
  } catch (err) {
    tmToast(err.message || "Could not load holidays. Make sure the latest backend is deployed.", 5000);
    tmHolList = [];
  }
  tmHolRender();
  if (tmGetQueryParam("add") === "1") tmHolOpenModal(null, tmHolDefaultDate());
}

function tmHolShift(delta) {
  const [y, m] = tmHolMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  tmHolMonth = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  tmHolRender();
}

function tmHolDefaultDate() {
  return tmHolMonth === tmThisMonthKey() ? tmTodayStr() : tmHolMonth + "-01";
}

function tmHolInMonth() {
  return tmHolList.filter((h) => h.date.startsWith(tmHolMonth));
}

function tmHolRender() {
  document.getElementById("holMonthInput").value = tmHolMonth;
  const [y, m] = tmHolMonth.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const monthHolidays = tmHolInMonth();
  const byDate = {};
  monthHolidays.forEach((h) => (byDate[h.date] = h));

  // KPIs
  let sundays = 0, classOff = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(y, m - 1, d);
    const ds = tmHolMonth + "-" + String(d).padStart(2, "0");
    const isSun = dt.getDay() === 0;
    if (isSun) sundays++;
    const h = byDate[ds];
    if (!isSun && h && (h.appliesTo === "both" || h.appliesTo === "students")) classOff++;
  }
  const staffHols = monthHolidays.filter((h) => (h.appliesTo === "both" || h.appliesTo === "staff") && new Date(h.date + "T00:00:00").getDay() !== 0);
  document.getElementById("holKpiCount").textContent = monthHolidays.length;
  document.getElementById("holKpiPaid").textContent = staffHols.filter((h) => h.paidForStaff).length;
  document.getElementById("holKpiUnpaid").textContent = staffHols.filter((h) => !h.paidForStaff).length;
  document.getElementById("holKpiClassDays").textContent = daysInMonth - sundays - classOff;
  document.getElementById("holListMonth").textContent = tmFormatMonthKey(tmHolMonth);

  // Calendar grid
  const startDow = new Date(y, m - 1, 1).getDay();
  const today = tmTodayStr();
  let cells = "";
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = tmHolMonth + "-" + String(d).padStart(2, "0");
    const dow = new Date(y, m - 1, d).getDay();
    const h = byDate[ds];
    const cls = ["cal-cell", dow === 0 ? "sun" : "", ds === today ? "today" : "", h ? "has" : ""].filter(Boolean).join(" ");
    const label = h ? `${tmFormatDate(ds)}: ${h.name}` : tmFormatDate(ds);
    cells += `<button type="button" class="${cls}" data-date="${ds}" aria-label="${tmEscapeHtml(label)}">
      <span class="d">${d}</span>
      ${h ? `<span class="cal-chip t-${h.type}" title="${tmEscapeHtml(h.name)}">${tmEscapeHtml(h.name)}</span>` : ""}
    </button>`;
  }
  const total = startDow + daysInMonth;
  for (let i = 0; i < (7 - (total % 7)) % 7; i++) cells += `<div class="cal-cell empty"></div>`;
  document.getElementById("calGrid").innerHTML = cells;

  // List
  const list = document.getElementById("holList");
  if (monthHolidays.length === 0) {
    list.innerHTML = `<div class="tm-empty">No holidays marked for this month. Tap a date on the calendar to add one.</div>`;
    return;
  }
  const appliesLabel = { both: "Students and staff", students: "Students only", staff: "Staff only" };
  list.innerHTML = `<div class="tm-datatable dt-hol" style="--cols: 130px minmax(0,2fr) 110px 150px 130px 90px;">
    <div class="dt-head"><div>Date</div><div>Holiday</div><div>Type</div><div>Applies to</div><div>Staff pay</div><div></div></div>
    ${monthHolidays
      .map((h) => {
        const staffApplies = h.appliesTo !== "students";
        return `<div class="dt-row">
          <div class="dt-cell" data-label="Date"><strong>${tmFormatDate(h.date)}</strong></div>
          <div class="dt-cell main"><span class="nm">${tmEscapeHtml(h.name)}</span></div>
          <div class="dt-cell"><span class="cal-dot t-${h.type}"></span> ${h.type}</div>
          <div class="dt-cell" data-label="Applies to">${appliesLabel[h.appliesTo] || "Both"}</div>
          <div class="dt-cell">${staffApplies ? (h.paidForStaff ? '<span class="tm-badge success">Paid</span>' : '<span class="tm-badge danger">Unpaid</span>') : '<span class="tm-muted">n/a</span>'}</div>
          <div class="dt-cell dt-act"><button type="button" class="btn btn-tm-outline btn-sm" data-hol-id="${h.id}">Edit</button></div>
        </div>`;
      })
      .join("")}
  </div>`;
}

function tmHolSyncPaidVisibility() {
  const staffApplies = document.getElementById("holApplies").value !== "students";
  document.getElementById("holPaidWrap").classList.toggle("d-none", !staffApplies);
  document.getElementById("holPaidHelp").classList.toggle("d-none", !staffApplies);
}

function tmHolOpenModal(holiday, date) {
  tmHolEditing = holiday;
  document.getElementById("holModalTitle").textContent = holiday ? "Edit holiday" : "Add holiday";
  document.getElementById("holName").value = holiday ? holiday.name : "";
  document.getElementById("holType").value = holiday ? holiday.type : "Festival";
  document.getElementById("holDate").value = holiday ? holiday.date : date;
  document.getElementById("holDate").disabled = !!holiday;
  document.getElementById("holEndDate").value = "";
  document.getElementById("holEndWrap").classList.toggle("d-none", !!holiday);
  document.getElementById("holApplies").value = holiday ? holiday.appliesTo : "both";
  document.getElementById("holPaid").checked = holiday ? holiday.paidForStaff : true;
  document.getElementById("btnHolDelete").classList.toggle("d-none", !holiday);
  tmHolSyncPaidVisibility();
  bootstrap.Modal.getOrCreateInstance(document.getElementById("holModal")).show();
}

async function tmHolSubmit(e) {
  e.preventDefault();
  const name = document.getElementById("holName").value.trim();
  const date = document.getElementById("holDate").value;
  const end = document.getElementById("holEndDate").value;
  if (!name) return tmToast("Give the holiday a name.");
  if (!date) return tmToast("Choose a date.");
  if (end && end < date) return tmToast("The end date is before the start date.");
  const payload = {
    name,
    type: document.getElementById("holType").value,
    appliesTo: document.getElementById("holApplies").value,
    paidForStaff: document.getElementById("holPaid").checked,
  };
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    if (tmHolEditing) await TMDB.updateHoliday(tmHolEditing.id, payload);
    else if (end && end !== date) await TMDB.addHoliday({ ...payload, startDate: date, endDate: end });
    else await TMDB.addHoliday({ ...payload, date });
    bootstrap.Modal.getOrCreateInstance(document.getElementById("holModal")).hide();
    tmToast("Holiday saved.");
    tmHolList = await TMDB.getHolidays();
    if (!tmHolEditing) tmHolMonth = date.slice(0, 7);
    tmHolRender();
  } catch (err) {
    tmToast(err.message || "Could not save the holiday.", 4000);
  } finally {
    btn.disabled = false;
  }
}

async function tmHolDelete() {
  if (!tmHolEditing) return;
  if (!confirm(`Delete the holiday "${tmHolEditing.name}" on ${tmFormatDate(tmHolEditing.date)}?`)) return;
  try {
    await TMDB.deleteHoliday(tmHolEditing.id);
    bootstrap.Modal.getOrCreateInstance(document.getElementById("holModal")).hide();
    tmToast("Holiday deleted.");
    tmHolList = await TMDB.getHolidays();
    tmHolRender();
  } catch (err) {
    tmToast(err.message || "Could not delete the holiday.", 4000);
  }
}

/** Adds the fixed-date national holidays for the year being viewed. You can edit or delete any of them. */
async function tmHolQuickAdd() {
  const year = tmHolMonth.slice(0, 4);
  const fixed = [
    ["01-01", "New Year's Day", "Public"],
    ["01-26", "Republic Day", "Public"],
    ["05-01", "May Day", "Public"],
    ["08-15", "Independence Day", "Public"],
    ["10-02", "Gandhi Jayanti", "Public"],
    ["12-25", "Christmas", "Public"],
  ];
  const existing = new Set(tmHolList.map((h) => h.date));
  const toAdd = fixed.filter(([md]) => !existing.has(year + "-" + md));
  if (toAdd.length === 0) return tmToast("Those national holidays are already on the calendar.");
  if (!confirm(`Add ${toAdd.length} fixed-date national holiday(s) for ${year}?\n\n` + toAdd.map(([md, n]) => `${md}  ${n}`).join("\n") + "\n\nFestival dates that change every year (Diwali, Pongal, Eid…) you add yourself.")) return;
  try {
    for (const [md, name, type] of toAdd) {
      await TMDB.addHoliday({ date: year + "-" + md, name, type, appliesTo: "both", paidForStaff: true });
    }
    tmHolList = await TMDB.getHolidays();
    tmToast("National holidays added.");
    tmHolRender();
  } catch (err) {
    tmToast(err.message || "Could not add the holidays.", 4000);
  }
}
