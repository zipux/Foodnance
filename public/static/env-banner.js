// A loud bar across the top of the STAGING site, and nothing at all on
// production.
//
// Staging and production are the same app and look identical. The only visible
// difference is a few characters in the address bar, which is exactly the sort
// of thing you stop reading after the third deploy of the morning. Getting them
// the wrong way round is expensive in one direction only: happily testing a
// destructive change on what turns out to be live customer data.
//
// Deliberately standalone — no dependency on utils.js, no shared CSS — so it
// can also run on the LOGIN page, which is where mistaking one site for the
// other actually begins, and so it cannot be broken by a change to anything
// else.
//
// FAIL-SAFE DIRECTION: this shows a banner only on a positive, server-issued
// 'staging'. Anything else — a network failure, an old worker with no /api/env,
// a missing APP_ENV var — shows nothing. A missing banner on staging costs you
// some unnecessary caution; a banner wrongly promising "nothing here is real"
// over live data costs a customer their invoices.
(function () {
  var BAR_H = 30;
  // No emoji: the hazard stripes already carry the alarm, and an emoji glyph
  // renders differently (or as a box) depending on the machine's fonts.
  var LABEL = 'STAGING — practice site. Nothing here is real, and no customer can see it.';

  function paint() {
    if (document.getElementById('dm-staging-bar')) return;

    var style = document.createElement('style');
    style.id = 'dm-staging-style';
    // FIXED, not sticky. Sticky made the bar a participant in whatever layout
    // the page already had — on the login screen, whose body is a centring
    // flexbox, it came out as a short strip floating in the middle of the page.
    // Fixed takes it out of flow entirely, so it spans the top of any page
    // regardless of that page's own layout.
    //
    // Then two adjustments so nothing is hidden underneath it: pad the body down
    // by the bar's height, and start the app's sticky navbar below it rather
    // than at 0.
    style.textContent =
      '#dm-staging-bar{position:fixed;top:0;left:0;right:0;z-index:2147483647;' +
      'height:' + BAR_H + 'px;box-sizing:border-box;' +
      'display:flex;align-items:center;justify-content:center;' +
      'background:repeating-linear-gradient(45deg,#f59e0b,#f59e0b 12px,#fbbf24 12px,#fbbf24 24px);' +
      'color:#3f2d00;font:600 12.5px/1 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;' +
      'letter-spacing:.02em;text-align:center;padding:0 .75rem;' +
      'box-shadow:0 1px 3px rgba(15,23,42,.2)}' +
      'body.dm-staging{padding-top:' + BAR_H + 'px}' +
      'body.dm-staging .navbar{top:' + BAR_H + 'px}';
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.id = 'dm-staging-bar';
    bar.textContent = LABEL;
    document.body.insertBefore(bar, document.body.firstChild);
    document.body.classList.add('dm-staging');

    // The tab title too: the bar is invisible when the window isn't focused,
    // and a row of identical tabs is its own way of picking the wrong one.
    if (document.title.indexOf('[STAGING]') !== 0) {
      document.title = '[STAGING] ' + document.title;
    }
  }

  function ask() {
    fetch('/api/env', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.environment === 'staging') paint(); })
      .catch(function () { /* stay quiet — see FAIL-SAFE above */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ask);
  } else {
    ask();
  }
})();
