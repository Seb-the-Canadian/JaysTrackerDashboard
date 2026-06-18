"""Tests for the API-wrapping fetcher functions in fetch_data.

These functions take config + an MLB Stats API response and return a
narrower structure for the rest of the pipeline. They're thin shims —
the value of testing them is locking in the response-shape contract
(which keys are read, how missing fields default, how branches split).

Mocking strategy: patch `fetch_data.api` at the wrapper boundary.
That keeps the test independent of `statsapi.get`'s exact signature
and exercises the response-parsing logic that's the actual subject.
"""
import pytest

import fetch_data


# --- fetch_team_names -----------------------------------------------------

def test_fetch_team_names_builds_id_to_name_lookup(mocker, cfg):
    mocker.patch("fetch_data.api", return_value={
        "teams": [
            {"id": 141, "name": "Toronto Blue Jays", "teamName": "Blue Jays"},
            {"id": 147, "name": "New York Yankees", "teamName": "Yankees"},
        ],
    })
    result = fetch_data.fetch_team_names(cfg)
    assert result == {141: "Toronto Blue Jays", 147: "New York Yankees"}


def test_fetch_team_names_falls_back_to_team_name_when_name_missing(mocker, cfg):
    mocker.patch("fetch_data.api", return_value={
        "teams": [{"id": 141, "teamName": "Blue Jays"}],
    })
    assert fetch_data.fetch_team_names(cfg) == {141: "Blue Jays"}


def test_fetch_team_names_empty_response_returns_empty_dict(mocker, cfg):
    mocker.patch("fetch_data.api", return_value={"teams": []})
    assert fetch_data.fetch_team_names(cfg) == {}


# --- fetch_division_names -------------------------------------------------

def test_fetch_division_names_prefers_name_short(mocker, cfg):
    mocker.patch("fetch_data.api", return_value={
        "divisions": [
            {"id": 201, "nameShort": "AL East", "name": "American League East"},
            {"id": 202, "nameShort": "AL Central", "name": "American League Central"},
        ],
    })
    result = fetch_data.fetch_division_names(cfg)
    assert result == {201: "AL East", 202: "AL Central"}


def test_fetch_division_names_falls_back_to_name_when_short_missing(mocker, cfg):
    mocker.patch("fetch_data.api", return_value={
        "divisions": [{"id": 201, "name": "American League East"}],
    })
    assert fetch_data.fetch_division_names(cfg) == {201: "American League East"}


# --- fetch_division_record ------------------------------------------------

def test_fetch_division_record_returns_matching_division(mocker, cfg):
    target = {"division": {"id": 201}, "teamRecords": [{"team": {"id": 141}}]}
    other = {"division": {"id": 202}, "teamRecords": []}
    mocker.patch("fetch_data.api", return_value={"records": [other, target]})
    assert fetch_data.fetch_division_record(cfg) == target


def test_fetch_division_record_dies_when_division_absent(mocker, cfg):
    mocker.patch("fetch_data.api", return_value={"records": [
        {"division": {"id": 999}, "teamRecords": []},
    ]})
    with pytest.raises(SystemExit):
        fetch_data.fetch_division_record(cfg)


# --- fetch_active_roster --------------------------------------------------

def test_fetch_active_roster_returns_roster_array(mocker, cfg):
    roster = [{"person": {"id": 1}}, {"person": {"id": 2}}]
    mocker.patch("fetch_data.api", return_value={"roster": roster})
    assert fetch_data.fetch_active_roster(cfg) == roster


def test_fetch_active_roster_missing_roster_key_returns_empty(mocker, cfg):
    mocker.patch("fetch_data.api", return_value={})
    assert fetch_data.fetch_active_roster(cfg) == []


# --- fetch_injury_report --------------------------------------------------
#
# The 40-man response mixes Active players, IL'd players (status starts
# "Injured ..."), and other unavailable (Reassigned, Restricted, etc.).
# fetch_injury_report splits non-Actives into two buckets so the UI's
# Injured List panel stays truthful (issue #28 / PR #41).

def _roster_entry(person_id, full_name, code, desc):
    return {
        "person": {"id": person_id, "fullName": full_name},
        "status": {"code": code, "description": desc},
    }


def test_fetch_injury_report_splits_injured_from_other_unavailable(mocker, cfg):
    mocker.patch("fetch_data.api", return_value={"roster": [
        _roster_entry(1, "Healthy Hitter", "A", "Active"),
        _roster_entry(2, "Hurt Pitcher", "D60", "Injured List - 60-Day"),
        _roster_entry(3, "Minor Leaguer", "RM", "Reassigned to Minors"),
        _roster_entry(4, "IL Position", "D10", "Injured List - 10-Day"),
        _roster_entry(5, "Restricted", "RES", "Restricted List"),
    ]})
    result = fetch_data.fetch_injury_report(cfg)
    injuries = {row["person_id"] for row in result["injuries"]}
    other = {row["person_id"] for row in result["other_unavailable"]}
    assert injuries == {2, 4}
    assert other == {3, 5}


def test_fetch_injury_report_excludes_active_players(mocker, cfg):
    mocker.patch("fetch_data.api", return_value={"roster": [
        _roster_entry(1, "Active One", "A", "Active"),
        _roster_entry(2, "Active Two", "a", "active"),  # case-insensitive
    ]})
    result = fetch_data.fetch_injury_report(cfg)
    assert result == {"injuries": [], "other_unavailable": []}


def test_fetch_injury_report_excludes_entries_with_empty_status(mocker, cfg):
    mocker.patch("fetch_data.api", return_value={"roster": [
        {"person": {"id": 1, "fullName": "Ghost"},
         "status": {"code": "", "description": ""}},
    ]})
    result = fetch_data.fetch_injury_report(cfg)
    assert result == {"injuries": [], "other_unavailable": []}


def test_fetch_injury_report_row_shape_matches_contract(mocker, cfg):
    mocker.patch("fetch_data.api", return_value={"roster": [
        _roster_entry(672386, "Alejandro Kirk", "D10", "Injured List - 10-Day"),
    ]})
    result = fetch_data.fetch_injury_report(cfg)
    assert result["injuries"] == [{
        "person_id": 672386,
        "name": "Alejandro Kirk",
        "status": "Injured List - 10-Day",
        "eta_note": "",
    }]


def test_fetch_injury_report_falls_back_to_code_when_description_missing(mocker, cfg):
    mocker.patch("fetch_data.api", return_value={"roster": [
        {"person": {"id": 1, "fullName": "Status Code Only"},
         "status": {"code": "SU", "description": ""}},
    ]})
    result = fetch_data.fetch_injury_report(cfg)
    assert result["other_unavailable"][0]["status"] == "SU"


def test_fetch_injury_report_missing_full_name_defaults_to_empty(mocker, cfg):
    mocker.patch("fetch_data.api", return_value={"roster": [
        {"person": {"id": 1},  # no fullName
         "status": {"code": "D60", "description": "Injured List - 60-Day"}},
    ]})
    assert fetch_data.fetch_injury_report(cfg)["injuries"][0]["name"] == ""


def test_fetch_injury_report_empty_roster_returns_empty_lists(mocker, cfg):
    mocker.patch("fetch_data.api", return_value={"roster": []})
    assert fetch_data.fetch_injury_report(cfg) == {
        "injuries": [],
        "other_unavailable": [],
    }


# --- fetch_league_player_rankings (F1 — COG-363) -----------------------------

def _player_splits_response(splits, group):
    """Helper: wrap a list of {player, stat} splits in the /stats response
    envelope the fetcher expects."""
    return {"stats": [{"group": {"displayName": group}, "splits": splits}]}


def test_fetch_league_player_rankings_assigns_rank_per_qualified_player(mocker, cfg):
    """Hitter pool: 3 qualified players; one of them is on our roster.
    The rostered player gets ranked by each hitting stat; non-roster
    players still appear in the pool but their ranks are not surfaced."""
    hitting_splits = [
        {"player": {"id": 665489}, "stat": {"ops": ".950", "homeRuns": 25,
                                            "rbi": 80, "stolenBases": 15}},
        {"player": {"id": 100001}, "stat": {"ops": ".700", "homeRuns": 12,
                                            "rbi": 50, "stolenBases": 8}},
        {"player": {"id": 100002}, "stat": {"ops": ".600", "homeRuns": 5,
                                            "rbi": 20, "stolenBases": 3}},
    ]
    pitching_splits = [
        {"player": {"id": 592332}, "stat": {"era": "2.50", "whip": "1.05",
                                            "strikeoutsPer9Inn": "10.0", "walksPer9Inn": "2.0",
                                            "inningsPitched": "90.0"}},
        {"player": {"id": 200001}, "stat": {"era": "4.00", "whip": "1.30",
                                            "strikeoutsPer9Inn": "8.0", "walksPer9Inn": "3.0",
                                            "inningsPitched": "70.0"}},
    ]

    def api_dispatch(endpoint, params):
        if endpoint == "stats" and params.get("group") == "hitting":
            return _player_splits_response(hitting_splits, "hitting")
        if endpoint == "stats" and params.get("group") == "pitching":
            return _player_splits_response(pitching_splits, "pitching")
        return {"stats": []}

    mocker.patch("fetch_data.api", side_effect=api_dispatch)
    roster = {
        "hitters": [{"id": 665489, "name": "Vladimir Guerrero Jr.", "ab": 250,
                     "ops": ".950", "hr": 25, "rbi": 80, "sb": 15}],
        "pitchers": [{"id": 592332, "name": "Kevin Gausman", "era": "2.50",
                      "whip": "1.05", "k_per_9": "10.0", "bb_per_9": "2.0",
                      "ip": "90.0"}],
    }
    ranks, _pools = fetch_data.fetch_league_player_rankings(cfg, roster)

    assert "665489" in ranks
    assert ranks["665489"]["ops"] == 1  # highest in pool
    assert ranks["665489"]["hr"] == 1
    assert ranks["665489"]["rbi"] == 1
    assert ranks["665489"]["sb"] == 1
    assert "592332" in ranks
    assert ranks["592332"]["era"] == 1       # lowest = best
    assert ranks["592332"]["k_per_9"] == 1   # highest = best
    assert ranks["592332"]["bb_per_9"] == 1  # lowest = best
    assert ranks["592332"]["ip"] == 1        # most innings = best


def test_fetch_league_player_rankings_ranks_nonqualified_players_too(mocker, cfg):
    """Coverage guarantee (the heat-bar fix): a rostered player who is NOT in
    the qualified pool but HAS a season stat is still ranked by inserting
    their value into the qualified distribution, so every card gets a heat
    bar. Only a player with no parseable stat resolves to None."""
    hitting_splits = [  # the qualified distribution to rank against
        {"player": {"id": 1}, "stat": {"ops": ".900", "homeRuns": 30, "rbi": 90, "stolenBases": 20}},
        {"player": {"id": 2}, "stat": {"ops": ".800", "homeRuns": 22, "rbi": 70, "stolenBases": 12}},
        {"player": {"id": 3}, "stat": {"ops": ".700", "homeRuns": 14, "rbi": 50, "stolenBases": 6}},
        {"player": {"id": 4}, "stat": {"ops": ".600", "homeRuns": 6,  "rbi": 30, "stolenBases": 2}},
    ]

    def api_dispatch(endpoint, params):
        if endpoint == "stats" and params.get("group") == "hitting":
            return _player_splits_response(hitting_splits, "hitting")
        return {"stats": []}

    mocker.patch("fetch_data.api", side_effect=api_dispatch)
    roster = {
        "hitters": [
            # Not in the qualified pool, but has a real OPS → must be ranked.
            {"id": 999999, "name": "Bench Bat", "ab": 90, "ops": ".750", "hr": 10, "rbi": 40, "sb": 5},
            # Placeholder OPS (has ABs but e.g. a stat gap) → None for that slug.
            {"id": 888888, "name": "No-Stat Callup", "ab": 12, "ops": ".---", "hr": 0, "rbi": 0, "sb": 0},
        ],
        "pitchers": [],
    }
    ranks, pools = fetch_data.fetch_league_player_rankings(cfg, roster)

    # .750 sits between .800 (2nd) and .700 (3rd) in the pool of 4 → rank 3, NOT None.
    assert ranks["999999"]["ops"] == 3
    assert all(ranks["999999"][s] is not None for s in ("ops", "hr", "rbi", "sb"))
    # Placeholder OPS → None (nothing to rank); the pcard shows "—" honestly.
    assert ranks["888888"]["ops"] is None


def test_fetch_league_player_rankings_returns_empty_on_api_failure(mocker, cfg):
    """If BOTH group fetches fail, the function returns {} so the
    daily-refresh build doesn't abort. Renderer falls back to '—'."""
    mocker.patch("fetch_data.api", side_effect=RuntimeError("statsapi down"))
    roster = {
        "hitters": [{"id": 665489, "name": "X"}],
        "pitchers": [{"id": 592332, "name": "Y"}],
    }
    ranks, pools = fetch_data.fetch_league_player_rankings(cfg, roster)
    assert ranks == {}
    assert pools == {"hitting": 0, "pitching": 0}


def test_fetch_league_player_rankings_handles_partial_failure(mocker, cfg):
    """If hitting succeeds but pitching fails (or vice versa), the
    successful side still produces ranks."""
    hitting_splits = [  # pool of 2 so a percentile is well-defined
        {"player": {"id": 665489}, "stat": {"ops": ".900", "homeRuns": 20,
                                            "rbi": 55, "stolenBases": 5}},
        {"player": {"id": 100002}, "stat": {"ops": ".700", "homeRuns": 12,
                                            "rbi": 40, "stolenBases": 3}},
    ]

    def api_dispatch(endpoint, params):
        if endpoint == "stats" and params.get("group") == "hitting":
            return _player_splits_response(hitting_splits, "hitting")
        if endpoint == "stats" and params.get("group") == "pitching":
            raise RuntimeError("pitching down")
        return {"stats": []}

    mocker.patch("fetch_data.api", side_effect=api_dispatch)
    roster = {
        "hitters": [{"id": 665489, "name": "Hitter", "ab": 200, "ops": ".900",
                     "hr": 20, "rbi": 55, "sb": 5}],
        "pitchers": [{"id": 592332, "name": "Pitcher", "era": "3.00",
                      "whip": "1.10", "k_per_9": "9.0", "bb_per_9": "2.5",
                      "ip": "60.0"}],
    }
    ranks, _pools = fetch_data.fetch_league_player_rankings(cfg, roster)
    assert ranks["665489"]["ops"] == 1
    assert ranks["592332"]["era"] is None  # pool was empty due to fail


def test_fetch_league_player_rankings_zero_playing_time_gate(mocker, cfg):
    """A 0-AB hitter / 0-IP pitcher gets None for EVERY slug — counting
    stats default to 0 in the roster dict, and without the gate a fresh
    call-up would rank dead-last ("0th %ile") instead of the honest "—"."""
    hitting_splits = [
        {"player": {"id": 1}, "stat": {"ops": ".900", "homeRuns": 30, "rbi": 90, "stolenBases": 20}},
        {"player": {"id": 2}, "stat": {"ops": ".700", "homeRuns": 10, "rbi": 40, "stolenBases": 4}},
    ]
    pitching_splits = [
        {"player": {"id": 3}, "stat": {"era": "3.00", "whip": "1.10",
                                       "strikeoutsPer9Inn": "9.0", "walksPer9Inn": "2.5",
                                       "inningsPitched": "80.0"}},
        {"player": {"id": 4}, "stat": {"era": "4.50", "whip": "1.40",
                                       "strikeoutsPer9Inn": "7.0", "walksPer9Inn": "3.5",
                                       "inningsPitched": "60.0"}},
    ]

    def api_dispatch(endpoint, params):
        if endpoint == "stats" and params.get("group") == "hitting":
            return _player_splits_response(hitting_splits, "hitting")
        if endpoint == "stats" and params.get("group") == "pitching":
            return _player_splits_response(pitching_splits, "pitching")
        return {"stats": []}

    mocker.patch("fetch_data.api", side_effect=api_dispatch)
    roster = {
        # 0 AB: counting stats are the roster-dict defaults (0) — gate must
        # block them all, even though 0 is technically rankable.
        "hitters": [{"id": 777, "name": "Fresh Callup", "ab": 0,
                     "ops": ".---", "hr": 0, "rbi": 0, "sb": 0}],
        # 0.0 IP: era/whip are placeholders, but ip "0.0" parses — gate
        # must block the whole row.
        "pitchers": [{"id": 888, "name": "Taxi Squad", "ip": "0.0",
                      "era": "-.--", "whip": "-.--", "k_per_9": "-.--",
                      "bb_per_9": "-.--"}],
    }
    ranks, _pools = fetch_data.fetch_league_player_rankings(cfg, roster)
    assert all(v is None for v in ranks["777"].values()), ranks["777"]
    assert all(v is None for v in ranks["888"].values()), ranks["888"]


def test_fetch_league_player_rankings_missing_primary_stat_is_none(mocker, cfg):
    """A rostered player with a placeholder primary stat resolves to None
    for THAT slug (nothing to rank → heat bar shows "—"), while their other
    present stats still rank against the distribution."""
    hitting_splits = [
        {"player": {"id": 665489}, "stat": {"homeRuns": 20}},
        {"player": {"id": 100002}, "stat": {"homeRuns": 13}},
        {"player": {"id": 100003}, "stat": {"homeRuns": 8}},
    ]
    mocker.patch("fetch_data.api", side_effect=lambda e, p:
                 _player_splits_response(hitting_splits, "hitting")
                 if p.get("group") == "hitting"
                 else {"stats": []})
    # Placeholder OPS, but a real HR total.
    roster = {"hitters": [{"id": 100001, "name": "Missing", "ab": 120,
                           "ops": ".---", "hr": 15, "rbi": 0, "sb": 0}],
              "pitchers": []}
    ranks, _pools = fetch_data.fetch_league_player_rankings(cfg, roster)
    # Placeholder OPS → None (nothing to rank).
    assert ranks["100001"]["ops"] is None
    # HR 15 vs distribution {20, 13, 8}: one strictly better → rank 2.
    assert ranks["100001"]["hr"] == 2


def test_fetch_league_player_rankings_uses_qualified_player_pool(mocker, cfg):
    """The fetcher still requests playerPool=Qualified — that pool is now the
    DISTRIBUTION every rostered player is ranked against (not a rank-eligibility
    gate). The request shape is the contract."""
    captured_params = []

    def api_dispatch(endpoint, params):
        captured_params.append((endpoint, dict(params)))
        return {"stats": []}

    mocker.patch("fetch_data.api", side_effect=api_dispatch)
    fetch_data.fetch_league_player_rankings(cfg, {"hitters": [], "pitchers": []})
    assert any(p[1].get("playerPool") == "Qualified" for p in captured_params)
    assert any(p[1].get("group") == "hitting" for p in captured_params)
    assert any(p[1].get("group") == "pitching" for p in captured_params)


# --- fetch_player_bio (F2 — COG-366) -----------------------------------------

def test_fetch_player_bio_extracts_batSide_pitchHand_age(mocker):
    fetch_data._BIO_CACHE.clear()
    mocker.patch("fetch_data.statsapi.get", return_value={
        "people": [{
            "id": 665489,
            "fullName": "Vladimir Guerrero Jr.",
            "batSide": {"code": "R", "description": "Right"},
            "pitchHand": {"code": "R", "description": "Right"},
            "currentAge": 27,
            "height": "6' 2\"",
            "weight": 250,
        }],
    })
    bio = fetch_data.fetch_player_bio(665489)
    assert bio == {
        "bats": "R", "throws": "R", "age": 27,
        "height": "6' 2\"", "weight": 250,
    }


def test_fetch_player_bio_handles_lefthanded_pitcher():
    fetch_data._BIO_CACHE.clear()
    # Build the response inline; pitchHand=L, no bats field on a pitcher.
    import unittest.mock as mock
    with mock.patch("fetch_data.statsapi.get", return_value={
        "people": [{
            "id": 592332,
            "pitchHand": {"code": "L"},
            "currentAge": 35,
        }],
    }):
        bio = fetch_data.fetch_player_bio(592332)
    assert bio.get("throws") == "L"
    assert bio.get("age") == 35
    assert "bats" not in bio  # absent — pitcher with no batSide field


def test_fetch_player_bio_returns_empty_on_api_failure(mocker):
    fetch_data._BIO_CACHE.clear()
    mocker.patch("fetch_data.statsapi.get", side_effect=RuntimeError("statsapi down"))
    assert fetch_data.fetch_player_bio(999999) == {}


def test_fetch_player_bio_returns_empty_when_no_people_in_response(mocker):
    fetch_data._BIO_CACHE.clear()
    mocker.patch("fetch_data.statsapi.get", return_value={"people": []})
    assert fetch_data.fetch_player_bio(123456) == {}


def test_fetch_player_bio_caches_lookups(mocker):
    """The in-process cache means multiple roster scans within one
    fetch_data run don't refetch the same player."""
    fetch_data._BIO_CACHE.clear()
    api = mocker.patch("fetch_data.statsapi.get", return_value={
        "people": [{"id": 665489, "currentAge": 27}],
    })
    fetch_data.fetch_player_bio(665489)
    fetch_data.fetch_player_bio(665489)
    fetch_data.fetch_player_bio(665489)
    assert api.call_count == 1


def test_fetch_player_bio_skips_missing_currentAge(mocker):
    """If MLB doesn't surface currentAge for a callup, the field is
    omitted entirely (rather than rendering as 0 or None in the modal)."""
    fetch_data._BIO_CACHE.clear()
    mocker.patch("fetch_data.statsapi.get", return_value={
        "people": [{"id": 100001, "batSide": {"code": "R"}}],
    })
    bio = fetch_data.fetch_player_bio(100001)
    assert bio.get("bats") == "R"
    assert "age" not in bio


# --- fetch_all_standings (G3) -------------------------------------------------

def test_fetch_all_standings_keys_by_team_id_across_divisions(mocker, cfg):
    """League-wide standings flatten every division's teamRecords into a
    {team_id_str: {...}} map so interleague opponents resolve too."""
    response = {
        "records": [
            {"division": {"id": 201}, "teamRecords": [
                {"team": {"id": 141, "name": "Blue Jays"}, "wins": 40, "losses": 20,
                 "winningPercentage": ".667", "gamesBack": "-",
                 "streak": {"streakCode": "W3"}, "divisionRank": "1",
                 "records": {"splitRecords": [{"type": "lastTen", "wins": 7, "losses": 3}]}},
                {"team": {"id": 110, "name": "Orioles"}, "wins": 30, "losses": 30,
                 "winningPercentage": ".500", "gamesBack": "10.0",
                 "streak": {"streakCode": "L2"}, "divisionRank": "3",
                 "records": {"splitRecords": [{"type": "lastTen", "wins": 4, "losses": 6}]}},
            ]},
            {"division": {"id": 204}, "teamRecords": [  # NL East — interleague
                {"team": {"id": 144, "name": "Braves"}, "wins": 35, "losses": 25,
                 "winningPercentage": ".583", "gamesBack": "-",
                 "streak": {"streakCode": "W1"}, "divisionRank": "1",
                 "records": {"splitRecords": [{"type": "lastTen", "wins": 6, "losses": 4}]}},
            ]},
        ]
    }
    mocker.patch("fetch_data.api", return_value=response)
    out = fetch_data.fetch_all_standings(
        cfg,
        team_names={141: "Toronto Blue Jays", 110: "Baltimore Orioles", 144: "Atlanta Braves"},
        division_names={201: "AL East", 204: "NL East"})
    assert set(out.keys()) == {"141", "110", "144"}
    # Interleague opponent resolves with full name + division.
    assert out["144"]["team"] == "Atlanta Braves"
    assert out["144"]["division_name"] == "NL East"
    # Per-team context carried through.
    assert out["110"]["last10"] == "4-6"
    assert out["110"]["streak"] == "L2"
    assert out["110"]["gb"] == "10.0"
    assert out["141"]["division_rank"] == "1"


def test_fetch_all_standings_requests_both_leagues(mocker, cfg):
    captured = []
    mocker.patch("fetch_data.api",
                 side_effect=lambda e, p: captured.append(dict(p)) or {"records": []})
    fetch_data.fetch_all_standings(cfg)
    assert captured and captured[0].get("leagueId") == "103,104"


def test_fetch_all_standings_failure_returns_empty(mocker, cfg):
    mocker.patch("fetch_data.api", side_effect=RuntimeError("boom"))
    assert fetch_data.fetch_all_standings(cfg) == {}


# --- fetch_opposing_pitcher_lines (G3) ---------------------------------------

def test_fetch_opposing_pitcher_lines_dedupes_and_keys_by_id(mocker, cfg):
    mocker.patch("fetch_data.fetch_player_bio",
                 side_effect=lambda pid: {"throws": "R", "age": 30})
    mocker.patch("fetch_data.fetch_player_season_stats",
                 side_effect=lambda pid, group, season: {
                     "era": "3.10", "whip": "1.05", "inningsPitched": "70.0",
                     "strikeOuts": 80, "gamesStarted": 12})
    upcoming = [
        {"probable_pitcher_them_id": 700, "probable_pitcher_them": "Chris Bassitt"},
        {"probable_pitcher_them_id": 700, "probable_pitcher_them": "Chris Bassitt"},  # dup
        {"probable_pitcher_them_id": None, "probable_pitcher_them": ""},              # skip
        {"probable_pitcher_them_id": 701, "probable_pitcher_them": "Grayson Rodriguez"},
    ]
    out = fetch_data.fetch_opposing_pitcher_lines(cfg, upcoming)
    assert set(out.keys()) == {"700", "701"}
    assert out["700"]["throws"] == "R"
    assert out["700"]["era"] == "3.10"
    assert out["700"]["name"] == "Chris Bassitt"
    assert out["701"]["gs"] == 12


def test_fetch_opposing_pitcher_lines_tolerates_empty_fetch(mocker, cfg):
    """When bio/stats come back empty (their own failure handling), the
    pitcher still gets an entry with placeholders — modal shows name+link."""
    mocker.patch("fetch_data.fetch_player_bio", side_effect=lambda pid: {})
    mocker.patch("fetch_data.fetch_player_season_stats",
                 side_effect=lambda pid, group, season: {})
    upcoming = [{"probable_pitcher_them_id": 700, "probable_pitcher_them": "X"}]
    out = fetch_data.fetch_opposing_pitcher_lines(cfg, upcoming)
    assert out["700"]["era"] == "-.--"
    assert out["700"]["throws"] is None
    assert out["700"]["name"] == "X"
