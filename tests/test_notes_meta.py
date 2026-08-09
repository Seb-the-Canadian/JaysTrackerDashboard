"""Tests for fetch_data.notes_last_updated_iso — the git-mtime helper.

Per the "main dashboard text gets stale" thread: the fetcher reads git
history for notes.json so the renderer can show an "analyst voice age"
badge in the header. File mtime would be unreliable in CI (checkouts
reset it), so we go through git.

These tests mock `subprocess.run` at the boundary rather than spinning up
real git repos in tmp_path — the test container's git enforces commit
signing, and we don't want to mix throwaway commits into that. The
end-to-end behavior is covered by the last test, which exercises the
real repo we're running in.
"""
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

import fetch_data


def _mock_git_log(monkeypatch, stdout="", returncode=0, raise_exc=None):
    """Install a mock for fetch_data.subprocess.run that simulates git log."""
    def _fake_run(args, **kwargs):
        if raise_exc is not None:
            raise raise_exc
        if returncode != 0:
            raise subprocess.CalledProcessError(returncode, args, stdout, "")
        return SimpleNamespace(stdout=stdout, stderr="", returncode=0)
    monkeypatch.setattr(fetch_data.subprocess, "run", _fake_run)


def test_notes_last_updated_iso_returns_iso_for_tracked_file(monkeypatch, tmp_path):
    _mock_git_log(monkeypatch, stdout="2026-05-27T15:55:32+00:00\n")
    result = fetch_data.notes_last_updated_iso(repo_root=tmp_path)
    assert result == "2026-05-27T15:55:32+00:00"


def test_notes_last_updated_iso_strips_trailing_newline(monkeypatch, tmp_path):
    _mock_git_log(monkeypatch, stdout="2026-05-29T03:10:41+00:00\n\n")
    assert fetch_data.notes_last_updated_iso(repo_root=tmp_path) == "2026-05-29T03:10:41+00:00"


def test_notes_last_updated_iso_returns_none_for_empty_output(monkeypatch, tmp_path):
    """File not tracked → git log prints nothing → return None."""
    _mock_git_log(monkeypatch, stdout="")
    assert fetch_data.notes_last_updated_iso(repo_root=tmp_path) is None


def test_notes_last_updated_iso_returns_none_for_whitespace_output(monkeypatch, tmp_path):
    _mock_git_log(monkeypatch, stdout="   \n")
    assert fetch_data.notes_last_updated_iso(repo_root=tmp_path) is None


def test_notes_last_updated_iso_returns_none_on_called_process_error(monkeypatch, tmp_path):
    """git exits non-zero (e.g., not a git repo) → swallow and return None."""
    _mock_git_log(monkeypatch, returncode=128, stdout="fatal: not a git repository")
    assert fetch_data.notes_last_updated_iso(repo_root=tmp_path) is None


def test_notes_last_updated_iso_handles_missing_git_binary(monkeypatch, tmp_path):
    """git not installed at all → FileNotFoundError → return None."""
    _mock_git_log(monkeypatch, raise_exc=FileNotFoundError("git not found"))
    assert fetch_data.notes_last_updated_iso(repo_root=tmp_path) is None


def test_notes_last_updated_iso_handles_subprocess_timeout(monkeypatch, tmp_path):
    _mock_git_log(monkeypatch,
                  raise_exc=subprocess.TimeoutExpired(cmd="git", timeout=10))
    assert fetch_data.notes_last_updated_iso(repo_root=tmp_path) is None


def test_notes_last_updated_iso_handles_oserror(monkeypatch, tmp_path):
    _mock_git_log(monkeypatch, raise_exc=OSError("permission denied"))
    assert fetch_data.notes_last_updated_iso(repo_root=tmp_path) is None


def test_notes_last_updated_iso_passes_repo_root_to_subprocess(monkeypatch, tmp_path):
    """Helper must invoke git with cwd=repo_root so we read the correct repo."""
    captured = {}
    def _spy(args, **kwargs):
        captured["args"] = args
        captured["cwd"] = kwargs.get("cwd")
        return SimpleNamespace(stdout="2026-05-30T00:00:00+00:00", stderr="", returncode=0)
    monkeypatch.setattr(fetch_data.subprocess, "run", _spy)
    fetch_data.notes_last_updated_iso(repo_root=tmp_path)
    assert captured["cwd"] == str(tmp_path)
    assert "notes.json" in captured["args"]
    assert "git" in captured["args"]


def test_notes_last_updated_iso_default_repo_root_is_module_dir():
    """End-to-end: real repo, real git, real notes.json.

    Contract: a valid ISO timestamp, OR None when the checkout is shallow
    and the answer would be a guess. Asserting "not None" unconditionally
    would fail wherever CI checks out at depth 1 — and pinning it to a
    timestamp there is precisely the bug this module guards against. CI
    checks out full history (see tests.yml), so the meaningful branch is
    the one normally exercised.
    """
    shallow = subprocess.run(
        ["git", "rev-parse", "--is-shallow-repository"],
        cwd=str(Path(fetch_data.__file__).resolve().parent),
        capture_output=True, text=True,
    ).stdout.strip() == "true"

    result = fetch_data.notes_last_updated_iso()
    if shallow:
        assert result is None, (
            "shallow checkout must report unknown, not the boundary date"
        )
        return
    assert result is not None
    from datetime import datetime
    parsed = datetime.fromisoformat(result)
    assert parsed.year >= 2025  # sanity bound


# --- shallow-clone guard (the "badge lies" bug) ------------------------------
#
# `git log -1 -- notes.json` is a trap in a shallow clone: the grafted
# boundary commit looks like it introduced every file in the tree, so the
# query cheerfully returns the boundary date. actions/checkout defaults to
# fetch-depth 1, so the daily refresh stamped "notes edited yesterday" every
# single day while notes.json had been untouched for weeks. That pinned the
# dashboard's staleness chip permanently green and made
# check_notes_freshness.py structurally unable to fire.
#
# These use REAL git repos (not mocks) because the bug lives entirely in
# git's shallow-history behaviour — a mocked subprocess cannot reproduce it.

import os

GIT_ENV = {
    **os.environ,
    "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
    "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid",
}


def _git(repo, *args):
    return subprocess.run(
        ["git", "-c", "commit.gpgsign=false", "-c", "user.name=t",
         "-c", "user.email=t@example.invalid", *args],
        cwd=str(repo), capture_output=True, text=True, check=True, env=GIT_ENV,
    ).stdout.strip()


@pytest.fixture
def origin_repo(tmp_path):
    """A repo where notes.json was committed first, then N later commits
    touch only data.json — mirroring the real refresh history."""
    repo = tmp_path / "origin"
    repo.mkdir()
    _git(repo, "init", "-b", "main")
    (repo / "notes.json").write_text('{"overview": {}}')
    _git(repo, "add", "notes.json")
    _git(repo, "commit", "-m", "add notes", "--date", "2026-06-20T10:00:00+00:00")
    for i in range(3):
        (repo / "data.json").write_text('{"n": %d}' % i)
        _git(repo, "add", "data.json")
        _git(repo, "commit", "-m", f"Daily data refresh {i}")
    return repo


def test_notes_iso_is_the_real_edit_in_a_full_clone(origin_repo, tmp_path):
    """Baseline: with full history we get the notes.json commit, not HEAD."""
    clone = tmp_path / "full"
    subprocess.run(["git", "clone", f"file://{origin_repo}", str(clone)],
                   check=True, capture_output=True, env=GIT_ENV)
    result = fetch_data.notes_last_updated_iso(repo_root=clone)
    assert result is not None
    assert result.startswith("2026-06-20"), result


def test_notes_iso_refuses_to_guess_in_a_shallow_clone(origin_repo, tmp_path):
    """The regression: a depth-1 clone must NOT report HEAD's date as the
    notes.json edit date. Unknown (None) beats a confident wrong answer —
    the renderer hides the chip rather than showing a false green."""
    clone = tmp_path / "shallow"
    subprocess.run(["git", "clone", "--depth", "1", f"file://{origin_repo}",
                    str(clone)], check=True, capture_output=True, env=GIT_ENV)

    head_iso = _git(clone, "log", "-1", "--format=%aI")
    naive = _git(clone, "log", "-1", "--format=%aI", "--", "notes.json")
    # Precondition: prove the trap is real in this git version, otherwise
    # this test would pass for the wrong reason.
    assert naive == head_iso, (
        "shallow clone no longer misattributes notes.json to HEAD — if git "
        "changed this behaviour, the guard below is moot and can be revisited"
    )

    result = fetch_data.notes_last_updated_iso(repo_root=clone)
    assert result is None, (
        f"returned {result!r} — that's HEAD's date, not a notes.json edit. "
        f"This is exactly the stamp that kept the staleness chip green."
    )
