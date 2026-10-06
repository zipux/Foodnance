// A supplier's new pack size must reach the review screen, flagged, instead of
// being replaced by the pack remembered from the last invoice (found 2026-10-06:
// spaghetti printed as 10 kg arrived as 5 kg — half the stock, double the price).
import { readFileSync } from 'node:fs';
import { suite } from './helpers/assert.mjs';

const t = suite('pack-size-change');
const up  = readFileSync(new URL('../public/static/invoice.js', import.meta.url), 'utf8');
const rev = readFileSync(new URL('../public/static/invoices.js', import.meta.url), 'utf8');

const src = up.match(/function packSizeDiffers\(a, b\) \{[\s\S]*?\n\}/);
t.check('packSizeDiffers exists on the upload page', !!src);
const differs = new Function(`${src ? src[0] : 'function packSizeDiffers(){}'}; return packSizeDiffers;`)();
t.check('5 kg vs 10 kg is a change', differs('5 kg', '10 kg') === true);
t.check('spacing and case are not a change', differs('5 kg', '5KG') === false && differs('24 each', '24  Each') === false);
t.check('5.0 kg and 5 kg are the same pack', differs('5.0 kg', '5 kg') === false);
t.check('nothing remembered: no flag', differs('', '10 kg') === false);
t.check('nothing read from the page: no flag (the remembered pack fills the gap)', differs('5 kg', '') === false);

t.check('the remembered pack no longer overwrites the printed one',
  !/row\.pack_size\s*=\s*match\.corrected_pack_size\s*\|\|\s*row\.pack_size;/.test(up)
  && /if \(packSizeDiffers\(remembered, row\.pack_size\)\) row\._pack_was = remembered;/.test(up));
t.check('the old pack is saved with the line', /pack_was: r\._pack_was/.test(up));
t.check('the review screen loads it', /_pack_was: it\.pack_was/.test(rev));
t.check('and keeps it through Save Changes / Release', /pack_was: l\._pack_was/.test(rev));
t.check('the line offers both answers', /keepPrintedPack\(\$\{i\}\)/.test(rev) && /useRememberedPack\(\$\{i\}\)/.test(rev));
t.check('the flag says both pack sizes', /Pack size changed\?<\/strong> Last time/.test(rev));
t.done();
