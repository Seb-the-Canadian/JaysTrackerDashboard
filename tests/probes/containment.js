/* ============================================================
   Probe: containment discipline
   Antifragile pass — Commit 2. The B7 class is: content pushes
   past the viewport, the browser exposes a horizontal scroll
   surface, the user can scroll right and break the design.

   The structural fix is `body { overflow-x: clip }` + universal
   `min-width: 0` so no flex/grid child can refuse to shrink.

   What we assert here:
   1. PRIMARY — the body offers NO horizontal scroll surface.
      `body.scrollLeft` cannot be made nonzero. This is the
      direct B7-class regression guard. At every tested viewport,
      across every tab, with stress fixtures installed, the user
      cannot bleed past the right edge.
   2. SECONDARY (informational) — no single element's right edge
      exceeds viewport + 1px. A finding here documents a layout
      that *would* overflow if the structural clip were removed,
      so the codebase doesn't silently rely on the clip.

   Run from repo root with a static server up at :8000:
     python3 -m http.server 8000 &
     NODE_PATH=/opt/node22/lib/node_modules node tests/probes/containment.js
   ============================================================ */
const { chromium } = require('playwright');

const BASE = process.env.JT_BASE || 'http://localhost:8000/index-v2.html';
const VIEWPORTS = [320, 480, 760, 1100, 1440, 1920];
const TABS = ['overview', 'players', 'team-stats', 'stat-school'];

const findings = [];
const report = (level, name, detail) => {
  findings.push({ level, name, detail });
  console.log(`${level.padEnd(4)} ${name}${detail ? ' — ' + detail : ''}`);
};

async function measureTab(page, viewport, tab, stressLabel) {
  await page.evaluate((t) => { window.location.hash = t; }, tab);
  await page.waitForTimeout(280);
  const tag = `${viewport}px / ${tab}${stressLabel ? ' / ' + stressLabel : ''}`;

  // PRIMARY: try to scroll the body horizontally. If `overflow-x: clip`
  // is honored end-to-end, scrollLeft stays at 0.
  const scroll = await page.evaluate(() => {
    window.scrollTo(99999, 0);
    return {
      bodyLeft: document.body.scrollLeft || 0,
      htmlLeft: document.documentElement.scrollLeft || 0,
      windowX: window.scrollX || 0,
    };
  });
  const scrollOk = scroll.bodyLeft === 0 && scroll.htmlLeft === 0 && scroll.windowX === 0;
  report(scrollOk ? 'PASS' : 'FAIL',
    `containment: no horizontal scroll @ ${tag}`,
    `bodyLeft=${scroll.bodyLeft} htmlLeft=${scroll.htmlLeft} winX=${scroll.windowX}`);

  // SECONDARY: element-level — no rectangle should escape viewport.
  // Filter out elements that are intentionally horizontally scrollable
  // (.tabs has overflow-x: auto; a horizontal scroll inside a known
  // scroller is by design, not a B7 instance).
  const offenders = await page.evaluate(() => {
    const iw = window.innerWidth;
    // Skip descendants of intentional scrollers.
    const inScroller = (el) => {
      let p = el.parentElement;
      while (p) {
        const ox = getComputedStyle(p).overflowX;
        if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth) return true;
        p = p.parentElement;
      }
      return false;
    };
    const bad = [];
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > iw + 1 && r.width > 4 && !inScroller(el)) {
        const sig = el.tagName.toLowerCase() +
          (el.id ? '#' + el.id : '') +
          (typeof el.className === 'string' && el.className.trim()
            ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
            : '');
        bad.push({ sig: sig, right: Math.round(r.right), w: Math.round(r.width) });
      }
    });
    return bad.slice(0, 5);
  });
  if (offenders.length) {
    report('WARN',
      `containment: element rects exceed viewport @ ${tag}`,
      offenders.map(o => `${o.sig} right=${o.right} w=${o.w}`).join(' | '));
  }
}

// Stress-fixture installer. Targets identity-bearing fields with
// realistic worst-case content:
//  - 32-char unbroken token (single long name — exercises overflow-wrap)
//  - Long-but-spaced headline (natural worst case)
async function installStressFixtures(page) {
  await page.evaluate(() => {
    const LONG_TOKEN = 'Schwarzenegger-Worcestershire'; // 28-char hyphenated single token
    const LONG_HEADLINE = 'A long contextual headline that goes on and on '
      + 'about the team performance over the last fortnight of play with '
      + 'qualifiers and asides built in for stress measurement purposes.';
    document.querySelectorAll('.pc-id b, .modal-id h3, .pi-name').forEach(el => {
      // Replace only the first text node so badge spans aren't disturbed.
      const firstText = Array.from(el.childNodes).find(n => n.nodeType === 3);
      if (firstText) firstText.textContent = LONG_TOKEN + ' ' + LONG_TOKEN;
      else el.textContent = LONG_TOKEN + ' ' + LONG_TOKEN;
    });
    document.querySelectorAll('.ov-eyebrow, .ov-head').forEach(el => {
      el.textContent = LONG_HEADLINE;
    });
  });
  await page.waitForTimeout(140);
}

(async () => {
  const browser = await chromium.launch();

  for (const w of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(700);

    for (const tab of TABS) {
      await measureTab(page, w, tab, null);
    }
    for (const tab of TABS) {
      await page.evaluate((t) => { window.location.hash = t; }, tab);
      await page.waitForTimeout(280);
      await installStressFixtures(page);
      await measureTab(page, w, tab, 'stress');
    }

    await ctx.close();
  }

  const fails = findings.filter(f => f.level === 'FAIL');
  const warns = findings.filter(f => f.level === 'WARN');
  console.log(`\ncontainment: ${findings.length - fails.length - warns.length} pass, ${warns.length} warn, ${fails.length} fail`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(err => {
  console.error('PROBE ERROR:', err.message);
  process.exit(2);
});
