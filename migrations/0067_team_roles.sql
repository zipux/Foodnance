-- ============================================================
-- Team roles: Owner / Manager / Kitchen staff
-- ============================================================
-- Until now every teammate was stored as 'owner' with the owner's full access
-- (Terms §3 already promised roles with different powers). From here:
--
-- users.role / invites.role
--   'owner'    one per business, the person who signed up. Everything,
--              including billing, roles and closing the account.
--   'manager'  what the role switches allow (defaults: nearly everything)
--   'kitchen'  what the role switches allow (defaults: upload invoices,
--              stock counts and waste)
--   'super_admin' unchanged (the operator, no organization)
--
-- organizations.role_permissions — this business's changes to the default
-- switches, as JSON: {"manager": {"pnl": false}, "kitchen": {"prices": true},
-- "managers_edit_kitchen": false}. NULL = the defaults. Read by rolePermissions()
-- in src/index.ts, which holds the defaults and the list of switches.

ALTER TABLE organizations ADD COLUMN role_permissions TEXT DEFAULT NULL;

-- The earliest person on each business stays its owner; everyone who joined
-- after them becomes a manager (the role closest to what they had).
UPDATE users SET role = 'manager'
 WHERE role = 'owner' AND org_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM users o
                WHERE o.org_id = users.org_id AND o.role = 'owner'
                  AND (o.created_at < users.created_at
                       OR (o.created_at = users.created_at AND o.id < users.id)));

-- Pending invites: one sent by the operator ("Add a restaurant") is the owner's
-- way in and stays 'owner'; one sent by a teammate becomes 'manager'.
UPDATE invites SET role = 'manager'
 WHERE accepted_at IS NULL AND role <> 'manager'
   AND created_by IN (SELECT id FROM users WHERE role <> 'super_admin');
