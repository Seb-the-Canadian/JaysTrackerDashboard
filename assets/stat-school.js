/* ============================================================
   Jays Tracker — Stat School tab renderer (v2)
   Reads stat_school.json (lazy-loaded) and notes.json.pitches
   (team-specific layer). Renders:
   - Sticky 212px left index, grouped by hitting/pitching/team/reference
   - Keystone card "how to read every stat here"
   - Per-stat .exp cards with tier badge, "what it is", scale, frame
     line, optional disclosure (formula + why)
   - Honesty card (analyst tint)
   - Pitch-types reference grid (with optional notes.pitches team-note)

   Deep-link target: #stat-<slug> opens this tab, scrolls to the
   matching card, and highlights it briefly.
   ============================================================ */

(function () {
  'use strict';

  let SS_DATA = null;   // loaded stat_school.json
  let SS_LOAD_PROMISE = null;
  // PR-B (audit H7): the error-panel Retry path calls init() again,
  // which re-runs Stat School's render() and previously rebound a fresh
  // hashchange listener every time. After enough retries the
  // listener count climbed and tryOpenFromHash fired N times per
  // navigation. Module-level flag matches the install pattern used by
  // modal.js, render.js theme-toggle, and visibility-refresh.
  let _hashchangeInstalled = false;

  function loadSchool() {
    if (SS_LOAD_PROMISE) return SS_LOAD_PROMISE;
    SS_LOAD_PROMISE = fetch('stat_school.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { SS_DATA = j || { stats: {}, honesty: {}, pitches: [] }; })
      .catch(function () { SS_DATA = { stats: {}, honesty: {}, pitches: [] }; });
    return SS_LOAD_PROMISE;
  }

  // ---- Index sidebar groupings ----

  function groupSlugs() {
    const stats = SS_DATA.stats || {};
    const groups = { hitting: [], pitching: [], team: [], reference: [] };
    Object.keys(stats).forEach(function (slug) {
      const s = stats[slug];
      const grp = groups[s.group] || groups.reference;
      grp.push({ slug: slug, abbr: s.abbr, tier: s.tier, order: s.order || 99 });
    });
    Object.keys(groups).forEach(function (g) {
      groups[g].sort(function (a, b) { return a.order - b.order; });
    });
    return groups;
  }

  function tierLetter(tier) {
    if (tier === 'foundational') return 'F';
    if (tier === 'building') return 'B';
    if (tier === 'advanced') return 'A';
    return '·';
  }
  function tierClass(tier) {
    if (tier === 'foundational') return 'found';
    if (tier === 'building') return 'build';
    if (tier === 'advanced') return 'adv';
    return 'found';
  }
  function tierLabel(tier) {
    if (tier === 'foundational') return 'Foundational';
    if (tier === 'building') return 'Building';
    if (tier === 'advanced') return 'Advanced';
    return 'Reference';
  }
  function groupLabel(g) {
    if (g === 'hitting') return 'Hitting';
    if (g === 'pitching') return 'Pitching';
    if (g === 'team') return 'Team & context';
    return 'Reference';
  }

  // ---- Sidebar ----

  function renderIndex() {
    const nav = document.createElement('nav');
    nav.className = 'ss-index';
    const grouped = groupSlugs();
    const order = ['hitting', 'pitching', 'team', 'reference'];
    order.forEach(function (g) {
      if (!grouped[g].length) return;
      const hdr = document.createElement('div');
      hdr.className = 'idx-grp';
      hdr.textContent = groupLabel(g);
      nav.appendChild(hdr);
      grouped[g].forEach(function (it) {
        const a = document.createElement('a');
        a.className = 'idx-item';
        a.href = '#stat-' + it.slug;
        a.dataset.slug = it.slug;
        a.innerHTML = '<span>' + it.abbr + '</span>'
                    + '<span class="t">' + tierLetter(it.tier) + '</span>';
        nav.appendChild(a);
      });
    });
    // Add reference entries for the always-on items
    const refHdr = document.createElement('div');
    refHdr.className = 'idx-grp';
    refHdr.textContent = 'Reference';
    nav.appendChild(refHdr);
    nav.appendChild(idxItem('pitch-types', 'Pitch types', '✦'));
    nav.appendChild(idxItem('beyond', 'Beyond this app', 'i'));
    return nav;
  }
  function idxItem(slug, label, tag) {
    const a = document.createElement('a');
    a.className = 'idx-item';
    a.href = '#stat-' + slug;
    a.dataset.slug = slug;
    a.innerHTML = '<span>' + label + '</span><span class="t">' + tag + '</span>';
    return a;
  }

  // ---- Keystone (intro) ----

  function renderKeystone() {
    const wrap = document.createElement('div');
    wrap.className = 'keystone';
    // Structural ID, distinct from the ss-stat-<slug> per-stat namespace.
    // Prevents bug B3's class — JSON contributor adding a "mlb_rank" stat
    // can no longer collide.
    wrap.id = 'stat-school-keystone';
    wrap.innerHTML = ''
      + '<h3>How to read every stat here</h3>'
      + '<p>This dashboard never shows a number alone. Each stat appears with its <b style="color:#fff">MLB rank</b> — where the team or player sits among all 30 clubs (or all qualified players). 1st is best, 30th is worst. That frame turns a bare number into "is this good?" without you having to memorise league averages.</p>'
      + '<div class="ks-rank">'
      +   '<span class="ks-tick best">1st</span>'
      +   '<span class="ks-tick">5</span>'
      +   '<span class="ks-tick">10</span>'
      +   '<span class="ks-tick mid">15 · avg</span>'
      +   '<span class="ks-tick">20</span>'
      +   '<span class="ks-tick">25</span>'
      +   '<span class="ks-tick worst">30th</span>'
      + '</div>'
      + '<div class="ks-cap"><span>◀ elite</span><span>league average</span><span>poor ▶</span></div>';
    return wrap;
  }

  // ---- Per-stat card ----

  // PR-G (audit H2 — the load-bearing renderer gap): each stat card now
  // shows the team's live value + ordinal rank when available, and the
  // analyst's team-context note from notes.team.ctx. Previously every
  // card was pure reference text and the dashboard's "every number
  // carries its MLB rank" promise broke on the very tab that explains
  // it.
  //
  // Three lookup paths:
  //  1. data.team_stats[group][slug] → {val, rank}  — most stats
  //  2. data.team.{pythag_w, pythag_l, run_diff}    — team-level slugs
  //  3. (none)                                       — Statcast slugs
  //     not yet hydrated (xwoba, barrel_pct, fip)
  function lookupTeamStat(slug, group, data) {
    const ts = data && data.team_stats;
    if (ts && ts[group] && ts[group][slug]) return ts[group][slug];
    // Special-case slugs that live on data.team rather than team_stats.
    const team = (data && data.team) || {};
    if (slug === 'run_differential' && team.run_diff !== undefined) {
      // Defer to F.signed — uses U+2212 MINUS SIGN for the negative
      // branch (V10 fix). Keeps the value pill aligned with the KPI tile
      // and the Last-10 frame line.
      return { val: window.JaysFormat.signed(team.run_diff), rank: null };
    }
    if (slug === 'pythag' && team.pythag_w !== undefined) {
      // En-dash for the W–L record separator.
      return { val: team.pythag_w + '–' + team.pythag_l, rank: null };
    }
    return null;
  }

  function renderStatCard(slug, s, state) {
    const F = window.JaysFormat;
    const data = (state && state.data) || {};
    const notes = (state && state.notes) || {};
    const teamStat = lookupTeamStat(slug, s.group, data);
    const ctxKey = s.group + '.' + slug;
    const ctxNote = (notes.team && notes.team.ctx && notes.team.ctx[ctxKey]) || null;

    const wrap = document.createElement('div');
    wrap.className = 'exp';
    // Namespaced ID — `ss-stat-` prefix prevents collision with the
    // structural Stat School IDs (keystone, honesty, pitches). User-
    // facing deep-link URLs stay as `#stat-<slug>`; scrollToStat()
    // does the lookup.
    wrap.id = 'ss-stat-' + slug;

    // PR-G: optional value+rank pill, sits beside the tier badge so the
    // identity row reads "ABBR · Name | Tier | <live value+rank>".
    let valuePill = '';
    if (teamStat) {
      const valHtml = '<span class="ss-stat-val-num">'
        + (teamStat.val == null ? F.DASH : teamStat.val)
        + '</span>';
      const rankHtml = (teamStat.rank != null && Number.isFinite(Number(teamStat.rank)))
        ? '<span class="ss-stat-val-rank ' + F.rankTier(teamStat.rank) + '">'
            + F.ordinal(teamStat.rank).replace(/(st|nd|rd|th)$/, '<small>$1</small>')
          + '</span>'
        : '';
      valuePill = '<span class="ss-stat-val">' + valHtml + rankHtml + '</span>';
    }

    const head = document.createElement('div');
    head.className = 'exp-h';
    head.innerHTML = ''
      + '<div class="exp-id">'
      +   '<span class="exp-abbr">' + s.abbr + '</span>'
      +   '<span class="exp-name">' + s.name + '<small>' + groupLabel(s.group) + (s.statcast ? ' · Statcast' : '') + '</small></span>'
      + '</div>'
      + valuePill
      + '<span class="tier ' + tierClass(s.tier) + '"><span class="d"></span>' + tierLabel(s.tier) + '</span>';
    wrap.appendChild(head);

    const body = document.createElement('div');
    body.className = 'exp-b';

    // Definition
    if (s.definition_md) {
      const p = document.createElement('p');
      p.className = 'exp-what';
      p.innerHTML = s.definition_md;
      body.appendChild(p);
    }

    // Scale (if direction provided)
    if (s.direction) {
      const sc = document.createElement('div');
      sc.className = 'scale-read';
      const rev = s.direction === 'lower_better' ? ' rev' : '';
      const dirLabel = s.direction === 'higher_better' ? '▲ Higher is better' : '▼ Lower is better';
      // PR-G: percentile tick on the scale rail when we have a rank.
      // Position derives from rankLeftPercent (rank 1 → 0%, rank 30 →
      // 100% on the un-reversed rail). The `.rev` class flips the
      // visual direction in CSS, so we don't recompute left here.
      let tickHtml = '';
      if (teamStat && teamStat.rank != null && Number.isFinite(Number(teamStat.rank))) {
        const leftPct = F.rankLeftPercent(teamStat.rank).toFixed(1);
        const tier = F.rankTier(teamStat.rank);
        tickHtml = '<span class="ss-rank-tick ' + tier + '" style="left:' + leftPct + '%"></span>';
      }
      sc.innerHTML = ''
        + '<div class="scale-track' + rev + '"><span class="avg"></span>' + tickHtml + '</div>'
        + '<div class="scale-cap">'
        +   '<span>' + (s.scale_low_label || '') + '</span>'
        +   '<span class="dir-chip">' + dirLabel + '</span>'
        +   '<span>' + (s.scale_high_label || '') + '</span>'
        + '</div>';
      body.appendChild(sc);
    }

    // PR-G: Team context note from notes.team.ctx. Renders as an
    // analyst-tinted callout above the frame_line_md — when the analyst
    // has authored a take on this stat for this team, it lives here.
    if (ctxNote) {
      const ctx = document.createElement('div');
      ctx.className = 'ss-ctx';
      ctx.innerHTML = ''
        + '<span class="nib">✎</span>'
        + '<div><span class="lbl">Team context</span><p>' + ctxNote + '</p></div>';
      body.appendChild(ctx);
    }

    // Frame line
    if (s.frame_line_md) {
      const f = document.createElement('div');
      f.className = 'frame-line';
      f.innerHTML = '<span class="fl-ic">#</span><div>' + s.frame_line_md + '</div>';
      body.appendChild(f);
    }

    // Disclosure (formula + why) — Advanced tier only, collapsed by default
    if (s.formula_md || s.why_md) {
      const disc = document.createElement('div');
      disc.className = 'disc';
      const btn = document.createElement('button');
      btn.className = 'disc-toggle';
      btn.type = 'button';
      btn.innerHTML = '<span class="chev">▸</span> Show how it works';
      btn.addEventListener('click', function () {
        const isOpen = disc.classList.toggle('open');
        btn.innerHTML = '<span class="chev">▸</span> ' + (isOpen ? 'Hide how it works' : 'Show how it works');
      });
      disc.appendChild(btn);
      const body2 = document.createElement('div');
      body2.className = 'disc-body';
      if (s.formula_md) {
        const f = document.createElement('div');
        f.className = 'formula';
        f.innerHTML = s.formula_md;
        body2.appendChild(f);
      }
      if (s.why_md) {
        const w = document.createElement('p');
        w.className = 'disc-note';
        w.innerHTML = s.why_md;
        body2.appendChild(w);
      }
      disc.appendChild(body2);
      body.appendChild(disc);
    }

    wrap.appendChild(body);
    return wrap;
  }

  // ---- Honesty card ----

  function renderHonesty() {
    const h = SS_DATA.honesty || {};
    if (!h.body_md) return null;
    const wrap = document.createElement('div');
    wrap.className = 'honest';
    wrap.id = 'stat-school-honesty';
    wrap.innerHTML = ''
      + '<h3>' + (h.title || 'Beyond this dashboard') + '</h3>'
      + '<p>' + h.body_md + '</p>'
      + (h.byline ? '<div class="by">✎ ' + h.byline + '</div>' : '');
    return wrap;
  }

  // ---- Pitch types ----

  function renderPitchTypes(state) {
    const pitches = SS_DATA.pitches || [];
    if (!pitches.length) return null;

    // Optional team-specific notes from notes.json.pitches[name]
    const teamPitchNotes = (state.notes && state.notes.pitches) || {};

    const sec = document.createElement('div');
    sec.className = 'pitch-sec';
    sec.id = 'stat-school-pitches';

    const head = document.createElement('div');
    head.className = 'exp-h';
    head.innerHTML = ''
      + '<div class="exp-id">'
      +   '<span class="exp-abbr" style="font-size:19px;">Pitch types</span>'
      +   '<span class="exp-name" style="align-self:center;">What each pitch does, and how fast</span>'
      + '</div>'
      + '<span class="tier found"><span class="d"></span>Reference</span>';
    sec.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'pitch-grid';
    pitches.forEach(function (p) {
      const card = document.createElement('div');
      card.className = 'pitch';
      const diag = renderBreakDiagram(p.shape || 'straight');
      const right = document.createElement('div');
      let html = ''
        + '<div class="pi-name">' + p.name + ' <span class="ab">' + p.abbr + '</span></div>'
        + '<div class="velo">' + (p.velo_range || '') + '</div>'
        + '<div class="pi-desc">' + p.description_md + '</div>';
      // Team-specific note overlay
      const teamNote = teamPitchNotes[p.name];
      if (teamNote) {
        html += '<div class="team-note">✎ ' + teamNote + '</div>';
      }
      right.innerHTML = html;
      card.appendChild(diag);
      card.appendChild(right);
      grid.appendChild(card);
    });
    sec.appendChild(grid);
    return sec;
  }

  function renderBreakDiagram(shape) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'diag');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('viewBox', '0 0 56 56');

    // Start point at top, end point varies by shape
    const start = { cx: 28, cy: 6 };
    let path, color, endX, endY, dashed = false;
    switch (shape) {
      case 'arm_side':       path = 'M28 6 C 30 24, 36 38, 42 50'; endX = 42; endY = 50; color = 'var(--q-cool)'; break;
      case 'glove_side_small': path = 'M28 6 C 27 24, 22 38, 18 50'; endX = 18; endY = 50; color = 'var(--q-mid)'; break;
      case 'glove_side':     path = 'M28 6 C 26 22, 18 34, 10 46'; endX = 10; endY = 46; color = 'var(--q-warm)'; break;
      case 'drop':           path = 'M28 6 C 30 20, 26 36, 16 50'; endX = 16; endY = 50; color = 'var(--q-hot)'; break;
      case 'arm_side_dashed': path = 'M28 6 C 31 24, 36 40, 40 50'; endX = 40; endY = 50; color = 'var(--q-warm)'; dashed = true; break;
      default:              path = 'M28 6 C 28 24, 28 36, 28 50'; endX = 28; endY = 50; color = 'var(--q-cool)';
    }

    addCircle(svg, start.cx, start.cy, 2.5, 'var(--ink-3)');
    addPath(svg, path, color, 2.4, dashed ? '3 3' : null);
    addCircle(svg, endX, endY, 2.5, color);
    return svg;
  }
  function addCircle(svg, cx, cy, r, fill) {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy);
    c.setAttribute('r', r); c.setAttribute('fill', fill);
    svg.appendChild(c);
  }
  function addPath(svg, d, stroke, sw, dasharray) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', stroke);
    p.setAttribute('stroke-width', sw);
    if (dasharray) p.setAttribute('stroke-dasharray', dasharray);
    svg.appendChild(p);
  }

  // ---- Sidebar scroll-spy + active highlight ----

  function hookIndex(root) {
    const items = root.querySelectorAll('.idx-item');
    items.forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        const slug = a.dataset.slug;
        scrollToStat(slug);
        items.forEach(function (x) { x.classList.remove('active'); });
        a.classList.add('active');
      });
    });
  }

  // User-facing slug → element ID. Per-stat slugs live under the
  // ss-stat- namespace; the structural sections (keystone, honesty,
  // pitches) have their own semantic IDs. SPECIAL_SLUGS lets URLs
  // like #stat-beyond and #stat-pitch-types keep working.
  const SPECIAL_SLUGS = {
    'mlb_rank':    'stat-school-keystone',
    'mlb-rank':    'stat-school-keystone',
    'beyond':      'stat-school-honesty',
    'pitch-types': 'stat-school-pitches',
  };

  function elementForSlug(slug) {
    if (SPECIAL_SLUGS[slug]) {
      return document.getElementById(SPECIAL_SLUGS[slug]);
    }
    return document.getElementById('ss-stat-' + slug);
  }

  function scrollToStat(slug) {
    const el = elementForSlug(slug);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('highlight');
    setTimeout(function () { el.classList.remove('highlight'); }, 1400);
  }

  // ---- Deep-link entry from #stat-<slug> ----

  function tryOpenFromHash() {
    const h = (window.location.hash || '').replace(/^#/, '');
    if (h.indexOf('stat-') !== 0) return false;
    const slug = h.slice(5);
    // Activate Stat School tab if not already
    if (window.JaysOverview /* render module proxy */) {
      // Trigger tab change via the standard tab anchor click flow
      const tab = document.querySelector('.tab[data-tab="stat-school"]');
      if (tab) tab.click();
    }
    setTimeout(function () { scrollToStat(slug); }, 50);
    return true;
  }

  // ---- Main entry ----

  function renderSkeleton(root) {
    // Synchronous placeholder while stat_school.json is in-flight.
    // Bug B8: previously empty body during load (slow network UX).
    root.innerHTML = ''
      + '<div class="panel-skeleton">'
      +   '<div class="sk-line" style="width:35%"></div>'
      +   '<div class="sk-line" style="width:60%"></div>'
      +   '<div class="sk-line" style="width:90%"></div>'
      +   '<div class="sk-line" style="width:75%"></div>'
      +   '<div class="sk-line" style="width:55%"></div>'
      + '</div>';
  }

  function render(state) {
    const root = document.getElementById('tab-stat-school');
    if (!root) return Promise.resolve();

    // Synchronous skeleton + sr-only h2 so the tab body isn't empty if
    // the user activates Stat School during the JSON load. Bug B8.
    window.JaysDom.tabBody('stat-school', 'Stat School', function (host) {
      host.appendChild(window.JaysDom.skeleton({
        widths: ['35%', '60%', '90%', '75%', '55%'],
      }));
    });

    return loadSchool().then(function () {
      window.JaysDom.tabBody('stat-school', 'Stat School', function (host) {
        host.appendChild(introBlock());

        const grid = document.createElement('div');
        grid.className = 'ss-grid';

        const idx = renderIndex();
        grid.appendChild(idx);

        const col = document.createElement('div');
        col.className = 'ss-col';

        col.appendChild(renderKeystone());

        const stats = SS_DATA.stats || {};
        const order = ['hitting', 'pitching', 'team', 'reference'];
        order.forEach(function (g) {
          const slugs = Object.keys(stats)
            .filter(function (s) { return stats[s].group === g; })
            .sort(function (a, b) { return (stats[a].order || 99) - (stats[b].order || 99); });
          slugs.forEach(function (slug) {
            col.appendChild(renderStatCard(slug, stats[slug], state));
          });
        });

        const honesty = renderHonesty();
        if (honesty) col.appendChild(honesty);

        const pitches = renderPitchTypes(state);
        if (pitches) col.appendChild(pitches);

        grid.appendChild(col);
        host.appendChild(grid);

        hookIndex(idx);

        // If we arrived here via #stat-<slug>, scroll to it.
        setTimeout(function () {
          const h = (window.location.hash || '').replace(/^#/, '');
          if (h.indexOf('stat-') === 0) scrollToStat(h.slice(5));
        }, 50);
      }, { headingProvided: true });

      // Wire global #stat-* navigation from other tabs. Idempotent —
      // re-invocations from the Retry path won't double-bind (PR-B).
      if (!_hashchangeInstalled) {
        _hashchangeInstalled = true;
        window.addEventListener('hashchange', tryOpenFromHash);
      }
    });
  }

  function introBlock() {
    const wrap = document.createElement('div');
    wrap.innerHTML = ''
      + '<p class="ss-eyebrow">The growth layer</p>'
      + '<div class="ss-intro-line">'
      +   '<div>'
      +     '<h2>Stat School</h2>'
      +     '<p>Every number this dashboard shows, explained in plain language — and where to find it. Built to be read across a season, not once.</p>'
      +   '</div>'
      +   '<span class="ss-ref-tag">✎ Maintainer-authored reference</span>'
      + '</div>';
    return wrap;
  }

  window.JaysStatSchool = { render: render, scrollToStat: scrollToStat, tryOpenFromHash: tryOpenFromHash };
})();
