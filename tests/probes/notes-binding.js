/* ============================================================
   Probe: notes.json key binding
   PR-C — Layer + content hygiene (COG-359).

   Audit H13 + H14 surfaced a class of bug where notes.json content
   was being authored but never reaching the DOM because of
   case-sensitive key mismatches between consumer code and the JSON
   schema. This probe walks every notes.json string the renderer
   reads and asserts it appears in the rendered DOM after tab
   activation.

   The two specific instances closed by PR-C:
     H13  Two pitch team-notes dropped (Four-Seam vs Four-seam,
          Two-Seam vs Two-seam casing mismatch between
          stat_school.json's pitch names and notes.json's keys).
     H14  team.strengths_note + softspots_note in team-stats.js
          vs team.strengths / softspots in notes.json
          (the schema uses arrays of bullet strings, not _note
          suffixed scalars).

   Run from repo root with a static server up at :8001:
     python3 -m http.server 8001 &
     NODE_PATH=/opt/node22/lib/node_modules node tests/probes/notes-binding.js
   ============================================================ */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.JT_BASE || 'http://localhost:8001/index-v2.html';
const findings = [];
const report = (level, name, detail) => {
  findings.push({ level, name, detail });
  console.log(`${level.padEnd(4)} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForFunction(() => {
    const ov = document.getElementById('tab-overview');
    return ov && !ov.querySelector('.panel-skeleton');
  }, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);

  // Load notes.json from disk so the probe asserts against the source
  // of truth — not whatever the page chose to render.
  const repoRoot = path.resolve(__dirname, '..', '..');
  const notes = JSON.parse(fs.readFileSync(path.join(repoRoot, 'notes.json'), 'utf8'));
  const statSchool = JSON.parse(fs.readFileSync(path.join(repoRoot, 'stat_school.json'), 'utf8'));

  // ----- N1: Stat School pitch team-notes — every key in notes.pitches
  // either matches a stat_school.json.pitches[].name OR appears in the
  // rendered Stat School tab. The case-mismatch finding (H13) was
  // specifically that "Four-Seam Fastball" / "Two-Seam Fastball /
  // Sinker" in notes.json had no matching pitch card because
  // stat_school.json used lowercase 'seam'. -----
  await page.evaluate(() => { window.location.hash = 'stat-school'; });
  await page.waitForTimeout(800);

  const ssPitchNames = (statSchool.pitches || []).map(p => p.name);
  const notesPitchKeys = Object.keys(notes.pitches || {});
  const matched = notesPitchKeys.filter(k => ssPitchNames.indexOf(k) !== -1);
  const orphaned = notesPitchKeys.filter(k => ssPitchNames.indexOf(k) === -1);

  // The two key cases are case-sensitive; verify the rename.
  const fourSeamOk = ssPitchNames.indexOf('Four-seam Fastball') !== -1
    && notesPitchKeys.indexOf('Four-seam Fastball') !== -1;
  const twoSeamOk = ssPitchNames.indexOf('Two-seam Fastball / Sinker') !== -1
    && notesPitchKeys.indexOf('Two-seam Fastball / Sinker') !== -1;
  report(fourSeamOk ? 'PASS' : 'FAIL',
    'N1a: notes.pitches has "Four-seam Fastball" (matches stat_school)',
    'present=' + (notesPitchKeys.indexOf('Four-seam Fastball') !== -1));
  report(twoSeamOk ? 'PASS' : 'FAIL',
    'N1b: notes.pitches has "Two-seam Fastball / Sinker" (matches stat_school)',
    'present=' + (notesPitchKeys.indexOf('Two-seam Fastball / Sinker') !== -1));

  // Each pitch card that has a matching notes entry should render its note.
  for (const pitchName of ssPitchNames) {
    if (!notes.pitches || !(pitchName in notes.pitches)) continue;
    const noteText = notes.pitches[pitchName];
    // First 30 chars (stripped of HTML) should appear somewhere in the
    // pitch-types section. Use a coarse substring check — exact match
    // is fragile when the renderer escapes / re-flows content.
    const needle = noteText.replace(/<[^>]+>/g, '').slice(0, 30).trim();
    const found = await page.evaluate((n) => {
      const sec = document.getElementById('stat-school-pitches');
      if (!sec) return false;
      return sec.textContent.indexOf(n) !== -1;
    }, needle);
    report(found ? 'PASS' : 'FAIL',
      `N1: pitch "${pitchName}" team-note renders`,
      'needle="' + needle + '"');
  }

  // ----- N2: Team Stats — notes.team.strengths[0] + softspots[0]
  // render in the Strengths and Soft spots panel. -----
  await page.evaluate(() => { window.location.hash = 'team-stats'; });
  await page.waitForTimeout(800);

  const teamNotes = notes.team || {};
  const strengthsArr = Array.isArray(teamNotes.strengths) ? teamNotes.strengths : [];
  const softspotsArr = Array.isArray(teamNotes.softspots) ? teamNotes.softspots : [];

  if (strengthsArr.length > 0) {
    const needle = strengthsArr[0].replace(/<[^>]+>/g, '').slice(0, 40).trim();
    const found = await page.evaluate((n) => {
      const body = document.getElementById('tab-team-stats');
      return body && body.textContent.indexOf(n) !== -1;
    }, needle);
    report(found ? 'PASS' : 'FAIL',
      'N2a: notes.team.strengths[0] renders in Team Stats tab',
      'needle="' + needle + '"');
  } else {
    report('WARN', 'N2a: notes.team.strengths is empty — nothing to assert');
  }
  if (softspotsArr.length > 0) {
    const needle = softspotsArr[0].replace(/<[^>]+>/g, '').slice(0, 40).trim();
    const found = await page.evaluate((n) => {
      const body = document.getElementById('tab-team-stats');
      return body && body.textContent.indexOf(n) !== -1;
    }, needle);
    report(found ? 'PASS' : 'FAIL',
      'N2b: notes.team.softspots[0] renders in Team Stats tab',
      'needle="' + needle + '"');
  } else {
    report('WARN', 'N2b: notes.team.softspots is empty — nothing to assert');
  }

  // ----- N3: Players modal — notes.players[<id>].read renders -----
  //
  // Pick the first player ID with a non-empty note + active roster,
  // open their modal, assert the prose appears.
  const playerNotes = notes.players || {};
  // Resolve roster from rendered state (it's exposed on window.JT_STATE).
  const rosterIds = await page.evaluate(() => {
    const s = window.JT_STATE;
    if (!s) return [];
    const r = (s.data && s.data.roster) || {};
    return [].concat(r.hitters || [], r.pitchers || []).map(p => String(p.id));
  });
  const candidates = Object.keys(playerNotes).filter(id => rosterIds.indexOf(id) !== -1);
  if (candidates.length > 0) {
    const id = candidates[0];
    const note = playerNotes[id];
    const needleSrc = (note && (note.read || note.recentNote)) || '';
    const needle = needleSrc.replace(/<[^>]+>/g, '').slice(0, 40).trim();
    await page.evaluate((pid) => { window.location.hash = 'player-' + pid; }, id);
    await page.waitForTimeout(600);
    const found = await page.evaluate((n) => {
      const scrim = document.getElementById('player-modal-scrim');
      return scrim && scrim.classList.contains('show')
        && scrim.textContent.indexOf(n) !== -1;
    }, needle);
    report(found ? 'PASS' : 'FAIL',
      `N3: notes.players[${id}].read renders in modal`,
      'needle="' + needle + '"');
  } else {
    report('WARN', 'N3: no roster-matched note found — skip');
  }

  const fails = findings.filter(f => f.level === 'FAIL');
  console.log(`\nnotes-binding: ${findings.length - fails.length}/${findings.length} pass`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(err => {
  console.error('PROBE ERROR:', err.message);
  process.exit(2);
});
