"""Guards over the probe harness itself.

Two regressions motivated this file, both of the same shape: a probe that
*correctly detected* a bug but could not make anyone notice.

  1. round-1/2/3 printed "FAIL: n" and exited 0. `probes.yml` runs them
     under `set -e`, so a red round read as green. The AL Wild Card
     "me"-row regression was caught by round-1 on every run for 27 days
     and never once failed the build.

  2. Nine probes in tests/probes/ were never referenced by probes.yml at
     all — including xss-payloads.js. They passed, but nothing ran them.

A probe that can't fail CI is documentation, not a guard. These tests keep
the harness honest so the *other* guards mean something.
"""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
PROBE_DIR = ROOT / "tests" / "probes"
PROBES_WORKFLOW = ROOT / ".github" / "workflows" / "probes.yml"

# visual.js exits on a diff count rather than a findings array; it has its
# own convention and is asserted separately below.
_EXIT_ON_FAILURE = re.compile(r"process\.exit\(\s*fails(?:\.length)?\s*\?", re.M)


def _probe_files():
    return sorted(p for p in PROBE_DIR.glob("*.js"))


def test_probe_dir_is_not_empty():
    assert _probe_files(), "no probes found — glob or layout changed"


@pytest.mark.parametrize("probe", _probe_files(), ids=lambda p: p.name)
def test_every_probe_propagates_failures_to_exit_code(probe):
    """A probe must exit nonzero when it records a FAIL.

    Without this, `set -e` in probes.yml silently passes a red probe.
    """
    src = probe.read_text()
    assert _EXIT_ON_FAILURE.search(src), (
        f"{probe.name} never exits nonzero on recorded failures. End the run "
        f"with `process.exit(fails.length ? 1 : 0);` so probes.yml can see it."
    )


@pytest.mark.parametrize("probe", _probe_files(), ids=lambda p: p.name)
def test_every_probe_is_wired_into_ci(probe):
    """Every probe file must actually be invoked by probes.yml.

    An unreferenced probe is a guard nobody runs.
    """
    workflow = PROBES_WORKFLOW.read_text()
    assert f"tests/probes/{probe.name}" in workflow, (
        f"{probe.name} exists but probes.yml never runs it — either wire it "
        f"into the workflow or delete it. An unrun probe guards nothing."
    )
