/* ============================================================
   Probe: modal a11y — aria-labelledby + focus trap + theme toggle
   PR-E — Modal a11y (COG-365).

   The original modal-state probe verified the hash lifecycle but
   not ARIA wiring or focus management. Audit H11 (nameless
   dialog), H12 (no focus trap), and A1 (theme-toggle unreachable
   while modal open) were all invisible to it. This probe targets
   the survivor surface directly.

   Run from repo root with a static server up at :8001:
     python3 -m http.server 8001 &
     NODE_PATH=/opt/node22/lib/node_modules node tests/probes/modal-a11y.js
   ============================================================ */
const { chromium } = require('playwright');

const BASE = process.env.JT_BASE || 'http://localhost:8001/index-v2.html';
const findings = [];
const report = (level, name, detail) => {
  findings.push({ level, name, detail });
  console.log(`${level.padEnd(4)} ${name}${detail ? ' — ' + detail : ''}`);
};

async function openModal(page) {
  await page.evaluate(() => { window.location.hash = 'players'; });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const card = document.querySelector('.pcard');
    if (card) card.click();
  });
  await page.waitForTimeout(300);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForFunction(() => {
    const ov = document.getElementById('tab-overview');
    return ov && !ov.querySelector('.panel-skeleton');
  }, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);

  // ----- A1: aria-labelledby points to an existing element with text -----
  await openModal(page);
  const labelledby = await page.evaluate(() => {
    const scrim = document.getElementById('player-modal-scrim');
    if (!scrim) return { error: 'no scrim' };
    const id = scrim.getAttribute('aria-labelledby');
    if (!id) return { id: null };
    const target = document.getElementById(id);
    return {
      id,
      exists: !!target,
      text: target ? target.textContent.trim() : null,
      // Pill should NOT be part of the title text any more (audit M1).
      includesPill: target ? /(Hot|Cold|New)$/.test(target.textContent.trim()) : null,
    };
  });
  const labelledbyOk = labelledby.id
    && labelledby.exists
    && labelledby.text
    && !labelledby.includesPill;
  report(labelledbyOk ? 'PASS' : 'FAIL',
    'A1: scrim aria-labelledby resolves to a clean title element',
    JSON.stringify(labelledby));

  // ----- A2: scrim has role=dialog + aria-modal=true (regression check) -----
  const roles = await page.evaluate(() => {
    const s = document.getElementById('player-modal-scrim');
    if (!s) return {};
    return { role: s.getAttribute('role'), ariaModal: s.getAttribute('aria-modal') };
  });
  report(roles.role === 'dialog' && roles.ariaModal === 'true' ? 'PASS' : 'FAIL',
    'A2: role="dialog" + aria-modal="true"',
    JSON.stringify(roles));

  // ----- A3: focus trap — Tab from last focusable wraps to first -----
  //
  // Read the focusable order, then drive Tab from the last element and
  // assert focus lands back on the first.
  const focusableOrder = await page.evaluate(() => {
    const scrim = document.getElementById('player-modal-scrim');
    if (!scrim) return [];
    const sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.prototype.slice.call(scrim.querySelectorAll(sel))
      .filter(el => el.offsetParent !== null)
      .map(el => ({ tag: el.tagName, cls: el.className }));
  });
  if (focusableOrder.length < 2) {
    report('FAIL', 'A3: not enough focusables to test trap',
      'count=' + focusableOrder.length);
  } else {
    // Focus the last element programmatically.
    await page.evaluate(() => {
      const scrim = document.getElementById('player-modal-scrim');
      const sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const list = Array.prototype.slice.call(scrim.querySelectorAll(sel))
        .filter(el => el.offsetParent !== null);
      list[list.length - 1].focus();
    });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(120);
    const afterTab = await page.evaluate(() => {
      const a = document.activeElement;
      return {
        tag: a ? a.tagName : null,
        cls: a ? a.className : null,
        insideScrim: !!(a && a.closest('#player-modal-scrim')),
      };
    });
    const firstExpected = focusableOrder[0];
    const wrapped = afterTab.insideScrim
      && afterTab.tag === firstExpected.tag
      && afterTab.cls === firstExpected.cls;
    report(wrapped ? 'PASS' : 'FAIL',
      'A3: Tab from last focusable wraps to first',
      `expected=${firstExpected.tag}.${firstExpected.cls} got=${afterTab.tag}.${afterTab.cls} insideScrim=${afterTab.insideScrim}`);
  }

  // ----- A4: focus trap — Shift+Tab from first focusable wraps to last -----
  await page.evaluate(() => {
    const scrim = document.getElementById('player-modal-scrim');
    const sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const list = Array.prototype.slice.call(scrim.querySelectorAll(sel))
      .filter(el => el.offsetParent !== null);
    list[0].focus();
  });
  await page.keyboard.press('Shift+Tab');
  await page.waitForTimeout(120);
  const afterShiftTab = await page.evaluate(() => {
    const a = document.activeElement;
    return {
      tag: a ? a.tagName : null,
      cls: a ? a.className : null,
      insideScrim: !!(a && a.closest('#player-modal-scrim')),
    };
  });
  const lastExpected = focusableOrder[focusableOrder.length - 1];
  const wrappedBack = afterShiftTab.insideScrim
    && afterShiftTab.tag === lastExpected.tag
    && afterShiftTab.cls === lastExpected.cls;
  report(wrappedBack ? 'PASS' : 'FAIL',
    'A4: Shift+Tab from first focusable wraps to last',
    `expected=${lastExpected.tag}.${lastExpected.cls} got=${afterShiftTab.tag}.${afterShiftTab.cls} insideScrim=${afterShiftTab.insideScrim}`);

  // ----- A5: Esc still closes (regression check) -----
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const afterEsc = await page.evaluate(() => ({
    scrimShown: !!document.querySelector('#player-modal-scrim.show'),
    hash: window.location.hash,
  }));
  report(!afterEsc.scrimShown && afterEsc.hash === '#players' ? 'PASS' : 'FAIL',
    'A5: Esc closes modal + reverts hash',
    JSON.stringify(afterEsc));

  // ----- A6: theme toggle inside modal — flips theme without closing -----
  await openModal(page);
  const themeBefore = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'));
  await page.evaluate(() => {
    const btn = document.querySelector('#player-modal-scrim .modal-theme');
    if (btn) btn.click();
  });
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    scrimShown: !!document.querySelector('#player-modal-scrim.show'),
  }));
  const themeFlipped = after.theme !== themeBefore;
  report(themeFlipped && after.scrimShown ? 'PASS' : 'FAIL',
    'A6: in-modal theme toggle flips theme AND keeps modal open',
    `before=${themeBefore} after=${after.theme} stillOpen=${after.scrimShown}`);

  // ----- A7: aria-labelledby cleared on close -----
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const cleared = await page.evaluate(() => {
    const s = document.getElementById('player-modal-scrim');
    return s ? s.getAttribute('aria-labelledby') : 'missing';
  });
  report(cleared === null ? 'PASS' : 'FAIL',
    'A7: aria-labelledby removed when modal closes',
    `value="${cleared}"`);

  // ----- A8: focus returned to triggering card on close -----
  await openModal(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const focused = await page.evaluate(() => {
    const a = document.activeElement;
    return {
      tag: a ? a.tagName : null,
      cls: a ? a.className : null,
      isPcard: !!(a && a.classList && a.classList.contains('pcard')),
    };
  });
  report(focused.isPcard ? 'PASS' : 'FAIL',
    'A8: focus returns to triggering pcard after close',
    JSON.stringify(focused));

  const fails = findings.filter(f => f.level === 'FAIL');
  console.log(`\nmodal-a11y: ${findings.length - fails.length}/${findings.length} pass`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(err => {
  console.error('PROBE ERROR:', err.message);
  process.exit(2);
});
