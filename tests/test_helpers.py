"""Smoke test — confirms pytest discovery, conftest import, and the
fetch_data module is importable. Replaced/expanded in PR2 with the full
helpers test catalog."""
import pytest

import fetch_data


@pytest.mark.parametrize(
    "rs,ra,gp,expected_w,expected_l",
    [
        pytest.param(250, 200, 60, 37, 23, id="more_runs_scored_than_allowed"),
        pytest.param(200, 250, 60, 23, 37, id="more_runs_allowed_than_scored"),
        pytest.param(0, 0, 60, 0, 0, id="zero_runs_returns_zero_zero"),
        pytest.param(100, 100, 0, 0, 0, id="zero_games_returns_zero_zero"),
    ],
)
def test_pythag_typical_inputs_returns_expected_wl(rs, ra, gp, expected_w, expected_l):
    w, l = fetch_data.pythag(rs, ra, gp)
    assert w == expected_w
    assert l == expected_l
