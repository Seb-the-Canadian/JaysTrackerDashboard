/* ============================================================
   Jays Tracker — DOM helpers (v2)
   Per-tab factories that enforce structural invariants. The
   antifragile pass introduced this module to make heading
   semantics impossible to forget (bugs B5, B6 — no h1, missing h2).
   ============================================================ */

(function () {
  'use strict';

  // ---- Tab body factory ----
  //
  // Every tab body opens with a heading element (an <h2>) that names
  // the tab. The h1 is the brand title in the page header (one per
  // page). The factory ensures:
  //  - new tabs literally cannot forget their h2
  //  - the h2 is always the first child, so heading order stays
  //    deterministic regardless of what contentFn appends
  //  - the existing root.innerHTML reset is centralized
  //
  // Per PR-C (COG-359, audit H5): when a tab supplies its OWN visible
  // <h2> in contentFn, pass `{ headingProvided: true }` so we skip the
  // sr-only injection. The previous version always added the sr-only
  // h2 — which created a duplicate-h2 condition on Players / Team
  // Stats / Stat School (both an sr-only and a visible heading,
  // reading the same text). The Ch 16 "don't use ARIA if you can use
  // semantic HTML" guidance applies: when a visible heading exists,
  // that IS the heading; no shadow accessibility node needed.
  //
  // Usage:
  //   tabBody('overview', 'Overview', function (root) {
  //     root.appendChild(buildKpis(state));  // no visible h2 here
  //   });
  //   tabBody('players', 'Players', function (root) {
  //     root.appendChild(eyebrowHead());  // contains its own <h2>
  //   }, { headingProvided: true });
  function tabBody(tabId, h2Text, contentFn, opts) {
    const root = document.getElementById('tab-' + tabId);
    if (!root) return null;
    root.innerHTML = '';
    if (!(opts && opts.headingProvided)) {
      const h2 = document.createElement('h2');
      h2.className = 'sr-only';
      h2.textContent = h2Text;
      root.appendChild(h2);
    }
    if (typeof contentFn === 'function') contentFn(root);
    return root;
  }

  // ---- Skeleton (loading state) ----
  //
  // Generic shimmer placeholder. The antifragile pass standardizes this
  // so any tab can render a skeleton while data is in-flight (bug B8
  // class — empty UI during async loads).
  //
  // opts: { lines: 4, widths: ['60%','90%','75%','55%'] }
  function skeleton(opts) {
    opts = opts || {};
    const wrap = document.createElement('div');
    wrap.className = 'panel-skeleton';
    const widths = opts.widths || ['60%', '90%', '75%', '55%'];
    const n = opts.lines || widths.length;
    for (let i = 0; i < n; i++) {
      const line = document.createElement('div');
      line.className = 'sk-line';
      line.style.width = widths[i % widths.length];
      wrap.appendChild(line);
    }
    return wrap;
  }

  // ---- Tab-shape-aware skeleton ----
  //
  // Each tab gets a placeholder roughly matching its eventual layout so
  // the dashboard never appears blank during async load (B8 class). The
  // shape is approximate — the antifragile principle is "non-blank
  // synchronous paint", not "pixel-perfect preview".
  function skeletonForTab(tabId) {
    const SHAPES = {
      overview: ['40%', '92%', '85%', '70%', '95%', '60%', '88%', '50%'],
      players:  ['30%', '70%', '70%', '70%', '70%', '70%', '70%', '70%', '70%'],
      'team-stats': ['28%', '90%', '80%', '85%', '78%', '92%', '70%', '85%'],
      'stat-school': ['22%', '88%', '75%', '92%', '60%', '85%', '70%'],
    };
    return skeleton({ widths: SHAPES[tabId] || SHAPES.overview });
  }

  // ---- Error panel with retry ----
  //
  // Shown in place of a tab's content when its required data is
  // unavailable. The retry button re-runs the supplied function (which
  // is expected to re-fetch and re-render). Bug class: a fetch failure
  // for one source must not blank the dashboard or leave the user with
  // no recovery path.
  function errorPanel(opts) {
    opts = opts || {};
    const wrap = document.createElement('div');
    wrap.className = 'panel-error';
    const msg = document.createElement('span');
    msg.className = 'msg';
    msg.textContent = opts.message || 'Could not load this section.';
    wrap.appendChild(msg);
    if (typeof opts.retry === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'panel-retry';
      btn.textContent = 'Retry';
      btn.addEventListener('click', opts.retry);
      wrap.appendChild(btn);
    }
    return wrap;
  }

  window.JaysDom = {
    tabBody: tabBody,
    skeleton: skeleton,
    skeletonForTab: skeletonForTab,
    errorPanel: errorPanel,
  };
})();
