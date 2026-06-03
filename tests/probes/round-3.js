// Round 3: survivorship-bias hunt — explicitly probing surface
// rounds 1+2 didn't touch.
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
  // A. Edge inputs to formatters
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);

    const results = await page.evaluate(() => {
      const F = window.JaysFormat;
      return {
        winPct_00:       F.winPct(0, 0),
        winPct_undef:    F.winPct(undefined, 0),
        winPct_neg:      F.winPct(-5, 5),
        ordinal_0:       F.ordinal(0),
        ordinal_neg:     F.ordinal(-1),
        ordinal_string:  F.ordinal('abc'),
        ordinal_111:     F.ordinal(111),
        ordinal_121:     F.ordinal(121),
        slugify_accent:  F.slugify('Yariel Rodríguez'),
        slugify_empty:   F.slugify(''),
        slugify_null:    F.slugify(null),
        slugify_special: F.slugify('O\'Brien-Smith Jr.'),
        initials_single: F.initials('Bo'),
        initials_long:   F.initials('Vladimir Guerrero Jr.'),
        initials_lots:   F.initials('Jean-Luc Picard de la Forêt III'),
        initials_empty:  F.initials(''),
        initials_null:   F.initials(null),
        baseball_neg:    F.baseballDecimal(-0.350),
        baseball_zero:   F.baseballDecimal(0),
        baseball_null:   F.baseballDecimal(null),
        signed_zero:     F.signed(0),
        signed_neg:      F.signed(-12.5),
        signed_null:     F.signed(null),
        relAge_future:   F.relativeAge(new Date(Date.now() + 1000*60*60).toISOString()),
        relAge_invalid:  F.relativeAge('not-a-date'),
        relAge_null:     F.relativeAge(null),
        shortMonth_null: F.shortMonthDay(null),
        slashDate_null:  F.slashDate(null),
        rankTier_0:      F.rankTier(0),
        rankTier_31:     F.rankTier(31),
        rankTier_null:   F.rankTier(null),
        rankLeft_0:      F.rankLeftPercent(0),
        rankLeft_31:     F.rankLeftPercent(31),
        rankLeft_null:   F.rankLeftPercent(null),
      };
    });
    console.log('  format edge inputs:', JSON.stringify(results, null, 2));

    // Expectations updated for the antifragile pass (commit 5) — every
    // formatter has a declared @domain and out-of-domain inputs return
    // the canonical DASH (or the documented neutral). See
    // tests/format-spec.test.js for the executable spec.
    const checks = [
      ['winPct(0,0)', results.winPct_00, '—', 'PASS'],
      ['winPct(undef,0)', results.winPct_undef, '—', 'PASS'],
      ['winPct(-5,5)', results.winPct_neg, '—', 'PASS'],
      ['ordinal(0)', results.ordinal_0, '—', 'PASS'],
      ['ordinal(-1)', results.ordinal_neg, '—', 'PASS'],
      ['ordinal("abc")', results.ordinal_string, '—', 'PASS'],
      ['ordinal(111)', results.ordinal_111, '—', 'PASS'],
      ['ordinal(121)', results.ordinal_121, '—', 'PASS'],
      ['slugify(accent)', results.slugify_accent, 'yariel-rodriguez', 'PASS'],
      ['slugify("")', results.slugify_empty, '', 'PASS'],
      ['slugify(null)', results.slugify_null, '', 'PASS'],
      ['slugify("O\'Brien-Smith Jr.")', results.slugify_special, 'o-brien-smith-jr', 'PASS'],
      ['initials("Bo")', results.initials_single, 'B', 'PASS'],
      ['initials("Vladimir Guerrero Jr.")', results.initials_long, 'VG', 'PASS'],
      ['initials(empty)', results.initials_empty, '', 'PASS'],
      ['initials(null)', results.initials_null, '', 'PASS'],
      ['relAge(future)', results.relAge_future, 'soon', 'PASS'],
      ['relAge("not-a-date")', results.relAge_invalid, '', 'PASS'],
      ['shortMonthDay(null)', results.shortMonth_null, '—', 'PASS'],
      ['slashDate(null)', results.slashDate_null, '—', 'PASS'],
      ['rankTier(0)', results.rankTier_0, '', 'PASS'],
      ['rankTier(31)', results.rankTier_31, '', 'PASS'],
      ['rankLeft(31)', results.rankLeft_31, 100, 'PASS'],
    ];
    for (const [label, actual, expected, level] of checks) {
      if (expected === null) {
        report(level, `format-edge: ${label}`, `returned ${JSON.stringify(actual)}`);
      } else {
        const ok = JSON.stringify(actual) === JSON.stringify(expected);
        report(ok ? 'PASS' : 'FAIL', `format-edge: ${label}`,
          ok ? '' : `expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
      }
    }

    await ctx.close();
  }

  // ============================================================
  // B1. Data with NO is_us in division (broken fork config)
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.route('**/data.json', async (route) => {
      const real = await route.fetch();
      const data = await real.json();
      data.division.forEach(t => { delete t.is_us; });
      data.wild_card.forEach(t => { delete t.is_us; });
      route.fulfill({ body: JSON.stringify(data), contentType: 'application/json' });
    });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE);
    await page.waitForTimeout(800);
    const meRowsDiv = await page.$$eval('.st-row.me', els => els.length);
    const meRowsWc = await page.$$eval('.wc-row.me', els => els.length);
    report(errs.length === 0 ? 'PASS' : 'FAIL',
      `B1: no is_us anywhere → no errors (div me-rows=${meRowsDiv}, wc me-rows=${meRowsWc})`,
      errs.join(' | '));
    await ctx.close();
  }

  // ============================================================
  // B2. Data with all pitchers gs=0 (no rotation)
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.route('**/data.json', async (route) => {
      const real = await route.fetch();
      const data = await real.json();
      data.roster.pitchers.forEach(p => { p.gs = 0; });
      route.fulfill({ body: JSON.stringify(data), contentType: 'application/json' });
    });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE);
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(400);
    // No rotation group should exist
    const rotationVisible = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.role-h h3'))
        .some(h => h.textContent === 'Starting rotation')
    );
    report(!rotationVisible && errs.length === 0 ? 'PASS' : 'WARN',
      'B2: all pitchers gs=0 → Rotation group omitted (no empty section)',
      `rotationVisible=${rotationVisible}, errs=${errs.length}`);
    await ctx.close();
  }

  // ============================================================
  // B3. Hitter with no pos field
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.route('**/data.json', async (route) => {
      const real = await route.fetch();
      const data = await real.json();
      data.roster.hitters.push({ id: 88888, name: 'Position Less', recent: null });
      route.fulfill({ body: JSON.stringify(data), contentType: 'application/json' });
    });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE);
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(400);
    // Hitter goes into Infield by fallback
    const positionLessGroup = await page.evaluate(() => {
      const card = document.querySelector('button[data-player-id="88888"]');
      if (!card) return null;
      const group = card.closest('.role-group');
      return group?.querySelector('.role-h h3')?.textContent;
    });
    report(positionLessGroup !== null && errs.length === 0 ? 'PASS' : 'WARN',
      'B3: hitter with no pos field falls into group',
      `groupedAs="${positionLessGroup}"`);
    await ctx.close();
  }

  // ============================================================
  // B4. Game with status != "Final" (in-progress)
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.route('**/data.json', async (route) => {
      const real = await route.fetch();
      const data = await real.json();
      data.recent_games[data.recent_games.length - 1] = {
        ...data.recent_games[data.recent_games.length - 1],
        result: 'L',
        status: 'In Progress',
        score: '3-3'
      };
      route.fulfill({ body: JSON.stringify(data), contentType: 'application/json' });
    });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE);
    await page.waitForTimeout(800);
    report(errs.length === 0 ? 'PASS' : 'WARN',
      'B4: in-progress game in recent_games renders without errors');
    await ctx.close();
  }

  // ============================================================
  // B5. RSS news item with no URL / empty title
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.route('**/data.json', async (route) => {
      const real = await route.fetch();
      const data = await real.json();
      data.news.unshift({ title: '', source: 'Test', author: '', url: null, published: null });
      data.news.unshift({ title: 'Article with no URL', source: 'Test', url: null, published: new Date().toISOString() });
      route.fulfill({ body: JSON.stringify(data), contentType: 'application/json' });
    });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE);
    await page.waitForTimeout(800);
    const hashHrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.voice')).map(a => a.getAttribute('href'))
    );
    report(errs.length === 0 ? 'PASS' : 'WARN',
      `B5: malformed news items (empty title, null url) render without errors`,
      `hrefs=${JSON.stringify(hashHrefs)}`);
    await ctx.close();
  }

  // ============================================================
  // C1. Very narrow viewport (320px — iPhone SE)
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await page.screenshot({ path: path.join(OUT, 'r3-320px.png'), fullPage: true });
    report(!overflowX ? 'PASS' : 'WARN',
      'C1: viewport 320px no horizontal scroll',
      `overflowX=${overflowX}`);
    await ctx.close();
  }

  // ============================================================
  // C2. Very wide viewport (1920x1200)
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1200 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, 'r3-1920px.png'), fullPage: true });
    const overviewWidth = await page.$eval('.ov-main', el => el.offsetWidth);
    report(overviewWidth > 0 && overviewWidth < 1920 ? 'PASS' : 'WARN',
      `C2: viewport 1920px, ov-main width=${overviewWidth}px (not exploding)`);
    await ctx.close();
  }

  // ============================================================
  // C3. prefers-reduced-motion — animations disabled?
  // ============================================================
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    // Look at .sk-line animation-duration with media query active
    const duration = await page.evaluate(() => {
      // Force a skeleton render to check
      const div = document.createElement('div');
      div.className = 'sk-line';
      document.body.appendChild(div);
      const cs = getComputedStyle(div);
      const ad = cs.animationDuration;
      div.remove();
      return ad;
    });
    report(duration === '0.01ms' || duration === '0s' ? 'PASS' : 'WARN',
      `C3: prefers-reduced-motion neutralizes animations`,
      `animationDuration=${duration}`);
    await ctx.close();
  }

  // ============================================================
  // C4. Print stylesheet — does anything visibly hide / arrange for print?
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    await page.emulateMedia({ media: 'print' });
    const headerHidden = await page.evaluate(() => {
      const h = document.querySelector('.appbar');
      return h ? getComputedStyle(h).display === 'none' : null;
    });
    // No print stylesheet defined — header should still display
    report(headerHidden === false ? 'WARN' : 'PASS',
      'C4: print media has no dedicated styles',
      `headerHidden=${headerHidden} (no @media print defined)`);
    await page.screenshot({ path: path.join(OUT, 'r3-print-media.png'), fullPage: true });
    await ctx.close();
  }

  // ============================================================
  // D. Loading-state visibility — what does Stat School look like
  //    during stat_school.json fetch?
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    // Add a 2s delay to stat_school.json
    await page.route('**/stat_school.json', async (route) => {
      await new Promise(r => setTimeout(r, 2000));
      route.continue();
    });
    await page.goto(BASE);
    await page.waitForTimeout(500); // boot has happened but stat_school not loaded
    await page.evaluate(() => { window.location.hash = 'stat-school'; });
    await page.waitForTimeout(300); // arrive at stat school during load
    const bodyHTML = await page.$eval('#tab-stat-school', el => el.innerHTML.trim());
    report(bodyHTML === '' ? 'WARN' : 'PASS',
      'D: Stat School during JSON load shows skeleton/loading',
      bodyHTML === '' ? 'body is empty (no loading state)' : 'has content');
    await page.screenshot({ path: path.join(OUT, 'r3-stat-school-loading.png'), fullPage: true });
    await ctx.close();
  }

  // ============================================================
  // E1. Landmark roles — header / main / nav
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    const landmarks = await page.evaluate(() => ({
      header: !!document.querySelector('header.appbar'),
      nav: !!document.querySelector('nav.tabs'),
      main: !!document.querySelector('main'),
      footer: !!document.querySelector('footer.colophon'),
    }));
    const ok = landmarks.header && landmarks.nav && landmarks.main && landmarks.footer;
    report(ok ? 'PASS' : 'WARN',
      'E1: landmark elements present',
      JSON.stringify(landmarks));
    await ctx.close();
  }

  // ============================================================
  // E2. Heading order — h1 → h2 → h3 (no skips)
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    for (const tab of ['overview', 'players', 'team-stats', 'stat-school']) {
      await page.evaluate((t) => { window.location.hash = t; }, tab);
      await page.waitForTimeout(300);
      const headings = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
        return all.filter(h => h.offsetParent !== null).map(h => ({
          level: +h.tagName[1],
          text: h.textContent.slice(0, 40),
        }));
      });
      // Check first heading is h1 or h2 and no level skipped
      const levels = headings.map(h => h.level);
      let prev = 0;
      let skipped = null;
      for (const l of levels) {
        if (l > prev + 1 && prev > 0) { skipped = `${prev} → ${l}`; break; }
        prev = l;
      }
      const hasH1 = levels.includes(1);
      report(hasH1 ? 'PASS' : 'WARN',
        `E2: ${tab} has h1`,
        `levels=${levels.slice(0, 8).join(',')}`);
      if (skipped) report('WARN', `E2: ${tab} heading level skipped: ${skipped}`);
    }
    await ctx.close();
  }

  // ============================================================
  // E3. SVG elements — createElementNS used, not createElement?
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    const svgIssues = await page.evaluate(() => {
      // Find SVGs and check their child elements are SVG namespace
      const svgs = document.querySelectorAll('svg');
      const out = [];
      svgs.forEach((svg, i) => {
        const kids = Array.from(svg.children);
        const wrongNs = kids.filter(k => k.namespaceURI !== 'http://www.w3.org/2000/svg');
        if (wrongNs.length) out.push({ svgIdx: i, wrongNs: wrongNs.length });
      });
      return out;
    });
    report(svgIssues.length === 0 ? 'PASS' : 'FAIL',
      'E3: all SVG children use SVG namespace',
      svgIssues.length ? JSON.stringify(svgIssues) : '');
    await ctx.close();
  }

  // ============================================================
  // F1. Pill text contrast — Hot pill (white on q-hot)
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(400);
    const pills = await page.evaluate(() => {
      const out = {};
      ['hot', 'cold', 'new'].forEach(cls => {
        const p = document.querySelector('.pill.' + cls);
        if (p) {
          const cs = getComputedStyle(p);
          out[cls] = { color: cs.color, bg: cs.backgroundColor };
        }
      });
      return out;
    });
    function rgb(s) {
      const m = s && s.match(/(\d+),\s*(\d+),\s*(\d+)/);
      return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
    }
    function lum({ r, g, b }) {
      const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    }
    function ratio(c1, c2) {
      const l1 = lum(c1), l2 = lum(c2);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }
    for (const cls of Object.keys(pills)) {
      const c = rgb(pills[cls].color), bg = rgb(pills[cls].bg);
      if (c && bg) {
        const r = ratio(c, bg);
        const level = r >= 4.5 ? 'PASS' : r >= 3 ? 'WARN' : 'FAIL';
        report(level, `F1: ${cls} pill contrast ${r.toFixed(2)}:1`,
          r < 4.5 ? 'fails AA for normal text (4.5:1)' : 'meets AA');
      }
    }
    await ctx.close();
  }

  // ============================================================
  // F2. Modal aria-label / aria-modal
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
    const a = await page.evaluate(() => {
      const scrim = document.querySelector('.modal-scrim');
      return {
        role: scrim?.getAttribute('role'),
        ariaModal: scrim?.getAttribute('aria-modal'),
        ariaLabel: scrim?.getAttribute('aria-label'),
        ariaLabelledBy: scrim?.getAttribute('aria-labelledby'),
      };
    });
    const ok = a.role === 'dialog' && a.ariaModal === 'true';
    report(ok ? 'PASS' : 'WARN',
      'F2: modal scrim has role=dialog + aria-modal=true',
      JSON.stringify(a));
    await ctx.close();
  }

  // ============================================================
  // F3. Tabs nav — aria-selected wired
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    const states = await page.evaluate(() => Array.from(document.querySelectorAll('.tab'))
      .map(t => ({ tab: t.dataset.tab, sel: t.getAttribute('aria-selected') })));
    // Exactly one tab has aria-selected="true"
    const trueCount = states.filter(s => s.sel === 'true').length;
    report(trueCount === 1 ? 'PASS' : 'WARN',
      `F3: exactly one tab has aria-selected="true"`,
      JSON.stringify(states));
    await ctx.close();
  }

  // ============================================================
  // F4. Focus indicator visible on focused tab
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    await page.keyboard.press('Tab'); // IL chip
    await page.keyboard.press('Tab'); // theme toggle
    await page.keyboard.press('Tab'); // first tab nav
    await page.waitForTimeout(100);
    const focusOutline = await page.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return { tag: el.tagName, cls: el.className.slice(0, 30), outline: cs.outline, offset: cs.outlineOffset };
    });
    const hasOutline = focusOutline.outline && !focusOutline.outline.includes('none');
    report(hasOutline ? 'PASS' : 'WARN',
      `F4: focused element shows outline`,
      JSON.stringify(focusOutline));
    await ctx.close();
  }

  // ============================================================
  // G1. Module pollution — accidental globals?
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    const customGlobals = await page.evaluate(() => {
      const builtins = new Set(['Math', 'Date', 'Object', 'Array', 'String', 'Number',
        'Boolean', 'Symbol', 'Promise', 'JSON', 'Error', 'TypeError', 'RangeError',
        'Reflect', 'Proxy', 'Map', 'Set', 'WeakMap', 'WeakSet', 'BigInt',
        'Function', 'RegExp', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
        'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent',
        'window', 'document', 'console', 'localStorage', 'sessionStorage',
        'navigator', 'location', 'history', 'screen', 'fetch', 'XMLHttpRequest',
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
        'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle',
        'globalThis', 'undefined', 'NaN', 'Infinity', 'top', 'self', 'parent',
        'frames', 'origin', 'name', 'closed', 'length', 'opener',
        'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight',
        'scrollX', 'scrollY', 'scrollTo', 'scrollBy', 'scroll',
        'addEventListener', 'removeEventListener', 'dispatchEvent',
        'matchMedia', 'getSelection', 'alert', 'confirm', 'prompt',
        'crypto', 'caches', 'indexedDB', 'performance',
        'JT_STATE', 'JaysTheme', 'JaysFormat', 'JaysOverview', 'JaysPlayers',
        'JaysTeamStats', 'JaysStatSchool',  // legit
      ]);
      return Object.keys(window).filter(k =>
        !builtins.has(k) && !k.startsWith('webkit') && !k.startsWith('chrome') && !k.startsWith('webgl')
      ).slice(0, 30);
    });
    report(customGlobals.length === 0 ? 'PASS' : 'WARN',
      `G1: no accidental window globals`,
      customGlobals.length ? customGlobals.join(', ') : '');
    await ctx.close();
  }

  // ============================================================
  // G2. Memory: heap snapshot before / after 50 modal opens
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.location.hash = 'players'; });
    await page.waitForTimeout(300);
    const heap1 = await page.evaluate(() => performance.memory?.usedJSHeapSize || 0);
    for (let i = 0; i < 50; i++) {
      const card = await page.$('.pcard');
      await card.click();
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => window.gc && window.gc());
    await page.waitForTimeout(200);
    const heap2 = await page.evaluate(() => performance.memory?.usedJSHeapSize || 0);
    const deltaMB = (heap2 - heap1) / 1024 / 1024;
    report(deltaMB < 5 ? 'PASS' : 'WARN',
      `G2: heap delta after 50 modal open/close = ${deltaMB.toFixed(2)} MB`,
      deltaMB >= 5 ? 'possible leak' : '');
    await ctx.close();
  }

  // ============================================================
  // G3. Render counts — does Stat School re-render on every hashchange?
  // ============================================================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__renderCounts = {};
      const orig = ['JaysOverview', 'JaysPlayers', 'JaysTeamStats', 'JaysStatSchool'];
      setTimeout(() => {
        orig.forEach(n => {
          if (!window[n]) return;
          const o = window[n].render;
          window[n].render = function (state) {
            window.__renderCounts[n] = (window.__renderCounts[n] || 0) + 1;
            return o.apply(this, arguments);
          };
        });
      }, 100);
    });
    await page.goto(BASE);
    await page.waitForTimeout(1000);
    // Initial counts
    const initial = await page.evaluate(() => ({ ...window.__renderCounts }));
    // Navigate Stat School → Overview → Stat School twice
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => { window.location.hash = 'stat-school'; });
      await page.waitForTimeout(200);
      await page.evaluate(() => { window.location.hash = 'overview'; });
      await page.waitForTimeout(200);
    }
    const after = await page.evaluate(() => ({ ...window.__renderCounts }));
    report('PASS', `G3: render counts initial vs after navigation`,
      `initial=${JSON.stringify(initial)} after=${JSON.stringify(after)}`);
    await ctx.close();
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n========== ROUND 3 SUMMARY ==========');
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
