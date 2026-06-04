/* ============================================================
   Probe: Stat School per-stat data binding
   PR-G — Stat School per-stat card team-data binding (COG-362).

   The audit's H2 was the load-bearing renderer gap: renderStatCard
   ignored state.data.team_stats and state.notes.team.ctx, so
   every per-stat card was pure reference text and the dashboard's
   central "every number carries its MLB rank" promise broke on
   the very tab that explains it.

   This probe asserts the wiring is back:
   - Every stat slug present in data.team_stats[group] renders
     a value pill and percentile tick on its card.
   - Every notes.team.ctx[group.slug] entry renders as a Team
     context block inside its stat card.
   - The previously hardcoded frame_line_md illustrative numbers
     (Vlad .963, team +28 run diff) are gone — they read as
     stale facts now that real values render alongside.

   Run from repo root with a static server up at :8001:
     python3 -m http.server 8001 &
     NODE_PATH=/opt/node22/lib/node_modules node tests/probes/stat-school-binding.js
   ============================================================ */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.JT_BASE || 'http://localhost:8001/index-v2.html';
const findings = [];
const report = (level, name, detail) => {
  findings.push({ level, name, detail });
  console.log(`${level.padEnd(4)} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForFunction(() => {
    const ov = document.getElementById('tab-overview');
    return ov && !ov.querySelector('.panel-skeleton');
  }, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);

  // Activate Stat School and wait for stat_school.json + its render.
  await page.evaluate(() => { window.location.hash = 'stat-school'; });
  await page.waitForFunction(() => {
    const body = document.getElementById('tab-stat-school');
    return body && !!body.querySelector('.exp[id^="ss-stat-"]');
  }, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);

  const repoRoot = path.resolve(__dirname, '..', '..');
  const data = JSON.parse(fs.readFileSync(path.join(repoRoot, 'data.json'), 'utf8'));
  const notes = JSON.parse(fs.readFileSync(path.join(repoRoot, 'notes.json'), 'utf8'));
  const statSchool = JSON.parse(fs.readFileSync(path.join(repoRoot, 'stat_school.json'), 'utf8'));

  // ----- G1: every team_stats[group][slug] renders a value pill -----
  const teamStats = data.team_stats || {};
  for (const group of Object.keys(teamStats)) {
    for (const slug of Object.keys(teamStats[group])) {
      // Only check slugs that ALSO have a Stat School card. (Some
      // team_stats slugs may not have an entry in stat_school.json
      // yet — those are out of scope for H2.)
      if (!statSchool.stats || !statSchool.stats[slug]) continue;
      const expected = teamStats[group][slug];
      const rendered = await page.evaluate((s) => {
        const card = document.getElementById('ss-stat-' + s);
        if (!card) return { error: 'card missing' };
        const pill = card.querySelector('.ss-stat-val');
        if (!pill) return { error: 'no .ss-stat-val' };
        const num = pill.querySelector('.ss-stat-val-num');
        const rank = pill.querySelector('.ss-stat-val-rank');
        return {
          numText: num ? num.textContent : null,
          rankText: rank ? rank.textContent : null,
        };
      }, slug);
      if (rendered.error) {
        report('FAIL', `G1: ${group}.${slug} card missing value pill`, rendered.error);
        continue;
      }
      const valueOk = rendered.numText === String(expected.val) || rendered.numText === expected.val;
      report(valueOk ? 'PASS' : 'FAIL',
        `G1: ${group}.${slug} value pill text matches data.team_stats`,
        `expected="${expected.val}" got="${rendered.numText}"`);
      // Rank assertion only if rank is present in data.
      if (expected.rank != null) {
        // Cheap ordinal check — the rendered text should start with the rank number.
        const startsWithRank = rendered.rankText
          && String(rendered.rankText).indexOf(String(expected.rank)) === 0;
        report(startsWithRank ? 'PASS' : 'FAIL',
          `G1: ${group}.${slug} rank rendered as ordinal`,
          `expected rank=${expected.rank} got="${rendered.rankText}"`);
      }
    }
  }

  // ----- G2: every notes.team.ctx[group.slug] renders a Team context block -----
  const ctxNotes = (notes.team && notes.team.ctx) || {};
  for (const key of Object.keys(ctxNotes)) {
    const [group, slug] = key.split('.');
    if (!slug || !statSchool.stats || !statSchool.stats[slug]) continue;
    const expectedText = ctxNotes[key].replace(/<[^>]+>/g, '').slice(0, 40).trim();
    const rendered = await page.evaluate((s) => {
      const card = document.getElementById('ss-stat-' + s);
      if (!card) return { error: 'card missing' };
      const ctx = card.querySelector('.ss-ctx');
      if (!ctx) return { error: 'no .ss-ctx' };
      return { text: ctx.textContent.trim() };
    }, slug);
    if (rendered.error) {
      report('FAIL', `G2: ${key} Team context missing`, rendered.error);
      continue;
    }
    const found = rendered.text.indexOf(expectedText) !== -1;
    report(found ? 'PASS' : 'FAIL',
      `G2: ${key} Team context renders authored note`,
      `expected="${expectedText}"`);
  }

  // ----- G3: percentile tick present on cards that have a rank -----
  let tickChecked = 0;
  for (const group of Object.keys(teamStats)) {
    for (const slug of Object.keys(teamStats[group])) {
      if (!statSchool.stats || !statSchool.stats[slug]) continue;
      const entry = teamStats[group][slug];
      if (entry.rank == null) continue;
      const hasTick = await page.evaluate((s) => {
        const card = document.getElementById('ss-stat-' + s);
        return !!(card && card.querySelector('.ss-rank-tick'));
      }, slug);
      tickChecked++;
      report(hasTick ? 'PASS' : 'FAIL',
        `G3: ${group}.${slug} card carries a percentile tick`);
    }
  }
  if (tickChecked === 0) {
    report('WARN', 'G3: no ranked stats present in data to assert against');
  }

  // ----- G4: stale hardcoded illustrative numbers removed from frame_line_md -----
  //
  // The pre-PR-G frame lines contained:
  //   ops:       "Guerrero Jr.'s .963 reads as 3rd of 30 qualified 1B"
  //   era:       "A 3.21 starter ERA reads 7th of 30"
  //   run_diff:  "Toronto's +28 reads 8th of 30"
  // These now read as stale fiction next to the live values rendered
  // above each card. Probe asserts they're gone.
  const stale = [
    { slug: 'ops', needle: '.963' },
    { slug: 'ops', needle: '3rd of 30' },
    { slug: 'era', needle: '3.21' },
    { slug: 'era', needle: '7th of 30' },
    { slug: 'run_differential', needle: '+28' },
    { slug: 'run_differential', needle: '8th of 30' },
  ];
  for (const item of stale) {
    const fl = statSchool.stats[item.slug] && statSchool.stats[item.slug].frame_line_md;
    const present = fl && fl.indexOf(item.needle) !== -1;
    report(present ? 'FAIL' : 'PASS',
      `G4: stale "${item.needle}" not in ${item.slug}.frame_line_md`);
  }

  const fails = findings.filter(f => f.level === 'FAIL');
  console.log(`\nstat-school-binding: ${findings.length - fails.length}/${findings.length} pass`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(err => {
  console.error('PROBE ERROR:', err.message);
  process.exit(2);
});
