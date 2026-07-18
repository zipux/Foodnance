import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  DB: D1Database
  FILES: R2Bucket
  ANTHROPIC_API_KEY: string     // secret set via wrangler / .dev.vars
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors())

// ─── Helper: generate uid ─────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
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
function parsePackSize(raw: string): { packQty: number; packUnit: string } {
  const s = (raw || '').trim()
  if (!s) return { packQty: 1, packUnit: 'Each' }

  // Known measurable unit pattern (case-insensitive)
  const unitPat = '(?:kg|g|lb|lbs|l|ml|oz|fl\\s*oz|gal)'

  // Pattern 1: "N × N UNIT" or "N x N UNIT" (e.g. "1 × 1.89L", "6 x 100OZ", "6x100 OZ")
  const multMatch = s.match(
    new RegExp(`^([\\d.]+)\\s*[×xX]\\s*([\\d.]+)\\s*(${unitPat})\\b`, 'i')
  )
  if (multMatch) {
    const a = parseFloat(multMatch[1]) || 1
    const b = parseFloat(multMatch[2]) || 1
    return { packQty: Math.round(a * b * 1000) / 1000, packUnit: multMatch[3].trim() }
  }

  // Pattern 2: "N/N UNIT" fraction notation (e.g. "1/5 KG CS" → 5 KG)
  // The second number is the actual pack size
  const fracMatch = s.match(
    new RegExp(`^([\\d.]+)\\s*/\\s*([\\d.]+)\\s*(${unitPat})\\b`, 'i')
  )
  if (fracMatch) {
    return { packQty: parseFloat(fracMatch[2]) || 1, packUnit: fracMatch[3].trim() }
  }

  // Pattern 3: simple "N UNIT" or "NUNIT" (e.g. "12 LB", "500g", "5L", "1.89 L")
  const simpleMatch = s.match(/^([\d.]+)\s*(.*)$/)
  if (simpleMatch) {
    const qty  = parseFloat(simpleMatch[1]) || 1
    const unit = (simpleMatch[2] || 'Each').trim()
    return { packQty: qty, packUnit: unit }
  }

  // Fallback: no number found — treat entire string as unit
  return { packQty: 1, packUnit: s || 'Each' }
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

  let where = ''
  const args: string[] = []
  const filterEntries = Object.entries(filters)
  if (filterEntries.length) {
    where = 'WHERE ' + filterEntries.map(([k]) => `${k} = ?`).join(' AND ')
    filterEntries.forEach(([, v]) => args.push(v))
  }

  // Hide voided product entries by default — a voided invoice's purchases must
  // not count toward Latest Price / costing anywhere they're read. (Restore
  // clears the flag and they reappear.)
  if (table === 'product_entries') {
    where = where ? `${where} AND voided_at IS NULL` : 'WHERE voided_at IS NULL'
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
  const row = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// Tables that use INTEGER PRIMARY KEY AUTOINCREMENT — don't inject a UUID id
const INTEGER_PK_TABLES = ['units', 'categories']

// ── Insert
app.post('/api/tables/:table', async (c) => {
  const table = c.req.param('table')
  if (!ALLOWED_TABLES.includes(table)) return c.json({ error: 'Unknown table' }, 400)
  const body = await c.req.json() as Record<string, unknown>
  if (!body.id && !INTEGER_PK_TABLES.includes(table)) body.id = uid()
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
  const body = await c.req.json() as Record<string, unknown>
  body.id = id
  const keys = Object.keys(body)
  const vals = Object.values(body)
  const setCols = keys.map(k => `${k} = ?`).join(', ')
  await c.env.DB.prepare(`UPDATE ${table} SET ${setCols} WHERE id = ?`).bind(...vals, id).run()
  return c.json({ id, ...body })
})

// ── Partial update (PATCH)
app.patch('/api/tables/:table/:id', async (c) => {
  const { table, id } = c.req.param()
  if (!ALLOWED_TABLES.includes(table)) return c.json({ error: 'Unknown table' }, 400)
  const body = await c.req.json() as Record<string, unknown>
  const keys = Object.keys(body)
  if (!keys.length) return c.json({ error: 'No fields to update' }, 400)
  const setCols = keys.map(k => `${k} = ?`).join(', ')
  await c.env.DB.prepare(`UPDATE ${table} SET ${setCols} WHERE id = ?`).bind(...Object.values(body), id).run()
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
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM product_aliases WHERE generic_product_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM inventory WHERE item_id = ?').bind(id),
    c.env.DB.prepare("UPDATE generic_products SET deleted_at = datetime('now') WHERE id = ?").bind(id),
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

  const current = await c.env.DB.prepare('SELECT name FROM generic_products WHERE id = ?')
    .bind(id).first<{ name: string }>()
  if (!current) return c.json({ error: 'Product not found' }, 404)
  const oldName = current.name

  await c.env.DB.prepare(
    `UPDATE generic_products
       SET name = ?, category = ?, sub_unit_name = ?, sub_unit_qty = ?, avg_weight_per_unit = ?,
           reorder_level = ?, reorder_unit = ?,
           base_unit = ?, mid_name = ?, mid_lb = ?, top_name = ?, top_lb = ?
     WHERE id = ?`
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
    id
  ).run()

  // Always keep the raw-material inventory row in sync with the product's live
  // name AND category. Category is denormalized onto the inventory row and is
  // NOT matched by name anywhere, so it must be pushed here or the Inventory
  // page (badges + category chips) drifts from the Products page.
  await c.env.DB.prepare(
    "UPDATE inventory SET item_name = ?, category = ? WHERE item_id = ? AND item_type = 'raw_material'"
  ).bind(newName, body.category ?? '', id).run()

  // Cascade the name only when it actually changed (ignoring case/space) to the
  // remaining tables where the name is denormalized. (inventory is handled above,
  // unconditionally, since it also carries category.)
  if (oldName.trim().toLowerCase() !== newName.toLowerCase()) {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE product_entries SET generic_product_name = ? WHERE generic_product_id = ? OR LOWER(TRIM(generic_product_name)) = LOWER(TRIM(?))'
      ).bind(newName, id, oldName),
      c.env.DB.prepare(
        'UPDATE invoice_lines SET product_name = ? WHERE LOWER(TRIM(product_name)) = LOWER(TRIM(?))'
      ).bind(newName, oldName),
      c.env.DB.prepare(
        'UPDATE product_mappings SET corrected_name = ? WHERE LOWER(TRIM(corrected_name)) = LOWER(TRIM(?))'
      ).bind(newName, oldName),
      c.env.DB.prepare(
        'UPDATE recipe_items SET product_name = ? WHERE product_id = ?'
      ).bind(newName, id),
      c.env.DB.prepare(
        'UPDATE stock_log SET item_name = ? WHERE item_id = ?'
      ).bind(newName, id),
    ])
  }

  return c.json({ id, name: newName })
})

// ── Delete
app.delete('/api/tables/:table/:id', async (c) => {
  const { table, id } = c.req.param()
  if (!ALLOWED_TABLES.includes(table)) return c.json({ error: 'Unknown table' }, 400)
  await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run()
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
  const inv = await c.env.DB.prepare('SELECT id FROM invoices WHERE id = ?')
    .bind(id).first<{ id: string }>()
  if (!inv) return c.json({ error: 'Invoice not found' }, 404)
  const now = new Date().toISOString()
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE invoices SET voided_at = datetime('now'), void_reason = ? WHERE id = ?"
    ).bind(reason, id),
    // Reverse the money side: flag the purchase entries this invoice created so
    // they stop counting toward Latest Price / price-movers / costing.
    c.env.DB.prepare(
      "UPDATE product_entries SET voided_at = datetime('now') WHERE invoice_id = ?"
    ).bind(id),
  ])
  return c.json({ id, voided_at: now, void_reason: reason })
})

// POST /api/invoices/:id/restore — un-void: back into the active list and P&L,
// and un-flag the purchase entries so cost history counts again.
app.post('/api/invoices/:id/restore', async (c) => {
  const { id } = c.req.param()
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE invoices SET voided_at = NULL, void_reason = '' WHERE id = ?"
    ).bind(id),
    c.env.DB.prepare(
      "UPDATE product_entries SET voided_at = NULL WHERE invoice_id = ?"
    ).bind(id),
  ])
  return c.json({ id, voided_at: null, void_reason: '' })
})

// ─── File Upload (R2) ─────────────────────────────────────────
// POST /api/upload  → multipart/form-data: field "file"
// Returns: { key, url, name, size, type }
app.post('/api/upload', async (c) => {
  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  if (!file) return c.json({ error: 'No file provided' }, 400)

  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
  const key = `uploads/${uid()}.${ext}`

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

  // Delete existing lines
  await c.env.DB.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').bind(invoiceId).run()

  // Insert new lines
  for (const line of (body.lines || [])) {
    const id = uid()
    const qty   = parseFloat(line.qty   as string) || 0
    const price = parseFloat(line.price as string) || 0
    await c.env.DB.prepare(
      `INSERT INTO invoice_lines (id, invoice_id, product_name, vendor_item, category, item_code, packaging, price, qty, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, invoiceId,
      (line.product_name as string) || '',
      (line.vendor_item  as string) || '',
      (line.category     as string) || '',
      (line.item_code    as string) || '',
      (line.packaging    as string) || '',
      price, qty,
      parseFloat(line.line_total as string) || (price * qty)
    ).run()
  }

  // Update extra cost fields on invoice
  await c.env.DB.prepare(
    `UPDATE invoices SET tax_pst=?, tax_gst=?, delivery=?, fuel_surcharge=0, deposit=?, credit=?, other_cost=?, other_desc=? WHERE id=?`
  ).bind(
    body.tax_pst    ?? 0,
    body.tax_gst    ?? 0,
    body.delivery   ?? 0,
    body.deposit    ?? 0,
    body.credit     ?? 0,
    body.other_cost ?? 0,
    body.other_desc ?? '',
    invoiceId
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
    `SELECT * FROM vendor_fee_templates WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?))`
  ).bind(vendor).first()
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

  const existing = await c.env.DB.prepare(
    `SELECT id FROM vendor_fee_templates WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?))`
  ).bind(body.vendor_name.trim()).first<{ id: string }>()

  const now = new Date().toISOString()
  if (existing) {
    await c.env.DB.prepare(
      `UPDATE vendor_fee_templates SET
         delivery=?, fuel_surcharge=?, tax_gst=?, tax_pst=?,
         other_cost=?, other_desc=?, use_percent=?, notes=?, updated_at=?
       WHERE id=?`
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
      existing.id
    ).run()
    return c.json({ saved: true, id: existing.id, created: false })
  } else {
    const id = uid()
    await c.env.DB.prepare(
      `INSERT INTO vendor_fee_templates
         (id, vendor_name, delivery, fuel_surcharge, tax_gst, tax_pst,
          other_cost, other_desc, use_percent, notes, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
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
      now
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
  const existing = await c.env.DB.prepare(
    `SELECT id FROM invoices WHERE file_key = ?`
  ).bind(body.file_key).first<{ id: string }>()

  if (existing) {
    return c.json({ id: existing.id, created: false })
  }

  // Create new invoice record (including extra cost fields)
  const invoiceId = uid()
  await c.env.DB.prepare(
    `INSERT INTO invoices (id, vendor, invoice_number, invoice_date, upload_date, total,
       status, payment_account, file_name, file_key, file_url, notes,
       tax_gst, tax_pst, delivery, fuel_surcharge, deposit, credit, other_cost, other_desc)
     VALUES (?, ?, ?, ?, ?, ?, 'In Processing', 'A/P', ?, ?, ?, '',
             ?, ?, ?, 0, ?, ?, ?, ?)`
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
    body.other_desc || ''
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
  const exact = await c.env.DB.prepare(
    `SELECT id, name FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))`
  ).bind(name).first<{ id: string; name: string }>()
  if (exact) return c.json({ decision: 'exact', match: exact, score: 1 })

  const all = await c.env.DB.prepare(`SELECT id, name FROM suppliers`).all<{ id: string; name: string }>()
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

  const current = await c.env.DB.prepare('SELECT name FROM suppliers WHERE id = ?')
    .bind(id).first<{ name: string }>()
  if (!current) return c.json({ error: 'Supplier not found' }, 404)
  const oldName = current.name

  // Update the supplier row itself
  await c.env.DB.prepare(
    'UPDATE suppliers SET name = ?, contact = ?, email = ?, notes = ? WHERE id = ?'
  ).bind(newName, body.contact ?? '', body.email ?? '', body.notes ?? '', id).run()

  // Cascade only when the name actually changed (ignoring case/space)
  if (oldName.trim().toLowerCase() !== newName.toLowerCase()) {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE product_entries SET supplier_name = ? WHERE supplier_id = ? OR LOWER(TRIM(supplier_name)) = LOWER(TRIM(?))'
      ).bind(newName, id, oldName),
      c.env.DB.prepare(
        'UPDATE invoices SET vendor = ? WHERE LOWER(TRIM(vendor)) = LOWER(TRIM(?))'
      ).bind(newName, oldName),
      c.env.DB.prepare(
        'UPDATE product_mappings SET vendor_name = ? WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?))'
      ).bind(newName, oldName),
    ])

    // vendor_fee_templates.vendor_name is UNIQUE — renaming into an existing
    // one would violate the constraint, so drop the old row in that case.
    const clashTmpl = await c.env.DB.prepare(
      'SELECT id FROM vendor_fee_templates WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?))'
    ).bind(newName).first<{ id: string }>()
    if (clashTmpl) {
      await c.env.DB.prepare(
        'DELETE FROM vendor_fee_templates WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?))'
      ).bind(oldName).run()
    } else {
      await c.env.DB.prepare(
        'UPDATE vendor_fee_templates SET vendor_name = ? WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?))'
      ).bind(newName, oldName).run()
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

  // ── Step 0: Find-or-create the supplier ──────────────────────
  let supplierId   = ''
  let supplierName = ''
  let supplierCreated = false

  const vendorName = (body.vendor_name || '').trim()
  if (vendorName) {
    let existingSupplier = await c.env.DB.prepare(
      `SELECT id, name FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))`
    ).bind(vendorName).first<{ id: string; name: string }>()

    // No exact match: fuzzy-match against existing suppliers and reuse one for
    // near-identical names (auto tier) so a punctuation/typo variation doesn't
    // spawn a duplicate. Looser "suggest"-tier matches are left to the review UI.
    if (!existingSupplier) {
      const all = await c.env.DB.prepare(`SELECT id, name FROM suppliers`).all<{ id: string; name: string }>()
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
        `INSERT INTO suppliers (id, name, contact, email, notes) VALUES (?, ?, '', '', '')`
      ).bind(supplierId, vendorName).run()
      supplierCreated = true
    }
  }

  let saved = 0, createdGenerics = 0, reusedGenerics = 0

  for (const p of body.products) {
    const name = (p.name as string || '').trim()
    if (!name) continue

    // 1. Find existing generic_product by name (case-insensitive, skip soft-deleted)
    let existing = await c.env.DB.prepare(
      `SELECT id FROM generic_products WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND deleted_at IS NULL`
    ).bind(name).first<{ id: string }>()

    // 1b. If not found by name, check product_aliases (merges leave old names here)
    if (!existing) {
      const aliasMatch = await c.env.DB.prepare(
        `SELECT pa.generic_product_id AS id FROM product_aliases pa
         JOIN generic_products gp ON gp.id = pa.generic_product_id
         WHERE LOWER(TRIM(pa.alias_name)) = LOWER(TRIM(?)) AND gp.deleted_at IS NULL`
      ).bind(name).first<{ id: string }>()
      if (aliasMatch) existing = aliasMatch
    }

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
        `INSERT INTO generic_products (id, name, category, sub_unit_name, sub_unit_qty)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(
        genericId,
        name,
        category,
        (p.sub_unit_name as string) || '',
        p.sub_unit_qty ?? null
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
          invoice_id, invoice_file_key, invoice_file_name, qty_ordered)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      entryId, genericId, name,
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
      qtyOrdered
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

// ─── Product Merge ────────────────────────────────────────────
// POST /api/products/merge
// Body: { merged_id, surviving_id }
// 1. Re-links product_entries to the surviving product
// 2. Sums inventory quantities (deletes merged row)
// 3. Re-links recipe_items to the surviving product
// 4. Soft-deletes the merged generic_product (sets deleted_at)
app.post('/api/products/merge', async (c) => {
  const body = await c.req.json() as { merged_id: string; surviving_id: string }
  const { merged_id, surviving_id } = body
  if (!merged_id || !surviving_id)
    return c.json({ error: 'merged_id and surviving_id required' }, 400)
  if (merged_id === surviving_id)
    return c.json({ error: 'Cannot merge a product with itself' }, 400)

  const merged   = await c.env.DB.prepare(
    'SELECT id, name FROM generic_products WHERE id = ? AND deleted_at IS NULL'
  ).bind(merged_id).first<{ id: string; name: string }>()
  const surviving = await c.env.DB.prepare(
    'SELECT id, name FROM generic_products WHERE id = ? AND deleted_at IS NULL'
  ).bind(surviving_id).first<{ id: string; name: string }>()

  if (!merged)   return c.json({ error: 'Merged product not found' }, 404)
  if (!surviving) return c.json({ error: 'Surviving product not found' }, 404)

  // 1. Re-link product_entries
  await c.env.DB.prepare(
    'UPDATE product_entries SET generic_product_id = ?, generic_product_name = ? WHERE generic_product_id = ?'
  ).bind(surviving_id, surviving.name, merged_id).run()

  // 2. Merge inventory rows
  const mergedInv = await c.env.DB.prepare(
    'SELECT id, quantity FROM inventory WHERE item_id = ?'
  ).bind(merged_id).first<{ id: string; quantity: number }>()
  if (mergedInv) {
    const survivingInv = await c.env.DB.prepare(
      'SELECT id FROM inventory WHERE item_id = ?'
    ).bind(surviving_id).first<{ id: string }>()
    if (survivingInv) {
      await c.env.DB.prepare(
        'UPDATE inventory SET quantity = quantity + ? WHERE item_id = ?'
      ).bind(mergedInv.quantity, surviving_id).run()
      await c.env.DB.prepare('DELETE FROM inventory WHERE item_id = ?').bind(merged_id).run()
    } else {
      // No surviving inventory row — reassign the merged row
      await c.env.DB.prepare(
        'UPDATE inventory SET item_id = ?, item_name = ? WHERE item_id = ?'
      ).bind(surviving_id, surviving.name, merged_id).run()
    }
  }

  // 3. Re-link recipe_items
  await c.env.DB.prepare(
    'UPDATE recipe_items SET product_id = ?, product_name = ? WHERE product_id = ?'
  ).bind(surviving_id, surviving.name, merged_id).run()

  // 4. Soft-delete the merged product
  await c.env.DB.prepare(
    "UPDATE generic_products SET deleted_at = datetime('now') WHERE id = ?"
  ).bind(merged_id).run()

  return c.json({ ok: true, merged_name: merged.name, surviving_name: surviving.name })
})

// ─── Price Movers ─────────────────────────────────────────────
// GET /api/price-movers?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns one row per generic_product that has purchases in the date range.
// Each row contains the last 10 purchases (newest first) and the % change
// between the two most recent purchases (null if fewer than 2 in range).
// Sorted by absolute % change descending, nulls last.
app.get('/api/price-movers', async (c) => {
  const from = (c.req.query('from') || '').trim()
  const to   = (c.req.query('to')   || '').trim()

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
           pe.invoice_id
    FROM product_entries pe
    WHERE pe.purchase_date IS NOT NULL AND pe.purchase_date != ''
      AND pe.generic_product_id IS NOT NULL AND pe.generic_product_id != ''
      AND pe.voided_at IS NULL
  `
  const args: string[] = []
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
    invoice_ref: string
    invoice_id: string
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
    let g = groups.get(pid)
    if (!g) {
      g = {
        product_id:   pid,
        product_name: String(r.product_name || ''),
        unit:         String(r.pack_unit || ''),
        purchases:    []
      }
      groups.set(pid, g)
    }
    g.purchases.push({
      date:          String(r.purchase_date || ''),
      vendor:        String(r.supplier_name || ''),
      pack_qty:      Number(r.pack_qty || 0),
      pack_unit:     String(r.pack_unit || ''),
      cost:          Number(r.cost || 0),
      cost_per_unit: Number(r.cost_per_unit || 0),
      invoice_ref:   String(r.invoice_ref || ''),
      invoice_id:    String(r.invoice_id || ''),
    })
  }

  const products = Array.from(groups.values()).map(g => {
    // Already DESC sorted by the query. Take at most the latest 10.
    const purchases = g.purchases.slice(0, 10)
    let pct_change: number | null = null
    if (purchases.length >= 2) {
      const latest = purchases[0].cost_per_unit
      const prev   = purchases[1].cost_per_unit
      if (prev > 0) {
        pct_change = Math.round(((latest - prev) / prev) * 1000) / 10
      }
    }
    return {
      product_id:     g.product_id,
      product_name:   g.product_name,
      unit:           g.unit,
      purchase_count: g.purchases.length,
      pct_change,
      purchases,
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
  const take = await c.env.DB.prepare(
    `SELECT * FROM stock_takes WHERE status = 'in_progress' ORDER BY started_at DESC LIMIT 1`
  ).first<Record<string, unknown>>()

  if (!take) return c.json({ active: null })

  const items = await c.env.DB.prepare(
    `SELECT * FROM stock_take_items WHERE stock_take_id = ?`
  ).bind(take.id).all()

  return c.json({ active: take, items: items.results })
})

// POST /api/stock-take/start
// Creates a new in-progress stock take and snapshots every inventory item
// as a stock_take_items row with counted_qty = NULL.
// If an in-progress stock take already exists, returns it instead.
app.post('/api/stock-take/start', async (c) => {
  const existing = await c.env.DB.prepare(
    `SELECT * FROM stock_takes WHERE status = 'in_progress' ORDER BY started_at DESC LIMIT 1`
  ).first<Record<string, unknown>>()

  if (existing) {
    const items = await c.env.DB.prepare(
      `SELECT * FROM stock_take_items WHERE stock_take_id = ?`
    ).bind(existing.id).all()
    return c.json({ stock_take: existing, items: items.results, resumed: true })
  }

  const stockTakeId = uid()
  const inv = await c.env.DB.prepare(
    `SELECT id, item_id, item_type, item_name, category, quantity, unit FROM inventory`
  ).all<{ id: string; item_id: string; item_type: string; item_name: string; category: string; quantity: number; unit: string }>()

  const items = inv.results || []

  await c.env.DB.prepare(
    `INSERT INTO stock_takes (id, status, total_items, counted_items) VALUES (?, 'in_progress', ?, 0)`
  ).bind(stockTakeId, items.length).run()

  // Bulk-insert snapshot rows
  const statements = items.map(r =>
    c.env.DB.prepare(
      `INSERT INTO stock_take_items
         (id, stock_take_id, inventory_id, item_id, item_type, item_name, category, unit, expected_qty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(uid(), stockTakeId, r.id, r.item_id, r.item_type, r.item_name, r.category || '', r.unit || '', r.quantity || 0)
  )
  if (statements.length) await c.env.DB.batch(statements)

  const created = await c.env.DB.prepare(
    `SELECT * FROM stock_takes WHERE id = ?`
  ).bind(stockTakeId).first()
  const itemRows = await c.env.DB.prepare(
    `SELECT * FROM stock_take_items WHERE stock_take_id = ?`
  ).bind(stockTakeId).all()

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
    items: Array<{ stock_take_item_id: string; counted_qty: number | null; reason?: string }>
  }

  const take = await c.env.DB.prepare(`SELECT * FROM stock_takes WHERE id = ?`).bind(stockTakeId).first<Record<string, unknown>>()
  if (!take) return c.json({ error: 'Stock take not found' }, 404)
  if (take.status !== 'in_progress') return c.json({ error: 'Stock take is not in progress' }, 400)

  // Load all snapshot rows for this take, keyed by id
  const snapshotRows = await c.env.DB.prepare(
    `SELECT * FROM stock_take_items WHERE stock_take_id = ?`
  ).bind(stockTakeId).all<{
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

    const counted  = Number(it.counted_qty)
    const expected = Number(snap.expected_qty) || 0
    const variance = counted - expected
    const reason   = (it.reason || '').trim()
    countedCount++

    // 1. Update inventory quantity
    statements.push(
      c.env.DB.prepare(`UPDATE inventory SET quantity = ? WHERE id = ?`).bind(counted, snap.inventory_id)
    )

    // 2. Update stock_take_items snapshot
    statements.push(
      c.env.DB.prepare(
        `UPDATE stock_take_items
           SET counted_qty = ?, variance = ?, reason = ?, counted_at = ?
         WHERE id = ?`
      ).bind(counted, variance, reason, now, snap.id)
    )

    // 3. Log a stock movement (only if variance != 0)
    if (variance !== 0) {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO stock_log
             (id, inventory_id, item_id, item_type, item_name, change, reason, note, lot_number, moved_at, stock_take_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`
        ).bind(
          uid(), snap.inventory_id, snap.item_id, snap.item_type, snap.item_name,
          variance, reason || 'Stock take', `Stock take: expected ${expected}, counted ${counted}`,
          now, stockTakeId
        )
      )
    }
  }

  // 4. Mark the stock take submitted
  statements.push(
    c.env.DB.prepare(
      `UPDATE stock_takes SET status = 'submitted', submitted_at = ?, counted_items = ? WHERE id = ?`
    ).bind(now, countedCount, stockTakeId)
  )

  if (statements.length) await c.env.DB.batch(statements)

  return c.json({ ok: true, counted: countedCount })
})

// PATCH /api/stock-take/items/:id
// Body: { counted_qty: number | null, reason: string }
// Persists partial counts during an in-progress session so resume works.
app.patch('/api/stock-take/items/:id', async (c) => {
  const itemId = c.req.param('id')
  const body = await c.req.json() as { counted_qty: number | null; reason?: string }
  await c.env.DB.prepare(
    `UPDATE stock_take_items
        SET counted_qty = ?, reason = ?, counted_at = CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END
      WHERE id = ?`
  ).bind(
    body.counted_qty ?? null,
    body.reason ?? '',
    body.counted_qty ?? null,
    itemId
  ).run()
  return c.json({ ok: true })
})

// POST /api/stock-take/:id/cancel
app.post('/api/stock-take/:id/cancel', async (c) => {
  const stockTakeId = c.req.param('id')
  // Hard delete so the next "Start Stock Take" creates a fresh session.
  // stock_take_items cascade-deletes via the FK ON DELETE CASCADE.
  await c.env.DB.prepare(
    `DELETE FROM stock_takes WHERE id = ? AND status = 'in_progress'`
  ).bind(stockTakeId).run()
  return c.json({ ok: true })
})

// GET /api/stock-take/latest-statuses
// Returns a map of { inventory_id: 'counted' | 'not_counted' } based on the
// MOST RECENTLY SUBMITTED stock take. Inventory rows with no record in that
// take (e.g. created after the take was submitted) are omitted.
app.get('/api/stock-take/latest-statuses', async (c) => {
  const latest = await c.env.DB.prepare(
    `SELECT id, submitted_at FROM stock_takes WHERE status = 'submitted' ORDER BY submitted_at DESC LIMIT 1`
  ).first<{ id: string; submitted_at: string }>()

  if (!latest) return c.json({ stock_take_id: null, statuses: {} })

  const rows = await c.env.DB.prepare(
    `SELECT inventory_id, counted_qty FROM stock_take_items WHERE stock_take_id = ?`
  ).bind(latest.id).all<{ inventory_id: string; counted_qty: number | null }>()

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

    const data = await response.json() as { content: Array<{ type: string; text?: string }> }
    const text = (data.content || []).find(b => b.type === 'text')?.text || ''

    // Strip markdown code fences if present
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()

    const parsed = JSON.parse(cleaned)
    return c.json({ success: true, result: parsed, rawText: cleaned })
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
        max_tokens: 4000,
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
      'SELECT * FROM product_mappings ORDER BY updated_at DESC'
    ).all()
    return c.json({ data: rows.results })
  }
  const rows = await c.env.DB.prepare(
    'SELECT * FROM product_mappings WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?)) ORDER BY updated_at DESC'
  ).bind(vendor).all()
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

  const now = new Date().toISOString()
  const existing = await c.env.DB.prepare(
    'SELECT id FROM product_mappings WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?)) AND LOWER(TRIM(raw_ocr_text)) = LOWER(TRIM(?))'
  ).bind(body.vendor_name.trim(), body.raw_ocr_text.trim()).first<{ id: string }>()

  if (existing) {
    await c.env.DB.prepare(
      'UPDATE product_mappings SET corrected_name=?, corrected_brand=?, corrected_sku=?, corrected_pack_size=?, updated_at=? WHERE id=?'
    ).bind(
      body.corrected_name.trim(),
      body.corrected_brand?.trim() || '',
      body.corrected_sku?.trim() || '',
      body.corrected_pack_size?.trim() || '',
      now,
      existing.id
    ).run()
    return c.json({ id: existing.id, created: false })
  }

  const id = uid()
  await c.env.DB.prepare(
    'INSERT INTO product_mappings (id, vendor_name, raw_ocr_text, corrected_name, corrected_brand, corrected_sku, corrected_pack_size, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(
    id,
    body.vendor_name.trim(),
    body.raw_ocr_text.trim(),
    body.corrected_name.trim(),
    body.corrected_brand?.trim() || '',
    body.corrected_sku?.trim() || '',
    body.corrected_pack_size?.trim() || '',
    now, now
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

  const unit = await c.env.DB.prepare(`SELECT * FROM units WHERE id = ?`)
    .bind(id).first<{ id: number; name: string; sort_order: number }>()
  if (!unit) return c.json({ error: 'Not found' }, 404)

  if (!force) {
    const usage = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM product_entries WHERE pack_unit = ?`
    ).bind(unit.name).first<{ count: number }>()
    const count = usage?.count ?? 0
    if (count > 0) {
      return c.json({ warning: true, count, message: `Used by ${count} product entries` })
    }
  }

  await c.env.DB.prepare(`DELETE FROM units WHERE id = ?`).bind(id).run()
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

  const cat = await c.env.DB.prepare(`SELECT * FROM categories WHERE id = ?`)
    .bind(id).first<{ id: number; name: string; sort_order: number }>()
  if (!cat) return c.json({ error: 'Not found' }, 404)

  if (!force) {
    const usage = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM generic_products
         WHERE deleted_at IS NULL AND LOWER(TRIM(category)) = LOWER(TRIM(?))`
    ).bind(cat.name).first<{ count: number }>()
    const count = usage?.count ?? 0
    if (count > 0) {
      return c.json({ warning: true, count, message: `Used by ${count} products` })
    }
  }

  await c.env.DB.prepare(`DELETE FROM categories WHERE id = ?`).bind(id).run()
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
  `).bind(from, to).first<{
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
    GROUP BY vendor
    ORDER BY amount DESC
  `).bind(from, to).all<{ vendor: string; amount: number }>()

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
           LIMIT 1),
          (SELECT gp.category
           FROM generic_products gp
           WHERE LOWER(TRIM(gp.name)) = LOWER(TRIM(il.product_name))
           LIMIT 1),
          'Uncategorized'
        ) AS category
      FROM invoice_lines il
      JOIN invoices i ON il.invoice_id = i.id
      WHERE i.status = 'Closed'
        AND i.voided_at IS NULL
        AND i.invoice_date >= ?
        AND i.invoice_date <= ?
    )
    SELECT category, SUM(COALESCE(line_total, 0)) AS amount
    FROM line_cats
    GROUP BY category
    ORDER BY amount DESC
  `).bind(from, to).all<{ category: string; amount: number }>()

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
            WHERE LOWER(TRIM(pe.generic_product_name)) = LOWER(TRIM(il.product_name)) LIMIT 1),
          (SELECT gp.category FROM generic_products gp
            WHERE LOWER(TRIM(gp.name)) = LOWER(TRIM(il.product_name)) LIMIT 1),
          il.category,
          ''
        ) AS category
      FROM invoice_lines il
      JOIN invoices i ON il.invoice_id = i.id
      WHERE i.status = 'Closed'
        AND i.voided_at IS NULL
        AND substr(i.invoice_date, 1, 7) BETWEEN ? AND ?
    )
    SELECT
      COALESCE(
        (SELECT c.type FROM categories c
          WHERE LOWER(TRIM(c.name)) = LOWER(TRIM(line_cats.category)) LIMIT 1),
        'food'
      ) AS type,
      SUM(COALESCE(amt, 0)) AS amount
    FROM line_cats
    GROUP BY type
  `).bind(from, to).all<{ type: string; amount: number }>()

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
  `).bind(from, to).first<{ fees: number }>()

  // Expense invoices (utilities, rent, insurance…): total by expense_category
  // for the month. These are operating costs, not COGS, and have no line items.
  const expRows = await c.env.DB.prepare(`
    SELECT COALESCE(NULLIF(TRIM(expense_category), ''), 'Other') AS category,
           SUM(COALESCE(total, 0)) AS amount
    FROM invoices
    WHERE invoice_kind = 'expense' AND status = 'Closed' AND voided_at IS NULL
      AND substr(invoice_date, 1, 7) BETWEEN ? AND ?
    GROUP BY category
    ORDER BY amount DESC
  `).bind(from, to).all<{ category: string; amount: number }>()

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
    ORDER BY submitted_at DESC LIMIT 1
  `).bind(periodEnd).first<{ id: string; d: string }>()

  const openingTake = await c.env.DB.prepare(`
    SELECT id, date(submitted_at) AS d FROM stock_takes
    WHERE status = 'submitted' AND submitted_at IS NOT NULL AND date(submitted_at) < ?
    ORDER BY submitted_at DESC LIMIT 1
  `).bind(periodStart).first<{ id: string; d: string }>()

  // Value one stock take's raw-material counts, grouped into food/beverage.
  // asOfDate prices each product at its most recent purchase on/before that date.
  const valueTake = async (takeId: string, asOfDate: string) => {
    const rows = await c.env.DB.prepare(`
      WITH valued AS (
        SELECT
          COALESCE(
            (SELECT c.type FROM categories c
              WHERE LOWER(TRIM(c.name)) = LOWER(TRIM(sti.category)) LIMIT 1),
            'food'
          ) AS type,
          sti.counted_qty * COALESCE(
            (SELECT pe.cost_per_unit FROM product_entries pe
              WHERE pe.generic_product_id = sti.item_id AND pe.voided_at IS NULL
                AND pe.purchase_date != '' AND pe.purchase_date <= ?
              ORDER BY pe.purchase_date DESC, pe.created_at DESC LIMIT 1),
            (SELECT pe.cost_per_unit FROM product_entries pe
              WHERE pe.generic_product_id = sti.item_id AND pe.voided_at IS NULL
              ORDER BY pe.purchase_date DESC, pe.created_at DESC LIMIT 1),
            0
          ) AS val
        FROM stock_take_items sti
        WHERE sti.stock_take_id = ? AND sti.item_type = 'raw_material'
          AND sti.counted_qty IS NOT NULL
      )
      SELECT type, SUM(COALESCE(val, 0)) AS amount FROM valued GROUP BY type
    `).bind(asOfDate, takeId).all<{ type: string; amount: number }>()
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