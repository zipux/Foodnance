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

// ── Bootstrap ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('invBody')) return;

  await loadInvoices();

  // If URL hash is an invoice ID (e.g. from product page link), open its detail
  if (location.hash && location.hash.length > 1) {
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
  document.getElementById('deleteInvBtn').addEventListener('click',        deleteInvoice);
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
    if (activeStatus !== 'all' && inv.status !== activeStatus) return false;
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
        <td>${esc(inv.upload_date   || '—')}</td>
        <td style="font-weight:500">${esc(inv.vendor || '—')}</td>
        <td>${esc(inv.invoice_number || '—')}</td>
        <td>${esc(inv.invoice_date  || '—')}</td>
        <td>${statusBadge(inv.status)}</td>
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

// ── Detail modal ────────────────────────────────────────────────
async function openInvDetail(id) {
  const inv = allInvoices.find(i => i.id === id);
  if (!inv) return;

  document.getElementById('detailInvId').value        = id;
  document.getElementById('detailVendor').textContent  = inv.vendor        || '—';
  document.getElementById('detailNumber').textContent  = inv.invoice_number || '—';
  document.getElementById('detailDate').textContent    = inv.invoice_date   || '—';
  document.getElementById('detailUpload').textContent  = inv.upload_date    || '—';
  currentInvTotal = parseFloat(inv.total) || 0;
  document.getElementById('detailTotal').textContent   = inv.total ? '$' + parseFloat(inv.total).toFixed(2) : '—';
  document.getElementById('detailPayment').textContent = inv.payment_account || 'A/P';
  document.getElementById('detailStatus').value        = inv.status          || 'In Processing';
  document.getElementById('detailNotes').value         = inv.notes           || '';

  // Additional cost fields — load from invoice record first
  const taxPstStored        = parseFloat(inv.tax_pst)        || 0;
  const taxGstStored        = parseFloat(inv.tax_gst)        || 0;
  // Combine delivery + fuel_surcharge into one field
  const deliveryStored      = (parseFloat(inv.delivery) || 0) + (parseFloat(inv.fuel_surcharge) || 0);
  const depositStored       = parseFloat(inv.deposit)        || 0;
  const creditStored        = parseFloat(inv.credit)         || 0;
  const otherCostStored     = parseFloat(inv.other_cost)     || 0;

  // If ALL extra-cost fields are zero, try the vendor fee template
  let taxPst = taxPstStored, taxGst = taxGstStored, delivery = deliveryStored;
  let deposit = depositStored, credit = creditStored, otherCost = otherCostStored, otherDesc = inv.other_desc || '';
  const allZero = (taxPstStored + taxGstStored + deliveryStored + depositStored + creditStored + otherCostStored) === 0;
  if (allZero && inv.vendor) {
    try {
      const tmpl = await apiGet(`vendor-fee-template?vendor=${encodeURIComponent(inv.vendor)}`);
      if (tmpl.found && tmpl.template) {
        const t = tmpl.template;
        // Template stores delivery+fuel_surcharge combined in delivery
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
  const fileBox   = document.getElementById('detailFileBox');
  const fileKey   = inv.file_key  || '';
  const fileName  = inv.file_name || '';
  const fileUrl   = fileKey ? `/api/files/${fileKey}` : (inv.file_url || '');
  const ext       = fileName.split('.').pop().toLowerCase();
  const isImage   = ['png','jpg','jpeg','webp','gif'].includes(ext);
  const isPdf     = ext === 'pdf';

  if (fileUrl) {
    let preview = '';
    if (isPdf) {
      preview = `
        <div style="margin-top:.5rem">
          <iframe src="${esc(fileUrl)}" style="width:100%;height:420px;border:1px solid var(--border);border-radius:8px" title="Invoice PDF"></iframe>
        </div>`;
    } else if (isImage) {
      preview = `
        <div id="invImgZoomWrap" style="margin-top:.5rem;overflow:hidden;height:420px;border-radius:8px;border:1px solid var(--border);position:relative;background:#f1f5f9;cursor:zoom-in">
          <img id="invZoomImg" src="${esc(fileUrl)}" alt="Invoice"
            style="width:100%;height:420px;object-fit:contain;display:block;transform-origin:0 0;user-select:none"
            draggable="false" />
        </div>`;
    }
    const openBtn = `<a href="${esc(fileUrl)}" target="_blank" class="btn btn-primary btn-sm" style="margin-left:auto"><i class="fas fa-external-link-alt"></i> Open</a>`;
    fileBox.innerHTML = `
      <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.35rem">
        <i class="fas fa-${isPdf ? 'file-pdf' : isImage ? 'file-image' : 'file-alt'}" style="color:var(--primary);font-size:1.1rem"></i>
        <span style="font-weight:600;font-size:.9rem">${esc(inv.invoice_number || 'N/A')}</span>
        ${openBtn}
        <a href="${esc(fileUrl)}" download="${esc(fileName)}" class="btn btn-secondary btn-sm">
          <i class="fas fa-download"></i> Download
        </a>
      </div>
      ${preview}`;
    fileBox.classList.remove('hidden');
    if (isImage) _initInvImgZoom();
  } else {
    fileBox.innerHTML = `<span style="color:var(--text-muted);font-size:.85rem"><i class="fas fa-paperclip"></i> No file attached</span>`;
    fileBox.classList.remove('hidden');
  }

  openModal('invDetailModal');
}

// ── Line items ───────────────────────────────────────────────────
let currentLines = [];  // working copy of lines in the editor

async function loadAndRenderLines(invoiceId) {
  try {
    const data = await apiGet(`tables/invoice_lines?invoice_id=${invoiceId}&limit=200`);
    currentLines = (data.data || []).map(l => ({ ...l }));
  } catch (_) {
    currentLines = [];
  }
  renderLinesTable();
  // autoFill=true: if all extra-cost fields are 0 but there's a gap vs stored total,
  // auto-populate the Delivery field with the difference
  renderCostSummary({ autoFill: true });
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
      <td><input type="text"   class="line-input" data-idx="${i}" data-f="product_name" value="${esc(l.product_name||'')}" placeholder="Product" style="width:110px"/></td>
      <td><input type="text"   class="line-input" data-idx="${i}" data-f="vendor_item"  value="${esc(l.vendor_item ||'')}" placeholder="Vendor item" style="width:110px"/></td>
      <td><input type="text"   class="line-input" data-idx="${i}" data-f="item_code"    value="${esc(l.item_code   ||'')}" placeholder="Code" style="width:72px"/></td>
      <td><input type="text"   class="line-input" data-idx="${i}" data-f="packaging"    value="${esc(l.packaging   ||'')}" placeholder="Pkg" style="width:72px"/></td>
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

  // Attach input listeners for live line-total + subtotal update
  tbody.querySelectorAll('.line-input').forEach(inp => {
    inp.addEventListener('input', e => {
      const idx = parseInt(e.target.dataset.idx);
      const f   = e.target.dataset.f;
      currentLines[idx][f] = e.target.value;
      // Refresh line total cell
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
  currentLines.push({ product_name:'', vendor_item:'', category:'', item_code:'', packaging:'', price:'', qty:'' });
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
  const creditEl  = document.getElementById('detailCredit');
  const otherEl   = document.getElementById('detailOtherCost');

  let taxPst   = parseFloat(taxPstEl?.value)  || 0;
  let taxGst   = parseFloat(taxGstEl?.value)  || 0;
  let delivery = parseFloat(delivEl?.value)   || 0;
  let credit   = parseFloat(creditEl?.value)  || 0;
  let other    = parseFloat(otherEl?.value)   || 0;

  // Use the stored DB total as authoritative; fall back to computed if not set
  const displayTotal = currentInvTotal > 0 ? currentInvTotal : (subtotal + taxPst + taxGst + delivery + other - credit);

  // Auto-fill: if all extra-cost fields are zero but there is a gap,
  // put the difference into Delivery (most common cause on food invoices)
  const gap = Math.round((displayTotal - subtotal - taxPst - taxGst - delivery - other + credit) * 100) / 100;
  if (autoFill && gap >= 0.01 && taxPst === 0 && taxGst === 0 && delivery === 0 && other === 0 && credit === 0) {
    if (delivEl) { delivEl.value = gap.toFixed(2); delivery = gap; }
  }

  const computed = subtotal + taxPst + taxGst + delivery + other - credit;
  const diff     = Math.round((displayTotal - computed) * 100) / 100;

  const el = document.getElementById('detailCostSummary');
  if (!el) return;
  const row = (label, val, cls='') =>
    `<span style="white-space:nowrap">${label}: <strong class="${cls}">$${Math.abs(val).toFixed(2)}</strong></span>`;
  const parts = [`<span style="white-space:nowrap">Items: <strong>$${subtotal.toFixed(2)}</strong></span>`];
  if (taxPst)   parts.push(row('PST', taxPst));
  if (taxGst)   parts.push(row('GST/HST', taxGst));
  if (delivery) parts.push(row('Delivery + Fuel Surcharge', delivery));
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
    const newTotal  = subtotal + taxPst + taxGst + delivery + otherCost - credit;
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
      lines: currentLines.map(l => ({
        product_name: l.product_name || '',
        vendor_item:  l.vendor_item  || '',
        category:     l.category     || '',
        item_code:    l.item_code    || '',
        packaging:    l.packaging    || '',
        price:        parseFloat(l.price) || 0,
        qty:          parseFloat(l.qty)   || 0,
        line_total:   (parseFloat(l.price)||0) * (parseFloat(l.qty)||0),
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

// ── Invoice image zoom ──────────────────────────────────────────
function _cleanInvImgZoom() {
  if (_invImgZoomCleanup) { _invImgZoomCleanup(); _invImgZoomCleanup = null; }
}

function _initInvImgZoom() {
  _cleanInvImgZoom();
  const wrap = document.getElementById('invImgZoomWrap');
  const img  = document.getElementById('invZoomImg');
  if (!wrap || !img) return;

  let scale = 1, panX = 0, panY = 0;
  let zoomActive = false;
  let dragging = false, startX = 0, startY = 0, startPanX = 0, startPanY = 0;

  function apply() {
    img.style.transform = `translate(${panX}px,${panY}px) scale(${scale})`;
    if (!zoomActive) {
      wrap.style.cursor  = 'zoom-in';
      wrap.style.outline = '';
    } else {
      wrap.style.cursor  = scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in';
      wrap.style.outline = '2px solid var(--primary)';
    }
  }

  function reset() {
    scale = 1; panX = 0; panY = 0;
    zoomActive = false; dragging = false;
    apply();
  }

  function clampPan() {
    if (scale <= 1) { panX = 0; panY = 0; return; }
    const W = wrap.clientWidth, H = wrap.clientHeight;
    panX = Math.min(0, Math.max(panX, W * (1 - scale)));
    panY = Math.min(0, Math.max(panY, H * (1 - scale)));
  }

  function onWrapClick() {
    if (!zoomActive) { zoomActive = true; apply(); }
  }

  function onDocClick(e) {
    if (zoomActive && !wrap.contains(e.target)) reset();
  }

  function onWheel(e) {
    if (!zoomActive) return; // let scroll propagate normally when not in zoom mode
    e.preventDefault();
    const rect   = wrap.getBoundingClientRect();
    const mx     = e.clientX - rect.left;
    const my     = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const s2     = Math.min(8, Math.max(1, scale * factor));
    panX  = mx + (panX - mx) * s2 / scale;
    panY  = my + (panY - my) * s2 / scale;
    scale = s2;
    clampPan();
    apply();
  }

  function onMouseDown(e) {
    if (!zoomActive || scale <= 1) return;
    dragging  = true;
    startX    = e.clientX; startY    = e.clientY;
    startPanX = panX;      startPanY = panY;
    apply();
    e.preventDefault();
  }

  function onMouseMove(e) {
    if (!dragging) return;
    panX = startPanX + (e.clientX - startX);
    panY = startPanY + (e.clientY - startY);
    clampPan();
    apply();
  }

  function onMouseUp() {
    if (!dragging) return;
    dragging = false;
    apply();
  }

  wrap.addEventListener('click',     onWrapClick);
  wrap.addEventListener('wheel',     onWheel,     { passive: false });
  wrap.addEventListener('mousedown', onMouseDown);
  document.addEventListener('click',     onDocClick);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup',   onMouseUp);

  _invImgZoomCleanup = () => {
    wrap.removeEventListener('click',     onWrapClick);
    wrap.removeEventListener('wheel',     onWheel);
    wrap.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('click',     onDocClick);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup',   onMouseUp);
  };
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
