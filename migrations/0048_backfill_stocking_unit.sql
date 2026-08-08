-- 0048 — declare a stocking unit on products that never got one
--
-- Products created by invoice import were inserted without base_unit, because
-- the INSERT in POST /api/bulk/upsert-products never listed the column. Blank is
-- not neutral: /api/price-movers prices every purchase through the product's
-- declared unit, and with none it falls back to whichever purchase sorts first
-- (`stock_unit || packUnit`). So the comparison unit was decided by row order,
-- and could change as new purchases arrived. That is how a wine bought as a 4 L
-- box and as 750 ml bottles came to be quoted per millilitre — the bottles were
-- written four seconds after the box.
--
-- src/index.ts now sets it at creation (stockUnitFor). This fills in the
-- products created before that: 26 of them on 2026-08-08 — 18 of 30 in Demo
-- Essential, 8 of 10 in Fratelli.
--
-- The value is the newest live entry's pack unit, which is EXACTLY what the
-- Products page already infers on the fly for a blank base_unit
-- (_inferStockUnit in products.js). So this persists a guess the UI was already
-- making rather than introducing a new one: nothing on screen changes, the guess
-- simply stops being re-made — and re-made differently — in three places.
--
-- No normalisation is applied because none is needed: pack_unit is written
-- through parsePackSize -> normalizeUnit, and every distinct value in live
-- production is already canonical (L, each, g, kg, lb, ml, oz). Copying verbatim
-- keeps this migration honest about that rather than re-deriving casing in SQL,
-- where SQLite's UPPER/LOWER would not know that 'L' is the one exception.
--
-- Scope: skips soft-deleted products, products that already declare a unit, and
-- products whose only entries are voided or unitless — a product with nothing to
-- infer from keeps its blank rather than being given an invented unit, because a
-- wrong declared unit is harder to notice than a missing one.
--
-- Rollback: every row this touches has base_unit = '' beforehand, so
--   UPDATE generic_products SET base_unit = '' WHERE id IN (...);
-- restores it exactly. The id list is captured in the before/after dump.

UPDATE generic_products
   SET base_unit = (
         SELECT e.pack_unit
           FROM product_entries e
          WHERE e.generic_product_id = generic_products.id
            AND e.org_id IS generic_products.org_id
            AND e.voided_at IS NULL
            AND TRIM(COALESCE(e.pack_unit, '')) <> ''
          ORDER BY e.purchase_date DESC, e.created_at DESC
          LIMIT 1
       )
 WHERE deleted_at IS NULL
   AND TRIM(COALESCE(base_unit, '')) = ''
   AND EXISTS (
         SELECT 1
           FROM product_entries e2
          WHERE e2.generic_product_id = generic_products.id
            AND e2.org_id IS generic_products.org_id
            AND e2.voided_at IS NULL
            AND TRIM(COALESCE(e2.pack_unit, '')) <> ''
       );
