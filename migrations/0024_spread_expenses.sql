-- Spread costs: a single bill that covers a date range crossing months
-- (e.g. a waste-disposal service 13 Jun–18 Sep). The total is allocated to each
-- month by the number of days of the range that fall in that month, so no single
-- month is unfairly charged the whole amount. Proration is computed at read time.
CREATE TABLE IF NOT EXISTS spread_expenses (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,               -- e.g. 'Waste disposal'
  total_amount REAL DEFAULT 0,              -- total for the whole date range
  start_date   TEXT NOT NULL,               -- 'YYYY-MM-DD' (inclusive)
  end_date     TEXT NOT NULL,               -- 'YYYY-MM-DD' (inclusive)
  notes        TEXT DEFAULT '',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
