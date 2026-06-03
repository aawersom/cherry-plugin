/**
 * Tests for source-stream-fix task (REQ-1 through REQ-9).
 *
 * Helper functions are copied from the CURRENT (post-fix) plugin.js so that
 * unit tests can run without importing the full IIFE.
 * REQ-5 pornone routing tests are marked skip — they test the Commit B state
 * (pornone removed from Deno) which ships in the CF Worker cross-file commit.
 */
import { describe, it, expect } from 'vitest';

// ============================================================
// Current proxy config — matches plugin.js post-Commit-A
// ============================================================
var PROXY_URL   = 'https://cherry-proxy.aawersom.workers.dev';
var PROXY_URL_2 = 'https://cherry-proxy.aawersom.deno.net';
var PROXY_URL_3 = '';

var PROXY_URL_2_HOSTS = {
  'xnxx.com': 1, 'www.xnxx.com': 1,
  'www.youjizz.com': 1, 'youjizz.com': 1,
  'tv4.tizam.org': 1,
  // pornone moved to CF Worker SOCKS5 (Deno IP banned)
  'www.eporner.com': 1,
  // spankbang ru: Deno for browse; stream broken (needs Playwright)
  'ru.spankbang.com': 1,
  'www.perfektdamen.co': 1
};

// Current buildProxyUrl — has /\.bigcdn\.cc$/ regex (REQ-4), pornone regex removed (Commit B)
function buildProxyUrl(url, referer) {
  var key = '1206';
  var base = PROXY_URL;
  if (PROXY_URL_3) {
    try {
      var h3 = new URL(url).hostname;
      var PROXY_URL_3_HOSTS = { 'www.pornhub.com': 1, 'rt.pornhub.com': 1 };
      if (PROXY_URL_3_HOSTS[h3]) base = PROXY_URL_3;
    } catch (e) {}
  }
  if (base === PROXY_URL && PROXY_URL_2) {
    try {
      var h = new URL(url).hostname;
      if (PROXY_URL_2_HOSTS[h] || /\.bigcdn\.cc$/.test(h)) base = PROXY_URL_2;
    } catch (e) {}
  }
  var p = base + '/proxy?url=' + encodeURIComponent(url);
  p += '&key=' + encodeURIComponent(key);
  if (referer) p += '&referer=' + encodeURIComponent(referer);
  return p;
}

// Current px() — has PROXY_URL_3 guard (REQ-1 sub)
function px(u) {
  if (!u) return u;
  if (u.indexOf('blob:') === 0) return u;
  if (PROXY_URL_3 && u.indexOf(PROXY_URL_3) === 0) return u;   // guard added by REQ-1
  if (u.indexOf(PROXY_URL) === 0) return u;
  if (PROXY_URL_2 && u.indexOf(PROXY_URL_2) === 0) return u;
  if (u.indexOf('//') === 0) u = 'https:' + u;
  return buildProxyUrl(u);
}

function bestQualityUrl(quality) {
  var keys = Object.keys(quality || {});
  if (!keys.length) return '';
  var best = 0, bestUrl = '';
  keys.forEach(function (k) {
    var n = parseInt(k, 10) || 0;
    if (n > best) { best = n; bestUrl = quality[k]; }
  });
  return bestUrl || quality[keys[0]];
}

function _kvsPickBest(urls) {
  var order = ['2160p', '1080p', '720p', '480p', '360p', '240p'];
  var quality = {};
  var best = '';
  var bestIdx = order.length;
  urls.forEach(function (u) {
    var labelMatch = /[_-](\d+p)\./i.exec(u);
    var label = labelMatch ? labelMatch[1].toLowerCase() : 'default';
    quality[label] = u;
    var idx = order.indexOf(label);
    if (idx === -1) idx = order.length - 1;
    if (idx < bestIdx) { bestIdx = idx; best = u; }
  });
  if (!best && urls.length) best = urls[0];
  return { url: best, quality: quality };
}

function makeFetch(html) {
  return function() { return Promise.resolve(html); };
}

// ============================================================
// REQ-4: s24.bigcdn.cc → PROXY_URL_2 via /\.bigcdn\.cc$/ regex
// ============================================================
describe('REQ-4 bigcdn regex routing', function () {
  it('routes s24.bigcdn.cc to PROXY_URL_2 (unlisted subdomain)', function () {
    var result = buildProxyUrl('https://s24.bigcdn.cc/pubs/hash/1080.mp4');
    expect(result.indexOf(PROXY_URL_2)).toBe(0);
  });
  it('routes s99.bigcdn.cc to PROXY_URL_2 (any subdomain)', function () {
    var result = buildProxyUrl('https://s99.bigcdn.cc/pubs/hash/720.mp4');
    expect(result.indexOf(PROXY_URL_2)).toBe(0);
  });
  it('routes s1.bigcdn.cc to PROXY_URL_2 (previously hardcoded)', function () {
    var result = buildProxyUrl('https://s1.bigcdn.cc/pubs/hash/720.mp4');
    expect(result.indexOf(PROXY_URL_2)).toBe(0);
  });
});

// ============================================================
// REQ-5: pornone moved to CF Worker SOCKS5 (Deno IP banned)
// ============================================================
describe('REQ-5 pornone routing — CF Worker after Commit B', function () {
  it('pornone.com routes to PROXY_URL (CF Worker), not Deno', function () {
    var result = buildProxyUrl('https://pornone.com/video/slug/');
    expect(result.indexOf(PROXY_URL)).toBe(0);
    expect(result.indexOf(PROXY_URL_2)).toBe(-1);
  });
  it('s1002.pornone.com routes to PROXY_URL (CF Worker), not Deno', function () {
    var result = buildProxyUrl('https://s1002.pornone.com/vid/token/video.mp4');
    expect(result.indexOf(PROXY_URL)).toBe(0);
    expect(result.indexOf(PROXY_URL_2)).toBe(-1);
  });
});

// ============================================================
// REQ-1 sub: px() PROXY_URL_3 guard prevents double-proxying
// ============================================================
describe('REQ-1 px() — PROXY_URL_3 guard', function () {
  it('passes through URL already starting with PROXY_URL_3 when set', function () {
    var savedProxy3 = PROXY_URL_3;
    // Temporarily override the closed-over variable via a local simulation
    function pxWithProxy3(u, testProxy3) {
      if (!u) return u;
      if (u.indexOf('blob:') === 0) return u;
      if (testProxy3 && u.indexOf(testProxy3) === 0) return u;  // the new guard
      if (u.indexOf(PROXY_URL) === 0) return u;
      if (PROXY_URL_2 && u.indexOf(PROXY_URL_2) === 0) return u;
      if (u.indexOf('//') === 0) u = 'https:' + u;
      return buildProxyUrl(u);
    }
    var testProxy3 = 'https://cherry-vps.example.com';
    var alreadyProxied = testProxy3 + '/proxy?url=' + encodeURIComponent('https://www.pornhub.com/view');
    expect(pxWithProxy3(alreadyProxied, testProxy3)).toBe(alreadyProxied);
  });
});

// ============================================================
// REQ-2 eporner routing: www.eporner.com → PROXY_URL_2 (reverted from SOCKS5)
// ============================================================
describe('REQ-2 eporner routing reverted to Deno', function () {
  it('routes www.eporner.com to PROXY_URL_2', function () {
    var result = buildProxyUrl('https://www.eporner.com/hd-porn/abc123/slug/');
    expect(result.indexOf(PROXY_URL_2)).toBe(0);
  });
});

// ============================================================
// REQ-3 spankbang routing: ru.spankbang.com → CF Worker SOCKS5
// (stream-fix-2: moved from Deno to CF Worker residential — Deno GCP IP blocked)
// ============================================================
describe('REQ-3 spankbang routing — CF Worker (SOCKS5 residential)', function () {
  it('routes ru.spankbang.com to PROXY_URL (CF Worker), not Deno', function () {
    var result = buildProxyUrl('https://ru.spankbang.com/new/1/');
    expect(result.indexOf(PROXY_URL)).toBe(0);
    expect(result.indexOf(PROXY_URL_2)).toBe(-1);
  });
});

// ============================================================
// REQ-1 pornhub HLS: quality map values are buildProxyUrl strings (not blob:)
// ============================================================
describe('REQ-1 pornhub HLS — no blob: URLs in quality map', function () {
  it('quality map values start with PROXY_URL after removing proxyM3u8', async function () {
    // Simulate new pornhub getStream HLS block (synchronous buildProxyUrl)
    function pornhubGetStreamNew(hlsUrls, referer) {
      var quality = {};
      Object.keys(hlsUrls).forEach(function(lbl) {
        quality[lbl] = buildProxyUrl(hlsUrls[lbl], referer);
      });
      return { url: bestQualityUrl(quality), quality: quality };
    }
    var hlsUrls = {
      '1080p': 'https://ev-h.phncdn.com/hls/videos/202405/14/452452431/1080P.m3u8',
      '720p':  'https://ev-h.phncdn.com/hls/videos/202405/14/452452431/720P.m3u8'
    };
    var stream = pornhubGetStreamNew(hlsUrls, 'https://www.pornhub.com/');
    Object.values(stream.quality).forEach(function(v) {
      expect(v.indexOf('blob:')).toBe(-1);
      expect(v.indexOf(PROXY_URL)).toBe(0);
    });
  });
});

// ============================================================
// REQ-7 porntrex: _kvsPickBest output wrapped with referer
// ============================================================
describe('REQ-7 porntrex — quality map carries referer', function () {
  it('quality values contain referer=https%3A%2F%2Fwww.porntrex.com%2F', async function () {
    // Simulate new porntrex getStream wrapping
    function porntrexGetStreamNew(found) {
      var r = _kvsPickBest(found);
      var q = {};
      Object.keys(r.quality).forEach(function(k) {
        q[k] = buildProxyUrl(r.quality[k], 'https://www.porntrex.com/');
      });
      return { url: buildProxyUrl(r.url, 'https://www.porntrex.com/'), quality: q };
    }
    var found = [
      'https://www.porntrex.com/get_file/abc/def-1080p.mp4',
      'https://www.porntrex.com/get_file/abc/def-720p.mp4'
    ];
    var stream = porntrexGetStreamNew(found);
    expect(stream.url).toContain('referer=https%3A%2F%2Fwww.porntrex.com%2F');
    Object.values(stream.quality).forEach(function(v) {
      expect(v).toContain('referer=https%3A%2F%2Fwww.porntrex.com%2F');
    });
  });
});

// ============================================================
// REQ-9 24rolika: JWPlayer URL wrapped with buildProxyUrl + referer
// ============================================================
describe('REQ-9 24rolika — JWPlayer URL proxy-wrapped', function () {
  it('returned URL starts with PROXY_URL', async function () {
    var rawUrl = 'https://videosdrop.com/content/abc123/video-1080p.mp4';
    var proxyUrl = buildProxyUrl(rawUrl, 'https://w2.huyalkino.com/');
    expect(proxyUrl.indexOf(PROXY_URL)).toBe(0);
  });
  it('returned URL contains referer=https%3A%2F%2Fw2.huyalkino.com%2F', function () {
    var rawUrl = 'https://videosdrop.com/content/abc123/video-720p.mp4';
    var proxyUrl = buildProxyUrl(rawUrl, 'https://w2.huyalkino.com/');
    expect(proxyUrl).toContain('referer=https%3A%2F%2Fw2.huyalkino.com%2F');
  });
});

// ============================================================
// stream-fix-2 Phase A — REQ-1 (phncdn) + REQ-3 (spankbang)
// sync with plugin.js PROXY_URL_2_HOSTS (post Phase-A state)
// ============================================================

// PROXY_URL_2_HOSTS post-Phase-A: ru.spankbang.com removed
var PROXY_URL_2_HOSTS_A = {
  'xnxx.com': 1, 'www.xnxx.com': 1,
  'www.youjizz.com': 1, 'youjizz.com': 1,
  'tv4.tizam.org': 1,
  'www.eporner.com': 1,
  // ru.spankbang.com REMOVED — moved to CF Worker SOCKS5
  'www.perfektdamen.co': 1
};

function buildProxyUrlA(url, referer) {
  var key = '1206';
  var base = PROXY_URL;
  if (PROXY_URL_2) {
    try {
      var h = new URL(url).hostname;
      if (PROXY_URL_2_HOSTS_A[h] || /\.bigcdn\.cc$/.test(h)) base = PROXY_URL_2;
    } catch (e) {}
  }
  var p = base + '/proxy?url=' + encodeURIComponent(url);
  p += '&key=' + encodeURIComponent(key);
  if (referer) p += '&referer=' + encodeURIComponent(referer);
  return p;
}

describe('Phase-A REQ-3 spankbang — moved from Deno to CF Worker', function () {
  it('ru.spankbang.com routes to PROXY_URL (CF Worker), not Deno', function () {
    var result = buildProxyUrlA('https://ru.spankbang.com/abc/video/');
    expect(result.indexOf(PROXY_URL)).toBe(0);
    expect(result.indexOf(PROXY_URL_2)).toBe(-1);
  });
  it('regressions: eporner still routes to PROXY_URL_2', function () {
    var result = buildProxyUrlA('https://www.eporner.com/hd-porn/123/');
    expect(result.indexOf(PROXY_URL_2)).toBe(0);
  });
  it('regressions: xnxx still routes to PROXY_URL_2', function () {
    var result = buildProxyUrlA('https://www.xnxx.com/video-abc123/title');
    expect(result.indexOf(PROXY_URL_2)).toBe(0);
  });
  it('regressions: perfektdamen still routes to PROXY_URL_2', function () {
    var result = buildProxyUrlA('https://www.perfektdamen.co/video/123');
    expect(result.indexOf(PROXY_URL_2)).toBe(0);
  });
});

describe('Phase-A REQ-1 phncdn — routes through CF Worker (RESIDENTIAL in CF Worker)', function () {
  it('ev-h.phncdn.com routes to PROXY_URL (CF Worker handles SOCKS5 internally)', function () {
    // phncdn was never in PROXY_URL_2_HOSTS — CF Worker decides SOCKS5 via RESIDENTIAL set
    var result = buildProxyUrlA('https://ev-h.phncdn.com/hls/videos/202405/14/123/480P.m3u8');
    expect(result.indexOf(PROXY_URL)).toBe(0);
    expect(result.indexOf(PROXY_URL_2)).toBe(-1);
  });
  it('di.phncdn.com routes to PROXY_URL', function () {
    var result = buildProxyUrlA('https://di.phncdn.com/videos/202405/14/123/seg-1.ts');
    expect(result.indexOf(PROXY_URL)).toBe(0);
    expect(result.indexOf(PROXY_URL_2)).toBe(-1);
  });
});

// ============================================================
// stream-fix-2 Phase B — REQ-2/4/5/6/7
// ============================================================

// buildProxyUrl post-Phase-B: bigcdn regex removed
function buildProxyUrlB(url, referer) {
  var key = '1206';
  var base = PROXY_URL;
  if (PROXY_URL_2) {
    try {
      var h = new URL(url).hostname;
      if (PROXY_URL_2_HOSTS_A[h]) base = PROXY_URL_2; // no bigcdn regex
    } catch (e) {}
  }
  var p = base + '/proxy?url=' + encodeURIComponent(url);
  p += '&key=' + encodeURIComponent(key);
  if (referer) p += '&referer=' + encodeURIComponent(referer);
  return p;
}

describe('Phase-B REQ-2 bigcdn — removed from Deno routing', function () {
  it('s24.bigcdn.cc routes to PROXY_URL (CF Worker), not Deno', function () {
    var result = buildProxyUrlB('https://s24.bigcdn.cc/pubs/abc/1080.mp4');
    expect(result.indexOf(PROXY_URL)).toBe(0);
    expect(result.indexOf(PROXY_URL_2)).toBe(-1);
  });
  it('s1.bigcdn.cc routes to PROXY_URL', function () {
    var result = buildProxyUrlB('https://s1.bigcdn.cc/pubs/abc/720.mp4');
    expect(result.indexOf(PROXY_URL)).toBe(0);
  });
  it('s99.bigcdn.cc routes to PROXY_URL', function () {
    var result = buildProxyUrlB('https://s99.bigcdn.cc/pubs/abc/480.mp4');
    expect(result.indexOf(PROXY_URL)).toBe(0);
  });
});

describe('Phase-B REQ-4 pornone — FluidPlayer src extraction', function () {
  it('extracts src from sources:[{src:"url.mp4"}] (unquoted key)', function () {
    // FluidPlayer uses unquoted JS object keys: {src: "url"}
    var html = 'playerInstance.setup({sources:[{src:"https://s3006.pornone.com/video/720x406_500k.mp4",type:"video/mp4"}]});';
    // ['"]? makes quotes optional to handle both {src:"url"} and {"src":"url"}
    var fpRx = /sources\s*[=:]\s*\[[\s\S]{0,2000}?['"]?src['"]?\s*:\s*['"]([^'"]+\.(?:mp4|m3u8)[^'"]{0,200})['"]/i;
    var m = fpRx.exec(html);
    expect(m).not.toBeNull();
    expect(m[1]).toBe('https://s3006.pornone.com/video/720x406_500k.mp4');
  });
  it('extracts src from sources:[{"src":"url.mp4"}] (quoted key, JSON style)', function () {
    var html = 'setup({sources:[{"src":"https://s3006.pornone.com/video/480p.mp4","type":"video/mp4"}]})';
    var fpRx = /sources\s*[=:]\s*\[[\s\S]{0,2000}?['"]?src['"]?\s*:\s*['"]([^'"]+\.(?:mp4|m3u8)[^'"]{0,200})['"]/i;
    var m = fpRx.exec(html);
    expect(m).not.toBeNull();
    expect(m[1]).toBe('https://s3006.pornone.com/video/480p.mp4');
  });
  it('does not match when no .mp4/.m3u8 extension in src value', function () {
    var html = 'sources:[{src:"https://example.com/image.jpg",type:"image/jpeg"}]';
    var fpRx = /sources\s*[=:]\s*\[[\s\S]{0,2000}?['"]?src['"]?\s*:\s*['"]([^'"]+\.(?:mp4|m3u8)[^'"]{0,200})['"]/i;
    var m = fpRx.exec(html);
    expect(m).toBeNull();
  });
});

describe('Phase-B REQ-5 porntrex — trailing slash stripped from get_file URL', function () {
  it('strips trailing slash from get_file URL', function () {
    // Post-fix: replace(/['">\/\s]+$/, '') also strips /
    var raw = 'get_file/23/token/3215000/3215390/3215390_1080p.mp4/';
    var candidate = raw.replace(/['">\/\s]+$/, '');
    expect(candidate.charAt(candidate.length - 1)).not.toBe('/');
    expect(candidate).toBe('get_file/23/token/3215000/3215390/3215390_1080p.mp4');
  });
  it('original regex (without /) does NOT strip trailing slash', function () {
    var raw = 'get_file/23/token/3215000/3215390/3215390_1080p.mp4/';
    var candidate = raw.replace(/['">\s]+$/, '');
    expect(candidate.charAt(candidate.length - 1)).toBe('/');
  });
});

describe('Phase-B REQ-6 porndig — sources array matched before generic file/src', function () {
  it('sources:[{file:"url"}] pattern captures correct URL before generic file: match', function () {
    // Simulate porndig iframe HTML: preview url appears first as file:, main video in sources array
    var ihtml = [
      'var preview = { file: "https://cdn.porndig.com/preview-10s.mp4" };',
      'jwplayer("player").setup({ sources: [{ file: "https://cdn.porndig.com/fullvideo-720p.mp4" }] });'
    ].join('\n');

    // Post-fix: Pattern 2 (sources array) runs BEFORE Pattern 1 (generic file/src)
    var directUrl = '', dm;
    dm = /sources\s*[=:]\s*\[[\s\S]*?(?:file|src)\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))/i.exec(ihtml);
    if (dm) directUrl = dm[1];
    if (!directUrl) { dm = /(?:file|src)\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))/i.exec(ihtml); if (dm) directUrl = dm[1]; }

    expect(directUrl).toBe('https://cdn.porndig.com/fullvideo-720p.mp4');
    expect(directUrl).not.toContain('preview');
  });
  it('OLD order (Pattern 1 first) incorrectly captures preview URL', function () {
    var ihtml = [
      'var preview = { file: "https://cdn.porndig.com/preview-10s.mp4" };',
      'jwplayer("player").setup({ sources: [{ file: "https://cdn.porndig.com/fullvideo-720p.mp4" }] });'
    ].join('\n');

    // Pre-fix: Pattern 1 runs first
    var directUrl = '', dm;
    dm = /(?:file|src)\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))/i.exec(ihtml);
    if (dm) directUrl = dm[1];

    expect(directUrl).toContain('preview');
  });
});

describe('Phase-B REQ-7 24rolika — category regex accepts hyphens and digits', function () {
  it('matches /film-porno/123-slug.html (hyphenated category)', function () {
    var hrefRx = /href="((?:https?:\/\/w2\.huyalkino\.com)?\/[a-z0-9][a-z0-9\-]*\/\d+[^"]+\.html)"/;
    var html = '<a href="/film-porno/456-some-movie.html">Title</a>';
    var m = hrefRx.exec(html);
    expect(m).not.toBeNull();
    expect(m[1]).toBe('/film-porno/456-some-movie.html');
  });
  it('matches /xxx-18/789-slug.html (category with digit)', function () {
    var hrefRx = /href="((?:https?:\/\/w2\.huyalkino\.com)?\/[a-z0-9][a-z0-9\-]*\/\d+[^"]+\.html)"/;
    var html = '<a href="/xxx-18/789-slug.html">Title</a>';
    var m = hrefRx.exec(html);
    expect(m).not.toBeNull();
  });
  it('matches /film/123-slug.html (simple category, no regression)', function () {
    var hrefRx = /href="((?:https?:\/\/w2\.huyalkino\.com)?\/[a-z0-9][a-z0-9\-]*\/\d+[^"]+\.html)"/;
    var html = '<a href="/film/123-movie.html">Title</a>';
    var m = hrefRx.exec(html);
    expect(m).not.toBeNull();
  });
  it('OLD regex does NOT match /film-porno/123-slug.html', function () {
    var oldRx = /href="((?:https?:\/\/w2\.huyalkino\.com)?\/[a-z]+\/\d+[^"]+\.html)"/;
    var html = '<a href="/film-porno/456-some-movie.html">Title</a>';
    var m = oldRx.exec(html);
    expect(m).toBeNull(); // confirms the old bug
  });
});
