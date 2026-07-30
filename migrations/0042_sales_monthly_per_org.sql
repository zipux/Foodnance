-- Make monthly-revenue rows unique PER ORGANIZATION instead of globally.
--
-- `sales_monthly` was created in 0022 with UNIQUE(period), before the table was
-- org-scoped (0035 added org_id). That constraint is global: once one restaurant
-- records '2026-07', no other restaurant can ever record it. The second customer
-- to open the P&L and type a revenue figure hits a constraint error caused by
-- data they cannot see — and the failure looks like the P&L is broken, not like
-- a collision.
--
-- Same bug, same shape, same fix as 0038 (categories) and 0040 (units). SQLite
-- cannot drop a constraint in place, so the table is rebuilt. Nothing references
-- sales_monthly by foreign key — pnl.js reads it by period — so the drop/rename
-- is safe.
--
-- Uniqueness is restored as an expression index over COALESCE(org_id, '') rather
-- than a plain UNIQUE(org_id, period): SQLite treats NULLs as distinct in a
-- UNIQUE constraint, which would let the NULL-org demo account collect duplicate
-- months — the one account most likely to be used for a screenshot.
--
-- No duplicate check is needed before the unique index: the old global
-- constraint guarantees at most one row per period across every organization.
--
-- REVENUE_SOURCE is added here rather than with the POS import tables because it
-- belongs to this table's meaning. It answers "when a month has both an imported
-- figure and a typed one, which is the truth?":
--   'auto'   -> imported POS revenue if any exists, else the typed figure
--   'manual' -> always the typed figure (the user explicitly overrode)
-- Existing rows default to 'auto', which with no imports behaves exactly as
-- today, so this column is a no-op until the first CSV lands.

CREATE TABLE sales_monthly_new (
  id             TEXT PRIMARY KEY,
  period         TEXT NOT NULL,              -- 'YYYY-MM'
  sales_total    REAL DEFAULT 0,             -- total revenue for the month
  food_sales     REAL DEFAULT NULL,          -- optional split (future use)
  beverage_sales REAL DEFAULT NULL,          -- optional split (future use)
  notes          TEXT DEFAULT '',
  revenue_source TEXT NOT NULL DEFAULT 'auto',
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  org_id         TEXT DEFAULT NULL REFERENCES organizations(id)
);

INSERT INTO sales_monthly_new
  (id, period, sales_total, food_sales, beverage_sales, notes, created_at, org_id)
SELECT id, period, sales_total, food_sales, beverage_sales, notes, created_at, org_id
FROM sales_monthly;

DROP TABLE sales_monthly;

ALTER TABLE sales_monthly_new RENAME TO sales_monthly;

-- Recreate the org lookup index dropped along with the old table (added by 0035).
CREATE INDEX idx_sales_monthly_org ON sales_monthly(org_id);

-- Per-org period uniqueness, NULL-safe (see note above).
CREATE UNIQUE INDEX idx_sales_monthly_org_period
  ON sales_monthly(COALESCE(org_id, ''), period);
