#!/usr/bin/env node
// Invoice model A/B eval: run the SAME invoices through two Claude models with
// the EXACT prompt/schema the app uses, then compare.
//
// Why this exists: before switching the live parser (src/index.ts) off
// claude-opus-4-8 to a cheaper model, you need to know it reads invoices at
// least as well — across many fields, not one eyeballed sample.
//
// Two ways it scores each model:
//   1. Reconciliation (no labels needed): do the extracted items + taxes + fees
//      add up to the invoice total? A model that reads badly won't reconcile.
//   2. Ground truth (optional): if tests/invoices/<name>.truth.json exists, it
//      scores each field against your hand-checked answer.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... node tests/invoice-model-compare.mjs [folder] [--repeat N]
//
//   folder    dir of invoice files (.pdf/.jpg/.png). Default: tests/invoices/
//   --repeat  run each model N times per invoice to check consistency (default 1)
//
// Put a few representative real invoices in tests/invoices/ first.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

// ── Models under test ────────────────────────────────────────────────────────
// A = current production model, B = candidate. Change B to try others.
const MODEL_A = 'claude-opus-4-8'
const MODEL_B = 'claude-sonnet-5'

// ── Prompt / schema / rules ──────────────────────────────────────────────────
// MUST mirror src/index.ts (POST /api/ai/parse-invoice). If you change the
// prompt there, copy it here or the test stops being representative.
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
  "deposit": 0.00,
  "credit": 0.00,
  "other_cost": 0.00,
  "other_desc": "",
  "items": [
    {
      "name": "generic product name",
      "original_ocr": "exact original OCR text for this line item",
      "brand": "brand name if visible or empty string",
      "sku": "SKU/item code/barcode if visible or empty string",
      "pack_size": "weight or volume only e.g. '1 kg', '500 ml', '2 LB'",
      "qty": 1,
      "unit_price": 0.00,
      "cost": 0.00,
      "expiry_date": "YYYY-MM-DD or empty string"
    }
  ]
}`

const rules = `Rules:
- Extract EVERY product line item — do not skip any
- Ignore handwritten text, annotations, or markings (printed text is always valid data)
- For 'original_ocr': copy the exact original OCR text character-for-character
- Do NOT include delivery fees, fuel surcharges, or taxes as items[] entries
- For 'name': use the generic product name, not the vendor-specific SKU description
- For 'qty': the quantity ordered (a number)
- For 'unit_price': the price per single unit (NOT the line total)
- For 'cost': the line total (qty × unit_price)
- For 'pack_size': prioritize unit weight/volume over case count
- For 'tax_gst': GST/HST amount (dollar value); 'tax_pst': PST/QST amount
- For 'delivery': combined actual delivery/freight/fuel/eco charges on this invoice
- For 'deposit': sum of all deposit charges (do not include in items[])
- For 'other_cost': ecology fees + any other fee; 'other_desc': its description
- For 'credit': only if line items are at full price and discount is applied at the bottom
- For dates: convert to YYYY-MM-DD
- Inspect header AND footer for pagination; set page_current/page_total
- Use 0.00 / '' for fields you cannot find
- Cross-check unusually high/low charges against the total (fix decimal errors)
- Return ONLY the JSON object, nothing else`

const prompt = `You are an expert invoice parser. Read the attached invoice document(s) carefully — including the totals/charges section — and extract ALL line items AND all additional charges. Use the visual layout to correctly associate each amount with its label. If any value looks like a decimal error, correct it. If any field is unclear, mark it 'needs review'.
Return ONLY a valid JSON object in this exact format (no markdown, no explanation, no code fences):
${jsonSchema}
${rules}`

// ── Args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const repeatIdx = args.indexOf('--repeat')
const REPEAT = repeatIdx >= 0 ? Math.max(1, parseInt(args[repeatIdx + 1] || '1', 10)) : 1
const folder = args.find((a, i) => !a.startsWith('--') && (repeatIdx < 0 || i !== repeatIdx + 1)) || 'tests/invoices'

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('Set ANTHROPIC_API_KEY. e.g.  ANTHROPIC_API_KEY=sk-ant-... node tests/invoice-model-compare.mjs')
  process.exit(1)
}
if (!existsSync(folder)) {
  console.error(`Folder not found: ${folder}\nCreate it and add a few real invoices (.pdf/.jpg/.png).`)
  process.exit(1)
}

// Pricing per 1M tokens (input, output) — for a rough cost estimate.
const PRICING = {
  'claude-opus-4-8': [5, 25],
  'claude-sonnet-5': [3, 15], // sticker; intro $2/$10 through 2026-08-31
}

const MIME = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

function fileBlock(path) {
  const ext = extname(path).toLowerCase()
  const media = MIME[ext]
  if (!media) return null
  const data = readFileSync(path).toString('base64')
  return media === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: media, data } }
    : { type: 'image', source: { type: 'base64', media_type: media, data } }
}

async function callModel(model, block) {
  const t0 = Date.now()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, block] }],
    }),
  })
  const ms = Date.now() - t0
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return { error: err?.error?.message || `HTTP ${res.status}`, ms }
  }
  const body = await res.json()
  const text = (body.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  let parsed = null, parseError = null
  try { parsed = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()) }
  catch (e) { parseError = e.message }
  return { parsed, parseError, ms, usage: body.usage }
}

const money = n => (typeof n === 'number' ? n : parseFloat(n) || 0)

// Reconciliation: does sum(items) + charges - credit ≈ total?
function reconcile(inv) {
  if (!inv) return null
  const items = Array.isArray(inv.items) ? inv.items.reduce((s, it) => s + money(it.cost), 0) : 0
  const computed = items + money(inv.tax_gst) + money(inv.tax_pst) + money(inv.delivery)
    + money(inv.deposit) + money(inv.other_cost) - money(inv.credit)
  const total = money(inv.total)
  return { computed: +computed.toFixed(2), total, delta: +(computed - total).toFixed(2), ok: Math.abs(computed - total) <= 0.05 }
}

function estCost(usage, model) {
  if (!usage || !PRICING[model]) return 0
  const [pin, pout] = PRICING[model]
  const inTok = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0)
  return (inTok * pin + (usage.output_tokens || 0) * pout) / 1e6
}

// Field-by-field scoring against optional ground truth.
const SCALAR_FIELDS = ['vendor', 'invoice_number', 'invoice_date', 'total', 'tax_gst', 'tax_pst', 'delivery', 'deposit', 'credit', 'other_cost', 'page_current', 'page_total']
function scoreAgainstTruth(inv, truth) {
  if (!inv || !truth) return null
  let hits = 0, checked = 0
  const misses = []
  for (const f of SCALAR_FIELDS) {
    if (truth[f] === undefined) continue
    checked++
    const a = typeof truth[f] === 'number' ? money(inv[f]) : String(inv[f] ?? '').trim().toLowerCase()
    const b = typeof truth[f] === 'number' ? money(truth[f]) : String(truth[f]).trim().toLowerCase()
    const match = typeof truth[f] === 'number' ? Math.abs(a - b) <= 0.05 : a === b
    if (match) hits++; else misses.push(`${f}: got ${JSON.stringify(inv[f])} want ${JSON.stringify(truth[f])}`)
  }
  if (truth.item_count !== undefined) {
    checked++
    const n = Array.isArray(inv.items) ? inv.items.length : 0
    if (n === truth.item_count) hits++; else misses.push(`item_count: got ${n} want ${truth.item_count}`)
  }
  return { hits, checked, misses }
}

// ── Run ──────────────────────────────────────────────────────────────────────
const invoiceFiles = readdirSync(folder).filter(f => MIME[extname(f).toLowerCase()])
if (!invoiceFiles.length) {
  console.error(`No invoice files in ${folder}/ (looked for ${Object.keys(MIME).join(', ')})`)
  process.exit(1)
}

console.log(`\nComparing  A=${MODEL_A}  vs  B=${MODEL_B}`)
console.log(`Invoices: ${invoiceFiles.length}   Repeats: ${REPEAT}   Folder: ${folder}\n`)

const tally = {
  [MODEL_A]: { reconOk: 0, ms: 0, cost: 0, calls: 0, truthHits: 0, truthChecked: 0 },
  [MODEL_B]: { reconOk: 0, ms: 0, cost: 0, calls: 0, truthHits: 0, truthChecked: 0 },
}

for (const fname of invoiceFiles) {
  const path = join(folder, fname)
  const block = fileBlock(path)
  if (!block) continue
  const truthPath = join(folder, `${basename(fname, extname(fname))}.truth.json`)
  const truth = existsSync(truthPath) ? JSON.parse(readFileSync(truthPath, 'utf8')) : null

  console.log(`━━ ${fname} ${truth ? '(has ground truth)' : ''}`)

  for (const [label, model] of [['A', MODEL_A], ['B', MODEL_B]]) {
    for (let r = 0; r < REPEAT; r++) {
      const out = await callModel(model, block)
      const t = tally[model]
      t.calls++; t.ms += out.ms || 0; t.cost += estCost(out.usage, model)
      const tag = REPEAT > 1 ? `${label}#${r + 1}` : label
      if (out.error) { console.log(`  ${tag} ${model}  ERROR: ${out.error}`); continue }
      if (out.parseError) { console.log(`  ${tag} ${model}  JSON parse failed: ${out.parseError}`); continue }
      const inv = out.parsed
      const rec = reconcile(inv)
      if (rec?.ok) t.reconOk++
      const nItems = Array.isArray(inv.items) ? inv.items.length : 0
      let line = `  ${tag} ${model}  total=${money(inv.total).toFixed(2)}  items=${nItems}  ` +
        `recon=${rec?.ok ? 'OK' : `off by ${rec?.delta}`}  ${(out.ms / 1000).toFixed(1)}s  $${estCost(out.usage, model).toFixed(4)}`
      if (truth) {
        const sc = scoreAgainstTruth(inv, truth)
        t.truthHits += sc.hits; t.truthChecked += sc.checked
        line += `  truth=${sc.hits}/${sc.checked}`
        if (sc.misses.length) line += `\n      ✗ ${sc.misses.join('\n      ✗ ')}`
      }
      console.log(line)
    }
  }
  console.log('')
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('════════ SUMMARY ════════')
for (const [label, model] of [['A', MODEL_A], ['B', MODEL_B]]) {
  const t = tally[model]
  const parts = [
    `reconcile ${t.reconOk}/${t.calls}`,
    `avg ${(t.ms / t.calls / 1000).toFixed(1)}s`,
    `total cost $${t.cost.toFixed(4)}`,
  ]
  if (t.truthChecked) parts.push(`ground-truth ${t.truthHits}/${t.truthChecked} fields`)
  console.log(`${label} ${model.padEnd(18)}  ${parts.join('   ')}`)
}
console.log(`\nHigher reconcile + higher ground-truth = better reading. Compare cost to decide if the tradeoff is worth it.`)
