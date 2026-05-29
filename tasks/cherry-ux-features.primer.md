# Repo Scout Primer — cherry-ux-features
**Date:** 2026-05-29

## Plugin structure

Single-file IIFE in `plugin.js` (~3700 lines). No build step. Everything
is ES5 (`var`/`function`, no arrow functions, no template literals).
`plugin-release/plugin.js` must be synced (copy) after every phase commit.

Guard at line 3: `if (window.plugin_cherry_ready) return;` — prevents
double-registration when the plugin is loaded twice.

## Key baseline line numbers (verified by read)

| Symbol | Line |
|--------|------|
| `_isAndroid()` | 54 |
| `_blobUrls = []` module var | 122 |
| `playVideo(video, source)` | 293 |
| `Lampa.Player.play(...)` call inside playVideo | 318 |
| CherryGrid constructor `function CherryGrid(object)` | 347 |
| Closure vars `currentPage, totalPages, loading, destroyed` | 354 |
| `this.create = function ()` | 361 |
| Branch tree `is_favorites / all_sources / loadPage` | 387–400 |
| `this.stop = function ()` | 420 |
| `this.destroy = function ()` | 422 |
| `loadPage(page)` | 433 |
| `var promise = object.query ? ...` | 443 |
| `renderCards(items, container)` | 550 |
| `card.on('hover:focus', ...)` | 580 |
| CherryMain constructor | 643 |
| CherryMain has NO long-press context menu — no settings toggle exists yet | — |
| `addTemplates()` | 777 |
| `cherry_grid` template | 808–823 |
| `cherry_card` template | 825–837 |
| `addStyles()` / `var rules = [` | 846 |
| Last CSS rule in `rules` array (`.cherry-card__views`) | 1137–1141 |
| `];` closing rules array | 1142 |
| `addLang()` / `Lampa.Lang.add({` | 1153–1166 |
| `cherry_similar` (last i18n key) | 1165 |
| `startPlugin()` | 1172 |
| `Lampa.Listener.follow('player', ...)` — single occurrence | 1209 |

## Template conventions

- `Lampa.Template.add(name, htmlString)` — registered once globally.
- `Lampa.Template.get(name, data)` returns jQuery object with `{var}` interpolated.
- `#{langKey}` — i18n placeholder, resolved at render time.
- Template HTML is built as a `[...].join('')` string array.
- `.selector` class on an element makes it a Lampa focusable target. Lampa fires
  `hover:focus` / `hover:enter` / `hover:long` events on these via its own
  remote-control system.
- When a child element has `.selector`, Lampa focuses it directly on remote
  nav — parent's `hover:enter` does NOT co-fire. Verified for model badge (F2).

## CSS injection

- `addStyles()` builds `var rules = [...]` string array, joins it, injects via
  `document.createElement('style')` into `document.head`.
- Comments inside rules array: `/* ---- comment ---- */` as bare strings in the array.
- **No `gap:` property** — not supported on older LG WebOS / Tizen TV WebViews.
  Use `margin-left` on sibling elements instead.
- All values in `em` relative to base ~20px font.

## Event binding conventions

- Event listeners bound in `create()`, NEVER in `start()`.
- `start()` only calls `Lampa.Controller.add()` + `toggle()`.
- `stop()` — detaches scroll listener.
- `destroy()` — sets `destroyed = true`, removes html.
- `hover:focus`, `hover:enter`, `hover:long` — Lampa remote events on `.selector` elements.
- No `hover:blur` — unconfirmed event, treat as absent (OQ-1 resolved).

## i18n pattern

```javascript
Lampa.Lang.add({ key: { ru: '…', en: '…' } });  // in addLang()
Lampa.Lang.translate('key')                       // at usage site
```

Template: `#{key}` for inline template substitution.

## Async / destroyed guard

Every `.then()` / `.catch()` callback that touches the DOM must start with:
```javascript
if (destroyed) return;
```
`destroyed` is a closure boolean inside CherryGrid. Value-copy issue only
applies if passed as a parameter — closure read is safe.

## CherryGrid activity params used (baseline)

| param | meaning |
|-------|---------|
| `source_id` | adapter id |
| `query` | search string |
| `all_sources` | search all adapters in parallel |
| `is_favorites` | show favorites |
| `title` | screen title |
| `page` | initial page |

New params added by this feature set:
`model_url`, `model_name`, `_related_items`

## Source adapters

`SOURCES[]` array, each adapter has `{id, name, host, search, browse, getStream}`.
- `sourceById(id)` — lookup helper.
- Optional new methods: `browseByModel`, `getRelated`.
- Optional new property: `cfg: { sorts, categories }`.

## Pornhub adapter

Located around line ~1360. Uses webmasters API:
- Browse: `rt.pornhub.com/webmasters/videos?page=N`
- Search: `rt.pornhub.com/webmasters/search?search=QUERY&page=N`
- getStream: fetches `video.url` (rt.pornhub.com main page) via cherryFetch,
  parses `flashvars_\d+` JSON block.

## Xvideos adapter

Located around line ~1500. Uses xvideos.com HTML scraping.

## loadPage current form (lines 443-445)

```javascript
var promise = object.query
  ? source.search(object.query, page)
  : source.browse('', page);
```

Phase 3 replaces this with 3-way branch (model_url / query / browse).
Phase 5 adds currentSort + currentCategory args.

## Lampa.Listener.follow('player', ...) — single block at line 1209

Current: only blob URL cleanup on `e.type === 'destroy'`.
Phase 4 extends this block — do NOT add a second listener.

## CherryMain — no existing settings menu

CherryMain has no long-press context menu. Phase 2 (REQ-2) must add one.
Pattern: add `hover:long` on the main title or a dedicated settings button,
show `Lampa.Select.show({...})`.

## Fav serialised fields (immutable, 7 fields)

`id, source, title, thumb, url, duration, views` — must not be extended.
`preview` and `model` are silently dropped.
