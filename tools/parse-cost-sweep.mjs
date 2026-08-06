#!/usr/bin/env node
// Measure what an invoice parse actually costs, and what changes if you turn
// the dials down. Run the SAME invoice at several effort levels and compare
// both the bill and the extracted figures side by side.
//
// Why this exists: production sets `thinking: {type:'adaptive'}` with no
// `effort`, so it runs at the default `high`. Thinking tokens bill as OUTPUT at
// $25/M — five times the input rate — and output is ~68% of the measured cost
// per parse. Effort is therefore the biggest single lever, and it is one line.
// But whether `medium` or `low` still reads an invoice correctly is a question
// about YOUR invoices, not one to answer from a docs page. Hence: measure.
//
// The prompt, schema and rules are read out of src/index.ts at run time rather
// than copied here, so this can never drift from what production actually sends.
//
//   ANTHROPIC_API_KEY=... node tools/parse-cost-sweep.mjs invoice.pdf
//   node tools/parse-cost-sweep.mjs invoice.pdf page2.pdf      # multi-page batch
//   node tools/parse-cost-sweep.mjs --efforts=high,low invoice.pdf
//   node tools/parse-cost-sweep.mjs --no-expiry invoice.pdf    # + a run with
//                                    the unused expiry_date field stripped
//
// The key is read from ANTHROPIC_API_KEY, or from .dev.vars if that is where you
// keep it. It is never printed, never written anywhere, and never sent anywhere
// except api.anthropic.com.
import { readFileSync, existsSync } from 'node:fs';
import { basename, extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Opus 4.8 list price. Thinking tokens are billed at the OUTPUT rate — there is
// no separate thinking rate — which is exactly why effort moves the bill.
const IN_PER_M = 5, OUT_PER_M = 25;
const MODEL = 'claude-opus-4-8';

// ── key ──────────────────────────────────────────────────────────
function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY.trim();
  const dev = join(ROOT, '.dev.vars');
  if (existsSync(dev)) {
    const m = readFileSync(dev, 'utf8').match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  console.error(
    'No API key found.\n\n' +
    'Put it in either place and re-run — this script only reads it, never prints it:\n' +
    '  export ANTHROPIC_API_KEY=sk-ant-...\n' +
    'or add a line to .dev.vars:\n' +
    '  ANTHROPIC_API_KEY=sk-ant-...\n');
  process.exit(1);
}

// ── the real prompt, lifted from src/index.ts ────────────────────
// Pulled at run time so a change to the production prompt is picked up here
// automatically. A copy would rot and quietly make these measurements a lie.
function productionPrompt() {
  const src = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8');
  const grab = (startMarker, endMarker) => {
    const i = src.indexOf(startMarker);
    if (i < 0) throw new Error(`could not find ${startMarker} in src/index.ts`);
    const j = src.indexOf(endMarker, i + startMarker.length);
    if (j < 0) throw new Error(`could not find the end of ${startMarker}`);
    return src.slice(i + startMarker.length, j);
  };
  const jsonSchema = grab('const jsonSchema = `', '`\n');
  const rules      = 'Rules:' + grab('const rules = `Rules:', "nothing else`");
  const header     = grab('const prompt = `', '${jsonSchema}');
  return { header, jsonSchema, rules: rules + 'nothing else' };
}

// ── files → content blocks, exactly as the worker builds them ────
function fileBlock(path) {
  const buf  = readFileSync(path);
  const ext  = extname(path).toLowerCase();
  const data = buf.toString('base64');
  if (ext === '.pdf') {
    return { block: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
             kind: 'PDF (document block — image resolution does not apply)', bytes: buf.length };
  }
  const media = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { block: { type: 'image', source: { type: 'base64', media_type: media, data } },
           kind: `image (${media})`, bytes: buf.length };
}

// ── one run ──────────────────────────────────────────────────────
async function runOnce({ key, prompt, blocks, effort, label }) {
  const body = {
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...blocks] }],
  };
  // Omitted entirely for the baseline — that is production today, and an
  // explicit "high" is not guaranteed to be byte-identical to omitting it.
  if (effort) body.output_config = { effort };

  const t0 = Date.now();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key,
               'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  const data = await res.json();
  if (!res.ok) {
    return { label, error: data?.error?.message || `HTTP ${res.status}`, ms };
  }

  const usage = data.usage || {};
  const inTok = usage.input_tokens || 0, outTok = usage.output_tokens || 0;
  const cost = (inTok / 1e6) * IN_PER_M + (outTok / 1e6) * OUT_PER_M;

  const raw = (data.content || []).find(b => b.type === 'text')?.text || '';
  let parsed = null, parseError = null;
  try {
    parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '')
                           .replace(/```\s*$/i, '').trim());
  } catch (e) { parseError = e.message; }

  return { label, inTok, outTok, cost, ms, parsed, parseError,
           stopReason: data.stop_reason, raw };
}

// ── comparison ───────────────────────────────────────────────────
const MONEY = ['total', 'tax_gst', 'tax_pst', 'delivery', 'deposit', 'credit', 'other_cost'];
const TEXT  = ['vendor', 'invoice_number', 'invoice_date'];

function summarise(r) {
  if (r.error || !r.parsed) return {};
  const p = r.parsed;
  const o = { items: Array.isArray(p.items) ? p.items.length : 0 };
  for (const f of TEXT)  o[f] = p[f] ?? '';
  for (const f of MONEY) o[f] = Number(p[f] ?? 0);
  o._itemsSum = (p.items || []).reduce((s, it) => s + (Number(it.cost) || 0), 0);
  return o;
}

function diffAgainstBaseline(base, other) {
  const a = summarise(base), b = summarise(other), out = [];
  for (const k of Object.keys(a)) {
    if (k.startsWith('_')) continue;
    const av = a[k], bv = b[k];
    if (typeof av === 'number' ? Math.abs(av - bv) > 0.005 : String(av) !== String(bv)) {
      out.push(`${k}: ${JSON.stringify(av)} → ${JSON.stringify(bv)}`);
    }
  }
  return out;
}

// ── main ─────────────────────────────────────────────────────────
const argv    = process.argv.slice(2);
const files   = argv.filter(a => !a.startsWith('--'));
const noExpiry = argv.includes('--no-expiry');
const effortArg = (argv.find(a => a.startsWith('--efforts=')) || '').split('=')[1];
// null = omit the parameter = production today.
const efforts = effortArg ? effortArg.split(',').map(s => s === 'high' ? null : s)
                          : [null, 'medium', 'low'];

if (!files.length) {
  console.error('Usage: node tools/parse-cost-sweep.mjs <invoice-file> [more-pages...] [--efforts=high,medium,low] [--no-expiry]');
  process.exit(1);
}
for (const f of files) if (!existsSync(f)) { console.error(`No such file: ${f}`); process.exit(1); }

const key = apiKey();
const { header, jsonSchema, rules } = productionPrompt();
const build = (schema) => `${header}${schema}\n\n${rules}`;
const blocks = files.map(fileBlock);

console.log(`\nModel      ${MODEL}   ($${IN_PER_M}/M in, $${OUT_PER_M}/M out)`);
console.log(`Files      ${files.map((f, i) => `${basename(f)} — ${blocks[i].kind}, ${(blocks[i].bytes/1024).toFixed(0)} KB`).join('\n           ')}`);
const runs = efforts.length + (noExpiry ? 1 : 0);
console.log(`Runs       ${runs}  (roughly $${(runs * 0.15).toFixed(2)} of real API spend)\n`);

const contentBlocks = blocks.map(b => b.block);
const results = [];

for (const effort of efforts) {
  const label = effort === null ? 'high (production today)' : effort;
  process.stdout.write(`  running effort=${label} … `);
  const r = await runOnce({ key, prompt: build(jsonSchema), blocks: contentBlocks, effort, label });
  console.log(r.error ? `FAILED: ${r.error}` : `${(r.ms/1000).toFixed(1)}s  $${r.cost.toFixed(4)}`);
  results.push(r);
}

if (noExpiry) {
  // Nothing in the invoice flow reads expiry_date — the only consumer of that
  // name anywhere in the frontend is certifications.js, a different feature.
  const stripped = jsonSchema.replace(/^.*"expiry_date".*$\n?/m, '');
  const label = 'low + expiry_date removed';
  process.stdout.write(`  running ${label} … `);
  const r = await runOnce({ key, prompt: build(stripped), blocks: contentBlocks, effort: 'low', label });
  console.log(r.error ? `FAILED: ${r.error}` : `${(r.ms/1000).toFixed(1)}s  $${r.cost.toFixed(4)}`);
  results.push(r);
}

// --save writes each run's raw extraction to disk, so it can be loaded into the
// real review screen and judged by eye rather than by diff.
if (argv.includes('--save')) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const dir = join(ROOT, '.parse-runs');
  mkdirSync(dir, { recursive: true });
  for (const r of results) {
    if (!r.parsed) continue;
    const slug = r.label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    writeFileSync(join(dir, `${slug}.json`),
      JSON.stringify({ label: r.label, inTok: r.inTok, outTok: r.outTok,
                       cost: r.cost, ms: r.ms, parsed: r.parsed }, null, 2));
  }
  console.log(`\nSaved ${results.filter(r => r.parsed).length} extractions to .parse-runs/`);
}

// ── report ───────────────────────────────────────────────────────
const ok = results.filter(r => !r.error);
if (!ok.length) { console.error('\nEvery run failed — nothing to compare.'); process.exit(1); }
const base = ok[0];

console.log('\n\nCOST');
console.log('─'.repeat(78));
console.log('setting'.padEnd(28) + 'in'.padStart(8) + 'out'.padStart(8) +
            'cost'.padStart(10) + 'vs base'.padStart(11) + 'time'.padStart(9));
console.log('─'.repeat(78));
for (const r of ok) {
  const delta = r === base ? '—'
    : `${((r.cost - base.cost) / base.cost * 100).toFixed(0)}%`;
  console.log(r.label.padEnd(28) +
    String(r.inTok).padStart(8) + String(r.outTok).padStart(8) +
    ('$' + r.cost.toFixed(4)).padStart(10) + delta.padStart(11) +
    ((r.ms/1000).toFixed(1) + 's').padStart(9));
}
console.log('─'.repeat(78));
console.log(`\nAt 150 invoices/month, the cheapest run above would cost ` +
  `$${(Math.min(...ok.map(r => r.cost)) * 150).toFixed(2)}/mo vs ` +
  `$${(base.cost * 150).toFixed(2)}/mo today.`);

console.log('\n\nDID THE NUMBERS SURVIVE?');
console.log('─'.repeat(78));

// A run can come back billed-for but unusable: `stop_reason: max_tokens` means
// the model was still writing when it hit the ceiling, so the JSON is cut off
// mid-object and nothing can be read from it. That is a REAL production
// outcome, not a harness problem — src/index.ts sends the same max_tokens —
// so report it as a result rather than crashing on the missing fields, which
// is what this used to do and which read like a broken tool.
for (const r of results) {
  if (r.error)      console.log(`\n${r.label}: ⚠ API error — ${r.error}`);
  else if (!r.parsed) {
    console.log(`\n${r.label}: ⚠ NO USABLE RESULT — ${r.outTok} output tokens, ` +
                `stop_reason=${r.stopReason}` +
                (r.stopReason === 'max_tokens'
                  ? `\n  Hit the ${16000}-token output ceiling and was truncated mid-JSON. ` +
                    `Production sends the same ceiling, so this invoice would fail there too.`
                  : '') +
                (r.parseError ? `\n  JSON did not parse: ${r.parseError}` : ''));
  }
}
if (!base.parsed) {
  console.log('\nNo baseline to compare against — the high run produced nothing usable.');
  console.log('─'.repeat(78));
  process.exit(0);
}

const bs = summarise(base);
console.log(`baseline: ${bs.vendor} · ${bs.invoice_number} · ${bs.invoice_date} · ` +
            `${bs.items} line items · total $${bs.total}`);
console.log(`          line items sum to $${bs._itemsSum.toFixed(2)}` +
            (Math.abs(bs._itemsSum - bs.total) > 1 ? '  ← does not match the invoice total' : ''));
for (const r of ok) {
  if (r === base) continue;
  const d = diffAgainstBaseline(base, r);
  console.log(`\n${r.label}:`);
  if (r.parseError) console.log(`  ⚠ JSON did not parse: ${r.parseError}`);
  else if (!d.length) console.log('  identical to baseline on every checked field ✓');
  else d.forEach(line => console.log(`  ✗ ${line}`));
  if (r.stopReason && r.stopReason !== 'end_turn') console.log(`  stop_reason: ${r.stopReason}`);
}
// --show dumps the baseline's full extraction so a human can check it against
// the paper invoice. A cost table proves the runs AGREE with each other; only
// your eyes prove they agree with the invoice.
if (argv.includes('--show') && base.parsed) {
  const p = base.parsed;
  console.log('\n\nWHAT IT READ OFF THE INVOICE  (check this against the paper)');
  console.log('─'.repeat(78));
  for (const f of ['vendor','invoice_number','invoice_date','page_note','page_current','page_total'])
    console.log(`  ${f.padEnd(16)} ${JSON.stringify(p[f] ?? '')}`);
  console.log('  ' + '·'.repeat(60));
  let charges = 0;
  for (const f of ['tax_gst','tax_pst','delivery','deposit','other_cost','credit']) {
    const v = Number(p[f] ?? 0);
    if (f !== 'credit') charges += v; else charges -= v;
    console.log(`  ${f.padEnd(16)} ${v.toFixed(2)}`);
  }
  if (p.other_desc) console.log(`  ${'other_desc'.padEnd(16)} ${JSON.stringify(p.other_desc)}`);
  console.log('  ' + '·'.repeat(60));
  const items = p.items || [];
  const sum = items.reduce((s, it) => s + (Number(it.cost) || 0), 0);
  items.forEach((it, i) => {
    console.log(`  ${String(i+1).padStart(2)}. ${(it.name||'').slice(0,34).padEnd(36)}` +
                `${String(it.qty ?? '').padStart(5)} x ${String(it.unit_price ?? '').padStart(9)}` +
                ` = ${String(it.cost ?? '').padStart(9)}`);
    if (it.pack_size) console.log(`      pack ${it.pack_size}   sku ${it.sku || '—'}`);
  });
  console.log('  ' + '·'.repeat(60));
  const total = Number(p.total ?? 0);
  console.log(`  items                 ${sum.toFixed(2)}`);
  console.log(`  + charges             ${charges.toFixed(2)}`);
  console.log(`  = computed            ${(sum + charges).toFixed(2)}`);
  console.log(`  invoice total         ${total.toFixed(2)}`);
  const gap = Math.abs(sum + charges - total);
  console.log(gap <= 1
    ? `  ✓ reconciles (within the app's $1 tolerance)`
    : `  ✗ OFF BY ${gap.toFixed(2)} — the app would flag this for review`);
}

console.log('\n' + '─'.repeat(78));
console.log('A cheaper run that matches the baseline on every field is a real saving.');
console.log('One that differs on a money field is not — read the invoice yourself');
console.log('before believing either version.\n');
