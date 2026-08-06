-- Fixed monthly costs that know when they started (and, optionally, stopped).
--
-- recurring_expenses had no dates at all, so every row applied to EVERY month
-- forever, including months before the business existed. A restaurant that
-- signed up in June and entered $9,670 of rent, insurance and licences saw
-- January 2026 report a clean "Net profit — what you keep: −$9,670" for a month
-- in which nothing happened, and Year to Date quietly carried $28,918 of costs
-- against no sales. Both figures were right by the app's own rules and wrong to
-- every customer who read them.
--
-- Whole months, not dates: the P&L is a whole-months-only report (pnlFrom..pnlTo
-- are 'YYYY-MM'), and rent is charged by the month rather than the day. Storing
-- 'YYYY-MM' keeps the comparison a plain string compare and avoids inventing a
-- part-month proration nobody's landlord uses.
--
-- NULL means "no boundary", so every existing row keeps behaving exactly as it
-- does today: applies to every month, forever. Nobody's numbers move because
-- this migration ran. What changes is that a NEW fixed cost is created with a
-- start month, so it stops reaching backwards into history on its own.
--
-- This also covers the thing that was going to be needed anyway: rent going up
-- is now the old row ended and a new one started, and an insurance policy that
-- begins in June is a June start.

ALTER TABLE recurring_expenses ADD COLUMN start_period TEXT DEFAULT NULL;
ALTER TABLE recurring_expenses ADD COLUMN end_period   TEXT DEFAULT NULL;
