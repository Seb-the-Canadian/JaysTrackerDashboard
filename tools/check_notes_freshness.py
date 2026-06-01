#!/usr/bin/env python3
"""Scan notes.json freshness against per-section cadence thresholds.

Where scan_notes_drift catches name-token drift in content and
scan_notes_orphans catches keyed entries with no matching ID, this
scanner catches *temporal* drift: notes.json hasn't been edited
recently enough that its prose still reflects current state.

Uses the same CADENCE table as tools/draft_notes_brief.py (single
source of truth). Flags any section whose threshold has been exceeded
by the file's git mtime.

Stdlib only. See docs/authoring-notes.md for the cadence rationale
and docs/runbook.md for the suppression workflow.

Exit codes:
  0 — no findings, OR --warn-only mode (always 0), OR config disabled
  1 — findings exist and --warn-only is off

Usage:
  python3 tools/check_notes_freshness.py
  python3 tools/check_notes_freshness.py --warn-only
  python3 tools/check_notes_freshness.py --json
  python3 tools/check_notes_freshness.py --age-days 10   # override (testing)
"""
import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_NOTES = REPO_ROOT / "notes.json"
DEFAULT_CONFIG = REPO_ROOT / "config.json"

# Share the cadence table with the author-facing brief tool. Single
# source of truth — edit there if a section's cadence changes.
# Python's sys.path[0] is the script's directory at module load time,
# so a sibling-module import works without explicit path manipulation.
from draft_notes_brief import CADENCE, _days_since, notes_last_updated_iso


def load_json(path):
    with open(path) as f:
        return json.load(f)


def scan(notes_age_days):
    """Return a list of finding dicts for sections past their threshold."""
    findings = []
    if notes_age_days is None:
        return findings
    for section, (label, threshold) in CADENCE.items():
        if threshold is None:
            continue
        if notes_age_days > threshold:
            findings.append({
                "section": section,
                "age_days": notes_age_days,
                "threshold_days": threshold,
                "cadence_label": label,
            })
    return findings


def format_findings_text(findings):
    """Human-readable rendering for stderr."""
    lines = []
    for f in findings:
        lines.append(
            f"WARN notes.{f['section']}: {f['age_days']}d old "
            f"(cadence: {f['cadence_label']}, threshold: {f['threshold_days']}d)"
        )
        lines.append(f"  see: docs/authoring-notes.md")
        lines.append("")
    lines.append(f"{len(findings)} freshness finding(s).")
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Scan notes.json freshness vs per-section cadence thresholds.",
    )
    parser.add_argument("--notes", default=str(DEFAULT_NOTES))
    parser.add_argument(
        "--config", default=str(DEFAULT_CONFIG),
        help="Path to config.json. Respects check_notes_freshness flag (default true).",
    )
    parser.add_argument(
        "--warn-only", action="store_true",
        help="Always exit 0; print findings to stderr.",
    )
    parser.add_argument(
        "--json", action="store_true",
        help="Emit findings as JSON to stdout.",
    )
    parser.add_argument(
        "--age-days", type=int, default=None,
        help="Override the computed age. Useful for testing and CI dry-runs.",
    )
    args = parser.parse_args(argv)

    if Path(args.config).exists():
        cfg = load_json(args.config)
        if cfg.get("check_notes_freshness", True) is False:
            print("check_notes_freshness disabled per config; skipping.", file=sys.stderr)
            return 0

    if args.age_days is not None:
        age = args.age_days
    else:
        age = _days_since(notes_last_updated_iso())

    findings = scan(age)

    if args.json:
        payload = {"findings": findings, "count": len(findings), "age_days": age}
        print(json.dumps(payload, indent=2))
    elif findings:
        print(format_findings_text(findings), file=sys.stderr)
    else:
        if age is None:
            print("notes.json age: unknown — all sections within cadence.", file=sys.stderr)
        else:
            print(f"notes.json age: {age}d — all sections within cadence.", file=sys.stderr)

    if args.warn_only:
        return 0
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
