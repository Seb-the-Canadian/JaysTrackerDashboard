"""Cache layer tests for fetch_data.

Covers:
- _load_gamelog_cache: missing file, corrupt JSON, wrong shape, valid file, memoization
- _save_gamelog_cache: clean (no-op), dirty (write), atomic + parent-dir creation
- _fetch_game_log: cache hit, cache miss, API failure with cache, API failure
  without cache, write to cache on miss, routing through /people/{id}

Module-level state in fetch_data (_GAMELOG_CACHE, _GAMELOG_CACHE_DIRTY) is
reset between tests via the autouse fixture in conftest.py.

Naming: `test_<function>_<scenario>_<expected>`.
"""
import json
from pathlib import Path

import pytest

import fetch_data


# --- _load_gamelog_cache --------------------------------------------------

def test_load_gamelog_cache_missing_file_returns_empty(tmp_path, mocker):
    """First-ever run: cache file doesn't exist yet."""
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", tmp_path / "missing.json")
    cache = fetch_data._load_gamelog_cache()
    assert cache == {"players": {}}


def test_load_gamelog_cache_corrupt_json_returns_empty_and_warns(tmp_path, mocker, capsys):
    """Cache file got garbled — recover gracefully + log."""
    bad = tmp_path / "bad.json"
    bad.write_text("not json at all {{{")
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", bad)
    cache = fetch_data._load_gamelog_cache()
    assert cache == {"players": {}}
    assert "gameLog cache unreadable" in capsys.readouterr().err


def test_load_gamelog_cache_wrong_shape_returns_empty(tmp_path, mocker):
    """Valid JSON but missing the 'players' key — treat as corrupt."""
    wrong = tmp_path / "wrong.json"
    wrong.write_text(json.dumps({"wrong_key": []}))
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", wrong)
    cache = fetch_data._load_gamelog_cache()
    assert cache == {"players": {}}


def test_load_gamelog_cache_valid_file_returns_parsed_dict(tmp_path, mocker):
    valid_data = {
        "players": {
            "665489_hitting_2026": {
                "signature": "atBats=42|hits=14|baseOnBalls=8|homeRuns=3|totalBases=28",
                "splits": [{"date": "2026-05-27", "stat": {"atBats": 4, "hits": 1}}],
                "fetched_at": "2026-05-28T09:00:00+00:00",
            },
        },
    }
    valid = tmp_path / "valid.json"
    valid.write_text(json.dumps(valid_data))
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", valid)
    cache = fetch_data._load_gamelog_cache()
    assert cache == valid_data


def test_load_gamelog_cache_memoized_second_call_no_disk_read(tmp_path, mocker):
    """The lazy-load helper should only hit disk once per session."""
    valid = tmp_path / "memo.json"
    valid.write_text(json.dumps({"players": {}}))
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", valid)
    open_spy = mocker.patch("builtins.open", wraps=open)
    fetch_data._load_gamelog_cache()
    fetch_data._load_gamelog_cache()
    fetch_data._load_gamelog_cache()
    # Only one open() call for GAMELOG_CACHE_PATH across three load calls.
    cache_opens = [c for c in open_spy.call_args_list if str(valid) in str(c)]
    assert len(cache_opens) == 1


# --- _save_gamelog_cache --------------------------------------------------

def test_save_gamelog_cache_clean_does_not_write(tmp_path, mocker):
    """When _GAMELOG_CACHE_DIRTY is False, save is a no-op."""
    target = tmp_path / "should_not_exist.json"
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", target)
    fetch_data._GAMELOG_CACHE = {"players": {}}
    fetch_data._GAMELOG_CACHE_DIRTY = False
    fetch_data._save_gamelog_cache()
    assert not target.exists()


def test_save_gamelog_cache_dirty_writes_to_disk(tmp_path, mocker):
    target = tmp_path / "out.json"
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", target)
    fetch_data._GAMELOG_CACHE = {"players": {"123_hitting_2026": {"signature": "x", "splits": [], "fetched_at": "now"}}}
    fetch_data._GAMELOG_CACHE_DIRTY = True
    fetch_data._save_gamelog_cache()
    assert target.exists()
    on_disk = json.loads(target.read_text())
    assert on_disk == fetch_data._GAMELOG_CACHE


def test_save_gamelog_cache_creates_parent_directory(tmp_path, mocker):
    """If data/ doesn't exist yet, save should create it."""
    target = tmp_path / "subdir" / "deeper" / "cache.json"
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", target)
    fetch_data._GAMELOG_CACHE = {"players": {}}
    fetch_data._GAMELOG_CACHE_DIRTY = True
    fetch_data._save_gamelog_cache()
    assert target.exists()
    assert target.parent.is_dir()


def test_save_gamelog_cache_atomic_via_tmp_then_replace(tmp_path, mocker):
    """tmp file is written then replaced — no partial-write window."""
    target = tmp_path / "atomic.json"
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", target)
    fetch_data._GAMELOG_CACHE = {"players": {}}
    fetch_data._GAMELOG_CACHE_DIRTY = True
    # Spy on Path.replace to confirm the atomic swap is happening.
    replace_spy = mocker.spy(Path, "replace")
    fetch_data._save_gamelog_cache()
    assert replace_spy.called
    # tmp file should be cleaned up by the replace.
    assert not target.with_suffix(".tmp").exists()


def test_save_gamelog_cache_none_state_does_not_crash(mocker, tmp_path):
    """Defensive: never-loaded cache + dirty flag set shouldn't crash."""
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", tmp_path / "x.json")
    fetch_data._GAMELOG_CACHE = None
    fetch_data._GAMELOG_CACHE_DIRTY = True  # contrived; shouldn't happen in practice
    fetch_data._save_gamelog_cache()  # must not raise


# --- _fetch_game_log: API + cache --------------------------------------

def _person_response(group: str, splits: list) -> dict:
    """Build a /people response with one stats[] entry of the given group."""
    return {
        "people": [{
            "id": 665489,
            "stats": [{
                "type": {"displayName": "gameLog"},
                "group": {"displayName": group},
                "splits": splits,
            }],
        }],
    }


def test_fetch_game_log_routes_through_people_endpoint(mocker, tmp_path):
    """The /stats endpoint silently ignores personId — must use /people/{id}.
    Regression guard for #59."""
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", tmp_path / "c.json")
    api_mock = mocker.patch("fetch_data.statsapi.get",
                            return_value=_person_response("hitting", []))
    fetch_data._fetch_game_log(665489, "hitting", 2026)
    api_mock.assert_called_once()
    call_args = api_mock.call_args
    assert call_args.args[0] == "person"
    assert call_args.args[1]["personId"] == 665489
    assert "stats(group=hitting" in call_args.args[1]["hydrate"]


def test_fetch_game_log_returns_splits_on_successful_fetch(mocker, tmp_path):
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", tmp_path / "c.json")
    splits = [
        {"date": "2026-05-25", "stat": {"atBats": 4, "hits": 1}},
        {"date": "2026-05-26", "stat": {"atBats": 3, "hits": 2}},
    ]
    mocker.patch("fetch_data.statsapi.get",
                 return_value=_person_response("hitting", splits))
    result = fetch_data._fetch_game_log(665489, "hitting", 2026)
    assert result == splits


def test_fetch_game_log_matches_group_correctly(mocker, tmp_path):
    """Response with both hitting + pitching stats; should return only the
    requested group."""
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", tmp_path / "c.json")
    response = {
        "people": [{
            "id": 665489,
            "stats": [
                {"type": {"displayName": "gameLog"}, "group": {"displayName": "hitting"},
                 "splits": [{"stat": {"atBats": 1}}]},
                {"type": {"displayName": "gameLog"}, "group": {"displayName": "pitching"},
                 "splits": [{"stat": {"inningsPitched": "2.0"}}]},
            ],
        }],
    }
    mocker.patch("fetch_data.statsapi.get", return_value=response)
    hitting = fetch_data._fetch_game_log(665489, "hitting", 2026)
    pitching = fetch_data._fetch_game_log(665489, "pitching", 2026)
    assert hitting == [{"stat": {"atBats": 1}}]
    assert pitching == [{"stat": {"inningsPitched": "2.0"}}]


def test_fetch_game_log_no_people_returns_empty(mocker, tmp_path):
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", tmp_path / "c.json")
    mocker.patch("fetch_data.statsapi.get", return_value={"people": []})
    assert fetch_data._fetch_game_log(665489, "hitting", 2026) == []


def test_fetch_game_log_no_matching_group_returns_empty(mocker, tmp_path):
    """Response shape is valid but doesn't have a matching group entry."""
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", tmp_path / "c.json")
    response = {
        "people": [{"stats": [
            {"type": {"displayName": "career"}, "group": {"displayName": "hitting"},
             "splits": [{"stat": {"atBats": 100}}]},
        ]}],
    }
    mocker.patch("fetch_data.statsapi.get", return_value=response)
    assert fetch_data._fetch_game_log(665489, "hitting", 2026) == []


# --- _fetch_game_log: cache hit/miss -------------------------------------

def test_fetch_game_log_cache_hit_signature_match_skips_api(mocker, tmp_path):
    """When signature matches cache, return cached splits — no API call."""
    cache_data = {
        "players": {
            "665489_hitting_2026": {
                "signature": "atBats=42|hits=14",
                "splits": [{"date": "2026-05-27", "stat": {"atBats": 4}}],
                "fetched_at": "2026-05-28T09:00:00+00:00",
            },
        },
    }
    cache_path = tmp_path / "cache.json"
    cache_path.write_text(json.dumps(cache_data))
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", cache_path)
    api_mock = mocker.patch("fetch_data.statsapi.get")
    result = fetch_data._fetch_game_log(665489, "hitting", 2026,
                                        stat_signature="atBats=42|hits=14")
    assert result == cache_data["players"]["665489_hitting_2026"]["splits"]
    api_mock.assert_not_called()


def test_fetch_game_log_cache_miss_signature_mismatch_fetches_fresh(mocker, tmp_path):
    """When signature doesn't match cache, fetch fresh and write back."""
    cache_data = {
        "players": {
            "665489_hitting_2026": {
                "signature": "atBats=40|hits=12",  # stale
                "splits": [{"old": "data"}],
                "fetched_at": "2026-05-27T09:00:00+00:00",
            },
        },
    }
    cache_path = tmp_path / "cache.json"
    cache_path.write_text(json.dumps(cache_data))
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", cache_path)
    fresh_splits = [{"new": "data"}]
    mocker.patch("fetch_data.statsapi.get",
                 return_value=_person_response("hitting", fresh_splits))
    result = fetch_data._fetch_game_log(665489, "hitting", 2026,
                                        stat_signature="atBats=42|hits=14")
    assert result == fresh_splits
    # Cache should have been updated with the new entry.
    assert fetch_data._GAMELOG_CACHE_DIRTY is True
    assert fetch_data._GAMELOG_CACHE["players"]["665489_hitting_2026"]["signature"] \
        == "atBats=42|hits=14"


def test_fetch_game_log_no_signature_provided_skips_cache_lookup(mocker, tmp_path):
    """Backwards-compatible: callers without signatures get fresh fetches."""
    cache_path = tmp_path / "cache.json"
    cache_path.write_text(json.dumps({"players": {
        "665489_hitting_2026": {"signature": "x", "splits": [{"a": 1}],
                                "fetched_at": "now"},
    }}))
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", cache_path)
    api_mock = mocker.patch("fetch_data.statsapi.get",
                            return_value=_person_response("hitting", [{"b": 2}]))
    result = fetch_data._fetch_game_log(665489, "hitting", 2026)
    api_mock.assert_called_once()
    assert result == [{"b": 2}]


def test_fetch_game_log_api_failure_with_cache_returns_stale_splits(mocker, tmp_path, capsys):
    """Defensive: API errors should fall back to stale cache, not lose data."""
    cache_data = {
        "players": {
            "665489_hitting_2026": {
                "signature": "old_sig",
                "splits": [{"stale": "but better than nothing"}],
                "fetched_at": "2026-05-27T09:00:00+00:00",
            },
        },
    }
    cache_path = tmp_path / "cache.json"
    cache_path.write_text(json.dumps(cache_data))
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", cache_path)
    mocker.patch("fetch_data.statsapi.get", side_effect=RuntimeError("boom"))
    result = fetch_data._fetch_game_log(665489, "hitting", 2026,
                                        stat_signature="new_sig")
    assert result == [{"stale": "but better than nothing"}]
    assert "gameLog fetch" in capsys.readouterr().err


def test_fetch_game_log_api_failure_no_cache_returns_empty(mocker, tmp_path):
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", tmp_path / "missing.json")
    mocker.patch("fetch_data.statsapi.get", side_effect=RuntimeError("boom"))
    assert fetch_data._fetch_game_log(665489, "hitting", 2026) == []


def test_fetch_game_log_successful_fetch_writes_to_cache(mocker, tmp_path):
    """A cache miss with signature must write the fresh result to cache."""
    mocker.patch.object(fetch_data, "GAMELOG_CACHE_PATH", tmp_path / "c.json")
    splits = [{"date": "2026-05-27", "stat": {"atBats": 4}}]
    mocker.patch("fetch_data.statsapi.get",
                 return_value=_person_response("hitting", splits))
    fetch_data._fetch_game_log(665489, "hitting", 2026, stat_signature="sig-abc")
    entry = fetch_data._GAMELOG_CACHE["players"]["665489_hitting_2026"]
    assert entry["signature"] == "sig-abc"
    assert entry["splits"] == splits
    assert "fetched_at" in entry
    assert fetch_data._GAMELOG_CACHE_DIRTY is True


# --- _split_date ----------------------------------------------------------

@pytest.mark.parametrize(
    "split,expected_iso",
    [
        pytest.param({"date": "2026-05-27"}, "2026-05-27", id="date_field"),
        pytest.param({"gameDate": "2026-05-27T19:05:00Z"}, "2026-05-27", id="gameDate_field"),
        pytest.param({"officialDate": "2026-05-27"}, "2026-05-27", id="officialDate_field"),
        pytest.param({"game": {"date": "2026-05-27"}}, "2026-05-27", id="nested_under_game"),
    ],
)
def test_split_date_extracts_from_multiple_field_names(split, expected_iso):
    result = fetch_data._split_date(split)
    assert result is not None
    assert result.isoformat() == expected_iso


def test_split_date_no_date_field_returns_none():
    assert fetch_data._split_date({}) is None
    assert fetch_data._split_date({"stat": {"atBats": 1}}) is None


# --- _aggregate_hitting_form / _aggregate_pitching_form ------------------

def test_aggregate_hitting_form_with_full_counts_returns_ops():
    """A 7-game window with raw atBats/hits/etc. computes OPS via OBP+SLG."""
    splits = [{"stat": {
        "atBats": 30, "hits": 12, "baseOnBalls": 4,
        "hitByPitch": 1, "sacFlies": 1, "doubles": 3,
        "triples": 0, "homeRuns": 2, "totalBases": 21,
    }}]
    result = fetch_data._aggregate_hitting_form(splits)
    assert result is not None
    # OBP = (12+4+1)/(30+4+1+1) = 17/36 = 0.4722
    # SLG = 21/30 = 0.7
    # OPS ≈ 1.172
    assert result == pytest.approx(0.4722 + 0.7, rel=1e-3)


def test_aggregate_hitting_form_zero_at_bats_returns_none():
    splits = [{"stat": {"atBats": 0, "hits": 0}}]
    assert fetch_data._aggregate_hitting_form(splits) is None


def test_aggregate_hitting_form_empty_splits_returns_none():
    assert fetch_data._aggregate_hitting_form([]) is None


def test_aggregate_hitting_form_derives_tb_when_missing():
    """When totalBases is 0, the function reconstructs from singles/2B/3B/HR."""
    splits = [{"stat": {
        "atBats": 4, "hits": 4, "doubles": 1, "triples": 0, "homeRuns": 1,
        "baseOnBalls": 0, "totalBases": 0,
    }}]
    # 2 singles + 1*2 + 1*4 = 8 total bases; SLG = 8/4 = 2.0
    result = fetch_data._aggregate_hitting_form(splits)
    assert result is not None
    assert result == pytest.approx(1.0 + 2.0, rel=1e-3)  # OBP=4/4=1, SLG=2


def test_aggregate_pitching_form_with_innings_returns_era():
    splits = [
        {"stat": {"earnedRuns": 2, "inningsPitched": "6.0"}},
        {"stat": {"earnedRuns": 1, "inningsPitched": "3.0"}},
    ]
    # ER=3, IP=9 → ERA = 3*9/9 = 3.0
    assert fetch_data._aggregate_pitching_form(splits) == pytest.approx(3.0)


def test_aggregate_pitching_form_zero_innings_returns_none():
    splits = [{"stat": {"earnedRuns": 0, "inningsPitched": "0.0"}}]
    assert fetch_data._aggregate_pitching_form(splits) is None


def test_aggregate_pitching_form_empty_splits_returns_none():
    assert fetch_data._aggregate_pitching_form([]) is None


def test_aggregate_pitching_form_handles_fractional_innings():
    splits = [{"stat": {"earnedRuns": 1, "inningsPitched": "6.2"}}]
    # IP = 6.667, ER=1 → ERA = 9/6.667 = 1.350
    assert fetch_data._aggregate_pitching_form(splits) == pytest.approx(1.350, rel=1e-2)
