// What a plan costs and how many invoices it reads a month is said in several
// places: the pricing page (cards, details, the tags Google reads), the
// homepage answer (visible and structured), and the app, which enforces the
// limit. They have to say the same thing.
import { readFileSync } from 'node:fs';
import { suite } from './helpers/assert.mjs';

const t = suite('plan-prices-and-limits');
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const src = read('src/index.ts'), pricing = read('public/pricing.html'), home = read('public/index.html'), terms = read('public/terms.html');

const table = name => {
  const body = src.match(new RegExp(`const ${name}: Record<string, number> = \\{([^}]*)\\}`))?.[1] || '';
  return Object.fromEntries([...body.matchAll(/(\w+):\s*(\d+)/g)].map(m => [m[1], Number(m[2])]));
};
const now = table('PLAN_INVOICE_CAPS'), before = table('PLAN_INVOICE_CAPS_BEFORE');

t.section('the limits the app enforces');
t.check('new accounts: Essential 80, Pro 200', now.essential === 80 && now.pro === 200, JSON.stringify(now));
t.check('accounts from before keep Essential 150, Pro no limit', before.essential === 150 && before.pro === 0, JSON.stringify(before));
t.check('which table applies is decided by the day the account was created',
  /created >= NEW_INVOICE_CAPS_FROM \? PLAN_INVOICE_CAPS : PLAN_INVOICE_CAPS_BEFORE/.test(src));
t.check('an account with no creation date is treated as an old one, never tightened', /const table = created && created >= NEW_INVOICE_CAPS_FROM/.test(src));
t.check('an override typed on the admin screen still wins', /if \(orgRow\.invoice_cap !== null && orgRow\.invoice_cap !== undefined\) \{\s*return Number\(orgRow\.invoice_cap\) \|\| 0/.test(src));
const reads = (src.match(/SELECT [^'`]*invoice_cap[^'`]* FROM organizations WHERE id = \?/g) || []);
t.check('every place that reads the limit also reads the creation date', reads.length >= 2 && reads.every(q => /created_at/.test(q)), reads.join(' | '));
t.check('the month is the calendar month', /function monthStart\(\): string \{\s*return new Date\(\)\.toISOString\(\)\.slice\(0, 7\) \+ '-01 00:00:00'/.test(src));

t.section('the pricing page says the same');
t.check(`Essentials card: up to ${now.essential} invoices a month`, pricing.includes(`Invoice reading from a photo or PDF, up to ${now.essential} invoices a month`));
t.check(`Pro card: up to ${now.pro} invoices read a month`, pricing.includes(`Up to ${now.pro} invoices read a month`));
t.check('the details say both, and that it starts again on the 1st',
  pricing.includes(`Essentials reads up to ${now.essential} invoices a month, Pro up to ${now.pro}. The count starts again on the 1st of each month.`));
t.check('the tags Google reads carry the limits', pricing.includes(`Invoice reading (up to ${now.essential} invoices a month)`) && pricing.includes(`up to ${now.pro} invoices read a month, plus`));

t.section('the prices agree everywhere');
const cards = [...pricing.matchAll(/<div class="price">\$(\d+) <span class="cur">CAD<\/span>/g)].map(m => Number(m[1]));
const tags  = [...pricing.matchAll(/"price": "(\d+)\.00"/g)].map(m => Number(m[1]));
t.check('two cards: $79 and $159', cards.length === 2 && cards[0] === 79 && cards[1] === 159, cards.join(','));
t.check('each structured price appears twice and matches its card', JSON.stringify(tags) === JSON.stringify([cards[0], cards[0], cards[1], cards[1]]), tags.join(','));
t.check('the page description names both prices', pricing.includes(`$${cards[0]} a month (Essentials) or $${cards[1]} a month (Pro)`));
const answer = `Essentials is $${cards[0]} a month and covers invoice reading (up to ${now.essential} invoices a month), price history and price-change alerts, recipe and dish costing, and a monthly P&amp;L. Pro is $${cards[1]} a month, reads up to ${now.pro} invoices a month, and adds inventory and stock counts.`;
t.check('the homepage answer says it twice, word for word (visible and for Google)', home.split(answer).length - 1 === 2);
t.check('no old Pro price is left on the public pages', !/\$150\b/.test(pricing + home + terms));

t.section('the Terms');
t.check('the limit is per calendar month, on the plan\'s stated number, for every plan',
  /limited per organization per calendar month, to the number of invoices stated for your plan when you subscribe/.test(terms) && !/on lower plans/.test(terms));

t.done();
