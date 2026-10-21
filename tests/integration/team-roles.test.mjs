// INTEGRATION — needs a running sandbox and writes to the local D1.
//   npm run db:migrate:local                 (for 0067)
//   npm run build && npm run dev:sandbox     (in another terminal)
//   npm run test:roles
//
// Team roles (migration 0067): Owner / Manager / Kitchen staff.
//   · an invite carries the role; accepting it gives that role
//   · /me reports each person's switches; the defaults are the approved table
//   · the server refuses what a role may not do (403 permission_required),
//     including READS where the switch is about seeing (P&L, price movers)
//   · approving / deleting invoices need their own switches
//   · anything no switch names is closed to kitchen staff, open to managers
//   · the owner changes switches and roles; a manager only kitchen staff's
//     switches, and only while the owner allows it
//   · a change applies on the next request, with no new sign-in
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
const refused = (r, perm) => r.status === 403 && r.data?.permission_required === perm;
const sorted = (a) => JSON.stringify([...(a || [])].sort());

const t = suite('integration/team-roles');

// ── Setup: a Pro business, its owner, a manager and a kitchen staff member ──
const admin = jar();
const al = await call('POST', '/api/auth/login', { email: 'simoneisonni@gmail.com', password: 'correct-horse-battery' }, admin);
if (al.status !== 200) { console.error('\n  Cannot sign in as the local super-admin.\n'); process.exit(1); }

const ownerEmail = `roles-owner-${STAMP}@test.local`, ownerPw = 'roles-owner-pw-1';
const org = await call('POST', '/api/admin/organizations',
  { name: `Roles ${STAMP}`, owner_email: ownerEmail, owner_password: ownerPw, owner_name: 'Olive', plan: 'pro' }, admin);
const orgId = org.data?.organization?.id;
await call('POST', `/api/admin/organizations/${orgId}/review-mode`, { mode: 'direct' }, admin);
await call('POST', `/api/admin/organizations/${orgId}/plan`, { plan: 'pro' }, admin);
// In case the sandbox runs with payments on: this test is not about the card step.
await call('POST', `/api/admin/organizations/${orgId}/billing-exempt`, { exempt: true }, admin);
const owner = jar();
await call('POST', '/api/auth/login', { email: ownerEmail, password: ownerPw }, owner);

async function join(role, tag) {
  const email = `roles-${tag}-${STAMP}@test.local`;
  const inv = await call('POST', '/api/team/invite', { name: tag, email, role }, owner);
  const j = jar();
  const acc = await call('POST', '/api/auth/accept-invite',
    { token: inv.data?.token, name: tag, email, password: `roles-${tag}-pw-1`, agree: true }, j);
  return { j, id: acc.data?.user?.id, invite: inv, accepted: acc };
}
const mgr = await join('manager', 'manny');
const kit = await join('kitchen', 'kim');
t.check('setup: business, owner, manager and kitchen staff', !!orgId && mgr.accepted.status === 200 && kit.accepted.status === 200,
  JSON.stringify({ org: org.status, mgr: mgr.accepted.data, kit: kit.accepted.data }));

t.section('roles and default switches');
const meOwner = (await call('GET', '/api/auth/me', null, owner)).data?.user;
const meMgr = (await call('GET', '/api/auth/me', null, mgr.j)).data?.user;
const meKit = (await call('GET', '/api/auth/me', null, kit.j)).data?.user;
t.check('the owner is owner, with every switch', meOwner?.team_role === 'owner' && meOwner?.permissions?.length === 9);
t.check('the invite made a manager', meMgr?.team_role === 'manager');
t.check('manager defaults: everything but inviting',
  sorted(meMgr?.permissions) === sorted(['prices', 'invoice_upload', 'invoice_approve', 'invoice_void', 'pnl', 'catalog', 'stock', 'pos']));
t.check('the invite made kitchen staff', meKit?.team_role === 'kitchen');
t.check('kitchen defaults: upload invoices, stock counts and waste', sorted(meKit?.permissions) === sorted(['invoice_upload', 'stock']));
t.check('stored in the database too', sql(`SELECT role FROM users WHERE id = '${kit.id}'`)[0]?.role === 'kitchen');

t.section('seeing');
t.check('kitchen: the P&L is refused', refused(await call('GET', '/api/pnl?month=2026-10', null, kit.j), 'pnl'));
t.check('manager: the P&L opens', (await call('GET', '/api/pnl?month=2026-10', null, mgr.j)).status === 200);
t.check('kitchen: price movers are refused', refused(await call('GET', '/api/price-movers', null, kit.j), 'prices'));
t.check('kitchen: spending breakdown is refused', refused(await call('GET', '/api/spending-breakdown?from=2026-10-01&to=2026-10-31', null, kit.j), 'pnl'));
t.check('kitchen: P&L inputs (fixed costs) are refused', refused(await call('GET', '/api/tables/recurring_expenses', null, kit.j), 'pnl'));
t.check('kitchen: till sales are refused', refused(await call('GET', '/api/pos-imports', null, kit.j), 'pos'));
t.check('kitchen: past stock counts open (stock switch)', (await call('GET', '/api/stock-take/history', null, kit.j)).status === 200);
t.check('kitchen: the product list still reads (costing needs it)', (await call('GET', '/api/tables/generic_products', null, kit.j)).status === 200);

t.section('invoices');
const draft = await call('POST', '/api/tables/invoices', { vendor: 'Roles Foods', invoice_number: `R1-${STAMP}` }, kit.j);
t.check('kitchen can upload (create) an invoice', draft.status === 201);
const id = draft.data?.id;
t.check('kitchen can turn its photo', (await call('PATCH', `/api/tables/invoices/${id}`, { page_rotations: '{}' }, kit.j)).status === 200);
t.check('kitchen can edit the draft', (await call('PATCH', `/api/tables/invoices/${id}`, { notes: 'kitchen note' }, kit.j)).status === 200);
t.check('kitchen cannot approve it', refused(await call('PATCH', `/api/tables/invoices/${id}`, { status: 'Closed' }, kit.j), 'invoice_approve'));
t.check('kitchen cannot delete it', refused(await call('DELETE', `/api/tables/invoices/${id}`, null, kit.j), 'invoice_void'));
t.check('kitchen cannot file products from it', refused(await call('POST', '/api/bulk/upsert-products', { items: [] }, kit.j), 'invoice_approve'));
t.check('manager approves it', (await call('PATCH', `/api/tables/invoices/${id}`, { status: 'Closed', parsed_data: '' }, mgr.j)).status === 200);
t.check('kitchen cannot change the saved invoice', refused(await call('PATCH', `/api/tables/invoices/${id}`, { notes: 'later' }, kit.j), 'invoice_approve'));
t.check('kitchen cannot change its lines', refused(await call('POST', `/api/invoice-lines/${id}/replace`, { lines: [] }, kit.j), 'invoice_approve'));
t.check('kitchen cannot void it', refused(await call('POST', `/api/invoices/${id}/void`, { reason: 'x' }, kit.j), 'invoice_void'));
t.check('manager voids it', (await call('POST', `/api/invoices/${id}/void`, { reason: 'test' }, mgr.j)).status === 200);

t.section('products, recipes, stock');
t.check('kitchen cannot add a product', refused(await call('POST', '/api/tables/generic_products', { name: `Kim's flour ${STAMP}` }, kit.j), 'catalog'));
const prod = await call('POST', '/api/tables/generic_products', { name: `Manny's flour ${STAMP}`, category: 'Other' }, mgr.j);
t.check('manager adds a product', prod.status === 201);
const recipe = await call('POST', '/api/tables/recipes', { name: `Roles sauce ${STAMP}` }, owner);
t.check('kitchen cannot rename a recipe', refused(await call('PATCH', `/api/tables/recipes/${recipe.data?.id}`, { name: 'Renamed' }, kit.j), 'catalog'));
t.check('kitchen CAN mark a recipe made ahead (Produce Batch)',
  (await call('PATCH', `/api/tables/recipes/${recipe.data?.id}`, { production_mode: 'batched' }, kit.j)).status === 200);
t.check('kitchen can write a stock movement', (await call('POST', '/api/tables/stock_log', { inventory_id: 'none', item_id: 'none', item_type: 'product', item_name: 'x', change: 0, reason: 'test' }, kit.j)).status === 201);

t.section('anything no switch names');
t.check('kitchen: refused (adding staff records)', refused(await call('POST', '/api/tables/staff', { full_name: `S ${STAMP}` }, kit.j), null));
t.check('manager: allowed', (await call('POST', '/api/tables/staff', { full_name: `S ${STAMP}` }, mgr.j)).status === 201);

t.section('inviting');
t.check('kitchen cannot invite', refused(await call('POST', '/api/team/invite', { name: 'x', email: `x1-${STAMP}@test.local`, role: 'kitchen' }, kit.j), 'invite'));
t.check('manager cannot invite by default', refused(await call('POST', '/api/team/invite', { name: 'x', email: `x2-${STAMP}@test.local`, role: 'kitchen' }, mgr.j), 'invite'));
t.check('owner turns inviting on for managers',
  (await call('POST', '/api/team/permissions', { role: 'manager', permissions: { invite: true } }, owner)).status === 200);
t.check('now the manager can invite kitchen staff (no new sign-in)',
  (await call('POST', '/api/team/invite', { name: 'x', email: `x3-${STAMP}@test.local`, role: 'kitchen' }, mgr.j)).status === 201);
t.check('...and is refused an owner invite', (await call('POST', '/api/team/invite', { name: 'x', email: `x4-${STAMP}@test.local`, role: 'owner' }, mgr.j)).status === 403);
const ownerId = sql(`SELECT id FROM users WHERE email = '${ownerEmail}'`)[0]?.id;
t.check('a manager cannot deactivate the owner', (await call('POST', `/api/team/${ownerId}/archive`, {}, mgr.j)).status === 400);

t.section('who changes the switches');
t.check('kitchen cannot change switches', (await call('POST', '/api/team/permissions', { role: 'kitchen', permissions: { pnl: true } }, kit.j)).status === 403);
t.check("a manager cannot change managers' switches", (await call('POST', '/api/team/permissions', { role: 'manager', permissions: { invite: true } }, mgr.j)).status === 403);
t.check('a manager cannot change the managers-edit-kitchen switch',
  (await call('POST', '/api/team/permissions', { role: 'kitchen', permissions: {}, managers_edit_kitchen: true }, mgr.j)).status === 403);
const mgrPnl = await call('POST', '/api/team/permissions', { role: 'kitchen', permissions: { pnl: true } }, mgr.j);
t.check("a manager CAN change kitchen staff's switches (allowed by default)", mgrPnl.status === 200 && mgrPnl.data?.settings?.kitchen?.pnl === true);
t.check('kitchen now opens the P&L, with no new sign-in', (await call('GET', '/api/pnl?month=2026-10', null, kit.j)).status === 200);
await call('POST', '/api/team/permissions', { role: 'manager', permissions: {}, managers_edit_kitchen: false }, owner);
t.check('once the owner turns that off, the manager is refused',
  (await call('POST', '/api/team/permissions', { role: 'kitchen', permissions: { pnl: false } }, mgr.j)).status === 403);
const team = (await call('GET', '/api/team', null, owner)).data;
t.check('/api/team carries roles and the saved switches',
  team?.roles?.settings?.kitchen?.pnl === true && team?.roles?.settings?.managers_edit_kitchen === false
  && team?.users?.some(u => u.id === kit.id && u.role === 'kitchen'));

t.section('billing is the owner\'s');
const ownBill = await call('GET', '/api/billing/summary', null, owner);
t.check('the owner reads the Billing box', ownBill.status === 200 && typeof ownBill.data?.plan_label === 'string');
t.check('a manager cannot', (await call('GET', '/api/billing/summary', null, mgr.j)).status === 403);
t.check('kitchen staff cannot', (await call('GET', '/api/billing/summary', null, kit.j)).status === 403);
t.check('a manager cannot open the card window', (await call('POST', '/api/billing/update-card', {}, mgr.j)).status === 403);
t.check('a manager cannot open the receipts page', (await call('POST', '/api/billing/portal', {}, mgr.j)).status === 403);
t.check('the owner with no subscription gets a plain refusal, not a Paddle call',
  (await call('POST', '/api/billing/update-card', {}, owner)).status === 409);

t.section('changing a role');
t.check('a manager cannot change roles', (await call('POST', `/api/team/${kit.id}/role`, { role: 'manager' }, mgr.j)).status === 403);
t.check("the owner's own role can't be changed", (await call('POST', `/api/team/${ownerId}/role`, { role: 'kitchen' }, owner)).status === 400);
t.check('the owner makes kitchen staff a manager', (await call('POST', `/api/team/${kit.id}/role`, { role: 'manager' }, owner)).status === 200);
const promoted = (await call('GET', '/api/auth/me', null, kit.j)).data?.user;
t.check('...who has the manager switches on the next request', promoted?.team_role === 'manager' && promoted?.permissions?.includes('catalog'));

t.section('other businesses are untouched');
const other = sql(`SELECT COUNT(*) AS n FROM organizations WHERE role_permissions IS NOT NULL AND id <> '${orgId}' AND name LIKE 'Roles %${STAMP}'`)[0]?.n;
t.check('only this business has saved switches', other === 0);

t.done();
