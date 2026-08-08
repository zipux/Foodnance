import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  DB: D1Database
  FILES: R2Bucket
  ANTHROPIC_API_KEY: string     // secret set via wrangler / .dev.vars
  SESSION_SECRET: string        // secret — signs session cookies; see auth section
  // 'production' | 'staging' — a plain var, not a secret, set per environment in
  // wrangler.jsonc. Drives the staging banner and nothing else. It defaults to
  // 'production' everywhere it is missing, so a forgotten var can only ever hide
  // the banner on staging (harmless: you stay careful) and never show a
  // "safe to break" banner over live customer data.
  APP_ENV?: string
}

const app = new Hono<{ Bindings: Bindings; Variables: { user: SessionUser } }>()

app.use('*', cors())

// ══════════════════════════════════════════════════════════════
// API AUTH GATE — every /api/* route requires a session
// ══════════════════════════════════════════════════════════════
// Registered before any route so it runs first regardless of where handlers
// are declared further down. The body executes per request, so referencing
// helpers defined later in the file is fine.
//
// Fail-closed by design: if SESSION_SECRET is unset, currentUser() returns
// null and everything 401s. A misconfigured server serves nothing rather than
// serving everyone's data.
//
// Before this existed, `curl .../api/tables/invoices` returned every row to
// anyone on the internet. Do not add routes to PUBLIC_API without a reason
// that survives that sentence.
const PUBLIC_API = new Set([
  '/api/auth/login',      // can't require a session to create one
  '/api/auth/logout',     // clearing a cookie needn't be authenticated
  '/api/auth/me',         // its whole job is answering "am I signed in?" (401 when not)
  '/api/auth/bootstrap',  // first-run only; refuses once any user exists
  '/api/env',             // returns 'production'/'staging'; the URL already says as much
])

// Still allowed while an account is suspended: everything about the session
// itself. Locking someone out of Sign out or Change password would be spite,
// not leverage, and none of them touch business data.
const SUSPEND_EXEMPT = new Set([
  '/api/auth/logout',
  '/api/auth/me',
  '/api/auth/change-password',
])

app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (PUBLIC_API.has(path)) return next()

  const me = await currentUser(c)
  if (!me) return c.json({ error: 'Not signed in.' }, 401)

  // Account lifecycle. Checked here for the same reason auth is: one chokepoint
  // covers all 27 tables and every custom endpoint, and can't be forgotten when
  // a new route is added. Super-admins are exempt — they have no organization,
  // and while "viewing as" a customer they are staff looking in, not the
  // customer, so a suspension must not stop them investigating or exporting.
  if (me.role !== 'super_admin') {
    if (me.org_archived_at) {
      return c.json({ error: 'This account has been closed. Contact us if this is unexpected.' }, 403)
    }
    // Suspension is read-only, not a lockout: they must be able to see the
    // banner explaining why, and get their own data out. GET stays open; every
    // write is refused. 402 is the honest status code for "you owe us money".
    if (me.org_suspended_at && c.req.method !== 'GET' && !SUSPEND_EXEMPT.has(path)) {
      return c.json({
        error: 'Your account is paused because payment is overdue. Contact us to restore access.',
        suspended: true,
      }, 402)
    }

    // Plan gating, in the same chokepoint and for the same reason: one place
    // covers every route, including ones added later. Unlike suspension this
    // blocks GETs too — a Pro feature is not readable on Essential.
    //
    // NOTE this is a commercial boundary, not a security one. The data behind a
    // gated feature is the customer's own, and the static pages are served by
    // Pages without touching this worker (see public/_routes.json), so the
    // screens are hidden client-side rather than server-side. What the server
    // guarantees is that Pro *actions* cannot be performed on an Essential plan.
    const feature = featureForPath(path)
    if (feature && !planFeatures(me.org_plan).has(feature)) {
      return c.json({
        error: "That's part of the Pro plan. Get in touch and we'll switch you over.",
        upgrade_required: true,
        feature,
        plan: (me.org_plan || 'essential').toLowerCase(),
      }, 403)
    }
  }

  // Downstream handlers read the caller from here rather than re-querying.
  c.set('user', me)
  await next()
})

// ─── Helper: generate uid ─────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// Money rounding. Two handlers further down declare their own local round2 with
// the same behaviour and shadow this one; they predate it and are left alone.
function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100
}

// ══════════════════════════════════════════════════════════════
// AUTH — password hashing + signed session cookies
// ══════════════════════════════════════════════════════════════
// No library: PBKDF2-SHA256 and HMAC both come from Web Crypto, which is
// available in Workers. Passwords are never stored or logged in the clear.
//
// Iteration count is a deliberate compromise. OWASP wants far more for
// PBKDF2-SHA256, but Workers bill CPU time and login has to stay responsive,
// so 100k is the balance. It is stored PER USER (users.password_iter) so it
// can be raised later and old passwords re-hashed on next successful login
// rather than being invalidated.
const PBKDF2_ITERATIONS = 100_000
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14   // 14 days
const SESSION_COOKIE = 'dm_session'

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('')
}

// Constant-time string compare. A plain === leaks how many leading characters
// matched via timing, which is enough to forge a signature byte by byte.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function hashPassword(password: string, salt: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations, hash: 'SHA-256' },
    key, 256,
  )
  return toHex(bits)
}

async function verifyPassword(password: string, salt: string, expected: string, iterations: number): Promise<boolean> {
  const actual = await hashPassword(password, salt, iterations || PBKDF2_ITERATIONS)
  return timingSafeEqual(actual, expected)
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
}

// Session token = "<userId>.<expiryEpochSeconds>.<hmac>". Self-contained, so
// there is no session table to read on every request; revocation is by
// changing SESSION_SECRET (logs everyone out) or archiving the user.
async function signSession(secret: string, userId: string, expiresAt: number): Promise<string> {
  const payload = `${userId}.${expiresAt}`
  return `${payload}.${await hmac(secret, payload)}`
}

async function readSession(secret: string, token: string): Promise<{ userId: string } | null> {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [userId, expStr, sig] = parts
  const payload = `${userId}.${expStr}`
  if (!timingSafeEqual(sig, await hmac(secret, payload))) return null
  const exp = parseInt(expStr, 10)
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null
  return { userId }
}

function readCookie(header: string | undefined, name: string): string {
  if (!header) return ''
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return ''
}

function sessionCookieHeader(token: string, url: string, maxAge: number): string {
  // Secure must be omitted over plain http or the browser silently drops the
  // cookie — which breaks `npm run dev` on localhost while working in prod.
  const secure = new URL(url).protocol === 'https:' ? ' Secure;' : ''
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${maxAge}`
}

type SessionUser = {
  id: string; email: string; role: string; org_id: string | null;
  name: string; org_name: string | null; account_type: string | null;
  // Account lifecycle (migration 0037). Read on every request so suspending or
  // archiving takes effect immediately, exactly like users.archived_at.
  org_suspended_at: string | null; org_archived_at: string | null;
  org_suspend_reason: string | null;
  // Plan tier (migration 0039). Read per request for the same reason: an upgrade
  // takes effect on the customer's next click, with no re-login.
  org_plan: string | null;
}

// The columns that make up a SessionUser.
//
// Shared because TWO places load one: currentUser() below, and the login handler,
// which has to re-query after setting the cookie (the cookie is on the response,
// so the incoming request still has none). They drifted the first time a column
// was added — `o.plan` went into currentUser only, so logging in reported every
// Pro account as Essential — hence one list instead of two copies.
const SESSION_USER_COLUMNS = `
       u.id, u.email, u.role, u.org_id, u.name,
       o.name           AS org_name,
       o.account_type   AS account_type,
       o.suspended_at   AS org_suspended_at,
       o.archived_at    AS org_archived_at,
       o.suspend_reason AS org_suspend_reason,
       o.plan           AS org_plan`

// Resolves the caller from their cookie, or null when signed out. Reads the
// user fresh each time so archiving a user takes effect immediately.
async function currentUser(c: any): Promise<SessionUser | null> {
  const secret = c.env.SESSION_SECRET
  if (!secret) return null
  const token = readCookie(c.req.header('cookie'), SESSION_COOKIE)
  const session = await readSession(secret, token)
  if (!session) return null
  const row = await c.env.DB.prepare(
    `SELECT ${SESSION_USER_COLUMNS}
       FROM users u
       LEFT JOIN organizations o ON o.id = u.org_id
      WHERE u.id = ? AND u.archived_at IS NULL`,
  ).bind(session.userId).first()
  return (row as SessionUser) || null
}

// ─── Supplier name matching ────────────────────────────────────
// Dedupes near-identical vendor names (e.g. "Chefs' Warehouse" vs
// "Chefs Warehouse") so a punctuation/typo difference doesn't spawn a
// second supplier. Normalization strips case, punctuation and extra
// spaces; similarity uses Levenshtein on the normalized strings.
function normalizeSupplierName(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')  // punctuation → space
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let curr = new Array(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    [prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

// Score two supplier names in [0,1]; 1 = identical after normalization.
function supplierSimilarity(a: string, b: string): number {
  const na = normalizeSupplierName(a)
  const nb = normalizeSupplierName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const dist = levenshtein(na, nb)
  return 1 - dist / Math.max(na.length, nb.length)
}

// All significant (len ≥ 3) tokens of the shorter name appear in the longer,
// and the shorter has ≥ 2 such tokens. Catches "Oyster and King" ⊂
// "1088115 B.C. LTD. - Oyster and King" without matching a lone token like "BCL".
function supplierTokenContained(a: string, b: string): boolean {
  const ta = normalizeSupplierName(a).split(' ').filter(t => t.length >= 3)
  const tb = normalizeSupplierName(b).split(' ').filter(t => t.length >= 3)
  if (!ta.length || !tb.length) return false
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  if (short.length < 2) return false
  const longSet = new Set(long)
  return short.every(t => longSet.has(t))
}

type SupplierMatch = {
  decision: 'auto' | 'suggest' | 'none'
  match: { id: string; name: string } | null
  score: number
}

// Classify a candidate name against a list of existing ones:
//   auto    → near-identical, safe to snap silently (≥ 0.88 or normalized-equal)
//   suggest → plausible but confirm first (≥ 0.70, or token-contained)
//   none    → treat as new
//
// Written for supplier names, and also used to match POS menu items against
// recipes and finished products. The thresholds were tuned on supplier names,
// which are long and distinctive; menu names are short and clustered ("Coke" vs
// "Coke Zero", "Small Pizza" vs "Sml Pizza"), so a short name is never snapped
// silently — see AUTO_MIN_LEN below.
function classifyNameMatch(
  name: string,
  suppliers: { id: string; name: string }[],
  autoMinLen = 0
): SupplierMatch {
  let best: { id: string; name: string } | null = null
  let bestScore = 0
  let bestContained = false
  for (const s of suppliers) {
    const score = supplierSimilarity(name, s.name)
    const contained = supplierTokenContained(name, s.name)
    if (score > bestScore || (score === bestScore && contained && !bestContained)) {
      best = { id: s.id, name: s.name }
      bestScore = score
      bestContained = contained
    }
  }
  if (!best) return { decision: 'none', match: null, score: 0 }
  // autoMinLen defaults to 0, so supplier matching behaves exactly as it always
  // has. POS item matching passes 8: a four-letter menu name can clear 0.88
  // against a different four-letter name on a single character, and snapping
  // silently there would deduct the wrong recipe's ingredients without ever
  // saying so — worse than one extra click.
  const shortest = Math.min(normalizeSupplierName(name).length, normalizeSupplierName(best.name).length)
  if (bestScore >= 0.88 && shortest >= autoMinLen) return { decision: 'auto', match: best, score: bestScore }
  if (bestScore >= 0.70 || bestContained) return { decision: 'suggest', match: best, score: bestScore }
  return { decision: 'none', match: null, score: bestScore }
}

// ─── Helper: parse pack_size strings into { packQty, packUnit } ─
// Handles complex formats from OCR/GPT:
//   "12 LB"       → { packQty: 12, packUnit: "LB" }
//   "500g"        → { packQty: 500, packUnit: "g" }
//   "1 × 1.89L"   → { packQty: 1.89, packUnit: "L" }   (1 × 1.89 = 1.89)
//   "6 x 100OZ"   → { packQty: 600, packUnit: "OZ" }   (6 × 100 = 600)
//   "1/5 KG CS"   → { packQty: 5, packUnit: "KG" }     (fraction: qty/size)
//   "5L"          → { packQty: 5, packUnit: "L" }
//   "35 LB"       → { packQty: 35, packUnit: "LB" }
// ─── Helper: canonical casing for a unit of measure ────────────
// Mostly cosmetic — every unit conversion elsewhere is already case-insensitive,
// so the casing rules change display, never math. Lowercases the unit, except
// litre which uses the SI symbol 'L' (a lowercase 'l' reads as a 1). Applied to
// parsed invoice units so imports stay consistent (e.g. "LB" → "lb", "KG" →
// "kg", "Each" → "each"). Custom multi-word units pass through lowercased.
//
// The one rule here that is NOT cosmetic is 'lt' → 'L'. 'lt' is a supplier
// spelling of litre, never a unit in its own right, and it is translated here
// rather than added to DEFAULT_UNITS on purpose: a stored 'lt' would be a
// SECOND volume unit that does not convert into 'L', so oil invoiced in 'lt'
// could not be costed into a recipe measured in 'L' and would come back
// uncostable. Keeping it out of the master list keeps it out of every picker,
// so a customer never sees the token at all.
//
// Reached only from parsePackSize() below, so this translation cannot touch a
// unit a user typed themselves.
function normalizeUnit(u: string): string {
  const t = (u || '').trim()
  if (!t) return t
  const lower = t.toLowerCase()
  if (lower === 'l' || lower === 'lt') return 'L'
  return lower
}

// ─── The unit master list every new organization starts with ───
// Seeded into `units` when an account is created (POST /api/admin/organizations).
// Order here is the picker's sort_order. Already normalizeUnit()-cased.
// 'oz' is weight; fluid ounces are the separate 'fl oz' unit — the two never
// convert into each other, which is why both are present.
// 'gal' is here because the invoice reader already emits it (parsePackSize
// matches it) and both converters have always known it — leaving it out of the
// picker meant a product could be created in a unit the picker could not show.
const DEFAULT_UNITS = ['kg', 'g', 'lb', 'ml', 'L', 'each', 'case', 'oz', 'fl oz', 'gal']

// ─── The category master list every new organization starts with ───
// Seeded into `categories` at account creation, alongside DEFAULT_UNITS.
// Array order is the picker's sort_order.
//
// This is a taxonomy SYNC POINT — keep aligned with DEFAULT_CATEGORIES +
// DEFAULT_CATEGORY_TYPES in public/static/utils.js, the .cat-<slug> CSS in
// public/static/style.css, and the inferCategory() keyword rules below. The
// last one matters most here: inferCategory assigns these names to products
// during invoice import, so any name it can emit must exist in this list or a
// customer ends up with a category the picker cannot show.
const DEFAULT_CATEGORIES: Array<{ name: string; type: string }> = [
  // Food (COGS)
  { name: 'Produce',                   type: 'food' },
  { name: 'Meat & Poultry',            type: 'food' },
  { name: 'Seafood',                   type: 'food' },
  { name: 'Dairy & Eggs',              type: 'food' },
  { name: 'Dry Goods & Pantry',        type: 'food' },
  { name: 'Bakery',                    type: 'food' },
  { name: 'Frozen',                    type: 'food' },
  { name: 'Oils, Sauces & Condiments', type: 'food' },
  { name: 'Spices & Seasonings',       type: 'food' },
  // Beverage
  { name: 'Alcohol',                   type: 'beverage' },
  { name: 'Non-Alcoholic Beverages',   type: 'beverage' },
  // Operating supplies
  { name: 'Packaging',                 type: 'supplies' },
  { name: 'Disposables',               type: 'supplies' },
  { name: 'Cleaning & Sanitation',     type: 'supplies' },
  { name: 'Linen & Uniforms',          type: 'supplies' },
  { name: 'Smallwares & Equipment',    type: 'supplies' },
  { name: 'Office & Admin',            type: 'supplies' },
  // Fallback used by inferCategory when nothing matches
  { name: 'Other',                     type: 'food' },
]

function parsePackSize(raw: string): { packQty: number; packUnit: string } {
  const s = (raw || '').trim()
  if (!s) return { packQty: 1, packUnit: normalizeUnit('each') }

  // Known measurable unit pattern (case-insensitive).
  // MUST stay identical to the copy in public/static/invoices.js — the review
  // screen and this write path have to agree on what a pack size means.
  // tests/pack-size-pins.test.mjs fails the suite if they drift apart.
  // 'lt' is here so a multiplied pack written "4x3 lt" multiplies out to 12
  // instead of collapsing to 4 with an unusable unit; normalizeUnit() then
  // turns it into 'L', so 'lt' is never stored or shown.
  const unitPat = '(?:kg|g|lb|lbs|l|lt|ml|oz|fl\\s*oz|gal)'

  // Pattern 1: "N × N UNIT" or "N x N UNIT" (e.g. "1 × 1.89L", "6 x 100OZ", "6x100 OZ")
  const multMatch = s.match(
    new RegExp(`^([\\d.]+)\\s*[×xX]\\s*([\\d.]+)\\s*(${unitPat})\\b`, 'i')
  )
  if (multMatch) {
    const a = parseFloat(multMatch[1]) || 1
    const b = parseFloat(multMatch[2]) || 1
    return { packQty: Math.round(a * b * 1000) / 1000, packUnit: normalizeUnit(multMatch[3]) }
  }

  // Pattern 2: "N/N UNIT" fraction notation (e.g. "1/5 KG CS" → 5 KG)
  // The second number is the actual pack size
  const fracMatch = s.match(
    new RegExp(`^([\\d.]+)\\s*/\\s*([\\d.]+)\\s*(${unitPat})\\b`, 'i')
  )
  if (fracMatch) {
    return { packQty: parseFloat(fracMatch[2]) || 1, packUnit: normalizeUnit(fracMatch[3]) }
  }

  // Pattern 3: simple "N UNIT" or "NUNIT" (e.g. "12 LB", "500g", "5L", "1.89 L")
  const simpleMatch = s.match(/^([\d.]+)\s*(.*)$/)
  if (simpleMatch) {
    const qty  = parseFloat(simpleMatch[1]) || 1
    const unit = normalizeUnit(simpleMatch[2] || 'each')
    return { packQty: qty, packUnit: unit }
  }

  // Fallback: no number found — treat entire string as unit
  return { packQty: 1, packUnit: normalizeUnit(s || 'each') }
}

// cost_per_unit: line_total ÷ (pack_qty × qty_ordered) gives price per standard unit.
//   4 bags × 12 LB/bag at $111.84 total → $111.84 ÷ 48 lb = $2.33/lb
//   3 bags × 5 LB/bag at $53.28 total → $53.28 ÷ 15 lb = $3.552/lb
// For "Each" or non-standard units, cost per each = cost / qty_ordered.
//
// That second example used to be written "$3.55/lb" here, which was the ROUNDED
// output being quoted back as the arithmetic — the tell that the rounding below
// had stopped looking like a lossy step and started looking like the answer.
//
// DO NOT round this to cents. A per-unit price is a RATE, not a money amount:
// priced per g or per ml a real price is a fraction of a cent, so a
// Math.round(x*100)/100 here does not tidy the number, it destroys it. Measured
// on live data 2026-08-08: Heineken 0.0 at $43.96 for 4 × 1980 ml is
// $0.005551/ml and was stored as $0.01 — an 80% overstatement; sparkling water
// went the other way at −33%. Anything under half a cent per unit collapses to
// 0.00 outright, which reads downstream as a free ingredient (flour at
// $1.50/kg is $0.0015/g) — the exact silent zero entryPackFacts() refuses to
// produce elsewhere.
//
// The other two writers of this column already store full precision — the
// manual entry form in products.js and the unit-conversion cascade, which keeps
// 6dp — so rounding here also made the AI import path disagree with them for
// the same purchase. Rounding belongs in the display layer, where
// fmtUnitCost() already quotes per-g prices per kg for exactly this reason.
function unitCostFrom(cost: number, packQty: number, qtyOrdered: number): number {
  const totalUnits = packQty * qtyOrdered
  return totalUnits > 0 ? cost / totalUnits : cost
}

// The stocking unit to declare on a product created from an invoice line.
//
// Products created by import used to be inserted with base_unit unset, and blank
// is not neutral: /api/price-movers prices every purchase through the product's
// declared unit, and with none it falls back to whichever purchase sorts first
// (`stock_unit || packUnit`). So the lens was decided by row order and could
// change as new purchases arrived. A wine bought as a 4 L box and as 750 ml
// bottles was quoted per millilitre because the bottles were written four
// seconds later. Measured 2026-08-08: 18 of 30 products in one live account and
// 8 of 10 in another had no declared unit.
//
// Deliberately the same answer the Products page already infers for a blank
// base_unit (_inferStockUnit in products.js: the newest entry's pack unit), so
// this persists a guess the UI was already making rather than introducing a new
// policy — nothing on screen moves, the guess just stops being re-made, and
// re-made differently, in three places.
//
// normalizeUnit rather than the frontend's toLowerCase(): 'L' has to stay
// uppercase to match the units master list, and 'lt' has to become 'L' so a
// supplier's spelling never becomes a second volume unit that will not convert.
// A blank pack unit yields a blank stocking unit — never invent one, since a
// wrong declared unit is harder to notice than a missing one.
function stockUnitFor(packUnit: string): string {
  return normalizeUnit(packUnit || '')
}

// True when a pack-size string carries an explicit unit of measure — a real unit
// token ("kg", "L"…), a count word ("each"), or any alphabetic unit — as opposed
// to a bare number. A number-only pack size ("2") would otherwise be silently
// coerced to "each" by parsePackSize(), producing a wrong cost_per_unit and
// corrupting every downstream cost comparison. The approve path rejects those
// instead of guessing (see /api/bulk/upsert-products).
function packSizeHasUnit(raw: string): boolean {
  const s = (raw || '').trim()
  if (!s) return false
  // Drop any leading quantity ("2", "2 x 2", "1/5") and separators; a real unit
  // leaves alphabetic characters behind.
  const rest = s.replace(/^[\d.,\s×xX/]+/, '').trim()
  return /[a-zA-Z]/.test(rest)
}

// ─── The org's unit master list, as a lower-cased lookup set ───
// Mirrors isKnownUnit() in public/static/invoices.js: the review screen treats a
// unit as missing unless it appears in this list, and the API has to agree — see
// packSizeUnitIsKnown() below. Returns an empty set when the account has no
// `units` rows at all, which callers must treat as "cannot validate".
async function loadKnownUnits(db: D1Database, org: string | null): Promise<Set<string>> {
  const rows = await db
    .prepare(`SELECT name FROM units WHERE org_id IS ?`)
    .bind(org)
    .all<{ name: string }>()
  return new Set(
    (rows.results || [])
      .map(u => (u.name || '').trim().toLowerCase())
      .filter(Boolean)
  )
}

// True when the unit this pack size would actually be STORED as exists in the
// org's master list. packSizeHasUnit() only proves *some* letters are present,
// so "1 ct" or "12 lbs" sail past it and land in product_entries as a unit
// nothing else in the app recognises — no conversion, no cost comparison, and a
// cost_per_unit that looks legitimate. The review screen already rejects those
// (isKnownUnit); this closes the same hole for callers that skip it.
//
// Validates parsePackSize()'s output rather than re-deriving the token, so the
// guard can never disagree with what the write path stores.
//
// An org with an empty unit list falls through to the shape check: seeding gives
// every new account a list, so an empty one means something is wrong with the
// account, and failing every import is a worse answer than the old behaviour.
function packSizeUnitIsKnown(raw: string, known: Set<string>): boolean {
  if (!packSizeHasUnit(raw)) return false
  if (!known.size) return true
  return known.has(parsePackSize(raw).packUnit.trim().toLowerCase())
}

// ─── Helper: infer product category from name via keyword matching ─
// Best-effort classification for invoice auto-import. Keep the returned labels
// in sync with DEFAULT_CATEGORIES in public/static/utils.js (the frontend list).
// Rules are ordered most-specific first — the first keyword hit wins — so more
// distinctive food groups (seafood, meat, dairy) are matched before broad ones
// (produce, dry goods). Unmatched items fall to 'Other' rather than being
// silently dumped into a food bucket.
// Keywords match on WORD BOUNDARIES, never as raw substrings. Substring
// matching silently filed food under operating supplies, and the damage was not
// cosmetic: "Extra Virgin White Truffle Oil" matched 'gin' → Alcohol, and
// "Asparagus" matched 'rag' → Linen & Uniforms. Those categories are typed
// 'beverage' and 'supplies', so both products left food COGS entirely in the
// P&L. "Extra Virgin Olive Oil" escaped the same fate only because the Oils
// rule happens to be checked before Alcohol — luck, not design.
//
// The optional (e?s) tail keeps plurals working, which a bare \b would break:
// 'tomato' still has to match "Tomatoes with Basil", 'olive' still has to match
// "Olives Mixed Mediterranean Pitted".
const _KW_RE = new Map<string, RegExp>()
function keywordHit(haystack: string, keyword: string): boolean {
  let re = _KW_RE.get(keyword)
  if (!re) {
    const esc = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    re = new RegExp(`\\b${esc}(?:e?s)?\\b`, 'i')
    _KW_RE.set(keyword, re)
  }
  return re.test(haystack)
}

// The keyword list is the FALLBACK, not the primary path — aiCategorizeProducts()
// below is what actually categorises a new product. This runs when there is no
// API key, when the call fails, or when the model answers with something that
// isn't one of the org's categories. It is deliberately English and generic; no
// hand-maintained word list will ever cover a specialty supplier (none of
// 'guanciale', 'pecorino', 'arugula', 'broccolini' were here, which is why 8 of
// 22 products in one Italian restaurant landed in Other). Adding keywords here
// is safe and touches nothing else — adding a CATEGORY needs all four sync
// points listed at the top of this section.
function inferCategory(name: string): string {
  const n = name.toLowerCase()
  const rules: [string, string[]][] = [
    // ── Food (COGS) ──
    ['Seafood',                    ['fish','salmon','tuna','shrimp','prawn','crab','lobster','oyster','mussel','clam','scallop','squid','calamari','cod','halibut','tilapia','anchovy','sardine','branzino','octopus','shellfish','seafood']],
    ['Meat & Poultry',             ['beef','pork','chicken','turkey','lamb','veal','bacon','sausage','prosciutto','salami','pepperoni','ham','duck','steak','brisket','ribs','poultry','meat','guanciale','pancetta','mortadella','bresaola','speck','capicola','coppa','soppressata','nduja','chorizo','tenderloin']],
    ['Dairy & Eggs',               ['milk','cream','butter','cheese','yogurt','yoghurt','egg','mozzarella','parmesan','parmigiano','cheddar','ricotta','mascarpone','buttermilk','dairy','pecorino','grana padano','grana','gorgonzola','provolone','fontina','taleggio','burrata','stracciatella','asiago','feta','brie','gruyere','halloumi']],
    ['Bakery',                     ['bread','bun','bagel','baguette','brioche','croissant','pastry','tortilla','dough','crust','bakery','focaccia','ciabatta','panettone','breadcrumb']],
    ['Frozen',                     ['frozen','ice cream','gelato','sorbet']],
    ['Oils, Sauces & Condiments',  ['olive oil','canola','vinegar','sauce','ketchup','mustard','mayo','mayonnaise','dressing','condiment','pesto','aioli','tahini','harissa']],
    ['Spices & Seasonings',        ['spice','seasoning','cinnamon','cumin','paprika','oregano','nutmeg','turmeric','pepper corn','peppercorn','sea salt','kosher salt']],
    // Fruit names that double as juice flavours ('orange', 'cranberry') are
    // deliberately NOT here: Produce is checked before Non-Alcoholic Beverages,
    // so adding them would file "Orange Juice" as Produce.
    ['Produce',                    ['lettuce','tomato','onion','potato','carrot','garlic','mushroom','spinach','kale','cucumber','celery','avocado','apple','lemon','lime','berry','banana','herb','produce','vegetable','fruit','arugula','rocket','broccolini','broccoli','basil','parsley','cilantro','coriander','thyme','rosemary','sage','mint','chard','radicchio','endive','fennel','zucchini','eggplant','aubergine','artichoke','asparagus','olive','shallot','leek','cabbage','beet','radish','scallion','squash','pumpkin']],
    ['Dry Goods & Pantry',        ['flour','sugar','rice','pasta','noodle','bean','lentil','chickpea','grain','oat','quinoa','cereal','cornstarch','baking','yeast','canned','pantry','polenta','semolina','farro','couscous','arborio','risotto']],
    // ── Beverage ──
    ['Alcohol',                    ['wine','beer','spirit','liquor','vodka','whiskey','whisky','rum','gin','tequila','alcohol','prosecco','chianti','vermouth','amaro','grappa','liqueur','champagne']],
    ['Non-Alcoholic Beverages',    ['juice','water','soda','pop','coffee','tea','syrup','cordial','soft drink','beverage','cola','lemonade','kombucha','espresso']],
    // ── Operating supplies ──
    ['Cleaning & Sanitation',      ['cleaner','sanitizer','sanitiser','soap','detergent','bleach','disinfectant','degreaser','cleaning']],
    ['Disposables',                ['glove','napkin','tissue','straw','cutlery','disposable','paper towel','food wrap','deli container','foil','parchment','skewer','toothpick']],
    ['Packaging',                  ['box','bag','wrap','film','pail','jar','bottle','carton','clamshell','packaging','label']],
    ['Linen & Uniforms',           ['towel','apron','uniform','tablecloth','rag','linen']],
    ['Smallwares & Equipment',     ['pan','pot','knife','sheet tray','whisk','spatula','tong','utensil','smallware','equipment']],
    ['Office & Admin',             ['printer','ink','toner','stationery','pen','envelope','office']],
  ]
  for (const [category, keywords] of rules) {
    if (keywords.some(k => keywordHit(n, k))) return category
  }
  return 'Other'
}

// ─── AI category assignment — new products only ───────────────
// Called from POST /api/bulk/upsert-products for products being created for the
// FIRST time. A repeat purchase matches an existing generic_product and keeps
// the category it already has, so this never runs twice for the same item: a
// hand correction is permanent, and the model never gets a second vote. That is
// also why it is affordable — the cost is once per product ever, not once per
// invoice forever.
//
// The model may answer ONLY with one of the org's own categories. A category
// that is not in the `categories` table has no `type` ('food' | 'beverage' |
// 'supplies'), which is exactly what the P&L buckets money by, and no
// `.cat-<slug>` badge style — an invented one would land money nowhere and look
// broken doing it. The prompt says so and the answer is checked against the list
// again on the way back, because a prompt is a request and a whitelist is a
// guarantee.
//
// Fails soft in every direction — no key, HTTP error, truncation, malformed
// JSON, unknown category name — leaving the inferCategory() keyword guess in
// place. Categorising is never worth failing a save over.
async function aiCategorizeProducts(
  env: Bindings, orgId: string | null, names: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const apiKey = env.ANTHROPIC_API_KEY
  if (!apiKey || !names.length) return out

  const cats = await env.DB.prepare(
    `SELECT name FROM categories WHERE org_id IS ? ORDER BY sort_order, name`,
  ).bind(orgId).all<{ name: string }>()
  const allowed = (cats.results || []).map(r => (r.name || '').trim()).filter(Boolean)
  // No master list means nothing to choose from, and inventing one here would
  // create the untyped category this whole function exists to avoid.
  if (!allowed.length) return out
  const byLower = new Map(allowed.map(n => [n.toLowerCase(), n]))

  const prompt = `You assign each product to exactly one category.

CATEGORIES — you may ONLY use one of these exact strings:
${allowed.map(a => `- ${a}`).join('\n')}

Rules:
- Copy the category string exactly as written above. Do not invent new ones, do
  not reword, do not change capitalisation or punctuation.
- If you are unsure, or nothing fits well, answer "Other".
- These are products a restaurant or food business buys from suppliers. Names
  come from invoices, so they may be abbreviated, include a brand, or be in
  Italian, Spanish or French.

PRODUCTS:
${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}

Reply with JSON only, no prose:
{"categories":[{"n":1,"category":"..."},{"n":2,"category":"..."}]}`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        // No `thinking` block, unlike parse-invoice/parse-recipe: this is a
        // short classification against a fixed list, not a document to read,
        // and thinking tokens bill at the output rate. 64 tokens per product
        // plus slack covers the JSON with room for a long category list.
        max_tokens: Math.min(4000, 200 + names.length * 64),
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      }),
    })
    if (!response.ok) return out

    const data = await response.json() as {
      content?: Array<{ type: string; text?: string }>
      stop_reason?: string
      usage?: { input_tokens?: number; output_tokens?: number }
    }

    // Log the spend before reading the answer — Anthropic has billed for the
    // call whether or not its JSON parses. kind='category' keeps it OUT of the
    // monthly invoice cap (monthlyInvoiceParses filters kind='invoice') while
    // still showing up in the admin cost totals, which sum every row.
    const inputTokens  = data.usage?.input_tokens  || 0
    const outputTokens = data.usage?.output_tokens || 0
    const cost = Math.round(((inputTokens / 1_000_000) * 5 + (outputTokens / 1_000_000) * 25) * 1_000_000) / 1_000_000
    await env.DB.prepare(
      `INSERT INTO ai_parse_log (id, org_id, kind, input_tokens, output_tokens, cost)
       VALUES (?, ?, 'category', ?, ?, ?)`,
    ).bind(uid(), orgId, inputTokens, outputTokens, cost).run()

    if (data.stop_reason === 'max_tokens') return out

    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('')
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
    if (!json) return out
    const parsed = JSON.parse(json) as { categories?: Array<{ n?: number; category?: string }> }

    for (const row of parsed.categories || []) {
      const idx = Number(row?.n)
      const name = names[idx - 1]
      if (!name) continue
      // The whitelist check. Anything the model made up is dropped here and the
      // keyword guess stands, which is the whole point of doing it server-side.
      const canonical = byLower.get(String(row?.category || '').trim().toLowerCase())
      if (canonical) out.set(name.toLowerCase(), canonical)
    }
  } catch {
    return out
  }
  return out
}

// ─── Storage layout (sections + item placement) ───────────────
// Lets the user describe their physical storage so the stock take can be
// walked place by place. See migration 0030. Declared before the generic
// /api/tables/* routes — Hono matches in registration order.

// GET /api/storage-layout
// Returns every section in walk order with the items placed in it, plus an
// "unassigned" list. Items come from the inventory rows, so this is exactly
// the set a stock take would cover.
app.get('/api/storage-layout', async (c) => {
  const org = orgOf(c)
  const [sections, placements, inv] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM storage_sections WHERE org_id IS ? ORDER BY sort_order, name`).bind(org).all<{
      id: string; name: string; sort_order: number
    }>(),
    c.env.DB.prepare(`SELECT * FROM item_placements WHERE org_id IS ?`).bind(org).all<{
      item_id: string; item_type: string; section_id: string; sort_order: number
    }>(),
    c.env.DB.prepare(
      `SELECT item_id, item_type, item_name, category, unit FROM inventory WHERE org_id IS ? ORDER BY item_name`
    ).bind(org).all<{ item_id: string; item_type: string; item_name: string; category: string; unit: string }>(),
  ])

  const placedBy = new Map(
    (placements.results || []).map(p => [`${p.item_type}:${p.item_id}`, p])
  )
  const sectionRows = sections.results || []
  const byId = new Map(sectionRows.map(s => [s.id, { ...s, items: [] as unknown[] }]))
  const unassigned: unknown[] = []

  for (const it of (inv.results || [])) {
    const p = placedBy.get(`${it.item_type}:${it.item_id}`)
    const target = p ? byId.get(p.section_id) : null
    // A placement pointing at a deleted section falls back to unassigned.
    if (target) target.items.push({ ...it, sort_order: p!.sort_order })
    else unassigned.push({ ...it, sort_order: 0 })
  }

  for (const s of byId.values()) {
    (s.items as Array<{ sort_order: number }>).sort((a, b) => a.sort_order - b.sort_order)
  }

  return c.json({
    sections: [...byId.values()],
    unassigned,
  })
})

// POST /api/storage-layout/sections   Body: { name }
app.post('/api/storage-layout/sections', async (c) => {
  const { name } = await c.req.json() as { name?: string }
  const clean = (name || '').trim()
  if (!clean) return c.json({ error: 'Section name is required' }, 400)

  const org = orgOf(c)
  // Uniqueness is per business — two restaurants may both have a "Walk-in".
  const dupe = await c.env.DB.prepare(
    `SELECT id FROM storage_sections WHERE LOWER(name) = LOWER(?) AND org_id IS ?`
  ).bind(clean, org).first()
  if (dupe) return c.json({ error: 'A section with that name already exists' }, 409)

  const max = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS m FROM storage_sections WHERE org_id IS ?`
  ).bind(org).first<{ m: number }>()

  const id = uid()
  await c.env.DB.prepare(
    `INSERT INTO storage_sections (id, name, sort_order, org_id) VALUES (?, ?, ?, ?)`
  ).bind(id, clean, (max?.m ?? -1) + 1, org).run()

  return c.json({ id, name: clean, sort_order: (max?.m ?? -1) + 1 }, 201)
})

// PATCH /api/storage-layout/sections/:id   Body: { name }
app.patch('/api/storage-layout/sections/:id', async (c) => {
  const id = c.req.param('id')
  const { name } = await c.req.json() as { name?: string }
  const clean = (name || '').trim()
  if (!clean) return c.json({ error: 'Section name is required' }, 400)

  const org = orgOf(c)
  const dupe = await c.env.DB.prepare(
    `SELECT id FROM storage_sections WHERE LOWER(name) = LOWER(?) AND id != ? AND org_id IS ?`
  ).bind(clean, id, org).first()
  if (dupe) return c.json({ error: 'A section with that name already exists' }, 409)

  await c.env.DB.prepare(`UPDATE storage_sections SET name = ? WHERE id = ? AND org_id IS ?`).bind(clean, id, org).run()
  return c.json({ ok: true })
})

// DELETE /api/storage-layout/sections/:id
// Deletes the section and its placements only — the products themselves are
// untouched and simply fall back to "Unassigned".
app.delete('/api/storage-layout/sections/:id', async (c) => {
  const id = c.req.param('id')
  const org = orgOf(c)
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM item_placements WHERE section_id = ? AND org_id IS ?`).bind(id, org),
    c.env.DB.prepare(`DELETE FROM storage_sections WHERE id = ? AND org_id IS ?`).bind(id, org),
  ])
  return c.json({ ok: true })
})

// PUT /api/storage-layout/order
// Body: { sections: [id, …], placements: [{ item_id, item_type, section_id, sort_order }] }
//
// Saves the whole arrangement in one batch: section walk order plus every
// item's section and position. Sending the full picture (rather than diffing)
// keeps drag-and-drop simple and makes the write atomic — a half-applied
// reorder would leave the counting screen in a nonsense order.
app.put('/api/storage-layout/order', async (c) => {
  const body = await c.req.json() as {
    sections?: string[]
    placements?: Array<{ item_id: string; item_type: string; section_id: string; sort_order: number }>
  }

  const org = orgOf(c)
  const statements: D1PreparedStatement[] = []

  for (const [i, sectionId] of (body.sections || []).entries()) {
    statements.push(
      c.env.DB.prepare(`UPDATE storage_sections SET sort_order = ? WHERE id = ? AND org_id IS ?`).bind(i, sectionId, org)
    )
  }

  if (body.placements) {
    // Replace wholesale: anything not in the payload is unassigned by omission.
    // Scoped: wiping every business's placements here would be catastrophic.
    statements.push(c.env.DB.prepare(`DELETE FROM item_placements WHERE org_id IS ?`).bind(org))
    for (const p of body.placements) {
      if (!p.item_id || !p.item_type || !p.section_id) continue
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO item_placements (id, item_id, item_type, section_id, sort_order, org_id)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(uid(), p.item_id, p.item_type, p.section_id, Number(p.sort_order) || 0, org)
      )
    }
  }

  if (statements.length) await c.env.DB.batch(statements)
  return c.json({ ok: true })
})

// ─── Manual stock adjustment ──────────────────────────────────
// POST /api/inventory/:id/adjust
// Body: { new_quantity, change, reason_code, reason, note? }
//
// Applies the quantity change AND writes the stock_log line in one batch, so a
// movement can never land without its audit trail (the two used to be separate
// client-side calls). Declared before the generic /api/tables/* routes — Hono
// matches in registration order.
app.post('/api/inventory/:id/adjust', async (c) => {
  const invId = c.req.param('id')
  const body = await c.req.json() as {
    new_quantity: number; change: number
    reason_code?: string; reason?: string; note?: string
  }

  const newQty = Number(body.new_quantity)
  const change = Number(body.change)
  if (!isFinite(newQty) || !isFinite(change)) {
    return c.json({ error: 'new_quantity and change must be numbers' }, 400)
  }

  const org = orgOf(c)
  // The scoped lookup doubles as the authorisation check: another business's
  // row simply isn't found, so the adjustment can't be applied to it.
  const row = await c.env.DB.prepare(
    `SELECT id, item_id, item_type, item_name FROM inventory WHERE id = ? AND org_id IS ?`
  ).bind(invId, org).first<{ id: string; item_id: string; item_type: string; item_name: string }>()
  if (!row) return c.json({ error: 'Inventory row not found' }, 404)

  const now = new Date().toISOString()
  const statements = [
    c.env.DB.prepare(`UPDATE inventory SET quantity = ? WHERE id = ? AND org_id IS ?`).bind(newQty, invId, org),
  ]

  // A zero-change adjustment is a no-op worth recording nothing for.
  if (change !== 0) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO stock_log
           (id, inventory_id, item_id, item_type, item_name, change, reason, reason_code, note, lot_number, moved_at, org_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`
      ).bind(
        uid(), invId, row.item_id, row.item_type, row.item_name,
        change, (body.reason || '').trim() || 'Manual adjustment',
        (body.reason_code || '').trim(), (body.note || '').trim(), now, org
      )
    )
  }

  await c.env.DB.batch(statements)
  return c.json({ ok: true, quantity: newQty, change })
})

// ══════════════════════════════════════════════════════════════
// AUTH ROUTES  (declared before the generic CRUD — Hono matches in order)
// ══════════════════════════════════════════════════════════════
// There is deliberately NO signup endpoint. Accounts are created by the
// super-admin on /api/admin/organizations after an actual conversation with
// the customer — see the accounts plan. That removes the whole email
// dependency: no verification mail, no password-reset mail, no bot defence.

const MIN_PASSWORD_LEN = 8

function normalizeEmail(s: unknown): string {
  return String(s || '').trim().toLowerCase()
}

function publicUser(u: SessionUser) {
  return {
    id: u.id, email: u.email, name: u.name, role: u.role,
    org_id: u.org_id, org_name: u.org_name, account_type: u.account_type,
    is_super_admin: u.role === 'super_admin',
    // Drives the read-only banner. Never true for a super-admin, who is exempt
    // from their customers' billing state.
    suspended: u.role !== 'super_admin' && !!u.org_suspended_at,
    suspend_reason: u.role !== 'super_admin' ? (u.org_suspend_reason || '') : '',
    // Drives nav hiding and the upgrade panels. A super-admin sees everything,
    // matching their exemption from gating in the /api/* middleware.
    plan: (u.org_plan || 'essential').toLowerCase(),
    features: u.role === 'super_admin'
      ? [...PRO_FEATURES]
      : [...planFeatures(u.org_plan)],
  }
}

// ─── Which environment is this? ───────────────────────────────
// GET /api/env  →  { environment: 'production' | 'staging' }
//
// Drives the staging banner (public/static/env-banner.js) and nothing else.
// Public, and safe to be: it discloses nothing the address bar doesn't already,
// and it is needed BEFORE sign-in — the login screen is exactly where mistaking
// one site for the other begins.
//
// Anything other than the literal 'staging' answers 'production'. The banner
// promises a screen is safe to break, so the default must be the careful one: a
// missing or misspelt APP_ENV hides the banner on staging rather than painting
// one over live customer data.
app.get('/api/env', (c) => c.json({
  environment: c.env.APP_ENV === 'staging' ? 'staging' : 'production',
}))

// One-time bootstrap: creates the very first super-admin. Because there is no
// signup page, without this there would be no way to get the first account in.
// It refuses once ANY user exists, so it cannot be used to add a second
// back-door admin later.
app.post('/api/auth/bootstrap', async (c) => {
  if (!c.env.SESSION_SECRET) return c.json({ error: 'SESSION_SECRET is not configured on the server.' }, 500)

  const existing = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users`).first<{ n: number }>()
  if ((existing?.n || 0) > 0) {
    return c.json({ error: 'Already set up. Bootstrap is only available before the first account exists.' }, 409)
  }

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const email = normalizeEmail(body.email)
  const password = String(body.password || '')
  if (!email.includes('@')) return c.json({ error: 'A valid email is required.' }, 400)
  if (password.length < MIN_PASSWORD_LEN) {
    return c.json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` }, 400)
  }

  const id = uid()
  const salt = randomHex(16)
  const hash = await hashPassword(password, salt)
  await c.env.DB.prepare(
    `INSERT INTO users (id, org_id, email, password_hash, password_salt, password_iter, role, name)
     VALUES (?, NULL, ?, ?, ?, ?, 'super_admin', ?)`,
  ).bind(id, email, hash, salt, PBKDF2_ITERATIONS, String(body.name || '')).run()

  return c.json({ ok: true, id, email, role: 'super_admin' })
})

app.post('/api/auth/login', async (c) => {
  if (!c.env.SESSION_SECRET) return c.json({ error: 'SESSION_SECRET is not configured on the server.' }, 500)

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const email = normalizeEmail(body.email)
  const password = String(body.password || '')

  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.password_hash, u.password_salt, u.password_iter, u.role,
            o.archived_at AS org_archived_at
       FROM users u
       LEFT JOIN organizations o ON o.id = u.org_id
      WHERE u.email = ? AND u.archived_at IS NULL`,
  ).bind(email).first<any>()

  // Same message and roughly the same work whether the address is unknown or
  // the password is wrong — otherwise this endpoint becomes a way to discover
  // which emails have accounts.
  if (!row) {
    await hashPassword(password, 'no-such-user-dummy-salt')
    return c.json({ error: 'Email or password is incorrect.' }, 401)
  }
  const ok = await verifyPassword(password, row.password_salt, row.password_hash, row.password_iter)
  if (!ok) return c.json({ error: 'Email or password is incorrect.' }, 401)

  // Closed account: say so. Checked only AFTER the password is verified, so
  // this can't be used to probe which addresses belong to closed accounts.
  // Telling the truth here matters — "Email or password is incorrect" would
  // send them hunting for a password problem that doesn't exist, and then to
  // us. A suspended account is deliberately NOT blocked: they need to get in
  // to read the banner explaining why they can't save anything.
  if (row.org_archived_at) {
    return c.json({ error: 'This account has been closed. Contact us if this is unexpected.' }, 403)
  }

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  const token = await signSession(c.env.SESSION_SECRET, row.id, expiresAt)

  await c.env.DB.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).bind(row.id).run()

  c.header('Set-Cookie', sessionCookieHeader(token, c.req.url, SESSION_TTL_SECONDS))

  // Load the user by id rather than calling currentUser(): the cookie was just
  // written to the RESPONSE, so the incoming request still has none and
  // currentUser() would read null. The frontend needs this to know where to
  // send the person after signing in (admin screen vs the app).
  const me = await c.env.DB.prepare(
    `SELECT ${SESSION_USER_COLUMNS}
       FROM users u
       LEFT JOIN organizations o ON o.id = u.org_id
      WHERE u.id = ?`,
  ).bind(row.id).first<SessionUser>()

  return c.json({ ok: true, user: me ? publicUser(me) : null })
})

app.post('/api/auth/logout', async (c) => {
  // Max-Age=0 expires the cookie immediately.
  c.header('Set-Cookie', sessionCookieHeader('', c.req.url, 0))
  return c.json({ ok: true })
})

// The frontend's "am I signed in?" check. 200 with the user, or 401.
app.get('/api/auth/me', async (c) => {
  const me = await currentUser(c)
  if (!me) return c.json({ error: 'Not signed in.' }, 401)

  // When a super-admin is viewing a customer's data, say so — the app uses this
  // to show the warning bar, and it's how the operator knows whose numbers
  // they're looking at.
  let viewing_as = null
  if (me.role === 'super_admin') {
    const viewOrg = readCookie(c.req.header('cookie'), VIEW_ORG_COOKIE)
    if (viewOrg) {
      const o = await c.env.DB.prepare('SELECT id, name FROM organizations WHERE id = ?')
        .bind(viewOrg).first<{ id: string; name: string }>()
      if (o) viewing_as = o
    }
  }
  return c.json({ user: publicUser(me), viewing_as })
})

// ── Super-admin: view a customer's data without their password ──
// POST /api/admin/view-as   Body: { org_id }  — omit/null to stop viewing.
//
// Sets a cookie that orgOf() reads. The operator stays signed in AS THEMSELVES
// throughout — they are not becoming the customer. That distinction is what
// keeps the audit trail honest ("Simone viewed Bella's Pizzeria", not "Maria
// did something at 2am"), and it means the customer's password stays entirely
// their own business: they can change it whenever they like without ever
// locking the operator out.
app.post('/api/admin/view-as', async (c) => {
  if (!await requireSuperAdmin(c)) return c.json({ error: 'Not authorized.' }, 403)

  const body = await c.req.json().catch(() => ({})) as { org_id?: string | null }
  const orgId = (body.org_id || '').trim()

  if (!orgId) {
    c.header('Set-Cookie', `${VIEW_ORG_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
    return c.json({ ok: true, viewing_as: null })
  }

  const org = await c.env.DB.prepare('SELECT id, name FROM organizations WHERE id = ?')
    .bind(orgId).first<{ id: string; name: string }>()
  if (!org) return c.json({ error: 'Restaurant not found.' }, 404)

  const secure = new URL(c.req.url).protocol === 'https:' ? ' Secure;' : ''
  c.header('Set-Cookie',
    `${VIEW_ORG_COOKIE}=${encodeURIComponent(org.id)}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${60 * 60 * 8}`)
  return c.json({ ok: true, viewing_as: org })
})

// ── Change your own password ──────────────────────────────────
// Requires the current one, so a borrowed unlocked laptop can't be used to
// lock the real owner out. No email involved: there is no reset link to send.
app.post('/api/auth/change-password', async (c) => {
  const me = await currentUser(c)
  if (!me) return c.json({ error: 'Not signed in.' }, 401)

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const currentPassword = String(body.current_password || '')
  const newPassword = String(body.new_password || '')
  if (newPassword.length < MIN_PASSWORD_LEN) {
    return c.json({ error: `New password must be at least ${MIN_PASSWORD_LEN} characters.` }, 400)
  }

  const row = await c.env.DB.prepare(
    'SELECT password_hash, password_salt, password_iter FROM users WHERE id = ?',
  ).bind(me.id).first<any>()
  if (!row) return c.json({ error: 'Not signed in.' }, 401)

  const ok = await verifyPassword(currentPassword, row.password_salt, row.password_hash, row.password_iter)
  if (!ok) return c.json({ error: 'Current password is incorrect.' }, 403)

  const salt = randomHex(16)
  const hash = await hashPassword(newPassword, salt)
  await c.env.DB.prepare(
    'UPDATE users SET password_hash = ?, password_salt = ?, password_iter = ? WHERE id = ?',
  ).bind(hash, salt, PBKDF2_ITERATIONS, me.id).run()

  return c.json({ ok: true })
})

// ── Super-admin: reset someone's forgotten password ───────────
// The manual-onboarding counterpart to a reset email: the operator sets a new
// temporary password and tells the customer, exactly as at signup. Deliberately
// does NOT reveal the old one — it is not recoverable, only replaceable.
app.post('/api/admin/users/reset-password', async (c) => {
  if (!await requireSuperAdmin(c)) return c.json({ error: 'Not authorized.' }, 403)

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const email = normalizeEmail(body.email)
  const newPassword = String(body.new_password || '')
  if (newPassword.length < MIN_PASSWORD_LEN) {
    return c.json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` }, 400)
  }

  const user = await c.env.DB.prepare(
    'SELECT id, email FROM users WHERE email = ? AND archived_at IS NULL',
  ).bind(email).first<{ id: string; email: string }>()
  if (!user) return c.json({ error: 'No account with that email.' }, 404)

  const salt = randomHex(16)
  const hash = await hashPassword(newPassword, salt)
  await c.env.DB.prepare(
    'UPDATE users SET password_hash = ?, password_salt = ?, password_iter = ? WHERE id = ?',
  ).bind(hash, salt, PBKDF2_ITERATIONS, user.id).run()

  return c.json({ ok: true, email: user.email })
})

// ── Super-admin: create a customer account ────────────────────
// This is the manual-onboarding path that replaces a signup page. Creates the
// organization and its owner user together, since one is useless without the
// other.
async function requireSuperAdmin(c: any): Promise<SessionUser | null> {
  const me = await currentUser(c)
  if (!me || me.role !== 'super_admin') return null
  return me
}

// GET /api/admin/organizations?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// `from`/`to` scope the AI usage columns only — the account list itself is
// always complete, so filtering to a date range never makes a restaurant vanish
// from the screen. `to` is inclusive of the whole day.
app.get('/api/admin/organizations', async (c) => {
  if (!await requireSuperAdmin(c)) return c.json({ error: 'Not authorized.' }, 403)

  // Blank/absent = all time. Anything not shaped like a date is ignored rather
  // than rejected: a half-typed date in the picker shouldn't error the page.
  const dateOnly = (v: string | undefined) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v! : '')
  const from = dateOnly(c.req.query('from'))
  const to   = dateOnly(c.req.query('to'))
  const fromTs = from ? `${from} 00:00:00` : '0000-01-01 00:00:00'
  const toTs   = to   ? `${to} 23:59:59`   : '9999-12-31 23:59:59'

  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.name, o.account_type, o.created_at, o.archived_at,
            o.suspended_at, o.suspend_reason, o.plan, o.invoice_cap,
            (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id AND u.archived_at IS NULL) AS user_count,
            (SELECT email FROM users u WHERE u.org_id = o.id AND u.role = 'owner'
              ORDER BY u.created_at LIMIT 1) AS owner_email,
            -- Anthropic spend, from the per-call log rather than from invoices:
            -- a parse the customer abandoned still cost money, and a multi-page
            -- invoice is several calls. Voided invoices are likewise still
            -- counted — the parse was billed whichever way the invoice went.
            -- Only invoice parsing appears here; parse-recipe discards its usage.
            (SELECT COALESCE(SUM(l.cost), 0) FROM ai_parse_log l
              WHERE l.org_id = o.id AND l.kind = 'invoice'
                AND l.created_at >= ?1 AND l.created_at <= ?2) AS ai_cost_total,
            (SELECT COUNT(*) FROM ai_parse_log l
              WHERE l.org_id = o.id AND l.kind = 'invoice'
                AND l.created_at >= ?1 AND l.created_at <= ?2) AS ai_parse_count,
            -- Always the CURRENT month regardless of the filter: the cap is a
            -- monthly allowance, so "used this month" is the only reading of it
            -- that means anything. Shown alongside, never in place of, the
            -- filtered figures.
            (SELECT COUNT(*) FROM ai_parse_log l
              WHERE l.org_id = o.id AND l.kind = 'invoice'
                AND l.created_at >= ?3) AS parses_this_month,
            -- Times this account was refused a parse for being over its cap,
            -- within the filtered range. The demand a hard block hides.
            (SELECT COUNT(*) FROM ai_cap_blocks b
              WHERE b.org_id = o.id
                AND b.created_at >= ?1 AND b.created_at <= ?2) AS cap_blocks
       FROM organizations o
      ORDER BY o.created_at DESC`,
  ).bind(fromTs, toTs, monthStart()).all()

  // plan_label is resolved here, not in admin.html, so the name a commissary is
  // sold under has exactly one definition. The raw `plan` still goes out beside
  // it — the picker needs the entitlement to decide what it may offer.
  const rows = (results || []).map((o: any) => ({ ...o, plan_label: planLabel(o.plan, o.account_type) }))

  return c.json({
    data: rows,
    range: { from, to },
    plan_caps: PLAN_INVOICE_CAPS,
  })
})

app.post('/api/admin/organizations', async (c) => {
  if (!await requireSuperAdmin(c)) return c.json({ error: 'Not authorized.' }, 403)

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const name = String(body.name || '').trim()
  const email = normalizeEmail(body.owner_email)
  const password = String(body.owner_password || '')
  const accountType = String(body.account_type || 'restaurant')

  if (!name) return c.json({ error: 'Restaurant name is required.' }, 400)
  if (!email.includes('@')) return c.json({ error: 'A valid owner email is required.' }, 400)
  if (password.length < MIN_PASSWORD_LEN) {
    return c.json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` }, 400)
  }
  if (!['restaurant', 'commissary'].includes(accountType)) {
    return c.json({ error: 'Account type must be restaurant or commissary.' }, 400)
  }

  const clash = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first()
  if (clash) return c.json({ error: 'That email already has an account.' }, 409)

  const orgId = uid()
  const userId = uid()
  const salt = randomHex(16)
  const hash = await hashPassword(password, salt)

  // A commissary is sold one tier — Production — which is the Pro feature set.
  // Set it here rather than leaving the column default: an Essential commissary
  // is a broken account, not a cheaper one. Its whole workflow is Produce Batch
  // and Pack Run drawing bins down, and those write inventory that only Pro can
  // then count, adjust or reconcile. See planLabel().
  const plan = accountType === 'commissary' ? 'pro' : 'essential'

  // All inserts in one batch so a failure can't leave an organization with
  // no owner (D1 runs a batch as a transaction).
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO organizations (id, name, account_type, plan) VALUES (?, ?, ?, ?)`)
      .bind(orgId, name, accountType, plan),
    c.env.DB.prepare(
      `INSERT INTO users (id, org_id, email, password_hash, password_salt, password_iter, role, name)
       VALUES (?, ?, ?, ?, ?, ?, 'owner', ?)`,
    ).bind(userId, orgId, email, hash, salt, PBKDF2_ITERATIONS, String(body.owner_name || '')),
    // Seed the unit master list. /api/tables/units is strictly org-scoped with
    // no fallback to the NULL-org rows, so without this a brand-new account has
    // an empty unit picker — which first bites during invoice import, exactly
    // when the customer least wants to stop and define "kg".
    ...DEFAULT_UNITS.map((u, i) =>
      c.env.DB.prepare(`INSERT INTO units (name, sort_order, org_id) VALUES (?, ?, ?)`)
        .bind(u, i + 1, orgId)),
    // Same reasoning for categories. Requires migration 0038 — before it,
    // categories.name carried a GLOBAL unique constraint and these inserts
    // would collide with the first organization's copy of the taxonomy.
    ...DEFAULT_CATEGORIES.map((cat, i) =>
      c.env.DB.prepare(`INSERT INTO categories (name, sort_order, type, org_id) VALUES (?, ?, ?, ?)`)
        .bind(cat.name, i + 1, cat.type, orgId)),
  ])

  return c.json({ ok: true,
                  organization: { id: orgId, name, account_type: accountType, plan,
                                  plan_label: planLabel(plan, accountType) },
                  owner: { id: userId, email } })
})

// ── Account lifecycle: suspend / restore / archive / purge ────
// Three severities, deliberately separate buttons rather than one destructive
// "delete". See migration 0037 for the state definitions.

// Behind on payment. Read-only from their side; instantly reversible.
// ── Set an organization's plan tier ──
// POST /api/admin/organizations/:id/plan   Body: { plan: 'essential' | 'pro' }
//
// Records what the customer was sold, and it IS the gate — planFeatures() below
// reads this column on every /api/* request.
const PLANS = ['essential', 'pro']

// ─── Plan NAME vs plan ENTITLEMENT ────────────────────────────
// A commissary is sold a single tier called "Production". It is the Pro feature
// set exactly — what makes it a different product is account_type, which is
// what shows Produce Batch, Pack Run and the "How is this made?" dropdown (see
// applyBatchWorkflowGating in public/static/utils.js).
//
// So it is deliberately NOT a third value in `plan`. Every plan comparison in
// this file and in utils.js is binary against 'pro' or 'essential', and a third
// value would fail differently in each: planFeatures() would hand back an EMPTY
// feature set (loud — they lose every Pro page), while PLAN_INVOICE_CAPS[...] ??
// 0 resolves an unknown plan to 0 = UNCAPPED (silent, and it costs us money per
// parse). Naming is a naming problem; keep it out of the entitlement.
//
// The invariant that makes the label honest: a commissary is always on 'pro'.
// Enforced at creation and on the plan endpoint, and backfilled by 0044.
function planLabel(plan: string | null | undefined, accountType: string | null | undefined): string {
  const p = (plan || 'essential').toLowerCase()
  if ((accountType || '').toLowerCase() === 'commissary') return 'Production'
  return p === 'pro' ? 'Pro' : 'Essential'
}

// ─── Plan feature gating ──────────────────────────────────────
// Essential = know your costs (everything that runs off invoices). Pro = control
// them (everything that needs someone to physically count stock).
//
// The map lists ONLY what Pro adds. Anything unlisted is available on every
// plan, so a newly added endpoint is open until it is deliberately gated. That
// is the safer direction to fail: a missing gate costs a little revenue, a wrong
// gate breaks a customer's shift.
const PRO_FEATURES = ['inventory_tools', 'stock_takes', 'storage_layout', 'staff', 'true_cogs', 'pos_sales'] as const

function planFeatures(plan: string | null | undefined): Set<string> {
  return (plan || 'essential').toLowerCase() === 'pro'
    ? new Set<string>(PRO_FEATURES)
    : new Set<string>()
}

// Tables only a Pro feature touches.
//
// `inventory` and `stock_log` are deliberately ABSENT. Essential tracks stock
// silently — packing a Finished Product writes both — and recipes.js,
// finished-products.js and products.js all READ inventory to cost and convert.
// Gating those tables would break Essential features, and would also mean an
// upgrade needed a data backfill instead of a column flip.
const PRO_ONLY_TABLES: Record<string, string> = {
  staff:               'staff',
  staff_certifications:'staff',
  certification_types: 'staff',
  stock_takes:         'stock_takes',
  stock_take_items:    'stock_takes',
  // The pos_* tables are absent because they are not in ALLOWED_TABLES at all —
  // they never reach the generic table routes. Their gate is the /api/pos-
  // prefix in featureForPath below.
}

// The Pro feature a request belongs to, or null when it is available to all.
function featureForPath(path: string): string | null {
  if (path.startsWith('/api/stock-take'))    return 'stock_takes'
  if (path.startsWith('/api/storage-layout')) return 'storage_layout'
  // Covers /api/pos-imports and /api/pos-mappings alike.
  if (path.startsWith('/api/pos-'))           return 'pos_sales'
  // Adjust Stock only. Reading inventory stays open — see PRO_ONLY_TABLES.
  if (/^\/api\/inventory\/[^/]+\/adjust$/.test(path)) return 'inventory_tools'
  const table = path.match(/^\/api\/tables\/([^/?]+)/)
  if (table) return PRO_ONLY_TABLES[table[1]] || null
  return null
}

// ─── Monthly AI invoice-parsing cap ───────────────────────────
// The one recurring per-customer cost. A recipe book is parsed once at
// onboarding (~$3 all-in) and never again; invoices arrive every week forever,
// so this is the only AI spend worth metering.
//
// 0 means uncapped. Pro is uncapped by design — the tier is sold on inventory
// and variance, not on parse volume.
const PLAN_INVOICE_CAPS: Record<string, number> = {
  essential: 150,
  pro: 0,
}

// The cap actually in force for an organization.
//   invoice_cap NULL -> the plan's default
//   invoice_cap 0    -> explicitly uncapped (an override that lifts the cap)
//   invoice_cap N    -> explicitly capped at N
// Returns 0 for "no limit", which is what the caller checks.
// Takes the organization ROW (not an id — `org` means an id everywhere else in
// this file, via orgOf()).
function effectiveInvoiceCap(orgRow: { plan?: string | null; invoice_cap?: number | null }): number {
  if (orgRow.invoice_cap !== null && orgRow.invoice_cap !== undefined) {
    return Number(orgRow.invoice_cap) || 0
  }
  return PLAN_INVOICE_CAPS[(orgRow.plan || 'essential').toLowerCase()] ?? 0
}

// First instant of the current calendar month, as SQLite's datetime() format.
// Calendar month rather than a rolling 30 days: it matches how the plan is sold
// and how a customer thinks about "this month's invoices", and it makes the
// reset date predictable instead of per-account.
function monthStart(): string {
  return new Date().toISOString().slice(0, 7) + '-01 00:00:00'
}

// Invoice parses this organization has made in the current calendar month.
async function monthlyInvoiceParses(db: D1Database, orgId: string | null): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM ai_parse_log
      WHERE org_id IS ? AND kind = 'invoice' AND created_at >= ?`,
  ).bind(orgId, monthStart()).first<{ n: number }>()
  return Number(row?.n) || 0
}

app.post('/api/admin/organizations/:id/plan', async (c) => {
  if (!await requireSuperAdmin(c)) return c.json({ error: 'Not authorized.' }, 403)
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const plan = String(body.plan || '').trim().toLowerCase()

  if (!PLANS.includes(plan)) {
    return c.json({ error: `Plan must be one of: ${PLANS.join(', ')}.` }, 400)
  }

  const org = await c.env.DB.prepare('SELECT id, name, account_type FROM organizations WHERE id = ?')
    .bind(id).first<{ id: string; name: string; account_type: string }>()
  if (!org) return c.json({ error: 'Restaurant not found.' }, 404)

  // The one plan move that is never valid. A commissary on Essential keeps its
  // Produce Batch and Pack Run buttons — they are gated on account_type, not on
  // plan — so it would go on writing inventory it can no longer count or adjust,
  // and nobody would see a refusal until the first stock take. Refuse it here
  // instead, where there is a person to read the reason.
  if (org.account_type === 'commissary' && plan !== 'pro') {
    return c.json({ error: 'A commissary is on Production, which is the full feature set. ' +
                           'Change the account type first if this is really a downgrade.' }, 400)
  }

  await c.env.DB.prepare(`UPDATE organizations SET plan = ? WHERE id = ?`).bind(plan, id).run()
  return c.json({ ok: true, organization: { id: org.id, name: org.name }, plan,
                  plan_label: planLabel(plan, org.account_type) })
})

// ── Override an organization's monthly invoice-parse cap ──────
// POST /api/admin/organizations/:id/invoice-cap   Body: { invoice_cap: number|null }
//
// This is the "lift the cap for one account" lever: a customer stuck at 150
// mid-month gets unblocked from this screen rather than from a deploy. It is
// also the seam a future pay-per-invoice overage plugs into — a cleared payment
// raises this number, and enforcement needs no change at all.
//   null -> follow the plan default again
//   0    -> uncapped
//   N    -> capped at N
app.post('/api/admin/organizations/:id/invoice-cap', async (c) => {
  if (!await requireSuperAdmin(c)) return c.json({ error: 'Not authorized.' }, 403)
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>

  let cap: number | null = null
  if (body.invoice_cap !== null && body.invoice_cap !== undefined && String(body.invoice_cap).trim() !== '') {
    cap = Math.floor(Number(body.invoice_cap))
    if (!Number.isFinite(cap) || cap < 0) {
      return c.json({ error: 'Cap must be a whole number of invoices, or 0 for unlimited.' }, 400)
    }
  }

  const org = await c.env.DB.prepare('SELECT id, name, plan FROM organizations WHERE id = ?')
    .bind(id).first<{ id: string; name: string; plan: string }>()
  if (!org) return c.json({ error: 'Restaurant not found.' }, 404)

  await c.env.DB.prepare(`UPDATE organizations SET invoice_cap = ? WHERE id = ?`).bind(cap, id).run()
  return c.json({
    ok: true,
    organization: { id: org.id, name: org.name },
    invoice_cap: cap,
    effective_cap: effectiveInvoiceCap({ plan: org.plan, invoice_cap: cap }),
  })
})

app.post('/api/admin/organizations/:id/suspend', async (c) => {
  if (!await requireSuperAdmin(c)) return c.json({ error: 'Not authorized.' }, 403)
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const reason = String(body.reason || '').trim()

  const org = await c.env.DB.prepare('SELECT id, name, archived_at FROM organizations WHERE id = ?')
    .bind(id).first<{ id: string; name: string; archived_at: string | null }>()
  if (!org) return c.json({ error: 'Restaurant not found.' }, 404)
  if (org.archived_at) return c.json({ error: 'That account is closed — restore it before suspending.' }, 409)

  await c.env.DB.prepare(
    `UPDATE organizations SET suspended_at = datetime('now'), suspend_reason = ? WHERE id = ?`,
  ).bind(reason, id).run()
  return c.json({ ok: true, organization: { id: org.id, name: org.name }, suspended: true })
})

// Paid up, or closed in error. Clears both flags — the operator's intent when
// they click Restore is "make this work again", and leaving the other flag set
// would silently keep them locked out.
app.post('/api/admin/organizations/:id/restore', async (c) => {
  if (!await requireSuperAdmin(c)) return c.json({ error: 'Not authorized.' }, 403)
  const id = c.req.param('id')

  const org = await c.env.DB.prepare('SELECT id, name FROM organizations WHERE id = ?')
    .bind(id).first<{ id: string; name: string }>()
  if (!org) return c.json({ error: 'Restaurant not found.' }, 404)

  await c.env.DB.prepare(
    `UPDATE organizations SET suspended_at = NULL, suspend_reason = '', archived_at = NULL WHERE id = ?`,
  ).bind(id).run()
  return c.json({ ok: true, organization: { id: org.id, name: org.name }, suspended: false })
})

// Relationship over. Sign-in refused, data kept — so it can still be exported
// or restored. This is the step before a purge, never a substitute for it.
app.post('/api/admin/organizations/:id/archive', async (c) => {
  if (!await requireSuperAdmin(c)) return c.json({ error: 'Not authorized.' }, 403)
  const id = c.req.param('id')

  const org = await c.env.DB.prepare('SELECT id, name FROM organizations WHERE id = ?')
    .bind(id).first<{ id: string; name: string }>()
  if (!org) return c.json({ error: 'Restaurant not found.' }, 404)

  await c.env.DB.prepare(`UPDATE organizations SET archived_at = datetime('now') WHERE id = ?`)
    .bind(id).run()
  return c.json({ ok: true, organization: { id: org.id, name: org.name }, archived: true })
})

// Every tenant table, for the purge below. Mirrors TENANT_TABLES in
// tests/org-scoping.test.mjs — if a table is added there it belongs here too,
// or a purge silently leaves that table's rows behind, still carrying the
// deleted customer's data.
const PURGE_TABLES = [
  'categories', 'certification_types', 'finished_product_items', 'finished_products',
  'generic_products', 'inventory', 'invoice_lines', 'invoices', 'item_placements',
  'labor_periods', 'operating_expenses',
  // Child before parent: pos_sale_lines.import_id references pos_imports(id).
  // The rest of this list is alphabetical and happens to satisfy that already
  // (recipe_items before recipes, stock_take_items before stock_takes); this
  // pair does not, so it is ordered by hand.
  'pos_sale_lines', 'pos_imports', 'pos_item_map',
  'product_aliases', 'product_entries', 'product_mappings',
  'recipe_items', 'recipes', 'recurring_expenses', 'sales_monthly', 'spread_expenses',
  'staff', 'staff_certifications', 'stock_log', 'stock_take_items', 'stock_takes',
  'storage_sections', 'suppliers', 'units', 'vendor_fee_templates',
]

// Irreversible. Guarded three ways, because the cost of doing this to the wrong
// row is a customer's entire business history:
//   1. the account must already be archived — you cannot purge a live customer
//   2. the caller must echo back the exact restaurant name
//   3. their uploaded files go too, or we keep paying to store documents
//      belonging to someone who is no longer a customer
app.delete('/api/admin/organizations/:id', async (c) => {
  if (!await requireSuperAdmin(c)) return c.json({ error: 'Not authorized.' }, 403)
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const typed = String(body.confirm_name || '').trim()

  const org = await c.env.DB.prepare('SELECT id, name, archived_at FROM organizations WHERE id = ?')
    .bind(id).first<{ id: string; name: string; archived_at: string | null }>()
  if (!org) return c.json({ error: 'Restaurant not found.' }, 404)
  if (!org.archived_at) {
    return c.json({ error: 'Close the account first. Only a closed account can be deleted.' }, 409)
  }
  if (typed !== org.name) {
    return c.json({ error: `Type the restaurant name exactly ("${org.name}") to confirm.` }, 400)
  }

  // Data first, org row last: if this fails part-way the account still exists
  // and is still archived, so it can be retried. Deleting the organization
  // first would strand every remaining row with no owner and no way to find it.
  for (const table of PURGE_TABLES) {
    await c.env.DB.prepare(`DELETE FROM ${table} WHERE org_id IS ?`).bind(id).run()
  }
  await c.env.DB.prepare('DELETE FROM invites WHERE org_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM users WHERE org_id = ?').bind(id).run()

  // Their invoice photos and certificates. R2 lists 1000 keys at a time.
  let filesDeleted = 0
  try {
    let cursor: string | undefined
    do {
      const listed = await c.env.FILES.list({ prefix: `uploads/${id}/`, cursor })
      if (listed.objects.length) {
        await c.env.FILES.delete(listed.objects.map(o => o.key))
        filesDeleted += listed.objects.length
      }
      cursor = listed.truncated ? listed.cursor : undefined
    } while (cursor)
  } catch (_) {
    // Rows are already gone; report the shortfall rather than failing the whole
    // purge, otherwise a retry would find nothing left to delete and 404.
    return c.json({ ok: true, deleted: org.name, files_deleted: filesDeleted,
                    warning: 'Data deleted, but some uploaded files could not be removed.' })
  }

  await c.env.DB.prepare('DELETE FROM organizations WHERE id = ?').bind(id).run()
  return c.json({ ok: true, deleted: org.name, files_deleted: filesDeleted })
})

// ══════════════════════════════════════════════════════════════
// ORG SCOPING — which business's data may this request touch?
// ══════════════════════════════════════════════════════════════
// Every tenant table carries org_id (migration 0035). Reads filter on it,
// writes stamp it. `tests/org-scoping.test.mjs` statically audits every SQL
// statement in this file and fails the build if one touches a tenant table
// without mentioning org_id — so a forgotten filter is caught mechanically
// rather than by review.
//
// Use `org_id IS ?` and NOT `org_id = ?`. SQLite's `=` never matches NULL, and
// NULL is a real value here: it means the super-admin's own pre-accounts data.
// `IS` is the NULL-safe comparison and binds parameters fine.
const VIEW_ORG_COOKIE = 'dm_view_org'

function orgOf(c: any): string | null {
  const user = c.get('user') as SessionUser | undefined
  if (!user) return null
  // A super-admin sees their own (NULL) data by default, or a customer's while
  // "viewing as" — they never need that customer's password to do it.
  if (user.role === 'super_admin') {
    return readCookie(c.req.header('cookie'), VIEW_ORG_COOKIE) || null
  }
  return user.org_id
}

// org_id is server-assigned, never client-supplied. Without this a customer
// could POST {"org_id": "<someone else's id>"} and write into their data.
function stripOrgId(body: Record<string, unknown>): Record<string, unknown> {
  const { org_id, ...rest } = body
  return rest
}

// ─── Generic table CRUD helper ────────────────────────────────
// GET /api/tables/:table  – list all rows (or filtered)
// GET /api/tables/:table/:id – get one
// POST /api/tables/:table – insert
// PUT /api/tables/:table/:id – replace
// PATCH /api/tables/:table/:id – partial update
// DELETE /api/tables/:table/:id – delete

const ALLOWED_TABLES = [
  'suppliers', 'generic_products', 'product_entries',
  'recipes', 'recipe_items', 'finished_products', 'finished_product_items',
  'inventory', 'stock_log', 'invoices', 'invoice_lines',
  'staff', 'certification_types', 'staff_certifications',
  'product_mappings', 'units', 'categories', 'product_aliases',
  'stock_takes', 'stock_take_items',
  'sales_monthly', 'operating_expenses', 'recurring_expenses', 'spread_expenses',
  'labor_periods',
  // No pos_* table is here, deliberately. Their rows carry money that feeds the
  // P&L and quantities that move stock, and every one of them is derived from an
  // uploaded file rather than typed. Generic POST/PATCH would let a client
  // fabricate an import's totals or rewrite a committed line, so they are served
  // only by the /api/pos-imports routes, which recompute from parsed_data.
]

// ── List / query
app.get('/api/tables/:table', async (c) => {
  const table = c.req.param('table')
  if (!ALLOWED_TABLES.includes(table)) return c.json({ error: 'Unknown table' }, 400)

  const { page, limit, ...filters } = c.req.query()
  const p = Math.max(1, parseInt(page || '1'))
  const l = Math.min(500, parseInt(limit || '500'))
  const offset = (p - 1) * l

  // Ownership filter first, so it can never be dropped by a later branch.
  // A client-supplied ?org_id= is ignored — ownership comes from the session.
  let where = 'WHERE org_id IS ?'
  const args: any[] = [orgOf(c)]

  const filterEntries = Object.entries(filters).filter(([k]) => k !== 'org_id')
  if (filterEntries.length) {
    where += ' AND ' + filterEntries.map(([k]) => `${k} = ?`).join(' AND ')
    filterEntries.forEach(([, v]) => args.push(v))
  }

  // Hide voided product entries by default — a voided invoice's purchases must
  // not count toward Latest Price / costing anywhere they're read. (Restore
  // clears the flag and they reappear.)
  if (table === 'product_entries') {
    where += ' AND voided_at IS NULL'
  }

  const rows = await c.env.DB.prepare(
    `SELECT * FROM ${table} ${where} ORDER BY rowid DESC LIMIT ? OFFSET ?`
  ).bind(...args, l, offset).all()

  return c.json({ data: rows.results, total: rows.results.length })
})

// ── Get one
app.get('/api/tables/:table/:id', async (c) => {
  const { table, id } = c.req.param()
  if (!ALLOWED_TABLES.includes(table)) return c.json({ error: 'Unknown table' }, 400)
  // Another org's row reports 404, not 403 — a different status would confirm
  // the id exists, which is itself a leak.
  const row = await c.env.DB.prepare(
    `SELECT * FROM ${table} WHERE id = ? AND org_id IS ?`,
  ).bind(id, orgOf(c)).first()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// Tables that use INTEGER PRIMARY KEY AUTOINCREMENT — don't inject a UUID id
const INTEGER_PK_TABLES = ['units', 'categories']

// ── Insert
app.post('/api/tables/:table', async (c) => {
  const table = c.req.param('table')
  if (!ALLOWED_TABLES.includes(table)) return c.json({ error: 'Unknown table' }, 400)
  const body = stripOrgId(await c.req.json() as Record<string, unknown>)
  if (!body.id && !INTEGER_PK_TABLES.includes(table)) body.id = uid()
  // Stamped from the session, after stripping any client-supplied value.
  body.org_id = orgOf(c)
  const keys = Object.keys(body)
  const vals = Object.values(body)
  const result = await c.env.DB.prepare(
    `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`
  ).bind(...vals).run()
  const insertedId = INTEGER_PK_TABLES.includes(table) ? result.meta.last_row_id : body.id
  return c.json({ id: insertedId, ...body }, 201)
})

// ── Replace (PUT)
app.put('/api/tables/:table/:id', async (c) => {
  const { table, id } = c.req.param()
  if (!ALLOWED_TABLES.includes(table)) return c.json({ error: 'Unknown table' }, 400)
  const body = stripOrgId(await c.req.json() as Record<string, unknown>)
  body.id = id
  const keys = Object.keys(body)
  const vals = Object.values(body)
  const setCols = keys.map(k => `${k} = ?`).join(', ')
  // org_id is in the WHERE, never the SET: a row cannot be moved between orgs.
  await c.env.DB.prepare(
    `UPDATE ${table} SET ${setCols} WHERE id = ? AND org_id IS ?`,
  ).bind(...vals, id, orgOf(c)).run()
  return c.json({ id, ...body })
})

// ── Partial update (PATCH)
app.patch('/api/tables/:table/:id', async (c) => {
  const { table, id } = c.req.param()
  if (!ALLOWED_TABLES.includes(table)) return c.json({ error: 'Unknown table' }, 400)
  const body = stripOrgId(await c.req.json() as Record<string, unknown>)
  const keys = Object.keys(body)
  if (!keys.length) return c.json({ error: 'No fields to update' }, 400)
  const setCols = keys.map(k => `${k} = ?`).join(', ')
  await c.env.DB.prepare(
    `UPDATE ${table} SET ${setCols} WHERE id = ? AND org_id IS ?`,
  ).bind(...Object.values(body), id, orgOf(c)).run()
  return c.json({ id, ...body })
})

// ── Delete generic_product → ARCHIVE (soft delete)
// Professional inventory software never hard-deletes a product that has history:
// stock movements, purchase entries and invoices reference it, and their
// stock_log rows must stay resolvable. Instead we mark the product deleted_at
// (it drops out of every active list, which filters `deleted_at IS NULL`) while
// preserving all historical/reference data:
//   • product_entries — kept linked (past purchases stay attached; reversible)
//   • recipe_items     — kept (don't silently alter recipes)
//   • stock_log        — untouched (the whole point: history survives)
// Only *live* state is cleared:
//   • inventory        — current stock removed (a discontinued item holds none;
//                        its movement history remains in stock_log)
//   • product_aliases  — removed so future invoices don't auto-relink to it
app.delete('/api/tables/generic_products/:id', async (c) => {
  const { id } = c.req.param()
  const org = orgOf(c)
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM product_aliases WHERE generic_product_id = ? AND org_id IS ?').bind(id, org),
    c.env.DB.prepare('DELETE FROM inventory WHERE item_id = ? AND org_id IS ?').bind(id, org),
    c.env.DB.prepare("UPDATE generic_products SET deleted_at = datetime('now') WHERE id = ? AND org_id IS ?").bind(id, org),
  ])
  return c.body(null, 204)
})

// PUT /api/generic_products/:id
// Update a product. The raw-material inventory row is always re-synced with the
// product's name + category (category is denormalized and matched by id, not
// name). Additionally, when the NAME changes, cascade it to every other place the
// product name is denormalized — otherwise those copies go stale and features
// that match by name (e.g. the spending breakdown joining invoice_lines to
// products) can no longer categorize them.
//   invoice_lines.product_name, product_entries.generic_product_name,
//   product_mappings.corrected_name, inventory.item_name, recipe_items.product_name,
//   stock_log.item_name
// A rename is a correction of the SAME item (matched by item_id here), so the
// stock log is kept in sync for consistency. (Deletion is different — there we
// keep stock_log as-is because the product row is gone and the stored name is
// the only remaining record of what the item was called.)
app.put('/api/generic_products/:id', async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json() as {
    name?: string; category?: string
    sub_unit_name?: string; sub_unit_qty?: number | null; avg_weight_per_unit?: number | null
    reorder_level?: number | null; reorder_unit?: string
    base_unit?: string; mid_name?: string; mid_lb?: number | null
    top_name?: string; top_lb?: number | null
  }
  const newName = (body.name || '').trim()
  if (!newName) return c.json({ error: 'name required' }, 400)

  const org = orgOf(c)
  const current = await c.env.DB.prepare('SELECT name FROM generic_products WHERE id = ? AND org_id IS ?')
    .bind(id, org).first<{ name: string }>()
  if (!current) return c.json({ error: 'Product not found' }, 404)
  const oldName = current.name

  await c.env.DB.prepare(
    `UPDATE generic_products
       SET name = ?, category = ?, sub_unit_name = ?, sub_unit_qty = ?, avg_weight_per_unit = ?,
           reorder_level = ?, reorder_unit = ?,
           base_unit = ?, mid_name = ?, mid_lb = ?, top_name = ?, top_lb = ?
     WHERE id = ? AND org_id IS ?`
  ).bind(
    newName,
    body.category ?? '',
    body.sub_unit_name ?? '',
    body.sub_unit_qty ?? null,
    body.avg_weight_per_unit ?? null,
    body.reorder_level ?? null,
    body.reorder_unit ?? '',
    body.base_unit ?? '',
    body.mid_name ?? '',
    body.mid_lb ?? null,
    body.top_name ?? '',
    body.top_lb ?? null,
    id,
    org
  ).run()

  // Always keep the raw-material inventory row in sync with the product's live
  // name AND category. Category is denormalized onto the inventory row and is
  // NOT matched by name anywhere, so it must be pushed here or the Inventory
  // page (badges + category chips) drifts from the Products page.
  await c.env.DB.prepare(
    "UPDATE inventory SET item_name = ?, category = ? WHERE item_id = ? AND item_type = 'raw_material' AND org_id IS ?"
  ).bind(newName, body.category ?? '', id, org).run()

  // Cascade the name only when it actually changed (ignoring case/space) to the
  // remaining tables where the name is denormalized. (inventory is handled above,
  // unconditionally, since it also carries category.)
  if (oldName.trim().toLowerCase() !== newName.toLowerCase()) {
    await c.env.DB.batch([
      // Each cascade is org-scoped: these match on NAME, so without the filter
      // renaming your "Olive Oil" would rewrite every other business's too.
      c.env.DB.prepare(
        'UPDATE product_entries SET generic_product_name = ? WHERE (generic_product_id = ? OR LOWER(TRIM(generic_product_name)) = LOWER(TRIM(?))) AND org_id IS ?'
      ).bind(newName, id, oldName, org),
      c.env.DB.prepare(
        'UPDATE invoice_lines SET product_name = ? WHERE LOWER(TRIM(product_name)) = LOWER(TRIM(?)) AND org_id IS ?'
      ).bind(newName, oldName, org),
      c.env.DB.prepare(
        'UPDATE product_mappings SET corrected_name = ? WHERE LOWER(TRIM(corrected_name)) = LOWER(TRIM(?)) AND org_id IS ?'
      ).bind(newName, oldName, org),
      c.env.DB.prepare(
        'UPDATE recipe_items SET product_name = ? WHERE product_id = ? AND org_id IS ?'
      ).bind(newName, id, org),
      c.env.DB.prepare(
        'UPDATE stock_log SET item_name = ? WHERE item_id = ? AND org_id IS ?'
      ).bind(newName, id, org),
    ])
  }

  return c.json({ id, name: newName })
})

// ── Delete
app.delete('/api/tables/:table/:id', async (c) => {
  const { table, id } = c.req.param()
  if (!ALLOWED_TABLES.includes(table)) return c.json({ error: 'Unknown table' }, 400)
  await c.env.DB.prepare(
    `DELETE FROM ${table} WHERE id = ? AND org_id IS ?`,
  ).bind(id, orgOf(c)).run()
  return c.body(null, 204)   // 204 No Content — must have no body
})

// ─── POS sales imports ────────────────────────────────────────
// A sales CSV is parsed in the browser (public/static/pos-parse.js) and lands
// here as JSON. This route saves it as a DRAFT — status 'Action Required', the
// whole payload in parsed_data — and pre-matches each POS menu item against the
// customer's recipes and finished products. Nothing derived is written until
// /commit, exactly as an invoice writes nothing until Confirm & Save.
//
// The pre-match runs here, on the server, because levenshtein/classifyNameMatch
// live in this file and there is no client copy. Duplicating them into
// public/static/ would create a fourth hand-synced table (after UNIT_FACTORS,
// DEFAULT_CATEGORIES and convertUnitCost), and those are already a maintenance
// tax we should not be raising.

type PosParsedItem = {
  pos_item_key: string
  pos_item_name: string
  price_point: string
  pos_category: string
  qty: number
  net_sales: number
  line_count: number
  // Filled in below.
  target_type?: string
  target_id?: string
  target_name?: string
  qty_per_sale?: number
  target_unit?: string
  match_source?: string
  suggested_type?: string
  suggested_id?: string
  suggested_name?: string
  suggested_score?: number
}

// Menu names are short and clustered, so a silent auto-match needs a longer
// name behind it than a supplier does. See classifyNameMatch.
const POS_AUTO_MIN_LEN = 8

// Ceiling on stock movements in one import before they are collapsed from
// per-ingredient-per-day to per-ingredient-per-import. Chosen to stay inside a
// single D1 batch alongside the sale lines, so the whole commit stays atomic.
const POS_MAX_MOVEMENTS = 1500

// A POS item may only resolve to a finished product, or be explicitly ignored.
// Enforced here rather than in the browser for the usual reason — the review
// screen posts its mapping decisions back and nothing stops a caller sending
// something else — and it also scrubs legacy `recipe` rules out of drafts saved
// before that was true. A scrubbed item lands as unmapped, which shows on the
// review screen as "Not linked" and asks for one click, instead of looking
// mapped while quietly moving no stock.
function sanitizePosTargets(items: any[]): any[] {
  for (const it of items || []) {
    const t = it && it.target_type
    if (t && t !== 'finished_product' && t !== 'ignore') {
      it.target_type = ''
      it.target_id   = ''
      it.target_name = ''
      it.match_source = 'stale'
    }
  }
  return items || []
}

app.post('/api/pos-imports', async (c) => {
  const org = orgOf(c)
  const body = await c.req.json().catch(() => ({})) as {
    parsed?: any; file_name?: string; file_key?: string; content_hash?: string; force?: boolean
  }
  const parsed = body.parsed
  if (!parsed || !Array.isArray(parsed.lines) || !parsed.lines.length) {
    return c.json({ error: 'No parsed sales data in that request.' }, 400)
  }

  const contentHash = String(body.content_hash || '').trim()

  // First duplicate guard: the identical file, uploaded twice. Never
  // intentional, but overridable — the same reasoning as the duplicate
  // invoice-number check, which warns rather than refuses outright.
  if (contentHash && !body.force) {
    const dup = await c.env.DB.prepare(
      `SELECT id, file_name, created_at, status FROM pos_imports
        WHERE org_id IS ? AND content_hash = ? AND voided_at IS NULL
        ORDER BY created_at DESC LIMIT 1`
    ).bind(org, contentHash).first<{ id: string; file_name: string; created_at: string; status: string }>()
    if (dup) {
      return c.json({
        duplicate: true, import_id: dup.id, file_name: dup.file_name,
        imported_at: dup.created_at, status: dup.status,
        error: 'You have already uploaded this exact file.',
      }, 409)
    }
  }

  // Candidates for mapping: the finished products the customer sells. Recipes
  // are deliberately not offered — a POS line is a thing sold over the counter,
  // which is a finished product. The recipes behind it are still reached, via
  // finished_product_items, when the sale is exploded.
  const [fpRows, mapRows] = await Promise.all([
    c.env.DB.prepare(`SELECT id, name FROM finished_products WHERE org_id IS ?`).bind(org).all(),
    c.env.DB.prepare(
      `SELECT pos_item_key, target_type, target_id, qty_per_sale, target_unit
         FROM pos_item_map WHERE org_id IS ? AND source = ?`
    ).bind(org, String(parsed.source || 'square')).all(),
  ])

  const fps    = (fpRows.results || []) as { id: string; name: string }[]
  const nameOf = new Map<string, string>()
  for (const f of fps) nameOf.set('finished_product:' + f.id, f.name)

  const learned = new Map<string, any>()
  for (const m of (mapRows.results || []) as any[]) learned.set(m.pos_item_key, m)

  // Candidates for fuzzy matching, tagged so the winner's kind is known.
  const candidates = fps.map(f => ({ id: 'finished_product:' + f.id, name: f.name }))

  const items = (parsed.items || []) as PosParsedItem[]
  let mappedNet = 0, unmappedNet = 0

  for (const it of items) {
    // Precedence, most specific first — the same shape as resolving a supplier
    // alias: an exact size rule, then the any-size rule, then a guess.
    const rule = learned.get(it.pos_item_key)
              || learned.get(String(it.pos_item_key).split('|')[0] + '|')

    if (rule) {
      it.target_type  = rule.target_type
      it.target_id    = rule.target_id
      it.target_name  = nameOf.get(rule.target_type + ':' + rule.target_id) || ''
      it.qty_per_sale = Number(rule.qty_per_sale) || 1
      it.target_unit  = rule.target_unit || ''
      it.match_source = 'remembered'
      // A remembered rule that no longer resolves is worse than no rule — it
      // would look mapped and deduct nothing. Two ways to get here: the target
      // was deleted, or it is a legacy `recipe` rule from when a sale could
      // point straight at a recipe. Both demote to unmapped so the reviewer
      // re-links them against a finished product.
      if (rule.target_type !== 'ignore' && !it.target_name) {
        it.target_type = ''; it.target_id = ''; it.match_source = 'stale'
      }
    } else if (candidates.length) {
      const m = classifyNameMatch(it.pos_item_name, candidates, POS_AUTO_MIN_LEN)
      if (m.decision === 'auto' && m.match) {
        const [kind, id] = m.match.id.split(':')
        it.target_type  = kind
        it.target_id    = id
        it.target_name  = m.match.name
        it.qty_per_sale = 1
        it.target_unit  = ''
        it.match_source = 'auto'
      } else if (m.decision === 'suggest' && m.match) {
        const [kind, id] = m.match.id.split(':')
        it.suggested_type  = kind
        it.suggested_id    = id
        it.suggested_name  = m.match.name
        it.suggested_score = Math.round(m.score * 100)
      }
    }

    const net = Number(it.net_sales) || 0
    if (it.target_type && it.target_type !== 'ignore') mappedNet += net
    else if (it.target_type !== 'ignore') unmappedNet += net
  }

  const totals = parsed.totals || {}
  const id = uid()
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings : []

  await c.env.DB.prepare(
    `INSERT INTO pos_imports
       (id, org_id, source, file_name, file_key, status, period_start, period_end,
        line_count, gross_total, discount_total, net_total, tax_total,
        mapped_net, unmapped_net, warning_count, parsed_data, content_hash)
     VALUES (?, ?, ?, ?, ?, 'Action Required', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, org, String(parsed.source || 'square'),
    String(body.file_name || parsed.file_name || ''), String(body.file_key || ''),
    String(parsed.period_start || ''), String(parsed.period_end || ''),
    parsed.lines.length,
    round2(Number(totals.gross) || 0), round2(Number(totals.discounts) || 0),
    round2(Number(totals.net) || 0), round2(Number(totals.tax) || 0),
    round2(mappedNet), round2(unmappedNet), warnings.length,
    JSON.stringify({ ...parsed, items }), contentHash,
  ).run()

  return c.json({
    ok: true, import_id: id,
    items, mapped_net: round2(mappedNet), unmapped_net: round2(unmappedNet),
    coverage: totals.net ? Math.round((mappedNet / Number(totals.net)) * 100) : 0,
  })
})

// The imports list. Its own route rather than generic CRUD so parsed_data — a
// blob the size of the CSV — never rides along with a list of twelve months.
app.get('/api/pos-imports', async (c) => {
  const org = orgOf(c)
  const rows = await c.env.DB.prepare(
    `SELECT id, source, file_name, status, period_start, period_end, line_count,
            gross_total, discount_total, net_total, tax_total, mapped_net,
            unmapped_net, warning_count, committed_at, voided_at, void_reason, created_at
       FROM pos_imports WHERE org_id IS ?
      ORDER BY period_start DESC, created_at DESC LIMIT 200`
  ).bind(org).all()
  return c.json({ data: rows.results || [] })
})

app.get('/api/pos-imports/:id', async (c) => {
  const org = orgOf(c)
  const row = await c.env.DB.prepare(
    `SELECT * FROM pos_imports WHERE id = ? AND org_id IS ?`
  ).bind(c.req.param('id'), org).first<any>()
  // Another org's import reports 404, not 403 — see the accounts invariants.
  if (!row) return c.json({ error: 'Import not found' }, 404)

  let parsed = null
  if (row.parsed_data) { try { parsed = JSON.parse(row.parsed_data) } catch (_) { parsed = null } }
  return c.json({ ...row, parsed_data: undefined, parsed })
})

// Committed lines. Read-only, and only through here — pos_sale_lines is not in
// ALLOWED_TABLES precisely so nothing else can reach it.
app.get('/api/pos-imports/:id/lines', async (c) => {
  const org = orgOf(c)
  const own = await c.env.DB.prepare(
    `SELECT id FROM pos_imports WHERE id = ? AND org_id IS ?`
  ).bind(c.req.param('id'), org).first<{ id: string }>()
  if (!own) return c.json({ error: 'Import not found' }, 404)

  const rows = await c.env.DB.prepare(
    `SELECT * FROM pos_sale_lines WHERE import_id = ? AND org_id IS ? ORDER BY sold_date, sold_time`
  ).bind(c.req.param('id'), org).all()
  return c.json({ data: rows.results || [] })
})

// Work out every stock movement an import would make, WITHOUT writing anything.
//
// /preview and /commit both call this, so the panel a user approves is produced
// by the code that then writes. Pack Run's preview recomputes independently of
// its confirm step and the two can disagree; that is a bug worth not repeating.
//
// Movements are aggregated per ingredient PER BUSINESS DAY, not per sale: five
// pizzas across eight ingredients is 40 rows a week, and a real restaurant doing
// 400 covers a day would bury its own stock history.
async function planPosDepletion(
  db: D1Database, org: string | null,
  lines: any[], itemsByKey: Map<string, any>
) {
  const ctx = await buildExplodeCtx(db, org)

  // day|item_type|item_id → accumulated deduction
  const agg = new Map<string, {
    sold_date: string; item_id: string; item_type: string; item_name: string
    qty: number; unit: string
  }>()
  const warnings: { kind: string; item_name: string; message: string }[] = []
  const notes = new Set<string>()
  const lineErrors = new Map<string, string>()   // pos_item_key → first error
  // Which POS items actually moved stock. Distinguishes "mapped and depleted"
  // from "mapped but the recipe is empty" — different problems, different fixes.
  const depletedKeys = new Set<string>()
  // Batch bin → running split, so one line per recipe is reported however many
  // sales it took to empty the tub.
  const batchSplit = new Map<string, FellThrough>()
  let mappedLines = 0, unmappedLines = 0

  // Oldest sale first. A batch bin is now spent down as the loop runs, so file
  // order would decide which DAY a tub ran dry and therefore which day its
  // ingredients came off instead. The totals are the same either way; the dates
  // are only right if the tub empties in the order the sales happened.
  const ordered = [...lines].sort((a, b) =>
    String(a.sold_date || '').localeCompare(String(b.sold_date || '')))

  for (const l of ordered) {
    const it = itemsByKey.get(l.pos_item_key)
    if (!it || !it.target_type || it.target_type === 'ignore' || !it.target_id) {
      unmappedLines++
      continue
    }
    mappedLines++

    const res = explodeSale(
      { type: it.target_type, id: it.target_id },
      Number(l.qty) || 0, Number(it.qty_per_sale) || 1, ctx
    )
    for (const n of res.notes) notes.add(n)
    if (res.errors.length && !lineErrors.has(l.pos_item_key)) {
      lineErrors.set(l.pos_item_key, res.errors[0])
    }

    if (res.deductions.length) depletedKeys.add(l.pos_item_key)

    for (const f of res.batchSplit) {
      const cur = batchSplit.get(f.item_name)
      if (cur && sameUnitName(cur.unit, f.unit)) {
        cur.from_bin = round6(cur.from_bin + f.from_bin)
        cur.from_raw = round6(cur.from_raw + f.from_raw)
      } else if (!cur) {
        batchSplit.set(f.item_name, { ...f })
      }
    }

    for (const d of res.deductions) {
      const key = `${l.sold_date}|${d.item_type}|${d.item_id}`
      const cur = agg.get(key)
      if (cur) {
        // Two lines can name the same ingredient in different units (a recipe in
        // g, a finished-product line in kg). Normalise onto whatever the first
        // one used; the bin conversion below handles the rest.
        if (sameUnitName(cur.unit, d.unit)) { cur.qty += d.qty }
        else {
          const conv = convertQty(d.qty, d.unit, cur.unit, null)
          if (conv.error) { agg.set(key + '|' + d.unit, { ...d, sold_date: l.sold_date }) }
          else cur.qty += conv.qty as number
        }
      } else {
        agg.set(key, { sold_date: l.sold_date, item_id: d.item_id, item_type: d.item_type,
                       item_name: d.item_name, qty: d.qty, unit: d.unit })
      }
    }
  }

  // Bind every deduction to the bin it will actually come out of. The rows came
  // with the ctx — takeFromBatch needed them before this loop could run, so
  // re-reading the table here would only risk the two views disagreeing.
  const bins = new Map<string, any>()
  for (const r of ctx.invRows) {
    const k = r.item_type + '|' + r.item_id
    if (!bins.has(k)) bins.set(k, r)   // first match wins, as findInvRow does
  }

  // Raw-material defaults for bins that do not exist yet, plus the average
  // weight that any each↔weight conversion depends on.
  const prodRows = await db.prepare(
    `SELECT id, name, base_unit, avg_weight_per_unit, category FROM generic_products WHERE org_id IS ?`
  ).bind(org).all()
  const products = new Map<string, any>()
  for (const p of (prodRows.results || []) as any[]) products.set(p.id, p)

  const movements: any[] = []
  for (const a of agg.values()) {
    const binKey = a.item_type + '|' + a.item_id
    const bin    = bins.get(binKey)
    const prod   = a.item_type === 'raw_material' ? products.get(a.item_id) : null
    const recipe = a.item_type === 'batch' ? ctx.recipes.get(a.item_id) : null

    // The bin's own unit is the unit of record. A bin that does not exist yet
    // takes the product's stocking unit, then the recipe's yield unit, then the
    // unit the BOM line was written in.
    const binUnit = (bin && bin.unit)
      || (prod && prod.base_unit)
      || (recipe && recipe.yield_unit)
      || (a.item_type === 'finished_product' ? 'Each' : a.unit)
      || 'kg'

    const avgW = prod && prod.avg_weight_per_unit ? Number(prod.avg_weight_per_unit) : null
    const conv = convertQty(a.qty, a.unit || binUnit, binUnit, avgW)
    if (conv.error) {
      // Drop THIS deduction only. The revenue side is unambiguous and useful on
      // its own, and refusing a whole shift because one product is missing an
      // average weight is the wrong trade. The import closes with a warning.
      warnings.push({ kind: 'unit', item_name: a.item_name, message: `${a.item_name}: ${conv.error}.` })
      continue
    }

    const qty = Math.round((conv.qty as number) * 1e6) / 1e6
    if (!(qty > 0)) continue

    movements.push({
      sold_date: a.sold_date,
      inventory_id: bin ? bin.id : '',
      item_id: a.item_id, item_type: a.item_type,
      item_name: bin ? bin.item_name : a.item_name,
      qty, unit: binUnit,
      bin_exists: !!bin,
      bin_start: bin ? Number(bin.quantity) || 0 : 0,
      category: (bin && bin.category)
        || (prod && prod.category)
        || (a.item_type === 'batch' ? 'Batch' : a.item_type === 'finished_product' ? 'Finished Product' : ''),
    })
  }

  for (const [key, msg] of lineErrors) {
    const it = itemsByKey.get(key)
    warnings.push({ kind: 'explode', item_name: (it && it.pos_item_name) || key, message: msg })
  }

  movements.sort((x, y) => (x.sold_date || '').localeCompare(y.sold_date || '')
                        || x.item_name.localeCompare(y.item_name))

  // A month of 60 ingredients over 30 days is 1,800 stock movements plus
  // everything else, which is more than one D1 batch should carry — and
  // chunking would give up the atomicity that makes this safe to void. So past
  // the threshold, collapse to one movement per ingredient for the whole
  // import. Degrade, don't fail.
  let collapsed = false
  if (movements.length > POS_MAX_MOVEMENTS) {
    const byBin = new Map<string, any>()
    for (const m of movements) {
      const k = m.item_type + '|' + m.item_id
      const cur = byBin.get(k)
      if (cur) { cur.qty = Math.round((cur.qty + m.qty) * 1e6) / 1e6; cur.sold_date = m.sold_date }
      else byBin.set(k, { ...m })
    }
    movements.length = 0
    movements.push(...byBin.values())
    collapsed = true
  }

  // Running balance per bin. Each movement has to see the ones before it, or a
  // bin that only goes negative on the fourth day would look fine on every row
  // and never reach bins_negative.
  const running = new Map<string, number>()
  for (const m of movements) {
    const k = m.item_type + '|' + m.item_id
    const before = running.has(k) ? running.get(k)! : m.bin_start
    const after  = Math.round((before - m.qty) * 1e6) / 1e6
    m.before = before
    m.after  = after
    running.set(k, after)
  }

  // Going negative is CORRECT for backflush — it reveals stock that was used but
  // never recorded as bought. It still needs saying out loud, because to anyone
  // seeing it for the first time it reads as a bug.
  const negative = [...running.entries()].filter(([, v]) => v < 0)
    .map(([k]) => (movements.find(m => m.item_type + '|' + m.item_id === k) || {}).item_name)
    .filter(Boolean)

  return {
    movements, warnings, notes: [...notes], collapsed, depletedKeys,
    mapped_lines: mappedLines, unmapped_lines: unmappedLines,
    // Only the recipes that actually ran short. A tub that covered everything is
    // the normal case and needs no explaining.
    fell_through: [...batchSplit.values()].filter(f => f.from_raw > 0),
    bins_negative: [...new Set(negative)],
    bins_created: [...new Set(movements.filter(m => !m.bin_exists)
      .map(m => m.item_type + '|' + m.item_id))].length,
  }
}

// What this import would do to stock. Writes nothing.
app.post('/api/pos-imports/:id/preview', async (c) => {
  const org = orgOf(c)
  const row = await c.env.DB.prepare(
    `SELECT id, status, parsed_data FROM pos_imports WHERE id = ? AND org_id IS ?`
  ).bind(c.req.param('id'), org).first<{ id: string; status: string; parsed_data: string }>()
  if (!row) return c.json({ error: 'Import not found' }, 404)
  if (!row.parsed_data) return c.json({ error: 'This import has already been committed.' }, 409)

  const body = await c.req.json().catch(() => ({})) as { items?: any[] }
  let parsed: any
  try { parsed = JSON.parse(row.parsed_data) } catch (_) { return c.json({ error: 'Could not read that import.' }, 500) }

  // Mapping decisions from the review screen win; the stored ones are the
  // fallback so a preview works before anything is touched.
  const items = sanitizePosTargets(
    Array.isArray(body.items) && body.items.length ? body.items : (parsed.items || [])
  )
  const byKey = new Map<string, any>()
  for (const it of items) byKey.set(it.pos_item_key, it)

  const plan = await planPosDepletion(c.env.DB, org, parsed.lines || [], byKey)
  return c.json({ ok: true, ...plan })
})

// Commit an import: write the sale lines, move the stock, remember the mappings.
//
// One DB.batch() for the lot. Stock and revenue arrive together or not at all —
// a half-applied import is the one state nobody could reason about afterwards.
app.post('/api/pos-imports/:id/commit', async (c) => {
  const org = orgOf(c)
  const importId = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as {
    items?: any[]; deplete?: boolean
  }

  const row = await c.env.DB.prepare(
    `SELECT id, source, status, parsed_data FROM pos_imports WHERE id = ? AND org_id IS ?`
  ).bind(importId, org).first<{ id: string; source: string; status: string; parsed_data: string }>()
  if (!row) return c.json({ error: 'Import not found' }, 404)
  // The same guard stock-take submit uses: a draft commits once.
  if (row.status !== 'Action Required') {
    return c.json({ error: 'This import has already been committed.' }, 409)
  }

  let parsed: any
  try { parsed = JSON.parse(row.parsed_data) } catch (_) {
    return c.json({ error: 'Could not read that import.' }, 500)
  }

  const items = sanitizePosTargets(
    Array.isArray(body.items) && body.items.length ? body.items : (parsed.items || [])
  )
  const byKey = new Map<string, any>()
  for (const it of items) byKey.set(it.pos_item_key, it)

  const allLines: any[] = parsed.lines || []

  // ── Duplicate lines ──────────────────────────────────────────
  // Exporting Jul 1–15 and then Jul 1–31 is the ordinary way this goes wrong,
  // and a file hash cannot catch it. The unique index on external_ref is the
  // backstop; this pre-query is what makes the overlap a SKIP rather than a
  // rollback, because D1's batch() is one transaction and a constraint error
  // would take the whole import down with it.
  const refs = allLines.map(l => String(l.external_ref || '')).filter(Boolean)
  const seen = new Set<string>()
  if (refs.length) {
    // Chunked: SQLite caps bound parameters, and a month of sales can be
    // thousands of refs.
    for (let i = 0; i < refs.length; i += 200) {
      const chunk = refs.slice(i, i + 200)
      const marks = chunk.map(() => '?').join(',')
      const found = await c.env.DB.prepare(
        `SELECT external_ref FROM pos_sale_lines
          WHERE org_id IS ? AND voided_at IS NULL AND external_ref IN (${marks})`
      ).bind(org, ...chunk).all()
      for (const r of (found.results || []) as any[]) seen.add(r.external_ref)
    }
  }

  const lines = allLines.filter(l => !(l.external_ref && seen.has(l.external_ref)))
  const skipped = allLines.length - lines.length
  if (!lines.length) {
    return c.json({
      ok: true, import_id: importId, lines_written: 0, skipped_duplicates: skipped,
      message: 'Every line in this file has already been imported. Nothing was changed.',
    })
  }

  const deplete = body.deplete !== false
  const plan = deplete
    ? await planPosDepletion(c.env.DB, org, lines, byKey)
    : { movements: [], warnings: [], notes: [], collapsed: false,
        depletedKeys: new Set<string>(), fell_through: [] as FellThrough[],
        mapped_lines: 0, unmapped_lines: lines.length, bins_negative: [], bins_created: 0 }

  const now = new Date().toISOString()
  const stmts: D1PreparedStatement[] = []

  // ── Sale lines ───────────────────────────────────────────────
  let mappedNet = 0, unmappedNet = 0
  const byMonth: Record<string, number> = {}

  for (const l of lines) {
    const it = byKey.get(l.pos_item_key) || {}
    const tType = it.target_type || ''
    const tId   = tType && tType !== 'ignore' ? (it.target_id || '') : ''
    const net   = Number(l.net_sales) || 0

    if (tType && tType !== 'ignore' && tId) mappedNet += net
    else if (tType !== 'ignore') unmappedNet += net

    const month = String(l.sold_date || '').slice(0, 7)
    if (month) byMonth[month] = round2((byMonth[month] || 0) + net)

    // Whether this line actually moved stock. Three states the UI has to tell
    // apart: not mapped, mapped but nothing came off (empty recipe, or a unit
    // that wouldn't convert), and mapped and depleted.
    const moved = deplete && plan.depletedKeys.has(l.pos_item_key) ? 1 : 0

    stmts.push(c.env.DB.prepare(
      `INSERT INTO pos_sale_lines
         (id, org_id, import_id, sold_date, sold_time, pos_item_name, pos_item_key,
          pos_category, pos_sku, price_point, modifiers, qty, gross_sales, discounts,
          net_sales, tax, target_type, target_id, target_name, qty_per_sale, target_unit,
          depleted, deplete_error, external_ref, external_txn)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      uid(), org, importId,
      String(l.sold_date || ''), String(l.sold_time || ''),
      String(l.pos_item_name || ''), String(l.pos_item_key || ''),
      String(l.pos_category || ''), String(l.pos_sku || ''), String(l.price_point || ''),
      String(l.modifiers || ''),
      Number(l.qty) || 0, Number(l.gross_sales) || 0, Number(l.discounts) || 0,
      net, Number(l.tax) || 0,
      tType, tId, String(it.target_name || ''),
      Number(it.qty_per_sale) || 1, String(it.target_unit || ''),
      tId ? moved : 0, '',
      String(l.external_ref || ''), String(l.external_txn || ''),
    ))
  }

  // ── Stock ────────────────────────────────────────────────────
  // Bins that don't exist yet are created here, with the id generated up front
  // so the stock_log row can point at it in the same batch.
  const newBinId = new Map<string, string>()
  for (const m of plan.movements) {
    const k = m.item_type + '|' + m.item_id
    if (!m.bin_exists && !newBinId.has(k)) {
      const id = uid()
      newBinId.set(k, id)
      stmts.push(c.env.DB.prepare(
        `INSERT INTO inventory (id, item_id, item_type, item_name, category, quantity, unit, lot_number, org_id)
         VALUES (?, ?, ?, ?, ?, 0, ?, '', ?)`
      ).bind(id, m.item_id, m.item_type, m.item_name, m.category || '', m.unit, org))
    }
  }

  // One UPDATE per bin, relative. Absolute (SET quantity = ?) would race a
  // Produce Batch running on another device mid-import.
  const perBin = new Map<string, { id: string; qty: number }>()
  for (const m of plan.movements) {
    const k = m.item_type + '|' + m.item_id
    const id = m.inventory_id || newBinId.get(k) || ''
    if (!id) continue
    const cur = perBin.get(k)
    if (cur) cur.qty = Math.round((cur.qty + m.qty) * 1e6) / 1e6
    else perBin.set(k, { id, qty: m.qty })
  }
  for (const b of perBin.values()) {
    // ROUND to 6dp: relative updates accumulate binary-float drift, and a bin
    // that reads 4.8999999999999995 instead of 4.9 looks broken in a stock take
    // even though it is off by 5e-16. Matches the 1e-6 rounding upsertInventory
    // already applies on the client.
    stmts.push(c.env.DB.prepare(
      `UPDATE inventory SET quantity = ROUND(quantity - ?, 6) WHERE id = ? AND org_id IS ?`
    ).bind(b.qty, b.id, org))
  }

  // One stock_log row per movement — per ingredient per business day, unless the
  // import was large enough to collapse. reason_code 'usage' is what makes this
  // show up in waste and variance reporting.
  for (const m of plan.movements) {
    const k = m.item_type + '|' + m.item_id
    const invId = m.inventory_id || newBinId.get(k) || ''
    stmts.push(c.env.DB.prepare(
      `INSERT INTO stock_log
         (id, inventory_id, item_id, item_type, item_name, change, reason, reason_code,
          note, lot_number, moved_at, org_id, pos_import_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'usage', ?, '', ?, ?, ?)`
    ).bind(
      uid(), invId, m.item_id, m.item_type, m.item_name, -m.qty,
      'Sales import',
      plan.collapsed
        ? `POS import ${parsed.period_start}..${parsed.period_end}`
        : `Sold on ${m.sold_date}`,
      m.sold_date ? `${m.sold_date}T12:00:00.000Z` : now,
      org, importId,
    ))
  }

  // ── Remember the mappings ────────────────────────────────────
  // So the next upload routes itself and the reviewer only sees what's new.
  const source = String(row.source || 'square')
  for (const it of items) {
    if (!it.target_type) continue
    if (it.match_source === 'remembered') continue      // already stored
    const key = it.all_sizes
      ? String(it.pos_item_key).split('|')[0] + '|'
      : String(it.pos_item_key)
    stmts.push(c.env.DB.prepare(
      `INSERT INTO pos_item_map
         (id, org_id, source, pos_item_key, pos_item_name, price_point,
          target_type, target_id, qty_per_sale, target_unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(COALESCE(org_id, ''), source, pos_item_key) DO UPDATE SET
         target_type = excluded.target_type,
         target_id   = excluded.target_id,
         qty_per_sale= excluded.qty_per_sale,
         target_unit = excluded.target_unit,
         updated_at  = datetime('now')`
    ).bind(
      uid(), org, source, key,
      String(it.pos_item_name || ''), it.all_sizes ? '' : String(it.price_point || ''),
      String(it.target_type), String(it.target_id || ''),
      Number(it.qty_per_sale) || 1, String(it.target_unit || ''),
    ))
  }

  // ── Close the import ─────────────────────────────────────────
  // parsed_data is cleared, which is what stops the review screen re-hydrating
  // a draft that has already been posted (invoices do the same).
  stmts.push(c.env.DB.prepare(
    `UPDATE pos_imports
        SET status = 'Closed', parsed_data = '', committed_at = ?,
            mapped_net = ?, unmapped_net = ?, warning_count = ?, line_count = ?
      WHERE id = ? AND org_id IS ?`
  ).bind(now, round2(mappedNet), round2(unmappedNet), plan.warnings.length,
         lines.length, importId, org))

  await c.env.DB.batch(stmts)

  return c.json({
    ok: true, import_id: importId,
    lines_written: lines.length, skipped_duplicates: skipped,
    revenue: { net: round2(mappedNet + unmappedNet), by_month: byMonth },
    movements: plan.movements.length, bins_created: plan.bins_created,
    bins_negative: plan.bins_negative, collapsed: plan.collapsed,
    warnings: plan.warnings, notes: plan.notes,
    fell_through: plan.fell_through,
    unmapped_net: round2(unmappedNet),
  })
})

// Void a committed import: reverse its stock and drop its revenue.
//
// Invoices only have a money side to reverse; this has a stock side too, which
// is what stock_log.pos_import_id is for — it says exactly which movements this
// import made, so they can be undone without guessing.
app.post('/api/pos-imports/:id/void', async (c) => {
  const org = orgOf(c)
  const importId = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as { reason?: string }

  const row = await c.env.DB.prepare(
    `SELECT id, status, voided_at FROM pos_imports WHERE id = ? AND org_id IS ?`
  ).bind(importId, org).first<{ id: string; status: string; voided_at: string | null }>()
  if (!row) return c.json({ error: 'Import not found' }, 404)
  if (row.voided_at) return c.json({ error: 'That import is already voided.' }, 409)
  if (row.status !== 'Closed') return c.json({ error: 'Only a committed import can be voided.' }, 409)

  // Its own movements only. Reversal rows are written with an empty
  // pos_import_id precisely so a second void cannot reverse the reversal.
  const moves = await c.env.DB.prepare(
    `SELECT id, inventory_id, item_id, item_type, item_name, change
       FROM stock_log WHERE pos_import_id = ? AND org_id IS ? AND change != 0`
  ).bind(importId, org).all()

  const now = new Date().toISOString()
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE pos_imports SET voided_at = ?, void_reason = ? WHERE id = ? AND org_id IS ?`
    ).bind(now, String(body.reason || '').trim(), importId, org),
    c.env.DB.prepare(
      `UPDATE pos_sale_lines SET voided_at = ? WHERE import_id = ? AND org_id IS ?`
    ).bind(now, importId, org),
  ]

  for (const m of (moves.results || []) as any[]) {
    // change is negative for a deduction, so subtracting it puts the stock back.
    stmts.push(c.env.DB.prepare(
      `UPDATE inventory SET quantity = ROUND(quantity - ?, 6) WHERE id = ? AND org_id IS ?`
    ).bind(m.change, m.inventory_id, org))
    stmts.push(c.env.DB.prepare(
      `INSERT INTO stock_log
         (id, inventory_id, item_id, item_type, item_name, change, reason, reason_code,
          note, lot_number, moved_at, org_id, pos_import_id)
       VALUES (?, ?, ?, ?, ?, ?, 'Sales import voided', 'correction', ?, '', ?, ?, '')`
    ).bind(uid(), m.inventory_id, m.item_id, m.item_type, m.item_name, -m.change,
           `Reversal of sales import ${importId}`, now, org))
  }

  await c.env.DB.batch(stmts)
  return c.json({ ok: true, voided: true, movements_reversed: (moves.results || []).length })
})

// Restore a voided import: re-apply exactly what it originally did.
app.post('/api/pos-imports/:id/restore', async (c) => {
  const org = orgOf(c)
  const importId = c.req.param('id')

  const row = await c.env.DB.prepare(
    `SELECT id, voided_at FROM pos_imports WHERE id = ? AND org_id IS ?`
  ).bind(importId, org).first<{ id: string; voided_at: string | null }>()
  if (!row) return c.json({ error: 'Import not found' }, 404)
  if (!row.voided_at) return c.json({ error: 'That import is not voided.' }, 409)

  const moves = await c.env.DB.prepare(
    `SELECT inventory_id, item_id, item_type, item_name, change
       FROM stock_log WHERE pos_import_id = ? AND org_id IS ? AND change != 0`
  ).bind(importId, org).all()

  const now = new Date().toISOString()
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE pos_imports SET voided_at = NULL, void_reason = '' WHERE id = ? AND org_id IS ?`
    ).bind(importId, org),
    c.env.DB.prepare(
      `UPDATE pos_sale_lines SET voided_at = NULL WHERE import_id = ? AND org_id IS ?`
    ).bind(importId, org),
  ]

  for (const m of (moves.results || []) as any[]) {
    stmts.push(c.env.DB.prepare(
      `UPDATE inventory SET quantity = ROUND(quantity + ?, 6) WHERE id = ? AND org_id IS ?`
    ).bind(m.change, m.inventory_id, org))
    stmts.push(c.env.DB.prepare(
      `INSERT INTO stock_log
         (id, inventory_id, item_id, item_type, item_name, change, reason, reason_code,
          note, lot_number, moved_at, org_id, pos_import_id)
       VALUES (?, ?, ?, ?, ?, ?, 'Sales import restored', 'correction', ?, '', ?, ?, '')`
    ).bind(uid(), m.inventory_id, m.item_id, m.item_type, m.item_name, m.change,
           `Restore of sales import ${importId}`, now, org))
  }

  await c.env.DB.batch(stmts)
  return c.json({ ok: true, restored: true, movements_reapplied: (moves.results || []).length })
})

// A draft has produced nothing — no lines, no stock, no revenue — so it is the
// one thing here that is genuinely deletable. Committed imports void instead.
app.delete('/api/pos-imports/:id', async (c) => {
  const org = orgOf(c)
  const row = await c.env.DB.prepare(
    `SELECT id, status FROM pos_imports WHERE id = ? AND org_id IS ?`
  ).bind(c.req.param('id'), org).first<{ id: string; status: string }>()
  if (!row) return c.json({ error: 'Import not found' }, 404)
  if (row.status !== 'Action Required') {
    return c.json({ error: 'This import has already been committed. Void it instead.' }, 409)
  }
  await c.env.DB.prepare(`DELETE FROM pos_imports WHERE id = ? AND org_id IS ?`)
    .bind(row.id, org).run()
  return c.body(null, 204)
})

// POST /api/invoices/:id/void
// Soft-void a posted invoice: it's kept and restorable, but drops out of the
// active list and is excluded from P&L/spending. Standard for a financial doc —
// never hard-delete a posted invoice. (Drafts still use plain DELETE.)
app.post('/api/invoices/:id/void', async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json().catch(() => ({})) as { reason?: string }
  const reason = (body.reason || '').trim()
  const org = orgOf(c)
  const inv = await c.env.DB.prepare('SELECT id FROM invoices WHERE id = ? AND org_id IS ?')
    .bind(id, org).first<{ id: string }>()
  if (!inv) return c.json({ error: 'Invoice not found' }, 404)
  const now = new Date().toISOString()
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE invoices SET voided_at = datetime('now'), void_reason = ? WHERE id = ? AND org_id IS ?"
    ).bind(reason, id, org),
    // Reverse the money side: flag the purchase entries this invoice created so
    // they stop counting toward Latest Price / price-movers / costing.
    c.env.DB.prepare(
      "UPDATE product_entries SET voided_at = datetime('now') WHERE invoice_id = ? AND org_id IS ?"
    ).bind(id, org),
  ])
  return c.json({ id, voided_at: now, void_reason: reason })
})

// POST /api/invoices/:id/restore — un-void: back into the active list and P&L,
// and un-flag the purchase entries so cost history counts again.
app.post('/api/invoices/:id/restore', async (c) => {
  const { id } = c.req.param()
  const org = orgOf(c)
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE invoices SET voided_at = NULL, void_reason = '' WHERE id = ? AND org_id IS ?"
    ).bind(id, org),
    c.env.DB.prepare(
      "UPDATE product_entries SET voided_at = NULL WHERE invoice_id = ? AND org_id IS ?"
    ).bind(id, org),
  ])
  return c.json({ id, voided_at: null, void_reason: '' })
})

// ─── File Upload (R2) ─────────────────────────────────────────
// POST /api/upload  → multipart/form-data: field "file"
// Returns: { key, url, name, size, type }
// R2 has no per-row ownership, so the owner is encoded in the key itself:
//   uploads/<orgSegment>/<uid>.<ext>
// Reads verify that segment against the caller. Keys written before accounts
// existed have no segment (uploads/<uid>.<ext>) and belong to the super-admin,
// which is correct — all of them are Simone's.
const SUPER_SEGMENT = '_super'

function orgSegment(org: string | null): string {
  return org || SUPER_SEGMENT
}

function orgFromKey(key: string): string | null {
  const parts = String(key || '').split('/')
  if (parts.length >= 3 && parts[0] === 'uploads') {
    return parts[1] === SUPER_SEGMENT ? null : parts[1]
  }
  return null   // legacy, pre-accounts key
}

app.post('/api/upload', async (c) => {
  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  if (!file) return c.json({ error: 'No file provided' }, 400)

  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
  const key = `uploads/${orgSegment(orgOf(c))}/${uid()}.${ext}`

  await c.env.FILES.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
    customMetadata: { originalName: file.name }
  })

  return c.json({
    key,
    name: file.name,
    size: file.size,
    type: file.type,
    url: `/api/files/${key}`
  })
})

// ─── File Download (R2) ───────────────────────────────────────
app.get('/api/files/:prefix{.+}', async (c) => {
  const key = c.req.param('prefix')

  // Ownership check BEFORE the fetch. An invoice photo is as sensitive as the
  // invoice row it belongs to — prices, volumes, suppliers are all legible on
  // it. 404 rather than 403 so the response doesn't confirm the key exists.
  if (orgFromKey(key) !== orgOf(c)) return c.json({ error: 'File not found' }, 404)

  const obj = await c.env.FILES.get(key)
  if (!obj) return c.json({ error: 'File not found' }, 404)

  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  const originalName = obj.customMetadata?.originalName
  if (originalName) {
    headers.set('Content-Disposition', `inline; filename="${originalName}"`)
  }
  return new Response(obj.body, { headers })
})

// ─── Invoice lines: bulk replace all lines for one invoice ──────
// POST /api/invoice-lines/:invoice_id/replace
// Body: { lines: [...], tax_pst, tax_gst, delivery, credit, other_cost, other_desc }
// Deletes all existing lines for the invoice, inserts the new set,
// and updates the extra cost fields on the invoices row.
app.post('/api/invoice-lines/:invoice_id/replace', async (c) => {
  const invoiceId = c.req.param('invoice_id')
  const body = await c.req.json() as {
    lines: Record<string, unknown>[]
    tax_pst?: number; tax_gst?: number; delivery?: number; deposit?: number
    credit?: number; other_cost?: number; other_desc?: string
  }

  const org = orgOf(c)
  // Confirm the invoice belongs to this business before touching its lines —
  // otherwise the delete-then-insert below would rewrite someone else's invoice.
  const owner = await c.env.DB.prepare(
    'SELECT id FROM invoices WHERE id = ? AND org_id IS ?'
  ).bind(invoiceId, org).first()
  if (!owner) return c.json({ error: 'Invoice not found' }, 404)

  // Delete existing lines
  await c.env.DB.prepare('DELETE FROM invoice_lines WHERE invoice_id = ? AND org_id IS ?').bind(invoiceId, org).run()

  // Insert new lines
  for (const line of (body.lines || [])) {
    const id = uid()
    const qty   = parseFloat(line.qty   as string) || 0
    const price = parseFloat(line.price as string) || 0
    await c.env.DB.prepare(
      `INSERT INTO invoice_lines (id, invoice_id, product_name, vendor_item, category, item_code, packaging, price, qty, line_total, org_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, invoiceId,
      (line.product_name as string) || '',
      (line.vendor_item  as string) || '',
      (line.category     as string) || '',
      (line.item_code    as string) || '',
      (line.packaging    as string) || '',
      price, qty,
      parseFloat(line.line_total as string) || (price * qty),
      org
    ).run()
  }

  // Update extra cost fields on invoice
  await c.env.DB.prepare(
    `UPDATE invoices SET tax_pst=?, tax_gst=?, delivery=?, fuel_surcharge=0, deposit=?, credit=?, other_cost=?, other_desc=? WHERE id=? AND org_id IS ?`
  ).bind(
    body.tax_pst    ?? 0,
    body.tax_gst    ?? 0,
    body.delivery   ?? 0,
    body.deposit    ?? 0,
    body.credit     ?? 0,
    body.other_cost ?? 0,
    body.other_desc ?? '',
    invoiceId,
    org
  ).run()

  return c.json({ saved: (body.lines || []).length })
})

// ─── Vendor Fee Templates ──────────────────────────────────────
// GET  /api/vendor-fee-template?vendor=NAME  — fetch template for a vendor
// POST /api/vendor-fee-template              — upsert template for a vendor

app.get('/api/vendor-fee-template', async (c) => {
  const vendor = (c.req.query('vendor') || '').trim()
  if (!vendor) return c.json({ error: 'vendor required' }, 400)
  const row = await c.env.DB.prepare(
    `SELECT * FROM vendor_fee_templates WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?)) AND org_id IS ?`
  ).bind(vendor, orgOf(c)).first()
  if (!row) return c.json({ found: false })
  return c.json({ found: true, template: row })
})

app.post('/api/vendor-fee-template', async (c) => {
  const body = await c.req.json() as {
    vendor_name: string
    delivery?: number; fuel_surcharge?: number
    tax_gst?: number; tax_pst?: number
    other_cost?: number; other_desc?: string
    use_percent?: number; notes?: string
  }
  if (!body.vendor_name?.trim()) return c.json({ error: 'vendor_name required' }, 400)

  const org = orgOf(c)
  // Per business: two restaurants can both buy from "Sysco" and keep their own
  // fee template for it.
  const existing = await c.env.DB.prepare(
    `SELECT id FROM vendor_fee_templates WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?)) AND org_id IS ?`
  ).bind(body.vendor_name.trim(), org).first<{ id: string }>()

  const now = new Date().toISOString()
  if (existing) {
    await c.env.DB.prepare(
      `UPDATE vendor_fee_templates SET
         delivery=?, fuel_surcharge=?, tax_gst=?, tax_pst=?,
         other_cost=?, other_desc=?, use_percent=?, notes=?, updated_at=?
       WHERE id=? AND org_id IS ?`
    ).bind(
      body.delivery       ?? 0,
      body.fuel_surcharge ?? 0,
      body.tax_gst        ?? 0,
      body.tax_pst        ?? 0,
      body.other_cost     ?? 0,
      body.other_desc     ?? '',
      body.use_percent    ?? 0,
      body.notes          ?? '',
      now,
      existing.id,
      org
    ).run()
    return c.json({ saved: true, id: existing.id, created: false })
  } else {
    const id = uid()
    await c.env.DB.prepare(
      `INSERT INTO vendor_fee_templates
         (id, vendor_name, delivery, fuel_surcharge, tax_gst, tax_pst,
          other_cost, other_desc, use_percent, notes, updated_at, org_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id, body.vendor_name.trim(),
      body.delivery       ?? 0,
      body.fuel_surcharge ?? 0,
      body.tax_gst        ?? 0,
      body.tax_pst        ?? 0,
      body.other_cost     ?? 0,
      body.other_desc     ?? '',
      body.use_percent    ?? 0,
      body.notes          ?? '',
      now,
      org
    ).run()
    return c.json({ saved: true, id, created: true })
  }
})

// ─── Ensure invoice record exists for a file attachment ────────
// POST /api/ensure-invoice
// Body: { file_key, file_name, vendor?, invoice_number?, invoice_date?, total?,
//         tax_gst?, tax_pst?, delivery?, credit?, other_cost?, other_desc? }
// If an invoice with this file_key already exists, returns it.
// Otherwise creates a new "In Processing" invoice record.
app.post('/api/ensure-invoice', async (c) => {
  const body = await c.req.json() as {
    file_key: string; file_name?: string
    vendor?: string; invoice_number?: string
    invoice_date?: string; total?: number
    tax_gst?: number; tax_pst?: number; delivery?: number; deposit?: number
    credit?: number; other_cost?: number; other_desc?: string
  }
  if (!body.file_key) return c.json({ error: 'file_key required' }, 400)

  const today = new Date().toISOString().slice(0, 10)

  // Check if invoice already exists for this file_key
  const org = orgOf(c)
  const existing = await c.env.DB.prepare(
    `SELECT id FROM invoices WHERE file_key = ? AND org_id IS ?`
  ).bind(body.file_key, org).first<{ id: string }>()

  if (existing) {
    return c.json({ id: existing.id, created: false })
  }

  // Create new invoice record (including extra cost fields)
  const invoiceId = uid()
  await c.env.DB.prepare(
    `INSERT INTO invoices (id, vendor, invoice_number, invoice_date, upload_date, total,
       status, payment_account, file_name, file_key, file_url, notes,
       tax_gst, tax_pst, delivery, fuel_surcharge, deposit, credit, other_cost, other_desc,
       org_id)
     VALUES (?, ?, ?, ?, ?, ?, 'In Processing', 'A/P', ?, ?, ?, '',
             ?, ?, ?, 0, ?, ?, ?, ?, ?)`
  ).bind(
    invoiceId,
    body.vendor         || '',
    body.invoice_number || '',
    body.invoice_date   || today,
    today,
    body.total          ?? 0,
    body.file_name      || '',
    body.file_key,
    `/api/files/${body.file_key}`,
    body.tax_gst    ?? 0,
    body.tax_pst    ?? 0,
    body.delivery   ?? 0,
    body.deposit    ?? 0,
    body.credit     ?? 0,
    body.other_cost ?? 0,
    body.other_desc || '',
    org
  ).run()

  return c.json({ id: invoiceId, created: true })
})


// POST /api/suppliers/match
// Classify a candidate vendor name against existing suppliers.
// Body: { name }  →  { decision: 'auto'|'suggest'|'none', match: {id,name}|null, score }
// Used by the invoice review modal to auto-correct or suggest a supplier name.
app.post('/api/suppliers/match', async (c) => {
  const body = await c.req.json() as { name?: string }
  const name = (body.name || '').trim()
  if (!name) return c.json({ decision: 'none', match: null, score: 0 })

  // Exact (case/space-insensitive) match short-circuits — nothing to correct.
  const org = orgOf(c)
  const exact = await c.env.DB.prepare(
    `SELECT id, name FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND org_id IS ?`
  ).bind(name, org).first<{ id: string; name: string }>()
  if (exact) return c.json({ decision: 'exact', match: exact, score: 1 })

  // Fuzzy matching must only consider THIS business's suppliers, or an invoice
  // could be auto-corrected to a vendor name belonging to another restaurant.
  const all = await c.env.DB.prepare(`SELECT id, name FROM suppliers WHERE org_id IS ?`)
    .bind(org).all<{ id: string; name: string }>()
  return c.json(classifyNameMatch(name, all.results || []))
})

// PUT /api/suppliers/:id
// Update a supplier and, when the name changes, cascade it to every place the
// name is denormalized so the rename shows up everywhere:
//   product_entries.supplier_name, invoices.vendor,
//   product_mappings.vendor_name, vendor_fee_templates.vendor_name
app.put('/api/suppliers/:id', async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json() as { name?: string; contact?: string; email?: string; notes?: string }
  const newName = (body.name || '').trim()
  if (!newName) return c.json({ error: 'name required' }, 400)

  const org = orgOf(c)
  const current = await c.env.DB.prepare('SELECT name FROM suppliers WHERE id = ? AND org_id IS ?')
    .bind(id, org).first<{ name: string }>()
  if (!current) return c.json({ error: 'Supplier not found' }, 404)
  const oldName = current.name

  // Update the supplier row itself
  await c.env.DB.prepare(
    'UPDATE suppliers SET name = ?, contact = ?, email = ?, notes = ? WHERE id = ? AND org_id IS ?'
  ).bind(newName, body.contact ?? '', body.email ?? '', body.notes ?? '', id, org).run()

  // Cascade only when the name actually changed (ignoring case/space)
  if (oldName.trim().toLowerCase() !== newName.toLowerCase()) {
    await c.env.DB.batch([
      // Name-matched, so org-scoped: renaming your "Sysco" must not rewrite
      // another restaurant's invoices and purchase history.
      c.env.DB.prepare(
        'UPDATE product_entries SET supplier_name = ? WHERE (supplier_id = ? OR LOWER(TRIM(supplier_name)) = LOWER(TRIM(?))) AND org_id IS ?'
      ).bind(newName, id, oldName, org),
      c.env.DB.prepare(
        'UPDATE invoices SET vendor = ? WHERE LOWER(TRIM(vendor)) = LOWER(TRIM(?)) AND org_id IS ?'
      ).bind(newName, oldName, org),
      c.env.DB.prepare(
        'UPDATE product_mappings SET vendor_name = ? WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?)) AND org_id IS ?'
      ).bind(newName, oldName, org),
    ])

    // vendor_fee_templates.vendor_name is UNIQUE — renaming into an existing
    // one would violate the constraint, so drop the old row in that case.
    const clashTmpl = await c.env.DB.prepare(
      'SELECT id FROM vendor_fee_templates WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?)) AND org_id IS ?'
    ).bind(newName, org).first<{ id: string }>()
    if (clashTmpl) {
      await c.env.DB.prepare(
        'DELETE FROM vendor_fee_templates WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?)) AND org_id IS ?'
      ).bind(oldName, org).run()
    } else {
      await c.env.DB.prepare(
        'UPDATE vendor_fee_templates SET vendor_name = ? WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?)) AND org_id IS ?'
      ).bind(newName, oldName, org).run()
    }
  }

  return c.json({ id, name: newName, contact: body.contact ?? '', email: body.email ?? '', notes: body.notes ?? '' })
})

// POST /api/bulk/upsert-products
// Smart upsert: find-or-create supplier by name, find-or-create generic_product by name,
// then ALWAYS create a new product_entry (each purchase is its own record).
// Body: {
//   vendor_name?: string,           // invoice vendor — supplier will be auto-created if new
//   products: [{ name, brand, sku, pack_size, cost, expiry_date, invoice_ref, category }]
// }
// Returns: { saved, created_generics, reused_generics, supplier_id, supplier_name, supplier_created }
app.post('/api/bulk/upsert-products', async (c) => {
  const body = await c.req.json() as {
    vendor_name?: string
    products: Record<string, unknown>[]
  }
  if (!Array.isArray(body.products)) return c.json({ error: 'products array required' }, 400)

  // ── Guard: reject unit-less / unrecognised pack sizes before writing ──
  // A pack size with no unit of measure ("2" instead of "2 kg") would be
  // silently stored as "each" with a meaningless cost_per_unit, breaking Price
  // Movers, recipe costing and FIFO. A unit that isn't in the org's master list
  // ("1 ct") is the same failure wearing a disguise — it stores a token nothing
  // downstream can convert or compare. Fail fast, name the offenders, and write
  // nothing — the invoice review UI blocks both, so this is defense-in-depth.
  const knownUnits = await loadKnownUnits(c.env.DB, orgOf(c))
  const unitless: string[] = []
  const unknownUnits: Array<{ name: string; unit: string }> = []
  for (const p of body.products) {
    const name = String(p.name || '').trim()
    if (!name) continue
    const packSize = String(p.pack_size || '')
    if (!packSizeHasUnit(packSize)) unitless.push(name)
    else if (!packSizeUnitIsKnown(packSize, knownUnits)) {
      unknownUnits.push({ name, unit: parsePackSize(packSize).packUnit })
    }
  }
  if (unitless.length || unknownUnits.length) {
    const parts: string[] = []
    if (unitless.length) {
      parts.push(
        `Missing a unit of measure: ${unitless.join(', ')}. `
        + `Set a unit (e.g. kg, L, each) before saving.`
      )
    }
    if (unknownUnits.length) {
      parts.push(
        `Unrecognised unit of measure: `
        + `${unknownUnits.map(u => `${u.name} ("${u.unit}")`).join(', ')}. `
        + `Pick a unit from the list, or add it via Manage Units first.`
      )
    }
    return c.json({
      error: parts.join(' '),
      unitless,
      unknown_units: unknownUnits,
    }, 400)
  }

  // ── Step 0: Find-or-create the supplier ──────────────────────
  let supplierId   = ''
  let supplierName = ''
  let supplierCreated = false

  const org = orgOf(c)
  const vendorName = (body.vendor_name || '').trim()
  if (vendorName) {
    let existingSupplier = await c.env.DB.prepare(
      `SELECT id, name FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND org_id IS ?`
    ).bind(vendorName, org).first<{ id: string; name: string }>()

    // No exact match: fuzzy-match against existing suppliers and reuse one for
    // near-identical names (auto tier) so a punctuation/typo variation doesn't
    // spawn a duplicate. Looser "suggest"-tier matches are left to the review UI.
    if (!existingSupplier) {
      const all = await c.env.DB.prepare(`SELECT id, name FROM suppliers WHERE org_id IS ?`)
        .bind(org).all<{ id: string; name: string }>()
      const m = classifyNameMatch(vendorName, all.results || [])
      if (m.decision === 'auto' && m.match) existingSupplier = m.match
    }

    if (existingSupplier) {
      supplierId   = existingSupplier.id
      supplierName = existingSupplier.name
    } else {
      // Auto-create the supplier from the invoice vendor name
      supplierId   = uid()
      supplierName = vendorName
      await c.env.DB.prepare(
        `INSERT INTO suppliers (id, name, contact, email, notes, org_id) VALUES (?, ?, '', '', '', ?)`
      ).bind(supplierId, vendorName, org).run()
      supplierCreated = true
    }
  }

  let saved = 0, createdGenerics = 0, reusedGenerics = 0

  // Products created in THIS request whose category was guessed rather than
  // supplied. They get one batched AI pass after the loop; see
  // aiCategorizeProducts(). Collected instead of asked per-product so an invoice
  // introducing eight new items costs one call, not eight.
  const guessedCategories: Array<{ id: string; name: string }> = []

  for (const p of body.products) {
    const name = (p.name as string || '').trim()
    if (!name) continue

    // Split pack_size string into pack_qty + pack_unit, handling complex formats:
    //   "500g"        → 500, "g"
    //   "2 kg"        → 2, "kg"
    //   "12 LB"       → 12, "LB"
    //   "1 × 1.89L"   → 1.89, "L"    (multiplied: 1 × 1.89)
    //   "6 x 100OZ"   → 600, "OZ"   (multiplied: 6 × 100)
    //   "1/5 KG CS"   → 5, "KG"     (fraction notation: qty/size UNIT)
    //   "12 Each"     → 12, "Each"
    // Parsed up here rather than beside the entry insert below because a product
    // created on this line needs its stocking unit declared at creation time.
    const { packQty, packUnit } = parsePackSize((p.pack_size as string) || '')

    // 1. Find existing generic_product by name (case-insensitive, skip soft-deleted)
    // The product's OWN name comes back too: when a line matches via an alias,
    // the entry must be stored under the product's name, not the vendor's
    // wording — product_entries.generic_product_name is what Price Movers and
    // the product views display. The vendor's wording is kept in
    // vendor_item_name below, so nothing is lost.
    let existing = await c.env.DB.prepare(
      `SELECT id, name FROM generic_products WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND deleted_at IS NULL AND org_id IS ?`
    ).bind(name, org).first<{ id: string; name: string }>()

    // 1b. Not found by name — try the aliases, most specific rule first.
    //
    //   a) an alias registered for THIS supplier ("Grape Tomatoes" from
    //      Neptune means my Small Tomatoes), then
    //   b) a global alias (supplier_id IS NULL) — how every alias behaved
    //      before migration 0033, and what a merge still leaves behind.
    //
    // Supplier-specific wins so two vendors can use the same wording for
    // different items without one silently mislinking to the other.
    if (!existing && supplierId) {
      // Both sides of the join are filtered: an alias row and the product it
      // points at must belong to this business.
      const scoped = await c.env.DB.prepare(
        `SELECT pa.generic_product_id AS id, gp.name AS name FROM product_aliases pa
         JOIN generic_products gp ON gp.id = pa.generic_product_id
         WHERE LOWER(TRIM(pa.alias_name)) = LOWER(TRIM(?))
           AND pa.supplier_id = ?
           AND gp.deleted_at IS NULL
           AND pa.org_id IS ? AND gp.org_id IS ?`
      ).bind(name, supplierId, org, org).first<{ id: string; name: string }>()
      if (scoped) existing = scoped
    }
    if (!existing) {
      const aliasMatch = await c.env.DB.prepare(
        `SELECT pa.generic_product_id AS id, gp.name AS name FROM product_aliases pa
         JOIN generic_products gp ON gp.id = pa.generic_product_id
         WHERE LOWER(TRIM(pa.alias_name)) = LOWER(TRIM(?))
           AND pa.supplier_id IS NULL
           AND gp.deleted_at IS NULL
           AND pa.org_id IS ? AND gp.org_id IS ?`
      ).bind(name, org, org).first<{ id: string; name: string }>()
      if (aliasMatch) existing = aliasMatch
    }

    // The name this purchase is filed under: the matched product's own name, or
    // the invoice's wording when we're creating a new product from it.
    const canonicalName = existing?.name?.trim() || name

    let genericId: string
    if (existing) {
      genericId = existing.id
      reusedGenerics++
    } else {
      genericId = uid()
      // Treat the generic placeholders ('Other' now, 'Ingredients' legacy) as
      // "no real category given" and infer a specific one from the name instead.
      const providedCategory = (p.category as string || '').trim()
      const isPlaceholder = !providedCategory || providedCategory === 'Ingredients' || providedCategory === 'Other'
      const category = isPlaceholder ? inferCategory(name) : providedCategory
      await c.env.DB.prepare(
        `INSERT INTO generic_products (id, name, category, sub_unit_name, sub_unit_qty, base_unit, org_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        genericId,
        name,
        category,
        (p.sub_unit_name as string) || '',
        p.sub_unit_qty ?? null,
        stockUnitFor(packUnit),
        org
      ).run()
      createdGenerics++
      // Only when WE guessed. A category the user picked in the review screen is
      // an instruction, not a gap to fill, and the model does not get to
      // overrule it.
      if (isPlaceholder) guessedCategories.push({ id: genericId, name })
    }

    // 2. Always add a new product_entry for this purchase
    const entryId = uid()
    const today   = new Date().toISOString().slice(0, 10)
    const cost        = parseFloat(p.cost as string) || 0
    const qtyOrdered  = parseFloat(p.qty  as string) || 1
    const costPerUnit = unitCostFrom(cost, packQty, qtyOrdered)

    // Calculate days_left from expiry_date
    let daysLeftVal: number | null = null
    if (p.expiry_date) {
      const exp = new Date(p.expiry_date as string)
      const now = new Date(); now.setHours(0, 0, 0, 0)
      daysLeftVal = Math.floor((exp.getTime() - now.getTime()) / 86400000)
    }

    // Use supplier from batch vendor_name; fall back to per-row supplier fields if provided
    const rowSupplierId   = (p.supplier_id   as string) || supplierId
    const rowSupplierName = (p.supplier_name as string) || supplierName

    await c.env.DB.prepare(
      `INSERT INTO product_entries
         (id, generic_product_id, generic_product_name, supplier_id, supplier_name,
          vendor_item_name, sku, pack_qty, pack_unit, cost, cost_per_unit,
          purchase_date, expiry_date, days_left, invoice_ref,
          invoice_id, invoice_file_key, invoice_file_name, qty_ordered, org_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      entryId, genericId, canonicalName,
      rowSupplierId, rowSupplierName,
      (p.vendor_item_name as string) || name,
      (p.sku as string) || '',
      packQty, packUnit,
      cost, costPerUnit,
      (p.invoice_date as string) || (p.purchase_date as string) || today,
      (p.expiry_date as string) || '',
      daysLeftVal,
      (p.invoice_ref as string) || '',
      (p.invoice_id as string) || '',
      (p.invoice_file_key as string) || '',
      (p.invoice_file_name as string) || '',
      qtyOrdered,
      org
    ).run()

    saved++
  }

  // ── Categorise the new products, once, in one call ───────────
  // Deliberately after every write above: the products already exist with their
  // keyword category, so if this throws, times out, or the key is dead, the save
  // still succeeded and the only cost is a rougher category the user can edit.
  // The alternative — categorising before the insert — would let a failing
  // Anthropic call block a customer from saving an invoice.
  let aiCategorized = 0
  if (guessedCategories.length) {
    const picked = await aiCategorizeProducts(c.env, org, guessedCategories.map(g => g.name))
    const updates = guessedCategories
      .map(g => ({ g, cat: picked.get(g.name.toLowerCase()) }))
      .filter(u => !!u.cat)
      .map(u => c.env.DB.prepare(
        `UPDATE generic_products SET category = ? WHERE id = ? AND org_id IS ?`,
      ).bind(u.cat, u.g.id, org))
    if (updates.length) {
      await c.env.DB.batch(updates)
      aiCategorized = updates.length
    }
  }

  return c.json({
    saved,
    created_generics:  createdGenerics,
    reused_generics:   reusedGenerics,
    ai_categorized:    aiCategorized,
    supplier_id:       supplierId,
    supplier_name:     supplierName,
    supplier_created:  supplierCreated,
  })
})

// ─── Unit conversion (backend) ────────────────────────────────
// Suppliers invoice the same item in different units — one bills potatoes in
// kg, another in lb (see migration 0032). Anything that COMPARES prices across
// purchases has to express them in one unit first, or a supplier switch reads
// as a ~120% price move.
//
// NOTE: this mirrors invConvertQty()'s factor table in public/static/utils.js.
// The worker bundle can't import from public/ (it's served as static assets,
// not bundled), so the table exists twice by necessity. Keep them in sync.
const UNIT_FACTORS: Record<string, { dim: 'weight' | 'volume'; factor: number }> = {
  kg:  { dim: 'weight', factor: 1 },
  g:   { dim: 'weight', factor: 0.001 },
  lb:  { dim: 'weight', factor: 0.45359237 },
  lbs: { dim: 'weight', factor: 0.45359237 },
  oz:  { dim: 'weight', factor: 0.0283495231 },   // WEIGHT ounce; fluid ounce is 'fl oz'
  l:   { dim: 'volume', factor: 1 },
  ml:  { dim: 'volume', factor: 0.001 },
  'fl oz': { dim: 'volume', factor: 0.0295735296 },
  gal: { dim: 'volume', factor: 3.78541178 },
}

function unitInfo(u: string) {
  return UNIT_FACTORS[String(u || '').trim().toLowerCase()] || null
}
function sameUnitName(a: string, b: string) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
}
function isEachUnit(u: string) {
  const s = String(u || '').trim().toLowerCase()
  return s === 'each' || s === 'ea' || s === 'unit'
}

// Convert a PER-UNIT COST between units ($1.50/lb → $3.31/kg).
// Returns null when the units aren't comparable — callers must then skip the
// comparison rather than treating the raw numbers as equivalent.
function convertUnitCost(
  cost: number, fromUnit: string, toUnit: string, avgWeightKg: number | null
): number | null {
  if (!(cost > 0)) return null
  if (sameUnitName(fromUnit, toUnit)) return cost

  const from = unitInfo(fromUnit)
  const to   = unitInfo(toUnit)

  // $/each → $/weight, via the product's average weight per each.
  if (isEachUnit(fromUnit) && to && to.dim === 'weight') {
    if (!avgWeightKg || avgWeightKg <= 0) return null
    return (cost / avgWeightKg) * to.factor
  }
  // $/weight → $/each.
  if (from && from.dim === 'weight' && isEachUnit(toUnit)) {
    if (!avgWeightKg || avgWeightKg <= 0) return null
    return (cost / from.factor) * avgWeightKg
  }
  // Same dimension: $/to = $/from × (from per to).
  if (from && to && from.dim === to.dim) {
    return cost * (to.factor / from.factor)
  }
  return null
}

// Convert a QUANTITY between units — the reciprocal of convertUnitCost above,
// and the server-side twin of invConvertQty in public/static/utils.js. KEEP THE
// TWO IN SYNC: same table, same each↔weight rules, same refusals. The worker
// bundle cannot import from public/, which is why this pair exists at all (the
// same reason UNIT_FACTORS is duplicated).
//
// Returns { qty } or { error }. It never guesses: a pair it cannot bridge is an
// error, because silently treating 250 g as 250 kg would wreck a stock figure
// in a way nobody would spot until a stock take months later.
function convertQty(
  qty: number, fromUnit: string, toUnit: string, avgWeightKg: number | null
): { qty: number; error?: undefined } | { qty?: undefined; error: string } {
  if (sameUnitName(fromUnit, toUnit)) return { qty }

  const from = unitInfo(fromUnit)
  const to   = unitInfo(toUnit)

  // each → weight, via the product's average weight per each (stored in kg).
  if (isEachUnit(fromUnit) && to && to.dim === 'weight') {
    if (!avgWeightKg || avgWeightKg <= 0) {
      return { error: `stocked in ${toUnit} but the recipe calls for ${fromUnit} — set an Average Weight per Unit on the product` }
    }
    return { qty: (qty * avgWeightKg) / to.factor }
  }
  // weight → each.
  if (from && from.dim === 'weight' && isEachUnit(toUnit)) {
    if (!avgWeightKg || avgWeightKg <= 0) {
      return { error: `stocked in ${toUnit} but the recipe calls for ${fromUnit} — set an Average Weight per Unit on the product` }
    }
    return { qty: (qty * from.factor) / avgWeightKg }
  }
  // Same dimension (kg↔g, L↔ml, …).
  if (from && to && from.dim === to.dim) {
    return { qty: qty * (from.factor / to.factor) }
  }
  // Weight↔volume is deliberately not bridged: it needs a density this app does
  // not hold, and a wrong density is worse than a refusal.
  return { error: `cannot convert ${fromUnit} to ${toUnit}` }
}

// ─── Sales explosion (backflush) ──────────────────────────────
// Given "this menu item sold N times", work out what comes off the shelf.
//
// The bill of materials is exactly two levels deep and cannot be deeper:
// finished_product_items may reference a recipe or a product, but recipe_items
// has no item_type column, so a recipe holds only products. The depth guard
// below is therefore unreachable today — it exists so that if recipe_items ever
// gains an item_type, the failure is a loud error and not an infinite loop.
//
// Everything it needs is passed in, and units are left as the BOM wrote them —
// binding a deduction to the unit its inventory bin is actually held in happens
// later, against the bins themselves. The one exception, and it is deliberate:
// a batched line spends down ctx.batchRemaining, so calls within one import are
// ordered and NOT independent. See takeFromBatch.

type Deduction = {
  item_id: string
  item_type: 'raw_material' | 'batch' | 'finished_product'
  item_name: string
  qty: number
  unit: string
}

type ExplodeCtx = {
  recipes:     Map<string, { id: string; name: string; servings: number; yield_unit: string; production_mode: string }>
  recipeItems: Map<string, { product_id: string; product_name: string; quantity: number; unit: string }[]>
  fpItems:     Map<string, { item_type: string; ref_id: string; ref_name: string; quantity: number; unit: string }[]>
  // MUTABLE. How much of each batch bin is still unspent as this import is
  // planned — see takeFromBatch. It has to be a running balance and not a
  // per-sale lookup of the same figure: a tub holding 6 kg against ten sales of
  // 1 kg would otherwise satisfy all ten from a tub that ran dry at the sixth.
  batchRemaining: Map<string, { qty: number; unit: string }>
  // Every inventory row for the org, read once here so planPosDepletion does not
  // read the same table a second time to bind its movements.
  invRows: any[]
}

type FellThrough = { item_name: string; from_bin: number; from_raw: number; unit: string }

// One entry per batched line, whether or not the tub covered it. Only the
// recipes that ran short are worth telling anyone about, but the covered lines
// have to be counted too or the "came out of stock" half of the message reads
// as zero — the tub does its work on the early sales and runs dry on the late
// ones, so the shortfall lines alone know nothing about what it did cover.
type ExplodeOut = { deductions: Deduction[]; errors: string[]; notes: string[]; batchSplit: FellThrough[] }

// Split one sale's demand for a batched recipe between the batch bin and the
// raw ingredients underneath it.
//
// THE RULE: take it from the tub if the tub has it, otherwise take the
// ingredients. This is what makes Produce Batch optional rather than mandatory,
// and it is arithmetically safe in both directions — an empty tub means nobody
// ever declared that production, which means its raw materials never left the
// shelf, so taking them now is the only entry that ISN'T double-counting.
//
// Before this, a `batched` recipe always deducted the tub whether or not the tub
// existed. Whoever forgot to press Produce Batch got a bin running further and
// further negative while their ingredients never moved at all — food cost
// reading better than reality, silently, which is the failure this whole file
// is written to avoid.
//
// Mutates ctx.batchRemaining: the amount taken here must not be available to the
// next sale in the same import.
function takeFromBatch(
  recipeId: string, want: number, wantUnit: string, ctx: ExplodeCtx
): { fromBin: number; shortfall: number; unit: string } {
  const bin = ctx.batchRemaining.get(recipeId)

  // No bin at all — nothing was ever produced into it. Everything falls through.
  if (!bin) return { fromBin: 0, shortfall: want, unit: wantUnit }

  const unit = bin.unit || wantUnit
  const conv = convertQty(want, wantUnit || unit, unit, null)
  if (conv.error) {
    // The two can't be compared, so they can't be split. Fall back to the
    // behaviour that predates this function — the whole line on the tub — rather
    // than guessing a split. Deducting raw materials on a bad comparison would
    // be the double-count this is meant to prevent.
    return { fromBin: want, shortfall: 0, unit: wantUnit }
  }

  const need    = conv.qty as number
  const avail   = Math.max(0, Number(bin.qty) || 0)
  const fromBin = Math.min(avail, need)
  bin.qty = round6(avail - fromBin)

  return { fromBin: round6(fromBin), shortfall: round6(need - fromBin), unit }
}

function round6(n: number) {
  return Math.round((Number(n) || 0) * 1e6) / 1e6
}

function explodeRecipe(
  recipeId: string, amount: number, amountUnit: string,
  ctx: ExplodeCtx, depth: number, out: ExplodeOut
) {
  if (depth > 1) { out.errors.push('Recipe nesting deeper than two levels is not supported.'); return }
  const r = ctx.recipes.get(recipeId)
  if (!r) { out.errors.push('A recipe used by this item no longer exists.'); return }

  const yieldUnit = r.yield_unit || 'kg'
  const servings  = Number(r.servings) || 1

  // Same arithmetic as Produce Batch, inverted: sell N portions, then produce N
  // portions, and stock is back where it started.
  const conv = convertQty(amount, amountUnit || yieldUnit, yieldUnit, null)
  if (conv.error) { out.errors.push(`${r.name}: ${conv.error}`); return }
  const scale = (conv.qty as number) / servings

  const lines = ctx.recipeItems.get(recipeId) || []
  if (!lines.length) { out.notes.push(`${r.name} has no ingredients, so nothing came off stock for it.`); return }

  for (const ri of lines) {
    const q = (Number(ri.quantity) || 0) * scale
    if (!(q > 0)) continue
    out.deductions.push({
      item_id: ri.product_id, item_type: 'raw_material',
      item_name: ri.product_name, qty: q, unit: ri.unit || '',
    })
  }
}

// A sale always resolves to a finished product. `explodeRecipe` below is still
// very much in use — it is how a finished product made of recipes reaches its
// raw materials — but a POS item can no longer point straight at a recipe.
function explodeSale(
  target: { type: string; id: string },
  soldQty: number, qtyPerSale: number, ctx: ExplodeCtx
): ExplodeOut {
  const out: ExplodeOut = { deductions: [], errors: [], notes: [], batchSplit: [] }
  const units = (Number(soldQty) || 0) * (Number(qtyPerSale) || 1)
  if (!(units > 0)) return out

  if (target.type === 'finished_product') {
    const lines = ctx.fpItems.get(target.id) || []
    if (!lines.length) { out.notes.push('That finished product has no ingredients listed.'); return out }

    for (const line of lines) {
      const lineQty = (Number(line.quantity) || 0) * units
      if (!(lineQty > 0)) continue

      if (line.item_type === 'recipe') {
        const r = ctx.recipes.get(line.ref_id)
        const mode = r ? (r.production_mode || 'on_demand') : 'on_demand'
        if (mode === 'ignore') {
          out.notes.push(`${line.ref_name} is set to never come off stock.`)
        } else if (mode === 'batched') {
          // THE ANTI-DOUBLE-COUNT BRANCH. This recipe is produced ahead into a
          // batch bin, so the sale consumes that bin first. Produce Batch is what
          // turns raw ingredients into it, and exploding a covered portion here
          // as well would count every tomato twice.
          //
          // Whatever the bin CANNOT cover was never declared as produced, so its
          // raw materials are still on the shelf and have to come off now. See
          // takeFromBatch.
          const take = takeFromBatch(line.ref_id, lineQty, line.unit || '', ctx)

          if (take.fromBin > 0) {
            out.deductions.push({
              item_id: line.ref_id, item_type: 'batch',
              item_name: line.ref_name, qty: take.fromBin, unit: take.unit,
            })
          }
          if (take.shortfall > 0) {
            explodeRecipe(line.ref_id, take.shortfall, take.unit, ctx, 1, out)
          }
          // Recorded on every batched line, covered or not — see the note on
          // ExplodeOut. Reported, never silent: to anyone watching, a batch bin
          // and its ingredients both moving looks exactly like double-counting,
          // and a commissary needs the shortfall as the signal that production
          // went unrecorded.
          out.batchSplit.push({
            item_name: line.ref_name, from_bin: take.fromBin,
            from_raw: take.shortfall, unit: take.unit,
          })
        } else {
          explodeRecipe(line.ref_id, lineQty, line.unit || '', ctx, 1, out)
        }
      } else {
        // 'product' in finished_product_items is 'raw_material' in inventory —
        // two different namespaces for item_type. Pack Run maps them the same way.
        out.deductions.push({
          item_id: line.ref_id, item_type: 'raw_material',
          item_name: line.ref_name, qty: lineQty, unit: line.unit || '',
        })
      }
    }
    return out
  }

  // Anything else (notably a legacy `recipe` target) deducts nothing. It is
  // reported rather than silently skipped, because a line that looks mapped and
  // moves no stock is the failure mode this whole screen exists to prevent.
  if (target.type) {
    out.errors.push('This item is linked to a recipe. Re-link it to a finished product.')
  }
  return out
}

// What a counted thing is MADE OF, in raw materials, all the way down.
//
// Deliberately NOT explodeSale. That one answers "where should this stock come
// from", so it respects production_mode and takes a batched recipe out of its
// bin instead of exploding it. This answers "what is physically inside this",
// which has exactly one answer however the kitchen chose to make it — a tub of
// sauce on the shelf is worth its tomatoes whether or not anyone ever pressed
// Produce Batch.
//
// Used to value stock-take counts. Counting a packed product AND the batch it
// was made from is not double counting: they are two different things sitting on
// two different shelves, and both are stock on hand.
function explodeToRawMaterials(
  itemType: string, itemId: string, qty: number, unit: string, ctx: ExplodeCtx
): Deduction[] {
  const out: ExplodeOut = { deductions: [], errors: [], notes: [], batchSplit: [] }
  if (!(qty > 0)) return []

  if (itemType === 'batch') {
    explodeRecipe(itemId, qty, unit || '', ctx, 1, out)
  } else if (itemType === 'finished_product') {
    // qty is a count of units, as it is for a sale.
    for (const line of (ctx.fpItems.get(itemId) || [])) {
      const lineQty = (Number(line.quantity) || 0) * qty
      if (!(lineQty > 0)) continue
      if (line.item_type === 'recipe') {
        explodeRecipe(line.ref_id, lineQty, line.unit || '', ctx, 1, out)
      } else {
        out.deductions.push({
          item_id: line.ref_id, item_type: 'raw_material',
          item_name: line.ref_name, qty: lineQty, unit: line.unit || '',
        })
      }
    }
  }

  // A recipe or product that has since been deleted simply contributes nothing;
  // explodeRecipe records that in out.errors, which a valuation has no way to
  // show. Undervaluing one line beats failing a whole P&L.
  return out.deductions.filter(d => d.item_type === 'raw_material')
}

// Load every recipe, recipe line, finished-product line and inventory bin for
// one org, keyed for explodeSale. One read for the whole import rather than per
// sale line.
async function buildExplodeCtx(db: D1Database, org: string | null): Promise<ExplodeCtx> {
  const [recipeRows, recipeItemRows, fpItemRows, invRowsRes] = await Promise.all([
    db.prepare(`SELECT id, name, servings, yield_unit, production_mode FROM recipes WHERE org_id IS ?`).bind(org).all(),
    db.prepare(`SELECT recipe_id, product_id, product_name, quantity, unit FROM recipe_items WHERE org_id IS ?`).bind(org).all(),
    db.prepare(`SELECT finished_product_id, item_type, ref_id, ref_name, quantity, unit FROM finished_product_items WHERE org_id IS ?`).bind(org).all(),
    db.prepare(`SELECT id, item_id, item_type, item_name, quantity, unit, category FROM inventory WHERE org_id IS ?`).bind(org).all(),
  ])

  const recipes = new Map<string, any>()
  for (const r of (recipeRows.results || []) as any[]) recipes.set(r.id, r)

  const recipeItems = new Map<string, any[]>()
  for (const ri of (recipeItemRows.results || []) as any[]) {
    if (!recipeItems.has(ri.recipe_id)) recipeItems.set(ri.recipe_id, [])
    recipeItems.get(ri.recipe_id)!.push(ri)
  }

  const fpItems = new Map<string, any[]>()
  for (const fi of (fpItemRows.results || []) as any[]) {
    if (!fpItems.has(fi.finished_product_id)) fpItems.set(fi.finished_product_id, [])
    fpItems.get(fi.finished_product_id)!.push(fi)
  }

  // Opening balance of every batch bin, which takeFromBatch then spends down as
  // the import is planned. First match wins, as findInvRow does.
  const invRows = (invRowsRes.results || []) as any[]
  const batchRemaining = new Map<string, { qty: number; unit: string }>()
  for (const r of invRows) {
    if (r.item_type !== 'batch' || batchRemaining.has(r.item_id)) continue
    batchRemaining.set(r.item_id, { qty: Number(r.quantity) || 0, unit: r.unit || '' })
  }

  return { recipes, recipeItems, fpItems, batchRemaining, invRows }
}

// ─── Product combine helpers (shared by Merge and Group) ──────
// Combine one product's data into another: re-link purchase history, pool
// inventory, re-link recipes, cascade the surviving name to every denormalized
// copy, then soft-delete the absorbed product. Extracted so Merge (duplicates)
// and Group (interchangeable items) stay identical under the hood — including
// the full name cascade.
// `org` is threaded through rather than filtered at the call site: every
// statement below matches on id OR name, so an unscoped one would rewrite
// another business's history.
// `aliasName` (Group only) is the absorbed product's name, remembered so future
// invoices using that wording route into the survivor. It is written inside the
// same transaction as the merge, so an absorbed product can never end up live
// history-less AND un-aliased.
async function mergeInto(
  db: D1Database,
  merged: { id: string; name: string },
  surviving: { id: string; name: string },
  org: string | null,
  aliasName?: string | null
) {
  // Reads first, then every write in ONE db.batch(), which D1 runs as a single
  // transaction: a merge either lands in full or not at all. This used to be
  // five separate awaits, and when one failed the earlier ones had already
  // committed — the purchase history moved to the survivor while the absorbed
  // product stayed live, empty and un-aliased, with the user shown only a 500.
  const mergedInv = await db.prepare('SELECT id, quantity FROM inventory WHERE item_id = ? AND org_id IS ?')
    .bind(merged.id, org).first<{ id: string; quantity: number }>()
  const survivingInv = mergedInv
    ? await db.prepare('SELECT id FROM inventory WHERE item_id = ? AND org_id IS ?')
        .bind(surviving.id, org).first<{ id: string }>()
    : null
  const alias    = (aliasName || '').trim()
  const aliasDup = alias
    ? await db.prepare(
        'SELECT id FROM product_aliases WHERE generic_product_id = ? AND LOWER(TRIM(alias_name)) = LOWER(TRIM(?)) AND supplier_id IS NULL AND org_id IS ?'
      ).bind(surviving.id, alias, org).first()
    : null

  const writes: D1PreparedStatement[] = []

  // 1. Re-link product_entries (the purchase/cost history)
  writes.push(db.prepare(
    'UPDATE product_entries SET generic_product_id = ?, generic_product_name = ? WHERE generic_product_id = ? AND org_id IS ?'
  ).bind(surviving.id, surviving.name, merged.id, org))

  // 2. Merge inventory rows (pool the stock into one bin)
  if (mergedInv && survivingInv) {
    writes.push(
      db.prepare('UPDATE inventory SET quantity = quantity + ? WHERE item_id = ? AND org_id IS ?')
        .bind(mergedInv.quantity, surviving.id, org),
      db.prepare('DELETE FROM inventory WHERE item_id = ? AND org_id IS ?')
        .bind(merged.id, org),
    )
  } else if (mergedInv) {
    // No surviving inventory row — reassign the merged row
    writes.push(db.prepare('UPDATE inventory SET item_id = ?, item_name = ? WHERE item_id = ? AND org_id IS ?')
      .bind(surviving.id, surviving.name, merged.id, org))
  }

  // 3. Re-link recipe_items
  writes.push(db.prepare('UPDATE recipe_items SET product_id = ?, product_name = ? WHERE product_id = ? AND org_id IS ?')
    .bind(surviving.id, surviving.name, merged.id, org))

  // 3b. Cascade the surviving identity to the remaining tables where the merged
  // product's name/id is denormalized (invoice_lines, product_mappings, stock_log).
  // Without this the absorbed rows keep the old name and stock_log keeps pointing
  // at the now-deleted product id, so spending breakdown / stock history drift.
  //
  // invoice_lines is matched BY NAME ONLY — it stores the line as read off the
  // invoice and has no product id column (see migrations 0002 and 0035). An
  // earlier version of this cascade also set `invoice_lines.generic_product_id`,
  // which has never existed, so every Merge and Group failed here. Nothing
  // anywhere reads such a column; the name is the whole link. Matches
  // cascadeRename below, which has always done it this way.
  writes.push(
    db.prepare('UPDATE invoice_lines SET product_name = ? WHERE LOWER(TRIM(product_name)) = LOWER(TRIM(?)) AND org_id IS ?')
      .bind(surviving.name, merged.name, org),
    db.prepare('UPDATE product_mappings SET corrected_name = ? WHERE LOWER(TRIM(corrected_name)) = LOWER(TRIM(?)) AND org_id IS ?')
      .bind(surviving.name, merged.name, org),
    db.prepare('UPDATE stock_log SET item_id = ?, item_name = ? WHERE item_id = ? AND org_id IS ?')
      .bind(surviving.id, surviving.name, merged.id, org),
  )

  // 4. Soft-delete the merged product
  writes.push(db.prepare("UPDATE generic_products SET deleted_at = datetime('now') WHERE id = ? AND org_id IS ?")
    .bind(merged.id, org))

  // 5. Group only: the alias for the absorbed name.
  if (alias && !aliasDup && alias.toLowerCase() !== surviving.name.trim().toLowerCase()) {
    writes.push(db.prepare(
      'INSERT INTO product_aliases (id, alias_name, generic_product_id, supplier_id, org_id) VALUES (?, ?, ?, NULL, ?)'
    ).bind(uid(), alias, surviving.id, org))
  }

  await db.batch(writes)
}

// Rename a product and cascade the new name to every denormalized copy. Name-only
// (does not touch category/units), used by Group when it renames the survivor to
// the umbrella name. Mirrors the cascade inside PUT /api/generic_products/:id.
async function cascadeRename(db: D1Database, id: string, oldName: string, newName: string, org: string | null) {
  await db.prepare('UPDATE generic_products SET name = ? WHERE id = ? AND org_id IS ?').bind(newName, id, org).run()
  await db.prepare("UPDATE inventory SET item_name = ? WHERE item_id = ? AND item_type = 'raw_material' AND org_id IS ?")
    .bind(newName, id, org).run()
  if (oldName.trim().toLowerCase() !== newName.trim().toLowerCase()) {
    await db.batch([
      db.prepare('UPDATE product_entries SET generic_product_name = ? WHERE (generic_product_id = ? OR LOWER(TRIM(generic_product_name)) = LOWER(TRIM(?))) AND org_id IS ?')
        .bind(newName, id, oldName, org),
      db.prepare('UPDATE invoice_lines SET product_name = ? WHERE LOWER(TRIM(product_name)) = LOWER(TRIM(?)) AND org_id IS ?')
        .bind(newName, oldName, org),
      db.prepare('UPDATE product_mappings SET corrected_name = ? WHERE LOWER(TRIM(corrected_name)) = LOWER(TRIM(?)) AND org_id IS ?')
        .bind(newName, oldName, org),
      db.prepare('UPDATE recipe_items SET product_name = ? WHERE product_id = ? AND org_id IS ?').bind(newName, id, org),
      db.prepare('UPDATE stock_log SET item_name = ? WHERE item_id = ? AND org_id IS ?').bind(newName, id, org),
    ])
  }
}

// ─── Product Merge (duplicates) ───────────────────────────────
// POST /api/products/merge  Body: { merged_id, surviving_id }
// Folds an accidental duplicate into another product (see mergeInto).
app.post('/api/products/merge', async (c) => {
  const body = await c.req.json() as { merged_id: string; surviving_id: string }
  const { merged_id, surviving_id } = body
  if (!merged_id || !surviving_id)
    return c.json({ error: 'merged_id and surviving_id required' }, 400)
  if (merged_id === surviving_id)
    return c.json({ error: 'Cannot merge a product with itself' }, 400)

  const org = orgOf(c)
  const merged = await c.env.DB.prepare(
    'SELECT id, name FROM generic_products WHERE id = ? AND deleted_at IS NULL AND org_id IS ?'
  ).bind(merged_id, org).first<{ id: string; name: string }>()
  const surviving = await c.env.DB.prepare(
    'SELECT id, name FROM generic_products WHERE id = ? AND deleted_at IS NULL AND org_id IS ?'
  ).bind(surviving_id, org).first<{ id: string; name: string }>()
  if (!merged)    return c.json({ error: 'Merged product not found' }, 404)
  if (!surviving) return c.json({ error: 'Surviving product not found' }, 404)

  // Both sides resolved within this business, so a cross-business merge is
  // impossible: one of them simply isn't found.
  await mergeInto(c.env.DB, merged, surviving, org)
  return c.json({ ok: true, merged_name: merged.name, surviving_name: surviving.name })
})

// ─── Product Group (interchangeable items) ────────────────────
// POST /api/products/group  Body: { general_name: string, product_ids: string[] }
// Combines 2+ products you buy interchangeably (cherry/grape tomatoes) into one
// umbrella product named general_name, keeping every supplier's purchases as its
// own row (the "Basil" shape). Distinct in intent from Merge, same plumbing: one
// product survives (renamed to general_name), the rest are merged into it, and
// each absorbed name is remembered as a vendor alias so future invoices route in.
app.post('/api/products/group', async (c) => {
  const body = await c.req.json() as { general_name?: string; product_ids?: string[] }
  const generalName = (body.general_name || '').trim()
  const ids = Array.from(new Set((body.product_ids || []).map(s => String(s || '').trim()).filter(Boolean)))
  if (!generalName)    return c.json({ error: 'general_name required' }, 400)
  if (ids.length < 2)  return c.json({ error: 'Select at least two products to group' }, 400)

  // Load every selected product (active only).
  const org = orgOf(c)
  const products: { id: string; name: string }[] = []
  for (const id of ids) {
    const p = await c.env.DB.prepare('SELECT id, name FROM generic_products WHERE id = ? AND deleted_at IS NULL AND org_id IS ?')
      .bind(id, org).first<{ id: string; name: string }>()
    if (!p) return c.json({ error: `Product not found or archived: ${id}` }, 404)
    products.push(p)
  }

  // Survivor: prefer one already named general_name, else the first selected. It
  // is renamed to the umbrella name; the rest are merged into it.
  const survivor = products.find(p => p.name.trim().toLowerCase() === generalName.toLowerCase()) || products[0]
  if (survivor.name.trim().toLowerCase() !== generalName.toLowerCase()) {
    await cascadeRename(c.env.DB, survivor.id, survivor.name, generalName, org)
  }
  const surviving = { id: survivor.id, name: generalName }

  // One product at a time, each merge atomic in itself (mergeInto batches its
  // own writes, alias included). Deliberately NOT one batch for the whole group:
  // pooling inventory needs to see the row the previous merge just moved, and a
  // single up-front read would have two absorbed products each reassign their
  // bin to the survivor instead of adding to it.
  let grouped = 0
  for (const p of products) {
    if (p.id === survivor.id) continue
    await mergeInto(c.env.DB, p, surviving, org, p.name)
    grouped++
  }

  return c.json({ ok: true, survivor_id: survivor.id, survivor_name: generalName, grouped_count: grouped })
})

// ─── Price Movers ─────────────────────────────────────────────
// GET /api/price-movers?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns one row per generic_product that has purchases in the date range.
// Each row contains the last 10 purchases (newest first) and the % change
// between the two most recent purchases (null if fewer than 2 in range).
// Sorted by absolute % change descending, nulls last.
app.get('/api/price-movers', async (c) => {
  const org  = orgOf(c)
  const from = (c.req.query('from') || '').trim()
  const to   = (c.req.query('to')   || '').trim()

  // Ownership filter first, so it can never be dropped by a later branch that
  // appends to `sql`. The generic_products join carries the same org so a
  // product id colliding across tenants can't pull in a foreign row.
  let sql = `
    SELECT pe.generic_product_id AS product_id,
           pe.generic_product_name AS product_name,
           pe.supplier_name,
           pe.purchase_date,
           pe.pack_qty,
           pe.pack_unit,
           pe.cost,
           pe.cost_per_unit,
           pe.invoice_ref,
           pe.invoice_id,
           pe.vendor_item_name,
           gp.base_unit           AS stock_unit,
           gp.avg_weight_per_unit AS avg_weight
    FROM product_entries pe
    LEFT JOIN generic_products gp
      ON gp.id = pe.generic_product_id AND gp.org_id IS pe.org_id
    WHERE pe.org_id IS ?
      AND pe.purchase_date IS NOT NULL AND pe.purchase_date != ''
      AND pe.generic_product_id IS NOT NULL AND pe.generic_product_id != ''
      AND pe.voided_at IS NULL
  `
  const args: (string | null)[] = [org]
  if (from) { sql += ' AND pe.purchase_date >= ?'; args.push(from) }
  if (to)   { sql += ' AND pe.purchase_date <= ?'; args.push(to)   }
  sql += ' ORDER BY pe.purchase_date DESC, pe.created_at DESC'

  const rows = await c.env.DB.prepare(sql).bind(...args).all()

  type Purchase = {
    date: string
    vendor: string
    pack_qty: number
    pack_unit: string
    cost: number
    cost_per_unit: number
    // cost_per_unit expressed in the product's declared stocking unit, so
    // purchases from suppliers billing in different units are comparable.
    // null when the units can't be reconciled (e.g. $/each with no average
    // weight set) — such purchases are shown but never compared.
    cost_per_stock_unit: number | null
    invoice_ref: string
    invoice_id: string
    // The supplier's own wording for this line. Two purchases of one product
    // under different vendor wording usually means a substitute arrived
    // (grape tomatoes instead of cherry), not that the price moved.
    vendor_item: string
  }
  type Group = {
    product_id: string
    product_name: string
    // The unit every purchase is priced into for comparison. Starts as the
    // declared stocking unit, but see the fallback below — it is a lens, not a
    // fact about the product.
    unit: string
    // Product-level, so the fallback can re-price each↔weight lines.
    avg_weight: number | null
    purchases: Purchase[]
  }

  const groups = new Map<string, Group>()
  for (const r of rows.results as Record<string, unknown>[]) {
    const pid = String(r.product_id || '')
    if (!pid) continue
    const packUnit  = String(r.pack_unit || '')
    // Fall back to the purchase's own unit for products predating migration
    // 0032; then everything in the group shares one unit and behaves as before.
    const stockUnit = String(r.stock_unit || '').trim() || packUnit
    const cpu   = Number(r.cost_per_unit || 0)
    const avgW  = r.avg_weight != null ? Number(r.avg_weight) : null
    let g = groups.get(pid)
    if (!g) {
      g = {
        product_id:   pid,
        product_name: String(r.product_name || ''),
        unit:         stockUnit,
        avg_weight:   avgW,
        purchases:    []
      }
      groups.set(pid, g)
    }
    g.purchases.push({
      date:                String(r.purchase_date || ''),
      vendor:              String(r.supplier_name || ''),
      pack_qty:            Number(r.pack_qty || 0),
      pack_unit:           packUnit,
      cost:                Number(r.cost || 0),
      cost_per_unit:       cpu,
      cost_per_stock_unit: convertUnitCost(cpu, packUnit, stockUnit, avgW),
      invoice_ref:         String(r.invoice_ref || ''),
      invoice_id:          String(r.invoice_id || ''),
      vendor_item:         String(r.vendor_item_name || ''),
    })
  }

  // ── Comparison unit fallback ──────────────────────────────────
  // The stocking unit is only the lens purchases are compared through. When it
  // cannot express what was actually bought, comparing through it discards
  // purchases that needed no conversion in the first place: napkins bought
  // twice by the `case` on a product stocked in kg produced a blank chart and
  // hid a real 12.5% rise, because case→kg has no answer.
  //
  // Two purchases already in the same unit are directly comparable — there is
  // nothing to convert. So when the declared unit yields fewer than two
  // comparable purchases, fall back to a unit at least two purchases share.
  // Strictly a fallback: a product that already compares keeps its declared
  // unit, so nothing that works today changes.
  for (const g of groups.values()) {
    const comparableIn = (unit: string) =>
      g.purchases.reduce(
        (n, p) => n + (convertUnitCost(p.cost_per_unit, p.pack_unit, unit, g.avg_weight) != null ? 1 : 0),
        0
      )
    const declaredCount = comparableIn(g.unit)
    if (declaredCount >= 2) continue

    // How many purchases were invoiced in each unit.
    const counts = new Map<string, number>()
    for (const p of g.purchases) {
      const u = p.pack_unit.trim().toLowerCase()
      if (u) counts.set(u, (counts.get(u) || 0) + 1)
    }
    // Best candidate = most-purchased unit, needing at least two purchases to be
    // a comparison at all. Scanning DESC means an equal count is broken toward
    // the most recent unit, so the trend follows what is being bought now.
    let best = ''
    let bestCount = 1
    for (const p of g.purchases) {
      const u = p.pack_unit.trim().toLowerCase()
      const n = counts.get(u) || 0
      if (n > bestCount) { best = u; bestCount = n }
    }
    if (!best || comparableIn(best) <= declaredCount) continue

    g.unit = best
    for (const p of g.purchases) {
      p.cost_per_stock_unit = convertUnitCost(p.cost_per_unit, p.pack_unit, best, g.avg_weight)
    }
  }

  const products = Array.from(groups.values()).map(g => {
    // Already DESC sorted by the query. Take at most the latest 10.
    const purchases = g.purchases.slice(0, 10)

    // ── Per-vendor aggregation over ALL in-range purchases (not just the
    // latest 10 the chart draws). Powers the Vendor Compare strip and the
    // dollar "you could save" figure, which must reflect real volume, so we
    // aggregate g.purchases in full here.
    type VendorAgg = {
      name: string
      latest_price: number | null   // most recent comparable $/stock-unit
      latest_date: string
      qty_stock: number             // total volume bought, in the stocking unit
      spend: number                 // total $ spent with this vendor in range
      buys: number
    }
    const vmap = new Map<string, VendorAgg>()
    for (const p of g.purchases) {          // DESC by date — first seen is latest
      const key = (p.vendor || '—').trim() || '—'
      let v = vmap.get(key)
      if (!v) {
        v = { name: key, latest_price: null, latest_date: '', qty_stock: 0, spend: 0, buys: 0 }
        vmap.set(key, v)
      }
      v.buys += 1
      v.spend += p.cost
      // First comparable purchase encountered (DESC order) is the latest price.
      if (v.latest_price == null && p.cost_per_stock_unit != null) {
        v.latest_price = p.cost_per_stock_unit
        v.latest_date  = p.date
      }
      // Volume in the stocking unit; only derivable when the line is comparable.
      if (p.cost_per_stock_unit && p.cost_per_stock_unit > 0) {
        v.qty_stock += p.cost / p.cost_per_stock_unit
      }
    }
    const vendors = Array.from(vmap.values()).sort((a, b) => {
      if (a.latest_price == null) return 1
      if (b.latest_price == null) return -1
      return a.latest_price - b.latest_price
    })
    // Cheapest current price across vendors with a comparable latest price.
    const priced   = vendors.filter(v => v.latest_price != null)
    const cheapest = priced.length ? priced[0] : null
    // "At today's prices, buying your same in-range volumes from the cheapest
    // vendor instead would save this much." Each vendor priced above the floor
    // contributes its own volume × the per-unit gap; the floor contributes 0.
    let overpay_est = 0
    if (cheapest && cheapest.latest_price != null) {
      for (const v of priced) {
        if ((v.latest_price as number) > cheapest.latest_price) {
          overpay_est += v.qty_stock * ((v.latest_price as number) - cheapest.latest_price)
        }
      }
    }
    overpay_est = Math.round(overpay_est * 100) / 100

    // Compare the two most recent purchases that can both be expressed in the
    // stocking unit. Comparing raw cost_per_unit across units is what made a
    // kg→lb supplier switch read as a ~120% price rise.
    const comparable = purchases.filter(p => p.cost_per_stock_unit != null)
    let pct_change: number | null = null
    if (comparable.length >= 2) {
      const latest = comparable[0].cost_per_stock_unit as number
      const prev   = comparable[1].cost_per_stock_unit as number
      if (prev > 0) {
        pct_change = Math.round(((latest - prev) / prev) * 1000) / 10
      }
    }
    // Surfaced so the UI can say "can't compare" rather than imply no movement.
    const uncomparable_count = purchases.length - comparable.length

    // What KIND of change is this? Comparing two purchases of the same product
    // is only a price move when it's the same thing from the same vendor. A
    // different supplier, or the same supplier shipping a substitute, is a
    // switch — reporting it as "prices rose 22%" sends you chasing a vendor
    // who never raised anything.
    let change_kind: 'price' | 'supplier' | 'item' = 'price'
    let change_from = ''
    let change_to   = ''
    if (comparable.length >= 2) {
      const latest = comparable[0]
      const prev   = comparable[1]
      const vLatest = latest.vendor.trim()
      const vPrev   = prev.vendor.trim()
      const iLatest = latest.vendor_item.trim().toLowerCase()
      const iPrev   = prev.vendor_item.trim().toLowerCase()

      if (vLatest && vPrev && vLatest.toLowerCase() !== vPrev.toLowerCase()) {
        change_kind = 'supplier'
        change_from = vPrev
        change_to   = vLatest
      } else if (iLatest && iPrev && iLatest !== iPrev) {
        change_kind = 'item'
        change_from = prev.vendor_item.trim()
        change_to   = latest.vendor_item.trim()
      }
    }

    return {
      product_id:     g.product_id,
      product_name:   g.product_name,
      unit:           g.unit,
      purchase_count: g.purchases.length,
      pct_change,
      uncomparable_count,
      change_kind,
      change_from,
      change_to,
      purchases,
      // Vendor comparison (over the full in-range history).
      vendors,
      vendor_count:    vmap.size,
      cheapest_vendor: cheapest ? cheapest.name : '',
      cheapest_price:  cheapest ? cheapest.latest_price : null,
      overpay_est,
    }
  })

  products.sort((a, b) => {
    const aAbs = a.pct_change === null ? -1 : Math.abs(a.pct_change)
    const bAbs = b.pct_change === null ? -1 : Math.abs(b.pct_change)
    return bAbs - aAbs
  })

  return c.json({ data: products })
})

// ─── Stock Take ───────────────────────────────────────────────
// GET /api/stock-take/active
// Returns the in-progress stock take (if any), with its items.
// If none exists, returns { active: null }.
app.get('/api/stock-take/active', async (c) => {
  const org = orgOf(c)
  // Per business: one restaurant's stock take in progress must not appear on
  // another's counting screen.
  const take = await c.env.DB.prepare(
    `SELECT * FROM stock_takes WHERE status = 'in_progress' AND org_id IS ? ORDER BY started_at DESC LIMIT 1`
  ).bind(org).first<Record<string, unknown>>()

  if (!take) return c.json({ active: null })

  const items = await c.env.DB.prepare(
    `SELECT * FROM stock_take_items WHERE stock_take_id = ? AND org_id IS ?`
  ).bind(take.id, org).all()

  return c.json({ active: take, items: items.results })
})

// POST /api/stock-take/start
// Creates a new in-progress stock take and snapshots every inventory item
// as a stock_take_items row with counted_qty = NULL.
// If an in-progress stock take already exists, returns it instead.
app.post('/api/stock-take/start', async (c) => {
  const org = orgOf(c)
  const existing = await c.env.DB.prepare(
    `SELECT * FROM stock_takes WHERE status = 'in_progress' AND org_id IS ? ORDER BY started_at DESC LIMIT 1`
  ).bind(org).first<Record<string, unknown>>()

  if (existing) {
    const items = await c.env.DB.prepare(
      `SELECT * FROM stock_take_items WHERE stock_take_id = ? AND org_id IS ?`
    ).bind(existing.id, org).all()
    return c.json({ stock_take: existing, items: items.results, resumed: true })
  }

  const stockTakeId = uid()
  // The snapshot must cover only this business's inventory, or the count sheet
  // would list another restaurant's items.
  const inv = await c.env.DB.prepare(
    `SELECT id, item_id, item_type, item_name, category, quantity, unit FROM inventory WHERE org_id IS ?`
  ).bind(org).all<{ id: string; item_id: string; item_type: string; item_name: string; category: string; quantity: number; unit: string }>()

  const items = inv.results || []

  await c.env.DB.prepare(
    `INSERT INTO stock_takes (id, status, total_items, counted_items, org_id) VALUES (?, 'in_progress', ?, 0, ?)`
  ).bind(stockTakeId, items.length, org).run()

  // Bulk-insert snapshot rows
  const statements = items.map(r =>
    c.env.DB.prepare(
      `INSERT INTO stock_take_items
         (id, stock_take_id, inventory_id, item_id, item_type, item_name, category, unit, expected_qty, org_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(uid(), stockTakeId, r.id, r.item_id, r.item_type, r.item_name, r.category || '', r.unit || '', r.quantity || 0, org)
  )
  if (statements.length) await c.env.DB.batch(statements)

  const created = await c.env.DB.prepare(
    `SELECT * FROM stock_takes WHERE id = ? AND org_id IS ?`
  ).bind(stockTakeId, org).first()
  const itemRows = await c.env.DB.prepare(
    `SELECT * FROM stock_take_items WHERE stock_take_id = ? AND org_id IS ?`
  ).bind(stockTakeId, org).all()

  return c.json({ stock_take: created, items: itemRows.results, resumed: false }, 201)
})

// POST /api/stock-take/:id/submit
// Body: { items: [{ stock_take_item_id, counted_qty (number|null), reason (string) }] }
// For each item with counted_qty != null:
//   - Update inventory.quantity to counted_qty
//   - Insert stock_log row with change = counted - expected, reason, stock_take_id
//   - Update stock_take_items row (counted_qty, variance, reason, counted_at)
// For each item with counted_qty == null: leave stock_take_items.counted_qty NULL.
// Finally mark the stock_takes row submitted.
app.post('/api/stock-take/:id/submit', async (c) => {
  const stockTakeId = c.req.param('id')
  const body = await c.req.json() as {
    items: Array<{
      stock_take_item_id: string; counted_qty: number | null
      reason?: string; reason_code?: string
    }>
  }

  const org = orgOf(c)
  const take = await c.env.DB.prepare(`SELECT * FROM stock_takes WHERE id = ? AND org_id IS ?`)
    .bind(stockTakeId, org).first<Record<string, unknown>>()
  if (!take) return c.json({ error: 'Stock take not found' }, 404)
  if (take.status !== 'in_progress') return c.json({ error: 'Stock take is not in progress' }, 400)

  // Load all snapshot rows for this take, keyed by id
  const snapshotRows = await c.env.DB.prepare(
    `SELECT * FROM stock_take_items WHERE stock_take_id = ? AND org_id IS ?`
  ).bind(stockTakeId, org).all<{
    id: string; inventory_id: string; item_id: string; item_type: string
    item_name: string; expected_qty: number; unit: string
  }>()
  const snapshotById = new Map((snapshotRows.results || []).map(r => [r.id, r]))

  const now = new Date().toISOString()
  let countedCount = 0
  const statements: D1PreparedStatement[] = []

  for (const it of (body.items || [])) {
    const snap = snapshotById.get(it.stock_take_item_id)
    if (!snap) continue
    if (it.counted_qty === null || it.counted_qty === undefined) continue

    const counted    = Number(it.counted_qty)
    const expected   = Number(snap.expected_qty) || 0
    const variance   = counted - expected
    const reason     = (it.reason || '').trim()
    const reasonCode = (it.reason_code || '').trim()
    countedCount++

    // 1. Update inventory quantity
    statements.push(
      c.env.DB.prepare(`UPDATE inventory SET quantity = ? WHERE id = ? AND org_id IS ?`).bind(counted, snap.inventory_id, org)
    )

    // 2. Update stock_take_items snapshot
    statements.push(
      c.env.DB.prepare(
        `UPDATE stock_take_items
           SET counted_qty = ?, variance = ?, reason = ?, reason_code = ?, counted_at = ?
         WHERE id = ? AND org_id IS ?`
      ).bind(counted, variance, reason, reasonCode, now, snap.id, org)
    )

    // 3. Log a stock movement (only if variance != 0).
    //    reason_code is what makes a stock-take variance show up in waste
    //    reporting alongside manual adjustments — 'stock_take' is the fallback
    //    when the user picked nothing (only possible for a zero variance,
    //    which does not reach here, but kept honest rather than blank).
    if (variance !== 0) {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO stock_log
             (id, inventory_id, item_id, item_type, item_name, change, reason, reason_code, note, lot_number, moved_at, stock_take_id, org_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`
        ).bind(
          uid(), snap.inventory_id, snap.item_id, snap.item_type, snap.item_name,
          variance, reason || 'Stock take', reasonCode || 'stock_take',
          `Stock take: expected ${expected}, counted ${counted}`,
          now, stockTakeId, org
        )
      )
    }
  }

  // 4. Mark the stock take submitted
  statements.push(
    c.env.DB.prepare(
      `UPDATE stock_takes SET status = 'submitted', submitted_at = ?, counted_items = ? WHERE id = ? AND org_id IS ?`
    ).bind(now, countedCount, stockTakeId, org)
  )

  if (statements.length) await c.env.DB.batch(statements)

  return c.json({ ok: true, counted: countedCount })
})

// PATCH /api/stock-take/items/:id
// Body: { counted_qty: number | null, reason_code?: string, reason?: string }
// Persists partial counts during an in-progress session so resume works.
// `reason_code` is the machine-readable bucket (migration 0031); `reason` is
// the human label. The client sends both from the shared STOCK_REASONS
// taxonomy, so the backend needs no copy of the list.
app.patch('/api/stock-take/items/:id', async (c) => {
  const itemId = c.req.param('id')
  const body = await c.req.json() as {
    counted_qty: number | null; reason?: string; reason_code?: string
  }
  await c.env.DB.prepare(
    `UPDATE stock_take_items
        SET counted_qty = ?, reason = ?, reason_code = ?,
            counted_at = CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END
      WHERE id = ? AND org_id IS ?`
  ).bind(
    body.counted_qty ?? null,
    body.reason ?? '',
    (body.reason_code || '').trim(),
    body.counted_qty ?? null,
    itemId,
    orgOf(c)
  ).run()
  return c.json({ ok: true })
})

// POST /api/stock-take/:id/cancel
app.post('/api/stock-take/:id/cancel', async (c) => {
  const stockTakeId = c.req.param('id')
  // Hard delete so the next "Start Stock Take" creates a fresh session.
  // stock_take_items cascade-deletes via the FK ON DELETE CASCADE.
  await c.env.DB.prepare(
    `DELETE FROM stock_takes WHERE id = ? AND status = 'in_progress' AND org_id IS ?`
  ).bind(stockTakeId, orgOf(c)).run()
  return c.json({ ok: true })
})

// GET /api/stock-take/latest-statuses
// Returns a map of { inventory_id: 'counted' | 'not_counted' } based on the
// MOST RECENTLY SUBMITTED stock take. Inventory rows with no record in that
// take (e.g. created after the take was submitted) are omitted.
app.get('/api/stock-take/latest-statuses', async (c) => {
  const org = orgOf(c)
  const latest = await c.env.DB.prepare(
    `SELECT id, submitted_at FROM stock_takes WHERE status = 'submitted' AND org_id IS ? ORDER BY submitted_at DESC LIMIT 1`
  ).bind(org).first<{ id: string; submitted_at: string }>()

  if (!latest) return c.json({ stock_take_id: null, statuses: {} })

  const rows = await c.env.DB.prepare(
    `SELECT inventory_id, counted_qty FROM stock_take_items WHERE stock_take_id = ? AND org_id IS ?`
  ).bind(latest.id, org).all<{ inventory_id: string; counted_qty: number | null }>()

  const statuses: Record<string, 'counted' | 'not_counted'> = {}
  for (const r of (rows.results || [])) {
    statuses[r.inventory_id] = (r.counted_qty === null || r.counted_qty === undefined) ? 'not_counted' : 'counted'
  }

  return c.json({ stock_take_id: latest.id, submitted_at: latest.submitted_at, statuses })
})

// Static HTML + assets are served by Cloudflare Pages directly from the dist/ folder.
// The worker only needs to handle /api/* routes.

// ─── AI: Check if Claude key is configured ───────────────────
app.get('/api/ai/status', async (c) => {
  return c.json({ configured: !!c.env.ANTHROPIC_API_KEY })
})

// ─── Helper: base64-encode an ArrayBuffer (chunked, stack-safe) ─
function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

// ─── AI: Parse invoice via Claude ────────────────────────────
// POST /api/ai/parse-invoice
// Accepts multipart/form-data with one or more "file" fields (PDF or image).
// Claude reads the document(s) directly (native PDF + vision) and returns
// structured JSON in a single pass — no separate OCR step.
app.post('/api/ai/parse-invoice', async (c) => {
  const apiKey = c.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return c.json({ error: 'Claude API key is not configured on the server. Add ANTHROPIC_API_KEY and try again.' }, 400)
  }

  // ── Monthly parse cap ────────────────────────────────────────
  // Checked BEFORE the Anthropic call, so a blocked parse costs nothing. The
  // refusal is logged: a hard block hides the demand it blocks, and that demand
  // is the evidence for whether paid overage is worth offering.
  const parseOrg = orgOf(c)
  const capRow = await c.env.DB.prepare(
    'SELECT plan, invoice_cap FROM organizations WHERE id = ?',
  ).bind(parseOrg).first<{ plan: string; invoice_cap: number | null }>()
  // No row means the NULL-org demo/super-admin account, which is uncapped.
  const cap = capRow ? effectiveInvoiceCap(capRow) : 0
  if (cap > 0) {
    const used = await monthlyInvoiceParses(c.env.DB, parseOrg)
    if (used >= cap) {
      await c.env.DB.prepare(
        `INSERT INTO ai_cap_blocks (id, org_id, cap, used) VALUES (?, ?, ?, ?)`,
      ).bind(uid(), parseOrg, cap, used).run()
      return c.json({
        error: `You've used all ${cap} AI invoice reads included this month. `
             + `They reset on the 1st. You can still add invoices by hand in the meantime — `
             + `or contact us to raise your limit.`,
        upgrade_required: true,
        cap,
        used,
      }, 403)
    }
  }

  // Shared JSON schema + extraction rules
  const jsonSchema = `{
  "vendor": "supplier/company name from the invoice header",
  "invoice_number": "invoice number or empty string",
  "invoice_date": "YYYY-MM-DD or empty string",
  "page_note": "any 'Page X of Y' text visible on the invoice, copied verbatim, or empty string",
  "page_current": 0,
  "page_total": 0,
  "total": 0.00,
  "payment_account": "A/P",
  "tax_gst": 0.00,
  "tax_pst": 0.00,
  "delivery": 0.00,
  "deposit": 0.00,  // total of all deposit charges (bottle deposits, can deposits, container deposits)
  "credit": 0.00,
  "other_cost": 0.00,
  "other_desc": "",
  "items": [
    {
      "name": "generic product name (e.g. Grana Padano, Olive Oil, Cardboard Box)",
      "original_ocr": "exact original OCR text for this line item — copy it character-for-character from the input, do not clean or modify it",
      "brand": "brand name if visible or empty string",
      "sku": "SKU/item code/barcode if visible or empty string",
      "pack_size": "weight or volume only e.g. '1 kg', '500 ml', '2 LB'. Use case count or Each only if no weight or volume is available",
      "qty": 1,
      "unit_price": 0.00,
      "cost": 0.00,
      "expiry_date": "YYYY-MM-DD or empty string"
    }
  ]
}`

  const rules = `Rules:
- Extract EVERY product line item in the text — do not skip any
- Ignore all handwritten text, annotations, or markings on the invoice (e.g. 'Short', 'Void', circled items, arrows, written notes). These are not invoice data. Do not let them affect column alignment, row parsing, or any extracted values. This applies to handwriting only — printed text on the invoice is always valid data.
- For 'original_ocr': copy the exact original OCR text for each product line item, character-for-character, without cleaning or modifying it. This is used for product matching.
- Do NOT include delivery fees, fuel surcharges, or taxes as items[] entries — put them in the dedicated fields (delivery, tax_gst, tax_pst) instead
- For 'name': use the generic product name, not the vendor-specific SKU description
- For 'qty': the quantity ordered (number of units, cases, bags, etc. as shown on the invoice). Must be a number, not text
- For 'unit_price': the price per single unit as shown on the invoice (e.g. $13.35 per bag). This is NOT the line total
- For 'cost': the line total (qty × unit_price). Verify the math: cost should equal qty × unit_price
- For 'pack_size': prioritize the unit weight or volume over the case count. For example, '20CS of 50KG' should be saved as '50KG'. Only use case count or 'Each' if there is no weight or volume available
- For 'tax_gst': GST, HST, or any federal/harmonized sales tax amount (dollar value, not %)
- For 'tax_pst': PST, QST, or any provincial sales tax amount (dollar value, not %)
- For 'delivery': the combined total of any delivery fee, freight charge, shipping cost, fuel surcharge, energy surcharge, or environmental fee that are actual charges applied to this specific invoice's total. Add them together into this single field. Do NOT extract amounts mentioned only in general policy text, terms and conditions, fine print, or minimum order notices (e.g. "Free delivery on orders over $X"). Only extract actual line item charges that affect the invoice total
- For 'deposit': sum the total dollar amount of all deposit charges on the invoice (lines with descriptions containing 'Deposit-', 'bottle deposit', 'can deposit', or product codes starting with 'DEP'). Do not include these lines in items[].
- For 'other_cost': also include the total of any ecology fee lines (descriptions containing 'Eco' or product codes starting with 'ECO'). Do not include these lines in items[].
- - For 'credit': only extract a credit/discount if the line item prices are at FULL (undiscounted) price and the discount is applied separately at the bottom of the invoice. If the line item prices already reflect the discounted price (i.e. the discounted unit price × qty = the line total shown), set credit to 0.00
- For 'other_cost': any other fee not covered above (handling fee, etc.)
- For 'other_desc': description of the other_cost if applicable
- For dates: convert any format to YYYY-MM-DD
- Pagination (IMPORTANT — used to detect missing pages): carefully inspect BOTH the header and the footer of the invoice for any page indicator, such as 'Page 1 of 2', 'Page 1/2', '1 of 2', 'Pg 1 of 2', or a bare 'Page 1'. Set 'page_current' and 'page_total' to the integers shown — e.g. 'Page 1 of 2' → page_current 1, page_total 2. If you can only read a fragment (e.g. just 'Page 1' with no total), fill what you can and set the unknown one to 0. Also copy the raw pagination text verbatim into 'page_note'. If there is genuinely no pagination text anywhere, set both to 0 and page_note to ''. Do not skip this — pagination is often small print in a corner.
- Use 0.00 for numeric fields you cannot find
- Use empty string '' for text fields you cannot find
- If any field is unclear or ambiguous, mark it as 'needs review' instead of guessing
- If any part of the invoice is in a language other than English, translate it to English
- When a tax, fee, or charge seems unusually high or low, cross-check it against the invoice total. For example, if the subtotal is $814.51 and the total is $814.66, the tax should be $0.15 not $15.00. Use the total as the source of truth to validate individual charges. If you correct a decimal error, add '(decimal corrected)' next to the field value
- Return ONLY the JSON object, nothing else`

  const contentType = c.req.header('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    return c.json({ error: 'Send the invoice as multipart/form-data with one or more "file" fields.' }, 400)
  }

  const formData = await c.req.formData()
  const files = formData.getAll('file').filter((f): f is File => f instanceof File)
  if (!files.length) return c.json({ error: 'No file provided.' }, 400)

  // ── Build Claude content blocks: one per file (PDF → document, image → image) ──
  const fileBlocks: Array<Record<string, unknown>> = []
  for (const file of files) {
    const ab = await file.arrayBuffer()
    const sizeMB = ab.byteLength / (1024 * 1024)
    if (sizeMB > 30) {
      return c.json({ error: `File "${file.name}" is too large (${sizeMB.toFixed(1)} MB). Maximum is 30 MB per file.` }, 413)
    }
    const data = bufToBase64(ab)
    const mime = file.type || ''
    if (mime === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      fileBlocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data },
      })
    } else {
      const imgMime = mime.startsWith('image/') ? mime : 'image/jpeg'
      fileBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: imgMime, data },
      })
    }
  }

  const prompt = `You are an expert invoice parser. Read the attached invoice document(s) carefully — including the totals/charges section — and extract ALL line items AND all additional charges. Use the visual layout to correctly associate each amount with its label. If any value looks like a decimal error (e.g. a tax that is far too large relative to the total), correct it and add '(decimal corrected)' next to the value. If any field is unclear or ambiguous, mark it as 'needs review'.
Return ONLY a valid JSON object in this exact format (no markdown, no explanation, no code fences):
${jsonSchema}
${rules}`

  const content = [{ type: 'text', text: prompt }, ...fileBlocks]

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        // The ceiling covers adaptive-thinking tokens AND the JSON, so it has
        // to clear both — and output grows far faster than the invoice does.
        // Measured 2026-08-07: 9 line items produced 2,757 output tokens; 20
        // line items across two pages produced 13,477–16,000+, i.e. 2.2x the
        // content for 5.8x the output. At 16000 that 2-page invoice hit the
        // ceiling on 2 of 15 runs, at high AND at low effort, burning ~$0.46
        // per truncated call for nothing.
        //
        // 32000 is ~2.2x the largest run that completed (14,542), the same
        // headroom multiple as the 9→20 line jump. Billing is on tokens
        // actually generated, so the extra ceiling costs nothing when unused;
        // it is bounded rather than set to the model's 128k maximum because a
        // runaway generation would cost $3.20 there against $0.80 here.
        //
        // Do not raise this much further without switching to streaming: at
        // the ~95 tokens/sec measured across every run, 32000 tokens is a
        // ~5.5 minute single non-streaming request.
        max_tokens: 32000,
        thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content }],
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as { error?: { message?: string } }
      return c.json({ error: err?.error?.message || `Claude API error ${response.status}` }, 502)
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string }>
      usage?: { input_tokens?: number; output_tokens?: number }
      stop_reason?: string
      stop_details?: { category?: string | null } | null
    }
    const text = (data.content || []).find(b => b.type === 'text')?.text || ''

    // Claude Opus 4.8 pricing: $5/MTok input, $25/MTok output (output includes
    // adaptive-thinking tokens — there is no separate thinking rate).
    const inputTokens  = data.usage?.input_tokens  || 0
    const outputTokens = data.usage?.output_tokens || 0
    const cost = Math.round(((inputTokens / 1_000_000) * 5 + (outputTokens / 1_000_000) * 25) * 1_000_000) / 1_000_000

    // Record the call BEFORE parsing its output. Anthropic has already billed
    // for it at this point, so a malformed-JSON response must still count
    // against spend and quota — otherwise a customer whose invoices trip the
    // parser gets unlimited free retries and the cap protects nothing.
    await c.env.DB.prepare(
      `INSERT INTO ai_parse_log (id, org_id, kind, input_tokens, output_tokens, cost)
       VALUES (?, ?, 'invoice', ?, ?, ?)`,
    ).bind(uid(), parseOrg, inputTokens, outputTokens, cost).run()

    // Why the response stopped, checked BEFORE trying to read it. A call can
    // return HTTP 200 and still carry nothing usable, and both cases used to
    // fall through to JSON.parse and surface as a bare "AI parsing failed",
    // which says nothing about what went wrong or whether retrying would help.
    //
    // Deliberately after the spend log above: Anthropic has already billed for
    // the call either way, so it must still count against cost and the cap.
    if (data.stop_reason === 'max_tokens') {
      return c.json({
        error: 'This invoice was too long to read in one go — the response was cut off partway through. ' +
               'Try uploading it a page at a time.',
        truncated: true,
        output_tokens: outputTokens,
      }, 502)
    }
    if (data.stop_reason === 'refusal') {
      // The model declined the request. Vanishingly unlikely for an invoice,
      // but it arrives as a 200 with empty content, so without this it reads
      // as a parser bug rather than a refusal.
      return c.json({
        error: 'Claude declined to read this document. If it is a genuine invoice, please get in touch.',
        refused: true,
        category: data.stop_details?.category || null,
      }, 502)
    }

    // Strip markdown code fences if present
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()

    const parsed = JSON.parse(cleaned)

    return c.json({
      success: true,
      result: parsed,
      rawText: cleaned,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens, cost },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ error: 'AI parsing failed: ' + message }, 500)
  }
})

// ─── AI: Parse a plain-English ingredient list into recipe lines ───
// POST /api/ai/parse-recipe   body: { text, products: [{ id, name, category }] }
// Claude reads the free text and matches each ingredient to one of the caller's
// products, returning quantity + unit + a match status (matched/ambiguous/not_found).
app.post('/api/ai/parse-recipe', async (c) => {
  const apiKey = c.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return c.json({ error: 'Claude API key is not configured on the server. Add ANTHROPIC_API_KEY and try again.' }, 400)
  }

  const body = await c.req.json().catch(() => null) as
    { text?: string; products?: Array<{ id: string; name: string; category?: string }> } | null
  const text = (body?.text || '').trim()
  const products = Array.isArray(body?.products) ? body!.products : []
  if (!text) return c.json({ error: 'No recipe text provided.' }, 400)
  if (!products.length) return c.json({ error: 'You have no products to match against yet.' }, 400)

  // Compact catalogue for the prompt: "id<TAB>name (category)"
  const catalogue = products
    .map(p => `${p.id}\t${p.name}${p.category ? ` (${p.category})` : ''}`)
    .join('\n')

  const prompt = `You convert a chef's plain-English ingredient list into structured recipe lines, matching each ingredient to a product from the catalogue below.

CATALOGUE (each line is: id<TAB>name (category)):
${catalogue}

INGREDIENT TEXT:
"""
${text}
"""

For EACH ingredient the chef listed, output one item object with:
- "input": the original text fragment for this ingredient, copied verbatim (e.g. "30 kg tomatoes")
- "ingredient": just the ingredient name, without the quantity or unit (e.g. "tomatoes")
- "quantity": the numeric amount as a number, or null if none was given
- "unit": the unit of measure, normalised to lowercase (e.g. "kg", "g", "lb", "l", "ml", "each"). Use "" if none was given
- "status": exactly one of "matched", "ambiguous", "not_found"
- "product_id": the matching catalogue id when status is "matched"; otherwise ""
- "candidate_ids": an array of catalogue ids when status is "ambiguous" (2 or more plausible products, most likely first); otherwise []

Matching rules:
- "matched": exactly one catalogue product clearly corresponds. Allow plurals, synonyms, word order and brand/pack differences (e.g. "tomatoes" matches a single "Tomato" product; "ground beef" matches "Beef, Ground").
- "ambiguous": two or more catalogue products plausibly match and you cannot confidently choose one (e.g. "tomatoes" when BOTH "Roma Tomato" and "Cherry Tomato" exist). Put those ids in candidate_ids.
- "not_found": no catalogue product reasonably corresponds.
- Only ever use ids that appear verbatim in the catalogue above. Never invent ids, names, or products.
- Preserve the chef's original order.

Return ONLY a JSON object of this exact shape (no markdown, no commentary, no code fences):
{"items":[{"input":"","ingredient":"","quantity":0,"unit":"","status":"","product_id":"","candidate_ids":[]}]}`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        // Ceiling covers adaptive-thinking tokens AND the JSON, so it has to
        // clear both. At 4000 a long recipe could exhaust it mid-JSON, and the
        // truncated output failed JSON.parse below — surfacing to the user as a
        // bare "AI parsing failed" with no hint the recipe was simply too long.
        // Billing is on tokens actually used, so a higher ceiling costs nothing.
        // Left at 16000 while parse-invoice moved to 32000: this is a different
        // shape of job — a page of prose matched against a catalogue, not a
        // 20-line table — and nothing has been measured here. Raise it on
        // evidence (a real truncation, now visible thanks to the check below),
        // not by copying the invoice number across.
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as { error?: { message?: string } }
      return c.json({ error: err?.error?.message || `Claude API error ${response.status}` }, 502)
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string }>
      stop_reason?: string
    }
    // Same reasoning as parse-invoice: a 200 can still carry nothing usable,
    // and "the recipe was too long" is a different problem from "the parser
    // broke" — the user can act on the first and not on the second.
    if (data.stop_reason === 'max_tokens') {
      return c.json({
        error: 'That recipe was too long to read in one go — the response was cut off partway through. ' +
               'Try splitting it into two.',
        truncated: true,
      }, 502)
    }
    if (data.stop_reason === 'refusal') {
      return c.json({ error: 'Claude declined to read that text.', refused: true }, 502)
    }
    const raw = (data.content || []).find(b => b.type === 'text')?.text || ''
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()

    const parsed = JSON.parse(cleaned) as { items?: Array<Record<string, unknown>> }

    // Validate every id against the real catalogue and coerce inconsistent states —
    // never trust the model to have kept status/ids self-consistent.
    const validIds = new Set(products.map(p => p.id))
    const nameById = new Map(products.map(p => [p.id, p.name]))

    const items = (Array.isArray(parsed.items) ? parsed.items : []).map((it) => {
      const candidate_ids = (Array.isArray(it.candidate_ids) ? it.candidate_ids : [])
        .filter((id): id is string => typeof id === 'string' && validIds.has(id))
      let status = String(it.status || '')
      let product_id = (typeof it.product_id === 'string' && validIds.has(it.product_id)) ? it.product_id : ''

      if (status === 'matched' && !product_id) status = candidate_ids.length ? 'ambiguous' : 'not_found'
      if (status === 'ambiguous') {
        if (candidate_ids.length === 1) { status = 'matched'; product_id = candidate_ids[0] }
        else if (candidate_ids.length === 0) status = 'not_found'
      }
      if (status !== 'matched' && status !== 'ambiguous' && status !== 'not_found') {
        status = product_id ? 'matched' : (candidate_ids.length ? 'ambiguous' : 'not_found')
      }

      const qtyNum = Number(it.quantity)
      return {
        input: String(it.input || ''),
        ingredient: String(it.ingredient || ''),
        quantity: (it.quantity === null || it.quantity === undefined || isNaN(qtyNum)) ? null : qtyNum,
        unit: String(it.unit || '').toLowerCase(),
        status,
        product_id,
        product_name: product_id ? (nameById.get(product_id) || '') : '',
        candidate_ids,
      }
    })

    return c.json({ success: true, items })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ error: 'Recipe parsing failed: ' + message }, 500)
  }
})


// ─── Product Mappings: lookup by vendor + raw text ─────────────
app.get('/api/product-mappings', async (c) => {
  const vendor = (c.req.query('vendor') || '').trim()
  if (!vendor) {
    // No vendor — return all mappings for client-side fuzzy matching
    const rows = await c.env.DB.prepare(
      'SELECT * FROM product_mappings WHERE org_id IS ? ORDER BY updated_at DESC'
    ).bind(orgOf(c)).all()
    return c.json({ data: rows.results })
  }
  const rows = await c.env.DB.prepare(
    'SELECT * FROM product_mappings WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?)) AND org_id IS ? ORDER BY updated_at DESC'
  ).bind(vendor, orgOf(c)).all()
  return c.json({ data: rows.results })
})

// ─── Product Mappings: upsert (create or update) ───────────────
app.post('/api/product-mappings', async (c) => {
  const body = await c.req.json() as {
    vendor_name: string
    raw_ocr_text: string
    corrected_name: string
    corrected_brand?: string
    corrected_sku?: string
    corrected_pack_size?: string
  }
  if (!body.vendor_name?.trim() || !body.raw_ocr_text?.trim() || !body.corrected_name?.trim()) {
    return c.json({ error: 'vendor_name, raw_ocr_text, and corrected_name are required' }, 400)
  }

  const org = orgOf(c)
  const now = new Date().toISOString()
  const existing = await c.env.DB.prepare(
    'SELECT id FROM product_mappings WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?)) AND LOWER(TRIM(raw_ocr_text)) = LOWER(TRIM(?)) AND org_id IS ?'
  ).bind(body.vendor_name.trim(), body.raw_ocr_text.trim(), org).first<{ id: string }>()

  if (existing) {
    await c.env.DB.prepare(
      'UPDATE product_mappings SET corrected_name=?, corrected_brand=?, corrected_sku=?, corrected_pack_size=?, updated_at=? WHERE id=? AND org_id IS ?'
    ).bind(
      body.corrected_name.trim(),
      body.corrected_brand?.trim() || '',
      body.corrected_sku?.trim() || '',
      body.corrected_pack_size?.trim() || '',
      now,
      existing.id,
      org
    ).run()
    return c.json({ id: existing.id, created: false })
  }

  const id = uid()
  await c.env.DB.prepare(
    'INSERT INTO product_mappings (id, vendor_name, raw_ocr_text, corrected_name, corrected_brand, corrected_sku, corrected_pack_size, created_at, updated_at, org_id) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    id,
    body.vendor_name.trim(),
    body.raw_ocr_text.trim(),
    body.corrected_name.trim(),
    body.corrected_brand?.trim() || '',
    body.corrected_sku?.trim() || '',
    body.corrected_pack_size?.trim() || '',
    now, now, org
  ).run()
  return c.json({ id, created: true })
})

// ─── Units: delete with usage check ──────────────────────────────
// DELETE /api/units/:id
// Without ?force=true: returns { warning, count, message } if unit is in use.
// With ?force=true: deletes regardless of usage.
app.delete('/api/units/:id', async (c) => {
  const id    = c.req.param('id')
  const force = c.req.query('force') === 'true'
  const org   = orgOf(c)

  const unit = await c.env.DB.prepare(`SELECT * FROM units WHERE id = ? AND org_id IS ?`)
    .bind(id, org).first<{ id: number; name: string; sort_order: number }>()
  if (!unit) return c.json({ error: 'Not found' }, 404)

  if (!force) {
    const usage = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM product_entries WHERE pack_unit = ? AND org_id IS ?`
    ).bind(unit.name, org).first<{ count: number }>()
    const count = usage?.count ?? 0
    if (count > 0) {
      return c.json({ warning: true, count, message: `Used by ${count} product entries` })
    }
  }

  await c.env.DB.prepare(`DELETE FROM units WHERE id = ? AND org_id IS ?`).bind(id, org).run()
  return c.body(null, 204)
})

// DELETE /api/categories/:id  (mirrors /api/units/:id)
// Without ?force=true: returns { warning, count, message } if the category is
// still assigned to products. With ?force=true: deletes the master-list row
// regardless. Products keep their (now free-text) category string either way —
// deleting from the master list only removes it from the picker, it does not
// re-categorize existing products.
app.delete('/api/categories/:id', async (c) => {
  const id    = c.req.param('id')
  const force = c.req.query('force') === 'true'
  const org   = orgOf(c)

  const cat = await c.env.DB.prepare(`SELECT * FROM categories WHERE id = ? AND org_id IS ?`)
    .bind(id, org).first<{ id: number; name: string; sort_order: number }>()
  if (!cat) return c.json({ error: 'Not found' }, 404)

  if (!force) {
    const usage = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM generic_products
         WHERE deleted_at IS NULL AND LOWER(TRIM(category)) = LOWER(TRIM(?)) AND org_id IS ?`
    ).bind(cat.name, org).first<{ count: number }>()
    const count = usage?.count ?? 0
    if (count > 0) {
      return c.json({ warning: true, count, message: `Used by ${count} products` })
    }
  }

  await c.env.DB.prepare(`DELETE FROM categories WHERE id = ? AND org_id IS ?`).bind(id, org).run()
  return c.body(null, 204)
})

// ─── Spending Breakdown ───────────────────────────────────────
// GET /api/spending-breakdown?from=YYYY-MM-DD&to=YYYY-MM-DD
// Only includes invoices with status = 'Closed' (approved).
// Defaults: from = first day of current month, to = today.
app.get('/api/spending-breakdown', async (c) => {
  const now = new Date()
  const todayStr = now.toISOString().split('T')[0]
  const firstOfMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`

  const isoDateRe = /^\d{4}-\d{2}-\d{2}$/
  const isValidIsoDate = (s: string) => isoDateRe.test(s) && !isNaN(Date.parse(s))

  const fromRaw = (c.req.query('from') || '').trim()
  const toRaw   = (c.req.query('to')   || '').trim()

  if (fromRaw && !isValidIsoDate(fromRaw))
    return c.json({ error: `Invalid 'from' date: "${fromRaw}". Use YYYY-MM-DD.` }, 400)
  if (toRaw && !isValidIsoDate(toRaw))
    return c.json({ error: `Invalid 'to' date: "${toRaw}". Use YYYY-MM-DD.` }, 400)

  const from = fromRaw || firstOfMonth
  const to   = toRaw   || todayStr
  const org  = orgOf(c)

  // Aggregate invoice-level totals and other charges
  const totalsRow = await c.env.DB.prepare(`
    SELECT
      COUNT(*)                                              AS invoice_count,
      SUM(COALESCE(total, 0))                              AS grand_total,
      SUM(COALESCE(tax_gst, 0) + COALESCE(tax_pst, 0))    AS taxes,
      SUM(COALESCE(deposit, 0))                            AS deposits,
      SUM(COALESCE(delivery, 0))                           AS delivery,
      SUM(COALESCE(fuel_surcharge, 0))                     AS fuel_surcharge
    FROM invoices
    WHERE status = 'Closed'
      AND voided_at IS NULL
      AND invoice_date >= ?
      AND invoice_date <= ?
      AND org_id IS ?
  `).bind(from, to, org).first<{
    invoice_count: number
    grand_total:   number
    taxes:         number
    deposits:      number
    delivery:      number
    fuel_surcharge: number
  }>()

  const total         = totalsRow?.grand_total    ?? 0
  const invoice_count = totalsRow?.invoice_count  ?? 0

  // By vendor: sum each invoice's total (line items + all charges) per vendor
  const vendorRows = await c.env.DB.prepare(`
    SELECT vendor, SUM(COALESCE(total, 0)) AS amount
    FROM invoices
    WHERE status = 'Closed'
      AND voided_at IS NULL
      AND invoice_date >= ?
      AND invoice_date <= ?
      AND org_id IS ?
    GROUP BY vendor
    ORDER BY amount DESC
  `).bind(from, to, org).all<{ vendor: string; amount: number }>()

  // By category: resolve from generic_products (real category) via product_entries,
  // falling back to invoice_lines.category (brand field) if no match found.
  const categoryRows = await c.env.DB.prepare(`
    WITH line_cats AS (
      SELECT
        il.line_total,
        COALESCE(
          (SELECT gp.category
           FROM product_entries pe
           JOIN generic_products gp ON gp.id = pe.generic_product_id
           WHERE LOWER(TRIM(pe.generic_product_name)) = LOWER(TRIM(il.product_name))
             AND pe.org_id IS ? AND gp.org_id IS ?
           LIMIT 1),
          (SELECT gp.category
           FROM generic_products gp
           WHERE LOWER(TRIM(gp.name)) = LOWER(TRIM(il.product_name))
             AND gp.org_id IS ?
           LIMIT 1),
          'Uncategorized'
        ) AS category
      FROM invoice_lines il
      JOIN invoices i ON il.invoice_id = i.id
      WHERE i.status = 'Closed'
        AND i.voided_at IS NULL
        AND i.invoice_date >= ?
        AND i.invoice_date <= ?
        AND i.org_id IS ? AND il.org_id IS ?
    )
    SELECT category, SUM(COALESCE(line_total, 0)) AS amount
    FROM line_cats
    GROUP BY category
    ORDER BY amount DESC
  `).bind(org, org, org, from, to, org, org).all<{ category: string; amount: number }>()

  const round2 = (n: number) => Math.round(n * 100) / 100
  const pct    = (n: number) => total > 0 ? Math.round((n / total) * 1000) / 10 : 0

  const by_vendor = (vendorRows.results ?? []).map((r: { vendor: string; amount: number }) => ({
    vendor:     r.vendor ?? '',
    amount:     round2(r.amount ?? 0),
    percentage: pct(r.amount ?? 0),
  }))

  const by_category = (categoryRows.results ?? []).map((r: { category: string; amount: number }) => ({
    category:   r.category ?? '',
    amount:     round2(r.amount ?? 0),
    percentage: pct(r.amount ?? 0),
  }))

  return c.json({
    date_range: { from, to },
    total:         round2(total),
    invoice_count,
    by_category,
    by_vendor,
    other_charges_breakdown: {
      taxes:          round2(totalsRow?.taxes          ?? 0),
      deposits:       round2(totalsRow?.deposits       ?? 0),
      delivery:       round2(totalsRow?.delivery       ?? 0),
      fuel_surcharge: round2(totalsRow?.fuel_surcharge ?? 0),
    },
  })
})

// ─── P&L: invoice-derived cost side for a period ──────────────
// Returns the cost figures the app can compute from data it owns (invoices),
// split by category TYPE (food / beverage / supplies via the categories table).
// Sales + manual overheads live in sales_monthly / operating_expenses and are
// loaded by the frontend via generic CRUD — this endpoint is only the costs.
//
// Cost model (Phase 1): "cost = what you purchased in the period" — line totals
// of Closed, non-voided invoices dated in it. Not stock-take-adjusted COGS.
app.get('/api/pnl', async (c) => {
  const org = orgOf(c)
  const now = new Date()
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const monthRaw = (c.req.query('month') || '').trim()
  const fromRaw  = (c.req.query('from')  || '').trim()
  const toRaw    = (c.req.query('to')    || '').trim()

  // The period is an inclusive range of WHOLE months (YYYY-MM..YYYY-MM). Whole
  // months because sales and one-off overheads are stored per month — a partial
  // month could only be prorated, which would invent precision. `month=` (a
  // single month) is still accepted: the Home tile uses it.
  const from = fromRaw || toRaw || monthRaw || currentMonth
  const to   = toRaw   || fromRaw || monthRaw || currentMonth
  for (const [name, value] of [['from', from], ['to', to]] as const) {
    if (!/^\d{4}-\d{2}$/.test(value))
      return c.json({ error: `Invalid '${name}': "${value}". Use YYYY-MM.` }, 400)
  }
  // 'YYYY-MM' sorts lexicographically, so a plain string compare orders months.
  if (to < from)
    return c.json({ error: `'to' (${to}) is before 'from' (${from}).` }, 400)

  // Cost by category TYPE. Resolve each invoice line's real category from
  // generic_products (via product_entries name match, then direct name match,
  // then the line's own category), map that category → its type, defaulting an
  // unknown/unmatched category to 'food' (same convention as the Inventory
  // buckets). Only Closed, non-voided invoices dated in the month.
  const typeRows = await c.env.DB.prepare(`
    WITH line_cats AS (
      SELECT
        il.line_total AS amt,
        COALESCE(
          (SELECT gp.category FROM product_entries pe
             JOIN generic_products gp ON gp.id = pe.generic_product_id
            WHERE LOWER(TRIM(pe.generic_product_name)) = LOWER(TRIM(il.product_name))
              AND pe.org_id IS ? AND gp.org_id IS ? LIMIT 1),
          (SELECT gp.category FROM generic_products gp
            WHERE LOWER(TRIM(gp.name)) = LOWER(TRIM(il.product_name))
              AND gp.org_id IS ? LIMIT 1),
          il.category,
          ''
        ) AS category
      FROM invoice_lines il
      JOIN invoices i ON il.invoice_id = i.id
      WHERE i.status = 'Closed'
        AND i.voided_at IS NULL
        AND substr(i.invoice_date, 1, 7) BETWEEN ? AND ?
        AND i.org_id IS ? AND il.org_id IS ?
    )
    SELECT
      COALESCE(
        (SELECT c.type FROM categories c
          WHERE LOWER(TRIM(c.name)) = LOWER(TRIM(line_cats.category))
            AND c.org_id IS ? LIMIT 1),
        'food'
      ) AS type,
      TRIM(line_cats.category) AS category,
      SUM(COALESCE(amt, 0)) AS amount
    FROM line_cats
    GROUP BY type, category
  `).bind(org, org, org, from, to, org, org, org).all<{ type: string; category: string; amount: number }>()

  // Grouped by category as well as type so the statement can break the supplies
  // line down. Six built-in categories roll into it — packaging, disposables,
  // cleaning chemicals, linen, smallwares, office — and a single line labelled
  // for two of them reads as though the other four are missing from the P&L.
  // The type totals are unchanged: they are these rows summed.
  let food = 0, beverage = 0, supplies = 0
  const suppliesByCat = new Map<string, number>()
  // How much food cost is not really classified. Unmatched categories default to
  // 'food' (below and in the SQL), so a half-categorised invoice run shows up as
  // an alarming food-cost percentage with nothing on screen explaining why.
  //
  // Blank is NOT the only case, and it is not even the common one: inferCategory
  // returns 'Other' for every invoice line its keyword rules can't identify, so
  // 'Other' is where unrecognised items actually collect — a mop and a box of
  // gloves land there and are then counted as food. Counting blank alone made
  // the note miss exactly the population it exists to describe. 'Ingredients' is
  // the retired legacy value. Same placeholder set as the invoice import path
  // treats as "not really answered".
  //
  // Note this only widens what is REPORTED. Where the money lands is unchanged —
  // 'Other' still counts as food. Re-bucketing it would silently restate every
  // month a customer has already read.
  const PLACEHOLDER_CATEGORIES = new Set(['', 'other', 'ingredients'])
  let foodUncategorized = 0
  for (const r of (typeRows.results ?? [])) {
    const amt = r.amount ?? 0
    const cat = String(r.category || '').trim()
    if (r.type === 'beverage') beverage += amt
    else if (r.type === 'supplies') {
      supplies += amt
      const key = cat || 'Uncategorized'
      suppliesByCat.set(key, (suppliesByCat.get(key) ?? 0) + amt)
    } else {
      food += amt
      if (PLACEHOLDER_CATEGORIES.has(cat.toLowerCase())) foodUncategorized += amt
    }
  }

  // Invoice-level surcharges that are real running costs (delivery + fuel).
  // Taxes and refundable deposits are intentionally excluded from the P&L.
  const feeRow = await c.env.DB.prepare(`
    SELECT SUM(COALESCE(delivery, 0) + COALESCE(fuel_surcharge, 0)) AS fees
    FROM invoices
    WHERE status = 'Closed' AND voided_at IS NULL
      AND substr(invoice_date, 1, 7) BETWEEN ? AND ?
      AND org_id IS ?
  `).bind(from, to, org).first<{ fees: number }>()

  // Expense invoices (utilities, rent, insurance…): total by expense_category
  // for the month. These are operating costs, not COGS, and have no line items.
  const expRows = await c.env.DB.prepare(`
    SELECT COALESCE(NULLIF(TRIM(expense_category), ''), 'Other') AS category,
           SUM(COALESCE(total, 0)) AS amount
    FROM invoices
    WHERE invoice_kind = 'expense' AND status = 'Closed' AND voided_at IS NULL
      AND substr(invoice_date, 1, 7) BETWEEN ? AND ?
      AND org_id IS ?
    GROUP BY category
    ORDER BY amount DESC
  `).bind(from, to, org).all<{ category: string; amount: number }>()

  // Invoices dated in the period that are NOT yet Closed. Every cost query above
  // filters status='Closed', so these are silently absent from the statement —
  // and their absence makes the P&L look BETTER than reality (costs missing,
  // profit overstated). That is the wrong direction to be quiet about, so the
  // count comes back and the page says so. Voided invoices are genuinely
  // excluded and are not counted here.
  const pendingRow = await c.env.DB.prepare(`
    SELECT COUNT(*) AS n, SUM(COALESCE(total, 0)) AS amount
    FROM invoices
    WHERE status <> 'Closed' AND voided_at IS NULL
      AND substr(invoice_date, 1, 7) BETWEEN ? AND ?
      AND org_id IS ?
  `).bind(from, to, org).first<{ n: number; amount: number }>()

  const round2 = (n: number) => Math.round((n || 0) * 100) / 100

  // ── True COGS (stock-take adjusted) ──────────────────────────
  // Optional, "accurate mode" cost basis. Classic retail formula, per category
  // type: COGS = opening stock + purchases − closing stock. Turns lumpy
  // purchases into the cost of what was actually consumed.
  //   opening = value of the latest submitted stock take BEFORE the period start
  //   closing = value of the latest submitted stock take WITHIN/at the period end
  // A snapshot is valued from counted quantities × each product's cost per unit
  // as of that take's date (falling back to the latest known cost), with the
  // count converted into the unit that cost is quoted in — see valueTake.
  // Counted prep (a batch) and packed stock (a finished product) are valued by
  // what went INTO them, via explodeToRawMaterials, because nobody ever invoiced
  // a tub of sauce. They used to be counted and then priced at zero. If either
  // bracketing take is missing, `cogs.available` is false and the frontend stays
  // on the purchases basis.
  //
  // This is computed at READ time and nothing is stored, so the change re-values
  // every historical period the moment it ships. Accepted deliberately (2026-08-03,
  // user's call): every account carrying stock takes today is a test account, and
  // a cutoff date would be permanent complexity guarding history that does not
  // exist. If real customers ever need their reported months frozen, the answer
  // is to store the valuation at submit time, not to special-case a date here.
  const periodStart = `${from}-01`                             // first day of first month
  const [ty, tm] = to.split('-').map(Number)
  const periodEnd = `${to}-${String(new Date(Date.UTC(ty, tm, 0)).getUTCDate()).padStart(2, '0')}`  // last day of last month

  const closingTake = await c.env.DB.prepare(`
    SELECT id, date(submitted_at) AS d FROM stock_takes
    WHERE status = 'submitted' AND submitted_at IS NOT NULL AND date(submitted_at) <= ?
      AND org_id IS ?
    ORDER BY submitted_at DESC LIMIT 1
  `).bind(periodEnd, org).first<{ id: string; d: string }>()

  const openingTake = await c.env.DB.prepare(`
    SELECT id, date(submitted_at) AS d FROM stock_takes
    WHERE status = 'submitted' AND submitted_at IS NOT NULL AND date(submitted_at) < ?
      AND org_id IS ?
    ORDER BY submitted_at DESC LIMIT 1
  `).bind(periodStart, org).first<{ id: string; d: string }>()

  // Everything needed to price a count, fetched once per request and shared by
  // the opening and closing takes. Lazy, so a P&L that never reaches the COGS
  // branch pays nothing for it.
  let _pricing: Promise<{
    catType: Map<string, string>
    entries: Map<string, { cost_per_unit: number; pack_unit: string; purchase_date: string; created_at: string }[]>
    avgWeight: Map<string, number | null>
    prodCat: Map<string, string>
  }> | null = null
  const pricingCtx = () => (_pricing ??= (async () => {
    const [catRows, entryRows, prodRows] = await Promise.all([
      c.env.DB.prepare(`SELECT name, type FROM categories WHERE org_id IS ?`).bind(org).all<{ name: string; type: string }>(),
      c.env.DB.prepare(
        `SELECT generic_product_id, cost_per_unit, pack_unit, purchase_date, created_at
           FROM product_entries WHERE org_id IS ? AND voided_at IS NULL`
      ).bind(org).all<{ generic_product_id: string; cost_per_unit: number; pack_unit: string; purchase_date: string; created_at: string }>(),
      c.env.DB.prepare(`SELECT id, avg_weight_per_unit, category FROM generic_products WHERE org_id IS ?`)
        .bind(org).all<{ id: string; avg_weight_per_unit: number | null; category: string | null }>(),
    ])

    const catType = new Map<string, string>()
    for (const r of (catRows.results ?? [])) catType.set(String(r.name || '').trim().toLowerCase(), r.type || 'food')

    // Newest purchase first, so "latest on or before a date" is the first match.
    const entries = new Map<string, any[]>()
    for (const e of (entryRows.results ?? [])) {
      if (!entries.has(e.generic_product_id)) entries.set(e.generic_product_id, [])
      entries.get(e.generic_product_id)!.push(e)
    }
    for (const list of entries.values()) {
      list.sort((a, b) => (b.purchase_date || '').localeCompare(a.purchase_date || '')
                       || (b.created_at || '').localeCompare(a.created_at || ''))
    }

    const avgWeight = new Map<string, number | null>()
    // Raw materials reached by exploding a batch or a packed product arrive with
    // no category of their own — a stock_take_items row carries one, a recipe
    // line does not — so food/beverage has to come from the product itself.
    const prodCat = new Map<string, string>()
    for (const p of (prodRows.results ?? [])) {
      avgWeight.set(p.id, p.avg_weight_per_unit != null ? Number(p.avg_weight_per_unit) : null)
      prodCat.set(p.id, String(p.category || ''))
    }
    return { catType, entries, avgWeight, prodCat }
  })())

  // Recipes and finished-product BOMs, for valuing counted prep. Lazy and
  // memoized like pricingCtx — a P&L with no prep counted never reads them.
  let _explode: Promise<ExplodeCtx> | null = null
  const explodeCtx = () => (_explode ??= buildExplodeCtx(c.env.DB, org))

  // Value one stock take's raw-material counts, grouped into food/beverage.
  // asOfDate prices each product at its most recent purchase on/before that date.
  //
  // The count and the price are in DIFFERENT UNITS and must be reconciled before
  // multiplying: counted_qty is in the bin's unit, cost_per_unit is per the
  // *pack* unit it was invoiced in. Potatoes invoiced at $1.65/lb and counted as
  // 50 kg in the walk-in are worth $181.50, not the $82.50 a straight multiply
  // gives — and unlike prepped stock, this error does not cancel between the
  // opening and closing takes, because it scales with what is on hand. The
  // Inventory page has always converted here (invConvertUnitCost); this valuation
  // did not, so the two disagreed about the same shelf.
  const valueTake = async (takeId: string, asOfDate: string) => {
    const { catType, entries, avgWeight, prodCat } = await pricingCtx()

    const rows = await c.env.DB.prepare(
      `SELECT item_id, item_type, category, unit, counted_qty
         FROM stock_take_items
        WHERE stock_take_id = ? AND counted_qty IS NOT NULL AND org_id IS ?`
    ).bind(takeId, org).all<{ item_id: string; item_type: string; category: string; unit: string; counted_qty: number }>()

    let f = 0, b = 0

    // Price one raw-material quantity into the food/beverage totals. Shared by
    // the counted raw materials and by the raw materials found inside counted
    // prep, so both are valued by identical rules.
    const priceInto = (productId: string, qty: number, unit: string, category: string) => {
      if (!(qty > 0)) return

      const list = entries.get(productId) || []
      // Same precedence the SQL used: newest purchase on or before the take's
      // date, else the newest known purchase at all.
      const dated = list.find(e => e.purchase_date && e.purchase_date <= asOfDate)
      const entry = dated || list[0]
      if (!entry) return

      const rate = Number(entry.cost_per_unit) || 0
      if (!(rate > 0)) return

      const binUnit = String(unit || '').trim()
      const packUnit = String(entry.pack_unit || '').trim()
      // A pair that cannot be bridged (a 'case' price against a kg count) keeps
      // the unconverted figure rather than dropping to zero — no worse than
      // before, and zeroing it would understate closing stock and overstate COGS.
      const converted = (binUnit && packUnit)
        ? convertUnitCost(rate, packUnit, binUnit, avgWeight.get(productId) ?? null)
        : null
      const val = qty * (converted ?? rate)

      const type = catType.get(String(category || '').trim().toLowerCase()) || 'food'
      if (type === 'beverage') b += val
      else if (type === 'supplies') { /* supplies aren't part of COGS */ }
      else f += val
    }

    const counted = (rows.results ?? []).filter(r => (Number(r.counted_qty) || 0) > 0)

    // Prep and packed stock are valued by what went INTO them, because nobody
    // ever invoiced a tub of sauce. Before this they were counted and then
    // priced at zero, so every kilo of prep in the walk-in was invisible to
    // closing stock and inflated COGS by its whole value.
    const hasPrep = counted.some(r => r.item_type !== 'raw_material')
    const ctx = hasPrep ? await explodeCtx() : null

    for (const r of counted) {
      const qty = Number(r.counted_qty) || 0

      if (r.item_type === 'raw_material') {
        priceInto(r.item_id, qty, r.unit, r.category)
        continue
      }

      for (const d of explodeToRawMaterials(r.item_type, r.item_id, qty, r.unit, ctx!)) {
        priceInto(d.item_id, d.qty, d.unit, prodCat.get(d.item_id) || '')
      }
    }

    return { food: f, beverage: b }
  }

  // True COGS is a Pro feature. An Essential account normally has no stock takes
  // to bracket the period anyway, but one that was downgraded from Pro still has
  // its history — so gate explicitly rather than relying on the data being
  // absent. Reported as its own reason so the UI can offer an upgrade instead of
  // "go and do a stock take", which they cannot do on this plan.
  const pnlUser = c.get('user') as SessionUser | undefined
  const trueCogsAllowed = !pnlUser
    || pnlUser.role === 'super_admin'
    || planFeatures(pnlUser.org_plan).has('true_cogs')

  // Available only when we have a beginning count (before the period) AND an
  // ending count that actually falls inside the period (not one from before it).
  const cogsAvailable = trueCogsAllowed
    && !!openingTake && !!closingTake && closingTake.d >= periodStart
  let cogs: Record<string, unknown> = {
    available: false,
    reason: !trueCogsAllowed
      ? 'upgrade_required'                      // Pro feature, not a missing count
      : !closingTake || (closingTake && closingTake.d < periodStart)
      ? 'no_closing_take'                       // no stock take within the period
      : !openingTake ? 'no_opening_take'        // none before the period start
      : 'ok',
  }
  if (cogsAvailable) {
    const opening = await valueTake(openingTake!.id, openingTake!.d)
    const closing = await valueTake(closingTake!.id, closingTake!.d)
    cogs = {
      available:     true,
      opening_date:  openingTake!.d,
      closing_date:  closingTake!.d,
      opening_food:     round2(opening.food),
      opening_beverage: round2(opening.beverage),
      closing_food:     round2(closing.food),
      closing_beverage: round2(closing.beverage),
      food_cogs:     round2(food + opening.food - closing.food),
      beverage_cogs: round2(beverage + opening.beverage - closing.beverage),
    }
  }

  // ── Imported POS revenue, per month ──────────────────────────
  // DERIVED, never written into sales_monthly. Two writers of one number is the
  // bug: sales_monthly stays purely the hand-typed figure, and this is purely
  // what the till reported. Which of the two the P&L shows is decided in the
  // frontend from revenue_source, so voiding an import flips a month back to
  // the typed figure on its own — this query simply stops returning it.
  //
  // The category join is the first real use of the food/beverage split reserved
  // in 0022. Unmatched categories fall to food, which is what /api/pnl already
  // does for invoice lines.
  const impRows = await c.env.DB.prepare(`
    SELECT substr(l.sold_date, 1, 7) AS period,
           SUM(l.net_sales)          AS net,
           SUM(l.gross_sales)        AS gross,
           SUM(CASE WHEN COALESCE(cat.type, 'food') = 'beverage' THEN l.net_sales ELSE 0 END) AS beverage,
           SUM(CASE WHEN COALESCE(cat.type, 'food') = 'beverage' THEN 0 ELSE l.net_sales END) AS food,
           COUNT(*)                  AS lines
      FROM pos_sale_lines l
      JOIN pos_imports i ON i.id = l.import_id
      LEFT JOIN categories cat
             ON LOWER(TRIM(cat.name)) = LOWER(TRIM(l.pos_category))
            AND cat.org_id IS ?
     WHERE l.voided_at IS NULL
       AND i.status = 'Closed'
       AND i.voided_at IS NULL
       AND substr(l.sold_date, 1, 7) BETWEEN ? AND ?
       AND l.org_id IS ?
       AND i.org_id IS ?
     GROUP BY period
  `).bind(org, from, to, org, org).all()

  const salesByMonth: Record<string, any> = {}
  let importedTotal = 0
  for (const r of (impRows.results ?? []) as any[]) {
    salesByMonth[r.period] = {
      imported_net:   round2(r.net ?? 0),
      imported_gross: round2(r.gross ?? 0),
      food:           round2(r.food ?? 0),
      beverage:       round2(r.beverage ?? 0),
      lines:          r.lines ?? 0,
    }
    importedTotal += Number(r.net) || 0
  }

  return c.json({
    from,
    to,
    month: from === to ? from : undefined,
    sales: { by_month: salesByMonth, imported_total: round2(importedTotal) },
    food_cost:     round2(food),
    beverage_cost: round2(beverage),
    supplies_cost: round2(supplies),
    // Biggest first — the breakdown is there to answer "what IS this?", and the
    // largest contributor answers it fastest.
    supplies_breakdown: [...suppliesByCat.entries()]
      .map(([category, amount]) => ({ category, amount: round2(amount) }))
      .filter(r => r.amount !== 0)
      .sort((a, b) => b.amount - a.amount),
    food_uncategorized: round2(foodUncategorized),
    pending_invoices: {
      count:  Number(pendingRow?.n ?? 0),
      amount: round2(pendingRow?.amount ?? 0),
    },
    invoice_fees:  round2(feeRow?.fees ?? 0),
    expense_invoices: (expRows.results ?? []).map(r => ({
      category: r.category ?? 'Other',
      amount:   round2(r.amount ?? 0),
    })),
    cogs,
  })
})

export default app