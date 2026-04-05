-- ================================================================
-- Invoice line items + extra cost fields on invoices
-- ================================================================

-- Extra cost fields on invoices table
ALTER TABLE invoices ADD COLUMN tax_pst       REAL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN tax_gst       REAL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN delivery      REAL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN credit        REAL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN other_cost    REAL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN other_desc    TEXT DEFAULT '';

-- Invoice line items (one row per product on the invoice)
CREATE TABLE IF NOT EXISTS invoice_lines (
  id           TEXT PRIMARY KEY,
  invoice_id   TEXT NOT NULL,
  product_name TEXT DEFAULT '',
  vendor_item  TEXT DEFAULT '',
  category     TEXT DEFAULT '',
  item_code    TEXT DEFAULT '',
  packaging    TEXT DEFAULT '',
  price        REAL DEFAULT 0,
  qty          REAL DEFAULT 0,
  line_total   REAL DEFAULT 0,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice_id ON invoice_lines(invoice_id);
