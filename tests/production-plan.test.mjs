// Static audit: "Production" must stay a LABEL, never a third entitlement.
//
// A commissary is sold one tier called Production. It is the Pro feature set —
// what makes it a different product is account_type, which is what shows
// Produce Batch, Pack Run and the "How is this made?" dropdown.
//
// The temptation is to add 'production' to organizations.plan. That breaks two
// things in opposite ways, and only one of them is visible:
//   - planFeatures() tests `=== 'pro'`, so an unrecognised plan gets an EMPTY
//     feature set. Loud: the account loses every Pro page at once.
//   - PLAN_INVOICE_CAPS[plan] ?? 0 resolves an unrecognised plan to 0, which
//     means UNCAPPED. Silent, and every parse past 150 is money out.
//
// So this pins the shape rather than the behaviour: two plan values, the label
// derived from account_type, and the invariant that keeps the label honest —
// a commissary is always on 'pro', at creation and on the plan endpoint.
//
// This is a source audit, not an end-to-end test. It cannot prove the routes
// behave; it proves nobody quietly removed the guard. The behavioural check is
// `npm run test:lifecycle` against the sandbox.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src   = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8');
const admin = readFileSync(join(ROOT, 'public', 'admin.html'), 'utf8');

const t = suite('production-plan');

t.section('the entitlement stays binary');
const plansLine = src.match(/const PLANS = \[([^\]]*)\]/);
t.check('PLANS is declared', !!plansLine);
const planValues = (plansLine?.[1] || '').match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) || [];
t.check('exactly two plan values: essential, pro',
  planValues.length === 2 && planValues.includes('essential') && planValues.includes('pro'),
  `found: ${planValues.join(', ')}`);
// The specific mistake this guards: a 'production' value in the entitlement.
// Scoped to the two declarations themselves — the word appears freely in prose
// and in planLabel's return, which is exactly where it belongs.
const capsBody = src.match(/const PLAN_INVOICE_CAPS[^=]*=\s*\{([^}]*)\}/)?.[1] || '';
t.check('PLAN_INVOICE_CAPS is declared', capsBody.length > 0);
t.check("no 'production' key in the entitlement or its caps table",
  !/production/i.test(plansLine?.[1] || '') && !/production/i.test(capsBody),
  `caps: ${capsBody.replace(/\s+/g, ' ').trim()}`);

t.section('the label is derived, and defined once');
t.check('planLabel() exists', /function planLabel\s*\(/.test(src));
t.check('commissary maps to Production',
  /commissary'\s*\)\s*return 'Production'/.test(src.replace(/\s+/g, ' ')));
t.check('the admin list sends plan_label to the browser',
  /plan_label:\s*planLabel\(/.test(src));
// admin.html must not grow its own copy of the mapping — one definition only.
t.check('admin.html reads plan_label rather than deriving it',
  admin.includes('o.plan_label') && !/['"]Production['"]\s*:/.test(admin),
  'admin.html appears to compute the label itself');

t.section('a commissary is always on the Pro entitlement');
t.check('created on pro',
  /accountType === 'commissary' \? 'pro' : 'essential'/.test(src));
t.check('the org INSERT actually writes the plan column',
  /INSERT INTO organizations \(id, name, account_type, plan\)/.test(src));
t.check('the plan endpoint refuses to move a commissary off pro',
  /account_type === 'commissary' && plan !== 'pro'/.test(src));
// It can only refuse if it looked the account type up in the first place.
t.check('the plan endpoint selects account_type',
  /SELECT id, name, account_type FROM organizations WHERE id = \?/.test(src));

t.section('the admin screen offers no choice it cannot honour');
// Ordering, not presence: the commissary branch must return BEFORE the
// two-option <select> is reached, or the row would offer Essential — a move
// the server refuses, so the picker would snap back and blame the network.
const picker = admin.match(/function planPicker\(o\) \{([\s\S]*?)\n    \}/)?.[1] || '';
t.check('planPicker() is found', picker.length > 0);
const pillAt   = picker.indexOf('pill');
const selectAt = picker.indexOf('planpick');
t.check('commissary returns a fixed pill', pillAt !== -1 && /commissary/.test(picker));
t.check('and it returns before the Essential/Pro select',
  pillAt !== -1 && selectAt !== -1 && pillAt < selectAt,
  `pill@${pillAt} select@${selectAt}`);

t.done();
