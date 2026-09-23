-- ============================================================
-- Marketing "Request access" leads
-- ============================================================
-- The landing/pricing/calculator pages' "Request access" button used to be a
-- bare mailto: link — invisible if the visitor's device had no mail client
-- configured, and unrecorded either way. POST /api/interest now saves the
-- submission here and emails a notification (best-effort, via sendEmail).
--
-- This is a pre-signup artifact, not customer data: there is no organization
-- yet, so no org_id and no place in TENANT_TABLES (org-scoping.test.mjs) or
-- ALLOWED_TABLES (the generic /api/tables CRUD layer). Rows are never deleted
-- by the app — it is the spam-rate-limit ledger for the endpoint (same reason
-- invite_emails rows are never deleted) as well as the lead record itself.
CREATE TABLE IF NOT EXISTS access_requests (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  email              TEXT NOT NULL,
  business_name      TEXT NOT NULL,
  business_type      TEXT,              -- restaurant / bakery / commissary / other, free text
  invoices_per_week  TEXT,
  source_page        TEXT,              -- which marketing page the request came from
  notify_error       TEXT,              -- set if the notification email to us failed; the row itself never fails
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_access_requests_email ON access_requests(email, created_at);
CREATE INDEX IF NOT EXISTS idx_access_requests_created ON access_requests(created_at);
