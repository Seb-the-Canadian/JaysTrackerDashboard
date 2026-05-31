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
    """End-to-end: real repo, real git, real notes.json. Returns valid ISO."""
    result = fetch_data.notes_last_updated_iso()
    assert result is not None
    from datetime import datetime
    parsed = datetime.fromisoformat(result)
    assert parsed.year >= 2025  # sanity bound
