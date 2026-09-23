// Static audit of the public food cost calculator page.
//
// The arithmetic is in food-cost-calculator.test.mjs. This pins what the page
// PROMISES, because each of these is something a later edit could quietly break:
//
//   - "Nothing is saved or sent anywhere" — the page says it three times, so the
//     script must not be able to store or transmit anything.
//   - "Type the numbers, no pictures" — no image, no file upload.
//   - The FAQPage structured data must match the visible FAQ. Search engines
//     treat a mismatch as misleading markup, and answer engines quote whichever
//     copy they find; the two must not drift apart.
//   - The worked example printed on the page must be what the calculator really
//     returns for those inputs, or the page teaches a wrong number.
//   - It is wired into the site: sitemap, homepage and pricing links, and
//     shared structured-data ids.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (f) => readFileSync(join(PUB, f), 'utf8');
const page = read('food-cost-calculator.html');
const js = read('static/food-cost-calculator.js');
const index = read('index.html');
const pricing = read('pricing.html');
const sitemap = read('sitemap.xml');

const t = suite('food-cost-calculator-page');

// Strip comments so a sentence ABOUT fetch() in a comment doesn't trip the audit.
const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

t.section('Nothing is saved or sent anywhere');
for (const api of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'localStorage', 'sessionStorage',
                   'indexedDB', 'document.cookie', 'navigator.serviceWorker', 'caches.']) {
  t.check(`the script never uses ${api}`, !code.includes(api));
}
t.check('the script never builds HTML from typed text (innerHTML / insertAdjacentHTML / eval)',
  !/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(code));
t.check('the page loads only its own scripts (no analytics, no third-party JS)',
  [...page.matchAll(/<script[^>]+src="([^"]+)"/g)].every(m => m[1].startsWith('/static/')),
  [...page.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]).join(', '));
t.check('no form posts anywhere', !/<form\b/i.test(page));
t.check('it tells the visitor, prominently, that nothing is saved',
  /Nothing you type is saved or sent anywhere/.test(page));

t.section('Typed numbers only — no pictures');
t.check('no <img> anywhere on the page', !/<img\b/i.test(page));
t.check('no file input', !/type=["']file["']/i.test(page) && !/accept=["'][^"']*image/i.test(page));
t.check('no background-image or url() image loading in the CSS', !/url\(\s*['"]?(?!#)/.test(page.replace(/https?:\/\/fonts[^"')]+/g, '')));
t.check('the script has no file or camera handling', !/FileReader|getUserMedia|\.files\b|createObjectURL/.test(code));

t.section('Search markup');
const title = (page.match(/<title>([^<]+)<\/title>/) || [])[1] || '';
const desc = (page.match(/<meta name="description" content="([^"]+)"/) || [])[1] || '';
t.check('title is a name of sensible length', title.length >= 25 && title.length <= 62, `${title.length}: ${title}`);
t.check('description fits a search snippet', desc.length >= 100 && desc.length <= 160, `${desc.length}`);
t.check('exactly one h1', (page.match(/<h1\b/g) || []).length === 1);
t.check('canonical is the extensionless URL', /<link rel="canonical" href="https:\/\/foodnance\.com\/food-cost-calculator"/.test(page));
t.check('launched — no longer held out of search', !/<meta name="robots" content="noindex/.test(page));
t.check('language is en-CA like the rest of the site', /<html lang="en-CA">/.test(page));

const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
const graph = ld['@graph'];
const byType = (ty) => graph.filter(n => n['@type'] === ty);
t.check('structured data has WebPage, BreadcrumbList, WebApplication and FAQPage',
  ['WebPage', 'BreadcrumbList', 'WebApplication', 'FAQPage'].every(ty => byType(ty).length === 1));
t.check('the WebApplication is free', byType('WebApplication')[0].offers.price === '0' && byType('WebApplication')[0].isAccessibleForFree === true);
t.check('no aggregateRating in the data (there are no reviews)', !JSON.stringify(graph).includes('aggregateRating'));

// Shared ids must exist on the homepage, or the graph points at nothing.
for (const id of ['https://foodnance.com/#website', 'https://foodnance.com/#org']) {
  t.check(`${id} is defined on the homepage`, index.includes(`"@id": "${id}"`));
}

t.section('FAQ: structured data == visible page');
const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const faqNodes = byType('FAQPage')[0].mainEntity;
const visible = [...page.matchAll(/<div class="q"><h3>([\s\S]*?)<\/h3><p>([\s\S]*?)<\/p><\/div>/g)]
  .map(m => ({ q: decode(m[1]), a: decode(m[2]) }));
t.check('the visible FAQ was found', visible.length >= 6, `${visible.length}`);
t.check('same number of questions in the markup as on the page', faqNodes.length === visible.length, `${faqNodes.length} vs ${visible.length}`);
faqNodes.forEach((n, i) => {
  t.check(`Q${i + 1} question matches: ${n.name}`, visible[i] && visible[i].q === n.name);
  t.check(`Q${i + 1} answer matches`, visible[i] && visible[i].a === n.acceptedAnswer.text,
    visible[i] ? `page: ${visible[i].a}` : 'missing');
});

t.section('The worked example is what the calculator returns');
const { fcCompute, fcMoney, fcPct } = loadBrowserModule(['food-cost-calculator.js'], ['fcCompute', 'fcMoney', 'fcPct']);
const res = fcCompute({
  purchases: [{ id: 'b', qty: '10', unit: 'kg', paid: '300' }, { id: 'p', qty: '5', unit: 'kg', paid: '32' }],
  lines: [{ purchaseId: 'b', qty: '300', unit: 'g' }, { purchaseId: 'p', qty: '200', unit: 'g' }],
  price: '34',
});
const text = decode(page);
for (const [label, value] of [
  ['beef $9.00', fcMoney(res.lines[0].cost)], ['potatoes $1.28', fcMoney(res.lines[1].cost)],
  ['dish $10.28', fcMoney(res.total)], ['food cost 30.2', fcPct(res.foodCostPct).replace('%', '')],
  ['gross profit $23.72', fcMoney(res.grossProfit)], ['target price $34.27', fcMoney(res.targetPrice)],
]) t.check(`page prints ${label}`, text.includes(value), `calculator says ${value}`);

const trimmed = fcCompute({ purchases: [{ id: 'b', qty: '10', unit: 'kg', paid: '300', usable: '85' }], lines: [{ purchaseId: 'b', qty: '300', unit: 'g' }] });
t.check('page prints the 85% usable example ($10.59)', text.includes(fcMoney(trimmed.lines[0].cost)), fcMoney(trimmed.lines[0].cost));
t.check('the "Try an example" button loads the same figures the page prints',
  /qty: '10', unit: 'kg', paid: '300'/.test(js) && /qty: '5', unit: 'kg', paid: '32'/.test(js) &&
  /buy: 0, qty: '300', unit: 'g'/.test(js) && /buy: 1, qty: '200', unit: 'g'/.test(js) && /price: '34'/.test(js));

t.section('Wired into the site');
t.check('listed in the sitemap', /<loc>https:\/\/foodnance\.com\/food-cost-calculator<\/loc>/.test(sitemap));
t.check('homepage links to it (nav and footer)', (index.match(/href="\/food-cost-calculator"/g) || []).length >= 2);
t.check('pricing links to it (nav and footer)', (pricing.match(/href="\/food-cost-calculator"/g) || []).length >= 2);
t.check('the page links back to the homepage and to pricing', /href="\/"/.test(page) && /href="\/pricing"/.test(page));
t.check('it has a way to request access', /mailto:hello@foodnance\.com/.test(page));
t.check('the script tag carries a cache-busting ?v=', /food-cost-calculator\.js\?v=\d+-\d+/.test(page));
t.check('the site-wide staging banner is loaded like on every other page', /env-banner\.js/.test(page));

t.done();
