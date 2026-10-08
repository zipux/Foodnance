// Static audit of the public Excel template page (food-cost-calculator-excel.html).
//
// The page hands out a file and quotes its cells, so this pins:
//   - the download exists, is a real .xlsx, and the button points at it;
//   - the cells the page names (H12 cost of the dish ... H19 price for the
//     target) are where tools/build-excel-template.py puts them;
//   - the example printed on the page is what the online calculator returns for
//     the same dish, so the two pages can never teach different numbers;
//   - the FAQPage structured data matches the visible FAQ word for word;
//   - it is wired into the site: sitemap, calculator page, shared ids.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'public');
const read = (f) => readFileSync(join(PUB, f), 'utf8');
const page = read('food-cost-calculator-excel.html');
const builder = readFileSync(join(ROOT, 'tools', 'build-excel-template.py'), 'utf8');

const t = suite('food-cost-excel-page');

t.section('The download');
const FILE = 'downloads/food-cost-calculator.xlsx';
t.check('the file exists', existsSync(join(PUB, FILE)));
const bytes = existsSync(join(PUB, FILE)) ? readFileSync(join(PUB, FILE)) : Buffer.alloc(0);
t.check('it is a zip container, as every .xlsx is', bytes[0] === 0x50 && bytes[1] === 0x4b);
t.check('it is small enough to download on a phone', bytes.length > 2000 && bytes.length < 200000, `${bytes.length}`);
t.check('the button points at it and is counted', new RegExp(`<a class="[^"]*js-template-download[^"]*" href="/${FILE}" download>`).test(page));
t.check('no email is asked for (no form, no input)', !/<form\b|<input\b/i.test(page));
t.check('the page loads no calculator script', !/food-cost-calculator\.js/.test(page));

t.section('The cells the page names are where the file has them');
const text = page.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
for (const [row, label] of [[12, 'Cost of the dish'], [13, 'Portions'], [14, 'Cost per portion'], [15, 'Selling price'],
                            [16, 'Food cost'], [17, 'Gross profit per portion'], [18, 'Target food cost'], [19, 'Price needed for the target']]) {
  t.check(`row ${row} is "${label}" in the file`, builder.includes(`(${row}, '${label}',`));
  t.check(`row ${row} is "${label}" on the page`, new RegExp(`<td class="rn">${row}</td><td colspan="7">${label}</td>`).test(page));
}
t.check('ingredients are rows 2 to 11 in the file', /FIRST, LAST = 2, 11\b/.test(builder));
for (const f of ['=B2/(C2*E2)', '=B2/(C2*E2)*CONVERT(F2,G2,D2)', '=SUM(H2:H11)/H13', '=H14/H15', '=H14/H18']) {
  t.check(`the page shows ${f}`, page.includes(`<span class="formula cell">${f}</span>`));
}

t.section('The example is what the online calculator returns');
const { fcCompute, fcMoney, fcPct } = loadBrowserModule(['food-cost-calculator.js'], ['fcCompute', 'fcMoney', 'fcPct']);
const res = fcCompute({
  purchases: [{ id: 'b', qty: '10', unit: 'kg', paid: '300' }, { id: 'p', qty: '5', unit: 'kg', paid: '32' }],
  lines: [{ purchaseId: 'b', qty: '300', unit: 'g' }, { purchaseId: 'p', qty: '200', unit: 'g' }],
  price: '34',
});
for (const [label, value] of [
  ['beef', fcMoney(res.lines[0].cost)], ['potatoes', fcMoney(res.lines[1].cost)], ['dish', fcMoney(res.total)],
  ['food cost', fcPct(res.foodCostPct)], ['gross profit', fcMoney(res.grossProfit)], ['target price', fcMoney(res.targetPrice)],
]) t.check(`the pictured sheet shows the calculator's ${label}: ${value}`, page.includes(`>${value}</td>`));
t.check('the text quotes the same dish cost and food cost', text.includes(`${fcMoney(res.total)} and ${fcPct(res.foodCostPct).replace('%', '')} percent`));
t.check('the file ships with the same example', /'Beef', 300, 10, 'kg', 1, 300, 'g'/.test(builder) && /'Potatoes', 32, 5, 'kg', 1, 200, 'g'/.test(builder));

t.section('Search markup');
const title = (page.match(/<title>([^<]+)<\/title>/) || [])[1] || '';
const desc = (page.match(/<meta name="description" content="([^"]+)"/) || [])[1] || '';
t.check('title is a name of sensible length', title.length >= 25 && title.length <= 62, `${title.length}: ${title}`);
t.check('title says Excel', /excel/i.test(title));
t.check('description fits a search snippet', desc.length >= 100 && desc.length <= 160, `${desc.length}`);
t.check('exactly one h1', (page.match(/<h1\b/g) || []).length === 1);
t.check('canonical is the extensionless URL', /<link rel="canonical" href="https:\/\/foodnance\.com\/food-cost-calculator-excel" \/>/.test(page));
t.check('not held out of search', !/<meta name="robots" content="noindex/.test(page));
t.check('the price and trial length match the pricing page', text.includes('From $79 CAD a month, with a 14-day free trial') && /\$79/.test(read('pricing.html')) && /14-day free trial/.test(read('pricing.html')));

const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
const graph = ld['@graph'];
const byType = (ty) => graph.filter(n => n['@type'] === ty);
t.check('structured data has WebPage, BreadcrumbList and FAQPage', ['WebPage', 'BreadcrumbList', 'FAQPage'].every(ty => byType(ty).length === 1));
t.check('no aggregateRating in the data (there are no reviews)', !JSON.stringify(graph).includes('aggregateRating'));
for (const id of ['https://foodnance.com/#website', 'https://foodnance.com/#org']) {
  t.check(`${id} is defined on the homepage`, read('index.html').includes(`"@id": "${id}"`));
}

t.section('FAQ: structured data == visible page');
const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const faqNodes = byType('FAQPage')[0].mainEntity;
const visible = [...page.matchAll(/<div class="q"><h3>([\s\S]*?)<\/h3><p>([\s\S]*?)<\/p><\/div>/g)]
  .map(m => ({ q: decode(m[1]), a: decode(m[2]) }));
t.check('the visible FAQ was found', visible.length >= 4, `${visible.length}`);
t.check('same number of questions in the markup as on the page', faqNodes.length === visible.length, `${faqNodes.length} vs ${visible.length}`);
faqNodes.forEach((n, i) => {
  t.check(`Q${i + 1} question matches: ${n.name}`, visible[i] && visible[i].q === n.name);
  t.check(`Q${i + 1} answer matches`, visible[i] && visible[i].a === n.acceptedAnswer.text, visible[i] ? `page: ${visible[i].a}` : 'missing');
});

t.section('Wired into the site');
const calc = read('food-cost-calculator.html');
t.check('listed in the sitemap', /<loc>https:\/\/foodnance\.com\/food-cost-calculator-excel<\/loc>/.test(read('sitemap.xml')));
t.check('the calculator page links to it (text and footer)', (calc.match(/href="\/food-cost-calculator-excel"/g) || []).length >= 2);
t.check('it links back to the calculator', (page.match(/href="\/food-cost-calculator"/g) || []).length >= 2);
t.check('robots.txt does not block it or the file', !/Disallow: \/(food-cost-calculator|downloads)/.test(read('robots.txt')));

t.done();
