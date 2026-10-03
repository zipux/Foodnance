// Website analytics for the PUBLIC pages only (home, pricing, the food cost
// calculator, refund policy, terms, privacy). Never loaded inside the signed-in
// app — the Privacy Policy says so.
//
// Uses Plausible: no cookies, no personal data, totals only. Page views, the
// page a visitor left from and the site that sent them come from Plausible's
// own script; this file adds a handful of click counts on top.
//
// Three rules, pinned by tests/analytics.test.mjs:
//   - Nothing a visitor TYPES is ever read or sent. This file never touches an
//     input's value; the calculator promises "nothing you type is saved or sent
//     anywhere" and the request form's fields go to /api/interest only.
//   - It runs on foodnance.com only. Staging, localhost and every pages.dev
//     address count nothing, so tests never pollute the real numbers. There the
//     events are kept in window.__fnEvents so they can be checked by hand.
//   - Until PLAUSIBLE_SRC is filled in it does nothing at all, anywhere.
(function () {
  'use strict';

  // The script address from the Plausible dashboard (Site settings → Site
  // installation), e.g. 'https://plausible.io/js/pa-XXXXXXXX.js'.
  // Empty = analytics off.
  var PLAUSIBLE_SRC = '';
  var LIVE_HOSTS = ['foodnance.com', 'www.foodnance.com'];

  var live = !!PLAUSIBLE_SRC && LIVE_HOSTS.indexOf(location.hostname) !== -1;

  if (live) {
    // Plausible's own queue stub: events fired before its script arrives wait here.
    window.plausible = window.plausible || function () {
      (window.plausible.q = window.plausible.q || []).push(arguments);
    };
    window.plausible.init = window.plausible.init || function (o) { window.plausible.o = o || {}; };
    window.plausible.init();
    var s = document.createElement('script');
    s.async = true;
    s.src = PLAUSIBLE_SRC;
    s.setAttribute('data-domain', 'foodnance.com');
    document.head.appendChild(s);
  } else {
    window.__fnEvents = [];
    window.plausible = function (name, opts) {
      window.__fnEvents.push({ name: name, props: (opts && opts.props) || {} });
    };
  }

  function track(name, props) {
    try { window.plausible(name, props ? { props: props } : undefined); } catch (e) { /* never break the page */ }
  }

  // "Request access" buttons: which one was pressed.
  var triggers = Array.prototype.slice.call(document.querySelectorAll('.js-request-access'));
  var inPage = triggers.filter(function (el) { return !el.closest('header, nav'); });
  triggers.forEach(function (el) {
    el.addEventListener('click', function () {
      var plan = el.getAttribute('data-plan');
      var button = plan ? 'plan ' + plan
        : inPage.indexOf(el) === -1 ? 'menu'
        : inPage.indexOf(el) === inPage.length - 1 ? 'bottom' : 'top';
      track('Request access click', { button: button });
    });
  });

  // FAQ: which question was opened (the question is our own text, not typed).
  // 'toggle' does not bubble, so listen in the capture phase.
  document.addEventListener('toggle', function (e) {
    var d = e.target;
    if (!d || !d.open || !d.classList || !d.classList.contains('faq-item')) return;
    var q = d.querySelector('summary');
    track('FAQ opened', { question: q ? q.textContent.trim().slice(0, 120) : '' });
  }, true);

  // Scrolled as far as the FAQ, once per page view.
  var faq = document.getElementById('faq');
  if (faq && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      if (!entries.some(function (en) { return en.isIntersecting; })) return;
      io.disconnect();
      track('FAQ reached');
    });
    io.observe(faq);
  }

  // Food cost calculator: that it was used, never what was entered. The result
  // box is only compared with its empty placeholder; no figure is sent.
  var example = document.getElementById('loadExample');
  var total = document.getElementById('resTotal');
  if (example && total && 'MutationObserver' in window) {
    var usedExample = false;
    example.addEventListener('click', function () {
      usedExample = true;
      track('Calculator example');
    });
    var mo = new MutationObserver(function () {
      var shown = total.textContent.trim();
      if (!shown || shown === '—') return;
      mo.disconnect();
      track('Calculator result', { from: usedExample ? 'example' : 'own numbers' });
    });
    mo.observe(total, { childList: true, characterData: true, subtree: true });
  }
})();
