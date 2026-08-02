// Producing a batch must set the recipe to 'batched' — public/static/recipes.js
//
// Pressing Produce Batch IS the declaration that a recipe is made ahead, so the
// app records it instead of relying on someone having set a dropdown first.
// Without the flip, a recipe left on the default 'on_demand' takes its
// ingredients when the batch is produced AND again on every sale that explodes
// it, while the bin it just filled is never drawn down. That is the last way
// left to double-count, now that a batched line falls through to raw materials
// when its bin runs short (takeFromBatch in src/index.ts).
//
// The flip lives in the browser — Produce Batch is a sequence of generic table
// writes with no endpoint of its own to hook — so this is a static audit of the
// shipped source. It cannot prove the write lands; it proves the code that does
// it is still there, still unconditional, and still ahead of the stock moves.
//
// ORDER IS THE POINT. If the flip fails, production never runs. If production
// fails after the flip, the recipe is 'batched' with an empty bin, which sales
// now handle by falling through to raw materials — harmless. The reverse order
// leaves the double-count standing on any failure.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const STATIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'static');
const src = readFileSync(join(STATIC, 'recipes.js'), 'utf8');

const t = suite('produce-batch-flip');

const fn = src.slice(src.indexOf('async function confirmProduceBatch'));
const body = fn.slice(0, fn.indexOf('\n}\n'));
t.check('confirmProduceBatch is still in recipes.js', body.length > 0 && body.length < 6000,
  `${body.length} chars`);

const flipAt    = body.indexOf("production_mode: 'batched'");
const deductAt  = body.indexOf('upsertInventory');
const batchAt   = body.indexOf("itemType:  'batch'");

t.check('it writes production_mode = batched', flipAt > -1);
t.check('it still moves stock', deductAt > -1 && batchAt > -1);
t.check('the flip happens BEFORE any stock moves',
  flipAt > -1 && deductAt > -1 && flipAt < deductAt,
  `flip@${flipAt} firstDeduct@${deductAt}`);

// A guard on the flip is fine — re-writing 'batched' over 'batched' every time
// is just a wasted request. A guard on anything else (an account type, a plan,
// a user preference) would put recipes back in the state this prevents.
const guard = body.slice(Math.max(0, flipAt - 320), flipAt);
t.check('the flip is guarded only by "is it already batched?"',
  /production_mode\s*\|\|\s*'on_demand'\s*\)\s*!==\s*'batched'/.test(guard),
  guard.split('\n').filter(l => l.includes('if (')).join(' | ') || '(no if found)');

// The dropdown still has to write the column, or a commissary that genuinely
// wants to change a recipe back has no way to do it.
t.check('the recipe form still saves production_mode too',
  (src.match(/production_mode:/g) || []).length >= 3,
  `${(src.match(/production_mode:/g) || []).length} occurrences`);

t.done();
