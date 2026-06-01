# Forking guide

Step-by-step instructions for cloning this dashboard for a different MLB team. Confirms the v1.0 promise: **`config.json` is the only file you edit.**

The fork takes about 15 minutes. No code changes required; no Python edits; no `index.html` edits unless you specifically want to customize the chrome.

---

## Prerequisites

- A GitHub account
- A modern browser (for opening Pages and the GitHub UI)
- Optionally, `git` + a text editor if you'd rather edit locally instead of in GitHub's web UI

That's it. No local Python, no Node, no Docker.

---

## Step 1 — Fork the repository

1. Visit https://github.com/Seb-the-Canadian/JaysTrackerDashboard
2. Click **Fork** (top right) → **Create fork** on your account
3. Wait ~5 seconds for the fork to provision

You now own a clone of the repo at `https://github.com/<your-username>/JaysTrackerDashboard`. Rename it if you like (`<team>-tracker` is conventional) under **Settings → Repository name**.

**Expected outcome:** the fork has all the files, the GitHub Actions workflow already wired up, and the `main` branch matching this repo's tip.

---

## Step 2 — Edit `config.json`

Open `config.json` on your fork (in the web UI: navigate to the file, click the pencil icon to edit in-browser).

Replace the Blue Jays values with your team's. The current Jays `config.json` for reference:

```json
{
  "team_id": 141,
  "team_name": "Toronto Blue Jays",
  "team_abbrev": "TOR",
  "league_id": 103,
  "division_id": 201,
  "season": 2026,
  "primary_color": "#134A8E",
  "accent_color": "#1d8acd",
  "dashboard_title": "Blue Jays 2026 Tracker",
  "brand_mark": "J",
  "news_recent_days": 7,
  "rss_feeds": [ ... ]
}
```

**Field guide:**

| Field | Value | Where to find it |
|---|---|---|
| `team_id` | MLB integer ID | [`docs/team-ids.md`](team-ids.md) |
| `team_name` | Full team name | Same |
| `team_abbrev` | Three-letter code (e.g., `"BOS"`, `"NYY"`) | Same |
| `league_id` | `103` for AL, `104` for NL | Same |
| `division_id` | One of `200`–`205` (see team-ids.md) | Same |
| `season` | Current MLB season year as int | Use the current year |
| `primary_color` | Hex color for headers, brand-mark background | Pick from team brand guide |
| `accent_color` | Hex color for chart highlights, hot pills | Pick a complement |
| `dashboard_title` | Browser tab + header title | Free text |
| `brand_mark` | Single character displayed in the brand box | Usually first letter of team |
| `news_recent_days` | RSS recency window in days. Module default is `2`; the Jays repo widens to `7` (per PR #64) to catch low-cadence feeds like Bluebird Banter. Tune per your feeds. | Per-fork choice |
| `statcast_enabled` | Boolean. When `true` (the default), the fetcher pulls Barrel%/Hard-Hit%/team OAA from Baseball Savant. Set `false` to skip the Savant calls entirely — useful on self-hosted runners with locked-down egress, or forks that don't want Statcast at all. xwOBA (via MLB Stats API) is unaffected by this flag and always populates. | Per-fork choice |
| `scan_notes_drift` | Boolean. When `true` (the default), the daily refresh runs `tools/scan_notes_drift.py --warn-only` after fetching `data.json`. Flags `notes.json` mentions of names not on the current roster + IL. WARN-only — findings appear in the workflow log but never fail the run. Set `false` to skip the scan entirely. Tuning: per-fork token whitelist at `.notes-scan-allow.json`; opt-out marker `<!-- noscan -->` inside a field. See [`free-text-fields.md`](free-text-fields.md). | Per-fork choice |
| `scan_notes_orphans` | Boolean. When `true` (the default), the daily refresh runs `tools/scan_notes_orphans.py --warn-only` after the drift scan. Flags `notes.players[id]` / `notes.injuries[id]` keys whose ID no longer matches the roster / IL / other-unavailable. Same warn-only posture. Tuning: per-fork ID allow-list at `.notes-scan-allow.json` under the `orphan_ids` key. See [`free-text-fields.md`](free-text-fields.md). | Per-fork choice |
| `check_notes_freshness` | Boolean. When `true` (the default), the daily refresh runs `tools/check_notes_freshness.py --warn-only` after the drift / orphan scans. Flags `notes.json` sections older than their cadence threshold (overview 7d, team/players/injuries 14d, pitches 60d). Same warn-only posture. Tuning: edit `CADENCE` in `tools/draft_notes_brief.py` for per-fork cadence preferences. See [`authoring-notes.md`](authoring-notes.md). | Per-fork choice |
| `news_summarize` | Boolean. When `true`, each news item gets a 1-2 sentence LLM TL;DR (issue #53). Default `false`. See "Optional: news TL;DRs" section below. | Per-fork choice |
| `summarize_provider` | One of `"anthropic"` / `"openai"` / `"ollama"`. Default `"anthropic"`. Only consumed when `news_summarize=true`. | If summarize is on |
| `summarize_model` | Provider-specific model identifier. Falls back to a sensible default per provider (`claude-haiku-4-5-20251001` / `gpt-4o-mini` / `llama3.2`). | Optional |
| `summarize_ollama_base_url` | Override the local Ollama endpoint when using the `ollama` provider. Default `http://localhost:11434`. | Only for Ollama |
| `rss_feeds` | Array of RSS sources — see below | Per-fork choice |

For `rss_feeds`, replace with the local-media feeds for your team. Each entry needs `url` and `source`; `keyword_filter` is optional and narrows general-MLB feeds to team-relevant items.

Save the file (in the web UI: scroll to "Commit changes" → "Commit directly to the `main` branch").

---

## Step 3 — Enable GitHub Pages

1. Go to your fork's **Settings → Pages**
2. Under "Source," select **Deploy from a branch**
3. Branch: `main`, folder: `/ (root)`
4. Click **Save**

GitHub will provision a Pages URL in 1–2 minutes: `https://<your-username>.github.io/<your-repo-name>/`. Visit it.

**Expected outcome:** the dashboard loads with your team's colors, title, and a placeholder data state (because the workflow hasn't run yet on your fork — see step 4).

---

## Step 4 — Run the daily refresh

GitHub Actions is enabled by default on public-repo forks; the daily-refresh workflow is wired up but won't run until the first scheduled cron OR you manually dispatch it.

**Trigger the first run manually:**

1. Go to your fork's **Actions** tab
2. Select the **Daily data refresh** workflow (left sidebar)
3. Click **Run workflow** → leave the branch as `main` → **Run workflow**
4. Wait ~30 seconds for the run to appear, then watch it complete (~1 minute)

**Expected outcome:** the workflow run succeeds, a new commit appears on `main` with title `Daily data refresh: YYYY-MM-DD`, and `data.json` populates with your team's facts.

Reload the dashboard. You should see your team's record, standings, roster, and recent games. The "Voices around" panel may be empty until you configure working RSS feeds.

After this first run, the cron (`0 9 * * *` — 09:00 UTC daily) takes over automatically.

---

## Step 5 (optional) — Enable news TL;DRs

Issue #53. When `news_summarize=true`, each news item gets a 1-2 sentence LLM-generated TL;DR rendered as an italic line under the headline (labeled "TL;DR (AI)" so readers see the provenance — the project's editorial stance is that AI voice should be visibly distinct from human-authored copy).

Pick a provider:

- **Anthropic** (default, recommended) — Claude Haiku 4.5. ~$0.001 per news item with prompt caching. Set `ANTHROPIC_API_KEY` as a GitHub Actions repository secret. The `anthropic` SDK is already in `requirements.txt`.
- **OpenAI** — `gpt-4o-mini`. Comparable cost. Install `openai` in your fork's `requirements.txt` and set `OPENAI_API_KEY` as a secret.
- **Ollama** (local, free) — Pick when you self-host a runner and want to keep summarization off paid APIs. No SDK needed (uses stdlib `urllib`). Set `summarize_provider: "ollama"` and `summarize_ollama_base_url` if it isn't the default `http://localhost:11434`. The local model name goes in `summarize_model`.

Then flip the toggle in your `config.json`:

```json
{
  "news_summarize": true,
  "summarize_provider": "anthropic",
  "summarize_model": "claude-haiku-4-5-20251001"
}
```

Cached TL;DRs land at `data/tldr_cache.json` (URL → summary). The cache is regenerable; safe to delete to force a re-summarize on the next refresh.

## Step 6 (optional) — Author analyst notes

`notes.json` carries the hand-written voice layer. It comes pre-populated with one example. Edit it to add your own notes — see the README's "Writing analyst notes" section for the schema, or [`docs/data-schema.md`](data-schema.md) for the field-level reference.

Notes render on the dashboard on the next load (no workflow needed; the renderer reads `notes.json` directly).

---

## Verification checklist

After step 4, confirm:

- [ ] Dashboard header shows your team name + brand mark + colors
- [ ] Season Overview tab shows your team's record + standings
- [ ] Players tab shows your active 26-man roster, grouped Rotation / Bullpen / Lineup / Bench
- [ ] Wild card panel shows all 15 teams in your team's league (5 division × 3)
- [ ] Header timestamp (`As of …`) is fresh, not amber or red
- [ ] At least one workflow run is green in Actions tab

If any of these fail, see [`docs/runbook.md`](runbook.md) for diagnostic flows.

---

## What you don't need to edit

Critical to the forkability promise: **the following files don't change**.

- `fetch_data.py` — reads `config.json`, no team-specific code
- `index.html` — reads `config.json` for theme + `data.json` for content
- `.github/workflows/daily-refresh.yml` — works for any fork unchanged
- `scripts/*.sh` — same
- Any file under `docs/` — reference material, not configuration

If you find yourself needing to edit one of these to make your fork work, that's a bug — file an issue against the upstream repo.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Pages URL 404 | Pages not enabled, or wrong branch selected | Re-check Settings → Pages |
| Dashboard loads but says "Schema drift: ..." | `data.json` missing keys (shouldn't happen on a fresh fork) | Dispatch the workflow once; if persists, file an issue |
| Workflow fails with `division has N teams, expected 5` | Wrong `division_id` in config | Cross-check against [`docs/team-ids.md`](team-ids.md) |
| Workflow fails with `wild_card has N entries, expected >= 10` | Wrong `league_id` | Same |
| Roster is empty | Wrong `team_id` or pre-Opening-Day | If pre-season, this is expected |
| Voices around panel empty | RSS feeds not configured, or all returning 0 items | See workflow log's `INFO: feed <name>` lines |
| Header amber/red | Daily refresh hasn't run recently | Dispatch manually, or wait for next cron |

Anything else: [`docs/runbook.md`](runbook.md) has a more complete diagnosis tree.

---

## What this guide does not cover

- **Custom domain.** Optional; standard GitHub Pages custom-domain configuration applies.
- **Renaming the repo after the fact.** Cosmetic; doesn't affect the dashboard.
- **Multi-team views, year-over-year comparisons, per-position OAA, pitcher xstats.** Roadmap items (`docs/roadmap.md`), not v1 scope. (Hitter xwOBA / Barrel% / Hard-Hit% and team OAA shipped via #29.)
- **Modifying the analyst-notes schema.** The six top-level keys are fixed (`games`, `players`, `overview`, `team`, `pitches`, `injuries`); extending requires changes to `index.html`.

If you fork and run into anything not covered here, file an issue against the upstream repo so this guide can be tightened.
