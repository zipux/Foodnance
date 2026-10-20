-- ============================================================
-- Billing: what Paddle says about each account's subscription
-- ============================================================
-- Paddle (Merchant of Record) owns the money. These columns are a COPY of what
-- its webhooks last told us, written only by POST /api/paddle/webhook after the
-- signature checks out. Nothing in the browser can write them.
--
-- paddle_customer_id       ctm_…  Paddle's customer
-- paddle_subscription_id   sub_…  the subscription we last heard about
-- billing_status           Paddle's own word: trialing | active | past_due |
--                          paused | canceled. NULL = no subscription yet.
-- billing_price_id         pri_…  what they are paying for (Essentials / Pro)
-- billing_next_at          when Paddle next charges; during the trial, the day
--                          the trial ends. NULL once nothing more will be charged.
-- billing_change           a change Paddle has scheduled, e.g. 'cancel' or
--                          'pause' (the customer asked to stop at period end)
-- billing_change_at        when that change happens
-- billing_event_at         occurred_at of the event these columns came from.
--                          Webhooks can arrive out of order; an older event never
--                          overwrites a newer one.
-- billing_updated_at       when we wrote them (UTC)
ALTER TABLE organizations ADD COLUMN paddle_customer_id TEXT DEFAULT NULL;
ALTER TABLE organizations ADD COLUMN paddle_subscription_id TEXT DEFAULT NULL;
ALTER TABLE organizations ADD COLUMN billing_status TEXT DEFAULT NULL;
ALTER TABLE organizations ADD COLUMN billing_price_id TEXT DEFAULT NULL;
ALTER TABLE organizations ADD COLUMN billing_next_at TEXT DEFAULT NULL;
ALTER TABLE organizations ADD COLUMN billing_change TEXT DEFAULT NULL;
ALTER TABLE organizations ADD COLUMN billing_change_at TEXT DEFAULT NULL;
ALTER TABLE organizations ADD COLUMN billing_event_at TEXT DEFAULT NULL;
ALTER TABLE organizations ADD COLUMN billing_updated_at TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_org_paddle_subscription ON organizations(paddle_subscription_id);
CREATE INDEX IF NOT EXISTS idx_org_paddle_customer ON organizations(paddle_customer_id);

-- Every webhook Paddle delivered, once each (Paddle re-sends the same event_id
-- until we answer 200). A log for "what did Paddle tell us, and when" — the
-- organization columns above are the state; this is how it got there.
--
-- org_id is NULL when the event could not be matched to an account (logged,
-- answered 200 so Paddle stops retrying, and visible here to be sorted by hand).
-- The account purge deletes an account's rows like any other tenant table;
-- Paddle keeps its own copy of every payment.
CREATE TABLE IF NOT EXISTS billing_events (
  event_id     TEXT PRIMARY KEY,        -- evt_…
  event_type   TEXT NOT NULL,           -- e.g. subscription.updated
  occurred_at  TEXT,                    -- Paddle's timestamp for the event
  org_id       TEXT,
  entity_id    TEXT,                    -- sub_… / txn_… / ctm_… the event is about
  status       TEXT,                    -- the entity's status in the event, if any
  received_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_billing_events_org ON billing_events(org_id, received_at);
