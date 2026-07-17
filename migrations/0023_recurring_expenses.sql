-- Fixed monthly costs (recurring overheads): rent, wages, insurance, etc.
-- Defined once and counted on EVERY month's P&L automatically — no period column.
-- One-off per-month costs still live in operating_expenses.
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,                -- e.g. 'Rent', 'Wages', 'Insurance'
  amount     REAL DEFAULT 0,
  active     INTEGER DEFAULT 1,            -- 1 = counted, 0 = paused (future use)
  notes      TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
