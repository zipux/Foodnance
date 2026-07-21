-- ========================================================
-- Declared stocking unit per product
-- (see memory: mixed-unit-costing-bug, substitutable-products-plan)
-- ========================================================
-- Problem this addresses: the same product can be invoiced in different units
-- by different suppliers (Yen bills potatoes in KG, Neptune in LB). Nothing in
-- the app declared "a potato is counted and priced in kg", so three paths
-- compared or summed raw numbers across units:
--   • GET /api/price-movers      — compared $/kg against $/lb as a price move
--   • fifoEntryQty()             — summed kg + lb to pick the active FIFO layer
--   • upsertInventory()          — added lb straight into a kg bin
--
-- DESIGN: no new column. `base_unit` (added by 0026 for pack levels) is widened
-- from "the weight unit pack levels reduce to" into "the unit this product is
-- stocked and priced in" — the single source of truth every path converts into.
-- Pack levels are gated on mid_lb/top_lb being present (see pkConfigFrom() in
-- public/static/utils.js), NOT on base_unit, so populating base_unit for every
-- product does NOT switch pack-level entry on for anything. This deliberately
-- avoids creating a 4th place a unit can diverge (see memory:
-- unit-of-measure-cascade).
--
-- BACKFILL: derive from the product's own live data, preferring the inventory
-- bin's unit (what stock is actually counted in), falling back to its most
-- common purchase unit. Verified against prod 2026-07-21: bin unit and most
-- common purchase unit agreed for all 15 live products, so this is unambiguous.
-- Products with neither (never purchased, never stocked) are left '' and get
-- picked up in the product form.
--
-- Rows already carrying a base_unit (set via the pack-levels form) are NOT
-- touched — an explicit user choice outranks anything inferred here.

UPDATE generic_products
SET base_unit = COALESCE(
  (SELECT LOWER(TRIM(i.unit))
     FROM inventory i
    WHERE i.item_id = generic_products.id
      AND i.item_type = 'raw_material'
      AND TRIM(COALESCE(i.unit, '')) != ''
    LIMIT 1),
  (SELECT LOWER(TRIM(pe.pack_unit))
     FROM product_entries pe
    WHERE pe.generic_product_id = generic_products.id
      AND pe.voided_at IS NULL
      AND TRIM(COALESCE(pe.pack_unit, '')) != ''
    GROUP BY LOWER(TRIM(pe.pack_unit))
    ORDER BY COUNT(*) DESC
    LIMIT 1),
  ''
)
WHERE TRIM(COALESCE(base_unit, '')) = '';
