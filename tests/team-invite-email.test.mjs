// Static audit: emailing a teammate invitation from Settings → Team (2026-09-22).
//
// Sending mail from foodnance.com to an address a customer typed turns the app
// into something that emails strangers. Three things keep that from becoming a
// weapon, and each fails the build if it regresses:
//   1. It is rate limited — per organization AND per recipient address — through
//      a ledger that revoking an invite cannot reset.
//   2. The email body is fixed text; customer-typed names are cleaned and capped.
//   3. A refusal never blocks onboarding: the invite is created regardless.
// tests/integration/team-invite-email.test.mjs proves the limits against a real database.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src  = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8');
const js   = readFileSync(join(ROOT, 'public', 'static', 'settings.js'), 'utf8');
const html = readFileSync(join(ROOT, 'public', 'settings.html'), 'utf8');
const mig  = readFileSync(join(ROOT, 'migrations', '0052_invite_emails.sql'), 'utf8');

const t = suite('team-invite-email');

const routeStarts = [...src.matchAll(/^app\.(get|post|put|patch|delete)\(\s*'([^']+)'/gm)];
function handlerBody(method, path) {
  const idx = routeStarts.findIndex(m => m[1] === method && m[2] === path);
  if (idx === -1) return null;
  const end = idx + 1 < routeStarts.length ? routeStarts[idx + 1].index : src.length;
  return src.slice(routeStarts[idx].index, end);
}
function fnBody(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) return null;
  const next = src.slice(start + 1).search(/\n(?:async function|function|const|app\.)\s/);
  return src.slice(start, next === -1 ? undefined : start + 1 + next);
}

t.section('the ledger cannot be reset by revoking an invite');
t.check('the ledger table is created by a migration', /CREATE TABLE IF NOT EXISTS invite_emails/.test(mig));
t.check('it has no foreign key to invites (revoke hard-deletes them)', !/REFERENCES\s+invites/i.test(mig));
t.check('the revoke route does not touch the ledger',
  !/invite_emails/.test(handlerBody('post', '/api/team/invites/:id/revoke') || ''));
t.check('nothing else in the app ever deletes ledger rows except the account purge',
  [...src.matchAll(/DELETE FROM invite_emails[^\n]*/g)].length === 1 &&
  /DELETE FROM invite_emails WHERE org_id = \?/.test(handlerBody('delete', '/api/admin/organizations/:id') || ''));
t.check('it is not exposed through the generic table routes',
  !/ALLOWED_TABLES = \[[\s\S]*?'invite_emails'[\s\S]*?\]/.test(src));

t.section('two caps, reserved atomically, failing closed');
const emailer = fnBody('emailTeamInvite') || '';
t.check('emailTeamInvite exists', !!emailer);
t.check('caps are named constants', /INVITE_EMAILS_PER_ORG_PER_HOUR\s*=\s*\d+/.test(src) && /INVITE_EMAILS_PER_ADDRESS_PER_DAY\s*=\s*\d+/.test(src));
t.check('counts per organization over the last hour', /org_id = \?[\s\S]*?'-1 hour'/.test(emailer));
t.check('counts per recipient address over the last day, across every organization',
  /to_email = \?[\s\S]*?'-1 day'/.test(emailer) && !/to_email = \?\s+AND org_id/.test(emailer));
t.check('the slot is reserved in ONE statement (INSERT ... SELECT ... WHERE counts < limits)',
  /INSERT INTO invite_emails[\s\S]*?SELECT[\s\S]*?WHERE \(SELECT COUNT\(\*\)[\s\S]*?AND \(SELECT COUNT\(\*\)/.test(emailer));
t.check('the slot is taken BEFORE the send, so a failed send still counts',
  emailer.indexOf('INSERT INTO invite_emails') < emailer.indexOf('sendTeamInviteEmail('));
t.check('an unreadable ledger sends nothing (fail closed)',
  /catch \(e\)[\s\S]*?ok: false/.test(emailer));

t.section('the email itself');
const mail = fnBody('sendTeamInviteEmail') || '';
t.check('sendTeamInviteEmail exists', !!mail);
t.check('typed names go through cleanLabel (control characters out, length capped)',
  /cleanLabel\(inviteeName, \d+\)/.test(mail) && /cleanLabel\(inviter\.name, \d+\)/.test(mail) && /cleanLabel\(orgName, \d+\)/.test(mail));
t.check('every interpolated value in the HTML is escaped',
  !/\$\{(?!escHtml|INVITE_DAYS)[^}]*\}[^\n]*<\/(p|strong)>/.test(mail.slice(mail.indexOf('const html'))));
t.check("the inviter's verified address is shown beside the typed name", /inviter\.email/.test(mail));
t.check('there is no free-form message field anywhere in the invite routes',
  !/body\.(message|note|text)/.test((handlerBody('post', '/api/team/invite') || '') + (handlerBody('post', '/api/team/invites/:id/resend') || '')));

t.section('a refusal never blocks the invite');
const create = handlerBody('post', '/api/team/invite') || '';
t.check('the invite row is inserted before any email is attempted',
  create.indexOf('INSERT INTO invites') !== -1 && create.indexOf('INSERT INTO invites') < create.indexOf('emailTeamInvite('));
t.check('every invite is emailed — there is no link-only path and no send_email switch',
  /emailTeamInvite\(/.test(create) && !/send_email/.test(create) && !/send_email/.test(js) && !/send_email/.test(html));
t.check('the response reports emailed + email_error so the page can fall back to the link',
  /emailed/.test(create) && /email_error/.test(create));

t.section('duplicate invites are refused, inside this organization only');
const dupUsers = create.match(/FROM users WHERE[^`]*`/)?.[0] || '';
const dupInvites = create.match(/FROM invites WHERE org_id = \?[^`]*`/)?.[0] || '';
t.check('checks whether the address is already on this team', /org_id = \?/.test(dupUsers) && /lower\(email\) = \?/.test(dupUsers), dupUsers);
t.check('checks whether it already has a pending invite (expired ones too, they can be resent)',
  /org_id = \?/.test(dupInvites) && /accepted_at IS NULL/.test(dupInvites) && !/expires_at/.test(dupInvites), dupInvites);
t.check('both checks run BEFORE the invite is inserted and before any email allowance is spent',
  create.indexOf('FROM users WHERE') !== -1 &&
  create.indexOf('FROM users WHERE') < create.indexOf('INSERT INTO invites') &&
  create.indexOf('FROM invites WHERE org_id') < create.indexOf('INSERT INTO invites') &&
  create.indexOf('FROM invites WHERE org_id') < create.indexOf('emailTeamInvite('));
t.check('NEVER asks whether the address has an account anywhere (that would leak who is another customer\'s user)',
  [...create.matchAll(/FROM users WHERE[^`]*`/g)].every(m => /org_id = \?/.test(m[0])));
t.check('a duplicate is a 409 with a plain-English reason', (create.match(/, 409\)/g) || []).length === 2 &&
  /is already on your team/.test(create) && /already has a pending invite/.test(create) && /was deactivated on your team/.test(create));

t.section('resend');
const resend = handlerBody('post', '/api/team/invites/:id/resend') || '';
t.check('POST /api/team/invites/:id/resend exists', !!resend);
t.check('is org-scoped by hand', /orgOf\(c\)/.test(resend) && /org_id = \?/.test(resend));
t.check('only for a pending invite (accepted_at IS NULL)', /accepted_at IS NULL/.test(resend));
t.check('goes through the same caps', /emailTeamInvite\(/.test(resend));
t.check('restarts the 7 days only when the email actually went out',
  /if \(sent\.ok\)[\s\S]*?UPDATE invites SET expires_at/.test(resend));
t.check('no /api/team* route was made public',
  !/'\/api\/team/.test((src.match(/const PUBLIC_API = new Set\(\[([\s\S]*?)\]\)/) || [, ''])[1]));

t.section('the page');
t.check('the modal has no "send by email" checkbox and no link-only button',
  !/inviteSendEmail/.test(html) && !/inviteSendEmail/.test(js) && !/Create invite link|Generate invite link/.test(html + js));
t.check('the one button sends the invite', /id="generateInviteBtn"[^>]*>[\s\S]*?Send invite/.test(html));
t.check('it no longer says nothing is emailed automatically', !/nothing gets emailed automatically/.test(html));
t.check('the link box starts hidden and is only revealed when the email fails',
  /id="inviteResult"/.test(html) && /class="copybox hidden" id="inviteResult"/.test(html) &&
  /else \{[\s\S]*?inviteResult'\)\.classList\.remove\('hidden'\)/.test(js));
t.check('the button is disabled while the request runs (a double-click must not send two)',
  /btn\.disabled = true/.test(js) && /finally\s*\{[\s\S]*?btn\.disabled = false/.test(js));
t.check('a failed email still shows the copy-link', /couldn't email it/.test(js));
t.check('expired invites are labelled', /isExpired\(/.test(js) && /Expired/.test(js));
t.check('the settings.js cache-buster was bumped past the old one', !/settings\.js\?v=20260810-1/.test(html));

t.section('Plan & usage (GET /api/account/plan)');
const planRoute = handlerBody('get', '/api/account/plan') || '';
t.check('the route exists', !!planRoute);
t.check('is org-scoped by hand', /orgOf\(c\)/.test(planRoute) && /WHERE id = \?/.test(planRoute));
t.check('uses the SAME cap and usage helpers the parse-cap check uses (so the card cannot disagree with the block)',
  /effectiveInvoiceCap\(/.test(planRoute) && /monthlyInvoiceParses\(/.test(planRoute));
t.check('the commissary label comes from planLabel, not re-derived', /planLabel\(/.test(planRoute));
t.check('is not made public and is not itself plan-gated',
  !/'\/api\/account/.test((src.match(/const PUBLIC_API = new Set\(\[([\s\S]*?)\]\)/) || [, ''])[1]) &&
  !/\/api\/account/.test((src.match(/const PRO_ONLY_TABLES[\s\S]*?\n\}/) || [''])[0]) &&
  featureCheck());
function featureCheck() {
  const fn = src.slice(src.indexOf('function featureForPath'), src.indexOf('function featureForPath') + 900);
  return !/account/.test(fn);
}
t.check('the card is on the page and loaded by the script',
  /id="planBody"/.test(html) && /apiGet\('account\/plan'\)/.test(js));
t.check('every Pro feature the server lists has a customer-facing label',
  [...(src.match(/const PRO_FEATURES = \[([^\]]*)\]/) || [, ''])[1].matchAll(/'([a-z_]+)'/g)]
    .every(m => new RegExp(`\\b${m[1]}:\\s*'`).test(js)));
t.check('a customer at their limit is offered a way to ask, not a dead end', /Ask to raise your limit/.test(js));
// Found on staging: one button said "Ask about Pro" but its email was titled "Raise my invoice limit".
t.check('each button says what its email will say (raise-limit button ↔ raise-limit subject, Pro button ↔ upgrade subject)',
  /mail\('Raise my invoice limit'\)[^>]*>\s*<i[^>]*><\/i>\s*Ask to raise your limit/.test(js) &&
  /mail\('Upgrade to Pro'\)[^>]*>\s*<i[^>]*><\/i>\s*Ask about Pro/.test(js));

t.section('housekeeping');
const migrations = readdirSync(join(ROOT, 'migrations')).filter(f => f.endsWith('.sql')).sort();
t.check('0052 is the newest migration, numbered without a gap', migrations.at(-1).startsWith('0052_') && migrations.at(-2).startsWith('0051_'));

t.done();
