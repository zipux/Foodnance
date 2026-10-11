// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run build && npm run dev:sandbox     (in another terminal)
//   npm run test:exact-dates
//
// The P&L for exact dates (YYYY-MM-DD): a week between two Monday counts, with a
// count taken as made BEFORE OPENING. One small restaurant, worked by hand:
//
//   flour $2/kg.  Counts: Mon 31 Aug 10 kg ($20) · Mon 7 Sep 10 kg ($20)
//                         Mon 14 Sep 4 kg ($8)   · Mon 21 Sep 6 kg ($12)
//   invoices: 7 Sep $30 · 13 Sep $10 · 14 Sep $50
//   till:     7 Sep $100 · 13 Sep $60 · 14 Sep $200
//
//   week 7–13 Sep:  bought 40, used 20 + 40 − 8  = 52, sales 160
//   week 14–20 Sep: bought 50, used  8 + 50 − 12 = 46, sales 200
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

const t = suite('integration/pnl-exact-dates');
try { await fetch(`${BASE}/api/auth/me`); } catch (_) {
  console.log(`\n  no server at ${BASE} — skipping (run: npm run dev:sandbox)\n`); process.exit(0);
}

const admin = jar();
const login = await call(admin, 'POST', '/api/auth/login', { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' });
if (login.status !== 200) { console.log('\n  no super-admin session — skipping\n'); process.exit(0); }
async function business(label) {
  const o = { name: `${label} ${STAMP}`, email: `${label.toLowerCase().replace(/\W/g, '')}-${STAMP}@test.local`, password: 'exactdates-pw-1' };
  const org = await call(admin, 'POST', '/api/admin/organizations',
    { name: o.name, owner_email: o.email, owner_password: o.password, account_type: 'restaurant' });
  const id = org.data?.organization?.id;
  await call(admin, 'POST', `/api/admin/organizations/${id}/plan`, { plan: 'pro' });
  await call(admin, 'POST', `/api/admin/organizations/${id}/review-mode`, { mode: 'direct' });
  const j = jar();
  await call(j, 'POST', '/api/auth/login', { email: o.email, password: o.password });
  return j;
}
const u = await business('ExactDates IT');
t.check('business created and signed in', !!u.cookies.dm_session);

const flour = (await call(u, 'POST', '/api/tables/generic_products', { name: 'ED Flour', category: 'Other', base_unit: 'kg' })).data.id;
await call(u, 'POST', '/api/tables/product_entries', {
  generic_product_id: flour, generic_product_name: 'ED Flour', purchase_date: '2020-01-01',
  pack_qty: 10, pack_unit: 'kg', qty_ordered: 1, cost: 20, cost_per_unit: 2 });
await call(u, 'POST', '/api/tables/inventory',
  { item_id: flour, item_type: 'raw_material', item_name: 'ED Flour', category: 'Other', quantity: 10, unit: 'kg' });

// A count of `qty` kg, then filed under `day` (the route only keeps a day within
// one of today, so the day is set afterwards, as the other count tests do).
// No reason is given, so a count that comes up short is "missing, no reason".
async function count(day, qty) {
  const start = await call(u, 'POST', '/api/stock-take/start', {});
  const id = start.data?.stock_take?.id;
  const items = (start.data?.items || []).filter(i => i.item_id === flour)
    .map(i => ({ stock_take_item_id: i.id, counted_qty: qty }));
  const res = await call(u, 'POST', `/api/stock-take/${id}/submit`, { items });
  await call(u, 'PATCH', `/api/tables/stock_takes/${id}`, { count_date: day, submitted_at: `${day}T07:00:00.000Z` });
  return res.status === 200 ? id : null;
}
t.check('four Monday counts', !!(await count('2026-08-31', 10)) && !!(await count('2026-09-07', 10))
  && !!(await count('2026-09-14', 4)) && !!(await count('2026-09-21', 6)));

async function invoice(day, amount) {
  const inv = await call(u, 'POST', '/api/tables/invoices',
    { vendor: 'ED Mill', invoice_number: `ED-${day}-${STAMP}`, invoice_date: day, total: amount });
  const id = inv.data?.data?.id || inv.data?.id;
  await call(u, 'PATCH', `/api/tables/invoices/${id}`, { status: 'Closed' });
  await call(u, 'POST', `/api/invoice-lines/${id}/replace`,
    { lines: [{ product_name: 'ED Flour', packaging: '10 kg', price: amount, qty: 1, line_total: amount, generic_product_id: flour }] });
  return id;
}
await invoice('2026-09-07', 30); await invoice('2026-09-13', 10); await invoice('2026-09-14', 50);

const { parsePosCsv } = loadBrowserModule(['pos-parse.js'], ['parsePosCsv'], { window: {} });
const head = 'Date,Time,Time Zone,Category,Item,Qty,Price Point Name,SKU,Modifiers Applied,Gross Sales,Discounts,Net Sales,Tax,Transaction ID,Payment ID,Device Name,Notes,Details,Event Type,Location,Dining Option,Customer ID,Customer Name,Customer Reference ID,Unit,Count,Itemization Type,Commission,Employee,Record ID';
const row = (i, day, amt) => [day, '18:00:00', 'Pacific Time (US & Canada)', 'Pizza', 'Margherita', 1, 'Regular', '', '',
  `$${amt.toFixed(2)}`, '$0.00', `$${amt.toFixed(2)}`, '$0.00', `ed${STAMP}t${i}`, `pmt${i}`, 'iPad', '', '', 'Payment', 'Main', 'Dine In',
  '', '', '', '', 1, 'ITEM', '$0.00', 'Test', 4000000 + i].join(',');
const parsed = parsePosCsv([head, row(1, '2026-09-07', 100), row(2, '2026-09-13', 60), row(3, '2026-09-14', 200)].join('\n') + '\n', 'ed.csv');
t.check('the till file parses', parsed.ok && parsed.lines.length === 3, parsed.message || '');
const draft = await call(u, 'POST', '/api/pos-imports', { parsed, content_hash: 'ed-' + STAMP });
const commit = await call(u, 'POST', `/api/pos-imports/${draft.data.import_id}/commit`, { items: draft.data.items, deplete: false });
t.check('the sales land', commit.status === 200, `${commit.status} ${JSON.stringify(commit.data?.error)}`);

const pnl = async (from, to) => (await call(u, 'GET', `/api/pnl?from=${from}&to=${to}`));
const lines = d => Object.values(d?.sales?.by_month || {}).reduce((s, m) => s + (m.lines || 0), 0);

// ── the list the page offers ────────────────────────────────────
t.section('the count days');
const days = (await call(u, 'GET', '/api/pnl/count-days')).data?.data || [];
t.check('the four counts, newest first', JSON.stringify(days) === JSON.stringify(['2026-09-21', '2026-09-14', '2026-09-07', '2026-08-31']), JSON.stringify(days));

// ── a week between two counts ───────────────────────────────────
t.section('week 7–13 Sep, between the counts of 7 and 14 Sep');
const w1 = (await pnl('2026-09-07', '2026-09-13')).data;
t.check('it is the exact-dates answer', w1.by_day === true && w1.month === undefined);
t.check('bought $40: the invoices of the 7th and the 13th, not the 14th', t.near(w1.food_cost, 40, 0.001), String(w1.food_cost));
t.check('sales $160 over 2 lines: the 7th and the 13th', t.near(w1.sales.imported_total, 160, 0.001) && lines(w1) === 2, JSON.stringify(w1.sales));
t.check('opened by the count of the 7th, closed by the count of the 14th',
  w1.cogs.available === true && w1.cogs.opening_date === '2026-09-07' && w1.cogs.closing_date === '2026-09-14', JSON.stringify(w1.cogs));
t.check('used = 20 + 40 − 8 = $52', t.near(w1.cogs.food_cogs, 52, 0.001) && t.near(w1.cogs.opening_food, 20, 0.001) && t.near(w1.cogs.closing_food, 8, 0.001),
  JSON.stringify(w1.cogs));
t.check('what the count of the 14th found missing (6 kg, $12) belongs to this week',
  w1.waste?.missing?.entries?.length === 1 && w1.waste.missing.entries[0].date === '2026-09-14' && t.near(w1.waste.missing.total, 12, 0.001),
  JSON.stringify(w1.waste?.missing));

t.section('week 14–20 Sep, between the counts of 14 and 21 Sep');
const w2 = (await pnl('2026-09-14', '2026-09-20')).data;
t.check('bought $50, sales $200 on 1 line', t.near(w2.food_cost, 50, 0.001) && t.near(w2.sales.imported_total, 200, 0.001) && lines(w2) === 1,
  `${w2.food_cost} ${JSON.stringify(w2.sales)}`);
t.check('used = 8 + 50 − 12 = $46', w2.cogs.opening_date === '2026-09-14' && w2.cogs.closing_date === '2026-09-21' && t.near(w2.cogs.food_cogs, 46, 0.001),
  JSON.stringify(w2.cogs));
t.check('the count of the 14th is NOT this week\'s missing stock; the 21st found none', (w2.waste?.missing?.entries || []).length === 0,
  JSON.stringify(w2.waste?.missing));
t.check('the two weeks add up to the stretch 7–20 Sep', t.near(w1.cogs.food_cogs + w2.cogs.food_cogs, (await pnl('2026-09-07', '2026-09-20')).data.cogs.food_cogs, 0.001));

// ── dates that are not count days ───────────────────────────────
t.section('any two dates');
const odd = (await pnl('2026-09-08', '2026-09-15')).data;
t.check('bought $60 (13th + 14th), sales $260', t.near(odd.food_cost, 60, 0.001) && t.near(odd.sales.imported_total, 260, 0.001), `${odd.food_cost}`);
t.check('the counts it leans on are named, so the page can say "close, not exact"',
  odd.cogs.available === true && odd.cogs.opening_date === '2026-09-07' && odd.cogs.closing_date === '2026-09-14', JSON.stringify(odd.cogs));
const none = (await pnl('2026-09-22', '2026-09-25')).data;
t.check('no later count: purchases only, and it says why', none.cogs.available === false && none.cogs.reason === 'no_closing_take', JSON.stringify(none.cogs));
const early = (await pnl('2026-08-24', '2026-08-30')).data;
t.check('no count on or before the first day: it says so', early.cogs.available === false, JSON.stringify(early.cogs));
const oneDay = (await pnl('2026-09-13', '2026-09-13')).data;
t.check('a single day: $10 bought, $60 sold', t.near(oneDay.food_cost, 10, 0.001) && t.near(oneDay.sales.imported_total, 60, 0.001));

t.section('what is turned away');
t.check('a date with a month', (await pnl('2026-09-07', '2026-09')).status === 400);
t.check('a day that does not exist', (await pnl('2026-02-30', '2026-03-02')).status === 400);
t.check('the end before the start', (await pnl('2026-09-13', '2026-09-07')).status === 400);

// ── the monthly statement, by the same rule ─────────────────────
t.section('the whole month');
const sep = (await pnl('2026-09', '2026-09')).data;
t.check('it is the monthly answer', sep.by_day === false && sep.month === '2026-09');
t.check('September bought $90, sales $360', t.near(sep.food_cost, 90, 0.001) && t.near(sep.sales.by_month['2026-09'].imported_net, 360, 0.001));
t.check('opened by the last count on or before the 1st, closed by the last count up to the 1st of October',
  sep.cogs.opening_date === '2026-08-31' && sep.cogs.closing_date === '2026-09-21', JSON.stringify(sep.cogs));
t.check('used = 20 + 90 − 12 = $98', t.near(sep.cogs.food_cogs, 98, 0.001), String(sep.cogs.food_cogs));
t.check('missing stock found by the count of the 14th is in September',
  sep.waste?.missing?.entries?.length === 1 && sep.waste.missing.entries[0].date === '2026-09-14', JSON.stringify(sep.waste?.missing));
const viaMonth = (await call(u, 'GET', '/api/pnl?month=2026-09')).data;
t.check('the Home tile\'s month= still answers the same', t.near(viaMonth.food_cost, 90, 0.001) && viaMonth.month === '2026-09');

// A count on the 1st is the shelf before opening that day: it closes the month
// before and opens its own.
t.section('a count on 1 October closes September and opens October');
await count('2026-10-01', 5);                       // 5 kg = $10; expected 6, so 1 kg ($2) missing
const sep2 = (await pnl('2026-09', '2026-09')).data;
t.check('September now closes on it: used = 20 + 90 − 10 = $100',
  sep2.cogs.closing_date === '2026-10-01' && t.near(sep2.cogs.food_cogs, 100, 0.001), JSON.stringify(sep2.cogs));
t.check('what it found missing ($2) is September\'s, with the $12 of the 14th',
  sep2.waste?.missing?.entries?.length === 2 && t.near(sep2.waste.missing.total, 14, 0.001), JSON.stringify(sep2.waste?.missing));
const oct = (await pnl('2026-10', '2026-10')).data;
t.check('October has its opening count and waits for a closing one', oct.cogs.available === false && oct.cogs.reason === 'no_closing_take', JSON.stringify(oct.cogs));
await count('2026-10-08', 5);
const oct2 = (await pnl('2026-10', '2026-10')).data;
t.check('with a later count October opens on the 1st', oct2.cogs.available === true && oct2.cogs.opening_date === '2026-10-01'
  && oct2.cogs.closing_date === '2026-10-08' && t.near(oct2.cogs.food_cogs, 0, 0.001), JSON.stringify(oct2.cogs));
t.check('and the missing stock of the 1st is not October\'s', (oct2.waste?.missing?.entries || []).length === 0, JSON.stringify(oct2.waste?.missing));

// ── another business sees none of it ────────────────────────────
t.section('isolation');
const other = await business('ExactDates Other');
const theirs = (await call(other, 'GET', '/api/pnl?from=2026-09-07&to=2026-09-13')).data;
t.check('another business gets no counts, purchases or sales',
  ((await call(other, 'GET', '/api/pnl/count-days')).data?.data || []).length === 0
  && theirs.food_cost === 0 && theirs.sales.imported_total === 0 && theirs.cogs.available === false);
t.check('signed out: refused', (await call(jar(), 'GET', '/api/pnl/count-days')).status === 401);

t.done();
