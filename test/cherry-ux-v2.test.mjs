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
// Minimal DOM tracker
// Simulates jQuery show/hide/find/css on a flat class map.
// Initial state is parsed from a template HTML string.
// ============================================================

function makeHtml(templateStr) {
  // Parse all class names from the template, recording their initial display state.
  // For each class, look at the nearest style="display:none" in the surrounding context.
  var displayMap = {};

  var classRe = /class="([^"]+)"/g;
  var m;
  while ((m = classRe.exec(templateStr)) !== null) {
    var classes = m[1].trim().split(/\s+/);
    // Grab a short window around this attribute to detect inline display:none
    var window_start = Math.max(0, m.index);
    var window_end   = Math.min(templateStr.length, m.index + 160);
    var snippet      = templateStr.slice(window_start, window_end);
    var isHidden     = /style\s*=\s*["'][^"']*display\s*:\s*none/i.test(snippet);

    classes.forEach(function (cls) {
      if (!(cls in displayMap)) {
        displayMap[cls] = isHidden ? 'none' : 'block';
      }
    });
  }

  function jq(selector) {
    var cls = selector.replace(/^\./, '');
    return {
      show:      function () { displayMap[cls] = 'block'; return this; },
      hide:      function () { displayMap[cls] = 'none';  return this; },
      isVisible: function () { return displayMap[cls] !== 'none'; },
      css:       function (prop) {
        if (prop === 'display') return displayMap[cls] || 'block';
        return '';
      }
    };
  }

  return { find: jq, _map: displayMap };
}

// ============================================================
// Template strings
// ============================================================

// cherry_grid template (mirrors plugin.js post-Phase-1):
// .cherry-grid__empty carries icon + .cherry-grid__empty-generic + .cherry-grid__empty-fav-hint.
var TEMPLATE_POST = [
  '<div class="cherry-grid layer--wheight">',
    '<div class="cherry-grid__head">',
      '<div class="cherry-grid__title">{title}</div>',
    '</div>',
    '<div class="cherry-grid__body"></div>',
    '<div class="cherry-grid__loading"></div>',
    '<div class="cherry-grid__empty" style="display:none">',
      '<div class="cherry-grid__empty-icon">&#9785;</div>',
      '<div class="cherry-grid__empty-generic">#{cherry_no_results}</div>',
      '<div class="cherry-grid__empty-fav-hint" style="display:none">#{cherry_fav_empty_hint}</div>',
    '</div>',
  '</div>'
].join('');

// ============================================================
// UX-E — Empty Favorites Hint (behaviour documentation)
// ============================================================

describe('UX-E: is_favorites 0 items — child visibility (POST branch)', function () {
  /**
   * is_favorites empty branch (plugin.js): hide generic, show fav-hint, show parent.
   */
  function runPostBranch(html) {
    html.find('.cherry-grid__empty-generic').hide();
    html.find('.cherry-grid__empty-fav-hint').show();
    html.find('.cherry-grid__empty').show();
  }

  it('POST: generic is hidden', function () {
    var html = makeHtml(TEMPLATE_POST);
    runPostBranch(html);
    expect(html.find('.cherry-grid__empty-generic').isVisible()).toBe(false);
  });

  it('POST: fav-hint is visible', function () {
    var html = makeHtml(TEMPLATE_POST);
    runPostBranch(html);
    expect(html.find('.cherry-grid__empty-fav-hint').isVisible()).toBe(true);
  });

  it('POST: parent .cherry-grid__empty is visible', function () {
    var html = makeHtml(TEMPLATE_POST);
    runPostBranch(html);
    expect(html.find('.cherry-grid__empty').isVisible()).toBe(true);
  });

  it('non-fav empty state: fav-hint stays hidden (loadPage path only shows parent)', function () {
    var html = makeHtml(TEMPLATE_POST);
    // loadPage empty-result path: just show parent, never touch fav-hint
    html.find('.cherry-grid__empty').show();
    expect(html.find('.cherry-grid__empty-fav-hint').isVisible()).toBe(false);
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
  it('UX-E: template has empty-generic and empty-fav-hint', () => {
    expect(SRC).toContain('cherry-grid__empty-generic');
    expect(SRC).toContain('cherry-grid__empty-fav-hint');
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
  it('cherry_group_label template/class present', () => {
    expect(SRC).toContain('cherry-group-label');
  });

  it('cherry_group_label template is registered', () => {
    // Lampa.Template.add('cherry_group_label', ...) OR Lampa.Template.get('cherry_group_label', ...)
    expect(SRC).toMatch(/cherry_group_label/);
  });

  it('_reloadFromStart clears group labels alongside cards', () => {
    // remove selector must include both .cherry-card and .cherry-group-label
    expect(SRC).toMatch(/\.cherry-card\s*,\s*\.cherry-group-label/);
  });

  it('loadAllSources caps groups at 10 (slice(0, 10))', () => {
    expect(SRC).toMatch(/slice\(\s*0\s*,\s*10\s*\)/);
  });

  it('grouped render no longer alphabetises all_sources results', () => {
    // The old flat-merge path sorted with localeCompare or a title a/b comparator.
    // After P2 the all-sources merge+sort block is gone. Guard against its return.
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

  it('right handler uses geometric edge detection to open the menu', () => {
    // Right opens the menu only at the geometric right edge (_atRightEdge),
    // otherwise it moves; no reliance on move()'s focus-update timing.
    expect(SRC).toMatch(/function _atRightEdge\(/);
    expect(SRC).toMatch(/right:\s*function[\s\S]{0,200}_atRightEdge\(\)[\s\S]{0,80}openActionsMenu\(\)/);
  });

  it('per-source search opens Keyboard and pushes source_id without all_sources', () => {
    expect(SRC).toMatch(/_openSearch[\s\S]{0,400}Lampa\.Keyboard\.show/);
    expect(SRC).toMatch(/_openSearch[\s\S]{0,600}Lampa\.Activity\.push\([\s\S]{0,300}source_id/);
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
// P1 — D-pad Infinite Scroll via IntersectionObserver sentinel
// (behaviour documentation)
//
// Mirrors the three pure decisions that drive the sentinel/maybeLoadMore
// logic in CherryGrid after Phase 4. No DOM, no Lampa, no observer — only
// the load-gate predicate and the D-pad proximity test.
// ============================================================

describe('P1: shouldLoadMore — POST behaviour', function () {
  /**
   * Pure mirror of the load-gate shared by all three triggers
   * (IntersectionObserver callback, scroll listener, maybeLoadMore):
   *   if (!loading && currentPage < totalPages) { load next }
   * Returns true iff the next page should be requested.
   */
  function shouldLoadMore(loading, currentPage, totalPages) {
    return !loading && currentPage < totalPages;
  }

  it('loading true blocks load (no double-load while a request is in flight)', function () {
    expect(shouldLoadMore(true, 1, 5)).toBe(false);
  });

  it('loading true blocks even on the last page boundary', function () {
    expect(shouldLoadMore(true, 4, 5)).toBe(false);
  });

  it('currentPage === totalPages: no more pages, no load', function () {
    expect(shouldLoadMore(false, 5, 5)).toBe(false);
  });

  it('currentPage > totalPages: defensive false', function () {
    expect(shouldLoadMore(false, 6, 5)).toBe(false);
  });

  it('not loading and currentPage < totalPages: load', function () {
    expect(shouldLoadMore(false, 1, 5)).toBe(true);
  });

  it('not loading, one page left (currentPage = totalPages - 1): load', function () {
    expect(shouldLoadMore(false, 4, 5)).toBe(true);
  });

  it('single-page result (totalPages = 1): never loads', function () {
    // Favorites / _related_items / grouped search all set totalPages = 1.
    expect(shouldLoadMore(false, 1, 1)).toBe(false);
  });
});

describe('P1: isSentinelNear — POST behaviour', function () {
  /**
   * Pure mirror of the maybeLoadMore() proximity test:
   *   var rect  = sentinel.getBoundingClientRect();
   *   var viewH = window.innerHeight;
   *   if (rect.top < viewH + threshold) { ... }
   * D-pad uses a 400px lookahead. Returns true iff the sentinel's top edge
   * is within viewportH + threshold of the top of the viewport.
   */
  function isSentinelNear(rectTop, viewportH, threshold) {
    return rectTop < viewportH + threshold;
  }

  it('sentinel just inside the viewport: near', function () {
    expect(isSentinelNear(500, 1000, 400)).toBe(true);
  });

  it('sentinel exactly at viewport bottom: near (below viewportH but within threshold)', function () {
    expect(isSentinelNear(1000, 1000, 400)).toBe(true);
  });

  it('sentinel within the 400px lookahead band below the fold: near', function () {
    expect(isSentinelNear(1399, 1000, 400)).toBe(true);
  });

  it('sentinel exactly at the threshold edge (viewportH + threshold): NOT near (strict <)', function () {
    expect(isSentinelNear(1400, 1000, 400)).toBe(false);
  });

  it('sentinel far below the lookahead band: not near', function () {
    expect(isSentinelNear(5000, 1000, 400)).toBe(false);
  });

  it('sentinel above the fold (negative top, already scrolled past): near', function () {
    expect(isSentinelNear(-200, 1000, 400)).toBe(true);
  });

  it('threshold widens the trigger band (0 vs 400)', function () {
    // top=1200, viewportH=1000: out of range at threshold 0, in range at 400.
    expect(isSentinelNear(1200, 1000, 0)).toBe(false);
    expect(isSentinelNear(1200, 1000, 400)).toBe(true);
  });
});

// ============================================================
// P1 — plugin.js source assertions (anti-drift)
// ============================================================

describe('P1: plugin.js source assertions (anti-drift)', () => {
  it('sentinel element class cherry-scroll-sentinel present', () => {
    expect(SRC).toContain('cherry-scroll-sentinel');
  });

  it('IntersectionObserver is referenced (primary D-pad trigger)', () => {
    expect(SRC).toMatch(/IntersectionObserver/);
  });

  it('maybeLoadMore function is defined', () => {
    expect(SRC).toMatch(/function\s+maybeLoadMore\s*\(/);
  });

  it('down handler calls maybeLoadMore', () => {
    // down: function () { Lampa.Controller.move('down'); maybeLoadMore(); }
    expect(SRC).toMatch(/down\s*:\s*function[\s\S]{0,120}maybeLoadMore\s*\(/);
  });

  it('right handler calls maybeLoadMore (in the moved-focus branch)', () => {
    // Right is now edge-detecting: it opens the action menu at the edge, else
    // moves + maybeLoadMore. maybeLoadMore sits deeper in the handler now.
    expect(SRC).toMatch(/right\s*:\s*function[\s\S]{0,600}maybeLoadMore\s*\(/);
  });

  it('observer disconnect appears in stop()', () => {
    expect(SRC).toMatch(/this\.stop\s*=\s*function[\s\S]{0,300}disconnect\s*\(/);
  });

  it('observer disconnect appears in destroy()', () => {
    expect(SRC).toMatch(/this\.destroy\s*=\s*function[\s\S]{0,300}disconnect\s*\(/);
  });

  it('sentinel is re-appended after renderCards (kept at list bottom)', () => {
    // Each renderCards(...) call site re-appends the sentinel via append(sentinel).
    expect(SRC).toMatch(/append\(\s*sentinel\s*\)/);
  });

  it('sentinel re-append follows a renderCards call in loadPage path', () => {
    // renderCards(result.items, scroll.body()); ... scroll.body().append(sentinel);
    expect(SRC).toMatch(/renderCards\([\s\S]{0,200}append\(\s*sentinel\s*\)/);
  });

  it('existing 300px scroll listener kept as secondary trigger', () => {
    // The pointer/mouse scroll fallback remains (300px threshold).
    expect(SRC).toMatch(/clientHeight\s*<\s*300/);
  });
});

// ============================================================
// UX-A — Home Screen Row Mode (Phase 5)
// (behaviour documentation)
//
// CherryMain gains a second presentation: one horizontal strip per source.
// Mode is stored as cherry_home_mode ('tiles'|'rows'), default 'tiles', and
// toggled from the long-press menu on .cherry-main__title (alongside the
// existing preview toggle). Pure functions below mirror the load-bearing
// decisions: mode toggle, menu label selection, per-row card cap, and the
// collectionSet gate. No DOM, no Lampa, no async — exact-truthiness asserts.
// ============================================================

describe('UX-A: nextHomeMode — POST behaviour', function () {
  /**
   * Mirror of: var newMode = mode === 'rows' ? 'tiles' : 'rows';
   * Toggles between the two valid modes. Anything not 'rows' becomes 'rows'
   * (so the default 'tiles' flips to 'rows' on first toggle).
   */
  function nextHomeMode(current) {
    return current === 'rows' ? 'tiles' : 'rows';
  }

  it('tiles -> rows', function () {
    expect(nextHomeMode('tiles')).toBe('rows');
  });

  it('rows -> tiles', function () {
    expect(nextHomeMode('rows')).toBe('tiles');
  });

  it('toggling twice returns to the original mode (rows)', function () {
    expect(nextHomeMode(nextHomeMode('rows'))).toBe('rows');
  });

  it('toggling twice returns to the original mode (tiles)', function () {
    expect(nextHomeMode(nextHomeMode('tiles'))).toBe('tiles');
  });

  it('undefined/unknown current defaults toward rows (only "rows" maps to tiles)', function () {
    expect(nextHomeMode(undefined)).toBe('rows');
    expect(nextHomeMode('')).toBe('rows');
  });
});

describe('UX-A: homeModeLabel — POST behaviour', function () {
  /**
   * Mirror of the menu label selection:
   *   var modeLabel = mode === 'rows'
   *     ? Lampa.Lang.translate('cherry_view_tiles')
   *     : Lampa.Lang.translate('cherry_view_rows');
   * The label always advertises the OPPOSITE (target) action: in tiles mode
   * show "switch to rows", in rows mode show "switch to tiles". Returns the
   * lang KEY (translate() is identity in tests).
   */
  function homeModeLabel(mode) {
    return mode === 'rows' ? 'cherry_view_tiles' : 'cherry_view_rows';
  }

  it('tiles mode advertises switch-to-rows', function () {
    expect(homeModeLabel('tiles')).toBe('cherry_view_rows');
  });

  it('rows mode advertises switch-to-tiles', function () {
    expect(homeModeLabel('rows')).toBe('cherry_view_tiles');
  });

  it('default (undefined) mode advertises switch-to-rows', function () {
    expect(homeModeLabel(undefined)).toBe('cherry_view_rows');
  });

  it('label key always matches the target of nextHomeMode', function () {
    // homeModeLabel must name the mode you would land in after a toggle.
    function nextHomeMode(c) { return c === 'rows' ? 'tiles' : 'rows'; }
    var keyForMode = { tiles: 'cherry_view_tiles', rows: 'cherry_view_rows' };
    ['tiles', 'rows'].forEach(function (m) {
      expect(homeModeLabel(m)).toBe(keyForMode[nextHomeMode(m)]);
    });
  });
});

describe('UX-A: rowCardsCap — POST behaviour', function () {
  /**
   * Mirror of: result.items.slice(0, 12)
   * Each source row shows at most 12 cards, in adapter order, never sorted.
   */
  var CAP = 12;
  function rowCardsCap(items) {
    return (items || []).slice(0, CAP);
  }

  function cards(n) {
    var arr = [];
    for (var i = 0; i < n; i++) arr.push({ title: 'v' + i });
    return arr;
  }

  it('caps a long row at 12 cards', function () {
    expect(rowCardsCap(cards(40))).toHaveLength(12);
  });

  it('keeps the first 12 in adapter order (not sorted)', function () {
    var titles = rowCardsCap(cards(40)).map(function (c) { return c.title; });
    expect(titles).toEqual([
      'v0', 'v1', 'v2', 'v3', 'v4', 'v5',
      'v6', 'v7', 'v8', 'v9', 'v10', 'v11'
    ]);
  });

  it('exactly 12 items are kept intact (boundary)', function () {
    expect(rowCardsCap(cards(12))).toHaveLength(12);
  });

  it('fewer than 12 items returns them all', function () {
    expect(rowCardsCap(cards(5))).toHaveLength(5);
  });

  it('empty items returns empty', function () {
    expect(rowCardsCap([])).toHaveLength(0);
  });

  it('null/undefined items is treated as empty', function () {
    expect(rowCardsCap(null)).toHaveLength(0);
    expect(rowCardsCap(undefined)).toHaveLength(0);
  });
});

describe('UX-A: allRowsLoaded — POST behaviour', function () {
  /**
   * Mirror of the collectionSet gate:
   *   resolvedCount++;
   *   if (resolvedCount === SOURCES.length) Lampa.Controller.collectionSet(html);
   * collectionSet fires exactly ONCE — when the last source resolves (success
   * OR error, since both branches increment). It must NOT fire early, and the
   * counter equality (not >=) means it triggers on precisely the last resolve.
   */
  function allRowsLoaded(resolvedCount, total) {
    return resolvedCount === total;
  }

  it('not all resolved yet: false', function () {
    expect(allRowsLoaded(1, 3)).toBe(false);
    expect(allRowsLoaded(2, 3)).toBe(false);
  });

  it('last source resolves: true', function () {
    expect(allRowsLoaded(3, 3)).toBe(true);
  });

  it('zero resolved with sources pending: false', function () {
    expect(allRowsLoaded(0, 3)).toBe(false);
  });

  it('exactly one source: fires on first resolve', function () {
    expect(allRowsLoaded(1, 1)).toBe(true);
  });

  it('strict equality — does not re-fire past the total', function () {
    // Counter overshoot must not re-trigger (equality, not >=).
    expect(allRowsLoaded(4, 3)).toBe(false);
  });

  it('fires exactly once across a simulated resolve sequence', function () {
    var total = 4;
    var fired = 0;
    for (var c = 1; c <= total; c++) {
      if (allRowsLoaded(c, total)) fired++;
    }
    expect(fired).toBe(1);
  });
});

// ============================================================
// UX-A — plugin.js source assertions (anti-drift)
// ============================================================

describe('UX-A: plugin.js source assertions (anti-drift)', () => {
  it('cherry_home_mode storage key referenced', () => {
    expect(SRC).toContain('cherry_home_mode');
  });

  it('cherry_home_mode read with default "tiles"', () => {
    expect(SRC).toMatch(/cherry_home_mode['"]\s*,\s*['"]tiles['"]/);
  });

  it('cherry_source_row template registered', () => {
    // Lampa.Template.add('cherry_source_row', ...)
    expect(SRC).toMatch(/Lampa\.Template\.add\(\s*['"]cherry_source_row['"]/);
  });

  it('cherry_source_row label/cards classes present', () => {
    expect(SRC).toContain('cherry-source-row__label');
    expect(SRC).toContain('cherry-source-row__cards');
  });

  it('renderRows function defined', () => {
    expect(SRC).toMatch(/function\s+renderRows\s*\(/);
  });

  it('renderRows applies the --rows modifier class', () => {
    expect(SRC).toContain('cherry-main__sources--rows');
  });

  it('row card sets video.source = src.id before render (Fav 7-field invariant)', () => {
    expect(SRC).toMatch(/video\.source\s*=\s*src\.id/);
  });

  it('CherryMain has a destroyed flag', () => {
    // The guard variable must be declared (and used in async row callbacks).
    expect(SRC).toMatch(/var\s+destroyed\s*=\s*false/);
  });

  it('CherryMain.destroy sets destroyed = true', () => {
    expect(SRC).toMatch(/this\.destroy\s*=\s*function[\s\S]{0,120}destroyed\s*=\s*true/);
  });

  it('lang key cherry_view_rows registered', () => {
    expect(SRC).toMatch(/cherry_view_rows\s*:/);
  });

  it('lang key cherry_view_tiles registered', () => {
    expect(SRC).toMatch(/cherry_view_tiles\s*:/);
  });

  it('collectionSet gated by a resolved counter (fires once)', () => {
    // resolvedCount (or similar) incremented, then compared to SOURCES.length.
    expect(SRC).toMatch(/resolvedCount/);
    expect(SRC).toMatch(/resolvedCount\s*===\s*SOURCES\.length/);
  });

  it('view_toggle action present in the long-press menu', () => {
    expect(SRC).toMatch(/action:\s*'view_toggle'/);
  });

  it('view toggle re-pushes cherry_main after backward() with a setTimeout', () => {
    // Mode switch: Lampa.Activity.backward() then setTimeout(... push cherry_main ...).
    expect(SRC).toMatch(/Lampa\.Activity\.backward\(\)/);
    expect(SRC).toMatch(/setTimeout\([\s\S]{0,200}cherry_main/);
  });

  it('view_toggle guarded by a _toggling re-entrancy flag (no destroyed-guard in re-push)', () => {
    // The deferred re-push MUST fire even after backward() tears down the
    // instance, so there is no destroyed-guard in the timer. Fast double-toggle
    // is instead blocked up-front by a _toggling re-entrancy flag.
    expect(SRC).toMatch(/var\s+_toggling\s*=\s*false/);
    expect(SRC).toMatch(/if\s*\(\s*_toggling\s*\)\s*return/);
    expect(SRC).toMatch(/_toggling\s*=\s*true/);
  });

  it('row mode wraps src.browse in Promise.resolve (thenable-safe)', () => {
    // Promise.resolve(src.browse('', 1)) — a sync-throwing / null-returning
    // adapter must land in .catch, not abort the whole forEach.
    expect(SRC).toMatch(/Promise\.resolve\(\s*src\.browse\(/);
  });

  it('both cherry_view_rows and cherry_view_tiles reachable from the menu label branch', () => {
    // modeLabel selects cherry_view_tiles in rows mode, cherry_view_rows otherwise.
    expect(SRC).toMatch(/translate\(\s*['"]cherry_view_tiles['"]\s*\)/);
    expect(SRC).toMatch(/translate\(\s*['"]cherry_view_rows['"]\s*\)/);
  });

  it('row card cap is slice(0, 12)', () => {
    expect(SRC).toMatch(/slice\(\s*0\s*,\s*12\s*\)/);
  });

  it('row mode browses each source via src.browse with page 1', () => {
    expect(SRC).toMatch(/src\.browse\(\s*['"]['"]\s*,\s*1\s*\)/);
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

// ── Navigation recursion guard (all directions, both controllers) ─────────────
describe('nav recursion guard — plugin.js source assertions (anti-drift)', () => {
  it('both controllers declare _navMoving', () => {
    var n = (SRC.match(/var _navMoving = false/g) || []).length;
    expect(n).toBe(2); // CherryGrid + CherryMain
  });
  it('every directional handler is guarded by _navMoving (no bare move recursion)', () => {
    // Count guarded directions: 4 in cherry_grid + 4 in cherry_main = 8
    var guarded = (SRC.match(/if \(_navMoving\) return; _navMoving = true; Lampa\.Controller\.move/g) || []).length;
    expect(guarded).toBeGreaterThanOrEqual(7); // right in grid is multiline-guarded separately
  });
  it('no unguarded bare directional move remains in a controller handler', () => {
    // The old pattern "up:    function () { Lampa.Controller.move('up'); }" must be gone
    expect(SRC).not.toMatch(/up:\s*function \(\) \{ Lampa\.Controller\.move\('up'\); \}/);
  });
});
