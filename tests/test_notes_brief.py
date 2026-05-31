"""Tests for tools/draft_notes_brief.py — the analyst-voice prep brief."""
import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from tools import draft_notes_brief as br


def _data(*, hitters=(), pitchers=(), injuries=(), other=(), team=None):
    team = team or {
        "record": {"w": 27, "l": 29},
        "place": "3rd in AL East",
        "last10": "6-4",
        "streak": "W2",
        "runs_scored": 215,
        "runs_allowed": 227,
        "run_diff": -12,
    }
    return {
        "roster": {
            "hitters": [
                {"id": h[0], "name": h[1], "recent": h[2] if len(h) > 2 else None}
                for h in hitters
            ],
            "pitchers": [
                {"id": p[0], "name": p[1], "recent": p[2] if len(p) > 2 else None}
                for p in pitchers
            ],
        },
        "injuries": [{"person_id": pid, "name": f"IL-{pid}", "status": "Injured List - 10-Day"}
                     for pid in injuries],
        "other_unavailable": [{"person_id": pid, "name": f"Other-{pid}"} for pid in other],
        "team": team,
    }


def _notes(*, players=None, injuries=None):
    out = {}
    if players is not None:
        out["players"] = {str(k): v for k, v in players.items()}
    if injuries is not None:
        out["injuries"] = {str(k): v for k, v in injuries.items()}
    return out


# --- staleness helpers ----------------------------------------------------

def test_staleness_label_green_under_amber_threshold():
    assert br._staleness_label(3) == "GREEN"


def test_staleness_label_amber_between_thresholds():
    assert br._staleness_label(10) == "AMBER"


def test_staleness_label_red_over_red_threshold():
    assert br._staleness_label(21) == "RED"


def test_staleness_label_unknown_returns_question_mark():
    assert br._staleness_label(None) == "?"


def test_days_since_recent_iso_returns_small_number():
    from datetime import datetime, timezone, timedelta
    iso = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    assert br._days_since(iso) == 3


def test_days_since_none_returns_none():
    assert br._days_since(None) is None
    assert br._days_since("") is None


def test_days_since_bad_iso_returns_none():
    assert br._days_since("not-a-date") is None


# --- header_section -------------------------------------------------------

def test_header_section_includes_age_and_label():
    lines = br.header_section(3)
    text = "\n".join(lines)
    assert "3 days old" in text
    assert "GREEN" in text


def test_header_section_today():
    lines = br.header_section(0)
    assert "refreshed today" in "\n".join(lines)


def test_header_section_one_day_uses_singular():
    lines = br.header_section(1)
    assert "1 day old" in "\n".join(lines)


def test_header_section_unknown_age():
    lines = br.header_section(None)
    assert "unknown" in "\n".join(lines)


# --- team_state_section ---------------------------------------------------

def test_team_state_section_reads_record():
    data = _data()
    lines = br.team_state_section(data)
    text = "\n".join(lines)
    assert "27-29" in text
    assert "3rd in AL East" in text


def test_team_state_section_reads_last10_string():
    """last10 is a 'W-L' string in real data, not a dict."""
    data = _data(team={"record": {"w": 1, "l": 0}, "last10": "8-2", "streak": "W4",
                       "run_diff": -2, "runs_scored": 234, "runs_allowed": 236})
    lines = br.team_state_section(data)
    assert "Last 10: 8-2" in "\n".join(lines)


def test_team_state_section_run_diff_signed():
    data = _data()
    assert "-12" in "\n".join(br.team_state_section(data))


def test_team_state_section_run_diff_positive_signed():
    data = _data(team={"record": {"w": 1, "l": 0}, "last10": "5-5", "streak": "",
                       "run_diff": 7, "runs_scored": 100, "runs_allowed": 93})
    assert "+7" in "\n".join(br.team_state_section(data))


def test_team_state_section_handles_empty_team():
    """Defensive: missing team object shouldn't crash."""
    lines = br.team_state_section({})
    assert any("Record:" in line for line in lines)


# --- hot_cold_section -----------------------------------------------------

def test_hot_cold_section_partitions_by_tag():
    data = _data(
        hitters=[(1, "Hot Hitter", "hot"), (2, "Cold Hitter", "cold"),
                 (3, "New Hitter", "new"), (4, "Neutral", None)],
        pitchers=[(5, "Hot Pitcher", "hot")],
    )
    lines = br.hot_cold_section(data)
    text = "\n".join(lines)
    assert "Hot Hitter" in text
    assert "Hot Pitcher" in text
    assert "Cold Hitter" in text
    assert "New Hitter" in text
    assert "Neutral" not in text


def test_hot_cold_section_handles_empty_groups():
    lines = br.hot_cold_section({"roster": {"hitters": [], "pitchers": []}})
    text = "\n".join(lines)
    assert "(none)" in text


def test_hot_cold_section_counts_in_header():
    data = _data(hitters=[(1, "A", "hot"), (2, "B", "hot")])
    lines = br.hot_cold_section(data)
    assert "HOT (2)" in "\n".join(lines)


# --- roster_drift_section -------------------------------------------------

def test_roster_drift_clean_when_notes_match_roster():
    data = _data(hitters=[(1, "Active", None)])
    notes = _notes(players={1: {"recentNote": "ok"}})
    lines = br.roster_drift_section(data, notes)
    assert "Player notes: clean" in "\n".join(lines)


def test_roster_drift_flags_departed_players():
    data = _data(hitters=[(1, "Active", None)])
    notes = _notes(players={999: {"recentNote": "departed"}})
    lines = br.roster_drift_section(data, notes)
    text = "\n".join(lines)
    assert "notes.players[999]" in text
    assert "prune or whitelist" in text


def test_roster_drift_flags_stale_injuries():
    data = _data(hitters=[(1, "Active", None)])
    notes = _notes(injuries={42: {"detail": "stale"}})
    lines = br.roster_drift_section(data, notes)
    assert "notes.injuries[42]" in "\n".join(lines)


def test_roster_drift_surfaces_il_without_notes():
    data = _data(injuries=[100, 200])
    notes = _notes()
    lines = br.roster_drift_section(data, notes)
    text = "\n".join(lines)
    assert "IL players without injury notes (2)" in text
    assert "100" in text and "200" in text


def test_roster_drift_truncates_long_uncovered_il_list():
    """When >5 IL players have no notes, output truncates with a count."""
    data = _data(injuries=list(range(1, 11)))  # 10 IL players
    notes = _notes()
    lines = br.roster_drift_section(data, notes)
    text = "\n".join(lines)
    assert "and 5 more" in text


def test_roster_drift_il_player_with_note_is_satisfied():
    data = _data(injuries=[100])
    notes = _notes(injuries={100: {"detail": "covered"}})
    lines = br.roster_drift_section(data, notes)
    text = "\n".join(lines)
    assert "IL players without injury notes" not in text


# --- section_ages_section -------------------------------------------------

def test_section_ages_overview_due_when_over_weekly():
    lines = br.section_ages_section(10)  # > 7
    text = "\n".join(lines)
    # overview cadence is weekly (7d threshold)
    overview_line = next(l for l in lines if "overview" in l)
    assert "REFRESH DUE" in overview_line


def test_section_ages_team_ok_under_biweekly():
    lines = br.section_ages_section(10)
    team_line = next(l for l in lines if l.lstrip().startswith("team "))
    assert "ok" in team_line


def test_section_ages_games_always_na():
    lines = br.section_ages_section(100)
    games_line = next(l for l in lines if "games " in l)
    assert "n/a" in games_line


def test_section_ages_unknown_age_shows_question_mark():
    lines = br.section_ages_section(None)
    text = "\n".join(lines)
    assert "?" in text


# --- build_brief ----------------------------------------------------------

def test_build_brief_includes_all_section_headers():
    data = _data()
    notes = _notes()
    output = br.build_brief(data, notes, 5)
    assert "=== Analyst voice brief" in output
    assert "=== Team state ===" in output
    assert "=== Hot / cold / new ===" in output
    assert "=== Notes ↔ roster drift ===" in output
    assert "=== Per-section refresh status ===" in output


# --- build_brief_json -----------------------------------------------------

def test_build_brief_json_parses_as_valid_json():
    data = _data()
    notes = _notes()
    payload = json.loads(br.build_brief_json(data, notes, 5))
    assert payload["notes_age_days"] == 5
    assert payload["notes_staleness"] == "GREEN"


def test_build_brief_json_separates_hot_cold_new():
    data = _data(
        hitters=[(1, "A", "hot"), (2, "B", "cold")],
        pitchers=[(3, "C", "new")],
    )
    payload = json.loads(br.build_brief_json(data, _notes(), 0))
    assert payload["hot"] == ["A"]
    assert payload["cold"] == ["B"]
    assert payload["new"] == ["C"]


def test_build_brief_json_sections_table_complete():
    payload = json.loads(br.build_brief_json(_data(), _notes(), 0))
    assert set(payload["sections"].keys()) == {
        "overview", "team", "players", "injuries", "pitches", "games"
    }


# --- main() entry point ---------------------------------------------------

def _write(tmp_path, name, payload):
    p = tmp_path / name
    p.write_text(json.dumps(payload))
    return p


def test_main_text_mode_prints_brief(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(br, "notes_last_updated_iso", lambda: None)
    data_path = _write(tmp_path, "data.json", _data())
    notes_path = _write(tmp_path, "notes.json", _notes())
    rc = br.main(["--data", str(data_path), "--notes", str(notes_path)])
    assert rc == 0
    out = capsys.readouterr().out
    assert "=== Team state ===" in out


def test_main_json_mode_emits_json(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(br, "notes_last_updated_iso", lambda: None)
    data_path = _write(tmp_path, "data.json", _data())
    notes_path = _write(tmp_path, "notes.json", _notes())
    rc = br.main(["--data", str(data_path), "--notes", str(notes_path), "--json"])
    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert "notes_age_days" in payload


# --- integration: real repo files load --------------------------------------

def test_integration_real_files_run_clean():
    """Sanity: the brief script runs against committed data.json + notes.json."""
    data = br.load_json(REPO_ROOT / "data.json")
    notes = br.load_json(REPO_ROOT / "notes.json")
    output = br.build_brief(data, notes, 0)
    assert "=== Team state ===" in output
    payload = json.loads(br.build_brief_json(data, notes, 0))
    assert "team" in payload
