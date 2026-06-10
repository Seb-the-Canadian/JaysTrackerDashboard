# Repo notes for Claude

Blue Jays 2026 Tracker — daily-refreshed MLB dashboard, GitHub-Pages-hosted.

## Definition of done (every feature)

A feature is not done until a machine guards it and it's confirmed live:

1. The change itself.
2. A **durable guard** — a probe (`tests/probes/`), pytest, or data-contract
   assertion (`tools/check_data_completeness.py`) that **fails if the feature
   regresses**. No guard yet → say so explicitly in the feature ledger.
3. Confirmed on **main AND the live Pages deploy** — not just branch CI.
   ("Branch CI green" is not "shipped": #135 merged before its mark commits,
   so an approved, branch-green feature never reached main or the live site.)
4. A row in [`docs/feature-ledger.md`](docs/feature-ledger.md).

Guarantee the *outcome*, not the mechanism: "render as percentile" fixed the
scale but never asserted coverage, so heat bars sat at 6/26 unnoticed. Assert
the thing the user sees.

## Quick orientation

- `fetch_data.py` → writes `data.json` (machine facts)
- `notes.json` → hand-authored analyst voice, keyed by `gamePk` / `person_id`
- `index.html` → loads `data.json` + `notes.json` + `config.json`, renders dashboard
- Daily refresh: GitHub Actions cron — `.github/workflows/daily-refresh.yml` at 09:00 UTC

The Claude Code Routine was the original scheduler; we swapped to GitHub Actions because the Routine environment's outbound network policy blocked `statsapi.mlb.com`. See [`.github/workflows/daily-refresh.yml`](.github/workflows/daily-refresh.yml) for current state. The README still describes the Routine as primary — issue #32 tracks the doc update.

## Environment constraint that affects most work

`statsapi.mlb.com` is **blocked** from the interactive Claude container's outbound network policy. You cannot run `fetch_data.py` locally to verify data shape. To validate fetcher changes:

1. Push the branch
2. Trigger the workflow manually: `mcp__github__` workflow_dispatch tool, or web UI
3. Pull the resulting commit and inspect `data.json`

`baseballsavant.mlb.com` (referenced in issue #29) likely has the same limit — same approach if you ever pick that work up.

## Backlog work

For dispatching sub-agents on the issue backlog, see [`docs/agent-dispatch.md`](docs/agent-dispatch.md). It covers per-issue triage, when to swarm vs go solo, prompt templates, and a worked example using issue #24.

## Open issues snapshot

Categories (full list at GitHub issues #20–33):

- **Narrative** (#20–23): expand `notes.json` schema for per-player, overview, team, and injury voice. #20 is the foundation; the others reuse its merge pattern.
- **Data** (#24, #25, #29): team stats with ranks, hot/cold tags, Statcast (deferred).
- **UI** (#26, #27): role-based player grouping, Stat School team examples.
- **Bug** (#28): filter "Reassigned to Minors" out of the injury list.
- **Docs/meta** (#30–33): README screenshot, project-plan typo, scheduler-swap doc update, GitHub labels.
