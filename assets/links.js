/* ============================================================
   Jays Tracker — external player profile links (v2)
   G2. One place to build Baseball Savant + MLB.com profile URLs for any
   player we hold an MLB person id for. Every anchor is
   target="_blank" rel="noopener" and gated through JaysFormat.safeHref
   (the shared protocol allowlist), so a malformed id can never smuggle a
   javascript: URL into an href. See docs/security.md for the trust model.
   ============================================================ */
(function () {
  'use strict';
  const F = window.JaysFormat;

  // Savant's canonical profile URL is /savant-player/<name-slug>-<id>. The
  // slug is cosmetic — Savant resolves on the trailing id — but including
  // it matches Savant's own canonical form and keeps the link readable.
  function savantUrl(id, name) {
    if (id == null) return null;
    const slug = F.slugify(name || '');
    const tail = slug ? slug + '-' + id : String(id);
    return F.safeHref('https://baseballsavant.mlb.com/savant-player/' + tail);
  }

  // MLB.com's player page resolves on the id and redirects to its own slug.
  function mlbUrl(id) {
    if (id == null) return null;
    return F.safeHref('https://www.mlb.com/player/' + id);
  }

  // One external-link anchor. Clicks stopPropagation so a pill inside the
  // modal scrim (or any clickable row) navigates without also triggering
  // the scrim-close / row-open handlers it sits within.
  function pill(href, label, aria) {
    const a = document.createElement('a');
    a.className = 'ext-pill';
    a.href = href || '#';
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = label;
    a.setAttribute('aria-label', aria);
    a.addEventListener('click', function (e) { e.stopPropagation(); });
    return a;
  }

  // The two-pill external-link row for a player. Returns null when there's
  // no id to link, so callers can `if (row) mount(row)` without pre-checks.
  // `name` is optional context only — used for the Savant slug + a11y label.
  function iconRow(id, name) {
    if (id == null) return null;
    const nm = name || '';
    const row = document.createElement('span');
    row.className = 'ext-row';
    row.appendChild(pill(savantUrl(id, nm), 'SAV', 'Open ' + nm + ' on Baseball Savant'));
    row.appendChild(pill(mlbUrl(id), 'MLB', 'Open ' + nm + ' on MLB.com'));
    return row;
  }

  window.JaysLinks = {
    savantUrl: savantUrl,
    mlbUrl: mlbUrl,
    iconRow: iconRow,
  };
})();
