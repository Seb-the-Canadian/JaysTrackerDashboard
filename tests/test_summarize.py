"""Tests for summarize_news_items + the cache + the provider factories.

Provider clients (anthropic, openai, ollama urllib) are mocked at the boundary
— no real API calls are made. Each test asserts a specific code path:
opt-out shortcut, cache hit, cache miss, failure recovery, provider routing.
"""
import json
import sys
from unittest.mock import MagicMock

import pytest

import fetch_data


def _news_item(**kw) -> dict:
    """Minimal news item dict for summarizer input."""
    return {
        "title": kw.get("title", "Blue Jays win 8-3"),
        "summary": kw.get("summary", "Solid outing from the rotation."),
        "url": kw.get("url", "https://example.com/article-1"),
        "source": kw.get("source", "Test Source"),
        "author": kw.get("author", ""),
        "published": kw.get("published", "2026-05-28T13:00:00+00:00"),
    }


# --- opt-out (default behavior) -------------------------------------------

def test_summarize_news_items_disabled_returns_unchanged(cfg):
    """When news_summarize is missing or false, items pass through untouched."""
    items = [_news_item()]
    assert fetch_data.summarize_news_items(items, cfg) == items
    cfg2 = dict(cfg); cfg2["news_summarize"] = False
    assert fetch_data.summarize_news_items(items, cfg2) == items


def test_summarize_news_items_setup_error_logs_and_returns_unchanged(cfg, mocker, capsys):
    """If the SDK isn't installed (ImportError), warn and ship items un-tldr'd."""
    cfg = dict(cfg)
    cfg["news_summarize"] = True
    mocker.patch("fetch_data._get_summarizer", side_effect=ImportError("no anthropic"))
    items = [_news_item()]
    result = fetch_data.summarize_news_items(items, cfg)
    assert result == items
    assert "tldr" not in result[0]
    assert "summarize setup failed" in capsys.readouterr().err


# --- cache hit / miss -----------------------------------------------------

def test_summarize_news_items_cache_hit_skips_api(cfg, mocker, tmp_path):
    """Cached TL;DRs are reused; the summarizer callable is NOT invoked."""
    cfg = dict(cfg); cfg["news_summarize"] = True
    cache_path = tmp_path / "tldr.json"
    cache_path.write_text(json.dumps({
        "https://example.com/article-1": "Cached TL;DR.",
    }))
    mocker.patch.object(fetch_data, "TLDR_CACHE_PATH", cache_path)
    summarizer_mock = MagicMock()
    mocker.patch("fetch_data._get_summarizer", return_value=summarizer_mock)
    items = [_news_item(url="https://example.com/article-1")]
    result = fetch_data.summarize_news_items(items, cfg)
    assert result[0]["tldr"] == "Cached TL;DR."
    summarizer_mock.assert_not_called()


def test_summarize_news_items_cache_miss_calls_summarizer_and_writes_back(cfg, mocker, tmp_path):
    cfg = dict(cfg); cfg["news_summarize"] = True
    mocker.patch.object(fetch_data, "TLDR_CACHE_PATH", tmp_path / "tldr.json")
    summarizer_mock = MagicMock(return_value="Fresh TL;DR.")
    mocker.patch("fetch_data._get_summarizer", return_value=summarizer_mock)
    items = [_news_item(url="https://example.com/new-article")]
    result = fetch_data.summarize_news_items(items, cfg)
    assert result[0]["tldr"] == "Fresh TL;DR."
    summarizer_mock.assert_called_once()
    # Cache file written with the new entry
    on_disk = json.loads((tmp_path / "tldr.json").read_text())
    assert on_disk == {"https://example.com/new-article": "Fresh TL;DR."}


def test_summarize_news_items_failure_skips_item_keeps_others(cfg, mocker, tmp_path, capsys):
    """If the summarizer returns None for an item, that item ships sans tldr
    but the rest are still summarized."""
    cfg = dict(cfg); cfg["news_summarize"] = True
    mocker.patch.object(fetch_data, "TLDR_CACHE_PATH", tmp_path / "tldr.json")
    # First item fails (returns None), second succeeds.
    summarizer_mock = MagicMock(side_effect=[None, "Second worked."])
    mocker.patch("fetch_data._get_summarizer", return_value=summarizer_mock)
    items = [
        _news_item(url="https://example.com/article-1", title="One"),
        _news_item(url="https://example.com/article-2", title="Two"),
    ]
    result = fetch_data.summarize_news_items(items, cfg)
    assert "tldr" not in result[0]
    assert result[1]["tldr"] == "Second worked."


def test_summarize_news_items_no_url_skipped(cfg, mocker, tmp_path):
    """Items without a URL aren't cacheable; just skip them quietly."""
    cfg = dict(cfg); cfg["news_summarize"] = True
    mocker.patch.object(fetch_data, "TLDR_CACHE_PATH", tmp_path / "tldr.json")
    summarizer_mock = MagicMock(return_value="Shouldn't be called.")
    mocker.patch("fetch_data._get_summarizer", return_value=summarizer_mock)
    items = [_news_item(url="")]
    result = fetch_data.summarize_news_items(items, cfg)
    assert "tldr" not in result[0]
    summarizer_mock.assert_not_called()


# --- TL;DR cache file I/O -------------------------------------------------

def test_load_tldr_cache_missing_file_returns_empty(tmp_path, mocker):
    mocker.patch.object(fetch_data, "TLDR_CACHE_PATH", tmp_path / "missing.json")
    assert fetch_data._load_tldr_cache() == {}


def test_load_tldr_cache_corrupt_returns_empty_and_warns(tmp_path, mocker, capsys):
    bad = tmp_path / "bad.json"
    bad.write_text("{{{ not json")
    mocker.patch.object(fetch_data, "TLDR_CACHE_PATH", bad)
    assert fetch_data._load_tldr_cache() == {}
    assert "tldr cache unreadable" in capsys.readouterr().err


def test_load_tldr_cache_wrong_shape_returns_empty(tmp_path, mocker):
    """Non-dict (e.g., a JSON array) should be treated as corrupt."""
    bad = tmp_path / "wrong.json"
    bad.write_text(json.dumps(["not", "a", "dict"]))
    mocker.patch.object(fetch_data, "TLDR_CACHE_PATH", bad)
    assert fetch_data._load_tldr_cache() == {}


def test_save_tldr_cache_writes_and_creates_parent(tmp_path, mocker):
    target = tmp_path / "subdir" / "tldr.json"
    mocker.patch.object(fetch_data, "TLDR_CACHE_PATH", target)
    fetch_data._save_tldr_cache({"https://x.com": "summary"})
    assert target.exists()
    assert json.loads(target.read_text()) == {"https://x.com": "summary"}


def test_save_tldr_cache_empty_no_op(tmp_path, mocker):
    target = tmp_path / "should_not_exist.json"
    mocker.patch.object(fetch_data, "TLDR_CACHE_PATH", target)
    fetch_data._save_tldr_cache({})
    assert not target.exists()


# --- _get_summarizer provider routing -------------------------------------

def test_get_summarizer_unknown_provider_raises(cfg):
    cfg = dict(cfg); cfg["summarize_provider"] = "imaginary-llm"
    with pytest.raises(ValueError, match="unknown summarize_provider"):
        fetch_data._get_summarizer(cfg)


def test_get_summarizer_defaults_to_anthropic(cfg, mocker):
    """Missing `summarize_provider` → Anthropic with the default Haiku model."""
    fake_anthropic = MagicMock()
    mocker.patch.dict(sys.modules, {"anthropic": fake_anthropic})
    fetch_data._get_summarizer(cfg)
    fake_anthropic.Anthropic.assert_called_once()


def test_get_summarizer_openai(cfg, mocker):
    cfg = dict(cfg); cfg["summarize_provider"] = "openai"
    fake_openai = MagicMock()
    mocker.patch.dict(sys.modules, {"openai": fake_openai})
    fetch_data._get_summarizer(cfg)
    fake_openai.OpenAI.assert_called_once()


def test_get_summarizer_ollama_uses_default_base_url(cfg, mocker):
    cfg = dict(cfg); cfg["summarize_provider"] = "ollama"
    summarizer = fetch_data._get_summarizer(cfg)
    # Ollama doesn't need an SDK; the factory returns a callable directly.
    assert callable(summarizer)


def test_get_summarizer_ollama_custom_base_url(cfg):
    cfg = dict(cfg)
    cfg["summarize_provider"] = "ollama"
    cfg["summarize_ollama_base_url"] = "http://example.com:11434"
    summarizer = fetch_data._get_summarizer(cfg)
    assert callable(summarizer)


# --- prompt construction --------------------------------------------------

def test_summarize_prompt_includes_headline_and_source():
    item = _news_item(title="Big news today", source="Sportsnet")
    prompt = fetch_data._summarize_prompt(item)
    assert "Big news today" in prompt
    assert "Sportsnet" in prompt
    assert "1-2 sentences" in prompt


def test_summarize_prompt_truncates_long_excerpt():
    item = _news_item(summary="word " * 200)  # ~1000 chars
    prompt = fetch_data._summarize_prompt(item)
    excerpt_line = [line for line in prompt.split("\n") if line.startswith("Excerpt:")][0]
    # 500-char cap on the excerpt content
    assert len(excerpt_line) <= 510  # "Excerpt: " + 500 + small fudge


def test_summarize_prompt_handles_missing_summary():
    item = {"title": "Just a headline", "source": "X", "url": "https://x"}
    prompt = fetch_data._summarize_prompt(item)
    assert "Excerpt: " in prompt  # the label is still there
