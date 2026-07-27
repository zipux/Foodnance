// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run dev:sandbox        (in another terminal)
//   npm run test:lifecycle
//
// Proves the three account states actually behave, end to end:
//
//   active     everything works
//   suspended  can sign in and read; every write refused with 402; the session
//              endpoints (sign out, change password) keep working
//   archived   sign-in refused with an honest message, existing sessions dead,
//              data still present so it can be restored or exported
//   purged     gone, and only reachable via archived + exact-name confirmation
//
// The suspension gate lives in one middleware, so the risk isn't that it fails
// to block — it's that it blocks too much (locking someone out of the banner
// explaining why) or too little (a write path that skips it). Both directions
// are checked below.
import { suite } from '../helpers/assert.mjs';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const STAMP = Date.now().toString(36);
const ADMIN = { email: `lifecycle-admin-${STAMP}@test.local`, password: 'lifecycle-admin-pw-1' };

function jar() { return { cookies: {} }; }
function jarHeader(j) {
  const pairs = Object.entries(j?.cookies || {}).filter(([, v]) => v !== '');
  return pairs.length ? pairs.map(([k, v]) => `${k}=${v}`).join('; ') : '';
}
function absorbCookies(j, res) {
  if (!j) return;
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  for (const line of raw) {
    const [pair] = String(line).split(';');
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    j.cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
}
async function call(j, method, path, body) {
  const cookie = jarHeader(j);
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  absorbCookies(j, res);
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}
const get  = (j, p)    => call(j, 'GET', p);
const post = (j, p, b) => call(j, 'POST', p, b);
const del  = (j, p, b) => call(j, 'DELETE', p, b);

const t = suite('integration/account-lifecycle');

// ── Setup ────────────────────────────────────────────────────────
const admin = jar();
const boot = await post(admin, '/api/auth/bootstrap', { ...ADMIN, name: 'Lifecycle Test' });
if (boot.status === 409) {
  const login = await post(admin, '/api/auth/login', {
    email: 'simoneisonni@gmail.com', password: 'correct-horse-battery',
  });
  if (login.status !== 200) {
    console.error('\n  Cannot get a super-admin session. Start from a fresh local database.\n');
    process.exit(1);
  }
} else if (boot.status === 200) {
  await post(admin, '/api/auth/login', ADMIN);
}

const ORG = {
  name: `Lifecycle ${STAMP}`,
  email: `lifecycle-owner-${STAMP}@test.local`,
  password: 'lifecycle-owner-pw-1',
};
const created = await post(admin, '/api/admin/organizations', {
  name: ORG.name, owner_email: ORG.email, owner_password: ORG.password, account_type: 'restaurant',
});
t.check('test restaurant created', created.status === 200, JSON.stringify(created.data));
const orgId = created.data?.organization?.id;

const owner = jar();
await post(owner, '/api/auth/login', { email: ORG.email, password: ORG.password });

const suspend = (reason) => post(admin, `/api/admin/organizations/${orgId}/suspend`, { reason });
const restore = ()       => post(admin, `/api/admin/organizations/${orgId}/restore`, {});
const archive = ()       => post(admin, `/api/admin/organizations/${orgId}/archive`, {});

// ── Active ───────────────────────────────────────────────────────
let r = await post(owner, '/api/tables/suppliers', { name: `Before ${STAMP}` });
t.check('active: can create data', r.status === 200 || r.status === 201, `status ${r.status}`);

// ── Suspended ────────────────────────────────────────────────────
r = await suspend('Payment overdue');
t.check('suspend succeeds', r.status === 200, JSON.stringify(r.data));

r = await get(owner, '/api/tables/suppliers');
t.check('suspended: reading still works', r.status === 200, `status ${r.status}`);

r = await post(owner, '/api/tables/suppliers', { name: `During ${STAMP}` });
t.check('suspended: creating is refused with 402', r.status === 402, `status ${r.status}`);
t.check('suspended: refusal explains why',
  /paused|overdue/i.test(r.data?.error || ''), r.data?.error);

r = await call(owner, 'PATCH', '/api/tables/suppliers/anything', { name: 'x' });
t.check('suspended: editing is refused too', r.status === 402, `status ${r.status}`);

r = await del(owner, '/api/tables/suppliers/anything');
t.check('suspended: deleting is refused too', r.status === 402, `status ${r.status}`);

// The expensive one — this is the marginal cost the pause is protecting.
r = await post(owner, '/api/ai/parse-recipe', { text: '1 kg flour', products: [] });
t.check('suspended: AI parsing is refused', r.status === 402, `status ${r.status}`);

// They must still be able to sign in, or they never see the explanation.
const owner2 = jar();
r = await post(owner2, '/api/auth/login', { email: ORG.email, password: ORG.password });
t.check('suspended: can still sign in', r.status === 200, `status ${r.status}`);
t.check('suspended: session reports the pause', r.data?.user?.suspended === true,
  JSON.stringify(r.data?.user));

r = await get(owner, '/api/auth/me');
t.check('suspended: /me still answers', r.status === 200, `status ${r.status}`);
t.check('suspended: /me carries the reason', r.data?.user?.suspend_reason === 'Payment overdue',
  JSON.stringify(r.data?.user?.suspend_reason));

// Exempt writes: locking these would be spite, not leverage.
r = await post(owner, '/api/auth/change-password', {
  current_password: ORG.password, new_password: ORG.password,
});
t.check('suspended: change-password is not blocked by the pause',
  r.status !== 402, `status ${r.status}`);

// The operator must never be caught by a customer's billing state.
r = await get(admin, '/api/admin/organizations');
t.check('suspended: super-admin is unaffected', r.status === 200, `status ${r.status}`);

// ── Restored ─────────────────────────────────────────────────────
r = await restore();
t.check('restore succeeds', r.status === 200, JSON.stringify(r.data));

r = await post(owner, '/api/tables/suppliers', { name: `After ${STAMP}` });
t.check('restored: writing works again', r.status === 200 || r.status === 201, `status ${r.status}`);

// ── Archived ─────────────────────────────────────────────────────
r = await archive();
t.check('archive succeeds', r.status === 200, JSON.stringify(r.data));

const owner3 = jar();
r = await post(owner3, '/api/auth/login', { email: ORG.email, password: ORG.password });
t.check('archived: sign-in refused', r.status === 403, `status ${r.status}`);
t.check('archived: told the account is closed, not "wrong password"',
  /closed/i.test(r.data?.error || '') && !/incorrect/i.test(r.data?.error || ''), r.data?.error);

r = await get(owner, '/api/tables/suppliers');
t.check('archived: existing session is dead too', r.status === 403, `status ${r.status}`);

// ── Purge guards ─────────────────────────────────────────────────
r = await restore();
r = await del(admin, `/api/admin/organizations/${orgId}`, { confirm_name: ORG.name });
t.check('purge refused while the account is live', r.status === 409, `status ${r.status}`);

const stillThere = await get(admin, '/api/admin/organizations');
t.check('nothing was deleted by the refused purge',
  (stillThere.data?.data || []).some(o => o.id === orgId));

await archive();
r = await del(admin, `/api/admin/organizations/${orgId}`, { confirm_name: 'Not The Name' });
t.check('purge refused when the typed name is wrong', r.status === 400, `status ${r.status}`);

const stillThere2 = await get(admin, '/api/admin/organizations');
t.check('nothing was deleted by the mistyped purge',
  (stillThere2.data?.data || []).some(o => o.id === orgId));

// ── Purge ────────────────────────────────────────────────────────
r = await del(admin, `/api/admin/organizations/${orgId}`, { confirm_name: ORG.name });
t.check('purge succeeds when archived and confirmed', r.status === 200, JSON.stringify(r.data));

const after = await get(admin, '/api/admin/organizations');
t.check('restaurant is gone from the list',
  !(after.data?.data || []).some(o => o.id === orgId));

const owner4 = jar();
r = await post(owner4, '/api/auth/login', { email: ORG.email, password: ORG.password });
t.check('purged: the owner login no longer exists', r.status === 401, `status ${r.status}`);

t.done();
