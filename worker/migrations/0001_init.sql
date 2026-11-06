-- Tuition Manager — Cloudflare D1 schema
-- One row per user in every table; every query is scoped by user_id.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Server-side sessions. We use opaque random tokens (not JWTs) so a
-- logout / password change can immediately revoke access everywhere.
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- One settings row per user (mirrors the old single "config" record).
CREATE TABLE IF NOT EXISTS settings (
  user_id             TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tuition_center_name TEXT,
  staff_name          TEXT,
  contact_number      TEXT,
  address             TEXT,
  setup_complete      INTEGER NOT NULL DEFAULT 0,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  student_id    TEXT,
  parent_name   TEXT,
  parent_phone  TEXT,
  student_phone TEXT,
  joining_date  TEXT,
  monthly_fee   REAL NOT NULL DEFAULT 0,
  notes         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_students_user ON students(user_id);

CREATE TABLE IF NOT EXISTS attendance (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,       -- YYYY-MM-DD
  status     TEXT NOT NULL,       -- "Present" | "Absent"
  marked_at  TEXT,                -- ISO 8601 UTC — set when status becomes "Present"; NULL for Absent / legacy rows
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- One record per student per date (prevents duplicates, same as the old IndexedDB compound index).
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance(student_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id, date);

CREATE TABLE IF NOT EXISTS payments (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount     REAL NOT NULL,
  date       TEXT NOT NULL,
  for_month  TEXT,
  mode       TEXT,
  reference  TEXT,
  notes      TEXT,
  is_demo    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
