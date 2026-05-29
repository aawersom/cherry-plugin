# Arch-Brief — Adapter Preview & Quality Map Additions

**Task:** Populate `video.preview` in xvideos, xnxx, pornhub adapters; add quality-map regex
to spankbang before existing POST fallback.
**Date:** 2026-05-29
**Author:** architecture-guardian (Mode A)

---

## 1. Architectural Invariants That Apply

### Single-file, ES5-only constraint
`plugin.js` is a single ~4100-line IIFE. **All new code must be ES5 syntax** — no `const`,
`let`, arrow functions, template literals, `Array.from`, destructuring, or spread. Regex
literals are fine. String concatenation only. `var` everywhere.

### Zero new HTTP requests from browse path
The `_169.mp4` transform for xvideos/xnxx and the `data-mediabook` extraction for pornhub
are **purely in-memory transforms on data already present in the browse HTML**. They must
not trigger additional `cherryFetch` calls. Violating this doubles browse latency and
adds to proxy quota burn.

### Adapter method contract: `_parseCards` / `_parseHtmlCards` return VideoCard[]
These are pure functions (HTML in → array out). Adding `preview` is a field addition
only; the return shape remains `VideoCard[]`. No new parameters, no side effects.

### SpankBang `getStream` phase ordering is load-bearing
The current phase structure (PRIMARY quality-map regex → FALLBACK streamkey POST →
GENERIC `extractStreams`) was established after deliberate repair work (2026-05-28).
The new quality-map regex must be **inserted at or before Phase 1**, not between
phases 1 and 2, and must not alter the fallback chain. The existing `qRe` regex in
Phase 1 already captures `'NNNp'` keys — the task's regex targets `'NNNk'` keys and
a slightly different array syntax (`['url'`). Evaluate carefully whether the existing
`qRe` already covers the new cases before adding a second pass.

---

## 2. ES5 Hard Rules

- `var` declarations only (no `let`/`const`).
- Named function expressions or declarations only (no `() =>`).
- String concatenation instead of template literals.
- No `Object.assign`, `Array.from`, `Array.isArray` (use `instanceof Array` if needed),
  `for...of`, or spread (`...`).
- Regex flags: only `g`, `i`, `m` are safe (no `s`, `u`, `y` — older Android WebViews
  may not support them).
- `try/catch` is fine; do not use `finally` on returned Promises (Lampa's environment
  may be pre-ES6 Promise polyfill).

---

## 3. VideoCard Interface Constraints

### `preview` field — Fav serialisation invariant
From `CHERRY.md` (VideoCard typedef):
> `preview` — REQ-2: URL of short preview clip (mp4/hls). **Not persisted in Fav.**

The Fav engine (`FAV` object, lines 125-167) explicitly serialises only the 7 fields:
`id, source, title, thumb, url, duration, views`. `preview` and `model` are intentionally
dropped. **Do not change the Fav persist list.** Setting `video.preview` in browse cards is
safe — it will survive through CherryGrid render and focus-hover logic, but will be absent
after a round-trip through Fav storage. The consumer (`hover:focus` handler, line 745)
already guards `if (video.preview && ...)` — no change needed there.

### `preview` field — platform guard
Line 746-748 shows the preview is already gated behind `!_isAndroid()`. Setting the field
on Android devices is harmless (the guard prevents playback), but the URL **must be reachable
without a proxy** on non-Android, since `_startPreview` sets `videoEl.src` directly — the
browser's own `<video>` element makes the request, **not** `cherryFetch`. Preview URLs that
require the proxy will fail silently in the video element on CORS-strict hosts.

---

## 4. Proxy / CORS Constraints for Preview URL Delivery

### xvideos preview (`_169.mp4` transform)
xvideos CDN thumbnails are served from `cdn77.xvideos-cdn.com` or similar CDN domains.
The `_169.mp4` transform produces a CDN MP4 URL. CDN domains for xvideos are generally
CORS-open (used for direct img/video embedding). **Verify CORS headers on a sample URL
before assuming no-proxy delivery works.** If CORS is blocked, preview must either be
routed through `buildProxyUrl()` or skipped (set `preview` to `''`).

### xnxx preview (`_169.mp4` transform)
xnxx.com is in `PROXY_URL_2_HOSTS` (Deno Deploy proxy) because Cloudflare datacenter IPs
are blocked at ASN level. The browse HTML fetch goes through Deno proxy. The CDN domain
for xnxx preview clips (typically `ci.xnxx-cdn.com` or similar) is **likely a different
hostname** not in `PROXY_URL_2_HOSTS`. Spec-writer must confirm whether the preview CDN
hostname requires proxy routing. If it does, it needs adding to `PROXY_URL_2_HOSTS` or
the preview URL must be wrapped in `buildProxyUrl()`.

### pornhub `data-mediabook` preview
Pornhub's `data-mediabook` attribute contains a CDN URL for the animated preview clip.
The CF Worker proxy domain for pornhub (`www.pornhub.com`) is already in `PROXY_URL_2_HOSTS`.
The preview CDN hostname is separate (e.g. `di.phncdn.com` or similar). Same question
applies: is this CDN CORS-open for `<video src>` direct use, or does it require proxy?
Since `_startPreview` bypasses `cherryFetch`, a CORS-blocked CDN means silent failure.
Spec-writer must confirm.

---

## 5. Android No-Proxy Mode Implications

`_isAndroid()` (used at line 746) returns true when Lampa runs inside the Android APK
wrapper. On Android, Lampa uses `Lampa.Reguest` (native HTTP) for stream resolution, which
bypasses CORS. However, `_startPreview` uses a DOM `<video>` element — **this is WebView
rendering, not native HTTP**. WebView on Android enforces CORS just like a browser.

**Consequence:** even if preview CDN is reachable natively, the DOM video element cannot
use `cherryFetch`/proxy. The `!_isAndroid()` guard in the hover handler already prevents
preview playback on Android, so `video.preview` being set is harmless there. The Android
implication is: **do not remove or weaken the `_isAndroid()` guard**.

---

## 6. What MUST NOT Change

| Area | Invariant |
|------|-----------|
| `getStream` on xvideos / xnxx | No changes — stream resolution is separate from card parse |
| SpankBang Phase 2 (streamkey POST) | Must remain as-is; new regex only adds a pre-pass or extends Phase 1 |
| SpankBang Phase 3 (`extractStreams` fallback) | Must remain as-is |
| `proxyM3u8` | Not touched by this task |
| `PROXY_URL_2_HOSTS` | Only extend if CDN hostname analysis confirms need; never remove entries |
| Fav persistence list | Stays at 7 fields; `preview` stays excluded |
| `_isAndroid()` guard in hover handler | Must remain; new code doesn't touch CherryGrid |
| KVS engine (`_kvsEngine`) | Unrelated; must not be touched |
| `cherryFetch` / `cherryPost` / `buildProxyUrl` | Proxy layer is complete; no changes |
| `extractStreams` shared helper | Unrelated to this task |

---

## 7. Spankbang Quality Regex — Overlap Risk

The spec's proposed regex:
```
/'([0-9]+)(p|k)':\s*\['(https?:\/\/[^']+)'/g
```
Group capture: `(1=digits)(2=p|k)` → label becomes `qm[1] + qm[2]` e.g. `'720p'`, `'4k'`.

The existing Phase 1 regex (`qRe`) in `getStream`:
```javascript
var qRe = /'([0-9]+(?:p|k))'\s*:\s*\['(https?:\/\/[^']+)'/gi;
```
This already matches `'720p': ['https://...'` and `'4k': ['https://...'` with the label in
group 1. **The two regexes appear functionally equivalent.** The spec-writer must either:
(a) confirm the proposed regex adds distinct coverage (different array syntax or key format),
or (b) determine that Phase 1 already covers it and no new regex is needed (the backlog item
may already be resolved by the 2026-05-28 quality-map repair).

---

## 8. Open Questions for the Spec-Writer

1. **CORS check — xvideos preview CDN**: Run `curl -I` on a sample `_169.mp4` URL and confirm
   `Access-Control-Allow-Origin` is present. If absent, previews must be proxy-wrapped or omitted.

2. **CORS check — xnxx preview CDN**: Same. xnxx CDN hostname likely differs from browse origin
   (`www.xnxx.com`). Confirm whether it needs adding to `PROXY_URL_2_HOSTS`.

3. **CORS check — pornhub `data-mediabook` CDN**: Same. Confirm the mediabook clip CDN allows
   cross-origin `<video>` loading.

4. **SpankBang quality regex redundancy**: Compare proposed regex with existing `qRe` in Phase 1.
   If they match the same tokens, the backlog item is already done. If the new regex targets
   a distinct syntax (e.g. bare `k` without digits for `4k`), document the difference explicitly.

5. **xnxx `_169.mp4` URL construction**: What is the exact transform rule? Is it always
   `thumb.replace(/_[a-z0-9]+\.jpg$/, '_169.mp4')`, or does it involve a different path segment?
   Confirm against live xnxx browse HTML before speccing.

6. **pornhub `data-mediabook` attribute location**: The attribute lives on which element in the
   HTML card? Is it on the `<a>` tag, an inner `<img>`, or a `<span>`? The chunk window
   in `_parseHtmlCards` is `±200/+800` characters around the `href` match — confirm the
   `data-mediabook` attribute is within that window, or the extraction will miss it.

7. **E2E test coverage**: Existing E2E test (`test/cherry-lampa-e2e.mjs`) checks `cards > 0`
   and stream resolution. It does NOT check `video.preview`. Spec must decide whether to add
   a preview-presence assertion (at least one card with non-empty `preview`) or treat it as
   a best-effort field (no E2E assertion, visual verification only).

---

## 9. Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Preview CDN blocked by CORS | High | Confirm CORS headers before setting `preview`; wrap in `buildProxyUrl` or set to `''` |
| xnxx CDN IP-blocked like browse origin | Medium | Check separately; may need `PROXY_URL_2_HOSTS` entry, but `<video>` can't use cherryFetch |
| SpankBang regex already covers the gap | Low | Check existing `qRe` first; avoid duplicate code |
| `_parseHtmlCards` chunk window misses `data-mediabook` | Medium | Verify window size against real HTML sample |
| Fav-restored cards lose preview (expected, not a bug) | Low | Already documented in VideoCard typedef; no action needed |
| Android `<video>` CORS failure on preview URL | Low | Already gated by `_isAndroid()` guard; no change needed |
