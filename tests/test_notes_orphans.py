"""Tests for tools/scan_notes_orphans.py — the notes.json keyed-orphan scanner."""
import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from tools import scan_notes_orphans as so


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

def _data(*, hitters=(), pitchers=(), injuries=(), other=()):
    """data.json shape — only the fields the scanner reads."""
    return {
        "roster": {
            "hitters": [{"id": i} for i in hitters],
            "pitchers": [{"id": i} for i in pitchers],
        },
        "injuries": [{"person_id": i} for i in injuries],
        "other_unavailable": [{"person_id": i} for i in other],
    }


def _notes(*, players=None, injuries=None):
    out = {}
    if players is not None:
        out["players"] = {str(k): v for k, v in players.items()}
    if injuries is not None:
        out["injuries"] = {str(k): v for k, v in injuries.items()}
    return out


# ---------------------------------------------------------------------------
# build_id_sets
# ---------------------------------------------------------------------------

def test_build_id_sets_combines_hitters_and_pitchers():
    roster, il, other = so.build_id_sets(_data(hitters=[1, 2], pitchers=[3]))
    assert roster == {1, 2, 3}
    assert il == set()
    assert other == set()


def test_build_id_sets_reads_injuries_person_id():
    _, il, _ = so.build_id_sets(_data(injuries=[100, 200]))
    assert il == {100, 200}


def test_build_id_sets_reads_other_unavailable_person_id():
    _, _, other = so.build_id_sets(_data(other=[500]))
    assert other == {500}


def test_build_id_sets_missing_top_level_keys_returns_empty():
    roster, il, other = so.build_id_sets({})
    assert roster == set() and il == set() and other == set()


def test_build_id_sets_skips_non_int_ids():
    data = {
        "roster": {"hitters": [{"id": "not-a-number"}, {"id": 7}], "pitchers": []},
        "injuries": [{"person_id": None}, {"person_id": 99}],
        "other_unavailable": [],
    }
    roster, il, _ = so.build_id_sets(data)
    assert roster == {7}
    assert il == {99}


# ---------------------------------------------------------------------------
# scan — players keyspace
# ---------------------------------------------------------------------------

def test_scan_player_orphan_flagged():
    data = _data(hitters=[1])
    notes = _notes(players={999: {"recentNote": "Stale entry"}})
    findings = so.scan(notes, data, {})
    assert len(findings) == 1
    assert findings[0]["path"] == "notes.players[999]"
    assert findings[0]["key"] == 999
    assert findings[0]["reason"] == "id_not_in_roster_or_il"


def test_scan_player_on_roster_not_flagged():
    data = _data(hitters=[665487])
    notes = _notes(players={665487: {"recentNote": "Active player"}})
    assert so.scan(notes, data, {}) == []


def test_scan_player_on_il_not_flagged():
    """A player can have notes while on the IL — still 'our' player."""
    data = _data(hitters=[1], injuries=[2])
    notes = _notes(players={2: {"recentNote": "On the shelf for a while"}})
    assert so.scan(notes, data, {}) == []


def test_scan_player_on_other_unavailable_not_flagged():
    data = _data(other=[3])
    notes = _notes(players={3: {"recentNote": "Reassigned but still ours"}})
    assert so.scan(notes, data, {}) == []


def test_scan_player_orphan_allowlisted_not_flagged():
    data = _data(hitters=[1])
    notes = _notes(players={999: {"recentNote": "Keep this one"}})
    findings = so.scan(notes, data, {"orphan_ids": [999]})
    assert findings == []


# ---------------------------------------------------------------------------
# scan — injuries keyspace
# ---------------------------------------------------------------------------

def test_scan_injury_orphan_flagged():
    data = _data(hitters=[1])  # nobody on IL
    notes = _notes(injuries={42: {"detail": "Old injury"}})
    findings = so.scan(notes, data, {})
    assert len(findings) == 1
    assert findings[0]["path"] == "notes.injuries[42]"
    assert findings[0]["reason"] == "id_not_on_injured_list"


def test_scan_injury_for_il_player_not_flagged():
    data = _data(injuries=[100])
    notes = _notes(injuries={100: {"detail": "On the IL"}})
    assert so.scan(notes, data, {}) == []


def test_scan_injury_for_active_player_is_orphan():
    """A roster player who's NOT on the IL is an injury-note orphan."""
    data = _data(hitters=[10])
    notes = _notes(injuries={10: {"detail": "But they're playing now"}})
    findings = so.scan(notes, data, {})
    assert len(findings) == 1
    assert findings[0]["key"] == 10


# ---------------------------------------------------------------------------
# scan — combined
# ---------------------------------------------------------------------------

def test_scan_returns_findings_across_both_keyspaces():
    data = _data(hitters=[1], injuries=[2])
    notes = _notes(
        players={1: {"recentNote": "ok"}, 999: {"recentNote": "orphan"}},
        injuries={2: {"detail": "ok"}, 888: {"detail": "stale"}},
    )
    findings = so.scan(notes, data, {})
    paths = {f["path"] for f in findings}
    assert paths == {"notes.players[999]", "notes.injuries[888]"}


def test_scan_non_integer_keys_silently_skipped():
    """A keys-as-strings note like 'overview' shouldn't crash the scanner."""
    data = _data()
    notes = {"players": {"not-a-number": {"recentNote": "x"}}}
    assert so.scan(notes, data, {}) == []


def test_scan_empty_notes_returns_empty_findings():
    assert so.scan({}, _data(), {}) == []


# ---------------------------------------------------------------------------
# _snippet_from_value
# ---------------------------------------------------------------------------

def test_snippet_prefers_recent_note_in_player_dict():
    snip = so._snippet_from_value({"recentNote": "Hot stretch", "read": "Long paragraph"})
    assert snip == "Hot stretch"


def test_snippet_prefers_detail_then_eta_in_injury_dict():
    snip = so._snippet_from_value({"detail": "Strained oblique", "eta": "2 weeks"})
    assert snip == "Strained oblique"


def test_snippet_truncates_long_strings():
    long = "x" * 200
    snip = so._snippet_from_value({"recentNote": long})
    assert len(snip) <= 80 and snip.endswith("...")


def test_snippet_handles_missing_known_keys():
    snip = so._snippet_from_value({"unknown_key": "value"})
    assert snip == ""


# ---------------------------------------------------------------------------
# format_findings_text
# ---------------------------------------------------------------------------

def test_format_findings_text_has_orphan_prefix_and_count():
    findings = [{
        "path": "notes.players[999]",
        "key": 999,
        "snippet": "Stale note",
        "reason": "id_not_in_roster_or_il",
    }]
    out = so.format_findings_text(findings)
    assert "ORPHAN notes.players[999]" in out
    assert "reason: id_not_in_roster_or_il" in out
    assert "1 orphan finding(s)." in out


def test_format_findings_text_handles_empty_snippet():
    findings = [{
        "path": "notes.players[1]", "key": 1,
        "snippet": "", "reason": "id_not_in_roster_or_il",
    }]
    out = so.format_findings_text(findings)
    assert "(no preview)" in out


# ---------------------------------------------------------------------------
# main() — CLI entry
# ---------------------------------------------------------------------------

def _write(tmp_path, name, payload):
    p = tmp_path / name
    p.write_text(json.dumps(payload))
    return p


def test_main_exits_zero_on_clean_corpus(tmp_path, capsys):
    notes = _write(tmp_path, "notes.json", _notes(players={1: {"recentNote": "ok"}}))
    data = _write(tmp_path, "data.json", _data(hitters=[1]))
    rc = so.main(["--notes", str(notes), "--data", str(data),
                  "--config", str(tmp_path / "missing.json")])
    assert rc == 0
    assert "No orphan findings." in capsys.readouterr().err


def test_main_exits_one_on_findings(tmp_path):
    notes = _write(tmp_path, "notes.json", _notes(players={999: {"recentNote": "stale"}}))
    data = _write(tmp_path, "data.json", _data(hitters=[1]))
    rc = so.main(["--notes", str(notes), "--data", str(data),
                  "--config", str(tmp_path / "missing.json")])
    assert rc == 1


def test_main_warn_only_exits_zero_even_with_findings(tmp_path):
    notes = _write(tmp_path, "notes.json", _notes(players={999: {"recentNote": "stale"}}))
    data = _write(tmp_path, "data.json", _data(hitters=[1]))
    rc = so.main(["--notes", str(notes), "--data", str(data),
                  "--config", str(tmp_path / "missing.json"), "--warn-only"])
    assert rc == 0


def test_main_json_output(tmp_path, capsys):
    notes = _write(tmp_path, "notes.json", _notes(players={999: {"recentNote": "stale"}}))
    data = _write(tmp_path, "data.json", _data(hitters=[1]))
    rc = so.main(["--notes", str(notes), "--data", str(data),
                  "--config", str(tmp_path / "missing.json"),
                  "--json", "--warn-only"])
    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["count"] == 1
    assert payload["findings"][0]["key"] == 999


def test_main_respects_config_flag_disabled(tmp_path, capsys):
    notes = _write(tmp_path, "notes.json", _notes(players={999: {"recentNote": "stale"}}))
    data = _write(tmp_path, "data.json", _data(hitters=[1]))
    config = _write(tmp_path, "config.json", {"scan_notes_orphans": False})
    rc = so.main(["--notes", str(notes), "--data", str(data),
                  "--config", str(config)])
    assert rc == 0
    assert "scan_notes_orphans disabled per config" in capsys.readouterr().err


def test_main_config_flag_default_true_when_absent(tmp_path):
    notes = _write(tmp_path, "notes.json", _notes(players={999: {"recentNote": "stale"}}))
    data = _write(tmp_path, "data.json", _data(hitters=[1]))
    config = _write(tmp_path, "config.json", {})  # no flag set
    rc = so.main(["--notes", str(notes), "--data", str(data),
                  "--config", str(config)])
    assert rc == 1  # ran scan, found orphan, exit 1


def test_main_reads_allow_file(tmp_path):
    notes = _write(tmp_path, "notes.json", _notes(players={999: {"recentNote": "keep"}}))
    data = _write(tmp_path, "data.json", _data(hitters=[1]))
    allow = _write(tmp_path, "allow.json", {"orphan_ids": [999]})
    rc = so.main(["--notes", str(notes), "--data", str(data),
                  "--allow", str(allow),
                  "--config", str(tmp_path / "missing.json")])
    assert rc == 0


# ---------------------------------------------------------------------------
# Integration — real repo files
# ---------------------------------------------------------------------------

def test_integration_real_files_scan_clean():
    """The committed notes.json must not have orphan keys vs the committed data.json.

    If this fails on a PR: the author added a notes entry whose ID
    doesn't match any roster / IL / other-unavailable entry. Either
    fix the ID, prune the orphan, or add the ID to .notes-scan-allow.json's
    `orphan_ids` if there's a reason to keep it.
    """
    notes = so.load_json(REPO_ROOT / "notes.json")
    data = so.load_json(REPO_ROOT / "data.json")
    allow = {}
    allow_path = REPO_ROOT / ".notes-scan-allow.json"
    if allow_path.exists():
        allow = so.load_json(allow_path)
    findings = so.scan(notes, data, allow)
    assert findings == [], "\n" + so.format_findings_text(findings)
