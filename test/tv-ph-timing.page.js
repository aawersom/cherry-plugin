(async function (arg) {
  // Time the pornhub webmasters API by route from the device: pure native, cherryFetch
  // (native → proxy on error), and the proxy directly. Explains the first-screen latency.
  //   node test/tv-page-run.mjs test/tv-ph-timing.page.js run
  var C = window.__C;
  var url = 'https://www.pornhub.com/webmasters/search?search=&page=1&ordering=mostviewed&thumbsize=medium_hd';
  function cnt(t) { try { var d = JSON.parse(t); return (d.videos || []).length; } catch (e) { return 'nojson:' + String(t).slice(0, 40).replace(/\s+/g, ' '); } }
  function timed(p) { var t0 = Date.now(); return p.then(function (t) { return { ms: Date.now() - t0, videos: cnt(t) }; }, function (e) { return { ms: Date.now() - t0, err: String(e && e.status || e).slice(0, 60) }; }); }
  function nat(u) { return new Promise(function (res, rej) { var r = new Lampa.Reguest(); r.native(u, function (d) { r.clear(); res(String(d)); }, function (e) { r.clear(); rej(e); }, false, { dataType: 'text', timeout: 15000 }); }); }
  var out = {};
  out.native = await timed(nat(url));
  out.cherryFetch = await timed(C.cherryFetch(url));
  out.proxy = await timed(fetch(C.buildProxyUrl(url)).then(function (r) { return r.text(); }));
  var s = C.SOURCES.filter(function (x) { return x.id === 'pornhub'; })[0];
  var t0 = Date.now(); var b = await s.browse('', 1, 'mostviewed'); out.browse = { ms: Date.now() - t0, n: (b.items || []).length };
  return out;
})
