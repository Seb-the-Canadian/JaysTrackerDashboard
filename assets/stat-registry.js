/* ============================================================
   Jays Tracker — shared stat registry (v2 / #114 Phase 1)

   Single source for stat metadata across the dashboard.

   Loads stat_school.json once (Promise-cached) and exposes a small
   accessor API for tooltip content + any other consumer. Previously the
   Stat School tab owned the load privately (assets/stat-school.js); the
   tooltip surface needs the same data, so the loader moves here and
   stat-school.js drops to a consumer.

   The registry intentionally does NOT cache by abbreviation — slugs are
   the canonical join key (every `.term[data-stat]` carries one) — and
   doesn't normalize keys past lowercase, so the contract with
   stat_school.json stays simple and obvious.
   ============================================================ */
(function () {
  'use strict';

  let DATA = null;
  let LOAD_PROMISE = null;

  function load() {
    if (LOAD_PROMISE) return LOAD_PROMISE;
    LOAD_PROMISE = fetch('stat_school.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { DATA = j || { stats: {} }; return DATA; })
      .catch(function () { DATA = { stats: {} }; return DATA; });
    return LOAD_PROMISE;
  }

  // Slug normalization. `.term[data-stat]` values are sometimes kebab
  // (`run-differential` from overview.js) and stat_school.json sometimes
  // uses snake (`run_differential`). Try the raw key first, then both
  // case-folded; return the first match. Returns null when neither
  // resolves — caller treats that as "no tooltip for this term."
  function get(slug) {
    if (!DATA || !slug) return null;
    const stats = DATA.stats || {};
    if (stats[slug]) return stats[slug];
    const alt = slug.replace(/-/g, '_');
    if (stats[alt]) return stats[alt];
    const alt2 = slug.replace(/_/g, '-');
    if (stats[alt2]) return stats[alt2];
    return null;
  }

  // Synchronously check whether the loader has resolved. Lets the wiring
  // layer no-op until after the JSON is in memory (the tooltip module
  // calls load() on init; this avoids racing the first event).
  function ready() { return DATA !== null; }

  // Synchronously check whether a slug has a stat_school.json entry. Used
  // by renderers to gate the `.term[data-stat]` affordance — emitting the
  // dotted-underline + cursor:help only when there's actually a tooltip
  // behind it (issue #125). Pre-load contract: render.js awaits load()
  // before any renderer runs, so by emit time DATA is populated and this
  // returns the truthful answer. If called before load resolves it
  // returns false — renderers degrade to plain text rather than a dead
  // affordance, which is the desired direction anyway.
  function has(slug) { return get(slug) !== null; }

  window.JaysStatRegistry = {
    load: load,
    get: get,
    has: has,
    ready: ready,
  };
})();
