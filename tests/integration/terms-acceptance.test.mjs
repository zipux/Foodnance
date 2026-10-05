// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run build && npm run dev:sandbox     (in another terminal)
//   npm run db:migrate:local                 (for 0061)
//   npm run test:terms
//
// The Terms acceptance record (migration 0061):
//   · an invite can't be turned into an account without the agreement
//   · agreeing writes the version and the time on the new user, teammates too
//   · an account that predates the record is asked once (/me → terms_due),
//     and POST /api/auth/accept-terms records it and never moves the date
//   · a super-admin is never asked; a paused account can still agree
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
const userRow = (email) => sql(`SELECT terms_version, terms_accepted_at FROM users WHERE email = '${email}'`)[0];

const t = suite('integration/terms-acceptance');

const adminJar = jar();
const al = await post('/api/auth/login', { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' }, adminJar);
if (al.status !== 200) { console.error('\n  Cannot sign in as the local super-admin.\n'); process.exit(1); }
const version = sql(`SELECT 1 AS x`) && (await import('node:fs')).readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8')
  .match(/const TERMS_VERSION = '([^']+)'/)[1];

t.section('a new account needs the tick box');
const NEW = { email: `terms-new-${STAMP}@test.local`, password: 'terms-new-pw-1' };
const no = await post('/api/admin/organizations', { name: `Terms New ${STAMP}`, owner_email: NEW.email, owner_name: 'Newcomer' }, adminJar);
t.check('account created with an invite', no.status === 200 || no.status === 201, JSON.stringify(no.data));
const newOrg = no.data?.organization?.id;
const token = sql(`SELECT token FROM invites WHERE org_id = '${newOrg}'`)[0]?.token;
const base = { token, name: 'Newcomer', email: NEW.email, password: NEW.password };
const refused = await post('/api/auth/accept-invite', base);
t.check('no agreement: refused with 400', refused.status === 400 && /agree/i.test(refused.data?.error || ''), JSON.stringify(refused));
const sly = await post('/api/auth/accept-invite', { ...base, agree: 'true' });
t.check('only a real true counts', sly.status === 400);
t.check('nothing was created by the refusals', !userRow(NEW.email));
t.check('the invite is still good', sql(`SELECT accepted_at FROM invites WHERE token = '${token}'`)[0]?.accepted_at === null);
const newJar = jar();
const ok = await post('/api/auth/accept-invite', { ...base, agree: true }, newJar);
t.check('with the agreement: account made', ok.status === 200, JSON.stringify(ok.data));
const nr = userRow(NEW.email);
t.check('version recorded', nr?.terms_version === version, JSON.stringify(nr));
t.check('time recorded', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(nr?.terms_accepted_at || ''));
const nme = await get('/api/auth/me', newJar);
t.check('they are not asked again', nme.data?.user?.terms_due === false, JSON.stringify(nme.data?.user));

t.section('a teammate agrees for themselves');
const MATE = `terms-mate-${STAMP}@test.local`;
const mi = await post('/api/team/invite', { name: 'Mate', email: MATE }, newJar);
const mateToken = mi.data?.token || sql(`SELECT token FROM invites WHERE org_id = '${newOrg}' AND lower(email) = '${MATE}'`)[0]?.token;
t.check('teammate invited', !!mateToken, JSON.stringify(mi));
const mno = await post('/api/auth/accept-invite', { token: mateToken, name: 'Mate', email: MATE, password: 'terms-mate-pw-1' });
t.check('teammate refused without it', mno.status === 400);
const myes = await post('/api/auth/accept-invite', { token: mateToken, name: 'Mate', email: MATE, password: 'terms-mate-pw-1', agree: true });
t.check('teammate joins with it, recorded separately', myes.status === 200 && !!userRow(MATE)?.terms_accepted_at);

t.section('an account from before the record is asked once');
const OLD = { email: `terms-old-${STAMP}@test.local`, password: 'terms-old-pw-1' };
const oo = await post('/api/admin/organizations',
  { name: `Terms Old ${STAMP}`, owner_email: OLD.email, owner_password: OLD.password, owner_name: 'Oldtimer' }, adminJar);
const oldOrg = oo.data?.organization?.id;
t.check('account created', oo.status === 200 || oo.status === 201, JSON.stringify(oo.data));
t.check('no record to start with', userRow(OLD.email)?.terms_accepted_at === null);
const oldJar = jar();
await post('/api/auth/login', OLD, oldJar);
t.check('/me asks', (await get('/api/auth/me', oldJar)).data?.user?.terms_due === true);
t.check('the app still answers meanwhile (the panel is the ask, not a lockout)', (await get('/api/account/plan', oldJar)).status === 200);
t.check('not signed in: refused', (await post('/api/auth/accept-terms', { agree: true })).status === 401);
t.check('without the agreement: refused', (await post('/api/auth/accept-terms', {}, oldJar)).status === 400);
t.check('still no record', userRow(OLD.email)?.terms_accepted_at === null);
const ag = await post('/api/auth/accept-terms', { agree: true }, oldJar);
t.check('agreeing works', ag.status === 200);
t.check('recorded with the version', userRow(OLD.email)?.terms_version === version && !!userRow(OLD.email)?.terms_accepted_at);
t.check('/me stops asking', (await get('/api/auth/me', oldJar)).data?.user?.terms_due === false);
sql(`UPDATE users SET terms_accepted_at = '2020-01-01 00:00:00' WHERE email = '${OLD.email}'`);
await post('/api/auth/accept-terms', { agree: true }, oldJar);
t.check('pressing again never moves the date', userRow(OLD.email)?.terms_accepted_at === '2020-01-01 00:00:00');
t.check("nobody else's row was touched", userRow(NEW.email)?.terms_accepted_at === nr.terms_accepted_at);

t.section('paused account, and the operator');
sql(`UPDATE users SET terms_version = NULL, terms_accepted_at = NULL WHERE email = '${OLD.email}'`);
await post(`/api/admin/organizations/${oldOrg}/suspend`, { reason: 'test' }, adminJar);
t.check('a paused account can still agree', (await post('/api/auth/accept-terms', { agree: true }, oldJar)).status === 200
  && !!userRow(OLD.email)?.terms_accepted_at);
t.check('a super-admin is never asked', (await get('/api/auth/me', adminJar)).data?.user?.terms_due === false);
const list = await get('/api/admin/organizations', adminJar);
const row = (list.data?.data || []).find(o => o.id === newOrg);
t.check('the admin list shows when the owner agreed', !!row && row.owner_terms_accepted_at === nr.terms_accepted_at, JSON.stringify(row || list.status));

t.done();
