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
  'ai_cap_blocks', 'ai_parse_log',
  'categories', 'certification_types', 'finished_product_items', 'finished_products',
  'generic_products', 'inventory', 'invoice_lines', 'invoices', 'item_placements',
  'operating_expenses', 'pos_imports', 'pos_item_map', 'pos_sale_lines',
  'product_aliases', 'product_entries', 'product_mappings',
  'recipe_items', 'recipes', 'recurring_expenses', 'sales_monthly', 'spread_expenses',
  'staff', 'staff_certifications', 'stock_log', 'stock_take_items', 'stock_takes',
  'storage_sections', 'suppliers', 'units', 'vendor_fee_templates',
]);

// Statements that touch a tenant table but correctly need no org filter.
// Keyed by a distinctive fragment of the statement. Every entry needs a reason.
const ALLOWLIST = [
  // (populated as the audit proceeds — each entry is a deliberate decision)
];

// Read the string literal starting at src[j] (backtick, single or double
// quote). Returns the contents and the index just past the closing quote,
// or null when src[j] does not open a string.
function readStringLiteral(src, j) {
  const quote = src[j];
  if (quote !== '`' && quote !== '"' && quote !== "'") return null;
  let k = j + 1;
  let value = '';
  while (k < src.length) {
    if (src[k] === '\\') { value += src[k] + src[k + 1]; k += 2; continue; }
    if (src[k] === quote) break;
    value += src[k]; k++;
  }
  return { value, end: k + 1 };
}

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
    const lit = readStringLiteral(src, j);
    if (!lit) { i = j; continue; }             // not a literal — see below
    out.push({ sql: lit.value, line: src.slice(0, i).split('\n').length });
    i = lit.end;
  }
  return out;
}

// Handler bounds, used both to resolve variable-built queries and to check
// that a handler binding `org` also declares it.
function handlerRanges(src) {
  const starts = [...src.matchAll(/^app\.(get|post|put|patch|delete)\(\s*'([^']+)'/gm)];
  return starts.map((m, i) => ({
    method: m[1].toUpperCase(),
    path: m[2],
    start: m.index,
    end: i + 1 < starts.length ? starts[i + 1].index : src.length,
  }));
}

// A query assembled in a variable — `let sql = \`...\`; sql += ' AND x = ?';
// DB.prepare(sql)` — is invisible to extractStatements, which only reads
// literals passed straight to prepare(). That is exactly how an unscoped
// GET /api/price-movers shipped past this audit once. So resolve them: find
// every literal assigned or appended to that identifier inside the enclosing
// handler and audit the concatenation as one statement.
//
// `unresolved` is the safety net — a prepare(variable) whose literals this
// cannot find is reported rather than silently skipped, because "not audited"
// must never look like "passed".
function extractVariableStatements(src, ranges) {
  const out = [];
  const unresolved = [];
  const re = /DB\.prepare\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const ident = m[1];
    const line = src.slice(0, m.index).split('\n').length;
    const range = ranges.find(r => m.index >= r.start && m.index < r.end);
    const body = range ? src.slice(range.start, range.end) : '';
    const assign = new RegExp(`\\b${ident}\\s*\\+?=\\s*`, 'g');
    let sql = '';
    let a;
    while ((a = assign.exec(body)) !== null) {
      const lit = readStringLiteral(body, a.index + a[0].length);
      if (lit) sql += ' ' + lit.value;
    }
    if (sql.trim()) out.push({ sql, line });
    else unresolved.push(`src/index.ts:${line}  DB.prepare(${ident})`);
  }
  return { out, unresolved };
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
const ranges = handlerRanges(src);
const built = extractVariableStatements(src, ranges);
const statements = [...extractStatements(src), ...built.out];
const t = suite('org-scoping');

t.check(`found SQL statements to audit (${statements.length})`, statements.length > 50,
  statements.length <= 50 ? `only ${statements.length} — the extractor is probably broken` : '');

t.check(
  'every DB.prepare(variable) query could be resolved back to its SQL',
  built.unresolved.length === 0,
  built.unresolved.length
    ? `not audited — inline the SQL or teach the extractor:\n      ${built.unresolved.join('\n      ')}`
    : '',
);

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

// A statement can mention org_id and still be broken: the check above is
// textual, so it passes happily when the handler never declared the `org`
// variable it binds. That is a runtime ReferenceError — a 500 on a page that
// looked audited. It happened once (GET /api/pnl), which is why this exists.
//
// For each route handler, if its body binds `org` it must also declare it.
// Comments must be stripped first: prose like "another org's row" or a mention
// of org-scoping.test.mjs matches the same word and produced two false alarms
// on the first run. A check that cries wolf gets ignored.
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const missingOrgDecl = [];
for (const r of ranges) {
  const body = stripComments(src.slice(r.start, r.end));
  // Uses `org` as a bind argument but never defines it in this handler.
  const usesOrg = /\borg\b(?!_id|Of|anization)/.test(body);
  const declaresOrg = /\bconst\s+org\s*=/.test(body);
  if (usesOrg && !declaresOrg) missingOrgDecl.push(`${r.method} ${r.path}`);
}

t.check(
  `handlers that bind org also declare it (${ranges.length} routes)`,
  missingOrgDecl.length === 0,
  missingOrgDecl.length ? `undeclared in: ${missingOrgDecl.join(', ')}` : '',
);

t.done();
