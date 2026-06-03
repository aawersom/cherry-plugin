# stream-fix-2 · Mode: medium

## Overview

7 adult video channels in the Cherry Lampa plugin (`plugin.js`) are broken at the stream/playback stage. Fixes touch two files only: `plugin.js` (adapter logic, ES5 only) and `workers/cherry-proxy/src/index.js` (CF Worker, ESM/ES2020+). No new infra, no new proxy tiers.

**Assumption**: `PROXY_URL_3 = ''` (VPS not deployed). If VPS is later deployed, REQ-1's phncdn fix must also be applied to the VPS proxy tier (out of scope here).

---

## Requirements

### REQ-1 · pornhub — phncdn segments 404

| | |
|---|---|
| **Symptom** | M3U8 loads but segments return 404 |
| **Root cause** | phncdn issues IP-bound segment tokens (`ipa=1&hash=…`). M3U8 is fetched through CF datacenter; subsequent segment fetches may hit a different CF node (different IP) → hash mismatch |
| **Fix** | Add `/\.phncdn\.com$/` to the `RESIDENTIAL` set in CF Worker so both M3U8 and all segment fetches exit from the same SOCKS5 IP (45.91.209.155). All 5 SOCKS5 ports share the same egress IP, so port-hash differences between M3U8 (referer=pornhub.com) and segments (no referer) do not affect IP affinity. |
| **File** | `workers/cherry-proxy/src/index.js` — RESIDENTIAL set (~line 27) |
| **AC** | pornhub video plays end-to-end; no 404s in segment requests. PROXY_URL_3 is '' (VPS not active). |

---

### REQ-2 · hqporner — bigcdn 404

| | |
|---|---|
| **Symptom** | Stream URL resolves but CDN returns 404 |
| **Root cause** | `buildProxyUrl` routes `*.bigcdn.cc` URLs to PROXY_URL_2 (Deno/GCP). `mydaddy.cc` embed is fetched via CF datacenter → IP mismatch with Deno → CDN rejects |
| **Fix** | Remove `/\.bigcdn\.cc$/` condition from `buildProxyUrl`; bigcdn falls through to PROXY_URL (CF datacenter) — same IP tier as embed fetch |
| **File** | `plugin.js` — `buildProxyUrl` (~line 61) |
| **AC** | hqporner video plays; CDN responds 200 on segment/file requests |

---

### REQ-3 · spankbang — 403 on video page

| | |
|---|---|
| **Symptom** | Video page fetch returns 403; stream extraction fails |
| **Root cause** | `ru.spankbang.com` is in `PROXY_URL_2_HOSTS` → Deno/GCP IP, which spankbang blocks |
| **Fix** | Remove `'ru.spankbang.com': 1` from `PROXY_URL_2_HOSTS` in `plugin.js`; add `'ru.spankbang.com'` to RESIDENTIAL set in CF Worker → Dutch residential IP (45.91.209.155). **Known limitation**: Phase 2 streamkey POST (`cherryPost` to `/api/videos/stream`) will still exit via CF datacenter because CF Worker SOCKS5 path is GET-only (`if (!isPost && needsResidential)` guard). Accepted — Phase 1 quality-map covers ≥90% of videos. |
| **Files** | `plugin.js` — PROXY_URL_2_HOSTS; `workers/cherry-proxy/src/index.js` — RESIDENTIAL set |
| **AC** | GET fetch of spankbang video page returns 200 via SOCKS5; Phase 1 stream plays. Phase 2 streamkey POST remains on CF datacenter — documented as known gap. |

---

### REQ-4 · pornone — CDN stream 403

| | |
|---|---|
| **Symptom** | Extracted stream URL returns 403 from CDN |
| **Root cause** | pornone uses FluidPlayer with `sources:[{src:"url"}]`; `extractStreams` looks for `"file"` key → misses it → fallback picks a preview/restricted URL |
| **Fix** | In pornone `getStream`, insert FluidPlayer extraction **before** `var result = extractStreams(clean)`: `var fpRx = /sources\s*[=:]\s*\[[\s\S]{0,2000}?['"]?src['"]?\s*:\s*['"]([^'"]+\.(?:mp4\|m3u8)[^'"]{0,200})['"]/i; var fpM = fpRx.exec(clean); if (fpM) return { url: buildProxyUrl(fpM[1], 'https://pornone.com/'), quality: {} };`. Bounded `{0,2000}` prevents backtracking on large pages. |
| **File** | `plugin.js` — pornone `getStream` (~line 2594, before the `extractStreams` call) |
| **AC** | pornone returns full-length video URL; CDN responds 200 |

---

### REQ-5 · porntrex — "interrupted by new load request"

| | |
|---|---|
| **Symptom** | Player logs "interrupted by new load request"; video does not play |
| **Root cause** | Unconfirmed. Suspected: proxy returns `text/html` for `get_file` URL (redirect page) → browser video element fires error → Lampa reloads. Secondary suspect: trailing slash on URL |
| **Fix (partial)** | Extend existing trailing-char strip in the `kvsRx` loop from `/['">\s]+$/` to `/['">\/\s]+$/` (add `\/` to also strip trailing slash). If issue persists, CF Worker content-type guard is needed (separate task) |
| **File** | `plugin.js` — porntrex `getStream` (~line 2694) |
| **AC** | porntrex video plays without interruption (partial — see open questions) |

---

### REQ-6 · porndig — sources pattern picks preview URL

| | |
|---|---|
| **Symptom** | Short preview/trailer plays instead of full video |
| **Root cause** | Pattern 1 (`file\|src` generic) fires first and captures the first occurrence (preview clip). JWPlayer/FluidPlayer `sources:[…]` pattern (more specific) never runs |
| **Fix** | Reverse pattern order in porndig `getStream`: (1) sources-array match first, (2) generic `file\|src` fallback, (3) `data-src` attribute |
| **File** | `plugin.js` — porndig `getStream` (~line 3247) |
| **AC** | porndig plays full-length video, not a 10-second preview |

---

### REQ-7 · 24rolika — cards missing from category pages

| | |
|---|---|
| **Symptom** | Some cards not captured; category pages appear partly empty |
| **Root cause** | `_rolikaCards` href regex uses `[a-z]+` for category segment; hyphenated names like `/film-porno/` fail to match |
| **Fix** | Change `[a-z]+` to `[a-z0-9][a-z0-9\-]*` in `hrefRx` inside `_rolikaCards` (allow hyphens AND digits in category names, e.g. `/film-porno/`, `/xxx-18/`) |
| **File** | `plugin.js` — `_rolikaCards` (~line 3967) |
| **AC** | Category pages with hyphenated slugs return full card lists |

---

## Commit strategy

- **Commit A** (cross-file dependency): REQ-1 + REQ-3 — `index.js` RESIDENTIAL additions + `plugin.js` PROXY_URL_2_HOSTS removal
- **Commit B** (plugin.js only): REQ-2, REQ-4, REQ-5, REQ-6, REQ-7

---

## Open questions

1. **porntrex** — if trailing-slash strip does not fix the interruption, live network inspection is needed to confirm whether the proxy returns `text/html` for `get_file` requests. May require CF Worker content-type guard (separate task).
2. **spankbang** — SOCKS5 residential IP may still trigger Cloudflare bot challenge → 403. If confirmed, document in bugs-backlog as "requires Playwright/browser automation".
3. **REQ-1 PROXY_URL_3 future** (parked — not applicable now): if VPS is deployed, `www.pornhub.com` routes to VPS, bypassing CF Worker RESIDENTIAL. phncdn CDN segments would still be rewritten by CF Worker (`rewriteM3u8`), so adding phncdn to RESIDENTIAL IS still effective for segments even with VPS active. Full flow re-verification needed at VPS deploy time.
4. **REQ-4 reviewer backtracking concern** (parked — accepted): bounded regex `[\s\S]{0,2000}?` mitigates; pornone iframe HTML is typically <150KB and the sources array appears near page top — performance acceptable.

---

## Out of scope

- spankbang Playwright fallback
- porntrex deep CDN investigation
- pornone WP REST API 404 (browse works via HTML fallback)
- Any adapter not listed in REQ-1 through REQ-7
- New proxy tiers or infrastructure changes
