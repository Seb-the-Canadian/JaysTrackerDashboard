# Feature ledger

Every shipped feature, the **durable guard** that proves it still works, and
where it's confirmed live. This exists because two v2 features were reported
"done" when they weren't: the segmented brand mark was approved + branch-CI-
green but never merged (no trace from approved → on main → live), and the
player heat bars were "fixed by percentile" with no assertion of the actual
outcome (coverage silently sat at 6/26 for weeks). A feature isn't done until
a machine guards it and it's confirmed on the live deploy.

## Definition of done (also in CLAUDE.md)

1. The change itself.
2. A **durable guard** — a probe, test, or data-contract assertion that fails
   if the feature regresses. If none exists yet, the row below says so
   explicitly (a known gap is better than a false sense of safety).
3. Confirmed on **main AND the live Pages deploy** — not just branch CI.
4. A row in this ledger.

## Guard legend

- **probe** — `tests/probes/*.js` (Playwright, runs in `probes.yml`)
- **pytest** — `tests/test_*.py` (runs in `tests.yml`)
- **visual** — committed baseline in `tests/screenshots/baselines/` (a render
  change that isn't intended will fail the visual probe)
- **contract** — `schema/data_contract.json` + `tools/check_data_completeness.py`
- **manual** — verified by hand; **no machine guard yet** (regression risk)

## Ledger

| Feature | PR | Durable guard | Confirmed live |
|---|---|---|---|
| Daily refresh writes `data.json` | early | contract (hard key check) + `tests.yml` | ✅ 40+ refreshes |
| Visual-regression probe | #132 | probe (`visual.js`) — self-guarding | ✅ |
| Self-hosted font (no CDN) | #132 | visual baselines (CDN-less render is the baseline) | ✅ |
| a11y contrast tokens | #134 | **manual** (numeric contrast calc at authoring) — *gap: no automated contrast assertion* | ✅ |
| a11y ARIA/landmarks/skip-link | #134 | **manual** — *gap: axe not wired into CI* | ✅ |
| Forkability F1–F3 (config-driven headers/title) | #135 | **manual** (Padres fork test) — *gap: no automated fork assertion* | ✅ |
| CI auto-revalidate after baseline regen | #136 | exercised on every visual PR | ✅ |
| Heat-bar coverage (every player ranked) | #138 | pytest (rank tests assert coverage) + contract (`check_data_completeness` coverage audit) + visual (fixture now 26/26) | ⏳ pending merge |
| Brand mark — segmented diamond | #138 | visual baselines | ⏳ pending merge |
| Reliever IP-row suppression | #138 | **manual** — *gap: no probe asserts RP modals omit IP* | ⏳ pending merge |

## Known guard gaps (backlog)

These features work but rely on manual verification — the next regression
won't be caught automatically. Prioritized for follow-up guards:

1. **a11y** — wire `@axe-core/playwright` into `probes.yml` as a probe so
   contrast/ARIA regressions fail CI (the audit in `docs/v2-a11y-audit.md`
   already used axe; promote it from one-off to standing guard).
2. **Forkability** — a probe that loads the dashboard under a non-Jays
   `config.json` fixture and asserts the division/wild-card headers + title
   resolve (codify the Padres fork test).
3. **Reliever IP-row** — extend `player-ranks.js` / a modal probe to assert
   an RP modal has no IP row and an SP modal does.

## Open process question

The visual-regression flow shows a **transient red** on the pre-regeneration
commit of any pixel-changing PR (the first `pull_request` run compares against
stale baselines before the in-CI regen lands). It's expected and harmless —
judge the PR by its head-commit check — but it has triggered "run failed"
alarms 3×. Options to weigh (none free): (a) document-only (status quo); (b)
soft-fail the visual step on `pull_request` while hard-failing on `push`/
dispatch — kills the noise but weakens the pre-merge catch; (c) move visual to
a separate workflow that only runs on push/dispatch. Decision deferred to the
maintainer — see `docs/visual-regression.md`.
