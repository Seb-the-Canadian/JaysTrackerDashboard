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
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import statsapi

try:
    import feedparser
except ImportError:
    feedparser = None

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
NEWS_RECENT_DAYS = 2
NEWS_PER_FEED_LIMIT = 25
NEWS_TOTAL_LIMIT = 20

# Hot/cold/new tag thresholds (issue #25). Compared against the season line
# already on each player record; tuned for a 7-game window. Values here so
# the dial is in one obvious spot if we ever want to relax/tighten.
RECENT_FORM_GAMES = 7
HOT_OPS_DELTA = 0.100
COLD_OPS_DELTA = -0.100
HOT_ERA_DELTA = 1.50
COLD_ERA_DELTA = 1.50
NEW_DAYS_THRESHOLD = 14


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


def fetch_division_names(cfg):
    """Build {division_id: short_name} lookup from the divisions endpoint.

    The standings response's `division` object is just {id, link} — no name.
    To render team.place as "3rd in AL East" instead of "3rd in division"
    we need a separate call. nameShort ("AL East") is the dashboard-friendly
    form; name ("American League East") is the verbose fallback.
    """
    response = api("divisions", {"sportId": MLB_SPORT_ID})
    return {d["id"]: d.get("nameShort") or d.get("name") or "" for d in response.get("divisions", [])}


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
    """Build the league wildcard view from regular standings.

    Why not standingsTypes=wildCard? That endpoint silently excludes division
    leaders (they're not wildcard candidates) and uses a wildCardGamesBack
    field where '-' means "leading the wildcard race for this division" — not
    "leading the division." The old code mislabeled the WC-race leaders as
    "Division leader" and dropped all three actual division leaders from
    the dashboard list.

    Computing the view ourselves from regular standings is more robust: every
    team in the configured league shows up, division leaders are correctly
    identified, and the math works for any team a forker plugs into config.
    """
    team_names = team_names or {}
    response = api("standings", {
        "leagueId": cfg["league_id"],
        "season": cfg["season"],
    })

    # Each division record's teamRecords is sorted by division rank.
    # Top of each list is the division leader; rest are wildcard candidates.
    division_leaders = []
    candidates = []
    for rec in response.get("records", []):
        team_records = rec.get("teamRecords", [])
        for i, tr in enumerate(team_records):
            row = _wild_card_row(tr, team_names, cfg)
            (division_leaders if i == 0 else candidates).append(row)

    sort_key = lambda r: (-_pct(r["w"], r["l"]), -r["w"])
    candidates.sort(key=sort_key)
    division_leaders.sort(key=sort_key)

    # Wildcard cutoff = the 3rd seed's record. Each non-leader's gb is
    # measured against it: ahead (positive) for the top 3, behind for the rest.
    if len(candidates) >= 3:
        cutoff_w = candidates[2]["w"]
        cutoff_l = candidates[2]["l"]
    else:
        cutoff_w = cutoff_l = 0

    for i, row in enumerate(candidates):
        if i < 3:
            seed = i + 1
            suffix = {1: "st", 2: "nd", 3: "rd"}[seed]
            row["note"] = f"In ({seed}{suffix} WC seed)"
            ahead = _gb_diff(row["w"], row["l"], cutoff_w, cutoff_l)
            row["gb"] = "-" if ahead == 0 else f"+{_fmt_gb(ahead)}"
        else:
            row["note"] = "Out"
            behind = _gb_diff(cutoff_w, cutoff_l, row["w"], row["l"])
            row["gb"] = _fmt_gb(behind)

    for row in division_leaders:
        row["note"] = "Division leader"
        row["gb"] = "-"

    # Render order: division leaders first (the locked-in playoff spots),
    # then the wildcard race in seed order.
    return division_leaders + candidates


def _wild_card_row(tr, team_names, cfg):
    tid = tr["team"]["id"]
    return {
        "team": team_names.get(tid) or tr["team"].get("name", ""),
        "team_id": tid,
        "w": tr.get("wins", 0),
        "l": tr.get("losses", 0),
        "gb": "",
        "note": "",
        "is_us": tid == cfg["team_id"],
    }


def _pct(w, l):
    return w / (w + l) if (w + l) > 0 else 0.0


def _gb_diff(better_w, better_l, worse_w, worse_l):
    """Standard MLB games-back formula. Positive when `better` is ahead."""
    return ((better_w - worse_w) + (worse_l - better_l)) / 2


def _fmt_gb(games):
    """MLB-style games-back display: '0.5', '1.0', '6.0'. '-' for 0."""
    return "-" if games == 0 else f"{games:.1f}"


# --- Schedule and games -----------------------------------------------------

def fetch_schedule(cfg, start_offset_days, end_offset_days):
    today = datetime.now(timezone.utc).date()
    start = today + timedelta(days=start_offset_days)
    end = today + timedelta(days=end_offset_days)
    # `decisions` hydrate puts the winning/losing/save pitcher inline on each
    # game, removing the need for a per-game boxscore call (saves ~10 API
    # requests per run). Neither boxscore.decisions nor walking players[]
    # surfaced the decisions for us in practice; schedule.hydrate=decisions
    # is the canonical path.
    return api("schedule", {
        "sportId": MLB_SPORT_ID,
        "teamId": cfg["team_id"],
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "hydrate": "linescore,probablePitcher,team,decisions",
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

    # Decisions land inline thanks to schedule's hydrate=decisions.
    decisions = game.get("decisions") or {}
    wp = (decisions.get("winner") or {}).get("fullName", "")
    lp = (decisions.get("loser") or {}).get("fullName", "")
    sv = (decisions.get("save") or {}).get("fullName", "")

    parts = []
    if score:
        parts.append(f"Final {score} ({result})")
    if wp:
        parts.append(f"WP {wp}")
    if lp:
        parts.append(f"LP {lp}")
    if sv:
        parts.append(f"SV {sv}")
    summary = ". ".join(parts)

    return {
        "game_pk": game.get("gamePk"),
        "date": (game.get("gameDate") or "")[:10],
        "home": is_home,
        "opp": them.get("team", {}).get("name", ""),
        "result": result,
        "score": score,
        "status": detailed,
        "winning_pitcher": wp,
        "losing_pitcher": lp,
        "summary_facts": summary,
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


# --- Roster + player stats --------------------------------------------------

def fetch_active_roster(cfg):
    response = api("team_roster", {
        "teamId": cfg["team_id"],
        "rosterType": "active",
        "season": cfg["season"],
    })
    return response.get("roster", [])


def fetch_injury_report(cfg):
    """Split 40-man non-Active entries into actual injuries vs. other unavailable.

    rosterType=injuryReport empirically returns the active 26-man with every
    player marked 'Active' (no IL'd players included, because they're not on
    the active roster). The 40-man is the superset that includes IL'd players
    with their actual status; filter to non-active to get the unavailable set.

    Status descriptions starting with "Injured" (e.g. "Injured List - 10-Day",
    "Injured List - 60-Day") are real injuries. Other non-Active descriptions
    ("Reassigned to Minors", "Released", "Restricted List", "Suspended", etc.)
    are unavailable but not injured — they get their own bucket so the UI's
    Injured List panel doesn't lie. Players with an Active or empty status
    are excluded from both lists.
    """
    response = api("team_roster", {
        "teamId": cfg["team_id"],
        "rosterType": "40Man",
        "season": cfg["season"],
    })
    injuries = []
    other_unavailable = []
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
        if is_active or not (code or desc):
            continue
        row = {
            "person_id": person.get("id"),
            "name": person.get("fullName", ""),
            "status": desc or code,
            "eta_note": "",
        }
        if desc.lower().startswith("injured"):
            injuries.append(row)
        else:
            other_unavailable.append(row)
    return {"injuries": injuries, "other_unavailable": other_unavailable}


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


def _parse_iso_date(s):
    """Parse 'YYYY-MM-DD' or full ISO into a date; return None on failure."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s)[:10]).date()
    except (TypeError, ValueError):
        return None


def _fetch_game_log(person_id, group, season):
    """Return the list of per-game splits from the gameLog endpoint, or [].

    The /stats endpoint with stats=gameLog returns one entry under `stats`
    with `splits[]`, each split carrying a per-game `stat` dict plus a
    `date` field. We don't depend on a specific field name for OPS/ERA per
    split — `_aggregate_hitting_form` / `_aggregate_pitching_form` only
    use raw counting stats (AB, H, BB, ER, IP, ...) so the math is the
    same regardless of whether the API surfaces per-game rate stats.
    """
    try:
        response = statsapi.get("stats", {
            "stats": "gameLog",
            "group": group,
            "season": season,
            "personId": person_id,
            "sportId": MLB_SPORT_ID,
        })
    except Exception as e:
        log(f"warning: gameLog fetch for {person_id} ({group}) failed: {e}")
        return []
    for entry in response.get("stats", []):
        if entry.get("group", {}).get("displayName") == group:
            return entry.get("splits") or []
        if entry.get("type", {}).get("displayName") == "gameLog":
            return entry.get("splits") or []
    # Fall through: first entry's splits, if any. Some shapes nest differently.
    stats_list = response.get("stats") or []
    if stats_list:
        return stats_list[0].get("splits") or []
    return []


def _split_date(split):
    """Pull a usable game date off a gameLog split (multiple field names seen)."""
    for k in ("date", "gameDate", "officialDate"):
        d = _parse_iso_date(split.get(k))
        if d:
            return d
        # Some shapes nest the date under game.
        game = split.get("game") or {}
        d = _parse_iso_date(game.get(k))
        if d:
            return d
    return None


def _aggregate_hitting_form(splits):
    """Compute a 7-game OPS from raw counting stats across splits.

    Returns a float OPS or None if we can't compute (no ABs in the window).
    Uses standard MLB formulas:
        OBP = (H + BB + HBP) / (AB + BB + HBP + SF)
        SLG = TB / AB    (TB falls back to 1B + 2*2B + 3*3B + 4*HR)
        OPS = OBP + SLG
    Falls back to averaging per-game `ops` if raw counts are unavailable.
    """
    ab = h = bb = hbp = sf = tb = doubles = triples = hr = singles = 0
    ops_values = []
    for s in splits:
        stat = s.get("stat") or {}
        try:
            ab += int(stat.get("atBats") or 0)
            h += int(stat.get("hits") or 0)
            bb += int(stat.get("baseOnBalls") or 0)
            hbp += int(stat.get("hitByPitch") or 0)
            sf += int(stat.get("sacFlies") or 0)
            doubles += int(stat.get("doubles") or 0)
            triples += int(stat.get("triples") or 0)
            hr += int(stat.get("homeRuns") or 0)
            tb += int(stat.get("totalBases") or 0)
        except (TypeError, ValueError):
            continue
        ops_raw = stat.get("ops")
        ops_f = parse_float(ops_raw, default=None)
        if ops_f is not None:
            ops_values.append(ops_f)
    if ab <= 0:
        return None
    singles = max(0, h - doubles - triples - hr)
    if tb <= 0:
        tb = singles + 2 * doubles + 3 * triples + 4 * hr
    obp_denom = ab + bb + hbp + sf
    if obp_denom <= 0:
        # Pathological — fall back to per-game OPS average if we have any.
        return sum(ops_values) / len(ops_values) if ops_values else None
    obp = (h + bb + hbp) / obp_denom
    slg = tb / ab if ab > 0 else 0.0
    return obp + slg


def _aggregate_pitching_form(splits):
    """Compute a 7-game ERA from raw counting stats across splits.

    Returns a float ERA or None if we can't compute (no innings in the window).
    ERA = (earnedRuns * 9) / inningsPitched
    """
    er = 0
    ip_total = 0.0
    for s in splits:
        stat = s.get("stat") or {}
        try:
            er += int(stat.get("earnedRuns") or 0)
        except (TypeError, ValueError):
            pass
        ip_total += ip_to_decimal(stat.get("inningsPitched"))
    if ip_total <= 0:
        return None
    return (er * 9.0) / ip_total


def derive_recent_form(person_id, group, season, season_rate_str):
    """Return "hot"|"cold"|"new"|None for one active player.

    Pulls the player's gameLog, takes the most recent RECENT_FORM_GAMES
    entries, and compares the resulting 7-game rate to the season rate
    we already have on the roster record. The "new" check fires off the
    first game date in the season log: if the player's been in MLB for
    fewer than NEW_DAYS_THRESHOLD days this season, they're "new".

    Defensive: any API failure, missing splits, or zero-volume window
    (no ABs / no IP) returns None rather than raising.
    """
    splits = _fetch_game_log(person_id, group, season)
    if not splits:
        return None

    # Sort by game date ascending; take the trailing N. Splits with no
    # parseable date sort to the front so they don't crowd out real games.
    splits_sorted = sorted(splits, key=lambda s: _split_date(s) or datetime.min.date())

    # "new" check: how many days has this player been in MLB this season?
    today = datetime.now(timezone.utc).date()
    first_date = None
    for s in splits_sorted:
        d = _split_date(s)
        if d is not None:
            first_date = d
            break
    if first_date is not None:
        days_in_mlb = (today - first_date).days
        if days_in_mlb < NEW_DAYS_THRESHOLD:
            return "new"

    window = splits_sorted[-RECENT_FORM_GAMES:]
    if len(window) < RECENT_FORM_GAMES:
        return None

    season_rate = parse_float(season_rate_str, default=None)
    if season_rate is None:
        return None

    if group == "hitting":
        recent = _aggregate_hitting_form(window)
        if recent is None:
            return None
        delta = recent - season_rate
        if delta >= HOT_OPS_DELTA:
            return "hot"
        if delta <= COLD_OPS_DELTA:
            return "cold"
        return None

    # pitching
    recent = _aggregate_pitching_form(window)
    if recent is None:
        return None
    # Lower ERA is better. Hot = recent ERA meaningfully below season ERA.
    if (season_rate - recent) >= HOT_ERA_DELTA:
        return "hot"
    if (recent - season_rate) >= COLD_ERA_DELTA:
        return "cold"
    return None


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
            # Skip the gameLog call if the player has no IP this season —
            # nothing to compare against, no window to compute. Stays None.
            recent = None
            if parse_float(stat.get("inningsPitched"), default=0.0) > 0:
                try:
                    recent = derive_recent_form(pid, "pitching", cfg["season"], stat.get("era"))
                except Exception as e:
                    log(f"warning: derive_recent_form for pitcher {pid} failed: {e}")
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
                "gs": stat.get("gamesStarted", 0),
                "recent": recent,
            })
        else:
            stat = fetch_player_season_stats(pid, "hitting", cfg["season"])
            # Skip the gameLog call if the player has no ABs this season.
            recent = None
            if int(stat.get("atBats") or 0) > 0:
                try:
                    recent = derive_recent_form(pid, "hitting", cfg["season"], stat.get("ops"))
                except Exception as e:
                    log(f"warning: derive_recent_form for hitter {pid} failed: {e}")
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
                "recent": recent,
            })
    return {"hitters": hitters, "pitchers": pitchers}


# --- Team stats + league rankings -------------------------------------------

# Stat keys we expose in data.team_stats. The first element of each tuple is
# the dashboard-facing key; the second is the MLB API response field name on
# the season split. Pairing them here keeps the fetcher and the renderer in
# lock-step: index.html reads {key: {val, rank}}; the fetcher reads api_field
# off the response.
HITTING_STATS = [
    ("runs", "runs"),
    ("avg", "avg"),
    ("obp", "obp"),
    ("slg", "slg"),
    ("ops", "ops"),
    ("hr", "homeRuns"),
]
PITCHING_STATS = [
    ("era", "era"),
    ("whip", "whip"),
    ("k9", "strikeoutsPer9Inn"),
    ("bb9", "walksPer9Inn"),
]
# Pitching: lower is better on ERA/WHIP/BB9, higher is better on K/9.
# Every hitting stat we surface is higher-is-better.
PITCHING_HIGHER_IS_BETTER = {"k9"}


def _our_team_split(group, cfg):
    """Fetch our team's season totals for one stat group via /teams/{id}/stats.

    Returns the `stat` dict from the season split (e.g. {"runs": 213, "avg":
    ".237", ...}) or {} if unavailable. One API call per group.
    """
    response = api("team_stats", {
        "teamId": cfg["team_id"],
        "season": cfg["season"],
        "stats": "season",
        "group": group,
    })
    for entry in response.get("stats", []):
        if (entry.get("group") or {}).get("displayName") != group:
            continue
        if (entry.get("type") or {}).get("displayName") != "season":
            continue
        splits = entry.get("splits") or []
        if splits:
            return splits[0].get("stat") or {}
    return {}


def fetch_team_stats(cfg):
    """Return our team's season values for hitting + pitching.

    Shape (without ranks; ranks are merged in by fetch_league_team_rankings):
        {
          "hitting": {"runs": 213, "avg": ".237", ...},
          "pitching": {"era": "4.05", "whip": "1.30", ...},
        }

    Values are returned as MLB surfaces them: strings for rate stats
    (avg/obp/slg/ops/era/whip/k9/bb9), ints for counting stats (runs/hr).
    Two API calls (one per group).
    """
    hitting = _our_team_split("hitting", cfg)
    pitching = _our_team_split("pitching", cfg)
    out = {"hitting": {}, "pitching": {}}
    for key, api_field in HITTING_STATS:
        out["hitting"][key] = hitting.get(api_field)
    for key, api_field in PITCHING_STATS:
        out["pitching"][key] = pitching.get(api_field)
    return out


def _league_splits_for_group(cfg, group):
    """Fetch every team's season split for `group` (one /teams/stats call).

    The /teams/stats endpoint is the team-aggregated cousin of /stats — it
    returns one split per MLB team, each carrying the full stat dict for
    the group. Sort key passed to MLB is arbitrary; we re-sort in memory
    per stat to compute ranks for every column.
    """
    sort_stat = "runs" if group == "hitting" else "era"
    response = api("teams_stats", {
        "stats": "season",
        "group": group,
        "sportIds": MLB_SPORT_ID,
        "season": cfg["season"],
        "sortStat": sort_stat,
        "order": "desc",
    })
    splits = []
    for entry in response.get("stats", []):
        if (entry.get("group") or {}).get("displayName") != group:
            continue
        for split in entry.get("splits") or []:
            if (split.get("team") or {}).get("id") is not None:
                splits.append(split)
    return splits


def _rank_for_stat(splits, cfg, api_field, higher_is_better=True):
    """Sort splits by `api_field` and return our team's 1-based rank.

    Teams with missing/unparseable values sort to the bottom. Ties resolve
    by the API's original ordering — good enough for the dashboard; MLB's
    own tiebreakers use ancillary stats we don't compute.
    """
    def key(s):
        v = (s.get("stat") or {}).get(api_field)
        f = parse_float(v, default=None)
        if f is None:
            return (1, 0.0)
        return (0, -f if higher_is_better else f)

    ordered = sorted(splits, key=key)
    for idx, s in enumerate(ordered):
        if (s.get("team") or {}).get("id") == cfg["team_id"]:
            return idx + 1
    return None


def fetch_league_team_rankings(cfg):
    """Compute our team's MLB rank for every stat we surface.

    Returns {"hitting": {key: rank, ...}, "pitching": {key: rank, ...}}, with
    ranks as 1-based ints in [1, 30] (or None if the API split is missing for
    our team or the field is empty league-wide). Two API calls (one per group).
    """
    hitting_splits = _league_splits_for_group(cfg, "hitting")
    pitching_splits = _league_splits_for_group(cfg, "pitching")
    ranks = {"hitting": {}, "pitching": {}}
    for key, api_field in HITTING_STATS:
        ranks["hitting"][key] = _rank_for_stat(hitting_splits, cfg, api_field, higher_is_better=True)
    for key, api_field in PITCHING_STATS:
        higher_better = key in PITCHING_HIGHER_IS_BETTER
        ranks["pitching"][key] = _rank_for_stat(pitching_splits, cfg, api_field, higher_is_better=higher_better)
    return ranks


def combine_team_stats(values, ranks):
    """Merge {group: {key: val}} + {group: {key: rank}} into the issue-#24 shape.

    Output: {group: {key: {"val": <val>, "rank": <rank>}}}. Lives next to the
    fetchers so the team_stats output stays in one file.
    """
    out = {}
    for group in ("hitting", "pitching"):
        out[group] = {}
        vmap = values.get(group, {}) or {}
        rmap = ranks.get(group, {}) or {}
        for key in vmap.keys() | rmap.keys():
            out[group][key] = {"val": vmap.get(key), "rank": rmap.get(key)}
    return out


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


# --- News (RSS passthrough) -------------------------------------------------

_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(s):
    """Best-effort HTML strip for feed summaries — RSS escapes vary wildly.

    feedparser already decodes entities, so we just need to drop tags so the
    UI can render the text as plain content (and escape on the client side).
    Whitespace gets collapsed because feeds often dump <p>...</p><p>...</p>
    blocks separated by newlines.
    """
    if not s:
        return ""
    text = _HTML_TAG_RE.sub("", str(s))
    return re.sub(r"\s+", " ", text).strip()


def _entry_published_dt(entry):
    """Return entry publish time as a tz-aware UTC datetime, or None.

    feedparser exposes a parsed struct_time on .published_parsed (or
    .updated_parsed) for most well-formed feeds. The struct_time is in UTC
    once feedparser normalizes it; treat it as such so timestamp comparison
    against our `cutoff` is consistent.
    """
    for key in ("published_parsed", "updated_parsed"):
        st = entry.get(key)
        if not st:
            continue
        try:
            return datetime.fromtimestamp(time.mktime(st), tz=timezone.utc)
        except (TypeError, ValueError, OverflowError):
            continue
    return None


def _published_iso(entry):
    """Prefer the original published string, fall back to derived ISO."""
    raw = entry.get("published") or entry.get("updated") or ""
    if raw:
        return raw
    dt = _entry_published_dt(entry)
    return dt.isoformat() if dt else ""


def _recent_enough(entry, days):
    dt = _entry_published_dt(entry)
    if dt is None:
        # No usable timestamp — keep it; feedparser dropped the date but the
        # source still surfaced the item recently. Better to over-include than
        # drop bylined content silently.
        return True
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    return dt >= cutoff


def _entry_author(entry):
    author = entry.get("author") or ""
    if author:
        return author.strip()
    authors = entry.get("authors") or []
    if authors and isinstance(authors, list):
        first = authors[0]
        if isinstance(first, dict):
            return (first.get("name") or "").strip()
    return ""


def _transform_entry(entry, source):
    return {
        "title": _strip_html(entry.get("title", "")),
        "summary": _strip_html(entry.get("summary", "")),
        "source": source,
        "author": _entry_author(entry),
        "url": entry.get("link", "") or "",
        "published": _published_iso(entry),
    }


def fetch_news(cfg):
    """Pull recent items from configured RSS feeds; passthrough only.

    Per-feed failures are warnings, not fatal — the daily refresh continues
    with whatever feeds succeeded. Items are filtered by recency
    (NEWS_RECENT_DAYS), optionally narrowed by a per-feed keyword, sorted by
    published desc, and capped at NEWS_TOTAL_LIMIT.
    """
    feeds = cfg.get("rss_feeds") or []
    if not feeds:
        return []
    if feedparser is None:
        log("WARN: feedparser is not installed; skipping fetch_news")
        return []
    items = []
    for feed in feeds:
        source = feed.get("source") or feed.get("url") or "unknown"
        url = feed.get("url")
        if not url:
            log(f"WARN: feed {source} missing url; skipping")
            continue
        try:
            parsed = feedparser.parse(url)
        except Exception as e:
            log(f"WARN: feed {source} failed: {e}")
            continue
        bozo_exc = getattr(parsed, "bozo_exception", None)
        if bozo_exc and not parsed.entries:
            log(f"WARN: feed {source} parse error: {bozo_exc}")
            continue
        keyword = feed.get("keyword_filter")
        kw_lower = keyword.lower() if keyword else None
        for entry in (parsed.entries or [])[:NEWS_PER_FEED_LIMIT]:
            if not _recent_enough(entry, days=NEWS_RECENT_DAYS):
                continue
            if kw_lower:
                haystack = (entry.get("title", "") + " " + entry.get("summary", "")).lower()
                if kw_lower not in haystack:
                    continue
            items.append(_transform_entry(entry, source))
    items.sort(key=lambda x: x.get("published") or "", reverse=True)
    return items[:NEWS_TOTAL_LIMIT]


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
    for k in ("injuries", "other_unavailable"):
        if not isinstance(output.get(k), list):
            die(f"{k} must be a list, got {type(output.get(k)).__name__}")
    ts = output.get("team_stats") or {}
    if not isinstance(ts, dict) or not ts:
        die("team_stats is missing or empty")
    for group in ("hitting", "pitching"):
        gmap = ts.get(group)
        if not isinstance(gmap, dict) or not gmap:
            die(f"team_stats.{group} is missing or empty")
        for key, entry in gmap.items():
            if not isinstance(entry, dict):
                die(f"team_stats.{group}.{key} is not a dict")
            # The val is allowed to be None pre-Opening-Day (no splits yet),
            # but if val is populated, rank MUST be a valid 1..30 int — a
            # bare value with no rank is the bug we're guarding against.
            if entry.get("val") in (None, ""):
                continue
            rank = entry.get("rank")
            if not isinstance(rank, int) or rank < 1 or rank > 30:
                die(f"team_stats.{group}.{key}.rank={rank!r} is not an int in [1, 30]")


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
    division_names = fetch_division_names(cfg)
    div_record = fetch_division_record(cfg)
    us_record = find_us_team_record(div_record, cfg)
    division = transform_division(div_record, cfg, team_names)
    wild_card = fetch_wild_card(cfg, team_names)

    past_schedule = fetch_schedule(cfg, -SCHEDULE_PAST_DAYS, 0)
    future_schedule = fetch_schedule(cfg, 1, SCHEDULE_FUTURE_DAYS)
    past_games = [transform_recent_game(g, cfg) for g in flatten_games(past_schedule)]
    completed = [g for g in past_games if g.get("result")]
    recent_games = completed[-RECENT_GAME_COUNT:]
    upcoming_games = [transform_upcoming_game(g, cfg) for g in flatten_games(future_schedule)]

    roster_entries = fetch_active_roster(cfg)
    roster = transform_roster(roster_entries, cfg)
    team_stat_values = fetch_team_stats(cfg)
    team_stat_ranks = fetch_league_team_rankings(cfg)
    team_stats = combine_team_stats(team_stat_values, team_stat_ranks)
    injury_report = fetch_injury_report(cfg)
    injuries = injury_report["injuries"]
    other_unavailable = injury_report["other_unavailable"]
    transactions = fetch_transactions(cfg)
    news = fetch_news(cfg)

    rs = us_record.get("runsScored") or 0
    ra = us_record.get("runsAllowed") or 0
    w = us_record.get("wins", 0)
    l = us_record.get("losses", 0)
    games_played = w + l
    pw, pl = pythag(rs, ra, games_played)
    # divisions endpoint lookup first; fall back to whatever the standings
    # record provided (typically nothing, but cheap to chain).
    div_name = (
        division_names.get(cfg["division_id"])
        or (div_record.get("division") or {}).get("name")
        or "division"
    )
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
        "team_stats": team_stats,
        "injuries": injuries,
        "other_unavailable": other_unavailable,
        "transactions": transactions,
        "news": news,
        "run_diff_last_10": run_diff_last_10(recent_games),
    }

    assert_invariants(output, cfg)
    write_atomic(output)
    log(
        f"fetch_data.py: wrote {OUTPUT_PATH} "
        f"({len(division)} division teams, {len(recent_games)} recent games, "
        f"{len(roster['hitters']) + len(roster['pitchers'])} active players, "
        f"{len(news)} news items)"
    )


if __name__ == "__main__":
    main()
