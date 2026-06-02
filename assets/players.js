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
    return [
      { name: 'Catchers',           rows: C },
      { name: 'Infield',            rows: IF },
      { name: 'Outfield',           rows: OF },
      { name: 'Designated hitter',  rows: DH },
    ].filter(function (g) { return g.rows.length > 0; });
  }

  function groupPitchers(pitchers) {
    const SP = [], BP = [];
    pitchers.forEach(function (p) {
      if ((Number(p.gs) || 0) >= 3) SP.push(p);
      else BP.push(p);
    });
    return [
      { name: 'Starting rotation',  rows: SP },
      { name: 'Bullpen',            rows: BP },
    ].filter(function (g) { return g.rows.length > 0; });
  }

  // ---- Card render ----

  function pcard(player, group, state, isHitter) {
    const ranks = (state.data && state.data.player_ranks) || {};
    const myRanks = ranks[player.id] || {};

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

    // Rank tier indicator (e.g. "7th" colored by tier)
    const rankBadge = rank
      ? '<i class="' + rankClassForTier(F.rankTier(rank)) + '">'
        + F.ordinal(rank) + '</i>'
      : (player.recent === 'new'
          ? '<i class="muted">—</i>'
          : '<i class="muted">—</i>');

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

    card.addEventListener('click', function () { openModal(player, isHitter, state, card); });
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

  // ---- Modal ----

  // Module-level: the card that opened the modal (for focus return).
  let lastTrigger = null;
  let escHandler = null;

  function openModal(player, isHitter, state, triggerEl) {
    lastTrigger = triggerEl || null;
    const scrim = ensureScrim();
    scrim.innerHTML = '';
    scrim.appendChild(buildModalContent(player, isHitter, state));
    scrim.classList.add('show');
    document.body.style.overflow = 'hidden';
    // Deep-link: write hash without triggering route change.
    if (player.id) {
      const newHash = '#player-' + player.id;
      if (window.location.hash !== newHash) {
        history.pushState({ playerModal: true }, '', newHash);
      }
    }
    // Escape close
    escHandler = function (e) {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', escHandler);
    // Focus the close button so keyboard nav has a starting point.
    const x = scrim.querySelector('.modal-x');
    if (x) x.focus();
  }

  function closeModal() {
    const scrim = document.getElementById('player-modal-scrim');
    if (!scrim) return;
    scrim.classList.remove('show');
    document.body.style.overflow = '';
    if (escHandler) {
      document.removeEventListener('keydown', escHandler);
      escHandler = null;
    }
    // Restore hash to current tab
    if (window.location.hash.indexOf('#player-') === 0) {
      history.pushState({}, '', '#players');
    }
    // Return focus
    if (lastTrigger) {
      try { lastTrigger.focus(); } catch (_) {}
      lastTrigger = null;
    }
  }

  function ensureScrim() {
    let scrim = document.getElementById('player-modal-scrim');
    if (!scrim) {
      scrim = document.createElement('div');
      scrim.id = 'player-modal-scrim';
      scrim.className = 'modal-scrim';
      scrim.setAttribute('role', 'dialog');
      scrim.setAttribute('aria-modal', 'true');
      scrim.addEventListener('click', function (e) {
        if (e.target === scrim) closeModal();
      });
      document.body.appendChild(scrim);
    }
    return scrim;
  }

  function buildModalContent(player, isHitter, state) {
    const ranks = (state.data && state.data.player_ranks) || {};
    const myRanks = ranks[player.id] || {};
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
    const h3 = document.createElement('h3');
    h3.textContent = player.name || '—';
    h3.style.flexWrap = 'wrap';
    // Optional hot/cold pill inline with the name
    if (player.recent === 'hot' || player.recent === 'cold' || player.recent === 'new') {
      const pill = document.createElement('span');
      pill.className = 'pill ' + player.recent;
      pill.textContent = player.recent.charAt(0).toUpperCase() + player.recent.slice(1);
      h3.appendChild(pill);
    }
    id.appendChild(h3);

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
    top.appendChild(id);

    const x = document.createElement('button');
    x.className = 'modal-x';
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.textContent = '✕';
    x.addEventListener('click', closeModal);
    top.appendChild(x);

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
        const small = document.createElement('small');
        const opsRank = myRanks.ops;
        small.textContent = entry[2] && opsRank
          ? entry[1] + ' · ' + F.ordinal(opsRank)
          : entry[1];
        cell.appendChild(small);
        slash.appendChild(cell);
      });
      wrapper.appendChild(slash);
    } else {
      // Pitcher: ERA / WHIP / K / W-L compact line
      const line = document.createElement('div');
      line.className = 'slash-big';
      [
        ['era', 'ERA', true],
        ['whip', 'WHIP'],
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
        small.textContent = entry[1];
        cell.appendChild(small);
        line.appendChild(cell);
      });
      wrapper.appendChild(line);
    }

    // ----- "Where he ranks" rows -----
    const body = document.createElement('div');
    body.className = 'modal-b';

    const rankRows = isHitter ? buildHitterRankRows(player, myRanks) : buildPitcherRankRows(player, myRanks);
    if (rankRows.length > 0) {
      const label = document.createElement('p');
      label.className = 'mb-label';
      label.textContent = 'Where ' + (isHitter ? 'he' : 'they') + ' rank';
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

  function buildHitterRankRows(player, myRanks) {
    const defs = [
      ['OPS', player.ops, myRanks.ops, false],
      ['xwOBA', player.xwoba, myRanks.xwoba, true],
      ['Hard-hit%', player.hardhit_pct, myRanks.hardhit_pct, true],
      ['Barrel%', player.barrel_pct, myRanks.barrel_pct, true],
      ['Home runs', player.hr, myRanks.hr, false],
      ['Walk%', null, myRanks.bb_pct, false],   // PA-relative; deferred
      ['Strikeout%', null, myRanks.k_pct, false],
    ];
    return defs
      .filter(function (d) { return d[1] != null && d[1] !== '—' && d[1] !== '.---' && d[1] !== '---'; })
      .map(function (d) { return ctxRow(d[0], d[1], d[2], d[3]); });
  }

  function buildPitcherRankRows(player, myRanks) {
    const defs = [
      ['ERA', player.era, myRanks.era, false],
      ['WHIP', player.whip, myRanks.whip, false],
      ['K/9', null, myRanks.k_per_9, false],
      ['BB/9', null, myRanks.bb_per_9, false],
      ['IP', player.ip, myRanks.ip, false],
    ];
    return defs
      .filter(function (d) { return d[1] != null && d[1] !== '—'; })
      .map(function (d) { return ctxRow(d[0], d[1], d[2], d[3]); });
  }

  function ctxRow(name, val, rank, isStatcast) {
    const row = document.createElement('div');
    row.className = 'ctx-row';
    const tier = rank ? F.rankTier(rank) : '';
    const left = rank ? F.rankLeftPercent(rank).toFixed(0) : 50;

    row.innerHTML = ''
      + '<div class="ctx-name">'
      +   '<span class="term">' + name + '</span>'
      +   (isStatcast ? ' <span class="sc">Statcast</span>' : '')
      + '</div>'
      + '<div class="ctx-val">' + (val == null ? '—' : val) + '</div>'
      + '<div class="strip">'
      +   '<span class="avg"></span>'
      +   (rank ? '<span class="mk ' + tier + '" style="left:' + left + '%"></span>' : '')
      + '</div>'
      + '<div class="ctx-rank ' + tier + '">'
      +   (rank ? F.ordinal(rank).replace(/(st|nd|rd|th)$/, '<small>$1</small>') : '<span style="color:var(--ink-4)">—</span>')
      + '</div>';
    return row;
  }

  // ---- Deep-link routing for #player-<id-or-slug> ----

  function tryOpenFromHash(state) {
    const h = (window.location.hash || '').replace(/^#/, '');
    const m = h.match(/^player-(.+)$/);
    if (!m) return false;
    const key = m[1];
    const player = findPlayer(key, state);
    if (player) {
      openModal(player, player.__isHitter, state, null);
      return true;
    }
    return false;
  }

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
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---- Main entry ----

  function render(state) {
    const root = document.getElementById('tab-players');
    if (!root) return;
    root.innerHTML = '';
    const data = state.data || {};
    const roster = data.roster || {};

    // Eyebrow + page-head + pill legend
    root.appendChild(eyebrowHead());

    // Pitchers first (Rotation/Bullpen), then hitters by position group.
    const groups = groupPitchers(roster.pitchers || []).concat(groupHitters(roster.hitters || []));
    groups.forEach(function (g) {
      const isHitter = !(g.rows[0] && g.rows[0].era);
      root.appendChild(renderRoleGroup(g.name, g.rows, isHitter, state));
    });

    // Try to open a modal from the URL hash (deep-link).
    tryOpenFromHash(state);

    // Listen for hash changes: open the modal when the hash matches a
    // player anchor, OR close the open modal if the hash navigates away
    // from #player- (covers the browser-back case — bug B4).
    window.addEventListener('hashchange', function () {
      const h = window.location.hash || '';
      if (h.indexOf('#player-') === 0) {
        tryOpenFromHash(state);
      } else {
        const scrim = document.getElementById('player-modal-scrim');
        if (scrim && scrim.classList.contains('show')) closeModal();
      }
    }, { once: false });
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

  window.JaysPlayers = { render: render, openModal: openModal, closeModal: closeModal };
})();
