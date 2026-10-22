-- Migration 0068: which province a business is in (2026-10-22).
--
-- The tax AMOUNTS were already right everywhere: the invoice reader files
-- GST/HST in tax_gst (claimed back, never a cost) and PST/RST in tax_pst (a
-- cost line on the P&L). What was BC-only is the NAMES on screen: an Ontario
-- owner saw "PST" where their invoices say HST. The screens now name the taxes
-- from this column (taxNames() in public/static/utils.js).
--
-- Two-letter code: BC, AB, SK, MB, ON, NS, NB, NL, PE, YT, NT, NU. Quebec is
-- not offered (its QST is claimed back but read into tax_pst; see CLAUDE.md).
-- Every account that existed before this is in BC.
ALTER TABLE organizations ADD COLUMN province TEXT;
UPDATE organizations SET province = 'BC' WHERE province IS NULL;
