// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run db:migrate:local                 (for 0064)
//   npm run build && npm run dev:sandbox     (in another terminal; .dev.vars must
//                                             hold PADDLE_WEBHOOK_SECRET, PADDLE_CLIENT_TOKEN,
//                                             PADDLE_PRICE_ESSENTIAL, PADDLE_PRICE_PRO)
//   npm run test:card-step
//
// Billing plan step 2, the card step after an owner sets their password:
//   · a new owner is told a card is needed; /api/billing/checkout hands out the
//     price for their plan and a SIGNED org id for custom_data
//   · only the owner gets a checkout; a super-admin never needs a card
//   · the card counts only once Paddle's signed webhook says so — and the
//     custom_data the checkout handed out is what makes the webhook find them
//   · canceled = card needed again; past_due still has a card
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { suite } from '../helpers/assert.mjs';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const STAMP = Date.now().toString(36);
const DEV_VARS = readFileSync(new URL('../../.dev.vars', import.meta.url), 'utf8');
const devVar = (k) => (DEV_VARS.match(new RegExp(`^${k}\\s*=\\s*"?([^"\\n]+)"?`, 'm')) || [])[1];
for (const k of ['PADDLE_WEBHOOK_SECRET', 'PADDLE_CLIENT_TOKEN', 'PADDLE_PRICE_ESSENTIAL', 'PADDLE_PRICE_PRO']) {
  if (!devVar(k)) { console.error(`\n  Add ${k} to .dev.vars and restart the sandbox.\n`); process.exit(1); }
}

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

let n = 0;
async function webhook(type, occurred, data) {
  const body = JSON.stringify({ event_id: `evt_card_${STAMP}_${++n}`, event_type: type, occurred_at: occurred, data });
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac('sha256', devVar('PADDLE_WEBHOOK_SECRET')).update(`${ts}:${body}`).digest('hex');
  const res = await fetch(`${BASE}/api/paddle/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'paddle-signature': `ts=${ts};h1=${h1}` }, body,
  });
  return res.status;
}

const t = suite('integration/billing-card-step');

const adminJar = jar();
const al = await post('/api/auth/login', { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' }, adminJar);
if (al.status !== 200) { console.error('\n  Cannot sign in as the local super-admin.\n'); process.exit(1); }

t.section('signed out');
t.check('status: 401', (await get('/api/billing/status')).status === 401);
t.check('checkout: 401', (await get('/api/billing/checkout')).status === 401);

t.section('a super-admin never needs a card');
let st = await get('/api/billing/status', adminJar);
t.check('configured, no card needed', st.status === 200 && st.data.configured === true && st.data.card_needed === false, JSON.stringify(st));
t.check('and gets no checkout', (await get('/api/billing/checkout', adminJar)).status === 403);

t.section('a new owner, straight after the invite');
const OWNER = { email: `card-owner-${STAMP}@test.local`, password: 'card-owner-pw-1' };
const made = await post('/api/admin/organizations', { name: `Card Step ${STAMP}`, owner_email: OWNER.email, owner_name: 'Owner' }, adminJar);
t.check('account created', made.status === 200 || made.status === 201, JSON.stringify(made.data));
const ORG = made.data?.organization?.id;
const token = sql(`SELECT token FROM invites WHERE org_id = '${ORG}'`)[0]?.token;
const ownerJar = jar();
const acc = await post('/api/auth/accept-invite', { token, name: 'Owner', email: OWNER.email, password: OWNER.password, agree: true }, ownerJar);
t.check('invite accepted', acc.status === 200, JSON.stringify(acc.data));
st = await get('/api/billing/status', ownerJar);
t.check('card needed, owner', st.status === 200 && st.data.card_needed === true && st.data.is_owner === true && st.data.status === null, JSON.stringify(st.data));

const co = await get('/api/billing/checkout', ownerJar);
t.check('checkout handed out', co.status === 200, JSON.stringify(co));
t.check('sandbox, with the client token', co.data?.environment === 'sandbox' && co.data?.client_token === devVar('PADDLE_CLIENT_TOKEN'));
t.check('Essential price for an Essential account', co.data?.price_id === devVar('PADDLE_PRICE_ESSENTIAL') && co.data?.plan_label === 'Essential');
t.check('their own email pre-filled', co.data?.email === OWNER.email);
const expectSig = createHmac('sha256', devVar('SESSION_SECRET')).update(`paddle-checkout:${ORG}`).digest('hex').slice(0, 32);
t.check('custom_data: their org id, signed', co.data?.custom_data?.org_id === ORG && co.data?.custom_data?.org_sig === expectSig);

t.section('Pro is offered the Pro price');
const pr = await post(`/api/admin/organizations/${ORG}/plan`, { plan: 'pro' }, adminJar);
t.check('plan switched to Pro', pr.status === 200, JSON.stringify(pr.data));
const co2 = await get('/api/billing/checkout', ownerJar);
t.check('Pro price, Pro label', co2.data?.price_id === devVar('PADDLE_PRICE_PRO') && co2.data?.plan_label === 'Pro', JSON.stringify(co2.data));

t.section('the card counts once Paddle says so');
const SUB = `sub_card_${STAMP}`;
const subData = (status, over = {}) => ({
  id: SUB, status, customer_id: `ctm_card_${STAMP}`, items: [{ price: { id: co2.data.price_id } }],
  next_billed_at: '2026-11-03T10:00:00.000000Z', scheduled_change: null, custom_data: co2.data.custom_data, ...over,
});
t.check('webhook accepted', await webhook('subscription.created', '2026-10-20T10:00:00.000000Z', subData('trialing')) === 200);
st = await get('/api/billing/status', ownerJar);
t.check('trialing: no card needed', st.data.card_needed === false && st.data.status === 'trialing', JSON.stringify(st.data));
t.check('webhook found the account through the checkout\'s custom_data',
  sql(`SELECT paddle_subscription_id FROM organizations WHERE id = '${ORG}'`)[0]?.paddle_subscription_id === SUB);

await webhook('subscription.past_due', '2026-11-03T10:05:00.000000Z', subData('past_due', { custom_data: null }));
st = await get('/api/billing/status', ownerJar);
t.check('past_due: still has a card (Paddle is retrying)', st.data.card_needed === false && st.data.status === 'past_due', JSON.stringify(st.data));

await webhook('subscription.canceled', '2026-12-03T10:00:00.000000Z', subData('canceled', { custom_data: null, next_billed_at: null }));
st = await get('/api/billing/status', ownerJar);
t.check('canceled: card needed again', st.data.card_needed === true && st.data.status === 'canceled', JSON.stringify(st.data));

t.section('a forged custom_data does not attach a subscription');
const OTHER_SUB = `sub_forged_${STAMP}`;
await webhook('subscription.created', '2026-12-04T10:00:00.000000Z', {
  ...subData('active', { id: OTHER_SUB, customer_id: `ctm_forged_${STAMP}` }), custom_data: { org_id: ORG, org_sig: '0'.repeat(32) },
});
st = await get('/api/billing/status', ownerJar);
t.check('still canceled, still needs a card', st.data.card_needed === true && st.data.status === 'canceled', JSON.stringify(st.data));

t.section('the pages');
const page = await fetch(`${BASE}/start-trial.html`);
const html = await page.text();
t.check('/start-trial.html is served', page.status === 200 && /Start your 14-day free trial/.test(html));
t.check('it loads Paddle.js from Paddle', html.includes('https://cdn.paddle.com/paddle/v2/paddle.js'));
const invite = await (await fetch(`${BASE}/accept-invite.html`)).text();
t.check('the invite page sends a new owner on to it when a card is needed', /card_needed\) next = '\/start-trial\.html'/.test(invite));

t.done();
