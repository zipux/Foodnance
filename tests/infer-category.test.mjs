// inferCategory() must not file food as operating supplies.
//
// The keyword list is only a FALLBACK now — aiCategorizeProducts() is the
// primary path — but the fallback is what runs whenever the API key is dead,
// the call fails, or the model answers off-list, which on this project is not a
// hypothetical. It has to be safe on its own.
//
// Two classes of bug are pinned here:
//
//   1. SUBSTRING MATCHES. Matching without word boundaries put "Extra Virgin
//      White Truffle Oil" in Alcohol (via 'gin') and "Asparagus" in Linen &
//      Uniforms (via 'rag'). Those categories are typed 'beverage' and
//      'supplies', so both products left food COGS in the P&L — silently.
//
//   2. THE FIX BREAKING PLURALS. A bare \b would stop 'tomato' matching
//      "Tomatoes with Basil", turning a costing-neutral improvement into a
//      regression across every existing product. The (e?s) tail is what keeps
//      those working, and it is easy to drop by accident.
//
// The backend is TypeScript and tsc is not installed, so the functions are
// lifted out of src/index.ts by source text — same approach as
// pack-size-parity.test.mjs. What runs below is the real shipped logic, not a
// copy; if the lift fails the suite fails loudly rather than silently testing
// nothing.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const t = suite('infer-category');

const backendSrc = readFileSync(join(ROOT, 'src/index.ts'), 'utf8');

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

// extractFn only strips annotations from the SIGNATURE. inferCategory also
// annotates its rules table in the body (`const rules: [string, string[]][] =`),
// which V8 reads as "Missing initializer in const declaration". Strip exactly
// that one declaration — narrowly, so that if the source changes shape the lift
// fails loudly instead of quietly testing something else.
const stripBodyTypes = (src) => src.replace(/const rules\s*:[^=]+=/, 'const rules =');

let inferCategory = null;
let liftError     = null;
try {
  // _KW_RE is a module-level const (a regex cache), not a function, so it is
  // declared here rather than lifted. Everything else is the real source.
  const code = [
    'const _KW_RE = new Map();',
    extractFn('keywordHit'),
    stripBodyTypes(extractFn('inferCategory')),
    'export { inferCategory, keywordHit };',
  ].join('\n');
  ({ inferCategory } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64')));
} catch (e) {
  liftError = e.message;
}

t.section('The function can be executed at all');
t.check('inferCategory lifted from src/index.ts', inferCategory !== null, liftError || 'lift failed');
if (!inferCategory) {
  t.check('ABORTING — nothing below ran, do not read a pass here as coverage', false);
  t.done();
}

const is = (name, expected) =>
  t.check(`${name} → ${expected}`, inferCategory(name) === expected,
    `got ${inferCategory(name)}`);
const isNot = (name, forbidden) =>
  t.check(`${name} is NOT ${forbidden}`, inferCategory(name) !== forbidden,
    `got ${inferCategory(name)}`);

// ── 1. The three real production misfilings ─────────────────────────────────
// Observed in live data 2026-08-08. Kept as end-to-end pins: these names must
// come out right, whichever part of the fix gets them there.
t.section('The real misfilings from production');
isNot('Extra Virgin White Truffle Oil', 'Alcohol');          // matched 'gin'
isNot('Asparagus', 'Linen & Uniforms');                      // matched 'rag'
isNot('Coca-Cola Glass Bottles', 'Packaging');               // matched 'bottle'
is('Asparagus', 'Produce');
is('Coca-Cola Glass Bottles', 'Non-Alcoholic Beverages');

// ── 2. The word-boundary rule, isolated ─────────────────────────────────────
// Every name here contains a keyword INSIDE a longer word and matches no
// legitimate keyword at all, so the only thing that can categorise them is the
// substring bug. That matters: three of the pins above pass even with substring
// matching restored, because the new keywords ('asparagus', 'cola') match
// earlier in the rule order and mask it. These do not — revert keywordHit() to
// haystack.includes() and every one of them fails.
t.section('Keywords never match inside a longer word');
isNot('Virgin Coconut Oil', 'Alcohol');                      // 'gin' in "virgin"
isNot('Borage Flowers', 'Linen & Uniforms');                 // 'rag' in "borage"
isNot('Pandan Extract', 'Smallwares & Equipment');           // 'pan' in "pandan"
isNot('Boxty Mix', 'Packaging');                             // 'box' in "boxty"
isNot('Teatowel-Free Sundries', 'Non-Alcoholic Beverages');  // 'tea' in "teatowel"

// ── 2. Plurals still match, or this fix is a regression ─────────────────────
t.section('Plurals still match (the (e?s) tail)');
is('Tomatoes with Basil', 'Produce');
is('Olives Mixed Mediterranean Pitted', 'Produce');
is('Nitrile Gloves', 'Disposables');
is('Beans Cannellini', 'Dry Goods & Pantry');
is('Fresh Herbs', 'Produce');

// ── 3. The eight real Demo Essential products that landed in Other ──────────
t.section('The specialty products that used to fall through to Other');
is('Grana Padano Grated', 'Dairy & Eggs');
is('Pecorino Romano White Wax Grated', 'Dairy & Eggs');
is('Guanciale Mild', 'Meat & Poultry');
is('Baby Arugula', 'Produce');
is('Broccolini', 'Produce');
is('Sweet Basil', 'Produce');
is('Artichoke Baby in Sunflower Oil', 'Produce');

// ── 4. Previously-correct answers are unchanged ─────────────────────────────
// Rule ORDER carries these, and reordering the list would break them silently.
t.section('Existing correct answers still hold');
is('Extra Virgin Olive Oil', 'Oils, Sauces & Condiments');   // Oils beats Alcohol
is('Beef AAA Tenderloin Cleaned', 'Meat & Poultry');
is('Homogenized Milk', 'Dairy & Eggs');
is('00 Style Flour', 'Dry Goods & Pantry');
is('Yellow Fingerling Potato', 'Produce');
is('Prosciutto Cotto Castagna', 'Meat & Poultry');
is('Orange Juice', 'Non-Alcoholic Beverages');               // fruit names kept OUT of Produce
is('Chianti Classico DOCG Red Wine', 'Alcohol');

// ── 5. Nothing matches at all → Other, never a wrong guess ──────────────────
t.section('Unknown products fall to Other rather than guessing');
is('Assorted Sundries', 'Other');
is('Item 4471', 'Other');

t.done();
