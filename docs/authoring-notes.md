# Authoring notes — the maintenance loop

`notes.json` is the hand-authored analyst-voice layer. Unlike `data.json` (which refreshes every morning via the daily workflow), notes age until you edit them. This guide is the practical loop for keeping the analyst voice fresh.

The loop:

1. **Notice** — the dashboard header's "Analyst voice: Nd old" badge turns amber (>7d) or red (>14d). Or you push a PR and CI's notes-drift / notes-orphans tests flag something stale.
2. **Brief** — run `python3 tools/draft_notes_brief.py` to see current team state, hot/cold tags, IL changes, and per-section ages.
3. **Edit** — open `notes.json` and refresh the affected sections. Use evergreen phrasing (see below).
4. **Validate** — run `pytest` locally. The drift + orphan + integration tests run in <2s.
5. **Commit + push** — the daily workflow's warn-only scanners catch anything you missed post-merge.

---

## Cadence by section

How often each top-level key in `notes.json` benefits from a refresh:

| Section | Cadence | Why |
|---|---|---|
| `overview.headline` / `overview.paragraphs[]` | Weekly | Most prominent text on the dashboard, ages fastest. The "state of the season" framing shifts with each series. |
| `team.strengths[]` / `team.softspots[]` | Bi-weekly | Trend statements. Hold for ~2 weeks; shift when sustained ranks move. |
| `team.ctx[group.stat]` | When ranks move | Per-stat context. Most lines stay accurate as long as the rank stays in roughly the same tier. |
| `players[id].*` | Bi-weekly per active star, monthly otherwise | `recentNote` ages fastest (snapshot of a recent stretch); `read` and `contextNotes` age slower (paragraph-level identity statements). |
| `injuries[id].*` | Reactive | Edit when a player goes on / comes off the IL. The brief surfaces "IL players without injury notes." |
| `pitches[name]` | Rare (when a relevant pitcher arrives or leaves) | Pitch-type identity is stable; the team-specific anchor shifts only on roster moves. |
| `games[gamePk]` | Historical (write at the time, don't refresh) | `gamePk` is permanent. Notes write themselves into the archive. |

These cadences are guidance, not enforcement. They drive the per-section badges in `tools/draft_notes_brief.py` and are documented in `tools/draft_notes_brief.py:CADENCE`.

---

## The evergreen phrasing principle

**Test:** would this sentence still read as true in 2 weeks without an edit?

**Avoid** — anything that hard-stamps the moment:

- ❌ "Through 52 games — the bats are carrying the freight"
- ❌ "across the first two months"
- ❌ "the schedule turns favorable through mid-June, with seven of the next ten at home"
- ❌ "in the last week" / "over the past 10 games" / "tonight's matchup"

These age in days. The drift scanner can't catch them (they're not name-mention drift) but readers notice them immediately.

**Prefer** — framings that hold:

- ✅ "The bats are doing the work, the rotation is doing the surviving"
- ✅ "The pattern has held since opening week"
- ✅ "If the rotation can stabilize at all, this team has a path to a 90-win pace"
- ✅ Identity statements ("the lineup grinds at-bats deep")
- ✅ Conditional outlooks ("if X, then Y")
- ✅ Stable historical anchors ("the most patient Jays lineup since 2021")

The rule of thumb: time-anchor only when the anchor is durable. "Since spring" works through July; "the next ten games" expires in two weeks.

---

## The refresh checklist

When you sit down to edit `notes.json`:

```bash
# 1. Pull main, see what's changed
git checkout main && git pull

# 2. Get the brief
python3 tools/draft_notes_brief.py

# 3. (Optional) Save as JSON for piping into other tooling
python3 tools/draft_notes_brief.py --json > /tmp/brief.json

# 4. Edit notes.json — see below for what to look at, by section

# 5. Validate
python3 -m pytest tests/test_notes_drift.py tests/test_notes_orphans.py -q
python3 tools/scan_notes_drift.py
python3 tools/scan_notes_orphans.py

# 6. Commit + push as usual
```

The brief is the one tool you should always run before editing. It gives you:

- Current record / standing / run differential
- Last-10 record and current streak
- Every hot, cold, and new player on the roster (the substance of player notes)
- Player notes whose ID no longer matches the roster (delete or whitelist)
- Injury notes for players no longer on the IL (delete)
- IL players without an injury note (consider adding)
- Per-section refresh-due flags

That's the prep. The actual prose authoring is on you.

---

## What to look at, by section

### `overview.headline` and `overview.paragraphs[]`

The most-edited section. Five paragraphs typically, each opening with a `<strong>...</strong>` topic sentence followed by 2–3 sentences of analysis.

Read the brief's "Team state" section. If the record / last-10 / streak shifted significantly since the last refresh, the overview likely needs a re-cast. The 5-paragraph structure can stay; the content within shifts.

### `team.strengths[]` / `team.softspots[]`

Two parallel arrays of 5 entries each, each one `<strong>topic:</strong> body`. The dashboard renders them side-by-side on the Team Stats tab.

Match the topic sentence to a current observable trend (top of the order, rotation strike-throwing, bullpen leverage, etc.). The body should reference a stat or pattern that's currently true.

### `team.ctx[group.stat]`

Keyed by `{group}.{stat}` (e.g., `hitting.runs`, `pitching.era`). Each entry is one sentence of analyst voice attached to that stat's row on the Team Stats tab.

Update when a rank shifts by more than one tier. Don't over-author — readers skim the stat row first; the context line is bonus.

### `players[id].recentNote` / `read` / `contextNotes[]`

- `recentNote` is the one-line callout that appears on the player card. It ages fastest — refresh when the player's `recent` tag changes (the brief shows current hot/cold).
- `read` is the modal paragraph. Identity-level — refresh when the player's role or shape changes meaningfully.
- `contextNotes[]` are per-stat-row annotations in the player modal. Refresh when the underlying stat moves a tier.

### `injuries[id].detail` / `eta`

Refresh reactively when status changes. The brief flags "IL players without injury notes" for opportunities, and the orphan scanner catches notes for players no longer on the IL.

### `pitches[name]`

11 keys (one per `PITCH_TYPES` entry in `index.html`). Refresh only when the team's relevant arms change — e.g., a starter known for a sweeper is traded in, or the rotation's primary cutter-thrower comes off the IL.

### `games[gamePk]`

Written at the time of the game; not refreshed. `gamePk` is permanent. Once a game is in the archive, its note is part of the archive.

---

## Validation infrastructure

Four layers guard the notes file. Each is documented elsewhere; pointers below.

| Layer | Tool | What it catches | Where |
|---|---|---|---|
| **Drift** | `tools/scan_notes_drift.py` | Capitalized name-tokens not in the current roster + IL | [`docs/free-text-fields.md`](free-text-fields.md) |
| **Orphan** | `tools/scan_notes_orphans.py` | Keyed entries (`players[id]` / `injuries[id]`) with no matching `data.json` ID | [`docs/free-text-fields.md`](free-text-fields.md) |
| **Freshness badge** | `data.json.notes_meta` → dashboard header | File-level age signal in the live UI; green/amber/red | [`docs/data-schema.md#notes_meta`](data-schema.md#notes_meta) |
| **Freshness scanner** | `tools/check_notes_freshness.py` | Sections older than their cadence threshold (workflow log + PR-time CI) | [`docs/runbook.md`](runbook.md) |

All three run in CI on every PR (the drift / orphan integration tests fail the build; the freshness badge is data-only). All three also run warn-only in the daily refresh workflow as a post-merge net.

---

## Suppression workflow

When a flagged finding is intentional, not a bug:

- **Drift false positive** (name-like token that isn't a player reference) → add to `.notes-scan-allow.json`'s `tokens` list. Per-fork.
- **Orphan deliberately retained** (a former player whose note you're keeping for historical interest) → add the integer ID to `.notes-scan-allow.json`'s `orphan_ids` list. Per-fork.
- **Field-level opt-out** (a paragraph that mentions a former player on purpose, e.g. a historical reference) → add `<!-- noscan -->` as a trailing HTML comment inside the field. Universal — applies to drift scanner only, since the orphan scanner is key-based.

See `docs/runbook.md` for diagnosis flows when a scanner flags a finding.

---

## What this guide is not

- A schema reference — see [`docs/data-schema.md#notesjson`](data-schema.md#notesjson) for field-level shape.
- A voice/style guide — the existing notes are the style guide. Match them.
- An LLM-drafting tool — the brief gives you facts; you write the prose. The opt-in `news_summarize` LLM layer (issue #53) is for news TL;DRs, not analyst voice.
- A staleness alerter — that's the dashboard badge + the workflow scanner. This guide is the response-side.

The maintenance loop is: badge prompts → brief informs → you write → scanners validate. Each piece is small. None is required to ship a refresh. Skip what doesn't help and run only what does.
