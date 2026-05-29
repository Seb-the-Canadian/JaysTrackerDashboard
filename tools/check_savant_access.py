#!/usr/bin/env python3
"""Probe Baseball Savant reachability from the current execution environment.

Stdlib only. Designed to run from a GitHub Actions runner via
.github/workflows/probe-savant.yml, but also runnable locally.

Output is intentionally plain text — the workflow run log captures it for
the PM to inspect. No `data.json` is written. No exit-code-based fail
behavior; we want to see the full diagnostic on every run.

The decision the probe answers: is the URL pattern Baseball Savant exposes
for CSV leaderboards (`baseballsavant.mlb.com/leaderboard/{slug}?year=YYYY&csv=true`)
reachable from this runner without auth, with a non-default User-Agent?

If yes: PRs 3-4 of the Statcast plan can proceed.
If no (403/timeout/etc.): document the failure, file an issue, ship only
Phase A xwOBA (which is already in via PR #83).
"""
import csv
import io
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

# Three leaderboards the eventual fetcher will hit. Probing one is enough
# to know the URL pattern works; probing all three gives a richer picture
# of whether Savant rate-limits by total volume.
PROBES = [
    ("outs_above_average", "Team OAA leaderboard (PR 4)"),
    ("exit_velocity_barrels", "Hitter Barrel%/Hard-Hit% leaderboard (PR 3)"),
    ("expected_statistics", "Hitter xstats leaderboard (alternative source if MLB API fails)"),
]

USER_AGENT = (
    "JaysTrackerDashboard/1.0 "
    "(+https://github.com/Seb-the-Canadian/JaysTrackerDashboard) "
    "Python/urllib"
)
SEASON = 2026
TIMEOUT_S = 30


def probe(slug: str, label: str) -> dict:
    url = (
        f"https://baseballsavant.mlb.com/leaderboard/{slug}"
        f"?year={SEASON}&csv=true"
    )
    started = time.monotonic()
    result = {
        "slug": slug,
        "label": label,
        "url": url,
        "status": None,
        "elapsed_ms": None,
        "bytes": 0,
        "row_count": None,
        "first_row_keys": None,
        "error": None,
    }
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            body = resp.read()
            result["status"] = resp.status
            result["bytes"] = len(body)
            text = body.decode("utf-8", errors="replace")
            try:
                rows = list(csv.DictReader(io.StringIO(text)))
                result["row_count"] = len(rows)
                if rows:
                    result["first_row_keys"] = list(rows[0].keys())[:10]
            except csv.Error as e:
                result["error"] = f"CSV parse error: {e}"
    except urllib.error.HTTPError as e:
        result["status"] = e.code
        result["error"] = f"HTTPError: {e.reason}"
    except urllib.error.URLError as e:
        result["error"] = f"URLError: {e.reason}"
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {e}"
    result["elapsed_ms"] = round((time.monotonic() - started) * 1000)
    return result


def main() -> int:
    print(f"Baseball Savant probe — {datetime.now(timezone.utc).isoformat()}")
    print(f"User-Agent: {USER_AGENT}")
    print(f"Season: {SEASON}")
    print()
    all_ok = True
    for slug, label in PROBES:
        print(f"=== {slug} ({label}) ===")
        r = probe(slug, label)
        print(f"URL:         {r['url']}")
        print(f"Status:      {r['status']}")
        print(f"Elapsed:     {r['elapsed_ms']} ms")
        print(f"Body bytes:  {r['bytes']:,}")
        print(f"Row count:   {r['row_count']}")
        print(f"Keys:        {r['first_row_keys']}")
        if r["error"]:
            print(f"Error:       {r['error']}")
            all_ok = False
        elif r["status"] != 200 or r["row_count"] in (None, 0):
            all_ok = False
        print()

    print("=" * 60)
    if all_ok:
        print("VERDICT: green — proceed with PRs 3 (Barrels) and 4 (OAA).")
    else:
        print("VERDICT: not green — see per-probe error above.")
        print("Next steps:")
        print("  1. Re-run probe (could be transient)")
        print("  2. Try alternative User-Agent (browser-style fingerprint)")
        print("  3. If still failing: file follow-up issue, defer Phase B")
    # Always exit 0 — we want the workflow to complete and surface the
    # diagnostic, not fail the run on a probe miss.
    return 0


if __name__ == "__main__":
    sys.exit(main())
