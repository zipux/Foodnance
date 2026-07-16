-- Give each category a cost-group type: 'food' | 'beverage' | 'supplies'.
-- Drives the Inventory Food/Supplies buckets and future food-cost % reporting.
-- (Beverage is stored distinctly but folded into Food in the default 2-bucket
-- display; an account setting can later split it out — see the inventory plan.)
ALTER TABLE categories ADD COLUMN type TEXT NOT NULL DEFAULT 'food';

-- Beverage (drink COGS, tracked separately from food)
UPDATE categories SET type = 'beverage'
  WHERE name IN ('Alcohol', 'Non-Alcoholic Beverages');

-- Operating supplies (non-COGS: not part of food cost)
UPDATE categories SET type = 'supplies'
  WHERE name IN ('Packaging', 'Disposables', 'Cleaning & Sanitation',
                 'Linen & Uniforms', 'Smallwares & Equipment', 'Office & Admin');

-- Everything else (food COGS categories, 'Other', and any custom categories)
-- keeps the 'food' default.
