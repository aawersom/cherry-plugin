/**
 * v0.13.29 — stability + correctness of the user surface. Every test runs the REAL code sliced
 * out of plugin.js (no hand-written mirrors):
 *   - fetch layer: proxy requests time out; non-2xx bodies stay available to tolerant callers
 *   - page cache: one request per url+referer within the TTL, failures are not kept
 *   - playVideo retry: one retry on a throw / an empty stream, then the error
 *   - Fav.toggle: stamps never go backwards (a record from a clock-ahead device stays toggleable)
 *   - title repair on read: entities, «&#'s», Latin-1 and CJK mojibake; real Latin text untouched
 *   - xvideos/xnxx related ids carry the feed prefix
 *   - spankbang is disabled (still registered)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');

// Slice a declaration (`function name(` or `var name = {`) through its matching closing brace.
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
const TITLE_SRC = SRC.slice(SRC.indexOf('var _HTML_ENTITIES'), SRC.indexOf('// ---- Search text normalization'));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

describe('fetch layer: _getText', () => {
  function make(fetchImpl, timeoutMs) {
    const code = slice('function _getText(').replace(/FETCH_TIMEOUT_MS/g, String(timeoutMs || 15000));
    return new Function('fetch', 'AbortController', code + '\nreturn _getText;')(fetchImpl, AbortController);
  }
  const resp = (status, text) => Promise.resolve({ ok: status < 300, status, text: () => Promise.resolve(text) });

  it('resolves the body of a 2xx response', async () => {
    await expect(make(() => resp(200, 'page'))('u')).resolves.toBe('page');
  });
  it('rejects a non-2xx with the status AND keeps the body on the error', async () => {
    const err = await make(() => resp(404, 'body404'))('u').catch((e) => e);
    expect(err.message).toBe('HTTP 404');
    expect(err.body).toBe('body404');
  });
  it('times out a request that never answers (and aborts it)', async () => {
    let signal;
    const get = make((u, o) => { signal = o.signal; return new Promise(() => {}); }, 30);
    const err = await get('u').catch((e) => e);
    expect(err.message).toBe('timeout');
    expect(signal.aborted).toBe(true);
  });
  it('times out a body that stalls after the headers', async () => {
    const get = make(() => Promise.resolve({ ok: true, status: 200, text: () => new Promise(() => {}) }), 30);
    await expect(get('u')).rejects.toThrow('timeout');
  });
  it('passes POST options through', async () => {
    let seen;
    await make((u, o) => { seen = o; return resp(200, 'ok'); })('u', { method: 'POST', body: 'a=1' });
    expect(seen.method).toBe('POST');
    expect(seen.body).toBe('a=1');
  });
});

describe('fetch layer: _proxyTextAny keeps the status-tolerant contract', () => {
  function make(getText, failover) {
    const code = slice('function _proxyTextAny(');
    return new Function('_getText', 'buildProxyUrl', '_hasProxyFailover', code + '\nreturn _proxyTextAny;')(
      getText, (u, r, alt) => (alt ? 'alt:' : 'main:') + u, () => failover);
  }
  const httpErr = (body) => Object.assign(new Error('HTTP 404'), { body });

  it('returns a 404 page body when there is no failover', async () => {
    await expect(make(() => Promise.reject(httpErr('p404')), false)('u')).resolves.toBe('p404');
  });
  it('tries the failover tier, and returns ITS non-2xx body', async () => {
    const calls = [];
    const get = (u) => { calls.push(u); return Promise.reject(httpErr(u + '-body')); };
    await expect(make(get, true)('u')).resolves.toBe('alt:u-body');
    expect(calls).toEqual(['main:u', 'alt:u']);
  });
  it('still rejects a network error / timeout (no body to return)', async () => {
    await expect(make(() => Promise.reject(new Error('timeout')), false)('u')).rejects.toThrow('timeout');
  });
});

describe('page cache: cherryFetch', () => {
  function make(now) {
    const code = SRC.slice(SRC.indexOf('var HTML_CACHE_MS'), SRC.indexOf('function _cherryFetchNow('));
    const calls = [];
    const env = { results: [] };
    const fetchNow = (url, ref) => { calls.push(url + '|' + (ref || '')); return env.results.length ? env.results.shift() : Promise.resolve('html:' + url); };
    const fn = new Function('_cherryFetchNow', 'Date', code + '\nreturn cherryFetch;')(fetchNow, { now: () => now.t });
    return { fetch: fn, calls, env };
  }

  it('one request for the same url+referer inside the TTL (getStream → related probe → grid)', async () => {
    const now = { t: 1000 }, c = make(now);
    expect(await c.fetch('a')).toBe('html:a');
    expect(await c.fetch('a')).toBe('html:a');
    expect(await c.fetch('a', 'ref')).toBe('html:a');   // a different referer is a different request
    expect(c.calls).toEqual(['a|', 'a|ref']);
  });
  it('refetches after the TTL', async () => {
    const now = { t: 1000 }, c = make(now);
    await c.fetch('a');
    now.t += 180001;
    await c.fetch('a');
    expect(c.calls.length).toBe(2);
  });
  it('does not keep a failure: the next call retries', async () => {
    const now = { t: 1000 }, c = make(now);
    c.env.results.push(Promise.reject(new Error('down')));
    await expect(c.fetch('a')).rejects.toThrow('down');
    await tick(0);
    expect(await c.fetch('a')).toBe('html:a');
    expect(c.calls.length).toBe(2);
  });
  it('is bounded: the oldest page is evicted past the cap', async () => {
    const now = { t: 1000 }, c = make(now);
    for (const u of ['1', '2', '3', '4', '5', '6', '7']) await c.fetch(u);
    await c.fetch('1');                                   // evicted → fetched again
    await c.fetch('7');                                   // still cached
    expect(c.calls.filter((k) => k === '1|').length).toBe(2);
    expect(c.calls.filter((k) => k === '7|').length).toBe(1);
  });
});

describe('playVideo: _streamWithRetry', () => {
  function make() {
    const code = slice('function bestQualityUrl(') + '\n' + slice('function _streamWithRetry(');
    return new Function('setTimeout', code + '\nreturn _streamWithRetry;')((f) => f());   // no real pause in tests
  }
  const source = (answers) => { let n = 0; return { calls: () => n, getStream: () => { const a = answers[n++]; return a instanceof Error ? Promise.reject(a) : Promise.resolve(a); } }; };

  it('first answer playable → no retry', async () => {
    const s = source([{ url: 'u1' }]);
    await expect(make()({}, s)).resolves.toEqual({ url: 'u1' });
    expect(s.calls()).toBe(1);
  });
  it('a throw is retried once', async () => {
    const s = source([new Error('net'), { quality: { '720p': 'q' } }]);
    await expect(make()({}, s)).resolves.toEqual({ quality: { '720p': 'q' } });
    expect(s.calls()).toBe(2);
  });
  it('an EMPTY stream (adapter swallowed the error) is retried too', async () => {
    const s = source([{ url: '', quality: {} }, { url: 'u2' }]);
    await expect(make()({}, s)).resolves.toEqual({ url: 'u2' });
  });
  it('two failures → rejects (playVideo shows the error), never a third attempt', async () => {
    const s = source([{ url: '' }, new Error('again')]);
    await expect(make()({}, s)).rejects.toThrow('again');
    expect(s.calls()).toBe(2);
  });
});

describe('playVideo: only the latest request opens the player', () => {
  it('a stale getStream result is dropped (generation guard on success AND error)', () => {
    const body = slice('function playVideo(');
    expect(body).toMatch(/var gen = \+\+_playGen;/);
    expect(body).toMatch(/\.then\(function \(stream\) \{\s*if \(gen !== _playGen\) return;/);
    expect(body).toMatch(/\.catch\(function \(err\) \{\s*if \(gen !== _playGen\) return;/);
  });
});

describe('Fav.toggle: stamps never go backwards', () => {
  function make(store) {
    const code = TITLE_SRC + 'var Lampa={Storage:{get:function(k,d){return k in store?store[k]:d;},set:function(k,v){store[k]=v;}}};'
      + 'var Sync={schedule:function(){}};var _RECENT_SRC="__rq";'
      + slice('var Fav = {') + ';return Fav;';
    return new Function('store', code)(store);
  }
  const FUTURE = Date.now() + 3 * 86400000;     // stamped by a device whose clock ran 3 days ahead

  it('removing a record stamped in the future really removes it', () => {
    const store = { cherry_favs: [{ id: 'a', source: 's', title: 'T', added: FUTURE, deleted: 0 }] };
    const Fav = make(store);
    expect(Fav.toggle({ id: 'a', source: 's' })).toBe(false);
    const rec = store.cherry_favs[0];
    expect(rec.deleted).toBeGreaterThan(rec.added);
    expect(Fav.has({ id: 'a', source: 's' })).toBe(false);
  });
  it('re-adding over a future tombstone really re-adds it', () => {
    const store = { cherry_favs: [{ id: 'a', source: 's', title: 'T', added: 5, deleted: FUTURE }] };
    const Fav = make(store);
    expect(Fav.toggle({ id: 'a', source: 's', title: 'T' })).toBe(true);
    expect(Fav.has({ id: 'a', source: 's' })).toBe(true);
  });
  it('normal clocks: plain now stamps (unchanged behaviour)', () => {
    const store = {};
    const Fav = make(store);
    const t0 = Date.now();
    Fav.toggle({ id: 'b', source: 's', title: 'B' });
    expect(store.cherry_favs[0].added).toBeGreaterThanOrEqual(t0);
    expect(store.cherry_favs[0].added).toBeLessThan(t0 + 5000);
  });
});

describe('title repair on read: _cleanTitle', () => {
  const M = new Function(TITLE_SRC + '\nreturn { clean: _cleanTitle, moji: _fixMojibake };')();

  it('CJK mojibake (eporner, stored in the bucket) → the real title', () => {
    const real = '爱玩的成熟美女';
    const broken = Array.from(new TextEncoder().encode(real), (b) => String.fromCharCode(b)).join('');
    expect(M.clean(broken)).toBe(real);
  });
  it('Latin-1 mojibake still repaired (v0.13.27 case)', () => {
    expect(M.clean('HeiÃŸe Erwachsene')).toBe('Heiße Erwachsene');
  });
  it('real Latin text is never touched', () => {
    for (const s of ['Ménage à trois', 'Café Olé', 'Señorita', 'naïve façade', 'Heiße']) expect(M.clean(s)).toBe(s);
  });
  it('entities and the half-stripped «&#\'s» leftover', () => {
    expect(M.clean('wife&#\'s face')).toBe("wife's face");
    expect(M.clean('Tom &amp; Jerry &#039;s')).toBe("Tom & Jerry 's");
  });
  it('Fav.all() and Hist.all() show repaired titles without rewriting storage', () => {
    const store = { cherry_favs: [{ id: 'a', source: 's', title: 'wife&#\'s', added: 2, deleted: 0 }],
      cherry_history: [{ id: 'h', source: 's', title: 'A &amp; B', ts: 1 }] };
    const code = TITLE_SRC + 'var Lampa={Storage:{get:function(k,d){return k in store?store[k]:d;},set:function(k,v){store[k]=v;}}};'
      + 'var Sync={schedule:function(){}};var _RECENT_SRC="__rq";'
      + slice('var Fav = {') + ';' + slice('var Hist = {') + ';return {Fav:Fav,Hist:Hist};';
    const o = new Function('store', code)(store);
    expect(o.Fav.all()[0].title).toBe("wife's");
    expect(o.Hist.all()[0].title).toBe('A & B');
    expect(store.cherry_favs[0].title).toBe('wife&#\'s');     // storage untouched (no LWW race)
  });
});

describe('xvideos/xnxx related: ids match the feed', () => {
  const rel = new Function(TITLE_SRC + slice('function _xvideosRelated(') + '\nreturn _xvideosRelated;')();
  const html = 'var video_related=[{"eid":"ilfiidk5554","id":123,"u":"/video.ilfiidk5554/slug","tf":"A &amp; B","i":"t.jpg","d":"1 h 5 min"}];';

  it('xvideos → "xv" + eid (the feed builds "xv" + the /video.TOKEN/ token)', () => {
    const [v] = rel(html, 'https://www.xvideos.com', 'xvideos', 'xv');
    expect(v.id).toBe('xvilfiidk5554');
    expect(v.url).toBe('https://www.xvideos.com/video.ilfiidk5554/slug');
    expect(v.title).toBe('A & B');
    expect(v.duration).toBe(3900);
  });
  it('xnxx → "xnxx-" + eid', () => {
    expect(rel(html, 'https://www.xnxx.com', 'xnxx', 'xnxx-')[0].id).toBe('xnxx-ilfiidk5554');
  });
  it('both adapters pass their prefix', () => {
    expect(SRC).toContain("_xvideosRelated(html, 'https://www.xvideos.com', 'xvideos', 'xv')");
    expect(SRC).toContain("_xvideosRelated(html, 'https://www.xnxx.com', 'xnxx', 'xnxx-')");
  });
});

describe('client sort applies to favorites, history and «Похожие»', () => {
  it('the three single-list branches run _applyClientSort', () => {
    expect(SRC).toContain('resolve(_applyClientSort(Fav.all().map(toCard)), 1);');
    expect(SRC).toContain('var hist = _applyClientSort(Hist.all().map(toCard));');
    expect(SRC).toContain('resolve(_applyClientSort(items.map(toCard)), items.length ? (page + 50) : page);');
  });
});

describe('spankbang', () => {
  it('is disabled (hidden from tiles / global search) but still registered for its saved cards', () => {
    const block = SRC.slice(SRC.indexOf("id: 'spankbang'"), SRC.indexOf("id: 'spankbang'") + 400);
    expect(block).toMatch(/disabled: true,/);
  });
});

describe('v0.13.32: every card title is cleaned on the screen', () => {
  it('toCard runs _cleanTitle; _cleanTitle drops zero-width spaces and repairs cp1252 mojibake', () => {
    expect(SRC).toContain('v.title  = _cleanTitle(v.title);');
    const clean = new Function(TITLE_SRC + '\nreturn _cleanTitle;')();
    expect(clean('Fiona ​sprouts ​gets')).toBe('Fiona sprouts gets');
    expect(clean('Saba â€“ Homemade')).toBe('Saba – Homemade');
  });
  it('«Похожие» continuation is ranked against the seed keywords', () => {
    expect(SRC).toContain('if (items && items.length) { _relDone(_rankByRelevance(items, relKw)); return; }');
  });
});

describe('v0.13.33: inner player + CDN without CORS → stream through the proxy', () => {
  const code = slice('function _isProxied(') + '\n' + slice('function _viaProxy(') + '\n' + slice('function _corsBlocked(');
  const make = (fetchImpl) => new Function('fetch', 'AbortController', 'PROXY_URL', 'PROXY_URL_2', 'PROXY_URL_3', 'buildProxyUrl',
    code + '\nreturn { blocked: _corsBlocked, via: _viaProxy };')(fetchImpl, AbortController, 'https://cf.test', 'https://vps.test', '',
    (u) => 'https://vps.test/proxy?url=' + encodeURIComponent(u));

  it('a CORS failure (fetch rejects) → blocked; a CORS answer → not blocked', async () => {
    await expect(make(() => Promise.reject(new TypeError('cors'))).blocked('https://cdn.x/v.mp4', true)).resolves.toBe(true);
    await expect(make(() => Promise.resolve({ ok: true })).blocked('https://cdn.x/v.mp4', true)).resolves.toBe(false);
  });
  it('never probes for an external player, an already proxied or a blob URL', async () => {
    let calls = 0; const M = make(() => { calls++; return Promise.reject(new Error('x')); });
    await expect(M.blocked('https://cdn.x/v.mp4', false)).resolves.toBe(false);
    await expect(M.blocked('https://vps.test/proxy?url=a', true)).resolves.toBe(false);
    await expect(M.blocked('blob:abc', true)).resolves.toBe(false);
    expect(calls).toBe(0);
  });
  it('_viaProxy wraps raw URLs once', () => {
    const M = make(() => Promise.resolve({}));
    expect(M.via('https://cdn.x/v.mp4')).toBe('https://vps.test/proxy?url=' + encodeURIComponent('https://cdn.x/v.mp4'));
    expect(M.via('https://cf.test/proxy?url=a')).toBe('https://cf.test/proxy?url=a');
  });
  it('playVideo asks before the inner player opens and swaps the whole quality map', () => {
    const pv = slice('function playVideo(');
    expect(pv).toContain("var _inner = _isAndroid() && (/\\.m3u8|mpegurl/i.test(_finalUrl) || Lampa.Storage.get('player', 'inner') === 'inner');");
    expect(pv).toContain('return _corsBlocked(_finalUrl, _inner).then(function (blocked) {');
    expect(pv).toContain('Object.keys(proxiedQuality).forEach(function (k) { proxiedQuality[k] = _viaProxy(proxiedQuality[k]); });');
  });
});
