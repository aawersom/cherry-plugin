/**
 * Tests for the PIN-based cross-device favorites sync feature.
 *
 * Two layers (same convention as cherry-ux-v2.test.mjs):
 *   1. REAL behaviour — the actual `Fav` and `Sync` object literals are sliced
 *      out of plugin.js and evaluated against a mock Lampa + mock fetch, so the
 *      migration / toggle / merge / sync logic is exercised verbatim (not a
 *      hand-written mirror that could drift).
 *   2. Anti-drift source assertions — grep plugin.js for the load-bearing
 *      constructs (favs URL, sync tile, lang key, startup hook).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');

// ------------------------------------------------------------------
// Harness: slice the real `Fav` and `Sync` object literals from plugin.js
// and evaluate them in a controlled scope. PROXY_URL / getProxyKey /
// cherryPostJson / Lampa are injected via the eval closure.
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
  // include the closing `};`
  return src.slice(start, i + 1);
}

const FAV_SRC  = sliceObject(SRC, 'var Fav = ');
const SYNC_SRC = sliceObject(SRC, 'var Sync = ');

/**
 * Build a fresh { Fav, Sync, store, fetchMock, Lampa } sandbox.
 * @param {Object} opts  { initial: storage seed, response: fetch JSON }
 */
function makeSandbox(opts) {
  opts = opts || {};
  var store = Object.assign({}, opts.initial || {});
  var Lampa = {
    Storage: {
      get: function (k, d) { return k in store ? store[k] : d; },
      set: function (k, v) { store[k] = v; }
    },
    Activity: { active: function () { return null; } }
  };
  var PROXY_URL = 'https://cherry-proxy.test.workers.dev';
  function getProxyKey() { return Lampa.Storage.get('cherry_proxy_key', '1206'); }

  var lastPost = { url: null, body: null };
  var response = opts.response;
  function cherryPostJson(url, obj) {
    lastPost.url = url;
    lastPost.body = obj;
    if (response instanceof Error) return Promise.reject(response);
    return Promise.resolve(response || { records: [] });
  }
  // console.warn is referenced by Sync.run's catch.
  var consoleObj = { warn: function () {}, log: function () {} };

  // eslint-disable-next-line no-new-func
  var factory = new Function(
    'Lampa', 'PROXY_URL', 'getProxyKey', 'cherryPostJson', 'console',
    FAV_SRC + '\n' + SYNC_SRC + '\nreturn { Fav: Fav, Sync: Sync };'
  );
  var objs = factory(Lampa, PROXY_URL, getProxyKey, cherryPostJson, consoleObj);
  return { Fav: objs.Fav, Sync: objs.Sync, store: store, lastPost: lastPost, PROXY_URL: PROXY_URL };
}

// ==================================================================
// Fav — migration
// ==================================================================
describe('Fav: legacy-format migration', () => {
  it('wraps old plain items as {added:1, deleted:0} and persists once', () => {
    var legacy = [
      { id: 'a', source: 's', title: 'A', thumb: 't', url: 'u', duration: 10, views: 5 },
      { id: 'b', source: 's', title: 'B' }
    ];
    var sb = makeSandbox({ initial: { cherry_favs: legacy } });
    var recs = sb.Fav._records();
    expect(recs[0].added).toBe(1);
    expect(recs[0].deleted).toBe(0);
    expect(recs[1].added).toBe(1);
    // Migrated form is written back to storage.
    expect(sb.store.cherry_favs[0].added).toBe(1);
  });

  it('all() returns ACTIVE records mapped to the card shape (7 fields)', () => {
    var legacy = [{ id: 'a', source: 's', title: 'A', thumb: 't', url: 'u', duration: 10, views: 5 }];
    var sb = makeSandbox({ initial: { cherry_favs: legacy } });
    var all = sb.Fav.all();
    expect(all).toHaveLength(1);
    expect(Object.keys(all[0]).sort()).toEqual(
      ['duration', 'id', 'source', 'thumb', 'title', 'url', 'views'].sort()
    );
    // No added/deleted leak into the card shape.
    expect(all[0].added).toBeUndefined();
    expect(all[0].deleted).toBeUndefined();
  });

  it('already-migrated records are left untouched (no re-write churn)', () => {
    var recs = [{ id: 'a', source: 's', title: 'A', thumb: '', url: '', duration: 0, views: 0, added: 1700, deleted: 0 }];
    var sb = makeSandbox({ initial: { cherry_favs: recs } });
    expect(sb.Fav._records()[0].added).toBe(1700);
  });
});

// ==================================================================
// Fav — toggle
// ==================================================================
describe('Fav: toggle (tombstone semantics + return contract)', () => {
  it('absent → active: returns true, sets added>0/deleted=0', () => {
    var sb = makeSandbox({});
    var r = sb.Fav.toggle({ id: 'x', source: 's', title: 'X' });
    expect(r).toBe(true);
    var rec = sb.Fav._records()[0];
    expect(rec.added).toBeGreaterThan(0);
    expect(rec.deleted).toBe(0);
    expect(sb.Fav.has({ id: 'x', source: 's' })).toBe(true);
  });

  it('active → tombstone: returns false, sets deleted, KEEPS the record', () => {
    var sb = makeSandbox({});
    sb.Fav.toggle({ id: 'x', source: 's', title: 'X' });
    var r = sb.Fav.toggle({ id: 'x', source: 's' });
    expect(r).toBe(false);
    var recs = sb.Fav._records();
    expect(recs).toHaveLength(1);              // record kept (tombstone)
    expect(recs[0].deleted).toBeGreaterThan(0);
    expect(sb.Fav.has({ id: 'x', source: 's' })).toBe(false);
    expect(sb.Fav.all()).toHaveLength(0);
  });

  it('tombstoned → reactivate: returns true, refreshes fields', () => {
    var sb = makeSandbox({});
    sb.Fav.toggle({ id: 'x', source: 's', title: 'old' });
    sb.Fav.toggle({ id: 'x', source: 's' });   // tombstone
    var r = sb.Fav.toggle({ id: 'x', source: 's', title: 'new', thumb: 'th' });
    expect(r).toBe(true);
    var rec = sb.Fav._records()[0];
    expect(rec.title).toBe('new');
    expect(rec.thumb).toBe('th');
    expect(rec.added).toBeGreaterThan(rec.deleted);
  });

  it('toggle calls Sync.schedule (debounced push)', () => {
    var sb = makeSandbox({});
    var spy = vi.spyOn(sb.Sync, 'schedule').mockImplementation(function () {});
    sb.Fav.toggle({ id: 'x', source: 's' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ==================================================================
// Fav — _merge (last-write-wins)
// ==================================================================
describe('Fav: _merge last-write-wins', () => {
  it('remote tombstone NEWER than local add → item removed (inactive)', () => {
    var sb = makeSandbox({ initial: { cherry_favs: [
      { id: 'x', source: 's', title: 'X', thumb: '', url: '', duration: 0, views: 0, added: 100, deleted: 0 }
    ] } });
    sb.Fav._merge([{ id: 'x', source: 's', added: 100, deleted: 200 }]);
    expect(sb.Fav.has({ id: 'x', source: 's' })).toBe(false);
    expect(sb.Fav._records()).toHaveLength(1);  // tombstone kept
  });

  it('remote add NEWER than local delete → item present (active)', () => {
    var sb = makeSandbox({ initial: { cherry_favs: [
      { id: 'x', source: 's', title: 'X', thumb: '', url: '', duration: 0, views: 0, added: 100, deleted: 150 }
    ] } });
    sb.Fav._merge([{ id: 'x', source: 's', title: 'X', added: 300, deleted: 0 }]);
    expect(sb.Fav.has({ id: 'x', source: 's' })).toBe(true);
  });

  it('remote OLDER than local → local state preserved', () => {
    var sb = makeSandbox({ initial: { cherry_favs: [
      { id: 'x', source: 's', title: 'X', thumb: '', url: '', duration: 0, views: 0, added: 500, deleted: 0 }
    ] } });
    sb.Fav._merge([{ id: 'x', source: 's', added: 100, deleted: 200 }]);
    expect(sb.Fav.has({ id: 'x', source: 's' })).toBe(true);
  });

  it('remote-only record is added to local', () => {
    var sb = makeSandbox({});
    sb.Fav._merge([{ id: 'y', source: 's', title: 'Y', added: 100, deleted: 0 }]);
    expect(sb.Fav.has({ id: 'y', source: 's' })).toBe(true);
  });

  it('empty / non-array remote is a no-op', () => {
    var sb = makeSandbox({ initial: { cherry_favs: [
      { id: 'x', source: 's', title: 'X', thumb: '', url: '', duration: 0, views: 0, added: 100, deleted: 0 }
    ] } });
    sb.Fav._merge([]);
    sb.Fav._merge(null);
    expect(sb.Fav._records()).toHaveLength(1);
  });
});

// ==================================================================
// Sync
// ==================================================================
describe('Sync: PIN + run', () => {
  it('getPin default is "1206"', () => {
    var sb = makeSandbox({});
    expect(sb.Sync.getPin()).toBe('1206');
  });

  it('setPin validates 4–12 digits', () => {
    var sb = makeSandbox({});
    expect(sb.Sync.setPin('12')).toBe(false);     // too short
    expect(sb.Sync.setPin('abcd')).toBe(false);   // non-digit
    expect(sb.Sync.setPin('1234567890123')).toBe(false); // too long (13)
    expect(sb.Sync.setPin('4321')).toBe(true);
    expect(sb.store.cherry_sync_pin).toBe('4321');
  });

  it('run POSTs {records} to ${PROXY_URL}/favs?pin=...&key=... and applies result', async () => {
    var sb = makeSandbox({
      response: { records: [{ id: 'r', source: 's', title: 'R', added: 999, deleted: 0 }] }
    });
    await sb.Sync.run();
    expect(sb.lastPost.url).toBe(sb.PROXY_URL + '/favs?pin=1206&key=1206');
    expect(sb.lastPost.body).toHaveProperty('records');
    expect(Array.isArray(sb.lastPost.body.records)).toBe(true);
    // returned records merged locally
    expect(sb.Fav.has({ id: 'r', source: 's' })).toBe(true);
  });

  it('run swallows network errors (local-first)', async () => {
    var sb = makeSandbox({ response: new Error('offline') });
    await expect(sb.Sync.run()).resolves.toBeUndefined();
  });

  it('run guards against concurrent runs', async () => {
    var sb = makeSandbox({ response: { records: [] } });
    sb.Sync._running = true;
    await sb.Sync.run();
    expect(sb.lastPost.url).toBeNull(); // skipped while another run is in flight
  });

  it('schedule debounces (sets a timer, fires run after delay)', () => {
    vi.useFakeTimers();
    var sb = makeSandbox({ response: { records: [] } });
    var spy = vi.spyOn(sb.Sync, 'run').mockImplementation(function () { return Promise.resolve(); });
    sb.Sync.schedule();
    sb.Sync.schedule(); // rapid second call resets the timer (batch)
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(spy).toHaveBeenCalledTimes(1); // only one run despite two schedules
    spy.mockRestore();
    vi.useRealTimers();
  });
});

// ==================================================================
// Anti-drift source assertions
// ==================================================================
describe('favsync: plugin.js source assertions (anti-drift)', () => {
  it('Sync.run builds the favs URL directly on PROXY_URL (NOT via /proxy?url=)', () => {
    expect(SRC).toMatch(/PROXY_URL\s*\+\s*'\/favs\?pin='\s*\+\s*encodeURIComponent\(pin\)/);
    expect(SRC).toMatch(/'&key='\s*\+\s*encodeURIComponent\(getProxyKey\(\)\)/);
    // The favs call must not be wrapped through buildProxyUrl.
    expect(SRC).not.toMatch(/buildProxyUrl\([^)]*\/favs/);
  });

  it('cherryPostJson posts JSON directly (not x-www-form-urlencoded via /proxy)', () => {
    expect(SRC).toMatch(/function cherryPostJson\(url, obj\)/);
    expect(SRC).toMatch(/'Content-Type':\s*'application\/json'/);
  });

  it('Sync.getPin defaults to "1206"', () => {
    expect(SRC).toMatch(/Lampa\.Storage\.get\(\s*'cherry_sync_pin',\s*'1206'\s*\)/);
  });

  it('Fav storage key stays cherry_favs and records carry added/deleted', () => {
    expect(SRC).toMatch(/_key:\s*'cherry_favs'/);
    expect(SRC).toMatch(/added:\s*1,\s*\n?\s*deleted:\s*0/);
    expect(SRC).toMatch(/added\s*>\s*r\.deleted/);
  });

  it('toggle schedules a sync push', () => {
    expect(SRC).toMatch(/Sync\.schedule\(\)/);
  });

  it('CherryMain has a sync tile (_kind:sync) with ⟲ initial', () => {
    expect(SRC).toMatch(/_kind:\s*'sync'/);
    expect(SRC).toMatch(/_initial:\s*'⟲'/);
  });

  it('sync tile onEnter opens Input.edit and sets the PIN via Sync.setPin', () => {
    expect(SRC).toMatch(/element\._kind\s*===\s*'sync'/);
    expect(SRC).toMatch(/Sync\.setPin\(p\)/);
    expect(SRC).toMatch(/\^\[0-9\]\{4,12\}\$/);
  });

  it('cherry_sync lang key registered with ru + en', () => {
    expect(SRC).toMatch(/cherry_sync\s*:\s*\{\s*ru:\s*'Синхронизация',\s*en:\s*'Sync'/);
  });

  it('startup sync runs once on load (guarded, non-blocking)', () => {
    expect(SRC).toMatch(/setTimeout\(function\s*\(\)\s*\{\s*try\s*\{\s*Sync\.run\(\)/);
  });

  it('opening CherryMain triggers a sync', () => {
    // create() ends with a guarded Sync.run().
    var at = SRC.indexOf('function CherryMain(object)');
    var body = SRC.slice(at, SRC.indexOf('function addStyles', at));
    expect(body).toMatch(/try\s*\{\s*Sync\.run\(\)/);
  });
});
