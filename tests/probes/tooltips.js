/* ============================================================
   Probe: stat tooltips (#114 Phase 1)

   v2 inherited v1's dotted-term affordance (`cursor: help`) but dropped
   the click-to-open behavior. Issue #114 restored it, sourced from
   stat_school.json via JaysStatRegistry. This probe asserts the wiring:

     T1  click on a wired .term[data-stat] opens the singleton tooltip
         with non-empty content
     T2  the tooltip carries head/abbr + definition + "Read more" link
     T3  Esc closes and restores focus to the trigger
     T4  click-outside closes
     T5  the "Read more" link deep-links to #stat-<slug>
     T6  REGRESSION GUARD — no .term[data-stat] exists without working
         tooltip wiring (no dead cursor:help affordance)
     T7  a11y — open tooltip wires aria-describedby; close removes it

   Run from repo root with a static server up at :8000:
     python3 -m http.server 8000 &
     NODE_PATH=/opt/node22/lib/node_modules node tests/probes/tooltips.js
   ============================================================ */
const { chromium } = require('playwright');

const BASE = process.env.JT_BASE || 'http://localhost:8000/index-v2.html';
const findings = [];
const report = (level, name, detail) => {
  findings.push({ level, name, detail });
  console.log(`${level.padEnd(4)} ${name}${detail ? ' — ' + detail : ''}`);
};

async function loadPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  // Inject player_ranks + pool so the modal rank rows (where most .term
  // affordances live) actually render — see player-ranks.js probe.
  await ctx.route('**/data.json', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.player_rank_pool = body.player_rank_pool || { hitting: 160, pitching: 90 };
    body.player_ranks = body.player_ranks || {};
    body.opponent_pitchers = body.opponent_pitchers || {};
    let i = 1;
    for (const h of (body.roster && body.roster.hitters || [])) {
      const r = i * 6;
      body.player_ranks[String(h.id)] = { ops: r, hr: r, rbi: r, sb: r };
      // T9 requires xwoba to be a non-placeholder for the Statcast line
      // to render its label — buildStatcastLine filters placeholders out.
      if (!h.xwoba || h.xwoba === '.---') h.xwoba = '.358';
      if (!h.barrel_pct || h.barrel_pct === '---') h.barrel_pct = '11.4%';
      if (!h.hardhit_pct || h.hardhit_pct === '---') h.hardhit_pct = '49.2%';
      i++;
    }
    let j = 1;
    for (const p of (body.roster && body.roster.pitchers || [])) {
      const r = j * 3;
      body.player_ranks[String(p.id)] = {
        era: r, whip: r, k_per_9: r, bb_per_9: r, ip: r,
      };
      if (!p.k_per_9 || p.k_per_9 === '-.--') p.k_per_9 = '9.50';
      if (!p.bb_per_9 || p.bb_per_9 === '-.--') p.bb_per_9 = '2.30';
      j++;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForFunction(() => {
    const ov = document.getElementById('tab-overview');
    return ov && !ov.querySelector('.panel-skeleton');
  }, null, { timeout: 6000 }).catch(() => {});
  // stat_school.json loads on first tooltip event; pre-warm by waiting
  // until the registry resolves so T1 doesn't race the fetch.
  await page.waitForFunction(() =>
    window.JaysStatRegistry && window.JaysStatRegistry.load().then(() => true),
    null, { timeout: 5000 }).catch(() => {});
  return { ctx, page };
}

// Open the first ranked modal (hitter or pitcher) and return the slug of
// its first .term[data-stat] rank row. Most tests just need a working
// term; T8 explicitly needs a hitter and uses openHitterModal below.
async function openAnyTermInModal(page) {
  await page.evaluate(() => { window.location.hash = 'players'; });
  await page.waitForTimeout(400);
  const ids = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.pcard')).map(c => c.dataset.playerId));
  for (const id of ids) {
    await page.evaluate((pid) => { window.location.hash = 'player-' + pid; }, id);
    await page.waitForTimeout(180);
    const slug = await page.evaluate(() => {
      const t = document.querySelector('#player-modal-scrim.show .ctx-row .term[data-stat]');
      return t ? t.getAttribute('data-stat') : null;
    });
    if (slug) return slug;
  }
  return null;
}

// Open a hitter modal specifically. Hitter modals carry .modal-statcast
// (pitcher modals don't), so iterate cards until one renders with that.
async function openHitterModal(page) {
  await page.evaluate(() => { window.location.hash = 'players'; });
  await page.waitForTimeout(400);
  const ids = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.pcard')).map(c => c.dataset.playerId));
  for (const id of ids) {
    await page.evaluate((pid) => { window.location.hash = 'player-' + pid; }, id);
    await page.waitForTimeout(180);
    const isHitter = await page.evaluate(() =>
      !!document.querySelector('#player-modal-scrim.show .modal-statcast'));
    if (isHitter) return id;
  }
  return null;
}

(async () => {
  const browser = await chromium.launch();

  // ----- T1: click opens tooltip with content -----
  {
    const { ctx, page } = await loadPage(browser);
    const slug = await openAnyTermInModal(page);
    await page.click('#player-modal-scrim.show .ctx-row .term[data-stat]');
    await page.waitForTimeout(200);
    const tip = await page.evaluate(() => {
      const t = document.getElementById('jays-tooltip');
      return t && !t.hidden
        ? { visible: true, hasContent: t.innerHTML.trim().length > 0 }
        : { visible: false, hasContent: false };
    });
    report(tip.visible && tip.hasContent ? 'PASS' : 'FAIL',
      'T1: click on .term opens tooltip with content',
      `slug=${slug} visible=${tip.visible} hasContent=${tip.hasContent}`);
    await ctx.close();
  }

  // ----- T2: tooltip carries head + definition + Read more -----
  {
    const { ctx, page } = await loadPage(browser);
    await openAnyTermInModal(page);
    await page.click('#player-modal-scrim.show .ctx-row .term[data-stat]');
    await page.waitForTimeout(200);
    const parts = await page.evaluate(() => {
      const t = document.getElementById('jays-tooltip');
      if (!t || t.hidden) return null;
      return {
        head: !!t.querySelector('.tip-head'),
        abbr: !!t.querySelector('.tip-abbr'),
        def: !!t.querySelector('.tip-def'),
        more: !!t.querySelector('.tip-more'),
      };
    });
    const ok = parts && parts.head && parts.abbr && parts.def && parts.more;
    report(ok ? 'PASS' : 'FAIL',
      'T2: tooltip has head/abbr/definition/Read more',
      parts ? JSON.stringify(parts) : 'no tooltip');
    await ctx.close();
  }

  // ----- T3: Esc closes + restores focus -----
  {
    const { ctx, page } = await loadPage(browser);
    await openAnyTermInModal(page);
    await page.click('#player-modal-scrim.show .ctx-row .term[data-stat]');
    await page.waitForTimeout(200);
    // Give the trigger focus so Esc's restore is observable.
    await page.evaluate(() => {
      const t = document.querySelector('#player-modal-scrim.show .ctx-row .term[data-stat]');
      if (t) t.focus();
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => ({
      hidden: document.getElementById('jays-tooltip').hidden,
      focusOnTerm: document.activeElement &&
        document.activeElement.classList.contains('term') &&
        document.activeElement.hasAttribute('data-stat'),
    }));
    report(after.hidden && after.focusOnTerm ? 'PASS' : 'FAIL',
      'T3: Esc closes tooltip + restores focus to trigger',
      `hidden=${after.hidden} focusOnTerm=${after.focusOnTerm}`);
    await ctx.close();
  }

  // ----- T4: click outside closes -----
  {
    const { ctx, page } = await loadPage(browser);
    await openAnyTermInModal(page);
    await page.click('#player-modal-scrim.show .ctx-row .term[data-stat]');
    await page.waitForTimeout(150);
    // Dispatch a click on document.body at a coordinate guaranteed to be
    // outside both the trigger and the tooltip — page.click would refuse
    // because Playwright sees a stacked tooltip over candidate targets.
    // The handler reads e.target and verifies it isn't inside #jays-tooltip
    // or any .term, so a body-level synthetic click exercises the same code
    // path as a real outside-click without the stacking complication.
    await page.evaluate(() => {
      const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
      document.body.dispatchEvent(evt);
    });
    await page.waitForTimeout(150);
    const hidden = await page.evaluate(() => document.getElementById('jays-tooltip').hidden);
    report(hidden ? 'PASS' : 'FAIL', 'T4: click outside closes tooltip', `hidden=${hidden}`);
    await ctx.close();
  }

  // ----- T5: Read more deep-links to #stat-<slug> -----
  {
    const { ctx, page } = await loadPage(browser);
    const slug = await openAnyTermInModal(page);
    await page.click('#player-modal-scrim.show .ctx-row .term[data-stat]');
    await page.waitForTimeout(150);
    const href = await page.evaluate(() => {
      const a = document.querySelector('#jays-tooltip .tip-more');
      return a ? a.getAttribute('href') : null;
    });
    const ok = href && new RegExp('^#stat-' + slug + '$').test(href);
    report(ok ? 'PASS' : 'FAIL',
      'T5: Read more href points at #stat-<slug>',
      `slug=${slug} href=${href}`);
    await ctx.close();
  }

  // ----- T6: regression guard — no .term[data-stat] exists without tabindex -----
  //
  // The tooltip module attaches tabindex="0" to every .term[data-stat] so
  // they're keyboard-focusable. If a renderer adds new .term[data-stat]
  // sites and the MutationObserver path is broken, this fires.
  {
    const { ctx, page } = await loadPage(browser);
    // Walk all tabs so every renderer's .term elements get a chance to mount.
    for (const h of ['overview', 'players', 'team-stats', 'stat-school']) {
      await page.evaluate((hh) => { window.location.hash = hh; }, h);
      await page.waitForTimeout(250);
    }
    const missing = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('.term[data-stat]'));
      return nodes.filter((n) => !n.hasAttribute('tabindex')).length;
    });
    const counts = await page.evaluate(() => ({
      total: document.querySelectorAll('.term[data-stat]').length,
      focusable: document.querySelectorAll('.term[data-stat][tabindex]').length,
    }));
    report(missing === 0 && counts.total > 0 ? 'PASS' : 'FAIL',
      'T6: every .term[data-stat] is keyboard-focusable',
      `total=${counts.total} focusable=${counts.focusable}`);
    await ctx.close();
  }

  // ----- T7: aria-describedby wired on open, removed on close -----
  {
    const { ctx, page } = await loadPage(browser);
    await openAnyTermInModal(page);
    await page.click('#player-modal-scrim.show .ctx-row .term[data-stat]');
    await page.waitForTimeout(150);
    const opened = await page.evaluate(() => {
      const t = document.querySelector('#player-modal-scrim.show .ctx-row .term[data-stat]');
      return t ? t.getAttribute('aria-describedby') : null;
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const closed = await page.evaluate(() => {
      const t = document.querySelector('#player-modal-scrim.show .ctx-row .term[data-stat]');
      return t ? t.getAttribute('aria-describedby') : null;
    });
    report(opened === 'jays-tooltip' && closed === null ? 'PASS' : 'FAIL',
      'T7: aria-describedby wired on open, removed on close',
      `opened=${opened} closed=${closed}`);
    await ctx.close();
  }

  // ----- T8: Phase 2 — slash-line labels are tooltip-wrapped -----
  //
  // The hitter modal slash line (AVG/OBP/SLG/OPS) and the pitcher slash
  // line (ERA/WHIP, K/W-L unwrapped) should expose .term[data-stat] on
  // the documented stats. Asserts the wiring; doesn't require all four —
  // some players may render only a subset.
  {
    const { ctx, page } = await loadPage(browser);
    await openHitterModal(page);
    const found = await page.evaluate(() => {
      const slash = document.querySelector('#player-modal-scrim.show .slash-big');
      if (!slash) return null;
      return Array.from(slash.querySelectorAll('.term[data-stat]'))
        .map((t) => t.getAttribute('data-stat'));
    });
    const expected = ['avg', 'obp', 'slg', 'ops'];
    const missing = expected.filter((s) => !(found || []).includes(s));
    report(found && missing.length === 0 ? 'PASS' : 'FAIL',
      'T8: hitter slash line labels wired with data-stat',
      `found=${(found || []).join(',')} missing=${missing.join(',')}`);
    await ctx.close();
  }

  // ----- T9: Phase 2 — Statcast value line labels are tooltip-wrapped -----
  //
  // xwOBA and Barrel% have stat_school.json entries → .term[data-stat].
  // Hard-hit% has no entry yet, so it stays plain text (silent no-op).
  {
    const { ctx, page } = await loadPage(browser);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(400);
    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.pcard')).map((c) => c.dataset.playerId));
    let found = null;
    for (const id of ids) {
      await page.evaluate((pid) => { window.location.hash = 'player-' + pid; }, id);
      await page.waitForTimeout(150);
      found = await page.evaluate(() => {
        const line = document.querySelector('#player-modal-scrim.show .modal-statcast');
        if (!line) return null;
        return Array.from(line.querySelectorAll('.term[data-stat]'))
          .map((t) => t.getAttribute('data-stat'));
      });
      if (found && found.length) break;
    }
    const ok = found && found.includes('xwoba') && found.includes('barrel_pct');
    report(ok ? 'PASS' : 'FAIL',
      'T9: Statcast value line wires xwoba + barrel_pct labels',
      found ? `slugs=${found.join(',')}` : 'no Statcast line found');
    await ctx.close();
  }

  const fails = findings.filter((f) => f.level === 'FAIL');
  console.log(`\ntooltips: ${findings.length - fails.length}/${findings.length} pass`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((err) => {
  console.error('PROBE ERROR:', err.message);
  process.exit(2);
});
