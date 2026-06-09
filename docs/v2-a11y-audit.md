# v2 a11y audit — Phase 1 (2026-06-06)

Systematic accessibility sweep of the Blue Jays 2026 Tracker v2 dashboard
(`index-v2.html`). Mirrors the structure of `docs/v2-validation-matrix.md`
and `docs/v2-audit-pass3-findings.md` so a future maintainer can extend it
in subsequent passes.

**Probe driver:** Playwright Chromium + `@axe-core/playwright` 4.10. Viewport
`1280×1100`. Both themes (`data-theme="light"` / `"dark"`). Configured rule
set: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice`.

**Scans (16 total):**

- 4 tabs × 2 themes = 8 default-state scans.
- 4 transient surfaces × 2 themes = 8 transient scans:
  - IL popover open (header chip click).
  - Player modal open (first `.pcard` click on Players tab).
  - Opposing-pitcher modal open (`#oppp-<id>` deep-link).
  - Stat tooltip focused (`.term[data-stat]` keyboard focus on Overview).

Probe sources: `/tmp/audit-axe-scan.js` (axe runner),
`/tmp/audit-manual-walks.js` (heading hierarchy, focus order, label coverage,
img/svg alt audit, live-region inventory, focus-ring computed style,
Tab-key walk from page top), `/tmp/audit-modal-popover.js` (transient
surface ARIA + focus management).

Raw machine output kept at `/tmp/audit-axe-results.json`,
`/tmp/audit-manual-walks.json`, `/tmp/audit-modal-popover.json` for the
session.

**Severity legend:** `blocker` · `important` · `nit`.
**Dimension legend:** Contrast / Keyboard / SR (screen-reader) / Live / Structure.

---

## Top findings by severity

| #   | Finding                                                                                          | Severity   | Dim       |
|-----|--------------------------------------------------------------------------------------------------|------------|-----------|
| A1  | Body-meta text (`#brand-sub`, `#hdr-rec-detail`, `#freshness-detail`, `#notesStale`, footer `<span>`, `.sort-hint`, `.idx-grp`) `#8a93a1` on `#f4f0e6` / `#fffdf8` paper — 2.72:1 / 3.05:1, well below 4.5:1 AA for small text | blocker  | Contrast  |
| A2  | IL chip `#il-count` warning circle: white on `#d98a4e` orange — 2.72:1 at 10px bold. Below 4.5:1 AA. Also `.warn` legend text uses same orange on paper (2.68:1) | blocker  | Contrast  |
| A3  | Comparison row strips on player modal (`.c-strip > i`, `.c-rank.m4 small`) `#b3b9c4` / `#4a5260` on paper — 1.93:1 and 2.09:1. Lowest ratios in the build | blocker  | Contrast  |
| A4  | Wild-card "me" GB cell (`.me.wc-row .gb`) `#8a93a1` on `#e6ecf4` highlight — 2.61:1 | important | Contrast  |
| A5  | `.sss-row .rank-num.m2` and `.ss-stat-val-rank.m2 small` (green rank text on paper) — 3.14:1 (#5b9e6f / #fffdf8) | important | Contrast  |
| A6  | `.srctag.machine` panel-header chips — `#737d8c` on `#eef0f3` light = 3.64:1; `#737d8c` on `#262b34` dark = 3.41:1 | important | Contrast  |
| A7  | Stat School pitch-card velocity (`.pitch .velo`) in dark mode — orange `#c24e2c` on `#1b1f27` = 3.47:1 at 11px bold | important | Contrast  |
| A8  | KPI projection band (`.kpi .kf b`, `.cutline`, `.bad`) — orange `#c0644f` on dark paper at 12.5px bold = 4.07:1, just below 4.5:1 | important | Contrast  |
| A9  | KPI metadata captions (`.kl`, `.km`, `.spacer`, panel `.hint`, `.gcol .ghd`) — `#8a93a1` on light paper at 10.5–12px = 3.05:1; dark twin `#727b89` on `#1b1f27` = 3.86:1. 110 unique selectors in light, 110 in dark | important | Contrast  |
| A10 | `.rd-chart` SVG (Run-diff chart) is data-bearing but has no `role="img"` and no `aria-label`/`<title>` — invisible to screen readers despite being the headline chart | important | SR        |
| A11 | Brand `.mark` decorative SVG (the white diamond) and 6 `.diag` pitch-trajectory SVGs lack `aria-hidden="true"` — AT users hear empty graphic landmarks | important | SR        |
| A12 | Schema-drift banner (`#schemaBanner`) has no `role="alert"` or `aria-live="assertive"` — silently appears, no announcement | important | Live      |
| A13 | IL popover (`#il-popover`) opens but contains no focusable items — keyboard users open the popover, Tab leaves to `#theme-toggle`, never reads the list. Plus no `aria-live`, no `aria-labelledby` | important | Keyboard / Live |
| A14 | `.appbar` chrome (record, IL chip, theme toggle, source key) and `.tabs` nav sit outside any landmark — axe `region` rule fires on every scan. No `<nav>` for the appbar, no `<header>` role, no skip-link | important | Structure |
| A15 | No skip-link — keyboard users hit IL chip, theme toggle, 4 tabs (6 stops) before reaching tab content. On Overview the first content stop is a `.term` 7 stops in | nit       | Keyboard  |
| A16 | `.term[data-stat]` tooltip element (`#jays-tooltip`) has `role="tooltip"` but no `aria-live` and is shared across all terms — content swap is silent for AT users | nit       | Live      |
| A17 | Light-mode focus ring uses `--team-primary-ink` = `rgb(19, 74, 142)` — 7.8:1 on light card surfaces, comfortable. Dark mode also passes (`color-mix(50% primary, 50% white)` — handoff §5 verified) | n/a       | pass      |
| A18 | Heading hierarchy: each tab body has a single `<h2>` then `<h3>` children. Page H1 = "Blue Jays 2026 Tracker". Voices panel uses `<h4>` for RSS items under `<h3>` — clean. Player modal title not in document outline (still inside `<dialog>` semantics) | n/a       | pass      |
| A19 | Color is sole indicator of segmented-control active state in Team Stats (`.seg button.on`). Pass-3 added `aria-pressed`, so AT users get the state; sighted low-vision users still rely on background tint contrast (3.7:1 light) | nit       | SR        |
| A20 | Tabs `<a>` use `role="tab"` + `aria-selected`, but `aria-controls` is not set; pairing relies on `aria-labelledby` from the panel side only | nit       | SR        |

**Total axe violations:** 1011 individual node failures across the 16 scans
(dominated by repeating contrast issues). After clustering by `fg|bg`
pair there are 18 distinct color-pair failures and 2 distinct rule
failures (`color-contrast`, `region`, plus `scrollable-region-focusable`
on the IL popover).

Of the 20 findings above, **14 have inline-tractable fixes** — small CSS
or ARIA changes the parent can dispatch as a follow-up PR. See the
"Tractable inline fixes" section at the end.

---

## Surface-by-surface matrix

Severity column uses worst finding hit on that surface. `pass` = no axe
hits + no manual-walk issues. `warn` = nit-tier only. `fail` = important
or blocker.

### Header

| Element                                   | Contrast | Keyboard | SR     | Live   | Structure |
|-------------------------------------------|----------|----------|--------|--------|-----------|
| `#brand-title` (H1)                       | pass     | pass     | pass   | pass   | warn A14  |
| `#brand-sub` ("v2 build" caption)         | FAIL A1  | pass     | pass   | pass   | warn A14  |
| Brand `.mark` SVG (white diamond)         | n/a      | pass     | FAIL A11 | pass | warn A14  |
| `#hdr-rec-line` (W–L)                     | pass     | pass     | pass   | pass   | warn A14  |
| `#hdr-rec-detail` (".476 · 4th AL East")  | FAIL A1  | pass     | pass   | pass   | warn A14  |
| IL chip (`#il-chip`)                      | warn     | pass     | pass   | pass   | warn A14  |
| IL count circle (`#il-count`)             | FAIL A2  | pass     | pass   | pass   | warn A14  |
| Freshness label (`#freshness-label`)      | warn     | pass     | pass   | pass   | warn A14  |
| Freshness detail (`#freshness-detail`)    | FAIL A1  | pass     | pass   | pass   | warn A14  |
| Notes-stale chip (`#notesStale`)          | FAIL A1  | pass     | pass   | pass   | warn A14  |
| Source-key items (`.srckey .k`)           | warn     | n/a      | pass   | pass   | warn A14  |
| Theme toggle (`#theme-toggle`)            | pass     | pass     | pass   | pass   | warn A14  |
| Tabs nav                                  | pass     | pass     | warn A20 | pass | warn A14  |
| Footer colophon                           | FAIL A1  | n/a      | pass   | pass   | warn A14  |

### Overview tab

| Element                                | Contrast | Keyboard | SR     | Live   | Structure |
|----------------------------------------|----------|----------|--------|--------|-----------|
| KPI Record                             | FAIL A9  | pass     | pass   | pass   | pass      |
| KPI Pythag projection                  | FAIL A9  | pass     | pass   | pass   | pass      |
| KPI Run differential                   | FAIL A9  | pass     | pass   | pass   | pass      |
| KPI Last 10                            | FAIL A9  | pass     | pass   | pass   | pass      |
| KPI `.kf b` warning bands (.bad/.warn) | FAIL A8  | pass     | pass   | pass   | pass      |
| Run-diff chart (SVG)                   | pass     | pass     | FAIL A10 | pass | pass      |
| Recent & upcoming panel header         | warn A6  | pass     | pass   | pass   | pass      |
| Recent-game `.gcol .ghd` labels        | FAIL A9  | pass     | pass   | pass   | pass      |
| Upcoming-game `.meta small` rows       | FAIL A9  | pass     | pass   | pass   | pass      |
| Game `.wp.matchup small` (probable SP) | FAIL A9  | pass     | pass   | pass   | pass      |
| AL East standings rows                 | pass     | pass     | pass   | pass   | pass      |
| Wild Card panel ("me" row GB)          | FAIL A4  | pass     | pass   | pass   | pass      |
| Voices panel (RSS list)                | pass     | pass     | pass   | pass   | pass      |
| Overview narrative                     | pass     | pass     | pass   | pass   | pass      |

### Players tab

| Element                                  | Contrast | Keyboard | SR     | Live   | Structure |
|------------------------------------------|----------|----------|--------|--------|-----------|
| Group headers × 6 (.ghd)                 | FAIL A9  | pass     | pass   | pass   | pass      |
| Pcard avatar                             | pass     | pass     | pass   | pass   | pass      |
| Pcard identity (name + meta)             | warn     | pass     | pass   | pass   | pass      |
| Pcard recent pill (Hot/Cold/New)         | pass     | pass     | pass   | pass   | pass      |
| Pcard primary stat (`.kf b`)             | warn A8  | pass     | pass   | pass   | pass      |
| Pcard `.pc-stat i small` (% caption)     | FAIL A9  | pass     | pass   | pass   | pass      |
| Pcard hover/focus affordance             | pass     | pass     | pass   | pass   | pass      |
| Player modal avatar + identity           | pass     | pass     | pass   | pass   | pass      |
| Player modal theme toggle                | pass     | pass     | pass   | pass   | pass      |
| Player modal close (X)                   | pass     | pass     | pass   | pass   | pass      |
| Player modal SAV/MLB pills               | pass     | pass     | pass   | pass   | pass      |
| Player modal slash line                  | FAIL A9  | pass     | pass   | pass   | pass      |
| Player modal "WHERE THEY RANK" rows      | FAIL A9  | pass     | pass   | pass   | pass      |
| Player modal `.c-strip > i` (compare)    | FAIL A3  | pass     | pass   | pass   | pass      |
| Player modal `.c-rank.m4 small`          | FAIL A3  | pass     | pass   | pass   | pass      |
| Player modal analyst note                | pass     | pass     | pass   | pass   | pass      |

### Opposing-pitcher modal

| Element                  | Contrast | Keyboard | SR     | Live   | Structure |
|--------------------------|----------|----------|--------|--------|-----------|
| Identity + OPP-SP tag    | pass     | pass     | pass   | pass   | pass      |
| SAV + MLB pills          | pass     | pass     | pass   | pass   | pass      |
| Slash line ERA/WHIP/IP/K | FAIL A9  | pass     | pass   | pass   | pass      |
| Slash label captions     | FAIL A1  | pass     | pass   | pass   | pass      |
| Footer note              | pass     | pass     | pass   | pass   | pass      |

### Team Stats tab

| Element                                  | Contrast | Keyboard | SR       | Live   | Structure |
|------------------------------------------|----------|----------|----------|--------|-----------|
| Strengths column                         | warn A5  | pass     | pass     | pass   | pass      |
| Soft Spots column                        | warn     | pass     | pass     | pass   | pass      |
| `.sss-row .rank-num.m4` (red rank text)  | warn A6  | pass     | pass     | pass   | pass      |
| `.sss-row .rank-num.m2` (green)          | FAIL A5  | pass     | pass     | pass   | pass      |
| Segmented control (Hitting/Pitching)     | warn A19 | pass     | pass (pass-3 wire) | pass | pass |
| Ledger row label/value                   | pass     | pass     | pass     | pass   | pass      |
| Ledger row `.tbl-row .c-rank.m4 small`   | FAIL A3  | pass     | pass     | pass   | pass      |
| Heat strip in ledger                     | pass     | pass     | pass     | pass   | pass      |
| Per-stat ctx note                        | pass     | pass     | pass     | pass   | pass      |

### Stat School tab

| Element                                       | Contrast | Keyboard | SR     | Live   | Structure |
|-----------------------------------------------|----------|----------|--------|--------|-----------|
| Sticky left index `.idx-grp` group label      | FAIL A1  | pass     | pass   | pass   | pass      |
| Sticky left index items `.idx-item`           | pass     | pass     | pass   | pass   | pass      |
| Keystone card                                 | pass     | pass     | pass   | pass   | pass      |
| Per-stat card header                          | pass     | pass     | pass   | pass   | pass      |
| Per-stat val pill `.ss-stat-val-rank.m4`      | FAIL A1  | pass     | pass   | pass   | pass      |
| Stat scale-track (heat bar)                   | pass     | pass     | pass   | pass   | pass      |
| Per-stat percentile tick                      | pass     | pass     | pass   | pass   | pass      |
| Disclosure toggle (`.disc-toggle`)            | pass     | pass     | pass   | pass   | pass      |
| `.sort-hint` (caption near examples)          | FAIL A1  | pass     | pass   | pass   | pass      |
| Honesty card                                  | pass     | pass     | pass   | pass   | pass      |
| Pitch types grid                              | pass     | pass     | pass   | pass   | pass      |
| `.pitch .velo` (orange velo number, dark)     | FAIL A7  | pass     | pass   | pass   | pass      |
| `.diag` pitch SVGs × 6                        | n/a      | pass     | FAIL A11 | pass | pass      |

### Cross-cutting

| Element                          | Contrast | Keyboard | SR        | Live   | Structure  |
|----------------------------------|----------|----------|-----------|--------|------------|
| Stat tooltip (`#jays-tooltip`)   | pass     | pass     | pass      | warn A16 | pass     |
| Team tooltip                     | pass     | pass     | pass      | warn A16 | pass     |
| Schema-drift banner              | pass     | n/a      | pass      | FAIL A12 | pass     |
| IL popover                       | pass     | FAIL A13 | warn      | FAIL A12 | pass     |
| Hash routes                      | n/a      | pass     | pass      | n/a    | pass       |
| Player modal focus trap + restore | n/a    | pass     | pass      | n/a    | pass       |
| Skip-link                         | n/a    | FAIL A15 | n/a       | n/a    | FAIL A14  |
| `<main>` and `<nav>` landmarks    | n/a    | pass     | pass (`nav.tabs[aria-label]`) | n/a | FAIL A14 (appbar) |

---

## Per-finding detail

### A1 — Body-meta text fails 4.5:1 AA on paper bg

**Severity:** blocker · **Dimension:** Contrast · **WCAG:** 1.4.3 (AA)

**Repro:**

1. Open `http://localhost:8181/index-v2.html`, default light mode.
2. Inspect any of: `#brand-sub`, `#hdr-rec-detail`, `#freshness-detail`,
   `#notesStale`, footer `<span>`, `.sort-hint`, `.idx-grp`,
   `.slash-cell small`, opposing-pitcher slash caption.
3. Computed `color: rgb(138, 147, 161) /* #8a93a1 */`, parent
   `background: rgb(244, 240, 230) /* #f4f0e6 */`.
4. Pair-ratio computation: **2.72:1**. AA requires 4.5:1 for normal
   text (<18px regular / <14px bold).

In dark mode the twin is `#727b89` on `#13161c` = **4.23:1** — still below
4.5:1 but only marginally. The cross-tab footprint is 12 unique selectors
× 8 scans (light) = 58 nodes; dark twin is identical structurally.

Cluster also catches `.term[data-stat]` elements rendered inside
`<small>` (slash captions) — dotted-underline affordance reads against the
same fail ratio.

**Root cause:** `--ink-3: #8a93a1` (light) / `#727b89` (dark) in
`tokens.css`. Used for "third-tier caption" — eyebrows, fine print, MLB.com
attribution. The token is doing the right semantic job; the chosen hex is
just too pale.

**Fix candidate (inline):** Tighten `--ink-3` toward `--ink-2`:

- Light: `#8a93a1` → roughly `#6c7585` lifts to ~4.6:1.
- Dark: `#727b89` → roughly `#8a93a1` lifts to ~5.6:1.

Single-token change cascades to every site. Verify the resulting tone
still reads as "tertiary" (visibly dimmer than `--ink-2`); if not, split
the role into `--ink-3-aa` (used on body chrome) and `--ink-3-decoration`
(used on tertiary chips where contrast is less critical).

---

### A2 — IL chip count + `.warn` legend: orange contrast fails

**Severity:** blocker · **Dimension:** Contrast · **WCAG:** 1.4.3 (AA)

**Repro:**

1. Header: `#il-count` shows the injury count in a 14px-tall orange
   circle. Font is `10px bold` white-on-`#d98a4e` (`--q-warm`).
2. Pair-ratio: white (`#ffffff`) on `#d98a4e` = **2.72:1**.
3. Same orange foreground is used as text in `.warn` (and the larger
   `#hdr-rec-detail` family). 9px–14px bold on the same paper bg = 2.68:1.

The `--q-warm` token (`#d98a4e`) is the visual cue for "warm / cautionary
/ amber" — it lives in headers (notes-stale `.amber`), KPI projection
warn-band (.warn), and the IL chip background.

**Root cause:** `--q-warm: #d98a4e` in `tokens.css`. As a *background*
this color needs a text foreground that hits 4.5:1; white doesn't (2.72:1).
As a *foreground* on light paper it also misses (2.68:1).

**Fix candidate (inline):**

- For the IL chip: deepen the background to `#b06e3e` or similar darker
  amber (≈3.7:1 with white) AND/OR raise font-weight + size. Pure
  background darken is the least invasive. Alternative: keep current
  orange but switch text to near-black `#1b1f27` — yields 8.6:1 against
  `#d98a4e`, reads as "alert chip with dark numerals".
- For `.warn` text on paper: introduce a dedicated `--q-warm-ink` token
  (e.g. `#a55a2c`) used wherever amber appears as foreground. ~5.0:1.

This is a paired tokens problem — every "warm" surface (chip bg, warn
text, projection warn band) needs separate treatment because the same
hex is being used as both fg and bg.

---

### A3 — Player modal comparison strips: 1.93:1 lowest in build

**Severity:** blocker · **Dimension:** Contrast · **WCAG:** 1.4.3 (AA)

**Repro:**

1. Players tab → click any `.pcard` (e.g. "Kevin Gausman").
2. Modal opens; scroll to "WHERE THEY RANK" section.
3. Each row has a `.strip` heat bar with `.c-strip > i` tick markers at
   each percentile sample point, and `.c-rank` columns where the
   percentile ordinal sits with a small caption beneath
   (`.c-rank.m4 small`).
4. Tick marker color: `rgb(179, 185, 196)` = `#b3b9c4` (light) /
   `#4a5260` (dark) on paper.
5. Pair ratio: **1.93:1 light / 2.09:1 dark**. These are the two
   lowest-contrast violations in the entire build.

Same pattern repeats in the Team Stats ledger `.tbl-row` row — every
ledger row has a `.c-rank.m4 > small` caption beneath the rank number.

**Root cause:** `.c-strip > i` and `.c-rank small` use `--ink-4`
(`#b3b9c4` light) — a deliberately-dim "decoration" tint. The intent is
that the tick marker should sit *under* the percentile dot, not draw the
eye. But because the marker conveys *information* (position on the heat
bar) it's load-bearing for low-vision users who can't see the dot's
color encoding.

**Fix candidate (inline):**

- (a) Lift `.c-strip > i` color to at least `--ink-3` (3:1 on graphical
  elements per WCAG 1.4.11 non-text contrast). Easier path.
- (b) Replace the tick markers with a darker bar segment + lift the
  primary dot to be the sole position cue, marked with a visible outline.

The `.c-rank small` caption needs a real bump — it's text, so 4.5:1 is
mandatory. Switch to `--ink-2` or `--ink`.

---

### A4 — Wild-card "me" GB cell

**Severity:** important · **Dimension:** Contrast · **WCAG:** 1.4.3 (AA)

The Wild Card panel's `.me.wc-row` row (the Blue Jays row, highlighted
with the team-tint background `#e6ecf4`) renders the GB cell with text
`#8a93a1` — pair ratio **2.61:1**, lowest light-mode text in the panel.

Dark-mode twin: `#727b89` on `#1c2a3f` = 3.38:1, also below 4.5:1.

**Fix:** Either lift the text to `--ink-2`, or change `.gb` color when
inside `.me` to a darker tone (`#3e4452` ≈ 7.2:1 on `#e6ecf4`).

---

### A5 — Strengths/Soft-Spots rank numerals

**Severity:** important · **Dimension:** Contrast · **WCAG:** 1.4.3 (AA)

Light mode: `.sss-row .rank-num.m2` (green rank "7th" / "9th" / etc.) =
`#5b9e6f` on `#fffdf8` paper = **3.14:1** at 13px bold. Same for the
Stat School equivalent `.ss-stat-val-rank.m2`.

Companion `.rank-num.m4` (red "29th" / "30th") = `#d98a4e` on paper =
**2.68:1** (same `--q-warm` issue as A2).

**Fix:** Deepen `--pos`/`--good` and `--neg`/`--bad` ink tokens used in
the ranks column, OR move to a dark-on-pill model (dark text on the
existing rank-color background).

---

### A6 — Panel-header source tags (`.srctag.machine`)

**Severity:** important · **Dimension:** Contrast · **WCAG:** 1.4.3 (AA)

`.srctag.machine` at 9.5px bold appears on panel headers ("◆ MLB data"
chip). Light: `#737d8c` on `#eef0f3` = **3.64:1**. Dark: `#737d8c` on
`#262b34` = **3.41:1**.

This is "small text" per WCAG (< 18px / < 14px bold), so the 4.5:1 floor
applies. The analyst and external twin chips pass (5.76:1 / 7.37:1) —
only the machine variant fails because its hex is mid-gray on mid-gray.

**Fix:** Deepen `.srctag.machine` color toward `#5a6172` (~5.0:1 light).

---

### A7 — Stat School pitch-card velocity (dark mode)

**Severity:** important · **Dimension:** Contrast · **WCAG:** 1.4.3 (AA)

`.pitch .velo` (e.g. "94.6 mph") in dark mode renders orange `#c24e2c`
on `#1b1f27` = **3.47:1** at 11px bold.

Light mode passes (5.x:1). Only the dark twin fails because the orange
hex is the same in both modes — paper darkening hurts the comparison.

**Fix:** Add `[data-theme="dark"] .pitch .velo { color: <lifted-tone>; }`
or introduce a paired `--velo-ink` token.

---

### A8 — KPI projection band orange

**Severity:** important · **Dimension:** Contrast · **WCAG:** 1.4.3 (AA)

`.kpi .kf b` (projection-warning emphasis), `.cutline` (Wild Card cutline
divider label), `.bad` (red ranks in some surfaces) all hit
**4.07:1** at 12.5px bold on dark paper — just below 4.5:1 AA. Light-mode
twin passes by a thread (.cutline 4.4–4.6:1 region).

**Fix:** Bump `--neg` or introduce a paired `--neg-ink-dark` token, +0.5
on the L axis.

---

### A9 — KPI labels + repeating mid-gray captions (110 selectors)

**Severity:** important · **Dimension:** Contrast · **WCAG:** 1.4.3 (AA)

The largest contrast cluster in the build — 110 unique selectors in
light mode and 110 in dark mode hit the `--ink-3 / paper` pair:

- KPI labels `.kpi .kl` ("RECORD", "PYTHAG PROJ", etc.)
- KPI sub-line `.kpi .km` ("PACE 77 W", "Δ vs reality")
- KPI footer `.kpi .kf` (".476 · 4th in AL East · 8.0 GB")
- Recent/upcoming column headers `.gcol .ghd`
- Game meta lines `.game .meta small`
- Probable SP line `.game .wp.matchup small`
- Spacer `.spacer`
- Panel header hint `.panel-h .hint`
- Ledger row labels `.st-row .rec`
- Many more

Light: `#8a93a1` on `#fffdf8` = **3.05:1**.
Dark: `#727b89` on `#1b1f27` = **3.86:1**.

This is the same root cause as A1 (the `--ink-3` token), but on `--paper`
the math comes out slightly different than on `--paper-2` (analyst tint).

**Fix:** Same token bump as A1 cascades through every one of these.

---

### A10 — Run-diff chart has no accessible name

**Severity:** important · **Dimension:** SR · **WCAG:** 1.1.1 (A)

The headline chart on Overview tab (`<svg class="rd-chart">`) is the
visualization of "last 10 games' run differential". It contains bars,
axis labels, an annotation callout ("worst game: 2-8 vs MIA"), and
inline title. None of this is exposed to assistive tech.

**Repro:**

1. Inspect `<svg class="rd-chart">` in DevTools.
2. No `role`, no `aria-label`, no `<title>` child.
3. NVDA + Chrome: graphic is announced as "graphic" only.

**Fix candidate (inline):**

```html
<svg class="rd-chart" role="img" aria-label="Run differential last 10 games, …">
  <title>Run differential last 10 games. Worst game: 2-8 vs MIA. Best …</title>
  …
</svg>
```

Generate the label in `overview.js` from the same `runDiff` series the
chart renders. ~6 lines.

---

### A11 — Decorative SVGs (brand mark + 6 .diag) lack `aria-hidden`

**Severity:** important · **Dimension:** SR · **WCAG:** 1.1.1 (A)

7 SVGs render per tab body even when hidden. The brand `.mark` rotated
diamond is purely decorative. The 6 `.diag` pitch-trajectory SVGs in
Stat School's pitch-types grid are decorative restatements of the velo
+ name (the same data is in the text labels above). Neither group is
marked `aria-hidden="true"`, so AT users hear "graphic" 7 times per tab.

The `.mark` SVG's `<span aria-hidden="true">` sibling carries the
decorative class but the SVG itself doesn't.

**Fix candidate (inline):**

```html
<svg class="mark" aria-hidden="true"> … </svg>
<svg class="diag" aria-hidden="true"> … </svg>
```

Two attribute additions; ~2 lines in `index-v2.html` and the JS that
emits `.diag` SVGs.

---

### A12 — Schema-drift banner has no live-region semantics

**Severity:** important · **Dimension:** Live · **WCAG:** 4.1.3 (AA)

`#schemaBanner` appears at the top of `<main>` when `render.js
validateSchema()` detects missing top-level keys. It's a red-tinted alert
panel ("Data schema warning: missing fields — team, team_stats.").

Today: `<div id="schemaBanner" class="schema-banner" hidden></div>`. No
`role="alert"`, no `aria-live`. When `.hidden` flips off the banner
appears visually but is silent to screen readers — equivalent to a
non-announcement.

**Repro:**

1. Probe injects `data.json` missing the `team` key.
2. Banner appears at page top with text and styling.
3. NVDA/VoiceOver: no audible announcement; user discovers it only on
   next manual reading-order pass.

**Fix candidate (inline):**

```html
<div id="schemaBanner" class="schema-banner" role="alert" aria-live="assertive" hidden></div>
```

One attribute add. Implicit announcement on `hidden` toggle.

---

### A13 — IL popover: no focusable items, no announcement

**Severity:** important · **Dimension:** Keyboard / Live · **WCAG:** 2.1.1 (A), 4.1.3 (AA)

The pass-3 fix shipped `#il-popover` as a `role="dialog"` with
`aria-label="Injured list"`. The chip's `aria-expanded` toggles. But
inspection shows:

- **0 focusable elements** inside the popover (the player list is
  rendered as static `<li>` rows — no buttons, no links).
- Probe Tab from `#il-chip` lands on `#theme-toggle`, **skipping the
  popover entirely**.
- No `aria-live` — opening the popover is silent for AT.

**Repro:**

1. Tab to `#il-chip`, press Enter — popover opens.
2. Press Tab — focus moves to `#theme-toggle` (focus continues
   page-order, not modal-trapped).
3. Esc closes the popover. focus correctly returns to the chip (pass).

Today's `role="dialog"` semantic *expects* a focus trap. With no
focusables and no trap, the popover is effectively invisible to keyboard
users despite being clickable.

**Fix candidates (inline):**

- **(a)** Drop the `role="dialog"`, use `role="region"` +
  `aria-label="Injured list"` + `aria-live="polite"`. The popover is a
  passive disclosure, not a modal. AT will announce contents on open.
- **(b)** Make each `.il-pop-list li` focusable (`tabindex="0"`) and
  trap focus inside the popover. Heavier — adds keyboard navigation
  through 10+ static items.

(a) matches the actual interaction pattern. Inline change: swap role +
add `aria-live`.

Also: popover has no `aria-labelledby` pointing at the `.il-pop-head`
text — the `aria-label` is a static "Injured list" rather than the
rendered "Injuries (5)" heading.

---

### A14 — `.appbar` + tabs outside landmarks; no `<header>` role

**Severity:** important · **Dimension:** Structure · **WCAG:** 1.3.1 (A), 2.4.1 (A)

Axe `region` rule fires on every scan (16/16). The page structure:

```
<body>
  <header class="appbar"> … brand + meta + chrome + theme + tabs … </header>
  <nav class="tabs" role="tablist" aria-label="Sections"> … </nav>
  <main> … </main>
  <footer class="colophon"> … </footer>
</body>
```

The `<header>` element is the spec landmark for banner-level content —
but axe's region rule wants explicit `role` or it doesn't credit it. The
`<nav class="tabs">` is correctly labeled. The `<footer>` is the
contentinfo landmark.

The bigger issue: there's **no skip-link**. AT users start at the page
top and must traverse 6 focus stops (IL chip → theme toggle → 4 tabs)
before reaching tab content. A `<a href="#tab-overview" class="sr-only">
Skip to main content</a>` at the very top would resolve this for both AA
and the axe rule simultaneously.

**Fix candidates (inline):**

```html
<a class="skip-link sr-only" href="#main-content">Skip to main content</a>
```

Add `id="main-content"` on `<main>`. The `.sr-only` helper is already
declared in `index-v2.html` head styles. Use `:focus { position: static;
width: auto; height: auto; clip: auto; }` to reveal on focus.

For axe `region`: add `role="banner"` to `.appbar` (or wrap inner content
in a `<div role="banner">`). Confirms intent without altering visuals.

---

### A15 — No skip-link

**Severity:** nit (becomes "important" if A14 fix isn't paired)
**Dimension:** Keyboard · **WCAG:** 2.4.1 (A)

See A14. Without a skip-link, the first content focus stop in Overview is
the 7th Tab press (`.term[data-stat="run-differential"]`). On a screen
reader the user can land at the tab body via heading navigation (H1→H2),
but pure keyboard users have no fast path.

---

### A16 — Tooltip live-region

**Severity:** nit · **Dimension:** Live · **WCAG:** 4.1.3 (AA)

`#jays-tooltip` carries `role="tooltip"` (correct), but its content is
re-templated on every term hover/focus and there's no `aria-live`. The
`aria-describedby="jays-tooltip"` linkage on the term *does* surface
content on focus (standard AT behavior), so this is borderline-passing.
The nit: when a user mouses between terms or the dashboard re-renders
mid-hover, the AT cannot tell.

---

### A17 — Focus ring visibility (PASS)

**Severity:** n/a · **Dimension:** Keyboard · **WCAG:** 2.4.7 (AA)

`:focus-visible { outline: 2px solid var(--team-primary-ink); outline-offset: 2px; }`.

- Light mode: `var(--team-primary-ink) = rgb(19, 74, 142)` (TOR navy).
  On `.tab-body` background `#fffdf8`: 8.0:1. On `.panel.analyst`
  background `#f4f0e6`: 7.6:1. On `.kpi` card: 7.6:1.
- Dark mode: `--team-primary-ink` resolves via `color-mix(in srgb,
  var(--team-primary) 50%, white 50%)` to roughly `#89A4C7`. On
  `#1b1f27` dark paper: 6.8:1. On `#262b34` srctag bg: 4.9:1.

PR-F audit established this; manual confirmation here.

**Caveat:** the focus ring is *visible* on every focusable; uniformity is
verified across 25 walk steps. Outline-offset 2px means the ring renders
*around* tightly-packed `.opp` and `.abbr` chips with some bleed into the
adjacent chip area. At normal-density layouts this is fine; the chips
themselves don't overlap.

---

### A18 — Heading hierarchy (PASS)

**Severity:** n/a · **Dimension:** Structure · **WCAG:** 1.3.1 (A)

Each tab has:
- Page H1 `#brand-title` ("Blue Jays 2026 Tracker").
- Tab body H2 ("Overview" / "Players" / "Team Stats" / "Stat School").
- Panel H3 children (multiple per tab).
- Voices panel H4 for RSS item titles (under "Voices around" H3).

No skipped levels. Heading text is meaningful (not "Section 1" placeholders).
The page H1 is constant across tabs which is correct — they're tabs of one
SPA-style page, not separate documents.

Voices uses H4 for item titles which would be unusual for a *news list* —
H4 implies a logical sub-structure beneath the H3 "Voices around" header.
Acceptable, but a `role="list"` with `<li>` rows (no headings) would be
more semantically literal.

Player modal opens with `<h2 id="player-modal-title">` inside the
`role="dialog"` — title element is referenced via `aria-labelledby`,
which is the right pattern; that H2 is correctly *not* in the page
outline once the modal is closed.

---

### A19 — Segmented control color cue

**Severity:** nit · **Dimension:** SR / Contrast · **WCAG:** 1.4.1 (A) — pass-borderline

Pass-3 added `aria-pressed` to `.seg button` so the active state is
exposed. Sighted users see a `.on { background: var(--card-2); }` tint
delta — light mode delta is ~3.7:1 on the boundary between an unpressed
and pressed button. This passes WCAG 1.4.11 graphical contrast for
component state.

The nit: there's no font-weight change, no checkmark, no underline. A
color-blind user with the right palette can't distinguish active from
inactive. Adding `font-weight: 700` to `.seg button.on` resolves both
the AT redundancy and the low-vision case.

---

### A20 — Tab `aria-controls`

**Severity:** nit · **Dimension:** SR · **WCAG:** 1.3.1 (A) — pass-borderline

The tab anchors carry `role="tab"` + `aria-selected`, and the tabpanel
sections carry `aria-labelledby` pointing back at the matching tab. This
is one direction of the WAI-ARIA tablist pairing.

Missing: `aria-controls="tab-<name>"` on each `<a class="tab">`. Some AT
implementations rely on aria-controls to surface the "press to navigate
to panel" affordance. Not strictly required (the click handler already
hash-routes), but pairing both directions improves discoverability.

**Fix candidate (inline):**

```html
<a class="tab" id="tab-overview-anchor" aria-controls="tab-overview" role="tab"> … </a>
```

Four-line attribute add in `index-v2.html`.

---

## Edge cases verified

- **Dark-mode focus-ring:** verified passes 6.8:1 on default dark paper.
- **Keyboard cycle through player modal:** verified by pass-3 modal-a11y
  probe (8 focusables, Tab wraps last→first, Shift+Tab wraps first→last).
- **Esc close + focus restore on modal:** verified — focus returns to
  originating `.pcard`.
- **Esc close + focus restore on IL popover:** verified — focus returns
  to `#il-chip`.
- **Schema-banner appearance:** verified visually (probe forces banner
  visible); A12 finding is the silent appearance, not visual.
- **Opposing-pitcher modal a11y:** inherits the player-modal pattern;
  same focus-trap behavior; same A9-style label contrast issues in
  slash-row captions.
- **Tooltip keyboard-focus:** `.term[tabindex="0"]` is reachable; tooltip
  shows on focus and dismisses on blur.

---

## Tractable inline fixes (for parent agent's queue)

These have a single-touch or two-touch inline fix path. Mostly CSS token
shifts or ARIA-attribute additions in `index-v2.html` and the four
`assets/*.js` renderers.

1. **A11 — Decorative SVGs.** Add `aria-hidden="true"` to `<svg class="mark">`
   in `index-v2.html` and to each `<svg class="diag">` emit site in
   the Stat School JS. ~7 attribute additions.

2. **A12 — Schema-drift banner.** Add `role="alert" aria-live="assertive"`
   to `#schemaBanner` in `index-v2.html`. One attribute add.

3. **A14 — Skip-link + appbar role.** Add `<a class="skip-link sr-only"
   href="#main-content">Skip to main content</a>` as first body child,
   add `id="main-content"` on `<main>`, add `role="banner"` to
   `<header class="appbar">`. Three lines.

4. **A13 — IL popover semantics.** Change `role="dialog"` →
   `role="region"`, add `aria-live="polite"`, switch `aria-label` to
   `aria-labelledby` pointing at the rendered `.il-pop-head`. Three
   attribute changes in the `render.js` popover builder.

5. **A20 — Tab aria-controls.** Add `aria-controls="tab-<name>"` to each
   `<a class="tab">` in `index-v2.html`. Four lines.

6. **A10 — Run-diff chart name.** In `overview.js renderRunDiffChart`,
   set `svg.setAttribute('role', 'img')`, build an `aria-label` from
   the runDiff series (e.g. "Run differential last 10 games, +/-N net,
   worst game …"). ~6 lines.

7. **A19 — Segmented control redundancy.** Add `font-weight: 700` to
   `.seg button.on` in `team-stats.css`. One declaration.

8. **A1 / A9 — `--ink-3` token bump.** Deepen `--ink-3` in `tokens.css`
   light + dark variants. Two-line token change, cascades through ~120
   sites. Visual review needed: verify the tone still reads as
   "tertiary" (visibly dimmer than `--ink-2`).

9. **A2 — IL chip bg darken.** Either deepen `--q-warm` for the chip
   only (scoped override) or introduce paired `--q-warm-ink` token for
   text-on-warm cases. The cleaner path is paired tokens
   (`--q-warm-bg-deep: #b06e3e` for the chip background, retaining
   `--q-warm: #d98a4e` for the inert decoration role).

10. **A4 — Wild-card "me" GB.** Add scoped `.me.wc-row .gb { color:
    var(--ink); }` override. Single declaration.

11. **A5 — Strengths rank-num.** Deepen `--pos`/`--good` and
    `--neg`/`--bad` ink tokens. Two declarations.

12. **A6 — `.srctag.machine`.** Single-color CSS tweak. Two lines (light
    + dark).

13. **A7 — Pitch velo dark mode.** Add `[data-theme="dark"] .pitch .velo
    { color: <lifted-tone>; }`. One declaration.

14. **A16 — Tooltip live-region.** Add `aria-live="polite"` to
    `#jays-tooltip`. One attribute add.

### Not inline-tractable (need design or product decisions)

- **A3 (player modal compare strips):** The 1.93:1 tick-marker tint is
  a deliberate "decoration" choice. Resolving needs a design conversation
  about whether the tick markers are decoration or load-bearing signal.
  Suggest a brief pairing session before patching.
- **A8 (projection band orange):** Sits just under 4.5:1. Lift the
  `--neg` token color, but verify it doesn't darken the rank-pill
  background uses or the standings "below me" highlight beyond the
  established palette identity.

---

## Not yet covered (next a11y pass)

- **Real screen-reader sweep** — NVDA + JAWS + VoiceOver lived experience
  on each tab. ARIA attribute presence is verified; reading order +
  announcement quality is not. This pass is mechanically-verified only.
- **Reduced-motion** — `prefers-reduced-motion` query: skeleton shimmer
  animation in `.sk-line` runs unconditionally. Spot-check the rest of
  the codebase for `@keyframes` and `transition` declarations that should
  guard.
- **Forced-colors mode** — Windows High Contrast / `forced-colors:
  active` query. The heat-bar gradients and percentile dots depend on
  color encoding — verify the layout still works when system colors
  override.
- **Color-blindness simulation** — pcard Hot/Cold pill, KPI projection
  warn-band, rank-num green/red use color as primary cue. Spot-check
  with protanopia / deuteranopia simulator.
- **Mobile a11y** — VoiceOver iOS / TalkBack Android. Touch target
  sizes (44×44 pt floor): `.term[data-stat]` underline targets are
  smaller than 44pt and may miss the WCAG 2.5.5 (AAA) target-size guide.
- **Keyboard cycle through opposing-pitcher modal** — focus-trap
  behavior assumed-equal to player modal; not directly walked.
- **`role="status"` candidates** — the `#refreshed` timestamp pill (if
  it updates after boot) should fire a status announcement. The
  notes-stale chip likewise. Both are static-on-render today; this
  becomes a problem if any live-update path is added.
- **Tabbing past the page** — does focus exit cleanly to browser chrome
  after the last focusable, or does the appbar trap it?
- **Long-name modal edge:** when a player name overflows the modal
  title slot (V16 in pass-3 covers the pcard side), does the modal title
  get clipped and lose its `aria-labelledby` text? Not directly walked.

---

## Did NOT change

- `docs/v2-validation-matrix.md` — left intact per instructions.
- `docs/v2-audit-pass3-findings.md` — left intact.
- No production code modifications. All findings are documentation
  with repro steps + suggested fixes.
- No PRs opened, no branches pushed beyond this worktree.

---

## Coverage caveats

- **Chromium only.** Playwright default. Color-contrast computations are
  engine-stable; ARIA accessibility-tree exposure may differ in WebKit.
- **Real `data.json` only.** Edge fixtures (empty arrays, null
  placeholders, missing keys) were probed only for the schema-banner
  appearance; per-element axe scans use the committed data.
- **No `prefers-reduced-motion` sweep.** Default-motion only.
- **Single viewport** (1280×1100). Responsive breakpoints have separate
  visual rules (see pass-3 V16) but a11y attributes don't change.
- **Axe rule set** is broad (`wcag2a + 2aa + 21aa + 22aa + best-practice`)
  but does not include `experimental`. The `aria-allowed-attr` and
  `landmark-unique` checks are covered; the experimental
  `target-size` (2.5.5 AAA) is not.

---

## Phase 2 — fixes applied (2026-06-09)

Implemented the tractable batch from the queue above. Every contrast value
was verified numerically against the WCAG 4.5:1 (text) / 3:1 (non-text)
thresholds on the worst-case substrate before landing.

| Finding | Fix | Verified |
|---|---|---|
| A1 / A9 | `--ink-3` deepened: light `#8a93a1`→`#656e7b`, dark `#727b89`→`#868f9d` (one token, ~120 sites) | 4.53:1 on cream paper / 4.52:1 on dark card-2; still visibly lighter than `--ink-2` |
| A2 (chip) | IL-chip numerals white→`#2a1a0a` on the fixed amber circle | 6.15:1 |
| A2 (text) | New paired `--q-warm-ink` token (light `#9c5226` / dark `#d98a4e`); repointed `.notes-stale-chip.amber`, `.il-pop-status`, `.pc-stat i.warn` | 5.06–6.05:1 |
| A4 | `.wc-row.me .gb` → `--ink-2` (lift off the me-tint) | 5.03:1 light / 6.46:1 dark |
| A6 | `.srctag.machine` color scoped: light `#585f70`, dark `#969fad` | 5.60:1 / 5.32:1 |
| A7 | `[data-theme="dark"] .pitch .velo` → `#e2734f` | 5.35:1 |
| A10 | Run-diff `<svg class="rd-chart">` gets `role="img"` + generated `aria-label` (series net + worst game) | — |
| A11 | `aria-hidden="true"` on the brand `.mark` span + every `.diag` pitch SVG | — |
| A12 | `#schemaBanner` gets `role="alert" aria-live="assertive"` | — |
| A13 | IL popover `role` dialog→region, `aria-live="polite"`, `aria-labelledby="il-pop-head"`; chip `aria-haspopup`→`true` | — |
| A14 / A15 | Skip-link (`.sr-only`, revealed on focus) + `id="main-content"` on `<main>` + `role="banner"` on the appbar | — |
| A16 | `#jays-tooltip` gets `aria-live="polite"` | — |
| A19 | `.seg button.on` gets `font-weight: 700` (state cue beyond color) | — |
| A20 | `aria-controls="tab-<name>"` on all four tab anchors | — |

### Deferred (need a design decision — not landed here)

- **A3** (player-modal compare-strip tick markers, 1.93:1): the dim tint
  is a deliberate "decoration vs. signal" choice; needs a design call.
- **A5** (rank-tier ramp `.m2` green / `.m4` amber as text): deepening
  `.m2` to clear 4.5:1 collapses it into `.m1` — the 5-tier ramp needs a
  holistic palette redesign, not a per-token nudge. The old "deferred to
  v2.0.1" note in `team-stats.css` is updated to reflect this. Non-rank
  amber text is fixed via `--q-warm-ink` (A2).
- **A8** (projection-band orange `--neg`, 4.07:1 dark): just under AA;
  lifting `--neg` risks the rank-pill backgrounds and standings highlight
  — bundle with the A5 palette pass.

The merged visual-regression probe guards these CSS changes; baselines
were regenerated in CI so the committed PNGs reflect the new tones.
