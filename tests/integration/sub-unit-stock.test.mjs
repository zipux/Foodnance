// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run build && npm run dev:sandbox     (in another terminal)
//   npm run test:sub-unit-stock
//
// Stock for a product bought by the pack (a case of 6 cans, 0.8 kg a can),
// on the two paths the SERVER owns:
//   · stock-take value: a bin counted in cans or kilos is priced from the case
//     price, not multiplied by it (12 cans at $36 a case is $72, not $432)
//   · sales import: a menu item written in cans, and a recipe written in grams,
//     both come off a bin counted in cases; a product with no can weight is
//     skipped with a warning naming what to fill in, and the import still lands
// The browser paths (Produce Batch, Pack Run, stock-in) are covered by
// tests/sub-unit-stock.test.mjs.
//
// Self-contained: creates its own business per run.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrowserModule } from '../helpers/browser-module.mjs';
import { suite } from '../helpers/assert.mjs';

const BASE  = process.env.TEST_BASE_URL || 'http://localhost:3000';
const STAMP = Date.now().toString(36);
const fixture = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'square-item-sales-sample.csv');

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

const t = suite('integration/sub-unit-stock');

try { await fetch(`${BASE}/api/auth/me`); } catch (_) {
  console.log(`\n  no server at ${BASE} — skipping (run: npm run dev:sandbox)\n`);
  process.exit(0);
}

// ── setup ───────────────────────────────────────────────────────
const admin = jar();
const login = await call(admin, 'POST', '/api/auth/login',
  { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' });
if (login.status !== 200) { console.log('\n  no super-admin session — skipping\n'); process.exit(0); }

const ORG = { name: `SubStock IT ${STAMP}`, email: `substock-${STAMP}@test.local`, password: 'substock-pw-1' };
const org = await call(admin, 'POST', '/api/admin/organizations',
  { name: ORG.name, owner_email: ORG.email, owner_password: ORG.password, account_type: 'restaurant' });
const orgId = org.data?.organization?.id || org.data?.id;
await call(admin, 'POST', `/api/admin/organizations/${orgId}/plan`, { plan: 'pro' });

const u = jar();
await call(u, 'POST', '/api/auth/login', { email: ORG.email, password: ORG.password });
t.check('business created and signed in', !!u.cookies.dm_session);

// Every product: bought by the case at $36, 6 cans to a case. What differs is
// the unit its bin is counted in, and whether the weight of a can is known.
const mk = async (name, binUnit, binQty, canKg) => {
  const p = (await call(u, 'POST', '/api/tables/generic_products', {
    name, category: 'Other', base_unit: binUnit,
    sub_unit_name: 'can', sub_unit_qty: 6, avg_weight_per_unit: canKg,
  })).data.id;
  await call(u, 'POST', '/api/tables/product_entries', {
    generic_product_id: p, generic_product_name: name, purchase_date: '2020-01-01',
    pack_qty: 1, pack_unit: 'case', qty_ordered: 10, cost: 360, cost_per_unit: 36,
  });
  await call(u, 'POST', '/api/tables/inventory',
    { item_id: p, item_type: 'raw_material', item_name: name, category: 'Other', quantity: binQty, unit: binUnit });
  return p;
};
const tomato = await mk('SS Tomato', 'case', 10, 0.8);    // counted in cases
const olives = await mk('SS Olives', 'can', 12, 0.8);     // counted in cans
const capers = await mk('SS Capers', 'kg', 4.8, 0.8);     // counted by weight
const beans  = await mk('SS Beans', 'case', 10, null);    // can weight never filled in
t.check('four products seeded', !!tomato && !!olives && !!capers && !!beans);

const qtyOf = async (id) => {
  const inv = await call(u, 'GET', '/api/tables/inventory?page=1&limit=100');
  const row = (inv.data?.data || []).find(r => r.item_id === id);
  return row ? Number(row.quantity) : null;
};

// ── stock-take value ────────────────────────────────────────────
t.section('stock-take value');
async function countAndSubmit(counts) {
  const start  = await call(u, 'POST', '/api/stock-take/start', {});
  const takeId = start.data?.stock_take?.id;
  if (!takeId) return null;
  const payload = (start.data?.items || [])
    .filter(i => counts[i.item_id] !== undefined)
    .map(i => ({ stock_take_item_id: i.id, counted_qty: counts[i.item_id], reason_code: 'stock_take' }));
  const res = await call(u, 'POST', `/api/stock-take/${takeId}/submit`, { items: payload });
  return res.status === 200 ? takeId : null;
}
const counts = { [tomato]: 10, [olives]: 12, [capers]: 4.8, [beans]: 10 };
const openingId = await countAndSubmit(counts);
const now       = new Date();
const period    = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
await call(u, 'PATCH', `/api/tables/stock_takes/${openingId}`, { submitted_at: lastMonth.toISOString() });
const closingId = await countAndSubmit(counts);
t.check('two takes submitted', !!openingId && !!closingId);

const cogs = (await call(u, 'GET', `/api/pnl?from=${period}&to=${period}`)).data?.cogs || {};
t.check('true COGS is available', cogs.available === true, JSON.stringify(cogs));
// 10 cases $360 · 12 cans = 2 cases $72 · 4.8 kg = 6 cans = 1 case $36 · 10 cases $360
const EXPECTED = 360 + 72 + 36 + 360;
const BEFORE   = 360 + 12 * 36 + 4.8 * 36 + 360;   // the bare multiply this replaces
t.check(`closing stock is $${EXPECTED}`, t.near(cogs.closing_food, EXPECTED, 0.05), `${cogs.closing_food}`);
t.check(`and not the $${BEFORE} a count × case price gave`, !t.near(cogs.closing_food, BEFORE, 0.05));
t.check('opening stock is valued the same way', t.near(cogs.opening_food, EXPECTED, 0.05), `${cogs.opening_food}`);

// ── sales import ────────────────────────────────────────────────
t.section('sales import');
// One pizza: 2 cans of tomato straight on, 0.5 kg of a sauce made to order
// (400 g of tomato per kg of sauce), 1 can of olives, 80 g of capers, and
// 100 g of beans — which cannot be converted, having no can weight.
const sauce = (await call(u, 'POST', '/api/tables/recipes',
  { name: 'SS Sauce', servings: 1, yield_unit: 'kg', total_cost: 0, production_mode: 'on_demand' })).data.id;
await call(u, 'POST', '/api/tables/recipe_items',
  { recipe_id: sauce, product_id: tomato, product_name: 'SS Tomato', quantity: 400, unit: 'g', line_cost: 0 });
const pizza = (await call(u, 'POST', '/api/tables/finished_products',
  { name: 'Margherita Pizza', selling_price: 12, total_cost: 0 })).data.id;
const line = (type, ref, name, q, unit) => call(u, 'POST', '/api/tables/finished_product_items',
  { finished_product_id: pizza, item_type: type, ref_id: ref, ref_name: name, quantity: q, unit, line_cost: 0 });
await line('product', tomato, 'SS Tomato', 2, 'can');
await line('recipe',  sauce,  'SS Sauce', 0.5, 'kg');
await line('product', olives, 'SS Olives', 1, 'can');
await line('product', capers, 'SS Capers', 80, 'g');
await line('product', beans,  'SS Beans', 100, 'g');

const { parsePosCsv } = loadBrowserModule(['pos-parse.js'], ['parsePosCsv'], { window: {} });
const parsed = parsePosCsv(readFileSync(fixture, 'utf8'), 'square.csv');
const sold = parsed.items.find(i => i.pos_item_name === 'Margherita Pizza').qty;
t.check('the file sells 5 pizzas', sold === 5, `${sold}`);

const draft = await call(u, 'POST', '/api/pos-imports', { parsed, content_hash: 'ss-' + STAMP });
t.check('draft created, pizza matched by name', draft.status === 200
  && draft.data.items.find(i => i.pos_item_name === 'Margherita Pizza')?.target_id === pizza, `${draft.status}`);
const importId = draft.data.import_id;

const preview = await call(u, 'POST', `/api/pos-imports/${importId}/preview`, { items: draft.data.items });
const warnText = JSON.stringify(preview.data?.warnings || preview.data || {});
t.check('the preview warns about beans, and says what to fill in',
  /SS Beans/.test(warnText) && /weight of one can/.test(warnText), warnText.slice(0, 300));
t.check('it does not warn about the three that convert',
  !/SS Tomato|SS Olives|SS Capers/.test(JSON.stringify(preview.data?.warnings || [])));

const commit = await call(u, 'POST', `/api/pos-imports/${importId}/commit`, { items: draft.data.items, deplete: true });
t.check('the import lands despite the one it could not convert', commit.status === 200,
  `${commit.status} ${JSON.stringify(commit.data?.error)}`);

// Tomato: 5 × 2 cans = 10 cans, plus 5 × 0.5 kg sauce × 400 g = 1000 g = 1.25 cans.
// 11.25 cans ÷ 6 = 1.875 cases off a bin of 10.
t.check('tomato, counted in cases: 10 → 8.125', t.near(await qtyOf(tomato), 8.125, 1e-5), `${await qtyOf(tomato)}`);
t.check('and not the 10 → 0 a bare "10 cans = 10 cases" would give', (await qtyOf(tomato)) > 8);
t.check('olives, counted in cans: 12 → 7', t.near(await qtyOf(olives), 7, 1e-5), `${await qtyOf(olives)}`);
t.check('capers, counted in kg: 4.8 → 4.4', t.near(await qtyOf(capers), 4.4, 1e-5), `${await qtyOf(capers)}`);
t.check('beans are left alone rather than guessed', t.near(await qtyOf(beans), 10, 1e-9), `${await qtyOf(beans)}`);

t.section('filling in the can weight is all it takes');
await call(u, 'POST', `/api/pos-imports/${importId}/void`, { reason: 'test' });
t.check('voiding puts the tomato back', t.near(await qtyOf(tomato), 10, 1e-5), `${await qtyOf(tomato)}`);
await call(u, 'PATCH', `/api/tables/generic_products/${beans}`, { avg_weight_per_unit: 0.4 });
const again = await call(u, 'POST', '/api/pos-imports', { parsed, content_hash: 'ss2-' + STAMP, force: true });
const againCommit = await call(u, 'POST', `/api/pos-imports/${again.data.import_id}/commit`,
  { items: again.data.items, deplete: true });
t.check('second import lands', againCommit.status === 200, `${againCommit.status} ${JSON.stringify(againCommit.data?.error)}`);
// 5 × 100 g = 500 g = 1.25 cans of 0.4 kg = 0.208333 cases.
t.check('beans now come off: 10 → 9.791667', t.near(await qtyOf(beans), 10 - 1.25 / 6, 1e-5), `${await qtyOf(beans)}`);
t.check('no unit warning is left', !/SS Beans/.test(JSON.stringify(againCommit.data?.warnings || [])));

t.done();
