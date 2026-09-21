// Static audit of the account purge (DELETE /api/admin/organizations/:id).
//
// The purge is irreversible and the Privacy Policy promises it works, so two
// mistakes must fail the build rather than surface on a real customer:
//
//   1. A tenant table missing from PURGE_TABLES. Its rows survive the purge, still
//      carrying the deleted customer's data — and if the table has a foreign key
//      to organizations, the final DELETE of the org row fails as well.
//   2. A child table deleted AFTER its parent where the foreign key does not
//      cascade. SQLite refuses; the purge 500s part-way. The list used to be
//      alphabetical, which put certification_types before the staff_certifications
//      that reference it, and generic_products before product_aliases.
//
// tests/integration/org-purge.test.mjs proves the behaviour against a real
// database; this catches the mistake without needing the sandbox, the moment a
// migration or a table list changes.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8');
const scoping = readFileSync(join(ROOT, 'tests', 'org-scoping.test.mjs'), 'utf8');

const listOf = (text, name) => {
  const m = text.match(new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*(?:new Set\\()?\\[([\\s\\S]*?)\\]`));
  if (!m) throw new Error(`could not find ${name}`);
  // Strip line comments first: they contain quoted words ("alphabetical", ...).
  const body = m[1].replace(/\/\/[^\n]*/g, '');
  return [...body.matchAll(/'([a-z_]+)'/g)].map(x => x[1]);
};

const PURGE = listOf(src, 'PURGE_TABLES');
const TENANT = listOf(scoping, 'TENANT_TABLES');

const t = suite('purge-coverage');

t.section('Every tenant table is purged');
t.check('the lists were parsed', PURGE.length > 20 && TENANT.length > 20, `${PURGE.length} / ${TENANT.length}`);
const missing = TENANT.filter(tb => !PURGE.includes(tb));
t.check('PURGE_TABLES contains every TENANT_TABLES entry', missing.length === 0, `missing: ${missing.join(', ')}`);
const extra = PURGE.filter(tb => !TENANT.includes(tb));
t.check('PURGE_TABLES names nothing that is not a tenant table', extra.length === 0, `unknown: ${extra.join(', ')}`);
t.check('no table is listed twice', new Set(PURGE).size === PURGE.length);

// ── Foreign keys, read from the migrations themselves ─────────────
// A statement's table name, then every REFERENCES inside it. Inline column
// references and table-level FOREIGN KEY clauses look the same to this parse.
const sqlText = readdirSync(join(ROOT, 'migrations')).filter(f => f.endsWith('.sql')).sort()
  .map(f => readFileSync(join(ROOT, 'migrations', f), 'utf8').replace(/--[^\n]*/g, '')).join('\n');

const edges = [];   // { child, parent, cascade }
for (const m of sqlText.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_]+)\s*\(([\s\S]*?)\n\)\s*;/g)) {
  const child = m[1];
  for (const r of m[2].matchAll(/REFERENCES\s+([a-z_]+)\s*\([a-z_]+\)([^,\n]*)/g)) {
    edges.push({ child, parent: r[1], cascade: /ON DELETE CASCADE/i.test(r[2]) });
  }
}

t.section('Child before parent, wherever a foreign key does not cascade');
const between = edges.filter(e => PURGE.includes(e.child) && PURGE.includes(e.parent));
t.check('the foreign keys between tenant tables were found (parse sanity)',
  between.some(e => e.child === 'staff_certifications' && e.parent === 'certification_types') &&
  between.some(e => e.child === 'product_aliases' && e.parent === 'generic_products'),
  JSON.stringify(between));
for (const e of between.filter(e => !e.cascade)) {
  t.check(`${e.child} is deleted before ${e.parent}`, PURGE.indexOf(e.child) < PURGE.indexOf(e.parent));
}

// Anything that points at organizations must be gone before the org row is.
t.section('Nothing that points at the organization survives it');
const pointsAtOrg = [...new Set(edges.filter(e => e.parent === 'organizations').map(e => e.child))]
  // Auth tables are cleared by their own statements in the purge handler.
  .filter(tb => !['users', 'invites'].includes(tb));
// ALTER TABLE ... ADD COLUMN org_id ... REFERENCES organizations(id) — how 0035 tagged the older tables.
for (const m of sqlText.matchAll(/ALTER TABLE\s+([a-z_]+)\s+ADD COLUMN\s+org_id[^;]*REFERENCES\s+organizations/g)) {
  if (!pointsAtOrg.includes(m[1])) pointsAtOrg.push(m[1]);
}
const stranded = pointsAtOrg.filter(tb => !PURGE.includes(tb) && !tb.endsWith('_new'));
t.check('every table with an org_id foreign key is purged', stranded.length === 0, `not purged: ${stranded.join(', ')}`);

// The handler itself must clear what points at users before users.
t.section('Auth tables');
const handler = src.slice(src.indexOf("app.delete('/api/admin/organizations/:id'"));
const iReset = handler.indexOf('DELETE FROM password_resets');
const iInvites = handler.indexOf('DELETE FROM invites');
const iUsers = handler.indexOf('DELETE FROM users');
const iOrg = handler.indexOf('DELETE FROM organizations');
t.check('the purge clears password_resets', iReset > 0);
t.check('password_resets and invites are deleted before users', iReset < iUsers && iInvites < iUsers);
t.check('the organization row is deleted last', iOrg > iUsers);
t.check('the row deletes run in one atomic batch', /DB\.batch\(\[\s*\.\.\.PURGE_TABLES/.test(handler));

t.done();
