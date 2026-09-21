-- ============================================================
-- Ledger of teammate-invite emails (rate limit)
-- ============================================================
-- Settings → Team can email an invitation from foodnance.com to any address the
-- customer types. That makes the app something that sends mail to strangers on a
-- customer's behalf, so it is capped two ways (see INVITE_EMAILS_* in
-- src/index.ts): per organization per hour, and per recipient address per day
-- across every organization.
--
-- Rows are the ledger, so a row is never deleted by the app. It cannot live on
-- `invites`: revoking an invite hard-deletes it, so create → email → revoke
-- would reset the count. Same idea as `password_resets`.
--
-- An AUTH-style table, like `invites`: deliberately NOT in ALLOWED_TABLES and not
-- in TENANT_TABLES. No foreign keys, so a purged organization or a deleted
-- invite never blocks anything — the purge clears an org's rows explicitly.
CREATE TABLE IF NOT EXISTS invite_emails (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,
  to_email    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invite_emails_org ON invite_emails(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_invite_emails_to  ON invite_emails(to_email, created_at);
