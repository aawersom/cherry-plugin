// Cherry — streaming matrix harness (Phase 1 of the comprehensive verification plan).
//   node test/stream-matrix.cjs [--platform=android|browser] [--reach] [ids…]
//
// Loads the REAL plugin.js with a Lampa mock, runs per channel:
//   browse(firstCat, 1, firstSort) → card count + first video
//   playVideo(firstVideo) → intercepts Lampa.Player.play → the EXACT URL the player gets
//   (optional --reach) fetches that URL (Range / m3u8 master→variant→segment) → status + throughput
//   buildProxyUrl tier of page-host vs stream-host → IP-affinity pairing check
// Output: a matrix table to stdout + tasks/stream-matrix-report.md
//
// Platform: --platform=android mocks Platform.is('android')=true (default), browser=false.
// Caveat: egress IP is this host, NOT the device's home IP — reachability verifies the URL
// is fetchable + fast, NOT device-IP-bound-token validity (that's the device checklist, Phase 4).

const fs = require('fs');
const ARGS = process.argv.slice(2);
const PLATFORM = (ARGS.find(a => a.startsWith('--platform=')) || '--platform=android').split('=')[1];
const REACH = ARGS.includes('--reach');
const CATS = ARGS.includes('--cats');
const IDS = ARGS.filter(a => !a.startsWith('--'));
const IS_ANDROID = PLATFORM === 'android';

let src = fs.readFileSync('D:/Works/Lampa/plugin.js', 'utf8').replace(/^﻿/, '');
const i = src.lastIndexOf('})();');
src = src.slice(0, i) +
  '\n;try{window.__CHERRY={SOURCES:SOURCES,playVideo:playVideo,buildProxyUrl:buildProxyUrl,_isAndroid:_isAndroid,cherryFetch:cherryFetch};}catch(e){window.__CHERRY_ERR=(e&&e.message)||String(e);}\n' +
  src.slice(i);

const captured = { lastPlay: null };
const UA = IS_ANDROID
  ? 'Mozilla/5.0 (Linux; Android 12; BRAVIA 4K) AppleWebKit/537.36'
  : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0';

function Reguest() {
  this.timeout = function () { return this; };
  this.silent = function () { return this; };
  this.clear = function () { return this; };
  this.native = function (url, ok, err, post, opts) {
    const h = { 'User-Agent': UA };
    if (opts && opts.headers) Object.assign(h, opts.headers);
    fetch(url, { method: post ? 'POST' : 'GET', headers: h, body: post || undefined })
      .then(r => r.text()).then(t => ok(t)).catch(e => err(e));
  };
}

const Lampa = {
  Platform: { is: p => (p === 'android' ? IS_ANDROID : false), tv: true },
  Storage: { get: (k, d) => d, set: () => {}, field: () => '', listener: { follow: () => {} } },
  Utils: { hash: s => { s = String(s); let a = 0; for (let j = 0; j < s.length; j++) a = ((a << 5) - a + s.charCodeAt(j)) | 0; return Math.abs(a); } },
  Timeline: { view: h => ({ hash: h, time: 0, duration: 0, percent: 0 }), update: () => {} },
  Noty: { show: () => {} },
  Lang: { translate: k => k, add: () => {} },
  Player: { play: d => { captured.lastPlay = d; }, playlist: () => {}, callback: () => {} },
  Reguest, Listener: { follow: () => {}, send: () => {} },
  Activity: { push: () => {}, active: () => ({}) },
  Controller: { toggle: () => {}, add: () => {}, enabled: () => ({}) },
  Component: { add: () => {} }, InteractionCategory: function () { return {}; },
  SettingsApi: { addComponent: () => {}, addParam: () => {} },
  Manifest: { app: {}, plugins: {} }, Menu: { addButton: () => {} },
  Select: { show: () => {} }, Input: { edit: () => {} },
  Empty: function () { this.create = () => {}; this.render = () => ({}); this.start = () => {}; },
  Search: function () { this.start = () => {}; },
  Template: { add: () => {}, get: () => '' },
};
global.window = { Lampa, appready: true, plugin_cherry_ready: false, lampa_settings: {} };
global.Lampa = Lampa;
global.IntersectionObserver = function () { this.observe = () => {}; this.disconnect = () => {}; };
global.document = { createElement: () => ({ style: {}, classList: { add: () => {} }, appendChild: () => {} }), head: { appendChild: () => {} }, body: {}, documentElement: {}, querySelector: () => null };

try { eval(src); } catch (e) { console.log('LOAD ERROR:', e.message); process.exit(1); }
const C = global.window.__CHERRY;
if (!C) { console.log('NO __CHERRY:', global.window.__CHERRY_ERR); process.exit(1); }

function host(u) { try { return new URL(u.startsWith('//') ? 'https:' + u : u).hostname; } catch (e) { return ''; } }
function proxyBase(u) { // origin of buildProxyUrl result = which tier
  try { const r = C.buildProxyUrl(u.startsWith('//') ? 'https:' + u : u); return new URL(r).hostname; } catch (e) { return '?'; }
}
function kindOf(u) {
  if (!u) return 'EMPTY⚠';
  if (u.indexOf('//') === 0) return 'PROTO-REL⚠';
  const proxied = u.indexOf('/proxy?url=') !== -1;
  const fmt = /\.m3u8/.test(u) ? 'm3u8' : /\.mp4/.test(u) ? 'mp4' : 'other';
  return fmt + (proxied ? '/proxied' : '/raw');
}

async function fetchRange(url, bytes, referer) {
  const u = url.startsWith('//') ? 'https:' + url : url;
  const t0 = Date.now();
  try {
    const h = { 'User-Agent': UA, Range: 'bytes=0-' + bytes };
    if (referer) h.Referer = referer;  // native player sends the page URL as Referer
    const r = await fetch(u, { headers: h, signal: AbortSignal.timeout(25000) });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, bytes: buf.length, ms: Date.now() - t0, ct: r.headers.get('content-type') || '', text: buf };
  } catch (e) { return { status: 'ERR', bytes: 0, ms: Date.now() - t0, err: String(e).slice(0, 40) }; }
}

async function reachability(url, referer) {
  if (!url) return 'no-url';
  const u = url.startsWith('//') ? 'https:' + url : url;
  const isM3u8 = /\.m3u8/.test(u) || (url.indexOf('/proxy?url=') !== -1 && /m3u8/.test(decodeURIComponent(url)));
  if (!isM3u8) {
    const r = await fetchRange(u, 2000000, referer);
    const sp = (r.bytes && r.ms) ? (r.bytes / 1024 / 1024 / (r.ms / 1000)).toFixed(2) + 'MB/s' : '-';
    return `${r.status} ${Math.round(r.bytes / 1024)}KB ${sp}`;
  }
  // m3u8 chain: master → variant → first segment
  const m = await fetchRange(u, 200000);
  if (m.status !== 200 && m.status !== 206) return `master ${m.status}`;
  const mt = (m.text || Buffer.from('')).toString('utf8');
  const lines = mt.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  if (!lines.length) return `master ${m.status} (no variants)`;
  let variant = lines[0];
  if (variant.indexOf('/proxy?url=') !== -1) { try { variant = decodeURIComponent(variant.match(/url=([^&]+)/)[1]); } catch (e) {} }
  else if (!/^https?:/.test(variant)) { try { variant = new URL(variant, u).href; } catch (e) {} }
  const v = await fetchRange(variant, 200000);
  if (v.status !== 200 && v.status !== 206) return `variant ${v.status}`;
  const vt = (v.text || Buffer.from('')).toString('utf8');
  const segs = vt.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  if (!segs.length) return `variant ok, no segs`;
  let seg = segs[0];
  if (seg.indexOf('/proxy?url=') !== -1) { try { seg = decodeURIComponent(seg.match(/url=([^&]+)/)[1]); } catch (e) {} }
  else if (!/^https?:/.test(seg)) { try { seg = new URL(seg, variant).href; } catch (e) {} }
  const s = await fetchRange(seg, 500000);
  return `m3u8 chain: master✓ variant✓ seg=${s.status}${(s.status === 200 || s.status === 206) ? '✓' : '⚠'}`;
}

function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); }

async function run(id) {
  const s = C.SOURCES.find(x => x.id === id);
  if (!s) return { id, err: 'NOT FOUND' };
  const cat = (s.cfg && s.cfg.categories && s.cfg.categories[0] && s.cfg.categories[0].id) || '';
  const sort = (s.cfg && s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '';
  let cards = 0, vurl = '';
  try { const r = await s.browse(cat, 1, sort); cards = (r && r.items && r.items.length) || 0; if (cards) vurl = r.items[0].url; }
  catch (e) {}
  captured.lastPlay = null;
  if (vurl) {
    try {
      C.playVideo({ url: vurl, title: 't', id: 'x', source: id }, s);
      await new Promise(res => { const t0 = Date.now(); (function p() { if (captured.lastPlay || Date.now() - t0 > 16000) return res(); setTimeout(p, 300); })(); });
    } catch (e) {}
  }
  const purl = captured.lastPlay && captured.lastPlay.url || '';
  // IP-affinity: page host vs stream host → same proxy tier?
  const pageTier = vurl ? proxyBase(vurl) : '?';
  const streamTier = purl ? proxyBase(purl) : '?';
  const affinity = (!purl) ? '-' : (pageTier === streamTier ? 'same' : 'DIFF⚠(' + pageTier.split('.')[0] + '/' + streamTier.split('.')[0] + ')');
  const ref = vurl || ('https://' + host(purl) + '/');
  const reach = REACH ? await reachability(purl, ref) : '(skip)';
  return { id, cat, sort, cards, kind: kindOf(purl), affinity, reach, streamHost: host(purl) };
}

// Phase 2: sweep EVERY category of a channel → flag dead (0) / sparse (<5).
async function catsSweep(id) {
  const s = C.SOURCES.find(x => x.id === id);
  if (!s || !s.cfg || !s.cfg.categories) return { id, cats: [] };
  const sort = (s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '';
  const out = [];
  for (const c of s.cfg.categories) {
    let n = -1;  // -1 = timed out / errored (distinct from 0 = real empty)
    try {
      const r = await Promise.race([
        s.browse(c.id, 1, sort),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000)),
      ]);
      n = (r && r.items && r.items.length) || 0;
    } catch (e) { n = -1; }
    out.push({ id: c.id, label: c.label, n });
  }
  return { id, cats: out };
}

async function runCats(ids) {
  console.log(`CATEGORY SWEEP · platform=${PLATFORM} · channels=${ids.length}\n`);
  let md = `# Cherry — category sweep (Phase 2)\n\nplatform=${PLATFORM} · ${new Date ? '' : ''}channels=${ids.length}\n\n`;
  const deadAll = [];
  for (const id of ids) {
    const r = await catsSweep(id);
    const dead = r.cats.filter(c => c.n === 0);
    const sparse = r.cats.filter(c => c.n > 0 && c.n < 5);
    const timeout = r.cats.filter(c => c.n === -1);
    console.log(`${pad(id, 13)} cats=${pad(r.cats.length, 4)} dead=${pad(dead.length, 4)} sparse=${pad(sparse.length, 4)} t/o=${pad(timeout.length, 3)}${dead.length ? ' DEAD: ' + dead.map(c => c.id).slice(0, 8).join(',') : ''}`);
    md += `## ${id} — ${r.cats.length} cats, ${dead.length} dead, ${sparse.length} sparse, ${timeout.length} timeout\n`;
    if (dead.length) md += `- **DEAD (0 cards):** ${dead.map(c => `\`${c.id}\``).join(', ')}\n`;
    if (sparse.length) md += `- sparse (<5): ${sparse.map(c => `${c.id}(${c.n})`).join(', ')}\n`;
    if (timeout.length) md += `- timeout (inconclusive): ${timeout.map(c => c.id).join(', ')}\n`;
    if (!dead.length && !sparse.length && !timeout.length) md += `- all OK\n`;
    dead.forEach(c => deadAll.push(`${id}:${c.id}`));
  }
  md = md.replace('# Cherry — category sweep (Phase 2)\n', `# Cherry — category sweep (Phase 2)\n\n**Total dead category slugs: ${deadAll.length}** — candidates for removal.\n`);
  fs.writeFileSync('D:/Works/Lampa/tasks/category-sweep-report.md', md);
  console.log(`\nTotal dead slugs: ${deadAll.length} | report → tasks/category-sweep-report.md`);
  process.exit(0);
}

(async function () {
  const ids = IDS.length ? IDS : C.SOURCES.map(s => s.id);
  if (CATS) return runCats(ids);
  console.log(`platform=${PLATFORM} reach=${REACH} | channels=${ids.length}\n`);
  const head = `${pad('channel', 13)}${pad('cards', 6)}${pad('url-kind', 13)}${pad('affinity', 16)}reach`;
  console.log(head); console.log('-'.repeat(head.length + 20));
  const rows = [];
  for (const id of ids) {
    const r = await run(id);
    rows.push(r);
    if (r.err) { console.log(`${pad(id, 13)}${r.err}`); continue; }
    console.log(`${pad(id, 13)}${pad(r.cards, 6)}${pad(r.kind, 13)}${pad(r.affinity, 16)}${r.reach}`);
  }
  // markdown report
  let md = `# Cherry — stream-matrix report\n\nplatform=${PLATFORM} · reach=${REACH} · channels=${ids.length}\n\n`;
  md += `| channel | cat | sort | cards | url-kind | affinity | reach | stream host |\n|---|---|---|---|---|---|---|---|\n`;
  for (const r of rows) {
    if (r.err) { md += `| ${r.id} | — | — | — | ${r.err} | — | — | — |\n`; continue; }
    md += `| ${r.id} | ${r.cat || '-'} | ${r.sort || '-'} | ${r.cards} | ${r.kind} | ${r.affinity} | ${r.reach} | ${r.streamHost || '-'} |\n`;
  }
  const flags = rows.filter(r => !r.err && (/⚠/.test(r.kind) || /⚠/.test(r.affinity) || r.cards === 0 || (REACH && /⚠|ERR|40\d|41\d|50\d|no-url/.test(r.reach))));
  md += `\n## Flags (${flags.length})\n`;
  flags.forEach(r => { md += `- **${r.id}**: cards=${r.cards} kind=${r.kind} affinity=${r.affinity} reach=${r.reach}\n`; });
  fs.writeFileSync('D:/Works/Lampa/tasks/stream-matrix-report.md', md);
  console.log(`\nFlags: ${flags.length} | report → tasks/stream-matrix-report.md`);
  process.exit(0);
})();
