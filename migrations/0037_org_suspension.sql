-- Account lifecycle for billing and offboarding.
--
-- Three states, in order of severity. `archived_at` already existed (0034) but
-- was never enforced anywhere — this migration is what finally gives it meaning,
-- alongside the new suspension flag.
--
--   active     both columns NULL — normal.
--   suspended  suspended_at set. Behind on payment: they can still sign in and
--              read everything, but every write is refused (402). Reversible.
--   archived   archived_at set. Relationship over: sign-in refused outright,
--              data retained so it can still be exported or restored before a
--              purge. Archived wins over suspended.
--
-- Timestamp-as-state matches the rest of the schema (invoices.voided_at,
-- generic_products.deleted_at, users.archived_at) and records *when* for free.
-- The reason column mirrors invoices.void_reason.
ALTER TABLE organizations ADD COLUMN suspended_at   TEXT DEFAULT NULL;
ALTER TABLE organizations ADD COLUMN suspend_reason TEXT NOT NULL DEFAULT '';
