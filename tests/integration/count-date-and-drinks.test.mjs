// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run build && npm run dev:sandbox     (in another terminal; 0062 applied locally)
//   npm run test:count-date
//
// · A stock count is filed under the day the browser's clock read (count_date),
//   and a count whose UTC day is the 1st but whose local day is the last of the
//   month before OPENS that month in the P&L instead of sitting inside it.
// · Till sales in a category called Wine / Drinks land on the P&L's drinks line.
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

const t = suite('integration/count-date-and-drinks');
try { await fetch(`${BASE}/api/auth/me`); } catch (_) {
  console.log(`\n  no server at ${BASE} — skipping (run: npm run dev:sandbox)\n`); process.exit(0);
}

const admin = jar();
const login = await call(admin, 'POST', '/api/auth/login', { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' });
if (login.status !== 200) { console.log('\n  no super-admin session — skipping\n'); process.exit(0); }
const ORG = { name: `CountDate IT ${STAMP}`, email: `countdate-${STAMP}@test.local`, password: 'countdate-pw-1' };
const org = await call(admin, 'POST', '/api/admin/organizations',
  { name: ORG.name, owner_email: ORG.email, owner_password: ORG.password, account_type: 'restaurant' });
const orgId = org.data?.organization?.id;
await call(admin, 'POST', `/api/admin/organizations/${orgId}/plan`, { plan: 'pro' });
const u = jar();
await call(u, 'POST', '/api/auth/login', { email: ORG.email, password: ORG.password });
t.check('business created and signed in', !!u.cookies.dm_session);

const flour = (await call(u, 'POST', '/api/tables/generic_products', { name: 'CD Flour', category: 'Other', base_unit: 'kg' })).data.id;
await call(u, 'POST', '/api/tables/product_entries', {
  generic_product_id: flour, generic_product_name: 'CD Flour', purchase_date: '2020-01-01',
  pack_qty: 10, pack_unit: 'kg', qty_ordered: 1, cost: 20, cost_per_unit: 2 });
await call(u, 'POST', '/api/tables/inventory',
  { item_id: flour, item_type: 'raw_material', item_name: 'CD Flour', category: 'Other', quantity: 10, unit: 'kg' });

const takeRow = async (id) => (await call(u, 'GET', `/api/tables/stock_takes/${id}`)).data;
async function count(countDate) {
  const start = await call(u, 'POST', '/api/stock-take/start', {});
  const id = start.data?.stock_take?.id;
  const items = (start.data?.items || []).filter(i => i.item_id === flour)
    .map(i => ({ stock_take_item_id: i.id, counted_qty: 10, reason_code: 'stock_take' }));
  const res = await call(u, 'POST', `/api/stock-take/${id}/submit`,
    countDate === undefined ? { items } : { items, count_date: countDate });
  return res.status === 200 ? id : null;
}
const utcDay = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

// ── saving the date ─────────────────────────────────────────────
t.section('the count date is saved');
const yesterday = await count(utcDay(-1));
t.check('the evening-before date is kept', (await takeRow(yesterday)).count_date === utcDay(-1));
const garbage = await count('next tuesday');
t.check('a non-date is dropped, the count still goes in', !!garbage && (await takeRow(garbage)).count_date === null);
const farOff = await count(utcDay(-9));
t.check('a date nine days off is dropped', !!farOff && (await takeRow(farOff)).count_date === null);
const none = await count(undefined);
t.check('an old page that sends nothing still works', !!none && (await takeRow(none)).count_date === null);

// ── the month it opens ──────────────────────────────────────────
t.section('an evening count on the last day opens the next month');
// Clear the decks: one count made "on the evening of the last day of last
// month" (already the 1st in UTC), and one made today.
for (const id of [yesterday, garbage, farOff]) await call(u, 'DELETE', `/api/tables/stock_takes/${id}`);
const now = new Date();
const y = now.getUTCFullYear(), m = now.getUTCMonth();
const period   = `${y}-${String(m + 1).padStart(2, '0')}`;
const firstUtc = new Date(Date.UTC(y, m, 1, 4, 0, 0)).toISOString();          // the 1st, 04:00 UTC
const lastPrev = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);      // the day before
const evening = await count(undefined);
// `none` stays as the count made today, inside the month.
await call(u, 'PATCH', `/api/tables/stock_takes/${evening}`, { submitted_at: firstUtc });
const cogsOf = async () => (await call(u, 'GET', `/api/pnl?from=${period}&to=${period}`)).data?.cogs || {};

const before = await cogsOf();
t.check('with only the UTC day, the month has no opening count', before.available === false && before.reason === 'no_opening_take',
  JSON.stringify(before));
await call(u, 'PATCH', `/api/tables/stock_takes/${evening}`, { count_date: lastPrev });
const after = await cogsOf();
t.check('with the local day, it opens the month', after.available === true, JSON.stringify(after));
t.check('and the P&L names that day', after.opening_date === lastPrev, `${after.opening_date} vs ${lastPrev}`);
t.check('opening and closing stock are both valued (10 kg at $2)', t.near(after.opening_food, 20, 0.01) && t.near(after.closing_food, 20, 0.01),
  `${after.opening_food} / ${after.closing_food}`);

// ── drinks ──────────────────────────────────────────────────────
t.section('till sales called Wine or Drinks are drinks');
const { parsePosCsv } = loadBrowserModule(['pos-parse.js'], ['parsePosCsv'], { window: {} });
const head = 'Date,Time,Time Zone,Category,Item,Qty,Price Point Name,SKU,Modifiers Applied,Gross Sales,Discounts,Net Sales,Tax,Transaction ID,Payment ID,Device Name,Notes,Details,Event Type,Location,Dining Option,Customer ID,Customer Name,Customer Reference ID,Unit,Count,Itemization Type,Commission,Employee,Record ID';
const day = `${period}-01`;
const row = (i, cat, item, amt) => [day, '18:00:00', 'Pacific Time (US & Canada)', cat, item, 1, 'Regular', '', '',
  `$${amt.toFixed(2)}`, '$0.00', `$${amt.toFixed(2)}`, '$0.00', `cd${STAMP}t${i}`, `pmt${i}`, 'iPad', '', '', 'Payment', 'Main', 'Dine In',
  '', '', '', '', 1, 'ITEM', '$0.00', 'Test', 3000000 + i].join(',');
const csv = [head,
  row(1, 'Pizza', 'Margherita', 12),            // food
  row(2, 'Wine', 'House Red', 20),              // drink word
  row(3, 'Soft Drinks', 'Cola', 4),             // drink word
  row(4, 'Alcohol', 'Negroni', 14),             // the account's own drinks category
  row(5, 'Winery Platter', 'Cheese board', 30), // not a whole drink word
  row(6, 'Dairy & Eggs', 'Milk to go', 5),      // the account's own FOOD category
].join('\n') + '\n';
const parsed = parsePosCsv(csv, 'drinks.csv');
t.check('the file parses', parsed.ok && parsed.lines.length === 6, parsed.message || '');
const draft = await call(u, 'POST', '/api/pos-imports', { parsed, content_hash: 'cd-' + STAMP });
const commit = await call(u, 'POST', `/api/pos-imports/${draft.data.import_id}/commit`, { items: draft.data.items, deplete: false });
t.check('the import lands', commit.status === 200, `${commit.status} ${JSON.stringify(commit.data?.error)}`);
const month = (await call(u, 'GET', `/api/pnl?from=${period}&to=${period}`)).data?.sales?.by_month?.[period] || {};
t.check('drinks: wine 20 + soft drinks 4 + alcohol 14 = 38', t.near(month.beverage, 38, 0.001), JSON.stringify(month));
t.check('food: pizza 12 + platter 30 + milk 5 = 47', t.near(month.food, 47, 0.001), JSON.stringify(month));
t.check('the total is untouched: 85 over 6 lines', t.near(month.imported_net, 85, 0.001) && month.lines === 6, JSON.stringify(month));

t.done();
