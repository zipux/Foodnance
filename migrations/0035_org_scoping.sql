-- ============================================================
-- Accounts, Phase 2: tag every row with the business that owns it
-- ============================================================
-- Adds org_id to all 27 data tables. This is the column every read filters on
-- and every write stamps, so that one restaurant can never see another's
-- invoices, products, recipes or stock.
--
-- EXISTING ROWS DELIBERATELY STAY NULL. NULL means "belongs to the super-admin"
-- — i.e. Simone's current data. A new customer's org_id will never be NULL, so
-- they cannot see any of it. That is the migration strategy agreed in the
-- accounts plan: start fresh, don't hand existing data to the first customer.
--
-- Adding a column is non-destructive and reversible in effect: until the code
-- filters on it, nothing changes behaviourally.
--
-- NOTE on `units` and `categories`: these are per-org editable lists (decided
-- 2026-07-27), so they get org_id like everything else. New organisations need
-- their own seeded copy of the defaults at creation time — handled in the
-- org-creation endpoint, not here.
-- ============================================================


ALTER TABLE categories ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_categories_org ON categories(org_id);

ALTER TABLE certification_types ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_certification_types_org ON certification_types(org_id);

ALTER TABLE finished_product_items ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_finished_product_items_org ON finished_product_items(org_id);

ALTER TABLE finished_products ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_finished_products_org ON finished_products(org_id);

ALTER TABLE generic_products ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_generic_products_org ON generic_products(org_id);

ALTER TABLE inventory ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_inventory_org ON inventory(org_id);

ALTER TABLE invoice_lines ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_org ON invoice_lines(org_id);

ALTER TABLE invoices ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_invoices_org ON invoices(org_id);

ALTER TABLE item_placements ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_item_placements_org ON item_placements(org_id);

ALTER TABLE operating_expenses ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_operating_expenses_org ON operating_expenses(org_id);

ALTER TABLE product_aliases ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_product_aliases_org ON product_aliases(org_id);

ALTER TABLE product_entries ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_product_entries_org ON product_entries(org_id);

ALTER TABLE product_mappings ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_product_mappings_org ON product_mappings(org_id);

ALTER TABLE recipe_items ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_recipe_items_org ON recipe_items(org_id);

ALTER TABLE recipes ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_recipes_org ON recipes(org_id);

ALTER TABLE recurring_expenses ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_recurring_expenses_org ON recurring_expenses(org_id);

ALTER TABLE sales_monthly ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_sales_monthly_org ON sales_monthly(org_id);

ALTER TABLE spread_expenses ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_spread_expenses_org ON spread_expenses(org_id);

ALTER TABLE staff ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_staff_org ON staff(org_id);

ALTER TABLE staff_certifications ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_staff_certifications_org ON staff_certifications(org_id);

ALTER TABLE stock_log ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_stock_log_org ON stock_log(org_id);

ALTER TABLE stock_take_items ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_stock_take_items_org ON stock_take_items(org_id);

ALTER TABLE stock_takes ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_stock_takes_org ON stock_takes(org_id);

ALTER TABLE storage_sections ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_storage_sections_org ON storage_sections(org_id);

ALTER TABLE suppliers ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_suppliers_org ON suppliers(org_id);

ALTER TABLE units ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_units_org ON units(org_id);

ALTER TABLE vendor_fee_templates ADD COLUMN org_id TEXT DEFAULT NULL REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_vendor_fee_templates_org ON vendor_fee_templates(org_id);
