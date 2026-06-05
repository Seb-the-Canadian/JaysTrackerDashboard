"""Tests for the Baseball Savant CSV fetcher + transform integration.

urllib.request.urlopen and csv.DictReader are mocked at their import
points in fetch_data. No real network calls.

Issue #29 Phase B PR 3.
"""
import io
import urllib.error
from unittest.mock import MagicMock

import pytest

import fetch_data


# Capture the real function before conftest's autouse mock replaces it
# per-test. Restored inside this file so we exercise the real
# fetch_savant_barrels with urlopen mocked at the boundary.
_REAL_FETCH_SAVANT_BARRELS = fetch_data.fetch_savant_barrels


@pytest.fixture(autouse=True)
def restore_real_savant_barrels(mocker):
    """Override conftest's autouse mock for this file's tests."""
    mocker.patch("fetch_data.fetch_savant_barrels", _REAL_FETCH_SAVANT_BARRELS)
    yield


# --- CSV fixtures ----------------------------------------------------------

_BARRELS_CSV = b"""player_id,name,barrels_per_pa_percent,ev95percent
665489,Vladimir Guerrero Jr.,12.3,52.1
665926,Bo Bichette,3.4,38.2
"""

_BARRELS_CSV_ALT_COLS = b"""player_id,name,brl_percent,hardhit_percent
111,Player One,8.0,44.5
"""


def _urlopen_returning(body: bytes):
    """Build a context-manager that mocks urllib.request.urlopen response."""
    cm = MagicMock()
    cm.read.return_value = body
    cm.__enter__ = lambda self: cm
    cm.__exit__ = lambda self, *exc: False
    return cm


# --- fetch_savant_team_csv -------------------------------------------------

def test_fetch_savant_team_csv_returns_parsed_rows(mocker):
    mocker.patch("fetch_data.urllib.request.urlopen",
                 return_value=_urlopen_returning(_BARRELS_CSV))
    rows = fetch_data.fetch_savant_team_csv("statcast",
                                            {"year": 2026, "team": "TOR"})
    assert len(rows) == 2
    assert rows[0]["player_id"] == "665489"
    assert rows[0]["barrels_per_pa_percent"] == "12.3"


def test_fetch_savant_team_csv_sets_user_agent(mocker):
    """Identifies our scraper to MLB's access logs."""
    spy = mocker.patch("fetch_data.urllib.request.urlopen",
                       return_value=_urlopen_returning(_BARRELS_CSV))
    fetch_data.fetch_savant_team_csv("statcast", {"year": 2026})
    req_arg = spy.call_args.args[0]
    assert req_arg.headers["User-agent"].startswith("JaysTrackerDashboard/")


def test_fetch_savant_team_csv_includes_csv_true_in_query(mocker):
    spy = mocker.patch("fetch_data.urllib.request.urlopen",
                       return_value=_urlopen_returning(_BARRELS_CSV))
    fetch_data.fetch_savant_team_csv("statcast", {"year": 2026, "team": "TOR"})
    url = spy.call_args.args[0].full_url
    assert "csv=true" in url
    assert "year=2026" in url
    assert "team=TOR" in url


def test_fetch_savant_team_csv_http_error_returns_empty_logs(mocker, capsys):
    """403 Cloudflare bot gate — log warning, return empty, no `die`."""
    mocker.patch("fetch_data.urllib.request.urlopen",
                 side_effect=urllib.error.HTTPError(
                     "url", 403, "Forbidden", {}, None))
    assert fetch_data.fetch_savant_team_csv("statcast", {}) == []
    assert "savant statcast fetch failed" in capsys.readouterr().err


def test_fetch_savant_team_csv_strips_utf8_bom(mocker):
    """#29 regression: Savant's CSV ships with a UTF-8 BOM (\\ufeff). Decoded
    as plain utf-8, the BOM blocks DictReader from recognizing the opening
    quote of `"last_name, first_name"` — the embedded comma then splits one
    field into two and every column shifts by one, so `player_id` carries
    the wrong value and the MLBAM roster join matches zero. utf-8-sig
    strips the BOM so the header parses correctly."""
    # \xef\xbb\xbf is the UTF-8 BOM; the quoted first field mirrors what
    # Savant actually sends. If decoded as plain utf-8, DictReader would
    # produce keys like '﻿"last_name' / ' first_name"' and shift the
    # data; utf-8-sig handles it cleanly.
    bom_csv = (b'\xef\xbb\xbf"last_name, first_name",player_id,brl_percent\n'
               b'"Clement, Ernie",676391,2.5\n')
    mocker.patch("fetch_data.urllib.request.urlopen",
                 return_value=_urlopen_returning(bom_csv))
    rows = fetch_data.fetch_savant_team_csv("statcast", {})
    assert len(rows) == 1
    # The actual MLBAM id must land in player_id — the regression signature
    # was player_id='2.5' (or similar shifted value) when BOM wasn't stripped.
    assert rows[0]["player_id"] == "676391"
    assert rows[0]["brl_percent"] == "2.5"
    # And the quoted "Last, First" stays a single field.
    assert rows[0]["last_name, first_name"] == "Clement, Ernie"


def test_fetch_savant_team_csv_timeout_returns_empty(mocker, capsys):
    mocker.patch("fetch_data.urllib.request.urlopen",
                 side_effect=urllib.error.URLError("timed out"))
    assert fetch_data.fetch_savant_team_csv("statcast", {}) == []
    assert "savant statcast fetch failed" in capsys.readouterr().err


def test_fetch_savant_team_csv_unexpected_error_returns_empty(mocker, capsys):
    mocker.patch("fetch_data.urllib.request.urlopen",
                 side_effect=RuntimeError("connection reset"))
    assert fetch_data.fetch_savant_team_csv("statcast", {}) == []
    assert "savant statcast unexpected error" in capsys.readouterr().err


def test_fetch_savant_team_csv_malformed_body_returns_empty(mocker, capsys):
    """Server returned non-CSV (e.g., HTML error page) — graceful."""
    # csv.DictReader is forgiving — it won't raise on most malformed input.
    # Force the error by mocking csv.reader to raise.
    mocker.patch("fetch_data.urllib.request.urlopen",
                 return_value=_urlopen_returning(b"some,malformed"))
    mocker.patch("fetch_data.csv.DictReader",
                 side_effect=__import__("csv").Error("bad CSV"))
    assert fetch_data.fetch_savant_team_csv("statcast", {}) == []
    assert "CSV parse failed" in capsys.readouterr().err


# --- fetch_savant_barrels --------------------------------------------------

def test_fetch_savant_barrels_returns_pid_keyed_dict(mocker):
    mocker.patch("fetch_data.urllib.request.urlopen",
                 return_value=_urlopen_returning(_BARRELS_CSV))
    out = fetch_data.fetch_savant_barrels("TOR", 2026)
    assert set(out.keys()) == {665489, 665926}
    assert out[665489]["barrel_pct"] == "12.3%"
    assert out[665489]["hardhit_pct"] == "52.1%"


def test_fetch_savant_barrels_handles_alternate_column_names(mocker):
    """Savant rotates column names across seasons — defensive lookup."""
    mocker.patch("fetch_data.urllib.request.urlopen",
                 return_value=_urlopen_returning(_BARRELS_CSV_ALT_COLS))
    out = fetch_data.fetch_savant_barrels("TOR", 2026)
    assert out[111]["barrel_pct"] == "8.0%"
    assert out[111]["hardhit_pct"] == "44.5%"


def test_fetch_savant_barrels_empty_csv_returns_empty(mocker):
    mocker.patch("fetch_data.urllib.request.urlopen",
                 return_value=_urlopen_returning(b"player_id,name\n"))
    assert fetch_data.fetch_savant_barrels("TOR", 2026) == {}


def test_fetch_savant_barrels_skips_rows_with_no_player_id(mocker):
    body = b"player_id,name,barrels_per_pa_percent\n,Mystery,8.0\n665489,Real,12.3\n"
    mocker.patch("fetch_data.urllib.request.urlopen",
                 return_value=_urlopen_returning(body))
    out = fetch_data.fetch_savant_barrels("TOR", 2026)
    assert list(out.keys()) == [665489]


def test_fetch_savant_barrels_fetch_failure_returns_empty(mocker, capsys):
    """Both probe URL slugs fail — return empty dict, never raise."""
    mocker.patch("fetch_data.urllib.request.urlopen",
                 side_effect=urllib.error.HTTPError(
                     "url", 403, "Forbidden", {}, None))
    assert fetch_data.fetch_savant_barrels("TOR", 2026) == {}


def test_fetch_savant_barrels_missing_metric_columns_returns_dash(mocker):
    """Row exists for player but neither metric column is present."""
    body = b"player_id,name,unrelated_col\n665489,Vlad,99\n"
    mocker.patch("fetch_data.urllib.request.urlopen",
                 return_value=_urlopen_returning(body))
    out = fetch_data.fetch_savant_barrels("TOR", 2026)
    assert out[665489]["barrel_pct"] == "---"
    assert out[665489]["hardhit_pct"] == "---"


# --- helpers ---------------------------------------------------------------

@pytest.mark.parametrize(
    "raw,expected",
    [
        ("12.3", "12.3%"),
        ("0", "0.0%"),
        ("50", "50.0%"),
        ("", "---"),
        (None, "---"),
        ("not-a-number", "---"),
    ],
)
def test_fmt_pct_normalizes_savant_percentages(raw, expected):
    assert fetch_data._fmt_pct(raw) == expected


def test_first_present_returns_first_non_empty():
    row = {"a": "", "b": "found", "c": "skipped"}
    assert fetch_data._first_present(row, ("a", "b", "c")) == "found"


def test_first_present_all_empty_returns_empty():
    row = {"a": "", "b": None}
    assert fetch_data._first_present(row, ("a", "b", "c")) == ""


def test_first_present_strips_whitespace():
    row = {"a": "  value  "}
    assert fetch_data._first_present(row, ("a",)) == "value"


# --- fetch_savant_oaa -----------------------------------------------------

_OAA_CSV_SINGLE = b"""team,outs_above_average
TOR,12
"""

_OAA_CSV_LEAGUE = b"""team,outs_above_average
NYY,-3
TOR,12
BOS,5
"""


def test_fetch_savant_oaa_returns_int_for_single_row(mocker):
    mocker.patch("fetch_data.urllib.request.urlopen",
                 return_value=_urlopen_returning(_OAA_CSV_SINGLE))
    assert fetch_data.fetch_savant_oaa("TOR", 2026) == 12


def test_fetch_savant_oaa_filters_league_wide_csv_by_team(mocker):
    """If the team= URL filter didn't apply, post-filter by team column."""
    mocker.patch("fetch_data.urllib.request.urlopen",
                 return_value=_urlopen_returning(_OAA_CSV_LEAGUE))
    assert fetch_data.fetch_savant_oaa("TOR", 2026) == 12


def test_fetch_savant_oaa_team_not_in_league_csv_returns_none(mocker):
    mocker.patch("fetch_data.urllib.request.urlopen",
                 return_value=_urlopen_returning(_OAA_CSV_LEAGUE))
    assert fetch_data.fetch_savant_oaa("LAD", 2026) is None


def test_fetch_savant_oaa_empty_csv_returns_none(mocker):
    mocker.patch("fetch_data.urllib.request.urlopen",
                 return_value=_urlopen_returning(b"team,outs_above_average\n"))
    assert fetch_data.fetch_savant_oaa("TOR", 2026) is None


def test_fetch_savant_oaa_fetch_failure_returns_none(mocker, capsys):
    mocker.patch("fetch_data.urllib.request.urlopen",
                 side_effect=urllib.error.HTTPError(
                     "url", 403, "Forbidden", {}, None))
    assert fetch_data.fetch_savant_oaa("TOR", 2026) is None


def test_fetch_savant_oaa_decimal_rounds_to_int(mocker):
    """Savant sometimes returns rounded decimals (e.g., '11.6'); coerce to int."""
    body = b"team,outs_above_average\nTOR,11.6\n"
    mocker.patch("fetch_data.urllib.request.urlopen",
                 return_value=_urlopen_returning(body))
    assert fetch_data.fetch_savant_oaa("TOR", 2026) == 12


def test_fetch_savant_oaa_negative_value_preserved(mocker):
    body = b"team,outs_above_average\nTOR,-5\n"
    mocker.patch("fetch_data.urllib.request.urlopen",
                 return_value=_urlopen_returning(body))
    assert fetch_data.fetch_savant_oaa("TOR", 2026) == -5


def test_fetch_savant_oaa_unparseable_value_returns_none(mocker):
    body = b"team,outs_above_average\nTOR,not-a-number\n"
    mocker.patch("fetch_data.urllib.request.urlopen",
                 return_value=_urlopen_returning(body))
    assert fetch_data.fetch_savant_oaa("TOR", 2026) is None


def test_fetch_savant_oaa_handles_alternate_column_names(mocker):
    """Some Savant exports use 'oaa' instead of 'outs_above_average'."""
    body = b"team,oaa\nTOR,8\n"
    mocker.patch("fetch_data.urllib.request.urlopen",
                 return_value=_urlopen_returning(body))
    assert fetch_data.fetch_savant_oaa("TOR", 2026) == 8


# --- combine_team_stats defense extension --------------------------------

def test_combine_team_stats_emits_defense_when_in_values():
    """defense group emitted in output when present in values."""
    values = {"hitting": {}, "pitching": {}, "defense": {"oaa": 12}}
    result = fetch_data.combine_team_stats(values, {})
    assert "defense" in result
    assert result["defense"]["oaa"] == {"val": 12, "rank": None}


def test_combine_team_stats_no_defense_when_absent():
    """Backwards compatible: absent defense → not in output."""
    result = fetch_data.combine_team_stats({"hitting": {"ops": ".750"}}, {})
    assert "defense" not in result


def test_combine_team_stats_defense_value_with_no_rank():
    """OAA has no team rank from Savant; rank defaults to None."""
    values = {"defense": {"oaa": 12}}
    result = fetch_data.combine_team_stats(values, {})
    assert result["defense"]["oaa"]["rank"] is None


# --- assert_invariants defense group --------------------------------------

def _valid_output_with_defense(defense_entries):
    from datetime import datetime, timezone
    return {
        "division": [{"team": f"T{i}", "team_id": i, "w": 10, "l": 10}
                     for i in range(5)],
        "wild_card": [{"team": f"WC{i}", "team_id": i, "w": 10, "l": 10}
                      for i in range(15)],
        "recent_games": [{"date": "2026-05-27", "result": "W", "score": "5-3"}],
        "team": {"record": {"w": 27, "l": 29},
                 "runs_scored": 226, "runs_allowed": 230},
        "injuries": [], "other_unavailable": [],
        "team_stats": {
            "hitting": {"ops": {"val": ".750", "rank": 12}},
            "pitching": {"era": {"val": "3.45", "rank": 8}},
            "defense": defense_entries,
        },
        "roster": {
            "hitters": [{"id": 1, "name": "Bo", "xwoba": ".---",
                          "barrel_pct": "---", "hardhit_pct": "---"}],
            "pitchers": [],
        },
    }


def test_assert_invariants_defense_valid_passes(cfg):
    from freezegun import freeze_time
    out = _valid_output_with_defense({"oaa": {"val": 12, "rank": None}})
    with freeze_time("2026-05-28T12:00:00", tz_offset=0):
        fetch_data.assert_invariants(out, cfg)


def test_assert_invariants_defense_missing_val_raises(cfg):
    from freezegun import freeze_time
    out = _valid_output_with_defense({"oaa": {"rank": None}})  # no 'val'
    with freeze_time("2026-05-28T12:00:00", tz_offset=0):
        with pytest.raises(SystemExit):
            fetch_data.assert_invariants(out, cfg)


def test_assert_invariants_defense_non_dict_entry_raises(cfg):
    from freezegun import freeze_time
    out = _valid_output_with_defense({"oaa": "should-be-dict"})
    with freeze_time("2026-05-28T12:00:00", tz_offset=0):
        with pytest.raises(SystemExit):
            fetch_data.assert_invariants(out, cfg)


def test_assert_invariants_defense_absent_passes(cfg):
    """No defense key → existing behavior, no invariant fires."""
    from freezegun import freeze_time
    out = _valid_output_with_defense({})  # empty defense
    # remove the defense key entirely
    del out["team_stats"]["defense"]
    with freeze_time("2026-05-28T12:00:00", tz_offset=0):
        fetch_data.assert_invariants(out, cfg)
