/* ============================================================
   Probe: layer boundaries
   Antifragile pass — Commit 1. Asserts the design system layers
   don't fight each other. Prevents bug classes B1, B3, B5, B6
   from recurring as different instances.

   Run from repo root with a static server up at :8000:
     python3 -m http.server 8000 &
     NODE_PATH=/opt/node22/lib/node_modules node tests/probes/layer-boundaries.js
   ============================================================ */
const { chromium } = require('playwright');

const BASE = process.env.JT_BASE || 'http://localhost:8000/index-v2.html';
const findings = [];
const report = (level, name, detail) => {
  findings.push({ level, name, detail });
  console.log(`${level.padEnd(4)} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForTimeout(800);

  // Activate every tab so all DOM is built.
  for (const tab of ['players', 'team-stats', 'stat-school', 'overview']) {
    await page.evaluate((t) => { window.location.hash = t; }, tab);
    await page.waitForTimeout(400);
  }

  // ----- L1: only the 3 identity tokens are set from JS -----
  //
  // theme.js may set --team-primary / -secondary / -accent. Any other
  // token override in JS means a layer-boundary regression — CSS owns
  // derivations. (Bug B1 lived in this gap.)
  const jsTokens = await page.evaluate(() => {
    const inline = document.documentElement.getAttribute('style') || '';
    const tokenNames = [];
    inline.split(';').forEach(decl => {
      const m = decl.match(/--([a-z0-9-]+)\s*:/i);
      if (m) tokenNames.push('--' + m[1]);
    });
    return tokenNames;
  });
  const allowed = ['--team-primary', '--team-secondary', '--team-accent'];
  const stray = jsTokens.filter(t => !allowed.includes(t));
  report(stray.length === 0 ? 'PASS' : 'FAIL',
    `L1: only identity tokens set from JS (${jsTokens.length} inline, ${stray.length} stray)`,
    stray.length ? 'stray: ' + stray.join(', ') : '');

  // ----- L2: exactly one <h1> on the page -----
  const h1Count = await page.$$eval('h1', els => els.length);
  report(h1Count === 1 ? 'PASS' : 'FAIL',
    `L2: exactly one <h1> in document`,
    `count=${h1Count}`);

  // ----- L3: every tab body has an <h2> -----
  //
  // Bug B6: Overview had none. The tabBody() factory makes this
  // structurally guaranteed.
  for (const tab of ['overview', 'players', 'team-stats', 'stat-school']) {
    await page.evaluate((t) => { window.location.hash = t; }, tab);
    await page.waitForTimeout(300);
    const hasH2 = await page.evaluate((id) => {
      const body = document.getElementById('tab-' + id);
      return !!body && !!body.querySelector('h2');
    }, tab);
    report(hasH2 ? 'PASS' : 'FAIL',
      `L3: tab body #tab-${tab} contains an <h2>`);
  }

  // ----- L4: zero duplicate element IDs -----
  //
  // Bug B3: stat-mlb_rank collided. Namespaced IDs (ss-stat-<slug>)
  // and per-tab structural IDs (stat-school-keystone/honesty/pitches)
  // make this structurally impossible — but a future JSON contributor
  // could still pick a slug that matches a structural ID by accident.
  // Asserting zero duplicates protects against that.
  for (const tab of ['players', 'team-stats', 'stat-school', 'overview']) {
    await page.evaluate((t) => { window.location.hash = t; }, tab);
    await page.waitForTimeout(300);
  }
  const dupIds = await page.evaluate(() => {
    const seen = new Map();
    document.querySelectorAll('[id]').forEach(el =>
      seen.set(el.id, (seen.get(el.id) || 0) + 1));
    return Array.from(seen.entries()).filter(([, c]) => c > 1);
  });
  report(dupIds.length === 0 ? 'PASS' : 'FAIL',
    `L4: no duplicate element IDs after every tab activated`,
    dupIds.length ? JSON.stringify(dupIds) : '');

  // ----- L5: per-stat cards use the ss-stat- namespace -----
  //
  // Direct assertion of the namespacing pattern. If a new card type
  // sneaks in under a different prefix, this catches it.
  await page.evaluate(() => { window.location.hash = 'stat-school'; });
  await page.waitForTimeout(500);
  const statCardIds = await page.$$eval('.ss-col .exp', els => els.map(e => e.id));
  const offNamespace = statCardIds.filter(id => id && !id.startsWith('ss-stat-'));
  report(offNamespace.length === 0 ? 'PASS' : 'FAIL',
    `L5: every Stat School per-stat card uses ss-stat- prefix`,
    offNamespace.length ? 'off-namespace: ' + offNamespace.join(', ') : `${statCardIds.length} cards verified`);

  // ----- L6: dark mode contrast still passes (B1 regression guard) -----
  //
  // Use canvas readback to resolve color-mix() oklab values to sRGB.
  const cs = await ctx.newPage();
  await cs.addInitScript(() => localStorage.setItem('jt-theme', 'dark'));
  await cs.goto(BASE);
  await cs.waitForTimeout(800);
  await cs.evaluate(() => { window.location.hash = 'players'; });
  await cs.waitForTimeout(400);
  const colors = await cs.evaluate(() => {
    const av = document.querySelector('.pcard .pc-av');
    if (!av) return null;
    const css = getComputedStyle(av);
    const c = document.createElement('canvas');
    c.width = 2; c.height = 2;
    const x = c.getContext('2d');
    x.fillStyle = css.backgroundColor;
    x.fillRect(0, 0, 2, 2);
    const bg = x.getImageData(0, 0, 1, 1).data;
    x.clearRect(0, 0, 2, 2);
    x.fillStyle = css.color;
    x.fillRect(0, 0, 2, 2);
    const fg = x.getImageData(0, 0, 1, 1).data;
    return { bg: [bg[0], bg[1], bg[2]], fg: [fg[0], fg[1], fg[2]] };
  });
  await cs.close();
  if (colors) {
    const lum = (c) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const l1 = lum(colors.fg), l2 = lum(colors.bg);
    const r = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    report(r >= 3 ? 'PASS' : 'FAIL',
      `L6: .pc-av dark-mode contrast ${r.toFixed(2)}:1`,
      r >= 3 ? 'meets AA-large' : 'fails contrast');
  } else {
    report('FAIL', 'L6: could not measure .pc-av contrast');
  }

  // ----- SUMMARY -----
  const fails = findings.filter(f => f.level === 'FAIL');
  console.log(`\nlayer-boundaries: ${findings.length - fails.length}/${findings.length} pass`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(err => {
  console.error('PROBE ERROR:', err.message);
  process.exit(2);
});
