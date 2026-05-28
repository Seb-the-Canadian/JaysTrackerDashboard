"""Tests for fetch_news — the RSS passthrough pipeline.

Patches `fetch_data.feedparser` to a Mock object (NOT
`fetch_data.feedparser.parse` directly) because in some environments
the real feedparser package isn't installed and `fetch_data.feedparser`
is None at import time — the ImportError fallback in fetch_data.py:25-28.

Each test sets up a fake parsed feed (with .entries and optionally
.bozo_exception) and asserts on the output items + the per-feed INFO
log line that #64 added.
"""
import time
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from freezegun import freeze_time

import fetch_data


def _entry(*, title: str = "An item", summary: str = "",
           link: str = "https://example.com/item",
           published: datetime | None = None,
           author: str = "") -> dict:
    """Build a feedparser-shaped entry dict."""
    e = {"title": title, "summary": summary, "link": link, "author": author}
    if published is not None:
        e["published"] = published.isoformat()
        e["published_parsed"] = time.gmtime(published.timestamp())
    return e


def _parsed(entries: list, bozo_exception=None) -> SimpleNamespace:
    """Build the SimpleNamespace feedparser.parse returns (entries + bozo)."""
    ns = SimpleNamespace(entries=entries, bozo=bool(bozo_exception))
    if bozo_exception:
        ns.bozo_exception = bozo_exception
    return ns


def _patch_feedparser(mocker, *, parse_return=None, parse_side_effect=None):
    """Patch the entire fetch_data.feedparser module with a MagicMock so
    .parse() is callable regardless of whether the real package is installed.
    Returns the mock's .parse attribute for assertions."""
    fake = MagicMock()
    if parse_side_effect is not None:
        fake.parse.side_effect = parse_side_effect
    else:
        fake.parse.return_value = parse_return
    mocker.patch.object(fetch_data, "feedparser", fake)
    return fake.parse


def _cfg_with_feed(url: str = "https://example.com/feed", source: str = "Test",
                   keyword: str | None = None, recent_days: int = 7) -> dict:
    return {
        "team_id": 141,
        "season": 2026,
        "news_recent_days": recent_days,
        "rss_feeds": [
            {"url": url, "source": source, "keyword_filter": keyword},
        ],
    }


# --- empty / disabled feed config -----------------------------------------

def test_fetch_news_no_feeds_in_config_returns_empty():
    cfg = {"rss_feeds": []}
    assert fetch_data.fetch_news(cfg) == []


def test_fetch_news_missing_rss_feeds_key_returns_empty():
    assert fetch_data.fetch_news({}) == []


def test_fetch_news_feedparser_missing_warns_and_returns_empty(mocker, capsys):
    cfg = _cfg_with_feed()
    mocker.patch.object(fetch_data, "feedparser", None)
    assert fetch_data.fetch_news(cfg) == []
    assert "feedparser is not installed" in capsys.readouterr().err


# --- per-feed failure modes -----------------------------------------------

def test_fetch_news_feed_with_missing_url_skipped_and_logged(mocker, capsys):
    cfg = {"rss_feeds": [{"url": None, "source": "Bad Feed"}]}
    parse_mock = _patch_feedparser(mocker, parse_return=_parsed([]))
    fetch_data.fetch_news(cfg)
    parse_mock.assert_not_called()
    assert "feed Bad Feed missing url" in capsys.readouterr().err


def test_fetch_news_feedparser_raises_logs_warn_continues(mocker, capsys):
    cfg = {"rss_feeds": [
        {"url": "https://bad.example.com/feed", "source": "Bad"},
        {"url": "https://good.example.com/feed", "source": "Good"},
    ]}
    side_effects = [RuntimeError("boom"), _parsed([])]
    _patch_feedparser(mocker, parse_side_effect=side_effects)
    result = fetch_data.fetch_news(cfg)
    assert result == []  # both feeds yielded nothing
    err = capsys.readouterr().err
    assert "feed Bad failed: boom" in err
    # Second feed still attempted — first didn't abort the loop
    assert "INFO: feed Good" in err


def test_fetch_news_bozo_exception_with_no_entries_warns_skips(mocker, capsys):
    cfg = _cfg_with_feed()
    _patch_feedparser(mocker, parse_return=_parsed([], bozo_exception=ValueError("malformed")))
    result = fetch_data.fetch_news(cfg)
    assert result == []
    assert "feed Test parse error" in capsys.readouterr().err


def test_fetch_news_bozo_with_entries_still_processes(mocker):
    """feedparser sets bozo on a wide variety of soft errors but may still
    return usable entries. Don't drop them."""
    cfg = _cfg_with_feed()
    fresh = datetime.now(timezone.utc)
    entry = _entry(published=fresh, title="Got through despite bozo")
    _patch_feedparser(mocker, parse_return=_parsed([entry], bozo_exception=ValueError("warn")))
    result = fetch_data.fetch_news(cfg)
    assert len(result) == 1
    assert result[0]["title"] == "Got through despite bozo"


# --- recency filter --------------------------------------------------------

@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_fetch_news_recency_filter_drops_too_old(mocker, capsys):
    cfg = _cfg_with_feed(recent_days=2)
    entries = [
        _entry(title="Recent", published=datetime(2026, 5, 27, tzinfo=timezone.utc)),
        _entry(title="Old", published=datetime(2026, 5, 20, tzinfo=timezone.utc)),
    ]
    _patch_feedparser(mocker, parse_return=_parsed(entries))
    result = fetch_data.fetch_news(cfg)
    titles = [r["title"] for r in result]
    assert "Recent" in titles
    assert "Old" not in titles
    err = capsys.readouterr().err
    assert "1 kept" in err
    assert "1 too old" in err


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_fetch_news_widened_window_keeps_older_items(mocker):
    """news_recent_days=7 keeps items within a week; same item dropped at 2."""
    entry = _entry(title="Four days old",
                   published=datetime(2026, 5, 24, tzinfo=timezone.utc))
    _patch_feedparser(mocker, parse_return=_parsed([entry]))
    # 7-day window keeps it
    assert len(fetch_data.fetch_news(_cfg_with_feed(recent_days=7))) == 1
    # 2-day window drops it
    assert len(fetch_data.fetch_news(_cfg_with_feed(recent_days=2))) == 0


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_fetch_news_recency_default_used_when_config_absent(mocker):
    """No news_recent_days in config → falls back to NEWS_RECENT_DAYS (2)."""
    cfg = {
        "rss_feeds": [{"url": "https://x", "source": "X", "keyword_filter": None}],
    }
    entry_old = _entry(title="Five days old",
                       published=datetime(2026, 5, 23, tzinfo=timezone.utc))
    _patch_feedparser(mocker, parse_return=_parsed([entry_old]))
    assert fetch_data.fetch_news(cfg) == []  # 5 days > 2-day default


# --- keyword filter --------------------------------------------------------

@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_fetch_news_keyword_filter_drops_off_keyword(mocker, capsys):
    cfg = _cfg_with_feed(keyword="Blue Jays")
    fresh = datetime.now(timezone.utc)
    entries = [
        _entry(title="Blue Jays win 8-3", published=fresh),
        _entry(title="Yankees roll", summary="MLB scores", published=fresh),
        _entry(title="Mid-week update", summary="Includes Blue Jays line", published=fresh),
    ]
    _patch_feedparser(mocker, parse_return=_parsed(entries))
    result = fetch_data.fetch_news(cfg)
    titles = [r["title"] for r in result]
    assert "Blue Jays win 8-3" in titles
    assert "Mid-week update" in titles  # matches via summary
    assert "Yankees roll" not in titles
    assert "1 off-keyword" in capsys.readouterr().err


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_fetch_news_keyword_filter_case_insensitive(mocker):
    cfg = _cfg_with_feed(keyword="blue jays")
    fresh = datetime.now(timezone.utc)
    entries = [_entry(title="BLUE JAYS WIN", published=fresh)]
    _patch_feedparser(mocker, parse_return=_parsed(entries))
    assert len(fetch_data.fetch_news(cfg)) == 1


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_fetch_news_no_keyword_filter_keeps_all_recent(mocker):
    cfg = _cfg_with_feed(keyword=None)
    fresh = datetime.now(timezone.utc)
    entries = [_entry(title=f"Item {i}", published=fresh) for i in range(5)]
    _patch_feedparser(mocker, parse_return=_parsed(entries))
    assert len(fetch_data.fetch_news(cfg)) == 5


# --- sorting + capping ----------------------------------------------------

@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_fetch_news_sorted_by_published_desc(mocker):
    cfg = _cfg_with_feed()
    times = [datetime(2026, 5, d, 12, 0, 0, tzinfo=timezone.utc) for d in (25, 27, 26)]
    entries = [_entry(title=f"Item {i}", published=t) for i, t in enumerate(times)]
    _patch_feedparser(mocker, parse_return=_parsed(entries))
    result = fetch_data.fetch_news(cfg)
    published_list = [r["published"] for r in result]
    assert published_list == sorted(published_list, reverse=True)


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_fetch_news_per_feed_limit_caps_entries(mocker, capsys):
    """NEWS_PER_FEED_LIMIT (25) caps any one feed's contribution.
    The combined total is further capped by NEWS_TOTAL_LIMIT (20)."""
    cfg = _cfg_with_feed()
    fresh = datetime.now(timezone.utc)
    entries = [_entry(title=f"Item {i}", published=fresh) for i in range(50)]
    _patch_feedparser(mocker, parse_return=_parsed(entries))
    fetch_data.fetch_news(cfg)
    # Confirm via the INFO log line that the per-feed cap fired at 25.
    assert f"{fetch_data.NEWS_PER_FEED_LIMIT} kept" in capsys.readouterr().err


@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_fetch_news_total_limit_caps_combined_result(mocker):
    """NEWS_TOTAL_LIMIT (20) caps the combined output across feeds."""
    cfg = {
        "news_recent_days": 7,
        "rss_feeds": [
            {"url": f"https://feed{i}", "source": f"Feed{i}", "keyword_filter": None}
            for i in range(3)
        ],
    }
    fresh = datetime.now(timezone.utc)
    parsed = _parsed([_entry(title=f"Item {i}", published=fresh) for i in range(25)])
    _patch_feedparser(mocker, parse_return=parsed)
    result = fetch_data.fetch_news(cfg)
    assert len(result) == fetch_data.NEWS_TOTAL_LIMIT


# --- per-feed INFO log (regression guard for #64) -------------------------

@freeze_time("2026-05-28T12:00:00", tz_offset=0)
def test_fetch_news_per_feed_info_log_emitted_with_counts(mocker, capsys):
    cfg = _cfg_with_feed(source="Sportsnet")
    fresh = datetime.now(timezone.utc)
    entries = [
        _entry(title=f"Item {i}", published=fresh) for i in range(3)
    ]
    _patch_feedparser(mocker, parse_return=_parsed(entries))
    fetch_data.fetch_news(cfg)
    err = capsys.readouterr().err
    assert "INFO: feed Sportsnet" in err
    assert "3 entries" in err
    assert "3 kept" in err
    assert "0 too old" in err
    assert "0 off-keyword" in err


# --- _transform_entry (the per-item shape) --------------------------------

def test_transform_entry_shape_has_all_fields():
    entry = _entry(title="A title", summary="A summary",
                   link="https://x.com", author="Jane Doe",
                   published=datetime(2026, 5, 27, 13, 0, 0, tzinfo=timezone.utc))
    row = fetch_data._transform_entry(entry, "Test Source")
    assert row["title"] == "A title"
    assert row["summary"] == "A summary"
    assert row["source"] == "Test Source"
    assert row["author"] == "Jane Doe"
    assert row["url"] == "https://x.com"
    assert row["published"].startswith("2026-05-27T13:00:00")


def test_transform_entry_strips_html_from_title_and_summary():
    entry = _entry(title="<b>Bold</b> headline",
                   summary="<p>Paragraph</p>")
    row = fetch_data._transform_entry(entry, "X")
    assert row["title"] == "Bold headline"
    assert "<p>" not in row["summary"]


# --- _entry_published_dt --------------------------------------------------

def test_entry_published_dt_from_published_parsed():
    entry = {"published_parsed": time.gmtime(
        datetime(2026, 5, 27, 12, 0, 0, tzinfo=timezone.utc).timestamp())}
    dt = fetch_data._entry_published_dt(entry)
    assert dt is not None
    assert dt.year == 2026 and dt.month == 5 and dt.day == 27


def test_entry_published_dt_falls_back_to_updated_parsed():
    entry = {"updated_parsed": time.gmtime(
        datetime(2026, 5, 27, 12, 0, 0, tzinfo=timezone.utc).timestamp())}
    dt = fetch_data._entry_published_dt(entry)
    assert dt is not None


def test_entry_published_dt_no_timestamps_returns_none():
    assert fetch_data._entry_published_dt({}) is None


# --- _published_iso -------------------------------------------------------

def test_published_iso_prefers_parsed_struct_time():
    entry = {"published_parsed": time.gmtime(
        datetime(2026, 5, 27, 13, 0, 0, tzinfo=timezone.utc).timestamp())}
    result = fetch_data._published_iso(entry)
    assert result.startswith("2026-05-27T13:00:00")


def test_published_iso_falls_back_to_raw_published_when_unparseable():
    """When feedparser couldn't parse, return the raw string so the renderer
    at least has something to display."""
    entry = {"published": "next Tuesday"}  # not parseable
    assert fetch_data._published_iso(entry) == "next Tuesday"


def test_published_iso_returns_empty_when_no_date():
    assert fetch_data._published_iso({}) == ""
