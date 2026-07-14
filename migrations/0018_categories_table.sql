-- Product categories master list (mirrors the `units` table pattern).
-- Category is still stored as free-text on generic_products.category; this
-- table is the managed source of truth for the picker + "Manage categories" UI.
CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Built-in taxonomy — keep in sync with DEFAULT_CATEGORIES in
-- public/static/utils.js and the inferCategory rules in src/index.ts.
INSERT OR IGNORE INTO categories (name, sort_order) VALUES
  -- Food (COGS)
  ('Produce',                    1),
  ('Meat & Poultry',             2),
  ('Seafood',                    3),
  ('Dairy & Eggs',               4),
  ('Dry Goods & Pantry',         5),
  ('Bakery',                     6),
  ('Frozen',                     7),
  ('Oils, Sauces & Condiments',  8),
  ('Spices & Seasonings',        9),
  -- Beverage
  ('Alcohol',                    10),
  ('Non-Alcoholic Beverages',    11),
  -- Operating supplies
  ('Packaging',                  12),
  ('Disposables',                13),
  ('Cleaning & Sanitation',      14),
  ('Linen & Uniforms',           15),
  ('Smallwares & Equipment',     16),
  ('Office & Admin',             17),
  -- Fallback
  ('Other',                      18);

-- Preserve any custom/legacy categories already saved on products (e.g.
-- 'Ingredients') so they still appear in the manage list and picker.
INSERT OR IGNORE INTO categories (name, sort_order)
  SELECT DISTINCT TRIM(category), 100
  FROM generic_products
  WHERE category IS NOT NULL AND TRIM(category) <> '';
