// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run dev:sandbox        (in another terminal)
//   npm run test:same-as
//
// "Same as …?" is asked once. After the customer answers "Use it", the
// supplier's wording is remembered (product_aliases) and the import files the
// line by itself — so the review screen must say where it goes, not ask again.
// Also proves the check and the import agree on where a remembered line lands.
import { suite } from '../helpers/assert.mjs';

const BASE  = process.env.TEST_BASE_URL || 'http://localhost:3000';
const STAMP = Date.now().toString(36);

function jar() { return { cookies: {} }; }
async function call(j, method, path, body) {
  const cookie = Object.entries(j.cookies).filter(([, v]) => v !== '').map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const line of raw) { const pair = line.split(';')[0]; const i = pair.indexOf('='); if (i > 0) j.cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim(); }
  let data = null; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}
const post = (j, p, b) => call(j, 'POST', p, b);
const get  = (j, p)    => call(j, 'GET', p);

try { await fetch(`${BASE}/api/auth/me`); }
catch (_) { console.log(`\n  no server at ${BASE} — skipping (run: npm run dev:sandbox)\n`); process.exit(0); }

const t = suite('integration/same-as-remembered');

const admin = jar();
const login = await post(admin, '/api/auth/login', { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' });
if (login.status !== 200) { console.log('\n  no super-admin session available — skipping\n'); process.exit(0); }

async function mkOrg(tag) {
  const o = { name: `SameAs ${tag} ${STAMP}`, email: `sameas-${tag}-${STAMP}@test.local`, password: 'same-as-pw-1' };
  const created = await post(admin, '/api/admin/organizations',
    { name: o.name, owner_email: o.email, owner_password: o.password, account_type: 'restaurant' });
  const j = jar();
  await post(j, '/api/auth/login', { email: o.email, password: o.password });
  return { j, id: created.data?.organization?.id };
}
const own = (await mkOrg('a')).j;
const other = (await mkOrg('b')).j;

const mk = async (j, table, row) => { const r = await post(j, `/api/tables/${table}`, row); return r.data?.data?.id || r.data?.id; };
const beef     = await mk(own, 'generic_products', { name: 'Ground Beef', category: 'Meat & Poultry', base_unit: 'kg' });
const supplier = await mk(own, 'suppliers', { name: 'Harbour Meats' });
const second   = await mk(own, 'suppliers', { name: 'Cascade Dairy' });
t.check('a product and two suppliers exist', !!beef && !!supplier && !!second);

const ask = async (j, names, vendor) =>
  (await post(j, '/api/products/match', vendor === undefined ? { names } : { names, vendor_name: vendor })).data?.results || {};

// ── before any answer ───────────────────────────────────────────
t.section('first invoice: the question is asked');
let r = await ask(own, ['Lean Ground Beef', 'Ground Beef', 'Dragon Fruit'], 'Harbour Meats');
t.check('a near name is asked about', r['Lean Ground Beef']?.decision === 'suggest' && r['Lean Ground Beef']?.match?.id === beef,
  JSON.stringify(r['Lean Ground Beef']));
t.check('the exact name needs no question', r['Ground Beef']?.decision === 'none');
t.check('an unrelated name needs no question', r['Dragon Fruit']?.decision === 'none', JSON.stringify(r['Dragon Fruit']));

// ── the customer answers "Use it" and approves ──────────────────
// What the review screen saves on approval: the wording, for this supplier.
await post(own, '/api/tables/product_aliases', { alias_name: 'Lean Ground Beef', generic_product_id: beef, supplier_id: supplier });

t.section('next invoice from the same supplier: not asked again');
r = await ask(own, ['Lean Ground Beef'], 'Harbour Meats');
t.check('the wording is reported as remembered', r['Lean Ground Beef']?.decision === 'remembered', JSON.stringify(r['Lean Ground Beef']));
t.check('with the product it files under', r['Lean Ground Beef']?.match?.id === beef && r['Lean Ground Beef']?.match?.name === 'Ground Beef');
r = await ask(own, ['  lean ground beef '], 'Harbour Meats');
t.check('case and spaces in the wording do not matter', Object.values(r)[0]?.decision === 'remembered', JSON.stringify(r));
r = await ask(own, ['Lean Ground Beef'], 'HARBOUR MEATS');
t.check('nor does the supplier name being written in capitals', r['Lean Ground Beef']?.decision === 'remembered', JSON.stringify(r));
r = await ask(own, ['Lean Ground Beef'], 'Harbour Meat');
t.check('nor a near-identical supplier name (the import treats it as the same supplier)',
  r['Lean Ground Beef']?.decision === 'remembered', JSON.stringify(r));

t.section('the memory is per supplier');
r = await ask(own, ['Lean Ground Beef'], 'Cascade Dairy');
t.check('another supplier is still asked', r['Lean Ground Beef']?.decision === 'suggest', JSON.stringify(r['Lean Ground Beef']));
r = await ask(own, ['Lean Ground Beef'], 'Somebody New');
t.check('so is a supplier not seen before', r['Lean Ground Beef']?.decision === 'suggest');
r = await ask(own, ['Lean Ground Beef']);
t.check('and a request that names no supplier (as before this change)', r['Lean Ground Beef']?.decision === 'suggest');

t.section('a wording remembered for every supplier');
await post(own, '/api/tables/product_aliases', { alias_name: 'Minced Beef', generic_product_id: beef });
r = await ask(own, ['Minced Beef'], 'Cascade Dairy');
t.check('is remembered whoever the supplier is', r['Minced Beef']?.decision === 'remembered' && r['Minced Beef']?.match?.id === beef, JSON.stringify(r));
r = await ask(own, ['Minced Beef']);
t.check('and with no supplier named', r['Minced Beef']?.decision === 'remembered');

// ── the check and the import agree ──────────────────────────────
t.section('the import files the line where the screen said');
const bulk = await post(own, '/api/bulk/upsert-products', {
  vendor_name: 'Harbour Meats',
  products: [{ name: 'Lean Ground Beef', pack_size: '5 kg', qty: 2, unit_price: 40, cost: 80, invoice_ref: 'HM-1', invoice_date: '2026-10-01' }],
});
t.check('the import succeeded', bulk.status === 200, `${bulk.status} ${JSON.stringify(bulk.data?.error)}`);
const entries = (await get(own, '/api/tables/product_entries?page=1&limit=100')).data?.data || [];
const e = entries.find(x => x.invoice_ref === 'HM-1');
t.check('under Ground Beef, not a new product', e?.generic_product_id === beef, JSON.stringify(e && { id: e.generic_product_id, name: e.generic_product_name }));
const products = (await get(own, '/api/tables/generic_products?page=1&limit=100')).data?.data || [];
t.check('no "Lean Ground Beef" product was created', !products.some(p => p.name === 'Lean Ground Beef'));

// ── an archived product is not a destination ────────────────────
t.section('an archived product is forgotten');
const kale = await mk(own, 'generic_products', { name: 'Kale', category: 'Produce', base_unit: 'kg' });
await post(own, '/api/tables/product_aliases', { alias_name: 'Curly Green Kale Bunch', generic_product_id: kale, supplier_id: supplier });
r = await ask(own, ['Curly Green Kale Bunch'], 'Harbour Meats');
t.check('remembered while the product is live', r['Curly Green Kale Bunch']?.decision === 'remembered');
await call(own, 'DELETE', `/api/tables/generic_products/${kale}`);
r = await ask(own, ['Curly Green Kale Bunch'], 'Harbour Meats');
t.check('not once it is archived', r['Curly Green Kale Bunch']?.decision !== 'remembered', JSON.stringify(r));

// ── isolation ───────────────────────────────────────────────────
t.section('another business learns nothing from it');
r = await ask(other, ['Lean Ground Beef', 'Minced Beef'], 'Harbour Meats');
t.check('its wordings are not remembered there',
  r['Lean Ground Beef']?.decision === 'none' && r['Minced Beef']?.decision === 'none', JSON.stringify(r));

t.done();
