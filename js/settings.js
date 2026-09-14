/* ==========================================================================
   Tuition Manager — settings.js
   ========================================================================== */

async function tmInitSettingsPage() {
  await tmRequireSetup();
  await tmLoadHeaderInfo();
  tmRenderBottomNav("");

  const settings = await TMDB.getSettings();
  document.getElementById("settingsCenterName").value = settings.tuitionCenterName || "";
  document.getElementById("settingsStaffName").value = settings.staffName || "";
  document.getElementById("settingsContact").value = settings.contactNumber || "";
  document.getElementById("settingsAddress").value = settings.address || "";
  document.getElementById("settingsHeadName").value = settings.headName || "";

  tmPreloadImagePreview("settingsLogoPreview", "btnRemoveLogo", settings.logoData);
  tmPreloadImagePreview("settingsHeadSignaturePreview", "btnRemoveHeadSignature", settings.headSignatureData);
  tmPreloadImagePreview("settingsStaffSignaturePreview", "btnRemoveStaffSignature", settings.staffSignatureData);

  tmWireImagePreview("settingsLogo", "settingsLogoPreview", tmProcessLogoFile);
  tmWireImagePreview("settingsHeadSignature", "settingsHeadSignaturePreview", tmProcessSignatureFile);
  tmWireImagePreview("settingsStaffSignature", "settingsStaffSignaturePreview", tmProcessSignatureFile);

  tmWireRemoveImageButton("btnRemoveLogo", "settingsLogo", "settingsLogoPreview");
  tmWireRemoveImageButton("btnRemoveHeadSignature", "settingsHeadSignature", "settingsHeadSignaturePreview");
  tmWireRemoveImageButton("btnRemoveStaffSignature", "settingsStaffSignature", "settingsStaffSignaturePreview");

  document.getElementById("settingsForm").addEventListener("submit", tmSaveSettingsForm);

  document.getElementById("btnBackupNow").addEventListener("click", async () => {
    await tmBackupAllData();
  });

  document.getElementById("restoreFileInput").addEventListener("change", tmHandleRestoreFile);

  document.getElementById("btnExportStudentsCsvSettings").addEventListener("click", tmExportStudentsCsvFromSettings);
  document.getElementById("btnExportAttendanceCsvSettings").addEventListener("click", tmExportAttendanceCsvFromSettings);
  document.getElementById("btnExportPaymentsCsvSettings").addEventListener("click", tmExportPaymentsCsvFromSettings);

  document.getElementById("btnLoadDemoData").addEventListener("click", async () => {
    if (!confirm("Load sample demo students, attendance, and payments for testing?")) return;
    await tmLoadDemoData();
  });
  document.getElementById("btnRemoveDemoData").addEventListener("click", async () => {
    if (!confirm("Remove all demo data added by 'Load Demo Data'?")) return;
    await tmRemoveDemoData();
  });

  document.getElementById("btnClearAllData").addEventListener("click", tmHandleClearAllData);

  const account = TMAuth.getUser();
  document.getElementById("settingsAccountEmail").textContent = account ? account.email : "—";
  document.getElementById("btnLogout").addEventListener("click", async () => {
    if (!confirm("Log out of Tuition Manager on this device?")) return;
    await TMAuth.logout();
    window.location.href = tmBasePath() + "login.html";
  });

  document.getElementById("btnImportLegacyLocal").addEventListener("click", tmManualImportLegacyLocalData);
}

/**
 * Shows an already-saved logo/signature (loaded from settings) in its
 * preview <img> and reveals the "Remove" button, so editing an existing
 * account doesn't start from a blank slate every time. Stashes the
 * value on preview.dataset.processed exactly like tmWireImagePreview
 * does for a freshly-picked file, so tmSaveSettingsForm can read every
 * image field the same way regardless of whether it changed this visit.
 */
function tmPreloadImagePreview(previewId, removeBtnId, existingDataUrl) {
  const preview = document.getElementById(previewId);
  const removeBtn = document.getElementById(removeBtnId);
  if (!preview) return;
  preview.dataset.processed = existingDataUrl || "";
  if (existingDataUrl) {
    preview.src = existingDataUrl;
    preview.classList.remove("d-none");
    if (removeBtn) removeBtn.classList.remove("d-none");
  }
}

/** Wires a "Remove Logo/Signature" button: clears the field, hides the preview/button, resets the file input. */
function tmWireRemoveImageButton(removeBtnId, inputId, previewId) {
  const removeBtn = document.getElementById(removeBtnId);
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  if (!removeBtn) return;
  removeBtn.addEventListener("click", () => {
    preview.dataset.processed = "";
    preview.src = "";
    preview.classList.add("d-none");
    if (input) input.value = "";
    removeBtn.classList.add("d-none");
  });
}

async function tmSaveSettingsForm(e) {
  e.preventDefault();
  const centerName = document.getElementById("settingsCenterName").value.trim();
  const staffName = document.getElementById("settingsStaffName").value.trim();

  if (!centerName || !staffName) {
    tmToast("Tuition center name and staff name are required.");
    return;
  }

  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  try {
    await TMDB.saveSettings({
      tuitionCenterName: centerName,
      staffName: staffName,
      contactNumber: document.getElementById("settingsContact").value.trim(),
      address: document.getElementById("settingsAddress").value.trim(),
      headName: document.getElementById("settingsHeadName").value.trim(),
      logoData: document.getElementById("settingsLogoPreview").dataset.processed || "",
      headSignatureData: document.getElementById("settingsHeadSignaturePreview").dataset.processed || "",
      staffSignatureData: document.getElementById("settingsStaffSignaturePreview").dataset.processed || "",
      setupComplete: true,
    });

    tmToast("Settings saved.");
    await tmLoadHeaderInfo();
  } catch (err) {
    tmToast(err.message || "Could not save settings.");
  } finally {
    submitBtn.disabled = false;
  }
}

async function tmHandleRestoreFile() {
  const input = document.getElementById("restoreFileInput");
  const file = input.files[0];
  if (!file) return;

  const confirmed = confirm(
    "Restoring data will replace existing application data. Please make a backup before continuing.\n\nDo you want to proceed with restore?"
  );
  if (!confirmed) {
    input.value = "";
    return;
  }

  try {
    await tmRestoreFromFile(file);
    tmToast("Data restored successfully.");
    setTimeout(() => window.location.reload(), 1200);
  } catch (err) {
    alert("Restore failed: " + (err.message || "The backup file appears to be invalid."));
  } finally {
    input.value = "";
  }
}

async function tmExportStudentsCsvFromSettings() {
  const students = await TMDB.getAllStudents();
  const header = ["Student Name", "Student ID", "Parent Name", "Parent Phone", "Student Phone", "Joining Date", "Monthly Fee", "Active", "Notes"];
  const rows = [header].concat(
    students.map((s) => [s.name, tmExcelSafeText(s.studentId), s.parentName || "", tmExcelSafeText(s.parentPhone), tmExcelSafeText(s.studentPhone), tmExcelSafeText(s.joiningDate), s.monthlyFee || 0, s.active === false ? "No" : "Yes", s.notes || ""])
  );
  tmDownloadCsv(`students-${tmTodayStr()}.csv`, rows);
}

async function tmExportAttendanceCsvFromSettings() {
  let ExcelJS;
  try {
    ExcelJS = await tmLoadExcelJs();
  } catch (err) {
    tmToast(err.message);
    return;
  }

  const [students, attendance, settings] = await Promise.all([
    TMDB.getAllStudents(),
    TMDB.getAllAttendance(),
    TMDB.getSettings(),
  ]);

  if (attendance.length === 0) {
    tmToast("No attendance records to export yet.");
    return;
  }

  const workbook = tmBuildAttendanceWorkbook(ExcelJS, settings || {}, students, attendance);
  await tmDownloadWorkbook(workbook, `attendance-${tmTodayStr()}.xlsx`);
}

async function tmExportPaymentsCsvFromSettings() {
  let ExcelJS;
  try {
    ExcelJS = await tmLoadExcelJs();
  } catch (err) {
    tmToast(err.message);
    return;
  }

  const [students, payments, settings] = await Promise.all([
    TMDB.getAllStudents(),
    TMDB.getAllPayments(),
    TMDB.getSettings(),
  ]);

  if (payments.length === 0) {
    tmToast("No payments to export yet.");
    return;
  }

  const workbook = tmBuildPaymentsWorkbook(ExcelJS, settings || {}, students, payments);
  await tmDownloadWorkbook(workbook, `fees-${tmTodayStr()}.xlsx`);
}

async function tmHandleClearAllData() {
  const step1 = confirm(
    "This will permanently delete all students, attendance and fee records from this device.\n\nWe strongly recommend taking a backup first. Continue?"
  );
  if (!step1) return;

  const step2 = prompt('Type "DELETE" to confirm permanent deletion of all data.');
  if (step2 !== "DELETE") {
    tmToast("Clear data cancelled.");
    return;
  }

  await tmClearAllDataConfirmed();
  setTimeout(() => window.location.reload(), 1000);
}
