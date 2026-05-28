# source-repair — Full Specification

Mode: FULL

Generated: 2026-05-28
Author: spec writer (api-designer agent)
Inputs: `docs/CHERRY.md`, `tasks/source-repair.task.arch-brief.md`, orchestrator diagnostic findings, live codebase read of `plugin.js` lines 1–1854.

---

## Task Summary

Five adapters in Cherry's 25-adapter roster have broken or degraded behaviour that is fixable with targeted code changes:

- **SpankBang** (`spankbang`): `browse` returns 0 cards because `spankbang.com` and `www.spankbang.com` serve a Cloudflare JS challenge to all datacenter IPs, including the existing Deno proxy entries. The Russian regional subdomain `ru.spankbang.com` does NOT trigger the JS challenge from Deno Deploy. Card HTML structure has also changed (class attribute now contains leading spaces). `getStream` is broken for the same domain reason and needs updating to use the quality-map regex path as primary plus the HTML page as the source.
- **PornHub** (`pornhub`): `getStream` is broken because `rt.pornhub.com` video pages return HTTP 503 to both proxies. The embed URL `https://www.pornhub.com/embed/{viewkey}` via Deno proxy (already in `PROXY_URL_2_HOSTS`) returns a full 56KB page containing `flashvars`/`mediaDefinitions` in the format the existing parser handles.
- **Eporner** (`eporner`): `getStream` is broken because it calls `_apiFetch()` (raw `fetch()`, no proxy) for the video page and XHR endpoint, both of which lack CORS headers. The Deno proxy returns the real 97KB page with the hash present. Adding `www.eporner.com` to `PROXY_URL_2_HOSTS` and switching `getStream` to `cherryFetch` fixes both calls. The `_mapVideo` fallback URL construction uses the obsolete `/hd-porn/{id}/` path; the API's `v.url` field already returns the correct `/video-{id}/{slug}/` format.
- **pornone** (`pornone`): CDN uses per-IP signed tokens; stream fetch from a different CF edge IP than page fetch causes token rejection.
- **xnxx** (`xnxx`): No site-specific parser; `extractStreams` may miss HLS stream URL (`html5player.setVideoHLS` pattern not covered).

One adapter (**HQPorner**) has a permanently broken stream (bigcdn.cc CDN unreachable from all proxy tiers including residential) and receives no code change — only a documentation update.

Deliverables:
1. `plugin.js` — code changes for REQ-1 through REQ-5
2. `plugin-release/plugin.js` — mechanical sync of the same changes
3. `docs/CHERRY.md` — documentation updates per REQ-6

---

## Architectural Constraints (Non-Negotiable)

The following invariants from `tasks/source-repair.task.arch-brief.md` apply to every requirement in this spec:

**INV-1**: `SOURCES.length` stays 25. No adapters added or removed.

**INV-2**: All HTML page fetches must go through `cherryFetch` / `cherryPost` / `proxyM3u8`. Raw `fetch()` is permitted only for CORS-open JSON API endpoints (currently only Eporner's search/browse API). This is a named exception, not a pattern to extend.

**INV-3**: `PROXY_URL_2_HOSTS` is the sole mechanism for routing a hostname to Deno Deploy. Changes to proxy routing are made exclusively by editing this map.

**INV-4**: Single-file IIFE. All changes land in `plugin.js`. No new module-scope variables unless they serve multiple adapters.

**INV-5**: `plugin-release/plugin.js` must be kept byte-for-byte identical to `plugin.js` after every edit. This is a mandatory sync step for every REQ that touches code.

**INV-6**: `BrowseResult`, `VideoCard`, and `StreamResult` shapes are frozen. SpankBang's `VideoCard.url` must consistently use `ru.spankbang.com` as base so that `getStream` can fetch the same domain through the correct proxy path.

---

## Prerequisites and Gate Conditions

### GATE-1: SpankBang ru.spankbang.com reachability (MUST VERIFY before implementing REQ-1/REQ-2)

The orchestrator reports `ru.spankbang.com` returns 607KB HTML with `js-video-item` cards from Deno proxy. CHERRY.md currently records SpankBang as unfixable due to JS challenge on all paths.

These claims are contradictory. The SpankBang requirements (REQ-1, REQ-2, REQ-5 SpankBang portion) MUST NOT be implemented until this is verified:

Verification procedure:
```
curl "https://cherry-proxy.aawersom.deno.net/proxy?url=https%3A%2F%2Fru.spankbang.com%2Fnew%2F1%2F&key=1206" \
  -s -o /tmp/sb_page1.html -w "%{http_code} %{size_download}"
# Expected: 200, size > 400000
grep -c "js-video-item" /tmp/sb_page1.html
# Expected: >= 20

curl "https://cherry-proxy.aawersom.deno.net/proxy?url=https%3A%2F%2Fru.spankbang.com%2Fnew%2F2%2F&key=1206" \
  -s -o /tmp/sb_page2.html -w "%{http_code} %{size_download}"
grep -c "js-video-item" /tmp/sb_page2.html
# Expected: >= 20
```

If either request returns < 100KB or contains "Just a moment" or "cf-browser-verification", STOP. REQ-1, REQ-2, and the SpankBang portion of REQ-5 are removed from scope for this task. Document in CHERRY.md that `ru.spankbang.com` also challenge-gates.

If both requests return populated HTML, proceed.

### GATE-2: Eporner proxy path selection

The orchestrator states the Deno proxy returns 97KB real pages from `www.eporner.com`. It does not confirm whether the CF Worker also succeeds. The spec requires adding `www.eporner.com` to `PROXY_URL_2_HOSTS` to guarantee Deno routing.

Rationale: the CF Worker has been shown (orchestrator finding) to return a 369B obfuscated JS redirect for eporner video pages. Deno Deploy returns the real page. Adding to `PROXY_URL_2_HOSTS` is the correct fix per INV-3 and is not over-engineering — there is confirmed evidence the CF Worker fails.

### GATE-2a: Eporner CF Worker failure confirmation

The orchestrator reports CF Worker returns a 369B obfuscated JS redirect for `www.eporner.com` video pages. This is the justification for adding `www.eporner.com` to `PROXY_URL_2_HOSTS`. Before implementing REQ-5 for Eporner, confirm:

```
curl "https://cherry-proxy.aawersom.workers.dev/proxy?url=https%3A%2F%2Fwww.eporner.com%2Fvideo-1V4KRKD8lT0%2F&key=1206" \
  -s -o /tmp/ep_cfworker.html -w "%{http_code} %{size_download}"
# If size < 5000 and/or HTTP != 200, CF Worker fails → Deno routing is required → apply REQ-5 Eporner change
# If size > 50000 and HTTP 200, CF Worker works → drop www.eporner.com from REQ-5 and just switch getStream to cherryFetch
```

The orchestrator's 369B finding is strong evidence that CF Worker fails. This gate codifies it as a documented decision rather than an assumption. If the gate shows CF Worker succeeds, drop the `www.eporner.com` entry from REQ-5 and update REQ-4's GATE-2 section accordingly.

---

## REQ-1: SpankBang — Restore Browse and Search (0 cards → N cards)

**Scope**: `_parseCards`, `search`, `browse` methods of the `spankbang` adapter.

### Problem

Current `browse` and `search` fetch from `spankbang.com` which triggers a Cloudflare JS challenge, yielding an HTML page with "Just a moment" and 0 parseable cards. Additionally, the current card splitter `/<div[^>]+class="[^"]*video[_-]item[^"]*"/` does not match the new real card class `class=" js-video-item z-0 flex flex-col"` (leading space, hyphenated `js-video-item`).

### Required Changes

**1. Browse and search URLs**: Replace `spankbang.com` base with `ru.spankbang.com`.

```javascript
// BEFORE
var url = 'https://spankbang.com/new/' + p + '/';
// AFTER
var url = 'https://ru.spankbang.com/new/' + p + '/';

// BEFORE
var url = 'https://spankbang.com/s/' + q + '/' + p + '/';
// AFTER
var url = 'https://ru.spankbang.com/s/' + q + '/' + p + '/';
```

**2. Card splitter**: Update `_parseCards` to split on a pattern that matches the new class attribute.

The new card class is `class=" js-video-item z-0 flex flex-col"`. The current regex `/<div[^>]+class="[^"]*video[_-]item[^"]*"/` does NOT match this because:
- The class string has a leading space before `js-video-item`
- The regex requires `video_item` or `video-item` (underscore or hyphen) immediately after `video`

New split regex must match a `<div` whose class attribute contains the substring `video-item` anywhere (including as part of `js-video-item`). The simplest correct approach:

```javascript
// BEFORE
var blocks = html.split(/<div[^>]+class="[^"]*video[_-]item[^"]*"/);
// AFTER
var blocks = html.split(/<div[^>]+class="[^"]*video-item[^"]*"/);
```

This matches `js-video-item` (which contains `video-item` as a substring). The old `video_item` (underscore) form will NOT match this regex — but that form does not appear in `ru.spankbang.com` HTML (confirmed in the 607KB diagnostic sample), so excluding it is intentional and safe.

**3. VideoCard URL base**: Update `videoUrl` construction to use `ru.spankbang.com`.

```javascript
// BEFORE
var videoUrl = 'https://spankbang.com/' + id + '/video/';
// AFTER
var videoUrl = 'https://ru.spankbang.com/' + id + '/video/';
```

**4. Thumbnail extraction**: The new card HTML uses `<img src="https://tbi.sb-cd.com/..." loading="lazy">` (no `data-src`). The existing fallback `block.match(/src="([^"]+\.jpg[^"]*)"/)`  matches `.jpg` URLs but may miss WebP thumbs. Update fallback to also match `src="https://tbi.sb-cd.com/..."`:

```javascript
// BEFORE
var thumbMatch = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+\.jpg[^"]*)"/);
// AFTER
var thumbMatch = block.match(/data-src="([^"]+)"/) ||
                 block.match(/src="(https:\/\/tbi\.sb-cd\.com\/[^"]+)"/) ||
                 block.match(/src="([^"]+\.(?:jpg|webp|jpeg)[^"]*)"/);
```

**5. Title extraction**: The `title="([^"]+)"` attribute fallback already works on the new HTML (`<a ... title="TITLE">`). No change needed for title.

**6. Adapter `host` field**: Update from `'spankbang.com'` to `'ru.spankbang.com'` to reflect the actual origin.

```javascript
// BEFORE
host: 'spankbang.com',
// AFTER
host: 'ru.spankbang.com',
```

### Done When

- `browse('', 1)` returns `BrowseResult` with `items.length >= 10` and all items have non-empty `title`, `url` starting with `https://ru.spankbang.com/`, and `id` matching `sb-[\w-]+`.
- `search('teen', 1)` returns `BrowseResult` with `items.length >= 5`.
- `_parseCards` run against the 607KB sample page produces `>= 20` items (unit test).
- No item has `url` containing `spankbang.com` (without `ru.` prefix).

---

## REQ-2: SpankBang — Restore Video Playback (Stream Extraction)

**Scope**: `getStream` method of the `spankbang` adapter.

### Problem

`getStream` calls `cherryFetch(video.url)`. With `video.url` now pointing to `ru.spankbang.com` (per REQ-1), `buildProxyUrl` will route through Deno Deploy (because `ru.spankbang.com` will be in `PROXY_URL_2_HOSTS` per REQ-5). The video page HTML contains two usable extraction paths:

- **PRIMARY**: Quality map JS literal: `'720p': ['https://vdownload-48.sb-cd.com/...-720p.mp4?secure=...']`
- **FALLBACK**: `data-streamkey="..."` + POST to `/api/videos/stream`

The current adapter uses `data-streamkey` as primary and `extractStreams` as secondary. The quality map regex approach is more direct and does not require a secondary POST request. Restructure to:
1. Try quality map regex first
2. Fall back to `data-streamkey` + `cherryPost`
3. Fall back to `extractStreams(html)`

The POST endpoint URL must also be updated to use `ru.spankbang.com`:

```javascript
// BEFORE
'https://spankbang.com/api/videos/stream'
// AFTER
'https://ru.spankbang.com/api/videos/stream'
```

### Required Changes

Replace the `getStream` implementation:

```javascript
getStream: function(video) {
  return cherryFetch(video.url).then(function(html) {
    // Phase 1 (PRIMARY): quality map JS literal
    // Pattern: 'NNNp': ['https://...'] or '4k': ['https://...']
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

Note: the quality map regex `/'([0-9]+(?:p|k))'\s*:\s*\['(https?:\/\/[^']+)'/g` differs from the orchestrator's stated pattern `/'([0-9]+)(p|k)': ?\['(https?:\/\/[^']+)'/g`. The spec uses the combined capture group form `([0-9]+(?:p|k))` to produce label strings like `'720p'` directly, matching the existing `bestQualityUrl` key convention. Both regex forms match the same HTML; the difference is capture group count.

### Done When

- `getStream` on a valid `VideoCard` with `url = 'https://ru.spankbang.com/{id}/video/'` returns `StreamResult` with non-empty `url` and `quality` containing at least one entry.
- `url` is a direct CDN MP4 URL (e.g. `*.sb-cd.com/*.mp4`) or a streamkey API result.
- E2E test for `spankbang` produces stream URL reachable via Deno proxy (HTTP 200/206 on Range request).

---

## REQ-3: PornHub — Restore Video Playback (Embed URL via Deno Proxy)

**Scope**: `getStream` method of the `pornhub` adapter.

### Problem

`getStream` calls `cherryFetch(video.url)`. `video.url` is `https://www.pornhub.com/view_video.php?viewkey=phXXX` or `https://rt.pornhub.com/view_video.php?viewkey=phXXX`. The `rt.pornhub.com` variant returns HTTP 503 from both proxies. Even the `www.pornhub.com` view_video page may not return the `flashvars` block reliably.

The embed URL `https://www.pornhub.com/embed/{viewkey}` returns a 56KB page containing the `flashvars_NNN` block and `mediaDefinitions` array in the exact format the current parser handles. `www.pornhub.com` is already in `PROXY_URL_2_HOSTS`, so `cherryFetch` will route embed requests through Deno automatically.

### Required Changes

Replace `getStream` to extract the viewkey, construct the embed URL, and apply the existing parsing logic:

```javascript
getStream: function(video) {
  // Extract viewkey from any pornhub URL variant
  var vkMatch = (video.url || '').match(/viewkey=([a-z0-9]+)/i);
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

The parsing logic (flashvars regex, mediaDefinitions iteration, HLS proxyM3u8 path, MP4 preference) is UNCHANGED from the current implementation. Only the fetch URL changes from `video.url` to `embedUrl`.

### No Proxy Table Change Required

`www.pornhub.com` is already in `PROXY_URL_2_HOSTS`. The embed URL hostname is `www.pornhub.com`. No REQ-5 entry for PornHub.

### Done When

- `getStream` on a `VideoCard` with `url = 'https://www.pornhub.com/view_video.php?viewkey=phXXX'` or `url = 'https://rt.pornhub.com/view_video.php?viewkey=phXXX'` returns `StreamResult` with non-empty `url`.
- `StreamResult.url` is either a direct MP4 URL or a `blob:` URL (proxied HLS).
- `StreamResult.quality` contains at least one key.
- A `VideoCard` that has no `viewkey` in its URL returns `{ url: '', quality: {} }` (not a crash).
- E2E test for `pornhub` stream is reachable (HTTP 200/206).

---

## REQ-4: Eporner — Restore Video Playback (Proxy for Video Page and XHR)

**Scope**: `getStream` and `_mapVideo` methods of the `eporner` adapter, plus the `_apiFetch` doc comment.

### Problem

`getStream` uses `_apiFetch` (raw `fetch()`) for two requests:
1. Video page: `https://www.eporner.com/hd-porn/{id}/` — returns a CORS error in browser context; also uses the obsolete URL format.
2. XHR endpoint: `https://www.eporner.com/xhr/video/{id}?hash=...` — no CORS header, fails with raw `fetch()`.

The Deno proxy returns the real 97KB page with the `hash` pattern present. Switching both calls to `cherryFetch` (which will route through Deno once `www.eporner.com` is added to `PROXY_URL_2_HOSTS`) fixes both.

Additionally, `_mapVideo` constructs the URL fallback as `'https://www.eporner.com/hd-porn/' + v.id + '/'` but the API now returns URLs in `/video-{id}/{slug}/` format via `v.url`. The fallback is stale.

### Required Changes

**1. `getStream`: switch both `_apiFetch` calls to `cherryFetch`, use `video.url` for page URL**

```javascript
getStream: function(video) {
  // Use video.url directly — API returns correct /video-{id}/{slug}/ format
  var pageUrl = video.url;
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

Key changes from current implementation:
- `self._apiFetch(pageUrl)` → `cherryFetch(pageUrl)`
- `pageUrl` is now `video.url` (correct current-format URL) instead of hardcoded `'https://www.eporner.com/hd-porn/' + id + '/'`
- `self._apiFetch(xhrUrl)` → `cherryFetch(xhrUrl)`
- The `var id = video.id;` line and stale `pageUrl` construction are removed
- Hash computation logic, XHR URL construction, and JSON parsing are UNCHANGED

**2. `_mapVideo`: remove stale `/hd-porn/` fallback**

```javascript
// BEFORE
url: v.url || ('https://www.eporner.com/hd-porn/' + v.id + '/'),

// AFTER
url: v.url || ('https://www.eporner.com/video-' + v.id + '/'),
```

The fallback still uses `v.id` in case `v.url` is ever absent, but now constructs a URL in the current format. The slug portion is omitted from the fallback — the server redirects `/video-{id}/` to the canonical URL with slug, so `getStream` will still receive and parse a valid page.

**3. `_apiFetch` doc comment: update to clarify scope**

```javascript
// BEFORE
// eporner API supports Access-Control-Allow-Origin: * — direct fetch bypasses CF datacenter IP block

// AFTER
// eporner JSON search/browse API has Access-Control-Allow-Origin: * — direct fetch is safe here.
// Do NOT use for HTML page fetches (video pages, XHR endpoint) — use cherryFetch() for those.
```

`_apiFetch` itself is UNCHANGED in implementation. It continues to be used exclusively by `search` and `browse`.

### Done When

- `getStream` on a valid `VideoCard` with `url = 'https://www.eporner.com/video-XXXXX/slug/'` returns `StreamResult` with non-empty `url` and `quality`.
- `StreamResult.quality` keys follow label format used by the XHR response (e.g. `'1080p'`, `'720p'`).
- `getStream` does NOT call raw `fetch()` at any point (all external calls go through `cherryFetch`).
- `_mapVideo` on a response object with `v.url = ''` and `v.id = '12345'` produces `url = 'https://www.eporner.com/video-12345/'`.
- E2E test for `eporner` stream is reachable (HTTP 200/206).

---

## REQ-5: PROXY_URL_2_HOSTS — Update Routing Table

**Scope**: `PROXY_URL_2_HOSTS` object at the top of `plugin.js` (lines ~13–26) AND the mirrored copy in `test/cherry-lampa-e2e.mjs` (lines ~30–40).

### Required Changes

**plugin.js:**

```javascript
// REMOVE (spankbang.com/www.spankbang.com are JS-challenge gated and useless):
'spankbang.com': 1, 'www.spankbang.com': 1,

// ADD (ru subdomain bypasses JS challenge; verified by GATE-1):
'ru.spankbang.com': 1,

// ADD (www.eporner.com video pages need Deno proxy; CF Worker returns obfuscated redirect):
'www.eporner.com': 1,
```

After the change, the SpankBang block in `PROXY_URL_2_HOSTS` becomes:
```javascript
'ru.spankbang.com': 1,
```

After the change, Eporner is added after the existing tizam entry (or in logical grouping with a comment):
```javascript
// eporner.com — CF Worker returns 369B obfuscated JS redirect for video pages; Deno returns real page
'www.eporner.com': 1,
```

**test/cherry-lampa-e2e.mjs:**

The E2E test file contains a mirrored copy of `PROXY_URL_2_HOSTS` (lines ~30–40). This MUST be kept in sync. Apply the identical domain changes there.

The `plugin-helpers.test.js` unit test contains a sync-check assertion enforcing parity between the plugin.js table and the E2E mirror. After updating both, the sync-check must pass.

### Done When

- `buildProxyUrl('https://ru.spankbang.com/xyz/video/')` selects `PROXY_URL_2` (Deno Deploy base).
- `buildProxyUrl('https://spankbang.com/xyz/video/')` selects `PROXY_URL` (CF Worker base, effectively removing Deno routing for the bare domain which can never respond usefully anyway).
- `buildProxyUrl('https://www.eporner.com/video-123/slug/')` selects `PROXY_URL_2`.
- `buildProxyUrl('https://www.eporner.com/api/v2/video/search/?...')` selects `PROXY_URL_2` (also `www.eporner.com`, so same routing — this is acceptable since `_apiFetch` uses raw `fetch()` and bypasses `buildProxyUrl` entirely; routing of this hostname in the table is irrelevant to search/browse).
- `test/cherry-lampa-e2e.mjs` `PROXY_URL_2_HOSTS` mirror matches `plugin.js`.
- `plugin-helpers.test.js` sync-check assertion passes (`npm test`).

---

## REQ-6: Documentation — Update CHERRY.md

**Scope**: `docs/CHERRY.md` only. No code changes.

### Required Changes

**6.1 — Source Status table: HQPorner stream note**

In the "Browse works, video broken (CDN architecture limitation)" table, update the HQPorner row to explicitly label this as permanent:

```markdown
| `hqporner` | 50 | **bigcdn.cc blocks all Cloudflare datacenter IPs.** Embed player (mydaddy.cc) hosts video on `sN.bigcdn.cc` → 403/404 to any CF Worker fetch. Not fixable via proxy. |
```

Change to:
```markdown
| `hqporner` | 50 | **bigcdn.cc blocks all Cloudflare datacenter IPs — permanently broken.** CDN returns 404 from CF Worker, Deno Deploy, and residential IPs alike. Browse remains functional. Stream is unrecoverable without a self-hosted FlareSolverr or residential relay; not fixable at the proxy tier. |
```

**6.2 — Adapter table: HQPorner protocol description**

In the "Source Adapters — Full List" table, row for `hqporner`:

```markdown
| 6 | `hqporner` | HQPorner | hqporner.com | HTML → mydaddy.cc embed → bigcdn.cc CDN |
```

Change to:
```markdown
| 6 | `hqporner` | HQPorner | hqporner.com | HTML → mydaddy.cc embed → bigcdn.cc CDN **(stream broken — bigcdn.cc unreachable from all proxy tiers; browse functional)** |
```

**6.3 — Source Status table: SpankBang entry**

Move SpankBang from the "0 cards — not fixable" section to the "Browse + Video working" section (conditional on GATE-1 passing). If GATE-1 fails, keep in current section and add a note that `ru.spankbang.com` was tested and also challenge-gated.

If GATE-1 passes:

Remove from "0 cards — not fixable":
```markdown
| `spankbang` | Cloudflare JS challenge on all paths; blocks CF Worker and Deno Deploy equally |
```

Add to "Browse + Video working" table:
```markdown
| `spankbang` | ~30 | **Via Deno Deploy proxy** (`ru.spankbang.com`); `spankbang.com` and `www.spankbang.com` remain JS-challenge gated and are removed from `PROXY_URL_2_HOSTS`. Quality map extraction primary, streamkey POST fallback. |
```

Update the narrative paragraph under "0 cards — not fixable" to note that `ru.spankbang.com` bypasses the challenge:

```markdown
SpankBang protects `spankbang.com` and `www.spankbang.com` with Cloudflare JS challenge. The Russian regional subdomain `ru.spankbang.com` does NOT trigger the JS challenge from Deno Deploy IPs and is used instead.
```

Or if GATE-1 fails, add to the `spankbang` row:
```markdown
| `spankbang` | Cloudflare JS challenge on all paths. `ru.spankbang.com` tested 2026-05-28 — also JS-challenge gated from Deno Deploy. No fixable path found at proxy tier. |
```

**6.4 — Proxy Layer section: PROXY_URL_2_HOSTS comment**

The comment on line 11 says:
```
// Secondary proxy on Deno Deploy — used for sites that block Cloudflare datacenter IPs (xnxx, spankbang)
```

Update to:
```
// Secondary proxy on Deno Deploy — used for sites that block Cloudflare datacenter IPs (xnxx, ru.spankbang.com, eporner video pages)
```

**6.5 — Eporner entry: URL format note**

In the Source Status "Browse + Video working" table, the `eporner` row notes direct fetch. Update to reflect:
- Video page fetches now go through Deno proxy
- URL format is `/video-{id}/{slug}/`

```markdown
| `eporner` | ~30 | **Via Deno Deploy proxy** for video pages (`www.eporner.com` added to `PROXY_URL_2_HOSTS`); JSON search/browse API still uses direct fetch (CORS-open). URL format: `/video-{id}/{slug}/`. |
```

**6.6 — Secondary proxy description**

In the "Proxy Layer" section, update:
```
Used for hostnames in `PROXY_URL_2_HOSTS` (`xnxx.com`, `spankbang.com`) that block Cloudflare datacenter IPs at ASN level.
```

Change to:
```
Used for hostnames in `PROXY_URL_2_HOSTS` (`xnxx.com`, `ru.spankbang.com`, `www.eporner.com`, and others) that block Cloudflare datacenter IPs at ASN level or return unusable responses from the CF Worker.
```

### Done When

- `docs/CHERRY.md` HQPorner row in adapter table contains `(stream broken` note.
- HQPorner in "Browse works, video broken" section explicitly states "permanently broken" and "not fixable at the proxy tier".
- SpankBang section updated to reflect current status (per GATE-1 outcome).
- Eporner status row updated to show Deno proxy usage for video pages.
- `PROXY_URL_2` description in Proxy Layer section is accurate.

---

## REQ-7: plugin-release Sync

**Scope**: `plugin-release/plugin.js`.

### Required Changes

After all code changes in `plugin.js` are complete and verified (REQ-1 through REQ-5, REQ-8, and REQ-9), apply the identical diff to `plugin-release/plugin.js`.

This is a mechanical copy step. The simplest correct implementation:

```
cp plugin.js plugin-release/plugin.js
```

Verify the files are identical:
```
diff plugin.js plugin-release/plugin.js
# Expected: no output (zero diff)
```

### Done When

- `diff plugin.js plugin-release/plugin.js` exits with code 0 and produces no output.
- `plugin-release/plugin.js` contains all changes from REQ-1 through REQ-5, REQ-8, and REQ-9.

---

## REQ-8: pornone — CDN Token IP-Pinning Fix

**Scope**: `getStream` of the `pornone` adapter + `PROXY_URL_2_HOSTS`.

### Problem

pornone CDN issues per-IP signed tokens embedded in stream URLs. The current `getStream` uses `cherryFetch` (CF Worker) to fetch the page, then routes the CDN stream URLs through `buildProxyUrl` (also CF Worker, since pornone.com is not in `PROXY_URL_2_HOSTS`). CF Workers are distributed — the page-fetch and stream-fetch may hit different CF edge nodes with different IPs. If the CDN binds the stream token to the page-fetch IP, the stream request from a different CF edge IP is rejected (403/403 with invalid token).

This issue was identified in the previous `multi-source-video-fix` task but blocked on identifying the CDN hostname.

### Prerequisite: GATE-3 — Identify pornone CDN hostname and test Deno routing

```
# Step 1: Get a real CDN URL from a live getStream call
curl "https://cherry-proxy.aawersom.workers.dev/proxy?url=https%3A%2F%2Fpornone.com%2F&key=1206" \
  -s | grep -oE 'https://[^"'"'"']+\.(mp4|m3u8)[^"'"'"']*' | head -5
# Note the CDN hostname (e.g. cdn.pornone.com or similar)

# Step 2: Test a real stream URL through Deno proxy
curl -I "https://cherry-proxy.aawersom.deno.net/proxy?url=<CDN_URL_encoded>&key=1206"
# Expected: HTTP 200/206, Content-Type: video/mp4 or similar
# If 403: CDN also blocks Deno IPs → see fallback below
```

If GATE-3 shows the CDN hostname, proceed to Required Changes below.
If GATE-3 shows Deno also gets 403, treat pornone as Tier C infrastructure-blocked (same as hqporner stream) — document in REQ-6.

### Required Changes (conditional on GATE-3 passing)

**Strategy A (preferred — CDN-only routing):** Add only the CDN hostname to `PROXY_URL_2_HOSTS`. The page fetch continues through CF Worker; only the stream goes through Deno. This works if the CDN token is NOT bound to the page-fetch IP, but only requires a consistent stream-fetch IP.

**Strategy B (if Strategy A fails):** If the token IS bound to the page-fetch IP, add BOTH `pornone.com` AND the CDN hostname to `PROXY_URL_2_HOSTS`. This routes both page fetch and stream fetch through Deno Deploy, ensuring IP consistency.

The implementer must test Strategy A first (lower Deno load) and only proceed to Strategy B if A fails.

**PROXY_URL_2_HOSTS addition (Strategy A):**
```javascript
// pornone CDN — IP-locked tokens require Deno proxy for stream consistency
'<CDN_HOSTNAME>': 1,
```

**PROXY_URL_2_HOSTS addition (Strategy B):**
```javascript
// pornone — token IP-binding requires page + stream on same Deno edge
'pornone.com': 1,
'<CDN_HOSTNAME>': 1,
```

No changes to `pornone.getStream` code are required for either strategy (the existing `buildProxyUrl` wrapping already handles routing).

The `test/cherry-lampa-e2e.mjs` `PROXY_URL_2_HOSTS` mirror must also be updated (same as REQ-5).

### Done When

- `pornone.getStream` returns `StreamResult.url` that responds HTTP 200/206 with video/* content-type when fetched through the proxy.
- The CDN hostname identified in GATE-3 is present in `PROXY_URL_2_HOSTS`.
- `test/cherry-lampa-e2e.mjs` mirror is in sync.
- If GATE-3 fails: `docs/CHERRY.md` updated to note pornone stream as infrastructure-blocked (CDN blocks all proxy IPs).

---

## REQ-9: xnxx — Add Specific Parser for HTML5 Player

**Scope**: `getStream` of the `xnxx` adapter.

### Problem

`xnxx.getStream` uses only `extractStreams(html)` with no site-specific parser. xnxx uses a custom HTML5 player with JavaScript patterns:
- `html5player.setVideoHLS('https://...m3u8');` — primary HLS stream
- `html5player.setVideoUrlHigh('https://...mp4');` — high-quality MP4
- `html5player.setVideoUrlLow('https://...mp4');` — low-quality MP4

`extractStreams` does not have a branch for these patterns. The generic URL fallback (`(?:https?:)?\/\/[^"'\s]+\.mp4`) may catch the MP4 URLs incidentally, but HLS (`.m3u8`) in a `html5player.setVideoHLS('...')` call is NOT caught unless xnxx also embeds the URL elsewhere.

The `xvideos` adapter (same company as xnxx, same player codebase) already implements exact parsers for these patterns. xnxx should use the same approach.

### Prerequisite: GATE-4 — Verify current extractStreams result

```
# Fetch a live xnxx video page through Deno proxy and check if extractStreams finds URLs
# Use: node -e "require script" or check E2E results for xnxx adapter
```

If `xnxx.getStream` already returns a non-empty `url` for a live video (extractStreams happens to catch the MP4 URL via generic fallback), and the URL is HTTP-reachable: **no change required** — mark REQ-9 as skipped.

If `xnxx.getStream` returns empty `url` or only catches a low-quality MP4 without HLS: proceed with Required Changes.

### Required Changes (conditional on GATE-4 failing)

Add site-specific parser to `xnxx.getStream` **before** the `extractStreams(html)` fallback call. The parser follows the exact same pattern as the `xvideos` adapter:

```javascript
getStream: function(video) {
  return cherryFetch(video.url).then(function(html) {
    var quality = {};
    var url = '';

    // Primary: HLS master playlist
    var hlsM = html.match(/html5player\.setVideoHLS\('([^']+)'\)/);
    if (hlsM) {
      return proxyM3u8(hlsM[1], 'https://www.xnxx.com/').then(function(blob) {
        return { url: blob, quality: { 'hls': blob } };
      }).catch(function() {
        // HLS failed, fall through to MP4
        return _xnxxMp4(html);
      });
    }

    return _xnxxMp4(html);

    function _xnxxMp4(h) {
      var highM = h.match(/html5player\.setVideoUrlHigh\('([^']+)'\)/);
      var lowM  = h.match(/html5player\.setVideoUrlLow\('([^']+)'\)/);
      if (highM) quality['720p'] = highM[1];
      if (lowM)  quality['480p'] = lowM[1];
      if (Object.keys(quality).length) {
        return { url: bestQualityUrl(quality), quality: quality };
      }
      return extractStreams(h);
    }
  }).catch(function() { return { url: '', quality: {} }; });
}
```

Note: the quality labels `'720p'` and `'480p'` are approximate. If the live page HTML shows different quality indicators (e.g. `1080p`/`720p`), use those instead. The implementer must inspect at least one real page before assigning labels.

`_xnxxMp4` is a named inner function to avoid an anonymous closure. It does NOT become a module-scope helper (INV-4: no new module-scope variables).

### Done When

- `xnxx.getStream` on a live video card returns `StreamResult` with non-empty `url`.
- If HLS is available: `StreamResult.url` is a `blob:` URL (proxied m3u8).
- If MP4 only: `StreamResult.quality` has at least one numeric key.
- E2E test for `xnxx` passes (Tier D stream check).
- If GATE-4 shows extractStreams already works: REQ-9 is explicitly marked skipped in implementation notes.

---

## Out of Scope

### HQPorner stream
Root cause: `bigcdn.cc` CDN returns HTTP 404 from all IP tiers — CF Worker, Deno Deploy, and residential. This is a CDN infrastructure decision that cannot be circumvented by proxy selection. No code change is warranted. Documentation update only (REQ-6).

### Other 22 adapters
No regressions are expected from REQ-1 through REQ-5. The only cross-adapter changes are to `PROXY_URL_2_HOSTS`, which affects only hostname routing. Removing `spankbang.com`/`www.spankbang.com` has no effect on other adapters (those hostnames are only used by the SpankBang adapter). Adding `ru.spankbang.com` and `www.eporner.com` affects only SpankBang and Eporner respectively. No shared helpers are modified.

### PornHub browse/search
The Webmasters API (`/webmasters/search`) is not broken. `www.pornhub.com` is already in `PROXY_URL_2_HOSTS`. No browse changes needed.

### Eporner browse/search
`_apiFetch` for JSON API endpoints (CORS-open) is not broken. No browse changes needed.

### SpankBang post-stream POST endpoint reliability
The `cherryPost` path for streamkey is retained as a fallback. Whether the POST endpoint itself works reliably is not in scope — it exists as a safety net if the quality map regex finds no entries.

### E2E test harness changes beyond PROXY_URL_2_HOSTS mirror
The E2E test tiers, count guards, and test logic do not need modification. SpankBang is already in Tier D (special handling). The `PROXY_URL_2_HOSTS` mirror update (REQ-5) is the only required change in `test/cherry-lampa-e2e.mjs`.

---

## Review Decisions — Parked Findings

### Parked: Tech review critical — "REQ-4 switches _apiFetch to cherryFetch, breaking CORS-bypass design"

**Finding**: The technical reviewer flagged switching `_apiFetch` to `cherryFetch` in `getStream` as a critical error, citing that `www.eporner.com` has `Access-Control-Allow-Origin: *` and raw fetch is safe.

**Not confirmed by code inspection**: The `_apiFetch` CORS exception applies exclusively to the Eporner JSON search/browse API (`/api/v2/video/search/`, `/api/v2/video/browse/`). The inline comment at the `_apiFetch` definition documents this. The video HTML pages (`/video-{id}/{slug}/`) and the XHR hash endpoint (`/xhr/video/{id}?hash=...`) do NOT carry CORS headers — confirmed by: (a) the user report that eporner getStream is broken in production, (b) the orchestrator diagnostic which found raw fetch to video pages triggers a CORS error, and (c) the CF Worker returning a 369B obfuscated redirect instead of the real page. Switching `getStream` to `cherryFetch` is the correct fix. The `_apiFetch` function remains unchanged and continues to be used by `search` and `browse`.

---

## Open Questions

### OQ-1: SpankBang search URL structure on ru.spankbang.com
The orchestrator verified `ru.spankbang.com/new/1/` and `ru.spankbang.com/new/2/` (browse). It did not verify `ru.spankbang.com/s/{query}/{page}/` (search). The search URL pattern may differ on the Russian subdomain. The implementer should verify search returns a populated page before committing the search URL change. If the path differs, adjust the `search` method URL template accordingly.

### OQ-2: SpankBang quality map label completeness
The orchestrator found `'720p': ['...']` in a sample. It is unknown whether `'4k'`, `'2160p'`, or other non-standard labels appear. The regex `'([0-9]+(?:p|k))'\s*:\s*\['(https?:\/\/[^']+)'` covers `720p`, `1080p`, `480p`, `4k`, `2k` but not labels like `'2160p'` if SpankBang uses them. The implementer should run the regex against a few real video pages and expand the character class if needed.

### OQ-3: Eporner XHR `video.id` vs. id in URL
`getStream` currently uses `var id = video.id` to construct the XHR URL. `video.id` comes from `_mapVideo` which sets it from `String(v.id)`. The XHR URL `...xhr/video/{id}...` uses the numeric Eporner video ID. Verify that `video.url` of the form `/video-{id}/{slug}/` always contains the same numeric ID as `video.id`, so the XHR URL construction remains correct. If `v.id` in the API response and the ID in `v.url` are always identical, no change is needed to the XHR URL line.

### OQ-4: CF Worker behaviour for www.eporner.com after PROXY_URL_2_HOSTS change
Once `www.eporner.com` is added to `PROXY_URL_2_HOSTS`, all `cherryFetch` calls to that hostname go through Deno Deploy. The search/browse methods use `_apiFetch` (raw `fetch()`) which bypasses `buildProxyUrl` entirely, so they are unaffected. Confirm `_apiFetch` will not be accidentally replaced with `cherryFetch` for search/browse in any future refactor by ensuring the doc comment (REQ-4, change 3) is clear.

---

## Test Criteria (Per-REQ Verification)

### REQ-1 verification

| Check | Method | Pass Condition |
|---|---|---|
| Browse returns cards | Call `spankbang.browse('', 1)` in browser with plugin loaded | `result.items.length >= 10` |
| Card URLs use ru subdomain | Inspect `result.items[0].url` | Starts with `https://ru.spankbang.com/` |
| Card IDs are scoped | Inspect `result.items[0].id` | Matches `sb-[\w-]+` |
| Card titles non-empty | Inspect `result.items[0].title` | Non-empty string |
| Thumbnails non-empty | Inspect `result.items[0].thumb` | Non-empty string starting with `https://` |
| Search returns cards | Call `spankbang.search('teen', 1)` | `result.items.length >= 5` |
| No old domain in URLs | Scan all `result.items` URLs | None contain `://spankbang.com/` (without `ru.` prefix) |

### REQ-2 verification

| Check | Method | Pass Condition |
|---|---|---|
| Stream URL non-empty | Call `spankbang.getStream(card)` | `result.url.length > 0` |
| Quality map populated | Inspect `result.quality` | `Object.keys(result.quality).length >= 1` |
| Stream reachable | HEAD `result.url` via Deno proxy | HTTP 200 or 206, Content-Type: video/* |
| Quality regex fires | Use a card with known quality map in HTML | `result.url` is a `sb-cd.com` MP4 URL |
| Streamkey fallback fires | Use a card with `data-streamkey` but no quality map | `result.url` is non-empty (POST path or extractStreams) |

### REQ-3 verification

| Check | Method | Pass Condition |
|---|---|---|
| Stream URL non-empty | Call `pornhub.getStream(card)` | `result.url.length > 0` |
| Quality map populated | Inspect `result.quality` | `Object.keys(result.quality).length >= 1` |
| Stream reachable | Fetch `result.url` | HTTP 200/206 or blob: URL plays |
| rt.pornhub.com card works | Use card with `url` containing `rt.pornhub.com` | viewkey extracted, embed fetched, stream returned |
| Missing viewkey handled | Call with `video.url = 'https://www.pornhub.com/no-viewkey'` | Returns `{ url: '', quality: {} }` without crash |

### REQ-4 verification

| Check | Method | Pass Condition |
|---|---|---|
| Stream URL non-empty | Call `eporner.getStream(card)` | `result.url.length > 0` |
| Quality map populated | Inspect `result.quality` | At least one `NNNp` key |
| No raw fetch call | Code audit of `getStream` | Zero occurrences of `_apiFetch(` inside `getStream` |
| video.url used | Code audit of `getStream` | Uses `video.url` as `pageUrl`, not hardcoded `/hd-porn/` |
| Fallback URL format | Call `_mapVideo({id: '99', url: ''})` | `.url === 'https://www.eporner.com/video-99/'` |
| E2E stream reachable | E2E test | `eporner` stream HEAD returns 200/206 |

### REQ-5 verification

| Check | Method | Pass Condition |
|---|---|---|
| ru.spankbang.com → Deno | `buildProxyUrl('https://ru.spankbang.com/x/')` | URL starts with `PROXY_URL_2` |
| spankbang.com → CF | `buildProxyUrl('https://spankbang.com/x/')` | URL starts with `PROXY_URL` (CF Worker) |
| www.eporner.com → Deno | `buildProxyUrl('https://www.eporner.com/video-1/')` | URL starts with `PROXY_URL_2` |
| E2E mirror matches plugin | Run `npm test` (plugin-helpers.test.js sync-check) | Exits 0 |

### REQ-6 verification

| Check | Method | Pass Condition |
|---|---|---|
| HQPorner table note | Read `docs/CHERRY.md` adapter table row | Contains `(stream broken` |
| HQPorner status note | Read "Browse works, video broken" section | Contains "permanently broken" |
| SpankBang status | Read corresponding section | Updated per GATE-1 outcome |
| Eporner status | Read "Browse + Video working" table | Contains "Deno Deploy proxy" for video pages |
| Proxy description | Read "Proxy Layer" section | Lists `ru.spankbang.com` and `www.eporner.com` |

### REQ-7 verification

| Check | Method | Pass Condition |
|---|---|---|
| Files identical | `diff plugin.js plugin-release/plugin.js` | Exit code 0, no output |

---

## Implementation Order

The requirements must be implemented in this order to ensure each step is verifiable before the next:

1. **GATE-1** — verify `ru.spankbang.com` reachability. Gate SpankBang work on result.
2. **REQ-5** — update `PROXY_URL_2_HOSTS` in `plugin.js` and E2E mirror in `test/cherry-lampa-e2e.mjs`. Run `npm test` to confirm sync-check passes.
3. **REQ-4** — fix Eporner `getStream` and `_mapVideo`. Test in isolation.
4. **REQ-3** — fix PornHub `getStream`. Test in isolation.
5. **REQ-1 + REQ-2** — fix SpankBang `_parseCards`, URLs, and `getStream` together (they are coupled via `video.url` base domain).
6. **REQ-6** — update `docs/CHERRY.md`.
7. **E2E baseline migration** — After REQ-1+2 (SpankBang fix), run `node test/cherry-lampa-e2e.mjs` once. SpankBang was previously producing 0 cards (broken); the baseline file (`test/cherry-e2e-baseline.json`) captures that state. The E2E harness compares results against baseline and will flag SpankBang's new N-card output as a deviation. After confirming the new results are correct, run the baseline migration command (`npm run e2e:update-baseline` or equivalent) to update the baseline for SpankBang. Only then proceed to the full regression run.
8. **GATE-3** — Identify pornone CDN hostname and test Deno routing. Implement REQ-8 per result.
9. **GATE-4** — Verify xnxx extractStreams output. Implement REQ-9 if needed.
10. **REQ-7** — sync `plugin-release/plugin.js` (covers all changes: REQ-1 through REQ-5, REQ-8, REQ-9).
11. **Full E2E run** — `node test/cherry-lampa-e2e.mjs` — confirm spankbang, pornhub, eporner, pornone, and xnxx all exit Tier D with passing stream checks.
