-- Expense invoices: bills that are operating costs (utilities, rent, insurance)
-- rather than goods for resale. Unlike goods invoices they create NO line items,
-- products, or inventory — their total flows straight into the P&L's running
-- costs under expense_category, for the invoice_date's month.
ALTER TABLE invoices ADD COLUMN invoice_kind TEXT DEFAULT 'goods';   -- 'goods' | 'expense'
ALTER TABLE invoices ADD COLUMN expense_category TEXT DEFAULT '';     -- e.g. 'Utilities' (expense invoices only)
