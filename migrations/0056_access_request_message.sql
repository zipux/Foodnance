-- ============================================================
-- Free-text message on "Request access" leads
-- ============================================================
-- The request-access modal (public/static/request-access.js) gained an
-- optional "Anything else?" box. POST /api/interest stores it here and puts it
-- in the notification email. The route falls back to inserting without it if
-- this column is missing, so a deploy that runs ahead of the migration still
-- saves the lead (the message then survives only in the email).
ALTER TABLE access_requests ADD COLUMN message TEXT;
