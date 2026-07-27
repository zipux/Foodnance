-- Per-invoice AI parsing cost, captured from the Anthropic API's `usage` field
-- at parse time (previously discarded). Accumulates across multiple parse
-- calls for the same invoice (initial upload + any "add page" re-parses).
ALTER TABLE invoices ADD COLUMN ai_input_tokens INTEGER DEFAULT 0;
ALTER TABLE invoices ADD COLUMN ai_output_tokens INTEGER DEFAULT 0;  -- includes adaptive-thinking tokens
ALTER TABLE invoices ADD COLUMN ai_cost REAL DEFAULT 0;              -- USD, computed at parse time from that call's model pricing
