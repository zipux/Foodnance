-- ================================================================
-- Product merge support:
--   1. Soft-delete column on generic_products
--   2. product_aliases table — remembers old names after a merge
--      so future invoices with the old name auto-link to the
--      surviving product.
-- ================================================================
ALTER TABLE generic_products ADD COLUMN deleted_at DATETIME DEFAULT NULL;

CREATE TABLE IF NOT EXISTS product_aliases (
  id                 TEXT PRIMARY KEY,
  alias_name         TEXT NOT NULL,
  generic_product_id TEXT NOT NULL,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (generic_product_id) REFERENCES generic_products(id)
);

CREATE INDEX IF NOT EXISTS idx_product_aliases_alias ON product_aliases(alias_name);
