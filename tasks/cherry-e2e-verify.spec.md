# Cherry Plugin — E2E Verification Test Specification

**Version:** 1.0  
**Date:** 2026-05-26  
**Scope:** End-to-end functional verification of all 26 Cherry source adapters running inside real Lampa (http://lampa.mx/)  
**Test file:** `test/cherry-lampa-e2e.mjs`  
**Plugin entry:** `plugin.js` (~3700 lines, single-file IIFE)  
**Proxy:** `https://cherry-proxy.aawersom.workers.dev`  
**Proxy key:** `1206` (default, stored in `Lampa.Storage`)

---

## Purpose

This specification defines what the Cherry E2E test verifies, what constitutes a pass or fail at every level (per-check, per-source, per-tier, suite), and which failures are expected rather than regressions. A reader with no prior context must be able to determine from this document alone whether a test run result is acceptable.

---

## 1. Source Classification

All 26 adapters are divided into four tiers based on confirmed runtime behaviour as of 2026-05-25. Tier assignment is **fixed** — a source does not move tiers based on transient failures. Tier assignment changes only when the root cause of a limitation is resolved or a new CDN-side block is confirmed.

**Tier totals: 12 + 9 + 2 + 3 = 26 sources.**

### Tier A — Full pipeline expected (browse + stream + Range-206 + video)

These sources have confirmed stable browse, proxied MP4 streams, and successful `<video>` metadata loads. All four checks are mandatory.

| # | id | name | Protocol type | Stream notes |
|---|---|---|---|---|
| 1 | `pornhub` | Pornhub | JSON API | HLS via `proxyM3u8` → blob URL; Range + video tests N/A (mark pass) |
| 2 | `xvideos` | Xvideos | HTML scraping | HLS via `proxyM3u8`; Range test N/A (blob); video test: test with blob URL (browser plays blob HLS natively); if getStream returns raw .m3u8 URL, mark video N/A |
| 3 | `youjizz` | YouJizz | HTML scraping | Direct MP4 via proxy |
| 4 | `xozilla` | Xozilla | JWPlayer + HTML | KVS get_file, non-signed |
| 5 | `analdin` | Analdin | JWPlayer + HTML | KVS get_file, non-signed |
| 6 | `porndig` | Porndig | iframe player | Previewclip CDN |
| 7 | `tizam` | Tizam | HTML scraping | Direct MP4 |
| 8 | `hellporno` | HellPorno | `chs_object` + `<source res>` | KVS get_file, multi-quality |
| 9 | `pornobolt` | Pornobolt | KVS (pbcdn.tv) | KVS get_file, multi-quality |
| 10 | `crocotube` | CrocoTube | KVS (alphaxcdn.com) | KVS get_file, multi-quality |
| 11 | `24rolika` | 24Rolika | DLE + JWPlayer | MP4 direct |
| 12 | `jopaonline` | JopaOnline | DLE + JWPlayer | MP4 direct |

**Count: 12 sources**

### Tier B — Browse mandatory; stream/video intermittent (KVS signed tokens)

These sources use short-lived signed `get_file/` tokens or slow CDNs. Browse and stream URL generation are mandatory. Video and Range-206 checks are best-effort and do not count toward suite pass/fail.

The token expiry failure mode: `getStream()` returns a valid URL, but by the time the Range request or `<video>` element fires, the token has expired (TTL ~30–60 seconds) and the CDN returns 403. This is not an adapter bug — it is a CDN-side design. Real Lampa usage is unaffected because playback starts within seconds of the token being minted.

**Mitigation in test:** call `getStream()` fresh immediately before each video test. Do not reuse the URL returned during the Range phase.

| # | id | name | Protocol type | Stream notes |
|---|---|---|---|---|
| 1 | `porntrex` | Porntrex | KVS + HTML | Signed token, occasionally expired before video |
| 2 | `3movs` | 3Movs | HTML scraping | KVS signed token |
| 3 | `pornve` | PornVe | SisiStyle (`videoUrl:`) | KVS signed token |
| 4 | `familyporn` | FamilyPorn | SisiStyle (CDN path) | KVS signed token |
| 5 | `ebun` | Ebun | HTML scraping | KVS signed token |
| 6 | `perfektdamen` | PerfektDamen | KVS + HTML | KVS signed token, get_file CDN |
| 7 | `huyamba` | Huyamba | KVS get_file | KVS CDN, get_file pattern |
| 8 | `lenporno` | LenPorno | Custom upload path | Custom CDN; host may shift between `www.lenporno.net` / `my.lenporno.live` |
| 9 | `gayporntube` | GayPornTube | HTML scraping (SisiStyle-like) | CDN MP4, slow; moved to Tier B due to slow CDN / intermittent token freshness |

**Count: 9 sources**

### Tier C — Browse mandatory; video permanently broken (CDN architecture limitation)

These sources have a confirmed, non-fixable CDN-side block that prevents video playback through the Cloudflare Worker proxy. Browse must pass. Stream URL generation is attempted but not required. Video and Range-206 failures are **expected and are themselves the pass condition**.

| # | id | name | Root cause |
|---|---|---|---|
| 1 | `hqporner` | HQPorner | `bigcdn.cc` blocks all Cloudflare datacenter IPs. The embed chain `hqporner.com → mydaddy.cc → sN.bigcdn.cc` terminates with 403/404 from bigcdn regardless of `Referer` or `User-Agent`. Not solvable at proxy or adapter level. |
| 2 | `pornone` | PornOne | IP-locked signed tokens. `pornone.com` CDN generates stream tokens tied to the requesting IP. The CF Worker fetches the page HTML and then the CDN in separate requests that may route through different CF edge IPs, causing a token/IP mismatch → 403. Direct browser access works; proxy relay does not without a non-CF relay. |

**Count: 2 sources**

### Tier D — 0 cards expected (bot-blocked at Cloudflare Worker IP level)

These sources return empty results because the target site's bot protection blocks requests originating from Cloudflare datacenter IPs. The expected result is **zero cards**. Zero cards is the pass condition — a non-zero result would indicate the bot block was lifted and the source should be promoted.

| # | id | name | Block mechanism |
|---|---|---|---|
| 1 | `xnxx` | Xnxx | Cloudflare bot protection; CF Worker IPs return 403/empty HTML |
| 2 | `eporner` | Eporner | Same — site-level IP block for CF Worker ranges |
| 3 | `spankbang` | Spankbang | Same — POST stream API also blocked; browse returns 0 cards |

**Count: 3 sources**

---

## 2. Checks Per Source

Four checks exist. Which checks apply depends on tier and stream type.

### Check 1: Browse Structure

**What it tests:** The adapter correctly fetches and parses at least one page of video cards from the source.

**How it runs:**
```javascript
const result = await adapter.browse('', 1);
// result: BrowseResult { items: VideoCard[], total_pages: number }
```

**Field validation (applied to first 3 items):**

| Field | Type | Rule |
|---|---|---|
| `id` | string | Non-empty; no whitespace only |
| `source` | string | Must equal `adapter.id` exactly |
| `title` | string | Non-empty; no whitespace only |
| `url` | string | Starts with `http://` or `https://` |

**Quantity rule:**
- Tier A and Tier B: `items.length >= 5` (minimum 5 cards required — allows 5 separate `getStream` calls in Check 2)
- Tier C: `items.length >= 1`
- Tier D: `items.length === 0` — this is the PASS condition

**PASS criterion:**
- Tier A/B: `items.length >= 5` AND all field rules satisfied on first 3 items
- Tier C: `items.length >= 1` AND all field rules satisfied on first item
- Tier D: `items.length === 0`

**FAIL criterion (Browse):**
- Tier A/B: `items.length < 5`, OR any field validation fails on first 3 items, OR adapter throws an unhandled exception
- Tier C: `items.length === 0` or adapter throws
- Tier D: `items.length > 0` (would indicate site is unblocked — log it but do not fail the suite)

---

### Check 2: getStream — 5 Cards

> NOTE: The current test file (cherry-lampa-e2e.mjs) tests only 1 card per source. The 5-card requirement below defines the target implementation that the test file must be upgraded to. The test rewrite is Phase 1 of the implementation plan.

**What it tests:** The adapter resolves a playable stream URL for individual video cards. Tested on 5 different cards to reduce flakiness from single-video anomalies (age-gated videos, deleted content, CDN edge failures).

**How it runs:**
```javascript
// cards = result.items from Check 1
for (const card of cards.slice(0, 5)) {
  const stream = await adapter.getStream(card);
  // stream: StreamResult { url: string, quality: Object.<string,string> }
}
```

**Field validation:**

| Field | Rule |
|---|---|
| `stream.url` | Non-empty string; must not be `undefined` or `null` |
| `stream.url` | If non-empty: starts with `https://`, `http://`, `//`, or `blob:` |
| `stream.quality` | Object (may be empty `{}`); must not be `undefined` |

**Best-quality selection rule (when `quality` is non-empty):**

`stream.url` must equal `bestQualityUrl(stream.quality)`, where `bestQualityUrl` selects the key with the highest `parseInt(label, 10)` value. Example: quality `{ '720p': 'url-a', '1080p': 'url-b' }` → `stream.url` must be `'url-b'`.

Sources expected to return multi-quality maps (at least 2 keys): `hellporno`, `pornobolt`, `crocotube`, `xvideos`.

**URL pre-proxy rule:**

If `stream.url` starts with `PROXY_BASE` (`https://cherry-proxy.aawersom.workers.dev`), it is already proxied. Do not re-wrap it. This is the double-proxy guard — the adapter correctly called `buildProxyUrl` internally.

Protocol-relative URLs (`//cdn/...`) must be normalised to `https:` before wrapping.

**PASS criterion:**
- `>= 4` of 5 calls return a non-empty `url`
- All returned `quality` objects are well-formed
- When quality map is non-empty, `stream.url === bestQualityUrl(stream.quality)`

**FAIL criterion:**
- `<= 2` of 5 calls return a non-empty URL (more than 2 failures signals adapter breakage, not flakiness)
- Any call returns `quality` that is not an object
- Any call where quality is non-empty but `stream.url` does not match `bestQualityUrl`

**Tier applicability:**
- Tier A: mandatory, failure fails the suite
- Tier B: mandatory for URL presence; 4/5 threshold applies
- Tier C: attempted, but failure is expected and does not fail the suite
- Tier D: not run (no cards)

---

### Check 3: Range-206 via Proxy

**What it tests:** The Cloudflare Worker proxy correctly returns HTTP 206 Partial Content with a `Content-Range` header when asked for a byte range. This confirms the proxy is forwarding range requests to the origin CDN and the CDN supports HTTP range requests.

**How it runs:**
```javascript
const proxiedUrl = buildProxyUrl(stream.url);
// Inside the Lampa page context (browser CORS enforcement applies):
const response = await fetch(proxiedUrl, {
  headers: { 'Range': 'bytes=0-65535' },
  signal: AbortSignal.timeout(10000)
});
```

**buildProxyUrl shape:**
```
https://cherry-proxy.aawersom.workers.dev/proxy?url={encodeURIComponent(target)}&key=1206[&referer={encodeURIComponent(ref)}]
```

**PASS criterion:**
- `response.status === 206`
- `response.headers.get('Content-Range')` matches `/bytes 0-\d+\/\d+/`

**FAIL criterion:**
- `response.status !== 206` (e.g. 200 means proxy does not forward range; 403/404 means CDN block)
- `Content-Range` header absent or malformed

**N/A (mark as pass, skip test):**
- `stream.url` starts with `blob:` (e.g. pornhub proxyM3u8, xvideos if proxyM3u8 returns blob) → skip both Range and video tests (mark N/A=pass)
- `stream.url` points to an HLS stream that is served via `proxyM3u8` — the M3U8 was already rewritten and a `blob:` URL returned; video player does not issue a Range request
- Tier C sources: video pipeline is broken by CDN design, Range test would also fail — mark N/A
- Tier D sources: no stream to test

---

### Check 4: Video loadedmetadata

**What it tests:** The browser's video engine can fetch enough of the stream to parse the container headers, confirm duration, and fire `loadedmetadata`. This is the most rigorous end-to-end signal — it exercises the full chain: proxy → CDN → stream response → browser demuxer.

**How it runs (inside Lampa page context):**
```javascript
// IMPORTANT: call getStream() fresh immediately before this test for Tier B
// to get a non-expired token. Do NOT reuse the URL from Check 3.
const freshStream = await adapter.getStream(card);
const freshUrl = freshStream.url.startsWith('//')
  ? 'https:' + freshStream.url
  : freshStream.url;
const proxiedUrl = freshUrl.startsWith(PROXY_BASE)
  ? freshUrl
  : buildProxyUrl(freshUrl);

await new Promise((resolve, reject) => {
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  document.body.appendChild(video);
  video.src = proxiedUrl;

  const timeout = setTimeout(() => {
    video.src = '';
    document.body.removeChild(video);
    resolve({ ok: false, reason: 'timeout', readyState: video.readyState, networkState: video.networkState });
  }, 14000);

  video.addEventListener('loadedmetadata', () => {
    clearTimeout(timeout);
    const duration = video.duration;
    video.src = '';
    document.body.removeChild(video);
    resolve({ ok: true, duration });
  });

  video.addEventListener('error', () => {
    clearTimeout(timeout);
    resolve({ ok: false, reason: 'error', code: video.error?.code, readyState: video.readyState });
  });

  video.load();
});
```

**PASS criterion:**
- `loadedmetadata` event fires within **14 seconds**
- `video.duration > 0` after event

**Diagnostic data to capture (do not affect pass/fail):**
- `video.duration` (seconds, format as `MM:SS` in output)
- `video.videoWidth` (0 is valid for audio-only or metadata-only response)
- `video.readyState` and `video.networkState` on timeout/error

**N/A (mark as pass, skip test):**
- `stream.url` starts with `blob:` (e.g. pornhub proxyM3u8, xvideos if proxyM3u8 returns blob) → skip both Range and video tests (mark N/A=pass)
- HLS streams already served via `proxyM3u8` where `getStream` returns raw `.m3u8` URL → mark video N/A
- Tier C sources: expected to fail, mark as expected-fail (not a regression)
- Tier D sources: no stream to test

---

## 3. Suite-Level Pass/Fail Thresholds

### Per-tier thresholds

| Tier | Sources | Browse pass threshold | getStream URL threshold | Range-206 threshold | Video loadedmetadata threshold |
|---|---|---|---|---|---|
| **A** | 12 | **12/12** (zero tolerance) | **12/12** (URL must be non-empty) | **>= 9/10 applicable** (pornhub and xvideos N/A) | **>= 9/10 applicable** (pornhub and xvideos N/A) |
| **B** | 9 | **>= 9/10** (allow 1 failure, 1 simultaneous outage tolerated) | **>= 7/9** (2 token failures tolerated) | best-effort, not counted | best-effort, not counted |
| **C** | 2 | **2/2** (browse always works) | **0/2 expected fail** | **N/A** | **0/2 EXPECTED FAIL** — failure IS the pass condition |
| **D** | 3 | **0/3 expected** (0 cards = pass) | **N/A** | **N/A** | **N/A** |

### Suite PASSES if ALL of the following are true:

1. Tier A browse: 12/12 sources return >= 5 cards with valid fields
2. Tier A getStream URL: 12/12 sources return non-empty `url` on >= 4/5 cards
3. Tier A Range-206: >= 9/10 applicable (excluding N/A sources `pornhub` and `xvideos`)
4. Tier A video: >= 9/10 applicable (excluding N/A sources `pornhub` and `xvideos`)
5. Tier B browse: >= 9/10 sources return >= 5 cards
6. Tier B getStream URL: >= 7/9 sources return non-empty `url` on >= 4/5 cards
7. Tier C browse: 2/2 sources return >= 1 card
8. Tier C video: 0/2 (both fail — confirmed expected behaviour)
9. Tier D browse: 0/3 (all return 0 cards — bot-blocked as expected)
10. No Tier A source that previously returned >= 5 cards now returns 0 (regression guard)

### Suite FAILS if ANY of the following are true:

| Failure condition | Reason |
|---|---|
| Any Tier A source returns 0 cards | Adapter is broken or site is down |
| Any Tier A source returns empty `url` on all 5 getStream calls | Adapter stream extraction is broken |
| Tier A video < 8/10 applicable | Sudden drop signals proxy-side outage, not individual adapter flakiness |
| Tier B browse < 8/10 | 2+ simultaneous site outages in Tier B is unlikely without a systemic cause |
| Tier C browse drops to 0/2 | `hqporner` or `pornone` site structure changed; adapter needs update |
| Idempotency check fails | `plugin_cherry_ready` not set after first load, or `__CHERRY_SOURCES.length !== 26` after re-injection |
| Suite crashes before completing all sources | Playwright runtime error, not a source failure |

---

## 4. Test Execution Plan

### Prerequisites

- Node.js with `@playwright/test` installed (`npx playwright install chromium`)
- `plugin.js` built and present at `D:/Works/Lampa/plugin.js`
- Network access to `http://lampa.mx/` and `https://cherry-proxy.aawersom.workers.dev`
- No VPN or residential proxy active (test must run from the same IP class as CF Worker)

### Phase 0: Constants

```
LAMPA_URL       = 'http://lampa.mx/'
PLUGIN_URL      = 'https://aawersom.github.io/cherry-plugin/plugin.js'
PROXY_BASE      = 'https://cherry-proxy.aawersom.workers.dev'
PROXY_KEY       = '1206'
VIDEO_TIMEOUT   = 14000 ms
CONCURRENCY     = 3 (parallel Lampa page tabs)
```

### Phase 1: Bootstrap and Setup Verification

**Goal:** Confirm the Cherry plugin loads correctly inside real Lampa and all 26 source adapters are accessible for testing.

**Steps:**

1. Launch Chromium with `--autoplay-policy=no-user-gesture-required` and `bypassCSP: true`
2. Before page load (`addInitScript`), inject:
   - `localStorage.plugins = [{ url: PLUGIN_URL, status: 'on' }]`
   - `localStorage.cherry_proxy_key = '1206'`
   - Delete `lampa_cache` IndexedDB (clears Lampa's plugin cache to prevent stale plugin code)
3. Navigate to `http://lampa.mx/`, wait for `domcontentloaded`
4. Press `Enter` twice with pauses to unblock Lampa's TV-mode loading screen
5. Force Lampa initialization if keyboard did not trigger it:
   ```javascript
   window.appready = true;
   Lampa.Listener.send('ready', {});
   Lampa.Plugins.init?.();
   Lampa.Plugins.load?.();
   ```
6. Wait for `window.plugin_cherry_ready === true` (timeout: 20 seconds)
7. Re-inject a patched version of `plugin.js` to expose `__CHERRY_SOURCES`:
   - Replace `if(window.plugin_cherry_ready) return;` guard with `if(window.__CHERRY_SOURCES) return;`
   - Replace `var SOURCES = [` with `var SOURCES = window.__CHERRY_SOURCES = [`
   - Stub `startPlugin()` to a no-op (prevents Lampa UI re-registration errors on re-eval)
   - Eval the patched script; catch and ignore registration errors
   - Wait 300ms for adapter push-in to complete
8. Verify: `window.__CHERRY_SOURCES.length === 26`

**PASS criterion for Phase 1:**
- `window.plugin_cherry_ready === true`
- `window.__CHERRY_SOURCES.length === 26`

**If Phase 1 fails:** abort the entire test run. Log the error. Exit with code 1.

### Phase 2: Browse Tests (all 26 sources)

**Goal:** Verify every adapter can fetch and parse a page of video cards.

**Execution:**
- Process sources in batches of `CONCURRENCY=3`
- Each source gets its own Lampa page tab using a **separate browser context** (`await browser.newContext(...)`) rather than sharing one context. Sharing a context shares localStorage and IndexedDB across concurrent pages of the same origin, creating race conditions in plugin initialization.
- Per source: call `adapter.browse('', 1)`, collect `items`, validate first 3 items
- Run batches sequentially; within a batch, tabs are parallel

**Record per source:**
- `cardsCount: number` — total `items.length`
- `fieldValid: boolean` — all field rules satisfied on first 3 items
- `browseOk: boolean` — cardsCount meets tier threshold AND fieldValid
- `browseError: string` — error message if exception thrown

**Time budget:** 30 seconds per source (Playwright default navigation timeout: 30s)

### Phase 3: getStream Tests (Tier A / B / C only, 5 cards per source)

**Goal:** Verify stream URL extraction works for multiple real cards.

**Execution:**
- Reuse the same page from Phase 2 (plugin already initialized, same Lampa session)
- Per source: call `adapter.getStream(card)` for `cards[0]` through `cards[4]`
- Calls are sequential within a source (parallel calls risk token conflicts on some CDNs)

**Record per source:**
- `streamUrls: string[]` — 5 URLs (empty string if call failed)
- `urlPresentCount: number` — count of non-empty URLs
- `qualityKeys: number[]` — key count per call
- `bestQualityMatch: boolean[]` — whether `url === bestQualityUrl(quality)` for non-empty quality maps
- `streamErrors: string[]` — error messages per call

### Phase 4: Range-206 and Video Tests (Tier A / B only)

**Goal:** Confirm the proxy correctly forwards byte-range requests and the browser can decode enough of the stream to fire `loadedmetadata`.

**Execution:**
- Per source, per card tested in Phase 3:
  1. **Range test:** `fetch(buildProxyUrl(streamUrl), { headers: { Range: 'bytes=0-65535' } })`
  2. **Fresh token for video:** call `getStream(card)` again immediately before `<video>` test
  3. **Video test:** create `<video preload=metadata>`, set `.src = buildProxyUrl(freshUrl)`, wait for `loadedmetadata` or timeout at 14s

**Important token freshness rule:** The URL used for the `<video>` test **must** come from a fresh `getStream()` call made immediately before. Never reuse the URL from the Range step. This applies to all tiers but is especially critical for Tier B.

**Skip conditions (mark N/A = pass):**
- `streamUrl.startsWith('blob:')` → skip Range and video tests (`pornhub`, and `xvideos` if proxyM3u8 returns blob)
- `streamUrl` is an HLS stream returned by `proxyM3u8` where the raw `.m3u8` URL is returned → skip Range test
- Source is Tier C → skip both (expected failure, not tested)

**Record per source:**
- `rangeStatus: number` — HTTP status from Range request
- `contentRangeHeader: string` — raw `Content-Range` value
- `rangeOk: boolean` — status 206 AND header matches `/bytes 0-\d+\/\d+/`
- `videoOk: boolean` — `loadedmetadata` fired AND `duration > 0`
- `videoDuration: number | null`
- `videoReadyState: number` — on timeout/error only
- `videoNetworkState: number` — on timeout/error only

---

## 5. Success/Failure Verdict Evaluation

After all phases complete, evaluate the following checks in order. The first failing check terminates verdict evaluation with FAIL.

### Verdict checks (in order):

**1. Phase 1 passed**
- `window.__CHERRY_SOURCES.length === 26`
- Failure message: "Plugin bootstrap failed — `__CHERRY_SOURCES` not populated"

**2. Idempotency guard**
- `window.plugin_cherry_ready === true` after first eval
- Second eval of patched plugin must not duplicate sources: `__CHERRY_SOURCES.length` remains 26
- Failure message: "Idempotency guard broken — duplicate source registration detected"

**3. Tier D browse (expected 0 cards)**
- `xnxx`, `eporner`, `spankbang` must each return 0 cards
- If any returns > 0 cards: log as INFO "Tier D source unblocked — consider promoting to Tier B", do NOT fail the suite
- Failure condition: adapter throws an unhandled exception (0 cards from exception ≠ 0 cards from clean result)

**4. Tier C browse**
- `hqporner` and `pornone` must each return >= 1 card
- Failure message: "Tier C browse failed — `{id}` returned 0 cards (site structure may have changed)"

**5. Tier C video (expected failure)**
- `hqporner` and `pornone` stream/video checks must FAIL (0/2)
- If either passes video: log as INFO "Tier C source now plays video — investigate CDN block status", do NOT fail the suite

**6. Tier A browse (zero tolerance)**
- All 12 Tier A sources: `cardsCount >= 5` AND `fieldValid === true`
- Failure message: "Tier A browse regression — `{id}` returned {count} cards"

**7. Tier A getStream URL**
- All 12 Tier A sources: `urlPresentCount >= 4` (out of 5 cards)
- Failure message: "Tier A stream broken — `{id}` returned URL on only {count}/5 cards"

**8. Tier A Range-206** (excluding `pornhub`, `xvideos`)
- At least 9 of 10 applicable Tier A sources pass Range check (Tier A minus pornhub and xvideos)
- Failure message: "Tier A Range-206 failures ({count}/10) — proxy issue likely"

**9. Tier A video** (excluding `pornhub`, `xvideos`)
- At least 9 of 10 applicable Tier A sources pass video check (Tier A minus pornhub and xvideos)
- Failure message: "Tier A video failures ({count}/10) — check proxy connectivity"

**10. Tier B browse**
- At least 9 of 10 Tier B sources: `cardsCount >= 5` AND `fieldValid === true`
- Failure message: "Tier B browse regression — `{id}` returned {count} cards"

**11. Tier B getStream URL**
- At least 7 of 9 Tier B sources: `urlPresentCount >= 4`
- Failure message: "Tier B stream failures ({count}/9) — KVS token issues exceed threshold"

**12. Regression guard**
- No Tier A source that previously returned >= 5 cards now returns 0 cards
- This check catches silent adapter breakage that might pass browse threshold if page returns just 1–4 items
- Failure message: "Regression detected — `{id}` previously stable, now returns 0 cards"

If all 12 checks pass: **SUITE PASS**  
If any check fails: **SUITE FAIL** — log the failing check and all relevant per-source data

### Exit Codes
- Exit code 0: SUITE PASS (all verdict checks pass)
- Exit code 1: SUITE FAIL (any verdict check fails)
- Exit code 2: Test infrastructure failure (Playwright crash, plugin bootstrap failure)

The test runner must call `process.exit(0|1|2)` explicitly.

---

## 6. Output Format

The test runner must produce the following output sections:

### Per-source line (Phase 2–4 combined)

```
[PASS/FAIL] [rangeOk] [videoOk] [id (padded to 18)]  cards:{n}  dur:{M:SS}  {streamUrl truncated to 52 chars}
```

Example:
```
PASS  206  meta  [analdin           ]  cards:100  dur:8:34  https://cherry-proxy.aawersom.workers…
PASS  N/A  N/A   [pornhub           ]  cards:30   dur:N/A   blob:https://...
FAIL  ---  ---   [xnxx              ]  cards:0    (expected: Tier D bot-blocked)
```

### Summary block

```
=== CHERRY E2E SUMMARY ===
Total sources : 26
Browse OK     : {n}/26
  Tier A      : {n}/12  (threshold: 12/12)
  Tier B      : {n}/9   (threshold: >=9/9)
  Tier C      : {n}/2   (threshold: 2/2)
  Tier D      : {n}/3   (expected 0/3)
Stream URL OK : {n}/{applicable}
  Tier A      : {n}/12  (threshold: 12/12)
  Tier B      : {n}/9   (threshold: >=7/9)
Range-206     : {n}/{applicable}
  Tier A      : {n}/10  (threshold: >=9/10)
Video meta    : {n}/{applicable}
  Tier A      : {n}/10  (threshold: >=9/10)
Playwright 206 intercepts: {n} URLs

VERDICT: PASS | FAIL
```

### Failure detail block (if FAIL)

Print all sources that contributed to failure, grouped by tier and check type.

---

## 7. Known Limitations (Documented, Not Bugs)

These are confirmed environmental constraints. They must appear in test output as `KNOWN LIMITATION` annotations, not as failures.

| Limitation | Affected sources | Detail |
|---|---|---|
| KVS signed token expiry | `porntrex`, `3movs`, `pornve`, `familyporn`, `ebun`, `perfektdamen`, `huyamba` | Token TTL ~30–60s. In real usage (immediate play), tokens never expire. In automated tests with sequential Range + video steps, expiry is possible. Mitigation: fresh `getStream()` immediately before video test. |
| bigcdn.cc CF IP block | `hqporner` | `sN.bigcdn.cc` returns 403/404 to all Cloudflare datacenter origin IPs. Not fixable at proxy or adapter level without a non-CF relay. |
| pornone IP-locked tokens | `pornone` | CDN token is tied to the requesting IP. CF Worker page-fetch and CDN-fetch may exit different CF PoPs → token mismatch → 403. Works in direct browser. |
| Cloudflare bot protection | `xnxx`, `eporner`, `spankbang` | Target site bot-protection blocks CF Worker IP ranges entirely. Adapter code is correct; browse returns 0 clean results (not exceptions). |
| pornhub blob URL | `pornhub` | `proxyM3u8` returns a `blob:` URL. Range-206 and `<video>` tests are N/A — mark as pass. |
| xvideos HLS | `xvideos` | Stream is HLS via `proxyM3u8`. If `getStream` returns a `blob:` URL, Range-206 and `<video>` tests are N/A. If `getStream` returns a raw `.m3u8` URL, Range-206 is N/A and video test is also N/A. |
| gayporntube slow CDN | `gayporntube` | Moved to Tier B due to slow CDN and intermittent token/timing issues. Browse and stream URL generation are mandatory; video/Range are best-effort. |
| lenporno host instability | `lenporno` | Host may be `www.lenporno.net` or `my.lenporno.live`; adapter may need update if host shifts. Track in Tier B flakiness, not as Tier A regression. |
| CF edge IP rotation | All Tier B | All Tier B proxy-side 403 responses are transient CF routing artifacts, not adapter bugs. |
| Lampa TV-mode loading screen | All | Lampa requires keyboard `Enter` input before app initializes. Test must simulate this or force `window.appready = true`. |
| Lampa plugin IndexedDB cache | All | Lampa caches plugins in IndexedDB and serves from cache, bypassing Playwright route interception. Test deletes `lampa_cache` before page load to force fresh plugin fetch. |

---

## 8. Interface Contracts (for Reference)

These are the exact interface contracts the test validates. Any deviation is a bug in the adapter.

### SourceAdapter (minimum required)

```typescript
interface SourceAdapter {
  id: string;           // adapter key, e.g. "pornhub"
  name: string;         // display name, e.g. "Pornhub"
  host: string;         // origin domain (informational)
  browse(query: string, page: number): Promise<BrowseResult>;
  getStream(card: VideoCard): Promise<StreamResult>;
}
```

### VideoCard (minimum required fields)

```typescript
interface VideoCard {
  id: string;       // non-empty; adapter-scoped unique identifier
  source: string;   // must equal adapter.id
  title: string;    // non-empty
  url: string;      // starts with "http://" or "https://"
  thumb?: string;   // may be empty string
  duration?: number;
  views?: number;
}
```

### BrowseResult

```typescript
interface BrowseResult {
  items: VideoCard[];
  total_pages: number;
}
```

### StreamResult

```typescript
interface StreamResult {
  url: string;                         // primary playback URL; may be "blob:..." for HLS
  quality: Record<string, string>;     // label → URL map; {} if single quality
}
```

### Proxy URL shape

```
GET https://cherry-proxy.aawersom.workers.dev/proxy
  ?url={encodeURIComponent(targetUrl)}
  &key=1206
  [&referer={encodeURIComponent(refererUrl)}]
```

Double-proxy guard: if `streamUrl` already starts with `https://cherry-proxy.aawersom.workers.dev`, use it as-is without re-wrapping.

Protocol-relative guard: if `streamUrl` starts with `//`, prepend `https:` before wrapping.

### bestQualityUrl algorithm

```javascript
function bestQualityUrl(quality) {
  const keys = Object.keys(quality);
  if (!keys.length) return '';
  const best = keys.reduce((a, b) =>
    parseInt(a, 10) >= parseInt(b, 10) ? a : b
  );
  return quality[best];
}
```

Edge case: if `parseInt(key, 10)` returns `NaN` for any key (e.g., keys like `'HD'`, `'SD'`), fall back to lexicographic string comparison. If all keys are non-numeric, the first key in insertion order is selected.

---

## 9. Regression Guard Detail

The regression guard (verdict check 12) is separate from the browse threshold check. Its purpose is to catch cases where an adapter returns a very small number of cards (1–4) rather than 0, which could still represent a broken adapter that passes the "any cards returned" check.

**Implementation:** Before the test run, load the last known good card counts from `tasks/cherry-e2e-baseline.json` (if it exists). After each run, if all tiers pass, update the baseline. If a Tier A source drops below 50% of its baseline count, log a warning even if it passes the minimum threshold.

Baseline file format:
```json
{
  "updated": "2026-05-26",
  "sources": {
    "pornhub": 30,
    "xvideos": 42,
    "analdin": 100,
    ...
  }
}
```

If the baseline file does not exist, skip the regression guard on first run and create it from the current run results.

---

## 10. Test File Locations

| File | Purpose |
|---|---|
| `D:\Works\Lampa\test\cherry-lampa-e2e.mjs` | Main E2E test runner (Playwright) |
| `D:\Works\Lampa\plugin.js` | Cherry plugin source (loaded by test for re-injection patching) |
| `D:\Works\Lampa\tasks\cherry-e2e-verify.spec.md` | This specification document |
| `D:\Works\Lampa\tasks\cherry-e2e-baseline.json` | Baseline card counts for regression guard (created on first passing run) |

Run command:
```
node test/cherry-lampa-e2e.mjs
```

Expected run time: approximately 8–15 minutes for all 26 sources at `CONCURRENCY=3` on a typical development machine with a good network connection to the CF Worker.
