"""Contract-drift check — the structural guard for the data.json contract.

The data contract is encoded in several places that historically drifted:
  - fetch_data.py's `output = {...}` (what the fetcher emits)
  - assets/render.js EXPECTED_KEYS (what the renderer requires)
  - assets/players.js `myRanks.<slug>` reads (what the renderer reads)
  - docs/data-schema.md (the human reference)

This session hit two drift bugs that nothing caught at CI time:
  1. G1 — players.js read rank slugs (k_per_9, …) the fetcher never emitted,
     while the fetcher emitted slugs (avg, runs) nothing read → blank rails.
  2. opponent_pitchers / player_rank_pool added to the output + EXPECTED_KEYS
     but the live schema-drift banner fired until a refresh caught up.

schema/data_contract.json is the one declaration; these tests assert every
other encoding agrees with it. Pure source/constant parsing — no API calls —
so it runs in the normal pytest job.
"""
import ast
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
CONTRACT = json.loads((ROOT / "schema" / "data_contract.json").read_text())


# --- helpers: extract each encoding from source --------------------------

def _fetcher_output_keys():
    """Top-level keys of the `output = {...}` dict literal in fetch_data.main().

    AST-parsed (not regex) so nested dicts don't leak keys: we take the
    dict assigned to `output` whose keys include the sentinel `as_of`.
    """
    tree = ast.parse((ROOT / "fetch_data.py").read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Dict):
            targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
            if "output" not in targets:
                continue
            keys = [k.value for k in node.value.keys
                    if isinstance(k, ast.Constant) and isinstance(k.value, str)]
            if "as_of" in keys:
                return keys
    raise AssertionError("could not find the `output` dict in fetch_data.py")


def _expected_keys_js():
    """The EXPECTED_KEYS array contents from assets/render.js."""
    src = (ROOT / "assets" / "render.js").read_text()
    m = re.search(r"EXPECTED_KEYS\s*=\s*\[(.*?)\]", src, re.DOTALL)
    assert m, "EXPECTED_KEYS array not found in render.js"
    return set(re.findall(r"'([^']+)'", m.group(1)))


def _renderer_rank_slugs():
    """Slugs the players.js modal/pcard reads off `myRanks.<slug>`."""
    src = (ROOT / "assets" / "players.js").read_text()
    return set(re.findall(r"myRanks\.(\w+)", src))


def _doc_sections():
    """Top-level keys that have a `### key` section heading in data-schema.md."""
    src = (ROOT / "docs" / "data-schema.md").read_text()
    return set(re.findall(r"^###\s+`([a-z0-9_]+)`", src, re.MULTILINE))


# --- A1: fetcher output == contract -------------------------------------

def test_fetcher_output_matches_contract():
    emitted = set(_fetcher_output_keys())
    declared = set(CONTRACT["top_level_keys"])
    assert emitted == declared, (
        f"fetch_data output vs contract drift — "
        f"emitted-only={emitted - declared}, contract-only={declared - emitted}")


# --- A2: render.js EXPECTED_KEYS == contract ----------------------------

def test_expected_keys_matches_contract():
    expected = _expected_keys_js()
    declared = set(CONTRACT["top_level_keys"])
    assert expected == declared, (
        f"render.js EXPECTED_KEYS vs contract drift — "
        f"render-only={expected - declared}, contract-only={declared - expected}")


# --- A3: fetcher PLAYER_*_STATS slugs == contract -----------------------

def test_player_rank_stat_slugs_match_contract():
    import fetch_data
    hitting = {slug for slug, _field in fetch_data.PLAYER_HITTING_STATS}
    pitching = {slug for slug, _field in fetch_data.PLAYER_PITCHING_STATS}
    assert hitting == set(CONTRACT["player_rank_stats"]["hitting"]), (
        f"PLAYER_HITTING_STATS vs contract: {hitting ^ set(CONTRACT['player_rank_stats']['hitting'])}")
    assert pitching == set(CONTRACT["player_rank_stats"]["pitching"]), (
        f"PLAYER_PITCHING_STATS vs contract: {pitching ^ set(CONTRACT['player_rank_stats']['pitching'])}")


# --- A4: renderer-read slugs ⊆ emitted slugs (THE G1 bug) ---------------

def test_renderer_rank_reads_are_emitted():
    read = _renderer_rank_slugs()
    emitted = (set(CONTRACT["player_rank_stats"]["hitting"])
               | set(CONTRACT["player_rank_stats"]["pitching"]))
    unmet = read - emitted
    assert not unmet, (
        f"players.js reads rank slugs the fetcher never emits: {unmet}. "
        f"This is the G1 blank-rail bug class — add the slug to "
        f"PLAYER_*_STATS + the contract, or stop reading it.")


# --- A5: every contract key is documented -------------------------------

def test_every_contract_key_is_documented():
    documented = _doc_sections()
    missing = set(CONTRACT["top_level_keys"]) - documented
    assert not missing, (
        f"data-schema.md is missing a section for: {missing}. "
        f"Document the key (purpose/shape/example/fields) in the same PR.")
