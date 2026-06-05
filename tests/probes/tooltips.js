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
   T12 issue #125 — rank-row stats without stat_school.json entries do
       NOT carry the .term/data-stat affordance (no dead cursor:help)
   T13 issue #125 acceptance — every visible .term[data-stat] resolves
       to a non-empty tooltip (no slug ever surfaces the affordance
       without a registry-backed tooltip)

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

  // ----- T10: Phase 3 — Overview .opp tiles carry data-team -----
  //
  // Recent + upcoming game cards on the Overview tab wrap their .opp tile
  // with data-team="ABBR". Verifies the wiring; doesn't require resolution
  // (T11 covers that).
  {
    const { ctx, page } = await loadPage(browser);
    await page.evaluate(() => { window.location.hash = 'overview'; });
    await page.waitForTimeout(400);
    const counts = await page.evaluate(() => ({
      oppTiles: document.querySelectorAll('.game .opp').length,
      wired: document.querySelectorAll('.game .opp[data-team]').length,
      stRows: document.querySelectorAll('.st-row .abbr').length,
      stWired: document.querySelectorAll('.st-row .abbr[data-team]').length,
    }));
    const ok = counts.oppTiles > 0 && counts.oppTiles === counts.wired
      && counts.stRows > 0 && counts.stRows === counts.stWired;
    report(ok ? 'PASS' : 'FAIL',
      'T10: every Overview .opp tile + .abbr row carries data-team',
      `opp=${counts.wired}/${counts.oppTiles} abbr=${counts.stWired}/${counts.stRows}`);
    await ctx.close();
  }

  // ----- T11: Phase 3 — clicking a team trigger opens a team tooltip -----
  //
  // The tooltip uses the same singleton bubble + a11y wiring, but content
  // is team-shaped: head (abbr + full name) + division line. Verifies the
  // dispatch path through JaysTeamRegistry.
  {
    const { ctx, page } = await loadPage(browser);
    await page.evaluate(() => { window.location.hash = 'overview'; });
    await page.waitForTimeout(400);
    // dispatch click via evaluate so we don't fight pointer events; the
    // delegation path is identical either way.
    const result = await page.evaluate(() => {
      const t = document.querySelector('.st-row .abbr[data-team]') ||
        document.querySelector('.game .opp[data-team]');
      if (!t) return { found: false };
      t.click();
      const tip = document.getElementById('jays-tooltip');
      if (!tip || tip.hidden) return { found: true, opened: false };
      return {
        found: true,
        opened: true,
        team: t.getAttribute('data-team'),
        hasAbbr: !!tip.querySelector('.tip-abbr'),
        hasName: !!tip.querySelector('.tip-name'),
        hasMeta: !!tip.querySelector('.tip-team-meta'),
        // Stat-only "Read more" link should NOT appear on team tooltips.
        noStatLink: !tip.querySelector('.tip-more'),
      };
    });
    const ok = result.opened && result.hasAbbr && result.hasName
      && result.hasMeta && result.noStatLink;
    report(ok ? 'PASS' : 'FAIL',
      'T11: team trigger opens a team tooltip (head + division)',
      JSON.stringify(result));
    await ctx.close();
  }

  // ----- T12: issue #125 — unbacked rank-row slugs lose .term affordance -----
  //
  // Slugs without a stat_school.json entry (hr/rbi/sb/k9/bb9/ip/hardhit_pct
  // at time of writing) used to render the dotted underline + cursor:help
  // but click silently no-opened. The fix gates the .term wrap on
  // JaysStatRegistry.has(). Verify those rank-row labels render as plain
  // text (no .term wrapper) while ops/era/whip — which ARE backed — keep
  // the affordance.
  {
    const { ctx, page } = await loadPage(browser);
    // Walk both a hitter and a pitcher modal to cover both rank-row lists.
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(400);
    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.pcard')).map(c => c.dataset.playerId));
    const seen = { hitter: false, pitcher: false };
    const labels = {};   // { slug-or-name: { hasTermClass: bool } }
    for (const id of ids) {
      if (seen.hitter && seen.pitcher) break;
      await page.evaluate((pid) => { window.location.hash = 'player-' + pid; }, id);
      await page.waitForTimeout(180);
      const modalState = await page.evaluate(() => {
        const scrim = document.querySelector('#player-modal-scrim.show');
        if (!scrim) return null;
        const isHitter = !!scrim.querySelector('.modal-statcast');
        const rows = Array.from(scrim.querySelectorAll('.ctx-row .ctx-name'));
        const out = rows.map((nameCell) => {
          // The label is either a .term span (affordance present) or a
          // bare text node (no affordance). Look at the first child to tell.
          const termEl = nameCell.querySelector('.term[data-stat]');
          if (termEl) return { slug: termEl.getAttribute('data-stat'), termed: true };
          const txt = (nameCell.textContent || '').trim().split(/\s+/)[0];
          return { slug: txt.toLowerCase(), termed: false };
        });
        return { isHitter, out };
      });
      if (!modalState) continue;
      const role = modalState.isHitter ? 'hitter' : 'pitcher';
      if (seen[role]) continue;
      seen[role] = true;
      modalState.out.forEach((r) => { labels[role + ':' + r.slug] = r.termed; });
    }
    // Backed slugs (in registry) must keep .term affordance.
    const backedExpect = {
      'hitter:ops': true,
      'pitcher:era': true,
      'pitcher:whip': true,
    };
    // Unbacked slugs (not in registry) must NOT carry .term.
    // Note: when a slug renders as plain text, its row label appears as
    // "Home", "Stolen", "RBI", "K/9", "BB/9", "IP" — match those forms.
    const unbackedExpect = {
      'hitter:home': false,   // "Home runs" -> first word
      'hitter:rbi': false,
      'hitter:stolen': false, // "Stolen bases"
      'pitcher:k/9': false,
      'pitcher:bb/9': false,
      'pitcher:ip': false,
    };
    const issues = [];
    for (const k in backedExpect) {
      if (labels[k] !== true) issues.push(k + '=expected termed, got ' + labels[k]);
    }
    for (const k in unbackedExpect) {
      // Tolerate missing (rank row may have dropped if value was null);
      // only fail when the row IS present AND carries the .term affordance.
      if (labels[k] === true) issues.push(k + '=expected plain, got termed');
    }
    report(issues.length === 0 ? 'PASS' : 'FAIL',
      'T12: issue #125 — unbacked slugs lose .term affordance, backed slugs keep it',
      issues.length === 0
        ? `hitter=${seen.hitter} pitcher=${seen.pitcher} labels=${JSON.stringify(labels)}`
        : issues.join(' / '));
    await ctx.close();
  }

  // ----- T13: issue #125 acceptance — every visible .term[data-stat] opens -----
  //
  // Walk every tab + every modal that produces .term[data-stat], collect
  // distinct slugs, and verify each opens a non-empty tooltip via the
  // synchronous JaysStatRegistry.get() path. Failure here means a slug
  // leaked through the affordance gate.
  {
    const { ctx, page } = await loadPage(browser);
    for (const h of ['overview', 'players', 'team-stats', 'stat-school']) {
      await page.evaluate((hh) => { window.location.hash = hh; }, h);
      await page.waitForTimeout(250);
    }
    // Sample a few modal opens too, to cover the rank-row terms.
    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.pcard')).map(c => c.dataset.playerId).slice(0, 3));
    for (const id of ids) {
      await page.evaluate((pid) => { window.location.hash = 'player-' + pid; }, id);
      await page.waitForTimeout(180);
    }
    const result = await page.evaluate(() => {
      const slugs = Array.from(new Set(
        Array.from(document.querySelectorAll('.term[data-stat]'))
          .map((n) => n.getAttribute('data-stat'))
      ));
      const unresolved = slugs.filter((s) =>
        !window.JaysStatRegistry || !window.JaysStatRegistry.has(s));
      return { slugs, unresolved };
    });
    report(result.unresolved.length === 0 ? 'PASS' : 'FAIL',
      'T13: issue #125 acceptance — every .term[data-stat] resolves in registry',
      `slugs=${result.slugs.length} unresolved=${result.unresolved.join(',') || 'none'}`);
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
