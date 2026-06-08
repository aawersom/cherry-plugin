# Cherry Plugin — Architecture Documentation

## Overview

Cherry is a Lampa plugin that adds a self-contained adult video aggregator. It registers two
Lampa components (`cherry_main`, `cherry_grid`), routes all external HTTP through a single
Cloudflare Worker proxy, and exposes a uniform `SourceAdapter` interface over 25 heterogeneous
backends.

Entry file: `plugin.js` (single-file, ~4350 lines)

> **Nav rewrite (2026-06-04):** `cherry_grid` and `cherry_main` were migrated from a
> hand-rolled `Lampa.Controller.add({up,down,left,right})` to extending
> **`Lampa.InteractionCategory`**. The base class now owns focus movement,
> scroll-into-view and pagination; the plugin overrides only data/render hooks.
> This migration orphaned the entire custom presentation layer — **6 `Lampa.Template.add`
> templates and ~390 lines of CSS were removed**. See *Component Lifecycle* and *UI*.

---

## Module Structure

```
plugin.js
├── IIFE guard            plugin.js:4      — window.plugin_cherry_ready idempotency flag
├── CONFIG                plugin.js:10     — PROXY_URL / _2 / _3 / _VT, *_HOSTS, _ANDROID_FORCE_PROXY, getProxyKey()
├── PROXY HELPERS         plugin.js:52     — buildProxyUrl, cherryFetch, _fetchAny, cherryPost, proxyM3u8
├── SOURCES registry      plugin.js:199    — SOURCES[] array + JSDoc typedefs
├── FAV                   plugin.js:240    — Fav object (localStorage-backed favorites, 7-field)
├── UTILS                 plugin.js:288    — secToTime, formatViews, sourceById, bestQualityUrl, playVideo
├── CherryGrid            plugin.js:406    — InteractionCategory subclass: paginated card grid
├── CherryMain            plugin.js:968    — InteractionCategory subclass: source picker
├── CSS (addStyles)       plugin.js:1071   — ~30 scoped lines injected into document.head (.cherry-cat scope)
├── LANG (addLang)        plugin.js:1119   — Lampa.Lang.add() — ru/en strings
├── addFilterButton       plugin.js:1168   — persistent header action button (cherry_grid only)
├── INIT (startPlugin)    plugin.js:1221   — wires everything, SettingsApi, player listener, app:ready race
└── SOURCE ADAPTERS       plugin.js:1317+  — 24 active adapters in two tiers + shared helpers
```

> **There is no `addTemplates()` and no `Lampa.Template.add` call anymore.**
> InteractionCategory builds its own DOM from Lampa's stock `.card`; the old
> `cherry_main` / `cherry_source_card` / `cherry_grid` / `cherry_card` /
> `cherry_group_label` / `cherry_source_row` templates were deleted.

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

**Adapters implementing optional methods** (as of 2026-06-04):
- `browseByModel`: **`pornhub`** only (HTML scrape `/pornstar/{slug}/videos`; `_mapVideo`
  sets `card.model {name,url}` from JSON `pornstars[]`). xvideos defines `browseByModel`
  but the model field is only on the video page, so it is never surfaced → effectively dead.
- `getRelated`: ~16 channels — `xvideos`/`xnxx` (parse `video_related` JSON var on the video
  page), `eporner` (`mbcontent` HTML on the video page), `pornhub` (`relatedVideosJSON`),
  `pornone` (`_pornoneCards`), every `_kvsEngine` site + custom KVS-style adapters
  (reuse their listing card parser on the video page via `_relatedFrom`).
- `cfg.categories`: **all 24 active adapters** (personalized, native-language labels).
- `cfg.sorts`: most adapters (heterogeneous mechanisms — see *Sorts* table). Empty (`sorts:[]`)
  for DLE/AJAX-POST sites whose sort is not URL-addressable: `24rolika`, `porndig`, `tizam`.

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

Both components are **`Lampa.InteractionCategory` subclasses**, not hand-rolled controllers:

```javascript
function CherryGrid(object) {
  var comp = new Lampa.InteractionCategory(object);
  // ... override only the hooks below ...
  return comp;
}
```

**Why the rewrite (root cause).** The old version registered its own
`Lampa.Controller.add('cherry_grid', {up,down,left,right})`. Calling
`Lampa.Controller.move(dir)` from inside one of those handlers re-dispatched into the
*same* handler → infinite recursion / dead navigation. `InteractionCategory` owns focus
movement, scroll-into-view, edge detection and pagination internally, so the plugin no
longer touches `Controller.move`. (See `docs/UI_and_UX/ui-audit.md` for the validation
that sisi/AdultJS use the same stock-`.card` + InteractionCategory approach.)

### CherryGrid (component: `cherry_grid`, `plugin.js:406`)

Overrides (everything else is inherited from the base class):

| Hook | Cherry implementation |
|---|---|
| `create()` `plugin.js:743` | `this.activity.loader(true)` → `_gridLoad(object,1,...)` → `this.build({title, results, total_pages})`; then `render().addClass('cherry-cat')` + `.category-full.addClass('mapping--grid cols--5')`. On no-results favorites → `empty(cherry_fav_empty_hint)`; on hard failure → `empty(cherry_load_error)` |
| `nextPageReuest(object, resolve, reject)` `plugin.js:772` | Paging. Favorites / `_related_items` resolve a single empty page; everything else calls `_gridLoad(object, currentPage+1, ...)`. all_sources+query now paginates here too |
| `cardRender(object, element, card)` `plugin.js:813` | Wires `card.onEnter` (→ `playVideo`), `card.onMenu` (Похожие / Похожие названия / Избранное / Модель), `card.onFocus` (preview start, wraps base onFocus). Appends `.cherry-src-badge` for all_sources & favorites grids |
| `onRight()` `plugin.js:935` | Opens the action menu (`openActionsMenu`: Поиск → Сортировка → Категории), the native right-edge filter idiom |
| `empty(msg)` `plugin.js:791` | Custom override honouring a message arg (base may ignore it). Builds `Lampa.Empty({descr: msg})` so an error message (`cherry_load_error`) is visually distinct from no-results, and the favorites-empty hint is persistent (not a transient toast) |
| `stop()` / `pause()` `plugin.js:946` | Wrap the base impl to call `_stopCurrentPreview()` first |
| `comp.openActionsMenu` | Exposed so `addFilterButton` (header) opens the same menu |

`build(data)` shape consumed by the base renderer: `{ title, results: VideoCard[], total_pages: number }`.
`toCard(v)` `plugin.js:434` maps a `VideoCard` to the base renderer's card_data in place
(sets `v.img`/`v.poster` from `v.thumb`, composes the `quality` slot, guarantees `v.source`).

**Activity params consumed:**

| param | type | meaning |
|---|---|---|
| `source_id` | string | adapter id to browse/search |
| `query` | string | search query (omit for browse) |
| `sort` | string | active sort id (reload happens via `Activity.push`, not re-`create()`) |
| `category` | string | active category id |
| `all_sources` | boolean | searches every adapter in parallel via `Promise.all`; paginates |
| `client_sort` | string | all_sources only: client-side sort (`''` relevance \| `duration`) |
| `is_favorites` | boolean | renders the favorites list (single page) |
| `model_url` | string | model page URL → `browseByModel(model_url, page)` (pornhub) |
| `_related_items` | VideoCard[] | pre-fetched related cards; one-shot, single page (no `getRelated` re-call) |
| `title` | string | screen / activity-bar title (carries the active filter so it survives menu close) |
| `page` | number | declared; base class drives actual paging via `nextPageReuest` |

> **Filter reload pattern.** Changing sort/category does NOT re-call `create()` (an
> InteractionCategory grid does not re-render on a second `create()`). Instead
> `_pushFiltered(sort, category)` does a fresh `Lampa.Activity.push` of `cherry_grid`
> with the new params, then `Controller.toggle('content')`.

### CherryMain (component: `cherry_main`, `plugin.js:968`)

A single-page **source PICKER** of coloured letter-tiles. Overrides:

| Hook | Cherry implementation |
|---|---|
| `create()` `plugin.js:976` | Builds `results`: `[Поиск ⌕]` + `[Избранное ♥]` (action tiles) + one tile per registered source; `build(...)`; `render().addClass('cherry-cat cherry-home')` + `.category-full.addClass('mapping--grid cols--8')` |
| `cardRender(object, element, card)` `plugin.js:1007` | `card.onEnter` routes by `element._kind`: `search` (→ `Lampa.Input.edit` → all_sources grid), `favorites` (→ favorites grid), `source` (→ single-source browse grid). Paints a `.cherry-tile` coloured initial into `.card__view` (`_tileColor(seed)` gives a stable per-source hue; action tiles get the brand tint) |

---

## UI / Presentation

After the InteractionCategory migration the plugin renders Lampa's **stock `.card`**,
restyled by a small scoped CSS layer (`addStyles()`, `plugin.js:1071`, ~30 lines). All
custom card/grid/spinner CSS and templates were deleted (see Module Structure note).

| Surface | Mechanism |
|---|---|
| **Grid cards** | `.cherry-cat` scope: 16:9 landscape via `.card__view{padding-bottom:56.25%}`, image `object-fit:cover`; grid `cols--5` (5 per row) |
| **Home picker** | `.cherry-home` square tiles (`.card__view{padding-bottom:100%}`), grid `cols--8`; `.cherry-tile` paints a coloured first-letter initial (no thumbnails) |
| **Home content** | A source picker: `[Поиск ⌕]` + `[Избранное ♥]` rendered as action tiles (brand pink `--action`) + one tile per source (stable per-source hue from `_tileColor`) |
| **Focus** | Single native Lampa frame + a subtle `transform:scale(1.04)` on `.card.focus .card__view` (no custom ring — a custom ring stacked on the native frame = double frame) |
| **Card title** | 2-line white clamp (`-webkit-line-clamp:2`, `color:#fff`), `.card__title` font `.9em` |
| **Source-origin badge** | `.cherry-src-badge` (z-index 2, above any preview) appended in `cardRender` on all_sources search AND favorites grids — those mix sources, so each card is tagged with its origin name |
| **Header filter button** | `addFilterButton()` (`plugin.js:1168`) injects a persistent `.cherry-filter-btn` into the Lampa header next to search; visible only while a `cherry_grid` activity is on top; opens the same Поиск → Сортировка → Категории menu as the right edge |
| **Preview clip** | `cardRender.onFocus` injects a muted/looping `<video.cherry-card__preview>` into the focused card when `element.preview` exists, `cherry_preview_enabled` is on, and not Android. Stopped on blur/stop/pause |

**Removed in this iteration (dead code from the migration):** ~390 lines of CSS
(`.cherry-card*`, `.cherry-grid*`, `.cherry-source-*`, `@keyframes cherry-spin`, etc.)
and 6 `Lampa.Template.add` registrations (`cherry_main`, `cherry_source_card`,
`cherry_grid`, `cherry_card`, `cherry_group_label`, `cherry_source_row`).

---

## Search

| Mode | Entry | Behaviour |
|---|---|---|
| **Per-source** | in-grid action menu → Поиск (`_openSearch`, `plugin.js:634`) | `Lampa.Input.edit` opens the TV keyboard; pushes a single-source `cherry_grid` with `query` |
| **Global (all sources)** | Home `⌕` tile (`plugin.js:1009`) | `Lampa.Input.edit` → pushes `cherry_grid` with `all_sources:true` |
| **Похожие названия** | card menu → keyword search of the title words across all sources | `all_sources:true` grid |

> Search is opened via **`Lampa.Input.edit`**, NOT `Lampa.Keyboard.show` — the latter
> does not exist on this build.

**all_sources mechanics** (`_gridLoad`, `plugin.js:477`): runs `src.search(query, page)`
over every adapter in parallel (`Promise.all`, per-source failures swallowed). For Latin
queries a per-source title-match filter is applied *before* `slice(0,10)` (Cyrillic queries
skip the filter — scraped titles are mostly English). Results are concatenated per source.
The page paginates: if any source returns a full raw batch (≥10) the next page is offered.
An optional client-side `duration` sort (`client_sort`) can be applied per page.

---

## Categories — personalized per site, native labels

Every active adapter exposes `cfg.categories` (`_cats('slug:Label,...')`, `plugin.js:2939`).
**Labels are in the SITE's content language**, not the interface language:

- EN sites → English labels (`bbw:BBW`, `redhead:Redhead`, `big-tits:Big Tits`).
- RU sites → Russian labels (pornobolt/lenporno/tizam: `incest:Инцест`, `zrelye:Зрелые`).
- The interface and menus themselves stay Russian.

Slugs are real, per-site-verified values (autonomous extraction → browse-verified). Notable:

- **pornhub** categories are real webmasters-API **slugs** (`bbw`, `red-head`, `18-25`),
  passed as `&category=` — *not* numeric ids (`plugin.js:1570`).
- **xnxx** category route is the native `/tags/{slug}/...`; search stays on `/search/`
  (`plugin.js:1964`).

URL building is centralized in **`_buildCatUrl(fmt, slug, page, pageBase, page1Omit)`**
(`plugin.js:2924`) — one generic `{slug}`/`{page}` template + flags, no per-site URL hacks.
`_kvsEngine` carries `categoryFmt`; custom adapters add a `category` branch that calls
`_buildCatUrl` (or the API path for API-based browse).

---

## Sorts — personalized per site, heterogeneous mechanisms

Sort **labels are Russian** (interface). The POPULAR sort is the default everywhere,
labeled «По популярности». The old generic «По умолчанию» entry was removed — popular is
the explicit named default. The category list adds an «Все категории» reset entry.

| Mechanism | How | Sites |
|---|---|---|
| Query `?sort_by=` | KVS engine default (`sortParam`) | xozilla, analdin, hellporno, familyporn, perfektdamen, pornve |
| Query `?sort=` | `sortParam:'sort'` (KVS) / custom | pornobolt, lenporno |
| API `&ordering=` | webmasters API order | pornhub (`mostviewed`/`rating`/`mostrecent`/`longest`) |
| API `&order=` | API order | eporner |
| PATH segment | sort injected into the URL path | xvideos `/c/s:views/{slug}`, xnxx `/tags/{slug}/{sort}/`, porntrex, 3movs, crocotube, ebun, jopaonline, pornone |
| GLOBAL feed only | no per-category sort; sort swaps the no-category listing **root** | youjizz, hqporner, spankbang |
| NOT URL-addressable | DLE POST/AJAX → `sorts:[]` (categories only) | 24rolika, porndig, tizam |

`_kvsEngine` gained a **`sortMode:'path'`** flag (`plugin.js:2975`): when set, the sort id
is injected into the category path (`/categories/{slug}/{sort}/{page}/`) instead of being
appended as a query param. Used by KVS path-sort sites (crocotube, ebun).

---

## Pagination — infinite scroll

`InteractionCategory` drives paging via `nextPageReuest`. total_pages is derived, not
hardcoded:

- **`_derivePages(itemsLen, page, full)`** (`plugin.js:1446`): a full page (`itemsLen >= full`)
  → `page+1`; a short page → `page` (last). Replaces the old fake/hardcoded `total_pages`
  on ~14 channels.
- **all_sources** (global search + «Похожие названия») now paginates (was 1 page): the next
  page is offered while any source still returns a full batch.
- Genuinely single-page-search sites (search has no page param) report `total_pages:1`:
  `tizam`, `pornobolt`, `lenporno`, `24rolika`, `jopaonline`.

---

## Related ("Похожие") — two distinct menu items

The card long-press menu (`cardRender.onMenu`, `plugin.js:834`) offers two related actions:

1. **«Похожие»** — the SITE's own recommended videos (the block under the player). Built
   per-site via `getRelated(video)`:
   - `xvideos`/`xnxx`: parse the `video_related` JSON var on the video page (`plugin.js:1712`).
   - `eporner`: parse the video-page `mbcontent` HTML cards (`plugin.js:2002`).
   - `pornhub`: `relatedVideosJSON` block (`plugin.js:1651`).
   - `pornone`: reuses `_pornoneCards` on the video page (`plugin.js:2622`).
   - `_kvsEngine` sites + custom KVS-style adapters: reuse their listing card parser on the
     video page via `_relatedFrom(parser)` (`plugin.js:2825`).
   - Coverage ~16 channels. Only shown when `cardSrc.getRelated` exists.
   - On player close, a related grid is auto-pushed if `getRelated` resolved in the
     background (`playVideo` + the `player` `destroy` listener, REQ-4).
2. **«Похожие названия»** — a keyword search of the video's title words across all sources
   (`all_sources:true`), always offered.

---

## Model browsing

Activated the previously-dead `browseByModel`/`model_url` path for **pornhub only**:
`_mapVideo` sets `card.model {name, url}` from the JSON `pornstars[]` (`plugin.js:1556`).
`cardRender.onMenu` adds a «Модель: <name>» item when `element.model.name` exists; selecting
it pushes a `cherry_grid` with `model_url` → `browseByModel(model_url, page)` (`plugin.js:530`).
xvideos defines `browseByModel` but the model is only on the video page (not in listings),
so it is left dead.

---

## Metadata

- **Real preview URLs** from the `data-pvv` card attribute (xvideos/xnxx, `plugin.js:1761`,
  `plugin.js:1912`). The old *guessed* `/preview.mp4` URLs are gone.
- **HD/4K badge** is composed with duration in the `quality` slot in `toCard`
  (`plugin.js:439`): `v.hd ? (v.hd + ' · ' + secToTime(dur)) : secToTime(dur)`. `v.hd` is an
  optional adapter field, populated where the site exposes it (xvideos `video-hd-mark`,
  youjizz `i-hd`).
- **`_titleFromUrl(url)`** (`plugin.js:1432`) slug fallback for empty titles, used across
  ~14 parsers.

---

## Parser correctness

- **xnxx** `_parseCards` (`plugin.js:1891`) splits on the OUTER `thumb-block` wrapper. It
  previously split on the inner `thumb-under` caption → an off-by-one that bound a card's
  thumbnail to the next card's link and played the neighbour video. Both xvideos and xnxx
  now split on the outer wrapper (`plugin.js:1745`, `plugin.js:1895`); other split parsers
  confirmed correct.

---

## States

`empty(msg)` (`plugin.js:791`) distinguishes:
- **Error** — `cherry_load_error` ("Не удалось загрузить. Проверьте соединение.") on a hard
  load failure (`_gridLoad` reject).
- **No results** — `cherry_no_results` (default message).
- **Empty favorites** — a persistent `cherry_fav_empty_hint` ("Удерживайте ОК на видео чтобы
  добавить в избранное"), not a transient toast.

---

## Proxy Layer

Adapters route requests through one of **four proxy tiers** depending on the target
hostname. Routing lives in `buildProxyUrl` (`plugin.js:63`); on Android there is an
extra force-proxy rule (see **Android fetch model** below).

| Tier | Var | Endpoint | Used for |
|------|-----|----------|----------|
| Primary | `PROXY_URL` | `cherry-proxy.aawersom.workers.dev` (CF Worker + SOCKS5) | default; pornhub via residential SOCKS5 |
| Secondary | `PROXY_URL_2` | `185-36-141-21.sslip.io` (self-hosted **VPS**, stable IP) | CF-ASN-blocked + KVS IP-bound sites |
| Tertiary | `PROXY_URL_3` | `''` (unused) | reserved for residential VPS |
| Val.town | `PROXY_URL_VT` | `aawersom--0d56e6a4…web.val.run` (free HTTP val) | **spankbang** only (passes CF challenge) |

> **History:** the secondary tier was **Deno Deploy** until 2026-06-06, when it was migrated
> to the VPS (Deno free egress quota kept dying on video streaming). `PROXY_URL_2` is now the
> VPS. spankbang moved off the VPS to **Val.town** on 2026-06-08 (the VPS datacenter IP gets
> Cloudflare's "Just a moment" 403; Val.town's IP passes it — see Val.town tier below).

### Primary proxy — Cloudflare Worker + SOCKS5
`PROXY_URL = https://cherry-proxy.aawersom.workers.dev`

Default for all adapters. For domains in `RESIDENTIAL` set in `index.js`, the CF Worker
tunnels the outbound request through **rotating Dutch residential SOCKS5 proxies**
(`45.91.209.155:11750–11756`) using the `cloudflare:sockets` `connect()` API.

**RESIDENTIAL set (current):**
- `www.pornhub.com`, `rt.pornhub.com` — phncdn IP-bound tokens require consistent egress IP
- Wildcard `/\.phncdn\.com$/` — covers all phncdn CDN subdomains (segments, thumbnails)

> **Note (2026-06-04):** pornone is NOT on the residential/worker path. The plugin's
> `buildProxyUrl` routes `pornone.com` + `*.pornone.com` to **Deno** (see Secondary proxy
> below), and pornone is confirmed WORKING via Deno. Any leftover `pornone` entry in the
> worker's `index.js` residential set is legacy/unused (pornone never reaches the worker).

**DJB2 domain-hash affinity:** SOCKS5 port is selected by DJB2 hash of the request's
`referer` domain (or target hostname if no referer). Since all 5 ports exit from
`45.91.209.155` with **different residential exit IPs**, consistent port selection
is critical for IP-bound tokens. Key rule: all requests in a session that share
a token must carry the same `referer` domain so DJB2 selects the same port.

**M3U8 rewriting:** Any response whose Content-Type or path ends in `.m3u8` has all
segment/sub-playlist URLs rewritten to go through the proxy. The `referer` is now
**propagated into rewritten segment URLs** (fix 2026-06-03) so DJB2 selects the
same SOCKS5 port for M3U8 and segments — previously, different domain hashes
(`www.pornhub.com` vs `ev-h.phncdn.com`) selected different ports (different exit
IPs), causing `ipa=1` token failures on segments.

### Secondary proxy — VPS (self-hosted, stable IP)
`PROXY_URL_2 = https://185-36-141-21.sslip.io`

A self-hosted VPS (Ubuntu, stable datacenter IP, unmetered bandwidth) running the Deno
proxy script (`workers/cherry-proxy-deno/main.js`) via systemd behind Caddy/TLS (sslip.io).
Replaced Deno Deploy (whose free egress quota died on video streaming). The VPS also hosts
an AmneziaWG VPN — the proxy only adds services on free ports, never touches the VPN.
VPS→CF failover is built in (`_hasProxyFailover`) so a dead VPS falls back to the CF worker.

Used for hostnames in `PROXY_URL_2_HOSTS` or matching the CDN regexes:

| Hostname | Reason |
|----------|--------|
| `xnxx.com`, `www.xnxx.com` | CF datacenter ASN-blocked; VPS IP works |
| `www.youjizz.com`, `youjizz.com` (+ `/\.youjizz\.com$/`) | CF rate-limited; stream CDN co-located |
| `tv4.tizam.org` | CF rate-limited |
| `www.eporner.com` | SOCKS5 instability — VPS stable |
| `hqporner.com`, `www.hqporner.com` | CF datacenter intermittently blocked |
| `mydaddy.cc` | bigcdn IP-bound token — same IP as bigcdn CDN fetch |
| `www.perfektdamen.co` | KVS IP-bound tokens — consistent VPS IP |
| `pornone.com`, `www.pornone.com` (+ regex) | KVS IP-bound tokens — fixed VPS IP |
| `porntrex.com`, `www.porntrex.com` (+ `/\.cdntrex\.com$/`) | KVS IP-bound tokens — fixed VPS IP |
| `/\.bigcdn\.cc$/` (regex) | All bigcdn subdomains; IP-bound to mydaddy.cc fetch IP |

**Critical pairing rule:** domains whose CDN uses IP-bound tokens must be in the
SAME proxy tier as the page that generates those tokens (the `buildProxyUrl` regexes
co-locate page + stream-CDN subdomains on one egress IP).
- `mydaddy.cc` (embed page) and `*.bigcdn.cc` (CDN) — both via VPS ✓
- `www.pornhub.com` (page) and `*.phncdn.com` (CDN) — both via CF SOCKS5 ✓
- `pornone.com` / `porntrex.com` and their CDNs — both via VPS ✓

### Tertiary proxy — residential VPS (unused)
`PROXY_URL_3 = ''` (empty). Reserved for a rotating-residential VPS; `PROXY_URL_3_HOSTS`
still lists pornhub but, with `PROXY_URL_3` empty, those fall through to the CF worker.

### Val.town tier — spankbang (free, CF-challenge bypass)
`PROXY_URL_VT = https://aawersom--0d56e6a4…web.val.run` · hosts in `PROXY_URL_VT_HOSTS`
(`ru.spankbang.com`, `spankbang.com`, `www.spankbang.com`).

A free **Val.town HTTP val** (`workers/cherry-proxy-valtown/main.ts`). spankbang sits behind
a Cloudflare bot-challenge ("Just a moment" 403) that the CF worker **and** the VPS datacenter
IP both fail; Val.town's egress IP **passes** it (as Deno Deploy used to). Routed FIRST in
`buildProxyUrl`, before the VPS/CF tiers. **Only the light listing (KB) goes through Val.town**
— the spankbang video stream is a signed-token mp4 on `sb-cd.com` (not IP-bound) fetched
directly, so Val.town free-tier usage stays far under the 100k-runs/day limit. Deploy/manage
via the Val.town API (token + endpoint recorded in the local access vault).

### buildProxyUrl(url, referer?) — `plugin.js:53`
```
GET {base}/proxy?url={encoded}&key={getProxyKey()}[&referer={encoded}]
```
The proxy key is read per-request via **`getProxyKey()`** (`plugin.js:44`,
`Lampa.Storage.get('cherry_proxy_key', '1206')`) — there is no module-level `PROXY_KEY`
constant anymore. Routing priority (`forceCF=true` skips secondary routing → straight to CF):
1. `PROXY_URL_VT` if hostname in `PROXY_URL_VT_HOSTS` (spankbang) — Val.town.
2. `PROXY_URL_3` (if set + hostname in `PROXY_URL_3_HOSTS`) — residential VPS, currently empty.
3. `PROXY_URL_2` (VPS) if hostname in `PROXY_URL_2_HOSTS` **or** matches
   `/\.bigcdn\.cc$/` / `/(?:^|\.)pornone\.com$/` / `/(?:^|\.)youjizz\.com$/` / `/\.cdntrex\.com$/`.
4. `PROXY_URL` (default, CF Worker).

### Android fetch model — `_isAndroid()`, `_forceProxyAndroid()`, `px()`
On Android TV the device has its own **home residential IP** (cleaner than any datacenter IP
for most sites), so the default Android path is **native + raw**:
- **Pages:** `cherryFetch` uses `Lampa.Reguest.native()` (fetches from the device IP), falling
  back to the proxy only on error.
- **Streams:** `px()` (in `playVideo`) hands the player the **raw** URL — the native player
  fetches the stream from the SAME device IP, so KVS/phncdn IP-bound tokens stay valid with no
  proxy. `px()` normalizes `//protocol-relative` → `https:` **before** the Android return (else
  the native player shows a "choose player" dialog — youjizz fix).
- **Quality:** getStream prefers **MP4 over HLS on Android** (Android routes `.m3u8` to the
  system "choose player" dialog; MP4 plays inline).

**Exception — `_ANDROID_FORCE_PROXY`:** sites that block/redirect the device home IP
(Cloudflare challenge, mirror redirect, empty body). For those BOTH page and stream go through
the proxy (`_forceProxyAndroid()`). Listed only when the stream co-locates with the page proxy
(else IP-affinity breaks — that's why xnxx/youjizz, whose CDN is a separate unrouted domain,
are NOT here):
- `hqporner` (→VPS; bigcdn stream VPS-routed) · `hellporno` (→CF; same-host stream)
- `lenporno`, `eporner` (→their tier; page only — stream CDN on a separate host stays raw)
- `spankbang` (→Val.town; CF-challenged on the device IP too)

> **pornhub (resolved 2026-06-08):** plays on Android — `getStream` returns the HLS m3u8 **raw**
> on Android, so the native player fetches page + m3u8 + segments from the one device residential
> IP → phncdn IP-bound tokens hold. The browser/proxy path stays flaky (CF SOCKS5 pool rotates
> exit IPs; VPS datacenter IP gets phncdn 410).

### cherryFetch(url, referer?)
Wrapper around `fetch(buildProxyUrl(...))` with VPS→CF failover. Returns `Promise<string>`.
On Android: `_forceProxyAndroid(url)` hosts go straight to the proxy; everything else tries
`Lampa.Reguest.native()` first, falling back to fetch+proxy on error.

### Android self-test harness — `test/android-emu.cjs`
Loads the real `plugin.js` with a Lampa mock (`Platform.is('android')===true`,
`Reguest.native` = direct fetch, `Lampa.Player.play` **intercepted**) → prints the exact
stream URL the Android player would get per channel + browse card count, without a device.
Run: `node test/android-emu.cjs [ids…]`. Verifies URL-shaping/routing logic (not device-IP
token validity — egress is this host, not the device's home IP).

### _fetchAny(url, referer?) — `plugin.js:114`
Status-tolerant fetch: returns the body text regardless of HTTP status. Needed for sites
(e.g. 3movs) that serve a valid full page body with a 404 status on category pagination.

### cherryPost(url, body)
POST via native `fetch` directly (no proxy wrapper). Used by Spankbang stream API
(`/api/videos/stream`). Note: CF Worker SOCKS5 path is GET-only — POST requests to
RESIDENTIAL domains still exit via CF datacenter. For Spankbang, this is acceptable
since Phase 2 (streamkey POST) is a fallback and Phase 1 (quality map regex) covers most videos.

### proxyM3u8(url, referer?)
**⚠ Deprecated.** Fetches M3U8 client-side and returns a `blob:` URL.
Causes **double-proxy** when CF Worker's server-side `rewriteM3u8()` is also active.
No longer called by any adapter (removed from `pornhub` in Iteration 2).
Only safe for plain pass-through proxies that do NOT rewrite M3U8.

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

## Source Adapters — Full List (24 active, 1 disabled)

| # | id | name | host | Proxy tier | Stream method | Status |
|---|---|---|---|---|---|---|
| 1 | `pornhub` | Pornhub | pornhub.com | CF SOCKS5 (RESIDENTIAL) | HLS via phncdn CDN; referer propagated in M3U8 rewrite for IP-affinity | ✅ Working |
| 2 | `xvideos` | Xvideos | xvideos.com | CF datacenter | HLS from CDN | ✅ Working |
| 3 | `xnxx` | Xnxx | xnxx.com | Deno | MP4/HLS from CDN | ✅ Working |
| 4 | `eporner` | Eporner | eporner.com | Deno (video pages) | JSON API browse; video page via Deno | ✅ Working |
| 5 | `spankbang` | Spankbang | ru.spankbang.com | Deno | Quality map regex + streamkey POST fallback; `ru.` subdomain bypasses bot-check | ✅ Working |
| 6 | `hqporner` | HQPorner | hqporner.com | CF (page) → Deno (mydaddy.cc + bigcdn) | hqporner.com page via CF; embed `mydaddy.cc` + CDN `*.bigcdn.cc` both via Deno (same GCP IP for IP-bound token) | ✅ Working |
| 7 | `youjizz` | YouJizz | youjizz.com | Deno | Direct MP4 | ✅ Working |
| 8 | `pornone` | PornOne | pornone.com | Deno | KVS IP-bound tokens — page + CDN both via Deno GCP IP for token affinity | ✅ Working |
| 9 | `porntrex` | Porntrex | porntrex.com | Deno | KVS IP-bound tokens — page + CDN both via Deno GCP IP; 410 on CF edge drift | ✅ Working |
| 10 | `xozilla` | Xozilla | xozilla.com | CF datacenter | KVS `_kvsEngine` | ✅ Working |
| 11 | `3movs` | 3Movs | 3movs.com | CF datacenter | KVS signed-token | ✅ Working (token may expire) |
| 12 | `analdin` | Analdin | analdin.com | CF datacenter | KVS `_kvsEngine` | ✅ Working |
| 13 | `pornve` | PornVe | pornve.com | CF datacenter | `videoUrl:` JS var | ✅ Working (token may expire) |
| 14 | `familyporn` | FamilyPorn | familyporn.tv | CF datacenter | KVS CDN | ✅ Working (token may expire) |
| 15 | `porndig` | Porndig | porndig.com | CF datacenter | Custom VHS player (videos.porndig.com); `"srcSet"` JSON extraction with `\/`-unescape; skips preview entries | ✅ Working |
| 16 | `tizam` | Tizam | tv4.tizam.org | Deno | Direct MP4 | ✅ Working |
| 17 | `perfektdamen` | PerfektDamen | perfektdamen.co | Deno | KVS CDN, IP-bound | ✅ Working |
| 18 | `hellporno` | HellPorno | hellporno.com | CF datacenter | KVS `_kvsEngine` | ✅ Working |
| 19 | `pornobolt` | Pornobolt | sex.pornobolt.in | CF datacenter | KVS pbcdn.tv CDN | ✅ Working |
| 20 | `crocotube` | CrocoTube | crocotube.com | CF datacenter | KVS alphaxcdn.com CDN | ✅ Working |
| 21 | `huyamba` | Huyamba | fuq.huyamba.mobi | — | — | ❌ Disabled (site dead 2026-06) |
| 22 | `ebun` | Ebun | www1.ebun.tv | CF datacenter | HTML scraping | ✅ Working (token may expire) |
| 23 | `lenporno` | LenPorno | www.lenporno.net | CF datacenter | Custom CDN path | ✅ Working |
| 24 | `24rolika` | 24Rolika | w2.huyalkino.com | CF datacenter | DLE + Playerjs (`new Playerjs({file:"url"})`) → videosdrop.com CDN mp4 | ✅ Working |
| 25 | `jopaonline` | JopaOnline | jopaonline.mobi | CF datacenter | DLE + JWPlayer | ✅ Working |

**Proxy tier legend:**
- **CF datacenter** — CF Worker direct fetch; consistent within a CF PoP but may vary across PoPs
- **CF SOCKS5** — CF Worker tunnels through Dutch residential proxies (45.91.209.155:11750–11756); use for domains where IP-bound tokens require consistent egress IP
- **Deno** — Deno Deploy GCP proxy; use when CF ASN is blocked or when bigcdn/perfektdamen IP-bound tokens need consistent GCP IP
- **Deno paired** — page fetch AND CDN fetch both via Deno to share the same GCP exit IP (critical for IP-bound CDN tokens)

**IP-bound token pairing rule (critical):**
When a CDN generates tokens bound to the requesting IP, the page that generates the token and the CDN that validates it must use the SAME proxy tier. Violating this causes 404/403 on media requests. Current pairs:
- `mydaddy.cc` + `*.bigcdn.cc` → both Deno
- `www.pornhub.com` + `*.phncdn.com` → both CF SOCKS5 (+ referer propagation in M3U8 rewrite)
- `pornone.com` + `*.pornone.com` → both **Deno** in the plugin's `buildProxyUrl`
  (the worker `index.js` may still list them as SOCKS5 — see the *buildProxyUrl* contradiction note)

**UX extras** (see the dedicated UI / Search / Categories / Sorts / Related / Model / Metadata sections):
- `cfg.categories` (all 24) + `cfg.sorts` (heterogeneous) — right-edge action menu + header button
- `browseByModel(modelUrl, page)` — model menu item (pornhub only)
- `getRelated(video)` — «Похожие» menu item + auto related grid after playback (~16 channels)
- `video.preview` — animated preview clip on focus; populated by **xvideos/xnxx** (`data-pvv`)
  and **pornhub** (`data-mediabook`). The old guessed `/preview.mp4` URLs were removed.

---

## Known Improvement Backlog (from AdultJS analysis)

Discovered 2026-05-29 by comparing with AdultJS implementation.

| Adapter | Gap | Fix | Effort | Status |
|---------|-----|-----|--------|--------|
| `xvideos` + `xnxx` | `video.preview` not populated | Use the real `data-pvv` card attribute | done | ✅ Implemented (`data-pvv`, not the guessed `_169.mp4`) |
| `pornhub` | `video.preview` not populated in webmasters browse | `data-mediabook` extraction in `_parseHtmlCards()` (browseByModel path) | done | ✅ Implemented |
| `pornhub` | Browse uses webmasters API (no preview/model in listing) | Switch to HTML scrape `rt.pornhub.com/video?page=N` | Medium | ⏸ Deferred (API browse kept; model surfaced from JSON `pornstars[]`) |
| `spankbang` | Quality map regex may miss formats | Add a quality-map regex before POST fallback | ~10 lines | ⏸ Deferred |
| `xvideos` + `xnxx` | `video_related` JSON parsed separately from stream | Move related parse into `getStream` | Medium | ⏸ Deferred (`getRelated` is a separate page fetch) |

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
| `Lampa.Storage.get('cherry_proxy_key', '1206')` | `plugin.js:45` | `getProxyKey()` — read proxy key per request |
| `Lampa.Storage.get(this._key, [])` | `plugin.js:245` | Load favorites array (key: `cherry_favs`) |
| `Lampa.Storage.set(this._key, list)` | `plugin.js:279` | Persist favorites after toggle |
| `Lampa.Storage.get('cherry_proxy_key', null)` | `plugin.js:1223` | First-run detection |
| `Lampa.Storage.set('cherry_proxy_key', '1206')` | `plugin.js:1224` | Write default key on first run |
| `Lampa.Storage.get('cherry_preview_enabled', true)` | `plugin.js:929` | Read preview-clip toggle on card focus |

### Lampa.Noty
| Call | Purpose |
|---|---|
| `Lampa.Noty.show(text)` | Loading indicator, fav feedback, error toasts |
| `Lampa.Noty.show(text, { style: 'warn' })` | Warning-style toast |
| `Lampa.Noty.show(text, { time: 7000 })` | Extended-duration toast (first-run proxy key notice) |

### Lampa.Lang
| Call | Purpose |
|---|---|
| `Lampa.Lang.add({key: {ru, en}})` | Registers ~28 translation keys (`addLang`, `plugin.js:1119`) |
| `Lampa.Lang.translate(key)` | Resolves translation key to current locale string |

### Lampa.InteractionCategory (base class)
| Call | Purpose |
|---|---|
| `new Lampa.InteractionCategory(object)` | Base for both `CherryGrid` and `CherryMain`. Owns nav (focus move, scroll-into-view, edge detection), pagination (`nextPageReuest`), and DOM (stock `.card` rendering via `build`/`cardRender`) |

> `Lampa.Template.*` is no longer used (templates removed). `Lampa.Controller.add` with a
> custom `{up,down,left,right}` handler set is **gone** — that hand-rolled controller caused
> the `Controller.move()` recursion bug. The plugin still calls `Lampa.Controller.toggle('content')`
> to hand focus back after menus/pushes. `Lampa.Scroll` is no longer instantiated by the
> plugin (the base class owns scrolling).

### Lampa.Input
| Call | Purpose |
|---|---|
| `Lampa.Input.edit({title, value, free, nosave}, cb)` | TV keyboard for search input (per-source and global). Replaces the non-existent `Lampa.Keyboard.show` |

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

### Lampa.SettingsApi
Preview toggle (`cherry_preview_enabled`) registered via
`SettingsApi.addComponent({component:'cherry', ...})` + `addParam({type:'trigger'})`
(`plugin.js:1235`, guarded — both must exist). `trigger` params auto-persist to
`Lampa.Storage` under `param.name`, so no `onChange` is needed. If `SettingsApi` is
unavailable the code logs a warning and relies on the read default.

### Lampa.Reguest (class)
| Call | Purpose |
|---|---|
| `new Lampa.Reguest()` | Android-native HTTP fetch (used in `_nativeFetch()`, `plugin.js:81`) |
| `.native(url, ok, err, sync, opts)` | 5-arg signature: native OS-level HTTP request, bypasses WebView CORS |
| `.clear()` | Cancels in-flight request |

### Lampa.Empty (class)
| Call | Purpose |
|---|---|
| `new Lampa.Empty({descr})` | Used by `comp.empty(msg)` to render a custom error / no-results / favorites-empty message (`plugin.js:797`) |

### Lampa.Listener
| Call | Purpose |
|---|---|
| `Lampa.Listener.follow('app', fn)` | Waits for `app:ready` event before initialising |
| `Lampa.Listener.follow('player', fn)` | On `destroy`: revokes HLS blob URLs + pushes the related grid if `getRelated` resolved (`plugin.js:1279`) |
| `Lampa.Listener.follow('activity', fn)` | `addFilterButton`: show/hide the header filter button per top activity (`plugin.js:1201`) |

> **`Lampa.Keyboard.show` does not exist on this build** — search uses `Lampa.Input.edit`
> (see the *Lampa.Input* row above). Earlier docs referencing `Lampa.Keyboard` are stale.

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

## Source Status — Iteration 3 (live test 2026-06-03)

Live testing session. All originally-reported broken channels fixed.

### Fixes applied in this iteration

| id | was broken | root cause | fix |
|---|---|---|---|
| `pornhub` | Segments 404 (`ipa=1`) | Different SOCKS5 ports for M3U8 (`www.pornhub.com` hash) vs segments (no referer → `ev-h.phncdn.com` hash) → different exit IPs → token mismatch | Add `/\.phncdn\.com$/` to RESIDENTIAL; propagate `referer` through `rewriteM3u8` so all phncdn requests hash the same domain → same SOCKS5 port → same exit IP |
| `hqporner` | bigcdn 404 | `mydaddy.cc` embed fetched via CF datacenter (IP A); `*.bigcdn.cc` CDN fetched via Deno (IP B); bigcdn token bound to IP A → rejects IP B | Add `mydaddy.cc` to `PROXY_URL_2_HOSTS` → both embed fetch and CDN fetch via Deno (same GCP IP) |
| `spankbang` | No cards or previews | Previous fix (stream-fix-2) moved to CF SOCKS5 — Dutch IP also blocked by Spankbang for browse | Revert to Deno (`ru.spankbang.com` in `PROXY_URL_2_HOSTS`); fix thumbnail regex to skip `data:` placeholders from lazy-loaders; add `preview` field to cards |
| `pornone` | CDN 403 | `extractStreams` looks for `"file"` key in sources array; FluidPlayer uses unquoted `src:` key → extraction missed main video, fell through to restricted preview URL | Insert FluidPlayer-specific regex before `extractStreams`: `/sources\s*[=:]\s*\[[\s\S]{0,2000}?['"]?src['"]?\s*:\s*['"]([^'"]+\.(?:mp4\|m3u8))/i` |
| `porntrex` | "interrupted by new load" | Trailing `/` in `get_file` URL not stripped by existing regex `/['">\s]+$/` | Extend strip regex to `/['">\/\s]+$/` |
| `porndig` | Preview clip instead of main video | Pattern 1 (generic `file/src` key) fires first, matches a preview URL; sources array pattern (more specific) never runs | Swap pattern order: sources array (P2) first, generic `file/src` (P1) as fallback |
| `24rolika` | Some category pages empty | `_rolikaCards` href regex used `[a-z]+` for category slug — excluded hyphens and digits (e.g. `/film-porno/`, `/xxx-18/`) | Change to `[a-z0-9][a-z0-9\-]*` |

### Known limitations after Iteration 3

| id | limitation | notes |
|---|---|---|
| `spankbang` | Some video pages may 403 (Spankbang bot-protection varies per video) | `ru.spankbang.com` bypasses most checks; heavily-protected videos require Playwright |
| `hqporner` | ~55–110 hours/month via Deno free tier (100 GiB bandwidth) | bigcdn MP4 files stream through Deno; upgrade to paid tier if limit reached |
| All KVS sources | Tokens expire; E2E test may fail if > token TTL elapses between getStream and play | In live Lampa usage (immediate playback) reliable |

### Channels with no issues (not reported, confirmed working)

`xvideos`, `xnxx`, `eporner`, `youjizz`, `xozilla`, `3movs`, `analdin`, `pornve`,
`familyporn`, `tizam`, `perfektdamen`, `hellporno`, `pornobolt`, `crocotube`, `ebun`,
`lenporno`, `jopaonline`

### Key architectural lesson (L12)

**Residential proxy ports ≠ same exit IP.** Pool-based residential proxies (e.g. 45.91.209.155:11750–11756) assign different residential exit IPs per port. DJB2 domain-hash must produce the same port for all requests sharing an IP-bound token. Fix: ensure all requests in a session propagate the same `referer` domain so DJB2 consistently selects the same port.

---

## Categories & per-source filters (2026-06-04)

All 24 active adapters expose `cfg.categories` (and `cfg.sorts` where supported), surfaced in
the right-edge action menu (Поиск → Сортировка → Категории) and the header filter button.
See the dedicated **Categories** and **Sorts** sections above for the full per-site mechanism
table; this is a summary.

**Architecture:** one generic `_buildCatUrl(fmt, slug, page, pageBase, page1Omit)` builds every
site's category URL from a `{slug}`/`{page}` template + flags — no per-site URL hacks.
`_kvsEngine` exposes `cfg:{categories,sorts}` and uses `categoryFmt` (+ optional `sortMode:'path'`)
in browse. Custom adapters add `cfg` + a `category` branch in their `browse`.

**Per-site notes:**
- HTML-parser sites reuse their existing card parser on the category page.
- eporner: API keyword search (`query=slug`); pornone: HTML `/{slug}/` + `_pornoneCards`.
- **pornhub: webmasters `&category={slug}` (real slugs — `bbw`, `red-head`, `18-25` — NOT
  numeric ids).** (Corrects the earlier "numeric ids" note.)
- porndig: composite `{id}/{name}` channel slug. xnxx: native `/tags/{slug}`. xnxx/xvideos:
  0-based page. youjizz: page-in-filename. hqporner: singular `/category/`. 3movs: `_fetchAny`
  (404-but-valid body on page>1). tizam: single static page (JS pagination → total_pages 1).
- **Sort is now implemented (no longer deferred)** via heterogeneous mechanisms (query
  `?sort_by=`/`?sort=`, API `&ordering=`/`&order=`, PATH segment incl. `sortMode:'path'`,
  global-feed root swap). DLE/AJAX-POST sites (24rolika, porndig, tizam) keep `sorts:[]`.

## UI/UX history (superseded by the InteractionCategory migration)

> **The InteractionCategory rewrite (2026-06-04) superseded most of the cherry-ux-v2
> presentation work below.** Kept for the engineering rationale; the *current* behaviour is
> in the **UI / Search / Pagination / States** sections above.

| Feature | Status now |
|---|---|
| **UX-E** Empty-favorites hint (`cherry_fav_empty_hint`) | ✅ Still active, now via `empty(msg)` override |
| **UX-G** «Похожие» card menu item (guarded by `source.getRelated`) | ✅ Active; joined by «Похожие названия» |
| **UX-C** Preview toggle in Lampa Settings (`SettingsApi.addComponent` + `trigger` param) | ✅ Active |
| **P0** header filter access | ✅ Replaced by `addFilterButton` (one header button) + right-edge `onRight` menu; the old `.cherry-grid__actions`/`.cherry-grid__filters` DOM is gone |
| **P1** D-pad infinite scroll (custom IntersectionObserver/`maybeLoadMore`) | ⛔ Superseded — pagination is now owned by `InteractionCategory.nextPageReuest` |
| **P2** Grouped search results (`.cherry-group-label` templates) | ⛔ Superseded — all_sources is now a FLAT concat with `.cherry-src-badge` per card; `cherry_group_label`/`cherry_source_row` templates removed |
| **UX-A** Home row mode (`cherry_home_mode`) | ⛔ Removed — home is the tile picker only; `cherry_source_row` template + `cherry_home_mode` storage key gone |

**Surviving i18n keys:** `cherry_fav_empty_hint`, `cherry_related`, `cherry_search`,
`cherry_sort`, `cherry_category`, `cherry_load_error`, `cherry_similar_titles`,
`cherry_model`, `cherry_proxy_key_init` (+ the full set in `addLang`, `plugin.js:1119`).
`cherry_view_rows`/`cherry_view_tiles` remain registered but are no longer used.

**Key invariants still enforced:**
- `Lampa.Input.edit` callback is a plain `function(text)`; `Lampa.Select` is camelCase
  (`onSelect`/`onBack`). `Lampa.Keyboard` does NOT exist on this build.
- `SettingsApi.addComponent` MUST precede `addParam`; boolean type is `trigger` (auto-persists
  by param name — no `onChange`).
- `video.source = src.id` set on every card (`toCard`) to keep the Fav 7-field invariant.

---

## Source Status — Iteration 4 (live test 2026-06-03)

Second live session. Iteration 3 fixes for porntrex/porndig/pornone/24rolika were incomplete or had wrong root causes. Full re-diagnosis and re-fix.

### Fixes applied in this iteration

| id | was broken | actual root cause | fix |
|---|---|---|---|
| `pornone` | Still broken after Iter 3 FluidPlayer fix | KVS IP-bound tokens: CF Worker edge nodes have different exit IPs per request → token mismatch → 403 | Add `pornone.com`, `www.pornone.com` to `PROXY_URL_2_HOSTS` → Deno Deploy fixed GCP IP for both page fetch and CDN |
| `porntrex` | 410 Gone on video | KVS IP-bound tokens: same CF edge drift problem as pornone | Add `porntrex.com`, `www.porntrex.com` to `PROXY_URL_2_HOSTS` → Deno routing |
| `porndig` | Preview clip played instead of real video | Player uses custom VHS player (not JWPlayer/FluidPlayer). Sources in `"srcSet":[{src,label}]` JSON (not `sources:`). Slashes escaped as `\/`. Previous swap-pattern fix never matched the actual structure. | Rewrite `getStream`: find all `"srcSet"` arrays, iterate `{src,label}` entries, filter numeric labels ≥240, unescape `\/` in URLs. Fallback does NOT call `extractStreams(html)` (main page only has preview clips). |
| `24rolika` | Couldn't extract video URL | Site uses `Playerjs` player (`new Playerjs({file:"url"})`), not JWPlayer. Old regex matched `jwplayer(...).setup(...)` which never fires. | Add Playerjs regex as primary; keep JWPlayer as fallback |
| `pornhub` | Intermittent 410 on HLS manifest (not every play) | Race condition in SOCKS5 fallback: if primary port fails for page fetch → fallback to port Y (IP B). Manifest fetch retries primary port (now recovered, IP A). Token was generated for IP B → 410. | Set `maxTries = 1` for phncdn + pornhub in `fetchViaResidential` — no fallback on SOCKS5 failure. Clean error beats silent IP switch. |

### UI fixes applied in this iteration

| location | was wrong | fixed to |
|---|---|---|
| Long-press context menu — favorites item | "Добавлено в избранное" / "Убрано из избранного" (past tense — sounds like confirmation, not action) | "Добавить в избранное" / "Убрать из избранного" (infinitive — correct for a menu action) |
| First-run proxy key notification | Hardcoded Russian string, no i18n | Added `cherry_proxy_key_init` key with ru + en translations |

**Key rule preserved:** toast notifications after the action keep past-tense form ("Добавлено в избранное") — this is correct for a toast confirming a completed action. Menu item labels use infinitive ("Добавить") — this is correct for an available action.

### Known limitations after Iteration 4

| id | limitation | notes |
|---|---|---|
| `pornhub` | If DJB2-selected SOCKS5 port is down, pornhub fails completely | Clean failure; retry immediately gets fresh token via same port (once port recovers) |
| `porndig` | VHS player tokens have expiry (`expires=` param) | Works in live Lampa (immediate playback); may fail if player page fetch is slow |
| `24rolika` | ~2/6 videos may appear to not load on fast double-click | Race condition: second `hover:enter` fires `playVideo` again, interrupts `video.play()` promise. Not a plugin bug — don't double-click. |

### Channels confirmed working after Iteration 4

`pornone`, `porntrex`, `porndig`, `24rolika`, `pornhub` — all confirmed by live user test.

---

## INIT Sequence

```
plugin.js evaluated
  → IIFE guard check (window.plugin_cherry_ready)
  → window.appready check
      YES → startPlugin() immediately
      NO  → Lampa.Listener.follow('app', e.type==='ready' → startPlugin())

startPlugin():   (plugin.js:1221)
  → first-run proxy key notice (Storage default '1206' + Noty cherry_proxy_key_init, setTimeout 1500ms)
  → addLang()    — Lampa.Lang.add()  (no addTemplates — templates removed)
  → addStyles()  — <style id="cherry-plugin-styles"> (~30 scoped lines) into document.head
  → SettingsApi.addComponent('cherry') + addParam(cherry_preview_enabled, type:'trigger')  [guarded]
  → Lampa.Component.add('cherry_main', CherryMain)   — InteractionCategory subclass
  → Lampa.Component.add('cherry_grid', CherryGrid)   — InteractionCategory subclass
  → addFilterButton()   — persistent header filter action (cherry_grid only)
  → Lampa.Menu.addButton(...)
  → Lampa.Listener.follow('player', ...)  — blob revoke + related-grid push on player destroy
```

> The proxy key is no longer read at module init — `getProxyKey()` reads `Lampa.Storage`
> lazily on every `buildProxyUrl` call.
