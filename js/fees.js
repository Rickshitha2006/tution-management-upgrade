/* ==========================================================================
   Tuition Manager — fees.js
   ========================================================================== */

let tmFeesStudents = [];
let tmFeesPayments = [];

async function tmInitFeesPage() {
  await tmRequireSetup();
  await tmLoadHeaderInfo();
  tmRenderBottomNav("fees");

  document.getElementById("paymentForm").addEventListener("submit", tmSavePayment);
  document.getElementById("feesSearchInput").addEventListener("input", tmRenderFeesList);
  document.getElementById("feesFilterSelect").addEventListener("change", tmRenderFeesList);
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

function tmRenderFeesSummary() {
  let totalPaid = 0;

  tmFeesStudents.forEach((student) => {
    const payments = tmFeesPayments.filter((p) => p.studentId === student.id);
    totalPaid += tmFeesSummary(student, payments).totalPaid;
  });

  document.getElementById("feesStatCollected").textContent = tmFormatCurrency(totalPaid);
  document.getElementById("feesStatCount").textContent = tmFeesPayments.length;
}

function tmRenderFeesList() {
  const query = (document.getElementById("feesSearchInput").value || "").trim().toLowerCase();
  const sortBy = document.getElementById("feesFilterSelect").value;

  let rows = tmFeesStudents.map((student) => {
    const payments = tmFeesPayments.filter((p) => p.studentId === student.id);
    return { student, summary: tmFeesSummary(student, payments) };
  });

  if (query) {
    rows = rows.filter(({ student }) => student.name.toLowerCase().includes(query));
  }

  if (sortBy === "paid") {
    rows.sort((a, b) => b.summary.totalPaid - a.summary.totalPaid);
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
    container.innerHTML = `<div class="tm-empty"><span class="emoji">💰</span>No students match this search.</div>`;
    return;
  }

  container.innerHTML = rows
    .map(({ student, summary }) => {
      return `
      <a href="#" class="tm-index-card" onclick="tmOpenFeeDetailModal('${student.id}'); return false;">
        <div class="d-flex justify-content-between align-items-center">
          <span class="name">${tmEscapeHtml(student.name)}</span>
          <span class="tm-badge neutral">${tmFormatCurrency(summary.totalPaid)} paid</span>
        </div>
        <div class="meta">Monthly fee: ${tmFormatCurrency(student.monthlyFee)}</div>
      </a>`;
    })
    .join("");
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
