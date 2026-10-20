// INTEGRATION — needs a running sandbox and writes to the local D1.
//   0066 applied locally (by file)
//   npm run build && npm run dev:sandbox     (in another terminal)
//   npm run test:fee-template
//
// A supplier's fee template (delivery, taxes, other costs remembered for the
// next invoice) belongs to one business. Before 0066 the supplier name was
// unique across ALL businesses: once one had a template for "Sysco", the next
// business's save failed (silently, from the invoice screen) and renaming a
// supplier into that name failed half-way through the rename.
import { suite } from '../helpers/assert.mjs';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const STAMP = Date.now().toString(36);

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

const t = suite('integration/fee-template-per-org');

const admin = jar();
const al = await call('POST', '/api/auth/login', { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' }, admin);
if (al.status !== 200) { console.error('\n  Cannot sign in as the local super-admin.\n'); process.exit(1); }
async function account(tag) {
  const email = `fee-${tag}-${STAMP}@test.local`, password = `fee-${tag}-pw-1`;
  const r = await call('POST', '/api/admin/organizations', { name: `Fee ${tag} ${STAMP}`, owner_email: email, owner_password: password, owner_name: tag }, admin);
  // Plain accounts: no operator check, so nothing waits on Processing.
  await call('POST', `/api/admin/organizations/${r.data.organization.id}/review-mode`, { mode: 'direct' }, admin);
  const j = jar();
  await call('POST', '/api/auth/login', { email, password }, j);
  return j;
}
const A = await account('a');
const B = await account('b');

const SYSCO = `Sysco ${STAMP}`;
const save = (j, vendor_name, delivery) => call('POST', '/api/vendor-fee-template', { vendor_name, delivery }, j);
const read = async (j, vendor) => (await call('GET', `/api/vendor-fee-template?vendor=${encodeURIComponent(vendor)}`, null, j)).data;

t.section('two businesses, one supplier name');
let r = await save(A, SYSCO, 10);
t.check('the first business saves its fees', r.status === 200 && r.data?.created === true, JSON.stringify(r.data));
r = await save(B, SYSCO, 25);
t.check('the second business can save its own (was a constraint error)', r.status === 200 && r.data?.created === true, JSON.stringify(r.data));
t.check('each reads back its own fees', (await read(A, SYSCO)).template?.delivery === 10 && (await read(B, SYSCO)).template?.delivery === 25);

t.section('one business, one template per supplier');
const first = (await read(A, SYSCO)).template?.id;
r = await save(A, `  ${SYSCO.toUpperCase()} `, 12);
t.check('saving again (other case, spaces) updates the same template', r.status === 200 && r.data?.created === false && r.data?.id === first, JSON.stringify(r.data));
t.check('...to the new fee', (await read(A, SYSCO)).template?.delivery === 12);
t.check("...and the other business's is untouched", (await read(B, SYSCO)).template?.delivery === 25);

t.section('renaming a supplier into a name another business uses');
const OLD = `Local Foods ${STAMP}`;
const sup = await call('POST', '/api/tables/suppliers', { name: OLD }, B);
const bId = sup.data?.id;
await save(B, OLD, 7);
const GORDON = `Gordon ${STAMP}`;
await save(A, GORDON, 30);
r = await call('PUT', `/api/suppliers/${bId}`, { name: GORDON }, B);
t.check('the rename goes through (was an error after part of the rename)', r.status === 200, JSON.stringify(r));
t.check('the fees moved with the supplier', (await read(B, GORDON)).template?.delivery === 7 && (await read(B, OLD)).found === false);
t.check("the other business's template is untouched", (await read(A, GORDON)).template?.delivery === 30);

t.section('renaming into a name this business already has fees for (as before)');
const TWO = `Second Supplier ${STAMP}`;
const sup2 = await call('POST', '/api/tables/suppliers', { name: TWO }, B);
await save(B, TWO, 3);
r = await call('PUT', `/api/suppliers/${sup2.data?.id}`, { name: SYSCO }, B);
t.check('the rename goes through', r.status === 200, JSON.stringify(r));
t.check("the existing template wins, the renamed one's is dropped",
  (await read(B, SYSCO)).template?.delivery === 25 && (await read(B, TWO)).found === false);

t.done();
