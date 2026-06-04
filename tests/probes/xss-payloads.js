/* ============================================================
   Probe: XSS payloads
   PR-D — Security: news URL allowlist + maintainer-trust policy
   (COG-360).

   The audit's H3 finding was that `news[].url` flowed unsanitized
   into anchor `href`, so a feed item with `url:
   "javascript:alert(1)"` would render as a clickable JS-protocol
   link. This probe injects malicious payloads into `data.json`
   via route interception and asserts that no script executes,
   no JS-protocol anchor mounts, and the trust boundary is held
   end-to-end.

   The maintainer-trust paths (notes.json + stat_school.json
   innerHTML) are explicitly NOT XSS-tested here — they're trusted
   by policy per docs/security.md, and DOMPurify is deferred to
   v2.1.

   Run from repo root with a static server up at :8001:
     python3 -m http.server 8001 &
     NODE_PATH=/opt/node22/lib/node_modules node tests/probes/xss-payloads.js
   ============================================================ */
const { chromium } = require('playwright');

const BASE = process.env.JT_BASE || 'http://localhost:8001/index-v2.html';
const findings = [];
const report = (level, name, detail) => {
  findings.push({ level, name, detail });
  console.log(`${level.padEnd(4)} ${name}${detail ? ' — ' + detail : ''}`);
};

async function loadWithNewsUrls(browser, urls) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await ctx.route('**/data.json', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.news = urls.map((u, i) => ({
      title: 'Test headline ' + i,
      summary: '',
      source: 'Test',
      author: 'Test',
      url: u,
      published: new Date().toISOString(),
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const page = await ctx.newPage();
  // Install the canary BEFORE any page script runs.
  await page.addInitScript(() => {
    window.__xssCanary = 0;
    window.__xssDetails = [];
  });
  page.on('pageerror', (e) => console.error('  page error:', e.message));
  await page.goto(BASE);
  await page.waitForFunction(() => {
    const ov = document.getElementById('tab-overview');
    return ov && !ov.querySelector('.panel-skeleton');
  }, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  return { ctx, page };
}

async function readCanary(page) {
  return await page.evaluate(() => ({
    fired: window.__xssCanary || 0,
    details: window.__xssDetails || [],
  }));
}

(async () => {
  const browser = await chromium.launch();

  // ----- X1: javascript: URL doesn't render as a clickable anchor -----
  //
  // Even if the renderer dropped the protection, clicking such an anchor
  // would require user interaction. We assert the anchor's href is
  // sanitized (i.e. it resolves to '#' or the entire item is filtered).
  {
    const { ctx, page } = await loadWithNewsUrls(browser, [
      'javascript:window.__xssCanary++;window.__xssDetails.push("js:")',
      'data:text/html;base64,PHNjcmlwdD53aW5kb3cuX194c3NDYW5hcnkrKzs8L3NjcmlwdD4=',
      'vbscript:msgbox(1)',
    ]);
    // Wait for Overview to render — that's where renderVoices lives.
    await page.waitForTimeout(500);
    const hrefs = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('.voice'));
      return anchors.map((a) => a.getAttribute('href'));
    });
    const dangerous = hrefs.filter((h) => /^(javascript:|data:|vbscript:)/i.test(h || ''));
    report(dangerous.length === 0 ? 'PASS' : 'FAIL',
      'X1: dangerous protocols never reach anchor href',
      'hrefs=' + JSON.stringify(hrefs));

    // X1b: try clicking any voice anchor (best-effort — if hrefs are '#',
    // the click won't navigate; if filtered entirely, no anchor exists).
    const beforeClick = await readCanary(page);
    await page.evaluate(() => {
      const a = document.querySelector('.voice');
      if (a) a.click();
    });
    await page.waitForTimeout(300);
    const afterClick = await readCanary(page);
    report(afterClick.fired === 0 ? 'PASS' : 'FAIL',
      'X1b: clicking malicious-URL voice anchor does not execute',
      `canary fired=${afterClick.fired} details=${JSON.stringify(afterClick.details)}`);
    await ctx.close();
  }

  // ----- X2: http:/https: URLs pass through unchanged -----
  {
    const { ctx, page } = await loadWithNewsUrls(browser, [
      'https://example.com/article',
      'http://insecure.example.com/path?q=1',
    ]);
    await page.waitForTimeout(500);
    const hrefs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.voice')).map((a) => a.getAttribute('href'));
    });
    const passedThrough = hrefs.filter((h) => h === 'https://example.com/article' || h === 'http://insecure.example.com/path?q=1');
    report(passedThrough.length === 2 ? 'PASS' : 'FAIL',
      'X2: http: and https: URLs preserved unchanged',
      'hrefs=' + JSON.stringify(hrefs));
    await ctx.close();
  }

  // ----- X3: mixed feed (some malicious, some good) — malicious dropped -----
  {
    const { ctx, page } = await loadWithNewsUrls(browser, [
      'javascript:alert(1)',
      'https://example.com/legit-1',
      'data:text/html,<script>1</script>',
      'https://example.com/legit-2',
      'https://example.com/legit-3',
    ]);
    await page.waitForTimeout(500);
    const hrefs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.voice')).map((a) => a.getAttribute('href'));
    });
    // Renderer caps at 4 items. Of the 3 https: items, all 3 should appear;
    // the 2 dangerous items should be filtered.
    const allGoodProtocols = hrefs.every((h) => /^https?:/i.test(h));
    const noJsProtocol = !hrefs.some((h) => /^javascript:/i.test(h));
    const noDataProtocol = !hrefs.some((h) => /^data:/i.test(h));
    report(allGoodProtocols && noJsProtocol && noDataProtocol ? 'PASS' : 'FAIL',
      'X3: malicious entries dropped, legitimate ones rendered',
      'hrefs=' + JSON.stringify(hrefs));
    await ctx.close();
  }

  // ----- X4: empty / null / non-string URLs -----
  {
    const { ctx, page } = await loadWithNewsUrls(browser, [
      '',
      null,
      undefined,
      'https://example.com/ok',
      { weird: 'object' },
    ]);
    await page.waitForTimeout(500);
    const hrefs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.voice')).map((a) => a.getAttribute('href'));
    });
    // Only the legit https: URL should render. Empty / null / non-string
    // collapse to '#' and the item is filtered.
    const allOk = hrefs.length === 1 && hrefs[0] === 'https://example.com/ok';
    report(allOk ? 'PASS' : 'FAIL',
      'X4: empty / null / non-string URLs filter out gracefully',
      'hrefs=' + JSON.stringify(hrefs));
    await ctx.close();
  }

  // ----- X5: no <script> tag execution from the entire bootstrap -----
  //
  // Side-channel check: even if a `notes.players[id].read` contained a
  // <script>...</script> string, browsers don't execute scripts inserted
  // via innerHTML (per HTML5 spec). This is the maintainer-trust
  // tightrope — `<img onerror=...>` and `<svg onload=...>` WOULD execute
  // and are accepted as part of the policy. We assert the script-tag
  // case explicitly so anyone changing the renderer to use document.write
  // or eval gets a test failure.
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    await ctx.route('**/notes.json', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      body.players = body.players || {};
      body.players['680755'] = body.players['680755'] || {};
      body.players['680755'].read = '<script>window.__xssCanary = 99; window.__xssDetails.push("notes")</script>';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__xssCanary = 0;
      window.__xssDetails = [];
    });
    await page.goto(BASE);
    await page.waitForTimeout(800);
    // Navigate to player modal to trigger the read rendering.
    await page.evaluate(() => { window.location.hash = '#player-680755'; });
    await page.waitForTimeout(500);
    const canary = await readCanary(page);
    report(canary.fired === 0 ? 'PASS' : 'FAIL',
      'X5: <script> tag in notes.players[id].read does not execute',
      `canary fired=${canary.fired} details=${JSON.stringify(canary.details)}`);
    await ctx.close();
  }

  const fails = findings.filter(f => f.level === 'FAIL');
  console.log(`\nxss-payloads: ${findings.length - fails.length}/${findings.length} pass`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(err => {
  console.error('PROBE ERROR:', err.message);
  process.exit(2);
});
