/* ==========================================================================
   Tuition Manager Worker — index.js
   Cloudflare Worker API backing the existing Tuition Manager frontend.
   Storage: Cloudflare D1 (see ../migrations/0001_init.sql for schema).

   Every route (except /api/auth/register and /api/auth/login) requires a
   valid session token in the Authorization header:
       Authorization: Bearer <token>
   Every query is scoped to req.user.id — the Worker never trusts a
   user_id/student_id supplied by the client alone; ownership is always
   re-checked against the database before reading or writing a record.
   ========================================================================== */

import { hashPassword, verifyPassword, newId, newSessionToken } from "./crypto.js";

const SESSION_DAYS = 30;

/* ---------------------------- small helpers ---------------------------- */

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function errorResponse(message, status = 400) {
  return json({ error: message }, status);
}

function nowIso() {
  return new Date().toISOString();
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* ---------------------------- row <-> API mapping ---------------------------- */
// D1 columns are snake_case; the existing frontend's data shape (unchanged
// since the original IndexedDB version) is camelCase. Map at the edge so
// nothing else has to change.

function studentToApi(row) {
  return {
    id: row.id,
    name: row.name,
    studentId: row.student_id || "",
    parentName: row.parent_name || "",
    parentPhone: row.parent_phone || "",
    studentPhone: row.student_phone || "",
    joiningDate: row.joining_date || "",
    monthlyFee: row.monthly_fee || 0,
    notes: row.notes || "",
    active: !!row.active,
    isDemo: !!row.is_demo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function attendanceToApi(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    date: row.date,
    status: row.status,
    markedAt: row.marked_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function paymentToApi(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    amount: row.amount,
    date: row.date,
    forMonth: row.for_month || "",
    mode: row.mode || "",
    reference: row.reference || "",
    notes: row.notes || "",
    isDemo: !!row.is_demo,
    createdAt: row.created_at,
  };
}

function settingsToApi(row) {
  if (!row) return null;
  return {
    tuitionCenterName: row.tuition_center_name || "",
    staffName: row.staff_name || "",
    contactNumber: row.contact_number || "",
    address: row.address || "",
    setupComplete: !!row.setup_complete,
  };
}

/* ---------------------------- auth middleware ---------------------------- */

async function authenticate(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;

  const row = await env.DB.prepare(
    `SELECT sessions.user_id as user_id, sessions.expires_at as expires_at, users.email as email
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = ?`
  )
    .bind(token)
    .first();

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  return { id: row.user_id, email: row.email, token };
}

/* ---------------------------- ownership helpers ---------------------------- */

async function getOwnedStudent(env, userId, studentId) {
  return env.DB.prepare(`SELECT * FROM students WHERE id = ? AND user_id = ?`)
    .bind(studentId, userId)
    .first();
}

async function getOwnedAttendance(env, userId, id) {
  return env.DB.prepare(`SELECT * FROM attendance WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first();
}

async function getOwnedPayment(env, userId, id) {
  return env.DB.prepare(`SELECT * FROM payments WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first();
}

/* ---------------------------- auth routes ---------------------------- */

async function handleRegister(request, env) {
  const body = await readJson(request);
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";

  if (!isValidEmail(email)) return errorResponse("Please enter a valid email address.");
  if (password.length < 6) return errorResponse("Password must be at least 6 characters.");

  const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first();
  if (existing) return errorResponse("An account with this email already exists.", 409);

  const { hash, salt } = await hashPassword(password);
  const userId = newId();
  const now = nowIso();

  await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(userId, email, hash, salt, now, now)
    .run();

  await env.DB.prepare(
    `INSERT INTO settings (user_id, setup_complete, updated_at) VALUES (?, 0, ?)`
  )
    .bind(userId, now)
    .run();

  const token = await createSession(env, userId);
  return json({ token, user: { id: userId, email } }, 201);
}

async function handleLogin(request, env) {
  const body = await readJson(request);
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";

  const user = await env.DB.prepare(
    `SELECT id, email, password_hash, password_salt FROM users WHERE email = ?`
  )
    .bind(email)
    .first();

  // Same error for "no such user" and "wrong password" — don't leak which one.
  if (!user) return errorResponse("Incorrect email or password.", 401);
  const ok = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!ok) return errorResponse("Incorrect email or password.", 401);

  const token = await createSession(env, user.id);
  return json({ token, user: { id: user.id, email: user.email } });
}

async function createSession(env, userId) {
  const token = newSessionToken();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await env.DB.prepare(
    `INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`
  )
    .bind(token, userId, now.toISOString(), expires.toISOString())
    .run();
  return token;
}

async function handleLogout(request, env, user) {
  await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(user.token).run();
  return json({ ok: true });
}

async function handleMe(request, env, user) {
  return json({ id: user.id, email: user.email });
}

/* ---------------------------- settings routes ---------------------------- */

async function handleGetSettings(request, env, user) {
  const row = await env.DB.prepare(`SELECT * FROM settings WHERE user_id = ?`).bind(user.id).first();
  return json(settingsToApi(row));
}

async function handlePutSettings(request, env, user) {
  const body = await readJson(request);
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO settings (user_id, tuition_center_name, staff_name, contact_number, address, setup_complete, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       tuition_center_name = excluded.tuition_center_name,
       staff_name = excluded.staff_name,
       contact_number = excluded.contact_number,
       address = excluded.address,
       setup_complete = excluded.setup_complete,
       updated_at = excluded.updated_at`
  )
    .bind(
      user.id,
      body.tuitionCenterName || "",
      body.staffName || "",
      body.contactNumber || "",
      body.address || "",
      body.setupComplete ? 1 : 0,
      now
    )
    .run();

  const row = await env.DB.prepare(`SELECT * FROM settings WHERE user_id = ?`).bind(user.id).first();
  return json(settingsToApi(row));
}

/* ---------------------------- students routes ---------------------------- */

async function handleGetStudents(request, env, user) {
  const { results } = await env.DB.prepare(`SELECT * FROM students WHERE user_id = ? ORDER BY created_at`)
    .bind(user.id)
    .all();
  return json(results.map(studentToApi));
}

async function handlePostStudent(request, env, user) {
  const body = await readJson(request);
  if (!body.name || !body.name.trim()) return errorResponse("Student name is required.");

  const id = newId();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO students (id, user_id, name, student_id, parent_name, parent_phone, student_phone, joining_date, monthly_fee, notes, active, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      user.id,
      body.name.trim(),
      body.studentId || "",
      body.parentName || "",
      body.parentPhone || "",
      body.studentPhone || "",
      body.joiningDate || "",
      Number(body.monthlyFee) || 0,
      body.notes || "",
      body.active === false ? 0 : 1,
      body.isDemo ? 1 : 0,
      now,
      now
    )
    .run();

  const row = await env.DB.prepare(`SELECT * FROM students WHERE id = ?`).bind(id).first();
  return json(studentToApi(row), 201);
}

async function handlePutStudent(request, env, user, id) {
  const existing = await getOwnedStudent(env, user.id, id);
  if (!existing) return errorResponse("Student not found.", 404);

  const body = await readJson(request);
  const now = nowIso();
  const merged = {
    name: body.name !== undefined ? body.name : existing.name,
    student_id: body.studentId !== undefined ? body.studentId : existing.student_id,
    parent_name: body.parentName !== undefined ? body.parentName : existing.parent_name,
    parent_phone: body.parentPhone !== undefined ? body.parentPhone : existing.parent_phone,
    student_phone: body.studentPhone !== undefined ? body.studentPhone : existing.student_phone,
    joining_date: body.joiningDate !== undefined ? body.joiningDate : existing.joining_date,
    monthly_fee: body.monthlyFee !== undefined ? Number(body.monthlyFee) || 0 : existing.monthly_fee,
    notes: body.notes !== undefined ? body.notes : existing.notes,
    active: body.active !== undefined ? (body.active ? 1 : 0) : existing.active,
    is_demo: body.isDemo !== undefined ? (body.isDemo ? 1 : 0) : existing.is_demo,
  };

  await env.DB.prepare(
    `UPDATE students SET name=?, student_id=?, parent_name=?, parent_phone=?, student_phone=?, joining_date=?, monthly_fee=?, notes=?, active=?, is_demo=?, updated_at=?
     WHERE id = ? AND user_id = ?`
  )
    .bind(
      merged.name,
      merged.student_id,
      merged.parent_name,
      merged.parent_phone,
      merged.student_phone,
      merged.joining_date,
      merged.monthly_fee,
      merged.notes,
      merged.active,
      merged.is_demo,
      now,
      id,
      user.id
    )
    .run();

  const row = await env.DB.prepare(`SELECT * FROM students WHERE id = ?`).bind(id).first();
  return json(studentToApi(row));
}

async function handleDeleteStudent(request, env, user, id) {
  const existing = await getOwnedStudent(env, user.id, id);
  if (!existing) return errorResponse("Student not found.", 404);

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM attendance WHERE student_id = ? AND user_id = ?`).bind(id, user.id),
    env.DB.prepare(`DELETE FROM payments WHERE student_id = ? AND user_id = ?`).bind(id, user.id),
    env.DB.prepare(`DELETE FROM students WHERE id = ? AND user_id = ?`).bind(id, user.id),
  ]);

  return json({ ok: true });
}

/* ---------------------------- attendance routes ---------------------------- */

async function handleGetAttendance(request, env, user, url) {
  const date = url.searchParams.get("date");
  let stmt;
  if (date) {
    stmt = env.DB.prepare(`SELECT * FROM attendance WHERE user_id = ? AND date = ?`).bind(user.id, date);
  } else {
    stmt = env.DB.prepare(`SELECT * FROM attendance WHERE user_id = ?`).bind(user.id);
  }
  const { results } = await stmt.all();
  return json(results.map(attendanceToApi));
}

/**
 * Marks (creates or updates) a single student/date attendance record.
 * "marked_at" is only ever (re)stamped with the current time at the
 * moment a record's status actually becomes "Present" — re-saving an
 * already-Present record keeps its original marked_at, and Absent
 * records never carry a marked_at. See migrations/0001_init.sql.
 */
async function handlePostAttendance(request, env, user) {
  const body = await readJson(request);
  const { studentId, date, status } = body;
  if (!studentId || !date || !status) return errorResponse("studentId, date and status are required.");
  if (status !== "Present" && status !== "Absent") return errorResponse("status must be Present or Absent.");

  const student = await getOwnedStudent(env, user.id, studentId);
  if (!student) return errorResponse("Student not found.", 404);

  const existing = await env.DB.prepare(
    `SELECT * FROM attendance WHERE student_id = ? AND user_id = ? AND date = ?`
  )
    .bind(studentId, user.id, date)
    .first();

  const now = nowIso();
  let markedAt = null;
  if (status === "Present") {
    markedAt = existing && existing.status === "Present" ? existing.marked_at : now;
  }

  if (existing) {
    await env.DB.prepare(
      `UPDATE attendance SET status = ?, marked_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`
    )
      .bind(status, markedAt, now, existing.id, user.id)
      .run();
    const row = await env.DB.prepare(`SELECT * FROM attendance WHERE id = ?`).bind(existing.id).first();
    return json(attendanceToApi(row));
  }

  const id = newId();
  await env.DB.prepare(
    `INSERT INTO attendance (id, user_id, student_id, date, status, marked_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, user.id, studentId, date, status, markedAt, now, now)
    .run();
  const row = await env.DB.prepare(`SELECT * FROM attendance WHERE id = ?`).bind(id).first();
  return json(attendanceToApi(row), 201);
}

async function handlePutAttendance(request, env, user, id) {
  const existing = await getOwnedAttendance(env, user.id, id);
  if (!existing) return errorResponse("Attendance record not found.", 404);

  const body = await readJson(request);
  const status = body.status || existing.status;
  const now = nowIso();
  let markedAt = existing.marked_at;
  if (status === "Present" && existing.status !== "Present") markedAt = now;
  if (status === "Absent") markedAt = null;

  await env.DB.prepare(`UPDATE attendance SET status = ?, marked_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .bind(status, markedAt, now, id, user.id)
    .run();

  const row = await env.DB.prepare(`SELECT * FROM attendance WHERE id = ?`).bind(id).first();
  return json(attendanceToApi(row));
}

async function handleDeleteAttendance(request, env, user, id) {
  const existing = await getOwnedAttendance(env, user.id, id);
  if (!existing) return errorResponse("Attendance record not found.", 404);
  await env.DB.prepare(`DELETE FROM attendance WHERE id = ? AND user_id = ?`).bind(id, user.id).run();
  return json({ ok: true });
}

/* ---------------------------- payments routes ---------------------------- */

async function handleGetPayments(request, env, user) {
  const { results } = await env.DB.prepare(`SELECT * FROM payments WHERE user_id = ? ORDER BY date`)
    .bind(user.id)
    .all();
  return json(results.map(paymentToApi));
}

async function handlePostPayment(request, env, user) {
  const body = await readJson(request);
  if (!body.studentId || !body.amount || !body.date) {
    return errorResponse("studentId, amount and date are required.");
  }
  const student = await getOwnedStudent(env, user.id, body.studentId);
  if (!student) return errorResponse("Student not found.", 404);

  const id = newId();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO payments (id, user_id, student_id, amount, date, for_month, mode, reference, notes, is_demo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      user.id,
      body.studentId,
      Number(body.amount) || 0,
      body.date,
      body.forMonth || "",
      body.mode || "",
      body.reference || "",
      body.notes || "",
      body.isDemo ? 1 : 0,
      now
    )
    .run();

  const row = await env.DB.prepare(`SELECT * FROM payments WHERE id = ?`).bind(id).first();
  return json(paymentToApi(row), 201);
}

async function handleDeletePayment(request, env, user, id) {
  const existing = await getOwnedPayment(env, user.id, id);
  if (!existing) return errorResponse("Payment not found.", 404);
  await env.DB.prepare(`DELETE FROM payments WHERE id = ? AND user_id = ?`).bind(id, user.id).run();
  return json({ ok: true });
}

/* ---------------------------- bulk routes (backup / restore / clear / demo) ---------------------------- */

/**
 * Replaces ALL of the authenticated user's data with the given payload.
 * Used by: Settings → Restore from Backup, AND by the one-time
 * local-data migration flow the first time an existing user logs in
 * from a device that still has pre-cloud IndexedDB data (see js/migrate.js).
 * Every inserted row is force-assigned the authenticated user's id —
 * a restored/migrated file can never write into another account.
 */
async function handleBulkRestore(request, env, user) {
  const body = await readJson(request);
  const { settings, students, attendance, payments } = body || {};
  if (!Array.isArray(students) || !Array.isArray(attendance) || !Array.isArray(payments)) {
    return errorResponse("Invalid backup: students, attendance and payments must be lists.");
  }

  const now = nowIso();
  const statements = [
    env.DB.prepare(`DELETE FROM attendance WHERE user_id = ?`).bind(user.id),
    env.DB.prepare(`DELETE FROM payments WHERE user_id = ?`).bind(user.id),
    env.DB.prepare(`DELETE FROM students WHERE user_id = ?`).bind(user.id),
  ];

  students.forEach((s) => {
    statements.push(
      env.DB.prepare(
        `INSERT INTO students (id, user_id, name, student_id, parent_name, parent_phone, student_phone, joining_date, monthly_fee, notes, active, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        s.id || newId(),
        user.id,
        s.name || "Unnamed",
        s.studentId || "",
        s.parentName || "",
        s.parentPhone || "",
        s.studentPhone || "",
        s.joiningDate || "",
        Number(s.monthlyFee) || 0,
        s.notes || "",
        s.active === false ? 0 : 1,
        s.isDemo ? 1 : 0,
        s.createdAt || now,
        s.updatedAt || now
      )
    );
  });

  const validStudentIds = new Set(students.map((s) => s.id));

  attendance.forEach((a) => {
    if (!validStudentIds.has(a.studentId)) return; // skip orphaned records
    statements.push(
      env.DB.prepare(
        `INSERT INTO attendance (id, user_id, student_id, date, status, marked_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        a.id || newId(),
        user.id,
        a.studentId,
        a.date,
        a.status,
        a.markedAt || null,
        a.createdAt || now,
        a.updatedAt || now
      )
    );
  });

  payments.forEach((p) => {
    if (!validStudentIds.has(p.studentId)) return;
    statements.push(
      env.DB.prepare(
        `INSERT INTO payments (id, user_id, student_id, amount, date, for_month, mode, reference, notes, is_demo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        p.id || newId(),
        user.id,
        p.studentId,
        Number(p.amount) || 0,
        p.date,
        p.forMonth || "",
        p.mode || "",
        p.reference || "",
        p.notes || "",
        p.isDemo ? 1 : 0,
        p.createdAt || now
      )
    );
  });

  if (settings) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO settings (user_id, tuition_center_name, staff_name, contact_number, address, setup_complete, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           tuition_center_name = excluded.tuition_center_name,
           staff_name = excluded.staff_name,
           contact_number = excluded.contact_number,
           address = excluded.address,
           setup_complete = excluded.setup_complete,
           updated_at = excluded.updated_at`
      ).bind(
        user.id,
        settings.tuitionCenterName || "",
        settings.staffName || "",
        settings.contactNumber || "",
        settings.address || "",
        settings.setupComplete ? 1 : 0,
        now
      )
    );
  }

  await env.DB.batch(statements);
  return json({ ok: true });
}

/**
 * Deletes only the authenticated user's students/attendance/payments —
 * mirrors the original app's "Clear All Data" (which also left the
 * settings/profile record untouched). Never touches other users' rows.
 */
async function handleBulkClear(request, env, user) {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM attendance WHERE user_id = ?`).bind(user.id),
    env.DB.prepare(`DELETE FROM payments WHERE user_id = ?`).bind(user.id),
    env.DB.prepare(`DELETE FROM students WHERE user_id = ?`).bind(user.id),
  ]);
  return json({ ok: true });
}

/* ---------------------------- router ---------------------------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      // ---- public auth endpoints ----
      if (path === "/api/auth/register" && method === "POST") return await handleRegister(request, env);
      if (path === "/api/auth/login" && method === "POST") return await handleLogin(request, env);

      // ---- everything else requires a valid session ----
      const user = await authenticate(request, env);
      if (!user) return errorResponse("Not authenticated.", 401);

      if (path === "/api/auth/logout" && method === "POST") return await handleLogout(request, env, user);
      if (path === "/api/auth/me" && method === "GET") return await handleMe(request, env, user);

      if (path === "/api/settings" && method === "GET") return await handleGetSettings(request, env, user);
      if (path === "/api/settings" && method === "PUT") return await handlePutSettings(request, env, user);

      if (path === "/api/students" && method === "GET") return await handleGetStudents(request, env, user);
      if (path === "/api/students" && method === "POST") return await handlePostStudent(request, env, user);
      let m = path.match(/^\/api\/students\/([^/]+)$/);
      if (m && method === "PUT") return await handlePutStudent(request, env, user, m[1]);
      if (m && method === "DELETE") return await handleDeleteStudent(request, env, user, m[1]);

      if (path === "/api/attendance" && method === "GET") return await handleGetAttendance(request, env, user, url);
      if (path === "/api/attendance" && method === "POST") return await handlePostAttendance(request, env, user);
      m = path.match(/^\/api\/attendance\/([^/]+)$/);
      if (m && method === "PUT") return await handlePutAttendance(request, env, user, m[1]);
      if (m && method === "DELETE") return await handleDeleteAttendance(request, env, user, m[1]);

      if (path === "/api/payments" && method === "GET") return await handleGetPayments(request, env, user);
      if (path === "/api/payments" && method === "POST") return await handlePostPayment(request, env, user);
      m = path.match(/^\/api\/payments\/([^/]+)$/);
      if (m && method === "DELETE") return await handleDeletePayment(request, env, user, m[1]);

      if (path === "/api/bulk/restore" && method === "POST") return await handleBulkRestore(request, env, user);
      if (path === "/api/bulk/clear" && method === "POST") return await handleBulkClear(request, env, user);

      return errorResponse("Not found.", 404);
    } catch (err) {
      console.error(err);
      return errorResponse("Server error: " + (err && err.message ? err.message : String(err)), 500);
    }
  },
};
