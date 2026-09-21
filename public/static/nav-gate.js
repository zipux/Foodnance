// Hide the nav tabs a plan doesn't include BEFORE the first paint.
//
// The problem this solves: every app page is a separate document with the full
// nav written into its HTML. Which tabs the customer's plan includes is only
// learnt from /api/auth/me, and utils.js hides the rest when that answers — a
// network round trip after the page was already on screen. So every click on an
// Essential account flashed Inventory, Sales, Staff and the other Pro tabs for
// a moment, then removed them.
//
// This file is loaded synchronously in <head>. It reads the feature list this
// browser last saw (written by utils.js after each /api/auth/me, and by
// login.html) and injects a <style> that hides the matching nav links, so the
// nav is right the first time it is drawn.
//
// It is a PROVISIONAL answer, and the server's is the truth: applyPlanGating()
// in utils.js removes this <style> when /api/auth/me arrives and applies the real
// list, so an upgrade or downgrade corrects itself within one page load. Like all
// plan gating it is presentation only — the server refuses the Pro *actions*.
//
// FAIL-OPEN: with no remembered list, or one that is unreadable, this does
// nothing and every tab shows, exactly as before. A missing tab is a support
// call; a tab that is shown and then hidden is only a flicker.
//
// Only nav links are handled here. A gated page reached by URL still swaps in
// its upgrade panel after /api/auth/me; hiding a page's content on a guess
// could leave a blank screen if that call ever failed.
//
// Nothing personal is stored: the key holds a list of feature names, in this
// browser only.
const DM_NAV_KEY = 'dm_nav_features';
const DM_NAV_STYLE_ID = 'dmNavGate';

// Must equal PLAN_GATED_PAGES in utils.js — tests/nav-gate.test.mjs fails if
// the two drift. Paths, then the feature that unlocks each.
const DM_NAV_GATED = {
  '/sales':          'pos_sales',
  '/inventory':      'inventory_tools',
  '/stock-take':     'stock_takes',
  '/storage-layout': 'storage_layout',
  '/staff':          'staff',
  '/certifications': 'staff',
};

// The CSS that hides every gated link the given features don't include. Pages
// link as "/inventory.html" locally and "/inventory" in production, so both.
// Returns '' for anything that isn't a list (fail open).
function dmNavCss(features) {
  if (!Array.isArray(features)) return '';
  const have = new Set(features.filter(f => typeof f === 'string'));
  const selectors = [];
  for (const path of Object.keys(DM_NAV_GATED)) {
    if (have.has(DM_NAV_GATED[path])) continue;
    selectors.push('.nav-links a[href="' + path + '.html"]', '.nav-links a[href="' + path + '"]');
  }
  return selectors.length ? selectors.join(',') + '{display:none !important}' : '';
}

function dmNavRecall() {
  try {
    const o = JSON.parse(localStorage.getItem(DM_NAV_KEY));
    return o && Array.isArray(o.features) ? o.features : null;
  } catch (_) { return null; }
}

// Called with the user object from /api/auth/me or /api/auth/login.
function dmNavRemember(me) {
  try {
    if (me && Array.isArray(me.features)) {
      localStorage.setItem(DM_NAV_KEY, JSON.stringify({ features: me.features }));
    }
  } catch (_) { /* private mode, storage blocked: the nav just isn't pre-hidden */ }
}

// Sign out: the next person to use this browser must not inherit the last
// one's tabs.
function dmNavForget() {
  try { localStorage.removeItem(DM_NAV_KEY); localStorage.removeItem(DM_CHIP_KEY); } catch (_) {}
}

// ─── The account chip's width ─────────────────────────────────
// The nav jumped sideways on every page load because the account chip (name,
// settings, sign out) is inserted by utils.js only AFTER /api/auth/me answers,
// and the tabs are pushed right by whatever room is left. style.css now reserves
// an empty box where the chip will go; this remembers how wide the real one was,
// so the box is exactly that wide and the tabs do not move by a single pixel.
//
// Stored with which layout it was measured in, because the chip loses its labels
// on narrow screens. A remembered width from the other layout is ignored, and the
// stylesheet's own fallback is used instead.
const DM_CHIP_KEY = 'dm_chip_w';
// Must equal the phone breakpoint in style.css — tests/nav-gate.test.mjs checks.
const DM_NARROW_QUERY = '(max-width: 768px)';

// The CSS variable override for a remembered width, or '' when there is nothing
// trustworthy to use. Bounded, so a bad value cannot collapse or blow up the nav.
function dmChipCss(mem, narrowNow) {
  if (!mem || typeof mem.w !== 'number' || !isFinite(mem.w)) return '';
  if (mem.w < 40 || mem.w > 600) return '';
  if (!!mem.narrow !== !!narrowNow) return '';
  return ':root{--dm-chip-w:' + Math.round(mem.w) + 'px}';
}

function dmChipRecall() {
  try { return JSON.parse(localStorage.getItem(DM_CHIP_KEY)); } catch (_) { return null; }
}

function dmChipRemember(width, narrow) {
  try {
    if (typeof width === 'number' && isFinite(width) && width >= 40 && width <= 600) {
      localStorage.setItem(DM_CHIP_KEY, JSON.stringify({ w: Math.round(width), narrow: !!narrow }));
    }
  } catch (_) { /* storage blocked: the stylesheet's fallback width is used */ }
}

// The server has answered: drop the guess. utils.js then applies the real list.
function dmNavDropProvisional() {
  const el = document.getElementById(DM_NAV_STYLE_ID);
  if (el) el.remove();
}

(function () {
  if (typeof document === 'undefined' || !document.head || !document.createElement) return;

  // Hide the tabs the plan lacks. Provisional: removed when the server answers.
  const css = dmNavCss(dmNavRecall());
  if (css) {
    const style = document.createElement('style');
    style.id = DM_NAV_STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  // Reserve the chip's remembered width. A layout variable, not a guess about
  // the user, so it stays for the life of the page.
  let narrow = false;
  try { narrow = typeof matchMedia === 'function' && matchMedia(DM_NARROW_QUERY).matches; } catch (_) {}
  const chipCss = dmChipCss(dmChipRecall(), narrow);
  if (chipCss) {
    const w = document.createElement('style');
    w.id = 'dmChipW';
    w.textContent = chipCss;
    document.head.appendChild(w);
  }
})();
