# Cherry Plugin — Architecture Documentation

## Overview

Cherry is a Lampa plugin that adds a self-contained adult video aggregator. It registers two
Lampa components (`cherry_main`, `cherry_grid`), routes all external HTTP through a single
Cloudflare Worker proxy, and exposes a uniform `SourceAdapter` interface over 26 heterogeneous
backends.

Entry file: `plugin.js` (single-file, ~3700 lines)

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
└── SOURCE ADAPTERS       lines 1130-3700 — 26 adapters in two tiers + shared helpers
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
 * @property {function(string, number): Promise<BrowseResult>} search  — keyword search
 * @property {function(string, number): Promise<BrowseResult>} browse  — paginated browse
 * @property {function(VideoCard): Promise<StreamResult>}      getStream
 */
```

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
 */
```

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
| `stop()` | No-op (empty function) |
| `destroy()` | Sets `destroyed = true`, calls `network.clear()`, removes DOM |

**Activity params consumed:**

| param | type | meaning |
|---|---|---|
| `source_id` | string | adapter id to browse/search |
| `query` | string | search query (omit for browse) |
| `all_sources` | boolean | when true, searches all adapters in parallel via `Promise.all` |
| `is_favorites` | boolean | renders the favorites list instead |
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

All network calls from adapters flow through a single Cloudflare Worker at `PROXY_URL`.

### buildProxyUrl(url, referer?)
```
GET {PROXY_URL}/proxy?url={encoded}&key={PROXY_KEY}[&referer={encoded}]
```
Constructs a proxied URL. Key authenticates the Worker.

### cherryFetch(url, referer?)
Wrapper around native `fetch(buildProxyUrl(...))`. Returns `Promise<string>` (response text).
Used by all adapters for GET requests.

### cherryPost(url, body)
POST variant for `application/x-www-form-urlencoded` bodies (used by Spankbang stream API).
Comment in code notes that `Lampa.Reguest` does not expose POST, hence native `fetch` directly.

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

## Source Adapters — Full List (26 adapters)

| # | id | name | host | Protocol type |
|---|---|---|---|---|
| 1 | `pornhub` | Pornhub | pornhub.com | JSON API (`/webmasters/search`) |
| 2 | `xvideos` | Xvideos | xvideos.com | HTML scraping (thumb-block divs) |
| 3 | `xnxx` | Xnxx | xnxx.com | HTML scraping (mozaique / thumb-under) |
| 4 | `eporner` | Eporner | eporner.com | JSON API (`/api/v2/video/search/`) |
| 5 | `spankbang` | Spankbang | spankbang.com | HTML scraping + POST stream API |
| 6 | `hqporner` | HQPorner | hqporner.com | HTML → mydaddy.cc embed → bigcdn.cc CDN |
| 7 | `youjizz` | YouJizz | youjizz.com | HTML scraping (video-block divs) |
| 8 | `pornone` | PornOne | pornone.com | WP REST API (`/wp-json/wp/v2/posts`) with JSON-LD stream |
| 9 | `porntrex` | Porntrex | porntrex.com | KVS (get_file MP4 paths) + HTML scraping |
| 10 | `xozilla` | Xozilla | xozilla.com | JWPlayer setup block + HTML scraping |
| 11 | `3movs` | 3Movs | 3movs.com | HTML scraping (href scan + context window) |
| 12 | `analdin` | Analdin | analdin.com | JWPlayer setup block + HTML scraping |
| 13 | `pornve` | PornVe | pornve.com | SisiStyle (`videoUrl:` JS variable) + HTML fallback |
| 14 | `familyporn` | FamilyPorn | familyporn.tv | SisiStyle (contents/videos_screenshots CDN) |
| 15 | `porndig` | Porndig | porndig.com | iframe player URL extraction |
| 16 | `tizam` | Tizam | tv4.tizam.org | HTML scraping (anchor scan, Russian-language site) |
| 17 | `perfektdamen` | PerfektDamen | perfektdamen.co | KVS/HTML scraping |
| 18 | `hellporno` | HellPorno | hellporno.com | `chs_object` JS var + `<source res>` tags |
| 19 | `pornobolt` | Pornobolt | sex.pornobolt.in | KVS (pbcdn.tv CDN pattern) |
| 20 | `crocotube` | CrocoTube | crocotube.com | KVS (alphaxcdn.com CDN pattern) |
| 21 | `huyamba` | Huyamba | fuq.huyamba.mobi | KVS get_file pattern |
| 22 | `ebun` | Ebun | www1.ebun.tv | HTML scraping |
| 23 | `lenporno` | LenPorno | my.lenporno.live | Custom upload path reconstruction |
| 24 | `24rolika` | 24Rolika | w2.huyalkino.com | DLE + JWPlayer |
| 25 | `jopaonline` | JopaOnline | jopaonline.mobi | DLE + JWPlayer |
| 26 | `gayporntube` | GayPornTube | www.gayporntube.com | HTML scraping (SisiStyle-like) |

**Adapter type legend:**
- **JSON API** — adapter parses structured JSON from official or semi-official API endpoint
- **HTML scraping** — adapter splits raw HTML into card-sized chunks using string.split() on class names
- **KVS** — adapter targets KVS (Kernel Video Sharing) platform patterns: `get_file/` URLs or `video_url` JS vars
- **DLE** — DataLife Engine CMS: search via `?do=search&subaction=search`, pagination via `/page/N/`
- **SisiStyle** — tube script with `videoUrl:` JS variable and `contents/videos_screenshots/` CDN path
- **JWPlayer** — adapter parses `jwplayer(...).setup({...})` block for file/sources

---

## Source Status (as of 2026-05-26)

Results from `node test/cherry-browser-test.mjs` — Playwright/Chromium with real CORS enforcement.

### Browse + Video working

| id | cards | notes |
|---|---|---|
| `pornhub` | 30 | HLS/blob stream, always works |
| `xvideos` | 42 | HLS via CDN, range test N/A for HLS |
| `youjizz` | 24 | Direct MP4 via proxy |
| `xozilla` | 100 | KVS get_file, consistent |
| `analdin` | 100 | KVS get_file, consistent |
| `porndig` | 36 | Previewclip CDN |
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
| `porntrex` | 85 | Token occasionally expires before video test |
| `3movs` | 36 | Same KVS signed-token issue |
| `pornve` | 20 | Same KVS signed-token issue |
| `familyporn` | 24 | Same KVS signed-token issue |
| `ebun` | 30 | Same KVS signed-token issue |
| `lenporno` | 24 | Custom CDN, occasionally slow |
| `perfektdamen` | 60 | KVS signed-token, get_file CDN |
| `huyamba` | 20 | KVS get_file CDN |
| `gayporntube` | 39 | Slow CDN, may timeout in tests |

### Browse works, video broken (CDN architecture limitation)

These sources cannot serve video through the Cloudflare Worker proxy due to CDN-side restrictions
that are not solvable at the plugin or proxy level.

| id | cards | root cause |
|---|---|---|
| `hqporner` | 50 | **bigcdn.cc blocks all Cloudflare datacenter IPs.** The embed player (mydaddy.cc) hosts video on `sN.bigcdn.cc` which returns 403/404 to any CF Worker fetch, regardless of Referer/User-Agent headers. Not fixable via proxy. |
| `pornone` | 49 | **IP-locked signed tokens.** pornone.com CDN generates tokens tied to the requesting IP. CF Worker fetches the page and CDN in separate requests that may route through different CF edge IPs → token mismatch → 403. Direct browser access works. Not fixable via proxy without a non-CF relay. |

### 0 cards (blocked by bot protection)

| id | notes |
|---|---|
| `xnxx` | Cloudflare bot protection returns 403/empty for CF Worker IPs |
| `eporner` | Same — CF Worker IP blocked at site level |
| `spankbang` | Same — POST stream API also blocked |

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

### Lampa.Reguest (class)
| Call | Purpose |
|---|---|
| `new Lampa.Reguest()` | Creates network request manager in CherryGrid |
| `network.timeout(15000)` | Sets timeout |
| `network.clear()` | Cancels in-flight requests on destroy |

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
