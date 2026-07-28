import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  DB: D1Database
  FILES: R2Bucket
  ANTHROPIC_API_KEY: string     // secret set via wrangler / .dev.vars
  SESSION_SECRET: string        // secret — signs session cookies; see auth section
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
  }

  // Downstream handlers read the caller from here rather than re-querying.
  c.set('user', me)
  await next()
})

// ─── Helper: generate uid ─────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
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
}

// Resolves the caller from their cookie, or null when signed out. Reads the
// user fresh each time so archiving a user takes effect immediately.
async function currentUser(c: any): Promise<SessionUser | null> {
  const secret = c.env.SESSION_SECRET
  if (!secret) return null
  const token = readCookie(c.req.header('cookie'), SESSION_COOKIE)
  const session = await readSession(secret, token)
  if (!session) return null
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.org_id, u.name,
            o.name AS org_name, o.account_type,
            o.suspended_at   AS org_suspended_at,
            o.archived_at    AS org_archived_at,
            o.suspend_reason AS org_suspend_reason
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

// Classify a candidate vendor name against existing suppliers:
//   auto    → near-identical, safe to snap silently (≥ 0.88 or normalized-equal)
//   suggest → plausible but confirm first (≥ 0.70, or token-contained)
//   none    → treat as a new supplier
function classifySupplierMatch(
  name: string,
  suppliers: { id: string; name: string }[]
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
  if (bestScore >= 0.88) return { decision: 'auto', match: best, score: bestScore }
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
// Cosmetic normalization only — every unit conversion elsewhere is already
// case-insensitive, so this changes display casing, never math. Lowercases the
// unit, except litre which uses the SI symbol 'L' (a lowercase 'l' reads as a 1).
// Applied to parsed invoice units so imports stay consistent (e.g. "LB" → "lb",
// "KG" → "kg", "Each" → "each"). Custom multi-word units pass through lowercased.
function normalizeUnit(u: string): string {
  const t = (u || '').trim()
  if (!t) return t
  if (t.toLowerCase() === 'l') return 'L'
  return t.toLowerCase()
}

function parsePackSize(raw: string): { packQty: number; packUnit: string } {
  const s = (raw || '').trim()
  if (!s) return { packQty: 1, packUnit: normalizeUnit('each') }

  // Known measurable unit pattern (case-insensitive)
  const unitPat = '(?:kg|g|lb|lbs|l|ml|oz|fl\\s*oz|gal)'

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

// ─── Helper: infer product category from name via keyword matching ─
// Best-effort classification for invoice auto-import. Keep the returned labels
// in sync with DEFAULT_CATEGORIES in public/static/utils.js (the frontend list).
// Rules are ordered most-specific first — the first keyword hit wins — so more
// distinctive food groups (seafood, meat, dairy) are matched before broad ones
// (produce, dry goods). Unmatched items fall to 'Other' rather than being
// silently dumped into a food bucket.
function inferCategory(name: string): string {
  const n = name.toLowerCase()
  const rules: [string, string[]][] = [
    // ── Food (COGS) ──
    ['Seafood',                    ['fish','salmon','tuna','shrimp','prawn','crab','lobster','oyster','mussel','clam','scallop','squid','calamari','cod','halibut','tilapia','anchovy','seafood']],
    ['Meat & Poultry',             ['beef','pork','chicken','turkey','lamb','veal','bacon','sausage','prosciutto','salami','pepperoni','ham','duck','steak','brisket','ribs','poultry','meat']],
    ['Dairy & Eggs',               ['milk','cream','butter','cheese','yogurt','yoghurt','egg','mozzarella','parmesan','parmigiano','cheddar','ricotta','mascarpone','buttermilk','dairy']],
    ['Bakery',                     ['bread','bun','bagel','baguette','brioche','croissant','pastry','tortilla','dough','crust','bakery']],
    ['Frozen',                     ['frozen','ice cream','gelato','sorbet']],
    ['Oils, Sauces & Condiments',  ['olive oil','canola','vinegar','sauce','ketchup','mustard','mayo','mayonnaise','dressing','condiment']],
    ['Spices & Seasonings',        ['spice','seasoning','cinnamon','cumin','paprika','oregano','nutmeg','turmeric','pepper corn','peppercorn','sea salt','kosher salt']],
    ['Produce',                    ['lettuce','tomato','onion','potato','carrot','garlic','mushroom','spinach','kale','cucumber','celery','avocado','apple','lemon','lime','berry','banana','herb','produce','vegetable','fruit']],
    ['Dry Goods & Pantry',        ['flour','sugar','rice','pasta','noodle','bean','lentil','chickpea','grain','oat','quinoa','cereal','cornstarch','baking','yeast','canned','pantry']],
    // ── Beverage ──
    ['Alcohol',                    ['wine','beer','spirit','liquor','vodka','whiskey','whisky','rum','gin','tequila','alcohol']],
    ['Non-Alcoholic Beverages',    ['juice','water','soda','pop','coffee','tea','syrup','cordial','soft drink','beverage']],
    // ── Operating supplies ──
    ['Cleaning & Sanitation',      ['cleaner','sanitizer','sanitiser','soap','detergent','bleach','disinfectant','degreaser','cleaning']],
    ['Disposables',                ['glove','napkin','tissue','straw','cutlery','disposable','paper towel','food wrap','deli container']],
    ['Packaging',                  ['box','bag','wrap','film','pail','jar','bottle','carton','clamshell','packaging','label']],
    ['Linen & Uniforms',           ['towel','apron','uniform','tablecloth','rag','linen']],
    ['Smallwares & Equipment',     ['pan','pot','knife','sheet tray','whisk','spatula','tong','utensil','smallware','equipment']],
    ['Office & Admin',             ['printer','ink','toner','stationery','pen ','envelope','office']],
  ]
  for (const [category, keywords] of rules) {
    if (keywords.some(k => n.includes(k))) return category
  }
  return 'Other'
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
  }
}

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
    `SELECT u.id, u.email, u.role, u.org_id, u.name,
            o.name AS org_name, o.account_type,
            o.suspended_at   AS org_suspended_at,
            o.archived_at    AS org_archived_at,
            o.suspend_reason AS org_suspend_reason
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

app.get('/api/admin/organizations', async (c) => {
  if (!await requireSuperAdmin(c)) return c.json({ error: 'Not authorized.' }, 403)
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.name, o.account_type, o.created_at, o.archived_at,
            o.suspended_at, o.suspend_reason,
            (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id AND u.archived_at IS NULL) AS user_count,
            (SELECT email FROM users u WHERE u.org_id = o.id AND u.role = 'owner'
              ORDER BY u.created_at LIMIT 1) AS owner_email
       FROM organizations o
      ORDER BY o.created_at DESC`,
  ).all()
  return c.json({ data: results || [] })
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

  // Both inserts in one batch so a failure can't leave an organization with
  // no owner (D1 runs a batch as a transaction).
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO organizations (id, name, account_type) VALUES (?, ?, ?)`)
      .bind(orgId, name, accountType),
    c.env.DB.prepare(
      `INSERT INTO users (id, org_id, email, password_hash, password_salt, password_iter, role, name)
       VALUES (?, ?, ?, ?, ?, ?, 'owner', ?)`,
    ).bind(userId, orgId, email, hash, salt, PBKDF2_ITERATIONS, String(body.owner_name || '')),
  ])

  return c.json({ ok: true, organization: { id: orgId, name, account_type: accountType },
                  owner: { id: userId, email } })
})

// ── Account lifecycle: suspend / restore / archive / purge ────
// Three severities, deliberately separate buttons rather than one destructive
// "delete". See migration 0037 for the state definitions.

// Behind on payment. Read-only from their side; instantly reversible.
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
  'operating_expenses', 'product_aliases', 'product_entries', 'product_mappings',
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
  'sales_monthly', 'operating_expenses', 'recurring_expenses', 'spread_expenses'
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
  return c.json(classifySupplierMatch(name, all.results || []))
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

  // ── Guard: reject unit-less pack sizes before writing anything ──
  // A pack size with no unit of measure ("2" instead of "2 kg") would be
  // silently stored as "each" with a meaningless cost_per_unit, breaking Price
  // Movers, recipe costing and FIFO. Fail fast, name the offenders, and write
  // nothing — the invoice review UI blocks this too, so this is defense-in-depth.
  const unitless = body.products
    .filter(p => String(p.name || '').trim())
    .filter(p => !packSizeHasUnit(String(p.pack_size || '')))
    .map(p => String(p.name).trim())
  if (unitless.length) {
    return c.json({
      error: `Missing a unit of measure: ${unitless.join(', ')}. `
           + `Set a unit (e.g. kg, L, each) before saving.`,
      unitless,
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
      const m = classifySupplierMatch(vendorName, all.results || [])
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

  for (const p of body.products) {
    const name = (p.name as string || '').trim()
    if (!name) continue

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
        `INSERT INTO generic_products (id, name, category, sub_unit_name, sub_unit_qty, org_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        genericId,
        name,
        category,
        (p.sub_unit_name as string) || '',
        p.sub_unit_qty ?? null,
        org
      ).run()
      createdGenerics++
    }

    // 2. Always add a new product_entry for this purchase
    const entryId = uid()
    const today   = new Date().toISOString().slice(0, 10)
    const cost        = parseFloat(p.cost as string) || 0
    const qtyOrdered  = parseFloat(p.qty  as string) || 1
    // Split pack_size string into pack_qty + pack_unit, handling complex formats:
    //   "500g"        → 500, "g"
    //   "2 kg"        → 2, "kg"
    //   "12 LB"       → 12, "LB"
    //   "1 × 1.89L"   → 1.89, "L"    (multiplied: 1 × 1.89)
    //   "6 x 100OZ"   → 600, "OZ"   (multiplied: 6 × 100)
    //   "1/5 KG CS"   → 5, "KG"     (fraction notation: qty/size UNIT)
    //   "12 Each"     → 12, "Each"
    const { packQty, packUnit } = parsePackSize((p.pack_size as string) || '')

    // cost_per_unit: line_total ÷ (pack_qty × qty_ordered) gives price per standard unit.
    // e.g. 3 bags × 5 LB/bag at $53.28 total → $53.28 ÷ 15 lb = $3.55/lb
    // e.g. 4 bags × 12 LB/bag at $111.84 total → $111.84 ÷ 48 lb = $2.33/lb
    // For "Each" or non-standard units, cost per each = cost / qty_ordered
    const totalUnits = packQty * qtyOrdered
    const costPerUnit = totalUnits > 0
      ? Math.round((cost / totalUnits) * 100) / 100
      : cost

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

  return c.json({
    saved,
    created_generics:  createdGenerics,
    reused_generics:   reusedGenerics,
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

// ─── Product combine helpers (shared by Merge and Group) ──────
// Combine one product's data into another: re-link purchase history, pool
// inventory, re-link recipes, cascade the surviving name to every denormalized
// copy, then soft-delete the absorbed product. Extracted so Merge (duplicates)
// and Group (interchangeable items) stay identical under the hood — including
// the full name cascade.
// `org` is threaded through rather than filtered at the call site: every
// statement below matches on id OR name, so an unscoped one would rewrite
// another business's history.
async function mergeInto(
  db: D1Database,
  merged: { id: string; name: string },
  surviving: { id: string; name: string },
  org: string | null
) {
  // 1. Re-link product_entries (the purchase/cost history)
  await db.prepare(
    'UPDATE product_entries SET generic_product_id = ?, generic_product_name = ? WHERE generic_product_id = ? AND org_id IS ?'
  ).bind(surviving.id, surviving.name, merged.id, org).run()

  // 2. Merge inventory rows (pool the stock into one bin)
  const mergedInv = await db.prepare('SELECT id, quantity FROM inventory WHERE item_id = ? AND org_id IS ?')
    .bind(merged.id, org).first<{ id: string; quantity: number }>()
  if (mergedInv) {
    const survivingInv = await db.prepare('SELECT id FROM inventory WHERE item_id = ? AND org_id IS ?')
      .bind(surviving.id, org).first<{ id: string }>()
    if (survivingInv) {
      await db.prepare('UPDATE inventory SET quantity = quantity + ? WHERE item_id = ? AND org_id IS ?')
        .bind(mergedInv.quantity, surviving.id, org).run()
      await db.prepare('DELETE FROM inventory WHERE item_id = ? AND org_id IS ?').bind(merged.id, org).run()
    } else {
      // No surviving inventory row — reassign the merged row
      await db.prepare('UPDATE inventory SET item_id = ?, item_name = ? WHERE item_id = ? AND org_id IS ?')
        .bind(surviving.id, surviving.name, merged.id, org).run()
    }
  }

  // 3. Re-link recipe_items
  await db.prepare('UPDATE recipe_items SET product_id = ?, product_name = ? WHERE product_id = ? AND org_id IS ?')
    .bind(surviving.id, surviving.name, merged.id, org).run()

  // 3b. Cascade the surviving identity to the remaining tables where the merged
  // product's name/id is denormalized (invoice_lines, product_mappings, stock_log).
  // Without this the absorbed rows keep the old name and stock_log keeps pointing
  // at the now-deleted product id, so spending breakdown / stock history drift.
  await db.batch([
    db.prepare(
      `UPDATE invoice_lines SET generic_product_id = ?, product_name = ?
        WHERE (generic_product_id = ? OR LOWER(TRIM(product_name)) = LOWER(TRIM(?))) AND org_id IS ?`
    ).bind(surviving.id, surviving.name, merged.id, merged.name, org),
    db.prepare('UPDATE product_mappings SET corrected_name = ? WHERE LOWER(TRIM(corrected_name)) = LOWER(TRIM(?)) AND org_id IS ?')
      .bind(surviving.name, merged.name, org),
    db.prepare('UPDATE stock_log SET item_id = ?, item_name = ? WHERE item_id = ? AND org_id IS ?')
      .bind(surviving.id, surviving.name, merged.id, org),
  ])

  // 4. Soft-delete the merged product
  await db.prepare("UPDATE generic_products SET deleted_at = datetime('now') WHERE id = ? AND org_id IS ?")
    .bind(merged.id, org).run()
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

  let grouped = 0
  for (const p of products) {
    if (p.id === survivor.id) continue
    await mergeInto(c.env.DB, p, surviving, org)
    // Remember the absorbed name so future invoices with that wording route in.
    const aliasName = p.name.trim()
    if (aliasName && aliasName.toLowerCase() !== generalName.toLowerCase()) {
      const dup = await c.env.DB.prepare(
        'SELECT id FROM product_aliases WHERE generic_product_id = ? AND LOWER(TRIM(alias_name)) = LOWER(TRIM(?)) AND supplier_id IS NULL AND org_id IS ?'
      ).bind(survivor.id, aliasName, org).first()
      if (!dup) {
        await c.env.DB.prepare(
          'INSERT INTO product_aliases (id, alias_name, generic_product_id, supplier_id, org_id) VALUES (?, ?, ?, NULL, ?)'
        ).bind(uid(), aliasName, survivor.id, org).run()
      }
    }
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
    unit: string
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
    let g = groups.get(pid)
    if (!g) {
      g = {
        product_id:   pid,
        product_name: String(r.product_name || ''),
        unit:         stockUnit,
        purchases:    []
      }
      groups.set(pid, g)
    }
    const cpu   = Number(r.cost_per_unit || 0)
    const avgW  = r.avg_weight != null ? Number(r.avg_weight) : null
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
        max_tokens: 16000,
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
    }
    const text = (data.content || []).find(b => b.type === 'text')?.text || ''

    // Strip markdown code fences if present
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()

    const parsed = JSON.parse(cleaned)

    // Claude Opus 4.8 pricing: $5/MTok input, $25/MTok output (output includes
    // adaptive-thinking tokens — there is no separate thinking rate).
    const inputTokens  = data.usage?.input_tokens  || 0
    const outputTokens = data.usage?.output_tokens || 0
    const cost = Math.round(((inputTokens / 1_000_000) * 5 + (outputTokens / 1_000_000) * 25) * 1_000_000) / 1_000_000

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
        // 16000 matches parse-invoice and stays clear of non-streaming timeouts.
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as { error?: { message?: string } }
      return c.json({ error: err?.error?.message || `Claude API error ${response.status}` }, 502)
    }

    const data = await response.json() as { content: Array<{ type: string; text?: string }> }
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
      SUM(COALESCE(amt, 0)) AS amount
    FROM line_cats
    GROUP BY type
  `).bind(org, org, org, from, to, org, org, org).all<{ type: string; amount: number }>()

  let food = 0, beverage = 0, supplies = 0
  for (const r of (typeRows.results ?? [])) {
    const amt = r.amount ?? 0
    if (r.type === 'beverage') beverage += amt
    else if (r.type === 'supplies') supplies += amt
    else food += amt
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

  const round2 = (n: number) => Math.round((n || 0) * 100) / 100

  // ── True COGS (stock-take adjusted) ──────────────────────────
  // Optional, "accurate mode" cost basis. Classic retail formula, per category
  // type: COGS = opening stock + purchases − closing stock. Turns lumpy
  // purchases into the cost of what was actually consumed.
  //   opening = value of the latest submitted stock take BEFORE the period start
  //   closing = value of the latest submitted stock take WITHIN/at the period end
  // A snapshot is valued from raw-material counts × each product's cost per unit
  // as of that take's date (falling back to the latest known cost). Batches and
  // finished goods are not valued here (raw materials only) — kept honest in the
  // UI. If either bracketing take is missing, `cogs.available` is false and the
  // frontend stays on the purchases basis.
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

  // Value one stock take's raw-material counts, grouped into food/beverage.
  // asOfDate prices each product at its most recent purchase on/before that date.
  const valueTake = async (takeId: string, asOfDate: string) => {
    const rows = await c.env.DB.prepare(`
      WITH valued AS (
        SELECT
          COALESCE(
            (SELECT c.type FROM categories c
              WHERE LOWER(TRIM(c.name)) = LOWER(TRIM(sti.category))
                AND c.org_id IS ? LIMIT 1),
            'food'
          ) AS type,
          sti.counted_qty * COALESCE(
            (SELECT pe.cost_per_unit FROM product_entries pe
              WHERE pe.generic_product_id = sti.item_id AND pe.voided_at IS NULL
                AND pe.purchase_date != '' AND pe.purchase_date <= ?
                AND pe.org_id IS ?
              ORDER BY pe.purchase_date DESC, pe.created_at DESC LIMIT 1),
            (SELECT pe.cost_per_unit FROM product_entries pe
              WHERE pe.generic_product_id = sti.item_id AND pe.voided_at IS NULL
                AND pe.org_id IS ?
              ORDER BY pe.purchase_date DESC, pe.created_at DESC LIMIT 1),
            0
          ) AS val
        FROM stock_take_items sti
        WHERE sti.stock_take_id = ? AND sti.item_type = 'raw_material'
          AND sti.counted_qty IS NOT NULL
          AND sti.org_id IS ?
      )
      SELECT type, SUM(COALESCE(val, 0)) AS amount FROM valued GROUP BY type
    `).bind(org, asOfDate, org, org, takeId, org).all<{ type: string; amount: number }>()
    let f = 0, b = 0
    for (const r of (rows.results ?? [])) {
      if (r.type === 'beverage') b += r.amount ?? 0
      else if (r.type === 'supplies') { /* supplies aren't part of COGS */ }
      else f += r.amount ?? 0
    }
    return { food: f, beverage: b }
  }

  // Available only when we have a beginning count (before the period) AND an
  // ending count that actually falls inside the period (not one from before it).
  const cogsAvailable = !!openingTake && !!closingTake && closingTake.d >= periodStart
  let cogs: Record<string, unknown> = {
    available: false,
    reason: !closingTake || (closingTake && closingTake.d < periodStart)
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

  return c.json({
    from,
    to,
    month: from === to ? from : undefined,
    food_cost:     round2(food),
    beverage_cost: round2(beverage),
    supplies_cost: round2(supplies),
    invoice_fees:  round2(feeRow?.fees ?? 0),
    expense_invoices: (expRows.results ?? []).map(r => ({
      category: r.category ?? 'Other',
      amount:   round2(r.amount ?? 0),
    })),
    cogs,
  })
})

export default app