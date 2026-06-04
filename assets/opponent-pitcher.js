/* ============================================================
   Jays Tracker — opposing-pitcher modal (v2)
   G3. A "lite" player modal for a pitcher who is NOT on our roster:
   resolved from state.data.opponent_pitchers (keyed by person id), a pool
   separate from the roster. No rank rails (opponents aren't in our
   qualified-rank pool, so a strip would be a fabricated position) and no
   analyst notes (not our player) — just identity, a season line, and the
   Savant + MLB.com links. Mounted by modal.js via the #oppp-<id> route.
   ============================================================ */
(function () {
  'use strict';
  const F = window.JaysFormat;

  // Resolve a non-roster pitcher by id string. Mirrors players.findPlayer's
  // contract (return the object or null) so the modal builder can bail
  // cleanly on a stale/bad hash.
  function find(target, state) {
    const pool = (state.data && state.data.opponent_pitchers) || {};
    return pool[String(target)] || null;
  }

  function buildModalContent(p, state) {
    const wrapper = document.createElement('div');
    wrapper.className = 'modal';

    // ----- Top: avatar + identity + actions -----
    const top = document.createElement('div');
    top.className = 'modal-top';

    const avatar = document.createElement('span');
    avatar.className = 'modal-av';
    avatar.textContent = F.initials(p.name);
    top.appendChild(avatar);

    const id = document.createElement('div');
    id.className = 'modal-id';
    // h3 carries the id the scrim wires aria-labelledby to (see modal.js).
    const h3 = document.createElement('h3');
    h3.id = 'player-modal-title';
    h3.textContent = p.name || '—';
    id.appendChild(h3);
    const tag = document.createElement('span');
    tag.className = 'pill oppp-tag';
    tag.textContent = 'Opposing SP';
    id.appendChild(tag);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const parts = [];
    if (p.throws) parts.push('Throws ' + p.throws);
    if (p.age) parts.push('Age ' + p.age);
    if (p.gs) parts.push(p.gs + ' GS');
    meta.textContent = parts.join(' · ');
    id.appendChild(meta);

    const extRow = window.JaysLinks.iconRow(p.id, p.name);
    if (extRow) id.appendChild(extRow);
    top.appendChild(id);

    // Actions: theme toggle + close, mirroring the roster modal so the
    // page theme stays reachable while the scrim intercepts pointer events.
    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const themeBtn = document.createElement('button');
    themeBtn.className = 'modal-theme';
    themeBtn.type = 'button';
    themeBtn.setAttribute('aria-label', 'Toggle dark mode');
    function glyph() {
      themeBtn.textContent = window.JaysTheme.currentMode() === 'dark' ? '☀' : '☾';
    }
    glyph();
    themeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      window.JaysTheme.toggleTheme();
      glyph();
    });
    actions.appendChild(themeBtn);

    const x = document.createElement('button');
    x.className = 'modal-x';
    x.type = 'button';
    x.setAttribute('aria-label', 'Close pitcher details');
    x.textContent = '✕';
    x.addEventListener('click', function () { window.JaysModal.requestClose(); });
    actions.appendChild(x);

    top.appendChild(actions);
    wrapper.appendChild(top);

    // ----- Season line (ERA / WHIP / IP / K) -----
    const line = document.createElement('div');
    line.className = 'slash-big';
    [
      ['era', 'ERA', true],
      ['whip', 'WHIP'],
      ['ip', 'IP'],
      ['k', 'K'],
    ].forEach(function (entry, i) {
      if (i > 0) {
        const sep = document.createElement('div');
        sep.className = 'slash-sep';
        line.appendChild(sep);
      }
      const cell = document.createElement('div');
      cell.className = 'slash-cell' + (entry[2] ? ' lead' : '');
      const b = document.createElement('b');
      const v = p[entry[0]];
      b.textContent = (v == null || v === '' || v === '-.--') ? '—' : v;
      cell.appendChild(b);
      const small = document.createElement('small');
      small.textContent = entry[1];
      cell.appendChild(small);
      line.appendChild(cell);
    });
    wrapper.appendChild(line);

    // ----- Body: frame it as season-to-date, no rank (honest scope) -----
    const body = document.createElement('div');
    body.className = 'modal-b';
    const note = document.createElement('p');
    note.className = 'oppp-note';
    note.textContent = 'Season line to date. Opponents aren’t ranked against '
      + 'our qualified pool — open Savant for full splits.';
    body.appendChild(note);
    wrapper.appendChild(body);

    return wrapper;
  }

  window.JaysOpponentPitcher = {
    find: find,
    buildModalContent: buildModalContent,
  };
})();
