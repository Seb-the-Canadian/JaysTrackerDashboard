"""Transform-function tests for fetch_data.

Tests cover the four (-ish) pure transforms that take MLB-shaped JSON
dicts in and produce structured rows out:

- transform_division
- find_us_team_record
- flatten_games
- transform_recent_game
- transform_upcoming_game
- last10_from_records (helper used by transform_division)

Each test inlines a minimal MLB-shaped fixture dict — kept small enough
to read at a glance, large enough to exercise the field paths the
transform actually reads.

transform_roster is not tested here — it calls fetch_player_season_stats
and derive_recent_form, which require mocking. PR3 covers it.

Naming: `test_<function>_<scenario>_<expected>`.
"""
import pytest

import fetch_data


# --- standings fixtures ---------------------------------------------------

def _tr(team_id: int, name: str, wins: int, losses: int, *, pct: str = ".500",
        gb: str = "-", streak: str = "W2", last_ten: str = "5-5") -> dict:
    """Build a teamRecords-shaped dict matching the MLB standings response."""
    return {
        "team": {"id": team_id, "name": name},
        "wins": wins,
        "losses": losses,
        "winningPercentage": pct,
        "gamesBack": gb,
        "streak": {"streakCode": streak},
        "records": {
            "splitRecords": [
                {"type": "lastTen", "wins": int(last_ten.split("-")[0]),
                 "losses": int(last_ten.split("-")[1])},
            ],
        },
    }


def _al_east_record() -> dict:
    """A complete 5-team AL East standings response."""
    return {
        "teamRecords": [
            _tr(139, "Tampa Bay Rays", 34, 19, pct=".642", streak="L4", last_ten="5-5"),
            _tr(147, "New York Yankees", 34, 22, pct=".607", streak="W4", last_ten="6-4"),
            _tr(141, "Toronto Blue Jays", 27, 29, pct=".482", gb="8.5", streak="W2", last_ten="6-4"),
            _tr(110, "Baltimore Orioles", 26, 30, pct=".464", gb="9.5", streak="W3", last_ten="6-4"),
            _tr(111, "Boston Red Sox", 23, 31, pct=".426", gb="11.5", streak="W1", last_ten="5-5"),
        ],
    }


# --- transform_division ---------------------------------------------------

def test_transform_division_returns_five_rows(cfg):
    rows = fetch_data.transform_division(_al_east_record(), cfg)
    assert len(rows) == 5


def test_transform_division_marks_our_team_as_is_us(cfg):
    rows = fetch_data.transform_division(_al_east_record(), cfg)
    us_rows = [r for r in rows if r["is_us"]]
    assert len(us_rows) == 1
    assert us_rows[0]["team_id"] == cfg["team_id"]
    assert us_rows[0]["team"] == "Toronto Blue Jays"


def test_transform_division_marks_others_as_not_is_us(cfg):
    rows = fetch_data.transform_division(_al_east_record(), cfg)
    others = [r for r in rows if not r["is_us"]]
    assert len(others) == 4
    assert all(r["team_id"] != cfg["team_id"] for r in others)


def test_transform_division_empty_team_records_returns_empty_list(cfg):
    assert fetch_data.transform_division({}, cfg) == []
    assert fetch_data.transform_division({"teamRecords": []}, cfg) == []


def test_transform_division_uses_team_names_lookup_when_provided(cfg):
    team_names = {141: "Jays (custom)"}
    rows = fetch_data.transform_division(_al_east_record(), cfg, team_names=team_names)
    us = [r for r in rows if r["is_us"]][0]
    assert us["team"] == "Jays (custom)"


def test_transform_division_falls_back_to_team_name_when_lookup_missing(cfg):
    rows = fetch_data.transform_division(_al_east_record(), cfg, team_names={})
    us = [r for r in rows if r["is_us"]][0]
    assert us["team"] == "Toronto Blue Jays"  # from tr.team.name


def test_transform_division_missing_streak_returns_empty_streak(cfg):
    record = {
        "teamRecords": [
            {"team": {"id": 141, "name": "Toronto Blue Jays"},
             "wins": 27, "losses": 29, "winningPercentage": ".482",
             "gamesBack": "8.5"},  # no streak key
        ],
    }
    rows = fetch_data.transform_division(record, cfg)
    assert rows[0]["streak"] == ""


def test_transform_division_pulls_last10_from_split_records(cfg):
    rows = fetch_data.transform_division(_al_east_record(), cfg)
    rays = [r for r in rows if r["team_id"] == 139][0]
    assert rays["last10"] == "5-5"


# --- find_us_team_record --------------------------------------------------

def test_find_us_team_record_present_returns_record(cfg):
    record = fetch_data.find_us_team_record(_al_east_record(), cfg)
    assert record["team"]["id"] == cfg["team_id"]


def test_find_us_team_record_absent_calls_die(cfg, capsys):
    cfg = dict(cfg)
    cfg["team_id"] = 999  # nonexistent
    with pytest.raises(SystemExit):
        fetch_data.find_us_team_record(_al_east_record(), cfg)


# --- last10_from_records --------------------------------------------------

def test_last10_from_records_returns_w_minus_l_string():
    records = {"splitRecords": [{"type": "lastTen", "wins": 6, "losses": 4}]}
    assert fetch_data.last10_from_records(records) == "6-4"


def test_last10_from_records_missing_split_returns_zero_zero():
    assert fetch_data.last10_from_records({}) == "0-0"
    assert fetch_data.last10_from_records({"splitRecords": []}) == "0-0"


def test_last10_from_records_no_last_ten_split_returns_zero_zero():
    """Only a 'home' split, no 'lastTen' — falls back to '0-0'."""
    records = {"splitRecords": [{"type": "home", "wins": 15, "losses": 10}]}
    assert fetch_data.last10_from_records(records) == "0-0"


# --- flatten_games --------------------------------------------------------

def test_flatten_games_single_date_returns_games():
    response = {"dates": [{"games": [{"gamePk": 1}, {"gamePk": 2}]}]}
    assert fetch_data.flatten_games(response) == [{"gamePk": 1}, {"gamePk": 2}]


def test_flatten_games_multiple_dates_concatenates():
    response = {
        "dates": [
            {"games": [{"gamePk": 1}]},
            {"games": [{"gamePk": 2}, {"gamePk": 3}]},
        ],
    }
    assert fetch_data.flatten_games(response) == [
        {"gamePk": 1}, {"gamePk": 2}, {"gamePk": 3},
    ]


def test_flatten_games_empty_dates_returns_empty():
    assert fetch_data.flatten_games({}) == []
    assert fetch_data.flatten_games({"dates": []}) == []


def test_flatten_games_date_with_no_games_skipped():
    response = {"dates": [{"games": []}, {"games": [{"gamePk": 1}]}]}
    assert fetch_data.flatten_games(response) == [{"gamePk": 1}]


# --- transform_recent_game fixtures ---------------------------------------

def _game(*, game_pk: int = 100, date: str = "2026-05-27", our_team: int = 141,
          opp_team: int = 111, opp_name: str = "Boston Red Sox",
          our_score: int = 5, opp_score: int = 3, is_home: bool = True,
          abstract: str = "Final", detailed: str = "Final",
          decisions: dict | None = None) -> dict:
    """Build a schedule-game dict matching MLB's shape."""
    home_id, away_id = (our_team, opp_team) if is_home else (opp_team, our_team)
    home_name = "Toronto Blue Jays" if is_home else opp_name
    away_name = opp_name if is_home else "Toronto Blue Jays"
    home_score, away_score = (our_score, opp_score) if is_home else (opp_score, our_score)
    return {
        "gamePk": game_pk,
        "gameDate": f"{date}T19:05:00Z",
        "teams": {
            "home": {"team": {"id": home_id, "name": home_name}, "score": home_score},
            "away": {"team": {"id": away_id, "name": away_name}, "score": away_score},
        },
        "status": {"abstractGameState": abstract, "detailedState": detailed},
        "decisions": decisions or {},
    }


# --- transform_recent_game ------------------------------------------------

def test_transform_recent_game_final_win_returns_w_and_score(cfg):
    g = _game(our_score=5, opp_score=3)
    row = fetch_data.transform_recent_game(g, cfg)
    assert row["result"] == "W"
    assert row["score"] == "5-3"
    assert row["us_score"] == 5
    assert row["them_score"] == 3


def test_transform_recent_game_final_loss_returns_l_and_score(cfg):
    g = _game(our_score=2, opp_score=7)
    row = fetch_data.transform_recent_game(g, cfg)
    assert row["result"] == "L"
    assert row["score"] == "2-7"


def test_transform_recent_game_postponed_returns_empty_result(cfg):
    g = _game(abstract="Final", detailed="Postponed", our_score=0, opp_score=0)
    row = fetch_data.transform_recent_game(g, cfg)
    assert row["result"] == ""
    assert row["score"] == ""


def test_transform_recent_game_in_progress_returns_empty_result(cfg):
    g = _game(abstract="Live", detailed="In Progress")
    row = fetch_data.transform_recent_game(g, cfg)
    assert row["result"] == ""
    assert row["score"] == ""


def test_transform_recent_game_home_flag_correctly_set(cfg):
    home_g = _game(is_home=True)
    away_g = _game(is_home=False)
    assert fetch_data.transform_recent_game(home_g, cfg)["home"] is True
    assert fetch_data.transform_recent_game(away_g, cfg)["home"] is False


def test_transform_recent_game_opponent_name_correctly_set(cfg):
    row = fetch_data.transform_recent_game(_game(opp_name="Boston Red Sox"), cfg)
    assert row["opp"] == "Boston Red Sox"
    away_row = fetch_data.transform_recent_game(_game(opp_name="New York Yankees", is_home=False), cfg)
    assert away_row["opp"] == "New York Yankees"


def test_transform_recent_game_decisions_populate_pitcher_fields(cfg):
    g = _game(decisions={
        "winner": {"fullName": "Jeff Hoffman"},
        "loser": {"fullName": "Andrew Nardi"},
        "save": {"fullName": "Tyler Rogers"},
    })
    row = fetch_data.transform_recent_game(g, cfg)
    assert row["winning_pitcher"] == "Jeff Hoffman"
    assert row["losing_pitcher"] == "Andrew Nardi"


def test_transform_recent_game_summary_assembled_with_all_parts(cfg):
    g = _game(our_score=5, opp_score=3, decisions={
        "winner": {"fullName": "Jeff Hoffman"},
        "loser": {"fullName": "Andrew Nardi"},
        "save": {"fullName": "Tyler Rogers"},
    })
    row = fetch_data.transform_recent_game(g, cfg)
    assert row["summary_facts"] == "Final 5-3 (W). WP Jeff Hoffman. LP Andrew Nardi. SV Tyler Rogers"


def test_transform_recent_game_no_decisions_summary_has_score_only(cfg):
    row = fetch_data.transform_recent_game(_game(our_score=5, opp_score=3), cfg)
    assert row["summary_facts"] == "Final 5-3 (W)"


def test_transform_recent_game_date_truncated_to_yyyy_mm_dd(cfg):
    row = fetch_data.transform_recent_game(_game(date="2026-05-27"), cfg)
    assert row["date"] == "2026-05-27"


# --- transform_upcoming_game ----------------------------------------------

def _upcoming(*, game_pk: int = 200, date: str = "2026-05-28",
              our_pp: str | None = "Patrick Corbin",
              their_pp: str | None = "Chris Bassitt",
              is_home: bool = False, opp_name: str = "Baltimore Orioles",
              detailed: str = "Scheduled") -> dict:
    """Build an upcoming-game dict."""
    home_id, away_id = (141, 110) if is_home else (110, 141)
    home_name = "Toronto Blue Jays" if is_home else opp_name
    away_name = opp_name if is_home else "Toronto Blue Jays"
    home_pp, away_pp = (our_pp, their_pp) if is_home else (their_pp, our_pp)
    home_team = {"team": {"id": home_id, "name": home_name}}
    away_team = {"team": {"id": away_id, "name": away_name}}
    if home_pp is not None:
        home_team["probablePitcher"] = {"fullName": home_pp}
    if away_pp is not None:
        away_team["probablePitcher"] = {"fullName": away_pp}
    return {
        "gamePk": game_pk,
        "gameDate": f"{date}T23:05:00Z",
        "teams": {"home": home_team, "away": away_team},
        "status": {"detailedState": detailed},
    }


def test_transform_upcoming_game_both_probables_returns_both_names(cfg):
    row = fetch_data.transform_upcoming_game(_upcoming(), cfg)
    assert row["probable_pitcher_us"] == "Patrick Corbin"
    assert row["probable_pitcher_them"] == "Chris Bassitt"


def test_transform_upcoming_game_only_their_probable_returns_us_empty(cfg):
    row = fetch_data.transform_upcoming_game(_upcoming(our_pp=None), cfg)
    assert row["probable_pitcher_us"] == ""
    assert row["probable_pitcher_them"] == "Chris Bassitt"


def test_transform_upcoming_game_neither_probable_returns_both_empty(cfg):
    row = fetch_data.transform_upcoming_game(_upcoming(our_pp=None, their_pp=None), cfg)
    assert row["probable_pitcher_us"] == ""
    assert row["probable_pitcher_them"] == ""


def test_transform_upcoming_game_home_flag_set_for_home_game(cfg):
    home = fetch_data.transform_upcoming_game(_upcoming(is_home=True), cfg)
    away = fetch_data.transform_upcoming_game(_upcoming(is_home=False), cfg)
    assert home["home"] is True
    assert away["home"] is False


def test_transform_upcoming_game_status_passthrough_from_detailed_state(cfg):
    row = fetch_data.transform_upcoming_game(_upcoming(detailed="Pre-Game"), cfg)
    assert row["status"] == "Pre-Game"


def test_transform_upcoming_game_opponent_name_correctly_set(cfg):
    row = fetch_data.transform_upcoming_game(_upcoming(opp_name="Baltimore Orioles"), cfg)
    assert row["opp"] == "Baltimore Orioles"
