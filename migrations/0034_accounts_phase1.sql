-- ============================================================
-- Accounts, Phase 1: login foundation
-- ============================================================
-- Adds organizations (one per restaurant/commissary), users, and invites.
--
-- DELIBERATELY NOT ADDED TO ALLOWED_TABLES in src/index.ts. The generic
-- /api/tables/:table CRUD is currently unauthenticated, so listing these
-- there would publish every password hash and salt on the open internet.
-- All access goes through the dedicated /api/auth/* and /api/admin/*
-- routes instead. If you ever add them to that allowlist, stop.
--
-- Phase 1 does NOT isolate data — every logged-in user still sees the same
-- rows. Phase 2 adds org_id to the ~20 data tables and filters on it. Do not
-- onboard a second real customer until Phase 2 ships.
-- ============================================================

-- One row per customer business.
CREATE TABLE IF NOT EXISTS organizations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  -- 'restaurant' | 'commissary' — gates which features show and sets the
  -- per-recipe production_mode default (see backflush-inventory-model).
  account_type  TEXT NOT NULL DEFAULT 'restaurant',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at   TEXT DEFAULT NULL
);

-- Users belong to exactly one organization, EXCEPT super_admin, whose
-- org_id is NULL — they are global and can act across every organization.
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  org_id         TEXT DEFAULT NULL REFERENCES organizations(id),
  email          TEXT NOT NULL,
  -- PBKDF2-SHA256, hex-encoded. Salt is per-user, never reused.
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  -- Iterations stored per row so the cost can be raised later without
  -- invalidating existing passwords.
  password_iter  INTEGER NOT NULL DEFAULT 100000,
  -- 'super_admin' (global, org_id NULL) | 'owner' (manages team) | 'member'
  role           TEXT NOT NULL DEFAULT 'member',
  name           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at  TEXT DEFAULT NULL,
  archived_at    TEXT DEFAULT NULL
);

-- Email is the login handle, so it must be unique across the whole system.
-- Stored already-lowercased by the API; this index enforces one account per
-- address rather than relying on that.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

-- Copy-link invites: the owner generates one, shares it however they like
-- (WhatsApp, in person). The app never sends email.
CREATE TABLE IF NOT EXISTS invites (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id),
  email       TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL DEFAULT 'member',
  -- Random, single-use. Consumed when the invitee sets their password.
  token       TEXT NOT NULL,
  created_by  TEXT DEFAULT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT DEFAULT NULL,
  accepted_at TEXT DEFAULT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_token ON invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_org ON invites(org_id);
