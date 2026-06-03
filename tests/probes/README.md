# UI probes

Playwright-based smoke + structural checks for `index-v2.html`. They
hit a static HTTP server, drive headless Chromium, and assert
properties that vanilla JS unit tests can't reach (layout, paint
timing, scroll containment, modal lifecycle).

The suite has two layers:

1. **Class-of-bug probes** (added by the antifragile pass, one per
   commit). Each asserts a structural invariant — not just a specific
   instance — so the bug class is impossible to reintroduce without
   the probe failing first.
2. **Regression probes** (rounds 1 / 2 / 3). The output of the three
   bug-hunting rounds against the v2 redesign in 2026-06. They cover
   feature behavior (KPI math, modal back-button, accessibility,
   fail-mode UX) and are the standing regression bed.

## Running

```bash
# 1. Start a static server in the repo root
python3 -m http.server 8000 &

# 2. Make Playwright's chromium dependency reachable
export NODE_PATH=/opt/node22/lib/node_modules

# 3. Run any probe
node tests/probes/layer-boundaries.js
node tests/probes/containment.js
node tests/probes/loading-states.js
node tests/probes/modal-state.js
node tests/probes/round-1.js
node tests/probes/round-2.js
node tests/probes/round-3.js
```

Each probe exits with code `0` on success, `1` on any FAIL finding,
`2` on infrastructure error (Playwright couldn't reach the server).
`WARN` findings are advisory and don't change the exit code.

## Probes

### `layer-boundaries.js` — antifragile pass commit 1

Asserts the design system layers don't fight each other:

- **L1** — only the three identity tokens (`--team-primary`,
  `-secondary`, `-accent`) are set from JS. Any other token override
  in JS is a layer-boundary regression (bug class B1).
- **L2** — exactly one `<h1>` per page (B5 class).
- **L3** — every tab body contains an `<h2>` (B6 class).
- **L4** — no duplicate element IDs after every tab is activated (B3
  class).
- **L5** — every Stat School per-stat card uses the `ss-stat-`
  namespace.
- **L6** — `.pc-av` dark-mode contrast meets WCAG AA-large (≥ 3:1).
  Uses canvas readback to resolve `color-mix(in oklab, ...)` to sRGB.

### `containment.js` — antifragile pass commit 2

Asserts the viewport is the boundary — no horizontal scroll surface
is available at any tested breakpoint (B7 class):

- 6 viewports (320 / 480 / 760 / 1100 / 1440 / 1920) × 4 tabs ×
  2 scenarios (baseline + stress fixtures with long names and
  headlines) = 48 assertions.
- **PRIMARY** — `body.scrollLeft` cannot be made nonzero. Direct
  proof that `overflow-x: clip` is honored end-to-end.
- **SECONDARY (informational)** — flags any element rect that would
  exceed viewport if the clip were removed, so the codebase doesn't
  silently rely on the clip.

### `loading-states.js` — antifragile pass commit 3

Asserts the dashboard never shows a blank tab during async loads
(B8 class):

- **T1** — each tab has skeleton + sr-only h2 within the first paint
  (after a 1500ms route delay).
- **T2** — each tab replaces skeleton with real content within the
  fetch-delay budget.
- **T3** — `data.json` failure → every tab shows `.panel-error` +
  `.panel-retry`.
- **T4** — no JS errors across the slow-network lifecycle.

### `modal-state.js` — antifragile pass commit 4

Asserts the modal lifecycle's single source of truth is
`window.location.hash` (B4 class):

- **M1** — `modalState(hash)` discriminator returns correct
  `{type, target}` for each pattern.
- **M2** — click → open + hash + openId all aligned.
- **M3** — browser back → modal closed, hash reverts.
- **M4** — forward → modal reopens.
- **M5-M7** — Esc / X / scrim click all close and revert the hash.
- **M8** — theme toggle while open → modal stays open with content.
- **M9** — garbage hash → no modal.
- **M10** — direct-load deep-link → modal opens.

### `round-1.js`, `round-2.js`, `round-3.js` — regression bed

Originally written during the v2 redesign bug-hunting rounds. Now
live in the repo as the standing regression suite. Cover:

- Round 1 — fail-mode UX, KPI math, header/freshness, hot/cold
  pill counts, Stat School index click, ledger toggle, security
  (external link rels), empty-data edge cases.
- Round 2 — modal focus return, scrim hygiene over many cycles,
  Team Stats toggle persistence, browser back across tabs, null
  player rendering, tab keyboard nav, run-diff annotation,
  term-affordance underlines.
- Round 3 — survivorship-bias hunt: text contrast against dark
  cards, formatter edge cases (now aligned to the format-spec
  domain), SVG namespace correctness, accidental window globals,
  heap-growth on repeated modal open/close.

## Format spec

The pure-JS formatter spec lives next door at
`tests/format-spec.test.js`. It runs with the bare `node --test`
runner (no Playwright dependency) and validates every formatter in
`assets/format.js` against its declared `@domain`. Run via:

```bash
node --test tests/format-spec.test.js
```

## CI

`.github/workflows/probes.yml` spins up the static server and runs
the probes against every PR + push to `main`. The workflow is
standalone (not folded into `tests.yml`) because it has a different
runtime (Node + Playwright vs. Python) and different concern (UI
smoke vs. pure unit). Independent failure surfaces help diagnosis.
