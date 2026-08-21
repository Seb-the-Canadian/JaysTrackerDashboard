/* ============================================================
   Probe: wild-card "me" row is always visible

   The bug this guards against, in full:

     renderWildCard() showed `out.slice(0, 4)` to keep the panel compact.
     That's fine while you're near the cut line — and silently drops your
     own team the moment you fall to 5th-worst or lower in the "Out"
     group. The Blue Jays vanished from the AL Wild Card panel on
     2026-07-13 and stayed gone for 27 days. The data was correct the
     whole time (is_us: true was set on the row); only the render was
     wrong, and the failure mode was invisible precisely because it
     tracked the standings.

   round-1 asserts exactly one .wc-row.me against the *committed* data,
   which catches this only while the team happens to be low in the
   standings. That's a guard that comes and goes with the season. This
   probe pins the outcome instead: it injects synthetic standings that
   place us at every position in the "Out" group — including dead last —
   and asserts our row renders every time.

   Per CLAUDE.md: guarantee the outcome the user sees, not the mechanism.

   Run from repo root with a static server up at :8000:
     python3 -m http.server 8000 &
     node tests/probes/wildcard-visibility.js
   ============================================================ */
const { chromium } = require('playwright');

const BASE = process.env.JT_BASE || 'http://localhost:8000/index-v2.html';
const findings = [];
const report = (level, name, detail) => {
  findings.push({ level, name, detail });
  console.log(`${level.padEnd(4)} ${name}${detail ? ' — ' + detail : ''}`);
};

// Build a wild_card array with `outCount` teams in the Out group and our
// team parked at index `usIdx` within it.
function buildWildCard(outCount, usIdx) {
  const rows = [
    { team: 'Tampa Bay Rays', team_id: 139, w: 69, l: 46, gb: '-', note: 'Division leader', is_us: false },
    { team: 'Chicago White Sox', team_id: 145, w: 59, l: 56, gb: '-', note: 'Division leader', is_us: false },
    { team: 'Houston Astros', team_id: 117, w: 60, l: 57, gb: '-', note: 'Division leader', is_us: false },
    { team: 'New York Yankees', team_id: 147, w: 65, l: 51, gb: '+7.0', note: 'In (1st WC seed)', is_us: false },
    { team: 'Boston Red Sox', team_id: 111, w: 64, l: 51, gb: '+6.5', note: 'In (2nd WC seed)', is_us: false },
    { team: 'Texas Rangers', team_id: 140, w: 58, l: 58, gb: '-', note: 'In (3rd WC seed)', is_us: false },
  ];
  const filler = [
    ['Minnesota Twins', 142], ['Cleveland Guardians', 114], ['Baltimore Orioles', 110],
    ['Detroit Tigers', 116], ['Seattle Mariners', 136], ['Kansas City Royals', 118],
    ['Athletics', 133], ['Los Angeles Angels', 108],
  ];
  let f = 0;
  for (let i = 0; i < outCount; i++) {
    if (i === usIdx) {
      rows.push({ team: 'Toronto Blue Jays', team_id: 141, w: 55, l: 62,
        gb: String(i + 0.5), note: 'Out', is_us: true });
    } else {
      const [name, id] = filler[f++ % filler.length];
      rows.push({ team: name, team_id: id, w: 58 - i, l: 59 + i,
        gb: String(i + 0.5), note: 'Out', is_us: false });
    }
  }
  return rows;
}

(async () => {
  const browser = await chromium.launch();

  // Grab the real data.json once so the injected fixture differs from
  // production only in `wild_card` — everything else stays realistic.
  const seedCtx = await browser.newContext();
  const seedPage = await seedCtx.newPage();
  let baseData = null;
  seedPage.on('response', async (res) => {
    if (res.url().endsWith('/data.json')) {
      try { baseData = await res.json(); } catch (_) {}
    }
  });
  await seedPage.goto(BASE);
  await seedPage.waitForTimeout(600);
  await seedCtx.close();

  if (!baseData) {
    report('FAIL', 'W0: could not read committed data.json to seed fixtures');
  } else {
    report('PASS', 'W0: seeded fixtures from committed data.json');

    // Our team at every slot in a 9-deep Out group: inside the compact
    // window (0-3), just past it (4), and dead last (8).
    const OUT_COUNT = 9;
    for (const usIdx of [0, 3, 4, 6, 8]) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
      const page = await ctx.newPage();
      const fixture = Object.assign({}, baseData, {
        wild_card: buildWildCard(OUT_COUNT, usIdx),
      });
      await page.route('**/data.json', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify(fixture) }));
      await page.goto(BASE);
      await page.waitForTimeout(700);

      const seen = await page.evaluate(() => {
        const me = Array.from(document.querySelectorAll('.wc-row.me'));
        return {
          count: me.length,
          text: me.map((r) => (r.textContent || '').trim()),
          elide: (document.querySelector('.wc-elide') || {}).textContent || null,
        };
      });

      report(seen.count === 1 ? 'PASS' : 'FAIL',
        `W1[out#${usIdx}/${OUT_COUNT}]: our row renders in the Wild Card panel`,
        `meRows=${seen.count} text=${JSON.stringify(seen.text)}`);

      const showsAbbr = seen.count === 1 && /TOR/i.test(seen.text[0] || '');
      report(showsAbbr ? 'PASS' : 'FAIL',
        `W2[out#${usIdx}/${OUT_COUNT}]: our row carries our team abbreviation`,
        `text=${JSON.stringify(seen.text[0] || null)}`);

      // Below the compact window we should explain the jump — but only
      // when rows were genuinely skipped. Inside the window (and directly
      // adjacent to it, where nothing is elided) the marker must stay away.
      const wantElide = usIdx > 4;
      report(!!seen.elide === wantElide ? 'PASS' : 'FAIL',
        `W3[out#${usIdx}/${OUT_COUNT}]: elision marker ${wantElide ? 'present' : 'absent'}`,
        `marker=${JSON.stringify(seen.elide)}`);

      await ctx.close();
    }
  }

  console.log('');
  const fails = findings.filter((f) => f.level === 'FAIL');
  const passes = findings.filter((f) => f.level === 'PASS');
  console.log(`wildcard-visibility: ${passes.length} pass, ${fails.length} fail`);

  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((err) => {
  console.error('PROBE ERROR:', err.message);
  console.error(err.stack);
  process.exit(2);
});
