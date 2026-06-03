// Comprehensive v2 bug-hunt probe.
// Reports pass / FAIL / WARN per probe; saves diagnostic screenshots
// to /tmp/v2-shots/ for any failures.

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
  // PROBE 1: Boot state — does the page render without errors?
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push('JS:' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.text().includes('CERT_AUTHORITY')) errs.push('CONSOLE:' + m.text()); });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    const brandLoaded = await page.$eval('#brand-title', el => el.textContent !== 'Loading…').catch(() => false);
    report(brandLoaded ? 'PASS' : 'FAIL', 'boot: brand title populated from config', !brandLoaded ? 'still says "Loading…"' : '');

    const recLoaded = await page.$eval('#hdr-rec-line', el => el.textContent !== '—').catch(() => false);
    report(recLoaded ? 'PASS' : 'FAIL', 'boot: record loaded into header');

    const ilCount = await page.$eval('#il-count', el => parseInt(el.textContent, 10)).catch(() => null);
    const dataIlCount = await page.evaluate(() => (window.JT_STATE.data.injuries || []).length);
    report(ilCount === dataIlCount ? 'PASS' : 'FAIL', 'boot: IL chip count matches data.injuries.length',
      ilCount !== dataIlCount ? `chip=${ilCount} vs data=${dataIlCount}` : `${ilCount}`);

    if (errs.length) report('FAIL', 'boot: console/JS errors', errs.join(' | '));
    else report('PASS', 'boot: no console or page errors');

    await ctx.close();
  }

  // ============================================================
  // PROBE 2: Tab routing — every tab + every fallback
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);

    const TABS = ['overview', 'players', 'team-stats', 'stat-school'];
    for (const tab of TABS) {
      await page.evaluate((t) => { window.location.hash = t; }, tab);
      await page.waitForTimeout(200);
      const active = await page.$eval('.tab.active', el => el.dataset.tab);
      const bodyVisible = await page.$eval(`#tab-${tab}`, el => !el.hidden);
      const ok = active === tab && bodyVisible;
      report(ok ? 'PASS' : 'FAIL', `routing: #${tab} activates tab + shows body`,
        !ok ? `active=${active}, bodyVisible=${bodyVisible}` : '');
    }

    // Bug 1 from the prior pass — deep-link to stat anchor from Overview
    await page.evaluate(() => { window.location.hash = 'overview'; });
    await page.waitForTimeout(150);
    await page.evaluate(() => { window.location.hash = 'stat-xwoba'; });
    await page.waitForTimeout(400);
    const activeAfterStatLink = await page.$eval('.tab.active', el => el.dataset.tab);
    report(activeAfterStatLink === 'stat-school' ? 'PASS' : 'FAIL',
      'routing: #stat-xwoba from Overview activates Stat School',
      `active became "${activeAfterStatLink}"`);

    // Same for player deep-link
    await page.evaluate(() => { window.location.hash = 'overview'; });
    await page.waitForTimeout(150);
    const firstPlayerId = await page.evaluate(() => {
      const all = (window.JT_STATE.data.roster.hitters || []).concat(window.JT_STATE.data.roster.pitchers || []);
      return all[0] && all[0].id;
    });
    await page.evaluate((id) => { window.location.hash = 'player-' + id; }, firstPlayerId);
    await page.waitForTimeout(400);
    const activeAfterPlayer = await page.$eval('.tab.active', el => el.dataset.tab);
    const modalVisible = await page.$('.modal-scrim.show').then(el => !!el);
    report(modalVisible ? 'PASS' : 'FAIL',
      `routing: #player-${firstPlayerId} from Overview opens modal`,
      `modalVisible=${modalVisible}, activeTab=${activeAfterPlayer}`);

    await ctx.close();
  }

  // ============================================================
  // PROBE 3: Modal lifecycle
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);

    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(300);

    // Click first card
    const firstCard = await page.$('.pcard');
    if (!firstCard) { report('FAIL', 'modal: no .pcard to click'); }
    else {
      await firstCard.click();
      await page.waitForTimeout(300);
      const modalOpen = await page.$('.modal-scrim.show').then(el => !!el);
      report(modalOpen ? 'PASS' : 'FAIL', 'modal: opens on .pcard click');

      // Focus should be on close button
      const focusOnClose = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('modal-x'));
      report(focusOnClose ? 'PASS' : 'WARN', 'modal: focus moves to close button on open',
        !focusOnClose ? `activeElement=${await page.evaluate(() => document.activeElement?.tagName)}` : '');

      // Esc closes
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      const closedAfterEsc = await page.$('.modal-scrim.show').then(el => !el);
      report(closedAfterEsc ? 'PASS' : 'FAIL', 'modal: Esc closes');

      // Reopen, then backdrop click
      const card2 = await page.$('.pcard');
      await card2.click();
      await page.waitForTimeout(300);
      const scrim = await page.$('.modal-scrim');
      const box = await scrim.boundingBox();
      // Click in top-left of scrim (away from .modal content)
      await page.mouse.click(box.x + 10, box.y + 10);
      await page.waitForTimeout(200);
      const closedAfterBackdrop = await page.$('.modal-scrim.show').then(el => !el);
      report(closedAfterBackdrop ? 'PASS' : 'FAIL', 'modal: backdrop click closes');

      // Reopen, click X
      const card3 = await page.$('.pcard');
      await card3.click();
      await page.waitForTimeout(300);
      await page.$eval('.modal-x', el => el.click());
      await page.waitForTimeout(200);
      const closedAfterX = await page.$('.modal-scrim.show').then(el => !el);
      report(closedAfterX ? 'PASS' : 'FAIL', 'modal: X button closes');

      // Hash should be cleared back to #players
      const hashAfterClose = await page.evaluate(() => window.location.hash);
      report(hashAfterClose === '#players' ? 'PASS' : 'WARN', 'modal: hash returns to #players on close',
        `hash="${hashAfterClose}"`);
    }

    await ctx.close();
  }

  // ============================================================
  // PROBE 4: Theme toggle + persistence
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);

    const initialMode = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await page.$eval('#theme-toggle', el => el.click());
    await page.waitForTimeout(200);
    const afterClick = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const stored = await page.evaluate(() => localStorage.getItem('jt-theme'));
    report(afterClick === 'dark' && stored === 'dark' ? 'PASS' : 'FAIL',
      'theme: toggle activates dark + persists to localStorage',
      `mode=${afterClick}, stored=${stored}`);

    // Reload — should stay dark
    await page.reload();
    await page.waitForTimeout(800);
    const afterReload = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    report(afterReload === 'dark' ? 'PASS' : 'FAIL',
      'theme: dark mode persists across reload',
      `mode=${afterReload}`);

    await ctx.close();
  }

  // ============================================================
  // PROBE 5: Dark mode contrast — Players card text + avatar
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => localStorage.setItem('jt-theme', 'dark'));
    await page.goto(BASE);
    await page.waitForTimeout(800);

    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(300);

    const probe = await page.evaluate(() => {
      const card = document.querySelector('.pcard');
      if (!card) return null;
      const nameEl = card.querySelector('.pc-id b');
      const avEl = card.querySelector('.pc-av');
      const subEl = card.querySelector('.pc-id small');
      const cs = (el) => el ? getComputedStyle(el) : null;
      return {
        name: { text: nameEl?.textContent, color: cs(nameEl)?.color, bg: cs(card)?.backgroundColor },
        sub:  { text: subEl?.textContent, color: cs(subEl)?.color },
        av:   { text: avEl?.textContent, color: cs(avEl)?.color, bg: cs(avEl)?.backgroundColor },
        card: { bg: cs(card)?.backgroundColor, color: cs(card)?.color },
      };
    });
    console.log('  contrast probe:', JSON.stringify(probe, null, 2));

    // WCAG contrast check
    function rgb(s) {
      const m = s && s.match(/(\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return null;
      return { r: +m[1], g: +m[2], b: +m[3] };
    }
    function lum({ r, g, b }) {
      const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    }
    function ratio(c1, c2) {
      const l1 = lum(c1), l2 = lum(c2);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }

    if (probe) {
      const nameC = rgb(probe.name.color), cardBg = rgb(probe.card.bg);
      if (nameC && cardBg) {
        const r = ratio(nameC, cardBg);
        report(r >= 4.5 ? 'PASS' : 'WARN', `dark contrast: player name on card (${r.toFixed(2)}:1)`,
          r < 4.5 ? 'fails WCAG AA (4.5:1)' : 'meets AA');
      }
      const avC = rgb(probe.av.color), avBg = rgb(probe.av.bg);
      if (avC && avBg) {
        const r = ratio(avC, avBg);
        report(r >= 3 ? 'PASS' : 'WARN', `dark contrast: avatar initials on tile (${r.toFixed(2)}:1)`,
          r < 3 ? 'low contrast' : 'ok');
      }
    }

    await ctx.close();
  }

  // ============================================================
  // PROBE 6: Responsive — Overview at 4 breakpoints
  // ============================================================
  {
    for (const w of [1440, 1100, 760, 480]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(BASE);
      await page.waitForTimeout(800);
      const grid = await page.$eval('.ov-main', el => getComputedStyle(el).gridTemplateColumns);
      const kpis = await page.$eval('.kpis', el => getComputedStyle(el).gridTemplateColumns);
      const filename = path.join(OUT, `probe-overview-${w}.png`);
      await page.screenshot({ path: filename, fullPage: true });
      console.log(`  @ ${w}px → grid=${grid.slice(0, 80)}... kpis=${kpis.slice(0, 80)}...`);
      report('PASS', `responsive: Overview renders at ${w}px`, `screenshot: ${path.basename(filename)}`);
      await ctx.close();
    }
  }

  // ============================================================
  // PROBE 7: Network failure — what if notes.json fails?
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.route('**/notes.json', route => route.abort());
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE);
    await page.waitForTimeout(1200);

    // State of Season should be omitted (no notes.overview)
    const sosVisible = await page.$('.analyst-panel');
    report(!sosVisible ? 'PASS' : 'WARN',
      'fail-mode: notes.json blocked → State of Season omitted (absent-key)',
      sosVisible ? 'panel still rendered' : '');

    if (errs.length === 0) report('PASS', 'fail-mode: notes.json blocked → no JS errors');
    else report('FAIL', 'fail-mode: notes.json blocked → JS errors', errs.join(' | '));

    await ctx.close();
  }

  // ============================================================
  // PROBE 8: Network failure — what if stat_school.json fails?
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.route('**/stat_school.json', route => route.abort());
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE);
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.location.hash = 'stat-school'; });
    await page.waitForTimeout(800);

    if (errs.length === 0) report('PASS', 'fail-mode: stat_school.json blocked → no JS errors');
    else report('FAIL', 'fail-mode: stat_school.json blocked → JS errors', errs.join(' | '));

    await ctx.close();
  }

  // ============================================================
  // PROBE 9: Data correctness — record + standings + WC me-row
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);

    const data = await page.evaluate(() => window.JT_STATE.data);
    const expected = `${data.team.record.w}–${data.team.record.l}`;
    const actual = await page.$eval('#hdr-rec-line', el => el.textContent);
    report(actual === expected ? 'PASS' : 'FAIL',
      'data: header record matches data.team.record',
      `header="${actual}" expected="${expected}"`);

    // Standings: "me" row count == 1
    const meRows = await page.$$('.st-row.me');
    report(meRows.length === 1 ? 'PASS' : 'FAIL',
      'data: AL East has exactly one "me" row',
      `count=${meRows.length}`);

    // Wild Card: "me" row count == 1
    const wcMe = await page.$$('.wc-row.me');
    report(wcMe.length === 1 ? 'PASS' : 'FAIL',
      'data: AL Wild Card has exactly one "me" row',
      `count=${wcMe.length}`);

    // Pythag KPI number is finite
    const pythagText = await page.$eval('.kpi:nth-of-type(3) .kv', el => el.textContent);
    report(pythagText && pythagText !== '—' && /\d/.test(pythagText) ? 'PASS' : 'WARN',
      'data: Pythag KPI shows a finite number',
      `text="${pythagText}"`);

    await ctx.close();
  }

  // ============================================================
  // PROBE 10: Pill rendering — hot/cold/new appear on Players
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(400);

    const counts = await page.evaluate(() => ({
      hot: document.querySelectorAll('.pcard .pill.hot').length,
      cold: document.querySelectorAll('.pcard .pill.cold').length,
      new: document.querySelectorAll('.pcard .pill.new').length,
    }));
    const dataCounts = await page.evaluate(() => {
      const all = (window.JT_STATE.data.roster.hitters || []).concat(window.JT_STATE.data.roster.pitchers || []);
      return {
        hot: all.filter(p => p.recent === 'hot').length,
        cold: all.filter(p => p.recent === 'cold').length,
        new: all.filter(p => p.recent === 'new').length,
      };
    });
    const ok = counts.hot === dataCounts.hot && counts.cold === dataCounts.cold && counts.new === dataCounts.new;
    report(ok ? 'PASS' : 'FAIL', 'pills: hot/cold/new counts match data.roster.*.recent',
      JSON.stringify({ rendered: counts, expected: dataCounts }));

    await ctx.close();
  }

  // ============================================================
  // PROBE 11: Stat School scroll-spy + scroll behavior
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.location.hash = 'stat-school'; });
    await page.waitForTimeout(800);

    // Click index item → does it scroll?
    const initialY = await page.evaluate(() => window.scrollY);
    const items = await page.$$('.idx-item');
    if (items.length >= 5) {
      await items[4].click();
      await page.waitForTimeout(700);
      const afterY = await page.evaluate(() => window.scrollY);
      report(afterY > initialY ? 'PASS' : 'WARN',
        'stat-school: clicking index item scrolls page',
        `initialY=${initialY}, afterY=${afterY}`);

      // Active class moves to clicked item
      const activeAfter = await page.$eval('.idx-item.active', el => el.dataset.slug).catch(() => null);
      const clickedSlug = await items[4].evaluate(el => el.dataset.slug);
      report(activeAfter === clickedSlug ? 'PASS' : 'WARN',
        'stat-school: active class moves to clicked index item',
        `active=${activeAfter}, clicked=${clickedSlug}`);
    }

    // Progressive disclosure on Advanced cards
    const discBefore = await page.evaluate(() => {
      const cards = document.querySelectorAll('.disc');
      return Array.from(cards).map(c => c.classList.contains('open'));
    });
    report(discBefore.every(o => o === false) ? 'PASS' : 'WARN',
      'stat-school: disclosure blocks default closed',
      `states=${JSON.stringify(discBefore)}`);

    await ctx.close();
  }

  // ============================================================
  // PROBE 12: Team Stats Hitting/Pitching toggle
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.location.hash = 'team-stats'; });
    await page.waitForTimeout(300);

    // Default = Hitting; ledger should show hitting stats
    const initialTitle = await page.$eval('.tbl + *, .ledger-panel h3, .panel h3', el => el.textContent).catch(() => '');
    const hitsTitle = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h3')).map(h => h.textContent).find(t => t.includes('Hitting'))
    );
    report(hitsTitle ? 'PASS' : 'FAIL', 'team-stats: default ledger is Hitting',
      `found h3="${hitsTitle}"`);

    // Click Pitching → ledger swaps
    await page.$$eval('.seg button', els => {
      const p = els.find(e => e.textContent === 'Pitching');
      if (p) p.click();
    });
    await page.waitForTimeout(200);
    const newTitle = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h3')).map(h => h.textContent).find(t => t.includes('Pitching'))
    );
    report(newTitle ? 'PASS' : 'FAIL', 'team-stats: toggle to Pitching swaps ledger',
      `found h3="${newTitle}"`);

    await ctx.close();
  }

  // ============================================================
  // PROBE 13: Voices around — external link safety
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    const voices = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('.voice'));
      return links.map(l => ({
        target: l.getAttribute('target'),
        rel: l.getAttribute('rel'),
        hasHref: !!l.getAttribute('href'),
      }));
    });
    const allSafe = voices.every(v => v.target === '_blank' && (v.rel || '').includes('noopener') && v.hasHref);
    report(allSafe ? 'PASS' : 'WARN',
      'security: Voices links have target="_blank" + rel="noopener"',
      JSON.stringify(voices));
  }

  // ============================================================
  // PROBE 14: Empty data resilience — roster.hitters empty
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.route('**/data.json', async route => {
      const real = await route.fetch();
      const json = await real.json();
      json.roster.hitters = [];
      json.recent_games = [];
      json.news = [];
      route.fulfill({ body: JSON.stringify(json), contentType: 'application/json' });
    });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE);
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(300);

    if (errs.length === 0) report('PASS', 'edge: empty hitters/recent/news → no JS errors');
    else report('FAIL', 'edge: empty arrays cause JS errors', errs.join(' | '));

    await ctx.close();
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n========== SUMMARY ==========');
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
