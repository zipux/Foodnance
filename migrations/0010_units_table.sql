CREATE TABLE IF NOT EXISTS units (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO units (name, sort_order) VALUES
  ('kg',   1),
  ('g',    2),
  ('lb',   3),
  ('ml',   4),
  ('L',    5),
  ('each', 6),
  ('case', 7);
