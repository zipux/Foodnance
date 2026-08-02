// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run dev:sandbox        (in another terminal)
//   node tests/integration/finished-product-costing.test.mjs
//
// Proves a raw product costs correctly on the Finished Products form.
//
// The bug this guards: finished-products.js derived pack shape by parsing a
// `pack_size` string that product_entries has never had (schema 0001 stores
// pack_qty + pack_unit as columns). Every product therefore came out as one
// nameless 'unit' priced at the whole LINE total — so "1 each of Cola" and
// "100 g of Basil" either refused to convert or silently charged the case price.
//
// This runs the REAL shipped frontend over REAL rows from the API: products are
// created through the routes, read back the way the page reads them, then put
// through the page's own FIFO selection, pack-fact derivation and line costing.
//
// Self-contained: creates its own business per run.
import { suite } from '../helpers/assert.mjs';
import { loadBrowserModule } from '../helpers/browser-module.mjs';

const BASE  = process.env.TEST_BASE_URL || 'http://localhost:3000';
const STAMP = Date.now().toString(36);

function jar() { return { cookies: {} }; }
function jarHeader(j) {
  const p = Object.entries(j?.cookies || {}).filter(([, v]) => v !== '');
  return p.length ? p.map(([k, v]) => `${k}=${v}`).join('; ') : '';
}
function absorb(j, res) {
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  for (const line of raw) {
    const [pair] = String(line).split(';');
    const i = pair.indexOf('='); if (i < 0) continue;
    j.cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
}
async function call(j, method, path, body) {
  const cookie = jarHeader(j);
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  absorb(j, res);
  let data = null; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

const t = suite('integration/finished-product-costing');

try {
  await fetch(`${BASE}/api/auth/me`);
} catch (_) {
  console.log(`\n  no server at ${BASE} — skipping (run: npm run dev:sandbox)\n`);
  process.exit(0);
}

// ── the shipped frontend, loaded for real ───────────────────────
const fe = loadBrowserModule(
  ['utils.js', 'finished-products.js'],
  ['entryPackFacts', 'fifoActiveEntryIn', 'calcFpProductLineCost',
   '_fpUnitsCompatible', 'fp_conversionFactor'],
);

// ── setup ───────────────────────────────────────────────────────
const admin = jar();
const ADMIN = { email: `fpc-admin-${STAMP}@test.local`, password: 'fpc-admin-pw-1' };
const boot = await call(admin, 'POST', '/api/auth/bootstrap', { ...ADMIN, name: 'FPC IT' });
if (boot.status === 409) {
  const login = await call(admin, 'POST', '/api/auth/login',
    { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' });
  if (login.status !== 200) {
    console.log('\n  no super-admin session available — skipping\n');
    process.exit(0);
  }
} else if (boot.status === 200) {
  await call(admin, 'POST', '/api/auth/login', ADMIN);
}

const ORG = { name: `FPC IT ${STAMP}`, email: `fpc-${STAMP}@test.local`, password: 'fpc-password-1' };
const org = await call(admin, 'POST', '/api/admin/organizations',
  { name: ORG.name, owner_email: ORG.email, owner_password: ORG.password, account_type: 'restaurant' });
const orgId = org.data?.organization?.id || org.data?.id;
await call(admin, 'POST', `/api/admin/organizations/${orgId}/plan`, { plan: 'pro' });

const u = jar();
await call(u, 'POST', '/api/auth/login', { email: ORG.email, password: ORG.password });
t.check('business created and signed in', !!u.cookies.dm_session);

// ── the three cases from the bug report ─────────────────────────
async function seed(name, baseUnit, entry) {
  const p = await call(u, 'POST', '/api/tables/generic_products',
    { name, category: 'Other', base_unit: baseUnit });
  const id = p.data.id;
  await call(u, 'POST', '/api/tables/product_entries', {
    generic_product_id: id, generic_product_name: name,
    purchase_date: '2026-07-01', ...entry,
  });
  return id;
}

// Basil: one 5 kg case at $22.50 -> $4.50/kg.
const basil = await seed('IT Basil', 'kg',
  { pack_qty: 5, pack_unit: 'kg', qty_ordered: 1, cost: 22.5, cost_per_unit: 4.5 });
// Cola: a 24-can case at $20.40 -> $0.85 each. The reported case.
const cola = await seed('IT Cola 355ml Can', 'each',
  { pack_qty: 24, pack_unit: 'each', qty_ordered: 1, cost: 20.4, cost_per_unit: 0.85 });
// Potato: FIVE 10 kg sacks at $165 total -> $3.30/kg, NOT $16.50.
const potato = await seed('IT Potato', 'kg',
  { pack_qty: 10, pack_unit: 'kg', qty_ordered: 5, cost: 165, cost_per_unit: 3.3 });

t.check('three products seeded', !!basil && !!cola && !!potato);

// ── read them back exactly as the page does ─────────────────────
const generics = (await call(u, 'GET', '/api/tables/generic_products?page=1&limit=500')).data?.data || [];
const entries  = (await call(u, 'GET', '/api/tables/product_entries?page=1&limit=1000')).data?.data || [];
const invRows  = (await call(u, 'GET', '/api/tables/inventory?page=1&limit=500')).data?.data || [];

// Mirrors loadCatalogues() in finished-products.js.
function pageProduct(id) {
  const g = generics.find(x => x.id === id);
  const mine = entries.filter(e => e.generic_product_id === id)
    .sort((a, b) => (a.purchase_date || '') > (b.purchase_date || '') ? 1 : -1);
  const inv    = invRows.find(r => r.item_id === id && r.item_type === 'raw_material');
  const invQty = parseFloat(inv?.quantity) || 0;
  const avgWKg = g.avg_weight_per_unit != null ? parseFloat(g.avg_weight_per_unit) : null;
  const active = fe.fifoActiveEntryIn(mine, invQty, String(inv?.unit || g.base_unit || '').trim(), avgWKg);
  const facts  = fe.entryPackFacts(active);
  return {
    ref_id: id, ref_name: g.name,
    unit_cost: facts.cost_per_unit, pack_unit: facts.pack_unit, pack_qty: facts.pack_qty,
    sub_unit_name: g.sub_unit_name || '', sub_unit_qty: g.sub_unit_qty || 0,
    avg_weight: avgWKg,
  };
}

t.section('the API really does return columns, not a pack_size string');
const rawEntry = entries.find(e => e.generic_product_id === basil);
t.check('pack_unit column present', rawEntry?.pack_unit === 'kg', JSON.stringify(rawEntry?.pack_unit));
t.check('no pack_size field on the row', rawEntry?.pack_size === undefined,
  `got ${JSON.stringify(rawEntry?.pack_size)}`);

t.section('pack unit is the real one, never the placeholder "unit"');
for (const [label, id, want] of [['Basil', basil, 'kg'], ['Cola', cola, 'each'], ['Potato', potato, 'kg']]) {
  const p = pageProduct(id);
  t.check(`${label} pack unit is ${want}`, p.pack_unit === want, p.pack_unit);
  t.check(`${label} is not the placeholder`, p.pack_unit !== 'unit', p.pack_unit);
}

t.section('unit price — the line total is divided by pack_qty x qty_ordered');
t.check('Basil $4.50/kg',   t.near(pageProduct(basil).unit_cost, 4.5),   `${pageProduct(basil).unit_cost}`);
t.check('Cola $0.85/each',  t.near(pageProduct(cola).unit_cost, 0.85),  `${pageProduct(cola).unit_cost}`);
t.check('Potato $3.30/kg',  t.near(pageProduct(potato).unit_cost, 3.3), `${pageProduct(potato).unit_cost}`);
t.check('Potato is NOT the per-pack $16.50',
  !t.near(pageProduct(potato).unit_cost, 16.5), `${pageProduct(potato).unit_cost}`);

t.section('the reported failures now convert instead of erroring');
const colaP  = pageProduct(cola);
const basilP = pageProduct(basil);
t.check('Cola: "each" is an allowed unit',
  fe._fpUnitsCompatible(colaP.pack_unit, 'each', true), `pack unit ${colaP.pack_unit}`);
t.check('Basil: "g" is an allowed unit',
  fe._fpUnitsCompatible(basilP.pack_unit, 'g', true), `pack unit ${basilP.pack_unit}`);
t.check('Basil: "g" needs no average weight now it is a weight-to-weight step',
  fe.fp_conversionFactor(basilP.pack_unit, 'g', null) !== null,
  `factor ${fe.fp_conversionFactor(basilP.pack_unit, 'g', null)}`);

t.section('line cost — the numbers a user would see');
const lineCost = (p, quantity, unit) => fe.calcFpProductLineCost({ ...p, quantity, unit });
t.check('1 each of Cola = $0.85',   t.near(lineCost(colaP, 1, 'each'), 0.85),  `${lineCost(colaP, 1, 'each')}`);
t.check('2 each of Cola = $1.70',   t.near(lineCost(colaP, 2, 'each'), 1.7),   `${lineCost(colaP, 2, 'each')}`);
t.check('100 g of Basil = $0.45',   t.near(lineCost(basilP, 100, 'g'), 0.45),  `${lineCost(basilP, 100, 'g')}`);
t.check('0.5 kg of Basil = $2.25',  t.near(lineCost(basilP, 0.5, 'kg'), 2.25), `${lineCost(basilP, 0.5, 'kg')}`);
t.check('2 kg of Potato = $6.60',   t.near(lineCost(pageProduct(potato), 2, 'kg'), 6.6),
  `${lineCost(pageProduct(potato), 2, 'kg')}`);
t.check('no line is uncostable', [
  lineCost(colaP, 1, 'each'), lineCost(basilP, 100, 'g'), lineCost(pageProduct(potato), 2, 'kg'),
].every(v => v !== null));

t.section('a genuinely impossible conversion is still refused');
t.check('Cola by the litre is still blocked',
  !fe._fpUnitsCompatible(colaP.pack_unit, 'ml', true),
  'each->ml must not silently convert');
t.check('and costs out as null, not a wrong number',
  lineCost(colaP, 1, 'ml') === null, `${lineCost(colaP, 1, 'ml')}`);

t.done();
