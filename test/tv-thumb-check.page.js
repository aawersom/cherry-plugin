(async function (arg) {
  // Real <img> load check for a channel's first-page posters from the device (8 s cap each, 6 in parallel).
  //   node test/tv-page-run.mjs test/tv-thumb-check.page.js "<sourceId>"
  var C = window.__C, s = C.SOURCES.filter(function (x) { return x.id === arg; })[0];
  var sort0 = (s.cfg && s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '';
  var b = await s.browse('', 1, sort0); var items = (b.items || []).slice(0, 12);
  function load(u) { return new Promise(function (res) { var im = new Image(); var t = setTimeout(function () { res({ u: u.slice(0, 90), r: 'timeout' }); }, 8000); im.onload = function () { clearTimeout(t); res({ u: u.slice(0, 90), r: 'ok ' + im.naturalWidth + 'x' + im.naturalHeight }); }; im.onerror = function () { clearTimeout(t); res({ u: u.slice(0, 90), r: 'error' }); }; im.src = u; }); }
  var out = { n: items.length, results: [] };
  for (var i = 0; i < items.length; i += 6) out.results = out.results.concat(await Promise.all(items.slice(i, i + 6).map(function (v) { return load(v.thumb); })));
  out.ok = out.results.filter(function (r) { return r.r.indexOf('ok') === 0; }).length;
  return out;
})
