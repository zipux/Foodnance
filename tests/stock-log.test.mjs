// Static audit: the stock movement log, redone (2026-10-06).
//
// The log is history that three things are read back from — the P&L's waste
// totals, undoing a sales import, and "Stock after". It must be filtered by the
// server, never offer a way to erase itself, and outlive the item it is about.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src  = readFileSync(join(ROOT, 'src/index.ts'), 'utf8');
const inv  = readFileSync(join(ROOT, 'public/static/inventory.js'), 'utf8');
const html = readFileSync(join(ROOT, 'public/inventory.html'), 'utf8');
const take = readFileSync(join(ROOT, 'public/static/stock-take.js'), 'utf8');
const t = suite('stock-log');

const route = src.slice(src.indexOf("app.get('/api/stock-log'"), src.indexOf('// AUTH ROUTES'));
const logJs = inv.slice(inv.indexOf('// ── Stock Log Modal'), inv.indexOf('// ── Delete Inventory Item'));
const modal = html.slice(html.indexOf('id="logModal"'), html.indexOf('<!-- TOAST -->'));

t.section('filtered by the server');
t.check('route exists, own organization only', /const org = orgOf\(c\)/.test(route) && /l\.org_id IS \?1/.test(route)
  && /inv\.org_id IS \?1/.test(route) && /st\.org_id IS \?1/.test(route));
t.check('dates, one item, a search and a kind are all applied in the query',
  /datetime\(moved_at\) >= datetime\(\?2\)/.test(route) && /datetime\(moved_at\) <= datetime\(\?3\)/.test(route)
  && /inventory_id = \?/.test(route) && /item_name LIKE \?/.test(route) && /kind = \?/.test(route));
t.check('every value is bound, none pasted into the SQL', !/\$\{(q|kind|inventoryId|from|to)\}/.test(route));
t.check('a search cannot smuggle in a pattern', /ESCAPE/.test(route));
t.check('only a known kind filters', /STOCK_LOG_KINDS\.has\(kind\)/.test(route));
t.check('the default window is the last 30 days', /30 \* 86400000/.test(route));
t.check('the page asks the server, and no longer filters loaded lines itself',
  /apiGet\(`stock-log\?\$\{logQuery\(0\)\}`\)/.test(logJs) && !/logs\.filter\(/.test(logJs) && !/tables\/\$\{LOG_TABLE\}\?page=/.test(logJs));
t.check('it opens on the last 30 days', /const LOG_DAYS = 30;/.test(logJs) && /getDate\(\) - LOG_DAYS/.test(logJs));
t.check('Pro, like the page it sits on', /if \(path === '\/api\/stock-log'\) return 'inventory_tools'/.test(src));

t.section('"Stock after"');
t.check('worked back from the shelf: quantity now, less every change RECORDED later',
  /inv\.quantity - COALESCE\(SUM\(l\.change\) OVER \(\s*PARTITION BY l\.inventory_id ORDER BY l\.rowid DESC\s*ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING\)/.test(route));
// A sales import is dated by the sale but takes stock off when uploaded. By date,
// a count that had already absorbed those sales came "after" them and the column
// went negative on real data.
t.check('never ordered by the date a line is about', !/OVER \([^)]*moved_at/.test(route));
t.check('the list is in the same order as the column', /ORDER BY rid DESC LIMIT/.test(route));
t.check('it reads everything recorded since the oldest line shown', /l\.rowid >= COALESCE\(\(\s*SELECT MIN\(o\.rowid\) FROM stock_log o WHERE o\.org_id IS \?1/.test(route));
t.check('computed before the filters, so a filtered line keeps its true figure',
  route.indexOf('OVER (') < route.indexOf(') WHERE ${where.join'));
t.check('blank, not invented, when the bin is gone', /CASE WHEN inv\.id IS NULL THEN NULL/.test(route) && /'—'/.test(logJs));

t.section('what the customer sees');
t.check('unit on the change and on the stock after', /\$\{num\(Math\.abs\(change\)\)\}\$\{unit\}/.test(logJs) && /num\(Number\(l\.stock_after\)\) \+ unit/.test(logJs));
t.check('the kind buttons', ['Deliveries', 'Sales', 'Waste', 'Counts', 'Production'].every(k => logJs.includes(`label: '${k}'`)));
t.check('a row opens the log on that one item', /function historyButtonHtml/.test(inv) && /openLogModal\(\{ inventoryId:/.test(inv)
  && /\$\{historyButtonHtml\(r\)\}/.test(inv));
t.check('links to the invoice and the count', /\/invoices\.html\?open=\$\{encodeURIComponent\(l\.invoice_id\)\}/.test(logJs)
  && /\/stock-take\.html\?history=1&open=\$\{encodeURIComponent\(l\.stock_take_id\)\}/.test(logJs));
t.check('the Stock Take page honours that link', /get\('open'\)/.test(take) && /await openHistory\(wanted\)/.test(take));
t.check('an invoice number shared by two invoices is not guessed at', /invoiceByNumber\.has\(r\.invoice_number\) \? null : r\.id/.test(route));
t.check('no dollar values, by decision', !/fmt\(|fmtMoney|\$\$\{/.test(logJs));
t.check('no Lot # column', !/Lot #/.test(modal) && !/lot_number/.test(logJs));
t.check('a sales line never shows the import\'s internal id', /return `\$\{text\}\$\{link\}`;/.test(logJs));
t.check('server text is escaped', !/\$\{l\.item_name\}|\$\{l\.note\}|\$\{l\.reason\}[^)]/.test(logJs));

t.section('the log is history');
t.check('no "Clear All Log" anywhere', !/clearLogBtn|Clear All Log|clearStockLog/.test(html + inv));
t.check('removing an item no longer deletes its lines', !/apiDelete\(`tables\/\$\{LOG_TABLE\}/.test(inv) && /Its movement history is kept/.test(inv));
const guards = (src.match(/if \(table === 'stock_log'\) return stockLogIsHistory\(c\)/g) || []).length;
t.check('the server refuses to change or delete a line, on all three routes', guards === 3, `${guards}`);
t.check('but lines can still be added (the pages write them)', !/app\.post\('\/api\/tables\/:table'[\s\S]{0,400}stockLogIsHistory/.test(src));

t.done();
