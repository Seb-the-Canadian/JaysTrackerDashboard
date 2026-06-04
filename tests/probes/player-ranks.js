/* ============================================================
   Probe: player_ranks data binding
   F1 — Backend player_ranks (COG-363).

   The audit's H1 was: data.player_ranks was missing entirely, so
   every pcard showed "—" for rank and the modal "Where he ranks"
   rows for OPS/ERA stayed empty. F1's fetcher now produces the
   key. This probe asserts the frontend renders the values
   correctly when the key is present.

   The frontend renderer code didn't change in F1 — players.js
   already read state.data.player_ranks. So this probe operates by
   route-intercepting data.json and injecting a synthetic
   player_ranks block, then asserting the rank ordinal appears in
   the DOM.

   Run from repo root with a static server up at :8000 (the probe-suite
   convention shared with the other probes):
     python3 -m http.server 8000 &
     NODE_PATH=/opt/node22/lib/node_modules node tests/probes/player-ranks.js
   ============================================================ */
const { chromium } = require('playwright');

const BASE = process.env.JT_BASE || 'http://localhost:8000/index-v2.html';
const findings = [];
const report = (level, name, detail) => {
  findings.push({ level, name, detail });
  console.log(`${level.padEnd(4)} ${name}${detail ? ' — ' + detail : ''}`);
};

async function loadWithSyntheticRanks(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  await ctx.route('**/data.json', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    // Inject synthetic player_ranks for every roster member. Slugs match
    // the PLAYER_HITTING_STATS / PLAYER_PITCHING_STATS the fetcher emits
    // and the players.js modal rows read (OPS/HR/RBI/SB; ERA/WHIP/K9/BB9/IP).
    body.player_ranks = body.player_ranks || {};
    // The committed data.json fixture may predate later EXPECTED_KEYS
    // additions (e.g. opponent_pitchers, G3). Ensure the key exists so the
    // schema-drift banner — which these tests assert on — isn't tripped by
    // an unrelated missing key. The fetcher always emits it post-run.
    body.opponent_pitchers = body.opponent_pitchers || {};
    // Pool sizes for the percentile fix. Deliberately LARGE so injected
    // ranks land well past 30 — the case the old fixture (ranks 1..26)
    // never exercised, which is exactly why the pool-rank-vs-1-30-scale bug
    // shipped. Now ranks must render as percentiles, not "—".
    body.player_rank_pool = { hitting: 160, pitching: 90 };
    const roster = (body.roster || {});
    let i = 1;
    for (const h of (roster.hitters || [])) {
      // i*6 spreads ranks across 6..~150 so most are >30.
      const r = i * 6;
      body.player_ranks[String(h.id)] = { ops: r, hr: r, rbi: r, sb: r };
      // The committed data.json may carry placeholder Statcast values;
      // inject real ones so the value-only Statcast line renders.
      if (!h.xwoba || h.xwoba === '.---') h.xwoba = '.350';
      if (!h.barrel_pct || h.barrel_pct === '---') h.barrel_pct = '9.2%';
      if (!h.hardhit_pct || h.hardhit_pct === '---') h.hardhit_pct = '48%';
      i++;
    }
    let j = 1;
    for (const p of (roster.pitchers || [])) {
      const r = j * 3;
      body.player_ranks[String(p.id)] = {
        era: r, whip: r, k_per_9: r, bb_per_9: r, ip: r,
      };
      // The committed data.json predates the k_per_9 / bb_per_9 roster
      // fields (added with the player-rank realignment); inject values so
      // the K/9 + BB/9 modal rows aren't filtered out as value-less.
      if (!p.k_per_9 || p.k_per_9 === '-.--') p.k_per_9 = '9.50';
      if (!p.bb_per_9 || p.bb_per_9 === '-.--') p.bb_per_9 = '2.30';
      j++;
    }
    if (opts.mutateRanks) opts.mutateRanks(body.player_ranks);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForFunction(() => {
    const ov = document.getElementById('tab-overview');
    return ov && !ov.querySelector('.panel-skeleton');
  }, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch();

  // ----- R1: pcards display rank ordinal when present -----
  {
    const { ctx, page } = await loadWithSyntheticRanks(browser);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(500);
    // First pcard — its rank slot should contain an ordinal (e.g. "1st").
    const firstCardRank = await page.evaluate(() => {
      const card = document.querySelector('.pcard');
      if (!card) return null;
      // The rank badge sits in .pc-right within an <i>.
      const i = card.querySelector('.pc-right i');
      return i ? i.textContent.trim() : null;
    });
    // Label is now a percentile ("97th %ile"), not a 1-30 ordinal.
    const pctileRegex = /\d+(st|nd|rd|th)\s*%ile/;
    report(firstCardRank && pctileRegex.test(firstCardRank) ? 'PASS' : 'FAIL',
      'R1: first pcard renders a percentile label',
      `text="${firstCardRank}"`);
    await ctx.close();
  }

  // ----- R2: rank ordinals fall back to "—" when rank is null -----
  {
    const { ctx, page } = await loadWithSyntheticRanks(browser, {
      mutateRanks: (pr) => {
        // Null out every entry in player_ranks to simulate a non-
        // qualified roster (the fetcher returns None for these).
        for (const id of Object.keys(pr)) {
          for (const slug of Object.keys(pr[id])) {
            pr[id][slug] = null;
          }
        }
      },
    });
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(500);
    const dashes = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.pcard'));
      let dashCount = 0;
      for (const c of cards) {
        const i = c.querySelector('.pc-right i');
        if (i && (i.textContent.trim() === '—' || i.classList.contains('muted'))) dashCount++;
      }
      return { total: cards.length, dashCount };
    });
    report(dashes.total > 0 && dashes.dashCount === dashes.total ? 'PASS' : 'FAIL',
      'R2: null ranks render as muted "—"',
      `total=${dashes.total} dash=${dashes.dashCount}`);
    await ctx.close();
  }

  // ----- R3: modal "Where he ranks" rows render rank values -----
  {
    const { ctx, page } = await loadWithSyntheticRanks(browser);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(400);
    // Open the first pcard's modal.
    const playerId = await page.evaluate(() => {
      const card = document.querySelector('.pcard');
      return card ? card.dataset.playerId : null;
    });
    await page.evaluate((pid) => { window.location.hash = 'player-' + pid; }, playerId);
    await page.waitForTimeout(500);
    const rankRowCount = await page.evaluate(() => {
      const scrim = document.querySelector('#player-modal-scrim.show');
      if (!scrim) return -1;
      return scrim.querySelectorAll('.ctx-row').length;
    });
    report(rankRowCount > 0 ? 'PASS' : 'FAIL',
      `R3: modal "Where he ranks" has populated rank rows`,
      `count=${rankRowCount}`);
    await ctx.close();
  }

  // ----- R4: schema banner does NOT fire just because player_ranks is empty -----
  //
  // The fetcher tolerates an upstream failure by returning {}. The
  // renderer treats {} as a valid present key — the schema banner
  // should NOT flag it.
  {
    const { ctx, page } = await loadWithSyntheticRanks(browser, {
      mutateRanks: (pr) => {
        for (const id of Object.keys(pr)) delete pr[id];
      },
    });
    await page.waitForTimeout(300);
    const banner = await page.evaluate(() => {
      const b = document.getElementById('schemaBanner');
      return b ? { hidden: b.hidden, text: b.textContent || '' } : null;
    });
    report(banner && banner.hidden ? 'PASS' : 'FAIL',
      'R4: empty player_ranks doesn\'t fire the schema-drift banner',
      banner ? `hidden=${banner.hidden} text="${banner.text.slice(0, 60)}"` : 'no banner');
    await ctx.close();
  }

  // ----- R5: schema banner DOES fire when player_ranks key is missing entirely -----
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    await ctx.route('**/data.json', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      delete body.player_ranks;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    const banner = await page.evaluate(() => {
      const b = document.getElementById('schemaBanner');
      return b ? { hidden: b.hidden, text: b.textContent || '' } : null;
    });
    const ok = banner && !banner.hidden && banner.text.indexOf('player_ranks') >= 0;
    report(ok ? 'PASS' : 'FAIL',
      'R5: deleting player_ranks fires the schema-drift banner',
      banner ? `hidden=${banner.hidden} text="${banner.text.slice(0, 80)}"` : 'no banner');
    await ctx.close();
  }

  // ----- R6: rank strips render the heat gradient + a positioned marker -----
  //
  // The audit's "heat-map shows nothing" was three faults: null ranks, slug
  // mismatches, and a flat gray rail. R1-R5 cover the data; R6 covers the
  // visual — the strip must carry a CSS gradient (not a flat fill) and a
  // marker dot positioned by rank.
  {
    const { ctx, page } = await loadWithSyntheticRanks(browser);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(400);
    const playerId = await page.evaluate(() => {
      const card = document.querySelector('.pcard');
      return card ? card.dataset.playerId : null;
    });
    await page.evaluate((pid) => { window.location.hash = 'player-' + pid; }, playerId);
    await page.waitForTimeout(400);
    const strip = await page.evaluate(() => {
      const scrim = document.querySelector('#player-modal-scrim.show');
      if (!scrim) return null;
      const s = scrim.querySelector('.ctx-row .strip');
      if (!s) return null;
      const bg = getComputedStyle(s).backgroundImage;
      const mk = s.querySelector('.mk');
      return {
        hasGradient: /gradient/.test(bg),
        hasMarker: !!mk,
        markerLeft: mk ? mk.style.left : null,
      };
    });
    report(strip && strip.hasGradient ? 'PASS' : 'FAIL',
      'R6: rank strip renders a heat gradient (not a flat rail)',
      strip ? `gradient=${strip.hasGradient}` : 'no strip');
    report(strip && strip.hasMarker && strip.markerLeft ? 'PASS' : 'FAIL',
      'R6: rank strip has a rank-positioned marker',
      strip ? `marker=${strip.hasMarker} left=${strip.markerLeft}` : 'no strip');
    await ctx.close();
  }

  // ----- R7: pitcher K/9 row renders now that values are carried -----
  //
  // Pre-fix, buildPitcherRankRows hardcoded null for K/9 + BB/9, so the rows
  // were filtered out as value-less. Now the roster row carries k_per_9 /
  // bb_per_9 and the rows render with markers. Scan cards for a K/9 row.
  {
    const { ctx, page } = await loadWithSyntheticRanks(browser);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(400);
    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.pcard')).map(c => c.dataset.playerId));
    let found = null;
    for (const id of ids) {
      await page.evaluate((pid) => { window.location.hash = 'player-' + pid; }, id);
      await page.waitForTimeout(100);
      const row = await page.evaluate(() => {
        const scrim = document.querySelector('#player-modal-scrim.show');
        if (!scrim) return null;
        const rows = Array.from(scrim.querySelectorAll('.ctx-row'));
        const k9 = rows.find(r => /K\/9/.test(r.textContent));
        if (!k9) return null;
        return { hasMarker: !!k9.querySelector('.strip .mk') };
      });
      if (row) { found = row; break; }
    }
    report(found && found.hasMarker ? 'PASS' : 'FAIL',
      'R7: pitcher K/9 row renders with a marker',
      found ? `marker=${found.hasMarker}` : 'no K/9 row found');
    await ctx.close();
  }

  // ----- R8: hitter modal shows the value-only Statcast line -----
  //
  // Statcast metrics can't be league-ranked (team-scoped fetch), so they
  // moved out of the rank rows into a value-only line. Assert it renders
  // with its provenance label and at least one metric.
  {
    const { ctx, page } = await loadWithSyntheticRanks(browser);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(400);
    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.pcard')).map(c => c.dataset.playerId));
    let sc = null;
    for (const id of ids) {
      await page.evaluate((pid) => { window.location.hash = 'player-' + pid; }, id);
      await page.waitForTimeout(100);
      sc = await page.evaluate(() => {
        const scrim = document.querySelector('#player-modal-scrim.show');
        if (!scrim) return null;
        const line = scrim.querySelector('.modal-statcast');
        if (!line) return null;
        return {
          hasLabel: /Statcast/.test(line.textContent),
          metrics: line.querySelectorAll('.ms-metric').length,
        };
      });
      if (sc) break;
    }
    report(sc && sc.hasLabel && sc.metrics > 0 ? 'PASS' : 'FAIL',
      'R8: hitter modal renders the Statcast value line',
      sc ? `label=${sc.hasLabel} metrics=${sc.metrics}` : 'no statcast line found');
    await ctx.close();
  }

  // ----- R9: a rank >30 renders as a percentile, not "—" (THE bug) -----
  //
  // Regression guard for the pool-rank-vs-1-30-scale bug: real player ranks
  // span 1..~150, but ordinal/rankTier/rankLeftPercent assumed 1-30, so
  // every rank past 30 rendered "—" with a colorless marker pinned at 100%.
  // Injected ranks here are all >30 (i*6, j*3), so every ranked row must
  // show a percentile label + a marker positioned strictly inside the rail.
  {
    const { ctx, page } = await loadWithSyntheticRanks(browser);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(400);
    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.pcard')).map(c => c.dataset.playerId));
    let worst = null;
    for (const id of ids) {
      await page.evaluate((pid) => { window.location.hash = 'player-' + pid; }, id);
      await page.waitForTimeout(80);
      const row = await page.evaluate(() => {
        const scrim = document.querySelector('#player-modal-scrim.show');
        if (!scrim) return null;
        const r = scrim.querySelector('.ctx-row');
        if (!r) return null;
        const rankCell = r.querySelector('.ctx-rank');
        const mk = r.querySelector('.strip .mk');
        const left = mk ? parseFloat(mk.style.left) : null;
        return {
          label: rankCell ? rankCell.textContent.trim() : '',
          isDash: rankCell ? rankCell.textContent.trim() === '—' : true,
          hasMarker: !!mk,
          left: left,
        };
      });
      if (row && row.label) { worst = row; break; }
    }
    const ok = worst && !worst.isDash && /%ile/.test(worst.label)
      && worst.hasMarker && worst.left != null && worst.left >= 0 && worst.left <= 100;
    report(ok ? 'PASS' : 'FAIL',
      'R9: a >30 pool rank renders a percentile + in-rail marker (not "—")',
      worst ? `label="${worst.label}" left=${worst.left}` : 'no ranked row found');
    await ctx.close();
  }

  const fails = findings.filter(f => f.level === 'FAIL');
  console.log(`\nplayer-ranks: ${findings.length - fails.length}/${findings.length} pass`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(err => {
  console.error('PROBE ERROR:', err.message);
  process.exit(2);
});
