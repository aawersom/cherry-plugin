/**
 * v0.13.30 — error vs «nothing found», favorites availability + «Найти копию», «Все видео» = latest.
 * Real code sliced from plugin.js (behaviour), plus anti-drift checks for the wiring that needs a
 * live Lampa (verified on the stand by test/tv-v0130-check.page.js).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');

function slice(decl) {
  const start = SRC.indexOf(decl);
  if (start < 0) throw new Error('decl not found: ' + decl);
  let i = SRC.indexOf('{', start), depth = 0;
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) break;
  }
  return SRC.slice(start, i + 1);
}

describe('network-failure counter: _countFail', () => {
  const M = new Function('var _netFails = 0;' + slice('function _countFail(') + '\nreturn { f: _countFail, n: function () { return _netFails; } };')();
  const thrown = (e) => { try { M.f(e); } catch (x) { return x; } return null; };

  it('counts network errors, timeouts, 5xx and 403 — and rethrows them unchanged', () => {
    const before = M.n();
    for (const m of ['timeout', 'Failed to fetch', 'HTTP 503', 'HTTP 403', 'HTTP 500']) {
      const e = new Error(m);
      expect(thrown(e)).toBe(e);
    }
    expect(M.n() - before).toBe(5);
  });
  it('a 404 / 410 is an answer (nothing there), not a failure', () => {
    const before = M.n();
    thrown(new Error('HTTP 404'));
    thrown(new Error('HTTP 410'));
    expect(M.n()).toBe(before);
  });
  it('every page-request path reports into it', () => {
    expect(slice('function cherryFetch(')).toContain('return p.catch(_countFail);');
    expect(slice('function _fetchAny(')).toMatch(/\.catch\(_countFail\);[\s\S]*\.catch\(_countFail\);/);
    expect(slice('function cherryPost(')).toContain('.catch(_countFail);');
  });
});

describe('_gridLoad: empty + failed requests → error, not «nothing found»', () => {
  const body = slice('function _gridLoad(');
  it('wraps resolve for every network mode (after the local favorites/history branches)', () => {
    const wrap = body.indexOf('var _fails0 = _netFails, _failNeed = 1, _ok = resolve;');
    expect(wrap).toBeGreaterThan(body.indexOf('if (object.is_history) {'));
    expect(wrap).toBeLessThan(body.indexOf('if (object.related_video) {'));
    expect(body).toMatch(/if \(\(!items \|\| !items\.length\) && _netFails - _fails0 >= _failNeed\) \{ reject\(new Error\('network'\)\); return; \}/);
  });
  it('the all-channels fan-out needs (about) every channel to fail', () => {
    expect(body).toMatch(/var _act = _activeSources\(\);\s*if \(!_act\.length\) \{ resolve\(\[\], 1\); return; \}\s*_failNeed = _act\.length;/);
  });
  it('the decision itself, run as written', () => {
    // Extract the wrapper and drive it with a fake counter.
    const w = body.slice(body.indexOf('var _fails0 = _netFails'), body.indexOf('// «Похожие» — infinite scroll'));
    const run = (fails, need, items) => {
      const out = {};
      new Function('ctx', 'var _netFails = 0, resolve = ctx.ok, reject = ctx.err;' + w
        + 'if (ctx.need) _failNeed = ctx.need; _netFails += ctx.fails; resolve(ctx.items, 1);')(
        { ok: (i) => { out.ok = i; }, err: (e) => { out.err = e.message; }, fails, need, items });
      return out;
    };
    expect(run(1, 0, [])).toEqual({ err: 'network' });            // one channel, a failed request, nothing → error
    expect(run(0, 0, [])).toEqual({ ok: [] });                     // really empty
    expect(run(3, 0, [{ id: 1 }])).toEqual({ ok: [{ id: 1 }] });   // cards always win
    expect(run(5, 27, [])).toEqual({ ok: [] });                    // fan-out: a few dead sites ≠ error
    expect(run(27, 27, [])).toEqual({ err: 'network' });           // fan-out: everything failed
  });
});

describe('«Все видео»: _latestSort', () => {
  const latest = new Function(slice('function _latestSort(') + '\nreturn _latestSort;')();
  const src = (s) => ({ cfg: { sorts: s.split(',').map((p) => ({ id: p.split(':')[0], label: p.split(':')[1] })) } });

  it('picks «Свежее» wherever it sits (sorts[0] is popular on youjizz / xhamster / …)', () => {
    expect(latest(src('most-popular:По популярности,trending:В тренде,newest-clips:Свежее'))).toBe('newest-clips');
    expect(latest(src('trend:По популярности,newest:Свежее'))).toBe('newest');
    expect(latest(src('post_date:Свежее,video_viewed:По популярности'))).toBe('post_date');
  });
  it('no «Свежее» → "" (the site default listing: home / latest-updates), never the popular sort', () => {
    expect(latest(src('popular:По популярности,toprated:По рейтингу'))).toBe('');
    expect(latest({})).toBe('');
  });
  it('the fan-out uses it', () => {
    expect(slice('function _gridLoad(')).toContain("src.browse('', page, _latestSort(src))");
  });
});

describe('Avail: favorites availability', () => {
  function make(store) {
    return new Function('store', 'var Lampa={Storage:{get:function(k,d){return k in store?store[k]:d;},set:function(k,v){store[k]=v;}}};'
      + slice('var Avail = {') + ';return Avail;')(store);
  }
  const v = { id: 'a', source: 's' };

  it('needs TWO consecutive failures to call a video dead', () => {
    const A = make({});
    expect(A.record(v, false)).toBe(false);
    expect(A.dead(v)).toBe(false);
    expect(A.record(v, false)).toBe(true);
    expect(A.dead(v)).toBe(true);
  });
  it('one success clears it', () => {
    const A = make({});
    A.record(v, false); A.record(v, false);
    A.record(v, true);
    expect(A.dead(v)).toBe(false);
    expect(A.record(v, false)).toBe(false);   // counting starts over
  });
  it('re-check schedule: never checked → now; ok → after 3 days; failed → after 10 min', () => {
    const store = {}, A = make(store), now = Date.now();
    expect(A.due(v, now)).toBe(true);
    A.record(v, true);
    expect(A.due(v, now + 60000)).toBe(false);
    expect(A.due(v, now + 3 * 86400000 + 5000)).toBe(true);
    A.record(v, false);
    expect(A.due(v, now + 5 * 60000)).toBe(false);
    expect(A.due(v, now + 11 * 60000)).toBe(true);
  });
  it('prune keeps only current favorites; junk storage is tolerated', () => {
    const store = { cherry_avail: { 'a@s': { f: 1, t: 1 }, 'gone@s': { f: 2, t: 1 } } }, A = make(store);
    A.prune([v]);
    expect(Object.keys(store.cherry_avail)).toEqual(['a@s']);
    expect(make({ cherry_avail: [1, 2] }).dead(v)).toBe(false);
  });
});

describe('wiring that needs a live Lampa (stand-verified)', () => {
  it('playVideo records the outcome for favorites and offers «Найти копию» / remove on failure', () => {
    const pv = slice('function playVideo(');
    expect(pv).toContain('if (Fav.has(video)) try { Avail.record(video, true); } catch (e) {}');
    expect(pv).toContain("if (!Fav.has(video)) { Lampa.Noty.show(Lampa.Lang.translate('cherry_error'), { style: 'warn' }); return; }");
    expect(pv).toContain('Avail.record(video, false)');
    expect(pv).toContain("if (item.action === 'copy') _findCopy(video);");
  });
  it('«Найти копию» = an all-channels search on up to 8 cleaned title words', () => {
    const f = slice('function _findCopy(');
    expect(f).toContain('query:       _searchKeywords(_cleanTitle(element.title), 8),');
    expect(f).toContain('all_sources: true,');
  });
  it('favorites grid: badge per card, background check started and stopped with the screen', () => {
    expect(SRC).toContain('_availBadge(ui.html, Avail.dead(element));');
    expect(SRC).toContain('if (object.is_favorites) setTimeout(_availCheck, 3000);');
    expect(SRC).toContain('pause: function () { _stopCurrentPreview(); _availStop = true; }');
    expect(SRC).toMatch(/if \(ok \|\| _netFails === f0\) \{/);   // a miss during network trouble is not counted
  });
  it('lang keys exist', () => {
    for (const k of ['cherry_unavailable:', 'cherry_unavailable_title:', 'cherry_find_copy:', 'cherry_close:']) expect(SRC).toContain(k);
  });
});
