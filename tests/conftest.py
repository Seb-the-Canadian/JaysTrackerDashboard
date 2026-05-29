"""Shared pytest fixtures for the Blue Jays 2026 Tracker test suite.

Layout convention:
- JSON fixtures (sample MLB API responses) live in `tests/fixtures/`.
- Load them via `load_fixture(name)`; the helper handles path resolution.
- Module-level state in fetch_data (e.g., the gameLog cache) is reset
  between tests via an autouse fixture so tests don't leak.
"""
import json
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> dict | list:
    """Read a JSON fixture by filename (with or without `.json` suffix)."""
    if not name.endswith(".json"):
        name = name + ".json"
    with open(FIXTURES_DIR / name) as f:
        return json.load(f)


@pytest.fixture
def cfg() -> dict:
    """A minimal but valid config dict matching the Jays repo's shape."""
    return {
        "team_id": 141,
        "team_name": "Toronto Blue Jays",
        "team_abbrev": "TOR",
        "league_id": 103,
        "division_id": 201,
        "season": 2026,
        "primary_color": "#134A8E",
        "accent_color": "#1d8acd",
        "dashboard_title": "Blue Jays 2026 Tracker",
        "brand_mark": "J",
        "news_recent_days": 7,
        "rss_feeds": [],
    }


@pytest.fixture(autouse=True)
def reset_gamelog_cache():
    """Clear fetch_data's module-level cache state between tests so a
    test that loads or writes to the cache doesn't leak into the next."""
    import fetch_data
    fetch_data._GAMELOG_CACHE = None
    fetch_data._GAMELOG_CACHE_DIRTY = False
    yield
    fetch_data._GAMELOG_CACHE = None
    fetch_data._GAMELOG_CACHE_DIRTY = False


@pytest.fixture(autouse=True)
def mock_player_xstats(mocker):
    """Default fetch_player_xstats to return {} so transform_roster tests
    don't silently hit the real statsapi (which would 403 from the sandbox).
    Tests that exercise xstats behavior override this mock."""
    return mocker.patch("fetch_data.fetch_player_xstats", return_value={})
