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

Adapters route requests through one of two proxies depending on the target hostname.

### Primary proxy — Cloudflare Worker
`PROXY_URL = https://cherry-proxy.aawersom.workers.dev`
Used by default for all adapters.

### Secondary proxy — Deno Deploy
`PROXY_URL_2 = https://cherry-proxy.aawersom.deno.net`
Used for hostnames in `PROXY_URL_2_HOSTS` (`xnxx.com`, `ru.spankbang.com`, `www.eporner.com` for video pages, `gallery.vcmdiawe.com` pornone CDN) that block Cloudflare datacenter IPs at ASN level or return unusable responses from the CF Worker.

### buildProxyUrl(url, referer?)
```
GET {base}/proxy?url={encoded}&key={PROXY_KEY}[&referer={encoded}]
```
Selects `PROXY_URL_2` if the target hostname is in `PROXY_URL_2_HOSTS`, otherwise `PROXY_URL`. Key authenticates the Worker.

### cherryFetch(url, referer?)
Wrapper around native `fetch(buildProxyUrl(...))`. Returns `Promise<string>` (response text).
Used by all adapters for GET requests.

### cherryPost(url, body)
POST variant for `application/x-www-form-urlencoded` bodies (used by Spankbang stream API).
`Lampa.Reguest` does not expose POST, hence native `fetch` directly.

### proxyM3u8(m3u8Url, referer?)
Fetches an HLS master/media playlist via the proxy, rewrites every non-comment line
(resolving relative URLs to absolute first) through `buildProxyUrl`, then returns a
`blob:` URL the Lampa player can consume without CORS issues.

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
| 21 | `huyamba` | Huyamba | fuq.huyamba.mobi | KVS get_file | — |
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

## Source Status (as of 2026-05-29)

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
| `huyamba` | 20 | KVS get_file CDN |

### Browse works, video broken (CDN architecture limitation)

| id | cards | root cause |
|---|---|---|
| `hqporner` | 50 | **bigcdn.cc blocks all Cloudflare datacenter IPs — permanently broken.** CDN returns 404 from CF Worker, Deno Deploy, and residential IPs alike. Browse remains functional. Stream is unrecoverable without a self-hosted FlareSolverr or residential relay; not fixable at the proxy tier. |
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
