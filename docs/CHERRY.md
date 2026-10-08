# Cherry Plugin — Architecture Documentation

## Overview

Cherry is a Lampa plugin that adds a self-contained adult video aggregator. It registers two
Lampa components (`cherry_main`, `cherry_grid`), routes all external HTTP through a single
Cloudflare Worker proxy, and exposes a uniform `SourceAdapter` interface over 25 heterogeneous
backends.

Entry file: `plugin.js` (single-file, ~8000 lines, v0.13.32)

> **Line references (`plugin.js:NNN`) below are historical** — the file roughly doubled since they
> were written. Search by symbol name (e.g. `function CherryGrid(`, `function buildProxyUrl(`,
> `var Sync = {`), not by line number.

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

**Poster self-heal (v0.13.12):** the persisted `thumb` can expire — pornhub thumbnails are
IP-bound signed URLs with a ~24h TTL, so a favorite opened the next day showed a **blank poster**
(pornhub is the only channel with expiring thumbs; all others store stable URLs — stand-verified).
Fix: `cardRender` attaches a one-shot `error` handler to the poster `<img>`; on load failure it
calls the source's optional **`refreshThumb(video)`** and swaps in a fresh URL. Only `pornhub`
implements it (re-fetch the video page → a freshly-signed `hdnea`/pix-fl image, which renders from
any IP; stand-verified 640×360 loads). Generic hook — also self-heals any transient CDN failure.
Stand-verified end-to-end (v0.13.15, `test/tv-fav-posters.mjs`): favorites from 9 channels incl. a
pornhub card with a deliberately broken token → 9/9 posters load, the broken one healed to 640 px.
**Legacy records (v0.13.16):** favorites saved before v0.13.11 may still hold the xvideos/xnxx hover
template (`…/xv_THUMBNUM_t.jpg`, a 404 as a poster); `Fav.all()` normalizes `THUMBNUM`→`1` on read
(`test/tv-fav-legacy.mjs`).
**Order + pull-on-open (v0.13.17):** `Fav.all()` returns records **newest first by `added`** — local toggles unshift but `_merge` appends records pulled from another device, so a video favorited elsewhere used to land at the bottom of the grid. Opening favorites now runs `Sync.run()` first (capped at 2.5 s; no PIN / failure → local list) and renders on a later tick — which also lets the empty-state hint mount (the old blank empty-favorites screen came from resolving synchronously before the activity was registered).

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

## Screens on Lampa.Maker (v0.13.27)

Lampa (lampa.mx, 2026-10) marks `InteractionCategory`, `InteractionMain`, `InteractionLine` and `Card`
as deprecated and builds its own screens with `Lampa.Maker.make('Category', object)` — a module system
(`Items` / `Create` / `Next` / `Empty`, optional `Pagination` / `Loading`) on an `Emit` base, with
`onCreate` / `onNext(resolve, reject)` / `onInstance(card, data)` hooks; cards are `Card` instances
configured through `card.use({ onFocus, onEnter, onLong })` (the `Callback` module raises them).

Cherry's two screens (`cherry_main`, `cherry_grid`) describe themselves as hooks and `_cherryScreen`
maps them onto Maker, or onto the legacy `InteractionCategory` when Maker is absent:

| hook | Maker | legacy |
|---|---|---|
| `load(page, ok, fail, append)` | `onCreate` → `build({results,total_pages})`; `onNext` (page = `this.object.page`; stops by setting `total_pages`) | `create` / `nextPageReuest` |
| `card(ui, element)` | `onInstance` → `card.use({onCreate})`; `ui.onEnter/onLong/onFocus` → `card.use(...)` | `cardRender` → `card.onEnter/onMenu/onFocus` |
| `empty(reason)` | `params.empty` → Maker `Empty` module (Lampa adds «Обновить») | `Lampa.Empty({descr})` |
| `right()` | `onRight` (Base controller raises it at the right edge) | `comp.onRight` |
| `pause()` | `onPause` / `onDestroy` / `comp.stop` | `comp.stop` / `comp.pause` |

Card modules are limited to `Card` (poster + title), `Callback` (events) and `Release` (removes the
template's `{release_year}` line) — no TMDB badges, Lampa favourites/watched marks or Lampa's own
long-press menu. The mask is set on each element (`params.module`) BEFORE the framework instantiates
the card. Stand (2026-10-07): home 33 tiles + 28 health dots, channel/favorites/history/search/empty
screens, D-pad + edge menu, long-press menu, Enter → play, related + pagination, Back focus restore,
hover clips; no deprecation warnings. Harnesses: `test/tv-screen-check.page.js`, `tv-keys-probe.page.js`,
`tv-preview-check.page.js`.

**Progressive global search.** The all-sources fan-out shows page 1 after `FIRST_SCREEN_MS` (1.8 s) or
once every source answered, then appends each later source (ranked within its batch, deduped by
title+duration against the screen) through the adapter's `append` → Maker's `loaded` / `pushLoaded`
queue. An empty first window keeps waiting instead of flashing «nothing found». Stand: first cards
2.0 s vs 3.0–3.7 s before (on the owner's TV slow channels cap at 7 s). `test/tv-search-timing.page.js`.

**Lampa 1.13.3 (official APK).** Tested on a separate AVD (`cherry113`): home, grids, HLS in the inner
player (pornhub), MP4 in an external player (Just Player); the APK keeps `voiceStart` /
`window.voiceResult` / `openPlayer`. The stand's 1.12.5 is an unofficial build (signing cert
`ba7b86…`, WebView debugging on); every official release is signed `8adaaa…` and has WebView debugging
off — so the main stand stays on its build for CDP harnesses.

## Component Lifecycle

> **Since v0.13.27 this section describes the LEGACY path.** Both screens are built by
> `_cherryScreen(object, hooks)` → `Lampa.Maker.make('Category')` (see *Screens on Lampa.Maker*);
> `InteractionCategory` is used only when Maker is absent. The hook tables below keep the legacy
> names (`create` / `nextPageReuest` / `cardRender`) — the mapping to Maker is in the table above.

Both components were **`Lampa.InteractionCategory` subclasses** (2026-06-04 → v0.13.26), not hand-rolled controllers:

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

**Poster must LOAD, not just be present (v0.13.11).** The visible card image is `v.img = v.thumb`,
so a `thumb` URL that is present but fails to render as `<img>` yields a *blank* card. Coverage
audits that only check "thumb string is non-empty" report 100% while the user sees ~30% blanks in
«Все видео» (the aggregate of the worst channels). Three parsers emitted non-rendering posters and
are now fixed — verified by loading each thumb as a real `Image()` on the Google-TV emulator
(`test/tv-thumb-load-all.mjs`, all modes → 100%):
- **xvideos / xnxx** — the listing `<img data-src>` can carry the unsubstituted hover-frame template
  `…/xv_THUMBNUM_t.jpg` (`xn_THUMBNUM_t.jpg`); the site's JS swaps `THUMBNUM`→frame index at runtime.
  As a static poster it 404s, so both `_parseCards` now pin frame 1 (`THUMBNUM`→`1`).
- **pornhub** — the webmasters API returns the same frame under two signings: `hash&validto`
  (host `pix-cdn77`, IP-bound to our fetch host → 404 in the device `<img>`) and `hdnea` (Akamai
  time-token, host `pix-fl` → renders from any IP). `_mapVideo` previously picked `v.thumbs[last]`
  (always the `hash&validto` kind → ~40% blank); it now prefers the first `hdnea`-signed candidate
  across `thumb`/`default_thumb`/`thumbs[]` (verified 30/30 load).

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
| `create()` `plugin.js:976` | Builds `results` in order: `[Поиск ⌕]` + `[Случайные ♥]` + `[Синхронизация ⟲]` (action tiles) + one tile per registered source + `[РП ▶]` **LAST** (watch-history resume tile, shown only when `Hist.all()` is non-empty); `build(...)`; `render().addClass('cherry-cat cherry-home')` + `cols--8` |
| `cardRender(object, element, card)` `plugin.js:1007` | `card.onEnter` routes by `element._kind`: `search` (→ `Lampa.Input.edit` → all_sources grid), `favorites` (→ favorites grid, tile labeled «Случайные»), `sync`, `continue` (→ is_history grid, tile labeled «РП»), `source` (→ single-source browse grid). Paints a `.cherry-tile` coloured initial into `.card__view` (`_tileColor(seed)` stable per-source hue; action tiles get the brand tint) |

---

## UI / Presentation

After the InteractionCategory migration the plugin renders Lampa's **stock `.card`**,
restyled by a small scoped CSS layer (`addStyles()`, `plugin.js:1071`, ~30 lines). All
custom card/grid/spinner CSS and templates were deleted (see Module Structure note).

| Surface | Mechanism |
|---|---|
| **Grid cards** | `.cherry-cat` scope: 16:9 landscape via `.card__view{padding-bottom:56.25%}`, image `object-fit:cover`; grid `cols--5` (5 per row) |
| **Home picker** | `.cherry-home` square tiles (`.card__view{padding-bottom:100%}`), grid `cols--8`; `.cherry-tile` paints a coloured first-letter initial (no thumbnails). **Health dot (v0.13.14):** each source tile carries `.cherry-dot` top-right — green = browse p1 returned cards, gray = down/empty/timeout, hollow ring = not probed yet. Status cached 6 h in `cherry_src_health`; stale entries are re-probed in the background after the picker renders, 4 at a time, 8 s cap each (`CherryMain._healthRefresh`) |
| **Home content** | A source picker: action tiles `[Поиск ⌕]` + `[Случайные ♥]` + `[Синхронизация ⟲]` (brand pink `--action`) + one tile per source (stable per-source hue from `_tileColor`) + `[РП ▶]` last (watch history, only when history exists). Tile labels: `cherry_favorites`='Случайные', `cherry_continue`='РП'. |
| **Focus** | Single native Lampa frame + a subtle `transform:scale(1.04)` on `.card.focus .card__view` (no custom ring — a custom ring stacked on the native frame = double frame) |
| **Card title** | 2-line white clamp (`-webkit-line-clamp:2`, `color:#fff`), `.card__title` font `.9em` |
| **Source-origin badge** | `.cherry-src-badge` (z-index 2, above any preview) appended in `cardRender` on all_sources search AND favorites grids — those mix sources, so each card is tagged with its origin name |
| **Header filter button** | `addFilterButton()` (`plugin.js:1168`) injects a persistent `.cherry-filter-btn` into the Lampa header next to search; visible only while a `cherry_grid` activity is on top; opens the same Поиск → Сортировка → Категории menu as the right edge |
| **Preview clip** | `cardRender.onFocus` injects a muted/looping `<video.cherry-card__preview>` into the focused card when `element.preview` exists and `cherry_preview_enabled` is on — **Android included since v0.13.14** (the TV WebView autoplays muted video without a gesture; stand-verified `playing` + advancing `currentTime`). A 600 ms dwell timer keeps D-pad scrolling free of loads; on Android, force-proxy hosts get the clip via the proxy (same egress rule as the stream). Stopped on blur/stop/pause |

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

> **Voice input (`_voiceQuery`, v0.13.5):** on the LAMPA Android TV app, recognition is
> NATIVE — `Lampa.Android.voiceStart()` (remote mic) and the app returns the text via the
> global `window.voiceResult(text)` hook (the same one Lampa's own search keyboard uses).
> The WebView's Web Speech API exposes the `SpeechRecognition` constructor but has **no mic
> pipeline** (`navigator.mediaDevices` absent) so it silently fails on TV — it's used only as
> a desktop-browser fallback (gated on `getUserMedia`). The «🎤 Голосом» picker item shows
> when `_voiceAvailable()` (native OR a real-mic browser), not on the bare constructor.

**all_sources mechanics** (`_gridLoad`): runs `src.search(_q, page)` over every adapter in
parallel (`Promise.all`, per-source failures swallowed), then filters + ranks + dedups.

> **Voice / per-channel search (v0.13.26)** — a voice query on a RU TV is always Cyrillic and often
> inflected («блондинки», «азиатку», «большими сиськами»). Two gaps made it fail: per-channel search
> sent the raw query (eporner/youjizz/porntrex/familyporn/porndig/analdin/xozilla/perfektdamen → 0
> cards), and `_translateQuery` only knew exact dictionary keys. Now: per-channel search uses the same
> RU→EN routing (`_chQ`); `_ruLookup` falls back from the exact key to the stem (`_ruStem` strips one
> case/number ending, also for two-word phrases); groups carry the Russian stem so RU titles rank;
> filler words (`_SEARCH_STOP`: в/на/с/секс/порно/with/sex…) are not AND-groups when the phrase has a
> meaningful word; ~80 everyday words added. End-to-end voice test (only the recognizer stubbed):
> `test/tv-voice-e2e.page.js` — home tile «Блондинки в машине» → 200 cards; eporner «Блондинки» → 30 (was 0).

> **RU→EN search (v0.13.10)** — the user searches mostly in Russian but ~18/24 sites have
> ENGLISH titles, so a Cyrillic query sent verbatim returned garbage there. Now:
> - `_translateQuery(q)` maps a Cyrillic query to English via `_RU_EN` (greedy phrase-first, e.g.
>   «большие сиськи»→"big tits", «мамка»→"milf"). English-title sources get the translated query;
>   Russian-title sources (`_RU_SOURCES`: tizam/lenporno/24rolika/ebun/jopaonline/pornobolt — crocotube removed in v0.13.18: its titles are English, a Cyrillic query there returned 0)
>   get the ORIGINAL — so `_q` is chosen per source.
> - `_searchGroups` is now **bilingual** (a RU word expands to `[ru, …EN]`), so the per-source
>   title-match filter + relevance ranking work for Cyrillic too (the old `isLatin` skip is gone).
> - Stand-verified: RU query top-20 relevance ~0-40% → **100%**.

For each query a per-source title-match filter runs *before* `slice(0,10)` (empty filter → falls
back to that source's top-N). Merged set is ranked by the shared **`_rankByRelevance`**, then
cross-source deduped (normalized title + bucketed duration). The page paginates: any full raw
batch (≥10) offers the next page. A guaranteed client-side sort (`client_sort` duration/title)
is available in every mode — the mitigation for sites whose server sort is a no-op.

> **Relevance ranking (v0.13.12)** — one shared scorer, `_relScore(title, groups, phrase, firstWord)`,
> used by BOTH global (all_sources) and single-channel search (`_gridLoad`: search results are
> re-ranked per page BEFORE the explicit client sort, since site search is often date- not
> relevance-sorted). Score = +10 per matched query group, −8 per missing group, +6 for the exact
> multi-word phrase, +3 when the title leads with the query, minus a mild length penalty
> (anti keyword-stuffing). Short tokens (≤3 chars) match on a **word boundary** so "ass" doesn't
> hit "bass"/"class". Stand-verified (emulator): exact-phrase in top-5 jumped from 0–40% → **100%**
> for "teen anal"/"blonde massage"/"russian mature"/«большие сиськи»; strong-match top-10 0→100%.

> **Tag-search sources (v0.13.19)** — hqporner, perfektdamen, porndig, eporner, pornhub, analdin, xozilla match a query by site TAGS: their results are relevant but the title often lacks the words (stand: 0–39% title match while the query is honoured). Before, the title-based ranker sank them to the bottom of global search. Now (`_TAG_SEARCH`): those sources skip the title filter — their top-N is taken in site order and marked `_siteRelevant`; `_rankByRelevance` scores such cards as a plain full match (`groups×10`), i.e. below phrase/lead-boosted titles, level with ordinary word matches. Score ties are broken by `_srcRank` (position within the card's own source) so equal cards INTERLEAVE across sources instead of clustering by source. The flags are transient (not persisted to favorites).

> **KVS search URL (v0.13.10):** xozilla/analdin search is the `/search/{q}/` PATH — the old `?s=`
> query param was ignored (returned the homepage feed → irrelevant). Fixed → query honored.

> **Search picker (v0.13.14):** `_searchPicker` = ✎ type · 🎤 voice · **↺ recent queries** · popular
> picks. Quick-picks are **Russian** (`_POPULAR_TERMS`; every term has an `_RU_EN` entry so
> `_translateQuery` routes it to English-title sites). Recents (`_recentAdd/_recentQueries/
> _recentClear`, last 10, normalized dedupe) are deliberately discreet: shown ONLY inside Cherry's
> own picker (Cherry's `Lampa.Input` uses `nosave`, so Lampa's global search history never sees
> them), neutral storage key `cherry_rq`, no heading, one-tap «✕ Очистить недавние». Both entry
> points (home tile and in-grid «Поиск») go through `onPick`, so voice/typed/picked all land there.

> **Recent queries sync across devices (v0.13.28).** The ↺ list rides the favorites PIN bucket —
> no worker change: the worker's `mergeFavs` already merges ANY record by `id@source`, last write
> wins on `max(added, deleted)`. `cherry_rq` now holds records
> `{ id: _normText(q), source: '__rq' (_RECENT_SRC), title: q, added, deleted }`:
> - `_recentAdd` upserts with a strictly increasing stamp and calls `Sync.schedule()`;
>   `_recentClear` TOMBSTONES (`deleted = now`) instead of emptying, so the clear reaches other
>   devices; a later search of the same query revives it.
> - `Sync.run` POSTs `Fav._records().concat(_recentRecords())` and splits the answer by `source`:
>   favorites → `Fav._merge`, `__rq` → `_recentMerge`. Pull points are unchanged (startup, Cherry
>   home open, favorites open), so a query typed on the TV shows in the picker on the next open elsewhere.
> - Local store keeps the 50 newest records (tombstones included), the picker shows the 10 newest
>   active. Legacy string lists (≤ v0.13.27) migrate on read as low-priority records (`added` = 1…n).
> - Old plugins (≤ v0.13.27) would merge `__rq` records into favorites; `Fav._records()` drops
>   `source === '__rq'` and rewrites storage, so such a device heals on update.

> **Stability + correctness pass (v0.13.29).** From the 2026-10-08 audit, user surface only:
> - **Bounded requests.** `_getText(u, opts)` is the one proxy request primitive (`_proxyText`,
>   `_proxyTextAny`, `cherryPost`): `FETCH_TIMEOUT_MS` = 15 s over headers AND body, AbortController
>   when present; non-2xx rejects `Error('HTTP n')` carrying `.body`, so status-tolerant callers keep
>   the page. A timeout falls through to the existing secondary→CF failover. Native path keeps its 4 s.
> - **Page cache.** `cherryFetch` shares one request per `url|referer` for 3 min (6 pages max, failures
>   dropped). One view used to download the same page 3× (getStream → related probe → «Похожие»).
> - **Play.** `_streamWithRetry` retries `getStream` once (1.5 s) on a throw OR an empty stream;
>   `_playGen` lets only the latest `playVideo` open the player (double Enter = one player, right card).
> - **Fav.toggle** stamps never go backwards (`max(now, other stamp + 1)`), so a record written by a
>   clock-ahead device stays removable/re-addable.
> - **Titles repaired on read** in `Fav.all()` / `Hist.all()` via `_cleanTitle` (entities, the «&#'s»
>   leftover, Latin-1 and now CJK mojibake — `_fixMojibake` lead range U+00C2…U+00F4); storage is not
>   rewritten (no LWW race).
> - **xvideos/xnxx «Похожие» ids** carry the feed prefix (`'xv'` / `'xnxx-'` + eid) — a bare eid gave
>   the same video two ids (Fav/Hist/progress/dedup).
> - **Client sort** (`_applyClientSort`) now applies to favorites, history and «Похожие».
> - **spankbang `disabled: true`** — Cloudflare challenge on every proxy tier; saved cards still resolve.
> Verified on the stand: `test/tv-v0129-check.page.js` (titles, related ids, cache, double Enter),
> `tv-verify-play` on 10 channels, `tv-full-audit` on all channels; unit `cherry-stability-0.13.29.test.mjs`.

> **Error vs empty, favorites availability, «Все видео» = latest (v0.13.30).**
> - **`_netFails`** counts page requests that failed (`_countFail` on `cherryFetch` / `_fetchAny` /
>   `cherryPost`; a 404/410 is an answer, not a failure). `_gridLoad` wraps `resolve` for every network
>   mode: an EMPTY result while ≥ `_failNeed` requests failed → `reject` → «Не удалось загрузить» +
>   Lampa's «Обновить». `_failNeed` = 1 for one channel, = number of channels for the all-channels
>   fan-out (one dead site must not hide a real «ничего не найдено»). Adapters stay as they are.
> - **`Avail`** (`cherry_avail`, device-local, favorites only): `{ 'id@source': { f, t } }`; a failed
>   play/check `f++`, a success `f = 0`; «Недоступно» at `f ≥ 2`; a miss while `_netFails` moved is not
>   counted. The favorites grid draws the badge and runs a background check 3 s after opening (2 at a
>   time, ≤ 20 due cards: ok → after 3 days, failed → after 10 min), stopped by the screen's pause.
> - **«Найти копию»** (`_findCopy`) = all-channels search on ≤ 8 cleaned title words — in the long-press
>   menu of every favorite (first when dead) and in the «Видео недоступно» dialog a failed favorite
>   play now shows (Найти копию / Убрать из избранного / Закрыть).
> - **«Все видео»** browses each channel with `_latestSort(src)`: the sort labelled «Свежее», else '' (the
>   site default listing, already latest on porntrex / xnxx / lenporno / jopaonline / ebun).
> Verified on the stand: `tv-v0130-check.page.js` via `tv-ui-run` (offline → error + Обновить → cards;
> empty search; badge; background check; menu; find copy; dialog), `tv-latest-feed.page.js`; unit
> `cherry-favavail-0.13.30.test.mjs`. `tv-ui-run` now exposes the same `window.__C` as `tv-page-run`.

> **pornhub playback (v0.13.31).** The CDN flipped again: scheme A (`validfrom/ipa` on ev-h) plays,
> scheme B (`h/e`) plays on hv-h for some videos and 410s for others, and ev-h serves B's playlists but
> **470 for every segment** — the v0.13.25 hard-coded hv-h→ev-h swap broke every B page, and a
> playlist-only probe could not see it. `getStream` now (1) proves the edge with a real chain —
> master → media playlist → first segment via `_probeOk` (2-byte Range) — on the page's own edge, then
> the other; (2) re-renders the page (uncached, `_cherryFetchNow`) when neither delivers; (3) keeps the
> whole chain on ONE route: VPS first, the CF worker when the VPS gets a bot page (~1.5 KB stub, VPS IP
> flagged after heavy use). Budget ≤ 3 renders via VPS + ≤ 4 via CF. `_apiFetch` retries bypass the
> page cache too. Harnesses: `tv-ph-renders`, `tv-ph-sign-route`, `tv-ph-page-health`.

> **Search quality (v0.13.32, owner: «низкое качество поиска»).** Measured with
> `tv-search-quality.page.js` (global search, top-12 cards naming every query group): «блондинка анал»
> 7→12, «азиатка массаж» 1→12, «first time dp» 4→12, «лесбиянки» 8→12, «SSIS-839» 2 of 115 → 2 of 2.
> - `_rankByRelevance`: a `_siteRelevant` card (tag-search source, title lacks the words) scores
>   `groups*10 − 5` — below every full title match, above partial ones (was level with full matches,
>   so tag hits like «slippery pleasures» filled the first screen).
> - Code / catalogue queries (`_isCodeQuery`: letters + optional `-`/space + ≥2 digits) keep only titles
>   that carry the code — no tag «relatives».
> - `toCard` runs `_cleanTitle` on every card (entities, cp1252/CJK mojibake, zero-width spaces).
> - «Похожие» page 2+ (keyword search on the channel) is ranked against the seed keywords.
> - The server bucket keeps every distinct query (tombstones are never purged) — tiny records, same
>   growth model as favorites.
> Tests: `test/cherry-favsync.test.mjs` → «Sync: recent search queries». Live check (2026-10-08):
> two sandboxed «devices» on the real worker with a throwaway PIN — add on A → visible on B, clear on
> B → empty on A, re-search on A → back on B, favorites untouched.

> **Search endpoints that silently ignored the query (v0.13.15).** Five adapters returned the
> SAME generic list for any query (found by comparing two queries — identical first card), so in
> global search they contributed 10 unfiltered fallback cards each. Fixed to the sites' REAL
> search forms (discovered from each homepage `<form>` and scored with the adapter's own parser;
> stand-verified 79–100% title match, page 2 disjoint, second query → different set):
> `3movs` `/search_videos/?q=` (+`&from_videos={p}`; `&page=`/`&p=` are ignored) · `pornone`
> `/search/?q=&page=` (the WP REST path returned 0 posts; `_fromApi` removed; page size is 11 from
> the device IP vs 35 via proxy → default `_derivePages` floor) · `ebun` `/search/{q}/{p}/` (was
> `?s=`) · `lenporno` `/search/?text=&page=` (the form is POST `text`; GET is honoured; the old
> `/search/{q}/` served the homepage) · `jopaonline` `/search/{q}/{p}/` (the DLE `?do=search` 404
> page's cards were never results; now paginates).

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
| API `&ordering=` | webmasters API order | pornhub (`mostviewed`/`rating`/`mostrecent` + composite `mostviewed:weekly`/`:monthly`). **Default sort (`sorts[0]`) = `mostviewed:weekly` («Популярное за неделю»)** so the listing refreshes weekly instead of showing the same all-time top videos. |
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

### Default (no-category) feed must paginate — per-channel (v0.13.3)

Several sites' **homepages don't paginate** (page 2 re-serves page 1). The global feed for those
is repointed at a real paginating listing so infinite scroll works EVERYWHERE (verified on stand,
`test/tv-audit3.mjs`):

- `xvideos` → `/new/{p}` (1-based). Home `/` and `/best/` don't paginate; `/new/` also carries
  `data-pvv` previews.
- `pornone` → `/newest/{p}/` (home `/page/{p}/` → 404).
- `tizam` → `/fil_my_dlya_vzroslyh/all_sex/?p={n}` (bare `/?p=` repeats the homepage rail).
- `hellporno` → `/hd/{p}/` (global `/new/{p}/` is anti-bot-locked to page 1; `/hd/` ≈ whole site).

Full per-channel coverage matrix + site limits: `tasks/coverage-audit-2026-06-17.md`.

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
   - **Infinite scroll (v0.13.4):** the site's related block is a fixed list (ignores `page`),
     so the grid CONTINUES on page 2+. **v0.13.12:** the continuation is now a **title-keyword
     search on the same source** (`relSrc.search(relKw, cp)`, `relKw = _searchKeywords(seed.title)`),
     NOT the generic newest feed — so pages 2+ stay topically similar to the seed AND paginate.
     Falls back to `src.browse('', cp)` only when the source lacks search or it returns nothing.
     Stand-verified: page-2 token-overlap with the seed 0→**75-92%** (pornhub, whose `getRelated`
     returns only 1 item, now gets 30 relevant results). Empty related → feed from page 1.
2. **«Похожие названия»** — a keyword search of the video's title words across all sources
   (`all_sources:true`), always offered. Already paginates (the all_sources fan-out).

---

### Related correctness pass (v0.13.26, stand 2026-10-07)
- **pornhub** — the 2026-10 page ships `var relatedVideosData = [[thumb,title,"m:ss",rating,url,views,clip,…]]`;
  the old parser fell to a whole-page href scan → ONE card titled «Pornhub» that opened a random video.
  `_parseRelated` reads the rows (via `_jsonArrayAt`, string-aware), keeps the JSON/HTML fallbacks, drops
  the seed and site-chrome titles, and retries on the VPS page when the native page gives < 4 cards → 20 cards.
- **lenporno** — the card window reached 800 chars BACK, so every related card showed its neighbour's
  title/poster and opened the next video. Forward window to the next card link → title/page match 100%.
- **tizam / hqporner / ebun** — `_relatedSection(parser, markerRx, endRx)` parses only the site's «Похожие»
  section (tizam `row same_video`: feed overlap 65% → 18%; hqporner «Similar HD porn»: 0 → 30; ebun
  `list_videos_related_videos`: 0 → 9). No section → `[]` → the grid's title-keyword continuation.
- Audit harness: `node test/tv-full-audit.mjs [ids]` — per channel: card title vs its own page title
  (feed/search/related), search native + Cyrillic raw + translated, related count/self/dupes/feed overlap,
  stream id. `tv-card-source.page.js` (card.source = adapter), `tv-card-align.page.js` (poster/clip ids),
  `tv-stream-owner.page.js` (stream carries the card id), `tv-stream-length.page.js` (MP4 mvhd duration = card).

### xhamster stream (v0.13.26)
The HLS master moved off `video-nss.xhcdn.com` (video7 / video-nss-a / video-b) and the host-pinned regex
returned no url on 3 of 4 pages. Order now: the page's direct H.264 MP4 map (`"mp4":{"480p":…}`, ≥360p) →
the preload master on any `*.xhcdn.com` host, preferring its `.h264.mp4.m3u8` twin (path-token hosts serve
it; `key=` hosts answer 403 → AV1 master). The masters are AV1 — black screen on TVs without AV1 decode.

### Quality the user actually gets (v0.13.26)
Lampa's `Player.play` with a quality map: the entry whose label equals `video_quality_default`
(setting, **default 1080**) wins; otherwise it keeps the url handed in (`getUrlQuality(map, false)`).
So the url playVideo hands matters whenever the map has no 1080p. v0.13.25 handed `stream.url` first —
adapters whose url was merely the FIRST file parsed played 240p/360p (youjizz, jopaonline,
perfektdamen). Rule now: **the map is the contract** — `bestQualityUrl(map) || stream.url`; an adapter
that must avoid a file drops it from the map (pornve AV1 1080p, youjizz >720p, pornhub unplayable
playlists, ebun keeps only its bare full file). Harness: `test/tv-quality-pick.page.js` (flags LOW).
perfektdamen: every get_file answers the same HLS master from a «….mp4/» URL → one master with a
`#.m3u8` fragment (never sent; makes playVideo pick the inner player and Lampa start hls.js) and
`androidProxyStream` (the CDN has no CORS → hls.js manifestLoadError). Stand: PLAYS 2/2.

### «Не то видео» — the shared fallback (v0.13.26)
`extractStreams` collected every `get_file …mp4` on a page and, as a last resort, the first `.mp4` anywhere.
On a page without a player both are the hover clips of OTHER cards (`data-preview="…/{otherId}_preview2.mp4"`).
porno666 lost its player markup in 2026-10 → it played a 30-s clip of another video. `_CLIP_URL_RX`
(preview|trailer|teaser|thumb) now excludes clips in both places; porno666 reads the same-domain
`/embed/{id}` page (full flashvars). Stand: stream file duration = card duration on every readable channel.

## Model browsing

«Модели» is a model INDEX grid (`getModels`) → a model's videos (`browseByModel`), offered on
~18 channels that expose a pornstar index. `_kvsEngine` provides both from a `cfg.modelIndex`
declaration; custom adapters (pornhub/xvideos/xnxx/eporner/spankbang/hqporner/porndig/familyporn)
implement their own.

- **KVS fallback URL needs a trailing slash** (v0.13.3): `browseByModel`'s default builds
  `modelUrl + '/{page}/'` — without the slash `/models/{slug}/{n}` 404s (this had xozilla/analdin
  returning **0** model videos). Sites with a custom `cfg.modelIndex.videosUrl` are unaffected.
- Coverage note: `getModels()[0]` is often a sparse uploader (1–2 videos), so a quick sample can
  understate a channel — a prolific model returns the full paginating list.
- **Site-limited** (documented in the coverage report): `porndig` (40/page, DLE-AJAX, no GET page),
  `familyporn` (JS-rendered model pages), `crocotube` (`listScopeRx` + no `/N/` pagination),
  `ebun` (post-migration `/models/` is country groupings, not pornstars).

Full matrix: `tasks/coverage-audit-2026-06-17.md`.

---

## Metadata

- **Title entity decoding (v0.13.13)** — `_decodeHtml` is a single-pass decoder: numeric
  (`&#233;`), hex (`&#xE9;`), and a named-entity map (`_HTML_ENTITIES`: iexcl/iquest/ndash/mdash/
  accented Latin/symbols); unknown named entities are left literal. **`stripTags` delegates to it**,
  so every parser that titles through `stripTags` decodes fully (root fix, not per-site). Fixes
  scraped titles like `&iexcl;MUY TIERNA` → `¡MUY TIERNA`, `c&uacute;` → `cú` (was showing raw
  entities and polluting «Похожие по названию» keywords). Stand-verified: xvideos entity titles 6→0.
- **Hover-preview clip coverage** is site-limited: xvideos/xnxx (`data-pvv`), pornhub
  (`data-mediabook`), and several KVS/custom adapters populate `video.preview`. Others expose **no
  per-card clip in the listing** (porntrex/lenporno/pornone load it via JS on hover; hqporner/
  eporner/pornhub-API serve none) — the poster still shows; only the on-focus clip is absent. No
  URL-guessing (the old guessed `/preview.mp4` is gone).
- **spankbang is Cloudflare-gated:** its listing now returns a managed "Just a moment…" JS
  challenge on every egress IP (Val.town / CF / VPS / device) — plain HTTP proxies can't pass it.
  Needs a headless-browser solver (FlareSolverr); until deployed, spankbang browse is dark.
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
| Primary | `PROXY_URL` | `cherry-proxy.aawersom.workers.dev` (CF Worker; residential SOCKS5 pool dead since 2026-09) | default + favorites/recents sync bucket (`/favs`). pornhub moved to the VPS in v0.13.25 |
| Secondary | `PROXY_URL_2` | `185-36-141-21.sslip.io` (self-hosted **VPS**, stable IP; rewrites m3u8 with referer) | CF-ASN-blocked + KVS IP-bound sites + **pornhub page + phncdn HLS** (v0.13.25) |
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

> **Note:** pornone is NOT on the residential/worker path. The plugin's `buildProxyUrl`
> routes `pornone.com` + `*.pornone.com` to the **VPS** (see Secondary proxy below), and
> pornone is confirmed WORKING. Any leftover `pornone` entry in the worker's `index.js`
> residential set is legacy/unused (pornone never reaches the worker).

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
- **Quality (per-channel, not blanket):**
  - **xvideos / xnxx** prefer **HLS** everywhere (adaptive 1080p/4K ladder); their progressive
    `setVideoUrlHigh` MP4 caps at ~720p → looked low-quality on a 4K TV. MP4 High/Low stay in the
    quality map as a manual fallback. (Google TV / ExoPlayer plays the HLS master inline.)
  - **youjizz** prefers MP4 (its HLS triggers the Android player-chooser) **and caps the Android
    default at ≤720p** — its cdne-mobile CDN paces each progressive MP4 to ~1.5× its bitrate, so
    1080p (~3.6 Mbps) starts/buffers slowly; 720p (~1.35 Mbps) is smooth.
  - General: protocol-relative `//` URLs are normalized to `https:` (else Android shows the chooser).

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
| `stripTags(str)` | Strips HTML tags, then full entity decode via `_decodeHtml` (v0.13.13) |
| `bestQualityUrl(quality)` | Selects highest numeric label key from quality map |
| `_attr(html, rx, group?)` | Extracts regex group from HTML string |
| `_decodeHtml(str)` | Single-pass decoder: numeric, hex and named entities (`_HTML_ENTITIES`) |
| `_splitCards(html, splitRx)` | Splits HTML into per-card chunks |
| `_kvsPickBest(urls)` | Ranks KVS MP4 URLs by resolution label embedded in filename |

---

## Source Adapters — Full List (24 active, 1 disabled)

| # | id | name | host | Proxy tier | Stream method | Status |
|---|---|---|---|---|---|---|
| 1 | `pornhub` | Pornhub | pornhub.com | **VPS** (page + `*.phncdn.com`, one egress IP, v0.13.25); webmasters API native↔proxy | HLS only; page re-rendered until the playable `ev-h`/`validfrom` scheme, Referer on segments | ✅ Working |
| 2 | `xvideos` | Xvideos | xvideos.com | CF datacenter | HLS from CDN | ✅ Working |
| 3 | `xnxx` | Xnxx | xnxx.com | VPS | HLS-first (adaptive 1080p+); MP4 fallback in quality map | ✅ Working |
| 4 | `eporner` | Eporner | eporner.com | VPS (video pages) + Android force-proxy | JSON API browse (`_fixMojibake` for double-UTF-8 titles, v0.13.27); video page via VPS | ✅ Plays (stand `tv-verify-play`, v0.13.25) |
| 4b | `xhamster` | xHamster | ru.xhamster.com | VPS (page force-proxied on Android: native fetch trips on HTTP 103; CF got 503) | JSON `window.initials` → videoThumbProps (title RU-localised, thumb webp, h264 hover clip); stream = preloaded HLS master (`<link rel=preload>`, token not IP-bound) → inner player on Android; related = xplayerPluginSettings.relatedVideos; pornstars JSON | ✅ Added 2026-09-04 (v0.13.21) |
| 5 | `spankbang` | Spankbang | ru.spankbang.com | **Val.town** (+ Android force-proxy) | listing + signed-token mp4 (`sb-cd.com`) | ⛔ Dark since 2026-09: Cloudflare challenge on every egress incl. Val.town; needs FlareSolverr (owner's decision). Tile stays with a gray health dot |
| 6 | `hqporner` | HQPorner | hqporner.com | VPS (page + bigcdn) + Android force-proxy | page via VPS; embed `mydaddy.cc` + CDN `*.bigcdn.cc` both VPS (IP-bound token). | ✅ Plays (stand `tv-verify-play`, v0.13.25) |
| 7 | `youjizz` | YouJizz | youjizz.com | VPS (+ `*.youjizz.com` CDN) | Direct MP4 (Android: protocol-relative normalized → no chooser) | ✅ Working |
| 8 | `pornone` | PornOne | pornone.com | VPS | KVS IP-bound tokens — page + CDN both via VPS IP for token affinity | ✅ Working |
| 9 | `porntrex` | Porntrex | porntrex.com | VPS (+ `*.cdntrex.com`) | KVS IP-bound tokens — page + CDN both via VPS IP | ✅ Working |
| 10 | `xozilla` | Xozilla | xozilla.com | CF datacenter | KVS `_kvsEngine` | ✅ Working |
| 11 | `3movs` | 3Movs | 3movs.com | CF datacenter | KVS signed-token | ✅ Working (token may expire) |
| 12 | `analdin` | Analdin | analdin.com | CF datacenter | KVS `_kvsEngine` | ✅ Working |
| 13 | `pornve` | PornVe | pornve.com | CF datacenter | `videoUrl:` JS var | ✅ Working (token may expire) |
| 14 | `familyporn` | FamilyPorn | familyporn.tv | CF datacenter | KVS CDN | ✅ Working (token may expire) |
| 15 | `porndig` | Porndig | porndig.com | CF datacenter | Custom VHS player (videos.porndig.com); `"srcSet"` JSON extraction with `\/`-unescape; skips preview entries | ✅ Working |
| 16 | `tizam` | Tizam | tv4.tizam.org | VPS | Direct MP4 | ✅ Working |
| 17 | `perfektdamen` | PerfektDamen | perfektdamen.co | VPS | every get_file answers one HLS master → `#.m3u8` fragment + `androidProxyStream` (v0.13.26) | ✅ Working |
| 18 | `hellporno` | HellPorno | hellporno.com | CF datacenter | KVS `_kvsEngine` | ✅ Working |
| 19 | `pornobolt` | Pornobolt | sex.pornobolt.in | — | — | ⛔ Hidden 2026-10-07 (v0.13.26): origin times out from every egress, no mirror among 20 domains; `disabled: true` keeps favorites/history resolvable |
| 20 | `crocotube` | CrocoTube | crocotube.com | CF datacenter | KVS alphaxcdn.com CDN | ✅ Working |
| 21 | `huyamba` | Huyamba | huyamba.tv | native (opens from the device) | KVS `_kvsEngine` — flashvars 480/720/1080 (`_kvsFlashvarsQuality`), token not IP-bound | ✅ Moved to huyamba.tv 2026-10-07 (v0.13.26; play.huyamba.mobi → 404). `_huyUrl` + engine `pageUrl` keep old favorites playable |
| 21b | `ebalovo` | Ebalovo | www.ebalovo.porn (301 → current mirror, wec.epalovo.com today; cards normalised back to the brand domain) | CF; on Android page **and stream** via the proxy (`_ANDROID_FORCE_PROXY` + adapter `androidProxyStream`) | KVS-like cards via `_kvsParseCards` (duration from `data-eb`), path sorts (/xxx-top/, /porno-online/, / = newest; in categories `-rating` suffix), search /search/{q}/{p}/, models /female-models/; stream flashvars 480/720 (`_kvsFlashvarsQuality`) — token not IP-bound but **UA-bound** (desktop UA only; mobile mirror tokens 404) | ✅ Added 2026-09-04 (v0.13.22) |
| 21c | `porno666` | Porno666 | porno666.link (mirrors wwwp.porno666.news / x.porno666.fo normalised to the brand host) | CF; on Android page + get_file force-proxied (`porno666.link`) | `_kvsEngine`, path-root feed sorts + `catSortQuery` (?sort_by= inside categories), 42 RU categories, search /search/{q}/{p}/, models /models/; flashvars 360/480/720/1080 labelled by *_text; get_file token IP-bound + CDN 403s foreign Referer (ebun's farm) | ✅ Added 2026-09-04 (v0.13.23) |
| 21d | `lenkino` | Lenkino | www.lenkino.adult (301 → mirror wes.lenkino.adult; cards normalised to the brand domain) | CF; on Android page force-proxied + stream via `androidProxyStream` (UA-bound tokens, mobile mirror mob.lenkino.love mints dead tokens, foreign Referer → decoy ad clip) | `_kvsParseCards` cfg (`/{id}` links, itm-dur), feeds / and /top-porno (page/{p}), 42 RU categories /{slug}, search /search/{q}/page/{p}, pornstars /pornstars → /pornstar/{slug}; flashvars 480/720 | ✅ Added 2026-09-04 (v0.13.23) |
| 21e | `pornobriz` | Pornobriz | pornobriz.com (mobile UAs → m.pornobriz.cloud, same markup) | CF; Android: page raw, stream via `androidProxyStream` (no token binding, but the WebView media stack rejects the CDN's direct response — «Format error» — while the proxied file plays) | own engine: `/top/`,`/new/`,`/best/` + page{p}/, 70 RU categories /{slug}/page{p}/, search /search/{q}/ (single page), models /stars/page{p}/ → /models/{slug}/; `<source size=1080|720|480|240>` (a listed quality may be missing on the CDN → player falls back); hover mp4 in data-preview | ✅ Added 2026-09-04 (v0.13.23) |
| 22 | `ebun` | Ebun | www1.ebun.tv (cards x.ebun.top, embed 666-emded.com) | CF (listing) + **VPS for 666-emded.com** (embed + get_file co-located; force-proxied on Android) | HTML scraping → 666-emded embed flashvars; CDN rejects foreign Referer → inner player needed the proxy route (v0.13.20) | ✅ Working |
| 23 | `lenporno` | LenPorno | www.lenporno.net | CF datacenter | Custom CDN path | ✅ Working |
| 24 | `24rolika` | 24Rolika | w2.huyalkino.com | CF datacenter | DLE + Playerjs (`new Playerjs({file:"url"})`) → videosdrop.com CDN mp4 | ⏸ `disabled: true` since 2026-09-04 — site answers 0 bytes, love.24rolika.ru has no DNS; hidden from tiles/«Все видео»/health (`_activeSources`), adapter kept for old favorites |
| 25 | `jopaonline` | JopaOnline | jopaonline.mobi | CF datacenter | DLE + JWPlayer | ✅ Working |

**Proxy tier legend:**
- **CF datacenter** — CF Worker direct fetch; consistent within a CF PoP but may vary across PoPs
- **CF SOCKS5** — CF Worker tunnels through Dutch residential proxies (45.91.209.155:11750–11756); use for domains where IP-bound tokens require consistent egress IP
- **VPS** — self-hosted VPS proxy (`185-36-141-21.sslip.io`, stable IP); use when CF ASN is blocked or when KVS/bigcdn IP-bound tokens need one consistent egress IP (replaced Deno Deploy 2026-06-06)
- **VPS paired** — page fetch AND CDN fetch both via the VPS to share the same exit IP (critical for IP-bound CDN tokens)
- **Val.town** — free Val.town HTTP val; spankbang only (its IP passes the CF bot-challenge)

**IP-bound token pairing rule (critical):**
When a CDN generates tokens bound to the requesting IP, the page that generates the token and the CDN that validates it must use the SAME proxy tier. Violating this causes 404/403 on media requests. Current pairs:
- `mydaddy.cc` + `*.bigcdn.cc` → both VPS
- `www.pornhub.com` + `*.phncdn.com` → both CF SOCKS5 (browser) / both device-IP raw (Android, the working path)
- `pornone.com` + `*.pornone.com`, `porntrex.com` + `*.cdntrex.com`, `youjizz.com` + `*.youjizz.com` → both **VPS**
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
| `xnxx` | ~30 | **Via VPS proxy** (`PROXY_URL_2`); browse URL fixed to `/?k=new&p=N`. **HLS-first** everywhere (adaptive 1080p/4K); MP4 High/Low kept as manual fallback. |
| `eporner` | ~30 | **Via VPS proxy** for video pages (`www.eporner.com` in `PROXY_URL_2_HOSTS`; also `_ANDROID_FORCE_PROXY` — device IP gets a block page); JSON search/browse API direct (CORS-open). URL: `/video-{id}/{slug}/`. getStream hash/xhr chain needs RE. |
| `spankbang` | ~30 | **Via Val.town** (`PROXY_URL_VT`, `ru.spankbang.com`) — VPS/CF datacenter IPs get CF "Just a moment" 403; Val.town's IP passes it. Also in `_ANDROID_FORCE_PROXY`. Listing + signed-token mp4 stream (`sb-cd.com`) both work. |
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
| `huyamba` | 20 | KVS get_file. Disabled 2026-06-03 (`fuq.huyamba.mobi` 404); **revived 2026-09-04** on `play.huyamba.mobi` via `_kvsEngine` (`?from=` paging — `page=` is ignored; `?by=` sorts; 33 RU categories; `data-preview` webm hover clip; `durationRx`/`viewsRx` parser hooks). |

### Browse works, video broken (CDN architecture limitation)

| id | cards | root cause |
|---|---|---|
| `hqporner` | 50 | **CDN routing bug** (not permanently broken — see Iteration 2): `s24.bigcdn.cc` not in `PROXY_URL_2_HOSTS` list, routes to CF Worker → 404. Fix: add `/\.bigcdn\.cc$/` regex. |
| `pornone` | 49 | **IP-locked CDN tokens** — resolved: `pornone.com` + `*.pornone.com` CDN both route through the **VPS** (one stable egress IP → token affinity holds). |

### Previously unfixable — now repaired

SpankBang sits behind a Cloudflare bot-challenge that **every datacenter IP** (CF worker, VPS)
fails ("Just a moment" 403) — including the device's home IP on Android. Resolved 2026-06-08 by
routing spankbang through a free **Val.town** HTTP val (`PROXY_URL_VT`), whose egress IP passes
the challenge (as Deno Deploy's used to). Listing + the signed-token mp4 stream (`sb-cd.com`)
both work. Val.town carries only the light listing (free tier, huge headroom).

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

### Favorites grid — built once (v0.13.24)

`_gridLoad` (is_favorites) pulls the sync bucket on open (≤2.5 s) and renders **once** from the merged
`Fav.all()` (guard `_favDone`). `Sync.run()` only merges records — the former `_refreshGrid()` →
`comp.create()` repaint was removed: with pull-on-open it fired on every favorites open and rebuilt an
already-built grid (duplicate card set, orphaned empty-state box, D-pad focus lost). Stand-verified with
the real bucket (79 records): first card focused, arrows move focus, warm and cold opens.

### Pornhub playback chain — one IP, playable scheme, Referer on segments (v0.13.25)

Since 2026-09 the webmasters flashvars carry **HLS only** (no mp4), so every pornhub play goes through the
inner player + hls.js. Three facts, all stand/curl-verified 2026-09-05:

1. **Two signing schemes, random per page render (~2/3 vs 1/3):** A) `ev-h.phncdn.com` +
   `validfrom/validto/ipa=1/hash` — plays; B) `hv-h.phncdn.com` + `h=/e=` — the edge answers 410 for the
   playlist and, after an ev-h host swap, 404/470 for every segment from every egress we have (CF, VPS,
   Val.town, direct). `getStream` re-renders the page (≤7 fetches) until scheme A is present
   (`_isPlayableHls`), falls back to the last page only if none was.
2. **Segments are IP-bound (ipa=1) and hotlink-checked:** they load only from the IP that fetched the page
   AND with `Referer: https://www.pornhub.com/`. The CF worker's egress varies between requests → 470;
   the dead residential pool used to give one exit, now the **VPS** is that one IP: `www.pornhub.com` /
   `rt.pornhub.com` (page) + `*.phncdn.com` (playlists/segments) are routed to `PROXY_URL_2`. The Deno
   proxy propagates `referer` into every rewritten playlist URL and rewrites with `https://` (patched +
   deployed 2026-09-05, see DEPLOY.md).
3. The webmasters API stays on the device IP (its thumb URLs are IP-bound); `_apiFetch` alternates
   native ↔ proxy only when the native answer is empty.

Stand: real `playVideo` → hls.js `FRAG_LOADED`/`BUFFER_APPENDED`, `currentTime` 3.7 s within 14 s.

### Pornhub API route alternation (v0.13.24)

`_apiFetch(url, tries, viaProxy)` alternates the device's native fetch and the proxy between attempts
(`viaProxy` flips) instead of re-asking the same route 4×: the webmasters API answers some IPs with a
200 HTML page or an empty list natively while the CF worker / VPS return the JSON. Browser: no-op.

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
| `spankbang` | Behind CF bot-challenge — routed via Val.town (passes it) | listing via Val.town (light); video = signed-token mp4 on `sb-cd.com` fetched directly |
| `hqporner` | bigcdn stream via VPS (unmetered) — but video-page player markup was redesigned | cards work (force-proxy); getStream embed extraction needs RE for the new markup |
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
