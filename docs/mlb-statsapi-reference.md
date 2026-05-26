# MLB Stats API — working reference for the tracker refactor

**Source confidence legend:**

- **[W]** verified in toddrob99/MLB-StatsAPI wiki this session
- **[K]** standard knowledge of this API (stable for years across public projects); not re-verified this session
- **[?]** unknown — needs probe artifact to confirm

This document supports the refactor of `blue-jays-2026-tracker/index.html`. It is not exhaustive; it covers only what the dashboard actually needs.

## Base URL

`https://statsapi.mlb.com/api/v1` [W]

Some endpoints accept `v1.1` for richer payloads (notably `game` content) [K]. We will not need v1.1 unless we add play-by-play.

No API key. No auth. Use of MLB data is subject to the notice at `gdx.mlb.com/components/copyright.txt` (per the PyPI page).

## Reference IDs we'll hardcode

- Toronto Blue Jays: `teamId=141` [K]
- American League: `leagueId=103` [K]
- National League: `leagueId=104` [K]
- AL East division: `divisionId=201` [K]
- Sport ID for MLB: `sportId=1` [K]

## Endpoints we'll use

### 1. Standings

**URL:** `/standings` [W]

**Required:** `leagueId` [W]

**Optional we care about:** `season`, `standingsTypes`, `date`, `hydrate` [W]

**Calls we'll make:**

- `?leagueId=103&season=2026` — full AL, three divisions, gives us AL East
- `?leagueId=103&season=2026&standingsTypes=wildCard` — wild card view
- Optionally `?leagueId=103,104&season=2026&standingsTypes=wildCard` for both leagues

**Response shape** [K]:

```
records: [                          # one per division (or one for wildCard view)
  {
    division: { id, name },
    teamRecords: [
      {
        team: { id, name },
        wins, losses,
        winningPercentage,          # string like ".472"
        gamesBack,                  # string like "10.0" or "-"
        wildCardGamesBack,
        divisionRank,               # string "1".."5"
        leagueRank,
        streak: { streakType, streakNumber, streakCode },   # streakCode = "L2", "W3", etc.
        runsScored,
        runsAllowed,
        runDifferential,
        records: {
          splitRecords: [           # includes "lastTen", "home", "away", "vsDivision", etc.
            { type: "lastTen", wins, losses, pct }
          ]
        }
      }
    ]
  }
]
```

**Gotchas:**

- `gamesBack` is `"-"` for the division leader, not `0` [K]
- `winningPercentage` is a string, not a number [K]
- Last-10 record lives under `records.splitRecords`, not at top level — need to filter [K]

### 2. Schedule

**URL:** `/schedule` [W]

**Required:** none, but practically `sportId` and either `teamId` or a date range [K]

**Optional we care about:** `teamId`, `season`, `startDate`, `endDate`, `gameType`, `hydrate`, `fields` [W]

**Calls we'll make:**

- Past N games: `?sportId=1&teamId=141&startDate=YYYY-MM-DD&endDate=today&hydrate=linescore,team`
- Tonight + next 7: `?sportId=1&teamId=141&startDate=today&endDate=today+7&hydrate=probablePitcher,linescore,team`

**Response shape** [K]:

```
dates: [
  {
    date: "2026-05-25",
    games: [
      {
        gamePk,                     # unique game ID — IMPORTANT, this is our key for notes.json
        gameDate,                   # ISO timestamp
        status: { abstractGameState, detailedState },
        teams: {
          away: { team: {id,name}, score, leagueRecord: {wins, losses, pct}, probablePitcher: {...}, isWinner },
          home: { ... same ... }
        },
        venue: { id, name },
        linescore: {                # only if hydrated
          currentInning, inningHalf, balls, strikes, outs,
          teams: { home: { runs, hits, errors }, away: { ... } },
          innings: [ { num, home: {runs}, away: {runs} } ]
        }
      }
    ]
  }
]
```

**Gotchas:**

- `gamePk` is the cross-cutting ID for everything game-related. The notes.json keys should be gamePk strings [K]
- `status.abstractGameState` values: `"Preview"`, `"Live"`, `"Final"` — we'll use this to know when to poll [K]
- `probablePitcher` only present when hydrated AND announced (often <24h before first pitch) [K]
- Doubleheaders return two games in one `dates[].games[]` array [K]

### 3. Game boxscore

**URL:** `/game/{gamePk}/boxscore` [W]

**Required:** `gamePk` in path [W]

**Response shape** [K]:

```
teams: {
  away: {
    team: { id, name },
    teamStats: {
      batting: { avg, hits, runs, homeRuns, rbi, strikeOuts, baseOnBalls, ... },
      pitching: { era, hits, runs, earnedRuns, strikeOuts, baseOnBalls, inningsPitched, ... },
      fielding: { errors, ... }
    },
    players: {
      "ID12345": {
        person: { id, fullName },
        position: { abbreviation },
        stats: {
          batting: { atBats, hits, runs, homeRuns, rbi, ... },
          pitching: { inningsPitched, hits, runs, earnedRuns, strikeOuts, baseOnBalls, decision, ... }
        },
        seasonStats: { ... },
        gameStatus: { isCurrentBatter, isCurrentPitcher, isOnBench, isSubstitute }
      }
    },
    batters: [ID, ID, ...],         # in batting order
    pitchers: [ID, ID, ...],        # in order used
    bench: [ID, ...],
    bullpen: [ID, ...]
  },
  home: { ... same ... }
}
```

**Use:** for each recent game, we can derive the "moment" sentence from the pitching decision + the top batting line. Generic but accurate. The "meaning" stays hand-written.

### 4. Team roster

**URL:** `/teams/{teamId}/roster` [W]

**Required:** none beyond `teamId` in path [W]

**Optional we care about:** `rosterType`, `season`, `date`, `hydrate` [W]

**Values for rosterType** [K]:

- `active` — current 26-man (default)
- `40Man` — full 40-man
- `fullSeason` — anyone on the team's roster at any point this season
- `fullRoster` — everyone
- `nonRosterInvitees`
- `depthChart`
- `injuryReport` — this is the one we want for the injury panel

**Calls we'll make:**

- `?rosterType=active&season=2026`
- `?rosterType=injuryReport&season=2026` — IL list

**Response shape** [K]:

```
roster: [
  {
    person: { id, fullName, link },
    jerseyNumber,
    position: { code, abbreviation, name, type },
    status: { code, description },     # for injuryReport, includes IL status
    parentTeamId
  }
]
```

**Gotchas:**

- The `injuryReport` rosterType exists but I cannot confirm from the wiki this session whether it returns the narrative injury description (e.g., "left hamstring strain") or just the IL category. The transactions endpoint is the safer source for narrative reasoning. [?]

### 5. Player stats

**URL:** `/people/{personId}/stats` [W] (also reachable via `/stats?personId=...`)

**Required:** `stats` + `group` [W]

**Calls we'll make:**

- Hitting season: `?stats=season&group=hitting&season=2026`
- Pitching season: `?stats=season&group=pitching&season=2026`
- Game-by-game: `?stats=gameLog&group=hitting&season=2026`

**Response shape** [K]:

```
stats: [
  {
    type: { displayName: "season" },
    group: { displayName: "hitting" },
    splits: [
      {
        season: "2026",
        stat: {
          gamesPlayed, atBats, runs, hits, doubles, triples, homeRuns, rbi,
          stolenBases, baseOnBalls, strikeOuts, avg, obp, slg, ops,
          ...
        }
      }
    ]
  }
]
```

For pitching, `stat` fields include: `era, whip, inningsPitched, wins, losses, saves, strikeOuts, baseOnBalls, homeRuns, hits, runs, earnedRuns`, plus rate stats like `strikeoutsPer9Inn`. [K]

**Gotchas:**

- All numeric fields come as strings in the API response, including `avg`, `era`, `inningsPitched`. Parse accordingly. [K]
- `inningsPitched` is in the baseball convention `"6.2"` = 6⅔ innings, not 6.2. Don't do float math on it without converting. [K]

### 6. Transactions

**URL:** `/transactions` [W]

**Required:** at least one of: `teamId`, `playerId`, or date range [K]

**Calls we'll make:**

- Last 7 days: `?teamId=141&startDate=YYYY-MM-DD&endDate=today`

**Response shape** [K]:

```
transactions: [
  {
    id,
    person: { id, fullName },
    fromTeam: { id, name },         # may be absent
    toTeam: { id, name },           # may be absent
    date,
    effectiveDate,
    resolutionDate,
    typeCode,                       # "SC" (selected contract), "OPT" (optioned), "REC" (recalled), "DES" (designated), "REL" (released), "TR" (traded), "FA" (free agent), etc.
    typeDesc,                       # human-readable
    description                     # full sentence
  }
]
```

**Use:** powers the structured "Since yesterday" panel that replaces the prose `lastRefreshed` blob.

## Derived metrics (no API call needed)

- **Pythagorean expectation:** `expected_pct = RS^2 / (RS^2 + RA^2)`, then `expected_W = expected_pct * (W + L)`. Bill James original used exponent 2; modern variants use 1.83. Either is fine for the dashboard. [K]
- **Magic number / elimination number:** `MN = (games_remaining_for_leader - games_back_of_chaser - 1)` simplified. Real formula is more nuanced for ties. [K]
- **Run differential over last N:** sum of `(our_score - their_score)` over last N games from `/schedule` linescore.

## What the API does NOT give us

- Beat writer quotes (Vlad on his elbow, etc.). These come from articles — outside the API. Whether we want them in the dashboard is a choice; they require manual entry or a web-search step.
- Statcast advanced metrics (xwOBA, barrel rate, exit velocity, pitch types, sprint speed). Live at `baseballsavant.mlb.com/statcast_search/csv` — separate host, separate question. Out of scope for v1 of the refactor.
- WAR (FanGraphs or Baseball Reference). No public API. Not coming.
- The analyst voice / "meaning" paragraphs. That's the writing job. Stays in `notes.json`.

## Open questions (resolved by Phase 0 probe)

1. **CORS.** Does `statsapi.mlb.com` send `Access-Control-Allow-Origin: *`? Could not verify this session — sandbox blocks the host, GitHub rate-limited the indirect search. The probe artifact resolves this in 30 seconds.
2. **Cowork artifact sandbox.** Can a Cowork artifact make arbitrary `fetch()` calls to non-CDN hosts? Unknown.
3. **`rosterType=injuryReport` payload.** Does it include the injury narrative (e.g., "hamstring strain"), or just the IL category? Probe with a single request.

## Token-efficiency model (the whole point)

**Old refresh:**

- Claude reads news, regenerates full `DATA` object → ~3-5k tokens out per refresh × frequency.

**New refresh:**

- Dashboard fetches API on load: 0 tokens.
- Notes for a specific game written on request: ~200-500 tokens out, once per game worth writing about.
- No full regeneration ever.

The savings compound across every dashboard reopen.
