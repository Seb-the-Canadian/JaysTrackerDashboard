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

   Run from repo root with a static server up at :8001:
     python3 -m http.server 8001 &
     NODE_PATH=/opt/node22/lib/node_modules node tests/probes/player-ranks.js
   ============================================================ */
const { chromium } = require('playwright');

const BASE = process.env.JT_BASE || 'http://localhost:8001/index-v2.html';
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
    // Inject synthetic player_ranks for every roster member.
    body.player_ranks = body.player_ranks || {};
    const roster = (body.roster || {});
    let i = 1;
    for (const h of (roster.hitters || [])) {
      body.player_ranks[String(h.id)] = {
        ops: i, avg: i, obp: i, slg: i, runs: i, hr: i,
      };
      i++;
    }
    let j = 1;
    for (const p of (roster.pitchers || [])) {
      body.player_ranks[String(p.id)] = {
        era: j, whip: j, k9: j, bb9: j,
      };
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
    const ordinalRegex = /^(1st|2nd|3rd|\d+th)$/;
    report(firstCardRank && ordinalRegex.test(firstCardRank) ? 'PASS' : 'FAIL',
      'R1: first pcard renders a rank ordinal',
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

  const fails = findings.filter(f => f.level === 'FAIL');
  console.log(`\nplayer-ranks: ${findings.length - fails.length}/${findings.length} pass`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(err => {
  console.error('PROBE ERROR:', err.message);
  process.exit(2);
});
