-- Add invoice file attachment columns to product_entries
-- Allows attaching the source invoice file directly to a purchase entry.
ALTER TABLE product_entries ADD COLUMN invoice_file_key  TEXT DEFAULT '';
ALTER TABLE product_entries ADD COLUMN invoice_file_name TEXT DEFAULT '';
