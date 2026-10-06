// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run build && npm run dev:sandbox     (in another terminal; 0063 applied locally)
//   npm run test:waste
//
// Record waste and Recount, the two things Adjust Stock became for restaurants:
//   · waste only removes, only for a waste reason, and subtracts from whatever
//     is on the shelf at that moment
//   · a recount sets one bin to what was counted and is saved as a one-item
//     count in Past Counts
//   · a recount never becomes a month's opening or closing count in the P&L
//   · neither reaches another business, and both are Pro
//
// Self-contained: creates its own businesses per run.
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

const t = suite('integration/waste-recount');
try { await fetch(`${BASE}/api/auth/me`); } catch (_) {
  console.log(`\n  no server at ${BASE} — skipping (run: npm run dev:sandbox)\n`); process.exit(0);
}
const admin = jar();
const login = await call(admin, 'POST', '/api/auth/login', { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' });
if (login.status !== 200) { console.log('\n  no super-admin session — skipping\n'); process.exit(0); }
async function business(tag, plan) {
  const o = { name: `Waste ${tag} ${STAMP}`, email: `waste-${tag}-${STAMP}@test.local`, password: 'waste-pw-1' };
  const org = await call(admin, 'POST', '/api/admin/organizations',
    { name: o.name, owner_email: o.email, owner_password: o.password, account_type: 'restaurant' });
  if (plan === 'pro') await call(admin, 'POST', `/api/admin/organizations/${org.data.organization.id}/plan`, { plan: 'pro' });
  const j = jar();
  await call(j, 'POST', '/api/auth/login', { email: o.email, password: o.password });
  return j;
}
const u = await business('a', 'pro');
const other = await business('b', 'pro');
const essential = await business('c', 'essential');
t.check('three businesses signed in', !!u.cookies.dm_session && !!other.cookies.dm_session && !!essential.cookies.dm_session);

// 10 kg of flour at $2/kg.
const flour = (await call(u, 'POST', '/api/tables/generic_products', { name: 'WR Flour', category: 'Dry Goods & Pantry', base_unit: 'kg' })).data.id;
await call(u, 'POST', '/api/tables/product_entries', { generic_product_id: flour, generic_product_name: 'WR Flour',
  purchase_date: '2020-01-01', pack_qty: 10, pack_unit: 'kg', qty_ordered: 1, cost: 20, cost_per_unit: 2 });
const bin = (await call(u, 'POST', '/api/tables/inventory',
  { item_id: flour, item_type: 'raw_material', item_name: 'WR Flour', category: 'Dry Goods & Pantry', quantity: 10, unit: 'kg' })).data.id;
const shelf = async () => Number((await call(u, 'GET', `/api/tables/inventory/${bin}`)).data.quantity);
const log = async () => ((await call(u, 'GET', '/api/tables/stock_log?page=1&limit=50')).data?.data || []).filter(l => l.inventory_id === bin);
const waste   = (body, j = u) => call(j, 'POST', `/api/inventory/${bin}/waste`, body);
const recount = (body, j = u) => call(j, 'POST', `/api/inventory/${bin}/recount`, body);

// Two full counts first, so the P&L has a month to bracket.
async function fullCount(qty) {
  const start = await call(u, 'POST', '/api/stock-take/start', {});
  const id = start.data?.stock_take?.id;
  const items = (start.data?.items || []).filter(i => i.item_id === flour).map(i => ({ stock_take_item_id: i.id, counted_qty: qty }));
  return (await call(u, 'POST', `/api/stock-take/${id}/submit`, { items })).status === 200 ? id : null;
}
const opening = await fullCount(10);
const now = new Date();
const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
await call(u, 'PATCH', `/api/tables/stock_takes/${opening}`,
  { submitted_at: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)).toISOString() });
const closing = await fullCount(10);
const cogs = async () => (await call(u, 'GET', `/api/pnl?from=${period}&to=${period}`)).data?.cogs || {};
const baseline = await cogs();
t.check('the month is bracketed by two full counts, closing stock $20', baseline.available === true && t.near(baseline.closing_food, 20, 0.01), JSON.stringify(baseline));

t.section('record waste');
const w1 = await waste({ qty: 1.5, reason_code: 'spillage', note: 'Tray dropped' });
t.check('1.5 kg of spillage comes off: 10 → 8.5', w1.status === 200 && t.near(await shelf(), 8.5, 1e-9), JSON.stringify(w1.data));
const line = (await log()).find(l => Number(l.change) === -1.5) || {};
t.check('logged as waste, with its reason and note', line.reason === 'Spillage / waste' && line.reason_code === 'spillage' && line.note === 'Tray dropped', JSON.stringify(line));
t.check('menu testing is a reason', (await waste({ qty: 0.5, reason_code: 'menu_testing' })).status === 200 && t.near(await shelf(), 8, 1e-9));
t.check('it subtracts from what is there NOW, whatever the page last saw',
  (await call(u, 'PATCH', `/api/tables/inventory/${bin}`, { quantity: 20 })).status === 200
  && (await waste({ qty: 1, reason_code: 'breakage' })).data.quantity === 19 && t.near(await shelf(), 19, 1e-9));

t.section('waste cannot be used for anything else');
for (const [what, body] of [
  ['nothing', {}], ['zero', { qty: 0, reason_code: 'spillage' }], ['a negative amount (adding stock)', { qty: -5, reason_code: 'spillage' }],
  ['not a number', { qty: 'lots', reason_code: 'spillage' }], ['no reason', { qty: 1 }],
  ['a delivery', { qty: 1, reason_code: 'received' }], ['kitchen usage', { qty: 1, reason_code: 'usage' }],
  ['a transfer', { qty: 1, reason_code: 'transfer_out' }], ['a correction', { qty: 1, reason_code: 'correction' }],
]) t.check(`${what}: refused`, (await waste(body)).status === 400);
t.check('none of the refusals moved the shelf', t.near(await shelf(), 19, 1e-9));
t.check('a total sent along is ignored', (await waste({ qty: 1, reason_code: 'other', new_quantity: 500 })).data.quantity === 18);

t.section('recount');
const logBefore = (await log()).length;
const r1 = await recount({ counted_qty: 3, note: 'Delivery may have been entered twice' });
t.check('the bin is set to what was counted: 18 → 3', r1.status === 200 && t.near(await shelf(), 3, 1e-9), JSON.stringify(r1.data));
t.check('it reports what was expected and the difference', r1.data.expected === 18 && r1.data.change === -15);
const hist = (await call(u, 'GET', '/api/stock-take/history')).data?.data || [];
const row = hist.find(h => h.id === r1.data.stock_take_id) || {};
t.check('it is in Past Counts, marked as a recount of that item', row.kind === 'recount' && row.item_name === 'WR Flour'
  && row.counted === 1 && row.short === 1 && row.note === 'Delivery may have been entered twice', JSON.stringify(row));
t.check('with no "stock value" of its own', row.value === null);
t.check('the full counts are still listed as full, with their value', hist.filter(h => h.kind === 'full').length === 2
  && hist.filter(h => h.kind === 'full').every(h => t.near(h.value, 20, 0.01)));
const sheet = (await call(u, 'GET', `/api/stock-take/history/${r1.data.stock_take_id}`)).data || {};
t.check('opening it shows expected 18, counted 3', sheet.kind === 'recount' && sheet.items?.length === 1
  && sheet.items[0].expected_qty === 18 && sheet.items[0].counted_qty === 3 && sheet.items[0].difference === -15, JSON.stringify(sheet.items));
t.check('and what the 15 kg was worth: $30', t.near(sheet.short_value, 30, 0.01), `${sheet.short_value}`);
const moved = (await log()).find(l => l.stock_take_id === r1.data.stock_take_id) || {};
t.check('one log line, tied to the recount', (await log()).length === logBefore + 1 && Number(moved.change) === -15 && moved.reason_code === 'stock_take');
t.check('a reason can be given', (await recount({ counted_qty: 2, reason_code: 'theft' })).status === 200
  && (await log()).some(l => l.reason_code === 'theft' && Number(l.change) === -1));
t.check('counting none left is allowed', (await recount({ counted_qty: 0 })).status === 200 && t.near(await shelf(), 0, 1e-9));
t.check('finding more than expected is a recount too', (await recount({ counted_qty: 4 })).status === 200 && t.near(await shelf(), 4, 1e-9));
t.check('a recount that matches writes no log line', await (async () => {
  const n = (await log()).length; const r = await recount({ counted_qty: 4 }); return r.status === 200 && (await log()).length === n; })());
for (const [what, body] of [['nothing', {}], ['a negative count', { counted_qty: -1 }], ['not a number', { counted_qty: 'some' }],
  ['a delivery as the reason', { counted_qty: 5, reason_code: 'received' }]]) t.check(`${what}: refused`, (await recount(body)).status === 400);
t.check('the refusals moved nothing', t.near(await shelf(), 4, 1e-9));

t.section('a recount is not a month\'s count');
const after = await cogs();
t.check('the P&L still closes the month on the full count', after.available === true && t.near(after.closing_food, 20, 0.01)
  && t.near(after.opening_food, baseline.opening_food, 0.01), JSON.stringify(after));
t.check('the Inventory page\'s counted marks still come from the full count',
  (await call(u, 'GET', '/api/stock-take/latest-statuses')).data?.stock_take_id === closing);

t.section('nobody else');
t.check('another business cannot record waste on it', (await waste({ qty: 1, reason_code: 'spillage' }, other)).status === 404);
t.check('or recount it', (await recount({ counted_qty: 99 }, other)).status === 404);
t.check('Essential is offered an upgrade, not the action', (await waste({ qty: 1, reason_code: 'spillage' }, essential)).status === 403
  && (await recount({ counted_qty: 1 }, essential)).data?.upgrade_required === true);
t.check('signed out: refused', (await waste({ qty: 1, reason_code: 'spillage' }, jar())).status === 401);
t.check('the shelf is where we left it', t.near(await shelf(), 4, 1e-9));

t.section('the P&L explains it: waste by reason, and what went missing with no reason');
const pnl = (await call(u, 'GET', `/api/pnl?from=${period}&to=${period}`)).data || {};
const w = pnl.waste || {};
const reason = (code) => (w.by_reason || []).find(r => r.code === code) || {};
// Flour is $2/kg. Waste: spillage 1.5, menu testing 0.5, breakage 1, other 1, and 1 kg
// the theft recount took off. Missing: the recounts with no reason, 15 kg and 2 kg.
t.check('waste totals $10', t.near(w.total, 10, 0.01), JSON.stringify(w.by_reason));
t.check('split by reason: spillage $3, breakage $2, other $2, theft $2, menu testing $1',
  t.near(reason('spillage').value, 3, 0.01) && t.near(reason('breakage').value, 2, 0.01) && t.near(reason('other').value, 2, 0.01)
  && t.near(reason('theft').value, 2, 0.01) && t.near(reason('menu_testing').value, 1, 0.01));
t.check('biggest reason first', (w.by_reason || [])[0]?.code === 'spillage');
t.check('each entry is listed with its amount, reason, worth and note', (w.entries || []).length === 5
  && (w.entries || []).some(e => e.item_name === 'WR Flour' && e.qty === 1.5 && e.unit === 'kg' && e.reason === 'Spillage / waste'
    && t.near(e.value, 3, 0.01) && e.note === 'Tray dropped'), JSON.stringify(w.entries));
t.check('a waste reason given on a recount counts as waste, not as missing',
  (w.entries || []).some(e => e.reason === 'Theft / loss') && !(w.missing?.entries || []).some(e => e.qty === 1));
t.check('missing with no reason totals $34 (15 kg and 2 kg)', t.near(w.missing?.total, 34, 0.01)
  && (w.missing?.entries || []).length === 2, JSON.stringify(w.missing));
t.check('each missing line says what was expected and counted',
  (w.missing?.entries || []).some(e => e.expected_qty === 18 && e.counted_qty === 3 && e.qty === 15 && t.near(e.value, 30, 0.01)));
t.check('stock found OVER is in neither list', !(w.entries || []).concat(w.missing?.entries || []).some(e => e.qty === 4));
t.check('none of it is added to the cost: food COGS is purchases + opening − closing, as before',
  t.near(pnl.cogs.food_cogs, pnl.food_cost + pnl.cogs.opening_food - pnl.cogs.closing_food, 0.01));
const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const prev = `${lastMonth.getUTCFullYear()}-${String(lastMonth.getUTCMonth() + 1).padStart(2, '0')}`;
const wPrev = (await call(u, 'GET', `/api/pnl?from=${prev}&to=${prev}`)).data?.waste || {};
t.check('another month shows none of it', wPrev.total === 0 && (wPrev.missing?.entries || []).length === 0, JSON.stringify(wPrev));
const wOther = (await call(other, 'GET', `/api/pnl?from=${period}&to=${period}`)).data?.waste || {};
t.check('another business shows none of it', wOther.total === 0 && (wOther.entries || []).length === 0);
t.check('Essential gets no waste block', (await call(essential, 'GET', `/api/pnl?from=${period}&to=${period}`)).data?.waste === null);

t.done();
