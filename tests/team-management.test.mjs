// Static audit: the Settings/Team feature (2026-08-10).
//
// `invites` and `users` are deliberately NOT covered by org-scoping.test.mjs's
// mechanical audit (see that file's TENANT_TABLES comment — auth tables are
// "scoped by their own rules, not by org_id on the row"). That means nothing
// mechanical catches a missing org filter on a /api/team* route — this file
// is that check, by hand, for exactly this feature.
//
// It also pins the two things most likely to regress quietly:
//   1. The two new unauthenticated routes (invite lookup + accept) are the
//      ONLY new entries in PUBLIC_API — anything else showing up there is a
//      real find, not a rename.
//   2. Deactivating a teammate refuses to deactivate yourself, and refuses to
//      leave an organization with zero active users.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src  = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8');

const t = suite('team-management');

// Same handler-slicing technique as invoice-review-queue.test.mjs / the
// org-scoping audit: from an `app.<verb>('<path>', ...)` declaration to the
// next top-level route declaration.
const routeStarts = [...src.matchAll(/^app\.(get|post|put|patch|delete)\(\s*'([^']+)'/gm)];
function handlerBody(method, path) {
  const idx = routeStarts.findIndex(m => m[1] === method && m[2] === path);
  if (idx === -1) return null;
  const start = routeStarts[idx].index;
  const end = idx + 1 < routeStarts.length ? routeStarts[idx + 1].index : src.length;
  return src.slice(start, end);
}

t.section('every /api/team* route is org-scoped by hand');
for (const [method, path] of [
  ['get',  '/api/team'],
  ['post', '/api/team/invite'],
  ['post', '/api/team/invites/:id/revoke'],
  ['post', '/api/team/:id/archive'],
]) {
  const body = handlerBody(method, path);
  t.check(`${method.toUpperCase()} ${path} exists`, !!body);
  t.check(`${method.toUpperCase()} ${path} calls orgOf(c)`,
    !!body && /orgOf\(c\)/.test(body));
}

t.section('deactivating a teammate has both safety guards');
const archiveBody = handlerBody('post', '/api/team/:id/archive');
t.check("refuses to deactivate yourself (compares id to the caller's own id)",
  !!archiveBody && /id === me\.id/.test(archiveBody));
t.check('refuses to leave zero active users (counts active users first)',
  !!archiveBody && /COUNT\(\*\)/.test(archiveBody) && /archived_at IS NULL/.test(archiveBody));

t.section('the two new public routes, and nothing extra, joined PUBLIC_API');
const publicApiBlock = src.match(/const PUBLIC_API = new Set\(\[([\s\S]*?)\]\)/);
t.check('PUBLIC_API is declared', !!publicApiBlock);
// Line-anchored, not a bare quote scan: several of these entries carry an
// apostrophe in their trailing comment ("can't", "doesn't"), which would
// otherwise throw off quote-pairing across the whole block.
const publicPaths = (publicApiBlock?.[1] || '')
  .split('\n')
  .map(line => line.match(/^\s*'([^']+)'/))
  .filter(Boolean)
  .map(m => m[1]);
t.check('/api/invites/lookup is public',      publicPaths.includes('/api/invites/lookup'));
t.check('/api/auth/accept-invite is public',  publicPaths.includes('/api/auth/accept-invite'));
t.check('no /api/team* route was accidentally made public',
  !publicPaths.some(p => p.startsWith('/api/team')));

t.section('accept-invite re-validates the token for real, not just the client-side check');
const acceptBody = handlerBody('post', '/api/auth/accept-invite');
t.check('POST /api/auth/accept-invite exists', !!acceptBody);
t.check('checks accepted_at IS NULL', !!acceptBody && /accepted_at IS NULL/.test(acceptBody));
t.check('checks an expiry condition', !!acceptBody && /expires_at/.test(acceptBody));
t.check('re-checks email uniqueness at redemption time',
  !!acceptBody && /SELECT id FROM users WHERE email = \?/.test(acceptBody));
t.check('the invite is consumed (accepted_at is written)',
  !!acceptBody && /UPDATE invites SET accepted_at/.test(acceptBody));
t.check("stores the honest 'owner' role, not an unenforced 'member'",
  !!acceptBody && /'owner'/.test(acceptBody) && !/'member'/.test(acceptBody));

t.section('invites/lookup gives one message for unknown/expired/used tokens');
const lookupBody = handlerBody('post', '/api/invites/lookup');
t.check('POST /api/invites/lookup exists', !!lookupBody);
const errorMessages = [...(lookupBody || '').matchAll(/c\.json\(\{\s*error:\s*'([^']+)'/g)].map(m => m[1]);
t.check('exactly one distinct error message on this route (no shape leak)',
  new Set(errorMessages).size === 1, `found: ${JSON.stringify(errorMessages)}`);

t.section('generic table CRUD still refuses invites/users/organizations');
const allowedTablesBlock = src.match(/const ALLOWED_TABLES = \[([\s\S]*?)\]/);
t.check('ALLOWED_TABLES is declared', !!allowedTablesBlock);
for (const forbidden of ['invites', 'users', 'organizations']) {
  t.check(`'${forbidden}' is NOT in ALLOWED_TABLES`,
    !!allowedTablesBlock && !new RegExp(`'${forbidden}'`).test(allowedTablesBlock[1]));
}

t.done();
