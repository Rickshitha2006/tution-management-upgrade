/* ==========================================================================
   Tuition Manager — students.js
   ========================================================================== */

let tmAllStudents = [];
let tmAllAttendanceCache = [];
let tmAllPaymentsCache = [];
let tmCurrentFilter = "active"; // active | inactive | all
let tmCurrentSort = "name";

async function tmInitStudentsPage() {
  await tmRequireSetup();
  await tmLoadHeaderInfo();
  tmRenderBottomNav("students");
  await tmReloadStudentsData();
  tmWireStudentControls();

  if (tmGetQueryParam("add") === "1") {
    tmOpenStudentModal(null);
  }
  if (tmGetQueryParam("focusSearch") === "1") {
    const input = document.getElementById("studentSearchInput");
    if (input) input.focus();
  }
  const viewId = tmGetQueryParam("view");
  if (viewId) {
    tmOpenProfileModal(viewId);
  }
}

async function tmReloadStudentsData() {
  const [students, attendance, payments] = await Promise.all([
    TMDB.getAllStudents(),
    TMDB.getAllAttendance(),
    TMDB.getAllPayments(),
  ]);
  tmAllStudents = students;
  tmAllAttendanceCache = attendance;
  tmAllPaymentsCache = payments;
  tmRenderStudentList();
}

function tmWireStudentControls() {
  const searchInput = document.getElementById("studentSearchInput");
  if (searchInput) searchInput.addEventListener("input", tmRenderStudentList);

  const filterSelect = document.getElementById("studentFilterSelect");
  if (filterSelect) {
    filterSelect.addEventListener("change", (e) => {
      tmCurrentFilter = e.target.value;
      tmRenderStudentList();
    });
  }

  const sortSelect = document.getElementById("studentSortSelect");
  if (sortSelect) {
    sortSelect.addEventListener("change", (e) => {
      tmCurrentSort = e.target.value;
      tmRenderStudentList();
    });
  }

  const addBtn = document.getElementById("btnAddStudent");
  if (addBtn) addBtn.addEventListener("click", () => tmOpenStudentModal(null));

  const form = document.getElementById("studentForm");
  if (form) form.addEventListener("submit", tmSaveStudent);

  const deleteBtn = document.getElementById("btnDeleteStudent");
  if (deleteBtn) deleteBtn.addEventListener("click", tmConfirmDeleteStudent);

  const exportBtn = document.getElementById("btnExportStudentsCsv");
  if (exportBtn) exportBtn.addEventListener("click", tmExportStudentsCsv);
}

function tmComputeStudentRow(student) {
  const attendance = tmAllAttendanceCache.filter((a) => a.studentId === student.id);
  const payments = tmAllPaymentsCache.filter((p) => p.studentId === student.id);
  const attStats = tmAttendanceStats(attendance);
  const feeSummary = tmFeesSummary(student, payments);
  return { student, attStats, feeSummary };
}

function tmRenderStudentList() {
  const listEl = document.getElementById("studentListContainer");
  if (!listEl) return;

  const query = (document.getElementById("studentSearchInput")?.value || "").trim().toLowerCase();

  let rows = tmAllStudents.map(tmComputeStudentRow);

  // Filter by active status
  rows = rows.filter((row) => {
    if (tmCurrentFilter === "active") return row.student.active !== false;
    if (tmCurrentFilter === "inactive") return row.student.active === false;
    return true;
  });

  // Filter by search query
  if (query) {
    rows = rows.filter((row) => {
      const s = row.student;
      return (
        (s.name || "").toLowerCase().includes(query) ||
        (s.studentId || "").toLowerCase().includes(query) ||
        (s.parentName || "").toLowerCase().includes(query) ||
        (s.parentPhone || "").toLowerCase().includes(query)
      );
    });
  }

  // Sort
  rows.sort((a, b) => {
    if (tmCurrentSort === "name") return a.student.name.localeCompare(b.student.name);
    if (tmCurrentSort === "paid") return b.feeSummary.totalPaid - a.feeSummary.totalPaid;
    if (tmCurrentSort === "attendance") return a.attStats.percentage - b.attStats.percentage;
    return 0;
  });

  if (rows.length === 0) {
    listEl.innerHTML = `<div class="tm-empty">
      <span class="emoji">👨‍🎓</span>
      No students found. Try a different search, or add a new student.
    </div>`;
    return;
  }

  listEl.innerHTML = rows
    .map(({ student, attStats, feeSummary }) => {
      const inactiveClass = student.active === false ? "inactive" : "";
      return `
      <a href="#" class="tm-index-card ${inactiveClass}" onclick="tmOpenProfileModal('${student.id}'); return false;">
        <div class="name">${tmEscapeHtml(student.name)}</div>
        <div class="meta">${student.parentName ? "Parent: " + tmEscapeHtml(student.parentName) : "&nbsp;"}${student.active === false ? " · Inactive" : ""}</div>
        <div class="stat-row">
          <span>Fee: <strong>${tmFormatCurrency(student.monthlyFee)}</strong>/mo</span>
          <span>Attendance: <strong>${attStats.percentage}%</strong></span>
        </div>
        <div class="mt-2"><span class="tm-badge neutral">Paid so far: ${tmFormatCurrency(feeSummary.totalPaid)}</span></div>
      </a>`;
    })
    .join("");
}

/* ---------------------------- Add / Edit modal ---------------------------- */

function tmOpenStudentModal(studentId) {
  const form = document.getElementById("studentForm");
  form.reset();
  document.getElementById("studentFormId").value = studentId || "";
  document.getElementById("studentModalTitle").textContent = studentId ? "Edit Student" : "Add Student";
  document.getElementById("btnDeleteStudent").classList.toggle("d-none", !studentId);

  if (studentId) {
    const student = tmAllStudents.find((s) => s.id === studentId);
    if (student) {
      document.getElementById("studentName").value = student.name || "";
      document.getElementById("studentIdField").value = student.studentId || "";
      document.getElementById("studentParentName").value = student.parentName || "";
      document.getElementById("studentParentPhone").value = student.parentPhone || "";
      document.getElementById("studentPhone").value = student.studentPhone || "";
      document.getElementById("studentJoiningDate").value = student.joiningDate || tmTodayStr();
      document.getElementById("studentMonthlyFee").value = student.monthlyFee || "";
      document.getElementById("studentNotes").value = student.notes || "";
      document.getElementById("studentActive").checked = student.active !== false;
    }
  } else {
    document.getElementById("studentJoiningDate").value = tmTodayStr();
    document.getElementById("studentActive").checked = true;
  }

  const modalEl = document.getElementById("studentModal");
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

async function tmSaveStudent(e) {
  e.preventDefault();
  const id = document.getElementById("studentFormId").value;
  const name = document.getElementById("studentName").value.trim();
  const monthlyFee = parseFloat(document.getElementById("studentMonthlyFee").value) || 0;

  if (!name) {
    tmToast("Student name is required.");
    return;
  }

  const payload = {
    name,
    studentId: document.getElementById("studentIdField").value.trim(),
    parentName: document.getElementById("studentParentName").value.trim(),
    parentPhone: document.getElementById("studentParentPhone").value.trim(),
    studentPhone: document.getElementById("studentPhone").value.trim(),
    joiningDate: document.getElementById("studentJoiningDate").value || tmTodayStr(),
    monthlyFee,
    notes: document.getElementById("studentNotes").value.trim(),
    active: document.getElementById("studentActive").checked,
  };

  if (id) {
    await TMDB.updateStudent(id, payload);
    tmToast("Student updated.");
  } else {
    await TMDB.addStudent(payload);
    tmToast("Student added.");
  }

  bootstrap.Modal.getInstance(document.getElementById("studentModal"))?.hide();
  await tmReloadStudentsData();
}

async function tmConfirmDeleteStudent() {
  const id = document.getElementById("studentFormId").value;
  if (!id) return;
  const student = tmAllStudents.find((s) => s.id === id);
  if (!confirm(`Delete ${student ? student.name : "this student"}? This will also remove their attendance and payment records. This cannot be undone.`)) {
    return;
  }
  await TMDB.deleteStudent(id);
  bootstrap.Modal.getInstance(document.getElementById("studentModal"))?.hide();
  tmToast("Student deleted.");
  await tmReloadStudentsData();
}

/* ---------------------------- Profile modal ---------------------------- */

function tmOpenProfileModal(studentId) {
  const student = tmAllStudents.find((s) => s.id === studentId);
  if (!student) return;

  const attendance = tmAllAttendanceCache
    .filter((a) => a.studentId === studentId)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const payments = tmAllPaymentsCache
    .filter((p) => p.studentId === studentId)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const attStats = tmAttendanceStats(attendance);
  const feeSummary = tmFeesSummary(student, payments);

  const body = document.getElementById("profileModalBody");
  body.innerHTML = `
    <h4 class="mb-1">${tmEscapeHtml(student.name)}</h4>
    <p class="tm-muted mb-3">${student.active === false ? '<span class="tm-badge neutral">Inactive</span>' : '<span class="tm-badge success">Active</span>'}</p>

    <div class="tm-section-title"><span>Student Information</span><span class="rule"></span></div>
    <div class="tm-month-table-wrap mb-2">
      <table class="tm-month-table">
        <tr><td class="tm-muted">Student ID</td><td>${tmEscapeHtml(student.studentId) || "-"}</td></tr>
        <tr><td class="tm-muted">Parent Name</td><td>${tmEscapeHtml(student.parentName) || "-"}</td></tr>
        <tr><td class="tm-muted">Parent Phone</td><td>${tmEscapeHtml(student.parentPhone) || "-"}</td></tr>
        <tr><td class="tm-muted">Student Phone</td><td>${tmEscapeHtml(student.studentPhone) || "-"}</td></tr>
        <tr><td class="tm-muted">Joining Date</td><td>${tmFormatDate(student.joiningDate)}</td></tr>
        <tr><td class="tm-muted">Monthly Fee</td><td>${tmFormatCurrency(student.monthlyFee)}</td></tr>
        <tr><td class="tm-muted">Notes</td><td>${tmEscapeHtml(student.notes) || "-"}</td></tr>
      </table>
    </div>

    <div class="tm-section-title"><span>Attendance Summary</span><span class="rule"></span></div>
    <div class="tm-stat-grid mb-2">
      <div class="tm-stat-tile"><div class="value">${attStats.total}</div><div class="label">Total Classes</div></div>
      <div class="tm-stat-tile"><div class="value">${attStats.present}</div><div class="label">Present</div></div>
      <div class="tm-stat-tile"><div class="value">${attStats.absent}</div><div class="label">Absent</div></div>
      <div class="tm-stat-tile"><div class="value">${attStats.percentage}%</div><div class="label">Attendance</div></div>
    </div>

    <div class="tm-section-title"><span>Fees Summary</span><span class="rule"></span></div>
    <div class="tm-stat-grid mb-2">
      <div class="tm-stat-tile"><div class="value">${tmFormatCurrency(feeSummary.totalPaid)}</div><div class="label">Total Paid</div></div>
      <div class="tm-stat-tile"><div class="value">${feeSummary.paymentsCount}</div><div class="label">Payments Recorded</div></div>
    </div>

    <div class="tm-section-title"><span>Attendance History</span><span class="rule"></span></div>
    <div style="max-height:180px; overflow-y:auto;">
      ${
        attendance.length === 0
          ? '<p class="tm-muted">No attendance recorded yet.</p>'
          : attendance
              .slice(0, 60)
              .map(
                (a) =>
                  `<div class="d-flex justify-content-between border-bottom py-1">
                    <span>${tmFormatDate(a.date)}</span>
                    <span class="tm-badge ${a.status === "Present" ? "success" : "danger"}">${a.status}</span>
                  </div>`
              )
              .join("")
      }
    </div>

    <div class="tm-section-title"><span>Payment History</span><span class="rule"></span></div>
    <div style="max-height:180px; overflow-y:auto;">
      ${
        payments.length === 0
          ? '<p class="tm-muted">No payments recorded yet.</p>'
          : payments
              .map(
                (p) =>
                  `<div class="d-flex justify-content-between border-bottom py-1">
                    <span>${tmFormatDate(p.date)} · ${tmEscapeHtml(p.mode)}</span>
                    <span class="tm-amount">${tmFormatCurrency(p.amount)}</span>
                  </div>`
              )
              .join("")
      }
    </div>
  `;

  document.getElementById("btnProfileEdit").onclick = () => {
    bootstrap.Modal.getInstance(document.getElementById("profileModal"))?.hide();
    setTimeout(() => tmOpenStudentModal(studentId), 300);
  };
  document.getElementById("btnProfileAttendance").onclick = () => {
    window.location.href = `attendance.html?student=${studentId}`;
  };
  document.getElementById("btnProfilePayment").onclick = () => {
    window.location.href = `fees.html?student=${studentId}&add=1`;
  };

  bootstrap.Modal.getOrCreateInstance(document.getElementById("profileModal")).show();
}

/* ---------------------------- CSV export ---------------------------- */

function tmExportStudentsCsv() {
  const header = [
    "Student Name",
    "Student ID",
    "Parent Name",
    "Parent Phone",
    "Student Phone",
    "Joining Date",
    "Monthly Fee",
    "Active",
    "Notes",
  ];
  const rows = [header].concat(
    tmAllStudents.map((s) => [
      s.name,
      tmExcelSafeText(s.studentId),
      s.parentName || "",
      tmExcelSafeText(s.parentPhone),
      tmExcelSafeText(s.studentPhone),
      tmExcelSafeText(s.joiningDate),
      s.monthlyFee || 0,
      s.active === false ? "No" : "Yes",
      s.notes || "",
    ])
  );
  tmDownloadCsv(`students-${tmTodayStr()}.csv`, rows);
}
