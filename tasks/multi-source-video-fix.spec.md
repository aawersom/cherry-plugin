# Spec — Multi-Source Video Playback Fix

**Task ID:** `multi-source-video-fix`
**Target file:** `D:\Works\Lampa\plugin.js` (single-file plugin, ~3700 lines)
**Mode:** spec-plan-code-loop FULL
**Arch reference:** `D:\Works\Lampa\docs\CHERRY.md`

---

## 1. Overview

Cherry is a Lampa TV plugin that aggregates 26 adult video sources. Each source is a self-contained adapter that returns `StreamResult = { url: string, quality: Object.<string,string> }` from its `getStream()` method. The Lampa player consumes `url` as the playback URL and `quality` as the user-selectable quality menu; `bestQualityUrl(quality)` picks the highest `parseInt(key)` and is frozen.

Real-Lampa-player smoke testing revealed that **8 sources do not play** (getStream returns empty or a non-stream URL), **3 sources play but only at the lowest available quality** (quality map collapsed to one entry or built wrong), and **1 source must be removed**. Two additional sources (`hqporner`, `pornone`) have known infrastructure constraints (CDN blocks CF datacenter IPs / IP-locked tokens) that require routing or pre-warming workarounds rather than parser fixes.

This spec covers fixes to adapter-internal `getStream` logic, one carefully-scoped extension to the shared `extractStreams` helper (multi-quality JWPlayer sources array), and an upgrade to the E2E suite so that "passing" means the stream URL is actually playable (HTTP 200 + video/* or application/vnd.apple.mpegurl content-type), not merely "non-empty string returned".

### What this spec covers
- Removal of one dead adapter (`gayporntube`)
- Quality-map fixes for 3 adapters (`porndig`, `ebun`, `lenporno`)
- `getStream` parser updates for 6 adapters (`eporner`, `tizam`, `perfektdamen`, `huyamba`, `24rolika`, `pornhub`)
- Infrastructure workarounds for 2 adapters (`hqporner`, `pornone`)
- One narrow extension to `extractStreams` — JWPlayer `sources: [...]` array branch only
- E2E hardening: stream URL must be HTTP-reachable and serve a media content-type

### What this spec does NOT cover
- `spankbang` (CF JS challenge — accepted structural limitation, listed in lessons)
- Card listing / browse / search parsers for any of the affected sources (cards already work for everything except spankbang)
- Changes to frozen shared helpers: `cherryFetch`, `buildProxyUrl`, `proxyM3u8`, `bestQualityUrl`, `playVideo` — EXCEPT one explicit carve-out: the inner `px()` helper nested inside `playVideo()` gains a single guard-clause line so it skips re-wrapping URLs already prefixed by `PROXY_URL_2` (Deno Deploy). See REQ-7-PRE for the exact one-line change and its rationale. All other logic in `playVideo()` remains frozen.
- Changes to the `StreamResult` contract — `{ url, quality }` shape must remain stable
- New proxy infrastructure (both CF Worker and Deno Deploy are deployed and used as-is)
- Performance / latency optimization
- Internationalization / UI strings

---

## 2. Requirements

Each REQ states **CURRENT** (what code does today), **PROBLEM** (observed failure mode in the real Lampa player), and **FIX** (what we will change).

---

### REQ-1 — Remove `gayporntube` adapter

**CURRENT.** `SOURCES.push({ id: 'gayporntube', ... })` registered at `plugin.js:3634`. Card parser `_gayporntubeCards` at ~`plugin.js:3666`. Listed in E2E tier B at `test/cherry-lampa-e2e.mjs:36`.

**PROBLEM.** Out of scope for the aggregator's intended catalog. User requested removal.

**FIX.**
- Delete the entire `SOURCES.push({ id: 'gayporntube', ... })` block in `plugin.js`.
- Delete the supporting helpers (`_gayporntubeCards`, `_gayporntubePages` if present) that become orphaned.
- Remove `'gayporntube'` from the tier-B array in `test/cherry-lampa-e2e.mjs`.
- Remove the `gayporntube` entry from `tasks/cherry-e2e-baseline.json`.

**Acceptance.**
- `Grep -n gayporntube plugin.js` returns zero matches.
- `Grep -n gayporntube test/` returns zero matches.
- Total source count drops from 26 to 25 (verify by counting `SOURCES.push` occurrences).
- E2E run completes without "unknown source" warnings.
- `SOURCES[0].id` is unchanged before and after the removal (i.e. `gayporntube` is NOT at position 0 — confirm by checking adapter declaration order). Removing the block must not shift the first-listed source, which is the default tab on plugin load.

---

### REQ-2 — Extend `extractStreams` to capture all JWPlayer `sources: [...]` qualities

**CURRENT.** `extractStreams(html)` at `plugin.js:1214` matches `'file': 'url.mp4'` with `jwRe = /['"]file['"]\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))['"]/g` but only assigns the **first** match to `url` and never populates `quality`. Many players embed a JSON sources array:
```js
sources: [
  { file: "https://cdn/.../1080.mp4", label: "1080p" },
  { file: "https://cdn/.../720.mp4",  label: "720p"  },
  { file: "https://cdn/.../480.mp4",  label: "480p"  }
]
```
Today only the first `file` is captured and quality is left as `{}`, so the player gets exactly one URL — usually the highest-listed one, but no quality menu.

**PROBLEM.** Adapters that delegate to `extractStreams` for JWPlayer pages (`porndig` via iframe, `ebun` via iframe, several fallbacks) lose the entire quality map. User reports playback works but quality selector is empty / locked to one stream.

**FIX.**

A single greedy regex (`/\{[^{}]*?...\}/`) cannot reliably parse sources-array objects: real-world entries frequently contain nested braces (`drm: {...}`, `httpSourceOptions: {...}`) and the proximity-style alternation produces false positives by matching unrelated JSON elsewhere in the page. Replace with a two-step approach that first delimits the array, then extracts `file` and `label` from each object independently.

- Add a new branch in `extractStreams` *before* the existing `jwRe` single-file scan with the following structure:

  **Step 1 — Locate the `sources: [ ... ]` block.**
  Find the start with `/sources\s*:\s*\[/i`. From the position of the matching `[`, walk the string with a simple bracket-depth counter (NOT a regex — character-scan) to find the matching `]`, accounting for nested `[]` and `{}` and ignoring brackets inside string literals. Capture the substring between `[` and `]` as `block`.

  ```js
  // Pseudocode for the delimiter scan — implementation detail, single small loop:
  // var depth = 0, inStr = false, strCh = '';
  // for (var i = startIdx; i < html.length; i++) {
  //   var c = html[i];
  //   if (inStr) { if (c === strCh && html[i-1] !== '\\') inStr = false; continue; }
  //   if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
  //   if (c === '[' || c === '{') depth++;
  //   else if (c === ']' || c === '}') { if (--depth === 0) { endIdx = i; break; } }
  // }
  ```

  **Step 2 — Walk each `{...}` object inside `block` (same brace-depth technique, scoped to `block`), and for each object substring run TWO independent regexes:**
  ```js
  var fileRe  = /['"]file['"]\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))['"]/i;
  var labelRe = /['"]label['"]\s*:\s*['"]([^'"]+)['"]/i;
  // For each object substring `obj`:
  var fm = fileRe.exec(obj);
  var lm = labelRe.exec(obj);
  if (fm && lm && !quality[lm[1]]) quality[lm[1]] = fm[1]; // first match wins
  ```

  Key order (`file` first vs `label` first) and quoting style are handled trivially because the regexes are independent. Nested objects (drm, etc.) are skipped wholesale by the brace-depth scan.

- Source objects without a `label` key are NOT added to the quality map. They are captured as a `url` fallback only (consistent with the legacy single-file scan behavior).
- If the same `label` appears multiple times in the sources array, the first match wins (insertion-order preserved). Document this behavior in a dedicated unit test.
- The existing single-`file` scan (lines using current `jwRe`) stays as a fallback for `url` when the sources-array branch finds nothing usable. Do NOT remove it.
- After the array branch, `url` may still be set to the first-listed source by the legacy `jwRe` single-file scan (back-compat). Adapters that need the best-quality `url` must call `bestQualityUrl(quality)` explicitly — see REQ-3.
- Final `url` is still chosen by the existing `if (!url && Object.keys(quality).length) url = quality[Object.keys(quality)[0]];` line — do NOT change that selection inside `extractStreams` (back-compat).

**Constraints.**
- Output contract of `extractStreams` must not change: still returns `{ url, quality }` with the same field types.
- Existing unit tests in `test/plugin-helpers.test.js` for `extractStreams` must still pass without modification. Add new tests covering the array case.
- No new dependencies; no rewrite of the function — only additive branch.

**Acceptance.**
- New unit tests in `test/plugin-helpers.test.js` covering:
  - file-then-label key order with 3 qualities → `quality` has 3 keys
  - label-then-file key order with 2 qualities → `quality` has 2 keys
  - single-source legacy `'file': 'x.mp4'` (no array) → still returns 1 url, empty quality (back-compat)
  - mixed array + standalone source tags → both captured
  - source object with nested `drm: {...}` block alongside `file`/`label` → outer object still extracted correctly, nested braces do not break delimiting
  - duplicate `label` (e.g. two `"720p"` entries) → first match wins, second is ignored
  - source object missing `label` → NOT added to quality map, but its `file` may serve as `url` fallback
- All existing `extractStreams` tests still pass.

---

### REQ-3 — Restore best-quality selection for `porndig`, `ebun`, `lenporno`

**CURRENT.**
- `porndig.getStream` (`plugin.js:2693`) fetches iframe HTML and calls `extractStreams(ihtml)`. Iframe is JWPlayer-based.
- `ebun.getStream` (`plugin.js:3332`) fetches iframe at `666-emded.com/embed/` and calls `extractStreams(ihtml)`. Iframe is JWPlayer-based.
- `lenporno.getStream` (`plugin.js:3406`) parses PlayerJS multi-quality string `[1080p]url1.mp4,[720p]url2.mp4` into a `quality` map and returns `bestQualityUrl(quality)`.

**PROBLEM.**
- `porndig` & `ebun`: After REQ-2 fixes `extractStreams` they will start returning a populated `quality`, but the current adapter code returns `result` verbatim — `result.url` is set by `extractStreams` to the *first* listed source (often lowest), not best. Player therefore plays lowest quality even with a populated menu.
- `lenporno`: User reports plays at minimum quality. The PlayerJS regex `pjRe = /(?:\[([^\]]+)\])?(https?:\/\/[^,\[\]<>\s"']+\.mp4)/gi` treats the first unlabeled URL as `lbl = "mp4"` (literal string from `_attr` fallback), causing `bestQualityUrl` to ignore it (`parseInt("mp4") === NaN → 0`) and pick the next labeled one — but only if the label is numeric. Need to verify the label-extraction fallback `(/[_-](\d+p)/i.exec(m[2]) || ['', 'mp4'])[1]` actually yields `"mp4"` for URLs without `_720p`/`-720p` in path. Confirm with live HTML.

**FIX.**
- `porndig.getStream`: change `return result.url ? result : extractStreams(html);` to:
  ```js
  if (result.url || Object.keys(result.quality).length) {
    var qKeys = Object.keys(result.quality);
    var best  = qKeys.length ? bestQualityUrl(result.quality) : result.url;
    return { url: best, quality: result.quality };
  }
  return extractStreams(html);
  ```
- `ebun.getStream`: same transformation — return `{ url: bestQualityUrl(result.quality) || result.url, quality: result.quality }` whenever quality map is populated.
- `lenporno.getStream`: after the PlayerJS parse loop, before `return`, drop any entry whose key does not look numeric-quality:
  ```js
  Object.keys(quality).forEach(function(k) {
    if (!/^\d{3,4}p?$/i.test(k)) delete quality[k];
  });
  ```
  Then `return { url: bestQualityUrl(quality) || best, quality: quality };` (already does this). For URLs that have no `[label]` prefix AND no `_NNNNp`/`-NNNNp` in the filename: do NOT insert them into `quality` (avoids two unlabeled URLs colliding on the same fallback key and silently overwriting each other). Instead, record the URL as a candidate for `best` (first such URL wins) so `bestQualityUrl(quality) || best` still has something to return.

**Acceptance.**
- For `porndig` and `ebun`: pick a known-multi-quality fixture; `getStream(video).quality` has ≥1 numeric key (≥2 expected on the chosen fixture). `getStream(video).url === bestQualityUrl(quality)` whenever the quality map is non-empty.
- For `lenporno`: no `quality` key equals `"mp4"`; all keys match `/^\d{3,4}p?$/i`. `quality` has ≥1 key when labeled URLs are present in the source. `url` always equals `bestQualityUrl(quality) || <first-found-url>` (never empty when at least one mp4 URL was parsed).
- New unit tests with representative HTML fixtures (saved under `test/fixtures/`) for each of the three adapters. Include a lenporno fixture with TWO unlabeled URLs to verify the second does not overwrite the first via a shared fallback key.

---

### REQ-4 — Fix `eporner.getStream`

**CURRENT.** `eporner.getStream` at `plugin.js:1661`:
```js
var pageUrl = 'https://www.eporner.com/hd-porn/' + video.id + '/';
return cherryFetch(pageUrl).then(function(html) {
  var result = extractStreams(html);
  if (result.url) return result;
  return { url: 'https://www.eporner.com/embed/' + video.id + '/', quality: {} };
});
```
Eporner uses its own API for search/browse (`_apiFetch` bypasses CF datacenter IP block by going direct — that part works). For `getStream` the code falls back to the embed HTML page URL when extraction fails — but an HTML page is not a stream and Lampa's `<video>` element rejects it.

**PROBLEM.** `extractStreams(html)` fails on the modern eporner video page (page uses obfuscated/lazy JWPlayer setup), so the fallback returns an HTML URL that Lampa cannot play.

**FIX.** Implement a real stream extraction path. Order of attempts (fail-soft chain):

1. **Direct page scrape.** Fetch `https://www.eporner.com/hd-porn/{id}/` via `cherryFetch`. Search for `hash` and stream URLs in the page's JS — eporner exposes stream URLs in a JS object like `cdnAlias`, `EP.video.player`, or `EpornerVideo({...sources...})`. Capture all `.mp4` URLs with embedded quality (e.g. `_720p_`, `_1080p_`) and build the quality map.
2. **Embed-page scrape.** If direct page fails, fetch `https://www.eporner.com/embed/{id}/` (the embed *HTML*, not the redirect URL). Run the same regex set against the embed HTML.
3. **Final fallback.** Return `{ url: '', quality: {} }` (so the player shows "no source" instead of trying to load an HTML page as video — current bug).
4. Wrap all returned URLs in `buildProxyUrl(url, 'https://www.eporner.com/')` so the eporner CDN sees a proper referer.

Concrete regex set to try (in order, take first non-empty result):
```js
// Pattern 1: hash-based JWPlayer-style sources within page JS — embedded resolution in path.
var src1 = /["'](https?:\/\/[^"'\s]+eporner\.com\/[^"'\s]+_(\d{3,4})p?_[^"'\s]+\.mp4[^"'\s]*)["']/gi;
// Pattern 3 (fallback, only if Pattern 1 returns zero matches): generic .mp4 with embedded resolution.
var src3 = /(https?:\/\/[^"'\s]*eporner[^"'\s]*\/(\d{3,4})p?[^"'\s]*\.mp4[^"'\s]*)/gi;
```
If pattern 1 yields matches, group #2 is the resolution → `quality[g2 + 'p'] = g1`. Run pattern 3 ONLY when pattern 1 returned an empty quality map — it is broader and may capture lower-confidence URLs, so it is gated behind pattern-1 failure.

**Pattern 2 (hash + quality proximity) is intentionally removed.** A cross-HTML proximity regex with `[\s\S]{0,2000}?` risks catastrophic backtracking and false hash/quality pairings, and the CDN URL template needed to reconstruct a stream from `(hash, quality)` is not known at spec-writing time. Pattern 2 is deferred until Open Question Q2 is answered. If Q2 reveals a JSON API endpoint that returns stream info directly (e.g. `/json/videoinfo/{id}`), implement a direct API fetch in place of any proximity scan.

**Acceptance.**
- `eporner.getStream({ id: <real-id> })` returns `quality` with at least one numeric key (e.g. `"720p"`) and `url` HTTP-reachable with `Content-Type` starting `video/` after going through `buildProxyUrl`.
- Embed-page fallback is no longer reachable by Lampa's `<video>` element (i.e. an HTML page URL is never returned as `result.url`).
- New unit tests against a saved live-page fixture (`test/fixtures/eporner-page.html`) confirm extraction yields ≥1 quality entry.

---

### REQ-5 — Update `getStream` patterns for `tizam`, `perfektdamen`, `huyamba`, `24rolika`

**CURRENT.**
- `tizam.getStream` (`plugin.js:2838`): `/src="(https?:\/\/[^"]+\.mp4)"\s+type="video\/mp4"/` then fallback to `extractStreams`.
- `perfektdamen.getStream` (`plugin.js:2878`): bare `return extractStreams(html);`.
- `huyamba.getStream` (`plugin.js:3255`): `/get_file\/(\d+\/[^"'\s<>]+\.(?:mp4|m3u8))/g` then `_kvsPickBest(found)`.
- `24rolika.getStream` (`plugin.js:3490`): `jwplayer(...).setup({...file: "url.mp4"})` regex `/jwplayer\s*\(\s*['"]?\w+['"]?\s*\)\s*\.setup\s*\(\s*\{[\s\S]*?['"]?file['"]?\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))['"]/`.

**PROBLEM.** User reports all four return empty `url`. Two possible categories:

| Adapter | Likely root cause |
|---|---|
| `tizam` | Page HTML structure changed; `<source src="..." type="video/mp4">` may now be `<video src="...">` or behind a JS-built player. |
| `perfektdamen` | Site likely embeds a JWPlayer/PlayerJS now; bare `extractStreams` misses both. REQ-2 + targeted iframe fetch should solve. |
| `huyamba` | `get_file/` path may have moved to a different host (no longer `fuq.huyamba.mobi`); regex hardcodes host. |
| `24rolika` | Player init may have moved out of literal `jwplayer(...).setup({...})` form — e.g. now `Playerjs({ file: ... })` or a constructed `new Player(...)`. |

**FIX.** For each adapter:

1. **Investigate live HTML** (see Open Questions §4) before coding — save one live page per adapter under `test/fixtures/<adapter>-page.html`.
2. **`tizam`**: Add a third regex before existing ones — look for player init JSON or `<video ... data-src=` / `data-url=` patterns. Add a `.m3u8` capture branch. Confirm `tizam.cc` CDN does not require referer beyond what `buildProxyUrl` adds.
3. **`perfektdamen`**: Add an explicit iframe detection: `/src="(https?:\/\/[^"]*(?:player|embed)[^"]*)"/i`; if found, `cherryFetch` the iframe and run `extractStreams` on its HTML (relies on REQ-2 multi-quality fix). Final fallback stays as `extractStreams(html)` on the page itself.
4. **`huyamba`**: Loosen host in the `get_file` regex to capture any **absolute** URL host: `/(https?:\/\/[^"'\s<>]+\/get_file\/[^"'\s<>]+\.(?:mp4|m3u8)[^"'\s<>]*)/gi`. Absolute-URL only — if Open Question Q4 reveals `get_file` paths are now served as relative URLs (no `https://` prefix), this REQ is reopened to add a second relative-path regex with explicit host-prepending logic. Do not preemptively add a relative-path branch the loosened regex cannot match.
5. **`24rolika`**: Add two additional patterns before the existing JWPlayer regex (the loose generic `(?:file|source|src)` fallback is intentionally NOT included — it produced too many false positives on unrelated scripts during reviewer analysis):
   - `Playerjs(...)` style: `/Playerjs\s*\([^)]*file\s*[:=]\s*['"]([^'"]+\.(?:mp4|m3u8))['"]/i`
   - Scoped player-config: search for an mp4/m3u8 `file` value within 500 characters AFTER any of the keywords `playerjs|jwplayer|new Player|Playerjs|videoConfig|playerConfig`. Implementation sketch: find each keyword index, then run `/['"]?file['"]?\s*[:=]\s*['"]([^'"]+\.(?:mp4|m3u8)[^'"]*)['"]/i` against the 500-char slice immediately after it. First non-empty match wins.
   - Iframe-then-extract: detect `<iframe src="...">` and recurse via `cherryFetch` + `extractStreams`.
   - If Open Question Q6 reveals the exact player init style, replace these heuristics with a single targeted pattern for that style and drop the scoped fallback.

For all four: return `{ url, quality }` with multi-quality map when available; never return an HTML URL as `url`.

**Acceptance.**
- Each of the four adapters returns a non-empty `url` for a known-good live video ID.
- Returned URL responds HTTP 200 via `buildProxyUrl(...)` with a media content-type (validated by REQ-8 test).
- New regex patterns covered by a unit test using a saved fixture per adapter.

---

### REQ-6 — Fix `pornhub.getStream` (flashvars extraction)

**CURRENT.** `pornhub.getStream` (`plugin.js:1378`) matches:
```js
/var\s+flashvars_\d+\s*=\s*(\{[\s\S]+?\});\s*\n/
```
falling back to the same regex without the trailing newline. Parses JSON, walks `mediaDefinitions`, builds MP4-preferred or HLS-with-proxy quality map.

**PROBLEM.** User reports videos do not play. Likely root cause: Pornhub now serves `mediaDefinitions` as an array where each entry has `defaultQuality: false` and the real URL is fetched on-demand from a `videoUrl` that is a *secondary endpoint* (e.g. `mediaDefinitions[0].videoUrl` is an internal master playlist redirect), or the flashvars block now ends with `}` followed by something other than `;\n` (e.g. inline comma in a larger expression). Alternative: Pornhub may have added a per-request signed token to `videoUrl`.

**FIX.**
1. **Broaden the flashvars match** to allow trailing whitespace, semicolons, or being mid-expression:
   ```js
   var fvMatch = html.match(/var\s+flashvars_\d+\s*=\s*(\{[\s\S]+?\})\s*;/);
   ```
   (drop `\n` requirement; today's first regex already accepts that — keep this as a no-regression simplification.)
2. **Verify `mediaDefinitions` shape** against live HTML (Open Question §4). If entries are now nested under `mediaDefinitions[*].defaultQuality === false` with the real URL behind a `videoUrl` indirection that needs a follow-up GET, implement a fetch-then-extract sub-step:
   - If `def.videoUrl` returns JSON (Content-Type application/json) instead of an `.mp4`/`.m3u8` URL, `cherryFetch` it and parse out the actual URL.
3. **HLS handling**: keep the existing `proxyM3u8` path. Verify the proxy still rewrites m3u8 segments correctly (no code change expected here — already integration-tested for other HLS sources).
4. **Add CDN host hardcoding for fallback**: if `defs` is empty but the HTML contains a `qualityItems` array, parse that instead. The relevant pattern is a recent Pornhub addition.

**Acceptance.**
- `pornhub.getStream({ url: <real-viewkey-page> })` returns `quality` with ≥2 keys for any modern PH video.
- At least the highest quality URL is HTTP-200 reachable through CF Worker proxy with media content-type.
- Existing tests for the helper function path stay green.

---

### REQ-7 — Workarounds for `hqporner` and `pornone` infrastructure blocks

**CURRENT.**
- `hqporner.getStream` (`plugin.js:1876`): finds `mydaddy.cc` embed, fetches it, extracts multi-quality `bigcdn.cc` URLs, wraps each in `buildProxyUrl(..., 'https://mydaddy.cc/')` — i.e. proxies via CF Worker.
- `pornone.getStream` (`plugin.js:2085`): `cherryFetch` page → `extractStreams` → pre-proxy each quality with `'https://pornone.com/'` referer via `buildProxyUrl` (CF Worker).
- Proxy router: `PROXY_URL_2_HOSTS` map (`plugin.js`, near top) currently routes only `xnxx.com` and `spankbang.com` to the Deno Deploy proxy; everything else goes to CF Worker.

**PROBLEM.**
- `bigcdn.cc` returns HTTP 403 to all Cloudflare datacenter IPs → CF Worker proxy is blocked at the upstream CDN.
- Pornone CDN issues per-IP signed tokens; when CF Worker's page-fetch IP differs from the segment-fetch IP, the second request is rejected. Even using consistent referer, the token-binding fails.

**FIX.** Candidate solutions ranked by likelihood of success:

#### Prerequisite (REQ-7-PRE) — `px()` double-proxy guard MUST land before Candidate A ships

The inner `px()` helper inside `playVideo()` (`plugin.js:258`) currently skips re-wrapping a URL only when it starts with `PROXY_URL` (the CF Worker base). It has no equivalent skip for `PROXY_URL_2` (the Deno Deploy base). Both `hqporner.getStream` (line 1900) and `pornone.getStream` (lines 2094–2096) pre-wrap their CDN URLs via `buildProxyUrl()`. The moment Candidate A routes `bigcdn.cc`/`pornone` CDN hosts to Deno, `buildProxyUrl()` returns a `PROXY_URL_2`-prefixed URL, `px()` fails to recognize it as already proxied, and double-wraps it — producing `…/proxy?url=…%2Fproxy%3Furl%3D…` which the proxy and player cannot handle. Result: 100% playback failure for both adapters.

**Required minimal change to `px()` — the ONLY edit permitted to `playVideo()` in this task:**

Add a single guard line, immediately after the existing `PROXY_URL` skip:

```js
if (PROXY_URL_2 && u.indexOf(PROXY_URL_2) === 0) return u; // also skip Deno-proxied URLs
```

All other logic inside `playVideo()` remains frozen. This is a one-line surgical change to a private nested helper, not a refactor of `playVideo`. Update the "frozen helpers" / "What this spec does NOT cover" section accordingly — the freeze on `playVideo()` is preserved EXCEPT for this single `px()` guard clause.

This prerequisite has its own acceptance check below; Candidate A cannot ship without it.

#### Candidate A (most likely) — Route CDN hosts (NOT page/embed hosts) through Deno Deploy proxy

Add ONLY the stream-CDN hosts to `PROXY_URL_2_HOSTS`:
- `bigcdn.cc` and the `sN.bigcdn.cc` pattern (start with `s1.bigcdn.cc`, `s2.bigcdn.cc`; broaden if other indices appear in live URLs)
- The pornone stream-CDN subdomain confirmed by Open Question Q8 (likely `cdn.pornone.com` or similar — DO NOT add until Q8 names the exact host)

Do **NOT** add `mydaddy.cc` (the embed/page host) or `pornone.com` (the main site host). The page/embed HTML fetches currently succeed through the CF Worker and have no IP-block or token-binding issue — only the stream CDN responses are broken, so only the CDN hosts need Deno routing. Adding page hosts would increase Deno load unnecessarily and risk hitting the free-tier quota faster.

Deno Deploy IPs are not on CF's range and have not been observed blocked by `bigcdn.cc` in prior testing (per `MEMORY.md` deno-proxy notes — must be re-verified for these specific CDN hosts via Q7/Q8).

- **Pros:** zero adapter code changes for `hqporner`; minimal change for `pornone` (config-map only). Narrow blast radius.
- **Cons:** Deno Deploy has lower concurrent connection limits than CF Worker; high-traffic concurrent users could hit the Deno quota. Mitigated by routing only the CDN segment requests (not page HTML).
- **Verification plan:** Manually curl `bigcdn.cc/pubs/.../720.mp4` and the confirmed pornone CDN URL through Deno proxy. Expect HTTP 200 + binary body. If 403 → escalate to Candidate B.
- **Estimated effort:** ~10 minutes (config-only) + 30 min testing, PLUS the one-line `px()` guard from REQ-7-PRE.

#### Candidate B — IP-pinning workaround for pornone (page + stream fetched through same proxy edge)
If pornone still fails after Candidate A: implement a "session" pattern in pornone.getStream:
1. Issue a single `cherryFetch` to a synthetic endpoint on the proxy that returns the *same* worker/deno edge IP back to the client (proxy adds an `X-Edge-IP` header).
2. Page fetch and stream fetch both pin to that edge IP via a query param the proxy honors.

- **Cons:** requires proxy-side changes (out of single-file scope); only do if Candidate A fails. Document as future work if so.

#### Candidate C — Token pre-fetch for pornone
If Candidate A fails for pornone but the token URL is discoverable in page HTML: after extracting CDN URLs, do one HEAD request through the proxy to "warm" the token, then return the URL with the warmed token appended.

- **Cons:** site-specific, fragile.

#### Candidate D — Skip these sources gracefully if all above fail
Return `{ url: '', quality: {} }` and mark both as "infrastructure-blocked" in `docs/CHERRY.md` lessons log alongside `spankbang`.

**Implementation order:** A → test → if A passes, ship A. Document any Candidate B/C/D work as separate spec.

**Acceptance.**
- `hqporner.getStream` returned URL responds HTTP 200 with `Content-Type: video/mp4` when fetched directly through whichever proxy is selected.
- `pornone.getStream` returned URL responds HTTP 200 with media content-type.
- If only A succeeds for one host (e.g. hqporner ok, pornone still 403), mark pornone as known-blocked and update tier classification in E2E to tier C with documented exception.
- **REQ-7-PRE acceptance (gates Candidate A):** No double-wrapped proxy URL ever reaches `Lampa.Player.play()`. Specifically, the value passed as `url` to `Lampa.Player.play()` (i.e. `px(url)`) must NEVER contain `/proxy?url=` more than once (counting any URL-encoded `%2Fproxy%3Furl%3D` occurrences as the same marker). Verified by a unit test that calls `px(buildProxyUrl(<cdn-url-routed-to-deno>))` and asserts the result equals the single-wrapped Deno proxy URL byte-for-byte.

---

### REQ-8 — E2E: validate stream URL is actually playable

**CURRENT.** `test/cherry-lampa-e2e.mjs` runs all 26 sources through `browse` → `getStream` × 5, and for tier A does a `Range` 206-status check plus a `<video>` `timeupdate > 2s` check inside the real Lampa page. For tier B/C/D it only verifies `getStream` returns a non-empty `url` string.

**PROBLEM.** A non-empty `url` is not a sufficient signal. `eporner` currently returns an embed HTML page URL — non-empty string, passes the current test, but Lampa cannot play it. We need to confirm the URL responds HTTP 200 AND serves a media content-type.

**FIX.**
- Add a helper `validateStreamReachable(streamResult)` in `cherry-lampa-e2e.mjs`. The helper accepts the `{ url, quality }` object returned by `getStream` (NOT the raw CDN URL) and validates the URL that Lampa's player will actually request — i.e. the proxy-wrapped URL produced by `px(url)`. This is the same value passed to `Lampa.Player.play()`, so reachability of that exact URL is what matters; the raw CDN URL is an internal detail and may legitimately fail when fetched directly (IP-bound tokens, referer locks, CDN-side CF-IP blocks).
  ```js
  async function validateStreamReachable(streamResult) {
    if (!streamResult || !streamResult.url) return { ok: false, reason: 'empty-url' };
    // Wrap the URL the same way px() inside playVideo() does: skip if already proxied,
    // otherwise pass through buildProxyUrl(). The test imports/recreates this helper
    // so the URL fetched here equals the URL Lampa.Player.play() receives.
    const url = wrapLikePxHelper(streamResult.url);
    try {
      // HEAD first (cheap); some CDNs reject HEAD → fallback to ranged GET.
      let r = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      if (r.status === 405 || r.status === 501) {
        r = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-1023' }, redirect: 'follow' });
      }
      if (r.status !== 200 && r.status !== 206) {
        return { ok: false, reason: 'http-' + r.status };
      }
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      const mediaOk = ct.startsWith('video/')
                   || ct.startsWith('audio/')
                   || ct.includes('mpegurl')         // HLS
                   || ct.includes('octet-stream');   // some CDNs mislabel mp4 as octet-stream
      if (!mediaOk) return { ok: false, reason: 'content-type:' + ct };
      return { ok: true, contentType: ct, status: r.status };
    } catch (e) {
      return { ok: false, reason: 'fetch-error:' + e.message };
    }
  }
  ```
- Apply this check **for every tier** after `getStream` returns; existing tier-A `timeupdate` check stays (it covers actual playback in Lampa, which is stronger).
- The reachability check runs as plain Node `fetch()` from the test-runner process (NOT through Playwright's page context). It verifies that the URL Lampa will actually request responds HTTP 200/206 with a media content-type — i.e. that the CDN+proxy chain is reachable and returns a video payload. It does NOT validate Lampa-page CORS behavior or in-browser media-source playback; those concerns are already covered by the existing tier-A `<video>` `timeupdate > 2s` check inside the Playwright page.
- Failure of reachability check downgrades the source to FAIL with `reason` shown in the summary line.
- Tier D (`xnxx`, `eporner`) keeps soft-fail behavior (best-effort) but the reachability failure is logged so future runs catch regressions.

**Constraints.**
- Do not double-fetch the same URL — cache results in a `Map` keyed by URL within a single E2E run.
- The URL cache is a cost optimization only; the underlying `getStream × 5` call count for tier-A is unchanged.
- The URL fetched IS the proxy-wrapped URL (i.e. what `Lampa.Player.play()` actually requests), not the raw CDN URL. This means hitting `https://cherry-proxy.aawersom.workers.dev/proxy?url=...` (CF Worker) or `https://cherry-proxy.aawersom.deno.net/proxy?url=...` (Deno) depending on host routing. Fetching the raw CDN URL from the Node process would produce false negatives for IP-bound or referer-locked CDNs (and would not reflect what Lampa actually requests).
- Total per-source budget: existing `VIDEO_TIMEOUT_MS = 35000` remains; reachability check adds ≤5s per stream and runs within that budget.
- Baseline (`tasks/cherry-e2e-baseline.json`) does NOT need a new field — `cardsCount` is unchanged. Just the pass/fail logic tightens.

**Acceptance.**
- Running `node test/cherry-lampa-e2e.mjs` after all REQ-1..7 fixes shows:
  - `eporner` either PASSES with `contentType: video/*` or FAILS with a precise reason (not a silent pass on an HTML URL).
  - Every tier-A source that previously passed still passes (`contentType: video/*` or `mpegurl`).
  - Summary line per-source includes the validated content-type.
- The reachability helper has at least one unit test in `test/plugin-helpers.test.js` that mocks `fetch` and asserts the OK/FAIL classification for: 200 video/mp4 → ok; 200 text/html → fail; 403 → fail; 206 video/mp4 → ok.

---

## 3. Out of Scope

- **`spankbang`**: blocked by Cloudflare JS challenge — separate, accepted limitation per `docs/CHERRY.md`.
- **New source adapters**: do not add new sources; only remove `gayporntube`.
- **Shared helper rewrites**: `cherryFetch`, `buildProxyUrl`, `proxyM3u8`, `bestQualityUrl`, `_kvsPickBest` are all frozen. `playVideo` is frozen except for a single one-line guard added to the inner `px()` helper (see REQ-7-PRE) — no other edits to `playVideo` are in scope.
- **Player UI changes** in Lampa: this plugin is data-only.
- **Search relevance / browse pagination** for any source.
- **Card thumb optimization, dedup, sort order**.
- **Proxy code changes**: the Cloudflare Worker and Deno Deploy source files are not edited by this task. REQ-7 Candidate A is a config-map change inside `plugin.js` only.
- **Caching** of getStream results.
- **i18n / localized labels**.

---

## 4. Open Questions (must be answered by live investigation before coding)

| # | Question | How to resolve | Blocks |
|---|---|---|---|
| Q1 | What is the modern Pornhub `flashvars_*` structure on a real page today? Is `mediaDefinitions[*].videoUrl` still a direct `.mp4`/`.m3u8` URL, or now a JSON indirection? | Open a real PH viewkey page in Playwright headed mode, dump `window.flashvars_*` to JSON, inspect. Save as `test/fixtures/pornhub-page.html` + a JSON dump. | REQ-6 |
| Q2 | What is the modern Eporner stream-extraction surface? Are stream URLs still in page HTML, or fully behind an XHR call to `/json/videoinfo/`-style endpoint? | Inspect one live eporner video page in browser devtools network panel. Capture the request that returns the actual `.mp4` URL. | REQ-4 |
| Q3 | Has tizam.org switched to a new player (e.g. iframe to a separate host) or simply changed the `<source>` markup? | Save one live tizam page HTML; grep for `.mp4`, `.m3u8`, `file:`, `<video`, `<iframe`. | REQ-5 |
| Q4 | What is the current `huyamba` host for `get_file/` paths? Still `fuq.huyamba.mobi` or moved? | Save one live huyamba video page; check `<script>` blocks and player init for the actual CDN host. | REQ-5 |
| Q5 | What player does `perfektdamen` now use, and is the actual stream URL on the page or behind an iframe? | Save one live perfektdamen video page; look for `<iframe>` or inline JWPlayer/PlayerJS init. | REQ-5 |
| Q6 | Does `24rolika` (huyalkino.com) now use PlayerJS instead of JWPlayer, or has the JWPlayer init signature changed? | Save one live page; grep for `jwplayer`, `Playerjs`, `new Player`, `file:`. | REQ-5 |
| Q7 | Does the Deno Deploy proxy successfully fetch `bigcdn.cc/pubs/.../*.mp4`? Returns 200 with binary body, or also 403? | Manual curl: `curl -I "https://cherry-proxy.aawersom.deno.net/proxy?url=https%3A%2F%2Fs1.bigcdn.cc%2Fpubs%2FHASH%2F720.mp4&key=1206"` with a fresh real URL. | REQ-7 |
| Q8 | Do pornone CDN URLs work through Deno Deploy proxy, or also fail due to IP-bound tokens? | Same as Q7, with a fresh pornone CDN URL. | REQ-7 |
| Q9 | For REQ-3 lenporno: does the live page yield unlabeled URLs that fall back to literal `"mp4"` key, or does the existing label-from-filename regex catch them? | Save one lenporno page; trace `pjRe` matches against actual content. | REQ-3 |

**Resolution policy:** Q1–Q6 and Q9 must each have a saved HTML fixture in `test/fixtures/` before writing the corresponding regex. Q7–Q8 must have a curl-confirmed answer recorded in the plan doc before choosing REQ-7 Candidate A vs falling back to B/C/D.

### Parked / out-of-scope follow-ups

- **OQ-10:** If `lenporno` real pages yield non-numeric labels such as `"HD"`, `"SD"`, `"4K"`, `"FullHD"`, integer-quality normalization will be needed (e.g. map `HD → 720p`, `FullHD → 1080p`, `4K → 2160p`) so `bestQualityUrl` can rank them. This is wider in scope than REQ-3 (touches the quality-ranking contract assumption) and is parked as a separate future task. For this spec, non-numeric labels are stripped (see REQ-3 fix).
- **REQ-6 cherryFetch + JSON indirection** for Pornhub `mediaDefinitions[*].videoUrl`: deferred until Q1 confirms the indirection actually exists in live HTML.
- **REQ-8 cache + redirect handling**: low priority; current `redirect: 'follow'` + URL-keyed `Map` is acceptable as-is.
- **REQ-3 lenporno label normalization** (HD/SD/4K → numeric): see OQ-10 above; out of scope for this spec.

---

## 5. Success Criteria (mapped per REQ)

| REQ | Pass signal | Verification command |
|---|---|---|
| REQ-1 | Zero matches for `gayporntube` in plugin.js, test/, baseline JSON | `Grep -n gayporntube` across repo |
| REQ-2 | New `extractStreams` tests for multi-quality JWPlayer array pass; legacy tests still pass | `npx vitest run test/plugin-helpers.test.js` |
| REQ-3 | `porndig` / `ebun` / `lenporno` each return a `quality` map with ≥1 numeric key (≥2 expected on the chosen known-multi-quality fixtures); `url === bestQualityUrl(quality)` whenever the map is non-empty; for `lenporno` no key equals `"mp4"` and unlabeled URLs do not collide on a shared fallback key | Unit tests with fixtures; E2E reachability check passes |
| REQ-4 | `eporner.getStream` returns a stream URL with `video/*` content-type via proxy; embed HTML URL never returned as `url` | Unit test on fixture + E2E reachability (REQ-8) |
| REQ-5 | Each of `tizam`, `perfektdamen`, `huyamba`, `24rolika` returns non-empty `url` reachable HTTP 200 + media content-type | E2E reachability passes for all four |
| REQ-6 | `pornhub.getStream` returns `quality` with ≥2 keys; highest quality is HTTP 200 + media content-type | E2E tier A check + reachability |
| REQ-7 | `hqporner` and `pornone` returned URLs respond HTTP 200 + `video/mp4` (or marked as known-blocked with documented exception); `px()` guard against `PROXY_URL_2` double-wrap is in place and unit-tested (REQ-7-PRE) | Curl results in plan doc + E2E reachability + new `px()` unit test |
| REQ-8 | `validateStreamReachable` unit tests pass; E2E summary shows content-type per source; any HTML-as-stream regression is caught | `node test/cherry-lampa-e2e.mjs` exit 0, summary inspected |

### Overall acceptance
- Total source count = 25 (was 26).
- E2E full-suite exit code 0 with the new reachability check enabled.
- All previously-passing tier-A sources still pass.
- At least 6 of the 8 originally-broken sources (the 6 parser-fix REQs) confirmed playing in real Lampa via headed Playwright run; the remaining 2 (`hqporner`, `pornone`) either pass (Candidate A success) or are documented as known-blocked.
- `tasks/cherry-e2e-baseline.json` regenerated; `gayporntube` removed from baseline; no other diffs unless real-card-count drift is observed (in which case baseline is updated and the change is noted in the plan).
- `docs/CHERRY.md` updated: lessons section gets new entries for REQ-2 (multi-quality JWPlayer), REQ-7 (Deno routing for bigcdn/pornone), REQ-8 (reachability gate).

---

## 6. Risks

- **Regex brittleness.** Every adapter fix is regex-against-HTML. Mitigation: every regex must have a saved fixture test so future drift is detectable in CI without hitting the live site.
- **Deno Deploy capacity.** Routing the `bigcdn.cc` (hqporner) and pornone CDN subdomains through Deno may hit free-tier limits during peak playback. Page/embed HTML fetches stay on CF Worker (per M2) to minimize Deno load. Mitigation: monitor 503 rates post-deploy; documented in lessons; fallback is Candidate B/C/D in REQ-7.
- **E2E flakiness.** Adding reachability `fetch` per source increases external-network surface. Mitigation: HEAD-first with GET-range fallback minimizes data; per-URL cache prevents duplicate fetches; failures are categorized (`http-403` vs `content-type:text/html` vs `fetch-error`) so flake vs real regression is distinguishable.
- **eporner CDN may need cookies.** If REQ-4 reveals that `cdnAlias` requires session cookies, this REQ expands. Mitigation: explicit Open Question Q2 must be answered first; if cookies required, REQ-4 may downgrade to "best-effort" and eporner stays tier D.

---

## 7. Non-goals reminder

We are not refactoring the plugin. We are not introducing new shared helpers. We are not changing the `StreamResult` contract. We are not building a sources DSL. Every change is local to one adapter except: REQ-2 (one additive branch in `extractStreams`), REQ-7 Candidate A (one config-map update in `PROXY_URL_2_HOSTS`), and REQ-7-PRE (one one-line guard clause in the inner `px()` helper inside `playVideo()`).
