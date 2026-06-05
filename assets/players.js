/* ============================================================
   Jays Tracker — Players tab renderer (v2)
   Reads state.data.roster + state.notes.players + state.data.player_ranks.
   Renders position-grouped roster (Catchers/Infield/Outfield/DH plus
   Rotation/Bullpen for pitchers); each card opens a modal with the
   full line + rank context + optional analyst note.

   Modal supports:
   - Click pcard → open
   - Esc / X / backdrop → close
   - Deep-link via #player-<id> or #player-<name-slug>
   - Focus returns to triggering card on close
   ============================================================ */

(function () {
  'use strict';

  const F = window.JaysFormat;

  // ---- Role grouping (handoff §P3) ----

  function groupHitters(hitters) {
    const C = [], IF = [], OF = [], DH = [];
    hitters.forEach(function (h) {
      const pos = (h.pos || '').toUpperCase();
      if (pos === 'C') C.push(h);
      else if (pos === 'DH') DH.push(h);
      else if (pos === 'LF' || pos === 'CF' || pos === 'RF' || pos === 'OF') OF.push(h);
      // 1B/2B/3B/SS/IF/UT and any other non-OF non-C non-DH → infield bucket
      else IF.push(h);
    });
    // PR-C: explicit `kind` per group (audit H15). Was: caller used
    // `!(g.rows[0] && g.rows[0].era)` — a single stray `era` field on
    // a hitter row flipped the whole group's render path to pitcher.
    return [
      { name: 'Catchers',           rows: C,  kind: 'hitter' },
      { name: 'Infield',            rows: IF, kind: 'hitter' },
      { name: 'Outfield',           rows: OF, kind: 'hitter' },
      { name: 'Designated hitter',  rows: DH, kind: 'hitter' },
    ].filter(function (g) { return g.rows.length > 0; });
  }

  function groupPitchers(pitchers) {
    const SP = [], BP = [];
    pitchers.forEach(function (p) {
      if ((Number(p.gs) || 0) >= 3) SP.push(p);
      else BP.push(p);
    });
    return [
      { name: 'Starting rotation',  rows: SP, kind: 'pitcher' },
      { name: 'Bullpen',            rows: BP, kind: 'pitcher' },
    ].filter(function (g) { return g.rows.length > 0; });
  }

  // ---- Card render ----

  function pcard(player, group, state, isHitter) {
    const ranks = (state.data && state.data.player_ranks) || {};
    const myRanks = ranks[player.id] || {};
    const pools = (state.data && state.data.player_rank_pool) || {};
    const pool = pools[isHitter ? 'hitting' : 'pitching'];

    // Headline stat & rank
    let primaryVal, primaryLabel, rank;
    if (isHitter) {
      primaryVal = player.ops || '—';
      primaryLabel = 'OPS';
      rank = myRanks.ops;
    } else {
      primaryVal = player.era || '—';
      primaryLabel = 'ERA';
      rank = myRanks.era;
    }

    // Pill
    let pill = null;
    if (player.recent === 'hot') pill = { cls: 'hot', txt: 'Hot' };
    else if (player.recent === 'cold') pill = { cls: 'cold', txt: 'Cold' };
    else if (player.recent === 'new') pill = { cls: 'new', txt: 'New' };

    // Avatar + subtitle
    const avatar = F.initials(player.name);
    const subParts = [];
    if (isHitter) {
      subParts.push(player.pos || '?');
      if (player.bats) subParts.push(player.bats);
      if (player.age) subParts.push(String(player.age));
    } else {
      // Closer flag (sv >= 5 heuristic) else SP/RP
      const role = (Number(player.sv) || 0) >= 5 ? 'CL'
        : (Number(player.gs) || 0) >= 3 ? 'SP' : 'RP';
      subParts.push(role);
      if (player.throws) subParts.push(player.throws);
      if (player.age) subParts.push(String(player.age));
    }
    const subtitle = subParts.join(' · ');

    // Rank badge — percentile within the qualified pool (e.g. "55th %ile"),
    // colored by percentile tier. Player ranks are pool-relative (1..~150),
    // so we render a percentile, not a raw 1-30 ordinal.
    const pct = F.rankPercentile(rank, pool);
    const rankBadge = (pct != null)
      ? '<i class="' + rankClassForTier(F.percentileTier(pct)) + '">'
        + F.ordinalNum(pct) + '<small> %ile</small></i>'
      : '<i class="muted">—</i>';

    const card = document.createElement('button');
    card.className = 'pcard' + (player.recent === 'cold' ? ' struggle' : '');
    card.type = 'button';
    card.dataset.playerId = player.id;
    card.setAttribute('aria-label', 'Open player details for ' + (player.name || '?'));
    card.innerHTML = ''
      + '<span class="pc-av">' + escapeHtml(avatar) + '</span>'
      + '<span class="pc-id">'
      +   '<b>' + escapeHtml(player.name || '—') + '</b>'
      +   '<small>' + escapeHtml(subtitle) + '</small>'
      + '</span>'
      + '<span class="pc-right">'
      +   (pill ? '<span class="pill ' + pill.cls + '">' + pill.txt + '</span>' : '')
      +   '<span class="pc-stat">'
      +     '<b>' + escapeHtml(primaryVal) + '</b> ' + primaryLabel + ' ' + rankBadge
      +   '</span>'
      + '</span>';

    card.addEventListener('click', function () {
      player.__isHitter = isHitter;
      window.JaysModal.openFromClick(player, card);
    });
    return card;
  }

  function rankClassForTier(tier) {
    // Tier classes (m1-m5) map to .good / .mid / .warn / etc colors via CSS.
    switch (tier) {
      case 'm1': return 'good';
      case 'm2': return 'good';
      case 'm3': return 'mid';
      case 'm4': return 'warn';
      case 'm5': return 'warn';
      default: return 'muted';
    }
  }

  // ---- Modal content builder ----
  //
  // The lifecycle (open / close / scrim / esc / focus / hashchange)
  // moved to assets/modal.js in the antifragile pass (Class 4). This
  // module retains buildModalContent because it's a pure factory over
  // state — it constructs the DOM tree that modal.js mounts. Same with
  // findPlayer below — the lookup belongs to the Players domain.

  function buildModalContent(player, isHitter, state) {
    const ranks = (state.data && state.data.player_ranks) || {};
    const myRanks = ranks[player.id] || {};
    const pools = (state.data && state.data.player_rank_pool) || {};
    const pool = pools[isHitter ? 'hitting' : 'pitching'];
    const notes = (state.notes && state.notes.players) || {};
    const note = notes[String(player.id)] || null;

    const wrapper = document.createElement('div');
    wrapper.className = 'modal';

    // ----- Top (avatar + identity + meta + close) -----
    const top = document.createElement('div');
    top.className = 'modal-top';

    const avatar = document.createElement('span');
    avatar.className = 'modal-av';
    avatar.textContent = F.initials(player.name);
    top.appendChild(avatar);

    const id = document.createElement('div');
    id.className = 'modal-id';
    // PR-E (audit H11 / Players M1): h3 carries an id so the modal scrim
    // can reference it via aria-labelledby. The recent-form pill used
    // to be a child of h3 — that polluted textContent with "Hot" /
    // "Cold" / "New" and prevented the eventual labelledby from
    // reading cleanly. Now it sits as a sibling.
    const h3 = document.createElement('h3');
    h3.id = 'player-modal-title';
    h3.textContent = player.name || '—';
    id.appendChild(h3);
    if (player.recent === 'hot' || player.recent === 'cold' || player.recent === 'new') {
      const pill = document.createElement('span');
      pill.className = 'pill ' + player.recent;
      pill.textContent = player.recent.charAt(0).toUpperCase() + player.recent.slice(1);
      id.appendChild(pill);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    const metaParts = [];
    if (isHitter) {
      if (player.pos) metaParts.push(player.pos);
      if (player.bats) metaParts.push('Bats ' + player.bats);
      if (player.age) metaParts.push('Age ' + player.age);
      if (player.ab) metaParts.push(player.ab + ' AB');
    } else {
      if (player.throws) metaParts.push('Throws ' + player.throws);
      if (player.age) metaParts.push('Age ' + player.age);
      if (player.ip) metaParts.push(player.ip + ' IP');
      if (player.gs) metaParts.push(player.gs + ' GS');
    }
    meta.textContent = metaParts.join(' · ');
    id.appendChild(meta);
    // External profile links (Savant + MLB.com). Sits under the meta line as
    // part of the player's identity block. Roster players always have an id.
    const extRow = window.JaysLinks.iconRow(player.id, player.name);
    if (extRow) id.appendChild(extRow);
    top.appendChild(id);

    // Action cluster — theme toggle + close. The theme toggle inside
    // the modal closes audit A1 (decision D3): when the modal scrim
    // is shown, the page-level #theme-toggle is unreachable (scrim
    // intercepts pointer events). Mirroring the toggle into the modal
    // header lets a user flip themes without first dismissing the
    // dialog.
    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const themeBtn = document.createElement('button');
    themeBtn.className = 'modal-theme';
    themeBtn.type = 'button';
    themeBtn.setAttribute('aria-label', 'Toggle dark mode');
    function updateThemeGlyph() {
      themeBtn.textContent = window.JaysTheme.currentMode() === 'dark' ? '☀' : '☾';
    }
    updateThemeGlyph();
    themeBtn.addEventListener('click', function (e) {
      e.stopPropagation();  // don't bubble to scrim click → close
      window.JaysTheme.toggleTheme();
      updateThemeGlyph();
    });
    actions.appendChild(themeBtn);

    const x = document.createElement('button');
    x.className = 'modal-x';
    x.type = 'button';
    x.setAttribute('aria-label', 'Close player details');
    x.textContent = '✕';
    x.addEventListener('click', function () { window.JaysModal.requestClose(); });
    actions.appendChild(x);

    top.appendChild(actions);

    wrapper.appendChild(top);

    // ----- Slash line (hitter) or summary line (pitcher) -----
    if (isHitter) {
      const slash = document.createElement('div');
      slash.className = 'slash-big';
      [
        ['avg', 'AVG'],
        ['obp', 'OBP'],
        ['slg', 'SLG'],
        ['ops', 'OPS', true],
      ].forEach(function (entry, i) {
        if (i > 0) {
          const sep = document.createElement('div');
          sep.className = 'slash-sep';
          slash.appendChild(sep);
        }
        const cell = document.createElement('div');
        cell.className = 'slash-cell' + (entry[2] ? ' lead' : '');
        const b = document.createElement('b');
        b.textContent = player[entry[0]] || '—';
        cell.appendChild(b);
        // Wrap label in .term[data-stat] so the tooltip module picks it up.
        // The OPS lead cell carries a percentile suffix; render it as a
        // sibling text node so the tooltip trigger stays a tight token.
        // Gate the affordance on JaysStatRegistry.has() — without it, a
        // slug not yet in stat_school.json would still surface a dotted
        // underline + cursor:help that opens nothing (issue #125).
        const small = document.createElement('small');
        const hasTip = window.JaysStatRegistry && window.JaysStatRegistry.has(entry[0]);
        if (hasTip) {
          const labelSpan = document.createElement('span');
          labelSpan.className = 'term';
          labelSpan.setAttribute('data-stat', entry[0]);
          labelSpan.textContent = entry[1];
          small.appendChild(labelSpan);
        } else {
          small.appendChild(document.createTextNode(entry[1]));
        }
        const opsPct = F.rankPercentile(myRanks.ops, pool);
        if (entry[2] && opsPct != null) {
          small.appendChild(document.createTextNode(
            ' · ' + F.ordinalNum(opsPct) + ' %ile'));
        }
        cell.appendChild(small);
        slash.appendChild(cell);
      });
      wrapper.appendChild(slash);
      // Statcast values sit just under the slash line — value-only, since
      // they can't be league-ranked (team-scoped Savant pull). See
      // buildStatcastLine.
      const scLine = buildStatcastLine(player);
      if (scLine) wrapper.appendChild(scLine);
    } else {
      // Pitcher: ERA / WHIP / K / W-L compact line
      const line = document.createElement('div');
      line.className = 'slash-big';
      // Tuple: [accessor, label, isLead, slug?]. accessor is the player[]
      // key (or null for the W–L derived cell); slug only present when
      // stat_school.json documents the stat (k and w-l have no entry yet,
      // so they stay plain — silent no-op vs. dotted underline that opens
      // nothing).
      [
        ['era', 'ERA', true, 'era'],
        ['whip', 'WHIP', false, 'whip'],
        ['k', 'K'],
        [null, 'W–L'],
      ].forEach(function (entry, i) {
        if (i > 0) {
          const sep = document.createElement('div');
          sep.className = 'slash-sep';
          line.appendChild(sep);
        }
        const cell = document.createElement('div');
        cell.className = 'slash-cell' + (entry[2] ? ' lead' : '');
        const b = document.createElement('b');
        b.textContent = entry[0] == null
          ? ((player.w || 0) + '–' + (player.l || 0))
          : (player[entry[0]] || '—');
        cell.appendChild(b);
        const small = document.createElement('small');
        // Same registry gate as the hitter slash line — emit .term only
        // when stat_school.json documents the slug (issue #125). The
        // existing entry[3] guard already kept K and W-L plain; the
        // registry check tightens the contract to "documented or plain".
        const hasTip = entry[3] && window.JaysStatRegistry && window.JaysStatRegistry.has(entry[3]);
        if (hasTip) {
          const labelSpan = document.createElement('span');
          labelSpan.className = 'term';
          labelSpan.setAttribute('data-stat', entry[3]);
          labelSpan.textContent = entry[1];
          small.appendChild(labelSpan);
        } else {
          small.textContent = entry[1];
        }
        cell.appendChild(small);
        line.appendChild(cell);
      });
      wrapper.appendChild(line);
    }

    // ----- "Where he ranks" rows -----
    const body = document.createElement('div');
    body.className = 'modal-b';

    const rankRows = isHitter ? buildHitterRankRows(player, myRanks, pool) : buildPitcherRankRows(player, myRanks, pool);
    if (rankRows.length > 0) {
      const label = document.createElement('p');
      label.className = 'mb-label';
      // Subject-verb agreement: "he ranks" (singular), "they rank" (plural).
      label.textContent = 'Where ' + (isHitter ? 'he ranks' : 'they rank');
      body.appendChild(label);
      rankRows.forEach(function (row) { body.appendChild(row); });
    }

    // ----- Analyst note (optional) -----
    if (note && (note.read || note.recentNote)) {
      const noteEl = document.createElement('div');
      noteEl.className = 'modal-note';
      noteEl.innerHTML = ''
        + '<span class="nib">✎</span>'
        + '<p>' + (note.read || note.recentNote || '')
        +   '<span class="by">✎ The maintainer · per-player note from notes.json</span>'
        + '</p>';
      body.appendChild(noteEl);
    }

    wrapper.appendChild(body);
    return wrapper;
  }

  // The rank-strip rows only carry stats we can honestly rank league-wide:
  // traditional season stats from the statsapi qualified pool. Statcast
  // metrics (xwOBA / Barrel% / Hard-hit%) are team-scoped in the fetcher —
  // there's no MLB-wide Savant pull — so a rank strip for them would be a
  // fabricated position. They render value-only via buildStatcastLine below.
  function buildHitterRankRows(player, myRanks, pool) {
    // Tuple: [label, value, rank, isStatcast, slug]. The slug threads to
    // the .term[data-stat] tooltip — same key used by stat_school.json.
    const defs = [
      ['OPS', player.ops, myRanks.ops, false, 'ops'],
      ['Home runs', player.hr, myRanks.hr, false, 'hr'],
      ['RBI', player.rbi, myRanks.rbi, false, 'rbi'],
      ['Stolen bases', player.sb, myRanks.sb, false, 'sb'],
    ];
    return defs
      .filter(function (d) { return d[1] != null && d[1] !== '—' && d[1] !== '.---' && d[1] !== '---'; })
      .map(function (d) { return ctxRow(d[0], d[1], d[2], d[3], pool, d[4]); });
  }

  // Statcast value strip for hitters. Renders xwOBA / Barrel% / Hard-hit%
  // as plain values with a Statcast provenance chip — no rank rail, because
  // these are team-scoped in the fetcher and have no honest league position.
  // Returns null when every metric is a placeholder (sub-threshold hitter),
  // so the modal omits the line entirely rather than showing three dashes.
  const STATCAST_PLACEHOLDERS = { '': 1, '—': 1, '.---': 1, '---': 1, 'null': 1 };
  function buildStatcastLine(player) {
    // Tuple: [label, value, slug]. The slug threads to the tooltip when
    // stat_school.json documents the stat; the affordance gate further
    // down (JaysStatRegistry.has) keeps the dotted underline off unbacked
    // slugs (issue #125). Always pass the slug so the affordance appears
    // automatically once a maintainer authors the entry.
    const metrics = [
      ['xwOBA', player.xwoba, 'xwoba'],
      ['Barrel%', player.barrel_pct, 'barrel_pct'],
      ['Hard-hit%', player.hardhit_pct, 'hardhit_pct'],
    ].filter(function (m) {
      return m[1] != null && !STATCAST_PLACEHOLDERS[String(m[1]).trim()];
    });
    if (metrics.length === 0) return null;

    const line = document.createElement('div');
    line.className = 'modal-statcast';
    let html = '<span class="ms-label">Statcast</span>';
    metrics.forEach(function (m) {
      // Affordance gate (issue #125): wrap with .term[data-stat] only when
      // both a slug exists AND the registry has an entry. The old code
      // gated on slug presence alone, which left hardhit_pct as a deliberate
      // null but still allowed any future slug-without-entry to leak the
      // dead affordance.
      const hasTip = m[2] && window.JaysStatRegistry && window.JaysStatRegistry.has(m[2]);
      const labelHtml = hasTip
        ? '<span class="term" data-stat="' + escapeHtml(m[2]) + '">'
          + escapeHtml(m[0]) + '</span>'
        : escapeHtml(m[0]);
      html += '<span class="ms-metric"><b>' + escapeHtml(m[1]) + '</b> '
        + labelHtml + '</span>';
    });
    line.innerHTML = html;
    return line;
  }

  function buildPitcherRankRows(player, myRanks, pool) {
    // Tuple: [label, value, rank, isStatcast, slug]. K/9 + BB/9 map to the
    // stat_school.json keys k9/bb9 (stat-registry handles the alias) so the
    // tooltip still resolves; IP isn't in stat_school.json yet, so its
    // tooltip silently no-ops — that's the documented degrade path.
    const defs = [
      ['ERA', player.era, myRanks.era, false, 'era'],
      ['WHIP', player.whip, myRanks.whip, false, 'whip'],
      ['K/9', player.k_per_9, myRanks.k_per_9, false, 'k9'],
      ['BB/9', player.bb_per_9, myRanks.bb_per_9, false, 'bb9'],
      ['IP', player.ip, myRanks.ip, false, 'ip'],
    ];
    return defs
      .filter(function (d) { return d[1] != null && d[1] !== '—' && d[1] !== '-.--'; })
      .map(function (d) { return ctxRow(d[0], d[1], d[2], d[3], pool, d[4]); });
  }

  function ctxRow(name, val, rank, isStatcast, pool, slug) {
    const row = document.createElement('div');
    row.className = 'ctx-row';
    // Percentile within the qualified pool — pool-relative rank converted so
    // the marker position, color, and label all agree (the bug where a
    // rank-72-of-158 hitter showed "—" with a marker pinned at the far end).
    const pct = F.rankPercentile(rank, pool);
    const tier = pct != null ? F.percentileTier(pct) : '';
    const left = pct != null ? F.percentileLeftPercent(rank, pool).toFixed(0) : 50;
    const label = pct != null
      ? F.ordinalNum(pct).replace(/(st|nd|rd|th)$/, '<small>$1</small>')
        + '<small class="pctl"> %ile</small>'
      : '<span style="color:var(--ink-4)">—</span>';

    // Gate the dotted-underline affordance (.term + data-stat) on whether
    // stat_school.json actually documents this slug — without the gate, slugs
    // like hr/rbi/sb/k9/bb9/ip render the dotted underline + cursor:help
    // but the tooltip silently no-ops (issue #125). Renderers must run after
    // the registry loads; render.js awaits JaysStatRegistry.load() before
    // dispatching tab renders, so by emit time has() is truthful.
    const hasTip = slug && window.JaysStatRegistry && window.JaysStatRegistry.has(slug);
    const labelHtml = hasTip
      ? '<span class="term" data-stat="' + escapeHtml(slug) + '">' + name + '</span>'
      : name;
    row.innerHTML = ''
      + '<div class="ctx-name">'
      +   labelHtml
      +   (isStatcast ? ' <span class="sc">Statcast</span>' : '')
      + '</div>'
      + '<div class="ctx-val">' + (val == null ? '—' : val) + '</div>'
      + '<div class="strip">'
      +   '<span class="avg"></span>'
      +   (pct != null ? '<span class="mk ' + tier + '" style="left:' + left + '%"></span>' : '')
      + '</div>'
      + '<div class="ctx-rank ' + tier + '">' + label + '</div>';
    return row;
  }

  // ---- Player lookup (used by modal.js to resolve #player-<key>) ----

  function findPlayer(key, state) {
    const data = state.data || {};
    const roster = data.roster || {};
    const all = (roster.hitters || []).map(function (h) { h.__isHitter = true; return h; })
      .concat((roster.pitchers || []).map(function (p) { p.__isHitter = false; return p; }));
    // Try ID match first
    const byId = all.filter(function (p) { return String(p.id) === String(key); })[0];
    if (byId) return byId;
    // Slug match (lowercase, hyphenated form of name)
    return all.filter(function (p) {
      return F.slugify(p.name) === key;
    })[0];
  }

  // ---- Escape user-provided strings before innerHTML insertion ----
  // Shared helper now lives in JaysFormat (PR-D / COG-360). Aliased
  // here so existing call sites read the same as before.
  const escapeHtml = window.JaysFormat.escapeHtml;

  // ---- Main entry ----

  function render(state) {
    const data = state.data || {};
    const roster = data.roster || {};

    window.JaysDom.tabBody('players', 'Players', function (root) {
      root.appendChild(eyebrowHead());
      // PR-C: pass `kind` through groupHitters / groupPitchers so the
      // template choice is data-driven, not derived from whether the
      // first row carries an `era` field. Old heuristic flipped to
      // pitcher template if any hitter row had a stray era key (audit
      // H15). New: each group carries its own kind label.
      const groups = groupPitchers(roster.pitchers || [])
        .concat(groupHitters(roster.hitters || []));
      groups.forEach(function (g) {
        root.appendChild(renderRoleGroup(g.name, g.rows, g.kind === 'hitter', state));
      });
    }, { headingProvided: true });

    // Delegate modal lifecycle (open / close / hashchange / focus) to
    // JaysModal. It reads window.location.hash and mounts the correct
    // modal content via the registered builder; we just hand it the
    // state. Bug B4 (back button doesn't close modal) is now removed at
    // the layer-boundary — hash is the source of truth.
    window.JaysModal.render(state);
  }

  function eyebrowHead() {
    const wrap = document.createElement('div');
    wrap.innerHTML = ''
      + '<p class="ov-eyebrow">26-man roster <span class="rule"></span></p>'
      + '<div class="pl-head">'
      +   '<div>'
      +     '<h2>Players</h2>'
      +     '<p>Grouped the way a card lists positions. Tap anyone for their full line in context.</p>'
      +   '</div>'
      +   '<div class="pill-legend">'
      +     '<span class="ple"><span class="pill hot">Hot</span> <small>top form, last 15</small></span>'
      +     '<span class="ple"><span class="pill cold">Cold</span> <small>bottom form</small></span>'
      +     '<span class="ple"><span class="pill new">New</span> <small>added &lt;7 days</small></span>'
      +   '</div>'
      + '</div>';
    return wrap;
  }

  function renderRoleGroup(name, rows, isHitter, state) {
    const grp = document.createElement('div');
    grp.className = 'role-group';
    grp.innerHTML = ''
      + '<div class="role-h">'
      +   '<h3>' + name + '</h3>'
      +   '<span class="cnt">' + rows.length + '</span>'
      +   '<span class="rule"></span>'
      + '</div>';
    const cards = document.createElement('div');
    cards.className = 'pcards';
    rows.forEach(function (p) { cards.appendChild(pcard(p, name, state, isHitter)); });
    grp.appendChild(cards);
    return grp;
  }

  window.JaysPlayers = {
    render: render,
    // Surfaces used by JaysModal to resolve #player-<key> and mount content.
    findPlayer: findPlayer,
    buildModalContent: buildModalContent,
  };
})();
