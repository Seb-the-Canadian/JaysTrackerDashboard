/* ============================================================
   Jays Tracker — Overview tab renderer (v2)
   Reads state.data + state.notes; populates the Overview tab body.

   Components: 4 KPIs, State of the Season (analyst), Run-diff chart,
   Recent/Upcoming games, AL East standings, Wild Card race, Voices.

   Per handoff §0/§4: honest framing — no axis compression, struggle
   shown at full weight, machine numbers always carry their frame.
   ============================================================ */

(function () {
  'use strict';

  const F = window.JaysFormat;

  // ---- Utilities ----

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') e.className = attrs[k];
        else if (k === 'html') e.innerHTML = attrs[k];
        else e.setAttribute(k, attrs[k]);
      }
    }
    if (children) {
      if (typeof children === 'string') e.textContent = children;
      else if (Array.isArray(children)) children.forEach(function (c) { if (c) e.appendChild(c); });
      else e.appendChild(children);
    }
    return e;
  }

  function abbreviate(teamName, fallback) {
    // Heuristic 3-letter abbr from a team name. Used for opponent tiles
    // when MLB Stats API hasn't given us the abbr directly.
    if (!teamName) return fallback || '???';
    const KNOWN = {
      'New York Yankees': 'NYY', 'Tampa Bay Rays': 'TBR',
      'Boston Red Sox': 'BOS', 'Baltimore Orioles': 'BAL',
      'Toronto Blue Jays': 'TOR', 'Cleveland Guardians': 'CLE',
      'Detroit Tigers': 'DET', 'Minnesota Twins': 'MIN',
      'Kansas City Royals': 'KCR', 'Chicago White Sox': 'CWS',
      'Houston Astros': 'HOU', 'Seattle Mariners': 'SEA',
      'Texas Rangers': 'TEX', 'Los Angeles Angels': 'LAA',
      'Athletics': 'OAK', 'Oakland Athletics': 'OAK',
      'Atlanta Braves': 'ATL', 'New York Mets': 'NYM',
      'Philadelphia Phillies': 'PHI', 'Washington Nationals': 'WSN',
      'Miami Marlins': 'MIA', 'Milwaukee Brewers': 'MIL',
      'Chicago Cubs': 'CHC', 'Cincinnati Reds': 'CIN',
      'Pittsburgh Pirates': 'PIT', 'St. Louis Cardinals': 'STL',
      'Arizona Diamondbacks': 'ARI', 'Colorado Rockies': 'COL',
      'Los Angeles Dodgers': 'LAD', 'San Diego Padres': 'SDP',
      'San Francisco Giants': 'SFG',
    };
    if (KNOWN[teamName]) return KNOWN[teamName];
    // Fallback: first three letters of last word, uppercased.
    const parts = teamName.split(/\s+/);
    return (parts[parts.length - 1] || teamName).slice(0, 3).toUpperCase();
  }

  // ---- KPI cards ----

  function renderKpis(state) {
    const data = state.data || {};
    const team = data.team || {};
    const rec = team.record || {};
    const w = Number(rec.w) || 0;
    const l = Number(rec.l) || 0;
    const games = w + l;
    const recent = data.recent_games || [];
    const last10 = recent.slice(-10);   // newest at end of array

    // Compute last-10 W and L
    var l10w = 0, l10l = 0;
    last10.forEach(function (g) {
      if (g.result === 'W') l10w++;
      else if (g.result === 'L') l10l++;
    });

    // Pace = current win% × 162
    const pace = games ? Math.round((w / games) * 162) : null;
    const pyW = Number(team.pythag_w);
    const pyL = Number(team.pythag_l);
    const pythag162 = (pyW + pyL) ? Math.round((pyW / (pyW + pyL)) * 162) : null;

    // Sum the last-10 run-diff total (honest signal regardless of sign)
    var l10diff = 0;
    (data.run_diff_last_10 || []).forEach(function (r) {
      l10diff += Number(r.diff) || 0;
    });

    const cards = [
      // ----- Record card
      el('div', { class: 'kpi' }, [
        el('p', { class: 'kl' }, 'Record'),
        kpiBig(rec.w, rec.l, '–'),
        el('p', { class: 'kf' }, [
          el('b', null, F.winPct(rec.w, rec.l)),
          document.createTextNode(' · '),
          el('span', null, team.place || ''),
          team.gb && team.gb !== '-' ? document.createTextNode(' · ') : null,
          team.gb && team.gb !== '-' ? el('b', null, team.gb + ' GB') : null,
          el('br'),
          document.createTextNode('Pace ' + (pace == null ? '—' : pace + ' W')
                                   + ' · Pythag ' + (pythag162 == null ? '—' : pythag162 + ' W')),
        ]),
      ]),
      // ----- Run diff card
      runDiffKpi(team),
      // ----- Pythag card
      el('div', { class: 'kpi' }, [
        el('p', { class: 'kl' }, [el('span', { class: 'term', 'data-stat': 'pythag' }, 'Pythag'), document.createTextNode(' projection')]),
        kpiSimple(pythag162, 'W'),
        el('p', { class: 'kf' }, [
          document.createTextNode('Expected from run diff.'),
          el('br'),
          document.createTextNode('Pace says '),
          el('b', null, pace == null ? '—' : String(pace)),
          document.createTextNode(' · Pythag '),
          el('b', null, pythag162 == null ? '—' : String(pythag162)),
          document.createTextNode(' — the gap is the regression to watch.'),
        ]),
      ]),
      // ----- Last 10 card
      el('div', { class: 'kpi' }, [
        el('p', { class: 'kl' }, 'Last 10'),
        kpiBig(l10w, l10l, '–'),
        renderPips(last10),
        el('p', { class: 'kf', style: 'margin-top: 9px;' }, [
          el('b', { style: 'color:' + (l10diff < 0 ? 'var(--neg)' : 'var(--pos)') }, F.signed(l10diff)),
          document.createTextNode(' run diff over the last 10'),
        ]),
      ]),
    ];

    return el('div', { class: 'kpis' }, cards);
  }

  function kpiBig(left, right, sep) {
    const wrap = el('div', { class: 'kv' });
    if (left == null && right == null) {
      wrap.textContent = '—';
      return wrap;
    }
    wrap.appendChild(document.createTextNode(String(left == null ? '—' : left)));
    if (sep) wrap.appendChild(el('small', null, sep));
    wrap.appendChild(document.createTextNode(String(right == null ? '—' : right)));
    return wrap;
  }

  function kpiSimple(value, suffix) {
    const wrap = el('div', { class: 'kv' });
    wrap.appendChild(document.createTextNode(value == null ? '—' : String(value)));
    if (suffix) wrap.appendChild(el('small', null, suffix));
    return wrap;
  }

  function runDiffKpi(team) {
    const rs = Number(team.runs_scored) || 0;
    const ra = Number(team.runs_allowed) || 0;
    const diff = Number(team.run_diff);
    // Mini-track widths: RS proportional to max(RS, RA); RA same scale.
    const max = Math.max(rs, ra, 1);
    const rsPct = (rs / max) * 100;
    const raPct = (ra / max) * 100;

    return el('div', { class: 'kpi' }, [
      el('p', { class: 'kl' }, [document.createTextNode('Run '), el('span', { class: 'term', 'data-stat': 'run-differential' }, 'differential')]),
      kpiSimple(F.signed(diff), null),
      el('div', { class: 'diffmini' }, [
        el('div', { class: 'row' }, [
          el('span', null, 'RS'),
          el('span', { class: 'dtrack' }, el('i', { style: 'width:' + rsPct.toFixed(0) + '%; background:var(--pos)' })),
          el('span', null, String(rs)),
        ]),
        el('div', { class: 'row' }, [
          el('span', null, 'RA'),
          el('span', { class: 'dtrack' }, el('i', { style: 'width:' + raPct.toFixed(0) + '%; background:var(--neg)' })),
          el('span', null, String(ra)),
        ]),
      ]),
    ]);
  }

  function renderPips(last10) {
    const wrap = el('div', { class: 'pips' });
    last10.forEach(function (g) {
      const r = g.result || '';
      if (r !== 'W' && r !== 'L') return;
      wrap.appendChild(el('span', { class: 'pip ' + r.toLowerCase() }, r));
    });
    return wrap;
  }

  // ---- State of the Season (analyst) ----

  function renderStateOfSeason(state) {
    const notes = state.notes || {};
    const ov = notes.overview || {};
    // Per handoff §5 absent-key state: no headline + no paragraphs → omit.
    if (!ov.headline && !(ov.paragraphs && ov.paragraphs.length)) return null;

    const body = (ov.paragraphs && ov.paragraphs[0]) || '';
    const updated = (state.data && state.data.notes_meta && state.data.notes_meta.last_updated_iso) || null;
    const updatedLabel = updated
      ? 'The maintainer’s read · ' + F.shortMonthDay(updated)
      : 'The maintainer’s read';

    return panel('analyst', 'State of the season', '✎ Analyst note', [
      ov.headline ? el('p', { class: 'analyst-lead' }, ov.headline) : null,
      body ? el('p', { class: 'analyst-body', html: body }) : null,
      el('div', { class: 'byline' }, [
        el('span', { class: 'nib' }, '✎'),
        document.createTextNode(updatedLabel),
      ]),
    ]);
  }

  // ---- Run-differential chart (last 10) ----

  function renderRunDiffChart(state) {
    const data = state.data || {};
    const series = data.run_diff_last_10 || [];
    if (series.length === 0) return null;

    // Scale: symmetric around 0, gridlines at max round. Min height is ±4.
    const maxAbs = Math.max(4, Math.ceil(Math.max.apply(null,
      series.map(function (s) { return Math.abs(Number(s.diff) || 0); }))));

    // SVG geometry
    const W = 560, H = 190;
    const M_LEFT = 30, M_RIGHT = 15, M_TOP = 25, M_BOT = 45;
    const innerW = W - M_LEFT - M_RIGHT;
    const baseY = M_TOP + (H - M_TOP - M_BOT) / 2;  // center for zero baseline
    const halfH = (H - M_TOP - M_BOT) / 2 - 6;       // 6px label headroom
    const barW = Math.floor(innerW / series.length) - 5;
    const slotW = innerW / series.length;

    const yForDiff = function (d) { return baseY - (d / maxAbs) * halfH; };

    // Find worst game for direct annotation
    var worstIdx = 0, worstDiff = 0;
    series.forEach(function (s, i) {
      const d = Number(s.diff) || 0;
      if (d < worstDiff) { worstDiff = d; worstIdx = i; }
    });
    // Match to recent_games[] by date for context
    const recentByDate = {};
    (data.recent_games || []).forEach(function (g) { recentByDate[g.date] = g; });
    const worstGame = recentByDate[series[worstIdx].date];

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'rd-chart');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('font-family', 'var(--mono)');

    // Zero baseline
    addLine(svg, M_LEFT - 5, baseY, W - M_RIGHT, baseY,
      'var(--line-2)', 1.5, null);
    addText(svg, M_LEFT - 8, baseY + 4, '0', 10, 'var(--ink-3)', 'end');

    // Gridlines at ±maxAbs
    const topGrid = baseY - halfH * (maxAbs / maxAbs);
    const botGrid = baseY + halfH * (maxAbs / maxAbs);
    addLine(svg, M_LEFT, topGrid, W - M_RIGHT, topGrid,
      'var(--line)', 1, '2 4');
    addLine(svg, M_LEFT, botGrid, W - M_RIGHT, botGrid,
      'var(--line)', 1, '2 4');
    addText(svg, M_LEFT - 8, topGrid + 4, '+' + maxAbs, 10, 'var(--ink-4)', 'end');
    addText(svg, M_LEFT - 8, botGrid + 4, '−' + maxAbs, 10, 'var(--ink-4)', 'end');

    // Bars
    series.forEach(function (s, i) {
      const diff = Number(s.diff) || 0;
      const x = M_LEFT + i * slotW + (slotW - barW) / 2;
      const yTop = diff >= 0 ? yForDiff(diff) : baseY;
      const yBot = diff >= 0 ? baseY : yForDiff(diff);
      const h = Math.max(2, yBot - yTop);
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', yTop);
      rect.setAttribute('width', barW);
      rect.setAttribute('height', h);
      rect.setAttribute('rx', '2');
      rect.setAttribute('fill', diff >= 0 ? 'var(--pos)' : 'var(--neg)');
      svg.appendChild(rect);
    });

    // First / middle / last date labels
    if (series.length >= 1) {
      addText(svg,
        M_LEFT + 0 * slotW + slotW / 2,
        20,
        F.slashDate(series[0].date), 9, 'var(--ink-4)', 'middle');
      addText(svg,
        M_LEFT + Math.floor(series.length / 2) * slotW + slotW / 2,
        20,
        F.slashDate(series[Math.floor(series.length / 2)].date), 9, 'var(--ink-4)', 'middle');
      addText(svg,
        M_LEFT + (series.length - 1) * slotW + slotW / 2,
        20,
        F.slashDate(series[series.length - 1].date), 9, 'var(--ink-4)', 'middle');
    }

    // Direct annotation on worst game
    if (worstDiff < 0) {
      const wx = M_LEFT + worstIdx * slotW + slotW / 2;
      const wy = yForDiff(worstDiff);
      const labelY = H - M_BOT + 25;
      addLine(svg, wx, wy + 8, wx, labelY - 7, 'var(--ink-3)', 1, null);
      const annoText = worstGame
        ? worstGame.score + ' ' + (worstGame.home ? 'vs ' : '@ ') + abbreviate(worstGame.opp)
        : 'worst game';
      addText(svg, wx, labelY, annoText, 10.5,
        'var(--ink-2)', 'middle', 'var(--sans)');
    }

    const total = series.reduce(function (a, s) { return a + (Number(s.diff) || 0); }, 0);

    return panel('machine', 'Run differential — last 10', '◆ MLB data', [
      el('div', { class: 'rd-wrap' }, svg),
      el('div', { class: 'rd-anno' }, [
        el('span', { class: 'sw', style: 'background:var(--pos)' }),
        document.createTextNode(' Win '),
        el('span', { class: 'sw', style: 'background:var(--neg);margin-left:10px;' }),
        document.createTextNode(' Loss'),
        el('span', { class: 'spacer' },
          'Net ' + F.signed(total) + ' · scale not compressed — bad games shown at full height'),
      ]),
    ]);
  }

  function addLine(svg, x1, y1, x2, y2, stroke, sw, dasharray) {
    const ns = 'http://www.w3.org/2000/svg';
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('stroke', stroke);
    line.setAttribute('stroke-width', sw);
    if (dasharray) line.setAttribute('stroke-dasharray', dasharray);
    svg.appendChild(line);
  }

  function addText(svg, x, y, content, size, fill, anchor, fontFamily) {
    const ns = 'http://www.w3.org/2000/svg';
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', x); t.setAttribute('y', y);
    t.setAttribute('font-size', size);
    t.setAttribute('fill', fill);
    if (anchor) t.setAttribute('text-anchor', anchor);
    if (fontFamily) t.setAttribute('font-family', fontFamily);
    t.textContent = content;
    svg.appendChild(t);
  }

  // ---- Recent & Upcoming games ----

  function renderGames(state) {
    const data = state.data || {};
    const recent = (data.recent_games || []).slice(-3).reverse(); // newest first
    const upcoming = (data.upcoming_games || []).slice(0, 3);

    return panel('machine', 'Recent & upcoming', '◆ MLB data', [
      el('div', { class: 'gsplit' }, [
        el('div', { class: 'gcol' }, [
          el('p', { class: 'ghd' }, 'Last 3'),
          recent.length
            ? recent.map(renderRecentGame).reduce(function (acc, g) { acc.appendChild(g); return acc; }, el('div'))
            : el('div', { class: 'panel-empty' }, 'No recent games.'),
        ]),
        el('div', { class: 'gcol' }, [
          el('p', { class: 'ghd' }, 'Next 3'),
          upcoming.length
            ? upcoming.map(renderUpcomingGame).reduce(function (acc, g) { acc.appendChild(g); return acc; }, el('div'))
            : el('div', { class: 'panel-empty' }, 'No upcoming games.'),
        ]),
      ]),
    ]);
  }

  function renderRecentGame(g) {
    const opp = abbreviate(g.opp);
    const sub = F.shortMonthDay(g.date)
      + (g.winning_pitcher ? ' · ' + g.winning_pitcher.split(' ').slice(-1)[0] : '');
    const cls = g.result === 'W' ? 'w' : 'l';
    return el('div', { class: 'game' }, [
      el('span', { class: 'opp' }, (g.home ? '' : '@') + opp),
      el('span', { class: 'meta' }, [
        // Bug M4: dropped the redundant '@ ' prefix; the .opp tile
        // already carries the home/away indicator.
        document.createTextNode((g.home ? 'vs ' : 'at ') + opp),
        el('small', null, sub),
      ]),
      el('span', { class: 'res' }, [
        el('span', { class: 'wl ' + cls }, g.result),
        document.createTextNode(g.score || ''),
      ]),
    ]);
  }

  function renderUpcomingGame(g) {
    const opp = abbreviate(g.opp);
    const date = F.shortMonthDay(g.date);
    const sub = date
      + (g.probable_pitcher_us ? ' · ' + g.probable_pitcher_us.split(' ').slice(-1)[0] : '');
    return el('div', { class: 'game' }, [
      el('span', { class: 'opp' }, (g.home ? '' : '@') + opp),
      el('span', { class: 'meta' }, [
        document.createTextNode((g.home ? 'vs ' : 'at ') + opp),
        el('small', null, sub),
      ]),
      el('span', { class: 'wp' }, [
        el('span', { class: 'v' }, '—'),    // win prob deferred to v2.x
        el('small', null, 'win prob'),
      ]),
    ]);
  }

  // ---- AL East standings ----

  function renderStandings(state) {
    const div = (state.data && state.data.division) || [];
    if (div.length === 0) return null;

    // Find max wins for bar scale
    const maxW = Math.max.apply(null, div.map(function (t) { return Number(t.w) || 0; }));

    return panel('machine', 'AL East', null,
      div.map(function (t) {
        const w = Number(t.w) || 0;
        const pct = maxW ? (w / maxW) * 100 : 0;
        const right = t.is_us && t.gb && t.gb !== '-'
          ? el('span', { class: 'gb-tag' }, t.gb + ' GB')
          : el('span', { class: 'rec' }, w + '–' + (t.l || 0));
        return el('div', { class: 'st-row' + (t.is_us ? ' me' : '') }, [
          el('span', { class: 'abbr' }, abbreviate(t.team)),
          el('span', { class: 'st-bar' }, el('i', { style: 'width:' + pct.toFixed(1) + '%' })),
          right,
        ]);
      }),
      { hint: 'win %' }
    );
  }

  // ---- AL Wild Card race ----

  function renderWildCard(state) {
    const wc = (state.data && state.data.wild_card) || [];
    if (wc.length === 0) return null;

    const leaders = wc.filter(function (t) { return /Division leader/i.test(t.note || ''); });
    const inSeeds = wc.filter(function (t) { return /In \(/i.test(t.note || ''); });
    const out = wc.filter(function (t) { return /Out/i.test(t.note || ''); });

    const body = [
      el('div', { class: 'wc-leaders' },
        'Division leaders (host): '
        + leaders.map(function (t) { return abbreviate(t.team); }).join(' · ')),
      el('div', { class: 'wc-grp in' }, [
        el('span', { class: 'dot' }), document.createTextNode('In — wild card'),
      ]),
    ];
    inSeeds.forEach(function (t) {
      const seedMatch = (t.note || '').match(/(\d+)/);
      const seed = seedMatch ? 'WC' + seedMatch[1] : '';
      body.push(el('div', { class: 'wc-row' + (t.is_us ? ' me' : '') }, [
        el('span', { class: 'seed' }, seed),
        el('span', { class: 'abbr' }, abbreviate(t.team)),
        el('span', { class: 'rc' }, (t.w || 0) + '–' + (t.l || 0)),
        el('span', { class: 'gb' }, t.gb || '—'),
      ]));
    });
    body.push(el('div', { class: 'cutline' }, [
      el('span', { class: 'ln' }), document.createTextNode('Cut line'), el('span', { class: 'ln' }),
    ]));
    body.push(el('div', { class: 'wc-grp out' }, [
      el('span', { class: 'dot' }), document.createTextNode('Out'),
    ]));
    // Show only first 4 of out to keep panel compact
    out.slice(0, 4).forEach(function (t) {
      body.push(el('div', { class: 'wc-row' + (t.is_us ? ' me' : '') }, [
        el('span', { class: 'seed' }, ' '),
        el('span', { class: 'abbr' }, abbreviate(t.team)),
        el('span', { class: 'rc' }, (t.w || 0) + '–' + (t.l || 0)),
        el('span', { class: 'gb' }, t.gb || '—'),
      ]));
    });

    return panel('machine', 'AL Wild Card', null, body, { hint: '3 spots' });
  }

  // ---- Voices around (external) ----

  function renderVoices(state) {
    const news = (state.data && state.data.news) || [];
    // PR-D (audit H3): RSS is the external/untrusted boundary. A feed
    // item with `url: "javascript:alert(1)"` would render as a live
    // anchor. F.safeHref enforces a protocol allowlist; items whose
    // URL falls back to '#' get dropped here rather than mounted as
    // inert-but-clickable cards. See docs/security.md.
    const usable = news.filter(function (n) {
      return n && F.safeHref(n.url) !== '#';
    });
    if (usable.length === 0) {
      return panel('external', 'Voices around', '↗ RSS', [
        el('div', { class: 'panel-empty' }, 'No items today.'),
      ]);
    }
    const top = usable.slice(0, 4);
    return panel('external', 'Voices around', '↗ RSS', top.map(function (n) {
      return el('a', { class: 'voice', href: F.safeHref(n.url), target: '_blank', rel: 'noopener' }, [
        el('div', { class: 'voice-top' }, [
          el('span', { class: 'src-chip' }, n.source || '?'),
          el('span', { class: 'time' }, F.relativeAge(n.published)),
        ]),
        el('h4', null, n.title || ''),
        el('div', { class: 'by' }, [
          document.createTextNode(n.author || n.source || ''),
          el('span', { class: 'arr' }, ' ↗'),
        ]),
      ]);
    }));
  }

  // ---- Panel factory ----

  // type: 'machine' | 'analyst' | 'external'
  // title: string (panel header h3)
  // srctagText: string or null (chip after the title)
  // body: array of child nodes
  // opts: { hint: string }
  function panel(type, title, srctagText, body, opts) {
    opts = opts || {};
    const cls = 'panel' + (type === 'analyst' ? ' analyst' : type === 'external' ? ' external' : '');
    const head = el('div', { class: 'panel-h' }, [
      el('h3', null, title),
      srctagText
        ? el('span', { class: 'srctag ' + type }, srctagText)
        : opts.hint
          ? el('span', { class: 'hint' }, opts.hint)
          : null,
    ]);
    const b = el('div', { class: 'panel-b' });
    body.forEach(function (c) { if (c) b.appendChild(c); });
    return el('div', { class: cls }, [head, b]);
  }

  // ---- Main entry ----

  function render(state) {
    window.JaysDom.tabBody('overview', 'Overview', function (root) {
      root.appendChild(el('p', { class: 'ov-eyebrow' }, [
        document.createTextNode('The season right now'),
        el('span', { class: 'rule' }),
      ]));
      root.appendChild(renderKpis(state));

      const leftCol = el('div', { class: 'ov-col' });
      const rightCol = el('div', { class: 'ov-col' });
      [renderStateOfSeason(state), renderRunDiffChart(state), renderGames(state)].forEach(function (n) {
        if (n) leftCol.appendChild(n);
      });
      [renderStandings(state), renderWildCard(state), renderVoices(state)].forEach(function (n) {
        if (n) rightCol.appendChild(n);
      });
      root.appendChild(el('div', { class: 'ov-main' }, [leftCol, rightCol]));
    });
  }

  window.JaysOverview = { render: render };
})();
