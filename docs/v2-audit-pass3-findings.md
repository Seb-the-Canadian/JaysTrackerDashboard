# v2 audit — pass 3 findings (2026-06-05)

Third pass over the Blue Jays 2026 Tracker v2 dashboard, surface-by-surface,
covering every row in `docs/v2-validation-matrix.md` (lines 38–129) plus the
"Likely problem areas" the user flagged after passes 1+2 missed obvious bugs.

**Probe driver:** Playwright, Chromium, viewport `1280×1100` @ DPR 3 (plus
`375×800`, `480×900`, `1024×768`, `760×1100` sweeps). Real `data.json` from
the repo root. Screenshots saved under `/tmp/audit-*.png` (kept for the
session).

**Coverage:** 25 probe runs across 14 audit scripts. Both themes. Tab order
walked end-to-end. Edge fixtures injected via `page.route('**/data.json')`.

**Severity legend:** `blocker` · `important` · `nit`.
**Dimension legend:** Data / Behavior / Visual / A11y / Edge.

---

## Top findings by severity

| # | Finding | Severity | Dimension |
|---|---|---|---|
| V10 | `F.signed(-7)` returns `-7` with ASCII hyphen-minus → the 46px `--t-display` KPI run-differential reads as "underscore-7" | important | Visual |
| V11 | Recent-games `.res` score (`7-2`, `3-7`, `3-4`) uses MLB API's literal ASCII hyphen-minus — same low-glyph problem at 13px mono | important | Visual |
| V12 | Stat School run_differential value pill renders `-7` (ASCII), Pythag pill `31-32` (ASCII record) — same low-dash issue | important | Visual |
| V13 | Run-diff chart annotation "2-8 vs MIA" uses ASCII hyphen-minus in worst-game callout | nit | Visual |
| V14 | Opposing-pitcher modal placeholders use bare `b.textContent = '—'` at 25px without `.ph` lift — looks like a heavy underline above the labels | important | Visual |
| V15 | `opp_context` line "30-33, 3rd AL East" uses ASCII hyphen-minus from raw record string | nit | Visual |
| B4 | Modal-internal theme toggle flips the document but never updates the **page-level** `#theme-glyph` — after closing the modal, header glyph is wrong-direction | important | Behavior |
| B5 | `#il-chip` is keyboard-focusable with `aria-label="Open injury list"` but `hookIlChip` is a no-op (`void state`) — false affordance, no popover ever opens | important | A11y / Behavior |
| B6 | Team Stats segmented control (`.seg button`) has no ARIA role, `aria-pressed`, or `aria-label` — invisible to screen readers as a toggle | important | A11y |
| V16 | Player cards truncate names broadly at narrowing widths (21/26 names ellipsized at 1024px and 760px) — Hot/Cold pill + stat column eat the row width | important | Visual / Edge |

(See per-surface sections below for full pass/warn/fail breakdown of every
matrix row.)

---

## Surface-by-surface

### Header

| Element | Data | Behavior | Visual | A11y | Edge |
|---|---|---|---|---|---|
| Refresh badge (`#refreshed`) | pass | pass | pass | pass | pass |
| Notes-refresh badge | pass | pass | pass | pass | pass |
| IL count chip | pass | **FAIL B5** | pass | **FAIL B5** | pass |
| Theme toggle | pass | pass | pass | pass | pass |
| Tabs (4-tab IA) | pass | pass | pass | pass | pass |

**B5 — IL chip: false affordance, no handler [important, A11y/Behavior]**

Repro: Tab into header, focus the IL chip (it shows the focus ring), press
Enter. Nothing happens. Same with mouse click.

In `render.js:284`, `hookIlChip` is `function hookIlChip(state) { void state; }`
— explicitly a placeholder for the popover follow-up. But:

- The button has `aria-label="Open injury list"` (`index-v2.html:440`) and a
  visible `cursor: pointer` (`.il-chip` rules in the stylesheet).
- Screen readers will announce "Open injury list, button" but pressing
  space/enter does nothing — a classic dead control.

**Fix:** Either (a) ship the popover, or (b) until then, remove
`aria-label="Open injury list"`, set `aria-disabled="true"`, drop `cursor:
pointer`, and surface "14 injuries — list view coming soon" as a tooltip /
hover hint. Approach (b) is the documentation-only mitigation.

**Header chrome that passed:**

- `#brand-title` is populated from `config.json` (probe 1 boot check passes).
- `#hdr-rec-line` correctly displays `30–33` with en-dash (en-dash baked into
  `render.js:97`, line `(wOk ? w : wRaw) + '–' + (lOk ? l : lRaw)`).
- `#freshness-detail` shows `Daily · 09:00 UTC`, `#notesStale` shows "Analyst
  voice: refreshed today".
- `#theme-toggle` glyph correctly flips between ☾ (light) and ☀ (dark) on
  page-level click. Dark mode persists via `localStorage.jt-theme`.
- Tab `<a>` elements carry `role="tab"`, `aria-selected` (toggled by
  `showTab`), tab `:focus-visible` ring at 2px solid `--team-primary-ink`,
  contrast verified `rgb(19,74,142)` against light card bg.

---

### Overview tab

| Element | Data | Behavior | Visual | A11y | Edge |
|---|---|---|---|---|---|
| KPI Record (W-L · pct · place) | pass | pass | pass | pass | pass |
| KPI Pythag projection | pass | pass | pass | pass | pass |
| KPI Run differential | pass | pass | **FAIL V10** | pass | pass |
| KPI Last 10 | pass | pass | pass (en-dash) | pass | pass |
| Run-diff chart (SVG) | pass | pass | pass (uses U+2212 for axis "−7") | pass | pass |
| Recent & upcoming panel header | pass | pass | pass | pass | pass |
| Recent game card × 3 | pass | pass | **FAIL V11** | pass | pass |
| Upcoming game card × 3 | pass | pass | warn V15 | pass | pass |
| AL East standings rows × 5 | pass | pass | pass (en-dash records, `--` GB-tag for me-row) | pass | pass |
| Wild Card panel | pass | pass | pass (em-dash via `.ph` lift) | pass | pass |
| Voices panel (RSS list) | pass | pass | pass | pass | pass (empty state renders "No items today.") |
| Overview narrative (notes.json) | pass | pass | pass | pass | pass (absent-key state → panel omitted) |

**V10 — KPI Run differential: ASCII hyphen-minus at 46px reads as underscore [important, Visual]**

This is the headline regression the user flagged. The big "-7" KPI tile
renders ASCII `-` (U+002D, hyphen-minus) immediately before "7". At the
`--t-display: 46px` size with `font-weight: 800`, the hyphen-minus sits at
the font's typographic midline — visually well below the digit's optical
center. Reading it left-to-right it parses as "underscore-7", not "minus
seven".

Repro:
1. Open `http://localhost:8181/index-v2.html`.
2. Look at the second KPI tile labeled `RUN DIFFERENTIAL`. The value reads
   "-7".
3. Screenshot: `/tmp/audit-zoom-rundiff-light.png` and `…-dark.png`.

Root cause is in `assets/format.js:62`:

```js
function signed(value) {
  if (!isFiniteNumber(value)) return DASH;
  var n = Number(value);
  if (n === 0) return '0';
  return (n > 0 ? '+' : '') + n;
}
```

The negative branch returns `String(n)` which gives ASCII `-7`. The same
helper feeds the Last-10 frame line "-1 run diff over the last 10" and the
Stat School run_differential value pill — every signed-negative on the
dashboard inherits this.

**Fix candidate (inline):** Replace the negative branch with U+2212 (Unicode
minus sign):

```js
return n > 0 ? '+' + n : '−' + Math.abs(n);
```

Unicode minus sits at the visual midline and aligns with `+` perfectly.
Single point of change, zero render-site updates needed. Test note: any
test that asserts on `signed(-7) === '-7'` will need to update to `'−7'`.

---

**V11 — Recent-game scores: literal hyphen in `g.score` [important, Visual]**

Game scores like `7-2`, `3-7`, `3-4` render with ASCII hyphen-minus (the raw
MLB Stats API field). At 13px mono, the hyphen sits at midline like a low
underline between the digits.

Repro:
- Screenshot `/tmp/audit-zoom-game-res-light.png` shows "W  7-2" — the "-"
  is well below the baseline of the 7 and 2.

In `data.json`, `recent_games[*].score` is `"2-8"`, `"8-1"`, etc. — server-
side ASCII. The renderer at `overview.js:424` does
`document.createTextNode(g.score || '')` unchanged.

**Fix candidate (inline):** Normalize in `renderRecentGame`:

```js
document.createTextNode((g.score || '').replace('-', '–'))
```

Or move to a `F.scoreLine(g.score)` helper that returns an en-dash variant.
Note: en-dash `–` (U+2013) is the typographic convention for between two
related numbers (scores, ranges), separate from minus sign U+2212.

---

**V12 — Stat School run_differential / Pythag value pills [important, Visual]**

The per-stat card value pill in Stat School renders:

- `#ss-stat-run_differential .ss-stat-val-num` = `-7` (ASCII hyphen)
- `#ss-stat-pythag .ss-stat-val-num` = `31-32` (ASCII hyphen as record sep)

Both at ~17px font-size in the `.exp-h` header. Screenshots:
`/tmp/audit-zoom-ss-rundiff-val-light.png`, `…-ss-pythag-val-light.png`.

Root cause is in `assets/stat-school.js:166-170`:

```js
if (slug === 'run_differential' && team.run_diff !== undefined) {
  const v = Number(team.run_diff);
  return { val: (v >= 0 ? '+' : '') + v, rank: null };
}
if (slug === 'pythag' && team.pythag_w !== undefined) {
  return { val: team.pythag_w + '-' + team.pythag_l, rank: null };
}
```

**Fix candidate (inline):** Use U+2212 for run_differential negative branch
and en-dash for pythag record:

```js
return { val: (v >= 0 ? '+' + v : '−' + Math.abs(v)), rank: null };
// ...
return { val: team.pythag_w + '–' + team.pythag_l, rank: null };
```

If V10's fix to `F.signed` lands, the run_differential branch can defer to
`F.signed(team.run_diff)`.

---

**V13 — Run-diff chart annotation uses ASCII hyphen [nit, Visual]**

The chart's "worst game" callout below the bar reads `2-8 vs MIA` —
`overview.js:336`: `worstGame.score + ' ' + (worstGame.home ? 'vs ' : '@ ')`.
Same `g.score` field as V11.

Screenshot: `/tmp/audit-rd-chart.png`.

**Fix:** If V11's renderer-level normalization lands, this gets it for free
since it reads `worstGame.score`. Otherwise: apply the same `.replace('-',
'–')` inline.

(Note: the chart's axis labels correctly use Unicode minus — `addText(svg,
…, '−' + maxAbs, …)` at `overview.js:295`. So someone knew once; the value
labels just hadn't been chased through.)

---

**V15 — `opp_context` "30-33, 3rd AL East" uses ASCII hyphen [nit, Visual]**

The upcoming-game sub-line ("vs BAL · Jun 5 · 30-33, 3rd AL East") shows
the opponent's record with an ASCII hyphen-minus between W and L. The
hyphen reads as low at 10–11px mono. The rest of the dashboard
consistently uses en-dash for records (`30–33` in the header, AL East
standings, WC rows).

Repro: Screenshot `/tmp/audit-zoom-upcoming-light.png`.

Root cause is in `overview.js:434`:

```js
const rec = (ctx.w != null && ctx.l != null) ? ctx.w + '-' + ctx.l : '';
```

**Fix candidate (inline):** Use en-dash: `ctx.w + '–' + ctx.l`. Or
defer to a shared `F.record(w, l)` helper. Severity is "nit" because the
font size (~10–11px) keeps the dash compact enough to read as a separator
rather than an underline.

---

### Players tab

| Element | Data | Behavior | Visual | A11y | Edge |
|---|---|---|---|---|---|
| Group headers × 4 (named "Rotation/Bullpen/Catchers/Infield/Outfield/DH") | pass | pass | pass | pass | warn — matrix expected "Lineup/Bench" not the position split |
| Pcard avatar | pass | pass | pass | pass | pass |
| Pcard identity (name + meta) | pass | pass | **FAIL V16** | pass | pass |
| Pcard recent pill (Hot/Cold/New) | pass | pass | pass | pass | pass |
| Pcard primary stat + percentile badge | pass | pass | pass | pass | pass (stacked layout from V9 holds) |
| Pcard hover/focus affordance | pass | pass | pass | pass | pass |
| Modal avatar + identity | pass | pass | pass | pass | pass (long-name probe: doesn't truncate in modal title row) |
| Modal theme toggle | pass | **FAIL B4** | pass | warn | pass |
| Modal close (X) | pass | pass | pass | pass | pass |
| Modal SAV + MLB pills | pass | pass | pass | pass | pass |
| Modal slash line (hitter) | pass | pass | pass | pass | pass |
| Modal slash line (pitcher) | pass | pass | pass | pass | pass |
| Modal Statcast value line | pass | pass | warn | pass | pass |
| Modal "Where they rank" heat strips | pass | pass | pass | pass | pass (`.strip.strip-empty` correctly faded for unranked players) |
| Modal analyst note | pass | pass | pass | pass | pass |

**V16 — Player card names truncate at 1024px and below [important, Visual/Edge]**

The pcard layout uses `grid-template-columns: repeat(4, minmax(0, 1fr))` at
default widths (>980px), 3 columns at 980–680, 2 at 680–460, 1 below. At
1280px (the design target), no names truncate. At **1024px (iPad
landscape) every single 12-character-plus name truncates** — 21 of 26
players visible at that width:

```
[w=1024] Truncated names (21):
  "Braydon Fisher" scrollW=99 > offsetW=84
  "Kevin Gausman" scrollW=102 > offsetW=84
  ...
  "Vladimir Guerrero Jr." scrollW=134 > offsetW=84
  "Yohendrick Piñango" scrollW=130 > offsetW=84
```

`.pc-id b` has `text-overflow: ellipsis; white-space: nowrap`, so the
visual is ellipsized truncation (not overflow) — but at 84px of usable
width, almost everyone gets cut. Probe screenshot:
`/tmp/audit-tablet-players.png` — "Braydon F...", "Andrés Gi...",
"Vladimir Guerrero..." etc.

Repro:
1. Open the dashboard at viewport width 1024 (or any value 980–1100).
2. Navigate to Players tab.
3. Count truncated names. Same count at 760px (where layout is 3-col).

Root cause: the V9 layout refactor (Cmt: stacked value+label+badge) gave
back ~60px to the name column at 1280px, but at narrower widths the
percentile badge ("61st %ile") in the stacked layout still consumes ~50px
of the right-side cluster, leaving the name column squeezed.

**Fix candidate (suggested approach, non-trivial):** Either (a) tighten the
breakpoints so 4-col only applies above ~1200px and 3-col kicks in above
720, dropping to 2-col earlier — fewer truncations at intermediate widths;
or (b) shorten the rank badge label at narrow widths (e.g. drop "%ile" to
just "%" via media query inside `.pc-stat i small`).

(Note: at 1280px the layout is correct per V9's intent. The bug is the
gradient between 980 and 1280 — the grid still tries to fit 4 cards.)

---

**B4 — Modal theme toggle flips document but not page glyph [important, Behavior]**

Repro:
1. Open dashboard in light mode (default).
2. Click any player card to open modal.
3. Click the ☾ glyph inside the modal header (`.modal-theme`).
4. Document switches to dark mode (correct).
5. Modal glyph flips to ☀ (correct).
6. Close the modal via Esc or X.
7. **Page-level `#theme-glyph` still shows ☾** — wrong direction relative
   to actual mode. `data-theme="dark"`, `localStorage.jt-theme = 'dark'`,
   but page glyph says "switch to dark".

Probe output (from `/tmp/audit-11-edge.js`):
```
Modal theme toggle: { before: null, after: 'dark',
                      modalGlyph: '☀', pageGlyph: '☾' }
After close:        { finalTheme: 'dark', finalPageGlyph: '☾' }
```

Root cause: in `players.js:226-237`, the modal theme button only updates
its own glyph via the inner `updateThemeGlyph` closure. The page-level
glyph is updated only by the page-level button's `hookThemeToggle`
listener in `render.js:278`. The two are decoupled.

**Fix candidate (inline):** After `window.JaysTheme.toggleTheme()` in
either of the modal builders, also re-run the page-level glyph update —
extract `updateGlyph` to a shared utility on `window.JaysTheme` (e.g.
`JaysTheme.updateAllGlyphs()`), or have the page-level button subscribe
to a theme-change event the modal fires.

Same issue exists in `opponent-pitcher.js:69-71` (`glyph()` closure pattern
identical).

---

**Modal Statcast value line — warn (Visual)**

The hitter modal's Statcast metric line ("Statcast .359 xwOBA · 6.6%
Barrel% · 44.9% Hard-hit%") wraps the first two metrics in
`.term[data-stat]` but **Hard-hit% renders without the `.term`
affordance** because `hardhit_pct` is not in `stat_school.json`. This is
the documented degrade path per issue #125 — but the visual asymmetry
(two underlined, one plain) reads as a missing affordance even though
it's intentional. Severity: nit. Add `hardhit_pct` to stat_school.json to
restore symmetry; otherwise document the intent in the modal note or
copy.

---

**Group label expectation mismatch (Edge)**

The matrix lists groups as "Rotation / Bullpen / Lineup / Bench". The
actual renderer (`players.js:36-40`) emits "Starting rotation / Bullpen
/ Catchers / Infield / Outfield / Designated hitter". The split is
position-based, not lineup/bench-based — which is more useful per the
"Players grouped the way a card lists positions" subhead. Update the
matrix to match the implementation, or revisit the grouping per #26
(role-based player grouping).

---

### Opposing-pitcher modal (`#oppp-<id>`)

| Element | Data | Behavior | Visual | A11y | Edge |
|---|---|---|---|---|---|
| Identity + OPP-SP tag | pass | pass | pass | pass | pass |
| SAV + MLB pills | pass | pass | pass | pass | pass |
| Slash line (ERA/WHIP/IP/K) | pass | pass | pass when values present | pass | **FAIL V14** when null/placeholder |
| Footer note | pass | pass | pass | pass | pass |

**V14 — Opposing-pitcher placeholders render as heavy underlines [important, Visual]**

Repro (probe injects nulls):
1. Force `opponent_pitchers[<id>] = { era: null, whip: null, ip: null, k:
   null }` via `page.route('**/data.json')`.
2. Navigate to `#oppp-<id>`.
3. Modal renders four em-dashes at 25px font-size in the four slash cells.
4. Screenshot `/tmp/audit-oppp-placeholders.png`.

Root cause: `opponent-pitcher.js:112`:

```js
b.textContent = (v == null || v === '' || v === '-.--') ? '—' : v;
```

The em-dash is set as raw textContent on a `<b>` at slash-cell size (25px,
font-weight: 800). The `.ph` lift class is never applied. At that size the
em-dash sits significantly below the visual center of the cell, reading as
a thick underline above the label.

Today's real data has no null fields, so this only surfaces if a pitcher
ever lacks stats — but the rotation injury list is non-trivial so it will
hit eventually.

**Fix candidate (inline):** Replace the `<b>` text node with the same
`.ph`-wrapped pattern used elsewhere:

```js
if (v == null || v === '' || v === '-.--') {
  const ph = document.createElement('span');
  ph.className = 'ph';
  ph.setAttribute('aria-label', 'No value');
  ph.textContent = '—';
  b.appendChild(ph);
} else {
  b.textContent = v;
}
```

`tokens.css` `.ph` already provides the vertical-align lift; verify the
0.12em lift reads correctly at 25px or extend the class with a `.ph.big`
variant if needed.

---

### Team Stats tab

| Element | Data | Behavior | Visual | A11y | Edge |
|---|---|---|---|---|---|
| Strengths column | pass | pass | warn — mixes hitting + pitching stats under "Hitting" header | pass | pass |
| Soft Spots column | pass | pass | pass | pass | pass |
| Segmented control (Hitting/Pitching) | pass | pass | pass | **FAIL B6** | pass |
| Ledger row (label · value · strip · rank) | pass | pass | pass | pass | pass |
| Heat strip in ledger | pass | pass | pass | pass | pass |
| Per-stat ctx note (notes.team.ctx) | pass | pass | pass | pass | pass |

**B6 — Segmented control lacks ARIA toggle semantics [important, A11y]**

Repro:
1. Navigate to Team Stats tab.
2. Tab to the "Hitting/Pitching" segmented control.
3. Inspect the buttons with a screen reader / DOM inspector.

The buttons render as:
```html
<button class="on" data-group="hitting">Hitting</button>
<button data-group="pitching">Pitching</button>
```

Probe (`/tmp/audit-4-team-stats.js`):
```
SEG: [
  { text: "Hitting", group: "hitting", on: true, aria: null },
  { text: "Pitching", group: "pitching", on: false, aria: null },
]
```

No `role`, no `aria-pressed`, no `aria-label`. A screen reader announces
"Hitting, button" and "Pitching, button" but never communicates which is
currently selected, or that they're mutually exclusive. Sighted users see
the `.on` background tint; AT users get nothing.

**Fix candidate (inline):** Either:
- (a) Use `role="tab"` + `aria-selected` + parent `role="tablist"` — but
  the buttons swap the ledger panel, not panels with visible headings, so
  this is semantically loose.
- (b) Simpler: add `aria-pressed="true/false"` to each button, toggle in
  the click handler at `team-stats.js:232-238`. Add `aria-label="View
  hitting stats"` / `"View pitching stats"` for explicit labeling.

---

**Strengths column mixes groups — warn (Visual)**

The "Strengths" column shows `K/9 (7th)`, `AVG (9th)`, `BB/9 (10th)` — two
pitching stats and one hitting stat under what reads as a unified
column. The "Hitting/Pitching" segment control sits 50px below, suggesting
to the reader that the column above also splits by group. It doesn't:
`renderStrengthsSoftSpots` in `team-stats.js:76-110` computes top-3 across
both groups combined.

This is design intent ("the team's overall strengths regardless of group")
and matches the `.sss-row .sss-name` rendering, but a tag indicating which
group each stat belongs to would resolve the cognitive split. Severity:
warn / nit.

---

### Stat School tab

| Element | Data | Behavior | Visual | A11y | Edge |
|---|---|---|---|---|---|
| Sticky left index | pass | pass | pass | pass | pass |
| Keystone card | pass | pass | pass | pass | pass |
| Per-stat card | pass | pass | pass (modulo V12) | pass | pass |
| Stat scale-track (heat bar + tick) | pass | pass | pass | pass | pass |
| Per-stat percentile tick | pass | pass | pass | pass | pass |
| Disclosure (advanced only) | pass | pass | pass | pass | pass (collapsed by default) |
| Honesty card | pass | pass | pass | pass | pass |
| Pitch types grid | pass | pass | pass | pass | pass |

**Notes:**
- The earlier probe-9 selector miss ("ss-card") was the wrong class — the
  actual class is `.exp`. The 11 per-stat cards render correctly per the
  audit-5 probe.
- The Honesty card renders (selector `.honest`, id `stat-school-honesty`).
  The earlier probe missed it for the same selector reason.
- Pitch-types grid: 6 pitches × SVG break diagram + team-specific notes
  for each — all populated, all readable, no console errors.
- Sticky index scroll-spy: clicking "WHIP" scrolls to `#ss-stat-whip`,
  active class moves correctly (`/tmp/audit-stat-school-light.png` shows
  WHIP highlighted at scroll target).
- Deep-link `#stat-beyond` and `#stat-pitch-types` route via SPECIAL_SLUGS
  to the structural IDs — verified via the SPECIAL_SLUGS map and probe-9
  `tryOpenFromHash` regression guard.

---

### Cross-cutting

| Element | Data | Behavior | Visual | A11y | Edge |
|---|---|---|---|---|---|
| Stat tooltip (`.term[data-stat]`) | pass | pass | pass | pass | pass |
| Team tooltip (`[data-team]`) | pass | pass | pass | pass | pass |
| Schema-drift banner | pass | pass | pass | pass | pass |
| Hash routes | pass | pass | pass | pass | pass |
| Modal focus trap + restore | pass | pass | pass | pass | pass |

**Stat tooltip — pass.** Hover, focus, click all open the tooltip. Probe-7
hover test on Vlad's modal "OPS" term emitted a visible `.tip` with
non-zero opacity. Keyboard focus on `.term[tabindex="0"]` opens it via
the focusin handler. Affordance gate (issue #125 / B2) holds — slugs
without `stat_school.json` entries render as plain text, no dotted
underline. Probe-7 walked the tab sequence and saw `.term` elements for
"differential" and "Pythag" on Overview (both have entries).

**Team tooltip — pass.** Probe-7 confirmed `.opp` and `.abbr` spans are
keyboard-focusable, carry `data-team`, `aria-label="Opponent ATL"` /
`"Team TOR"`. Hover/focus-driven by the same delegation layer.

**Schema-drift banner — pass.** Probe-9 deleted `data.team` and
`data.team_stats` keys; banner rendered "Data schema warning: missing
fields — team, team_stats. Dashboard may render incompletely." with the
red-on-rose styling.

**Hash routes — pass.** Tab routing (probe-1, round-1 PROBE 2):

- `#overview` / `#players` / `#team-stats` / `#stat-school` all activate
  the right tab.
- `#stat-xwoba` from Overview → activates Stat School, scrolls.
- `#player-<id>` from Overview → activates Players tab, opens modal.

**Modal focus trap + restore — pass.** Probe-7 walked 15 Tab presses inside
the open modal and observed cycling through 8 focusable elements (ERA,
WHIP, ERA, WHIP, SAV, MLB, modal-theme, modal-x) then looping. Esc closes
modal; focus returns to the originating `.pcard`. Scrim corner click
closes modal AND restores hash to `#players` (probe-12 SCRIM CLICK output:
`{ before: '#player-680755', after: { hash: '#players', modalOpen: false }}`).

---

## Edge cases verified

- **Opening Day** (`recent_games = []`, `record = {w:0, l:0}`, `run_diff_last_10
  = []`): probe-12 shows KPI Record `0–0` correctly (en-dash via `kpiBig`),
  L10 KPI shows `0–0` and "0 run diff" frame, run-diff chart correctly
  omits (returns `null` from `renderRunDiffChart`). No JS errors.
- **Empty news**: probe-9 fulfilled `data.news = []` — Voices panel
  rendered the empty state "No items today." with the standard panel
  chrome.
- **Missing `opp_context`**: probe-11 set `upcoming_games[0].opp_context =
  null` — meta line correctly omits the comma-separated record, showing
  just the date. No layout break.
- **Long player name** ("Lorenzo Massimiliano-Castiglione III"): modal
  title bar fits cleanly (modal flexes); pcard ellipsizes with
  `text-overflow: ellipsis`. Truncation visible but graceful. (See V16
  for the broader real-data truncation issue.)
- **No JS errors observed** across 25 probe runs and 14 edge fixtures.
  Only certificate warnings from external CDN fetches (preconnect
  warnings, not errors).
- **Mobile** (`375×800`, `480×900`): all four tabs have zero horizontal
  overflow (`scrollWidth === clientWidth` at every tab). Sticky stat-school
  index collapses to horizontal flex row at `<860px` per the CSS media
  query. Touch-friendly: pcards remain tappable at 375px width.
- **Tablet** (`1024×768`): main failure mode is the pcard truncation
  documented in V16.

---

## Did NOT change

- `docs/v2-validation-matrix.md` — left intact per instructions; new file
  written separately.
- No code modifications. All findings are documentation + repro steps for
  the parent agent / human to triage.
- No PR opened, no branches pushed.

---

## Recap of immediate small fixes for the parent agent's queue

These are the V/B findings with a one-touch or two-touch inline fix —
suitable to roll into the existing `claude/dash-alignment-fix` branch:

1. **V10** — Change `F.signed` to use Unicode minus (one line in
   `assets/format.js:62`).
2. **V11** — Normalize `g.score` hyphen → en-dash in `renderRecentGame`
   (one line in `assets/overview.js:424`).
3. **V12** — Use Unicode minus + en-dash in `stat-school.js:166-170`
   (two lines).
4. **V13** — Auto-resolved if V11 lands (chart annotation reads the same
   `worstGame.score`).
5. **V14** — Replace bare `b.textContent = '—'` with the `.ph`-wrapped
   pattern (5-line block in `opponent-pitcher.js:112`).
6. **V15** — En-dash in `oppContextStr` (one line in `overview.js:434`).
7. **B4** — Extract `updateThemeGlyph` to `JaysTheme.updateAllGlyphs()`
   (or fire a theme-change event the page-level button listens for); call
   from both modal builders after `toggleTheme`. Probably 6–8 lines.
8. **B6** — Add `aria-pressed` + `aria-label` to the `.seg button`s
   (three lines in `team-stats.js:252-254` markup + one line in the click
   handler at `:232-238` to toggle `aria-pressed`).

These NOT suitable for the same branch (non-trivial):

- **B5** — needs a product decision (ship the IL popover, or
  documentation-only mitigation that removes the dead affordance). Either
  way is more than a one-line change.
- **V16** — needs a layout pass at intermediate widths; either a
  breakpoint shift or a media-query badge compression. Best as its own
  PR / matrix entry tracked alongside #26 (role-based grouping).

---

## Coverage caveats

- Real `data.json` only covers one slice of the data shape. Edge fixtures
  injected via `page.route` cover the common degraded paths (empty
  arrays, null placeholders, missing keys) but a stranger combination
  (e.g. partial player_ranks with one stat null and others valid) wasn't
  exhaustively probed.
- Chromium only (Playwright default). No Safari/Firefox sweep — em-dash
  vertical-align behavior is consistent in modern engines but the
  ASCII-hyphen findings would surface differently on systems with
  different font-fallback chains (the dashboard uses Hanken Grotesk via
  Google Fonts; offline / blocked-CDN render would shift to system sans).
- No screen-reader audit (NVDA/JAWS/VoiceOver). ARIA attribute presence
  is verified; lived experience is not.
- No actual MLB-data refresh validation — `statsapi.mlb.com` is blocked
  per CLAUDE.md, so the fetcher path wasn't exercised. All findings are
  client-side rendering against committed `data.json`.
