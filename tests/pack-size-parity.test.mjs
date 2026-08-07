// The two pack-size parsers must agree, and 'lt' must never escape as a unit.
//
// There are two copies of this logic and they read the SAME supplier text:
//   public/static/invoices.js  parsePackaging()  — the review screen you edit
//   src/index.ts               parsePackSize()   — the write path that stores it
// If they ever disagree, the number you approved on screen is not the number
// filed against the product, and nothing anywhere would say so. That is the
// mixed-unit class of bug this repo has been bitten by more than once.
//
// tests/pack-size-pins.test.mjs already checks the two files carry an identical
// unit alternation, but matching source text is only a proxy. This file runs
// BOTH functions over a generated corpus and compares the answers, so a
// divergence anywhere else in either function is caught too.
//
// The backend is TypeScript and tsc is not installed, so parsePackSize is
// lifted out of src/index.ts by source text and its parameter annotations
// stripped. Both functions are self-contained (parsePackSize calls only
// normalizeUnit, which is lifted with it) — see extractFn() below. If either
// gains a dependency the extraction fails loudly rather than silently testing
// nothing.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const t = suite('pack-size-parity');

const { parsePackaging } = loadBrowserModule(['invoices.js'], ['parsePackaging']);

// ── Lift the backend functions out of the TypeScript source ──────────────────
const backendSrc = readFileSync(join(ROOT, 'src/index.ts'), 'utf8');

// Grabs a top-level `function name(...) { ... }` — the closing brace of a
// top-level function is the first `}` in column 0 — and rewrites the signature
// without its type annotations. Only the signature is touched; the body is
// used verbatim, so what runs here is the real shipped logic.
function extractFn(name) {
  const m = backendSrc.match(new RegExp(`^function ${name}\\s*\\([\\s\\S]*?^\\}`, 'm'));
  if (!m) throw new Error(`could not find top-level function ${name}() in src/index.ts`);
  const body   = m[0];
  const nl     = body.indexOf('\n');
  const header = body.slice(0, nl);
  const params = header
    .slice(header.indexOf('(') + 1, header.lastIndexOf(')'))
    .split(',').map(p => p.split(':')[0].trim()).filter(Boolean);
  return `function ${name}(${params.join(', ')}) {` + body.slice(nl);
}

let parsePackSize = null;
let liftError     = null;
try {
  const code = [extractFn('normalizeUnit'), extractFn('parsePackSize'),
                'export { normalizeUnit, parsePackSize };'].join('\n');
  ({ parsePackSize } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64')));
} catch (e) {
  liftError = e.message;
}

t.section('The backend parser can be executed at all');
t.check('parsePackSize + normalizeUnit lifted from src/index.ts', parsePackSize !== null,
  liftError || 'lift failed');
if (!parsePackSize) {
  t.check('ABORTING — parity below cannot run, do not read a pass here as coverage', false);
  t.done();
}

// ── Corpus ──────────────────────────────────────────────────────────────────
// Combinatorial rather than hand-listed, so it covers spacing, casing and
// separator variants nobody would think to write out.
const nums  = ['1', '2', '3', '4', '6', '12', '20', '0.5', '1.89', '2.5', '500'];
const seps  = ['x', 'X', '×', ' x ', ' X ', '/', ' / '];
const units = ['kg', 'KG', 'g', 'lb', 'lbs', 'LB', 'l', 'L', 'lt', 'LT', 'Lt',
               'ml', 'ML', 'oz', 'OZ', 'fl oz', 'gal', 'ct', 'each', 'case', 'BUNCH',
               'ltr', 'litre', 'cs', ''];
const corpus = [];
for (const u of units) for (const gap of ['', ' ']) for (const a of nums) {
  corpus.push(`${a}${gap}${u}`);
  for (const s of seps) for (const b of ['2', '3', '2.5', '100']) corpus.push(`${a}${s}${b}${gap}${u}`);
}
corpus.push('', '   ', 'abc', '20CS of 50KG', '1/5 KG CS', '4x3', '6 x 2.5', 'Case of 12');
const inputs = [...new Set(corpus)];

t.section('The two parsers agree wherever both find a quantity AND a unit');
// Scoped deliberately. Where the frontend finds no number or no unit it returns
// blanks so the confirm guard blocks the line, while the backend substitutes
// 'each'. That difference is pre-existing and intentional — those lines are
// rejected by packSizeHasUnit()/collectLineProblems() long before anything is
// stored, so they are not a divergence that can reach the database. Every case
// where BOTH parsers commit to an answer must match.
let compared = 0;
const qtyDiffs = [], unitDiffs = [];
for (const s of inputs) {
  const f = parsePackaging(s);
  const b = parsePackSize(s);
  const fq = parseFloat(f.pack_qty);
  const fu = (f.pack_unit || '').trim();
  if (!(fq > 0) || !fu) continue;
  compared++;
  if (Math.abs(fq - b.packQty) > 1e-9)                              qtyDiffs.push(`${JSON.stringify(s)}: screen ${fq} vs stored ${b.packQty}`);
  if (fu.toLowerCase() !== String(b.packUnit).trim().toLowerCase()) unitDiffs.push(`${JSON.stringify(s)}: screen ${JSON.stringify(fu)} vs stored ${JSON.stringify(b.packUnit)}`);
}

t.check(`corpus is big enough to mean something (${inputs.length} inputs, ${compared} comparable)`,
  inputs.length > 15000 && compared > 15000, `only ${inputs.length}/${compared}`);
t.check(`quantities agree on all ${compared} comparable inputs`, qtyDiffs.length === 0,
  qtyDiffs.slice(0, 5).join(' | '));
t.check(`units agree on all ${compared} comparable inputs`, unitDiffs.length === 0,
  unitDiffs.slice(0, 5).join(' | '));

t.section("'lt' is a spelling, never a stored unit — the customer must never see it");
// This is the promise made when 'lt' was added: it is translated to 'L' on the
// way in and never becomes a unit of its own. A stored 'lt' would be a SECOND
// volume unit that does not convert into 'L', so oil invoiced in 'lt' could not
// be costed into a recipe measured in 'L'.
const ltInputs = inputs.filter(s => /lt/i.test(s));
const leakedFront = ltInputs.filter(s => /^lt$/i.test((parsePackaging(s).pack_unit || '').trim()));
const leakedBack  = ltInputs.filter(s => /^lt$/i.test(String(parsePackSize(s).packUnit).trim()));

t.check(`the corpus actually exercises 'lt' (${ltInputs.length} inputs)`, ltInputs.length > 500,
  `only ${ltInputs.length}`);
t.check("review screen never returns 'lt' as the unit", leakedFront.length === 0, leakedFront.slice(0, 5).join(', '));
t.check("write path never returns 'lt' as the unit",     leakedBack.length  === 0, leakedBack.slice(0, 5).join(', '));

t.section("'lt' is NOT in the units master list, so it cannot reach a picker");
// DEFAULT_UNITS is seeded into every new organization. If 'lt' were added there
// it would appear in the unit dropdown, in inventory and in recipes as a real
// unit — exactly what translating it to 'L' is meant to avoid.
const defUnitsMatch = backendSrc.match(/const DEFAULT_UNITS = \[([^\]]*)\]/);
t.check('DEFAULT_UNITS found in src/index.ts', defUnitsMatch !== null, 'declaration moved?');
const defUnits = defUnitsMatch
  ? defUnitsMatch[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  : [];
t.check(`DEFAULT_UNITS has no 'lt' (${defUnits.join(', ')})`,
  !defUnits.some(u => u.toLowerCase() === 'lt'), `found it in ${defUnits.join(', ')}`);
t.check("DEFAULT_UNITS still offers 'L'", defUnits.includes('L'), `got ${defUnits.join(', ')}`);

t.section('The lines that mattered, end to end');
// The two real invoice lines, run through the write path that actually stores
// the numbers. cost_per_unit = line total / (pack_qty x order qty).
const cpu = (packStr, orderQty, lineTotal) =>
  Math.round((lineTotal / (parsePackSize(packStr).packQty * orderQty)) * 100) / 100;

t.check('Yen Bros olive oil "4x3 lt" x 1 @ $123.26 -> $10.27/L (was $30.82)',
  cpu('4x3 lt', 1, 123.26) === 10.27, `got ${cpu('4x3 lt', 1, 123.26)}`);
t.check("Yen Bros olive oil stores unit 'L', not 'lt'",
  parsePackSize('4x3 lt').packUnit === 'L', `got ${JSON.stringify(parsePackSize('4x3 lt').packUnit)}`);
t.check('Cioffi artichoke "2.5KG" x 1 @ $258.89 -> $103.56/kg — STILL WRONG, the AI dropped the 6',
  cpu('2.5KG', 1, 258.89) === 103.56, `got ${cpu('2.5KG', 1, 258.89)}`);
t.check('an ordinary catchweight line is untouched: "1 kg" x 4.95 @ $163.30 -> $32.99/kg',
  cpu('1 kg', 4.95, 163.30) === 32.99, `got ${cpu('1 kg', 4.95, 163.30)}`);

t.done();
