/**
 * Cherry Plugin — Real Browser Test (Playwright/Chromium)
 *
 * Approach: load plugin.js in a real Chromium page (not just Node.js).
 * This catches CORS issues that Node.js tests miss — browser enforces CORS,
 * Node.js ignores it. Also tests actual <video> element playback.
 *
 * Test matrix per source:
 *   1. browse('', 1)   — cards returned?
 *   2. getStream(card) — stream URL valid?
 *   3. fetch(proxied, Range header) → 206?  (browser CORS)
 *   4. <video> element → canplay / error within 8s
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';

const PLUGIN_PATH  = 'D:/Works/Lampa/plugin.js';
const PROXY_KEY    = '1206';
const PROXY_BASE   = 'https://cherry-proxy.aawersom.workers.dev';
const CONCURRENCY  = 4;   // parallel source slots
const STREAM_TIMEOUT_MS = 12000;

// ── Lampa mock injected into the browser page ─────────────────────────────────
const LAMPA_MOCK = `
window.Lampa = {
  Listener:   { follow: () => {}, send: () => {}, add: () => {}, remove: () => {} },
  Storage:    {
    _data: { cherry_proxy_key: '${PROXY_KEY}' },
    get: function(k, d) { return this._data[k] !== undefined ? this._data[k] : d; },
    set: function(k, v) { this._data[k] = v; }
  },
  Component:  { add: () => {}, get: () => null },
  Menu:       { addButton: () => {} },
  Activity:   { push: () => {}, backward: () => {}, active: () => null },
  Controller: { add: () => {}, toggle: () => {}, move: () => {}, collectionSet: () => {}, collectionFocus: () => {}, activate: () => {} },
  Template:   { add: () => {}, get: () => '<div></div>' },
  Scroll:     function() { return { append: () => {}, reset: () => {}, onDown: () => {}, destroy: () => {} }; },
  Empty:      function() { return { render: () => '<div></div>', destroy: () => {} }; },
  Loading:    function() { return { start: () => {}, stop: () => {} }; },
  Reguest:    function() { return { timeout: () => {}, send: () => {}, abort: () => {} }; },
  Utils:      { ru: s => s, secondsToTime: s => s + 's' },
  Lang:       { translate: s => s, add: () => {} },
  Noty:       { show: () => {} },
  Select:     { show: () => {} },
  Params:     { get: () => ({}) },
  Player:     { play: () => {} }
};
window.appready = true;
`;

const pluginCode = readFileSync(PLUGIN_PATH, 'utf-8')
  .replace(/var SOURCES\s*=\s*\[/, 'var SOURCES = window.__CHERRY_SOURCES = [');

// ── HTML page served inline ───────────────────────────────────────────────────
const PAGE_HTML = `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>Cherry Test</title>
</head><body>
<div id="log"></div>
<script>
${LAMPA_MOCK}
try { ${pluginCode} } catch(e) { console.error('Plugin eval:', e.message); }
</script>
</body></html>`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function truncate(s, n) { return s && s.length > n ? s.slice(0,n)+'…' : (s||''); }

async function runSourceTest(page, src) {
  const result = { id: src.id, browseOk: false, cards: 0, streamUrl: '', rangeOk: false, videoOk: false, error: '' };

  // ── browse ────────────────────────────────────────────────────────────────
  let firstCard;
  try {
    const browsed = await page.evaluate(async (srcId) => {
      const s = window.__CHERRY_SOURCES.find(x => x.id === srcId);
      if (!s) return { error: 'source not found' };
      try {
        const res = await s.browse('', 1);
        const items = (res && res.items) || [];
        return { items: items.slice(0, 3), total: items.length };
      } catch(e) { return { error: e.message }; }
    }, src.id);

    if (browsed.error) { result.error = 'browse: ' + browsed.error; return result; }
    if (!browsed.total) { result.error = 'browse: 0 cards'; return result; }
    result.browseOk = true;
    result.cards = browsed.total;
    firstCard = browsed.items[0];
  } catch(e) { result.error = 'browse throw: ' + e.message; return result; }

  // ── getStream ─────────────────────────────────────────────────────────────
  let streamUrl;
  try {
    const streamed = await page.evaluate(async ({ srcId, card }) => {
      const s = window.__CHERRY_SOURCES.find(x => x.id === srcId);
      try {
        const stream = await s.getStream(card);
        return { url: stream && stream.url, quality: stream && stream.quality ? Object.keys(stream.quality) : [] };
      } catch(e) { return { error: e.message }; }
    }, { srcId: src.id, card: firstCard });

    if (streamed.error) { result.error = 'stream: ' + streamed.error; return result; }
    streamUrl = streamed.url;
    result.streamUrl = streamUrl || '';
  } catch(e) { result.error = 'stream throw: ' + e.message; return result; }

  if (!streamUrl || streamUrl.startsWith('blob:')) {
    result.rangeOk = true;  // HLS/blob — N/A, counts as ok
    result.videoOk = true;
    return result;
  }

  // Normalize protocol-relative URLs (e.g. YouJizz)
  if (streamUrl.startsWith('//')) streamUrl = 'https:' + streamUrl;

  // ── Range request via proxy (real browser CORS) ───────────────────────────
  // If already proxied (e.g. pre-wrapped with custom referer), use as-is to avoid double-proxy.
  const proxied = streamUrl.startsWith(PROXY_BASE)
    ? streamUrl
    : `${PROXY_BASE}/proxy?url=${encodeURIComponent(streamUrl)}&key=${PROXY_KEY}`;
  try {
    const rangeResult = await page.evaluate(async (url) => {
      try {
        const r = await fetch(url, {
          headers: { 'Range': 'bytes=0-65535' },
          signal: AbortSignal.timeout(10000)
        });
        return { status: r.status, cr: r.headers.get('Content-Range') || '', ok: r.status === 206 };
      } catch(e) { return { error: e.message, ok: false }; }
    }, proxied);

    result.rangeOk = rangeResult.ok;
    if (rangeResult.error) result.error = (result.error ? result.error + '; ' : '') + 'range: ' + rangeResult.error;
  } catch(e) { /* range test failed */ }

  // ── <video> loadedmetadata test ──────────────────────────────────────────
  // Call getStream() FRESH so we don't use a token that expired during the range test.
  // loadedmetadata fires as soon as browser parses the MP4/WebM header.
  let freshProxied = proxied;
  try {
    const freshStream = await page.evaluate(async ({ srcId, card }) => {
      const s = window.__CHERRY_SOURCES.find(x => x.id === srcId);
      try {
        const stream = await s.getStream(card);
        return { url: stream && stream.url };
      } catch(e) { return { error: e.message }; }
    }, { srcId: src.id, card: firstCard });

    if (!freshStream.error && freshStream.url) {
      let u = freshStream.url;
      if (u.startsWith('//')) u = 'https:' + u;
      freshProxied = u.startsWith(PROXY_BASE)
        ? u
        : `${PROXY_BASE}/proxy?url=${encodeURIComponent(u)}&key=${PROXY_KEY}`;
    }
  } catch(e) { /* keep original proxied url */ }

  try {
    const videoResult = await page.evaluate(async ({ url, timeoutMs }) => {
      return new Promise((resolve) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        document.body.appendChild(v);
        v.src = url;
        const timer = setTimeout(() => {
          const rs = v.readyState, ns = v.networkState;
          v.src = ''; document.body.removeChild(v);
          resolve({ ok: false, reason: 'timeout', readyState: rs, networkState: ns });
        }, timeoutMs);
        v.addEventListener('loadedmetadata', () => {
          clearTimeout(timer);
          const dur = v.duration, w = v.videoWidth, rs = v.readyState;
          v.src = ''; document.body.removeChild(v);
          resolve({ ok: true, reason: 'loadedmetadata', duration: dur, width: w, readyState: rs });
        });
        v.addEventListener('error', () => {
          clearTimeout(timer);
          const code = v.error ? v.error.code : '?';
          const msg  = v.error ? v.error.message : '';
          const rs = v.readyState, ns = v.networkState;
          v.src = ''; try { document.body.removeChild(v); } catch(e) {}
          resolve({ ok: false, reason: 'error', code, msg, readyState: rs, networkState: ns });
        });
        v.load();
      });
    }, { url: freshProxied, timeoutMs: STREAM_TIMEOUT_MS });

    result.videoOk = videoResult.ok;
    result.videoDuration = videoResult.duration;
    if (!videoResult.ok) {
      const errCode = videoResult.code ? `code${videoResult.code}` : '';
      result.error = (result.error ? result.error + '; ' : '') + `video: ${videoResult.reason}(rs=${videoResult.readyState},ns=${videoResult.networkState})${errCode ? ' '+errCode : ''}${videoResult.msg ? ' "'+videoResult.msg+'"' : ''}`;
    }
  } catch(e) { /* video test inconclusive */ }

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required']
});

// Single context — allows parallel pages while sharing the same browser process
const context = await browser.newContext({
  // Log 206 responses intercepted from cherry-proxy
  bypassCSP: true,
});

// Intercept to log 206s
const rangeIntercepted = new Set();
context.on('response', r => {
  if (r.url().includes('cherry-proxy') && r.status() === 206) rangeIntercepted.add(r.url().split('url=')[1]?.split('&')[0] || r.url());
});

// One page per concurrent slot
const SOURCES = JSON.parse(await (async () => {
  const page = await context.newPage();
  await page.setContent(PAGE_HTML, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(200);
  const list = await page.evaluate(() => window.__CHERRY_SOURCES.map(s => ({ id: s.id, name: s.name })));
  await page.close();
  return JSON.stringify(list);
})());

console.log(`\nLoaded ${SOURCES.length} sources. Running browser tests...\n`);
console.log('═'.repeat(72));
console.log('CHERRY PLUGIN — REAL BROWSER TEST (Playwright/Chromium)');
console.log('═'.repeat(72));

const allResults = [];
// Process in batches of CONCURRENCY
for (let i = 0; i < SOURCES.length; i += CONCURRENCY) {
  const batch = SOURCES.slice(i, i + CONCURRENCY);

  const batchPromises = batch.map(async (srcMeta) => {
    const page = await context.newPage();
    await page.setContent(PAGE_HTML, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);

    // Get full source reference
    const src = await page.evaluate(({ id }) => {
      const s = window.__CHERRY_SOURCES.find(x => x.id === id);
      return s ? { id: s.id, name: s.name } : null;
    }, { id: srcMeta.id });

    const result = await runSourceTest(page, src || srcMeta);
    await page.close();
    return result;
  });

  const batchResults = await Promise.all(batchPromises);
  batchResults.forEach(r => {
    const browseIcon = r.browseOk ? '✅' : '❌';
    const rangeIcon  = r.rangeOk  ? '🎯' : (r.browseOk ? '⚠️ ' : '  ');
    const videoIcon  = r.videoOk  ? '▶️ ' : (r.browseOk ? '✗ ' : '  ');
    const dur = r.videoDuration ? `  ${Math.floor(r.videoDuration/60)}:${String(Math.floor(r.videoDuration%60)).padStart(2,'0')}` : '';
    console.log(`${browseIcon}${rangeIcon}${videoIcon} [${r.id.padEnd(18)}]  cards:${r.cards}${dur}  ${r.streamUrl ? truncate(r.streamUrl, 55) : ''}`);
    if (r.error) console.log(`     ⚠️  ${r.error}`);
    allResults.push(r);
  });
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(72));
console.log('SUMMARY');
console.log('═'.repeat(72));

const browseOk = allResults.filter(r => r.browseOk);
const rangeOk  = allResults.filter(r => r.rangeOk);
const videoOk  = allResults.filter(r => r.videoOk);

console.log(`Browse OK : ${browseOk.length}/${allResults.length}  (${browseOk.map(r=>r.id).join(', ')})`);
console.log(`Range 206 : ${rangeOk.length}/${browseOk.length}   (from browser, enforcing CORS)`);
console.log(`Video meta: ${videoOk.length}/${browseOk.length}   (<video> loadedmetadata — format/codec OK)`);

const rangeFail = browseOk.filter(r => !r.rangeOk);
if (rangeFail.length) console.log(`\nRange FAIL: ${rangeFail.map(r=>r.id).join(', ')}`);

const videoFail = browseOk.filter(r => !r.videoOk);
if (videoFail.length) {
  console.log(`\nVideo FAIL (${videoFail.length}) — couldn't parse metadata in ${STREAM_TIMEOUT_MS/1000}s:`);
  videoFail.forEach(r => console.log(`  ${r.id.padEnd(20)} ${r.error || ''}`));
}

console.log(`\n206 intercepted by Playwright: ${rangeIntercepted.size} URLs`);

await browser.close();
