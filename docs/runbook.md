# Operations runbook

What to do when the daily refresh misbehaves. Each entry below maps a symptom you'd see (in the dashboard, in `data.json`, in a workflow log) to its diagnostic steps and the fix that worked.

Real entries reference a specific issue or PR for the audit trail. Hypothetical entries are marked.

---

## Quick reference

| What | Where |
|---|---|
| Workflow definition | [`.github/workflows/daily-refresh.yml`](../.github/workflows/daily-refresh.yml) |
| Manual entrypoint | `bash scripts/update_and_push.sh` |
| Local-run (no push) | `bash scripts/fetch_only.sh` |
| Workflow run history | GitHub → Actions → "Daily data refresh" |
| Manual dispatch | Same page → "Run workflow" → choose `main` |
| Cron schedule | `0 9 * * *` (09:00 UTC daily, ~5 min jitter under load) |
| Per-run logs | Click the run → "refresh" job → "Fetch data" step |
| Output file | `data.json` (committed; visible in the next commit) |
| Cache file | `data/gamelog_cache.json` (committed; updated alongside `data.json`) |
| Schema contract | [`docs/data-schema.md`](data-schema.md) |
| Schema-drift banner | `index.html:261` (`EXPECTED_KEYS`) and `index.html:569` (banner trigger) |
| Invariant assertions | `fetch_data.py:1189` (`assert_invariants`) |

If a refresh fails, `assert_invariants` `die()`s before the atomic write — the **previous** `data.json` stays in place. The dashboard goes stale (header turns amber after 24h, red after 48h) but never wrong.

---

## Real failure modes

### Dashboard header is amber or red

**Symptom.** Header timestamp shows `>24h ago` (amber) or `>48h ago` (red). The dashboard is rendering yesterday's (or older) data.

**Diagnosis.**

1. Open GitHub → Actions → "Daily data refresh". Did the most recent scheduled run succeed?
2. If the run **failed**, click into it. The "Fetch data" step's log shows the Python traceback or `die()` line. Map the message to a section below.
3. If no run for today appears at all, GitHub Actions cron may have been delayed or skipped (rare; see "Hypothetical" below).
4. If the run **succeeded** but the dashboard is still stale, check that the commit landed on `main` (`git log -1 main -- data.json`). If the commit landed but the dashboard is stale, the issue is GitHub Pages serving cached content — usually resolves within ~5 minutes. Hard-reload or open in incognito to bypass `localStorage`.

**Fix.** Depends on diagnosis. If the workflow run errored, see specific entries below. If Pages is the issue, wait. If a run was skipped entirely, dispatch manually.

---

### `assert_invariants` aborted the run

**Symptom.** Workflow log ends with a stderr line like `division has 4 teams, expected 5` followed by exit code 1. No new `data.json` committed.

**Diagnosis.** The invariant message identifies the failed check. The full list of invariants is in `fetch_data.py:1189` (`assert_invariants`). Common ones and what they imply:

| Message | What it means |
|---|---|
| `division has N teams, expected 5` | MLB standings response didn't return all 5 division teams. Usually transient; retry. |
| `wild_card has N entries, expected >= 10` | League standings under-fetched. Was a real bug pre-#48; if it fires now, check `fetch_wild_card`. |
| `recent_games has no completed games but season is in progress` | Schedule fetch returned no Final games for the past 30 days. Either the team genuinely played zero games (unusual mid-season) or schedule call returned empty. |
| `team.runs_scored is None` / `team.record.w is None` | Schedule or standings response missing expected fields. |
| `injuries must be a list` / `other_unavailable must be a list` | Type drift in the injury report transform. |
| `team_stats is missing or empty` | `fetch_team_stats` or `fetch_league_team_rankings` returned nothing. |
| `team_stats.{group}.{key}.rank=X is not an int in [1, 30]` | Rank derivation broke. See PR #51 history for the original implementation. |

**Fix.** Most invariants fire on transient API misbehavior; **first action is always to re-dispatch the workflow**. If it succeeds on retry, the API was momentarily off; document only if it becomes a pattern. If it fails consistently, the relevant fetcher needs a code fix.

---

### Schema-drift banner is showing in the dashboard

**Symptom.** A red/amber banner appears at the top of the dashboard reading something like *"Schema drift: missing keys foo, bar"*.

**Diagnosis.** A top-level key the renderer expects (`EXPECTED_KEYS` in `index.html:261`) is missing from the current `data.json`. Two real causes:

1. **The fetcher genuinely dropped a key.** Look at the most recent `data.json`'s top-level keys (`python3 -c "import json; print(sorted(json.load(open('data.json')).keys()))"`) and compare against `EXPECTED_KEYS`. If a key is missing, the fetcher regressed.
2. **`EXPECTED_KEYS` mentions a key that was never actually shipped.** Pre-#58, this didn't happen because `EXPECTED_KEYS` only had keys that existed; #58 added `team_stats` and `config` to match reality.

**Fix.** If the fetcher dropped a key, revert the offending PR or fix the regression. If `EXPECTED_KEYS` is wrong, update it. The lesson is in [`docs/agent-dispatch.md`](agent-dispatch.md) → "Lessons learned in production" → "`EXPECTED_KEYS` drift". Same fix discipline applies: keep `EXPECTED_KEYS` and `data.json`'s top-level shape in lockstep.

---

### `recent` field is `null` for every player

**Symptom.** The hot/cold/new pill on player cards doesn't appear. `python3 -c "import json; d=json.load(open('data.json')); print(set(p['recent'] for p in d['roster']['hitters']+d['roster']['pitchers']))"` returns `{None}`.

**Diagnosis.** Two real causes seen so far:

1. **`_fetch_game_log` is routing through the wrong endpoint** — pre-PR #63, it used `statsapi.get("stats", {...personId=X...})`, which silently ignores `personId` and returns league aggregates. Empty splits for every player → `derive_recent_form` returns `None`. Symptom signature: 0/26 players have a non-null `recent`.
2. **Cache is returning stale empty splits.** If a refresh wrote an empty splits list into `data/gamelog_cache.json` (e.g., due to a fetcher bug at the time), subsequent runs read the empty cache via signature match and never refetch. Less likely after PR #67 lands a working fetch, but worth checking.

**Fix.**

- For cause 1: confirm `_fetch_game_log` uses the `/people/{id}` route. The fix is in PR #63.
- For cause 2: delete `data/gamelog_cache.json` and dispatch the workflow. Cold cache → full refetch → cache rebuilt from scratch.

**Reference:** issue #59, PR #63.

---

### `Starting Rotation` panel on the Players tab is empty

**Symptom.** Players tab shows Bullpen, Lineup Regulars, Bench/Depth — but no Starting Rotation section, or starters appear in Bullpen.

**Diagnosis.** `index.html` groups pitchers by `gs >= 3` (games started). If every pitcher's `gs` is missing or `0`, all classify as bullpen. Check:

```bash
python3 -c "
import json
d = json.load(open('data.json'))
for p in d['roster']['pitchers']:
    print(f\"{p['name']}: gs={p.get('gs', 'MISSING')}\")"
```

If `gs` is `MISSING` for every pitcher, the fetcher isn't populating it. Pre-PR #58, `transform_roster` omitted `gamesStarted` from the pitcher dict.

**Fix.** Confirm the pitcher transform in `fetch_data.py:transform_roster` includes `"gs": stat.get("gamesStarted", 0)`. PR #58 added it.

**Reference:** issue surfaced in this session's debug pass; PR #58.

---

### Today's game is missing from `upcoming_games`

**Symptom.** The dashboard's "Upcoming" section starts at tomorrow, not today, even though a game is scheduled for today.

**Diagnosis.** The schedule window's lower bound. Pre-PR #62, `fetch_schedule(cfg, 1, ...)` started at offset `+1` (tomorrow). A today game with no `result` fell into a gap: included in the past window but filtered by `if g.get("result")`, excluded from the future window entirely.

**Fix.** Confirm `fetch_schedule(cfg, 0, ...)` for the future window, AND a `Final` filter on the upcoming transform so a same-day completed game doesn't double-appear in `recent_games` + `upcoming_games`. PR #62 has both.

**Reference:** issue #62.

---

### Defense card missing from Team Stats tab

**Symptom.** Hitting and Pitching cards render on the Team Stats tab, but no Defense card / OAA value appears.

**Diagnosis.** The `team_stats.defense` group is conditional — only present in `data.json` when `fetch_savant_oaa` returned a non-`None` value. Two real causes:

1. **Savant fetch failed.** Same root cause as the Barrel% issue — Cloudflare 403, timeout, etc. Workflow log shows `warning: savant outs_above_average fetch failed: ...`. The fetcher returns `None`; the `defense` group is simply not added; renderer skips the card.
2. **`statcast_enabled: false`** in the fork's `config.json`. The OAA fetch is gated on this flag; setting `false` skips the entire Savant call surface. Working as designed.

**Fix.** Cause 1: re-dispatch the probe (Actions → Probe Baseball Savant access) to confirm reachability; if it's now blocking, rotate `SAVANT_USER_AGENT` and re-probe. Cause 2: set `statcast_enabled: true` in config, dispatch the daily refresh, the Defense card appears on the next data.json commit.

**Reference:** issue #29 (Phase B); see also the Probe Baseball Savant section below.

### Hitter cards show `---` for Barrel% and Hard-Hit%

**Symptom.** Player modal renders `barrel_pct: ---` / `hardhit_pct: ---` for every hitter (or all but one). Field is present, but the value is the dash placeholder.

**Diagnosis.** Two real causes:

1. **Savant fetch failed.** The workflow log will show a `warning: savant {slug} fetch failed: ...` line — typically HTTPError 403 (Cloudflare bot gate) or `URLError: timed out`. The fetcher returns `{}`, all hitters get the dash. Quick check: dispatch the Probe Baseball Savant access workflow (Actions tab) and inspect its verdict.
2. **Sub-threshold-PA player.** Savant's leaderboards are qualified-only by default. A hitter with ~40 PAs won't appear in the CSV — they correctly get `---`. Expected for bench bats and early-season callups.

**Fix.** If cause 1: re-run the probe; if still 403, file an issue and consider rotating the `SAVANT_USER_AGENT` constant in `fetch_data.py` to a browser-style string. If cause 2: no action — placeholder is by design.

**Reference:** issue #29 (Phase B); see also the Probe Baseball Savant section below.

### News panel is missing items from one or more feeds

**Symptom.** `data.news[]` is dominated by a single source (typically Google News); other configured feeds contribute 0 items.

**Diagnosis.** Three possible causes — the per-feed `INFO` logging added in PR #64 surfaces which one:

```
INFO: feed Sportsnet: 0 entries, 0 kept, 0 too old, 0 off-keyword
INFO: feed Bluebird Banter: 5 entries, 0 kept, 5 too old, 0 off-keyword
INFO: feed MLB.com: 25 entries, 3 kept, 18 too old, 4 off-keyword
```

- `0 entries` → feedparser saw nothing. URL is stale, redirected, or being blocked. Try `curl <url>` from a fresh shell.
- `N entries, 0 kept, N too old` → all items fall outside `news_recent_days` (configured in `config.json`, default 2, widened to 7 for the Jays repo in PR #64). Widen the window or accept the gap.
- `N entries, 0 kept, 0 too old, N off-keyword` → keyword filter rejecting everything. Check the feed's recent title corpus for the team name; tighten or relax the filter.

**Fix.** Depends on cause. Stale URL → update `config.json.rss_feeds`. Too-narrow window → bump `news_recent_days`. Bad keyword filter → adjust per-feed `keyword_filter`.

**Reference:** issue #60.

---

### Probable pitcher field is wrong or stale

**Symptom.** `data.upcoming_games[N].probable_pitcher_them` (or `_us`) shows a name that disagrees with the team's actually-announced starter.

**Diagnosis.** The schedule fetch hydrates `probablePitcher` directly from MLB. `transform_upcoming_game` (`fetch_data.py:460`) pulls `(team.probablePitcher).fullName` with no transformation. So the wrong name is what MLB returned. Three possibilities:

1. **MLB API stale.** The team hasn't officially announced and MLB is showing yesterday's placeholder.
2. **MLB API wrong.** A roster change MLB hasn't ingested.
3. **A different MLB endpoint has fresher data.** E.g., `/teams/{id}/probablePitchers`.

**Fix.** If the API will catch up on its own, the next daily refresh will correct itself. If a different endpoint is fresher, swap or augment the hydrate. If we just have to live with soft data, consider a UI affordance ("scheduled to start, subject to change").

**Reference:** issue #66.

---

### Workflow run failed: HTTP 403 or network error to `statsapi.mlb.com`

**Symptom.** Workflow log shows a Python `urllib.error.HTTPError: 403` or `ConnectionError` from a `statsapi.get(...)` call.

**Diagnosis.** GitHub Actions runners normally have unrestricted internet. A 403 from `statsapi.mlb.com` is rare; possibilities:

1. **MLB rate-limiting.** Heavy concurrent access from the same egress IP. Try again later.
2. **MLB endpoint outage.** Check `https://statsapi.mlb.com/api/v1/standings?leagueId=103` in a browser to see if the API itself is reachable.

If running locally (`scripts/update_and_push.sh`), the same network restriction may apply on a managed container — see [`CLAUDE.md`](../CLAUDE.md). Use GitHub Actions for the daily refresh; the Claude Code Routine path has documented blocking issues per issue #32.

**Fix.** Wait + retry the workflow. If a hard outage, the previous `data.json` stays in place and the dashboard goes stale until the API returns.

---

### Workflow run failed: push rejected as non-fast-forward

**Symptom.** Workflow log shows `! [rejected] main -> main (non-fast-forward)` after the commit step succeeded.

**Diagnosis.** `main` moved between the workflow's `git checkout` and `git push` — usually because a PR merge or another workflow run landed a commit in the same window. The workflow has built-in retry logic (`.github/workflows/daily-refresh.yml`): rebases and retries up to 3 times.

**Fix.** Re-dispatch the workflow if the retries exhausted (rare). Each rebase is conflict-free because the daily refresh only touches `data.json` + `data/gamelog_cache.json` — anything else merging in is on a disjoint path.

---

### Pytest suite failed in CI on a pull request

**Symptom.** The "Tests" GitHub Actions check (`.github/workflows/tests.yml`) is red on a PR. The PR page shows a failing pytest step; clicking through lands on the failing test name + assertion diff.

**Diagnosis.** The full suite runs on every PR open / push to `main`. There are three common shapes of failure:

1. **Real regression.** A code change broke something the tests assert about. Read the failing test's docstring and assertion — the test was written to lock in some behavior, and the new code violated it.
2. **Test depends on stale fixture.** Hand-edited fixtures in `tests/conftest.py` (or inline dicts) drifted away from the real MLB Stats API response shape. Less common — most tests use minimal-shape fixtures that don't track API evolution.
3. **Coverage gate dropped below 70%.** The `pytest --cov=fetch_data` invocation enforces ≥70%. Removing tested code without removing the corresponding test, or adding a large new untested function, can trip this. The failure message reads `Required test coverage of 70% not reached`.

**Fix.**

- For cause 1: fix the code, or update the test if the behavior change is intentional (and document why in the test or commit message).
- For cause 2: update the fixture to match current shape, ideally by capturing a real response with a quick `curl` against the documented endpoint.
- For cause 3: add tests covering the new code, or — if the new code is genuinely hard to test (network, time, randomness) — extract the testable core and leave the I/O shell uncovered.

**Local reproduction.**

```bash
python3 -m pytest                       # full suite, ~2-3 seconds
python3 -m pytest tests/test_foo.py -v  # one file with names
python3 -m pytest -x -k "injury"        # stop at first failure, name filter
python3 -m pytest --cov=fetch_data --cov-report=term-missing  # coverage gaps
```

The CI workflow installs from `requirements-dev.txt`; locally you'll want the same. See the "Running tests" section of the README for the dev-env setup.

---

### Notes-drift scanner flagged a stale name (PR-time test or daily-refresh log)

**Symptom A — PR time.** CI on a PR (or a local `pytest` run) fails on `tests/test_notes_drift.py::test_integration_real_files_scan_clean` with output like:

```
WARN notes.team.strengths[0]: "Bichette is walking at a career-high rate"
  unknown token: Bichette
  reason: not_in_roster_or_il
  see: docs/free-text-fields.md
```

**Symptom B — daily refresh log.** The `Scan notes for drift (warn-only)` step in the `Daily data refresh` workflow shows the same `WARN ...` lines. The workflow step always exits 0, so the refresh still commits and pushes — but the log is now flagging notes content that disagrees with the just-fetched roster + IL. Surface: GitHub → Actions → "Daily data refresh" → most recent run → "Scan notes for drift" step.

**Diagnosis.** The notes-drift scanner (`tools/scan_notes_drift.py`) found a capitalized name-like token in a HIGH-drift field that doesn't match any current roster + IL name and isn't in the per-fork whitelist. Three possibilities:

1. **Real drift.** The named player left the roster (trade, DFA, release, retirement, off the IL onto another team's IL). The note in `notes.json` is stale. Same class as the Bo / Berríos / Bassitt findings from #88 and the registry-scanner introduction.
2. **Nickname or alias not in the dictionary.** E.g., `Vlad` for `Vladimir Guerrero Jr.`, `JT` for `Jonathan T. Realmuto`. The scanner builds its dictionary from whitespace-split `roster.*[].name` values, so it doesn't know nicknames.
3. **Common word the scanner doesn't yet have stopworded.** E.g., a baseball noun like "Strikeouts" at the start of a new sentence. Universal across forks → should go in `STOPWORDS` in the scanner.

**Fix, by cause:**

| Cause | Action |
|---|---|
| Real drift | Edit `notes.json` — rewrite the affected field to reflect current reality, then re-run `python3 tools/scan_notes_drift.py` to confirm clean. |
| Nickname / alias | Add the token to `.notes-scan-allow.json`. Example: `{"tokens": ["Vlad", "Schneider"]}`. Per-fork; forkers maintain their own list. |
| Intentional historical reference (rare) | Add `<!-- noscan -->` as a trailing HTML comment in the affected field. Scanner skips any field containing the marker. Use sparingly — it suppresses all checking on that field. |
| Common word / new stopword | Add to `STOPWORDS` in `tools/scan_notes_drift.py` and open a PR. Stopwords are universal; per-fork additions go in the allow file. |

**Local debugging.**

```bash
python3 tools/scan_notes_drift.py             # exit 1 if findings exist
python3 tools/scan_notes_drift.py --json      # structured output for tooling
python3 tools/scan_notes_drift.py --warn-only # exit 0 always
```

The scanner inputs are configurable: `--notes`, `--data`, `--paths`, `--allow`. Useful when triaging a fixture or pre-deployment branch.

**Reference.** PR #89 shipped the registry; the scanner shipped in the follow-up PR. See [`docs/free-text-fields.md`](free-text-fields.md) for the per-field drift class and the full list of paths the scanner walks.

---

## Hypothetical failures (haven't seen, but watch for)

These haven't happened to us yet but are reasonable to plan for.

### GitHub Actions cron skipped a day entirely

**Symptom.** No "Daily data refresh" run appears for a given day in the Actions tab.

**Diagnosis.** GitHub Actions cron is best-effort; under load, it can be delayed by 30 min — or, in rare cases, skipped. Check [https://www.githubstatus.com/](https://www.githubstatus.com/) for the relevant time window.

**Fix.** Dispatch manually. The dashboard will recover on the next successful run regardless.

---

### `data/gamelog_cache.json` corrupted or wrong-shape

**Symptom.** Workflow log shows `warning: gameLog cache unreadable (...); starting fresh` for the first time. Cache rebuilds from scratch (cold-cache behavior) — that run will be slower but otherwise correct.

**Diagnosis.** Possible causes: interrupted write (unlikely given `tmp.replace(target)` atomic pattern), manual edit gone wrong, or a fetcher bug wrote a malformed cache.

**Fix.** Already self-healing: the cache module detects corrupt JSON or wrong-shape (missing `players` key) and falls back to an empty cache. No action needed unless this happens repeatedly, which would imply a fetcher bug.

---

### GitHub Pages serving stale `data.json` despite a recent commit

**Symptom.** New commit landed on `main` 30+ minutes ago; dashboard still shows old timestamp.

**Diagnosis.** Pages occasionally lags on CDN propagation. Hard-reload (`Cmd+Shift+R` / `Ctrl+F5`) bypasses browser cache. Open in incognito to bypass `localStorage`. Check Settings → Pages on GitHub to confirm the deploy succeeded.

**Fix.** Usually waits itself out within 5–10 minutes. If it persists, re-enable Pages from the settings page (forces a fresh deploy).

---

## Maintenance

Add a new failure mode here when you see one. Use the same shape: **Symptom**, **Diagnosis**, **Fix**, **Reference** (linked issue or PR).

Move a "Hypothetical" entry to "Real" if it happens. Tighten the diagnosis with what actually worked vs what didn't.

The point of this doc is that the next person debugging a broken refresh doesn't have to re-discover what we already learned.

---

## Probe workflows

### Baseball Savant reachability (Statcast plan, #29)

**When to run.** Before merging PRs 3 / 4 of the Statcast plan, dispatch the `Probe Baseball Savant access` workflow from the Actions tab. The probe hits three Savant leaderboard CSV URLs from the GH Actions runner with our project User-Agent and prints diagnostics — HTTP status, byte count, parsed row count, first-row column names.

**Interpreting the verdict.**

| Output line | Meaning | Next step |
|---|---|---|
| `VERDICT: green — proceed with PRs 3 + 4` | All three probes returned `200` with non-empty CSV bodies | Merge PR 3 (Barrel%, Hard-Hit%); then PR 4 (OAA) |
| `Status: 403` on any probe | Cloudflare or Savant-side bot gate | Try a browser-style User-Agent (re-run with `--ua "Mozilla/5.0 ..."` or edit `tools/check_savant_access.py`); if 403 persists across 2-3 variants, file a follow-up issue and stop at Phase A (xwOBA only) |
| `Status: 429` or rate-limit error | Volume-based throttling | Wait 10+ min, re-run with a single probe slug |
| `URLError: timed out` | Network reachability fail | Re-run once; if persistent, baseballsavant.mlb.com may be transiently unreachable from GH Actions egress |
| `Row count: 0` with `Status: 200` | Probe URL was accepted but returned an empty CSV (could mean wrong slug or off-season) | Inspect the `Body bytes` count; if non-zero, the CSV has headers but no rows (likely pre-Opening-Day); re-run after the season is in progress |
| `CSV parse error` | Body returned but not a CSV (likely an HTML error page) | Compare returned body to expected CSV format; Savant may have rotated their CSV endpoint |

The probe always exits `0` regardless of result — we want the workflow to complete and surface the diagnostic, not fail the run on a probe miss.

