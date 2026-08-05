-- Labour cost by pay period (for prime cost = food + drinks + labour).
--
-- Payroll almost never lines up with calendar months — 20 Aug to 5 Sep is an
-- ordinary fortnight — so the amount is stored against the dates it actually
-- covers and prorated by days into each month it touches. That is exactly what
-- spread_expenses (0024) does, and this table is read by the same
-- spreadAllocation() helper in pnl.js, which is why the money column is called
-- total_amount rather than amount.
--
-- Deliberately NOT recurring_expenses (rent's table). Those rows carry no
-- period and apply the same figure to every month including past ones, which is
-- right for rent and wrong for labour: labour is the most variable cost a
-- restaurant has, moving with covers, season and overtime. A labour figure that
-- cannot move would make prime cost — a ratio whose whole value is watching it
-- change month to month — impossible to read.
--
-- Deliberately not spread_expenses either, even though the shape matches: prime
-- cost has to find labour reliably, and string-matching an expense named
-- "Payroll" is how that goes wrong the first time someone types "Wages".

CREATE TABLE IF NOT EXISTS labor_periods (
  id           TEXT PRIMARY KEY,
  org_id       TEXT DEFAULT NULL REFERENCES organizations(id),
  name         TEXT DEFAULT '',            -- optional label, e.g. 'Fortnight 2'
  total_amount REAL DEFAULT 0,             -- total labour cost for the whole range
  start_date   TEXT NOT NULL,              -- 'YYYY-MM-DD' (inclusive)
  end_date     TEXT NOT NULL,              -- 'YYYY-MM-DD' (inclusive)
  notes        TEXT DEFAULT '',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_labor_periods_org   ON labor_periods(org_id);
CREATE INDEX IF NOT EXISTS idx_labor_periods_dates ON labor_periods(start_date, end_date);
