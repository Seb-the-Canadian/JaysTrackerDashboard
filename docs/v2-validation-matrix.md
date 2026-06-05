# v2 validation matrix

Running audit ledger for the v2 soft-launch dashboard. Each surface ×
each dimension. Lives in the repo as the audit-trail artifact — re-run
this matrix before any milestone tag (v2.0, v2.1, …).

**Status legend:** ✅ pass · ⚠️ inconsistency / minor finding · ❌ broken / blocking

**Dimensions:** Data · Behavior · Visual · A11y · Edge cases

---

## Token bypass audit (cross-cutting)

Hardcoded literals in v2 CSS that should derive from `tokens.css`. Drift
hotspots are values repeated 3+ times across files — they're concept
duplication waiting for a future redesign to forget one.

| Literal | Count | Files | Notes |
|---|---|---|---|
| `font-size: 11px` | 19 | overview / players / team-stats / stat-school | No token in this range. Adopt `--t-meta: 11px` or compress to `--t-label` (10.5px) where appropriate. |
| `font-size: 13px` | 11 | spread | Adopt `--t-row: 13px` (between `--t-small: 12.5` and `--t-body: 14`). |
| `font-size: 12px` | 11 | spread | Could collapse to `--t-small: 12.5px` (minor visual shift) or add `--t-meta-2: 12px`. |
| `font-size: 10px` | 10 | spread | Adopt `--t-micro: 10px` for chip-level UI (pills, micro-labels). |
| `border-radius: 3px` | 10 | spread | Resolved (#124): `--r-chip: 3px` added, all 10 sites replaced. Also extracted `--r-pip: 2px` for the 7 sub-r1 pip/marker/focus-corner literals. |
| `#cdb89a` (heat-bar midpoint) | 3 | players, stat-school × 2 | Extract `--heat-neutral`. Same hex repeated for the same purpose across 3 files. |
| `#4a4332` (analyst dim ink) | 3 | overview, players, stat-school | Extract `--analyst-ink-dim` or use existing `--analyst-ink`. |
| `#cabfa6` (analyst dark text) | 3 | same | Extract token. |
| `#e4d8bd` (analyst card edge) | 2 | players, stat-school | Extract. |
| `#221e16`, `#36301f` (analyst dark surface + border) | 3 + 2 | spread | Extract two tokens. |

**Plan:** Phase 1 of the uniformity PR extracts these high-frequency
literals into `tokens.css` and updates call sites. Phase 2 (if needed)
addresses the wider type-scale + radius scale.

---

## Surface-by-surface matrix

### Header

| Element | Data | Behavior | Visual | A11y | Edge |
|---|---|---|---|---|---|
| Refresh badge (`#refreshed`) | – | – | – | – | – |
| Notes-refresh badge | – | – | – | – | – |
| IL count chip | – | – | – | – | – |
| Theme toggle | – | – | – | – | – |
| Tabs (Overview / Players / Team Stats / Stat School) | – | – | – | – | – |

### Overview tab

| Element | Data | Behavior | Visual | A11y | Edge |
|---|---|---|---|---|---|
| KPI: Record (W-L · pct · place) | – | – | – | – | – |
| KPI: Pythag projection | – | – | – | – | – |
| KPI: Run differential | – | – | – | – | – |
| KPI: Last 10 | – | – | – | – | – |
| Run-diff chart (SVG) | – | – | – | – | – |
| Recent & upcoming panel header | – | – | – | – | – |
| Recent game card × 3 (.opp tile + meta + result) | – | – | – | – | – |
| Upcoming game card × 3 (.opp + meta + opp_context + opp SP chip) | – | – | – | – | – |
| AL East standings row × 5 (.abbr + bar + record/GB) | – | – | – | – | – |
| Wild Card panel (3 leaders, In, cutline, Out) | – | – | – | – | – |
| Voices panel (RSS list) | – | – | – | – | – |
| Overview narrative (notes.json) | – | – | – | – | – |

### Players tab

| Element | Data | Behavior | Visual | A11y | Edge |
|---|---|---|---|---|---|
| Group headers × 4 (Rotation, Bullpen, Lineup, Bench) | – | – | – | – | – |
| Pcard: avatar | – | – | – | – | – |
| Pcard: identity (name + meta) | – | – | – | – | – |
| Pcard: recent pill (Hot/Cold/New) | – | – | – | – | – |
| Pcard: primary stat + percentile badge | – | – | – | – | – |
| Pcard: hover/focus affordance | – | – | – | – | – |
| Player modal: avatar + identity | – | – | – | – | – |
| Player modal: theme toggle | – | – | – | – | – |
| Player modal: close (X) | – | – | – | – | – |
| Player modal: SAV + MLB pills | – | – | – | – | – |
| Player modal: slash line (hitter) — AVG/OBP/SLG/OPS | – | – | – | – | – |
| Player modal: slash line (pitcher) — ERA/WHIP/K/W-L | – | – | – | – | – |
| Player modal: Statcast value line | – | – | – | – | – |
| Player modal: Where they rank — heat strips | – | – | – | – | – |
| Player modal: analyst note | – | – | – | – | – |

### Opposing-pitcher modal (`#oppp-<id>`)

| Element | Data | Behavior | Visual | A11y | Edge |
|---|---|---|---|---|---|
| Identity + OPP-SP tag | – | – | – | – | – |
| SAV + MLB pills | – | – | – | – | – |
| Slash line (ERA/WHIP/IP/K) | – | – | – | – | – |
| Footer note | – | – | – | – | – |

### Team Stats tab

| Element | Data | Behavior | Visual | A11y | Edge |
|---|---|---|---|---|---|
| Strengths column | – | – | – | – | – |
| Soft Spots column | – | – | – | – | – |
| Segmented control (Hitting / Pitching) | – | – | – | – | – |
| Ledger row (Stat label · value · heat strip · rank ordinal) | – | – | – | – | – |
| Heat strip in ledger | – | – | – | – | – |
| Per-stat ctx note (notes.team.ctx) | – | – | – | – | – |

### Stat School tab

| Element | Data | Behavior | Visual | A11y | Edge |
|---|---|---|---|---|---|
| Sticky left index | – | – | – | – | – |
| Keystone card | – | – | – | – | – |
| Per-stat card (header + definition + scale + frame) | – | – | – | – | – |
| Stat scale-track (heat bar with MLB avg tick) | – | – | – | – | – |
| Per-stat percentile tick (ss-rank-tick) | – | – | – | – | – |
| Disclosure (formula + why) — advanced only | – | – | – | – | – |
| Honesty card | – | – | – | – | – |
| Pitch types grid | – | – | – | – | – |

### Cross-cutting

| Element | Data | Behavior | Visual | A11y | Edge |
|---|---|---|---|---|---|
| Stat tooltip (`.term[data-stat]`) | – | – | – | – | – |
| Team tooltip (`[data-team]`) | – | – | – | – | – |
| Schema-drift banner | – | – | – | – | – |
| Hash routes (`#player-<id>`, `#oppp-<id>`, `#stat-<slug>`) | – | – | – | – | – |
| Modal focus trap + restore | – | – | – | – | – |

---

## Findings (first audit pass — 2026-06-05)

Surfaces walked (light + dark, 22 screenshots @ 1280×1100 / 2× DPR):
Overview, Players grid, hitter modal, pitcher modal, stat tooltip, Team
Stats (Hitting + Pitching), Stat School (top + disclosure), team tooltip,
opposing-pitcher modal.

### Visual — uniformity (fixed in this pass)

| # | Finding | Resolution |
|---|---|---|
| V1 | `#221e16` analyst-tint dark hardcoded in `players.css`, `team-stats.css`, `stat-school.css`. Token says `--analyst-tint: #26221a` — 4-RGB drift. | Replaced with `var(--analyst-tint)` × 3. Redundant dark-mode overrides deleted (token themes itself). |
| V2 | `#36301f` / `#e4d8bd` analyst card edge hardcoded in `players.css`, `stat-school.css`; no token. | Added `--analyst-edge` (light/dark pair) to `tokens.css`, replaced × 4 sites. |
| V3 | `#4a4332` / `#cabfa6` analyst body-ink hardcoded in `overview.css`, `players.css`, `stat-school.css`; no token (distinct from existing `--analyst-ink` eyebrow). | Added `--analyst-ink-body` (light/dark pair), replaced × 6 sites. Redundant dark overrides deleted. |
| V4 | `#cdb89a` heat-bar midpoint hardcoded in `players.css` `.strip` + `stat-school.css` `.scale-track` (× 2). | Added `--heat-neutral` token, replaced × 3 sites. Now a single hex literal keeps the three heat surfaces in lockstep. |

### Behavioral / copy (fixed in this pass)

| # | Finding | Resolution |
|---|---|---|
| B1 | "WHERE HE RANK" missing trailing "s" in hitter modal subhead. Subject-verb agreement: "he ranks" / "they rank" — only the hitter side was wrong. | Fixed in `players.js`: `'Where ' + (isHitter ? 'he ranks' : 'they rank')`. |
| B2 | Rank-row terms for stats without `stat_school.json` entries (`k9`, `bb9`, `ip`, `hr`, `rbi`, `sb`, `hardhit_pct`) show dotted-underline + cursor:help but tooltip silently no-ops. | Resolved as issue #125 (frontend suppression). Added `JaysStatRegistry.has(slug)` sync helper, made `render.js` await registry load before dispatch, gated every `.term[data-stat]` emit site (`players.js`, `team-stats.js`, `overview.js`, `opponent-pitcher.js`) on `has()`. Slugs without backing now render as plain text — no dead affordance. Editorial path (Option A from #125) is unblocked: authoring a `stat_school.json` entry restores the affordance automatically. Regression guard in `tests/probes/tooltips.js` (T12/T13). |

### Filed as issues (non-trivial)

(All previously-filed issues from this matrix have been resolved — see section below.)

### Resolved in later passes

| # | Finding | Resolution |
|---|---|---|
| V5 | Type-scale gaps — 117 `font-size` literals; 51 of them are the four sizes `11/12/13/10px` (each used 10–19 times) but no token covers that range. | Added four intermediate type tokens to `tokens.css` (`--t-row: 13px`, `--t-secondary: 12px`, `--t-meta: 11px`, `--t-micro: 10px`) using the existing role-based naming pattern. Replaced 72 literals across `overview.css` / `players.css` / `team-stats.css` / `stat-school.css` / `tooltip.css` — the four target sizes (53 sites) plus existing-token-match drift on `10.5px` → `--t-label` (6), `12.5px` → `--t-small` (7), `14px` → `--t-body` (6). PR #128 / issue #123. |
| V6 | Radius-scale gap — 34 `border-radius` literals; `3px` used 10× with no `--r*` token equivalent. | Added `--r-pip: 2px` (7 sites) + `--r-chip: 3px` (10 sites) to `tokens.css`. Scale now reads `pip → chip → r1 → r2 → r3 → pill` in ascending order. 17 literals replaced across `overview.css` / `players.css` / `team-stats.css` / `stat-school.css` / `tooltip.css`. Focus-ring corners (`:focus-visible { border-radius: 2px }`) folded under `--r-pip` to avoid a single-use token. PR #127 / issue #124. |

## Findings (second audit pass — 2026-06-05)

Visual sweep at 3× DPR triggered by the report "font size / alignment causes
dashes to look like underscores". Probe-driven catalogue of every visible
dash-or-placeholder text node across Overview, Players grid, hitter modal,
pitcher modal, Team Stats, Stat School.

### Visual / behavioral (fixed in this pass)

| # | Finding | Resolution |
|---|---|---|
| V7 | The em-dash glyph (U+2014) sits at the font's typographic midline, which lands visually low next to all-caps + tabular-numeric text at 10–13px (the size band used across every tabular surface). On Braydon Fisher's player card, the placeholder em-dash next to "ERA" reads as an underscore. | Added `.ph` utility in `tokens.css` (`display: inline-block; vertical-align: 0.12em; line-height: 1`) — lifts the glyph back to the perceived line center without altering any value rendering. Applied at every renderer-emitted em-dash placeholder: `players.js` pcard rank badge, `players.js` ctxRow value + rank, `overview.js` wc-row gb, `team-stats.js` sss-row + ledger row. Probe sweep confirms zero literal-`-` placeholders remain. |
| V8 | `.wc-row .gb` rendered MLB's literal `"-"` (hyphen-minus) for wild-card leaders — the standings code at `overview.js:489` already normalized this, but the wild-card render at `:531`/`:548` did not. At 11px mono with `vertical-align: baseline`, a lone hyphen sits low and reads as a stray underline. | New `gbSpan(gb)` helper in `overview.js` normalizes `-` to the project's canonical em-dash and wraps in `.ph`. Both wc-row emit sites use it. |
| B3 | Player modal's "Where they rank" rows for unranked players (RPs below the qualifying threshold) rendered the full green→red heat gradient with no marker — the bar provides no signal without a position, but its presence reads as broken UI. Visible on Braydon Fisher (5/5 unmarked strips). | Added `.strip.strip-empty` state in `players.css` (dim `--card-2` track, no gradient, faded `.avg` line). `ctxRow` in `players.js` emits the empty class when `pct == null`. Qualified players (Gausman: 5/5 markers) unaffected. |
| V9 | Player card right-side cluster (`.pc-stat`) packed value + label + rank badge into a single inline line, e.g. "3.36 ERA 61st %ile". Long names ("Kevin Gausman", "Andrés Giménez") truncated to a single token because the right cluster's width consumed the name column. Visual hierarchy was muddy — bold value (14px) and bold name (13.5px) competed; the rank badge (12px bold) sat at the same weight as the label. | Restructured `.pc-stat` to a flex column: value+label top row, rank badge bottom row. Value bumped to 16px (clearer primary). Label boxed in `.pc-stat-lbl` (10px uppercase, letter-spaced). Badge ringed down to 9px regular-weight. Probe confirms 0/26 names truncate (was 4/26 at the old width). Empty placeholder `<i class="muted ph">—</i>` carries the same `.ph` lift. |

## Findings (third audit pass — 2026-06-05)

Surface-by-surface walk dispatched after pass 2 revealed obvious bugs (the
"underscore-7" KPI, the missing heat-map markers) that pass 1 had missed.
Pass 3 covers every row of the surface table at 25 probe runs across 14
audit scripts, both themes, light + dark + responsive widths (375 / 480 /
760 / 1024 / 1280). Full findings doc at `docs/v2-audit-pass3-findings.md`.

### Visual (fixed in this pass)

| # | Finding | Resolution |
|---|---|---|
| V10 | The 46px run-differential KPI rendered `-7` with U+002D HYPHEN-MINUS — the glyph sits at the typographic midline, so at display size it parses as "underscore-7" rather than "minus seven". Same helper feeds the Last-10 frame line and the Stat School value pill. | `F.signed()` in `assets/format.js:62` now returns U+2212 MINUS SIGN for the negative branch. Single point of change; every signed-negative on the dashboard inherits the fix (KPI, frame line, Stat School). `tests/format-spec.test.js` assertion updated. |
| V11 | Recent-game `.res` scores (`7-2`, `3-7`) ship from MLB Stats API as ASCII hyphen — same low-glyph problem at 13px mono. | Renderer-side normalization in `overview.js:424`: `g.score.replace('-', '–')` swaps to en-dash (U+2013), the typographic convention between two related numbers. |
| V12 | Stat School `run_differential` value pill rendered `-7` (ASCII), Pythag pill `31-32` (ASCII record). | `stat-school.js:166-170` now defers to `F.signed(team.run_diff)` (inherits V10's U+2212) and uses en-dash for the Pythag W–L record. |
| V13 | Run-diff chart worst-game annotation "2-8 vs MIA" used ASCII hyphen. | `overview.js:337` same `.replace('-', '–')` normalization as V11. |
| V14 | Opposing-pitcher modal slash cells used `b.textContent = '—'` for null/empty values — 25px font-weight 800, no `.ph` lift; the em-dash sat well below visual center, reading as a thick underline above the labels. | `opponent-pitcher.js:112` now appends a `<span class="ph" aria-label="No value">—</span>` instead of setting raw textContent. Inherits the same lift used everywhere else. |
| V15 | `opp_context` line "30-33, 3rd AL East" in upcoming game cards used ASCII hyphen. | `overview.js:434` `oppContextStr` now joins record with en-dash, consistent with the header, AL East standings, and WC rows. |

### Behavioral / A11y (fixed in this pass)

| # | Finding | Resolution |
|---|---|---|
| B4 | Modal-internal theme toggle flipped the document and updated its own glyph, but left the page-level `#theme-glyph` stale. After closing the modal, the header glyph showed the wrong direction relative to the actual mode. | Event-based propagation: `JaysTheme.toggleTheme()` now dispatches a `jt-theme-change` CustomEvent on `window`. `render.js` `hookThemeToggle` subscribes to it and re-runs `updateGlyph`. Modal-internal toggles are unchanged (they still call `JaysTheme.toggleTheme()`) but the page-level glyph now stays in sync automatically. Verified: light → modal-toggle to dark → close → page glyph correctly shows ☀. |
| B6 | Team Stats segmented control (`.seg button`) had no `role`, `aria-pressed`, or `aria-label` — screen readers couldn't tell which group was selected or that they were mutually exclusive. | `team-stats.js:252-255` adds `role="group" aria-label="Ledger view"` to the wrapper and `aria-pressed` + `aria-label` to each button. Click handler at `:231-239` toggles `aria-pressed` along with the `.on` class. |

### Filed as follow-ups (non-trivial)

| # | Finding | Why deferred |
|---|---|---|
| V16 | Player card names truncate widely at 1024px (iPad landscape) and 760px: 21 of 26 names ellipsize. V9's stacked layout opened ~60px at 1280px, but the grid keeps trying to fit 4 cards down to 980px. | Needs grid-system breakpoint rework + per-width rank-badge label compression. Filed for a follow-up PR; not a regression (V9 didn't introduce truncation at narrower widths). |
| B5 | `#il-chip` is keyboard-focusable with `aria-label="Open injury list"` but `hookIlChip` is a no-op (`void state`) — false affordance. | Two-path resolution: ship the popover (the planned feature), or remove the affordance until then. Either path is a behavior change worth its own review. |

### Not yet covered (next audit pass)

- **Behavioral deep-walk**: keyboard-only tab from page top, listing every focusable element + aria-label + focus-ring visibility (vs the current spot-check via probes).
- **Edge-case fixtures**: sub-threshold hitter (no Statcast, no ranks), pre-Opening-Day (no recent_games), missing analyst note, stale `as_of` 24h+/48h+, missing `opp_context` on an upcoming game, empty Voices feed.
- **Mobile/responsive widths**: this pass was 1280×1100 only.
- **Cross-browser**: Chromium only (Playwright default).
