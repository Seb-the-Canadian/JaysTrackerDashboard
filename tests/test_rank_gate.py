"""Guards for the small-sample rank floor (MIN_AB_FOR_RANK / MIN_IP_FOR_RANK).

The bug: `_value_rank` slots every rostered player into the *qualified*
league distribution, and the playing-time gate was only "> 0". A call-up
with 2 at-bats and a 1.750 OPS therefore ranked 1st of 145 and the pcard
rendered "100th %ile" — the heat bar's loudest possible claim, made on two
swings. Same shape for a reliever with a handful of innings.

`check_data_completeness.py`'s coverage audit could never catch this: it
asserts that players *have* ranks, never that the ranks are meaningful.
Per CLAUDE.md — assert the thing the user sees.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

import fetch_data

ROOT = Path(__file__).resolve().parent.parent


def _player_splits_response(splits, group):
    return {"stats": [{"group": {"displayName": group}, "splits": splits}]}


@pytest.fixture
def cfg():
    return {"team_id": 141, "season": 2026}


@pytest.fixture
def league(mocker):
    """A small but realistic qualified pool for both groups."""
    hitting_splits = [
        {"player": {"id": 1}, "stat": {"ops": ".900", "homeRuns": 30, "rbi": 90, "stolenBases": 20}},
        {"player": {"id": 2}, "stat": {"ops": ".800", "homeRuns": 20, "rbi": 70, "stolenBases": 10}},
        {"player": {"id": 3}, "stat": {"ops": ".700", "homeRuns": 10, "rbi": 40, "stolenBases": 4}},
    ]
    pitching_splits = [
        {"player": {"id": 4}, "stat": {"era": "2.00", "whip": "1.00",
                                       "strikeoutsPer9Inn": "11.0", "walksPer9Inn": "2.0",
                                       "inningsPitched": "120.0"}},
        {"player": {"id": 5}, "stat": {"era": "4.50", "whip": "1.40",
                                       "strikeoutsPer9Inn": "7.0", "walksPer9Inn": "3.5",
                                       "inningsPitched": "110.0"}},
    ]

    def api_dispatch(endpoint, params):
        if endpoint == "stats" and params.get("group") == "hitting":
            return _player_splits_response(hitting_splits, "hitting")
        if endpoint == "stats" and params.get("group") == "pitching":
            return _player_splits_response(pitching_splits, "pitching")
        return {"stats": []}

    mocker.patch("fetch_data.api", side_effect=api_dispatch)


def test_tiny_ab_sample_is_not_ranked(league, cfg):
    """The literal shipped bug: 2 AB, 1.750 OPS must NOT become 100th %ile."""
    roster = {
        "hitters": [{"id": 703520, "name": "Brett Bateman", "ab": 2,
                     "ops": "1.750", "hr": 0, "rbi": 0, "sb": 0}],
        "pitchers": [],
    }
    ranks, _pools = fetch_data.fetch_league_player_rankings(cfg, roster)
    assert ranks["703520"]["ops"] is None, (
        "a 2-AB hitter was ranked against the qualified pool — this is the "
        "'best hitter in baseball off two swings' bug"
    )
    assert all(v is None for v in ranks["703520"].values()), ranks["703520"]


def test_tiny_ip_sample_is_not_ranked(league, cfg):
    roster = {
        "hitters": [],
        "pitchers": [{"id": 999, "name": "Spot Reliever", "ip": "2.1",
                      "era": "0.00", "whip": "0.43", "k_per_9": "15.0",
                      "bb_per_9": "0.00"}],
    }
    ranks, _pools = fetch_data.fetch_league_player_rankings(cfg, roster)
    assert all(v is None for v in ranks["999"].values()), ranks["999"]


@pytest.mark.parametrize("ab,expect_ranked", [
    (fetch_data.MIN_AB_FOR_RANK - 1, False),
    (fetch_data.MIN_AB_FOR_RANK, True),
    (fetch_data.MIN_AB_FOR_RANK + 1, True),
])
def test_ab_floor_boundary(league, cfg, ab, expect_ranked):
    roster = {"hitters": [{"id": 42, "name": "Boundary Bat", "ab": ab,
                           "ops": ".800", "hr": 20, "rbi": 70, "sb": 10}],
              "pitchers": []}
    ranks, _pools = fetch_data.fetch_league_player_rankings(cfg, roster)
    assert (ranks["42"]["ops"] is not None) is expect_ranked


@pytest.mark.parametrize("ip,expect_ranked", [
    ("9.2", False),   # 9⅔ innings — below a 10.0 floor
    ("10.0", True),
    ("64.0", True),
])
def test_ip_floor_boundary(league, cfg, ip, expect_ranked):
    roster = {"hitters": [],
              "pitchers": [{"id": 43, "name": "Boundary Arm", "ip": ip,
                            "era": "3.00", "whip": "1.10", "k_per_9": "9.0",
                            "bb_per_9": "2.5"}]}
    ranks, _pools = fetch_data.fetch_league_player_rankings(cfg, roster)
    assert (ranks["43"]["era"] is not None) is expect_ranked


def test_regulars_are_still_ranked(league, cfg):
    """The floor must not blank out genuine everyday players."""
    roster = {
        "hitters": [{"id": 665489, "name": "Everyday Bat", "ab": 401,
                     "ops": ".800", "hr": 20, "rbi": 70, "sb": 10}],
        "pitchers": [{"id": 656302, "name": "Rotation Arm", "ip": "126.1",
                      "era": "2.00", "whip": "1.00", "k_per_9": "11.0",
                      "bb_per_9": "2.0"}],
    }
    ranks, _pools = fetch_data.fetch_league_player_rankings(cfg, roster)
    assert ranks["665489"]["ops"] is not None
    assert ranks["656302"]["era"] is not None


def test_completeness_checker_shares_the_fetcher_floor():
    """The coverage audit mirrors the fetcher's gate; drift breaks it both ways.

    Too low a floor here and the audit reports a GUARANTEE GAP for every
    legitimately-unranked bench player; too high and it stops noticing real
    rank gaps.
    """
    sys.path.insert(0, str(ROOT / "tools"))
    import check_data_completeness as cdc

    assert cdc.MIN_AB_FOR_RANK == fetch_data.MIN_AB_FOR_RANK
    assert cdc.MIN_IP_FOR_RANK == fetch_data.MIN_IP_FOR_RANK


def test_completeness_checker_is_clean_on_committed_data():
    """The shipped data.json must produce no coverage warnings under the
    new floor — i.e. the gate change didn't turn the audit into noise."""
    proc = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "check_data_completeness.py")],
        capture_output=True, text=True,
    )
    combined = proc.stdout + proc.stderr
    assert "GUARANTEE GAP" not in combined, combined
    assert proc.returncode == 0, combined


def test_completeness_flags_a_rank_below_the_floor():
    """The plausibility check must name a sub-sample ranked player.

    This is the inverse of the coverage audit: coverage asks "does everyone
    who played have a rank?", which is blind to a rank computed off two
    at-bats. The shipped data.json carried exactly that.
    """
    sys.path.insert(0, str(ROOT / "tools"))
    import check_data_completeness as cdc

    data = {
        "roster": {
            "hitters": [
                {"id": 1, "name": "Two Swings", "ab": 2, "ops": "1.750"},
                {"id": 2, "name": "Regular", "ab": 400, "ops": ".800"},
            ],
            "pitchers": [],
        },
        "player_ranks": {"1": {"ops": 1}, "2": {"ops": 60}},
        "player_rank_pool": {"hitting": 145, "pitching": 56},
    }
    warns, _infos = cdc.warn_scan(data)
    hits = [w for w in warns if "SUB-SAMPLE RANK" in w]
    assert hits, warns
    assert "Two Swings" in hits[0]
    assert "Regular" not in hits[0]


def test_completeness_is_quiet_when_the_floor_is_respected():
    sys.path.insert(0, str(ROOT / "tools"))
    import check_data_completeness as cdc

    data = {
        "roster": {
            "hitters": [
                {"id": 1, "name": "Two Swings", "ab": 2, "ops": "1.750"},
                {"id": 2, "name": "Regular", "ab": 400, "ops": ".800"},
            ],
            "pitchers": [],
        },
        # The gate did its job: the 2-AB bat carries no rank.
        "player_ranks": {"1": {"ops": None}, "2": {"ops": 60}},
        "player_rank_pool": {"hitting": 145, "pitching": 56},
    }
    warns, _infos = cdc.warn_scan(data)
    assert not [w for w in warns if "SUB-SAMPLE RANK" in w], warns
    assert not [w for w in warns if "GUARANTEE GAP" in w], warns
