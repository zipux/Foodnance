// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run dev:sandbox        (in another terminal)
//   npm run test:prep
//
// Prep that nobody recorded can still be counted at a stock take.
//
// The count sheet used to be built from inventory rows alone. A kitchen that
// cooked a tub of ragù without pressing Produce Batch had no "ragù" row, so the
// sheet never asked for it — and the beef inside the tub read as missing, which
// pushed that period's food cost up by the whole value of the prep.
//
// Now every recipe without a tub is offered on the sheet at an expected quantity
// of zero. Counted above zero, submit creates the tub, logs it, marks the recipe
// made-ahead (so sales draw the tub first, exactly as after Produce Batch), and
// the P&L values it by what went into it. Left blank, nothing happens. A recipe
// marked 'to_order' ("made to order — never kept in stock") is left off.
//
// Self-contained: creates its own Pro restaurant per run.
import { suite } from '../helpers/assert.mjs';

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

const t = suite('integration/stock-take-prep');

try { await fetch(`${BASE}/api/auth/me`); } catch (_) {
  console.log(`\n  no server at ${BASE} — skipping (run: npm run dev:sandbox)\n`);
  process.exit(0);
}

// ── setup ───────────────────────────────────────────────────────
const admin = jar();
const ADMIN = { email: `prep-admin-${STAMP}@test.local`, password: 'prep-admin-pw-1' };
const boot = await call(admin, 'POST', '/api/auth/bootstrap', { ...ADMIN, name: 'Prep IT' });
if (boot.status === 409) {
  const login = await call(admin, 'POST', '/api/auth/login',
    { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' });
  if (login.status !== 200) { console.log('\n  no super-admin session — skipping\n'); process.exit(0); }
} else if (boot.status === 200) {
  await call(admin, 'POST', '/api/auth/login', ADMIN);
}
const ORG = { name: `Prep IT ${STAMP}`, email: `prep-${STAMP}@test.local`, password: 'prep-password-1' };
const org = await call(admin, 'POST', '/api/admin/organizations',
  { name: ORG.name, owner_email: ORG.email, owner_password: ORG.password, account_type: 'restaurant' });
const orgId = org.data?.organization?.id || org.data?.id;
await call(admin, 'POST', `/api/admin/organizations/${orgId}/plan`, { plan: 'pro' });
const u = jar();
await call(u, 'POST', '/api/auth/login', { email: ORG.email, password: ORG.password });
t.check('Pro restaurant created and signed in', !!u.cookies.dm_session);

const list = async (table) => (await call(u, 'GET', `/api/tables/${table}?limit=500`)).data?.data || [];

// Beef: 10 kg bought at $10/kg, all of it on the shelf as far as the app knows.
const beef = (await call(u, 'POST', '/api/tables/generic_products', { name: 'Prep Beef', category: 'Meat & Poultry', base_unit: 'kg' })).data.id;
await call(u, 'POST', '/api/tables/product_entries', { generic_product_id: beef, generic_product_name: 'Prep Beef',
  purchase_date: '2020-01-01', pack_qty: 10, pack_unit: 'kg', qty_ordered: 1, cost: 100, cost_per_unit: 10 });
await call(u, 'POST', '/api/tables/inventory', { item_id: beef, item_type: 'raw_material', item_name: 'Prep Beef', category: 'Meat & Poultry', quantity: 10, unit: 'kg' });

const mkRecipe = async (name, mode, yieldUnit = 'kg') => {
  const id = (await call(u, 'POST', '/api/tables/recipes', { name, servings: 5, yield_unit: yieldUnit, production_mode: mode })).data.id;
  // 4 kg of beef makes 5 of it, so one unit of the recipe holds $8.00 of beef.
  await call(u, 'POST', '/api/tables/recipe_items', { recipe_id: id, product_id: beef, product_name: 'Prep Beef', quantity: 4, unit: 'kg' });
  return id;
};
const ragu     = await mkRecipe('Prep Ragu', 'on_demand');       // cooked, never recorded
const stock    = await mkRecipe('Prep Stock', 'batched', 'L');   // made-ahead, no tub yet
const dressing = await mkRecipe('Prep Dressing', 'to_order');    // never kept in stock
const soffritto = await mkRecipe('Prep Soffritto', 'on_demand'); // will be left blank
const zeroed   = await mkRecipe('Prep Zeroed', 'on_demand');     // will be counted as 0
const pesto    = await mkRecipe('Prep Pesto', 'batched');        // already has a tub
await call(u, 'POST', '/api/tables/inventory', { item_id: pesto, item_type: 'batch', item_name: 'Prep Pesto', category: 'Batch', quantity: 2, unit: 'kg' });

// ── the count sheet ─────────────────────────────────────────────
t.section('the count sheet offers prep that has no tub');
const start = await call(u, 'POST', '/api/stock-take/start', {});
const takeId = start.data?.stock_take?.id;
const items  = start.data?.items || [];
const line   = (id) => items.filter(i => i.item_id === id);
t.check('stock take started', start.status === 201 && !!takeId, `${start.status}`);
t.check('the beef is on it, from inventory', line(beef).length === 1 && !!line(beef)[0].inventory_id && line(beef)[0].expected_qty === 10);
t.check('the pesto tub is on it once, from inventory', line(pesto).length === 1 && !!line(pesto)[0].inventory_id && line(pesto)[0].expected_qty === 2);
for (const [id, name] of [[ragu, 'ragu'], [stock, 'stock'], [soffritto, 'soffritto'], [zeroed, 'zeroed']]) {
  const l = line(id);
  t.check(`${name} (no tub) is offered: expected 0, type batch, no inventory row yet`,
    l.length === 1 && l[0].expected_qty === 0 && l[0].item_type === 'batch' && !l[0].inventory_id, JSON.stringify(l));
}
t.check('it is offered in the recipe\'s own yield unit', line(ragu)[0].unit === 'kg' && line(stock)[0].unit === 'L',
  `${line(ragu)[0]?.unit} / ${line(stock)[0]?.unit}`);
t.check('a recipe marked never-kept-in-stock is NOT on the sheet', line(dressing).length === 0);
t.check('total_items counts what is in stock, not the offered prep', start.data.stock_take.total_items === 2, `${start.data.stock_take.total_items}`);

// ── submit ──────────────────────────────────────────────────────
t.section('counting a tub creates it');
// The kitchen used 4 kg of beef for ragù: 6 kg left on the shelf, 3.2 kg of ragù in the fridge.
const sub = await call(u, 'POST', `/api/stock-take/${takeId}/submit`, { items: [
  { stock_take_item_id: line(beef)[0].id,   counted_qty: 6,   reason_code: 'usage', reason: 'Kitchen usage' },
  { stock_take_item_id: line(pesto)[0].id,  counted_qty: 2 },
  { stock_take_item_id: line(ragu)[0].id,   counted_qty: 3.2, reason_code: 'production', reason: 'Production / batch' },
  { stock_take_item_id: line(zeroed)[0].id, counted_qty: 0 },
  { stock_take_item_id: line(stock)[0].id,  counted_qty: null },
  { stock_take_item_id: line(soffritto)[0].id, counted_qty: null },
] });
t.check('submitted', sub.status === 200, `${sub.status} ${JSON.stringify(sub.data)}`);

const inv = await list('inventory');
const bin = (id) => inv.filter(r => r.item_id === id);
t.check('the ragù tub now exists: 3.2 kg, type batch', bin(ragu).length === 1 && bin(ragu)[0].quantity === 3.2 && bin(ragu)[0].unit === 'kg' && bin(ragu)[0].item_type === 'batch', JSON.stringify(bin(ragu)));
t.check('the beef is corrected to 6 kg', bin(beef)[0].quantity === 6);
t.check('the pesto tub is untouched and not duplicated', bin(pesto).length === 1 && bin(pesto)[0].quantity === 2);
t.check('a prep line left blank creates nothing', bin(stock).length === 0 && bin(soffritto).length === 0);
t.check('a prep line counted as zero creates nothing', bin(zeroed).length === 0);

const log = (await list('stock_log')).filter(l => l.item_id === ragu);
t.check('one stock movement records where the tub came from',
  log.length === 1 && log[0].change === 3.2 && log[0].reason_code === 'production' && log[0].stock_take_id === takeId && log[0].inventory_id === bin(ragu)[0].id,
  JSON.stringify(log));

const recipes = await list('recipes');
const mode = (id) => recipes.find(r => r.id === id)?.production_mode;
t.check('the counted recipe becomes made-ahead, like after Produce Batch', mode(ragu) === 'batched', mode(ragu));
t.check('recipes that were not counted keep their setting', mode(soffritto) === 'on_demand' && mode(zeroed) === 'on_demand' && mode(dressing) === 'to_order',
  `${mode(soffritto)} ${mode(zeroed)} ${mode(dressing)}`);

const saved = (await list('stock_take_items')).filter(i => i.stock_take_id === takeId);
const savedRagu = saved.find(i => i.item_id === ragu);
t.check('the count sheet line is linked to the new tub', savedRagu?.inventory_id === bin(ragu)[0].id && savedRagu?.counted_qty === 3.2 && savedRagu?.variance === 3.2);

// ── the money ───────────────────────────────────────────────────
t.section('the tub is valued by what went into it');
const now    = new Date();
const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
// Make this take the OPENING one, then count again for the closing.
await call(u, 'PATCH', `/api/tables/stock_takes/${takeId}`, { submitted_at: lastMonth.toISOString() });

const second = await call(u, 'POST', '/api/stock-take/start', {});
const items2 = second.data?.items || [];
const line2  = (id) => items2.filter(i => i.item_id === id);
t.check('next time the ragù is an ordinary line with its expected quantity',
  line2(ragu).length === 1 && !!line2(ragu)[0].inventory_id && line2(ragu)[0].expected_qty === 3.2, JSON.stringify(line2(ragu)));
t.check('recipes still without a tub are offered again', line2(soffritto).length === 1 && !line2(soffritto)[0].inventory_id);
await call(u, 'POST', `/api/stock-take/${second.data.stock_take.id}/submit`, { items: [
  { stock_take_item_id: line2(beef)[0].id, counted_qty: 6 },
  { stock_take_item_id: line2(ragu)[0].id, counted_qty: 3.2 },
  { stock_take_item_id: line2(pesto)[0].id, counted_qty: 2 },
] });

const pnl  = await call(u, 'GET', `/api/pnl?from=${period}&to=${period}`);
const cogs = pnl.data?.cogs || {};
// Beef 6 kg x $10 = $60. Ragù 3.2 kg and pesto 2 kg each hold $8.00 of beef per kg: $25.60 + $16.00.
const EXPECTED = 60 + 3.2 * 8 + 2 * 8;
t.check('true COGS is available', cogs.available === true, JSON.stringify(cogs).slice(0, 200));
t.check('closing stock includes the tub that was only ever counted ($101.60)', t.near(cogs.closing_food, EXPECTED, 0.05), `${cogs.closing_food}`);
t.check('opening stock is valued the same way', t.near(cogs.opening_food, EXPECTED, 0.05), `${cogs.opening_food}`);
// The whole point: 4 kg of beef went into ragù. Without the tub on the sheet the
// opening value would have been $60 + $16 = $76 — $25.60 of beef "missing".
t.check('and is not the $76.00 it was when the tub could not be counted', !t.near(cogs.opening_food, 76, 0.05), `${cogs.opening_food}`);

t.done();
