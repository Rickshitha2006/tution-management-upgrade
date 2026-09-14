/* ==========================================================================
   Tuition Manager — pdf-reports.js
   ==========================================================================
   Professional PDF reports, built with jsPDF (loaded from CDN, same
   on-demand-load pattern as ExcelJS in js/utils.js — see tmLoadJsPdf()).

   Two report types, both read-only (never write to the database):
     - Individual Student Report  (all-time totals, same numbers as the
       existing on-screen Student Report tab — see tmGenerateIndividualReportPdf)
     - Monthly All-Students Report (one dedicated page per student for a
       selected month/year — see tmGenerateMonthlyAllStudentsReportPdf)

   Both always re-fetch students/attendance/payments/settings from TMDB
   right before generating, so a report always reflects the latest
   synced cloud data rather than whatever was cached when the Reports
   page first loaded (per the brief's "use latest synchronized data"
   requirement).

   Excel export (js/utils.js: tmBuildAttendanceWorkbook, etc.) is
   completely separate from this file and is NOT touched here — the
   attendance timestamp still never appears there.
   ========================================================================== */

const TM_PDF_PAGE_WIDTH_MM = 210; // A4
const TM_PDF_PAGE_HEIGHT_MM = 297;
const TM_PDF_MARGIN_MM = 18;

let tmPdfGenerating = false;

/* ---------------------------- library loading ---------------------------- */

async function tmLoadJsPdf() {
  if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
  throw new Error("PDF library failed to load. Check your internet connection and try again.");
}

/* ---------------------------- small helpers ---------------------------- */

function tmSanitizeFilename(str) {
  return String(str || "Report")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "Report";
}

function tmGetImageDims(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Could not read image dimensions."));
    img.src = dataUrl;
  });
}

/** Fits (width, height) inside (maxWidth, maxHeight) without distorting aspect ratio. */
function tmFitBox(width, height, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1); // never upscale beyond source
  return { width: width * scale, height: height * scale };
}

function tmMonthLabelFor(year, monthIndex) {
  return tmMonthLabel(year, monthIndex); // reuses the existing helper in utils.js
}

/**
 * Attendance % for a PDF: same formula/inputs as tmAttendanceStats (the
 * exact function every on-screen report already uses, so the numbers
 * always match), but rendered as "N/A" instead of "0%" when there were
 * no recorded classes at all — this only changes how zero is *displayed*
 * in the PDF, never the shared calculation other screens rely on.
 */
function tmPdfAttendanceLine(stats) {
  return stats.total === 0 ? "N/A (no classes recorded)" : stats.percentage + "%";
}

/**
 * Fee status for a specific month, derived only from data the app
 * already has (monthlyFee + payments tagged for that month via
 * payment.forMonth) — never an invented judgement. See tmPaymentMonthKey
 * in js/utils.js for how a payment is attributed to a month.
 */
function tmMonthFeeStatus(student, payments, monthKey) {
  const monthlyFee = Number(student.monthlyFee) || 0;
  const paidForMonth = payments
    .filter((p) => tmPaymentMonthKey(p) === monthKey)
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  if (monthlyFee <= 0) {
    return { paidForMonth, status: paidForMonth > 0 ? "PAID" : "NOT TRACKED" };
  }
  let status;
  if (paidForMonth <= 0) status = "PENDING";
  else if (paidForMonth >= monthlyFee) status = "PAID";
  else status = "PARTIALLY PAID";
  return { paidForMonth, status, monthlyFee };
}

/* ---------------------------- header / footer / signatures ---------------------------- */

/**
 * Draws the report header (logo, centre name, title, subtitle) starting
 * at the top margin and returns the Y position just below it, so the
 * caller knows where body content can safely start.
 */
async function tmDrawReportHeader(doc, settings, title, subtitle) {
  const pageWidth = TM_PDF_PAGE_WIDTH_MM;
  let y = TM_PDF_MARGIN_MM;

  if (settings.logoData) {
    try {
      const dims = await tmGetImageDims(settings.logoData);
      const box = tmFitBox(dims.width, dims.height, 32, 18); // mm — a modest header logo, never huge (item 11/47)
      const x = (pageWidth - box.width) / 2;
      doc.addImage(settings.logoData, "PNG", x, y, box.width, box.height);
      y += box.height + 4;
    } catch {
      /* if the logo can't be read, skip it rather than breaking the report (item 55) */
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(30, 58, 95); // matches the app's ink color, css/style.css --color-ink
  doc.text((settings.tuitionCenterName || "Tuition Manager").toUpperCase(), pageWidth / 2, y + 5, { align: "center" });
  y += 9;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(90, 90, 90);
  doc.text(title, pageWidth / 2, y + 4, { align: "center" });
  y += 6;

  if (subtitle) {
    doc.setFontSize(9.5);
    doc.text(subtitle, pageWidth / 2, y + 4, { align: "center" });
    y += 6;
  }

  doc.setDrawColor(210, 210, 210);
  doc.line(TM_PDF_MARGIN_MM, y + 2, pageWidth - TM_PDF_MARGIN_MM, y + 2);
  doc.setTextColor(30, 30, 30);
  return y + 10;
}

/**
 * Places signature(s) near the bottom of the current page:
 *   - both present  → head bottom-left, staff bottom-right (item 17)
 *   - only one      → that one, bottom-right, no empty box for the other (item 18)
 *   - neither       → nothing drawn, no broken placeholder (item 56)
 * Never invents a name/title the user didn't provide (item 19).
 */
async function tmDrawSignatureBlock(doc, settings, bottomY) {
  const pageWidth = TM_PDF_PAGE_WIDTH_MM;
  const boxWidth = 42; // mm
  const boxHeight = 16; // mm
  const sigY = bottomY - boxHeight - 8;

  const hasHead = !!settings.headSignatureData;
  const hasStaff = !!settings.staffSignatureData;
  if (!hasHead && !hasStaff) return;

  async function drawOne(dataUrl, label, name, x) {
    try {
      const dims = await tmGetImageDims(dataUrl);
      const box = tmFitBox(dims.width, dims.height, boxWidth, boxHeight);
      const imgX = x + (boxWidth - box.width) / 2;
      doc.addImage(dataUrl, "PNG", imgX, sigY + (boxHeight - box.height), box.width, box.height);
    } catch {
      /* skip a signature that fails to load rather than breaking the report */
    }
    doc.setDrawColor(150, 150, 150);
    doc.line(x, sigY + boxHeight + 2, x + boxWidth, sigY + boxHeight + 2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(90, 90, 90);
    doc.text(label, x + boxWidth / 2, sigY + boxHeight + 6, { align: "center" });
    if (name) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(40, 40, 40);
      doc.text(name, x + boxWidth / 2, sigY + boxHeight + 10, { align: "center" });
    }
  }

  if (hasHead && hasStaff) {
    await drawOne(settings.headSignatureData, "Tuition Head", settings.headName || "", TM_PDF_MARGIN_MM);
    await drawOne(settings.staffSignatureData, "Staff", settings.staffName || "", pageWidth - TM_PDF_MARGIN_MM - boxWidth);
  } else if (hasHead) {
    await drawOne(settings.headSignatureData, "Tuition Head", settings.headName || "", pageWidth - TM_PDF_MARGIN_MM - boxWidth);
  } else {
    await drawOne(settings.staffSignatureData, "Staff", settings.staffName || "", pageWidth - TM_PDF_MARGIN_MM - boxWidth);
  }
}

/** Adds "Centre Name · Month Year" (left) and "Page X of Y" (right) to every page — run once, after all pages exist. */
function tmStampFootersAndPageNumbers(doc, centerName, periodLabel) {
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(130, 130, 130);
    const footerY = TM_PDF_PAGE_HEIGHT_MM - 10;
    doc.text(`${centerName}${periodLabel ? " · " + periodLabel : ""}`, TM_PDF_MARGIN_MM, footerY);
    doc.text(`Page ${i} of ${totalPages}`, TM_PDF_PAGE_WIDTH_MM - TM_PDF_MARGIN_MM, footerY, { align: "right" });
  }
}

/* ---------------------------- one student's report body ---------------------------- */

/**
 * Draws one student's attendance + fee summary starting at startY.
 * Used by both the individual report and each page of the monthly
 * all-students report, so the two features can never drift apart in
 * formatting. Returns the Y position after the content (before any
 * signature block, which the caller places near the page bottom).
 */
function tmDrawStudentSection(doc, student, attStats, feeInfo, startY) {
  const pageWidth = TM_PDF_PAGE_WIDTH_MM;
  const left = TM_PDF_MARGIN_MM;
  const right = pageWidth - TM_PDF_MARGIN_MM;
  let y = startY;

  // Student name — kept as real PDF text (not an image) so parents can
  // use their PDF viewer's search to jump straight to their child (item 85).
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  const nameLines = doc.splitTextToSize(("STUDENT: " + student.name).toUpperCase(), right - left);
  doc.text(nameLines, left, y);
  y += nameLines.length * 6 + 2;

  doc.setDrawColor(220, 220, 220);
  doc.line(left, y, right, y);
  y += 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 58, 95);
  doc.text("ATTENDANCE SUMMARY", left, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  const attRows = [
    ["Total Classes", String(attStats.total)],
    ["Present", String(attStats.present)],
    ["Absent", String(attStats.absent)],
    ["Attendance", tmPdfAttendanceLine(attStats)],
  ];
  attRows.forEach(([label, value]) => {
    doc.text(label, left, y);
    doc.text(value, right, y, { align: "right" });
    y += 5.5;
  });
  y += 3;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 58, 95);
  doc.text("FEE SUMMARY", left, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  const feeRows = [];
  if (feeInfo.monthlyFee !== undefined) feeRows.push(["Monthly Fee", tmFormatCurrency(feeInfo.monthlyFee)]);
  feeRows.push(["Amount Paid", tmFormatCurrency(feeInfo.paidForMonth)]);
  feeRows.push(["Payment Status", feeInfo.status]);
  feeRows.forEach(([label, value]) => {
    doc.text(label, left, y);
    doc.text(value, right, y, { align: "right" });
    y += 5.5;
  });

  return y + 4;
}

/* ---------------------------- individual report ---------------------------- */

/**
 * Same numbers as the existing on-screen "Student" report tab (both
 * read from tmAttendanceStats/tmFeesSummary over ALL of that student's
 * records — this report is all-time, not month-scoped, exactly like
 * the screen it mirrors) — just laid out as a branded, signed PDF.
 */
async function tmGenerateIndividualReportPdf(studentId) {
  if (tmPdfGenerating) return;
  tmPdfGenerating = true;
  try {
    const jsPDF = await tmLoadJsPdf();
    const [students, attendance, payments, settings] = await Promise.all([
      TMDB.getAllStudents(),
      TMDB.getAllAttendance(),
      TMDB.getAllPayments(),
      TMDB.getSettings(),
    ]);

    const student = students.find((s) => s.id === studentId);
    if (!student) throw new Error("Please select a student first.");

    const studentAttendance = attendance.filter((a) => a.studentId === studentId);
    const studentPayments = payments.filter((p) => p.studentId === studentId);
    const attStats = tmAttendanceStats(studentAttendance);
    const feeSummary = tmFeesSummary(student, studentPayments);
    const centerName = settings?.tuitionCenterName || "Tuition Manager";

    const doc = new jsPDF({ unit: "mm", format: "a4" });
    let y = await tmDrawReportHeader(doc, settings || {}, "STUDENT REPORT", "");

    y = tmDrawStudentSection(
      doc,
      student,
      attStats,
      { paidForMonth: feeSummary.totalPaid, status: feeSummary.totalPaid > 0 ? "PAID (to date)" : "NO PAYMENTS RECORDED" },
      y
    );

    await tmDrawSignatureBlock(doc, settings || {}, TM_PDF_PAGE_HEIGHT_MM - TM_PDF_MARGIN_MM);
    tmStampFootersAndPageNumbers(doc, centerName, "");

    const today = new Date();
    const filename =
      tmSanitizeFilename(centerName) +
      "-" +
      tmSanitizeFilename(student.name) +
      "-" +
      tmSanitizeFilename(tmMonthLabelFor(today.getFullYear(), today.getMonth())) +
      "-Report.pdf";

    await tmDownloadOrSharePdf(doc, filename, "Student Report — " + student.name);
  } finally {
    tmPdfGenerating = false;
  }
}

/* ---------------------------- monthly all-students report ---------------------------- */

/**
 * One dedicated page per active student for the selected month/year —
 * see tmDrawStudentSection for the shared per-student layout. Read-only:
 * only ever reads students/attendance/payments, never writes anything.
 */
async function tmGenerateMonthlyAllStudentsReportPdf(year, monthIndex) {
  if (tmPdfGenerating) return;
  tmPdfGenerating = true;
  try {
    const jsPDF = await tmLoadJsPdf();
    const [students, attendance, payments, settings] = await Promise.all([
      TMDB.getAllStudents(),
      TMDB.getAllAttendance(),
      TMDB.getAllPayments(),
      TMDB.getSettings(),
    ]);

    const activeStudents = students.filter((s) => s.active !== false).sort((a, b) => a.name.localeCompare(b.name));
    if (activeStudents.length === 0) {
      throw new Error("No students available for this report.");
    }

    const monthKey = tmMonthKey(year, monthIndex);
    const monthLabel = tmMonthLabelFor(year, monthIndex);
    const monthStart = tmDateToStr(new Date(year, monthIndex, 1));
    const monthEnd = tmDateToStr(new Date(year, monthIndex + 1, 0));
    const centerName = settings?.tuitionCenterName || "Tuition Manager";

    const doc = new jsPDF({ unit: "mm", format: "a4" });

    for (let i = 0; i < activeStudents.length; i++) {
      const student = activeStudents[i];
      if (i > 0) doc.addPage();

      const y0 = await tmDrawReportHeader(doc, settings || {}, "MONTHLY STUDENT REPORT", monthLabel.toUpperCase());

      const studentAttendance = attendance.filter((a) => a.studentId === student.id && tmDateInRange(a.date, monthStart, monthEnd));
      const studentPayments = payments.filter((p) => p.studentId === student.id);
      const attStats = tmAttendanceStats(studentAttendance);
      const feeInfo = tmMonthFeeStatus(student, studentPayments, monthKey);

      tmDrawStudentSection(doc, student, attStats, feeInfo, y0);
      await tmDrawSignatureBlock(doc, settings || {}, TM_PDF_PAGE_HEIGHT_MM - TM_PDF_MARGIN_MM);
    }

    tmStampFootersAndPageNumbers(doc, centerName, monthLabel);

    const filename = tmSanitizeFilename(centerName) + "-Monthly-Student-Reports-" + tmSanitizeFilename(monthLabel) + ".pdf";
    await tmDownloadOrSharePdf(doc, filename, "Monthly Student Reports — " + monthLabel);
  } finally {
    tmPdfGenerating = false;
  }
}

/* ---------------------------- download / share ---------------------------- */

/**
 * Always makes the PDF available as a normal download; additionally
 * offers the device's native Share sheet (so it can go straight to a
 * WhatsApp group) when the browser supports sharing files — no
 * WhatsApp API/login involved, just the standard Web Share API (item 65/66).
 */
async function tmDownloadOrSharePdf(doc, filename, shareTitle) {
  const blob = doc.output("blob");

  let shared = false;
  if (navigator.canShare && navigator.share) {
    try {
      const file = new File([blob], filename, { type: "application/pdf" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: shareTitle });
        shared = true;
      }
    } catch (err) {
      // User cancelled the share sheet, or sharing failed — fall back to a plain download below.
      shared = err && err.name === "AbortError" ? true : false;
    }
  }

  if (!shared) {
    doc.save(filename);
  }
}
