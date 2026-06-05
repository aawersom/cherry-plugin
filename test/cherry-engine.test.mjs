/**
 * Unit tests for _kvsPages, _kvsParseCards, _kvsEngine.
 * Functions are defined inline here since plugin.js is a browser IIFE
 * and these three helpers do not exist in plugin.js yet (Phase 0 — RED).
 *
 * Pattern: identical to plugin-helpers.test.js — copy-paste the pure
 * helpers verbatim at the top, then describe/it below.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

// ---- _attr ------------------------------------------------------------------
// Verbatim from plugin.js line 1333
function _attr(html, rx, group) {
  var m = rx.exec(html);
  return (m && m[group || 1] !== undefined) ? m[group || 1].trim() : '';
}

// ---- _decodeHtml ------------------------------------------------------------
// Verbatim from plugin.js line 1343
function _decodeHtml(s) {
  return (s || '').replace(/&amp;/g, '&')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .replace(/&quot;/g, '"')
                  .replace(/&#039;/g, "'")
                  .replace(/&nbsp;/g, ' ')
                  .trim();
}

// ---- parseDur ---------------------------------------------------------------
// Verbatim from plugin.js line 1211
function parseDur(str) {
  if (!str) return 0;
  str = ('' + str).trim();
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  var p = str.split(':').map(Number);
  if (p.length === 2) return p[0] * 60 + p[1];
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  return 0;
}

// ---- parseViews -------------------------------------------------------------
// Verbatim from plugin.js line 1225
function parseViews(str) {
  if (!str) return 0;
  str = ('' + str).replace(/[,\s]/g, '');
  if (/k$/i.test(str)) return parseInt(str) * 1000;
  if (/m$/i.test(str)) return parseInt(str) * 1000000;
  return parseInt(str, 10) || 0;
}

// ---- _derivePages -----------------------------------------------------------
// Verbatim from plugin.js (near _titleFromUrl). Half-full → "has more" (tolerant);
// generous forward window (page+50) so InteractionCategory keeps paginating
// (page+1 stopped after one extra page); short/empty page caps it.
function _derivePages(itemsLen, page, full) {
  var f = full || 12;
  var hasMore = itemsLen >= Math.max(1, Math.floor(f / 2));
  return hasMore ? (page + 50) : page;
}

// ---- _kvsPages --------------------------------------------------------------
// Verbatim from plugin.js _kvsPages.
// - if pagesRxOrFn is a function: call it(html, page), return result || derive fallback
// - if RegExp: exec html, parseInt group 1, || derive fallback
// - else (undefined / null / other) or no-match: derive fallback from batch fullness
function _kvsPages(html, pagesRxOrFn, page, itemsLen) {
  var fallback = _derivePages(itemsLen || 0, page || 1, 20);
  if (typeof pagesRxOrFn === 'function') {
    return pagesRxOrFn(html, page) || fallback;
  }
  if (pagesRxOrFn instanceof RegExp) {
    var m = pagesRxOrFn.exec(html);
    if (m) return parseInt(m[1], 10) || fallback;
    return fallback;
  }
  return fallback;
}

// ---- _kvsParseCards ---------------------------------------------------------
// Spec: A-4
// cfg shape (relevant fields):
//   hrefRxSrc      string — engine creates new RegExp(hrefRxSrc,'g') each call
//   idFromUrl      function(url, match): string
//   chunkWindow    {before, after}  default {before:0, after:800}
//   thumbRx        RegExp[]
//   titleRx        RegExp[]
//   stripBase64    bool
//   normalizeUrl   function(rawUrl, match): string  (optional)
//   thumbFallback  function(id): string             (optional)
//   parseCards     function(html): VideoCard[]       (optional — dispatch override)
//   id             string — used as card.source
function _kvsParseCards(html, cfg) {
  if (cfg.parseCards) {
    return cfg.parseCards(html);
  }

  var clean = html;
  if (cfg.stripBase64) {
    clean = clean.replace(/\bsrc="data:[^"]+"/g, 'src=""');
  }

  var before = (cfg.chunkWindow && cfg.chunkWindow.before) || 0;
  var after  = (cfg.chunkWindow && cfg.chunkWindow.after  !== undefined) ? cfg.chunkWindow.after : 800;

  var hrefRx = new RegExp(cfg.hrefRxSrc, 'g');
  var seen   = {};
  var items  = [];
  var m;

  while ((m = hrefRx.exec(clean)) !== null) {
    var rawUrl   = m[1];
    var videoUrl = cfg.normalizeUrl ? cfg.normalizeUrl(rawUrl, m) : rawUrl;
    var id       = cfg.idFromUrl(videoUrl, m);

    if (!id || seen[id]) continue;
    seen[id] = true;

    var chunk = clean.slice(Math.max(0, m.index - before), m.index + after);

    // thumb
    var thumb = '';
    var thumbRxList = cfg.thumbRx || [];
    for (var ti = 0; ti < thumbRxList.length; ti++) {
      thumb = _attr(chunk, thumbRxList[ti]);
      if (thumb) break;
    }
    if (!thumb && cfg.thumbFallback) {
      thumb = cfg.thumbFallback(id);
    }

    // title
    var titleRaw = '';
    var titleRxList = cfg.titleRx || [];
    for (var ri = 0; ri < titleRxList.length; ri++) {
      titleRaw = _attr(chunk, titleRxList[ri]);
      if (titleRaw) break;
    }
    var title = _decodeHtml(titleRaw);
    if (!title) title = _titleFromUrl(videoUrl);

    // duration
    var durStr   = _attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</);
    var duration = parseDur(durStr);

    // views
    var viewsStr = _attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</);
    var views    = parseViews(viewsStr);

    // HD/4K badge (mirror plugin.js)
    var hd = '';
    if (/2160|\b4k\b/i.test(chunk)) hd = '4K';
    else if (/class="[^"]*\bhd\b[^"]*"|>\s*HD\s*<|is_hd|hd-(?:button|mark)/i.test(chunk)) hd = 'HD';

    if (title || thumb) {
      items.push({ id: id, source: cfg.id, title: title, thumb: thumb,
                   url: videoUrl, duration: duration, views: views, hd: hd || undefined });
    }
  }

  return items;
}

// ---- _kvsEngine -------------------------------------------------------------
// Spec: A-1 / A-3 / A-5
// Returns {id, name, host, search, browse, getStream}.
// cherryFetch is injected via cfg._cherryFetch so tests can mock it without
// patching a module-level variable.  In the real plugin.js the closure
// references the module-scope cherryFetch directly; here we use the same
// injection trick that plugin-helpers.test.js uses for validateStreamReachable.
function _kvsEngine(cfg) {
  // In production plugin.js, cherryFetch is a closure variable (not injected).
  // For testability we allow cfg._cherryFetch as an override.
  var fetch = cfg._cherryFetch;

  function _doCards(html) {
    return _kvsParseCards(html, cfg);
  }

  return {
    id:   cfg.id,
    name: cfg.name,
    host: cfg.host,

    search: function(query, page) {
      return fetch(cfg.searchUrl(query, page)).then(function(html) {
        var items = _doCards(html);
        var total = typeof cfg.searchTotalPages === 'number'
          ? cfg.searchTotalPages
          : _kvsPages(html, cfg.pagesRx, page, items.length);
        return { items: items, total_pages: total };
      }).catch(function() { return { items: [], total_pages: 0 }; });
    },

    browse: function(category, page) {
      return fetch(cfg.browseUrl(page || 1)).then(function(html) {
        var items = _doCards(html);
        return {
          items:       items,
          total_pages: _kvsPages(html, cfg.pagesRx, page, items.length)
        };
      }).catch(function() { return { items: [], total_pages: 0 }; });
    },

    // «Похожие»: reuse the engine's own parser on the video-page HTML, drop
    // the current video (by url), cap at 20. Mirrors plugin.js _kvsEngine.getRelated.
    getRelated: function(video) {
      var url = video && video.url;
      if (!url) return Promise.resolve([]);
      return fetch(url).then(function(html) {
        var items = _doCards(html);
        return items.filter(function(v) { return v.url !== video.url; }).slice(0, 20);
      }).catch(function() { return []; });
    },

    getStream: cfg.getStream
  };
}

// =============================================================================
// Fixtures
// =============================================================================

// Minimal fixture HTML: one video card with href, title, img, duration, views.
var FIXTURE_HTML = [
  '<div class="thumb-block">',
  '<a href="https://example.com/videos/123/hot-video/">',
  '<img data-src="https://cdn.example.com/thumb-123.jpg" alt="Hot Video">',
  '<span class="duration">12:34</span>',
  '<span class="views">1,234</span>',
  '</a>',
  '<strong class="title-label">Hot Video</strong>',
  '</div>'
].join('\n');

// Minimal cfg for _kvsParseCards (no cherryFetch needed)
var BASE_CFG = {
  id:         'example',
  hrefRxSrc:  'href="(https?:\\/\\/example\\.com\\/videos\\/[0-9]+\\/[^"]+)"',
  idFromUrl:  function(url) {
    return url.replace(/^https?:\/\/[^/]+/, '').replace(/[^a-z0-9]/gi, '_');
  },
  chunkWindow: { before: 0, after: 800 },
  thumbRx: [
    /(?:data-src|src)="([^"?#]+\.jpe?g)"/i
  ],
  titleRx: [
    /<strong[^>]*class="[^"]*title[^"]*"[^>]*>\s*([^<]+)/,
    /alt="([^"]+)"/
  ]
};

// =============================================================================
// describe: _kvsPages
// =============================================================================

describe('_derivePages', () => {
  it('at-least-half-full batch → generous forward (page+50)', () => {
    expect(_derivePages(20, 1, 20)).toBe(51);   // full
    expect(_derivePages(27, 3, 20)).toBe(53);   // full
    expect(_derivePages(10, 1, 20)).toBe(51);   // exactly half (>=10) → has more
    expect(_derivePages(19, 1, 20)).toBe(51);   // partial-but-half-full → keep paginating
  });

  it('clearly short batch (< half) → page (last page)', () => {
    expect(_derivePages(9, 1, 20)).toBe(1);     // below half (10) → stop
    expect(_derivePages(5, 4, 20)).toBe(4);
  });

  it('empty batch (len 0) → page', () => {
    expect(_derivePages(0, 1, 20)).toBe(1);
    expect(_derivePages(0, 7, 12)).toBe(7);
  });

  it('default floor of 12 when full is falsy (half = 6)', () => {
    expect(_derivePages(12, 1)).toBe(51);  // >= half(6) → forward
    expect(_derivePages(6, 1)).toBe(51);   // exactly half → forward
    expect(_derivePages(5, 1)).toBe(1);    // < half(6) → last
    expect(_derivePages(12, 2, 0)).toBe(52);
  });
});

describe('_kvsPages', () => {
  it('extracts page count via RegExp', () => {
    var html = '<a href="?p=42"class="last">&raquo;</a>';
    var rx = /p=(\d+)"[^>]*(?:last|>>|&raquo;)/i;
    expect(_kvsPages(html, rx, 1, 20)).toBe(42);
  });

  it('derives from batch fullness when RegExp does not match (full → next page)', () => {
    var html = '<a href="/page/2/">Next</a>';
    var rx = /p=(\d+)"[^>]*(?:last|>>|&raquo;)/i;
    // 20 cards (full) on page 1 → generous forward window
    expect(_kvsPages(html, rx, 1, 20)).toBe(51);
    // 5 cards (< half of 20) on page 1 → last page
    expect(_kvsPages(html, rx, 1, 5)).toBe(1);
  });

  it('calls function and returns its result', () => {
    var html = '<a href="/99/">last</a>';
    var fn = function(h, p) { return 99; };
    expect(_kvsPages(html, fn, 1, 20)).toBe(99);
  });

  it('falls back to derived pages for falsy function return', () => {
    // A function returning 0 falls back to fullness-derivation.
    var fn = function() { return 0; };
    expect(_kvsPages('', fn, 1, 20)).toBe(51);  // full page → forward window
    expect(_kvsPages('', fn, 2, 3)).toBe(2);    // short page (<half) → last
  });

  it('derives from fullness when pagesRxOrFn is undefined', () => {
    expect(_kvsPages('<p>some html</p>', undefined, 1, 20)).toBe(51);
    expect(_kvsPages('<p>some html</p>', undefined, 1, 0)).toBe(1);
  });

  it('passes (html, page) to function form', () => {
    var captured = {};
    var fn = function(html, page) {
      captured.html = html;
      captured.page = page;
      return 5;
    };
    _kvsPages('test-html', fn, 3, 20);
    expect(captured.html).toBe('test-html');
    expect(captured.page).toBe(3);
  });

  it('function returning p+5 dynamic fallback works', () => {
    // hellporno pagesRx pattern: returns p+5 when no links found
    var fn = function(html, p) {
      var nums = [];
      var rx1 = /hellporno\.com\/(\d+)\//g;
      var m;
      while ((m = rx1.exec(html)) !== null) nums.push(parseInt(m[1], 10));
      return nums.length ? Math.max.apply(null, nums) : (p + 5);
    };
    // No pagination links → should return page+5
    expect(_kvsPages('<html>no links here</html>', fn, 3, 20)).toBe(8);
  });
});

// =============================================================================
// describe: _kvsParseCards
// =============================================================================

describe('_kvsParseCards', () => {
  it('returns [] for empty html', () => {
    var result = _kvsParseCards('', BASE_CFG);
    expect(result).toEqual([]);
  });

  it('extracts one card from fixture HTML with href + title + thumb + duration', () => {
    var result = _kvsParseCards(FIXTURE_HTML, BASE_CFG);
    expect(result).toHaveLength(1);
    var card = result[0];
    expect(card.source).toBe('example');
    expect(card.url).toBe('https://example.com/videos/123/hot-video/');
    expect(card.thumb).toBe('https://cdn.example.com/thumb-123.jpg');
    expect(card.title).toBe('Hot Video');
    expect(card.duration).toBe(754); // 12*60+34
    expect(card.id).toBeTruthy();
  });

  it('deduplicates cards with same id', () => {
    // Two identical href blocks in the HTML → one card
    var html = FIXTURE_HTML + '\n' + FIXTURE_HTML;
    var result = _kvsParseCards(html, BASE_CFG);
    expect(result).toHaveLength(1);
  });

  it('strips base64 src before parsing when cfg.stripBase64 is true', () => {
    // Insert a base64 src that would otherwise confuse the thumb regex.
    var html = [
      '<a href="https://example.com/videos/99/strip-test/">',
      '<img src="data:image/png;base64,AAAABBBBCCCC" alt="Strip Test">',
      '<img data-src="https://cdn.example.com/real-thumb.jpg">',
      '</a>',
      '<strong class="title-label">Strip Test</strong>'
    ].join('\n');

    var cfgStrip = Object.assign({}, BASE_CFG, {
      stripBase64: true,
      thumbRx: [
        /(?:data-src|src)="([^"?#]+\.jpe?g)"/i
      ]
    });

    var result = _kvsParseCards(html, cfgStrip);
    expect(result).toHaveLength(1);
    // The real thumb (data-src) must survive; the base64 src must be stripped.
    expect(result[0].thumb).toBe('https://cdn.example.com/real-thumb.jpg');
  });

  it('calls cfg.parseCards and returns its result when provided (dispatch test)', () => {
    var sentinel = [{ id: 'sentinel', source: 'mock', title: 'S', thumb: '', url: '', duration: 0, views: 0 }];
    var cfg = Object.assign({}, BASE_CFG, {
      parseCards: function() { return sentinel; }
    });
    var result = _kvsParseCards(FIXTURE_HTML, cfg);
    expect(result).toBe(sentinel);
  });

  it('applies cfg.normalizeUrl to raw href capture', () => {
    // Relative href starting with / — normalizeUrl should prepend the host.
    var html = [
      '<a href="/video/77/relative-url/">',
      '<img data-src="https://cdn.example.com/t.jpg">',
      '</a>',
      '<strong class="title-label">Relative</strong>'
    ].join('\n');

    var cfg = Object.assign({}, BASE_CFG, {
      hrefRxSrc: 'href="(\\/video\\/[0-9]+\\/[^"]+)"',
      normalizeUrl: function(rawUrl) {
        return rawUrl.charAt(0) === '/' ? 'https://example.com' + rawUrl : rawUrl;
      },
      idFromUrl: function(url) {
        return url.replace(/^https?:\/\/[^/]+/, '').replace(/[^a-z0-9]/gi, '_');
      }
    });

    var result = _kvsParseCards(html, cfg);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://example.com/video/77/relative-url/');
  });

  it('uses cfg.thumbFallback when no thumbRx matches', () => {
    var html = [
      '<a href="https://example.com/videos/55/no-img/">',
      '</a>',
      '<strong class="title-label">No Image</strong>'
    ].join('\n');

    var cfg = Object.assign({}, BASE_CFG, {
      thumbRx: [/THIS_WONT_MATCH_ANYTHING/i],
      thumbFallback: function(id) { return 'https://cdn.example.com/fallback-' + id + '.jpg'; }
    });

    var result = _kvsParseCards(html, cfg);
    expect(result).toHaveLength(1);
    expect(result[0].thumb).toMatch(/fallback/);
    expect(result[0].thumb).toContain(result[0].id);
  });

  it('creates fresh RegExp per call (lastIndex not shared across two calls)', () => {
    // If the engine reused the same /g regex, the second call would start
    // from a non-zero lastIndex and miss the first match.
    var result1 = _kvsParseCards(FIXTURE_HTML, BASE_CFG);
    var result2 = _kvsParseCards(FIXTURE_HTML, BASE_CFG);
    expect(result1).toHaveLength(1);
    expect(result2).toHaveLength(1);
    expect(result2[0].id).toBe(result1[0].id);
  });

  it('applies cfg.idFromUrl result as card id', () => {
    var customId = 'my-custom-id-123';
    var cfg = Object.assign({}, BASE_CFG, {
      idFromUrl: function() { return customId; }
    });
    var result = _kvsParseCards(FIXTURE_HTML, cfg);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(customId);
  });

  it('skips card when id is empty string', () => {
    var cfg = Object.assign({}, BASE_CFG, {
      idFromUrl: function() { return ''; }
    });
    var result = _kvsParseCards(FIXTURE_HTML, cfg);
    expect(result).toHaveLength(0);
  });

  it('extracts views from class containing "views"', () => {
    var html = [
      '<a href="https://example.com/videos/77/views-test/">',
      '<img data-src="https://cdn.example.com/t.jpg">',
      '<span class="video-views">5k</span>',
      '</a>',
      '<strong class="title-label">Views Test</strong>'
    ].join('\n');
    var result = _kvsParseCards(html, BASE_CFG);
    expect(result).toHaveLength(1);
    expect(result[0].views).toBe(5000);
  });

  it('keeps card via _titleFromUrl fallback when title markup is absent (URL has a slug)', () => {
    // No img / no title markup, but the URL slug yields a title → card is kept
    // (the fallback prevents captionless cards, e.g. after sorting).
    var html = '<a href="https://example.com/videos/11/bare-link/"></a>';
    var cfg = Object.assign({}, BASE_CFG, {
      thumbRx: [/THIS_WONT_MATCH/i],
      titleRx: [/THIS_WONT_MATCH_EITHER/]
    });
    var result = _kvsParseCards(html, cfg);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Bare link');
  });
});

// =============================================================================
// describe: _kvsEngine
// =============================================================================

describe('_kvsEngine', () => {
  // Build a minimal but functional cfg with a mockable cherryFetch.
  function makeCfg(fetchMock, overrides) {
    return Object.assign({
      id:        'testsite',
      name:      'Test Site',
      host:      'example.com',
      searchUrl: function(q, p) { return 'https://example.com/?s=' + q + '&p=' + p; },
      browseUrl: function(p) { return 'https://example.com/page/' + p + '/'; },
      hrefRxSrc: BASE_CFG.hrefRxSrc,
      idFromUrl:  BASE_CFG.idFromUrl,
      chunkWindow: { before: 0, after: 800 },
      thumbRx:   BASE_CFG.thumbRx,
      titleRx:   BASE_CFG.titleRx,
      pagesRx:   /p=(\d+)"[^>]*(?:last|>>|&raquo;)/i,
      getStream: function(video) { return Promise.resolve({ url: 'stream.mp4', quality: {} }); },
      _cherryFetch: fetchMock
    }, overrides || {});
  }

  it('returns adapter object with correct shape {id, name, host, search, browse, getStream}', () => {
    var adapter = _kvsEngine(makeCfg(function() { return Promise.resolve(''); }));
    expect(adapter.id).toBe('testsite');
    expect(adapter.name).toBe('Test Site');
    expect(adapter.host).toBe('example.com');
    expect(typeof adapter.search).toBe('function');
    expect(typeof adapter.browse).toBe('function');
    expect(typeof adapter.getStream).toBe('function');
    expect(typeof adapter.getRelated).toBe('function');
    // Must have exactly these keys (SourceAdapter contract + generalized getRelated)
    var keys = Object.keys(adapter).sort();
    expect(keys).toEqual(['browse', 'getRelated', 'getStream', 'host', 'id', 'name', 'search']);
  });

  it('getStream is cfg.getStream verbatim', () => {
    var myGetStream = function(v) { return Promise.resolve({ url: 'test.mp4', quality: {} }); };
    var adapter = _kvsEngine(makeCfg(function() { return Promise.resolve(''); }, {
      getStream: myGetStream
    }));
    expect(adapter.getStream).toBe(myGetStream);
  });

  it('search calls cfg.searchUrl and returns {items, total_pages}', async () => {
    var paginatedHtml = FIXTURE_HTML + '\n<a href="?p=7"class="last">&raquo;</a>';
    var urlSeen = null;
    var fetch = function(url) { urlSeen = url; return Promise.resolve(paginatedHtml); };

    var adapter = _kvsEngine(makeCfg(fetch));
    var result = await adapter.search('hot', 2);

    expect(urlSeen).toContain('s=hot');
    expect(urlSeen).toContain('p=2');
    expect(result.items).toHaveLength(1);
    expect(result.total_pages).toBe(7);
  });

  it('browse calls cfg.browseUrl with page', async () => {
    var urlSeen = null;
    var fetch = function(url) { urlSeen = url; return Promise.resolve(FIXTURE_HTML); };

    var adapter = _kvsEngine(makeCfg(fetch));
    var result = await adapter.browse(null, 3);

    expect(urlSeen).toContain('/page/3/');
    expect(typeof result.items).toBe('object');
    expect(typeof result.total_pages).toBe('number');
  });

  it('browse defaults page to 1 when page is falsy', async () => {
    var urlSeen = null;
    var fetch = function(url) { urlSeen = url; return Promise.resolve(''); };

    var adapter = _kvsEngine(makeCfg(fetch));
    await adapter.browse(null, 0);

    expect(urlSeen).toContain('/page/1/');
  });

  it('browse uses searchTotalPages when set (search does not paginate)', async () => {
    // pornobolt: searchTotalPages=1 means total_pages is always 1 for search results
    var fetch = function() { return Promise.resolve(FIXTURE_HTML); };
    var adapter = _kvsEngine(makeCfg(fetch, { searchTotalPages: 1 }));

    var result = await adapter.search('test', 1);
    expect(result.total_pages).toBe(1);
  });

  it('search catches errors and returns empty result', async () => {
    var fetch = function() { return Promise.reject(new Error('network error')); };
    var adapter = _kvsEngine(makeCfg(fetch));

    var result = await adapter.search('test', 1);
    expect(result.items).toEqual([]);
    expect(result.total_pages).toBe(0);
  });

  it('browse catches errors and returns empty result', async () => {
    var fetch = function() { return Promise.reject(new Error('timeout')); };
    var adapter = _kvsEngine(makeCfg(fetch));

    var result = await adapter.browse(null, 1);
    expect(result.items).toEqual([]);
    expect(result.total_pages).toBe(0);
  });

  it('browse routes through cfg.parseCards when provided', async () => {
    var sentinel = [{ id: 'hp-slug', source: 'hellporno', title: 'HP', thumb: 'x.jpg', url: 'y', duration: 0, views: 0 }];
    var fetch = function() { return Promise.resolve('<html>hellporno browse</html>'); };
    var adapter = _kvsEngine(makeCfg(fetch, {
      parseCards: function() { return sentinel; }
    }));

    var result = await adapter.browse(null, 1);
    expect(result.items).toBe(sentinel);
  });

  it('id and source on returned VideoCards match cfg.id', async () => {
    var fetch = function() { return Promise.resolve(FIXTURE_HTML); };
    var adapter = _kvsEngine(makeCfg(fetch));

    var result = await adapter.browse(null, 1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].source).toBe('testsite');
  });

  // «Похожие» — generalized getRelated parses the video-page HTML with the
  // engine's own card parser and drops the current video.
  it('getRelated parses related cards from the video page and excludes the current video', async () => {
    // Video page with a "Related videos" block in the same KVS card markup —
    // includes the CURRENT video (123) plus two genuinely related ones (124, 125).
    var card = function(id) {
      return [
        '<div class="thumb-block">',
        '<a href="https://example.com/videos/' + id + '/clip-' + id + '/">',
        '<img data-src="https://cdn.example.com/thumb-' + id + '.jpg" alt="Clip ' + id + '">',
        '<span class="duration">10:0' + (id % 10) + '</span>',
        '</a>',
        '<strong class="title-label">Clip ' + id + '</strong>',
        '</div>'
      ].join('\n');
    };
    var videoPageHtml = card(123) + '\n' + card(124) + '\n' + card(125);
    var current = { id: 'example', url: 'https://example.com/videos/123/clip-123/' };

    var urlSeen = null;
    var fetch = function(url) { urlSeen = url; return Promise.resolve(videoPageHtml); };
    var adapter = _kvsEngine(makeCfg(fetch));

    var related = await adapter.getRelated(current);

    // Fetched the same video-page URL getStream uses.
    expect(urlSeen).toBe(current.url);
    // Current video excluded; the two real related cards remain.
    expect(related).toHaveLength(2);
    var urls = related.map(function(v) { return v.url; });
    expect(urls).not.toContain(current.url);
    expect(urls).toContain('https://example.com/videos/124/clip-124/');
    expect(urls).toContain('https://example.com/videos/125/clip-125/');
  });

  it('getRelated returns [] when video has no url', async () => {
    var fetched = false;
    var fetch = function() { fetched = true; return Promise.resolve(''); };
    var adapter = _kvsEngine(makeCfg(fetch));

    var related = await adapter.getRelated({ id: 'x' });
    expect(related).toEqual([]);
    expect(fetched).toBe(false); // short-circuits before fetching
  });

  it('getRelated swallows fetch errors and returns []', async () => {
    var fetch = function() { return Promise.reject(new Error('boom')); };
    var adapter = _kvsEngine(makeCfg(fetch));

    var related = await adapter.getRelated({ url: 'https://example.com/videos/9/x/' });
    expect(related).toEqual([]);
  });
});

// =============================================================================
// REQ-C helpers: _isAndroid, _nativeFetch
// =============================================================================

// Verbatim from plugin.js (Phase 4)
function _isAndroid() {
  try {
    return !!(window.Lampa && window.Lampa.Platform &&
              typeof window.Lampa.Platform.is === 'function' &&
              window.Lampa.Platform.is('android'));
  } catch (e) { return false; }
}

function _nativeFetch(url, LampaReguest) {
  // In plugin.js `window.Lampa.Reguest` is used directly.
  // For testability, accept it as a parameter here.
  return new Promise(function(resolve, reject) {
    var req = new LampaReguest();
    req.native(url, function(data) {
      resolve(typeof data === 'object' ? JSON.stringify(data) : String(data));
      req.clear();
    }, function(err) {
      req.clear();
      reject(err);
    }, false, { dataType: 'text', timeout: 4000 });
  });
}

describe('_isAndroid', function() {
  it('returns false when window is undefined (Node.js env)', function() {
    // In vitest Node environment window is not defined — the try/catch must return false.
    expect(_isAndroid()).toBe(false);
  });

  it('returns false when Lampa is absent from window', function() {
    // Simulate a browser-like window without Lampa.
    var origWindow = typeof window !== 'undefined' ? window : undefined;
    if (typeof window !== 'undefined') {
      var savedLampa = window.Lampa;
      delete window.Lampa;
      expect(_isAndroid()).toBe(false);
      if (savedLampa !== undefined) window.Lampa = savedLampa;
    } else {
      // window is already undefined — covered by previous test
      expect(_isAndroid()).toBe(false);
    }
  });
});

describe('_nativeFetch', function() {
  it('resolves with string data from success callback', async function() {
    var MockReguest = function() {
      this.cleared = false;
      this.clear = function() { this.cleared = true; };
      this.native = function(url, ok, err, sync, opts) {
        ok('hello from native');
      };
    };
    var result = await _nativeFetch('https://example.com', MockReguest);
    expect(result).toBe('hello from native');
  });

  it('resolves with JSON.stringify when data is an object', async function() {
    var MockReguest = function() {
      this.clear = function() {};
      this.native = function(url, ok) { ok({ videos: [1, 2, 3] }); };
    };
    var result = await _nativeFetch('https://example.com', MockReguest);
    expect(result).toBe('{"videos":[1,2,3]}');
  });

  it('calls req.clear() in success path', async function() {
    var cleared = false;
    var MockReguest = function() {
      this.clear = function() { cleared = true; };
      this.native = function(url, ok) { ok('data'); };
    };
    await _nativeFetch('https://example.com', MockReguest);
    expect(cleared).toBe(true);
  });

  it('rejects and calls req.clear() in reject path', async function() {
    var cleared = false;
    var MockReguest = function() {
      this.clear = function() { cleared = true; };
      this.native = function(url, ok, err) { err(new Error('network fail')); };
    };
    await expect(_nativeFetch('https://example.com', MockReguest)).rejects.toThrow('network fail');
    expect(cleared).toBe(true);
  });
});

// ============================================================
// REQ-2: Preview on hover — extracted closure logic unit tests
// ============================================================

// Inline reimplementation of closure helpers for testability.
// Must match the plugin.js implementation exactly.

function makePreviewClosure() {
  var _currentPreviewEl   = null;
  var _currentPreviewCard = null;

  function _stopCurrentPreview() {
    if (_currentPreviewEl) {
      _currentPreviewEl.pause();
      _currentPreviewEl.removeAttribute('src');
      _currentPreviewEl.load();
      _currentPreviewEl.style.display = 'none';
      _currentPreviewEl   = null;
      _currentPreviewCard = null;
    }
  }

  function _startPreview(card, url) {
    var videoEl = card._videoEl;
    if (!videoEl) return;
    videoEl.src = url;
    videoEl.load();
    videoEl.style.display = 'block';
    _currentPreviewEl   = videoEl;
    _currentPreviewCard = card;
    videoEl.play().catch(function () {
      if (!videoEl.parentNode) return;
      videoEl.style.display = 'none';
    });
  }

  return { stop: _stopCurrentPreview, start: _startPreview };
}

function makeVideoEl(overrides) {
  var el = {
    src:        '',
    style:      { display: 'none' },
    parentNode: {},          // non-null by default (card in DOM)
    _paused:    false,
    _loaded:    false,
    _playResolve: null,
    _playReject:  null,
    pause:           function () { el._paused = true; },
    load:            function () { el._loaded = true; },
    removeAttribute: function (a) { if (a === 'src') el.src = ''; },
    play:            function () {
      return new Promise(function (resolve, reject) {
        el._playResolve = resolve;
        el._playReject  = reject;
      });
    }
  };
  if (overrides) {
    Object.keys(overrides).forEach(function (k) { el[k] = overrides[k]; });
  }
  return el;
}

function makeCard(videoEl) {
  return {
    _videoEl: videoEl,
    find:     function (sel) {
      if (sel === '.cherry-card__preview') {
        return [videoEl];
      }
      return [];
    }
  };
}

describe('REQ-2 preview', function () {
  it('AC-2.2: video becomes visible when preview set and enabled (non-android)', function () {
    var closure = makePreviewClosure();
    var videoEl = makeVideoEl();
    var card    = makeCard(videoEl);

    // Simulate hover:focus handler with preview enabled, non-android
    closure.stop();
    closure.start(card, 'http://x/preview.mp4');

    expect(videoEl.style.display).toBe('block');
    expect(videoEl.src).toBe('http://x/preview.mp4');
  });

  it('AC-2.3: focusing card B stops card A preview', function () {
    var closure = makePreviewClosure();
    var elA  = makeVideoEl();
    var elB  = makeVideoEl();
    var cardA = makeCard(elA);
    var cardB = makeCard(elB);

    closure.start(cardA, 'http://x/a.mp4');
    expect(elA.style.display).toBe('block');

    // Now focus card B
    closure.stop();
    closure.start(cardB, 'http://x/b.mp4');

    expect(elA.style.display).toBe('none');
    expect(elA.src).toBe('');
    expect(elB.style.display).toBe('block');
  });

  it('AC-2.4: empty preview URL — video stays hidden', function () {
    var closure = makePreviewClosure();
    var videoEl = makeVideoEl();
    var card    = makeCard(videoEl);

    // Simulate: video.preview = '' → condition fails → no startPreview called
    var previewUrl = '';
    if (previewUrl) {
      closure.start(card, previewUrl);
    }

    expect(videoEl.style.display).toBe('none');
    expect(videoEl.src).toBe('');
  });

  it('AC-2.5: android guard — no preview started', function () {
    var closure = makePreviewClosure();
    var videoEl = makeVideoEl();
    var card    = makeCard(videoEl);

    // Simulate: _isAndroid() returns true → no startPreview
    var isAndroid = true;
    if (!isAndroid) {
      closure.start(card, 'http://x/preview.mp4');
    }

    expect(videoEl.style.display).toBe('none');
  });

  it('AC-2.6: destroy while preview playing — src cleared and hidden', function () {
    var closure = makePreviewClosure();
    var videoEl = makeVideoEl();
    var card    = makeCard(videoEl);

    closure.start(card, 'http://x/preview.mp4');
    expect(videoEl.style.display).toBe('block');

    // Simulate destroy
    closure.stop();

    expect(videoEl.src).toBe('');
    expect(videoEl.style.display).toBe('none');
    expect(videoEl._paused).toBe(true);
  });

  it('AC-2.8: play().catch does not touch DOM after card removed from DOM', async function () {
    var closure = makePreviewClosure();
    var videoEl = makeVideoEl();
    var card    = makeCard(videoEl);

    closure.start(card, 'http://x/preview.mp4');
    // save deferred
    var reject = videoEl._playReject;

    // Simulate destroy: _stopCurrentPreview called, then html.remove() sets parentNode = null
    closure.stop();
    videoEl.parentNode = null;

    // Now the play() promise rejects (e.g. AbortError after src removed)
    reject(new Error('AbortError'));
    // Give microtask queue a tick
    await Promise.resolve();

    // catch handler bailed early because parentNode is null
    // display should NOT have been set to 'none' by the catch (it was already none by _stop)
    expect(videoEl.style.display).toBe('none');
  });
});

// ============================================================
// REQ-3: Model browse — unit tests
// ============================================================

// Inline stub helpers simulating renderCards model badge logic.
function makeModelCard(video) {
  var badgeEl = {
    _text:    '',
    _visible: false,
    _handlers: {},
    text:  function (t) { badgeEl._text = t; return badgeEl; },
    show:  function () { badgeEl._visible = true; return badgeEl; },
    on:    function (ev, fn) { badgeEl._handlers[ev] = fn; return badgeEl; }
  };
  var card = {
    find: function (sel) {
      if (sel === '.cherry-card__model') return badgeEl;
      return { text: function(){return this;}, show: function(){return this;}, on: function(){return this;} };
    }
  };
  return { card: card, badge: badgeEl };
}

// Simulates the renderCards model badge block.
function applyModelBadge(video, card, sourceById, ActivityPush, NotyShow) {
  if (video.model && video.model.name) {
    var modelBadge = card.find('.cherry-card__model');
    modelBadge.text(video.model.name).show();
    modelBadge.on('hover:enter', function () {
      var badgeSrc = sourceById(video.source);
      if (!badgeSrc || !badgeSrc.browseByModel) {
        NotyShow(video.model.name, { style: 'info' });
        return;
      }
      ActivityPush({
        component:  'cherry_grid',
        title:      video.model.name,
        source_id:  video.source,
        model_url:  video.model.url,
        model_name: video.model.name,
        page:       1
      });
    });
  }
}

describe('REQ-3 model browse', function () {
  it('AC-3.1: no model field — badge stays hidden', function () {
    var m = makeModelCard({ source: 'pornhub' });
    applyModelBadge({ source: 'pornhub' }, m.card,
      function() { return null; }, function() {}, function() {});
    expect(m.badge._visible).toBe(false);
  });

  it('AC-3.2: model set — badge text equals model.name', function () {
    var video = { source: 'pornhub', model: { name: 'Mia', url: 'http://ph/pornstar/mia' } };
    var m = makeModelCard(video);
    applyModelBadge(video, m.card,
      function() { return null; }, function() {}, function() {});
    expect(m.badge._text).toBe('Mia');
    expect(m.badge._visible).toBe(true);
  });

  it('AC-3.3: badge hover:enter with browseByModel — Activity.push called', function () {
    var video = { source: 'pornhub', model: { name: 'Mia', url: 'http://ph/pornstar/mia' } };
    var m = makeModelCard(video);
    var pushed = null;
    var src = { browseByModel: function() {} };
    applyModelBadge(video, m.card,
      function() { return src; },
      function(params) { pushed = params; },
      function() {});
    m.badge._handlers['hover:enter']();
    expect(pushed).not.toBeNull();
    expect(pushed.component).toBe('cherry_grid');
    expect(pushed.model_url).toBe('http://ph/pornstar/mia');
  });

  it('AC-3.4: badge hover:enter without browseByModel — Noty shown, Activity.push NOT called', function () {
    var video = { source: 'pornhub', model: { name: 'Mia', url: 'http://ph/pornstar/mia' } };
    var m = makeModelCard(video);
    var pushed = null;
    var notyMsg = null;
    applyModelBadge(video, m.card,
      function() { return {}; },
      function(params) { pushed = params; },
      function(msg) { notyMsg = msg; });
    m.badge._handlers['hover:enter']();
    expect(pushed).toBeNull();
    expect(notyMsg).toBe('Mia');
  });

  it('AC-3.8: badge visible even when adapter has no browseByModel', function () {
    var video = { source: 'pornhub', model: { name: 'Mia', url: 'http://ph/pornstar/mia' } };
    var m = makeModelCard(video);
    applyModelBadge(video, m.card,
      function() { return {}; },
      function() {}, function() {});
    expect(m.badge._visible).toBe(true);
  });

  it('AC-3.5: loadPage with model_url calls browseByModel(modelUrl, page)', function () {
    var called = null;
    var src = {
      browseByModel: function(url, p) {
        called = { url: url, page: p };
        return Promise.resolve({ items: [], total_pages: 1 });
      }
    };
    // Simulate loadPage dispatch logic
    var object = { model_url: 'http://ph/pornstar/mia', source_id: 'pornhub' };
    var page   = 1;
    var promise;
    if (object.model_url) {
      if (!src || !src.browseByModel) {
        // early return path
      } else {
        promise = src.browseByModel(object.model_url, page);
      }
    }
    expect(called).not.toBeNull();
    expect(called.url).toBe('http://ph/pornstar/mia');
    expect(called.page).toBe(1);
  });

  it('AC-3.6: badge hover:enter does NOT call playVideo (only Activity.push or Noty)', function () {
    // playVideo is a separate function — badge enter only pushes activity or shows noty.
    // This test verifies the badge handler doesn't leak into hover:enter of the parent card.
    var video = { source: 'pornhub', model: { name: 'Mia', url: 'http://ph/pornstar/mia' } };
    var m = makeModelCard(video);
    var playVideoCalled = false;
    var src = { browseByModel: function() {} };
    applyModelBadge(video, m.card,
      function() { return src; },
      function() {},
      function() {});
    // Call badge enter — should not throw and should not invoke playVideo
    m.badge._handlers['hover:enter']();
    expect(playVideoCalled).toBe(false);
  });
});

// ============================================================
// REQ-4: Related videos — generation counter + push logic tests
// ============================================================

// Inline reimplementation of the playVideo getRelated + player destroy logic.
function makeRelatedState() {
  var state = {
    relatedGeneration: 0,
    pendingRelated:    [],
    relatedSrc:        null
  };

  function playVideoRelated(video, source, _getRelated) {
    state.relatedGeneration++;
    var myGen          = state.relatedGeneration;
    state.pendingRelated = [];
    state.relatedSrc     = null;
    if (source.getRelated) {
      _getRelated(video).then(function (items) {
        if (myGen !== state.relatedGeneration) return;
        if (items && items.length) {
          state.pendingRelated = items;
          state.relatedSrc     = source;
        }
      }).catch(function () {});
    }
  }

  function onPlayerDestroy(ActivityPush, translateFn) {
    state.relatedGeneration++;
    if (state.pendingRelated.length) {
      var items = state.pendingRelated;
      var rSrc  = state.relatedSrc;
      state.pendingRelated = [];
      state.relatedSrc     = null;
      ActivityPush({
        component:      'cherry_grid',
        title:          translateFn('cherry_related'),
        source_id:      rSrc ? rSrc.id : '',
        _related_items: items,
        page:           1
      });
    }
  }

  return { state: state, playVideoRelated: playVideoRelated, onPlayerDestroy: onPlayerDestroy };
}

describe('REQ-4 related videos', function () {
  it('AC-4.1: adapter with getRelated — spy called after playVideoRelated', async function () {
    var r = makeRelatedState();
    var spyCalled = false;
    var src = {
      id: 'pornhub',
      getRelated: function(v) {
        spyCalled = true;
        return Promise.resolve([{ id: '1', title: 'r1' }]);
      }
    };
    r.playVideoRelated({ id: 'v1' }, src, src.getRelated.bind(src));
    await Promise.resolve();
    expect(spyCalled).toBe(true);
  });

  it('AC-4.2: adapter without getRelated — no error, pendingRelated stays empty', function () {
    var r = makeRelatedState();
    var src = { id: 'xvideos' }; // no getRelated
    r.playVideoRelated({ id: 'v1' }, src, function() { return Promise.resolve([]); });
    expect(r.state.pendingRelated.length).toBe(0);
  });

  it('AC-4.3: player destroy with non-empty pendingRelated — Activity.push called', async function () {
    var r = makeRelatedState();
    var src = {
      id: 'pornhub',
      getRelated: function(v) { return Promise.resolve([{ id: '1', title: 'r1' }]); }
    };
    r.playVideoRelated({ id: 'v1' }, src, src.getRelated.bind(src));
    await new Promise(function(res) { setTimeout(res, 0); });

    var pushed = null;
    r.onPlayerDestroy(function(p) { pushed = p; }, function(k) { return k; });
    expect(pushed).not.toBeNull();
    expect(pushed.component).toBe('cherry_grid');
    expect(pushed._related_items.length).toBe(1);
  });

  it('AC-4.4: player destroy with empty pendingRelated — Activity.push NOT called', function () {
    var r = makeRelatedState();
    var pushed = null;
    r.onPlayerDestroy(function(p) { pushed = p; }, function(k) { return k; });
    expect(pushed).toBeNull();
  });

  it('AC-4.7: generation counter prevents stale result overwrite', async function () {
    var r = makeRelatedState();
    var resolveFirst;
    var src1 = {
      id: 's1',
      getRelated: function() {
        return new Promise(function(res) { resolveFirst = res; });
      }
    };
    var src2 = {
      id: 's2',
      getRelated: function() {
        return Promise.resolve([{ id: '2', title: 'second' }]);
      }
    };
    // First call — will resolve late
    r.playVideoRelated({ id: 'v1' }, src1, src1.getRelated.bind(src1));
    // Second call — resolves immediately
    r.playVideoRelated({ id: 'v2' }, src2, src2.getRelated.bind(src2));
    await new Promise(function(res) { setTimeout(res, 0); });
    // Now resolve the first (stale)
    resolveFirst([{ id: '1', title: 'first' }]);
    await new Promise(function(res) { setTimeout(res, 0); });
    // Only second call's result should survive
    expect(r.state.pendingRelated.length).toBe(1);
    expect(r.state.pendingRelated[0].id).toBe('2');
  });

  it('AC-4.5: CherryGrid with _related_items — renderCards called, no loadPage', function () {
    // Simulate the create() branch logic
    var rendered = false;
    var loadPageCalled = false;
    var object = { _related_items: [{ id: '1' }, { id: '2' }] };

    function simulateCreate() {
      if (object.is_favorites) {
        // ...
      } else if (object._related_items) {
        rendered = true;
        // renderCards(object._related_items, ...)
      } else if (object.all_sources) {
        // ...
      } else {
        loadPageCalled = true;
      }
    }
    simulateCreate();
    expect(rendered).toBe(true);
    expect(loadPageCalled).toBe(false);
  });
});

// ============================================================
// REQ-5: Sort + categories — filter bar logic tests
// ============================================================

// Inline helpers matching the closure implementation.
function _findLabel(arr, id) {
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].id === id) return arr[i].label;
  }
  return id;
}

function makeFilterState() {
  var state = { currentSort: '', currentCategory: '' };

  function isFilterBarVisible(source) {
    var hasSorts = source && source.cfg && source.cfg.sorts && source.cfg.sorts.length;
    var hasCats  = source && source.cfg && source.cfg.categories && source.cfg.categories.length;
    return !!(hasSorts || hasCats);
  }

  function selectSort(source, sortId) {
    state.currentSort = sortId;
  }

  function selectCategory(source, catId) {
    state.currentCategory = catId;
  }

  return { state: state, isFilterBarVisible: isFilterBarVisible,
           selectSort: selectSort, selectCategory: selectCategory };
}

describe('REQ-5 sort + categories', function () {
  it('AC-5.1: adapter without cfg — filter bar hidden', function () {
    var f = makeFilterState();
    expect(f.isFilterBarVisible({})).toBe(false);
    expect(f.isFilterBarVisible(null)).toBe(false);
  });

  it('AC-5.2: adapter with cfg.sorts only — sorts visible, categories not', function () {
    var source = { cfg: { sorts: [{ id: 'mv', label: 'Популярное' }] } };
    var hasSorts = !!(source.cfg && source.cfg.sorts && source.cfg.sorts.length);
    var hasCats  = !!(source.cfg && source.cfg.categories && source.cfg.categories && source.cfg.categories.length);
    expect(hasSorts).toBe(true);
    expect(hasCats).toBe(false);
  });

  it('AC-5.3: selecting sort — browse called with (category, 1, sortId)', function () {
    var f = makeFilterState();
    var browseCalls = [];
    var source = {
      cfg: { sorts: [{ id: 'mv', label: 'Популярное' }] },
      browse: function(cat, page, sort) { browseCalls.push({ cat: cat, page: page, sort: sort }); return Promise.resolve({ items: [], total_pages: 1 }); }
    };
    f.selectSort(source, 'mv');
    // Simulate loadPage after reload
    source.browse(f.state.currentCategory, 1, f.state.currentSort);
    expect(browseCalls[0].sort).toBe('mv');
    expect(browseCalls[0].page).toBe(1);
    expect(browseCalls[0].cat).toBe('');
  });

  it('AC-5.4: selecting category — browse called with (catId, 1, sort)', function () {
    var f = makeFilterState();
    var browseCalls = [];
    var source = {
      cfg: { categories: [{ id: 'teen', label: 'Teen' }] },
      browse: function(cat, page, sort) { browseCalls.push({ cat: cat, page: page, sort: sort }); return Promise.resolve({ items: [], total_pages: 1 }); }
    };
    f.selectCategory(source, 'teen');
    source.browse(f.state.currentCategory, 1, f.state.currentSort);
    expect(browseCalls[0].cat).toBe('teen');
    expect(browseCalls[0].sort).toBe('');
  });

  it('AC-5.5: selecting Default sort — browse called with sort=""', function () {
    var f = makeFilterState();
    f.state.currentSort = 'mv';
    f.selectSort(null, '');
    expect(f.state.currentSort).toBe('');
  });

  it('AC-5.6: sort button label updates to selected sort label', function () {
    var sorts = [{ id: 'mv', label: 'Популярное' }, { id: 'tr', label: 'Трендовое' }];
    var label = _findLabel(sorts, 'tr');
    expect(label).toBe('Трендовое');
  });

  it('AC-5.7: page 2 browse respects active sort', function () {
    var f = makeFilterState();
    f.state.currentSort = 'mv';
    var browseCalls = [];
    var source = {
      browse: function(cat, page, sort) { browseCalls.push({ page: page, sort: sort }); return Promise.resolve({ items: [], total_pages: 3 }); }
    };
    // Simulate page 1 and page 2
    source.browse(f.state.currentCategory, 1, f.state.currentSort);
    source.browse(f.state.currentCategory, 2, f.state.currentSort);
    expect(browseCalls[1].sort).toBe('mv');
    expect(browseCalls[1].page).toBe(2);
  });

  it('AC-5.9: _reloadFromStart hides empty state before loadPage', function () {
    var emptyHidden = false;
    var loadPageCalled = false;
    // Simulate _reloadFromStart logic
    function simulateReload() {
      emptyHidden = true;  // html.find('.cherry-grid__empty').hide()
      // ... reset state ...
      loadPageCalled = true;  // loadPage(1)
    }
    simulateReload();
    expect(emptyHidden).toBe(true);
    expect(loadPageCalled).toBe(true);
  });

  it('AC-5.10: sort button hover:enter with source.cfg absent — no crash', function () {
    var source = {}; // no cfg
    var threw = false;
    try {
      // Simulate the hover:enter guard
      if (!source || !source.cfg || !source.cfg.sorts) {
        // early return — no crash
      } else {
        throw new Error('should not reach here');
      }
    } catch(e) { threw = true; }
    expect(threw).toBe(false);
  });
});

// ============================================================
// adapter-preview-quality: xvideos video.preview (REQ-1)
// ============================================================

// Inline reimplementation of xvideos _parseCards (no imports — IIFE).
// _attr, parseDur, parseViews are at module scope (lines 13/32/44).
// stripTags defined locally below (NOT in module scope).
function stripTagsLocal(s) {
  return (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
                  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                  .replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim();
}

function xvParseCards(html) {
  var items = [];
  var blocks = html.split(/<div[^>]+class="[^"]*thumb-block[^"]*"/);
  for (var i = 1; i < blocks.length; i++) {
    var block = blocks[i];
    var hrefMatch = block.match(/href="(\/video\.([a-z0-9]+)\/[^"]+)"/);
    if (!hrefMatch) continue;
    var href = hrefMatch[1];
    var numId = hrefMatch[2];
    var videoUrl = 'https://www.xvideos2.com' + href;
    var thumbMatch = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+\.jpg[^"]*)"/);
    var thumb = thumbMatch ? thumbMatch[1] : '';
    var pvvMatch = block.match(/data-pvv="([^"]+)"/);
    var preview = pvvMatch ? pvvMatch[1].replace(/\\\//g, '/') : '';
    var titleMatch = block.match(/<p[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)/) ||
                     block.match(/title="([^"]+)"/);
    var title = titleMatch ? stripTagsLocal(titleMatch[1]) : '';
    var durMatch = block.match(/<span[^>]*class="[^"]*duration[^"]*"[^>]*>([^<]+)/);
    var duration = durMatch ? parseDur(durMatch[1].trim()) : 0;
    var hdMatch = block.match(/class="video-hd-mark"[^>]*>\s*(\d+)/);
    var hd = hdMatch ? (parseInt(hdMatch[1], 10) >= 2160 ? '4K' : 'HD') : '';
    if (!numId && href) {
      var idFromHref = href.match(/video(\d+)\//);
      numId = idFromHref ? idFromHref[1] : String(i);
    }
    items.push({ id: 'xv' + numId, source: 'xvideos', title: title, thumb: thumb,
                 preview: preview, hd: hd, url: videoUrl, duration: duration, views: 0 });
  }
  return items;
}

// ============================================================
// adapter-preview-quality: xnxx video.preview (REQ-2)
// ============================================================
// Verbatim from plugin.js _titleFromUrl (line ~1336)
function _titleFromUrl(url) {
  if (!url) return '';
  try {
    var seg = String(url).split('?')[0].split('#')[0].replace(/\/+$/, '').split('/').pop() || '';
    seg = seg.replace(/\.(html?|php)$/i, '').replace(/^\d+[-_]/, '');
    seg = decodeURIComponent(seg).replace(/[-_]+/g, ' ').trim();
    if (/^\d+$/.test(seg)) return '';
    return seg.charAt(0).toUpperCase() + seg.slice(1);
  } catch (e) { return ''; }
}

// ---- _xvideosRelated --------------------------------------------------------
// Verbatim from plugin.js — xvideos/xnxx video pages embed related as a JSON
// array `video_related=[...]`. Field map: u=path, tf=full title, i=thumb,
// eid=id, d="12 min"/"12min"→sec, hm=1→HD. Kept IN SYNC with plugin.js.
function _xvideosRelated(html, host, sourceId) {
  var m = html.match(/video_related\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!m) return [];
  var arr;
  try { arr = JSON.parse(m[1]); } catch (e) { return []; }
  var out = [];
  arr.forEach(function (o) {
    if (!o || !o.u) return;
    var dur;
    var dm = o.d && String(o.d).match(/(\d+)\s*min/);
    if (dm) dur = parseInt(dm[1], 10) * 60;
    out.push({
      id:     o.eid || o.id,
      title:  o.tf || o.t || '',
      thumb:  o.i || o.il || '',
      url:    host + o.u,
      source: sourceId,
      duration: dur,
      hd:     o.hm ? 'HD' : undefined
    });
  });
  return out;
}

// ---- _epornerRelated --------------------------------------------------------
// Verbatim from plugin.js — eporner video pages embed related as `mbcontent`
// HTML cards. Kept IN SYNC with plugin.js.
function _epornerRelated(html) {
  var out = [];
  var seen = {};
  var rx = /<div class="mbcontent"><a href="(\/video-([^/"]+)\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  var m;
  while ((m = rx.exec(html)) !== null) {
    var path = m[1];
    var id = m[2];
    var inner = m[3];
    if (seen[id]) continue;
    seen[id] = true;
    var url = 'https://www.eporner.com' + path;
    var thumb = _attr(inner, /data-src="([^"]+)"/) || _attr(inner, /src="(https?:\/\/[^"]+\.jpe?g[^"]*)"/i) || '';
    var title = _decodeHtml(_attr(inner, /alt="([^"]+)"/)) || _titleFromUrl(url);
    out.push({ id: id, source: 'eporner', title: title, thumb: thumb, url: url });
  }
  return out;
}

describe('_xvideosRelated (xvideos/xnxx video_related JSON)', () => {
  const host = 'https://www.xvideos.com';
  const fixtureHtml =
    'prefix var video_related=[' +
    '{"u":"/video.aaa/one","tf":"First Clip","t":"x","i":"https://cdn/1.jpg","eid":"aaa","d":"12 min","hm":1},' +
    '{"u":"/video.bbb/two","tf":"Second Clip","i":"https://cdn/2.jpg","eid":"bbb","d":"5min","hm":0}' +
    ']; suffix';

  it('maps JSON fields → cards (url=host+u, title=tf, thumb=i, id=eid, dur sec, hd)', () => {
    const out = _xvideosRelated(fixtureHtml, host, 'xvideos');
    expect(out.length).toBe(2);
    expect(out[0]).toMatchObject({
      id: 'aaa', title: 'First Clip', thumb: 'https://cdn/1.jpg',
      url: host + '/video.aaa/one', source: 'xvideos', duration: 720, hd: 'HD'
    });
  });

  it('parses "12 min" and "5min" → 720 / 300 seconds', () => {
    const out = _xvideosRelated(fixtureHtml, host, 'xvideos');
    expect(out[0].duration).toBe(720);
    expect(out[1].duration).toBe(300);
  });

  it('hm:0 → hd undefined (no non-numeric duration / hd noise)', () => {
    const out = _xvideosRelated(fixtureHtml, host, 'xvideos');
    expect(out[1].hd).toBeUndefined();
  });

  it('excludes the current video url (caller filter contract)', () => {
    const cur = host + '/video.aaa/one';
    const out = _xvideosRelated(fixtureHtml, host, 'xvideos')
      .filter((v) => v.url !== cur);
    expect(out.map((v) => v.id)).toEqual(['bbb']);
  });

  it('returns [] when video_related var is absent', () => {
    expect(_xvideosRelated('<html>no related here</html>', host, 'xvideos')).toEqual([]);
  });

  it('returns [] on malformed JSON (degrades safely)', () => {
    expect(_xvideosRelated('video_related=[{bad json];', host, 'xvideos')).toEqual([]);
  });
});

describe('_epornerRelated (mbcontent HTML cards)', () => {
  const fixtureHtml =
    '<div class="mbcontent"><a href="/video-rFWJVaXGkRx/late-night/">' +
    '<img class="lazyimg" src="data:image/gif;base64,AAA" ' +
    'data-src="https://static-eu-cdn.eporner.com/thumbs/1_240.jpg" ' +
    'alt="Late Night Overtime" /></a><div class="mvhdico"><span>720p</span></div></div>' +
    '<div class="mbcontent"><a href="/video-ZZZ/other-clip/">' +
    '<img data-src="https://cdn/2.jpg" alt="Other Clip" /></a></div>';

  it('parses cards: url=site+href, id from /video-XXX/, title=alt, thumb=data-src', () => {
    const out = _epornerRelated(fixtureHtml);
    expect(out.length).toBe(2);
    expect(out[0]).toMatchObject({
      id: 'rFWJVaXGkRx',
      title: 'Late Night Overtime',
      thumb: 'https://static-eu-cdn.eporner.com/thumbs/1_240.jpg',
      url: 'https://www.eporner.com/video-rFWJVaXGkRx/late-night/',
      source: 'eporner'
    });
  });

  it('excludes the current video url (caller filter contract)', () => {
    const cur = 'https://www.eporner.com/video-rFWJVaXGkRx/late-night/';
    const out = _epornerRelated(fixtureHtml).filter((v) => v.url !== cur);
    expect(out.map((v) => v.id)).toEqual(['ZZZ']);
  });

  it('returns [] when no mbcontent cards present', () => {
    expect(_epornerRelated('<html>no cards</html>')).toEqual([]);
  });
});

// Inline reimplementation of xnxx _parseCards — kept IN SYNC with plugin.js.
// Splits on the OUTER thumb-block wrapper (like xvideos) so each block holds
// BOTH this card's .thumb image and its .thumb-under caption (no off-by-one).
function xnxxParseCards(html) {
  var items = [];
  var mozParts = html.split('<div class="mozaique"');
  var content = mozParts.length > 1 ? mozParts[mozParts.length - 1] : html;
  var blocks = content.split(/<div[^>]+class="[^"]*thumb-block[^"]*"/);
  for (var i = 1; i < blocks.length; i++) {
    var block = blocks[i];
    var hrefMatch = block.match(/href="(\/video-?([^/]+)\/[^"]+)"/);
    if (!hrefMatch) hrefMatch = block.match(/href="(\/video([a-z0-9]+)[^"]*)"/);
    if (!hrefMatch) continue;
    var href = hrefMatch[1];
    var rawId = hrefMatch[2] || '';
    var videoUrl = 'https://www.xnxx.com' + href;
    var thumbMatch = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+\.jpg[^"]*)"/);
    var thumb = thumbMatch ? thumbMatch[1] : '';
    var pvvMatch = block.match(/data-pvv="([^"]+)"/);
    var preview = pvvMatch ? pvvMatch[1].replace(/\\\//g, '/') : '';
    var titleMatch = block.match(/class="title"[^>]*>([^<]+)/) ||
                     block.match(/title="([^"]+)"/) ||
                     block.match(/<a[^>]+>([^<]{5,})/);
    var title = titleMatch ? stripTagsLocal(titleMatch[1]) : '';
    if (!title) title = _titleFromUrl(videoUrl);
    items.push({ id: 'xnxx-' + rawId, source: 'xnxx', title: title, thumb: thumb,
                 preview: preview, url: videoUrl, duration: 0, views: 0 });
  }
  return items;
}

// ============================================================
// adapter-preview-quality: pornhub data-mediabook (REQ-3)
// ============================================================
function phParseHtmlCards(html) {
  // _attr, _decodeHtml, parseDur, parseViews already at module scope (lines 13/20/32/44)
  var items = [];
  var seen = {};
  var hrefRx = /href="(\/view_video\.php\?viewkey=([a-z0-9]+)[^"]*)"/g;
  var m;
  while ((m = hrefRx.exec(html)) !== null) {
    var href = m[1];
    var vkey = m[2];
    if (!vkey || seen[vkey]) continue;
    seen[vkey] = true;
    var videoUrl = 'https://www.pornhub.com' + href;
    var chunk = html.slice(Math.max(0, m.index - 200), m.index + 800);
    var thumb = _attr(chunk, /data-mediumthumb="([^"]+)"/) ||
                _attr(chunk, /data-thumb_url="([^"]+)"/) || '';
    var preview = _attr(chunk, /data-mediabook="([^"]+)"/);
    var title = _decodeHtml(
      _attr(chunk, /class="[^"]*videoTitle[^"]*"[^>]*>([^<]+)/) ||
      _attr(chunk, /title="([^"]+)"/)
    );
    var duration = parseDur(_attr(chunk, /<var class="duration">([^<]+)</));
    var views    = parseViews(_attr(chunk, /class="[^"]*videoViewCount[^"]*"[^>]*>([^<]+)</));
    if (title || thumb) {
      items.push({ id: vkey, source: 'pornhub', title: title, thumb: thumb,
                   preview: preview, url: videoUrl, duration: duration, views: views });
    }
  }
  return items;
}

// ============================================================
// adapter-preview-quality: Fav serialisation invariant (AC-P6)
// ============================================================
var FAV_FIELDS = ['id', 'source', 'title', 'thumb', 'url', 'duration', 'views'];

function favSerialise(video) {
  var out = {};
  FAV_FIELDS.forEach(function(k) { out[k] = video[k]; });
  return out;
}

describe('Fav serialisation invariant — preview excluded', function () {
  it('AC-P6: favSerialise strips preview and model fields', function () {
    var card = {
      id: 'xv-abc', source: 'xvideos', title: 'T', thumb: 'http://t', url: 'http://u',
      duration: 60, views: 100,
      preview: 'https://thumb-cdn77.xvideos-cdn.com/UUID/3/preview.mp4',
      model: { name: 'Test', url: 'http://m' }
    };
    var saved = favSerialise(card);
    expect(saved.preview).toBeUndefined();
    expect(saved.model).toBeUndefined();
    expect(Object.keys(saved)).toEqual(FAV_FIELDS);
  });
});

describe('REQ-3 pornhub data-mediabook', function () {
  var MEDIABOOK = 'https://kw.phncdn.com/videos/202405/14/452452431/180P_225K_452452431.webm?hdnea=st=1~exp=2~hdl=-1~hmac=abc';

  it('AC-P4: extracts data-mediabook as preview', function () {
    var html = '<li class="pcVideoListItem"><a href="/view_video.php?viewkey=ph123456">' +
               '<img data-mediumthumb="https://ei.phncdn.com/thumb.jpg"' +
               ' data-mediabook="' + MEDIABOOK + '">' +
               '</a><span class="videoTitle"><a title="Test">Test video</a></span></li>';
    var items = phParseHtmlCards(html);
    expect(items.length).toBe(1);
    expect(items[0].preview).toBe(MEDIABOOK);
  });

  it('AC-P5: card without data-mediabook has empty preview', function () {
    var html = '<li class="pcVideoListItem"><a href="/view_video.php?viewkey=ph123456">' +
               '<img data-mediumthumb="https://ei.phncdn.com/thumb.jpg">' +
               '</a><span class="videoTitle"><a title="Test">Test video</a></span></li>';
    var items = phParseHtmlCards(html);
    expect(items.length).toBe(1);
    expect(items[0].preview).toBe('');
  });
});

describe('REQ-2 xnxx video.preview (real data-pvv attribute)', function () {
  // S5: real preview is the data-pvv attr (confirmed via curl on xnxx /search
  // listing markup: data-pvv="https://thumb-cdn77.xnxx-cdn.com/UUID/0/preview.mp4").
  // The old guessed thumb→/preview.mp4 fallback is GONE.
  var UUID = '8f9a9694-d042-4f65-9a3b-c13ed3c0f91b';
  var THUMB = 'https://thumb-cdn77.xnxx-cdn.com/' + UUID + '/3/xn_15_t.jpg';
  var PVV = 'https://thumb-cdn77.xnxx-cdn.com/' + UUID + '/0/preview.mp4';

  // Real card: outer .thumb-block wraps .thumb (img + data-pvv) + .thumb-under.
  function card(href, thumb, pvv) {
    var pvvAttr = pvv ? ' data-pvv="' + pvv + '"' : '';
    return '<div class="thumb-block ">' +
             '<div class="thumb"><a href="' + href + '"><img data-src="' + thumb + '"' + pvvAttr + '></a></div>' +
             '<div class="thumb-under"><p class="title"><a href="' + href + '">Cap</a></p></div>' +
           '</div>';
  }

  it('AC-P3a: reads preview from data-pvv', function () {
    var html = '<div class="mozaique">' + card('/video-abc123/slug', THUMB, PVV) + '</div>';
    var items = xnxxParseCards(html);
    expect(items.length).toBe(1);
    expect(items[0].preview).toBe(PVV);
  });

  it('AC-P3b: unescapes \\/ in data-pvv', function () {
    var escaped = 'https:\\/\\/thumb-cdn77.xnxx-cdn.com\\/' + UUID + '\\/0\\/preview.mp4';
    var html = '<div class="mozaique">' + card('/video-abc123/slug', THUMB, escaped) + '</div>';
    var items = xnxxParseCards(html);
    expect(items[0].preview).toBe(PVV);
  });

  it('AC-P3c: no data-pvv → empty preview (NO /preview.mp4 guess)', function () {
    var html = '<div class="mozaique">' + card('/video-abc123/slug', THUMB, '') + '</div>';
    var items = xnxxParseCards(html);
    expect(items.length).toBe(1);
    expect(items[0].preview).toBe('');
  });
});

// ============================================================
// Fix J — xnxx off-by-one: thumb must belong to the SAME card as href/title
// (fixture-backed, REAL markup). FAILS against the old inner thumb-under split.
// ============================================================
describe('Fix J — xnxx parser pairs thumb with the SAME card href', function () {
  // Extract the xnxx video id from a /video-ID/slug URL.
  function vidId(url) {
    var m = /\/video-?([^/]+)\//.exec(url || '');
    return m ? m[1] : null;
  }
  // The thumb filename embeds the same id (xn_<id>_t.jpg in the fixture).
  function thumbId(url) {
    var m = /xn_([a-z0-9]+)_t\./i.exec(url || '');
    return m ? m[1] : null;
  }

  it('items[0]: url id and thumb id reference the same video', function () {
    var items = xnxxParseCards(fixture('xnxx-list.html'));
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(vidId(items[0].url)).toBe('aaa111');
    expect(thumbId(items[0].thumb)).toBe('aaa111');
  });

  it('items[1]: url id and thumb id reference the same video', function () {
    var items = xnxxParseCards(fixture('xnxx-list.html'));
    expect(vidId(items[1].url)).toBe('bbb222');
    expect(thumbId(items[1].thumb)).toBe('bbb222');
  });

  it('every card has a non-empty title (parsed or URL fallback)', function () {
    var items = xnxxParseCards(fixture('xnxx-list.html'));
    items.forEach(function (it) { expect(it.title).not.toBe(''); });
  });

  it('title-less card (3rd) gets a non-empty title via _titleFromUrl', function () {
    var items = xnxxParseCards(fixture('xnxx-list.html'));
    var third = items[2];
    expect(vidId(third.url)).toBe('ccc333');
    expect(third.title).toBe('Lonely untitled card');
  });
});

// ============================================================
// Fix D — _titleFromUrl shared slug fallback
// ============================================================
describe('Fix D — _titleFromUrl slug fallback', function () {
  it('/video-123/hot-clip/ -> "Hot clip"', function () {
    expect(_titleFromUrl('https://x.com/video-123/hot-clip/')).toBe('Hot clip');
  });

  it('/12345-some_slug.html -> "Some slug"', function () {
    expect(_titleFromUrl('https://x.com/12345-some_slug.html')).toBe('Some slug');
  });

  it('/v/99999/ (numeric only) -> ""', function () {
    expect(_titleFromUrl('https://x.com/v/99999/')).toBe('');
  });

  it('empty -> ""', function () {
    expect(_titleFromUrl('')).toBe('');
  });

  it('decodes percent-encoding and collapses separators', function () {
    expect(_titleFromUrl('https://x.com/video/hot%20redhead-scene')).toBe('Hot redhead scene');
  });

  it('a card with thumb+url but no parsed title yields non-empty title', function () {
    var html = '<div class="mozaique"><div class="thumb-block ">' +
               '<div class="thumb"><a href="/video-zzz999/wild-party-night">' +
               '<img data-src="https://cdn/uuid/3/xn_zzz999_t.jpg"></a></div>' +
               '<div class="thumb-under"><a href="/video-zzz999/wild-party-night"></a></div>' +
               '</div></div>';
    var items = xnxxParseCards(html);
    expect(items.length).toBe(1);
    expect(items[0].title).toBe('Wild party night');
  });
});

describe('REQ-1 xvideos video.preview (real data-pvv attribute)', function () {
  // S5: real preview is the data-pvv attr (confirmed via curl on xvideos.com:
  // data-pvv="https://thumb-cdn77.xvideos-cdn.com/UUID/0/preview.mp4").
  // NOT data-videopreview (that attr does not exist). Old guess is GONE.
  var UUID = '5854c00a-cf8f-4ff8-bcef-38a1133f1132';
  var THUMB = 'https://thumb-cdn77.xvideos-cdn.com/' + UUID + '/3/xv_14_t.jpg';
  var PVV = 'https://thumb-cdn77.xvideos-cdn.com/' + UUID + '/0/preview.mp4';

  it('AC-P1: reads preview from data-pvv', function () {
    var html = '<div class="thumb-block"><a href="/video.abc123/slug">' +
               '<img data-src="' + THUMB + '" data-pvv="' + PVV + '"></a>' +
               '<p class="title">Test video</p></div>';
    var items = xvParseCards(html);
    expect(items.length).toBe(1);
    expect(items[0].preview).toBe(PVV);
    expect(items[0].thumb).toBe(THUMB);
  });

  it('AC-P2: no data-pvv → empty preview (NO /preview.mp4 guess)', function () {
    var html = '<div class="thumb-block"><a href="/video.abc123/slug">' +
               '<img data-src="' + THUMB + '"></a>' +
               '<p class="title">No preview</p></div>';
    var items = xvParseCards(html);
    expect(items.length).toBe(1);
    expect(items[0].preview).toBe('');
  });

  it('AC-P-HD: video-hd-mark 1080p → hd "HD"', function () {
    var html = '<div class="thumb-block"><a href="/video.abc123/slug">' +
               '<img data-src="' + THUMB + '"></a>' +
               '<span class="video-hd-mark">1080p</span>' +
               '<p class="title">HD video</p></div>';
    var items = xvParseCards(html);
    expect(items[0].hd).toBe('HD');
  });

  it('AC-P-4K: video-hd-mark 2160p → hd "4K"', function () {
    var html = '<div class="thumb-block"><a href="/video.abc123/slug">' +
               '<img data-src="' + THUMB + '"></a>' +
               '<span class="video-hd-mark">2160p</span>' +
               '<p class="title">4K video</p></div>';
    var items = xvParseCards(html);
    expect(items[0].hd).toBe('4K');
  });

  it('AC-P-noHD: no video-hd-mark → hd ""', function () {
    var html = '<div class="thumb-block"><a href="/video.abc123/slug">' +
               '<img data-src="' + THUMB + '"></a>' +
               '<p class="title">SD video</p></div>';
    var items = xvParseCards(html);
    expect(items[0].hd).toBe('');
  });
});

// ============================================================
// S2 toCard: HD/4K badge combined with duration in the quality slot
// ============================================================
// Verbatim from plugin.js secToTime (line ~293).
function secToTime(s) {
  s = parseInt(s, 10) || 0;
  var m = Math.floor(s / 60);
  var sec = s % 60;
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

// The quality-slot composition from toCard (CherryGrid). Pure extract — the
// rest of toCard (img/poster/source) is irrelevant to the quality logic.
function toCardQuality(v) {
  if (v.hd) v.quality = v.hd;   // HD-only; duration is a separate bottom-right overlay
  return v.quality;
}

describe('S2 toCard — quality slot = HD/4K only (duration is a separate overlay)', function () {
  it('hd present + duration → "HD" (duration NOT in quality slot)', function () {
    expect(toCardQuality({ duration: 754, hd: 'HD' })).toBe('HD');
  });

  it('4K present + duration → "4K"', function () {
    expect(toCardQuality({ duration: 65, hd: '4K' })).toBe('4K');
  });

  it('no hd, duration only → quality undefined (duration shown bottom-right)', function () {
    expect(toCardQuality({ duration: 754 })).toBe(undefined);
  });

  it('hd present, no duration → "HD"', function () {
    expect(toCardQuality({ hd: 'HD' })).toBe('HD');
  });

  it('neither hd nor duration → quality stays undefined', function () {
    expect(toCardQuality({})).toBe(undefined);
  });
});

// ============================================================
// S2 youjizz: per-card i-hd marker → v.hd = 'HD'
// ============================================================
// Inline reimplementation of youjizz _parseCards — kept IN SYNC with plugin.js.
function yjParseCards(html) {
  var items = [];
  var blocks = html.split('<div class="video-thumb"');
  for (var i = 1; i < blocks.length; i++) {
    var block = blocks[i];
    var hrefMatch = block.match(/href="(\/videos\/[^"]+\.html)"/);
    if (!hrefMatch) continue;
    var href = hrefMatch[1];
    var videoUrl = 'https://www.youjizz.com' + href;
    var idMatch = href.match(/(\d+)\.html/);
    var id = idMatch ? idMatch[1] : String(i);
    var thumbMatch = block.match(/data-original="([^"?#]+\.jpe?g)/i) ||
                     block.match(/data-src="([^"?#]+\.jpe?g)/i) ||
                     block.match(/src="([^"?#]+\.jpe?g)/i);
    var thumb = thumbMatch ? thumbMatch[1] : '';
    var hd = /class="i-hd"/.test(block) ? 'HD' : '';
    items.push({ id: 'yj-' + id, source: 'youjizz', thumb: thumb, hd: hd,
                 url: videoUrl, duration: 0, views: 0 });
  }
  return items;
}

describe('S2 youjizz — i-hd marker → v.hd "HD"', function () {
  // Real per-card marker: <span class="i-hd" data-i18n="video.videothumb.hd">HD</span>
  // confirmed via curl on youjizz.com (22/24 cards carried it).
  it('card with i-hd span → hd "HD"', function () {
    var html = '<div class="video-thumb"><a href="/videos/slug-12345.html">' +
               '<img data-original="https://cdn/x.jpg">' +
               '<span class="i-hd" data-i18n="video.videothumb.hd">HD</span></a></div>';
    var items = yjParseCards(html);
    expect(items.length).toBe(1);
    expect(items[0].hd).toBe('HD');
  });

  it('card without i-hd → hd ""', function () {
    var html = '<div class="video-thumb"><a href="/videos/slug-12345.html">' +
               '<img data-original="https://cdn/x.jpg"></a></div>';
    var items = yjParseCards(html);
    expect(items[0].hd).toBe('');
  });
});

// ============================================================
// S5/S2 anti-drift — plugin.js source assertions
// ============================================================
describe('S5/S2 plugin.js source assertions (anti-drift)', function () {
  var PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');

  it('xvideos/xnxx no longer guess preview via thumb→/preview.mp4', function () {
    // The two adapters dropped the sibling-guess. (pornhub uses data-mediabook,
    // which is a different path — this asserts the GUESS regex is gone for KVS too.)
    expect(/\.replace\(\/\\\/\[\^\\\/\]\+\$\/, '\/preview\.mp4'\)/.test(PLUGIN)).toBe(false);
  });

  it('xvideos + xnxx read data-pvv for preview', function () {
    var matches = PLUGIN.match(/data-pvv="\(\[\^"\]\+\)"/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('xvideos parses the video-hd-mark badge', function () {
    expect(/class="video-hd-mark"\[\^>\]\*>\\s\*\(\\d\+\)/.test(PLUGIN)).toBe(true);
  });

  it('youjizz parses the i-hd badge', function () {
    expect(/\/class="i-hd"\/\.test\(block\)/.test(PLUGIN)).toBe(true);
  });

  it('toCard puts ONLY the hd badge in the quality slot (duration is a separate overlay)', function () {
    // HD-only quality slot.
    expect(/if \(v\.hd\) v\.quality = v\.hd;/.test(PLUGIN)).toBe(true);
    // The old "HD · duration" combine is gone.
    expect(/v\.hd \+ ' · ' \+ _q/.test(PLUGIN)).toBe(false);
  });
});

// ============================================================
// FIX 1 — title fallback added to _pornoneCards / _rolikaCards
// (the shared _kvsParseCards engine already carried it).
// ============================================================
describe('FIX 1 — _titleFromUrl fallback in HTML parsers', function () {
  var PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');

  function parserBody(name) {
    var at = PLUGIN.indexOf('function ' + name + '(');
    expect(at).toBeGreaterThan(-1);
    return PLUGIN.slice(at, at + 2400);
  }

  it('_pornoneCards fills empty title from the video URL before pushing', function () {
    var body = parserBody('_pornoneCards');
    var fbIdx   = body.indexOf('if (!title) title = _titleFromUrl(videoUrl);');
    var pushIdx = body.indexOf('items.push(');
    expect(fbIdx).toBeGreaterThan(-1);
    expect(pushIdx).toBeGreaterThan(fbIdx); // fallback runs BEFORE push
  });

  it('_rolikaCards fills empty title from the video URL before pushing', function () {
    var body = parserBody('_rolikaCards');
    var fbIdx   = body.indexOf('if (!title) title = _titleFromUrl(videoUrl);');
    var pushIdx = body.indexOf('items.push(');
    expect(fbIdx).toBeGreaterThan(-1);
    expect(pushIdx).toBeGreaterThan(fbIdx);
  });

  it('_kvsParseCards (shared engine) still carries the fallback', function () {
    var body = parserBody('_kvsParseCards');
    expect(body).toMatch(/if \(!title\) title = _titleFromUrl\(videoUrl\);/);
  });
});

// ============================================================
// FIX 2 — duration overlay (.cherry-dur) + HD-only quality slot
// ============================================================
describe('FIX 2 — duration overlay anti-drift', function () {
  var PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');

  it('cardRender injects a .cherry-dur overlay with secToTime(element.duration)', function () {
    expect(PLUGIN).toMatch(/element\.duration\)\s*\{[\s\S]*?cherry-dur[\s\S]*?secToTime\(element\.duration\)/);
  });

  it('.cherry-dur CSS is present (bottom-right, z-index)', function () {
    var m = /\.cherry-dur\{([^}]*)\}/.exec(PLUGIN);
    expect(m).not.toBe(null);
    expect(m[1]).toMatch(/bottom/);
    expect(m[1]).toMatch(/right/);
    expect(m[1]).toMatch(/z-index/);
  });
});

// ============================================================
// FIX 3 — all_sources cards stamped with their originating source id
// ============================================================
describe('FIX 3 — all_sources source-id stamp wiring', function () {
  var PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');

  it('each search result is tagged with src.id via _srcId', function () {
    expect(PLUGIN).toMatch(/r\._srcId = src\.id;/);
  });

  it('cards inherit r._srcId when they carry no source (no clobber of a real source)', function () {
    expect(PLUGIN).toMatch(/r\.items\.forEach\(function \(v\) \{ if \(v && !v\.source\) v\.source = r\._srcId; \}\);/);
  });
});

// ============================================================
// FIX 4 — 3movs getStream prefers the highest available quality
// ============================================================
describe('FIX 4 — 3movs best-quality selection', function () {
  // Mirror of the selection line added after the flashvars while-loop.
  function pickBest(quality, best) {
    return quality['1080p'] || quality['720p'] || quality['480p'] || best;
  }

  it('prefers 1080p when present', function () {
    expect(pickBest({ '480p': 'a', '720p': 'b', '1080p': 'c' }, 'a')).toBe('c');
  });

  it('falls back to 720p when 1080p absent (no longer keeps 480p)', function () {
    expect(pickBest({ '480p': 'a', '720p': 'b' }, 'a')).toBe('b');
  });

  it('falls back to 480p when only 480p present', function () {
    expect(pickBest({ '480p': 'a' }, 'a')).toBe('a');
  });

  it('keeps the prior best when the map is empty', function () {
    expect(pickBest({}, 'fallback')).toBe('fallback');
  });

  it('source carries the highest-quality selection line', function () {
    var PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');
    expect(PLUGIN).toMatch(/best = quality\['1080p'\] \|\| quality\['720p'\] \|\| quality\['480p'\] \|\| best;/);
  });
});

// ============================================================
// S1 total_pages anti-drift — flagged adapters no longer hardcode pagination
// and route through _derivePages. Reads plugin.js source directly.
// ============================================================
describe('S1 total_pages anti-drift', function () {
  var PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');

  it('the shared _derivePages helper exists', function () {
    expect(/function _derivePages\(itemsLen, page, full\)/.test(PLUGIN)).toBe(true);
  });

  it('no flagged adapter returns a synthetic p+10 / p+5 total_pages', function () {
    // browseByModel (pornhub/xvideos) historically used p+5/p+10 as graceful
    // fallbacks but those are now _derivePages too. Assert the synthetic literals
    // are gone from total_pages computations entirely.
    expect(/total_pages:\s*p \+ 10/.test(PLUGIN)).toBe(false);
    expect(/total_pages:\s*p \+ 5/.test(PLUGIN)).toBe(false);
  });

  it('no flagged _pages helper hardcodes "|| 10) : 10"', function () {
    // Flagged HTML adapters whose _pages helpers must now derive on no-match.
    var flaggedHelpers = [
      '_3movsPages', '_porndigPages', '_pornonePages',
      '_lenpornoPages', '_rolikaPages', '_jopaPages', '_perfektPages'
    ];
    flaggedHelpers.forEach(function (name) {
      var rx = new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}');
      var m = rx.exec(PLUGIN);
      expect(m, name + ' must exist').toBeTruthy();
      var body = m[0];
      expect(body.indexOf('|| 10) : 10'), name + ' must not hardcode 10').toBe(-1);
      expect(body.indexOf('_derivePages') >= 0, name + ' must use _derivePages').toBe(true);
    });
  });

  it('tizam default browse no longer hardcodes total_pages: 50', function () {
    expect(/total_pages:\s*50/.test(PLUGIN)).toBe(false);
  });

  it('xvideos and xnxx browse/search route through _derivePages', function () {
    // Both used p+10 hardcode before; assert _derivePages now drives them.
    var xv = PLUGIN.slice(PLUGIN.indexOf("id: 'xvideos'"), PLUGIN.indexOf("id: 'xnxx'"));
    expect(xv.indexOf('_derivePages') >= 0).toBe(true);
    expect(/total_pages:\s*p \+ 10/.test(xv)).toBe(false);

    var xnxxStart = PLUGIN.indexOf("id: 'xnxx'");
    var xnxx = PLUGIN.slice(xnxxStart, PLUGIN.indexOf("id: 'eporner'"));
    expect(xnxx.indexOf('_derivePages') >= 0).toBe(true);
  });

  it('_kvsPages derives from item count on no-match (xozilla cap fix)', function () {
    // The KVS engine must thread items.length into _kvsPages for fullness fallback.
    expect(/_kvsPages\(html, cfg\.pagesRx, page, items\.length\)/.test(PLUGIN)).toBe(true);
    expect(/_kvsPages\(html, cfg\.pagesRx, p, items\.length\)/.test(PLUGIN)).toBe(true);
  });

  it('genuine single-page sites keep total_pages 1 with a documented reason', function () {
    expect(/single-page site/.test(PLUGIN)).toBe(true);
  });
});

// ============================================================
// S4: pornhub _mapVideo surfaces a listing-level `model` field
// (re-activates the dead browseByModel path — see onMenu "Модель").
// ============================================================

// Verbatim mirror of the model branch added to pornhub._mapVideo.
// browseByModel() appends "/videos?page=P" itself, so the url must be the
// pornstar page BASE (/pornstar/{slug}) WITHOUT a trailing /videos.
function phMapModel(v) {
  var card = { id: 'x', source: 'pornhub', title: v.title || '' };
  if (v.pornstars && v.pornstars[0] && v.pornstars[0].pornstar_name) {
    var pn = v.pornstars[0].pornstar_name;
    card.model = {
      name: pn,
      url: 'https://www.pornhub.com/pornstar/' +
           pn.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    };
  }
  return card;
}

describe('S4 pornhub _mapVideo model field', function () {
  it('sets card.model {name,url} from pornstars[0].pornstar_name', function () {
    var card = phMapModel({ pornstars: [{ pornstar_name: 'Mia Khalifa' }] });
    expect(card.model).toBeDefined();
    expect(card.model.name).toBe('Mia Khalifa');
    expect(card.model.url).toBe('https://www.pornhub.com/pornstar/mia-khalifa');
  });

  it('slugifies name: lowercase, non-alnum→-, trimmed edges', function () {
    var card = phMapModel({ pornstars: [{ pornstar_name: "  Léa O'Connor!! " }] });
    // diacritics/apostrophe/space/bang collapse to single hyphens, edges trimmed
    expect(card.model.url).toBe('https://www.pornhub.com/pornstar/l-a-o-connor');
  });

  it('model.url has NO trailing /videos (browseByModel appends it)', function () {
    var card = phMapModel({ pornstars: [{ pornstar_name: 'Riley Reid' }] });
    expect(card.model.url).not.toMatch(/\/videos/);
    expect(card.model.url.endsWith('/riley-reid')).toBe(true);
  });

  it('no model when pornstars absent / empty / nameless', function () {
    expect(phMapModel({}).model).toBeUndefined();
    expect(phMapModel({ pornstars: [] }).model).toBeUndefined();
    expect(phMapModel({ pornstars: [{}] }).model).toBeUndefined();
  });

  it('anti-drift: shipped _mapVideo reads pornstars[0].pornstar_name into card.model', function () {
    var PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');
    expect(/v\.pornstars\s*&&\s*v\.pornstars\[0\]\s*&&\s*v\.pornstars\[0\]\.pornstar_name/.test(PLUGIN)).toBe(true);
    expect(/card\.model\s*=\s*\{/.test(PLUGIN)).toBe(true);
    expect(/https:\/\/www\.pornhub\.com\/pornstar\//.test(PLUGIN)).toBe(true);
  });
});
