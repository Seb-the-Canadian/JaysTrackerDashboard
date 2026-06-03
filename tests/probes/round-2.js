// Round 2 bug hunt: gaps from round 1 + deeper code paths.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:8000/index-v2.html';
const OUT = '/tmp/v2-shots';
fs.mkdirSync(OUT, { recursive: true });

const findings = [];
function report(level, name, detail) {
  const line = `${level.padEnd(4)} ${name}${detail ? ' — ' + detail : ''}`;
  findings.push(line);
  console.log(line);
}

(async () => {
  const browser = await chromium.launch();

  // ============================================================
  // R2.1: Direct landing on #stat-xwoba (fresh page load with hash)
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE + '#stat-xwoba');
    await page.waitForTimeout(1200);
    const activeTab = await page.$eval('.tab.active', el => el.dataset.tab);
    const scrollY = await page.evaluate(() => window.scrollY);
    report(activeTab === 'stat-school' && scrollY > 0 ? 'PASS' : 'FAIL',
      'r2.1: direct-land #stat-xwoba activates Stat School + scrolls',
      `activeTab=${activeTab}, scrollY=${scrollY}`);
    if (errs.length) report('FAIL', 'r2.1: JS errors on direct-land', errs.join(' | '));
    await ctx.close();
  }

  // ============================================================
  // R2.2: Direct landing on #player-<id>
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE + '#player-665926');
    await page.waitForTimeout(1200);
    const modalVisible = await page.$('.modal-scrim.show').then(el => !!el);
    report(modalVisible ? 'PASS' : 'FAIL',
      'r2.2: direct-land #player-<id> opens modal');
    if (errs.length) report('FAIL', 'r2.2: JS errors', errs.join(' | '));
    await ctx.close();
  }

  // ============================================================
  // R2.3: Direct landing on UNKNOWN hash (e.g. #garbage)
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE + '#garbage');
    await page.waitForTimeout(800);
    const activeTab = await page.$eval('.tab.active', el => el.dataset.tab);
    report(activeTab === 'overview' ? 'PASS' : 'FAIL',
      'r2.3: unknown hash falls back to overview',
      `activeTab=${activeTab}`);
    if (errs.length) report('FAIL', 'r2.3: JS errors', errs.join(' | '));
    await ctx.close();
  }

  // ============================================================
  // R2.4: Theme toggle WHILE modal is open
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(300);
    const card = await page.$('.pcard');
    await card.click();
    await page.waitForTimeout(300);
    // Toggle theme with modal open
    await page.$eval('#theme-toggle', el => el.click());
    await page.waitForTimeout(200);
    const modalStillOpen = await page.$('.modal-scrim.show').then(el => !!el);
    const themeIsDark = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    report(modalStillOpen && themeIsDark === 'dark' ? 'PASS' : 'FAIL',
      'r2.4: theme toggle while modal open keeps modal + switches theme',
      `modal=${modalStillOpen}, theme=${themeIsDark}`);
    // Modal should still close normally
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const closedAfter = await page.$('.modal-scrim.show').then(el => !el);
    report(closedAfter ? 'PASS' : 'FAIL', 'r2.4: modal still Esc-closeable after theme toggle');
    await ctx.close();
  }

  // ============================================================
  // R2.5: Open modal A → close → open modal B → check focus returns
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(300);
    const cards = await page.$$('.pcard');
    if (cards.length >= 2) {
      const cardId0 = await cards[0].evaluate(c => c.dataset.playerId);
      const cardId2 = await cards[2].evaluate(c => c.dataset.playerId);

      // Open A
      await cards[0].click();
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      const focused1 = await page.evaluate(() => document.activeElement?.dataset?.playerId);
      report(focused1 === cardId0 ? 'PASS' : 'WARN',
        'r2.5: focus returns to trigger after first modal close',
        `expected=${cardId0}, got=${focused1}`);

      // Open B via different card
      await cards[2].click();
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      const focused2 = await page.evaluate(() => document.activeElement?.dataset?.playerId);
      report(focused2 === cardId2 ? 'PASS' : 'WARN',
        'r2.5: focus returns to second card after second modal close',
        `expected=${cardId2}, got=${focused2}`);
    }
    await ctx.close();
  }

  // ============================================================
  // R2.6: Multiple rapid modal opens — event listener leak check
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(300);
    // Open + close 5 times rapidly
    for (let i = 0; i < 5; i++) {
      const card = await page.$('.pcard');
      await card.click();
      await page.waitForTimeout(120);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
    }
    // Now press Escape with no modal open — should be a no-op, not a stale handler firing
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    // Check that no scrim is in DOM (or only one — original)
    const scrimCount = await page.$$eval('.modal-scrim', els => els.length);
    report(scrimCount <= 1 && errs.length === 0 ? 'PASS' : 'WARN',
      'r2.6: no duplicate scrims or stale handlers after 5 open/close cycles',
      `scrims=${scrimCount}, errs=${errs.length}`);
    await ctx.close();
  }

  // ============================================================
  // R2.7: Team Stats toggle state — does it persist on tab switch?
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.location.hash = 'team-stats'; });
    await page.waitForTimeout(300);
    // Switch to Pitching
    await page.$$eval('.seg button', els => {
      const p = els.find(e => e.textContent === 'Pitching');
      p && p.click();
    });
    await page.waitForTimeout(200);
    // Switch to Overview then back
    await page.evaluate(() => { window.location.hash = 'overview'; });
    await page.waitForTimeout(200);
    await page.evaluate(() => { window.location.hash = 'team-stats'; });
    await page.waitForTimeout(300);
    const currentLabel = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h3'))
        .map(h => h.textContent).find(t => /full line/.test(t))
    );
    const onButton = await page.$eval('.seg button.on', el => el.textContent);
    report(currentLabel.includes('Hitting') && onButton === 'Hitting' ? 'WARN' : 'PASS',
      'r2.7: Team Stats toggle state — Pitching choice persists on tab return',
      `currentLabel="${currentLabel}", on="${onButton}"`);
    // Note: per current code, CURRENT_GROUP is module-level so should persist
    await ctx.close();
  }

  // ============================================================
  // R2.8: Browser back button after navigation
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(200);
    await page.evaluate(() => { window.location.hash = 'team-stats'; });
    await page.waitForTimeout(200);
    await page.goBack();
    await page.waitForTimeout(300);
    const back1Active = await page.$eval('.tab.active', el => el.dataset.tab).catch(() => null);
    report(back1Active === 'players' ? 'PASS' : 'WARN',
      'r2.8a: back button restores Players tab',
      `active=${back1Active}`);
    await page.goBack();
    await page.waitForTimeout(300);
    const back2Active = await page.$eval('.tab.active', el => el.dataset.tab).catch(() => null);
    report(back2Active === 'overview' ? 'PASS' : 'WARN',
      'r2.8b: back button restores Overview tab',
      `active=${back2Active}`);
    await ctx.close();
  }

  // ============================================================
  // R2.9: Modal opened, then browser back — does modal close?
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(300);
    await page.$eval('.pcard', el => el.click());
    await page.waitForTimeout(300);
    const modalOpen = await page.$('.modal-scrim.show').then(el => !!el);
    await page.goBack();
    await page.waitForTimeout(400);
    const modalClosed = await page.$('.modal-scrim.show').then(el => !el);
    report(modalOpen && modalClosed ? 'PASS' : 'WARN',
      'r2.9: browser back closes modal',
      `wasOpen=${modalOpen}, nowClosed=${modalClosed}`);
    await ctx.close();
  }

  // ============================================================
  // R2.10: Edge data — config.json with all 3 colors set differently
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.route('**/config.json', async (route) => {
      const real = await route.fetch();
      const cfg = await real.json();
      cfg.primary_color = '#C41E3A'; // STL red
      cfg.secondary_color = '#FEDB00'; // STL yellow
      cfg.accent_color = '#0C2340'; // STL navy
      cfg.dashboard_title = 'Cardinals Tracker';
      route.fulfill({ body: JSON.stringify(cfg), contentType: 'application/json' });
    });
    await page.goto(BASE);
    await page.waitForTimeout(800);
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--team-primary').trim()
    );
    const ink = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--team-primary-ink').trim()
    );
    const title = await page.$eval('#brand-title', el => el.textContent);
    report(primary === '#C41E3A' && title === 'Cardinals Tracker' ? 'PASS' : 'FAIL',
      'r2.10: STL red palette applied + dashboard_title used',
      `primary=${primary}, ink=${ink}, title="${title}"`);
    // Capture for visual check
    await page.screenshot({ path: path.join(OUT, 'r2-stl-palette.png'), fullPage: false });
    await ctx.close();
  }

  // ============================================================
  // R2.11: Edge data — fabricated player with all stats null
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.route('**/data.json', async (route) => {
      const real = await route.fetch();
      const data = await real.json();
      data.roster.hitters[0] = {
        id: 999999, name: 'Null Hitter', pos: '1B',
        ab: null, avg: null, obp: null, slg: null, ops: null,
        xwoba: null, barrel_pct: null, hardhit_pct: null,
        hr: null, rbi: null, sb: null, recent: null,
      };
      route.fulfill({ body: JSON.stringify(data), contentType: 'application/json' });
    });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE);
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(300);
    if (errs.length === 0) report('PASS', 'r2.11: all-null player renders without JS errors');
    else report('FAIL', 'r2.11: JS errors on null player', errs.join(' | '));
    // Open the null player's modal
    const nullCard = await page.$('button[data-player-id="999999"]');
    if (nullCard) {
      await nullCard.click();
      await page.waitForTimeout(300);
      const modalOpen = await page.$('.modal-scrim.show').then(el => !!el);
      report(modalOpen && errs.length === 0 ? 'PASS' : 'WARN',
        'r2.11b: null player modal opens without errors',
        `modal=${modalOpen}, errs=${errs.length}`);
    }
    await ctx.close();
  }

  // ============================================================
  // R2.12: Edge data — data.json missing top-level keys
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.route('**/data.json', async (route) => {
      // Strip everything except team
      route.fulfill({ body: JSON.stringify({
        as_of: '2026-06-02T09:00:00Z',
        team: { record: { w: 30, l: 30 }, place: '4th in AL East' }
      }), contentType: 'application/json' });
    });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE);
    await page.waitForTimeout(800);
    if (errs.length === 0) report('PASS', 'r2.12: data.json with only team renders without JS errors');
    else report('FAIL', 'r2.12: skeletal data.json causes JS errors', errs.join(' | '));
    // Try clicking through tabs
    for (const tab of ['players', 'team-stats', 'stat-school']) {
      await page.evaluate((t) => { window.location.hash = t; }, tab);
      await page.waitForTimeout(200);
    }
    if (errs.length === 0) report('PASS', 'r2.12b: all tabs render with skeletal data');
    else report('FAIL', 'r2.12b: tab switch on skeletal data errored', errs.join(' | '));
    await ctx.close();
  }

  // ============================================================
  // R2.13: HTML structural validity — duplicate IDs?
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    // Activate all tabs at least once so all DOM is built
    for (const tab of ['players', 'team-stats', 'stat-school', 'overview']) {
      await page.evaluate((t) => { window.location.hash = t; }, tab);
      await page.waitForTimeout(300);
    }
    const dupIds = await page.evaluate(() => {
      const seen = new Map();
      document.querySelectorAll('[id]').forEach(el => {
        const id = el.id;
        seen.set(id, (seen.get(id) || 0) + 1);
      });
      return Array.from(seen.entries()).filter(([, c]) => c > 1);
    });
    report(dupIds.length === 0 ? 'PASS' : 'FAIL',
      'r2.13: no duplicate element IDs in DOM',
      dupIds.length ? JSON.stringify(dupIds) : '');
    await ctx.close();
  }

  // ============================================================
  // R2.14: Focus rings visible — :focus-visible on tab + buttons
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    // Tab through chrome
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    const firstFocus = await page.evaluate(() => document.activeElement?.tagName + ':' + (document.activeElement?.className || ''));
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    const secondFocus = await page.evaluate(() => document.activeElement?.tagName + ':' + (document.activeElement?.className || ''));
    report(firstFocus && secondFocus ? 'PASS' : 'WARN',
      'r2.14: Tab key moves focus through interactive elements',
      `1=${firstFocus} 2=${secondFocus}`);
    await ctx.close();
  }

  // ============================================================
  // R2.15: scroll-margin on Stat School deep-link landing
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.location.hash = 'stat-school'; });
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.location.hash = 'stat-fip'; });
    await page.waitForTimeout(800);
    const fipTop = await page.evaluate(() => {
      const el = document.getElementById('stat-fip');
      return el ? el.getBoundingClientRect().top : null;
    });
    report(fipTop !== null && fipTop > -100 && fipTop < 200 ? 'PASS' : 'WARN',
      'r2.15: deep-link scrolls FIP card into top of viewport',
      `card top y=${fipTop}`);
    await ctx.close();
  }

  // ============================================================
  // R2.16: rapid tab switching — no render race
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE);
    await page.waitForTimeout(800);
    // Rapid-fire tab switches
    const tabs = ['players', 'team-stats', 'stat-school', 'overview', 'players', 'team-stats'];
    for (const t of tabs) {
      await page.evaluate((tab) => { window.location.hash = tab; }, t);
      await page.waitForTimeout(20); // very fast
    }
    await page.waitForTimeout(500);
    const finalActive = await page.$eval('.tab.active', el => el.dataset.tab);
    report(finalActive === 'team-stats' && errs.length === 0 ? 'PASS' : 'WARN',
      'r2.16: rapid tab switching settles cleanly',
      `final=${finalActive}, errs=${errs.length}`);
    await ctx.close();
  }

  // ============================================================
  // R2.17: Z-index — does theme toggle/IL chip get blocked by modal?
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(300);
    await page.$eval('.pcard', el => el.click());
    await page.waitForTimeout(300);
    // Try to click theme toggle (in header) while modal is open — should be blocked by scrim
    const themeRect = await page.$eval('#theme-toggle', el => el.getBoundingClientRect());
    const elementAtTheme = await page.evaluate((r) => {
      const el = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
      return el?.className + ':' + el?.tagName;
    }, themeRect);
    // If scrim is z:100 and theme toggle is in header, scrim should cover header — element at theme point should be scrim
    const blocked = elementAtTheme.includes('modal-scrim') || elementAtTheme.includes('SCRIM');
    report(blocked ? 'PASS' : 'WARN',
      'r2.17: modal scrim blocks theme toggle click (z-index correct)',
      `elementAtTheme=${elementAtTheme}`);
    await ctx.close();
  }

  // ============================================================
  // R2.18: localStorage failure — graceful degrade?
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      // Simulate disabled storage by overriding before any access
      Object.defineProperty(window, 'localStorage', {
        get() { throw new Error('SecurityError: storage disabled'); }
      });
    });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE);
    await page.waitForTimeout(800);
    report(errs.length === 0 ? 'PASS' : 'FAIL',
      'r2.18: localStorage disabled → no JS errors',
      errs.join(' | '));
    await ctx.close();
  }

  // ============================================================
  // R2.19: Run-diff chart annotation correctness
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    const annoText = await page.evaluate(() => {
      const svg = document.querySelector('.rd-chart');
      if (!svg) return null;
      const texts = Array.from(svg.querySelectorAll('text')).map(t => t.textContent);
      return texts;
    });
    const worstGameFromData = await page.evaluate(() => {
      const series = window.JT_STATE.data.run_diff_last_10 || [];
      let worst = 0, worstIdx = 0;
      series.forEach((s, i) => { if (s.diff < worst) { worst = s.diff; worstIdx = i; } });
      const date = series[worstIdx]?.date;
      const game = (window.JT_STATE.data.recent_games || []).find(g => g.date === date);
      return { date, diff: worst, game };
    });
    const hasAnnotation = annoText && annoText.some(t => t && /[vs@] [A-Z]{3}/.test(t));
    report(hasAnnotation ? 'PASS' : 'WARN',
      'r2.19: run-diff chart has direct annotation on worst game',
      `worstGame=${JSON.stringify(worstGameFromData)}, anno=${hasAnnotation}`);
    await ctx.close();
  }

  // ============================================================
  // R2.20: Term affordance — dotted underline visible in dotted/term spans
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    const termCount = await page.$$eval('.term', els => els.length);
    const sample = await page.$eval('.term', el => {
      const cs = getComputedStyle(el);
      return { borderBottom: cs.borderBottomStyle + ' ' + cs.borderBottomWidth, color: cs.borderBottomColor };
    }).catch(() => null);
    report(termCount > 0 && sample && sample.borderBottom.includes('dotted') ? 'PASS' : 'WARN',
      `r2.20: ${termCount} term affordances with dotted underline`,
      sample ? JSON.stringify(sample) : '');
    await ctx.close();
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n========== ROUND 2 SUMMARY ==========');
  const fails = findings.filter(f => f.startsWith('FAIL'));
  const warns = findings.filter(f => f.startsWith('WARN'));
  const passes = findings.filter(f => f.startsWith('PASS'));
  console.log(`PASS: ${passes.length}   WARN: ${warns.length}   FAIL: ${fails.length}`);
  if (fails.length) { console.log('\nFAILS:'); fails.forEach(f => console.log('  ' + f)); }
  if (warns.length) { console.log('\nWARNS:'); warns.forEach(w => console.log('  ' + w)); }

  await browser.close();
})().catch(err => {
  console.error('PROBE ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
