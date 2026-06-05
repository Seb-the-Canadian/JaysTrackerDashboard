/* ============================================================
   Probe: opponent context + opposing-pitcher modal (G3)

   The fetcher (fetch_all_standings / fetch_opposing_pitcher_lines) can't run
   in the interactive container — statsapi is blocked — so this probe
   route-intercepts data.json and injects synthetic opponent context +
   opponent_pitchers, then drives the frontend:

     O1  upcoming-game cards render the opponent context one-liner
     O2  the opposing probable is a clickable chip → opens #oppp-<id>
     O3  the opp-pitcher modal shows name + season line + Savant/MLB links
     O4  Esc closes the modal AND reverts the hash to #overview (NOT
         #players) — the modal-route coupling fix
     O5  focus returns to the triggering chip after close

   Run from repo root with a static server up at :8000:
     python3 -m http.server 8000 &
     NODE_PATH=/opt/node22/lib/node_modules node tests/probes/opponent-pitcher.js
   ============================================================ */
const { chromium } = require('playwright');

const BASE = process.env.JT_BASE || 'http://localhost:8000/index-v2.html';
const findings = [];
const report = (level, name, detail) => {
  findings.push({ level, name, detail });
  console.log(`${level.padEnd(4)} ${name}${detail ? ' — ' + detail : ''}`);
};

async function load(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  await ctx.route('**/data.json', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const ug = body.upcoming_games || [];
    body.opponent_pitchers = body.opponent_pitchers || {};
    ug.forEach((g, i) => {
      const pid = 900000 + i;
      g.opp_team_id = 110;
      g.opp_team_abbrev = 'BAL';
      g.probable_pitcher_them = 'Chris Bassitt';
      g.probable_pitcher_them_id = pid;
      g.opp_context = {
        team_id: 110, team: 'Baltimore Orioles', w: 30, l: 30, pct: '.500',
        gb: '8.0', streak: 'L2', last10: '4-6', division_rank: '3',
        division_name: 'AL East',
      };
      body.opponent_pitchers[String(pid)] = {
        id: pid, name: 'Chris Bassitt', throws: 'R', age: 36,
        era: '3.40', whip: '1.12', ip: '70.0', k: 78, gs: 12,
      };
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.evaluate(() => { window.location.hash = 'overview'; });
  await page.waitForFunction(() => {
    const ov = document.getElementById('tab-overview');
    return ov && !ov.querySelector('.panel-skeleton');
  }, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch();

  // ----- O1: opponent context one-liner on upcoming cards -----
  {
    const { ctx, page } = await load(browser);
    const ctxText = await page.evaluate(() => {
      const btn = document.querySelector('.opp-sp');
      if (!btn) return null;
      const game = btn.closest('.game');
      const small = game ? game.querySelector('.meta small') : null;
      return small ? small.textContent : null;
    });
    // En-dash (U+2013) is the typographic convention for the W–L record
    // separator; renderer normalizes the ASCII hyphen MLB ships (V15 audit
    // fix). Accept either glyph so the probe doesn't pin a single
    // representation of the same data.
    const ok = ctxText && /30[-–]30/.test(ctxText) && /AL East/.test(ctxText);
    report(ok ? 'PASS' : 'FAIL', 'O1: upcoming card shows opponent record + place',
      `text="${ctxText}"`);
    await ctx.close();
  }

  // ----- O2/O3: clickable chip opens the opp-pitcher modal with content -----
  {
    const { ctx, page } = await load(browser);
    await page.click('.opp-sp');
    await page.waitForTimeout(300);
    const modal = await page.evaluate(() => {
      const scrim = document.querySelector('#player-modal-scrim.show');
      if (!scrim) return null;
      const h3 = scrim.querySelector('#player-modal-title');
      const slash = scrim.querySelector('.slash-big');
      const links = Array.from(scrim.querySelectorAll('.ext-row a.ext-pill')).map((a) => ({
        text: a.textContent.trim(), href: a.getAttribute('href'),
        target: a.getAttribute('target'), rel: a.getAttribute('rel'),
      }));
      return {
        hash: window.location.hash,
        name: h3 ? h3.textContent : null,
        hasSlash: !!slash,
        tag: !!scrim.querySelector('.oppp-tag'),
        links,
      };
    });
    report(modal && /^#oppp-/.test(modal.hash) && modal.name === 'Chris Bassitt' ? 'PASS' : 'FAIL',
      'O2: chip click opens #oppp- modal for the pitcher',
      modal ? `hash=${modal.hash} name=${modal.name}` : 'no modal');
    const savant = modal && modal.links.find((l) => l.text === 'SAV');
    const linkOk = savant && /^https:\/\/baseballsavant\.mlb\.com\/savant-player\//.test(savant.href)
      && savant.target === '_blank' && savant.rel === 'noopener';
    report(modal && modal.hasSlash && modal.tag && linkOk ? 'PASS' : 'FAIL',
      'O3: modal has season line + provenance tag + safe Savant link',
      modal ? `slash=${modal.hasSlash} tag=${modal.tag} sav=${savant ? savant.href : '-'}` : 'no modal');
    await ctx.close();
  }

  // ----- O4/O5: Esc reverts to #overview (not #players) + restores focus ---
  {
    const { ctx, page } = await load(browser);
    await page.click('.opp-sp');
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => ({
      shown: !!document.querySelector('#player-modal-scrim.show'),
      hash: window.location.hash,
      focusIsChip: document.activeElement
        && document.activeElement.classList.contains('opp-sp'),
    }));
    report(!after.shown && after.hash === '#overview' ? 'PASS' : 'FAIL',
      'O4: Esc closes modal and reverts hash to #overview',
      `shown=${after.shown} hash=${after.hash}`);
    report(after.focusIsChip ? 'PASS' : 'FAIL',
      'O5: focus returns to the triggering chip', `focusIsChip=${after.focusIsChip}`);
    await ctx.close();
  }

  const fails = findings.filter((f) => f.level === 'FAIL');
  console.log(`\nopponent-pitcher: ${findings.length - fails.length}/${findings.length} pass`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((err) => {
  console.error('PROBE ERROR:', err.message);
  process.exit(2);
});
