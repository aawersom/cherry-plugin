# Cherry UX v2 — Implementation Primer

> For `code-writer` agents implementing phases 1–5. Do NOT touch stream/proxy/card-parsing logic.

---

## Key Line Ranges

| Area | Lines |
|---|---|
| CherryGrid constructor variables | 386–405 |
| `_reloadFromStart()` | 429–436 |
| `create()` — scroll setup | 458–468 |
| `create()` — filter bar | 473–525 |
| `create()` — content branches | 527–541 |
| `start()` / `stop()` / `destroy()` | 545–573 |
| `loadPage()` | 581–628 |
| `loadAllSources()` | 635–680 |
| `renderCards()` | 709–814 |
| CherryMain constructor + `create()` | 830–910 |
| `bindSearch()` / Lampa.Keyboard usage | 950–970 |
| `addTemplates()` — all 4 templates | 1020–1055 |
| `cherry-cards-wrap` CSS (grid) | 1267–1274 |
| `addLang()` — all i18n keys | 1422–1445 |

---

## Constructor-Scoped Variables (CherryGrid)

```javascript
var html;              // jQuery element — screen container
var scroll;            // Lampa.Scroll instance
var currentPage = 1;
var totalPages  = 1;
var loading     = false;  // prevents duplicate requests
var destroyed   = false;  // async guard — set in destroy()
var _currentPreviewEl;
var _currentPreviewCard;
var currentSort     = '';
var currentCategory = '';
```

---

## `destroyed` Guard Pattern

Every async callback must start with this guard:
```javascript
promise.then(function (result) {
  if (destroyed) return;
  // ... DOM operations safe here
}).catch(function () {
  if (destroyed) return;
  // ... error handling
});
```

`destroyed = true` is set in `this.destroy` (line ~571). Declaration at line ~396.

---

## `_reloadFromStart()` — Current Form (line 429)

```javascript
function _reloadFromStart() {
  html.find('.cherry-grid__empty').hide();
  currentPage = 1;
  totalPages  = 1;
  loading     = false;
  scroll.body().find('.cherry-card').remove();  // Phase 2+4 will change this selector
  loadPage(1);
}
```

**Phase 2 changes this to:** `.find('.cherry-card, .cherry-group-label').remove()`  
**Phase 4 adds:** `scroll.body().append(sentinel);` before `loadPage(1)`

---

## `loadPage()` Pattern (line 581)

```javascript
function loadPage(page) {
  var src = sourceById(object.source_id);
  if (!src) { /* show empty */ return; }
  setLoading(true);
  loading = true;
  var promise;
  if (object.model_url)  promise = src.browseByModel(object.model_url, page);
  else if (object.query) promise = src.search(object.query, page, currentSort);
  else                   promise = src.browse(currentCategory, page, currentSort);

  promise.then(function (result) {
    if (destroyed) return;
    totalPages = result.total_pages || 1;
    renderCards(result.items, scroll.body());
    loading = false;
    setLoading(false);
    Lampa.Controller.collectionSet(html);
  }).catch(function () {
    if (destroyed) return;
    loading = false;
    setLoading(false);
    if (page === 1) { /* show noty + empty */ }
  });
}
```

---

## `loadAllSources()` Pattern (line 635)

```javascript
function loadAllSources() {
  setLoading(true);
  var promises = SOURCES.map(function (src) {
    return src.search(object.query, 1).catch(function () { return {items:[], total_pages:1}; });
  });
  Promise.all(promises).then(function (results) {
    if (destroyed) return;
    var all = results.reduce(function (acc, r) { return acc.concat(r.items); }, []);
    all.sort(function (a, b) { return (a.title||'').localeCompare(b.title||''); });
    totalPages = 1;
    renderCards(all, scroll.body());
    setLoading(false);
    Lampa.Controller.collectionSet(html);
  });
}
```

**Phase 2 replaces the flatten+sort+renderCards block** with grouped rendering.

---

## `Lampa.Select.show()` — camelCase callbacks

```javascript
Lampa.Select.show({
  title: 'Menu Title',
  items: [
    { title: 'Option A', id: 'a' },
    { title: 'Option B', action: 'b' }
  ],
  onSelect: function (item) {
    // item.id or item.action
    Lampa.Controller.toggle('cherry_grid');  // REQUIRED in EVERY branch
  },
  onBack: function () {
    Lampa.Controller.toggle('cherry_grid');  // REQUIRED
  }
});
```

**Note:** `onSelect` / `onBack` — camelCase. Every branch must call `Controller.toggle`.

---

## `Lampa.Keyboard.show()` — lowercase callbacks

```javascript
if (typeof Lampa.Keyboard !== 'undefined' && Lampa.Keyboard.show) {
  Lampa.Keyboard.show({
    title:    'Title',
    value:    '',
    onchange: function (value) { /* live update */ },
    onenter:  function (value) {
      // committed value
      Lampa.Controller.toggle('cherry_grid');
    },
    onback:   function () {
      Lampa.Controller.toggle('cherry_grid');
    }
  });
}
```

**Note:** `onenter` / `onchange` / `onback` — ALL lowercase. This is different from Select!

---

## `cherry_card` Template (line ~1039)

```html
<div class="cherry-card selector">
  <div class="cherry-card__thumb">
    <img class="cherry-card__img" src="" alt="" loading="lazy" />
    <video class="cherry-card__preview" muted playsinline loop></video>
    <div class="cherry-card__duration">{duration}</div>
    <div class="cherry-card__fav" style="display:none">♥</div>
    <div class="cherry-card__model selector" style="display:none"></div>
  </div>
  <div class="cherry-card__info">
    <div class="cherry-card__title">{title}</div>
    <div class="cherry-card__views">{views}</div>
  </div>
</div>
```

Cards produced via: `Lampa.Template.get('cherry_card', { title, duration, views })`

---

## `cherry_grid` Template (line ~1018)

```html
<div class="cherry-grid layer--wheight">
  <div class="cherry-grid__head">
    <div class="cherry-grid__title">{title}</div>
    <div class="cherry-grid__filters" style="display:none">
      <div class="cherry-grid__filter-sort selector">#{cherry_sort}</div>
      <div class="cherry-grid__filter-cat selector">#{cherry_category}</div>
    </div>
  </div>
  <div class="cherry-grid__body"></div>
  <div class="cherry-grid__loading">...</div>
  <div class="cherry-grid__empty" style="display:none">
    <div class="cherry-grid__empty-icon">☹</div>
    <div>#{cherry_no_results}</div>
  </div>
</div>
```

**Phase 3 replaces `.cherry-grid__filters` block entirely** with `.cherry-grid__actions`.

---

## `cherry_main` Template (line ~989)

```html
<div class="cherry-main layer--wheight">
  <div class="cherry-main__head">
    <div class="cherry-main__logo">[SVG]</div>
    <div class="cherry-main__title">Cherry</div>
    <div class="cherry-main__search">
      <input class="cherry-main__search-input selector" ... />
      <div class="cherry-main__search-btn selector">#{cherry_search}</div>
    </div>
  </div>
  <div class="cherry-main__sources-label">#{cherry_sources}</div>
  <div class="cherry-main__sources"></div>
</div>
```

---

## `addLang()` Registration Pattern (line 1422)

```javascript
Lampa.Lang.add({
  cherry_key: { ru: 'Текст', en: 'Text' },
  // ...
});
```

**Existing keys (do not re-add):** `cherry_search`, `cherry_sort`, `cherry_sort_default`,
`cherry_category`, `cherry_category_default`, `cherry_favorites`, `cherry_no_results`,
`cherry_loading`, `cherry_error`, `cherry_add_fav`, `cherry_rem_fav`,
`cherry_add_fav_action`, `cherry_rem_fav_action`, `cherry_quality`, `cherry_similar`,
`cherry_preview_setting`, `cherry_related`, `cherry_proxy_key_init`,
`cherry_sources`, `cherry_model_videos`

---

## CSS Conventions

- **Units:** `em` throughout (base ~20px on TV). `1em ≈ 20px`.
- **Grid:** `.cherry-cards-wrap` is `display:grid; grid-template-columns: repeat(auto-fill, minmax(13em, 1fr)); gap:.9em`
- **Focusable elements** need class `.selector`
- **Colors:** `#e75480` (cherry pink), dark bg `#141414`–`#1e1e1e`
- **Border-radius:** `.6em` for cards

---

## `Lampa.SettingsApi` Pattern

```javascript
var _saAdd = Lampa.SettingsApi && (Lampa.SettingsApi.addParam || Lampa.SettingsApi.add);
if (_saAdd) {
  _saAdd.call(Lampa.SettingsApi, {
    component: 'cherry',
    param:     'cherry_preview_enabled',
    name:      Lampa.Lang.translate('cherry_preview_setting'),
    type:      'trigger',
    default:   true
  });
} else if (Lampa.SettingsApi) {
  console.warn('[Cherry] SettingsApi found but addParam/add method not available');
}
```

---

## CherryMain `create()` — Current Body (line 835)

```javascript
this.create = function () {
  html = Lampa.Template.get('cherry_main', {});
  renderSources();
  bindSearch();

  html.find('.cherry-main__title').on('hover:long', function () {
    var current = Lampa.Storage.get('cherry_preview_enabled', true);
    Lampa.Select.show({
      title: 'Cherry',
      items: [
        { title: Lampa.Lang.translate('cherry_preview_setting') + ': ' + (current ? 'ON' : 'OFF'),
          action: 'preview_toggle' }
      ],
      onSelect: function (item) {
        if (item.action === 'preview_toggle') {
          Lampa.Storage.set('cherry_preview_enabled', !current);
          Lampa.Noty.show(Lampa.Lang.translate('cherry_preview_setting') + ': ' + (!current ? 'ON' : 'OFF'));
        }
        Lampa.Controller.toggle('cherry_main');
      },
      onBack: function () { Lampa.Controller.toggle('cherry_main'); }
    });
  });
  return html;
};
```

**Phase 5 replaces the ENTIRE body** of `this.create` (lines 835–864).

---

## Fav 7-Field Invariant

`Fav.toggle(video)` persists only: `id, source, title, thumb, url, duration, views`

`video.source` MUST be set before any card can interact with Fav. In `renderCards()` all
cards come from adapters which set `video.source = src.id`. In `renderRows()` (Phase 5),
you must explicitly set `video.source = src.id` on each card before rendering.

---

## Tests

```powershell
cd D:\Works\Lampa
npx vitest run       # run all tests once
```

Test files: `test/cherry-stream-fix.test.mjs`, `test/cherry-lampa-e2e.mjs`

---

## Scope Guard — Never Touch

- `playVideo()` — stream resolution + player handoff
- `buildProxyUrl()`, `cherryFetch()`, `cherryPost()`, `proxyM3u8()`
- Any adapter's `browse()`, `search()`, `getStream()`, `browseByModel()`
- `Fav.toggle()` internal logic
- `PROXY_URL_2_HOSTS`, `RESIDENTIAL`, CF Worker files
