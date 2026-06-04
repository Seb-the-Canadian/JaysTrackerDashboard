/* ============================================================
   Probe: real-data render check

   Every other probe route-intercepts data.json and injects synthetic
   values — which is why two bugs shipped this cycle that fixtures couldn't
   see:
     - the live schema-drift banner (committed data.json lacked a key the
       renderer now requires), and
     - the percentile bug (real pool ranks 1..150 rendered "—"/pinned
       markers; the fixture only used ranks 1..26).

   This probe loads index-v2.html against the REAL committed data.json with
   NO interception, so it exercises exactly what ships:

     D1  no schema-drift banner (committed data.json satisfies EXPECTED_KEYS)
     D2  the Players grid renders cards (data actually bound)
     D3  if player_rank_pool is present with ranked players, at least one
         pcard shows a percentile badge — NOT all "—" (the percentile-bug
         signature). Skipped (not failed) when no players qualify.

   Run from repo root with a static server up at :8000:
     python3 -m http.server 8000 &
     NODE_PATH=/opt/node22/lib/node_modules node tests/probes/real-data.js
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await ctx.newPage();
  // Capture the real data.json the page fetches, so D3's precondition
  // (are there ranked players?) matches exactly what rendered.
  let realData = null;
  page.on('response', async (res) => {
    if (res.url().endsWith('/data.json')) {
      try { realData = await res.json(); } catch (_) {}
    }
  });
  await page.goto(BASE);
  await page.waitForFunction(() => {
    const ov = document.getElementById('tab-overview');
    return ov && !ov.querySelector('.panel-skeleton');
  }, null, { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(300);

  // ----- D1: no schema-drift banner on the real data -----
  const banner = await page.evaluate(() => {
    const b = document.getElementById('schemaBanner');
    return b ? { hidden: b.hidden, text: (b.textContent || '').slice(0, 120) } : { hidden: true, text: '' };
  });
  report(banner.hidden ? 'PASS' : 'FAIL',
    'D1: no schema-drift banner on committed data.json',
    banner.hidden ? '' : `BANNER: "${banner.text}" — data.json is stale vs EXPECTED_KEYS; trigger daily-refresh`);

  // ----- D2: Players grid renders cards -----
  await page.evaluate(() => { window.location.hash = 'players'; });
  await page.waitForTimeout(500);
  const cardCount = await page.evaluate(() => document.querySelectorAll('.pcard').length);
  report(cardCount > 0 ? 'PASS' : 'FAIL', 'D2: Players grid renders cards', `count=${cardCount}`);

  // ----- D3: real ranks render as percentiles (not all "—") -----
  const pool = (realData && realData.player_rank_pool) || {};
  const pr = (realData && realData.player_ranks) || {};
  const anyRanked = Object.values(pr).some((v) =>
    v && Object.values(v).some((x) => x != null));
  const poolReady = (pool.hitting || 0) > 0 || (pool.pitching || 0) > 0;
  if (poolReady && anyRanked) {
    const badges = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.pcard .pc-right i'))
        .map((i) => i.textContent.trim()));
    const withPctile = badges.filter((t) => /%ile/.test(t)).length;
    report(withPctile > 0 ? 'PASS' : 'FAIL',
      'D3: real pool ranks render percentile badges (not all "—")',
      `pctile_badges=${withPctile}/${badges.length}`);
  } else {
    report('INFO', 'D3: skipped — no qualified ranked players in committed data',
      `poolReady=${poolReady} anyRanked=${anyRanked}`);
  }

  const fails = findings.filter((f) => f.level === 'FAIL');
  console.log(`\nreal-data: ${findings.filter((f) => f.level === 'PASS').length} pass, ` +
    `${findings.filter((f) => f.level === 'INFO').length} info, ${fails.length} fail`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((err) => {
  console.error('PROBE ERROR:', err.message);
  process.exit(2);
});
