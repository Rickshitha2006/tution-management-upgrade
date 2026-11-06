/* Tests for visiting / part-time staff. Run:  cd worker && npm test  (Node 22.5+) */
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { createD1 } from "./d1-shim.mjs";

const env = () => ({ DB: createD1() });
async function call(e, method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json", "CF-Connecting-IP": "1.1.1.1" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await worker.fetch(new Request("http://w.test" + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), e, { waitUntil() {} });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function register(e, email) {
  const r = await call(e, "POST", "/api/auth/register", { body: { email, password: "secret123" } });
  return r.body.token;
}

test("existing-style staff stay monthly with no visit days", async () => {
  const e = env(), t = await register(e, "a@x.com");
  const r = await call(e, "POST", "/api/staff", { token: t, body: { name: "Meena", monthlySalary: 12000 } });
  assert.equal(r.status, 201);
  assert.equal(r.body.payType, "monthly");
  assert.equal(r.body.visitDays, "");
});

test("visiting staff: per-visit and fixed models save and read back", async () => {
  const e = env(), t = await register(e, "a@x.com");
  const a = await call(e, "POST", "/api/staff", { token: t, body: { name: "Ravi", role: "Accountancy", payType: "visiting", visitDays: [4, 2, 2], payModel: "per_visit", visitRate: 800 } });
  assert.equal(a.status, 201);
  assert.equal(a.body.visitDays, "2,4", "sorted, no repeats");
  assert.equal(a.body.visitRate, 800);
  const b = await call(e, "POST", "/api/staff", { token: t, body: { name: "Sana", payType: "visiting", visitDays: "1", payModel: "fixed", monthlySalary: 3000 } });
  assert.equal(b.body.payModel, "fixed");
  assert.equal(b.body.monthlySalary, 3000);
  const list = await call(e, "GET", "/api/staff", { token: t });
  assert.equal(list.body.length, 2);
});

test("validation: visiting needs visit days; bad values are rejected or cleaned", async () => {
  const e = env(), t = await register(e, "a@x.com");
  assert.equal((await call(e, "POST", "/api/staff", { token: t, body: { name: "X", payType: "visiting", visitDays: "" } })).status, 400);
  assert.equal((await call(e, "POST", "/api/staff", { token: t, body: { name: "X", payType: "bogus" } })).status, 400);
  assert.equal((await call(e, "POST", "/api/staff", { token: t, body: { name: "X", payType: "visiting", visitDays: "9,x" } })).status, 400);
  const ok = await call(e, "POST", "/api/staff", { token: t, body: { name: "X", payType: "visiting", visitDays: "9,3,x", visitRate: -50 } });
  assert.equal(ok.body.visitDays, "3");
  assert.equal(ok.body.visitRate, 0, "negative rate becomes 0");
});

test("editing: switch a staff member to visiting and back; omitted fields are kept", async () => {
  const e = env(), t = await register(e, "a@x.com");
  const s = (await call(e, "POST", "/api/staff", { token: t, body: { name: "Ravi", monthlySalary: 9000 } })).body;
  const up = await call(e, "PUT", "/api/staff/" + s.id, { token: t, body: { payType: "visiting", visitDays: "2,4", visitRate: 700 } });
  assert.equal(up.body.payType, "visiting");
  assert.equal(up.body.monthlySalary, 9000);
  const rename = await call(e, "PUT", "/api/staff/" + s.id, { token: t, body: { name: "Ravi K" } });
  assert.equal(rename.body.visitDays, "2,4");
  assert.equal(rename.body.visitRate, 700);
  const back = await call(e, "PUT", "/api/staff/" + s.id, { token: t, body: { payType: "monthly" } });
  assert.equal(back.body.payType, "monthly");
});

test("payroll rows remember how they were calculated (pay basis)", async () => {
  const e = env(), t = await register(e, "a@x.com");
  const s = (await call(e, "POST", "/api/staff", { token: t, body: { name: "Ravi", payType: "visiting", visitDays: "2", visitRate: 800 } })).body;
  const p = await call(e, "PUT", "/api/staff-payroll", { token: t, body: { staffId: s.id, month: "2026-11", workingDays: 4, presentDays: 3, baseSalary: 800, netPay: 2400, payBasis: "per_visit" } });
  assert.equal(p.body.payBasis, "per_visit");
  const q = await call(e, "PUT", "/api/staff-payroll", { token: t, body: { staffId: s.id, month: "2026-11", presentDays: 3, baseSalary: 800, netPay: 2400, payBasis: "nonsense" } });
  assert.equal(q.body.payBasis, "monthly");
});

test("isolation: another account cannot see or change visiting staff", async () => {
  const e = env(), a = await register(e, "a@x.com"), b = await register(e, "b@x.com");
  const s = (await call(e, "POST", "/api/staff", { token: a, body: { name: "Ravi", payType: "visiting", visitDays: "2", visitRate: 800 } })).body;
  assert.equal((await call(e, "GET", "/api/staff", { token: b })).body.length, 0);
  assert.equal((await call(e, "PUT", "/api/staff/" + s.id, { token: b, body: { visitRate: 1 } })).status, 404);
  assert.equal((await call(e, "PUT", "/api/staff-payroll", { token: b, body: { staffId: s.id, month: "2026-11" } })).status, 404);
  assert.equal((await call(e, "GET", "/api/staff", { token: a })).body[0].visitRate, 800);
});

test("backup restore keeps visiting settings and pay basis", async () => {
  const e = env(), t = await register(e, "a@x.com");
  const s = (await call(e, "POST", "/api/staff", { token: t, body: { name: "Ravi", payType: "visiting", visitDays: "2,4", payModel: "fixed", monthlySalary: 3000 } })).body;
  await call(e, "PUT", "/api/staff-payroll", { token: t, body: { staffId: s.id, month: "2026-11", baseSalary: 3000, netPay: 3000, payBasis: "fixed_visits" } });
  const staff = (await call(e, "GET", "/api/staff", { token: t })).body;
  const staffPayroll = (await call(e, "GET", "/api/staff-payroll", { token: t })).body;
  const r = await call(e, "POST", "/api/bulk/restore", { token: t, body: { students: [], attendance: [], payments: [], staff, staffAttendance: [], staffPayroll } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const again = (await call(e, "GET", "/api/staff", { token: t })).body[0];
  assert.equal(again.payType, "visiting");
  assert.equal(again.visitDays, "2,4");
  assert.equal(again.payModel, "fixed");
  assert.equal((await call(e, "GET", "/api/staff-payroll", { token: t })).body[0].payBasis, "fixed_visits");
});
