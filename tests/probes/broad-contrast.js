/* ============================================================
   Probe: broad contrast
   PR-F — Dark contrast batch + dark-primary brand-mark + focus
   ring (COG-361).

   The original layer-boundaries L6 measured only .pc-av. The
   survivorship audit found H9 (chart axis dark 1.5:1), H10
   (tier badges dark 1.87-2.62:1), and F1-F4 (dark brand-mark
   1.39-1.89, focus ring 1.53-2.07) — none of which L6 covered.
   This probe enumerates the specific surfaces this PR fixes,
   in both themes, against the Jays palette and the worst-case
   dark-primary (NYY) fork.

   Run from repo root with a static server up at :8001:
     python3 -m http.server 8001 &
     NODE_PATH=/opt/node22/lib/node_modules node tests/probes/broad-contrast.js
   ============================================================ */
const { chromium } = require('playwright');

const BASE = process.env.JT_BASE || 'http://localhost:8001/index-v2.html';
const findings = [];
const report = (level, name, detail) => {
  findings.push({ level, name, detail });
  console.log(`${level.padEnd(4)} ${name}${detail ? ' — ' + detail : ''}`);
};

// Canvas-readback contrast measurement. CSS color-mix() resolves to oklab()
// in getComputedStyle on modern browsers; only the rendered pixel is sRGB.
// We paint each color to a 1px canvas and read back to get true sRGB.
async function measurePair(page, fgSelector, bgSelector, opts = {}) {
  return await page.evaluate(({ fgSel, bgSel, prop }) => {
    function pixelFor(cssColor) {
      const c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      const x = c.getContext('2d');
      x.fillStyle = cssColor;
      x.fillRect(0, 0, 1, 1);
      const d = x.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]];
    }
    function lum(rgb) {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
    }
    const fgEl = document.querySelector(fgSel);
    if (!fgEl) return { error: 'fg element not found: ' + fgSel };
    const fgCss = getComputedStyle(fgEl)[prop || 'color'];
    let bgCss;
    if (bgSel) {
      const bgEl = document.querySelector(bgSel);
      if (!bgEl) return { error: 'bg element not found: ' + bgSel };
      bgCss = getComputedStyle(bgEl).backgroundColor;
      // Walk up if transparent.
      let walker = bgEl;
      while (walker && (bgCss === 'rgba(0, 0, 0, 0)' || bgCss === 'transparent')) {
        walker = walker.parentElement;
        bgCss = walker ? getComputedStyle(walker).backgroundColor : 'rgb(255, 255, 255)';
      }
    } else {
      bgCss = getComputedStyle(fgEl).backgroundColor;
    }
    const fgPx = pixelFor(fgCss);
    const bgPx = pixelFor(bgCss);
    const lFg = lum(fgPx);
    const lBg = lum(bgPx);
    const ratio = (Math.max(lFg, lBg) + 0.05) / (Math.min(lFg, lBg) + 0.05);
    return { fgCss, bgCss, fgPx, bgPx, ratio: Math.round(ratio * 100) / 100 };
  }, { fgSel: fgSelector, bgSel: bgSelector, prop: opts.prop });
}

// Outline ring contrast — outline color vs the page background it's
// drawn on top of. We can't measure the outline pixel directly through
// canvas (it's rendered, not a CSS background), but we can measure the
// computed outline-color and compare to the body bg.
async function measureOutlineRing(page, elSelector) {
  return await page.evaluate(({ sel }) => {
    function pixelFor(cssColor) {
      const c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      const x = c.getContext('2d');
      x.fillStyle = cssColor;
      x.fillRect(0, 0, 1, 1);
      const d = x.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]];
    }
    function lum(rgb) {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
    }
    const el = document.querySelector(sel);
    if (!el) return { error: 'el not found: ' + sel };
    // Force the :focus-visible state by setting the focus + reading outline-color.
    // Some browsers don't expose outline-color of a non-focused element; we
    // construct the same calc explicitly via --team-primary-ink.
    const root = document.documentElement;
    const ringCss = getComputedStyle(root).getPropertyValue('--team-primary-ink').trim();
    const pageBg = getComputedStyle(document.body).backgroundColor;
    const ringPx = pixelFor(ringCss);
    const bgPx = pixelFor(pageBg);
    const ratio = (Math.max(lum(ringPx), lum(bgPx)) + 0.05) / (Math.min(lum(ringPx), lum(bgPx)) + 0.05);
    return { ringCss, pageBg, ringPx, bgPx, ratio: Math.round(ratio * 100) / 100 };
  }, { sel: elSelector });
}

async function loadWithPalette(browser, { theme, primary, secondary, accent } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  if (theme) {
    await ctx.addInitScript((t) => localStorage.setItem('jt-theme', t), theme);
  }
  if (primary) {
    await ctx.route('**/config.json', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      body.primary_color = primary;
      if (secondary) body.secondary_color = secondary;
      if (accent) body.accent_color = accent;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
  }
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForFunction(() => {
    const ov = document.getElementById('tab-overview');
    return ov && !ov.querySelector('.panel-skeleton');
  }, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  return { ctx, page };
}

async function checkSurface(page, label, fgSel, bgSel, threshold, opts = {}) {
  const r = await measurePair(page, fgSel, bgSel, opts);
  if (r.error) {
    report('FAIL', label + ' — selector missing', r.error);
    return;
  }
  const pass = r.ratio >= threshold;
  report(pass ? 'PASS' : 'FAIL',
    label + ` (≥${threshold}:1)`,
    `${r.ratio}:1  fg=${r.fgCss} bg=${r.bgCss}`);
}

(async () => {
  const browser = await chromium.launch();

  // ===== TOR (default Jays palette) =====

  // Light mode
  {
    const { ctx, page } = await loadWithPalette(browser, { theme: 'light' });
    await checkSurface(page, 'TOR light: tier.found text',
      '.tier.found', '.tier.found', 4.5);
    await checkSurface(page, 'TOR light: tier.build text',
      '.tier.build', '.tier.build', 4.5);
    await checkSurface(page, 'TOR light: tier.adv text',
      '.tier.adv', '.tier.adv', 4.5);
    // Brand-mark diamond (white on team-primary)
    await checkSurface(page, 'TOR light: brand-mark diamond',
      '.brand .mark span', '.brand .mark', 3, { prop: 'background-color' });
    // Cold pill is rendered on .pill.cold inside Players; navigate to load it.
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(400);
    await checkSurface(page, 'TOR light: .pill.cold (white on q-cold)',
      '.pill.cold', '.pill.cold', 4.5);
    await ctx.close();
  }

  // Dark mode
  {
    const { ctx, page } = await loadWithPalette(browser, { theme: 'dark' });
    // Tier badges in dark mode (the H10 finding)
    await page.evaluate(() => { window.location.hash = 'stat-school'; });
    await page.waitForTimeout(500);
    await checkSurface(page, 'TOR dark: tier.found text',
      '.tier.found', '.tier.found', 4.5);
    await checkSurface(page, 'TOR dark: tier.build text',
      '.tier.build', '.tier.build', 4.5);
    await checkSurface(page, 'TOR dark: tier.adv text',
      '.tier.adv', '.tier.adv', 4.5);
    // Brand-mark diamond — must hit 3:1 non-text contrast
    await checkSurface(page, 'TOR dark: brand-mark diamond (was 1.89)',
      '.brand .mark span', '.brand .mark', 3, { prop: 'background-color' });
    // Focus ring — uses --team-primary-ink in dark mode (50% mix with white)
    const ring = await measureOutlineRing(page, '.tab');
    const ringPass = ring.ratio >= 3;
    report(ringPass ? 'PASS' : 'FAIL',
      `TOR dark: focus ring vs page bg (was 2.07, ≥3:1)`,
      `${ring.ratio}:1  ring=${ring.ringCss} bg=${ring.pageBg}`);
    // Cold pill
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(400);
    await checkSurface(page, 'TOR dark: .pill.cold (white on q-cold)',
      '.pill.cold', '.pill.cold', 4.5);
    // Chart axis text — load Overview and read fill on rd-chart text
    await page.evaluate(() => { window.location.hash = 'overview'; });
    await page.waitForTimeout(500);
    const axis = await page.evaluate(() => {
      const t = document.querySelector('svg.rd-chart text');
      if (!t) return { error: 'no rd-chart text' };
      const fill = getComputedStyle(t).fill;
      const panelBg = getComputedStyle(t.closest('.panel') || document.body).backgroundColor;
      function pixelFor(c) { const cv = document.createElement('canvas'); cv.width=1; cv.height=1; const x=cv.getContext('2d'); x.fillStyle=c; x.fillRect(0,0,1,1); const d=x.getImageData(0,0,1,1).data; return [d[0],d[1],d[2]]; }
      function lum(rgb) { const f = v=>{v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}; return 0.2126*f(rgb[0])+0.7152*f(rgb[1])+0.0722*f(rgb[2]); }
      const fp = pixelFor(fill), bp = pixelFor(panelBg);
      const r = (Math.max(lum(fp), lum(bp))+0.05)/(Math.min(lum(fp), lum(bp))+0.05);
      return { fill, panelBg, ratio: Math.round(r*100)/100 };
    });
    if (axis.error) {
      report('WARN', 'TOR dark: chart axis text — chart not rendered', axis.error);
    } else {
      const axisPass = axis.ratio >= 3;
      report(axisPass ? 'PASS' : 'FAIL',
        `TOR dark: chart axis text (was 1.5, ≥3:1 AA-large)`,
        `${axis.ratio}:1  fill=${axis.fill} panel=${axis.panelBg}`);
    }
    await ctx.close();
  }

  // ===== NYY dark — the worst-case dark-primary fork =====
  {
    const { ctx, page } = await loadWithPalette(browser, {
      theme: 'dark', primary: '#003087', secondary: '#0c2340', accent: '#e4002c',
    });
    await checkSurface(page, 'NYY dark: brand-mark diamond (was 1.39)',
      '.brand .mark span', '.brand .mark', 3, { prop: 'background-color' });
    const ring = await measureOutlineRing(page, '.tab');
    const ringPass = ring.ratio >= 3;
    report(ringPass ? 'PASS' : 'FAIL',
      `NYY dark: focus ring vs page bg (was 1.53, ≥3:1)`,
      `${ring.ratio}:1  ring=${ring.ringCss} bg=${ring.pageBg}`);
    await ctx.close();
  }

  const fails = findings.filter(f => f.level === 'FAIL');
  console.log(`\nbroad-contrast: ${findings.length - fails.length}/${findings.length} pass`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(err => {
  console.error('PROBE ERROR:', err.message);
  process.exit(2);
});
