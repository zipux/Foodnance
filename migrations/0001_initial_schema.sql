-- ========================================================
-- InvoiceDB Full Schema
-- ========================================================

-- Suppliers / Vendors
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT DEFAULT '',
  email TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Generic Products (two-level model)
CREATE TABLE IF NOT EXISTS generic_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Ingredients',
  sub_unit_name TEXT DEFAULT '',
  sub_unit_qty REAL DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Product Entries (supplier-specific entries per generic product)
CREATE TABLE IF NOT EXISTS product_entries (
  id TEXT PRIMARY KEY,
  generic_product_id TEXT NOT NULL,
  generic_product_name TEXT NOT NULL,
  supplier_id TEXT DEFAULT '',
  supplier_name TEXT DEFAULT '',
  vendor_item_name TEXT DEFAULT '',
  sku TEXT DEFAULT '',
  pack_qty REAL DEFAULT 1,
  pack_unit TEXT DEFAULT 'Each',
  cost REAL DEFAULT 0,
  cost_per_unit REAL DEFAULT 0,
  purchase_date TEXT DEFAULT '',
  expiry_date TEXT DEFAULT '',
  days_left INTEGER DEFAULT NULL,
  invoice_ref TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (generic_product_id) REFERENCES generic_products(id) ON DELETE CASCADE
);

-- Recipes
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  servings REAL DEFAULT 1,
  yield_unit TEXT DEFAULT '',
  total_cost REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Recipe Items
CREATE TABLE IF NOT EXISTS recipe_items (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity REAL DEFAULT 1,
  unit TEXT DEFAULT '',
  line_cost REAL DEFAULT 0,
  FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
);

-- Finished Products
CREATE TABLE IF NOT EXISTS finished_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  selling_price REAL DEFAULT 0,
  total_cost REAL DEFAULT 0,
  profit REAL DEFAULT 0,
  margin_pct REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Finished Product Items
CREATE TABLE IF NOT EXISTS finished_product_items (
  id TEXT PRIMARY KEY,
  finished_product_id TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'product',
  ref_id TEXT NOT NULL,
  ref_name TEXT NOT NULL,
  quantity REAL DEFAULT 1,
  unit TEXT DEFAULT '',
  line_cost REAL DEFAULT 0,
  FOREIGN KEY (finished_product_id) REFERENCES finished_products(id) ON DELETE CASCADE
);

-- Inventory
CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'raw_material',
  item_name TEXT NOT NULL,
  category TEXT DEFAULT '',
  quantity REAL DEFAULT 0,
  unit TEXT DEFAULT '',
  lot_number TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Stock Movement Log
CREATE TABLE IF NOT EXISTS stock_log (
  id TEXT PRIMARY KEY,
  inventory_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  item_name TEXT NOT NULL,
  change REAL NOT NULL,
  reason TEXT DEFAULT '',
  note TEXT DEFAULT '',
  lot_number TEXT DEFAULT '',
  moved_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Invoices (with cloud file storage key)
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  vendor TEXT DEFAULT '',
  invoice_number TEXT DEFAULT '',
  invoice_date TEXT DEFAULT '',
  upload_date TEXT DEFAULT '',
  total REAL DEFAULT 0,
  status TEXT DEFAULT 'In Processing',
  payment_account TEXT DEFAULT 'A/P',
  file_name TEXT DEFAULT '',
  file_key TEXT DEFAULT '',
  file_url TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ========================================================
-- Staff Certifications (NEW FEATURE)
-- ========================================================

-- Staff Members
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  role TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  department TEXT DEFAULT '',
  hire_date TEXT DEFAULT '',
  status TEXT DEFAULT 'Active',
  notes TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Certification Types
CREATE TABLE IF NOT EXISTS certification_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  validity_months INTEGER DEFAULT 12,
  is_mandatory INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Staff Certifications
CREATE TABLE IF NOT EXISTS staff_certifications (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  cert_type_id TEXT NOT NULL,
  cert_type_name TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  issuer TEXT DEFAULT '',
  cert_number TEXT DEFAULT '',
  file_key TEXT DEFAULT '',
  file_name TEXT DEFAULT '',
  file_url TEXT DEFAULT '',
  status TEXT DEFAULT 'Valid',
  notes TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  FOREIGN KEY (cert_type_id) REFERENCES certification_types(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_product_entries_generic_id ON product_entries(generic_product_id);
CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe_id ON recipe_items(recipe_id);
CREATE INDEX IF NOT EXISTS idx_finished_product_items_fp_id ON finished_product_items(finished_product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_item_type ON inventory(item_type);
CREATE INDEX IF NOT EXISTS idx_stock_log_inventory_id ON stock_log(inventory_id);
CREATE INDEX IF NOT EXISTS idx_invoices_vendor ON invoices(vendor);
CREATE INDEX IF NOT EXISTS idx_staff_certs_staff_id ON staff_certifications(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_certs_expiry ON staff_certifications(expiry_date);
