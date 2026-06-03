# Spec: source-stream-fix

**Task slug:** source-stream-fix
**Date:** 2026-06-03
**Files in scope:**
- `plugin.js` — proxy routing tables, `buildProxyUrl`, 8 adapter `getStream` methods
- `workers/cherry-proxy/src/index.js` — `RESIDENTIAL` set, `fetchViaResidential` rotation

---

## Overview

Eight source adapters have broken or degraded stream playback due to incorrect proxy routing,
a client-side M3U8 double-wrap, missing Referer headers on CDN fetches, and stale hostname
entries in the proxy routing tables. This task restores reliable stream playback for all eight
sources with the minimum set of targeted changes to `plugin.js` and `index.js`.

ES5 constraint applies to all changes in `plugin.js`. ES6+ (ESM) applies to `index.js`.
The `SourceAdapter` interface signatures and `StreamResult` shape are frozen and must not change.

---

## Requirements

### REQ-1 — pornhub: eliminate M3U8 double-proxy

Quality map values MUST be produced by `buildProxyUrl(hlsUrl, 'https://www.pornhub.com/')`
directly, not by `proxyM3u8(...)`. The `proxyM3u8` function and `_blobUrls` listener MUST
remain (used by other adapters). `www.pornhub.com` and `rt.pornhub.com` MUST remain in
`PROXY_URL_3_HOSTS` and `RESIDENTIAL`.

**Segment routing note:** Pornhub HLS segments are served from `ev-h.phncdn.com` (CDN, not
pornhub.com). `ev-h.phncdn.com` is NOT in `RESIDENTIAL` and does NOT require SOCKS5 — phncdn.com
accepts CF datacenter IPs directly. Direct CF fetch to phncdn.com is correct. The `referer`
param in the proxy URL covers the manifest fetch only; segment delivery relies on signed token
params embedded in segment URLs, not on Referer or IP pinning.

**`px()` PROXY_URL_3 guard (sub-requirement):** Add a third double-proxy guard to `px()` in
`playVideo`: `if (PROXY_URL_3 && u.indexOf(PROXY_URL_3) === 0) return u;`
Currently only `PROXY_URL` and `PROXY_URL_2` are guarded (lines 334–335); this closes the gap.

### REQ-2 — eporner: revert routing from CF SOCKS5 to Deno

`www.eporner.com` MUST be removed from `PROXY_URL_3_HOSTS` and added to `PROXY_URL_2_HOSTS`
in `plugin.js`. `www.eporner.com` MUST be removed from `RESIDENTIAL` in `index.js`.
No changes to eporner `getStream` logic are required.

### REQ-3 — spankbang: revert routing from CF SOCKS5 to Deno

`ru.spankbang.com` MUST be removed from `PROXY_URL_3_HOSTS` and added to `PROXY_URL_2_HOSTS`.
`www.spankbang.com` MUST be removed from `PROXY_URL_3_HOSTS` but MUST NOT be added to
`PROXY_URL_2_HOSTS` (it remains JS-challenge gated; falls through to CF Worker direct fetch,
no stream is fetched from that domain directly). Both MUST be removed from `RESIDENTIAL`.
No changes to spankbang `getStream` logic are required.

### REQ-4 — hqporner: replace hardcoded bigcdn subdomain list with regex

All individual `sN.bigcdn.cc` entries in `PROXY_URL_2_HOSTS` MUST be replaced by a
`/\.bigcdn\.cc$/` regex check folded into the existing compound condition in `buildProxyUrl`
(not a separate branch). The in-code comment on that line MUST be updated to reflect that
bigcdn is now covered by regex, not hardcoded entries.

No changes to hqporner `getStream` logic are required.

### REQ-5 — pornone: move routing from Deno to CF Worker SOCKS5

The following MUST be removed from `PROXY_URL_2_HOSTS`:
`pornone.com`, `www.pornone.com`, `gallery.vcmdiawe.com`, `galleryn2.vcmdiawe.com`.

The `/\.pornone\.com$/` regex check MUST be removed from `buildProxyUrl`.

**MUST (atomicity):** Both removals above MUST be in the same atomic commit. Removing
only one without the other is a broken intermediate state and MUST NOT be merged.

The following MUST be added to `RESIDENTIAL` in `index.js`:
`pornone.com`, `www.pornone.com`, `gallery.vcmdiawe.com`, `galleryn2.vcmdiawe.com`.

Note: `gallery.vcmdiawe.com` and `galleryn2.vcmdiawe.com` are pornone CDN domains that do
not match `/\.pornone\.com$/` and MUST be added as static `Set` entries (not covered by
the wildcard below) to avoid IP-bound token failures on direct CF fetch.

The routing check in `index.js` line 291 MUST change to:
```javascript
RESIDENTIAL.has(parsedTarget.hostname) || /\.pornone\.com$/.test(parsedTarget.hostname)
```
so that any `*.pornone.com` CDN subdomain routes via `fetchViaResidential`.

No changes to pornone `getStream` logic are required.

**Final state of `buildProxyUrl` condition after REQ-4 + REQ-5:**
```javascript
if (PROXY_URL_2_HOSTS[h] || /\.bigcdn\.cc$/.test(h)) base = PROXY_URL_2;
```
`/\.pornone\.com$/` is gone (REQ-5). Hardcoded bigcdn entries are gone (REQ-4).

### REQ-6 — CF Worker: replace time-based SOCKS5 rotation with referer-domain hash

The `startIdx` computation in `fetchViaResidential` (`index.js` line 171) MUST be replaced
with a deterministic hash (character-code sum or DJB2) over the referer domain (or target
hostname when no referer is provided). No external state, KV store, or async I/O. The
fallback rotation on failure MUST be preserved.

Domain extraction MUST use this exact expression (handles malformed referer gracefully):
```javascript
const domain = referer
  ? (() => { try { return new URL(referer).hostname; } catch(_){} return new URL(targetUrl).hostname; })()
  : new URL(targetUrl).hostname;
```

### REQ-7 — porntrex: pass Referer on CDN stream URL

In the porntrex `getStream`, all returned stream URLs MUST be wrapped with
`buildProxyUrl(url, 'https://www.porntrex.com/')`. Do not modify `_kvsPickBest` — wrap
its output at the call site. For the `_kvsPickBest` path, BOTH `url` AND each value in the
`quality` map must be wrapped (the `px()` helper re-proxies quality values but without referer):
```javascript
var result = _kvsPickBest(found);
var q = {};
Object.keys(result.quality).forEach(function(k) {
  q[k] = buildProxyUrl(result.quality[k], 'https://www.porntrex.com/');
});
return { url: buildProxyUrl(result.url, 'https://www.porntrex.com/'), quality: q };
```

### REQ-8 — porndig: prioritize direct stream patterns in iframe path

The porndig `getStream` already fetches the iframe player page. BEFORE the existing
`extractStreams(ihtml)` call, insert porndig-specific pattern matching for:
- `file:` or `src:` key in a JS object literal pointing to `.mp4` or `.m3u8`
- `sources` array first-element `file` property
- `data-src` attribute on `<video>` or `<source>` element

The `extractStreams` fallback chain and `StreamResult` shape MUST be preserved.

### REQ-9 — 24rolika: wrap JWPlayer URL with Referer proxy

When the JWPlayer regex match succeeds (variable `m`), return
`buildProxyUrl(m[1], 'https://w2.huyalkino.com/')` instead of the raw URL.
The fallback `extractStreams(html)` path MUST remain unchanged.

---

## Acceptance Criteria

**AC-1 (pornhub):** No `blob:` URL in player `url` or `quality` map. Network shows a single
manifest request through CF Worker with no client-blob segments.

**AC-2 (eporner):** XHR API request routes through `cherry-proxy.aawersom.deno.net`. No CF
Worker SOCKS5 request for `www.eporner.com`. Stream resolves with MP4 quality map.

**AC-3 (spankbang):** `ru.spankbang.com` routes through Deno. No SOCKS5 for spankbang.
`RESIDENTIAL` does not contain `ru.spankbang.com` or `www.spankbang.com`.

**AC-4 (hqporner):** `s24.bigcdn.cc` (and any `sN.bigcdn.cc` not previously listed) routes
through Deno. All previously hardcoded subdomains also route through Deno. No bigcdn
subdomain reaches the CF Worker default path.

**AC-5 (pornone):** Pornone page and CDN requests route via CF Worker SOCKS5. No request to
`cherry-proxy.aawersom.deno.net` for pornone or its CDN subdomains. `gallery.vcmdiawe.com`
and `galleryn2.vcmdiawe.com` are static `RESIDENTIAL` entries and route via SOCKS5.

**AC-6 (CF Worker rotation):** Same referer domain always produces the same `startIdx`
regardless of call time. Two requests for the same pornone video 35 seconds apart use the
same starting proxy.

**AC-7 (porntrex):** CDN request carries `?referer=https%3A%2F%2Fwww.porntrex.com%2F`.
Stream resolves to a playable URL. All quality map values also carry the `?referer=` param.

**AC-8 (porndig):** Iframe HTML with `file:` or `sources[0].file` resolves stream via
porndig-specific patterns, not `extractStreams`. `extractStreams` is only reached as fallback.

**AC-9 (24rolika):** JWPlayer `file:` URL is sent through the proxy with
`&referer=https%3A%2F%2Fw2.huyalkino.com%2F`. Raw CDN URL is never returned to player.

---

## Out of Scope

- `search`, `browse`, `browseByModel`, `getRelated` on any adapter.
- `cherryFetch`, `cherryPost`, `extractStreams`, `bestQualityUrl`, `_kvsPickBest` function bodies.
- New proxy tiers (`PROXY_URL_4`) or new top-level variables.
- `buildProxyUrl(url, referer?)` signature.
- Any adapter not listed (xnxx, youjizz, tizam, xvideos, redtube, etc.).
- `www.spankbang.com` routing beyond REQ-3 (already covered).
- CF Worker deployment — `wrangler deploy` is out of scope for this task.
- Fav serialisation / Lampa Storage schema.
- Test file changes (separate task if needed).

---

## Risks

**RISK-1 — Double-proxy regression (pornhub, REQ-1).**
`px()` guards now cover all three proxy URLs (`PROXY_URL`, `PROXY_URL_2`, `PROXY_URL_3`).
Verify all three guards fire correctly for pornhub HLS URLs from `buildProxyUrl`.

**RISK-2 — IP-bound token window (pornone, REQ-5 + REQ-6).**
Domain-hash rotation guarantees same `startIdx` but cannot prevent IP divergence when a
proxy fails mid-flight and falls through to the next index. Residual risk; document in comments.

**RISK-3 — bigcdn Deno availability (hqporner, REQ-4).**
Confirm Deno can reach at least one `sN.bigcdn.cc` host before removing the hardcoded list.
Hardcoded entries may be left as dead code if Deno availability is uncertain.

**RISK-4 — pornone regex removal atomicity (pornone, REQ-5).**
Covered normatively in REQ-5. MUST NOT be split across separate commits.

**RISK-5 — ES5 constraint (plugin.js).**
`var`, named `function` expressions, string concatenation only. No arrow functions,
`const`/`let`, template literals, `for...of`, or destructuring. `index.js` is ESM, no constraint.
