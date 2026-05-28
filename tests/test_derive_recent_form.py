"""Tests for derive_recent_form — the function behind the hot/cold/new pill.

derive_recent_form orchestrates _fetch_game_log + _split_date +
_aggregate_X_form to produce a single tag string. Tests here mock
_fetch_game_log (the API boundary) and exercise the classification logic.

Three classification branches plus the early-return paths:
- "new": player has been in MLB for < NEW_DAYS_THRESHOLD (14) days this season
- "hot": recent rate beats season rate by HOT delta
- "cold": recent rate trails season rate by COLD delta
- None: between thresholds, too few games, no AB/IP, or API failure
"""
from datetime import datetime, timezone

import pytest
from freezegun import freeze_time

import fetch_data


def _split(date: str, **stat) -> dict:
    """Build a gameLog split with date + stat."""
    return {"date": date, "stat": stat}


def _seven_splits(stat: dict, *, first: str = "2026-04-10",
                  last: str = "2026-05-25") -> list:
    """Seven splits spanning more than 14 days, so the "new" early-return
    in derive_recent_form doesn't fire and we test the classify path."""
    return [
        {"date": first, "stat": dict(stat)},
        {"date": "2026-04-20", "stat": dict(stat)},
        {"date": "2026-04-30", "stat": dict(stat)},
        {"date": "2026-05-05", "stat": dict(stat)},
        {"date": "2026-05-12", "stat": dict(stat)},
        {"date": "2026-05-19", "stat": dict(stat)},
        {"date": last, "stat": dict(stat)},
    ]


# --- empty-splits paths ---------------------------------------------------

def test_derive_recent_form_empty_splits_returns_none(mocker):
    mocker.patch("fetch_data._fetch_game_log", return_value=[])
    assert fetch_data.derive_recent_form(123, "hitting", 2026, ".800") is None


def test_derive_recent_form_none_splits_returns_none(mocker):
    """API helper returned no list (could mean error case)."""
    mocker.patch("fetch_data._fetch_game_log", return_value=None)
    assert fetch_data.derive_recent_form(123, "hitting", 2026, ".800") is None


# --- "new" detection ------------------------------------------------------

@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_derive_recent_form_new_player_returns_new(mocker):
    """First game ≤ 14 days ago → "new" regardless of stats."""
    splits = [_split("2026-05-20", atBats=10, hits=4)] * 7  # plenty of games but all recent
    mocker.patch("fetch_data._fetch_game_log", return_value=splits)
    assert fetch_data.derive_recent_form(123, "hitting", 2026, ".800") == "new"


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_derive_recent_form_established_player_not_new(mocker):
    """First game > 14 days ago → not "new" (falls into hot/cold/None classify)."""
    splits = _seven_splits({"atBats": 4, "hits": 1})
    mocker.patch("fetch_data._fetch_game_log", return_value=splits)
    result = fetch_data.derive_recent_form(123, "hitting", 2026, ".600")
    assert result != "new"  # could be hot/cold/None depending on math


# --- insufficient-window path ---------------------------------------------

@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_derive_recent_form_fewer_than_seven_games_returns_none(mocker):
    """Need 7 games for the rate calc; fewer returns None (not new since old debut)."""
    splits = [_split("2026-04-01", atBats=4, hits=2) for _ in range(5)]
    mocker.patch("fetch_data._fetch_game_log", return_value=splits)
    assert fetch_data.derive_recent_form(123, "hitting", 2026, ".800") is None


# --- malformed-season-rate path -------------------------------------------

@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_derive_recent_form_unparseable_season_rate_returns_none(mocker):
    splits = _seven_splits({"atBats": 4, "hits": 2})
    mocker.patch("fetch_data._fetch_game_log", return_value=splits)
    assert fetch_data.derive_recent_form(123, "hitting", 2026, "-.--") is None
    assert fetch_data.derive_recent_form(123, "hitting", 2026, None) is None


# --- hitting: hot/cold classification -------------------------------------

@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_derive_recent_form_hitter_window_well_above_season_returns_hot(mocker):
    """Recent OPS very high, season OPS .600 → hot (HOT_OPS_DELTA=0.1)."""
    splits = _seven_splits({
        "atBats": 10, "hits": 6, "doubles": 2, "homeRuns": 2,
        "baseOnBalls": 3, "totalBases": 18,
    })
    mocker.patch("fetch_data._fetch_game_log", return_value=splits)
    assert fetch_data.derive_recent_form(123, "hitting", 2026, ".600") == "hot"


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_derive_recent_form_hitter_window_well_below_season_returns_cold(mocker):
    """Recent OPS very low vs high season → cold."""
    splits = _seven_splits({"atBats": 10, "hits": 1, "baseOnBalls": 0, "totalBases": 1})
    mocker.patch("fetch_data._fetch_game_log", return_value=splits)
    assert fetch_data.derive_recent_form(123, "hitting", 2026, ".900") == "cold"


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_derive_recent_form_hitter_window_matches_season_returns_none(mocker):
    """Recent rate within ±0.1 of season → no tag."""
    splits = _seven_splits({"atBats": 4, "hits": 1, "baseOnBalls": 1, "totalBases": 2})
    # OBP = (1+1)/(4+1) = 0.4; SLG = 2/4 = 0.5; OPS = 0.9
    mocker.patch("fetch_data._fetch_game_log", return_value=splits)
    assert fetch_data.derive_recent_form(123, "hitting", 2026, ".850") is None


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_derive_recent_form_hitter_zero_ab_window_returns_none(mocker):
    """Window has games but no ABs (all walks or sub appearances) → aggregator
    returns None → tag is None."""
    splits = _seven_splits({"atBats": 0, "hits": 0})
    mocker.patch("fetch_data._fetch_game_log", return_value=splits)
    assert fetch_data.derive_recent_form(123, "hitting", 2026, ".800") is None


# --- pitching: hot/cold classification ------------------------------------

@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_derive_recent_form_pitcher_recent_era_below_season_returns_hot(mocker):
    """Recent ERA 0.00 (no earned runs), season 4.50 → hot."""
    splits = _seven_splits({"earnedRuns": 0, "inningsPitched": "3.0"})
    mocker.patch("fetch_data._fetch_game_log", return_value=splits)
    assert fetch_data.derive_recent_form(123, "pitching", 2026, "4.50") == "hot"


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_derive_recent_form_pitcher_recent_era_above_season_returns_cold(mocker):
    """Recent ERA 9.00, season 3.00 → cold."""
    splits = _seven_splits({"earnedRuns": 3, "inningsPitched": "3.0"})
    mocker.patch("fetch_data._fetch_game_log", return_value=splits)
    assert fetch_data.derive_recent_form(123, "pitching", 2026, "3.00") == "cold"


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_derive_recent_form_pitcher_recent_matches_season_returns_none(mocker):
    """Recent ERA equal to season → no tag."""
    splits = _seven_splits({"earnedRuns": 1, "inningsPitched": "3.0"})
    # ERA = 1*9/3 = 3.00 — same as season
    mocker.patch("fetch_data._fetch_game_log", return_value=splits)
    assert fetch_data.derive_recent_form(123, "pitching", 2026, "3.00") is None


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_derive_recent_form_pitcher_zero_ip_window_returns_none(mocker):
    splits = _seven_splits({"earnedRuns": 0, "inningsPitched": "0.0"})
    mocker.patch("fetch_data._fetch_game_log", return_value=splits)
    assert fetch_data.derive_recent_form(123, "pitching", 2026, "3.50") is None


# --- signature pass-through ------------------------------------------------

def test_derive_recent_form_forwards_stat_signature_to_fetch_layer(mocker):
    """Caller passes a signature; derive_recent_form must forward it so the
    cache layer can decide hit/miss."""
    fetch_mock = mocker.patch("fetch_data._fetch_game_log", return_value=[])
    fetch_data.derive_recent_form(123, "hitting", 2026, ".800",
                                  stat_signature="atBats=42|hits=14")
    fetch_mock.assert_called_once_with(
        123, "hitting", 2026, stat_signature="atBats=42|hits=14"
    )
