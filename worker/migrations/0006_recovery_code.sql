-- Smart Academy System — account recovery code (works with NO email service).
-- Each account gets a one-time recovery code at registration. Only a SHA-256
-- hash of it is stored (never the code itself), so a database leak cannot be
-- used to take over an account. ADDITIVE ONLY: existing users keep working;
-- they simply have no code until they generate one in Settings.
ALTER TABLE users ADD COLUMN recovery_code_hash TEXT;
ALTER TABLE users ADD COLUMN recovery_code_created_at TEXT;

-- Throttle for wrong recovery-code guesses (keyed by IP + email, pre-login).
CREATE TABLE IF NOT EXISTS recovery_attempts (
  key              TEXT PRIMARY KEY,
  attempts         INTEGER NOT NULL DEFAULT 0,
  first_attempt_at TEXT NOT NULL,
  locked_until     TEXT
);
