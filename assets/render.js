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
    // Exact tab match wins.
    if (TABS.indexOf(h) !== -1) return h;
    // Deep-link prefixes — each per-tab module handles its own anchor /
    // modal logic on top of the tab being active. Bug B2: previously
    // fell back to overview, so a direct-load #stat-xwoba landed on
    // Overview instead of activating Stat School + scrolling.
    if (h.indexOf('stat-') === 0) return 'stat-school';
    if (h.indexOf('player-') === 0) return 'players';
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
      window.JaysTheme.toggleTheme();
      updateGlyph();
    });
  }

  function hookIlChip(state) {
    // IL chip is currently a static badge. Popover (names + status + ETA)
    // is a tracked follow-up (M2 from the round-1 bug log).
    void state;
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
    // Each source captures its own failure so the per-tab render path can
    // distinguish "data unavailable" from "data is empty by design".
    return Promise.all([
      fetch('config.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('data.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('notes.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
    ]).then(function (parts) {
      return {
        config: parts[0] || {},
        data: parts[1] || {},
        notes: parts[2] || {},
        errors: {
          config: parts[0] == null,
          data: parts[1] == null,
        },
      };
    });
  }

  // Synchronous skeleton paint — runs before any fetch await so the
  // tab body is never blank during the load window. Bug B8 class:
  // a new async source must never produce a blank UI.
  function paintSkeletons() {
    if (!window.JaysDom) return;
    ['overview', 'players', 'team-stats', 'stat-school'].forEach(function (id) {
      const name = TAB_TITLES[id] || id;
      window.JaysDom.tabBody(id, name, function (root) {
        const panel = document.createElement('div');
        panel.className = 'panel';
        panel.appendChild(window.JaysDom.skeletonForTab(id));
        root.appendChild(panel);
      });
    });
  }

  const TAB_TITLES = {
    overview: 'Overview',
    players: 'Players',
    'team-stats': 'Team Stats',
    'stat-school': 'Stat School',
  };

  function renderFromState(state) {
    // Theme mode was set synchronously at init (skeleton time); only the
    // team-identity tokens need re-applying now that config has arrived.
    window.JaysTheme.applyTeamTheme(state.config);
    renderHeader(state);

    // Per-tab dispatch. If a tab's required data is unavailable, render
    // the error panel so the user sees the failure (and a retry path)
    // rather than a stale skeleton or a blank section.
    const dataMissing = state.errors && state.errors.data;
    const renderOrError = function (tabId, renderer) {
      if (dataMissing) {
        window.JaysDom.tabBody(tabId, TAB_TITLES[tabId] || tabId, function (root) {
          root.appendChild(window.JaysDom.errorPanel({
            message: 'Live data unavailable. Refresh may be in progress.',
            retry: function () { init(); },
          }));
        });
        return;
      }
      if (renderer) renderer(state);
    };
    renderOrError('overview', window.JaysOverview && window.JaysOverview.render);
    renderOrError('players', window.JaysPlayers && window.JaysPlayers.render);
    renderOrError('team-stats', window.JaysTeamStats && window.JaysTeamStats.render);
    renderOrError('stat-school', window.JaysStatSchool && window.JaysStatSchool.render);

    // Expose for later commits + console debugging.
    window.JT_STATE = state;
  }

  function init() {
    // 1. Set dark/light mode from localStorage/system preference before
    //    any paint, so the skeleton renders in the user's chosen theme
    //    from frame 1 — no flicker on dark-mode loads.
    window.JaysTheme.initTheme(null);
    // 2. Paint skeletons synchronously so the tab body is non-blank
    //    before any network roundtrip resolves.
    paintSkeletons();
    // 3. Hook chrome that doesn't depend on data (theme toggle, tab nav).
    //    Header chrome that DOES depend on data renders inside renderFromState.
    hookThemeToggle({});
    hookIlChip({});
    hookTabRouting();
    // 4. Await fetches, then replace skeletons with real content.
    loadAll().then(renderFromState);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
