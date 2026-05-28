# Changelog

All notable changes to this project will be documented in this file.

This project does not yet have a tagged release. Everything below is **Unreleased** — the running record of merged work, organized chronologically by milestone. The next entry will be the v1.0 tag (see [`docs/roadmap.md`](docs/roadmap.md) for v1.0's gating criteria).

The format groups changes by milestone-or-wave rather than by category. Within each section, entries link to the PR (`#NN`) where one exists; very early commits predate the PR workflow and link by commit hash.

---

## Unreleased

### Debug pass + docs build-out (2026-05-28)

A full debug pass on the as-shipped dashboard surfaced a cluster of bugs (some user-visible, some schema-only). Plus a cache layer for the gameLog API and substantial documentation work.

**Added**
- `feat(data): cache gameLog responses per player` ([#67](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/67), closes [#52](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/issues/52)) — committed cache at `data/gamelog_cache.json`; cuts gameLog API calls to zero for non-playing players via signature-based hit detection.
- `docs(schema): canonical data.json schema reference` ([#68](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/68)) — 660-line reference covering all 14 top-level keys with real examples, source functions, and consumer locations.
- `docs(agent-dispatch): 5 lessons learned` ([#65](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/65)) — `/stats?personId` trap, schedule-window boundary rule, RSS silent-skip patterns, EXPECTED_KEYS drift, and the network-policy constraint that blocks fetcher verification from the interactive container.
- `docs(readme): describe what's on the dashboard + refresh RSS config example` ([#65](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/65)) — tab-by-tab description; updated RSS example with all 4 configured feeds + `news_recent_days`.
- `docs: roadmap + operations runbook` ([#69](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/69)) — forward-looking roadmap (v1.0 / v1.x / v2+) plus symptom → diagnosis → fix runbook for every failure mode surfaced this session.

**Fixed**
- `fix(roster): populate gs so Starting Rotation section renders` ([#58](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/58)) — `gamesStarted` was missing from pitcher records; all pitchers fell into Bullpen, Starting Rotation rendered empty.
- `fix(roster): add team_stats + config to EXPECTED_KEYS` ([#58](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/58)) — schema-drift banner wasn't protecting these two top-level keys.
- `fix(schedule): include today's game in upcoming_games` ([#62](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/62)) — off-by-one in `fetch_schedule` dropped a same-day game until it went Final.
- `fix(schema): news.published as ISO 8601` ([#63](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/63), closes [#61](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/issues/61)) — field name implied ISO 8601 but raw RFC 822 was emitted.
- `fix(schema): wild-card gb for tied teams` ([#63](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/63)) — teams tied with the WC3 cutoff now show `"0.0"` instead of the leader-marker `"-"`.
- `fix(data): route gameLog through /people/{id}` ([#63](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/63), closes [#59](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/issues/59)) — `/stats?personId=X` silently ignored `personId`; hot/cold/new pill was null for every player. Fix routes through `/people/{id}` with a stats hydrate.
- `fix(news): configurable recency window + per-feed diagnostic logging` ([#64](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/64), partial [#60](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/issues/60)) — `news_recent_days` now reads from `config.json`; per-feed INFO line surfaces silent-skip cases.

### Wave 3: team and injury narrative, RSS, hot/cold, wild card (2026-05-27)

The last big content wave before the docs polish. Team narrative + Strengths vs Soft Spots, injury narrative with ETA, the Voices around RSS panel, automatic hot/cold/new player tags, and the wild-card race rewrite.

**Added**
- `feat(team): render NOTES.team ctx + Strengths/Soft Spots panel` ([#57](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/57))
- `feat(notes): team context + Strengths vs Soft Spots` ([#57](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/57))
- `feat(injury): merge NOTES.injuries into renderInjuryCard` ([#56](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/56))
- `feat(notes): injury narrative (detail + eta per player)` ([#56](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/56))
- `feat(data): populate person_id on injury rows for notes merge` ([#56](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/56)) — enabled `notes.json.injuries[person_id]` merge by ID instead of fragile name match.
- `feat(ui): render hot/cold/new tag pill on player cards` ([#51](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/51))
- `feat(data): auto-derive hot/cold/new player tag from gameLog` ([#51](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/51)) — 7-game window compared against season rate; "new" for <14 days in MLB this season.
- `feat(news): RSS passthrough — Voices around panel + per-feed config` ([#50](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/50)) — headlines + bylines + links to real writers; configurable in `config.json.rss_feeds`.
- `docs: refresh README + add lessons-learned to agent-dispatch` ([#55](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/55))

**Fixed**
- `fix(data): derive wild_card from regular standings` ([#48](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/48)) — pre-fix MLB endpoint returned only 5 teams; now all 15 AL teams sort into Division leader / WC seed / Out.

### Wave 2: team stats with ranks, overview narrative, Stat School (2026-05-27)

**Added**
- `feat(data): team_stats with MLB rankings` ([#46](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/46)) — hitting and pitching aggregates with 1–30 league rank per stat.
- `feat(overview): add State-of-the-Season narrative renderer` ([#45](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/45))
- `feat(notes): overview State-of-the-Season narrative` ([#45](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/45))
- `feat(school): Team note row for pitches in Stat School` ([#47](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/47))
- `feat(notes): per-pitch Team notes in Stat School` ([#47](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/47))

### Wave 1: notes foundation, role grouping, injury split (2026-05-27)

**Added**
- `feat(notes): per-player schema with read/recentNote/contextNotes` ([#36](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/36)) — foundation for the analyst voice layer; the schema other waves reuse.
- `ui: group Players panel into four role-based sections` ([#37](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/37)) — Starting Rotation / Bullpen / Lineup Regulars / Bench / Depth.
- `fix: split injury list into Injured + Other Unavailable` ([#41](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/41)) — separates "Injured 10-Day" from "Reassigned to Minors" etc. (closes [#28](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/issues/28)).

**Docs**
- `docs: add sub-agent dispatch method + CLAUDE.md repo notes` ([#34](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/34))
- `chore: gitignore .claude/ local worktrees and state` ([#35](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/35))
- `docs: correct division-size invariant (all MLB divisions have 5 teams)` ([#39](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/39))
- `docs: reflect GitHub Actions as primary scheduler` ([#39](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/39))

### Pre-wave production stabilization (2026-05-27)

The initial fetcher had several "looks correct but isn't" bugs. This stretch surfaced and fixed them before any new features landed.

**Fixed**
- `fix: use player_stat_data helper so personId actually scopes the query` ([#17](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/17)) — the original `/stats?personId=X` call ignored `personId` (same trap as [#59](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/issues/59)). Routed through `/people/{id}` helper.
- `fix: read game decisions inline via schedule's hydrate=decisions` ([#18](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/18)) — saved ~10 per-game `/boxscore` calls per run.
- `fix: division name via /divisions lookup` ([#19](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/19)) — was rendering the literal string `"division"`.
- `fix: full team names via /teams lookup for standings + wild card` (commit `7a87add`)
- `fix: format team.place as 'Nth in <Division Name>'` (commit `1845ae3`)
- `fix: pull injuries from 40-man, filter to non-Active status` (commit `ae28c54`)
- `fix: pull season stats via /stats endpoint instead of /people/{id}/stats` (commit `bb8797b`) — initial misroute; later corrected by #17 above.
- `fix: read pitching decisions from boxscore top-level decisions` (commit `a30a41b`)
- `refine: filter injury list on both status.code and description` (commit `4fd6bb7`)
- `refine: fall back to walking players[] if box.decisions is empty` (commit `a3100c9`)

**Workflow**
- `workflow: rebase-and-retry the daily push if main moves mid-run` (commit `ab907be`) — handles the case where a PR merge or concurrent workflow run lands a commit between checkout and push.
- `workflow: bump checkout + setup-python to v6 (Node 24)` (commit `1e8989f`)

### Initial buildout — Phases 1–7 (2026-05-26)

The seven-phase initial implementation, from empty repo to live dashboard.

- **Phase 1: repo bootstrap** (commit `1498744`)
- **Phase 2: fetcher script + data schema** (commit `c62e1c2`) — `fetch_data.py` v0; the data layer.
- **Phase 3: dashboard refactor — data-driven rendering** (commit `cbc857f`) — `index.html` becomes a render of `data.json`; the chassis we still ship on.
- **Phase 4: add .nojekyll for GitHub Pages** (commit `fca387a`)
- **Phase 5: wrapper scripts for daily refresh** (commit `b48c7d7`) — `scripts/update_and_push.sh` + `fetch_only.sh`.
- **Phase 6: launchd fallback — plist template + migration guide** (commit `0ee2133`) — see [`docs/launchd-migration.md`](docs/launchd-migration.md).
- **Phase 7: full README + team-IDs reference** (commit `96ab133`) — [`docs/team-ids.md`](docs/team-ids.md) for forkers.

### Operational migration (2026-05-27)

- `Add GitHub Actions daily refresh workflow` (commit `39c9b49`) — superseded the Claude Code Routine path; statsapi.mlb.com is reachable from Actions runners but was blocked from the Routine environment (see [#32](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/issues/32) history).

---

## How to update this file

When a PR merges to `main`:

1. Add a one-line entry to the most recent milestone section under the appropriate sub-heading (Added / Fixed / Docs / Workflow).
2. Format: `commit-style title (#PR, [closes #NN])` — match the commit prefix (`feat:`, `fix:`, `docs:`, etc.).
3. Link the PR number and any closed issues.

Daily-refresh commits (`Daily data refresh: YYYY-MM-DD`) do not appear here — they're machine-generated content, not changes worth a reader's time.

When we tag v1.0, the entire "Unreleased" section becomes the v1.0 release notes; future work starts a fresh "Unreleased" section above the v1.0 heading.
