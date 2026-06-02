/* ============================================================
   Jays Tracker — render pipeline (v2)
   Vanilla JS. No deps.

   Step 2 scope: load config/data/notes, render the header
   (record · IL chip · freshness · brand), wire hash-routed tab
   nav, hook the theme toggle. Tab bodies stay as stubs until
   steps 3-6 land per /root/.claude/plans/redesign-v2.md.
   ============================================================ */

(function () {
  'use strict';

  // ---- Tab routing ----

  const TABS = ['overview', 'players', 'team-stats', 'stat-school'];
  const DEFAULT_TAB = 'overview';

  function parseTabFromHash() {
    const h = (window.location.hash || '').replace(/^#/, '');
    // Player modal & stat anchors get routed in later commits; for now
    // any tab-shaped hash wins, anything else falls back to default.
    if (TABS.indexOf(h) !== -1) return h;
    return DEFAULT_TAB;
  }

  function showTab(name) {
    if (TABS.indexOf(name) === -1) name = DEFAULT_TAB;
    document.querySelectorAll('.tab').forEach(function (t) {
      const isActive = t.dataset.tab === name;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-body').forEach(function (b) {
      const id = b.id.replace('tab-', '');
      b.hidden = id !== name;
    });
  }

  // ---- Header rendering ----

  function renderHeader(state) {
    const cfg = state.config || {};
    const data = state.data || {};
    const team = data.team || {};
    const rec = team.record || {};

    // Brand + dashboard title.
    const title = cfg.dashboard_title || 'Tracker';
    document.title = title + ' — v2 (in development)';
    setText('brand-title', title);
    setText('brand-sub', 'Day ' + getSeasonDay(data.as_of, cfg.season));

    // Record (e.g. "31–22") + detail (".585 · 2nd AL East").
    if (rec.w !== undefined && rec.l !== undefined) {
      setText('hdr-rec-line', rec.w + '–' + rec.l);
      setText('hdr-rec-detail', formatRecDetail(team));
    } else {
      setText('hdr-rec-line', '—');
      setText('hdr-rec-detail', '');
    }

    // Injury count — clickable chip; popover lands in a later commit.
    const injuries = data.injuries || [];
    setText('il-count', String(injuries.length));

    // Freshness badge — green <24h, amber 24-48h, red >48h since as_of.
    renderFreshness(data.as_of);
  }

  function renderFreshness(asOfIso) {
    const el = document.getElementById('freshness');
    const label = document.getElementById('freshness-label');
    if (!asOfIso) {
      label.textContent = 'Unknown';
      el.className = 'freshness';
      return;
    }
    const fetchedAt = new Date(asOfIso);
    if (isNaN(fetchedAt.getTime())) {
      label.textContent = 'Unknown';
      el.className = 'freshness';
      return;
    }
    const ageHours = (Date.now() - fetchedAt.getTime()) / 3600000;
    let cls = 'freshness';
    let phrase = 'Updated today';
    if (ageHours > 48) { cls += ' red';   phrase = 'Stale — refresh failing'; }
    else if (ageHours > 24) { cls += ' amber'; phrase = 'Updated yesterday'; }
    el.className = cls;
    label.textContent = phrase;
  }

  function formatRecDetail(team) {
    const parts = [];
    const w = team.record && team.record.w;
    const l = team.record && team.record.l;
    if (w !== undefined && (w + l) > 0) {
      const pct = (w / (w + l)).toFixed(3).replace(/^0/, '');
      parts.push(pct);
    }
    if (team.place) parts.push(team.place);
    return parts.join(' · ');
  }

  function getSeasonDay(asOfIso, season) {
    // Rough season-day count from Mar 27 of the configured season.
    if (!season) return '—';
    const asOf = asOfIso ? new Date(asOfIso) : new Date();
    if (isNaN(asOf.getTime())) return '—';
    const openingDay = new Date(season + '-03-27T00:00:00Z');
    const days = Math.floor((asOf - openingDay) / 86400000);
    return days > 0 ? String(days) : '—';
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // ---- Theme toggle hookup ----

  function hookThemeToggle(state) {
    const btn = document.getElementById('theme-toggle');
    const glyph = document.getElementById('theme-glyph');
    function updateGlyph() {
      glyph.textContent = window.JaysTheme.currentMode() === 'dark' ? '☀' : '☾';
    }
    updateGlyph();
    btn.addEventListener('click', function () {
      window.JaysTheme.toggleTheme(state.config);
      updateGlyph();
    });
  }

  function hookIlChip(state) {
    const chip = document.getElementById('il-chip');
    chip.addEventListener('click', function () {
      // Popover lands in a later commit. For now, no-op + visible toggle hint.
      const data = state.data || {};
      const injuries = data.injuries || [];
      // eslint-disable-next-line no-alert
      if (injuries.length === 0) return;
      console.info('[v2] IL chip clicked — popover lands in a later commit. Current IL:',
        injuries.map(function (r) { return r.name + ' (' + (r.status || '?') + ')'; }));
    });
  }

  function hookTabRouting() {
    // Initial render from hash.
    showTab(parseTabFromHash());
    window.addEventListener('hashchange', function () {
      showTab(parseTabFromHash());
    });
    // Click handler: each tab href is "#name"; default browser hashchange
    // covers the routing, but we set aria-selected immediately for a11y.
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () {
        showTab(t.dataset.tab);
      });
    });
  }

  // ---- Bootstrap ----

  function loadAll() {
    // Per-source error handling — one failed fetch does not blank the dashboard.
    // notes.json absent → render with empty notes. config required (theme depends).
    return Promise.all([
      fetch('config.json').then(function (r) { return r.ok ? r.json() : null; }),
      fetch('data.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('notes.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
    ]).then(function (parts) {
      return { config: parts[0] || {}, data: parts[1] || {}, notes: parts[2] || {} };
    });
  }

  function init() {
    loadAll().then(function (state) {
      window.JaysTheme.initTheme(state.config);
      renderHeader(state);
      hookThemeToggle(state);
      hookIlChip(state);
      hookTabRouting();

      // Per-tab renderers. Each module exposes window.Jays<Tab>.render(state).
      // Tabs not yet implemented stay as stubs in the HTML.
      if (window.JaysOverview) window.JaysOverview.render(state);
      if (window.JaysPlayers) window.JaysPlayers.render(state);

      // Expose for later commits + console debugging.
      window.JT_STATE = state;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
