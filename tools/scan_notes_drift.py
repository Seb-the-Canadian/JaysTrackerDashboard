#!/usr/bin/env python3
"""Scan notes.json for free-text drift against the current roster + IL.

Loads `notes.json` and `data.json`, walks the HIGH-drift paths defined in
`tools/notes_drift_paths.json`, and flags capitalized-word tokens in those
fields that look like player names but aren't in the current roster + IL
dictionary.

Stdlib only. See `docs/free-text-fields.md` for the registry of fields
scanned. See `docs/runbook.md` for how to suppress false positives.

Exit codes:
  0 — no findings, OR --warn-only mode (always 0)
  1 — findings exist and --warn-only is off

Usage:
  python3 tools/scan_notes_drift.py
  python3 tools/scan_notes_drift.py --warn-only
  python3 tools/scan_notes_drift.py --json
"""
import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_NOTES = REPO_ROOT / "notes.json"
DEFAULT_DATA = REPO_ROOT / "data.json"
DEFAULT_PATHS = REPO_ROOT / "tools" / "notes_drift_paths.json"
DEFAULT_ALLOW = REPO_ROOT / ".notes-scan-allow.json"
DEFAULT_CONFIG = REPO_ROOT / "config.json"

NOSCAN_MARKER = "<!-- noscan -->"

# Capitalized-word token. Three patterns covered:
#   1. Standard capitalized word: "Bichette", "Bo", "Berríos"
#   2. Apostrophe-compound: "O'Brien", "O'Neill" (1-char prefix + capital)
#   3. Hyphen-compound or apostrophe-compound suffix: "Jean-Luc"
# The negative lookbehind on [A-Z] prevents matching the trailing "Bs" inside
# "ABs" or "As" inside "ERAs" — those are acronym pluralizations, not names.
TOKEN_RE = re.compile(
    r"(?<![A-Z])"
    r"[A-Z](?:[a-zà-ÿ]+|'[A-Z][a-zà-ÿ]+)"
    r"(?:[-'][A-Z][a-zà-ÿ]+)?"
)

# Tokens that match the regex but are never player names. Universal across
# forks — months, days, MLB team words, league/division labels, stadium
# nouns, and common English/baseball words that often appear capitalized at
# the start of a sentence. Per-fork additions (manager surnames, nicknames)
# go in .notes-scan-allow.json. This list is expected to grow as new false
# positives surface — see docs/runbook.md for the suppression workflow.
STOPWORDS = frozenset({
    # Months (May omitted — ambiguous with the player surname)
    "January", "February", "March", "April", "June", "July", "August",
    "September", "October", "November", "December",
    # Days
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
    "Sunday",
    # MLB team mascot words (all 30 teams)
    "Yankees", "Yankee", "Sox", "Orioles", "Rays", "Jays", "Blue", "White",
    "Red", "Indians", "Guardians", "Tigers", "Twins", "Royals", "Astros",
    "Angels", "Athletics", "Mariners", "Rangers", "Braves", "Marlins",
    "Mets", "Phillies", "Nationals", "Brewers", "Cardinals", "Cubs",
    "Pirates", "Reds", "Diamondbacks", "Rockies", "Dodgers", "Giants",
    "Padres",
    # City / region adjectives
    "New", "York", "Boston", "Tampa", "Bay", "Toronto", "Baltimore",
    "Cleveland", "Detroit", "Minnesota", "Kansas", "City", "Houston",
    "Anaheim", "Athletic", "Seattle", "Texas", "Atlanta", "Miami",
    "Washington", "Philadelphia", "Milwaukee", "Pittsburgh", "Cincinnati",
    "Chicago", "Louis", "Arizona", "Colorado", "Angeles", "Diego",
    "Francisco", "San", "Los",
    # Venue / stadium nouns
    "Stadium", "Park", "Field", "Centre", "Center", "Coliseum",
    # League / division
    "American", "National", "League", "East", "West", "Central", "Division",
    # Determiners and quantifiers at sentence start
    "The", "This", "That", "These", "Those", "Some", "Any", "All", "None",
    "Each", "Every", "Both", "Either", "Neither", "Most", "Many", "Few",
    "Several", "Various", "Another", "Other",
    # Indefinite pronouns at sentence start
    "Nobody", "Somebody", "Anybody", "Everybody",
    "Someone", "Anyone", "Everyone", "No-one",
    # Numbers at sentence start
    "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "First", "Second", "Third", "Fourth", "Fifth", "Sixth",
    # Subordinating + coordinating conjunctions
    "Although", "Because", "Before", "After", "Since", "Until", "Unless",
    "While", "When", "Whenever", "Where", "Wherever", "Whether", "And",
    "But", "Or", "So", "Yet", "Even", "Once", "Though",
    # Prepositions
    "From", "With", "Without", "During", "Through", "Throughout", "Above",
    "Below", "Across", "Around", "Between", "Beyond", "Beneath", "Outside",
    "Inside", "Within", "Upon", "Toward", "Towards", "Against", "Among",
    "Amongst", "Despite", "Until",
    # Time markers
    "Earlier", "Later", "Recently", "Currently", "Today", "Tomorrow",
    "Yesterday", "Eventually", "Finally", "Lately",
    # Modal-ish
    "Should", "Would", "Could", "Might", "Must", "Will", "Can",
    # Common sentence-start adverbs in analyst voice
    "Defensively", "Offensively", "Strategically", "Realistically",
    "Realistic", "Notably", "Particularly", "Especially", "Importantly",
    "Crucially", "Significantly", "Specifically", "Typically", "Generally",
    "Usually", "Roughly", "Approximately", "Frankly", "Quietly", "Quietly",
    # Common verbs that start a sentence
    "Watch", "Expect", "Look", "See", "Note", "Consider", "Think",
    "Believe", "Argue", "Suggest", "Imagine", "Suppose", "Pulled",
    # Baseball common nouns capitalized at sentence start
    "Hits", "Hitters", "Runners", "Innings", "Rotation", "Bullpen",
    "Lineup", "Defense", "Offense", "Pitching", "Hitting", "Power",
    "Contact", "Patience", "Discipline", "Approach", "Strikeout", "Walk",
    "Strike", "Ball", "Run", "Score", "Lead", "Margin", "Spread", "Pace",
    "Watch", "Either", "Command", "Velocity", "Velo", "Location", "Movement",
    "Spin", "Stuff", "Slot", "Release", "Tunnel", "Arsenal", "Pitches",
    "Pitcher", "Catcher", "Fielder", "Batter", "Hitter", "Reliever",
    "Starter", "Closer", "Setup", "Manager", "Coach", "Bench",
    # Common adjectives at sentence start
    "Patient", "Strong", "Weak", "Top", "Bottom", "Mid", "Free", "Healthy",
    "Solid", "Suspect", "Recent", "Right", "Left", "Heavy", "Light",
    "Last", "Next", "Previous", "Initial", "Final", "Late", "Early",
    "Rare", "Common", "Unusual", "Normal", "Standard", "Hard", "Soft",
    "Sharp", "Dull", "Clean", "Dirty",
    "Well", "Better", "Worse", "Best", "Worst",
    # Misc
    "There", "Here", "Yes", "No", "Now", "Maybe", "Perhaps",
    # Baseball generics
    "Opening", "Spring", "Training",
    # Common 2-3 char words that capitalize sentence-initial (needed since
    # the regex matches 2+ char capitalized tokens to support nicknames)
    "In", "At", "By", "To", "Of", "If", "On", "Up", "Or", "We", "Do", "Is",
    "It", "He", "Me", "My", "Be", "An", "So", "Us", "Am", "Go",
    "All", "Any", "And", "Are", "But", "Can", "For", "Get", "Got", "Had",
    "Has", "Her", "Him", "His", "How", "Let", "Off", "Our", "Out", "Own",
    "Put", "She", "Set", "Six", "Ten", "Too", "Try", "Use", "Was", "Way",
    "Why", "Yet", "You",
})

SNIPPET_RADIUS = 30


def load_json(path):
    with open(path) as f:
        return json.load(f)


def build_name_dictionary(data):
    """Return the set of name tokens drawn from current roster + IL."""
    names = set()
    roster = data.get("roster") or {}
    for group in ("hitters", "pitchers"):
        for p in roster.get(group) or []:
            for tok in (p.get("name") or "").split():
                cleaned = tok.strip(".,;:")
                if cleaned:
                    names.add(cleaned)
    for inj in data.get("injuries") or []:
        for tok in (inj.get("name") or "").split():
            cleaned = tok.strip(".,;:")
            if cleaned:
                names.add(cleaned)
    return names


def strip_html(text):
    """Best-effort tag stripping. Replaces each tag with a single space so
    adjacent words don't merge after removal."""
    return re.sub(r"<[^>]+>", " ", text)


def find_tokens(text):
    """Yield (token, start_index) for each capitalized-word match."""
    for m in TOKEN_RE.finditer(text):
        yield m.group(), m.start()


def make_snippet(text, start, length):
    s = max(0, start - SNIPPET_RADIUS)
    e = min(len(text), start + length + SNIPPET_RADIUS)
    snippet = text[s:e].replace("\n", " ").strip()
    prefix = "..." if s > 0 else ""
    suffix = "..." if e < len(text) else ""
    return prefix + snippet + suffix


def walk_path(obj, path_parts, prefix):
    """Yield (json_path_str, text_value) for each terminal string match.

    Path tokens:
      foo     — descend into key 'foo'
      foo[]   — array under 'foo'; iterate each element
      foo{}   — object under 'foo'; iterate each value (arbitrary key)
    """
    if not path_parts:
        if isinstance(obj, str):
            yield prefix, obj
        return
    head, *rest = path_parts
    if head.endswith("[]"):
        key = head[:-2]
        sub = obj.get(key) if (key and isinstance(obj, dict)) else None
        if not isinstance(sub, list):
            return
        for i, item in enumerate(sub):
            yield from walk_path(item, rest, f"{prefix}.{key}[{i}]")
    elif head.endswith("{}"):
        key = head[:-2]
        sub = obj.get(key) if (key and isinstance(obj, dict)) else None
        if not isinstance(sub, dict):
            return
        for k, v in sub.items():
            yield from walk_path(v, rest, f"{prefix}.{key}[{k}]")
    else:
        sub = obj.get(head) if isinstance(obj, dict) else None
        if sub is None:
            return
        yield from walk_path(sub, rest, f"{prefix}.{head}")


def scan(notes, data, paths_config, allow_list):
    """Run the scan. Return a list of finding dicts."""
    name_dict = build_name_dictionary(data)
    extra_stopwords = set(allow_list.get("tokens") or [])
    full_stopwords = STOPWORDS | extra_stopwords
    findings = []
    for entry in paths_config.get("paths") or []:
        path_str = entry["path"]
        is_html = bool(entry.get("html", False))
        path_parts = path_str.split(".")
        for full_path, text in walk_path(notes, path_parts, "notes"):
            if NOSCAN_MARKER in text:
                continue
            scan_text = strip_html(text) if is_html else text
            for token, start in find_tokens(scan_text):
                if token in full_stopwords:
                    continue
                if token in name_dict:
                    continue
                findings.append({
                    "path": full_path,
                    "token": token,
                    "snippet": make_snippet(scan_text, start, len(token)),
                    "reason": "not_in_roster_or_il",
                })
    return findings


def format_findings_text(findings):
    """Human-readable rendering for stderr."""
    lines = []
    for f in findings:
        lines.append(f"WARN {f['path']}: \"{f['snippet']}\"")
        lines.append(f"  unknown token: {f['token']}")
        lines.append(f"  reason: {f['reason']}")
        lines.append(f"  see: docs/free-text-fields.md")
        lines.append("")
    lines.append(f"{len(findings)} drift finding(s).")
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Scan notes.json for free-text drift.",
    )
    parser.add_argument("--notes", default=str(DEFAULT_NOTES))
    parser.add_argument("--data", default=str(DEFAULT_DATA))
    parser.add_argument("--paths", default=str(DEFAULT_PATHS))
    parser.add_argument("--allow", default=str(DEFAULT_ALLOW))
    parser.add_argument(
        "--config", default=str(DEFAULT_CONFIG),
        help="Path to config.json. Respects scan_notes_drift flag (default true).",
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
        if cfg.get("scan_notes_drift", True) is False:
            print("scan_notes_drift disabled per config; skipping.", file=sys.stderr)
            return 0

    notes = load_json(args.notes)
    data = load_json(args.data)
    paths_config = load_json(args.paths)
    allow_list = {}
    if Path(args.allow).exists():
        allow_list = load_json(args.allow)

    findings = scan(notes, data, paths_config, allow_list)

    if args.json:
        print(json.dumps({"findings": findings, "count": len(findings)}, indent=2))
    elif findings:
        print(format_findings_text(findings), file=sys.stderr)
    else:
        print("No drift findings.", file=sys.stderr)

    if args.warn_only:
        return 0
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
