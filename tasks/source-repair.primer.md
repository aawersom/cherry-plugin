# Source-Repair Primer — Cherry Plugin

Code-writer reference. Actionable only. Line numbers verified against current plugin.js.

---

## 1. File layout and editing workflow

**Main file:** `D:\Works\Lampa\plugin.js` (~3700 lines, single-file IIFE)
- Starts: `(function () {` line 1, `'use strict';` line 2
- Ends: closing `}());` near line 3700

**Release copy:** `D:\Works\Lampa\plugin-release\plugin.js`
- NOT compiled — it is a manual copy of plugin.js
- Must be kept byte-identical after each phase
- Sync command: `fc "D:\Works\Lampa\plugin.js" "D:\Works\Lampa\plugin-release\plugin.js"`
- Copy command: `copy /Y "D:\Works\Lampa\plugin.js" "D:\Works\Lampa\plugin-release\plugin.js"`

**Run unit tests:**
```
cd D:\Works\Lampa && npx vitest run
```
(script alias: `npm test`)

**Run E2E test (Playwright, real browser):**
```
node D:\Works\Lampa\test\cherry-lampa-e2e.mjs
```

---

## 2. PROXY_URL_2_HOSTS — location and structure

**plugin.js lines 13–26:**
```javascript
var PROXY_URL_2_HOSTS = {
  'xnxx.com': 1, 'www.xnxx.com': 1,
  'spankbang.com': 1, 'www.spankbang.com': 1,
  'www.pornhub.com': 1,
  'www.youjizz.com': 1, 'youjizz.com': 1,
  'tv4.tizam.org': 1,
  's1.bigcdn.cc': 1, 's4.bigcdn.cc': 1, 's16.bigcdn.cc': 1, 's25.bigcdn.cc': 1,
  's30.bigcdn.cc': 1, 's33.bigcdn.cc': 1, 's38.bigcdn.cc': 1, 's39.bigcdn.cc': 1,
  's41.bigcdn.cc': 1, 's43.bigcdn.cc': 1, 's47.bigcdn.cc': 1, 's50.bigcdn.cc': 1,
  's61.bigcdn.cc': 1
};
```

**E2E mirror:** `D:\Works\Lampa\test\cherry-lampa-e2e.mjs` lines 30–40 (`const PROXY_URL_2_HOSTS = { ... }`)

**Sync-check test:** `D:\Works\Lampa\test\plugin-helpers.test.js` line 724
- Test name: `'PROXY_URL_2_HOSTS: plugin.js and E2E test have identical host sets'`
- Reads both files via regex, compares key sets with `expect(e2eHosts).toEqual(pluginHosts)`
- Will FAIL if plugin.js and e2e.mjs diverge — update BOTH files together

If SpankBang moves to `ru.spankbang.com`, add `'ru.spankbang.com': 1` to BOTH files.

---

## 3. Shared helpers used by adapters

All defined in lines 37–120 of plugin.js.

| Helper | Signature | Notes |
|--------|-----------|-------|
| `buildProxyUrl(url, referer)` | `(string, string?) → string` | Selects PROXY_URL_2 if hostname is in PROXY_URL_2_HOSTS; appends `&key=` and `&referer=` |
| `cherryFetch(url, referer)` | `(string, string?) → Promise<string>` | `fetch(buildProxyUrl(url,referer))` → `.text()`; throws on non-ok |
| `cherryPost(url, body)` | `(string, string) → Promise<string>` | POST via `buildProxyUrl(url)`, body is `application/x-www-form-urlencoded` |
| `proxyM3u8(url, referer)` | `(string, string?) → Promise<string>` | Fetches m3u8 via proxy, rewrites segment/sub-playlist lines → returns blob URL |
| `bestQualityUrl(quality)` | `(Object<string,string>) → string` | Returns URL for highest numeric key (e.g. `'1080p'`); falls back to first key |
| `extractStreams(html)` | `(string) → {url, quality}` | Generic multi-pattern fallback: KVS get_file, `<source>` tags, JWPlayer sources array — lines 1228–1320 |

**`_apiFetch(url)`** — Eporner-only method (lines 1679–1685):
- `fetch(url)` DIRECTLY — no proxy, no key
- Eporner API returns `Access-Control-Allow-Origin: *` so direct fetch works from browser
- Do NOT replace with `cherryFetch` for browse/search (API endpoints)
- For `getStream`, the page fetch (`/hd-porn/{id}/`) goes through `_apiFetch` — this is the broken part (Cloudflare blocks page fetches)

---

## 4. Adapter locations — exact lines

### SpankBang — lines 1749–1853

| Section | Lines | Current broken behavior |
|---------|-------|------------------------|
| Adapter start | 1749 (`// ---- Spankbang ----`) | — |
| `_parseCards` | 1755–1791 | Card splitter regex `video[_-]item` may not match ru.spankbang.com HTML class names; `videoUrl` uses `spankbang.com` hardcoded |
| `search` | 1806–1815 | URL base: `https://spankbang.com/s/` — should be `ru.spankbang.com` |
| `browse` | 1818–1826 | URL base: `https://spankbang.com/new/` — should be `ru.spankbang.com` |
| `getStream` | 1829–1852 | POST to `https://spankbang.com/api/videos/stream`; quality map uses raw string keys (`'1080p'`, `'720p'`) not numeric labels; no bestQualityUrl call |

Specific fixes needed:
- `browse`/`search` URL base: `spankbang.com` → `ru.spankbang.com`
- `_parseCards` `hrefMatch` regex — confirm it matches ru.spankbang.com class names
- `videoUrl` construction (line 1764): `'https://spankbang.com/'` → `'https://ru.spankbang.com/'`
- `getStream` POST URL (line 1836): `'https://spankbang.com/api/videos/stream'`  → `'https://ru.spankbang.com/api/videos/stream'`
- `getStream` quality map `best` (line 1845): replace hardcoded `q['1080p'] || q['720p'] || ...` with `bestQualityUrl(q)`

### PornHub — lines 1388–1484

| Section | Lines | Current broken behavior |
|---------|-------|------------------------|
| Adapter start | ~1388 (no `SOURCES.push` visible — inline push around line 1388) | — |
| `_mapVideo` | 1395–1409 | OK |
| `search` | 1412–1422 | OK |
| `browse` | 1425–1435 | OK |
| `getStream` | 1438–1483 | Fetches `video.url` which is a `view_video.php?viewkey=xxx` page URL — returns full HTML; flashvars regex may not match embed page format |

Fix: In `getStream`, replace `video.url` page fetch with embed URL:
- Extract `viewkey` from `video.url` (already done in `_mapVideo` line 1399 — `id` IS the viewkey)
- Fetch `'https://www.pornhub.com/embed/' + video.id` instead of `video.url`

### Eporner — lines 1673–1747

| Section | Lines | Current broken behavior |
|---------|-------|------------------------|
| Adapter start | 1673 (`// ---- Eporner ----`) | — |
| `_apiFetch` | 1679–1685 | Direct fetch — correct for API endpoints |
| `_mapVideo` | 1687–1697 | Stale fallback URL: `v.url \|\| ('https://www.eporner.com/hd-porn/' + v.id + '/')` — if API omits `v.url`, fallback works; check if API response has changed |
| `search` | 1699–1707 | Uses `_apiFetch` — correct (CORS open API) |
| `browse` | 1710–1718 | Uses `_apiFetch` — correct |
| `getStream` | 1721–1746 | Line 1725: `self._apiFetch(pageUrl)` fetches video page DIRECTLY — Cloudflare blocks datacenter IPs for `/hd-porn/` page HTML; should use `cherryFetch(pageUrl)` |

Fix: line 1725 — change `self._apiFetch(pageUrl)` → `cherryFetch(pageUrl)`.
Note: `_mapVideo` stale URL: if `v.url` is null/empty, fallback constructs correct URL — verify API still returns `v.url`; if not, fix fallback pattern.

### PornOne — lines 2097–2181

| Section | Lines | Current broken behavior |
|---------|-------|------------------------|
| Adapter start | 2097 (`// ---- 15. PornOne ----`) | — |
| `_fromApi` | 2104–2121 | OK |
| `search` | 2123–2138 | OK |
| `browse` | 2141–2158 | OK |
| `getStream` | 2161–2180 | Line 2170/2172: `buildProxyUrl(url, 'https://pornone.com/')` — CDN routing uses PROXY_URL by default; if CDN hostnames need PROXY_URL_2, they must be in PROXY_URL_2_HOSTS |

Fix: Add pornone CDN hostnames to `PROXY_URL_2_HOSTS` (both plugin.js lines 13–26 AND e2e.mjs lines 30–40) so `buildProxyUrl` automatically routes via Deno proxy.
- The conditional is: `if (PROXY_URL_2_HOSTS[hostname]) base = PROXY_URL_2` (line 41)
- No code change in getStream itself — only PROXY_URL_2_HOSTS update needed

### xnxx — lines 1581–1671

| Section | Lines | Current broken behavior |
|---------|-------|------------------------|
| Adapter start | 1581 | — |
| `_parseCards` | 1585–1628 | OK |
| `search` | 1630–1639 | OK |
| `browse` | 1642–1650 | OK |
| `getStream` | 1652–1670 | Lines 1654–1656: html5player regex pattern — matches `html5player.setVideoHLS(...)` but actual xnxx HTML uses bare `setVideoHLS(...)` without `html5player.` prefix on some pages (conditional on gate/CDN variant) |

Fix: The regex already has `(?:html5player\.)?` making the prefix optional — verify this actually fires against live HTML. The fix may be adjusting the regex or falling back to `extractStreams`.

---

## 5. ES5 constraints (IIFE is `'use strict'`)

- `var` only — no `const`, `let`
- No arrow functions — use `function(x) { return ...; }`
- No template literals — use `'string' + var + 'string'`
- No `async`/`await` — use `.then(function() {}).catch(function() {})`
- No `class` — use object literals or constructor functions
- Function expressions inside callbacks: use `var fn = function() {}` not `function fn() {}` inside blocks
- `Object.keys(obj).forEach(function(k) { ... })` for iteration
- String concatenation for URL building: `'https://ru.spankbang.com/' + id + '/video/'`

---

## 6. Commit discipline

- Do NOT push to remote (`git push` is forbidden until explicitly requested)
- After each phase's tests pass:
  1. `copy /Y "D:\Works\Lampa\plugin.js" "D:\Works\Lampa\plugin-release\plugin.js"`
  2. Verify: `fc "D:\Works\Lampa\plugin.js" "D:\Works\Lampa\plugin-release\plugin.js"`
  3. Stage both files: `git add plugin.js plugin-release/plugin.js`
- If PROXY_URL_2_HOSTS changes: also stage `test\cherry-lampa-e2e.mjs` and verify `npx vitest run` passes the sync-check test (plugin-helpers.test.js line 724)
- Commit message format: `fix(adapter): <source> — <what changed>` (lowercase, imperative)
