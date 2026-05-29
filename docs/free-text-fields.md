# Free-text fields registry

A map of every free-text-bearing field across the project. Use this when you're about to add a new free-text field, when a stale reference shows up on the dashboard, or when you're forking and want to know where your hand-edits will travel.

The motivating bug: PR #88 fixed three stale player-name references in `notes.json` (Bo Bichette in `team.strengths[0]`, Berríos in `team.strengths[1]`, Kirk's outdated injury detail in `injuries[672386]`). All three lived in free-text fields the existing assertions didn't cover. This doc makes the drift surface visible so the next one is easier to catch.

---

## How to read this doc

Each field gets a row in a table. The columns:

| Column | Meaning |
|---|---|
| **Path** | JSON path or HTML region. Anchor for grep and for tooling. |
| **Author** | Who or what writes the field: `human` / `MLB API` / `RSS` / `LLM` / `config` / `static`. |
| **Renders** | Tab + panel where the text appears on the dashboard. |
| **Drift** | Risk that the content goes stale relative to current state. See below. |
| **Names** | `Y` if the field can mention player names; `N` if structurally cannot. The drift scanner walks `Y` fields only. |
| **HTML** | `Y` if the field is rendered as HTML (so the scanner must strip tags before tokenizing). |
| **Cadence** | How often the field's content is regenerated. `static` / `per-author-commit` / `daily` / `per-RSS-refresh`. |

### Drift classes

- **HIGH** — Human-authored content about dynamic entities (current roster, current injuries, current standings). Any roster change can leave the content stale until the author rewrites it. *This is where the Bo / Berríos / Kirk bugs lived.*
- **LOW** — Human-authored content about stable entities (historical games, pitch type names). Doesn't drift in practice because the entities don't change.
- **NONE** — Machine-refreshed (regenerated every daily refresh from upstream) or static (rendered text that doesn't reference dynamic state). Cannot go stale by definition; other quality concerns may apply (LLM hallucination for `news[].tldr`, MLB API correctness for `injuries[].status`).

The drift scanner (see [Scanner](#scanner-pr-2--pr-3) below) only walks **HIGH** fields with `Names = Y`.

---

## `notes.json` — hand-authored analyst voice

Six top-level keys. Most fields are HIGH drift class because they're written about a specific moment and the entities (players, injuries, standings) change underneath the author.

### `games[gamePk].*`

| Path | Author | Renders | Drift | Names | HTML | Cadence |
|---|---|---|---|---|---|---|
| `games[gamePk].moment` | human | Overview → Recent Games card (replaces auto-summary) | LOW | Y | N | per-author-commit |
| `games[gamePk].meaning` | human | Overview → Recent Games (expanded card detail) | LOW | Y | N | per-author-commit |

`gamePk` is the historical MLB game identifier. Once a game has been played, its `gamePk` is permanent. Drift only happens if the author writes about a game that gets retroactively cancelled / disputed, which is rare. Player names are allowed in the text (e.g., "Bichette walked it off in the 11th"); if the player is later traded, the note still reflects the historical truth.

### `players[id].*`

| Path | Author | Renders | Drift | Names | HTML | Cadence |
|---|---|---|---|---|---|---|
| `players[id].recentNote` | human | Players → player card | HIGH | Y | Y | per-author-commit |
| `players[id].read` | human | Players → player modal (paragraph block) | HIGH | Y | Y | per-author-commit |
| `players[id].contextNotes[stat]` | human | Players → player modal (per-stat row) | HIGH | Y | N | per-author-commit |

Keyed by `person_id`. Each `id` is at risk of orphaning (player leaves the roster) — the keyed-orphan check covers that. The text inside is at risk of mentioning *other* players (teammates, opponents) who themselves change.

### `overview.*`

| Path | Author | Renders | Drift | Names | HTML | Cadence |
|---|---|---|---|---|---|---|
| `overview.headline` | human | Overview → State of the Season header | HIGH | Y | N | per-author-commit |
| `overview.paragraphs[]` | human | Overview → State of the Season body | HIGH | Y | Y | per-author-commit |

Multi-paragraph season narrative. Names appear frequently ("Vlad's surface line", "Gausman has been the unsung anchor"). Highest-volume HIGH-drift surface in the corpus.

### `team.*`

| Path | Author | Renders | Drift | Names | HTML | Cadence |
|---|---|---|---|---|---|---|
| `team.ctx[group.stat]` | human | Team Stats → stat row footer | HIGH | Y | N | per-author-commit |
| `team.strengths[]` | human | Team Stats → Strengths column | HIGH | Y | Y | per-author-commit |
| `team.softspots[]` | human | Team Stats → Soft Spots column | HIGH | Y | Y | per-author-commit |

`team.strengths[]` and `team.softspots[]` are where the Bo / Berríos bugs lived. Bullet points mention players by surname or short-name routinely.

### `pitches[name]`

| Path | Author | Renders | Drift | Names | HTML | Cadence |
|---|---|---|---|---|---|---|
| `pitches[name]` | human | Stat School → Pitch Types → "Team note" row | LOW | Y | N | per-author-commit |

Keyed by pitch type name (`"Splitter"`, `"Curveball"`, etc.). Pitch types don't change. The text inside may mention players ("Gausman's calling card") — those mentions can go stale if the pitcher leaves, but the cadence of pitcher turnover is low enough that LOW is the right class.

### `injuries[id].*`

| Path | Author | Renders | Drift | Names | HTML | Cadence |
|---|---|---|---|---|---|---|
| `injuries[id].detail` | human | Header → Injury list (replaces API status) | HIGH | Y | N | per-author-commit |
| `injuries[id].eta` | human | Header → Injury list (return timeline) | HIGH | Y | N | per-author-commit |

Keyed by `person_id`. The Kirk bug (PR #88) was here — the `id` was correct, but the `detail` text described a previous injury, not the current one. Drift happens when an injury *changes type* (e.g., moves from oblique to thumb) without the author updating the text.

---

## `data.json` — machine-written, refreshed daily

Most fields are structured (numbers, IDs, enums). The free-text fields below all originate upstream (MLB Stats API or RSS feeds) and are regenerated on every refresh — cannot go stale, but listed here for completeness so the scanner doesn't accidentally walk them.

| Path | Author | Renders | Drift | Names | HTML | Cadence |
|---|---|---|---|---|---|---|
| `news[].title` | RSS | Overview → Voices around | NONE | Y | N (entities possible) | daily |
| `news[].summary` | RSS | Overview → Voices around (some renders) | NONE | Y | Entities possible | daily |
| `news[].source` | config | Overview → Voices around (byline label) | NONE | N | N | per-author-commit (config) |
| `news[].author` | RSS | Overview → Voices around (byline) | NONE | Y | N | daily |
| `news[].url` | RSS | Overview → Voices around (link) | NONE | N | N | daily |
| `news[].published` | RSS | Overview → Voices around (timestamp) | NONE | N | N | daily |
| `news[].tldr` | LLM | Overview → Voices around (italic "TL;DR (AI)" line) | NONE (but hallucination-prone) | Y | N | daily, cached per-URL |
| `injuries[].status` | MLB API | Header → Injury list (default label) | NONE | N | N | daily |
| `injuries[].description` | MLB API | Header → Injury list (raw API text) | NONE | N | N | daily |
| `injuries[].name` | MLB API | Header → Injury list | NONE | Y | N | daily |
| `transactions[].description` | MLB API | (not currently rendered) | NONE | Y | N | daily |
| `roster.hitters[].name` | MLB API | Players tab card title | NONE | Y | N | daily |
| `roster.pitchers[].name` | MLB API | Players tab card title | NONE | Y | N | daily |
| `recent_games[].opponent` | MLB API | Overview → Recent Games | NONE | N | N | daily |
| `upcoming_games[].opponent` | MLB API | Overview → Upcoming Games | NONE | N | N | daily |
| `upcoming_games[].probable_pitcher` | MLB API | Overview → Upcoming Games | NONE | Y | N | daily |

The `roster.*[].name` and `injuries[].name` rows are the **name dictionary** the scanner builds at runtime to validate `notes.json` mentions. Treat them as the source of truth for "currently on the team."

For field-level details on `data.json`, see [`data-schema.md`](data-schema.md).

---

## `config.json` — operator config

Set once per fork. Doesn't drift relative to MLB state.

| Path | Author | Renders | Drift | Names | HTML | Cadence |
|---|---|---|---|---|---|---|
| `dashboard_title` | config | Header → page title | NONE | N | N | per-config-edit |
| `team_name` | config | Header → team name | NONE | Y (team) | N | per-config-edit |
| `rss_feeds[].source` | config | Overview → Voices around (byline label) | NONE | N | N | per-config-edit |
| `rss_feeds[].keyword_filter` | config | (filter, not rendered) | NONE | Y (team) | N | per-config-edit |

`team_name` may contain a team-name token ("Blue Jays") that overlaps with player surnames. The scanner whitelists team-name tokens by default.

---

## `index.html` — static reference content

Hard-coded inside the renderer. Doesn't drift with roster or standings. Only drifts if MLB itself adds or removes a stat or pitch type.

| Path / Region | Author | Renders | Drift | Names | HTML | Cadence |
|---|---|---|---|---|---|---|
| `STAT_DEFS[stat]` (line ~270) | static | Stat School → Stats Reference cards | NONE | N | N | static |
| `PITCH_TYPES[]` array (line ~382) | static | Stat School → Pitch Types cards | NONE | N | N | static |
| "Positions & Scoring" HTML block | static | Stat School → Positions tab | NONE | N | N | static |
| "How to Watch" HTML block | static | Stat School → How to Watch tab | NONE | N | N | static |

If MLB introduces a new pitch type (e.g., the "sweeper" classification rolled out in 2023), `PITCH_TYPES[]` needs an entry. That's the only realistic drift on this surface.

---

## Scanner (PR 2 + PR 3)

The drift scanner (`tools/scan_notes_drift.py`, shipping in PR 2 of the drift-registry sequence) walks the rows in this registry where `Drift = HIGH` and `Names = Y`:

- `players[id].recentNote`
- `players[id].read`
- `players[id].contextNotes[stat]`
- `overview.headline`
- `overview.paragraphs[]`
- `team.ctx[group.stat]`
- `team.strengths[]`
- `team.softspots[]`
- `injuries[id].detail`
- `injuries[id].eta`

For each scanned field, the scanner builds a name dictionary from the current `data.json.roster.{hitters,pitchers}[].name + injuries[].name`, then tokenizes the field's text (stripping HTML first if `HTML = Y`) and flags capitalized-word tokens that look like player names but aren't in the dictionary.

### Tuning controls

- **Whitelist** at `.notes-scan-allow.json` — tokens that match the heuristic but aren't player references ("Spring", "May", "Walker" the verb, manager surnames). In-repo, forker-customizable.
- **Stopword list** inline in the scanner — months, days, ~20 common nouns. Universal.
- **Opt-out marker** — trailing `<!-- noscan -->` HTML comment in the field signals "this mentions a former player on purpose; skip me." Useful for intentional historical references.
- **Config flag** `config.json.scan_notes_drift` (default `true`). Forkers who don't want the scanner can set `false`.

### How findings surface

- **In CI** (PR 2): `tests/test_notes_drift.py` fails with structured output pointing to the field path + offending token + 60-char snippet.
- **In daily refresh** (PR 3): the workflow log emits `WARN notes_drift: ...` lines. Doesn't fail the build (`--warn-only` mode).
- **Optional reader-side**: surface findings as `data.json.notes_drift[]` for a maintainer-only banner. Deferred unless wanted.

---

## Maintenance

When a new free-text field lands anywhere in `notes.json` / `data.json` / `config.json` / `index.html`:

1. **Add a row to the right section above.** Pick the drift class honestly; default to HIGH if the field can mention dynamic entities.
2. **If the new field is `Drift = HIGH` and `Names = Y`**, add its path to `tools/notes_drift_paths.json` (the scanner's input). Otherwise the scanner won't walk it.
3. **If the new field is in `notes.json`**, add a row to the `notes.json` schema section in [`data-schema.md`](data-schema.md#notesjson) too — keep the two docs in sync.
4. **Test the scanner** against the new field with an intentional bad mention to confirm coverage.

When a field is removed:

1. Remove its row here.
2. Remove its path from `tools/notes_drift_paths.json`.
3. Update [`data-schema.md`](data-schema.md) if it was a `notes.json` field.

---

## Related docs

- [`data-schema.md`](data-schema.md) — full field-level reference for `data.json` (and `notes.json` schema section).
- [`runbook.md`](runbook.md) — how to act on drift findings (how to whitelist, how to suppress, how to fix).
- [`forking.md`](forking.md) — `scan_notes_drift` config flag for forkers.
