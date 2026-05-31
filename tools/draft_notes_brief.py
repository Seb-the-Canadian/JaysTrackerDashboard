#!/usr/bin/env python3
"""Print an authoring brief for notes.json refreshes.

When the analyst-voice freshness badge in the dashboard turns amber or
red, you sit down to refresh `notes.json`. This script gives you the
current facts in one screen: team state, hot/cold players, roster
changes since the last refresh, and per-section ages. Read the brief,
draft, commit.

Stdlib only. No network.

Usage:
  python3 tools/draft_notes_brief.py
  python3 tools/draft_notes_brief.py --json
  python3 tools/draft_notes_brief.py --data data.json --notes notes.json

See docs/authoring-notes.md for the full refresh workflow.
"""
import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA = REPO_ROOT / "data.json"
DEFAULT_NOTES = REPO_ROOT / "notes.json"

# Sections of notes.json and their refresh-cadence guidance (days).
# Drives the "your section ages" suggestion table.
CADENCE = {
    "overview": ("weekly", 7),
    "team": ("bi-weekly", 14),
    "players": ("bi-weekly", 14),
    "injuries": ("reactive", 14),
    "pitches": ("rare", 60),
    "games": ("historical", None),
}


def load_json(path):
    with open(path) as f:
        return json.load(f)


def notes_last_updated_iso():
    """ISO timestamp of last git commit on notes.json, or None."""
    try:
        result = subprocess.run(
            ["git", "log", "-1", "--format=%aI", "--", "notes.json"],
            cwd=str(REPO_ROOT),
            capture_output=True, text=True, check=True, timeout=10,
        )
        return result.stdout.strip() or None
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        return None


def _days_since(iso_str):
    if not iso_str:
        return None
    try:
        dt = datetime.fromisoformat(iso_str)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - dt
    return max(0, delta.days)


def _staleness_label(days, amber_at=7, red_at=14):
    if days is None:
        return "?"
    if days > red_at:
        return "RED"
    if days > amber_at:
        return "AMBER"
    return "GREEN"


# --- section builders ---------------------------------------------------

def header_section(notes_age_days):
    label = _staleness_label(notes_age_days)
    if notes_age_days is None:
        age_str = "unknown"
    elif notes_age_days == 0:
        age_str = "refreshed today"
    elif notes_age_days == 1:
        age_str = "1 day old"
    else:
        age_str = f"{notes_age_days} days old"
    return [
        f"=== Analyst voice brief — {datetime.now(timezone.utc).date().isoformat()} ===",
        f"notes.json: {age_str} ({label})",
    ]


def team_state_section(data):
    team = data.get("team") or {}
    rec = team.get("record") or {}
    w, l = rec.get("w", 0), rec.get("l", 0)
    pct = (w / (w + l)) if (w + l) else 0.0
    last10 = team.get("last10") or "—"
    rs, ra = team.get("runs_scored"), team.get("runs_allowed")
    diff = team.get("run_diff")
    streak = team.get("streak", "")
    place = team.get("place", "")
    return [
        "=== Team state ===",
        f"Record: {w}-{l} ({pct:.3f}) — {place}",
        f"Last 10: {last10}  Streak: {streak}",
        f"Run diff: {diff:+d} (RS {rs} / RA {ra})" if diff is not None else "Run diff: —",
    ]


def hot_cold_section(data):
    roster = data.get("roster") or {}
    hot, cold, new_ = [], [], []
    for group in ("hitters", "pitchers"):
        for p in roster.get(group, []) or []:
            tag = p.get("recent")
            label = f"  {p.get('name', '?'):<28} ({group[0].upper()})"
            if tag == "hot":
                hot.append(label)
            elif tag == "cold":
                cold.append(label)
            elif tag == "new":
                new_.append(label)
    lines = ["=== Hot / cold / new ==="]
    lines.append(f"HOT ({len(hot)}):")
    lines.extend(hot or ["  (none)"])
    lines.append(f"COLD ({len(cold)}):")
    lines.extend(cold or ["  (none)"])
    lines.append(f"NEW ({len(new_)}):")
    lines.extend(new_ or ["  (none)"])
    return lines


def roster_drift_section(data, notes):
    """Surface notes.players and notes.injuries entries that may need attention."""
    roster = data.get("roster") or {}
    roster_ids = {
        p["id"] for group in ("hitters", "pitchers")
        for p in roster.get(group, []) or [] if isinstance(p.get("id"), int)
    }
    il_ids = {
        r["person_id"] for r in (data.get("injuries") or [])
        if isinstance(r.get("person_id"), int)
    }
    other_unavail_ids = {
        r["person_id"] for r in (data.get("other_unavailable") or [])
        if isinstance(r.get("person_id"), int)
    }
    valid_player = roster_ids | il_ids | other_unavail_ids
    valid_injury = il_ids | other_unavail_ids

    departed_players = []
    for raw_key in (notes.get("players") or {}).keys():
        try:
            pid = int(raw_key)
        except (TypeError, ValueError):
            continue
        if pid not in valid_player:
            departed_players.append(pid)

    stale_injuries = []
    for raw_key in (notes.get("injuries") or {}).keys():
        try:
            pid = int(raw_key)
        except (TypeError, ValueError):
            continue
        if pid not in valid_injury:
            stale_injuries.append(pid)

    # Reverse: roster members on the IL who have no injury note
    notes_injury_ids = set()
    for raw_key in (notes.get("injuries") or {}).keys():
        try:
            notes_injury_ids.add(int(raw_key))
        except (TypeError, ValueError):
            pass
    il_rows_by_id = {
        r["person_id"]: r for r in (data.get("injuries") or [])
        if isinstance(r.get("person_id"), int)
    }
    uncovered_il = [
        pid for pid in il_ids if pid not in notes_injury_ids
    ]

    lines = ["=== Notes ↔ roster drift ==="]
    if departed_players:
        lines.append(f"Player notes for non-roster players ({len(departed_players)}):")
        for pid in departed_players:
            lines.append(f"  notes.players[{pid}] — prune or whitelist")
    else:
        lines.append("Player notes: clean")
    if stale_injuries:
        lines.append(f"Injury notes for non-IL players ({len(stale_injuries)}):")
        for pid in stale_injuries:
            lines.append(f"  notes.injuries[{pid}] — player no longer on IL")
    else:
        lines.append("Injury notes: clean")
    if uncovered_il:
        lines.append(f"IL players without injury notes ({len(uncovered_il)}):")
        for pid in uncovered_il[:5]:
            name = il_rows_by_id[pid].get("name", "?")
            status = il_rows_by_id[pid].get("status", "")
            lines.append(f"  {pid}: {name} ({status}) — consider a note")
        if len(uncovered_il) > 5:
            lines.append(f"  ... and {len(uncovered_il) - 5} more")
    return lines


def section_ages_section(notes_age_days):
    """The whole file shares one git mtime, so per-section is approximate.

    Surfaces it as 'all sections refreshed N days ago' with per-section
    cadence guidance, so the author knows which sections are due first.
    """
    lines = ["=== Per-section refresh status ==="]
    lines.append(f"(notes.json file age: {notes_age_days}d — same for all sections)")
    for section, (label, threshold) in CADENCE.items():
        if threshold is None:
            tag = "n/a"
        elif notes_age_days is None:
            tag = "?"
        elif notes_age_days > threshold:
            tag = "REFRESH DUE"
        else:
            tag = "ok"
        lines.append(f"  {section:<10} cadence: {label:<12} → {tag}")
    return lines


def build_brief(data, notes, notes_age_days):
    parts = []
    parts.extend(header_section(notes_age_days))
    parts.append("")
    parts.extend(team_state_section(data))
    parts.append("")
    parts.extend(hot_cold_section(data))
    parts.append("")
    parts.extend(roster_drift_section(data, notes))
    parts.append("")
    parts.extend(section_ages_section(notes_age_days))
    return "\n".join(parts)


def build_brief_json(data, notes, notes_age_days):
    """Machine-readable variant; for piping into other tooling."""
    roster = data.get("roster") or {}
    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "notes_age_days": notes_age_days,
        "notes_staleness": _staleness_label(notes_age_days),
        "team": {
            "record": (data.get("team") or {}).get("record"),
            "last10": (data.get("team") or {}).get("last10"),
            "run_diff": (data.get("team") or {}).get("run_diff"),
            "place": (data.get("team") or {}).get("place"),
        },
        "hot": [p["name"] for group in ("hitters", "pitchers")
                for p in roster.get(group, []) or [] if p.get("recent") == "hot"],
        "cold": [p["name"] for group in ("hitters", "pitchers")
                 for p in roster.get(group, []) or [] if p.get("recent") == "cold"],
        "new": [p["name"] for group in ("hitters", "pitchers")
                for p in roster.get(group, []) or [] if p.get("recent") == "new"],
        "sections": {
            section: {
                "cadence_label": label,
                "threshold_days": threshold,
                "refresh_due": (
                    None if threshold is None or notes_age_days is None
                    else notes_age_days > threshold
                ),
            }
            for section, (label, threshold) in CADENCE.items()
        },
    }
    return json.dumps(out, indent=2)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Print an authoring brief for notes.json refreshes.",
    )
    parser.add_argument("--data", default=str(DEFAULT_DATA))
    parser.add_argument("--notes", default=str(DEFAULT_NOTES))
    parser.add_argument(
        "--json", action="store_true",
        help="Emit machine-readable JSON instead of human-readable text.",
    )
    args = parser.parse_args(argv)

    data = load_json(args.data)
    notes = load_json(args.notes)
    age = _days_since(notes_last_updated_iso())

    if args.json:
        print(build_brief_json(data, notes, age))
    else:
        print(build_brief(data, notes, age))
    return 0


if __name__ == "__main__":
    sys.exit(main())
