-- ================================================================
-- Stash the full parser output (line items, costs, vendor, warnings)
-- on the invoices row so the quick-save upload flow can defer the
-- Confirm & Save step (which writes products / suppliers / invoice_lines)
-- until the user reviews the invoice from the Invoices page.
-- ================================================================
ALTER TABLE invoices ADD COLUMN parsed_data TEXT DEFAULT '';
