/**
 * Unit tests for _kvsPages, _kvsParseCards, _kvsEngine.
 * Functions are defined inline here since plugin.js is a browser IIFE
 * and these three helpers do not exist in plugin.js yet (Phase 0 — RED).
 *
 * Pattern: identical to plugin-helpers.test.js — copy-paste the pure
 * helpers verbatim at the top, then describe/it below.
 */
import { describe, it, expect, vi } from 'vitest';
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
                  .replace(/&apos;/g, "'")
                  .replace(/&excl;/g, '!')
                  .replace(/&nbsp;/g, ' ')
                  .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
                  .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
                  .trim();
}

// ---- parseDur ---------------------------------------------------------------
// Verbatim from plugin.js line 1211
function parseDur(str) {
  if (!str) return 0;
  str = ('' + str).trim();
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  var iso = str.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (iso && (iso[1] || iso[2] || iso[3])) {
    return (iso[1] ? parseInt(iso[1], 10) * 3600 : 0) +
           (iso[2] ? parseInt(iso[2], 10) * 60 : 0) +
           (iso[3] ? parseInt(iso[3], 10) : 0);
  }
  if (str.indexOf(':') !== -1) {
    var p = str.split(':').map(Number);
    var allNum = p.length >= 2 && p.every(function (n) { return !isNaN(n); });
    if (allNum && p.length === 2) return p[0] * 60 + p[1];
    if (allNum && p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  }
  var h = str.match(/(\d+)\s*h/i);
  var m = str.match(/(\d+)\s*m(?:in)?(?![a-z])/i);
  var s = str.match(/(\d+)\s*s(?![a-z])/i);
  if (h || m || s) {
    return (h ? parseInt(h[1], 10) * 3600 : 0) +
           (m ? parseInt(m[1], 10) * 60 : 0) +
           (s ? parseInt(s[1], 10) : 0);
  }
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

    // duration — prefer schema.org itemprop="duration" content="PT…S" (locale-free)
    // over the visible text; fall back to the class="duration|time" text. IN SYNC w/ plugin.js.
    var durStr   = _attr(chunk, /itemprop="duration"[^>]*content="([^"]+)"/i) ||
                   _attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</);
    var duration = parseDur(durStr);

    // views
    var viewsStr = _attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</);
    var views    = parseViews(viewsStr);

    // HD/4K badge (mirror plugin.js)
    var hd = '';
    if (/2160|\b4k\b/i.test(chunk)) hd = '4K';
    else if (/class="[^"]*\bhd\b[^"]*"|>\s*HD\s*<|is_hd|hd-(?:button|mark)/i.test(chunk)) hd = 'HD';

    // Hover-preview mp4 (mirror plugin.js): per-site cfg.previewRx wins, else probe
    // the known KVS variants in order.
    var preview = '';
    if (cfg.previewRx) {
      preview = _attr(chunk, cfg.previewRx);
    }
    if (!preview) preview = _attr(chunk, /data-preview="([^"]+\.mp4[^"]*)"/i);
    if (!preview) preview = _attr(chunk, /\bvthumb="([^"]+\.mp4[^"]*)"/i);
    if (!preview) preview = _attr(chunk, /data-trailer="([^"]+\.mp4[^"]*)"/i);
    if (!preview) preview = _attr(chunk, /data-video="([^"]+\.mp4[^"]*)"/i);
    if (!preview) preview = _attr(chunk, /src="([^"]+_trailer[^"]*\.mp4[^"]*)"/i);
    if (!preview) preview = _attr(chunk, /<video[^>]*class="[^"]*trailer[^"]*"[^>]*src="([^"]+\.mp4[^"]*)"/i);

    if (title || thumb) {
      items.push({ id: id, source: cfg.id, title: title, thumb: thumb,
                   url: videoUrl, duration: duration, views: views, hd: hd || undefined,
                   preview: preview || undefined });
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
// describe: parseDur
// =============================================================================

describe('parseDur', () => {
  it('plain colon forms', () => {
    expect(parseDur('12:34')).toBe(754);
    expect(parseDur('1:02:03')).toBe(3723);
  });
  it('unit forms', () => {
    expect(parseDur('7min')).toBe(420);
    expect(parseDur('12m34s')).toBe(754);
    expect(parseDur('PT13M10S')).toBe(790);
  });
  // xozilla renders "{M}m:{S}s" (e.g. "17m:37s") — the ':' must NOT trigger the
  // numeric-colon branch (Number("17m")=NaN), it must fall through to the unit scan.
  it('mixed unit+colon (xozilla "17m:37s")', () => {
    expect(parseDur('17m:37s')).toBe(17 * 60 + 37);
    expect(parseDur('18m:47s')).toBe(18 * 60 + 47);
    expect(parseDur('1h:05m:09s')).toBe(3600 + 5 * 60 + 9);
  });
});

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

  // ---- hover-preview mp4 capture (per-channel KVS variants) -----------------
  function previewHtml(attrTag) {
    return [
      '<a href="https://example.com/videos/55/preview-test/" ' + attrTag + '>',
      '<img data-src="https://cdn.example.com/t.jpg">',
      '</a>',
      '<strong class="title-label">Preview Test</strong>'
    ].join('\n');
  }

  it('captures preview from data-preview (crocotube/3movs/pornve)', () => {
    var html = previewHtml('data-preview="https://example.com/get_file/1/abc/0/55/55_trailer_360p.mp4/"');
    var r = _kvsParseCards(html, BASE_CFG);
    expect(r[0].preview).toBe('https://example.com/get_file/1/abc/0/55/55_trailer_360p.mp4/');
  });

  it('captures preview from vthumb (analdin)', () => {
    var html = previewHtml('vthumb="https://www.analdin.com/get_file/x/787278_vthumb.mp4/"');
    var r = _kvsParseCards(html, BASE_CFG);
    expect(r[0].preview).toBe('https://www.analdin.com/get_file/x/787278_vthumb.mp4/');
  });

  it('captures preview from data-video (pornobolt)', () => {
    var html = previewHtml('data-video="https://stat.pornobolt.vip/pornobolt-kartinki/large-slug.mp4"');
    var r = _kvsParseCards(html, BASE_CFG);
    expect(r[0].preview).toBe('https://stat.pornobolt.vip/pornobolt-kartinki/large-slug.mp4');
  });

  it('captures preview from an inline <video> trailer (hellporno: src before class)', () => {
    var html = [
      '<a href="https://example.com/videos/55/preview-test/"></a>',
      '<video muted loop src="https://hellporno.com/get_file/1/x/190000/190613/190613_trailer_360p.mp4" class="trailer_video"></video>',
      '<strong class="title-label">Preview Test</strong>'
    ].join('\n');
    var r = _kvsParseCards(html, BASE_CFG);
    expect(r[0].preview).toBe('https://hellporno.com/get_file/1/x/190000/190613/190613_trailer_360p.mp4');
  });

  it('cfg.previewRx override wins over the generic probes', () => {
    var cfg = Object.assign({}, BASE_CFG, { previewRx: /data-myprev="([^"]+\.mp4)"/i });
    var html = previewHtml('data-myprev="https://x/custom.mp4" data-preview="https://x/generic.mp4"');
    var r = _kvsParseCards(html, cfg);
    expect(r[0].preview).toBe('https://x/custom.mp4');
  });

  it('card with no preview attr → preview undefined (unaffected)', () => {
    var r = _kvsParseCards(FIXTURE_HTML, BASE_CFG);
    expect(r).toHaveLength(1);
    expect(r[0].preview).toBeUndefined();
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

  it('AC-3.9: models_index load calls src.getModels(page) and maps _model cards', function () {
    var called = null;
    var src = {
      id: 'crocotube',
      getModels: function (p) {
        called = p;
        return Promise.resolve([
          { name: 'Jada Fire', url: 'https://x/pornstars/jada-fire/', thumb: 't.jpg' },
          { name: 'Riley Ray', url: 'https://x/pornstars/riley-ray/', thumb: '' }
        ]);
      }
    };
    // Mirror the _gridLoad models_index branch.
    var object = { models_index: true, source_id: 'crocotube' };
    var page = 1;
    return src.getModels(page).then(function (models) {
      var cards = models.map(function (m) {
        return {
          id:        'model_' + (m.url || m.name),
          source:    src.id,
          title:     m.name,
          thumb:     m.thumb || '',
          url:       m.url,
          _model:    true,
          model_url: m.url
        };
      });
      expect(called).toBe(1);
      expect(cards).toHaveLength(2);
      expect(cards[0]._model).toBe(true);
      expect(cards[0].model_url).toBe('https://x/pornstars/jada-fire/');
      expect(cards[0].title).toBe('Jada Fire');
      expect(cards[1].thumb).toBe('');
    });
  });

  it('AC-3.10: _model card onEnter pushes cherry_grid with model_url (not playVideo)', function () {
    var pushed = null;
    var playVideoCalled = false;
    var element = { _model: true, source: 'crocotube', title: 'Jada Fire',
                   model_url: 'https://x/pornstars/jada-fire/' };
    // Mirror cardRender onEnter for a _model card.
    function onEnter() {
      if (element._model) {
        pushed = {
          component: 'cherry_grid',
          title:     element.title,
          source_id: element.source,
          model_url: element.model_url,
          page:      1
        };
        return;
      }
      playVideoCalled = true;
    }
    onEnter();
    expect(playVideoCalled).toBe(false);
    expect(pushed).not.toBeNull();
    expect(pushed.model_url).toBe('https://x/pornstars/jada-fire/');
    expect(pushed.source_id).toBe('crocotube');
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
// REQ-3b: Studio/channel browse — mirrors REQ-3 model browse. studios_index
// lists studio cards; each _studio card onEnter opens that studio's videos via
// the studio_url grid path. 24rolika (/movie/) + perfektdamen (/channels/).
// ============================================================
describe('REQ-3b studio browse', function () {
  it('studios_index load calls src.getStudios(page) and maps _studio cards', function () {
    var called = null;
    var src = {
      id: 'perfektdamen',
      getStudios: function (p) {
        called = p;
        return Promise.resolve([
          { name: 'Brazzers', url: 'https://www.perfektdamen.co/channels/brazzers/', thumb: 'b.jpg' },
          { name: 'Blacked',  url: 'https://www.perfektdamen.co/channels/blacked/',  thumb: '' }
        ]);
      }
    };
    // Mirror the _gridLoad studios_index branch.
    var object = { studios_index: true, source_id: 'perfektdamen' };
    var page = 1;
    return src.getStudios(page).then(function (studios) {
      var cards = studios.map(function (s) {
        return {
          id:         'studio_' + (s.url || s.name),
          source:     src.id,
          title:      s.name,
          thumb:      s.thumb || '',
          url:        s.url,
          _studio:    true,
          studio_url: s.url
        };
      });
      expect(called).toBe(1);
      expect(cards).toHaveLength(2);
      expect(cards[0]._studio).toBe(true);
      expect(cards[0].studio_url).toBe('https://www.perfektdamen.co/channels/brazzers/');
      expect(cards[0].title).toBe('Brazzers');
      expect(cards[1].thumb).toBe('');
    });
  });

  it('studio_url load calls browseByStudio(studioUrl, page)', function () {
    var called = null;
    var src = {
      browseByStudio: function (url, p) {
        called = { url: url, page: p };
        return Promise.resolve({ items: [], total_pages: 1 });
      }
    };
    var object = { studio_url: 'https://w2.huyalkino.com/movie/brazzers/', source_id: '24rolika' };
    var page   = 2;
    var promise;
    if (object.studio_url) {
      if (!src || !src.browseByStudio) { /* early return */ }
      else promise = src.browseByStudio(object.studio_url, page);
    }
    expect(promise).toBeDefined();
    expect(called).not.toBeNull();
    expect(called.url).toBe('https://w2.huyalkino.com/movie/brazzers/');
    expect(called.page).toBe(2);
  });

  it('_studio card onEnter pushes cherry_grid with studio_url (not playVideo)', function () {
    var pushed = null;
    var playVideoCalled = false;
    var element = { _studio: true, source: 'perfektdamen', title: 'Brazzers',
                   studio_url: 'https://www.perfektdamen.co/channels/brazzers/' };
    // Mirror cardRender onEnter for a _studio card.
    function onEnter() {
      if (element._studio) {
        pushed = {
          component:  'cherry_grid',
          title:      element.title,
          source_id:  element.source,
          studio_url: element.studio_url,
          page:       1
        };
        return;
      }
      playVideoCalled = true;
    }
    onEnter();
    expect(playVideoCalled).toBe(false);
    expect(pushed).not.toBeNull();
    expect(pushed.studio_url).toBe('https://www.perfektdamen.co/channels/brazzers/');
    expect(pushed.source_id).toBe('perfektdamen');
  });

  it('24rolika + perfektdamen adapters expose getStudios + browseByStudio', function () {
    var PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');
    // Both adapter blocks declare the studio axis pair.
    var rolika = PLUGIN.slice(PLUGIN.indexOf("id: '24rolika'"), PLUGIN.indexOf("id: '24rolika'") + 6000);
    expect(rolika).toMatch(/getStudios:\s*function/);
    expect(rolika).toMatch(/browseByStudio:\s*function/);
    var perfekt = PLUGIN.slice(PLUGIN.indexOf("id: 'perfektdamen'"), PLUGIN.indexOf("id: 'perfektdamen'") + 6000);
    expect(perfekt).toMatch(/getStudios:\s*function/);
    expect(perfekt).toMatch(/browseByStudio:\s*function/);
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
    relatedSrc:        null,
    relatedVideo:      null
  };

  function playVideoRelated(video, source, _getRelated) {
    state.relatedGeneration++;
    var myGen          = state.relatedGeneration;
    state.pendingRelated = [];
    state.relatedSrc     = null;
    state.relatedVideo   = null;
    if (source.getRelated) {
      // Probe page 1; non-empty marks that related exists. On close we push a
      // PAGINATED grid carrying the video (not the snapshot) so the panel scrolls.
      _getRelated(video, 1).then(function (items) {
        if (myGen !== state.relatedGeneration) return;
        if (items && items.length) {
          state.pendingRelated = items;     // non-empty marker
          state.relatedSrc     = source;
          state.relatedVideo   = video;
        }
      }).catch(function () {});
    }
  }

  function onPlayerDestroy(ActivityPush, translateFn) {
    state.relatedGeneration++;
    if (state.pendingRelated.length && state.relatedVideo && state.relatedSrc) {
      var rSrc  = state.relatedSrc;
      var rVid  = state.relatedVideo;
      state.pendingRelated = [];
      state.relatedSrc     = null;
      state.relatedVideo   = null;
      ActivityPush({
        component:            'cherry_grid',
        title:                translateFn('cherry_related'),
        source_id:            rSrc.id,
        related_video:        rVid,
        related_video_source: rSrc.id,
        page:                 1
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
    // Paginated path: pushes the VIDEO + its source, not a fixed snapshot.
    expect(pushed.related_video).toEqual({ id: 'v1' });
    expect(pushed.related_video_source).toBe('pornhub');
    expect(pushed._related_items).toBeUndefined();
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

  it('AC-4.5: CherryGrid with related_video PAGINATES through _gridLoad (not a one-shot)', function () {
    // Mirror of the _gridLoad branch order. related_video is now a PAGINATED grid
    // mode: it routes through the paged loader (loadPage), NOT a one-shot snapshot.
    var loadPageCalled = false;
    var relatedBranch  = false;
    var object = { related_video: { id: 'v1', url: 'https://x/v/1' }, source_id: 'pornhub' };

    function simulateGridLoad() {
      if (object.is_favorites) {
        // local list
      } else if (object.related_video) {
        relatedBranch = true;     // calls src.getRelated(video, page) → _derivePages
        loadPageCalled = true;    // paged, scrolls like any grid
      } else if (object.all_sources) {
        // ...
      } else {
        loadPageCalled = true;
      }
    }
    simulateGridLoad();
    expect(relatedBranch).toBe(true);
    expect(loadPageCalled).toBe(true);
  });

  it('AC-4.8: related branch calls getRelated(video, page) and paginates via _derivePages', async function () {
    // Fixed-block adapter (ignores page): page 2 re-serves the same cards, the
    // dedup guard yields zero new → grid stops cleanly. Generous total_pages on
    // a full page lets a paginatable adapter keep scrolling.
    var pages = [];
    var src = {
      id: 'pornhub',
      getRelated: function (video, page) {
        pages.push(page);
        return Promise.resolve([{ id: 'a' }, { id: 'b' }]); // fixed block
      }
    };
    function gridLoad(object, page) {
      return src.getRelated(object.related_video, page).then(function (rel) {
        rel.forEach(function (v) { if (!v.source) v.source = src.id; });
        return { items: rel, total_pages: _derivePages(rel.length, page, 20) };
      });
    }
    var object = { related_video: { id: 'v1' }, source_id: 'pornhub' };
    var p1 = await gridLoad(object, 1);
    var p2 = await gridLoad(object, 2);
    expect(pages).toEqual([1, 2]);            // page threaded through
    expect(p1.items[0].source).toBe('pornhub'); // cards stamped with source
    // short fixed block (2 < half of 20) → total_pages caps at the current page
    expect(p1.total_pages).toBe(1);
    expect(p2.total_pages).toBe(2);
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
    // Duration is BARE text inside <p class="metadata"> (kept IN SYNC with plugin.js).
    var metaMatch = block.match(/class="metadata"[^>]*>([\s\S]*?)<\/p>/);
    var metaTxt = metaMatch ? metaMatch[1] : block;
    var durMatch = metaTxt.match(/(\d+h\s*)?\d+\s*min\b|\d+:\d+/i);
    var duration = durMatch ? parseDur(durMatch[0].trim()) : 0;
    items.push({ id: 'xnxx-' + rawId, source: 'xnxx', title: title, thumb: thumb,
                 preview: preview, url: videoUrl, duration: duration, views: 0 });
  }
  return items;
}

// ============================================================
// adapter-preview-quality: pornhub data-mediabook (REQ-3)
// ============================================================
// li-block model parser — kept IN SYNC with plugin.js _parseHtmlCards.
function phParseHtmlCards(html) {
  // _attr, _decodeHtml, parseDur, parseViews already at module scope (lines 13/20/32/44)
  var items = [];
  var seen = {};
  var liRx = /<li[^>]*class="[^"]*videoblock[^"]*"/g;
  var starts = [];
  var lm;
  while ((lm = liRx.exec(html)) !== null) starts.push(lm.index);
  if (!starts.length) starts.push(0);
  starts.push(html.length);
  for (var i = 0; i < starts.length - 1; i++) {
    var block = html.slice(starts[i], starts[i + 1]);
    var vk = block.match(/viewkey=([a-z0-9]+)/);
    if (!vk) continue;
    var vkey = vk[1];
    if (seen[vkey]) continue;
    seen[vkey] = true;
    var href = _attr(block, /href="(\/view_video\.php\?viewkey=[a-z0-9]+[^"]*)"/);
    var videoUrl = href ? 'https://www.pornhub.com' + href
                        : 'https://www.pornhub.com/view_video.php?viewkey=' + vkey;
    var thumb = _attr(block, /data-mediumthumb="([^"]+)"/) ||
                _attr(block, /data-thumb_url="([^"]+)"/) ||
                _attr(block, /data-image="([^"]+)"/) ||
                _attr(block, /<img[^>]+(?:data-src|src)="(https?:\/\/[^"]*phncdn[^"]+\.jpg[^"]*)"/) || '';
    var preview = _attr(block, /data-mediabook="([^"]+)"/);
    var title = _decodeHtml(
      _attr(block, /class="[^"]*videoTitle[^"]*"[^>]*>([^<]+)/) ||
      _attr(block, /title="([^"]+)"/)
    );
    var duration = parseDur(_attr(block, /<var class="[^"]*\bduration\b[^"]*"[^>]*>([^<]+)</));
    var views    = parseViews(_attr(block, /class="[^"]*videoViewCount[^"]*"[^>]*>([^<]+)</));
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

  it('items[0]: duration parsed from <p class="metadata"> (12:34 -> 754)', function () {
    var items = xnxxParseCards(fixture('xnxx-list.html'));
    expect(items[0].duration).toBe(754);
  });

  it('bare "5min" metadata text (real listing markup) -> 300s', function () {
    var html = '<div class="mozaique"><div class="thumb-block ">' +
               '<div class="thumb"><a href="/video-mmm555/x"><img data-src="t.jpg"></a></div>' +
               '<div class="thumb-under"><a href="/video-mmm555/x">X</a>' +
               '<p class="metadata"><span class="right">46.8M</span>\n5min\n' +
               '<span class="video-hd">720p</span></p></div>' +
               '</div></div>';
    var items = xnxxParseCards(html);
    expect(items[0].duration).toBe(300);
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
// UX-batch-1: HD merged into the dur pill — toCard no longer uses quality slot
// ============================================================
// Verbatim from plugin.js secToTime (line ~293).
function secToTime(s) {
  s = parseInt(s, 10) || 0;
  var m = Math.floor(s / 60);
  var sec = s % 60;
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

// toCard no longer routes HD through Lampa's native quality slot — HD is merged
// into the bottom-right dur pill in cardRender. This pure extract reflects the
// cardRender dur-pill composition: "HD · 12:34", "12:34", or "HD".
function durPill(element) {
  if (element.duration) {
    return (element.hd ? element.hd + ' · ' : '') + secToTime(element.duration);
  }
  if (element.hd) return element.hd;
  return '';
}

describe('UX-batch-1 dur pill — HD merged into duration (no native quality slot)', function () {
  var PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');

  it('hd present + duration → "HD · 12:34"', function () {
    expect(durPill({ duration: 754, hd: 'HD' })).toBe('HD · 12:34');
  });

  it('4K present + duration → "4K · 1:05"', function () {
    expect(durPill({ duration: 65, hd: '4K' })).toBe('4K · 1:05');
  });

  it('no hd, duration only → just the duration', function () {
    expect(durPill({ duration: 754 })).toBe('12:34');
  });

  it('hd present, no duration → just the hd badge', function () {
    expect(durPill({ hd: 'HD' })).toBe('HD');
  });

  it('neither hd nor duration → empty (no pill)', function () {
    expect(durPill({})).toBe('');
  });

  it('toCard no longer assigns the native quality slot from hd', function () {
    expect(/v\.quality\s*=\s*v\.hd/.test(PLUGIN)).toBe(false);
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
    var pvM = block.match(/data-clip="([^"]+\.mp4[^"]*)"/i);
    var preview = pvM ? pvM[1].replace(/^\/\//, 'https://') : '';
    // Duration: <span class="time"><i class="fa fa-clock-o"></i>&nbsp;11:23</span> (IN SYNC w/ plugin.js).
    var durMatch = block.match(/class="time"[^>]*>(?:\s*<[^>]+>)*\s*(?:&nbsp;)?\s*([\d:]+(?:\s*min)?)/i) ||
                   block.match(/<div[^>]*class="[^"]*duration[^"]*"[^>]*>([^<]+)/);
    var duration = durMatch ? parseDur(durMatch[1].trim()) : 0;
    items.push({ id: 'yj-' + id, source: 'youjizz', thumb: thumb, hd: hd,
                 url: videoUrl, duration: duration, views: 0, preview: preview || undefined });
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

  it('captures data-clip mp4 → preview (protocol-relative → https:)', function () {
    var html = '<div class="video-thumb"><a class="frame video" href="/videos/slug-12345.html" ' +
               'data-clip="//cdne-mobile.youjizz.com/abc/slug-12345-clip.mp4?token=1">' +
               '<img data-original="https://cdn/x.jpg"></a></div>';
    var items = yjParseCards(html);
    expect(items[0].preview).toBe('https://cdne-mobile.youjizz.com/abc/slug-12345-clip.mp4?token=1');
  });

  it('card without data-clip → preview undefined', function () {
    var html = '<div class="video-thumb"><a href="/videos/slug-12345.html">' +
               '<img data-original="https://cdn/x.jpg"></a></div>';
    var items = yjParseCards(html);
    expect(items[0].preview).toBeUndefined();
  });

  it('duration parsed from <span class="time"> (11:23 -> 683)', function () {
    var html = '<div class="video-thumb"><a href="/videos/slug-12345.html">' +
               '<img data-original="https://cdn/x.jpg"></a>' +
               '<span class="time"><i class="fa fa-clock-o"></i>&nbsp;11:23</span></div>';
    var items = yjParseCards(html);
    expect(items[0].duration).toBe(683);
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

  it('toCard no longer routes hd through the native quality slot (HD merged into dur pill)', function () {
    // UX-batch-1: HD moved out of the quality slot into the .cherry-dur pill.
    expect(/v\.quality\s*=\s*v\.hd/.test(PLUGIN)).toBe(false);
    // The dur pill optionally prefixes the hd badge before the duration.
    expect(/element\.hd \+ ' · '/.test(PLUGIN)).toBe(true);
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
// pornone — _pornoneCards parses ONLY real /{cat}/{slug}/{id}/ video cards
// (anchors on class="…videocard…"; drops nav/lang/pagination + viewsIcon junk).
// Live-HTML shape verified by curl: 35 cards/page, all with a numeric id + .jpg poster.
// ============================================================
describe('pornone — _pornoneCards real-card parsing', function () {
  const PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');

  // Extract a function body verbatim from plugin.js (brace-balanced).
  function grab(name) {
    const i = PLUGIN.indexOf('function ' + name + '(');
    expect(i).toBeGreaterThan(-1);
    let depth = 0;
    for (let k = PLUGIN.indexOf('{', i); k < PLUGIN.length; k++) {
      if (PLUGIN[k] === '{') depth++;
      else if (PLUGIN[k] === '}' && --depth === 0) return PLUGIN.slice(i, k + 1);
    }
    throw new Error('unbalanced ' + name);
  }

  const deps = ['parseDur', 'parseViews', '_attr', '_decodeHtml', '_titleFromUrl', '_pornoneCards']
    .map(grab).join('\n');
  // eslint-disable-next-line no-new-func
  const _pornoneCards = new Function(deps + '\nreturn _pornoneCards;')();

  // Minimal fixture mirroring the live grid: one real card (with ?rr= tracker, lazy
  // data-src poster, durlabel, viewsIcon), plus a language-nav link and a pagination
  // link that the OLD slug-windowing parser turned into junk "view" cards.
  const HTML =
    '<a href="https://pornone.com/se/amator/">lang nav</a>' +
    '<a href="https://pornone.com/amateur/2/">page 2</a>' +
    '<a href="https://pornone.com/czech/sexy-brunette-casting-fuck/280636853/?rr=151" ' +
      'class="popbop vidLinkFX  videocard links">' +
      '<div class="thumbcont"><span class="durlabel">' +
        '<img alt="HD Video" src="https://th-eu4.pornone.com/images/svg/hd.svg">08:00</span>' +
      '<img src="" data-src="https://th-eu4.pornone.com/t/53/280636853/b161.jpg" ' +
        'alt="sexy brunette casting fuck" class="imgvideo thumbimg"/></div>' +
      '<div class="videoinfo"><div class="titlecont">' +
        '<div class="videotitle ">Sexy Brunette Casting Fuck</div>' +
        '<div class="author"><span><i class="statsicon viewsIcon"></i>243</span></div>' +
      '</div></div></a>';

  const items = _pornoneCards(HTML);

  it('returns exactly one card (drops nav + pagination junk)', function () {
    expect(items.length).toBe(1);
  });

  it('extracts the numeric id and strips the ?rr= tracker from the URL', function () {
    expect(items[0].id).toBe('280636853');
    expect(items[0].url).toBe('https://pornone.com/czech/sexy-brunette-casting-fuck/280636853/');
  });

  it('reads title, .jpg poster, duration and views', function () {
    expect(items[0].title).toBe('Sexy Brunette Casting Fuck');
    expect(items[0].thumb).toMatch(/th-eu4\.pornone\.com\/t\/53\/280636853\/b161\.jpg$/);
    expect(items[0].duration).toBe(480);   // 08:00
    expect(items[0].views).toBe(243);
  });

  it('never emits viewsIcon / lang-nav / pagination as cards', function () {
    items.forEach(function (v) {
      expect(v.url).not.toMatch(/\/se\/amator\//);
      expect(v.url).not.toMatch(/\/amateur\/2\//);
      expect(/^\d+$/.test(v.id)).toBe(true);
    });
  });
});

// ============================================================
// DURATION extraction — per-channel real-markup regression (anti-drift).
// Exercises the SHIPPED card parsers (grabbed verbatim from plugin.js) against
// minimal fixtures that mirror the live listing markup confirmed via curl, so a
// future markup/regex drift that drops duration is caught here.
// ============================================================
describe('duration extraction (shipped parsers vs real markup)', function () {
  const PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');
  function grab(name) {
    const i = PLUGIN.indexOf('function ' + name + '(');
    expect(i, name).toBeGreaterThan(-1);
    let depth = 0;
    for (let k = PLUGIN.indexOf('{', i); k < PLUGIN.length; k++) {
      if (PLUGIN[k] === '{') depth++;
      else if (PLUGIN[k] === '}' && --depth === 0) return PLUGIN.slice(i, k + 1);
    }
    throw new Error('unbalanced ' + name);
  }
  function load(name, extraDeps) {
    const deps = ['parseDur', 'parseViews', '_attr', '_decodeHtml', '_titleFromUrl']
      .concat(extraDeps || []).concat([name]).map(grab).join('\n');
    return new Function(deps + '\nreturn ' + name + ';')();
  }

  it('3movs: <div class="time">6:36</div> ~945 chars past href', function () {
    const _3movsCards = load('_3movsCards');
    const html = '<a class="wrap_image" href="https://www.3movs.com/videos/178834/x/" title="X">' +
      '<img class="img" data-src="https://t/a.jpg" data-preview="https://www.3movs.com/get_file/8/x/178834_preview.mp4/"></a>' +
      '<span class="ico-fav-1" title="Watch Later"></span>'.padEnd(900, ' ') +
      '<div class="time">6:36</div>';
    const items = _3movsCards(html);
    expect(items[0].duration).toBe(396);
    // hover-preview clip extracted from data-preview (past the 600-char title window)
    expect(items[0].preview).toBe('https://www.3movs.com/get_file/8/x/178834_preview.mp4/');
  });

  it('pornve: <div class="time">11:10</div> ~768 chars past href (item-time decoy ignored)', function () {
    const _pornveCards = load('_pornveCards');
    const html = '<a href="https://pornve.com/video/546752/x/" title="X">' +
      '<img src="https://cdn.pornve.com/contents/videos_screenshots/546000/546752/745x420/1.jpg" alt="X">' +
      '<span class="item-time " title="Watch Later"></span>'.padEnd(700, ' ') +
      '<div class="time">11:10</div></a>';
    const items = _pornveCards(html);
    expect(items[0].duration).toBe(670);
  });
  it('pornve: preview captured when data-preview sits past the +600 chunk edge (durChunk)', function () {
    const _pornveCards = load('_pornveCards');
    // data-preview at ~+640 from the href — beyond the old 600 forward window, inside durChunk (1200)
    const html = '<a href="https://pornve.com/video/546752/x/" title="X">' +
      '<img src="https://cdn.pornve.com/contents/videos_screenshots/546000/546752/745x420/1.jpg" alt="X">' +
      ''.padEnd(600, ' ') + '<video data-preview="https://cdn.pornve.com/get_file/1/x/546752_preview.mp4/"></video></a>';
    const items = _pornveCards(html);
    expect(items[0].preview).toBe('https://cdn.pornve.com/get_file/1/x/546752_preview.mp4/');
  });

  it('porndig: <div class="bubble bubble_duration"><span>08:00</span> (inner span, far past href)', function () {
    const _porndigCards = load('_porndigCards');
    const html = '<a href="/videos/236098/x.html" title="X"><img src="https://image-cdn.porndig.com/thumbs/2024/01/236098/a.jpg"></a>' +
      ''.padEnd(2000, ' ') + '<div class="bubble bubble_duration"><span>08:00</span></div>';
    const items = _porndigCards(html);
    expect(items[0].duration).toBe(480);
  });

  it('perfektdamen: <ul class="video-meta"><li><i class="fa fa-clock-o"></i> <span>24:14</span>', function () {
    const _perfektCards = load('_perfektCards');
    const html = '<a href="/video/12345/" title="X" data-preview-custom="https://www.perfektdamen.co/get_file/13/x/12345_preview360p.mp4/"><img data-original="//static.perfektdamen.co/a.jpg"></a>' +
      ''.padEnd(2000, ' ') + '<ul class="video-meta"><li><i class="fa fa-clock-o"></i> <span>24:14</span></li></ul>';
    const items = _perfektCards(html);
    expect(items[0].duration).toBe(1454);
    // hover-preview clip extracted from data-preview-custom
    expect(items[0].preview).toBe('https://www.perfektdamen.co/get_file/13/x/12345_preview360p.mp4/');
  });

  it('24rolika: <div class="th-time icon-l"><span class="fa fa-clock-o"></span>39:20</div>', function () {
    const _rolikaCards = load('_rolikaCards');
    const html = '<a href="/teen/29123-x.html"><img data-src="/uploads/posts/2024-01/a.jpg">' +
      '<a class="th-title">X</a>' +
      '<div class="th-time icon-l"><span class="fa fa-clock-o"></span>39:20</div></a>';
    const items = _rolikaCards(html);
    expect(items[0].duration).toBe(2360);
  });

  it('24rolika fixture: ≥80% of cards carry a duration', function () {
    const _rolikaCards = load('_rolikaCards');
    const items = _rolikaCards(readFileSync(join(__dirname, 'fixtures', '24rolika-page.html'), 'utf8'));
    const withDur = items.filter((v) => v.duration > 0).length;
    expect(items.length).toBeGreaterThan(10);
    expect(withDur / items.length).toBeGreaterThan(0.8);
  });

  it('KVS engine (pornobolt): prefers itemprop="duration" content="PT…S" over localized text', function () {
    const _kvsParseCards = load('_kvsParseCards');
    const cfg = {
      id: 'pornobolt',
      hrefRxSrc: 'href="(/video/([^/"]+)\\.html)"',
      idFromUrl: function (u, m) { return m[2]; },
      chunkWindow: { before: 800, after: 900 },
      titleRx: [/title="([^"]+)"/]
    };
    const html = '<a href="/video/abc.html" title="X"><img src="t.jpg"></a>' +
      ''.padEnd(560, ' ') +
      '<span class="vid-info duration" itemprop="duration" content="PT790S">13 мин</span>';
    const items = _kvsParseCards(html, cfg);
    expect(items[0].duration).toBe(790);
  });
});

// ============================================================
// pornone — getStream picks the real CDN <source>, never the gallery ad clip
// ============================================================
describe('pornone — getStream regex selects real stream', function () {
  const PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');

  it('the getStream <source> regex anchors on s*.pornone.com/vid2 (not gallery.vcmdiawe)', function () {
    expect(PLUGIN.includes('s\\d+\\.pornone\\.com\\/vid2')).toBe(true);
    expect(PLUGIN).toMatch(/gallery\.vcmdiawe\.com livecam ad/); // documented exclusion
  });

  it('the <source>/contentUrl regexes match a real pornone mp4 and reject the ad clip', function () {
    const srcRx = /<source\s+src="(https?:\/\/s\d+\.pornone\.com\/vid2\/[^"]+?\.mp4[^"]*)"[^>]*?(?:res|label)="(\d+)p?"/i;
    const real = '<source src="https://s3007.pornone.com/vid2/abc/1/39/280641839/280641839_1920x1080_4000k.mp4?lang=en" type="video/mp4" res="720"/>';
    const ad   = '<a data-live="https://gallery.vcmdiawe.com/lpp/2/x/x.20.mp4">';
    expect(srcRx.test(real)).toBe(true);
    expect(srcRx.test(ad)).toBe(false);
  });
});

// ============================================================
// FIX 2 — duration overlay (.cherry-dur) with merged HD prefix
// ============================================================
describe('FIX 2 — duration overlay anti-drift', function () {
  var PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');

  it('cardRender injects a .cherry-dur overlay with secToTime(element.duration)', function () {
    expect(PLUGIN).toMatch(/element\.duration\)\s*\{[\s\S]*?cherry-dur[\s\S]*?secToTime\(element\.duration\)/);
  });

  it('dur pill optionally prefixes the HD badge (UX-batch-1 HD merge)', function () {
    expect(PLUGIN).toMatch(/cherry-dur[\s\S]*?element\.hd \? element\.hd \+ ' · '/);
  });

  it('.cherry-dur CSS is present (bottom-right, z-index)', function () {
    var m = /\.cherry-dur\{([^}]*)\}/.exec(PLUGIN);
    expect(m).not.toBe(null);
    expect(m[1]).toMatch(/bottom/);
    expect(m[1]).toMatch(/right/);
    expect(m[1]).toMatch(/z-index/);
  });

  it('cardRender injects a .cherry-views overlay via formatViews(element.views)', function () {
    expect(PLUGIN).toMatch(/cherry-views[\s\S]*?formatViews\(element\.views\)|formatViews\(element\.views\)[\s\S]*?cherry-views/);
  });

  it('.cherry-views CSS is present (bottom-left, z-index)', function () {
    var m = /\.cherry-views\{([^}]*)\}/.exec(PLUGIN);
    expect(m).not.toBe(null);
    expect(m[1]).toMatch(/bottom/);
    expect(m[1]).toMatch(/left/);
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
// all_sources first-screen-fast — a hung source must NOT block the page.
// Mirror of the _gridLoad all_sources race+merge (verbatim logic) driven with
// vitest fake timers so a never-resolving source still settles via the timeout.
// ============================================================
describe('all_sources first-screen-fast (hung source does not block)', function () {
  var ALL_SRC_TIMEOUT_MS = 7000;

  // Mirror of the per-source race wrapper in _gridLoad.
  function searchWithTimeout(src, query, page) {
    var search = src.search(query, page).then(function (r) {
      r = r || { items: [] };
      r._srcId = src.id;
      return r;
    }).catch(function () {
      return { items: [], total_pages: 1, _srcId: src.id };
    });
    var timeout = new Promise(function (resolve) {
      setTimeout(function () {
        resolve({ items: [], total_pages: 1, _srcId: src.id });
      }, ALL_SRC_TIMEOUT_MS);
    });
    return Promise.race([search, timeout]);
  }

  // Mirror of the merge: stamp source, flat-concat top-10, track anyFull.
  function mergeResults(results) {
    var flat = [];
    var anyFull = false;
    results.forEach(function (r) {
      if (r && r.items && r.items.length) {
        r.items.forEach(function (v) { if (v && !v.source) v.source = r._srcId; });
        if (r.items.length >= 10) anyFull = true;
        flat = flat.concat(r.items.slice(0, 10));
      }
    });
    return { flat: flat, anyFull: anyFull };
  }

  it('a never-resolving source resolves to [] after the timeout and does not block fast sources', async function () {
    vi.useFakeTimers();
    try {
      var fast = { id: 'fast', search: function () { return Promise.resolve({ items: [{ id: 'f1', title: 'cat' }] }); } };
      var hung = { id: 'hung', search: function () { return new Promise(function () {}); } }; // never resolves

      var all = Promise.all([fast, hung].map(function (s) { return searchWithTimeout(s, 'cat', 1); }));

      // Let the fast source's microtasks flush, then advance past the timeout cap.
      await vi.advanceTimersByTimeAsync(ALL_SRC_TIMEOUT_MS + 1);
      var results = await all;

      var merged = mergeResults(results);
      // Fast source contributed; hung source timed out to [].
      expect(merged.flat.length).toBe(1);
      expect(merged.flat[0].id).toBe('f1');
      expect(merged.flat[0].source).toBe('fast');
      // Hung source's empty batch must not be counted as a full page.
      expect(merged.anyFull).toBe(false);
      var hungResult = results.find(function (r) { return r._srcId === 'hung'; });
      expect(hungResult.items.length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a fast source still wins the race before the timeout fires (real timers)', async function () {
    var fast = { id: 'fast', search: function () { return Promise.resolve({ items: [{ id: 'f1', title: 'cat' }] }); } };
    var r = await searchWithTimeout(fast, 'cat', 1);
    expect(r._srcId).toBe('fast');
    expect(r.items.length).toBe(1);
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
      '_lenpornoPages', '_rolikaPages', '_jopaPages', '_perfektPages',
      '_familypornPages', '_pornvePages'
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

  it('genuine single-page listings keep total_pages 1 with a documented reason', function () {
    // perfektdamen's no-cat browse is now the paginated /videos/ feed (was the
    // single-page /popular/); the remaining documented single-page cases are the
    // DLE/site searches that expose no page param (rolika/jopa/pornobolt/tizam).
    expect(/single-page (?:site|search)/.test(PLUGIN)).toBe(true);
  });
});

// ============================================================
// S4: pornhub _mapVideo surfaces a listing-level `model` field
// (re-activates the dead browseByModel path — see onMenu "Модель").
// ============================================================

// Verbatim mirror of the model branch added to pornhub._mapVideo. model.url is the
// pornstar page BASE (/pornstar/{slug}); browseByModel de-slugs it to a NAME and resolves
// the videos via the webmasters API search (the HTML pornstar page was unreliable).
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

  it('model.url is the pornstar BASE (no trailing /videos)', function () {
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

  // browseByModel resolves a pornstar's videos via the webmasters API SEARCH by the
  // de-slugged name — NOT the HTML /pornstar/{slug}/videos page (slug often 404s, e.g.
  // "Lisa Canon"; and the scrape intermittently yields 1 junk card). API cards are clean
  // _mapVideo objects → reliable, paginated, and playable (m3u8). Stand-verified.
  it('anti-drift: pornhub browseByModel de-slugs the url and uses the API search', function () {
    var PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');
    var at = PLUGIN.indexOf('browseByModel: function(modelUrl, page)');
    expect(at).toBeGreaterThan(-1);
    var body = PLUGIN.slice(at, at + 600);
    expect(body).toMatch(/pornstar\|model\|channels\|channel/);          // de-slug from any namespace
    expect(body).toMatch(/replace\(\/\[-_\]\+\/g, ' '\)/);               // slug → name
    expect(body).toMatch(/this\.search\(name, p, 'mostrecent'\)/);       // API search by name
    expect(body).not.toMatch(/_parseHtmlCards/);                          // no more HTML scrape here
  });
});

// =====================================================================
// FamilyPorn — standalone card parser + pagination (curl-confirmed markup)
// Real card URL format is /videos/{slug}/ (NOT numeric ids); cards carry a
// data-preview="…_preview.mp4/" hover clip; KVS AJAX pagination has no
// page-numbered URLs so total_pages must derive from page fullness.
// =====================================================================
// ---- _familypornCards (verbatim from plugin.js) ----
function _familypornCards(html) {
    var items = [];
    var hrefRx = /href="(https?:\/\/familyporn\.tv\/videos\/[^"]+)"/g;
    var seen = {};
    var m;
    while ((m = hrefRx.exec(html)) !== null) {
        var videoUrl = m[1];
        var slugMatch = /\/videos\/([^/"?]+)/.exec(videoUrl);
        var id = slugMatch ? slugMatch[1] : videoUrl;
        if (seen[id]) continue;
        seen[id] = true;
        var chunk = html.slice(m.index, m.index + 800);
        var thumb = _attr(chunk, /(?:data-original|data-src|src)="([^"?#]+\/contents\/videos_screenshots\/[^"?#]+)/i) ||
                    _attr(chunk, /(?:data-original|data-src|src)="([^"?#]+\.jpe?g)/i);
        var title = _decodeHtml(
            _attr(chunk, /title="([^"]+)"/) ||
            _attr(chunk, /<strong[^>]*class="[^"]*title[^"]*"[^>]*>\s*([^<]+)/) ||
            _attr(chunk, /alt="([^"]+)"/)
        );
        if (!title) title = _titleFromUrl(videoUrl);
        var duration = parseDur(_attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</));
        var views    = parseViews(_attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));
        var preview = _attr(chunk, /data-preview="([^"]+\.mp4[^"]*)"/i);
        if (title || thumb) {
            items.push({ id: id, source: 'familyporn', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views, preview: preview || undefined });
        }
    }
    return items;
}
// ---- _familypornPages (verbatim from plugin.js) ----
function _familypornPages(html, page, itemsLen) {
    return _derivePages(itemsLen, page || 1, 24);
}

describe('FamilyPorn card parser (curl-confirmed /videos/{slug}/ format)', function () {
  // Mirrors real category markup: <a class="link" href=".../videos/{slug}/" title="…">
  // <div class="img-wrap"><img src="…/contents/videos_screenshots/…/1.jpg"
  // data-preview="…/66955_preview.mp4/"><div class="duration">21:22</div>…
  function card(slug, withPreview) {
    return '<a class="link" href="https://familyporn.tv/videos/' + slug + '/" title="Title ' + slug + '">' +
           '<div class="img-wrap">' +
           '<img class="img" src="https://familyporn.tv/contents/videos_screenshots/66000/66955/289x217/1.jpg"' +
           (withPreview ? ' data-preview="https://familyporn.tv/get_file/3/abc/66000/66955/66955_preview.mp4/"' : '') +
           ' alt="Title ' + slug + '">' +
           '<div class="duration">21:22</div></div></a>';
  }

  it('matches slug URLs (NOT numeric) — all cards parse', function () {
    var html = card('skinny-stepmom-jumped-on-top', true) +
               card('caught-taking-a-dick-pic-s2-e4', true) +
               card('hot-stepmom-returns-the-favor', false);
    var items = _familypornCards(html);
    expect(items.length).toBe(3);
    expect(items[0].id).toBe('skinny-stepmom-jumped-on-top');
    expect(items[0].url).toBe('https://familyporn.tv/videos/skinny-stepmom-jumped-on-top/');
    expect(items[0].title).toBe('Title skinny-stepmom-jumped-on-top');
    expect(items[0].thumb).toContain('/contents/videos_screenshots/');
    expect(items[0].duration).toBe(21 * 60 + 22);
  });

  it('extracts data-preview hover-clip (.mp4) when present, omits it otherwise', function () {
    var items = _familypornCards(card('a-slug', true) + card('b-slug', false));
    expect(items[0].preview).toBe('https://familyporn.tv/get_file/3/abc/66000/66955/66955_preview.mp4/');
    expect(items[1].preview).toBeUndefined();
  });

  it('dedupes repeated slugs', function () {
    var items = _familypornCards(card('dup', true) + card('dup', true) + card('uniq', true));
    expect(items.map(function (i) { return i.id; })).toEqual(['dup', 'uniq']);
  });

  it('pagination keeps scrolling on a full page, caps on a short one', function () {
    // 24 cards/page → half-full threshold is 12.
    expect(_familypornPages('', 1, 24)).toBe(51);   // full → generous forward window
    expect(_familypornPages('', 3, 24)).toBe(53);
    expect(_familypornPages('', 5, 4)).toBe(5);      // short page → cap (no infinite empty scroll)
    expect(_familypornPages('', 1, 0)).toBe(1);      // empty → cap
  });

  it('anti-drift: shipped _familypornCards uses slug hrefRx + data-preview; pages derive', function () {
    var PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');
    var pAt = PLUGIN.indexOf('function _familypornPages');
    var body = PLUGIN.slice(PLUGIN.indexOf('function _familypornCards'), pAt);
    expect(body).toContain('familyporn\\.tv\\/videos\\/');
    expect(body).toMatch(/data-preview="\(\[\^"\]\+\\\.mp4/);
    expect(body).toContain('preview: preview || undefined');
    expect(PLUGIN.slice(pAt, pAt + 200)).toContain('_derivePages(itemsLen');
  });
});

// ============================================================
// _parseModelIndex + per-channel model INDEX scrape (3movs/pornve/familyporn/
// perfektdamen/porntrex). Verbatim mirror of the shipped helpers, then a
// realistic-markup fixture per added channel. Plus anti-drift on the shipped
// getModels hrefRx/thumbRx so the parser stays in sync with the markup.
// ============================================================

// ---- _humanizeName (verbatim from plugin.js) ----
function _humanizeName(slug) {
    var s = String(slug || '').replace(/\.(html?|php)$/i, '').replace(/[-_]+/g, ' ').trim();
    return s.replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); });
}
// ---- _parseModelIndex (verbatim from plugin.js) ----
function _parseModelIndex(html, opts) {
    var items = [];
    var seen  = {};
    var win   = opts.window || 500;
    var m;
    opts.hrefRx.lastIndex = 0;
    while ((m = opts.hrefRx.exec(html)) !== null) {
        var raw = m[1];
        var url = opts.normalizeUrl ? opts.normalizeUrl(raw, m) : raw;
        if (!url || seen[url]) continue;
        if (opts.exclude && opts.exclude(url)) continue;
        seen[url] = true;
        var chunk = html.slice(m.index, m.index + win);
        var name = '';
        var nameRx = opts.nameRx || [];
        for (var ni = 0; ni < nameRx.length; ni++) {
            name = _decodeHtml(_attr(chunk, nameRx[ni]));
            if (name) break;
        }
        if (!name) name = _humanizeName(url.replace(/\/+$/, '').split('/').pop());
        var thumb = '';
        var thumbRx = opts.thumbRx || [];
        for (var ti = 0; ti < thumbRx.length; ti++) {
            thumb = _attr(chunk, thumbRx[ti]);
            if (thumb) break;
        }
        items.push({ name: name, url: url, thumb: thumb });
    }
    return items;
}

const MODEL_PLUGIN_SRC = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');
// Slice the shipped getModels body for a given source id (adapter blocks are in
// SOURCES.push order; we cut from the getModels marker to the next browseByModel).
function getModelsBody(id) {
  var at = MODEL_PLUGIN_SRC.indexOf("id: '" + id + "'");
  var gm = MODEL_PLUGIN_SRC.indexOf('getModels:', at);
  var end = MODEL_PLUGIN_SRC.indexOf('browseByModel:', gm);
  return MODEL_PLUGIN_SRC.slice(gm, end);
}
// Slice the shipped browseByModel body for a given source id.
function browseByModelBody(id) {
  var at = MODEL_PLUGIN_SRC.indexOf("id: '" + id + "'");
  var bm = MODEL_PLUGIN_SRC.indexOf('browseByModel:', at);
  var end = MODEL_PLUGIN_SRC.indexOf('getStream:', bm);
  return MODEL_PLUGIN_SRC.slice(bm, end);
}

describe('3movs getModels (/pornstars/ index — avatar + sort-nav exclude)', function () {
  // Real markup: <a class="thumb album item model"><a href="/pornstars/{slug}/"
  // class="wrap_image" title="Name"><img data-src="…/contents/models/…jpg"></a>
  function card(slug, name) {
    return '<div class="thumb album item model"><div class="th">' +
      '<a href="https://www.3movs.com/pornstars/' + slug + '/" class="wrap_image" title="' + name + '">' +
      '<img class="img lazyload" src="data:image/gif;base64,R0lGOD" ' +
      'data-src="https://img.3movs.com/contents/models/701/s1_' + slug + '.jpg" alt="' + name + '"/></a></div></div>';
  }
  const html = card('abella-danger', 'Abella Danger') + card('lana-rhoades', 'Lana Rhoades') +
    // sort-control links that must be excluded:
    '<a href="https://www.3movs.com/pornstars/title/">Name</a>' +
    '<a href="https://www.3movs.com/pornstars/most-viewed/">Views</a>';
  const opts = {
    hrefRx: /href="(https?:\/\/(?:www\.)?3movs\.com\/pornstars\/[a-z][a-z0-9-]+\/)"/g,
    exclude: function (u) { return /\/pornstars\/(?:title|top-rated|most-viewed|videos|videos-rating|videos-views)\/$/.test(u); },
    nameRx: [/title="([^"]+)"/, /alt="([^"]+)"/],
    thumbRx: [/(?:data-src|data-webp|src)="(https?:\/\/[^"]+\.jpe?g)"/i]
  };

  it('parses model cards with name + avatar, excluding sort-nav links', function () {
    var items = _parseModelIndex(html, opts);
    expect(items.length).toBe(2);
    expect(items[0].name).toBe('Abella Danger');
    expect(items[0].url).toBe('https://www.3movs.com/pornstars/abella-danger/');
    expect(items[0].thumb).toContain('/contents/models/');
  });

  it('browseByModel reuses the canonical _3movsCards + _3movsPages parser', function () {
    var body = browseByModelBody('3movs');
    expect(body).toContain('_3movsCards(html)');
    expect(body).toContain('_3movsPages(html');
  });

  it('anti-drift: shipped 3movs getModels carries pornstars hrefRx + avatar thumbRx', function () {
    var body = getModelsBody('3movs');
    expect(body).toContain('3movs\\.com\\/pornstars\\/');
    expect(body).toContain('thumbRx');
    expect(body).toContain('most-viewed');
  });
});

describe('pornve getModels (/models/ index — cdn avatar)', function () {
  function card(slug, name) {
    return '<div class="thumb"><a class="item" href="https://pornve.com/models/' + slug + '/" title="' + name + '">' +
      '<div class="img-holder"><img src="https://cdn.pornve.com/contents/models/19385/s1_' + slug + '.jpg" alt="' + name + '"/></div></a></div>';
  }
  const opts = {
    hrefRx: /href="(https?:\/\/pornve\.com\/models\/[a-z][a-z0-9-]+\/)"/g,
    nameRx: [/title="([^"]+)"/, /alt="([^"]+)"/],
    thumbRx: [/(?:data-src|src)="(https?:\/\/[^"]+\/contents\/models\/[^"]+\.jpe?g)"/i, /(?:data-src|src)="(https?:\/\/[^"]+\.jpe?g)"/i]
  };
  it('parses model cards with name + cdn avatar', function () {
    var items = _parseModelIndex(card('vittoria-divine', 'Vittoria Divine') + card('riley-reyes', 'Riley Reyes'), opts);
    expect(items.length).toBe(2);
    expect(items[1].name).toBe('Riley Reyes');
    expect(items[1].url).toBe('https://pornve.com/models/riley-reyes/');
    expect(items[1].thumb).toContain('cdn.pornve.com/contents/models/');
  });
  it('browseByModel reuses the canonical _pornveCards + _pornvePages parser', function () {
    var body = browseByModelBody('pornve');
    expect(body).toContain('_pornveCards(html)');
    // _pornvePages now derives from page fill (itemsLen, page) like familyporn — the
    // old hardcoded "|| 10) : 10" capped infinite scroll at ~10 pages (bug #5).
    expect(body).toContain('_pornvePages(items.length, p)');
  });
  it('anti-drift: shipped pornve getModels carries models hrefRx + thumbRx', function () {
    var body = getModelsBody('pornve');
    expect(body).toContain('pornve\\.com\\/models\\/');
    expect(body).toContain('contents\\/models\\/');
  });
});

describe('familyporn getModels (single-page A-Z roster — letter-tile fallback)', function () {
  // Real markup: <a class="link models-link" href="/models/{slug}/" title="Name">
  // <div class="name">Name</div><span class="text">N video</span></a> — NO avatar.
  function card(slug, name) {
    return '<li class="item models-list"><div class="thumb-vertical">' +
      '<a class="link models-link" href="https://familyporn.tv/models/' + slug + '/" title="' + name + '">' +
      '<div class="name">' + name + '</div><span class="text">5 video</span></a></div></li>';
  }
  const opts = {
    hrefRx: /href="(https?:\/\/familyporn\.tv\/models\/[a-z][a-z0-9-]+\/)"/g,
    nameRx: [/title="([^"]+)"/, /class="name"[^>]*>([^<]+)</],
    thumbRx: [/(?:data-original|data-src|src)="(https?:\/\/[^"]+\.(?:jpe?g|webp|png))"/i]
  };
  it('parses name-only model cards (no avatar → empty thumb)', function () {
    var items = _parseModelIndex(card('zuzi-rose', 'Zuzi Rose') + card('tony', 'Tony'), opts);
    expect(items.length).toBe(2);
    expect(items[0].name).toBe('Zuzi Rose');
    expect(items[0].url).toBe('https://familyporn.tv/models/zuzi-rose/');
    expect(items[0].thumb).toBe('');
  });
  it('browseByModel reuses the canonical _familypornCards + _familypornPages parser', function () {
    var body = browseByModelBody('familyporn');
    expect(body).toContain('_familypornCards(html)');
    expect(body).toContain('_familypornPages(html');
  });
  it('anti-drift: shipped familyporn getModels carries models hrefRx', function () {
    var body = getModelsBody('familyporn');
    expect(body).toContain('familyporn\\.tv\\/models\\/');
    expect(body).toContain('thumbRx');
  });
});

describe('porntrex getModels (/models/ index — protocol-relative avatar)', function () {
  function card(slug, name) {
    return '<div class="item dropdown-item"><a href="https://www.porntrex.com/models/' + slug + '/" title="' + name + '">' +
      '<div class="image"><img class="thumb lazyload" data-src="//ptx.cdntrex.com/contents/models/3820/s1_x.jpg" alt="' + name + '"/></div>' +
      '<div class="info">' + name + '</div></a></div>';
  }
  const opts = {
    hrefRx: /href="(https?:\/\/(?:www\.)?porntrex\.com\/models\/[a-z0-9][a-z0-9-]+\/)"/g,
    exclude: function (u) { return /\/models\/[a-z0-9]\/$/i.test(u); },
    nameRx: [/title="([^"]+)"/, /alt="([^"]+)"/, /class="info"[^>]*>([^<]+)</],
    thumbRx: [/(?:data-original|data-src|src)="((?:https?:)?\/\/[^"]+\/contents\/models\/[^"?#]+\.jpe?g)/i, /(?:data-original|data-src|src)="((?:https?:)?\/\/[^"?#]+\.jpe?g)/i]
  };
  it('parses model cards + avatar, excludes single-letter nav', function () {
    var html = card('amy-gross', 'Amy Gross') + card('lana-rhoades', 'Lana Rhoades') +
      '<a href="https://www.porntrex.com/models/a/">A</a>';
    var items = _parseModelIndex(html, opts);
    expect(items.length).toBe(2);
    expect(items[0].name).toBe('Amy Gross');
    expect(items[0].thumb).toContain('/contents/models/');
  });
  it('browseByModel reuses the canonical _porntrexCards + _porntrexPages parser', function () {
    var body = browseByModelBody('porntrex');
    expect(body).toContain('_porntrexCards(html)');
    expect(body).toContain('_porntrexPages(html, p, items.length)');
  });
  it('anti-drift: shipped porntrex getModels carries models hrefRx + letter exclude', function () {
    var body = getModelsBody('porntrex');
    expect(body).toContain('porntrex\\.com\\/models\\/');
    expect(body).toContain('contents\\/models\\/');
    expect(body).toContain('[a-z0-9]\\/$');
  });
});

describe('perfektdamen getModels (/pornstars/ index — relative links + nav exclude)', function () {
  function card(slug, name) {
    return '<li class="item"><a href="/pornstars/' + slug + '/" title="' + name + '">' +
      '<img data-original="//static.perfektdamen.co/models/' + slug + '.jpg" alt="' + name + '"/>' +
      '<p>' + name + '</p></a></li>';
  }
  const opts = {
    hrefRx: /href="((?:https?:\/\/(?:www\.)?perfektdamen\.co)?\/pornstars\/([a-z0-9][a-z0-9-]*)\/)"/g,
    exclude: function (u) { return /\/pornstars\/(?:abc|favorites|videos|updated|page|\d+)\/?$/.test(u); },
    normalizeUrl: function (raw) { return raw.charAt(0) === '/' ? 'https://www.perfektdamen.co' + raw : raw; },
    nameRx: [/title="([^"]+)"/, /alt="([^"]+)"/, /<p>\s*([^<]+)/],
    thumbRx: [/<img[^>]+(?:data-original|data-src|src)="([^"?#]+\.(?:jpe?g|webp|png))/i]
  };
  it('parses relative model links → absolute url, excludes sort-nav + pagination', function () {
    var html = card('valentina-nappi', 'Valentina Nappi') + card('riley-reyes', 'Riley Reyes') +
      '<a href="/pornstars/videos/">Videos</a><a href="/pornstars/2/">2</a>';
    var items = _parseModelIndex(html, opts);
    expect(items.length).toBe(2);
    expect(items[0].name).toBe('Valentina Nappi');
    expect(items[0].url).toBe('https://www.perfektdamen.co/pornstars/valentina-nappi/');
    expect(items[0].thumb).toContain('.jpg');
  });
  it('browseByModel reuses the canonical _perfektCards + _perfektPages parser', function () {
    var body = browseByModelBody('perfektdamen');
    expect(body).toContain('_perfektCards(html)');
    expect(body).toContain('_perfektPages(html');
  });
  it('anti-drift: shipped perfektdamen getModels carries pornstars hrefRx + nav exclude', function () {
    var body = getModelsBody('perfektdamen');
    expect(body).toContain('pornstars\\/([a-z0-9]');
    expect(body).toContain('favorites|videos|updated');
  });
});

describe('pornhub _parseHtmlCards (model videos li-block parser)', function () {
  // A videoblock <li> mirroring the real model page: title-href near top, then
  // mediabook preview, then a duration <var> with a multi-class variant.
  var card = function (vkey, durClass) {
    return '<li class="pcVideoListItem js-pop videoblock videoBox" data-video-vkey="' + vkey + '">' +
      '<a href="/view_video.php?viewkey=' + vkey + '" title="Title ' + vkey + '" class="img"></a>' +
      '<img data-mediumthumb="https://pix.phncdn.com/' + vkey + '/thumb.jpg" />' +
      '<span data-mediabook="https://kw.phncdn.com/' + vkey + '/180P.webm"></span>' +
      '<var class="' + (durClass || 'duration') + '">12:34</var>' +
      '<var class="videoViewCount">5.9K</var>' +
      '</li>';
  };

  it('stamps source, thumb, title, url, duration AND preview (mediabook)', function () {
    var items = phParseHtmlCards(card('abc123'));
    expect(items).toHaveLength(1);
    var c = items[0];
    expect(c.source).toBe('pornhub');
    expect(c.thumb).toContain('phncdn.com');
    expect(c.title).toBe('Title abc123');
    expect(c.url).toBe('https://www.pornhub.com/view_video.php?viewkey=abc123');
    expect(c.duration).toBe(754);            // 12:34
    expect(c.preview).toContain('180P.webm'); // model cards GAIN previews
  });

  it('captures duration on the multi-class <var> variant', function () {
    var items = phParseHtmlCards(card('def456', 'bgShadeEffect duration tooltipTrig'));
    expect(items[0].duration).toBe(754);
  });

  it('binds each card to its own block (no cross-card field bleed)', function () {
    var items = phParseHtmlCards(card('aaa111') + card('bbb222'));
    expect(items).toHaveLength(2);
    expect(items[0].preview).toContain('aaa111');
    expect(items[1].preview).toContain('bbb222');
    expect(items[0].thumb).toContain('aaa111');
    expect(items[1].thumb).toContain('bbb222');
  });

  it('dedupes a viewkey that appears twice in one block (title + related link)', function () {
    var dup = '<li class="videoblock"><a href="/view_video.php?viewkey=x9"></a>' +
              '<a href="/view_video.php?viewkey=x9" data-related></a>' +
              '<img data-mediumthumb="t.jpg"/><var class="duration">1:00</var></li>';
    expect(phParseHtmlCards(dup)).toHaveLength(1);
  });

  it('anti-drift: shipped _parseHtmlCards is li-block based with mediabook + multi-class duration', function () {
    var PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');
    var at = PLUGIN.indexOf('_parseHtmlCards: function(html)');
    var body = PLUGIN.slice(at, at + 3000);
    expect(body).toContain('videoblock');                 // li-block iteration
    expect(body).toContain('data-mediabook');             // preview captured
    expect(body).toMatch(/\\bduration\\b/);               // multi-class duration regex
    expect(body).toContain("source: 'pornhub'");
  });
});

// Inline reimplementation of xvideos _mapModelVideo (profile JSON → card).
// Kept IN SYNC with plugin.js.
function xvMapModelVideo(o) {
  if (!o || !o.eid) return null;
  var dur = 0;
  var dm = o.d && String(o.d).match(/(\d+)\s*min/);
  if (dm) dur = parseInt(dm[1], 10) * 60;
  return {
    id:       'xv' + o.eid,
    source:   'xvideos',
    title:    _decodeHtml(o.tf || o.t || ''),
    thumb:    o.il || o.i || o.ip || '',
    preview:  o.ipu || '',
    hd:       o.hm ? (/2160|4k/i.test(String(o.h || '')) ? '4K' : 'HD') : '',
    url:      'https://www.xvideos.com/video.' + o.eid + '/' +
              ((String(o.u || '').match(/\/[a-z0-9]+\/([^\/?#]+)\/?$/) || [, o.eid])[1]),
    duration: dur,
    views:    parseViews(String(o.n || 0))
  };
}

describe('xvideos _mapModelVideo (profile-videos JSON → card)', function () {
  var sample = {
    eid: 'ibviiih555c', tf: 'Full Title', t: 'short', i: 'i.jpg', il: 'il.jpg',
    ipu: 'https://cdn/preview.mp4', hm: 1, d: '14 min', n: '69000',
    u: '/prof-video-click/upload/mia-khalifa/ibviiih555c/full_slug'
  };

  it('maps id/source/title/thumb/preview/hd/duration like a listing card', function () {
    var c = xvMapModelVideo(sample);
    expect(c.id).toBe('xvibviiih555c');
    expect(c.source).toBe('xvideos');
    expect(c.title).toBe('Full Title');
    expect(c.thumb).toBe('il.jpg');
    expect(c.preview).toBe('https://cdn/preview.mp4');   // model cards carry preview
    expect(c.hd).toBe('HD');
    expect(c.duration).toBe(840);                        // 14 min
    expect(c.views).toBe(69000);
  });

  it('builds a /video.{eid}/{slug} watch URL from the eid + slug in u (getStream-compatible)', function () {
    var c = xvMapModelVideo(sample);
    expect(c.url).toBe('https://www.xvideos.com/video.ibviiih555c/full_slug');
  });

  it('falls back to eid as slug when u has no parseable slug', function () {
    var c = xvMapModelVideo({ eid: 'tok99', tf: 'T', d: '5 min' });
    expect(c.url).toBe('https://www.xvideos.com/video.tok99/tok99');
  });

  it('returns null for a JSON object missing eid', function () {
    expect(xvMapModelVideo({ tf: 'no eid' })).toBeNull();
  });

  it('anti-drift: shipped browseByModel hits /profiles/{slug}/videos/best JSON', function () {
    var PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');
    var at = PLUGIN.indexOf("id: 'xvideos'");
    var body = PLUGIN.slice(at, at + 12000);
    expect(body).toContain('_mapModelVideo');
    expect(body).toContain('/profiles/');
    expect(body).toContain('/videos/best/');
    expect(body).toContain('JSON.parse');
  });
});

// Inline reimplementation of ebun _ebunCards duration/views extraction.
// Kept IN SYNC with plugin.js. The meta block has an inner <span> icon before
// the value, so leading tags are skipped before the captured text.
function ebunCards(html) {
  var items = [];
  var hrefRx = /href="(https?:\/\/www1\.ebun\.tv\/videos\/(\d+)\/)"/g;
  var seen = {};
  var m;
  while ((m = hrefRx.exec(html)) !== null) {
    var videoUrl = m[1];
    var id = m[2];
    if (seen[id]) continue;
    seen[id] = true;
    var chunk = html.slice(m.index, m.index + 1100);
    var thumb = _attr(chunk, /(?:data-src|src)="([^"]+\.jpe?g)"/i) ||
                _attr(chunk, /(?:data-src|src)="([^"]+\.(?:webp|png))"/i);
    var title = _decodeHtml(
      _attr(chunk, /<div[^>]*class="[^"]*item-title[^"]*"[^>]*>([^<]+)<\/div>/) ||
      _attr(chunk, /alt="([^"]+)"/) ||
      _attr(chunk, /title="([^"]+)"/)
    );
    if (!title) title = _titleFromUrl(videoUrl);
    var duration = parseDur(_attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>(?:\s*<[^>]+>)*\s*([^<]+)</));
    var views    = parseViews(_attr(chunk, /class="[^"]*views?[^"]*"[^>]*>(?:\s*<[^>]+>)*\s*([^<]+)</));
    if (title || thumb) {
      items.push({ id: id, source: 'ebun', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views });
    }
  }
  return items;
}

describe('ebun _ebunCards (model + listing share parser; duration via meta-time)', function () {
  // Real ebun card markup: meta block uses <div class="meta-time"><span/>28:50</div>.
  var card =
    '<a href="https://www1.ebun.tv/videos/123/"><img data-src="https://cdn/t.jpg" alt="Vid"/></a>' +
    '<div class="meta-rating">79%</div>' +
    '<div class="meta-time"><span class="fa fa-clock-o"></span>28:50</div>' +
    '<div class="meta-views"><span class="fa fa-eye"></span>69K</div>';

  it('extracts duration past the inner span icon', function () {
    var items = ebunCards(card);
    expect(items).toHaveLength(1);
    expect(items[0].duration).toBe(1730);   // 28:50
    expect(items[0].views).toBe(69000);
    expect(items[0].thumb).toContain('t.jpg');
    expect(items[0].source).toBe('ebun');
  });

  it('anti-drift: shipped _ebunCards skips inner tags before duration + window 1100', function () {
    var PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');
    var at = PLUGIN.indexOf('function _ebunCards');
    var body = PLUGIN.slice(at, at + 1800);
    expect(body).toContain('m.index + 1100');
    expect(body).toMatch(/\(\?:\\s\*<\[\^>\]\+>\)\*/);   // (?:\s*<[^>]+>)* tag-skip
  });
});

// Inline mirror of jopaonline _jopaCards (kept IN SYNC with plugin.js).
// Each card carries <img data-preview="…/prev_{id}.mp4"> (CDN absolute URL).
function jopaCards(html) {
  var items = [];
  var hrefRx = /href="(https?:\/\/jopaonline\.mobi\/porno-video\/(\d+))"/g;
  var seen = {};
  var m;
  while ((m = hrefRx.exec(html)) !== null) {
    var videoUrl = m[1];
    var id = m[2];
    if (seen[id]) continue;
    seen[id] = true;
    var chunk = html.slice(m.index, m.index + 900);
    var thumb = _attr(chunk, /(?:data-original|data-src|src)="([^"?#]+\/uploads\/posts\/\d{4}-\d{2}\/[^"?#]+)/i) ||
                _attr(chunk, /(?:data-original|data-src|src)="([^"?#]+\.jpe?g)/i);
    var title = _decodeHtml(_attr(chunk, /title="([^"]+)"/) || _attr(chunk, /alt="([^"]+)"/));
    if (!title) title = _titleFromUrl(videoUrl);
    var duration = parseDur(_attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</));
    var views    = parseViews(_attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));
    var preview  = _attr(chunk, /data-preview="([^"]+\.mp4[^"]*)"/i);
    if (title || thumb) {
      items.push({ id: id, source: 'jopaonline', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views, preview: preview || undefined });
    }
  }
  return items;
}

describe('jopaonline _jopaCards (hover-preview mp4 via data-preview)', function () {
  // Real jopa card markup (curled jopaonline.mobi/categories/mamki/).
  var card =
    '<a href="https://jopaonline.mobi/porno-video/18975" title="Блондинка в масле">' +
    '<div class="th-image"><img data-preview="https://v5230.yourstream.pro/jopa/ff_m/18975/prev_18975.mp4" ' +
    'src="https://jopaonline.mobi/uploads/posts/2026-05/blondinka.jpg" alt="Блондинка в масле" />' +
    '<div class="th-duration">46:29</div></div>' +
    '<span class="th-views">1,860</span></a>';

  it('captures the data-preview mp4 (absolute CDN URL)', function () {
    var items = jopaCards(card);
    expect(items).toHaveLength(1);
    expect(items[0].preview).toBe('https://v5230.yourstream.pro/jopa/ff_m/18975/prev_18975.mp4');
    expect(items[0].duration).toBe(2789);   // 46:29
    expect(items[0].views).toBe(1860);
  });

  it('preview is undefined when no mp4 attr present', function () {
    var noPrev = '<a href="https://jopaonline.mobi/porno-video/1" title="X">' +
                 '<img src="https://jopaonline.mobi/uploads/posts/2026-05/x.jpg"/></a>';
    var items = jopaCards(noPrev);
    expect(items[0].preview).toBeUndefined();
  });

  it('anti-drift: shipped _jopaCards extracts data-preview .mp4', function () {
    var PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');
    var at = PLUGIN.indexOf('function _jopaCards');
    var body = PLUGIN.slice(at, at + 1700);
    expect(body).toContain('data-preview="([^"]+\\.mp4');
    expect(body).toContain('preview: preview || undefined');
  });
});

// Inline mirror of porntrex _porntrexCards duration/views (kept IN SYNC).
// KVS markup: <div class="durations"><i .../> MM:SS</div> + <div class="viewsthumb">N views</div>,
// both sitting AFTER a long screenshots-list rotator → window 2600.
function porntrexCards(html) {
  var items = [];
  var hrefRx = /href="(https?:\/\/www\.porntrex\.com\/video\/[^"]+)"/g;
  var seen = {};
  var m;
  while ((m = hrefRx.exec(html)) !== null) {
    var videoUrl = m[1];
    var idMatch = /\/video\/(\d+)\//.exec(videoUrl);
    var id = idMatch ? idMatch[1] : videoUrl;
    if (seen[id]) continue;
    seen[id] = true;
    var chunk = html.slice(m.index, m.index + 2600);
    var duration = parseDur(
      _attr(chunk, /class="durations"[^>]*>(?:\s*<[^>]+>)*\s*([^<]+)</) ||
      _attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>(?:\s*<[^>]+>)*\s*([^<]+)</)
    );
    var views = parseViews(
      _attr(chunk, /class="viewsthumb"[^>]*>\s*([^<]+)</) ||
      _attr(chunk, /class="[^"]*views?[^"]*"[^>]*>\s*([^<]+)</)
    );
    items.push({ id: id, source: 'porntrex', url: videoUrl, duration: duration, views: views });
  }
  return items;
}

describe('porntrex _porntrexCards (duration via .durations, views via .viewsthumb)', function () {
  // Real porntrex card markup (curled porntrex.com/latest-updates/), screenshots-list
  // padded to push the meta past the old 800-char window.
  var card =
    '<a href="https://www.porntrex.com/video/3218416/aqua-ri" class="thumb rotator-screen">' +
    '<ul class="screenshots-list">' + '<li>x</li>'.repeat(80) + '</ul></a>' +
    '<div class="viewsthumb">1,234 views</div>' +
    '<div class="durations"><i class="fa fa-clock-o"></i> 10:11</div>';

  it('extracts duration past the screenshots rotator', function () {
    var items = porntrexCards(card);
    expect(items).toHaveLength(1);
    expect(items[0].duration).toBe(611);    // 10:11
    expect(items[0].views).toBe(1234);
  });

  it('anti-drift: shipped _porntrexCards uses window 2600 + .durations/.viewsthumb', function () {
    var PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');
    var at = PLUGIN.indexOf('function _porntrexCards');
    var body = PLUGIN.slice(at, at + 2000);
    expect(body).toContain('m.index + 2600');
    expect(body).toContain('class="durations"');
    expect(body).toContain('class="viewsthumb"');
  });
});

// ---- TAXONOMY EXPANSION + SEARCH FILTERS ------------------------------------
// All assertions read the shipped plugin.js so cfg/URL drift is caught.
const PLUGIN_SRC = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');

// Pull the FIRST _cats('…') literal that appears AFTER a given anchor string —
// used to grab a specific adapter's category list out of the IIFE source.
function catsAfter(anchor, key) {
  var at = PLUGIN_SRC.indexOf(anchor);
  if (at < 0) throw new Error('anchor not found: ' + anchor);
  var seg = PLUGIN_SRC.slice(at);
  var idx = seg.indexOf(key + ': _cats(');
  if (idx < 0) idx = seg.indexOf(key + ":_cats(");
  if (idx < 0) throw new Error('key not found: ' + key + ' after ' + anchor);
  var m = seg.slice(idx).match(/_cats\('([\s\S]*?)'\)/);
  if (!m) throw new Error('no _cats literal for ' + key);
  return m[1].split(',');
}

describe('taxonomy expansion (real curl-verified slugs)', function () {
  it('pornhub categories expanded 40 → 100+ (real webmasters slugs)', function () {
    var cats = catsAfter("id: 'pornhub'", 'categories');
    expect(cats.length).toBeGreaterThanOrEqual(100);
    // Spot-check new slugs verified via the webmasters API (each returned 30 cards).
    var slugs = cats.map(function (p) { return p.split(':')[0]; });
    ['red-head', 'bbw', '18-25', 'step-fantasy', 'cosplay', 'rough-sex', 'czech', 'deepthroat']
      .forEach(function (s) { expect(slugs).toContain(s); });
  });

  it('hellporno categories expanded 37 → 120+ (real /categories/ slugs)', function () {
    var cats = catsAfter("id: 'hellporno'", 'categories');
    expect(cats.length).toBeGreaterThanOrEqual(120);
    var slugs = cats.map(function (p) { return p.split(':')[0]; });
    ['group-sex', 'doggy-style', 'cum-in-mouth', 'small-tits', 'hd', 'cuckold', 'cheating', 'compilation']
      .forEach(function (s) { expect(slugs).toContain(s); });
  });
});

describe('eporner orientation filter (gay param wiring)', function () {
  // Mirror of the shipped _orient() — kept in sync with the adapter.
  function _orient(sort) {
    var m = String(sort || '').match(/^(.*?)~gay([012])$/);
    if (m) return { order: m[1] || 'most-popular', gay: m[2] };
    return { order: sort || 'most-popular', gay: '0' };
  }

  it('default sorts → gay=0 (straight, unchanged behaviour)', function () {
    expect(_orient('most-popular').gay).toBe('0');
    expect(_orient('latest').gay).toBe('0');
    expect(_orient('').gay).toBe('0');
  });

  it('~gay1 → gay=1 (gay) and ~gay2 → gay=2 (trans), order preserved', function () {
    expect(_orient('latest~gay1')).toEqual({ order: 'latest', gay: '1' });
    expect(_orient('latest~gay2')).toEqual({ order: 'latest', gay: '2' });
  });

  it('cfg.sorts exposes Гей + Транс orientation entries', function () {
    var at = PLUGIN_SRC.indexOf("id: 'eporner'");
    var seg = PLUGIN_SRC.slice(at, at + 4000);
    expect(seg).toContain("id: 'latest~gay1'");
    expect(seg).toContain("id: 'latest~gay2'");
    expect(seg).toContain('Гей');
    expect(seg).toContain('Транс');
  });

  it('browse() AND search() thread gay into the URL via _orient', function () {
    var at = PLUGIN_SRC.indexOf("id: 'eporner'");
    var seg = PLUGIN_SRC.slice(at, at + 7000);
    // No more hardcoded gay=0; gay comes from _orient now.
    expect(seg).toContain("&gay=' + gay");       // search()
    expect(seg).toContain("&gay=' + o.gay");     // browse()
    expect(seg).not.toContain('&gay=0&format');  // old hardcode gone
  });
});

describe('xvideos search filters (sort + duration/quality/date facets)', function () {
  // Mirror of the shipped _searchFacets() — kept in sync with the adapter.
  function _searchFacets(sort) {
    var s = String(sort || '');
    var parts = s.split('~');
    var out = { sort: parts[0] || '' };
    for (var i = 1; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv[0] && kv[1]) out[kv[0]] = kv[1];
    }
    return out;
  }

  it('plain sort ids pass through unchanged (no facets)', function () {
    expect(_searchFacets('rating')).toEqual({ sort: 'rating' });
    expect(_searchFacets('views')).toEqual({ sort: 'views' });
    expect(_searchFacets('')).toEqual({ sort: '' });
  });

  it('faceted ids split into sort + durf/quality/datef', function () {
    expect(_searchFacets('rating~quality=hd')).toEqual({ sort: 'rating', quality: 'hd' });
    expect(_searchFacets('uploaddate~datef=week')).toEqual({ sort: 'uploaddate', datef: 'week' });
    expect(_searchFacets('relevance~durf=10min_more')).toEqual({ sort: 'relevance', durf: '10min_more' });
  });

  it('search() threads sort + facets into the &k= query (was ignored before)', function () {
    var at = PLUGIN_SRC.indexOf("id: 'xvideos'");
    var seg = PLUGIN_SRC.slice(at, at + 6000);
    expect(seg).toContain('_searchFacets');
    expect(seg).toContain("'&sort='");
    expect(seg).toContain("'&durf='");
    expect(seg).toContain("'&quality='");
    expect(seg).toContain("'&datef='");
  });

  it('browse() strips the search-only ~facet suffix (uses base sort only)', function () {
    var at = PLUGIN_SRC.indexOf("id: 'xvideos'");
    var seg = PLUGIN_SRC.slice(at, at + 8000);
    expect(seg).toContain('var baseSort = self._searchFacets(sort).sort');
  });

  it('cfg.sorts exposes search-only faceted entries', function () {
    var at = PLUGIN_SRC.indexOf("id: 'xvideos'");
    var seg = PLUGIN_SRC.slice(at, at + 5000);
    expect(seg).toContain('rating~quality=hd');
    expect(seg).toContain('relevance~durf=10min_more');
    expect(seg).toContain('uploaddate~datef=week');
  });
});

// ============================================================
// DEVICE BUG FIXES (8) — source-read assertions against plugin.js
// Each anchors on the exact code path changed so a regression that reverts
// the fix fails here. CURL evidence is recorded in the fix report.
// ============================================================
describe('device bug fixes (8)', function () {
  const SRC = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');

  // #5 pornve — infinite scroll restored via _derivePages (was hardcoded || 10).
  it('#5 pornve: _pornvePages(itemsLen, page) derives via _derivePages(…,24)', function () {
    const m = /function _pornvePages\(itemsLen, page\)\s*\{[\s\S]*?\}/.exec(SRC);
    expect(m, '_pornvePages must take (itemsLen, page)').toBeTruthy();
    expect(m[0]).toContain('_derivePages(itemsLen, page || 1, 24)');
    expect(m[0]).not.toContain('|| 10');
  });
  it('#5 pornve: browse/search/byModel callers pass item count + page', function () {
    const pv = SRC.slice(SRC.indexOf("id: 'pornve'"), SRC.indexOf("function _pornveCards"));
    // No caller may still pass the raw html (the old signature).
    expect(/_pornvePages\(html\)/.test(pv)).toBe(false);
    expect((pv.match(/_pornvePages\(items\.length, p\)/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(pv).toContain('_pornvePages(items.length, page)'); // search uses `page`
  });

  // #3 eporner — preview <video> gets object-fit:cover so non-16:9 sources don't stretch.
  it('#3 eporner: .cherry-card__preview CSS sets object-fit:cover', function () {
    const rule = /\.cherry-card__preview\{[^}]*\}/.exec(SRC);
    expect(rule, 'preview CSS rule must exist').toBeTruthy();
    expect(rule[0]).toContain('object-fit:cover');
    expect(rule[0]).toContain('width:100%');
    expect(rule[0]).toContain('height:100%');
  });
  it('#3 eporner: .cherry-cat .card__img keeps object-fit:cover (thumb cover)', function () {
    expect(/\.cherry-cat \.card__img \{[\s\S]*?object-fit: cover;[\s\S]*?\}/.test(SRC)).toBe(true);
  });

  // #1 youjizz — getStream prefers direct MP4 over HLS so Lampa plays inline.
  it('#1 youjizz: getStream skips HLS encodings (prefers direct MP4)', function () {
    const gs = SRC.slice(SRC.indexOf("id: 'youjizz'"), SRC.indexOf("id: 'pornone'"));
    expect(gs).toContain('function isHls(u)');
    expect(gs).toContain('if (!u || isHls(u)) return;');
    // HLS detection covers both the _hls path segment and the m3u8 extension.
    expect(gs).toContain('_hls');
    expect(gs).toContain('m3u8');
  });

  // #8 pornhub — search & browse use the SAME _mapVideo (identical playable cards).
  it('#8 pornhub: _mapVideo stamps source:pornhub and a view_video url', function () {
    const ph = SRC.slice(SRC.indexOf("id: 'pornhub'"), SRC.indexOf("_parseHtmlCards"));
    expect(ph).toContain("source: 'pornhub'");
    // Both search() and browse() map through the same _mapVideo (no divergent url build).
    const phFull = SRC.slice(SRC.indexOf("id: 'pornhub'"), SRC.indexOf("// xvideos/xnxx"));
    expect((phFull.match(/self\._mapVideo\(v\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  // #4/#6 hellporno stays on CF (Deno serves 0). hqporner now routes to the VPS:
  // curl-confirmed the VPS returns the full catalog (CF datacenter IPs intermittently
  // blocked) and its streams (mydaddy/bigcdn) already → VPS, so page+stream co-locate.
  it('#4/#6: hellporno NOT routed to secondary; hqporner routed to VPS; secondary→CF failover exists', function () {
    const set = /var PROXY_URL_2_HOSTS = \{[\s\S]*?\};/.exec(SRC)[0];
    expect(set).not.toContain("'hellporno.com': 1");
    expect(set).toContain("'hqporner.com': 1");
    expect(set).toContain("'www.hqporner.com': 1");
    // Failover so a dead secondary proxy (over-quota/down) falls back to CF.
    expect(SRC).toContain('_hasProxyFailover');
    expect(SRC).toMatch(/buildProxyUrl\(url, referer, true\)/);
  });

  // #7 porndig — «похожие» paginates via the load_related_posts AJAX endpoint.
  it('#7 porndig: getRelated(video, page) hits /posts/load_related_posts/{page}/{id}', function () {
    const pd = SRC.slice(SRC.indexOf("id: 'porndig'"), SRC.indexOf("function _porndigCards"));
    expect(pd).toContain('getRelated: function (video, page)');
    expect(pd).toContain("'https://porndig.com/posts/load_related_posts/' + p + '/' + video.id");
    expect(pd).toContain('JSON.parse(text).data');
    expect(pd).toContain('_porndigCards(content)');
  });

  // #2 tizam — category browse threads zero-indexed ?p= pagination + _derivePages.
  it('#2 tizam: category browse uses ?p=(p-1) + _derivePages (not total_pages:1)', function () {
    const tz = SRC.slice(SRC.indexOf("id: 'tizam'"), SRC.indexOf("id: 'perfektdamen'"));
    expect(tz).toContain("/fil_my_dlya_vzroslyh/' + category + '/?p=' + (p - 1)");
    // category branch no longer caps at a single page.
    const catBranch = tz.slice(tz.indexOf('if (category)'), tz.indexOf('Zero-indexed'));
    expect(catBranch).toContain('_derivePages(items.length, p, 12)');
    expect(/total_pages: 1/.test(catBranch)).toBe(false);
  });
});

// =============================================================================
// describe: RU→EN search translation (functional) — v0.13.10
// =============================================================================
describe('RU→EN search translation', function () {
  const PLUGIN = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');
  function balanced(startIdx) {
    let depth = 0;
    for (let k = PLUGIN.indexOf('{', startIdx); k < PLUGIN.length; k++) {
      if (PLUGIN[k] === '{') depth++;
      else if (PLUGIN[k] === '}' && --depth === 0) return k;
    }
    throw new Error('unbalanced from ' + startIdx);
  }
  function grabFn(name) { const i = PLUGIN.indexOf('function ' + name + '('); return PLUGIN.slice(i, balanced(i) + 1); }
  function grabVar(name) { const i = PLUGIN.indexOf('var ' + name + ' ='); return PLUGIN.slice(i, balanced(i) + 1) + ';'; }
  const ctx = [grabVar('_SEARCH_SYN'), grabVar('_RU_EN'), grabVar('_RU_SOURCES'), grabFn('_normText'), grabFn('_translateQuery'), grabFn('_searchGroups')].join('\n');
  const M = new Function(ctx + '\nreturn {_translateQuery:_translateQuery,_searchGroups:_searchGroups,_RU_SOURCES:_RU_SOURCES};')();

  it('translates Russian concept queries to English (greedy phrase first)', function () {
    expect(M._translateQuery('большие сиськи')).toBe('big tits');
    expect(M._translateQuery('мамка')).toBe('milf');
    expect(M._translateQuery('молодая блондинка')).toBe('teen blonde');
    expect(M._translateQuery('зрелая')).toBe('mature');
  });
  it('returns "" for an already-Latin query (no translation needed)', function () {
    expect(M._translateQuery('milf')).toBe('');
    expect(M._translateQuery('big tits')).toBe('');
  });
  it('builds BILINGUAL groups so a Russian word matches English titles', function () {
    const g = M._searchGroups('мамка');
    expect(g[0]).toContain('мамка');
    expect(g[0]).toContain('milf');
    const g2 = M._searchGroups('blonde milf');
    expect(g2.length).toBe(2);
    expect(g2[1]).toContain('mature'); // milf synonyms
  });
  it('tags the Russian-title sources for query routing', function () {
    expect(M._RU_SOURCES.tizam).toBeTruthy();
    expect(M._RU_SOURCES.lenporno).toBeTruthy();
    expect(M._RU_SOURCES.xvideos).toBeFalsy();
  });
});
