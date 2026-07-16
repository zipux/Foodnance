-- Backfill: re-sync raw-material inventory rows with their product's current
-- name + category. Historically only the NAME cascaded on rename and category
-- never cascaded at all, so inventory rows drifted from generic_products
-- (stale category badges + mismatched category chips on the Inventory page).
-- Going forward this is kept in sync by PUT /api/generic_products/:id.
UPDATE inventory
SET
  category  = (SELECT g.category FROM generic_products g WHERE g.id = inventory.item_id),
  item_name = (SELECT g.name     FROM generic_products g WHERE g.id = inventory.item_id)
WHERE item_type = 'raw_material'
  AND EXISTS (SELECT 1 FROM generic_products g WHERE g.id = inventory.item_id);
