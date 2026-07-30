-- ============================================================================
-- wipe-data.sql — clear all TEST/business DATA, keep the schema + reference data.
--
-- Use before handing the app to a customer so it starts empty, and repeatably
-- during development to reset test data.
--
-- Run it with:
--   npm run db:wipe:local   (your local .wrangler test DB)
--   npm run db:wipe:prod    (the live Cloudflare production DB — IRREVERSIBLE)
--
-- This is a HARD delete: rows are gone for good (no archive/void). The tables,
-- columns and migrations are untouched, so the app keeps working — just empty.
--
-- KEPT (reference/setup, not test data):
--   units            — unit definitions (kg, lb, Each, …)
--   categories       — product category list
--   adjust_reasons   — stock-adjustment reason list
--   storage_sections — the shape of the walk-in/shelving, which is the room
--                      itself rather than what is currently in it. The stock
--                      placed in those sections (item_placements) IS wiped.
-- To also wipe one of the above, add a matching DELETE line below.
--
-- NOTE: uploaded invoice IMAGES live in R2 file storage, NOT in this database,
-- so this script does not remove them. Ask Claude to clear R2 separately for a
-- truly bare handover.
--
-- Deletes run child-tables-first so foreign keys never block the wipe.
-- ============================================================================

DELETE FROM staff_certifications;
DELETE FROM stock_take_items;
DELETE FROM pos_sale_lines;
DELETE FROM pos_imports;
DELETE FROM pos_item_map;
DELETE FROM item_placements;
DELETE FROM invoice_lines;
DELETE FROM finished_product_items;
DELETE FROM recipe_items;
DELETE FROM product_entries;
DELETE FROM product_aliases;
DELETE FROM product_mappings;
DELETE FROM inventory;
DELETE FROM stock_log;
DELETE FROM stock_takes;
DELETE FROM invoices;
DELETE FROM finished_products;
DELETE FROM recipes;
DELETE FROM generic_products;
DELETE FROM suppliers;
DELETE FROM vendor_fee_templates;
DELETE FROM staff;
DELETE FROM certification_types;

-- P&L inputs and AI usage. These were missing until 2026-07-31, so a "wiped"
-- database still showed the previous tenant's revenue, overheads and AI spend.
DELETE FROM sales_monthly;
DELETE FROM operating_expenses;
DELETE FROM recurring_expenses;
DELETE FROM spread_expenses;
DELETE FROM ai_parse_log;
DELETE FROM ai_cap_blocks;

-- Reference data intentionally KEPT: units, categories, adjust_reasons,
-- storage_sections
