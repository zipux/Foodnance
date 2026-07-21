-- ========================================================
-- Coded reasons on stock-take variances
-- ========================================================
-- Migration 0029 gave `stock_log` a machine-readable `reason_code` so waste
-- became queryable, but only the Adjust Stock modal wrote it. Stock takes were
-- still writing free text from a hardcoded two-option list ("Kitchen usage" /
-- "Other"), so variance reasons — the single biggest source of unexplained
-- stock movement — never showed up in any report built on that column.
--
-- This adds the same column to the stock-take snapshot rows. Both screens now
-- share ONE taxonomy (STOCK_REASONS in public/static/utils.js): the client
-- sends the code and its label together, so adding a reason needs no backend
-- or schema change.
--
-- `reason` keeps holding the human label, both for readability and so rows
-- written before this migration still read correctly. Legacy free-text values
-- are mapped back onto their code in the UI where they match a known label.

ALTER TABLE stock_take_items ADD COLUMN reason_code TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_stock_take_items_reason_code ON stock_take_items(reason_code);
