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

function parsePackaging(str) {
  const s = (str || '').trim();
  if (!s) return { pack_qty: '', pack_unit: '' };
  const m = s.match(/^([\d.,]+)\s*(.*)$/);
  if (m) return { pack_qty: m[1], pack_unit: m[2].trim() };
  return { pack_qty: '', pack_unit: s };
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
  document.getElementById('addPageBtn')?.addEventListener('click', () => document.getElementById('addPageFileInput')?.click());
  document.getElementById('addPageFileInput')?.addEventListener('change', handleAddPageFile);
  document.getElementById('markCompleteBtn')?.addEventListener('click', markInvoiceComplete);
  document.getElementById('addLineBtn').addEventListener('click',          addLineRow);

  // Live cost summary as user edits additional costs
  ['detailTaxPst','detailTaxGst','detailDelivery','detailDeposit','detailCredit','detailOtherCost'].forEach(id => {
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
  document.getElementById('detailStatus').value        = inv.status          || 'In Processing';
  document.getElementById('detailNotes').value         = inv.notes           || '';

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
      const h = isActionRequired ? '55vh' : '420px';
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
        preview = `
          <div id="invImgZoomWrap" style="margin-top:.5rem;overflow:hidden;height:420px;border-radius:8px;border:1px solid var(--border);position:relative;background:#f1f5f9;cursor:zoom-in">
            <img id="invZoomImg" src="${esc(fileUrl)}" alt="Invoice"
              style="width:100%;height:420px;object-fit:contain;display:block;transform-origin:0 0;user-select:none"
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
      <a href="#" onclick="dismissVendorMatch('${esc(name)}');return false" style="margin-left:.3rem">Undo</a>
    </span>`;
  } else if (res.decision === 'suggest') {
    box.className = '';
    box.innerHTML = `<span style="color:#b45309">
      <i class="fas fa-circle-question"></i> Did you mean existing supplier
      <strong>“${esc(res.match.name)}”</strong>?
      <a href="#" onclick="acceptVendorMatch('${esc(res.match.name)}');return false" style="margin-left:.3rem;font-weight:600">Use it</a>
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
}

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
    // 1. Store the page image in R2 (non-fatal if it fails — parsing still runs)
    let pageKey = '';
    try { pageKey = (await apiUploadFile(file)).key || ''; }
    catch (upErr) { console.warn('Extra-page upload failed (continuing):', upErr.message); }

    // 2. Parse the new page with Claude
    const fd = new FormData();
    fd.append('file', file);
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
      <td><input type="text"   class="line-input" data-idx="${i}" data-f="product_name" value="${esc(l.product_name||'')}" title="${esc(l.product_name||'')}" placeholder="Product" style="width:110px"/></td>
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
}

async function saveInvDetail() {
  const id     = document.getElementById('detailInvId').value;
  const status = document.getElementById('detailStatus').value;
  const notes  = document.getElementById('detailNotes').value.trim();
  const btn    = document.getElementById('saveInvDetailBtn');
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
    // Keep the higher of: recomputed total vs stored DB total (never silently lower it)
    const savedTotal = currentInvTotal > 0
      ? Math.max(currentInvTotal, newTotal)
      : newTotal;

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
  if (img.complete) fitToWidth();
  else img.addEventListener('load', fitToWidth, { once: true });
}

// ══════════════════════════════════════════════════════════════
// CONFIRM & SAVE — promotes an Action Required invoice to saved.
// Writes suppliers, generic_products, product_entries, invoice_lines,
// then flips the invoice status to "Closed" and clears parsed_data.
// Mirrors the previous upload-page save flow so all the same logic
// applies (find-or-create supplier, find-or-create generic_product,
// pack_size parsing, cost_per_unit, product mappings, etc.).
// ══════════════════════════════════════════════════════════════
async function confirmAndSaveInvoice() {
  const id  = document.getElementById('detailInvId').value;
  const inv = allInvoices.find(i => i.id === id);
  if (!id || !inv) return;
  if (inv.status !== 'Action Required') {
    showToast('This invoice is no longer in Action Required state.', 'warning');
    return;
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


  const subtotal = validLines.reduce((s, l) => s + l.price * l.qty, 0);
  const computedTotal = subtotal + taxPst + taxGst + delivery + deposit + otherCost - credit;
  // Never silently lower the total — keep the higher of stored vs recomputed
  const finalTotal = totalInput > 0
    ? Math.max(totalInput, computedTotal)
    : computedTotal;

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
      name:        l.product_name,
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

    // Offer to add items to inventory
    openInvPrompt(validLines, invoiceNum);
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

function openInvPrompt(lines, invoiceRef) {
  if (!lines || !lines.length) return;
  if (!document.getElementById('invPromptModal')) return;

  _invPromptRows = lines.filter(l => l.product_name);
  const listEl = document.getElementById('invPromptList');
  listEl.innerHTML = _invPromptRows.map((r, i) => {
    const packaging = r.packaging || '';
    const unitMatch = packaging.match(/[\d.]+\s*(.+)$/);
    const unit = unitMatch ? unitMatch[1].trim() : 'unit';
    const defaultQty = calcInventoryQty(packaging, r.qty);
    return `
      <div style="display:flex;align-items:center;gap:.75rem;padding:.5rem 0;border-bottom:1px solid var(--border)">
        <input type="checkbox" id="inv-chk-${i}" checked style="width:16px;height:16px;cursor:pointer" />
        <div style="flex:1">
          <div style="font-weight:600;font-size:.9rem">${esc(r.product_name)}</div>
          <div style="font-size:.78rem;color:var(--text-muted)">${esc(packaging)}</div>
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

  let savedProducts = [];
  try {
    const data = await apiGet('tables/generic_products?page=1&limit=1000');
    savedProducts = data.data || [];
  } catch (_) {}

  let added = 0;
  for (let i = 0; i < _invPromptRows.length; i++) {
    const chk = document.getElementById(`inv-chk-${i}`);
    if (!chk?.checked) continue;
    const qty = parseFloat(document.getElementById(`inv-qty-${i}`)?.value) || 1;
    const row = _invPromptRows[i];
    const match = savedProducts
      .filter(p => p.name === row.product_name)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];
    const packaging = row.packaging || '';
    const unitMatch = packaging.match(/[\d.]+\s*(.+)$/);
    const unit = unitMatch ? unitMatch[1].trim() : 'unit';
    if (match && window.invHelpers) {
      try {
        await window.invHelpers.upsertInventory({
          itemId:   match.id,
          itemType: 'raw_material',
          itemName: match.name,
          category: match.category || 'Ingredients',
          unit,
          change:   qty,
          reason:   `Invoice stock-in: ${invoiceRef || 'manual'}`,
        });
        added++;
      } catch (_) {}
    }
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-warehouse"></i> Add to Inventory';
  closeModal('invPromptModal');
  showToast(`${added} item(s) added to inventory!`, 'success');
}

// ── Expose helper for invoice.js to call after upload ──────────
window.saveInvoiceRecord = async function({ vendor, invoiceNumber, invoiceDate, total, fileName, fileKey = '', fileUrl = '', paymentAccount = 'A/P', lines = [] }) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const record = await apiPost(`tables/${INV_LIST_TABLE}`, {
      vendor:           vendor          || '',
      invoice_number:   invoiceNumber   || '',
      invoice_date:     invoiceDate     || today,
      upload_date:      today,
      total:            parseFloat(total) || 0,
      status:           'In Processing',
      payment_account:  paymentAccount,
      file_name:        fileName        || '',
      file_key:         fileKey         || '',
      file_url:         fileUrl         || '',
      notes:            '',
    });
    // Save line items if provided
    if (lines.length && record.id) {
      await apiPost(`invoice-lines/${record.id}/replace`, { lines });
    }
    // Refresh invoice list if we're on the invoices page
    if (typeof loadInvoices === 'function') await loadInvoices();
    return record;
  } catch (e) {
    console.warn('Could not save invoice record:', e.message);
  }
};
