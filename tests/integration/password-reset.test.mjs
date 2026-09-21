// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run dev:sandbox        (in another terminal)
//   npm run test:reset
//
// Proves the forgot-password flow end to end, and above all the parts that stop
// it being aimed at somebody else:
//   · five wrong passwords in a row → exactly one automatic link, then a cap
//   · a right password in between restarts the count
//   · an unknown address is answered exactly like a known one
//   · a link works once, expires, and the old password dies with it
//
// The raw token only ever exists in the email, so where the test needs one it
// plants a token of its own by writing that token's SHA-256 straight into the
// local database — the same shape the server stores.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { suite } from '../helpers/assert.mjs';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const STAMP = Date.now().toString(36);
const OWNER = { email: `reset-owner-${STAMP}@test.local`, password: 'reset-owner-pw-1' };

function sql(q) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'invoicedb-production', '--local', '--json', '--command', q],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results || [];
}
const sha = (s) => createHash('sha256').update(s).digest('hex');

function jar() { return { cookies: {} }; }
function absorb(j, res) {
  const raw = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean);
  for (const line of raw) {
    const [pair] = String(line).split(';'); const i = pair.indexOf('=');
    if (i > 0) j.cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
}
async function post(path, body, j) {
  const cookie = j ? Object.entries(j.cookies).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ') : '';
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  if (j) absorb(j, res);
  return { status: res.status, data: await res.json().catch(() => null) };
}
const login = (pw, email = OWNER.email) => post('/api/auth/login', { email, password: pw });
const state = () => sql(`SELECT u.id, u.failed_logins AS f,
    (SELECT COUNT(*) FROM password_resets r WHERE r.user_id = u.id) AS resets,
    (SELECT COUNT(*) FROM password_resets r WHERE r.user_id = u.id AND r.reason = 'lockout') AS lockouts
  FROM users u WHERE u.email = '${OWNER.email}'`)[0];
const plant = (userId, token, expiresSql = "datetime('now', '+30 minutes')") =>
  sql(`INSERT INTO password_resets (id, user_id, token_hash, reason, expires_at)
       VALUES ('t${Math.random().toString(36).slice(2, 10)}', '${userId}', '${sha(token)}', 'requested', ${expiresSql})`);
const spendAll = (userId) => sql(`UPDATE password_resets SET used_at = datetime('now') WHERE user_id = '${userId}' AND used_at IS NULL`);

const t = suite('integration/password-reset');

// ── Setup: a super-admin session, then a fresh org + owner ───────
const adminJar = jar();
const al = await post('/api/auth/login', { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' }, adminJar);
if (al.status !== 200) { console.error('\n  Cannot sign in as the local super-admin.\n'); process.exit(1); }
const org = await post('/api/admin/organizations',
  { name: `Reset ${STAMP}`, owner_email: OWNER.email, owner_password: OWNER.password, owner_name: 'Reset Owner' }, adminJar);
t.check('test account created', org.status === 200 || org.status === 201, JSON.stringify(org.data));
const uid = state().id;

t.section('the migration landed');
t.check('users.failed_logins starts at 0', state().f === 0);

t.section('four wrong passwords: counted, no email yet');
for (let i = 0; i < 4; i++) {
  const r = await login('wrong-password');
  if (i === 0) t.check('wrong password is a 401 with the generic message',
    r.status === 401 && r.data.error === 'Email or password is incorrect.');
}
t.check('counter is 4', state().f === 4);
t.check('no reset link yet', state().resets === 0);

t.section('a right password in the middle restarts the streak');
t.check('correct login works', (await login(OWNER.password)).status === 200);
t.check('counter back to 0', state().f === 0);
for (let i = 0; i < 4; i++) await login('wrong-password');
t.check('four more wrong is still only 4 — not 8', state().f === 4 && state().resets === 0);

t.section('the fifth in a row sends exactly one link');
const fifth = await login('wrong-password');
t.check('the fifth answer is identical to the first', fifth.status === 401 && fifth.data.error === 'Email or password is incorrect.');
await new Promise(r => setTimeout(r, 400));
t.check('one automatic reset link was created', state().lockouts === 1);
t.check('counter restarted', state().f === 0);

t.section('typing wrong passwords again cannot flood the owner');
for (let i = 0; i < 10; i++) await login('wrong-password');
await new Promise(r => setTimeout(r, 400));
t.check('ten more wrong passwords → still one lockout link this hour', state().lockouts === 1);
t.check('the account is NOT locked — the right password still works', (await login(OWNER.password)).status === 200);

t.section('Forgot password gives the same answer for every address');
const known   = await post('/api/auth/forgot-password', { email: OWNER.email });
const unknown = await post('/api/auth/forgot-password', { email: `nobody-${STAMP}@test.local` });
t.check('known address → 200 {ok:true}', known.status === 200 && known.data?.ok === true);
t.check('unknown address → the exact same status and body',
  unknown.status === known.status && JSON.stringify(unknown.data) === JSON.stringify(known.data));
t.check('a malformed address is rejected on shape alone', (await post('/api/auth/forgot-password', { email: 'nope' })).status === 400);
t.check('the response never contains a link or token',
  !/token|reset-password/.test(JSON.stringify(known.data)));

t.section('requested links are capped at 3 an hour');
for (let i = 0; i < 6; i++) await post('/api/auth/forgot-password', { email: OWNER.email });
const requested = sql(`SELECT COUNT(*) AS n FROM password_resets WHERE user_id = '${uid}' AND reason = 'requested'`)[0].n;
t.check(`six requests → at most 3 links (got ${requested})`, requested <= 3 && requested >= 1);

t.section('using a link');
spendAll(uid);
const good = `good-${STAMP}-${'a'.repeat(40)}`;
plant(uid, good);
t.check('lookup accepts a live link', (await post('/api/auth/reset-lookup', { token: good })).status === 200);
t.check('lookup rejects a made-up token', (await post('/api/auth/reset-lookup', { token: 'nonsense' })).status === 404);
t.check('a too-short password is refused and does NOT spend the link',
  (await post('/api/auth/reset-password', { token: good, password: 'short' })).status === 400
  && (await post('/api/auth/reset-lookup', { token: good })).status === 200);

const fresh = jar();
const done = await post('/api/auth/reset-password', { token: good, password: 'brand-new-pw-9' }, fresh);
t.check('reset succeeds', done.status === 200 && done.data?.ok === true);
t.check('and signs the user in', !!fresh.cookies.dm_session);
t.check('the OLD password no longer works', (await login(OWNER.password)).status === 401);
t.check('the new password works', (await login('brand-new-pw-9')).status === 200);
t.check('the streak was cleared', state().f === 0);
t.check('the link cannot be used twice', (await post('/api/auth/reset-password', { token: good, password: 'another-pw-77' })).status === 404);
t.check('...nor looked up again', (await post('/api/auth/reset-lookup', { token: good })).status === 404);

t.section('expiry and supersession');
const stale = `stale-${STAMP}-${'b'.repeat(40)}`;
plant(uid, stale, "datetime('now', '-1 minute')");
t.check('an expired link is refused', (await post('/api/auth/reset-password', { token: stale, password: 'whatever-pw-1' })).status === 404);
const older = `older-${STAMP}-${'c'.repeat(40)}`, newer = `newer-${STAMP}-${'d'.repeat(40)}`;
plant(uid, older); plant(uid, newer);
t.check('both live before a reset', (await post('/api/auth/reset-lookup', { token: older })).status === 200);
t.check('using one link spends its siblings',
  (await post('/api/auth/reset-password', { token: newer, password: 'newest-pw-123' })).status === 200
  && (await post('/api/auth/reset-lookup', { token: older })).status === 404);

t.section('a closed account gets no link');
sql(`UPDATE organizations SET archived_at = datetime('now') WHERE id = (SELECT org_id FROM users WHERE id = '${uid}')`);
const before = sql(`SELECT COUNT(*) AS n FROM password_resets WHERE user_id = '${uid}'`)[0].n;
spendAll(uid);
await post('/api/auth/forgot-password', { email: OWNER.email });
t.check('no new link for an archived organization',
  sql(`SELECT COUNT(*) AS n FROM password_resets WHERE user_id = '${uid}'`)[0].n === before);
const closed = `closed-${STAMP}-${'e'.repeat(40)}`;
plant(uid, closed);
t.check('and an old link is dead once the account is closed',
  (await post('/api/auth/reset-lookup', { token: closed })).status === 404);

t.done();
