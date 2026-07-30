// ===== pos-parse.js — POS sales export parsing =====
//
// Turns a sales CSV exported from a point-of-sale system into the neutral shape
// the Sales import screen and /api/pos-imports work with. No DOM, no network,
// no globals beyond the window export at the bottom — everything here is a pure
// function so tests/pos-parse.test.mjs can exercise the shipped source through
// tests/helpers/browser-module.mjs.
//
// WHY CLIENT-SIDE: a sales export is plain structured text, so unlike an invoice
// it needs no AI and no server round-trip to read. Parsing in the browser keeps
// a 5 MB file off the worker entirely; the result is POSTed as JSON and stashed
// in pos_imports.parsed_data, exactly as invoice.js does with the parser output.
// The raw file is uploaded to R2 separately as the audit copy.
//
// The commit route re-derives every total from parsed_data rather than trusting
// these numbers — a tampered blob can only misstate the customer's own revenue,
// the same exposure the invoice parser already has.

// ─── Limits ───────────────────────────────────────────────────
// A month of a busy restaurant is a few thousand rows. Well past that and the
// import stops being something a person reviews on screen, so it is refused with
// advice rather than accepted and turned into an unreadable mapping table.
const POS_MAX_BYTES = 5 * 1024 * 1024;
const POS_MAX_ROWS  = 20000;

// If this share of rows have a date we can't read, the file is not what we think
// it is — better to refuse than to import a month of sales onto the wrong days.
const POS_MAX_BAD_DATE_RATIO = 0.2;

// ─── Value coercion ───────────────────────────────────────────

// POS exports write money as display strings, not numbers: '$12.00', '$1,234.56',
// and negatives as either '-$2.00' or '($2.00)' depending on locale settings.
function posMoney(v) {
  let s = String(v == null ? '' : v).trim();
  if (!s) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[^0-9.\-]/g, '');
  if (s.indexOf('-') !== -1) { neg = true; s = s.replace(/-/g, ''); }
  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  return neg ? -n : n;
}

function posNum(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
}

// Accepts ISO ('2026-07-20', optionally with a time) and US slash dates
// ('7/20/2026'). Returns '' when it can't tell.
//
// A slash date whose FIRST component is over 12 is rejected outright rather than
// read as day-first. It is not that the row itself is unclear — 13/07 can only be
// a day — it is that its presence proves the whole file is day-first, which means
// every other row ('07/08/2026') has silently been read as the wrong date. One
// such row poisons the file, so the file is what gets refused.
function posNormDate(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slash = s.match(/^(\d{1,2})[/](\d{1,2})[/](\d{4})/);
  if (slash) {
    const a = parseInt(slash[1], 10), b = parseInt(slash[2], 10);
    if (a > 12) return '';               // day-first file — see note above
    if (b > 31 || b < 1 || a < 1) return '';
    return `${slash[3]}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
  }
  return '';
}

// ─── The mapping key ──────────────────────────────────────────
// Menu names arrive with inconsistent punctuation, casing and spacing between
// exports ("Margherita Pizza" / "MARGHERITA  PIZZA" / "Margherita-Pizza"), so the
// stored mapping is keyed on a normalised form rather than the display string.
function posNormKeyPart(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// 'margherita pizza|regular'. A key ending in '|' (no price point) is the
// "any size" rule, used as the fallback when no size-specific mapping exists.
function posItemKey(name, pricePoint) {
  return posNormKeyPart(name) + '|' + posNormKeyPart(pricePoint);
}

function posAnySizeKey(key) {
  return String(key || '').split('|')[0] + '|';
}

// ─── CSV tokenizer ────────────────────────────────────────────
// A character scanner, not a line split. Real exports contain quoted fields with
// embedded commas ("Bella Napoli - Main St, Unit 4"), doubled quotes ("6"" pizza")
// and — in free-text columns like Notes — embedded newlines. Splitting on '\n'
// first and repairing afterwards is precisely the bug this avoids.
function parseCsv(text) {
  let src = String(text == null ? '' : text);

  // Square (and Excel) prepend a UTF-8 BOM often enough to matter. Left in, it
  // becomes part of the first header cell and every lookup of 'Date' misses.
  if (src.charCodeAt(0) === 0xFEFF) src = src.slice(1);
  src = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!src.trim()) return [];

  const rows = [];
  let row = [], field = '', inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }   // "" is a literal quote
        else inQuotes = false;
      } else field += c;
      continue;
    }

    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  // Drop rows that are entirely empty — a trailing newline, or the blank line
  // some exports put between the data and a summary block.
  const out = rows.filter(r => r.some(cell => String(cell).trim() !== ''));
  if (!out.length) return [];

  // Pad short rows to the header width so column lookup by index is total.
  // Exports omit trailing empty cells more often than you would hope.
  const width = out[0].length;
  for (const r of out) while (r.length < width) r.push('');

  return out;
}

// ─── Format registry ──────────────────────────────────────────
// Adding Clover is one more entry here and nothing else. `required` is the
// smallest set of columns that both identifies the export and is actually needed
// downstream, so a Square export with optional columns switched off still works.
const POS_FORMATS = [
  {
    id: 'square',
    label: 'Square',
    required: ['Date', 'Item', 'Qty', 'Net Sales'],
    help: 'In Square: Dashboard → Reports → Item Sales → Export → Detail CSV.',
    map: (get) => ({
      sold_date:     posNormDate(get('Date')),
      sold_time:     String(get('Time') || '').trim(),
      pos_item_name: String(get('Item') || '').trim(),
      pos_category:  String(get('Category') || '').trim(),
      pos_sku:       String(get('SKU') || '').trim(),
      price_point:   String(get('Price Point Name') || '').trim(),
      // Stored verbatim and unused for now. Modifiers carry real ingredient cost
      // ("Extra Mozzarella") and this is the only chance to capture them —
      // mining them later must not require the customer to re-export.
      modifiers:     String(get('Modifiers Applied') || '').trim(),
      qty:           posNum(get('Qty')),
      gross_sales:   posMoney(get('Gross Sales')),
      discounts:     posMoney(get('Discounts')),
      net_sales:     posMoney(get('Net Sales')),
      tax:           posMoney(get('Tax')),
      external_ref:  String(get('Record ID') || '').trim(),
      external_txn:  String(get('Transaction ID') || '').trim(),
      _event:        String(get('Event Type') || '').trim(),
      _itemization:  String(get('Itemization Type') || '').trim(),
    }),
    // v1 counts sales only. Refunds, comps and non-item lines (gift cards,
    // service charges) are dropped and reported — half-handling a refund is
    // worse than not handling it, because a wrong stock figure looks right.
    skip: (r) => {
      if (r._itemization && r._itemization.toUpperCase() !== 'ITEM') return 'non-item line';
      if (r._event && r._event.toLowerCase() !== 'payment') return 'refund or adjustment';
      if (!(r.qty > 0)) return 'zero or negative quantity';
      return '';
    },
  },
];

function posNormHeader(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
}

// Returns { format, tried } — `tried` lists what each candidate was missing, so
// the UI can say why the file was refused instead of just "unsupported".
function detectPosFormat(headerCells) {
  const present = new Set((headerCells || []).map(posNormHeader));
  const tried = [];

  for (const fmt of POS_FORMATS) {
    const missing = fmt.required.filter(col => !present.has(posNormHeader(col)));
    if (!missing.length) return { format: fmt, tried };
    tried.push({ id: fmt.id, label: fmt.label, missing });
  }
  return { format: null, tried };
}

// ─── The entry point ──────────────────────────────────────────
// Returns { ok: false, error, ... } or the neutral import shape. Never throws on
// bad input — a refusal the user can act on beats a stack trace.
function parsePosCsv(text, fileName) {
  const raw = String(text == null ? '' : text);

  if (raw.length > POS_MAX_BYTES) {
    return { ok: false, error: 'too_large',
             message: 'That file is over 5 MB. Export one month at a time.' };
  }

  const rows = parseCsv(raw);
  if (rows.length < 2) {
    return { ok: false, error: 'empty',
             message: "That file has no sales rows in it — just a header, or nothing at all." };
  }

  const header = rows[0];
  const { format, tried } = detectPosFormat(header);
  if (!format) {
    const miss = (tried[0] && tried[0].missing) || [];
    return {
      ok: false, error: 'unknown_format', tried,
      message: miss.length
        ? `This doesn't look like a Square item-sales export — the columns ${miss.join(', ')} are missing.`
        : "This doesn't look like a sales export we recognise.",
      help: POS_FORMATS[0].help,
    };
  }

  const dataRows = rows.slice(1);
  if (dataRows.length > POS_MAX_ROWS) {
    return { ok: false, error: 'too_many_rows',
             message: `That export has ${dataRows.length.toLocaleString()} rows. Split it by month and import one at a time.` };
  }

  // Column name → index, from the header we just validated.
  const index = {};
  header.forEach((cell, i) => {
    const k = posNormHeader(cell);
    if (k && !(k in index)) index[k] = i;
  });

  const lines = [];
  const skipped = {};
  let badDates = 0;

  for (const cells of dataRows) {
    const get = (col) => {
      const i = index[posNormHeader(col)];
      return i === undefined ? '' : cells[i];
    };

    const row = format.map(get);
    const why = format.skip(row);
    if (why) { skipped[why] = (skipped[why] || 0) + 1; continue; }
    if (!row.sold_date) badDates++;
    if (!row.pos_item_name) continue;      // nothing to map; not worth a warning

    row.pos_item_key = posItemKey(row.pos_item_name, row.price_point);

    // Strip the parser's private fields — they exist only for skip().
    for (const k of Object.keys(row)) if (k.charAt(0) === '_') delete row[k];
    lines.push(row);
  }

  if (!lines.length) {
    return { ok: false, error: 'no_usable_rows',
             message: 'Every row in that file was a refund, an adjustment or a non-item line — there are no sales to import.' };
  }

  if (badDates / lines.length > POS_MAX_BAD_DATE_RATIO) {
    return { ok: false, error: 'bad_dates',
             message: `${badDates} of ${lines.length} rows have a date this can't read. If your POS exports day-first dates (13/07/2026), switch the export to ISO or US format.` };
  }

  // Totals and the per-item roll-up, in one pass.
  const totals = { gross: 0, discounts: 0, net: 0, tax: 0, qty: 0, lines: lines.length };
  const itemMap = new Map();
  let periodStart = '', periodEnd = '';

  for (const l of lines) {
    totals.gross     += l.gross_sales;
    totals.discounts += l.discounts;
    totals.net       += l.net_sales;
    totals.tax       += l.tax;
    totals.qty       += l.qty;

    if (l.sold_date) {
      if (!periodStart || l.sold_date < periodStart) periodStart = l.sold_date;
      if (!periodEnd   || l.sold_date > periodEnd)   periodEnd   = l.sold_date;
    }

    let it = itemMap.get(l.pos_item_key);
    if (!it) {
      it = { pos_item_key: l.pos_item_key, pos_item_name: l.pos_item_name,
             price_point: l.price_point, pos_category: l.pos_category,
             qty: 0, net_sales: 0, line_count: 0 };
      itemMap.set(l.pos_item_key, it);
    }
    it.qty       += l.qty;
    it.net_sales += l.net_sales;
    it.line_count++;
  }

  for (const k of Object.keys(totals)) totals[k] = Math.round(totals[k] * 1e6) / 1e6;
  for (const it of itemMap.values()) {
    it.qty       = Math.round(it.qty * 1e6) / 1e6;
    it.net_sales = Math.round(it.net_sales * 1e6) / 1e6;
  }

  const warnings = [];
  for (const [why, n] of Object.entries(skipped)) {
    warnings.push(`Ignored ${n} ${n === 1 ? 'row' : 'rows'} (${why}).`);
  }
  if (badDates) warnings.push(`${badDates} rows had an unreadable date and will import without one.`);

  return {
    ok: true,
    version: 1,
    source: format.id,
    file_name: String(fileName || ''),
    period_start: periodStart,
    period_end: periodEnd,
    lines,
    // The UI's unit of work: many sale lines collapse to a few things to map,
    // biggest seller first so the money gets mapped before the long tail.
    items: [...itemMap.values()].sort((a, b) => b.net_sales - a.net_sales),
    totals,
    warnings,
  };
}

window.posParse = {
  parseCsv, detectPosFormat, parsePosCsv,
  posItemKey, posAnySizeKey, posNormKeyPart,
  posMoney, posNum, posNormDate,
  POS_FORMATS,
};
