-- ============================================================
-- Terms acceptance record
-- ============================================================
-- Who agreed to which version of the Terms of Service and Privacy Policy,
-- and when. Written when an account is created from an invite link (the tick
-- box on accept-invite.html, required by POST /api/auth/accept-invite) and,
-- for people whose account predates this, by the one-time panel the app shows
-- after sign-in (POST /api/auth/accept-terms).
--
-- terms_version      the Terms' "Last updated" date as YYYY-MM-DD
--                    (TERMS_VERSION in src/index.ts) at the moment they agreed.
-- terms_accepted_at  NULL = never agreed; the app asks once.
--
-- Existing users stay NULL on purpose: nobody is recorded as having agreed to
-- something they were never shown.
ALTER TABLE users ADD COLUMN terms_version TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN terms_accepted_at TEXT DEFAULT NULL;
