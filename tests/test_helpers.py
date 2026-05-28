"""Helper-function tests for fetch_data.

Every function tested here is a pure-input/output transformation — no
mocking, no fixtures (beyond what conftest provides). Parametrize
tables drive the case coverage.

Naming: `test_<function>_<scenario>_<expected>`.
"""
import time
from datetime import datetime, timedelta, timezone

import pytest
from freezegun import freeze_time

import fetch_data


# --- pythag ---------------------------------------------------------------

@pytest.mark.parametrize(
    "rs,ra,gp,expected_w,expected_l",
    [
        pytest.param(250, 200, 60, 37, 23, id="more_runs_scored_than_allowed"),
        pytest.param(200, 250, 60, 23, 37, id="more_runs_allowed_than_scored"),
        pytest.param(0, 0, 60, 0, 0, id="zero_runs_returns_zero_zero"),
        pytest.param(100, 100, 0, 0, 0, id="zero_games_returns_zero_zero"),
        pytest.param(100, 100, 60, 30, 30, id="equal_runs_returns_even_split"),
    ],
)
def test_pythag_returns_expected_wl(rs, ra, gp, expected_w, expected_l):
    assert fetch_data.pythag(rs, ra, gp) == (expected_w, expected_l)


# --- _gb_diff -------------------------------------------------------------

@pytest.mark.parametrize(
    "bw,bl,ww,wl,expected",
    [
        pytest.param(60, 40, 55, 45, 5.0, id="five_games_ahead"),
        pytest.param(60, 40, 60, 40, 0.0, id="tied"),
        pytest.param(60, 40, 60, 41, 0.5, id="half_game_ahead_by_l"),
        pytest.param(61, 40, 60, 40, 0.5, id="half_game_ahead_by_w"),
        pytest.param(50, 50, 60, 40, -10.0, id="ten_games_behind"),
    ],
)
def test_gb_diff_returns_standard_mlb_formula(bw, bl, ww, wl, expected):
    assert fetch_data._gb_diff(bw, bl, ww, wl) == expected


# --- _fmt_gb --------------------------------------------------------------

@pytest.mark.parametrize(
    "games,expected",
    [
        pytest.param(0, "-", id="zero_returns_dash"),
        pytest.param(0.5, "0.5", id="half_game"),
        pytest.param(1.0, "1.0", id="one_game"),
        pytest.param(6.0, "6.0", id="six_games"),
        pytest.param(12.5, "12.5", id="twelve_and_a_half"),
    ],
)
def test_fmt_gb_returns_mlb_display_format(games, expected):
    assert fetch_data._fmt_gb(games) == expected


# --- _parse_iso_date ------------------------------------------------------

@pytest.mark.parametrize(
    "s,expected_iso",
    [
        pytest.param("2026-05-28", "2026-05-28", id="yyyy_mm_dd"),
        pytest.param("2026-05-28T19:05:00Z", "2026-05-28", id="full_iso_truncated"),
        pytest.param("2026-05-28T19:05:00+00:00", "2026-05-28", id="iso_with_offset"),
    ],
)
def test_parse_iso_date_valid_input_returns_date(s, expected_iso):
    result = fetch_data._parse_iso_date(s)
    assert result is not None
    assert result.isoformat() == expected_iso


@pytest.mark.parametrize(
    "s",
    [
        pytest.param("", id="empty_string"),
        pytest.param(None, id="none"),
        pytest.param("not-a-date", id="malformed"),
        pytest.param("2026-13-01", id="invalid_month"),
    ],
)
def test_parse_iso_date_invalid_input_returns_none(s):
    assert fetch_data._parse_iso_date(s) is None


# --- parse_float ----------------------------------------------------------

@pytest.mark.parametrize(
    "s,default,expected",
    [
        pytest.param("3.14", 0.0, 3.14, id="valid_string"),
        pytest.param("0", 0.0, 0.0, id="zero_string"),
        pytest.param("-1.5", 0.0, -1.5, id="negative_string"),
        pytest.param(None, 0.0, 0.0, id="none_returns_default"),
        pytest.param("", 0.0, 0.0, id="empty_string_returns_default"),
        pytest.param("abc", 0.0, 0.0, id="malformed_returns_default"),
        pytest.param(None, 99.0, 99.0, id="custom_default_honored"),
    ],
)
def test_parse_float_returns_expected(s, default, expected):
    assert fetch_data.parse_float(s, default=default) == expected


# --- ip_to_decimal --------------------------------------------------------

@pytest.mark.parametrize(
    "ip_str,expected",
    [
        pytest.param("6.0", 6.0, id="whole_inning"),
        pytest.param("6.1", pytest.approx(6 + 1/3), id="one_third_extra"),
        pytest.param("6.2", pytest.approx(6 + 2/3), id="two_thirds_extra"),
        pytest.param("0.0", 0.0, id="zero_innings"),
        pytest.param("0.1", pytest.approx(1/3), id="one_out"),
        pytest.param(None, 0.0, id="none_returns_zero"),
        pytest.param("", 0.0, id="empty_returns_zero"),
        pytest.param("not-a-number", 0.0, id="malformed_returns_zero"),
    ],
)
def test_ip_to_decimal_handles_baseball_notation(ip_str, expected):
    result = fetch_data.ip_to_decimal(ip_str)
    if isinstance(expected, float):
        assert result == expected
    else:
        assert result == expected


# --- _stat_signature ------------------------------------------------------

def test_stat_signature_hitting_uses_hitting_keys():
    stat = {
        "atBats": 42, "hits": 14, "baseOnBalls": 8,
        "homeRuns": 3, "totalBases": 28,
        "rbi": 21,
    }
    sig = fetch_data._stat_signature(stat, "hitting")
    assert "atBats=42" in sig
    assert "hits=14" in sig
    assert "baseOnBalls=8" in sig
    assert "homeRuns=3" in sig
    assert "totalBases=28" in sig
    assert "rbi" not in sig


def test_stat_signature_pitching_uses_pitching_keys():
    stat = {
        "inningsPitched": "40.2", "earnedRuns": 16,
        "strikeOuts": 38, "baseOnBalls": 12,
        "wins": 4,
    }
    sig = fetch_data._stat_signature(stat, "pitching")
    assert "inningsPitched=40.2" in sig
    assert "earnedRuns=16" in sig
    assert "strikeOuts=38" in sig
    assert "baseOnBalls=12" in sig
    assert "wins" not in sig


def test_stat_signature_empty_dict_returns_empty_string():
    assert fetch_data._stat_signature({}, "hitting") == ""
    assert fetch_data._stat_signature(None, "hitting") == ""


def test_stat_signature_missing_keys_default_to_zero():
    sig = fetch_data._stat_signature({"atBats": 42}, "hitting")
    assert "atBats=42" in sig
    assert "hits=0" in sig
    assert "homeRuns=0" in sig


def test_stat_signature_deterministic_same_input_same_output():
    stat = {"atBats": 42, "hits": 14, "baseOnBalls": 8, "homeRuns": 3, "totalBases": 28}
    sig1 = fetch_data._stat_signature(stat, "hitting")
    sig2 = fetch_data._stat_signature(stat, "hitting")
    assert sig1 == sig2


# --- _recent_enough -------------------------------------------------------

def _make_entry(dt: datetime):
    return {"published_parsed": time.gmtime(dt.timestamp())}


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_recent_enough_within_window_returns_true():
    entry = _make_entry(datetime(2026, 5, 27, 12, 0, 0, tzinfo=timezone.utc))
    assert fetch_data._recent_enough(entry, days=2) is True


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_recent_enough_outside_window_returns_false():
    entry = _make_entry(datetime(2026, 5, 20, 12, 0, 0, tzinfo=timezone.utc))
    assert fetch_data._recent_enough(entry, days=2) is False


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_recent_enough_no_timestamp_returns_true():
    entry = {"title": "no published date"}
    assert fetch_data._recent_enough(entry, days=2) is True


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_recent_enough_widened_window_keeps_older_items():
    entry = _make_entry(datetime(2026, 5, 22, 12, 0, 0, tzinfo=timezone.utc))
    assert fetch_data._recent_enough(entry, days=2) is False
    assert fetch_data._recent_enough(entry, days=7) is True


# --- ordinal --------------------------------------------------------------

@pytest.mark.parametrize(
    "n,expected",
    [
        pytest.param(1, "1st", id="one_returns_first"),
        pytest.param(2, "2nd", id="two_returns_second"),
        pytest.param(3, "3rd", id="three_returns_third"),
        pytest.param(4, "4th", id="four_returns_fourth"),
        pytest.param(11, "11th", id="eleven_returns_eleventh_not_eleventst"),
        pytest.param(12, "12th", id="twelve_returns_twelfth"),
        pytest.param(13, "13th", id="thirteen_returns_thirteenth"),
        pytest.param(21, "21st", id="twenty_one_returns_twenty_first"),
        pytest.param(22, "22nd", id="twenty_two_returns_twenty_second"),
        pytest.param(100, "100th", id="one_hundred"),
        pytest.param("3", "3rd", id="string_input_coerces"),
    ],
)
def test_ordinal_returns_english_suffix(n, expected):
    assert fetch_data.ordinal(n) == expected


@pytest.mark.parametrize(
    "n,expected",
    [
        pytest.param(None, "", id="none_returns_empty"),
        pytest.param("", "", id="empty_string_returns_empty"),
        pytest.param("not-a-number", "not-a-number", id="unparseable_returns_str_input"),
    ],
)
def test_ordinal_invalid_input_returns_fallback(n, expected):
    assert fetch_data.ordinal(n) == expected


# --- _strip_html ----------------------------------------------------------

@pytest.mark.parametrize(
    "input_str,expected",
    [
        pytest.param("Plain text", "Plain text", id="plain_text_unchanged"),
        pytest.param("<p>Hello</p>", "Hello", id="single_tag_stripped"),
        pytest.param("<p>One</p><p>Two</p>", "OneTwo", id="adjacent_tags_concatenate"),
        pytest.param("<p>One</p>\n<p>Two</p>", "One Two", id="tags_with_newline_collapse_to_space"),
        pytest.param("Word1\n\n\nWord2", "Word1 Word2", id="whitespace_collapsed"),
        pytest.param("<a href='x'>Link</a>", "Link", id="attribute_tag_stripped"),
        pytest.param("", "", id="empty_returns_empty"),
        pytest.param(None, "", id="none_returns_empty"),
    ],
)
def test_strip_html_drops_tags_collapses_whitespace(input_str, expected):
    assert fetch_data._strip_html(input_str) == expected


# --- _entry_author --------------------------------------------------------

def test_entry_author_from_author_field():
    assert fetch_data._entry_author({"author": "Jane Doe"}) == "Jane Doe"


def test_entry_author_strips_whitespace():
    assert fetch_data._entry_author({"author": "  Jane Doe  "}) == "Jane Doe"


def test_entry_author_falls_back_to_authors_list():
    entry = {"authors": [{"name": "John Smith"}]}
    assert fetch_data._entry_author(entry) == "John Smith"


def test_entry_author_prefers_author_over_authors_list():
    entry = {"author": "Jane Doe", "authors": [{"name": "John Smith"}]}
    assert fetch_data._entry_author(entry) == "Jane Doe"


def test_entry_author_returns_empty_when_missing():
    assert fetch_data._entry_author({}) == ""
    assert fetch_data._entry_author({"author": ""}) == ""
    assert fetch_data._entry_author({"authors": []}) == ""
