/* ============================================================
   Jays Tracker — formatting helpers (v2)
   Vanilla JS. Used by every tab's renderer.

   Single source for: number formatting, tabular figures, slash lines,
   ± signed values, MLB date display, win-percentage, ordinal suffixes.
   Per handoff §9 "Centralize formatting" — one util module.

   Antifragile pass (Commit 5 — Class 5):
   Every formatter declares its @domain in JSDoc. Inputs outside the
   declared domain return '—' (the project's universal "no data"
   representation) so renderers don't need to pre-check or post-clean.
   See tests/format-spec.test.js for the executable spec.
   ============================================================ */

(function () {
  'use strict';

  // The universal "no data" representation. Lives here so the test suite
  // and any consumer can reference the same canonical string.
  var DASH = '—';

  // Internal: strict "is a usable finite number" predicate. Treats
  // booleans / strings / null / NaN / Infinity as out-of-domain. The
  // formatters delegate to this so the in/out-of-domain contract is
  // identical across the module.
  function isFiniteNumber(v) {
    if (v == null) return false;
    if (typeof v === 'boolean') return false;
    // Empty / whitespace-only strings coerce to 0 in Number() — that's
    // not a real numeric input, treat as out-of-domain.
    if (typeof v === 'string' && v.trim() === '') return false;
    var n = Number(v);
    return Number.isFinite(n);
  }

  // ---- Number formatting ----

  /**
   * Baseball decimal: stats < 1.0 drop the leading zero (".312" not "0.312").
   * @domain value: any finite number; precision: 0..10 integer (default 3).
   * @returns formatted string, or DASH if value is out-of-domain.
   */
  function baseballDecimal(value, precision) {
    if (!isFiniteNumber(value)) return DASH;
    var p = (precision == null) ? 3 : precision;
    var s = Number(value).toFixed(p);
    if (s.startsWith('0.')) return s.slice(1);
    if (s.startsWith('-0.')) return '-' + s.slice(2);
    return s;
  }

  /**
   * Signed value display: "+5", "-3", "0".
   * @domain any finite number.
   * @returns formatted string, or DASH if out-of-domain.
   */
  function signed(value) {
    if (!isFiniteNumber(value)) return DASH;
    var n = Number(value);
    if (n === 0) return '0';
    return (n > 0 ? '+' : '') + n;
  }

  /**
   * Win percentage from wins/losses (e.g. {w:31, l:22} → ".585").
   * @domain w, l: each a finite non-negative number; total > 0.
   * @returns baseballDecimal-formatted string, or DASH if out-of-domain
   *   (incl. both zero — "no games played" is undefined %).
   */
  function winPct(w, l) {
    if (!isFiniteNumber(w) || !isFiniteNumber(l)) return DASH;
    var nw = Number(w), nl = Number(l);
    if (nw < 0 || nl < 0) return DASH;
    var t = nw + nl;
    if (t === 0) return DASH;
    return baseballDecimal(nw / t, 3);
  }

  /**
   * Ordinal suffix for MLB ranks: 1 → "1st", 22 → "22nd".
   * @domain n: integer in [1, 30] (MLB rank space).
   * @returns "<n><suffix>", or DASH if out-of-domain. Rank 0, negative,
   *   non-integer, non-numeric → DASH; the renderer should display the
   *   "no rank" state instead.
   */
  function ordinal(n) {
    if (!isFiniteNumber(n)) return DASH;
    var v = Number(n);
    if (v < 1 || v > 30) return DASH;
    if (Math.floor(v) !== v) return DASH;
    var rem100 = v % 100;
    if (rem100 >= 11 && rem100 <= 13) return v + 'th';
    var suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th';
    return v + suffix;
  }

  /**
   * Tier class for a rank in [1, 30]. Used by the rank strip CSS.
   * @domain rank: any input. Bands: 1-5 m1, 6-10 m2, 11-20 m3,
   *   21-25 m4, 26-30 m5.
   * @returns "m1".."m5", or "" for out-of-domain. Empty string is the
   *   neutral case for CSS (no tier color applied).
   */
  function rankTier(rank) {
    if (!isFiniteNumber(rank)) return '';
    var r = Number(rank);
    if (r < 1 || r > 30) return '';
    if (r <= 5)  return 'm1';
    if (r <= 10) return 'm2';
    if (r <= 20) return 'm3';
    if (r <= 25) return 'm4';
    return 'm5';
  }

  /**
   * Marker left-percentage on a 1→30 rank strip with avg tick at 50%.
   * @domain rank: any input. Clamps to [1, 30] when given a number —
   *   this function is positional (returns 0..100); the caller wants a
   *   number to place an element, not a DASH.
   * @returns linear percent in [0, 100]; 50 for out-of-domain (the
   *   neutral "league average" position).
   */
  function rankLeftPercent(rank) {
    if (!isFiniteNumber(rank)) return 50;
    var r = Math.max(1, Math.min(30, Number(rank)));
    return ((r - 1) / 29) * 100;
  }

  // ---- Date helpers ----

  function parseIso(iso) {
    if (!iso || typeof iso !== 'string') return null;
    var d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * "May 24" — short month + day, no year.
   * @domain iso: ISO 8601 date or datetime string parseable by Date.
   * @returns localized "Mon Day", or DASH if iso is out-of-domain.
   */
  function shortMonthDay(iso) {
    var d = parseIso(iso);
    if (!d) return DASH;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /**
   * "5/24" — numeric month/day.
   * @domain iso: ISO 8601 date string parseable by Date.
   * @returns "M/D", or DASH if iso is out-of-domain.
   */
  function slashDate(iso) {
    var d = parseIso(iso);
    if (!d) return DASH;
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  /**
   * Relative phrasing for RSS timestamps: "6h ago", "3d ago", "2w ago".
   * @domain iso: ISO 8601 date/datetime string parseable by Date.
   *   Future timestamps (clock skew / bad source data) are soft-handled
   *   and return 'soon' so the consumer can distinguish from 'just now'.
   * @returns relative-phrase string, '' if iso is out-of-domain.
   */
  function relativeAge(iso) {
    var d = parseIso(iso);
    if (!d) return '';
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 0) return 'soon';
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.round(diff / 60) + 'm ago';
    if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.round(diff / 86400) + 'd ago';
    return Math.round(diff / 604800) + 'w ago';
  }

  // ---- Avatar helper ----

  /**
   * First initial of first given name + first initial of primary surname.
   * Strips "Jr.", "Sr.", "II", "III", "IV" suffixes. Returns up to 2 chars.
   * @domain name: non-empty string with at least one word character.
   * @returns 1-2 uppercase initials, or '' if out-of-domain. Examples:
   *   "Vladimir Guerrero Jr." → "VG"; "Bo Bichette" → "BB";
   *   "George Springer III" → "GS"; single name → 1 initial.
   */
  function initials(name) {
    if (!name || typeof name !== 'string') return '';
    var SUFFIXES = /(?:^|\s)(jr\.?|sr\.?|ii|iii|iv)(?:\s|$)/gi;
    var cleaned = name.replace(SUFFIXES, ' ').trim();
    var parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    var first = parts[0].charAt(0);
    var last = parts[parts.length - 1].charAt(0);
    return (first + last).toUpperCase();
  }

  /**
   * Slug suitable for hash routing: lowercase, hyphenated, ASCII-fold.
   * @domain s: string.
   * @returns slugified form, or '' if s is out-of-domain. Used by the
   *   player modal deep-link (#player-<slug-or-id>).
   */
  function slugify(s) {
    if (!s || typeof s !== 'string') return '';
    return s
      .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip accents
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  window.JaysFormat = {
    baseballDecimal: baseballDecimal,
    signed: signed,
    winPct: winPct,
    ordinal: ordinal,
    rankTier: rankTier,
    rankLeftPercent: rankLeftPercent,
    shortMonthDay: shortMonthDay,
    slashDate: slashDate,
    relativeAge: relativeAge,
    initials: initials,
    slugify: slugify,
    // Exported for the test suite / runbook so the canonical DASH lives
    // in exactly one place.
    DASH: DASH,
  };
})();
