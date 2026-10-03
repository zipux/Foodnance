-- ============================================================
-- Account start date + "accept invoices from" line
-- ============================================================
-- A new account may only upload invoices dated up to 7 days before its owner
-- first signed in. The line is fixed, not rolling: someone who starts on Oct 1
-- can upload an invoice dated Sep 24 on Oct 15, but never one dated Sep 20.
-- It keeps a newcomer's first month to their recent invoices instead of a
-- months-deep backlog. Undated invoices are always accepted.
--
-- started_at          when the owner first signed in (invite accepted, or first
--                     login on a legacy password account). Set once, never moved.
--                     The future "first month" of operator checking counts from it.
-- invoice_start_date  YYYY-MM-DD; invoices dated before it are refused by
--                     /api/ai/parse-invoice (after the read, so it still counts
--                     toward the monthly cap). NULL = no limit. Set to
--                     started_at - 7 days at first sign-in; the operator can
--                     change or clear it from the admin screen.
ALTER TABLE organizations ADD COLUMN started_at TEXT DEFAULT NULL;
ALTER TABLE organizations ADD COLUMN invoice_start_date TEXT DEFAULT NULL;

-- Existing accounts that someone already signs in to started when they were
-- created, and get no date limit: invoice_start_date stays NULL, so nothing
-- changes for them. Without this backfill their next sign-in would stamp today
-- and start refusing their older invoices. An account whose owner has NOT
-- accepted the invite yet (no users) is left NULL on purpose — it gets the
-- rule at that first sign-in, like any new account.
UPDATE organizations SET started_at = created_at
 WHERE started_at IS NULL
   AND EXISTS (SELECT 1 FROM users u WHERE u.org_id = organizations.id);
