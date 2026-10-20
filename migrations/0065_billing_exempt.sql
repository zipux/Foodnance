-- ============================================================
-- "No payment needed" — accounts that never pay through Paddle
-- ============================================================
-- Billing plan step 4. Once a card is required (step 3), an account with no
-- Paddle subscription can't get past /start-trial.html. That must not catch:
--   · every account that exists today (they signed up before cards were asked
--     for — locking them out the day this ships would be a breach of trust)
--   · free pilots and demo accounts the operator sets up by hand
--
-- billing_exempt  1 = never asked for a card. Set from the admin screen's
--                 Payment column (POST /api/admin/organizations/:id/billing-exempt).
--
-- Every account present when this runs is exempted. New accounts start at 0.
ALTER TABLE organizations ADD COLUMN billing_exempt INTEGER NOT NULL DEFAULT 0;
UPDATE organizations SET billing_exempt = 1;
