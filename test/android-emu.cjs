// Android-TV emulation harness (manual): node test/android-emu.cjs [chan1 chan2 ...]
//
// Loads the REAL plugin.js with a Lampa mock where Platform.is('android')===true,
// Reguest.native = a direct fetch (emulates the device's native HTTP), and
// Player.play is INTERCEPTED — so we see the EXACT stream URL the Android player
// would receive per channel (protocol-relative? .m3u8? proxied? empty?), plus the
// browse card count. This reproduces the Android code path (the branch decisions +
// URL shaping) without a device. Caveat: egress IP is this host, not the device's
// home IP — so IP-bound-token-from-device-IP can't be 100% reproduced, but every
// LOGIC/URL-shape bug (chooser, raw-vs-proxied, empty native fetch) is observable.

const fs = require('fs');
const PLUGIN = 'D:/Works/Lampa/plugin.js';
let src = fs.readFileSync(PLUGIN, 'utf8').replace(/^﻿/, '');

// Inject an export of the IIFE internals right before the final })();
const i = src.lastIndexOf('})();');
src = src.slice(0, i) +
  '\n;try{window.__CHERRY={SOURCES:SOURCES,playVideo:playVideo,buildProxyUrl:buildProxyUrl,_isAndroid:_isAndroid,getProxyKey:getProxyKey,cherryFetch:cherryFetch};}catch(e){window.__CHERRY_ERR=(e&&e.message)||String(e);}\n' +
  src.slice(i);

const captured = { lastPlay: null };
const UA = 'Mozilla/5.0 (Linux; Android 12; BRAVIA 4K) AppleWebKit/537.36';

function Reguest() {
  this.timeout = function () { return this; };
  this.silent  = function () { return this; };
  this.clear   = function () { return this; };
  this.native  = function (url, ok, err, post, opts) {
    const h = { 'User-Agent': UA };
    if (opts && opts.headers) Object.assign(h, opts.headers);
    fetch(url, { method: post ? 'POST' : 'GET', headers: h, body: post || undefined })
      .then(function (r) { return r.text(); })
      .then(function (t) { ok(t); })
      .catch(function (e) { err(e); });
  };
}

const Lampa = {
  Platform: { is: function (p) { return p === 'android'; }, tv: true },
  Storage:  { get: function (k, d) { return d; }, set: function () {}, field: function () { return ''; }, listener: { follow: function () {} } },
  Utils:    { hash: function (s) { s = String(s); let a = 0; for (let j = 0; j < s.length; j++) a = ((a << 5) - a + s.charCodeAt(j)) | 0; return Math.abs(a); } },
  Timeline: { view: function (h) { return { hash: h, time: 0, duration: 0, percent: 0 }; }, update: function () {} },
  Noty:     { show: function () {} },
  Lang:     { translate: function (k) { return k; }, add: function () {} },
  Player:   { play: function (d) { captured.lastPlay = d; }, playlist: function () {}, callback: function () {} },
  Reguest:  Reguest,
  Listener: { follow: function () {}, send: function () {} },
  Activity: { push: function () {}, active: function () { return {}; } },
  Controller: { toggle: function () {}, add: function () {}, enabled: function () { return {}; } },
  Component: { add: function () {} },
  InteractionCategory: function () { return {}; },
  SettingsApi: { addComponent: function () {}, addParam: function () {} },
  Manifest: { app: {}, plugins: {} },
  Menu: { addButton: function () {} },
  Select: { show: function () {} },
  Input: { edit: function () {} },
  Empty: function () { this.create = function () {}; this.render = function () { return {}; }; this.start = function () {}; },
  Search: function () { this.start = function () {}; },
  Template: { add: function () {}, get: function () { return ''; } },
};

global.window = { Lampa, appready: true, plugin_cherry_ready: false, lampa_settings: {} };
global.Lampa = Lampa;
global.IntersectionObserver = function () { this.observe = function () {}; this.disconnect = function () {}; };
global.document = { createElement: function () { return { style: {}, classList: { add: function () {} }, appendChild: function () {} }; }, head: { appendChild: function () {} }, body: {}, documentElement: {}, querySelector: function () { return null; } };

try { eval(src); } catch (e) { console.log('LOAD ERROR:', e.message); process.exit(1); }
const C = global.window.__CHERRY;
if (!C) { console.log('NO __CHERRY export. err:', global.window.__CHERRY_ERR); process.exit(1); }
console.log('android:', C._isAndroid(), '| sources:', C.SOURCES.length);

function fmt(u) {
  if (!u) return '(empty)';
  if (u.indexOf('//') === 0) return 'PROTOCOL-RELATIVE ⚠ ' + u.slice(0, 70);
  let kind = /\.m3u8/.test(u) ? 'M3U8⚠(chooser)' : /\.mp4/.test(u) ? 'MP4' : 'other';
  let prox = u.indexOf('/proxy?url=') !== -1 ? ('PROXIED(' + (u.split('//')[1] || '').split('/')[0] + ')⚠' ) : 'RAW';
  return kind + ' ' + prox + ' ' + u.slice(0, 70);
}

async function test(id) {
  const s = C.SOURCES.find(function (x) { return x.id === id; });
  if (!s) { console.log(id, '— NOT FOUND'); return; }
  const cat = (s.cfg && s.cfg.categories && s.cfg.categories[2] && s.cfg.categories[2].id) || '';
  let cards = 0, vurl = '';
  try {
    const r = await s.browse(cat, 1, (s.cfg && s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '');
    cards = (r && r.items && r.items.length) || 0;
    if (cards) vurl = r.items[0].url;
  } catch (e) { console.log(id, 'browse ERR', e.message); }
  captured.lastPlay = null;
  if (vurl) {
    try {
      C.playVideo({ url: vurl, title: 't', id: 'x', source: id }, s);
      await new Promise(function (res) { setTimeout(res, 9000); });
    } catch (e) { console.log(id, 'play ERR', e.message); }
  }
  const p = captured.lastPlay;
  console.log(
    id.padEnd(12),
    'cat=' + (cat || '-').padEnd(10),
    'cards=' + String(cards).padStart(3),
    '| player.url:', p ? fmt(p.url) : '(no play call)'
  );
}

(async function () {
  const args = process.argv.slice(2);
  const list = args.length ? args : ['hqporner', 'hellporno', 'youjizz', 'pornone', 'porntrex', '3movs', 'xnxx', 'xvideos', 'pornhub'];
  for (const id of list) await test(id);
  process.exit(0);
})();
