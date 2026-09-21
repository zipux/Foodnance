// Static audit: self-serve password reset (2026-09-21).
//
// Two ways in — the "Forgot password?" panel, and an automatic email on the
// fifth consecutive wrong password. Both are reachable by anyone on the
// internet, so what these pin is the property that stops the feature being
// turned on its victims: identical answers for every address, a hard cap on how
// many emails one account can be sent, and a token that is single-use,
// short-lived and never stored or returned in the clear.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './helpers/assert.mjs';

const ROOT  = join(dirname(fileURLToPath(import.meta.url)), '..');
const src   = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8');
const login = readFileSync(join(ROOT, 'public', 'login.html'), 'utf8');
const reset = readFileSync(join(ROOT, 'public', 'reset-password.html'), 'utf8');
const robots = readFileSync(join(ROOT, 'public', 'robots.txt'), 'utf8');
const mig   = readFileSync(join(ROOT, 'migrations', '0051_password_reset.sql'), 'utf8');

const t = suite('password-reset');

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
  const next = src.slice(start + 1).search(/\n(?:async function|function|app\.)/);
  return src.slice(start, next === -1 ? src.length : start + 1 + next);
}

t.section('the three endpoints are public, and nothing else was opened up');
const publicBlock = src.match(/const PUBLIC_API = new Set\(\[([\s\S]*?)\]\)/)?.[1] || '';
const publicPaths = publicBlock.split('\n').map(l => l.match(/^\s*'([^']+)'/)).filter(Boolean).map(m => m[1]);
for (const p of ['/api/auth/forgot-password', '/api/auth/reset-lookup', '/api/auth/reset-password'])
  t.check(`${p} is public`, publicPaths.includes(p));
t.check('no team/admin route was made public by accident',
  !publicPaths.some(p => p.startsWith('/api/team') || p.startsWith('/api/admin')));

t.section('forgot-password never says whether the address has an account');
const forgot = handlerBody('post', '/api/auth/forgot-password');
t.check('route exists', !!forgot);
t.check('an unknown address gets the same {ok:true} as a known one',
  !!forgot && /if \(user\) \{[\s\S]*?\}\s*return c\.json\(\{ ok: true \}\)/.test(forgot));
t.check('the only error is about the SHAPE of the input',
  !!forgot && (forgot.match(/c\.json\(\{ error/g) || []).length === 1 && /includes\('@'\)/.test(forgot));
t.check('a closed account or archived user gets no link',
  !!forgot && /u\.archived_at IS NULL AND o\.archived_at IS NULL/.test(forgot));
// handlerBody runs to the next app.* route, which here swallows a helper
// function — cut at it so only the handler itself is inspected.
const forgotHandler = forgot?.split('// Shared by lookup')[0] ?? '';
t.check('the link is never put in the response',
  !!forgot && !/\burl\b|token/.test(forgotHandler.replace(/issuePasswordReset/g, '')));

t.section('emails are rate-limited so this cannot be used to flood someone');
const issue = fnBody('issuePasswordReset');
t.check('issuePasswordReset exists', !!issue);
t.check('counts the account\'s links from the last hour',
  !!issue && /FROM password_resets[\s\S]*?created_at > datetime\('now', '-1 hour'\)/.test(issue));
t.check('an automatic lockout mail needs an empty hour (cap 1)',
  !!issue && /reason === 'lockout' \? 1 : RESET_MAX_PER_HOUR/.test(issue));
t.check('links are capped at 3 an hour in total', /const RESET_MAX_PER_HOUR = 3\b/.test(src));
t.check('the email goes out AFTER the response (no timing tell for known addresses)',
  !!issue && /executionCtx\.waitUntil\(delivery\)/.test(issue));
t.check('an older unused link is spent when a new one is issued',
  !!issue && /UPDATE password_resets SET used_at = datetime\('now'\) WHERE user_id = \? AND used_at IS NULL/.test(issue));
t.check('rows are never deleted — they are the rate-limit ledger',
  !/DELETE FROM password_resets/.test(src));

t.section('the token');
t.check('only the SHA-256 is stored, never the raw token',
  !!issue && /const tokenHash = await sha256Hex\(token\)/.test(issue)
  && /INSERT INTO password_resets \(id, user_id, token_hash/.test(issue)
  && !/INSERT INTO password_resets[^)]*\btoken\b[^_]/.test(issue));
t.check('the token is 256 bits of randomness', !!issue && /randomHex\(32\)/.test(issue));
t.check('the link expires', !!issue && /expires_at\)[\s\S]*?datetime\('now', '\+\$\{RESET_MINUTES\} minutes'\)/.test(issue));
t.check('the expiry is short (an hour at most)', /const RESET_MINUTES = (\d+)/.test(src) && Number(src.match(/const RESET_MINUTES = (\d+)/)[1]) <= 60);
t.check('the migration has a unique index on token_hash', /CREATE UNIQUE INDEX[^;]*password_resets\(token_hash\)/.test(mig));
t.check('password_resets is NOT reachable through the generic table API',
  !/ALLOWED_TABLES = \[[\s\S]*?password_resets[\s\S]*?\]/.test(src));

t.section('reset-password');
const doReset = handlerBody('post', '/api/auth/reset-password');
const usable = fnBody('findUsableReset');
t.check('route exists', !!doReset);
t.check('lookup requires unused + unexpired + live account',
  !!usable && /used_at IS NULL/.test(usable) && /expires_at > datetime\('now'\)/.test(usable)
  && /u\.archived_at IS NULL/.test(usable) && /o\.archived_at IS NULL/.test(usable));
t.check('the presented token is hashed before lookup', !!usable && /sha256Hex\(token\)/.test(usable));
t.check('re-validates the token itself (does not trust the lookup call)', !!doReset && /findUsableReset\(c,/.test(doReset));
t.check('enforces the minimum password length', !!doReset && /MIN_PASSWORD_LEN/.test(doReset));
t.check('the new password and the spent link are written in one batch',
  !!doReset && /DB\.batch\(/.test(doReset) && /UPDATE users SET password_hash/.test(doReset)
  && /UPDATE password_resets SET used_at/.test(doReset));
t.check('every sibling link is spent, not just this one',
  !!doReset && /WHERE user_id = \? AND used_at IS NULL/.test(doReset));
t.check('the failed-login streak is cleared', !!doReset && /failed_logins = 0/.test(doReset));

t.section('five wrong passwords in a row');
t.check('the threshold is five', /const LOCKOUT_AFTER_FAILURES = 5\b/.test(src));
const loginBody = handlerBody('post', '/api/auth/login');
t.check('a wrong password is counted', !!loginBody && /if \(!ok\) \{\s*await noteFailedLogin\(c, row\)/.test(loginBody));
t.check('the wrong-password answer is word-for-word the unknown-address answer',
  !!loginBody && (loginBody.match(/'Email or password is incorrect\.'/g) || []).length === 2);
t.check('a successful login resets the streak ("in a row")',
  !!loginBody && /last_login_at = datetime\('now'\), failed_logins = 0/.test(loginBody));
const note = fnBody('noteFailedLogin');
t.check('the counter bump is a single atomic UPDATE … RETURNING',
  !!note && /failed_logins = failed_logins \+ 1 WHERE id = \? RETURNING failed_logins/.test(note));
t.check('it triggers on reaching the threshold', !!note && /r\.failed_logins < LOCKOUT_AFTER_FAILURES\) return/.test(note));
t.check('it starts a fresh streak after triggering', !!note && /SET failed_logins = 0/.test(note));
t.check('it is fail-soft: an error here can never turn a wrong password into a 500',
  !!note && /try \{[\s\S]*?\} catch \(e\)/.test(note));
t.check('nothing locks the account — a wrong password is refused, the right one still works',
  !/locked_until|account_locked/.test(src));

t.section('the email');
const mail = fnBody('sendPasswordResetEmail');
t.check('exists and uses the shared sender', !!mail && /return sendEmail\(env/.test(mail));
t.check('the automatic variant says why it was sent', !!mail && /wrong password was entered several times/.test(mail));
t.check('says it expires and that the old password still works',
  !!mail && /expires in \$\{RESET_MINUTES\} minutes/.test(mail) && /current password keeps working/.test(mail));
t.check('a send failure is logged (the reason used to vanish)', /console\.error\('sendEmail: provider refused'/.test(src));

t.section('pages');
t.check('login has a working Forgot password control, not a mailto',
  /id="forgotLink"/.test(login) && !/mailto:[^"]*password%20help">Forgot password\?/.test(login));
t.check('login posts to the forgot-password endpoint', /\/api\/auth\/forgot-password/.test(login));
t.check('login hints after five failures without claiming an account exists',
  /LOCKOUT_AFTER = 5/.test(login) && /If this address has an account/.test(login));
t.check('reset page checks the link on load, then posts the token + password',
  /\/api\/auth\/reset-lookup/.test(reset) && /\/api\/auth\/reset-password/.test(reset));
t.check('reset page is noindex and disallowed in robots.txt',
  /name="robots" content="noindex"/.test(reset) && /Disallow: \/reset-password\b/.test(robots));
t.check('an expired link offers a way to get a new one', /login\.html#forgot/.test(reset) && /#forgot/.test(login));

t.done();
