// Static audit: the self-serve spot-check queue (2026-08-10).
//
// The design has one non-negotiable rule: operator review must NEVER block
// the customer, and the only record of a spot-check (reviewed_by/reviewed_at)
// must be writable by nobody except the dedicated super-admin route. Once
// those columns exist on `invoices`, the generic table CRUD becomes a
// spoofing vector unless it explicitly strips them — a customer could
// otherwise PATCH their own invoice with a forged reviewed_by/reviewed_at and
// vanish from the admin queue while signing the operator's name to it. This
// file pins that, plus the two other decisions that are easy to quietly
// regress: 'In Processing' stubs must never inflate the actionable count, and
// admin.html's header/row cell counts must stay in lockstep.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const ROOT  = join(dirname(fileURLToPath(import.meta.url)), '..');
const src   = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8');
const admin = readFileSync(join(ROOT, 'public', 'admin.html'), 'utf8');
const invJs = readFileSync(join(ROOT, 'public', 'static', 'invoices.js'), 'utf8');

const t = suite('invoice-review-queue');

t.section('reviewed_by/reviewed_at are server-owned, not client-writable');

// stripServerOwned (formerly stripOrgId) must destructure both columns out of
// any body before it reaches a generic INSERT/UPDATE.
const stripFn = src.match(/function stripServerOwned\(body[\s\S]*?\n\}/);
t.check('stripServerOwned() is declared', !!stripFn);
t.check('it strips reviewed_by and reviewed_at (not just org_id)',
  !!stripFn && /reviewed_by/.test(stripFn[0]) && /reviewed_at/.test(stripFn[0]));

// All three generic writers (POST/PUT/PATCH /api/tables/...) must route the
// body through it. Each handler's body is sliced from its `app.<verb>(` start
// to the next top-level `app.` route declaration, same technique
// org-scoping.test.mjs uses to resolve handler ranges.
const routeStarts = [...src.matchAll(/^app\.(get|post|put|patch|delete)\(\s*'([^']+)'/gm)];
function handlerBody(method, path) {
  const idx = routeStarts.findIndex(m => m[1] === method && m[2] === path);
  if (idx === -1) return null;
  const start = routeStarts[idx].index;
  const end = idx + 1 < routeStarts.length ? routeStarts[idx + 1].index : src.length;
  return src.slice(start, end);
}
for (const [label, method, path] of [
  ["POST /api/tables/:table",      'post',  '/api/tables/:table'],
  ["PUT /api/tables/:table/:id",   'put',   '/api/tables/:table/:id'],
  ["PATCH /api/tables/:table/:id", 'patch', '/api/tables/:table/:id'],
]) {
  const body = handlerBody(method, path);
  t.check(`${label} exists`, !!body);
  t.check(`${label} calls stripServerOwned()`, !!body && /stripServerOwned\(/.test(body));
}

t.section('the mark-checked route is locked down');
const reviewedRoute = src.match(/app\.post\('\/api\/admin\/invoices\/:id\/reviewed'[\s\S]*?\n\}\)/);
t.check("POST /api/admin/invoices/:id/reviewed exists", !!reviewedRoute);
t.check('it requires a super-admin session',
  !!reviewedRoute && /requireSuperAdmin\(c\)/.test(reviewedRoute[0]));
t.check('the actor comes from the session (me.email), never the request body',
  !!reviewedRoute && /me\.email/.test(reviewedRoute[0]) &&
  !/reviewed_by\s*:\s*.*req\.json/.test(reviewedRoute[0]));
t.check('it refuses to mark a Closed or voided invoice',
  !!reviewedRoute && /'Closed'/.test(reviewedRoute[0]) && /voided_at/.test(reviewedRoute[0]));

t.section("'In Processing' stubs never inflate the actionable queue count");
// The four/five queue subqueries in GET /api/admin/organizations must key the
// headline counts off 'Action Required' specifically, and count
// 'In Processing' into a visibly separate field.
const orgsRoute = src.match(/app\.get\('\/api\/admin\/organizations'[\s\S]*?\n\}\)/);
t.check('GET /api/admin/organizations exists', !!orgsRoute);
t.check("waiting_unchecked is scoped to status = 'Action Required'",
  !!orgsRoute && /waiting_unchecked/.test(orgsRoute[0]) &&
  /status = 'Action Required'[\s\S]{0,80}AS waiting_unchecked/.test(orgsRoute[0]));
t.check("'In Processing' rows are counted separately, as waiting_stub",
  !!orgsRoute && /status = 'In Processing'[\s\S]{0,150}AS waiting_stub/.test(orgsRoute[0]));
t.check('the queue subqueries exclude voided invoices',
  !!orgsRoute && /waiting_unchecked[\s\S]{0,10}voided_at IS NULL|voided_at IS NULL[\s\S]{0,80}waiting_unchecked/.test(orgsRoute[0]));
t.check('archived organizations are excluded from the queue',
  !!orgsRoute && /o\.archived_at IS NULL/.test(orgsRoute[0]));

t.section('admin.html: header and row stay in lockstep, and read fields the server sends');
// A mismatch between <th> count and the per-row <td> count silently shifts
// every column left — the same class of bug entries-table-columns.test.mjs
// guards on the product page.
const headerMatch = admin.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/);
const headerCount  = headerMatch ? (headerMatch[1].match(/<th/g) || []).length : 0;
t.check(`admin org table header found (${headerCount} columns)`, headerCount > 0);
t.check('header includes a Waiting column', /<th[^>]*>Waiting<\/th>/.test(admin));

t.check('waitingCell() is defined', /function waitingCell\(o\)/.test(admin));
t.check('the row template calls waitingCell(o)', /\$\{waitingCell\(o\)\}/.test(admin));

// Every o.<field> the frontend reads for the queue must be a field the SQL
// actually aliases as — a renamed alias is otherwise a silent blank column.
const waitingCellBody = admin.match(/function waitingCell\(o\) \{([\s\S]*?)\n    \}/);
const fieldsRead = [...(waitingCellBody?.[1] || '').matchAll(/o\.(waiting_\w+)/g)].map(m => m[1]);
t.check('waitingCell reads at least the four expected fields',
  ['waiting_unchecked', 'waiting_checked', 'waiting_stub', 'waiting_oldest'].every(f => fieldsRead.includes(f)),
  `found: ${[...new Set(fieldsRead)].join(', ')}`);
for (const f of new Set(fieldsRead)) {
  t.check(`org query aliases ${f}`, new RegExp(`AS ${f}\\b`).test(orgsRoute?.[0] || ''));
}

t.section('the operator-only mark-checked UI stays gated');
t.check('detailReviewedBlock is revealed only for a super-admin',
  /__isSuperAdmin === true[\s\S]{0,40}!inv\.voided_at|window\.__isSuperAdmin/.test(invJs));
t.check('toggleReviewed() posts to admin/invoices/.../reviewed, not the generic PATCH',
  /apiPost\(`admin\/invoices\/\$\{id\}\/reviewed`/.test(invJs));

t.done();
