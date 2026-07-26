// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run dev:sandbox        (in another terminal)
//   npm run test:isolation
//
// Proves that one business cannot see, change, or destroy another's data.
//
// This is the test that has to pass before a second customer is ever onboarded.
// tests/org-scoping.test.mjs is its static counterpart — that one proves every
// SQL statement MENTIONS org_id, this one proves the system actually behaves.
// Both are needed: a statement can be correctly filtered and still be reachable
// through a handler that resolves the wrong business.
//
// Self-contained: creates its own super-admin (or reuses one), then two
// throwaway businesses with unique names per run, so it can be run repeatedly
// without cleanup and without disturbing anything else in the local database.
import { suite } from '../helpers/assert.mjs';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const STAMP = Date.now().toString(36);

const ADMIN = { email: `isolation-admin-${STAMP}@test.local`, password: 'isolation-admin-pw-1' };

// Cookie jar per identity — the session is an HttpOnly cookie, so the test has
// to hold one jar per signed-in user exactly as three browsers would.
//
// It must store cookies BY NAME. The first version kept a single string, so the
// moment view-as set dm_view_org it clobbered dm_session and silently signed the
// operator out — three tests failed against a feature that actually worked.
function jar() {
  return { cookies: {} };
}

function jarHeader(j) {
  const pairs = Object.entries(j?.cookies || {}).filter(([, v]) => v !== '');
  return pairs.length ? pairs.map(([k, v]) => `${k}=${v}`).join('; ') : '';
}

function absorbCookies(j, res) {
  if (!j) return;
  // Node 18+ exposes every Set-Cookie separately; .get() would join them.
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  for (const line of raw) {
    const [pair] = String(line).split(';');
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    j.cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
}

async function call(j, method, path, body) {
  const cookie = jarHeader(j);
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  absorbCookies(j, res);
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

const get  = (j, p)      => call(j, 'GET', p);
const post = (j, p, b)   => call(j, 'POST', p, b);
const del  = (j, p)      => call(j, 'DELETE', p);

const t = suite('integration/tenant-isolation');

// ── Setup ────────────────────────────────────────────────────────
const admin = jar();

// Bootstrap only works while the users table is empty; on a database that
// already has accounts, fall back to creating our admin via an existing one is
// impossible — so instead we require a known super-admin. Try bootstrap first
// (fresh database), then the well-known local dev admin.
let boot = await post(admin, '/api/auth/bootstrap', { ...ADMIN, name: 'Isolation Test' });
if (boot.status === 409) {
  const login = await post(admin, '/api/auth/login', {
    email: 'simoneisonni@gmail.com', password: 'correct-horse-battery',
  });
  if (login.status !== 200) {
    console.error(
      '\n  Cannot get a super-admin session.\n' +
      '  Either start from a fresh local database (npm run db:reset, then re-apply\n' +
      '  migrations 0034/0035) or make sure the local dev admin exists.\n',
    );
    process.exit(1);
  }
} else if (boot.status === 200) {
  await post(admin, '/api/auth/login', ADMIN);
}

const A = { name: `Iso A ${STAMP}`, email: `iso-a-${STAMP}@test.local`, password: 'iso-a-password-1' };
const B = { name: `Iso B ${STAMP}`, email: `iso-b-${STAMP}@test.local`, password: 'iso-b-password-1' };

const mkOrg = async (o) => post(admin, '/api/admin/organizations', {
  name: o.name, owner_email: o.email, owner_password: o.password, account_type: 'restaurant',
});
const orgA = await mkOrg(A);
const orgB = await mkOrg(B);
t.check('two businesses created', orgA.status === 200 && orgB.status === 200,
  `A=${orgA.status} B=${orgB.status} ${JSON.stringify(orgA.data?.error || orgB.data?.error || '')}`);

const a = jar(), b = jar();
await post(a, '/api/auth/login', { email: A.email, password: A.password });
await post(b, '/api/auth/login', { email: B.email, password: B.password });
t.check('both owners signed in', !!a.cookies.dm_session && !!b.cookies.dm_session);

// ── Each creates identically-named data ──────────────────────────
const supA = await post(a, '/api/tables/suppliers', { name: 'Shared Vendor Name' });
const supB = await post(b, '/api/tables/suppliers', { name: 'Shared Vendor Name' });
t.check('both created a supplier with the SAME name', supA.status === 201 && supB.status === 201);

const prodA = await post(a, '/api/tables/generic_products', { name: 'Shared Product', category: 'Other' });
const prodB = await post(b, '/api/tables/generic_products', { name: 'Shared Product', category: 'Other' });
t.check('both created a product with the SAME name', prodA.status === 201 && prodB.status === 201);

// ── Reads are separated ──────────────────────────────────────────
const listA = await get(a, '/api/tables/suppliers');
const listB = await get(b, '/api/tables/suppliers');
const namesA = (listA.data?.data || []).map(r => r.id);
const namesB = (listB.data?.data || []).map(r => r.id);
t.check('A does not see B\'s supplier row', !namesA.includes(supB.data.id));
t.check('B does not see A\'s supplier row', !namesB.includes(supA.data.id));

// ── Direct access by id is refused ───────────────────────────────
t.check('A fetching B\'s supplier by id -> 404',
  (await get(a, `/api/tables/suppliers/${supB.data.id}`)).status === 404);
t.check('A fetching B\'s product by id -> 404',
  (await get(a, `/api/tables/generic_products/${prodB.data.id}`)).status === 404);

// ── Writes cannot reach across ───────────────────────────────────
await call(a, 'PATCH', `/api/tables/suppliers/${supB.data.id}`, { name: 'HIJACKED' });
const bAfterPatch = await get(b, `/api/tables/suppliers/${supB.data.id}`);
t.check('A patching B\'s supplier leaves it unchanged',
  bAfterPatch.data?.name === 'Shared Vendor Name', `got ${bAfterPatch.data?.name}`);

await del(a, `/api/tables/suppliers/${supB.data.id}`);
t.check('A deleting B\'s supplier leaves it alive',
  (await get(b, `/api/tables/suppliers/${supB.data.id}`)).status === 200);

// ── Ownership cannot be forged on write ──────────────────────────
const planted = await post(a, '/api/tables/suppliers', {
  name: `Planted ${STAMP}`, org_id: orgB.data.organization.id,
});
t.check('a forged org_id is ignored, not honoured', planted.status === 201);
const bList = await get(b, '/api/tables/suppliers');
t.check('the planted row did NOT land in B',
  !(bList.data?.data || []).some(r => r.name === `Planted ${STAMP}`));

// ── Renames do not cascade across businesses ─────────────────────
// The highest-risk case: these cascades match on NAME, so an unscoped one
// rewrites the other business's history.
await call(a, 'PUT', `/api/generic_products/${prodA.data.id}`,
  { name: 'Renamed By A', category: 'Other' });
const bProd = await get(b, `/api/tables/generic_products/${prodB.data.id}`);
t.check('A renaming its product leaves B\'s identically-named one alone',
  bProd.data?.name === 'Shared Product', `got ${bProd.data?.name}`);

// ── Cross-business merge is impossible ───────────────────────────
const merge = await post(a, '/api/products/merge',
  { merged_id: prodA.data.id, surviving_id: prodB.data.id });
t.check('merging across businesses is refused', merge.status === 404);

// ── Invoice import attaches to your own products ─────────────────
const impB = await post(b, '/api/bulk/upsert-products', {
  vendor_name: 'Import Vendor', products: [{ name: 'Imported Item', pack_size: '5 kg', cost: 10, qty: 1 }],
});
const impA = await post(a, '/api/bulk/upsert-products', {
  vendor_name: 'Import Vendor', products: [{ name: 'Imported Item', pack_size: '5 kg', cost: 10, qty: 1 }],
});
t.check('importing the same item+vendor creates your OWN product, not a link to theirs',
  impA.data?.created_generics === 1 && impA.data?.reused_generics === 0,
  `created=${impA.data?.created_generics} reused=${impA.data?.reused_generics}`);
t.check('and your own supplier', impA.data?.supplier_created === true);

// ── The fuzzy vendor matcher does not disclose other businesses ──
const matchA = await post(a, '/api/suppliers/match', { name: 'Shared Vendor Name' });
t.check('matcher resolves to your own vendor row',
  matchA.data?.match?.id === supA.data.id, JSON.stringify(matchA.data));

// ── Stock takes are per business ─────────────────────────────────
await post(a, '/api/tables/inventory',
  { item_id: prodA.data.id, item_type: 'raw_material', item_name: 'Renamed By A', quantity: 5, unit: 'kg' });
await post(b, '/api/tables/inventory',
  { item_id: prodB.data.id, item_type: 'raw_material', item_name: 'Shared Product', quantity: 7, unit: 'kg' });
const takeA = await post(a, '/api/stock-take/start');
const takeB = await post(b, '/api/stock-take/start');
t.check('each stock take snapshots only its own inventory',
  (takeA.data?.items || []).every(i => i.item_id === prodA.data.id) &&
  (takeB.data?.items || []).every(i => i.item_id === prodB.data.id),
  `A=${(takeA.data?.items||[]).length} B=${(takeB.data?.items||[]).length}`);

await post(a, `/api/stock-take/${takeB.data.stock_take.id}/cancel`);
t.check('A cancelling B\'s stock take does nothing',
  (await get(b, '/api/stock-take/active')).data?.active !== null);

// ── Uploaded files are per business ──────────────────────────────
async function upload(j, text) {
  const fd = new FormData();
  fd.append('file', new Blob([text], { type: 'text/plain' }), 'note.txt');
  const res = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: { cookie: jarHeader(j) }, body: fd });
  return (await res.json()).key;
}
const keyB = await upload(b, 'B private invoice');
t.check('B can read its own upload', (await get(b, `/api/files/${keyB}`)).status === 200);
t.check('A cannot read B\'s upload -> 404', (await get(a, `/api/files/${keyB}`)).status === 404);
t.check('signed out cannot read it -> 401', (await get(jar(), `/api/files/${keyB}`)).status === 401);

// ── Analytics do not aggregate across businesses ─────────────────
const spendA = await get(a, '/api/spending-breakdown');
const spendB = await get(b, '/api/spending-breakdown');
t.check('spending breakdown answers per business',
  spendA.status === 200 && spendB.status === 200);
const vendorsA = (spendA.data?.by_vendor || []).map(v => v.vendor);
t.check('A\'s spending shows no vendor unique to B',
  !vendorsA.includes(B.name), JSON.stringify(vendorsA));
t.check('P&L answers per business', (await get(a, '/api/pnl')).status === 200);

// ── Admin routes are closed to ordinary owners ───────────────────
t.check('an owner cannot list businesses', (await get(a, '/api/admin/organizations')).status === 403);
t.check('an owner cannot create a business',
  (await post(a, '/api/admin/organizations',
    { name: 'Sneaky', owner_email: `sneak-${STAMP}@x.com`, owner_password: 'password-1234' })).status === 403);
t.check('an owner cannot view-as another business',
  (await post(a, '/api/admin/view-as', { org_id: orgB.data.organization.id })).status === 403);
t.check('an owner cannot reset another\'s password',
  (await post(a, '/api/admin/users/reset-password',
    { email: B.email, new_password: 'taken-over-123' })).status === 403);

// ── Super-admin view-as reaches the data, without the password ───
await post(admin, '/api/admin/view-as', { org_id: orgB.data.organization.id });
const adminSees = await get(admin, '/api/tables/suppliers');
t.check('view-as shows the customer\'s data',
  (adminSees.data?.data || []).some(r => r.id === supB.data.id));
const meViewing = await get(admin, '/api/auth/me');
t.check('while viewing, the operator is still THEMSELVES, not the customer',
  meViewing.data?.user?.is_super_admin === true && !!meViewing.data?.viewing_as);

// A customer changing their password must not disturb the operator's access —
// the whole reason view-as exists rather than logging in as them.
await post(b, '/api/auth/change-password',
  { current_password: B.password, new_password: 'b-changed-their-pw-1' });
const afterPwChange = await get(admin, '/api/tables/suppliers');
t.check('customer changing their password does not break view-as',
  (afterPwChange.data?.data || []).some(r => r.id === supB.data.id));

await post(admin, '/api/admin/view-as', { org_id: null });
const adminOwn = await get(admin, '/api/tables/suppliers');
t.check('exiting view-as returns the operator to their own data',
  !(adminOwn.data?.data || []).some(r => r.id === supB.data.id));

t.done();
