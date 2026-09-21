// INTEGRATION — needs a running sandbox and writes to the local D1 / R2.
//   npm run dev:sandbox        (in another terminal)
//   npm run test:purge
//
// The purge is the one irreversible action in the product, and the Privacy
// Policy's "we permanently delete it" rests on it. Two ways it can be wrong:
//
//   1. It leaves something behind — a table it doesn't know about, a file in R2,
//      a sign-in row — so "deleted" is untrue. Or it trips over a foreign key
//      part-way and leaves the account half-erased.
//   2. It deletes too much — another customer's rows or files.
//
// Both are checked against a real second organization, not just "the purged one
// is gone". account-lifecycle.test.mjs covers the guards (archived first, exact
// name); this covers what the purge actually removes.
//
// Rows are seeded through the real routes wherever one exists (suppliers, staff,
// products, upload, forgot-password). Only the two AI log tables have no
// route that works without a live Anthropic key, so those are written directly.
import { execFileSync } from 'node:child_process';
import { suite } from '../helpers/assert.mjs';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const STAMP = Date.now().toString(36);
const ADMIN = { email: `purge-admin-${STAMP}@test.local`, password: 'purge-admin-pw-1' };

// Every table carrying customer data — same list as TENANT_TABLES in
// tests/org-scoping.test.mjs. Kept as a literal here so a purge that forgets a
// table fails against the *database*, not against another copy of the list.
const TENANT_TABLES = [
  'ai_cap_blocks', 'ai_parse_log',
  'categories', 'certification_types', 'finished_product_items', 'finished_products',
  'generic_products', 'inventory', 'invoice_lines', 'invoices', 'item_placements',
  'labor_periods', 'operating_expenses', 'pos_imports', 'pos_item_map', 'pos_sale_lines',
  'product_aliases', 'product_entries', 'product_mappings',
  'recipe_items', 'recipes', 'recurring_expenses', 'sales_monthly', 'spread_expenses',
  'staff', 'staff_certifications', 'stock_log', 'stock_take_items', 'stock_takes',
  'storage_sections', 'suppliers', 'units', 'vendor_fee_templates',
];

function sql(q) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'invoicedb-production', '--local', '--json', '--command', q],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results || [];
}

// One query, one row, one column per table, for one organization. (Scalar
// subqueries, not UNION ALL: D1 caps the number of terms in a compound SELECT.)
function countsFor(orgId) {
  const cols = TENANT_TABLES.map(tb => `(SELECT COUNT(*) FROM ${tb} WHERE org_id = '${orgId}') AS ${tb}`);
  return sql(`SELECT ${cols.join(', ')}`)[0];
}
const authCount = (tb, where) => sql(`SELECT COUNT(*) AS n FROM ${tb} WHERE ${where}`)[0].n;

function jar() { return { cookies: {} }; }
function absorb(j, res) {
  const raw = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean);
  for (const line of raw) {
    const [pair] = String(line).split(';'); const i = pair.indexOf('=');
    if (i > 0) j.cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
}
async function call(j, method, path, body) {
  const cookie = j ? Object.entries(j.cookies).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ') : '';
  const isForm = body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body && !isForm ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: isForm ? body : JSON.stringify(body) } : {}),
  });
  if (j) absorb(j, res);
  let data = null; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data, res };
}
const get  = (j, p)    => call(j, 'GET', p);
const post = (j, p, b) => call(j, 'POST', p, b);
const del  = (j, p, b) => call(j, 'DELETE', p, b);

const t = suite('integration/org-purge');

// ── Setup: an operator and two customers ─────────────────────────
const admin = jar();
const boot = await post(admin, '/api/auth/bootstrap', { ...ADMIN, name: 'Purge Test' });
if (boot.status === 409) {
  const login = await post(admin, '/api/auth/login', { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' });
  if (login.status !== 200) { console.error('\n  Cannot get a super-admin session. Start from a fresh local database.\n'); process.exit(1); }
} else if (boot.status === 200) {
  await post(admin, '/api/auth/login', ADMIN);
}

async function makeOrg(label) {
  const o = { name: `Purge ${label} ${STAMP}`, email: `purge-${label}-${STAMP}@test.local`, password: `purge-${label}-pw-1` };
  const r = await post(admin, '/api/admin/organizations', {
    name: o.name, owner_email: o.email, owner_password: o.password, account_type: 'restaurant',
  });
  if (r.status !== 200) { console.error(`\n  Could not create ${label} org: ${JSON.stringify(r.data)}\n`); process.exit(1); }
  o.id = r.data.organization.id;
  // Staff and certifications are Pro features; on Essential the writes are refused.
  await post(admin, `/api/admin/organizations/${o.id}/plan`, { plan: 'pro' });
  o.jar = jar();
  await post(o.jar, '/api/auth/login', { email: o.email, password: o.password });
  return o;
}
const target = await makeOrg('target');
const bystander = await makeOrg('bystander');

// Seed one organization with data across route-reachable tables, an uploaded
// file, and the two rows only SQL can plant.
async function seed(o) {
  await post(o.jar, '/api/tables/suppliers', { name: `Supplier ${o.name}` });
  await post(o.jar, '/api/tables/generic_products', { name: `Product ${o.name}`, category: 'Other' });
  const cook = await post(o.jar, '/api/tables/staff', { full_name: `Cook ${o.name}`, email: `cook-${o.id}@test.local`, phone: '555-0100' });

  // A staff certificate with its scan — the personal-data case the Privacy Policy
  // is most concerned about.
  const form = new FormData();
  form.append('file', new Blob([`certificate for ${o.name}`], { type: 'text/plain' }), 'cert.txt');
  const up = await post(o.jar, '/api/upload', form);
  o.fileKey = up.data?.key;
  const ct = await post(o.jar, '/api/tables/certification_types', { name: `Food Safe ${o.id}`, validity_months: 12 });
  await post(o.jar, '/api/tables/staff_certifications', {
    staff_id: cook.data?.id, cert_type_id: ct.data?.id, cert_type_name: `Food Safe ${o.id}`,
    staff_name: `Cook ${o.name}`, issue_date: '2026-01-01', expiry_date: '2027-01-01', file_key: o.fileKey,
  });

  sql(`INSERT INTO ai_parse_log (id, org_id, kind, input_tokens, output_tokens, cost) VALUES ('apl-${o.id}', '${o.id}', 'invoice', 100, 50, 0.01)`);
  sql(`INSERT INTO ai_cap_blocks (id, org_id, cap, used) VALUES ('acb-${o.id}', '${o.id}', 150, 150)`);

  // A password-reset row through the real path: this is the row that points at
  // the user, so it is what a purge trips on if it deletes users first.
  await post(null, '/api/auth/forgot-password', { email: o.email });
}
await seed(target);
await seed(bystander);

const targetBefore = countsFor(target.id);
const bystanderBefore = countsFor(bystander.id);
const seededTables = Object.entries(targetBefore).filter(([, n]) => n > 0).map(([tb]) => tb);

t.section('Seed — the test is only meaningful if the target actually has data everywhere');
t.check('target has rows in the data tables',
  ['suppliers', 'generic_products', 'staff', 'certification_types', 'staff_certifications'].every(tb => targetBefore[tb] > 0),
  JSON.stringify(targetBefore));
t.check('target has AI log rows (they point at the org row)',
  targetBefore.ai_parse_log > 0 && targetBefore.ai_cap_blocks > 0, JSON.stringify(targetBefore));
t.check('target has an uploaded file', !!target.fileKey && target.fileKey.startsWith(`uploads/${target.id}/`), target.fileKey);
t.check('target has a password-reset record',
  authCount('password_resets', `user_id IN (SELECT id FROM users WHERE org_id = '${target.id}')`) > 0);
t.check('bystander is seeded identically', seededTables.every(tb => bystanderBefore[tb] > 0), JSON.stringify(bystanderBefore));

// ── Purge ────────────────────────────────────────────────────────
t.section('Purge');
await post(admin, `/api/admin/organizations/${target.id}/archive`, {});
const purge = await del(admin, `/api/admin/organizations/${target.id}`, { confirm_name: target.name });
t.check('purge succeeds', purge.status === 200, `status ${purge.status} ${JSON.stringify(purge.data)}`);
t.check('purge reports no warning', !purge.data?.warning, purge.data?.warning);
t.check('purge counts the file it removed', purge.data?.files_deleted === 1, JSON.stringify(purge.data));

// ── Nothing of the target's is left ──────────────────────────────
t.section('Nothing left behind');
const targetAfter = countsFor(target.id);
const leftovers = Object.entries(targetAfter).filter(([, n]) => n > 0);
t.check('no rows remain in any tenant table', leftovers.length === 0, JSON.stringify(leftovers));
t.check('the organization row is gone', authCount('organizations', `id = '${target.id}'`) === 0);
t.check('its users are gone', authCount('users', `org_id = '${target.id}'`) === 0);
t.check('its invites are gone', authCount('invites', `org_id = '${target.id}'`) === 0);
t.check('no password-reset records point at a deleted user',
  authCount('password_resets', `user_id NOT IN (SELECT id FROM users)`) === 0);
t.check('the owner can no longer sign in',
  (await post(jar(), '/api/auth/login', { email: target.email, password: target.password })).status === 401);

// ── The other customer is untouched ──────────────────────────────
t.section('Bystander untouched');
const bystanderAfter = countsFor(bystander.id);
t.check('every one of the bystander\'s tables has the same row counts',
  JSON.stringify(bystanderAfter) === JSON.stringify(bystanderBefore),
  `before ${JSON.stringify(bystanderBefore)} after ${JSON.stringify(bystanderAfter)}`);
t.check('bystander organization and user survive',
  authCount('organizations', `id = '${bystander.id}'`) === 1 && authCount('users', `org_id = '${bystander.id}'`) === 1);
t.check('bystander\'s password-reset record survives',
  authCount('password_resets', `user_id IN (SELECT id FROM users WHERE org_id = '${bystander.id}')`) > 0);
t.check('bystander can still sign in',
  (await post(jar(), '/api/auth/login', { email: bystander.email, password: bystander.password })).status === 200);
const file = await call(bystander.jar, 'GET', `/api/files/${bystander.fileKey}`);
t.check('bystander\'s uploaded file is still readable', file.status === 200, `status ${file.status}`);

// ── Idempotence: a second purge is a clean 404, not a crash ──────
t.section('Repeat');
const again = await del(admin, `/api/admin/organizations/${target.id}`, { confirm_name: target.name });
t.check('purging it again is a clean 404', again.status === 404, `status ${again.status}`);

// Leave the local database as we found it.
await post(admin, `/api/admin/organizations/${bystander.id}/archive`, {});
await del(admin, `/api/admin/organizations/${bystander.id}`, { confirm_name: bystander.name });

t.done();
