/* ============================================================
   Jays Tracker — runtime theme helpers (v2)
   Wires config.json team colors → CSS custom properties on :root,
   manages dark mode toggle + prefers-color-scheme default + the
   localStorage('jt-theme') user override.
   Vanilla JS. No deps. ~150 lines.
   ============================================================ */

(function () {
  'use strict';

  // ---- Color math: RGB hex parsing, linear mix, WCAG contrast ----

  function parseHex(hex) {
    if (typeof hex !== 'string') return null;
    const h = hex.replace('#', '').trim();
    if (h.length !== 6) return null;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return { r: r, g: g, b: b };
  }

  function toHex(rgb) {
    const c = function (v) {
      v = Math.max(0, Math.min(255, Math.round(v)));
      return v.toString(16).padStart(2, '0');
    };
    return '#' + c(rgb.r) + c(rgb.g) + c(rgb.b);
  }

  // RGB linear interpolation. ratio in [0, 1]: 0 returns c1, 1 returns c2.
  // For our purposes "mix toward white at .90" produces a softened tint.
  function mixHex(c1, c2, ratio) {
    const a = parseHex(c1);
    const b = parseHex(c2);
    if (!a || !b) return c1;
    return toHex({
      r: a.r + (b.r - a.r) * ratio,
      g: a.g + (b.g - a.g) * ratio,
      b: a.b + (b.b - a.b) * ratio,
    });
  }

  // WCAG 2.x relative luminance.
  function relativeLuminance(hex) {
    const rgb = parseHex(hex);
    if (!rgb) return 0;
    const linear = function (v) {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b);
  }

  function contrastRatio(fg, bg) {
    const l1 = relativeLuminance(fg);
    const l2 = relativeLuminance(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  // Returns fg if it passes WCAG AA (4.5:1) against bg, else fallback.
  // Used to keep --team-primary-ink legible on --card across all forks.
  function ensureContrastAA(fg, bg, fallback) {
    return contrastRatio(fg, bg) >= 4.5 ? fg : fallback;
  }

  // ---- Team-color wiring from config.json ----

  // The Blue Jays reference values; used as ultimate fallback if config
  // doesn't supply primary/secondary/accent.
  const REF_PRIMARY = '#134A8E';
  const REF_SECONDARY = '#1D2D5C';
  const REF_ACCENT = '#E8291C';

  // applyTeamTheme overrides --team-* tokens on :root from cfg.
  // cfg is the parsed config.json object. Backward-compatible with v1
  // configs that only have primary_color + accent_color.
  function applyTeamTheme(cfg) {
    const root = document.documentElement;
    const primary = (cfg && cfg.primary_color) || REF_PRIMARY;
    // secondary_color is new in v2; derive from primary if absent.
    const secondary = (cfg && cfg.secondary_color)
      || mixHex(primary, '#000000', 0.40);
    const accent = (cfg && cfg.accent_color) || REF_ACCENT;

    // Identity tokens
    root.style.setProperty('--team-primary', primary);
    root.style.setProperty('--team-secondary', secondary);
    root.style.setProperty('--team-accent', accent);

    // Derived soft tints. In light mode mix toward white (10% color, 90%
    // white) for the near-white pastel the design specifies. In dark mode
    // mix toward the dark card surface at 0.75 ratio — produces a subtle
    // tinted-dark distinguishable from --card but not so dark it traps
    // light text. Bug B1: previously mixed toward white regardless of
    // theme; .pc-av text was 1.04:1.
    const isDark = root.getAttribute('data-theme') === 'dark';
    const cardBg = isDark ? '#1b1f27' : '#fffdf8';
    if (isDark) {
      root.style.setProperty('--team-primary-soft', mixHex(primary, cardBg, 0.75));
      root.style.setProperty('--team-secondary-soft', mixHex(secondary, cardBg, 0.75));
    } else {
      root.style.setProperty('--team-primary-soft', mixHex(primary, '#ffffff', 0.90));
      root.style.setProperty('--team-secondary-soft', mixHex(secondary, '#ffffff', 0.90));
    }

    // Team color used as text on --card must pass WCAG AA. For dark primaries
    // (NYY #003087, NYM blue) the raw value passes on cream. For low-contrast
    // edge cases, fall back to --ink.
    const inkFallback = isDark ? '#eceef2' : '#1c2230';
    root.style.setProperty(
      '--team-primary-ink',
      ensureContrastAA(primary, cardBg, inkFallback)
    );
  }

  // ---- Dark mode: prefers-color-scheme default + localStorage override ----

  const THEME_KEY = 'jt-theme';
  // (we re-read this lazily; assets/theme.js doesn't import anything else)

  function getStoredTheme() {
    try {
      return localStorage.getItem(THEME_KEY); // 'light' | 'dark' | null
    } catch (_) {
      return null; // private mode / disabled storage
    }
  }

  function setStoredTheme(mode) {
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch (_) { /* swallow */ }
  }

  function prefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function currentMode() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  // Apply the mode to <html> + re-run team-theme contrast eval against the
  // new card surface. cfg passed-through so the contrast pass works on toggle.
  function applyTheme(mode, cfg) {
    if (mode === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    if (cfg) applyTeamTheme(cfg);
  }

  function initTheme(cfg) {
    const stored = getStoredTheme();
    const mode = stored || (prefersDark() ? 'dark' : 'light');
    applyTheme(mode, cfg);
  }

  function toggleTheme(cfg) {
    const next = currentMode() === 'dark' ? 'light' : 'dark';
    setStoredTheme(next);
    applyTheme(next, cfg);
    return next;
  }

  // Public surface — single object on window so the renderer can call in.
  window.JaysTheme = {
    applyTeamTheme: applyTeamTheme,
    initTheme: initTheme,
    toggleTheme: toggleTheme,
    currentMode: currentMode,
    // exported for tests / debugging
    _mixHex: mixHex,
    _contrastRatio: contrastRatio,
    _ensureContrastAA: ensureContrastAA,
  };
})();
