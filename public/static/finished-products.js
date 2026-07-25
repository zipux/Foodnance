/* ===== finished-products.js ===== */

const FP_TABLE       = 'finished_products';
const FP_ITEMS_TABLE = 'finished_product_items';
const PROD_TABLE     = 'generic_products';   // two-level model
const ENTRIES_TABLE_FP = 'product_entries';  // supplier entries for FIFO
const REC_TABLE      = 'recipes';

let allProducts_fp  = [];   // product catalogue
let allRecipes_fp   = [];   // recipe catalogue
let allUnits_fp     = [];   // units table rows, sorted by sort_order (same set as product/recipe pages)
let allInventory_fp = [];   // inventory snapshot (refreshed on page load & pack-run open)
let fpRecipeRows    = [];   // [{ref_id, ref_name, quantity, unit, yield_unit, cost_per_yield_unit, line_cost}]
let fpProductRows   = [];   // [{ref_id, ref_name, quantity, unit, unit_cost, pack_unit}]
let allFp           = [];   // saved finished products
let currentFpDetailId = null;

// ── Bootstrap ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('fpName')) return;

  await Promise.all([loadFpCatalogues(), loadFinishedProducts(), loadFpUnits()]);

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
          avg_weight_per_unit: g.avg_weight_per_unit ?? null, pack_qty: 1,
          _cpu: 0, _packUnit: 'unit',
        };
      }

      // Find current inventory stock for this product
      const invRow = allInv.find(r => r.item_id === g.id && r.item_type === 'raw_material');
      const invQty = parseFloat(invRow?.quantity) || 0;

      // Inventory-aware FIFO: find the active batch layer. Converts purchases
      // into the unit the stock is counted in first — see fifoActiveEntryIn().
      const stockUnit = String(invRow?.unit || g.base_unit || '').trim();
      const avgWKg    = g.avg_weight_per_unit != null ? parseFloat(g.avg_weight_per_unit) : null;
      const activeEntry = fp_fifoActiveEntry(myEntries, invQty, stockUnit, avgWKg);

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
        avg_weight_per_unit: g.avg_weight_per_unit ?? null,
        pack_qty:      pQty,
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
 * Delegates to the shared implementation in utils.js (fifoActiveEntryIn), which
 * converts each purchase into the stocking unit before summing — this file used
 * to carry its own copy and had drifted from the others.
 */
function fp_fifoActiveEntry(sortedEntries, invQty, toUnit, avgWeightKg) {
  return fifoActiveEntryIn(sortedEntries, invQty, toUnit || '', avgWeightKg ?? null);
}

// ── Units (same DB-managed set as the product & recipe pages) ───
async function loadFpUnits() {
  try {
    const ud = await apiGet(`tables/units?page=1&limit=100`);
    allUnits_fp = (ud.data || []).slice().sort((a, b) => a.sort_order - b.sort_order);
  } catch (e) {
    console.error('Failed to load units', e);
  }
}

// Reload the line unit dropdowns after Manage Units changes, preserving selections.
registerUnitRefreshCallback(async () => {
  if (!document.getElementById('fpName')) return;
  await loadFpUnits();
  fpRecipeRows.forEach((row, idx) => {
    if (!row) return;
    const sel = document.getElementById(`fpr-unit-${idx}`);
    if (!sel) return;
    const cur = sel.value !== '__manage_units__' ? sel.value : (row.unit || '');
    sel.innerHTML = buildFpUnitOptions(cur, null);
    sel.dataset.prevUnit = sel.value;
  });
  fpProductRows.forEach((row, idx) => {
    if (!row) return;
    const sel = document.getElementById(`fpp-unit-${idx}`);
    if (!sel) return;
    const product = allProducts_fp.find(p => p.id === row.ref_id);
    const cur = sel.value !== '__manage_units__' ? sel.value : (row.unit || '');
    sel.innerHTML = buildFpUnitOptions(cur, product);
    sel.dataset.prevUnit = sel.value;
  });
});

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
// 'oz' is the WEIGHT ounce (28.35 g); fluid ounces are the separate 'fl oz' unit.
const _FP_WEIGHT_KG = { kg: 1, g: 0.001, lb: 0.453592, oz: 0.0283495231 };
const _FP_VOLUME_ML = { l: 1000, ml: 1, 'fl oz': 29.5735296 };
function _fpIsEach(u) { return u === 'each' || u === 'ea' || u === 'unit'; }

// Dimension of a unit for compatibility checks: 'weight' | 'volume' | 'each' | 'other'.
function _fpUnitDim(u) {
  const x = (u || '').toLowerCase().trim();
  if (_FP_WEIGHT_KG[x] != null) return 'weight';   // kg, g, lb, oz
  if (_FP_VOLUME_ML[x] != null) return 'volume';   // L, ml, fl oz
  if (_fpIsEach(x)) return 'each';
  return 'other';   // case, sub-unit, or anything unrecognised
}

// Can `fromU` be expressed in `toU` at all? Same dimension converts; weight↔each
// bridges via a product's average weight — allowed only when `allowEachWeight`
// (product lines), never for recipe lines (a recipe has no average weight). The
// bridge is still flagged uncostable if the weight is missing (see the converter),
// not blocked here. Volume never crosses; 'other'/'case' only matches itself.
function _fpUnitsCompatible(fromU, toU, allowEachWeight) {
  const a = _fpUnitDim(fromU), b = _fpUnitDim(toU);
  if (a === 'other' || b === 'other') {
    return (fromU || '').toLowerCase().trim() === (toU || '').toLowerCase().trim();
  }
  if (a === b) return true;
  if ((a === 'weight' && b === 'each') || (a === 'each' && b === 'weight')) return !!allowEachWeight;
  return false;
}

// Conversion factor from `fromU` to `toU`, or null when the two units can't be
// bridged (e.g. a recipe yielding L used by kg, each↔volume, or each↔weight with
// no average weight). Never a silent factor of 1 — callers treat null as "can't
// cost this line" and flag it instead of multiplying by a wrong number.
function fp_conversionFactor(fromU, toU, avgWeightKg) {
  const pu = (fromU || '').toLowerCase().trim();
  const ru = (toU   || '').toLowerCase().trim();
  if (pu === ru) return 1;
  // Weight ↔ weight (kg, g, lb, oz)
  if (_FP_WEIGHT_KG[pu] != null && _FP_WEIGHT_KG[ru] != null) return _FP_WEIGHT_KG[ru] / _FP_WEIGHT_KG[pu];
  // Volume ↔ volume (L, ml, fl oz)
  if (_FP_VOLUME_ML[pu] != null && _FP_VOLUME_ML[ru] != null) return _FP_VOLUME_ML[ru] / _FP_VOLUME_ML[pu];
  // Each ↔ weight, via the product's average weight per each (product lines only)
  if (_fpIsEach(pu) && _FP_WEIGHT_KG[ru] != null) {
    if (!avgWeightKg || avgWeightKg <= 0) return null;
    return _FP_WEIGHT_KG[ru] / avgWeightKg;
  }
  if (_FP_WEIGHT_KG[pu] != null && _fpIsEach(ru)) {
    if (!avgWeightKg || avgWeightKg <= 0) return null;
    return avgWeightKg / _FP_WEIGHT_KG[pu];
  }
  return null;   // no bridge between these units
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

  // Type-to-search picker (mirrors the Recipes tab): a text input to filter by,
  // a hidden field holding the chosen recipe id, and a suggestions dropdown.
  const prefillName = row.ref_id
    ? esc((allRecipes_fp.find(r => r.id === row.ref_id) || {}).name || row.ref_name || '')
    : '';

  div.innerHTML = `
    <div class="form-group" style="position:relative">
      ${idx === 0 ? '<label>Recipe</label>' : '<label>&nbsp;</label>'}
      <input type="text" id="fpr-input-${idx}" value="${prefillName}" placeholder="Search or pick a recipe…" autocomplete="off"
             oninput="onFpPickerSearch('recipe', ${idx})" onfocus="onFpPickerFocus('recipe', ${idx})"
             onkeydown="onFpPickerKeydown('recipe', ${idx}, event)" onblur="hideFpPickerSuggestions('recipe', ${idx})" />
      <input type="hidden" id="fpr-sel-${idx}" value="${esc(row.ref_id || '')}" />
      <div id="fpr-suggestions-${idx}" class="product-suggestions" onmousedown="event.preventDefault()"></div>
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
      <span id="fpr-cpu-${idx}" style="font-size:.72rem;color:var(--text-muted);margin-top:.15rem;display:block;min-height:.9rem"></span>
    </div>
    <div>
      ${idx === 0 ? '<label style="font-size:.72rem;font-weight:600;color:transparent">x</label>' : ''}
      <button class="btn btn-danger btn-icon" onclick="removeFpRecipeLine(${idx})" title="Remove"><i class="fas fa-times"></i></button>
    </div>
  `;
  container.appendChild(div);
  const unitSelInit = document.getElementById(`fpr-unit-${idx}`);
  if (unitSelInit) unitSelInit.dataset.prevUnit = unitSelInit.value;
  if (row.ref_id) onFpRecipeChange(idx);
}

function onFpRecipeChange(idx) {
  const hidden    = document.getElementById(`fpr-sel-${idx}`);
  const refId     = hidden ? hidden.value : '';
  const r         = allRecipes_fp.find(x => x.id === refId) || null;
  const totalCost = parseFloat(r?.total_cost || 0);
  const yieldQty  = parseFloat(r?.servings   || 1);
  const yieldUnit = r?.yield_unit || 'kg';

  fpRecipeRows[idx].ref_id              = refId;
  fpRecipeRows[idx].ref_name            = r?.name || '';
  fpRecipeRows[idx].cost_per_yield_unit = yieldQty > 0 ? totalCost / yieldQty : totalCost;
  fpRecipeRows[idx].yield_unit          = yieldUnit;

  // Auto-set unit to recipe's yield unit — unless user already manually locked it
  if (!fpRecipeRows[idx]._manualUnit) {
    fpRecipeRows[idx].unit = yieldUnit;
    const unitSel = document.getElementById(`fpr-unit-${idx}`);
    if (unitSel) {
      unitSel.innerHTML = buildFpUnitOptions(yieldUnit, null);
      unitSel.dataset.prevUnit = unitSel.value;
    }
  }

  onFpRecipeQtyChange(idx);
  _updateFpRecipeCostDisplay(idx);
}

// Cost per chosen unit, shown under the Unit dropdown (mirrors the recipe tab's
// per-ingredient cost line). Blank until a recipe is selected.
function _updateFpRecipeCostDisplay(idx) {
  const el = document.getElementById(`fpr-cpu-${idx}`);
  if (!el) return;
  const r = fpRecipeRows[idx];
  if (!r || !r.ref_id) { el.textContent = ''; return; }
  const unit   = r.unit || r.yield_unit || 'kg';
  const factor = fp_conversionFactor(r.yield_unit || 'kg', unit);
  if (factor === null) {
    el.innerHTML = `<span style="color:#dc2626" title="Can't convert ${esc(r.yield_unit || 'kg')} to ${esc(unit)}"><i class="fas fa-triangle-exclamation"></i> can't convert</span>`;
    return;
  }
  el.textContent = `${fmt((r.cost_per_yield_unit || 0) * factor)} / ${unit}`;
}

function onFpRecipeQtyChange(idx) {
  const qty = parseFloat(document.getElementById(`fpr-qty-${idx}`)?.value) || 0;
  fpRecipeRows[idx].quantity  = qty;
  fpRecipeRows[idx].line_cost = calcFpRecipeLineCost(idx);
  recalcFpCosts();
}

function onFpRecipeUnitChange(idx) {
  const sel = document.getElementById(`fpr-unit-${idx}`);
  if (sel && sel.value === '__manage_units__') {
    sel.value = sel.dataset.prevUnit || fpRecipeRows[idx]?.unit || '';
    openManageUnitsModal();
    return;
  }
  const newUnit  = sel?.value || 'kg';
  const prevUnit = sel?.dataset.prevUnit || fpRecipeRows[idx]?.unit || '';
  const yieldU   = fpRecipeRows[idx]?.yield_unit || 'kg';
  // A recipe carries no average weight, so it can only be measured in its yield
  // dimension. Block a switch the converter can't perform (e.g. a Puree recipe
  // that yields L can't be used by kg).
  if (newUnit !== prevUnit && !_fpUnitsCompatible(yieldU, newUnit, false)) {
    if (sel) sel.value = prevUnit;
    showToast(`Cannot convert ${yieldU} to ${newUnit} — unit reset.`, 'warning');
    return;
  }
  fpRecipeRows[idx].unit        = newUnit;
  fpRecipeRows[idx]._manualUnit = true; // user explicitly chose — lock it
  fpRecipeRows[idx].line_cost   = calcFpRecipeLineCost(idx);
  if (sel) sel.dataset.prevUnit = newUnit;
  _updateFpRecipeCostDisplay(idx);
  recalcFpCosts();
}

// Cost = cost_per_yield_unit × quantity × conversion(yieldUnit → chosenUnit).
// Returns null when the units can't be bridged (uncostable — excluded from total).
function calcFpRecipeLineCost(idx) {
  const r      = fpRecipeRows[idx];
  if (!r || !r.ref_id) return 0;
  const factor = fp_conversionFactor(r.yield_unit || 'kg', r.unit || 'kg');
  if (factor === null) return null;
  return (r.cost_per_yield_unit || 0) * (r.quantity || 0) * factor;
}

function removeFpRecipeLine(idx) {
  document.getElementById(`fpr-${idx}`)?.remove();
  fpRecipeRows[idx] = null;
  recalcFpCosts();
}

// ── Product / Packaging Lines ──────────────────────────────────
// Build unit dropdown options — case-insensitive match, sub-unit at top if defined.
// Uses the DB-managed `units` table (same set as the product & recipe pages),
// with a fallback list if units haven't loaded yet.
function buildFpUnitOptions(selectedUnit, product) {
  const su   = product?.sub_unit_name || '';
  const seen = new Set();
  const stdRaw = allUnits_fp.length
    ? allUnits_fp.map(u => u.name)
    : ['kg','g','lb','ml','L','each','case'];
  const std = stdRaw.filter(name => {
    const key = (name || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const sel = (selectedUnit || '').toLowerCase();
  let html  = '';
  if (su) {
    const isSel = sel === su.toLowerCase() ? 'selected' : '';
    html += `<option value="${esc(su)}" ${isSel} style="font-weight:700;color:#4f46e5">${esc(su)} ← sub-unit</option>`;
  }
  html += std.map(u => {
    const isSel = sel === u.toLowerCase() ? 'selected' : '';
    return `<option value="${esc(u)}" ${isSel}>${esc(u)}</option>`;
  }).join('');
  html += '<option value="__manage_units__" style="color:var(--primary);font-style:italic">+ Manage units</option>';
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

  // Type-to-search picker (mirrors the Recipes tab). The line's current product
  // is shown in the input text, so archived products are simply not offered in
  // the suggestion list without losing an existing selection.
  const prefillName = row.ref_id
    ? esc((allProducts_fp.find(p => p.id === row.ref_id) || {}).name || row.ref_name || '')
    : '';

  div.innerHTML = `
    <div class="form-group" style="position:relative">
      ${idx === 0 ? '<label>Product</label>' : '<label>&nbsp;</label>'}
      <input type="text" id="fpp-input-${idx}" value="${prefillName}" placeholder="Search or pick a product…" autocomplete="off"
             oninput="onFpPickerSearch('product', ${idx})" onfocus="onFpPickerFocus('product', ${idx})"
             onkeydown="onFpPickerKeydown('product', ${idx}, event)" onblur="hideFpPickerSuggestions('product', ${idx})" />
      <input type="hidden" id="fpp-sel-${idx}" value="${esc(row.ref_id || '')}" />
      <div id="fpp-suggestions-${idx}" class="product-suggestions" onmousedown="event.preventDefault()"></div>
    </div>
    <div class="form-group">
      ${idx === 0 ? '<label>Qty</label>' : '<label>&nbsp;</label>'}
      <input type="number" id="fpp-qty-${idx}" value="${row.quantity}" min="0.01" step="0.01" oninput="onFpProductQtyChange(${idx})" />
    </div>
    <div class="form-group unit-group">
      ${idx === 0 ? '<label>Unit</label>' : '<label>&nbsp;</label>'}
      <select id="fpp-unit-${idx}" onchange="onFpProductUnitChange(${idx})">
        ${buildFpUnitOptions(row.unit, allProducts_fp.find(p => p.id === row.ref_id))}
      </select>
      <span id="fpp-cpu-${idx}" style="font-size:.72rem;color:var(--text-muted);margin-top:.15rem;display:block;min-height:.9rem"></span>
    </div>
    <div>
      ${idx === 0 ? '<label style="font-size:.72rem;font-weight:600;color:transparent">x</label>' : ''}
      <button class="btn btn-danger btn-icon" onclick="removeFpProductLine(${idx})" title="Remove"><i class="fas fa-times"></i></button>
    </div>
  `;
  container.appendChild(div);
  const unitSelInit = document.getElementById(`fpp-unit-${idx}`);
  if (unitSelInit) unitSelInit.dataset.prevUnit = unitSelInit.value;
  if (row.ref_id) onFpProductChange(idx);
}

function onFpProductChange(idx) {
  const hidden      = document.getElementById(`fpp-sel-${idx}`);
  const refId       = hidden ? hidden.value : '';
  const product     = allProducts_fp.find(p => p.id === refId) || null;
  const pu          = product ? (product._packUnit || fp_packUnit(product)) : 'kg';
  const subUnitName = product?.sub_unit_name || '';

  fpProductRows[idx].ref_id    = refId;
  fpProductRows[idx].ref_name  = product?.name || '';
  fpProductRows[idx].unit_cost = product ? fp_costPerUnit(product) : 0;
  fpProductRows[idx].pack_unit = pu;
  // Extra facts needed for costing (mirrors the Recipes page): the sub-unit
  // breakdown, the pack size, and the average weight that bridges each↔weight.
  fpProductRows[idx].sub_unit_name = subUnitName;
  fpProductRows[idx].sub_unit_qty  = product?.sub_unit_qty || 0;
  fpProductRows[idx].pack_qty      = product?.pack_qty || 1;
  fpProductRows[idx].avg_weight    = product?.avg_weight_per_unit != null ? parseFloat(product.avg_weight_per_unit) : null;

  // Auto-set unit: sub-unit first, then pack unit — unless user manually locked it
  if (!fpProductRows[idx]._manualUnit) {
    const defaultUnit = subUnitName ? subUnitName : (pu || 'kg');
    fpProductRows[idx].unit = defaultUnit;
  }

  // Rebuild unit dropdown with correct default selected
  const unitSel = document.getElementById(`fpp-unit-${idx}`);
  if (unitSel) {
    unitSel.innerHTML = buildFpUnitOptions(fpProductRows[idx].unit, product);
    unitSel.dataset.prevUnit = unitSel.value;
  }

  onFpProductQtyChange(idx);
  _updateFpProductCostDisplay(idx);
}

// Cost per chosen unit, shown under the Unit dropdown (mirrors the recipe tab).
function _updateFpProductCostDisplay(idx) {
  const el = document.getElementById(`fpp-cpu-${idx}`);
  if (!el) return;
  const r = fpProductRows[idx];
  if (!r || !r.ref_id) { el.textContent = ''; return; }
  const unit    = r.unit || r.pack_unit || 'kg';
  const subName = (r.sub_unit_name || '');
  const subQty  = parseFloat(r.sub_unit_qty || 0);
  let rate;
  // Sub-unit path (e.g. priced per pack, used by 'can'): cost per sub-unit.
  if (subName && subQty > 0 && unit.toLowerCase() === subName.toLowerCase()) {
    const pQty = parseFloat(r.pack_qty || 0) || 1;
    rate = (r.unit_cost || 0) * pQty / subQty;
  } else {
    const factor = fp_conversionFactor(r.pack_unit || 'kg', unit, r.avg_weight);
    rate = factor === null ? null : (r.unit_cost || 0) * factor;
  }
  if (rate === null) {
    const eachWt = (_fpUnitDim(r.pack_unit) === 'each' && _fpUnitDim(unit) === 'weight') ||
                   (_fpUnitDim(r.pack_unit) === 'weight' && _fpUnitDim(unit) === 'each');
    const label  = eachWt ? 'set avg. weight' : "can't convert";
    const tip    = eachWt ? `Set an Average Weight on this product to use it by ${esc(unit)}` : `Can't convert ${esc(r.pack_unit || 'kg')} to ${esc(unit)}`;
    el.innerHTML = `<span style="color:#dc2626" title="${tip}"><i class="fas fa-triangle-exclamation"></i> ${label}</span>`;
    return;
  }
  el.textContent = `${fmt(rate)} / ${unit}`;
}

// Dollar cost of one product line: sub-unit path first, else avg-weight-aware
// unit conversion. Returns null when the units can't be bridged (uncostable).
function calcFpProductLineCost(r) {
  if (!r || !r.ref_id) return 0;
  const unit    = (r.unit || r.pack_unit || 'kg');
  const subName = (r.sub_unit_name || '');
  const subQty  = parseFloat(r.sub_unit_qty || 0);
  const qty     = (r.quantity || 0);
  if (subName && subQty > 0 && unit.toLowerCase() === subName.toLowerCase()) {
    const pQty = parseFloat(r.pack_qty || 0) || 1;
    return (r.unit_cost || 0) * pQty / subQty * qty;
  }
  const factor = fp_conversionFactor(r.pack_unit || 'kg', unit, r.avg_weight);
  if (factor === null) return null;
  return (r.unit_cost || 0) * factor * qty;
}

function onFpProductQtyChange(idx) {
  const qty = parseFloat(document.getElementById(`fpp-qty-${idx}`)?.value) || 0;
  fpProductRows[idx].quantity = qty;
  recalcFpCosts();
}

function onFpProductUnitChange(idx) {
  const sel = document.getElementById(`fpp-unit-${idx}`);
  if (sel && sel.value === '__manage_units__') {
    sel.value = sel.dataset.prevUnit || fpProductRows[idx]?.unit || '';
    openManageUnitsModal();
    return;
  }
  const newUnit  = sel?.value || 'kg';
  const prevUnit = sel?.dataset.prevUnit || fpProductRows[idx]?.unit || '';
  const packU    = fpProductRows[idx]?.pack_unit || 'kg';
  const subName  = (fpProductRows[idx]?.sub_unit_name || '').toLowerCase().trim();
  const isSub    = subName && newUnit.toLowerCase().trim() === subName;
  // Product lines bridge each↔weight via the product's average weight (flagged
  // uncostable if it's missing, not blocked); the product's own sub-unit is
  // costed directly. Block only genuinely incompatible switches (e.g. kg↔L).
  if (newUnit !== prevUnit && !isSub && !_fpUnitsCompatible(packU, newUnit, true)) {
    if (sel) sel.value = prevUnit;
    showToast(`Cannot convert ${packU} to ${newUnit} — unit reset.`, 'warning');
    return;
  }
  fpProductRows[idx].unit        = newUnit;
  fpProductRows[idx]._manualUnit = true; // user explicitly chose — lock it
  if (sel) sel.dataset.prevUnit = newUnit;
  _updateFpProductCostDisplay(idx);
  recalcFpCosts();
}

function removeFpProductLine(idx) {
  document.getElementById(`fpp-${idx}`)?.remove();
  fpProductRows[idx] = null;
  recalcFpCosts();
}

// ── Type-to-search pickers (recipe & product lines) ────────────
// One shared typeahead for both line kinds, modeled on the Recipes tab's
// ingredient picker. `kind` is 'recipe' | 'product'. Each line has a text input
// (#<pre>-input-<idx>), a hidden id field (#<pre>-sel-<idx>) that the change
// handler reads, and a suggestions box (#<pre>-suggestions-<idx>).
let _fpPickerItems  = [];   // [{id}] in display order — for keyboard nav
let _fpPickerActive = -1;   // highlighted index into _fpPickerItems

function _fpPickerCfg(kind) {
  return kind === 'recipe'
    ? { pre: 'fpr', noun: 'recipe',  onChange: onFpRecipeChange,
        list: () => allRecipes_fp.filter(r => !r.deleted_at),
        all:  () => allRecipes_fp }
    : { pre: 'fpp', noun: 'product', onChange: onFpProductChange,
        list: () => allProducts_fp.filter(p => !p.deleted_at),
        all:  () => allProducts_fp };
}

function onFpPickerFocus(kind, idx) {
  const cfg = _fpPickerCfg(kind);
  const input = document.getElementById(`${cfg.pre}-input-${idx}`);
  renderFpSuggestions(kind, idx, input ? input.value : '');
}

function onFpPickerSearch(kind, idx) {
  const cfg    = _fpPickerCfg(kind);
  const input  = document.getElementById(`${cfg.pre}-input-${idx}`);
  const hidden = document.getElementById(`${cfg.pre}-sel-${idx}`);
  const hadSelection = hidden && hidden.value;
  if (hidden) hidden.value = '';   // typing invalidates any prior selection
  // Emptying the field clears the line so its cost stops counting toward the total.
  if (hadSelection && !(input && input.value.trim())) cfg.onChange(idx);
  renderFpSuggestions(kind, idx, input ? input.value : '');
}

function renderFpSuggestions(kind, idx, rawQuery) {
  const cfg = _fpPickerCfg(kind);
  const box = document.getElementById(`${cfg.pre}-suggestions-${idx}`);
  if (!box) return;
  const q   = (rawQuery || '').trim();
  const ql  = q.toLowerCase();
  const all = cfg.list();
  _fpPickerItems = [];
  _fpPickerActive = -1;

  if (!all.length) {
    box.innerHTML = `<div class="product-suggestion-empty">No ${cfg.noun}s yet.</div>`;
    box.style.display = 'block';
    return;
  }

  // Empty query → browse A→Z; otherwise prefix matches first, then A→Z.
  const list = !ql
    ? all.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    : all.filter(x => (x.name || '').toLowerCase().includes(ql))
         .sort((a, b) => {
           const ap = (a.name || '').toLowerCase().startsWith(ql) ? 0 : 1;
           const bp = (b.name || '').toLowerCase().startsWith(ql) ? 0 : 1;
           return ap - bp || (a.name || '').localeCompare(b.name || '');
         });

  let html = '';
  if (!list.length) html += `<div class="product-suggestion-empty">No ${cfg.noun}s match “${esc(q)}”.</div>`;
  for (const it of list) {
    const n = _fpPickerItems.length;
    _fpPickerItems.push({ id: it.id });
    const sub = (kind === 'product' && it.category) ? `<span class="psi-sub">${esc(it.category)}</span>` : '';
    html += `<div class="product-suggestion-item" data-n="${n}" onmousedown="selectFpItem('${kind}', ${idx}, '${esc(it.id)}')">
      <span>${esc(it.name)}</span>${sub}</div>`;
  }
  box.innerHTML = html;
  box.style.display = 'block';
  _applyFpHighlight(box);
}

function _applyFpHighlight(box) {
  box.querySelectorAll('.product-suggestion-item').forEach(el => {
    const on = Number(el.dataset.n) === _fpPickerActive;
    el.classList.toggle('active', on);
    if (on) el.scrollIntoView({ block: 'nearest' });
  });
}

// Keyboard: ↑/↓ move highlight, Enter picks, Esc closes.
function onFpPickerKeydown(kind, idx, e) {
  const cfg  = _fpPickerCfg(kind);
  const box  = document.getElementById(`${cfg.pre}-suggestions-${idx}`);
  const open = box && box.style.display !== 'none' && _fpPickerItems.length;
  if (!open) {
    if (e.key === 'ArrowDown') { e.preventDefault(); onFpPickerFocus(kind, idx); }
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault(); _fpPickerActive = Math.min(_fpPickerItems.length - 1, _fpPickerActive + 1); _applyFpHighlight(box);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault(); _fpPickerActive = Math.max(0, _fpPickerActive - 1); _applyFpHighlight(box);
  } else if (e.key === 'Enter') {
    if (_fpPickerActive >= 0 && _fpPickerActive < _fpPickerItems.length) {
      e.preventDefault();
      selectFpItem(kind, idx, _fpPickerItems[_fpPickerActive].id);
    }
  } else if (e.key === 'Escape') {
    box.style.display = 'none';
  }
}

function selectFpItem(kind, idx, id) {
  const cfg  = _fpPickerCfg(kind);
  const item = cfg.all().find(x => x.id === id);
  if (!item) return;
  const input  = document.getElementById(`${cfg.pre}-input-${idx}`);
  const hidden = document.getElementById(`${cfg.pre}-sel-${idx}`);
  const box    = document.getElementById(`${cfg.pre}-suggestions-${idx}`);
  if (input)  input.value  = item.name;
  if (hidden) hidden.value = id;
  if (box)    box.style.display = 'none';
  cfg.onChange(idx);
}

function hideFpPickerSuggestions(kind, idx) {
  const cfg = _fpPickerCfg(kind);
  const box = document.getElementById(`${cfg.pre}-suggestions-${idx}`);
  if (box) box.style.display = 'none';
}

// ── Cost Recalc ────────────────────────────────────────────────
function recalcFpCosts() {
  let total = 0;
  let anyUncostable = false;   // a line whose units can't be bridged (⚠ on the total)

  // Sum recipe costs (quantity × cost_per_yield_unit × unit conversion)
  fpRecipeRows.filter(r => r && r.ref_id).forEach(r => {
    const factor = fp_conversionFactor(r.yield_unit || 'kg', r.unit || 'kg');
    if (factor === null) { anyUncostable = true; return; }
    total += (r.cost_per_yield_unit || 0) * (r.quantity || 0) * factor;
  });

  // Sum product costs (sub-unit / avg-weight aware)
  fpProductRows.filter(r => r && r.ref_id).forEach(r => {
    const c = calcFpProductLineCost(r);
    if (c === null) { anyUncostable = true; return; }
    total += c;
  });

  window._fpAnyUncostable = anyUncostable;   // read by the total-cost display below
  const selling = parseFloat(document.getElementById('fpSellingPrice').value) || 0;
  const profit  = selling - total;
  const margin  = selling > 0 ? (profit / selling) * 100 : null;

  document.getElementById('fpTotalCostDisplay').textContent = fmt(total) + (window._fpAnyUncostable ? ' ⚠' : '');

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

    // Save product items (sub-unit / avg-weight aware; uncostable → 0)
    for (const r of activeProducts) {
      await apiPost(`tables/${FP_ITEMS_TABLE}`, {
        finished_product_id: fpId,
        item_type:  'product',
        ref_id:     r.ref_id,
        ref_name:   r.ref_name,
        quantity:   r.quantity,
        unit:       r.unit,
        line_cost:  calcFpProductLineCost(r) || 0,
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
      const factor  = fp_conversionFactor(invUnit, it.unit || invUnit) ?? 1;   // keep prior behaviour for incompatible units
      deductQty     = lineQty * factor;
      displayUnit   = invUnit;
    } else {
      // Use actual inventory row's unit for raw materials as well.
      const invRow  = allInventory_fp.find(r => r.item_id === it.ref_id && r.item_type === 'raw_material');
      const prod    = allProducts_fp.find(p => p.id === it.ref_id);
      const invUnit = invRow?.unit || (prod ? (prod._packUnit || fp_packUnit(prod)) : (it.unit || 'Each'));
      const avgW    = prod?.avg_weight_per_unit != null ? parseFloat(prod.avg_weight_per_unit) : null;
      const factor  = fp_conversionFactor(invUnit, it.unit || invUnit, avgW) ?? 1;   // avg-weight aware; prior behaviour for incompatible units
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
        const factor    = fp_conversionFactor(invUnit, lineUnit) ?? 1;   // keep prior behaviour for incompatible units
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
        const avgW     = prod?.avg_weight_per_unit != null ? parseFloat(prod.avg_weight_per_unit) : null;
        const factor   = fp_conversionFactor(invUnit, lineUnit, avgW) ?? 1;   // avg-weight aware; prior behaviour for incompatible units
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
