// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run build && npm run dev:sandbox     (in another terminal)
//   npm run test:history
//
// Past stock counts: listed newest first with the value the P&L shows for them,
// opened line by line with what the differences were worth, annotated with a
// note that changes nothing else, and invisible to every other business.
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

const t = suite('integration/stock-take-history');
try { await fetch(`${BASE}/api/auth/me`); } catch (_) {
  console.log(`\n  no server at ${BASE} — skipping (run: npm run dev:sandbox)\n`); process.exit(0);
}
const admin = jar();
const login = await call(admin, 'POST', '/api/auth/login', { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' });
if (login.status !== 200) { console.log('\n  no super-admin session — skipping\n'); process.exit(0); }
async function business(tag) {
  const o = { name: `History ${tag} ${STAMP}`, email: `history-${tag}-${STAMP}@test.local`, password: 'history-pw-1' };
  const org = await call(admin, 'POST', '/api/admin/organizations',
    { name: o.name, owner_email: o.email, owner_password: o.password, account_type: 'restaurant' });
  await call(admin, 'POST', `/api/admin/organizations/${org.data.organization.id}/plan`, { plan: 'pro' });
  const j = jar();
  await call(j, 'POST', '/api/auth/login', { email: o.email, password: o.password });
  return j;
}
const u = await business('a');
const other = await business('b');
t.check('two businesses signed in', !!u.cookies.dm_session && !!other.cookies.dm_session);

// 10 kg of flour at $2/kg, 6 L of wine at $10/L.
const mk = async (name, category, unit, qty, cpu) => {
  const p = (await call(u, 'POST', '/api/tables/generic_products', { name, category, base_unit: unit })).data.id;
  await call(u, 'POST', '/api/tables/product_entries', { generic_product_id: p, generic_product_name: name,
    purchase_date: '2020-01-01', pack_qty: qty, pack_unit: unit, qty_ordered: 1, cost: qty * cpu, cost_per_unit: cpu });
  await call(u, 'POST', '/api/tables/inventory', { item_id: p, item_type: 'raw_material', item_name: name, category, quantity: qty, unit });
  return p;
};
const flour = await mk('HS Flour', 'Dry Goods & Pantry', 'kg', 10, 2);
const wine  = await mk('HS Wine', 'Alcohol', 'L', 6, 10);

async function count(counts) {
  const start = await call(u, 'POST', '/api/stock-take/start', {});
  const id = start.data?.stock_take?.id;
  const items = (start.data?.items || []).filter(i => counts[i.item_id]).map(i => ({ stock_take_item_id: i.id,
    counted_qty: counts[i.item_id][0], reason_code: counts[i.item_id][1] || '', reason: counts[i.item_id][2] || '' }));
  const res = await call(u, 'POST', `/api/stock-take/${id}/submit`, { items });
  return res.status === 200 ? id : null;
}

t.section('nothing to show before the first count');
t.check('an empty list, not an error', (await call(u, 'GET', '/api/stock-take/history')).data?.data?.length === 0);

const first = await count({ [flour]: [10], [wine]: [6] });
const now = new Date();
const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
await call(u, 'PATCH', `/api/tables/stock_takes/${first}`,
  { submitted_at: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)).toISOString() });
// 2 kg of flour short, 1 L of wine over.
const second = await count({ [flour]: [8, 'spillage', 'Spillage / waste'], [wine]: [7, 'correction', 'Stock correction'] });
t.check('two counts submitted', !!first && !!second);

t.section('the list');
const list = (await call(u, 'GET', '/api/stock-take/history')).data?.data || [];
t.check('both counts, newest first', list.length === 2 && list[0].id === second && list[1].id === first, JSON.stringify(list));
t.check('the first: 2 counted, nothing different, worth $80', list[1].counted === 2 && list[1].short === 0 && list[1].over === 0
  && t.near(list[1].value, 80, 0.01), JSON.stringify(list[1]));
t.check('the second: 1 short, 1 over, worth $86', list[0].short === 1 && list[0].over === 1 && t.near(list[0].value, 86, 0.01), JSON.stringify(list[0]));
const cogs = (await call(u, 'GET', `/api/pnl?from=${period}&to=${period}`)).data?.cogs || {};
t.check('the same values the P&L shows', cogs.available === true
  && t.near(cogs.opening_food + cogs.opening_beverage, list[1].value, 0.01)
  && t.near(cogs.closing_food + cogs.closing_beverage, list[0].value, 0.01), JSON.stringify(cogs));

t.section('one count, opened');
const one = (await call(u, 'GET', `/api/stock-take/history/${second}`)).data || {};
const line = (n) => (one.items || []).find(i => i.item_name === n) || {};
t.check('every counted line is there', (one.items || []).length === 2);
t.check('flour: expected 10, counted 8, 2 short, with its reason', line('HS Flour').expected_qty === 10 && line('HS Flour').counted_qty === 8
  && line('HS Flour').difference === -2 && line('HS Flour').reason === 'Spillage / waste', JSON.stringify(line('HS Flour')));
t.check('wine: 1 over', line('HS Wine').difference === 1);
t.check('the shortfall is worth $4, the overage $10', t.near(one.short_value, 4, 0.01) && t.near(one.over_value, 10, 0.01),
  `${one.short_value} / ${one.over_value}`);
t.check('internal ids are not sent', !('item_id' in line('HS Flour')));

t.section('a count in progress is not history');
const open = (await call(u, 'POST', '/api/stock-take/start', {})).data?.stock_take?.id;
t.check('it is not listed', ((await call(u, 'GET', '/api/stock-take/history')).data?.data || []).length === 2);
t.check('it cannot be opened as a past count', (await call(u, 'GET', `/api/stock-take/history/${open}`)).status === 404);
t.check('it cannot be given a note this way', (await call(u, 'POST', `/api/stock-take/history/${open}/note`, { note: 'x' })).status === 404);
await call(u, 'POST', `/api/stock-take/${open}/cancel`, {});

t.section('the note, and nothing else');
const before = JSON.stringify((await call(u, 'GET', `/api/stock-take/history/${second}`)).data.items);
const stock = async () => JSON.stringify(((await call(u, 'GET', '/api/tables/inventory?page=1&limit=50')).data?.data || []).map(r => [r.item_name, r.quantity]).sort());
const stockBefore = await stock();
const saved = await call(u, 'POST', `/api/stock-take/history/${second}/note`, { note: '  Flour bag split in storage.  ' });
t.check('saved, trimmed', saved.status === 200 && saved.data.note === 'Flour bag split in storage.');
const after = (await call(u, 'GET', `/api/stock-take/history/${second}`)).data;
t.check('it reads back on the count and in the list', after.note === 'Flour bag split in storage.'
  && (await call(u, 'GET', '/api/stock-take/history')).data.data[0].note === 'Flour bag split in storage.');
t.check('no line of the count moved', JSON.stringify(after.items) === before);
t.check('no stock moved', (await stock()) === stockBefore);
t.check('the value did not move', t.near(after.value, 86, 0.01));
t.check('a very long note is cut to 1000', (await call(u, 'POST', `/api/stock-take/history/${second}/note`, { note: 'x'.repeat(3000) })).data.note.length === 1000);
t.check('and can be cleared', (await call(u, 'POST', `/api/stock-take/history/${second}/note`, { note: '' })).data.note === '');

t.section('another business sees none of it');
t.check('its list is empty', ((await call(other, 'GET', '/api/stock-take/history')).data?.data || []).length === 0);
t.check('it cannot open the count', (await call(other, 'GET', `/api/stock-take/history/${second}`)).status === 404);
t.check('it cannot write a note on it', (await call(other, 'POST', `/api/stock-take/history/${second}/note`, { note: 'hello' })).status === 404
  && (await call(u, 'GET', `/api/stock-take/history/${second}`)).data.note === '');
t.check('signed out: refused', (await call(jar(), 'GET', '/api/stock-take/history')).status === 401);

t.done();
