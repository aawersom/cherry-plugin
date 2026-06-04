# Spec: `cherry-nav-fix` — migrate Cherry components to Lampa built-in interaction base classes

**Mode:** medium · **File touched:** `D:\Works\Lampa\plugin.js` · **Reference (working):** `D:\tmp\sisi_full.js`

---

## 1. Problem (root cause — confirmed)

Arrow-key navigation has NEVER worked in Cherry. Both `CherryGrid` (~L406) and `CherryMain` (~L1008)
hand-roll `Lampa.Controller.add(name, {up,down,left,right})` where each handler calls `Lampa.Controller.move(dir)`.
On Lampa, `Controller.move(dir)` → `run(dir)` → the SAME controller's `dir` handler → `move(dir)` again →
infinite recursion (`Maximum call stack size exceeded`). The crash kills the controller, so arrows die.

The re-entrancy guard `_navMoving` and geometric `_atRightEdge` (L433-509, L675-700, L1081-1088) were band-aids:
they stop the crash but ALSO stop real focus movement. The hand-rolled controller approach is fundamentally wrong.

## 2. Solution

Migrate both components to Lampa's interaction base classes, which own focus movement, scroll-into-view, and
pagination internally. The plugin then NEVER calls `Controller.move` and NEVER registers directional handlers.

- **Grid** (`cherry_grid`) → `Lampa.InteractionCategory`
- **Home** (`cherry_main`) → `Lampa.InteractionMain` (one horizontal line per source), proven by `sisi.js` `Sisi`.

The base class provides `create` / `start` / `render` / `pause` / `stop` / `destroy` and the whole controller.
We override `create`, `nextPageReuest`, `cardRender`/`onAppend`, `empty`, `onRight`/`filter` only.

---

## 3. Verified Lampa contract (from working `sisi.js`)

### InteractionCategory (grid) — sisi `View()` (L952-1088)
```js
function View(object) {
  var comp = new Lampa.InteractionCategory(object);
  comp.create = function () {
    this.activity.loader(true);
    loadData(object, this.build.bind(this), this.empty.bind(this)); // build(data) renders + wires nav
  };
  comp.nextPageReuest = function (object, resolve, reject) {           // infinite scroll, framework-driven
    loadData(object, resolve.bind(this), reject.bind(this));
  };
  comp.cardRender = function (object, element, card) {                 // per-card hooks ONLY
    card.onEnter = function () { play(element); };
    card.onMenu  = function (t, d) { return contextMenu(t, d); };
    var f = card.onFocus;
    card.onFocus = function (t, d) { f(t, d); preview(t, element); };  // WRAP — keep base scroll-into-view
  };
  comp.onRight = comp.filter.bind(comp);                              // right edge → filter/actions menu
  return comp;
}
Lampa.Component.add('cherry_grid', View);
```
- `this.build(data)` expects `data = { title:string, results:card_data[], total_pages:number }`.
- Base card renderer reads from each card_data: **`title`** (and/or `name`), **`img`** (thumbnail).
  sisi mirrors `img`→`poster`→`background_image` (fixCards L365-372); we set `img` and mirror to `poster`.
- Optional **`quality`** field → small badge on the card (sisi uses it for duration).
- Extra fields (`url`, `id`, `source`, `preview`, `duration`, `views`, `model`) ride on the object and are
  available in `cardRender`'s `element` argument (`element` = the card_data object).
- `comp.empty(er?)` shows the empty state.

### InteractionMain (home) — sisi `Sisi()` (L906-950)
```js
var comp = new Lampa.InteractionMain(object);
comp.create = function () { this.activity.loader(true); loadMain(object, this.build.bind(this), this.empty.bind(this)); return this.render(); };
comp.onMore = function (data) { Lampa.Activity.push({...}); };       // "more" tile at line end
comp.onAppend = function (line, element) {                           // wrap each line's card hook
  line.onAppend = function (card) {
    var f = card.onFocus;
    card.onFocus = function (t, d) { f(t, d); preview(t, d); };
  };
};
```
- `build(data)` for InteractionMain expects **an array of lines**, each line `{ title:string, results:card_data[] }`
  (the standard Lampa "row of cards" shape). **UNCERTAINTY:** exact key (`results` vs `data`/`hpu`) not
  confirmed from `app.min.js`; Phase 3 must verify against the user's Lampa before full investment.

---

## 4. Exact card_data mapping (adapter → build)

Our adapter `browse/search/browseByModel` returns `{ items:[VideoCard], total_pages }`.
`VideoCard = { id, title, thumb, url, duration?, views?, preview?, model?{name,url}, source? }`.

Map each item → card_data:
```js
function toCard(v, sourceId) {
  v.source = v.source || sourceId;            // 7-field Fav invariant: source MUST be set
  var img = v.thumb || '';
  return Object.assign(v, {                    // mutate in place — extras ride along
    title:   v.title || '',
    img:     img,
    poster:  img,                              // mirror so base renderer finds a thumbnail
    quality: v.duration ? secToTime(v.duration) : ''  // duration badge via base renderer
  });
}
```
- `results = items.map(function (v) { return toCard(v, object.source_id); })`.
- `data = { title: screenTitle, results: results, total_pages: result.total_pages || 1 }`.
- `views`/`model`/`preview`/`url`/`id` remain on the object for `cardRender`.

> If the base renderer does NOT render `views` / `model` badge, that is acceptable cosmetic loss for v1.
> Re-add via `cardRender` DOM tweak only if Phase 2 shows it is needed (YAGNI).

---

## 5. Phased approach

### Phase 1 — Minimal grid migration (validate the base class on real hardware)
**Goal:** prove arrows navigate before investing in preview/fav/categories.

- Replace `CherryGrid` constructor body with `View()` using `Lampa.InteractionCategory`.
- `create()` handles **normal browse + search only** for Phase 1:
  - source = `sourceById(object.source_id)`
  - call `source.browse(currentCategory, page, currentSort)` or `source.search(query, page, currentSort)`
  - on resolve → `this.build({ title, results, total_pages })`; on reject/empty → `this.empty()`.
- `nextPageReuest(object, resolve, reject)` → load next page, resolve with `{ results, total_pages }`.
- `cardRender`: `card.onEnter = () => playVideo(element, sourceById(element.source))`. Nothing else yet.
- REMOVE for Phase 1: hand-rolled `Lampa.Controller.add`, `Lampa.Scroll` setup, `renderCards`, `_navMoving`,
  `_atRightEdge`, `maybeLoadMore`, sentinel + `IntersectionObserver`, the `scroll` on-scroll handler.
- Keep `_buildCatUrl`, `cfg`, `currentSort`, `currentCategory` (used in Phase 2 via `onRight`).

**Acceptance (Phase 1):**
1. Open a source grid → cards render in a grid.
2. Arrow keys move focus card-to-card (left/right/up/down) — NO `RangeError`/stack overflow in console.
3. Scrolling down past the last loaded page loads more (nextPageReuest fires).
4. Enter on a card plays the video (existing stream resolution unchanged).
5. Back returns to home.

### Phase 2 — Re-add grid features (preview / fav / related / model / onRight categories)
- `cardRender.onMenu` → existing long-press context menu: fav toggle, "similar" all-sources search,
  "related" via `cardSrc.getRelated` (logic from L915-990, unchanged — just relocated).
- `cardRender.onFocus` WRAP → `_startPreview(card, element.preview)` guarded by
  `Lampa.Storage.get('cherry_preview_enabled', true)` AND `!_isAndroid()`. Stop previous preview first.
  Hook `_stopCurrentPreview()` into `comp.stop`/`comp.pause` (wrap base).
- Model badge: if `element.model?.name`, on focus/menu offer model-browse push (`model_url`) — re-add via
  `cardRender` only if the base renderer drops it; prefer surfacing it inside `onMenu` to avoid DOM surgery.
- `onRight = openActionsMenu` (the Поиск → Сортировка → Категории menu, L580-597 + `_openSearch/_openSort/_openCat`,
  L520-572). Replaces the deleted `_atRightEdge` edge detection. `_reloadFromStart` becomes a re-push of
  `cherry_grid` with updated `currentSort`/`currentCategory` (since the base class owns the grid now), OR
  re-implement by re-running `create` build — pick re-push (`Lampa.Activity.push`) for simplicity.
- Extra `create()` modes (each builds `results` and calls `build` with `total_pages:1`, NO `nextPageReuest` paging):
  - `is_favorites` → `Fav.all()` → results. Empty → `empty()` + fav hint Noty (sisi idiom L981-985).
  - `_related_items` → results from the passed array.
  - `all_sources && query` → parallel search, grouped. **Decision:** for grouped all-sources, either build a
    single flat `results` (lose per-source labels) OR keep multi-line via InteractionMain-style lines.
    For v1 keep it a flat `InteractionCategory` grid (drop group labels — cosmetic) to avoid a second base class.
  - `model_url` → `source.browseByModel(model_url, page)`; paging allowed.

**Acceptance (Phase 2):**
1. Long-press opens menu (fav/similar/related) and each action works.
2. Focusing a card starts preview (non-Android, toggle ON); leaving stops it; no leaked `<video>` on destroy.
3. RIGHT at the grid's right edge opens Поиск/Сортировка/Категории; selecting a category/sort reloads with the
   category URL via `_buildCatUrl` (categories KEEP working).
4. Favorites, related, model-browse, all-sources screens render and navigate.

### Phase 3 — CherryMain migration (`Lampa.InteractionMain`)
- Replace `CherryMain` with `Sisi()`-style `InteractionMain`: `create` builds **lines** = one line per source
  (each line `{ title: src.name, results: popularCards }` from `src.browse('', 1)`), plus a Favorites line/entry.
- Drop the custom async `renderRows` loader, `_navMoving`, `_toggling`, hand-rolled controller, and the
  tiles/rows mode switch — InteractionMain navigation is free and rows-only is the natural form.
- Preserve: Favorites entry (first line or a dedicated tile), per-source "see all" (line title `hover:enter` →
  push full `cherry_grid`), global search (via `onRight`/filter or a search line), preview toggle
  (long-press menu OR SettingsApi — keep whichever already exists in settings).
- `onAppend` WRAP each line's `card.onFocus` to add preview (guarded), mirroring sisi L938-947.
- `onMore` → push full `cherry_grid` for that source.

**Acceptance (Phase 3):**
1. Home screen shows source lines; arrows navigate within and between lines.
2. Enter on a card plays; line title / "more" → full source grid.
3. Favorites reachable; global search reachable; preview toggle still works.
4. No `RangeError`, no dead controller.

---

## 6. Scope guard — DO NOT TOUCH
- `getStream` / `buildProxyUrl` / `cherryFetch` / `playVideo` stream-resolution (L330-387) / `px()` proxy logic.
- All adapters' `browse` / `search` / `getStream` / `browseByModel` / `getRelated`.
- `Fav` 7-field serialisation (the `video.source` invariant — keep setting it in `toCard`).
- Proxy routing (`PROXY_URL`, `PROXY_URL_2`, `PROXY_URL_3`, Android no-proxy branch).
- `cfg.categories` + `_buildCatUrl` (L3280) + `_cats` + `_kvsEngine` — categories MUST keep working through the
  new `onRight`→filter path. The category-selection flow only changes WHERE it is triggered, not how URLs build.
- Templates `cherry_card` / `cherry_grid` MAY be simplified ONLY if the base renderer supplies its own card
  template. **Decision:** prefer the base class's own card template (sisi uses Lampa's default `card`), and
  delete `cherry_card`/`cherry_source_row` if unused after migration. Verify in Phase 1 whether the base class
  needs our template or supplies one.

---

## 7. Risks / uncertainty
- `Lampa.InteractionCategory` / `InteractionMain` API is verified from `sisi.js` (working in production) but NOT
  from `app.min.js` directly. **Mitigation:** Phase 1 is a minimal, reversible grid migration whose sole purpose
  is to confirm arrows navigate on the user's Lampa build before re-adding features.
- InteractionMain `build()` line-shape key (`results` vs alternative) unconfirmed → resolve empirically in Phase 3.
- If the base class supplies its own card template, our preview `<video>` and badges need re-insertion via
  `cardRender` DOM hooks — accept minor cosmetic regression in Phase 1, restore in Phase 2.

---

## 8. Overall acceptance criteria
Arrows navigate cards in a grid; up/down scroll loads more pages; Enter plays; long-press opens menu; RIGHT at
edge opens Поиск/Сортировка/Категории; home screen navigates; **no `RangeError`/stack overflow**; videos and
previews still work; favorites/related/model/all-sources/categories all functional.
