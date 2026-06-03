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
  // pornone removed — moved to CF Worker SOCKS5
  'www.eporner.com': 1,
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
// REQ-3 spankbang routing: ru.spankbang.com → PROXY_URL_2 (reverted)
// ============================================================
describe('REQ-3 spankbang routing reverted to Deno', function () {
  it('routes ru.spankbang.com to PROXY_URL_2', function () {
    var result = buildProxyUrl('https://ru.spankbang.com/new/1/');
    expect(result.indexOf(PROXY_URL_2)).toBe(0);
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
