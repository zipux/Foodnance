// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run build && npm run dev:sandbox     (in another terminal)
//   npm run test:processing
//
// Operator check — the 'Processing' status (migration 0060):
//   · a new account's uploads go to Processing during its first month
//   · the customer can see and delete a Processing invoice, turn its photo,
//     and nothing else — no edits, no approving
//   · the operator (viewing as) can edit it and Release it: → Action Required,
//     corrections carried in parsed_data and onto the row, marked checked
//   · the customer can then approve it as usual
//   · per-account switch: Don't check → straight to Action Required;
//     Always check → Processing even after the first month; First month →
//     off once the 30 days are over
//   · 48 hours unreleased → released on the next look, marked auto_released_at,
//     left unchecked
//   · only a super-admin can switch or release
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
const row = (id) => sql(`SELECT status, vendor, total, parsed_data, reviewed_by, reviewed_at, auto_released_at, page_rotations, notes FROM invoices WHERE id = '${id}'`)[0];
const upload = (j, n) => call('POST', '/api/tables/invoices', {
  vendor: 'AI Vendor', invoice_number: `P${n}-${STAMP}`, total: 10, status: 'Action Required',
  parsed_data: JSON.stringify({ vendor: 'AI Vendor', total: 10, items: [{ name: 'Flour', qty: 1, unit_price: 10, cost: 10 }] }),
}, j);

const t = suite('integration/invoice-processing');

// ── Setup ─────────────────────────────────────────────────────
const admin = jar();
const al = await call('POST', '/api/auth/login', { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' }, admin);
if (al.status !== 200) { console.error('\n  Cannot sign in as the local super-admin.\n'); process.exit(1); }
const EMAIL = `proc-${STAMP}@test.local`, PW = 'proc-owner-pw-1';
const o = await call('POST', '/api/admin/organizations', { name: `Proc ${STAMP}`, owner_email: EMAIL, owner_password: PW, owner_name: 'P' }, admin);
const orgId = o.data?.organization?.id;
const cust = jar();
await call('POST', '/api/auth/login', { email: EMAIL, password: PW }, cust);   // first sign-in → first month starts
t.check('test account started', !!sql(`SELECT started_at FROM organizations WHERE id = '${orgId}'`)[0]?.started_at);

t.section('first month: uploads go to Processing');
const u1 = await upload(cust, 1);
t.check('saved as Processing (whatever the page sent)', u1.status === 201 && u1.data.status === 'Processing' && row(u1.data.id).status === 'Processing');

t.section('the customer can only look, turn the photo, or delete');
const ed = await call('PATCH', `/api/tables/invoices/${u1.data.id}`, { notes: 'mine' }, cust);
t.check('editing is refused', ed.status === 409 && row(u1.data.id).notes !== 'mine');
const ap = await call('PATCH', `/api/tables/invoices/${u1.data.id}`, { status: 'Closed' }, cust);
t.check('approving is refused', ap.status === 409 && row(u1.data.id).status === 'Processing');
const rot = await call('PATCH', `/api/tables/invoices/${u1.data.id}`, { page_rotations: '{"k":90}' }, cust);
t.check('turning the photo is allowed', rot.status === 200 && row(u1.data.id).page_rotations === '{"k":90}');
const selfRelease = await call('POST', `/api/admin/invoices/${u1.data.id}/release`, {}, cust);
t.check('the customer cannot release it', selfRelease.status === 403 && row(u1.data.id).status === 'Processing');
const u2 = await upload(cust, 2);
const del = await call('DELETE', `/api/tables/invoices/${u2.data.id}`, null, cust);
t.check('deleting is allowed (wrong file, duplicate)', del.status === 204 && !row(u2.data.id));

t.section('admin screen');
let list = (await call('GET', '/api/admin/organizations', null, admin)).data?.data || [];
let me = list.find(x => x.id === orgId);
t.check('counts it as waiting to release', me?.processing_count === 1 && me?.processing_oldest_id === u1.data.id);
t.check('says this account is being checked', me?.reviewing_now === true);

t.section('the operator checks and releases it');
await call('POST', '/api/admin/view-as', { org_id: orgId }, admin);
const fix = await call('PATCH', `/api/tables/invoices/${u1.data.id}`, { notes: 'operator note' }, admin);
t.check('the operator can edit it while Processing', fix.status === 200);
const corrected = { vendor: 'Fixed Vendor Ltd', invoice_number: `P1-${STAMP}`, total: 12.5,
  items: [{ name: 'Flour 10kg', qty: 1, unit_price: 12.5, cost: 12.5, link_product_id: 'abc', link_product_name: 'Flour' }] };
const rel = await call('POST', `/api/admin/invoices/${u1.data.id}/release`, { parsed_data: JSON.stringify(corrected) }, admin);
const r1 = row(u1.data.id);
t.check('released → Action Required', rel.status === 200 && r1.status === 'Action Required');
t.check('marked checked by the operator', r1.reviewed_by === 'simoneisonni@gmail.com' && !!r1.reviewed_at);
t.check('corrections carried in parsed_data', JSON.parse(r1.parsed_data).items[0].name === 'Flour 10kg');
t.check('headline copied onto the row (the list shows it)', r1.vendor === 'Fixed Vendor Ltd' && Number(r1.total) === 12.5);
const again = await call('POST', `/api/admin/invoices/${u1.data.id}/release`, {}, admin);
t.check('releasing twice is refused', again.status === 409);
const badJson = await upload(cust, 3);
const bj = await call('POST', `/api/admin/invoices/${badJson.data.id}/release`, { parsed_data: '{not json' }, admin);
t.check('broken parsed_data is refused, nothing moves', bj.status === 400 && row(badJson.data.id).status === 'Processing');
await call('POST', '/api/admin/view-as', { org_id: null }, admin);

t.section('the customer approves it as usual');
const ok = await call('PATCH', `/api/tables/invoices/${u1.data.id}`, { status: 'Closed', parsed_data: '' }, cust);
t.check('Action Required → Closed', ok.status === 200 && row(u1.data.id).status === 'Closed');

t.section('48 hours unreleased → released on the next look');
sql(`UPDATE invoices SET created_at = datetime('now', '-49 hours') WHERE id = '${badJson.data.id}'`);
const u4 = await upload(cust, 4);   // fresh one, must stay put
await call('GET', '/api/tables/invoices', null, cust);
const r3 = row(badJson.data.id);
t.check('the overdue one is now Action Required', r3.status === 'Action Required');
t.check('marked auto-released, and NOT marked checked', !!r3.auto_released_at && !r3.reviewed_at);
t.check('a fresh one stays in Processing', row(u4.data.id).status === 'Processing');
sql(`UPDATE invoices SET created_at = datetime('now', '-49 hours') WHERE id = '${u4.data.id}'`);
await call('GET', '/api/admin/organizations', null, admin);
t.check('the admin screen also runs the release', row(u4.data.id).status === 'Action Required');

t.section('per-account switch');
const custSwitch = await call('POST', `/api/admin/organizations/${orgId}/review-mode`, { mode: 'direct' }, cust);
t.check('a customer cannot switch it', custSwitch.status === 403);
const bad = await call('POST', `/api/admin/organizations/${orgId}/review-mode`, { mode: 'sometimes' }, admin);
t.check('an unknown mode is refused', bad.status === 400);
const d = await call('POST', `/api/admin/organizations/${orgId}/review-mode`, { mode: 'direct' }, admin);
t.check("Don't check → reviewing_now false", d.status === 200 && d.data.reviewing_now === false);
t.check('...and uploads go straight to Action Required', (await upload(cust, 5)).data.status === 'Action Required');
sql(`UPDATE organizations SET started_at = datetime('now', '-40 days') WHERE id = '${orgId}'`);
await call('POST', `/api/admin/organizations/${orgId}/review-mode`, { mode: 'auto' }, admin);
t.check('First month, 40 days in → Action Required', (await upload(cust, 6)).data.status === 'Action Required');
list = (await call('GET', '/api/admin/organizations', null, admin)).data?.data || [];
t.check('...and the admin screen agrees', list.find(x => x.id === orgId)?.reviewing_now === false
  && list.find(x => x.id === orgId)?.review_mode === null);
await call('POST', `/api/admin/organizations/${orgId}/review-mode`, { mode: 'processing' }, admin);
t.check('Always check, 40 days in → Processing', (await upload(cust, 7)).data.status === 'Processing');

t.done();
