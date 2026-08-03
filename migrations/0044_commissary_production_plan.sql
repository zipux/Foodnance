-- A commissary is sold one tier, "Production", which is the Pro entitlement
-- under a different name (see planLabel in src/index.ts).
--
-- "Production" is a LABEL, not a third value in organizations.plan. Every plan
-- comparison in the codebase is binary — planFeatures() tests === 'pro', and
-- PLAN_INVOICE_CAPS[plan] ?? 0 resolves anything unrecognised to 0, meaning
-- UNCAPPED AI parsing. A third value would have been wrong in both directions
-- at once, one loudly and one silently. So the column keeps two values and the
-- name is derived from account_type.
--
-- This backfills the accounts created before that rule existed. Until now the
-- create route left `plan` at its column default of 'essential' regardless of
-- account type, so any commissary already on file has the batch and pack
-- buttons (gated on account_type) while being refused every Pro page those
-- buttons feed — it can move stock it cannot count, adjust or reconcile.
--
-- Safe to re-run: the WHERE clause makes it a no-op once applied.
UPDATE organizations
   SET plan = 'pro'
 WHERE account_type = 'commissary'
   AND LOWER(COALESCE(plan, '')) <> 'pro';
