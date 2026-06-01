"""Tests for tools/check_notes_freshness.py — the workflow staleness scanner."""
import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "tools"))

from tools import check_notes_freshness as cf


# --- scan -----------------------------------------------------------------

def test_scan_empty_when_age_none():
    assert cf.scan(None) == []


def test_scan_empty_when_age_zero():
    """0 days = refreshed today = clean."""
    assert cf.scan(0) == []


def test_scan_empty_when_under_all_thresholds():
    """Lowest threshold is overview at 7d. 6d is under everything."""
    assert cf.scan(6) == []


def test_scan_flags_overview_at_8_days():
    findings = cf.scan(8)
    sections = {f["section"] for f in findings}
    assert "overview" in sections
    assert "team" not in sections  # threshold 14d


def test_scan_flags_overview_and_others_at_15_days():
    findings = cf.scan(15)
    sections = {f["section"] for f in findings}
    # overview (7), team (14), players (14), injuries (14) all exceeded
    assert "overview" in sections
    assert "team" in sections
    assert "players" in sections
    assert "injuries" in sections


def test_scan_skips_section_with_none_threshold():
    """The 'games' section has threshold=None (historical, never expires)."""
    findings = cf.scan(1000)
    sections = {f["section"] for f in findings}
    assert "games" not in sections


def test_scan_finding_shape():
    findings = cf.scan(8)
    assert findings, "expected at least overview finding"
    f = findings[0]
    assert "section" in f
    assert "age_days" in f
    assert "threshold_days" in f
    assert "cadence_label" in f


def test_scan_age_equal_to_threshold_is_not_flagged():
    """At exactly the threshold, we're 'on time' — flag at threshold+1."""
    findings = cf.scan(7)
    sections = {f["section"] for f in findings}
    assert "overview" not in sections  # 7 == 7 → ok


# --- format_findings_text -------------------------------------------------

def test_format_findings_has_warn_prefix_and_count():
    findings = [{
        "section": "overview", "age_days": 10,
        "threshold_days": 7, "cadence_label": "weekly",
    }]
    out = cf.format_findings_text(findings)
    assert "WARN notes.overview" in out
    assert "10d old" in out
    assert "threshold: 7d" in out
    assert "1 freshness finding(s)." in out


def test_format_findings_includes_docs_pointer():
    findings = [{
        "section": "team", "age_days": 20,
        "threshold_days": 14, "cadence_label": "bi-weekly",
    }]
    out = cf.format_findings_text(findings)
    assert "docs/authoring-notes.md" in out


def test_format_findings_multiple_sections():
    findings = [
        {"section": "overview", "age_days": 20, "threshold_days": 7, "cadence_label": "weekly"},
        {"section": "team", "age_days": 20, "threshold_days": 14, "cadence_label": "bi-weekly"},
    ]
    out = cf.format_findings_text(findings)
    assert "notes.overview" in out
    assert "notes.team" in out
    assert "2 freshness finding(s)." in out


# --- main() CLI -----------------------------------------------------------

def _write(tmp_path, name, payload):
    p = tmp_path / name
    p.write_text(json.dumps(payload))
    return p


def test_main_clean_corpus_exits_zero(tmp_path, capsys):
    """With --age-days 0 and no config disabling, scan is clean → exit 0."""
    rc = cf.main(["--age-days", "0",
                  "--config", str(tmp_path / "missing.json")])
    assert rc == 0
    err = capsys.readouterr().err
    assert "within cadence" in err


def test_main_findings_exit_one(tmp_path):
    rc = cf.main(["--age-days", "30",
                  "--config", str(tmp_path / "missing.json")])
    assert rc == 1


def test_main_warn_only_always_exits_zero(tmp_path):
    rc = cf.main(["--age-days", "30", "--warn-only",
                  "--config", str(tmp_path / "missing.json")])
    assert rc == 0


def test_main_json_mode_payload(tmp_path, capsys):
    rc = cf.main(["--age-days", "10", "--json", "--warn-only",
                  "--config", str(tmp_path / "missing.json")])
    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["age_days"] == 10
    assert payload["count"] >= 1


def test_main_respects_config_flag_disabled(tmp_path, capsys):
    """When config.check_notes_freshness is false, scanner no-ops."""
    config = _write(tmp_path, "config.json", {"check_notes_freshness": False})
    rc = cf.main(["--age-days", "30", "--config", str(config)])
    assert rc == 0
    assert "disabled per config" in capsys.readouterr().err


def test_main_config_flag_default_true_when_absent(tmp_path):
    """No flag in config → defaults to true → scanner runs normally."""
    config = _write(tmp_path, "config.json", {})
    rc = cf.main(["--age-days", "30", "--config", str(config)])
    assert rc == 1


def test_main_config_flag_explicit_true(tmp_path):
    config = _write(tmp_path, "config.json", {"check_notes_freshness": True})
    rc = cf.main(["--age-days", "30", "--config", str(config)])
    assert rc == 1


def test_main_unknown_age_text_mode(tmp_path, capsys, monkeypatch):
    """When notes_last_updated_iso returns None and no --age-days, age is None."""
    monkeypatch.setattr(cf, "notes_last_updated_iso", lambda: None)
    rc = cf.main(["--config", str(tmp_path / "missing.json")])
    assert rc == 0  # no findings when age unknown
    assert "unknown" in capsys.readouterr().err


def test_main_unknown_age_json_mode(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(cf, "notes_last_updated_iso", lambda: None)
    rc = cf.main(["--config", str(tmp_path / "missing.json"), "--json"])
    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["age_days"] is None
    assert payload["count"] == 0


# --- integration: real repo files ----------------------------------------

def test_integration_real_files_within_cadence():
    """Sanity: the committed notes.json shouldn't be way overdue on every section."""
    # We use whatever the real notes mtime is; the test will fail if
    # notes.json has been untouched for 60+ days (rare).
    age = cf._days_since(cf.notes_last_updated_iso())
    findings = cf.scan(age)
    # At least the 'pitches' section (rare cadence, 60d threshold) should be clean
    # under normal authoring cadence.
    pitches_findings = [f for f in findings if f["section"] == "pitches"]
    assert pitches_findings == [], (
        "notes.json is 60+ days untouched — full refresh needed"
    )
