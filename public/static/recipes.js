/* ===== recipes.js ===== */

const RECIPES_TABLE      = 'recipes';
const RECIPE_ITEMS_TABLE = 'recipe_items';
const PRODUCTS_TABLE_R   = 'generic_products';  // two-level model

let allProducts    = [];      // product catalogue
let ingredientRows = [];      // [{product_id, product_name, quantity, unit, unit_cost}]
let allRecipes     = [];      // full recipe list
let currentDetailId = null;
let allUnits_r     = [];      // units table rows, sorted by sort_order

// ── Bootstrap ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('recipeName')) return; // guard

  await Promise.all([loadProductCatalogue(), loadRecipes(), loadUnits()]);

  document.getElementById('addIngredientBtn').addEventListener('click', addIngredientLine);
  document.getElementById('saveRecipeBtn').addEventListener('click', saveRecipe);
  document.getElementById('clearRecipeBtn').addEventListener('click', clearRecipeForm);
  document.getElementById('recipeYieldQty').addEventListener('input',  recalcCosts);
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
// Prefer dedicated pack_qty / pack_unit columns (written by products.js); fall back to parsing legacy pack_size.
function packQty(p) {
  if (p.pack_qty != null && p.pack_qty !== '') return parseFloat(p.pack_qty) || 1;
  const m = (p.pack_size || '').match(/^([\d.]+)/);
  return m ? parseFloat(m[1]) : 1;
}
function packUnit(p) {
  if (p.pack_unit) return p.pack_unit;
  const m = (p.pack_size || '').match(/[\d.]+\s*(.+)$/);
  return m ? m[1].trim() : 'unit';
}
// Cost per single base unit (e.g. per kg, per L)
function costPerUnit(p) {
  const qty = packQty(p);
  return qty > 0 ? (p.cost || 0) / qty : (p.cost || 0);
}

// Conversion factor: how many "recipeUnit" equal 1 "packUnit"
// Returns a multiplier so that:  line_cost = unit_cost_per_packUnit × quantity × conversionFactor
// e.g. packUnit=kg, recipeUnit=g  → 1g = 0.001kg → factor = 0.001
// e.g. packUnit=g,  recipeUnit=kg → 1kg = 1000g  → factor = 1000
function unitConversionFactor(packUnitStr, recipeUnitStr) {
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
    const [gd, ed, invd] = await Promise.all([
      apiGet(`tables/generic_products?page=1&limit=500`),
      apiGet(`tables/product_entries?page=1&limit=1000`),
      apiGet(`tables/inventory?page=1&limit=500`),
    ]);
    const allEntries_r  = ed.data  || [];
    const allInventory_r = invd.data || [];

    allProducts = (gd.data || []).map(g => {
      // All entries for this generic product, sorted oldest purchase first (FIFO order)
      const entries = allEntries_r
        .filter(e => e.generic_product_id === g.id)
        .sort((a, b) => (a.purchase_date || '') > (b.purchase_date || '') ? 1 : -1);

      if (!entries.length) {
        return {
          id: g.id, name: g.name, category: g.category,
          pack_size: '', cost: 0,
          sub_unit_name: g.sub_unit_name || '', sub_unit_qty: g.sub_unit_qty || 0,
          _cpu: 0, _packUnit: 'unit',
        };
      }

      // Find current inventory quantity for this product (in its base unit)
      const invRow   = allInventory_r.find(r => r.item_id === g.id && r.item_type === 'raw_material');
      const invQty   = parseFloat(invRow?.quantity) || 0;

      // Walk entries FIFO: consume stock batch by batch to find the active price layer
      const activeEntry = fifoActiveEntry(entries, invQty);

      const packSz  = activeEntry.pack_size || '';
      const pqMatch = packSz.match(/^([\d.]+)/);
      const puMatch = packSz.match(/[\d.]+\s*(.+)$/);
      // Prefer dedicated columns (written by products.js); fall back to parsing pack_size string.
      const pQty    = (activeEntry.pack_qty != null && activeEntry.pack_qty !== '')
           ? (parseFloat(activeEntry.pack_qty) || 1)
           : (pqMatch ? parseFloat(pqMatch[1]) : 1);
      const pUnit   = activeEntry.pack_unit || (puMatch ? puMatch[1].trim() : 'unit');
      const cpu     = (activeEntry.cost_per_unit != null && activeEntry.cost_per_unit > 0)
           ? activeEntry.cost_per_unit
           : (pQty > 0 ? activeEntry.cost / pQty : 0);

      return {
        id:            g.id,
        name:          g.name,
        category:      g.category,
        pack_size:     packSz,
        pack_qty:      pQty,
        pack_unit:     pUnit,
        cost:          activeEntry.cost || 0,
        sub_unit_name: g.sub_unit_name || '',
        sub_unit_qty:  g.sub_unit_qty  || 0,
        _cpu:          cpu,
        _packUnit:     pUnit,
      };
    });
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
function fifoActiveEntry(sortedEntries, invQty) {
  if (!sortedEntries.length) return null;

  // Sum all purchased quantities to find total ever bought
  let totalPurchased = 0;
  for (const entry of sortedEntries) {
    const m = (entry.pack_size || '').match(/^([\d.]+)/);
    totalPurchased += m ? parseFloat(m[1]) : 1;
  }

  // How much has already been consumed
  const consumed = Math.max(0, totalPurchased - Math.max(0, invQty));

  // Walk oldest→newest: the first entry whose running cumulative total
  // exceeds the consumed amount is the active (currently being drawn) batch
  let cumulative = 0;
  for (const entry of sortedEntries) {
    const m    = (entry.pack_size || '').match(/^([\d.]+)/);
    const pQty = m ? parseFloat(m[1]) : 1;
    cumulative += pQty;
    if (cumulative > consumed) return entry;
  }

  // All batches exhausted (inventory ≤ 0) → use the newest entry
  return sortedEntries[sortedEntries.length - 1];
}

// ── Ingredient Lines ───────────────────────────────────────────
function addIngredientLine(prefill = null) {
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
  const prefillName = selectedProduct ? esc(selectedProduct.name) : '';

  div.innerHTML = `
    <div class="form-group" style="position:relative">
      ${idx === 0 ? '<label>Product</label>' : '<label>&nbsp;</label>'}
      <input type="text" id="ing-prod-input-${idx}" value="${prefillName}" placeholder="Type to search…" autocomplete="off"
             oninput="onProductSearch(${idx})" onblur="hideProductSuggestions(${idx})" />
      <input type="hidden" id="ing-prod-${idx}" value="${esc(row.product_id || '')}" />
      <div id="ing-prod-suggestions-${idx}" class="product-suggestions"></div>
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

  _updateIngCostDisplay(idx);
  recalcCosts();
}

function _updateIngCostDisplay(idx) {
  const el = document.getElementById(`ing-cpu-${idx}`);
  if (!el) return;
  const r = ingredientRows[idx];
  if (!r || !r.product_id || !r.unit_cost || !r.pack_unit) { el.textContent = ''; return; }
  const unit   = r.unit || r.pack_unit;
  const factor = unitConversionFactor(r.pack_unit, unit);
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

  // Block weight ↔ volume swaps — check the two unit values being switched between
  if (newUnit !== prevUnit) {
    const WEIGHT     = ['kg', 'g', 'lb'];
    const VOLUME     = ['l', 'ml'];
    const fromU      = prevUnit.toLowerCase().trim();
    const toU        = newUnit.toLowerCase().trim();
    const impossible = (WEIGHT.includes(fromU) && VOLUME.includes(toU)) ||
                       (VOLUME.includes(fromU) && WEIGHT.includes(toU));
    if (impossible) {
      sel.value = prevUnit;
      showToast(`Cannot convert ${prevUnit} to ${newUnit} — unit reset.`, 'warning');
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
function onProductSearch(idx) {
  const input          = document.getElementById(`ing-prod-input-${idx}`);
  const hidden         = document.getElementById(`ing-prod-${idx}`);
  const suggestionsDiv = document.getElementById(`ing-prod-suggestions-${idx}`);
  const query          = input.value.trim().toLowerCase();

  hidden.value = '';

  if (query.length < 3) {
    suggestionsDiv.style.display = 'none';
    return;
  }

  const matches = allProducts.filter(p => p.name.toLowerCase().includes(query));

  if (!matches.length) {
    suggestionsDiv.innerHTML = '<div class="product-suggestion-empty">No products found</div>';
    suggestionsDiv.style.display = 'block';
    return;
  }

  suggestionsDiv.innerHTML = matches.map(p =>
    `<div class="product-suggestion-item" onmousedown="selectProduct(${idx}, '${esc(p.id)}')">${esc(p.name)}</div>`
  ).join('');
  suggestionsDiv.style.display = 'block';
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
}

function activeRows() {
  return ingredientRows.filter(r => r && r.product_id);
}

function recalcCosts() {
  const yieldQty  = parseFloat(document.getElementById('recipeYieldQty').value) || 1;
  const yieldUnit = document.getElementById('recipeYieldUnit').value || 'kg';
  let total = 0;
  activeRows().forEach(r => {
    total += calcIngredientLineCost(r);
  });
  document.getElementById('totalCostDisplay').textContent       = fmt(total);
  document.getElementById('costPerServingDisplay').textContent  = fmt(total / yieldQty);
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

  // Standard path: use unit conversion factor
  const factor = unitConversionFactor(r.pack_unit || 'kg', r.unit || 'kg');
  return (r.unit_cost || 0) * (r.quantity || 1) * factor;
}

// ── Save Recipe ────────────────────────────────────────────────
async function saveRecipe() {
  const name      = document.getElementById('recipeName').value.trim();
  const desc      = document.getElementById('recipeDesc').value.trim();
  const yieldQty  = parseFloat(document.getElementById('recipeYieldQty').value) || 1;
  const yieldUnit = document.getElementById('recipeYieldUnit').value || 'kg';
  const editId    = document.getElementById('editRecipeId').value;

  if (!name) { showToast('Recipe name is required.', 'error'); return; }

  const items = activeRows();
  if (!items.length) { showToast('Add at least one ingredient.', 'error'); return; }

  let total = 0;
  items.forEach(r => {
    total += calcIngredientLineCost(r);
  });

  const btn = document.getElementById('saveRecipeBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

  try {
    let recipeId;

    if (editId) {
      // Update recipe
      await apiPut(`tables/${RECIPES_TABLE}/${editId}`, { name, description: desc, servings: yieldQty, yield_unit: yieldUnit, total_cost: total });
      recipeId = editId;
      // Delete old items
      const oldItems = await apiGet(`tables/${RECIPE_ITEMS_TABLE}?page=1&limit=200`);
      const mine = (oldItems.data || []).filter(i => i.recipe_id === recipeId);
      for (const it of mine) {
        await apiDelete(`tables/${RECIPE_ITEMS_TABLE}/${it.id}`);
      }
      showToast('Recipe updated!', 'success');
    } else {
      const recipe = await apiPost(`tables/${RECIPES_TABLE}`, { name, description: desc, servings: yieldQty, yield_unit: yieldUnit, total_cost: total });
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
        line_cost:    (r.unit_cost || 0) * (r.quantity || 1),
      });
    }

    clearRecipeForm();
    await loadRecipes();
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save Recipe';
  }
}

// ── Clear Form ─────────────────────────────────────────────────
function clearRecipeForm() {
  document.getElementById('editRecipeId').value    = '';
  document.getElementById('recipeName').value      = '';
  document.getElementById('recipeDesc').value      = '';
  document.getElementById('recipeYieldQty').value  = '';
  setSelectValueCI_r(document.getElementById('recipeYieldUnit'), 'kg');
  document.getElementById('recipeFormTitle').innerHTML = '<i class="fas fa-plus-circle"></i> New Recipe';
  document.getElementById('ingredientLines').innerHTML = '';
  ingredientRows = [];
  addIngredientLine();
  recalcCosts();
}

// ── Load Recipes ───────────────────────────────────────────────
async function loadRecipes() {
  try {
    const data = await apiGet(`tables/${RECIPES_TABLE}?page=1&limit=200`);
    allRecipes = data.data || [];
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

  container.innerHTML = list.map(r => `
    <div class="recipe-card" onclick="openRecipeDetail('${esc(r.id)}')">
      <div>
        <div class="recipe-card-name">${esc(r.name)}</div>
        ${r.description ? `<div class="recipe-card-desc">${esc(r.description)}</div>` : ''}
        <div class="recipe-card-meta">${r.servings ? `<i class="fas fa-weight-hanging"></i> ${r.servings} ${esc(r.yield_unit || 'kg')} yield` : ''}</div>
      </div>
      <div style="text-align:right">
        <div class="recipe-card-cost">${fmt(r.total_cost)}</div>
        ${r.servings ? `<div class="recipe-card-meta">${fmt((r.total_cost||0)/r.servings)} / ${esc(r.yield_unit || 'kg')}</div>` : ''}
      </div>
    </div>
  `).join('');
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
      totalCost += calcIngredientLineCost(row);
    });
  } else {
    totalCost = recipe.total_cost || 0; // fallback to saved value
  }

  let body = `
    <div class="detail-section-title">Recipe Info</div>
    <div class="detail-info-grid">
      ${recipe.description ? `<div class="detail-info-item"><span>Description</span><span>${esc(recipe.description)}</span></div>` : ''}
      <div class="detail-info-item"><span>Yield</span><span>${recipe.servings ? recipe.servings + ' ' + esc(yieldUnit) : '—'}</span></div>
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
          <td><strong>${fmt(lineCost)}</strong></td>
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

// ── Load Recipe into Form (Edit) ───────────────────────────────
async function loadRecipeIntoForm(id) {
  const recipe = allRecipes.find(r => r.id === id);
  if (!recipe) return;

  document.getElementById('editRecipeId').value    = id;
  document.getElementById('recipeName').value      = recipe.name || '';
  document.getElementById('recipeDesc').value      = recipe.description || '';
  document.getElementById('recipeYieldQty').value  = recipe.servings || '';
  setSelectValueCI_r(document.getElementById('recipeYieldUnit'), recipe.yield_unit || 'kg');
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

  // Scale factor: how many times the base recipe is being made
  const scaleFactor = (batchQty * unitConversionFactor(batchUnit, recipeYieldUnit)) / recipeYieldQty;

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
    totalBatchCost += lineCost;

    const costStr = prod ? ` <span style="color:var(--text-muted);font-size:.78rem">(${fmt(lineCost)})</span>` : '';

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
  const scaleFactor     = (batchQty * unitConversionFactor(batchUnit, recipeYieldUnit)) / recipeYieldQty;
  const reason          = note ? `Batch production: ${pbRecipeData.name} — ${note}` : `Batch production: ${pbRecipeData.name}`;

  const btn = document.getElementById('confirmProduceBatchBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing…';

  try {
    // 1. Deduct each ingredient from Raw Materials inventory
    for (const it of pbItems) {
      const prod      = allProducts.find(p => p.id === it.product_id);
      const deductQty = (parseFloat(it.quantity) || 0) * scaleFactor;
      if (deductQty <= 0) continue;
      await window.invHelpers.upsertInventory({
        itemId:    it.product_id,
        itemType:  'raw_material',
        itemName:  it.product_name,
        category:  prod?.category || 'Ingredients',
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

    showToast(`Batch recorded: ${batchQty} ${batchUnit} of ${pbRecipeData.name}`, 'success');
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
