-- Add deposit column to invoices and vendor_fee_templates tables
ALTER TABLE invoices ADD COLUMN deposit REAL DEFAULT 0;
ALTER TABLE vendor_fee_templates ADD COLUMN deposit REAL DEFAULT 0;
