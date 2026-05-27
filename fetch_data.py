#!/usr/bin/env python3
"""
fetch_data.py — Pull MLB team season data via the MLB Stats API and write data.json.

Driven entirely by config.json: every team-specific value (team_id, league_id,
division_id, season) comes from there, so a forker editing config.json to switch
teams succeeds without touching this file.

Output is written atomically (tmp file + os.replace) so a crashed run leaves the
previous data.json intact. Exit code is non-zero on any required fetch failure
or any invariant failure; the wrapper script reads the exit code and only commits
when this script succeeds.
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import statsapi

REPO_ROOT = Path(__file__).resolve().parent
CONFIG_PATH = REPO_ROOT / "config.json"
OUTPUT_PATH = REPO_ROOT / "data.json"
TMP_PATH = REPO_ROOT / "data.json.tmp"

# All six MLB divisions have 5 teams since the 2013 realignment.
EXPECTED_DIVISION_SIZE = 5
MIN_WILD_CARD_ENTRIES = 10
RECENT_GAME_COUNT = 10
TRANSACTION_DAYS_BACK = 7
SCHEDULE_PAST_DAYS = 30
SCHEDULE_FUTURE_DAYS = 7
MLB_SPORT_ID = 1


def log(msg):
    print(msg, file=sys.stderr)


def die(msg, code=1):
    log(f"ERROR: {msg}")
    sys.exit(code)


def load_config():
    try:
        with CONFIG_PATH.open() as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        die(f"failed to read {CONFIG_PATH}: {e}")


def api(endpoint, params):
    try:
        return statsapi.get(endpoint, params)
    except Exception as e:
        # If the underlying requests exception carries a response, include
        # the first 500 chars of the body. This distinguishes our proxy's
        # "Host not in allowlist" from a real upstream 403/4xx/5xx.
        body = ""
        resp = getattr(e, "response", None)
        if resp is not None:
            try:
                body = (resp.text or "")[:500]
            except Exception:
                pass
        suffix = f"\nResponse body: {body}" if body else ""
        die(f"API call to {endpoint} failed (params={params}): {e}{suffix}")


# --- Conversions ------------------------------------------------------------

def ip_to_decimal(ip_str):
    """Convert MLB's '6.2' (= 6 and 2/3 innings) to 6.667 for math."""
    if ip_str in (None, ""):
        return 0.0
    whole, _, frac = str(ip_str).partition(".")
    try:
        whole_int = int(whole) if whole else 0
    except ValueError:
        return 0.0
    if frac == "1":
        return whole_int + 1.0 / 3.0
    if frac == "2":
        return whole_int + 2.0 / 3.0
    return float(whole_int)


def parse_float(s, default=0.0):
    if s in (None, ""):
        return default
    try:
        return float(s)
    except (TypeError, ValueError):
        return default


def ordinal(n):
    """1 -> '1st', 2 -> '2nd', 3 -> '3rd', 4 -> '4th', 11 -> '11th', etc.

    MLB's divisionRank comes back as a string like "3"; coerce to int first.
    Return empty string for None / unparseable input.
    """
    if n in (None, ""):
        return ""
    try:
        n_int = int(n)
    except (TypeError, ValueError):
        return str(n)
    if n_int % 100 in (11, 12, 13):
        return f"{n_int}th"
    suffix = {1: "st", 2: "nd", 3: "rd"}.get(n_int % 10, "th")
    return f"{n_int}{suffix}"


# --- Standings --------------------------------------------------------------

def fetch_team_names(cfg):
    """Build {team_id: full_name} lookup from the teams endpoint.

    The standings endpoint returns each team's `name` as the short form
    ("Rays", "Yankees"). The teams endpoint returns the full club name
    ("Tampa Bay Rays", "New York Yankees"). One call, ~30 entries, reused
    in both the division and wild-card transformers.
    """
    response = api("teams", {
        "sportId": MLB_SPORT_ID,
        "activeStatus": "Y",
        "season": cfg["season"],
    })
    return {t["id"]: t.get("name") or t.get("teamName") or "" for t in response.get("teams", [])}


def fetch_division_record(cfg):
    response = api("standings", {
        "leagueId": cfg["league_id"],
        "season": cfg["season"],
    })
    target_id = cfg["division_id"]
    for rec in response.get("records", []):
        if rec.get("division", {}).get("id") == target_id:
            return rec
    die(
        f"division {target_id} not present in standings response "
        f"(league={cfg['league_id']}, season={cfg['season']})"
    )


def last10_from_records(records):
    if not records:
        return "0-0"
    for s in records.get("splitRecords", []):
        if s.get("type") == "lastTen":
            return f"{s.get('wins', 0)}-{s.get('losses', 0)}"
    return "0-0"


def transform_division(div_record, cfg, team_names=None):
    team_names = team_names or {}
    rows = []
    for tr in div_record.get("teamRecords", []):
        tid = tr["team"]["id"]
        rows.append({
            "team": team_names.get(tid) or tr["team"].get("name", ""),
            "team_id": tid,
            "w": tr.get("wins", 0),
            "l": tr.get("losses", 0),
            "pct": tr.get("winningPercentage", ""),
            "gb": tr.get("gamesBack", "-"),
            "streak": tr.get("streak", {}).get("streakCode", ""),
            "last10": last10_from_records(tr.get("records", {})),
            "is_us": tid == cfg["team_id"],
        })
    return rows


def find_us_team_record(div_record, cfg):
    for tr in div_record.get("teamRecords", []):
        if tr["team"]["id"] == cfg["team_id"]:
            return tr
    die(f"team {cfg['team_id']} not found in division {cfg['division_id']}")


def fetch_wild_card(cfg, team_names=None):
    team_names = team_names or {}
    response = api("standings", {
        "leagueId": cfg["league_id"],
        "season": cfg["season"],
        "standingsTypes": "wildCard",
    })
    rows = []
    for rec in response.get("records", []):
        for tr in rec.get("teamRecords", []):
            tid = tr["team"]["id"]
            rows.append({
                "team": team_names.get(tid) or tr["team"].get("name", ""),
                "team_id": tid,
                "w": tr.get("wins", 0),
                "l": tr.get("losses", 0),
                "gb": tr.get("wildCardGamesBack", tr.get("gamesBack", "-")),
                "note": "",
                "is_us": tid == cfg["team_id"],
            })
    return annotate_wild_card(rows)


def annotate_wild_card(rows):
    """Heuristic labels: division leaders flagged, top 3 wildcard chasers 'In', rest 'Out'.

    The MLB endpoint orders teams by wildcard rank; division leaders are usually
    listed at the top with gb='-' or '0.0'. This is advisory text for the dashboard;
    the actual postseason picture has more nuance the script doesn't try to compute.
    """
    wc_seed = 0
    for r in rows:
        gb = str(r.get("gb", ""))
        if gb in ("-", "0", "0.0"):
            r["note"] = "Division leader"
            continue
        wc_seed += 1
        if wc_seed <= 3:
            suffix = {1: "st", 2: "nd", 3: "rd"}[wc_seed]
            r["note"] = f"In ({wc_seed}{suffix} WC seed)"
        else:
            r["note"] = "Out"
    return rows


# --- Schedule and games -----------------------------------------------------

def fetch_schedule(cfg, start_offset_days, end_offset_days):
    today = datetime.now(timezone.utc).date()
    start = today + timedelta(days=start_offset_days)
    end = today + timedelta(days=end_offset_days)
    return api("schedule", {
        "sportId": MLB_SPORT_ID,
        "teamId": cfg["team_id"],
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "hydrate": "linescore,probablePitcher,team",
    })


def flatten_games(schedule_response):
    games = []
    for d in schedule_response.get("dates", []):
        games.extend(d.get("games", []))
    return games


def transform_recent_game(game, cfg):
    home = game.get("teams", {}).get("home", {})
    away = game.get("teams", {}).get("away", {})
    is_home = home.get("team", {}).get("id") == cfg["team_id"]
    us, them = (home, away) if is_home else (away, home)
    our_score = us.get("score") or 0
    their_score = them.get("score") or 0
    status = game.get("status", {})
    abstract = status.get("abstractGameState", "")
    detailed = status.get("detailedState", "")
    if abstract == "Final" and detailed != "Postponed":
        result = "W" if our_score > their_score else "L"
        score = f"{our_score}-{their_score}"
    else:
        result = ""
        score = ""
    return {
        "game_pk": game.get("gamePk"),
        "date": (game.get("gameDate") or "")[:10],
        "home": is_home,
        "opp": them.get("team", {}).get("name", ""),
        "result": result,
        "score": score,
        "status": detailed,
        "winning_pitcher": "",
        "losing_pitcher": "",
        "summary_facts": "",
        "us_score": our_score,
        "them_score": their_score,
    }


def transform_upcoming_game(game, cfg):
    home = game.get("teams", {}).get("home", {})
    away = game.get("teams", {}).get("away", {})
    is_home = home.get("team", {}).get("id") == cfg["team_id"]
    us, them = (home, away) if is_home else (away, home)
    return {
        "game_pk": game.get("gamePk"),
        "date": (game.get("gameDate") or "")[:10],
        "home": is_home,
        "opp": them.get("team", {}).get("name", ""),
        "probable_pitcher_us": (us.get("probablePitcher") or {}).get("fullName", ""),
        "probable_pitcher_them": (them.get("probablePitcher") or {}).get("fullName", ""),
        "status": game.get("status", {}).get("detailedState", ""),
    }


def enrich_with_boxscore(recent_game):
    game_pk = recent_game["game_pk"]
    if not game_pk:
        return
    box = api("game_boxscore", {"gamePk": game_pk})

    # MLB Stats API exposes pitching decisions for Final games at the boxscore
    # top level under `decisions: {winner, loser, save}` — each a person stub.
    # If that block is absent (some endpoint variants omit it), fall back to
    # walking players[].stats.pitching for a `note` of "W"/"L"/"S".
    decisions = box.get("decisions") or {}
    wp = (decisions.get("winner") or {}).get("fullName", "")
    lp = (decisions.get("loser") or {}).get("fullName", "")
    sv = (decisions.get("save") or {}).get("fullName", "")

    if not wp or not lp:
        for side in ("home", "away"):
            team_block = box.get("teams", {}).get(side, {}) or {}
            for player in (team_block.get("players") or {}).values():
                pitching = (player.get("stats") or {}).get("pitching") or {}
                note = (pitching.get("note") or pitching.get("decision") or "").strip().upper()
                name = (player.get("person") or {}).get("fullName", "")
                if not name:
                    continue
                if note == "W" and not wp:
                    wp = name
                elif note == "L" and not lp:
                    lp = name
                elif note == "S" and not sv:
                    sv = name

    recent_game["winning_pitcher"] = wp
    recent_game["losing_pitcher"] = lp

    parts = []
    if recent_game["score"]:
        parts.append(f"Final {recent_game['score']} ({recent_game['result']})")
    if wp:
        parts.append(f"WP {wp}")
    if lp:
        parts.append(f"LP {lp}")
    if sv:
        parts.append(f"SV {sv}")
    recent_game["summary_facts"] = ". ".join(parts)


# --- Roster + player stats --------------------------------------------------

def fetch_active_roster(cfg):
    response = api("team_roster", {
        "teamId": cfg["team_id"],
        "rosterType": "active",
        "season": cfg["season"],
    })
    return response.get("roster", [])


def fetch_injury_report(cfg):
    """Players on the 40-man with status other than 'Active' — i.e., on the IL,
    restricted, suspended, etc.

    rosterType=injuryReport empirically returns the active 26-man with every
    player marked 'Active' (no IL'd players included, because they're not on
    the active roster). The 40-man is the superset that includes IL'd players
    with their actual status; filter to non-active to get the injury list.
    """
    response = api("team_roster", {
        "teamId": cfg["team_id"],
        "rosterType": "40Man",
        "season": cfg["season"],
    })
    rows = []
    for entry in response.get("roster", []):
        person = entry.get("person", {})
        status = entry.get("status", {})
        code = (status.get("code") or "").strip().upper()
        desc = (status.get("description") or "").strip()
        # An "available" player has status code A (Active) and description
        # "Active". Anything else — IL stints (D7/D10/D15/D60), restricted
        # (RM), suspended (SU), paternity (PL), bereavement (BRV), etc. —
        # is somebody unavailable. Belt-and-suspenders: both signals must
        # say "active" for us to skip the entry.
        is_active = code == "A" and desc.lower() == "active"
        if not is_active and (code or desc):
            rows.append({
                "name": person.get("fullName", ""),
                "status": desc or code,
                "eta_note": "",
            })
    return rows


def fetch_player_season_stats(person_id, group, season):
    """Returns the season stat dict for one player + group, or {}.

    Uses MLB-StatsAPI's high-level player_stat_data helper, which routes
    to the per-player URL internally and correctly scopes by personId.
    The raw /stats endpoint (both `person_stats` path-form and `stats`
    query-form variants) didn't work reliably for us:

      - person_stats returned empty splits for every player
      - stats with personId returned league aggregates and IGNORED
        personId — every player on our roster came back with the same
        line (.330/.831/4 for hitters, 1.50/72.0 for pitchers)

    The helper's `stats` field nests the per-group, per-type season dict
    with the actual numeric values we want. Empty group/type combo
    (e.g., a position player has no pitching) returns {} naturally.
    """
    try:
        data = statsapi.player_stat_data(
            person_id,
            group=group,
            type="season",
            sportId=MLB_SPORT_ID,
            season=season,
        )
    except Exception as e:
        body = ""
        resp = getattr(e, "response", None)
        if resp is not None:
            try:
                body = (resp.text or "")[:200]
            except Exception:
                pass
        log(f"warning: stats fetch for {person_id} ({group}) failed: {e}" + (f"; body: {body}" if body else ""))
        return {}
    for entry in data.get("stats", []):
        if entry.get("group") == group and entry.get("type") == "season":
            return entry.get("stats", {}) or {}
    return {}


def is_pitcher(entry):
    pos = entry.get("position", {})
    return pos.get("abbreviation") in ("P", "SP", "RP", "CL") or pos.get("type") == "Pitcher"


def transform_roster(roster_entries, cfg):
    hitters, pitchers = [], []
    for entry in roster_entries:
        person = entry.get("person", {})
        pid = person.get("id")
        if not pid:
            continue
        name = person.get("fullName", "")
        pos = entry.get("position", {}).get("abbreviation", "")
        if is_pitcher(entry):
            stat = fetch_player_season_stats(pid, "pitching", cfg["season"])
            pitchers.append({
                "id": pid,
                "name": name,
                "role": pos,
                "ip": stat.get("inningsPitched", "0.0"),
                "era": stat.get("era", "-.--"),
                "whip": stat.get("whip", "-.--"),
                "k": stat.get("strikeOuts", 0),
                "bb": stat.get("baseOnBalls", 0),
                "w": stat.get("wins", 0),
                "l": stat.get("losses", 0),
                "sv": stat.get("saves", 0),
            })
        else:
            stat = fetch_player_season_stats(pid, "hitting", cfg["season"])
            hitters.append({
                "id": pid,
                "name": name,
                "pos": pos,
                "ab": stat.get("atBats", 0),
                "avg": stat.get("avg", ".---"),
                "obp": stat.get("obp", ".---"),
                "slg": stat.get("slg", ".---"),
                "ops": stat.get("ops", ".---"),
                "hr": stat.get("homeRuns", 0),
                "rbi": stat.get("rbi", 0),
                "sb": stat.get("stolenBases", 0),
            })
    return {"hitters": hitters, "pitchers": pitchers}


# --- Transactions -----------------------------------------------------------

def fetch_transactions(cfg, days_back=TRANSACTION_DAYS_BACK):
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days_back)
    response = api("transactions", {
        "teamId": cfg["team_id"],
        "startDate": start.isoformat(),
        "endDate": today.isoformat(),
    })
    rows = []
    for t in response.get("transactions", []):
        rows.append({
            "date": (t.get("date") or "")[:10],
            "type": t.get("typeDesc") or t.get("typeCode") or "",
            "description": t.get("description", ""),
            "person_name": (t.get("person") or {}).get("fullName", ""),
        })
    return rows


# --- Derived ----------------------------------------------------------------

def pythag(rs, ra, games_played):
    if games_played <= 0 or (rs <= 0 and ra <= 0):
        return 0, 0
    pct = (rs ** 2) / (rs ** 2 + ra ** 2)
    w = round(pct * games_played)
    return w, games_played - w


def run_diff_last_10(recent_games):
    finals = [g for g in recent_games if g.get("result")]
    return [
        {"date": g["date"], "diff": g["us_score"] - g["them_score"], "result": g["result"]}
        for g in finals[-10:]
    ]


# --- Invariants -------------------------------------------------------------

def assert_invariants(output, cfg):
    div = output["division"]
    if len(div) != EXPECTED_DIVISION_SIZE:
        die(f"division has {len(div)} teams, expected {EXPECTED_DIVISION_SIZE}")
    wc = output["wild_card"]
    if len(wc) < MIN_WILD_CARD_ENTRIES:
        die(f"wild_card has {len(wc)} entries, expected >= {MIN_WILD_CARD_ENTRIES}")
    rg = output["recent_games"]
    today = datetime.now(timezone.utc).date()
    season_start = datetime(int(cfg["season"]), 3, 25, tzinfo=timezone.utc).date()
    if today >= season_start and not any(g.get("result") for g in rg):
        die("recent_games has no completed games but season is in progress")
    team = output["team"]
    for k in ("runs_scored", "runs_allowed"):
        if team.get(k) is None:
            die(f"team.{k} is None")
    for k in ("w", "l"):
        if team["record"].get(k) is None:
            die(f"team.record.{k} is None")


# --- Write ------------------------------------------------------------------

def write_atomic(output):
    with TMP_PATH.open("w") as f:
        json.dump(output, f, indent=2, sort_keys=False, default=str)
    os.replace(TMP_PATH, OUTPUT_PATH)


# --- Main -------------------------------------------------------------------

def main():
    cfg = load_config()
    log(f"fetch_data.py: team_id={cfg['team_id']} season={cfg['season']}")

    team_names = fetch_team_names(cfg)
    div_record = fetch_division_record(cfg)
    us_record = find_us_team_record(div_record, cfg)
    division = transform_division(div_record, cfg, team_names)
    wild_card = fetch_wild_card(cfg, team_names)

    past_schedule = fetch_schedule(cfg, -SCHEDULE_PAST_DAYS, 0)
    future_schedule = fetch_schedule(cfg, 1, SCHEDULE_FUTURE_DAYS)
    past_games = [transform_recent_game(g, cfg) for g in flatten_games(past_schedule)]
    completed = [g for g in past_games if g.get("result")]
    recent_games = completed[-RECENT_GAME_COUNT:]
    for g in recent_games:
        enrich_with_boxscore(g)
    upcoming_games = [transform_upcoming_game(g, cfg) for g in flatten_games(future_schedule)]

    roster_entries = fetch_active_roster(cfg)
    roster = transform_roster(roster_entries, cfg)
    injuries = fetch_injury_report(cfg)
    transactions = fetch_transactions(cfg)

    rs = us_record.get("runsScored") or 0
    ra = us_record.get("runsAllowed") or 0
    w = us_record.get("wins", 0)
    l = us_record.get("losses", 0)
    games_played = w + l
    pw, pl = pythag(rs, ra, games_played)
    div_name = (div_record.get("division") or {}).get("name") or "division"
    rank_str = ordinal(us_record.get("divisionRank"))
    place = f"{rank_str} in {div_name}" if rank_str else f"in {div_name}"
    team_summary = {
        "record": {"w": w, "l": l},
        "place": place,
        "last10": last10_from_records(us_record.get("records", {})),
        "streak": us_record.get("streak", {}).get("streakCode", ""),
        "runs_scored": rs,
        "runs_allowed": ra,
        "run_diff": rs - ra,
        "pythag_w": pw,
        "pythag_l": pl,
    }

    output = {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "config": {
            "team_id": cfg["team_id"],
            "team_name": cfg["team_name"],
            "season": cfg["season"],
        },
        "team": team_summary,
        "division": division,
        "wild_card": wild_card,
        "recent_games": recent_games,
        "upcoming_games": upcoming_games,
        "roster": roster,
        "injuries": injuries,
        "transactions": transactions,
        "run_diff_last_10": run_diff_last_10(recent_games),
    }

    assert_invariants(output, cfg)
    write_atomic(output)
    log(
        f"fetch_data.py: wrote {OUTPUT_PATH} "
        f"({len(division)} division teams, {len(recent_games)} recent games, "
        f"{len(roster['hitters']) + len(roster['pitchers'])} active players)"
    )


if __name__ == "__main__":
    main()
