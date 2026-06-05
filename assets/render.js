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

  // Top-level keys the renderer expects in data.json. Ported from v1
  // (`index.html` EXPECTED_KEYS) — survivorship audit T1 found this guard
  // had been silently dropped in the v2 redesign. When the fetcher omits
  // a key the renderer expects, the dashboard silently renders empty
  // panels with no operator-visible signal. validateSchema() restores
  // the v1 banner.
  //
  // F1 added 'player_ranks' (audit H1 — the per-player rank cluster).
  // G3 added 'opponent_pitchers' (opposing-pitcher modal source).
  // player_rank_pool (percentile fix) carries the qualified-pool sizes.
  const EXPECTED_KEYS = [
    'as_of', 'team', 'division', 'wild_card', 'recent_games',
    'upcoming_games', 'opponent_pitchers', 'roster', 'injuries',
    'other_unavailable', 'transactions', 'news', 'run_diff_last_10',
    'team_stats', 'player_ranks', 'player_rank_pool', 'config', 'notes_meta',
  ];

  // ---- Auto-refresh state (survivorship T21) ----
  //
  // The bootstrap fetches once at init; before this PR, a tab left open
  // across the daily refresh silently rendered yesterday's data. We
  // re-fetch on visibilitychange after a 5-minute cooldown so a reader
  // returning to a backgrounded tab sees today's data — without thrashing
  // for rapid focus toggles.
  let lastFetchAt = 0;
  const REFETCH_COOLDOWN_MS = 5 * 60 * 1000;
  let _visListenerInstalled = false;

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
    // Defensive Number() coercion (survivorship T9) — if MLB Stats API ever
    // returns string-typed w/l, downstream arithmetic silently coerces in
    // surprising ways (e.g. `("29" + 32) > 0` evaluates string concat,
    // yielding "2932" and a win-% of .010).
    const wRaw = rec.w, lRaw = rec.l;
    if (wRaw !== undefined && lRaw !== undefined) {
      const w = Number(wRaw);
      const l = Number(lRaw);
      const wOk = Number.isFinite(w), lOk = Number.isFinite(l);
      setText('hdr-rec-line', (wOk ? w : wRaw) + '–' + (lOk ? l : lRaw));
      setText('hdr-rec-detail', formatRecDetail(team));
    } else {
      setText('hdr-rec-line', '—');
      setText('hdr-rec-detail', '');
    }

    // Injury count — drives the IL chip + popover (B5 fix). Filters
    // "Reassigned to Minors" out of the count and the popover list
    // (closes #28) — these are roster moves, not injuries.
    setText('il-count', String(filteredInjuries(data).length));

    // Freshness badge — green <24h, amber 24-48h, red >48h since as_of.
    renderFreshness(data.as_of);
    // Notes-staleness badge — ported from v1's applyNotesStaleness
    // (survivorship T18). Separate cadence from data freshness because
    // analyst voice ages on a weekly+, not daily, schedule.
    applyNotesStaleness(data.notes_meta);
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
    // Defensive Number() coercion (survivorship T9 — string-typed w/l
    // would compute `("29" + "32") > 0` (string concat → "2932") and
    // produce a wrong win-% like ".010".
    const wRaw = team.record && team.record.w;
    const lRaw = team.record && team.record.l;
    const w = Number(wRaw), l = Number(lRaw);
    if (Number.isFinite(w) && Number.isFinite(l) && (w + l) > 0) {
      const pct = (w / (w + l)).toFixed(3).replace(/^0/, '');
      parts.push(pct);
    }
    if (team.place) parts.push(team.place);
    return parts.join(' · ');
  }

  function getSeasonDay(asOfIso, season) {
    // Rough season-day count from Mar 27 of the configured season.
    // Survivorship T2: opening day (March 27) IS day 1 of the season —
    // the prior `days > 0` predicate rendered "Day —" on the dashboard's
    // single biggest-traffic day. `days >= 0 ? days + 1 : '—'` reads
    // "Day 1" on opening day; "Day 2" the day after; "—" only for
    // pre-season / invalid input.
    if (!season) return '—';
    const asOf = asOfIso ? new Date(asOfIso) : new Date();
    if (isNaN(asOf.getTime())) return '—';
    const openingDay = new Date(season + '-03-27T00:00:00Z');
    const days = Math.floor((asOf - openingDay) / 86400000);
    return days >= 0 ? String(days + 1) : '—';
  }

  // ---- Schema-drift banner (survivorship T1, ported from v1) ----
  //
  // The fetcher and the renderer drift over time. If a future fetcher
  // change drops a top-level key the renderer expects (or someone
  // hand-edits data.json), the dashboard silently renders empty panels.
  // The banner surfaces this so the operator can react before readers
  // hit the broken state.
  function validateSchema(data) {
    const banner = document.getElementById('schemaBanner');
    if (!banner || !data || typeof data !== 'object') return;
    const missing = EXPECTED_KEYS.filter(function (k) { return !(k in data); });
    if (missing.length === 0) {
      banner.hidden = true;
      banner.textContent = '';
      return;
    }
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('data.json schema drift — missing top-level keys:', missing);
    }
    banner.textContent = 'Data schema warning: missing fields — '
      + missing.join(', ')
      + '. Dashboard may render incompletely.';
    banner.hidden = false;
  }

  // ---- Notes-staleness chip (survivorship T18, ported from v1) ----
  //
  // The analyst voice has its own cadence (notes.json is hand-authored,
  // not daily-fetched). v1 surfaced its age in the header so a reader
  // could tell apart "today's read" from "30 days old commentary." v2
  // initially dropped this; T18 restored it with the same green / amber
  // (>7d) / red (>14d) thresholds. The `tools/check_notes_freshness.py`
  // CI step warns at the same thresholds.
  function applyNotesStaleness(notesMeta) {
    const el = document.getElementById('notesStale');
    if (!el) return;
    const iso = notesMeta && notesMeta.last_updated_iso;
    if (!iso) {
      el.hidden = true;
      el.textContent = '';
      el.className = 'notes-stale-chip';
      return;
    }
    const updated = new Date(iso);
    if (isNaN(updated.getTime())) {
      el.hidden = true;
      el.textContent = '';
      el.className = 'notes-stale-chip';
      return;
    }
    const ageDays = Math.floor((Date.now() - updated.getTime()) / 86400000);
    let cls = 'notes-stale-chip';
    if (ageDays > 14) cls += ' red';
    else if (ageDays > 7) cls += ' amber';
    else cls += ' green';
    let label;
    if (ageDays <= 0) label = 'Analyst voice: refreshed today';
    else if (ageDays === 1) label = 'Analyst voice: 1d old';
    else label = 'Analyst voice: ' + ageDays + 'd old';
    el.className = cls;
    el.textContent = label;
    el.hidden = false;
  }

  // ---- Auto-refresh on visibility (survivorship T21) ----
  //
  // A tab left open across the 09:00 UTC daily refresh silently shows
  // yesterday's data. visibilitychange + a 5-min cooldown is the lowest-
  // intervention fix — no polling, no timer, no battery drain. When the
  // user returns to the tab and enough time has elapsed for fresh data
  // to exist, we re-fetch.
  //
  // Idempotent install — calling init() again (from the error-panel
  // Retry path) won't double-bind. PR-B aligned the rest of the hooks
  // (hookThemeToggle, hookTabRouting, stat-school's hashchange listener)
  // to the same pattern.
  function installVisibilityRefresh() {
    if (_visListenerInstalled) return;
    _visListenerInstalled = true;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastFetchAt < REFETCH_COOLDOWN_MS) return;
      loadAll().then(renderFromState);
    });
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // ---- Theme toggle hookup ----
  //
  // PR-B (audit H7): the error-panel Retry calls init() again, which
  // would re-bind every listener and produce duplicate handlers per
  // event. The module-level `_themeHooked` flag mirrors the pattern
  // used by `installVisibilityRefresh` and modal.js.

  let _themeHooked = false;
  function hookThemeToggle(state) {
    if (_themeHooked) return;
    _themeHooked = true;
    const btn = document.getElementById('theme-toggle');
    const glyph = document.getElementById('theme-glyph');
    function updateGlyph() {
      glyph.textContent = window.JaysTheme.currentMode() === 'dark' ? '☀' : '☾';
    }
    updateGlyph();
    btn.addEventListener('click', function () {
      window.JaysTheme.toggleTheme();
      // updateGlyph runs again via the jt-theme-change event listener
      // below; the click is the canonical trigger but the event is what
      // any other glyph subscribes to (B4 fix).
    });
    // Subscribe to theme changes initiated anywhere (modal-internal
    // toggle included). Keeps the page-level glyph in sync after the
    // modal flips and closes.
    window.addEventListener('jt-theme-change', updateGlyph);
  }

  // IL popover state — module-local. The chip handler runs at boot
  // (data hasn't loaded yet), so click reads from _lastState which
  // renderFromState updates on every refresh.
  let _ilHooked = false;
  let _ilOpen = false;
  let _ilPopover = null;

  function filteredInjuries(data) {
    // Filter "Reassigned to Minors" — roster moves, not injuries
    // (closes #28). Keep the comparison loose to also catch "Sent
    // to Minors" / "Optioned" style messages MLB occasionally ships
    // through the same feed.
    return ((data && data.injuries) || []).filter(function (inj) {
      const st = String(inj.status || '');
      return !/reassigned to minors|optioned to minors|sent to minors/i.test(st);
    });
  }

  function buildIlPopoverContent(state) {
    const F = window.JaysFormat;
    const data = (state && state.data) || {};
    const injuries = filteredInjuries(data);
    if (injuries.length === 0) {
      return '<div class="il-pop-head"><b>Injured list</b></div>'
        + '<p class="il-pop-empty">No one on the IL today.</p>';
    }
    let html = '<div class="il-pop-head"><b>Injured list</b> <small>'
      + injuries.length + ' player' + (injuries.length === 1 ? '' : 's') + '</small></div>'
      + '<ul class="il-pop-list">';
    injuries.forEach(function (inj) {
      const name = F.escapeHtml(inj.name || '—');
      const status = F.escapeHtml(inj.status || '');
      const eta = inj.eta_note ? '<small>' + F.escapeHtml(inj.eta_note) + '</small>' : '';
      html += '<li><span class="il-pop-name">' + name + '</span>'
        + '<span class="il-pop-status">' + status + '</span>' + eta + '</li>';
    });
    html += '</ul>';
    return html;
  }

  function openIl() {
    const chip = document.getElementById('il-chip');
    if (!chip || !_lastState) return;
    if (!_ilPopover) {
      _ilPopover = document.createElement('div');
      _ilPopover.className = 'il-popover';
      _ilPopover.id = 'il-popover';
      _ilPopover.setAttribute('role', 'dialog');
      _ilPopover.setAttribute('aria-label', 'Injured list');
      document.body.appendChild(_ilPopover);
    }
    _ilPopover.innerHTML = buildIlPopoverContent(_lastState);
    // Position below the chip, anchored to its right edge so a wide
    // popover doesn't overflow the viewport on the left.
    const r = chip.getBoundingClientRect();
    const w = 320;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
    _ilPopover.style.left = (left + window.scrollX) + 'px';
    _ilPopover.style.top = (r.bottom + 6 + window.scrollY) + 'px';
    _ilPopover.classList.add('show');
    chip.setAttribute('aria-expanded', 'true');
    _ilOpen = true;
  }

  function closeIl() {
    if (_ilPopover) _ilPopover.classList.remove('show');
    const chip = document.getElementById('il-chip');
    if (chip) chip.setAttribute('aria-expanded', 'false');
    _ilOpen = false;
  }

  function hookIlChip(state) {
    if (_ilHooked) return;
    _ilHooked = true;
    void state; // state cached via renderFromState → _lastState
    const chip = document.getElementById('il-chip');
    if (!chip) return;
    chip.setAttribute('aria-expanded', 'false');
    chip.setAttribute('aria-haspopup', 'dialog');
    chip.setAttribute('aria-controls', 'il-popover');
    chip.addEventListener('click', function (e) {
      e.stopPropagation();
      if (_ilOpen) closeIl();
      else openIl();
    });
    document.addEventListener('click', function (e) {
      if (!_ilOpen) return;
      if (_ilPopover && _ilPopover.contains(e.target)) return;
      closeIl();
    });
    document.addEventListener('keydown', function (e) {
      if (_ilOpen && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeIl();
        chip.focus();
      }
    });
    // Keep popover content fresh: rebuild on every open from current
    // _lastState. Also rebuild if open during a data refresh.
    window.addEventListener('jt-data-refresh', function () {
      if (_ilOpen && _lastState) {
        _ilPopover.innerHTML = buildIlPopoverContent(_lastState);
      }
    });
  }

  let _tabsHooked = false;
  function hookTabRouting() {
    // Initial render from hash always runs — that's idempotent on the
    // DOM (showTab toggles classes; running twice is fine).
    showTab(parseTabFromHash());
    // Listener install is once-only.
    if (_tabsHooked) return;
    _tabsHooked = true;
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

  // Cached state — the IL popover handler runs at boot (data not yet
  // available) and reads from this at click time. Dispatched as
  // jt-data-refresh so any other chrome that needs to react to a refresh
  // can subscribe instead of polling.
  let _lastState = null;

  function renderFromState(state) {
    _lastState = state;
    try { window.dispatchEvent(new CustomEvent('jt-data-refresh')); }
    catch (_) { /* non-blocking */ }
    // Theme mode was set synchronously at init (skeleton time); only the
    // team-identity tokens need re-applying now that config has arrived.
    window.JaysTheme.applyTeamTheme(state.config);
    // Schema-drift guard (T1) — surface missing top-level keys before
    // any per-tab renderer trips over them.
    validateSchema(state.data);
    renderHeader(state);

    // Per-tab dispatch. If a tab's required data is unavailable, render
    // the error panel so the user sees the failure (and a retry path)
    // rather than a stale skeleton or a blank section.
    //
    // PR-B (audit H8): Stat School is excluded from the data.json gate.
    // Its content comes from stat_school.json — a separate, independent
    // source — and its renderer manages its own loading state. Letting
    // it render keeps the reference layer available even when the
    // daily-refresh fetcher is having a bad day.
    const dataMissing = state.errors && state.errors.data;
    const renderOrError = function (tabId, renderer, opts) {
      const requiresData = !(opts && opts.dataIndependent);
      if (dataMissing && requiresData) {
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
    renderOrError('stat-school',
      window.JaysStatSchool && window.JaysStatSchool.render,
      { dataIndependent: true });

    // Mark when the last data write happened — drives the
    // visibilitychange re-fetch cooldown (T21).
    lastFetchAt = Date.now();
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
    // Install the visibility-driven auto-refresh (T21). All hookers
    // are idempotent (PR-B): calling init() again from the error-panel
    // Retry path no longer double-binds theme-toggle / hashchange /
    // visibilitychange listeners.
    installVisibilityRefresh();
    // 4. Await fetches, then replace skeletons with real content.
    //    Stat registry joins the gate (issue #125): renderers gate the
    //    `.term[data-stat]` affordance on JaysStatRegistry.has(slug), so
    //    the registry must be in memory before any tab renders. Without
    //    this await, the gate would read empty on first paint and every
    //    documented stat would lose its tooltip until a re-render.
    Promise.all([
      loadAll(),
      window.JaysStatRegistry ? window.JaysStatRegistry.load() : Promise.resolve(),
    ]).then(function (parts) { renderFromState(parts[0]); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
