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
| `border-radius: 3px` | 10 | spread | Adopt `--r-chip: 3px` for inline pills + provenance chips. |
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

### Filed as issues (non-trivial)

| # | Issue | Why deferred |
|---|---|---|
| V5 | Type-scale gaps — 117 `font-size` literals; 51 of them are the four sizes `11/12/13/10px` (each used 10–19 times) but no token covers that range. | Cascading visual impact; needs design-system pass + per-surface review. |
| V6 | Radius-scale gap — 34 `border-radius` literals; `3px` used 10× with no `--r*` token equivalent. | Same — needs decision on `--r-chip` or similar. |
| B2 | Rank-row terms for stats without `stat_school.json` entries (`k9`, `bb9`, `ip`, `hr`, `rbi`, `sb`, `hardhit_pct`) show dotted-underline + cursor:help but tooltip silently no-ops. | Editorial work — content for these stats belongs to the maintainer's voice (`stat_school.json`), not to a code change. |

## Not yet covered (next audit pass)

- **Behavioral deep-walk**: keyboard-only tab from page top, listing every focusable element + aria-label + focus-ring visibility (vs the current spot-check via probes).
- **Edge-case fixtures**: sub-threshold hitter (no Statcast, no ranks), pre-Opening-Day (no recent_games), missing analyst note, stale `as_of` 24h+/48h+, missing `opp_context` on an upcoming game, empty Voices feed.
- **Mobile/responsive widths**: this pass was 1280×1100 only.
- **Cross-browser**: Chromium only (Playwright default).
