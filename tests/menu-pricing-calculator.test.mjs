// Menu pricing calculator: the arithmetic (public/static/menu-pricing-calculator.js)
// and the page that carries it (public/menu-pricing-calculator.html).
//
// Runs the SHIPPED script, not a copy. Pinned here, because each is something a
// later edit could quietly break:
//   - a price is rounded UP, never below the target the owner asked for, and a
//     float error must not push $34.95 to $35.95;
//   - what cannot be priced shows no figure at all, never $0.00;
//   - "nothing you type is saved or sent anywhere": the script cannot store or
//     transmit anything;
//   - every number printed on the page (the example, the markup table, the FAQ)
//     is what the calculator returns;
//   - the FAQPage structured data matches the visible FAQ word for word;
//   - it is wired into the site.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (f) => readFileSync(join(PUB, f), 'utf8');
const page = read('menu-pricing-calculator.html');
const js = read('static/menu-pricing-calculator.js');

const { mpPrice, mpRound, mpParseNumber, mpMoney, mpPct, MP_METHODS, MP_ERRORS } =
  loadBrowserModule(['menu-pricing-calculator.js'], ['mpPrice', 'mpRound', 'mpParseNumber', 'mpMoney', 'mpPct', 'MP_METHODS', 'MP_ERRORS']);
const { fcParseNumber, fcCompute, fcMoney } = loadBrowserModule(['food-cost-calculator.js'], ['fcParseNumber', 'fcCompute', 'fcMoney']);

const t = suite('menu-pricing-calculator');
const near = (a, b, e = 1e-9) => typeof a === 'number' && Math.abs(a - b) < e;
const P = (cost, method, target, rounding = 'none') => mpPrice({ cost, method, target, rounding });

t.section('Three ways to a price');
t.check('food cost %: 10.28 at 30% is $34.27', P('10.28', 'pct', '30').price === 34.27);
t.check('markup: 10.28 at 3 times is $30.84', P('10.28', 'markup', '3').price === 30.84);
t.check('profit per plate: 10.28 + 20 is $30.28', P('10.28', 'profit', '20').price === 30.28);
t.check('a markup of 4 and a 25% food cost are the same price', P('10', 'markup', '4').price === P('10', 'pct', '25').price);
t.check('food cost and profit come back with the price', near(P('10', 'pct', '25').foodCostPct, 25) && near(P('10', 'pct', '25').profit, 30));
t.check('a profit of 0 is allowed (sold at cost)', P('10', 'profit', '0').price === 10);
t.check('a markup of exactly 1 is allowed (sold at cost)', P('10', 'markup', '1').price === 10);

t.section('Rounding goes up, and only as far as it must');
t.check('34.27 up to a whole dollar is 35', P('10.28', 'pct', '30', 'dollar').price === 35);
t.check('34.27 up to .95 is 34.95', P('10.28', 'pct', '30', '95').price === 34.95);
t.check('34.96 up to .95 is 35.95', mpRound(34.96, '95') === 35.95);
t.check('exactly 34.95 stays 34.95 (no float jump)', mpRound(34.95, '95') === 34.95);
t.check('exactly 35 stays 35 as a whole dollar', mpRound(35, 'dollar') === 35 && mpRound(10 / 0.25, 'dollar') === 40);
t.check('exactly 35 up to .95 is 35.95', mpRound(35, '95') === 35.95);
t.check('under a dollar still rounds up to .95', mpRound(0.4, '95') === 0.95);
let neverShort = true;
for (let c = 1; c <= 4000; c += 37) for (const pct of [22, 28, 30, 33, 35]) for (const r of ['dollar', '95']) {
  const x = P(String(c / 100), 'pct', String(pct), r);
  if (!(x.price >= x.exact - 1e-9) || x.price - x.exact > 1 + 1e-9 || x.foodCostPct > pct + 1e-9) neverShort = false;
}
t.check('a rounded price never misses the target, and never adds more than a dollar', neverShort);

t.section('What cannot be priced shows no figure');
for (const [label, r, err] of [
  ['no cost', P('', 'pct', '30'), 'no_cost'], ['a cost of zero', P('0', 'pct', '30'), 'no_cost'],
  ['words for a cost', P('abc', 'pct', '30'), 'no_cost'], ['no target', P('10', 'pct', ''), 'no_target'],
  ['a target of 0%', P('10', 'pct', '0'), 'no_target'], ['a 100% food cost', P('10', 'pct', '100'), 'pct_too_high'],
  ['a markup under 1', P('10', 'markup', '0.8'), 'markup_too_low'], ['no profit typed', P('10', 'profit', ''), 'no_target'],
]) t.check(`${label}: ${err}, and every figure is empty`, r.error === err && r.price === null && r.foodCostPct === null && r.profit === null);
t.check('an empty figure is drawn as a dash, never $0.00', mpMoney(null) === '—' && mpPct(null) === '—' && mpMoney(NaN) === '—');
t.check('every error has wording (blank for "still typing")', ['no_cost', 'no_target', 'pct_too_high', 'markup_too_low'].every(k => typeof MP_ERRORS[k] === 'string')
  && MP_ERRORS.pct_too_high.length > 20 && MP_ERRORS.markup_too_low.length > 20);

t.section('Reading what people type');
for (const raw of ['10.28', '1,5', '$1,200.50', ' 30 ', '.5', '12,345.60', 'abc', '', '-3', '1.2.3', '1e3'])
  t.check(`"${raw}" reads the same as in the food cost calculator`, mpParseNumber(raw) === fcParseNumber(raw));
t.check('a typed % or x is forgiven', mpParseNumber('30%') === 30 && mpParseNumber('3x') === 3 && mpParseNumber('3 ×') === 3);
t.check('the method list is what the page offers', Object.keys(MP_METHODS).join() === 'pct,markup,profit'
  && Object.keys(MP_METHODS).every(k => page.includes(`<option value="${k}">${MP_METHODS[k].label}</option>`)));
t.check('the page starts on the first method, with its starting target', new RegExp(`id="mpTargetLabel">${MP_METHODS.pct.label.replace(/[()$%]/g, '\\$&')}<`).test(page)
  && new RegExp(`id="mpTarget" value="${MP_METHODS.pct.start}"`).test(page));

// Strip comments so a sentence ABOUT fetch() in a comment doesn't trip the audit.
const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
t.section('Nothing is saved or sent anywhere');
for (const api of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'localStorage', 'sessionStorage',
                   'indexedDB', 'document.cookie', 'navigator.serviceWorker', 'caches.']) {
  t.check(`the script never uses ${api}`, !code.includes(api));
}
t.check('the script never builds HTML from typed text (innerHTML / insertAdjacentHTML / eval)',
  !/innerHTML|insertAdjacentHTML|outerHTML|document\.write|\beval\(|new Function/.test(code));
t.check('no form and no file input on the page', !/<form\b/i.test(page) && !/type=["']file["']/i.test(page));
t.check('the page says so, by the tool and in the FAQ', (page.match(/Nothing you (type|enter) is (saved|stored) or sent/g) || []).length >= 2);

const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const text = decode(page.slice(page.indexOf('<main>')));
t.section('Every number on the page is what the calculator returns');
const ex = P('10.28', 'pct', '30'), ex95 = P('10.28', 'pct', '30', '95');
t.check('the direct answer under the heading: $10.28 at 30 percent is $34.27',
  text.includes(`A dish that costs $10.28, priced for a 30 percent food cost, is ${mpMoney(ex.price)}.`));
t.check('the worked example: $34.27, then $34.95, 29.4 percent, $24.67 a plate',
  text.includes(`$10.28 ÷ 0.30 is ${mpMoney(ex.price)}. Rounded up to ${mpMoney(ex95.price)}, the food cost is ${mpPct(ex95.foodCostPct).replace('%', '')} percent and each plate leaves ${mpMoney(ex95.profit)} after ingredients.`));
t.check('"Try an example" loads that same dish, at 30% rounded up to .95', /cost: '10\.28'/.test(js)
  && /\$\('mpRound'\)\.value = example \? '95' : 'none';/.test(js) && MP_METHODS.pct.start === '30');
for (const pct of [25, 28, 30, 32, 35]) {
  const row = `<tr><td class="num">${pct}%</td><td class="num">${(100 / pct).toFixed(2)} times cost</td><td class="num">${mpMoney(P('10', 'pct', String(pct)).price)}</td></tr>`;
  t.check(`markup table, ${pct}%: ${(100 / pct).toFixed(2)} times, ${mpMoney(P('10', 'pct', String(pct)).price)}`, page.includes(row));
}
t.check('the FAQ pair: four times cost is 25 percent, 30 percent is 3.33 times',
  text.includes('A markup of four times cost is a food cost of 25 percent. A food cost of 30 percent is a markup of 3.33 times cost.') && (100 / 30).toFixed(2) === '3.33');
const fc = fcCompute({
  purchases: [{ id: 'b', qty: '10', unit: 'kg', paid: '300' }, { id: 'p', qty: '5', unit: 'kg', paid: '32' }],
  lines: [{ purchaseId: 'b', qty: '300', unit: 'g' }, { purchaseId: 'p', qty: '200', unit: 'g' }], price: '34',
});
t.check('the example dish and its price agree with the food cost calculator page', fcMoney(fc.total) === '$10.28' && fcMoney(fc.targetPrice) === mpMoney(ex.price));

t.section('Search markup');
const title = (page.match(/<title>([^<]+)<\/title>/) || [])[1] || '';
const desc = (page.match(/<meta name="description" content="([^"]+)"/) || [])[1] || '';
t.check('title is a name of sensible length', title.length >= 25 && title.length <= 62, `${title.length}: ${title}`);
t.check('title carries the searched phrase', /menu pricing calculator/i.test(title));
t.check('description fits a search snippet', desc.length >= 100 && desc.length <= 160, `${desc.length}`);
t.check('exactly one h1, and it carries the phrase', (page.match(/<h1\b/g) || []).length === 1 && /<h1>Menu pricing calculator/.test(page));
t.check('canonical is the extensionless URL', /<link rel="canonical" href="https:\/\/foodnance\.com\/menu-pricing-calculator" \/>/.test(page));
t.check('not held out of search', !/<meta name="robots" content="noindex/.test(page));
t.check('language is en-CA like the rest of the site', /<html lang="en-CA">/.test(page));
const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
const graph = ld['@graph'];
const byType = (ty) => graph.filter(n => n['@type'] === ty);
t.check('structured data has WebPage, BreadcrumbList, WebApplication and FAQPage',
  ['WebPage', 'BreadcrumbList', 'WebApplication', 'FAQPage'].every(ty => byType(ty).length === 1));
t.check('the WebApplication is free', byType('WebApplication')[0].offers.price === '0' && byType('WebApplication')[0].isAccessibleForFree === true);
t.check('no aggregateRating in the data (there are no reviews)', !JSON.stringify(graph).includes('aggregateRating'));
for (const id of ['https://foodnance.com/#website', 'https://foodnance.com/#org']) {
  t.check(`${id} is defined on the homepage`, read('index.html').includes(`"@id": "${id}"`));
}

t.section('FAQ: structured data == visible page');
const faqNodes = byType('FAQPage')[0].mainEntity;
const visible = [...page.matchAll(/<div class="q"><h3>([\s\S]*?)<\/h3><p>([\s\S]*?)<\/p><\/div>/g)]
  .map(m => ({ q: decode(m[1]), a: decode(m[2]) }));
t.check('the visible FAQ was found', visible.length >= 5, `${visible.length}`);
t.check('same number of questions in the markup as on the page', faqNodes.length === visible.length, `${faqNodes.length} vs ${visible.length}`);
faqNodes.forEach((n, i) => {
  t.check(`Q${i + 1} question matches: ${n.name}`, visible[i] && visible[i].q === n.name);
  t.check(`Q${i + 1} answer matches`, visible[i] && visible[i].a === n.acceptedAnswer.text, visible[i] ? `page: ${visible[i].a}` : 'missing');
});

t.section('Wired into the site');
t.check('listed in the sitemap', /<loc>https:\/\/foodnance\.com\/menu-pricing-calculator<\/loc>/.test(read('sitemap.xml')));
t.check('the food cost calculator links to it (text and footer)', (read('food-cost-calculator.html').match(/href="\/menu-pricing-calculator"/g) || []).length >= 2);
t.check('it links back to the food cost calculator', (page.match(/href="\/food-cost-calculator"/g) || []).length >= 2);
for (const f of ['index.html', 'pricing.html', 'food-cost-calculator-excel.html', 'terms.html', 'privacy.html', 'refund-policy.html'])
  t.check(`${f} links to it in the footer`, read(f).slice(read(f).indexOf('<footer')).includes('href="/menu-pricing-calculator"'));
t.check('robots.txt does not block it', !/Disallow: \/menu-pricing/.test(read('robots.txt')));
t.check('the script tag carries a cache-busting ?v=', /menu-pricing-calculator\.js\?v=\d+-\d+/.test(page));
t.check('the page does not load the other calculator script', !/food-cost-calculator\.js/.test(page));

t.done();
