/* ===== storage-layout.js =====
 *
 * Lets the user describe their physical storage: create sections (Fridge 1,
 * Dry Store…), drag items into them, and arrange each section in the order the
 * items actually sit on the shelf. The stock take then lists items in exactly
 * this order, so counting is a walk rather than a search.
 *
 * Drag uses Pointer Events, which cover mouse and touch with one code path.
 * HTML5 drag-and-drop is deliberately avoided — it does not fire on touch.
 */

const UNASSIGNED = '__unassigned__';   // synthetic section id for unplaced items

let sections   = [];   // [{ id, name, sort_order, items: [] }]
let unassigned = [];   // items with no placement
let saveTimer  = null;

const TYPE_LABEL = {
  raw_material:     'Raw',
  batch:            'Batch',
  finished_product: 'Finished',
};

document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('storage-layout-marker')) return;
  document.getElementById('slAddSectionBtn').addEventListener('click', addSection);
  await loadLayout();
});

// ── Load & render ──────────────────────────────────────────────
async function loadLayout() {
  try {
    const data = await apiGet('storage-layout');
    sections   = data.sections   || [];
    unassigned = data.unassigned || [];
    document.getElementById('slLoading').style.display = 'none';
    document.getElementById('slBody').style.display = '';
    render();
  } catch (e) {
    document.getElementById('slLoading').innerHTML =
      `<i class="fas fa-exclamation-triangle"></i> Failed to load layout: ${esc(e.message)}`;
  }
}

function render() {
  const body = document.getElementById('slBody');
  const blocks = sections.map(s => sectionHtml(s, false));
  // Unassigned always renders last so nothing can quietly drop out of a count.
  blocks.push(sectionHtml({ id: UNASSIGNED, name: 'Unassigned', items: unassigned }, true));
  body.innerHTML = blocks.join('');
  attachDragHandles();
}

function sectionHtml(s, isUnassigned) {
  const items = s.items || [];
  return `
    <section class="sl-section${isUnassigned ? ' is-unassigned' : ''}" data-section-id="${esc(s.id)}">
      <div class="sl-section-header">
        <span class="sl-section-name">
          ${isUnassigned ? '<i class="fas fa-inbox"></i> ' : ''}${esc(s.name)}
        </span>
        <span class="sl-section-count">${items.length} item${items.length === 1 ? '' : 's'}</span>
        ${isUnassigned ? '' : `
          <span class="sl-section-actions">
            <button class="sl-icon-btn" title="Rename section"
                    onclick="renameSection('${esc(s.id)}')"><i class="fas fa-pen"></i></button>
            <button class="sl-icon-btn danger" title="Delete section"
                    onclick="deleteSection('${esc(s.id)}')"><i class="fas fa-trash"></i></button>
          </span>`}
      </div>
      <ul class="sl-items${items.length ? '' : ' is-empty'}" data-section-id="${esc(s.id)}">
        ${items.length
          ? items.map(itemHtml).join('')
          : `<li>${isUnassigned ? 'Everything is placed.' : 'Drag items here'}</li>`}
      </ul>
    </section>`;
}

function itemHtml(it) {
  return `
    <li class="sl-item" data-item-id="${esc(it.item_id)}" data-item-type="${esc(it.item_type)}">
      <span class="sl-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span>
      <span class="sl-item-name">${esc(it.item_name)}</span>
      <span class="sl-item-meta">${esc(it.category || '')}</span>
      <span class="sl-type-badge">${esc(TYPE_LABEL[it.item_type] || it.item_type)}</span>
    </li>`;
}

// ── Sections CRUD ──────────────────────────────────────────────
async function addSection() {
  const name = prompt('Name this section (e.g. Fridge 1, Dry Store, Bar):');
  if (name === null) return;
  if (!name.trim()) { showToast('Enter a name for the section.', 'error'); return; }
  try {
    const created = await apiPost('storage-layout/sections', { name: name.trim() });
    sections.push({ ...created, items: [] });
    render();
    showToast(`Section "${created.name}" added.`, 'success');
  } catch (e) {
    showToast(e.message || 'Could not add section.', 'error');
  }
}

async function renameSection(id) {
  const s = sections.find(x => x.id === id);
  if (!s) return;
  const name = prompt('Rename section:', s.name);
  if (name === null) return;
  if (!name.trim()) { showToast('Enter a name for the section.', 'error'); return; }
  try {
    await apiPatch(`storage-layout/sections/${id}`, { name: name.trim() });
    s.name = name.trim();
    render();
  } catch (e) {
    showToast(e.message || 'Could not rename section.', 'error');
  }
}

async function deleteSection(id) {
  const s = sections.find(x => x.id === id);
  if (!s) return;
  const n = (s.items || []).length;
  const msg = n
    ? `Delete "${s.name}"?\n\nIts ${n} item${n === 1 ? '' : 's'} will move to Unassigned — no products are deleted.`
    : `Delete "${s.name}"?`;
  if (!confirm(msg)) return;
  try {
    await apiDelete(`storage-layout/sections/${id}`);
    unassigned = unassigned.concat(s.items || []);
    sections = sections.filter(x => x.id !== id);
    render();
    showToast(`Section "${s.name}" deleted.`, 'warning');
  } catch (e) {
    showToast(e.message || 'Could not delete section.', 'error');
  }
}

// ── Saving ─────────────────────────────────────────────────────
function setSaveState(state, text) {
  const el = document.getElementById('slSaveState');
  if (!el) return;
  const icon = { saving: 'fa-spinner fa-spin', saved: 'fa-check', error: 'fa-exclamation-triangle' }[state] || '';
  el.className = `sl-save-state ${state}`;
  el.innerHTML = `<i class="fas ${icon}"></i> ${esc(text)}`;
}

// Debounced so a burst of drags becomes one write.
function scheduleSave() {
  setSaveState('saving', 'Saving…');
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveOrder, 500);
}

async function saveOrder() {
  const placements = [];
  for (const s of sections) {
    (s.items || []).forEach((it, i) => {
      placements.push({ item_id: it.item_id, item_type: it.item_type, section_id: s.id, sort_order: i });
    });
  }
  // Items in Unassigned are simply absent from the payload.
  try {
    await apiPut('storage-layout/order', { sections: sections.map(s => s.id), placements });
    setSaveState('saved', 'Layout saved');
  } catch (e) {
    setSaveState('error', 'Not saved — check connection');
  }
}

// ── Drag & drop (Pointer Events: one path for mouse and touch) ──
let drag = null;   // { item, fromList, placeholder, ghost, offsetX, offsetY }

function attachDragHandles() {
  document.querySelectorAll('.sl-handle').forEach(h => {
    h.addEventListener('pointerdown', onPointerDown);
  });
}

function onPointerDown(e) {
  // Ignore secondary buttons; let normal scrolling happen elsewhere.
  if (e.button && e.button !== 0) return;
  const li = e.target.closest('.sl-item');
  if (!li) return;

  e.preventDefault();
  const rect = li.getBoundingClientRect();

  const ghost = document.getElementById('slGhost');
  ghost.textContent = li.querySelector('.sl-item-name').textContent.trim();
  ghost.classList.remove('hidden');

  drag = {
    li,
    fromList: li.parentElement,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
    ghost,
    moved: false,
  };
  li.classList.add('is-dragging');
  moveGhost(e.clientX, e.clientY);

  // Capture on the document so the drag survives the pointer leaving the row.
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);
}

function moveGhost(x, y) {
  drag.ghost.style.left = `${x - drag.offsetX}px`;
  drag.ghost.style.top  = `${y - drag.offsetY}px`;
}

function onPointerMove(e) {
  if (!drag) return;
  e.preventDefault();
  drag.moved = true;
  moveGhost(e.clientX, e.clientY);
  autoScroll(e.clientY);

  // What is under the pointer? (the ghost is pointer-events:none)
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el) return;
  const list = el.closest('.sl-items');
  if (!list) return;

  document.querySelectorAll('.sl-section.is-drop-target')
    .forEach(s => s.classList.remove('is-drop-target'));
  list.closest('.sl-section')?.classList.add('is-drop-target');

  // Insert the dragged row before whichever sibling the pointer is above.
  const over = el.closest('.sl-item');
  if (over && over !== drag.li) {
    const r = over.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    list.insertBefore(drag.li, after ? over.nextSibling : over);
  } else if (!list.contains(drag.li)) {
    // Empty list, or hovering the padding — append.
    list.querySelectorAll('li:not(.sl-item)').forEach(ph => ph.remove());
    list.classList.remove('is-empty');
    list.appendChild(drag.li);
  }
}

// Scroll the page when dragging near the top or bottom edge — without this a
// long list is impossible to reorder on a phone.
function autoScroll(clientY) {
  const margin = 80;
  const speed = 12;
  if (clientY < margin) window.scrollBy(0, -speed);
  else if (clientY > window.innerHeight - margin) window.scrollBy(0, speed);
}

function onPointerUp() {
  if (!drag) return;
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerUp);

  drag.li.classList.remove('is-dragging');
  drag.ghost.classList.add('hidden');
  document.querySelectorAll('.sl-section.is-drop-target')
    .forEach(s => s.classList.remove('is-drop-target'));

  const moved = drag.moved;
  drag = null;

  if (moved) {
    syncModelFromDom();
    scheduleSave();
    render();   // re-render to fix counts, empty states and handles
  }
}

// The DOM is the source of truth after a drag — read the arrangement back into
// the model so the save payload and the next render agree with what is on
// screen.
function syncModelFromDom() {
  const byKey = new Map();
  for (const it of [...sections.flatMap(s => s.items || []), ...unassigned]) {
    byKey.set(`${it.item_type}:${it.item_id}`, it);
  }

  for (const s of sections) s.items = [];
  unassigned = [];

  document.querySelectorAll('.sl-items').forEach(list => {
    const sectionId = list.dataset.sectionId;
    const target = sectionId === UNASSIGNED
      ? unassigned
      : (sections.find(s => s.id === sectionId)?.items);
    if (!target) return;
    list.querySelectorAll('.sl-item').forEach(li => {
      const it = byKey.get(`${li.dataset.itemType}:${li.dataset.itemId}`);
      if (it) target.push(it);
    });
  });
}

// Exposed for the inline onclick handlers in the section header.
window.renameSection = renameSection;
window.deleteSection = deleteSection;
