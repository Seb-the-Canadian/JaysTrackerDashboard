/* ============================================================
   Probe: external player profile links (G2)

   Asserts every Savant / MLB.com profile anchor rendered in the player
   modal is a safe external link — target="_blank", rel="noopener", an
   https profile URL of the expected shape, and an aria-label. This is the
   trust-layer contract from docs/security.md applied to the new JaysLinks
   surface, mirroring the "Voices links" assertion in round-1.js.

   Run from repo root with a static server up at :8000:
     python3 -m http.server 8000 &
     NODE_PATH=/opt/node22/lib/node_modules node tests/probes/player-links.js
   ============================================================ */
const { chromium } = require('playwright');

const BASE = process.env.JT_BASE || 'http://localhost:8000/index-v2.html';
const findings = [];
const report = (level, name, detail) => {
  findings.push({ level, name, detail });
  console.log(`${level.padEnd(4)} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForFunction(() => {
    const ov = document.getElementById('tab-overview');
    return ov && !ov.querySelector('.panel-skeleton');
  }, null, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => { window.location.hash = 'players'; });
  await page.waitForTimeout(500);

  // Open the first pcard's modal.
  const pid = await page.evaluate(() => {
    const c = document.querySelector('.pcard');
    return c ? c.dataset.playerId : null;
  });
  await page.evaluate((id) => { window.location.hash = 'player-' + id; }, pid);
  await page.waitForTimeout(400);

  // ----- L1: modal header renders an external-link row with 2 pills -----
  const pills = await page.evaluate(() => {
    const scrim = document.querySelector('#player-modal-scrim.show');
    if (!scrim) return null;
    const row = scrim.querySelector('.ext-row');
    if (!row) return null;
    return Array.from(row.querySelectorAll('a.ext-pill')).map((a) => ({
      text: a.textContent.trim(),
      href: a.getAttribute('href'),
      target: a.getAttribute('target'),
      rel: a.getAttribute('rel'),
      aria: a.getAttribute('aria-label'),
    }));
  });
  report(pills && pills.length === 2 ? 'PASS' : 'FAIL',
    'L1: modal header has a 2-pill external-link row',
    pills ? `count=${pills.length} labels=${pills.map((p) => p.text).join(',')}` : 'no ext-row');

  // ----- L2: every pill is a safe external anchor -----
  if (pills && pills.length) {
    let allSafe = true;
    const detail = [];
    for (const p of pills) {
      const safe = p.target === '_blank' && p.rel === 'noopener'
        && /^https:\/\//.test(p.href || '')
        && !/^javascript:/i.test(p.href || '')
        && !!p.aria && p.aria.length > 0;
      if (!safe) allSafe = false;
      detail.push(`${p.text}:${safe ? 'ok' : 'BAD'}`);
    }
    report(allSafe ? 'PASS' : 'FAIL',
      'L2: pills are target=_blank rel=noopener https + aria', detail.join(' '));
  } else {
    report('FAIL', 'L2: pills are target=_blank rel=noopener https + aria', 'no pills');
  }

  // ----- L3: hrefs match the Savant + MLB.com profile shapes -----
  if (pills && pills.length) {
    const sav = pills.find((p) => p.text === 'SAV');
    const mlb = pills.find((p) => p.text === 'MLB');
    const savOk = sav && /^https:\/\/baseballsavant\.mlb\.com\/savant-player\/.+-\d+$/.test(sav.href);
    const mlbOk = mlb && /^https:\/\/www\.mlb\.com\/player\/\d+$/.test(mlb.href);
    report(savOk && mlbOk ? 'PASS' : 'FAIL',
      'L3: hrefs match Savant + MLB.com profile shape',
      `sav=${sav ? sav.href : '-'} mlb=${mlb ? mlb.href : '-'}`);
  } else {
    report('FAIL', 'L3: hrefs match Savant + MLB.com profile shape', 'no pills');
  }

  // ----- L4: no javascript: anchors anywhere in the modal -----
  const jsAnchors = await page.evaluate(() => {
    const scrim = document.querySelector('#player-modal-scrim.show');
    if (!scrim) return -1;
    return Array.from(scrim.querySelectorAll('a'))
      .filter((a) => /^javascript:/i.test(a.getAttribute('href') || '')).length;
  });
  report(jsAnchors === 0 ? 'PASS' : 'FAIL',
    'L4: no javascript: anchors in modal', `count=${jsAnchors}`);

  const fails = findings.filter((f) => f.level === 'FAIL');
  console.log(`\nplayer-links: ${findings.length - fails.length}/${findings.length} pass`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((err) => {
  console.error('PROBE ERROR:', err.message);
  process.exit(2);
});
