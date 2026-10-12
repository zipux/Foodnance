// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run build && npm run dev:sandbox     (in another terminal)
//   npm run test:taxes
//
// Which taxes the P&L counts. GST/HST is claimed back, so it is never a cost;
// PST is not, so it is one:
//   · PST on supplier invoices is its own running-cost line (purchase_pst)
//   · an expense bill (electricity, insurance) counts as its total LESS its GST
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

const t = suite('integration/pnl-taxes');
try { await fetch(`${BASE}/api/auth/me`); } catch (_) {
  console.log(`\n  no server at ${BASE} — skipping (run: npm run dev:sandbox)\n`); process.exit(0);
}

const admin = jar();
const login = await call(admin, 'POST', '/api/auth/login', { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' });
if (login.status !== 200) { console.log('\n  no super-admin session — skipping\n'); process.exit(0); }
async function business(label) {
  const o = { name: `${label} ${STAMP}`, email: `${label.toLowerCase().replace(/\W/g, '')}-${STAMP}@test.local`, password: 'taxes-pw-1' };
  const org = await call(admin, 'POST', '/api/admin/organizations',
    { name: o.name, owner_email: o.email, owner_password: o.password, account_type: 'restaurant' });
  const id = org.data?.organization?.id;
  await call(admin, 'POST', `/api/admin/organizations/${id}/plan`, { plan: 'pro' });
  await call(admin, 'POST', `/api/admin/organizations/${id}/review-mode`, { mode: 'direct' });
  const j = jar();
  await call(j, 'POST', '/api/auth/login', { email: o.email, password: o.password });
  return j;
}
const u = await business('Taxes IT');
t.check('business created and signed in', !!u.cookies.dm_session);

// A supplier invoice, as Confirm & Save leaves it: Closed, with its taxes on the row.
async function supplierInvoice(day, goods, gst, pst) {
  const inv = await call(u, 'POST', '/api/tables/invoices',
    { vendor: 'TX Supply', invoice_number: `TX-${day}-${goods}-${STAMP}`, invoice_date: day, total: goods + gst + pst });
  const id = inv.data?.data?.id || inv.data?.id;
  await call(u, 'PATCH', `/api/tables/invoices/${id}`, { status: 'Closed', tax_gst: gst, tax_pst: pst });
  await call(u, 'POST', `/api/invoice-lines/${id}/replace`,
    { lines: [{ product_name: 'TX Bleach', packaging: '4 L', price: goods, qty: 1, line_total: goods }], tax_gst: gst, tax_pst: pst });
  return id;
}
// An expense bill, exactly what the invoice screen sends for one.
async function expenseBill(day, total, gst, category) {
  const inv = await call(u, 'POST', '/api/tables/invoices', { vendor: 'TX Hydro', invoice_number: `TXH-${day}-${STAMP}`, invoice_date: day, total });
  const id = inv.data?.data?.id || inv.data?.id;
  const r = await call(u, 'PATCH', `/api/tables/invoices/${id}`,
    { vendor: 'TX Hydro', invoice_date: day, total, tax_gst: gst, status: 'Closed', parsed_data: '', invoice_kind: 'expense', expense_category: category });
  return r.status === 200 ? id : null;
}
const pnl = async (from, to) => (await call(u, 'GET', `/api/pnl?from=${from}&to=${to}`)).data;
const bill = d => (d.expense_invoices || []).reduce((s, r) => s + r.amount, 0);

const a = await supplierInvoice('2026-09-10', 281.00, 14.05, 19.67);
await supplierInvoice('2026-09-20', 100.00, 5.00, 7.00);
const voided = await supplierInvoice('2026-09-21', 50.00, 2.50, 3.50);
await call(u, 'POST', `/api/invoices/${voided}/void`, { reason: 'test' });
t.check('an expense bill saves', !!(await expenseBill('2026-09-15', 878.85, 41.85, 'Utilities')));
await expenseBill('2026-09-25', 200, 0, 'Insurance');          // typed by hand: no GST on it

t.section('PST is a cost, GST is not');
const sep = await pnl('2026-09', '2026-09');
t.check('PST on supplier invoices: 19.67 + 7.00 = $26.67, the voided one left out', t.near(sep.purchase_pst, 26.67, 0.001), String(sep.purchase_pst));
t.check('the goods themselves are unchanged: $381, no tax in them', t.near(sep.food_cost + sep.supplies_cost + sep.beverage_cost, 381, 0.001));
t.check('GST appears nowhere', ![sep.purchase_pst, sep.invoice_fees, bill(sep)].some(n => t.near(n, 19.05, 0.001) || t.near(n, 60.9, 0.001)));

t.section('an expense bill counts without its GST');
const util = (sep.expense_invoices || []).find(r => r.category === 'Utilities');
t.check('the electricity bill: 878.85 − 41.85 GST = $837.00', t.near(util?.amount, 837, 0.001), JSON.stringify(sep.expense_invoices));
t.check('a bill with no GST on it counts in full', t.near((sep.expense_invoices || []).find(r => r.category === 'Insurance')?.amount, 200, 0.001));
t.check('a bill\'s tax is not also in the PST line', t.near(sep.purchase_pst, 26.67, 0.001));
const odd = await expenseBill('2026-08-05', 100, 250, 'Other');   // nonsense GST, as a hand-made request could send
t.check('a GST bigger than the bill never makes a negative cost', !!odd && t.near(bill(await pnl('2026-08', '2026-08')), 0, 0.001));

t.section('exact dates');
const days = await pnl('2026-09-08', '2026-09-12');
t.check('only the invoice of the 10th: PST $19.67', days.by_day === true && t.near(days.purchase_pst, 19.67, 0.001), String(days.purchase_pst));

t.section('isolation');
const other = await business('Taxes Other');
const theirs = (await call(other, 'GET', '/api/pnl?from=2026-09&to=2026-09')).data;
t.check('another business sees none of it', theirs.purchase_pst === 0 && (theirs.expense_invoices || []).length === 0);

t.done();
