-- ============================================================
-- Self-serve password reset
-- ============================================================
-- A customer who forgot their password asks for an emailed link (or gets one
-- automatically after five wrong passwords in a row). Like `users` and
-- `invites`, this is an AUTH table: deliberately NOT in ALLOWED_TABLES, and
-- deliberately without org_id — a reset belongs to a person, not a business.
--
-- Only the SHA-256 of the token is stored. The raw token exists in the email
-- and nowhere else, so a leaked database backup does not hand out working
-- reset links (unlike `invites.token`, which stores the raw value).
--
-- Rows are also the rate-limit ledger: "how many links did this user get in
-- the last hour" is a count over created_at, so a row is never deleted. A
-- link that was used or superseded gets used_at set instead.
CREATE TABLE IF NOT EXISTS password_resets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  token_hash  TEXT NOT NULL,
  -- 'requested' (they clicked Forgot password) | 'lockout' (5 wrong passwords)
  reason      TEXT NOT NULL DEFAULT 'requested',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  used_at     TEXT DEFAULT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id, created_at);

-- Consecutive wrong passwords since the last successful login or reset. Lives
-- on the user row so it is atomic to bump (UPDATE ... RETURNING) and needs no
-- cleanup job.
ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
