/* Checks the browser-side pay rules for visiting staff by loading js/staff.js with tiny stubs. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "js", "staff.js"), "utf8");
const ctx = { console, document: {}, tmThisMonthKey: () => "2026-11", tmTodayStr: () => "2026-11-30", tmMonthKey: () => "", tmHolidayMap: () => ({}) };
vm.createContext(ctx);
vm.runInContext(src + "\nthis.calc = tmStaffCalcMonth; this.basis = tmPayBasisOf;", ctx);
const { calc, basis } = ctx;

// November 2026: Tuesdays = 3,10,17,24 ; Thursdays = 5,12,19,26
const att = (staffId, list) => list.map(([d, status]) => ({ staffId, date: "2026-11-" + String(d).padStart(2, "0"), status }));
const perVisit = { id: "v", name: "Ravi", payType: "visiting", visitDays: "2,4", payModel: "per_visit", visitRate: 800, monthlySalary: 0 };
const fixed = { id: "f", name: "Sana", payType: "visiting", visitDays: "2,4", payModel: "fixed", monthlySalary: 4000, visitRate: 0 };

test("pay basis", () => {
  assert.equal(basis({ payType: "monthly" }), "monthly");
  assert.equal(basis(perVisit), "per_visit");
  assert.equal(basis(fixed), "fixed_visits");
  assert.equal(basis({ payType: "visiting", visitDays: "" }), "monthly", "no visit days -> treated as full-time");
});

test("per visit: visits x rate, half visit = half, absent earns nothing, bonus/deduction apply", () => {
  const a = att("v", [[3, "Present"], [5, "Present"], [10, "Half Day"], [12, "Absent"], [17, "Present"]]);
  const r = calc(perVisit, "2026-11", a, null, null, {});
  assert.equal(r.paidDays, 3.5);
  assert.equal(r.earned, 2800);
  assert.equal(r.workingDays, 8, "8 scheduled visit days in the month");
  assert.equal(r.unmarkedDays, 3, "19, 24, 26 not marked yet");
  const r2 = calc(perVisit, "2026-11", a, null, { bonus: 200, deduction: 100 }, {});
  assert.equal(r2.netPay, 2900);
});

test("per visit: an extra visit on a non-scheduled day is paid", () => {
  const r = calc(perVisit, "2026-11", att("v", [[3, "Present"], [7, "Present"]]), null, null, {});
  assert.equal(r.earned, 1600);
});

test("fixed monthly: cut only for missed scheduled visits", () => {
  const all = att("f", [[3, "Present"], [5, "Present"], [10, "Present"], [12, "Present"], [17, "Present"], [19, "Present"], [24, "Present"], [26, "Present"]]);
  assert.equal(calc(fixed, "2026-11", all, null, null, {}).netPay, 4000, "no missed visit -> full amount");
  const miss = all.filter((x) => x.date !== "2026-11-12");
  miss.push({ staffId: "f", date: "2026-11-12", status: "Absent" });
  const r = calc(fixed, "2026-11", miss, null, null, {});
  assert.equal(r.workingDays, 8);
  assert.equal(r.earned, 3500, "1 of 8 visits missed -> 4000 x 7/8");
});

test("fixed monthly: paid holiday on a visit day counts, unpaid closed day is not counted", () => {
  const hol = { "2026-11-03": { paidForStaff: true, name: "x" }, "2026-11-05": { paidForStaff: false, name: "y" } };
  const a = att("f", [[10, "Present"], [12, "Present"], [17, "Present"], [19, "Present"], [24, "Present"], [26, "Present"]]);
  const r = calc(fixed, "2026-11", a, null, null, hol);
  assert.equal(r.workingDays, 7, "unpaid closed day removed from the month");
  assert.equal(r.holidayDays, 1);
  assert.equal(r.netPay, 4000);
});

test("a paid row stays frozen", () => {
  const saved = { id: "s", status: "Paid", payBasis: "per_visit", workingDays: 8, presentDays: 3, halfDays: 1, leaveDays: 0, absentDays: 0, holidayDays: 0, baseSalary: 800, bonus: 0, deduction: 0, netPay: 2800, paidDate: "2026-11-30", mode: "Cash", notes: "" };
  const r = calc(perVisit, "2026-11", [], saved, null, {});
  assert.equal(r.locked, true);
  assert.equal(r.netPay, 2800);
  assert.equal(r.paidDays, 3.5);
});

test("full-time staff are unchanged", () => {
  const ft = { id: "m", name: "Meena", payType: "monthly", visitDays: "", monthlySalary: 12000 };
  const r = calc(ft, "2026-11", att("m", [[2, "Present"]]), null, { workingDays: 10 }, {});
  assert.equal(r.earned, 1200);
});
