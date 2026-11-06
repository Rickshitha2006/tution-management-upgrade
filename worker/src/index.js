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

import { hashPassword, verifyPassword, newId, newSessionToken, randomHex, sha256Hex, newRecoveryCode, normalizeRecoveryCode, hashRecoveryCode, safeEqual } from "./crypto.js";

const SESSION_DAYS = 30;
const RESET_MINUTES = 30;          // how long a reset link stays valid
const RESET_MAX_PER_HOUR = 3;      // reset emails per account per hour
const MAX_RECOVERY_FAILURES = 8;   // wrong recovery codes before a temporary lock
const RECOVERY_LOCK_MIN = 15;

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
    // Branding/signatures — always base64 data: URLs or "" (never null,
    // so the frontend never has to special-case null/undefined here).
    logoData: row.logo_data || "",
    headName: row.head_name || "",
    headSignatureData: row.head_signature_data || "",
    staffSignatureData: row.staff_signature_data || "",
  };
}

// Each image field is a base64 data: URL already resized/compressed on
// the client (see js/image-processing.js). This is a generous server-side
// backstop, not the primary size control — it exists so a buggy/bypassed
// client can never wedge an oversized row into D1.
const TM_MAX_IMAGE_FIELD_CHARS = 700000; // ~500KB of binary data, base64-encoded

function tmValidateImageField(value, label) {
  if (value && typeof value === "string" && value.length > TM_MAX_IMAGE_FIELD_CHARS) {
    throw new Error(label + " is too large. Please use a smaller image.");
  }
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

/* ---------------------------- password reset (email) ---------------------------- */

function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** True when the Worker has everything it needs to send email. */
function mailConfigured(env) {
  return !!(env.BREVO_API_KEY && env.MAIL_FROM_EMAIL);
}

/** Where reset links point. Set APP_URL to your website address (no trailing slash). */
function appBaseUrl(request, env) {
  if (env.APP_URL) return String(env.APP_URL).replace(/\/+$/, "");
  // Local development only: allow the browser's own localhost origin.
  const origin = request.headers.get("Origin") || "";
  try {
    const u = new URL(origin);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return u.origin;
  } catch { /* ignore */ }
  return "";
}

/** Sends one transactional email through Brevo's HTTPS API (free plan: 300/day). */
async function sendMail(env, { to, subject, html, text }) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender: { name: env.MAIL_FROM_NAME || "Smart Academy System", email: env.MAIL_FROM_EMAIL },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error("Email provider error " + res.status + ": " + detail.slice(0, 200));
  }
}

function resetEmailContent(link) {
  const safe = escapeHtml(link);
  const text =
    "Reset your Smart Academy System password\n\n" +
    "We received a request to reset your password. Open this link within " + RESET_MINUTES + " minutes:\n" + link +
    "\n\nIf you did not ask for this, you can ignore this email. Your password will not change.";
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#14162A">' +
    '<h2 style="margin:0 0 12px;color:#2F2B93">Reset your password</h2>' +
    "<p>We received a request to reset the password for your Smart Academy System account.</p>" +
    '<p style="margin:24px 0"><a href="' + safe + '" style="background:#2F2B93;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block">Choose a new password</a></p>' +
    "<p>This link works for " + RESET_MINUTES + " minutes and can be used once.</p>" +
    '<p style="color:#626680;font-size:13px">If the button does not work, copy this address into your browser:<br>' + safe + "</p>" +
    '<p style="color:#626680;font-size:13px">If you did not request this, you can safely ignore this email. Your password will not change.</p></div>';
  return { subject: "Reset your Smart Academy System password", html, text };
}

/**
 * POST /api/auth/forgot  { email }
 * Always answers the same way whether or not the email has an account, so the
 * endpoint cannot be used to discover which emails are registered.
 */
async function handleForgotPassword(request, env, ctx) {
  const body = await readJson(request);
  const email = (body.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) return errorResponse("Please enter a valid email address.");
  if (!mailConfigured(env)) {
    return errorResponse("Password reset email is not set up yet. Please contact the administrator.", 503);
  }
  const base = appBaseUrl(request, env);
  if (!base) return errorResponse("Password reset email is not set up yet. Please contact the administrator.", 503);

  const generic = { ok: true, message: "If an account exists for that email, a reset link has been sent." };

  const user = await env.DB.prepare(`SELECT id, email FROM users WHERE email = ?`).bind(email).first();
  if (!user) return json(generic);

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created_at > ?`).bind(user.id, hourAgo).first();
  if (recent && recent.n >= RESET_MAX_PER_HOUR) return json(generic);

  const token = randomHex(32);
  const now = new Date();
  await env.DB.prepare(
    `INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(newId(), user.id, await sha256Hex(token), now.toISOString(), new Date(now.getTime() + RESET_MINUTES * 60 * 1000).toISOString())
    .run();

  const link = base + "/reset-password.html?token=" + token;
  const send = sendMail(env, { to: user.email, ...resetEmailContent(link) }).catch((err) => console.error("Reset email failed:", err.message));
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(send);
  else await send;
  return json(generic);
}

/** POST /api/auth/reset  { token, password } */
async function handleResetPassword(request, env, ctx) {
  const body = await readJson(request);
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const password = body.password || "";
  if (password.length < 6) return errorResponse("Password must be at least 6 characters.");
  if (!/^[0-9a-f]{64}$/.test(token)) return errorResponse("This reset link is invalid or has expired.", 400);

  const row = await env.DB.prepare(
    `SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`
  )
    .bind(await sha256Hex(token), nowIso())
    .first();
  if (!row) return errorResponse("This reset link is invalid or has expired.", 400);

  const { hash, salt } = await hashPassword(password);
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?`).bind(hash, salt, now, row.user_id),
    env.DB.prepare(`UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL`).bind(now, row.user_id),
    // Signing out everywhere: anyone who had the old password loses access.
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(row.user_id),
  ]);

  // Courtesy notice so the owner notices an unexpected change.
  if (mailConfigured(env)) {
    const user = await env.DB.prepare(`SELECT email FROM users WHERE id = ?`).bind(row.user_id).first();
    if (user) {
      const text = "Your Smart Academy System password was just changed. If this was not you, reset it again immediately.";
      const html = '<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#14162A"><h2 style="color:#2F2B93">Password changed</h2><p>' + escapeHtml(text) + "</p></div>";
      const send = sendMail(env, { to: user.email, subject: "Your password was changed", html, text }).catch((err) => console.error("Notice email failed:", err.message));
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(send);
    }
  }
  return json({ ok: true });
}



/* ---------------------------- recovery code (no email needed) ---------------------------- */

/** Creates a fresh code for the user, stores ONLY its hash (replacing any old code) and returns the readable code. */
async function issueRecoveryCode(env, userId) {
  const code = newRecoveryCode();
  const hash = await hashRecoveryCode(userId, normalizeRecoveryCode(code));
  await env.DB.prepare(`UPDATE users SET recovery_code_hash = ?, recovery_code_created_at = ? WHERE id = ?`)
    .bind(hash, nowIso(), userId)
    .run();
  return code;
}

/** GET /api/auth/options — lets the login page know whether the optional email reset is available. */
function handleAuthOptions(request, env) {
  return json({ recoveryCode: true, emailReset: mailConfigured(env) && !!env.APP_URL });
}

/**
 * POST /api/auth/recover  { email, recoveryCode, password }
 * Sets a new password when the recovery code is right. Wrong email, wrong
 * code and "this account has no code yet" all give the SAME answer, so it
 * cannot be used to find out which emails have accounts. Repeated wrong
 * guesses lock that email (from that IP) for a while.
 * On success the old code is retired and a NEW one is returned (shown once).
 */
async function handleRecoverPassword(request, env) {
  const body = await readJson(request);
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const code = normalizeRecoveryCode(body.recoveryCode);
  const genericFail = "Incorrect email or recovery code. Check it and try again.";

  if (password.length < 6) return errorResponse("Password must be at least 6 characters.");
  if (password.length > 200) return errorResponse("Password is too long.");

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = ip + "|" + email;
  const attempt = await env.DB.prepare(`SELECT attempts, first_attempt_at, locked_until FROM recovery_attempts WHERE key = ?`).bind(key).first();
  const nowMs = Date.now();
  if (attempt && attempt.locked_until && new Date(attempt.locked_until).getTime() > nowMs) {
    const minutes = Math.ceil((new Date(attempt.locked_until).getTime() - nowMs) / 60000);
    return errorResponse(`Too many wrong attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, 429);
  }

  const user = isValidEmail(email)
    ? await env.DB.prepare(`SELECT id, recovery_code_hash FROM users WHERE email = ?`).bind(email).first()
    : null;

  let ok = false;
  if (user && user.recovery_code_hash && code) {
    ok = safeEqual(await hashRecoveryCode(user.id, code), user.recovery_code_hash);
  } else {
    await hashRecoveryCode("none", code || "none"); // similar work either way
  }

  if (!ok) {
    const windowMs = 15 * 60000;
    const stale = !attempt || nowMs - new Date(attempt.first_attempt_at).getTime() > windowMs;
    const attempts = stale ? 1 : attempt.attempts + 1;
    await env.DB.prepare(
      `INSERT INTO recovery_attempts (key, attempts, first_attempt_at, locked_until) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET attempts = excluded.attempts, first_attempt_at = excluded.first_attempt_at, locked_until = excluded.locked_until`
    )
      .bind(key, attempts, stale ? new Date(nowMs).toISOString() : attempt.first_attempt_at, attempts >= MAX_RECOVERY_FAILURES ? new Date(nowMs + RECOVERY_LOCK_MIN * 60000).toISOString() : null)
      .run();
    return errorResponse(genericFail, 400);
  }

  const { hash, salt } = await hashPassword(password);
  const newCode = newRecoveryCode();
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, recovery_code_hash = ?, recovery_code_created_at = ?, updated_at = ? WHERE id = ?`)
      .bind(hash, salt, await hashRecoveryCode(user.id, normalizeRecoveryCode(newCode)), now, now, user.id),
    // Signing out everywhere: anyone who had the old password loses access.
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(user.id),
    // Any pending email reset links die too.
    env.DB.prepare(`UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL`).bind(now, user.id),
    env.DB.prepare(`DELETE FROM recovery_attempts WHERE key = ?`).bind(key),
  ]);
  return json({ ok: true, recoveryCode: newCode });
}

/**
 * POST /api/auth/recovery-code  { password }   (logged in)
 * Creates a new recovery code (the old one stops working). Needs the current
 * password so someone who borrows an unlocked phone cannot swap the code.
 */
async function handleNewRecoveryCode(request, env, user) {
  const body = await readJson(request);
  const row = await env.DB.prepare(`SELECT password_hash, password_salt FROM users WHERE id = ?`).bind(user.id).first();
  const ok = row ? await verifyPassword(body.password || "", row.password_hash, row.password_salt) : false;
  if (!ok) return errorResponse("Incorrect password.", 403);
  return json({ recoveryCode: await issueRecoveryCode(env, user.id) });
}

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

  // The recovery code is shown to the user ONCE, right now. Only its hash is kept.
  const recoveryCode = await issueRecoveryCode(env, userId);

  const token = await createSession(env, userId);
  return json({ token, user: { id: userId, email }, recoveryCode }, 201);
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
  const row = await env.DB.prepare(`SELECT recovery_code_hash, recovery_code_created_at FROM users WHERE id = ?`).bind(user.id).first();
  return json({
    id: user.id,
    email: user.email,
    hasRecoveryCode: !!(row && row.recovery_code_hash),
    recoveryCodeCreatedAt: (row && row.recovery_code_created_at) || null,
  });
}

/* ---------------------------- settings routes ---------------------------- */

async function handleGetSettings(request, env, user) {
  const row = await env.DB.prepare(`SELECT * FROM settings WHERE user_id = ?`).bind(user.id).first();
  return json(settingsToApi(row));
}

async function handlePutSettings(request, env, user) {
  const body = await readJson(request);

  try {
    tmValidateImageField(body.logoData, "Logo");
    tmValidateImageField(body.headSignatureData, "Head signature");
    tmValidateImageField(body.staffSignatureData, "Staff signature");
  } catch (err) {
    return errorResponse(err.message, 413);
  }

  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO settings (user_id, tuition_center_name, staff_name, contact_number, address, setup_complete, logo_data, head_name, head_signature_data, staff_signature_data, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       tuition_center_name = excluded.tuition_center_name,
       staff_name = excluded.staff_name,
       contact_number = excluded.contact_number,
       address = excluded.address,
       setup_complete = excluded.setup_complete,
       logo_data = excluded.logo_data,
       head_name = excluded.head_name,
       head_signature_data = excluded.head_signature_data,
       staff_signature_data = excluded.staff_signature_data,
       updated_at = excluded.updated_at`
  )
    .bind(
      user.id,
      body.tuitionCenterName || "",
      body.staffName || "",
      body.contactNumber || "",
      body.address || "",
      body.setupComplete ? 1 : 0,
      body.logoData || "",
      body.headName || "",
      body.headSignatureData || "",
      body.staffSignatureData || "",
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


/* ---------------------------- staff routes (attendance + salary sheet) ---------------------------- */

const STAFF_STATUSES = ["Present", "Half Day", "Absent", "Leave"];

/** "2, 4,4,x,9" -> "2,4"  (only weekday numbers 0-6, sorted, no repeats). */
function cleanVisitDays(v) {
  const list = Array.isArray(v) ? v : String(v || "").split(",");
  const days = [...new Set(list.map((x) => String(x).trim()).filter((x) => /^[0-6]$/.test(x)).map(Number))].sort();
  return days.join(",");
}

/** Reads the visiting-staff fields from a request body, falling back to `base` (an existing row). Returns { error } if invalid. */
function readVisitingFields(body, base) {
  const b = base || {};
  const payType = body.payType !== undefined ? body.payType : b.pay_type || "monthly";
  if (payType !== "monthly" && payType !== "visiting") return { error: "Pay type must be monthly or visiting." };
  const payModel = body.payModel !== undefined ? body.payModel : b.pay_model || "per_visit";
  if (payModel !== "per_visit" && payModel !== "fixed") return { error: "Pay model must be per_visit or fixed." };
  const visitDays = cleanVisitDays(body.visitDays !== undefined ? body.visitDays : b.visit_days);
  const visitRate = body.visitRate !== undefined ? Math.max(0, num(body.visitRate)) : b.visit_rate || 0;
  if (payType === "visiting" && !visitDays) return { error: "Choose at least one visit day for visiting staff." };
  return { pay_type: payType, pay_model: payModel, visit_days: visitDays, visit_rate: visitRate };
}

function staffToApi(r) {
  return {
    id: r.id,
    name: r.name,
    role: r.role || "",
    phone: r.phone || "",
    joiningDate: r.joining_date || "",
    monthlySalary: r.monthly_salary || 0,
    payType: r.pay_type === "visiting" ? "visiting" : "monthly",
    visitDays: cleanVisitDays(r.visit_days),
    payModel: r.pay_model === "fixed" ? "fixed" : "per_visit",
    visitRate: r.visit_rate || 0,
    notes: r.notes || "",
    active: !!r.active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function staffAttendanceToApi(r) {
  return { id: r.id, staffId: r.staff_id, date: r.date, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at };
}

function payrollToApi(r) {
  return {
    id: r.id,
    staffId: r.staff_id,
    month: r.month,
    workingDays: r.working_days || 0,
    presentDays: r.present_days || 0,
    halfDays: r.half_days || 0,
    leaveDays: r.leave_days || 0,
    absentDays: r.absent_days || 0,
    holidayDays: r.holiday_days || 0,
    payBasis: ["per_visit", "fixed_visits"].includes(r.pay_basis) ? r.pay_basis : "monthly",
    baseSalary: r.base_salary || 0,
    bonus: r.bonus || 0,
    deduction: r.deduction || 0,
    netPay: r.net_pay || 0,
    status: r.status || "Pending",
    paidDate: r.paid_date || "",
    mode: r.mode || "",
    notes: r.notes || "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function getOwnedStaff(env, userId, id) {
  return await env.DB.prepare(`SELECT * FROM staff WHERE id = ? AND user_id = ?`).bind(id, userId).first();
}

function isMonthKey(v) {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}
function isDateStr(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function handleGetStaff(request, env, user) {
  const { results } = await env.DB.prepare(`SELECT * FROM staff WHERE user_id = ? ORDER BY created_at`).bind(user.id).all();
  return json(results.map(staffToApi));
}

async function handlePostStaff(request, env, user) {
  const body = await readJson(request);
  if (!body.name || !String(body.name).trim()) return errorResponse("Staff name is required.");
  const vf = readVisitingFields(body, null);
  if (vf.error) return errorResponse(vf.error);
  const id = newId();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO staff (id, user_id, name, role, phone, joining_date, monthly_salary, notes, active, created_at, updated_at,
                        pay_type, visit_days, pay_model, visit_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      user.id,
      String(body.name).trim(),
      body.role || "",
      body.phone || "",
      body.joiningDate || "",
      Math.max(0, num(body.monthlySalary)),
      body.notes || "",
      body.active === false ? 0 : 1,
      now,
      now,
      vf.pay_type,
      vf.visit_days,
      vf.pay_model,
      vf.visit_rate
    )
    .run();
  const row = await env.DB.prepare(`SELECT * FROM staff WHERE id = ?`).bind(id).first();
  return json(staffToApi(row), 201);
}

async function handlePutStaff(request, env, user, id) {
  const existing = await getOwnedStaff(env, user.id, id);
  if (!existing) return errorResponse("Staff member not found.", 404);
  const body = await readJson(request);
  const vf = readVisitingFields(body, existing);
  if (vf.error) return errorResponse(vf.error);
  const m = {
    name: body.name !== undefined ? String(body.name).trim() || existing.name : existing.name,
    role: body.role !== undefined ? body.role : existing.role,
    phone: body.phone !== undefined ? body.phone : existing.phone,
    joining_date: body.joiningDate !== undefined ? body.joiningDate : existing.joining_date,
    monthly_salary: body.monthlySalary !== undefined ? Math.max(0, num(body.monthlySalary)) : existing.monthly_salary,
    notes: body.notes !== undefined ? body.notes : existing.notes,
    active: body.active !== undefined ? (body.active ? 1 : 0) : existing.active,
  };
  await env.DB.prepare(
    `UPDATE staff SET name=?, role=?, phone=?, joining_date=?, monthly_salary=?, notes=?, active=?, updated_at=?,
                      pay_type=?, visit_days=?, pay_model=?, visit_rate=? WHERE id=? AND user_id=?`
  )
    .bind(m.name, m.role, m.phone, m.joining_date, m.monthly_salary, m.notes, m.active, nowIso(),
          vf.pay_type, vf.visit_days, vf.pay_model, vf.visit_rate, id, user.id)
    .run();
  const row = await env.DB.prepare(`SELECT * FROM staff WHERE id = ?`).bind(id).first();
  return json(staffToApi(row));
}

async function handleDeleteStaff(request, env, user, id) {
  const existing = await getOwnedStaff(env, user.id, id);
  if (!existing) return errorResponse("Staff member not found.", 404);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM staff_attendance WHERE staff_id = ? AND user_id = ?`).bind(id, user.id),
    env.DB.prepare(`DELETE FROM staff_payroll WHERE staff_id = ? AND user_id = ?`).bind(id, user.id),
    env.DB.prepare(`DELETE FROM staff WHERE id = ? AND user_id = ?`).bind(id, user.id),
  ]);
  return json({ ok: true });
}

/** GET /api/staff-attendance?date=YYYY-MM-DD  or  ?month=YYYY-MM  (or all). */
async function handleGetStaffAttendance(request, env, user, url) {
  const date = url.searchParams.get("date");
  const month = url.searchParams.get("month");
  let stmt;
  if (date) {
    if (!isDateStr(date)) return errorResponse("Invalid date.");
    stmt = env.DB.prepare(`SELECT * FROM staff_attendance WHERE user_id = ? AND date = ?`).bind(user.id, date);
  } else if (month) {
    if (!isMonthKey(month)) return errorResponse("Invalid month.");
    stmt = env.DB.prepare(`SELECT * FROM staff_attendance WHERE user_id = ? AND date LIKE ?`).bind(user.id, month + "-%");
  } else {
    stmt = env.DB.prepare(`SELECT * FROM staff_attendance WHERE user_id = ?`).bind(user.id);
  }
  const { results } = await stmt.all();
  return json(results.map(staffAttendanceToApi));
}

/**
 * POST /api/staff-attendance  { date, records: [{ staffId, status }] }
 * Saves a whole day in one call. A status of "" / "Unmarked" removes that
 * staff member's record for the day. Staff ids are re-checked against the
 * authenticated user's own staff — ids belonging to anyone else are ignored.
 */
async function handlePostStaffAttendance(request, env, user) {
  const body = await readJson(request);
  if (!isDateStr(body.date)) return errorResponse("A valid date is required.");
  if (!Array.isArray(body.records)) return errorResponse("records must be a list.");

  const { results: owned } = await env.DB.prepare(`SELECT id FROM staff WHERE user_id = ?`).bind(user.id).all();
  const ownedIds = new Set(owned.map((r) => r.id));
  const now = nowIso();
  const statements = [];

  for (const rec of body.records) {
    if (!rec || !ownedIds.has(rec.staffId)) continue;
    if (!rec.status || rec.status === "Unmarked") {
      statements.push(
        env.DB.prepare(`DELETE FROM staff_attendance WHERE staff_id = ? AND date = ? AND user_id = ?`).bind(rec.staffId, body.date, user.id)
      );
      continue;
    }
    if (!STAFF_STATUSES.includes(rec.status)) continue;
    statements.push(
      env.DB.prepare(
        `INSERT INTO staff_attendance (id, user_id, staff_id, date, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(staff_id, date) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`
      ).bind(newId(), user.id, rec.staffId, body.date, rec.status, now, now)
    );
  }

  if (statements.length) await env.DB.batch(statements);
  const { results } = await env.DB.prepare(`SELECT * FROM staff_attendance WHERE user_id = ? AND date = ?`).bind(user.id, body.date).all();
  return json(results.map(staffAttendanceToApi));
}

async function handleGetStaffPayroll(request, env, user, url) {
  const month = url.searchParams.get("month");
  let stmt;
  if (month) {
    if (!isMonthKey(month)) return errorResponse("Invalid month.");
    stmt = env.DB.prepare(`SELECT * FROM staff_payroll WHERE user_id = ? AND month = ?`).bind(user.id, month);
  } else {
    stmt = env.DB.prepare(`SELECT * FROM staff_payroll WHERE user_id = ? ORDER BY month`).bind(user.id);
  }
  const { results } = await stmt.all();
  return json(results.map(payrollToApi));
}

/** PUT /api/staff-payroll — creates or updates one staff member's salary sheet row for a month. */
async function handlePutStaffPayroll(request, env, user) {
  const b = await readJson(request);
  if (!isMonthKey(b.month)) return errorResponse("A valid month (YYYY-MM) is required.");
  const staff = await getOwnedStaff(env, user.id, b.staffId);
  if (!staff) return errorResponse("Staff member not found.", 404);

  const status = b.status === "Paid" ? "Paid" : "Pending";
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO staff_payroll (id, user_id, staff_id, month, working_days, present_days, half_days, leave_days, absent_days, holiday_days,
                                base_salary, bonus, deduction, net_pay, status, paid_date, mode, notes, created_at, updated_at, pay_basis)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(staff_id, month) DO UPDATE SET
       pay_basis = excluded.pay_basis,
       working_days = excluded.working_days, present_days = excluded.present_days, half_days = excluded.half_days,
       leave_days = excluded.leave_days, absent_days = excluded.absent_days, holiday_days = excluded.holiday_days, base_salary = excluded.base_salary,
       bonus = excluded.bonus, deduction = excluded.deduction, net_pay = excluded.net_pay, status = excluded.status,
       paid_date = excluded.paid_date, mode = excluded.mode, notes = excluded.notes, updated_at = excluded.updated_at`
  )
    .bind(
      newId(),
      user.id,
      staff.id,
      b.month,
      Math.max(0, num(b.workingDays)),
      Math.max(0, num(b.presentDays)),
      Math.max(0, num(b.halfDays)),
      Math.max(0, num(b.leaveDays)),
      Math.max(0, num(b.absentDays)),
      Math.max(0, num(b.holidayDays)),
      Math.max(0, num(b.baseSalary)),
      Math.max(0, num(b.bonus)),
      Math.max(0, num(b.deduction)),
      Math.max(0, num(b.netPay)),
      status,
      status === "Paid" ? b.paidDate || "" : "",
      status === "Paid" ? b.mode || "" : "",
      b.notes || "",
      now,
      now,
      ["per_visit", "fixed_visits"].includes(b.payBasis) ? b.payBasis : "monthly"
    )
    .run();

  const row = await env.DB.prepare(`SELECT * FROM staff_payroll WHERE staff_id = ? AND month = ? AND user_id = ?`).bind(staff.id, b.month, user.id).first();
  return json(payrollToApi(row));
}

async function handleDeleteStaffPayroll(request, env, user, id) {
  const res = await env.DB.prepare(`DELETE FROM staff_payroll WHERE id = ? AND user_id = ?`).bind(id, user.id).run();
  if (!res.meta || res.meta.changes === 0) return errorResponse("Salary record not found.", 404);
  return json({ ok: true });
}


/* ---------------------------- holiday calendar ---------------------------- */

const HOLIDAY_TYPES = ["Festival", "Rain", "Public", "Other"];
const HOLIDAY_APPLIES = ["both", "students", "staff"];

function holidayToApi(r) {
  return {
    id: r.id,
    date: r.date,
    name: r.name,
    type: r.type || "Festival",
    appliesTo: r.applies_to || "both",
    paidForStaff: !!r.paid_for_staff,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** GET /api/holidays  (optional ?from=YYYY-MM-DD&to=YYYY-MM-DD) */
async function handleGetHolidays(request, env, user, url) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  let stmt;
  if (from || to) {
    if ((from && !isDateStr(from)) || (to && !isDateStr(to))) return errorResponse("Invalid date range.");
    stmt = env.DB.prepare(`SELECT * FROM holidays WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date`).bind(user.id, from || "0000-01-01", to || "9999-12-31");
  } else {
    stmt = env.DB.prepare(`SELECT * FROM holidays WHERE user_id = ? ORDER BY date`).bind(user.id);
  }
  const { results } = await stmt.all();
  return json(results.map(holidayToApi));
}

function eachDate(startStr, endStr) {
  const out = [];
  const d = new Date(startStr + "T00:00:00Z");
  const end = new Date(endStr + "T00:00:00Z");
  while (d <= end && out.length < 63) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * POST /api/holidays  { date | startDate+endDate, name, type, appliesTo, paidForStaff }
 * One holiday per date: adding a holiday on a date that already has one replaces it.
 * A range creates one holiday per day (up to 62 days).
 */
async function handlePostHoliday(request, env, user) {
  const b = await readJson(request);
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return errorResponse("Give the holiday a name.");
  const type = HOLIDAY_TYPES.includes(b.type) ? b.type : "Festival";
  const appliesTo = HOLIDAY_APPLIES.includes(b.appliesTo) ? b.appliesTo : "both";
  const paid = b.paidForStaff === false ? 0 : 1;

  let dates;
  if (isDateStr(b.startDate) && isDateStr(b.endDate)) {
    if (b.endDate < b.startDate) return errorResponse("The end date is before the start date.");
    dates = eachDate(b.startDate, b.endDate);
  } else if (isDateStr(b.date)) {
    dates = [b.date];
  } else {
    return errorResponse("Choose a date for the holiday.");
  }

  const now = nowIso();
  await env.DB.batch(
    dates.map((d) =>
      env.DB.prepare(
        `INSERT INTO holidays (id, user_id, date, name, type, applies_to, paid_for_staff, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, date) DO UPDATE SET name = excluded.name, type = excluded.type, applies_to = excluded.applies_to,
           paid_for_staff = excluded.paid_for_staff, updated_at = excluded.updated_at`
      ).bind(newId(), user.id, d, name, type, appliesTo, paid, now, now)
    )
  );
  const { results } = await env.DB.prepare(`SELECT * FROM holidays WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date`).bind(user.id, dates[0], dates[dates.length - 1]).all();
  return json(results.map(holidayToApi), 201);
}

async function handlePutHoliday(request, env, user, id) {
  const existing = await env.DB.prepare(`SELECT * FROM holidays WHERE id = ? AND user_id = ?`).bind(id, user.id).first();
  if (!existing) return errorResponse("Holiday not found.", 404);
  const b = await readJson(request);
  const name = b.name !== undefined ? String(b.name).trim() || existing.name : existing.name;
  const type = b.type !== undefined ? (HOLIDAY_TYPES.includes(b.type) ? b.type : existing.type) : existing.type;
  const appliesTo = b.appliesTo !== undefined ? (HOLIDAY_APPLIES.includes(b.appliesTo) ? b.appliesTo : existing.applies_to) : existing.applies_to;
  const paid = b.paidForStaff !== undefined ? (b.paidForStaff ? 1 : 0) : existing.paid_for_staff;
  await env.DB.prepare(`UPDATE holidays SET name = ?, type = ?, applies_to = ?, paid_for_staff = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .bind(name, type, appliesTo, paid, nowIso(), id, user.id)
    .run();
  const row = await env.DB.prepare(`SELECT * FROM holidays WHERE id = ?`).bind(id).first();
  return json(holidayToApi(row));
}

async function handleDeleteHoliday(request, env, user, id) {
  const res = await env.DB.prepare(`DELETE FROM holidays WHERE id = ? AND user_id = ?`).bind(id, user.id).run();
  if (!res.meta || res.meta.changes === 0) return errorResponse("Holiday not found.", 404);
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
  const { settings, students, attendance, payments, staff, staffAttendance, staffPayroll, holidays } = body || {};
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


  // Holidays are only replaced when the backup contains them.
  if (Array.isArray(holidays)) {
    statements.unshift(env.DB.prepare(`DELETE FROM holidays WHERE user_id = ?`).bind(user.id));
    holidays.forEach((h) => {
      if (!isDateStr(h.date) || !h.name) return;
      statements.push(
        env.DB.prepare(
          `INSERT INTO holidays (id, user_id, date, name, type, applies_to, paid_for_staff, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, date) DO NOTHING`
        ).bind(h.id || newId(), user.id, h.date, String(h.name), HOLIDAY_TYPES.includes(h.type) ? h.type : "Festival",
               HOLIDAY_APPLIES.includes(h.appliesTo) ? h.appliesTo : "both", h.paidForStaff === false ? 0 : 1, h.createdAt || now, h.updatedAt || now)
      );
    });
  }

  // Staff data is only replaced when the backup contains it, so restoring an
  // older backup (made before the staff feature existed) never wipes staff.
  if (Array.isArray(staff)) {
    statements.unshift(
      env.DB.prepare(`DELETE FROM staff_payroll WHERE user_id = ?`).bind(user.id),
      env.DB.prepare(`DELETE FROM staff_attendance WHERE user_id = ?`).bind(user.id),
      env.DB.prepare(`DELETE FROM staff WHERE user_id = ?`).bind(user.id)
    );
    const validStaffIds = new Set(staff.map((m) => m.id));
    staff.forEach((m) => {
      statements.push(
        env.DB.prepare(
          `INSERT INTO staff (id, user_id, name, role, phone, joining_date, monthly_salary, notes, active, created_at, updated_at,
                              pay_type, visit_days, pay_model, visit_rate)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(m.id || newId(), user.id, m.name || "Unnamed", m.role || "", m.phone || "", m.joiningDate || "",
               Math.max(0, num(m.monthlySalary)), m.notes || "", m.active === false ? 0 : 1, m.createdAt || now, m.updatedAt || now,
               m.payType === "visiting" && cleanVisitDays(m.visitDays) ? "visiting" : "monthly", cleanVisitDays(m.visitDays),
               m.payModel === "fixed" ? "fixed" : "per_visit", Math.max(0, num(m.visitRate)))
      );
    });
    (Array.isArray(staffAttendance) ? staffAttendance : []).forEach((a) => {
      if (!validStaffIds.has(a.staffId) || !STAFF_STATUSES.includes(a.status) || !isDateStr(a.date)) return;
      statements.push(
        env.DB.prepare(
          `INSERT INTO staff_attendance (id, user_id, staff_id, date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(a.id || newId(), user.id, a.staffId, a.date, a.status, a.createdAt || now, a.updatedAt || now)
      );
    });
    (Array.isArray(staffPayroll) ? staffPayroll : []).forEach((p) => {
      if (!validStaffIds.has(p.staffId) || !isMonthKey(p.month)) return;
      statements.push(
        env.DB.prepare(
          `INSERT INTO staff_payroll (id, user_id, staff_id, month, working_days, present_days, half_days, leave_days, absent_days, holiday_days,
                                      base_salary, bonus, deduction, net_pay, status, paid_date, mode, notes, created_at, updated_at, pay_basis)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(p.id || newId(), user.id, p.staffId, p.month, num(p.workingDays), num(p.presentDays), num(p.halfDays),
               num(p.leaveDays), num(p.absentDays), num(p.holidayDays), num(p.baseSalary), num(p.bonus), num(p.deduction), num(p.netPay),
               p.status === "Paid" ? "Paid" : "Pending", p.paidDate || "", p.mode || "", p.notes || "", p.createdAt || now, p.updatedAt || now,
               ["per_visit", "fixed_visits"].includes(p.payBasis) ? p.payBasis : "monthly")
      );
    });
  }

  if (settings) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO settings (user_id, tuition_center_name, staff_name, contact_number, address, setup_complete, logo_data, head_name, head_signature_data, staff_signature_data, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           tuition_center_name = excluded.tuition_center_name,
           staff_name = excluded.staff_name,
           contact_number = excluded.contact_number,
           address = excluded.address,
           setup_complete = excluded.setup_complete,
           logo_data = excluded.logo_data,
           head_name = excluded.head_name,
           head_signature_data = excluded.head_signature_data,
           staff_signature_data = excluded.staff_signature_data,
           updated_at = excluded.updated_at`
      ).bind(
        user.id,
        settings.tuitionCenterName || "",
        settings.staffName || "",
        settings.contactNumber || "",
        settings.address || "",
        settings.setupComplete ? 1 : 0,
        settings.logoData || "",
        settings.headName || "",
        settings.headSignatureData || "",
        settings.staffSignatureData || "",
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
    env.DB.prepare(`DELETE FROM staff_payroll WHERE user_id = ?`).bind(user.id),
    env.DB.prepare(`DELETE FROM staff_attendance WHERE user_id = ?`).bind(user.id),
    env.DB.prepare(`DELETE FROM staff WHERE user_id = ?`).bind(user.id),
    env.DB.prepare(`DELETE FROM holidays WHERE user_id = ?`).bind(user.id),
  ]);
  return json({ ok: true });
}

/* ---------------------------- router ---------------------------- */

export default {
  async fetch(request, env, ctx) {
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
      if (path === "/api/auth/options" && method === "GET") return handleAuthOptions(request, env);
      if (path === "/api/auth/recover" && method === "POST") return await handleRecoverPassword(request, env);
      if (path === "/api/auth/forgot" && method === "POST") return await handleForgotPassword(request, env, ctx);
      if (path === "/api/auth/reset" && method === "POST") return await handleResetPassword(request, env, ctx);

      // ---- everything else requires a valid session ----
      const user = await authenticate(request, env);
      if (!user) return errorResponse("Not authenticated.", 401);

      if (path === "/api/auth/logout" && method === "POST") return await handleLogout(request, env, user);
      if (path === "/api/auth/recovery-code" && method === "POST") return await handleNewRecoveryCode(request, env, user);
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

      if (path === "/api/staff" && method === "GET") return await handleGetStaff(request, env, user);
      if (path === "/api/staff" && method === "POST") return await handlePostStaff(request, env, user);
      m = path.match(/^\/api\/staff\/([^/]+)$/);
      if (m && method === "PUT") return await handlePutStaff(request, env, user, m[1]);
      if (m && method === "DELETE") return await handleDeleteStaff(request, env, user, m[1]);

      if (path === "/api/staff-attendance" && method === "GET") return await handleGetStaffAttendance(request, env, user, url);
      if (path === "/api/staff-attendance" && method === "POST") return await handlePostStaffAttendance(request, env, user);

      if (path === "/api/staff-payroll" && method === "GET") return await handleGetStaffPayroll(request, env, user, url);
      if (path === "/api/staff-payroll" && method === "PUT") return await handlePutStaffPayroll(request, env, user);
      m = path.match(/^\/api\/staff-payroll\/([^/]+)$/);
      if (m && method === "DELETE") return await handleDeleteStaffPayroll(request, env, user, m[1]);

      if (path === "/api/holidays" && method === "GET") return await handleGetHolidays(request, env, user, url);
      if (path === "/api/holidays" && method === "POST") return await handlePostHoliday(request, env, user);
      m = path.match(/^\/api\/holidays\/([^/]+)$/);
      if (m && method === "PUT") return await handlePutHoliday(request, env, user, m[1]);
      if (m && method === "DELETE") return await handleDeleteHoliday(request, env, user, m[1]);

      if (path === "/api/bulk/restore" && method === "POST") return await handleBulkRestore(request, env, user);
      if (path === "/api/bulk/clear" && method === "POST") return await handleBulkClear(request, env, user);

      return errorResponse("Not found.", 404);
    } catch (err) {
      console.error(err);
      return errorResponse("Server error: " + (err && err.message ? err.message : String(err)), 500);
    }
  },
};
