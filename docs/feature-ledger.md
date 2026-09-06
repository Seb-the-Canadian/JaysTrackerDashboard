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
| Heat-bar coverage (every player ranked) | #138 | pytest (rank tests assert coverage) + contract (`check_data_completeness` coverage audit) + visual | ✅ merged `846ad53`; live 2026-09-02: 14/14 hitters, 13/13 pitchers ranked |
| Brand mark — segmented diamond | #138 | visual baselines | ✅ merged `846ad53`; visual probe green in every daily refresh |
| Reliever IP-row suppression | #138 | **manual** — *gap: no probe asserts RP modals omit IP* | ✅ merged `846ad53`; **still unguarded** |
| CI guards run on daily-refresh commits | #142 | the refresh workflow now *calls* `tests.yml` + `probes.yml` (a GITHUB_TOKEN push can't trigger them) | ✅ run [`33634702173`](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/actions/runs/33634702173) shows `total_count: 4`; runs 125–136 (12 consecutive) all carry `referenced_workflows` |
| Probes propagate failures to exit code | #142 | pytest (`test_probe_contract.py`) — fails if any probe can't exit nonzero | ✅ audit 2026-09-02: planted an exit-0 probe, test failed as designed |
| Every probe is wired into CI | #142 | pytest (`test_probe_contract.py`) — fails if a probe file is unreferenced by `probes.yml` | ✅ audit 2026-09-02: planted an unwired probe, test failed as designed |
| Wild Card panel always shows our team | #142 | probe (`wildcard-visibility.js`, our team at every "Out" slot) — **round-1 does not cover this today**, see below | ✅ mutation-tested live 2026-09-02: bug reintroduced → `wildcard-visibility` exit 1 (8 fail) |
| Notes-staleness stamp is honest under shallow clone | #142 | pytest (`test_notes_meta.py` — real shallow clone, asserts unknown ≠ HEAD date) | ✅ live stamp reads `2026-08-09`, not today; `check_notes_freshness` now fires (4 findings, 28d) |
| Small-sample rank floor | #142 | pytest (`test_rank_gate.py` boundary cases) + contract (`SUB-SAMPLE RANK` warn) | ✅ live contract clean, no sub-sample warn — **but see gap 5: the floor does not fix rank *clamping*** |

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
4. **Live-deploy confirmation is still manual.** Every row above says
   "confirmed live" on someone's word. Nothing machine-checks that
   `https://…github.io/…/data.json` is actually fresh and well-formed after
   a deploy — Pages could silently serve a stale build and every guard here
   would stay green. A post-deploy smoke check that fetches the live URL is
   the missing piece.
5. **Pitcher ranks are clamped at both ends — live defect, not yet fixed.**
   `player_rank_pool.pitching` is **49**: MLB's qualified pitchers are
   essentially starters, so every reliever is slotted into a starters-only
   distribution. Measured on 2026-09-02 data:

   | | |
   |---|---|
   | Clamped to rank 49 = **0th %ile** | Little (8.27 ERA), Lorenzen (7.13), Scherzer (6.16), Sewald (5.44) |
   | Ranked ≥98th %ile | Varland 1.18 (100th), Rogers 1.90 (98th) |

   Four pitchers whose ERAs span 5.44–8.27 render as an *identical* empty
   heat bar, because `_value_rank` clamps `better + 1` to `pool`. And a
   reliever tops the league because relievers out-perform starters on ERA by
   construction. Hitters are fine (pool 141, one clamped, good spread) — this
   is pitcher-specific. The `MIN_IP_FOR_RANK` floor added in #142 fixes the
   *tiny-sample* end and does nothing here.
6. **The contract's plausibility check is one-sided.** `warn_scan` says in
   its own comment "coverage checks are blind to this by construction, so
   assert plausibility too" — but it only asserts the sub-sample end
   (`SUB-SAMPLE RANK`). Nothing warns when N players pile up at rank == pool,
   which is the failure actually live today. A `CLAMPED RANK` warn when more
   than one player shares the extreme rank would have caught gap 5 on the
   first refresh.
7. **`gamelog_cache.json` has no shrink assertion.** Nothing fails when a
   retained player's `splits` list gets shorter. A silent cache truncation is
   currently indistinguishable in CI from routine roster churn; the only
   reason the 2026-08-11 ~2400-line drop was known benign is that it was
   checked by hand.
8. **`fetch_league_player_rankings`'s docstring contradicts its code.** It
   states "Players outside their group's qualified pool … return None for
   every slug. Per decision D1", while the body ranks every rostered player
   with enough playing time. The stale sentence describes the pre-#138
   behaviour and should go, or D1 should be restated.

## The blackout, measured on main (2026-08-09)

Side-by-side proof, captured the morning this fix was in review — same
workflow, same day, one on `main` and one on the branch:

| | `main` (old workflow) | branch (this PR) |
|---|---|---|
| Run | [`31306371233`](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/actions/runs/31306371233) (schedule, 09:37 UTC) | `31292193748` (dispatch, 03:19 UTC) |
| Jobs | **1** — `refresh` | **4** — `refresh`, `pytest`, `probes`, `regenerate-baselines` |
| Guards run | none | pytest ✅, 22 probes ✅ |
| Result | pushed `39f1157`, Pages deployed it | verified before and after the push |

`total_count: 1`. That single number is the whole bug: the refresh fetched,
committed and shipped commit **51** to the live site with nothing checking
it. Note the run's own steps look reassuring — completeness, notes-drift,
orphan-key and freshness scans all "succeeded" — because every one of them
is warn-only. The blocking guards are the two jobs that aren't there.

Corollary worth keeping: the data `main` produced that morning still ranks
Brett Bateman off 8 AB, so `check_data_completeness` warns `SUB-SAMPLE RANK`
against it. The floor cannot apply to data generated before it lands. The
bug is live on `main` until this merges — not a prediction, a measurement.

## Lesson from the 2026-08 guard blackout

Worth keeping because it cost 50 unguarded refreshes: **a guard's value is
capped by whether anyone finds out it fired.** All three failures in that
incident were of the "detected but unheard" family, not the "undetected"
family:

- `probes.yml` was correctly written and correctly failing — it just never
  ran, because GITHUB_TOKEN pushes don't trigger `push` workflows.
- `round-1.js` correctly detected the Wild Card regression on every run for
  27 days, and exited 0 while doing it.

  Re-tested 2026-09-02 by reintroducing `out.slice(0, 4)` on live data:
  **`round-1` now passes it — 38 PASS, 0 FAIL, exit 0.** The Jays currently
  sit 3rd of 9 in the "Out" group, inside the window, so the assertion it
  makes against committed data cannot see the bug. `wildcard-visibility.js`
  caught it (exit 1, 8 fail) because it places our row at every slot with
  synthetic fixtures. The lesson generalises: a guard that asserts against
  today's live data inherits today's luck. Assert against constructed
  worst cases, not the standings.
- `check_notes_freshness.py` was structurally unable to fire, because the
  timestamp it reads was silently wrong under a shallow clone.

When adding a guard, ask the second question too: *what makes its failure
reach a human?*

Two follow-ons surfaced while verifying the fix, both still open:

- **The staleness chip measures the file, not the voice.** It reads the
  last commit touching `notes.json`, so a three-line factual correction
  resets the clock to "refreshed today" over prose that is otherwise
  months old. Honest about the file; misleading about the analysis. If the
  badge is meant to promise freshness of *judgement*, it needs a signal the
  author sets deliberately (e.g. a hand-maintained `notes.overview.as_of`)
  rather than one derived from git.

- **A bot push to a PR branch parks that PR's checks as `action_required`.**
  Not the same mechanism as the `push`-event suppression above, and worth
  stating precisely because the first read of it here was wrong. The runs
  *are* created — GitHub then immediately parks them awaiting manual
  approval, because the triggering actor is `github-actions[bot]`
  (`created_at == updated_at`, no job ever starts). So the head commit
  reports zero *check runs* while the Actions list shows two amber runs
  that read as failures. Seen live on 2026-08-09: the refresh pushed
  `0963b14` to this branch and both `Tests` and `UI probes` parked.

  This does not touch the daily refresh on `main` — there is no PR there,
  and the refresh calls its guards inside its own run. It only appears when
  the bot pushes to a branch with an open PR. Judge such a PR by the
  refresh run; pushing any human-authored commit repopulates the checks.

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
