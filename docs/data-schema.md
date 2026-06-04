# data.json schema reference

The canonical contract between `fetch_data.py` (writer) and the renderer (reader).

> **v1 → v2 note:** the "Consumed by" references below cite the v1 `index.html`
> reader with line numbers. The live reader is now the v2 renderer
> (`assets/*.js` behind `index-v2.html`): top-level keys are validated against
> `EXPECTED_KEYS` in `assets/render.js`, and per-tab modules
> (`overview.js` / `players.js` / `team-stats.js` / `stat-school.js`) consume
> the fields. The **shapes and field tables here remain authoritative** — a
> full consumer-reference sweep to v2 is tracked separately. The contract
> lint (`tests/test_data_contract.py`) checks this doc's key coverage against
> the fetcher so the two can't silently drift.

Every key the dashboard renders comes from here. Every field the fetcher emits is documented here. When these get out of sync, the schema-drift banner fires; when the doc gets out of sync with reality, fix the doc.

This file is generated at the end of each daily refresh and committed to `main`. The renderer fetches it fresh on every dashboard load (with a `localStorage` cache for instant reopens).

---

## Orientation

### Role

`data.json` is the single source of truth between the data layer (Python, runs once a day) and the render layer (vanilla JS, runs on every dashboard load). Three properties of the file:

- **Immutable per refresh.** The fetcher writes it once via `write_atomic` (`fetch_data.py:1233`), which writes to `data.json.tmp` and `os.replace`s into place. Readers never see a partial write.
- **Self-validating.** Before write, `assert_invariants` (`fetch_data.py:1189`) checks size + type constraints on every required key and `die()`s on a violation. A run that fails invariants leaves the previous `data.json` in place — the dashboard goes stale, but it never goes wrong.
- **Schema-drift-checked.** The renderer compares `data.json`'s top-level keys to `EXPECTED_KEYS` (`index.html:261`). Missing keys raise a visible banner. New keys are silently ignored — but if the renderer needs them, you'll see it in the next consumer.

### Top-level keys (18)

| Key | Type | Section |
|---|---|---|
| `as_of` | `str` | [Meta](#as_of) |
| `notes_meta` | `object` | [Meta](#notes_meta) |
| `config` | `object` | [Meta](#config) |
| `team` | `object` | [Team](#team) |
| `team_stats` | `object` | [Team](#team_stats) |
| `division` | `array<object>` | [Standings](#division) |
| `wild_card` | `array<object>` | [Standings](#wild_card) |
| `recent_games` | `array<object>` | [Games](#recent_games) |
| `upcoming_games` | `array<object>` | [Games](#upcoming_games) |
| `opponent_pitchers` | `object` | [Games](#opponent_pitchers) |
| `run_diff_last_10` | `array<object>` | [Games](#run_diff_last_10) |
| `roster` | `object` | [Roster](#roster) |
| `player_ranks` | `object` | [Roster](#player_ranks) |
| `player_rank_pool` | `object` | [Roster](#player_rank_pool) |
| `injuries` | `array<object>` | [People status](#injuries) |
| `other_unavailable` | `array<object>` | [People status](#other_unavailable) |
| `transactions` | `array<object>` | [People status](#transactions) |
| `news` | `array<object>` | [External content](#news) |

---

## Meta

### `as_of`

ISO 8601 timestamp of when this `data.json` was generated, in UTC.

**Shape:** `str` (RFC 3339 / ISO 8601 with offset).

**Real example:**

```json
"2026-05-28T14:46:20.104218+00:00"
```

**Source:** Set at the top of `main()` in `fetch_data.py` (around line 1265), `datetime.now(timezone.utc).isoformat()`. Not a fetch — generated.

**Consumed by:** `applyStaleness(DATA.as_of)` in `index.html:504`. The header turns amber if `as_of` is more than 24 hours old, red if more than 48 hours. The freshness indicator is the dashboard's "is this stale?" signal.

---

### `notes_meta`

Metadata about the hand-authored `notes.json` file. Distinct from `as_of`, which is about the machine-fetched data.

**Shape:** `object` with one key.

```json
{
  "last_updated_iso": "2026-05-30T03:07:57+00:00"
}
```

| Field | Type | Meaning |
|---|---|---|
| `last_updated_iso` | `str \| null` | ISO 8601 timestamp of the last git commit touching `notes.json`. `null` when git is unavailable or `notes.json` isn't tracked. |

**Source:** `notes_last_updated_iso()` in `fetch_data.py` shells out to `git log -1 --format=%aI -- notes.json` and returns the trimmed stdout. File mtime would be unreliable in CI (checkout resets it), so we go through git history.

**Consumed by:** `applyNotesStaleness(DATA.notes_meta)` in `index.html`. Renders an "Analyst voice: Nd old" badge in the header, with the same green/amber/red staleness posture as `as_of` — but on a longer cadence (green <7d, amber 7-14d, red >14d). Tells the reader when the hand-authored narrative was last refreshed, separately from when the machine data was last refreshed.

**Why this exists.** The analyst-voice layer in `notes.json` is hand-authored and doesn't refresh on a cron. Without a visible signal, readers can't tell that the overview narrative talking about "this recent stretch" was actually written N days ago. The badge makes the staleness honest and lets the maintainer self-calibrate.

---

### `config`

A subset of `config.json` echoed into `data.json` so the renderer can read team identity without a second HTTP request.

**Shape:** `object`.

**Real example:**

```json
{
  "team_id": 141,
  "team_name": "Toronto Blue Jays",
  "season": 2026
}
```

**Source:** Constructed in `main()` (`fetch_data.py`, near the output dict assembly) from the loaded `cfg`. Only the three keys above are echoed — the renderer doesn't need `primary_color`, `rss_feeds`, etc. (those load from `config.json` directly).

**Consumed by:** Indirectly via the `is_us` flags on standings rows (set in `transform_division` and `fetch_wild_card`). The dashboard title uses `CONFIG.dashboard_title` (loaded from `config.json` directly, not `data.config`).

**Fields:**

| Field | Type | Meaning |
|---|---|---|
| `team_id` | `int` | MLB team ID (forker's team). Used by the fetcher; included for renderer convenience. |
| `team_name` | `str` | Full team name, e.g. `"Toronto Blue Jays"`. |
| `season` | `int` | Season year, e.g. `2026`. |

> **History:** `config` as a top-level `data.json` key was added in PR #58 (and added to `EXPECTED_KEYS` to fire the schema banner if it ever goes missing).

---

## Team

### `team`

Team-level season summary: record, place in division, run differential, pythagorean expected record.

**Shape:** `object`.

**Real example:**

```json
{
  "record": { "w": 27, "l": 29 },
  "place": "3rd in AL East",
  "gb": 8.5,
  "last10": "6-4",
  "streak": "W2",
  "runs_scored": 226,
  "runs_allowed": 230,
  "run_diff": -4,
  "pythag_w": 28,
  "pythag_l": 28
}
```

**Source:** Built in `main()` from `find_us_team_record(div_record, cfg)`. Pythagorean expected wins/losses computed by `pythag(rs, ra, games_played)` (`fetch_data.py`, around line 1058). `gb` is denormalized off the `division[]` entry where `is_us == True` (F2 / COG-366 — Overview Record KPI footer needs it without traversing into `division`). Upstream endpoint: `/standings` (`leagueId`, `season`).

**Consumed by:** `renderOverview` (`index.html:647`) — KPI cards row across the top of the Overview tab. Also `renderTeam` (`index.html:1087`).

**Fields:**

| Field | Type | Meaning |
|---|---|---|
| `record.w` | `int` | Wins. |
| `record.l` | `int` | Losses. |
| `place` | `str` | Rank phrase, e.g. `"3rd in AL East"`. |
| `gb` | `float \| str \| None` | Games back from the division leader. `0` or `"-"` for the leader; `None` if upstream omitted it. Denormalized from `division[is_us].gb`. |
| `last10` | `str` | Last 10 games as `"W-L"`, e.g. `"6-4"`. |
| `streak` | `str` | Current win/loss streak, e.g. `"W2"` or `"L3"`. |
| `runs_scored` | `int` | Season runs scored. |
| `runs_allowed` | `int` | Season runs allowed. |
| `run_diff` | `int` | `runs_scored - runs_allowed`. |
| `pythag_w` | `int` | Pythagorean expected wins given current RS/RA. |
| `pythag_l` | `int` | Pythagorean expected losses. |

> **Invariant:** `assert_invariants` requires `runs_scored`, `runs_allowed`, `record.w`, and `record.l` to be non-None (`fetch_data.py:1201-1207`).

---

### `team_stats`

Hitting and pitching aggregate stats with MLB rank (1-30) per metric.

**Shape:** `object` with `hitting` and `pitching` sub-objects, each mapping stat key → `{ val, rank }`.

**Real example:**

```json
{
  "hitting": {
    "ops":  { "val": ".684", "rank": 24 },
    "obp":  { "val": ".309", "rank": 24 },
    "slg":  { "val": ".375", "rank": 22 },
    "hr":   { "val": 52,     "rank": 20 },
    "runs": { "val": 226,    "rank": 22 },
    "avg":  { "val": ".243", "rank": 13 }
  },
  "pitching": {
    "k9":   { "val": "9.30", "rank": 5  },
    "bb9":  { "val": "3.13", "rank": 8  },
    "whip": { "val": "1.26", "rank": 13 },
    "era":  { "val": "3.78", "rank": 10 }
  }
}
```

**Source:** `fetch_team_stats(cfg)` (`fetch_data.py:907`) pulls the team's aggregate; `fetch_league_team_rankings(cfg)` (`fetch_data.py:978`) pulls all 30 teams sorted by each metric so we can derive rank. Merged by a helper. Upstream endpoint: `/teams/{teamId}/stats` and per-stat sorted variants.

**Consumed by:** `renderTeam` (`index.html:1087`) — the Team Stats tab's metric grid. `renderTeam` falls back to a placeholder when `team_stats` is missing.

**Fields per stat entry:**

| Field | Type | Meaning |
|---|---|---|
| `val` | `str` or `int` | Display value. Rate stats are pre-formatted strings (`".684"`, `"3.78"`); counting stats are integers. Can be `None` pre-Opening Day. |
| `rank` | `int` | League rank, 1 (best) to 30 (worst). Always required when `val` is populated. |

> **Invariant:** When `val` is populated, `rank` must be an `int` in `[1, 30]` (`fetch_data.py:1218-1228`). A bare value with no rank is the bug the invariant guards against.
>
> **History:** Added in PR #51 for issue #24.

### `team_stats.defense` (optional)

Defensive metrics from Baseball Savant. Currently a single OAA entry; per-position OAA is a v1.x+ enhancement.

```json
{
  "team_stats": {
    "defense": {
      "oaa": { "val": 12, "rank": null }
    }
  }
}
```

**Source:** `fetch_savant_oaa(team_abbrev, season)` (`fetch_data.py`). Pulls the `outs_above_average` Savant leaderboard CSV; filters by team. Returns `None` on any fetch failure → the defense group is absent from the output.

**Consumed by:** `renderTeam` (`index.html`) — a separate "Defense" card below the Hitting/Pitching grid, rendered only when the group is present in `team_stats`.

**Fields per stat entry:** same `{val, rank}` shape as hitting/pitching. `rank` is `None` because Savant's leaderboard doesn't provide a team rank in the CSV; computing it from a league-wide pull is a follow-up.

> **History:** Added in PR #29 Phase B for issue #29.

---

## Standings

### `division`

The team's division (5 teams) with full standings rows.

**Shape:** `array<object>`, length **always 5** (post-2013 MLB realignment).

**Real example (first entry):**

```json
{
  "team": "Tampa Bay Rays",
  "team_id": 139,
  "w": 34,
  "l": 19,
  "pct": ".642",
  "gb": "-",
  "streak": "L4",
  "last10": "5-5",
  "is_us": false
}
```

**Source:** `transform_division(div_record, cfg, team_names)` (`fetch_data.py:265`). Upstream endpoint: `/standings` with `leagueId`.

**Consumed by:** `renderStandingsTable(DATA.division || [], true)` called from `renderOverview` (`index.html:683`).

**Fields:**

| Field | Type | Meaning |
|---|---|---|
| `team` | `str` | Full team name. |
| `team_id` | `int` | MLB team ID. |
| `w` | `int` | Wins. |
| `l` | `int` | Losses. |
| `pct` | `str` | Winning percentage as `".XXX"`. |
| `gb` | `str` | Games back from division leader. `"-"` for the leader, `"N.0"` / `"N.5"` for others. |
| `streak` | `str` | Current streak, `"W2"` / `"L3"`. |
| `last10` | `str` | Last 10 games as `"W-L"`. |
| `is_us` | `bool` | `true` for the row matching `cfg.team_id`. Used for visual highlight. |

> **Invariant:** `len(division) == 5` (`fetch_data.py:1191`). Catches the post-realignment-typo bug from issue #31.

---

### `wild_card`

All 15 teams in the team's league, sorted into Division leaders, current WC seeds, and "Out" — used to render the wild-card race.

**Shape:** `array<object>`, length **15** (5 teams × 3 divisions in one league).

**Real example (one of each variety):**

```json
[
  {
    "team": "Tampa Bay Rays",
    "team_id": 139,
    "w": 34,
    "l": 19,
    "gb": "-",
    "note": "Division leader",
    "is_us": false
  },
  {
    "team": "New York Yankees",
    "team_id": 147,
    "w": 34,
    "l": 22,
    "gb": "+7.0",
    "note": "In (1st WC seed)",
    "is_us": false
  },
  {
    "team": "Minnesota Twins",
    "team_id": 142,
    "w": 27,
    "l": 29,
    "gb": "0.0",
    "note": "Out",
    "is_us": false
  }
]
```

**Source:** `fetch_wild_card(cfg, team_names)` (`fetch_data.py:291`). Note: not derived from MLB's `standingsTypes=wildCard` view (which returned only 5 teams); instead derived locally from the full league standings. Upstream endpoint: `/standings` with `leagueId`. See PR #48 for the rewrite history.

**Consumed by:** `renderWildCardTable(DATA.wild_card || [])` called from `renderOverview` (`index.html:684`).

**Fields:**

| Field | Type | Meaning |
|---|---|---|
| `team` | `str` | Full team name. |
| `team_id` | `int` | MLB team ID. |
| `w` | `int` | Wins. |
| `l` | `int` | Losses. |
| `gb` | `str` | Games-back display: `"-"` for division leaders and the WC3 seed itself; `"+N.0"` for leading WC seeds (above the cutoff); `"N.0"` for teams "Out" (below the cutoff); `"0.0"` for teams tied with the cutoff. |
| `note` | `str` | One of: `"Division leader"`, `"In (1st WC seed)"`, `"In (2nd WC seed)"`, `"In (3rd WC seed)"`, or `"Out"`. |
| `is_us` | `bool` | `true` for the row matching `cfg.team_id`. |

> **Invariant:** `len(wild_card) >= 10` (`fetch_data.py:1194`). Catches the 5-team-only bug we shipped through before #48.
>
> **History:** The `gb == "0.0"` case for tied-with-cutoff "Out" teams was added in PR #63 (issue #61.B); previously rendered `"-"` ambiguously.

---

## Games

### `recent_games`

Most recent completed games (capped at `RECENT_GAME_COUNT = 10`).

**Shape:** `array<object>`, length up to 10. Ordered oldest → newest.

**Real example:**

```json
{
  "game_pk": 823549,
  "date": "2026-05-18",
  "home": false,
  "opp": "New York Yankees",
  "result": "L",
  "score": "6-7",
  "status": "Final",
  "winning_pitcher": "Paul Blackburn",
  "losing_pitcher": "Yariel Rodríguez",
  "summary_facts": "Final 6-7 (L). WP Paul Blackburn. LP Yariel Rodríguez. SV David Bednar",
  "us_score": 6,
  "them_score": 7
}
```

**Source:** `transform_recent_game(game, cfg)` (`fetch_data.py:410`) for each game in the past-window schedule; filtered to `Final` status only. Upstream endpoint: `/schedule` with `hydrate=linescore,probablePitcher,team,decisions`. The `decisions` hydrate inlines the winning/losing/save pitcher and saves us a per-game `/boxscore` call.

**Consumed by:** `renderSinceYesterday` (`index.html:802`), `renderGames` (`index.html:1149`), and `run_diff_last_10` derivation.

**Fields:**

| Field | Type | Meaning |
|---|---|---|
| `game_pk` | `int` | MLB game identifier. Also the key used by `notes.json.games`. |
| `date` | `str` | Game date as `"YYYY-MM-DD"`. |
| `home` | `bool` | `true` if our team was home. |
| `opp` | `str` | Opponent's full team name. |
| `result` | `str` | `"W"`, `"L"`, or `""` (only `Final` games make it into this array, but the field is left blank for postponed-or-similar edge cases that slip through). |
| `score` | `str` | Final score formatted as `"us-them"`, e.g. `"6-7"`. |
| `status` | `str` | MLB `detailedState`, typically `"Final"`. |
| `winning_pitcher` | `str` | WP `fullName`, empty string if missing. |
| `losing_pitcher` | `str` | LP `fullName`, empty string if missing. |
| `summary_facts` | `str` | Pre-formatted one-liner combining score + WP/LP/SV. |
| `us_score` | `int` | Our team's runs scored. |
| `them_score` | `int` | Opponent's runs scored. |

> **Invariant:** In-season runs, `recent_games` must contain at least one game with a `result` (`fetch_data.py:1199`).

---

### `upcoming_games`

Scheduled games from today through `SCHEDULE_FUTURE_DAYS = 7` days out, excluding games that are already `Final`.

**Shape:** `array<object>`, variable length. Ordered earliest → latest.

**Real example:**

```json
{
  "game_pk": 824834,
  "date": "2026-05-28",
  "home": false,
  "opp": "Atlanta Braves",
  "opp_team_id": 144,
  "opp_team_abbrev": "ATL",
  "probable_pitcher_us": "Patrick Corbin",
  "probable_pitcher_us_id": 571578,
  "probable_pitcher_them": "Chris Sale",
  "probable_pitcher_them_id": 519242,
  "status": "Scheduled",
  "opp_context": {
    "team_id": 144, "team": "Atlanta Braves", "w": 42, "l": 20,
    "pct": ".677", "gb": "-", "streak": "W2", "last10": "6-4",
    "division_rank": "1", "division_name": "NL East"
  }
}
```

**Source:** `transform_upcoming_game(game, cfg)` for each game in the future-window schedule, filtered to non-Final games. Upstream endpoint: `/schedule` with `hydrate=linescore,probablePitcher,team,decisions`. `opp_context` is denormalized in `main()` from `fetch_all_standings` (G3) — keyed by `opp_team_id`, so interleague / non-AL-East opponents resolve (the `division[]` array is our division only).

**Consumed by (v2):** `renderUpcomingGame` in `assets/overview.js` — opponent context one-liner + the clickable opposing-SP chip (`#oppp-<id>` modal via `probable_pitcher_them_id`).

**Fields:**

| Field | Type | Meaning |
|---|---|---|
| `game_pk` | `int` | MLB game identifier. |
| `date` | `str` | Game date as `"YYYY-MM-DD"`. |
| `home` | `bool` | `true` if our team is home. |
| `opp` | `str` | Opponent's full team name. |
| `opp_team_id` | `int \| None` | Opponent's MLB team id (G3). Join key to `opp_context` / standings. |
| `opp_team_abbrev` | `str` | Opponent's 3-letter abbreviation from the `team` hydrate (G3). Empty → renderer falls back to its name→abbrev map. |
| `probable_pitcher_us` | `str` | Our probable starter's `fullName`. Often empty for non-imminent games. |
| `probable_pitcher_us_id` | `int \| None` | Our probable's person id (G3) — links to the roster modal. |
| `probable_pitcher_them` | `str` | Opponent's probable starter's `fullName`. Often empty. |
| `probable_pitcher_them_id` | `int \| None` | Opponent probable's person id (G3) — opens the `#oppp-<id>` modal; key into `opponent_pitchers`. |
| `status` | `str` | MLB `detailedState`, typically `"Scheduled"`. |
| `opp_context` | `object \| None` | Denormalized opponent standing (G3): `w, l, pct, gb, streak, last10, division_rank, division_name, team, team_id`. `None` if the standings join missed. |

> **History:** Pre-PR #62, `upcoming_games` started at offset `+1` day, dropping today's not-yet-played game. Now starts at offset `0` and filters out `Final` games. G3 added the id-carry (`opp_team_id`, probable ids) + `opp_context`.

---

### `opponent_pitchers`

Bio + season line for each distinct opposing probable pitcher in the upcoming
window, keyed by person-id string. Source for the opposing-pitcher modal
(`#oppp-<id>`) — a non-roster pitcher, so it lives outside `roster`.

**Shape:** `object{id_str: {id, name, throws, age, era, whip, ip, k, gs}}`.

**Real example:**

```json
{
  "519242": {
    "id": 519242, "name": "Chris Sale", "throws": "L", "age": 37,
    "era": "2.01", "whip": "0.94", "ip": "67.0", "k": 80, "gs": 11
  }
}
```

**Source:** `fetch_opposing_pitcher_lines(cfg, upcoming_games)` (G3) — deduped across the window; one `fetch_player_bio` + one `fetch_player_season_stats` per distinct `probable_pitcher_them_id`. Per-pitcher failure is non-fatal: the entry still carries `id` + `name` (stats fall back to placeholders) so the modal renders a name + links. The whole fetch is non-fatal → `{}` on failure.

**Consumed by (v2):** `assets/opponent-pitcher.js` `find()` + `buildModalContent()`, mounted by `modal.js` on the `#oppp-<id>` route.

**Fields per entry:**

| Field | Type | Meaning |
|---|---|---|
| `id` | `int` | MLB `personId`. |
| `name` | `str` | Full name. |
| `throws` | `"R" \| "L" \| None` | Throwing handedness (bio). |
| `age` | `int \| None` | Age in years (bio). |
| `era` | `str` | Season ERA, `"N.NN"` or `"-.--"`. |
| `whip` | `str` | Season WHIP. |
| `ip` | `str` | Innings pitched, `"NN.X"`. |
| `k` | `int` | Strikeouts. |
| `gs` | `int` | Games started. |

> **Invariant:** if present, must be a dict; each entry needs a non-None `id` and a non-empty `name` (`assert_invariants`).
>
> **History:** Added in G3 (opposing-pitcher modal).

---

### `run_diff_last_10`

Per-game run differential for the last 10 completed games. Powers the run-diff chart on the Overview tab.

**Shape:** `array<object>`, length up to 10. Ordered oldest → newest.

**Real example:**

```json
{ "date": "2026-05-18", "diff": -1, "result": "L" }
```

**Source:** `run_diff_last_10(recent_games)` (`fetch_data.py`, around line 1066). Pure transform — no API call. Walks `recent_games[].us_score - them_score` for finals.

**Consumed by:** `drawDiffChart(...)` called from `renderOverview` via `setTimeout` (`index.html`, around line 832).

**Fields:**

| Field | Type | Meaning |
|---|---|---|
| `date` | `str` | Game date as `"YYYY-MM-DD"`. |
| `diff` | `int` | `us_score - them_score`. Positive on a win, negative on a loss. |
| `result` | `str` | `"W"` or `"L"`. Used to color the chart bars. |

---

## Roster

### `roster`

The active 26-man roster split into hitters and pitchers, each row carrying season counting/rate stats plus the hot/cold/new tag from a 7-game window.

**Shape:** `object` with `hitters` (`array<object>`) and `pitchers` (`array<object>`).

**Real example (one hitter, one pitcher):**

```json
{
  "hitters": [
    {
      "id": 665926,
      "name": "Andrés Giménez",
      "pos": "SS",
      "bats": "L",
      "age": 27,
      "height": "5' 11\"",
      "weight": 161,
      "ab": 180,
      "avg": ".222",
      "obp": ".260",
      "slg": ".356",
      "ops": ".616",
      "hr": 5,
      "rbi": 27,
      "sb": 6,
      "recent": "cold"
    }
  ],
  "pitchers": [
    {
      "id": 671936,
      "name": "Adam Macko",
      "role": "P",
      "throws": "L",
      "age": 25,
      "height": "6' 0\"",
      "weight": 195,
      "ip": "4.1",
      "era": "0.00",
      "whip": "0.92",
      "k": 4,
      "bb": 0,
      "w": 1,
      "l": 0,
      "sv": 0,
      "gs": 0,
      "recent": "new"
    }
  ]
}
```

**Source:** `transform_roster(roster_entries, cfg)` (`fetch_data.py:796`). For each player on the active roster, calls `fetch_player_season_stats(person_id, group, season)` (`fetch_data.py:535`) for season counters, `derive_recent_form(person_id, group, season, season_rate_str, stat_signature=...)` for the `recent` tag, and `fetch_player_bio(person_id)` (F2 / COG-366) for bats/throws/age/height/weight. Upstream endpoints: `/teams/{teamId}/roster?rosterType=active` for the list, then `/people/{personId}?hydrate=stats(group=X,type=season,...)` and `...type=gameLog,...` per player, plus the unhydrated `/people/{personId}` for bio fields.

**Consumed by:** `renderPlayers` (`index.html:863`) — groups players into Starting Rotation (`gs >= 3`), Bullpen (others), Lineup Regulars (top hitters by AB), Bench / Depth (rest). Also `renderOverview` peeks at counts.

**Hitter fields:**

| Field | Type | Meaning |
|---|---|---|
| `id` | `int` | MLB `personId`. Also the key used by `notes.json.players`. |
| `name` | `str` | Full name (`fullName`). |
| `pos` | `str` | Position abbreviation, e.g. `"SS"`, `"C"`, `"OF"`. |
| `bats` | `"R" \| "L" \| "S" \| None` | Batting handedness (F2). `None` if MLB didn't surface `batSide.code`. Renders the "Bats R" segment of the modal meta line. |
| `age` | `int \| None` | Player age in years (F2, `currentAge`). `None` skips the segment. |
| `height` | `str \| None` | Display height, e.g. `"6' 2\""` (F2). |
| `weight` | `int \| None` | Display weight in pounds (F2). |
| `ab` | `int` | At-bats (season). |
| `avg` | `str` | Batting average, pre-formatted `".XXX"`. |
| `obp` | `str` | On-base percentage. |
| `slg` | `str` | Slugging. |
| `ops` | `str` | On-base + slugging. |
| `xwoba` | `str` | Expected wOBA from MLB Stats API's `expectedStatistics` hydrate (PR #29 Phase A). Pre-formatted `".XXX"`; `".---"` when missing (pre-Opening-Day, sub-threshold ABs, or API miss). |
| `barrel_pct` | `str` | Barrels per plate appearance, from Baseball Savant's `exit_velocity_barrels` leaderboard (PR #29 Phase B). Pre-formatted `"X.X%"`; `"---"` when sub-threshold or Savant unreachable. |
| `hardhit_pct` | `str` | Hard-hit rate (95+ mph exit velocity), from the same Savant leaderboard. Same format + fallback as `barrel_pct`. |
| `hr` | `int` | Home runs. |
| `rbi` | `int` | Runs batted in. |
| `sb` | `int` | Stolen bases. |
| `recent` | `"hot"`, `"cold"`, `"new"`, or `null` | Form tag derived from last 7 games' OPS vs season OPS. `"new"` for fewer than 14 days in MLB this season. `null` when the player is between hot/cold thresholds, has fewer than 7 games, or no season ABs. |

**Pitcher fields:**

| Field | Type | Meaning |
|---|---|---|
| `id` | `int` | MLB `personId`. |
| `name` | `str` | Full name. |
| `role` | `str` | Position abbreviation, typically `"P"` (the dashboard splits SP/RP downstream based on `gs`). |
| `throws` | `"R" \| "L" \| None` | Throwing handedness (F2). `None` if MLB didn't surface `pitchHand.code`. Renders the "Throws L" segment of the modal meta line. |
| `age` | `int \| None` | Player age in years (F2). `None` skips the segment. |
| `height` | `str \| None` | Display height (F2). |
| `weight` | `int \| None` | Display weight in pounds (F2). |
| `ip` | `str` | Innings pitched, pre-formatted `"NN.X"` (X is 0, 1, or 2 — third-of-an-inning notation). |
| `era` | `str` | ERA, pre-formatted `"N.NN"` or `"-.--"`. |
| `whip` | `str` | Walks + hits per inning pitched. |
| `k` | `int` | Strikeouts. |
| `bb` | `int` | Walks. |
| `w` | `int` | Wins. |
| `l` | `int` | Losses. |
| `sv` | `int` | Saves. |
| `gs` | `int` | Games started. Used by the renderer to split rotation vs bullpen (`gs >= 3` → Rotation). |
| `recent` | `"hot"`, `"cold"`, `"new"`, or `null` | Same as hitters but compared against season ERA. Lower recent ERA is "hot." |

> **History:** `gs` on pitchers was added in PR #58 — before that, all pitchers fell into Bullpen because `gs` was missing. The hot/cold/new pill (`recent` field) shipped in PR #51 (issue #25); the routing bug that left it null for everyone was fixed in PR #63 (issue #59). The gameLog cache speeds up subsequent refreshes (PR #67, issue #52).

### `player_ranks`

Per-player MLB rank within the qualified pool, keyed by player id as a string.

Shape:

```jsonc
{
  "665489": {                  // string-keyed (matches roster[].id stringified)
    "ops": 27,                 // int 1..N (N = qualified-hitter pool size) — or null
    "hr": 89,
    "rbi": 41,
    "sb": 120
  },
  "672386": { "ops": null, "hr": null, "rbi": null, "sb": null },  // non-qualified → all null
  "592332": {                  // pitcher
    "era": 18,
    "whip": 25,
    "k_per_9": 6,
    "bb_per_9": 22,
    "ip": 9
  }
}
```

| Field shape | Meaning |
|---|---|
| `<id_str>` (key) | `roster.hitters[].id` or `roster.pitchers[].id`, stringified |
| inner key | stat slug — `PLAYER_HITTING_STATS` (`ops, hr, rbi, sb`) or `PLAYER_PITCHING_STATS` (`era, whip, k_per_9, bb_per_9, ip`) |
| value | 1-based rank within the MLB-qualified pool for that stat, or `null` |

**Slug set is the player cut, not the team cut.** Deliberately separate from `team_stats` slugs: the player axis surfaces RBI/SB and uses `k_per_9`/`bb_per_9` (not the team `k9`/`bb9`) so renaming the team slugs can't break Stat School notes (`notes.json` `pitching.k9`) or the v1 table. Defined by `PLAYER_HITTING_STATS` / `PLAYER_PITCHING_STATS` in `fetch_data.py`; `PLAYER_PITCHING_HIGHER_IS_BETTER = {k_per_9, ip}`.

**Definition:** rank = 1-based position within the MLB-qualified pool for that stat (3.1 PA/team-game for hitters; 1.0 IP/team-game for pitchers), already direction-corrected (rank 1 = best, including ERA/WHIP where low is good). Non-qualified players return `null` for every slug.

**Rendering = percentile, not raw rank.** The pool is large (N≈150), so the renderer converts `(rank, pool)` → percentile (`rankPercentile` in `format.js`) for the heat-bar marker position, tier color, and "<n>th %ile" label. Pool sizes come from [`player_rank_pool`](#player_rank_pool). Rendering raw pool ranks through the 1-30 team helpers (`ordinal`/`rankTier`) was the G1.1 bug: every rank >30 showed `"—"` with a pinned colorless marker.

**Failure mode:** if the MLB API call fails, `fetch_league_player_rankings` returns `({}, {"hitting":0,"pitching":0})` — the renderer falls back to `"—"`. Soft fail, no daily-refresh abort.

> **History:** Added in F1 (COG-363, audit H1). G1 realigned the slug set (added RBI/SB/IP, renamed K9/BB9 → `k_per_9`/`bb_per_9`). G1.1 added percentile rendering + `player_rank_pool` after real data exposed the pool-rank-vs-1-30 scale bug.

---

### `player_rank_pool`

Qualified-pool sizes per group — the denominator the renderer needs to turn a
pool-relative [`player_ranks`](#player_ranks) value (1..N) into a percentile.

**Shape:** `object{ "hitting": int, "pitching": int }`.

**Real example:**

```json
{ "hitting": 158, "pitching": 92 }
```

**Source:** returned alongside `ranks` by `fetch_league_player_rankings` (the second tuple element) — `len()` of each group's qualified-splits list. `0` for a group whose fetch failed.

**Consumed by (v2):** `assets/players.js` — `F.rankPercentile(rank, pool)` / `F.percentileLeftPercent` / `F.percentileTier` for the pcard badge and modal rank rows. `pool[isHitter ? 'hitting' : 'pitching']`.

> **Invariant:** if present, a dict of non-negative ints (`assert_invariants`).
>
> **History:** Added in G1.1 to fix the percentile rendering bug.

---

## People status

### `injuries`

Players on an injured list, with optional ETA narrative.

**Shape:** `array<object>`, variable length.

**Real example:**

```json
{
  "person_id": 680718,
  "name": "Addison Barger",
  "status": "Injured 10-Day",
  "eta_note": ""
}
```

**Source:** `fetch_injury_report(cfg)` (`fetch_data.py:487`). Upstream endpoint: `/teams/{teamId}/roster` with various `rosterType` values to surface non-active players. Status string starts with `"Injured"` for entries in this list (the split between `injuries` and `other_unavailable` is by `status` prefix).

**Consumed by:** `renderInjuryCard` inside `renderPlayers` (`index.html:882`). Renders the injury list panel in the header.

**Fields:**

| Field | Type | Meaning |
|---|---|---|
| `person_id` | `int` | MLB `personId`. Required for the `notes.json.injuries` merge. |
| `name` | `str` | Full name. |
| `status` | `str` | MLB-supplied status string. For this list, always starts with `"Injured"` (e.g., `"Injured 10-Day"`, `"Injured 60-Day"`). |
| `eta_note` | `str` | API-derived ETA hint. Often empty. Authors can override via `notes.json.injuries[person_id].eta`. |

> **History:** `person_id` was added in #56 to enable the `notes.json.injuries` merge by ID instead of by fragile name match.

---

### `other_unavailable`

Players on the roster but not currently active (sent down, paternity, bereavement, etc.). Visually separate from injuries.

**Shape:** `array<object>`, variable length.

**Real example:**

```json
{
  "person_id": 663893,
  "name": "Brendon Little",
  "status": "Reassigned to Minors",
  "eta_note": ""
}
```

**Source:** Same fetch path as `injuries` (`fetch_injury_report` in `fetch_data.py:487`); the split happens by status prefix — anything not starting with `"Injured"` lands here. Statuses include `"Reassigned to Minors"`, `"Not Yet Reported"`, etc.

**Consumed by:** `renderPlayers` (`index.html:907`). Rendered alongside the injury list but in a separate visual track.

**Fields:** identical to `injuries`.

> **History:** The split into a separate list was added in #41 (issue #28) to filter "Reassigned to Minors" out of what the dashboard called "injuries" — that's a roster move, not an injury.
>
> **Invariant:** Both `injuries` and `other_unavailable` must be lists (`fetch_data.py:1208-1210`).

---

### `transactions`

Recent roster moves: signings, trades, options, DFAs.

**Shape:** `array<object>`, variable length (capped by `TRANSACTION_DAYS_BACK = 7`).

**Real example:**

```json
{
  "date": "2026-05-22",
  "type": "Signed",
  "description": "Toronto Blue Jays signed RHP Sam Gardner.",
  "person_name": "Sam Gardner"
}
```

**Source:** `fetch_transactions(cfg, days_back=TRANSACTION_DAYS_BACK)` (`fetch_data.py:1014`). Upstream endpoint: `/transactions` with `teamId`, `startDate`, `endDate`.

**Consumed by:** `renderSinceYesterday` (`index.html:816`) — shows the three most recent transactions on the Overview tab.

**Fields:**

| Field | Type | Meaning |
|---|---|---|
| `date` | `str` | Transaction date as `"YYYY-MM-DD"`. |
| `type` | `str` | MLB's `typeDesc`, e.g. `"Signed"`, `"Selected"`, `"Outright"`, `"Trade"`. |
| `description` | `str` | Human-readable description of the move. |
| `person_name` | `str` | The primary affected player's name. Empty for multi-player trades or non-player moves. |

---

## External content

### `news`

Recent items from the configured RSS feeds. Pure passthrough — headline + bylined source + link, no LLM summarization.

**Shape:** `array<object>`, capped at `NEWS_TOTAL_LIMIT = 20`. Ordered newest → oldest.

**Real example:**

```json
{
  "title": "Familiar face Chris Bassitt set to take mound against Blue Jays - Sportsnet",
  "summary": "Familiar face Chris Bassitt set to take mound against Blue Jays&nbsp;&nbsp;Sportsnet",
  "source": "Google News",
  "author": "",
  "url": "https://news.google.com/rss/articles/CBMiqAFBVV95cUxOVkdTOUJEdDZzTE5nYXNBbUJsUGZtV3JOd2pwblM5eUFlOC1iTm5MbVdrTXEtVVlNdk9GZTNMZE5vR3Bmel9Oc1Jub3FrbnpSMFV5X1F6MFdNd1ZOS3NneU4wbm1tU01PZlgyWFZ4TDQyd2lXYUNON1FLTlNnOEk2THVSTVVNSkpBRHVGTVpxc0d4ZEtHemdDOXkxcnNGVDV0bFVUaUtJMk0?oc=5",
  "published": "2026-05-28T13:03:00+00:00"
}
```

**Source:** `fetch_news(cfg)` (`fetch_data.py:1114`). Pulls each feed in `config.json.rss_feeds`, parses via `feedparser`, filters by `config.news_recent_days` (module default `2`; the Jays repo's `config.json` sets `7` to catch low-cadence feeds — see PR #64) and optional per-feed `keyword_filter`, sorts and caps.

**Consumed by:** `renderNewsPanel` (`index.html:696`) — the "Voices around" panel on the Overview tab.

**Fields:**

| Field | Type | Meaning |
|---|---|---|
| `title` | `str` | Headline as supplied by the feed. |
| `summary` | `str` | Optional one-line summary. Often a duplicate of the title for some feeds. May contain HTML entities. |
| `source` | `str` | Feed display label (from `config.json.rss_feeds[].source`). |
| `author` | `str` | Byline if the feed provides one; often empty for aggregators like Google News. |
| `url` | `str` | Link to the original article. |
| `published` | `str` | ISO 8601 timestamp of publication. |
| `tldr` | `str` (optional) | LLM-generated 1-2 sentence summary. Only present when `config.news_summarize=true` and the summarizer succeeded for this URL. Added by `summarize_news_items` (PR #53). The renderer marks it with an "AI-generated" label so readers see the provenance. |

> **History:** `published` was RFC 822 before PR #63 (issue #61.A) — JS `Date` parses both, but the schema lied about its format. Now consistently ISO 8601.
>
> **Per-feed diagnostic logging** in `fetch_news` (added in PR #64, issue #60) emits an `INFO` line per feed: entries received, kept, dropped by recency, dropped by keyword. Useful when a feed silently contributes zero items.
>
> **TL;DR cache** at `data/tldr_cache.json` keys per-URL → summary; URLs are stable post-publication so we never re-pay for the same article. The cache lives only when summarization is enabled.

---

## notes.json

Hand-authored content layered on top of `data.json` facts. Lives in `notes.json` at the repo root — never machine-written. Six top-level keys, each keyed by a stable identifier (`gamePk`, `person_id`, pitch type name) or a fixed key (`headline`). Every entry is optional; missing keys degrade silently to facts-only rendering.

For per-field drift class, name/HTML capability, and the scanner that protects HIGH-drift fields, see [`free-text-fields.md`](free-text-fields.md).

### `notes.games`

Per-game analyst overlay keyed by `gamePk`.

**Shape:** `object{gamePk: {moment?: str, meaning?: str}}`.

**Real example:**

```json
{
  "763472": {
    "moment": "Walkoff in the 11th against the division leader.",
    "meaning": "First walkoff of the year and the third comeback win in a week."
  }
}
```

**Source:** Hand-edited. Find `gamePk` values in `data.json.recent_games[].game_pk`.

**Consumed by:** `renderGames` (`index.html:1180`). `moment` replaces the auto-generated card line; `meaning` shows when the card expands.

**Fields per entry:**

| Field | Type | Meaning |
|---|---|---|
| `moment` | `str?` | One-line summary replacing the auto-generated card line. |
| `meaning` | `str?` | Longer paragraph shown when the card is expanded. |

---

### `notes.players`

Per-player analyst overlay keyed by `person_id`.

**Shape:** `object{person_id: {recentNote?: str, read?: str, contextNotes?: {stat: str}}}`.

**Real example:**

```json
{
  "665489": {
    "recentNote": "On-base machine — <strong>.386 OBP</strong> carrying a quiet slugging line.",
    "read": "Vlad's surface line looks merely good, but the shape is unusual...",
    "contextNotes": {
      "ops": "Pulled down by the slug. Watch this number when the power returns."
    }
  }
}
```

**Source:** Hand-edited. Find `person_id` in `data.json.roster.hitters[].id` or `data.json.roster.pitchers[].id`.

**Consumed by:** `index.html:956` (card-level `recentNote`) and `index.html:1000` (modal `read` + per-stat `contextNotes`).

**Fields per entry:**

| Field | Type | Meaning |
|---|---|---|
| `recentNote` | `str?` | Short note on the player card. HTML allowed. |
| `read` | `str?` | Paragraph in the player modal. HTML allowed. |
| `contextNotes` | `object{stat: str}?` | Per-stat row note in the modal. Plain text. Keys match the stat column names (`avg`, `obp`, `slg`, `ops`, `hr`, etc.). |

---

### `notes.overview`

Season narrative panel on the Overview tab.

**Shape:** `object{headline?: str, paragraphs?: array<str>}`.

**Real example:**

```json
{
  "headline": "Through 52 games — the bats are carrying the freight",
  "paragraphs": [
    "<strong>The shape of this season is already clear:</strong> the offense is doing the work..."
  ]
}
```

**Source:** Hand-edited.

**Consumed by:** `renderOverviewNarrative` (`index.html:758`).

**Fields:**

| Field | Type | Meaning |
|---|---|---|
| `headline` | `str?` | Single-line panel header. Plain text. |
| `paragraphs` | `array<str>?` | Body paragraphs. HTML allowed per paragraph. |

---

### `notes.team`

Team-level analyst overlay on the Team Stats tab.

**Shape:** `object{ctx?: {group.stat: str}, strengths?: array<str>, softspots?: array<str>}`.

**Real example:**

```json
{
  "ctx": {
    "hitting.ops": "Bottom quartile in MLB. The OBP holds up; the slug drags the line down.",
    "pitching.k9": "Top-five in MLB. The strikeout stuff is the load-bearing trait."
  },
  "strengths": [
    "<strong>Patient at-bat work at the top:</strong> ..."
  ],
  "softspots": [
    "<strong>Power outage:</strong> ..."
  ]
}
```

**Source:** Hand-edited. `ctx` keys follow `<group>.<stat>`, mirroring `data.json.team_stats[group][stat]`.

**Consumed by:** `renderTeam` (`index.html:1101`) — `ctx` via line 1117, `strengths`/`softspots` via line 1141.

**Fields:**

| Field | Type | Meaning |
|---|---|---|
| `ctx` | `object{group.stat: str}?` | Per-stat footer rendered under each Team Stats row. Plain text. |
| `strengths` | `array<str>?` | Strengths column on the Team Stats tab. HTML allowed. |
| `softspots` | `array<str>?` | Soft Spots column. HTML allowed. |

---

### `notes.pitches`

Per-pitch-type analyst overlay on Stat School → Pitch Types.

**Shape:** `object{pitchName: str}`.

**Real example:**

```json
{
  "Splitter": "Gausman's calling card — when the velo separation off his four-seam is sharp, he's unhittable.",
  "Curveball": "Berríos's signature pitch — heavy depth from a high slot, his best swing-and-miss offering."
}
```

**Source:** Hand-edited. Keys match the pitch `name` values in the `PITCH_TYPES` array (`index.html:382`).

**Consumed by:** `index.html:1251` — the "Team note" row at the bottom of each pitch card.

**Fields:** the value is the note string itself; no nested structure.

---

### `notes.injuries`

Per-player injury detail and ETA, keyed by `person_id`.

**Shape:** `object{person_id: {detail?: str, eta?: str}}`.

**Real example:**

```json
{
  "672386": {
    "detail": "Left thumb fracture — transferred from the 10-day to the 60-day IL on 5/27.",
    "eta": "Schneider 5/27: thumb in a brace, late-July return barring a setback."
  }
}
```

**Source:** Hand-edited. Find `person_id` in `data.json.injuries[].person_id`.

**Consumed by:** `index.html:894` — the header's injury list. `detail` replaces the MLB API's terse status; `eta` adds a return-timeline line.

**Fields per entry:**

| Field | Type | Meaning |
|---|---|---|
| `detail` | `str?` | Free-text injury description, richer than the API's status. Plain text. |
| `eta` | `str?` | Free-text return-timeline. Plain text. |

> **History:** PR #88 fixed three stale free-text references here (Bo in `team.strengths[0]`, Berríos in `team.strengths[1]`, Kirk's `injuries[672386].detail`). The [`free-text-fields.md`](free-text-fields.md) registry and the drift scanner (`tools/scan_notes_drift.py`) are the protective layer added in response.

---

## Maintenance

When a new top-level key lands in `data.json`:

1. **Update `EXPECTED_KEYS` in `assets/render.js`** (v2) so the schema-drift banner protects the new key (see `docs/agent-dispatch.md` → "Lessons learned in production" → "`EXPECTED_KEYS` drift").
2. **Update `assert_invariants` in `fetch_data.py`** with whatever shape constraints the new key must satisfy. Bare presence is not enough — encode the rule you actually depend on.
3. **Add the key to the contract** (`schema/data_contract.json`) so the contract-drift check (`tests/test_data_contract.py`) keeps the fetcher, `EXPECTED_KEYS`, and this doc in agreement. The lint fails CI if a key is emitted but undocumented (or vice versa).
4. **Add a section to this doc** following the pattern: purpose, shape, real example, source, consumed by, field table. Land it in the same PR as the schema change.

When a field on an existing key changes (added, renamed, type change):

1. **Update the field table here** with the new type and meaning.
2. **Update the example** if the new field would appear in the example snippet.
3. **Reference the PR** in the History note at the bottom of the section, so the audit trail is preserved.

When a key is removed:

1. **Don't.** Renderer fallbacks (`DATA.foo || []`) tolerate missing keys but the schema banner fires. Add to `EXPECTED_KEYS` was the rule; don't break it by removing.
2. If removal is genuinely necessary, drop the schema-banner entry in the same PR and migrate consumers first.

This doc is a contract. Drift between this doc and `data.json` is a bug — the same kind of bug the schema-drift banner catches, just in the documentation layer.
