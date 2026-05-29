"""Tests for tools/scan_notes_drift.py — the notes.json drift scanner."""
import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from tools import scan_notes_drift as sd


def _config(paths):
    return {"paths": paths}


def _empty_data():
    return {"roster": {"hitters": [], "pitchers": []}, "injuries": []}


# ---------------------------------------------------------------------------
# Regex / find_tokens
# ---------------------------------------------------------------------------

def test_find_tokens_basic():
    out = list(sd.find_tokens("Hello world"))
    assert out == [("Hello", 0)]


def test_find_tokens_multiple_capitals():
    names = [t[0] for t in sd.find_tokens("Foo went to Bar with Qux")]
    assert names == ["Foo", "Bar", "Qux"]


def test_find_tokens_skips_acronym_pluralization():
    """ABs, ERAs, RBIs must not yield trailing 'Bs', 'As', 'Is' tokens."""
    out = [t[0] for t in sd.find_tokens("188 ABs and 12 ERAs and 7 RBIs")]
    assert out == []


def test_find_tokens_accented_characters():
    names = [t[0] for t in sd.find_tokens("Berríos and González pitched")]
    assert "Berríos" in names
    assert "González" in names


def test_find_tokens_hyphenated_compound():
    names = [t[0] for t in sd.find_tokens("Jean-Luc threw a curve")]
    assert "Jean-Luc" in names


def test_find_tokens_apostrophe_compound():
    names = [t[0] for t in sd.find_tokens("O'Brien drove in two")]
    assert "O'Brien" in names


def test_find_tokens_all_caps_acronym_no_match():
    """Plain all-caps acronyms shouldn't match — they need lowercase."""
    out = [t[0] for t in sd.find_tokens("MLB MVP OBP SLG ERA WAR FIP")]
    assert out == []


def test_find_tokens_short_nickname():
    """Two-character names like 'Bo' must match for nickname coverage."""
    names = [t[0] for t in sd.find_tokens("Bo and Vlad walk a lot")]
    assert "Bo" in names
    assert "Vlad" in names


# ---------------------------------------------------------------------------
# build_name_dictionary
# ---------------------------------------------------------------------------

def test_build_name_dictionary_splits_full_names():
    data = {
        "roster": {
            "hitters": [{"name": "Vladimir Guerrero Jr."}],
            "pitchers": [{"name": "José Berríos"}],
        },
        "injuries": [{"name": "Bo Bichette"}],
    }
    d = sd.build_name_dictionary(data)
    assert {"Vladimir", "Guerrero", "Jr", "José", "Berríos", "Bo", "Bichette"} <= d


def test_build_name_dictionary_handles_missing_keys():
    assert sd.build_name_dictionary({}) == set()
    assert sd.build_name_dictionary({"roster": None, "injuries": None}) == set()
    assert sd.build_name_dictionary({"roster": {"hitters": None}}) == set()


def test_build_name_dictionary_strips_trailing_punctuation():
    """Names like 'Jr.' should land as 'Jr' (no period) in the dictionary."""
    data = {
        "roster": {
            "hitters": [{"name": "Ronald Acuña Jr."}],
            "pitchers": [],
        },
        "injuries": [],
    }
    d = sd.build_name_dictionary(data)
    assert "Jr" in d
    assert "Jr." not in d


# ---------------------------------------------------------------------------
# strip_html
# ---------------------------------------------------------------------------

def test_strip_html_removes_tags():
    assert "hi" in sd.strip_html("<strong>hi</strong>")
    assert "<strong>" not in sd.strip_html("<strong>hi</strong>")


def test_strip_html_adjacent_tags_dont_merge_words():
    """<strong>foo</strong><em>bar</em> must yield two tokens, not 'foobar'."""
    out = sd.strip_html("<strong>foo</strong><em>bar</em>").split()
    assert out == ["foo", "bar"]


# ---------------------------------------------------------------------------
# walk_path
# ---------------------------------------------------------------------------

def test_walk_path_descends_into_key():
    obj = {"foo": {"bar": "hello"}}
    assert list(sd.walk_path(obj, ["foo", "bar"], "root")) == [("root.foo.bar", "hello")]


def test_walk_path_array_iterates_strings():
    obj = {"items": ["a", "b", "c"]}
    out = list(sd.walk_path(obj, ["items[]"], "root"))
    assert out == [
        ("root.items[0]", "a"),
        ("root.items[1]", "b"),
        ("root.items[2]", "c"),
    ]


def test_walk_path_object_wildcard_keys():
    obj = {"map": {"k1": "v1", "k2": "v2"}}
    out = dict(sd.walk_path(obj, ["map{}"], "root"))
    assert out == {"root.map[k1]": "v1", "root.map[k2]": "v2"}


def test_walk_path_nested_wildcard_then_field():
    obj = {"players": {"123": {"note": "vlad"}, "456": {"note": "bo"}}}
    out = dict(sd.walk_path(obj, ["players{}", "note"], "root"))
    assert out == {
        "root.players[123].note": "vlad",
        "root.players[456].note": "bo",
    }


def test_walk_path_object_of_objects_of_strings():
    """players{}.contextNotes{} — nested object iter."""
    obj = {"players": {"1": {"contextNotes": {"avg": "good"}}}}
    out = dict(sd.walk_path(obj, ["players{}", "contextNotes{}"], "root"))
    assert out == {"root.players[1].contextNotes[avg]": "good"}


def test_walk_path_missing_key_returns_empty():
    assert list(sd.walk_path({"foo": {}}, ["foo", "missing"], "root")) == []


def test_walk_path_skips_non_string_terminals():
    assert list(sd.walk_path({"foo": 42}, ["foo"], "root")) == []


def test_walk_path_handles_missing_top_level():
    """Notes file without a 'team' key shouldn't crash the scanner."""
    assert list(sd.walk_path({}, ["team", "strengths[]"], "root")) == []


# ---------------------------------------------------------------------------
# scan (integration of the above)
# ---------------------------------------------------------------------------

def test_scan_no_findings_when_corpus_clean():
    notes = {"team": {"strengths": ["Patient at-bat work at the top"]}}
    config = _config([{"path": "team.strengths[]", "html": False}])
    assert sd.scan(notes, _empty_data(), config, {}) == []


def test_scan_flags_unknown_capitalized_name():
    notes = {"team": {"strengths": ["Bichette walks at career-high rates"]}}
    config = _config([{"path": "team.strengths[]", "html": False}])
    findings = sd.scan(notes, _empty_data(), config, {})
    assert len(findings) == 1
    assert findings[0]["token"] == "Bichette"
    assert findings[0]["path"] == "notes.team.strengths[0]"
    assert findings[0]["reason"] == "not_in_roster_or_il"
    assert "Bichette" in findings[0]["snippet"]


def test_scan_suppresses_known_name():
    notes = {"team": {"strengths": ["Bichette walks at career-high rates"]}}
    data = {
        "roster": {"hitters": [{"name": "Bo Bichette"}], "pitchers": []},
        "injuries": [],
    }
    config = _config([{"path": "team.strengths[]", "html": False}])
    assert sd.scan(notes, data, config, {}) == []


def test_scan_whitelist_suppresses_finding():
    notes = {"team": {"strengths": ["Vlad walks at career-high rates"]}}
    config = _config([{"path": "team.strengths[]", "html": False}])
    allow = {"tokens": ["Vlad"]}
    assert sd.scan(notes, _empty_data(), config, allow) == []


def test_scan_noscan_marker_skips_field():
    notes = {"team": {"strengths": ["Bichette is great. <!-- noscan -->"]}}
    config = _config([{"path": "team.strengths[]", "html": False}])
    assert sd.scan(notes, _empty_data(), config, {}) == []


def test_scan_strips_html_when_html_true():
    notes = {"team": {"strengths": ["<strong>Bichette</strong> is hot"]}}
    config = _config([{"path": "team.strengths[]", "html": True}])
    findings = sd.scan(notes, _empty_data(), config, {})
    assert len(findings) == 1
    assert findings[0]["token"] == "Bichette"


def test_scan_does_not_strip_html_when_html_false():
    """Tags stay literal in scan_text — token regex would skip 'strong' (lowercase)."""
    notes = {"team": {"strengths": ["<strong>Bichette</strong> is hot"]}}
    config = _config([{"path": "team.strengths[]", "html": False}])
    findings = sd.scan(notes, _empty_data(), config, {})
    assert len(findings) == 1
    assert findings[0]["token"] == "Bichette"


def test_scan_walks_pitches_object():
    """pitches{} path walks an object with arbitrary string keys."""
    notes = {"pitches": {"Splitter": "Bichette likes splitters"}}
    config = _config([{"path": "pitches{}", "html": False}])
    findings = sd.scan(notes, _empty_data(), config, {})
    assert len(findings) == 1
    assert findings[0]["path"] == "notes.pitches[Splitter]"
    assert findings[0]["token"] == "Bichette"


def test_scan_walks_nested_players_field():
    notes = {"players": {"123": {"read": "Bichette is patient"}}}
    config = _config([{"path": "players{}.read", "html": True}])
    findings = sd.scan(notes, _empty_data(), config, {})
    assert findings[0]["path"] == "notes.players[123].read"


def test_scan_walks_doubly_nested_object_wildcards():
    """players{}.contextNotes{} pattern."""
    notes = {
        "players": {
            "123": {"contextNotes": {"avg": "Bichette has consistent contact"}}
        }
    }
    config = _config([{"path": "players{}.contextNotes{}", "html": False}])
    findings = sd.scan(notes, _empty_data(), config, {})
    assert len(findings) == 1
    assert findings[0]["path"] == "notes.players[123].contextNotes[avg]"


def test_scan_stopwords_suppress_common_sentence_starts():
    notes = {
        "overview": {
            "paragraphs": [
                "The rotation is the question. Until someone fixes it..."
            ],
        }
    }
    config = _config([{"path": "overview.paragraphs[]", "html": False}])
    assert sd.scan(notes, _empty_data(), config, {}) == []


def test_scan_acronym_pluralization_not_flagged():
    notes = {"players": {"1": {"read": "Through 188 ABs the OPS is .350"}}}
    config = _config([{"path": "players{}.read", "html": True}])
    assert sd.scan(notes, _empty_data(), config, {}) == []


def test_scan_multiple_findings_in_one_field():
    notes = {"team": {"strengths": ["Bichette and Stripling are key"]}}
    config = _config([{"path": "team.strengths[]", "html": False}])
    findings = sd.scan(notes, _empty_data(), config, {})
    tokens = {f["token"] for f in findings}
    assert tokens == {"Bichette", "Stripling"}


def test_scan_missing_top_level_keys_does_not_crash():
    notes = {}  # No team, no players, no nothing
    config = _config([
        {"path": "team.strengths[]", "html": False},
        {"path": "players{}.read", "html": True},
    ])
    assert sd.scan(notes, _empty_data(), config, {}) == []


# ---------------------------------------------------------------------------
# Real-file integration
# ---------------------------------------------------------------------------

def test_integration_real_files_scan_clean():
    """The current notes.json + data.json + .notes-scan-allow.json scan
    cleanly. If this fails on a future change, the author has three
    options: fix the note, add to the whitelist, or expand stopwords."""
    notes = sd.load_json(REPO_ROOT / "notes.json")
    data = sd.load_json(REPO_ROOT / "data.json")
    paths = sd.load_json(REPO_ROOT / "tools" / "notes_drift_paths.json")
    allow = sd.load_json(REPO_ROOT / ".notes-scan-allow.json")
    findings = sd.scan(notes, data, paths, allow)
    assert findings == [], (
        "Real-file scan should be clean. Findings: "
        + json.dumps(findings, indent=2)
    )


# ---------------------------------------------------------------------------
# main() entry point — exit codes and modes
# ---------------------------------------------------------------------------

def _write_fixture_files(tmp_path, notes_obj, data_obj, paths_obj, allow_obj=None):
    notes_p = tmp_path / "notes.json"
    notes_p.write_text(json.dumps(notes_obj))
    data_p = tmp_path / "data.json"
    data_p.write_text(json.dumps(data_obj))
    paths_p = tmp_path / "paths.json"
    paths_p.write_text(json.dumps(paths_obj))
    allow_p = tmp_path / "allow.json"
    if allow_obj is not None:
        allow_p.write_text(json.dumps(allow_obj))
    return notes_p, data_p, paths_p, allow_p


def test_main_returns_zero_when_clean(tmp_path):
    notes_p, data_p, paths_p, allow_p = _write_fixture_files(
        tmp_path,
        {"team": {"strengths": ["Patient at-bat work"]}},
        _empty_data(),
        _config([{"path": "team.strengths[]", "html": False}]),
        allow_obj={"tokens": []},
    )
    rc = sd.main([
        "--notes", str(notes_p), "--data", str(data_p),
        "--paths", str(paths_p), "--allow", str(allow_p),
    ])
    assert rc == 0


def test_main_returns_one_on_findings(tmp_path):
    notes_p, data_p, paths_p, allow_p = _write_fixture_files(
        tmp_path,
        {"team": {"strengths": ["Bichette is hot"]}},
        _empty_data(),
        _config([{"path": "team.strengths[]", "html": False}]),
    )
    rc = sd.main([
        "--notes", str(notes_p), "--data", str(data_p),
        "--paths", str(paths_p), "--allow", str(tmp_path / "missing.json"),
    ])
    assert rc == 1


def test_main_warn_only_returns_zero_even_with_findings(tmp_path):
    notes_p, data_p, paths_p, allow_p = _write_fixture_files(
        tmp_path,
        {"team": {"strengths": ["Bichette is hot"]}},
        _empty_data(),
        _config([{"path": "team.strengths[]", "html": False}]),
    )
    rc = sd.main([
        "--notes", str(notes_p), "--data", str(data_p),
        "--paths", str(paths_p), "--allow", str(tmp_path / "missing.json"),
        "--warn-only",
    ])
    assert rc == 0


def test_main_json_mode_outputs_structured_findings(tmp_path, capsys):
    notes_p, data_p, paths_p, allow_p = _write_fixture_files(
        tmp_path,
        {"team": {"strengths": ["Bichette is hot"]}},
        _empty_data(),
        _config([{"path": "team.strengths[]", "html": False}]),
    )
    sd.main([
        "--notes", str(notes_p), "--data", str(data_p),
        "--paths", str(paths_p), "--allow", str(tmp_path / "missing.json"),
        "--json",
    ])
    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert payload["count"] == 1
    assert payload["findings"][0]["token"] == "Bichette"


def test_main_missing_allow_file_is_optional(tmp_path):
    """No allow file present should not crash — it's an optional input."""
    notes_p, data_p, paths_p, _ = _write_fixture_files(
        tmp_path,
        {"team": {"strengths": ["Patient at-bat work"]}},
        _empty_data(),
        _config([{"path": "team.strengths[]", "html": False}]),
    )
    rc = sd.main([
        "--notes", str(notes_p), "--data", str(data_p),
        "--paths", str(paths_p), "--allow", str(tmp_path / "absent.json"),
    ])
    assert rc == 0


def test_main_config_flag_false_skips_scan(tmp_path, capsys):
    """When config.scan_notes_drift=false, main() returns 0 without scanning."""
    notes_p, data_p, paths_p, _ = _write_fixture_files(
        tmp_path,
        {"team": {"strengths": ["Bichette is hot"]}},  # would normally flag
        _empty_data(),
        _config([{"path": "team.strengths[]", "html": False}]),
    )
    config_p = tmp_path / "config.json"
    config_p.write_text(json.dumps({"scan_notes_drift": False}))
    rc = sd.main([
        "--notes", str(notes_p), "--data", str(data_p),
        "--paths", str(paths_p), "--allow", str(tmp_path / "absent.json"),
        "--config", str(config_p),
    ])
    assert rc == 0
    err = capsys.readouterr().err
    assert "disabled" in err.lower()


def test_main_config_flag_true_runs_scan(tmp_path):
    """When config.scan_notes_drift=true, scanner runs as normal."""
    notes_p, data_p, paths_p, _ = _write_fixture_files(
        tmp_path,
        {"team": {"strengths": ["Bichette is hot"]}},
        _empty_data(),
        _config([{"path": "team.strengths[]", "html": False}]),
    )
    config_p = tmp_path / "config.json"
    config_p.write_text(json.dumps({"scan_notes_drift": True}))
    rc = sd.main([
        "--notes", str(notes_p), "--data", str(data_p),
        "--paths", str(paths_p), "--allow", str(tmp_path / "absent.json"),
        "--config", str(config_p),
    ])
    assert rc == 1  # findings present, not warn-only


def test_main_config_missing_flag_defaults_to_enabled(tmp_path):
    """Config without scan_notes_drift key → default True → scanner runs."""
    notes_p, data_p, paths_p, _ = _write_fixture_files(
        tmp_path,
        {"team": {"strengths": ["Bichette is hot"]}},
        _empty_data(),
        _config([{"path": "team.strengths[]", "html": False}]),
    )
    config_p = tmp_path / "config.json"
    config_p.write_text(json.dumps({"team_id": 141}))  # no scan flag
    rc = sd.main([
        "--notes", str(notes_p), "--data", str(data_p),
        "--paths", str(paths_p), "--allow", str(tmp_path / "absent.json"),
        "--config", str(config_p),
    ])
    assert rc == 1  # finding present


def test_main_missing_config_file_is_optional(tmp_path):
    """Config file absent → scanner runs as normal."""
    notes_p, data_p, paths_p, _ = _write_fixture_files(
        tmp_path,
        {"team": {"strengths": ["Patient at-bat work"]}},
        _empty_data(),
        _config([{"path": "team.strengths[]", "html": False}]),
    )
    rc = sd.main([
        "--notes", str(notes_p), "--data", str(data_p),
        "--paths", str(paths_p), "--allow", str(tmp_path / "absent.json"),
        "--config", str(tmp_path / "no-config.json"),
    ])
    assert rc == 0
