// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run db:migrate:local   (once, for 0052)
//   npm run build && npm run dev:sandbox   (in another terminal)
//   npm run test:invite-email
//
// Proves the caps on emailed teammate invitations against a real database:
//   · asking for an email never blocks the invite — the link comes back either way
//   · 3 emails per recipient address per day, across EVERY organization
//   · 10 emails per organization per hour
//   · revoking an invite does not give the allowance back
//   · Resend is capped by the same ledger, and is scoped to your own organization
//
// The sandbox has no RESEND_API_KEY, so nothing is ever really sent: a slot that
// was reserved shows up as "not set up", a slot that was refused shows up as
// "Too many". That difference is what these checks read.
import { execFileSync } from 'node:child_process';
import { suite } from '../helpers/assert.mjs';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const STAMP = Date.now().toString(36);

function sql(q) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'invoicedb-production', '--local', '--json', '--command', q],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results || [];
}
const ledger = (where) => sql(`SELECT COUNT(*) AS n FROM invite_emails WHERE ${where}`)[0].n;

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

const t = suite('integration/team-invite-email');

// ── Setup: two organizations, each with an owner ──────────────────
const adminJar = jar();
const al = await post('/api/auth/login', { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' }, adminJar);
if (al.status !== 200) { console.error('\n  Cannot sign in as the local super-admin.\n'); process.exit(1); }

async function makeOrg(label) {
  const owner = { email: `inv-${label}-${STAMP}@test.local`, password: 'invite-owner-pw-1' };
  const r = await post('/api/admin/organizations',
    { name: `Invite ${label} ${STAMP}`, owner_email: owner.email, owner_password: owner.password, owner_name: `Owner ${label}` }, adminJar);
  if (r.status !== 200 && r.status !== 201) { console.error(`\n  Could not create org ${label}: ${JSON.stringify(r.data)}\n`); process.exit(1); }
  const j = jar();
  await post('/api/auth/login', owner, j);
  const orgId = sql(`SELECT org_id FROM users WHERE email = '${owner.email}'`)[0].org_id;
  return { j, orgId };
}
const A = await makeOrg('a');
const B = await makeOrg('b');
const invite = (org, email, extra = {}) =>
  post('/api/team/invite', { name: 'Maria', email, send_email: true, ...extra }, org.j);
const tooMany = (r) => /Too many/.test(r.data?.email_error || '');
const reserved = (r) => r.data?.emailed === false && !!r.data?.email_error && !tooMany(r);

t.section('name and email are required');
t.check('no name → 400', (await post('/api/team/invite', { email: `x-${STAMP}@test.local` }, A.j)).status === 400);
t.check('no email → 400', (await post('/api/team/invite', { name: 'Maria' }, A.j)).status === 400);
t.check('an email without @ → 400', (await post('/api/team/invite', { name: 'Maria', email: 'nope' }, A.j)).status === 400);

t.section('asking for an email never blocks the invite');
const plain = await post('/api/team/invite', { name: 'Maria', email: `plain-${STAMP}@test.local` }, A.j);
t.check('without send_email: 201, a token, emailed:false', plain.status === 201 && !!plain.data.token && plain.data.emailed === false);
t.check('and it takes nothing from the allowance', ledger(`to_email = 'plain-${STAMP}@test.local'`) === 0);
const first = await invite(A, `same-${STAMP}@test.local`);
t.check('with send_email: still 201 with a token (the invite exists even though nothing could be sent)',
  first.status === 201 && !!first.data.token);
t.check('the reply says why no email went out', reserved(first), JSON.stringify(first.data));
t.check('one slot was used', ledger(`to_email = 'same-${STAMP}@test.local'`) === 1);

t.section('3 emails per address per day');
const second = await invite(A, `same-${STAMP}@test.local`);
const third  = await invite(A, `same-${STAMP}@test.local`);
t.check('second and third are allowed through', reserved(second) && reserved(third));
const fourth = await invite(A, `same-${STAMP}@test.local`);
t.check('the fourth is refused', tooMany(fourth), JSON.stringify(fourth.data));
t.check('but the invite is STILL created, with its link', fourth.status === 201 && !!fourth.data.token);
t.check('and the refusal used no slot', ledger(`to_email = 'same-${STAMP}@test.local'`) === 3);
t.check('address case does not dodge the cap', tooMany(await invite(A, `SAME-${STAMP}@Test.Local`)));

t.section('the address cap is across every organization');
const other = await invite(B, `same-${STAMP}@test.local`);
t.check("a different business cannot email the same stranger's inbox either", tooMany(other), JSON.stringify(other.data));

t.section('revoking gives nothing back');
const pending = sql(`SELECT id FROM invites WHERE org_id = '${A.orgId}' AND email = 'same-${STAMP}@test.local' LIMIT 1`)[0];
t.check('revoke works', (await post(`/api/team/invites/${pending.id}/revoke`, {}, A.j)).status === 200);
t.check('the ledger still says 3', ledger(`to_email = 'same-${STAMP}@test.local'`) === 3);
t.check('so create → email → revoke is no way round the cap', tooMany(await invite(A, `same-${STAMP}@test.local`)));

t.section('10 emails per organization per hour');
// Org A has used 3 (the three above). Seven more distinct addresses fill it.
for (let i = 0; i < 7; i++) {
  const r = await invite(A, `fill${i}-${STAMP}@test.local`);
  if (!reserved(r)) t.check(`filler ${i} reserved`, false, JSON.stringify(r.data));
}
t.check('org A has now used exactly 10', ledger(`org_id = '${A.orgId}'`) === 10);
const eleventh = await invite(A, `eleventh-${STAMP}@test.local`);
t.check('the 11th is refused', tooMany(eleventh), JSON.stringify(eleventh.data));
t.check('still creates the invite', eleventh.status === 201 && !!eleventh.data.token);
t.check("the refusal used no slot", ledger(`org_id = '${A.orgId}'`) === 10);
t.check("another business is unaffected by A's cap", reserved(await invite(B, `b-fresh-${STAMP}@test.local`)));

t.section('an old ledger row stops counting');
sql(`UPDATE invite_emails SET created_at = datetime('now', '-2 hours') WHERE org_id = '${A.orgId}'`);
t.check("two hours on, org A's hourly allowance is back", reserved(await invite(A, `later-${STAMP}@test.local`)));
sql(`UPDATE invite_emails SET created_at = datetime('now', '-2 days') WHERE to_email = 'same-${STAMP}@test.local'`);
t.check('and two days on, the address is open again', reserved(await invite(A, `same-${STAMP}@test.local`)));

t.section('resend');
const mine = sql(`SELECT id FROM invites WHERE org_id = '${A.orgId}' AND email = 'later-${STAMP}@test.local'`)[0].id;
const rs = await post(`/api/team/invites/${mine}/resend`, {}, A.j);
t.check('is counted like any other email (a slot is reserved)', ledger(`to_email = 'later-${STAMP}@test.local'`) === 2, JSON.stringify(rs.data));
t.check("an organization cannot resend another organization's invite",
  (await post(`/api/team/invites/${mine}/resend`, {}, B.j)).status === 404);
t.check('an unknown invite is a 404', (await post('/api/team/invites/nope/resend', {}, A.j)).status === 404);
sql(`UPDATE invite_emails SET created_at = datetime('now') WHERE to_email = 'later-${STAMP}@test.local'`);
sql(`INSERT INTO invite_emails (id, org_id, to_email) VALUES ('x${STAMP}1', 'zz', 'later-${STAMP}@test.local'), ('x${STAMP}2', 'zz', 'later-${STAMP}@test.local')`);
const capped = await post(`/api/team/invites/${mine}/resend`, {}, A.j);
t.check('resend is refused once the address is at its cap', capped.status === 429 && /Too many/.test(capped.data?.error || ''), JSON.stringify(capped.data));

t.section('cleanup');
sql(`DELETE FROM invite_emails WHERE org_id = 'zz'`);

t.done();
