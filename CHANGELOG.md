# Changelog

All notable changes to this project will be documented in this file.

This project does not yet have a tagged release. Everything below is **Unreleased** — the running record of merged work, organized chronologically by milestone. The next entry will be the v1.0 tag (see [`docs/roadmap.md`](docs/roadmap.md) for v1.0's gating criteria).

The format groups changes by milestone-or-wave rather than by category. Within each section, entries link to the PR (`#NN`) where one exists; very early commits predate the PR workflow and link by commit hash.

---

## Unreleased

### Notes free-text protection + test buildout (2026-05-30)

A direct response to PR #88's three stale-name findings (Bo Bichette, Berríos, Kirk's outdated injury detail). Builds the documentation, scanners, and tests that make this class of drift visible and prevent it going forward. Anti-fragile layers ship as warn-only post-merge nets so they catch real bugs without blocking the build on tuning. Closes [#75](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/issues/75) (comprehensive pytest coverage) along the way.

**Added**
- `docs(notes): free-text fields registry + notes.json schema section` ([#89](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/89)) — new `docs/free-text-fields.md` enumerates every free-text-bearing field across `notes.json` / `data.json` / `config.json` / `index.html` with drift class, names-Y/N, HTML-Y/N, cadence. Closes the asymmetry with `data-schema.md` (which had zero notes.json coverage despite 689 lines of data.json reference).
- `feat(notes): drift scanner with whitelist, opt-out marker, pytest gate` ([#90](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/90)) — `tools/scan_notes_drift.py` walks the HIGH-drift fields from the registry, builds a name dictionary from current `data.json.roster.{hitters,pitchers}[].name + injuries[].name`, flags capitalized-word tokens that don't match. Three tuning controls: universal in-code `STOPWORDS`, per-fork `.notes-scan-allow.json` whitelist, in-field `<!-- noscan -->` opt-out marker. Caught real drift on bootstrap — Bassitt reference in `pitches.Four-Seam Fastball` fixed in the same PR. 41 new pytest tests.
- `feat(notes): wire drift scanner into daily refresh (warn-only)` ([#91](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/91)) — new `Scan notes for drift (warn-only)` step in `.github/workflows/daily-refresh.yml` between fetch and commit; new `scan_notes_orphans`-style `scan_notes_drift` config flag (default `true`) for fork opt-out. Post-merge safety net: findings go to log, exit-0 always.
- `test(fetchers): cover API-wrapping fetchers + Running tests docs` ([#92](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/92), closes [#75](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/issues/75)) — `tests/test_fetchers.py` covers `fetch_team_names`, `fetch_division_names`, `fetch_division_record`, `fetch_active_roster`, `fetch_injury_report` (the last one carries real branching: active filter, injured-vs-other split from #28/#41). Coverage on `fetch_data.py` 78% → 81%. README gets a "Running tests" section; runbook gets a "Pytest suite failed in CI" entry.
- `feat(notes): keyed-orphan scanner` ([#93](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/93)) — `tools/scan_notes_orphans.py` is the keyspace counterpart to the drift scanner. Catches `notes.players[id]` / `notes.injuries[id]` entries whose ID no longer matches roster / IL / other-unavailable. Same warn-only posture, same fork opt-out (`scan_notes_orphans` flag, `.notes-scan-allow.json` `orphan_ids` list). 30 new pytest tests, 413 total at 81% coverage.

### Statcast integration (2026-05-29)

Issue #29 — pull Statcast metrics into the dashboard. Hybrid sourcing: xwOBA via MLB Stats API's `expectedStatistics` hydrate (no new dependencies); Barrel% / Hard-Hit% / team OAA via Baseball Savant leaderboard CSVs (stdlib `urllib` + `csv`, also no new dependencies). Shipped in 5 PRs with explicit roadblock decision points; planning detailed in `/root/.claude/plans/agile-seeking-seal.md`.

**Added**
- `feat(statcast): xwOBA on hitters via MLB Stats API` ([#83](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/83)) — new `fetch_player_xstats` helper, same `/people/{id}` hydrate pattern as `_fetch_game_log` (PR #63 workaround for `player_stat_data`'s strict-type guard). Adds `xwoba` field on every hitter row, `.---` placeholder fallback. Zero new dependencies, zero renderer changes (data-driven modal picks it up automatically).
- `feat(statcast): probe Baseball Savant access` ([#84](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/84)) — manual-dispatch workflow + stdlib probe script that confirms `baseballsavant.mlb.com` is reachable from the GH Actions runner. Gates the next two PRs.
- `feat(statcast): Barrel% + Hard-Hit% via Savant CSV` ([#85](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/85)) — `fetch_savant_team_csv` generic helper + `fetch_savant_barrels`. Adds `barrel_pct` and `hardhit_pct` fields on every hitter row. Soft-fails: WARN log + `---` placeholders, never `die()`. Defensive column-name lookup handles Savant's cross-season rotations.
- `feat(statcast): team OAA + Defense card` ([#86](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/pull/86)) — `fetch_savant_oaa` + new `team_stats.defense` group + Defense card on the Team Stats tab. `combine_team_stats` extended to emit any extra groups while preserving the hitting+pitching backwards-compatibility guarantee.
- `docs(statcast): cleanup + roadmap migration` ([this PR]) — moves #29 from v2+ to Shipped; updates README's "not Statcast" line; documents `statcast_enabled` config flag in the forking guide.

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
