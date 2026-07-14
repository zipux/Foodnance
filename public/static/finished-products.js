/* ===== finished-products.js ===== */

const FP_TABLE       = 'finished_products';
const FP_ITEMS_TABLE = 'finished_product_items';
const PROD_TABLE     = 'generic_products';   // two-level model
const ENTRIES_TABLE_FP = 'product_entries';  // supplier entries for FIFO
const REC_TABLE      = 'recipes';

let allProducts_fp  = [];   // product catalogue
let allRecipes_fp   = [];   // recipe catalogue
let allInventory_fp = [];   // inventory snapshot (refreshed on page load & pack-run open)
let fpRecipeRows    = [];   // [{ref_id, ref_name, quantity, unit, yield_unit, cost_per_yield_unit, line_cost}]
let fpProductRows   = [];   // [{ref_id, ref_name, quantity, unit, unit_cost, pack_unit}]
let allFp           = [];   // saved finished products
let currentFpDetailId = null;

// ── Bootstrap ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('fpName')) return;

  await Promise.all([loadFpCatalogues(), loadFinishedProducts()]);

  document.getElementById('addFpRecipeBtn').addEventListener('click',  () => addFpRecipeLine());
  document.getElementById('addFpProductBtn').addEventListener('click', () => addFpProductLine());
  document.getElementById('saveFpBtn').addEventListener('click',  saveFp);
  document.getElementById('clearFpBtn').addEventListener('click', clearFpForm);
  document.getElementById('fpSearch').addEventListener('input',   e => renderFpList(e.target.value.trim()));

  // Detail modal
  document.getElementById('closeFpDetailModal').addEventListener('click', () => closeModal('fpDetailModal'));
  document.getElementById('closeFpDetailBtn').addEventListener('click',   () => closeModal('fpDetailModal'));
  document.getElementById('fpDetailModal').addEventListener('click', e => {
    if (e.target === document.getElementById('fpDetailModal')) closeModal('fpDetailModal');
  });
  document.getElementById('editFromFpDetailBtn').addEventListener('click', () => {
    closeModal('fpDetailModal');
    loadFpIntoForm(currentFpDetailId);
  });
  document.getElementById('deleteFromFpDetailBtn').addEventListener('click', () => deleteFp(currentFpDetailId));
  document.getElementById('packRunBtn').addEventListener('click', () => openPackRunModal(currentFpDetailId));

  // Pack Run modal
  document.getElementById('closePackRunModal').addEventListener('click',  () => closeModal('packRunModal'));
  document.getElementById('cancelPackRunModal').addEventListener('click', () => closeModal('packRunModal'));
  document.getElementById('packRunModal').addEventListener('click', e => {
    if (e.target === document.getElementById('packRunModal')) closeModal('packRunModal');
  });
  document.getElementById('confirmPackRunBtn').addEventListener('click', confirmPackRun);
  document.getElementById('prUnits').addEventListener('input', updatePrPreview);

  // Start with one recipe line and one product line
  addFpRecipeLine();
  addFpProductLine();
});

// ── Load catalogues ────────────────────────────────────────────
async function loadFpCatalogues() {
  try {
    const [gd, ed, rd, invd] = await Promise.all([
      apiGet(`tables/${PROD_TABLE}?page=1&limit=500`),
      apiGet(`tables/${ENTRIES_TABLE_FP}?page=1&limit=1000`),
      apiGet(`tables/${REC_TABLE}?page=1&limit=500`),
      apiGet(`tables/inventory?page=1&limit=500`),
    ]);
    const generics     = gd.data   || [];
    const entries      = ed.data   || [];
    allInventory_fp     = invd.data || [];
    const allInv        = allInventory_fp;

    // Build allProducts_fp: one entry per generic product, inventory-aware FIFO cost
    allProducts_fp = generics.map(g => {
      const myEntries = entries
        .filter(e => e.generic_product_id === g.id)
        .sort((a, b) => (a.purchase_date || '') > (b.purchase_date || '') ? 1 : -1);

      if (!myEntries.length) {
        return {
          id: g.id, name: g.name, category: g.category,
          deleted_at: g.deleted_at || null,   // archived items stay resolvable but are hidden from the picker
          pack_size: '', cost: 0,
          sub_unit_name: g.sub_unit_name || '', sub_unit_qty: g.sub_unit_qty || 0,
          _cpu: 0, _packUnit: 'unit',
        };
      }

      // Find current inventory stock for this product
      const invRow = allInv.find(r => r.item_id === g.id && r.item_type === 'raw_material');
      const invQty = parseFloat(invRow?.quantity) || 0;

      // Inventory-aware FIFO: find the active batch layer
      const activeEntry = fp_fifoActiveEntry(myEntries, invQty);

      const packSz  = activeEntry.pack_size || '';
      const pqMatch = packSz.match(/^([\d.]+)/);
      const puMatch = packSz.match(/[\d.]+\s*(.+)$/);
      const pQty    = pqMatch ? parseFloat(pqMatch[1]) : 1;
      const pUnit   = puMatch ? puMatch[1].trim() : 'unit';
      const cpu     = pQty > 0 ? activeEntry.cost / pQty : 0;

      return {
        id:            g.id,
        name:          g.name,
        category:      g.category,
        deleted_at:    g.deleted_at || null,   // archived items stay resolvable but are hidden from the picker
        pack_size:     packSz,
        cost:          activeEntry.cost || 0,
        sub_unit_name: g.sub_unit_name || '',
        sub_unit_qty:  g.sub_unit_qty  || 0,
        _cpu:          cpu,
        _packUnit:     pUnit,
      };
    });
    allRecipes_fp = rd.data || [];
  } catch (e) {
    console.error('Failed to load catalogues', e);
  }
}

/**
 * Inventory-aware FIFO: given entries sorted oldest→newest and current
 * inventory quantity, return the entry whose batch is actively being consumed.
 * Mirrors the corrected logic in recipes.js → fifoActiveEntry().
 */
// Quantity a single purchase (entry) brought into stock, in the entry's pack unit:
//   pack_qty × qty_ordered. Prefers the pack_qty/qty_ordered columns; falls back
// to parsing a legacy pack_size string. Mirrors recipes.js → fifoEntryQty().
function fp_fifoEntryQty(entry) {
  let pQty = (entry.pack_qty != null && entry.pack_qty !== '')
    ? parseFloat(entry.pack_qty)
    : parseFloat((String(entry.pack_size || '').match(/^([\d.]+)/) || [])[1]);
  if (!(pQty > 0)) pQty = 1;
  const ordered = parseFloat(entry.qty_ordered) || 1;
  return pQty * ordered;
}

function fp_fifoActiveEntry(sortedEntries, invQty) {
  if (!sortedEntries.length) return null;

  // Sum all purchased quantities
  let totalPurchased = 0;
  for (const entry of sortedEntries) {
    totalPurchased += fp_fifoEntryQty(entry);
  }

  // How much has already been consumed
  const consumed = Math.max(0, totalPurchased - Math.max(0, invQty));

  // Walk oldest→newest: first entry whose running cumulative > consumed = active batch
  let cumulative = 0;
  for (const entry of sortedEntries) {
    cumulative += fp_fifoEntryQty(entry);
    if (cumulative > consumed) return entry;
  }

  // All batches exhausted → use the newest entry
  return sortedEntries[sortedEntries.length - 1];
}

// ── Unit helpers (same logic as recipes.js) ────────────────────
function fp_packQty(p) {
  const m = (p.pack_size || '').match(/^([\d.]+)/);
  return m ? parseFloat(m[1]) : 1;
}
function fp_packUnit(p) {
  if (p._packUnit !== undefined) return p._packUnit; // use pre-computed FIFO pack unit
  const m = (p.pack_size || '').match(/[\d.]+\s*(.+)$/);
  return m ? m[1].trim() : 'unit'; // preserve original case e.g. 'Each', 'L', 'kg'
}
function fp_costPerUnit(p) {
  // Use pre-computed FIFO cpu if available, otherwise parse from pack_size
  if (p._cpu !== undefined) return p._cpu;
  const qty = fp_packQty(p);
  return qty > 0 ? (p.cost || 0) / qty : (p.cost || 0);
}
function fp_conversionFactor(packUnitStr, recipeUnitStr) {
  const pu = (packUnitStr  || '').toLowerCase();
  const ru = (recipeUnitStr || '').toLowerCase();
  if (pu === ru) return 1;
  // Weight
  if (pu === 'kg'  && ru === 'g')   return 0.001;
  if (pu === 'g'   && ru === 'kg')  return 1000;
  if (pu === 'kg'  && ru === 'lb')  return 0.453592;
  if (pu === 'lb'  && ru === 'kg')  return 2.20462;
  if (pu === 'g'   && ru === 'lb')  return 453.592;
  if (pu === 'lb'  && ru === 'g')   return 0.00220462;
  // Volume
  if (pu === 'l'   && ru === 'ml')  return 0.001;
  if (pu === 'ml'  && ru === 'l')   return 1000;
  return 1;
}

// ── Recipe Lines ───────────────────────────────────────────────
function addFpRecipeLine(prefill = null) {
  const idx = fpRecipeRows.length;
  const row = prefill || { ref_id: '', ref_name: '', quantity: 1, unit: '', yield_unit: 'kg', cost_per_yield_unit: 0, line_cost: 0 };
  fpRecipeRows.push(row);

  const container = document.getElementById('fpRecipeLines');
  const div = document.createElement('div');
  div.className = 'fp-line';
  div.id = `fpr-${idx}`;

  const opts = allRecipes_fp.map(r =>
    `<option value="${esc(r.id)}"
      data-cost="${r.total_cost || 0}"
      data-yield="${r.servings || 1}"
      data-yieldunit="${esc(r.yield_unit || 'kg')}"
      ${r.id === row.ref_id ? 'selected' : ''}>
      ${esc(r.name)} (${fmt((r.total_cost||0)/(r.servings||1))}/${esc(r.yield_unit||'kg')})
    </option>`
  ).join('');

  div.innerHTML = `
    <div class="form-group">
      ${idx === 0 ? '<label>Recipe</label>' : '<label>&nbsp;</label>'}
      <select id="fpr-sel-${idx}" onchange="onFpRecipeChange(${idx})">
        <option value="">— Select recipe —</option>
        ${opts}
      </select>
    </div>
    <div class="form-group">
      ${idx === 0 ? '<label>Qty</label>' : '<label>&nbsp;</label>'}
      <input type="number" id="fpr-qty-${idx}" value="${row.quantity}" min="0.01" step="0.01" oninput="onFpRecipeQtyChange(${idx})" />
    </div>
    <div class="form-group unit-group">
      ${idx === 0 ? '<label>Unit</label>' : '<label>&nbsp;</label>'}
      <select id="fpr-unit-${idx}" onchange="onFpRecipeUnitChange(${idx})">
        ${buildFpUnitOptions(row.unit, null)}
      </select>
    </div>
    <div>
      ${idx === 0 ? '<label style="font-size:.72rem;font-weight:600;color:transparent">x</label>' : ''}
      <button class="btn btn-danger btn-icon" onclick="removeFpRecipeLine(${idx})" title="Remove"><i class="fas fa-times"></i></button>
    </div>
  `;
  container.appendChild(div);
  if (row.ref_id) onFpRecipeChange(idx);
}

function onFpRecipeChange(idx) {
  const sel       = document.getElementById(`fpr-sel-${idx}`);
  const opt       = sel.options[sel.selectedIndex];
  const totalCost = parseFloat(opt?.dataset?.cost  || 0);
  const yieldQty  = parseFloat(opt?.dataset?.yield || 1);
  const yieldUnit = opt?.dataset?.yieldunit || 'kg';

  fpRecipeRows[idx].ref_id              = sel.value;
  fpRecipeRows[idx].ref_name            = opt?.text?.split('(')[0]?.trim() || '';
  fpRecipeRows[idx].cost_per_yield_unit = yieldQty > 0 ? totalCost / yieldQty : totalCost;
  fpRecipeRows[idx].yield_unit          = yieldUnit;

  // Auto-set unit to recipe's yield unit — unless user already manually locked it
  if (!fpRecipeRows[idx]._manualUnit) {
    fpRecipeRows[idx].unit = yieldUnit;
    const unitSel = document.getElementById(`fpr-unit-${idx}`);
    if (unitSel) unitSel.innerHTML = buildFpUnitOptions(yieldUnit, null);
  }

  onFpRecipeQtyChange(idx);
}

function onFpRecipeQtyChange(idx) {
  const qty = parseFloat(document.getElementById(`fpr-qty-${idx}`)?.value) || 0;
  fpRecipeRows[idx].quantity  = qty;
  fpRecipeRows[idx].line_cost = calcFpRecipeLineCost(idx);
  recalcFpCosts();
}

function onFpRecipeUnitChange(idx) {
  fpRecipeRows[idx].unit        = document.getElementById(`fpr-unit-${idx}`)?.value || 'kg';
  fpRecipeRows[idx]._manualUnit = true; // user explicitly chose — lock it
  fpRecipeRows[idx].line_cost   = calcFpRecipeLineCost(idx);
  recalcFpCosts();
}

// Cost = cost_per_yield_unit × quantity × conversion(yieldUnit → chosenUnit)
function calcFpRecipeLineCost(idx) {
  const r      = fpRecipeRows[idx];
  if (!r || !r.ref_id) return 0;
  const factor = fp_conversionFactor(r.yield_unit || 'kg', r.unit || 'kg');
  return (r.cost_per_yield_unit || 0) * (r.quantity || 0) * factor;
}

function removeFpRecipeLine(idx) {
  document.getElementById(`fpr-${idx}`)?.remove();
  fpRecipeRows[idx] = null;
  recalcFpCosts();
}

// ── Product / Packaging Lines ──────────────────────────────────
// Build unit dropdown options — case-insensitive match, sub-unit at top if defined
function buildFpUnitOptions(selectedUnit, product) {
  const su  = product?.sub_unit_name || '';
  const std = ['kg','g','lb','ml','L','Can','Each','Pack','Case','Dozen'];
  const sel = (selectedUnit || '').toLowerCase();
  let html  = '';
  if (su) {
    const isSel = sel === su.toLowerCase() ? 'selected' : '';
    html += `<option value="${esc(su)}" ${isSel} style="font-weight:700;color:#4f46e5">${esc(su)} ← sub-unit</option>`;
  }
  html += std.map(u => {
    const isSel = sel === u.toLowerCase() ? 'selected' : '';
    return `<option value="${u}" ${isSel}>${u}</option>`;
  }).join('');
  return html;
}

function addFpProductLine(prefill = null) {
  const idx = fpProductRows.length;
  const row = prefill || { ref_id: '', ref_name: '', quantity: 1, unit: '', unit_cost: 0, pack_unit: '' };
  fpProductRows.push(row);

  const container = document.getElementById('fpProductLines');
  const div = document.createElement('div');
  div.className = 'fp-line';
  div.id = `fpp-${idx}`;

  // Hide archived (discontinued) products, but keep the one this line already
  // uses (row.ref_id) so editing an existing finished product never loses its selection.
  const opts = allProducts_fp.filter(p => !p.deleted_at || p.id === row.ref_id).map(p => {
    const cpu = fp_costPerUnit(p);
    const pu  = p._packUnit || fp_packUnit(p);
    return `<option value="${esc(p.id)}" data-cost="${cpu}" data-packunit="${esc(pu)}"
      data-subunitname="${esc(p.sub_unit_name || '')}"
      ${p.id === row.ref_id ? 'selected' : ''}>
      ${esc(p.name)} (${fmt(cpu)}/${pu}) [FIFO]
    </option>`;
  }).join('');

  div.innerHTML = `
    <div class="form-group">
      ${idx === 0 ? '<label>Product</label>' : '<label>&nbsp;</label>'}
      <select id="fpp-sel-${idx}" onchange="onFpProductChange(${idx})">
        <option value="">— Select product —</option>
        ${opts}
      </select>
    </div>
    <div class="form-group">
      ${idx === 0 ? '<label>Qty</label>' : '<label>&nbsp;</label>'}
      <input type="number" id="fpp-qty-${idx}" value="${row.quantity}" min="0.01" step="0.01" oninput="onFpProductQtyChange(${idx})" />
    </div>
    <div class="form-group">
      ${idx === 0 ? '<label>Unit</label>' : '<label>&nbsp;</label>'}
      <select id="fpp-unit-${idx}" onchange="onFpProductUnitChange(${idx})">
        ${buildFpUnitOptions(row.unit, allProducts_fp.find(p => p.id === row.ref_id))}
      </select>
    </div>
    <div>
      ${idx === 0 ? '<label style="font-size:.72rem;font-weight:600;color:transparent">x</label>' : ''}
      <button class="btn btn-danger btn-icon" onclick="removeFpProductLine(${idx})" title="Remove"><i class="fas fa-times"></i></button>
    </div>
  `;
  container.appendChild(div);
  if (row.ref_id) onFpProductChange(idx);
}

function onFpProductChange(idx) {
  const sel         = document.getElementById(`fpp-sel-${idx}`);
  const opt         = sel.options[sel.selectedIndex];
  const pu          = opt?.dataset?.packunit || 'kg';
  const subUnitName = opt?.dataset?.subunitname || '';
  const product     = allProducts_fp.find(p => p.id === sel.value);

  fpProductRows[idx].ref_id    = sel.value;
  fpProductRows[idx].ref_name  = opt?.text?.split('(')[0]?.trim() || '';
  fpProductRows[idx].unit_cost = parseFloat(opt?.dataset?.cost || 0);
  fpProductRows[idx].pack_unit = pu;

  // Auto-set unit: sub-unit first, then pack unit — unless user manually locked it
  if (!fpProductRows[idx]._manualUnit) {
    const defaultUnit = subUnitName ? subUnitName : (pu || 'kg');
    fpProductRows[idx].unit = defaultUnit;
  }

  // Rebuild unit dropdown with correct default selected
  const unitSel = document.getElementById(`fpp-unit-${idx}`);
  if (unitSel) {
    unitSel.innerHTML = buildFpUnitOptions(fpProductRows[idx].unit, product);
  }

  onFpProductQtyChange(idx);
}

function onFpProductQtyChange(idx) {
  const qty = parseFloat(document.getElementById(`fpp-qty-${idx}`)?.value) || 0;
  fpProductRows[idx].quantity = qty;
  recalcFpCosts();
}

function onFpProductUnitChange(idx) {
  fpProductRows[idx].unit        = document.getElementById(`fpp-unit-${idx}`)?.value || 'kg';
  fpProductRows[idx]._manualUnit = true; // user explicitly chose — lock it
  recalcFpCosts();
}

function removeFpProductLine(idx) {
  document.getElementById(`fpp-${idx}`)?.remove();
  fpProductRows[idx] = null;
  recalcFpCosts();
}

// ── Cost Recalc ────────────────────────────────────────────────
function recalcFpCosts() {
  let total = 0;

  // Sum recipe costs (quantity × cost_per_yield_unit × unit conversion)
  fpRecipeRows.filter(r => r && r.ref_id).forEach(r => {
    total += r.line_cost || 0;
  });

  // Sum product costs (with unit conversion)
  fpProductRows.filter(r => r && r.ref_id).forEach(r => {
    const factor = fp_conversionFactor(r.pack_unit || 'kg', r.unit || 'kg');
    total += (r.unit_cost || 0) * (r.quantity || 1) * factor;
  });

  const selling = parseFloat(document.getElementById('fpSellingPrice').value) || 0;
  const profit  = selling - total;
  const margin  = selling > 0 ? (profit / selling) * 100 : null;

  document.getElementById('fpTotalCostDisplay').textContent = fmt(total);

  const profitEl  = document.getElementById('fpProfitDisplay');
  const marginEl  = document.getElementById('fpMarginDisplay');
  const labelEl   = document.getElementById('fpProfitLabel');

  if (selling === 0) {
    profitEl.textContent = '—';
    profitEl.className   = 'fp-profit-value neutral';
    marginEl.textContent = '—';
    labelEl.innerHTML    = '<i class="fas fa-chart-line"></i> Profit / Loss';
  } else if (profit > 0) {
    profitEl.textContent = '+' + fmt(profit);
    profitEl.className   = 'fp-profit-value profit';
    marginEl.textContent = margin.toFixed(1) + '%';
    marginEl.style.color = '#16a34a';
    labelEl.innerHTML    = '<i class="fas fa-arrow-trend-up"></i> Profit';
  } else if (profit < 0) {
    profitEl.textContent = fmt(profit);
    profitEl.className   = 'fp-profit-value loss';
    marginEl.textContent = margin.toFixed(1) + '%';
    marginEl.style.color = '#dc2626';
    labelEl.innerHTML    = '<i class="fas fa-arrow-trend-down"></i> Loss';
  } else {
    profitEl.textContent = fmt(0);
    profitEl.className   = 'fp-profit-value neutral';
    marginEl.textContent = '0.0%';
    marginEl.style.color = '';
    labelEl.innerHTML    = '<i class="fas fa-equals"></i> Break-even';
  }

  return total;
}

// ── Save ───────────────────────────────────────────────────────
async function saveFp() {
  const name     = document.getElementById('fpName').value.trim();
  const desc     = document.getElementById('fpDesc').value.trim();
  const selling  = parseFloat(document.getElementById('fpSellingPrice').value) || 0;
  const editId   = document.getElementById('editFpId').value;

  if (!name) { showToast('Product name is required.', 'error'); return; }

  const activeRecipes  = fpRecipeRows.filter(r => r && r.ref_id);
  const activeProducts = fpProductRows.filter(r => r && r.ref_id);

  if (!activeRecipes.length && !activeProducts.length) {
    showToast('Add at least one recipe or product.', 'error');
    return;
  }

  const total  = recalcFpCosts();
  const profit = selling - total;
  const margin = selling > 0 ? (profit / selling) * 100 : 0;

  const btn = document.getElementById('saveFpBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

  try {
    let fpId;
    const payload = { name, description: desc, selling_price: selling, total_cost: total, profit, margin_pct: margin };

    if (editId) {
      await apiPut(`tables/${FP_TABLE}/${editId}`, payload);
      fpId = editId;
      // Delete old items
      const old = await apiGet(`tables/${FP_ITEMS_TABLE}?page=1&limit=500`);
      const mine = (old.data || []).filter(i => i.finished_product_id === fpId);
      for (const it of mine) await apiDelete(`tables/${FP_ITEMS_TABLE}/${it.id}`);
      showToast('Finished product updated!', 'success');
    } else {
      const fp = await apiPost(`tables/${FP_TABLE}`, payload);
      fpId = fp.id;
      showToast('Finished product saved!', 'success');
    }

    // Save recipe items
    for (const r of activeRecipes) {
      await apiPost(`tables/${FP_ITEMS_TABLE}`, {
        finished_product_id: fpId,
        item_type:  'recipe',
        ref_id:     r.ref_id,
        ref_name:   r.ref_name,
        quantity:   r.quantity,
        unit:       r.unit || 'kg',
        line_cost:  r.line_cost || 0,
      });
    }

    // Save product items
    for (const r of activeProducts) {
      const factor = fp_conversionFactor(r.pack_unit || 'kg', r.unit || 'kg');
      await apiPost(`tables/${FP_ITEMS_TABLE}`, {
        finished_product_id: fpId,
        item_type:  'product',
        ref_id:     r.ref_id,
        ref_name:   r.ref_name,
        quantity:   r.quantity,
        unit:       r.unit,
        line_cost:  (r.unit_cost || 0) * (r.quantity || 1) * factor,
      });
    }

    clearFpForm();
    await loadFinishedProducts();
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save';
  }
}

// ── Clear Form ─────────────────────────────────────────────────
function clearFpForm() {
  document.getElementById('editFpId').value    = '';
  document.getElementById('fpName').value      = '';
  document.getElementById('fpDesc').value      = '';
  document.getElementById('fpSellingPrice').value = '';
  document.getElementById('fpFormTitle').innerHTML = '<i class="fas fa-plus-circle"></i> New Finished Product';
  document.getElementById('fpRecipeLines').innerHTML  = '';
  document.getElementById('fpProductLines').innerHTML = '';
  fpRecipeRows  = [];
  fpProductRows = [];
  addFpRecipeLine();
  addFpProductLine();
  recalcFpCosts();
}

// ── Load Finished Products ─────────────────────────────────────
async function loadFinishedProducts() {
  try {
    const data = await apiGet(`tables/${FP_TABLE}?page=1&limit=200`);
    allFp = data.data || [];
    renderFpList('');
  } catch (e) {
    document.getElementById('fpListContainer').innerHTML =
      '<div class="empty-row"><i class="fas fa-exclamation-triangle"></i> Failed to load.</div>';
  }
}

function renderFpList(query) {
  const container = document.getElementById('fpListContainer');
  let list = allFp;
  if (query) {
    const q = query.toLowerCase();
    list = list.filter(fp =>
      (fp.name || '').toLowerCase().includes(q) ||
      (fp.description || '').toLowerCase().includes(q)
    );
  }

  if (!list.length) {
    container.innerHTML = '<div class="empty-row"><i class="fas fa-tag"></i> No finished products yet.</div>';
    return;
  }

  container.innerHTML = list.map(fp => {
    const profit     = fp.profit || 0;
    const margin     = fp.margin_pct || 0;
    const profitChip = profit > 0
      ? `<span class="fp-chip fp-chip-profit"><i class="fas fa-arrow-trend-up"></i> +${fmt(profit)}</span>`
      : profit < 0
      ? `<span class="fp-chip fp-chip-loss"><i class="fas fa-arrow-trend-down"></i> ${fmt(profit)}</span>`
      : '';
    const marginChip = fp.selling_price
      ? `<span class="fp-chip fp-chip-margin">${margin.toFixed(1)}% margin</span>`
      : '';

    return `
      <div class="fp-card" onclick="openFpDetail('${esc(fp.id)}')">
        <div class="fp-card-header">
          <div class="fp-card-name">${esc(fp.name)}</div>
          <div style="text-align:right;white-space:nowrap">
            ${fp.selling_price ? `<div style="font-weight:700;color:#059669;font-size:1rem">${fmt(fp.selling_price)}</div>` : ''}
            <div style="font-size:.78rem;color:var(--text-muted)">Cost: ${fmt(fp.total_cost)}</div>
          </div>
        </div>
        ${fp.description ? `<div class="fp-card-desc">${esc(fp.description)}</div>` : ''}
        <div class="fp-card-chips">
          <span class="fp-chip fp-chip-cost"><i class="fas fa-calculator"></i> ${fmt(fp.total_cost)}</span>
          ${fp.selling_price ? `<span class="fp-chip fp-chip-price"><i class="fas fa-tag"></i> ${fmt(fp.selling_price)}</span>` : ''}
          ${profitChip}
          ${marginChip}
        </div>
      </div>
    `;
  }).join('');
}

// ── Detail Modal ───────────────────────────────────────────────
async function openFpDetail(id) {
  currentFpDetailId = id;
  const fp = allFp.find(f => f.id === id);
  if (!fp) return;

  document.getElementById('fpDetailName').textContent = fp.name;

  let items = [];
  try {
    const data = await apiGet(`tables/${FP_ITEMS_TABLE}?page=1&limit=500`);
    items = (data.data || []).filter(i => i.finished_product_id === id);
  } catch (_) {}

  const recipeItems  = items.filter(i => i.item_type === 'recipe');
  const productItems = items.filter(i => i.item_type === 'product');
  const totalCost    = fp.total_cost || 0;
  const selling      = fp.selling_price || 0;
  const profit       = fp.profit || 0;
  const margin       = fp.margin_pct || 0;

  let body = `
    <div class="detail-section-title">Product Info</div>
    <div class="detail-info-grid">
      ${fp.description ? `<div class="detail-info-item"><span>Description</span><span>${esc(fp.description)}</span></div>` : ''}
      <div class="detail-info-item"><span>Total Cost</span><span>${fmt(totalCost)}</span></div>
      <div class="detail-info-item"><span>Selling Price</span><span>${selling ? fmt(selling) : '—'}</span></div>
      <div class="detail-info-item"><span>Profit / Loss</span><span style="color:${profit >= 0 ? '#16a34a' : '#dc2626'};font-weight:700">${profit >= 0 ? '+' : ''}${fmt(profit)}</span></div>
      ${selling ? `<div class="detail-info-item"><span>Margin</span><span>${margin.toFixed(1)}%</span></div>` : ''}
    </div>
  `;

  // Recipes section
  if (recipeItems.length) {
    body += `
      <div class="detail-section-title">Recipes Used</div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Recipe</th><th>Qty (batches)</th><th>Line Cost</th></tr></thead>
          <tbody>
            ${recipeItems.map(it => `
              <tr>
                <td><span class="fp-type-badge recipe">Recipe</span> <strong>${esc(it.ref_name)}</strong></td>
                <td>${it.quantity}</td>
                <td><strong>${fmt(it.line_cost)}</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // Products section
  if (productItems.length) {
    body += `
      <div class="detail-section-title">Products / Packaging</div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Product</th><th>Qty</th><th>Unit</th><th>Line Cost</th></tr></thead>
          <tbody>
            ${productItems.map(it => `
              <tr>
                <td><span class="fp-type-badge product">Product</span> <strong>${esc(it.ref_name)}</strong></td>
                <td>${it.quantity}</td>
                <td>${esc(it.unit || '—')}</td>
                <td><strong>${fmt(it.line_cost)}</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // Cost breakdown boxes
  body += `
    <div class="detail-cost-box" style="margin-top:1rem">
      <div><div class="label"><i class="fas fa-calculator"></i> Total Cost</div></div>
      <div class="amount">${fmt(totalCost)}</div>
    </div>
  `;
  if (selling) {
    const isProfit = profit >= 0;
    body += `
      <div class="detail-cost-box" style="margin-top:.5rem;background:${isProfit ? '#f0fdf4' : '#fff1f2'};border-color:${isProfit ? '#86efac' : '#fca5a5'}">
        <div>
          <div class="label"><i class="fas fa-${isProfit ? 'arrow-trend-up' : 'arrow-trend-down'}"></i> ${isProfit ? 'Profit' : 'Loss'}</div>
          <div style="font-size:.8rem;color:var(--text-muted)">${margin.toFixed(1)}% margin on ${fmt(selling)} selling price</div>
        </div>
        <div class="amount" style="color:${isProfit ? '#16a34a' : '#dc2626'}">${isProfit ? '+' : ''}${fmt(profit)}</div>
      </div>
    `;
  }

  document.getElementById('fpDetailBody').innerHTML = body;
  openModal('fpDetailModal');
}

// ── Load into Form (Edit) ──────────────────────────────────────
async function loadFpIntoForm(id) {
  const fp = allFp.find(f => f.id === id);
  if (!fp) return;

  document.getElementById('editFpId').value       = id;
  document.getElementById('fpName').value         = fp.name || '';
  document.getElementById('fpDesc').value         = fp.description || '';
  document.getElementById('fpSellingPrice').value = fp.selling_price || '';
  document.getElementById('fpFormTitle').innerHTML = '<i class="fas fa-edit"></i> Edit: ' + esc(fp.name);

  // Clear lines
  document.getElementById('fpRecipeLines').innerHTML  = '';
  document.getElementById('fpProductLines').innerHTML = '';
  fpRecipeRows  = [];
  fpProductRows = [];

  let items = [];
  try {
    const data = await apiGet(`tables/${FP_ITEMS_TABLE}?page=1&limit=500`);
    items = (data.data || []).filter(i => i.finished_product_id === id);
  } catch (_) {}

  const recipeItems  = items.filter(i => i.item_type === 'recipe');
  const productItems = items.filter(i => i.item_type === 'product');

  if (recipeItems.length) {
    recipeItems.forEach(it => {
      const recipe = allRecipes_fp.find(r => r.id === it.ref_id);
      const yieldUnit = recipe?.yield_unit || 'kg';
      const cpu = recipe ? (recipe.total_cost || 0) / (recipe.servings || 1) : 0;
      addFpRecipeLine({
        ref_id:              it.ref_id,
        ref_name:            it.ref_name,
        quantity:            it.quantity,
        unit:                it.unit || yieldUnit,
        yield_unit:          yieldUnit,
        cost_per_yield_unit: cpu,
        line_cost:           it.line_cost,
        _manualUnit:         true,  // preserve saved unit — never auto-override
      });
    });
  } else {
    addFpRecipeLine();
  }

  if (productItems.length) {
    productItems.forEach(it => {
      const product = allProducts_fp.find(p => p.id === it.ref_id);
      addFpProductLine({
        ref_id:      it.ref_id,
        ref_name:    it.ref_name,
        quantity:    it.quantity,
        unit:        it.unit || 'kg',
        unit_cost:   product ? fp_costPerUnit(product) : (it.line_cost / (it.quantity || 1)),
        pack_unit:   product ? (product._packUnit || fp_packUnit(product)) : 'kg',
        _manualUnit: true,  // preserve saved unit — never auto-override
      });
    });
  } else {
    addFpProductLine();
  }

  recalcFpCosts();
  document.querySelector('.recipe-form-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Delete ─────────────────────────────────────────────────────
async function deleteFp(id) {
  if (!confirm('Delete this finished product? This cannot be undone.')) return;
  try {
    const data = await apiGet(`tables/${FP_ITEMS_TABLE}?page=1&limit=500`);
    const mine = (data.data || []).filter(i => i.finished_product_id === id);
    for (const it of mine) await apiDelete(`tables/${FP_ITEMS_TABLE}/${it.id}`);
    await apiDelete(`tables/${FP_TABLE}/${id}`);
    closeModal('fpDetailModal');
    showToast('Finished product deleted.', 'warning');
    await loadFinishedProducts();
    if (document.getElementById('editFpId').value === id) clearFpForm();
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

// ── Pack Run ───────────────────────────────────────────────────
let prFpId   = null;
let prFpData = null;
let prFpItems = [];

async function openPackRunModal(fpId) {
  const fp = allFp.find(f => f.id === fpId);
  if (!fp) return;

  prFpId   = fpId;
  prFpData = fp;

  // Fetch this finished product's items + refresh inventory snapshot
  try {
    const [itemsData, invData] = await Promise.all([
      apiGet(`tables/${FP_ITEMS_TABLE}?page=1&limit=500`),
      apiGet(`tables/inventory?page=1&limit=500`),
    ]);
    prFpItems       = (itemsData.data || []).filter(i => i.finished_product_id === fpId);
    allInventory_fp = invData.data || [];
  } catch (_) { prFpItems = []; }

  document.getElementById('prFpName').textContent = fp.name;
  document.getElementById('prUnits').value  = '';
  document.getElementById('prNote').value   = '';
  document.getElementById('prDeductionPreview').innerHTML = '';

  updatePrPreview();
  closeModal('fpDetailModal');
  openModal('packRunModal');
}

function updatePrPreview() {
  const container = document.getElementById('prDeductionPreview');
  const units     = parseInt(document.getElementById('prUnits').value) || 0;

  if (!units || !prFpItems.length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:.85rem">Enter unit count to see what will be deducted.</div>';
    return;
  }

  let html = '<div style="font-size:.82rem;font-weight:600;color:var(--text-muted);margin-bottom:.4rem">Stock deductions per ' + units + ' unit(s):</div>';
  html += '<div class="pb-deduction-list">';

  prFpItems.forEach(it => {
    const lineQty  = (parseFloat(it.quantity) || 0) * units;
    let deductQty  = lineQty;
    let displayUnit = it.unit || 'unit';

    if (it.item_type === 'recipe') {
      // Use the actual inventory row's unit — the batch may have been produced in a
      // different unit than the recipe's yield_unit (e.g. produced in 'g' vs yield 'kg').
      const invRow  = allInventory_fp.find(r => r.item_id === it.ref_id && r.item_type === 'batch');
      const invUnit = invRow?.unit || allRecipes_fp.find(r => r.id === it.ref_id)?.yield_unit || 'kg';
      const factor  = fp_conversionFactor(invUnit, it.unit || invUnit);
      deductQty     = lineQty * factor;
      displayUnit   = invUnit;
    } else {
      // Use actual inventory row's unit for raw materials as well.
      const invRow  = allInventory_fp.find(r => r.item_id === it.ref_id && r.item_type === 'raw_material');
      const prod    = allProducts_fp.find(p => p.id === it.ref_id);
      const invUnit = invRow?.unit || (prod ? (prod._packUnit || fp_packUnit(prod)) : (it.unit || 'Each'));
      const factor  = fp_conversionFactor(invUnit, it.unit || invUnit);
      deductQty     = lineQty * factor;
      displayUnit   = invUnit;
    }

    const display   = deductQty % 1 === 0 ? deductQty : deductQty.toFixed(3).replace(/\.?0+$/, '');
    const typeLabel = it.item_type === 'recipe' ? '🫙 Batch' : '📦 Product';
    html += `<div class="pb-deduction-row">
      <span><i class="fas fa-minus-circle" style="color:#dc2626"></i> ${esc(it.ref_name)} <span style="opacity:.6;font-size:.78rem">(${typeLabel})</span></span>
      <span style="font-weight:600">${display} ${esc(displayUnit)}</span>
    </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

async function confirmPackRun() {
  const units = parseInt(document.getElementById('prUnits').value);
  const note  = document.getElementById('prNote').value.trim();

  if (!units || units <= 0) { showToast('Enter a valid number of units.', 'error'); return; }
  if (!prFpData) return;

  const reason = note
    ? `Pack run: ${prFpData.name} × ${units} units — ${note}`
    : `Pack run: ${prFpData.name} × ${units} units`;

  const btn = document.getElementById('confirmPackRunBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing…';

  try {
    for (const it of prFpItems) {
      const lineQty = (parseFloat(it.quantity) || 0) * units; // total in the line's unit
      if (lineQty <= 0) continue;

      if (it.item_type === 'recipe') {
        // Use the actual inventory row's unit — the batch may have been produced in a
        // different unit than recipe.yield_unit (e.g. produced in 'g' vs yield 'kg').
        const invRow    = allInventory_fp.find(r => r.item_id === it.ref_id && r.item_type === 'batch');
        const recipe    = allRecipes_fp.find(r => r.id === it.ref_id);
        const invUnit   = invRow?.unit || recipe?.yield_unit || 'kg';
        const lineUnit  = it.unit || invUnit;
        const factor    = fp_conversionFactor(invUnit, lineUnit);
        const deductQty = lineQty * factor;

        await window.invHelpers.upsertInventory({
          itemId:   it.ref_id,
          itemType: 'batch',
          itemName: it.ref_name,
          category: 'Batch',
          unit:     invUnit,
          change:   -deductQty,
          reason,
        });
      } else {
        // Use actual inventory row's unit for raw materials.
        const invRow   = allInventory_fp.find(r => r.item_id === it.ref_id && r.item_type === 'raw_material');
        const prod     = allProducts_fp.find(p => p.id === it.ref_id);
        const invUnit  = invRow?.unit || (prod ? (prod._packUnit || fp_packUnit(prod)) : (it.unit || 'Each'));
        const lineUnit = it.unit || invUnit;
        const factor   = fp_conversionFactor(invUnit, lineUnit);
        const deductQty = lineQty * factor;

        await window.invHelpers.upsertInventory({
          itemId:   it.ref_id,
          itemType: 'raw_material',
          itemName: it.ref_name,
          category: prod?.category || 'Primary Packaging',
          unit:     invUnit,
          change:   -deductQty,
          reason,
        });
      }
    }

    // Add to Finished Product inventory
    await window.invHelpers.upsertInventory({
      itemId:   prFpId,
      itemType: 'finished_product',
      itemName: prFpData.name,
      category: 'Finished Product',
      unit:     'Each',
      change:   units,
      reason,
    });

    showToast(`Pack run recorded: ${units} × ${prFpData.name}`, 'success');
    closeModal('packRunModal');
  } catch (e) {
    showToast('Failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-box-open"></i> Confirm Pack Run';
  }
}
