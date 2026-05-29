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
