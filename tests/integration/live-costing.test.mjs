// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run dev:sandbox        (in another terminal)
//   node tests/integration/live-costing.test.mjs
//
// The owner's requirement, end to end: "Margherita costs me $3. Flour goes up.
// Once all my old flour has been used, the finished product's cost increases on
// its own, without staff touching anything on recipes or finished products."
//
// Everything here goes through the real API and the REAL shipped frontend —
// products, recipes and finished products are created through the routes, then
// read back and costed by public/static/utils.js. Nothing is re-saved between
// the two measurements; only the stock level moves.
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
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(jarHeader(j) ? { cookie: jarHeader(j) } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  absorb(j, res);
  let data = null; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

const t = suite('integration/live-costing');

try { await fetch(`${BASE}/api/auth/me`); } catch (_) {
  console.log(`\n  no server at ${BASE} — skipping (run: npm run dev:sandbox)\n`);
  process.exit(0);
}

const { buildLiveCostIndex } = loadBrowserModule(['utils.js'], ['buildLiveCostIndex']);

// ── setup ───────────────────────────────────────────────────────
const admin = jar();
const ADMIN = { email: `lc-admin-${STAMP}@test.local`, password: 'lc-admin-pw-1' };
const boot = await call(admin, 'POST', '/api/auth/bootstrap', { ...ADMIN, name: 'LC IT' });
if (boot.status === 409) {
  const login = await call(admin, 'POST', '/api/auth/login',
    { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' });
  if (login.status !== 200) { console.log('\n  no super-admin session — skipping\n'); process.exit(0); }
} else if (boot.status === 200) {
  await call(admin, 'POST', '/api/auth/login', ADMIN);
}

const ORG = { name: `LC IT ${STAMP}`, email: `lc-${STAMP}@test.local`, password: 'lc-password-1' };
const org = await call(admin, 'POST', '/api/admin/organizations',
  { name: ORG.name, owner_email: ORG.email, owner_password: ORG.password, account_type: 'restaurant' });
const orgId = org.data?.organization?.id || org.data?.id;
await call(admin, 'POST', `/api/admin/organizations/${orgId}/plan`, { plan: 'pro' });

const u = jar();
await call(u, 'POST', '/api/auth/login', { email: ORG.email, password: ORG.password });
t.check('business created and signed in', !!u.cookies.dm_session);

// ── a pizzeria: flour -> dough -> margherita ────────────────────
const flour = (await call(u, 'POST', '/api/tables/generic_products',
  { name: 'LC Flour', category: 'Other', base_unit: 'kg' })).data.id;

// Two purchases: 10 kg at $0.90/kg, then 10 kg at $1.80/kg.
await call(u, 'POST', '/api/tables/product_entries', {
  generic_product_id: flour, generic_product_name: 'LC Flour',
  purchase_date: '2026-06-01', pack_qty: 10, pack_unit: 'kg', qty_ordered: 1,
  cost: 9, cost_per_unit: 0.9,
});
await call(u, 'POST', '/api/tables/product_entries', {
  generic_product_id: flour, generic_product_name: 'LC Flour',
  purchase_date: '2026-07-01', pack_qty: 10, pack_unit: 'kg', qty_ordered: 1,
  cost: 18, cost_per_unit: 1.8,
});

const invRow = (await call(u, 'POST', '/api/tables/inventory', {
  item_id: flour, item_type: 'raw_material', item_name: 'LC Flour',
  category: 'Other', quantity: 15, unit: 'kg',
})).data.id;

const dough = (await call(u, 'POST', '/api/tables/recipes',
  { name: 'LC Dough', servings: 1, yield_unit: 'kg', total_cost: 0, production_mode: 'on_demand' })).data.id;
await call(u, 'POST', '/api/tables/recipe_items',
  { recipe_id: dough, product_id: flour, product_name: 'LC Flour', quantity: 1, unit: 'kg', line_cost: 0 });

const marg = (await call(u, 'POST', '/api/tables/finished_products',
  { name: 'LC Margherita', selling_price: 12, total_cost: 0 })).data.id;
await call(u, 'POST', '/api/tables/finished_product_items',
  { finished_product_id: marg, item_type: 'recipe', ref_id: dough, ref_name: 'LC Dough', quantity: 1, unit: 'kg', line_cost: 0 });

t.check('kitchen seeded', !!flour && !!dough && !!marg);

// Read everything back the way a page does, then cost it with the shipped code.
async function costNow() {
  const [g, e, inv, r, ri, fp, fi] = await Promise.all([
    call(u, 'GET', '/api/tables/generic_products?page=1&limit=500'),
    call(u, 'GET', '/api/tables/product_entries?page=1&limit=1000'),
    call(u, 'GET', '/api/tables/inventory?page=1&limit=500'),
    call(u, 'GET', '/api/tables/recipes?page=1&limit=500'),
    call(u, 'GET', '/api/tables/recipe_items?page=1&limit=1000'),
    call(u, 'GET', '/api/tables/finished_products?page=1&limit=500'),
    call(u, 'GET', '/api/tables/finished_product_items?page=1&limit=1000'),
  ]);
  return buildLiveCostIndex({
    generics: g.data?.data || [], entries: e.data?.data || [], inventory: inv.data?.data || [],
    recipes: r.data?.data || [], recipeItems: ri.data?.data || [],
    finishedProducts: fp.data?.data || [], fpItems: fi.data?.data || [],
  });
}

t.section('while the cheap flour lasts');
// 20 kg bought, 15 on hand => 5 consumed, still in the first (cheap) layer.
const before = await costNow();
t.check('flour $0.90/kg',      t.near(before.product.get(flour).cost_per_unit, 0.9),  `${before.product.get(flour).cost_per_unit}`);
t.check('dough $0.90',         t.near(before.recipe.get(dough).total_cost, 0.9),      `${before.recipe.get(dough).total_cost}`);
t.check('Margherita $0.90',    t.near(before.finished.get(marg).total_cost, 0.9),     `${before.finished.get(marg).total_cost}`);
t.check('margin 92.5%',        t.near(before.finished.get(marg).margin_pct, 92.5),    `${before.finished.get(marg).margin_pct}`);

t.section('stock is drawn down past the old layer — nothing else is touched');
// Only the inventory quantity changes. No recipe, no finished product is re-saved.
await call(u, 'PUT', `/api/tables/inventory/${invRow}`, {
  item_id: flour, item_type: 'raw_material', item_name: 'LC Flour',
  category: 'Other', quantity: 5, unit: 'kg',
});

const after = await costNow();
t.check('flour rolled over to $1.80/kg', t.near(after.product.get(flour).cost_per_unit, 1.8), `${after.product.get(flour).cost_per_unit}`);
t.check('dough followed to $1.80',       t.near(after.recipe.get(dough).total_cost, 1.8),     `${after.recipe.get(dough).total_cost}`);
t.check('MARGHERITA followed to $1.80',  t.near(after.finished.get(marg).total_cost, 1.8),    `${after.finished.get(marg).total_cost}`);
t.check('margin fell to 85%',            t.near(after.finished.get(marg).margin_pct, 85),     `${after.finished.get(marg).margin_pct}`);

t.section('and it happened without re-saving anything');
const savedRecipe = (await call(u, 'GET', '/api/tables/recipes?page=1&limit=500'))
  .data.data.find(x => x.id === dough);
const savedFp = (await call(u, 'GET', '/api/tables/finished_products?page=1&limit=500'))
  .data.data.find(x => x.id === marg);
t.check('the stored recipe snapshot is still the stale 0',
  Number(savedRecipe.total_cost) === 0, `${savedRecipe.total_cost}`);
t.check('the stored finished-product snapshot is still the stale 0',
  Number(savedFp.total_cost) === 0, `${savedFp.total_cost}`);
t.check('yet the live cost is right — so nothing reads those columns',
  t.near(after.finished.get(marg).total_cost, 1.8));

t.section('a new invoice at a higher price flows through on its own');
await call(u, 'POST', '/api/tables/product_entries', {
  generic_product_id: flour, generic_product_name: 'LC Flour',
  purchase_date: '2026-08-01', pack_qty: 10, pack_unit: 'kg', qty_ordered: 1,
  cost: 36, cost_per_unit: 3.6,
});
await call(u, 'PUT', `/api/tables/inventory/${invRow}`, {
  item_id: flour, item_type: 'raw_material', item_name: 'LC Flour',
  category: 'Other', quantity: 5, unit: 'kg',
});
const third = await costNow();
t.check('now on the $3.60 layer', t.near(third.product.get(flour).cost_per_unit, 3.6), `${third.product.get(flour).cost_per_unit}`);
t.check('Margherita is $3.60',    t.near(third.finished.get(marg).total_cost, 3.6),    `${third.finished.get(marg).total_cost}`);

t.section('voiding an invoice takes its price back out');
// Buy 10 kg more at a very high price, then void that purchase. The void must
// remove it from pricing entirely — the FIFO layer has to behave as though the
// purchase never happened.
const dear = (await call(u, 'POST', '/api/tables/product_entries', {
  generic_product_id: flour, generic_product_name: 'LC Flour',
  purchase_date: '2026-09-01', pack_qty: 10, pack_unit: 'kg', qty_ordered: 1,
  cost: 200, cost_per_unit: 20,
})).data.id;

await call(u, 'PUT', `/api/tables/inventory/${invRow}`, {
  item_id: flour, item_type: 'raw_material', item_name: 'LC Flour',
  category: 'Other', quantity: 5, unit: 'kg',
});
const withDear = await costNow();
t.check('while live, the $20 purchase is the active layer',
  t.near(withDear.product.get(flour).cost_per_unit, 20), `${withDear.product.get(flour).cost_per_unit}`);

await call(u, 'PATCH', `/api/tables/product_entries/${dear}`, { voided_at: new Date().toISOString() });
const afterVoid = await costNow();
t.check('once voided it stops pricing anything',
  !t.near(afterVoid.product.get(flour).cost_per_unit, 20),
  `${afterVoid.product.get(flour).cost_per_unit}`);
t.check('and the finished product follows it back down',
  !t.near(afterVoid.finished.get(marg).total_cost, 20),
  `${afterVoid.finished.get(marg).total_cost}`);
t.check('landing on the newest LIVE layer, $3.60',
  t.near(afterVoid.product.get(flour).cost_per_unit, 3.6),
  `${afterVoid.product.get(flour).cost_per_unit}`);

t.done();
