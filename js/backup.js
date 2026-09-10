/* ==========================================================================
   Tuition Manager — backup.js
   Handles: full JSON backup/restore, demo data load/remove, and clearing data.
   ========================================================================== */

async function tmBackupAllData() {
  const payload = await TMDB.exportAllData();
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const filename = `tuition-manager-backup-${tmTodayStr()}.json`;
  tmDownloadBlob(blob, filename);
  tmToast("Backup downloaded: " + filename);
}

function tmRestoreFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const payload = JSON.parse(reader.result);
        await TMDB.restoreAllData(payload);
        resolve(true);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsText(file);
  });
}

/* ---------------------------- Demo data ---------------------------- */

const TM_DEMO_STUDENTS = [
  { name: "Arun Kumar", parentName: "Mr. Kumar", parentPhone: "9000000001", monthlyFee: 1500, joiningMonthsAgo: 5 },
  { name: "Priya Kumar", parentName: "Mr. Kumar", parentPhone: "9000000001", monthlyFee: 1500, joiningMonthsAgo: 4 },
  { name: "Kavin Raj", parentName: "Mrs. Raj", parentPhone: "9000000002", monthlyFee: 2000, joiningMonthsAgo: 3 },
  { name: "Divya S", parentName: "Mr. Selvam", parentPhone: "9000000003", monthlyFee: 1800, joiningMonthsAgo: 6 },
];

async function tmLoadDemoData() {
  const now = new Date();

  for (const demo of TM_DEMO_STUDENTS) {
    const joinDate = new Date(now.getFullYear(), now.getMonth() - demo.joiningMonthsAgo, 5);
    const student = await TMDB.addStudent({
      name: demo.name,
      studentId: "",
      parentName: demo.parentName,
      parentPhone: demo.parentPhone,
      studentPhone: "",
      joiningDate: tmDateToStr(joinDate),
      monthlyFee: demo.monthlyFee,
      notes: "",
      active: true,
      isDemo: true,
    });

    // Sample attendance: last 20 weekdays, mostly present
    let daysAdded = 0;
    let cursor = new Date(now);
    while (daysAdded < 20) {
      cursor.setDate(cursor.getDate() - 1);
      const day = cursor.getDay();
      if (day === 0 || day === 6) continue; // skip weekends
      const status = Math.random() < 0.88 ? "Present" : "Absent";
      await TMDB.markAttendance(student.id, tmDateToStr(cursor), status);
      daysAdded++;
    }

    // Sample payments: pay for all months except the current one
    const monthsToPay = Math.max(0, demo.joiningMonthsAgo);
    for (let i = 0; i < monthsToPay; i++) {
      const payDate = new Date(now.getFullYear(), now.getMonth() - demo.joiningMonthsAgo + i, 5);
      await TMDB.addPayment({
        studentId: student.id,
        amount: demo.monthlyFee,
        date: tmDateToStr(payDate),
        mode: i % 2 === 0 ? "UPI" : "Cash",
        reference: "",
        notes: "",
        isDemo: true,
      });
    }
  }

  tmToast("Demo data loaded.");
}

async function tmRemoveDemoData() {
  const students = await TMDB.getAllStudents();
  const demoStudents = students.filter((s) => s.isDemo);
  await Promise.all(demoStudents.map((s) => TMDB.deleteStudent(s.id)));
  tmToast(`Removed ${demoStudents.length} demo student${demoStudents.length === 1 ? "" : "s"} and their records.`);
}

/* ---------------------------- Clear all data ---------------------------- */

async function tmClearAllDataConfirmed() {
  await TMDB.clearAllData();
  tmToast("All students, attendance and fee records have been deleted.");
}
