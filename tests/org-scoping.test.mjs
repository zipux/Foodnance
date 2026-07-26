// Static audit: every SQL statement that touches a tenant-owned table must be
// scoped by org_id.
//
// Phase 2 of the accounts plan tags all 27 data tables with the business that
// owns each row. The risk is not the design, it's the 120-odd hand-written
// statements across 49 routes: ONE missed filter and a restaurant reads
// another restaurant's invoices. A reviewer cannot reliably eyeball that, and
// it silently regresses the moment someone adds a route.
//
// So the check is mechanical. This parses src/index.ts, pulls out every SQL
// string handed to DB.prepare(), works out which tables it touches, and fails
// if a tenant table is touched without an org_id condition.
//
// Statements that legitimately don't need scoping are listed in ALLOWLIST with
// a reason. Adding to that list is the deliberate, reviewable act — forgetting
// a filter is not.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts');

// The 27 tables carrying customer data. Auth tables (organizations, users,
// invites) are deliberately absent: they are scoped by their own rules, not
// by org_id on the row.
const TENANT_TABLES = new Set([
  'categories', 'certification_types', 'finished_product_items', 'finished_products',
  'generic_products', 'inventory', 'invoice_lines', 'invoices', 'item_placements',
  'operating_expenses', 'product_aliases', 'product_entries', 'product_mappings',
  'recipe_items', 'recipes', 'recurring_expenses', 'sales_monthly', 'spread_expenses',
  'staff', 'staff_certifications', 'stock_log', 'stock_take_items', 'stock_takes',
  'storage_sections', 'suppliers', 'units', 'vendor_fee_templates',
]);

// Statements that touch a tenant table but correctly need no org filter.
// Keyed by a distinctive fragment of the statement. Every entry needs a reason.
const ALLOWLIST = [
  // (populated as the audit proceeds — each entry is a deliberate decision)
];

function extractStatements(src) {
  // Pull the string argument out of every DB.prepare( ... ) call. Handles
  // backtick templates (the common case here) and quoted strings, including
  // nested parens inside the SQL.
  const out = [];
  const needle = 'DB.prepare(';
  let i = 0;
  while ((i = src.indexOf(needle, i)) !== -1) {
    let j = i + needle.length;
    while (j < src.length && /\s/.test(src[j])) j++;
    const quote = src[j];
    if (quote !== '`' && quote !== '"' && quote !== "'") { i = j; continue; }
    let k = j + 1;
    let sql = '';
    while (k < src.length) {
      if (src[k] === '\\') { sql += src[k] + src[k + 1]; k += 2; continue; }
      if (src[k] === quote) break;
      sql += src[k]; k++;
    }
    const line = src.slice(0, i).split('\n').length;
    out.push({ sql, line });
    i = k + 1;
  }
  return out;
}

function tablesTouched(sql) {
  const found = new Set();
  const patterns = [
    /\bFROM\s+([a-z_][a-z0-9_]*)/gi,
    /\bJOIN\s+([a-z_][a-z0-9_]*)/gi,
    /\bINSERT\s+INTO\s+([a-z_][a-z0-9_]*)/gi,
    /\bUPDATE\s+([a-z_][a-z0-9_]*)/gi,
    /\bDELETE\s+FROM\s+([a-z_][a-z0-9_]*)/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(sql)) !== null) {
      const t = m[1].toLowerCase();
      if (TENANT_TABLES.has(t)) found.add(t);
    }
  }
  return [...found];
}

function isScoped(sql) {
  // Any mention of org_id counts: a WHERE filter, an INSERT column, or a
  // ${orgScope(...)} interpolation. The test proves the developer thought
  // about ownership for this statement, not that the SQL is provably correct.
  return /org_id/i.test(sql);
}

function allowlisted(sql) {
  return ALLOWLIST.some(entry => sql.includes(entry.fragment));
}

const src = readFileSync(SRC, 'utf8');
const statements = extractStatements(src);
const t = suite('org-scoping');

t.check(`found SQL statements to audit (${statements.length})`, statements.length > 50,
  statements.length <= 50 ? `only ${statements.length} — the extractor is probably broken` : '');

const unscoped = [];
for (const { sql, line } of statements) {
  const tables = tablesTouched(sql);
  if (!tables.length) continue;              // touches no tenant data
  if (isScoped(sql) || allowlisted(sql)) continue;
  unscoped.push({ line, tables, sql: sql.replace(/\s+/g, ' ').trim().slice(0, 90) });
}

t.check(
  `every tenant-table statement is org-scoped (${statements.length} audited)`,
  unscoped.length === 0,
  unscoped.length
    ? `${unscoped.length} unscoped:\n` +
      unscoped.map(u => `      src/index.ts:${u.line}  [${u.tables.join(',')}]  ${u.sql}`).join('\n')
    : '',
);

t.done();
