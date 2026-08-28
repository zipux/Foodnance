-- Operator spot-check marker.
--
-- Self-serve is the default: a customer can approve an invoice the moment the
-- AI has read it, and operator review NEVER blocks them. This records only that
-- an invoice was LOOKED AT, so it stops reappearing in the admin queue. It is
-- not an approval, not a gate, and nothing downstream reads it.
--
-- Deliberately NOT approved_by/approved_at. Who approved an invoice is a
-- separate, larger question (today `status='Closed'` is the entire record) and
-- adding half of it here would imply an audit trail that does not exist.

ALTER TABLE invoices ADD COLUMN reviewed_by TEXT DEFAULT NULL;   -- operator email
ALTER TABLE invoices ADD COLUMN reviewed_at TEXT DEFAULT NULL;   -- datetime('now')

-- The admin screen runs one correlated subquery per organization over this
-- table. idx_invoices_org exists but the queue also filters on status, and the
-- rows it wants are the rare non-Closed minority.
CREATE INDEX IF NOT EXISTS idx_invoices_org_status ON invoices(org_id, status);
