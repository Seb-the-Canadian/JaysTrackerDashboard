# Blue Jays 2026 Tracker

A live MLB season dashboard. Auto-refreshes daily. Hosted on GitHub Pages. Forkable for any team in MLB by editing one config file.

**Live:** https://seb-the-canadian.github.io/JaysTrackerDashboard/

The data layer pulls from the MLB Stats API every morning. Three layers of voice sit on top of the facts: hand-authored analyst notes in `notes.json` (per-game, per-player, overview, team-level, pitch types, injuries); bylined external takes pulled from RSS feeds configured in `config.json` (the "Voices around" panel on the Overview tab); and inline static reference (Stat School). The maintainer pays no token cost for the daily data or news — only when authoring notes.

---

## Use it as-is

Just visit the link above. Daily refresh runs at 09:00 UTC (05:00 ET, after prior night's boxscores have settled) via GitHub Actions — see [`.github/workflows/daily-refresh.yml`](.github/workflows/daily-refresh.yml). On reopens within the same day, the dashboard renders instantly from `localStorage` and refetches in the background.

---

## Fork it for your team

Three steps, ~15 minutes:

1. **Fork this repo** on GitHub.
2. **Edit `config.json`** with your team's identifiers. The full list of every MLB team's IDs is in [`docs/team-ids.md`](docs/team-ids.md) — find your team, copy the JSON snippet over your fork's `config.json`. Also pick a `primary_color`, `accent_color`, `dashboard_title`, and `brand_mark` (a single character).
3. **Enable Pages** on your fork: Settings → Pages → Source: `main` branch / root. Pick a runner (next section). Done.

That's it. No code changes; the fetcher reads everything team-specific from `config.json`.

---

## Architecture

```
                  ┌─────────────────────────┐
                  │   Scheduler             │
                  │   (daily, cron)         │
                  │                         │
                  │  - GitHub Actions       │
                  │  - or macOS launchd     │
                  │  - or Claude Routine    │
                  │  - or manual run        │
                  └────────────┬────────────┘
                               │
                               ▼
                  ┌─────────────────────────┐
                  │   fetch_data.py         │
                  │   (Python, MLB-StatsAPI)│
                  │                         │
                  │  reads  config.json     │
                  │  fetches MLB Stats API  │
                  │  writes data.json       │
                  └────────────┬────────────┘
                               │
                       commit + push to main
                               │
                               ▼
                  ┌─────────────────────────┐
                  │   GitHub Pages          │
                  │   serves index.html     │
                  │   + data.json           │
                  │   + notes.json          │
                  │   + config.json         │
                  └────────────┬────────────┘
                               │
                               ▼
                  ┌─────────────────────────┐
                  │   index.html            │
                  │   (browser)             │
                  │                         │
                  │  loads all three files  │
                  │  merges + renders       │
                  │  caches to localStorage │
                  └─────────────────────────┘
```

Three runtime pieces, four files of state. Nothing else.

---

## Runner setup

Pick one. They're mutually exclusive — never enable two at once or you'll get duplicate daily commits.

### Option A — GitHub Actions (recommended)

Free for public repos, no token cost, cron-driven. **This is the scheduler currently running in this repo.** See [`.github/workflows/daily-refresh.yml`](.github/workflows/daily-refresh.yml) for the workflow definition. It runs `scripts/update_and_push.sh` on a daily cron and also supports manual `workflow_dispatch` triggers from the Actions tab.

To enable on your fork: nothing to configure beyond forking. GitHub Actions is on by default for public-repo forks, and the workflow uses the built-in `GITHUB_TOKEN` for commits — no deploy key or PAT needed.

### Option B — macOS launchd

Free. Requires your Mac to be on (or able to wake) at the scheduled time. See [`docs/launchd-migration.md`](docs/launchd-migration.md) for the end-to-end walkthrough including the auth setup (deploy key recommended) and plist installation.

### Option C — Claude Code Routine

Requires a paid Claude Code subscription. Useful if you want AI-driven scheduling with natural-language prompts in the loop. Be aware: the Routine environment's outbound network policy blocked `statsapi.mlb.com` for us, which is why this repo swapped to Actions (see issue #32 history). Your mileage may vary depending on the allowlist state of the Routine sandbox when you try it.

1. Connect this repo to Claude Code.
2. Create a routine:
   - Trigger: **scheduled, daily, 12:00 UTC**
   - Prompt: `Run bash scripts/update_and_push.sh. If it exits non-zero, report the error in one sentence. Otherwise output the script's stdout verbatim.`
3. Trigger manually once to validate. Confirm a commit by `jays-tracker-bot` appears on `main`.

### Option D — manual

Whenever you feel like it:

```
bash scripts/fetch_only.sh
git add data.json && git commit -m "manual refresh" && git push
```

Or just `bash scripts/update_and_push.sh` if you have push credentials configured.

---

## Writing analyst notes

`notes.json` carries hand-authored content that layers on top of the machine facts. Every entry is optional — missing keys render facts-only with no broken layout.

Top-level shape:

```json
{
  "games":    { "<gamePk>":    { "moment": "...", "meaning": "..." } },
  "players":  { "<person_id>": { "recentNote": "...", "read": "...", "contextNotes": { "<stat>": "..." } } },
  "overview": { "headline": "...", "paragraphs": ["..."] },
  "team":     { "ctx": { "<group.stat>": "..." }, "strengths": ["..."], "softspots": ["..."] },
  "pitches":  { "<PitchName>":  "team-specific one-liner" },
  "injuries": { "<person_id>":  { "detail": "...", "eta": "..." } }
}
```

What each surfaces:

- **`games`** (keyed by `gamePk`): `moment` replaces the auto-summary on the game card; `meaning` appears when the card expands. Find `gamePk` in `data.json.recent_games[].game_pk`.
- **`players`** (keyed by `person_id`): `recentNote` shows on the player card; `read` is a paragraph in the player modal; `contextNotes` annotate each stat row in the modal. Find `person_id` in `data.json.roster.hitters[].id` / `pitchers[].id`.
- **`overview`**: a "State of the Season" narrative panel on the Overview tab. `paragraphs[]` accepts simple HTML (e.g., `<strong>`).
- **`team`**: per-stat context (keyed `group.stat`, e.g., `hitting.ops`) and a "Strengths vs Soft Spots" two-column panel on the Team Stats tab.
- **`pitches`** (keyed by pitch `name`, e.g., `"Splitter"`): a "Team note" row at the bottom of each pitch card in Stat School. Generic label, fork-friendly.
- **`injuries`** (keyed by `person_id`): `detail` replaces the API's terse status with a richer description; `eta` adds a return-timeline line.

HTML in note bodies renders as-is — the note author is the trust boundary (Phase 3 design). Add a note, commit `notes.json`, push. The dashboard picks it up on next load.

---

## Voices around (external takes)

The dashboard surfaces real bylined takes from RSS feeds, configured per-fork in `config.json.rss_feeds`:

```json
{
  "rss_feeds": [
    { "url": "https://www.sportsnet.ca/baseball/mlb/team/toronto-blue-jays/feed/", "source": "Sportsnet" },
    { "url": "https://news.google.com/rss/search?q=%22Toronto+Blue+Jays%22", "source": "Google News" }
  ]
}
```

Each entry: `url` is the feed, `source` is the display label, optional `keyword_filter` narrows general-MLB feeds to team-relevant items. Pure passthrough — headline + source + author + timestamp + link, no AI summarization. Reader clicks out to read the actual article. Forking for another team: swap in their local beats. No code change.

---

## What this dashboard is not

- It's not Statcast — no xwOBA, no barrel rate, no exit velocity, no sprint speed. Those live at Baseball Savant; deferred to v1.x (issue #29).
- It's not FanGraphs — no fWAR. There's no public WAR API.
- It's not real-time. The data is refreshed once a day; a game in progress won't appear here until tomorrow morning. The "Voices around" RSS panel refreshes with each daily run, so headlines may be more current than the stats.
- It's not an AI commentator. The dashboard does not interpret what writers said in the "Voices around" panel — it surfaces their headlines + bylines + links, reader clicks for the full take. An opt-in LLM-summarize layer is filed as #53; off by default.
- It's not a CMS for analyst notes. `notes.json` is hand-edited in a text editor. Future work could add a small admin tool.
- It's not low-maintenance to zero. The schema invariants will catch most fetcher failures, but a major MLB Stats API change would break the fetcher until someone updates `fetch_data.py`. Budget a couple hours a year for that.

The dashboard is a chassis. The voice is yours; the data is canonical; the maintenance is light but nonzero.

---

## Repo layout

```
.
├── index.html                          Dashboard (static, fetches the JSON files)
├── config.json                         Team identity + rss_feeds — the only file a forker edits
├── data.json                           Generated facts (machine-written daily; includes news[] from RSS)
├── notes.json                          Analyst voice (hand-written; games/players/overview/team/pitches/injuries)
├── fetch_data.py                       The fetcher (MLB Stats API + RSS via feedparser)
├── requirements.txt                    Python deps (MLB-StatsAPI, feedparser)
├── .nojekyll                           Disables Jekyll on Pages
├── CLAUDE.md                           Repo orientation auto-loaded by Claude Code sessions
├── scripts/
│   ├── update_and_push.sh              Daily entrypoint (routine + launchd)
│   ├── fetch_only.sh                   Local-run, no git side effects
│   └── com.jays-tracker.refresh.plist  launchd template
└── docs/
    ├── project-plan.md                 The refactor plan (architecture)
    ├── mlb-statsapi-reference.md       Endpoint shapes + field paths
    ├── launchd-migration.md            Setting up the macOS fallback
    ├── team-ids.md                     All 30 MLB teams' IDs for forkers
    └── agent-dispatch.md               How to use sub-agents on the issue backlog
```

---

## License

MIT. See [`LICENSE`](LICENSE).

The dashboard talks to the MLB Stats API. Use of MLB data is subject to the notice at https://gdx.mlb.com/components/copyright.txt — read it before deploying a public-facing fork.
