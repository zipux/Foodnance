-- Link each product_entry to its source invoice record
ALTER TABLE product_entries ADD COLUMN invoice_id TEXT DEFAULT '';
