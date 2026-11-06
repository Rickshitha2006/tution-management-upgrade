/* ==========================================================================
   Tuition Manager — legacy-local-db.js
   This is the ORIGINAL pre-cloud db.js, kept verbatim (only the exported
   object was renamed from TMDB to TMLegacyLocalDB) so it can still open
   and read a device's old on-device "TuitionManagerDB" IndexedDB database.
   Its only job now is to feed js/migrate.js: on first login, if this
   device still has old local data and the cloud account is empty,
   migrate.js reads it through here and uploads it via TMDB.restoreAllData().
   It is never used for day-to-day reads/writes anymore — see js/db.js.
   ========================================================================== */

const TM_DB_NAME = "TuitionManagerDB";
const TM_DB_VERSION = 1;

let tmDbInstance = null;

/**
 * Opens (and if needed, creates/upgrades) the IndexedDB database.
 * Returns a Promise that resolves with the open IDBDatabase instance.
 */
function tmOpenDb() {
  if (tmDbInstance) return Promise.resolve(tmDbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TM_DB_NAME, TM_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("students")) {
        const store = db.createObjectStore("students", { keyPath: "id" });
        store.createIndex("name", "name", { unique: false });
        store.createIndex("active", "active", { unique: false });
        store.createIndex("studentId", "studentId", { unique: false });
      }

      if (!db.objectStoreNames.contains("attendance")) {
        const store = db.createObjectStore("attendance", { keyPath: "id" });
        store.createIndex("studentId", "studentId", { unique: false });
        store.createIndex("date", "date", { unique: false });
        store.createIndex("studentId_date", ["studentId", "date"], { unique: true });
      }

      if (!db.objectStoreNames.contains("payments")) {
        const store = db.createObjectStore("payments", { keyPath: "id" });
        store.createIndex("studentId", "studentId", { unique: false });
        store.createIndex("date", "date", { unique: false });
      }
    };

    request.onsuccess = (event) => {
      tmDbInstance = event.target.result;
      resolve(tmDbInstance);
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

/**
 * Generic helper to run a transaction against one store.
 * mode: "readonly" | "readwrite"
 * work: function(store) => IDBRequest (or performs several requests)
 * Returns a Promise resolving with the request's result.
 */
function tmRunTx(storeName, mode, work) {
  return tmOpenDb().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try {
        const req = work(store);
        if (req && req.onsuccess !== undefined) {
          req.onsuccess = () => { result = req.result; };
          req.onerror = () => reject(req.error);
        }
      } catch (err) {
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
    });
  });
}

function tmGenerateId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

/* ---------------------------- Generic CRUD ---------------------------- */

const TMLegacyLocalDB = {
  add(storeName, record) {
    return tmRunTx(storeName, "readwrite", (store) => store.add(record));
  },

  put(storeName, record) {
    return tmRunTx(storeName, "readwrite", (store) => store.put(record));
  },

  get(storeName, id) {
    return tmRunTx(storeName, "readonly", (store) => store.get(id));
  },

  delete(storeName, id) {
    return tmRunTx(storeName, "readwrite", (store) => store.delete(id));
  },

  clear(storeName) {
    return tmRunTx(storeName, "readwrite", (store) => store.clear());
  },

  getAll(storeName) {
    return tmRunTx(storeName, "readonly", (store) => store.getAll());
  },

  getAllByIndex(storeName, indexName, value) {
    return tmOpenDb().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const idx = store.index(indexName);
        const req = idx.getAll(value);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    });
  },

  /* ---------------------------- Settings ---------------------------- */

  getSettings() {
    return TMLegacyLocalDB.get("settings", "config");
  },

  saveSettings(settings) {
    const record = Object.assign({ id: "config" }, settings);
    return TMLegacyLocalDB.put("settings", record);
  },

  /* ---------------------------- Students ---------------------------- */

  addStudent(student) {
    const now = new Date().toISOString();
    const record = Object.assign(
      {
        id: tmGenerateId(),
        active: true,
        createdAt: now,
        updatedAt: now,
      },
      student
    );
    return TMLegacyLocalDB.add("students", record).then(() => record);
  },

  updateStudent(id, updates) {
    return TMLegacyLocalDB.get("students", id).then((existing) => {
      if (!existing) throw new Error("Student not found");
      const updated = Object.assign({}, existing, updates, {
        id,
        updatedAt: new Date().toISOString(),
      });
      return TMLegacyLocalDB.put("students", updated).then(() => updated);
    });
  },

  deleteStudent(id) {
    // Also remove related attendance and payment records to keep data clean.
    return Promise.all([
      TMLegacyLocalDB.getAllByIndex("attendance", "studentId", id).then((records) =>
        Promise.all(records.map((r) => TMLegacyLocalDB.delete("attendance", r.id)))
      ),
      TMLegacyLocalDB.getAllByIndex("payments", "studentId", id).then((records) =>
        Promise.all(records.map((r) => TMLegacyLocalDB.delete("payments", r.id)))
      ),
    ]).then(() => TMLegacyLocalDB.delete("students", id));
  },

  getAllStudents() {
    return TMLegacyLocalDB.getAll("students");
  },

  getStudent(id) {
    return TMLegacyLocalDB.get("students", id);
  },

  /* ---------------------------- Attendance ---------------------------- */

  getAttendanceForDate(date) {
    return TMLegacyLocalDB.getAllByIndex("attendance", "date", date);
  },

  getAttendanceForStudent(studentId) {
    return TMLegacyLocalDB.getAllByIndex("attendance", "studentId", studentId);
  },

  getAllAttendance() {
    return TMLegacyLocalDB.getAll("attendance");
  },

  /**
   * Creates or updates a single attendance record for a student/date pair.
   * Prevents duplicates by looking up the studentId_date compound index.
   */
  markAttendance(studentId, date, status) {
    return tmOpenDb().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction("attendance", "readwrite");
        const store = tx.objectStore("attendance");
        const idx = store.index("studentId_date");
        const getReq = idx.get([studentId, date]);

        getReq.onsuccess = () => {
          const now = new Date().toISOString();
          const existing = getReq.result;
          let record;
          if (existing) {
            record = Object.assign({}, existing, { status, updatedAt: now });
          } else {
            record = {
              id: tmGenerateId(),
              studentId,
              date,
              status,
              createdAt: now,
              updatedAt: now,
            };
          }
          const putReq = store.put(record);
          putReq.onsuccess = () => resolve(record);
          putReq.onerror = () => reject(putReq.error);
        };
        getReq.onerror = () => reject(getReq.error);
      });
    });
  },

  /* ---------------------------- Payments ---------------------------- */

  addPayment(payment) {
    const now = new Date().toISOString();
    const record = Object.assign(
      { id: tmGenerateId(), createdAt: now },
      payment
    );
    return TMLegacyLocalDB.add("payments", record).then(() => record);
  },

  deletePayment(id) {
    return TMLegacyLocalDB.delete("payments", id);
  },

  getPaymentsForStudent(studentId) {
    return TMLegacyLocalDB.getAllByIndex("payments", "studentId", studentId);
  },

  getAllPayments() {
    return TMLegacyLocalDB.getAll("payments");
  },

  /* ---------------------------- Bulk / Backup ---------------------------- */

  async exportAllData() {
    const [settings, students, attendance, payments] = await Promise.all([
      TMLegacyLocalDB.getSettings(),
      TMLegacyLocalDB.getAllStudents(),
      TMLegacyLocalDB.getAllAttendance(),
      TMLegacyLocalDB.getAllPayments(),
    ]);
    return {
      appName: "Tuition Manager",
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      data: { settings, students, attendance, payments },
    };
  },

  async restoreAllData(payload) {
    if (!payload || !payload.data) {
      throw new Error("Invalid backup file: missing 'data' section.");
    }
    const { settings, students, attendance, payments } = payload.data;
    if (!Array.isArray(students) || !Array.isArray(attendance) || !Array.isArray(payments)) {
      throw new Error("Invalid backup file: students, attendance and payments must be lists.");
    }

    await Promise.all([
      TMLegacyLocalDB.clear("settings"),
      TMLegacyLocalDB.clear("students"),
      TMLegacyLocalDB.clear("attendance"),
      TMLegacyLocalDB.clear("payments"),
    ]);

    const jobs = [];
    if (settings) jobs.push(TMLegacyLocalDB.put("settings", Object.assign({ id: "config" }, settings)));
    students.forEach((s) => jobs.push(TMLegacyLocalDB.put("students", s)));
    attendance.forEach((a) => jobs.push(TMLegacyLocalDB.put("attendance", a)));
    payments.forEach((p) => jobs.push(TMLegacyLocalDB.put("payments", p)));

    await Promise.all(jobs);
    return true;
  },

  async clearAllData() {
    await Promise.all([
      TMLegacyLocalDB.clear("students"),
      TMLegacyLocalDB.clear("attendance"),
      TMLegacyLocalDB.clear("payments"),
    ]);
    return true;
  },
};
