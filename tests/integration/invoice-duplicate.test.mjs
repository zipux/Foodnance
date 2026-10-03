// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run build && npm run dev:sandbox     (in another terminal)
//   npm run test:duplicate
//
// The upload page's duplicate block (POST /api/invoices/duplicate-check,
// decided 2026-10-03): a duplicate is the same invoice number AND the same
// supplier. "Same supplier" is the matcher's near-identical tier only, and a
// blank supplier name on either side still blocks. Unchanged from before:
// the number must match exactly, voided invoices still count, and only the
// caller's own organization is searched.
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

const t = suite('integration/invoice-duplicate');

const admin = jar();
const al = await call('POST', '/api/auth/login', { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' }, admin);
if (al.status !== 200) { console.error('\n  Cannot sign in as the local super-admin.\n'); process.exit(1); }
async function account(tag) {
  const email = `dup-${tag}-${STAMP}@test.local`, password = `dup-${tag}-pw-1`;
  await call('POST', '/api/admin/organizations', { name: `Dup ${tag} ${STAMP}`, owner_email: email, owner_password: password, owner_name: tag }, admin);
  const j = jar();
  await call('POST', '/api/auth/login', { email, password }, j);
  return j;
}
const A = await account('a');
const B = await account('b');

const N = `D-${STAMP}`;
const mk = (j, invoice_number, vendor) => call('POST', '/api/tables/invoices', { invoice_number, vendor }, j);
const check = async (j, invoice_number, vendor) => (await call('POST', '/api/invoices/duplicate-check', { invoice_number, vendor }, j)).data;

await mk(A, N, 'Sysco Food');

t.section('same number, same supplier → blocked');
t.check('exact name', (await check(A, N, 'Sysco Food')).duplicate === true);
t.check('different case / spacing', (await check(A, N, '  SYSCO   FOOD ')).duplicate === true);
t.check('near-identical (Sysco Foods / Sysco Food)', (await check(A, N, 'Sysco Foods')).duplicate === true);
const d = await check(A, N, 'Sysco Food');
t.check('reports which invoice it matched', d.match?.vendor === 'Sysco Food' && d.match?.invoice_number === N);

t.section('same number, different supplier → allowed');
t.check('a different supplier', (await check(A, N, 'Gordon Food Service')).duplicate === false);
t.check('a similar but different name (Sysco Food / Sysco Canada)', (await check(A, N, 'Sysco Canada')).duplicate === false);
const NO = `DO-${STAMP}`;
await mk(A, NO, '1088115 B.C. LTD. - Oyster and King');
t.check("the matcher's 'possibly the same' tier is not enough (Oyster and King)", (await check(A, NO, 'Oyster and King')).duplicate === false);

t.section('blank supplier name → blocked');
t.check('new invoice has no supplier name', (await check(A, N, '')).duplicate === true);
const N2 = `D2-${STAMP}`;
await mk(A, N2, '');
t.check('existing invoice has no supplier name', (await check(A, N2, 'Anyone Ltd')).duplicate === true);

t.section('unchanged from before');
t.check('a different number is never a duplicate', (await check(A, `X-${STAMP}`, 'Sysco Food')).duplicate === false);
t.check('no number → no check', (await check(A, '', 'Sysco Food')).duplicate === false);
t.check("another business's invoice doesn't count", (await check(B, N, 'Sysco Food')).duplicate === false);
const N3 = `D3-${STAMP}`;
const v = await mk(A, N3, 'Voided Foods');
await call('POST', `/api/invoices/${v.data.id}/void`, { reason: 'test' }, A);
t.check('a voided invoice still counts (as before)', (await check(A, N3, 'Voided Foods')).duplicate === true);

t.done();
