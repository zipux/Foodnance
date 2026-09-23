// Shared "Request access" modal for the marketing pages (index.html,
// pricing.html, food-cost-calculator.html). Loaded on its own — not paired
// with a single page in tests/dom-ids.test.mjs, since it builds its own
// markup at runtime rather than referencing ids already in the page.
//
// Progressive enhancement: every trigger keeps its original mailto: href, so
// a visitor with JS disabled (or this script failing to load) still gets the
// old behaviour. Only once this runs do triggers get intercepted to open the
// form instead — see the "Nothing happened?" text still on each page, which
// covers the no-JS/JS-failure/no-mail-client case this can't reach.
//
// Talks to POST /api/interest (src/index.ts, migrations/0053_access_requests.sql).
(function () {
  'use strict';

  var TRIGGER_SELECTOR = '.js-request-access';
  var triggers = document.querySelectorAll(TRIGGER_SELECTOR);
  if (!triggers.length) return;

  var STYLE_ID = 'requestAccessStyles';
  if (!document.getElementById(STYLE_ID)) {
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.ra-overlay{position:fixed;inset:0;z-index:200;background:rgba(15,23,42,.55);' +
      'display:flex;align-items:center;justify-content:center;padding:1rem;' +
      'opacity:0;pointer-events:none;transition:opacity .15s ease}' +
      '.ra-overlay.open{opacity:1;pointer-events:auto}' +
      '.ra-modal{background:#fff;border-radius:14px;max-width:420px;width:100%;' +
      'box-shadow:0 24px 64px rgba(15,23,42,.25);position:relative;max-height:90vh;overflow-y:auto}' +
      '.ra-body{padding:1.8rem}' +
      '.ra-close{position:absolute;top:.7rem;right:.7rem;width:2rem;height:2rem;border-radius:999px;' +
      'border:none;background:#f3f1ec;color:#171512;font-size:1.3rem;line-height:1;cursor:pointer;' +
      'display:flex;align-items:center;justify-content:center}' +
      '.ra-close:hover{background:#e4e0d8}' +
      '.ra-body h2{font-family:"Fraunces",Georgia,serif;font-weight:600;font-size:1.4rem;' +
      'letter-spacing:-.01em;margin:0 0 .4rem;color:#171512}' +
      '.ra-sub{font-size:.92rem;color:#6b6659;margin:0 0 1.3rem}' +
      '.ra-form{display:grid;gap:.9rem}' +
      '.ra-form[hidden],.ra-thanks[hidden]{display:none}' +
      '.ra-form label{display:block;font-size:.85rem;font-weight:600;color:#171512}' +
      '.ra-form input,.ra-form select{display:block;width:100%;margin-top:.3rem;font:inherit;' +
      'font-size:.95rem;padding:.6rem .7rem;border:1px solid #e4e0d8;border-radius:8px;' +
      'background:#faf9f6;color:#171512}' +
      '.ra-form input:focus,.ra-form select:focus{outline:2px solid #0369a1;outline-offset:1px;background:#fff}' +
      '.ra-honeypot{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}' +
      '.ra-error{color:#b91c1c;font-size:.85rem;margin:0}' +
      '.ra-submit{width:100%}' +
      '.ra-alt{font-size:.8rem;color:#6b6659;text-align:center;margin:.2rem 0 0}' +
      '.ra-alt a{color:#0369a1;font-weight:600;text-decoration:none}' +
      '.ra-alt a:hover{text-decoration:underline}' +
      '.ra-thanks{text-align:center}' +
      '.ra-thanks p{color:#6b6659;font-size:.95rem;margin:0 0 1.3rem}';
    document.head.appendChild(style);
  }

  var overlay = document.createElement('div');
  overlay.className = 'ra-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML =
    '<div class="ra-modal" role="dialog" aria-modal="true" aria-labelledby="raTitle">' +
      '<button type="button" class="ra-close" aria-label="Close">&times;</button>' +
      '<div class="ra-body">' +
        '<form class="ra-form" novalidate>' +
          '<h2 id="raTitle">Request access</h2>' +
          '<p class="ra-sub">Tell us a little about your business and we’ll set you up — we usually reply within 24 hours.</p>' +
          '<label>Your name<input type="text" name="name" required maxlength="200" autocomplete="name"></label>' +
          '<label>Email<input type="email" name="email" required maxlength="320" autocomplete="email"></label>' +
          '<label>Business name<input type="text" name="business_name" required maxlength="200" autocomplete="organization"></label>' +
          '<label>Type<select name="business_type">' +
            '<option value="">— optional —</option>' +
            '<option>Restaurant</option><option>Bakery</option><option>Commissary</option><option>Other</option>' +
          '</select></label>' +
          '<label>Invoices per week (roughly)<input type="text" name="invoices_per_week" maxlength="60" placeholder="e.g. 10"></label>' +
          '<div class="ra-honeypot" aria-hidden="true">' +
            '<label>Leave blank<input type="text" name="website" tabindex="-1" autocomplete="off"></label>' +
          '</div>' +
          '<p class="ra-error" hidden></p>' +
          '<button type="submit" class="btn btn-primary btn-lg ra-submit">Send request</button>' +
          '<p class="ra-alt">Prefer email? Write to <a href="mailto:hello@foodnance.com">hello@foodnance.com</a> directly.</p>' +
        '</form>' +
        '<div class="ra-thanks" hidden>' +
          '<h2>Thanks!</h2>' +
          '<p>We got it — we usually reply within 24 hours with a link to get you started.</p>' +
          '<button type="button" class="btn btn-ghost ra-done">Close</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  var form = overlay.querySelector('.ra-form');
  var errorEl = overlay.querySelector('.ra-error');
  var thanks = overlay.querySelector('.ra-thanks');
  var submitBtn = overlay.querySelector('.ra-submit');
  var lastFocused = null;

  function openModal() {
    lastFocused = document.activeElement;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    form.hidden = false;
    thanks.hidden = true;
    errorEl.hidden = true;
    errorEl.textContent = '';
    var first = form.querySelector('input[name="name"]');
    if (first) first.focus();
  }
  function closeModal() {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  Array.prototype.forEach.call(triggers, function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      openModal();
    });
  });

  overlay.querySelector('.ra-close').addEventListener('click', closeModal);
  overlay.querySelector('.ra-done').addEventListener('click', closeModal);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorEl.hidden = true;

    var data = new FormData(form);
    var get = function (k) { return (data.get(k) || '').toString().trim(); };
    var payload = {
      name: get('name'),
      email: get('email'),
      business_name: get('business_name'),
      business_type: get('business_type'),
      invoices_per_week: get('invoices_per_week'),
      website: get('website'),
      source_page: location.pathname,
    };
    if (!payload.name || !payload.email || !payload.business_name) {
      errorEl.textContent = 'Please fill in your name, email and business name.';
      errorEl.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    fetch('/api/interest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, body: j }; });
      })
      .then(function (res) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send request';
        if (!res.ok) {
          errorEl.textContent = (res.body && res.body.error) || 'Something went wrong. Email hello@foodnance.com directly.';
          errorEl.hidden = false;
          return;
        }
        form.hidden = true;
        thanks.hidden = false;
      })
      .catch(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send request';
        errorEl.textContent = 'Could not reach the server. Email hello@foodnance.com directly.';
        errorEl.hidden = false;
      });
  });
})();
