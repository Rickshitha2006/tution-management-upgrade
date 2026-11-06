/* ==========================================================================
   Tuition Manager — fees.js
   ========================================================================== */

let tmFeesStudents = [];
let tmFeesPayments = [];
let tmFeesMonth = tmThisMonthKey();
let tmFeesStatusFilter = "all";

async function tmInitFeesPage() {
  await tmRequireSetup();
  await tmLoadHeaderInfo();
  tmRenderBottomNav("fees");

  document.getElementById("paymentForm").addEventListener("submit", tmSavePayment);
  document.getElementById("feesSearchInput").addEventListener("input", tmRenderFeesList);
  document.getElementById("feesFilterSelect").addEventListener("change", tmRenderFeesList);
  document.getElementById("feesMonthInput").value = tmFeesMonth;
  document.getElementById("feesMonthInput").addEventListener("change", (e) => { if (e.target.value) { tmFeesMonth = e.target.value; tmRefreshFeesView(); } });
  document.getElementById("btnFeesPrev").addEventListener("click", () => tmShiftFeesMonth(-1));
  document.getElementById("btnFeesNext").addEventListener("click", () => tmShiftFeesMonth(1));
  document.getElementById("btnFeesThisMonth").addEventListener("click", () => { tmFeesMonth = tmThisMonthKey(); tmRefreshFeesView(); });
  document.getElementById("feesFilters").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    tmFeesStatusFilter = btn.dataset.filter;
    document.querySelectorAll("#feesFilters .tm-filter").forEach((b) => b.classList.toggle("active", b === btn));
    tmRenderFeesList();
  });
  document.getElementById("btnAddPaymentTop").addEventListener("click", () => tmOpenPaymentModal(null));
  document.getElementById("paymentStudentSelect").addEventListener("change", tmOnPaymentStudentChange);

  await tmReloadFeesData();

  if (tmGetQueryParam("add") === "1") {
    tmOpenPaymentModal(tmGetQueryParam("student"));
  }
}

async function tmReloadFeesData() {
  const [students, payments] = await Promise.all([TMDB.getAllStudents(), TMDB.getAllPayments()]);
  tmFeesStudents = students.filter((s) => s.active !== false);
  tmFeesPayments = payments;
  tmPopulatePaymentStudentSelect();
  tmRenderFeesSummary();
  tmRenderFeesList();
}

function tmPopulatePaymentStudentSelect() {
  const select = document.getElementById("paymentStudentSelect");
  const sorted = tmFeesStudents.slice().sort((a, b) => a.name.localeCompare(b.name));
  select.innerHTML = sorted.map((s) => `<option value="${s.id}">${tmEscapeHtml(s.name)}</option>`).join("");
}

function tmShiftFeesMonth(delta) {
  const [y, m] = tmFeesMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  tmFeesMonth = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  tmRefreshFeesView();
}

function tmRefreshFeesView() {
  document.getElementById("feesMonthInput").value = tmFeesMonth;
  tmRenderFeesSummary();
  tmRenderFeesList();
}

/** One entry per active student with the figures for the month being viewed. */
function tmFeesRows() {
  return tmFeesStudents.map((student) => {
    const payments = tmFeesPayments.filter((p) => p.studentId === student.id);
    const status = tmFeeStatusForMonth(student, payments, tmFeesMonth);
    const fee = status.monthlyFee || 0;
    const paid = status.paidForMonth || 0;
    return { student, payments, status, fee, paid, balance: Math.max(0, fee - paid), summary: tmFeesSummary(student, payments) };
  });
}

function tmRenderFeesSummary() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const monthLabel = tmFormatMonthKey(tmFeesMonth);
  set("feesSubtitle", "Collections and pending dues for " + monthLabel);

  const rows = tmFeesRows();
  const tracked = rows.filter((r) => r.fee > 0);
  const expected = tracked.reduce((s, r) => s + r.fee, 0);
  const collected = rows.reduce((s, r) => s + r.paid, 0);
  const pending = tracked.reduce((s, r) => s + r.balance, 0);
  const credited = tracked.reduce((s, r) => s + Math.min(r.paid, r.fee), 0);
  const rate = expected > 0 ? Math.round((credited / expected) * 100) : 0;

  set("feeKpiExpected", tmFormatCurrency(expected));
  set("feeKpiExpectedSub", tracked.length + " student" + (tracked.length === 1 ? "" : "s") + " with a fee");
  set("feeKpiCollected", tmFormatCurrency(collected));
  set("feeKpiCollectedSub", rows.filter((r) => r.status.status === "PAID").length + " fully paid");
  set("feeKpiPending", tmFormatCurrency(pending));
  set("feeKpiPendingSub", tracked.filter((r) => r.balance > 0).length + " student" + (tracked.filter((r) => r.balance > 0).length === 1 ? "" : "s") + " owe fees");
  set("feeKpiRate", rate + "%");
  const bar = document.getElementById("feeRateBar"); if (bar) bar.style.width = rate + "%";

  // All-time figures
  let totalPaid = 0;
  rows.forEach((r) => (totalPaid += r.summary.totalPaid));
  set("feesStatCollected", tmFormatCurrency(totalPaid));
  set("feesStatCount", tmFeesPayments.length);

  set("feeCountAll", rows.length);
  set("feeCountPaid", rows.filter((r) => r.status.status === "PAID").length);
  set("feeCountPartial", rows.filter((r) => r.status.status === "PARTIAL").length);
  set("feeCountPending", rows.filter((r) => r.status.status === "PENDING").length);
}

function tmFeeBadge(status) {
  if (status === "PAID") return `<span class="tm-badge success">Paid</span>`;
  if (status === "PARTIAL") return `<span class="tm-badge warning">Partial</span>`;
  if (status === "PENDING") return `<span class="tm-badge danger">Pending</span>`;
  return `<span class="tm-badge neutral">No fee set</span>`;
}

function tmRenderFeesList() {
  const query = (document.getElementById("feesSearchInput").value || "").trim().toLowerCase();
  const sortBy = document.getElementById("feesFilterSelect").value;

  let rows = tmFeesRows();
  if (query) rows = rows.filter(({ student }) => (student.name + " " + (student.parentPhone || "")).toLowerCase().includes(query));
  if (tmFeesStatusFilter !== "all") rows = rows.filter((r) => r.status.status === tmFeesStatusFilter);

  if (sortBy === "paid") {
    rows.sort((a, b) => b.summary.totalPaid - a.summary.totalPaid);
  } else if (sortBy === "balance") {
    rows.sort((a, b) => b.balance - a.balance || a.student.name.localeCompare(b.student.name));
  } else if (sortBy === "recent") {
    rows.sort((a, b) => {
      const da = a.summary.lastPayment ? a.summary.lastPayment.date : "";
      const db = b.summary.lastPayment ? b.summary.lastPayment.date : "";
      return db.localeCompare(da);
    });
  } else {
    rows.sort((a, b) => a.student.name.localeCompare(b.student.name));
  }

  const container = document.getElementById("feesListContainer");
  if (rows.length === 0) {
    container.innerHTML = `<div class="tm-empty">${tmFeesStudents.length === 0 ? "No students yet. Add students to start tracking fees." : "No students match this view."}</div>`;
    return;
  }

  container.innerHTML = `<div class="tm-datatable dt-fees" style="--cols: minmax(0,2.2fr) 1fr 1fr 1fr 100px 1.2fr 280px;">
    <div class="dt-head"><div>Student</div><div class="num">Monthly fee</div><div class="num">Paid</div><div class="num">Balance</div><div>Status</div><div>Last payment</div><div></div></div>
    ${rows
      .map(({ student, status, fee, paid, balance, summary }) => {
        const showRemind = status.status === "PENDING" || status.status === "PARTIAL";
        const last = summary.lastPayment ? tmFormatDate(summary.lastPayment.date) : "No payments yet";
        return `
      <div class="dt-row clickable" role="button" tabindex="0" onclick="tmOpenFeeDetailModal('${student.id}')" onkeydown="if(event.key==='Enter'){tmOpenFeeDetailModal('${student.id}')}">
        <div class="dt-cell main"><span class="tm-name-row">${tmAvatar(student.name)}<span class="min-w-0"><span class="nm">${tmEscapeHtml(student.name)}</span><span class="sub">${student.parentPhone ? tmEscapeHtml(student.parentPhone) : "No phone on file"}</span></span></span></div>
        <div class="dt-cell metric num" data-label="Monthly fee">${fee > 0 ? tmFormatCurrency(fee) : "—"}</div>
        <div class="dt-cell metric num" data-label="Paid">${tmFormatCurrency(paid)}</div>
        <div class="dt-cell metric num" data-label="Balance" style="${balance > 0 ? "color:var(--color-danger);font-weight:700;" : ""}">${fee > 0 ? tmFormatCurrency(balance) : "—"}</div>
        <div class="dt-cell status">${tmFeeBadge(status.status)}</div>
        <div class="dt-cell dt-last" data-label="Last payment">${last}</div>
        <div class="dt-cell dt-act">
          ${showRemind ? `<button type="button" class="btn btn-tm-outline btn-sm" onclick="event.stopPropagation(); tmSendFeeReminder('${student.id}');">Send reminder</button>` : ""}
          <button type="button" class="btn btn-tm-amber btn-sm" onclick="event.stopPropagation(); tmOpenPaymentModal('${student.id}');">Add payment</button>
        </div>
      </div>`;
      })
      .join("")}
  </div>`;
}

/**
 * Opens WhatsApp (falling back to plain SMS) with a fee-reminder message
 * pre-filled — this is just a `wa.me`/`sms:` link, no WhatsApp Business
 * API, no account, no cost. Uses the student's parent phone if on file,
 * otherwise the student's own phone; shows a clear message instead of a
 * broken link if neither is available.
 */
async function tmSendFeeReminder(studentId) {
  const student = tmFeesStudents.find((s) => s.id === studentId);
  if (!student) return;

  const phone = student.parentPhone || student.studentPhone;
  if (!phone) {
    tmToast("No phone number on file for this student. Add one under Students to send reminders.");
    return;
  }

  const monthKey = tmThisMonthKey();
  const payments = tmFeesPayments.filter((p) => p.studentId === studentId);
  const status = tmFeeStatusForMonth(student, payments, monthKey);
  const remaining = Math.max(0, (status.monthlyFee || 0) - (status.paidForMonth || 0));

  const settings = await TMDB.getSettings();
  const centerName = settings?.tuitionCenterName || "the tuition center";
  const monthLabel = tmFormatMonthKey(monthKey);

  const message =
    `Hi, this is a reminder from ${centerName} that ${student.name}'s tuition fee ` +
    `of ${tmFormatCurrency(remaining)} for ${monthLabel} is pending. ` +
    `Kindly pay at your earliest convenience. Thank you!`;

  const waLink = tmBuildWhatsAppLink(phone, message);
  if (!waLink) {
    tmToast("The phone number on file doesn't look like a valid 10-digit number.");
    return;
  }
  window.open(waLink, "_blank");
}

/* ---------------------------- Fee detail modal ---------------------------- */

function tmOpenFeeDetailModal(studentId) {
  const student = tmFeesStudents.find((s) => s.id === studentId);
  if (!student) return;
  const payments = tmFeesPayments
    .filter((p) => p.studentId === studentId)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const summary = tmFeesSummary(student, payments);

  const body = document.getElementById("feeDetailBody");
  body.innerHTML = `
    <h5 class="mb-2">${tmEscapeHtml(student.name)}</h5>
    <div class="tm-stat-grid mb-3">
      <div class="tm-stat-tile"><div class="value">${tmFormatCurrency(summary.totalPaid)}</div><div class="label">Total Paid</div></div>
      <div class="tm-stat-tile"><div class="value">${summary.paymentsCount}</div><div class="label">Payments Recorded</div></div>
    </div>

    <div class="tm-section-title"><span>Payment History</span><span class="rule"></span></div>
    <div style="max-height:200px; overflow-y:auto;">
      ${
        payments.length === 0
          ? '<p class="tm-muted">No payments recorded yet.</p>'
          : payments
              .map(
                (p) => `
        <div class="d-flex justify-content-between align-items-center border-bottom py-2">
          <div>
            <div class="fw-semibold">${tmFormatDate(p.date)} · ${tmEscapeHtml(p.mode)}</div>
            <div class="tm-muted" style="font-size:0.8rem;">For: ${tmFormatMonthKey(tmPaymentMonthKey(p))} ${p.reference ? "· Ref: " + tmEscapeHtml(p.reference) : ""} ${p.notes ? "· " + tmEscapeHtml(p.notes) : ""}</div>
          </div>
          <div class="d-flex align-items-center gap-2">
            <span class="tm-amount">${tmFormatCurrency(p.amount)}</span>
            <button class="btn btn-sm btn-tm-outline" onclick="tmDeletePayment('${p.id}','${studentId}')" title="Delete payment">✕</button>
          </div>
        </div>`
              )
              .join("")
      }
    </div>
  `;

  document.getElementById("btnFeeDetailAddPayment").onclick = () => {
    bootstrap.Modal.getInstance(document.getElementById("feeDetailModal"))?.hide();
    setTimeout(() => tmOpenPaymentModal(studentId), 300);
  };

  bootstrap.Modal.getOrCreateInstance(document.getElementById("feeDetailModal")).show();
}

async function tmDeletePayment(paymentId, studentId) {
  if (!confirm("Delete this payment record? This cannot be undone.")) return;
  await TMDB.deletePayment(paymentId);
  tmToast("Payment deleted.");
  await tmReloadFeesData();
  tmOpenFeeDetailModal(studentId);
}

/* ---------------------------- Add payment modal ---------------------------- */

/**
 * Suggests which month a new payment is likely for: the month after
 * whichever month the student's most recent payment was recorded for,
 * falling back to the current month. This is just a convenience
 * default for the form field — it makes no due/pending judgement.
 */
function tmSuggestPaymentMonth(studentId) {
  const payments = tmFeesPayments.filter((p) => p.studentId === studentId);
  if (payments.length === 0) return tmThisMonthKey();

  const paidMonthKeys = payments.map((p) => tmPaymentMonthKey(p)).filter(Boolean).sort();
  const lastKey = paidMonthKeys[paidMonthKeys.length - 1];
  if (!lastKey) return tmThisMonthKey();

  const [y, m] = lastKey.split("-").map(Number);
  let year = y;
  let month = m; // tmPaymentMonthKey month part is 1-based; add 1 for "next"
  if (month > 12) {
    month = 1;
    year += 1;
  }
  const nextKey = `${year}-${String(month).padStart(2, "0")}`;
  const thisKey = tmThisMonthKey();
  return nextKey > thisKey ? nextKey : thisKey;
}

function tmOnPaymentStudentChange() {
  const studentId = document.getElementById("paymentStudentSelect").value;
  if (!studentId) return;
  document.getElementById("paymentForMonth").value = tmSuggestPaymentMonth(studentId);
  const student = tmFeesStudents.find((s) => s.id === studentId);
  const amountField = document.getElementById("paymentAmount");
  if (student && student.monthlyFee && !amountField.value) {
    amountField.value = student.monthlyFee;
  }
}

function tmOpenPaymentModal(preselectStudentId) {
  const form = document.getElementById("paymentForm");
  form.reset();
  document.getElementById("paymentDate").value = tmTodayStr();
  document.getElementById("paymentForMonth").value = tmThisMonthKey();

  if (preselectStudentId) {
    document.getElementById("paymentStudentSelect").value = preselectStudentId;
    document.getElementById("paymentForMonth").value = tmSuggestPaymentMonth(preselectStudentId);
    const student = tmFeesStudents.find((s) => s.id === preselectStudentId);
    if (student && student.monthlyFee) {
      document.getElementById("paymentAmount").value = student.monthlyFee;
    }
  }
  bootstrap.Modal.getOrCreateInstance(document.getElementById("paymentModal")).show();
}

async function tmSavePayment(e) {
  e.preventDefault();
  const studentId = document.getElementById("paymentStudentSelect").value;
  const amount = parseFloat(document.getElementById("paymentAmount").value);
  const date = document.getElementById("paymentDate").value || tmTodayStr();
  const forMonth = document.getElementById("paymentForMonth").value;
  const mode = document.getElementById("paymentMode").value;
  const reference = document.getElementById("paymentReference").value.trim();
  const notes = document.getElementById("paymentNotes").value.trim();

  if (!studentId) {
    tmToast("Please select a student.");
    return;
  }
  if (!amount || amount <= 0) {
    tmToast("Payment amount must be greater than zero.");
    return;
  }
  if (!forMonth) {
    tmToast("Please choose which month this fee is for.");
    return;
  }

  await TMDB.addPayment({ studentId, amount, date, forMonth, mode, reference, notes });
  tmToast("Payment recorded for " + tmFormatMonthKey(forMonth) + ".");
  bootstrap.Modal.getInstance(document.getElementById("paymentModal"))?.hide();
  await tmReloadFeesData();
}

/**
 * Exports a proper .xlsx workbook (not CSV) with two sheets:
 *  1. "Fees Summary" — one row per student, one column per calendar
 *     month (across every student's joining-to-date range), each cell
 *     showing what that student paid FOR that month — so filtering or
 *     scanning the "Aug 2026" column shows exactly who has paid their
 *     August fee, no matter which date they actually paid it on.
 *  2. "Payment Log" — every individual payment transaction in date
 *     order, for a plain audit trail.
 */
async function tmExportPaymentsExcel() {
  if (tmFeesStudents.length === 0) {
    tmToast("No students to export yet.");
    return;
  }

  let ExcelJS;
  try {
    ExcelJS = await tmLoadExcelJs();
  } catch (err) {
    tmToast(err.message);
    return;
  }

  if (tmFeesPayments.length === 0) {
    tmToast("No payments recorded yet — the workbook will only have empty sheets.");
  }

  const settings = (await TMDB.getSettings()) || {};
  const workbook = tmBuildPaymentsWorkbook(ExcelJS, settings, tmFeesStudents, tmFeesPayments);
  await tmDownloadWorkbook(workbook, `fees-${tmTodayStr()}.xlsx`);
}
