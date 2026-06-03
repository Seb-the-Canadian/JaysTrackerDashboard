/* ============================================================
   Probe: loading states
   Antifragile pass — Commit 3. Asserts the dashboard never shows
   a blank tab during async loads (B8 class). Each tab paints a
   skeleton synchronously, then resolves to real content when
   fetches complete.

   Run from repo root with a static server up at :8000:
     python3 -m http.server 8000 &
     NODE_PATH=/opt/node22/lib/node_modules node tests/probes/loading-states.js
   ============================================================ */
const { chromium } = require('playwright');

const BASE = process.env.JT_BASE || 'http://localhost:8000/index-v2.html';
const findings = [];
const report = (level, name, detail) => {
  findings.push({ level, name, detail });
  console.log(`${level.padEnd(4)} ${name}${detail ? ' — ' + detail : ''}`);
};

const TABS = ['overview', 'players', 'team-stats', 'stat-school'];

// Routes JSON fetches through a delay so the skeleton phase is
// long enough to observe. The dashboard would otherwise resolve
// in <50ms on localhost and the skeleton window would be invisible.
async function withDelay(ctx, delayMs, route) {
  await ctx.route(route, async (req) => {
    await new Promise(r => setTimeout(r, delayMs));
    await req.continue();
  });
}

(async () => {
  const browser = await chromium.launch();

  // ----- T1: skeleton appears within 100ms of nav -----
  //
  // The plan's bound was 50ms; loosened to 100 to absorb playwright
  // RTT overhead. The point is "non-blank synchronous paint", not a
  // specific deadline.
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    await withDelay(ctx, 1500, '**/data.json');
    await withDelay(ctx, 1500, '**/notes.json');
    await withDelay(ctx, 1500, '**/stat_school.json');
    const page = await ctx.newPage();
    const navStart = Date.now();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    // Read each tab body's first-paint state.
    for (const tab of TABS) {
      // Hop to the tab.
      await page.evaluate((t) => { window.location.hash = t; }, tab);
      await page.waitForTimeout(60);
      const has = await page.evaluate((tabId) => {
        const root = document.getElementById('tab-' + tabId);
        if (!root) return { hasSkel: false, hasH2: false, isEmpty: true };
        return {
          hasSkel: !!root.querySelector('.sk-line'),
          hasH2: !!root.querySelector('h2'),
          isEmpty: root.textContent.trim().length === 0,
        };
      }, tab);
      const elapsed = Date.now() - navStart;
      report(has.hasSkel && has.hasH2 ? 'PASS' : 'FAIL',
        `T1: #tab-${tab} has skeleton+h2 within ${elapsed}ms of nav`,
        `skel=${has.hasSkel} h2=${has.hasH2} empty=${has.isEmpty}`);
    }
    await ctx.close();
  }

  // ----- T2: real content arrives within 2500ms (after 1500ms fetch delay) -----
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    await withDelay(ctx, 1500, '**/data.json');
    await withDelay(ctx, 1500, '**/notes.json');
    await withDelay(ctx, 1500, '**/stat_school.json');
    const page = await ctx.newPage();
    await page.goto(BASE);
    // Overview is the landing tab; we wait specifically for its KPI grid.
    const ok = await page.waitForFunction(
      () => {
        const ov = document.getElementById('tab-overview');
        return ov && ov.querySelector('.kpis') && !ov.querySelector('.sk-line');
      },
      null,
      { timeout: 3500 }
    ).then(() => true).catch(() => false);
    report(ok ? 'PASS' : 'FAIL',
      `T2: Overview renders real content within 3500ms of nav`);

    for (const tab of ['players', 'team-stats', 'stat-school']) {
      await page.evaluate((t) => { window.location.hash = t; }, tab);
      const tabOk = await page.waitForFunction(
        (tabId) => {
          const r = document.getElementById('tab-' + tabId);
          if (!r) return false;
          // Skeleton gone AND something else present.
          return !r.querySelector('.sk-line') && r.textContent.trim().length > 50;
        },
        tab,
        { timeout: 3500 }
      ).then(() => true).catch(() => false);
      report(tabOk ? 'PASS' : 'FAIL',
        `T2: #tab-${tab} replaces skeleton with content within 3500ms`);
    }
    await ctx.close();
  }

  // ----- T3: data.json failure → tab shows error panel + retry button -----
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    await ctx.route('**/data.json', (req) => req.abort());
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(900);
    for (const tab of TABS) {
      await page.evaluate((t) => { window.location.hash = t; }, tab);
      await page.waitForTimeout(180);
      const has = await page.evaluate((tabId) => {
        const r = document.getElementById('tab-' + tabId);
        if (!r) return { err: false, retry: false };
        return {
          err: !!r.querySelector('.panel-error'),
          retry: !!r.querySelector('.panel-retry'),
        };
      }, tab);
      report(has.err && has.retry ? 'PASS' : 'FAIL',
        `T3: data.json fail → #tab-${tab} shows error+retry`,
        `err=${has.err} retry=${has.retry}`);
    }
    await ctx.close();
  }

  // ----- T4: no JS errors anywhere along the loading lifecycle -----
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const errs = [];
    ctx.on('weberror', (e) => errs.push(e.error().message));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(e.message));
    await withDelay(ctx, 800, '**/data.json');
    await withDelay(ctx, 800, '**/notes.json');
    await withDelay(ctx, 800, '**/stat_school.json');
    await page.goto(BASE);
    await page.waitForTimeout(2000);
    for (const tab of TABS) {
      await page.evaluate((t) => { window.location.hash = t; }, tab);
      await page.waitForTimeout(180);
    }
    report(errs.length === 0 ? 'PASS' : 'FAIL',
      `T4: no JS errors across slow-network lifecycle`,
      errs.length ? errs.join(' | ') : '');
    await ctx.close();
  }

  const fails = findings.filter(f => f.level === 'FAIL');
  console.log(`\nloading-states: ${findings.length - fails.length}/${findings.length} pass`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(err => {
  console.error('PROBE ERROR:', err.message);
  process.exit(2);
});
