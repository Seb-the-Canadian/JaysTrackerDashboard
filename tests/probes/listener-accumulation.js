/* ============================================================
   Probe: listener accumulation under Retry
   PR-B — Render correctness (COG-364).

   Survivorship audit B6 found that 12 of 15 HIGH findings could
   not be detected by the existing probe suite. One of them was
   H7 (listener accumulation): the error-panel Retry button calls
   init() again, and prior to PR-B that re-ran hookThemeToggle /
   hookTabRouting / stat-school's hashchange wire, accumulating
   listeners. modal-state.js passes even when 3× duplicate
   listeners are injected.

   This probe is the meta-fix: monkey-patch addEventListener at
   page-init time so we can count bindings, then drive the
   data.json failure → Retry → assert listener counts stay flat.

   Run from repo root with a static server up at :8001:
     python3 -m http.server 8001 &
     NODE_PATH=/opt/node22/lib/node_modules node tests/probes/listener-accumulation.js
   ============================================================ */
const { chromium } = require('playwright');

const BASE = process.env.JT_BASE || 'http://localhost:8001/index-v2.html';
const findings = [];
const report = (level, name, detail) => {
  findings.push({ level, name, detail });
  console.log(`${level.padEnd(4)} ${name}${detail ? ' — ' + detail : ''}`);
};

// ---- patch: wrap addEventListener BEFORE any page script runs ----
//
// Counts per event type per target (window / document / scoped element).
// We tag targets cheaply by reference; the renderer adds listeners to:
//   - window: hashchange (stat-school)
//   - document: visibilitychange (render.js), keydown (modal.js esc)
//   - #theme-toggle: click
//   - .tab anchors: click (4)
const PATCH = `
  window.__listenerCounts = {};
  (function () {
    const tag = (t) => {
      if (t === window) return 'window';
      if (t === document) return 'document';
      if (t && t.id) return '#' + t.id;
      if (t && t.classList && t.classList.length) return '.' + t.classList[0];
      return '?';
    };
    const origAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      const key = tag(this) + ':' + type;
      window.__listenerCounts[key] = (window.__listenerCounts[key] || 0) + 1;
      return origAdd.call(this, type, fn, opts);
    };
  })();
`;

async function snapshot(page) {
  return await page.evaluate(() => Object.assign({}, window.__listenerCounts));
}

async function loadAndSnap(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await ctx.addInitScript(PATCH);
  if (opts.failDataJson) {
    await ctx.route('**/data.json', (route) => route.abort());
  }
  const page = await ctx.newPage();
  await page.goto(BASE);
  // Wait for the bootstrap to finish (paint OR error panel).
  await page.waitForFunction(() => {
    const ov = document.getElementById('tab-overview');
    if (!ov) return false;
    return ov.querySelector('.panel-error') || ov.querySelector('.kpis');
  }, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch();

  // ===== L1: counts stay flat across N Retry clicks =====
  //
  // Open the page with data.json failing → all 4 tabs render error
  // panels with Retry buttons. Click Retry on Overview three times.
  // The relevant listener counts (theme-toggle click, hashchange,
  // visibilitychange) must not grow.
  {
    const { ctx, page } = await loadAndSnap(browser, { failDataJson: true });
    const before = await snapshot(page);
    // Click Overview's Retry 3 times. Each click re-runs init().
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const btn = document.querySelector('#tab-overview .panel-retry');
        if (btn) btn.click();
      });
      await page.waitForTimeout(250);
    }
    const after = await snapshot(page);

    const tracked = [
      '#theme-toggle:click',
      'window:hashchange',
      'document:visibilitychange',
    ];
    for (const key of tracked) {
      const b = before[key] || 0;
      const a = after[key] || 0;
      report(a === b ? 'PASS' : 'FAIL',
        `L1: ${key} count flat across 3× Retry`,
        `before=${b} after=${a}`);
    }
    await ctx.close();
  }

  // ===== L2: one Retry → one logical re-render, not N =====
  //
  // Even if the listeners themselves are gated, the EFFECT of a single
  // theme-toggle click should be one toggle. If listeners had piled up,
  // multiple installed handlers would each fire and the theme would
  // flip then flip back. The visible behavior must be: one click → one
  // toggle, regardless of Retry history.
  {
    const { ctx, page } = await loadAndSnap(browser, { failDataJson: true });
    // Trigger several retries.
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const btn = document.querySelector('#tab-overview .panel-retry');
        if (btn) btn.click();
      });
      await page.waitForTimeout(200);
    }
    // Now click theme-toggle once and observe effective state change.
    const before = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme');
    });
    await page.evaluate(() => {
      document.getElementById('theme-toggle').click();
    });
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme');
    });
    // The exact pair depends on initial system theme; assert "different
    // from before" — i.e. exactly one toggle happened. If listeners
    // had multiplied, two would cancel and we'd see no change.
    const oneFlip = before !== after;
    report(oneFlip ? 'PASS' : 'FAIL',
      'L2: one theme-toggle click after Retries → exactly one flip',
      `before=${before} after=${after}`);
    await ctx.close();
  }

  // ===== L3: Stat School renders content when data.json fails =====
  //
  // PR-B audit H8: Stat School's content comes from stat_school.json,
  // not data.json. The error-panel gate must not block it.
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    await ctx.route('**/data.json', (route) => route.abort());
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    // Activate Stat School.
    await page.evaluate(() => { window.location.hash = 'stat-school'; });
    await page.waitForTimeout(800);
    const has = await page.evaluate(() => {
      const body = document.getElementById('tab-stat-school');
      if (!body) return { error: 'no body' };
      return {
        hasError: !!body.querySelector('.panel-error'),
        hasKeystone: !!document.getElementById('stat-school-keystone'),
        hasAnyExpCard: !!body.querySelector('.exp[id^="ss-stat-"]'),
      };
    });
    report(!has.hasError && (has.hasKeystone || has.hasAnyExpCard) ? 'PASS' : 'FAIL',
      'L3: Stat School renders when data.json fails (depends on stat_school.json)',
      JSON.stringify(has));
    await ctx.close();
  }

  const fails = findings.filter(f => f.level === 'FAIL');
  console.log(`\nlistener-accumulation: ${findings.length - fails.length}/${findings.length} pass`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(err => {
  console.error('PROBE ERROR:', err.message);
  process.exit(2);
});
