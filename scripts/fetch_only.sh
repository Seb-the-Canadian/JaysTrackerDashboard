#!/usr/bin/env bash
# fetch_only.sh — local / manual run, no git side effects.
#
# Assumes deps are already installed in the active environment.
# If you don't have MLB-StatsAPI installed, run:
#   pip install -r requirements.txt

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
python3 fetch_data.py
