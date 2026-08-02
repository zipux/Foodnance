// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run dev:sandbox        (in another terminal)
//   node tests/integration/cogs-valuation.test.mjs
//
// Stock-take valuation must reconcile units before multiplying.
//
// counted_qty is in the BIN's unit; cost_per_unit is per the PACK unit the
// product was invoiced in. Potatoes invoiced at $1.65/lb and counted as 50 kg in
// the walk-in are worth $181.88, not the $82.50 a straight multiply gives — a
// 2.2x error straight into true COGS. Unlike prepped stock (excluded from both
// takes, so it largely cancels), this one scales with what is on hand and does
// not cancel. The Inventory page has always converted here; this valuation did
// not, so the two disagreed about the same shelf.
//
// Self-contained: creates its own business per run.
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

const t = suite('integration/cogs-valuation');

try { await fetch(`${BASE}/api/auth/me`); } catch (_) {
  console.log(`\n  no server at ${BASE} — skipping (run: npm run dev:sandbox)\n`);
  process.exit(0);
}

// ── setup ───────────────────────────────────────────────────────
const admin = jar();
const ADMIN = { email: `cv-admin-${STAMP}@test.local`, password: 'cv-admin-pw-1' };
const boot = await call(admin, 'POST', '/api/auth/bootstrap', { ...ADMIN, name: 'CV IT' });
if (boot.status === 409) {
  const login = await call(admin, 'POST', '/api/auth/login',
    { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' });
  if (login.status !== 200) { console.log('\n  no super-admin session — skipping\n'); process.exit(0); }
} else if (boot.status === 200) {
  await call(admin, 'POST', '/api/auth/login', ADMIN);
}

const ORG = { name: `CV IT ${STAMP}`, email: `cv-${STAMP}@test.local`, password: 'cv-password-1' };
const org = await call(admin, 'POST', '/api/admin/organizations',
  { name: ORG.name, owner_email: ORG.email, owner_password: ORG.password, account_type: 'restaurant' });
const orgId = org.data?.organization?.id || org.data?.id;
await call(admin, 'POST', `/api/admin/organizations/${orgId}/plan`, { plan: 'pro' });   // true COGS is Pro-only

const u = jar();
await call(u, 'POST', '/api/auth/login', { email: ORG.email, password: ORG.password });
t.check('business created and signed in', !!u.cookies.dm_session);

// ── the potato case ─────────────────────────────────────────────
// Invoiced by the POUND at $1.65/lb. Counted in the walk-in by the KILO.
const potato = (await call(u, 'POST', '/api/tables/generic_products',
  { name: 'CV Potato', category: 'Produce', base_unit: 'kg' })).data.id;
await call(u, 'POST', '/api/tables/product_entries', {
  generic_product_id: potato, generic_product_name: 'CV Potato',
  purchase_date: '2020-01-01',                 // well before either take
  pack_qty: 50, pack_unit: 'lb', qty_ordered: 1, cost: 82.5, cost_per_unit: 1.65,
});
await call(u, 'POST', '/api/tables/inventory', {
  item_id: potato, item_type: 'raw_material', item_name: 'CV Potato',
  category: 'Produce', quantity: 50, unit: 'kg',
});
t.check('potato seeded: invoiced in lb, binned in kg', !!potato);

// Start a take, count the given quantities (keyed by product id), submit.
// Counts are supplied with the submit itself — there is no separate count route.
async function countAndSubmit(counts) {
  const start  = await call(u, 'POST', '/api/stock-take/start', {});
  const takeId = start.data?.stock_take?.id;
  const items  = start.data?.items || [];
  if (!takeId) return null;
  const payload = items
    .filter(i => counts[i.item_id] !== undefined)
    .map(i => ({ stock_take_item_id: i.id, counted_qty: counts[i.item_id], reason_code: 'stock_take' }));
  const res = await call(u, 'POST', `/api/stock-take/${takeId}/submit`, { items: payload });
  return res.status === 200 ? takeId : null;
}

// Opening take, then backdated so it sits BEFORE the reporting period.
const openingId = await countAndSubmit({ [potato]: 50 });
t.check('opening take submitted', !!openingId, `${openingId}`);

const now       = new Date();
const period    = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
await call(u, 'PATCH', `/api/tables/stock_takes/${openingId}`,
  { submitted_at: lastMonth.toISOString() });

// Closing take, inside the period (submitted just now).
const closingId = await countAndSubmit({ [potato]: 50 });
t.check('closing take submitted', !!closingId, `${closingId}`);

// ── the numbers ─────────────────────────────────────────────────
const pnl = await call(u, 'GET', `/api/pnl?from=${period}&to=${period}`);
const cogs = pnl.data?.cogs || {};
t.check('true COGS is available (two takes bracket the period)',
  cogs.available === true, JSON.stringify(cogs));

// 50 kg at $1.65/lb -> $1.65 / 0.45359237 = $3.6376/kg -> $181.88.
const EXPECTED = 181.88;
const UNCONVERTED = 82.5;   // what a straight multiply produced

t.check('closing stock is valued with units reconciled',
  t.near(cogs.closing_food, EXPECTED, 0.05), `${cogs.closing_food}`);
t.check('and is NOT the unconverted $82.50',
  !t.near(cogs.closing_food, UNCONVERTED, 0.05), `${cogs.closing_food}`);
t.check('opening stock is valued the same way',
  t.near(cogs.opening_food, EXPECTED, 0.05), `${cogs.opening_food}`);

t.section('the error would not have cancelled between takes');
// Both takes hold the same stock here, so opening and closing agree and the
// month's COGS is just purchases. The point is that each SIDE is now right —
// the moment the two counts differ, the 2.2x error would have leaked into COGS
// in proportion to the difference.
t.check('same stock at both ends -> the two valuations agree',
  t.near(cogs.opening_food, cogs.closing_food, 0.01),
  `${cogs.opening_food} vs ${cogs.closing_food}`);
t.check('so this period\'s food COGS is just its purchases',
  t.near(cogs.food_cogs, pnl.data?.spending?.food ?? 0, 0.05),
  `cogs=${cogs.food_cogs} purchases=${pnl.data?.spending?.food}`);

t.section('a product invoiced in the unit it is counted in is unaffected');
const salt = (await call(u, 'POST', '/api/tables/generic_products',
  { name: 'CV Salt', category: 'Produce', base_unit: 'kg' })).data.id;
await call(u, 'POST', '/api/tables/product_entries', {
  generic_product_id: salt, generic_product_name: 'CV Salt',
  purchase_date: '2020-01-01', pack_qty: 10, pack_unit: 'kg', qty_ordered: 1,
  cost: 20, cost_per_unit: 2,
});
await call(u, 'POST', '/api/tables/inventory', {
  item_id: salt, item_type: 'raw_material', item_name: 'CV Salt',
  category: 'Produce', quantity: 10, unit: 'kg',
});
const bothId = await countAndSubmit({ [potato]: 50, [salt]: 10 });
t.check('recount with both products submitted', !!bothId, `${bothId}`);

const pnl2 = await call(u, 'GET', `/api/pnl?from=${period}&to=${period}`);
// Potato $181.88 + salt 10 kg x $2/kg = $20.00  ->  $201.88
t.check('kg-invoiced, kg-counted salt adds its plain $20',
  t.near(pnl2.data?.cogs?.closing_food, 201.88, 0.5), `${pnl2.data?.cogs?.closing_food}`);

t.done();
