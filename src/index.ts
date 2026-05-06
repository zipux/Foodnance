import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  DB: D1Database
  FILES: R2Bucket
  OPENAI_API_KEY: string        // secret set via wrangler / .dev.vars
  AZURE_DOC_INTEL_KEY: string   // Azure Document Intelligence API key
  AZURE_DOC_INTEL_ENDPOINT: string // e.g. https://xxx.cognitiveservices.azure.com
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors())

// ─── Helper: generate uid ─────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
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
function inferCategory(name: string): string {
  const n = name.toLowerCase()
  const rules: [string, string[]][] = [
    ['Linen',                   ['napkin','towel','apron','cloth','uniform','rag','linen']],
    ['Disposables',             ['glove','cup','plate','fork','spoon','tissue','straw','cutlery','bio cont','container']],
    ['Packaging',               ['box','bag','wrap','film','pail','jar','bottle','packaging']],
    ['Non-Alcoholic Beverages', ['juice','water','soda','coffee','tea','syrup','drink','beverage']],
    ['Alcohol',                 ['wine','beer','spirit','liquor','vodka','whiskey','rum','gin','alcohol']],
    ['Cleaning & Sanitation',   ['cleaner','sanitizer','soap','detergent','bleach','disinfectant','cleaning']],
  ]
  for (const [category, keywords] of rules) {
    if (keywords.some(k => n.includes(k))) return category
  }
  return 'Ingredients'
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
  'product_mappings', 'units', 'product_aliases'
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
const INTEGER_PK_TABLES = ['units']

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

// ── Delete generic_product (cascades related data correctly)
app.delete('/api/tables/generic_products/:id', async (c) => {
  const { id } = c.req.param()
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE product_entries SET generic_product_id = NULL WHERE generic_product_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM product_aliases WHERE generic_product_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM inventory WHERE item_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM recipe_items WHERE product_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM generic_products WHERE id = ?').bind(id),
  ])
  return c.body(null, 204)
})

// ── Delete
app.delete('/api/tables/:table/:id', async (c) => {
  const { table, id } = c.req.param()
  if (!ALLOWED_TABLES.includes(table)) return c.json({ error: 'Unknown table' }, 400)
  await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run()
  return c.body(null, 204)   // 204 No Content — must have no body
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


// POST /api/bulk/products  – save multiple product_entries at once
app.post('/api/bulk/products', async (c) => {
  const { products } = await c.req.json() as { products: Record<string, unknown>[] }
  if (!Array.isArray(products)) return c.json({ error: 'products array required' }, 400)

  const saved: string[] = []
  for (const p of products) {
    if (!p.id) p.id = uid()
    const keys = Object.keys(p)
    const vals = Object.values(p)
    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO product_entries (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`
    ).bind(...vals).run()
    saved.push(p.id as string)
  }
  return c.json({ saved })
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
    const existingSupplier = await c.env.DB.prepare(
      `SELECT id, name FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))`
    ).bind(vendorName).first<{ id: string; name: string }>()

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
  // [DEBUG] Cost-bug trace — per-row record of received vs saved values.
  const debugRows: Array<Record<string, unknown>> = []

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
      const providedCategory = (p.category as string || '').trim()
      const category = (providedCategory && providedCategory !== 'Ingredients')
        ? providedCategory
        : inferCategory(name)
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

    // [DEBUG] Cost-bug trace — record what arrived and what was saved.
    debugRows.push({
      name,
      received_cost:       p.cost,
      received_unit_price: p.unit_price,
      received_qty:        p.qty,
      received_pack_size:  p.pack_size,
      parsed_pack_qty:     packQty,
      parsed_pack_unit:    packUnit,
      saved_cost:          cost,
      saved_cost_per_unit: costPerUnit,
    })

    saved++
  }

  return c.json({
    saved,
    created_generics:  createdGenerics,
    reused_generics:   reusedGenerics,
    supplier_id:       supplierId,
    supplier_name:     supplierName,
    supplier_created:  supplierCreated,
    debug:             debugRows,
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

// ─── Stats endpoints ──────────────────────────────────────────
app.get('/api/stats/certifications', async (c) => {
  const today = new Date().toISOString().slice(0, 10)
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

  const total   = await c.env.DB.prepare('SELECT COUNT(*) as n FROM staff_certifications').first<{ n: number }>()
  const valid   = await c.env.DB.prepare("SELECT COUNT(*) as n FROM staff_certifications WHERE expiry_date > ?").bind(today).first<{ n: number }>()
  const expiring = await c.env.DB.prepare("SELECT COUNT(*) as n FROM staff_certifications WHERE expiry_date > ? AND expiry_date <= ?").bind(today, soon).first<{ n: number }>()
  const expired = await c.env.DB.prepare("SELECT COUNT(*) as n FROM staff_certifications WHERE expiry_date <= ?").bind(today).first<{ n: number }>()
  const staffCount = await c.env.DB.prepare('SELECT COUNT(*) as n FROM staff').first<{ n: number }>()

  return c.json({
    total: total?.n || 0,
    valid: valid?.n || 0,
    expiring: expiring?.n || 0,
    expired: expired?.n || 0,
    staffCount: staffCount?.n || 0
  })
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

// Static HTML + assets are served by Cloudflare Pages directly from the dist/ folder.
// The worker only needs to handle /api/* routes.

// ─── AI: Check if key is configured ──────────────────────────
app.get('/api/ai/status', async (c) => {
  const hasKey = !!(c.env.OPENAI_API_KEY)
  return c.json({ configured: hasKey })
})

// ─── Azure Document Intelligence status check ─────────────────
app.get('/api/ai/azure-status', async (c) => {
  const hasKey      = !!(c.env.AZURE_DOC_INTEL_KEY)
  const hasEndpoint = !!(c.env.AZURE_DOC_INTEL_ENDPOINT)
  return c.json({ configured: hasKey && hasEndpoint })
})

// ─── AI: Parse invoice via GPT-4o ────────────────────────────
// POST /api/ai/parse-invoice
// Accepts one of three body formats:
//   1. JSON { ocrText: string }          ← preferred: Azure OCR text as input
//   2. JSON { base64: string, mimeType } ← fallback: raw image
//   3. multipart/form-data with "file"   ← legacy fallback
app.post('/api/ai/parse-invoice', async (c) => {
  const apiKey = c.env.OPENAI_API_KEY
  if (!apiKey) {
    return c.json({ error: 'OpenAI API key is not configured on the server. Please add it in Settings.' }, 400)
  }

  // Shared JSON schema + rules used in all prompt variants
  const jsonSchema = `{
  "vendor": "supplier/company name from the invoice header",
  "invoice_number": "invoice number or empty string",
  "invoice_date": "YYYY-MM-DD or empty string",
  "total": 0.00,
  "payment_account": "A/P",
  "tax_gst": 0.00,
  "tax_pst": 0.00,
  "delivery": 0.00,
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
- - For 'credit': only extract a credit/discount if the line item prices are at FULL (undiscounted) price and the discount is applied separately at the bottom of the invoice. If the line item prices already reflect the discounted price (i.e. the discounted unit price × qty = the line total shown), set credit to 0.00
- For 'other_cost': any other fee not covered above (handling fee, etc.)
- For 'other_desc': description of the other_cost if applicable
- For dates: convert any format to YYYY-MM-DD
- Use 0.00 for numeric fields you cannot find
- Use empty string '' for text fields you cannot find
- If any field is unclear or ambiguous, mark it as 'needs review' instead of guessing
- If any part of the invoice is in a language other than English, translate it to English
- When a tax, fee, or charge seems unusually high or low, cross-check it against the invoice total. For example, if the subtotal is $814.51 and the total is $814.66, the tax should be $0.15 not $15.00. Use the total as the source of truth to validate individual charges. If you correct a decimal error, add '(decimal corrected)' next to the field value
- Return ONLY the JSON object, nothing else`

  let messages: Array<{ role: string; content: unknown }>

  const contentType = c.req.header('content-type') || ''

  if (!contentType.includes('multipart/form-data')) {
    const body = await c.req.json() as {
      ocrText?: string
      base64?: string
      mimeType?: string
      base64Images?: Array<{ base64: string; mimeType?: string }>
    }

    if (body.ocrText) {
      // ── Mode 1: Azure OCR text → GPT-4o ──────────────────────
      // If base64Images are also provided, send both text + images
      // so GPT can use the image to verify the totals/charges section
      // that OCR often mangles.
      const prompt = `You are an expert invoice parser. Below is the raw text extracted from an invoice by OCR. The OCR text is accurate for product line items, but the totals/charges section (taxes, fees, deposits, surcharges) may have broken formatting where labels and values appear on separate lines or are misassociated.${body.base64Images?.length ? ' You also have the original invoice image(s) — use them to VISUALLY VERIFY all charges in the totals section. When the OCR text is ambiguous about which value belongs to which label, trust the image layout over the OCR text.' : ' Always cross-check individual amounts against the invoice total to catch these errors.'}

Parse this text carefully and extract ALL line items AND all additional charges. Return ONLY a valid JSON object in this exact format (no markdown, no explanation, no code fences):
${jsonSchema}
${rules}

--- INVOICE OCR TEXT START ---
${body.ocrText}
--- INVOICE OCR TEXT END ---`

      if (body.base64Images?.length) {
        // Dual mode: text + images
        const content: Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }> = [
          { type: 'text', text: prompt }
        ]
        for (const img of body.base64Images) {
          const mime = img.mimeType || 'image/jpeg'
          content.push({
            type: 'image_url',
            image_url: { url: `data:${mime};base64,${img.base64}`, detail: 'high' }
          })
        }
        messages = [{ role: 'user', content }]
      } else {
        // Text-only mode (PDFs or when images not available)
        messages = [{ role: 'user', content: prompt }]
      }

    } else if (body.base64) {
      // ── Mode 2: raw image (fallback when Azure not configured) ──
      const mimeType = body.mimeType || 'image/jpeg'
      const prompt = `You are an expert invoice parser. Analyse this invoice image carefully and extract ALL line items AND all additional charges. If any value looks like a decimal error (e.g. a tax that is far too large relative to the total), correct it and add '(decimal corrected)' next to the value. If any field is unclear or ambiguous, mark it as 'needs review'.
Return ONLY a valid JSON object in this exact format (no markdown, no explanation, no code fences):
${jsonSchema}
${rules}`

      messages = [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${body.base64}`, detail: 'high' } }
        ]
      }]

    } else {
      return c.json({ error: 'Provide either ocrText or base64 in the request body.' }, 400)
    }

  } else {
    // ── Mode 3: multipart file upload (legacy) ──────────────
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    if (!file) return c.json({ error: 'No file provided' }, 400)
    const mimeType = file.type || 'image/jpeg'
    const ab = await file.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(ab)))
    const prompt = `You are an expert invoice parser. Analyse this invoice image carefully and extract ALL line items AND all additional charges. If any value looks like a decimal error (e.g. a tax that is far too large relative to the total), correct it and add '(decimal corrected)' next to the value. If any field is unclear or ambiguous, mark it as 'needs review'.
Return ONLY a valid JSON object in this exact format (no markdown, no explanation, no code fences):
${jsonSchema}
${rules}`

    messages = [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } }
      ]
    }]
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 3000,
        messages
      })
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as { error?: { message?: string } }
      return c.json({ error: err?.error?.message || `OpenAI API error ${response.status}` }, 502)
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> }
    const text = data.choices?.[0]?.message?.content || ''

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

// ─── Azure Document Intelligence: Analyze invoice ─────────────
// POST /api/ai/azure-analyze
// Accepts multipart/form-data with a 'file' field (PDF or image).
// Submits to Azure prebuilt-invoice model, polls until done,
// returns the raw analyzeResult JSON from Azure.
app.post('/api/ai/azure-analyze', async (c) => {
  const endpoint = (c.env.AZURE_DOC_INTEL_ENDPOINT || '').replace(/\/$/, '')
  const apiKey   = c.env.AZURE_DOC_INTEL_KEY

  if (!endpoint || !apiKey) {
    return c.json({ error: 'Azure Document Intelligence is not configured on the server.' }, 503)
  }

  // ── 1. Read uploaded file ────────────────────────────────────
  const contentType = c.req.header('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    return c.json({ error: 'Send the invoice as multipart/form-data with field name "file".' }, 400)
  }

  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  if (!file) return c.json({ error: 'No file provided.' }, 400)

  const fileBuffer  = await file.arrayBuffer()
  const mimeType    = file.type || 'application/octet-stream'

  // ── 1b. File-size guard (Azure limit is 500 MB; practical limit ~50 MB) ─
  const fileSizeMB = fileBuffer.byteLength / (1024 * 1024)
  if (fileSizeMB > 50) {
    return c.json({
      error: `File is too large for Azure OCR (${fileSizeMB.toFixed(1)} MB). Maximum supported size is 50 MB. Please reduce the file size and try again.`
    }, 413)
  }

  // ── 2. Submit to Azure: POST → get operation-location URL ───
  const submitUrl = `${endpoint}/documentintelligence/documentModels/prebuilt-invoice:analyze?api-version=2024-11-30`

  const submitRes = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
      'Content-Type': mimeType,
    },
    body: fileBuffer,
  })

  if (!submitRes.ok) {
    const errText = await submitRes.text()
    return c.json({
      error: `Azure submission failed (${submitRes.status}): ${errText}`
    }, 502)
  }

  // Azure returns the polling URL in the operation-location header
  const operationUrl = submitRes.headers.get('operation-location')
  if (!operationUrl) {
    return c.json({ error: 'Azure did not return an operation-location header.' }, 502)
  }

  // ── 3. Poll until succeeded (max ~60s, 1s intervals) ────────
  const MAX_POLLS = 60
  for (let i = 0; i < MAX_POLLS; i++) {
    // Wait 1 second between polls
    await new Promise(r => setTimeout(r, 1000))

    const pollRes = await fetch(operationUrl, {
      headers: { 'Ocp-Apim-Subscription-Key': apiKey },
    })

    if (!pollRes.ok) {
      const errText = await pollRes.text()
      return c.json({
        error: `Azure polling failed (${pollRes.status}): ${errText}`
      }, 502)
    }

    const pollData = await pollRes.json() as {
      status: string
      analyzeResult?: unknown
      error?: { message?: string }
    }

    if (pollData.status === 'succeeded') {
      const ar = pollData.analyzeResult as {
        content?: string
        pages?: Array<{
          pageNumber?: number
          lines?: Array<{ content?: string }>
          words?: Array<{ content?: string }>
        }>
        documents?: Array<{
          fields?: Record<string, { valueString?: string; content?: string; valueCurrency?: { amount?: number; currencyCode?: string }; valueDate?: string; valueArray?: Array<{ valueObject?: Record<string, { content?: string; valueString?: string; valueCurrency?: { amount?: number } }> }> }>
        }>
      } | undefined

      // ── Build per-page OCR text for the Raw OCR Output panel ──
      // Each entry: { pageNumber, text } — text is all lines joined
      const pageTexts: Array<{ pageNumber: number; text: string }> = []
      if (ar?.pages && ar.pages.length > 0) {
        for (const pg of ar.pages) {
          const num = pg.pageNumber ?? (pageTexts.length + 1)
          const lines = (pg.lines || []).map(l => l.content || '').filter(Boolean)
          pageTexts.push({ pageNumber: num, text: lines.join('\n') })
        }
      } else if (ar?.content) {
        // Fallback: single-page, use full content string
        pageTexts.push({ pageNumber: 1, text: ar.content })
      }

      return c.json({
        success:      true,
        analyzeResult: pollData.analyzeResult,
        // Convenience: per-page text ready for display / GPT prompt
        pageTexts,
        // Convenience: full document text (all pages concatenated)
        fullText: ar?.content || pageTexts.map(p => p.text).join('\n\n--- Page break ---\n\n'),
      })
    }

    if (pollData.status === 'failed') {
      return c.json({
        error: 'Azure analysis failed: ' + (pollData.error?.message || 'unknown error')
      }, 502)
    }

    // status is 'running' or 'notStarted' — keep polling
  }

  return c.json({ error: 'Azure analysis timed out after 60 seconds. The file may be too complex or Azure may be under load. Please try again.' }, 504)
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

export default app