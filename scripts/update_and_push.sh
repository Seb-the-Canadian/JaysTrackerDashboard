#!/usr/bin/env bash
# update_and_push.sh — daily refresh entrypoint
#
# Used by both the Claude Code Routine and the launchd fallback (Phase 6).
# Runs the fetcher, then commits + pushes data.json IF it changed.
# Exits 0 on no-op (no changes). Exits non-zero on any failure;
# the routine's error reporting surfaces the failure.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

python3 -m pip install -r requirements.txt --quiet
python3 fetch_data.py

# git status --porcelain catches modified AND newly-untracked data.json
# (first-run case). Empty output means no change to commit.
if [[ -z "$(git status --porcelain data.json)" ]]; then
  echo "no changes"
  exit 0
fi

git add data.json
git -c user.name="jays-tracker-bot" -c user.email="bot@example.invalid" \
  commit -m "Daily data refresh: $(date -u +%Y-%m-%d)"
git push

echo "pushed daily refresh"
