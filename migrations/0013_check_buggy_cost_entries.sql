-- Migration check: identify product_entries likely affected by the cost/unit_price bug.
--
-- Bug: cost was stored as unit_price (e.g. $3.55/lb) instead of the invoice line total
-- (e.g. $53.28). Signature: cost ≈ cost_per_unit AND pack_qty > 1 for a weight/volume unit.
-- A correct entry has cost >> cost_per_unit (line total is much larger than per-unit price).
--
-- Run this as a READ-ONLY check via the D1 console or wrangler d1 execute.
-- Review results and manually correct cost values using the UPDATE statement below.

-- ── 1. List suspicious entries ────────────────────────────────────────────────
SELECT
  pe.id,
  pe.generic_product_name,
  pe.supplier_name,
  pe.purchase_date,
  pe.pack_qty,
  pe.pack_unit,
  pe.cost                                      AS stored_cost,
  pe.cost_per_unit,
  ROUND(pe.cost_per_unit * pe.pack_qty, 2)     AS likely_cost_per_pack,
  pe.invoice_ref
FROM product_entries pe
WHERE pe.cost > 0
  AND pe.pack_qty > 1
  AND LOWER(pe.pack_unit) IN ('lb','lbs','kg','g','l','ml','oz','fl oz','gal')
  AND ROUND(pe.cost, 2) = ROUND(pe.cost_per_unit, 2)  -- cost stuck at unit price
ORDER BY pe.purchase_date DESC;

-- ── 2. Broader check: cost suspiciously small relative to pack_qty ────────────
-- Catches cases where unit is non-standard but cost still looks like unit_price.
-- "likely_cost_per_pack" is what the line total would be for a single pack at
-- the stored cost_per_unit — if stored_cost equals that, something is off.
SELECT
  pe.id,
  pe.generic_product_name,
  pe.supplier_name,
  pe.purchase_date,
  pe.pack_qty,
  pe.pack_unit,
  pe.cost                                    AS stored_cost,
  pe.cost_per_unit,
  ROUND(pe.cost_per_unit * pe.pack_qty, 2)  AS likely_single_pack_cost,
  pe.invoice_ref
FROM product_entries pe
WHERE pe.cost > 0
  AND pe.pack_qty > 1
  AND ABS(pe.cost - pe.cost_per_unit) / pe.cost < 0.02  -- within 2% = effectively the same
ORDER BY pe.purchase_date DESC;

-- ── 3. Corrective UPDATE template ─────────────────────────────────────────────
-- For each confirmed-buggy row, set cost to the real line total from the invoice.
-- Replace <REAL_LINE_TOTAL> and <ROW_ID> with actual values.
-- Also recalculate cost_per_unit = line_total / (pack_qty × qty_ordered).
-- If you don't have qty_ordered handy, use invoice_lines.qty for that invoice.
--
-- UPDATE product_entries
-- SET cost          = <REAL_LINE_TOTAL>,
--     cost_per_unit = ROUND(<REAL_LINE_TOTAL> / (pack_qty * <QTY_ORDERED>), 2)
-- WHERE id = '<ROW_ID>';
