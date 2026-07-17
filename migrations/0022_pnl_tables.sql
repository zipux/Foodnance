-- P&L manual inputs. The cost side of the P&L is derived from invoices; these
-- two tables hold the numbers the app can't know on its own: revenue and
-- overheads (rent/wages/utilities). One period = a calendar month, 'YYYY-MM'.

-- Monthly sales / revenue (money in). One row per month.
CREATE TABLE IF NOT EXISTS sales_monthly (
  id           TEXT PRIMARY KEY,
  period       TEXT NOT NULL,              -- 'YYYY-MM'
  sales_total  REAL DEFAULT 0,             -- total revenue for the month
  food_sales   REAL DEFAULT NULL,          -- optional split (future use)
  beverage_sales REAL DEFAULT NULL,        -- optional split (future use)
  notes        TEXT DEFAULT '',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(period)
);

-- Manual operating expenses / overheads (rent, wages, utilities, …).
-- Many rows per month.
CREATE TABLE IF NOT EXISTS operating_expenses (
  id         TEXT PRIMARY KEY,
  period     TEXT NOT NULL,                -- 'YYYY-MM'
  name       TEXT NOT NULL,                -- e.g. 'Rent', 'Wages', 'Utilities'
  amount     REAL DEFAULT 0,
  notes      TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_operating_expenses_period ON operating_expenses(period);
