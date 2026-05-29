# Roadmap

Where this project is going. Updated as scope shifts; commit history is the durable record of past changes.

**Pipeline:**

> Issue filed → triaged into a bucket below → planned → in-flight (open PR) → shipped (merged + verified by next daily refresh).

---

## v1.0 — stable, forkable (target: imminent)

The chassis is feature-complete. v1.0 is gated on documentation polish and a short stretch of operational stability, not on missing features.

### Shipped

**Data layer**

- Daily refresh via GitHub Actions ([`.github/workflows/daily-refresh.yml`](../.github/workflows/daily-refresh.yml))
- MLB Stats API integration via `MLB-StatsAPI` — schedule, standings, rosters, season + per-game stats, injuries, transactions
- Wild-card race derived from full league standings (all 15 AL teams) — issue #48
- Hot/cold/new player tags auto-derived from a 7-game window — issue #25, fixed in #59/#63
- gameLog cache cuts API calls to zero for non-playing players — issue #52, shipped in #67
- RSS news ingest, per-feed configurable, optional keyword filter — issues #49/#50, recency configurable in #64
- Optional LLM TL;DR summarizer with pluggable provider (Anthropic/OpenAI/Ollama) — issue #53, shipped in #82
- Statcast metrics for hitters and team defense (xwOBA, Barrel%, Hard-Hit%, OAA) via MLB Stats API + Baseball Savant — issue #29, shipped in #83/#84/#85/#86
- Atomic write + invariant assertions before publishing `data.json`
- Today's game in `upcoming_games` (off-by-one fix) — issue #62
- Schema-correct `news.published` (ISO 8601) and wild-card `gb` for tied teams — issue #61

**Render layer**

- Four-tab dashboard: Overview / Players / Team Stats / Stat School
- Role-grouped player cards (Rotation / Bullpen / Lineup Regulars / Bench) — issue #26, completed via `gs` fix in #58
- Team Stats with MLB ranks (1–30) and Strengths vs Soft Spots panel — issues #22, #24
- Run-differential chart over the last 10 games
- localStorage cache + background refetch for instant reopens
- Schema-drift banner if `data.json` loses a known key

**Analyst layer (`notes.json`)**

- Six top-level keys: `games`, `players`, `overview`, `team`, `pitches`, `injuries` — Waves 1–3
- HTML in note bodies renders as-is (author is the trust boundary, Phase 3)
- Missing keys degrade silently — facts always render

**Forkability**

- Single-file config (`config.json`) controls team identity, colors, RSS feeds, news recency window
- No hardcoded team IDs in fetcher or renderer
- Team-ID lookup at [`docs/team-ids.md`](team-ids.md)

**Documentation**

- README accurate after Wave 1/2/3 + RSS + wild card + hot/cold — shipped in #65
- `docs/agent-dispatch.md` lessons learned — shipped in #65
- `docs/data-schema.md` canonical data.json reference — shipped in #68

### Gating items for the v1.0 tag

- [ ] README screenshot — issue #30
- [ ] At least 7 consecutive successful daily refreshes after the last breaking PR (rolling operational-stability check)
- [ ] Forkability spot-check — either an external fork test or a written walkthrough confirming `config.json` is the only edit needed
- [ ] README banner / blurb signaling "v1 — stable, suitable for forks"

---

## v1.x — next, no fixed dates

Real work; just not blocking the v1.0 tag.

- **RSS news source breadth — issue #60 (partial)** — The recency widening + per-feed `INFO` logging shipped in #64. Sportsnet still returns 0 items in the latest run. Next step: read the workflow log's `INFO: feed Sportsnet:` line to confirm whether feedparser sees 0 entries (URL issue) or sees entries that all get filtered (recency / keyword issue).
- **Probable-pitcher freshness — issue #66** — User-reported case: Trevor Rogers shown as Orioles' game-2 probable for the 5/29 game when reportedly incorrect. Code routes the field directly from the schedule endpoint; either MLB is stale, MLB is wrong, or a different endpoint (e.g., `/teams/{id}/probablePitchers`) carries fresher data. Investigate from a network with `statsapi.mlb.com` access.
- **Opt-in LLM summarization for RSS — issue #53** — File is in place; implement only if reader feedback specifically asks for it.
- **Custom labels for the issue tracker — issue #33** — Operational cleanup; tooling-blocked from the agent environment but trivial from a shell with `gh` configured.

---

## v2+ — open exploration

Bigger asks. Not committed; filing here so they're not lost.

- **Per-position OAA** — currently a single team rolled-up number. Per-position (CF range ≠ 1B scoops) would expand `team_stats.defense` to a nested by-position structure.
- **Pitcher expectedStatistics** (xERA, xwOBA-against) — issue body for #29 was hitter + team-defense only. Same MLB Stats API pattern as PR #83; would extend to the pitcher branch of `transform_roster`.
- **Year-over-year comparison views** — same dashboard, current vs prior season side-by-side. Affects schema (`data.json`) and renderer.
- **Live in-game polling** — once-a-day → minute-by-minute during a game. Substantial architectural shift; likely needs a different render layer.
- **Multi-team dashboard view** — show a small set of teams (e.g., all AL East) on one page. Affects config shape and renderer.
- **Admin tool for analyst notes** — replace text-editor authoring with a small web form. Explicit non-goal for v1 (see below); revisit if reader feedback says editing JSON is friction.

---

## Explicit non-goals

- **Not real-time.** Once-a-day refresh by design. In-game state lives on MLB Gameday; this dashboard is the morning-after view.
- **Not an AI commentator.** "Voices around" surfaces real bylined writers' headlines + links; the reader clicks for the take. The optional LLM-summarize layer (#53) is reader-toggleable, not the default.
- **Not a CMS for notes.** Text editor → commit `notes.json` is the authoring tool. Simpler than maintaining an admin app.
- **Not Statcast or FanGraphs.** Different data sources, different scope. We point readers at those sites where relevant.
- **Not auto-everything.** Forks expect to write some `notes.json` content; that's the human-voice layer the project is built around.

---

## How items move through this list

1. **Filed** — any open issue is a candidate, including bugs.
2. **Triaged** — categorized into v1.0 gating / v1.x / v2+ / non-goal, usually within a day or two of filing.
3. **Planned** — committed for the next session; assigned in #54 or referenced from a sub-issue.
4. **In-flight** — open draft PR exists.
5. **Shipped** — merged and verified by the next daily refresh.
6. **Closed** — issue closes when the PR merges; this roadmap moves the item from "in-flight" to "shipped" on the next edit.

This roadmap is the running tally. Refresh it on each milestone (v1.0 tag, v1.x kickoff). Between milestones, drift is acceptable — the issue list is the more current source.
