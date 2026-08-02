// Which batch/pack controls each kind of account sees — public/static/utils.js
//
// Four combinations, and each cell is a decision someone argued about:
//
//                     How is this made?   Produce Batch   Pack Run
//   restaurant  Ess          hidden          hidden        hidden
//   restaurant  Pro          hidden          SHOWN         hidden
//   commissary  Ess          shown           shown         shown
//   commissary  Pro          shown           shown         shown
//
// The dropdown goes for every restaurant because Produce Batch now records the
// answer itself and a stale answer self-corrects (takeFromBatch falls through to
// raw materials once the bin runs dry). Produce Batch survives on Pro because it
// is the only way to see prep during the week; on Essential nothing would ever
// draw the bin down. A commissary keeps everything — pressing those buttons by
// hand IS their stock workflow.
//
// This is presentation only. _routes.json sends just /api/* to the worker, so a
// static page cannot be gated server-side, and none of this is a security
// boundary — it removes controls that would do nothing useful.
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';

const t = suite('account-type-gating');

const IDS = ['recipeProductionModeGroup', 'produceBatchBtn', 'packRunBtn'];

// Fresh fake page per case: every id present, so "hidden" can only come from
// the code under test and never from a missing element.
function run(accountType, plan) {
  const els = Object.fromEntries(IDS.map(id => [id, { style: {} }]));
  const win = { addEventListener() {}, __accountType: accountType, __accountPlan: plan };
  const { applyBatchWorkflowGating } = loadBrowserModule(
    ['utils.js'], ['applyBatchWorkflowGating'],
    {
      window: win,
      document: {
        addEventListener() {}, querySelector: () => null,
        querySelectorAll: () => [], body: {},
        getElementById: (id) => els[id] || null,
      },
    },
  );
  applyBatchWorkflowGating();
  return Object.fromEntries(IDS.map(id => [id, els[id].style.display === 'none']));
}

t.section('a restaurant is never asked how a recipe is made');
const restEss = run('restaurant', 'essential');
const restPro = run('restaurant', 'pro');
t.check('Essential: dropdown hidden',  restEss.recipeProductionModeGroup === true);
t.check('Essential: Produce Batch hidden — nothing would draw the bin down',
  restEss.produceBatchBtn === true);
t.check('Essential: Pack Run hidden',  restEss.packRunBtn === true);
t.check('Pro: dropdown hidden',        restPro.recipeProductionModeGroup === true);
t.check('Pro: Produce Batch KEPT — it is how prep is visible mid-week',
  restPro.produceBatchBtn === false);
t.check('Pro: Pack Run hidden — a restaurant does not pack',
  restPro.packRunBtn === true);

t.section('a commissary keeps its whole workflow');
for (const plan of ['essential', 'pro']) {
  const c = run('commissary', plan);
  t.check(`${plan}: dropdown shown`,      c.recipeProductionModeGroup === false);
  t.check(`${plan}: Produce Batch shown`, c.produceBatchBtn === false);
  t.check(`${plan}: Pack Run shown`,      c.packRunBtn === false);
}

// The session bootstrap is async, so every page renders for a moment before the
// account type is known. Showing a control that is then hidden is recoverable;
// hiding one the account needs is not — so unknown must mean show everything.
t.section('unknown account shows everything');
for (const [type, plan] of [[undefined, undefined], ['', ''], [undefined, 'pro']]) {
  const un = run(type, plan);
  t.check(`type=${JSON.stringify(type)} plan=${JSON.stringify(plan)}: nothing hidden`,
    IDS.every(id => un[id] === false), JSON.stringify(un));
}

t.done();
