-- ========================================================
-- Categorised stock-adjustment reasons
-- ========================================================
-- `stock_log.reason` has always been free text, which means waste is recorded
-- but not queryable — you cannot answer "what did spillage cost me in June".
-- `reason_code` is the machine-readable bucket the Adjust Stock modal now
-- writes; `reason` keeps holding the human label (and stays populated for old
-- rows and for stock-take movements), while `note` holds any free-text detail.
--
-- Codes written by the UI (see ADJUST_REASONS in public/static/inventory.js):
--   spillage | breakage | staff_meal | sample | theft | correction | transfer_out
--   received | production | stock_take | other
-- Legacy rows keep '' — treat that as 'other' when reporting.

ALTER TABLE stock_log ADD COLUMN reason_code TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_stock_log_reason_code ON stock_log(reason_code);
CREATE INDEX IF NOT EXISTS idx_stock_log_moved_at    ON stock_log(moved_at);
