# v2 forkability audit — issue #122 (2026-06-06)

Audit-only validation of the v2 build's forkability claim: **edit `config.json` only → working tracker for any MLB team.**

**Target fork:** Seattle Mariners (`team_id` 136, AL West). AL East assumptions in code break here; navy + northwest-green + silver palette tests the cream-substrate color discipline; AL West gives interleague-heavy schedule reliability.

**Mechanics**

- Branch: `claude/fork-test-mariners` (do **not** merge).
- Config swap: `config.json` rewritten to Mariners identity (`team_id`/`team_abbrev`/`team_name`/`league_id`/`division_id`/colors/`dashboard_title`/`brand_mark`/`rss_feeds`). `notes.json` reduced to minimal scaffold so analyst-voice gaps surface visibly.
- Workflow run (`daily-refresh.yml`, run #41) completed in ~25s on the branch; `data.json` populated with live Mariners data (33–30 record, 1st AL West, real roster including Bryan Woo / Bryce Miller / J.P. Crawford / Julio Rodríguez / Cal Raleigh-or-equivalent / Randy Arozarena).
- Static + dynamic walk: every renderer + every tab + IL chip + tooltip wiring, all in light and dark. Screenshots at `/tmp/fork-{tab}-{mode}.png`.

**Headline:** the fork **works end-to-end** — there is no schema-drift banner, no blank tab, no broken modal — but four user-visible defects show that the v2 forkability gate is **not** yet honest.

---

## Top findings (by severity)

| # | Finding | Severity | Surface |
|---|---|---|---|
| F1 | Overview standings panel header reads literal `"AL East"` regardless of fork's division — hardcoded in `assets/overview.js:498`. Mariners fork displays "AL East" above five AL West teams. | **blocker** | Overview |
| F2 | Browser tab `<title>` reads `"Blue Jays 2026 Tracker — v2 (in development)"` until the renderer overwrites it (`assets/render.js:83` writes `cfg.dashboard_title + " — v2 (in development)"`). First-paint title is wrong-team; final title carries the dev-mode suffix that's not appropriate for a forked production deploy. | **blocker** | Header / SEO |
| F3 | Overview Wild Card panel header reads literal `"AL Wild Card"` (`assets/overview.js:565`) — wrong for any NL fork (Mets, Dodgers, etc.). Mariners audit happens to be AL so the string is incidentally correct, but the gap is real. | **blocker** | Overview |
| F4 | `config.brand_mark` field is documented in `docs/forking.md` (table line 67) and the schema lives in `tests/conftest.py:38`, but **the v2 renderer never reads it**. The brand-mark glyph in `index-v2.html` (lines 80–95) is a hardcoded white diamond on `--team-primary` regardless of config. v1 (`index.html:557`) does consume `brand_mark`. So a Mariners fork that sets `"brand_mark": "M"` sees no effect. | **blocker** | Header / config |
| F5 | `index-v2.html:570` colophon reads literal `"the live v1 dashboard is unchanged at index.html"`. Forks that don't ship a v1 (or that have promoted v2 to be the live build) see a stale self-reference. | important | Footer |
| F6 | `index-v2.html:6` `<title>` element hardcodes "Blue Jays 2026 Tracker — v2 (in development)" (the same string in F2). First-paint flash on slow networks shows the wrong team in the browser-tab title until JS rewrites it. | important | Header / SEO |
| F7 | `config.accent_color` is plumbed into `--team-accent` (`assets/theme.js:92`) but the token's own comment in `tokens.css:22` says "identity only, NOT signal" — no surface actually consumes the token. `docs/forking.md:67` documents the field as "Hex color for chart highlights, hot pills" — that's **stale**: charts use `--pos`/`--neg`, pills use `--q-hot`/`--q-warm`/`--q-cold` (all team-independent). Mariners-silver `#C4CED4` is a real WCAG hazard (1.57:1 on cream, fails AA + 3:1 non-text) but nothing renders it, so no visual harm — yet the field misleads forkers. | important | Config schema / docs |
| F8 | `index-v2.html:518` freshness subtext hardcodes `"Daily · 09:00 UTC"`. Forks that re-cron the workflow (e.g. to align to a Pacific morning) show stale schedule text. Low-severity cosmetic. | nit | Header |
| F9 | `assets/theme.js:71` comment "// The Blue Jays reference values; used as ultimate fallback if config doesn't supply primary/secondary/accent." — code comment, not user-visible, but signals the original assumption. The `REF_ACCENT = '#E8291C'` constant is the Jays' red. Same pattern: not consumed by any visible surface, but reads as Jays-specific code. | nit | Code voice |
| F10 | README.md line 1 reads "Blue Jays 2026 Tracker"; lines 174–176 cite Toronto-specific RSS feeds as example config. Already covered by forking.md, but the fork's own README still says "Blue Jays" until manually edited. **Forking guide doesn't tell forkers to update README** — would be the first thing every visitor sees on the GitHub repo page. | important | Docs |

---

## Pass / warn / fail by surface

### Header

| Element | Pass/Fail | Note |
|---|---|---|
| `#brand-title` | **PASS** | `cfg.dashboard_title` correctly drives — "Mariners 2026 Tracker" displays. |
| `#brand-sub` | partial | `render.js:85` writes `"Day N"`. Works. |
| Brand mark glyph | **FAIL F4** | Static white diamond — `brand_mark` config field has no effect in v2. |
| Brand box background | PASS | `--team-primary` correctly applied; Mariners navy renders, contrasts the diamond at 13.68:1. |
| `<title>` (browser tab) | **FAIL F2/F6** | Hardcoded `"Blue Jays 2026 Tracker"` until JS rewrite; rewrite then appends `" — v2 (in development)"` to fork title. |
| Header record (`33–30 .524 · 1st in AL West`) | PASS | All from `data.team` — division name comes through fetcher's `team.place` field. |
| IL chip | PASS | Count populates (6 Mariners IL), popover opens, list correct. |
| Freshness badge | PASS | Color/age logic theme-independent. |
| Freshness detail | **FAIL F8** | "Daily · 09:00 UTC" hardcoded. |
| Notes-stale chip | PASS | Date math, theme-independent. |
| Source key (◆ ✎ ↗) | PASS | Static glyphs, theme-aware tokens. |
| Theme toggle | PASS | Idempotent, accessible. |
| Tabs (4-tab IA) | PASS | `--team-secondary` underline color works on Mariners green (`#005C5C` at 7.69:1 on light). |

### Overview tab

| Element | Pass/Fail | Note |
|---|---|---|
| KPIs (Record / Run diff / Pythag / Last 10) | PASS | All derive from `data.team`. |
| Run-differential SVG chart | PASS | Theme-aware fills (`--pos`/`--neg`). Mariners +30 cumulative reads green; one bad-game annotation present. |
| State of the season (analyst panel) | partial | Renders from `notes.overview` correctly. With the audit-scaffold notes it displays "Audit fork" placeholder — works. Real forks would author this. |
| Recent games (3 cards) | PASS | Opp abbrev / score / W-L pip all generic. |
| Upcoming games (3 cards) | PASS | Opp context line ("28-36, 4th AL West" for HOU shown) derives from `data.upcoming_games[].opp_context`. |
| Opposing-pitcher modal button | PASS | Resolves via `opponent_pitchers` block; renderer doesn't assume specific IDs. |
| **Standings panel header** | **FAIL F1** | Hardcoded "AL East". Mariners fork displays five AL West teams under an "AL East" heading. **Blocker.** |
| Standings rows | PASS | `is_us` flag correctly marks the Mariners row in navy; bars render correctly. |
| **Wild Card panel header** | **FAIL F3** | Hardcoded "AL Wild Card". Wrong for any NL fork. Mariners-incidentally correct. |
| Wild Card rows | PASS | Same data shape works generically; "Division leaders" sub-row aggregates correctly. |
| Voices around (RSS) | PASS | Mariners Google News + MLB.com keyword feed both pulled items. |

### Players tab

| Element | Pass/Fail | Note |
|---|---|---|
| Role grouping (Rotation / Bullpen / Catchers / Infield / Outfield / DH) | PASS | Generic position-based logic. |
| Player cards | PASS | Real Mariners pitchers, hitters all show. Hot/Cold pills work (Andrés Muñoz hot, Victor Robles hot, Luke Raley cold, Randy Arozarena cold). |
| Avatar tint | PASS | `--team-primary-soft` (color-mix derived) — Mariners navy renders as subtle navy-cream on light, navy-charcoal on dark. |
| Stat lines (OPS / ERA / Statcast) | PASS | xwOBA / Barrel% / Hard-hit% populate on hitters (verified .328 / 5.8% / 37.0% on first hitter). |
| Pcard modal | not exercised | Tooltip & team-registry verified; modal logic data-shape-agnostic. |

### Team Stats tab

| Element | Pass/Fail | Note |
|---|---|---|
| Strengths panel | PASS | Top-3 ranked stats — BB/9 1st, WHIP 4th, ERA 5th — derived from `data.team_stats`. |
| Soft spots panel | PASS | AVG 23rd, Runs 16th, OBP 14th. |
| Hitting/Pitching toggle | PASS | Segmented control colored navy via `--team-primary`, contrasts AAA on cream. |
| Hitting ledger | PASS | All slugs render; missing Statcast (xwOBA/Barrel%/Hard-hit%) at team level — same gap exists for Jays fork (Savant doesn't always have team aggregates); not a forkability concern. |
| Pitching ledger | PASS | Generic. |
| Analyst notes (`notes.team.strengths`/`softspots`) | partial | Empty arrays in audit-scaffold → notes don't render. Works correctly with content. |

### Stat School tab

| Element | Pass/Fail | Note |
|---|---|---|
| Sidebar index | PASS | Loaded from `stat_school.json` (team-independent reference). |
| Keystone card | PASS | Static reference copy. |
| Per-stat cards | PASS | Team values + ranks render in each pill (e.g. WHIP 1.19 4th, ERA 3.50 5th, Run diff +30, Pythag 35-28). |
| Pitch types grid | PASS | Renders without team-specific pitch notes (`notes.pitches` empty in audit scaffold). |
| Honesty / Beyond card | PASS | Static. |

### Colors / WCAG

| Surface | Ratio | Status |
|---|---|---|
| `#0C2C56` navy on `#fffdf8` light card | 13.68:1 | AAA |
| `#005C5C` green on `#fffdf8` light card | 7.69:1 | AAA |
| `#C4CED4` silver on `#fffdf8` light card | 1.57:1 | **FAIL** (but no surface consumes `--team-accent` — F7) |
| `#0C2C56` navy on `#1b1f27` dark card | 1.19:1 raw | FAIL raw — but `--team-primary-ink` color-mix lifts to ~5–6:1 (theme.js comment line 180 explicitly handles dark forks via mix-with-white) |
| Dark mode tab active glyph color (`#dbe4f1`) | n/a | Static; theme-independent. |
| Run-diff chart axes | PASS | `[data-theme="dark"] svg.rd-chart text` override (`tokens.css:212`). |

No WCAG regression introduced by Mariners palette on surfaces that actually consume the tokens.

### Tooltips / team registry

| Element | Pass/Fail | Note |
|---|---|---|
| `JaysTeamRegistry.get('SEA')` | PASS | Returns `{name: "Seattle Mariners", league: "AL", division: "AL West"}` correctly. |
| Opponent abbreviation tooltip | PASS | All 30 teams hardcoded — works generically. |
| `abbreviate('Seattle Mariners')` | PASS | KNOWN map returns "SEA" (`assets/overview.js:66`). |

---

## Per-finding detail

### F1 — Standings panel header hardcoded "AL East" [blocker]

**Location:** `assets/overview.js:498`

```js
return panel('machine', 'AL East', null,
  div.map(function (t) { ... }),
  { hint: 'win %' }
);
```

**Repro:** Open Overview tab with any non-AL-East fork — the standings panel renders correct teams (`data.division` is fork-aware via fetcher) but the panel header is the literal string `"AL East"`. Mariners audit screenshot: five AL West teams listed under "AL East" header.

**Suggested fix:** Derive the division name from either (a) a new `data.team.division_name` field the fetcher already computes (`fetch_data.py:2206`, `div_name = (division_names.get(cfg["division_id"]) or ...)` — the same lookup that drives `team.place`), or (b) `data.division[0].division_name` since `fetch_all_standings` already populates this on each row (`fetch_data.py:479`). Pass it into the panel header at render time.

Note `team.place` already renders correctly ("1st in AL West") because the fetcher computes the name string. The panel header is the only surface that bypasses this.

### F2 / F6 — Browser-tab `<title>` flashes wrong team [blocker]

**Locations:** `index-v2.html:6`, `assets/render.js:83`

```html
<title>Blue Jays 2026 Tracker — v2 (in development)</title>
```

```js
const title = cfg.dashboard_title || 'Tracker';
document.title = title + ' — v2 (in development)';
```

**Repro:** Hard refresh on slow network. First paint shows "Blue Jays 2026 Tracker — v2 (in development)" in the browser-tab title until `render.js` overwrites it. Even after, the title carries the "— v2 (in development)" suffix — appropriate for the upstream repo during the v2 build, not for a Mariners-fork production deploy.

**Suggested fix:**
1. Replace the literal in `index-v2.html` with a generic placeholder (`<title>Tracker</title>` or `<title>Loading…</title>`).
2. Strip the `" — v2 (in development)"` suffix when the v2 cutover lands (per `index-v2.html:489` comment, v2 cutover will rename the file). For now, gate the suffix behind a config flag (`config.dev_mode: true`).

### F3 — Wild Card panel header hardcoded "AL Wild Card" [blocker]

**Location:** `assets/overview.js:565`

```js
return panel('machine', 'AL Wild Card', null, body, { hint: '3 spots' });
```

**Repro:** Any NL fork — the panel header reads "AL Wild Card" above NL wild-card race teams. Mariners audit doesn't surface this bug because it's AL, but the code is wrong.

**Suggested fix:** Derive the league prefix from `cfg.league_id` (`103` → "AL", `104` → "NL") and pass into the panel header. Trivial: `(cfg.league_id === 104 ? 'NL' : 'AL') + ' Wild Card'`.

### F4 — `config.brand_mark` field has no effect in v2 [blocker]

**Locations:** `index-v2.html:80–95` (CSS), `assets/render.js` (never reads `cfg.brand_mark`)

**Repro:** Set `"brand_mark": "M"` in `config.json` — the header brand box continues to render a static white diamond on `--team-primary`. Compare v1 (`index.html:557` correctly does `document.getElementById('brandMark').textContent = cfg.brand_mark || '·';`).

**Suggested fix:** Either (a) wire `cfg.brand_mark` to a text node inside `.brand .mark` (replacing the diamond glyph), (b) document the field as deprecated in v2 and update `docs/forking.md` + `tests/conftest.py` accordingly, or (c) extend the brand mark to support either a glyph OR a single character via config. The diamond is design-intentional (white-neutral, dark-mode-safe per PR-F decision D4 / `index-v2.html:91`), so option (b) may be the right product call.

### F5 — Colophon self-references v1 [important]

**Location:** `index-v2.html:570`

```html
<span>v2 build in progress · the live v1 dashboard is unchanged at index.html</span>
```

**Suggested fix:** Strip this entire span when v2 promotes to production; or wrap in a config-gated dev banner. A fork that's already cut over has no v1 to reference.

### F7 — `accent_color` field is documented but unused [important]

**Locations:** `assets/theme.js:92` (sets `--team-accent`), `tokens.css:22` ("identity only, NOT signal"), `docs/forking.md:67` (documents the field with stale description)

**Repro:** Set any `accent_color` value — nothing on screen changes. Mariners silver `#C4CED4` would be a real WCAG hazard *if* it were rendered (1.57:1 on cream), but no surface consumes the token.

**Suggested fix:** Update `docs/forking.md:67` to reflect the actual usage (i.e. "currently unused — reserved for future accent surfaces"), or remove the field from the documented schema if there are no concrete plans. Forkers currently spend brand-research time picking a value that does nothing.

### F8 — Hardcoded "Daily · 09:00 UTC" subtext [nit]

**Location:** `index-v2.html:518`

Forks that change the cron see stale schedule text. Low-priority cosmetic.

**Suggested fix:** Either derive from a `config.refresh_schedule` string field, or accept the cosmetic gap and document the workaround.

### F9 — `theme.js` comment references "The Blue Jays reference values" [nit]

**Location:** `assets/theme.js:71`

Code voice, not user-visible. Worth a comment rewrite ("Reference fallback palette — used if config omits primary/secondary/accent") to read team-agnostic.

### F10 — Forking guide doesn't mention README update [important]

**Location:** `docs/forking.md`

The forking guide is thorough on `config.json` but never tells forkers to update their own `README.md` (which is the public-facing entry point on GitHub). A Mariners fork at `https://github.com/<user>/MarinersTrackerDashboard` would show "Blue Jays 2026 Tracker" + Bluebird Banter feed examples + Toronto Google News URL until manually fixed.

**Suggested fix:** Add a Step 2.5 to `docs/forking.md` covering README + repo-name updates, or extract a "team-bound surfaces outside config.json" checklist.

---

## Blocker gaps (must fix before forking is real)

1. **F1** — Overview standings panel header.
2. **F2/F6** — Browser-tab title.
3. **F3** — Overview Wild Card panel header.
4. **F4** — `brand_mark` field — either wire it up or remove from documented schema.

These are the four that produce visible wrong-team output on a freshly-forked v2 build.

## Soft gaps (forking guide should document)

1. **F5** — Colophon v1 self-reference (cosmetic; only matters once v2 is the live build).
2. **F7** — `accent_color` documentation drift.
3. **F8** — Hardcoded refresh time.
4. **F9** — Code comment voice.
5. **F10** — README + repo-name updates.

These are surfaces a sharp forker will work around, but they bleed credibility from the "config.json is the only file you edit" promise.

---

## What worked (no defect)

- `team_id` / `league_id` / `division_id` all plumbed correctly end-to-end.
- All 30-team static lookups (`team-registry.js`, `overview.js:abbreviate`) include SEA; would include any team for any fork.
- `data.team.place` correctly carries division name ("1st in AL West").
- Theme tokens correctly derive from primary/secondary; color-mix in `tokens.css` lifts both light and dark variants AA where the tokens actually render.
- Workflow `daily-refresh.yml` runs cleanly on a feature branch (run #41, 25s).
- `data.json` schema matches the renderer's `EXPECTED_KEYS` — no drift banner.
- Tooltip on opponent abbreviation chips correctly resolves to "AL West" for SEA / "AL East" for opponent TOR, etc.
- Stat School deep-links / per-stat cards / pitch-type grid all work data-shape-agnostically.

---

## Reproducing this audit

Branch: `claude/fork-test-mariners` ([compare against main](https://github.com/Seb-the-Canadian/JaysTrackerDashboard/compare/main...claude/fork-test-mariners)).

```sh
git fetch origin claude/fork-test-mariners
git checkout claude/fork-test-mariners
python3 -m http.server 8765
# Open http://127.0.0.1:8765/index-v2.html in a browser
```

Screenshots used in this audit:

- `/tmp/fork-overview-{light,dark}.png`
- `/tmp/fork-players-{light,dark}.png`
- `/tmp/fork-team-stats-{light,dark}.png`
- `/tmp/fork-stat-school-{light,dark}.png`

Each captured at 1280×1100 viewport via Playwright Chromium.
