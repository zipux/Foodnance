-- Per-product low-stock alert threshold.
-- reorder_level: alert when a product's live inventory quantity falls to or below
--   this number. NULL = no alert configured for this product (opt-in per item).
-- reorder_unit: the unit the threshold is expressed in (e.g. 'lb'), stored so the
--   number is unambiguous even if the inventory row's unit differs. Display-only.
ALTER TABLE generic_products ADD COLUMN reorder_level REAL DEFAULT NULL;
ALTER TABLE generic_products ADD COLUMN reorder_unit TEXT DEFAULT '';
