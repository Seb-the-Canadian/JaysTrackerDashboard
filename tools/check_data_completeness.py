#!/usr/bin/env python3
"""Post-refresh data guards over the freshly-written data.json.

Two layers, run after fetch_data.py in the daily-refresh workflow:

  HARD (exit 1)  — every contract top-level key is present. A fetcher that
                   silently stops emitting a key the renderer requires would
                   ship a live schema-drift banner; this fails the refresh
                   instead, so the previous (good) data.json stays in place.

  WARN (exit 0)  — silent-degradation scan. Fields that are *present but
                   empty/placeholder* are the survivorship class: the
                   dashboard renders, so it looks fine, but the data isn't
                   there (player_ranks all-null, every Statcast value a
                   placeholder, opponent_pitchers empty while probables
                   exist). Findings go to the log; the build never fails on
                   these. Mirrors tools/scan_notes_*.py's warn-only posture.

Usage:
  python3 tools/check_data_completeness.py              # hard + warn
  python3 tools/check_data_completeness.py --warn-only  # never exit nonzero
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTRACT = json.loads((ROOT / "schema" / "data_contract.json").read_text())
DATA_PATH = ROOT / "data.json"

# The project's placeholder vocabulary — a value that means "no data" while
# still rendering as a benign string.
PLACEHOLDERS = {"", "-", "—", ".---", "---", "-.--", None}


def hard_key_check(data):
    """Contract keys missing from the freshly-written data.json."""
    return [k for k in CONTRACT["top_level_keys"] if k not in data]


def warn_scan(data):
    """Silent-degradation findings (never fatal)."""
    warns = []

    # 1. player_ranks: a slug null for every player while the pool is
    #    non-empty means the rank join/fetch silently degraded.
    pr = data.get("player_ranks") or {}
    pool = data.get("player_rank_pool") or {}
    if pr:
        for group, slugs in (("hitting", CONTRACT["player_rank_stats"]["hitting"]),
                             ("pitching", CONTRACT["player_rank_stats"]["pitching"])):
            if not pool.get(group):
                warns.append(f"player_rank_pool.{group} is 0 — rank fetch for {group} likely failed")
                continue
            for slug in slugs:
                vals = [v.get(slug) for v in pr.values() if slug in v]
                if vals and all(v is None for v in vals):
                    warns.append(f"every player_ranks.*.{slug} is null ({len(vals)} players) "
                                 f"despite pool={pool.get(group)} — silent rank gap")

    # 1c. Heat-bar coverage guarantee. Every rostered player who HAS a
    #     primary stat (ops for hitters, era for pitchers) must get a rank,
    #     so the pcard heat bar is uniform and never silently degrades to "—"
    #     for someone who has actually played. Reports coverage every refresh
    #     (auditable) and flags the real bug class — stat present, rank null
    #     (troubleshootable: it names the players). Warn-only: a rank gap must
    #     never blank the live dashboard (resilience over completeness here).
    roster = data.get("roster") or {}
    for grp, primary in (("hitters", "ops"), ("pitchers", "era")):
        players = roster.get(grp) or []
        have_stat = [p for p in players if str(p.get(primary)) not in PLACEHOLDERS]
        gap = [p.get("name") for p in have_stat
               if (pr.get(str(p.get("id"))) or {}).get(primary) is None]
        if have_stat:
            warns.append(f"heat-bar coverage {grp}: {len(have_stat) - len(gap)}/{len(have_stat)} "
                         f"with a {primary} are ranked")
        if gap:
            warns.append(f"GUARANTEE GAP — {len(gap)} {grp} have a {primary} but no rank "
                         f"(heat bar shows '—'): {', '.join(str(n) for n in gap[:8])}")

    # 2. Statcast saturation: every hitter's metric a placeholder → the
    #    Savant/xstats join is down (the value-only line renders nothing).
    hitters = (data.get("roster") or {}).get("hitters") or []
    for field in ("xwoba", "barrel_pct", "hardhit_pct"):
        vals = [h.get(field) for h in hitters]
        if vals and all(v in PLACEHOLDERS for v in vals):
            warns.append(f"every hitter's {field} is a placeholder ({len(vals)} players) "
                         f"— Statcast join may be down")

    # 3. opponent_pitchers empty while upcoming games carry probables → the
    #    opposing-pitcher modal would resolve nothing.
    ug = data.get("upcoming_games") or []
    if any(g.get("probable_pitcher_them_id") for g in ug) and not (data.get("opponent_pitchers") or {}):
        warns.append("upcoming games have probable pitchers but opponent_pitchers is empty")

    # 4. opp_context missing for every upcoming game → standings join missed.
    if ug and all(g.get("opp_context") is None for g in ug):
        warns.append(f"no upcoming game has opp_context ({len(ug)} games) — standings join missed")

    return warns


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--warn-only", action="store_true",
                    help="never exit nonzero, even on a missing contract key")
    args = ap.parse_args()

    if not DATA_PATH.exists():
        print("check_data_completeness: data.json not found", file=sys.stderr)
        return 0 if args.warn_only else 1

    data = json.loads(DATA_PATH.read_text())

    missing = hard_key_check(data)
    for k in missing:
        print(f"ERROR: data.json missing contract key '{k}' "
              f"(renderer EXPECTED_KEYS would fire the schema-drift banner)")

    for w in warn_scan(data):
        print(f"WARN: {w}")

    if missing and not args.warn_only:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
