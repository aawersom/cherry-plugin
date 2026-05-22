/**
 * Tests for Cherry plugin pure helper functions.
 * Functions are defined inline here since plugin.js is a browser IIFE.
 */
import { describe, it, expect } from 'vitest';

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
  var kvs = html.match(/https?:\/\/[^"'\s]+get_file[^"'\s]+\.mp4[^"'\s]*/g);
  if (kvs) kvs.forEach(function(u) { var q = (u.match(/(\d{3,4}p)/i) || ['', 'mp4'])[1]; quality[q] = u; });
  var srcRe = /<source\s[^>]*src="([^"]+)"[^>]*(?:res|label)="([^"]+)"/gi;
  var m;
  while ((m = srcRe.exec(html)) !== null) quality[m[2]] = m[1];
  var srcRe2 = /<source\s[^>]*(?:res|label)="([^"]+)"[^>]*src="([^"]+)"/gi;
  while ((m = srcRe2.exec(html)) !== null) quality[m[1]] = m[2];
  var jwRe = /['"]file['"]\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))['"]/g;
  while ((m = jwRe.exec(html)) !== null) { if (!url) url = m[1]; }
  var plainRe = /<source\s[^>]*src="([^"]+\.(?:mp4|m3u8)[^"']*)"/gi;
  while ((m = plainRe.exec(html)) !== null) { if (!url) url = m[1]; }
  if (!url && !Object.keys(quality).length) {
    var any = html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/);
    if (any) url = any[0];
  }
  if (!url && Object.keys(quality).length) url = quality[Object.keys(quality)[0]];
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
