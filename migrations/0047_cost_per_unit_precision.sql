-- 0047 — undo cent-rounding on product_entries.cost_per_unit
--
-- The AI import path stored cost_per_unit as Math.round((cost/totalUnits)*100)/100.
-- That is harmless at $/kg or $/lb and ruinous at $/ml or $/g, where a real price
-- is a fraction of a cent. Measured on live data 2026-08-08: Heineken 0.0 was
-- stored at $0.01/ml against a true $0.005551 (+80%), sparkling water at $0.01
-- against $0.014933 (-33%). Anything under half a cent per unit collapsed to
-- 0.00 — a free ingredient. src/index.ts now stores the unrounded rate
-- (unitCostFrom); this repairs the rows written before that.
--
-- SCOPE — this repairs rounding damage ONLY. It is deliberately NOT a blanket
-- "recompute every cost_per_unit", because cost_per_unit is legitimately set by
-- other writers: the pack-unit-change cascade in products.js stores 6dp values,
-- and hand-entered rows carry figures that were never cost/(pack_qty*qty).
-- A blanket recompute would silently overwrite all of those. So a row is only
-- touched when it carries the SIGNATURE of cent-rounding:
--
--   1. the stored value has at most 2 decimal places, AND
--   2. it differs from cost/(pack_qty*qty_ordered) by at most half a cent.
--
-- Half a cent is the most rounding to cents could ever have moved a value, so
-- condition 2 is an upper bound by construction, not a tuned threshold. Every
-- row this touches moves TOWARD the invoice figure; none can move away.
--
-- The signature is matched directly rather than by recomputing ROUND(x,2) in
-- SQL, because SQLite's ROUND and JavaScript's Math.round disagree on the .5
-- boundary: Red Onions at $0.985/kg was stored 0.99 by JS, while
-- SQLite ROUND(0.985,2) gives 0.98 — which would have skipped a genuinely
-- damaged row.
--
-- Verified against live production before running: 32 rows match, 15 do not and
-- are left untouched (10 fabricated Salami rows, plus Anchovy Fillets,
-- Artichoke Hearts, Tomato Passata and Tuna, whose 4dp values came from the
-- cascade). No voided rows are affected.
--
-- Rollback: scratchpad/rollback_0047.sql restores each row's prior value by id.

UPDATE product_entries
   SET cost_per_unit = cost / (pack_qty * qty_ordered)
 WHERE pack_qty * qty_ordered > 0
   AND cost > 0
   -- (1) stored value is a 2-decimal number, i.e. it looks like rounding output
   AND ABS(cost_per_unit - ROUND(cost_per_unit, 2)) < 0.000000001
   -- (2) and it actually differs from the true rate, by at most half a cent
   AND ABS(cost_per_unit - cost / (pack_qty * qty_ordered)) > 0.000000001
   AND ABS(cost_per_unit - cost / (pack_qty * qty_ordered)) <= 0.005000001;
