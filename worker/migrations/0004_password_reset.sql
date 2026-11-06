-- Smart Academy System — password reset by email.
-- Only a SHA-256 hash of each reset token is stored, never the token itself, so a
-- database leak cannot be used to reset anyone's password.
CREATE TABLE IF NOT EXISTS password_resets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id, created_at);
