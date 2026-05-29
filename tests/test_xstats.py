"""Tests for fetch_player_xstats — MLB Stats API expectedStatistics hydrate.

Uses the same /people endpoint family as _fetch_game_log (PR #63 pattern).
statsapi.get is mocked at the boundary; no real network calls.

Issue #29 Phase A.
"""
import pytest

import fetch_data


# Capture the real function before conftest's autouse mock replaces it
# per-test. We restore it inside this file's tests so we can exercise the
# real fetch_player_xstats logic with statsapi.get mocked at the boundary.
_REAL_FETCH_PLAYER_XSTATS = fetch_data.fetch_player_xstats


def _xstat_response(splits: list, type_name: str = "expectedStatistics",
                    group_name: str = "hitting") -> dict:
    """Build a /people response with one stats[] entry matching the query."""
    return {
        "people": [{
            "id": 665489,
            "stats": [{
                "type": {"displayName": type_name},
                "group": {"displayName": group_name},
                "splits": splits,
            }],
        }],
    }


@pytest.fixture(autouse=True)
def restore_real_xstats(mocker):
    """Override conftest's autouse mock — restore the real function for
    tests in this file, with statsapi.get still mockable at the boundary."""
    mocker.patch("fetch_data.fetch_player_xstats", _REAL_FETCH_PLAYER_XSTATS)
    yield


# --- happy path -----------------------------------------------------------

def test_fetch_player_xstats_returns_stat_dict_on_success(mocker):
    splits = [{"stat": {"xWoba": ".385", "xBa": ".310", "xSlg": ".525"}}]
    api_mock = mocker.patch("fetch_data.statsapi.get",
                            return_value=_xstat_response(splits))
    result = fetch_data.fetch_player_xstats(665489, 2026)
    assert result == {"xWoba": ".385", "xBa": ".310", "xSlg": ".525"}
    api_mock.assert_called_once()


def test_fetch_player_xstats_routes_to_person_endpoint_with_hydrate(mocker):
    """Confirm the call shape — /people/{id} with the expectedStatistics
    hydrate. Same workaround as _fetch_game_log (player_stat_data rejects
    season + non-season type)."""
    mocker.patch("fetch_data.statsapi.get",
                 return_value=_xstat_response([{"stat": {"xWoba": ".320"}}]))
    fetch_data.fetch_player_xstats(665489, 2026)
    call = fetch_data.statsapi.get.call_args
    assert call.args[0] == "person"
    assert call.args[1]["personId"] == 665489
    assert "stats(group=hitting,type=expectedStatistics" in call.args[1]["hydrate"]
    assert "season=2026" in call.args[1]["hydrate"]


# --- empty / missing data paths -------------------------------------------

def test_fetch_player_xstats_empty_people_returns_empty(mocker):
    mocker.patch("fetch_data.statsapi.get", return_value={"people": []})
    assert fetch_data.fetch_player_xstats(665489, 2026) == {}


def test_fetch_player_xstats_no_stats_entries_returns_empty(mocker):
    mocker.patch("fetch_data.statsapi.get",
                 return_value={"people": [{"id": 665489, "stats": []}]})
    assert fetch_data.fetch_player_xstats(665489, 2026) == {}


def test_fetch_player_xstats_empty_splits_returns_empty(mocker):
    """Pre-Opening-Day case: response has the right shape but no rows yet."""
    mocker.patch("fetch_data.statsapi.get",
                 return_value=_xstat_response([]))
    assert fetch_data.fetch_player_xstats(665489, 2026) == {}


def test_fetch_player_xstats_wrong_group_returns_empty(mocker):
    """If MLB returns pitching xstats (shouldn't happen but defensive)."""
    mocker.patch("fetch_data.statsapi.get",
                 return_value=_xstat_response(
                     [{"stat": {"xEra": "3.10"}}], group_name="pitching"))
    assert fetch_data.fetch_player_xstats(665489, 2026) == {}


def test_fetch_player_xstats_wrong_type_returns_empty(mocker):
    """If MLB returns season (not expectedStatistics) by mistake."""
    mocker.patch("fetch_data.statsapi.get",
                 return_value=_xstat_response(
                     [{"stat": {"avg": ".300"}}], type_name="season"))
    assert fetch_data.fetch_player_xstats(665489, 2026) == {}


# --- failure paths --------------------------------------------------------

def test_fetch_player_xstats_api_error_returns_empty_logs_warning(mocker, capsys):
    """Network error / HTTP failure → empty dict, WARN log, no `die`."""
    mocker.patch("fetch_data.statsapi.get",
                 side_effect=RuntimeError("connection refused"))
    result = fetch_data.fetch_player_xstats(665489, 2026)
    assert result == {}
    assert "xstats fetch for 665489 failed" in capsys.readouterr().err


def test_fetch_player_xstats_missing_stat_dict_returns_empty(mocker):
    """Split exists but the stat sub-dict is missing entirely."""
    mocker.patch("fetch_data.statsapi.get",
                 return_value=_xstat_response([{}]))  # no 'stat' key
    assert fetch_data.fetch_player_xstats(665489, 2026) == {}


# --- invariant check ------------------------------------------------------

def test_assert_invariants_hitter_missing_xwoba_raises(cfg, mocker):
    """A hitter row without an xwoba field must fire the invariant."""
    from datetime import datetime, timezone
    from freezegun import freeze_time
    valid_output = {
        "division": [{"team": f"T{i}", "team_id": i, "w": 10, "l": 10} for i in range(5)],
        "wild_card": [{"team": f"WC{i}", "team_id": i, "w": 10, "l": 10} for i in range(15)],
        "recent_games": [{"date": "2026-05-27", "result": "W", "score": "5-3"}],
        "team": {"record": {"w": 27, "l": 29}, "runs_scored": 226, "runs_allowed": 230},
        "injuries": [], "other_unavailable": [],
        "team_stats": {
            "hitting": {"ops": {"val": ".750", "rank": 12}},
            "pitching": {"era": {"val": "3.45", "rank": 8}},
        },
        "roster": {
            "hitters": [{"id": 1, "name": "Bo", "ops": ".750"}],  # NO xwoba
            "pitchers": [],
        },
    }
    with freeze_time("2026-05-28T12:00:00", tz_offset=0):
        with pytest.raises(SystemExit):
            fetch_data.assert_invariants(valid_output, cfg)


def test_assert_invariants_hitter_xwoba_dash_placeholder_passes(cfg):
    """The '.---' placeholder satisfies the str-type invariant."""
    from freezegun import freeze_time
    valid_output = {
        "division": [{"team": f"T{i}", "team_id": i, "w": 10, "l": 10} for i in range(5)],
        "wild_card": [{"team": f"WC{i}", "team_id": i, "w": 10, "l": 10} for i in range(15)],
        "recent_games": [{"date": "2026-05-27", "result": "W", "score": "5-3"}],
        "team": {"record": {"w": 27, "l": 29}, "runs_scored": 226, "runs_allowed": 230},
        "injuries": [], "other_unavailable": [],
        "team_stats": {
            "hitting": {"ops": {"val": ".750", "rank": 12}},
            "pitching": {"era": {"val": "3.45", "rank": 8}},
        },
        "roster": {
            # All three placeholder fields present — invariant expects every
            # hitter to carry xwoba + barrel_pct + hardhit_pct as strings.
            "hitters": [{"id": 1, "name": "Bo", "xwoba": ".---",
                          "barrel_pct": "---", "hardhit_pct": "---"}],
            "pitchers": [],
        },
    }
    with freeze_time("2026-05-28T12:00:00", tz_offset=0):
        fetch_data.assert_invariants(valid_output, cfg)
