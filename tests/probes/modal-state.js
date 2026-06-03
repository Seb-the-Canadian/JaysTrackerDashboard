/* ============================================================
   Probe: modal state from hash
   Antifragile pass — Commit 4. Asserts the modal lifecycle's
   single source of truth is window.location.hash. The B4 class
   was: each per-tab module owned its own modal hashchange logic,
   and click handlers wrote hash as a side-effect. The fix moved
   open/close/hashchange into assets/modal.js so every transition
   flows through render(state).

   What we assert:
   - modalState(hash) discriminator returns the right type/target
     for representative hashes
   - Click → modal open → hash matches the target
   - Browser-back from modal → modal closed, hash reverts to tab
   - Browser-forward → modal reopens (per design — hash history)
   - Esc / X / scrim click → modal closes AND hash reverts
   - Theme toggle while open → modal stays open, content present
   - Unknown / garbage hash → no modal mounted

   Run from repo root with a static server up at :8000:
     python3 -m http.server 8000 &
     NODE_PATH=/opt/node22/lib/node_modules node tests/probes/modal-state.js
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForTimeout(900);

  // ---- M1: discriminator returns correct shape for each pattern ----
  const cases = await page.evaluate(() => {
    const ms = window.JaysModal.modalState;
    return {
      empty: ms(''),
      players: ms('#players'),
      playerId: ms('#player-672386'),
      playerSlug: ms('#player-alejandro-kirk'),
      statHash: ms('#stat-xwoba'),
      garbage: ms('#asdfasdf'),
    };
  });
  report(cases.empty.type === null ? 'PASS' : 'FAIL',
    `M1: modalState('') → null type`, JSON.stringify(cases.empty));
  report(cases.players.type === null ? 'PASS' : 'FAIL',
    `M1: modalState('#players') → null type`, JSON.stringify(cases.players));
  report(cases.playerId.type === 'player' && cases.playerId.target === '672386' ? 'PASS' : 'FAIL',
    `M1: modalState('#player-672386') → player/672386`, JSON.stringify(cases.playerId));
  report(cases.playerSlug.type === 'player' && cases.playerSlug.target === 'alejandro-kirk' ? 'PASS' : 'FAIL',
    `M1: modalState('#player-alejandro-kirk')`, JSON.stringify(cases.playerSlug));
  report(cases.statHash.type === null ? 'PASS' : 'FAIL',
    `M1: modalState('#stat-xwoba') → null (stat is not a modal in v2)`,
    JSON.stringify(cases.statHash));
  report(cases.garbage.type === null ? 'PASS' : 'FAIL',
    `M1: modalState('#asdfasdf') → null`, JSON.stringify(cases.garbage));

  // ---- M2: click pcard → modal open + hash set to #player-<id> ----
  await page.evaluate(() => { window.location.hash = 'players'; });
  await page.waitForTimeout(280);
  const clicked = await page.evaluate(() => {
    const card = document.querySelector('.pcard');
    if (!card) return null;
    const id = card.dataset.playerId;
    card.click();
    return id;
  });
  await page.waitForTimeout(220);
  const afterClick = await page.evaluate(() => ({
    hash: window.location.hash,
    open: !!document.querySelector('#player-modal-scrim.show'),
    openId: (document.getElementById('player-modal-scrim') || {}).dataset
      ? document.getElementById('player-modal-scrim').dataset.openId
      : '',
  }));
  report(
    afterClick.open && afterClick.hash === '#player-' + clicked && afterClick.openId === clicked
      ? 'PASS' : 'FAIL',
    `M2: click → open + hash + openId all aligned`,
    `clicked=${clicked} hash=${afterClick.hash} open=${afterClick.open} openId=${afterClick.openId}`);

  // ---- M3: browser back from modal → modal closes, hash returns to #players ----
  await page.goBack();
  await page.waitForTimeout(300);
  const afterBack = await page.evaluate(() => ({
    hash: window.location.hash,
    open: !!document.querySelector('#player-modal-scrim.show'),
  }));
  report(!afterBack.open && afterBack.hash === '#players' ? 'PASS' : 'FAIL',
    `M3: browser back → modal closed + hash=#players`,
    `hash=${afterBack.hash} open=${afterBack.open}`);

  // ---- M4: forward → modal reopens (hash carries history) ----
  await page.goForward();
  await page.waitForTimeout(300);
  const afterFwd = await page.evaluate(() => ({
    hash: window.location.hash,
    open: !!document.querySelector('#player-modal-scrim.show'),
  }));
  report(afterFwd.open && afterFwd.hash === '#player-' + clicked ? 'PASS' : 'FAIL',
    `M4: forward → modal reopens, hash=${afterFwd.hash}`,
    `open=${afterFwd.open}`);

  // ---- M5: Esc closes modal AND hash reverts to #players ----
  await page.keyboard.press('Escape');
  await page.waitForTimeout(220);
  const afterEsc = await page.evaluate(() => ({
    hash: window.location.hash,
    open: !!document.querySelector('#player-modal-scrim.show'),
  }));
  report(!afterEsc.open && afterEsc.hash === '#players' ? 'PASS' : 'FAIL',
    `M5: Esc → modal closed + hash=#players`,
    `hash=${afterEsc.hash} open=${afterEsc.open}`);

  // ---- M6: click X button closes modal AND reverts hash ----
  await page.evaluate(() => {
    const card = document.querySelector('.pcard');
    if (card) card.click();
  });
  await page.waitForTimeout(220);
  await page.evaluate(() => {
    const x = document.querySelector('.modal-x');
    if (x) x.click();
  });
  await page.waitForTimeout(220);
  const afterX = await page.evaluate(() => ({
    hash: window.location.hash,
    open: !!document.querySelector('#player-modal-scrim.show'),
  }));
  report(!afterX.open && afterX.hash === '#players' ? 'PASS' : 'FAIL',
    `M6: X click → modal closed + hash=#players`,
    `hash=${afterX.hash} open=${afterX.open}`);

  // ---- M7: scrim click closes modal AND reverts hash ----
  await page.evaluate(() => {
    const card = document.querySelector('.pcard');
    if (card) card.click();
  });
  await page.waitForTimeout(220);
  await page.evaluate(() => {
    const s = document.getElementById('player-modal-scrim');
    if (s) s.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(220);
  const afterScrim = await page.evaluate(() => ({
    hash: window.location.hash,
    open: !!document.querySelector('#player-modal-scrim.show'),
  }));
  report(!afterScrim.open && afterScrim.hash === '#players' ? 'PASS' : 'FAIL',
    `M7: scrim click → modal closed + hash=#players`,
    `hash=${afterScrim.hash} open=${afterScrim.open}`);

  // ---- M8: theme toggle while modal open → modal stays open ----
  await page.evaluate(() => {
    const card = document.querySelector('.pcard');
    if (card) card.click();
  });
  await page.waitForTimeout(220);
  await page.evaluate(() => {
    const tt = document.getElementById('theme-toggle');
    if (tt) tt.click();
  });
  await page.waitForTimeout(160);
  const afterTheme = await page.evaluate(() => ({
    open: !!document.querySelector('#player-modal-scrim.show'),
    themeAttr: document.documentElement.getAttribute('data-theme'),
    contentPresent: !!document.querySelector('#player-modal-scrim .modal h3'),
  }));
  report(afterTheme.open && afterTheme.contentPresent ? 'PASS' : 'FAIL',
    `M8: theme toggle while open → modal stays open with content`,
    `open=${afterTheme.open} theme=${afterTheme.themeAttr} content=${afterTheme.contentPresent}`);

  // ---- M9: garbage hash → no modal ----
  await page.evaluate(() => { window.location.hash = 'garbage-thing'; });
  await page.waitForTimeout(220);
  const afterGarbage = await page.evaluate(() => ({
    open: !!document.querySelector('#player-modal-scrim.show'),
  }));
  report(!afterGarbage.open ? 'PASS' : 'FAIL',
    `M9: garbage hash → no modal mounted`);

  // ---- M10: deep-link direct nav to #player-<id> → modal opens after load ----
  const pid = await page.evaluate(() => {
    const card = document.querySelector('.pcard');
    return card ? card.dataset.playerId : null;
  });
  await page.goto(BASE + '#player-' + pid);
  await page.waitForTimeout(900);
  const afterDeep = await page.evaluate(() => ({
    open: !!document.querySelector('#player-modal-scrim.show'),
    hash: window.location.hash,
  }));
  report(afterDeep.open ? 'PASS' : 'FAIL',
    `M10: direct load to #player-${pid} → modal opens`,
    `hash=${afterDeep.hash} open=${afterDeep.open}`);

  const fails = findings.filter(f => f.level === 'FAIL');
  console.log(`\nmodal-state: ${findings.length - fails.length}/${findings.length} pass`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(err => {
  console.error('PROBE ERROR:', err.message);
  process.exit(2);
});
