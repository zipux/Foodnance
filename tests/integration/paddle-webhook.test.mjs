// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run db:migrate:local                 (for 0064)
//   npm run build && npm run dev:sandbox     (in another terminal; .dev.vars must
//                                             hold PADDLE_WEBHOOK_SECRET — any value)
//   npm run test:paddle-webhook
//
// POST /api/paddle/webhook (migration 0064):
//   · nothing is written unless the Paddle-Signature checks out (none, wrong,
//     stale, other secret → 401)
//   · a subscription event copies its state onto the account named in
//     custom_data.org_id, or the account already holding that subscription
//   · the same event twice is logged once; an OLDER event arriving late never
//     overwrites a newer one
//   · an event for no known account is logged and answered 200 (no endless retry)
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { suite } from '../helpers/assert.mjs';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const STAMP = Date.now().toString(36);
const DEV_VARS = readFileSync(new URL('../../.dev.vars', import.meta.url), 'utf8');
const devVar = (k) => (DEV_VARS.match(new RegExp(`^${k}\\s*=\\s*"?([^"\\n]+)"?`, 'm')) || [])[1];
const SECRET = devVar('PADDLE_WEBHOOK_SECRET');
// custom_data.org_id is only believed with the signature /api/billing/checkout hands out.
const orgSig = (org) => createHmac('sha256', devVar('SESSION_SECRET')).update(`paddle-checkout:${org}`).digest('hex').slice(0, 32);
const signed = (org) => ({ org_id: org, org_sig: orgSig(org) });
if (!SECRET) { console.error('\n  Add PADDLE_WEBHOOK_SECRET=<anything> to .dev.vars and restart the sandbox.\n'); process.exit(1); }

function sql(q) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'invoicedb-production', '--local', '--json', '--command', q],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results || [];
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const sign = (body, { secret = SECRET, ts = Math.floor(Date.now() / 1000) } = {}) =>
  `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`;

async function send(event, headerFor = sign) {
  const body = typeof event === 'string' ? event : JSON.stringify(event);
  const header = headerFor ? headerFor(body) : null;
  const res = await fetch(`${BASE}/api/paddle/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(header ? { 'paddle-signature': header } : {}) },
    body,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

let n = 0;
const evt = (type, occurred, data) => ({
  event_id: `evt_test_${STAMP}_${++n}`, event_type: type, occurred_at: occurred,
  notification_id: `ntf_test_${STAMP}_${n}`, data,
});
const sub = (id, over = {}) => ({
  id, status: 'trialing', customer_id: `ctm_test_${STAMP}`,
  items: [{ price: { id: 'pri_test_essential' }, trial_dates: { ends_at: '2026-11-03T10:00:00.000000Z' } }],
  next_billed_at: '2026-11-03T10:00:00.000000Z', scheduled_change: null,
  custom_data: null, ...over,
});
const org = (id) => sql(`SELECT paddle_customer_id, paddle_subscription_id, billing_status, billing_price_id,
  billing_next_at, billing_change, billing_change_at, billing_event_at FROM organizations WHERE id = ${q(id)}`)[0];
const logged = (eventId) => sql(`SELECT * FROM billing_events WHERE event_id = ${q(eventId)}`);

const t = suite('integration/paddle-webhook');

// Two throwaway accounts, made directly: the webhook needs only the row.
const ORG = `org_pdl_${STAMP}`, OTHER = `org_pdl2_${STAMP}`;
sql(`INSERT INTO organizations (id, name, plan) VALUES (${q(ORG)}, ${q('Paddle Test ' + STAMP)}, 'essential'),
                                                  (${q(OTHER)}, ${q('Paddle Other ' + STAMP)}, 'essential')`);
const SUB = `sub_test_${STAMP}`;

t.section('nothing is written without a good signature');
const created = evt('subscription.created', '2026-10-20T10:00:00.000000Z', sub(SUB, { custom_data: signed(ORG) }));
let r = await send(created, null);
t.check('no signature: 401', r.status === 401, JSON.stringify(r));
r = await send(created, (b) => sign(b, { secret: 'not-the-secret' }));
t.check('signed with another secret: 401', r.status === 401);
r = await send(created, (b) => sign(b, { ts: Math.floor(Date.now() / 1000) - 3600 }));
t.check('signed an hour ago: 401', r.status === 401);
r = await send(created, (b) => sign(b).replace(/h1=(.)/, (_, ch) => `h1=${ch === '0' ? '1' : '0'}`));
t.check('signature with one character changed: 401', r.status === 401);
r = await send(created, (b) => sign(b + ' '));
t.check('body changed after signing: 401', r.status === 401);
t.check('none of those logged anything', logged(created.event_id).length === 0);
t.check('none of those touched the account', org(ORG).billing_status === null);

t.section('a signed subscription.created fills in the account');
r = await send(created);
t.check('200', r.status === 200, JSON.stringify(r));
let o = org(ORG);
t.check('subscription and customer recorded', o.paddle_subscription_id === SUB && o.paddle_customer_id === `ctm_test_${STAMP}`, JSON.stringify(o));
t.check('status trialing, price and next charge recorded',
  o.billing_status === 'trialing' && o.billing_price_id === 'pri_test_essential' && o.billing_next_at === '2026-11-03T10:00:00.000000Z');
const row = logged(created.event_id);
t.check('logged once, against the account', row.length === 1 && row[0].org_id === ORG && row[0].entity_id === SUB && row[0].status === 'trialing');
t.check('the other account is untouched', org(OTHER).billing_status === null);

t.section('the same event again (a Paddle retry)');
r = await send(created);
t.check('200 again', r.status === 200);
t.check('still logged once', logged(created.event_id).length === 1);

t.section('a rotated secret: either signature is accepted');
const activated = evt('subscription.activated', '2026-10-20T11:00:00.000000Z', sub(SUB, { status: 'active', next_billed_at: '2026-11-20T11:00:00.000000Z' }));
r = await send(activated, (b) => `${sign(b, { secret: 'old-secret' })};h1=${sign(b).split('h1=')[1]}`);
t.check('200 with two h1, one good', r.status === 200, JSON.stringify(r));
o = org(ORG);
t.check('matched by the stored subscription id (no custom_data)', o.billing_status === 'active' && o.billing_next_at === '2026-11-20T11:00:00.000000Z', JSON.stringify(o));

t.section('a scheduled cancellation, then a late older event');
const cancelling = evt('subscription.updated', '2026-10-21T09:00:00.000000Z', sub(SUB, {
  status: 'active', next_billed_at: null,
  scheduled_change: { action: 'cancel', effective_at: '2026-11-20T11:00:00.000000Z', resume_at: null },
}));
r = await send(cancelling);
o = org(ORG);
t.check('scheduled change recorded', r.status === 200 && o.billing_change === 'cancel' && o.billing_change_at === '2026-11-20T11:00:00.000000Z' && o.billing_next_at === null, JSON.stringify(o));
const late = evt('subscription.updated', '2026-10-20T12:00:00.000000Z', sub(SUB, { status: 'past_due' }));
r = await send(late);
o = org(ORG);
t.check('the late event is answered 200 and logged', r.status === 200 && logged(late.event_id).length === 1);
t.check('...but does not overwrite the newer state', o.billing_status === 'active' && o.billing_change === 'cancel' && o.billing_event_at === '2026-10-21T09:00:00.000000Z', JSON.stringify(o));
const canceled = evt('subscription.canceled', '2026-11-20T11:00:01.000000Z', sub(SUB, { status: 'canceled', next_billed_at: null }));
await send(canceled);
o = org(ORG);
t.check('the cancellation itself lands', o.billing_status === 'canceled' && o.billing_change === null, JSON.stringify(o));

t.section('custom_data that names no real account, or carries no good signature, is not trusted');
const unsigned = evt('subscription.created', '2026-10-22T08:00:00.000000Z', sub(`sub_unsigned_${STAMP}`, {
  customer_id: `ctm_unsigned_${STAMP}`, custom_data: { org_id: OTHER, org_sig: orgSig(ORG) },
}));
r = await send(unsigned);
t.check('a real account id with another account\'s signature: 200, logged with no account',
  r.status === 200 && logged(unsigned.event_id)[0]?.org_id === null);
t.check('...and that account is untouched', org(OTHER).billing_status === null && org(OTHER).paddle_subscription_id === null);
const bogus = evt('subscription.created', '2026-10-22T09:00:00.000000Z', sub(`sub_nobody_${STAMP}`, {
  customer_id: `ctm_nobody_${STAMP}`, custom_data: signed('org_does_not_exist'),
}));
r = await send(bogus);
t.check('answered 200 (so Paddle stops retrying)', r.status === 200);
const b = logged(bogus.event_id);
t.check('logged with no account', b.length === 1 && b[0].org_id === null);
t.check('no account picked it up', sql(`SELECT COUNT(*) AS n FROM organizations WHERE paddle_subscription_id = ${q('sub_nobody_' + STAMP)}`)[0].n === 0);

t.section('a transaction only teaches the customer id');
const txn = evt('transaction.completed', '2026-10-22T10:00:00.000000Z', {
  id: `txn_test_${STAMP}`, status: 'completed', customer_id: `ctm_other_${STAMP}`,
  subscription_id: null, custom_data: signed(OTHER),
});
r = await send(txn);
o = org(OTHER);
t.check('customer id recorded, no status invented', r.status === 200 && o.paddle_customer_id === `ctm_other_${STAMP}` && o.billing_status === null, JSON.stringify(o));
const txn2 = evt('transaction.completed', '2026-10-22T11:00:00.000000Z', {
  id: `txn_test2_${STAMP}`, status: 'completed', customer_id: `ctm_changed_${STAMP}`, custom_data: signed(OTHER),
});
await send(txn2);
t.check('an existing customer id is not replaced by a transaction', org(OTHER).paddle_customer_id === `ctm_other_${STAMP}`);

t.section('not a Paddle event');
r = await send({ hello: 'world' });
t.check('signed but shapeless: 400, nothing logged', r.status === 400);
r = await send('not json');
t.check('signed but not JSON: 400', r.status === 400);

// Tidy up: these accounts were made by hand and have no other rows.
sql(`DELETE FROM billing_events WHERE event_id LIKE ${q('evt_test_' + STAMP + '%')}`);
sql(`DELETE FROM organizations WHERE id IN (${q(ORG)}, ${q(OTHER)})`);

t.done();
