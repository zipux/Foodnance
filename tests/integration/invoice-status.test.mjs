// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run build && npm run dev:sandbox     (in another terminal)
//   npm run test:invoice-status
//
// The server owns invoices.status (guardInvoiceWrite, 2026-10-03):
//   · a new invoice is 'Action Required' whatever the browser sends
//   · the only status move is Action Required → Closed (approving)
//   · a Closed invoice can't be reopened or deleted (void it instead)
//   · voided_at / void_reason can't be written by PATCH — void/restore routes only
//   · Save Changes on a posted invoice (no status sent, or the same one) still works
//   · /api/ensure-invoice makes a 'Manual Entry' record (was 'In Processing')
//   · all of it scoped to the caller's own organization
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
function absorb(j, res) {
  const raw = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean);
  for (const line of raw) {
    const [pair] = String(line).split(';'); const i = pair.indexOf('=');
    if (i > 0) j.cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
}
async function call(method, path, body, j) {
  const cookie = Object.entries(j.cookies).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  absorb(j, res);
  return { status: res.status, data: await res.json().catch(() => null) };
}
const statusOf = (id) => sql(`SELECT status, voided_at FROM invoices WHERE id = '${id}'`)[0];

const t = suite('integration/invoice-status');

// ── Setup: two accounts ───────────────────────────────────────
const admin = jar();
const al = await call('POST', '/api/auth/login', { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' }, admin);
if (al.status !== 200) { console.error('\n  Cannot sign in as the local super-admin.\n'); process.exit(1); }
async function account(tag) {
  const email = `status-${tag}-${STAMP}@test.local`, password = `status-${tag}-pw-1`;
  const o = await call('POST', '/api/admin/organizations', { name: `Status ${tag} ${STAMP}`, owner_email: email, owner_password: password, owner_name: tag }, admin);
  // Off the first-month operator check (migration 0060) — that has its own test
  // (invoice-processing); this one is about the Action Required → Closed rules.
  await call('POST', `/api/admin/organizations/${o.data?.organization?.id}/review-mode`, { mode: 'direct' }, admin);
  const j = jar();
  await call('POST', '/api/auth/login', { email, password }, j);
  return { j, orgId: o.data?.organization?.id };
}
const A = await account('a');
const B = await account('b');
t.check('two test accounts', !!A.orgId && !!B.orgId);

t.section('creating');
const c1 = await call('POST', '/api/tables/invoices', { vendor: 'V', invoice_number: `S1-${STAMP}`, status: 'Closed' }, A.j);
t.check('a new invoice sent as Closed is stored as Action Required (account not being checked)', c1.status === 201 && statusOf(c1.data.id).status === 'Action Required');
const c2 = await call('POST', '/api/tables/invoices', { vendor: 'V', invoice_number: `S2-${STAMP}`, voided_at: '2026-01-01' }, A.j);
t.check('voided_at cannot be set on create', statusOf(c2.data.id).voided_at === null);
const c3 = await call('POST', '/api/tables/invoices', { vendor: 'V', invoice_number: `S3-${STAMP}` }, A.j);
t.check('no status sent → Action Required', statusOf(c3.data.id).status === 'Action Required');

t.section('moving status');
const toManual = await call('PATCH', `/api/tables/invoices/${c1.data.id}`, { status: 'Manual Entry' }, A.j);
t.check('Action Required → Manual Entry is refused', toManual.status === 409 && statusOf(c1.data.id).status === 'Action Required');
const close = await call('PATCH', `/api/tables/invoices/${c1.data.id}`, { status: 'Closed', parsed_data: '' }, A.j);
t.check('Action Required → Closed (approving) is allowed', close.status === 200 && statusOf(c1.data.id).status === 'Closed');
const reopen = await call('PATCH', `/api/tables/invoices/${c1.data.id}`, { status: 'Action Required' }, A.j);
t.check('Closed → Action Required is refused', reopen.status === 409 && statusOf(c1.data.id).status === 'Closed');
const reopenPut = await call('PUT', `/api/tables/invoices/${c1.data.id}`, { vendor: 'V', status: 'Action Required' }, A.j);
t.check('...also through PUT', reopenPut.status === 409 && statusOf(c1.data.id).status === 'Closed');
const edit = await call('PATCH', `/api/tables/invoices/${c1.data.id}`, { notes: 'edited', total: 12.5 }, A.j);
t.check('Save Changes on a Closed invoice (no status) works', edit.status === 200
  && sql(`SELECT notes FROM invoices WHERE id = '${c1.data.id}'`)[0].notes === 'edited');
const same = await call('PATCH', `/api/tables/invoices/${c1.data.id}`, { status: 'Closed', notes: 'again' }, A.j);
t.check('sending the status it already has is fine (older cached pages)', same.status === 200);

t.section('voiding');
const fakeVoid = await call('PATCH', `/api/tables/invoices/${c1.data.id}`, { voided_at: '2026-01-01', void_reason: 'x' }, A.j);
t.check('a PATCH cannot void (nothing left to update)', fakeVoid.status === 400 && statusOf(c1.data.id).voided_at === null);
const v = await call('POST', `/api/invoices/${c1.data.id}/void`, { reason: 'test' }, A.j);
t.check('the void route still works', v.status === 200 && !!statusOf(c1.data.id).voided_at);
const r = await call('POST', `/api/invoices/${c1.data.id}/restore`, {}, A.j);
t.check('the restore route still works', r.status === 200 && statusOf(c1.data.id).voided_at === null);
// A voided draft must not be approvable.
await call('POST', `/api/invoices/${c3.data.id}/void`, { reason: 'test' }, A.j);
const closeVoided = await call('PATCH', `/api/tables/invoices/${c3.data.id}`, { status: 'Closed' }, A.j);
t.check('a voided draft cannot be approved', closeVoided.status === 409 && statusOf(c3.data.id).status === 'Action Required');

t.section('deleting');
const delClosed = await call('DELETE', `/api/tables/invoices/${c1.data.id}`, null, A.j);
t.check('a Closed invoice cannot be deleted', delClosed.status === 409 && !!statusOf(c1.data.id));
const delDraft = await call('DELETE', `/api/tables/invoices/${c2.data.id}`, null, A.j);
t.check('a draft can still be deleted', delDraft.status === 204 && !statusOf(c2.data.id));

t.section('other accounts');
const cross = await call('PATCH', `/api/tables/invoices/${c3.data.id}`, { notes: 'not yours' }, B.j);
t.check("another account's invoice: not found", cross.status === 404);
const crossDel = await call('DELETE', `/api/tables/invoices/${c3.data.id}`, null, B.j);
t.check("another account cannot delete it", crossDel.status === 404 && !!statusOf(c3.data.id));

t.section('manual entry record');
const ens = await call('POST', '/api/ensure-invoice', { file_key: `uploads/${A.orgId}/st-${STAMP}.pdf`, file_name: 'x.pdf', vendor: 'V' }, A.j);
t.check("ensure-invoice makes a 'Manual Entry' record", ens.status === 200 && statusOf(ens.data.id).status === 'Manual Entry');
const manualClose = await call('PATCH', `/api/tables/invoices/${ens.data.id}`, { status: 'Closed' }, A.j);
t.check('a Manual Entry cannot be closed by PATCH', manualClose.status === 409);

t.done();
