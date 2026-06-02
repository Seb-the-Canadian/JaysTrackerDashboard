/* ============================================================
   Jays Tracker — formatting helpers (v2)
   Vanilla JS. Used by every tab's renderer.

   Single source for: number formatting, tabular figures, slash lines,
   ± signed values, MLB date display, win-percentage, ordinal suffixes.
   Per handoff §9 "Centralize formatting" — one util module.
   ============================================================ */

(function () {
  'use strict';

  // ---- Number formatting ----

  // Baseball convention: stats < 1.0 drop the leading zero (".312" not "0.312").
  // Optional precision; defaults to 3 (AVG/OBP/SLG/OPS shape).
  function baseballDecimal(value, precision) {
    if (value == null || isNaN(value)) return '—';
    var p = (precision == null) ? 3 : precision;
    var s = Number(value).toFixed(p);
    if (s.startsWith('0.')) return s.slice(1);
    if (s.startsWith('-0.')) return '-' + s.slice(2);
    return s;
  }

  function signed(value) {
    if (value == null || isNaN(value)) return '—';
    var n = Number(value);
    if (n === 0) return '0';
    return (n > 0 ? '+' : '') + n;
  }

  // .585 from { w: 31, l: 22 } ; respects baseball drop-leading-zero.
  function winPct(w, l) {
    if (w == null || l == null) return '—';
    var t = Number(w) + Number(l);
    if (t === 0) return '—';
    return baseballDecimal(Number(w) / t, 3);
  }

  // Ordinal suffix: 1 → '1st', 22 → '22nd', etc.
  function ordinal(n) {
    if (n == null || isNaN(n)) return '—';
    var v = Number(n);
    var rem100 = v % 100;
    if (rem100 >= 11 && rem100 <= 13) return v + 'th';
    var suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th';
    return v + suffix;
  }

  // Tier class for a rank in [1, 30]. Maps to --pos / --pos-2 / --q-mid /
  // --q-warm / --neg via the rank strip CSS. Used in marker color, rank
  // number color, KPI accents.
  function rankTier(rank) {
    if (rank == null || isNaN(rank)) return '';
    var r = Number(rank);
    if (r <= 5)  return 'm1';
    if (r <= 10) return 'm2';
    if (r <= 20) return 'm3';
    if (r <= 25) return 'm4';
    return 'm5';
  }

  // Marker left-percentage on a 1→30 rank strip with avg tick at 50%.
  // Rank 1 → 0%; rank 30 → 100%. Linear.
  function rankLeftPercent(rank) {
    if (rank == null || isNaN(rank)) return 50;
    var r = Math.max(1, Math.min(30, Number(rank)));
    return ((r - 1) / 29) * 100;
  }

  // ---- Date helpers ----

  function parseIso(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  // "May 24" — short month + day, no year.
  function shortMonthDay(iso) {
    var d = parseIso(iso);
    if (!d) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // "5/24" — numeric month/day.
  function slashDate(iso) {
    var d = parseIso(iso);
    if (!d) return '—';
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  // Relative phrasing for RSS timestamps: "6h ago", "3d ago", "2w ago".
  function relativeAge(iso) {
    var d = parseIso(iso);
    if (!d) return '';
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.round(diff / 60) + 'm ago';
    if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.round(diff / 86400) + 'd ago';
    return Math.round(diff / 604800) + 'w ago';
  }

  // Time of day, no timezone label: "7:07 PM".
  function timeOfDay(iso) {
    var d = parseIso(iso);
    if (!d) return '';
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  // ---- Avatar helper ----

  // First initial of first given name + first initial of primary surname.
  // Strips "Jr.", "Sr.", "II", "III", "IV" suffixes. Returns up to 2 chars.
  // Examples: "Vladimir Guerrero Jr." → "VG"; "Bo Bichette" → "BB";
  //           "George Springer III" → "GS".
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

  // Slug suitable for hash routing: lowercase, hyphenated, ASCII-fold.
  // Used by the player modal deep-link (#player-<slug-or-id>).
  function slugify(s) {
    if (!s) return '';
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
    timeOfDay: timeOfDay,
    initials: initials,
    slugify: slugify,
  };
})();
