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
    // Order mirrors plugin.js onMenu: «Похожие» (related, only when getRelated
    // exists) → «Похожие названия» (similar, always) → «Избранное» (fav).
    var menuItems = [];
    if (cardSrc && cardSrc.getRelated) {
      menuItems.push({
        title: Lampa.Lang.translate('cherry_related'),
        action: 'related'
      });
    }
    menuItems.push({
      title: Lampa.Lang.translate('cherry_similar_titles'),
      action: 'similar'
    });
    menuItems.push({
      title: isFav
        ? Lampa.Lang.translate('cherry_rem_fav_action')
        : Lampa.Lang.translate('cherry_add_fav_action'),
      action: 'fav'
    });

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

  it('order: «Похожие» (related) comes before «Похожие названия» (similar) when present', function () {
    var actions = buildMenuItemsPost(pornhubSrc, mockLampa).map(function (i) { return i.action; });
    expect(actions).toEqual(['related', 'similar', 'fav']);
  });

  it('order: «Похожие названия» before «Избранное» when no getRelated', function () {
    var actions = buildMenuItemsPost(xozillaSrc, mockLampa).map(function (i) { return i.action; });
    expect(actions).toEqual(['similar', 'fav']);
  });

  it('relabel: the keyword-search item uses cherry_similar_titles (not cherry_similar)', function () {
    var items = buildMenuItemsPost(xozillaSrc, mockLampa);
    var sim = items.find(function (i) { return i.action === 'similar'; });
    expect(sim.title).toBe('cherry_similar_titles');
    expect(sim.title).not.toBe('cherry_similar');
  });

  it('«Похожие» present only when getRelated exists', function () {
    expect(buildMenuItemsPost(pornhubSrc, mockLampa).some(function (i) { return i.action === 'related'; })).toBe(true);
    expect(buildMenuItemsPost(xozillaSrc, mockLampa).some(function (i) { return i.action === 'related'; })).toBe(false);
  });
});

// ============================================================
// S4 — "Модель" context menu item + onSelect routing
// (re-activates the dead browseByModel path via onMenu).
// ============================================================

describe('S4: model menu item — POST behaviour', function () {
  var mockLampa = { Lang: { translate: function (k) { return k; } } };

  /**
   * Mirror of the onMenu items array: base [fav, similar] + optional related
   * (by capability) + optional model (when element.model.name exists).
   */
  function buildMenuItems(cardSrc, element, Lampa) {
    // Order: related (conditional) → similar titles → fav → model.
    var items = [];
    if (cardSrc && cardSrc.getRelated) {
      items.push({ title: Lampa.Lang.translate('cherry_related'), action: 'related' });
    }
    items.push({ title: Lampa.Lang.translate('cherry_similar_titles'), action: 'similar' });
    items.push({ title: Lampa.Lang.translate('cherry_add_fav_action'), action: 'fav' });
    if (element.model && element.model.name) {
      items.push({
        title: Lampa.Lang.translate('cherry_model') + ': ' + element.model.name,
        action: 'model'
      });
    }
    return items;
  }

  /** Mirror of the onSelect 'model' branch — returns the pushed activity. */
  function selectModel(element) {
    return {
      component: 'cherry_grid',
      title:     element.model.name,
      source_id: element.source,
      model_url: element.model.url,
      page:      1
    };
  }

  var phSrc = { id: 'pornhub', getRelated: function () { return Promise.resolve([]); } };

  it('pushes a "model" item only when element.model.name exists', function () {
    var withModel = buildMenuItems(phSrc,
      { source: 'pornhub', model: { name: 'Mia', url: 'http://ph/pornstar/mia' } }, mockLampa);
    var actions = withModel.map(function (i) { return i.action; });
    expect(actions).toContain('model');
  });

  it('no "model" item when element.model absent', function () {
    var noModel = buildMenuItems(phSrc, { source: 'pornhub' }, mockLampa);
    expect(noModel.map(function (i) { return i.action; })).not.toContain('model');
  });

  it('no "model" item when model has no name', function () {
    var emptyModel = buildMenuItems(phSrc,
      { source: 'pornhub', model: { url: 'http://ph/pornstar/x' } }, mockLampa);
    expect(emptyModel.map(function (i) { return i.action; })).not.toContain('model');
  });

  it('model item title includes the performer name', function () {
    var items = buildMenuItems(phSrc,
      { source: 'pornhub', model: { name: 'Mia', url: 'http://ph/pornstar/mia' } }, mockLampa);
    var mi = items.find(function (i) { return i.action === 'model'; });
    expect(mi.title).toBe('cherry_model: Mia');
  });

  it('model comes after related in the items order', function () {
    var items = buildMenuItems(phSrc,
      { source: 'pornhub', model: { name: 'Mia', url: 'http://ph/pornstar/mia' } }, mockLampa);
    var actions = items.map(function (i) { return i.action; });
    expect(actions.indexOf('model')).toBeGreaterThan(actions.indexOf('related'));
  });

  it("onSelect 'model' pushes cherry_grid with model_url + source_id", function () {
    var element = { source: 'pornhub', model: { name: 'Mia', url: 'http://ph/pornstar/mia' } };
    var pushed = selectModel(element);
    expect(pushed.component).toBe('cherry_grid');
    expect(pushed.model_url).toBe('http://ph/pornstar/mia');
    expect(pushed.source_id).toBe('pornhub');
    expect(pushed.title).toBe('Mia');
    expect(pushed.page).toBe(1);
    // No query/all_sources — this is a pure model grid.
    expect(pushed.query).toBeUndefined();
    expect(pushed.all_sources).toBeUndefined();
  });
});

// ============================================================
// C10 — nested long-press actions on all_sources / related result cards.
// A card inside «Похожие по названию» (all_sources) must offer BOTH:
//   «Похожие»            → that card's SOURCE-site related (paginated grid)
//   «Похожие по названию» → all-sources keyword
// Both resolve the card's OWN source via element.source (stamped at load).
// ============================================================

describe('C10: nested actions on all_sources result cards', function () {
  var mockLampa = {
    Lang: { translate: function (k) { return k; } }
  };

  // sourceById mirror: all_sources cards are stamped with element.source.
  var SOURCES = {
    pornhub: { id: 'pornhub', getRelated: function () { return Promise.resolve([]); } },
    xvideos: { id: 'xvideos' } // no getRelated
  };
  function sourceById(id) { return SOURCES[id] || null; }

  // Mirror of onMenu: cardSrc = sourceById(element.source) || sourceById(object.source_id).
  function buildMenuItems(object, element) {
    var cardSrc = sourceById(element.source) || sourceById(object.source_id);
    var items = [];
    if (cardSrc && cardSrc.getRelated) {
      items.push({ title: mockLampa.Lang.translate('cherry_related'), action: 'related' });
    }
    items.push({ title: mockLampa.Lang.translate('cherry_similar_titles'), action: 'similar' });
    return items;
  }

  // Mirror of the onSelect 'related' push (paginated): carries the VIDEO + source.
  function selectRelated(object, element) {
    var cardSrc = sourceById(element.source) || sourceById(object.source_id);
    return {
      component:            'cherry_grid',
      title:                'cherry_related: ' + element.title,
      source_id:            cardSrc.id,
      related_video:        element,
      related_video_source: cardSrc.id,
      page:                 1
    };
  }

  // Mirror of plugin.js STOP_WORDS + _searchKeywords (the «Похожие по названию»
  // keyword builder). Keep in sync with the shipped helper.
  var STOP_WORDS = (function () {
    var list = ('the a an and or of to in on at for with from by as is are be ' +
      'his her she he it its they them you your my our this that these those ' +
      'hot sex porn porno video videos girl girls guy guys teen milf babe babes ' +
      'amateur scene clip full hd new free' + ' ' +
      'и в во на с со по для она его ее их они ты вы мой моя наш это эта эти тот ' +
      'как что так все всё за из от до о об у не да нет porno секс порно видео ' +
      'девушка девушки парень молодая молодые любительское сцена новое').split(/\s+/);
    var set = {};
    for (var i = 0; i < list.length; i++) if (list[i]) set[list[i]] = true;
    return set;
  })();
  function _searchKeywords(title, limit) {
    var n = limit || 4;
    var all = (title || '').replace(/[^a-zа-яё0-9\s]/gi, '').trim().split(/\s+/).filter(Boolean);
    var kept = all.filter(function (w) { return !STOP_WORDS[w.toLowerCase()]; });
    var words = (kept.length ? kept : all).slice(0, n);
    return words.join(' ');
  }

  // Mirror of the onSelect 'similar' push: all-sources keyword from element.title.
  function selectSimilar(object, element) {
    return {
      component:   'cherry_grid',
      title:       'cherry_similar_titles: ' + element.title,
      source_id:   element.source,
      query:       _searchKeywords(element.title, 4),
      all_sources: true,
      page:        1
    };
  }

  // An all_sources result card stamped with its origin source (pornhub).
  var resultCard = { id: 'v1', source: 'pornhub', title: 'Hot Scene', url: 'https://ph/v/1' };
  var allSourcesObject = { all_sources: true, query: 'hot' };

  it('result card offers BOTH «Похожие» and «Похожие по названию»', function () {
    var actions = buildMenuItems(allSourcesObject, resultCard).map(function (i) { return i.action; });
    expect(actions).toContain('related');
    expect(actions).toContain('similar');
  });

  it('«Похожие» resolves the card OWN source (element.source) → paginated related grid', function () {
    var pushed = selectRelated(allSourcesObject, resultCard);
    expect(pushed.component).toBe('cherry_grid');
    expect(pushed.source_id).toBe('pornhub');             // card's source, not object's
    expect(pushed.related_video).toEqual(resultCard);     // carries the video (paginated)
    expect(pushed.related_video_source).toBe('pornhub');
    expect(pushed._related_items).toBeUndefined();         // NOT a one-shot snapshot
  });

  it('«Похожие по названию» opens an all_sources keyword grid', function () {
    var pushed = selectSimilar(allSourcesObject, resultCard);
    expect(pushed.all_sources).toBe(true);
    // 'Hot Scene' is all-stop ('hot'+'scene') → fallback preserves the title.
    expect(pushed.query).toBe('Hot Scene');
    expect(pushed.source_id).toBe('pornhub');
  });

  it('stop-words: generic fillers are dropped so distinctive words key the query', function () {
    var card = { id: 'v9', source: 'pornhub', title: 'Pierre Woodman Casting Hot Teen Anna', url: 'x' };
    var pushed = selectSimilar(allSourcesObject, card);
    // 'Hot'/'Teen' stripped; the old slice(0,4) kept 'Hot' and dropped 'Anna'.
    expect(pushed.query).toBe('Pierre Woodman Casting Anna');
    expect(pushed.query).not.toMatch(/\bHot\b/);
  });

  it('stop-words (RU): cyrillic fillers (в, с) are dropped', function () {
    var card = { id: 'v10', source: 'pornhub', title: 'Девушка в чулках трахается с парнем', url: 'x' };
    var pushed = selectSimilar(allSourcesObject, card);
    expect(pushed.query).toBe('чулках трахается парнем');
  });

  it('stop-words fallback: an all-stop title yields the unfiltered words (never empty)', function () {
    var card = { id: 'v11', source: 'pornhub', title: 'Hot Sex Porn Video', url: 'x' };
    var pushed = selectSimilar(allSourcesObject, card);
    expect(pushed.query).toBe('Hot Sex Porn Video');
    expect(pushed.query.length).toBeGreaterThan(0);
  });

  it('a card whose source lacks getRelated still offers «Похожие по названию»', function () {
    var xvCard = { id: 'v2', source: 'xvideos', title: 'Clip', url: 'https://xv/v/2' };
    var actions = buildMenuItems(allSourcesObject, xvCard).map(function (i) { return i.action; });
    expect(actions).not.toContain('related');             // no getRelated on xvideos
    expect(actions).toContain('similar');                 // keyword always available
  });

  it('nested: a card INSIDE a related grid re-opens its source related (element.source stamped)', function () {
    // Related result cards are stamped with relSrc.id at load → same path works.
    var relObject = { related_video: { id: 'orig' }, source_id: 'pornhub' };
    var nestedCard = { id: 'v3', source: 'pornhub', title: 'Next', url: 'https://ph/v/3' };
    var pushed = selectRelated(relObject, nestedCard);
    expect(pushed.source_id).toBe('pornhub');
    expect(pushed.related_video).toEqual(nestedCard);
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
  it('C9: «Похожие» action pushes a PAGINATED grid (related_video, not _related_items)', () => {
    // The related onSelect branch carries the VIDEO + its source so the grid pages;
    // it must NOT pre-fetch a one-shot _related_items snapshot.
    var at = SRC.indexOf("item.action === 'related'");
    expect(at).toBeGreaterThan(-1);
    var body = SRC.slice(at, at + 1000);
    expect(body).toMatch(/related_video:\s*element/);
    expect(body).toMatch(/related_video_source:\s*cardSrc\.id/);
    expect(body).not.toContain('_related_items');
    // No longer awaits getRelated before pushing (the grid fetches per page).
    expect(body).not.toMatch(/cardSrc\.getRelated\(element\)\.then/);
  });
  it('C9: _gridLoad has a paginated related_video branch calling getRelated(video, page) via _derivePages', () => {
    var at = SRC.indexOf('if (object.related_video)');
    expect(at).toBeGreaterThan(-1);
    var body = SRC.slice(at, at + 700);
    expect(body).toMatch(/getRelated\(\s*object\.related_video\s*,\s*page\s*\)/);
    expect(body).toMatch(/_derivePages\(/);
    // Stamps each related card with its source so nested «Похожие» works.
    expect(body).toMatch(/v\.source\s*=\s*relSrc\.id/);
  });
  it('labels: cherry_related = "Похожие" / "Related"', () => {
    expect(SRC).toMatch(/cherry_related\s*:\s*\{\s*ru:\s*'Похожие',\s*en:\s*'Related'/);
  });
  it('labels: cherry_similar_titles = "Похожие названия" / "Similar titles"', () => {
    expect(SRC).toMatch(/cherry_similar_titles\s*:\s*\{\s*ru:\s*'Похожие названия',\s*en:\s*'Similar titles'/);
  });
  it('relabel: keyword-search menu item now uses cherry_similar_titles', () => {
    expect(SRC).toMatch(/cherry_similar_titles[\s\S]{0,40}action:\s*'similar'/);
  });
  it('generalized getRelated: _kvsEngine reuses _kvsParseCards on the video page', () => {
    expect(SRC).toMatch(/getRelated:\s*function[\s\S]{0,200}_kvsParseCards\(html,\s*cfg\)/);
  });
  it('generalized getRelated: a custom adapter wires its parser via _relatedFrom', () => {
    expect(SRC).toMatch(/getRelated:\s*_relatedFrom\(_porntrexCards\)/);
    expect(SRC).toMatch(/getRelated:\s*_relatedFrom\(_3movsCards\)/);
  });
  it('per-site getRelated: shared _xvideosRelated helper parses video_related JSON', () => {
    expect(SRC).toMatch(/function _xvideosRelated\(html, host, sourceId\)/);
    expect(SRC).toMatch(/video_related\\s\*=\\s\*\(\\\[\[\\s\\S\]\*\?\\\]\)/);
  });
  it('per-site getRelated: eporner _epornerRelated parses mbcontent cards', () => {
    expect(SRC).toMatch(/function _epornerRelated\(html\)/);
    expect(SRC).toMatch(/class="mbcontent"/);
  });
  it('per-site getRelated: xvideos uses _xvideosRelated (NOT the thumb-block parser)', () => {
    expect(SRC).toMatch(/_xvideosRelated\(html, 'https:\/\/www\.xvideos\.com', 'xvideos'\)/);
  });
  it('per-site getRelated: xnxx wired via _xvideosRelated', () => {
    expect(SRC).toMatch(/_xvideosRelated\(html, 'https:\/\/www\.xnxx\.com', 'xnxx'\)/);
  });
  it('per-site getRelated: eporner wired via _epornerRelated', () => {
    expect(SRC).toMatch(/_epornerRelated\(html\)\.filter/);
  });
  it('per-site getRelated: pornone reuses _pornoneCards on the video page', () => {
    expect(SRC).toMatch(/_pornoneCards\(html\)\.filter\(function \(v\) \{ return v\.url !== video\.url; \}\)/);
  });
  it('anti-drift: xvideos, xnxx, eporner, pornone all expose getRelated', () => {
    ['xvideos', 'xnxx', 'eporner', 'pornone'].forEach((id) => {
      // Scope to THIS source block (from its id to the next SOURCES.push) instead
      // of a brittle fixed char window — keeps the guard valid as adapters grow.
      const start = SRC.indexOf("id: '" + id + "'");
      const next = SRC.indexOf('SOURCES.push', start + 1);
      const block = SRC.slice(start, next === -1 ? undefined : next);
      expect(block).toMatch(/getRelated:\s*function/);
    });
  });
  it('UX-C: SettingsApi.addComponent called for cherry', () => {
    expect(SRC).toMatch(/addComponent/);
    expect(SRC).toMatch(/component:\s*'cherry'/);
  });
  it('UX-C: preview param type is trigger', () => {
    expect(SRC).toMatch(/cherry_preview_enabled/);
    expect(SRC).toMatch(/type:\s*'trigger'/);
  });
  it("S4: onMenu pushes a 'model' item guarded by element.model.name", () => {
    expect(SRC).toMatch(/element\.model\s*&&\s*element\.model\.name/);
    expect(SRC).toMatch(/action:\s*'model'/);
  });
  it("S4: onSelect 'model' branch pushes cherry_grid with model_url", () => {
    expect(SRC).toMatch(/item\.action\s*===\s*'model'/);
    expect(SRC).toMatch(/model_url:\s*element\.model\.url/);
  });
  it('S4: cherry_model lang key registered with ru + en', () => {
    expect(SRC).toMatch(/cherry_model\s*:\s*\{\s*ru:\s*'Модель',\s*en:\s*'Model'/);
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
   * canSearch  = NOT is_favorites AND NOT all_sources AND NOT related_video AND NOT model_url
   *              (model browse is already filtered to a performer, so per-source text
   *               search does not apply there; related is a fixed-purpose grid).
   * sort       = source.cfg.sorts exists & length > 0
   * cat        = source.cfg.categories exists & length > 0
   *
   * Returns plain booleans so callers can assert exact truthiness.
   */
  function computeVisibility(object, source) {
    object = object || {};
    var canSearch = !object.is_favorites
                 && !object.all_sources
                 && !object.related_video
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

  it('related grid: search false', function () {
    var v = computeVisibility({ related_video: { title: 'a' }, source_id: 'pornhub' }, fullSource);
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
    // The pushes must appear in this order inside openActionsMenu. Phase 3 A2
    // inserts an all_sources-only 'clientsort' entry between sort and cat (also a
    // sort-type entry, so the Search → Sort → Category ordering is preserved).
    expect(SRC).toMatch(
      /openActionsMenu[\s\S]{0,400}action:\s*'search'[\s\S]{0,200}action:\s*'sort'[\s\S]{0,300}action:\s*'cat'/
    );
  });

  it('_canSearch excludes is_favorites, all_sources, related_video AND model_url', () => {
    expect(SRC).toMatch(
      /_canSearch\s*=\s*!object\.is_favorites[\s\S]{0,120}!object\.all_sources[\s\S]{0,120}!object\.related_video[\s\S]{0,120}!object\.model_url/
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
    expect(SRC).toMatch(/_openSearch[\s\S]{0,800}Lampa\.Activity\.push\([\s\S]{0,300}source_id/);
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
// «Модели» — model discovery axis (source assertions)
// ============================================================

describe('Models discovery axis (anti-drift)', () => {
  it('cherry_models lang key registered with ru + en', () => {
    expect(SRC).toMatch(/cherry_models\s*:\s*\{\s*ru:\s*'Модели',\s*en:\s*'Models'/);
  });

  it('openActionsMenu adds a «Модели» item gated by _hasModels', () => {
    expect(SRC).toMatch(/_hasModels[\s\S]{0,120}action:\s*'models'/);
    expect(SRC).toMatch(/item\.action\s*===\s*'models'[\s\S]{0,40}_openModels\(\)/);
  });

  it('_hasModels requires getModels and excludes models_index/model_url/etc', () => {
    expect(SRC).toMatch(/_hasModels\s*=\s*!!\(source\s*&&\s*source\.getModels/);
    expect(SRC).toMatch(/_hasModels[\s\S]{0,200}!object\.models_index/);
  });

  it('_openModels pushes cherry_grid with models_index:true', () => {
    expect(SRC).toMatch(/_openModels[\s\S]{0,300}models_index:\s*true/);
  });

  it('_gridLoad has a models_index branch calling src.getModels(page)', () => {
    expect(SRC).toMatch(/object\.models_index[\s\S]{0,160}src\.getModels\(page\)/);
  });

  it('models_index branch maps each model to a _model card with model_url', () => {
    expect(SRC).toMatch(/_model:\s*true/);
    expect(SRC).toMatch(/model_url:\s*m\.url/);
  });

  it('models_index branch derives pages via _derivePages', () => {
    expect(SRC).toMatch(/models_index[\s\S]{0,600}_derivePages\(/);
  });

  it('cardRender routes _model cards to a model_url push (not playVideo)', () => {
    expect(SRC).toMatch(/element\._model[\s\S]{0,200}model_url:\s*element\.model_url/);
  });

  it('_canSearch also excludes models_index (model grid has no per-source search)', () => {
    expect(SRC).toMatch(/_canSearch\s*=[\s\S]{0,200}!object\.models_index/);
  });

  it('a shared model-index parser _parseModelIndex exists', () => {
    expect(SRC).toMatch(/function _parseModelIndex\(html, opts\)/);
    expect(SRC).toMatch(/function _humanizeName\(slug\)/);
  });

  it('several adapters declare getModels + browseByModel', () => {
    // KVS engine exposes both conditionally on cfg.modelIndex.
    expect(SRC).toMatch(/getModels:\s*cfg\.modelIndex\s*\?/);
    expect(SRC).toMatch(/browseByModel:\s*cfg\.modelIndex\s*\?/);
    // crocotube + pornobolt + analdin + xozilla declare modelIndex configs.
    expect((SRC.match(/modelIndex:\s*\{/g) || []).length).toBeGreaterThanOrEqual(4);
    // pornhub + xvideos + porndig + ebun + jopaonline expose getModels directly.
    expect((SRC.match(/getModels:\s*function/g) || []).length).toBeGreaterThanOrEqual(5);
  });

  // Regression: the reported bug was model cards rendering with NO avatar because
  // a model-index config shipped without (or with a too-strict) thumbRx. Every
  // model-index config block — both the cfg.modelIndex declarations and the inline
  // _parseModelIndex({...}) calls inside direct getModels — MUST carry a thumbRx.
  it('every model-index config declares a thumbRx (avatar parser)', () => {
    // cfg.modelIndex: { … } blocks
    var miRx = /modelIndex:\s*\{([\s\S]*?)\n\s{4}\}/g, mi, miCount = 0;
    while ((mi = miRx.exec(SRC)) !== null) {
      miCount++;
      expect(mi[1]).toMatch(/thumbRx:\s*\[/);
    }
    expect(miCount).toBeGreaterThanOrEqual(4);

    // inline _parseModelIndex({ … }) calls inside direct getModels
    var piRx = /_parseModelIndex\(html,\s*\{([\s\S]*?)\}\);/g, pi, piCount = 0;
    while ((pi = piRx.exec(SRC)) !== null) {
      piCount++;
      expect(pi[1]).toMatch(/thumbRx:\s*\[/);
    }
    expect(piCount).toBeGreaterThanOrEqual(5);
  });
});

describe('Studios discovery axis (anti-drift)', () => {
  it('cherry_studios lang key registered with ru + en', () => {
    expect(SRC).toMatch(/cherry_studios\s*:\s*\{\s*ru:\s*'Студии',\s*en:\s*'Studios'/);
  });

  it('openActionsMenu adds a «Студии» item gated by _hasStudios', () => {
    expect(SRC).toMatch(/_hasStudios[\s\S]{0,120}action:\s*'studios'/);
    expect(SRC).toMatch(/item\.action\s*===\s*'studios'[\s\S]{0,40}_openStudios\(\)/);
  });

  it('_hasStudios requires getStudios and excludes studios_index/studio_url/etc', () => {
    expect(SRC).toMatch(/_hasStudios\s*=\s*!!\(source\s*&&\s*source\.getStudios/);
    expect(SRC).toMatch(/_hasStudios[\s\S]{0,260}!object\.studios_index/);
    expect(SRC).toMatch(/_hasStudios[\s\S]{0,260}!object\.studio_url/);
  });

  it('_openStudios pushes cherry_grid with studios_index:true', () => {
    expect(SRC).toMatch(/_openStudios[\s\S]{0,300}studios_index:\s*true/);
  });

  it('_gridLoad has a studios_index branch calling src.getStudios(page)', () => {
    expect(SRC).toMatch(/object\.studios_index[\s\S]{0,200}src\.getStudios\(page\)/);
  });

  it('studios_index branch maps each studio to a _studio card with studio_url', () => {
    expect(SRC).toMatch(/_studio:\s*true/);
    expect(SRC).toMatch(/studio_url:\s*s\.url/);
  });

  it('studios_index branch derives pages via _derivePages', () => {
    expect(SRC).toMatch(/studios_index[\s\S]{0,700}_derivePages\(/);
  });

  it('_gridLoad has a studio_url branch calling browseByStudio', () => {
    expect(SRC).toMatch(/object\.studio_url[\s\S]{0,120}browseByStudio\(object\.studio_url,\s*page\)/);
  });

  it('cardRender routes _studio cards to a studio_url push (not playVideo)', () => {
    expect(SRC).toMatch(/element\._studio[\s\S]{0,200}studio_url:\s*element\.studio_url/);
  });

  it('_canSearch also excludes studios_index + studio_url', () => {
    expect(SRC).toMatch(/_canSearch\s*=[\s\S]{0,260}!object\.studios_index/);
    expect(SRC).toMatch(/_canSearch\s*=[\s\S]{0,260}!object\.studio_url/);
  });

  it('24rolika + perfektdamen declare getStudios + browseByStudio', () => {
    var rolika = SRC.slice(SRC.indexOf("id: '24rolika'"), SRC.indexOf("id: '24rolika'") + 6000);
    expect(rolika).toMatch(/getStudios:\s*function/);
    expect(rolika).toMatch(/browseByStudio:\s*function/);
    var perfekt = SRC.slice(SRC.indexOf("id: 'perfektdamen'"), SRC.indexOf("id: 'perfektdamen'") + 6000);
    expect(perfekt).toMatch(/getStudios:\s*function/);
    expect(perfekt).toMatch(/browseByStudio:\s*function/);
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
   * Mirror of the single-page guard in comp.nextPageReuest: ONLY favorites resolves
   * with an empty page (total_pages stays 1) so the base class stops paginating.
   * «Похожие» (related_video) and all-sources search now BOTH fall through to
   * _gridLoad and paginate like every other mode (advancing to currentPage + 1);
   * the dedup guard caps fixed-block related after page 1.
   */
  function isSinglePageMode(object) {
    return !!object.is_favorites;
  }

  it('favorites is single-page (no further pages requested)', function () {
    expect(isSinglePageMode({ is_favorites: true })).toBe(true);
  });

  it('related now paginates (was single-page) — dedup guard caps fixed blocks', function () {
    expect(isSinglePageMode({ related_video: { title: 'a' }, source_id: 'pornhub' })).toBe(false);
  });

  it('all-sources search now paginates (was single-page)', function () {
    expect(isSinglePageMode({ all_sources: true, query: 'cat' })).toBe(false);
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
    expect(SRC).toMatch(/comp\.create\s*=\s*function[\s\S]{0,900}\.build\(\s*\{/);
  });

  it('nextPageReuest is overridden for framework-driven paging', () => {
    expect(SRC).toMatch(/comp\.nextPageReuest\s*=\s*function\s*\(\s*object\s*,\s*resolve\s*,\s*reject\s*\)/);
  });

  it('nextPageReuest resolves with {title, results, total_pages}', () => {
    expect(SRC).toMatch(/resolve\(\{\s*title:[\s\S]{0,80}results:[\s\S]{0,40}total_pages:/);
  });

  it('single-page mode short-circuits nextPageReuest (favorites only; related + all_sources paginate)', () => {
    // Only favorites short-circuits now. related_video AND all_sources+query both
    // fall through to _gridLoad so «Похожие» / global search / similar-titles paginate.
    expect(SRC).toMatch(/if\s*\(object\.is_favorites\)\s*\{[\s\S]{0,160}resolve\(\{\s*title:[\s\S]{0,80}total_pages:\s*1/);
    expect(SRC).not.toMatch(/object\.is_favorites\s*\|\|\s*object\._related_items/);
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

  it('onFocus starts a hover-preview for ANY card with element.preview (source-agnostic)', () => {
    // The render path must be generic: gated only on element.preview (+ the user
    // setting), NOT on a specific source. So a non-xvideos card (e.g. analdin,
    // pornve, youjizz) whose parser set .preview gets the same hover treatment.
    expect(SRC).toMatch(/if\s*\(\s*element\.preview\s*&&[\s\S]*?_startPreview\(\s*target\s*,\s*element\.preview\s*\)/);
    // Guard against accidental per-source gating of the preview start.
    expect(SRC).not.toMatch(/element\.source\s*===\s*['"]xvideos['"][\s\S]{0,60}_startPreview/);
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

// ============================================================
// Phase 3 — Search correctness (A1 nav, A3 relevance, A2 sort)
// ============================================================

describe('Phase 3 A1: search callbacks do NOT toggle on the push path', () => {
  // The premature Lampa.Controller.toggle('content') bound the controller to the
  // OLD activity before the pushed cherry_grid mounted → dead arrow nav. The fix
  // toggles ONLY inside the empty-query guard (no push). Both Input.edit callbacks
  // (home all_sources search + per-source _openSearch) must match this shape.

  it('_openSearch: toggle only inside the empty-query guard (if (!q))', () => {
    var at = SRC.indexOf('function _openSearch()');
    expect(at).toBeGreaterThan(-1);
    var body = SRC.slice(at, at + 700);
    // The empty guard toggles then returns.
    expect(body).toMatch(/if\s*\(!q\)\s*\{\s*Lampa\.Controller\.toggle\('content'\);\s*return;\s*\}/);
    // Exactly one toggle in the whole _openSearch body (the guard one).
    expect((body.match(/Lampa\.Controller\.toggle\('content'\)/g) || []).length).toBe(1);
    // The push must NOT be preceded by an unguarded toggle.
    expect(body).not.toMatch(/toggle\('content'\);\s*var q[\s\S]{0,40}Activity\.push/);
  });

  it('home all_sources search callback: toggle only in the empty-query guard', () => {
    // Isolate the all_sources Input.edit callback (it carries all_sources: true).
    var at = SRC.indexOf("element._kind === 'search'");
    expect(at).toBeGreaterThan(-1);
    var body = SRC.slice(at, at + 1400);
    expect(body).toMatch(/if\s*\(!q\)\s*\{\s*Lampa\.Controller\.toggle\('content'\);\s*return;\s*\}/);
    expect(body).toMatch(/all_sources:\s*true/);
    // No toggle on the line before var q / before the push.
    expect(body).not.toMatch(/edit\([\s\S]{0,200}toggle\('content'\);\s*var q = \(value/);
  });
});

describe('Phase 3 A3(a): eporner SEARCH uses relevance order (no forced most-popular)', () => {
  it('eporner search() drops order=most-popular', () => {
    var at = SRC.indexOf("id: 'eporner'");
    expect(at).toBeGreaterThan(-1);
    // search() now also takes `sort` (orientation suffix); match on the prefix.
    var searchAt = SRC.indexOf('search: function(query, page', at);
    expect(searchAt).toBeGreaterThan(-1);
    var searchBody = SRC.slice(searchAt, searchAt + 900);
    // Assert the SEARCH URL line itself has no order param (a comment may mention
    // browse's most-popular, so check the actual var url = '...' assignment).
    var urlLine = (searchBody.match(/var url = 'https:\/\/www\.eporner\.com\/api\/v2\/video\/search\/[^;]+/) || [''])[0];
    expect(urlLine).toContain('/api/v2/video/search/');
    expect(urlLine).not.toContain('order=most-popular');
    expect(urlLine).not.toContain('order=');
  });

  it('eporner browse() defaults to most-popular but honors a chosen sort (S3)', () => {
    var at = SRC.indexOf("id: 'eporner'");
    var browseAt = SRC.indexOf('browse: function(category, page', at);
    expect(browseAt).toBeGreaterThan(-1);
    var browseBody = SRC.slice(browseAt, browseAt + 900);
    // _orient() now extracts {order, gay}; the chosen sort flows through to &order=.
    expect(browseBody).toMatch(/var o = self\._orient\(sort\)/);
    expect(browseBody).toMatch(/&order=' \+ o\.order/);
    // The default order (most-popular) lives in the shared _orient helper.
    var epBody = SRC.slice(at, browseAt);
    expect(epBody).toMatch(/order: sort \|\| 'most-popular'/);
  });
  it('eporner cfg exposes API order sorts (no longer sorts:[])', () => {
    var at = SRC.indexOf("id: 'eporner'");
    var cfgBody = SRC.slice(at, at + 1400);
    expect(cfgBody).toMatch(/sorts: _cats\('most-popular:/);
    expect(cfgBody).toContain('top-rated:');
  });
});

// ---------------------------------------------------------------------------
// Step 2 — personalized sorts for query-param / API sort channels
// ---------------------------------------------------------------------------
describe('Step 2: query-param / API sorts (popular first, Russian labels)', () => {
  // Pull the `sorts: _cats('...')` value for a given source id.
  function sortsFor(id) {
    var at = SRC.indexOf("id: '" + id + "'");
    expect(at).toBeGreaterThan(-1);
    var body = SRC.slice(at, at + 4000);
    var m = body.match(/sorts: _cats\('([^']*)'\)/);
    expect(m).toBeTruthy();
    return m[1].split(',').map(function (p) {
      var i = p.indexOf(':');
      return { id: p.slice(0, i), label: p.slice(i + 1) };
    });
  }

  it('_openSort no longer unshifts cherry_sort_default', () => {
    var at = SRC.indexOf('function _openSort()');
    var body = SRC.slice(at, at + 500);
    expect(body).not.toContain('cherry_sort_default');
    expect(body).not.toMatch(/items\.unshift/);
  });

  // KVS-engine + custom KVS adapters: sort_by values, popular first.
  ['xozilla', 'analdin', 'hellporno', 'pornve', 'familyporn', 'perfektdamen'].forEach(function (id) {
    it(id + ': popular first, labeled «По популярности», Russian labels', () => {
      var s = sortsFor(id);
      expect(s[0].id).toBe('video_viewed');
      expect(s[0].label).toBe('По популярности');
      // every label is Russian (Cyrillic), no leftover English/Популярное
      s.forEach(function (x) {
        expect(x.label).toMatch(/[А-Яа-я]/);
        expect(x.label).not.toBe('Популярное');
      });
    });
  });

  // cherry-ux-v2: curl-confirmed TIME-WINDOW popularity sorts on KVS query-mode
  // channels (engine appends ?sort_by= verbatim). «По популярности» stays first.
  var windowExpect = {
    xozilla:  ['video_viewed_today', 'video_viewed_week', 'video_viewed_month', 'rating_week'],
    analdin:  ['video_viewed_today', 'video_viewed_week', 'video_viewed_month', 'rating_week'],
    pornve:   ['video_viewed_today', 'video_viewed_week', 'video_viewed_month', 'rating_week', 'rating_month'],
    hellporno:['video_viewed_today', 'video_viewed_week', 'video_viewed_month', 'rating_week']
  };
  Object.keys(windowExpect).forEach(function (id) {
    it(id + ': includes curl-confirmed windowed sorts after «По популярности»', () => {
      var s = sortsFor(id);
      expect(s[0].id).toBe('video_viewed');           // all-time stays first/default
      var ids = s.map(function (x) { return x.id; });
      windowExpect[id].forEach(function (w) {
        expect(ids).toContain(w);                      // windowed value present
        var item = s.filter(function (x) { return x.id === w; })[0];
        expect(item.label).toMatch(/[А-Яа-я]/);        // Russian label
      });
      // windows come AFTER all-time popular
      expect(ids.indexOf('video_viewed_week')).toBeGreaterThan(0);
    });
  });

  it('hellporno drops invalid most_recent/latest values, includes curl-confirmed time windows', () => {
    var ids = sortsFor('hellporno').map(function (x) { return x.id; });
    expect(ids).not.toContain('most_recent');
    expect(ids).not.toContain('latest');
    expect(ids).toEqual([
      'video_viewed', 'video_viewed_today', 'video_viewed_week', 'video_viewed_month',
      'rating_week', 'post_date', 'rating', 'duration', 'most_commented'
    ]);
  });

  it('pornobolt: mv (popular) first, mc по комментариям; only valid values', () => {
    var s = sortsFor('pornobolt');
    expect(s.map(function (x) { return x.id; })).toEqual(['mv', 'mc']);
    expect(s[0].label).toBe('По популярности');
    expect(s[1].label).toBe('По комментариям');
  });

  it('pornhub: 3 base orderings (no dead longest) + composite period windows, popular first', () => {
    // Base sorts come via _cats; the time-window composites are appended as literal
    // objects (id carries a ':' so _cats can't hold them). `longest` is dropped (API no-op).
    var base = sortsFor('pornhub');
    expect(base.map(function (x) { return x.id; }))
      .toEqual(['mostviewed', 'rating', 'mostrecent']);
    expect(base[0].label).toBe('По популярности');
    expect(base.map(function (x) { return x.id; })).not.toContain('longest');
    // Composite period windows appended via .concat([...]) with ordering:period ids.
    expect(SRC).toContain("{ id: 'mostviewed:weekly',  label: 'Популярное за неделю' }");
    expect(SRC).toContain("{ id: 'mostviewed:monthly', label: 'Популярное за месяц' }");
  });

  it('eporner: popular label relabeled «По популярности», order ids preserved', () => {
    var s = sortsFor('eporner');
    expect(s.map(function (x) { return x.id; }))
      .toEqual(['most-popular', 'latest', 'top-rated', 'longest', 'top-weekly', 'top-monthly']);
    expect(s[0].label).toBe('По популярности');
  });

  it('lenporno: 2 (popular) first, 3 рейтинг; browse appends ?sort= and defaults popular', () => {
    var s = sortsFor('lenporno');
    expect(s.map(function (x) { return x.id; })).toEqual(['2', '3']);
    expect(s[0].label).toBe('По популярности');
    var at = SRC.indexOf("id: 'lenporno'");
    var browseAt = SRC.indexOf('browse: function (category, page, sort)', at);
    expect(browseAt).toBeGreaterThan(-1);
    var browseBody = SRC.slice(browseAt, browseAt + 900);
    expect(browseBody).toMatch(/var s = sort \|\| \(this\.cfg\.sorts\[0\]/);
    expect(browseBody).toMatch(/\+ 'sort=' \+ s/);
  });

  // Custom KVS adapters must actually append sort_by to the category URL.
  ['pornve', 'familyporn', 'perfektdamen'].forEach(function (id) {
    it(id + ' browse appends ?sort_by= and defaults to popular', () => {
      var at = SRC.indexOf("id: '" + id + "'");
      var browseAt = SRC.indexOf('browse: function (category, page, sort)', at);
      expect(browseAt).toBeGreaterThan(-1);
      var browseBody = SRC.slice(browseAt, browseAt + 1200);
      expect(browseBody).toMatch(/var s = sort \|\| \(this\.cfg\.sorts\[0\]/);
      expect(browseBody).toMatch(/\+ 'sort_by=' \+ s/);
    });
  });
});

describe('Step 3: PATH-segment sorts (popular first, Russian labels, segment in URL)', () => {
  function sortsFor(id) {
    var at = SRC.indexOf("id: '" + id + "'");
    expect(at).toBeGreaterThan(-1);
    var body = SRC.slice(at, at + 4000);
    var m = body.match(/sorts: _cats\('([^']*)'\)/);
    expect(m).toBeTruthy();
    return m[1].split(',').map(function (p) {
      var i = p.indexOf(':');
      return { id: p.slice(0, i), label: p.slice(i + 1) };
    });
  }
  // For each: ids in order + popular label, then the literal URL-shape the browse builds.
  var specs = {
    xvideos: {
      ids:   ['views', 'uploaddate', 'rating', 'length'],
      shape: "'https://www.xvideos.com/c/s:' + s + '/{slug}/{page}'"
    },
    porntrex: {
      ids:   ['most-popular', 'most-popular/weekly', 'most-popular/monthly', 'top-rated', 'longest', 'most-commented'],
      shape: "'https://www.porntrex.com/categories/{slug}/' + s + '/{page}/'"
    },
    pornone: {
      ids:   ['views', 'views/week', 'views/month', 'rating'],
      shape: "'https://pornone.com/{slug}/' + s + '/{page}/'"
    },
    '3movs': {
      ids:   ['most-viewed/all-time', 'most-viewed/week', 'most-viewed/month', 'top-rated/all-time', 'top-rated/week', 'top-rated/month', 'longest', 'latest-updates'],
      shape: "'https://3movs.com/categories/{slug}/' + s + '/{page}/'"
    },
    jopaonline: {
      ids:   ['popular', 'toprated'],
      shape: "'https://jopaonline.mobi/categories/{slug}/' + s + '/{page}'"
    },
    ebun: {
      ids:   ['most-popular', 'new', 'top-rated'],
      shape: "'https://www1.ebun.tv/categories/{slug}/' + s + '/{page}/'"
    }
  };
  Object.keys(specs).forEach(function (id) {
    var spec = specs[id];
    it(id + ': popular first «По популярности», Russian labels, exact ids', () => {
      var s = sortsFor(id);
      expect(s.map(function (x) { return x.id; })).toEqual(spec.ids);
      expect(s[0].label).toBe('По популярности');
      s.forEach(function (x) {
        expect(x.label).toMatch(/[А-Яа-я]/);
        expect(x.label).not.toBe('Популярное');
      });
    });
    it(id + ': browse injects sort as a path segment (default = popular)', () => {
      expect(SRC).toContain(spec.shape);
      // browse signature carries `sort`, and defaults to the popular value.
      var at = SRC.indexOf("id: '" + id + "'");
      var browseAt = SRC.indexOf('browse: function (category, page, sort)', at);
      if (browseAt < 0) browseAt = SRC.indexOf('browse: function(category, page, sort)', at);
      expect(browseAt).toBeGreaterThan(-1);
      var browseBody = SRC.slice(browseAt, browseAt + 900);
      expect(browseBody).toMatch(/var s = sort \|\|/);
    });
  });

  // KVS engine path-sort mode: crocotube + ebun-style configs declare sortMode:'path'.
  it('crocotube: sortMode:path + path-sort ids, popular first', () => {
    var at = SRC.indexOf("id: 'crocotube'");
    expect(at).toBeGreaterThan(-1);
    var body = SRC.slice(at, at + 3000);
    expect(body).toMatch(/sortMode: 'path'/);
    var s = sortsFor('crocotube');
    expect(s.map(function (x) { return x.id; })).toEqual(['most-popular', 'top-rated', 'longest']);
    expect(s[0].label).toBe('По популярности');
  });

  it('_kvsEngine path mode builds /{slug}/{sort}/{page} (not ?sort_by=) for path configs', () => {
    var eng = SRC.indexOf('function _kvsEngine(');
    expect(eng).toBeGreaterThan(-1);
    var at = SRC.indexOf('browse: function(category, page, sort)', eng);
    expect(at).toBeGreaterThan(-1);
    var body = SRC.slice(at, at + 1400);
    expect(body).toContain("cfg.sortMode === 'path'");
    // path mode injects the sort segment after the slug in the categoryFmt
    expect(body).toMatch(/replace\('\{slug\}', '\{slug\}\/' \+ s\)/);
    // query mode (xozilla/analdin/etc.) still appends ?sort_by= when sortMode absent
    expect(body).toMatch(/sp \+ '=' \+ s/);
  });

  it('query-mode KVS adapters (xozilla/analdin) keep ?sort_by= (no sortMode)', () => {
    ['xozilla', 'analdin'].forEach(function (id) {
      var at = SRC.indexOf("id: '" + id + "'");
      expect(at).toBeGreaterThan(-1);
      var body = SRC.slice(at, at + 1500);
      expect(body).not.toMatch(/sortMode: 'path'/);
    });
  });
});

describe('Phase 3 A3(b): all_sources per-source title-match filter before slice', () => {
  it('filter uses indexOf(query) and runs before slice(0,10)', () => {
    var at = SRC.indexOf('All-sources search');
    expect(at).toBeGreaterThan(-1);
    var body = SRC.slice(at, at + 3300);
    // per-source title match
    expect(body).toMatch(/\.toLowerCase\(\)\.indexOf\(ql\)\s*!==\s*-1/);
    // filter executes before the slice
    var filterIdx = body.indexOf('indexOf(ql)');
    var sliceIdx  = body.indexOf('picked.slice(0, 10)');
    expect(filterIdx).toBeGreaterThan(-1);
    expect(sliceIdx).toBeGreaterThan(filterIdx);
  });

  it('non-ASCII (Cyrillic) queries skip the filter', () => {
    var at = SRC.indexOf('All-sources search');
    var body = SRC.slice(at, at + 3300);
    expect(body).toMatch(/isLatin\s*=\s*\/\^\[\\x00-\\x7F\]\*\$\/\.test\(ql\)/);
    expect(body).toMatch(/if\s*\(ql\s*&&\s*isLatin\)/);
  });

  it('keeps a source unfiltered top-N when its filtered slice is empty', () => {
    var at = SRC.indexOf('All-sources search');
    var body = SRC.slice(at, at + 3300);
    expect(body).toMatch(/if\s*\(matched\.length\)\s*picked\s*=\s*matched/);
  });
});

describe('all_sources pagination wiring', () => {
  function allSourcesBody() {
    var at = SRC.indexOf('All-sources search');
    expect(at).toBeGreaterThan(-1);
    // Window widened: the branch grew with the per-source timeout race wrapper.
    return SRC.slice(at, at + 4200);
  }

  it('queries every source for the requested page (not hardcoded 1)', () => {
    var body = allSourcesBody();
    expect(body).toMatch(/src\.search\(object\.query,\s*page\)/);
    expect(body).not.toMatch(/src\.search\(object\.query,\s*1\)/);
  });

  it('tracks a full batch (>=10) to know another page exists', () => {
    var body = allSourcesBody();
    expect(body).toMatch(/anyFull\s*=\s*false/);
    expect(body).toMatch(/r\.items\.length\s*>=\s*10[\s\S]{0,40}anyFull\s*=\s*true/);
  });

  it('derives total_pages: generous forward (page+50) when a full batch returned, else page (last)', () => {
    var body = allSourcesBody();
    // Generous forward window so InteractionCategory keeps paginating (page+1 stopped after one page).
    expect(body).toMatch(/resolve\(flat\.map\(toCard\),\s*anyFull\s*\?\s*\(page\s*\+\s*50\)\s*:\s*page\)/);
  });

  it('first-screen-fast: each source races search against a per-source timeout', () => {
    var body = allSourcesBody();
    // A named timeout const + a Promise.race so one hung source can never block
    // the whole page (first screen returns in ≤ the cap, others stream on scroll).
    expect(body).toMatch(/var ALL_SRC_TIMEOUT_MS = 7000;/);
    expect(body).toMatch(/Promise\.race\(\[search, timeout\]\)/);
    // A timed-out source resolves to an empty batch (so it contributes [] and is
    // not miscounted toward anyFull / total_pages).
    expect(body).toMatch(/setTimeout\(function \(\) \{[\s\S]{0,120}r\(\{ items: \[\], total_pages: 1, _srcId: src\.id \}\);[\s\S]{0,20}\}, ALL_SRC_TIMEOUT_MS\)/);
  });
});

describe('per-channel search pagination audit', () => {
  it('paginating searches pass the page param into the URL', () => {
    // representative paginating per-source searches: each must thread page/p into URL
    expect(SRC).toMatch(/src\.search\(object\.query,\s*page,\s*currentSort\)/); // per-source grid load
    expect(SRC).toMatch(/cfg\.searchUrl\(query,\s*page\)/);                     // KVS engine search
  });

  it('genuinely single-page searches stay total_pages:1 and are documented', () => {
    var singlePageHits = SRC.match(/single-page search \(site\)/g) || [];
    // pornobolt, 24rolika, jopaonline (tizam now uses the real /search-results/ form;
    // lenporno now paginates via /search/{q}/?page= → both no longer single-page-broken).
    expect(singlePageHits.length).toBeGreaterThanOrEqual(3);
  });

  it('tizam search uses the real /search-results/?search_string= form (not /?s=)', () => {
    var at = SRC.indexOf("id: 'tizam'");
    var body = SRC.slice(SRC.indexOf('search: function', at), SRC.indexOf('browse: function', at));
    expect(body).toContain("'https://tv4.tizam.org/search-results/?search_string=' + encodeURIComponent(query)");
    expect(body).not.toContain("'https://tv4.tizam.org/?s='");
  });

  it('hqporner search uses /?q={query}&p={page} (not the soft-404 /search/{slug}/)', () => {
    var at = SRC.indexOf("id: 'hqporner'");
    var body = SRC.slice(SRC.indexOf('search: function', at), SRC.indexOf('cfg:', at));
    expect(body).toContain("'https://hqporner.com/?q=' + encodeURIComponent(query) + '&p=' + p");
    expect(body).not.toContain("'https://hqporner.com/search/'");
    expect(body).toContain('_derivePages');
  });

  it('lenporno search uses /search/{query}/?page={p} with _derivePages (not /search/?q=)', () => {
    var at = SRC.indexOf("id: 'lenporno'");
    var body = SRC.slice(SRC.indexOf('search: function', at), SRC.indexOf('browse: function', at));
    expect(body).toContain("'https://www.lenporno.net/search/' + encodeURIComponent(query) + '/?page=' + p");
    expect(body).not.toContain("'https://www.lenporno.net/search/?q='");
    expect(body).toContain('_derivePages');
  });

  it('spankbang search still builds /s/{query}/{page}/', () => {
    var at = SRC.indexOf("id: 'spankbang'");
    var body = SRC.slice(SRC.indexOf('search: function', at), SRC.indexOf('browse: function', at));
    expect(body).toContain("'https://ru.spankbang.com/s/' + q + '/' + p + '/'");
  });
});

describe('Phase 3 A2: all_sources client-side sort exposed in the action menu', () => {
  it('_hasClientSort flag set for all_sources + query', () => {
    expect(SRC).toMatch(/_hasClientSort\s*=\s*!!\(object\.all_sources\s*&&\s*object\.query\)/);
  });

  it('action menu pushes a clientsort entry', () => {
    expect(SRC).toMatch(/_hasClientSort[\s\S]{0,80}action:\s*'clientsort'/);
    expect(SRC).toMatch(/item\.action\s*===\s*'clientsort'/);
  });

  it('_openClientSort re-pushes with client_sort and applies duration in _gridLoad', () => {
    expect(SRC).toMatch(/function _openClientSort\(\)/);
    expect(SRC).toMatch(/client_sort:\s*item\.id/);
    expect(SRC).toMatch(/object\.client_sort\s*===\s*'duration'/);
  });

  it('client sort offers relevance (default) and duration only', () => {
    var at = SRC.indexOf('function _openClientSort()');
    var body = SRC.slice(at, at + 500);
    expect(body).toContain('cherry_sort_relevance');
    expect(body).toContain('cherry_sort_duration');
    // no popular/views claim for all_sources (data not uniform)
    expect(body).not.toMatch(/cherry_sort_(popular|views)/);
  });

  it('client-sort lang keys registered (ru/en)', () => {
    expect(SRC).toMatch(/cherry_sort_relevance:\s*\{\s*ru:/);
    expect(SRC).toMatch(/cherry_sort_duration:\s*\{\s*ru:/);
  });
});

describe('Phase 3 A2: client-side duration sort — POST behaviour', () => {
  // Mirror of the _gridLoad all_sources sort branch.
  function clientSort(flat, mode) {
    if (mode === 'duration') {
      flat = flat.slice().sort(function (a, b) { return (b.duration || 0) - (a.duration || 0); });
    }
    return flat;
  }
  var items = [
    { title: 'a', duration: 120 },
    { title: 'b', duration: 600 },
    { title: 'c', duration: 0 },
    { title: 'd' } // missing duration
  ];

  it('duration sort orders descending, missing duration treated as 0', () => {
    var out = clientSort(items, 'duration').map(function (v) { return v.title; });
    expect(out).toEqual(['b', 'a', 'c', 'd']);
  });

  it('relevance (default) preserves the original interleaved order', () => {
    var out = clientSort(items, '').map(function (v) { return v.title; });
    expect(out).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('Phase 3 A3(b): per-source title filter — POST behaviour', () => {
  // Mirror of the _gridLoad all_sources merge filter.
  function mergeFiltered(results, query) {
    var flat = [];
    var ql = (query || '').toLowerCase();
    var isLatin = /^[\x00-\x7F]*$/.test(ql);
    results.forEach(function (r) {
      if (r && r.items && r.items.length) {
        var picked = r.items;
        if (ql && isLatin) {
          var matched = r.items.filter(function (v) { return (v.title || '').toLowerCase().indexOf(ql) !== -1; });
          if (matched.length) picked = matched;
        }
        flat = flat.concat(picked.slice(0, 10));
      }
    });
    return flat;
  }

  it('keeps only title-matching cards for a Latin query', () => {
    var res = [{ items: [{ title: 'Woodman casting' }, { title: 'random clip' }] }];
    var out = mergeFiltered(res, 'woodman').map(function (v) { return v.title; });
    expect(out).toEqual(['Woodman casting']);
  });

  it('falls back to unfiltered top-N when nothing matches (source not dropped)', () => {
    var res = [{ items: [{ title: 'aaa' }, { title: 'bbb' }] }];
    var out = mergeFiltered(res, 'woodman');
    expect(out).toHaveLength(2);
  });

  it('skips the filter for Cyrillic queries (titles often English)', () => {
    var res = [{ items: [{ title: 'Anal scene' }, { title: 'Teen clip' }] }];
    var out = mergeFiltered(res, 'анал');
    expect(out).toHaveLength(2); // not filtered out
  });

  it('caps each source at 10 after filtering', () => {
    var many = [];
    for (var i = 0; i < 25; i++) many.push({ title: 'woodman ' + i });
    var out = mergeFiltered([{ items: many }], 'woodman');
    expect(out).toHaveLength(10);
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

// ---------------------------------------------------------------------------
// Final sort batch — xnxx PATH sort + youjizz/hqporner/spankbang GLOBAL feeds,
// and the three confirmed-empty DLE/AJAX sources.
// ---------------------------------------------------------------------------
describe('Final sort batch: xnxx PATH + youjizz/hqporner/spankbang GLOBAL feeds', () => {
  // sorts: _cats('...') for an array-literal (non-KVS) source body.
  function sortsFor(id) {
    var at = SRC.indexOf("id: '" + id + "'");
    expect(at).toBeGreaterThan(-1);
    var body = SRC.slice(at, at + 6000);
    var m = body.match(/sorts: _cats\('([^']*)'\)/);
    expect(m).toBeTruthy();
    return m[1].split(',').map(function (p) {
      var i = p.indexOf(':');
      return { id: p.slice(0, i), label: p.slice(i + 1) };
    });
  }
  function browseBodyOf(id) {
    var at = SRC.indexOf("id: '" + id + "'");
    expect(at).toBeGreaterThan(-1);
    var bAt = SRC.indexOf('browse: function(category, page, sort)', at);
    if (bAt < 0) bAt = SRC.indexOf('browse: function (category, page, sort)', at);
    expect(bAt).toBeGreaterThan(-1);
    return SRC.slice(bAt, bAt + 1100);
  }

  // ---- xnxx: sort as a FILTER prefix on the paginating /search route ----
  it('xnxx: sorts = hits (popular) + month/year windows, popular first, Russian labels', () => {
    var s = sortsFor('xnxx');
    expect(s.map(function (x) { return x.id; })).toEqual(['hits', 'month', 'year']);
    expect(s[0].label).toBe('По популярности');
    s.forEach(function (x) {
      expect(x.label).toMatch(/[А-Яа-я]/);
      expect(x.label).not.toBe('Популярное');
    });
  });
  it('xnxx category browse prepends sort as a /search/{sort}/{slug}/{page} filter segment', () => {
    var body = browseBodyOf('xnxx');
    // sort is prepended as a path segment before the category slug
    expect(body).toContain("var prefix = sort ? encodeURIComponent(sort) + '/' : '';");
    expect(body).toContain("'https://www.xnxx.com/search/' + prefix + encodeURIComponent(category) + '/' + p");
    expect(body).not.toContain('/tags/{slug}');
  });

  // ---- youjizz / hqporner / spankbang: GLOBAL-feed sorts ----
  var globalSpecs = {
    youjizz: {
      ids:    ['most-popular', 'trending', 'top-rated', 'top-rated-week', 'top-rated-month', 'highdefinition', 'newest-clips'],
      // no-category global feed shape
      feed:   "'https://www.youjizz.com/' + (sort || 'most-popular') + '/' + p + '.html'",
      // category shape stays unchanged (no sort)
      cat:    "'https://www.youjizz.com/categories/{slug}-{page}.html'"
    },
    hqporner: {
      ids:    ['top', 'hdporn', 'top/week', 'top/month'],
      feed:   "var base = 'https://hqporner.com/' + (sort || 'top');",
      cat:    "'https://hqporner.com/category/{slug}/{page}'"
    },
    spankbang: {
      ids:    ['most_popular', 'trending_videos', 'new_videos', 'upcoming'],
      feed:   "'https://ru.spankbang.com/' + (sort || 'most_popular') + '/' + p + '/'",
      cat:    "'https://ru.spankbang.com/s/{slug}/{page}/'"
    }
  };
  Object.keys(globalSpecs).forEach(function (id) {
    var spec = globalSpecs[id];
    it(id + ': popular first «По популярности», Russian labels, exact ids', () => {
      var s = sortsFor(id);
      expect(s.map(function (x) { return x.id; })).toEqual(spec.ids);
      expect(s[0].label).toBe('По популярности');
      s.forEach(function (x) {
        expect(x.label).toMatch(/[А-Яа-я]/);
        expect(x.label).not.toBe('Популярное');
      });
    });
    it(id + ': no-category browse builds the GLOBAL sorted feed (default popular)', () => {
      var body = browseBodyOf(id);
      expect(body).toContain(spec.feed);
      // browse signature carries sort
      expect(body).toMatch(/^browse: function ?\(category, page, sort\)/);
    });
    it(id + ': category browse still builds the category URL (no sort)', () => {
      var body = browseBodyOf(id);
      expect(body).toContain(spec.cat);
      // the category URL string must not interpolate sort
      expect(body).not.toMatch(/category[\s\S]{0,40}\+ \(sort/);
    });
  });
});

describe('Final sort batch: DLE/AJAX sources stay sorts:[] (documented)', () => {
  ['24rolika', 'porndig', 'tizam'].forEach(function (id) {
    it(id + ': sorts is the empty array with a documenting comment', () => {
      var at = SRC.indexOf("id: '" + id + "'");
      expect(at).toBeGreaterThan(-1);
      // Scope to this source's cfg line (the one with its own sorts: declaration).
      var cfgAt = SRC.indexOf('sorts: [', at);
      expect(cfgAt).toBeGreaterThan(-1);
      var line = SRC.slice(cfgAt, SRC.indexOf('\n', cfgAt));
      // Must remain the literal empty array with the documenting comment (not _cats).
      expect(line).toMatch(/^sorts: \[\]/);
      expect(line).not.toContain('_cats');
      expect(line).toContain('not URL-addressable');
    });
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
    var w = SRC.slice(at, at + 3500);
    expect(w).toContain('cfg:');
    expect(w).toContain('_fetchAny');
    expect(w).toContain('_buildCatUrl');
  });
  ['porntrex','pornve','familyporn'].forEach(function (id) {
    it(id + ' has cfg.categories + uses _buildCatUrl in browse', () => {
      var at = SRC.indexOf("id: '" + id + "'");
      expect(at).toBeGreaterThan(-1);
      var w = SRC.slice(at, at + 3500);
      expect(w).toContain('cfg:');
      expect(w).toContain('_buildCatUrl');
    });
  });
});

// ── Batch 3: Deno-routed categories (xnxx, eporner, pornone, perfektdamen, hqporner) ──
describe('Batch 3 categories — plugin.js source assertions (anti-drift)', () => {
  // Category-URL templates must be present (position-independent — cfg may sit far from id).
  var fmts = {
    // xnxx categories use the paginating /search/ route (/tags/ ignored the page param);
    // a chosen sort is prepended as a filter segment (/search/{sort}/{slug}/{page}).
    xnxx: "'https://www.xnxx.com/search/' + prefix + encodeURIComponent(category) + '/' + p",
    perfektdamen: 'https://www.perfektdamen.co/tags/{slug}/{page}/',
    hqporner: 'https://hqporner.com/category/{slug}/{page}'
  };
  Object.keys(fmts).forEach(function (id) {
    it(id + ' wires its categoryFmt template', () => {
      expect(SRC).toContain(fmts[id]);
    });
  });
  it('pornone wires its categoryFmt template (path-sort: {slug}/{sort}/{page})', () => {
    // Sort is a path segment after the slug; default = views (По популярности).
    expect(SRC).toContain("'https://pornone.com/{slug}/' + s + '/{page}/'");
  });
  it('eporner category uses API query (slug→keyword)', () => {
    expect(SRC).toContain('category.replace(/-/g');
  });
  it('Deno adapters shipped category lists (representative labels present)', () => {
    expect(SRC).toContain('webcam:Webcam');   // eporner webcam (EN site)
    expect(SRC).toContain('shemale:Shemale'); // hqporner shemale (EN site)
    expect(SRC).toContain('granny:Granny');   // pornone granny (EN site)
  });
});

// ── Batch 4: custom categories (xvideos, youjizz, spankbang, porndig, tizam) ──
describe('Batch 4 categories — plugin.js source assertions (anti-drift)', () => {
  it('xvideos category template /c/s:{sort}/{slug}/{page} (path-sort before slug)', () => {
    // Sort segment s:{value} sits BEFORE the slug; default = views (По популярности).
    expect(SRC).toContain("'https://www.xvideos.com/c/s:' + s + '/{slug}/{page}'");
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
  it('jopaonline /categories/{slug}/{sort}/{page} template (path-sort after slug)', () => {
    // Sort segment after the slug; default = popular (По популярности).
    expect(SRC).toContain("'https://jopaonline.mobi/categories/{slug}/' + s + '/{page}'");
  });
  it('ebun /categories/{slug}/{sort}/{page}/ template (path-sort after slug)', () => {
    // Sort segment after the slug; default = most-popular (По популярности).
    expect(SRC).toContain("'https://www1.ebun.tv/categories/{slug}/' + s + '/{page}/'");
  });
  it('lenporno root /{slug}/{page}/ template', () => {
    expect(SRC).toContain('https://www.lenporno.net/{slug}/{page}/');
  });
  it('pornhub category via webmasters &category= param', () => {
    expect(SRC).toContain("'&category=' + encodeURIComponent(category)");
  });
});

// ── Pornhub webmasters API fix (slugs + orderings + pagination) ───────────────
// Anti-drift assertions against the pornhub adapter source, plus a behavior test
// for the total_pages derivation logic (API ships {videos:[...]} with no count).
describe('Pornhub adapter — webmasters slugs/orderings/pagination', () => {
  // Isolate the pornhub adapter block so assertions don't accidentally match
  // another adapter's cfg.
  const PH = (() => {
    const start = SRC.indexOf("id: 'pornhub'");
    const end = SRC.indexOf('_parseHtmlCards', start);
    return SRC.slice(start, end);
  })();

  it('categories use SLUGS (bbw, red-head, milf), not numeric ids', () => {
    expect(PH).toContain('bbw:BBW');
    expect(PH).toContain('red-head:Red Head');
    expect(PH).toContain('milf:MILF');
    expect(PH).toContain('18-25:Teen 18-25');
    expect(PH).toContain('russian:Russian');
    expect(PH).toContain('webcam:Webcam');
  });

  it('categories contain NO bare numeric ids (e.g. "6:", "31:")', () => {
    const catsMatch = PH.match(/categories:\s*_cats\('([^']*)'\)/);
    expect(catsMatch).toBeTruthy();
    const pairs = catsMatch[1].split(',');
    for (const pair of pairs) {
      const id = pair.slice(0, pair.indexOf(':'));
      // a real slug is never purely digits
      expect(/^\d+$/.test(id)).toBe(false);
    }
  });

  it('hairy/Волосатые dropped (no such slug in the API)', () => {
    expect(PH).not.toContain('Волосатые');
    expect(PH).not.toContain('hairy:');
  });

  it('sorts: 3 valid base orderings (no dead longest) + composite period windows', () => {
    const sortsMatch = PH.match(/sorts:\s*_cats\('([^']*)'\)/);
    expect(sortsMatch).toBeTruthy();
    const ids = sortsMatch[1].split(',').map(p => p.slice(0, p.indexOf(':')));
    // `longest` removed — the webmasters API silently ignored it (no-op = mostrecent).
    expect(ids).toEqual(['mostviewed', 'rating', 'mostrecent']);
    expect(ids).not.toContain('longest');
    // Time-window composites appended as literal objects (ids carry a ':').
    expect(PH).toContain("{ id: 'mostviewed:weekly',  label: 'Популярное за неделю' }");
    expect(PH).toContain("{ id: 'mostviewed:monthly', label: 'Популярное за месяц' }");
  });

  it('sorts contain NO legacy fake ids (mv/tr/mr)', () => {
    const sortsMatch = PH.match(/sorts:\s*_cats\('([^']*)'\)/);
    const ids = sortsMatch[1].split(',').map(p => p.slice(0, p.indexOf(':')));
    expect(ids).not.toContain('mv');
    expect(ids).not.toContain('tr');
    expect(ids).not.toContain('mr');
  });

  it('browse/search split composite sort id into ordering+period (default mostviewed, no mv special-case)', () => {
    // _sortParams splits "ordering:period" → {ordering, period}; no ':' = all-time.
    expect(PH).toContain('_sortParams: function(sort)');
    expect(PH).toContain("var parts = String(sort || 'mostviewed').split(':');");
    expect(PH).not.toContain("!== 'mv'");
    expect(PH).toContain("'&ordering=' + sp.ordering");
    expect(PH).toContain("(sp.period ? '&period=' + sp.period : '')");
  });

  it('total_pages derived via _derivePages (generous forward, no broken total_pages parse)', () => {
    expect(PH).not.toContain('data.total_pages');
    expect(PH).not.toContain('data.pagesTotal');
    expect(PH).toContain('_PAGE_SIZE');
    expect(PH).toMatch(/_derivePages\(items\.length, p, self\._PAGE_SIZE\)/);
    expect(PH).not.toContain('(p + 1)');
  });

  // Behavior: full batch (>= PAGE_SIZE) means there's likely a next page;
  // a short batch means we've hit the last page.
  it('pagination logic: full batch -> page+1, short batch -> page', () => {
    const PAGE_SIZE = 30;
    const derive = (items, page) =>
      (items.length >= PAGE_SIZE ? page + 1 : page);

    const fullBatch = new Array(30).fill({});
    const shortBatch = new Array(7).fill({});
    const emptyBatch = [];

    expect(derive(fullBatch, 1)).toBe(2);  // keep scrolling
    expect(derive(fullBatch, 5)).toBe(6);
    expect(derive(shortBatch, 3)).toBe(3); // stop here
    expect(derive(emptyBatch, 4)).toBe(4); // stop here
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

describe('UX-batch-1: focus = brand ring + zoom on .card__view (inner box, no double frame)', () => {
  it('focused card view gets a 1.07 scale zoom', () => {
    var m = SRC.match(/\.cherry-cat \.card\.focus \.card__view\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/transform:scale\(1\.07\)/);
  });
  it('focused card view gets the brand pink ring (.22em) + drop shadow', () => {
    var m = SRC.match(/\.cherry-cat \.card\.focus \.card__view\{([^}]*)\}/);
    expect(m[1]).toMatch(/box-shadow:0 0 0 \.22em #e75480/);
  });
  it('focus transition is 180ms (TV-window motion), applied on the inner box only', () => {
    var m = SRC.match(/\.cherry-cat \.card\.focus \.card__view\{([^}]*)\}/);
    expect(m[1]).toMatch(/transition:transform \.18s ease, box-shadow \.18s ease/);
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
    // Bound to CherryMain's body (ends where addStyles begins), not a brittle
    // fixed offset — the body grows as features (e.g. the sync tile) are added.
    var end = SRC.indexOf('function addStyles', start);
    return SRC.slice(start, end > -1 ? end : start + 4000);
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
  it('active filter is carried on the ACTIVITY title via _filteredTitle + _findLabel', () => {
    // The filter must live on the pushed activity title (top bar), not just build().
    expect(SRC).toMatch(/function _filteredTitle\(sort, category\)/);
    expect(SRC).toMatch(/_filteredTitle[\s\S]{0,300}_findLabel\(/);
    expect(SRC).toMatch(/title:\s*_filteredTitle\(sort, category\)/);
  });
  it('build()/resolve() use screenTitle (which already equals the filtered activity title)', () => {
    // No _titleWithFilters anymore — would double the suffix on top of the activity title.
    expect(SRC).not.toMatch(/_titleWithFilters/);
    expect(SRC).toMatch(/\.build\(\{\s*title:\s*screenTitle/);
  });
});

describe('UI/UX v2: P3.2 error != empty + persistent fav hint', () => {
  it('cherry_load_error lang string added (RU + EN)', () => {
    expect(SRC).toMatch(/cherry_load_error:\s*\{\s*ru:\s*'Не удалось загрузить\. Проверьте соединение\.'/);
    expect(SRC).toMatch(/cherry_load_error:[\s\S]{0,120}en:\s*'Failed to load\. Check your connection\.'/);
  });
  it('load failure branch calls empty(cherry_load_error) with a focusable retry', () => {
    // UX-batch-1: error now passes a retry callback (D-pad recovery) as a 2nd arg.
    expect(SRC).toMatch(/\.empty\(\s*Lampa\.Lang\.translate\(\s*'cherry_load_error'\s*\)\s*,\s*function/);
    expect(SRC).toMatch(/cherry_retry:\s*\{\s*ru:\s*'Повторить'/);
  });
  it('empty favorites calls empty(cherry_fav_empty_hint), not a toast', () => {
    expect(SRC).toMatch(/\.empty\(\s*Lampa\.Lang\.translate\(\s*'cherry_fav_empty_hint'\s*\)\s*\)/);
    // the old transient toast for empty favorites must be gone
    expect(SRC).not.toMatch(/cherry_fav_empty_hint'\),\s*\{\s*time:\s*10000/);
  });
  it('custom comp.empty(msg, onRetry) override honours a message arg via Lampa.Empty', () => {
    expect(SRC).toMatch(/comp\.empty\s*=\s*function\s*\(\s*msg\s*,\s*onRetry\s*\)/);
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
