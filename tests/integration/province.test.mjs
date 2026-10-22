// INTEGRATION — needs a running sandbox and 0068 applied locally.
//   npm run db:migrate:local && npm run build && npm run dev:sandbox   (another terminal)
//   npm run test:province
//
// A business's province (migration 0068) names the taxes on its screens:
//   · "Add a restaurant" stores the province picked (BC when none is sent)
//   · an unknown province (or Quebec) is refused before anything is created
//   · /api/auth/me tells the screens the province of the business
//   · the admin list shows it, and POST …/province changes it
//   · only a super-admin may change it
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

const t = suite('integration/province');

const admin = jar();
const al = await call('POST', '/api/auth/login', { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' }, admin);
if (al.status !== 200) { console.error('\n  Cannot sign in as the local super-admin.\n'); process.exit(1); }

async function account(tag, province) {
  const email = `prov-${tag}-${STAMP}@test.local`, password = `prov-${tag}-pw-1`;
  const body = { name: `Province ${tag} ${STAMP}`, owner_email: email, owner_password: password, owner_name: tag };
  if (province !== undefined) body.province = province;
  const o = await call('POST', '/api/admin/organizations', body, admin);
  const j = jar();
  if (o.status === 200) await call('POST', '/api/auth/login', { email, password }, j);
  return { o, j, orgId: o.data?.organization?.id };
}
const listed = async (id) => (await call('GET', '/api/admin/organizations', null, admin)).data?.data?.find(r => r.id === id);

t.section('creating');
const on = await account('on', 'ON');
t.check('created in Ontario', on.o.status === 200 && on.o.data.organization.province === 'ON');
const meOn = await call('GET', '/api/auth/me', null, on.j);
t.check('/me says ON', meOn.data?.user?.province === 'ON');
t.check('the admin list says ON', (await listed(on.orgId))?.province === 'ON');

const none = await account('none');
t.check('no province sent: BC', none.o.status === 200 && none.o.data.organization.province === 'BC');
t.check('...and /me says BC', (await call('GET', '/api/auth/me', null, none.j)).data?.user?.province === 'BC');

const lower = await account('lower', 'mb');
t.check('lower case is accepted (stored MB)', lower.o.status === 200 && lower.o.data.organization.province === 'MB');

const qc = await account('qc', 'QC');
t.check('Quebec is refused', qc.o.status === 400);
const bad = await account('bad', 'XX');
t.check('an unknown province is refused', bad.o.status === 400);
const after = (await call('GET', '/api/admin/organizations', null, admin)).data?.data || [];
t.check('...and nothing was created for either', !after.some(r => r.name === `Province qc ${STAMP}` || r.name === `Province bad ${STAMP}`));

t.section('changing');
const ch = await call('POST', `/api/admin/organizations/${on.orgId}/province`, { province: 'AB' }, admin);
t.check('the operator can move it to Alberta', ch.status === 200 && ch.data.province === 'AB');
t.check('/me follows', (await call('GET', '/api/auth/me', null, on.j)).data?.user?.province === 'AB');
const chBad = await call('POST', `/api/admin/organizations/${on.orgId}/province`, { province: 'QC' }, admin);
t.check('...but not to Quebec', chBad.status === 400 && (await listed(on.orgId))?.province === 'AB');
const chMissing = await call('POST', `/api/admin/organizations/nope-${STAMP}/province`, { province: 'ON' }, admin);
t.check('an unknown business: not found', chMissing.status === 404);
const byOwner = await call('POST', `/api/admin/organizations/${on.orgId}/province`, { province: 'BC' }, on.j);
t.check('the owner cannot change it themselves', byOwner.status === 403 && (await listed(on.orgId))?.province === 'AB');

t.section('viewing as');
await call('POST', '/api/admin/view-as', { org_id: lower.orgId }, admin);
t.check("an operator viewing as a customer gets that customer's province", (await call('GET', '/api/auth/me', null, admin)).data?.user?.province === 'MB');
await call('POST', '/api/admin/view-as', { org_id: null }, admin);

t.done();
