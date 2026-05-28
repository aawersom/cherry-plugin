/**
 * Tests for Cherry plugin pure helper functions.
 * Functions are defined inline here since plugin.js is a browser IIFE.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---- parseDur ---------------------------------------------------------------
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
function parseViews(str) {
  if (!str) return 0;
  str = ('' + str).replace(/[,\s]/g, '');
  if (/k$/i.test(str)) return parseInt(str) * 1000;
  if (/m$/i.test(str)) return parseInt(str) * 1000000;
  return parseInt(str, 10) || 0;
}

// ---- bestQualityUrl ---------------------------------------------------------
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

// ---- extractStreams ----------------------------------------------------------
function extractStreams(html) {
  var quality = {};
  var url = '';
  var m;
  // KVS get_file pattern
  var kvs = html.match(/https?:\/\/[^"'\s]+get_file[^"'\s]+\.mp4[^"'\s]*/g);
  if (kvs) kvs.forEach(function(u) { var q = (u.match(/(\d{3,4}p)/i) || ['', 'mp4'])[1]; quality[q] = u; });
  // Source tags with res/label/title attribute (both orders)
  var srcRe = /<source\s[^>]*src="([^"]+)"[^>]*(?:res|label|title)="([^"]+)"/gi;
  while ((m = srcRe.exec(html)) !== null) quality[m[2]] = m[1];
  var srcRe2 = /<source\s[^>]*(?:res|label|title)="([^"]+)"[^>]*src="([^"]+)"/gi;
  while ((m = srcRe2.exec(html)) !== null) quality[m[1]] = m[2];
  // JWPlayer sources:[...] array multi-quality branch
  function findMatchingBracket(str, openIdx, openCh, closeCh) {
    var depth = 0, inStr = false, strCh = '';
    for (var i = openIdx; i < str.length; i++) {
      var c = str[i];
      if (inStr) {
        if (c === strCh) {
          var bs = 0;
          for (var j = i - 1; j >= 0 && str[j] === '\\'; j--) bs++;
          if (bs % 2 === 0) inStr = false;
        }
        continue;
      }
      if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
      if (c === openCh || c === '{' || c === '[') { depth++; continue; }
      if (c === closeCh || c === '}' || c === ']') {
        if (--depth === 0) return i;
      }
    }
    return -1;
  }
  var srcArrayM = /sources\s*:\s*\[/i.exec(html);
  if (srcArrayM) {
    var arrOpen = html.indexOf('[', srcArrayM.index + srcArrayM[0].length - 1);
    if (arrOpen !== -1) {
      var arrClose = findMatchingBracket(html, arrOpen, '[', ']');
      if (arrClose !== -1) {
        var block = html.slice(arrOpen + 1, arrClose);
        var fileRe2  = /['"]file['"]\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))['"]/i;
        var labelRe2 = /['"]label['"]\s*:\s*['"]([^'"]+)['"]/i;
        var bi = 0;
        while (bi < block.length) {
          var objStart = block.indexOf('{', bi);
          if (objStart === -1) break;
          var objEnd = findMatchingBracket(block, objStart, '{', '}');
          if (objEnd === -1) break;
          var obj = block.slice(objStart, objEnd + 1);
          var fm2 = fileRe2.exec(obj);
          var lm2 = labelRe2.exec(obj);
          if (fm2 && lm2 && !quality[lm2[1]]) quality[lm2[1]] = fm2[1];
          bi = objEnd + 1;
        }
      }
    }
  }
  // JWPlayer / generic file
  var jwRe = /['"]file['"]\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))['"]/g;
  while ((m = jwRe.exec(html)) !== null) { if (!url) url = m[1]; }
  // Plain source tags
  var plainRe = /<source\s[^>]*src="([^"]+\.(?:mp4|m3u8)[^"']*)"/gi;
  while ((m = plainRe.exec(html)) !== null) { if (!url) url = m[1]; }
  // Fallback: find any mp4 URL (http/https or protocol-relative)
  if (!url && !Object.keys(quality).length) {
    var any = html.match(/(?:https?:)?\/\/[^"'\s]+\.mp4[^"'\s]*/);
    if (any) url = any[0];
  }
  if (!url && Object.keys(quality).length) url = quality[Object.keys(quality)[0]];
  // Normalize protocol-relative URLs to https://
  function fixProto(u) { return (u && u.slice(0, 2) === '//') ? 'https:' + u : u; }
  url = fixProto(url);
  Object.keys(quality).forEach(function(k) { quality[k] = fixProto(quality[k]); });
  return { url: url, quality: quality };
}

// ---- _kvsPickBest -----------------------------------------------------------
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

// =============================================================================

describe('parseDur', () => {
  it('returns 0 for null/empty', () => {
    expect(parseDur(null)).toBe(0);
    expect(parseDur('')).toBe(0);
    expect(parseDur(undefined)).toBe(0);
  });

  it('parses bare seconds', () => {
    expect(parseDur('120')).toBe(120);
  });

  it('parses MM:SS', () => {
    expect(parseDur('12:34')).toBe(754);
  });

  it('parses HH:MM:SS', () => {
    expect(parseDur('1:02:03')).toBe(3723);
  });

  it('handles leading zeros', () => {
    expect(parseDur('01:05')).toBe(65);
  });
});

describe('parseViews', () => {
  it('returns 0 for empty', () => {
    expect(parseViews(null)).toBe(0);
    expect(parseViews('')).toBe(0);
  });

  it('parses plain numbers', () => {
    expect(parseViews('12345')).toBe(12345);
  });

  it('parses numbers with commas', () => {
    expect(parseViews('1,234,567')).toBe(1234567);
  });

  it('parses K suffix (case-insensitive)', () => {
    expect(parseViews('12k')).toBe(12000);
    expect(parseViews('5K')).toBe(5000);
  });

  it('parses M suffix', () => {
    expect(parseViews('3m')).toBe(3000000);
    expect(parseViews('1M')).toBe(1000000);
  });
});

describe('bestQualityUrl', () => {
  it('returns empty string for empty/null quality', () => {
    expect(bestQualityUrl(null)).toBe('');
    expect(bestQualityUrl({})).toBe('');
  });

  it('picks highest numeric resolution', () => {
    const q = { '360': 'url-360', '720': 'url-720', '480': 'url-480' };
    expect(bestQualityUrl(q)).toBe('url-720');
  });

  it('falls back to first key when no numeric labels', () => {
    const q = { 'hd': 'url-hd', 'sd': 'url-sd' };
    // All parse to 0, so bestUrl stays '', fallback is quality[keys[0]]
    expect(bestQualityUrl(q)).toBe('url-hd');
  });

  it('handles 1080 > 720', () => {
    const q = { '720': 'url-720', '1080': 'url-1080' };
    expect(bestQualityUrl(q)).toBe('url-1080');
  });

  it('treats 4k as integer prefix 4 via parseInt — 1080p wins', () => {
    const q = { '720p': 'url-720', '4k': 'url-4k', '1080p': 'url-1080' };
    expect(bestQualityUrl(q)).toBe('url-1080');
  });

  it('parses integer prefix of keys with p-suffix', () => {
    const q = { '1080p': 'url-1080', '720p': 'url-720' };
    expect(bestQualityUrl(q)).toBe('url-1080');
  });

  it('falls back to first key for single non-numeric label', () => {
    const q = { 'hd': 'url-hd' };
    expect(bestQualityUrl(q)).toBe('url-hd');
  });

  it('picks numeric key over non-numeric label in mixed map', () => {
    const q = { 'hd': 'url-hd', '720': 'url-720' };
    expect(bestQualityUrl(q)).toBe('url-720');
  });
});

describe('extractStreams', () => {
  it('returns empty for empty HTML', () => {
    const r = extractStreams('');
    expect(r.url).toBe('');
    expect(r.quality).toEqual({});
  });

  it('extracts KVS get_file MP4 URL', () => {
    const html = 'var link="https://cdn.example.com/get_file/1/video_720p.mp4?s=x"';
    const r = extractStreams(html);
    expect(r.quality['720p']).toContain('get_file');
    expect(r.url).toContain('get_file');
  });

  it('extracts source tags with label attribute', () => {
    const html = '<source src="https://cdn.example.com/video.mp4" label="720p">';
    const r = extractStreams(html);
    expect(r.quality['720p']).toBe('https://cdn.example.com/video.mp4');
  });

  it('extracts source tags with res attribute (reversed order)', () => {
    const html = '<source res="480p" src="https://cdn.example.com/480.mp4">';
    const r = extractStreams(html);
    expect(r.quality['480p']).toBe('https://cdn.example.com/480.mp4');
  });

  it('extracts JWPlayer file field', () => {
    const html = `jwplayer('player').setup({"file":"https://cdn.example.com/video.mp4"})`;
    const r = extractStreams(html);
    expect(r.url).toBe('https://cdn.example.com/video.mp4');
  });

  it('falls back to any mp4 URL in HTML', () => {
    const html = '<video poster="https://cdn.example.com/poster.jpg" src="https://cdn.example.com/video.mp4"></video>';
    const r = extractStreams(html);
    expect(r.url).toBe('https://cdn.example.com/video.mp4');
  });

  it('prefers quality dict URL over bare url field', () => {
    const html = '<source res="720p" src="https://cdn.example.com/720.mp4">';
    const r = extractStreams(html);
    // quality has '720p', url should point to first quality entry
    expect(r.url).toContain('720.mp4');
    expect(r.quality['720p']).toBe('https://cdn.example.com/720.mp4');
  });
});

describe('_kvsPickBest', () => {
  it('returns empty for empty list', () => {
    const r = _kvsPickBest([]);
    expect(r.url).toBe('');
    expect(r.quality).toEqual({});
  });

  it('picks highest resolution from known labels', () => {
    const urls = [
      'https://cdn.example.com/video_480p.mp4',
      'https://cdn.example.com/video_1080p.mp4',
      'https://cdn.example.com/video_720p.mp4',
    ];
    const r = _kvsPickBest(urls);
    expect(r.url).toContain('1080p');
    expect(Object.keys(r.quality)).toHaveLength(3);
  });

  it('handles single URL without label', () => {
    const urls = ['https://cdn.example.com/video.mp4'];
    const r = _kvsPickBest(urls);
    expect(r.url).toContain('video.mp4');
    expect(r.quality['default']).toContain('video.mp4');
  });

  it('labels are case-normalized to lowercase', () => {
    const urls = ['https://cdn.example.com/video_720P.mp4'];
    const r = _kvsPickBest(urls);
    expect(r.quality['720p']).toBeDefined();
  });
});

// =============================================================================
// Group A — extractStreams sources-array branch
// =============================================================================

describe('extractStreams — sources array branch', () => {
  it('sources array: file-then-label, 3 qualities', () => {
    const html = `
      jwplayer('p').setup({
        sources: [
          {"file":"https://cdn.example.com/1080.mp4","label":"1080p"},
          {"file":"https://cdn.example.com/720.mp4","label":"720p"},
          {"file":"https://cdn.example.com/480.mp4","label":"480p"}
        ]
      });
    `;
    const r = extractStreams(html);
    expect(Object.keys(r.quality).length).toBe(3);
    expect(r.quality['1080p']).toBe('https://cdn.example.com/1080.mp4');
    expect(r.quality['720p']).toBe('https://cdn.example.com/720.mp4');
    expect(r.quality['480p']).toBe('https://cdn.example.com/480.mp4');
  });

  it('sources array: label-then-file, 2 qualities', () => {
    const html = `
      jwplayer('p').setup({
        sources: [
          {"label":"1080p","file":"https://cdn.example.com/1080.mp4"},
          {"label":"720p","file":"https://cdn.example.com/720.mp4"}
        ]
      });
    `;
    const r = extractStreams(html);
    expect(Object.keys(r.quality).length).toBe(2);
    expect(r.quality['1080p']).toBe('https://cdn.example.com/1080.mp4');
    expect(r.quality['720p']).toBe('https://cdn.example.com/720.mp4');
  });

  it('sources array: legacy single file no array — back-compat jwRe branch fires', () => {
    // HTML has "file": "video.mp4" but NO sources array — existing jwRe branch handles it
    const html = `jwplayer('p').setup({"file":"http://cdn.example.com/video.mp4"})`;
    const r = extractStreams(html);
    expect(r.quality).toEqual({});
    expect(r.url).toBe('http://cdn.example.com/video.mp4');
  });

  it('sources array: mixed sources array and standalone source tag', () => {
    // Both a sources array AND a <source src="..."> tag are present.
    // The sources-array branch should populate quality from the array.
    const html = `
      <source src="https://cdn.example.com/fallback.mp4">
      var cfg = {
        sources: [
          {"file":"https://cdn.example.com/1080.mp4","label":"1080p"},
          {"file":"https://cdn.example.com/720.mp4","label":"720p"}
        ]
      };
    `;
    const r = extractStreams(html);
    expect(Object.keys(r.quality).length).toBeGreaterThanOrEqual(2);
    expect(r.quality['1080p']).toBe('https://cdn.example.com/1080.mp4');
    expect(r.quality['720p']).toBe('https://cdn.example.com/720.mp4');
  });

  it('sources array: source object with nested drm:{}', () => {
    // A source object has a nested drm:{} sub-object; the bracket scanner
    // must not be confused by the nested braces.
    const html = `
      var cfg = {
        sources: [
          {"file":"https://cdn.example.com/1080.mp4","label":"1080p","drm":{}},
          {"file":"https://cdn.example.com/720.mp4","label":"720p","drm":{}}
        ]
      };
    `;
    const r = extractStreams(html);
    expect(Object.keys(r.quality).length).toBe(2);
    expect(r.quality['1080p']).toBe('https://cdn.example.com/1080.mp4');
    expect(r.quality['720p']).toBe('https://cdn.example.com/720.mp4');
  });

  it('sources array: duplicate label — first wins', () => {
    // Two objects share label "720p"; only the first URL should appear.
    const html = `
      var cfg = {
        sources: [
          {"file":"https://cdn.example.com/first-720.mp4","label":"720p"},
          {"file":"https://cdn.example.com/second-720.mp4","label":"720p"}
        ]
      };
    `;
    const r = extractStreams(html);
    expect(r.quality['720p']).toBe('https://cdn.example.com/first-720.mp4');
  });

  it('sources array: source object missing label — not added to quality map', () => {
    // Object has file but no label — must not appear in quality.
    const html = `
      var cfg = {
        sources: [
          {"file":"https://cdn.example.com/video.mp4"}
        ]
      };
    `;
    const r = extractStreams(html);
    // quality must be empty (no label → no entry)
    expect(Object.keys(r.quality).length).toBe(0);
  });

  it('sources array: escaped backslashes in file value', () => {
    // The file value uses JSON-style forward-slash escaping: "https:\\/\\/cdn..."
    // The closing quote after \\/ must NOT be treated as an escaped quote.
    // The extracted URL should be "https://cdn.example.com/video.mp4" (slashes normalised
    // or verbatim as captured by the regex — either way the quality key exists).
    const html = `
      var cfg = {
        sources: [
          {"file":"https:\\/\\/cdn.example.com\\/video.mp4","label":"720p"}
        ]
      };
    `;
    const r = extractStreams(html);
    // The file regex captures the value between the quotes; the label must be found.
    // Even if the URL contains the literal \\/ sequences, quality['720p'] must be set.
    expect(r.quality['720p']).toBeDefined();
  });

  it('url is set to first file from sources array even when quality map is populated', () => {
    const html = `<script>
jwplayer("player").setup({
  sources: [
    {"file":"https://cdn.example.com/1080.mp4","label":"1080p"},
    {"file":"https://cdn.example.com/720.mp4","label":"720p"}
  ]
});
</script>`;
    const r = extractStreams(html);
    // quality map is populated from sources-array branch
    expect(Object.keys(r.quality).length).toBe(2);
    // url is set by the jwRe loop (first file from the sources array)
    // This is spec-acceptable: callers should use bestQualityUrl(r.quality) for best quality
    expect(r.url).toBe('https://cdn.example.com/1080.mp4');
  });
});

// =============================================================================
// Group B — findMatchingBracket (RED tests — local copy for isolated testing)
// The production findMatchingBracket is LOCAL inside extractStreams.
// We declare an identical copy here for isolation testing.
// =============================================================================

describe('findMatchingBracket', () => {
  // Inline copy of findMatchingBracket — matches the implementation in phase-0 plan.
  // This function DOES NOT yet exist in the test's extractStreams copy, so the
  // extractStreams-sourced tests above are already RED.
  // This standalone copy lets us test the bracket scanner in isolation.
  function findMatchingBracket(str, openIdx, openCh, closeCh) {
    var depth = 0, inStr = false, strCh = '';
    for (var i = openIdx; i < str.length; i++) {
      var c = str[i];
      if (inStr) {
        if (c === strCh) {
          var bs = 0;
          for (var j = i - 1; j >= 0 && str[j] === '\\'; j--) bs++;
          if (bs % 2 === 0) inStr = false;
        }
        continue;
      }
      if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
      if (c === openCh || c === '{' || c === '[') { depth++; continue; }
      if (c === closeCh || c === '}' || c === ']') {
        if (--depth === 0) return i;
      }
    }
    return -1;
  }

  it('empty array []', () => {
    // openIdx=0, openCh='[', closeCh=']' → returns index of closing ']' = 1
    const result = findMatchingBracket('[]', 0, '[', ']');
    expect(result).toBe(1);
  });

  it('nested array [[]]', () => {
    // outer '[' at 0, inner '[' at 1, inner ']' at 2, outer ']' at 3 → returns 3
    const result = findMatchingBracket('[[]]', 0, '[', ']');
    expect(result).toBe(3);
  });

  it('object with nested drm {drm:{}}', () => {
    // outer '{' at 0, depth hits 0 at closing '}' at index 7
    const result = findMatchingBracket('{drm:{}}', 0, '{', '}');
    expect(result).toBe(7);
  });

  it('closing char inside string is not treated as bracket', () => {
    // '{"k":"]"}' — the ']' is inside a string, must not close anything.
    // Character positions (0-based):
    //  0  1  2  3  4  5  6  7  8
    //  {  "  k  "  :  "  ]  "  }
    // The outer '}' is at index 8; the ']' at index 6 is inside the string
    // and must be ignored. The scanner must track string state to pass this.
    const str = '{"k":"]"}';
    const result = findMatchingBracket(str, 0, '{', '}');
    expect(result).toBe(8);
  });
});

// =============================================================================
// Group C — px() PROXY_URL_2 guard
// Note: tests guard logic in isolation using synthetic copies. Production px() is a closure
// inside playVideo() and cannot be imported directly.
// =============================================================================

describe('px() PROXY_URL_2 guard', () => {
  var PROXY_URL_TEST = 'https://cherry-proxy.example.workers.dev';
  var PROXY_URL_2_TEST = 'https://cherry-proxy.example.deno.net';
  var PROXY_URL_2_HOSTS_TEST = { 'xnxx.com': 1 };

  function buildProxyUrlTest(url) {
    try {
      if (PROXY_URL_2_HOSTS_TEST[new URL(url).hostname]) {
        return PROXY_URL_2_TEST + '/proxy?url=' + encodeURIComponent(url);
      }
    } catch(e) {}
    return PROXY_URL_TEST + '/proxy?url=' + encodeURIComponent(url);
  }

  // Synthetic px WITHOUT the PROXY_URL_2 guard — documents the pre-fix bug
  function pxTestOld(u) {
    if (!u) return u;
    if (u.indexOf('blob:') === 0) return u;
    if (u.indexOf(PROXY_URL_TEST) === 0) return u;
    if (u.indexOf('//') === 0) u = 'https:' + u;
    return buildProxyUrlTest(u);
  }

  // Synthetic px WITH the PROXY_URL_2 guard — the correct production version
  function pxTestNew(u) {
    if (!u) return u;
    if (u.indexOf('blob:') === 0) return u;
    if (u.indexOf(PROXY_URL_TEST) === 0) return u;
    if (PROXY_URL_2_TEST && u.indexOf(PROXY_URL_2_TEST) === 0) return u;
    if (u.indexOf('//') === 0) u = 'https:' + u;
    return buildProxyUrlTest(u);
  }

  it('without guard: Deno URL is double-wrapped (documents the bug)', () => {
    var denoUrl = buildProxyUrlTest('https://xnxx.com/video/123');
    var result = pxTestOld(denoUrl);
    // Without the guard, pxTestOld re-wraps the already-proxied URL
    expect(result.includes('proxy?url=')).toBe(true);
    expect(result).not.toBe(denoUrl);
  });

  it('with guard: Deno URL returned unchanged (guard works)', () => {
    var denoUrl = buildProxyUrlTest('https://xnxx.com/video/123');
    var result = pxTestNew(denoUrl);
    expect(result).toBe(denoUrl);
  });
});

// =============================================================================
// Phase 1 — quality map fixes
// =============================================================================

// Helper: given fixture HTML, run extractStreams and pick best quality URL
function qualityFromHtml(html) {
  var result = extractStreams(html);
  if (result.url || Object.keys(result.quality).length) {
    var qKeys = Object.keys(result.quality);
    var best  = qKeys.length ? bestQualityUrl(result.quality) : result.url;
    return { url: best, quality: result.quality };
  }
  return { url: '', quality: {} };
}

// Inline lenporno parsing logic — exact copy of the pjRe while-loop from plugin.js
// (current version WITHOUT the numeric guard — so tests 3 and 4 fail before the fix)
function lenpornoParseCurrent(pjStr) {
  var quality = {};
  var best = '';
  var pjRe = /(?:\[([^\]]+)\])?(https?:\/\/[^,\[\]<>\s"']+\.mp4)/gi;
  var m;
  while ((m = pjRe.exec(pjStr)) !== null) {
    var lbl = m[1] || (/[_-](\d+p)/i.exec(m[2]) || ['', 'mp4'])[1];
    quality[lbl] = m[2];
    if (!best) best = m[2];
  }
  return { url: bestQualityUrl(quality) || best, quality: quality };
}

// Fixed version — adds the /^\d{3,4}p?$/i guard per REQ-3c
function lenpornoParseFixed(pjStr) {
  var quality = {};
  var best = '';
  var pjRe = /(?:\[([^\]]+)\])?(https?:\/\/[^,\[\]<>\s"']+\.mp4)/gi;
  var m;
  while ((m = pjRe.exec(pjStr)) !== null) {
    var lbl = m[1] ? m[1].trim() : null;
    if (lbl && /^\d{3,4}p?$/i.test(lbl)) {
      quality[lbl] = m[2];
      if (!best) best = m[2];
    } else {
      if (!best) best = m[2];
    }
  }
  return { url: bestQualityUrl(quality) || best, quality: quality };
}

// ---- validateStreamReachable (inline mirror with injectable fetch) ----------
function makeValidateStream(fetchFn) {
  function isVideoContentType(ct) {
    if (!ct) return false;
    return ct.startsWith('video/') || ct.startsWith('audio/') ||
           ct.includes('mpegurl') || ct.includes('octet-stream');
  }
  async function tryOnce(proxied) {
    let r;
    try {
      r = await fetchFn(proxied, { method: 'HEAD' });
    } catch(e) {
      return { ok: false, reason: `fetch-error:${e.message}`, contentType: null, status: null, retryable: true };
    }
    if (r.status >= 500) return { ok: false, reason: `http-${r.status}`, contentType: '', status: r.status, retryable: true };
    if (r.status === 405 || r.status === 501) {
      try {
        const g = await fetchFn(proxied, { headers: { 'Range': 'bytes=0-1023' } });
        const ct = g.headers.get('content-type') || '';
        if (g.status !== 200 && g.status !== 206) return { ok: false, reason: `http-${g.status}`, contentType: ct, status: g.status, retryable: false };
        const ctOk = isVideoContentType(ct);
        return { ok: ctOk, contentType: ct, status: g.status, reason: ctOk ? null : `content-type:${ct}`, retryable: false };
      } catch(e) {
        return { ok: false, reason: `fetch-error:${e.message}`, contentType: null, status: null, retryable: true };
      }
    }
    const ct = r.headers.get('content-type') || '';
    if (r.status !== 200 && r.status !== 206) return { ok: false, reason: `http-${r.status}`, contentType: ct, status: r.status, retryable: false };
    const ctOk = isVideoContentType(ct);
    return { ok: ctOk, contentType: ct, status: r.status, reason: ctOk ? null : `content-type:${ct}`, retryable: false };
  }
  return async function validateStreamReachable(streamResult) {
    const url = streamResult && (streamResult.url || '');
    if (!url) return { ok: false, reason: 'empty-url', contentType: null, status: null };
    if (url.startsWith('blob:')) return { ok: true, reason: null, contentType: 'blob', status: null };
    const result = await tryOnce(url);
    const { retryable: _, ...final } = result;
    return final;
  };
}

function mockFetch(status, contentType, method2Override) {
  return async (url, opts) => {
    const isGet = opts && opts.headers && opts.headers['Range'];
    const effectiveStatus = (isGet && method2Override) ? method2Override.status : status;
    const effectiveCt = (isGet && method2Override) ? method2Override.contentType : contentType;
    return { status: effectiveStatus, headers: { get: (h) => h === 'content-type' ? effectiveCt : null } };
  };
}

describe('Phase 6 — validateStreamReachable unit tests', () => {
  it('200 + video/mp4 → ok:true', async () => {
    const validate = makeValidateStream(mockFetch(200, 'video/mp4'));
    const r = await validate({ url: 'https://cdn.example.com/video.mp4' });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.contentType).toBe('video/mp4');
  });

  it('200 + text/html → ok:false, reason content-type:text/html', async () => {
    const validate = makeValidateStream(mockFetch(200, 'text/html'));
    const r = await validate({ url: 'https://cdn.example.com/video.mp4' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('content-type:text/html');
  });

  it('403 → ok:false, reason http-403', async () => {
    const validate = makeValidateStream(mockFetch(403, ''));
    const r = await validate({ url: 'https://cdn.example.com/video.mp4' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('http-403');
  });

  it('206 + video/mp4 → ok:true', async () => {
    const validate = makeValidateStream(mockFetch(206, 'video/mp4'));
    const r = await validate({ url: 'https://cdn.example.com/video.mp4' });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(206);
  });

  it('405 → ranged GET → 200 + application/vnd.apple.mpegurl → ok:true', async () => {
    const validate = makeValidateStream(mockFetch(405, '', { status: 200, contentType: 'application/vnd.apple.mpegurl' }));
    const r = await validate({ url: 'https://cdn.example.com/master.m3u8' });
    expect(r.ok).toBe(true);
    expect(r.contentType).toBe('application/vnd.apple.mpegurl');
  });

  it('network error → ok:false, reason starts with fetch-error:', async () => {
    const errFetch = async () => { throw new Error('connection reset'); };
    const validate = makeValidateStream(errFetch);
    const r = await validate({ url: 'https://cdn.example.com/video.mp4' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/^fetch-error:/);
  });

  it('empty url → ok:false, reason empty-url', async () => {
    const validate = makeValidateStream(mockFetch(200, 'video/mp4'));
    const r = await validate({ url: '' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('empty-url');
  });

  it('PROXY_URL_2_HOSTS: plugin.js and E2E test have identical host sets', () => {
    const pluginSrc = readFileSync(join(__dirname, '..', 'plugin.js'), 'utf8');
    const pluginM = pluginSrc.match(/PROXY_URL_2_HOSTS\s*=\s*\{([^}]+)\}/);
    expect(pluginM).toBeTruthy();
    const pluginHosts = new Set([...pluginM[1].matchAll(/['"]([^'"]+)['"]\s*:/g)].map(x => x[1]));

    const e2eSrc = readFileSync(join(__dirname, 'cherry-lampa-e2e.mjs'), 'utf8');
    const e2eM = e2eSrc.match(/PROXY_URL_2_HOSTS\s*=\s*\{([^}]+)\}/);
    expect(e2eM).toBeTruthy();
    const e2eHosts = new Set([...e2eM[1].matchAll(/['"]([^'"]+)['"]\s*:/g)].map(x => x[1]));

    expect(e2eHosts).toEqual(pluginHosts);
  });
});

// ---- epornerHashComputed (pure helper) -------------------------------------
function epornerHashComputed(raw) {
  return [raw.slice(0,8), raw.slice(8,16), raw.slice(16,24), raw.slice(24,32)]
    .map(function(c) { return parseInt(c, 16).toString(36); }).join('');
}

// ---- epornerParseSources (pure helper) -------------------------------------
function epornerParseSources(sourcesObj) {
  var mp4 = sourcesObj && sourcesObj.mp4;
  if (!mp4) return { url: '', quality: {} };
  var quality = {};
  Object.keys(mp4).forEach(function(lbl) {
    if (mp4[lbl] && mp4[lbl].src) quality[lbl] = mp4[lbl].src;
  });
  return { url: bestQualityUrl(quality), quality: quality };
}

describe('Phase 4 — eporner XHR API', () => {
  const HASH_RE = /(?:EHH|hash)\s*[=:]\s*['"]([0-9a-f]{32})['"]/i;

  it('fixture: EHH variable extracted by regex', () => {
    const html = readFileSync(join(__dirname, 'fixtures', 'eporner-page.html'), 'utf8');
    const m = HASH_RE.exec(html);
    expect(m).toBeTruthy();
    expect(m[1]).toBe('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
  });

  it('hash computation: 4 chunks each parseInt(hex,16).toString(36)', () => {
    const raw = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    const computed = epornerHashComputed(raw);
    // Non-empty, lowercase alphanumeric base-36 result
    expect(computed).toBeTruthy();
    expect(computed).not.toBe(raw);
    expect(/^[0-9a-z]+$/.test(computed)).toBe(true);
    // Deterministic: same input always produces same output
    expect(computed).toBe(epornerHashComputed(raw));
    // First chunk: a1b2c3d4 (hex) → base36
    const firstChunk = parseInt('a1b2c3d4', 16).toString(36);
    expect(computed.startsWith(firstChunk)).toBe(true);
  });

  it('sources.mp4 parsing: builds quality map and picks best', () => {
    const sources = {
      mp4: {
        '1080p': { src: 'https://ep.cdn.com/1080.mp4', type: 'video/mp4', default: false },
        '720p':  { src: 'https://ep.cdn.com/720.mp4',  type: 'video/mp4', default: true  },
        '480p':  { src: 'https://ep.cdn.com/480.mp4',  type: 'video/mp4', default: false }
      }
    };
    const r = epornerParseSources(sources);
    expect(r.quality['1080p']).toBe('https://ep.cdn.com/1080.mp4');
    expect(r.quality['720p']).toBe('https://ep.cdn.com/720.mp4');
    expect(r.url).toBe('https://ep.cdn.com/1080.mp4');
  });

  it('sources.mp4 parsing: missing sources → empty result', () => {
    const r = epornerParseSources(null);
    expect(r.url).toBe('');
    expect(Object.keys(r.quality).length).toBe(0);
  });
});

describe('Phase 3 — tizam / huyamba / perfektdamen / 24rolika parser fixes', () => {
  it('tizam: extractStreams finds data-res quality map and picks 720p', () => {
    const html = readFileSync(join(__dirname, 'fixtures', 'tizam-page.html'), 'utf8');
    const r = extractStreams(html);
    expect(r.quality['720']).toMatch(/video\d*\.tizam\.cc.*\.mp4/);
    expect(r.quality['480']).toMatch(/video\d*\.tizam\.cc.*\.mp4/);
    expect(bestQualityUrl(r.quality)).toBe(r.quality['720']);
  });

  it('tizam: extractStreams url is non-empty', () => {
    const html = readFileSync(join(__dirname, 'fixtures', 'tizam-page.html'), 'utf8');
    const r = extractStreams(html);
    expect(r.url).toBeTruthy();
    expect(r.url).toMatch(/\.mp4$/);
  });

  it('huyamba: extractStreams preserves ?v-acctoken= in URL (KVS branch)', () => {
    const html = readFileSync(join(__dirname, 'fixtures', 'huyamba-page.html'), 'utf8');
    const r = extractStreams(html);
    expect(r.url).toBeTruthy();
    expect(r.url).toContain('get_file');
    expect(r.url).toContain('v-acctoken=');
  });

  it('huyamba: extractStreams url starts with https://fuq.huyamba.mobi/', () => {
    const html = readFileSync(join(__dirname, 'fixtures', 'huyamba-page.html'), 'utf8');
    const r = extractStreams(html);
    expect(r.url).toMatch(/^https:\/\/fuq\.huyamba\.mobi\//);
  });

  it('perfektdamen: extractStreams returns 720p as best quality', () => {
    const html = readFileSync(join(__dirname, 'fixtures', 'perfektdamen-page.html'), 'utf8');
    const r = extractStreams(html);
    expect(r.quality['720p']).toMatch(/get_file.*720p/);
    expect(bestQualityUrl(r.quality)).toBe(r.quality['720p']);
  });

  it('perfektdamen: quality map has numeric keys (360p, 720p)', () => {
    const html = readFileSync(join(__dirname, 'fixtures', 'perfektdamen-page.html'), 'utf8');
    const r = extractStreams(html);
    expect(r.quality['360p']).toBeDefined();
    expect(r.quality['720p']).toBeDefined();
  });

  it('24rolika: extractStreams finds PlayerJS file URL via jwRe', () => {
    const html = readFileSync(join(__dirname, 'fixtures', '24rolika-page.html'), 'utf8');
    const r = extractStreams(html);
    expect(r.url).toBeTruthy();
    expect(r.url).toMatch(/\.mp4$/);
  });
});

describe('Phase 1 — quality map fixes', () => {
  it('porndig: 3-quality iframe → url is highest quality', () => {
    const html = readFileSync(join(__dirname, 'fixtures', 'porndig-iframe.html'), 'utf8');
    const r = qualityFromHtml(html);
    expect(Object.keys(r.quality).length).toBe(3);
    expect(r.url).toBe('https://cdn.porndig.com/video/1080.mp4');
  });

  it('ebun: 2-quality iframe → url is highest quality', () => {
    const html = readFileSync(join(__dirname, 'fixtures', 'ebun-iframe.html'), 'utf8');
    const r = qualityFromHtml(html);
    expect(Object.keys(r.quality).length).toBe(2);
    expect(r.url).toBe('https://cdn.666-emded.com/video/720.mp4');
  });

  it('lenporno: labeled 720p + unlabeled URLs → quality has 720p key, no mp4 key', () => {
    // Tests the fixed lenporno parsing logic (REQ-3c numeric-label guard).
    // Was RED against the old code that inserted 'mp4' for unlabeled URLs.
    const pjStr = '[720p]https://cdn.lenporno.net/720.mp4,https://cdn.lenporno.net/unlabeled1.mp4,https://cdn.lenporno.net/unlabeled2.mp4';
    const r = lenpornoParseFixed(pjStr);
    expect(r.quality['mp4']).toBeUndefined();
    expect(r.quality['720p']).toBe('https://cdn.lenporno.net/720.mp4');
  });

  it('lenporno: all quality keys match /^\\d{3,4}p?$/i', () => {
    // Fixed: no non-numeric labels (like 'mp4') inserted into quality map.
    const pjStr = '[720p]https://cdn.lenporno.net/720.mp4,https://cdn.lenporno.net/unlabeled1.mp4,https://cdn.lenporno.net/unlabeled2.mp4';
    const r = lenpornoParseFixed(pjStr);
    const allNumeric = Object.keys(r.quality).every(function (k) {
      return /^\d{3,4}p?$/i.test(k);
    });
    expect(allNumeric).toBe(true);
  });

  it('lenporno: fixture file → fileM regex extracts pjStr → numeric guard applies', () => {
    const html = readFileSync(join(__dirname, 'fixtures', 'lenporno-player.html'), 'utf8');
    const fileMRe = /Playerjs\s*\([^)]*file\s*:\s*['"]([^'"]+\.mp4[^'"]*)['"]/i;
    const fileM = fileMRe.exec(html);
    expect(fileM).toBeTruthy();
    const r = lenpornoParseFixed(fileM[1]);
    expect(r.quality['720p']).toBe('https://cdn.lenporno.net/720.mp4');
    expect(r.quality['mp4']).toBeUndefined();
    expect(r.url).toBe('https://cdn.lenporno.net/720.mp4');
  });
});
