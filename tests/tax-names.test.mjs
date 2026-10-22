// Tax names by province — taxNames() in public/static/utils.js (migration 0068).
//
// The amounts never depend on the province: GST/HST is always claimed back
// (tax_gst), PST/RST never is (tax_pst, a P&L cost). Only the names on screen
// change, and a province with no provincial sales tax still names one 'PST'
// (provOr) for the rare invoice that carries it anyway.
//
// Also checks the province lists agree: utils.js, src/index.ts (PROVINCES)
// and the admin screen's picker must offer the same codes.
import { suite } from './helpers/assert.mjs';
import { loadBrowserModule } from './helpers/browser-module.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const t = suite('tax-names');

const win = { addEventListener() {} };
const { taxNames } = loadBrowserModule(['utils.js'], ['taxNames'], { window: win });

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cases = {
  BC: { fed: 'GST', prov: 'PST', provOr: 'PST' },
  SK: { fed: 'GST', prov: 'PST', provOr: 'PST' },
  MB: { fed: 'GST', prov: 'RST', provOr: 'RST' },
  AB: { fed: 'GST', prov: null,  provOr: 'PST' },
  YT: { fed: 'GST', prov: null,  provOr: 'PST' },
  NT: { fed: 'GST', prov: null,  provOr: 'PST' },
  NU: { fed: 'GST', prov: null,  provOr: 'PST' },
  ON: { fed: 'HST', prov: null,  provOr: 'PST' },
  NS: { fed: 'HST', prov: null,  provOr: 'PST' },
  NB: { fed: 'HST', prov: null,  provOr: 'PST' },
  NL: { fed: 'HST', prov: null,  provOr: 'PST' },
  PE: { fed: 'HST', prov: null,  provOr: 'PST' },
};
for (const [p, want] of Object.entries(cases)) {
  t.check(`${p}: ${want.fed}${want.prov ? ' + ' + want.prov : ''}`, eq(taxNames(p), want));
}
t.check('lower case works', eq(taxNames('on'), cases.ON));
t.check('unknown province reads as BC', eq(taxNames('QC'), cases.BC));
win.__province = 'MB';
t.check('no argument: the business province from the session', eq(taxNames(), cases.MB));
win.__province = undefined;
t.check('nothing known yet: BC', eq(taxNames(), cases.BC));

// The three lists agree.
const utilsCodes = Object.keys(cases).sort();
const server = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8');
const sm = server.match(/const PROVINCES = \[([^\]]+)\]/);
const serverCodes = sm ? [...sm[1].matchAll(/'([A-Z]{2})'/g)].map(m => m[1]).sort() : [];
t.check('server PROVINCES = utils.js provinces', eq(serverCodes, utilsCodes));
const admin = readFileSync(join(ROOT, 'public', 'admin.html'), 'utf8');
const am = admin.match(/const PROVINCE_CODES = \[([^\]]+)\]/);
const adminList = am ? [...am[1].matchAll(/'([A-Z]{2})'/g)].map(m => m[1]).sort() : [];
t.check('admin list picker = utils.js provinces', eq(adminList, utilsCodes));
const formBlock = admin.slice(admin.indexOf('<select id="province">'), admin.indexOf('</select>', admin.indexOf('<select id="province">')));
const formCodes = [...formBlock.matchAll(/value="([A-Z]{2})"/g)].map(m => m[1]).sort();
t.check('admin "Add a restaurant" form = utils.js provinces', eq(formCodes, utilsCodes));
t.check('Quebec is not offered', !serverCodes.includes('QC') && !formCodes.includes('QC'));

t.done();
