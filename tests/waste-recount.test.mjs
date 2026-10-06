// Static audit: Adjust Stock became "Record waste" and "Recount" (2026-10-06).
//
// The old window let a restaurant add stock by hand (a delivery with no invoice
// never reaches the P&L, so food cost read low), take "kitchen usage" off a
// second time after a sales import, and overwrite a bin with no record. What
// replaced it must not grow those back.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src  = readFileSync(join(ROOT, 'src/index.ts'), 'utf8');
const inv  = readFileSync(join(ROOT, 'public/static/inventory.js'), 'utf8');
const mig  = readFileSync(join(ROOT, 'migrations/0063_stock_take_kind.sql'), 'utf8');
const t = suite('waste-recount');

const routeStarts = [...src.matchAll(/^app\.(get|post|put|patch|delete)\(\s*'([^']+)'/gm)];
function handler(method, path) {
  const idx = routeStarts.findIndex(m => m[1] === method && m[2] === path);
  if (idx === -1) return null;
  const body = src.slice(routeStarts[idx].index, idx + 1 < routeStarts.length ? routeStarts[idx + 1].index : src.length);
  return body.slice(0, body.indexOf('\n})\n') + 4);
}
const waste = handler('post', '/api/inventory/:id/waste');
const recount = handler('post', '/api/inventory/:id/recount');

t.section('the reasons');
const serverCodes = [...src.match(/const WASTE_REASONS: Record<string, string> = \{([\s\S]*?)\n\}/)[1].matchAll(/^\s*(\w+):\s*'([^']+)'/gm)]
  .map(m => [m[1], m[2]]);
const { wasteReasons, stockReasonsFor } = loadBrowserModule(['utils.js'], ['wasteReasons', 'stockReasonsFor']);
const clientCodes = wasteReasons().map(r => [r.code, r.label]);
t.check('server and page offer the same reasons, worded the same', JSON.stringify(serverCodes) === JSON.stringify(clientCodes),
  `${JSON.stringify(serverCodes)} vs ${JSON.stringify(clientCodes)}`);
const codes = serverCodes.map(c => c[0]);
t.check('menu testing is one of them', codes.includes('menu_testing'));
for (const gone of ['usage', 'received', 'production', 'transfer_in', 'transfer_out', 'correction']) {
  t.check(`"${gone}" is not`, !codes.includes(gone));
}
t.check('every waste reason takes stock off', wasteReasons().every(r => stockReasonsFor('remove').some(x => x.code === r.code)));

t.section('record waste');
t.check('route exists', !!waste);
t.check('only a positive amount', /!\(qty > 0\)/.test(waste));
t.check('only a listed reason', /const reason = WASTE_REASONS\[reasonCode\]/.test(waste) && /if \(!reason\) return/.test(waste));
t.check('it subtracts on the server (relative), never sets a total',
  /SET quantity = ROUND\(quantity - \?, 6\)/.test(waste) && !/SET quantity = \? /.test(waste) && !/new_quantity/.test(waste));
t.check('it logs a negative change', /-qty, reason, reasonCode/.test(waste));
t.check('own organization only', (waste.match(/org_id IS \?/g) || []).length >= 3);

t.section('recount');
t.check('route exists', !!recount);
t.check('zero is a valid count, a negative one is not', /counted < 0/.test(recount) && !/!\(counted > 0\)/.test(recount));
t.check('saved as a one-item count of kind recount', /INSERT INTO stock_takes \(id, status, kind,[^)]*\)\s*VALUES \(\?, 'submitted', 'recount'/.test(recount)
  && /INSERT INTO stock_take_items/.test(recount));
t.check('dated on the device\'s own day, like a full count', /localCountDate\(body\.count_date, now\)/.test(recount));
t.check('a reason is optional, but only from the waste list', /if \(reasonCode && !WASTE_REASONS\[reasonCode\]\)/.test(recount));
t.check('count, line, shelf and log go in one batch', /DB\.batch\(statements\)/.test(recount));

t.section('a recount never brackets a month');
t.check('existing counts are full', /ADD COLUMN kind TEXT NOT NULL DEFAULT 'full'/.test(mig));
const pnl = src.slice(src.indexOf('const closingTake = await'), src.indexOf('const { valueTake } = stockValuer('));
t.check('the P&L picks full counts only, for both ends', (pnl.match(/status = 'submitted' AND kind = 'full'/g) || []).length === 2);
t.check('so do the Inventory page\'s counted marks',
  /kind = 'full'/.test(src.slice(src.indexOf("app.get('/api/stock-take/latest-statuses'"), src.indexOf("app.get('/api/stock-take/latest-statuses'") + 500)));
t.check('the history gives a recount no stock value', /value: recount \? null : stockTotal/.test(src));

t.section('both are Pro, like the window they replace');
t.check('gated with adjust', /\\\/\(adjust\|waste\|recount\)\$\/\.test\(path\)\) return 'inventory_tools'/.test(src));

t.section('the Inventory page');
const buttons = inv.slice(inv.indexOf('function stockButtonsHtml'), inv.indexOf('function buildPriceCell'));
t.check('a restaurant row offers Record waste and Recount', /openAdjustModal\('\$\{esc\(r\.id\)\}', 'waste'\)/.test(buttons)
  && /openAdjustModal\('\$\{esc\(r\.id\)\}', 'recount'\)/.test(buttons));
t.check('only a commissary keeps the three-way Adjust Stock', /if \(window\.__accountType === 'commissary'\) \{[\s\S]*?fa-sliders-h/.test(buttons));
t.check('the rows are redrawn when the account type arrives', /addEventListener\('dm:plan-known', \(\) => \{ if \(allInventory\.length\) renderInventory\(\); \}\)/.test(inv));
t.check('the type picker is hidden outside the old window', /getElementById\('adjustTypeGroup'\)\.classList\.toggle\('hidden', adjustMode !== 'adjust'\)/.test(inv));
t.check('waste opens on remove, recount on set; only the old window on add',
  /adjustMode === 'waste' \? 'remove' : adjustMode === 'recount' \? 'set' : 'add'/.test(inv));
const apply = inv.slice(inv.indexOf('async function applyAdjustment'), inv.indexOf('// ── Stock Log Modal'));
t.check('waste is sent as an amount, not a new total', /inventory\/\$\{invId\}\/waste`, \{ qty, reason_code: reasonCode, note \}/.test(apply));
t.check('waste beyond the shelf is turned away towards Recount', /adjustMode === 'waste' && newQty < 0/.test(apply) && /use Recount/.test(apply));
t.check('a recount goes to its own route with the device\'s day', /inventory\/\$\{invId\}\/recount`/.test(apply) && /count_date:/.test(apply));

t.done();
