/* ===== recipes.js ===== */

const RECIPES_TABLE      = 'recipes';
const RECIPE_ITEMS_TABLE = 'recipe_items';
const PRODUCTS_TABLE_R   = 'generic_products';  // two-level model

let allProducts    = [];      // product catalogue
let ingredientRows = [];      // [{product_id, product_name, quantity, unit, unit_cost}]
let allRecipes     = [];      // full recipe list
let currentDetailId = null;
let allUnits_r     = [];      // units table rows, sorted by sort_order
// Live cost per recipe, derived from current invoice prices rather than the
// stored recipes.total_cost snapshot. The detail modal already recalculated on
// open; this gives the list the same treatment, so a supplier price rise moves
// every card without anyone re-saving a recipe.
let _rCatalogue    = { generics: [], entries: [], inventory: [], recipeItems: [] };
let rCostIndex     = { product: new Map(), recipe: new Map(), finished: new Map() };

function rebuildRecipeCostIndex() {
  rCostIndex = buildLiveCostIndex({
    ..._rCatalogue, recipes: allRecipes, plan: window.__accountPlan || '',
  });
  // The catalogue and the recipe list load CONCURRENTLY, and the list wins the
  // race — one fetch against four. Its first render therefore comes off a
  // half-built index and prints $0 for everything. Repaint here so whichever
  // loader finishes second redraws with the completed index. Without this the
  // list stays at $0 while the detail modal, which recalculates on open, shows
  // the right number — the two disagreeing is what gives the bug away.
  if (allRecipes.length && document.getElementById('recipeListContainer')) {
    renderRecipeList(document.getElementById('recipeSearch')?.value.trim() || '');
  }
}
// Re-read the bills of materials.
//
// rebuildRecipeCostIndex() derives every recipe's cost from
// _rCatalogue.recipeItems, and that array is otherwise only filled by
// loadProductCatalogue() at page load. Saving a recipe writes its recipe_items
// rows on the server but leaves the array untouched, so the rebuilt index sees
// a recipe with NO ingredients and prints $0 — which is why the number only
// appeared after a reload. Anything that changes recipe_items has to call this
// before loadRecipes().
//
// On failure the previous items are kept rather than cleared: a stale cost is
// wrong by however much the edit changed, while an empty array would reprice
// every recipe on the page to $0.
async function refreshRecipeItems() {
  try {
    const rid = await apiGet(`tables/${RECIPE_ITEMS_TABLE}?page=1&limit=1000`);
    _rCatalogue = { ..._rCatalogue, recipeItems: rid.data || [] };
  } catch (_) { /* keep the last good items */ }
}

// Live total for a saved recipe; the stored column is a last resort only while
// the catalogue is still loading.
function recipeLiveCost(r) {
  const c = rCostIndex.recipe.get(r?.id);
  return c ? c.total_cost : (parseFloat(r?.total_cost) || 0);
}

// ── Bootstrap ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('recipeName')) return; // guard

  // Registered before the loads, not after: the plan arrives from /api/auth/me
  // on its own schedule and decides the costing basis. A listener added after
  // the awaits would miss an event that fired during them.
  window.addEventListener('dm:plan-known', () => rebuildRecipeCostIndex());

  await Promise.all([loadProductCatalogue(), loadRecipes(), loadUnits()]);

  document.getElementById('addIngredientBtn').addEventListener('click', () => addIngredientLine());
  document.getElementById('quickAddToggle').addEventListener('click', toggleQuickAdd);
  document.getElementById('quickAddParseBtn').addEventListener('click', quickAddParse);
  document.getElementById('saveRecipeBtn').addEventListener('click', saveRecipe);
  document.getElementById('clearRecipeBtn').addEventListener('click', clearRecipeForm);
  document.getElementById('recipeYieldQty').addEventListener('input',  recalcCosts);
  document.getElementById('recipeProductionMode').addEventListener('change', updateProductionModeHint);
  document.getElementById('recipeYieldUnit').addEventListener('change', e => {
    if (e.target.value === '__manage_units__') {
      e.target.value = e.target.dataset.prevUnit || '';
      openManageUnitsModal();
      return;
    }
    e.target.dataset.prevUnit = e.target.value;
    recalcCosts();
  });
  document.getElementById('recipeSearch').addEventListener('input', e => {
    renderRecipeList(e.target.value.trim());
  });

  // Detail modal
  document.getElementById('closeDetailModal').addEventListener('click', () => closeModal('recipeDetailModal'));
  document.getElementById('closeDetailBtn').addEventListener('click',   () => closeModal('recipeDetailModal'));
  document.getElementById('recipeDetailModal').addEventListener('click', e => {
    if (e.target === document.getElementById('recipeDetailModal')) closeModal('recipeDetailModal');
  });
  document.getElementById('editFromDetailBtn').addEventListener('click', () => {
    closeModal('recipeDetailModal');
    loadRecipeIntoForm(currentDetailId);
  });
  document.getElementById('deleteFromDetailBtn').addEventListener('click', () => deleteRecipe(currentDetailId));
  document.getElementById('produceBatchBtn').addEventListener('click', () => openProduceBatchModal(currentDetailId));
  document.getElementById('printRecipeBtn').addEventListener('click', () => printRecipe(currentDetailId));

  // Produce Batch modal
  document.getElementById('closeProduceBatchModal').addEventListener('click',  () => closeModal('produceBatchModal'));
  document.getElementById('cancelProduceBatchModal').addEventListener('click', () => closeModal('produceBatchModal'));
  document.getElementById('produceBatchModal').addEventListener('click', e => {
    if (e.target === document.getElementById('produceBatchModal')) closeModal('produceBatchModal');
  });
  document.getElementById('confirmProduceBatchBtn').addEventListener('click', confirmProduceBatch);
  document.getElementById('pbQty').addEventListener('input',   updatePbPreview);
  document.getElementById('pbUnit').addEventListener('change', e => {
    if (e.target.value === '__manage_units__') {
      e.target.value = e.target.dataset.prevUnit || '';
      openManageUnitsModal();
      return;
    }
    e.target.dataset.prevUnit = e.target.value;
    updatePbPreview();
  });

  // Start with one ingredient line
  addIngredientLine();
});

// ── Units loading ─────────────────────────────────────────────
async function loadUnits() {
  try {
    const ud = await apiGet(`tables/units?page=1&limit=100`);
    allUnits_r = (ud.data || []).slice().sort((a, b) => a.sort_order - b.sort_order);
    populateUnitDropdown_r(document.getElementById('recipeYieldUnit'));
    populateUnitDropdown_r(document.getElementById('pbUnit'));
  } catch (e) {
    console.error('Failed to load units', e);
  }
}

function populateUnitDropdown_r(select, selectedValue) {
  if (!select) return;
  const prev = selectedValue !== undefined ? selectedValue : select.value;
  const seen = new Set();
  const uniqueUnits = allUnits_r.filter(u => {
    const key = (u.name || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  select.innerHTML = uniqueUnits
    .map(u => `<option value="${u.name}">${u.name}</option>`)
    .join('') +
    '<option value="__manage_units__" style="color:var(--primary);font-style:italic">+ Manage units</option>';
  setSelectValueCI_r(select, prev);
  select.dataset.prevUnit = select.value;
}

function setSelectValueCI_r(select, value) {
  if (!value) return;
  const lower = value.toLowerCase();
  const opt = Array.from(select.options).find(o => o.value.toLowerCase() === lower);
  if (opt) select.value = opt.value;
}

// ── Unit helpers ──────────────────────────────────────────────
// All three defer to entryPackFacts() in utils.js, shared with finished-products.js.
function packQty(p)  { return entryPackFacts(p).pack_qty; }
function packUnit(p) { return entryPackFacts(p).pack_unit; }
// Cost per single base unit (e.g. per kg, per L)
function costPerUnit(p) { return entryPackFacts(p).cost_per_unit; }

// kg-equivalent of one weight unit (used for all weight ↔ weight math). 'oz' is
// the WEIGHT ounce (28.35 g); fluid ounces are the separate 'fl oz' volume unit.
const _WEIGHT_KG = { kg: 1, g: 0.001, lb: 0.453592, oz: 0.0283495231 };
// ml-equivalent of one volume unit (used for all volume ↔ volume math).
const _VOLUME_ML = { l: 1000, ml: 1, 'fl oz': 29.5735296 };
// Treat these pack units as a discrete "each"/count
function _isEachUnit(u) { return u === 'each' || u === 'ea' || u === 'unit'; }

// Dimension of a unit for compatibility checks: 'weight' | 'volume' | 'each' | 'other'.
function _unitDim(u) {
  const x = (u || '').toLowerCase().trim();
  if (_WEIGHT_KG[x] != null) return 'weight';   // kg, g, lb, oz
  if (_VOLUME_ML[x] != null) return 'volume';   // L, ml, fl oz
  if (_isEachUnit(x)) return 'each';
  return 'other';                               // case, or anything unrecognised
}

// Can a product priced in `packU` be expressed in `otherU` at all? Same dimension
// converts; weight↔each bridges via the product's average weight (that bridge is
// still flagged uncostable if the weight is missing — see unitConversionFactor —
// not blocked here). Volume never crosses to weight/each, and an 'other'/'case'
// unit only matches itself. Drives the recipe unit-switch guard so 'each'/'case'
// items are checked too, instead of only the hardcoded weight↔volume pair.
function _unitsCompatible(packU, otherU) {
  const a = _unitDim(packU), b = _unitDim(otherU);
  if (a === 'other' || b === 'other') {
    return (packU || '').toLowerCase().trim() === (otherU || '').toLowerCase().trim();
  }
  if (a === b) return true;
  return (a === 'weight' && b === 'each') || (a === 'each' && b === 'weight');
}

// Conversion factor: how many "packUnit" equal 1 "recipeUnit".
// Returns a multiplier so that:  line_cost = unit_cost_per_packUnit × quantity × conversionFactor
// e.g. packUnit=kg, recipeUnit=g  → 1g = 0.001kg → factor = 0.001
// e.g. packUnit=g,  recipeUnit=kg → 1kg = 1000g  → factor = 1000
//
// Each ↔ weight requires the product's average weight per each (avgWeightKg,
// stored in kg as generic_products.avg_weight_per_unit). If that conversion is
// needed but no average weight is set, returns NULL — callers must treat null
// as "cannot cost this line" and flag it, never fall back to a silent factor of 1.
function unitConversionFactor(packUnitStr, recipeUnitStr, avgWeightKg) {
  const pu = (packUnitStr  || '').toLowerCase();
  const ru = (recipeUnitStr || '').toLowerCase();
  if (pu === ru) return 1;
  // Weight ↔ weight (kg, g, lb, oz)
  if (_WEIGHT_KG[pu] != null && _WEIGHT_KG[ru] != null) return _WEIGHT_KG[ru] / _WEIGHT_KG[pu];
  // Volume ↔ volume (L, ml, fl oz)
  if (_VOLUME_ML[pu] != null && _VOLUME_ML[ru] != null) return _VOLUME_ML[ru] / _VOLUME_ML[pu];
  // Each ↔ weight, via average weight per each
  //   packUnit=each, recipeUnit=weight → each per 1 recipeUnit = (recipeUnit in kg) / avgWeightKg
  //   packUnit=weight, recipeUnit=each → packUnits per 1 each = avgWeightKg / (packUnit in kg)
  if (_isEachUnit(pu) && _WEIGHT_KG[ru] != null) {
    if (!avgWeightKg || avgWeightKg <= 0) return null;
    return _WEIGHT_KG[ru] / avgWeightKg;
  }
  if (_WEIGHT_KG[pu] != null && _isEachUnit(ru)) {
    if (!avgWeightKg || avgWeightKg <= 0) return null;
    return avgWeightKg / _WEIGHT_KG[pu];
  }
  // No bridge between these units (e.g. weight↔volume, each↔volume, case↔weight).
  // Return null — "cannot cost this line" — never a silent factor of 1, which
  // would mis-cost the line with no warning. Callers must treat null as uncostable.
  return null;
}

// Average weight (kg per each) for the product referenced by a recipe row, or 0.
function rowAvgWeightKg(r) {
  const p = r && r.product_id ? allProducts.find(x => x.id === r.product_id) : null;
  const w = p ? parseFloat(p.avg_weight_per_unit) : 0;
  return (w && w > 0) ? w : 0;
}

// Build the unit <option> list for an ingredient line.
// If the product has a sub-unit defined, append it at the top as a highlighted option.
function buildUnitOptions(selectedUnit, product) {
  const su  = product?.sub_unit_name || '';
  const seen = new Set();
  const stdRaw = allUnits_r.length
    ? allUnits_r.map(u => u.name)
    : ['kg','g','lb','ml','L','each','case'];
  const std = stdRaw.filter(name => {
    const key = (name || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const sel = (selectedUnit || '').toLowerCase();
  let html  = '';

  // Sub-unit option at top (highlighted) if defined
  if (su) {
    const isSelected = sel === su.toLowerCase() ? 'selected' : '';
    html += `<option value="${esc(su)}" ${isSelected} style="font-weight:700;color:#4f46e5">${esc(su)} ← sub-unit</option>`;
  }

  // Standard options — match case-insensitively so 'each' matches 'Each' etc.
  html += std.map(u => {
    const isSelected = sel === u.toLowerCase() ? 'selected' : '';
    return `<option value="${u}" ${isSelected}>${u}</option>`;
  }).join('');

  html += '<option value="__manage_units__" style="color:var(--primary);font-style:italic">+ Manage units</option>';

  return html;
}

// ── Product Catalogue (generic products via products.js API) ─────
async function loadProductCatalogue() {
  try {
    // Load generic products, their entries, and current inventory levels
    // recipe_items comes along so the list can cost every recipe live, the same
    // way the detail modal already does.
    const [gd, ed, invd, rid] = await Promise.all([
      apiGet(`tables/generic_products?page=1&limit=500`),
      apiGet(`tables/product_entries?page=1&limit=1000`),
      apiGet(`tables/inventory?page=1&limit=500`),
      apiGet(`tables/${RECIPE_ITEMS_TABLE}?page=1&limit=1000`),
    ]);
    const allEntries_r  = ed.data  || [];
    const allInventory_r = invd.data || [];
    _rCatalogue = { generics: gd.data || [], entries: allEntries_r, inventory: allInventory_r, recipeItems: rid.data || [] };

    allProducts = (gd.data || []).map(g => {
      // All LIVE entries for this generic product, oldest purchase first (FIFO
      // order). Voided lines are excluded: voiding an invoice sets voided_at on
      // the entries it created so they stop counting toward pricing. Leaving
      // them in both prices off a cancelled invoice AND inflates the purchased
      // total, which shifts the FIFO layer to the wrong one.
      const entries = allEntries_r
        .filter(e => e.generic_product_id === g.id && !e.voided_at)
        .sort((a, b) => (a.purchase_date || '') > (b.purchase_date || '') ? 1 : -1);

      // Never purchased: no price yet, but the product's declared stocking unit
      // is a better default than 'unit', which isn't in the units list at all.
      if (!entries.length) {
        const baseU = String(g.base_unit || '').trim() || 'unit';
        return {
          id: g.id, name: g.name, category: g.category,
          deleted_at: g.deleted_at || null,   // archived items stay resolvable but are hidden from pickers
          avg_weight_per_unit: g.avg_weight_per_unit ?? null,  // kg per "each" — enables each↔weight costing
          pack_size: '', cost: 0,
          sub_unit_name: g.sub_unit_name || '', sub_unit_qty: g.sub_unit_qty || 0,
          pack_qty: 1, pack_unit: baseU, _cpu: 0, _packUnit: baseU,
        };
      }

      // Find current inventory quantity for this product (in its base unit)
      const invRow   = allInventory_r.find(r => r.item_id === g.id && r.item_type === 'raw_material');
      const invQty   = parseFloat(invRow?.quantity) || 0;

      // Walk entries FIFO: consume stock batch by batch to find the active price
      // layer. Purchases are converted into the unit the stock is counted in —
      // the bin's own unit, falling back to the product's declared stocking unit
      // — so suppliers billing in kg and lb can be placed on one axis.
      const stockUnit = String(invRow?.unit || g.base_unit || '').trim();
      const avgWKg    = g.avg_weight_per_unit != null ? parseFloat(g.avg_weight_per_unit) : null;
      const activeEntry = fifoActiveEntry(entries, invQty, stockUnit, avgWKg);

      // Pack shape and unit price — shared with finished-products.js so the two
      // pages cost a product identically. See entryPackFacts() in utils.js.
      const facts   = entryPackFacts(activeEntry);
      const packSz  = facts.pack_size;
      const pQty    = facts.pack_qty;
      const pUnit   = facts.pack_unit;
      const cpu     = facts.cost_per_unit;

      return {
        id:            g.id,
        name:          g.name,
        category:      g.category,
        deleted_at:    g.deleted_at || null,   // archived items stay resolvable but are hidden from pickers
        avg_weight_per_unit: g.avg_weight_per_unit ?? null,  // kg per "each" — enables each↔weight costing
        pack_size:     packSz,
        pack_qty:      pQty,
        pack_unit:     pUnit,
        // Carried so costPerUnit() on this object resolves the same way it does
        // on the entry. `cost` below is the line total, so dividing it by
        // pack_qty alone would overstate whenever more than one pack was ordered.
        cost_per_unit: cpu,
        cost:          activeEntry.cost || 0,
        sub_unit_name: g.sub_unit_name || '',
        sub_unit_qty:  g.sub_unit_qty  || 0,
        _cpu:          cpu,
        _packUnit:     pUnit,
      };
    });
    rebuildRecipeCostIndex();
  } catch (e) {
    console.error('Failed to load products', e);
    allProducts = [];
  }
}

/**
 * Given entries sorted oldest→newest and current inventory quantity,
 * return the entry whose batch is currently being consumed (active FIFO layer).
 *
 * FIFO = oldest stock is consumed first.
 *
 * Algorithm:
 *   - Calculate total stock ever purchased (sum of all pack quantities).
 *   - The amount already consumed = total purchased − current inventory.
 *   - Walk entries oldest→newest, accumulating quantities.
 *   - The first entry whose running total EXCEEDS the consumed amount
 *     is the batch currently being drawn from.
 *
 * Example: 1L @ $15 (Mar 6) + 1L @ $10 (Mar 7) = 2L total purchased.
 *   Inventory = 2L → consumed = 0  → active = Mar 6 batch ($15) ✓
 *   Inventory = 1L → consumed = 1L → Mar 6 batch cumulative=1, consumed=1,
 *                                     1 > 1? No. Mar 7 cumulative=2 > 1? Yes → active = Mar 7 ($10) ✓
 *   Inventory = 0L → all consumed  → active = newest entry ($10) ✓
 */
function fifoActiveEntry(sortedEntries, invQty, toUnit, avgWeightKg) {
  return fifoActiveEntryIn(sortedEntries, invQty, toUnit || '', avgWeightKg ?? null);
}

// ── Ingredient Lines ───────────────────────────────────────────
function addIngredientLine(prefill = null) {
  // Guard against being called as an event handler (click passes an Event, not a prefill).
  if (prefill instanceof Event) prefill = null;
  const idx = ingredientRows.length;
  const row = prefill || { product_id: '', product_name: '', quantity: 1, unit: '', unit_cost: 0 };
  ingredientRows.push(row);

  const container = document.getElementById('ingredientLines');
  const div = document.createElement('div');
  div.className = 'ingredient-line';
  div.id = `ing-${idx}`;

  // Build unit options — standard list + sub-unit appended if defined for selected product
  const selectedProduct = row.product_id ? allProducts.find(p => p.id === row.product_id) : null;
  const unitOpts = buildUnitOptions(row.unit, selectedProduct);

  // A flagged (ambiguous / not-found) row shows the chef's original text so they can
  // search from it, plus a resolution flag below the input.
  const isFlagged   = !!row._status && !row.product_id;
  const prefillName = selectedProduct ? esc(selectedProduct.name)
                    : (isFlagged ? esc(row._ingredientName || row._rawInput || '') : '');

  div.innerHTML = `
    <div class="form-group" style="position:relative">
      ${idx === 0 ? '<label>Product</label>' : '<label>&nbsp;</label>'}
      <input type="text" id="ing-prod-input-${idx}" value="${prefillName}" placeholder="Search or pick a product…" autocomplete="off"
             class="${isFlagged ? 'ing-input-flagged' : ''}"
             oninput="onProductSearch(${idx})" onfocus="onProductFocus(${idx})"
             onkeydown="onProductKeydown(${idx}, event)" onblur="hideProductSuggestions(${idx})" />
      <input type="hidden" id="ing-prod-${idx}" value="${esc(row.product_id || '')}" />
      <div id="ing-prod-suggestions-${idx}" class="product-suggestions" onmousedown="event.preventDefault()"></div>
      ${ingFlagHtml(idx, row)}
    </div>
    <div class="form-group">
      ${idx === 0 ? '<label>Qty</label>' : '<label>&nbsp;</label>'}
      <input type="number" id="ing-qty-${idx}" value="${row.quantity}" min="0.01" step="0.01" onchange="onQtyChange(${idx})" />
    </div>
    <div class="form-group unit-group">
      ${idx === 0 ? '<label>Unit</label>' : '<label>&nbsp;</label>'}
      <select id="ing-unit-${idx}" onchange="onUnitChange(${idx})">
        ${unitOpts}
      </select>
      <span id="ing-cpu-${idx}" style="font-size:.72rem;color:var(--text-muted);margin-top:.15rem;display:block;min-height:.9rem"></span>
    </div>
    <div>
      ${idx === 0 ? '<label style="font-size:.72rem;font-weight:600;color:transparent">x</label>' : ''}
      <button class="btn btn-danger btn-icon" onclick="removeIngredientLine(${idx})" title="Remove"><i class="fas fa-times"></i></button>
    </div>
  `;
  container.appendChild(div);

  // Track prevUnit so __manage_units__ selection can reset correctly
  const unitSelInit = document.getElementById(`ing-unit-${idx}`);
  if (unitSelInit) unitSelInit.dataset.prevUnit = unitSelInit.value;

  // If prefill had product_id, initialise cost
  if (row.product_id) onProductChange(idx);
}

function onProductChange(idx) {
  const hidden    = document.getElementById(`ing-prod-${idx}`);
  const productId = hidden?.value || '';
  const product   = allProducts.find(p => p.id === productId);

  const cpu         = product ? (product._cpu !== undefined ? product._cpu : costPerUnit(product)) : 0;
  const pu          = product ? (product._packUnit || packUnit(product)) : 'kg';
  const subUnitName = product?.sub_unit_name || '';
  const subUnitQty  = parseFloat(product?.sub_unit_qty || 0);

  ingredientRows[idx].product_id    = productId;
  ingredientRows[idx].product_name  = product?.name || '';
  ingredientRows[idx].unit_cost     = cpu;
  ingredientRows[idx].pack_unit     = pu;
  ingredientRows[idx].sub_unit_name = subUnitName;
  ingredientRows[idx].sub_unit_qty  = subUnitQty;

  // Determine the smart default unit for this product:
  // → sub-unit if defined (e.g. 'Egg'), otherwise pack unit (e.g. 'L', 'Each', 'kg')
  const defaultUnit = subUnitName ? subUnitName : (pu || 'kg');

  // Always auto-set unit when product changes (unless user already manually picked one)
  if (!ingredientRows[idx]._manualUnit) {
    ingredientRows[idx].unit      = defaultUnit;
    ingredientRows[idx]._autoUnit = true;
  }

  // Rebuild unit dropdown, pre-selecting the correct unit
  const unitSel = document.getElementById(`ing-unit-${idx}`);
  if (unitSel) {
    unitSel.innerHTML = buildUnitOptions(ingredientRows[idx].unit, product);
    unitSel.dataset.prevUnit = unitSel.value;
  }

  // Selecting a real product resolves any ambiguous/not-found flag on this row.
  if (productId) clearRowFlag(idx);
  else updateUnresolvedState();

  _updateIngCostDisplay(idx);
  recalcCosts();
}

function _updateIngCostDisplay(idx) {
  const el = document.getElementById(`ing-cpu-${idx}`);
  if (!el) return;
  const r = ingredientRows[idx];
  if (!r || !r.product_id || !r.unit_cost || !r.pack_unit) { el.textContent = ''; return; }
  const unit   = r.unit || r.pack_unit;
  const factor = unitConversionFactor(r.pack_unit, unit, rowAvgWeightKg(r));
  if (factor === null) {
    el.innerHTML = `<span style="color:#dc2626" title="Set an Average Weight per Unit on this product to use it by ${esc(unit)}"><i class="fas fa-triangle-exclamation"></i> set avg. weight</span>`;
    return;
  }
  el.textContent = `${fmt(r.unit_cost * factor)} / ${unit}`;
}

function onQtyChange(idx) {
  const inp = document.getElementById(`ing-qty-${idx}`);
  ingredientRows[idx].quantity = parseFloat(inp.value) || 0;
  recalcCosts();
}

function onUnitChange(idx) {
  const sel     = document.getElementById(`ing-unit-${idx}`);
  const newUnit = sel.value;

  if (newUnit === '__manage_units__') {
    sel.value = sel.dataset.prevUnit || ingredientRows[idx]?.unit || '';
    openManageUnitsModal();
    return;
  }

  const prevUnit = sel.dataset.prevUnit || ingredientRows[idx]?.unit || '';
  const row      = ingredientRows[idx] || {};

  // Block a switch to a unit this ingredient can't be costed in. Compatibility is
  // driven by the product's pack unit (what it's priced in) and real dimension
  // bridges, not a hardcoded weight/volume list — so 'each'/'case' items are
  // guarded too (e.g. an each-priced cucumber can't switch to L). The product's
  // own sub-unit is always allowed (costed via the sub-unit path, not conversion).
  if (newUnit !== prevUnit) {
    const packU   = row.pack_unit || prevUnit || 'kg';
    const subName = (row.sub_unit_name || '').toLowerCase().trim();
    const isSub   = subName && newUnit.toLowerCase().trim() === subName;
    if (!isSub && !_unitsCompatible(packU, newUnit)) {
      sel.value = prevUnit;
      showToast(`Cannot convert ${packU} to ${newUnit} — unit reset.`, 'warning');
      return;
    }
  }

  sel.dataset.prevUnit            = newUnit;
  ingredientRows[idx].unit        = newUnit || 'kg';
  ingredientRows[idx]._manualUnit = true;
  ingredientRows[idx]._autoUnit   = false;

  _updateIngCostDisplay(idx);
  recalcCosts();
}
// ── Ingredient product picker ─────────────────────────────────────
// One field, two modes: empty → browse the full catalogue grouped by
// category; typing → flat, name-only, ranked results. Keyboard: ↑/↓ move,
// Enter picks, Esc closes. Archived products are never offered.
let _pickerItems  = [];   // selectable rows for the OPEN dropdown, in display order
let _pickerActive = -1;   // index into _pickerItems that's keyboard-highlighted

// Opening (focus): show the list for whatever's currently typed (empty → browse).
function onProductFocus(idx) {
  const input = document.getElementById(`ing-prod-input-${idx}`);
  renderProductSuggestions(idx, input ? input.value : '');
}

// Typing: a new query invalidates any prior selection, then re-render.
function onProductSearch(idx) {
  const input  = document.getElementById(`ing-prod-input-${idx}`);
  const hidden = document.getElementById(`ing-prod-${idx}`);
  if (hidden) hidden.value = '';
  renderProductSuggestions(idx, input ? input.value : '');
}

function renderProductSuggestions(idx, rawQuery) {
  const box = document.getElementById(`ing-prod-suggestions-${idx}`);
  if (!box) return;
  const q      = (rawQuery || '').trim();
  const ql     = q.toLowerCase();
  const active = allProducts.filter(p => !p.deleted_at);   // never offer archived
  _pickerItems = [];
  _pickerActive = -1;
  let html = '';

  if (!active.length) {
    box.innerHTML = '<div class="product-suggestion-empty">No products yet — type a name and add it.</div>';
    box.style.display = 'block';
    return;
  }

  if (!ql) {
    // ── Browse mode: group by category, ordered by the built-in taxonomy ──
    const byCat = new Map();
    active.forEach(p => {
      const c = (p.category || '').trim() || 'Uncategorised';
      (byCat.get(c) || byCat.set(c, []).get(c)).push(p);
    });
    const order = mergeCategories([...byCat.keys()]);           // taxonomy order + any extras
    const cats  = order.filter(c => byCat.has(c));
    if (byCat.has('Uncategorised')) { cats.splice(cats.indexOf('Uncategorised'), 1); cats.push('Uncategorised'); }
    for (const c of cats) {
      const items = byCat.get(c).sort((a, b) => a.name.localeCompare(b.name));
      html += `<div class="product-suggestion-cat">${esc(c)}</div>`;
      for (const p of items) html += _pickerRow(idx, p, null);
    }
    html += '<div class="psi-fade"></div>';   // bottom scroll cue for the long grouped list
  } else {
    // ── Search mode: name-only, prefix matches first, then A→Z ──
    const matches = active
      .filter(p => p.name.toLowerCase().includes(ql))
      .sort((a, b) => {
        const ap = a.name.toLowerCase().startsWith(ql) ? 0 : 1;
        const bp = b.name.toLowerCase().startsWith(ql) ? 0 : 1;
        return ap - bp || a.name.localeCompare(b.name);
      });
    if (!matches.length) html += `<div class="product-suggestion-empty">No products match “${esc(q)}”.</div>`;
    for (const p of matches) html += _pickerRow(idx, p, p.category || '—');
    // Always offer to add what they typed as a new product.
    const n = _pickerItems.length;
    _pickerItems.push({ type: 'add' });
    html += `<div class="product-suggestion-item add-new" data-n="${n}" onmousedown="addProductFromSearch(${idx})">
      <span><i class="fas fa-plus"></i>&nbsp; Add “${esc(q)}” as a new product</span></div>`;
  }

  box.innerHTML = html;
  box.style.display = 'block';
  _applyPickerHighlight(box);
}

// Build one selectable product row and register it for keyboard nav.
function _pickerRow(idx, p, subtitle) {
  const n = _pickerItems.length;
  _pickerItems.push({ type: 'product', id: p.id });
  const sub = subtitle ? `<span class="psi-sub">${esc(subtitle)}</span>` : '';
  return `<div class="product-suggestion-item" data-n="${n}" onmousedown="selectProduct(${idx}, '${esc(p.id)}')">
    <span>${esc(p.name)}</span>${sub}</div>`;
}

function _applyPickerHighlight(box) {
  box.querySelectorAll('.product-suggestion-item').forEach(el => {
    const on = Number(el.dataset.n) === _pickerActive;
    el.classList.toggle('active', on);
    if (on) el.scrollIntoView({ block: 'nearest' });
  });
}

// Keyboard: ↑/↓ move highlight, Enter selects, Esc closes.
function onProductKeydown(idx, e) {
  const box = document.getElementById(`ing-prod-suggestions-${idx}`);
  const open = box && box.style.display !== 'none' && _pickerItems.length;
  if (!open) {
    if (e.key === 'ArrowDown') { e.preventDefault(); onProductFocus(idx); }
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault(); _pickerActive = Math.min(_pickerItems.length - 1, _pickerActive + 1); _applyPickerHighlight(box);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault(); _pickerActive = Math.max(0, _pickerActive - 1); _applyPickerHighlight(box);
  } else if (e.key === 'Enter') {
    if (_pickerActive >= 0 && _pickerActive < _pickerItems.length) {
      e.preventDefault();
      const it = _pickerItems[_pickerActive];
      if (it.type === 'product') selectProduct(idx, it.id);
      else addProductFromSearch(idx);
    }
  } else if (e.key === 'Escape') {
    box.style.display = 'none';
  }
}

// Create a brand-new product from the typed text and select it on this line.
async function addProductFromSearch(idx) {
  const input = document.getElementById(`ing-prod-input-${idx}`);
  const name  = (input?.value || '').trim();
  if (!name) return;
  try {
    const created = await apiPost(`tables/${PRODUCTS_TABLE_R}`, { name, category: 'Other' });
    allProducts.push({ ...created, deleted_at: null, avg_weight_per_unit: created.avg_weight_per_unit ?? null });
    const hidden = document.getElementById(`ing-prod-${idx}`);
    if (hidden) hidden.value = created.id;
    input.value = created.name;
    hideProductSuggestions(idx);
    onProductChange(idx);
    showToast(`Added "${name}" to Products — set its price on the Products page to include it in the cost.`, 'success');
  } catch (e) {
    showToast('Could not add product: ' + e.message, 'error');
  }
}

function selectProduct(idx, productId) {
  const product        = allProducts.find(p => p.id === productId);
  if (!product) return;

  const input          = document.getElementById(`ing-prod-input-${idx}`);
  const hidden         = document.getElementById(`ing-prod-${idx}`);
  const suggestionsDiv = document.getElementById(`ing-prod-suggestions-${idx}`);

  input.value           = product.name;
  hidden.value          = productId;
  suggestionsDiv.style.display = 'none';

  onProductChange(idx);
}

function hideProductSuggestions(idx) {
  const suggestionsDiv = document.getElementById(`ing-prod-suggestions-${idx}`);
  if (suggestionsDiv) suggestionsDiv.style.display = 'none';
}

function removeIngredientLine(idx) {
  const div = document.getElementById(`ing-${idx}`);
  if (div) div.remove();
  ingredientRows[idx] = null; // mark removed
  recalcCosts();
  updateUnresolvedState();
}

// ── Quick add from plain-English text ──────────────────────────
function toggleQuickAdd() {
  const body = document.getElementById('quickAddBody');
  const chev = document.querySelector('.quick-add-chevron');
  const isOpen = body.classList.toggle('hidden') === false;
  if (chev) chev.style.transform = isOpen ? 'rotate(180deg)' : '';
  if (isOpen) document.getElementById('quickAddText').focus();
}

async function quickAddParse() {
  const textEl = document.getElementById('quickAddText');
  const text   = textEl.value.trim();
  if (!text) { showToast('Type some ingredients first.', 'error'); return; }
  if (!allProducts.length) { showToast('No products loaded to match against.', 'error'); return; }

  const btn  = document.getElementById('quickAddParseBtn');
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Matching…';

  try {
    const res = await apiPost('ai/parse-recipe', {
      text,
      // Only offer active products as match candidates — never an archived one.
      products: allProducts.filter(p => !p.deleted_at).map(p => ({ id: p.id, name: p.name, category: p.category || '' })),
    });
    const items = res.items || [];
    if (!items.length) { showToast('No ingredients recognised in that text.', 'warning'); return; }

    let matched = 0, flagged = 0;
    for (const it of items) {
      const unit = it.unit || '';
      const qty  = (it.quantity != null && !isNaN(it.quantity)) ? it.quantity : 1;

      // The chef typed the unit explicitly, so treat it as a manual choice and
      // don't let onProductChange overwrite it with the product's pack unit.
      const manualUnit = !!unit;

      if (it.status === 'matched' && it.product_id) {
        addIngredientLine({ product_id: it.product_id, product_name: it.product_name, quantity: qty, unit, _manualUnit: manualUnit });
        matched++;
      } else {
        addIngredientLine({
          product_id: '', product_name: '', quantity: qty, unit, unit_cost: 0, _manualUnit: manualUnit,
          _status:        it.status === 'ambiguous' ? 'ambiguous' : 'not_found',
          _rawInput:      it.input || it.ingredient || '',
          _ingredientName: it.ingredient || it.input || '',
          _candidateIds:  it.candidate_ids || [],
        });
        flagged++;
      }
    }

    textEl.value = '';
    recalcCosts();
    updateUnresolvedState();

    if (flagged) {
      showToast(`Added ${matched} ingredient${matched === 1 ? '' : 's'}; ${flagged} need${flagged === 1 ? 's' : ''} your attention.`, 'warning');
    } else {
      showToast(`Added ${matched} ingredient${matched === 1 ? '' : 's'}.`, 'success');
    }
  } catch (e) {
    showToast(e.message || 'Matching failed.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

// Build the inline resolution flag shown under a flagged ingredient's product input.
function ingFlagHtml(idx, row) {
  if (!row._status || row.product_id) return '';

  if (row._status === 'ambiguous') {
    const chips = (row._candidateIds || [])
      .map(id => allProducts.find(p => p.id === id))
      .filter(Boolean)
      .map(p => `<button type="button" class="ing-chip" onmousedown="resolveCandidate(${idx}, '${esc(p.id)}')">${esc(p.name)}</button>`)
      .join('');
    const label = esc(row._ingredientName || row._rawInput || 'this ingredient');
    return `<div class="ing-flag ambiguous">
      <span class="ing-flag-label"><i class="fas fa-triangle-exclamation"></i> Which "${label}"?</span>
      ${chips || '<span class="ing-flag-muted">search above to pick one</span>'}
    </div>`;
  }

  // not_found
  const label = esc(row._ingredientName || row._rawInput || 'ingredient');
  return `<div class="ing-flag notfound">
    <span class="ing-flag-label"><i class="fas fa-circle-xmark"></i> "${label}" not in your products</span>
    <button type="button" class="ing-chip add" onmousedown="addMissingProduct(${idx})"><i class="fas fa-plus"></i> Add as new product</button>
    <span class="ing-flag-muted">or search above</span>
  </div>`;
}

// User clicked one of the ambiguous candidate chips.
function resolveCandidate(idx, productId) {
  selectProduct(idx, productId); // fills input + hidden, runs onProductChange → clears the flag
}

// User chose to add a not-found ingredient as a brand-new product.
async function addMissingProduct(idx) {
  const row = ingredientRows[idx];
  if (!row) return;
  const name = (row._ingredientName || row._rawInput || '').trim();
  if (!name) { showToast('No ingredient name to add.', 'error'); return; }

  try {
    const created = await apiPost(`tables/${PRODUCTS_TABLE_R}`, { name, category: 'Other' });
    allProducts.push(created); // so it matches next time and can be selected now

    const input  = document.getElementById(`ing-prod-input-${idx}`);
    const hidden = document.getElementById(`ing-prod-${idx}`);
    if (input)  input.value  = created.name;
    if (hidden) hidden.value = created.id;
    onProductChange(idx); // sets the row's product + clears the flag

    showToast(`Added "${name}" to Products — set its price on the Products page to include it in the cost.`, 'success');
  } catch (e) {
    showToast('Could not add product: ' + e.message, 'error');
  }
}

// Remove a resolved row's flag (data + DOM) and refresh the save-blocking state.
function clearRowFlag(idx) {
  const row = ingredientRows[idx];
  if (row) { delete row._status; delete row._candidateIds; delete row._rawInput; delete row._ingredientName; }
  const flag = document.querySelector(`#ing-${idx} .ing-flag`);
  if (flag) flag.remove();
  const input = document.getElementById(`ing-prod-input-${idx}`);
  if (input) input.classList.remove('ing-input-flagged');
  updateUnresolvedState();
}

// True while any row is still an unresolved (ambiguous / not-found) flag.
function hasUnresolved() {
  return ingredientRows.some(r => r && r._status && !r.product_id);
}

// Disable Save and show the banner while unresolved ingredients remain.
function updateUnresolvedState() {
  const blocked = hasUnresolved();
  const btn = document.getElementById('saveRecipeBtn');
  if (btn) {
    btn.disabled = blocked;
    btn.title = blocked ? 'Resolve or remove the flagged ingredients first' : '';
  }
  const banner = document.getElementById('unresolvedBanner');
  if (banner) banner.style.display = blocked ? 'flex' : 'none';
}

function activeRows() {
  return ingredientRows.filter(r => r && r.product_id);
}

function recalcCosts() {
  const yieldQty  = parseFloat(document.getElementById('recipeYieldQty').value) || 1;
  const yieldUnit = document.getElementById('recipeYieldUnit').value || 'kg';
  const costs = activeRows().map(calcIngredientLineCost);
  const total = costs.reduce((t, c) => t + (isUncostable(c) ? 0 : c), 0);
  const warn  = costs.some(isUncostable) ? ' ⚠' : '';   // total excludes uncostable lines
  document.getElementById('totalCostDisplay').textContent       = fmt(total) + warn;
  document.getElementById('costPerServingDisplay').textContent  = fmt(total / yieldQty) + warn;
  document.getElementById('costPerUnitLabel').textContent       = `Cost per ${yieldUnit}`;
}

// Calculate the cost for one ingredient row, handling sub-unit conversion
function calcIngredientLineCost(r) {
  if (!r || !r.product_id) return 0;
  const recipeUnit = (r.unit || 'kg').toLowerCase();
  const subName    = (r.sub_unit_name || '').toLowerCase();
  const subQty     = r.sub_unit_qty || 0;

  // Sub-unit path: e.g. unit='egg', sub_unit_name='egg', sub_unit_qty=12
  // cost_per_sub_unit = unit_cost (per pack unit) / sub_unit_qty * pack_qty
  // Simpler: cost per sub-unit = total_pack_cost / sub_unit_qty
  // But we only have cost_per_pack_unit (cost ÷ pack_qty).
  // cost_per_sub_unit = cost_per_pack_unit × pack_qty / sub_unit_qty
  // We need pack_qty — get it from the product
  if (subName && subQty > 0 && recipeUnit === subName) {
    const product = allProducts.find(p => p.id === r.product_id);
    const pQty    = product ? packQty(product) : 1;
    const costPerSub = (r.unit_cost || 0) * pQty / subQty;
    return costPerSub * (r.quantity || 0);
  }

  // Standard path: use unit conversion factor (avg-weight-aware for each↔weight)
  const factor = unitConversionFactor(r.pack_unit || 'kg', r.unit || 'kg', rowAvgWeightKg(r));
  if (factor === null) return null;   // uncostable (each↔weight with no avg weight set)
  return (r.unit_cost || 0) * (r.quantity || 1) * factor;
}

// A line cost is "uncostable" (null) when its units can't be converted — e.g. an
// each-priced product used by weight with no average weight set on the product.
function isUncostable(v) { return v === null || (typeof v === 'number' && isNaN(v)); }

// Sum line costs, ignoring uncostable ones (they're flagged separately in the UI).
function sumLineCosts(rows) {
  return rows.reduce((t, r) => {
    const c = calcIngredientLineCost(r);
    return t + (isUncostable(c) ? 0 : c);
  }, 0);
}

// Any active row that can't be costed? (drives the "set avg weight" warnings.)
function anyUncostable(rows) {
  return rows.some(r => isUncostable(calcIngredientLineCost(r)));
}

// Format a line/total cost cell; uncostable → a red warning marker.
function fmtLineCost(v) {
  return isUncostable(v)
    ? '<span style="color:#dc2626" title="Set an Average Weight per Unit on this product to cost it by weight">⚠&nbsp;n/a</span>'
    : fmt(v);
}

// ── Save Recipe ────────────────────────────────────────────────
async function saveRecipe() {
  const name      = document.getElementById('recipeName').value.trim();
  const desc      = document.getElementById('recipeDesc').value.trim();
  const yieldQty  = parseFloat(document.getElementById('recipeYieldQty').value) || 1;
  const yieldUnit = document.getElementById('recipeYieldUnit').value || 'kg';
  const prodMode  = document.getElementById('recipeProductionMode').value || 'on_demand';
  const editId    = document.getElementById('editRecipeId').value;

  if (!name) { showToast('Recipe name is required.', 'error'); return; }

  if (hasUnresolved()) {
    showToast('Resolve or remove the flagged ingredients before saving.', 'error');
    return;
  }

  const items = activeRows();
  if (!items.length) { showToast('Add at least one ingredient.', 'error'); return; }

  if (anyUncostable(items)) {
    showToast('Some ingredients can’t be costed — set an Average Weight per Unit on those products. Saving with those lines counted as $0.', 'warning');
  }

  const total = sumLineCosts(items);

  const btn = document.getElementById('saveRecipeBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

  try {
    let recipeId;

    if (editId) {
      // Update recipe
      await apiPut(`tables/${RECIPES_TABLE}/${editId}`, { name, description: desc, servings: yieldQty, yield_unit: yieldUnit, total_cost: total, production_mode: prodMode });
      recipeId = editId;
      // Delete old items
      const oldItems = await apiGet(`tables/${RECIPE_ITEMS_TABLE}?page=1&limit=200`);
      const mine = (oldItems.data || []).filter(i => i.recipe_id === recipeId);
      for (const it of mine) {
        await apiDelete(`tables/${RECIPE_ITEMS_TABLE}/${it.id}`);
      }
      showToast('Recipe updated!', 'success');
    } else {
      const recipe = await apiPost(`tables/${RECIPES_TABLE}`, { name, description: desc, servings: yieldQty, yield_unit: yieldUnit, total_cost: total, production_mode: prodMode });
      recipeId = recipe.id;
      showToast('Recipe saved!', 'success');
    }

    // Save ingredient lines
    for (const r of items) {
      await apiPost(`tables/${RECIPE_ITEMS_TABLE}`, {
        recipe_id:    recipeId,
        product_id:   r.product_id,
        product_name: r.product_name,
        quantity:     r.quantity,
        unit:         r.unit,
        line_cost:    calcIngredientLineCost(r) || 0,   // unit-converted; uncostable → 0
      });
    }

    clearRecipeForm();
    await refreshRecipeItems();   // the lines just written ARE this recipe's cost
    await loadRecipes();
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save Recipe';
  }
}

// ── Clear Form ─────────────────────────────────────────────────
// ── Production mode ────────────────────────────────────────────
// Decides where stock comes off when a sale is imported from the POS.
//
//   on_demand — the sale explodes this recipe into its raw ingredients.
//   batched   — the sale deducts the stored batch instead, and Produce Batch is
//               what refills that batch from raw ingredients.
//
// Only one of those may fire, or the same flour is counted twice: once when the
// dough is made and again when the pizza is sold. That is why this is a choice
// per recipe rather than a setting for the whole account — a real kitchen preps
// its dough ahead and assembles the pizza to order.
const PRODUCTION_MODE_HINTS = {
  on_demand: 'Selling a dish that uses this recipe takes its ingredients straight out of stock.',
  batched:   'Selling a dish that uses this recipe draws down the batch you produced. Use Produce Batch to make more.',
};

function setProductionMode(mode) {
  const sel = document.getElementById('recipeProductionMode');
  if (!sel) return;
  sel.value = PRODUCTION_MODE_HINTS[mode] ? mode : 'on_demand';
  updateProductionModeHint();
}

function updateProductionModeHint() {
  const sel  = document.getElementById('recipeProductionMode');
  const hint = document.getElementById('recipeProductionModeHint');
  if (!sel || !hint) return;
  hint.textContent = PRODUCTION_MODE_HINTS[sel.value] || '';
}

function clearRecipeForm() {
  document.getElementById('editRecipeId').value    = '';
  document.getElementById('recipeName').value      = '';
  document.getElementById('recipeDesc').value      = '';
  document.getElementById('recipeYieldQty').value  = '';
  setSelectValueCI_r(document.getElementById('recipeYieldUnit'), 'kg');
  setProductionMode('on_demand');
  document.getElementById('recipeFormTitle').innerHTML = '<i class="fas fa-plus-circle"></i> New Recipe';
  document.getElementById('ingredientLines').innerHTML = '';
  ingredientRows = [];
  addIngredientLine();
  recalcCosts();
  updateUnresolvedState();
}

// ── Load Recipes ───────────────────────────────────────────────
async function loadRecipes() {
  try {
    const data = await apiGet(`tables/${RECIPES_TABLE}?page=1&limit=200`);
    allRecipes = data.data || [];
    rebuildRecipeCostIndex();
    renderRecipeList('');
  } catch (e) {
    document.getElementById('recipeListContainer').innerHTML =
      '<div class="empty-row"><i class="fas fa-exclamation-triangle"></i> Failed to load recipes.</div>';
  }
}

function renderRecipeList(query) {
  const container = document.getElementById('recipeListContainer');
  let list = allRecipes;
  if (query) {
    const q = query.toLowerCase();
    list = list.filter(r =>
      (r.name || '').toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q)
    );
  }

  if (!list.length) {
    container.innerHTML = '<div class="empty-row"><i class="fas fa-utensils"></i> No recipes yet. Create your first one!</div>';
    return;
  }

  container.innerHTML = list.map(r => {
    const cost = recipeLiveCost(r);
    const warn = rCostIndex.recipe.get(r.id)?.uncostable
      ? ' <span title="An ingredient could not be costed — set an average weight, or check its unit" style="color:#dc2626">&#9888;</span>'
      : '';
    return `
    <div class="recipe-card" onclick="openRecipeDetail('${esc(r.id)}')">
      <div>
        <div class="recipe-card-name">${esc(r.name)}</div>
        ${r.description ? `<div class="recipe-card-desc">${esc(r.description)}</div>` : ''}
        <div class="recipe-card-meta">${r.servings ? `<i class="fas fa-weight-hanging"></i> ${r.servings} ${esc(r.yield_unit || 'kg')} yield` : ''}</div>
      </div>
      <div style="text-align:right">
        <div class="recipe-card-cost">${fmt(cost)}${warn}</div>
        ${r.servings ? `<div class="recipe-card-meta">${fmt(cost / r.servings)} / ${esc(r.yield_unit || 'kg')}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── Recipe Detail Modal ────────────────────────────────────────
async function openRecipeDetail(id) {
  currentDetailId = id;
  const recipe = allRecipes.find(r => r.id === id);
  if (!recipe) return;

  document.getElementById('detailRecipeName').textContent = recipe.name;

  let items = [];
  try {
    const data = await apiGet(`tables/${RECIPE_ITEMS_TABLE}?page=1&limit=200`);
    items = (data.data || []).filter(i => i.recipe_id === id);
  } catch (_) {}

  const yieldQty  = recipe.servings   || 1;
  const yieldUnit = recipe.yield_unit || 'kg';

  // Recalculate total live so it always reflects correct unit conversions
  let totalCost = 0;
  if (items.length) {
    items.forEach(it => {
      const prod = allProducts.find(p => p.id === it.product_id);
      const row = {
        product_id:    it.product_id,
        quantity:      parseFloat(it.quantity) || 0,
        unit:          it.unit || 'kg',
        unit_cost:     prod ? (prod._cpu !== undefined ? prod._cpu : costPerUnit(prod)) : 0,
        pack_unit:     prod ? (prod._packUnit || packUnit(prod)) : 'kg',
        sub_unit_name: prod?.sub_unit_name || '',
        sub_unit_qty:  prod?.sub_unit_qty  || 0,
      };
      const c = calcIngredientLineCost(row);
      totalCost += isUncostable(c) ? 0 : c;
    });
  } else {
    totalCost = recipe.total_cost || 0; // fallback to saved value
  }

  let body = `
    ${costBasisNote(rCostIndex.recipe.get(recipe.id)?.basis)}
    <div class="detail-section-title">Recipe Info</div>
    <div class="detail-info-grid">
      ${recipe.description ? `<div class="detail-info-item"><span>Description</span><span>${esc(recipe.description)}</span></div>` : ''}
      <div class="detail-info-item"><span>Yield</span><span>${recipe.servings ? recipe.servings + ' ' + esc(yieldUnit) : '—'}</span></div>
      ${batchWorkflowHidden() ? '' : `<div class="detail-info-item"><span>How it's made</span><span>${
        recipe.production_mode === 'batched' ? 'Made ahead in batches' : 'Made to order'
      }</span></div>`}
    </div>

    <div class="detail-section-title">Ingredients</div>
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Line Cost</th>
          </tr>
        </thead>
        <tbody>
  `;

  if (items.length) {
    items.forEach(it => {
      const prod = allProducts.find(p => p.id === it.product_id);

      // Rebuild a row object identical to what calcIngredientLineCost() expects
      const row = {
        product_id:    it.product_id,
        quantity:      parseFloat(it.quantity) || 0,
        unit:          it.unit || 'kg',
        unit_cost:     prod ? (prod._cpu !== undefined ? prod._cpu : costPerUnit(prod)) : 0,
        pack_unit:     prod ? (prod._packUnit || packUnit(prod)) : 'kg',
        sub_unit_name: prod?.sub_unit_name || '',
        sub_unit_qty:  prod?.sub_unit_qty  || 0,
      };
      const lineCost = calcIngredientLineCost(row);

      body += `
        <tr>
          <td><strong>${esc(it.product_name)}</strong></td>
          <td>${it.quantity}</td>
          <td>${esc(it.unit || 'unit')}</td>
          <td><strong>${fmtLineCost(lineCost)}</strong></td>
        </tr>
      `;
    });
  } else {
    body += '<tr><td colspan="4" class="empty-row">No ingredients found.</td></tr>';
  }

  body += `
        </tbody>
      </table>
    </div>
    <div class="detail-cost-box">
      <div>
        <div class="label"><i class="fas fa-calculator"></i> Total Recipe Cost</div>
      </div>
      <div class="amount">${fmt(totalCost)}</div>
    </div>
    ${yieldQty > 0 ? `
    <div class="detail-cost-box" style="margin-top:.5rem;background:#f0fdf4;border-color:#86efac">
      <div><div class="label"><i class="fas fa-balance-scale"></i> Cost per ${esc(yieldUnit)}</div></div>
      <div class="amount" style="color:#16a34a">${fmt(totalCost / yieldQty)}</div>
    </div>` : ''}
  `;

  document.getElementById('recipeDetailBody').innerHTML = body;
  openModal('recipeDetailModal');
}

// ── Print Recipe ───────────────────────────────────────────────
// Opens a clean, self-contained printable page in a new window and triggers the
// browser print dialog. Reuses the already-rendered detail body so what prints
// matches exactly what's shown in the modal.
function printRecipe(id) {
  const recipe = allRecipes.find(r => r.id === id);
  if (!recipe) return;

  const name = recipe.name || 'Recipe';
  const bodyHtml = document.getElementById('recipeDetailBody').innerHTML;
  const printedOn = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  const doc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${esc(name)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1f2937; margin: 32px; }
    .print-header { border-bottom: 2px solid #4f46e5; padding-bottom: 12px; margin-bottom: 20px; }
    .print-header h1 { margin: 0; font-size: 24px; color: #111827; }
    .print-header .meta { margin-top: 4px; font-size: 12px; color: #6b7280; }
    .detail-section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #4f46e5; margin: 20px 0 8px; }
    .detail-info-grid { display: grid; gap: 6px; margin-bottom: 8px; }
    .detail-info-item { display: flex; justify-content: space-between; gap: 16px; font-size: 14px; padding: 4px 0; border-bottom: 1px dashed #e5e7eb; }
    .detail-info-item span:first-child { color: #6b7280; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 14px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
    th { background: #f3f4f6; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; color: #374151; }
    td:nth-child(2), td:nth-child(3), td:nth-child(4),
    th:nth-child(2), th:nth-child(3), th:nth-child(4) { text-align: right; white-space: nowrap; }
    .detail-cost-box { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding: 12px 16px; border: 1px solid #c7d2fe; border-radius: 8px; background: #eef2ff; }
    .detail-cost-box .label { font-weight: 600; font-size: 14px; }
    .detail-cost-box .amount { font-size: 18px; font-weight: 700; }
    .table-scroll { overflow: visible; }
    @media print { body { margin: 0; } .print-footer { position: fixed; bottom: 0; } }
    .print-footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="print-header">
    <h1>${esc(name)}</h1>
    <div class="meta">Recipe &middot; Printed ${esc(printedOn)}</div>
  </div>
  ${bodyHtml}
  <div class="print-footer">Generated by DoughMeter</div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    showToast('Please allow pop-ups to print the recipe.', 'error');
    return;
  }
  win.document.open();
  win.document.write(doc);
  win.document.close();
  // Give the new document a tick to lay out before invoking print.
  win.focus();
  setTimeout(() => win.print(), 300);
}

// ── Load Recipe into Form (Edit) ───────────────────────────────
async function loadRecipeIntoForm(id) {
  const recipe = allRecipes.find(r => r.id === id);
  if (!recipe) return;

  document.getElementById('editRecipeId').value    = id;
  document.getElementById('recipeName').value      = recipe.name || '';
  document.getElementById('recipeDesc').value      = recipe.description || '';
  document.getElementById('recipeYieldQty').value  = recipe.servings || '';
  setSelectValueCI_r(document.getElementById('recipeYieldUnit'), recipe.yield_unit || 'kg');
  setProductionMode(recipe.production_mode || 'on_demand');
  document.getElementById('recipeFormTitle').innerHTML =
    '<i class="fas fa-edit"></i> Edit Recipe: ' + esc(recipe.name);

  // Load items
  let items = [];
  try {
    const data = await apiGet(`tables/${RECIPE_ITEMS_TABLE}?page=1&limit=200`);
    items = (data.data || []).filter(i => i.recipe_id === id);
  } catch (_) {}

  // Clear existing lines
  document.getElementById('ingredientLines').innerHTML = '';
  ingredientRows = [];

  if (items.length) {
    items.forEach(it => {
      const product = allProducts.find(p => p.id === it.product_id);
      addIngredientLine({
        product_id:    it.product_id,
        product_name:  it.product_name,
        quantity:      it.quantity,
        unit:          it.unit || 'kg',
        unit_cost:     product ? (product._cpu !== undefined ? product._cpu : costPerUnit(product)) : (it.line_cost / (it.quantity || 1)),
        pack_unit:     product ? (product._packUnit || packUnit(product)) : 'kg',
        sub_unit_name: product?.sub_unit_name || '',
        sub_unit_qty:  product?.sub_unit_qty  || 0,
        _manualUnit:   true,  // preserve saved unit — never auto-override
      });
    });
  } else {
    addIngredientLine();
  }

  recalcCosts();

  // Scroll to form
  document.querySelector('.recipe-form-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Delete Recipe ──────────────────────────────────────────────
async function deleteRecipe(id) {
  if (!confirm('Delete this recipe? This cannot be undone.')) return;
  try {
    // Delete items first
    const data = await apiGet(`tables/${RECIPE_ITEMS_TABLE}?page=1&limit=200`);
    const mine = (data.data || []).filter(i => i.recipe_id === id);
    for (const it of mine) await apiDelete(`tables/${RECIPE_ITEMS_TABLE}/${it.id}`);
    await apiDelete(`tables/${RECIPES_TABLE}/${id}`);
    closeModal('recipeDetailModal');
    showToast('Recipe deleted.', 'warning');
    await refreshRecipeItems();   // its lines are gone too
    await loadRecipes();
    if (document.getElementById('editRecipeId').value === id) clearRecipeForm();
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

// ── Produce Batch ──────────────────────────────────────────────
let pbRecipeId   = null;
let pbRecipeData = null;
let pbItems      = [];

async function openProduceBatchModal(recipeId) {
  const recipe = allRecipes.find(r => r.id === recipeId);
  if (!recipe) return;

  pbRecipeId   = recipeId;
  pbRecipeData = recipe;

  // Re-fetch live FIFO prices right now so costs are current
  await loadProductCatalogue();

  // Fetch recipe items
  try {
    const data = await apiGet(`tables/${RECIPE_ITEMS_TABLE}?page=1&limit=200`);
    pbItems = (data.data || []).filter(i => i.recipe_id === recipeId);
  } catch (_) { pbItems = []; }

  document.getElementById('pbRecipeName').textContent = recipe.name;
  document.getElementById('pbQty').value  = recipe.servings || '';
  setSelectValueCI_r(document.getElementById('pbUnit'), recipe.yield_unit || 'kg');
  document.getElementById('pbNote').value = '';

  updatePbPreview();
  closeModal('recipeDetailModal');
  openModal('produceBatchModal');
}

function updatePbPreview() {
  const container = document.getElementById('pbIngredientPreview');
  if (!pbRecipeData) { container.innerHTML = ''; return; }

  const batchQty  = parseFloat(document.getElementById('pbQty').value)  || 0;
  const batchUnit = document.getElementById('pbUnit').value || 'kg';
  const recipeYieldQty  = parseFloat(pbRecipeData.servings)   || 1;
  const recipeYieldUnit = (pbRecipeData.yield_unit || 'kg');

  if (!batchQty || !pbItems.length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:.85rem">Enter a batch quantity to see ingredient deductions.</div>';
    return;
  }

  // Scale factor: how many times the base recipe is being made. Yield scaling has
  // no avg-weight bridge; keep the historic factor-of-1 fallback for mismatched units.
  const scaleFactor = (batchQty * (unitConversionFactor(batchUnit, recipeYieldUnit) ?? 1)) / recipeYieldQty;

  let totalBatchCost = 0;

  let html = `<div style="font-size:.82rem;font-weight:600;color:var(--text-muted);margin-bottom:.4rem">
    Ingredients to deduct — live FIFO prices:
  </div>`;
  html += '<div class="pb-deduction-list">';

  pbItems.forEach(it => {
    const prod      = allProducts.find(p => p.id === it.product_id);
    const deductQty = (parseFloat(it.quantity) || 0) * scaleFactor;
    const unit      = it.unit || 'unit';
    const display   = deductQty % 1 === 0 ? deductQty : deductQty.toFixed(3).replace(/\.?0+$/, '');

    // Live cost: use FIFO unit cost from allProducts + conversion factor
    let lineCost = 0;
    if (prod) {
      const row = {
        product_id:    prod.id,
        quantity:      deductQty,
        unit:          unit,
        unit_cost:     prod._cpu !== undefined ? prod._cpu : costPerUnit(prod),
        pack_unit:     prod._packUnit || packUnit(prod),
        sub_unit_name: prod.sub_unit_name || '',
        sub_unit_qty:  prod.sub_unit_qty  || 0,
      };
      lineCost = calcIngredientLineCost(row);
    }
    totalBatchCost += isUncostable(lineCost) ? 0 : lineCost;

    const costStr = prod ? ` <span style="color:var(--text-muted);font-size:.78rem">(${fmtLineCost(lineCost)})</span>` : '';

    html += `<div class="pb-deduction-row">
      <span><i class="fas fa-minus-circle" style="color:#dc2626"></i> ${esc(it.product_name)}${costStr}</span>
      <span style="font-weight:600">${display} ${esc(unit)}</span>
    </div>`;
  });

  html += '</div>';

  // Live total cost box
  html += `<div style="margin-top:.75rem;padding:.6rem .9rem;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;display:flex;justify-content:space-between;align-items:center">
    <span style="font-size:.85rem;font-weight:600;color:#166534"><i class="fas fa-calculator"></i> Estimated Batch Cost (live)</span>
    <span style="font-size:1rem;font-weight:700;color:#16a34a">${fmt(totalBatchCost)}</span>
  </div>`;

  container.innerHTML = html;
}

// Reload unit dropdowns after manage-units changes
registerUnitRefreshCallback(async () => {
  if (!document.getElementById('recipeYieldUnit')) return;
  const ud = await apiGet(`tables/units?page=1&limit=100`);
  allUnits_r = (ud.data || []).slice().sort((a, b) => a.sort_order - b.sort_order);
  populateUnitDropdown_r(document.getElementById('recipeYieldUnit'));
  populateUnitDropdown_r(document.getElementById('pbUnit'));
  // Rebuild ingredient line unit dropdowns, preserving selected value
  ingredientRows.forEach((row, idx) => {
    if (!row) return;
    const unitSel = document.getElementById(`ing-unit-${idx}`);
    if (!unitSel) return;
    const product = row.product_id ? allProducts.find(p => p.id === row.product_id) : null;
    const currentUnit = unitSel.value !== '__manage_units__' ? unitSel.value : (row.unit || '');
    unitSel.innerHTML = buildUnitOptions(currentUnit, product);
    unitSel.dataset.prevUnit = unitSel.value;
  });
});

async function confirmProduceBatch() {
  const batchQty  = parseFloat(document.getElementById('pbQty').value);
  const batchUnit = document.getElementById('pbUnit').value;
  const note      = document.getElementById('pbNote').value.trim();

  if (!batchQty || batchQty <= 0) { showToast('Enter a valid batch quantity.', 'error'); return; }
  if (!pbRecipeData) return;

  const recipeYieldQty  = parseFloat(pbRecipeData.servings) || 1;
  const recipeYieldUnit = pbRecipeData.yield_unit || 'kg';
  const scaleFactor     = (batchQty * (unitConversionFactor(batchUnit, recipeYieldUnit) ?? 1)) / recipeYieldQty;
  const reason          = note ? `Batch production: ${pbRecipeData.name} — ${note}` : `Batch production: ${pbRecipeData.name}`;

  const btn = document.getElementById('confirmProduceBatchBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing…';

  try {
    // 0. Pressing this button IS the declaration that the recipe is made ahead,
    //    so record it rather than asking. It closes the last way left to
    //    double-count: a recipe on 'on_demand' that gets produced anyway takes
    //    its ingredients here AND again on every sale, while the bin it filled
    //    is never drawn down.
    //
    //    Deliberately BEFORE the stock moves. If this succeeds and production
    //    then fails, the recipe is 'batched' with an empty bin — which sales now
    //    handle by falling through to raw materials, so it costs nothing. The
    //    other order would leave the double-count standing on a failure.
    let flipped = false;
    if ((pbRecipeData.production_mode || 'on_demand') !== 'batched') {
      await apiPatch(`tables/${RECIPES_TABLE}/${pbRecipeId}`, { production_mode: 'batched' });
      pbRecipeData.production_mode = 'batched';   // a reference into allRecipes
      flipped = true;
    }

    // 1. Deduct each ingredient from Raw Materials inventory
    for (const it of pbItems) {
      const prod      = allProducts.find(p => p.id === it.product_id);
      const deductQty = (parseFloat(it.quantity) || 0) * scaleFactor;
      if (deductQty <= 0) continue;
      await window.invHelpers.upsertInventory({
        itemId:    it.product_id,
        itemType:  'raw_material',
        itemName:  it.product_name,
        category:  prod?.category || 'Other',
        unit:      it.unit || 'kg',
        change:    -deductQty,
        reason,
      });
    }

    // 2. Add produced batch to Batch inventory
    await window.invHelpers.upsertInventory({
      itemId:    pbRecipeId,
      itemType:  'batch',
      itemName:  pbRecipeData.name,
      category:  'Batch',
      unit:      batchUnit,
      change:    batchQty,
      reason,
    });

    // Say it out loud the once. Changing how a recipe is costed without telling
    // anyone would be worse than asking.
    showToast(
      flipped
        ? `Batch recorded: ${batchQty} ${batchUnit} of ${pbRecipeData.name} — now tracked as made ahead, so sales draw down this batch first`
        : `Batch recorded: ${batchQty} ${batchUnit} of ${pbRecipeData.name}`,
      'success'
    );
    closeModal('produceBatchModal');

    // Reload live prices so subsequent opens / recipe detail reflects new inventory levels
    await loadProductCatalogue();
  } catch (e) {
    showToast('Failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-blender"></i> Confirm Production';
  }
}
