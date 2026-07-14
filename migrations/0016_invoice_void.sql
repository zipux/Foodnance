-- Invoice void (soft-delete for posted invoices).
-- voided_at set  => invoice is voided: excluded from P&L/spending and the
-- active list, but kept and restorable. void_reason records why.
ALTER TABLE invoices ADD COLUMN voided_at DATETIME DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN void_reason TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_invoices_voided_at ON invoices(voided_at);
