/* ===== invoices.js ===== */

const INV_LIST_TABLE = 'invoices';
const PAGE_SIZE_INV  = 20;

let allInvoices   = [];
let filteredInvs  = [];
let currentInvPage = 1;
let activeStatus  = 'all';
let sortField     = 'upload_date';
let sortDir       = 'desc'; // 'asc' | 'desc'
let currentInvTotal = 0;   // stored DB total for the open invoice (source of truth)
let _invImgZoomCleanup = null;

let invoiceUnits = [];

async function loadInvoiceUnits() {
  try {
    const data = await apiGet('tables/units?page=1&limit=100');
    invoiceUnits = (data.data || []).slice().sort((a, b) => a.sort_order - b.sort_order);
  } catch (_) { invoiceUnits = []; }
}

// A unit only counts as set when it matches the units master list — the same
// test the dropdown uses to select an option. A non-empty but UNRECOGNISED unit
// ("case", "cs", "ct") renders as a blank dropdown yet used to satisfy the
// blank-string check, so such lines closed with a meaningless cost_per_unit.
// Add the unit via Manage Units if it's a real one.
function isKnownUnit(unit) {
  const u = (unit || '').trim().toLowerCase();
  if (!u) return false;
  return invoiceUnits.some(x => (x.name || '').trim().toLowerCase() === u);
}

function populateInvoiceUnitDropdown(select, selectedValue) {
  const seen = new Set();
  const opts = invoiceUnits
    .filter(u => { const k = (u.name || '').toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .map(u => `<option value="${esc(u.name)}">${esc(u.name)}</option>`)
    .join('');
  select.innerHTML =
    '<option value=""></option>' +
    opts +
    '<option value="__manage_units__" style="color:var(--primary);font-style:italic">+ Manage units</option>';
  if (selectedValue) {
    const lower = selectedValue.toLowerCase();
    const opt = Array.from(select.options).find(o => o.value.toLowerCase() === lower);
    if (opt) opt.selected = true;
  }
}

function fmtDate(iso) {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : iso;
}

// Split a pack-size string into an editable qty + unit for the review row.
// Mirrors the backend parsePackSize() for multi-pack formats so a multiplied
// pack ("2 x 2 kg" = 4 kg) pre-fills correctly instead of collapsing to qty "2"
// with an unrecognized "x 2 kg" unit (which shows blank and, if approved, gets
// coerced to "each"). Simple "N unit" packs keep their existing behavior.
// 'lt' is a supplier spelling of litre, not a unit of its own. It is translated
// to 'L' here rather than added to the units master list on purpose: a stored
// 'lt' would be a SECOND volume unit that does not convert into 'L', so oil
// invoiced in 'lt' could not be costed into a recipe measured in 'L'. Keeping it
// out of the master list keeps it out of every picker, so the customer only ever
// sees 'L'. Mirrors normalizeUnit() in src/index.ts.
//
// Deliberately narrow: ONLY 'lt' is rewritten. Every other unit token is passed
// through exactly as matched, casing included ("KG" stays "KG"), because the
// unit dropdown and isKnownUnit() already compare case-insensitively and
// changing that would move rows this parser gets right today.
function normalizeInvoiceUnit(u) {
  const t = (u || '').trim();
  return t.toLowerCase() === 'lt' ? 'L' : t;
}

function parsePackaging(str) {
  const s = (str || '').trim();
  if (!s) return { pack_qty: '', pack_unit: '' };
  // MUST stay identical to the copy in src/index.ts — this screen and the write
  // path have to agree on what a pack size means. tests/pack-size-pins.test.mjs
  // fails the suite if they drift apart.
  const unitPat = '(?:kg|g|lb|lbs|l|lt|ml|oz|fl\\s*oz|gal)';
  // "N x M unit" → qty = N*M (e.g. "2 x 2 kg" → 4 kg, "4x3 lt" → 12 L)
  let m = s.match(new RegExp(`^([\\d.]+)\\s*[×xX]\\s*([\\d.]+)\\s*(${unitPat})\\b`, 'i'));
  if (m) {
    const q = (parseFloat(m[1]) || 1) * (parseFloat(m[2]) || 1);
    return { pack_qty: String(Math.round(q * 1000) / 1000), pack_unit: normalizeInvoiceUnit(m[3]) };
  }
  // "N/M unit" fraction notation → the second number is the pack size (e.g. "1/5 kg" → 5 kg)
  m = s.match(new RegExp(`^([\\d.]+)\\s*/\\s*([\\d.]+)\\s*(${unitPat})\\b`, 'i'));
  if (m) return { pack_qty: m[2], pack_unit: normalizeInvoiceUnit(m[3]) };
  // Simple "N unit" / "N word" (unchanged)
  m = s.match(/^([\d.,]+)\s*(.*)$/);
  if (m) return { pack_qty: m[1], pack_unit: normalizeInvoiceUnit(m[2]) };
  return { pack_qty: '', pack_unit: normalizeInvoiceUnit(s) };
}

// Returns total base units: qty_ordered × the numeric size in pack_size string.
// e.g. 3 packs × "12 LB" → 36; falls back to qty_ordered when no numeric pack size.
function calcInventoryQty(packaging, qtyOrdered) {
  const { pack_qty } = parsePackaging(packaging);
  const packSize = parseFloat(pack_qty) || 1;
  return (parseFloat(qtyOrdered) || 1) * packSize;
}

// ── Bootstrap ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('invBody')) return;

  await loadInvoiceUnits();

  registerUnitRefreshCallback(async () => {
    await loadInvoiceUnits();
    renderLinesTable();
  });

  await loadInvoices();

  const vendorParam = new URLSearchParams(location.search).get('vendor');
  if (vendorParam) {
    document.getElementById('vendorFilter').value = vendorParam;
    applyFilters();
  }

  // If URL has ?open=ID, open that invoice's detail modal
  const openParam = new URLSearchParams(location.search).get('open');
  if (openParam && allInvoices.find(i => i.id === openParam)) {
    openInvDetail(openParam);
  }

  // If URL hash is an invoice ID (e.g. from product page link), open its detail
  if (!openParam && location.hash && location.hash.length > 1) {
    const hashId = location.hash.slice(1);
    if (allInvoices.find(i => i.id === hashId)) {
      openInvDetail(hashId);
    }
  }

  // Status tabs
  document.querySelectorAll('.status-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.status-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeStatus = btn.dataset.status;
      currentInvPage = 1;
      applyFilters();
    });
  });

  // Vendor + date filters
  document.getElementById('vendorFilter').addEventListener('change', () => { currentInvPage = 1; applyFilters(); });
  document.getElementById('dateFilter').addEventListener('change',   () => { currentInvPage = 1; applyFilters(); });

  // Search
  document.getElementById('invSearch').addEventListener('input', () => { currentInvPage = 1; applyFilters(); });

  // Column sort
  document.querySelectorAll('#invTable th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const f = th.dataset.sort;
      if (sortField === f) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortField = f;
        sortDir   = 'desc';
      }
      renderInvoices();
    });
  });

  // Detail modal
  document.getElementById('closeInvDetailModal').addEventListener('click', () => { _cleanInvImgZoom(); closeModal('invDetailModal'); });
  document.getElementById('closeInvDetailBtn').addEventListener('click',   () => { _cleanInvImgZoom(); closeModal('invDetailModal'); });
  document.getElementById('saveInvDetailBtn').addEventListener('click',    saveInvDetail);
  document.getElementById('confirmInvSaveBtn').addEventListener('click',   confirmAndSaveInvoice);
  document.getElementById('deleteInvBtn').addEventListener('click',        deleteInvoice);
  document.getElementById('voidInvBtn').addEventListener('click',         voidInvoice);
  document.getElementById('restoreInvBtn').addEventListener('click',      restoreInvoice);
  document.getElementById('detailReviewedBtn')?.addEventListener('click', toggleReviewed);
  document.getElementById('addPageBtn')?.addEventListener('click', () => document.getElementById('addPageFileInput')?.click());
  document.getElementById('addPageFileInput')?.addEventListener('change', handleAddPageFile);
  document.getElementById('markCompleteBtn')?.addEventListener('click', markInvoiceComplete);
  document.getElementById('addLineBtn').addEventListener('click',          addLineRow);

  // Live cost summary as user edits additional costs
  // detailTotalInput included so editing the stated total re-checks reconciliation live.
  ['detailTaxPst','detailTaxGst','detailDelivery','detailDeposit','detailCredit','detailOtherCost','detailTotalInput'].forEach(id => {
    document.getElementById(id).addEventListener('input', renderCostSummary);
  });
});

// ── Load ────────────────────────────────────────────────────────
async function loadInvoices() {
  try {
    const data   = await apiGet(`tables/${INV_LIST_TABLE}?page=1&limit=500`);
    allInvoices  = (data.data || []).sort((a, b) => (b.upload_date || '') > (a.upload_date || '') ? 1 : -1);
    populateVendorFilter();
    applyFilters();
  } catch (e) {
    document.getElementById('invBody').innerHTML =
      `<tr><td colspan="9" class="empty-row"><i class="fas fa-exclamation-triangle"></i> Failed to load invoices.</td></tr>`;
  }
}

function populateVendorFilter() {
  const vendors = [...new Set(allInvoices.map(i => i.vendor).filter(Boolean))].sort();
  const sel = document.getElementById('vendorFilter');
  sel.innerHTML = '<option value="">All Vendors</option>' +
    vendors.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
}

// ── Filter + sort ───────────────────────────────────────────────
function applyFilters() {
  const vendor  = document.getElementById('vendorFilter').value;
  const days    = parseInt(document.getElementById('dateFilter').value) || 0;
  const query   = document.getElementById('invSearch').value.trim().toLowerCase();
  const cutoff  = days ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : null;

  filteredInvs = allInvoices.filter(inv => {
    const isVoided = !!inv.voided_at;
    // The "Voided" tab shows only voided invoices; every other tab hides them.
    if (activeStatus === 'voided') {
      if (!isVoided) return false;
    } else {
      if (isVoided) return false;
      if (activeStatus !== 'all' && inv.status !== activeStatus) return false;
    }
    if (vendor && inv.vendor !== vendor) return false;
    if (cutoff  && (inv.invoice_date || inv.upload_date || '') < cutoff) return false;
    if (query) {
      const haystack = [inv.vendor, inv.invoice_number, inv.invoice_date, inv.upload_date, inv.status, inv.file_name]
        .join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  renderInvoices();
  renderInvStats();
}

// ── Render table ────────────────────────────────────────────────
function renderInvoices() {
  // Sort
  filteredInvs.sort((a, b) => {
    let va = a[sortField] ?? '';
    let vb = b[sortField] ?? '';
    if (sortField === 'total') { va = parseFloat(va) || 0; vb = parseFloat(vb) || 0; }
    if (va < vb) return sortDir === 'asc' ? -1 :  1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  // Paginate
  const total = filteredInvs.length;
  const pages = Math.ceil(total / PAGE_SIZE_INV) || 1;
  if (currentInvPage > pages) currentInvPage = pages;
  const start = (currentInvPage - 1) * PAGE_SIZE_INV;
  const slice = filteredInvs.slice(start, start + PAGE_SIZE_INV);

  const tbody = document.getElementById('invBody');
  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-row"><i class="fas fa-inbox"></i> No invoices found.</td></tr>`;
  } else {
    tbody.innerHTML = slice.map(inv => `
      <tr style="cursor:pointer" onclick="openInvDetail('${esc(inv.id)}')">
        <td>${fmtDate(inv.upload_date)}</td>
        <td style="font-weight:500">${esc(inv.vendor || '—')}</td>
        <td>${esc(inv.invoice_number || '—')}</td>
        <td>${fmtDate(inv.invoice_date)}</td>
        <td>${inv.voided_at ? '<span class="status-badge" style="background:#fee2e2;color:#991b1b">Voided</span>' : statusBadge(inv.status)}</td>
        <td style="text-align:right;font-weight:600">${inv.total ? '$' + parseFloat(inv.total).toFixed(2) : '—'}</td>
        <td>${esc(inv.payment_account || 'A/P')}</td>
        <td style="text-align:center">
          ${inv.file_key
            ? `<span title="${esc(inv.file_name || 'File attached')}" style="color:var(--primary)"><i class="fas fa-paperclip"></i></span>`
            : `<span style="color:#cbd5e1" title="No file"><i class="fas fa-paperclip"></i></span>`}
        </td>
        <td>
          <button class="btn btn-icon btn-secondary btn-sm" onclick="event.stopPropagation();openInvDetail('${esc(inv.id)}')" title="View / Edit">
            <i class="fas fa-edit"></i>
          </button>
        </td>
      </tr>`).join('');
  }

  renderPagination(pages);
}

function statusBadge(status) {
  const map = {
    'In Processing':  'badge-processing',
    'Action Required':'badge-action',
    'Closed':         'badge-closed',
  };
  const cls = map[status] || 'badge-processing';
  return `<span class="status-badge ${cls}">${esc(status || 'In Processing')}</span>`;
}

function renderPagination(pages) {
  const el = document.getElementById('invPagination');
  if (pages <= 1) { el.innerHTML = ''; return; }
  let html = '';
  for (let i = 1; i <= pages; i++) {
    html += `<button class="page-btn ${i === currentInvPage ? 'active' : ''}" onclick="goInvPage(${i})">${i}</button>`;
  }
  el.innerHTML = html;
}

function goInvPage(p) { currentInvPage = p; renderInvoices(); }

// ── Stats bar ───────────────────────────────────────────────────
function renderInvStats() {
  const total    = filteredInvs.length;
  const sumTotal = filteredInvs.reduce((s, i) => s + (parseFloat(i.total) || 0), 0);
  const processing = filteredInvs.filter(i => i.status === 'In Processing').length;
  const action     = filteredInvs.filter(i => i.status === 'Action Required').length;

  document.getElementById('invStats').innerHTML = `
    <div class="stat-card"><div class="stat-value">${total}</div><div class="stat-label">Total Invoices</div></div>
    <div class="stat-card"><div class="stat-value">$${sumTotal.toFixed(2)}</div><div class="stat-label">Total Value</div></div>
    <div class="stat-card"><div class="stat-value">${processing}</div><div class="stat-label">In Processing</div></div>
    <div class="stat-card"><div class="stat-value" style="color:#b45309">${action}</div><div class="stat-label">Action Required</div></div>
  `;
}

// ── Working copy of parsed_data (for Action Required invoices) ──
let currentParsedData = null;
let isActionRequired  = false;

// Multi-page preview state for the detail modal (see invGotoPage).
let _invPageUrls = [];
let _invPageIdx  = 0;
let _invPageIsPdf = false;

// Try to JSON-parse a parsed_data field; returns null if missing or invalid.
function tryParseParsedData(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

// ── Detail modal ────────────────────────────────────────────────
async function openInvDetail(id) {
  const inv = allInvoices.find(i => i.id === id);
  if (!inv) return;

  isActionRequired  = inv.status === 'Action Required';
  currentParsedData = isActionRequired ? tryParseParsedData(inv.parsed_data) : null;

  // Resize modal and line items height for Action Required only
  document.querySelector('#invDetailModal .modal').classList.toggle('modal--action-required', isActionRequired);
  document.getElementById('linesScroll').style.maxHeight = isActionRequired ? '35vh' : '280px';

  // Toggle editable inputs vs read-only labels
  toggleEditableMeta(isActionRequired);

  const isVoided = !!inv.voided_at;

  // Toggle Action Required banner + footer buttons
  const banner          = document.getElementById('actionRequiredBanner');
  const saveChangesBtn  = document.getElementById('saveInvDetailBtn');
  const confirmBtn      = document.getElementById('confirmInvSaveBtn');
  if (isActionRequired) {
    banner.classList.remove('hidden');
    saveChangesBtn.classList.add('hidden');
    confirmBtn.classList.remove('hidden');
    renderParsedWarnings(currentParsedData?.warnings || []);
    updateAddPageUI();
  } else {
    banner.classList.add('hidden');
    saveChangesBtn.classList.remove('hidden');
    confirmBtn.classList.add('hidden');
    document.getElementById('addPageBtn')?.classList.add('hidden');
    const apl = document.getElementById('addedPagesList'); if (apl) apl.innerHTML = '';
  }

  // Voided banner + delete/void/restore button visibility.
  //   voided            → Restore only (read-only, no editing/deleting)
  //   posted (Closed)   → Void (never hard-delete a posted invoice)
  //   draft (other)     → Delete (hard) — nothing derived from it yet
  const voidedBanner = document.getElementById('voidedBanner');
  const deleteBtn    = document.getElementById('deleteInvBtn');
  const voidBtn      = document.getElementById('voidInvBtn');
  const restoreBtn   = document.getElementById('restoreInvBtn');
  const isPosted     = inv.status === 'Closed';
  voidedBanner.classList.toggle('hidden', !isVoided);
  if (isVoided) {
    document.getElementById('voidedBannerReason').textContent =
      `Voided ${fmtDate((inv.voided_at || '').slice(0, 10))}${inv.void_reason ? ' — ' + inv.void_reason : ''}`;
  }
  deleteBtn.classList.toggle('hidden', isVoided || isPosted);
  voidBtn.classList.toggle('hidden', isVoided || !isPosted);
  restoreBtn.classList.toggle('hidden', !isVoided);
  // A voided invoice is read-only — no Save.
  if (isVoided) saveChangesBtn.classList.add('hidden');

  // Prefer parsed_data values when reviewing an Action Required invoice
  const src = (isActionRequired && currentParsedData) ? currentParsedData : inv;

  document.getElementById('detailInvId').value         = id;

  const vendor       = src.vendor          || inv.vendor          || '';
  const invNum       = src.invoice_number  || inv.invoice_number  || '';
  const invDate      = src.invoice_date    || inv.invoice_date    || '';
  const total        = parseFloat(src.total ?? inv.total) || 0;

  document.getElementById('detailVendor').textContent  = vendor || '—';
  document.getElementById('detailNumber').textContent  = invNum || '—';
  document.getElementById('detailDate').textContent    = fmtDate(invDate);
  document.getElementById('detailVendorInput').value   = vendor;
  document.getElementById('detailNumberInput').value   = invNum;
  document.getElementById('detailDateInput').value     = invDate;
  document.getElementById('detailTotalInput').value    = total ? total.toFixed(2) : '';
  // Clear any styling/override left over from a previously blocked close.
  document.getElementById('detailTotalInput').style.borderColor = '';
  document.getElementById('detailTotalInput').style.background  = '';
  const mismatchNote = document.getElementById('totalMismatchNote');
  if (mismatchNote) { mismatchNote.style.display = 'none'; mismatchNote.innerHTML = ''; }

  // Supplier de-dupe: match the parsed vendor against existing suppliers.
  // Only in review mode (the vendor field is editable there).
  const matchBox = document.getElementById('detailVendorMatch');
  matchBox.classList.add('hidden');
  matchBox.innerHTML = '';
  if (isActionRequired && vendor) checkVendorMatch(vendor);

  document.getElementById('detailUpload').textContent  = fmtDate(inv.upload_date);
  currentInvTotal = total;
  document.getElementById('detailTotal').textContent   = total ? '$' + total.toFixed(2) : '—';
  document.getElementById('detailPayment').textContent = inv.payment_account || 'A/P';

  // AI parse cost — recorded from the Anthropic API's `usage` field at parse
  // time; invoices parsed before this tracking existed show '—', not '$0.00'.
  //
  // Operator-only. It is our cost of running the account, not a charge to the
  // customer, and showing it on their own invoice invites the question of why
  // they are paying for it. The block is display:none in the HTML and only ever
  // revealed here, so an unknown session (bootstrap still in flight, or failed)
  // keeps it hidden. Presentation only: `ai_cost` is still returned by
  // /api/tables/invoices, so this hides it from the screen, not from devtools.
  const aiCostBlock = document.getElementById('detailAiCostBlock');
  if (aiCostBlock) aiCostBlock.style.display = window.__isSuperAdmin === true ? '' : 'none';
  const aiCostEl = document.getElementById('detailAiCost');
  const aiCost = parseFloat(inv.ai_cost) || 0;
  if (aiCost > 0) {
    aiCostEl.textContent = '$' + aiCost.toFixed(4);
    const inTok = parseInt(inv.ai_input_tokens, 10) || 0;
    const outTok = parseInt(inv.ai_output_tokens, 10) || 0;
    aiCostEl.title = `${inTok.toLocaleString()} input + ${outTok.toLocaleString()} output tokens`;
  } else {
    aiCostEl.textContent = '—';
    aiCostEl.title = '';
  }

  // Spot-check marker — same operator-only reveal as AI cost, above. Not shown
  // once the invoice is Closed or voided: self-serve means the customer may
  // have already approved it by the time this loads, and the design
  // deliberately has no after-the-fact amendment path, so there's nothing to
  // check off once it's out of his hands.
  const reviewedBlock = document.getElementById('detailReviewedBlock');
  if (reviewedBlock) {
    reviewedBlock.style.display =
      (window.__isSuperAdmin === true && inv.status !== 'Closed' && !inv.voided_at) ? '' : 'none';
  }
  renderReviewedStatus(inv);
  document.getElementById('detailStatus').value        = inv.status          || 'In Processing';
  document.getElementById('detailNotes').value         = inv.notes           || '';

  // Expense-bill classification (utilities/rent/etc.). Only editable while
  // reviewing (Action Required); shown read-only afterwards so the label stays visible.
  const isExpense = inv.invoice_kind === 'expense';
  const expChk = document.getElementById('detailIsExpense');
  const expSel = document.getElementById('detailExpenseCategory');
  if (expChk) { expChk.checked = isExpense; expChk.disabled = !isActionRequired; }
  if (expSel) { expSel.value = inv.expense_category || 'Utilities'; expSel.disabled = !isActionRequired; }
  toggleExpenseMode();

  // Additional cost fields — prefer parsed_data when in Action Required, else stored values
  const taxPstStored    = parseFloat(src.tax_pst    ?? inv.tax_pst)    || 0;
  const taxGstStored    = parseFloat(src.tax_gst    ?? inv.tax_gst)    || 0;
  const deliveryStored  = (parseFloat(src.delivery ?? inv.delivery) || 0) + (parseFloat(src.fuel_surcharge ?? inv.fuel_surcharge) || 0);
  const depositStored   = parseFloat(src.deposit    ?? inv.deposit)    || 0;
  const creditStored    = parseFloat(src.credit     ?? inv.credit)     || 0;
  const otherCostStored = parseFloat(src.other_cost ?? inv.other_cost) || 0;

  let taxPst = taxPstStored, taxGst = taxGstStored, delivery = deliveryStored;
  let deposit = depositStored, credit = creditStored, otherCost = otherCostStored;
  let otherDesc = src.other_desc || inv.other_desc || '';

  // Auto-fill from vendor fee template only when nothing is set
  const allZero = (taxPstStored + taxGstStored + deliveryStored + depositStored + creditStored + otherCostStored) === 0;
  if (allZero && (vendor || inv.vendor)) {
    try {
      const tmpl = await apiGet(`vendor-fee-template?vendor=${encodeURIComponent(vendor || inv.vendor)}`);
      if (tmpl.found && tmpl.template) {
        const t = tmpl.template;
        delivery  = (parseFloat(t.delivery) || 0) + (parseFloat(t.fuel_surcharge) || 0);
        taxGst    = parseFloat(t.tax_gst)   || 0;
        taxPst    = parseFloat(t.tax_pst)   || 0;
        otherCost = parseFloat(t.other_cost) || 0;
        otherDesc = t.other_desc || '';
      }
    } catch (_) { /* non-fatal */ }
  }

  document.getElementById('detailTaxPst').value     = taxPst    || '';
  document.getElementById('detailTaxGst').value     = taxGst    || '';
  document.getElementById('detailDelivery').value   = delivery  || '';
  document.getElementById('detailDeposit').value    = deposit   || '';
  document.getElementById('detailCredit').value     = credit    || '';
  document.getElementById('detailOtherCost').value  = otherCost || '';
  document.getElementById('detailOtherDesc').value  = otherDesc || '';

  // ── Load and render line items ──────────────────────────────
  await loadAndRenderLines(id);

  // ── File viewer ──────────────────────────────────────────────
  const fileKey      = inv.file_key  || '';
  const fileName     = inv.file_name || '';
  const fileUrl      = fileKey ? `/api/files/${fileKey}` : (inv.file_url || '');
  const ext          = fileName.split('.').pop().toLowerCase();
  const isImage      = ['png','jpg','jpeg','webp','gif'].includes(ext);
  const isPdf        = ext === 'pdf';

  // Every uploaded page (multi-page invoices store extra page keys in parsed_data.pages).
  // Falls back to the single primary file for older / single-page invoices.
  const pageKeys     = Array.isArray(currentParsedData?.pages) ? currentParsedData.pages.filter(Boolean) : [];
  const pageUrls     = pageKeys.length ? pageKeys.map(k => `/api/files/${k}`) : (fileUrl ? [fileUrl] : []);
  _invPageUrls  = pageUrls;
  _invPageIdx   = 0;
  _invPageIsPdf = isPdf;
  const pager = pageUrls.length > 1 ? `
      <div style="display:flex;align-items:center;gap:.4rem;margin-left:.5rem">
        <button id="invPagePrev" class="btn btn-secondary btn-sm" onclick="invGotoPage(-1)" disabled><i class="fas fa-chevron-left"></i></button>
        <span id="invPageLabel" style="font-size:.8rem;color:var(--text-muted);min-width:82px;text-align:center">Page 1 of ${pageUrls.length}</span>
        <button id="invPageNext" class="btn btn-secondary btn-sm" onclick="invGotoPage(1)"><i class="fas fa-chevron-right"></i></button>
      </div>` : '';

  const fileBoxTop   = document.getElementById('detailFileBoxTop');
  const fileBox      = document.getElementById('detailFileBox');

  // Review mode: full-width image at top; saved mode: compact card at bottom
  const activeBox    = isActionRequired ? fileBoxTop : fileBox;
  const inactiveBox  = isActionRequired ? fileBox    : fileBoxTop;
  inactiveBox.innerHTML = '';
  inactiveBox.classList.add('hidden');

  if (fileUrl) {
    let preview = '';
    if (isPdf) {
      const h = isActionRequired ? '55vh' : 'min(78vh,1000px)';
      preview = `
        <div style="margin-top:.5rem">
          <iframe id="invPageFrame" src="${esc(fileUrl)}" style="width:100%;height:${h};border:1px solid var(--border);border-radius:8px" title="Invoice PDF"></iframe>
        </div>`;
    } else if (isImage) {
      if (isActionRequired) {
        preview = `
          <div id="invImgZoomWrap" style="flex:1;min-height:0;position:relative;overflow:hidden;background:#f1f5f9">
            <img id="invZoomImg" src="${esc(fileUrl)}" alt="Invoice"
              style="width:100%;height:100%;object-fit:contain;display:block;transform-origin:0 0;user-select:none"
              draggable="false" />
          </div>`;
      } else {
        // Saved mode: render the image at natural container width (sharp) and let
        // it scroll vertically for tall pages. Do NOT use object-fit + a CSS
        // transform to fill width — upscaling a downsampled raster blurs the text.
        preview = `
          <div id="invImgZoomWrap" style="margin-top:.5rem;overflow:auto;max-height:min(82vh,1100px);border-radius:8px;border:1px solid var(--border);position:relative;background:#f1f5f9">
            <img id="invZoomImg" src="${esc(fileUrl)}" alt="Invoice"
              style="width:100%;height:auto;display:block;transform-origin:0 0;user-select:none"
              draggable="false" />
          </div>`;
      }
    }
    const openBtn = `<a href="${esc(fileUrl)}" target="_blank" class="btn btn-primary btn-sm" style="margin-left:auto"><i class="fas fa-external-link-alt"></i> Open</a>`;
    const fileIcon = isPdf ? 'file-pdf' : isImage ? 'file-image' : 'file-alt';
    const fileMeta = `
      <i class="fas fa-${fileIcon}" style="color:var(--primary);font-size:1.1rem"></i>
      <span style="font-weight:600;font-size:.9rem">${esc(inv.invoice_number || 'N/A')}</span>
      ${pager}
      ${openBtn}
      <a href="${esc(fileUrl)}" download="${esc(fileName)}" class="btn btn-secondary btn-sm">
        <i class="fas fa-download"></i> Download
      </a>`;
    if (isActionRequired && isImage) {
      // Flex-column layout so the image wrap fills remaining container height
      activeBox.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%">
          <div style="display:flex;align-items:center;gap:.6rem;padding:.6rem 1.5rem;flex-shrink:0">
            ${fileMeta}
          </div>
          ${preview}
        </div>`;
    } else {
      const hdrPad = isActionRequired ? 'padding:.6rem 1.5rem;' : '';
      activeBox.innerHTML = `
        <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.35rem;${hdrPad}">
          ${fileMeta}
        </div>
        ${preview}`;
    }
    activeBox.classList.remove('hidden');
    if (isImage) _initInvImgZoom();
  } else {
    activeBox.innerHTML = `<span style="color:var(--text-muted);font-size:.85rem"><i class="fas fa-paperclip"></i> No file attached</span>`;
    activeBox.classList.remove('hidden');
  }

  openModal('invDetailModal');

  // Measure the actual rendered header height and apply it as sticky top offset
  if (isActionRequired) {
    requestAnimationFrame(() => {
      const hdr = document.querySelector('#invDetailModal .modal-header');
      const fbt = document.getElementById('detailFileBoxTop');
      if (hdr && fbt && !fbt.classList.contains('hidden')) {
        fbt.style.top = hdr.offsetHeight + 'px';
      }
    });
  }
}

// ── Supplier de-dupe (vendor name matching) ──────────────────────
// Ask the backend whether the parsed vendor matches an existing supplier.
//   auto    → snap the vendor field to the canonical name (with a note)
//   suggest → show "Did you mean X?" with Use / Keep-as-is buttons
// Prevents duplicate suppliers like "Chefs' Warehouse" vs "Chefs Warehouse".
async function checkVendorMatch(name) {
  const box = document.getElementById('detailVendorMatch');
  let res;
  try {
    res = await apiPost('suppliers/match', { name });
  } catch (_) { return; }
  // Bail if the user already edited the field since we asked.
  const input = document.getElementById('detailVendorInput');
  if (!input || input.value.trim() !== name.trim()) return;
  if (!res || !res.match) return;

  if (res.decision === 'auto') {
    input.value = res.match.name;
    box.className = '';
    box.innerHTML = `<span style="color:var(--text-muted)">
      <i class="fas fa-wand-magic-sparkles"></i> Matched existing supplier
      <strong>“${esc(res.match.name)}”</strong>.
      <a href="#" onclick="dismissVendorMatch(this.dataset.name);return false" data-name="${esc(name)}" style="margin-left:.3rem">Undo</a>
    </span>`;
  } else if (res.decision === 'suggest') {
    box.className = '';
    box.innerHTML = `<span style="color:#b45309">
      <i class="fas fa-circle-question"></i> Did you mean existing supplier
      <strong>“${esc(res.match.name)}”</strong>?
      <a href="#" onclick="acceptVendorMatch(this.dataset.name);return false" data-name="${esc(res.match.name)}" style="margin-left:.3rem;font-weight:600">Use it</a>
      <a href="#" onclick="dismissVendorMatch();return false" style="margin-left:.5rem">Keep “${esc(name)}”</a>
    </span>`;
  }
}

// Suggest tier: user accepted the existing supplier name.
function acceptVendorMatch(canonicalName) {
  document.getElementById('detailVendorInput').value = canonicalName;
  const box = document.getElementById('detailVendorMatch');
  box.className = '';
  box.innerHTML = `<span style="color:var(--text-muted)"><i class="fas fa-check"></i> Using <strong>“${esc(canonicalName)}”</strong>.</span>`;
}

// Auto tier: user undid the snap and wants their original name back.
// (Also used to dismiss a suggestion.)
function dismissVendorMatch(originalName) {
  if (originalName != null) document.getElementById('detailVendorInput').value = originalName;
  const box = document.getElementById('detailVendorMatch');
  box.classList.add('hidden');
  box.innerHTML = '';
}

// ── Line items ───────────────────────────────────────────────────
let currentLines = [];  // working copy of lines in the editor

async function loadAndRenderLines(invoiceId) {
  if (isActionRequired && currentParsedData?.items?.length) {
    // Hydrate from parsed_data — line items haven't been written to invoice_lines yet
    currentLines = currentParsedData.items.map(it => {
      const { pack_qty, pack_unit } = parsePackaging(it.pack_size);
      return {
        product_name: it.name      || '',
        vendor_item:  it.original_ocr || it.name || '',
        category:     it.brand     || '',
        item_code:    it.sku       || '',
        pack_qty,
        pack_unit,
        price:        parseFloat(it.unit_price) || 0,
        qty:          parseFloat(it.qty)        || 1,
        line_total:   parseFloat(it.cost)       || 0,
        _original_ocr: it.original_ocr || '',
        _auto_mapped:  !!it.auto_mapped,
      };
    });
  } else {
    try {
      const data = await apiGet(`tables/invoice_lines?invoice_id=${invoiceId}&limit=200`);
      currentLines = (data.data || []).map(l => {
        const { pack_qty, pack_unit } = parsePackaging(l.packaging);
        return { ...l, pack_qty, pack_unit };
      });
    } catch (_) {
      currentLines = [];
    }
  }
  renderLinesTable();
  // autoFill=true: if all extra-cost fields are 0 but there's a gap vs stored total,
  // auto-populate the Delivery field with the difference
  renderCostSummary({ autoFill: true });
  if (isActionRequired) checkProductMatches();
}

// ── Product de-dupe (near-duplicate name matching) ────────────────
// Ask the backend whether any parsed line's product name is a near-duplicate
// of an existing product ("Granulated Sugar" vs an existing "Sugar"), so
// parsing variance doesn't spawn a second product for the same ingredient.
// One batched call for every named line, same idea as checkVendorMatch above.
// Suggest-tier only — see classifyProductNameMatch in src/index.ts for why
// this never auto-links.
async function checkProductMatches() {
  const names = [...new Set(currentLines.map(l => (l.product_name || '').trim()).filter(Boolean))];
  if (!names.length) return;
  let res;
  try {
    res = await apiPost('products/match', { names });
  } catch (_) { return; }
  const results = res?.results || {};
  let changed = false;
  currentLines.forEach(l => {
    const m = results[(l.product_name || '').trim()];
    if (m && m.decision === 'suggest' && m.match && !l._link_product_id) {
      l._nameMatch = m.match;
      changed = true;
    }
  });
  if (changed) renderLinesTable();
}

// Suggest tier: user accepted the existing product — reuses the same
// _link_product_id/_link_product_name fields the manual "link to existing
// product" flow sets, so save/alias-learning need no separate handling.
function acceptProductMatch(idx) {
  const line = currentLines[idx];
  if (!line || !line._nameMatch) return;
  line._link_product_id   = line._nameMatch.id;
  line._link_product_name = line._nameMatch.name;
  const usedName = line._nameMatch.name;
  delete line._nameMatch;
  renderLinesTable();
  showToast(`Line linked to "${usedName}".`, 'success');
}

function dismissProductMatch(idx) {
  const line = currentLines[idx];
  if (!line) return;
  delete line._nameMatch;
  renderLinesTable();
}
window.acceptProductMatch  = acceptProductMatch;
window.dismissProductMatch = dismissProductMatch;

// ── Toggle editable meta inputs vs read-only labels ─────────────
function toggleEditableMeta(editable) {
  const pairs = [
    ['detailVendor', 'detailVendorInput'],
    ['detailNumber', 'detailNumberInput'],
    ['detailDate',   'detailDateInput'],
    ['detailTotal',  'detailTotalInput'],
  ];
  for (const [labelId, inputId] of pairs) {
    const label = document.getElementById(labelId);
    const input = document.getElementById(inputId);
    if (!label || !input) continue;
    if (editable) {
      label.classList.add('hidden');
      input.classList.remove('hidden');
    } else {
      label.classList.remove('hidden');
      input.classList.add('hidden');
    }
  }
}

function renderParsedWarnings(warnings) {
  const container = document.getElementById('parsedWarnings');
  if (!container) return;
  if (!warnings.length) {
    container.innerHTML = '<div style="font-size:.82rem;color:#166534"><i class="fas fa-check"></i> No warnings — parser is confident.</div>';
    return;
  }
  container.innerHTML = warnings.map(w => `
    <div style="display:flex;align-items:flex-start;gap:.45rem;font-size:.82rem;color:#78350f;line-height:1.5">
      <i class="fas fa-exclamation-triangle" style="color:#f59e0b;margin-top:.18rem;flex-shrink:0"></i>
      <span>${esc(w.message || '')}</span>
    </div>
  `).join('');
}

// ── Add missing page ────────────────────────────────────────────
// Button shows only when the parser flagged a missing page. Adds page 2+:
// re-parses it, appends its line items, fills any empty money fields, stores
// the page image, and persists immediately.

function hasMissingPageWarning() {
  return !!(currentParsedData?.warnings || []).some(w => w.id === 'missing_pages');
}

// Show/hide the Add-page button, gate Confirm & Save, and list attached pages.
function updateAddPageUI() {
  const missing      = hasMissingPageWarning();
  const btn          = document.getElementById('addPageBtn');
  const markBtn      = document.getElementById('markCompleteBtn');
  const confirmBtn   = document.getElementById('confirmInvSaveBtn');
  const list         = document.getElementById('addedPagesList');

  if (btn)     btn.classList.toggle('hidden', !missing);
  if (markBtn) markBtn.classList.toggle('hidden', !missing);

  // Block confirming while a page is known to be missing (override clears it).
  if (confirmBtn) {
    confirmBtn.disabled = missing;
    confirmBtn.title = missing
      ? 'A page appears to be missing — add it, or click "It\'s complete" to proceed.'
      : '';
  }

  if (!list) return;
  const pages = Array.isArray(currentParsedData?.pages) ? currentParsedData.pages : [];
  // pages[0] is page 1 (the original upload); show links for page 2+ only
  list.innerHTML = pages.slice(1).map((key, i) =>
    `<a href="/api/files/${esc(key)}" target="_blank" class="btn btn-secondary btn-sm">
       <i class="fas fa-file-image"></i> View page ${i + 2}
     </a>`
  ).join('');
}

// Override: user confirms the invoice is actually complete despite the flag.
// Clears the missing-page warning, persists, and unblocks Confirm & Save.
async function markInvoiceComplete() {
  const id  = document.getElementById('detailInvId').value;
  const inv = allInvoices.find(i => i.id === id);
  if (!id || !inv || !currentParsedData) return;
  currentParsedData.warnings = (currentParsedData.warnings || []).filter(w => w.id !== 'missing_pages');
  try {
    const patch = { parsed_data: JSON.stringify(currentParsedData) };
    await apiPatch(`tables/${INV_LIST_TABLE}/${id}`, patch);
    Object.assign(inv, patch);
  } catch (err) {
    showToast('Could not update invoice: ' + err.message, 'error');
    return;
  }
  renderParsedWarnings(currentParsedData.warnings);
  updateAddPageUI();
  showToast('Marked complete — you can now Confirm & Save.', 'success');
}

// Fill a money input only when it's currently empty/zero (per user's choice).
function _fillMoneyIfEmpty(inputId, value) {
  const el = document.getElementById(inputId);
  if (!el) return;
  const cur = parseFloat(el.value) || 0;
  const v   = parseFloat(value)   || 0;
  if (cur === 0 && v > 0) el.value = v.toFixed(2);
}

async function handleAddPageFile(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // allow re-selecting the same file later
  if (!file) return;

  const id  = document.getElementById('detailInvId').value;
  const inv = allInvoices.find(i => i.id === id);
  if (!id || !inv || !isActionRequired || !currentParsedData) return;

  const btn = document.getElementById('addPageBtn');
  const prevHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Reading page…'; }

  try {
    // 0. Same quality gate + downscale the upload page applies (shared
    //    image-preproc.js). Without this a page added here could be blurrier or
    //    darker than one the upload page would have rejected, and full-size
    //    phone photos were being sent over the wire for no accuracy gain.
    //    PDFs skip it — the pipeline is raster-only.
    let pageFile = file;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf && typeof preprocessImage === 'function') {
      if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking quality…';
      const pre = await preprocessImage(file);
      if (pre.rejected) {
        // Reject before spending an API call on an unreadable page.
        showToast('Page not added — ' + pre.reason, 'error');
        return;
      }
      pageFile = pre.file;
      if (pre.warnings.length) console.info('Add-page preprocessing:', pre.warnings.join('; '));
      if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Reading page…';
    }

    // 1. Store the page image in R2 (non-fatal if it fails — parsing still runs)
    //    Stores the preprocessed file so R2 matches what Claude actually read.
    let pageKey = '';
    try { pageKey = (await apiUploadFile(pageFile)).key || ''; }
    catch (upErr) { console.warn('Extra-page upload failed (continuing):', upErr.message); }

    // 2. Parse the new page with Claude
    const fd = new FormData();
    fd.append('file', pageFile);
    const resp = await fetch('/api/ai/parse-invoice', { method: 'POST', body: fd });
    const data = await resp.json();
    if (!resp.ok || data.error) throw new Error(data.error || `Server error ${resp.status}`);
    const res = data.result || {};
    const newItems = Array.isArray(res.items) ? res.items : [];

    // 3. Append the new page's line items to parsed_data (same shape as upload)
    currentParsedData.items = (currentParsedData.items || []).concat(
      newItems.map(it => ({
        name:         it.name        || '',
        brand:        it.brand       || '',
        sku:          it.sku         || '',
        pack_size:    it.pack_size   || '',
        qty:          parseFloat(it.qty)        || 1,
        unit_price:   parseFloat(it.unit_price) || 0,
        cost:         parseFloat(it.cost)       || 0,
        invoice_ref:  '',
        original_ocr: it.original_ocr || '',
        auto_mapped:  false,
      }))
    );

    // 4. Fill money fields only if currently empty (page 2 often carries the totals)
    _fillMoneyIfEmpty('detailTotalInput', res.total);
    _fillMoneyIfEmpty('detailTaxGst',     res.tax_gst);
    _fillMoneyIfEmpty('detailTaxPst',     res.tax_pst);
    _fillMoneyIfEmpty('detailDelivery',   (parseFloat(res.delivery) || 0) + (parseFloat(res.fuel_surcharge) || 0));
    _fillMoneyIfEmpty('detailDeposit',    res.deposit);
    _fillMoneyIfEmpty('detailCredit',     res.credit);
    _fillMoneyIfEmpty('detailOtherCost',  res.other_cost);
    const totalNow = parseFloat(document.getElementById('detailTotalInput').value) || 0;
    if (totalNow > 0) currentInvTotal = totalNow;

    // 5. Track pages: pages[0] = original upload, then each added page
    if (!Array.isArray(currentParsedData.pages)) {
      currentParsedData.pages = inv.file_key ? [inv.file_key] : [];
    }
    if (pageKey) currentParsedData.pages.push(pageKey);
    const uploadedCount = Math.max(currentParsedData.pages.length, 1);

    // 6. Re-evaluate the missing-page warning against this page's page_total
    const pageTotal = parseInt(res.page_total, 10) || 0;
    currentParsedData.warnings = (currentParsedData.warnings || []).filter(w => w.id !== 'missing_pages');
    if (pageTotal > uploadedCount) {
      currentParsedData.warnings.push({
        id: 'missing_pages', severity: 'warning',
        message: `Invoice shows ${pageTotal} pages but only ${uploadedCount} uploaded — still missing a page.`,
      });
    }

    // 7. Mirror the merged money fields into parsed_data, then persist immediately
    currentParsedData.total      = currentInvTotal;
    currentParsedData.tax_gst    = parseFloat(document.getElementById('detailTaxGst').value)    || 0;
    currentParsedData.tax_pst    = parseFloat(document.getElementById('detailTaxPst').value)    || 0;
    currentParsedData.delivery   = parseFloat(document.getElementById('detailDelivery').value)  || 0;
    currentParsedData.deposit    = parseFloat(document.getElementById('detailDeposit').value)   || 0;
    currentParsedData.credit     = parseFloat(document.getElementById('detailCredit').value)    || 0;
    currentParsedData.other_cost = parseFloat(document.getElementById('detailOtherCost').value) || 0;

    const patch = {
      parsed_data: JSON.stringify(currentParsedData),
      total:       currentInvTotal,
      tax_gst:     currentParsedData.tax_gst,
      tax_pst:     currentParsedData.tax_pst,
      delivery:    currentParsedData.delivery,
      deposit:     currentParsedData.deposit,
      credit:      currentParsedData.credit,
      other_cost:  currentParsedData.other_cost,
    };
    // This page's parse call added its own AI cost on top of whatever the
    // invoice already had recorded (initial upload + any earlier added pages).
    if (data.usage) {
      patch.ai_input_tokens  = (parseInt(inv.ai_input_tokens, 10)   || 0) + (data.usage.input_tokens  || 0);
      patch.ai_output_tokens = (parseInt(inv.ai_output_tokens, 10)  || 0) + (data.usage.output_tokens || 0);
      patch.ai_cost          = (parseFloat(inv.ai_cost)             || 0) + (data.usage.cost          || 0);
    }
    await apiPatch(`tables/${INV_LIST_TABLE}/${id}`, patch);
    // Keep local cache in sync so reopening reflects the added page
    Object.assign(inv, patch);

    // 8. Re-render the review UI
    await loadAndRenderLines(id);
    renderParsedWarnings(currentParsedData.warnings);
    updateAddPageUI();

    showToast(`Page added — ${newItems.length} line item${newItems.length === 1 ? '' : 's'} imported. Review, then Confirm & Save.`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Could not add page: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = prevHtml; }
  }
}

// Paint the rows that failed the confirm-time validation: tint the row and
// red-outline the specific empty fields, then scroll the first one into view.
// Highlights clear naturally on the next render, or when the field is edited.
function highlightInvalidLines(problems) {
  const tbody = document.getElementById('linesBody');
  if (!tbody) return;
  tbody.querySelectorAll('tr').forEach(r => {
    r.style.background = '';
    r.querySelectorAll('.line-input').forEach(el => { el.style.borderColor = ''; el.style.background = ''; });
  });
  problems.forEach(({ i, missing }) => {
    const row = tbody.querySelector(`tr[data-idx="${i}"]`);
    if (!row) return;
    row.style.background = '#fff1f2';
    const mark = sel => { const el = row.querySelector(sel); if (el) { el.style.borderColor = '#ef4444'; el.style.background = '#fff5f5'; } };
    if (missing.includes('unit of measure')) mark('.line-unit-sel');
    if (missing.includes('pack quantity'))   mark('[data-f="pack_qty"]');
    if (missing.includes('order quantity'))  mark('[data-f="qty"]');
    if (missing.includes('price'))           mark('[data-f="price"]');
  });
  const firstRow = tbody.querySelector(`tr[data-idx="${problems[0].i}"]`);
  if (firstRow) firstRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Lines missing required data for a costed purchase. A blank unit is the
// critical one (it becomes "each" on the backend and corrupts cost_per_unit),
// but qty/price matter too. Blank rows (no product name) are ignored — they get
// dropped on save. Used by BOTH save paths so neither can persist a bad line.
function collectLineProblems() {
  const problems = [];
  currentLines.forEach((l, i) => {
    if (!(l.product_name || '').trim()) return;
    const missing = [];
    if (!isKnownUnit(l.pack_unit))     missing.push('unit of measure');
    if (!(parseFloat(l.pack_qty) > 0)) missing.push('pack quantity');
    if (!(parseFloat(l.qty)      > 0)) missing.push('order quantity');
    if (!(parseFloat(l.price)    > 0)) missing.push('price');
    if (missing.length) problems.push({ i, name: (l.product_name || '').trim(), missing });
  });
  return problems;
}

// Block a save when lines are incomplete: highlight the rows and explain what's
// missing. Returns true if it blocked (caller should re-enable its button + bail).
function blockOnInvalidLines(problems) {
  if (!problems.length) return false;
  highlightInvalidLines(problems);
  const first = problems[0];
  const more  = problems.length > 1
    ? ` (+${problems.length - 1} more row${problems.length > 2 ? 's' : ''})`
    : '';
  showToast(`"${first.name}" is missing: ${first.missing.join(', ')}${more}. Fix the highlighted rows before saving.`, 'error');
  return true;
}

// ── Invoice total reconciliation ───────────────────────────────
// Closing an invoice whose lines don't add up to the stated total silently
// mis-states spend, P&L and per-unit costs. Both close paths must agree, so the
// arithmetic lives here once: lines + extra costs − credit vs the typed total.
const TOTAL_TOLERANCE = 0.02;   // cents of rounding slack

function computeInvoiceTotals() {
  const num = id => parseFloat(document.getElementById(id)?.value) || 0;
  const subtotal = currentLines.reduce((s, l) => s + (parseFloat(l.price) || 0) * (parseFloat(l.qty) || 0), 0);
  const computed = subtotal
    + num('detailTaxPst') + num('detailTaxGst') + num('detailDelivery')
    + num('detailDeposit') + num('detailOtherCost') - num('detailCredit');
  const statedRaw = (document.getElementById('detailTotalInput')?.value || '').trim();
  const stated    = parseFloat(statedRaw) || 0;
  return {
    subtotal,
    computed: Math.round(computed * 100) / 100,
    stated:   Math.round(stated * 100) / 100,
    hasStated: statedRaw !== '' && stated > 0,
    diff:     Math.round((stated - computed) * 100) / 100,
  };
}

// Returns null when the totals reconcile (or the user ticked the override);
// otherwise a reason describing what to fix. Used by BOTH close paths.
function checkInvoiceTotal() {
  const t = computeInvoiceTotals();
  if (!t.hasStated) return { kind: 'missing', msg: 'Enter the invoice total before closing this invoice.' };
  if (Math.abs(t.diff) <= TOTAL_TOLERANCE) return null;
  if (document.getElementById('totalMismatchOverride')?.checked) return null;   // explicit override
  const over = t.diff < 0;   // computed exceeds the stated total
  return {
    kind: 'mismatch',
    msg: `Lines + costs come to $${t.computed.toFixed(2)} but the invoice total is $${t.stated.toFixed(2)} `
       + `(${over ? 'over' : 'short'} by $${Math.abs(t.diff).toFixed(2)}). `
       + `Fix a line, adjust the extra costs, or tick "Close anyway".`,
  };
}

// Block a close when the totals don't reconcile. Returns true if it blocked.
function blockOnTotalMismatch() {
  const problem = checkInvoiceTotal();
  if (!problem) return false;
  const el = document.getElementById('detailTotalInput');
  if (el) {
    el.style.borderColor = '#ef4444';
    el.style.background  = '#fff5f5';
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  renderTotalMismatchNote();
  showToast(problem.msg, 'error');
  return true;
}

// Live pre-flight note under the line items: shows the discrepancy as it changes
// and carries the "Close anyway" override, so the block is never a surprise at
// click time. The override resets whenever an invoice is opened.
function renderTotalMismatchNote() {
  const el = document.getElementById('totalMismatchNote');
  if (!el) return;
  const t = computeInvoiceTotals();
  const off = t.hasStated && Math.abs(t.diff) > TOTAL_TOLERANCE;
  if (!off) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const over = t.diff < 0;
  const checked = document.getElementById('totalMismatchOverride')?.checked ? 'checked' : '';
  el.style.display = 'block';
  el.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:.5rem;flex-wrap:wrap">
      <i class="fas fa-triangle-exclamation" style="margin-top:.15rem"></i>
      <div style="flex:1;min-width:220px">
        <strong>Totals don't match.</strong>
        Lines + costs come to <strong>$${t.computed.toFixed(2)}</strong>,
        but the invoice total is <strong>$${t.stated.toFixed(2)}</strong>
        — ${over ? 'over' : 'short'} by <strong>$${Math.abs(t.diff).toFixed(2)}</strong>.
        <label style="display:flex;align-items:center;gap:.4rem;margin-top:.4rem;font-weight:600;cursor:pointer">
          <input type="checkbox" id="totalMismatchOverride" ${checked}
                 onchange="renderTotalMismatchNote()" />
          Close anyway — I've checked this invoice
        </label>
      </div>
    </div>`;
}
window.renderTotalMismatchNote = renderTotalMismatchNote;

function renderLinesTable() {
  const tbody = document.getElementById('linesBody');
  if (!currentLines.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row" style="font-size:.82rem">
      <i class="fas fa-info-circle"></i> No line items yet — add rows or re-upload invoice with AI extraction.
    </td></tr>`;
    document.getElementById('linesSubtotal').textContent = '';
    return;
  }

  tbody.innerHTML = currentLines.map((l, i) => `
    <tr data-idx="${i}">
      <td>
        <div style="display:flex;align-items:center;gap:.2rem">
          <input type="text" class="line-input" data-idx="${i}" data-f="product_name" value="${esc(l.product_name||'')}" title="${esc(l.product_name||'')}" placeholder="Product" style="width:110px"/>
          <button class="btn btn-icon" style="padding:.2rem .35rem;font-size:.7rem;background:#e0e7ff;color:#4338ca"
                  onclick="openLinkProductModal(${i})" title="This is one of my existing products">
            <i class="fas fa-link"></i>
          </button>
        </div>
        ${l._link_product_id ? `
          <div style="font-size:.68rem;color:#4338ca;margin-top:.15rem;display:flex;align-items:center;gap:.25rem;white-space:nowrap">
            <i class="fas fa-arrow-turn-up" style="transform:rotate(90deg)"></i>
            <span title="Files under this product; the vendor's wording is remembered">${esc(l._link_product_name || '')}</span>
            <button onclick="unlinkProduct(${i})" title="Undo link"
                    style="border:none;background:none;color:#94a3b8;cursor:pointer;padding:0 .1rem">
              <i class="fas fa-times"></i>
            </button>
          </div>` : (l._nameMatch ? `
          <div style="font-size:.68rem;color:#b45309;margin-top:.15rem;display:flex;align-items:center;gap:.25rem;flex-wrap:wrap">
            <i class="fas fa-circle-question"></i>
            <span>Same as <strong>${esc(l._nameMatch.name)}</strong>?</span>
            <a href="#" onclick="acceptProductMatch(${i});return false" style="font-weight:600">Use it</a>
            <a href="#" onclick="dismissProductMatch(${i});return false">No</a>
          </div>` : '')}
      </td>
      <td><input type="text"   class="line-input" data-idx="${i}" data-f="vendor_item"  value="${esc(l.vendor_item ||'')}" placeholder="Vendor item" style="width:110px"/></td>
      <td><input type="text"   class="line-input" data-idx="${i}" data-f="item_code"    value="${esc(l.item_code   ||'')}" placeholder="Code" style="width:72px"/></td>
      <td style="white-space:nowrap">
        <input type="number" class="line-input" data-idx="${i}" data-f="pack_qty" value="${esc(l.pack_qty||'')}" placeholder="Qty" step="any" style="width:52px"/>
        <select class="line-input line-unit-sel" data-idx="${i}" data-f="pack_unit" style="width:72px;padding:.25rem .3rem"></select>
      </td>
      <td><input type="number" class="line-input line-num" data-idx="${i}" data-f="qty"   value="${l.qty  ||''}" placeholder="1" step="any"  style="width:58px;text-align:right"/></td>
      <td><input type="number" class="line-input line-num" data-idx="${i}" data-f="price" value="${l.price||''}" placeholder="0.00" step="0.01" style="width:80px;text-align:right"/></td>
      <td style="text-align:right;font-weight:600;font-size:.85rem;white-space:nowrap">
        $${((parseFloat(l.price)||0) * (parseFloat(l.qty)||0)).toFixed(2)}
      </td>
      <td>
        <button class="btn btn-danger btn-icon" style="padding:.2rem .4rem;font-size:.75rem" onclick="removeLine(${i})" title="Remove">
          <i class="fas fa-times"></i>
        </button>
      </td>
    </tr>`).join('');

  // Populate unit dropdowns
  tbody.querySelectorAll('.line-unit-sel').forEach(sel => {
    const idx = parseInt(sel.dataset.idx);
    populateInvoiceUnitDropdown(sel, currentLines[idx].pack_unit || '');
  });

  // Review mode (Action Required): pre-flag any named row whose unit didn't
  // resolve to a known unit, so a missing unit is obvious on open — not only
  // after clicking Confirm. sel.value is '' when nothing matched.
  if (currentParsedData) {
    tbody.querySelectorAll('.line-unit-sel').forEach(sel => {
      const idx = parseInt(sel.dataset.idx);
      if ((currentLines[idx].product_name || '').trim() && !sel.value) {
        sel.style.borderColor = '#f59e0b';
        sel.style.background  = '#fffbeb';
        sel.title = 'Set a unit of measure';
      }
    });
  }

  // Attach input/change listeners for live line-total + subtotal update
  tbody.querySelectorAll('.line-input').forEach(inp => {
    const eventType = inp.tagName === 'SELECT' ? 'change' : 'input';
    inp.addEventListener(eventType, e => {
      const idx = parseInt(e.target.dataset.idx);
      const f   = e.target.dataset.f;
      if (f === 'pack_unit' && e.target.value === '__manage_units__') {
        e.target.value = currentLines[idx].pack_unit || '';
        openManageUnitsModal();
        return;
      }
      currentLines[idx][f] = e.target.value;
      // Clear any validation/flag styling on the field now that it's been touched
      e.target.style.borderColor = '';
      e.target.style.background  = '';
      // A suggestion was classified against the old text — once the name is
      // edited by hand it no longer applies, so drop it without a full
      // re-render (which would steal focus mid-keystroke).
      if (f === 'product_name' && currentLines[idx]._nameMatch) {
        delete currentLines[idx]._nameMatch;
        const row = tbody.querySelector(`tr[data-idx="${idx}"]`);
        row?.querySelector('td .fa-circle-question')?.closest('div')?.remove();
      }
      // Refresh line total cell (only price/qty affect it)
      const row   = tbody.querySelector(`tr[data-idx="${idx}"]`);
      const price = parseFloat(currentLines[idx].price) || 0;
      const qty   = parseFloat(currentLines[idx].qty)   || 0;
      if (row) row.querySelectorAll('td')[6].textContent = '$' + (price * qty).toFixed(2);
      renderCostSummary();
    });
  });

  // Subtotal
  const subtotal = currentLines.reduce((s, l) => s + (parseFloat(l.price)||0) * (parseFloat(l.qty)||0), 0);
  document.getElementById('linesSubtotal').innerHTML =
    `<span style="color:var(--text-muted)">Items subtotal:</span> <strong>$${subtotal.toFixed(2)}</strong>`;
}

// ── Link an invoice line to an existing product ────────────────
// The vendor's wording ("Grape Tomatoes") often isn't what you call the item
// ("Small Tomatoes"), so import would create a duplicate. Linking files this
// purchase under the existing product AND registers the vendor's wording as a
// supplier-scoped alias, so the next invoice routes itself.
// The alias is written after approval (see approveInvoice), because it needs
// the supplier id that the bulk import resolves or creates.

let _linkProducts   = [];    // generic_products, loaded lazily
let _linkChosenId   = null;
let _linkChosenName = '';

async function openLinkProductModal(idx) {
  const line = currentLines[idx];
  if (!line) return;

  document.getElementById('linkLineIdx').value       = String(idx);
  document.getElementById('linkLineName').textContent = line.product_name || '(unnamed line)';
  document.getElementById('linkVendorName').textContent =
    (document.getElementById('detailVendorInput')?.value || '').trim() || 'this vendor';

  _linkChosenId = null; _linkChosenName = '';
  document.getElementById('linkSearch').value       = '';
  document.getElementById('linkDropdown').style.display = 'none';
  document.getElementById('linkChosen').style.display   = 'none';
  document.getElementById('confirmLinkBtn').disabled    = true;

  if (!_linkProducts.length) {
    try {
      const d = await apiGet('tables/generic_products?page=1&limit=1000');
      // Archived products stay out of the picker — linking to one would file
      // purchases against an item that no longer appears in any list.
      _linkProducts = (d.data || []).filter(p => !p.deleted_at);
    } catch (_) { _linkProducts = []; }
  }

  openModal('linkProductModal');
  document.getElementById('linkSearch').focus();
}

function onLinkSearchInput() {
  const q  = (document.getElementById('linkSearch').value || '').trim().toLowerCase();
  const dd = document.getElementById('linkDropdown');
  _linkChosenId = null; _linkChosenName = '';
  document.getElementById('linkChosen').style.display = 'none';
  document.getElementById('confirmLinkBtn').disabled  = true;

  if (!q) { dd.style.display = 'none'; return; }

  const hits = _linkProducts
    .filter(p => (p.name || '').toLowerCase().includes(q))
    .slice(0, 20);

  if (!hits.length) {
    dd.innerHTML = `<div style="padding:.5rem .75rem;font-size:.85rem;color:var(--text-muted)">No matching products.</div>`;
    dd.style.display = '';
    return;
  }

  dd.innerHTML = hits.map(p => `
    <div style="padding:.45rem .75rem;cursor:pointer;font-size:.88rem;border-bottom:1px solid var(--border)"
         onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='#fff'"
         onclick="selectLinkProduct('${esc(p.id)}')">
      <strong>${esc(p.name)}</strong>
      <span style="color:var(--text-muted);font-size:.78rem"> · ${esc(p.category || 'Uncategorised')}</span>
    </div>`).join('');
  dd.style.display = '';
}

function selectLinkProduct(id) {
  const p = _linkProducts.find(x => x.id === id);
  if (!p) return;
  _linkChosenId   = p.id;
  _linkChosenName = p.name;
  document.getElementById('linkDropdown').style.display = 'none';
  document.getElementById('linkSearch').value = p.name;
  const chosen = document.getElementById('linkChosen');
  chosen.innerHTML = `<i class="fas fa-check"></i> Will file under <strong>${esc(p.name)}</strong>`;
  chosen.style.display = '';
  document.getElementById('confirmLinkBtn').disabled = false;
}

function confirmLinkProduct() {
  const idx  = parseInt(document.getElementById('linkLineIdx').value);
  const line = currentLines[idx];
  if (!line || !_linkChosenId) return;

  line._link_product_id   = _linkChosenId;
  line._link_product_name = _linkChosenName;
  closeModal('linkProductModal');
  renderLinesTable();
  showToast(`Line linked to "${_linkChosenName}".`, 'success');
}

function unlinkProduct(idx) {
  const line = currentLines[idx];
  if (!line) return;
  delete line._link_product_id;
  delete line._link_product_name;
  renderLinesTable();
}

window.openLinkProductModal = openLinkProductModal;
window.onLinkSearchInput    = onLinkSearchInput;
window.selectLinkProduct    = selectLinkProduct;
window.confirmLinkProduct   = confirmLinkProduct;
window.unlinkProduct        = unlinkProduct;

function addLineRow() {
  currentLines.push({ product_name:'', vendor_item:'', category:'', item_code:'', pack_qty:'', pack_unit:'', price:'', qty:'' });
  renderLinesTable();
  // Scroll to bottom of table
  const scroll = document.querySelector('#linesTable').closest('.table-scroll');
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
}

function removeLine(idx) {
  currentLines.splice(idx, 1);
  renderLinesTable();
  renderCostSummary();
}

function renderCostSummary({ autoFill = false } = {}) {
  const subtotal  = currentLines.reduce((s, l) => s + (parseFloat(l.price)||0) * (parseFloat(l.qty)||0), 0);
  const taxPstEl  = document.getElementById('detailTaxPst');
  const taxGstEl  = document.getElementById('detailTaxGst');
  const delivEl   = document.getElementById('detailDelivery');
  const depositEl = document.getElementById('detailDeposit');
  const creditEl  = document.getElementById('detailCredit');
  const otherEl   = document.getElementById('detailOtherCost');

  let taxPst   = parseFloat(taxPstEl?.value)   || 0;
  let taxGst   = parseFloat(taxGstEl?.value)   || 0;
  let delivery = parseFloat(delivEl?.value)    || 0;
  let deposit  = parseFloat(depositEl?.value)  || 0;
  let credit   = parseFloat(creditEl?.value)   || 0;
  let other    = parseFloat(otherEl?.value)    || 0;

  // Use the stored DB total as authoritative; fall back to computed if not set
  const displayTotal = currentInvTotal > 0 ? currentInvTotal : (subtotal + taxPst + taxGst + delivery + deposit + other - credit);

  // Auto-fill: if all extra-cost fields are zero but there is a gap,
  // put the difference into Delivery (most common cause on food invoices)
  const gap = Math.round((displayTotal - subtotal - taxPst - taxGst - delivery - deposit - other + credit) * 100) / 100;
  if (autoFill && gap >= 0.01 && taxPst === 0 && taxGst === 0 && delivery === 0 && deposit === 0 && other === 0 && credit === 0) {
    if (delivEl) { delivEl.value = gap.toFixed(2); delivery = gap; }
  }

  const computed = subtotal + taxPst + taxGst + delivery + deposit + other - credit;
  const diff     = Math.round((displayTotal - computed) * 100) / 100;

  const el = document.getElementById('detailCostSummary');
  if (!el) return;
  const row = (label, val, cls='') =>
    `<span style="white-space:nowrap">${label}: <strong class="${cls}">$${Math.abs(val).toFixed(2)}</strong></span>`;
  const parts = [`<span style="white-space:nowrap">Items: <strong>$${subtotal.toFixed(2)}</strong></span>`];
  if (taxPst)   parts.push(row('PST', taxPst));
  if (taxGst)   parts.push(row('GST/HST', taxGst));
  if (delivery) parts.push(row('Delivery + Fuel Surcharge', delivery));
  if (deposit)  parts.push(row('Deposits', deposit));
  if (credit)   parts.push(`<span style="white-space:nowrap">Credit: <strong style="color:#16a34a">−$${credit.toFixed(2)}</strong></span>`);
  if (other)    parts.push(row('Other', other));
  // Show warning only if gap remains after auto-fill
  if (Math.abs(diff) >= 0.01) {
    parts.push(`<span style="white-space:nowrap;color:#b45309" title="Difference between invoice total and itemised costs — fill in Delivery / Tax / Other fields above">
      Unaccounted: <strong style="color:#b45309">$${diff.toFixed(2)}</strong>
      <i class="fas fa-exclamation-triangle" style="margin-left:.25rem;font-size:.75rem"></i>
    </span>`);
  }
  parts.push(`<span style="white-space:nowrap;margin-left:auto;font-size:.9rem">
    Invoice Total: <strong style="color:var(--primary);font-size:1rem">$${displayTotal.toFixed(2)}</strong>
  </span>`);
  el.style.display = 'flex';
  el.innerHTML = parts.join('');

  // Keep the blocking totals warning in step with every edit.
  renderTotalMismatchNote();
}

async function saveInvDetail() {
  const id     = document.getElementById('detailInvId').value;
  const status = document.getElementById('detailStatus').value;
  const notes  = document.getElementById('detailNotes').value.trim();
  const btn    = document.getElementById('saveInvDetailBtn');

  // Same completeness guard as Confirm & Save — editing a posted invoice must
  // not persist a line with a missing unit/qty/price either. Blocks before any
  // write, highlights the offending rows.
  if (blockOnInvalidLines(collectLineProblems())) return;
  // Totals must reconcile before an invoice is closed (Closed = counted in P&L).
  // Editing a still-open invoice stays unblocked so work can be saved midway.
  if (status === 'Closed' && blockOnTotalMismatch()) return;

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

  try {
    const taxPst    = parseFloat(document.getElementById('detailTaxPst').value)    || 0;
    const taxGst    = parseFloat(document.getElementById('detailTaxGst').value)    || 0;
    const delivery  = parseFloat(document.getElementById('detailDelivery').value)  || 0;
    const deposit   = parseFloat(document.getElementById('detailDeposit').value)   || 0;
    const credit    = parseFloat(document.getElementById('detailCredit').value)    || 0;
    const otherCost = parseFloat(document.getElementById('detailOtherCost').value) || 0;
    const otherDesc = document.getElementById('detailOtherDesc').value.trim();
    const subtotal  = currentLines.reduce((s, l) => s + (parseFloat(l.price)||0) * (parseFloat(l.qty)||0), 0);
    const newTotal  = subtotal + taxPst + taxGst + delivery + deposit + otherCost - credit;
    // The typed invoice total is the source of truth — it's what the paper says,
    // and the close guard above has already reconciled it against the lines (or
    // the user knowingly overrode it). Falls back to the computed figure only
    // when no total was entered (possible on a still-open invoice).
    const typedTotal = parseFloat(document.getElementById('detailTotalInput').value) || 0;
    const savedTotal = typedTotal > 0 ? typedTotal : newTotal;

    // 1. Patch status, notes, extra cost fields AND recalculated total on invoice
    await apiPatch(`tables/${INV_LIST_TABLE}/${id}`, {
      status, notes,
      tax_pst:        taxPst,
      tax_gst:        taxGst,
      delivery:       delivery,
      fuel_surcharge: 0,
      deposit:        deposit,
      credit:         credit,
      other_cost:     otherCost,
      other_desc:     otherDesc,
      total:          savedTotal,
    });

    // 2. Bulk-replace line items
    await apiPost(`invoice-lines/${id}/replace`, {
      lines: currentLines.map(l => {
        const qty_str  = (l.pack_qty  || '').toString().trim();
        const unit_str = (l.pack_unit || '').trim();
        const packaging = qty_str && unit_str ? `${qty_str} ${unit_str}` : qty_str || unit_str;
        return {
          product_name: l.product_name || '',
          vendor_item:  l.vendor_item  || '',
          category:     l.category     || '',
          item_code:    l.item_code    || '',
          packaging,
          price:        parseFloat(l.price) || 0,
          qty:          parseFloat(l.qty)   || 0,
          line_total:   (parseFloat(l.price)||0) * (parseFloat(l.qty)||0),
        };
      }),
      tax_pst:        taxPst,
      tax_gst:        taxGst,
      delivery:       delivery,
      fuel_surcharge: 0,
      deposit:        deposit,
      credit:         credit,
      other_cost:     otherCost,
      other_desc:     otherDesc,
    });

    // 3. Update local cache
    const inv = allInvoices.find(i => i.id === id);
    if (inv) {
      inv.status         = status;
      inv.notes          = notes;
      inv.total          = savedTotal;
      inv.tax_pst        = taxPst;
      inv.tax_gst        = taxGst;
      inv.delivery       = delivery;
      inv.fuel_surcharge = 0;
      inv.deposit        = deposit;
      inv.credit         = credit;
      inv.other_cost     = otherCost;
      inv.other_desc     = otherDesc;
      currentInvTotal    = savedTotal;
    }

    // 4. Remember fee structure for this vendor (any non-zero fee field → save template)
    const vendorName = document.getElementById('detailVendor')?.textContent?.trim();
    const hasAnyFee  = delivery > 0 || taxGst > 0 || taxPst > 0 || otherCost > 0;
    if (vendorName && vendorName !== '—' && hasAnyFee) {
      try {
        await apiPost('vendor-fee-template', {
          vendor_name: vendorName,
          delivery:    delivery,
          tax_gst:     taxGst,
          tax_pst:     taxPst,
          other_cost:  otherCost,
          other_desc:  otherDesc,
        });
      } catch (_) { /* non-fatal — don't block the save */ }
    }

    showToast('Invoice saved!', 'success');
    _cleanInvImgZoom();
    closeModal('invDetailModal');
    applyFilters();
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
  }
}

async function deleteInvoice() {
  const id = document.getElementById('detailInvId').value;
  const inv = allInvoices.find(i => i.id === id);
  if (!confirm(`Delete invoice "${inv?.invoice_number || id}"? This cannot be undone.`)) return;
  try {
    await apiDelete(`tables/${INV_LIST_TABLE}/${id}`);
    allInvoices = allInvoices.filter(i => i.id !== id);
    showToast('Invoice deleted.', 'warning');
    _cleanInvImgZoom();
    closeModal('invDetailModal');
    populateVendorFilter();
    applyFilters();
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

// Void a posted invoice: kept + restorable, but out of the active list and P&L.
async function voidInvoice() {
  const id  = document.getElementById('detailInvId').value;
  const inv = allInvoices.find(i => i.id === id);
  if (!inv) return;
  const reason = prompt(
    `Void invoice "${inv.invoice_number || id}"?\n\nIt will be removed from your P&L and the active list, but kept and restorable.\n\nReason (optional):`,
    ''
  );
  if (reason === null) return;  // cancelled
  try {
    const res = await apiPost(`invoices/${id}/void`, { reason: reason.trim() });
    inv.voided_at = res.voided_at || new Date().toISOString();
    inv.void_reason = res.void_reason || reason.trim();
    showToast('Invoice voided — excluded from P&L, restorable anytime.', 'warning');
    _cleanInvImgZoom();
    closeModal('invDetailModal');
    applyFilters();
  } catch (e) {
    showToast('Void failed: ' + e.message, 'error');
  }
}

// Restore a voided invoice: back into the active list and P&L.
async function restoreInvoice() {
  const id  = document.getElementById('detailInvId').value;
  const inv = allInvoices.find(i => i.id === id);
  if (!inv) return;
  if (!confirm(`Restore invoice "${inv.invoice_number || id}" back into your active list and P&L?`)) return;
  try {
    await apiPost(`invoices/${id}/restore`, {});
    inv.voided_at = null;
    inv.void_reason = '';
    showToast('Invoice restored.', 'success');
    _cleanInvImgZoom();
    closeModal('invDetailModal');
    applyFilters();
  } catch (e) {
    showToast('Restore failed: ' + e.message, 'error');
  }
}

// ── Operator spot-check marker ──────────────────────────────────
// Purely a note to self: does not gate the customer, does not change status,
// and nothing downstream reads it. Server-side it is POST
// /api/admin/invoices/:id/reviewed, super-admin only — never the generic
// PATCH, which strips reviewed_by/reviewed_at so a customer can't fake it.
function renderReviewedStatus(inv) {
  const el  = document.getElementById('detailReviewedStatus');
  const btn = document.getElementById('detailReviewedBtn');
  if (!el || !btn) return;
  if (inv.reviewed_at) {
    el.textContent = `Checked ${fmtDate((inv.reviewed_at || '').slice(0, 10))}${inv.reviewed_by ? ' by ' + inv.reviewed_by : ''}`;
    btn.innerHTML = '<i class="fas fa-rotate-left"></i> Undo';
  } else {
    el.textContent = 'Not checked';
    btn.innerHTML = '<i class="fas fa-check"></i> Mark checked';
  }
}

async function toggleReviewed() {
  const id  = document.getElementById('detailInvId').value;
  const inv = allInvoices.find(i => i.id === id);
  if (!id || !inv) return;
  const checked = !inv.reviewed_at;
  try {
    const d = await apiPost(`admin/invoices/${id}/reviewed`, { checked });
    // Server is the source of truth for who/when — use its response, not a guess.
    inv.reviewed_by = d.reviewed_by;
    inv.reviewed_at = d.reviewed_at;
    renderReviewedStatus(inv);
    showToast(checked ? 'Marked checked.' : 'Un-checked.', 'success');
  } catch (e) {
    showToast('Could not update: ' + e.message, 'error');
  }
}

// ── Invoice image zoom ──────────────────────────────────────────
function _cleanInvImgZoom() {
  if (_invImgZoomCleanup) { _invImgZoomCleanup(); _invImgZoomCleanup = null; }
}

// Navigate the multi-page preview in the detail modal. Swaps the image/PDF
// source in place and resets zoom for images so each page fits the frame.
function invGotoPage(delta) {
  if (_invPageUrls.length < 2) return;
  _invPageIdx = Math.max(0, Math.min(_invPageUrls.length - 1, _invPageIdx + delta));
  const url = _invPageUrls[_invPageIdx];
  if (_invPageIsPdf) {
    const frame = document.getElementById('invPageFrame');
    if (frame) frame.src = url;
  } else {
    const img = document.getElementById('invZoomImg');
    if (img) { img.src = url; _initInvImgZoom(); }
  }
  const lbl  = document.getElementById('invPageLabel');
  const prev = document.getElementById('invPagePrev');
  const next = document.getElementById('invPageNext');
  if (lbl)  lbl.textContent = `Page ${_invPageIdx + 1} of ${_invPageUrls.length}`;
  if (prev) prev.disabled = _invPageIdx === 0;
  if (next) next.disabled = _invPageIdx === _invPageUrls.length - 1;
}

function _initInvImgZoom() {
  _cleanInvImgZoom();
  const wrap = document.getElementById('invImgZoomWrap');
  const img  = document.getElementById('invZoomImg');
  if (!wrap || !img) return;

  const inReviewMode = !!wrap.closest('#detailFileBoxTop');
  let scale = 1, panX = 0, panY = 0;
  let dragging = false, startX = 0, startY = 0, startPanX = 0, startPanY = 0;
  let lastPinchDist = null;

  function applyTransform(smooth = false) {
    img.style.transition = smooth ? 'transform 0.1s ease' : 'none';
    img.style.transform  = `translate(${panX}px,${panY}px) scale(${scale})`;
    wrap.style.cursor    = scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'default';
  }

  function clampPan() {
    if (scale <= 1) { panX = 0; panY = 0; return; }
    const W = wrap.clientWidth, H = wrap.clientHeight;
    panX = Math.min(0, Math.max(panX, W * (1 - scale)));
    panY = Math.min(0, Math.max(panY, H * (1 - scale)));
  }

  function zoomAt(cx, cy, factor) {
    const rect = wrap.getBoundingClientRect();
    const mx   = cx - rect.left;
    const my   = cy - rect.top;
    const s2   = Math.min(8, Math.max(1, scale * factor));
    panX  = mx + (panX - mx) * s2 / scale;
    panY  = my + (panY - my) * s2 / scale;
    scale = s2;
    clampPan();
    applyTransform(true);
  }

  function onWheel(e) {
    // Ctrl+wheel zooms; touchpad pinch on Mac also fires wheel with ctrlKey=true
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }

  function onMouseDown(e) {
    if (scale <= 1 || e.button !== 0) return;
    dragging  = true;
    startX    = e.clientX; startY    = e.clientY;
    startPanX = panX;      startPanY = panY;
    applyTransform(false);
    e.preventDefault();
  }

  function onMouseMove(e) {
    if (!dragging) return;
    panX = startPanX + (e.clientX - startX);
    panY = startPanY + (e.clientY - startY);
    clampPan();
    applyTransform(false);
  }

  function onMouseUp() {
    if (!dragging) return;
    dragging = false;
    applyTransform(false);
  }

  function getTouchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  function onTouchStart(e) {
    if (e.touches.length === 2) {
      lastPinchDist = getTouchDist(e.touches);
      e.preventDefault();
    }
  }

  function onTouchMove(e) {
    if (e.touches.length !== 2 || !lastPinchDist) return;
    const dist = getTouchDist(e.touches);
    const cx   = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const cy   = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    zoomAt(cx, cy, dist / lastPinchDist);
    lastPinchDist = dist;
    e.preventDefault();
  }

  function onTouchEnd(e) {
    if (e.touches.length < 2) lastPinchDist = null;
  }

  wrap.addEventListener('wheel',      onWheel,      { passive: false });
  wrap.addEventListener('mousedown',  onMouseDown);
  wrap.addEventListener('touchstart', onTouchStart, { passive: false });
  wrap.addEventListener('touchmove',  onTouchMove,  { passive: false });
  wrap.addEventListener('touchend',   onTouchEnd);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup',   onMouseUp);

  _invImgZoomCleanup = () => {
    wrap.removeEventListener('wheel',      onWheel);
    wrap.removeEventListener('mousedown',  onMouseDown);
    wrap.removeEventListener('touchstart', onTouchStart);
    wrap.removeEventListener('touchmove',  onTouchMove);
    wrap.removeEventListener('touchend',   onTouchEnd);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup',   onMouseUp);
  };

  applyTransform(false);

  // Auto-fit the image so it fills the container width (portrait invoice
  // in a landscape container would otherwise be letterboxed).
  function fitToWidth() {
    if (!img.naturalWidth || !img.naturalHeight) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    const imgAspect       = img.naturalWidth / img.naturalHeight;
    const containerAspect = W / H;
    if (containerAspect > imgAspect) {
      scale = Math.min(8, containerAspect / imgAspect);
      if (inReviewMode) {
        panX = W * (1 - scale) / 2;
        panY = H * (1 - scale) / 2;
      }
      clampPan();
      applyTransform(false);
    }
  }
  // Only the review pane letterboxes a portrait page (fixed-height, object-fit
  // container), so only it needs the fit-to-width transform. In saved mode the
  // image already renders at full container width natively — applying the scale
  // there would upscale a downsampled raster and blur the text.
  if (inReviewMode) {
    if (img.complete) fitToWidth();
    else img.addEventListener('load', fitToWidth, { once: true });
  }
}

// ══════════════════════════════════════════════════════════════
// CONFIRM & SAVE — promotes an Action Required invoice to saved.
// Writes suppliers, generic_products, product_entries, invoice_lines,
// then flips the invoice status to "Closed" and clears parsed_data.
// Mirrors the previous upload-page save flow so all the same logic
// applies (find-or-create supplier, find-or-create generic_product,
// pack_size parsing, cost_per_unit, product mappings, etc.).
// ══════════════════════════════════════════════════════════════
// Show/hide the goods-only sections (line items, additional costs) when the
// "expense bill" toggle is flipped, and reveal the expense-category picker.
function toggleExpenseMode() {
  const on = !!document.getElementById('detailIsExpense')?.checked;
  document.getElementById('expenseCategoryWrap')?.classList.toggle('hidden', !on);
  document.getElementById('goodsLineItems')?.classList.toggle('hidden', on);
  document.getElementById('goodsAdditionalCosts')?.classList.toggle('hidden', on);
}
window.toggleExpenseMode = toggleExpenseMode;

// Save path for expense bills: record vendor/date/total/category and post to
// Closed. Creates NO line items, products, or inventory. The P&L reads the total
// by expense_category for the invoice_date's month.
async function confirmExpenseInvoice(id, inv) {
  const vendor      = (document.getElementById('detailVendorInput').value || '').trim();
  const invoiceNum  = (document.getElementById('detailNumberInput').value || '').trim();
  const invoiceDate = (document.getElementById('detailDateInput').value   || '').trim();
  const total       = parseFloat(document.getElementById('detailTotalInput').value) || 0;
  const notes       = (document.getElementById('detailNotes').value || '').trim();
  const category    = document.getElementById('detailExpenseCategory').value || 'Other';

  if (!invoiceDate) { showToast('Enter the bill date so it lands in the right month.', 'error'); return; }
  if (total <= 0)   { showToast('Enter the bill total.', 'error'); return; }

  const btn = document.getElementById('confirmInvSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    await apiPatch(`tables/${INV_LIST_TABLE}/${id}`, {
      vendor,
      invoice_number:   invoiceNum,
      invoice_date:     invoiceDate,
      total,
      notes,
      status:           'Closed',
      parsed_data:      '',
      invoice_kind:     'expense',
      expense_category: category,
    });
    showToast(`Expense bill saved — ${category} $${total.toFixed(2)} added to the P&L.`, 'success');
    _cleanInvImgZoom();
    closeModal('invDetailModal');
    await loadInvoices();
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check-circle"></i> Confirm & Save';
  }
}

async function confirmAndSaveInvoice() {
  const id  = document.getElementById('detailInvId').value;
  const inv = allInvoices.find(i => i.id === id);
  if (!id || !inv) return;
  if (inv.status !== 'Action Required') {
    showToast('This invoice is no longer in Action Required state.', 'warning');
    return;
  }
  // Expense bills (utilities/rent/etc.) save via a separate path — no line items,
  // no products, no inventory; the total flows straight into the P&L.
  if (document.getElementById('detailIsExpense')?.checked) {
    return confirmExpenseInvoice(id, inv);
  }
  if (hasMissingPageWarning()) {
    showToast('A page appears to be missing — add it, or click "It\'s complete" to proceed.', 'error');
    return;
  }

  const btn = document.getElementById('confirmInvSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

  // Read editable meta fields
  const vendor       = (document.getElementById('detailVendorInput').value || '').trim();
  const invoiceNum   = (document.getElementById('detailNumberInput').value || '').trim();
  const invoiceDate  = (document.getElementById('detailDateInput').value   || '').trim();
  const totalInput   = parseFloat(document.getElementById('detailTotalInput').value) || 0;
  const notes        = (document.getElementById('detailNotes').value || '').trim();

  const taxPst    = parseFloat(document.getElementById('detailTaxPst').value)    || 0;
  const taxGst    = parseFloat(document.getElementById('detailTaxGst').value)    || 0;
  const delivery  = parseFloat(document.getElementById('detailDelivery').value)  || 0;
  const deposit   = parseFloat(document.getElementById('detailDeposit').value)   || 0;
  const credit    = parseFloat(document.getElementById('detailCredit').value)    || 0;
  const otherCost = parseFloat(document.getElementById('detailOtherCost').value) || 0;
  const otherDesc = (document.getElementById('detailOtherDesc').value || '').trim();

  // Filter out empty rows
  const validLines = currentLines
    .map(l => {
      const qty_str  = (l.pack_qty  || '').toString().trim();
      const unit_str = (l.pack_unit || '').trim();
      const packaging = qty_str && unit_str ? `${qty_str} ${unit_str}` : qty_str || unit_str;
      return {
        product_name: (l.product_name || '').trim(),
        vendor_item:  (l.vendor_item  || '').trim(),
        category:     (l.category     || '').trim(),
        item_code:    (l.item_code    || '').trim(),
        packaging,
        price:        parseFloat(l.price)      || 0,
        qty:          parseFloat(l.qty)        || 0,
        line_total:   parseFloat(l.line_total) || 0,
        _original_ocr: l._original_ocr        || '',
      };
    })
    .filter(l => l.product_name);

  if (!validLines.length) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check-circle"></i> Confirm & Save';
    showToast('Add at least one line item with a product name before confirming.', 'error');
    return;
  }

  // Guard: every named line must be fully specified before we post it. A missing
  // unit is silently coerced to "each" on the backend and corrupts cost_per_unit
  // (and Price Movers / recipe costing / FIFO). Mirrored by the backend
  // /api/bulk/upsert-products guard and by the Save Changes path (saveInvDetail).
  const lineProblems = collectLineProblems();
  if (lineProblems.length) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check-circle"></i> Confirm & Save';
    blockOnInvalidLines(lineProblems);
    return;
  }

  // Guard: the stated invoice total must reconcile with lines + extra costs
  // (or be explicitly overridden). Confirming posts this invoice to P&L, so a
  // silent mismatch would mis-state spend and per-unit costs.
  if (blockOnTotalMismatch()) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check-circle"></i> Confirm & Save';
    return;
  }


  const subtotal = validLines.reduce((s, l) => s + l.price * l.qty, 0);
  const computedTotal = subtotal + taxPst + taxGst + delivery + deposit + otherCost - credit;
  // The typed total is authoritative (the guard above proved it reconciles, or
  // the user overrode it knowingly) — no silent max() reconciliation.
  const finalTotal = totalInput > 0 ? totalInput : computedTotal;

  try {
    // 1. Update the invoice meta + extra costs + flip status to Closed,
    //    clear parsed_data so the modal stops hydrating from it next time.
    await apiPatch(`tables/${INV_LIST_TABLE}/${id}`, {
      vendor:         vendor,
      invoice_number: invoiceNum,
      invoice_date:   invoiceDate,
      total:          finalTotal,
      tax_pst:        taxPst,
      tax_gst:        taxGst,
      delivery:       delivery,
      fuel_surcharge: 0,
      deposit:        deposit,
      credit:         credit,
      other_cost:     otherCost,
      other_desc:     otherDesc,
      notes:          notes,
      status:         'Closed',
      parsed_data:    '',
    });

    // 2. Write line items to invoice_lines (replaces any existing)
    await apiPost(`invoice-lines/${id}/replace`, {
      lines: validLines.map(l => ({
        product_name: l.product_name,
        vendor_item:  l.vendor_item,
        category:     l.category,
        item_code:    l.item_code,
        packaging:    l.packaging,
        price:        l.price,
        qty:          l.qty,
        line_total:   l.line_total || (l.price * l.qty),
      })),
      tax_pst:        taxPst,
      tax_gst:        taxGst,
      delivery:       delivery,
      fuel_surcharge: 0,
      deposit:        deposit,
      credit:         credit,
      other_cost:     otherCost,
      other_desc:     otherDesc,
    });

    // 3. Bulk-create suppliers / generic_products / product_entries
    //    — same backend route used by the old upload flow.
    const productsForBulk = validLines.map(l => ({
      // A linked line imports under the product the user picked, so THIS
      // invoice files correctly. The vendor's wording is registered as an
      // alias just below, which is what routes FUTURE invoices.
      name:        l._link_product_name || l.product_name,
      brand:       l.category,           // category column doubles as brand on the line
      sku:         l.item_code,
      pack_size:   l.packaging,
      qty:         l.qty,
      unit_price:  l.price,
      cost:        l.line_total || (l.price * l.qty),
      invoice_ref: invoiceNum,
      invoice_id:        id,
      invoice_file_key:  inv.file_key  || '',
      invoice_file_name: inv.file_name || '',
      invoice_date:      invoiceDate || '',
    }));


    const bulkResult = await apiPost('bulk/upsert-products', {
      vendor_name: vendor,
      products:    productsForBulk,
    });


    // 3b. Register vendor wording for any line the user linked to an existing
    //     product, scoped to the supplier the bulk import just resolved (or
    //     created). Next invoice, the alias match links it with no prompting.
    const linkedLines = validLines.filter(l => l._link_product_id && l.product_name);
    // Vendor names are learned silently here; count them so we can tell the user
    // afterward (they can review/remove them in the product's Vendor Names list).
    let learnedCount = 0;
    if (linkedLines.length && bulkResult?.supplier_id) {
      for (const l of linkedLines) {
        const wording = l.product_name.trim();
        // Wording identical to the product's own name already matches by name.
        if (!wording || wording.toLowerCase() === (l._link_product_name || '').trim().toLowerCase()) continue;
        try {
          const existing = await apiGet(
            `tables/product_aliases?generic_product_id=${encodeURIComponent(l._link_product_id)}`
          );
          const dup = (existing.data || []).some(a =>
            (a.alias_name || '').trim().toLowerCase() === wording.toLowerCase() &&
            (a.supplier_id || null) === bulkResult.supplier_id);
          if (dup) continue;

          await apiPost('tables/product_aliases', {
            alias_name:         wording,
            generic_product_id: l._link_product_id,
            supplier_id:        bulkResult.supplier_id,
          });
          learnedCount++;
        } catch (e) {
          // Non-fatal: the invoice is already filed correctly. Only the
          // remembering failed, so say so rather than failing the approval.
          console.warn('alias save failed:', e.message);
          showToast(`Filed correctly, but couldn't remember "${wording}" for next time.`, 'warning');
        }
      }
    }
    if (learnedCount) {
      showToast(
        learnedCount === 1
          ? 'Remembered 1 new supplier name for next time.'
          : `Remembered ${learnedCount} new supplier names for next time.`,
        'success'
      );
    }

    // 4. Save product mappings so future uploads benefit from corrections
    if (vendor) {
      for (const l of validLines) {
        const stableKey = (l.item_code && l.item_code.trim())
          ? l.item_code.trim().toLowerCase()
          : (l._original_ocr || l.product_name).trim().toLowerCase();
        if (!stableKey) continue;
        try {
          await apiPost('product-mappings', {
            vendor_name:         vendor,
            raw_ocr_text:        stableKey,
            corrected_name:      l.product_name,
            corrected_brand:     l.category,
            corrected_sku:       l.item_code,
            corrected_pack_size: l.packaging,
          });
        } catch (e) {
          console.warn('product-mappings save failed:', e.message);
        }
      }
    }

    // 5. Save the vendor fee template if any non-zero fee field
    const hasAnyFee = delivery > 0 || taxGst > 0 || taxPst > 0 || otherCost > 0;
    if (vendor && hasAnyFee) {
      try {
        await apiPost('vendor-fee-template', {
          vendor_name: vendor,
          delivery:    delivery,
          tax_gst:     taxGst,
          tax_pst:     taxPst,
          other_cost:  otherCost,
          other_desc:  otherDesc,
        });
      } catch (_) { /* non-fatal */ }
    }

    // 6. Update local cache, refresh list
    Object.assign(inv, {
      vendor, invoice_number: invoiceNum, invoice_date: invoiceDate,
      total: finalTotal, tax_pst: taxPst, tax_gst: taxGst,
      delivery: delivery, fuel_surcharge: 0, deposit: deposit,
      credit: credit, other_cost: otherCost, other_desc: otherDesc,
      notes: notes, status: 'Closed', parsed_data: '',
    });

    const parts = [];
    if (bulkResult?.supplier_created) parts.push(`New vendor "${bulkResult.supplier_name}" created`);
    if (bulkResult?.created_generics) parts.push(`${bulkResult.created_generics} new product(s)`);
    if (bulkResult?.reused_generics)  parts.push(`${bulkResult.reused_generics} existing product(s) updated`);
    showToast(parts.join(' · ') || 'Invoice confirmed & saved!', 'success');

    _cleanInvImgZoom();
    closeModal('invDetailModal');
    populateVendorFilter();
    applyFilters();

    // Offer to add items to inventory. The supplier id lets stock-in resolve
    // vendor wording through supplier-scoped aliases, same as the import did.
    openInvPrompt(validLines, invoiceNum, bulkResult?.supplier_id || null);
  } catch (e) {
    console.error('Confirm & Save failed:', e);
    showToast('Confirm failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check-circle"></i> Confirm & Save';
  }
}

// ── Add-to-Inventory prompt (shown after confirming an invoice) ──
let _invPromptRows = [];

// Resolve an invoice line to one of your products, using the SAME precedence as
// the invoice import (/api/bulk/upsert-products): an explicit link chosen on the
// review screen, then exact name, then an alias registered for this supplier,
// then a global alias. Without this, stock-in silently skipped any line that
// arrived under the vendor's own wording — the exact opposite of the point.
function _resolveRowProduct(row, products, aliases, supplierId) {
  const name = (row.product_name || '').trim().toLowerCase();

  // The user already told us on the review screen.
  if (row._link_product_id) {
    const p = products.find(x => x.id === row._link_product_id);
    if (p) return p;
  }
  if (!name) return null;

  // Exact name. Trimmed + case-insensitive: the old code used a strict ===,
  // so "potato " or "Potato" against "potato" simply didn't stock in.
  const byName = products
    .filter(p => (p.name || '').trim().toLowerCase() === name)
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];
  if (byName) return byName;

  const aliasHit = (supId) => aliases.find(a =>
    (a.alias_name || '').trim().toLowerCase() === name &&
    (a.supplier_id || null) === supId);

  // Supplier-specific beats global, so two vendors can use the same wording.
  const scoped = supplierId ? aliasHit(supplierId) : null;
  const global = aliasHit(null);
  const hit    = scoped || global;
  if (!hit) return null;

  const p = products.find(x => x.id === hit.generic_product_id);
  return p && !p.deleted_at ? p : null;
}

async function openInvPrompt(lines, invoiceRef, supplierId = null) {
  if (!lines || !lines.length) return;
  if (!document.getElementById('invPromptModal')) return;

  // THERE ARE TWO "Add to Inventory?" PROMPTS AND THEY BOTH NEED THIS GATE.
  // The other one is openEntryInvPrompt() in products.js, after saving a
  // supplier entry on the product form. That one was gated on 2026-08-05; this
  // one — the far more common path, since it fires after confirming an invoice
  // — was missed, so an Essential restaurant kept being offered inventory it
  // cannot open. Reported repeatedly before anyone looked at THIS function,
  // because the fix was verified against the other file.
  //
  // Same reasoning as products.js: /inventory and /stock-take are the upgrade
  // panel on this plan, so the bin this writes can never be seen, adjusted or
  // counted. Hidden rather than "recorded quietly" because on an Essential
  // restaurant nothing ever draws stock down — no sales import, no stock take,
  // Produce Batch hidden — so the count could only grow, and an upgrade would
  // inherit an overstated figure to unpick by hand.
  if (typeof stockDetailFieldsHidden === 'function' && stockDetailFieldsHidden()) return;

  _invPromptRows = lines.filter(l => l.product_name);

  // Resolve every row up front so the modal can show where each will land,
  // rather than silently dropping the ones it can't place.
  let products = [], aliases = [];
  try {
    const [pd, ad] = await Promise.all([
      apiGet('tables/generic_products?page=1&limit=500'),
      apiGet('tables/product_aliases?page=1&limit=500'),
    ]);
    products = (pd.data || []).filter(p => !p.deleted_at);
    aliases  = ad.data || [];
  } catch (_) { /* fall through — rows resolve to null and are flagged below */ }

  _invPromptRows.forEach(r => {
    r._resolved = _resolveRowProduct(r, products, aliases, supplierId);
  });

  const listEl = document.getElementById('invPromptList');
  listEl.innerHTML = _invPromptRows.map((r, i) => {
    const packaging = r.packaging || '';
    const unitMatch = packaging.match(/[\d.]+\s*(.+)$/);
    const unit = unitMatch ? unitMatch[1].trim() : 'unit';
    const defaultQty = calcInventoryQty(packaging, r.qty);
    const target = r._resolved;
    // Show the destination when the vendor's wording differs from your product
    // name, so an alias-resolved line is visible rather than surprising.
    const note = !target
      ? `<div style="font-size:.74rem;color:#b45309"><i class="fas fa-triangle-exclamation"></i> No matching product — won't be stocked in</div>`
      : ((target.name || '').trim().toLowerCase() !== (r.product_name || '').trim().toLowerCase()
          ? `<div style="font-size:.74rem;color:#4338ca"><i class="fas fa-arrow-right"></i> ${esc(target.name)}</div>`
          : '');
    return `
      <div style="display:flex;align-items:center;gap:.75rem;padding:.5rem 0;border-bottom:1px solid var(--border)">
        <input type="checkbox" id="inv-chk-${i}" ${target ? 'checked' : 'disabled'} style="width:16px;height:16px;cursor:pointer" />
        <div style="flex:1">
          <div style="font-weight:600;font-size:.9rem">${esc(r.product_name)}</div>
          <div style="font-size:.78rem;color:var(--text-muted)">${esc(packaging)}</div>
          ${note}
        </div>
        <div style="display:flex;align-items:center;gap:.4rem">
          <input type="number" id="inv-qty-${i}" value="${defaultQty}" min="0.001" step="0.001"
            style="width:80px;padding:.3rem .5rem;border:1px solid var(--border);border-radius:6px;font-size:.85rem;text-align:right" />
          <span style="font-size:.82rem;color:var(--text-muted)">${esc(unit)}</span>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('skipInvPromptBtn').onclick    = () => closeModal('invPromptModal');
  document.getElementById('closeInvPromptModal').onclick = () => closeModal('invPromptModal');
  document.getElementById('confirmInvPromptBtn').onclick = () => confirmInvPrompt(invoiceRef);
  openModal('invPromptModal');
}

async function confirmInvPrompt(invoiceRef) {
  const btn = document.getElementById('confirmInvPromptBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding…';

  let added = 0;
  const failures = [];   // unit mismatches etc. — surfaced, never swallowed
  for (let i = 0; i < _invPromptRows.length; i++) {
    const chk = document.getElementById(`inv-chk-${i}`);
    if (!chk?.checked) continue;
    const qty = parseFloat(document.getElementById(`inv-qty-${i}`)?.value) || 1;
    const row = _invPromptRows[i];
    // Resolved when the modal opened (exact name → supplier alias → global
    // alias), and shown on the row, so what's stocked in matches what was
    // displayed. Unresolved rows are disabled in the UI and skipped here.
    const match = row._resolved;
    const packaging = row.packaging || '';
    const unitMatch = packaging.match(/[\d.]+\s*(.+)$/);
    const unit = unitMatch ? unitMatch[1].trim() : 'unit';
    if (match && window.invHelpers) {
      try {
        await window.invHelpers.upsertInventory({
          itemId:   match.id,
          itemType: 'raw_material',
          itemName: match.name,
          category: match.category || 'Other',
          unit,
          change:   qty,
          reason:   `Invoice stock-in: ${invoiceRef || 'manual'}`,
        });
        added++;
      } catch (e) {
        failures.push(e.message || `Couldn't stock in ${row.product_name}`);
      }
    }
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-warehouse"></i> Add to Inventory';

  // A unit that can't be converted is a real problem the user has to resolve
  // (usually by setting the product's stocking unit or its average weight), so
  // keep the modal open and say what went wrong rather than silently skipping.
  if (failures.length) {
    if (added) showToast(`${added} item(s) added. ${failures.length} could not be stocked in.`, 'warning');
    failures.slice(0, 3).forEach(msg => showToast(msg, 'error'));
    return;
  }

  closeModal('invPromptModal');
  showToast(`${added} item(s) added to inventory!`, 'success');
}
