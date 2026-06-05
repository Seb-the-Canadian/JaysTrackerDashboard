"""Tests for transform_roster — the orchestrator that builds the active
26-man roster split into hitters and pitchers.

The function calls:
- is_pitcher(entry) — pure, no mock
- fetch_player_season_stats(pid, group, season) — API; mocked
- _stat_signature(stat, group) — pure, no mock
- derive_recent_form(pid, group, season, rate, stat_signature=) — mocked
  (we trust it via test_derive_recent_form.py)

Tests target the orchestration: how transform_roster maps roster entries
to output rows, what shape each row has, when derive_recent_form gets
called vs skipped (the AB/IP early-return guards), and the regression
guards for #58 (missing `gs` field).
"""
import pytest

import fetch_data


def _hitter_entry(pid: int, name: str, pos: str = "SS") -> dict:
    return {
        "person": {"id": pid, "fullName": name},
        "position": {"abbreviation": pos, "type": "Infielder"},
    }


def _pitcher_entry(pid: int, name: str, pos: str = "P") -> dict:
    return {
        "person": {"id": pid, "fullName": name},
        "position": {"abbreviation": pos, "type": "Pitcher"},
    }


def _hitter_stats(*, ab: int = 100, ops: str = ".750") -> dict:
    return {
        "atBats": ab,
        "avg": ".280",
        "obp": ".340",
        "slg": ".450",
        "ops": ops,
        "homeRuns": 5,
        "rbi": 25,
        "stolenBases": 3,
        "hits": 28,
        "baseOnBalls": 12,
        "totalBases": 45,
    }


def _pitcher_stats(*, ip: str = "40.2", era: str = "3.45", gs: int = 8) -> dict:
    return {
        "inningsPitched": ip,
        "era": era,
        "whip": "1.20",
        "strikeOuts": 45,
        "baseOnBalls": 12,
        "wins": 4,
        "losses": 2,
        "saves": 0,
        "gamesStarted": gs,
        "earnedRuns": 15,
    }


# --- splits into hitters vs pitchers --------------------------------------

def test_transform_roster_mixed_splits_correctly(cfg, mocker):
    entries = [
        _hitter_entry(1, "Bo Bichette"),
        _pitcher_entry(2, "Kevin Gausman"),
        _hitter_entry(3, "Vladimir Guerrero Jr."),
        _pitcher_entry(4, "Patrick Corbin"),
    ]
    mocker.patch("fetch_data.fetch_player_season_stats",
                 side_effect=lambda pid, group, season:
                 _hitter_stats() if group == "hitting" else _pitcher_stats())
    mocker.patch("fetch_data.derive_recent_form", return_value=None)
    result = fetch_data.transform_roster(entries, cfg)
    assert [h["id"] for h in result["hitters"]] == [1, 3]
    assert [p["id"] for p in result["pitchers"]] == [2, 4]


def test_transform_roster_all_hitters_returns_empty_pitchers(cfg, mocker):
    entries = [_hitter_entry(i, f"Hitter{i}") for i in range(1, 4)]
    mocker.patch("fetch_data.fetch_player_season_stats", return_value=_hitter_stats())
    mocker.patch("fetch_data.derive_recent_form", return_value=None)
    result = fetch_data.transform_roster(entries, cfg)
    assert len(result["hitters"]) == 3
    assert result["pitchers"] == []


def test_transform_roster_all_pitchers_returns_empty_hitters(cfg, mocker):
    entries = [_pitcher_entry(i, f"Pitcher{i}") for i in range(1, 4)]
    mocker.patch("fetch_data.fetch_player_season_stats", return_value=_pitcher_stats())
    mocker.patch("fetch_data.derive_recent_form", return_value=None)
    result = fetch_data.transform_roster(entries, cfg)
    assert result["hitters"] == []
    assert len(result["pitchers"]) == 3


def test_transform_roster_pid_zero_is_skipped_falsy_guard(cfg, mocker):
    """Defensive: pid=0 evaluates falsy and gets skipped — confirming the
    'if not pid' guard catches the missing-id case."""
    mocker.patch("fetch_data.fetch_player_season_stats", return_value=_hitter_stats())
    mocker.patch("fetch_data.derive_recent_form", return_value=None)
    entries = [_hitter_entry(0, "Zero ID"), _hitter_entry(1, "Real")]
    result = fetch_data.transform_roster(entries, cfg)
    assert len(result["hitters"]) == 1
    assert result["hitters"][0]["id"] == 1


def test_transform_roster_entry_missing_person_id_is_skipped(cfg, mocker):
    entries = [
        _hitter_entry(1, "Bo Bichette"),
        {"person": {"fullName": "No ID"}, "position": {"abbreviation": "OF"}},
    ]
    mocker.patch("fetch_data.fetch_player_season_stats", return_value=_hitter_stats())
    mocker.patch("fetch_data.derive_recent_form", return_value=None)
    result = fetch_data.transform_roster(entries, cfg)
    assert len(result["hitters"]) == 1
    assert result["hitters"][0]["id"] == 1


# --- hitter row shape -----------------------------------------------------

def test_transform_roster_hitter_row_has_all_fields(cfg, mocker, mock_player_xstats, mock_savant_barrels):
    mocker.patch("fetch_data.fetch_player_season_stats", return_value=_hitter_stats())
    mocker.patch("fetch_data.derive_recent_form", return_value="hot")
    mock_player_xstats.return_value = {"xWoba": ".385"}
    mock_savant_barrels.return_value = {
        665489: {"barrel_pct": "12.3%", "hardhit_pct": "52.1%"},
    }
    result = fetch_data.transform_roster(
        [_hitter_entry(665489, "Vladimir Guerrero Jr.", pos="1B")], cfg)
    h = result["hitters"][0]
    assert h["id"] == 665489
    assert h["name"] == "Vladimir Guerrero Jr."
    assert h["pos"] == "1B"
    assert h["ab"] == 100
    assert h["ops"] == ".750"
    assert h["xwoba"] == ".385"
    assert h["barrel_pct"] == "12.3%"
    assert h["hardhit_pct"] == "52.1%"
    assert h["hr"] == 5
    assert h["rbi"] == 25
    assert h["sb"] == 3
    assert h["recent"] == "hot"


def test_transform_roster_hitter_carries_xwoba_from_woba_key(cfg, mocker, mock_player_xstats, mock_savant_barrels):
    """#117 regression guard: under type=expectedStatistics the API returns
    the xwOBA value under the key `woba` (the type already carries the
    "expected" meaning, so the 'x' prefix is dropped). The caller's lookup
    must read `woba` as the canonical key; `xWoba`/`xwoba` are kept as
    backwards-compat fallbacks but were the ONLY keys checked pre-fix —
    which is why every hitter's xwoba shipped as '.---' in production."""
    mocker.patch("fetch_data.fetch_player_season_stats", return_value=_hitter_stats())
    mocker.patch("fetch_data.derive_recent_form", return_value=None)
    mock_player_xstats.return_value = {
        "avg": ".210", "slg": ".298", "woba": ".252", "wobaCon": ".276",
    }
    mock_savant_barrels.return_value = {}
    result = fetch_data.transform_roster(
        [_hitter_entry(665489, "Vladimir Guerrero Jr.", pos="1B")], cfg)
    assert result["hitters"][0]["xwoba"] == ".252"


def test_transform_roster_hitter_xwoba_dash_when_xstats_empty(cfg, mocker):
    """Empty xstats (network fail, pre-Opening-Day) → '.---' placeholder."""
    mocker.patch("fetch_data.fetch_player_season_stats", return_value=_hitter_stats())
    mocker.patch("fetch_data.derive_recent_form", return_value=None)
    # Autouse mock_player_xstats already returns {}
    result = fetch_data.transform_roster([_hitter_entry(1, "Test")], cfg)
    assert result["hitters"][0]["xwoba"] == ".---"


def test_transform_roster_hitter_barrel_hardhit_dash_when_savant_empty(cfg, mocker):
    """Empty barrels map (Savant fetch failed) → '---' placeholders."""
    mocker.patch("fetch_data.fetch_player_season_stats", return_value=_hitter_stats())
    mocker.patch("fetch_data.derive_recent_form", return_value=None)
    # Autouse mock_savant_barrels already returns {}
    result = fetch_data.transform_roster([_hitter_entry(1, "Test")], cfg)
    h = result["hitters"][0]
    assert h["barrel_pct"] == "---"
    assert h["hardhit_pct"] == "---"


def test_transform_roster_hitter_barrel_hardhit_from_savant(cfg, mocker, mock_savant_barrels):
    """When Savant returns data for the player, fields populate."""
    mocker.patch("fetch_data.fetch_player_season_stats", return_value=_hitter_stats())
    mocker.patch("fetch_data.derive_recent_form", return_value=None)
    mock_savant_barrels.return_value = {
        665489: {"barrel_pct": "12.3%", "hardhit_pct": "52.1%"},
    }
    result = fetch_data.transform_roster(
        [_hitter_entry(665489, "Vlad")], cfg)
    h = result["hitters"][0]
    assert h["barrel_pct"] == "12.3%"
    assert h["hardhit_pct"] == "52.1%"


def test_transform_roster_savant_fetched_once_per_run(cfg, mocker, mock_savant_barrels):
    """The whole-team CSV is fetched ONCE per refresh, not per player."""
    mocker.patch("fetch_data.fetch_player_season_stats", return_value=_hitter_stats())
    mocker.patch("fetch_data.derive_recent_form", return_value=None)
    entries = [_hitter_entry(i, f"H{i}") for i in range(1, 6)]
    fetch_data.transform_roster(entries, cfg)
    assert mock_savant_barrels.call_count == 1


def test_transform_roster_hitter_xstats_skipped_for_zero_at_bats(cfg, mocker, mock_player_xstats):
    """No ABs → don't even call fetch_player_xstats; ship '.---'."""
    mocker.patch("fetch_data.fetch_player_season_stats",
                 return_value={**_hitter_stats(), "atBats": 0})
    mocker.patch("fetch_data.derive_recent_form", return_value=None)
    result = fetch_data.transform_roster([_hitter_entry(1, "BenchWarmer")], cfg)
    assert result["hitters"][0]["xwoba"] == ".---"
    mock_player_xstats.assert_not_called()


def test_transform_roster_hitter_missing_stats_uses_dash_defaults(cfg, mocker):
    """A player with no season stat dict at all gets dash-formatted defaults."""
    mocker.patch("fetch_data.fetch_player_season_stats", return_value={})
    mocker.patch("fetch_data.derive_recent_form", return_value=None)
    result = fetch_data.transform_roster([_hitter_entry(1, "No Stats")], cfg)
    h = result["hitters"][0]
    assert h["avg"] == ".---"
    assert h["ops"] == ".---"
    assert h["ab"] == 0
    assert h["recent"] is None  # zero AB skips derive_recent_form


# --- pitcher row shape ----------------------------------------------------

def test_transform_roster_pitcher_row_has_all_fields(cfg, mocker):
    mocker.patch("fetch_data.fetch_player_season_stats", return_value=_pitcher_stats())
    mocker.patch("fetch_data.derive_recent_form", return_value="cold")
    result = fetch_data.transform_roster(
        [_pitcher_entry(594798, "Kevin Gausman")], cfg)
    p = result["pitchers"][0]
    assert p["id"] == 594798
    assert p["name"] == "Kevin Gausman"
    assert p["role"] == "P"
    assert p["ip"] == "40.2"
    assert p["era"] == "3.45"
    assert p["whip"] == "1.20"
    assert p["k"] == 45
    assert p["w"] == 4
    assert p["l"] == 2
    assert p["sv"] == 0
    assert p["gs"] == 8  # REGRESSION GUARD for #58
    assert p["recent"] == "cold"


def test_transform_roster_pitcher_gs_field_present_for_relief(cfg, mocker):
    """Even relievers (gs=0) must have the gs field — index.html branches on it."""
    mocker.patch("fetch_data.fetch_player_season_stats",
                 return_value=_pitcher_stats(gs=0))
    mocker.patch("fetch_data.derive_recent_form", return_value=None)
    result = fetch_data.transform_roster(
        [_pitcher_entry(1, "Reliever")], cfg)
    p = result["pitchers"][0]
    assert "gs" in p
    assert p["gs"] == 0


def test_transform_roster_pitcher_missing_stats_uses_dash_defaults(cfg, mocker):
    mocker.patch("fetch_data.fetch_player_season_stats", return_value={})
    mocker.patch("fetch_data.derive_recent_form", return_value=None)
    result = fetch_data.transform_roster([_pitcher_entry(1, "No Stats")], cfg)
    p = result["pitchers"][0]
    assert p["era"] == "-.--"
    assert p["whip"] == "-.--"
    assert p["ip"] == "0.0"
    assert p["gs"] == 0
    assert p["recent"] is None


# --- derive_recent_form skip / call paths --------------------------------

def test_transform_roster_zero_ab_skips_derive_recent_form_call(cfg, mocker):
    """Player with 0 ABs → derive_recent_form NOT called (no window possible)."""
    mocker.patch("fetch_data.fetch_player_season_stats",
                 return_value={**_hitter_stats(), "atBats": 0})
    derive_spy = mocker.patch("fetch_data.derive_recent_form", return_value="hot")
    fetch_data.transform_roster([_hitter_entry(1, "Bench Warmer")], cfg)
    derive_spy.assert_not_called()


def test_transform_roster_zero_ip_skips_derive_recent_form_call(cfg, mocker):
    """Pitcher with 0.0 IP → derive_recent_form NOT called."""
    mocker.patch("fetch_data.fetch_player_season_stats",
                 return_value={**_pitcher_stats(), "inningsPitched": "0.0"})
    derive_spy = mocker.patch("fetch_data.derive_recent_form", return_value="hot")
    fetch_data.transform_roster([_pitcher_entry(1, "Unused")], cfg)
    derive_spy.assert_not_called()


def test_transform_roster_derive_recent_form_called_with_signature(cfg, mocker):
    """When called, derive_recent_form must receive a stat_signature so the
    cache layer can decide hit/miss."""
    mocker.patch("fetch_data.fetch_player_season_stats", return_value=_hitter_stats())
    derive_spy = mocker.patch("fetch_data.derive_recent_form", return_value="hot")
    fetch_data.transform_roster([_hitter_entry(1, "Bo")], cfg)
    derive_spy.assert_called_once()
    call_kwargs = derive_spy.call_args.kwargs
    assert "stat_signature" in call_kwargs
    assert call_kwargs["stat_signature"]  # non-empty


def test_transform_roster_derive_recent_form_exception_caught_logs_warning(cfg, mocker, capsys):
    """An exception in derive_recent_form must not crash the roster transform."""
    mocker.patch("fetch_data.fetch_player_season_stats", return_value=_hitter_stats())
    mocker.patch("fetch_data.derive_recent_form", side_effect=RuntimeError("boom"))
    result = fetch_data.transform_roster([_hitter_entry(1, "Bo")], cfg)
    assert result["hitters"][0]["recent"] is None
    assert "derive_recent_form for hitter 1 failed" in capsys.readouterr().err


def test_transform_roster_correct_group_routed_per_player_type(cfg, mocker):
    """Hitters call fetch_player_season_stats with group='hitting';
    pitchers with 'pitching'."""
    calls = []
    def stub(pid, group, season):
        calls.append((pid, group))
        return _hitter_stats() if group == "hitting" else _pitcher_stats()
    mocker.patch("fetch_data.fetch_player_season_stats", side_effect=stub)
    mocker.patch("fetch_data.derive_recent_form", return_value=None)
    entries = [
        _hitter_entry(1, "H1"),
        _pitcher_entry(2, "P1"),
    ]
    fetch_data.transform_roster(entries, cfg)
    assert (1, "hitting") in calls
    assert (2, "pitching") in calls


# --- is_pitcher edge cases (used by the splits-mixed test, also direct) --

def test_is_pitcher_position_p_returns_true():
    assert fetch_data.is_pitcher({"position": {"abbreviation": "P"}}) is True


def test_is_pitcher_position_sp_returns_true():
    assert fetch_data.is_pitcher({"position": {"abbreviation": "SP"}}) is True


def test_is_pitcher_position_rp_returns_true():
    assert fetch_data.is_pitcher({"position": {"abbreviation": "RP"}}) is True


def test_is_pitcher_position_type_pitcher_returns_true():
    """Some entries set type=Pitcher without an abbreviation."""
    assert fetch_data.is_pitcher({"position": {"type": "Pitcher"}}) is True


def test_is_pitcher_position_ss_returns_false():
    assert fetch_data.is_pitcher({"position": {"abbreviation": "SS"}}) is False


def test_is_pitcher_missing_position_returns_false():
    assert fetch_data.is_pitcher({}) is False
