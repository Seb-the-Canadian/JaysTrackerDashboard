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
  // Every tab body opens with a screen-reader-only <h2> that names the
  // tab (Overview / Players / Team Stats / Stat School). The h1 is
  // the brand title in the page header (one per page). With this
  // factory:
  //  - new tabs literally cannot forget their h2
  //  - the h2 is always the first child, so heading order stays
  //    deterministic regardless of what contentFn appends
  //  - the existing root.innerHTML reset is centralized
  //
  // Usage:
  //   tabBody('overview', 'Overview', function (root) {
  //     root.appendChild(buildKpis(state));
  //     ...
  //   });
  function tabBody(tabId, h2Text, contentFn) {
    const root = document.getElementById('tab-' + tabId);
    if (!root) return null;
    root.innerHTML = '';
    const h2 = document.createElement('h2');
    h2.className = 'sr-only';
    h2.textContent = h2Text;
    root.appendChild(h2);
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

  window.JaysDom = {
    tabBody: tabBody,
    skeleton: skeleton,
  };
})();
