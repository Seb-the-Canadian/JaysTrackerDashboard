"""Tests for assert_invariants — the last line of defense before data.json
is written. Each `die()` condition gets a negative test (the bad shape
raises SystemExit with an identifying message substring) and the baseline
test confirms a valid output passes.

assert_invariants is at fetch_data.py:1189-1228; this file mirrors its
order of checks.
"""
from datetime import datetime, timezone

import pytest
from freezegun import freeze_time

import fetch_data


def _valid_output() -> dict:
    """A minimal but valid data.json-shaped dict that passes all invariants
    when the season is in progress."""
    return {
        "division": [
            {"team": f"T{i}", "team_id": i, "w": 10, "l": 10}
            for i in range(5)
        ],
        "wild_card": [
            {"team": f"WC{i}", "team_id": i, "w": 10, "l": 10}
            for i in range(15)
        ],
        "recent_games": [
            {"date": "2026-05-27", "result": "W", "score": "5-3"},
        ],
        "team": {
            "record": {"w": 27, "l": 29},
            "runs_scored": 226,
            "runs_allowed": 230,
        },
        "injuries": [],
        "other_unavailable": [],
        "team_stats": {
            "hitting": {"ops": {"val": ".750", "rank": 12}},
            "pitching": {"era": {"val": "3.45", "rank": 8}},
        },
    }


# --- baseline -------------------------------------------------------------

@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_valid_output_does_not_raise(cfg):
    fetch_data.assert_invariants(_valid_output(), cfg)


# --- division -------------------------------------------------------------

@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_division_wrong_size_raises_systemexit(cfg, capsys):
    output = _valid_output()
    output["division"] = output["division"][:3]  # only 3, not 5
    with pytest.raises(SystemExit):
        fetch_data.assert_invariants(output, cfg)
    assert "division has 3 teams" in capsys.readouterr().err


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_division_too_many_raises(cfg):
    output = _valid_output()
    output["division"].append({"team": "extra", "team_id": 99, "w": 1, "l": 1})
    with pytest.raises(SystemExit):
        fetch_data.assert_invariants(output, cfg)


# --- wild_card ------------------------------------------------------------

@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_wild_card_below_min_entries_raises(cfg, capsys):
    output = _valid_output()
    output["wild_card"] = output["wild_card"][:5]  # only 5, need ≥ 10
    with pytest.raises(SystemExit):
        fetch_data.assert_invariants(output, cfg)
    assert "wild_card has 5 entries" in capsys.readouterr().err


# --- recent_games (season-in-progress check) ------------------------------

@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_no_completed_games_after_season_start_raises(cfg, capsys):
    """Season started March 25; we're at May 28. No Final games = broken."""
    output = _valid_output()
    output["recent_games"] = [
        {"date": "2026-05-27", "result": "", "score": ""},  # not Final
    ]
    with pytest.raises(SystemExit):
        fetch_data.assert_invariants(output, cfg)
    assert "no completed games" in capsys.readouterr().err


@freeze_time("2026-02-15T12:00:00", tz_offset=0)
def test_assert_invariants_no_completed_games_before_season_start_passes(cfg):
    """Pre-Opening-Day, no Final games is expected. Should pass."""
    output = _valid_output()
    output["recent_games"] = []
    fetch_data.assert_invariants(output, cfg)


# --- team.runs_scored / team.runs_allowed ---------------------------------

@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_team_runs_scored_none_raises(cfg, capsys):
    output = _valid_output()
    output["team"]["runs_scored"] = None
    with pytest.raises(SystemExit):
        fetch_data.assert_invariants(output, cfg)
    assert "team.runs_scored is None" in capsys.readouterr().err


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_team_runs_allowed_none_raises(cfg, capsys):
    output = _valid_output()
    output["team"]["runs_allowed"] = None
    with pytest.raises(SystemExit):
        fetch_data.assert_invariants(output, cfg)
    assert "team.runs_allowed is None" in capsys.readouterr().err


# --- team.record.w / team.record.l ----------------------------------------

@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_team_record_w_none_raises(cfg, capsys):
    output = _valid_output()
    output["team"]["record"]["w"] = None
    with pytest.raises(SystemExit):
        fetch_data.assert_invariants(output, cfg)
    assert "team.record.w is None" in capsys.readouterr().err


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_team_record_l_none_raises(cfg, capsys):
    output = _valid_output()
    output["team"]["record"]["l"] = None
    with pytest.raises(SystemExit):
        fetch_data.assert_invariants(output, cfg)
    assert "team.record.l is None" in capsys.readouterr().err


# --- injuries / other_unavailable list check ------------------------------

@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_injuries_not_list_raises(cfg, capsys):
    output = _valid_output()
    output["injuries"] = "not a list"
    with pytest.raises(SystemExit):
        fetch_data.assert_invariants(output, cfg)
    assert "injuries must be a list" in capsys.readouterr().err


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_other_unavailable_not_list_raises(cfg, capsys):
    output = _valid_output()
    output["other_unavailable"] = {"wrong": "type"}
    with pytest.raises(SystemExit):
        fetch_data.assert_invariants(output, cfg)
    assert "other_unavailable must be a list" in capsys.readouterr().err


# --- team_stats existence + structure -------------------------------------

@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_team_stats_missing_raises(cfg, capsys):
    output = _valid_output()
    del output["team_stats"]
    with pytest.raises(SystemExit):
        fetch_data.assert_invariants(output, cfg)
    assert "team_stats" in capsys.readouterr().err


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_team_stats_empty_dict_raises(cfg, capsys):
    output = _valid_output()
    output["team_stats"] = {}
    with pytest.raises(SystemExit):
        fetch_data.assert_invariants(output, cfg)
    assert "team_stats" in capsys.readouterr().err


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_team_stats_hitting_missing_raises(cfg, capsys):
    output = _valid_output()
    del output["team_stats"]["hitting"]
    with pytest.raises(SystemExit):
        fetch_data.assert_invariants(output, cfg)
    assert "team_stats.hitting" in capsys.readouterr().err


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_team_stats_pitching_missing_raises(cfg, capsys):
    output = _valid_output()
    del output["team_stats"]["pitching"]
    with pytest.raises(SystemExit):
        fetch_data.assert_invariants(output, cfg)
    assert "team_stats.pitching" in capsys.readouterr().err


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_team_stats_entry_not_dict_raises(cfg, capsys):
    output = _valid_output()
    output["team_stats"]["hitting"]["ops"] = "should be dict not str"
    with pytest.raises(SystemExit):
        fetch_data.assert_invariants(output, cfg)
    assert "team_stats.hitting.ops is not a dict" in capsys.readouterr().err


# --- team_stats rank validation (the bug-of-record from #51) --------------

@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_populated_val_with_none_rank_raises(cfg, capsys):
    """The specific bug the invariant was added to guard against."""
    output = _valid_output()
    output["team_stats"]["hitting"]["ops"] = {"val": ".750", "rank": None}
    with pytest.raises(SystemExit):
        fetch_data.assert_invariants(output, cfg)
    assert "rank=None" in capsys.readouterr().err


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_populated_val_with_out_of_range_rank_raises(cfg, capsys):
    output = _valid_output()
    output["team_stats"]["hitting"]["ops"] = {"val": ".750", "rank": 31}
    with pytest.raises(SystemExit):
        fetch_data.assert_invariants(output, cfg)
    assert "rank=31" in capsys.readouterr().err


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_populated_val_with_zero_rank_raises(cfg):
    output = _valid_output()
    output["team_stats"]["hitting"]["ops"] = {"val": ".750", "rank": 0}
    with pytest.raises(SystemExit):
        fetch_data.assert_invariants(output, cfg)


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_null_val_skipped_even_with_null_rank_passes(cfg):
    """Pre-Opening-Day branch: no value means no rank required."""
    output = _valid_output()
    output["team_stats"]["hitting"]["ops"] = {"val": None, "rank": None}
    fetch_data.assert_invariants(output, cfg)


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_assert_invariants_empty_val_skipped_even_with_null_rank_passes(cfg):
    output = _valid_output()
    output["team_stats"]["hitting"]["ops"] = {"val": "", "rank": None}
    fetch_data.assert_invariants(output, cfg)
