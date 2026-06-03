# Cherry UX v2 — Technical Specification

**Slug:** cherry-ux-v2
**Date:** 2026-06-03
**File:** `plugin.js` (single IIFE, ~4100 lines, no build step)
**Mode:** full

---

## 0. Pre-conditions and Invariants

All changes are confined to the UI/UX layer. The following are hard out-of-scope:

- `buildProxyUrl`, `cherryFetch`, `cherryPost`, `proxyM3u8` — proxy transport layer
- `playVideo` and any adapter's `getStream`, `browse`, `search`, `browseByModel` — stream resolution
- `Fav.toggle()` serialisation — 7-field list (`id, source, title, thumb, url, duration, views`) must not change
- `Lampa.Component.add` registrations — `cherry_main` and `cherry_grid` identifiers are stable
- IIFE guard `window.plugin_cherry_ready` — never skip

All new interactive elements must be `.selector` class so `Lampa.Controller.collectionSet(html)` auto-collects them.

After any `Lampa.Select.show()` or `Lampa.Keyboard.show()` call returns, `Lampa.Controller.toggle('cherry_grid')` (or `cherry_main`) must be called to restore D-pad routing. No exceptions.

Optional adapter capabilities (`getRelated`, `browseByModel`, `cfg.sorts`, `cfg.categories`) must be guarded with an explicit `if` check before any access.

---

## 1. UX-E — Empty Favorites Hint

### What and why

When `is_favorites` mode contains zero items, the generic text "Нет результатов" (key `cherry_no_results`) is shown. Users do not know how to add items. Replace with a context-specific hint text while keeping the ☹ icon.

### Scope

- `addLang()` — 1 new key
- `cherry_grid` template — conditional second `<div>` inside `.cherry-grid__empty`
- `CherryGrid.create()` — show the correct sub-element based on `is_favorites`

### New lang keys

| Key | ru | en |
|---|---|---|
| `cherry_fav_empty_hint` | `Удерживайте ОК на видео чтобы добавить в избранное` | `Long-press OK on a video to add it to favorites` |

### Template change

Current `.cherry-grid__empty` contents:

```html
<div class="cherry-grid__empty-icon">&#9785;</div>
<div>#{cherry_no_results}</div>
```

New contents — add a third child element, hidden by default:

```html
<div class="cherry-grid__empty-icon">&#9785;</div>
<div class="cherry-grid__empty-generic">#{cherry_no_results}</div>
<div class="cherry-grid__empty-fav-hint" style="display:none">#{cherry_fav_empty_hint}</div>
```

Both text divs share the same parent styling. No new CSS rules required — both inherit from `.cherry-grid__empty`.

### Controller change

In `CherryGrid.create()`, the block at line ~527:

```js
if (object.is_favorites) {
  var favItems = Fav.all();
  if (favItems.length) {
    renderCards(favItems, scroll.body());
  } else {
    html.find('.cherry-grid__empty').show();
  }
}
```

Change the empty-favorites branch:

```js
  } else {
    // Set child visibility BEFORE showing parent to prevent single-frame flash
    html.find('.cherry-grid__empty-generic').hide();
    html.find('.cherry-grid__empty-fav-hint').show();
    html.find('.cherry-grid__empty').show();
  }
```

### CSS change

None. Both `.cherry-grid__empty-generic` and `.cherry-grid__empty-fav-hint` inherit the parent's `color` and `font-size`. Include the hint rule unconditionally — it is required, not optional:

```css
.cherry-grid__empty-fav-hint {
  font-size: .9em;
  text-align: center;
  max-width: 24em;
  line-height: 1.5;
}
```

### Acceptance criteria

1. Navigate to Favorites with 0 items. ☹ icon is visible. "Нет результатов" is NOT shown. "Удерживайте ОК на видео чтобы добавить в избранное" IS shown.
2. Add one item to favorites, re-enter favorites. Neither hint text is visible — only the card grid is shown.
3. Navigate to a source grid with 0 results (e.g. a search returning nothing). ☹ icon + "Нет результатов" shows. The fav hint does NOT show.
4. English locale: hint reads "Long-press OK on a video to add it to favorites".

### What NOT to change

- The `cherry_no_results` key value — used by loadPage empty-result fallback and loadAllSources.
- The `.cherry-grid__empty-icon` element.
- `setLoading()` or any loading state.

---

## 2. P2 — Grouped Search Results

### What and why

`loadAllSources()` currently flattens all results from all sources and sorts them alphabetically by title. On TV with 25+ sources this produces a ~250-item undifferentiated list. Grouping by source with a 10-card cap per source improves discoverability and shows which source produced each result.

### Scope

- `loadAllSources()` function body — replace `all.sort(...)` block
- `addTemplates()` — add `cherry_group_label` template
- `addLang()` — 0 new keys (source names are already adapter `.name` strings)
- `addStyles()` — 1 new rule for `.cherry-group-label`
- `renderCards()` — NOT changed; group labels are inserted directly into `scroll.body()` before each group's cards

### Algorithm (replaces lines 656-682)

```
results: BrowseResult[] (one per SOURCES entry, same order as SOURCES)

groups = []
for each (src, result) in zip(SOURCES, results):
  items = result.items.slice(0, 10)   // cap at 10 per source
  if items.length > 0:
    groups.push({ src, items })

if groups is empty:
  show cherry-grid__empty; return

totalPages = 1; currentPage = 1

for each group in groups:
  insert cherry_group_label element with src.name into scroll.body()
  renderCards(group.items, scroll.body())

Lampa.Controller.collectionSet(html)
```

Group order follows `SOURCES` registration order (same as cherry_main tile order) — not alphabetical.

### New template

```html
<!-- cherry_group_label -->
<div class="cherry-group-label">{name}</div>
```

Template is registered in `addTemplates()`:

```js
Lampa.Template.add('cherry_group_label', '<div class="cherry-group-label">{name}</div>');
```

### CSS change

```css
.cherry-group-label {
  grid-column: 1 / -1;    /* span full grid width */
  font-size: .8em;
  text-transform: uppercase;
  letter-spacing: .1em;
  color: rgba(255,255,255,.4);
  padding: .8em 0 .3em;
  border-bottom: 1px solid rgba(255,255,255,.08);
  margin-bottom: .3em;
}
```

Note: `.cherry-cards-wrap` is a CSS grid. `grid-column: 1 / -1` makes the label span all columns regardless of viewport width.

### Implementation note

`cherry_group_label` elements are inserted directly into `scroll.body()` using `Lampa.Template.get('cherry_group_label', { name: src.name })`. They are NOT `.selector` elements — they are non-interactive dividers. Do not add `hover:enter` handlers to them.

### Acceptance criteria

1. Global search (cherry_main search bar with a query) → cards appear grouped. Each group is preceded by a source-name label. Sources with no results for the query are skipped entirely (no empty group header).
2. Max 10 cards shown per source group. If a source returned 25 results, only 10 are displayed.
3. Group order matches `SOURCES` registration order (same as cherry_main tile order), not alphabetical.
4. Within each group, card order is as returned by the adapter (relevance order, not alphabetical).
5. If all sources return 0 results, ☹ "Нет результатов" is shown.
6. Infinite scroll does not trigger after all groups are rendered (`totalPages = 1`).
7. Long-press context menu on any grouped card still works correctly.

### Implementation note: _reloadFromStart compatibility

Because `loadAllSources()` inserts `.cherry-group-label` elements alongside cards, `_reloadFromStart()` must use `.cherry-card, .cherry-group-label` as its remove selector (not just `.cherry-card`) to fully clear grouped results before reloading. See P1 sentinel section for the updated `_reloadFromStart` implementation.

### What NOT to change

- `loadPage()` single-source browse — alphabetical sort never applied there anyway.
- `renderCards()` function signature.
- The `cherry_no_results` empty-state display path.
- Any adapter search logic.

---

## 3. UX-G — "Похожие" (Related) in Long-press Context Menu

### What and why

The long-press context menu has "Похожие видео" (action `'similar'`) which does a keyword search across all sources. This is a broad fuzzy match. Some adapters implement `getRelated(video)` which returns curated related videos from the same source. UX-G exposes this as a second, distinct context menu item — only when the source supports it.

### Scope

- `renderCards()` — modify the `hover:long` handler to conditionally add a third menu item
- No template changes, no CSS changes, no new lang keys (reuses `cherry_related`)

### Key distinction

| Action string | Lang key | Mechanism |
|---|---|---|
| `'similar'` | `cherry_similar` ("Похожие видео") | Keyword-based all-sources search |
| `'related'` | `cherry_related` ("Похожее") | `src.getRelated(video)` → push `_related_items` grid |

These are distinct. Both may appear in the menu for adapters that have `getRelated`. The comment in code must document this: `// 'similar' = keyword search across all sources; 'related' = adapter.getRelated() curated list`.

### Controller change

In `renderCards()` inside the `hover:long` handler, after building the `items` array, add the `'related'` entry conditionally:

```js
card.on('hover:long', function () {
  var isFav   = Fav.has(video);
  var cardSrc = sourceById(video.source) || sourceById(object.source_id);
  var menuItems = [
    {
      title: isFav
        ? Lampa.Lang.translate('cherry_rem_fav_action')
        : Lampa.Lang.translate('cherry_add_fav_action'),
      action: 'fav'
    },
    {
      title: Lampa.Lang.translate('cherry_similar'),
      action: 'similar'
    }
  ];

  // 'related' = adapter.getRelated() — only if source supports it
  // distinct from 'similar' which is keyword search across all sources
  if (cardSrc && cardSrc.getRelated) {
    menuItems.push({
      title: Lampa.Lang.translate('cherry_related'),
      action: 'related'
    });
  }

  Lampa.Select.show({
    title: video.title,
    items: menuItems,
    onSelect: function (item) {
      if (item.action === 'fav') {
        /* ... existing fav logic unchanged ... */
        Lampa.Controller.toggle('cherry_grid');
      } else if (item.action === 'similar') {
        /* ... existing similar logic unchanged ... */
        Lampa.Controller.toggle('cherry_grid');
      } else if (item.action === 'related') {
        // No inner guard needed — outer menu-item guard (cardSrc && cardSrc.getRelated) already
        // ensures this branch is only reachable when getRelated exists.
        setLoading(true);
        cardSrc.getRelated(video).then(function (items) {
          if (destroyed) return;
          setLoading(false);
          if (!items || !items.length) {
            Lampa.Noty.show(Lampa.Lang.translate('cherry_no_results'), { style: 'info' });
            Lampa.Controller.toggle('cherry_grid');
            return;
          }
          Lampa.Activity.push({
            component:      'cherry_grid',
            title:          Lampa.Lang.translate('cherry_related'),
            source_id:      cardSrc.id,
            _related_items: items,
            page:           1
          });
        }).catch(function (err) {
          if (destroyed) return;
          setLoading(false);
          console.warn('[Cherry] getRelated error:', err);
          Lampa.Noty.show(Lampa.Lang.translate('cherry_error'), { style: 'warn' });
          Lampa.Controller.toggle('cherry_grid');
        });
      }
    },
    onback: function () { Lampa.Controller.toggle('cherry_grid'); }
  });
});
```

The `destroyed` guard in the `getRelated` callback is required — same pattern as `loadPage`.

### Acceptance criteria

1. Long-press on a Pornhub card (Pornhub adapter has `getRelated`) → menu shows 3 items: fav toggle, "Похожие видео", "Похожее".
2. Long-press on a source card whose adapter does NOT have `getRelated` → menu shows 2 items: fav toggle, "Похожие видео". "Похожее" is absent.
3. Selecting "Похожее" → loading spinner appears briefly → `cherry_grid` pushes with `_related_items` and title "Похожее".
4. If `getRelated` returns empty array → "Нет результатов" noty shown, controller returns to grid.
5. If `getRelated` rejects → "Ошибка загрузки" noty shown, controller returns to grid.
6. Navigating back from the related grid works normally via `Lampa.Activity.backward()`.
7. `'similar'` action (keyword search) is unaffected — still works as before.

### What NOT to change

- The `'similar'` action logic.
- `_pendingRelated` / `_relatedSrc` module-level state (used by REQ-4 post-playback related panel — unrelated mechanism).
- Fav toggle logic.
- Any adapter's `getRelated` implementation.

---

## 4. UX-C — Preview Toggle to Lampa.SettingsApi

### What and why

The preview toggle is currently only accessible via long-press on `.cherry-main__title`, which is non-discoverable. Adding it to the Lampa settings page (via `Lampa.SettingsApi`) makes it visible to users who look there. The long-press fallback is retained for Lampa forks without `SettingsApi`.

### Scope

- `startPlugin()` — add `Lampa.SettingsApi.addParam()` call if API exists
- `CherryMain.create()` — extend the long-press menu to include the mode toggle for UX-A (same menu, see UX-A section); preview item unchanged

No changes to storage key (`cherry_preview_enabled`), default value (`true`), or the `hover:focus` handler in `renderCards()`.

### SettingsApi registration

Called once in `startPlugin()`, after `addLang()`:

```js
var _saAdd = Lampa.SettingsApi && (Lampa.SettingsApi.addParam || Lampa.SettingsApi.add);
if (_saAdd) {
  _saAdd.call(Lampa.SettingsApi, {
    component: 'cherry',
    param: {
      name:    'cherry_preview_enabled',
      type:    'toggle',
      default: true
    },
    field: {
      name:  Lampa.Lang.translate('cherry_preview_setting'),
      description: ''
    },
    onChange: function (name, value) {
      Lampa.Storage.set('cherry_preview_enabled', value);
    }
  });
}
```

This guard handles both `addParam` (common) and `add` (some Lampa forks) without two separate `typeof` checks.

### Fallback (long-press, unchanged)

The existing `hover:long` handler on `.cherry-main__title` at line ~841 is **kept unchanged** as the fallback for Lampa forks without `SettingsApi`. Add a comment: `// SettingsApi fallback — primary toggle is in Lampa settings page if SettingsApi is available`.

### Acceptance criteria

1. In a Lampa build with `SettingsApi`: open Settings → Cherry section appears → "Предпросмотр" toggle is present → toggle it → reload page → preview state persists (reads from `Lampa.Storage.get('cherry_preview_enabled', true)`).
2. Long-press on cherry title area → settings menu still appears with preview toggle item — works identically to before.
3. Both controls operate on the same `cherry_preview_enabled` storage key — they stay in sync.
4. In a Lampa build without `SettingsApi` (or a fork where `Lampa.SettingsApi` is undefined): no JS error thrown; long-press remains the only mechanism.

### What NOT to change

- `cherry_preview_enabled` storage key name.
- Default value `true`.
- The `hover:focus` preview play logic in `renderCards()`.
- Any proxy or stream logic.

---

## 5. P0 — Three Header Buttons in cherry_grid

### What and why

The current filter bar (`.cherry-grid__filters`) shows Sort and Category buttons conditionally. There is no per-source text search accessible from within a source grid. P0 adds a Search button to the header and consolidates Sort and Category into the same header bar. The old `.cherry-grid__filter-sort` and `.cherry-grid__filter-cat` elements are replaced by new equivalents in a unified `.cherry-grid__actions` bar; `.cherry-grid__filters` is removed.

### Scope

- `cherry_grid` template — replace `.cherry-grid__filters` with `.cherry-grid__actions`
- `CherryGrid.create()` — update show/hide logic and event handlers for 3 buttons
- `addLang()` — 0 new keys (reuses `cherry_search`, `cherry_sort`, `cherry_category`)
- `addStyles()` — replace `.cherry-grid__filter-*` rules with `.cherry-grid__action-*` rules

### Template change

Remove:
```html
<div class="cherry-grid__filters" style="display:none">
  <div class="cherry-grid__filter-sort selector">#{cherry_sort}</div>
  <div class="cherry-grid__filter-cat selector">#{cherry_category}</div>
</div>
```

Replace with:
```html
<div class="cherry-grid__actions">
  <div class="cherry-grid__action-search selector" style="display:none">#{cherry_search}</div>
  <div class="cherry-grid__action-sort selector" style="display:none">#{cherry_sort}</div>
  <div class="cherry-grid__action-cat selector" style="display:none">#{cherry_category}</div>
</div>
```

All three start hidden (`style="display:none"`). JS shows them selectively.

### Visibility rules (in `CherryGrid.create()`)

| Button | Show condition |
|---|---|
| Search | NOT `object.is_favorites` AND NOT `object.all_sources` AND NOT `object._related_items` |
| Sort | `source && source.cfg && source.cfg.sorts && source.cfg.sorts.length > 0` |
| Category | `source && source.cfg && source.cfg.categories && source.cfg.categories.length > 0` |

Implementation in `create()`, replacing the existing `hasSorts`/`hasCats` block:

```js
var canSearch  = !object.is_favorites && !object.all_sources && !object._related_items;
var hasSorts   = source && source.cfg && source.cfg.sorts   && source.cfg.sorts.length;
var hasCats    = source && source.cfg && source.cfg.categories && source.cfg.categories.length;

if (canSearch)  html.find('.cherry-grid__action-search').show();
if (hasSorts)   html.find('.cherry-grid__action-sort').show();
if (hasCats)    html.find('.cherry-grid__action-cat').show();
```

### Search button handler

```js
html.find('.cherry-grid__action-search').on('hover:enter', function () {
  Lampa.Keyboard.show({
    title: Lampa.Lang.translate('cherry_search'),
    value: object.query || '',
    onenter: function (text) {
      var q = (text || '').trim();
      if (!q) {
        Lampa.Controller.toggle('cherry_grid');
        return;
      }
      Lampa.Activity.push({
        component:  'cherry_grid',
        title:      source.name + ': ' + q,
        source_id:  object.source_id,
        query:      q,
        page:       1
      });
    },
    onback: function () {
      Lampa.Controller.toggle('cherry_grid');
    }
  });
});
```

This opens a per-source search (single source, `source_id` set, no `all_sources`). This is distinct from the global search in `cherry_main` which sets `all_sources: true`.

### Sort button handler

Identical to the existing `.cherry-grid__filter-sort` handler, just targeting `.cherry-grid__action-sort`. After selection: update button text to the selected sort label, call `_reloadFromStart()`, toggle controller.

### Category button handler

Identical to existing `.cherry-grid__filter-cat` handler, targeting `.cherry-grid__action-cat`.

### CSS change

Remove all `.cherry-grid__filters`, `.cherry-grid__filter-sort`, `.cherry-grid__filter-cat` rules.

Add:

```css
.cherry-grid__actions {
  display: flex;
  gap: .6em;
  padding: .4em 0 .2em;
  flex-wrap: wrap;
}

.cherry-grid__action-search,
.cherry-grid__action-sort,
.cherry-grid__action-cat {
  background: rgba(255,255,255,.1);
  color: rgba(255,255,255,.85);
  font-size: .82em;
  padding: .25em .7em;
  border-radius: .4em;
  cursor: pointer;
  border: 1px solid transparent;
}

.cherry-grid__action-search.focus,
.cherry-grid__action-sort.focus,
.cherry-grid__action-cat.focus {
  border-color: #e75480;
}
```

### Acceptance criteria

1. Browse Pornhub (has `cfg.sorts` and `cfg.categories`) → all 3 buttons visible: "Поиск", "Сортировка", "Категория".
2. Browse a source without `cfg` (e.g. bare source with no sorts/categories) → only "Поиск" visible.
3. Open Favorites grid → no buttons visible (canSearch = false, no cfg).
4. Open "related items" grid → no buttons visible.
5. Open all-sources search results → no buttons visible.
6. Click "Поиск" → Lampa.Keyboard opens → enter query → new cherry_grid opens for the same source with that query → back navigation returns to the browse grid.
7. Click "Сортировка" → Lampa.Select opens with sort options → select one → grid reloads from page 1 with new sort → button text updates to selected sort label.
8. Click "Категория" → same behaviour as Sort for categories.
9. D-pad focus cycles through visible buttons (they are `.selector`).
10. No vestigial `.cherry-grid__filters` or `.cherry-grid__filter-sort` / `.cherry-grid__filter-cat` elements remain in DOM.

### Dead code removal

After replacing the template, remove any JS lines that reference `.cherry-grid__filters` directly — specifically `html.find('.cherry-grid__filters').show()` and `html.find('.cherry-grid__filters').hide()` calls anywhere in `CherryGrid.create()`. These become dead code once the element is removed from the template and must be deleted to keep the codebase clean.

### What NOT to change

- `currentSort` and `currentCategory` local variables.
- `_reloadFromStart()` function.
- `_findLabel()` helper.
- Sort/category selection logic — only the triggering element class changes.

---

## 6. P1 — D-pad Infinite Scroll Fix

### What and why

`scroll.body().on('scroll', ...)` fires when the DOM scroll event triggers. On TV with D-pad, Lampa.Scroll advances focus between `.selector` elements without necessarily firing a native `scroll` event until the focused element is near the viewport edge. This means page 2 may not load until the user physically scrolls past the 300px threshold, causing a navigation dead-end at the last visible card.

Fix: add an `IntersectionObserver` on a sentinel `<div>` appended after the last rendered card. When the sentinel enters the viewport, trigger `loadPage(currentPage + 1)`. Keep the existing scroll listener as a secondary trigger for pointer/mouse users. Add `maybeLoadMore()` calls in `right` and `down` D-pad handlers as a tertiary fallback.

### Sentinel element

The sentinel element is created **once** in `create()`:

```js
var sentinel = $('<div class="cherry-scroll-sentinel"></div>');
scroll.body().append(sentinel);
```

After **every** `renderCards()` call — including the inline calls inside the `is_favorites` branch and the `_related_items` branch — append the sentinel again:

```js
scroll.body().append(sentinel); // jQuery append() moves an existing node, does NOT clone it.
                                // The IntersectionObserver reference to sentinel[0] stays valid.
```

This must be done after each `renderCards(items, scroll.body())` invocation, not only on the infinite-scroll `loadPage` path.

### IntersectionObserver setup

```js
var _sentinelObserver = null;

function _setupSentinel() {
  if (!window.IntersectionObserver) return; // fallback handles this
  _sentinelObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        if (!loading && currentPage < totalPages) {
          currentPage++;
          loadPage(currentPage);
        }
      }
    });
  }, { threshold: 0.1 });
  _sentinelObserver.observe(sentinel[0]);
}
```

Call `_setupSentinel()` once in `create()`, after the sentinel is appended. Disconnect in `stop()` / `destroy()`:

```js
this.stop = function () {
  if (scroll) scroll.body().off('scroll');
  if (_sentinelObserver) { _sentinelObserver.disconnect(); _sentinelObserver = null; }
  _stopCurrentPreview();
};

this.destroy = function () {
  if (_sentinelObserver) { _sentinelObserver.disconnect(); _sentinelObserver = null; }
  _stopCurrentPreview();
  destroyed = true;
  if (html) html.remove();
};
```

### D-pad fallback (for environments without IntersectionObserver)

Add a `maybeLoadMore()` helper and call it in the `down` and `right` controller handlers:

```js
function maybeLoadMore() {
  if (!loading && currentPage < totalPages) {
    // Check if sentinel is near visible area via getBoundingClientRect
    var el = sentinel && sentinel[0];
    if (!el) return;
    var rect = el.getBoundingClientRect();
    var viewH = window.innerHeight || document.documentElement.clientHeight;
    if (rect.top < viewH + 400) {
      currentPage++;
      loadPage(currentPage);
    }
  }
}
```

In the controller registration:

```js
Lampa.Controller.add('cherry_grid', {
  // ...
  down:  function () { Lampa.Controller.move('down');  maybeLoadMore(); },
  right: function () { Lampa.Controller.move('right'); maybeLoadMore(); },
  // ...
});
```

### Existing scroll listener

Keep as-is for pointer/mouse fallback. Add a comment: `// Secondary scroll trigger — IntersectionObserver is primary for D-pad`.

### CSS change

```css
.cherry-scroll-sentinel {
  width: 100%;
  height: 1px;
  grid-column: 1 / -1;
  pointer-events: none;
}
```

The `grid-column: 1 / -1` ensures the sentinel spans the full grid width inside `.cherry-cards-wrap`.

### Double-load guard

The existing `loading` flag already prevents double-loads. No additional guard needed — `if (!loading && currentPage < totalPages)` is checked in all three trigger paths.

### Sentinel placement after _reloadFromStart

`_reloadFromStart()` must clear both cards and group labels before reloading. The sentinel is then re-appended to ensure it stays at the end:

```js
function _reloadFromStart() {
  html.find('.cherry-grid__empty').hide();
  currentPage = 1;
  totalPages  = 1;
  loading     = false;
  scroll.body().find('.cherry-card, .cherry-group-label').remove(); // remove cards AND group labels
  scroll.body().append(sentinel); // ensure sentinel stays at end after clear
  loadPage(1);
}
```

The selector `.cherry-card, .cherry-group-label` is required (not just `.cherry-card`) because grouped search results (P2) insert `.cherry-group-label` elements that must also be cleared on reload.

### Acceptance criteria

1. D-pad `down` through all 24 cards on page 1 on TV → after the last card, page 2 starts loading (loading spinner appears).
2. With mouse/pointer scroll: scrolling to within 300px of the bottom triggers page 2 load (existing behaviour preserved).
3. `IntersectionObserver` not supported (force-test by temporarily setting `window.IntersectionObserver = undefined`): D-pad `down`/`right` past the last card triggers `maybeLoadMore()` and page 2 loads.
4. No double-load: page 2 does not load twice when both scroll and sentinel fire near-simultaneously. (`loading` flag prevents it.)
5. `stop()` / `destroy()` disconnect the observer — no memory leaks.

### What NOT to change

- `loadPage()` function signature.
- `totalPages` / `loading` / `destroyed` state variables.
- The existing `scroll.body().on('scroll', ...)` listener.

---

## 7. UX-A — Home Screen Row Mode

### What and why

`CherryMain` currently renders all sources as tiles. Row mode adds a second presentation: one horizontal strip per source showing popular videos (from `src.browse('', 1)`). The mode is stored in `Lampa.Storage` and toggled from the existing long-press menu on `.cherry-main__title`.

This is the highest-complexity feature in this batch. It extends `CherryMain` with async data loading, a new layout, and a different D-pad navigation model.

### Scope

- `addLang()` — 2 new keys
- `addTemplates()` — 1 new template (`cherry_source_row`)
- `CherryMain.create()` — mode-conditional render path
- `CherryMain.start()` — no structural change; controller remains `cherry_main`
- `addStyles()` — new rules for row mode layout
- Long-press menu on `.cherry-main__title` — add "Вид" toggle item

### New lang keys

| Key | ru | en |
|---|---|---|
| `cherry_view_rows` | `Вид: Ряды` | `View: Rows` |
| `cherry_view_tiles` | `Вид: Тайлы` | `View: Tiles` |

### New template

```html
<!-- cherry_source_row -->
<div class="cherry-source-row">
  <div class="cherry-source-row__label selector">{name}</div>
  <div class="cherry-source-row__cards"></div>
  <div class="cherry-source-row__loading">#{cherry_loading}</div>
</div>
```

The `.cherry-source-row__label` is a `.selector` element. Pressing Enter on it pushes `cherry_grid` for that source (same as pressing Enter on the source tile in tile mode).

### CherryMain structural changes

Add `destroyed` flag and `mode` variable to the `CherryMain` constructor scope:

```js
function CherryMain(object) {
  var html;
  var destroyed = false;
  var mode; // 'tiles' | 'rows'
```

Update `destroy()`:
```js
this.destroy = function () { destroyed = true; if (html) html.remove(); };
```

### create() changes

After `renderSources()` / `bindSearch()` setup, determine mode and branch:

```js
this.create = function () {
  mode = Lampa.Storage.get('cherry_home_mode', 'tiles');
  html = Lampa.Template.get('cherry_main', {});

  if (mode === 'rows') {
    renderRows();
  } else {
    renderSources();
    bindSearch();
  }

  // Long-press on title: preview toggle + view mode toggle
  html.find('.cherry-main__title').on('hover:long', function () {
    var previewVal = Lampa.Storage.get('cherry_preview_enabled', true);
    var modeLabel  = mode === 'rows'
      ? Lampa.Lang.translate('cherry_view_tiles')
      : Lampa.Lang.translate('cherry_view_rows');
    Lampa.Select.show({
      title: 'Cherry',
      items: [
        {
          title:  Lampa.Lang.translate('cherry_preview_setting') + ': ' + (previewVal ? 'ON' : 'OFF'),
          action: 'preview_toggle'
        },
        {
          title:  modeLabel,
          action: 'view_toggle'
        }
      ],
      onSelect: function (item) {
        if (item.action === 'preview_toggle') {
          var val = !Lampa.Storage.get('cherry_preview_enabled', true);
          Lampa.Storage.set('cherry_preview_enabled', val);
          Lampa.Noty.show(Lampa.Lang.translate('cherry_preview_setting') + ': ' + (val ? 'ON' : 'OFF'));
        } else if (item.action === 'view_toggle') {
          var newMode = mode === 'rows' ? 'tiles' : 'rows';
          Lampa.Storage.set('cherry_home_mode', newMode);
          // Re-render: navigate back then re-push cherry_main to pick up new mode
          Lampa.Activity.backward();
          setTimeout(function () {
            Lampa.Activity.push({ component: 'cherry_main', title: 'Cherry', page: 1 });
          }, 50); // 50ms minimum to let Lampa.Activity stack settle before re-push;
                  // do not reduce below 0; may need tuning on slow Android TV
        }
        Lampa.Controller.toggle('cherry_main');
      },
      onback: function () { Lampa.Controller.toggle('cherry_main'); }
    });
  });

  return html;
};
```

Note on mode switch: `backward()` then `push()` forces a full component teardown and re-create. The 50 ms `setTimeout` is the minimum needed to let the activity stack settle. This avoids any conditional re-render logic inside `create()` and keeps the component lifecycle clean.

### renderRows() implementation

```js
function renderRows() {
  var container = html.find('.cherry-main__sources');
  // Replace tile layout with row layout
  container.addClass('cherry-main__sources--rows');

  // Favorites row is omitted in row mode — Fav grid is accessible via tile mode
  // (row mode is a browse discovery surface, not a management surface)

  SOURCES.forEach(function (src) {
    var rowEl = Lampa.Template.get('cherry_source_row', { name: src.name });

    rowEl.find('.cherry-source-row__label').on('hover:enter', function () {
      Lampa.Activity.push({
        component: 'cherry_grid',
        title:     src.name,
        source_id: src.id,
        page:      1
      });
    });

    container.append(rowEl);

    // Fetch first page of browse results
    rowEl.find('.cherry-source-row__loading').show();
    src.browse('', 1).then(function (result) {
      if (destroyed) return;
      rowEl.find('.cherry-source-row__loading').hide();
      if (!result || !result.items || !result.items.length) return;
      var cardsEl = rowEl.find('.cherry-source-row__cards');
      result.items.slice(0, 12).forEach(function (video) {
        video.source = src.id; // REQUIRED: set source before render so Fav.toggle serialises
                               // the 'source' field correctly (7-field invariant: id, source,
                               // title, thumb, url, duration, views). Without this, long-press
                               // fav from a row card will store an incomplete object.
        var card = Lampa.Template.get('cherry_card', {
          title:    video.title    || '',
          duration: video.duration ? secToTime(video.duration) : '',
          views:    formatViews(video.views)
        });
        if (video.thumb) card.find('.cherry-card__img').attr('src', video.thumb);
        card.on('hover:enter', function () {
          var srcAdapter = sourceById(video.source) || src;
          if (!srcAdapter) return;
          playVideo(video, srcAdapter);
        });
        cardsEl.append(card);
      });
      Lampa.Controller.collectionSet(html);
    }).catch(function (err) {
      if (destroyed) return;
      rowEl.find('.cherry-source-row__loading').hide();
      console.warn('[Cherry] rows browse error for ' + src.id + ':', err);
    });
  });
}
```

Cards in row mode use `hover:enter` to play (same as grid mode). Long-press and preview are NOT implemented in row mode cards (v1 scope — row mode is a discovery surface). This keeps the implementation footprint minimal.

Maximum 12 cards per row. All source rows start loading in parallel — up to 25 concurrent `browse('')` calls. The `destroyed` flag prevents stale callback writes after component teardown.

### D-pad in row mode

Row mode uses `Lampa.Controller.collectionSet(html)` over the entire `html` root — same as tile mode. Lampa's default D-pad collection navigation handles focus movement. This means:

- `.cherry-source-row__label` (selector) elements are focusable
- `.cherry-card` (selector) elements within each row are focusable
- D-pad navigates through all focusable elements in DOM order

This is a flat collection, not a nested 2D navigation. The row cards render horizontally (`overflow-x: hidden`, horizontal flex), but D-pad navigation follows DOM order rather than spatial position. This is the known v1 limitation acknowledged in the architecture brief.

`Lampa.Controller.collectionSet(html)` is called:
- Once after `renderRows()` sets up DOM structure
- Again inside each source's `browse().then()` callback as new cards are added (same pattern as `renderCards` in grid mode)

### CSS changes for row mode

```css
/* Row mode container */
.cherry-main__sources--rows {
  flex-direction: column;
  gap: 2em;
}

/* Individual source row */
.cherry-source-row {
  display: flex;
  flex-direction: column;
  gap: .6em;
}

.cherry-source-row__label {
  font-size: .85em;
  text-transform: uppercase;
  letter-spacing: .1em;
  color: rgba(255,255,255,.5);
  cursor: pointer;
  border: 1px solid transparent; /* focus-indicator base; overrides any border-bottom */
  border-radius: .3em;
  padding: .2em .4em;
  align-self: flex-start;
}

.cherry-source-row__label.focus {
  border-color: #e75480;
  color: #fff;
}

.cherry-source-row__cards {
  display: flex;
  gap: .7em;
  overflow-x: hidden;
}

/* Cards in row mode: fixed width, no grid */
.cherry-source-row__cards .cherry-card {
  width: 12em;
  flex-shrink: 0;
}

.cherry-source-row__loading {
  display: none;
  font-size: .8em;
  color: rgba(255,255,255,.4);
  padding: .4em 0;
}
```

`overflow-x: hidden` is intentional (architecture brief: avoid custom scroll containers). Cards that don't fit are clipped; user navigates to full source grid via the row label or by pressing Enter on any card.

### Search bar in row mode

`bindSearch()` is not called in row mode. The `.cherry-main__search` element remains in the template but is visually hidden in row mode via CSS, or the `renderRows()` function hides it explicitly:

```js
html.find('.cherry-main__search').hide();
html.find('.cherry-main__sources-label').hide();
```

Global search is accessible by switching back to tile mode.

### Acceptance criteria

1. Default behaviour unchanged: `Lampa.Storage.get('cherry_home_mode', 'tiles')` returns `'tiles'` → tile mode renders, all source tiles visible, search bar visible.
2. Long-press on Cherry title → menu shows "Предпросмотр: ON/OFF" and "Вид: Ряды".
3. Select "Вид: Ряды" → cherry_main re-opens → row mode renders: source name labels visible, cards loading per row.
4. After rows load: each source row shows up to 12 cards horizontally.
5. Press Enter on a row label → `cherry_grid` for that source opens.
6. Press Enter on a card in a row → video plays.
7. Long-press on Cherry title in row mode → menu shows "Вид: Тайлы" → select → tile mode restores.
8. Mode persists across navigation: close cherry_main, re-open → row mode still active.
9. `destroyed` flag prevents stale renders: navigate away during loading → no errors, no DOM writes after destroy.
10. In tile mode: long-press menu shows "Вид: Ряды" (not "Тайлы").

### What NOT to change

- `renderSources()` and `bindSearch()` functions — used unchanged in tile mode.
- `cherry_main` template HTML — only the `.cherry-main__sources` class is extended with `--rows` modifier.
- Favorites tile — shown in tile mode only (not in row mode v1).
- Any adapter's `browse` implementation.

---

## 8. Summary of All New Lang Keys

| Key | ru | en | Used by |
|---|---|---|---|
| `cherry_fav_empty_hint` | `Удерживайте ОК на видео чтобы добавить в избранное` | `Long-press OK on a video to add it to favorites` | UX-E |
| `cherry_view_rows` | `Вид: Ряды` | `View: Rows` | UX-A |
| `cherry_view_tiles` | `Вид: Тайлы` | `View: Tiles` | UX-A |

All three are added in `addLang()`. No existing keys are removed or modified.

Existing keys reused (no change):

| Key | Reused by |
|---|---|
| `cherry_related` | UX-G (menu item label) |
| `cherry_search` | P0 (search button label + keyboard title) |
| `cherry_sort` | P0 (sort button label) |
| `cherry_category` | P0 (category button label) |
| `cherry_no_results` | P2 (empty group fallback), UX-G (empty related noty) |
| `cherry_error` | UX-G (getRelated reject noty) |
| `cherry_loading` | UX-A (row loading label) |
| `cherry_preview_setting` | UX-C (SettingsApi field name, long-press menu) |

---

## 9. Summary of All New Templates

| Name | Used by | Notes |
|---|---|---|
| `cherry_group_label` | P2 | `{name}` var; non-interactive; `grid-column: 1/-1` |
| `cherry_source_row` | UX-A | `{name}` var; contains `.cherry-source-row__label.selector` |

Modified templates:

| Name | Change |
|---|---|
| `cherry_grid` | Replace `.cherry-grid__filters` block with `.cherry-grid__actions` block (3 hidden buttons) + add `.cherry-grid__empty-generic` / `.cherry-grid__empty-fav-hint` sub-elements |

---

## 10. Summary of All New/Changed CSS Rules

| Rule(s) | Feature | Type |
|---|---|---|
| `.cherry-grid__empty-fav-hint` | UX-E | New (required size hint) |
| `.cherry-group-label` | P2 | New |
| `.cherry-scroll-sentinel` | P1 | New (1px, no pointer events) |
| `.cherry-grid__actions`, `.cherry-grid__action-search/sort/cat` | P0 | New (replaces filter rules) |
| `.cherry-grid__filters`, `.cherry-grid__filter-sort/cat` | P0 | **Removed** |
| `.cherry-main__sources--rows`, `.cherry-source-row*` | UX-A | New |

---

## 11. Summary of All Controller Changes

| Component | Change | Feature |
|---|---|---|
| `cherry_grid` | `down` / `right` handlers call `maybeLoadMore()` | P1 |
| `cherry_main` | Long-press menu adds "view_toggle" item | UX-A |

No new Lampa controller names are registered. `cherry_main` and `cherry_grid` remain the only two registered controllers.

---

## 12. Dependencies Between Features

All 7 features are independent at implementation level. No feature requires another to be complete first. However the recommended implementation order from the architecture brief (ascending risk) is:

1. UX-E
2. P2
3. UX-G
4. UX-C
5. P0
6. P1
7. UX-A

The only shared modification point is the long-press menu in `CherryMain.create()`: both UX-C (preview toggle) and UX-A (view mode toggle) extend the same `Lampa.Select.show()` items array. Implement UX-C first; UX-A adds a second item to the same menu. Merge carefully to avoid duplicating the `hover:long` binding.

---

## 13. Regression Guard

After all changes, verify these unmodified paths still work:

1. Pornhub browse → card grid loads → Enter plays video → stream resolves → player opens.
2. Xvideos browse → same.
3. Any KVS source (e.g. Tizam) → same.
4. Global search from cherry_main → results appear.
5. Favorites add/remove cycle → data persists with exactly 7 fields in storage.
6. REQ-4 post-playback related panel still fires when `_pendingRelated` is populated.

None of these paths touch `buildProxyUrl`, `cherryFetch`, `proxyM3u8`, `playVideo`, or any adapter method. They are listed here as smoke-test checkpoints only.

---

## 14. Storage Keys Registry (complete post-v2)

| Key | Default | Type | Added by |
|---|---|---|---|
| `cherry_proxy_key` | `'1206'` | string | original |
| `cherry_favs` | `[]` | VideoCard[] | original |
| `cherry_preview_enabled` | `true` | boolean | original (UX-C exposes it) |
| `cherry_home_mode` | `'tiles'` | `'tiles' \| 'rows'` | UX-A |
