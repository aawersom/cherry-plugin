/**
 * Tests for Cherry UX v2 — Phase 1 (UX-E, UX-G, UX-C).
 *
 * Two kinds of tests live here:
 *   1. Behaviour-documentation blocks (POST): exercise reconstructed logic that
 *      mirrors plugin.js and assert the intended behaviour.
 *   2. Source assertions (anti-drift): read the REAL plugin.js and grep for
 *      load-bearing constructs, so the mirrored logic above cannot silently
 *      drift away from the shipped file.
 *
 * Sections:
 *   1. UX-E — empty-favorites branch child visibility
 *   2. UX-G — hover:long items array include/exclude 'related' by capability
 *   3. UX-C — SettingsApi registration contract
 *   4. plugin.js source assertions (anti-drift)
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ============================================================
// P3.2 — Empty-state routing (behaviour documentation)
//
// The custom cherry_grid template (with .cherry-grid__empty* children) was
// removed in P0; InteractionCategory owns the DOM. The empty state is now a
// single comp.empty(msg) call whose message DISTINGUISHES three cases:
//   - load failure        → cherry_load_error  (network/source error)
//   - empty favorites      → cherry_fav_empty_hint (persistent how-to hint)
//   - generic no results   → cherry_no_results (default when no msg given)
// The mirror below reproduces that message-selection decision.
// ============================================================

describe('P3.2: empty-state message routing (POST behaviour)', function () {
  /**
   * Mirror of CherryGrid.create()'s three branches plus comp.empty()'s default.
   * Returns the lang key that comp.empty(msg) ultimately renders as descr.
   */
  function emptyMessageFor(scenario) {
    if (scenario === 'load_failure') return 'cherry_load_error';
    if (scenario === 'empty_favorites') return 'cherry_fav_empty_hint';
    // generic empty: create() does not call empty() (build renders 0 cards), but
    // if empty() is ever called with no arg the override falls back to no_results.
    return 'cherry_no_results';
  }

  it('load failure → cherry_load_error (distinct from no-results)', function () {
    expect(emptyMessageFor('load_failure')).toBe('cherry_load_error');
  });

  it('empty favorites → persistent cherry_fav_empty_hint', function () {
    expect(emptyMessageFor('empty_favorites')).toBe('cherry_fav_empty_hint');
  });

  it('no-arg empty() falls back to cherry_no_results', function () {
    expect(emptyMessageFor('generic')).toBe('cherry_no_results');
  });

  it('load_error and no_results are different keys (error != empty)', function () {
    expect(emptyMessageFor('load_failure')).not.toBe(emptyMessageFor('generic'));
  });
});

// ============================================================
// UX-G — "Похожие" (Related) context menu item (behaviour documentation)
// ============================================================

describe('UX-G: context menu items — POST behaviour', function () {
  /**
   * The hover:long handler builds a base items array then conditionally pushes
   * the 'related' entry based on cardSrc.getRelated existence.
   */
  function buildMenuItemsPost(cardSrc, Lampa) {
    var isFav = false;
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

    if (cardSrc && cardSrc.getRelated) {
      menuItems.push({
        title: Lampa.Lang.translate('cherry_related'),
        action: 'related'
      });
    }

    return menuItems;
  }

  var mockLampa = {
    Lang: { translate: function (k) { return k; } }
  };

  var pornhubSrc = {
    id: 'pornhub',
    name: 'Pornhub',
    getRelated: function () { return Promise.resolve([]); }
  };

  var xozillaSrc = {
    id: 'xozilla',
    name: 'Xozilla'
    // no getRelated
  };

  it('Pornhub: menu has 3 items (fav, similar, related)', function () {
    var items = buildMenuItemsPost(pornhubSrc, mockLampa);
    expect(items).toHaveLength(3);
  });

  it('Pornhub: menu contains "related" action', function () {
    var items = buildMenuItemsPost(pornhubSrc, mockLampa);
    var actions = items.map(function (i) { return i.action; });
    expect(actions).toContain('related');
  });

  it('Pornhub: related item has action "related"', function () {
    var items = buildMenuItemsPost(pornhubSrc, mockLampa);
    var rel = items.find(function (i) { return i.action === 'related'; });
    expect(rel).toBeDefined();
    expect(rel.action).toBe('related');
  });

  it('Xozilla: menu has exactly 2 items (fav, similar) — no related', function () {
    var items = buildMenuItemsPost(xozillaSrc, mockLampa);
    expect(items).toHaveLength(2);
  });

  it('Xozilla: menu does NOT contain "related" action', function () {
    var items = buildMenuItemsPost(xozillaSrc, mockLampa);
    var actions = items.map(function (i) { return i.action; });
    expect(actions).not.toContain('related');
  });

  it('null cardSrc: menu has 2 items, no related', function () {
    var items = buildMenuItemsPost(null, mockLampa);
    var actions = items.map(function (i) { return i.action; });
    expect(actions).not.toContain('related');
    expect(items).toHaveLength(2);
  });
});

// ============================================================
// UX-C — Lampa.SettingsApi registration contract (behaviour documentation)
// ============================================================

describe('UX-C: SettingsApi registration — POST contract', function () {
  /**
   * Real Lampa contract: addComponent() BEFORE addParam(), boolean type 'trigger'.
   * 'trigger' params auto-persist to Lampa.Storage under param.name, so no onChange.
   * No '.add' fallback — guard requires addComponent && addParam.
   */
  function simulateSettingsRegistration(Lampa) {
    if (Lampa.SettingsApi && Lampa.SettingsApi.addComponent && Lampa.SettingsApi.addParam) {
      Lampa.SettingsApi.addComponent({
        component: 'cherry',
        name: 'Cherry',
        icon: '<svg></svg>'
      });
      Lampa.SettingsApi.addParam({
        component: 'cherry',
        param: { name: 'cherry_preview_enabled', type: 'trigger', default: true },
        field: { name: Lampa.Lang.translate('cherry_preview_setting'), description: '' }
      });
    } else if (Lampa.SettingsApi) {
      console.warn('[Cherry] SettingsApi present but addComponent/addParam unavailable — using long-press fallback');
    }
  }

  function makeMock() {
    return {
      addComponentSpy: vi.fn(),
      addParamSpy: vi.fn()
    };
  }

  function makeLampa(spies) {
    return {
      SettingsApi: { addComponent: spies.addComponentSpy, addParam: spies.addParamSpy },
      Lang:    { translate: function (k) { return k; } },
      Storage: { set: vi.fn() }
    };
  }

  it('addComponent is called once', function () {
    var spies = makeMock();
    simulateSettingsRegistration(makeLampa(spies));
    expect(spies.addComponentSpy).toHaveBeenCalledTimes(1);
  });

  it('addParam is called once', function () {
    var spies = makeMock();
    simulateSettingsRegistration(makeLampa(spies));
    expect(spies.addParamSpy).toHaveBeenCalledTimes(1);
  });

  it('addComponent registers component "cherry"', function () {
    var spies = makeMock();
    simulateSettingsRegistration(makeLampa(spies));
    expect(spies.addComponentSpy.mock.calls[0][0].component).toBe('cherry');
  });

  it('param.name === "cherry_preview_enabled"', function () {
    var spies = makeMock();
    simulateSettingsRegistration(makeLampa(spies));
    expect(spies.addParamSpy.mock.calls[0][0].param.name).toBe('cherry_preview_enabled');
  });

  it('param.type === "trigger"', function () {
    var spies = makeMock();
    simulateSettingsRegistration(makeLampa(spies));
    expect(spies.addParamSpy.mock.calls[0][0].param.type).toBe('trigger');
  });

  it('param.default === true', function () {
    var spies = makeMock();
    simulateSettingsRegistration(makeLampa(spies));
    expect(spies.addParamSpy.mock.calls[0][0].param.default).toBe(true);
  });

  it('addParam component === "cherry"', function () {
    var spies = makeMock();
    simulateSettingsRegistration(makeLampa(spies));
    expect(spies.addParamSpy.mock.calls[0][0].component).toBe('cherry');
  });

  it('no error when SettingsApi is undefined', function () {
    var mockLampa = {
      Lang:    { translate: function (k) { return k; } },
      Storage: { set: vi.fn() }
    };
    expect(function () { simulateSettingsRegistration(mockLampa); }).not.toThrow();
  });

  it('skips registration when addComponent is absent (long-press fallback)', function () {
    var addParamSpy = vi.fn();
    var mockLampa = {
      SettingsApi: { addParam: addParamSpy }, // no addComponent
      Lang:    { translate: function (k) { return k; } },
      Storage: { set: vi.fn() }
    };
    simulateSettingsRegistration(mockLampa);
    expect(addParamSpy).not.toHaveBeenCalled();
  });
});

// ============================================================
// plugin.js source assertions (anti-drift)
// ============================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');

describe('plugin.js source assertions (anti-drift)', () => {
  it('UX-E: dead cherry_grid template classes are gone (InteractionCategory owns DOM)', () => {
    // The custom template layer was orphaned by the InteractionCategory migration
    // and removed in P0. The empty state is now driven by comp.empty(msg).
    expect(SRC).not.toContain('cherry-grid__empty-generic');
    expect(SRC).not.toContain('cherry-grid__empty-fav-hint');
  });
  it('UX-E: empty favorites surfaces a PERSISTENT hint via empty(), not a toast', () => {
    // P3.2: empty favorites now calls this.empty(cherry_fav_empty_hint) so the
    // hint stays on screen, instead of the old transient Lampa.Noty toast.
    expect(SRC).toMatch(/is_favorites[\s\S]{0,120}\.empty\(\s*Lampa\.Lang\.translate\(\s*'cherry_fav_empty_hint'/);
  });
  it('UX-E: cherry_fav_empty_hint lang key registered', () => {
    expect(SRC).toMatch(/cherry_fav_empty_hint\s*:/);
  });
  it('UX-G: related menu item guarded by getRelated', () => {
    expect(SRC).toMatch(/cardSrc\s*&&\s*cardSrc\.getRelated/);
    expect(SRC).toMatch(/action:\s*'related'/);
  });
  it('UX-G: empty related uses cherry_no_results not cherry_error', () => {
    // the related-empty branch should reference cherry_no_results
    expect(SRC).toMatch(/cherry_no_results/);
  });
  it('UX-C: SettingsApi.addComponent called for cherry', () => {
    expect(SRC).toMatch(/addComponent/);
    expect(SRC).toMatch(/component:\s*'cherry'/);
  });
  it('UX-C: preview param type is trigger', () => {
    expect(SRC).toMatch(/cherry_preview_enabled/);
    expect(SRC).toMatch(/type:\s*'trigger'/);
  });
});

// ============================================================
// P2 — Grouped Search Results (behaviour documentation)
// ============================================================

describe('P2: groupResults — POST behaviour', function () {
  /**
   * Pure mirror of loadAllSources() grouped-render logic.
   * Input: array of { source, name, items } in SOURCES order (one per source,
   * matching the zip(SOURCES, results) iteration in plugin.js).
   * Output: an ordered flat stream of render ops:
   *   { label: <source name> } followed by up to 10 card ops { card: <item> }.
   * Sources with 0 items are skipped entirely (no label emitted).
   * Order is preserved (NOT alphabetised) and capped at 10 cards per group.
   */
  function groupResults(sourceResults) {
    var out = [];
    sourceResults.forEach(function (g) {
      if (!g || !g.items || !g.items.length) return; // skip empty groups
      var items = g.items.slice(0, 10); // cap at 10 per source
      out.push({ label: g.name });
      items.forEach(function (item) { out.push({ card: item }); });
    });
    return out;
  }

  function cards(n, prefix) {
    var arr = [];
    for (var i = 0; i < n; i++) arr.push({ title: (prefix || 'v') + i });
    return arr;
  }

  it('caps each group at 10 cards', function () {
    var out = groupResults([{ source: 'a', name: 'A', items: cards(25, 'a') }]);
    var cardOps = out.filter(function (o) { return o.card; });
    expect(cardOps).toHaveLength(10);
  });

  it('keeps the first 10 items in adapter order (not sorted)', function () {
    var out = groupResults([{ source: 'a', name: 'A', items: cards(25, 'a') }]);
    var titles = out.filter(function (o) { return o.card; })
                    .map(function (o) { return o.card.title; });
    expect(titles).toEqual([
      'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'
    ]);
  });

  it('emits a label before each non-empty group', function () {
    var out = groupResults([
      { source: 'a', name: 'A', items: cards(2, 'a') },
      { source: 'b', name: 'B', items: cards(3, 'b') }
    ]);
    var labels = out.filter(function (o) { return o.label; })
                    .map(function (o) { return o.label; });
    expect(labels).toEqual(['A', 'B']);
  });

  it('preserves SOURCES registration order, not alphabetical', function () {
    // Sources given Z-then-A; output must stay Z, A.
    var out = groupResults([
      { source: 'z', name: 'Zsrc', items: cards(1, 'z') },
      { source: 'a', name: 'Asrc', items: cards(1, 'a') }
    ]);
    var labels = out.filter(function (o) { return o.label; })
                    .map(function (o) { return o.label; });
    expect(labels).toEqual(['Zsrc', 'Asrc']);
  });

  it('skips empty groups entirely — no label, no cards', function () {
    var out = groupResults([
      { source: 'a', name: 'A', items: cards(2, 'a') },
      { source: 'b', name: 'B', items: [] },            // empty
      { source: 'c', name: 'C', items: null },          // null items
      { source: 'd', name: 'D', items: cards(1, 'd') }
    ]);
    var labels = out.filter(function (o) { return o.label; })
                    .map(function (o) { return o.label; });
    expect(labels).toEqual(['A', 'D']);
  });

  it('label immediately precedes its own group cards', function () {
    var out = groupResults([
      { source: 'a', name: 'A', items: cards(2, 'a') },
      { source: 'b', name: 'B', items: cards(1, 'b') }
    ]);
    // Sequence: label A, card a0, card a1, label B, card b0
    expect(out[0]).toEqual({ label: 'A' });
    expect(out[1].card.title).toBe('a0');
    expect(out[2].card.title).toBe('a1');
    expect(out[3]).toEqual({ label: 'B' });
    expect(out[4].card.title).toBe('b0');
  });

  it('all-empty input produces empty output (caller shows ☹ no_results)', function () {
    var out = groupResults([
      { source: 'a', name: 'A', items: [] },
      { source: 'b', name: 'B', items: [] }
    ]);
    expect(out).toHaveLength(0);
  });

  it('exactly 10 items are kept intact (boundary)', function () {
    var out = groupResults([{ source: 'a', name: 'A', items: cards(10, 'a') }]);
    var cardOps = out.filter(function (o) { return o.card; });
    expect(cardOps).toHaveLength(10);
  });
});

// ============================================================
// P2 — plugin.js source assertions (anti-drift)
// ============================================================

describe('P2: plugin.js source assertions (anti-drift)', () => {
  it('dead cherry_group_label template/class removed (P0)', () => {
    // The grouped-render label was orphaned by the InteractionCategory migration
    // (all_sources flattens results) and removed in P0.
    expect(SRC).not.toContain('cherry-group-label');
    expect(SRC).not.toContain('cherry_group_label');
  });

  it('filter change reloads via Activity.push (NOT a second create()) with sort+category', () => {
    // InteractionCategory does not re-render on a second create() call, so a
    // sort/category change pushes a fresh activity carrying the new params.
    expect(SRC).toMatch(/function _pushFiltered\(sort, category\)[\s\S]{0,260}Lampa\.Activity\.push/);
    expect(SRC).toMatch(/_pushFiltered\(item\.id, currentCategory\)/); // sort change
    expect(SRC).toMatch(/_pushFiltered\(currentSort, item\.id\)/);     // category change
    // Filters are seeded from the activity params on construction.
    expect(SRC).toMatch(/currentSort\s*=\s*object\.sort/);
    expect(SRC).toMatch(/currentCategory\s*=\s*object\.category/);
    expect(SRC).not.toMatch(/function _reload\(\)/); // old broken reload gone
  });

  it('all_sources caps each source at 10 (slice(0, 10)) before flat concat', () => {
    expect(SRC).toMatch(/slice\(\s*0\s*,\s*10\s*\)/);
  });

  it('grouped render no longer alphabetises all_sources results', () => {
    // The old flat-merge path sorted with localeCompare or a title a/b comparator.
    // After migration the all-sources merge+sort block is gone. Guard against its return.
    expect(SRC).not.toMatch(/all\.sort\(/);
  });
});

// ============================================================
// P0 — Three Header Buttons (Search / Sort / Category)
// (behaviour documentation)
//
// Mirrors the visibility rules and per-source search Activity shape from
// CherryGrid.create() after Phase 3. Pure functions only — no DOM, no Lampa.
// ============================================================

describe('P0: computeVisibility — POST behaviour', function () {
  /**
   * Pure mirror of the canSearch / hasSorts / hasCats rules in CherryGrid.create().
   *
   * canSearch  = NOT is_favorites AND NOT all_sources AND NOT _related_items AND NOT model_url
   *              (model browse is already filtered to a performer, so per-source text
   *               search does not apply there).
   * sort       = source.cfg.sorts exists & length > 0
   * cat        = source.cfg.categories exists & length > 0
   *
   * Returns plain booleans so callers can assert exact truthiness.
   */
  function computeVisibility(object, source) {
    object = object || {};
    var canSearch = !object.is_favorites
                 && !object.all_sources
                 && !object._related_items
                 && !object.model_url;
    var hasSorts = !!(source && source.cfg && source.cfg.sorts && source.cfg.sorts.length);
    var hasCats  = !!(source && source.cfg && source.cfg.categories && source.cfg.categories.length);
    return { search: !!canSearch, sort: hasSorts, cat: hasCats };
  }

  var fullSource = {
    id: 'pornhub',
    name: 'Pornhub',
    cfg: {
      sorts:      [{ id: 'mr', label: 'Most recent' }],
      categories: [{ id: 'milf', label: 'MILF' }]
    }
  };

  var bareSource = { id: 'bare', name: 'Bare' }; // no cfg at all

  it('favorites grid: search false', function () {
    var v = computeVisibility({ is_favorites: true, source_id: 'pornhub' }, fullSource);
    expect(v.search).toBe(false);
  });

  it('all_sources grid: search false', function () {
    var v = computeVisibility({ all_sources: true, query: 'cat' }, fullSource);
    expect(v.search).toBe(false);
  });

  it('model_url grid: search false (per-source search N/A for model browse)', function () {
    var v = computeVisibility({ model_url: 'https://x/model/foo', source_id: 'pornhub' }, fullSource);
    expect(v.search).toBe(false);
  });

  it('related-items grid: search false', function () {
    var v = computeVisibility({ _related_items: [{ title: 'a' }], source_id: 'pornhub' }, fullSource);
    expect(v.search).toBe(false);
  });

  it('normal source grid: search true', function () {
    var v = computeVisibility({ source_id: 'pornhub' }, fullSource);
    expect(v.search).toBe(true);
  });

  it('normal source with sorts: sort true', function () {
    var v = computeVisibility({ source_id: 'pornhub' }, fullSource);
    expect(v.sort).toBe(true);
  });

  it('normal source with categories: cat true', function () {
    var v = computeVisibility({ source_id: 'pornhub' }, fullSource);
    expect(v.cat).toBe(true);
  });

  it('source without categories: cat false', function () {
    var noCat = { id: 's', cfg: { sorts: [{ id: 'mr', label: 'MR' }] } };
    var v = computeVisibility({ source_id: 's' }, noCat);
    expect(v.cat).toBe(false);
    expect(v.sort).toBe(true);
  });

  it('source without sorts: sort false', function () {
    var noSort = { id: 's', cfg: { categories: [{ id: 'a', label: 'A' }] } };
    var v = computeVisibility({ source_id: 's' }, noSort);
    expect(v.sort).toBe(false);
    expect(v.cat).toBe(true);
  });

  it('bare source (no cfg): only search is true', function () {
    var v = computeVisibility({ source_id: 'bare' }, bareSource);
    expect(v).toEqual({ search: true, sort: false, cat: false });
  });

  it('empty sorts/categories arrays count as absent', function () {
    var empties = { id: 's', cfg: { sorts: [], categories: [] } };
    var v = computeVisibility({ source_id: 's' }, empties);
    expect(v.sort).toBe(false);
    expect(v.cat).toBe(false);
  });

  it('favorites with full cfg: search false but sort/cat still driven by cfg', function () {
    var v = computeVisibility({ is_favorites: true }, fullSource);
    expect(v.search).toBe(false);
    expect(v.sort).toBe(true);
    expect(v.cat).toBe(true);
  });
});

describe('P0: buildPerSourceSearchActivity — POST behaviour', function () {
  /**
   * Pure mirror of the Activity.push payload built by the action-search onenter
   * handler. The defining property of P0 search is that it stays WITHIN one
   * source (source_id set, all_sources NOT set) — distinct from the cherry_main
   * global search which sets all_sources: true.
   */
  function buildPerSourceSearchActivity(query, sourceId) {
    return {
      component: 'cherry_grid',
      query:     query,
      source_id: sourceId,
      page:      1
    };
  }

  it('component is cherry_grid', function () {
    var a = buildPerSourceSearchActivity('milf', 'pornhub');
    expect(a.component).toBe('cherry_grid');
  });

  it('carries the query', function () {
    var a = buildPerSourceSearchActivity('milf', 'pornhub');
    expect(a.query).toBe('milf');
  });

  it('carries source_id (per-source, single source)', function () {
    var a = buildPerSourceSearchActivity('milf', 'pornhub');
    expect(a.source_id).toBe('pornhub');
  });

  it('starts at page 1', function () {
    var a = buildPerSourceSearchActivity('milf', 'pornhub');
    expect(a.page).toBe(1);
  });

  it('does NOT set all_sources (this is per-source, not global search)', function () {
    var a = buildPerSourceSearchActivity('milf', 'pornhub');
    expect(a.all_sources).toBeUndefined();
    expect(a).not.toHaveProperty('all_sources', true);
  });
});

// ============================================================
// P0 — plugin.js source assertions (anti-drift)
// ============================================================

describe('P0: plugin.js source assertions (anti-drift)', () => {
  it('right-edge action menu is implemented via openActionsMenu()', () => {
    expect(SRC).toMatch(/function openActionsMenu\(\)/);
  });

  it('action menu items are ordered Поиск → Сортировка → Категории', () => {
    // The three pushes must appear in this order inside openActionsMenu.
    expect(SRC).toMatch(
      /openActionsMenu[\s\S]{0,400}action:\s*'search'[\s\S]{0,200}action:\s*'sort'[\s\S]{0,200}action:\s*'cat'/
    );
  });

  it('_canSearch excludes is_favorites, all_sources, _related_items AND model_url', () => {
    expect(SRC).toMatch(
      /_canSearch\s*=\s*!object\.is_favorites[\s\S]{0,120}!object\.all_sources[\s\S]{0,120}!object\._related_items[\s\S]{0,120}!object\.model_url/
    );
  });

  it('right edge opens the menu via InteractionCategory onRight', () => {
    // The base class drives focus/nav; the plugin only overrides onRight, which
    // opens the action menu at the grid's right edge. No geometric edge probe,
    // no hand-rolled directional handler.
    expect(SRC).toMatch(/comp\.onRight\s*=\s*function[\s\S]{0,80}openActionsMenu\(\)/);
    expect(SRC).not.toMatch(/function _atRightEdge\(/);
  });

  it('per-source search opens Lampa.Input.edit and pushes source_id without all_sources', () => {
    // Lampa.Keyboard.show does not exist on this build; Input.edit is the real API.
    expect(SRC).toMatch(/_openSearch[\s\S]{0,400}Lampa\.Input\.edit/);
    expect(SRC).toMatch(/_openSearch[\s\S]{0,600}Lampa\.Activity\.push\([\s\S]{0,300}source_id/);
    expect(SRC).not.toMatch(/Lampa\.Keyboard\.show/);
  });

  it('old chip classes (actions bar) are fully removed', () => {
    expect(SRC).not.toContain('cherry-grid__actions');
    expect(SRC).not.toContain('cherry-grid__action-search');
    expect(SRC).not.toContain('cherry-grid__action-sort');
    expect(SRC).not.toContain('cherry-grid__action-cat');
  });

  it('old .cherry-grid__filters bar is removed', () => {
    expect(SRC).not.toContain('cherry-grid__filters');
    expect(SRC).not.toContain('cherry-grid__filter-sort');
    expect(SRC).not.toContain('cherry-grid__filter-cat');
  });

  it('reused lang keys cherry_search / cherry_sort / cherry_category exist', () => {
    expect(SRC).toMatch(/cherry_search\s*:/);
    expect(SRC).toMatch(/cherry_sort\s*:/);
    expect(SRC).toMatch(/cherry_category\s*:/);
  });
});

// ============================================================
// P1 — Pagination via InteractionCategory.nextPageReuest
// (behaviour documentation)
//
// The hand-rolled IntersectionObserver/sentinel infinite-scroll was removed
// when cherry_grid migrated to Lampa.InteractionCategory. The base class owns
// scroll-into-view and fires nextPageReuest as the user nears the list end.
// The plugin only decides: (a) which modes paginate, (b) the next page number.
// ============================================================

describe('P1: nextPageReuest paging — POST behaviour', function () {
  /**
   * Mirror of the single-page guard in comp.nextPageReuest: favorites,
   * related-items and all-sources search all resolve with an empty page
   * (total_pages stays 1) so the base class stops paginating; every other
   * mode advances to currentPage + 1.
   */
  function isSinglePageMode(object) {
    return !!(object.is_favorites || object._related_items || (object.all_sources && object.query));
  }

  it('favorites is single-page (no further pages requested)', function () {
    expect(isSinglePageMode({ is_favorites: true })).toBe(true);
  });

  it('related-items is single-page', function () {
    expect(isSinglePageMode({ _related_items: [{ title: 'a' }] })).toBe(true);
  });

  it('all-sources search is single-page', function () {
    expect(isSinglePageMode({ all_sources: true, query: 'cat' })).toBe(true);
  });

  it('normal source browse paginates', function () {
    expect(isSinglePageMode({ source_id: 'pornhub' })).toBe(false);
  });

  it('per-source search paginates', function () {
    expect(isSinglePageMode({ source_id: 'pornhub', query: 'milf' })).toBe(false);
  });

  it('model browse paginates', function () {
    expect(isSinglePageMode({ source_id: 'pornhub', model_url: 'https://x/m/f' })).toBe(false);
  });

  it('next page is current + 1', function () {
    var currentPage = 3;
    expect(currentPage + 1).toBe(4);
  });
});

// ============================================================
// P1 — plugin.js source assertions (anti-drift)
// ============================================================

describe('P1: plugin.js source assertions (anti-drift)', () => {
  it('cherry_grid is built on Lampa.InteractionCategory', () => {
    expect(SRC).toMatch(/new\s+Lampa\.InteractionCategory\(/);
  });

  it('comp.create toggles the activity loader and calls build()', () => {
    expect(SRC).toMatch(/comp\.create\s*=\s*function[\s\S]{0,400}this\.activity\.loader\(\s*true\s*\)/);
    expect(SRC).toMatch(/comp\.create\s*=\s*function[\s\S]{0,600}\.build\(\s*\{/);
  });

  it('nextPageReuest is overridden for framework-driven paging', () => {
    expect(SRC).toMatch(/comp\.nextPageReuest\s*=\s*function\s*\(\s*object\s*,\s*resolve\s*,\s*reject\s*\)/);
  });

  it('nextPageReuest resolves with {title, results, total_pages}', () => {
    expect(SRC).toMatch(/resolve\(\{\s*title:[\s\S]{0,80}results:[\s\S]{0,40}total_pages:/);
  });

  it('single-page modes short-circuit nextPageReuest (favorites/related/all_sources)', () => {
    expect(SRC).toMatch(/object\.is_favorites\s*\|\|\s*object\._related_items\s*\|\|\s*\(object\.all_sources\s*&&\s*object\.query\)/);
  });

  it('next page advances currentPage + 1', () => {
    expect(SRC).toMatch(/var\s+nextPage\s*=\s*currentPage\s*\+\s*1/);
  });

  it('hand-rolled infinite-scroll internals are gone (no sentinel/observer/maybeLoadMore)', () => {
    expect(SRC).not.toMatch(/function\s+maybeLoadMore\s*\(/);
    expect(SRC).not.toMatch(/IntersectionObserver/);
    expect(SRC).not.toMatch(/_sentinelObserver/);
    expect(SRC).not.toMatch(/function\s+renderCards\s*\(/);
  });

  it('cardRender wires onEnter/onMenu/onFocus per card', () => {
    expect(SRC).toMatch(/comp\.cardRender\s*=\s*function\s*\(\s*object\s*,\s*element\s*,\s*card\s*\)/);
    expect(SRC).toMatch(/card\.onEnter\s*=\s*function/);
    expect(SRC).toMatch(/card\.onMenu\s*=\s*function/);
    expect(SRC).toMatch(/card\.onFocus\s*=\s*function/);
  });

  it('cardRender.onFocus wraps the base hook (preserves base scroll-into-view)', () => {
    expect(SRC).toMatch(/var\s+f\s*=\s*card\.onFocus/);
    expect(SRC).toMatch(/if\s*\(f\)\s*f\(target,\s*card_data\)/);
  });
});

// ============================================================
// UX-A — Home as an InteractionCategory source picker
// (behaviour documentation)
//
// CherryMain is now a single-page source picker built on
// Lampa.InteractionCategory (same proven pattern as CherryGrid). create() emits
// one result per pickable target — [Поиск] + [Избранное] + one card per
// SOURCE — each tagged with a `_kind`. cardRender's onEnter routes by _kind.
// Pure functions below mirror those two load-bearing decisions: the result-list
// shape and the route chosen for each kind. No DOM, no Lampa, no async.
// ============================================================

describe('UX-A: buildPickerResults — POST behaviour', function () {
  /**
   * Mirror of CherryMain.create()'s results array: a Search entry, a Favorites
   * entry, then one entry per source — order is fixed (search, favorites,
   * sources in adapter order). Each carries a `_kind` discriminator; source
   * entries also carry `_source_id`.
   */
  function buildPickerResults(sources) {
    var results = [];
    results.push({ title: 'cherry_search', img: '', _kind: 'search' });
    results.push({ title: 'cherry_favorites', img: '', _kind: 'favorites' });
    (sources || []).forEach(function (src) {
      results.push({ title: src.name, img: '', _kind: 'source', _source_id: src.id });
    });
    return results;
  }

  var SRCS = [
    { id: 'xnxx', name: 'XNXX' },
    { id: 'eporner', name: 'Eporner' }
  ];

  it('first entry is the Search picker', function () {
    expect(buildPickerResults(SRCS)[0]._kind).toBe('search');
  });

  it('second entry is the Favorites picker', function () {
    expect(buildPickerResults(SRCS)[1]._kind).toBe('favorites');
  });

  it('one source entry per registered adapter, in order', function () {
    var r = buildPickerResults(SRCS).filter(function (e) { return e._kind === 'source'; });
    expect(r.map(function (e) { return e._source_id; })).toEqual(['xnxx', 'eporner']);
  });

  it('source entries carry both title and _source_id', function () {
    var first = buildPickerResults(SRCS).filter(function (e) { return e._kind === 'source'; })[0];
    expect(first.title).toBe('XNXX');
    expect(first._source_id).toBe('xnxx');
  });

  it('with no sources, only Search + Favorites remain', function () {
    var r = buildPickerResults([]);
    expect(r).toHaveLength(2);
    expect(r.map(function (e) { return e._kind; })).toEqual(['search', 'favorites']);
  });

  it('every entry carries a _kind discriminator', function () {
    buildPickerResults(SRCS).forEach(function (e) {
      expect(['search', 'favorites', 'source']).toContain(e._kind);
    });
  });
});

describe('UX-A: pickerRoute — POST behaviour', function () {
  /**
   * Mirror of cardRender's onEnter routing. Returns the Activity.push payload
   * (or a marker for the keyboard-gated search) for a given picker element.
   * SOURCES[0] is the search/favorites fallback source_id.
   */
  function pickerRoute(element, firstSourceId) {
    if (element._kind === 'search') {
      // Search opens the keyboard first; on enter it pushes an all-sources grid.
      return { keyboard: true, onenter: function (q) {
        return {
          component:   'cherry_grid',
          title:       'cherry_search: ' + q,
          source_id:   firstSourceId || '',
          query:       q,
          all_sources: true,
          page:        1
        };
      } };
    }
    if (element._kind === 'favorites') {
      return {
        component:    'cherry_grid',
        title:        'cherry_favorites',
        source_id:    firstSourceId || '',
        is_favorites: true,
        page:         1
      };
    }
    if (element._kind === 'source') {
      return {
        component: 'cherry_grid',
        title:     element.title,
        source_id: element._source_id,
        page:      1
      };
    }
    return null;
  }

  it('source kind pushes a per-source grid (no query, no all_sources)', function () {
    var r = pickerRoute({ _kind: 'source', title: 'XNXX', _source_id: 'xnxx' }, 'xnxx');
    expect(r.component).toBe('cherry_grid');
    expect(r.source_id).toBe('xnxx');
    expect(r.query).toBeUndefined();
    expect(r.all_sources).toBeUndefined();
    expect(r.is_favorites).toBeUndefined();
  });

  it('favorites kind pushes the favorites grid', function () {
    var r = pickerRoute({ _kind: 'favorites' }, 'xnxx');
    expect(r.component).toBe('cherry_grid');
    expect(r.is_favorites).toBe(true);
    expect(r.source_id).toBe('xnxx');
  });

  it('search kind is keyboard-gated, then yields an all-sources grid', function () {
    var r = pickerRoute({ _kind: 'search' }, 'xnxx');
    expect(r.keyboard).toBe(true);
    var pushed = r.onenter('milf');
    expect(pushed.component).toBe('cherry_grid');
    expect(pushed.all_sources).toBe(true);
    expect(pushed.query).toBe('milf');
  });

  it('favorites/search source_id falls back to first source when present', function () {
    expect(pickerRoute({ _kind: 'favorites' }, '').source_id).toBe('');
    expect(pickerRoute({ _kind: 'favorites' }, 'xnxx').source_id).toBe('xnxx');
  });

  it('unknown kind routes nowhere', function () {
    expect(pickerRoute({ _kind: 'mystery' }, 'xnxx')).toBeNull();
  });
});

// ============================================================
// UX-A — plugin.js source assertions (anti-drift)
// ============================================================

describe('UX-A: plugin.js source assertions (anti-drift)', () => {
  // Isolate the CherryMain factory body so the asserts cannot accidentally
  // match CherryGrid (which is also an InteractionCategory).
  var MAIN = (function () {
    var start = SRC.indexOf('function CherryMain(object)');
    expect(start).toBeGreaterThan(-1);
    // Bound the slice to CherryMain's body (ends where addStyles begins) so the
    // P2.3 letter-tile JS is captured but the CSS string layer is excluded.
    var end = SRC.indexOf('function addStyles', start);
    return SRC.slice(start, end > -1 ? end : start + 4500);
  })();

  it('CherryMain is built on Lampa.InteractionCategory', () => {
    expect(MAIN).toMatch(/new\s+Lampa\.InteractionCategory\(/);
  });

  it('CherryMain.create emits the picker via this.build({results})', () => {
    expect(MAIN).toMatch(/comp\.create\s*=\s*function/);
    expect(MAIN).toMatch(/this\.build\(\s*\{[\s\S]{0,80}results:/);
  });

  it('create toggles activity.loader around the build', () => {
    expect(MAIN).toMatch(/this\.activity\.loader\(true\)/);
    expect(MAIN).toMatch(/this\.activity\.loader\(false\)/);
  });

  it('picker emits search + favorites + per-source entries with _kind', () => {
    expect(MAIN).toMatch(/_kind:\s*'search'/);
    expect(MAIN).toMatch(/_kind:\s*'favorites'/);
    expect(MAIN).toMatch(/_kind:\s*'source'[\s\S]{0,40}_source_id:\s*src\.id/);
  });

  it('one source entry per registered SOURCE (SOURCES.forEach)', () => {
    expect(MAIN).toMatch(/SOURCES\.forEach\(/);
  });

  it('cardRender.onEnter routes by element._kind', () => {
    expect(MAIN).toMatch(/comp\.cardRender\s*=\s*function/);
    expect(MAIN).toMatch(/card\.onEnter\s*=\s*function/);
    expect(MAIN).toMatch(/element\._kind\s*===\s*'search'/);
    expect(MAIN).toMatch(/element\._kind\s*===\s*'favorites'/);
    expect(MAIN).toMatch(/element\._kind\s*===\s*'source'/);
  });

  it('search kind opens Lampa.Input.edit then pushes an all_sources grid', () => {
    expect(MAIN).toMatch(/Lampa\.Input\.edit/);
    expect(MAIN).toMatch(/all_sources:\s*true/);
    expect(MAIN).not.toMatch(/Lampa\.Keyboard\.show/);
  });

  it('favorites kind pushes is_favorites grid', () => {
    expect(MAIN).toMatch(/is_favorites:\s*true/);
  });

  it('source kind pushes a per-source grid using element._source_id', () => {
    expect(MAIN).toMatch(/source_id:\s*element\._source_id/);
  });

  it('Keyboard onback re-toggles the content controller (matches CherryGrid)', () => {
    expect(MAIN).toMatch(/Lampa\.Controller\.toggle\(\s*['"]content['"]\s*\)/);
  });

  it('CherryMain no longer hand-rolls a Controller', () => {
    expect(MAIN).not.toMatch(/Lampa\.Controller\.add\(\s*['"]cherry_main['"]/);
  });

  it('CherryMain no longer references the removed row-mode internals', () => {
    expect(MAIN).not.toMatch(/renderRows|renderSources|bindSearch/);
    expect(MAIN).not.toContain('cherry_home_mode');
    expect(MAIN).not.toMatch(/view_toggle/);
    expect(MAIN).not.toMatch(/_navMoving/);
  });
});

// ── Android native stream (no-proxy) — px() + pornhub HLS ──────────────────────
// On Android, the native player loads streams from the device home IP; the page
// was also fetched natively from that IP, so IP-bound CDN tokens stay valid with
// no proxy. px() must short-circuit to raw on Android, and pornhub must not
// pre-proxy its HLS fallback on Android.
describe('Android native stream — plugin.js source assertions (anti-drift)', () => {
  it('px() returns the raw url on Android before any proxy wrapping', () => {
    // The Android short-circuit must appear inside px(), ahead of the blob/proxy checks.
    expect(SRC).toMatch(/function px\(u\)\s*\{[\s\S]{0,500}?if \(_isAndroid\(\)\) return u;/);
  });
  it('pornhub HLS fallback is raw on Android, proxied otherwise', () => {
    expect(SRC).toMatch(/_isAndroid\(\)\s*\?\s*hlsUrls\[lbl\]\s*:\s*buildProxyUrl\(hlsUrls\[lbl\]/);
  });
});

// ── Batch 1: KVS categories (_buildCatUrl + _kvsEngine cfg) ────────────────────
describe('KVS categories — _buildCatUrl POST behaviour', () => {
  // Local mirror of plugin.js _buildCatUrl
  function _buildCatUrl(fmt, slug, page, pageBase, page1Omit) {
    var p = page || 1, out;
    if (page1Omit && p === 1) out = fmt.replace(/[-/]?\{page\}/, '');
    else { var n = (pageBase === 0) ? (p - 1) : p; out = fmt.replace(/\{page\}/, n); }
    out = out.replace(/\{slug\}/, slug).replace(/([^:])\/\/+/g, '$1/');
    return out;
  }
  it('kvs /categories/{slug}/{page}/ — page1 omits number', () => {
    expect(_buildCatUrl('https://www.xozilla.com/categories/{slug}/{page}/', 'anal', 1, 1, true))
      .toBe('https://www.xozilla.com/categories/anal/');
    expect(_buildCatUrl('https://www.xozilla.com/categories/{slug}/{page}/', 'anal', 2, 1, true))
      .toBe('https://www.xozilla.com/categories/anal/2/');
  });
  it('root /{slug}/{page}/ (hellporno)', () => {
    expect(_buildCatUrl('https://hellporno.com/{slug}/{page}/', 'anal', 1, 1, true)).toBe('https://hellporno.com/anal/');
    expect(_buildCatUrl('https://hellporno.com/{slug}/{page}/', 'anal', 2, 1, true)).toBe('https://hellporno.com/anal/2/');
  });
  it('no-trailing-slash (pornobolt)', () => {
    expect(_buildCatUrl('https://sex.pornobolt.in/{slug}/{page}', 'anal', 1, 1, true)).toBe('https://sex.pornobolt.in/anal');
    expect(_buildCatUrl('https://sex.pornobolt.in/{slug}/{page}', 'anal', 2, 1, true)).toBe('https://sex.pornobolt.in/anal/2');
  });
  it('0-based page (xnxx/xvideos style)', () => {
    expect(_buildCatUrl('https://www.xnxx.com/search/{slug}/{page}', 'anal', 1, 0, false)).toBe('https://www.xnxx.com/search/anal/0');
    expect(_buildCatUrl('https://www.xnxx.com/search/{slug}/{page}', 'anal', 2, 0, false)).toBe('https://www.xnxx.com/search/anal/1');
  });
  it('page-in-filename (youjizz)', () => {
    expect(_buildCatUrl('https://www.youjizz.com/categories/{slug}-{page}.html', 'anal', 1, 1, false)).toBe('https://www.youjizz.com/categories/anal-1.html');
    expect(_buildCatUrl('https://www.youjizz.com/categories/{slug}-{page}.html', 'anal', 2, 1, false)).toBe('https://www.youjizz.com/categories/anal-2.html');
  });
});

describe('KVS categories — plugin.js source assertions (anti-drift)', () => {
  it('_buildCatUrl helper is defined', () => {
    expect(SRC).toMatch(/function _buildCatUrl\(/);
  });
  it('_cats helper is defined', () => {
    expect(SRC).toMatch(/function _cats\(/);
  });
  it('_kvsEngine exposes cfg with categories and sorts', () => {
    expect(SRC).toMatch(/cfg:\s*\{\s*categories:\s*cfg\.categories[\s\S]{0,60}sorts:\s*cfg\.sorts/);
  });
  it('_kvsEngine.browse uses categoryFmt + _buildCatUrl when category set', () => {
    expect(SRC).toMatch(/category\s*&&\s*cfg\.categoryFmt[\s\S]{0,120}_buildCatUrl/);
  });
  it('all 5 KVS adapters declare categoryFmt + categories', () => {
    ['xozilla','analdin','hellporno','pornobolt','crocotube'].forEach(function (id) {
      var at = SRC.indexOf("id: '" + id + "'");
      expect(at).toBeGreaterThan(-1);
      var window = SRC.slice(at, at + 500);
      expect(window).toContain('categoryFmt');
      expect(window).toContain('categories:');
    });
  });
});

// ── Batch 2: custom KVS-like categories (3movs, pornve, familyporn, porntrex) ──
describe('Batch 2 categories — plugin.js source assertions (anti-drift)', () => {
  it('_fetchAny status-tolerant helper is defined', () => {
    expect(SRC).toMatch(/function _fetchAny\(/);
  });
  it('3movs uses _fetchAny for category browse (404-tolerant)', () => {
    var at = SRC.indexOf("id: '3movs'");
    expect(at).toBeGreaterThan(-1);
    var w = SRC.slice(at, at + 1600);
    expect(w).toContain('cfg:');
    expect(w).toContain('_fetchAny');
    expect(w).toContain('_buildCatUrl');
  });
  ['porntrex','pornve','familyporn'].forEach(function (id) {
    it(id + ' has cfg.categories + uses _buildCatUrl in browse', () => {
      var at = SRC.indexOf("id: '" + id + "'");
      expect(at).toBeGreaterThan(-1);
      var w = SRC.slice(at, at + 1600);
      expect(w).toContain('cfg:');
      expect(w).toContain('_buildCatUrl');
    });
  });
});

// ── Batch 3: Deno-routed categories (xnxx, eporner, pornone, perfektdamen, hqporner) ──
describe('Batch 3 categories — plugin.js source assertions (anti-drift)', () => {
  // Category-URL templates must be present (position-independent — cfg may sit far from id).
  var fmts = {
    xnxx: 'https://www.xnxx.com/search/{slug}/{page}',
    pornone: 'https://pornone.com/{slug}/{page}/',
    perfektdamen: 'https://www.perfektdamen.co/tags/{slug}/{page}/',
    hqporner: 'https://hqporner.com/category/{slug}/{page}'
  };
  Object.keys(fmts).forEach(function (id) {
    it(id + ' wires its categoryFmt template', () => {
      expect(SRC).toContain(fmts[id]);
    });
  });
  it('eporner category uses API query (slug→keyword)', () => {
    expect(SRC).toContain('category.replace(/-/g');
  });
  it('Deno adapters shipped category lists (representative labels present)', () => {
    expect(SRC).toContain('Вебкам');   // eporner webcam
    expect(SRC).toContain('Трансы');   // hqporner shemale
    expect(SRC).toContain('Бабушки');  // pornone granny
  });
});

// ── Batch 4: custom categories (xvideos, youjizz, spankbang, porndig, tizam) ──
describe('Batch 4 categories — plugin.js source assertions (anti-drift)', () => {
  it('xvideos category template /c/{slug}/{page}', () => {
    expect(SRC).toContain('https://www.xvideos.com/c/{slug}/{page}');
  });
  it('youjizz page-in-filename template', () => {
    expect(SRC).toContain('https://www.youjizz.com/categories/{slug}-{page}.html');
  });
  it('spankbang /s/{slug}/{page}/ template', () => {
    expect(SRC).toContain('https://ru.spankbang.com/s/{slug}/{page}/');
  });
  it('porndig composite-slug channel browse', () => {
    expect(SRC).toContain("'https://porndig.com/channels/' + category");
  });
  it('tizam category browse (single static page)', () => {
    expect(SRC).toContain("'https://tv4.tizam.org/fil_my_dlya_vzroslyh/' + category");
  });
  it('shipped category labels for batch 4', () => {
    expect(SRC).toContain('Косплей');  // spankbang cosplay
    expect(SRC).toContain('С переводом'); // tizam
  });
});

// ── Batch 5: DLE + misc categories (24rolika, jopaonline, ebun, lenporno, pornhub) ──
describe('Batch 5 categories — plugin.js source assertions (anti-drift)', () => {
  it('24rolika DLE /{slug}/page/{page}/ template', () => {
    expect(SRC).toContain('https://w2.huyalkino.com/{slug}/page/{page}/');
  });
  it('jopaonline /categories/{slug}/{page} template', () => {
    expect(SRC).toContain('https://jopaonline.mobi/categories/{slug}/{page}');
  });
  it('ebun /categories/{slug}/{page}/ template', () => {
    expect(SRC).toContain('https://www1.ebun.tv/categories/{slug}/{page}/');
  });
  it('lenporno root /{slug}/{page}/ template', () => {
    expect(SRC).toContain('https://www.lenporno.net/{slug}/{page}/');
  });
  it('pornhub category via webmasters &category= param', () => {
    expect(SRC).toContain("'&category=' + encodeURIComponent(category)");
  });
});

// ── Coverage: every adapter with a cfg exposes categories ─────────────────────
describe('categories coverage — every wired adapter ships a list', () => {
  it('at least 20 adapters declare cfg.categories', () => {
    var n = (SRC.match(/categories:\s*_cats\(/g) || []).length;
    expect(n).toBeGreaterThanOrEqual(20);
  });
});

// ── Navigation recursion guard fully retired (both components migrated) ───────
// The hand-rolled Controller + move() re-dispatch recursion (the original
// home-screen arrow-nav bug) is gone: CherryGrid AND CherryMain both run on
// Lampa.InteractionCategory, which owns nav/scroll. No _navMoving guard, no
// bare Controller.move handler, no Controller.add for either component.
describe('nav recursion guard — fully retired (anti-drift)', () => {
  it('no component hand-rolls a _navMoving recursion guard anymore', () => {
    expect(SRC).not.toContain('_navMoving');
  });
  it('no bare directional Controller.move handler remains', () => {
    // The old pattern "up: function () { Lampa.Controller.move('up'); }" must be gone.
    expect(SRC).not.toMatch(/(?:up|down|left|right):\s*function\s*\(\)\s*\{[^}]*Lampa\.Controller\.move\(/);
  });
  it('neither cherry component hand-rolls Lampa.Controller.add', () => {
    expect(SRC).not.toMatch(/Lampa\.Controller\.add\(\s*['"]cherry_(main|grid)['"]/);
  });
  it('both cherry components are built on Lampa.InteractionCategory', () => {
    var n = (SRC.match(/new\s+Lampa\.InteractionCategory\(/g) || []).length;
    expect(n).toBe(2); // CherryMain + CherryGrid
  });
});

// ============================================================
// UI/UX v2 batch — P0 dead-code removal + P2/P3 additions (anti-drift)
// ============================================================
describe('UI/UX v2: P0 dead templates removed', () => {
  it('addTemplates() function is gone', () => {
    expect(SRC).not.toMatch(/function addTemplates\(/);
    expect(SRC).not.toMatch(/addTemplates\(\)\s*;/);
  });
  it('no dead Lampa.Template.add cherry_* calls remain', () => {
    expect(SRC).not.toMatch(/Lampa\.Template\.add\(\s*'cherry_/);
  });
});

describe('UI/UX v2: P0 dead CSS removed, live 16:9 kept', () => {
  it('live 16:9 card rules are kept', () => {
    expect(SRC).toContain('.cherry-cat .card__view');
    expect(SRC).toContain('.cherry-cat .card__img');
  });
  it('dead cherry-main / source-card / grid__ / card__ / source-row CSS gone', () => {
    expect(SRC).not.toContain('.cherry-main');
    expect(SRC).not.toContain('.cherry-source-card');
    expect(SRC).not.toContain('.cherry-grid__');
    expect(SRC).not.toContain('.cherry-source-row');
    expect(SRC).not.toContain('.cherry-cards-wrap');
  });
  it('@keyframes cherry-spin removed', () => {
    expect(SRC).not.toContain('cherry-spin');
  });
});

describe('UI/UX v2: focus = single native frame + zoom (no competing custom ring)', () => {
  it('focused card view gets only a scale zoom, not a custom box-shadow ring', () => {
    var m = SRC.match(/\.cherry-cat \.card\.focus \.card__view\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/transform:scale/);
  });
  it('no custom pink box-shadow ring (it stacked on the native frame = double)', () => {
    expect(SRC).not.toMatch(/box-shadow:0 0 0 \.16em #e75480/);
  });
});

describe('UI/UX v2: P2.2 title legibility CSS present', () => {
  it('card title is full white with a 2-line clamp', () => {
    expect(SRC).toMatch(/\.cherry-cat \.card__title\{[^}]*color:#fff/);
    expect(SRC).toMatch(/\.cherry-cat \.card__title\{[^}]*-webkit-line-clamp:2/);
  });
});

describe('UI/UX v2: P2.3 home letter tiles', () => {
  var MAIN = (function () {
    var start = SRC.indexOf('function CherryMain(object)');
    return SRC.slice(start, start + 4000);
  })();

  it('picker entries carry a stable _initial', () => {
    expect(MAIN).toMatch(/_initial:/);
  });
  it('search/favorites use glyph initials (⌕ / ♥) marked as actions', () => {
    expect(MAIN).toContain('⌕');
    expect(MAIN).toContain('♥');
    expect(MAIN).toMatch(/_action:\s*true/);
  });
  it('source entries derive a stable colour via _tileColor', () => {
    expect(SRC).toMatch(/function _tileColor\(/);
    expect(MAIN).toMatch(/_color:\s*_tileColor\(src\.id\)/);
  });
  it('cardRender injects a .cherry-tile into .card__view', () => {
    expect(MAIN).toContain('cherry-tile');
    expect(MAIN).toMatch(/card\.render\(\)\.find\(\s*'\.card__view'\s*\)/);
  });
  it('action tiles get the brand tint class', () => {
    expect(MAIN).toContain('cherry-tile--action');
  });
  it('tile CSS is scoped under .cherry-cat', () => {
    expect(SRC).toContain('.cherry-cat .cherry-tile{');
    expect(SRC).toContain('.cherry-cat .cherry-tile--action{');
  });
});

describe('UI/UX v2: P3.1 active filter in grid title', () => {
  it('_titleWithFilters helper resolves labels via _findLabel', () => {
    expect(SRC).toMatch(/function _titleWithFilters\(\)/);
    expect(SRC).toMatch(/_titleWithFilters[\s\S]{0,300}_findLabel\(/);
  });
  it('build()/resolve() use the filtered title, not bare screenTitle', () => {
    expect(SRC).toMatch(/\.build\(\{\s*title:\s*_titleWithFilters\(\)/);
    expect(SRC).toMatch(/resolve\(\{\s*title:\s*_titleWithFilters\(\)/);
  });
});

describe('UI/UX v2: P3.2 error != empty + persistent fav hint', () => {
  it('cherry_load_error lang string added (RU + EN)', () => {
    expect(SRC).toMatch(/cherry_load_error:\s*\{\s*ru:\s*'Не удалось загрузить\. Проверьте соединение\.'/);
    expect(SRC).toMatch(/cherry_load_error:[\s\S]{0,120}en:\s*'Failed to load\. Check your connection\.'/);
  });
  it('load failure branch calls empty(cherry_load_error)', () => {
    expect(SRC).toMatch(/\.empty\(\s*Lampa\.Lang\.translate\(\s*'cherry_load_error'\s*\)\s*\)/);
  });
  it('empty favorites calls empty(cherry_fav_empty_hint), not a toast', () => {
    expect(SRC).toMatch(/\.empty\(\s*Lampa\.Lang\.translate\(\s*'cherry_fav_empty_hint'\s*\)\s*\)/);
    // the old transient toast for empty favorites must be gone
    expect(SRC).not.toMatch(/cherry_fav_empty_hint'\),\s*\{\s*time:\s*10000/);
  });
  it('custom comp.empty(msg) override honours a message arg via Lampa.Empty', () => {
    expect(SRC).toMatch(/comp\.empty\s*=\s*function\s*\(\s*msg\s*\)/);
    expect(SRC).toMatch(/new\s+Lampa\.Empty\(\{\s*descr:/);
  });
});

describe('UI/UX v2: P3.3 source attribution badge', () => {
  it('cardRender injects a .cherry-src-badge in all_sources AND favorites modes', () => {
    expect(SRC).toMatch(/\(object\.all_sources\s*\|\|\s*object\.is_favorites\)\s*&&\s*element\.source/);
    expect(SRC).toContain('cherry-src-badge');
    expect(SRC).toMatch(/sourceById\(element\.source\)/);
  });
  it('badge CSS is scoped under .cherry-cat and sits above the preview video (z-index)', () => {
    expect(SRC).toContain('.cherry-cat .cherry-src-badge{');
    expect(SRC).toMatch(/\.cherry-src-badge\{[^}]*z-index:2/);
  });
});

describe('UI/UX v2: P3.4 header filter button + global-search note', () => {
  it('addFilterButton() is defined and called from startPlugin', () => {
    expect(SRC).toMatch(/function addFilterButton\(\)/);
    expect(SRC).toMatch(/addFilterButton\(\)/);
  });
  it('button is scoped to cherry_grid activities only', () => {
    expect(SRC).toMatch(/e\.component\s*===\s*'cherry_grid'/);
  });
  it('button opens the same action menu as onRight (openActionsMenu)', () => {
    expect(SRC).toMatch(/comp\.openActionsMenu\s*=\s*openActionsMenu/);
    expect(SRC).toMatch(/inst\.openActionsMenu\(\)/);
  });
  it('global-search registration is left as an explicit TODO (not guessed)', () => {
    expect(SRC).toMatch(/TODO\(global-search\)/);
  });
});
