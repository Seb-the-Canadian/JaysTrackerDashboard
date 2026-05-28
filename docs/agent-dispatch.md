# Sub-agent dispatch method

How to attack the backlog as project manager: when to delegate to a sub-agent, when to do it yourself, and how to run agents in parallel without stepping on yourself.

The method assumes the [`Agent` tool](https://docs.claude.com/en/docs/claude-code/agents) is available with at least these subagent types: `Plan`, `Explore`, `general-purpose`. Parallelism means multiple `Agent` calls in a single tool-use block — the harness runs them concurrently and returns all results before the next turn.

---

## When NOT to use a sub-agent

Direct work is faster than dispatch overhead when the job is:

- A single edit in a known file (Read → Edit, done)
- A lookup of one symbol (`grep` via Bash)
- A 5-line code change
- A doc typo fix
- A `git` operation

Dispatch overhead is real: writing a self-contained prompt costs you 60–90 seconds; the agent costs minutes. If you'd be done before the agent boots, just do it.

---

## Triage: four questions per issue

Answer these in order. The answers feed into pattern selection below.

| # | Question | Answers |
|---|----------|---------|
| 1 | **Work type** | research / design / implement / verify / document |
| 2 | **Blast radius** | 1 file / N files in one domain (e.g., UI) / cross-domain (fetcher + UI + schema) / external surface (API contract, schema, config) |
| 3 | **Dependencies** | none / blocked by issue #N / blocks issue #N / contract with #N |
| 4 | **Verification gate** | read diff / type check / dashboard visual / `workflow_dispatch` run / cross-browser |

Write the answers down (TodoWrite is fine) before picking a pattern. The triage IS the planning.

---

## Dispatch pattern selection

| Triage outcome | Pattern | Why |
|---|---|---|
| 1 file, known location, small change | **Direct** | Overhead exceeds benefit |
| "Where does X live?" / "Which files use Y?" | **Explore solo** | Read-only search, no edits |
| Multi-file routine implementation, no design call | **`general-purpose` solo** | One agent can hold the whole change |
| Design decision needed before code | **`Plan` → `general-purpose`** | Lock the contract, then build |
| Schema contract + 2+ independent consumers | **`Plan` → parallel `general-purpose`** | Decoupled work, single contract |
| N independent issues unblocked, touching disjoint files | **Parallel `general-purpose`, one per issue** | True swarm; bounded by file conflicts |
| Implementation done, need second-opinion review | **`Plan` for review** (or `general-purpose` with review brief) | Independent eyes on the diff |

Two hard rules for parallel swarms:

1. **No two parallel agents touch the same file.** They will race on the diff; the last one to land overwrites the first. If issues collide on a file, serialize.
2. **Lock the contract before parallelizing.** If agents need an agreed JSON shape, function signature, or CSS class, design it once (Plan) and paste it into each parallel agent's prompt.

---

## Prompt template

Every sub-agent prompt is self-contained — the agent has no memory of this conversation, no implicit context. Use this skeleton:

```
[1. WHAT + WHY in one paragraph]
What's the goal of this task and why does it matter? Reference the
issue number and what the broader project is doing.

[2. CONTEXT the agent doesn't know]
- Repo: <one-line description>
- Files involved with line numbers if known
- What's been tried and ruled out (so the agent doesn't repeat it)
- Relevant constraints (network policy, schema, conventions)

[3. CONCRETE TASK]
- File X: do Y
- File Z: do W
- Don't touch file Q (someone else has it)

[4. ACCEPTANCE CRITERIA]
- Checkable items, ideally mirroring the GitHub issue's criteria

[5. OUTPUT FORMAT]
- "Write the diffs to disk. Report back in <300 words with: (a) what
  you changed, (b) anything surprising you found, (c) anything you
  didn't do and why."
```

The single most common prompt failure: terse command-style briefs ("implement the team stats fetcher"). Agents fill ambiguity with guesses. Spell it out.

---

## Cross-issue planning

Backlog work is a graph. Build it once per planning pass:

1. **Extract dependencies** from issue bodies (the `## Dependencies` section). Cross-refs like "blocks #22" or "should land after #28" define edges.
2. **Identify unblocked issues** — roots of the dependency DAG.
3. **Group by file touch.** Two unblocked issues that both edit `index.html` cannot run in parallel; serialize them.
4. **Dispatch a wave** of 2–4 parallel agents on the disjoint group. More than 4 in flight at once gets hard to verify.
5. **After the wave lands**, refresh the graph (some issues are now unblocked) and repeat.

Track in-session with `TodoWrite`. GitHub issues remain the durable record — don't duplicate state.

---

## Verification discipline

The agent's summary describes intent, not reality. After every dispatch:

1. **Read the diff.** `git diff <branch>` or open the changed files. If you can't articulate what changed in one sentence, you didn't actually verify.
2. **Run the cheap check first.** Syntax: load the page in a browser; lint passes; JSON parses. If this fails, the agent's diff is broken.
3. **Run the expensive check second.** `workflow_dispatch` for fetcher changes, full visual sweep for UI changes.
4. **Read the agent's own summary last.** Use it to cross-check your own observations — don't anchor on it.
5. **If the diff is wrong**, revert and re-dispatch. Don't try to fix an agent's output by patching — the agent had wrong context; give it better context and re-run.

---

## Failure handling

| Failure | Response |
|---|---|
| Agent returns ambiguous or partial result | Re-dispatch with a sharper brief (more files, more context, stricter acceptance) |
| Agent makes a wrong design call | `git restore .` the changes, re-plan with the new constraint encoded |
| Two parallel agents clashed on a file | Pick one diff to keep, re-dispatch the other against the updated tree |
| Network policy blocks a tool the agent tries | The agent can't bypass it. Note the limit in the prompt up-front |
| Agent claims done but acceptance criterion fails | Read the diff, identify the specific gap, re-dispatch with that gap as the entire brief |

---

## Worked example: Issue #24 (team stats with rankings)

[Issue #24](https://github.com/seb-the-canadian/jaystrackerdashboard/issues/24) — pull team-level stats with MLB ranks. Touches `fetch_data.py` (new fetchers) and `index.html` (`renderTeam` update). Has a design ambiguity: per-stat sorted calls (8 calls) vs `stats_leaders` endpoint (1 call).

### Step 0 — Triage

| # | Answer |
|---|---|
| Work type | Design + implement |
| Blast radius | 2 files (`fetch_data.py`, `index.html`) + new `data.json` section |
| Dependencies | Independent; blocks #22 (team narrative reads ranks) |
| Verification gate | `workflow_dispatch` → inspect `data.json.team_stats` → dashboard visual |

### Step 1 — Pattern: Plan → parallel pair → verify

Schema is the contract; once locked, fetcher and renderer can run in parallel.

### Step 2 — Plan dispatch

```text
Agent(
  description: "Design team_stats schema for #24",
  subagent_type: "Plan",
  prompt: """
  Design the data.team_stats JSON shape for issue #24.

  Repo: Blue Jays 2026 Tracker — fetch_data.py uses the MLB-StatsAPI Python
  package to produce data.json daily; index.html reads data.json and renders.
  Network policy blocks statsapi.mlb.com from this container, so design
  decisions can't be A/B tested live — pick based on docs and existing code
  patterns.

  Issue body: <paste from gh issue view 24>

  Decide between:
  - Per-stat sorted call (8 calls): statsapi.get('stats', sortStat=..., ...)
  - stats_leaders endpoint (likely 1-2 calls): returns pre-ranked teams

  Read fetch_data.py first; match its existing function style (fetch_X
  helpers, transform_X for shaping, all called from main()). Read
  docs/mlb-statsapi-reference.md if it covers either endpoint.

  Output (under 400 words):
  1. Final JSON shape for data.team_stats with example values
  2. API approach with rationale (call count, reliability, alignment with
     existing code)
  3. Function signatures and call order in main()
  4. Anything that would block implementation
  """
)
```

The Plan agent returns a contract: schema + function names + call sequence. Paste that contract into both parallel agents.

### Step 3 — Parallel implement

Both calls go in **one** assistant message so they run concurrently:

```text
Agent(
  description: "Implement fetch_team_stats for #24",
  subagent_type: "general-purpose",
  prompt: """
  Implement team-stats fetching in fetch_data.py for issue #24.

  Contract from Plan agent: <paste full plan output>

  Repo context: fetch_data.py is the daily Python fetcher; writes data.json
  atomically via write_atomic(). MLB-StatsAPI calls go through statsapi.get().
  Existing fetchers (fetch_division_names, fetch_wild_card, fetch_schedule)
  show the style. Network policy blocks statsapi.mlb.com from this container,
  so you CANNOT run fetch_data.py to verify — write the code, lint syntax,
  but expect the user to validate via workflow_dispatch.

  Tasks:
  1. Add fetch_team_stats(cfg) and fetch_league_team_rankings(cfg) per contract
  2. Wire them into main() in the order specified
  3. Add team_stats to the assert_invariants() check (non-empty dict, rank is
     int 1-30 for each populated stat)
  4. Do NOT touch index.html — separate agent

  Acceptance:
  - data['team_stats'] populated with hitting + pitching values + ranks
  - Ranks are integers in [1, 30]
  - ≤8 new API calls per run
  - Python syntax check passes (python -m py_compile fetch_data.py)

  Output (under 300 words): summary of what you added, function names with
  line numbers, any open questions for the user.
  """
)

Agent(
  description: "Implement renderTeam ranks for #24",
  subagent_type: "general-purpose",
  prompt: """
  Update renderTeam() in index.html to render team_stats with MLB ranks for
  issue #24.

  Contract from Plan agent: <paste full plan output>

  Repo context: index.html is the dashboard. renderTeam() reads window.DATA
  (data.json). The Phase 3 work preserved CSS for .stat-row helpers. Notes
  voice merges via NOTES.team but is out of scope here — issue #22 covers
  that.

  Tasks:
  1. Read existing renderTeam() to match its style
  2. Render data.team_stats per contract — show value + "Rank N" inline
  3. Fallback: when data.team_stats is missing/empty, render the current
     panel exactly as today (no regression for stale data.json)
  4. Do NOT touch fetch_data.py — separate agent

  Acceptance:
  - When team_stats is present: artifact-style metric grid with "Rank N"
  - When team_stats is missing: current behavior, no console errors
  - No new dependencies; vanilla JS only
  - No console errors when loading the dashboard with the current data.json

  Output (under 300 words): summary, the changed function diff, any visual
  gotchas you noticed.
  """
)
```

### Step 4 — Verify

After both agents return:

1. `git diff` — read both changes end-to-end. Confirm the contract held: agent A's output shape matches agent B's input shape.
2. `python -m py_compile fetch_data.py` — syntax check.
3. Open `index.html` locally against current `data.json` — confirm fallback renders cleanly (team_stats not yet present in committed data.json).
4. Push the branch, open draft PR, trigger `workflow_dispatch` on the workflow against the branch.
5. After workflow run: pull `data.json`, inspect `team_stats` shape, confirm ranks are ints 1–30.
6. Refresh dashboard against new `data.json` — visual check.
7. Mark PR ready for review.

### Step 5 — Failure modes that actually happen

- **Plan agent suggests `stats_leaders` but the endpoint returns a different shape than docs imply.** Fetcher agent hits the surprise, returns it as an open question. PM (you) decides: extend the plan or fall back to per-stat calls.
- **Renderer agent breaks the fallback path.** Visual check catches it. Re-dispatch with the fallback constraint as the entire brief.
- **Contract drift between agents.** Catch in diff review: the JSON keys diverge. Pick one, re-dispatch the other.

---

## Anti-patterns

- **Spawning an agent for a 5-line edit.** Direct work is faster.
- **Skipping diff review.** The agent's claim is not evidence.
- **Parallel agents on the same file.** They will race; you'll lose work.
- **One-line agent prompts.** "Implement #24" yields generic, wrong-shaped code.
- **Asking an agent to "design and build."** Split it: Plan agent decides, implement agents build to the locked contract.
- **Letting an agent decide the verification gate.** PM picks the test; agent reports against it.
- **Re-using an in-flight branch as a fresh agent's workspace.** Use a clean tree per dispatch or isolate via `isolation: "worktree"`.

---

## Triage matrix for current backlog

Compact view as of writing — re-triage when the graph changes.

| # | Title | Type | Files | Deps | Pattern | Notes |
|---|---|---|---|---|---|---|
| 20 | notes.json per-player schema | design + impl | `notes.json`, `index.html` | none (foundation) | Plan → solo `general-purpose` | Schema pattern reused by #21–23 |
| 21 | overview narrative | impl | `notes.json`, `index.html` | independent; do after #20 | solo `general-purpose` | Same merge pattern as #20 |
| 22 | team context + strengths/soft spots | impl | `notes.json`, `index.html` | reads better after #24 | solo `general-purpose` | Land #24 first for full effect |
| 23 | injury narrative | impl | `notes.json`, `index.html`, `fetch_data.py` (tiny) | after #28 | solo `general-purpose` | Verify `person_id` is set in fetcher first |
| 24 | team_stats with ranks | design + impl | `fetch_data.py`, `index.html` | independent; blocks #22 | **Plan → parallel pair** (worked example above) | |
| 25 | recent hot/cold tag | impl | `fetch_data.py`, `index.html` | independent | solo `general-purpose` | ~26 new API calls/day cost — confirm acceptable |
| 26 | players grouped by role | impl | `index.html` | independent | direct (single file, single function) | No fetcher change |
| 27 | Stat School team examples | impl | `index.html`, `notes.json` | independent | solo `general-purpose` | Schema pattern from #20 |
| 28 | injury list filter | impl | `fetch_data.py`, `index.html` | blocks #23 | solo `general-purpose` | Decision already made in issue body (Option B) |
| 29 | Statcast integration | research + impl | out of scope v1 | new module | deferred | Multi-PR effort |
| 30 | README screenshot | doc | `README.md`, `docs/screenshot.png` | none | direct | Just take the screenshot |
| 31 | project-plan.md typo | doc | `docs/project-plan.md` | none | direct | One bullet edit |
| 32 | scheduler-swap doc update | doc | `README.md`, `docs/project-plan.md`, `docs/launchd-migration.md` | none | solo `general-purpose` | Three small edits, parallel-safe but small enough for one agent |
| 33 | meta: custom labels | meta | GitHub Settings | none | direct (or skip if `gh` not available) | Not a code task |

### Suggested first wave (all unblocked, file-disjoint)

Three parallel `general-purpose` agents:
- **#26** — `index.html` `renderPlayers()` only
- **#31** — `docs/project-plan.md` one-line edit
- **#24 Plan step** — schema design (no edits)

After they land: refresh graph. #20's solo dispatch and #24's parallel-pair dispatch become the next wave.

---

## Lessons learned in production

Real-world failure modes observed across Waves 1–3 + the wild-card and RSS work. Each one is a guardrail that belongs in every brief.

### `git push` returns HTTP 403 in this container

The interactive Claude container's outbound proxy rejects `git push` to the GitHub remote with HTTP 403. Force-push, regular push, `--no-thin`, larger `http.postBuffer` — all return the same 403. The MCP GitHub tools bypass the proxy and work fine.

**Implication:** every brief must instruct the agent to push via `mcp__github__push_files` or `mcp__github__create_or_update_file`. Never `git push`. The PM (you) cannot fall back to `git push` either — same proxy, same 403.

### Section divider drift causes merge conflicts

`index.html` has JS section dividers like `// ─── State ──────────────────────────────────────────────────────────────────`. An agent that retypes one of these (e.g., during a partial-write retry) usually changes the `─` count by ±2. Git's 3-way merge then sees both branches modifying the same line with different content, and conflicts.

This bit us hard on Wave 2: PRs #42, #43, #44 all had divider drift from agent retries. After #41 merged to main, all three had to be closed and redone on fresh branches.

**Guardrail in every brief touching `index.html`:**

```
DO NOT modify any existing JS section divider comments
(`// ─── ... ───`). Touch only the regions you need.
```

And a verification step:

```
git diff origin/main..HEAD -- index.html | grep "^[+-]// ─"
# must be empty
```

### Worktree isolation has edge cases

Sub-agents launched with `isolation: "worktree"` are supposed to operate in `.claude/worktrees/agent-<id>/`. In practice, two leak modes:

1. **Agent leaves the main worktree on a different branch.** After an agent completes, `git status` in the main worktree may show you on the agent's branch with uncommitted changes. Always `git status` after agent runs; switch back to main if needed.
2. **Stale worktrees accumulate.** `git worktree list` shows all of them with `locked` status. Clean up with `git worktree remove -f -f <path>` when they're no longer needed.

### Pushing large files via MCP is byte-fragile

`mcp__github__push_files` and `create_or_update_file` take file content as a string parameter. Constructing that string by hand for files >50 KB risks Unicode mangling — we lost two `─` characters per box-drawing line on a README push, which then read as a conflict against main.

**Two patterns that work:**

1. **Edit locally, delegate the push to a sub-agent.** The agent uses `Read` (preserves bytes) and immediately calls `push_files` with the result. No manual transcription.
2. **For small files (<10 KB),** hand-construct the string in the tool call, with explicit `\n` escapes and `—` for em-dashes. Verify byte length after.

### Branches based on stale main show "false" diff

When agents work in worktrees off `origin/main` and the daily refresh moves main forward (new `data.json` commit), the agent's branch ends up "behind" on `data.json`. `git diff origin/main..branch` shows `data.json` in the diff — but **the 3-way merge resolves cleanly** because only main side changed it.

Visually surprising in GitHub's PR view, but functionally fine. Just note it.

### Closed-and-reopened PR pattern

When a branch's history has accumulated too much drift (multiple catch-up commits, divider drift, conflict-resolution merges), trying to salvage the PR via further rebases is usually slower than:

1. Close the dirty PR with a comment: `Superseded by #N`
2. Create a fresh branch from current main
3. Apply only the PR's intended changes via sub-agent
4. Open new PR

Worked twice this session — PR #38 → #41 (wild-card fix; convoluted merge history), Wave 2's #42/#43/#44 → #45/#46/#47 (divider drift).

### Agents sometimes split commits

A brief that says "push once" may still produce 2–3 commits — the agent retries on partial push failure, or splits files because one was too large for a single call. **The final tree state is what matters** for merging. Commit history is cosmetic for small PRs. Don't burn cycles fixing it.

### Daily refresh moves main forward mid-work

If a sub-agent is running for 10+ minutes and the daily-refresh workflow happens to fire, main moves forward by one `data.json` commit. The agent's worktree base is now stale. Nothing breaks — the merge still resolves cleanly — but the agent's "current main" snapshot is one commit behind.

If precision matters, the PM can fetch and re-base the agent's branch after the agent completes. Most of the time, GitHub's 3-way merge handles it transparently.

### `statsapi.mlb.com` is blocked from the interactive container

The Claude Code remote-execution environment's outbound network policy rejects `statsapi.mlb.com`. You **cannot** run `fetch_data.py` locally to verify a fetcher change. `baseballsavant.mlb.com` (issue #29) is presumably the same.

Verification path:

1. Push the branch
2. Trigger `.github/workflows/daily-refresh.yml` via `workflow_dispatch` (web UI; the GitHub MCP tools don't expose `workflow_dispatch` here)
3. Pull the resulting commit, inspect `data.json`

**Guardrail in every fetcher brief:** state explicitly that the agent cannot run the fetcher to confirm output shape — the PM verifies via workflow dispatch. Otherwise the agent will try to `python fetch_data.py` and the failure looks like a code bug.

### The `/stats` endpoint with `personId` silently ignores `personId`

The MLB stats API has two ways to ask for a player's stats: the `/stats` query endpoint and the `/people/{personId}` path-routed endpoint with a `stats` hydrate. **The first one silently ignores `personId` and returns league aggregates** — no error, no warning, just wrong data with the right shape.

This bit us twice:

- **Season stats (early Phase 2):** every player on the roster came back with the same `.330/.831/4` line. The author caught it and rewrote `fetch_player_season_stats` to use `statsapi.player_stat_data`, which routes through `/people/{id}`. Comment at `fetch_data.py:467-473` documents it.
- **gameLog (#59, fixed in #63):** `_fetch_game_log` still used the broken `/stats` pattern, so `derive_recent_form` got empty splits or wrong-player splits for every player. The hot/cold/new pill rendered `null` on every player card for two consecutive daily refreshes. Fix routes via `statsapi.get("person", {"personId": ..., "hydrate": "stats(group=...,type=gameLog,...)"})`.

**Guardrail:** any new per-player MLB stat call goes through `/people/{personId}`, not `/stats`. If a future statsapi version exposes a working `/stats?personId=X`, prove it with a single-player A/B (two different `personId` values must return different lines) before trusting it.

### Schedule windows that meet at "today" drop today's not-yet-final games

`fetch_schedule(cfg, -SCHEDULE_PAST_DAYS, 0)` (past through today) plus `fetch_schedule(cfg, 1, SCHEDULE_FUTURE_DAYS)` (tomorrow onward) seems exhaustive. It isn't — today's game lives only in the past window, but `transform_recent_game` filters out games without a `result` (no Final status yet), so an unfinished today-game falls into a gap between the two lists.

Symptom (#62): the dashboard's "Upcoming" section started at *tomorrow's* game, hiding the game happening today. Probable-pitcher fields on the missing game were lost with it.

**Fix pattern:** the future window should start at offset `0`, and the upcoming transformer should filter out games whose `abstractGameState == "Final"` (so a finished today-game that already lives in `recent_games` doesn't double-appear).

**Guardrail:** any range-based pull whose ranges meet at a boundary (today, the season start, a trade-deadline date) needs a thought-out rule for which side owns the boundary. Off-by-one is the default outcome.

### RSS feeds returning zero items can be completely silent

`feedparser.parse(url)` sometimes returns `entries == []` without setting `bozo_exception`. The original `fetch_news` logged only when `bozo_exception` *and* entries were empty, so the genuine "feed returned 0 entries" case slipped through without a warning. Same for "feed returned entries but all failed the recency filter" and "all filtered by keyword."

Result (#60): three of four configured feeds contributed 0 items to the dashboard for an unknown period, and the workflow log had no signal of why.

**Fix pattern:** after parsing each feed, emit one INFO line with counts — entries received, kept, dropped by recency, dropped by keyword. Then the next workflow log tells you which filter is biting.

```python
log(f"INFO: feed {source}: {len(entries)} entries, "
    f"{kept} kept, {recency_drops} too old, {keyword_drops} off-keyword")
```

**Guardrail:** any silent-skip path in a fetcher is a future debugging tax. Either log it or assert against it. "It didn't show up in the output" is the worst kind of bug report.

### `EXPECTED_KEYS` drift when a new `data.json` field lands

`index.html` keeps an `EXPECTED_KEYS` array used by the schema-drift banner — if a key goes missing from `data.json`, the banner fires. Easy to forget to add a new top-level key to this array when shipping a fetcher feature. The result is silent: a regression that drops the new key won't fire the banner.

Caught in the debug pass before #58 — `team_stats` and `config` had been added to `data.json` but never added to `EXPECTED_KEYS`.

**Guardrail:** every new top-level key in `data.json` must be added to `EXPECTED_KEYS` in the same PR. A quick post-merge check: `diff <(python3 -c "import json;print('\n'.join(sorted(json.load(open('data.json'))))))" <(grep "EXPECTED_KEYS" index.html | tr "'" '\n' | grep -v "^[][,= ]")` — empty diff means in sync.

---

## Reference

- [Agent tool docs](https://docs.claude.com/en/docs/claude-code/agents)
- This project's issue list: `gh issue list` or [GitHub issues](https://github.com/seb-the-canadian/jaystrackerdashboard/issues)
- Repo orientation: [`README.md`](../README.md)
- Project plan history: [`docs/project-plan.md`](project-plan.md)
