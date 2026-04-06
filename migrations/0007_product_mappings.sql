CREATE TABLE IF NOT EXISTS product_mappings (
  id TEXT PRIMARY KEY,
  vendor_name TEXT NOT NULL,
  raw_ocr_text TEXT NOT NULL,
  corrected_name TEXT NOT NULL,
  corrected_brand TEXT DEFAULT '',
  corrected_sku TEXT DEFAULT '',
  corrected_pack_size TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pm_vendor_raw ON product_mappings(vendor_name, raw_ocr_text);
