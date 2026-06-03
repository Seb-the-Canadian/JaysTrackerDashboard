/* ============================================================
   Jays Tracker — Team Stats tab renderer (v2)
   Reads state.data.team_stats; renders:
   1. Strengths & Soft spots panel — auto-derived top-3/bottom-3
      across both groups (handoff §T1).
   2. Hitting/Pitching segmented control + per-group ledger table
      with rank strip on every row (handoff §T2).

   Stat label/order map lives inline until stat_school.json lands
   (commit 8). Optional analyst notes come from
   notes.json.team.strengths_note + softspots_note (handoff §T1).
   ============================================================ */

(function () {
  'use strict';

  const F = window.JaysFormat;

  // ---- Stat dictionary (inline until stat_school.json) ----
  // slug → { label, group, statcast?, order, isPercentage? }
  // For ranks: lower = better for ERA/FIP/WHIP/BB9; otherwise higher = better.
  const STAT_DICT = {
    // Hitting
    runs: { label: 'Runs', group: 'hitting', order: 1 },
    avg:  { label: 'AVG', group: 'hitting', order: 4 },
    obp:  { label: 'OBP', group: 'hitting', order: 2 },
    slg:  { label: 'SLG', group: 'hitting', order: 5 },
    ops:  { label: 'OPS', group: 'hitting', order: 3 },
    hr:   { label: 'Home runs', group: 'hitting', order: 6 },
    xwoba: { label: 'xwOBA', group: 'hitting', statcast: true, order: 7 },
    barrel_pct: { label: 'Barrel%', group: 'hitting', statcast: true, order: 8 },
    hardhit_pct: { label: 'Hard-hit%', group: 'hitting', statcast: true, order: 9 },
    // Pitching
    era:  { label: 'ERA', group: 'pitching', order: 1 },
    fip:  { label: 'FIP', group: 'pitching', order: 2 },
    whip: { label: 'WHIP', group: 'pitching', order: 3 },
    k9:   { label: 'K/9', group: 'pitching', order: 4 },
    bb9:  { label: 'BB/9', group: 'pitching', order: 5 },
  };

  // ---- Helpers ----

  function tierForRank(rank) {
    return F.rankTier(rank);
  }

  // Top-N strengths (lowest rank numbers).
  function topRanked(group, teamStats, n) {
    const stats = (teamStats && teamStats[group]) || {};
    const list = [];
    for (const slug in stats) {
      const entry = stats[slug];
      if (entry && entry.rank != null) {
        list.push({ slug: slug, rank: entry.rank, val: entry.val, group: group });
      }
    }
    list.sort(function (a, b) { return a.rank - b.rank; });
    return list.slice(0, n);
  }

  function bottomRanked(group, teamStats, n) {
    const list = topRanked(group, teamStats, 30); // get all
    return list.sort(function (a, b) { return b.rank - a.rank; }).slice(0, n);
  }

  function statLabel(slug) {
    return (STAT_DICT[slug] && STAT_DICT[slug].label) || slug.toUpperCase();
  }

  // ---- Strengths & Soft spots ----

  function renderStrengthsSoftSpots(state) {
    const data = state.data || {};
    const teamStats = data.team_stats || {};
    // Combine both groups; take overall top-3 / bottom-3.
    let combined = [];
    Object.keys(teamStats).forEach(function (group) {
      const ranked = topRanked(group, teamStats, 30);
      combined = combined.concat(ranked);
    });
    combined.sort(function (a, b) { return a.rank - b.rank; });
    const strengths = combined.slice(0, 3);
    const softs = combined.slice(-3).reverse();   // worst first within the column

    // Analyst notes — handoff §T1
    const notes = (state.notes && state.notes.team) || {};
    const strengthNote = notes.strengths_note || null;
    const softspotsNote = notes.softspots_note || null;

    // Build the 2-col panel
    const panel = document.createElement('div');
    panel.className = 'panel';

    const sss = document.createElement('div');
    sss.className = 'sss';

    sss.appendChild(buildSssCol('good', 'Strengths', strengths, strengthNote));
    sss.appendChild(buildSssCol('bad', 'Soft spots', softs, softspotsNote));

    panel.appendChild(sss);
    return panel;
  }

  function buildSssCol(type, label, rows, note) {
    const col = document.createElement('div');
    col.className = 'sss-col';
    col.innerHTML = '<span class="sss-tag ' + type + '"><span class="pip"></span> ' + label + '</span>';
    rows.forEach(function (r) { col.appendChild(buildSssRow(r)); });
    if (note) {
      const n = document.createElement('div');
      n.className = 'sss-note';
      n.innerHTML = '<span class="nib">✎</span><p>' + note + '</p>';
      col.appendChild(n);
    }
    return col;
  }

  function buildSssRow(r) {
    const row = document.createElement('div');
    row.className = 'sss-row';
    const tier = tierForRank(r.rank);
    const left = F.rankLeftPercent(r.rank).toFixed(0);
    row.innerHTML = ''
      + '<div class="sss-name">' + statLabel(r.slug)
      +   '<small>' + (r.val == null ? '—' : r.val) + '</small>'
      + '</div>'
      + '<div class="strip">'
      +   '<span class="avg"></span>'
      +   '<span class="mk ' + tier + '" style="left:' + left + '%"></span>'
      + '</div>'
      + '<div class="rank-num ' + tier + '">' + F.ordinal(r.rank) + '</div>';
    return row;
  }

  // ---- Ledger table ----

  function renderLedger(state, group) {
    const data = state.data || {};
    const stats = (data.team_stats && data.team_stats[group]) || {};
    const slugs = Object.keys(stats).sort(function (a, b) {
      const oa = (STAT_DICT[a] && STAT_DICT[a].order) || 99;
      const ob = (STAT_DICT[b] && STAT_DICT[b].order) || 99;
      return oa - ob;
    });

    const panel = document.createElement('div');
    panel.className = 'panel';

    const head = document.createElement('div');
    head.className = 'panel-h';
    head.innerHTML = ''
      + '<h3>' + (group === 'hitting' ? 'Hitting' : 'Pitching') + ' — full line</h3>'
      + '<span class="srctag machine">◆ MLB data · qualified · season totals</span>';
    panel.appendChild(head);

    const tbl = document.createElement('div');
    tbl.className = 'tbl';

    const headerRow = document.createElement('div');
    headerRow.className = 'tbl-head';
    headerRow.innerHTML = ''
      + '<span>Stat</span><span class="c-val">Value</span>'
      + '<span class="c-strip"><i>◀ 1st (best)</i><i>avg</i><i>30th ▶</i></span>'
      + '<span class="c-rank">Rank</span>';
    tbl.appendChild(headerRow);

    slugs.forEach(function (slug) {
      const s = stats[slug];
      if (!s) return;
      const def = STAT_DICT[slug] || {};
      const tier = tierForRank(s.rank);
      const left = s.rank ? F.rankLeftPercent(s.rank).toFixed(0) : 50;

      const row = document.createElement('div');
      row.className = 'tbl-row';
      row.innerHTML = ''
        + '<div class="c-stat">'
        +   '<span class="term" data-stat="' + slug + '">' + (def.label || slug) + '</span>'
        +   (def.statcast ? ' <span class="sc">Statcast</span>' : '')
        + '</div>'
        + '<div class="c-val">' + (s.val == null ? '—' : s.val) + '</div>'
        + '<div class="strip">'
        +   '<span class="avg"></span>'
        +   (s.rank ? '<span class="mk ' + tier + '" style="left:' + left + '%"></span>' : '')
        + '</div>'
        + '<div class="c-rank ' + tier + '">'
        +   (s.rank ? F.ordinal(s.rank).replace(/(st|nd|rd|th)$/, '<small>$1</small>') : '<span style="color:var(--ink-4)">—</span>')
        + '</div>';
      tbl.appendChild(row);
    });

    panel.appendChild(tbl);
    return panel;
  }

  // ---- Main entry ----

  let CURRENT_GROUP = 'hitting';
  let LEDGER_HOST = null;

  function render(state) {
    window.JaysDom.tabBody('team-stats', 'Team Stats', function (root) {
      root.appendChild(headerBlock());
      root.appendChild(renderStrengthsSoftSpots(state));

      const host = document.createElement('div');
      host.style.marginTop = '14px';
      LEDGER_HOST = host;
      host.appendChild(renderLedger(state, CURRENT_GROUP));
      root.appendChild(host);
    });

    // Wire Hitting/Pitching toggle. Selector is scoped to the seg
    // control rendered inside headerBlock().
    document.querySelectorAll('.seg button').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.seg button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        CURRENT_GROUP = b.dataset.group;
        LEDGER_HOST.innerHTML = '';
        LEDGER_HOST.appendChild(renderLedger(state, CURRENT_GROUP));
      });
    });
  }

  function headerBlock() {
    const wrap = document.createElement('div');
    wrap.innerHTML = ''
      + '<p class="ov-eyebrow">Where the team ranks <span class="rule"></span></p>'
      + '<div class="ts-head">'
      +   '<div>'
      +     '<h2>Team Stats</h2>'
      +     '<p>Every number against all 30 clubs — so a stat is never just a stat.</p>'
      +   '</div>'
      +   '<div class="ts-controls">'
      +     '<div class="seg">'
      +       '<button class="on" data-group="hitting">Hitting</button>'
      +       '<button data-group="pitching">Pitching</button>'
      +     '</div>'
      +     '<span class="sort-hint">↕ Sorted by MLB rank</span>'
      +   '</div>'
      + '</div>';
    return wrap;
  }

  window.JaysTeamStats = { render: render };
})();
