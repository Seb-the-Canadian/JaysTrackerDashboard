#!/usr/bin/env python3
"""Scan notes.json for keyed entries whose ID no longer matches data.json.

Where free-text drift (tools/scan_notes_drift.py) is about *content* of
notes that mention names not on the roster, this scanner is about the
*keys* of `notes.players[id]` / `notes.injuries[id]` — entries that were
authored for a player who's no longer on the roster or no longer on the
IL respectively.

Same bug class as the Bo/Berríos drift findings from #88, just rooted in
the key rather than the body. Stays clean automatically as long as notes
authors prune entries when the player leaves.

Stdlib only. See `docs/free-text-fields.md` for the registry of keyed
fields. See `docs/runbook.md` for how to triage findings.

Exit codes:
  0 — no findings, OR --warn-only mode (always 0), OR config disabled
  1 — findings exist and --warn-only is off

Usage:
  python3 tools/scan_notes_orphans.py
  python3 tools/scan_notes_orphans.py --warn-only
  python3 tools/scan_notes_orphans.py --json
"""
import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_NOTES = REPO_ROOT / "notes.json"
DEFAULT_DATA = REPO_ROOT / "data.json"
DEFAULT_ALLOW = REPO_ROOT / ".notes-scan-allow.json"
DEFAULT_CONFIG = REPO_ROOT / "config.json"


def load_json(path):
    with open(path) as f:
        return json.load(f)


def _to_int(key):
    """Coerce a notes.json key (always JSON string) to int when possible."""
    try:
        return int(key)
    except (TypeError, ValueError):
        return key


def build_id_sets(data):
    """Build the authoritative ID sets from data.json.

    - roster_ids: anyone currently on the active 26-man (hitters + pitchers)
    - il_ids: anyone on the IL (injuries[].person_id)
    - other_unavail_ids: Reassigned / Restricted / Suspended /etc.
      (other_unavailable[].person_id)

    Returns three sets of int. Unparseable IDs are silently dropped.
    """
    roster_ids = set()
    for group in ("hitters", "pitchers"):
        for p in (data.get("roster") or {}).get(group, []) or []:
            pid = p.get("id")
            if isinstance(pid, int):
                roster_ids.add(pid)
    il_ids = {
        row["person_id"] for row in (data.get("injuries") or [])
        if isinstance(row.get("person_id"), int)
    }
    other_unavail_ids = {
        row["person_id"] for row in (data.get("other_unavailable") or [])
        if isinstance(row.get("person_id"), int)
    }
    return roster_ids, il_ids, other_unavail_ids


def _snippet_from_value(value):
    """One-line peek into a notes value, for finding context."""
    if isinstance(value, dict):
        for k in ("recentNote", "read", "detail", "eta"):
            if value.get(k):
                return _snippet_from_value(value[k])
        return ""
    if isinstance(value, list):
        for item in value:
            s = _snippet_from_value(item)
            if s:
                return s
        return ""
    s = str(value).strip()
    if len(s) > 80:
        return s[:77] + "..."
    return s


def scan(notes, data, allow_list):
    """Return a list of finding dicts for orphan keys."""
    roster_ids, il_ids, other_unavail_ids = build_id_sets(data)
    # Players note is valid if the ID matches anyone "associated with the team
    # today": roster, IL, or other unavailable. A note for someone on the IL
    # is fine — they're still ours.
    valid_player_ids = roster_ids | il_ids | other_unavail_ids
    # Injury notes are scoped tighter: only valid for someone whose status
    # makes them eligible to render in the Injured List panel.
    valid_injury_ids = il_ids | other_unavail_ids

    allow_ids = set()
    for raw in (allow_list.get("orphan_ids") or []):
        try:
            allow_ids.add(int(raw))
        except (TypeError, ValueError):
            pass

    findings = []
    for raw_key, value in (notes.get("players") or {}).items():
        pid = _to_int(raw_key)
        if not isinstance(pid, int):
            continue
        if pid in allow_ids or pid in valid_player_ids:
            continue
        findings.append({
            "path": f"notes.players[{pid}]",
            "key": pid,
            "snippet": _snippet_from_value(value),
            "reason": "id_not_in_roster_or_il",
        })
    for raw_key, value in (notes.get("injuries") or {}).items():
        pid = _to_int(raw_key)
        if not isinstance(pid, int):
            continue
        if pid in allow_ids or pid in valid_injury_ids:
            continue
        findings.append({
            "path": f"notes.injuries[{pid}]",
            "key": pid,
            "snippet": _snippet_from_value(value),
            "reason": "id_not_on_injured_list",
        })
    return findings


def format_findings_text(findings):
    """Human-readable rendering for stderr."""
    lines = []
    for f in findings:
        snippet = f["snippet"] or "(no preview)"
        lines.append(f"ORPHAN {f['path']}: \"{snippet}\"")
        lines.append(f"  reason: {f['reason']}")
        lines.append(f"  see: docs/free-text-fields.md")
        lines.append("")
    lines.append(f"{len(findings)} orphan finding(s).")
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Scan notes.json for keyed entries with no matching data.json ID.",
    )
    parser.add_argument("--notes", default=str(DEFAULT_NOTES))
    parser.add_argument("--data", default=str(DEFAULT_DATA))
    parser.add_argument("--allow", default=str(DEFAULT_ALLOW))
    parser.add_argument(
        "--config", default=str(DEFAULT_CONFIG),
        help="Path to config.json. Respects scan_notes_orphans flag (default true).",
    )
    parser.add_argument(
        "--warn-only", action="store_true",
        help="Always exit 0; print findings to stderr.",
    )
    parser.add_argument(
        "--json", action="store_true",
        help="Emit findings as JSON to stdout.",
    )
    args = parser.parse_args(argv)

    if Path(args.config).exists():
        cfg = load_json(args.config)
        if cfg.get("scan_notes_orphans", True) is False:
            print("scan_notes_orphans disabled per config; skipping.", file=sys.stderr)
            return 0

    notes = load_json(args.notes)
    data = load_json(args.data)
    allow_list = {}
    if Path(args.allow).exists():
        allow_list = load_json(args.allow)

    findings = scan(notes, data, allow_list)

    if args.json:
        print(json.dumps({"findings": findings, "count": len(findings)}, indent=2))
    elif findings:
        print(format_findings_text(findings), file=sys.stderr)
    else:
        print("No orphan findings.", file=sys.stderr)

    if args.warn_only:
        return 0
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
