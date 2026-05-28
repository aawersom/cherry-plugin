# Primer — Multi-Source Video Playback Fix

**For:** code-writer agents executing `multi-source-video-fix.plan.md`
**Grounded in:** actual code read from `plugin.js`, `test/plugin-helpers.test.js`, `test/cherry-lampa-e2e.mjs`

---

## 1. Adapter Structure Pattern

### Declaration

Every adapter is declared as an **anonymous object literal passed directly to `SOURCES.push()`**. There is no class, no factory, no constructor. The object is not assigned to a named variable before push — it is inline. Example from porndig (line 2671):

```js
SOURCES.push({
    id: 'porndig',
    name: 'Porndig',
    host: 'porndig.com',

    search: function (query, page) { ... },
    browse: function (category, page) { ... },
    getStream: function (video) { ... }
});
```

No adapter is accessible by name after push. Reference is always through `SOURCES.find(x => x.id === id)`.

### Indentation style

The outer-file-level adapters (Tier 1: pornhub, xvideos, eporner, spankbang, hqporner, youjizz) use **2-space indent**. The Tier-2 adapters (porndig onward) use **4-space indent**. Both styles exist and must be preserved when editing an existing adapter — do not normalize indentation.

### Card object (`VideoCard`) that `getStream` receives

Defined by JSDoc at line 117:
```js
// @property {string} id
// @property {string} source
// @property {string} title
// @property {string} thumb
// @property {string} url      ← full page URL, primary input to getStream
// @property {number} [duration]
// @property {number} [views]
```

Every adapter uses `video.url` as its fetch target. Some adapters also use `video.id` (eporner, hqporner uses the embed id parsed from the page). No adapter reads `video.title`, `video.thumb`, or `video.duration` inside `getStream`.

### `getStream` return contract (`StreamResult`)

```js
// @typedef {Object} StreamResult
// @property {string} url       — best stream URL; may be blob: for HLS
// @property {Object.<string,string>} quality  — e.g. { '1080p': 'https://...' }
```

Always returns `{ url: string, quality: Object }`. On failure: `{ url: '', quality: {} }`. Never `null`, never a bare string, never a Promise that rejects without catch.

Every `getStream` is wrapped in `.catch(function () { return { url: '', quality: {} }; })`.

### Helper functions are module-private

Card helpers like `_gayptCards`, `_gayptPages`, `_porndigCards`, `_ebunCards`, etc. are plain `function` declarations at the IIFE scope — not methods on the adapter. They are named with the pattern `_<adapterId>Cards` and `_<adapterId>Pages`. Shared utilities (`_attr`, `_decodeHtml`, `_splitCards`, `_kvsPickBest`) are similarly scoped.

### Source registration at end of file

The IIFE ends at line 3710 with `})();`. All adapter `SOURCES.push()` calls are inside this IIFE. The `SOURCES` array is declared at line 148 as an empty array, populated via push. There is NO separate registration step at the bottom — each adapter self-registers at declaration time. The last adapter (`gayporntube`) pushes at line 3634 and is immediately followed by its helper functions. The closing `})();` is at line 3710.

---

## 2. Core Helper Signatures (exact, from code)

### `buildProxyUrl(url, referer)` — lines 24–34

```js
function buildProxyUrl(url, referer) {
    var key = getProxyKey();
    var base = PROXY_URL;
    if (PROXY_URL_2) {
      try { if (PROXY_URL_2_HOSTS[new URL(url).hostname]) base = PROXY_URL_2; } catch (e) {}
    }
    var p = base + '/proxy?url=' + encodeURIComponent(url);
    if (key)     p += '&key=' + encodeURIComponent(key);
    if (referer) p += '&referer=' + encodeURIComponent(referer);
    return p;
}
```

- Picks `PROXY_URL_2` (Deno) if `PROXY_URL_2_HOSTS[hostname]` is truthy; otherwise uses `PROXY_URL` (CF Worker).
- Returns a **string** (never a Promise).
- `referer` is optional. When passed, appended as `&referer=encoded`.
- `PROXY_URL_2_HOSTS` at line 13: `{ 'xnxx.com': 1, 'www.xnxx.com': 1, 'spankbang.com': 1, 'www.spankbang.com': 1 }` — flat string-keyed object, values are truthy integers.

### `cherryFetch(url, referer)` — lines 37–42

```js
function cherryFetch(url, referer) {
    return fetch(buildProxyUrl(url, referer)).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
}
```

- Returns `Promise<string>` (HTML text).
- All proxy routing is delegated to `buildProxyUrl`.
- Throws on non-2xx so callers' `.catch()` handles failures.

### `extractStreams(html)` — lines 1214–1243

```js
function extractStreams(html) {
  var quality = {};
  var url = '';
  // ... detection branches ...
  return { url: url, quality: quality };
}
```

Returns `{ url: string, quality: Object.<string,string> }`. Never throws; returns `{ url: '', quality: {} }` on empty input.

### `bestQualityUrl(quality)` — lines 63–72

```js
function bestQualityUrl(quality) {
    var keys = Object.keys(quality || {});
    if (!keys.length) return '';
    var best = 0, bestUrl = '';
    keys.forEach(function (k) {
      var n = parseInt(k, 10) || 0;
      if (n > best) { best = n; bestUrl = quality[k]; }
    });
    return bestUrl || quality[keys[0]];
}
```

- For empty object: returns `''`.
- For numeric keys (`'720p'`, `'1080p'`): `parseInt` extracts the integer, highest wins.
- For non-numeric keys (e.g. `'mp4'`, `'hd'`): all parse to `0`, so `bestUrl` stays `''`, and falls back to `quality[keys[0]]` (first insertion-order key).
- **Critical implication:** a key like `'mp4'` is not selected by numeric comparison but IS returned as first-key fallback. The lenporno bug is: `'mp4'` as the only key → returns the mp4-labeled URL even though it's unqualified.

### `proxyM3u8(m3u8Url, referer)` — lines 82–108

Returns `Promise<string>` where the string is a `blob:` URL. Rewrites all non-comment lines of the m3u8: sub-playlists are recursively proxied (returning inner blob URLs), segments are wrapped via `buildProxyUrl`. The blob URL is pushed to `_blobUrls` for later revocation. Callers must `return proxyM3u8(...).then(function(blobUrl) { return { url: blobUrl, quality: {} }; })`.

### `px(u)` — lines 258–265 (inner function inside `playVideo`)

```js
function px(u) {
    if (!u) return u;
    if (u.indexOf('blob:') === 0) return u;
    if (u.indexOf(PROXY_URL) === 0) return u; // already proxied with custom referer — skip
    // Normalize protocol-relative URLs (e.g. YouJizz returns //cdne-mobile.youjizz.com/...)
    if (u.indexOf('//') === 0) u = 'https:' + u;
    return buildProxyUrl(u);
}
```

**CRITICAL for REQ-7-PRE:** `px()` currently has NO guard for `PROXY_URL_2`-prefixed URLs. A URL already proxied through Deno (returned by `buildProxyUrl` when hostname is in `PROXY_URL_2_HOSTS`) will be double-wrapped. The plan specifies adding this line AFTER the existing `PROXY_URL` guard:
```js
if (PROXY_URL_2 && u.indexOf(PROXY_URL_2) === 0) return u; // also skip Deno-proxied URLs
```
Insertion point: after line 261, before the `// Normalize` comment on line 263.

### `playVideo(video, source)` — lines 245–278

Flow:
1. `source.getStream(video)` — returns Promise<StreamResult>
2. `var url = bestQualityUrl(quality) || stream.url` — picks best URL from quality map
3. Calls `px()` on every quality URL and on `url`
4. Passes proxied object to `Lampa.Player.play({ title, url: px(url), poster, quality: proxiedQuality })`

The function is **frozen** except for the single `px()` guard insertion per REQ-7-PRE.

---

## 3. extractStreams — Current Pattern Inventory

The function at lines 1214–1243 runs these branches in order. Each populates either `quality` or `url`.

### Branch 1: KVS get_file (line 1219–1220)

```js
var kvs = html.match(/https?:\/\/[^"'\s]+get_file[^"'\s]+\.mp4[^"'\s]*/g);
if (kvs) kvs.forEach(function(u) { var q = (u.match(/(\d{3,4}p)/i) || ['', 'mp4'])[1]; quality[q] = u; });
```

- Matches: absolute `get_file` MP4 URLs anywhere in the page.
- Returns: populates `quality` with resolution label (or `'mp4'` if no resolution found in URL).
- Gap: overwrites existing key if duplicate label found (last-write wins for KVS).

### Branch 2: `<source src="..." label="...">` (lines 1222–1225)

Two regexes handle both attribute orderings:
- `srcRe`: `src` before `res/label/title` attribute
- `srcRe2`: `res/label/title` before `src`

Returns: populates `quality[m[2]] = m[1]` or `quality[m[1]] = m[2]`.

### Branch 3: JWPlayer/generic `'file': 'url'` (lines 1227–1228)

```js
var jwRe = /['"]file['"]\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))['"]/g;
while ((m = jwRe.exec(html)) !== null) { if (!url) url = m[1]; }
```

- Matches: first `"file": "..."` key-value pair.
- Returns: sets `url` to FIRST match only. **Does NOT populate `quality`.** The entire multi-quality `sources: [...]` array case is currently NOT handled — this is REQ-2's gap.
- Gap: only captures first match. If the page has a JWPlayer sources array with 3 entries, only the first file value is captured as `url`, and `quality` stays `{}`.

### Branch 4: Plain `<source src="...">` (lines 1230–1231)

```js
var plainRe = /<source\s[^>]*src="([^"]+\.(?:mp4|m3u8)[^"']*)"/gi;
while ((m = plainRe.exec(html)) !== null) { if (!url) url = m[1]; }
```

- Sets `url` to first match only; no quality.

### Branch 5: Any MP4 URL (lines 1233–1236)

```js
if (!url && !Object.keys(quality).length) {
    var any = html.match(/(?:https?:)?\/\/[^"'\s]+\.mp4[^"'\s]*/);
    if (any) url = any[0];
}
```

- Fallback only when both `url` and `quality` are empty.
- Can match `//` protocol-relative URLs.

### Final resolution (lines 1237–1241)

```js
if (!url && Object.keys(quality).length) url = quality[Object.keys(quality)[0]];
function fixProto(u) { return (u && u.slice(0, 2) === '//') ? 'https:' + u : u; }
url = fixProto(url);
Object.keys(quality).forEach(function(k) { quality[k] = fixProto(quality[k]); });
```

- If `quality` is populated but `url` is still empty, sets `url` to the FIRST quality entry (insertion order).
- Normalizes protocol-relative URLs.

### Known gap (REQ-2 target)

**JWPlayer `sources: [...]` array is NOT handled.** A page containing:
```js
sources: [
  { file: "https://cdn/.../1080.mp4", label: "1080p" },
  { file: "https://cdn/.../720.mp4",  label: "720p"  }
]
```
will only have the first `file` value captured by Branch 3 (as `url`), and `quality` will be `{}`. The REQ-2 fix inserts a new branch BEFORE Branch 3 (before line 1227) to parse the entire array.

---

## 4. Test Conventions

### Unit test file: `test/plugin-helpers.test.js`

- Framework: **vitest** (import `describe`, `it`, `expect` from `'vitest'`).
- Package.json `"type": "module"` — tests are ES modules.
- **Critical pattern:** helper functions are **inlined as copies** at the top of the test file. The test file does NOT import from `plugin.js` (it's a browser IIFE, not a module). Functions are copy-pasted verbatim.
- When `plugin.js` gains a new branch in `extractStreams`, the **test file's copy of `extractStreams` (lines 40–60) must be updated to match**.
- Test structure:

```js
describe('functionName', () => {
  it('describes behavior', () => {
    const r = functionName(input);
    expect(r.field).toBe(expectedValue);
  });
});
```

- No `beforeEach`, no module mocking at the describe level. Each test constructs its own input inline.
- No `global.cherryFetch` mock currently exists — the test file doesn't mock network calls. Tests that exercise adapter-internal logic that calls `cherryFetch` must inline the body of interest as a pure function (extracting just the regex/parsing logic from `getStream`, not the network call).
- Assertions use `.toBe()`, `.toEqual()`, `.toContain()`, `.toHaveLength()`, `.toBeDefined()`.

### How to add a new unit test

1. If testing a new branch of `extractStreams`: update the inlined copy of `extractStreams` in the test file (lines 40–60) to match `plugin.js`.
2. Add a `describe` block or add `it()` cases inside an existing `describe('extractStreams', ...)` block.
3. Input is always a raw HTML string literal constructed inline.
4. Never read fixtures from disk in the existing unit test style — all inputs are inline strings. (Fixture-file-based tests described in the plan for adapter getStream bodies would be a new pattern, using `readFileSync` from `'fs'` — that import does not yet exist in the test file and must be added.)

### E2E test file: `test/cherry-lampa-e2e.mjs`

- Runs via `node test/cherry-lampa-e2e.mjs` (not vitest — it is a standalone Playwright ES module script).
- Uses **Playwright** `chromium` to open real `http://lampa.mx/`, inject the plugin, and call adapter methods inside the browser page via `page.evaluate()`.
- **Baseline** at `tasks/cherry-e2e-baseline.json` is schema version 2:
  ```json
  { "version": 2, "updated": "YYYY-MM-DD", "sources": { "pornhub": { "cardsCount": 30 } } }
  ```
  Only tier-A sources appear in the baseline. `cardsCount` is the only field. The baseline is read to detect card-count regressions; it does NOT store stream URLs or quality keys.
- Source tier mapping (line 32–39):
  - **A**: pornhub, xvideos, youjizz, xozilla, analdin, porndig, tizam, hellporno, pornobolt, crocotube, 24rolika, jopaonline (12 sources)
  - **B**: porntrex, 3movs, pornve, familyporn, ebun, perfektdamen, huyamba, lenporno, gayporntube (9 sources — `gayporntube` is at index 8 in the array, the one to be removed)
  - **C**: hqporner, pornone
  - **D**: xnxx, eporner, spankbang
- The E2E hardcodes `sourcesLength !== 26` as an exit-2 check (line 692). After removing `gayporntube`, this must become `!== 25`.
- The E2E `buildProxyUrl` helper (line 58–63) hardcodes `PROXY_BASE` (CF Worker only). It does NOT currently mirror `PROXY_URL_2_HOSTS`. The plan's REQ-8 adds `wrapLikePxHelper` to mirror the full routing logic.

### Test runner commands

- Unit tests: `npx vitest run test/plugin-helpers.test.js` (single file) or `npx vitest run` (all).
- E2E: `node test/cherry-lampa-e2e.mjs` (requires network + Playwright browsers installed).

---

## 5. gayporntube Deletion Scope

### Exact line ranges in plugin.js

- **Comment + SOURCES.push block:** lines 3633–3661
  - Line 3633: `// ---- 18. GayPornTube ----`
  - Line 3634: `SOURCES.push({`
  - Line 3661: `});` (closing brace of the pushed object)
- **`_gayptCards` function:** lines 3663–3696
  - Line 3663: `function _gayptCards(html) {`
  - Line 3696: closing `}`
- **`_gayptPages` function:** lines 3698–3708
  - Line 3698: `function _gayptPages(html) {`
  - Line 3708: closing `}`

Total deletion: lines 3633–3708 inclusive (a blank line separates each block). After deletion, line 3709 (``) and line 3710 (`})();`) become the final two lines.

### References outside plugin.js

Found via grep:
1. `test/cherry-lampa-e2e.mjs` line 36: `'huyamba','lenporno','gayporntube'` — `'gayporntube'` is the last element of the tier-B array.
2. `docs/CHERRY.md` lines 203 and 254 — documentation references, should be updated.
3. `test/cherry-lampa-e2e.bak.2026-05-28.mjs` line 36 — a backup file, can be left as-is.
4. `tasks/cherry-e2e-baseline.json` — **gayporntube does NOT appear** (confirmed: baseline only contains tier-A sources; gayporntube is tier B).
5. The plan and spec files reference it — those are documentation, not code.

### Source registration

The adapter is registered via inline `SOURCES.push(...)` at its declaration site (line 3634). It is NOT referenced by a variable name anywhere else. Deleting lines 3633–3708 removes both the registration and all helper code. No other code references `_gayptCards` or `_gayptPages`.

### E2E count guard

After deletion: change the E2E check at line 691–695:
```js
if (sourcesLength !== 26) {   // → change to !== 25
```
And the Check 1 verdict at line 528–530:
```js
if (sourcesLength !== 26) {   // → change to !== 25
```
And summary line 639:
```js
console.log(`Browse OK     : ${bAll}/26`);  // → /25
```
And summary line 644 (tier D expected 0/3 count stays).

---

## 6. Naming Conventions

### Variable names and style

- Adapter objects: not assigned to a named variable. They are anonymous object literals inside `SOURCES.push({...})`.
- Helper functions: `_<adapterId>Cards(html)`, `_<adapterId>Pages(html)` — underscore prefix, camelCase adapter id.
- Shared module-scope helpers: camelCase, no underscore prefix (`bestQualityUrl`, `buildProxyUrl`, `cherryFetch`, `proxyM3u8`, `extractStreams`, `_kvsPickBest` — note `_kvsPickBest` has the underscore because it's a shared-but-private utility).

### Callback style

All async code uses **callbacks and `.then()/.catch()` chains** — no `async/await` in `plugin.js`. This is a browser IIFE that must run in older environments. New code must follow the same pattern.

### String concatenation vs template literals

`plugin.js` uses **string concatenation** (`'https://foo.com/' + id + '/'`) throughout. Template literals are NOT used in the plugin file. The E2E and test files (ES modules) use template literals freely.

### `var` vs `let/const`

`plugin.js` uses `var` exclusively. No `let` or `const` in the plugin. The test file and E2E file use `const`/`let`.

### `return` at end of adapter functions

Every `getStream` ends with a `return somePromise` or `return { url: '', quality: {} }`. Adapters always return a value — no implicit `undefined` returns. Branches that fail always return `.catch(function () { return { url: '', quality: {} }; })`.

---

## 7. Phase 0 Implementation Notes

### REQ-1: gayporntube deletion

**Exact edits:**

1. **plugin.js**: Delete lines 3633–3708 inclusive. The blank line at 3632 (before `// ---- 18. GayPornTube ----`) may be left in place. After deletion, the file should end with `})();` on the last line.

2. **test/cherry-lampa-e2e.mjs** line 36: Change:
   ```js
   'huyamba','lenporno','gayporntube'],
   ```
   to:
   ```js
   'huyamba','lenporno'],
   ```

3. **test/cherry-lampa-e2e.mjs** lines 528 and 691–695: Change all `!== 26` to `!== 25` and all `/26` display strings to `/25`.

4. **tasks/cherry-e2e-baseline.json**: No change needed — `gayporntube` is not present (it's tier B, baseline only covers tier A).

5. Sanity check: `Grep -n gayporntube plugin.js test/` returns zero matches.

### REQ-7-PRE: px() guard

**Insertion point**: `plugin.js` line 261 (the line `if (u.indexOf(PROXY_URL) === 0) return u;`). Insert AFTER this line, before the comment on line 262/263:

```js
if (PROXY_URL_2 && u.indexOf(PROXY_URL_2) === 0) return u; // also skip Deno-proxied URLs
```

The function `px()` after the edit:
```js
function px(u) {
    if (!u) return u;
    if (u.indexOf('blob:') === 0) return u;
    if (u.indexOf(PROXY_URL) === 0) return u;         // already proxied — skip
    if (PROXY_URL_2 && u.indexOf(PROXY_URL_2) === 0) return u; // also skip Deno-proxied URLs
    // Normalize protocol-relative URLs
    if (u.indexOf('//') === 0) u = 'https:' + u;
    return buildProxyUrl(u);
}
```

This is the ONLY permitted edit to `playVideo()`.

### REQ-2: extractStreams JWPlayer sources array branch

**Insertion point**: before line 1227 (the `var jwRe = ...` line). The new code inserts between lines 1225 and 1226 (after the `srcRe2` while-loop closes, before `jwRe`).

**What to insert** (inline function + array scan — declared inside `extractStreams` scope):

```js
// --- NEW: JWPlayer sources:[...] array multi-quality branch ---
function findMatchingBracket(str, openIdx, openCh, closeCh) {
    // Precondition: str[openIdx] === openCh
    var depth = 0, inStr = false, strCh = '';
    for (var i = openIdx; i < str.length; i++) {
        var c = str[i];
        if (inStr) {
            if (c === strCh) {
                var bs = 0;
                for (var j = i - 1; j >= 0 && str[j] === '\\'; j--) bs++;
                if (bs % 2 === 0) inStr = false; // even backslashes = real close quote
            }
            continue;
        }
        if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
        if (c === openCh || c === '{' || c === '[') { depth++; continue; }
        if (c === closeCh || c === '}' || c === ']') {
            if (--depth === 0) return i;
        }
    }
    return -1;
}
var srcArrayM = /sources\s*:\s*\[/i.exec(html);
if (srcArrayM) {
    var arrOpen = html.indexOf('[', srcArrayM.index + srcArrayM[0].length - 1);
    if (arrOpen !== -1) {
        var arrClose = findMatchingBracket(html, arrOpen, '[', ']');
        if (arrClose !== -1) {
            var block = html.slice(arrOpen + 1, arrClose);
            var fileRe2  = /['"]file['"]\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))['"]/i;
            var labelRe2 = /['"]label['"]\s*:\s*['"]([^'"]+)['"]/i;
            var bi = 0;
            while (bi < block.length) {
                var objStart = block.indexOf('{', bi);
                if (objStart === -1) break;
                var objEnd = findMatchingBracket(block, objStart, '{', '}');
                if (objEnd === -1) break;
                var obj = block.slice(objStart, objEnd + 1);
                var fm2 = fileRe2.exec(obj);
                var lm2 = labelRe2.exec(obj);
                if (fm2 && lm2 && !quality[lm2[1]]) quality[lm2[1]] = fm2[1];
                bi = objEnd + 1;
            }
        }
    }
}
// --- END new branch ---
```

**Note on findMatchingBracket**: The plan specifies a simplified version that uses a separate open/close pair per call. The above implementation uses the depth approach slightly differently — the key requirement is that `str[openIdx] === openCh`, depth starts at 0, depth increments on opener, returns when depth reaches 0 again. The backslash-parity escape rule (the `bs % 2 === 0` check) is mandatory per the plan.

**IMPORTANT**: The test file's inlined `extractStreams` (lines 40–60) must receive the identical new branch. Since `findMatchingBracket` is declared INSIDE `extractStreams`, it automatically goes into the test copy — no extra work needed as long as the copy matches.

**Scope constraint from plan**: `findMatchingBracket` MUST be declared as a local `function` inside `extractStreams`, not at module/IIFE scope. This is already reflected above.

**What does NOT change**: The `jwRe` while-loop (Branch 3), the `plainRe` loop, the `any` fallback, and the final `if (!url && Object.keys(quality).length) url = quality[...]` line all stay unchanged. The new branch is purely additive.

**Back-compat invariant**: If the sources array branch populates `quality`, the legacy `jwRe` scan will also fire and may set `url` to the first file value. That's acceptable — `url` may be set to the first-listed source while `quality` has all entries. Adapters that need best quality must call `bestQualityUrl(result.quality)` themselves (per REQ-3).

---

## Appendix: Quick Reference

| Thing | Location |
|---|---|
| `PROXY_URL` (CF Worker) | `plugin.js:10` |
| `PROXY_URL_2` (Deno) | `plugin.js:12` |
| `PROXY_URL_2_HOSTS` map | `plugin.js:13` |
| `buildProxyUrl` | `plugin.js:24–34` |
| `cherryFetch` | `plugin.js:37–42` |
| `bestQualityUrl` | `plugin.js:63–72` |
| `proxyM3u8` | `plugin.js:82–108` |
| `SOURCES` array declaration | `plugin.js:148` |
| `playVideo` / `px()` | `plugin.js:245–278` |
| `extractStreams` | `plugin.js:1214–1243` |
| `_kvsPickBest` | `plugin.js:1307–1327` |
| pornhub adapter | `plugin.js:1330–1424` |
| eporner adapter | `plugin.js:1614–1671` |
| hqporner adapter getStream | `plugin.js:1876–1911` |
| pornone adapter getStream | `plugin.js:2085–2104` |
| porndig adapter | `plugin.js:2671–2706` |
| tizam adapter | `plugin.js:2838–2852` |
| perfektdamen adapter | `plugin.js:2878–2883` |
| huyamba adapter | `plugin.js:3255–3269` |
| ebun adapter | `plugin.js:3332–3343` |
| lenporno adapter | `plugin.js:3406–3427` |
| 24rolika adapter | `plugin.js:3490–3499` |
| gayporntube adapter + helpers | `plugin.js:3633–3708` |
| IIFE closing `})();` | `plugin.js:3710` |
| Unit test inlined `extractStreams` | `test/plugin-helpers.test.js:40–60` |
| E2E tier B array (gayporntube) | `test/cherry-lampa-e2e.mjs:36` |
| E2E source count check `!== 26` | `test/cherry-lampa-e2e.mjs:528, 691` |
| Baseline format | `tasks/cherry-e2e-baseline.json` (v2, tier-A only) |
