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
