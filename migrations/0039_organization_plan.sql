-- Records which plan tier an organization is on.
--
-- Purely informational for now: the admin list shows it and an operator can set
-- it, but NOTHING is gated on it yet — the Essential/Pro feature boundaries are
-- agreed but unbuilt. The column exists so the tier is already recorded against
-- every account by the time gating ships, rather than needing a backfill from
-- memory about who was sold what.
--
-- 'essential' is the default because it is the entry tier: an account created
-- before anyone thinks about plans is an Essential account.

ALTER TABLE organizations ADD COLUMN plan TEXT NOT NULL DEFAULT 'essential';
