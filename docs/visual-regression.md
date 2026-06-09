# Visual regression — `tests/probes/visual.js`

The recent v2 audit passes were a steady drip of visual regressions
(dashes-as-underscores, heat-bars without markers, pcard truncation at
1024px). Each one was caught by manual screenshot review **after merge**.
This probe is the systematic counterweight: a deterministic set of UI
screenshots, compared against committed baselines, fails CI on any pixel
diff above the threshold.

## What's covered

Light + dark mode at 1280 × 900 @ DPR 2:

| Surface | Light | Dark |
|---|---|---|
| Overview tab (top) | ✅ | ✅ |
| Players grid | ✅ | ✅ |
| Hitter modal (first ranked card) | ✅ | — |
| Pitcher modal (Kevin Gausman) | ✅ | — |
| Team Stats (hitting view) | ✅ | — |
| Stat School (top) | ✅ | — |
| IL popover (open) | ✅ | — |

Dark-mode coverage for modals + secondary tabs can be added by extending
the probe; the framework is in place.

## How it works

1. **Determinism**: `data.json` is intercepted at the network layer and
   served from `tests/fixtures/visual-data.json`. The daily-refresh
   workflow can't shift the snapshot state.
2. **Theme**: set explicitly via `data-theme` attribute; `localStorage` is
   cleared per-page so prior visits don't bleed into the baseline.
3. **Comparison**: [`pixelmatch`](https://github.com/mapbox/pixelmatch)
   with `threshold: 0.1` (per-pixel color tolerance) + `0.05%` whole-
   frame budget (~576 pixels at 1280×900). Tight enough to catch real
   regressions (the dash-as-underscore class flagged at 0.7–1.0% diff in
   the validation test), loose enough to absorb subpixel rendering noise.

## Updating baselines

Baselines must be regenerated **in CI**, not locally. The local-vs-CI
font rasterization delta is non-trivial — PR #132's first run showed
7–8% structural diffs (modal heights off by 38px) because the runner's
OS-level font hinting differs from the maintainer's container even
after `document.fonts.ready` synchronization. The CI-generated PNGs
are the source of truth for the comparison job.

### Maintainer flow

1. Push your branch with whatever intentional visual change you're
   making. The `probes` job will fail on the visual probe — that's
   expected because the baselines are stale.
2. Go to **Actions → UI probes → Run workflow**, pick your branch,
   check **"Regenerate visual-regression baselines and commit them
   to the branch"**, click Run.
3. The `regenerate-baselines` job runs `UPDATE_SNAPSHOTS=1`, writes
   the fresh PNGs, and pushes a `v2(visual): regenerate baselines in
   CI` commit back to your branch.
4. That same job then **auto-dispatches** a comparison `probes` run on
   the new commit (its `Re-validate committed baselines` step). A green
   probes check lands on the regenerated-baseline commit automatically —
   no second manual dispatch. (The commit-back uses `GITHUB_TOKEN`, which
   by design does *not* re-trigger `pull_request`/`push` workflows, so
   this explicit dispatch is what produces the green check.)
5. Review the baseline PNGs as part of your PR diff — that's the
   approval mechanism. If a diff is unintentional, the PR doesn't
   merge.

> **The first-run red is expected and harmless.** Step 1's `probes`
> failure sits on the pre-regeneration commit; it is *not* the PR head
> once step 4's green run lands. Judge the PR by the check on its **head
> commit** (and `mergeable_state`), not by the red run in the timeline.
> A change that intentionally shifts pixels will always show one stale
> red run — that's the cost of CI-authoritative baselines, not a problem
> to fix per-PR. (A change that should *not* shift pixels — e.g. adding a
> field both the renderer and the fixture read — skips this entirely: its
> first run is green, no regeneration needed.)

### Local iteration

For ad-hoc local checks, you can still run:

```bash
python3 -m http.server 8000 &
UPDATE_SNAPSHOTS=1 NODE_PATH=/opt/node22/lib/node_modules node tests/probes/visual.js
```

to see what your change looks like. But the resulting PNGs won't
match the CI runner — **don't commit them**. Use the workflow_dispatch
path for the canonical update.

## When a CI run fails

The probe writes diff artifacts to `/tmp/v2-shots/`:

- `<name>.actual.png` — what the CI run rendered
- `<name>.diff.png` — pixelmatch's red-highlighted diff overlay

The existing `probe-screenshots` artifact step in `.github/workflows/probes.yml`
uploads these. Download from the failed CI run, eyeball the diff:

- **Real regression**: fix the code; the baseline stays as-is.
- **Intentional visual change**: regenerate **in CI** via the
  workflow_dispatch path above (Maintainer flow). Don't commit
  locally-generated PNGs — they won't match the runner's font
  rasterization and will just fail the next comparison.

## Updating the fixture

`tests/fixtures/visual-data.json` is a frozen snapshot of `data.json`.
When the fetcher's schema changes (new top-level key, new player-rank
field, etc.):

1. Copy fresh `data.json` to the fixture: `cp data.json tests/fixtures/visual-data.json`
2. Regenerate baselines: `UPDATE_SNAPSHOTS=1 node tests/probes/visual.js`
3. Commit both in one PR.

Schema drift detected at fixture-vs-current diff time is itself a
signal — surface it in the PR description so a reviewer can confirm
the new schema is intentional.

## Adding a new surface

Inside `tests/probes/visual.js`, copy one of the existing snapshot blocks
and adjust the navigation + locator:

```js
{
  const { ctx, page } = await fixturePage(browser);
  await page.evaluate(() => { window.location.hash = 'team-stats'; });
  await page.waitForTimeout(700);
  await snapshot('my-new-surface', page, '.some-locator');  // or omit locator for full-page
  await ctx.close();
}
```

Then run with `UPDATE_SNAPSHOTS=1` to create the baseline, commit, push.

## Known noise sources

- **Antialiasing across machines**: the 0.05% budget absorbs typical
  rendering jitter. If CI starts flapping, bump the budget rather than
  silencing the probe.
- **Font fallback**: if `Hanken Grotesk` fails to load (CDN timeout), the
  page renders with the sans fallback — a deliberate visual change. The
  probe will fail; the right response is to confirm the font loaded, not
  to update the baseline.
- **Animations**: snapshot calls pass `animations: 'disabled'` to freeze
  any in-flight transitions. Reduced-motion preference is also set by
  the existing reduced-motion CSS.
