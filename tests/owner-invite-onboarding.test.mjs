// Static audit: onboarding a customer by emailed invite (2026-09-21).
//
// The point of the feature is that the operator never knows or transmits the
// owner's password. These checks pin the pieces that keep that true, and the two
// that quietly matter most: the invite link is returned to the operator ONLY when
// the email failed, and an emailed link only works for the address it was sent to.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const ROOT  = join(dirname(fileURLToPath(import.meta.url)), '..');
const src   = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8');
const admin = readFileSync(join(ROOT, 'public', 'admin.html'), 'utf8');
const accept = readFileSync(join(ROOT, 'public', 'accept-invite.html'), 'utf8');
const wrangler = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8');

const t = suite('owner-invite-onboarding');

const routeStarts = [...src.matchAll(/^app\.(get|post|put|patch|delete)\(\s*'([^']+)'/gm)];
function handlerBody(method, path) {
  const idx = routeStarts.findIndex(m => m[1] === method && m[2] === path);
  if (idx === -1) return null;
  const end = idx + 1 < routeStarts.length ? routeStarts[idx + 1].index : src.length;
  return src.slice(routeStarts[idx].index, end);
}

t.section('creating a restaurant without a password sends an invite');
const create = handlerBody('post', '/api/admin/organizations');
t.check('route exists', !!create);
t.check('super-admin only', !!create && /requireSuperAdmin\(c\)/.test(create));
t.check('a missing owner_password means "invite", not an error',
  !!create && /const inviting = password === ''/.test(create));
t.check('the invite row and the organization are written in the same batch',
  !!create && /INSERT INTO invites/.test(create) && /INSERT INTO organizations/.test(create)
  && /DB\.batch\(/.test(create));
t.check('no users row is created for an invited owner (created on acceptance)',
  !!create && /if \(inviting\)[\s\S]*?INSERT INTO invites[\s\S]*?else[\s\S]*?INSERT INTO users/.test(create));
t.check('the invite expires (never a link that works forever)',
  !!create && /expires_at\)[\s\S]*?datetime\('now', '\+\$\{INVITE_DAYS\} days'\)/.test(create));
t.check('the link is returned ONLY when the email did not go out',
  !!create && /sent\.ok \? \{\} : \{[^}]*invite_url/.test(create));

t.section('resend-invite');
const resend = handlerBody('post', '/api/admin/organizations/:id/resend-invite');
t.check('route exists', !!resend);
t.check('super-admin only', !!resend && /requireSuperAdmin\(c\)/.test(resend));
t.check('refused once the restaurant has an active login',
  !!resend && /COUNT\(\*\)/.test(resend) && /archived_at IS NULL/.test(resend) && /409/.test(resend));
t.check('revokes older unaccepted links before issuing the new one',
  !!resend && /DELETE FROM invites WHERE org_id = \? AND accepted_at IS NULL/.test(resend));
t.check('link is returned ONLY when the email did not go out',
  !!resend && /sent\.ok \? \{\} : \{[^}]*invite_url/.test(resend));

t.section('the emailed link only works for the address it was sent to');
const accepting = handlerBody('post', '/api/auth/accept-invite');
t.check('accept-invite reads the invite email',
  !!accepting && /SELECT id, org_id, email FROM invites/.test(accepting));
t.check('accept-invite rejects a different address',
  !!accepting && /invite\.email && email !== normalizeEmail\(invite\.email\)/.test(accepting));
t.check('accept page locks the prefilled email', /em\.readOnly = true/.test(accept));

t.section('sending mail can never lose or block an account');
const sendFn = src.match(/async function sendEmail\([\s\S]*?\n}\n/);
t.check('sendEmail exists and calls Resend', !!sendFn && /api\.resend\.com\/emails/.test(sendFn[0]));
t.check('sendEmail catches network failure instead of throwing', !!sendFn && /catch \(_\)/.test(sendFn[0]));
t.check('sendEmail has a timeout', !!sendFn && /AbortSignal\.timeout/.test(sendFn[0]));
t.check('a missing RESEND_API_KEY is a soft failure, not a crash',
  !!sendFn && /if \(!env\.RESEND_API_KEY\) return \{ ok: false/.test(sendFn[0]));
t.check('the email is sent AFTER the database batch, not inside it',
  !!create && create.indexOf('DB.batch(') < create.indexOf('sendOwnerInviteEmail('));
t.check('the API key is a secret binding, never a literal', !/re_[A-Za-z0-9]{20,}/.test(src));

t.section('links are built on the real domain');
t.check('inviteUrl prefers PUBLIC_URL', /c\.env\.PUBLIC_URL \|\| new URL\(c\.req\.url\)\.origin/.test(src));
t.check('production sets PUBLIC_URL to foodnance.com', /"PUBLIC_URL": "https:\/\/foodnance\.com"/.test(wrangler));
const previewBlock = wrangler.slice(wrangler.indexOf('"preview"'));
t.check('staging does NOT set PUBLIC_URL (its links stay on staging)', !/PUBLIC_URL/.test(previewBlock));

t.section('admin screen');
t.check('the password field is gone from the Add form', !/id="ownerPassword"/.test(admin));
t.check('the form no longer posts a password', !/owner_password/.test(admin));
t.check('the invite link panel is only filled from a failed send',
  /if \(data\.email_sent\)[\s\S]*?return;[\s\S]*?handoffUrl/.test(admin));
t.check('a pending owner gets a Resend button', /data-act="resend"/.test(admin));
t.check('View is offered for every row, including ones with no login yet',
  /data-act="view"[\s\S]{0,200}?<i class="fas fa-eye">/.test(admin));

t.done();
