# MLB team IDs reference

The `config.json` in your fork needs three identifiers from MLB Stats API: `team_id`, `league_id`, `division_id`. This file lists all 30 teams.

> **Verification.** These IDs are from stable historical knowledge of the API; the API itself is the canonical source. Before relying on this list for production, regenerate it once on your machine to confirm nothing has shifted. See [Regenerating this list](#regenerating-this-list) at the bottom.
>
> **Last verified: 2026-06-01.** All 15 AL teams cross-checked against the live `data.json` (which carries `team_id` + `team` for division and wild-card teams); names and IDs match. The Athletics rebrand (no "Oakland" prefix as of 2025) is reflected; `team_id 133` is preserved across the rebrand. NL IDs are stable historical — MLB Stats API team IDs persist across rebrands (Cleveland 114 stayed for Indians → Guardians; same pattern for Athletics 133).

**League IDs:**

- `103` — American League
- `104` — National League

**Division IDs:**

- `200` — AL West
- `201` — AL East
- `202` — AL Central
- `203` — NL West
- `204` — NL East
- `205` — NL Central

## American League

### AL East (`division_id: 201`)

| Team | Snippet for `config.json` |
| --- | --- |
| Baltimore Orioles | `"team_id": 110, "league_id": 103, "division_id": 201` |
| Boston Red Sox | `"team_id": 111, "league_id": 103, "division_id": 201` |
| New York Yankees | `"team_id": 147, "league_id": 103, "division_id": 201` |
| Tampa Bay Rays | `"team_id": 139, "league_id": 103, "division_id": 201` |
| Toronto Blue Jays | `"team_id": 141, "league_id": 103, "division_id": 201` |

### AL Central (`division_id: 202`)

| Team | Snippet for `config.json` |
| --- | --- |
| Chicago White Sox | `"team_id": 145, "league_id": 103, "division_id": 202` |
| Cleveland Guardians | `"team_id": 114, "league_id": 103, "division_id": 202` |
| Detroit Tigers | `"team_id": 116, "league_id": 103, "division_id": 202` |
| Kansas City Royals | `"team_id": 118, "league_id": 103, "division_id": 202` |
| Minnesota Twins | `"team_id": 142, "league_id": 103, "division_id": 202` |

### AL West (`division_id: 200`)

| Team | Snippet for `config.json` |
| --- | --- |
| Athletics | `"team_id": 133, "league_id": 103, "division_id": 200` |
| Houston Astros | `"team_id": 117, "league_id": 103, "division_id": 200` |
| Los Angeles Angels | `"team_id": 108, "league_id": 103, "division_id": 200` |
| Seattle Mariners | `"team_id": 136, "league_id": 103, "division_id": 200` |
| Texas Rangers | `"team_id": 140, "league_id": 103, "division_id": 200` |

## National League

### NL East (`division_id: 204`)

| Team | Snippet for `config.json` |
| --- | --- |
| Atlanta Braves | `"team_id": 144, "league_id": 104, "division_id": 204` |
| Miami Marlins | `"team_id": 146, "league_id": 104, "division_id": 204` |
| New York Mets | `"team_id": 121, "league_id": 104, "division_id": 204` |
| Philadelphia Phillies | `"team_id": 143, "league_id": 104, "division_id": 204` |
| Washington Nationals | `"team_id": 120, "league_id": 104, "division_id": 204` |

### NL Central (`division_id: 205`)

| Team | Snippet for `config.json` |
| --- | --- |
| Chicago Cubs | `"team_id": 112, "league_id": 104, "division_id": 205` |
| Cincinnati Reds | `"team_id": 113, "league_id": 104, "division_id": 205` |
| Milwaukee Brewers | `"team_id": 158, "league_id": 104, "division_id": 205` |
| Pittsburgh Pirates | `"team_id": 134, "league_id": 104, "division_id": 205` |
| St. Louis Cardinals | `"team_id": 138, "league_id": 104, "division_id": 205` |

### NL West (`division_id: 203`)

| Team | Snippet for `config.json` |
| --- | --- |
| Arizona Diamondbacks | `"team_id": 109, "league_id": 104, "division_id": 203` |
| Colorado Rockies | `"team_id": 115, "league_id": 104, "division_id": 203` |
| Los Angeles Dodgers | `"team_id": 119, "league_id": 104, "division_id": 203` |
| San Diego Padres | `"team_id": 135, "league_id": 104, "division_id": 203` |
| San Francisco Giants | `"team_id": 137, "league_id": 104, "division_id": 203` |

## Regenerating this list

If you want to confirm the IDs against the live API (recommended once before relying on this), with `MLB-StatsAPI` installed:

```bash
python3 - <<'PY'
import statsapi
teams = statsapi.get('teams', {'sportId': 1, 'activeStatus': 'Y'})['teams']
for t in sorted(teams, key=lambda x: (x.get('league', {}).get('id', 0), x.get('division', {}).get('id', 0), x['name'])):
    print(f"{t['name']:30s}  team_id={t['id']:>3}  league={t.get('league', {}).get('id', '?')}  division={t.get('division', {}).get('id', '?')}")
PY
```

Or hit the endpoint directly: `https://statsapi.mlb.com/api/v1/teams?sportId=1&activeStatus=Y`
