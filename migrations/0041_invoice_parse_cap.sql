-- Monthly AI invoice-parsing cap for the Essential plan, plus the usage record
-- the cap counts against.
--
-- WHY A NEW LOG TABLE rather than counting invoices: `invoices.ai_cost` is
-- accumulated CLIENT-side (public/static/invoice.js) and written only when the
-- invoice is saved. So a parse the user abandons costs real money and leaves no
-- trace, and a multi-page invoice folds several API calls into one row. Neither
-- is a sound basis for a spend cap. ai_parse_log records one row per actual call
-- to Anthropic, written server-side before the response is returned, which is
-- the thing that costs money and therefore the thing to meter.
--
-- `invoices.ai_cost` stays as-is — it answers "what did THIS invoice cost to
-- read?" on the invoice screen. The two are different questions and both are
-- worth having; ai_parse_log is the authority for spend and quota.

CREATE TABLE ai_parse_log (
  id            TEXT    PRIMARY KEY,
  org_id        TEXT    DEFAULT NULL REFERENCES organizations(id),
  -- 'invoice' | 'recipe'. Only invoice parses are metered today, but recipe
  -- parses are the other AI spend and currently discard their usage entirely,
  -- so the column is here for when that gets fixed.
  kind          TEXT    NOT NULL DEFAULT 'invoice',
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost          REAL    NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_ai_parse_log_org_date ON ai_parse_log(org_id, created_at);

-- Every parse refused for being over the cap. A hard block SUPPRESSES the demand
-- it blocks, so without this there is no way to tell an account that bounced off
-- the cap once from one that bounced off it forty times — which is exactly the
-- evidence needed to decide whether pay-per-invoice overage is worth building,
-- and what to charge for it. Cheap to write, impossible to reconstruct later.
CREATE TABLE ai_cap_blocks (
  id         TEXT    PRIMARY KEY,
  org_id     TEXT    DEFAULT NULL REFERENCES organizations(id),
  cap        INTEGER NOT NULL,           -- the cap in force at the time
  used       INTEGER NOT NULL,           -- parses already used that month
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_ai_cap_blocks_org_date ON ai_cap_blocks(org_id, created_at);

-- Per-organization override of the plan's default cap.
--   NULL -> use the plan default (Essential 150, Pro uncapped)
--   0    -> explicitly uncapped, whatever the plan says
--   N    -> explicitly capped at N
-- Deliberately a NUMBER on the organization rather than a constant behind a
-- plan check: lifting the cap for one account today and incrementing it from a
-- future pay-per-invoice payment are then the same operation on the same field,
-- so overage billing can be added without reworking enforcement.
ALTER TABLE organizations ADD COLUMN invoice_cap INTEGER DEFAULT NULL;

-- Preserve the history that already exists: one log row per invoice that
-- recorded a cost. Multi-call invoices collapse to a single row here, which
-- slightly UNDER-counts past usage — unavoidable, since the individual calls
-- were never recorded. Going forward the log is exact.
INSERT INTO ai_parse_log (id, org_id, kind, input_tokens, output_tokens, cost, created_at)
SELECT 'bf-' || i.id,
       i.org_id,
       'invoice',
       COALESCE(i.ai_input_tokens, 0),
       COALESCE(i.ai_output_tokens, 0),
       i.ai_cost,
       i.created_at
FROM invoices i
WHERE i.ai_cost > 0;
