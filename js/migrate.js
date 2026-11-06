/* ==========================================================================
   Tuition Manager — migrate.js
   Runs once, right after a successful login/registration on a device.
   If this device still has data in the old on-device "TuitionManagerDB"
   IndexedDB database (from before cloud sync existed) AND the cloud
   account is currently empty, offers to import it — never automatically,
   and never overwriting existing cloud data.
   ========================================================================== */

const TM_MIGRATION_FLAG_KEY = "tm_migration_checked_v1";

async function tmCheckAndOfferMigration() {
  if (localStorage.getItem(TM_MIGRATION_FLAG_KEY) === "1") return;

  try {
    // Never overwrite an account that already has cloud data.
    const cloudStudents = await TMDB.getAllStudents();
    if (cloudStudents && cloudStudents.length > 0) {
      localStorage.setItem(TM_MIGRATION_FLAG_KEY, "1");
      return;
    }
  } catch (err) {
    // Can't reach the cloud right now — try again on a future login instead
    // of silently marking this as "checked".
    console.warn("Migration check: could not read cloud data yet.", err);
    return;
  }

  let legacyExport;
  try {
    legacyExport = await TMLegacyLocalDB.exportAllData();
  } catch (err) {
    // No old IndexedDB database on this device/browser — nothing to migrate.
    localStorage.setItem(TM_MIGRATION_FLAG_KEY, "1");
    return;
  }

  const d = legacyExport && legacyExport.data;
  const hasLegacyData = d && ((d.students && d.students.length) || (d.attendance && d.attendance.length) || (d.payments && d.payments.length));

  localStorage.setItem(TM_MIGRATION_FLAG_KEY, "1");
  if (!hasLegacyData) return;

  const proceed = confirm(
    "We found existing student, attendance and fee data saved on this device from before cloud sync was added.\n\n" +
      "Import it into your account now? This only needs to happen once. (You can also do this later from Settings.)"
  );
  if (!proceed) return;

  try {
    await TMDB.restoreAllData(legacyExport);
    alert("Your existing data has been imported into your cloud account.");
    window.location.reload();
  } catch (err) {
    alert("Import failed: " + (err.message || "Unknown error") + "\n\nYour data on this device is untouched — you can try again from Settings.");
  }
}

/**
 * Manual re-trigger for Settings → "Import data from this device", in case
 * the user dismissed the automatic prompt earlier.
 */
async function tmManualImportLegacyLocalData() {
  let legacyExport;
  try {
    legacyExport = await TMLegacyLocalDB.exportAllData();
  } catch (err) {
    alert("No older on-device data was found on this device/browser.");
    return;
  }
  const d = legacyExport && legacyExport.data;
  const hasLegacyData = d && ((d.students && d.students.length) || (d.attendance && d.attendance.length) || (d.payments && d.payments.length));
  if (!hasLegacyData) {
    alert("No older on-device data was found on this device/browser.");
    return;
  }
  const proceed = confirm(
    "This will REPLACE your current cloud data with the data saved on this device from before cloud sync. Make a backup first if you're not sure. Continue?"
  );
  if (!proceed) return;
  await TMDB.restoreAllData(legacyExport);
  alert("Import complete.");
  window.location.reload();
}
