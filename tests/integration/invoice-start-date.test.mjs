// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run build && npm run dev:sandbox     (in another terminal)
//   npm run test:start-date                  (free — no AI calls)
//   TEST_AI=1 npm run test:start-date        (also proves the refusal; 3 real AI reads, a few cents)
//
// The account start date (migration 0058):
//   · the owner's first sign-in stamps started_at once, and sets the
//     "accept invoices from" date 7 days earlier — by invite AND by legacy login
//   · later sign-ins and teammates never move it
//   · a date the operator set before the owner arrived is kept
//   · the admin route sets, clears and validates it; customers can't call it
//   · /api/account/plan reports it for the upload page
//   · (TEST_AI) an invoice dated before it is refused with 422 and nothing saved;
//     a page added to the account's own invoice is not; another account's
//     invoice id does not unlock it
import { execFileSync } from 'node:child_process';
import { suite } from '../helpers/assert.mjs';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const STAMP = Date.now().toString(36);

function sql(q) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'invoicedb-production', '--local', '--json', '--command', q],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results || [];
}
function jar() { return { cookies: {} }; }
function cookieOf(j) { return j ? Object.entries(j.cookies).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ') : ''; }
function absorb(j, res) {
  const raw = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean);
  for (const line of raw) {
    const [pair] = String(line).split(';'); const i = pair.indexOf('=');
    if (i > 0) j.cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
}
async function call(method, path, body, j) {
  const cookie = cookieOf(j);
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (j) absorb(j, res);
  return { status: res.status, data: await res.json().catch(() => null) };
}
const post = (p, b, j) => call('POST', p, b, j);
const get  = (p, j) => call('GET', p, null, j);
const orgRow = (id) => sql(`SELECT started_at, invoice_start_date FROM organizations WHERE id = '${id}'`)[0];
const sevenDaysAgo = () => sql(`SELECT date('now', '-7 days') AS d`)[0].d;

const t = suite('integration/invoice-start-date');

// ── Setup ─────────────────────────────────────────────────────
const adminJar = jar();
const al = await post('/api/auth/login', { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' }, adminJar);
if (al.status !== 200) { console.error('\n  Cannot sign in as the local super-admin.\n'); process.exit(1); }

t.section('legacy account (ready-made password): first login is the start');
const LEGACY = { email: `start-legacy-${STAMP}@test.local`, password: 'start-legacy-pw-1' };
const lo = await post('/api/admin/organizations',
  { name: `Start Legacy ${STAMP}`, owner_email: LEGACY.email, owner_password: LEGACY.password, owner_name: 'Legacy' }, adminJar);
t.check('account created', lo.status === 200 || lo.status === 201, JSON.stringify(lo.data));
const legacyId = lo.data?.organization?.id;
t.check('not started before anyone signs in', orgRow(legacyId).started_at === null && orgRow(legacyId).invoice_start_date === null);
const legacyJar = jar();
await post('/api/auth/login', LEGACY, legacyJar);
const first = orgRow(legacyId);
t.check('first login stamps started_at', !!first.started_at);
t.check('start date is 7 days back', first.invoice_start_date === sevenDaysAgo(), JSON.stringify(first));
sql(`UPDATE organizations SET started_at = '2020-01-01 00:00:00' WHERE id = '${legacyId}'`);
await post('/api/auth/login', LEGACY, jar());
t.check('a later login does not move it', orgRow(legacyId).started_at === '2020-01-01 00:00:00');

t.section('invite account: accepting the invite is the start');
const INV = { email: `start-invite-${STAMP}@test.local`, password: 'start-invite-pw-1' };
const io = await post('/api/admin/organizations',
  { name: `Start Invite ${STAMP}`, owner_email: INV.email, owner_name: 'Invitee' }, adminJar);
t.check('account created with an invite', io.status === 200 || io.status === 201, JSON.stringify(io.data));
const inviteOrgId = io.data?.organization?.id;
// The operator sets a date before the owner ever arrives — it must survive.
const pre = await post(`/api/admin/organizations/${inviteOrgId}/invoice-start-date`, { date: '2026-01-15' }, adminJar);
t.check('operator can set a date before first sign-in', pre.status === 200 && pre.data.invoice_start_date === '2026-01-15');
const token = sql(`SELECT token FROM invites WHERE org_id = '${inviteOrgId}'`)[0]?.token;
const ownerJar = jar();
const acc = await post('/api/auth/accept-invite', { token, name: 'Invitee', email: INV.email, password: INV.password, agree: true }, ownerJar);
t.check('invite accepted', acc.status === 200, JSON.stringify(acc.data));
const inv = orgRow(inviteOrgId);
t.check('accepting stamps started_at', !!inv.started_at);
t.check("the operator's earlier date is kept", inv.invoice_start_date === '2026-01-15', JSON.stringify(inv));

t.section('admin route');
const bad = await post(`/api/admin/organizations/${inviteOrgId}/invoice-start-date`, { date: '2026-02-31' }, adminJar);
t.check('an impossible date is refused', bad.status === 400);
const notDate = await post(`/api/admin/organizations/${inviteOrgId}/invoice-start-date`, { date: 'yesterday' }, adminJar);
t.check('a non-date is refused', notDate.status === 400);
const cust = await post(`/api/admin/organizations/${inviteOrgId}/invoice-start-date`, { date: null }, ownerJar);
t.check('a customer cannot change it', cust.status === 403);
t.check('...and it is unchanged', orgRow(inviteOrgId).invoice_start_date === '2026-01-15');
const set = await post(`/api/admin/organizations/${inviteOrgId}/invoice-start-date`, { date: '2026-03-01' }, adminJar);
t.check('operator can move it', set.status === 200 && orgRow(inviteOrgId).invoice_start_date === '2026-03-01');
const list = await get('/api/admin/organizations', adminJar);
const listed = (list.data?.data || []).find(o => o.id === inviteOrgId);
t.check('admin list carries it', listed?.invoice_start_date === '2026-03-01' && !!listed?.started_at);

t.section('upload page source');
const plan = await get('/api/account/plan', ownerJar);
t.check('/api/account/plan reports the date', plan.status === 200 && plan.data.invoice_start_date === '2026-03-01', JSON.stringify(plan.data));
const clr = await post(`/api/admin/organizations/${inviteOrgId}/invoice-start-date`, { date: '' }, adminJar);
t.check('operator can clear it', clr.status === 200 && orgRow(inviteOrgId).invoice_start_date === null);
const plan2 = await get('/api/account/plan', ownerJar);
t.check('cleared reads as no limit', plan2.data?.invoice_start_date === null);

// ── Real AI reads, opt-in ─────────────────────────────────────
if (process.env.TEST_AI === '1') {
  t.section('AI reading refuses an invoice dated before the start date');
  await post(`/api/admin/organizations/${inviteOrgId}/invoice-start-date`, { date: '2026-03-01' }, adminJar);

  const parse = async (j, extra = {}) => {
    const fd = new FormData();
    fd.append('file', new Blob([tinyInvoicePdf('2026-01-15')], { type: 'application/pdf' }), 'old.pdf');
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    const res = await fetch(`${BASE}/api/ai/parse-invoice`, { method: 'POST', body: fd, headers: { cookie: cookieOf(j) } });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const invoicesBefore = sql(`SELECT COUNT(*) AS n FROM invoices WHERE org_id = '${inviteOrgId}'`)[0].n;
  const logBefore = sql(`SELECT COUNT(*) AS n FROM ai_parse_log WHERE org_id = '${inviteOrgId}'`)[0].n;

  const r1 = await parse(ownerJar);
  t.check('dated 2026-01-15 → 422', r1.status === 422, JSON.stringify(r1.data));
  t.check('says so, with both dates', r1.data?.before_start_date === true
    && r1.data.invoice_date === '2026-01-15' && r1.data.start_date === '2026-03-01');
  t.check('nothing saved', sql(`SELECT COUNT(*) AS n FROM invoices WHERE org_id = '${inviteOrgId}'`)[0].n === invoicesBefore);
  t.check('the read still counts toward the cap',
    sql(`SELECT COUNT(*) AS n FROM ai_parse_log WHERE org_id = '${inviteOrgId}'`)[0].n === logBefore + 1);

  // A page added to an invoice already in this account is not refused.
  const own = await post('/api/tables/invoices', { vendor: 'Test', invoice_number: `SD-${STAMP}`, status: 'Action Required' }, ownerJar);
  const ownId = own.data?.id || own.data?.data?.id;
  const r2 = await parse(ownerJar, { invoice_id: ownId });
  t.check("adding a page to the account's own invoice is allowed", r2.status === 200, JSON.stringify(r2.data).slice(0, 200));

  // Another account's invoice id must not unlock it.
  const otherInv = sql(`SELECT id FROM invoices WHERE org_id IS NOT NULL AND org_id <> '${inviteOrgId}' LIMIT 1`)[0]?.id;
  if (otherInv) {
    const r3 = await parse(ownerJar, { invoice_id: otherInv });
    t.check("another account's invoice id does not bypass it", r3.status === 422);
  }
} else {
  console.log('\n  (skipping the AI-reading checks — run with TEST_AI=1 to include them)');
}

t.done();

// A one-page PDF with a dated invoice on it, built by hand so the test needs no
// dependencies. Offsets in the xref table are computed, not typed.
function tinyInvoicePdf(date) {
  const lines = [
    'TEST FOODS LTD', 'INVOICE #SD-1001', `Invoice Date: ${date}`, '',
    'Qty  Item                 Unit Price   Total', '2    All Purpose Flour 10kg   15.00   30.00', '',
    'Subtotal 30.00', 'Total 30.00',
  ];
  const text = lines.map((l, i) => `BT /F1 12 Tf 50 ${750 - i * 18} Td (${l}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
