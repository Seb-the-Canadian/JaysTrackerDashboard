# Security model

How the dashboard treats data sources, and what protections exist at each layer.

The Jays Tracker has three input layers, each with a different trust posture. Knowing which layer a string came from determines how the renderer can safely handle it.

## Three layers, three trust postures

### `data.json` — machine-fetched, **structurally trusted**

Written by `fetch_data.py` from MLB Stats API + Baseball Savant + RSS sources. Schema validated by `assert_invariants` before atomic write. Top-level keys checked at render time by `EXPECTED_KEYS` + `#schemaBanner`.

Trust posture:
- **Numeric / categorical fields** (`team.record.w`, `roster.hitters[].pos`, `team_stats.hitting.ops.rank`): trusted. The renderer reads them as data, not markup.
- **String labels** that flow into `innerHTML` (player names, team abbreviations): escaped via `JaysFormat.escapeHtml` before interpolation. MLB rarely returns active markup in these fields, but `&` characters appear in real names (`O'Hoppe`, `D'Backs`), so escaping is hygienic regardless.
- **External-trust strings inside `data.json`** — specifically `news[].url`, `news[].title`, `news[].author`, `news[].source`, `news[].summary` — flow from RSS feed parsers. **These are treated as external/untrusted** even though they arrive packaged inside our otherwise-trusted `data.json`.

### `notes.json` + `stat_school.json` — maintainer-authored, **markup permitted**

Hand-written by the project maintainer (or a fork's maintainer) and committed to git. Free-text fields may contain HTML for emphasis: `<b>`, `<em>`, `<strong>`, `<i>`, `<br>`. The renderer interpolates these fields via `innerHTML` without sanitization.

Trust posture:
- **Git is the trust boundary.** Anything in `notes.json` or `stat_school.json` has been reviewed by the person committing it — typically the maintainer themselves.
- The implication: a PR that modifies these files needs the same scrutiny as a PR that modifies application code. A `<script>` tag in a `notes.players[id].read` field would execute on the live dashboard.
- **For forkers:** the same posture applies. A pull request from an outside contributor to `notes.json` is application code in disguise. Reject it the way you'd reject a PR that adds `eval()` to a JS file.
- The `tools/scan_notes_drift.py` + `scan_notes_orphans.py` + `check_notes_freshness.py` scanners check content drift / orphan keys / staleness — **they do not check for active markup**. That responsibility lives at git review.

### `news[].*` — RSS feeds, **fully untrusted**

Fetched via `feedparser` from URLs configured in `config.json.rss_feeds`. Sources rotate, get hijacked, get rewritten by intermediate caches. Every field on a `news[]` item is potentially attacker-controlled.

Trust posture and protections:

| Field | Where it renders | Protection |
|---|---|---|
| `url` | anchor `href` | `JaysFormat.safeHref(url)` — protocol allowlist (`http:`, `https:`, `mailto:`). Anything else collapses to `'#'` and the item is dropped. |
| `title` | `<h4>` text node | Inserted via `textContent`, not `innerHTML`. |
| `author`, `source` | `<span>` text nodes | Same — `textContent`. |
| `summary` | not currently rendered | — |
| `published` | text + relative-time chip | Parsed by `JaysFormat.relativeAge`; out-of-domain returns `''`. |

The boundary helper is **`JaysFormat.safeHref(url)`**. Use it everywhere external URLs land in `href`. Repo PR #105 + PR-D (COG-360) added it explicitly because an earlier audit confirmed a feed item with `url: "javascript:alert(1)"` rendered as a clickable JS-protocol anchor.

## What's NOT in scope today

- **No DOMPurify / HTML sanitizer.** The maintainer-trust posture above means we accept that `notes.json` / `stat_school.json` may contain arbitrary HTML — that's by design. Adding DOMPurify would block the design intent (analyst can emphasize with `<b>`) without adding meaningful safety (git is already the trust boundary).
- **No CSP headers.** GitHub Pages serves static files; adding `Content-Security-Policy` via meta tag is a v2.0.1 candidate worth doing, but it's not a substitute for the layer-trust model.
- **No supply-chain pinning beyond `requirements.txt`.** The fetcher dependencies (`MLB-StatsAPI`, `feedparser`, `requests`) are pinned in `requirements.txt`; the JS layer has no runtime dependencies.

## For contributors

If you're sending a PR:

- Fields rendered via `innerHTML` need an `escapeHtml`-wrapped interpolation for any portion derived from `data.json` numeric/string data. The four per-tab renderers (`overview.js`, `players.js`, `team-stats.js`, `stat-school.js`) all import `JaysFormat.escapeHtml` (since PR-D).
- URLs in `href` need `JaysFormat.safeHref`. Even URLs from "trusted" sources (`config.json.team_link` for example) — defense in depth.
- If you're adding a new top-level key to `data.json` that includes free text from external sources, document the trust posture here.

## Reporting security issues

Open a GitHub issue, or email the maintainer directly if the issue involves an unfixed vulnerability. Don't post payloads in public issues until a fix is committed.
