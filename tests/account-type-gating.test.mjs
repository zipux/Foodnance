// Which batch/pack controls each kind of account sees — public/static/utils.js
//
// Four combinations, and each cell is a decision someone argued about:
//
//                     How is this made?   Produce Batch   Pack Run   Pack Sizes + Reorder Level   SKU/Expiry/Invoice Ref
//   restaurant  Ess          hidden          hidden        hidden          hidden                       hidden
//   restaurant  Pro          hidden          SHOWN         hidden          shown                        shown
//   commissary  Ess          shown           shown         shown           SHOWN                        shown
//   commissary  Pro          shown           shown         shown           shown                        shown
//
// The dropdown goes for every restaurant because Produce Batch now records the
// answer itself and a stale answer self-corrects (takeFromBatch falls through to
// raw materials once the bin runs dry). Produce Batch survives on Pro because it
// is the only way to see prep during the week; on Essential nothing would ever
// draw the bin down. A commissary keeps everything — pressing those buttons by
// hand IS their stock workflow.
//
// The last column is different in kind: it is not about the stock workflow but
// about which PAGES the plan opens. Pack Sizes only feeds the count sheet and
// the adjust-stock modal, and Reorder Level only feeds the Low Stock pill —
// all on /stock-take and /inventory, both Pro. The commissary column is left
// SHOWN on purpose (deferred 2026-08-04), even though the same argument would
// hide it: that call has not been made yet, so the test pins today's answer.
//
// The last column is different again: not gating at all, but paperwork the
// business model does not involve. A restaurant orders by name rather than by
// the vendor's SKU, has nothing on Essential that could act on a best-before
// date, and reaches every invoice — file included — on /invoices, which is not
// gated. Commissary keeps all three for the opposite reason: buying against a
// price list and rotating by date is exactly what it does.
//
// This is presentation only. _routes.json sends just /api/* to the worker, so a
// static page cannot be gated server-side, and none of this is a security
// boundary — it removes controls that would do nothing useful.
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';

const t = suite('account-type-gating');

const IDS = ['recipeProductionModeGroup', 'produceBatchBtn', 'packRunBtn',
             'packLevelsSection', 'lowStockSection',
             'entrySkuGroup', 'entryExpiryGroup', 'entryInvoiceGroup'];

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

// The Add-to-Inventory prompt asks the predicate directly rather than having an
// element hidden for it, so expose it on its own for that case.
function stockDetailFieldsHidden(accountType, plan) {
  const win = { addEventListener() {}, __accountType: accountType, __accountPlan: plan };
  const m = loadBrowserModule(
    ['utils.js'], ['stockDetailFieldsHidden'],
    {
      window: win,
      document: {
        addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
        body: {}, getElementById: () => null,
      },
    },
  );
  return m.stockDetailFieldsHidden();
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

t.section('the product form drops fields whose only screens are Pro');
t.check('Essential: Pack Sizes hidden — nothing on this plan counts cases',
  restEss.packLevelsSection === true);
t.check('Essential: Low-stock Alert hidden — /inventory is the upgrade panel',
  restEss.lowStockSection === true);
// Not merely "not gated": on Pro these fields are live, and a stock take is
// where a wrong pack level costs real money.
t.check('Pro: Pack Sizes shown — the count sheet reads them',
  restPro.packLevelsSection === false);
t.check('Pro: Low-stock Alert shown', restPro.lowStockSection === false);

t.section('the supplier entry form drops warehouse paperwork');
t.check('Essential: SKU hidden — a restaurant orders by name, not by catalogue number',
  restEss.entrySkuGroup === true);
t.check('Essential: Expiry hidden — nothing on this plan counts stock to rotate it',
  restEss.entryExpiryGroup === true);
t.check('Essential: Invoice Ref hidden — /invoices holds the whole invoice, ungated',
  restEss.entryInvoiceGroup === true);
// Pro restaurants do count stock (/stock-take, /inventory), so a best-before
// date and a way back to the source invoice both do real work again.
t.check('Pro: SKU shown',         restPro.entrySkuGroup === false);
t.check('Pro: Expiry shown',      restPro.entryExpiryGroup === false);
t.check('Pro: Invoice Ref shown', restPro.entryInvoiceGroup === false);

// The "Add to Inventory?" prompt after saving a supplier entry rides on the
// same predicate: it writes a bin only /inventory and /stock-take could show or
// correct, and on Essential both are the upgrade panel. Not "record it
// silently" — nothing on an Essential restaurant draws stock DOWN, so the bin
// could only grow, and an upgrade would start with a count needing reconciling.
t.section('the Add-to-Inventory prompt follows the same rule');
t.check('Essential restaurant: suppressed', stockDetailFieldsHidden('restaurant', 'essential') === true);
t.check('Pro restaurant: offered',          stockDetailFieldsHidden('restaurant', 'pro') === false);
t.check('commissary Essential: offered',    stockDetailFieldsHidden('commissary', 'essential') === false);
t.check('commissary Pro: offered',          stockDetailFieldsHidden('commissary', 'pro') === false);
t.check('unknown account: offered',         stockDetailFieldsHidden(undefined, undefined) === false);

t.section('a commissary keeps its whole workflow');
for (const plan of ['essential', 'pro']) {
  const c = run('commissary', plan);
  t.check(`${plan}: dropdown shown`,      c.recipeProductionModeGroup === false);
  t.check(`${plan}: Produce Batch shown`, c.produceBatchBtn === false);
  t.check(`${plan}: Pack Run shown`,      c.packRunBtn === false);
  t.check(`${plan}: Pack Sizes shown`,    c.packLevelsSection === false);
  t.check(`${plan}: Low-stock Alert shown`, c.lowStockSection === false);
  // Buying against a price list and rotating by date IS the commissary job.
  t.check(`${plan}: SKU shown`,         c.entrySkuGroup === false);
  t.check(`${plan}: Expiry shown`,      c.entryExpiryGroup === false);
  t.check(`${plan}: Invoice Ref shown`, c.entryInvoiceGroup === false);
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
