-- Vendor fee templates: remember typical delivery/tax/surcharge structure per vendor
CREATE TABLE IF NOT EXISTS vendor_fee_templates (
  id           TEXT PRIMARY KEY,
  vendor_name  TEXT NOT NULL UNIQUE,   -- case-insensitive match key
  delivery     REAL DEFAULT 0,
  fuel_surcharge REAL DEFAULT 0,
  tax_gst      REAL DEFAULT 0,
  tax_pst      REAL DEFAULT 0,
  other_cost   REAL DEFAULT 0,
  other_desc   TEXT DEFAULT '',
  use_percent  INTEGER DEFAULT 0,      -- 0=fixed $, 1=% of subtotal
  notes        TEXT DEFAULT '',
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vendor_fee_templates_vendor ON vendor_fee_templates(vendor_name);
