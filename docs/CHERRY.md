# Cherry Plugin — Architecture Documentation

## Overview

Cherry is a Lampa plugin that adds a self-contained adult video aggregator. It registers two
Lampa components (`cherry_main`, `cherry_grid`), routes all external HTTP through a single
Cloudflare Worker proxy, and exposes a uniform `SourceAdapter` interface over 25 heterogeneous
backends.

Entry file: `plugin.js` (single-file, ~4100 lines after cherry-ux-features)

---

## Module Structure

```
plugin.js
├── IIFE guard            lines 1-5       — window.plugin_cherry_ready idempotency flag
├── CONFIG                lines 8-12      — PROXY_URL, PROXY_KEY (read from Lampa.Storage on load)
├── PROXY HELPERS         lines 17-78     — buildProxyUrl, cherryFetch, cherryPost, proxyM3u8
├── SOURCES registry      lines 83-120    — SOURCES[] array + JSDoc typedefs
├── FAV                   lines 125-167   — Fav object (localStorage-backed favorites)
├── UTILS                 lines 172-237   — secToTime, formatViews, sourceById, playVideo
├── CherryGrid            lines 256-543   — paginated video card grid component
├── CherryMain            lines 555-683   — source selector + search bar component
├── TEMPLATES             lines 689-750   — cherry_main, cherry_source_card, cherry_grid, cherry_card
├── CSS                   lines 757-1060  — inline styles injected into document.head
├── LANG                  lines 1065-1079 — Lampa.Lang.add() — ru/en strings
├── INIT (startPlugin)    lines 1084-1128 — wires everything, handles app:ready race
└── SOURCE ADAPTERS       lines 1130-3700 — 25 adapters in two tiers + shared helpers
```

---

## Interfaces

### SourceAdapter

```javascript
/**
 * @typedef {Object} SourceAdapter
 * @property {string}   id         — unique adapter key (used as source field on VideoCard)
 * @property {string}   name       — display name
 * @property {string}   host       — origin domain (informational)
 * @property {function(string, number, string?): Promise<BrowseResult>} search  — keyword search (3rd arg: sort id)
 * @property {function(string, number, string?): Promise<BrowseResult>} browse  — paginated browse (1st: category id, 3rd: sort id)
 * @property {function(VideoCard): Promise<StreamResult>}               getStream
 * @property {function(string, number): Promise<BrowseResult>}          [browseByModel] — REQ-3 optional
 * @property {function(VideoCard): Promise<VideoCard[]>}                 [getRelated]    — REQ-4 optional, returns plain array (no pagination)
 * @property {{sorts?: Array<{id:string,label:string}>, categories?: Array<{id:string,label:string}>}} [cfg] — REQ-5 optional
 */
```

**Optional method guards** (always check before calling):
- `if (src.browseByModel)` — REQ-3
- `if (src.getRelated)` — REQ-4
- `if (src.cfg && src.cfg.sorts)` — REQ-5 sort filter
- `if (src.cfg && src.cfg.categories)` — REQ-5 category filter

**Adapters implementing optional methods** (as of 2026-05-29):
- `browseByModel`: `pornhub` (HTML scrape `/pornstar/{slug}/videos`), `xvideos`
- `getRelated`: `pornhub` (relatedVideosJSON block), `xvideos` (_parseCards on video page)
- `cfg.sorts`: `pornhub` (mv/tr/mr), `xvideos` (new/views)

### VideoCard

```javascript
/**
 * @typedef {Object} VideoCard
 * @property {string}  id        — adapter-scoped unique id
 * @property {string}  source    — adapter id (links card back to its SourceAdapter)
 * @property {string}  title
 * @property {string}  thumb     — thumbnail URL (may be empty)
 * @property {string}  url       — canonical video page URL on origin
 * @property {number}  [duration]— seconds
 * @property {number}  [views]
 * @property {string}  [preview] — REQ-2: URL of short preview clip (mp4/hls). Not persisted in Fav.
 * @property {{name:string,url:string}} [model] — REQ-3: performer info. Not persisted in Fav.
 */
```

**Fav serialisation invariant:** only 7 fields persisted: `id, source, title, thumb, url, duration, views`.
Fields `preview` and `model` are silently dropped on favourite — intentional (signed tokens expire).

### StreamResult

```javascript
/**
 * @typedef {Object} StreamResult
 * @property {string}              url      — primary playback URL (best quality or fallback)
 * @property {Object.<string,string>} quality — label → URL map (e.g. { '1080p': '...' })
 */
```

### BrowseResult

```javascript
/**
 * @typedef {Object} BrowseResult
 * @property {VideoCard[]} items
 * @property {number}      total_pages
 */
```

---

## Component Lifecycle

### CherryGrid (component: `cherry_grid`)

| Lampa lifecycle call | Cherry implementation |
|---|---|
| `create()` | Builds DOM via `Lampa.Template.get('cherry_grid')`, creates `Lampa.Scroll`, triggers `loadPage(1)` or `loadAllSources()` or renders favorites inline |
| `start()` | `Lampa.Controller.add('cherry_grid', ...)` + `Lampa.Controller.toggle('cherry_grid')` |
| `render()` | Returns `html` (jQuery element) |
| `pause()` | No-op (empty function) |
| `stop()` | Detaches scroll listener; stops any active preview video (`_stopCurrentPreview()`) |
| `destroy()` | Stops preview (`_stopCurrentPreview()`), sets `destroyed = true`, removes DOM |

**Activity params consumed:**

| param | type | meaning |
|---|---|---|
| `source_id` | string | adapter id to browse/search |
| `query` | string | search query (omit for browse) |
| `all_sources` | boolean | when true, searches all adapters in parallel via `Promise.all` |
| `is_favorites` | boolean | renders the favorites list instead |
| `model_url` | string | REQ-3: model page URL → triggers `browseByModel(model_url, page)` |
| `model_name` | string | REQ-3: display title for model browse screen |
| `_related_items` | VideoCard[] | REQ-4: pre-fetched related cards; skips loadPage entirely |
| `title` | string | screen title override |
| `page` | number | declared but not used; scroll drives pagination |

### CherryMain (component: `cherry_main`)

| Lampa lifecycle call | Cherry implementation |
|---|---|
| `create()` | `Lampa.Template.get('cherry_main')`, renders source tiles, binds search handlers |
| `start()` | `Lampa.Controller.add('cherry_main', ...)` + `Lampa.Controller.toggle('cherry_main')` |
| `render()` | Returns `html` |
| `pause()` | No-op |
| `stop()` | No-op |
| `destroy()` | Removes DOM |

---

## Proxy Layer

Adapters route requests through one of three proxies depending on the target hostname.

### Primary proxy — Cloudflare Worker + SOCKS5
`PROXY_URL = https://cherry-proxy.aawersom.workers.dev`
Default for all adapters. For domains in `PROXY_URL_3_HOSTS` (pornhub, eporner, spankbang),
the CF Worker tunnels the outbound request through **rotating Dutch residential SOCKS5 proxies**
(`45.91.209.155:11750–11756`) using the `cloudflare:sockets` `connect()` API. Time-based
rotation every 30 s. Fallback: direct CF fetch if all 5 proxies fail.

The CF Worker also performs **server-side M3U8 rewriting**: any response whose Content-Type
or path ends in `.m3u8` has all segment/sub-playlist URLs rewritten to go through the proxy.
This means adapters should pass the raw M3U8 URL to `buildProxyUrl()` directly — **not**
through `proxyM3u8()`.

### Secondary proxy — Deno Deploy
`PROXY_URL_2 = https://cherry-proxy.aawersom.deno.net`
Used for hostnames in `PROXY_URL_2_HOSTS`:
- `xnxx.com`, `youjizz.com` — CF ASN-blocked
- `tv4.tizam.org` — CF rate-limited
- `pornone.com`, `*.pornone.com` — IP-bound KVS token (page + CDN must share IP)
- `*.bigcdn.cc` — LeaseWeb NL CDN (should be matched by regex, not hardcoded list)
- `www.perfektdamen.co` — IP-bound KVS token

### Tertiary proxy — VPS (optional)
`PROXY_URL_3 = ''` (empty by default; fill with Beget VPS IP:PORT after deploying
`workers/cherry-proxy-vps/index.js`). Currently unused. Would override `PROXY_URL` for
`PROXY_URL_3_HOSTS` if set.

### buildProxyUrl(url, referer?)
```
GET {base}/proxy?url={encoded}&key={PROXY_KEY}[&referer={encoded}]
```
Routing priority: `PROXY_URL_3` (if set + hostname in `PROXY_URL_3_HOSTS`) → `PROXY_URL_2`
(if hostname in `PROXY_URL_2_HOSTS` or matches `/\.pornone\.com$/`) → `PROXY_URL` (default).

### cherryFetch(url, referer?)
Wrapper around native `fetch(buildProxyUrl(...))`. Returns `Promise<string>` (response text).
On Android, tries `Lampa.Reguest.native()` first (bypasses CORS), falls back to fetch+proxy.

### cherryPost(url, body)
POST variant for `application/x-www-form-urlencoded` bodies (used by Spankbang stream API).
`Lampa.Reguest` does not expose POST, hence native `fetch` directly.

### proxyM3u8(m3u8Url, referer?)
**⚠ Deprecated for CF Worker usage.** Fetches HLS playlist via proxy, rewrites segment URLs
client-side, returns a `blob:` URL. Causes **double-proxy** when CF Worker's server-side
`rewriteM3u8()` is also active — segments end up as `proxy?url=proxy?url=...`.
Only safe for use with plain pass-through proxies (Deno) that do not rewrite M3U8.
Currently called only by the `pornhub` adapter — **that call should be removed** (see Iteration 2).

---

## Shared Scraping Helpers (Adapter Tier 1 & 2)

| Function | Purpose |
|---|---|
| `parseDur(str)` | Parses "MM:SS", "HH:MM:SS", or raw seconds integer to seconds |
| `parseViews(str)` | Parses "1.2K", "3M" or plain integer to number |
| `extractStreams(html)` | Multi-pattern extractor: KVS get_file, `<source>` tags (res/label), JWPlayer file, generic MP4 |
| `stripTags(str)` | Strips HTML tags + decodes 5 common HTML entities |
| `bestQualityUrl(quality)` | Selects highest numeric label key from quality map |
| `_attr(html, rx, group?)` | Extracts regex group from HTML string |
| `_decodeHtml(str)` | Decodes 6 HTML entities |
| `_splitCards(html, splitRx)` | Splits HTML into per-card chunks |
| `_kvsPickBest(urls)` | Ranks KVS MP4 URLs by resolution label embedded in filename |

---

## Source Adapters — Full List (25 adapters)

| # | id | name | host | Protocol type | UX extras |
|---|---|---|---|---|---|
| 1 | `pornhub` | Pornhub | pornhub.com | JSON API (`/webmasters/search`) | `cfg.sorts` (mv/tr/mr), `browseByModel` (HTML scrape `/pornstar/`), `getRelated` (relatedVideosJSON) |
| 2 | `xvideos` | Xvideos | xvideos.com | HTML scraping (thumb-block divs) | `cfg.sorts` (new/views), `browseByModel` (model profile page), `getRelated` (_parseCards on video page) |
| 3 | `xnxx` | Xnxx | xnxx.com | HTML scraping (mozaique / thumb-under) | — |
| 4 | `eporner` | Eporner | eporner.com | JSON API (`/api/v2/video/search/`) + Deno for video pages | — |
| 5 | `spankbang` | Spankbang | ru.spankbang.com | HTML scraping (`ru.` subdomain) + quality regex + streamkey POST fallback | — |
| 6 | `hqporner` | HQPorner | hqporner.com | HTML → mydaddy.cc → bigcdn.cc **(stream broken permanently)** | — |
| 7 | `youjizz` | YouJizz | youjizz.com | HTML scraping (video-block divs) | — |
| 8 | `pornone` | PornOne | pornone.com | WP REST API; CDN via Deno Deploy | — |
| 9 | `porntrex` | Porntrex | porntrex.com | KVS get_file + HTML | — |
| 10 | `xozilla` | Xozilla | xozilla.com | KVS (_kvsEngine) | — |
| 11 | `3movs` | 3Movs | 3movs.com | HTML scraping (href scan + context window) | — |
| 12 | `analdin` | Analdin | analdin.com | KVS (_kvsEngine) | — |
| 13 | `pornve` | PornVe | pornve.com | SisiStyle (`videoUrl:` JS var) + HTML fallback | — |
| 14 | `familyporn` | FamilyPorn | familyporn.tv | SisiStyle (contents/videos_screenshots CDN) | — |
| 15 | `porndig` | Porndig | porndig.com | iframe player URL extraction | — |
| 16 | `tizam` | Tizam | tv4.tizam.org | HTML scraping (anchor scan) | — |
| 17 | `perfektdamen` | PerfektDamen | perfektdamen.co | KVS/HTML scraping | — |
| 18 | `hellporno` | HellPorno | hellporno.com | KVS (_kvsEngine: `chs_object` + `<source>` tags) | — |
| 19 | `pornobolt` | Pornobolt | sex.pornobolt.in | KVS (_kvsEngine: pbcdn.tv CDN) | — |
| 20 | `crocotube` | CrocoTube | crocotube.com | KVS (_kvsEngine: alphaxcdn.com CDN) | — |
| 21 | `huyamba` | Huyamba | fuq.huyamba.mobi | KVS get_file | **Disabled 2026-06-03 (site dead)** |
| 22 | `ebun` | Ebun | www1.ebun.tv | HTML scraping | — |
| 23 | `lenporno` | LenPorno | www.lenporno.net | Custom upload path reconstruction | — |
| 24 | `24rolika` | 24Rolika | w2.huyalkino.com | DLE + JWPlayer | — |
| 25 | `jopaonline` | JopaOnline | jopaonline.mobi | DLE + JWPlayer | — |

**Adapter type legend:**
- **JSON API** — adapter parses structured JSON from official or semi-official API endpoint
- **HTML scraping** — adapter splits raw HTML into card-sized chunks using string.split() on class names
- **KVS** — uses `_kvsEngine` factory (5 adapters); targets KVS platform `get_file/` URL pattern
- **DLE** — DataLife Engine CMS: search `?do=search`, pagination `/page/N/`
- **SisiStyle** — tube script: `videoUrl:` JS variable + `contents/videos_screenshots/` CDN
- **JWPlayer** — parses `jwplayer(...).setup({...})` block for file/sources

**UX extras** (REQ-2/3/4/5 features, see cherry-ux-features):
- `cfg.sorts/categories` — filter bar in CherryGrid (REQ-5)
- `browseByModel(modelUrl, page)` — model badge navigation (REQ-3)
- `getRelated(video)` — related panel after playback (REQ-4)
- `video.preview` — animated thumbnail preview on focus (REQ-2); currently populated by: **none** (backlog: xvideos `_169.mp4` transform, pornhub `data-mediabook`)

---

## Known Improvement Backlog (from AdultJS analysis)

Discovered 2026-05-29 by comparing with AdultJS implementation.

| Adapter | Gap | Fix | Effort |
|---------|-----|-----|--------|
| `xvideos` + `xnxx` | `video.preview` not populated | Add `_169.mp4` URL transform in `_parseCards()` | ~5 lines each |
| `pornhub` | `video.preview` not populated in webmasters browse | Add `data-mediabook` extraction in `_parseHtmlCards()` (used by browseByModel) | ~2 lines |
| `pornhub` | Browse uses webmasters API (no preview/model in listing) | Switch to HTML scrape `rt.pornhub.com/video?page=N` + XPath; gets preview+model free | Medium effort, HTML more fragile |
| `spankbang` | Quality map regex may miss formats | Add `/'([0-9]+)(p\|k)':\s*\['(https?...)'/g` before POST fallback | ~10 lines |
| `xvideos` + `xnxx` | `video_related` JSON parsed separately from stream | Move related parse into `getStream` (same page fetch) to avoid double request | Medium |

---

## Source Status — Iteration 1 (2026-05-29)

Results from `node test/cherry-lampa-e2e.mjs` — Playwright/Chromium with real CORS enforcement.

### Browse + Video working

| id | cards | notes |
|---|---|---|
| `pornhub` | 30 | getStream: `video.url` → CF Worker → `flashvars_\d+` JSON block → HLS/MP4. Browse: webmasters API JSON. `cfg.sorts`, `browseByModel`, `getRelated` implemented (Phase 3/4/5). |
| `xvideos` | 42 | HLS via CDN, range test N/A for HLS |
| `xnxx` | ~30 | **Via Deno Deploy proxy** (`cherry-proxy.aawersom.deno.net`); browse URL fixed to `/?k=new&p=N` |
| `eporner` | ~30 | **Via Deno Deploy proxy** for video pages (`www.eporner.com` added to `PROXY_URL_2_HOSTS`); JSON search/browse API still uses direct fetch (CORS-open). URL format: `/video-{id}/{slug}/`. |
| `spankbang` | ~30 | **Via Deno Deploy proxy** (`ru.spankbang.com`); `spankbang.com` and `www.spankbang.com` remain JS-challenge gated and removed from `PROXY_URL_2_HOSTS`. Quality map extraction primary, streamkey POST fallback. |
| `youjizz` | 24 | Direct MP4 via proxy |
| `xozilla` | 100 | KVS get_file, consistent |
| `analdin` | 100 | KVS get_file, consistent |
| `porndig` | 36 | Previewclip CDN; CF rate-limiting intermittent |
| `tizam` | 25 | Direct MP4 |
| `hellporno` | 60 | KVS get_file, consistent |
| `pornobolt` | 42 | KVS pbcdn.tv, consistent |
| `crocotube` | 69 | KVS alphaxcdn.com, consistent |
| `24rolika` | 32 | DLE + JWPlayer MP4 |
| `jopaonline` | 24 | DLE + JWPlayer MP4 |

### Browse works, video intermittent (KVS get_file with signed tokens)

These sources use KVS `get_file/` URLs with short-lived signed tokens. In automated tests,
the token may expire between `getStream()` and the video element's first request due to CF
edge IP rotation. In real Lampa usage (immediate playback after selection), they are reliable.

| id | cards | notes |
|---|---|---|
| `porntrex` | 85 | Thumbnails fixed (protocol-relative `//` → `https:`); token occasionally expires before video test |
| `3movs` | 36 | KVS signed-token issue |
| `pornve` | 20 | KVS signed-token issue |
| `familyporn` | 24 | KVS signed-token issue |
| `ebun` | 30 | KVS signed-token issue |
| `lenporno` | 24 | Custom CDN, occasionally slow |
| `perfektdamen` | 60 | KVS signed-token, get_file CDN |
| `huyamba` | 20 | KVS get_file CDN. **Disabled 2026-06-03**: `fuq.huyamba.mobi` returns 404, site dead. Adapter commented out. |

### Browse works, video broken (CDN architecture limitation)

| id | cards | root cause |
|---|---|---|
| `hqporner` | 50 | **CDN routing bug** (not permanently broken — see Iteration 2): `s24.bigcdn.cc` not in `PROXY_URL_2_HOSTS` list, routes to CF Worker → 404. Fix: add `/\.bigcdn\.cc$/` regex. |
| `pornone` | 49 | **IP-locked CDN tokens** on `gallery.vcmdiawe.com`. Strategy A implemented: CDN routes through Deno Deploy (same-POP delivery likely via Anycast). If Strategy A fails in E2E, escalate to Strategy B (`pornone.com` + CDN both through Deno). |

### Previously unfixable — now repaired

SpankBang previously failed with Cloudflare JS challenge on `spankbang.com` and `www.spankbang.com`. The Russian regional subdomain `ru.spankbang.com` does NOT trigger the JS challenge from Deno Deploy IPs and is used instead. `spankbang.com` and `www.spankbang.com` are removed from `PROXY_URL_2_HOSTS`.

| id | status | notes |
|---|---|---|
| `spankbang` | repaired 2026-05-28 | `ru.spankbang.com` bypasses CF challenge; quality map primary + streamkey POST fallback |

---

## All Lampa API Calls

### Lampa.Storage
| Call | Location | Purpose |
|---|---|---|
| `Lampa.Storage.get('cherry_proxy_key', '1206')` | line 11 | Load proxy key at module init |
| `Lampa.Storage.get(this._key, [])` | line 130 | Load favorites array (key: `cherry_favs`) |
| `Lampa.Storage.set(this._key, list)` | line 164 | Persist favorites after toggle |
| `Lampa.Storage.get('cherry_proxy_key', null)` | line 1086 | First-run detection |
| `Lampa.Storage.set('cherry_proxy_key', '1206')` | line 1087 | Write default key on first run |

### Lampa.Noty
| Call | Purpose |
|---|---|
| `Lampa.Noty.show(text)` | Loading indicator, fav feedback, error toasts |
| `Lampa.Noty.show(text, { style: 'warn' })` | Warning-style toast |
| `Lampa.Noty.show(text, { time: 7000 })` | Extended-duration toast (first-run proxy key notice) |

### Lampa.Lang
| Call | Purpose |
|---|---|
| `Lampa.Lang.add({key: {ru, en}})` | Registers 11 translation keys |
| `Lampa.Lang.translate(key)` | Resolves translation key to current locale string |

### Lampa.Template
| Call | Purpose |
|---|---|
| `Lampa.Template.add(name, html)` | Registers 4 templates (cherry_main, cherry_source_card, cherry_grid, cherry_card) |
| `Lampa.Template.get(name, vars)` | Instantiates a template with variable substitution |

### Lampa.Controller
| Call | Purpose |
|---|---|
| `Lampa.Controller.add(name, handlers)` | Registers TV remote handler set |
| `Lampa.Controller.toggle(name)` | Activates a controller by name |
| `Lampa.Controller.collectionSet(el)` | Sets the focusable element collection |
| `Lampa.Controller.collectionFocus(false, el)` | Focuses first item in collection |
| `Lampa.Controller.move(dir)` | Moves focus in a direction |

### Lampa.Activity
| Call | Purpose |
|---|---|
| `Lampa.Activity.push({component, ...params})` | Navigates to a new screen |
| `Lampa.Activity.backward()` | Pops current screen (back button) |

### Lampa.Component
| Call | Purpose |
|---|---|
| `Lampa.Component.add('cherry_main', CherryMain)` | Registers CherryMain constructor |
| `Lampa.Component.add('cherry_grid', CherryGrid)` | Registers CherryGrid constructor |

### Lampa.Menu
| Call | Purpose |
|---|---|
| `Lampa.Menu.addButton(icon, label, callback)` | Adds Cherry entry to the sidebar menu |

### Lampa.Select
| Call | Purpose |
|---|---|
| `Lampa.Select.show({title, items, onSelect, onBack})` | Shows context menu on card long-press |

### Lampa.Player
| Call | Purpose |
|---|---|
| `Lampa.Player.play({title, url, poster, quality})` | Hands off resolved stream to Lampa player |

### Lampa.Listener
| Call | Purpose |
|---|---|
| `Lampa.Listener.follow('app', fn)` | Waits for `app:ready` event before initialising |
| `Lampa.Listener.follow('player', fn)` | Single block: revokes HLS blob URLs + pushes related panel (REQ-4) on `e.type==='destroy'` |

### Lampa.Storage (REQ-2/5)
| Call | Purpose |
|---|---|
| `Lampa.Storage.get('cherry_preview_enabled', true)` | REQ-2: read preview toggle state |
| `Lampa.Storage.set('cherry_preview_enabled', bool)` | REQ-2: write preview toggle via CherryMain settings |

### Lampa.SettingsApi (not used — CherryMain long-press instead)
Preview toggle exposed via `hover:long` on `.cherry-main__title` → `Lampa.Select.show(...)`.
Global `Lampa.SettingsApi` registration deliberately avoided (avoids polluting global settings page).

### Lampa.Reguest (class)
| Call | Purpose |
|---|---|
| `new Lampa.Reguest()` | Android-native HTTP fetch (used in `_nativeFetch()`) |
| `.native(url, ok, err, sync, opts)` | 5-arg signature: makes native OS-level HTTP request, bypasses WebView CORS |
| `.clear()` | Cancels in-flight request |

### Lampa.Scroll (class)
| Call | Purpose |
|---|---|
| `new Lampa.Scroll({mask, over})` | Creates TV-optimised scroll container |
| `scroll.body()` | Returns scrollable content element |
| `scroll.render()` | Returns scroll wrapper element |

### Lampa.Listener
| Call | Purpose |
|---|---|
| `Lampa.Listener.follow('app', fn)` | Waits for `app:ready` event before initialising |

### Lampa.Keyboard (optional)
| Call | Purpose |
|---|---|
| `Lampa.Keyboard.show({title, value, onchange, onenter})` | TV keyboard for search input (presence-checked before use) |

---

---

## Source Status — Iteration 2 (live test 2026-06-03)

Live testing via Lampa web player (`lampa.mx`) with the deployed plugin
`https://aawersom.github.io/cherry-plugin/plugin.js`.

### Confirmed broken — root cause diagnosed

| id | symptom | root cause | fix plan |
|---|---|---|---|
| `pornhub` | preview OK, video 404 | **Double-proxy**: `proxyM3u8()` rewrites M3U8 client-side, but CF Worker's `rewriteM3u8()` already rewrites segments server-side → `proxy?url=proxy?url=ev-h.phncdn.com/...` | Remove `proxyM3u8` call; return `buildProxyUrl(m3u8Url, referer)` directly |
| `hqporner` | preview OK, video 404 | **Missing bigcdn subdomain**: `s24.bigcdn.cc` not in `PROXY_URL_2_HOSTS` (hardcoded list has only 14 specific subdomains) → goes to CF Worker → 404 | Add `/\.bigcdn\.cc$/` regex to `buildProxyUrl` routing |
| `pornone` | browse 404, CDN 504 | **Deno proxy blocked**: both `pornone.com/wp-json/...` and `s1002.pornone.com` return 404/timeout through Deno Deploy → Deno IP banned by PornOne | Move pornone to CF Worker SOCKS5; add `pornone.com` + `*.pornone.com` to RESIDENTIAL in CF Worker |
| `spankbang` | browse 403 | **SOCKS5 blocked by Spankbang**: all 5 Dutch residential proxies return 403; direct CF fetch also 403. Spankbang has aggressive bot-protection (per xsena: requires Playwright headless) | Try `www.spankbang.com` fallback; otherwise mark as requires-server-side |
| `eporner` | preview OK, video silent fail | **SOCKS5 instability** for XHR API (`/xhr/video/ID?hash=...`) or CDN missing referer in `playVideo`'s `px()` call | Debug XHR response; pass referer when building quality map |
| `porntrex` | play interrupted | KVS `get_file` redirect chain: CF Worker follows redirect, but CDN may return non-video response or require token validation at same IP | Test `_kvsPickBest` redirect path; add referer to stream URL |
| `porndig` | only preview plays | `extractStreams(ihtml)` on `videos.porndig.com/player/index/ID` returns preview/teaser URL; player format likely changed | Update player page parser for new iframe format |
| `24rolika` | play interrupted | `videosdrop.com` CDN serves content that triggers HLS race; JWPlayer URL may require direct access | Test without proxy; compare with direct fetch |

### Architecture comparison — sisi.js / xsena.red (2026-06-03)

Investigated two competing Lampa adult plugins:
- **sisi.js** (`bylampa.github.io/sisi.js`) — thin bootstrapper that loads the real plugin from mirrors (ab2024.ru). Works in Lampa UNCENSORED fork only.
- **xsena.red** / Клубничка — Lampac C#/.NET backend (`api.xsena.red`). Client JS is a dumb shell. Sources: Pornhub, Xvideos, Xhamster, Spankbang, Eporner, Porntrex, Xnxx, Hqporner, Chaturbate, Ebalovo.

**Key architectural difference:**

| Aspect | Cherry (this plugin) | sisi.js / xsena (Lampac) |
|---|---|---|
| Scraping location | Client-side JS via CF Worker proxy | Server-side C#/.NET |
| Bot-protected sites | SOCKS5 Dutch residential via CF Worker | Playwright headless browser (server) |
| Blocked domains | Proxy routing table in plugin.js | Server-side proxy config |
| CORS issues | `buildProxyUrl` wrapping | None (server makes requests) |
| Stream URLs to player | Proxied or blob M3U8 | Direct CDN URL (no proxy in stream) |
| IP-bound tokens | Needs consistent egress IP per session | Managed by backend cache |
| Resilience | CF Worker SOCKS5 outage = broken | Server admin replaces proxies |

**Takeaway for Cherry:** For Spankbang (and potentially Eporner/Pornhub) the fundamental bottleneck is bot-protection that requires a headless browser. Cherry's proxy approach hits a ceiling here. All other issues (double-proxy, wrong CDN routing, Deno block) are mechanical bugs fixable in JS.

**tv-ch.ru reference (`https://tv-ch.ru/lampa-plugins-with-strawberry/`):**
Lists two working plugin addresses as of 2026:
- `https://lam.maxvol.pro/sisi.js` — broken since 2026-02-07
- `https://bylampa.github.io/sisi.js` — works (Lampa UNCENSORED only)

Supported sources in sisi.js ecosystem: Pornhub, Xvideos, Xhamster, Ebalovo, Hqporner, Spankbang, Eporner, Porntrex, Xnxx, Chaturbate.

### proxyM3u8 deprecation note

`proxyM3u8()` was designed for a dumb pass-through proxy. Now that the CF Worker runs `rewriteM3u8()` server-side, `proxyM3u8` causes double-wrapping for any source that returns HLS. It should only be called on platforms where the proxy does NOT rewrite M3U8 (e.g. plain Deno proxy). Currently `proxyM3u8` is called only by `pornhub` adapter — that call should be removed.

### PROXY_URL_2_HOSTS hardcoded bigcdn list is incomplete

Current list covers 14 bigcdn subdomains (s1, s4, s16, s18, s25, s30, s33, s38, s39, s41, s43, s47, s50, s61). `s24.bigcdn.cc` (used by HQPorner) and potentially other subdomains are missing. Replace with `/\.bigcdn\.cc$/` regex in `buildProxyUrl`.

---

## INIT Sequence

```
plugin.js evaluated
  → IIFE guard check (window.plugin_cherry_ready)
  → PROXY_KEY read from Lampa.Storage
  → window.appready check
      YES → startPlugin() immediately
      NO  → Lampa.Listener.follow('app', e.type==='ready' → startPlugin())

startPlugin():
  → first-run proxy key notice (Lampa.Storage + Lampa.Noty via setTimeout 1500ms)
  → addLang()      — Lampa.Lang.add()
  → addTemplates() — Lampa.Template.add() x4
  → addStyles()    — <style id="cherry-plugin-styles"> injected into document.head
  → Lampa.Component.add('cherry_main', CherryMain)
  → Lampa.Component.add('cherry_grid', CherryGrid)
  → Lampa.Menu.addButton(...)
```
