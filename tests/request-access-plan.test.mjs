// Static audit: the "Request access" form records which plan the visitor wants
// (2026-09-29, migration 0057).
//
// The pricing page's two plan cards tag their buttons with data-plan, the modal
// opens with its Plan dropdown pre-set from that tag, and POST /api/interest
// stores only 'essential' | 'pro' | '' — never whatever text was posted.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src     = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8');
const js      = readFileSync(join(ROOT, 'public', 'static', 'request-access.js'), 'utf8');
const pricing = readFileSync(join(ROOT, 'public', 'pricing.html'), 'utf8');
const mig     = readFileSync(join(ROOT, 'migrations', '0057_access_request_plan.sql'), 'utf8');

const t = suite('request-access-plan');

t.section('pricing page plan cards');
const tagged = [...pricing.matchAll(/<a [^>]*js-request-access[^>]*data-plan="([a-z]+)"/g)].map(m => m[1]);
t.check('exactly one Essentials and one Pro button are tagged',
  tagged.length === 2 && tagged.includes('essential') && tagged.includes('pro'), JSON.stringify(tagged));
t.check('the no-JS mailto fallback names the plan too',
  /data-plan="essential" href="mailto:[^"]*request%20access%20\(Essentials\)/.test(pricing)
  && /data-plan="pro" href="mailto:[^"]*request%20access%20\(Pro\)/.test(pricing));

t.section('the modal');
t.check('Plan dropdown offers Not sure yet / Essentials / Pro',
  /<select name="plan">/.test(js)
  && /<option value="">Not sure yet<\/option>/.test(js)
  && /<option value="essential">Essentials<\/option>/.test(js)
  && /<option value="pro">Pro<\/option>/.test(js));
t.check('the clicked button\'s data-plan pre-sets the dropdown',
  /openModal\(el\.getAttribute\('data-plan'\)\)/.test(js)
  && /planSelect\.value = \(plan === 'essential' \|\| plan === 'pro'\) \? plan : ''/.test(js));
t.check('the plan is sent with the request', /plan: get\('plan'\)/.test(js));

t.section('the server');
t.check('only essential / pro are accepted, anything else becomes empty',
  /ACCESS_REQUEST_PLAN_LABELS: Record<string, string> = \{ essential: 'Essentials', pro: 'Pro' \}/.test(src)
  && /const plan = planRaw in ACCESS_REQUEST_PLAN_LABELS \? planRaw : ''/.test(src));
t.check('the notification email carries the plan (body and subject)',
  /`Plan: \$\{planLabel\}`/.test(src) && /subject: `Access request \(\$\{planLabel\}\)/.test(src));
t.check('a missing plan column still saves the lead',
  /const optional: Record<string, string> = \{ message, plan \}/.test(src)
  && /no column named \$\{k\}/.test(src));
t.check('0057 adds access_requests.plan', /ALTER TABLE access_requests ADD COLUMN plan TEXT;/.test(mig));

t.done();
