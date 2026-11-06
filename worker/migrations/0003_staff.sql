-- Smart Academy System — staff attendance + salary sheet
-- Additive migration: no existing table is altered.
-- Every row carries user_id, and every query is scoped by it, so each
-- academy account only ever sees its own staff data.

CREATE TABLE IF NOT EXISTS staff (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  role           TEXT,                 -- e.g. "Maths teacher", "Office assistant"
  phone          TEXT,
  joining_date   TEXT,                 -- YYYY-MM-DD
  monthly_salary REAL NOT NULL DEFAULT 0,
  notes          TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_user ON staff(user_id);

CREATE TABLE IF NOT EXISTS staff_attendance (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  staff_id   TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,            -- YYYY-MM-DD
  status     TEXT NOT NULL,            -- "Present" | "Half Day" | "Absent" | "Leave"
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_att_unique ON staff_attendance(staff_id, date);
CREATE INDEX IF NOT EXISTS idx_staff_att_user_date ON staff_attendance(user_id, date);

CREATE TABLE IF NOT EXISTS staff_payroll (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  staff_id     TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  month        TEXT NOT NULL,          -- YYYY-MM
  working_days REAL NOT NULL DEFAULT 0,
  present_days REAL NOT NULL DEFAULT 0,
  half_days    REAL NOT NULL DEFAULT 0,
  leave_days   REAL NOT NULL DEFAULT 0,
  absent_days  REAL NOT NULL DEFAULT 0,
  base_salary  REAL NOT NULL DEFAULT 0,
  bonus        REAL NOT NULL DEFAULT 0,
  deduction    REAL NOT NULL DEFAULT 0,
  net_pay      REAL NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'Pending',   -- "Pending" | "Paid"
  paid_date    TEXT,
  mode         TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_payroll_unique ON staff_payroll(staff_id, month);
CREATE INDEX IF NOT EXISTS idx_staff_payroll_user ON staff_payroll(user_id, month);
