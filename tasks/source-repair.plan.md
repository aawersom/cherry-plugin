# source-repair — Implementation Plan

Mode: FULL
Spec: tasks/source-repair.spec.md
Arch brief: tasks/source-repair.task.arch-brief.md
Patterns: tasks/source-repair.patterns.md

---

## Prerequisites

Run these gate checks before touching any code. Record the outcome (PASS/FAIL + observed values) in a comment at the top of each affected phase. Do not proceed to a phase until its gate has a recorded result.

### GATE-1: ru.spankbang.com reachability (blocks REQ-1, REQ-2, SpankBang portion of REQ-5)

```
curl "https://cherry-proxy.aawersom.deno.net/proxy?url=https%3A%2F%2Fru.spankbang.com%2Fnew%2F1%2F&key=1206" \
  -s -o /tmp/sb_page1.html -w "%{http_code} %{size_download}"
grep -c "js-video-item" /tmp/sb_page1.html

curl "https://cherry-proxy.aawersom.deno.net/proxy?url=https%3A%2F%2Fru.spankbang.com%2Fnew%2F2%2F&key=1206" \
  -s -o /tmp/sb_page2.html -w "%{http_code} %{size_download}"
grep -c "js-video-item" /tmp/sb_page2.html
```

PASS condition: both requests return HTTP 200, size > 400000, and grep count >= 20 on both pages.

FAIL action: remove REQ-1, REQ-2, and the SpankBang portion of REQ-5 from scope. Update Phase 1 to only add `www.eporner.com`. Update Phase 4 entirely to a no-op. Update Phase 7 (docs) to record `ru.spankbang.com` as also challenge-gated.

Also verify search URL while you have the terminal open — this addresses OQ-1:

```
curl "https://cherry-proxy.aawersom.deno.net/proxy?url=https%3A%2F%2Fru.spankbang.com%2Fs%2Fteen%2F1%2F&key=1206" \
  -s -o /tmp/sb_search.html -w "%{http_code} %{size_download}"
grep -c "js-video-item" /tmp/sb_search.html
```

If the search path differs on `ru.`, adjust the `search` method URL template in Phase 4 accordingly.

### GATE-2a: Eporner CF Worker failure confirmation (informs REQ-5 scope)

```
curl "https://cherry-proxy.aawersom.workers.dev/proxy?url=https%3A%2F%2Fwww.eporner.com%2Fvideo-1V4KRKD8lT0%2F&key=1206" \
  -s -o /tmp/ep_cfworker.html -w "%{http_code} %{size_download}"
wc -c /tmp/ep_cfworker.html
```

PASS (CF Worker fails): size < 5000 OR HTTP != 200. Proceed with adding `www.eporner.com` to `PROXY_URL_2_HOSTS` in Phase 1.

FAIL (CF Worker works): size > 50000 AND HTTP 200. Drop `www.eporner.com` from Phase 1's `PROXY_URL_2_HOSTS` addition. In Phase 2, switch `_apiFetch` calls to `cherryFetch` without adding the hostname — CF Worker routing will apply automatically.

### GATE-3: pornone CDN hostname and Deno reachability (blocks REQ-8, Phase 5)

```
# Step 1 — find the CDN hostname from a live page
curl "https://cherry-proxy.aawersom.workers.dev/proxy?url=https%3A%2F%2Fpornone.com%2F&key=1206" \
  -s | grep -oE 'https://[^"'"'"' ]+\.(mp4|m3u8)[^"'"'"' ]*' | head -5

# Step 2 — test a real CDN URL through Deno (replace <CDN_URL_encoded> with actual)
curl -I "https://cherry-proxy.aawersom.deno.net/proxy?url=<CDN_URL_encoded>&key=1206"
```

PASS: CDN hostname identified AND Deno returns HTTP 200 or 206 with Content-Type: video/*. Record the CDN hostname and proceed to Phase 5 using Strategy B (pornone.com + CDN both in PROXY_URL_2_HOSTS — see pattern scan recommendation).

FAIL: CDN also returns 403 via Deno. Document pornone as Tier C infrastructure-blocked in docs/CHERRY.md. Phase 5 becomes a docs-only update, no code change.

### GATE-4: xnxx extractStreams current result (blocks REQ-9, Phase 6)

```
# Run E2E for xnxx only — check stream result in output
node test/cherry-lampa-e2e.mjs 2>&1 | grep -A5 "xnxx"
```

PASS (extractStreams already works): xnxx stream URL is non-empty and the HEAD check returns HTTP 200/206. Mark REQ-9 as skipped in Phase 6.

FAIL: xnxx stream is empty or only a low-quality MP4 URL. Proceed with Phase 6 implementation.

---

## Phases

> **INV-5 sync discipline**: Each phase performs a `plugin-release/plugin.js` sync immediately after its `npm test` gate passes. This per-phase sync is the authoritative mechanism. REQ-7 (Phase 7) is a verification checkpoint — it confirms the sync was done correctly throughout, not the only sync point. If Phase 8's `fc` entry gate finds a difference, it means a per-phase sync was missed and must be fixed before running E2E.

---

### Phase 0: Gate verification (pre-work, no code)

**Files changed**: none

**What to implement**: Run GATE-1, GATE-2a, GATE-3, and GATE-4 as documented above. Record each result. Write the results in a scratch comment (or keep notes) before opening any source file. This phase exists so the implementer has all decisions made before touching code, eliminating mid-implementation surprises.

**Success criteria**: All four gates have a recorded PASS or FAIL verdict. No code has been written.

**plugin-release sync**: not applicable.

---

### Phase 1: PROXY_URL_2_HOSTS update (REQ-5)

**Files changed**:
- `D:\Works\Lampa\plugin.js`
- `D:\Works\Lampa\plugin-release\plugin.js`
- `D:\Works\Lampa\test\cherry-lampa-e2e.mjs`

**What to implement**:

Spec reference: REQ-5 (lines 426–468 of spec).

Edit `plugin.js` lines ~13–26. The current `PROXY_URL_2_HOSTS` block has:

```javascript
'spankbang.com': 1, 'www.spankbang.com': 1,
```

Make the following changes:

1. **Remove** `'spankbang.com': 1, 'www.spankbang.com': 1,` — these entries route the JS-challenge-gated main domain through Deno, which fails anyway and wastes Deno quota.

2. **Add** `'ru.spankbang.com': 1,` with the comment below. (Conditional on GATE-1 PASS. If GATE-1 failed, skip this addition entirely.)

   ```javascript
   // ru.spankbang.com has lower CF security level than www — may break if site enables Bot Fight Mode
   'ru.spankbang.com': 1,
   ```

3. **Add** `'www.eporner.com': 1,` with comment. (Conditional on GATE-2a confirming CF Worker fails. If GATE-2a shows CF Worker works, skip this addition.)

   ```javascript
   // eporner.com — CF Worker returns 369B obfuscated JS redirect for video pages; Deno returns real page
   'www.eporner.com': 1,
   ```

   Insert after the `tv4.tizam.org` line (logical grouping: domain-specific blocks before the bigcdn.cc block).

4. Update the inline comment on line 11 of `plugin.js`:

   ```javascript
   // BEFORE
   // Secondary proxy on Deno Deploy — used for sites that block Cloudflare datacenter IPs (xnxx, spankbang)

   // AFTER
   // Secondary proxy on Deno Deploy — used for sites that block Cloudflare datacenter IPs (xnxx, ru.spankbang.com, eporner video pages)
   ```

   Adjust the parenthetical to reflect only the entries that are actually present after the changes above.

Apply the **identical domain changes** to `test/cherry-lampa-e2e.mjs` lines ~30–40 (the `PROXY_URL_2_HOSTS` constant there is a mirror). Every domain added to or removed from `plugin.js` must be added to or removed from the E2E mirror in the same commit.

**Architecture invariant check**:
- INV-3: PROXY_URL_2_HOSTS is the only permitted routing mechanism. This phase only edits that map — correct.
- INV-4: No new module-scope variables introduced.
- INV-1: SOURCES.length unchanged.

**Success criteria**:

Run the unit test suite:
```
cd D:\Works\Lampa && npm test
```

The `plugin-helpers.test.js` sync-check assertion (`PROXY_URL_2_HOSTS` mirror parity) must exit 0. Additionally verify manually:

- `buildProxyUrl('https://ru.spankbang.com/abc/video/')` — resulting URL starts with `https://cherry-proxy.aawersom.deno.net` (if GATE-1 passed).
- `buildProxyUrl('https://spankbang.com/abc/video/')` — resulting URL starts with `https://cherry-proxy.aawersom.workers.dev`.
- `buildProxyUrl('https://www.eporner.com/video-123/slug/')` — resulting URL starts with `https://cherry-proxy.aawersom.deno.net` (if GATE-2a showed CF Worker fails).

**plugin-release sync** (INV-5): After confirming `npm test` passes, run:
```
copy "D:\Works\Lampa\plugin.js" "D:\Works\Lampa\plugin-release\plugin.js"
```
Then verify:
```
fc "D:\Works\Lampa\plugin.js" "D:\Works\Lampa\plugin-release\plugin.js"
```
Expected: "FC: no differences encountered".

---

### Phase 2: Eporner getStream + _mapVideo (REQ-4)

**Files changed**:
- `D:\Works\Lampa\plugin.js`
- `D:\Works\Lampa\plugin-release\plugin.js`

**What to implement**:

Spec reference: REQ-4 (lines 339–421 of spec).

Locate the `eporner` adapter's `getStream` method in `plugin.js`. Make three targeted changes:

**Change 1 — getStream: switch from `_apiFetch` to `cherryFetch`, use `video.url` as page URL**

Replace the current `getStream` body. The new implementation:
- Uses `video.url` directly as `pageUrl` (the API's `v.url` already returns the correct `/video-{id}/{slug}/` format — this also addresses OQ-3: if the XHR URL uses `video.id`, that field comes from `_mapVideo` which sets it from `v.id`, unchanged).
- Calls `cherryFetch(pageUrl)` instead of `self._apiFetch(pageUrl)` for the HTML page fetch.
- Calls `cherryFetch(xhrUrl)` instead of `self._apiFetch(xhrUrl)` for the XHR endpoint.
- Retains the hash extraction regex, hash computation, XHR URL construction, and JSON parsing logic exactly as they exist today — only the fetch calls change.
- The `var id = video.id;` variable and the hardcoded `/hd-porn/{id}/` pageUrl construction are removed.

Full replacement body (copy verbatim from spec REQ-4, "getStream" section):

```javascript
getStream: function(video) {
  var pageUrl = video.url;
  if (!pageUrl) return Promise.resolve({ url: '', quality: {} });
  return cherryFetch(pageUrl).then(function(html) {
    var hashM = html.match(/(?:EHH|hash)\s*[=:]\s*['"]([0-9a-f]{32})['"]/i);
    if (!hashM) throw new Error('eporner: hash not found');
    var raw = hashM[1];
    var computed = [raw.slice(0,8), raw.slice(8,16), raw.slice(16,24), raw.slice(24,32)]
      .map(function(c) { return parseInt(c, 16).toString(36); }).join('');
    var xhrUrl = 'https://www.eporner.com/xhr/video/' + video.id +
      '?hash=' + computed + '&device=generic&domain=www.eporner.com&fallback=false';
    return cherryFetch(xhrUrl);
  }).then(function(text) {
    var data = JSON.parse(text);
    var mp4 = data.sources && data.sources.mp4;
    if (!mp4) return { url: '', quality: {} };
    var quality = {};
    Object.keys(mp4).forEach(function(lbl) {
      if (mp4[lbl] && mp4[lbl].src) quality[lbl] = mp4[lbl].src;
    });
    return { url: bestQualityUrl(quality), quality: quality };
  }).catch(function() {
    return { url: '', quality: {} };
  });
}
```

**Change 2 — `_mapVideo`: remove stale `/hd-porn/` fallback URL**

Find the line in `_mapVideo` that reads:
```javascript
url: v.url || ('https://www.eporner.com/hd-porn/' + v.id + '/'),
```

Change to:
```javascript
url: v.url || ('https://www.eporner.com/video-' + v.id + '/'),
```

The fallback slug is intentionally omitted — the server redirects `/video-{id}/` to canonical. This is documented in spec REQ-4.

**Change 3 — `_apiFetch` doc comment: clarify scope**

Find the comment immediately before or at the `_apiFetch` definition. Update it to:
```javascript
// eporner JSON search/browse API has Access-Control-Allow-Origin: * — direct fetch is safe here.
// Do NOT use for HTML page fetches (video pages, XHR endpoint) — use cherryFetch() for those.
```

`_apiFetch` itself has no implementation change. It continues to serve only the `search` and `browse` methods.

**Architecture invariant check**:
- INV-2: After this change, `getStream` uses `cherryFetch` (proxy path) for both HTML and XHR fetches. `_apiFetch` (raw fetch) remains only for CORS-open JSON API calls in `search`/`browse`. The invariant is now correctly enforced for the eporner adapter.
- INV-4: No new module-scope variables. `_xnxxMp4` is not in this phase — ignore.
- INV-6: `StreamResult` shape unchanged (`{ url, quality }`).

**OQ-3 resolution note**: `video.id` in the XHR URL comes from `_mapVideo`'s `id: String(v.id)` field, which is set from the API response's numeric ID. The API's `v.url` is of the form `/video-{id}/{slug}/` where `{id}` is that same numeric ID. They are always identical. No change to XHR URL construction needed.

**Success criteria**:

Code audit (no test runner needed for these):
```
grep -n "_apiFetch" D:\Works\Lampa\plugin.js
```
The grep must show zero occurrences of `_apiFetch(` inside the `getStream` function body. The function definition itself and its two call sites in `browse`/`search` are still present.

```
grep -n "hd-porn" D:\Works\Lampa\plugin.js
```
Expected: zero occurrences (the stale fallback is gone).

Functional check: using the browser console or a unit test, call `eporner._mapVideo({id: '99', url: ''})` and confirm the returned object has `url === 'https://www.eporner.com/video-99/'`.

E2E spot-check (optional at this stage — covered by Phase 8 full regression): verify `eporner` stream returns a non-empty URL with quality keys of the form `'1080p'`, `'720p'`, etc.

**plugin-release sync** (INV-5):
```
copy "D:\Works\Lampa\plugin.js" "D:\Works\Lampa\plugin-release\plugin.js"
fc "D:\Works\Lampa\plugin.js" "D:\Works\Lampa\plugin-release\plugin.js"
```

---

### Phase 3: PornHub getStream (REQ-3)

**Files changed**:
- `D:\Works\Lampa\plugin.js`
- `D:\Works\Lampa\plugin-release\plugin.js`

**What to implement**:

Spec reference: REQ-3 (lines 259–333 of spec).

Locate the `pornhub` adapter's `getStream` method in `plugin.js`. Replace the entire method body with the implementation from spec REQ-3.

Key behavioural differences from the current implementation:
- The current implementation calls `cherryFetch(video.url)` — this fetches `rt.pornhub.com` or `www.pornhub.com/view_video.php?viewkey=...`, which returns HTTP 503 from both proxies for `rt.pornhub.com`.
- The new implementation extracts the `viewkey` from any pornhub URL variant using `/viewkey=([a-z0-9]+)/i`, constructs `embedUrl = 'https://www.pornhub.com/embed/' + viewkey`, and calls `cherryFetch(embedUrl)`.
- `www.pornhub.com` is already in `PROXY_URL_2_HOSTS` (added in a previous task). No routing table change is needed for this phase.
- The flashvars/mediaDefinitions parsing logic is UNCHANGED. Only the fetch target URL changes.
- A card with no `viewkey` in its URL must return `{ url: '', quality: {} }` without throwing.

Full replacement body (copy verbatim from spec REQ-3):

```javascript
getStream: function(video) {
  var vkMatch = (video.url || '').match(/viewkey=([a-z0-9_-]+)/i);
  if (!vkMatch) return Promise.resolve({ url: '', quality: {} });
  var viewkey = vkMatch[1];
  var embedUrl = 'https://www.pornhub.com/embed/' + viewkey;

  return cherryFetch(embedUrl).then(function(html) {
    var fvMatch = html.match(/var\s+flashvars_\d+\s*=\s*(\{[\s\S]+?\});\s*\n/);
    if (!fvMatch) return { url: '', quality: {} };

    var flashvars;
    try { flashvars = JSON.parse(fvMatch[1]); } catch (e) { return { url: '', quality: {} }; }

    var defs = flashvars.mediaDefinitions || [];
    var hlsUrls = {};
    var mp4Urls = {};

    defs.forEach(function(def) {
      var qNum = parseInt(def.quality, 10) || 0;
      if (!qNum) return;
      var vUrl = (def.videoUrl || '').replace(/\\\//g, '/').replace(/\/\/\//g, '//');
      if (!vUrl) return;
      var label = def.quality + 'p';
      if (def.format === 'hls')      hlsUrls[label] = vUrl;
      else if (def.format === 'mp4') mp4Urls[label] = vUrl;
    });

    if (Object.keys(mp4Urls).length) {
      return { url: bestQualityUrl(mp4Urls), quality: mp4Urls };
    }

    if (Object.keys(hlsUrls).length) {
      var labels = Object.keys(hlsUrls);
      return Promise.all(labels.map(function(lbl) {
        return proxyM3u8(hlsUrls[lbl], 'https://www.pornhub.com/').then(function(blob) {
          return { lbl: lbl, blob: blob };
        }).catch(function() { return { lbl: lbl, blob: hlsUrls[lbl] }; });
      })).then(function(results) {
        var quality = {};
        results.forEach(function(r) { quality[r.lbl] = r.blob; });
        return { url: bestQualityUrl(quality), quality: quality };
      });
    }

    return { url: '', quality: {} };
  }).catch(function() { return { url: '', quality: {} }; });
}
```

**Architecture invariant check**:
- INV-2: Uses `cherryFetch` (proxy path). `www.pornhub.com` is in `PROXY_URL_2_HOSTS`, so requests automatically go through Deno Deploy.
- INV-3: No routing table change in this phase. `www.pornhub.com` already present.
- INV-6: `StreamResult` shape unchanged.

**Success criteria**:

Functional check — two URL forms must work:
1. `video.url = 'https://www.pornhub.com/view_video.php?viewkey=ph12345'` → `StreamResult.url` non-empty.
2. `video.url = 'https://rt.pornhub.com/view_video.php?viewkey=ph12345'` → same — viewkey extracted, embed fetched via `www.pornhub.com`.
3. `video.url = 'https://www.pornhub.com/no-viewkey'` → returns `{ url: '', quality: {} }` without crash.

E2E spot-check (covered by Phase 8): `pornhub` stream returns HTTP 200/206 or a playable blob URL.

**plugin-release sync** (INV-5):
```
copy "D:\Works\Lampa\plugin.js" "D:\Works\Lampa\plugin-release\plugin.js"
fc "D:\Works\Lampa\plugin.js" "D:\Works\Lampa\plugin-release\plugin.js"
```

---

### Phase 4: SpankBang browse + stream (REQ-1 + REQ-2)

**Preconditions**:
- GATE-1 PASSED (if failed: skip this phase, record reason).
- **Phase 1 complete**: `ru.spankbang.com` must already be in `PROXY_URL_2_HOSTS` before this phase's code is written. Phase 4's `cherryFetch(video.url)` calls with `https://ru.spankbang.com/...` URLs route through Deno Deploy only if the entry exists in `PROXY_URL_2_HOSTS`. Without Phase 1 complete, the adapter code silently falls through to the CF Worker which will fail the JS challenge.

**Files changed**:
- `D:\Works\Lampa\plugin.js`
- `D:\Works\Lampa\plugin-release\plugin.js`

**What to implement**:

Spec reference: REQ-1 (lines 95–173) and REQ-2 (lines 175–253).

REQ-1 and REQ-2 are coupled because `VideoCard.url` built in REQ-1 (`ru.spankbang.com` base) is the input to `getStream` in REQ-2. Implement all changes in a single editing session so they are consistent.

**REQ-1 changes — `_parseCards`, `browse`, `search`, adapter `host` field:**

Change 1 — `browse` URL base:
```javascript
// BEFORE
var url = 'https://spankbang.com/new/' + p + '/';
// AFTER
var url = 'https://ru.spankbang.com/new/' + p + '/';
```

Change 2 — `search` URL base:
```javascript
// BEFORE
var url = 'https://spankbang.com/s/' + q + '/' + p + '/';
// AFTER
var url = 'https://ru.spankbang.com/s/' + q + '/' + p + '/';
```

If GATE-1 pre-check showed the search path differs on `ru.spankbang.com` (OQ-1), adjust the path template accordingly before committing.

Change 3 — `_parseCards` card splitter regex:
```javascript
// BEFORE
var blocks = html.split(/<div[^>]+class="[^"]*video[_-]item[^"]*"/);
// AFTER
var blocks = html.split(/<div[^>]+class="[^"]*video-item[^"]*"/);
```

Rationale: the new class attribute is `class=" js-video-item z-0 flex flex-col"`. The substring `video-item` is present in `js-video-item`. The underscore form (`video_item`) does not appear in `ru.spankbang.com` HTML and is intentionally excluded.

Change 4 — `videoUrl` construction in `_parseCards`:
```javascript
// BEFORE
var videoUrl = 'https://spankbang.com/' + id + '/video/';
// AFTER
var videoUrl = 'https://ru.spankbang.com/' + id + '/video/';
```

Change 5 — thumbnail extraction fallback in `_parseCards`:
```javascript
// BEFORE
var thumbMatch = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+\.jpg[^"]*)"/);
// AFTER
var thumbMatch = block.match(/data-src="([^"]+)"/) ||
                 block.match(/src="(https:\/\/tbi\.sb-cd\.com\/[^"]+)"/) ||
                 block.match(/src="([^"]+\.(?:jpg|webp|jpeg)[^"]*)"/);
```

Change 6 — adapter `host` field:
```javascript
// BEFORE
host: 'spankbang.com',
// AFTER
host: 'ru.spankbang.com',
```

**REQ-2 changes — `getStream`:**

Replace the SpankBang `getStream` body with the three-phase implementation from spec REQ-2:

- Phase 1 (PRIMARY): quality map regex `/'([0-9]+(?:p|k))'\s*:\s*\['(https?:\/\/[^']+)'/gi` — iterates all matches, builds `qMap`, returns `{ url: bestQualityUrl(qMap), quality: qMap }` if non-empty.
- Phase 2 (FALLBACK): `data-streamkey` extraction + `cherryPost('https://ru.spankbang.com/api/videos/stream', ...)` — note the updated domain, POST endpoint uses `ru.` not `www.`.
- Phase 3: `extractStreams(html)` generic fallback.

Full replacement body (copy verbatim from spec REQ-2):

```javascript
getStream: function(video) {
  return cherryFetch(video.url).then(function(html) {
    // Phase 1 (PRIMARY): quality map JS literal
    var qMap = {};
    var qRe = /'([0-9]+(?:p|k))'\s*:\s*\['(https?:\/\/[^']+)'/gi;
    var qm;
    while ((qm = qRe.exec(html)) !== null) {
      qMap[qm[1]] = qm[2];
    }
    if (Object.keys(qMap).length) {
      return { url: bestQualityUrl(qMap), quality: qMap };
    }

    // Phase 2 (FALLBACK): streamkey POST
    var skMatch = html.match(/data-streamkey="([^"]+)"/);
    if (skMatch) {
      var streamkey = skMatch[1];
      return cherryPost(
        'https://ru.spankbang.com/api/videos/stream',
        'id=' + streamkey + '&data=0'
      ).then(function(text) {
        var data;
        try { data = JSON.parse(text); } catch (e) { return extractStreams(html); }
        var q = {};
        Object.keys(data).forEach(function(k) {
          if (typeof data[k] === 'string' && data[k].indexOf('http') === 0) q[k] = data[k];
        });
        var best = bestQualityUrl(q);
        if (best) return { url: best, quality: q };
        return extractStreams(html);
      }).catch(function() { return extractStreams(html); });
    }

    // Phase 3: generic extractStreams
    return extractStreams(html);
  }).catch(function() { return { url: '', quality: {} }; });
}
```

**OQ-2 note**: If during manual testing you find quality labels other than `NNNp`/`Nk` (e.g. `2160p`), the regex `[0-9]+(?:p|k)` already handles them because `2160p` matches `[0-9]+p`. The only edge case would be a label like `2.5k` (decimal) — if found, expand accordingly. Check against at least two live video pages before considering this resolved.

**Architecture invariant check**:
- INV-3: `ru.spankbang.com` was added to `PROXY_URL_2_HOSTS` in Phase 1. `cherryFetch(video.url)` where `video.url` starts with `https://ru.spankbang.com/` will therefore route through Deno Deploy automatically.
- INV-6: `VideoCard.url` consistently uses `ru.spankbang.com` base (REQ-1 Changes 1, 4). `getStream` receives this URL and fetches it via the same proxy path. No domain mismatch.
- INV-2: All fetches use `cherryFetch`/`cherryPost`. No raw `fetch()` introduced.

**Success criteria**:

```
# Functional: browse returns >= 10 cards, all URLs use ru. prefix
node -e "/* inline adapter test */"

# No old domain leaks
grep -n "://spankbang.com/" D:\Works\Lampa\plugin.js
```
Expected: zero occurrences of `://spankbang.com/` (without `ru.`) in adapter code. (The `PROXY_URL_2_HOSTS` removal of the bare domain entry is not a URL occurrence — that's a hostname string, not a URL pattern.)

```
grep -n "spankbang.com" D:\Works\Lampa\plugin.js
```
Expected occurrences: only `ru.spankbang.com` entries (in `PROXY_URL_2_HOSTS`, `browse`, `search`, `_parseCards`, `getStream`, and `host` field). Zero bare `spankbang.com` references in adapter logic.

```
# Confirm host field was updated
grep -n "host:" D:\Works\Lampa\plugin.js | grep "spankbang"
# Expected: one occurrence containing host: 'ru.spankbang.com'
```

Browse/search functional check:
- `spankbang.browse('', 1)` → `items.length >= 10`, all items have `url` starting with `https://ru.spankbang.com/`, non-empty `title`, non-empty `thumb`.
- `spankbang.search('teen', 1)` → `items.length >= 5`.

Stream functional check:
- `spankbang.getStream(card)` where `card.url = 'https://ru.spankbang.com/{id}/video/'` → `url.length > 0`, `Object.keys(quality).length >= 1`.

**plugin-release sync** (INV-5):
```
copy "D:\Works\Lampa\plugin.js" "D:\Works\Lampa\plugin-release\plugin.js"
fc "D:\Works\Lampa\plugin.js" "D:\Works\Lampa\plugin-release\plugin.js"
```

---

### Phase 5: pornone CDN routing (REQ-8 — conditional on GATE-3)

**Files changed** (if GATE-3 PASS):
- `D:\Works\Lampa\plugin.js`
- `D:\Works\Lampa\plugin-release\plugin.js`
- `D:\Works\Lampa\test\cherry-lampa-e2e.mjs`

**Files changed** (if GATE-3 FAIL):
- `D:\Works\Lampa\docs\CHERRY.md` (docs only — covered in Phase 7, but flag it here)

**What to implement**:

Spec reference: REQ-8 (lines 601–659 of spec). Pattern scan Q1 recommendation.

**GATE-3 re-run required**: The CDN URL captured in Phase 0's GATE-3 Step 2 carries a time-limited token. By the time Phase 5 runs (after Phases 1–4), the token may have expired. Before making any PROXY_URL_2_HOSTS changes in this phase, repeat GATE-3 Step 1 (fetch a live pornone page to get a fresh CDN URL) and GATE-3 Step 2 (HEAD request to confirm CDN reachability through Deno). Use the freshly obtained CDN hostname and URL — not the stale Phase 0 result.

**If GATE-3 PASSED:**

Try **Strategy A first** — add only the CDN hostname to `PROXY_URL_2_HOSTS` (not `pornone.com` itself). This keeps the page fetch on the CF Worker and routes only the CDN stream through Deno. Fewer entries in the Deno table = lower risk.

In `plugin.js` PROXY_URL_2_HOSTS, add:
```javascript
// pornone CDN IP-bound tokens — routes via Deno; same-POP delivery is likely (Anycast) but not guaranteed
'<CDN_HOSTNAME_FROM_GATE_3>': 1,
```

Apply the identical addition to `test/cherry-lampa-e2e.mjs` PROXY_URL_2_HOSTS mirror.

Then re-run GATE-3 Step 2 with a freshly obtained CDN URL (see GATE-3 re-run note in this phase). If the CDN URL resolves correctly through Deno → Strategy A is sufficient, stop here.

If Strategy A fails (CDN returns 403 with page fetch from CF Worker IP but CDN via Deno IP), **escalate to Strategy B**: additionally add `'pornone.com': 1` to PROXY_URL_2_HOSTS in both files, so the page fetch also goes through Deno and both requests originate from the same POP.

```javascript
// pornone — Strategy B: co-locate page and CDN through same Deno POP to satisfy IP-bound token
'pornone.com': 1,
'<CDN_HOSTNAME_FROM_GATE_3>': 1,
```

Note: Strategy B improves POP co-location but cannot guarantee it (Deno Deploy is Anycast, geographically sticky but not deterministic). If Strategy B also fails, document pornone as infrastructure-blocked (same path as HQPorner).

The pattern scan recommendation (Q1) favoured Strategy B due to the IP-binding concern, but the spec requires testing A first. Strategy B is a fallback, not the default.

No changes to `pornone.getStream` code are needed — the existing `buildProxyUrl` wrapping already handles routing once the hostnames are in the table.

**If GATE-3 FAILED (CDN blocks all proxy IPs)** — no code changes. The docs update for this case is handled in Phase 7 (REQ-6). Mark this phase as "no code change required, docs-only path taken".

**Architecture invariant check**:
- INV-3: PROXY_URL_2_HOSTS is the only routing mechanism. This phase only edits that map.
- INV-2: `pornone.getStream` already uses `cherryFetch`/`proxyM3u8`. No raw fetch introduced.
- INV-4: No new module-scope variables.

**Success criteria** (if GATE-3 PASS):

```
npm test
```
sync-check assertion must pass (E2E mirror matches plugin.js).

```
# pornone stream reachable through Deno proxy
curl -I "https://cherry-proxy.aawersom.deno.net/proxy?url=<CDN_STREAM_URL_encoded>&key=1206"
# Expected: HTTP 200 or 206, Content-Type: video/mp4 or video/MP2T
```

If GATE-3 FAIL: no code success criteria. Proceed to Phase 7 for docs.

**plugin-release sync** (INV-5, only if code was changed):
```
copy "D:\Works\Lampa\plugin.js" "D:\Works\Lampa\plugin-release\plugin.js"
fc "D:\Works\Lampa\plugin.js" "D:\Works\Lampa\plugin-release\plugin.js"
```

---

### Phase 6: xnxx parser (REQ-9 — conditional on GATE-4)

**Files changed** (if GATE-4 FAIL, i.e., xnxx getStream is broken):
- `D:\Works\Lampa\plugin.js`
- `D:\Works\Lampa\plugin-release\plugin.js`

**Files changed** (if GATE-4 PASS, i.e., extractStreams already works):
- none

**What to implement**:

Spec reference: REQ-9 (lines 661–736 of spec).

**If GATE-4 PASSED** (extractStreams works, xnxx stream is reachable): mark REQ-9 as skipped. No code changes. Note in the implementation record: "GATE-4 PASS — extractStreams already catches xnxx MP4 URL. REQ-9 skipped."

**If GATE-4 FAILED** — add a site-specific parser to `xnxx.getStream` before the existing `extractStreams(html)` call.

Before writing the new parser, inspect at least one real xnxx video page HTML to confirm quality labels. The spec uses `'720p'` and `'480p'` as approximations. If the HTML shows different labels (e.g. `High` / `Low`), use the actual labels or map them to numeric-p form.

The new `getStream` body (copy from spec REQ-9, adjusted if quality labels differ from spec approximations):

```javascript
getStream: function(video) {
  return cherryFetch(video.url).then(function(html) {
    var _xnxxMp4 = function(h) {
      var highM = h.match(/html5player\.setVideoUrlHigh\('([^']+)'\)/);
      var lowM  = h.match(/html5player\.setVideoUrlLow\('([^']+)'\)/);
      var q = {};
      if (highM) q['720p'] = highM[1];
      if (lowM)  q['480p'] = lowM[1];
      if (Object.keys(q).length) {
        return { url: bestQualityUrl(q), quality: q };
      }
      return extractStreams(h);
    };

    // Primary: HLS master playlist
    var hlsM = html.match(/html5player\.setVideoHLS\('([^']+)'\)/);
    if (hlsM) {
      return proxyM3u8(hlsM[1], 'https://www.xnxx.com/').then(function(blob) {
        return { url: blob, quality: { 'hls': blob } };
      }).catch(function() {
        return _xnxxMp4(html);
      });
    }

    return _xnxxMp4(html);
  }).catch(function() { return { url: '', quality: {} }; });
}
```

**Architecture invariant check**:
- INV-2: Uses `cherryFetch` and `proxyM3u8`. `xnxx.com`/`www.xnxx.com` are already in `PROXY_URL_2_HOSTS`.
- INV-4: `_xnxxMp4` is an inner function, not module-scope. No new module-scope variables.
- INV-6: `StreamResult` shape unchanged.

**Success criteria** (if GATE-4 FAIL and REQ-9 implemented):

```
# xnxx stream returns non-empty URL
# Check via E2E or browser console:
# xnxx.getStream(card) where card.url = 'https://www.xnxx.com/video-xxxxxxx/...'
# Expected: StreamResult.url non-empty
```

If HLS is found: `StreamResult.url` is a `blob:` URL.
If MP4 only: `StreamResult.quality` has at least one key (`'720p'` or `'480p'` or adjusted label).

If GATE-4 PASS: no success criteria needed — existing E2E coverage is unchanged.

**plugin-release sync** (INV-5, only if code was changed):
```
copy "D:\Works\Lampa\plugin.js" "D:\Works\Lampa\plugin-release\plugin.js"
fc "D:\Works\Lampa\plugin.js" "D:\Works\Lampa\plugin-release\plugin.js"
```

---

### Phase 7: Documentation update (REQ-6)

**Files changed**:
- `D:\Works\Lampa\docs\CHERRY.md`

No code changes. No plugin-release sync needed.

**What to implement**:

Spec reference: REQ-6 (lines 477–571 of spec), sections 6.1 through 6.6.

Make all six documentation changes in a single editing session:

**6.1 — HQPorner row in "Browse works, video broken" table**

Find the `hqporner` row in the "Browse works, video broken (CDN architecture limitation)" section. Replace the row content:

```markdown
| `hqporner` | 50 | **bigcdn.cc blocks all Cloudflare datacenter IPs — permanently broken.** CDN returns 404 from CF Worker, Deno Deploy, and residential IPs alike. Browse remains functional. Stream is unrecoverable without a self-hosted FlareSolverr or residential relay; not fixable at the proxy tier. |
```

**6.2 — HQPorner row in "Source Adapters — Full List" adapter table**

Find the `hqporner` row in the full adapter list. Append the broken note to the protocol description:

```markdown
| 6 | `hqporner` | HQPorner | hqporner.com | HTML → mydaddy.cc embed → bigcdn.cc CDN **(stream broken — bigcdn.cc unreachable from all proxy tiers; browse functional)** |
```

**6.3 — SpankBang section update** (outcome depends on GATE-1):

If GATE-1 PASSED:
- Remove the SpankBang row from the "0 cards — not fixable" section.
- Add to the "Browse + Video working" table:

```markdown
| `spankbang` | ~30 | **Via Deno Deploy proxy** (`ru.spankbang.com`); `spankbang.com` and `www.spankbang.com` remain JS-challenge gated and are removed from `PROXY_URL_2_HOSTS`. Quality map extraction primary, streamkey POST fallback. |
```

- Update the narrative under "0 cards — not fixable" to note that `ru.spankbang.com` bypasses the challenge:

```markdown
SpankBang protects `spankbang.com` and `www.spankbang.com` with Cloudflare JS challenge. The Russian regional subdomain `ru.spankbang.com` does NOT trigger the JS challenge from Deno Deploy IPs and is used instead.
```

If GATE-1 FAILED (ru. also challenge-gated): update the existing SpankBang row in "0 cards — not fixable":

```markdown
| `spankbang` | Cloudflare JS challenge on all paths. `ru.spankbang.com` tested 2026-05-28 — also JS-challenge gated from Deno Deploy. No fixable path found at proxy tier. |
```

**6.4 — PROXY_URL_2 comment in "Proxy Layer" section**

Find the comment on the `PROXY_URL_2` line. Update the parenthetical to reflect current active entries. If GATE-1 PASSED:

```
// Secondary proxy on Deno Deploy — used for sites that block Cloudflare datacenter IPs (xnxx, ru.spankbang.com, eporner video pages)
```

If GATE-1 FAILED, omit `ru.spankbang.com` from the parenthetical.

**6.5 — Eporner row in "Browse + Video working" table**

Find the `eporner` row. Update to reflect Deno proxy usage for video pages (conditional on GATE-2a confirming CF Worker fails; if CF Worker works, update to note CF Worker proxy instead of Deno):

If GATE-2a showed CF Worker fails (most likely path per orchestrator diagnostic):
```markdown
| `eporner` | ~30 | **Via Deno Deploy proxy** for video pages (`www.eporner.com` added to `PROXY_URL_2_HOSTS`); JSON search/browse API still uses direct fetch (CORS-open). URL format: `/video-{id}/{slug}/`. |
```

**6.6 — Secondary proxy description in "Proxy Layer" section**

Find the description of the secondary proxy (Deno). Update to mention current entries:

```
Used for hostnames in `PROXY_URL_2_HOSTS` (`xnxx.com`, `ru.spankbang.com`, `www.eporner.com`, and others) that block Cloudflare datacenter IPs at ASN level or return unusable responses from the CF Worker.
```

Adjust hostname list based on GATE-1 and GATE-2a outcomes.

**If GATE-3 FAILED (pornone CDN also blocks all proxies)**: Add a note in the "Browse works, video broken" section for pornone documenting CDN infrastructure block. The specific wording is at implementer's discretion, following the HQPorner pattern.

**Success criteria**:

```
grep -n "permanently broken" "D:\Works\Lampa\docs\CHERRY.md"
# Expected: at least 1 match (HQPorner row)

grep -n "stream broken" "D:\Works\Lampa\docs\CHERRY.md"
# Expected: at least 1 match (HQPorner adapter table row)

grep -n "not fixable at the proxy tier" "D:\Works\Lampa\docs\CHERRY.md"
# Expected: at least 1 match (HQPorner status table)
```

Visual check: open `docs/CHERRY.md` and confirm:
- HQPorner "Browse works, video broken" section contains "permanently broken" and "not fixable at the proxy tier".
- HQPorner adapter table row contains "(stream broken".
- SpankBang section reflects GATE-1 outcome.
- Eporner status row references "Deno Deploy proxy" for video pages (or CF Worker proxy if GATE-2a passed).
- Proxy Layer section description lists the current active special-case hostnames.

---

### Phase 8: E2E baseline migration + full regression

**Files changed**:
- `D:\Works\Lampa\tasks\cherry-e2e-baseline.json` (baseline update only)

**What to implement**:

Spec reference: Implementation Order step 7 (spec line 870) and step 11 (spec line 873).

This phase runs after Phases 1–7 are complete and all plugin-release syncs are confirmed.

**Entry gate — verify all per-phase syncs are complete**

Before running any E2E in this phase, confirm plugin.js and plugin-release/plugin.js are identical:
```
fc "D:\Works\Lampa\plugin.js" "D:\Works\Lampa\plugin-release\plugin.js"
```
Expected: "FC: no differences encountered".

If differences exist, identify which phase's sync was missed (check git status and diff to see which files changed without a corresponding release sync). Apply the missing sync before proceeding.

**Step 1 — Baseline migration for SpankBang (only if GATE-1 PASSED and Phase 4 implemented)**

The current baseline file `tasks/cherry-e2e-baseline.json` records SpankBang as producing 0 cards (the broken state). After Phase 4, SpankBang produces N cards. The E2E harness compares live results against baseline and will flag SpankBang's new output as a regression deviation.

Run one E2E pass and capture the new SpankBang result:
```
node "D:\Works\Lampa\test\cherry-lampa-e2e.mjs" 2>&1 | tee /tmp/e2e_migration_run.log
```

Inspect the output to confirm SpankBang now returns >= 10 cards and a non-empty stream URL.

The E2E harness's `writeBaseline()` function only captures Tier A adapter results automatically. SpankBang is Tier D — its baseline must be updated manually.

After confirming the result, open `tasks/cherry-e2e-baseline.json` in an editor. Find the `"sources"` object. Add or update the SpankBang entry:

```json
"spankbang": { "cardsCount": N }
```

where N is the actual card count observed in the E2E run. Save the file.

**Do NOT use `npm run e2e:update-baseline`** — that script does not exist in package.json.

Only update the SpankBang portion of the baseline. Do not change other adapter baselines unless they also show confirmed improvements.

**Step 2 — Full E2E regression**

Run the complete E2E suite:
```
node "D:\Works\Lampa\test\cherry-lampa-e2e.mjs"
```

All five repaired adapters must pass their tier checks:
- `spankbang` (Tier D): browse returns >= 1 card (Tier D threshold), stream URL non-empty.
- `pornhub` (Tier A): browse returns cards, stream URL non-empty and reachable (HTTP 200/206).
- `eporner` (Tier D): browse returns cards, stream URL non-empty and reachable.
- `pornone` (Tier C or infrastructure-blocked per GATE-3): stream URL non-empty if GATE-3 passed, or documented as blocked.
- `xnxx` (Tier D): stream URL non-empty (REQ-9 implemented or GATE-4 confirmed extractStreams works).

Other 20 adapters must show no regressions from their pre-task baseline state.

**Success criteria**:

```
node "D:\Works\Lampa\test\cherry-lampa-e2e.mjs"
# Expected: exit code 0
```

If the E2E exits with code 1 (content failure), identify which adapter(s) failed and whether the failure is in a repaired adapter or an unrelated adapter. Regressions in unrelated adapters would indicate an INV violation — re-check that no shared helpers were accidentally modified.

If the E2E exits with code 2 (infrastructure failure — network down, Lampa unreachable), that is a test environment issue, not a code issue. Retry once before investigating.

**plugin-release sync**: not applicable in this phase (no plugin.js changes). All plugin-release syncs were performed incrementally after each phase.

---

## Open Questions

The following open questions are carried forward from the spec. Each has a resolution action for the implementer.

### OQ-1: SpankBang search URL structure on ru.spankbang.com

The orchestrator verified `ru.spankbang.com/new/1/` (browse) but NOT `ru.spankbang.com/s/{query}/{page}/` (search). The search URL path may differ on the Russian subdomain.

Resolution action (GATE-1 pre-check): run the search verification curl command documented in Phase 0's GATE-1 section. If the path differs, adjust the `search` method URL template in Phase 4 before writing any code. If `ru.spankbang.com/s/teen/1/` returns >= 20 `js-video-item` occurrences, the path is identical and no adjustment is needed.

### OQ-2: SpankBang quality map label completeness

The orchestrator found `'720p'` in one sample. Labels like `'4k'`, `'2k'`, `'2160p'` are unknown. The regex `'([0-9]+(?:p|k))'` covers common forms.

Resolution action (Phase 4): before finalising the `getStream` regex, test it against at least two real video pages fetched through Deno proxy. If unexpected label formats appear, expand the regex character class to cover them. Document the tested label set in a code comment.

### OQ-3: Eporner XHR `video.id` alignment with URL

`video.id` comes from `_mapVideo`'s `id: String(v.id)`. The XHR URL uses this ID. The API's `v.url` is `/video-{id}/{slug}/` where `{id}` is the same numeric value.

Resolution action: this is confirmed by code inspection — `_mapVideo` sets `id: String(v.id)` and `url: v.url`. They share the same source field. No code change needed. The OQ is considered resolved.

### OQ-4: CF Worker behaviour for www.eporner.com after PROXY_URL_2_HOSTS change

After adding `www.eporner.com` to `PROXY_URL_2_HOSTS`, all `cherryFetch` calls to that hostname route to Deno Deploy. Search/browse use `_apiFetch` (raw `fetch()`) which bypasses `buildProxyUrl` entirely — unaffected. The doc comment added in Phase 2 (Change 3) addresses the guard against future accidental replacement.

Resolution action: confirm after Phase 1 + Phase 2 are complete that `npm test` passes the sync-check, and that a manual browse call for eporner returns cards (confirming `_apiFetch` is still taking the raw-fetch path, not the proxy path).

### OQ-5 (new): Strategy B for pornone — same-POP delivery guarantee

Pattern scan (Q1) notes that Deno Deploy's Anycast routing makes same-POP delivery likely but not guaranteed for two requests in the same user session. Strategy B reduces the problem but cannot eliminate it for strict IP-bound CDN tokens.

Resolution action (Phase 5): if Strategy B is implemented and E2E stream checks still fail with 403, document pornone stream as infrastructure-blocked (same as HQPorner) and update `docs/CHERRY.md` accordingly. A static-IP VPS proxy is the correct long-term fix but is out of scope for this task.
