// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run build && npm run dev:sandbox     (in another terminal)
//   npm run test:estimate
//
// A restaurant that counts on Mondays has no count on the 1st. The P&L carries
// the last count forward to the edge of the period:
//     the count + what was bought since − what sales and recorded waste used since
// and only when the till sales for those days are imported. Worked by hand:
//
//   flour $2/kg.  Counts: Mon 31 Aug 10 kg ($20) · Mon 28 Sep 10 kg ($20) · Mon 5 Oct 21 kg ($42)
//   invoices: 15 Sep $40 · 29 Sep $30 · 2 Oct $20
//   used:     29 Sep 4 kg ($8) · 30 Sep 3 kg + 0.5 kg spilled ($7) · 2 Oct 6 kg ($12)
//
//   shelf on 30 Sep = 20 + 30 − 15 = $35
//   September used  = 20 + 70 − 35 = $55      (it read $70 before: the $30 of the 29th, less the $15 used)
//   October used    = 35 + 20 − 42 = $13
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
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(jarHeader(j) ? { cookie: jarHeader(j) } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  absorb(j, res);
  let data = null; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

const t = suite('integration/pnl-estimate');
try { await fetch(`${BASE}/api/auth/me`); } catch (_) {
  console.log(`\n  no server at ${BASE} — skipping (run: npm run dev:sandbox)\n`); process.exit(0);
}

const admin = jar();
const login = await call(admin, 'POST', '/api/auth/login', { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' });
if (login.status !== 200) { console.log('\n  no super-admin session — skipping\n'); process.exit(0); }
async function business(label) {
  const o = { name: `${label} ${STAMP}`, email: `${label.toLowerCase().replace(/\W/g, '')}-${STAMP}@test.local`, password: 'estimate-pw-1' };
  const org = await call(admin, 'POST', '/api/admin/organizations',
    { name: o.name, owner_email: o.email, owner_password: o.password, account_type: 'restaurant' });
  const id = org.data?.organization?.id;
  await call(admin, 'POST', `/api/admin/organizations/${id}/plan`, { plan: 'pro' });
  await call(admin, 'POST', `/api/admin/organizations/${id}/review-mode`, { mode: 'direct' });
  const j = jar();
  await call(j, 'POST', '/api/auth/login', { email: o.email, password: o.password });
  return j;
}
const u = await business('Estimate IT');
t.check('business created and signed in', !!u.cookies.dm_session);

const flour = (await call(u, 'POST', '/api/tables/generic_products', { name: 'EST Flour', category: 'Other', base_unit: 'kg' })).data.id;
await call(u, 'POST', '/api/tables/product_entries', {
  generic_product_id: flour, generic_product_name: 'EST Flour', purchase_date: '2020-01-01',
  pack_qty: 10, pack_unit: 'kg', qty_ordered: 1, cost: 20, cost_per_unit: 2 });
const bin = (await call(u, 'POST', '/api/tables/inventory',
  { item_id: flour, item_type: 'raw_material', item_name: 'EST Flour', category: 'Other', quantity: 10, unit: 'kg' })).data.id;

async function count(day, qty) {
  const start = await call(u, 'POST', '/api/stock-take/start', {});
  const id = start.data?.stock_take?.id;
  const items = (start.data?.items || []).filter(i => i.item_id === flour)
    .map(i => ({ stock_take_item_id: i.id, counted_qty: qty, reason_code: 'stock_take' }));
  const res = await call(u, 'POST', `/api/stock-take/${id}/submit`, { items });
  await call(u, 'PATCH', `/api/tables/stock_takes/${id}`, { count_date: day, submitted_at: `${day}T07:00:00.000Z` });
  return res.status === 200 ? id : null;
}
async function invoice(day, amount) {
  const inv = await call(u, 'POST', '/api/tables/invoices',
    { vendor: 'EST Mill', invoice_number: `EST-${day}-${STAMP}`, invoice_date: day, total: amount });
  const id = inv.data?.data?.id || inv.data?.id;
  await call(u, 'PATCH', `/api/tables/invoices/${id}`, { status: 'Closed' });
  await call(u, 'POST', `/api/invoice-lines/${id}/replace`,
    { lines: [{ product_name: 'EST Flour', packaging: '10 kg', price: amount, qty: 1, line_total: amount, generic_product_id: flour }] });
}
t.check('three Monday counts', !!(await count('2026-08-31', 10)) && !!(await count('2026-09-28', 10)) && !!(await count('2026-10-05', 21)));
await invoice('2026-09-15', 40); await invoice('2026-09-29', 30); await invoice('2026-10-02', 20);

const { parsePosCsv } = loadBrowserModule(['pos-parse.js'], ['parsePosCsv'], { window: {} });
const head = 'Date,Time,Time Zone,Category,Item,Qty,Price Point Name,SKU,Modifiers Applied,Gross Sales,Discounts,Net Sales,Tax,Transaction ID,Payment ID,Device Name,Notes,Details,Event Type,Location,Dining Option,Customer ID,Customer Name,Customer Reference ID,Unit,Count,Itemization Type,Commission,Employee,Record ID';
const row = (i, day, amt) => [day, '18:00:00', 'Pacific Time (US & Canada)', 'Pizza', 'Margherita', 1, 'Regular', '', '',
  `$${amt.toFixed(2)}`, '$0.00', `$${amt.toFixed(2)}`, '$0.00', `ed${STAMP}t${i}`, `pmt${i}`, 'iPad', '', '', 'Payment', 'Main', 'Dine In',
  '', '', '', '', 1, 'ITEM', '$0.00', 'Test', 4000000 + i].join(',');
const parsed = parsePosCsv([head, row(1, '2026-09-28', 50), row(2, '2026-09-30', 70), row(3, '2026-10-04', 90)].join('\n') + '\n', 'est.csv');
const draft = await call(u, 'POST', '/api/pos-imports', { parsed, content_hash: 'est-' + STAMP });
const importId = draft.data.import_id;
const commit = await call(u, 'POST', `/api/pos-imports/${importId}/commit`, { items: draft.data.items, deplete: false });
t.check('a week of till sales lands, 28 Sep to 4 Oct', commit.status === 200, `${commit.status} ${JSON.stringify(commit.data?.error)}`);

const cogs = async (from, to) => (await call(u, 'GET', `/api/pnl?from=${from}&to=${to}`)).data?.cogs || {};
// A line in the stock log, as a sales import or Record waste would leave it.
const moved = (day, kg, extra) => call(u, 'POST', '/api/tables/stock_log', {
  inventory_id: bin, item_id: flour, item_type: 'raw_material', item_name: 'EST Flour', change: -kg,
  moved_at: `${day}T12:00:00.000Z`, ...extra });
const sold   = (day, kg) => moved(day, kg, { reason: 'Sales import', reason_code: 'usage', note: `Sold on ${day}`, pos_import_id: importId });

// ── nothing says what was used: the count stands ────────────────
t.section('sales that took no stock off: no estimate');
const before = await cogs('2026-09', '2026-09');
t.check('September closes on the count of the 28th as it was: used = 20 + 70 − 20 = $70',
  before.available === true && before.closing_date === '2026-09-28' && t.near(before.food_cogs, 70, 0.001) && !before.closing_estimate, JSON.stringify(before));
t.check('and it says which days could not be estimated', before.closing_gap?.from === '2026-09-28' && before.closing_gap?.to === '2026-09-30',
  JSON.stringify(before.closing_gap));

// ── the estimate ────────────────────────────────────────────────
// 29 Sep: 4 kg sold ($8) · 30 Sep: 3 kg sold ($6) + 0.5 kg spilled ($1) · 2 Oct: 6 kg sold ($12)
t.section('the shelf on 30 September, estimated from the count of the 28th');
const s1 = await sold('2026-09-29', 4), s2 = await sold('2026-09-30', 3), s3 = await sold('2026-10-02', 6);
const w1 = await moved('2026-09-30', 0.5, { reason: 'Spillage / waste', reason_code: 'spillage' });
t.check('the movements are in the log', [s1, s2, s3, w1].every(r => r.status === 200 || r.status === 201), `${s1.status} ${JSON.stringify(s1.data)}`);
const sep = await cogs('2026-09', '2026-09');
t.check('closing stock = 20 + 30 bought − 15 used = $35', t.near(sep.closing_food, 35, 0.001), JSON.stringify(sep));
t.check('it says so: from the 28th to the 30th, $30 bought, $15 used',
  sep.closing_estimate?.from === '2026-09-28' && sep.closing_estimate?.to === '2026-09-30'
  && t.near(sep.closing_estimate?.bought, 30, 0.001) && t.near(sep.closing_estimate?.used, 15, 0.001) && !sep.closing_gap, JSON.stringify(sep.closing_estimate));
t.check('September used = 20 + 70 − 35 = $55, not $70', t.near(sep.food_cogs, 55, 0.001), String(sep.food_cogs));
t.check('the count it started from is still named', sep.closing_date === '2026-09-28' && sep.opening_date === '2026-08-31');
t.check('the opening count of 31 Aug has no sales behind it, so it stands and says so',
  t.near(sep.opening_food, 20, 0.001) && !sep.opening_estimate && sep.opening_gap?.from === '2026-08-31' && sep.opening_gap?.to === '2026-08-31', JSON.stringify(sep));

t.section('October opens on the same figure');
const oct = await cogs('2026-10', '2026-10');
t.check('opening stock is September\'s closing estimate, $35', t.near(oct.opening_food, 35, 0.001) && oct.opening_estimate?.to === '2026-09-30', JSON.stringify(oct));
t.check('October used = 35 + 20 − 42 = $13', t.near(oct.food_cogs, 13, 0.001), String(oct.food_cogs));
t.check('the two months add up to count-to-count: 20 + 90 − 42 = $68', t.near(sep.food_cogs + oct.food_cogs, 68, 0.001));
t.check('October\'s end has no sales after the count of the 5th, so that count stands',
  t.near(oct.closing_food, 42, 0.001) && !oct.closing_estimate && oct.closing_gap?.from === '2026-10-05', JSON.stringify(oct));

t.section('a count on the edge is never estimated');
const week = await cogs('2026-09-28', '2026-10-04');
t.check('28 Sep to 4 Oct, between two counts: 20 + 50 − 42 = $28, nothing estimated',
  t.near(week.food_cogs, 28, 0.001) && !week.opening_estimate && !week.closing_estimate && !week.opening_gap && !week.closing_gap, JSON.stringify(week));
const part = await cogs('2026-09-01', '2026-10-01');
t.check('exact dates that end mid-week are estimated the same way: closing on 1 Oct = 20 + 30 − 15 = $35',
  t.near(part.closing_food, 35, 0.001) && part.closing_estimate?.to === '2026-10-01', JSON.stringify(part));

t.section('a real count on the 1st wins');
const first = await count('2026-10-01', 17);          // 17 kg = $34
const sep2 = await cogs('2026-09', '2026-09');
t.check('September closes on it, $34, with no estimate: used = 20 + 70 − 34 = $56',
  sep2.closing_date === '2026-10-01' && t.near(sep2.closing_food, 34, 0.001) && !sep2.closing_estimate && !sep2.closing_gap && t.near(sep2.food_cogs, 56, 0.001),
  JSON.stringify(sep2));
await call(u, 'DELETE', `/api/tables/stock_takes/${first}`);

t.section('a voided import is no longer evidence');
const voided = await call(u, 'POST', `/api/pos-imports/${importId}/void`, { reason: 'test' });
const sep3 = await cogs('2026-09', '2026-09');
t.check('voided: back to the count as it was, $70', voided.status === 200 && t.near(sep3.food_cogs, 70, 0.001) && !sep3.closing_estimate && !!sep3.closing_gap,
  `${voided.status} ${JSON.stringify(sep3)}`);
await call(u, 'POST', `/api/pos-imports/${importId}/restore`, {});
const sep4 = await cogs('2026-09', '2026-09');
t.check('restored: the estimate is back, and the sales are not counted twice, $55', t.near(sep4.food_cogs, 55, 0.001), JSON.stringify(sep4));

t.section('isolation');
const other = await business('Estimate Other');
const theirs = await cogs('2026-09', '2026-09');
const o = (await call(other, 'GET', '/api/pnl?from=2026-09&to=2026-09')).data?.cogs || {};
t.check('another business gets none of it', o.available === false && t.near(theirs.food_cogs, 55, 0.001), JSON.stringify(o));

t.done();
