# Cherry UX v2 — Implementation Plan

**Slug:** cherry-ux-v2
**Date:** 2026-06-03
**Target file:** `D:\Works\Lampa\plugin.js` (single IIFE, ~4100 lines, ES5 only)
**Spec:** `tasks/cherry-ux-v2.spec.md`
**Arch brief:** `D:\tmp\cherry-ux-v2.task.arch-brief.md`

---

## Hard Constraints (apply to every phase)

- **ES5 only.** `var`, `function`, no `const`/`let`, no arrow functions `=>`, no template literals `` ` ``.
- **Lampa.Keyboard** uses lowercase callbacks: `onenter:`, `onchange:`, `onback:`
- **Lampa.Select** uses camelCase: `onBack:`, `onSelect:`
- Every `Lampa.Select.show()` or `Lampa.Keyboard.show()` call must restore D-pad in **both** `onBack` AND every `onSelect` branch via `Lampa.Controller.toggle('cherry_grid')` (or `cherry_main`).
- `destroyed` guard on all async callbacks: `if (destroyed) return;`
- No changes to `buildProxyUrl`, `cherryFetch`, `cherryPost`, `proxyM3u8`, `playVideo`, or any adapter's `browse`/`search`/`getStream`/`browseByModel`.
- `Fav` serialisation 7-field invariant (`id, source, title, thumb, url, duration, views`) must not change.
- All new interactive elements must carry class `.selector`.

---

## Deployment (all phases)

After each committed phase:
1. `cp plugin.js plugin-release/plugin.js`
2. `git add plugin.js plugin-release/plugin.js && git commit -m "feat(ux-v2): <phase description>"`
3. Push to main only after all phases are verified: `git push origin master:main`
4. CF Worker: **no deploy needed** — no worker files change in this task.

---

## Phases

---

### Phase 1 — UX-E + UX-G + UX-C

**Goal:** Three low-risk, additive-only changes: empty-favorites hint, getRelated in long-press menu, and SettingsApi preview toggle registration.

**Files changed:** `plugin.js`

**Key implementation steps:**

1. **UX-E — lang key** (`addLang()`, line ~1422).
   Add one entry to the `Lampa.Lang.add({...})` call:
   ```
   cherry_fav_empty_hint: {
     ru: 'Удерживайте ОК на видео чтобы добавить в избранное',
     en: 'Long-press OK on a video to add it to favorites'
   }
   ```

2. **UX-E — template** (`addTemplates()`, the `cherry_grid` template, line ~1032).
   Replace the current single `<div>#{cherry_no_results}</div>` child of `.cherry-grid__empty`
   with two children:
   ```
   '<div class="cherry-grid__empty-generic">#{cherry_no_results}</div>',
   '<div class="cherry-grid__empty-fav-hint" style="display:none">#{cherry_fav_empty_hint}</div>',
   ```
   The `.cherry-grid__empty-icon` div is untouched.

3. **UX-E — controller** (`CherryGrid.create()`, the `is_favorites` branch, line ~527).
   Change the empty-favorites `else` clause from `html.find('.cherry-grid__empty').show()`
   to the three-step sequence (set child visibility BEFORE showing parent):
   ```
   html.find('.cherry-grid__empty-generic').hide();
   html.find('.cherry-grid__empty-fav-hint').show();
   html.find('.cherry-grid__empty').show();
   ```

4. **UX-E — CSS** (`addStyles()`, after the existing `.cherry-grid__empty-icon` block, line ~1255).
   Add a new rule block (insert before closing `];` of the `rules` array):
   ```
   '.cherry-grid__empty-fav-hint {',
   '  font-size: .9em;',
   '  text-align: center;',
   '  max-width: 24em;',
   '  line-height: 1.5;',
   '}',
   ```

5. **UX-G — long-press menu extension** (`renderCards()`, the `hover:long` handler, line ~771).
   Before the `Lampa.Select.show({...})` call, extract `cardSrc`:
   ```
   var cardSrc = sourceById(video.source) || sourceById(object.source_id);
   ```
   Build `menuItems` as a `var` array (the two existing items: `'fav'` and `'similar'`).
   After building the array, conditionally push the `'related'` item:
   ```
   // 'similar' = keyword search across all sources; 'related' = adapter.getRelated() curated list
   if (cardSrc && cardSrc.getRelated) {
     menuItems.push({
       title: Lampa.Lang.translate('cherry_related'),
       action: 'related'
     });
   }
   ```
   Pass `menuItems` to `Lampa.Select.show({ ..., items: menuItems, ... })`.
   In the `onSelect` function, add the `'related'` branch after the existing `'similar'` branch:
   ```
   } else if (item.action === 'related') {
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
   ```
   Verify `onBack` callback remains: `onback: function () { Lampa.Controller.toggle('cherry_grid'); }` (lowercase).
   Add `Lampa.Controller.toggle('cherry_grid')` unconditionally to all three branches:
   - `'fav'` branch: add after `Lampa.Noty.show();`
   - `'similar'` branch: add after `Lampa.Activity.push();`
   - `'related'` branch (new, above): add after `Lampa.Activity.push(...)` on the success path; it is already present on the empty-result path and in the `.catch()` block above.
   Both fav AND similar branches are currently missing `Lampa.Controller.toggle`. Do not check — just add unconditionally.

6. **UX-C — SettingsApi registration** (`startPlugin()`, after `addLang()` call, line ~1460).
   Insert after `addLang();`:
   ```
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
         name:        Lampa.Lang.translate('cherry_preview_setting'),
         description: ''
       },
       onChange: function (name, value) {
         Lampa.Storage.set('cherry_preview_enabled', value);
       }
     });
   } else if (Lampa.SettingsApi) {
     console.warn('[Cherry] SettingsApi found but addParam/add method not available');
   }
   ```

7. **UX-C — long-press fallback comment** (`CherryMain.create()`, line ~840).
   Add comment above the `hover:long` binding:
   ```
   // SettingsApi fallback — primary toggle is in Lampa settings page if SettingsApi is available
   ```
   Do NOT change any logic in the long-press handler itself.

**What NOT to touch in this phase:**
- `loadPage`, `loadAllSources`, `renderSources`, `bindSearch`
- Any adapter's `getRelated` implementation
- `cherry_no_results` key value
- `cherry_similar` action and its keyword-search logic
- `_pendingRelated` / `_relatedSrc` module-level state (REQ-4 mechanism)
- The `cherry_preview_enabled` storage key name or default value

**Success criteria:**
- Navigate to Favorites with 0 items: ☹ icon shows, "Нет результатов" is hidden, hint text "Удерживайте ОК..." is visible.
- Navigate to a non-favorites source with 0 results: ☹ icon + "Нет результатов" shows; hint text does NOT show.
- Long-press on a Pornhub card: menu has 3 items — fav toggle, "Похожие видео", "Похожее".
- Long-press on a source without `getRelated` (e.g. Xvideos): menu has 2 items — fav toggle, "Похожие видео". "Похожее" absent.
- Selecting "Похожее" on a Pornhub card: spinner appears, then `cherry_grid` opens with related items.
- In Lampa with SettingsApi: Settings page shows Cherry section with "Предпросмотр" toggle.
- In Lampa without SettingsApi: no JS error thrown; long-press on title still works.
- Console: no new errors or warnings.

**Regression check:**
- Pornhub browse → card grid loads → long-press → "Похожие видео" still opens keyword search results.
- Favorites add/remove cycle: data persists with exactly 7 fields.
- Lampa.Controller D-pad returns to grid after closing long-press menu (all branches).

---

### Phase 2 — P2: Grouped Search Results

**Goal:** Replace `loadAllSources()` flat alphabetical merge with per-source grouped rendering (top 10 per source, SOURCES order).

**Files changed:** `plugin.js`

**Key implementation steps:**

1. **New template** (`addTemplates()`, after existing templates).
   Add:
   ```
   Lampa.Template.add('cherry_group_label', '<div class="cherry-group-label">{name}</div>');
   ```

2. **CSS rule** (`addStyles()`, `rules` array, before closing `];`).
   Add:
   ```
   '.cherry-group-label {',
   '  grid-column: 1 / -1;',
   '  font-size: .8em;',
   '  text-transform: uppercase;',
   '  letter-spacing: .1em;',
   '  color: rgba(255,255,255,.4);',
   '  padding: .8em 0 .3em;',
   '  border-bottom: 1px solid rgba(255,255,255,.08);',
   '  margin-bottom: .3em;',
   '}',
   ```

3. **`loadAllSources()` replacement** (`CherryGrid`, line ~635).
   Replace the block from `var all = [];` through `renderCards(all, scroll.body());`
   (the current flatten + alphabetical-sort + renderCards block) with:
   ```
   var groups = [];
   SOURCES.forEach(function (src, i) {
     var r = results[i];
     if (!r || !r.items || !r.items.length) return;
     var items = r.items.slice(0, 10);
     groups.push({ src: src, items: items });
   });

   if (!groups.length) {
     html.find('.cherry-grid__empty').show();
     return;
   }

   totalPages  = 1;
   currentPage = 1;

   groups.forEach(function (g) {
     var label = Lampa.Template.get('cherry_group_label', { name: g.src.name });
     scroll.body().append(label);
     renderCards(g.items, scroll.body());
   });
   // Phase 4 will add: scroll.body().append(sentinel); here

   Lampa.Controller.collectionSet(html);
   ```
   Cross-reference: Phase 4 step 6 appends `sentinel` once after this `groups.forEach` loop (not inside it).
   Note: `Promise.all(promises).then(function (results) {...})` — the `results` array
   is in the same index order as `SOURCES` because `promises` is built via `SOURCES.map(...)`.
   Verify this is already the case in current code before editing (it is — line 644).
   Important: The standalone `Lampa.Controller.collectionSet(html)` at line ~683 (immediately after
   the `renderCards(all, scroll.body())` call in the current flat-merge block) must also be removed
   as part of this replacement — it belongs to the old flat path and has no place in the new grouped block.

4. **`_reloadFromStart()` selector update** (line ~429).
   Change:
   ```
   scroll.body().find('.cherry-card').remove();
   ```
   to:
   ```
   scroll.body().find('.cherry-card, .cherry-group-label').remove();
   ```

**What NOT to touch in this phase:**
- `renderCards()` function signature or body
- `loadPage()` single-source browse
- The `cherry_no_results` empty-state path
- Any adapter search logic
- The sentinel (not yet introduced — that is Phase 4)

**Success criteria:**
- Global search (from cherry_main with any query) → results appear grouped by source name label.
- Each group shows at most 10 cards.
- Sources with 0 results for the query have no group header rendered.
- Group order matches SOURCES registration order (Pornhub first, etc.), not alphabetical.
- All-empty search shows ☹ "Нет результатов".
- No infinite scroll trigger after grouped results render (`totalPages = 1`).
- Long-press context menu on any grouped card still works.
- Console: `[Cherry] all_sources search error from <id>` still logs per-source failures gracefully.

**Regression check:**
- Single-source browse (Pornhub, Xvideos, any KVS) — `loadPage` path unchanged, no group labels appear.
- Favorites grid — `_reloadFromStart` not called in this path; no regression.
- Sort/Category change → `_reloadFromStart()` clears `.cherry-card` AND `.cherry-group-label`, then loads page 1 cleanly.

---

### Phase 3 — P0: Three Header Buttons

**Goal:** Replace the `.cherry-grid__filters` bar with a unified `.cherry-grid__actions` bar containing Search, Sort, and Category buttons with correct visibility rules and handlers.

**Files changed:** `plugin.js`

**Key implementation steps:**

1. **Template change** (`addTemplates()`, `cherry_grid` template, line ~1018).
   Remove the existing `.cherry-grid__filters` block:
   ```
   '<div class="cherry-grid__filters" style="display:none">',
     '<div class="cherry-grid__filter-sort selector">#{cherry_sort}</div>',
     '<div class="cherry-grid__filter-cat selector">#{cherry_category}</div>',
   '</div>',
   ```
   Replace with:
   ```
   '<div class="cherry-grid__actions">',
     '<div class="cherry-grid__action-search selector" style="display:none">#{cherry_search}</div>',
     '<div class="cherry-grid__action-sort selector" style="display:none">#{cherry_sort}</div>',
     '<div class="cherry-grid__action-cat selector" style="display:none">#{cherry_category}</div>',
   '</div>',
   ```

2. **`CherryGrid.create()` — remove dead code** (line ~473–525).
   Delete the existing `hasSorts`/`hasCats` block and all references to
   `.cherry-grid__filters`, `.cherry-grid__filter-sort`, `.cherry-grid__filter-cat`.
   Explicitly delete the following constructs:
   - `var hasSorts = ...;`
   - `var hasCats  = ...;`
   - `if (hasSorts || hasCats) html.find('.cherry-grid__filters').show();` block (and any surrounding `.hide()` siblings)
   - `.on('hover:enter', ...)` binding for `.cherry-grid__filter-sort`
   - `.on('hover:enter', ...)` binding for `.cherry-grid__filter-cat`

3. **`CherryGrid.create()` — new visibility + handler block** (insert where the deleted block was).
   ```
   // model_url excluded: model browse is already filtered to a performer — per-source search does not apply here
   var canSearch = !object.is_favorites && !object.all_sources && !object._related_items && !object.model_url;
   var hasSorts  = source && source.cfg && source.cfg.sorts   && source.cfg.sorts.length;
   var hasCats   = source && source.cfg && source.cfg.categories && source.cfg.categories.length;

   if (canSearch) html.find('.cherry-grid__action-search').show();
   if (hasSorts)  html.find('.cherry-grid__action-sort').show();
   if (hasCats)   html.find('.cherry-grid__action-cat').show();

   html.find('.cherry-grid__action-search').on('hover:enter', function () {
     Lampa.Keyboard.show({
       title:   Lampa.Lang.translate('cherry_search'),
       value:   object.query || '',
       onenter: function (text) {
         var q = (text || '').trim();
         if (!q) {
           Lampa.Controller.toggle('cherry_grid');
           return;
         }
         Lampa.Activity.push({
           component: 'cherry_grid',
           title:     source.name + ': ' + q,
           source_id: object.source_id,
           query:     q,
           page:      1
         });
       },
       onback: function () { Lampa.Controller.toggle('cherry_grid'); }
     });
   });

   html.find('.cherry-grid__action-sort').on('hover:enter', function () {
     if (!source || !source.cfg || !source.cfg.sorts) return;
     var items = source.cfg.sorts.map(function (s) {
       return { title: s.label, id: s.id };
     });
     items.unshift({ title: Lampa.Lang.translate('cherry_sort_default'), id: '' });
     Lampa.Select.show({
       title: Lampa.Lang.translate('cherry_sort'),
       items: items,
       onSelect: function (item) {
         currentSort = item.id;
         var sortLabel = currentSort
           ? _findLabel(source.cfg.sorts, currentSort)
           : Lampa.Lang.translate('cherry_sort');
         html.find('.cherry-grid__action-sort').text(sortLabel);
         _reloadFromStart();
         Lampa.Controller.toggle('cherry_grid');
       },
       onBack: function () { Lampa.Controller.toggle('cherry_grid'); }
     });
   });

   html.find('.cherry-grid__action-cat').on('hover:enter', function () {
     if (!source || !source.cfg || !source.cfg.categories) return;
     var items = source.cfg.categories.map(function (c) {
       return { title: c.label, id: c.id };
     });
     items.unshift({ title: Lampa.Lang.translate('cherry_category_default'), id: '' });
     Lampa.Select.show({
       title: Lampa.Lang.translate('cherry_category'),
       items: items,
       onSelect: function (item) {
         currentCategory = item.id;
         var catLabel = currentCategory
           ? _findLabel(source.cfg.categories, currentCategory)
           : Lampa.Lang.translate('cherry_category');
         html.find('.cherry-grid__action-cat').text(catLabel);
         _reloadFromStart();
         Lampa.Controller.toggle('cherry_grid');
       },
       onBack: function () { Lampa.Controller.toggle('cherry_grid'); }
     });
   });
   ```

4. **CSS — remove old filter rules** (`addStyles()`, line ~1389–1410).
   Delete the entire `/* REQ-5: Filter bar */` block:
   `.cherry-grid__filters`, `.cherry-grid__filter-sort + .cherry-grid__filter-cat`,
   `.cherry-grid__filter-sort, .cherry-grid__filter-cat`,
   `.cherry-grid__filter-sort.focus, .cherry-grid__filter-cat.focus`.

5. **CSS — add new action rules** (`addStyles()`, `rules` array, before closing `];`).
   Add:
   ```
   '.cherry-grid__actions {',
   '  display: flex;',
   '  gap: .6em;',
   '  padding: .4em 0 .2em;',
   '  flex-wrap: wrap;',
   '}',
   '.cherry-grid__action-search,',
   '.cherry-grid__action-sort,',
   '.cherry-grid__action-cat {',
   '  background: rgba(255,255,255,.1);',
   '  color: rgba(255,255,255,.85);',
   '  font-size: .82em;',
   '  padding: .25em .7em;',
   '  border-radius: .4em;',
   '  cursor: pointer;',
   '  border: 1px solid transparent;',
   '}',
   '.cherry-grid__action-search.focus,',
   '.cherry-grid__action-sort.focus,',
   '.cherry-grid__action-cat.focus {',
   '  border-color: #e75480;',
   '}',
   ```

**What NOT to touch in this phase:**
- `currentSort` and `currentCategory` local variable declarations
- `_reloadFromStart()` function body (already updated in Phase 2)
- `_findLabel()` helper
- `loadPage()`, `loadAllSources()`, `renderCards()`
- The `cherry_search`, `cherry_sort`, `cherry_category` lang key values

**Success criteria:**
- Browse Pornhub (has `cfg.sorts` and `cfg.categories`): 3 buttons visible: "Поиск", "Сортировка", "Категория".
- Browse a source without `cfg`: only "Поиск" visible.
- Open Favorites grid: no buttons visible (`canSearch = false`, no cfg).
- Open `_related_items` grid: no buttons visible.
- Open all-sources search results: no buttons visible.
- Click "Поиск" → `Lampa.Keyboard` opens → enter text → new `cherry_grid` opens for same source with that query.
- Click "Сортировка" → sort list opens → select → grid reloads from page 1 → button text updates.
- Click "Категория" → same behaviour.
- D-pad focus cycles through visible buttons (they are `.selector` elements).
- No `.cherry-grid__filters`, `.cherry-grid__filter-sort`, `.cherry-grid__filter-cat` in DOM.
- Console: no "cannot read property of undefined" errors on sources without cfg.

**Regression check:**
- `_findLabel()` helper is still intact and reachable.
- Favorites grid still shows empty hint (Phase 1) — no regression.
- Grouped search results (Phase 2) — `cherry_grid` opened with `all_sources: true` correctly shows no action buttons.
- Sort + category state reset on `_reloadFromStart()` — grid starts from page 1 with new parameters.

---

### Phase 4 — P1: Infinite Scroll D-pad Fix

**Goal:** Add `IntersectionObserver` sentinel at list bottom plus `maybeLoadMore()` D-pad fallback so page 2 auto-loads when navigating to the last card on TV.

**Files changed:** `plugin.js`

**Key implementation steps:**

1. **Declare sentinel and observer variables** at the top of `CherryGrid` constructor scope
   (alongside existing `var currentPage`, `var destroyed`, etc., line ~393):
   ```
   var sentinel         = null;
   var _sentinelObserver = null;
   ```

2. **Create sentinel element** inside `CherryGrid.create()`, after `scroll.body().addClass('cherry-cards-wrap')` (line ~470):
   ```
   sentinel = $('<div class="cherry-scroll-sentinel"></div>');
   scroll.body().append(sentinel);
   ```

3. **`_setupSentinel()` helper** (add as a named function inside `CherryGrid`, near `_reloadFromStart`):
   ```
   function _setupSentinel() {
     if (!window.IntersectionObserver) return;
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

4. **`maybeLoadMore()` helper** (add alongside `_setupSentinel`):
   ```
   function maybeLoadMore() {
     if (!loading && currentPage < totalPages) {
       var el = sentinel && sentinel[0];
       if (!el) return;
       var rect = el.getBoundingClientRect();
       var viewH = window.innerHeight || document.documentElement.clientHeight;
       // 400px lookahead for D-pad trigger (card navigation steps are large, need earlier trigger)
       // Mouse scroll listener uses 300px (existing code) — pointer movement is continuous so
       // a smaller lookahead is sufficient and avoids over-eager fetches.
       if (rect.top < viewH + 400) {
         currentPage++;
         loadPage(currentPage);
       }
     }
   }
   ```

5. **Call `_setupSentinel()` once** in `CherryGrid.create()`, after sentinel is appended:
   ```
   _setupSentinel();
   ```

6. **Append sentinel after every `renderCards()` call** to keep it at the list bottom.
   There are three `renderCards(...)` call sites inside `CherryGrid.create()` and `loadAllSources`:
   - `is_favorites` branch: `renderCards(favItems, scroll.body());` → add `scroll.body().append(sentinel);` after
   - `_related_items` branch: `renderCards(object._related_items, scroll.body());` → add `scroll.body().append(sentinel);` after
   - Inside `loadPage().then()`: `renderCards(result.items, scroll.body());` → add `scroll.body().append(sentinel);` after
   - Inside `loadAllSources().then()` (the grouped render in Phase 2 calls `renderCards` per group):
     add `scroll.body().append(sentinel);` ONCE after the `groups.forEach(...)` loop (not inside it).
   Note: `jQuery.append()` moves an existing DOM node — it does NOT clone. The `IntersectionObserver`
   reference to `sentinel[0]` stays valid across all moves.

7. **`_reloadFromStart()` — re-append sentinel** (line ~429, already updated in Phase 2).
   After `scroll.body().find('.cherry-card, .cherry-group-label').remove();`, add:
   ```
   scroll.body().append(sentinel);
   ```
   Final `_reloadFromStart()`:
   ```
   function _reloadFromStart() {
     html.find('.cherry-grid__empty').hide();
     currentPage = 1;
     totalPages  = 1;
     loading     = false;
     scroll.body().find('.cherry-card, .cherry-group-label').remove();
     scroll.body().append(sentinel);
     loadPage(1);
   }
   ```

8. **D-pad handlers — add `maybeLoadMore()`** in `CherryGrid.start()` (line ~547):
   ```
   down:  function () { Lampa.Controller.move('down');  maybeLoadMore(); },
   right: function () { Lampa.Controller.move('right'); maybeLoadMore(); },
   ```

9. **`stop()` / `destroy()` — disconnect observer**:
   ```
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

10. **Keep existing scroll listener** (`scroll.body().on('scroll', ...)`, line ~460).
    Add comment above it:
    ```
    // Secondary scroll trigger for pointer/mouse users.
    // IntersectionObserver is primary for D-pad (see _setupSentinel / maybeLoadMore).
    ```

11. **CSS sentinel rule** (`addStyles()`, `rules` array, before closing `];`):
    ```
    '.cherry-scroll-sentinel {',
    '  width: 100%;',
    '  height: 1px;',
    '  grid-column: 1 / -1;',
    '  pointer-events: none;',
    '}',
    ```

**What NOT to touch in this phase:**
- `loadPage()` function signature or return value
- `totalPages`, `loading`, `destroyed` variable declarations
- The existing `scroll.body().on('scroll', ...)` listener body
- Any adapter code

**Success criteria:**
- TV D-pad: navigate `down` through all 24 cards on page 1 → loading spinner appears → page 2 cards append.
- Mouse scroll: scroll to within 300px of bottom → page 2 loads (existing listener threshold — 300px for pointer, 400px for D-pad `maybeLoadMore`; they differ intentionally: D-pad jumps need earlier lookahead).
- With `window.IntersectionObserver` temporarily set to `undefined` in console: D-pad `down`/`right` past last card still triggers load via `maybeLoadMore()`.
- No double-load: `loading` flag prevents concurrent page fetches.
- `stop()` and `destroy()` both disconnect observer: open DevTools Memory → no retained `IntersectionObserver` after navigating away.
- Console: no "Cannot read property 'observe' of null" errors.

**Regression check:**
- Favorites grid (`totalPages = 1` always): no spurious load attempts.
- `_related_items` grid (`totalPages = 1`): same.
- Grouped search results (`totalPages = 1`): sentinel moves to end of group render; no load triggered.
- Sort/category change → `_reloadFromStart()` clears cards AND group labels, re-appends sentinel, loads page 1.

---

### Phase 5 — UX-A: Home Screen Row Mode

**Goal:** Add a `'rows'` rendering mode to `CherryMain` — one horizontal strip of popular cards per source — toggled via the existing long-press menu. Highest-complexity phase.

**Files changed:** `plugin.js`

**Key implementation steps:**

1. **Add `destroyed` and `mode` variables to `CherryMain` constructor scope** (line ~829).
   Current scope has only `var html;`. Extend to:
   ```
   var html;
   var destroyed = false;
   var mode;
   ```

2. **Update `CherryMain.destroy()`** (line ~884):
   ```
   this.destroy = function () { destroyed = true; if (html) html.remove(); };
   ```

3. **New lang keys** (`addLang()`, line ~1422). Add 2 entries:
   ```
   cherry_view_rows:  { ru: 'Вид: Ряды',  en: 'View: Rows'  },
   cherry_view_tiles: { ru: 'Вид: Тайлы', en: 'View: Tiles' },
   ```
   Note: `cherry_related` already exists at `plugin.js` line 1443 — do NOT add it here or anywhere in Phase 5. Only `cherry_view_rows` and `cherry_view_tiles` are new in this phase.

4. **New template** (`addTemplates()`, after existing templates). Add:
   ```
   Lampa.Template.add('cherry_source_row', [
     '<div class="cherry-source-row">',
       '<div class="cherry-source-row__label selector">{name}</div>',
       '<div class="cherry-source-row__cards"></div>',
       '<div class="cherry-source-row__loading">#{cherry_loading}</div>',
     '</div>'
   ].join(''));
   ```

5. **`renderRows()` function** (add as a named function inside `CherryMain`, alongside `renderSources`):
   ```
   function renderRows() {
     var container    = html.find('.cherry-main__sources');
     var resolvedCount = 0; // Counter: collectionSet fires once when last source resolves
     container.addClass('cherry-main__sources--rows');
     html.find('.cherry-main__search').hide();
     html.find('.cherry-main__sources-label').hide();

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
       rowEl.find('.cherry-source-row__loading').show();

       src.browse('', 1).then(function (result) {
         if (destroyed) return;
         rowEl.find('.cherry-source-row__loading').hide();
         if (result && result.items && result.items.length) {
           var cardsEl = rowEl.find('.cherry-source-row__cards');
           result.items.slice(0, 12).forEach(function (video) {
             video.source = src.id; // Required: 7-field Fav invariant — source field must be set
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
         }
         // ONE collectionSet call, fired when the last source resolves (success or empty)
         resolvedCount++;
         if (resolvedCount === SOURCES.length) Lampa.Controller.collectionSet(html);
       }).catch(function (err) {
         if (destroyed) return;
         rowEl.find('.cherry-source-row__loading').hide();
         console.warn('[Cherry] rows browse error for ' + src.id + ':', err);
         // Also count errors toward resolution so collectionSet is not permanently deferred
         resolvedCount++;
         if (resolvedCount === SOURCES.length) Lampa.Controller.collectionSet(html);
       });
     });
   }
   ```

6. **Restructure `CherryMain.create()`** (line ~835).
   Replace the current body with mode-conditional rendering:
   ```
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
     // SettingsApi fallback — primary toggle is in Lampa settings page if SettingsApi is available
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
             Lampa.Activity.backward();
             setTimeout(function () {
               if (destroyed) return; // Guard: user may navigate away during the 50ms delay
               Lampa.Activity.push({ component: 'cherry_main', title: 'Cherry', page: 1 });
             }, 50); // 50ms for activity stack to settle after backward() — do not reduce
           }
           Lampa.Controller.toggle('cherry_main');
         },
         onBack: function () { Lampa.Controller.toggle('cherry_main'); }
       });
     });

     return html;
   };
   ```
   The `setTimeout(50)` is the minimum needed for the activity stack to settle after `backward()`.
   Do not reduce below 0. Label it with a comment in code.

7. **CSS — row mode rules** (`addStyles()`, `rules` array, before closing `];`). Add:
   ```
   '.cherry-main__sources--rows {',
   '  flex-direction: column;',
   '  gap: 2em;',
   '}',
   '.cherry-source-row {',
   '  display: flex;',
   '  flex-direction: column;',
   '  gap: .6em;',
   '}',
   '.cherry-source-row__label {',
   '  font-size: .85em;',
   '  text-transform: uppercase;',
   '  letter-spacing: .1em;',
   '  color: rgba(255,255,255,.5);',
   '  cursor: pointer;',
   '  border: 1px solid transparent;',
   '  border-radius: .3em;',
   '  padding: .2em .4em;',
   '  align-self: flex-start;',
   '}',
   '.cherry-source-row__label.focus {',
   '  border-color: #e75480;',
   '  color: #fff;',
   '}',
   // overflow-x:scroll (not hidden) makes the strip scrollable so D-pad focus on
   // out-of-view cards causes the browser to auto-scroll the element into view.
   '.cherry-source-row__cards {',
   '  display: flex;',
   '  gap: .7em;',
   '  overflow-x: scroll;',
   '  scrollbar-width: none;',
   '  -ms-overflow-style: none;',
   '}',
   '.cherry-source-row__cards::-webkit-scrollbar { display: none; }',
   '.cherry-source-row__cards .cherry-card {',
   '  width: 12em;',
   '  flex-shrink: 0;',
   '}',
   '.cherry-source-row__loading {',
   '  display: none;',
   '  font-size: .8em;',
   '  color: rgba(255,255,255,.4);',
   '  padding: .4em 0;',
   '}',
   ```

**What NOT to touch in this phase:**
- `renderSources()` function body
- `bindSearch()` function body
- `cherry_main` template HTML structure (only `.cherry-main__sources` gets the `--rows` modifier class via JS)
- Favorites tile in `renderSources()` — only appears in tile mode
- Any adapter's `browse` implementation
- `playVideo()`, `secToTime()`, `formatViews()`, `sourceById()` helpers
- Row-mode cards are intentionally minimal — no fav badge, no `hover:focus` preview, no `hover:long` context menu. This is a v1 scope decision. Do not add these handlers to row cards in Phase 5.

**Success criteria:**
- Default (no storage key): tile mode renders, all source tiles visible, search bar visible, long-press menu shows "Вид: Ряды".
- Select "Вид: Ряды" → `cherry_main` re-opens → row mode: source name labels visible, loading indicators appear per row → after browse resolves, cards render horizontally.
- Each source row shows at most 12 cards.
- Press Enter on a row label → `cherry_grid` for that source opens.
- Press Enter on a card in a row → video plays via `playVideo()`.
- Navigating away while rows are loading (destroy before `browse().then()`) → no DOM errors, no `[Cherry] rows browse error` for normal cancellation.
- Select "Вид: Тайлы" in row mode → tile mode restores.
- `Lampa.Storage.get('cherry_home_mode')` persists across navigation.
- Long-press menu in tile mode: shows "Вид: Ряды". In row mode: shows "Вид: Тайлы".
- Preview toggle still works from long-press menu in both modes.
- Console: no "Cannot read property of undefined" errors on any source that returns an error from `browse()`.

**Regression check:**
- Full flow: tile mode → select source → `cherry_grid` → browse → play → back → tile mode still intact.
- Favorites tile (tile mode only): Favorites grid opens correctly.
- REQ-4 post-playback related panel: still fires from `playVideo()` path (unchanged).
- Phase 1 (UX-E/UX-G/UX-C), Phase 2 (P2), Phase 3 (P0), Phase 4 (P1): navigate to `cherry_grid` from row mode row label → action buttons visible, infinite scroll still works, grouped search still works.

---

## Summary Table

| Phase | Features | Risk | Lines changed (est.) | Commit message |
|---|---|---|---|---|
| 1 | UX-E + UX-G + UX-C | Low | ~40 | feat(ux-v2): fav empty hint, getRelated menu item, SettingsApi preview toggle |
| 2 | P2 | Low-medium | ~25 | feat(ux-v2): grouped search results by source (top 10 per source) |
| 3 | P0 | Medium | ~60 | feat(ux-v2): replace filter bar with three header action buttons |
| 4 | P1 | Medium | ~50 | feat(ux-v2): IntersectionObserver sentinel + D-pad maybeLoadMore for infinite scroll |
| 5 | UX-A | High | ~120 | feat(ux-v2): home screen row mode with async per-source browse strips |

---

## Definition of Done

Run this checklist explicitly before declaring done. Check each item; do not skip.

- [ ] Favorites with 0 items: hint text visible, "Нет результатов" hidden.
- [ ] Long-press on Pornhub card: 3 menu items (fav, похожие видео, похожее).
- [ ] Long-press on Xvideos card (no getRelated): 2 menu items (fav, похожие видео).
- [ ] Selecting "Похожее": spinner → related grid opens.
- [ ] SettingsApi present: Settings page shows Cherry preview toggle.
- [ ] SettingsApi absent: no JS error; long-press on title works.
- [ ] Global search: results grouped by source name, max 10 per group, SOURCES order.
- [ ] All-empty search: ☹ "Нет результатов" shown.
- [ ] Browse Pornhub: 3 action buttons visible (Search, Sort, Category).
- [ ] Browse source without cfg: only Search button visible.
- [ ] Favorites/related/all_sources grids: no action buttons visible.
- [ ] Search button → Keyboard → query → new per-source cherry_grid opens.
- [ ] Sort button → list → select → grid reloads, button text updates.
- [ ] D-pad down through 24 cards: page 2 auto-loads.
- [ ] Mouse scroll to bottom 300px: page 2 auto-loads.
- [ ] No double-load on simultaneous triggers.
- [ ] Row mode: each source shows up to 12 cards; loading indicator appears then hides.
- [ ] Row label Enter: opens cherry_grid for that source.
- [ ] Row card Enter: video plays.
- [ ] Row mode toggle persists across navigation.
- [ ] Pornhub browse → play → back: stream playback works (no regression).
- [ ] Xvideos browse → play → back: stream playback works.
- [ ] KVS source (e.g. Tizam) browse → play → back: stream playback works.
- [ ] Favorites add/remove: data stored with exactly 7 fields.
- [ ] REQ-4 post-playback related panel: fires correctly after player close.
- [ ] No orphan `.cherry-grid__filters` / `.cherry-grid__filter-*` in DOM.
- [ ] No new JS errors in browser console under normal operation.
