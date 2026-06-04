/* ============================================================
   Probe: heading + tabpanel binding
   PR-C — Layer + content hygiene (COG-359).

   The original layer-boundaries L3 asserts every tab body has AT
   LEAST ONE <h2>. That passed both for the correct case (one h2)
   and for the audit's H5 finding (double h2 — visible plus the
   factory-injected sr-only). This probe is the strict version:
   exactly one h2 per tab body, every aria-labelledby resolves to
   an existing element.

   Audit H6 closure: pre-PR-C the Overview tabpanel had
   `aria-labelledby="tab-overview"` pointing at itself; the other
   three tabpanels had no labelledby at all. This probe walks
   every tabpanel and asserts the labelledby target exists and is
   non-empty.

   Run from repo root with a static server up at :8001:
     python3 -m http.server 8001 &
     NODE_PATH=/opt/node22/lib/node_modules node tests/probes/heading-binding.js
   ============================================================ */
const { chromium } = require('playwright');

const BASE = process.env.JT_BASE || 'http://localhost:8001/index-v2.html';
const TABS = ['overview', 'players', 'team-stats', 'stat-school'];
const findings = [];
const report = (level, name, detail) => {
  findings.push({ level, name, detail });
  console.log(`${level.padEnd(4)} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForFunction(() => {
    const ov = document.getElementById('tab-overview');
    return ov && !ov.querySelector('.panel-skeleton');
  }, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);

  // Activate every tab so all bodies are rendered.
  for (const tab of TABS) {
    await page.evaluate((t) => { window.location.hash = t; }, tab);
    await page.waitForTimeout(400);
  }

  // ----- H1: exactly one <h2> per tab body -----
  for (const tab of TABS) {
    const h2Count = await page.evaluate((id) => {
      const body = document.getElementById('tab-' + id);
      if (!body) return -1;
      return body.querySelectorAll('h2').length;
    }, tab);
    report(h2Count === 1 ? 'PASS' : 'FAIL',
      `H1: tab-${tab} has exactly one <h2>`,
      `count=${h2Count}`);
  }

  // ----- H2: aria-labelledby on each tabpanel resolves to an existing element -----
  for (const tab of TABS) {
    const r = await page.evaluate((id) => {
      const panel = document.getElementById('tab-' + id);
      if (!panel) return { error: 'no panel' };
      const labelledby = panel.getAttribute('aria-labelledby');
      if (!labelledby) return { labelledby: null };
      const target = document.getElementById(labelledby);
      return {
        labelledby,
        targetExists: !!target,
        // The target's own id must differ from the panel's id — otherwise
        // it's the self-reference bug from audit H6.
        selfReferential: labelledby === panel.id,
        text: target ? target.textContent.trim().slice(0, 40) : null,
      };
    }, tab);
    const ok = r.labelledby && r.targetExists && !r.selfReferential && r.text;
    report(ok ? 'PASS' : 'FAIL',
      `H2: tab-${tab} aria-labelledby resolves`,
      `labelledby=${r.labelledby} exists=${r.targetExists} selfRef=${r.selfReferential} text="${r.text}"`);
  }

  // ----- H3: tab anchors have ids matching their panel's labelledby -----
  for (const tab of TABS) {
    const anchorId = `tab-${tab}-anchor`;
    const anchorExists = await page.evaluate((id) => !!document.getElementById(id), anchorId);
    report(anchorExists ? 'PASS' : 'FAIL',
      `H3: tab anchor #${anchorId} exists`);
  }

  // ----- H4: ZERO sr-only h2 elements per tab (since each tab has a visible h2) -----
  //
  // PR-C's tabBody({ headingProvided: true }) opt-in says: if the tab
  // emits its own visible h2, the factory's sr-only injection is
  // skipped. Overview is the exception — it has no visible h2, so its
  // sr-only stays.
  const visibleH2Tabs = ['players', 'team-stats', 'stat-school'];
  for (const tab of visibleH2Tabs) {
    const srOnlyCount = await page.evaluate((id) => {
      const body = document.getElementById('tab-' + id);
      if (!body) return -1;
      return body.querySelectorAll('h2.sr-only').length;
    }, tab);
    report(srOnlyCount === 0 ? 'PASS' : 'FAIL',
      `H4: tab-${tab} has no sr-only h2 (visible heading already present)`,
      `srOnlyCount=${srOnlyCount}`);
  }
  // Overview: should still have its sr-only h2 (no visible one).
  {
    const c = await page.evaluate(() => {
      const b = document.getElementById('tab-overview');
      return b ? b.querySelectorAll('h2.sr-only').length : -1;
    });
    report(c === 1 ? 'PASS' : 'FAIL',
      'H4: tab-overview keeps its sr-only h2 (no visible heading)',
      `srOnlyCount=${c}`);
  }

  const fails = findings.filter(f => f.level === 'FAIL');
  console.log(`\nheading-binding: ${findings.length - fails.length}/${findings.length} pass`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(err => {
  console.error('PROBE ERROR:', err.message);
  process.exit(2);
});
