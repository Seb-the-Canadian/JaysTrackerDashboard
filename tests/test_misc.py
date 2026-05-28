"""Tests for the remaining pure functions not covered elsewhere:
- run_diff_last_10
- combine_team_stats
- _wild_card_row
- fetch_wild_card (with mocked api)
"""
import pytest

import fetch_data


# --- run_diff_last_10 -----------------------------------------------------

def test_run_diff_last_10_empty_returns_empty():
    assert fetch_data.run_diff_last_10([]) == []


def test_run_diff_last_10_filters_to_finals_only():
    games = [
        {"date": "2026-05-25", "result": "W", "us_score": 5, "them_score": 3},
        {"date": "2026-05-26", "result": "", "us_score": 0, "them_score": 0},
        {"date": "2026-05-27", "result": "L", "us_score": 2, "them_score": 7},
    ]
    result = fetch_data.run_diff_last_10(games)
    assert len(result) == 2
    assert result[0]["date"] == "2026-05-25"
    assert result[1]["date"] == "2026-05-27"


def test_run_diff_last_10_diff_is_signed():
    """Wins get positive diff; losses negative."""
    games = [
        {"date": "2026-05-25", "result": "W", "us_score": 8, "them_score": 1},
        {"date": "2026-05-26", "result": "L", "us_score": 1, "them_score": 4},
    ]
    result = fetch_data.run_diff_last_10(games)
    assert result[0]["diff"] == 7   # win
    assert result[1]["diff"] == -3  # loss


def test_run_diff_last_10_takes_only_last_ten():
    """If 15 Finals, only the most recent 10 returned."""
    games = [
        {"date": f"2026-05-{d:02d}", "result": "W", "us_score": 1, "them_score": 0}
        for d in range(1, 16)
    ]
    result = fetch_data.run_diff_last_10(games)
    assert len(result) == 10
    # Should be the trailing slice (May 6 onward)
    assert result[0]["date"] == "2026-05-06"


# --- combine_team_stats ---------------------------------------------------

def test_combine_team_stats_merges_val_and_rank():
    values = {
        "hitting": {"ops": ".750", "obp": ".320"},
        "pitching": {"era": "3.45"},
    }
    ranks = {
        "hitting": {"ops": 12, "obp": 18},
        "pitching": {"era": 8},
    }
    result = fetch_data.combine_team_stats(values, ranks)
    assert result["hitting"]["ops"] == {"val": ".750", "rank": 12}
    assert result["hitting"]["obp"] == {"val": ".320", "rank": 18}
    assert result["pitching"]["era"] == {"val": "3.45", "rank": 8}


def test_combine_team_stats_value_without_rank_returns_null_rank():
    values = {"hitting": {"ops": ".750"}, "pitching": {}}
    ranks = {"hitting": {}, "pitching": {}}
    result = fetch_data.combine_team_stats(values, ranks)
    assert result["hitting"]["ops"] == {"val": ".750", "rank": None}


def test_combine_team_stats_rank_without_value_returns_null_val():
    values = {"hitting": {}, "pitching": {}}
    ranks = {"hitting": {"ops": 12}, "pitching": {}}
    result = fetch_data.combine_team_stats(values, ranks)
    assert result["hitting"]["ops"] == {"val": None, "rank": 12}


def test_combine_team_stats_empty_inputs_returns_empty_groups():
    result = fetch_data.combine_team_stats({}, {})
    assert result == {"hitting": {}, "pitching": {}}


def test_combine_team_stats_always_emits_both_groups():
    """Even if one group is absent in inputs, output has both keys."""
    result = fetch_data.combine_team_stats({"hitting": {"ops": ".750"}}, {})
    assert "hitting" in result
    assert "pitching" in result
    assert result["pitching"] == {}


# --- _wild_card_row --------------------------------------------------------

def test_wild_card_row_marks_our_team(cfg):
    tr = {"team": {"id": 141, "name": "Toronto Blue Jays"},
          "wins": 27, "losses": 29}
    row = fetch_data._wild_card_row(tr, {141: "Toronto Blue Jays"}, cfg)
    assert row["is_us"] is True
    assert row["team_id"] == 141


def test_wild_card_row_marks_others_not_us(cfg):
    tr = {"team": {"id": 110, "name": "Baltimore Orioles"},
          "wins": 26, "losses": 30}
    row = fetch_data._wild_card_row(tr, {}, cfg)
    assert row["is_us"] is False


def test_wild_card_row_uses_team_names_lookup(cfg):
    tr = {"team": {"id": 110, "name": "Baltimore Orioles"},
          "wins": 26, "losses": 30}
    row = fetch_data._wild_card_row(tr, {110: "Custom Name"}, cfg)
    assert row["team"] == "Custom Name"


# --- fetch_wild_card ------------------------------------------------------

def _league_standings(records: list) -> dict:
    """Build a /standings response with N division records."""
    return {"records": records}


def _div_record(teams: list) -> dict:
    """Build one division record. Each team is (id, name, wins, losses)."""
    return {
        "teamRecords": [
            {"team": {"id": tid, "name": name}, "wins": w, "losses": l}
            for (tid, name, w, l) in teams
        ],
    }


def test_fetch_wild_card_returns_15_teams_for_three_divisions(cfg, mocker):
    """All 15 teams across 3 divisions should appear."""
    standings = _league_standings([
        _div_record([(1, f"E{i}", 30 - i, 20 + i) for i in range(5)]),
        _div_record([(10 + i, f"C{i}", 28 - i, 22 + i) for i in range(5)]),
        _div_record([(20 + i, f"W{i}", 26 - i, 24 + i) for i in range(5)]),
    ])
    mocker.patch("fetch_data.api", return_value=standings)
    result = fetch_data.fetch_wild_card(cfg)
    assert len(result) == 15


def test_fetch_wild_card_identifies_three_division_leaders(cfg, mocker):
    standings = _league_standings([
        _div_record([(1, "Leader1", 40, 10)] + [(i + 1, f"E{i}", 25, 25) for i in range(1, 5)]),
        _div_record([(10, "Leader2", 38, 12)] + [(10 + i, f"C{i}", 22, 28) for i in range(1, 5)]),
        _div_record([(20, "Leader3", 35, 15)] + [(20 + i, f"W{i}", 20, 30) for i in range(1, 5)]),
    ])
    mocker.patch("fetch_data.api", return_value=standings)
    result = fetch_data.fetch_wild_card(cfg)
    leaders = [r for r in result if r["note"] == "Division leader"]
    assert len(leaders) == 3
    assert all(r["gb"] == "-" for r in leaders)


def test_fetch_wild_card_identifies_three_wc_seeds(cfg, mocker):
    standings = _league_standings([
        _div_record([(1, "Leader1", 40, 10), (2, "Chase1", 35, 15),
                      (3, "Chase2", 30, 20), (4, "Out1", 20, 30), (5, "Out2", 15, 35)]),
        _div_record([(10, "Leader2", 38, 12), (11, "Chase3", 33, 17),
                      (12, "Out3", 22, 28), (13, "Out4", 18, 32), (14, "Out5", 12, 38)]),
        _div_record([(20, "Leader3", 36, 14), (21, "Chase4", 31, 19),
                      (22, "Out6", 19, 31), (23, "Out7", 14, 36), (24, "Out8", 10, 40)]),
    ])
    mocker.patch("fetch_data.api", return_value=standings)
    result = fetch_data.fetch_wild_card(cfg)
    in_seeds = [r for r in result if r["note"].startswith("In (")]
    assert len(in_seeds) == 3
    # Ordered 1st, 2nd, 3rd
    notes = [r["note"] for r in in_seeds]
    assert "In (1st WC seed)" in notes
    assert "In (2nd WC seed)" in notes
    assert "In (3rd WC seed)" in notes


def test_fetch_wild_card_out_teams_show_games_back_not_dash(cfg, mocker):
    """Tied-with-cutoff teams get '0.0', not '-' (regression for #61.B).
    Cutoff = WC3 (4th-best non-leader by pct). Constructed so the chasers
    sort to 35-15, 33-17, 31-19 (the WC3 cutoff), and another team is
    tied at 31-19 but lands "Out"."""
    standings = _league_standings([
        _div_record([(1, "Leader1", 40, 10), (2, "Chase1", 35, 15),
                      (3, "TiedOut", 31, 19),  # tied with WC3 (also 31-19)
                      (4, "Out1", 25, 25), (5, "Out2", 15, 35)]),
        _div_record([(10, "Leader2", 38, 12), (11, "Chase3", 33, 17),
                      (12, "Out", 22, 28), (13, "Out", 18, 32), (14, "Out", 12, 38)]),
        _div_record([(20, "Leader3", 36, 14), (21, "Chase4", 31, 19),
                      (22, "Out", 19, 31), (23, "Out", 14, 36), (24, "Out", 10, 40)]),
    ])
    mocker.patch("fetch_data.api", return_value=standings)
    result = fetch_data.fetch_wild_card(cfg)
    tied_out = [r for r in result if r["team"] == "TiedOut"]
    assert len(tied_out) == 1
    # TiedOut and Chase4 both 31-19 — one becomes WC3 seed, other lands "Out"
    # depending on sort tiebreaker (-w as secondary). Either result is valid;
    # the key assertion: if "Out", gb shows "0.0" not "-".
    if tied_out[0]["note"] == "Out":
        assert tied_out[0]["gb"] == "0.0"
    else:
        # If TiedOut won the tiebreaker and became WC3, this test doesn't
        # exercise the bug. Find Chase4 instead.
        chase4 = [r for r in result if r["team"] == "Chase4"][0]
        assert chase4["note"] == "Out"
        assert chase4["gb"] == "0.0"


def test_fetch_wild_card_orders_division_leaders_first(cfg, mocker):
    standings = _league_standings([
        _div_record([(1, "Leader1", 40, 10)] + [(i + 1, f"E{i}", 25, 25) for i in range(1, 5)]),
        _div_record([(10, "Leader2", 38, 12)] + [(10 + i, f"C{i}", 22, 28) for i in range(1, 5)]),
        _div_record([(20, "Leader3", 35, 15)] + [(20 + i, f"W{i}", 20, 30) for i in range(1, 5)]),
    ])
    mocker.patch("fetch_data.api", return_value=standings)
    result = fetch_data.fetch_wild_card(cfg)
    # First 3 entries are division leaders
    assert all(r["note"] == "Division leader" for r in result[:3])
