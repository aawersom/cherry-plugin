/**
 * Tests for the WATCH HISTORY + RESUME feature (continue-watching).
 *
 * Two layers (same convention as cherry-favsync.test.mjs):
 *   1. REAL behaviour — the actual `Hist` object literal is sliced out of
 *      plugin.js and evaluated against a mock Lampa, so mark/all/get/percent
 *      and migration robustness are exercised verbatim (not a hand-written
 *      mirror that could drift).
 *   2. Anti-drift source assertions — grep plugin.js for the load-bearing
 *      constructs (timeline wiring in playVideo, «Продолжить» tile, is_history
 *      grid branch, progress-bar injection, lang key, CSS).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');

// ------------------------------------------------------------------
// Harness: slice the real `Hist` object literal from plugin.js and
// evaluate it against a mock Lampa.Storage.
// ------------------------------------------------------------------
function sliceObject(src, decl) {
  var start = src.indexOf(decl);
  if (start < 0) throw new Error('decl not found: ' + decl);
  var brace = src.indexOf('{', start);
  var depth = 0, i = brace;
  for (; i < src.length; i++) {
    var c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

const HIST_SRC = sliceObject(SRC, 'var Hist = ');

function makeSandbox(opts) {
  opts = opts || {};
  var store = Object.assign({}, opts.initial || {});
  var Lampa = {
    Storage: {
      get: function (k, d) { return k in store ? store[k] : d; },
      set: function (k, v) { store[k] = v; }
    }
  };
  // eslint-disable-next-line no-new-func
  var factory = new Function('Lampa', HIST_SRC + '\nreturn Hist;');
  var Hist = factory(Lampa);
  return { Hist: Hist, store: store };
}

function vid(over) {
  return Object.assign({ id: 'v1', source: 's1', title: 'A', thumb: 't', url: 'u', duration: 100 }, over || {});
}

// ==================================================================
// Hist — mark / upsert
// ==================================================================
describe('Hist: mark (upsert by source+id, stamps ts)', () => {
  it('inserts a new record with position/duration/ts', () => {
    var sb = makeSandbox();
    sb.Hist.mark(vid(), 30, 100);
    var rec = sb.store.cherry_history[0];
    expect(rec.id).toBe('v1');
    expect(rec.source).toBe('s1');
    expect(rec.position).toBe(30);
    expect(rec.duration).toBe(100);
    expect(rec.ts).toBeGreaterThan(0);
  });

  it('upserts in place (same source+id updates, not duplicates)', () => {
    var sb = makeSandbox();
    sb.Hist.mark(vid(), 10, 100);
    sb.Hist.mark(vid(), 55, 100);
    expect(sb.store.cherry_history.length).toBe(1);
    expect(sb.store.cherry_history[0].position).toBe(55);
  });

  it('distinguishes records by source AND id', () => {
    var sb = makeSandbox();
    sb.Hist.mark(vid({ id: 'a', source: 's1' }), 10, 100);
    sb.Hist.mark(vid({ id: 'a', source: 's2' }), 20, 100);
    expect(sb.store.cherry_history.length).toBe(2);
  });

  it('ignores marks for elements without an id', () => {
    var sb = makeSandbox();
    sb.Hist.mark({ source: 's1', title: 'no-id' }, 10, 100);
    expect(sb.store.cherry_history || []).toHaveLength(0);
  });

  it('caps storage at 100 most-recent records', () => {
    var sb = makeSandbox();
    for (var i = 0; i < 120; i++) sb.Hist.mark(vid({ id: 'v' + i }), i, 100);
    expect(sb.store.cherry_history.length).toBe(100);
  });
});

// ==================================================================
// Hist — all (sorted by ts desc)
// ==================================================================
describe('Hist: all (newest first)', () => {
  it('returns records sorted by ts descending', () => {
    var sb = makeSandbox({
      initial: {
        cherry_history: [
          { id: 'old', source: 's', position: 1, duration: 10, ts: 100 },
          { id: 'new', source: 's', position: 1, duration: 10, ts: 300 },
          { id: 'mid', source: 's', position: 1, duration: 10, ts: 200 }
        ]
      }
    });
    var ids = sb.Hist.all().map(function (r) { return r.id; });
    expect(ids).toEqual(['new', 'mid', 'old']);
  });
});

// ==================================================================
// Hist — get
// ==================================================================
describe('Hist: get', () => {
  it('finds the record for a matching element', () => {
    var sb = makeSandbox();
    sb.Hist.mark(vid({ id: 'x' }), 42, 100);
    expect(sb.Hist.get(vid({ id: 'x' })).position).toBe(42);
  });

  it('returns null for an unseen element', () => {
    var sb = makeSandbox();
    expect(sb.Hist.get(vid({ id: 'never' }))).toBeNull();
  });
});

// ==================================================================
// Hist — percent
// ==================================================================
describe('Hist: percent (position/duration → 0..100)', () => {
  it('computes watched percent', () => {
    var sb = makeSandbox();
    sb.Hist.mark(vid(), 60, 100);
    expect(sb.Hist.percent(vid())).toBe(60);
  });

  it('returns 0 when there is no record', () => {
    var sb = makeSandbox();
    expect(sb.Hist.percent(vid({ id: 'none' }))).toBe(0);
  });

  it('returns 0 when duration is unknown (avoids divide-by-zero)', () => {
    var sb = makeSandbox();
    sb.Hist.mark(vid(), 30, 0);
    expect(sb.Hist.percent(vid())).toBe(0);
  });

  it('clamps to 100 when position exceeds duration', () => {
    var sb = makeSandbox();
    sb.Hist.mark(vid(), 150, 100);
    expect(sb.Hist.percent(vid())).toBe(100);
  });
});

// ==================================================================
// Hist — migration / robustness
// ==================================================================
describe('Hist: migration / robustness', () => {
  it('tolerates non-array storage (returns empty)', () => {
    var sb = makeSandbox({ initial: { cherry_history: 'corrupt' } });
    expect(sb.Hist.all()).toEqual([]);
  });

  it('drops legacy entries without an id', () => {
    var sb = makeSandbox({
      initial: { cherry_history: [{ source: 's', position: 1 }, { id: 'ok', source: 's', position: 2, ts: 5 }] }
    });
    var all = sb.Hist.all();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('ok');
  });

  it('defaults missing fields on partial records', () => {
    var sb = makeSandbox({ initial: { cherry_history: [{ id: 'p', source: 's' }] } });
    var r = sb.Hist.all()[0];
    expect(r.position).toBe(0);
    expect(r.duration).toBe(0);
    expect(r.ts).toBe(0);
    expect(r.title).toBe('');
  });
});

// ==================================================================
// Anti-drift source assertions
// ==================================================================
describe('plugin.js source assertions (anti-drift)', () => {
  it('Hist uses the cherry_history storage key', () => {
    expect(HIST_SRC).toContain("_key: 'cherry_history'");
  });

  it('playVideo wires the native timeline + a stable hash/id into Player.play', () => {
    expect(SRC).toContain('Lampa.Timeline.view(hashId)');
    expect(SRC).toContain('Hist._hashKey(video)');
    expect(SRC).toMatch(/Lampa\.Player\.play\(\{[\s\S]*?id:\s*hashId[\s\S]*?timeline:\s*timeline/);
  });

  it('the player listener snapshots the timeline into Hist on progress/destroy', () => {
    expect(SRC).toMatch(/timeupdate.*destroy[\s\S]*?Hist\.mark\(_histVideo/);
  });

  it('CherryMain shows the «Продолжить» tile only when history is non-empty', () => {
    expect(SRC).toMatch(/if \(Hist\.all\(\)\.length\)[\s\S]*?_kind: 'continue'/);
  });

  it('continue tile onEnter pushes an is_history grid', () => {
    expect(SRC).toMatch(/_kind === 'continue'[\s\S]*?is_history:\s*true/);
  });

  it('_gridLoad has an is_history branch returning Hist.all (single page)', () => {
    expect(SRC).toMatch(/if \(object\.is_history\)[\s\S]*?Hist\.all\(\)\.map\(toCard\)/);
  });

  it('is_history is single-page (excluded from nextPageReuest paging)', () => {
    expect(SRC).toContain('object.is_favorites || object.is_history');
  });

  it('cardRender injects a .cherry-progress bar when a record exists', () => {
    expect(SRC).toMatch(/if \(Hist\.get\(element\)\)[\s\S]*?cherry-progress/);
  });

  it('addStyles defines the .cherry-progress CSS', () => {
    expect(SRC).toContain('.cherry-cat .cherry-progress{');
  });

  it('defines the cherry_continue lang key (ru/en)', () => {
    expect(SRC).toMatch(/cherry_continue:\s*\{\s*ru:\s*'RP',\s*en:\s*'Continue'/);
  });

  it('history tile («РП») is placed LAST — after the SOURCES.forEach loop', () => {
    const sourcesAt = SRC.indexOf('SOURCES.forEach(function (src) {');
    const continueAt = SRC.indexOf("_kind: 'continue'");
    expect(sourcesAt).toBeGreaterThan(-1);
    expect(continueAt).toBeGreaterThan(sourcesAt); // continue tile pushed after sources
  });
});
