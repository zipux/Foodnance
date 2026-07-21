-- 0027_normalize_unit_casing.sql
-- Normalize miscased units of measure to canonical casing (COSMETIC ONLY).
-- All unit conversion logic (frontend + backend) is case-insensitive, so this
-- changes only how units display — it does NOT affect any cost or quantity math.
-- Canonical casing: lowercase, except litre which keeps the SI symbol 'L'.
-- The only miscased values present are 'KG' and 'LB' (from an invoice import);
-- 'L' is already correct and is intentionally left untouched.

UPDATE product_entries  SET pack_unit = 'kg' WHERE pack_unit = 'KG';
UPDATE product_entries  SET pack_unit = 'lb' WHERE pack_unit = 'LB';

UPDATE inventory        SET unit = 'kg' WHERE unit = 'KG';
UPDATE inventory        SET unit = 'lb' WHERE unit = 'LB';

UPDATE stock_take_items SET unit = 'kg' WHERE unit = 'KG';
UPDATE stock_take_items SET unit = 'lb' WHERE unit = 'LB';

UPDATE recipe_items     SET unit = 'kg' WHERE unit = 'KG';
UPDATE recipe_items     SET unit = 'lb' WHERE unit = 'LB';

UPDATE finished_product_items SET unit = 'kg' WHERE unit = 'KG';
UPDATE finished_product_items SET unit = 'lb' WHERE unit = 'LB';
