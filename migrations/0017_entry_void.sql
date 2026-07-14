-- Phase 2 of invoice void: soft-flag the purchase entries a voided invoice
-- created, so they stop counting toward Latest Price / price-movers / costing.
-- Set when the parent invoice is voided, cleared on restore (matched by invoice_id).
ALTER TABLE product_entries ADD COLUMN voided_at DATETIME DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_product_entries_voided_at ON product_entries(voided_at);
