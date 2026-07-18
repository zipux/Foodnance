-- ========================================================
-- Multi-level pack units (see memory: multi-level-pack-units-plan)
-- ========================================================
-- Lets a product be counted several ways that all reconcile to ONE on-hand
-- figure in a base weight unit. Example: a case of pepperoni = 25 lb = 5 bags
-- × 5 lb. The base is ALWAYS a weight (recipes cost by weight, so every product
-- bottoms out in lb/kg). Above the base sit up to two optional pack levels:
--   base (lb)  ← always
--   mid  (bag/can/bottle/each…)  ← optional
--   top  (case/box/flat…)        ← optional
--
-- The *presence of a level's weight* is the signal — no separate on/off switch:
--   mid_lb + top_lb set  → 3 ways to count
--   mid_lb only          → 2 ways
--   neither              → 1 way (behaves exactly like today: a single scalar in
--                          the inventory row's own unit)
--
-- Weights are nominal ("case ≈ 25 lb"); actual delivery weight can vary. Stored
-- as the absolute weight of ONE unit at that level, expressed in base_unit.
--
-- NOTE: the older sub_unit_name/sub_unit_qty (a discrete COUNT per pack, used by
-- recipe costing for per-each pricing) and avg_weight_per_unit are a *different*
-- axis and are deliberately kept — they are not absorbed here. Pack levels are a
-- counting/entry convenience layered on top of the single base-weight quantity;
-- recipes, P&L/True-COGS, inventory value and low-stock alerts all keep running
-- off that one base number unchanged.

ALTER TABLE generic_products ADD COLUMN base_unit TEXT DEFAULT '';   -- e.g. 'lb'; '' = pack levels unused
ALTER TABLE generic_products ADD COLUMN mid_name  TEXT DEFAULT '';   -- e.g. 'bag'
ALTER TABLE generic_products ADD COLUMN mid_lb    REAL DEFAULT NULL; -- weight of one mid unit, in base_unit
ALTER TABLE generic_products ADD COLUMN top_name  TEXT DEFAULT '';   -- e.g. 'case'
ALTER TABLE generic_products ADD COLUMN top_lb    REAL DEFAULT NULL; -- weight of one top unit, in base_unit
