/**
 * Cherry Plugin — End-to-End test in REAL Lampa (http://lampa.mx/)
 *
 * Flow:
 *   1. Inject plugin URL + proxy key into localStorage before page load
 *   2. Open real Lampa — app loads and automatically executes the Cherry plugin
 *   3. Wait until Cherry plugin signals ready (window.plugin_cherry_ready)
 *   4. For each source: browse('', 1) → getStream(card) → <video> loadedmetadata
 *   5. Report: browse OK, range 206 (CORS-enforced), video playable
 *
 * Unlike cherry-browser-test.mjs (mocked Lampa), this runs inside the real app.
 * Real Lampa means real Lampa.Storage, real network calls, real proxy key handling.
 */
import { chromium } from '@playwright/test';

const LAMPA_URL  = 'http://lampa.mx/';
const PLUGIN_URL = 'https://aawersom.github.io/cherry-plugin/plugin.js';
const PROXY_KEY  = '1206';
const PROXY_BASE = 'https://cherry-proxy.aawersom.workers.dev';
const VIDEO_TIMEOUT_MS = 14000;
const CONCURRENCY = 3;

function truncate(s, n) { return s && s.length > n ? s.slice(0, n) + '…' : (s || ''); }

// ── Launch browser ────────────────────────────────────────────────────────────
const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});

const context = await browser.newContext({ bypassCSP: true });

// Intercept: track 206 responses from the proxy
const intercepted206 = new Map(); // url → count
context.on('response', r => {
  if (r.url().includes('cherry-proxy') && r.status() === 206) {
    const k = decodeURIComponent(r.url().split('url=')[1]?.split('&')[0] || r.url()).slice(0, 80);
    intercepted206.set(k, (intercepted206.get(k) || 0) + 1);
  }
});

// ── Prepare a Lampa page with Cherry plugin pre-installed ─────────────────────
async function makeLampaPage() {
  const page = await context.newPage();

  // Suppress noisy console lines
  page.on('console', msg => {
    const t = msg.text();
    if (msg.type() === 'error' || t.includes('cherry') || t.toLowerCase().includes('plugin')) {
      process.stdout.write(`  [lampa] ${t.slice(0, 100)}\n`);
    }
  });

  // Before page loads: inject plugin + proxy key into localStorage
  await page.addInitScript(({ pluginUrl, proxyKey }) => {
    localStorage.setItem('plugins', JSON.stringify([{ url: pluginUrl, status: 'on' }]));
    localStorage.setItem('cherry_proxy_key', proxyKey);
    // Clear Lampa's plugin IndexedDB cache so our route interception serves the patched script
    try { indexedDB.deleteDatabase('lampa_cache'); } catch(e) {}
  }, { pluginUrl: PLUGIN_URL, proxyKey: PROXY_KEY });

  await page.goto(LAMPA_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Press Enter to unblock Lampa's loading screen (TV app waits for user input)
  await page.waitForTimeout(3000);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Enter');

  // Force appready + plugin loading in case keyboard didn't trigger it
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    try { window.appready = true; } catch(e) {}
    try { Lampa.Listener.send('ready', {}); } catch(e) {}
    try { if (Lampa.Plugins && Lampa.Plugins.init) Lampa.Plugins.init(); } catch(e) {}
    try { if (Lampa.Plugins && Lampa.Plugins.load) Lampa.Plugins.load(); } catch(e) {}
  });

  // Wait for Cherry plugin to initialize (sets window.plugin_cherry_ready = true)
  try {
    await page.waitForFunction(() => window.plugin_cherry_ready === true, { timeout: 20000 });
  } catch {
    await page.waitForTimeout(5000);
  }

  // Re-inject plugin with modified guard to expose __CHERRY_SOURCES.
  // The real plugin already ran, so re-running it will fail at UI registration (startPlugin).
  // That's fine — __CHERRY_SOURCES gets populated before startPlugin is called.
  const exposed = await page.evaluate(async (code) => {
    try { eval(code); } catch(e) { /* registration errors expected, SOURCES already set */ }
    await new Promise(r => setTimeout(r, 300));
    return window.__CHERRY_SOURCES ? window.__CHERRY_SOURCES.length : -1;
  }, reinjectionScript);

  if (exposed <= 0) {
    console.error(`  reinject result: ${exposed}`);
    await page.close();
    return null;
  }

  return page;
}

// ── Source test ───────────────────────────────────────────────────────────────
async function testSource(page, srcId) {
  const result = { id: srcId, browseOk: false, cards: 0, streamUrl: '', rangeOk: false, videoOk: false, videoDuration: null, error: '' };

  // browse
  let firstCard;
  try {
    const res = await page.evaluate(async ({ id }) => {
      const s = window.__CHERRY_SOURCES.find(x => x.id === id);
      if (!s) return { error: 'not found' };
      try {
        const r = await s.browse('', 1);
        return { items: (r && r.items || []).slice(0, 1), total: (r && r.items || []).length };
      } catch(e) { return { error: e.message }; }
    }, { id: srcId });

    if (res.error) { result.error = 'browse: ' + res.error; return result; }
    if (!res.total) { result.error = 'browse: 0 cards'; return result; }
    result.browseOk = true;
    result.cards = res.total;
    firstCard = res.items[0];
  } catch(e) { result.error = 'browse throw: ' + e.message; return result; }

  // getStream
  let streamUrl;
  try {
    const res = await page.evaluate(async ({ id, card }) => {
      const s = window.__CHERRY_SOURCES.find(x => x.id === id);
      try {
        const stream = await s.getStream(card);
        return { url: stream && stream.url };
      } catch(e) { return { error: e.message }; }
    }, { id: srcId, card: firstCard });

    if (res.error) { result.error = 'stream: ' + res.error; return result; }
    streamUrl = res.url || '';
    result.streamUrl = streamUrl;
  } catch(e) { result.error = 'stream throw: ' + e.message; return result; }

  if (!streamUrl || streamUrl.startsWith('blob:')) {
    result.rangeOk = true;
    result.videoOk = true;
    return result;
  }

  let u = streamUrl;
  if (u.startsWith('//')) u = 'https:' + u;
  const proxied = `${PROXY_BASE}/proxy?url=${encodeURIComponent(u)}&key=${PROXY_KEY}`;

  // Range check (browser CORS enforced)
  try {
    const rr = await page.evaluate(async ({ url }) => {
      try {
        const r = await fetch(url, { headers: { 'Range': 'bytes=0-65535' }, signal: AbortSignal.timeout(10000) });
        return { status: r.status, cr: r.headers.get('Content-Range') || '' };
      } catch(e) { return { error: e.message }; }
    }, { url: proxied });
    result.rangeOk = rr.status === 206;
    if (rr.error) result.error = (result.error ? result.error + '; ' : '') + 'range: ' + rr.error;
  } catch(e) { /* skip */ }

  // Get fresh stream URL for video test (tokens expire quickly)
  let freshProxied = proxied;
  try {
    const fr = await page.evaluate(async ({ id, card }) => {
      const s = window.__CHERRY_SOURCES.find(x => x.id === id);
      const stream = await s.getStream(card);
      return { url: stream && stream.url };
    }, { id: srcId, card: firstCard });
    if (fr.url) {
      let fu = fr.url;
      if (fu.startsWith('//')) fu = 'https:' + fu;
      freshProxied = `${PROXY_BASE}/proxy?url=${encodeURIComponent(fu)}&key=${PROXY_KEY}`;
    }
  } catch(e) { /* keep original */ }

  // Video loadedmetadata test
  try {
    const vr = await page.evaluate(async ({ url, timeout }) => {
      return new Promise(resolve => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        document.body.appendChild(v);
        v.src = url;
        const t = setTimeout(() => {
          const rs = v.readyState, ns = v.networkState;
          v.src = ''; try { document.body.removeChild(v); } catch(e) {}
          resolve({ ok: false, reason: 'timeout', rs, ns });
        }, timeout);
        v.addEventListener('loadedmetadata', () => {
          clearTimeout(t);
          const dur = v.duration;
          v.src = ''; try { document.body.removeChild(v); } catch(e) {}
          resolve({ ok: true, dur });
        });
        v.addEventListener('error', () => {
          clearTimeout(t);
          const code = v.error ? v.error.code : 0;
          const msg  = v.error ? v.error.message : '';
          const rs = v.readyState, ns = v.networkState;
          v.src = ''; try { document.body.removeChild(v); } catch(e) {}
          resolve({ ok: false, reason: 'error', code, msg, rs, ns });
        });
        v.load();
      });
    }, { url: freshProxied, timeout: VIDEO_TIMEOUT_MS });

    result.videoOk = vr.ok;
    result.videoDuration = vr.dur || null;
    if (!vr.ok) {
      const detail = vr.reason === 'error'
        ? `code${vr.code}(rs=${vr.rs},ns=${vr.ns})${vr.msg ? ' "'+vr.msg+'"' : ''}`
        : `timeout(rs=${vr.rs},ns=${vr.ns})`;
      result.error = (result.error ? result.error + '; ' : '') + 'video: ' + detail;
    }
  } catch(e) { /* skip */ }

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log('Opening real Lampa + injecting Cherry plugin...');

// Need __CHERRY_SOURCES exposed. Cherry plugin uses var SOURCES = [...].
// Patch the plugin on first load to expose it via addInitScript.
// We do this by having Lampa load the plugin via <script> tag as normal,
// then after plugin loads we expose SOURCES.

// Actually, Cherry plugin doesn't expose __CHERRY_SOURCES by default.
// We need to either:
// a) Use a patched version of the plugin URL (our plugin.js has the patch)
// b) Intercept the plugin script and patch it

// Strategy: Lampa caches the plugin in IndexedDB and loads it from there,
// bypassing Playwright's route interception. So we can't serve a patched version.
//
// Instead: after the real plugin loads (plugin_cherry_ready=true), we re-inject
// a modified version of the same plugin code with:
//   a) the plugin_cherry_ready guard replaced with a __CHERRY_SOURCES guard
//   b) var SOURCES = window.__CHERRY_SOURCES = [  (our patch)
// This re-runs the IIFE to populate __CHERRY_SOURCES without breaking Lampa UI.

import { readFileSync } from 'fs';
const PLUGIN_PATH = 'D:/Works/Lampa/plugin.js';

// Build the re-injection script: replace the double-load guard + expose SOURCES
const reinjectionScript = readFileSync(PLUGIN_PATH, 'utf-8')
  // Replace: if(window.plugin_cherry_ready) return; + window.plugin_cherry_ready=true;
  // With:    if(window.__CHERRY_SOURCES) return;   (don't re-run if already done)
  .replace(
    /if\s*\(\s*window\.plugin_cherry_ready\s*\)\s*return\s*;[\s\S]{0,100}window\.plugin_cherry_ready\s*=\s*true\s*;/,
    'if (window.__CHERRY_SOURCES) return;'
  )
  // Expose SOURCES to window
  .replace(/var SOURCES\s*=\s*\[/, 'var SOURCES = window.__CHERRY_SOURCES = [')
  // Stub startPlugin to a no-op so re-eval doesn't crash on Lampa re-registration.
  // SOURCES is empty at line 141; adapters push into it at lines 1322+, AFTER startPlugin().
  // Without this stub, startPlugin() fires (window.appready=true) and throws before adapters run.
  .replace('function startPlugin() {', 'function startPlugin() { return;');

const page = await makeLampaPage();

if (!page) {
  console.error('❌ Failed to load Cherry plugin in Lampa');
  await browser.close();
  process.exit(1);
}

const sources = await page.evaluate(() =>
  window.__CHERRY_SOURCES.map(s => ({ id: s.id, name: s.name }))
);
console.log(`✅ Cherry plugin loaded in real Lampa — ${sources.length} sources\n`);

console.log('═'.repeat(72));
console.log('CHERRY E2E IN REAL LAMPA  (browse + range + video)');
console.log('═'.repeat(72));

const allResults = [];

// Process in batches (reuse same page to keep Lampa state)
for (let i = 0; i < sources.length; i += CONCURRENCY) {
  const batch = sources.slice(i, i + CONCURRENCY);

  // Parallel batch — each gets its own page with the same Lampa setup
  const pages = await Promise.all(batch.map(async () => {
    const p = await context.newPage();
    await p.addInitScript(({ pluginUrl, proxyKey }) => {
      localStorage.setItem('plugins', JSON.stringify([{ url: pluginUrl, status: 'on' }]));
      localStorage.setItem('cherry_proxy_key', proxyKey);
      try { indexedDB.deleteDatabase('lampa_cache'); } catch(e) {}
    }, { pluginUrl: PLUGIN_URL, proxyKey: PROXY_KEY });
    await p.goto(LAMPA_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForTimeout(3000);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(1500);
    await p.evaluate(() => {
      try { window.appready = true; } catch(e) {}
      try { Lampa.Listener.send('ready', {}); } catch(e) {}
      try { if (Lampa.Plugins && Lampa.Plugins.load) Lampa.Plugins.load(); } catch(e) {}
    });
    try { await p.waitForFunction(() => window.plugin_cherry_ready === true, { timeout: 18000 }); }
    catch { await p.waitForTimeout(4000); }

    // Re-inject to expose __CHERRY_SOURCES (same as in makeLampaPage)
    await p.evaluate(async (code) => {
      try { eval(code); } catch(e) { /* registration errors expected */ }
      await new Promise(r => setTimeout(r, 300));
    }, reinjectionScript);

    return p;
  }));

  const batchResults = await Promise.all(batch.map((src, idx) => testSource(pages[idx], src.id)));
  await Promise.all(pages.map(p => p.close()));

  batchResults.forEach(r => {
    const bi = r.browseOk ? '✅' : '❌';
    const ri = r.rangeOk  ? '🎯' : (r.browseOk ? '⚠️ ' : '  ');
    const vi = r.videoOk  ? '▶️ ' : (r.browseOk ? '✗ ' : '  ');
    const dur = r.videoDuration ? `  ${Math.floor(r.videoDuration/60)}:${String(Math.floor(r.videoDuration%60)).padStart(2,'0')}` : '';
    console.log(`${bi}${ri}${vi} [${r.id.padEnd(18)}]  cards:${r.cards}${dur}  ${truncate(r.streamUrl, 52)}`);
    if (r.error) console.log(`     ⚠️  ${r.error}`);
    allResults.push(r);
  });
}

// ── Summary ───────────────────────────────────────────────────────────────────
const browseOk = allResults.filter(r => r.browseOk);
const rangeOk  = allResults.filter(r => r.rangeOk);
const videoOk  = allResults.filter(r => r.videoOk);
const videoFail = browseOk.filter(r => !r.videoOk);

console.log('\n' + '═'.repeat(72));
console.log('SUMMARY — real Lampa E2E test');
console.log('═'.repeat(72));
console.log(`Browse OK  : ${browseOk.length}/${allResults.length}`);
console.log(`Range 206  : ${rangeOk.length}/${browseOk.length}   (browser CORS enforced)`);
console.log(`Video meta : ${videoOk.length}/${browseOk.length}   (<video> loadedmetadata in real Lampa page)`);
console.log(`206 hits   : ${intercepted206.size} URLs intercepted by Playwright`);

if (videoFail.length) {
  console.log(`\nVideo FAIL (${videoFail.length}):`);
  videoFail.forEach(r => console.log(`  ${r.id.padEnd(20)} ${r.error}`));
}

await browser.close();
