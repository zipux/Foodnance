/* ===== stock-take.js ===== */

let stockTake = null;        // the active stock_takes row
let snapshotItems = [];      // stock_take_items rows (snapshot of inventory at start)
// In-memory state per snapshot id: { counted: string, reason: string }
const inputState = new Map();
// Debounce timers for autosave per snapshot id
const saveTimers = new Map();

// Pack-size config per raw_material product id (only products that use pack
// levels): { base_unit, mid_name, mid_lb, top_name, top_lb }. Lets a product be
// counted by case / bag / loose weight, all summed to one base-weight figure.
const packByProductId = new Map();
// Per-snapshot box entries for pack items: { top: string, mid: string, base: string }
const packBoxState = new Map();

// Weight conversion + pack maths live in utils.js (shared with the Adjust Stock
// modal on the inventory page). Thin local aliases keep this file readable.
const convWeight = pkConvWeight;

// Pack config for a snapshot row, but only when it can be safely reconciled to
// the row's stored unit (same unit, or both convertible weights). Otherwise the
// row falls back to the plain single-count input.
function packInfoFor(it) {
  if (it.item_type !== 'raw_material') return null;
  return pkInfoFor(packByProductId.get(it.item_id), it.unit);
}

const TYPE_META = {
  raw_material:     { label: 'Raw Materials',     icon: 'fa-seedling' },
  batch:            { label: 'Batches',           icon: 'fa-blender' },
  finished_product: { label: 'Finished Products', icon: 'fa-box-open' },
};
const TYPE_ORDER = ['raw_material', 'batch', 'finished_product'];

/* ── Grouping by storage section ─────────────────────────────
 * A stock take is walked place by place, so the screen is grouped by the
 * user's storage sections (Fridge 1, Dry Store…) in their chosen walk order,
 * and within a section by the order they arranged the shelves. Set up on the
 * Storage Layout page; see migration 0030.
 *
 * Until any section exists the page falls back to the old grouping by item
 * type, so this is not a cliff for anyone who has not set a layout up yet.
 */
const UNPLACED = '__unplaced__';
// `${item_type}:${item_id}` → { section_id, section_name, section_order, sort_order }
const placementByItem = new Map();
let   sectionsOrdered = [];   // [{ id, name }] in walk order
let   useSections     = false;

// ── Filters ──
let searchQuery = '';
let hideCounted = false;

/* ── Blind counting ──────────────────────────────────────────
 * Showing the system's expected figure while someone counts biases them toward
 * confirming it rather than reporting what is actually on the shelf — which
 * defeats the point of counting. In blind mode the expected quantity is
 * withheld until a count has been COMMITTED for that row, then revealed along
 * with the variance so a reason can be given.
 *
 * Revealed on blur, not on keystroke: revealing while the field still has focus
 * would show the target mid-entry and let it be "corrected" to match.
 *
 * Kept per-device (not per stock take) because it is a way of working. It is a
 * preference rather than an enforced policy — enforcing it for staff needs
 * accounts, which do not exist yet.
 */
const BLIND_PREF_KEY = 'invoicedb:prefs:blind-count';   // deliberately NOT under
                                                        // LS_PREFIX, which gets pruned
let blindCount = false;
const revealed = new Set();   // snapshot ids whose expected figure is now shown

function loadBlindPref() {
  try { blindCount = localStorage.getItem(BLIND_PREF_KEY) === '1'; } catch (_) { blindCount = false; }
}
function saveBlindPref() {
  try { localStorage.setItem(BLIND_PREF_KEY, blindCount ? '1' : '0'); } catch (_) {}
}

// Should this row's expected quantity be visible?
function expectedVisible(snapId) {
  return !blindCount || revealed.has(snapId);
}

// The expected figure, or a placeholder while it is being withheld.
function expectedHtml(it, forCard) {
  const cls = forCard ? 'st-card-expected' : 'st-expected';
  if (!expectedVisible(it.id)) {
    return `<span class="${cls} is-blind"><i class="fas fa-eye-slash"></i> hidden</span>`;
  }
  return forCard
    ? `<span class="${cls}">Expected <strong>${fmtQty(it.expected_qty)} ${esc(it.unit || '')}</strong></span>`
    : `<span class="${cls}">${fmtQty(it.expected_qty)}<span class="unit">${esc(it.unit || '')}</span></span>`;
}

/* ── Offline resilience ──────────────────────────────────────
 * Stock takes happen in walk-ins, cellars and dry stores — exactly the places
 * with no signal. Every keystroke is mirrored to localStorage FIRST, so the
 * count survives a dead connection, a killed tab or a flat battery. The server
 * autosave is best-effort on top of that: failures are queued and retried, and
 * the footer says plainly whether the server has the counts yet.
 */
const LS_PREFIX = 'invoicedb:stocktake:';
let   lsKey        = null;      // set once the stock take id is known
const pendingSaves = new Set(); // snapshot ids whose server save hasn't landed
let   retryTimer   = null;

/* ── One view at a time ──────────────────────────────────────
 * The desktop table and the mobile cards render the same items. Emitting both
 * and letting CSS hide one doubles the DOM and the number of live inputs — at a
 * few hundred items that is real weight on a phone. Render only what the
 * viewport will actually show, and re-render if the breakpoint is crossed.
 * Both Maps of state live outside the DOM, so a re-render loses nothing.
 */
const MOBILE_MQ = typeof window.matchMedia === 'function'
  ? window.matchMedia('(max-width: 767px)')
  : null;
let isMobileView = MOBILE_MQ ? MOBILE_MQ.matches : false;

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('stDate').textContent = todayYMD();
  document.getElementById('stCancelBtn').addEventListener('click', cancelStockTake);
  document.getElementById('stSubmitBtn').addEventListener('click', submitStockTake);

  // Coming back online is the moment to drain the queue.
  window.addEventListener('online',  () => { updateSyncStatus(); flushPending(); });
  window.addEventListener('offline', updateSyncStatus);

  // Rotating a phone or resizing a window can cross the breakpoint.
  MOBILE_MQ?.addEventListener?.('change', e => {
    isMobileView = e.matches;
    if (snapshotItems.length) render();
  });

  document.getElementById('stSearch').addEventListener('input', e => {
    searchQuery = e.target.value;
    render();
  });
  document.getElementById('stHideCounted').addEventListener('change', e => {
    hideCounted = e.target.checked;
    render();
  });

  loadBlindPref();
  document.getElementById('stBlindCount').checked = blindCount;
  document.getElementById('stBlindCount').addEventListener('change', e => {
    blindCount = e.target.checked;
    saveBlindPref();
    // Turning blind mode back ON re-hides rows that have not been counted; rows
    // already counted stay revealed, since their figure is out of the bag.
    render();
  });

  // Pre-submit summary
  document.getElementById('stSubmitModalClose').addEventListener('click', () => closeModal('stSubmitModal'));
  document.getElementById('stSubmitCancel').addEventListener('click',      () => closeModal('stSubmitModal'));
  document.getElementById('stSubmitConfirm').addEventListener('click', confirmSubmit);
  document.querySelectorAll('input[name="stUncountedAction"]').forEach(r => {
    r.addEventListener('change', () => {
      const zeroing = document.querySelector('input[name="stUncountedAction"]:checked').value === 'zero';
      document.getElementById('stZeroReasonWrap').classList.toggle('hidden', !zeroing);
    });
  });

  await loadOrStart();
});

// Write the whole in-progress count to localStorage. Called on every change —
// the payload is a few KB even for a large inventory, and losing a count is far
// more expensive than the write.
function persistLocal() {
  if (!lsKey || !stockTake?.id) return;
  try {
    localStorage.setItem(lsKey, JSON.stringify({
      stock_take_id: stockTake.id,
      saved_at:      Date.now(),
      inputs:        Object.fromEntries(inputState),
      packs:         Object.fromEntries(packBoxState),
    }));
  } catch (_) {
    // Quota or private mode — server autosave is still in play.
  }
}

// Overlay any locally-saved counts on top of what the server returned. Local
// always wins: it's written on every keystroke, the server only on a successful
// autosave, so local is never staler. Returns how many rows it restored.
function restoreLocal() {
  if (!lsKey) return 0;
  let raw = null;
  try { raw = localStorage.getItem(lsKey); } catch (_) { return 0; }
  if (!raw) return 0;

  try {
    const data = JSON.parse(raw);
    if (data.stock_take_id !== stockTake.id) return 0;

    const known = new Set(snapshotItems.map(s => s.id));
    let restored = 0;
    for (const [id, st] of Object.entries(data.inputs || {})) {
      if (!known.has(id)) continue;   // row no longer in this take
      inputState.set(id, st);
      if ((st.counted || '').trim() !== '') restored++;
    }
    for (const [id, bs] of Object.entries(data.packs || {})) {
      if (known.has(id)) packBoxState.set(id, bs);
    }
    return restored;
  } catch (_) {
    return 0;
  }
}

function clearLocal() {
  try { if (lsKey) localStorage.removeItem(lsKey); } catch (_) {}
}

// Drop storage left behind by earlier takes so it can't grow without bound.
function pruneLocal() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX) && k !== lsKey) localStorage.removeItem(k);
    }
  } catch (_) {}
}

function updateSyncStatus() {
  const el = document.getElementById('stSyncStatus');
  if (!el) return;
  const n = pendingSaves.size;

  if (!navigator.onLine) {
    el.className = 'st-sync offline';
    el.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Offline — counts saved on this device`;
  } else if (n) {
    el.className = 'st-sync pending';
    el.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Saving ${n} count${n === 1 ? '' : 's'}…`;
  } else {
    el.className = 'st-sync ok';
    el.innerHTML = `<i class="fas fa-check"></i> All counts saved`;
  }
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => { retryTimer = null; flushPending(); }, 5000);
}

// Retry every queued save. Anything still failing re-arms the timer.
async function flushPending() {
  if (!pendingSaves.size) return;
  for (const id of [...pendingSaves]) await autosaveItem(id);
  if (pendingSaves.size) scheduleRetry();
}

const round6 = pkRound6;

// Fetch the user's storage layout so items can be grouped and ordered the way
// they are physically stored. Non-fatal: without it we fall back to item type.
async function loadStorageLayout() {
  try {
    const res = await fetch('/api/storage-layout');
    if (!res.ok) return;
    const data = await res.json();
    const secs = data.sections || [];
    sectionsOrdered = secs.map(s => ({ id: s.id, name: s.name }));
    secs.forEach((s, order) => {
      (s.items || []).forEach(it => {
        placementByItem.set(`${it.item_type}:${it.item_id}`, {
          section_id: s.id, section_name: s.name,
          section_order: order, sort_order: it.sort_order ?? 0,
        });
      });
    });
    // Only switch grouping once the user has actually built a layout.
    useSections = secs.length > 0;
  } catch (_) {
    useSections = false;
  }
}

// Fetch generic products and record pack-size config for those that use it.
async function loadPackConfig() {
  try {
    const res = await fetch('/api/tables/generic_products?page=1&limit=1000');
    if (!res.ok) return;
    const data = await res.json();
    for (const g of (data.data || [])) {
      const cfg = pkConfigFrom(g);   // null → no pack levels, count as today
      if (cfg) packByProductId.set(g.id, cfg);
    }
  } catch (_) {
    // Non-fatal — pack items just fall back to single-count entry.
  }
}

function todayYMD() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}/${mm}/${dd}`;
}

async function loadOrStart() {
  try {
    // POST /start is idempotent — returns existing in-progress take or creates one
    const res = await fetch('/api/stock-take/start', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' });
    if (!res.ok) throw new Error(`Start failed: ${res.status}`);
    const data = await res.json();

    stockTake = data.stock_take;
    snapshotItems = data.items || [];

    // Load pack-size config and the storage layout in parallel.
    await Promise.all([loadPackConfig(), loadStorageLayout()]);

    // Seed inputState from any previously-entered values on resume
    for (const it of snapshotItems) {
      const hasCount = it.counted_qty !== null && it.counted_qty !== undefined;
      inputState.set(it.id, {
        counted: hasCount ? String(it.counted_qty) : '',
        reason:  it.reason || '',
      });
      // For pack items on resume, put the whole saved amount in the loose box
      // (converted back to the base unit) so the boxes re-sum to the same total.
      const pack = packInfoFor(it);
      if (pack) {
        let baseLoose = '';
        if (hasCount) {
          const conv = convWeight(Number(it.counted_qty), it.unit, pack.base_unit);
          baseLoose = conv === null ? String(it.counted_qty) : String(round6(conv));
        }
        packBoxState.set(it.id, { top: '', mid: '', base: baseLoose });
      }
    }

    // Overlay anything saved on this device — it may be newer than the server
    // copy if the connection dropped mid-count.
    lsKey = LS_PREFIX + stockTake.id;
    pruneLocal();
    const restored = restoreLocal();

    // A row counted in an earlier session — on the server OR on this device —
    // has already had its figure revealed; re-hiding it on resume would only
    // obstruct explaining the variance. Must run AFTER the local overlay.
    for (const it of snapshotItems) if (hasCount(it.id)) revealed.add(it.id);

    if (restored) {
      showToast(`Restored ${restored} count${restored === 1 ? '' : 's'} saved on this device.`, 'warning');
    } else if (data.resumed) {
      showToast('Resumed your in-progress stock take.', 'warning');
    }

    document.getElementById('stLoading').style.display = 'none';
    document.getElementById('stBody').style.display = '';
    document.getElementById('stFooter').style.display = '';
    render();
    updateSyncStatus();

    // Anything restored locally may never have reached the server — push it.
    if (restored) {
      for (const [id, st] of inputState) {
        if ((st.counted || '').trim() !== '') pendingSaves.add(id);
      }
      updateSyncStatus();
      flushPending();
    }
  } catch (e) {
    document.getElementById('stLoading').innerHTML =
      `<i class="fas fa-exclamation-triangle"></i> Failed to load stock take: ${esc(e.message)}`;
  }
}

/**
 * Build the ordered list of groups to render.
 *
 * With a storage layout: one group per section in walk order, items inside in
 * the arranged order, then "Not placed yet" last so nothing is ever hidden
 * from a count. Without one: the original grouping by item type.
 */
function buildGroups() {
  if (!useSections) {
    const byType = {};
    for (const it of snapshotItems) (byType[it.item_type] = byType[it.item_type] || []).push(it);
    return TYPE_ORDER
      .filter(t => byType[t]?.length)
      .map(t => ({
        key:   t,
        label: TYPE_META[t].label,
        icon:  TYPE_META[t].icon,
        items: byType[t].sort((a, b) => (a.item_name || '').localeCompare(b.item_name || '')),
      }));
  }

  const bySection = new Map(sectionsOrdered.map(s => [s.id, []]));
  const unplaced = [];
  for (const it of snapshotItems) {
    const p = placementByItem.get(`${it.item_type}:${it.item_id}`);
    const bucket = p ? bySection.get(p.section_id) : null;
    if (bucket) bucket.push(it); else unplaced.push(it);
  }

  const groups = sectionsOrdered
    .map(s => ({
      key:   s.id,
      label: s.name,
      icon:  'fa-box-open',
      items: (bySection.get(s.id) || []).sort((a, b) => {
        const pa = placementByItem.get(`${a.item_type}:${a.item_id}`)?.sort_order ?? 0;
        const pb = placementByItem.get(`${b.item_type}:${b.item_id}`)?.sort_order ?? 0;
        return pa - pb;
      }),
    }))
    .filter(g => g.items.length);

  if (unplaced.length) {
    groups.push({
      key:   UNPLACED,
      label: 'Not placed yet',
      icon:  'fa-inbox',
      items: unplaced.sort((a, b) => (a.item_name || '').localeCompare(b.item_name || '')),
    });
  }
  return groups;
}

// Search matches name or category. "Hide counted" is applied only when the
// list is re-rendered — never mid-keystroke, so a row cannot vanish from under
// the finger that is still typing into it.
function visibleItems(items) {
  const q = searchQuery.trim().toLowerCase();
  return items.filter(it => {
    if (hideCounted && hasCount(it.id)) return false;
    if (!q) return true;
    return (it.item_name || '').toLowerCase().includes(q)
        || (it.category  || '').toLowerCase().includes(q);
  });
}

function render() {
  const body = document.getElementById('stBody');

  if (!snapshotItems.length) {
    body.innerHTML = `<div class="st-loading"><i class="fas fa-box-open"></i> No inventory items to count.</div>`;
    updateProgress();
    return;
  }

  document.getElementById('stFilters').style.display = '';

  let html = '';
  let shown = 0;
  for (const g of buildGroups()) {
    const items = visibleItems(g.items);
    if (!items.length) continue;          // group empty under the current filter
    shown += items.length;
    const countedInGroup = g.items.filter(it => hasCount(it.id)).length;

    html += `
      <section class="st-group" data-group-key="${esc(g.key)}">
        <div class="st-group-header">
          <i class="fas ${g.icon}"></i> ${esc(g.label)}
          <span class="st-group-count">${countedInGroup} / ${g.items.length} counted</span>
        </div>
        ${isMobileView ? renderCards(items) : renderTable(items)}
      </section>
    `;
  }

  if (!html) {
    html = `<div class="st-loading"><i class="fas fa-search"></i> ${
      hideCounted && !searchQuery.trim()
        ? 'Everything has been counted.'
        : 'No items match your search.'
    }</div>`;
  }

  body.innerHTML = html;
  attachInputListeners();
  updateProgress();
  updateFilterNote(shown);
}

// Tell the user when the list they are looking at is not the whole list.
function updateFilterNote(shown) {
  const el = document.getElementById('stFilterNote');
  if (!el) return;
  const total = snapshotItems.length;
  if (shown >= total) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = `<i class="fas fa-filter"></i> Showing ${shown} of ${total} items.`
    + ` <a href="#" id="stClearFilters">Show all</a>`;
  document.getElementById('stClearFilters').addEventListener('click', e => {
    e.preventDefault();
    searchQuery = '';
    hideCounted = false;
    document.getElementById('stSearch').value = '';
    document.getElementById('stHideCounted').checked = false;
    render();
  });
}

function hasCount(snapId) {
  const s = inputState.get(snapId);
  if (!s) return false;
  const v = (s.counted || '').trim();
  return v !== '' && !isNaN(parseFloat(v));
}

function renderTable(items) {
  return `
    <table class="st-table">
      <thead>
        <tr>
          <th>Item</th>
          <th>Expected</th>
          <th>Counted</th>
          <th>Variance</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(rowHtml).join('')}
      </tbody>
    </table>
  `;
}

function rowHtml(it) {
  const state = inputState.get(it.id) || { counted: '', reason: '' };
  const counted = state.counted;
  const reason  = state.reason;
  const hasC    = hasCount(it.id);
  const variance = hasC ? (parseFloat(counted) - (parseFloat(it.expected_qty) || 0)) : null;
  const rowCls = hasC
    ? (variance !== 0 ? 'has-variance' : 'has-count')
    : '';
  const pack = packInfoFor(it);
  const countedCell = pack
    ? packInputsHtml(it, pack)
    : `<input type="number" step="any" inputmode="decimal" class="st-input st-count-input"
               data-snap-id="${esc(it.id)}"
               value="${esc(counted)}"
               placeholder="0" />`;
  return `
    <tr class="${rowCls}" data-snap-id="${esc(it.id)}">
      <td>
        <div class="st-name">${esc(it.item_name)}</div>
        ${it.category ? `<div class="st-cat">${esc(it.category)}</div>` : ''}
      </td>
      <td class="st-expected-cell">${expectedHtml(it, false)}</td>
      <td>${countedCell}</td>
      <td>${varianceHtml(variance, it.unit)}</td>
      <td>${reasonHtml(it.id, reason, hasC && variance !== 0, variance)}</td>
    </tr>
  `;
}

// Multi-box entry for a pack item: one box per active level (top → mid → base),
// with a live total shown in the row's stored unit.
function packInputsHtml(it, pack) {
  return pkBoxesHtml({
    key:        it.id,
    pack,
    unit:       it.unit || pack.base_unit,
    state:      packBoxState.get(it.id),
    inputClass: 'st-pack-input',
  });
}

// Total converted into the row's stored unit (what gets saved as counted_qty).
// null when nothing has been entered yet (= not counted).
function packTotalCounted(it, pack) {
  return pkTotalIn(packBoxState.get(it.id), pack, it.unit);
}

function renderCards(items) {
  return `
    <div class="st-cards">
      ${items.map(cardHtml).join('')}
    </div>
  `;
}

function cardHtml(it) {
  const state = inputState.get(it.id) || { counted: '', reason: '' };
  const counted = state.counted;
  const reason  = state.reason;
  const hasC    = hasCount(it.id);
  const variance = hasC ? (parseFloat(counted) - (parseFloat(it.expected_qty) || 0)) : null;
  const cardCls = hasC
    ? (variance !== 0 ? 'has-variance' : 'has-count')
    : '';
  const pack = packInfoFor(it);
  const countedInput = pack
    ? packInputsHtml(it, pack)
    : `<input type="number" step="any" inputmode="decimal" class="st-input st-count-input"
                 data-snap-id="${esc(it.id)}"
                 value="${esc(counted)}"
                 placeholder="0" />`;
  return `
    <div class="st-card ${cardCls}" data-snap-id="${esc(it.id)}">
      <div class="st-card-head">
        <div>
          <div class="st-card-name">${esc(it.item_name)}</div>
          ${it.category ? `<div class="st-card-cat">${esc(it.category)}</div>` : ''}
        </div>
        <div class="st-card-expected-wrap">${expectedHtml(it, true)}</div>
      </div>
      <!-- Pack items need the full card width: three boxes plus a running
           total do not fit in half of a phone screen. -->
      <div class="st-card-row${pack ? ' is-pack' : ''}">
        <div>
          <label>Counted</label>
          ${countedInput}
        </div>
        <div>
          <label>Reason</label>
          ${reasonHtml(it.id, reason, hasC && variance !== 0, variance)}
        </div>
      </div>
      <div class="st-card-variance-row">
        <span class="st-card-cat">Variance</span>
        ${varianceHtml(variance, it.unit)}
      </div>
    </div>
  `;
}

function varianceHtml(variance, unit) {
  if (variance === null) {
    return `<span class="st-variance"><span class="placeholder">—</span></span>`;
  }
  if (variance === 0) {
    return `<span class="st-variance zero">0 ${esc(unit || '')}</span>`;
  }
  const sign = variance > 0 ? '+' : '−';
  const abs  = Math.abs(variance);
  const cls  = variance > 0 ? 'pos' : 'neg';
  return `<span class="st-variance ${cls}">${sign}${fmtQty(abs)} ${esc(unit || '')}</span>`;
}

/**
 * Reason picker for a variance, using the shared STOCK_REASONS taxonomy so the
 * stock take and the Adjust Stock modal speak the same vocabulary and both feed
 * `reason_code`.
 *
 * Options depend on which way the variance went: counting MORE than expected is
 * an 'add' (an unrecorded delivery, say), counting less is a 'remove' (usage,
 * spillage, breakage…). Offering "Spillage" for a surplus would be nonsense.
 */
function reasonHtml(snapId, currentReason, visible, variance) {
  const cls = visible ? 'st-reason' : 'st-reason hidden-slot';
  const current = stockReasonCode(currentReason);
  // While no count is entered yet there is no direction — offer both sides so
  // a previously-saved selection still renders.
  const opts = variance == null || variance === 0
    ? STOCK_REASONS
    : stockReasonsFor(variance > 0 ? 'add' : 'remove');

  // Preserve an unrecognised legacy value (free text from before the codes
  // existed) rather than silently dropping it. A value that IS a known code but
  // does not belong in this direction is a different case — it gets dropped, so
  // flipping a shortfall into a surplus cannot leave "Spillage" attached to it.
  const isKnownCode = STOCK_REASONS.some(r => r.code === current);
  const extra = (current && !isKnownCode)
    ? `<option value="${esc(current)}" selected>${esc(current)}</option>`
    : '';

  const dir = variance == null || variance === 0 ? '' : (variance > 0 ? 'add' : 'remove');
  return `
    <select class="${cls} st-reason-select" data-snap-id="${esc(snapId)}" data-dir="${dir}" ${visible ? '' : 'tabindex="-1"'}>
      <option value="">Select reason…</option>
      ${extra}
      ${opts.map(o => `
        <option value="${esc(o.code)}" ${o.code === current ? 'selected' : ''}>${esc(o.label)}</option>
      `).join('')}
    </select>
  `;
}

const fmtQty = pkFmtQty;

function attachInputListeners() {
  document.querySelectorAll('.st-count-input').forEach(el => {
    el.addEventListener('input', onCountChange);
    el.addEventListener('blur', onCountBlur);
  });
  document.querySelectorAll('.st-pack-input').forEach(el => {
    el.addEventListener('input', onPackBoxChange);
    el.addEventListener('blur', onCountBlur);
  });
  document.querySelectorAll('.st-reason-select').forEach(el => {
    el.addEventListener('change', onReasonChange);
  });
}

// A pack box changed: recompute the row's total (in the stored unit), push it
// into inputState.counted so variance/progress/autosave all keep working, and
// refresh the live total shown next to the boxes.
function onPackBoxChange(e) {
  const snapId = e.target.dataset.packKey;   // set by pkBoxesHtml()
  const level  = e.target.dataset.level;
  const bs = packBoxState.get(snapId) || { top: '', mid: '', base: '' };
  bs[level] = e.target.value;
  packBoxState.set(snapId, bs);

  const it   = snapshotItems.find(s => s.id === snapId);
  const pack = it ? packInfoFor(it) : null;
  const total = pack ? packTotalCounted(it, pack) : null;

  const state = inputState.get(snapId) || { counted: '', reason: '' };
  state.counted = total === null ? '' : String(total);
  inputState.set(snapId, state);

  document.querySelectorAll(`[data-pack-total="${cssEscape(snapId)}"]`).forEach(el => {
    el.textContent = total === null ? '0' : fmtQty(total);
  });

  updateRow(snapId);
  scheduleAutosave(snapId);
}

// Leaving a field commits the count, which is the moment it is fair to reveal
// what the system expected. Once revealed a row stays revealed, so going back to
// correct a figure does not re-hide the variance being explained.
function onCountBlur(e) {
  if (!blindCount) return;
  const snapId = e.target.dataset.snapId || e.target.dataset.packKey;
  if (!snapId || revealed.has(snapId)) return;
  if (!hasCount(snapId)) return;
  revealed.add(snapId);
  updateRow(snapId);
}

function onCountChange(e) {
  const snapId = e.target.dataset.snapId;
  const state  = inputState.get(snapId) || { counted: '', reason: '' };
  state.counted = e.target.value;
  inputState.set(snapId, state);
  updateRow(snapId);
  scheduleAutosave(snapId);
}

function onReasonChange(e) {
  const snapId = e.target.dataset.snapId;
  const state  = inputState.get(snapId) || { counted: '', reason: '' };
  state.reason = e.target.value;
  inputState.set(snapId, state);
  scheduleAutosave(snapId);
}

function scheduleAutosave(snapId) {
  // Local first: durable before the network is even attempted.
  persistLocal();
  pendingSaves.add(snapId);
  updateSyncStatus();

  if (saveTimers.has(snapId)) clearTimeout(saveTimers.get(snapId));
  saveTimers.set(snapId, setTimeout(() => {
    saveTimers.delete(snapId);
    autosaveItem(snapId);
  }, 600));
}

async function autosaveItem(snapId) {
  if (!stockTake?.id) return;
  const state = inputState.get(snapId) || { counted: '', reason: '' };
  const c = (state.counted || '').trim();
  const counted_qty = c === '' ? null : parseFloat(c);
  try {
    const res = await fetch(`/api/stock-take/items/${snapId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      // reason holds the CODE; the label is resolved from the shared taxonomy.
      body: JSON.stringify({
        counted_qty,
        reason_code: state.reason || '',
        reason: stockReasonLabel(state.reason) || state.reason || '',
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pendingSaves.delete(snapId);
  } catch (_) {
    // Keep it queued and retry. The local copy is already safe, so this is a
    // sync delay rather than data loss — but the user is told either way.
    pendingSaves.add(snapId);
    scheduleRetry();
  }
  updateSyncStatus();
}

// Update a single row/card in place without re-rendering the whole list
function updateRow(snapId) {
  const snap = snapshotItems.find(s => s.id === snapId);
  if (!snap) return;
  const state   = inputState.get(snapId) || { counted: '', reason: '' };
  const hasC    = hasCount(snapId);
  const counted = parseFloat(state.counted);
  const variance = hasC ? (counted - (parseFloat(snap.expected_qty) || 0)) : null;
  const showReason = hasC && variance !== 0;

  // Find the table row
  const tr = document.querySelector(`tr[data-snap-id="${cssEscape(snapId)}"]`);
  if (tr) {
    tr.classList.remove('has-count', 'has-variance');
    if (hasC) tr.classList.add(variance !== 0 ? 'has-variance' : 'has-count');
    const expCell = tr.querySelector('.st-expected-cell');
    if (expCell) expCell.innerHTML = expectedHtml(snap, false);
    const varCell = tr.children[3];
    if (varCell) varCell.innerHTML = varianceHtml(variance, snap.unit);
    const reasonCell = tr.children[4];
    if (reasonCell) syncReasonSelect(reasonCell, snapId, state.reason, showReason, variance);
  }

  // Find the card
  const card = document.querySelector(`.st-card[data-snap-id="${cssEscape(snapId)}"]`);
  if (card) {
    card.classList.remove('has-count', 'has-variance');
    if (hasC) card.classList.add(variance !== 0 ? 'has-variance' : 'has-count');
    const expWrap = card.querySelector('.st-card-expected-wrap');
    if (expWrap) expWrap.innerHTML = expectedHtml(snap, true);
    const varSpan = card.querySelector('.st-card-variance-row .st-variance');
    if (varSpan) varSpan.outerHTML = varianceHtml(variance, snap.unit);
    const holder = card.querySelector('.st-reason-select')?.parentElement;
    if (holder) syncReasonSelect(holder, snapId, state.reason, showReason, variance);
  }

  updateProgress();
  updateGroupCounts();
}

/**
 * Keep a reason picker in step with the current variance.
 *
 * The option list depends on which way the variance went, so flipping from a
 * surplus to a shortfall has to rebuild it — otherwise you could leave
 * "Received / delivery" attached to a row that is now short. Rebuilding only
 * when the direction actually changes avoids clobbering a selection the user
 * just made.
 */
function syncReasonSelect(holder, snapId, reason, showReason, variance) {
  const sel = holder.querySelector('select');
  if (!sel) return;

  const dir = variance == null || variance === 0 ? '' : (variance > 0 ? 'add' : 'remove');
  if (sel.dataset.dir !== dir) {
    sel.outerHTML = reasonHtml(snapId, reason, showReason, variance);
    const fresh = holder.querySelector('select');
    if (fresh) {
      fresh.dataset.dir = dir;
      fresh.addEventListener('change', onReasonChange);
      // A reason that no longer applies in this direction is dropped rather
      // than left silently attached to the row.
      if (fresh.value !== stockReasonCode(reason)) {
        const state = inputState.get(snapId);
        if (state) { state.reason = fresh.value || ''; inputState.set(snapId, state); }
      }
    }
    return;
  }

  sel.classList.toggle('hidden-slot', !showReason);
  if (showReason) sel.removeAttribute('tabindex'); else sel.setAttribute('tabindex', '-1');
}

function cssEscape(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
}

function updateProgress() {
  const total   = snapshotItems.length;
  const counted = snapshotItems.filter(it => hasCount(it.id)).length;
  const msg = `${counted} of ${total} counted`;
  document.getElementById('stProgress').textContent = msg;
  document.getElementById('stFooterProgress').textContent = msg;
}

// Counts reflect the whole group, not just the rows currently passing the
// filter — otherwise "3 / 3 counted" would be a lie while a search is active.
function updateGroupCounts() {
  const groups = new Map(buildGroups().map(g => [g.key, g.items]));
  document.querySelectorAll('.st-group').forEach(el => {
    const items = groups.get(el.dataset.groupKey);
    if (!items) return;
    const counted = items.filter(it => hasCount(it.id)).length;
    const label = el.querySelector('.st-group-count');
    if (label) label.textContent = `${counted} / ${items.length} counted`;
  });
}

async function cancelStockTake() {
  if (!confirm('Cancel this stock take? Any counts you entered will be discarded.')) return;
  try {
    clearLocal();   // the user asked to discard — don't restore it next visit
    if (stockTake?.id) {
      await fetch(`/api/stock-take/${stockTake.id}/cancel`, { method: 'POST' });
    }
    window.location.href = '/inventory.html';
  } catch (e) {
    showToast('Cancel failed: ' + e.message, 'error');
  }
}

async function submitStockTake() {
  if (!stockTake?.id) return;
  const counted = snapshotItems.filter(it => hasCount(it.id));

  // Validate: any counted item with variance !== 0 must have a reason
  const missing = counted.filter(it => {
    const state = inputState.get(it.id);
    const variance = parseFloat(state.counted) - (parseFloat(it.expected_qty) || 0);
    return variance !== 0 && !(state.reason && state.reason.trim());
  });
  if (missing.length) {
    showToast(`Select a reason for ${missing.length} item${missing.length > 1 ? 's' : ''} with a variance.`, 'error');
    // Scroll the first missing one into view
    const el = document.querySelector(`.st-reason-select[data-snap-id="${cssEscape(missing[0].id)}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // Anything left uncounted keeps its existing stock. That is a reasonable
  // default but a terrible surprise, so say so plainly before committing.
  const uncounted = snapshotItems.filter(it => !hasCount(it.id));
  if (uncounted.length) { openSubmitSummary(uncounted); return; }

  await performSubmit();
}

// ── Pre-submit summary ─────────────────────────────────────────
function openSubmitSummary(uncounted) {
  const total = snapshotItems.length;
  const done  = total - uncounted.length;

  document.getElementById('stSubmitLead').innerHTML =
    `You counted <strong>${done} of ${total}</strong> item${total === 1 ? '' : 's'}.`;

  document.getElementById('stUncountedHead').innerHTML =
    `<i class="fas fa-exclamation-triangle"></i> ${uncounted.length} item${uncounted.length === 1 ? ' was' : 's were'} not counted`;

  // Cap the list — a long one should not push the buttons off a phone screen.
  const SHOWN = 12;
  const rows = uncounted.slice(0, SHOWN).map(it => `
    <li>${esc(it.item_name)}<span>${fmtQty(it.expected_qty)} ${esc(it.unit || '')}</span></li>`);
  if (uncounted.length > SHOWN) {
    rows.push(`<li class="st-uncounted-more">…and ${uncounted.length - SHOWN} more</li>`);
  }
  document.getElementById('stUncountedList').innerHTML = rows.join('');

  // Zeroing pushes stock down, so offer outgoing reasons.
  const sel = document.getElementById('stZeroReason');
  sel.innerHTML = stockReasonsFor('remove')
    .map(r => `<option value="${esc(r.code)}">${esc(r.label)}</option>`).join('');
  sel.value = 'correction';

  document.querySelector('input[name="stUncountedAction"][value="keep"]').checked = true;
  document.getElementById('stZeroReasonWrap').classList.add('hidden');
  openModal('stSubmitModal');
}

async function confirmSubmit() {
  const zeroing = document.querySelector('input[name="stUncountedAction"]:checked').value === 'zero';
  const uncounted = snapshotItems.filter(it => !hasCount(it.id));

  if (zeroing) {
    const reasonCode = document.getElementById('stZeroReason').value;
    const names = uncounted.slice(0, 3).map(it => it.item_name).join(', ');
    // Zeroing writes stock away for real — make it a deliberate second step.
    if (!confirm(
      `Set ${uncounted.length} uncounted item${uncounted.length === 1 ? '' : 's'} to zero?\n\n` +
      `${names}${uncounted.length > 3 ? `, and ${uncounted.length - 3} more` : ''}\n\n` +
      `This records that you have none of these.`
    )) return;

    for (const it of uncounted) {
      const state = inputState.get(it.id) || { counted: '', reason: '' };
      state.counted = '0';
      // A zero count only needs a reason where it actually moves stock.
      state.reason  = (parseFloat(it.expected_qty) || 0) !== 0 ? reasonCode : '';
      inputState.set(it.id, state);
    }
    persistLocal();
  }

  closeModal('stSubmitModal');
  await performSubmit();
}

async function performSubmit() {
  const payload = {
    items: snapshotItems.map(it => {
      const state = inputState.get(it.id) || { counted: '', reason: '' };
      const c = (state.counted || '').trim();
      return {
        stock_take_item_id: it.id,
        counted_qty: c === '' ? null : parseFloat(c),
        // Code drives reporting; the label is sent alongside so the backend
        // never needs its own copy of the taxonomy.
        reason_code: state.reason || '',
        reason: stockReasonLabel(state.reason) || state.reason || '',
      };
    }),
  };

  const btn = document.getElementById('stSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting…';

  try {
    const res = await fetch(`/api/stock-take/${stockTake.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    // Submitted and durable on the server — the device copy can go.
    clearLocal();
    showToast(`Stock take submitted — ${data.counted} item${data.counted === 1 ? '' : 's'} counted.`, 'success');
    setTimeout(() => { window.location.href = '/inventory.html'; }, 900);
  } catch (e) {
    // Deliberately keep the local copy so a failed submit loses nothing.
    showToast('Submit failed: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check"></i> Submit Stock Take';
  }
}
