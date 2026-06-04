/* ============================================================
   Probe: bio fields + team.gb rendering
   F2 — Backend bio + GB + Statcast wiring (COG-366).

   Pre-F2 the renderer's modal meta line + Overview Record-KPI
   footer were already wired to read player.bats / player.throws /
   player.age / team.gb, but the fetcher never produced those
   fields, so the line silently compressed to "1B · 212 AB" and
   the KPI footer dropped the "8.5 GB" segment.

   The frontend code path didn't change in F2 — players.js:84-92
   (subtitle), players.js:188-198 (modal meta), and
   overview.js:104-105 (KPI footer) already conditionally render
   on these fields. This probe asserts those paths produce the
   right DOM when the fields ARE present (the post-F2 steady
   state) and gracefully compress when they're not.

   Run from repo root with a static server up at :8001:
     python3 -m http.server 8001 &
     NODE_PATH=/opt/node22/lib/node_modules node tests/probes/bio-and-gb.js
   ============================================================ */
const { chromium } = require('playwright');

const BASE = process.env.JT_BASE || 'http://localhost:8001/index-v2.html';
const findings = [];
const report = (level, name, detail) => {
  findings.push({ level, name, detail });
  console.log(`${level.padEnd(4)} ${name}${detail ? ' — ' + detail : ''}`);
};

async function loadPage(browser, dataMutator) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  await ctx.route('**/data.json', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    if (dataMutator) dataMutator(body);
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

  // ----- B1: team.gb renders in the Record KPI footer -----
  //
  // overview.js:104-105 builds " · 8.5 GB" when team.gb is truthy
  // and not "-". We inject team.gb = 8.5 and confirm the footer
  // contains the literal "8.5 GB" substring.
  {
    const { ctx, page } = await loadPage(browser, (d) => {
      d.team = d.team || {};
      d.team.gb = 8.5;
    });
    const footer = await page.evaluate(() => {
      // The Record KPI is the first `.kpi` card on the Overview tab.
      const kpi = document.querySelector('#tab-overview .kpi');
      if (!kpi) return null;
      const kf = kpi.querySelector('.kf');
      return kf ? kf.textContent.replace(/\s+/g, ' ').trim() : null;
    });
    const ok = footer && footer.indexOf('8.5 GB') >= 0;
    report(ok ? 'PASS' : 'FAIL',
      'B1: team.gb renders in Record KPI footer',
      `kf="${footer}"`);
    await ctx.close();
  }

  // ----- B2: gb omitted when team.gb is null or "-" -----
  //
  // First-place teams have gb == 0 or "-" depending on MLB.
  // overview.js's guard `team.gb && team.gb !== '-'` should hide
  // the " · 8.5 GB" segment.
  for (const [val, label] of [[null, 'null'], ['-', '"-"'], [0, '0']]) {
    const { ctx, page } = await loadPage(browser, (d) => {
      d.team = d.team || {};
      d.team.gb = val;
    });
    const footer = await page.evaluate(() => {
      const kpi = document.querySelector('#tab-overview .kpi');
      const kf = kpi ? kpi.querySelector('.kf') : null;
      return kf ? kf.textContent.replace(/\s+/g, ' ').trim() : null;
    });
    const hasGb = footer && /\d+\.?\d*\s*GB/.test(footer);
    report(!hasGb ? 'PASS' : 'FAIL',
      `B2: gb=${label} omits "GB" segment from Record KPI footer`,
      `kf="${footer}"`);
    await ctx.close();
  }

  // ----- B3: hitter modal meta line includes Bats + Age -----
  //
  // players.js:188-198 conditionally appends "Bats X" and "Age N"
  // segments. We inject bats="R" and age=27 onto the first hitter,
  // open their modal via hash, then assert the .meta text reads
  // "1B · Bats R · Age 27 · …" (or whatever pos prefixes).
  {
    let firstHitterId = null;
    const { ctx, page } = await loadPage(browser, (d) => {
      const h = (d.roster && d.roster.hitters) || [];
      if (h.length) {
        h[0].bats = 'R';
        h[0].age = 27;
        firstHitterId = h[0].id;
      }
    });
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(400);
    // Open the modal for the first hitter via hash.
    await page.evaluate((pid) => { window.location.hash = 'player-' + pid; }, firstHitterId);
    await page.waitForTimeout(500);
    const meta = await page.evaluate(() => {
      const scrim = document.querySelector('#player-modal-scrim.show');
      if (!scrim) return null;
      const m = scrim.querySelector('.meta');
      return m ? m.textContent.trim() : null;
    });
    const ok = meta
      && meta.indexOf('Bats R') >= 0
      && meta.indexOf('Age 27') >= 0;
    report(ok ? 'PASS' : 'FAIL',
      'B3: hitter modal meta line includes "Bats R · Age 27"',
      `meta="${meta}"`);
    await ctx.close();
  }

  // ----- B4: pitcher modal meta line includes Throws + Age -----
  {
    let firstPitcherId = null;
    const { ctx, page } = await loadPage(browser, (d) => {
      const p = (d.roster && d.roster.pitchers) || [];
      if (p.length) {
        p[0].throws = 'L';
        p[0].age = 35;
        firstPitcherId = p[0].id;
      }
    });
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(400);
    await page.evaluate((pid) => { window.location.hash = 'player-' + pid; }, firstPitcherId);
    await page.waitForTimeout(500);
    const meta = await page.evaluate(() => {
      const scrim = document.querySelector('#player-modal-scrim.show');
      if (!scrim) return null;
      const m = scrim.querySelector('.meta');
      return m ? m.textContent.trim() : null;
    });
    const ok = meta
      && meta.indexOf('Throws L') >= 0
      && meta.indexOf('Age 35') >= 0;
    report(ok ? 'PASS' : 'FAIL',
      'B4: pitcher modal meta line includes "Throws L · Age 35"',
      `meta="${meta}"`);
    await ctx.close();
  }

  // ----- B5: meta line compresses when bio fields are null -----
  //
  // The renderer guards each segment with a truthy check —
  // null/undefined fields are skipped, no "Bats null" or " ·  · "
  // artifacts.
  {
    let firstHitterId = null;
    const { ctx, page } = await loadPage(browser, (d) => {
      const h = (d.roster && d.roster.hitters) || [];
      if (h.length) {
        h[0].bats = null;
        h[0].age = null;
        firstHitterId = h[0].id;
      }
    });
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(400);
    await page.evaluate((pid) => { window.location.hash = 'player-' + pid; }, firstHitterId);
    await page.waitForTimeout(500);
    const meta = await page.evaluate(() => {
      const scrim = document.querySelector('#player-modal-scrim.show');
      if (!scrim) return null;
      const m = scrim.querySelector('.meta');
      return m ? m.textContent.trim() : null;
    });
    // The line must NOT contain "Bats", "Age", "null", "undefined",
    // or any " ·  · " (double-separator from a skipped segment).
    const bad = meta && (
      meta.indexOf('Bats') >= 0
      || meta.indexOf('Age') >= 0
      || meta.indexOf('null') >= 0
      || meta.indexOf('undefined') >= 0
      || /·\s+·/.test(meta)
    );
    report(meta && !bad ? 'PASS' : 'FAIL',
      'B5: null bio fields cleanly drop from meta line',
      `meta="${meta}"`);
    await ctx.close();
  }

  // ----- B6: hitter pcard subtitle reflects bats / age -----
  //
  // players.js:82-92 builds "pos · bats · age" for hitters. With
  // bats="L" / age=28 injected on the first hitter, we find that
  // player's pcard by data-player-id and assert the subtitle.
  {
    let firstHitterId = null;
    const { ctx, page } = await loadPage(browser, (d) => {
      const h = (d.roster && d.roster.hitters) || [];
      if (h.length) {
        h[0].bats = 'L';
        h[0].age = 28;
        firstHitterId = h[0].id;
      }
    });
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(500);
    const subtitle = await page.evaluate((pid) => {
      const card = document.querySelector('.pcard[data-player-id="' + pid + '"]');
      if (!card) return null;
      const sub = card.querySelector('.pc-id small');
      return sub ? sub.textContent.trim() : null;
    }, firstHitterId);
    // Subtitle joins parts with " · ". "L" + "28" should appear.
    const ok = subtitle
      && subtitle.indexOf('L') >= 0
      && subtitle.indexOf('28') >= 0;
    report(ok ? 'PASS' : 'FAIL',
      'B6: hitter pcard subtitle includes "bats · age"',
      `sub="${subtitle}"`);
    await ctx.close();
  }

  // ----- B7: gb=0 (division leader) renders cleanly in standings -----
  //
  // overview.js:475/490 renders `t.gb || '—'` for each row in the
  // division-standings panel. A gb=0 leader should show "—" (since
  // 0 is falsy) — not "0".
  {
    const { ctx, page } = await loadPage(browser, (d) => {
      if (d.division && d.division.length) {
        d.division[0].gb = '-';  // MLB leader marker
      }
    });
    // The standings table on Overview already renders on page load.
    const leaderGb = await page.evaluate(() => {
      const row = document.querySelector('.st-row');
      if (!row) return null;
      // Leader row carries the gb-tag span if is_us+gb-truthy, otherwise
      // the .rec span with W-L. Confirm no literal "0 GB" leaks through.
      return row.textContent;
    });
    report(leaderGb && leaderGb.indexOf('0 GB') < 0 ? 'PASS' : 'FAIL',
      'B7: gb="-" leader doesn\'t render literal "0 GB"',
      `text="${leaderGb && leaderGb.slice(0, 60)}"`);
    await ctx.close();
  }

  const fails = findings.filter(f => f.level === 'FAIL');
  console.log(`\nbio-and-gb: ${findings.length - fails.length}/${findings.length} pass`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(err => {
  console.error('PROBE ERROR:', err.message);
  process.exit(2);
});
