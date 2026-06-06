/* ============================================================
   Probe: visual regression snapshots

   The recent v2 audit passes were a steady drip of visual regressions
   (dashes-as-underscores, heat-bar gradients without markers, pcard
   truncation at narrow widths) — each caught by manual screenshot
   review after merge. This probe is the systematic counterweight: a
   deterministic set of UI screenshots, compared against committed
   baselines, fails CI on any pixel diff that exceeds the threshold.

   Determinism:
   - data.json is intercepted at the network layer and served from
     tests/fixtures/visual-data.json so the surface state doesn't drift
     with the daily refresh. Bump the fixture deliberately when the
     fetcher's schema changes; the baseline update step is the same.
   - Theme is set explicitly (no prefers-color-scheme fallthrough);
     localStorage is cleared per-page so prior visits don't bleed.
   - Viewport pinned to 1280×900 @ DPR 2; one width to start. Future
     passes can sweep widths once the framework is mature.

   Updating baselines (deliberate, reviewable in the PR):
     UPDATE_SNAPSHOTS=1 node tests/probes/visual.js
   Then `git add tests/screenshots/baselines/*.png` and commit. The
   reviewer sees the new baselines as part of the diff — that's the
   approval mechanism.

   Pixel-diff tolerance:
   - pixelmatch threshold 0.1 — pixel-level color distance below this
     counts as a match (handles minor antialiasing variation).
   - Whole-frame budget: ≤ 0.05% of pixels may differ before the probe
     fails. At 1280×900 that's ~576 pixels — generous enough to absorb
     subpixel rendering noise across runs, tight enough to catch real
     visual regressions like the dash-as-underscore class.

   Run from repo root with a static server up at :8000:
     python3 -m http.server 8000 &
     NODE_PATH=/opt/node22/lib/node_modules node tests/probes/visual.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const pixelmatch = require('pixelmatch');
const { PNG } = require('pngjs');

const BASE = process.env.JT_BASE || 'http://localhost:8000/index-v2.html';
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';
const ROOT = path.join(__dirname, '..', '..');
const BASELINES = path.join(ROOT, 'tests', 'screenshots', 'baselines');
const DIFFS = '/tmp/v2-shots';
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'visual-data.json');

const PIXEL_THRESHOLD = 0.1;      // per-pixel color distance
const FRAME_BUDGET_PCT = 0.05;    // % of pixels allowed to differ

if (!fs.existsSync(DIFFS)) fs.mkdirSync(DIFFS, { recursive: true });
if (!fs.existsSync(BASELINES)) fs.mkdirSync(BASELINES, { recursive: true });

const findings = [];
const report = (level, name, detail) => {
  findings.push({ level, name, detail });
  console.log(`${level.padEnd(4)} ${name}${detail ? ' — ' + detail : ''}`);
};

// Returns { ctx, page } with data.json route-intercepted to the fixture.
async function fixturePage(browser, opts) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const fixture = fs.readFileSync(FIXTURE, 'utf8');
  await ctx.route('**/data.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: fixture }));
  const page = await ctx.newPage();
  // Clear any persisted theme before navigation so the baseline always
  // starts from a known state.
  await page.addInitScript(() => { try { localStorage.removeItem('jt-theme'); } catch (_) {} });
  await page.goto(BASE);
  if (opts && opts.theme === 'dark') {
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  }
  await page.waitForFunction(() => {
    const ov = document.getElementById('tab-overview');
    return ov && !ov.querySelector('.panel-skeleton');
  }, null, { timeout: 8000 }).catch(() => {});
  // Wait for Hanken Grotesk (Google Fonts CDN) before screenshotting.
  // Without this, the first paint can land in the system fallback sans
  // and the screenshot freezes the fallback metrics — on CI the first
  // run produced 7-8% structural diffs (modal heights off by 38px)
  // because the fallback wraps differently than Hanken. document.fonts.ready
  // resolves only after every @font-face declared in CSS has settled.
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(700);
  return { ctx, page };
}

// Compare buf against the baseline at <name>.png. Writes diff on
// mismatch. Returns { ok, diffPct, reason }.
function compare(name, buf) {
  const target = path.join(BASELINES, name + '.png');
  if (UPDATE || !fs.existsSync(target)) {
    fs.writeFileSync(target, buf);
    return { ok: true, diffPct: 0, reason: UPDATE ? 'updated' : 'created' };
  }
  const actual = PNG.sync.read(buf);
  let expected;
  try { expected = PNG.sync.read(fs.readFileSync(target)); }
  catch (e) { return { ok: false, diffPct: 100, reason: 'baseline unreadable: ' + e.message }; }
  if (actual.width !== expected.width || actual.height !== expected.height) {
    fs.writeFileSync(path.join(DIFFS, name + '.actual.png'), buf);
    return {
      ok: false,
      diffPct: 100,
      reason: `dims ${actual.width}×${actual.height} vs ${expected.width}×${expected.height}`,
    };
  }
  const diff = new PNG({ width: actual.width, height: actual.height });
  const diffPx = pixelmatch(
    expected.data, actual.data, diff.data,
    actual.width, actual.height,
    { threshold: PIXEL_THRESHOLD }
  );
  const total = actual.width * actual.height;
  const diffPct = (diffPx / total) * 100;
  if (diffPct > FRAME_BUDGET_PCT) {
    fs.writeFileSync(path.join(DIFFS, name + '.actual.png'), buf);
    fs.writeFileSync(path.join(DIFFS, name + '.diff.png'), PNG.sync.write(diff));
    return { ok: false, diffPct, reason: `${diffPx} px (${diffPct.toFixed(3)}%) differ` };
  }
  return { ok: true, diffPct };
}

async function snapshot(name, page, locator) {
  const target = locator ? page.locator(locator).first() : page;
  const buf = await target.screenshot({ animations: 'disabled', caret: 'hide' });
  const res = compare(name, buf);
  const tag = res.reason === 'updated' || res.reason === 'created' ? 'INFO' : (res.ok ? 'PASS' : 'FAIL');
  report(tag, `visual: ${name}`,
    res.reason ? res.reason : `pct=${res.diffPct.toFixed(4)}%`);
  return res.ok;
}

(async () => {
  const browser = await chromium.launch();

  // -------- Overview, light --------
  {
    const { ctx, page } = await fixturePage(browser);
    await snapshot('overview-light', page);
    await ctx.close();
  }

  // -------- Overview, dark --------
  {
    const { ctx, page } = await fixturePage(browser, { theme: 'dark' });
    await snapshot('overview-dark', page);
    await ctx.close();
  }

  // -------- Players grid, light --------
  {
    const { ctx, page } = await fixturePage(browser);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(700);
    await snapshot('players-light', page);
    await ctx.close();
  }

  // -------- Players grid, dark --------
  {
    const { ctx, page } = await fixturePage(browser, { theme: 'dark' });
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(700);
    await snapshot('players-dark', page);
    await ctx.close();
  }

  // -------- Hitter modal — pick a stable, ranked hitter from the fixture --------
  {
    const { ctx, page } = await fixturePage(browser);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(500);
    // First ranked hitter card — the fixture is stable so the picked
    // player is deterministic.
    const hitterId = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.pcard'));
      const ranked = cards.find((c) => !c.querySelector('.pc-stat i.muted'));
      return ranked ? ranked.dataset.playerId : null;
    });
    if (hitterId) {
      await page.evaluate((id) => document.querySelector(`.pcard[data-player-id="${id}"]`).click(), hitterId);
      await page.waitForTimeout(500);
      await snapshot('hitter-modal-light', page, '#player-modal-scrim .modal');
    } else {
      report('WARN', 'visual: hitter-modal-light', 'no ranked hitter in fixture');
    }
    await ctx.close();
  }

  // -------- Pitcher modal — Kevin Gausman is in the fixture --------
  {
    const { ctx, page } = await fixturePage(browser);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const c = document.querySelector('.pcard[data-player-id="592332"]');
      if (c) c.click();
    });
    await page.waitForTimeout(500);
    await snapshot('pitcher-modal-light', page, '#player-modal-scrim .modal');
    await ctx.close();
  }

  // -------- Team Stats (hitting view, light) --------
  {
    const { ctx, page } = await fixturePage(browser);
    await page.evaluate(() => { window.location.hash = 'team-stats'; });
    await page.waitForTimeout(700);
    await snapshot('team-stats-light', page);
    await ctx.close();
  }

  // -------- Stat School top (light) --------
  {
    const { ctx, page } = await fixturePage(browser);
    await page.evaluate(() => { window.location.hash = 'stat-school'; });
    await page.waitForTimeout(900);
    await snapshot('stat-school-light', page);
    await ctx.close();
  }

  // -------- IL popover open --------
  {
    const { ctx, page } = await fixturePage(browser);
    await page.locator('#il-chip').click();
    await page.waitForTimeout(400);
    // Snapshot the page so chip + popover are both in frame.
    await snapshot('il-popover-light', page);
    await ctx.close();
  }

  const fails = findings.filter((f) => f.level === 'FAIL').length;
  const updates = findings.filter((f) => f.detail === 'updated' || f.detail === 'created').length;
  const passes = findings.filter((f) => f.level === 'PASS').length;
  console.log(`\nvisual: ${passes} pass, ${updates} ${UPDATE ? 'updated' : 'baselines created'}, ${fails} fail`);
  if (fails > 0) {
    console.log(`\nDiff artifacts in ${DIFFS}/ — review *.actual.png and *.diff.png`);
    console.log(`To accept these as the new baseline, re-run with UPDATE_SNAPSHOTS=1.`);
  }
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((err) => {
  console.error('PROBE ERROR:', err.message);
  process.exit(2);
});
