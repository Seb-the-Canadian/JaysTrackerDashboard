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
        {"player": {"id": 665489}, "stat": {"ops": ".950", "avg": ".310", "obp": ".410",
                                            "slg": ".540", "runs": 60, "homeRuns": 25}},
        {"player": {"id": 100001}, "stat": {"ops": ".700", "avg": ".250", "obp": ".320",
                                            "slg": ".380", "runs": 40, "homeRuns": 12}},
        {"player": {"id": 100002}, "stat": {"ops": ".600", "avg": ".220", "obp": ".290",
                                            "slg": ".310", "runs": 20, "homeRuns": 5}},
    ]
    pitching_splits = [
        {"player": {"id": 592332}, "stat": {"era": "2.50", "whip": "1.05",
                                            "strikeoutsPer9Inn": "10.0", "walksPer9Inn": "2.0"}},
        {"player": {"id": 200001}, "stat": {"era": "4.00", "whip": "1.30",
                                            "strikeoutsPer9Inn": "8.0", "walksPer9Inn": "3.0"}},
    ]

    def api_dispatch(endpoint, params):
        if endpoint == "stats" and params.get("group") == "hitting":
            return _player_splits_response(hitting_splits, "hitting")
        if endpoint == "stats" and params.get("group") == "pitching":
            return _player_splits_response(pitching_splits, "pitching")
        return {"stats": []}

    mocker.patch("fetch_data.api", side_effect=api_dispatch)
    roster = {
        "hitters": [{"id": 665489, "name": "Vladimir Guerrero Jr."}],
        "pitchers": [{"id": 592332, "name": "Kevin Gausman"}],
    }
    ranks = fetch_data.fetch_league_player_rankings(cfg, roster)

    assert "665489" in ranks
    assert ranks["665489"]["ops"] == 1  # highest in pool
    assert ranks["665489"]["avg"] == 1
    assert ranks["665489"]["runs"] == 1
    assert "592332" in ranks
    assert ranks["592332"]["era"] == 1  # lowest = best
    assert ranks["592332"]["k9"] == 1   # highest = best
    assert ranks["592332"]["bb9"] == 1  # lowest = best


def test_fetch_league_player_rankings_non_qualified_player_returns_none(mocker, cfg):
    """A rostered player who isn't in the qualified pool gets None
    for every slug in their group."""
    hitting_splits = [
        {"player": {"id": 100001}, "stat": {"ops": ".800", "avg": ".280", "obp": ".360",
                                            "slg": ".440", "runs": 50, "homeRuns": 18}},
    ]
    pitching_splits = []

    def api_dispatch(endpoint, params):
        if endpoint == "stats" and params.get("group") == "hitting":
            return _player_splits_response(hitting_splits, "hitting")
        if endpoint == "stats" and params.get("group") == "pitching":
            return _player_splits_response(pitching_splits, "pitching")
        return {"stats": []}

    mocker.patch("fetch_data.api", side_effect=api_dispatch)
    roster = {
        "hitters": [{"id": 999999, "name": "Bench Bat"}],
        "pitchers": [],
    }
    ranks = fetch_data.fetch_league_player_rankings(cfg, roster)

    assert "999999" in ranks
    for slug in ("ops", "avg", "obp", "slg", "runs", "hr"):
        assert ranks["999999"][slug] is None, f"expected None for {slug}"


def test_fetch_league_player_rankings_returns_empty_on_api_failure(mocker, cfg):
    """If BOTH group fetches fail, the function returns {} so the
    daily-refresh build doesn't abort. Renderer falls back to '—'."""
    mocker.patch("fetch_data.api", side_effect=RuntimeError("statsapi down"))
    roster = {
        "hitters": [{"id": 665489, "name": "X"}],
        "pitchers": [{"id": 592332, "name": "Y"}],
    }
    assert fetch_data.fetch_league_player_rankings(cfg, roster) == {}


def test_fetch_league_player_rankings_handles_partial_failure(mocker, cfg):
    """If hitting succeeds but pitching fails (or vice versa), the
    successful side still produces ranks."""
    hitting_splits = [
        {"player": {"id": 665489}, "stat": {"ops": ".900", "avg": ".300", "obp": ".400",
                                            "slg": ".500", "runs": 55, "homeRuns": 20}},
    ]

    def api_dispatch(endpoint, params):
        if endpoint == "stats" and params.get("group") == "hitting":
            return _player_splits_response(hitting_splits, "hitting")
        if endpoint == "stats" and params.get("group") == "pitching":
            raise RuntimeError("pitching down")
        return {"stats": []}

    mocker.patch("fetch_data.api", side_effect=api_dispatch)
    roster = {
        "hitters": [{"id": 665489, "name": "Hitter"}],
        "pitchers": [{"id": 592332, "name": "Pitcher"}],
    }
    ranks = fetch_data.fetch_league_player_rankings(cfg, roster)
    assert ranks["665489"]["ops"] == 1
    assert ranks["592332"]["era"] is None  # pool was empty due to fail


def test_fetch_league_player_rankings_missing_field_sinks_to_bottom(mocker, cfg):
    """A qualified player whose stat is missing/unparseable sorts to
    the bottom; the rank assignment still completes for the rest."""
    hitting_splits = [
        # Top player has a normal OPS.
        {"player": {"id": 665489}, "stat": {"ops": ".900", "avg": ".300", "obp": ".400",
                                            "slg": ".500", "runs": 55, "homeRuns": 20}},
        # Second player has a missing OPS — should rank last.
        {"player": {"id": 100001}, "stat": {"ops": None, "avg": ".275", "obp": ".355",
                                            "slg": ".410", "runs": 42, "homeRuns": 15}},
        # Third player normal.
        {"player": {"id": 100002}, "stat": {"ops": ".750", "avg": ".260", "obp": ".340",
                                            "slg": ".410", "runs": 38, "homeRuns": 13}},
    ]
    mocker.patch("fetch_data.api", side_effect=lambda e, p:
                 _player_splits_response(hitting_splits, "hitting")
                 if p.get("group") == "hitting"
                 else {"stats": []})
    roster = {"hitters": [{"id": 100001, "name": "Missing"}], "pitchers": []}
    ranks = fetch_data.fetch_league_player_rankings(cfg, roster)
    # OPS rank for 100001 should be 3 (last) since OPS is missing.
    assert ranks["100001"]["ops"] == 3
    # Other stats (which are present) place at their natural rank.
    assert ranks["100001"]["avg"] == 2


def test_fetch_league_player_rankings_uses_qualified_player_pool(mocker, cfg):
    """The fetcher must request playerPool=Qualified — the standard
    qualification rule is the contract per decision D1."""
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
