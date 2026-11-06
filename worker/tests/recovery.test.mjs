/* Tests for the recovery-code password reset. Run:  cd worker && npm test  (Node 22.5+) */
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { createD1 } from "./d1-shim.mjs";
import { normalizeRecoveryCode } from "../src/crypto.js";

const env = () => ({ DB: createD1() });
async function call(e, method, path, { token, body, ip = "1.1.1.1" } = {}) {
  const headers = { "Content-Type": "application/json", "CF-Connecting-IP": ip };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await worker.fetch(new Request("http://w.test" + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), e, { waitUntil() {} });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function register(e, email, password = "secret123") {
  const r = await call(e, "POST", "/api/auth/register", { body: { email, password } });
  assert.equal(r.status, 201);
  return r.body;
}

test("registration returns a well-formed recovery code and stores only its hash", async () => {
  const e = env();
  const r = await register(e, "a@x.com");
  assert.match(r.recoveryCode, /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
  const row = e.DB.raw.prepare("SELECT recovery_code_hash FROM users").get();
  assert.ok(row.recovery_code_hash && row.recovery_code_hash.length === 64);
  assert.ok(!JSON.stringify(e.DB.raw.prepare("SELECT * FROM users").all()).includes(r.recoveryCode.replace(/-/g, "")), "code itself is never stored");
  const me = await call(e, "GET", "/api/auth/me", { token: r.token });
  assert.equal(me.body.hasRecoveryCode, true);
});

test("codes are unique per account", async () => {
  const e = env();
  const a = await register(e, "a@x.com"), b = await register(e, "b@x.com");
  assert.notEqual(a.recoveryCode, b.recoveryCode);
});

test("forgot password: the right code sets a new password, signs out old sessions, retires the old code", async () => {
  const e = env();
  const r = await register(e, "a@x.com");
  const typed = r.recoveryCode.toLowerCase().replace(/-/g, " "); // sloppy typing is fine
  const rec = await call(e, "POST", "/api/auth/recover", { body: { email: "A@x.com", recoveryCode: typed, password: "brandnew99" } });
  assert.equal(rec.status, 200);
  assert.ok(rec.body.recoveryCode && rec.body.recoveryCode !== r.recoveryCode, "a NEW code is issued");

  assert.equal((await call(e, "GET", "/api/auth/me", { token: r.token })).status, 401, "old session is signed out");
  assert.equal((await call(e, "POST", "/api/auth/login", { body: { email: "a@x.com", password: "secret123" } })).status, 401, "old password stops working");
  assert.equal((await call(e, "POST", "/api/auth/login", { body: { email: "a@x.com", password: "brandnew99" } })).status, 200);

  const reuse = await call(e, "POST", "/api/auth/recover", { body: { email: "a@x.com", recoveryCode: r.recoveryCode, password: "another123" } });
  assert.equal(reuse.status, 400, "the used code no longer works");
  const again = await call(e, "POST", "/api/auth/recover", { body: { email: "a@x.com", recoveryCode: rec.body.recoveryCode, password: "another123" } });
  assert.equal(again.status, 200, "the new code works");
});

test("a code only works for its own account", async () => {
  const e = env();
  const a = await register(e, "a@x.com"), b = await register(e, "b@x.com");
  const r = await call(e, "POST", "/api/auth/recover", { body: { email: "b@x.com", recoveryCode: a.recoveryCode, password: "hacked1234" } });
  assert.equal(r.status, 400);
  assert.equal((await call(e, "POST", "/api/auth/login", { body: { email: "b@x.com", password: "secret123" } })).status, 200, "B's password is unchanged");
});

test("wrong email / wrong code / no code give the same message; guessing is rate-limited", async () => {
  const e = env();
  const a = await register(e, "a@x.com");
  const noEmail = await call(e, "POST", "/api/auth/recover", { body: { email: "nobody@x.com", recoveryCode: a.recoveryCode, password: "secret123" } });
  const badCode = await call(e, "POST", "/api/auth/recover", { body: { email: "a@x.com", recoveryCode: "AAAA-BBBB-CCCC-DDDD", password: "secret123" } });
  const junk = await call(e, "POST", "/api/auth/recover", { body: { email: "a@x.com", recoveryCode: "nope", password: "secret123" } });
  assert.equal(noEmail.body.error, badCode.body.error);
  assert.equal(junk.body.error, badCode.body.error);

  for (let i = 0; i < 6; i++) await call(e, "POST", "/api/auth/recover", { body: { email: "a@x.com", recoveryCode: "AAAA-BBBB-CCCC-DDDD", password: "secret123" } });
  const locked = await call(e, "POST", "/api/auth/recover", { body: { email: "a@x.com", recoveryCode: a.recoveryCode, password: "newpass123" } });
  assert.equal(locked.status, 429, "even the right code is refused while locked");

  // an old account that has no code yet cannot be recovered (same generic error)
  e.DB.raw.prepare("UPDATE users SET recovery_code_hash = NULL").run();
  const none = await call(e, "POST", "/api/auth/recover", { body: { email: "a@x.com", recoveryCode: a.recoveryCode, password: "newpass123" }, ip: "2.2.2.2" });
  assert.equal(none.status, 400);
  assert.equal(none.body.error, badCode.body.error);
});

test("settings: logged-in user can make a new code (needs password); the old code stops working", async () => {
  const e = env();
  const a = await register(e, "a@x.com");
  assert.equal((await call(e, "POST", "/api/auth/recovery-code", { token: a.token, body: { password: "wrong" } })).status, 403);
  assert.equal((await call(e, "POST", "/api/auth/recovery-code", { body: { password: "secret123" } })).status, 401, "needs login");
  const n = await call(e, "POST", "/api/auth/recovery-code", { token: a.token, body: { password: "secret123" } });
  assert.equal(n.status, 200);
  assert.notEqual(n.body.recoveryCode, a.recoveryCode);
  assert.equal((await call(e, "POST", "/api/auth/recover", { body: { email: "a@x.com", recoveryCode: a.recoveryCode, password: "xxxxxx1" } })).status, 400);
  assert.equal((await call(e, "POST", "/api/auth/recover", { body: { email: "a@x.com", recoveryCode: n.body.recoveryCode, password: "xxxxxx1" } })).status, 200);
});

test("existing accounts (made before this update) keep working and show hasRecoveryCode=false", async () => {
  const e = env();
  const a = await register(e, "old@x.com");
  e.DB.raw.prepare("UPDATE users SET recovery_code_hash = NULL, recovery_code_created_at = NULL").run();
  assert.equal((await call(e, "POST", "/api/auth/login", { body: { email: "old@x.com", password: "secret123" } })).status, 200);
  assert.equal((await call(e, "GET", "/api/auth/me", { token: a.token })).body.hasRecoveryCode, false);
});

test("auth options: email reset is advertised only when email is configured", async () => {
  const e = env();
  assert.deepEqual((await call(e, "GET", "/api/auth/options")).body, { recoveryCode: true, emailReset: false });
  e.BREVO_API_KEY = "k"; e.MAIL_FROM_EMAIL = "a@b.com"; e.APP_URL = "https://x.pages.dev";
  assert.equal((await call(e, "GET", "/api/auth/options")).body.emailReset, true);
});

test("normalizeRecoveryCode accepts sloppy typing and rejects non-codes", () => {
  assert.equal(normalizeRecoveryCode("k7qm 4txp-92wd hfn8"), "K7QM4TXP92WDHFN8");
  assert.equal(normalizeRecoveryCode("K7QM-4TXP-92WD"), "");
  assert.equal(normalizeRecoveryCode("0000-1111-OOOO-IIII"), "");
});
