-- Smart Academy System — holiday calendar (festival / rain / public / other).
-- Holidays belong to one account (user_id) and apply to students, staff, or both.
-- For staff, each holiday can be paid or unpaid; that feeds the salary sheet.
CREATE TABLE IF NOT EXISTS holidays (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date           TEXT NOT NULL,                 -- YYYY-MM-DD
  name           TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT 'Festival',   -- Festival | Rain | Public | Other
  applies_to     TEXT NOT NULL DEFAULT 'both',       -- both | students | staff
  paid_for_staff INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_user_date ON holidays(user_id, date);

-- Paid holidays credited to a staff member in a saved salary row.
ALTER TABLE staff_payroll ADD COLUMN holiday_days REAL NOT NULL DEFAULT 0;
