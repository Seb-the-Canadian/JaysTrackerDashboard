# data.json schema reference

The canonical contract between `fetch_data.py` (writer) and `index.html` (reader).

Every key the dashboard renders comes from here. Every field the fetcher emits is documented here. When these get out of sync, the schema-drift banner fires; when the doc gets out of sync with reality, fix the doc.

This file is generated at the end of each daily refresh and committed to `main`. The renderer fetches it fresh on every dashboard load (with a `localStorage` cache for instant reopens).

---

## Orientation

### Role

`data.json` is the single source of truth between the data layer (Python, runs once a day) and the render layer (vanilla JS, runs on every dashboard load). Three properties of the file:

- **Immutable per refresh.** The fetcher writes it once via `write_atomic` (`fetch_data.py:1233`), which writes to `data.json.tmp` and `os.replace`s into place. Readers never see a partial write.
- **Self-validating.** Before write, `assert_invariants` (`fetch_data.py:1189`) checks size + type constraints on every required key and `die()`s on a violation. A run that fails invariants leaves the previous `data.json` in place — the dashboard goes stale, but it never goes wrong.
- **Schema-drift-checked.** The renderer compares `data.json`'s top-level keys to `EXPECTED_KEYS` (`index.html:261`). Missing keys raise a visible banner. New keys are silently ignored — but if the renderer needs them, you'll see it in the next consumer.

### Top-level keys (14)

| Key | Type | Section |
|---|---|---|
| `as_of` | `str` | [Meta](#as_of) |
| `config` | `object` | [Meta](#config) |
| `team` | `object` | [Team](#team) |
| `team_stats` | `object` | [Team](#team_stats) |
| `division` | `array<object>` | [Standings](#division) |
| `wild_card` | `array<object>` | [Standings](#wild_card) |
| `recent_games` | `array<object>` | [Games](#recent_games) |
| `upcoming_games` | `array<object>` | [Games](#upcoming_games) |
| `run_diff_last_10` | `array<object>` | [Games](#run_diff_last_10) |
| `roster` | `object` | [Roster](#roster) |
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
  "last10": "6-4",
  "streak": "W2",
  "runs_scored": 226,
  "runs_allowed": 230,
  "run_diff": -4,
  "pythag_w": 28,
  "pythag_l": 28
}
```

**Source:** Built in `main()` from `find_us_team_record(div_record, cfg)`. Pythagorean expected wins/losses computed by `pythag(rs, ra, games_played)` (`fetch_data.py`, around line 1058). Upstream endpoint: `/standings` (`leagueId`, `season`).

**Consumed by:** `renderOverview` (`index.html:647`) — KPI cards row across the top of the Overview tab. Also `renderTeam` (`index.html:1087`).

**Fields:**

| Field | Type | Meaning |
|---|---|---|
| `record.w` | `int` | Wins. |
| `record.l` | `int` | Losses. |
| `place` | `str` | Rank phrase, e.g. `"3rd in AL East"`. |
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
  "opp": "Baltimore Orioles",
  "probable_pitcher_us": "Patrick Corbin",
  "probable_pitcher_them": "Chris Bassitt",
  "status": "Scheduled"
}
```

**Source:** `transform_upcoming_game(game, cfg)` (`fetch_data.py:460`) for each game in the future-window schedule, filtered to non-Final games. Upstream endpoint: `/schedule` with `hydrate=probablePitcher,team` (same call as `recent_games`).

**Consumed by:** `renderUpcomingTable(DATA.upcoming_games || [])` called from `renderOverview` (`index.html:688`). `renderSinceYesterday` also peeks at the first entry for the "today" slot.

**Fields:**

| Field | Type | Meaning |
|---|---|---|
| `game_pk` | `int` | MLB game identifier. |
| `date` | `str` | Game date as `"YYYY-MM-DD"`. |
| `home` | `bool` | `true` if our team is home. |
| `opp` | `str` | Opponent's full team name. |
| `probable_pitcher_us` | `str` | Our probable starter's `fullName`. Often empty for non-imminent games. |
| `probable_pitcher_them` | `str` | Opponent's probable starter's `fullName`. Often empty. |
| `status` | `str` | MLB `detailedState`, typically `"Scheduled"`. |

> **History:** Pre-PR #62, `upcoming_games` started at offset `+1` day, dropping today's not-yet-played game. Now starts at offset `0` and filters out `Final` games to avoid double-counting against `recent_games`.

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

**Source:** `transform_roster(roster_entries, cfg)` (`fetch_data.py:796`). For each player on the active roster, calls `fetch_player_season_stats(person_id, group, season)` (`fetch_data.py:535`) for season counters and `derive_recent_form(person_id, group, season, season_rate_str, stat_signature=...)` for the `recent` tag. Upstream endpoints: `/teams/{teamId}/roster?rosterType=active` for the list, then `/people/{personId}?hydrate=stats(group=X,type=season,...)` and `...type=gameLog,...` per player.

**Consumed by:** `renderPlayers` (`index.html:863`) — groups players into Starting Rotation (`gs >= 3`), Bullpen (others), Lineup Regulars (top hitters by AB), Bench / Depth (rest). Also `renderOverview` peeks at counts.

**Hitter fields:**

| Field | Type | Meaning |
|---|---|---|
| `id` | `int` | MLB `personId`. Also the key used by `notes.json.players`. |
| `name` | `str` | Full name (`fullName`). |
| `pos` | `str` | Position abbreviation, e.g. `"SS"`, `"C"`, `"OF"`. |
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

## Maintenance

When a new top-level key lands in `data.json`:

1. **Update `EXPECTED_KEYS` in `index.html:261`** so the schema-drift banner protects the new key (see `docs/agent-dispatch.md` → "Lessons learned in production" → "`EXPECTED_KEYS` drift").
2. **Update `assert_invariants` in `fetch_data.py:1189`** with whatever shape constraints the new key must satisfy. Bare presence is not enough — encode the rule you actually depend on.
3. **Add a section to this doc** following the pattern: purpose, shape, real example, source, consumed by, field table. Land it in the same PR as the schema change.

When a field on an existing key changes (added, renamed, type change):

1. **Update the field table here** with the new type and meaning.
2. **Update the example** if the new field would appear in the example snippet.
3. **Reference the PR** in the History note at the bottom of the section, so the audit trail is preserved.

When a key is removed:

1. **Don't.** Renderer fallbacks (`DATA.foo || []`) tolerate missing keys but the schema banner fires. Add to `EXPECTED_KEYS` was the rule; don't break it by removing.
2. If removal is genuinely necessary, drop the schema-banner entry in the same PR and migrate consumers first.

This doc is a contract. Drift between this doc and `data.json` is a bug — the same kind of bug the schema-drift banner catches, just in the documentation layer.
