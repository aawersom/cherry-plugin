(async function () {
  // Where does pornhub getStream spend its time? Times the page fetch and the full getStream for a few
  // favorites (read-only).   node test/tv-page-run.mjs test/tv-ph-timing.page.js x
  var C = window.__C, ph = C.SOURCES.filter(function (x) { return x.id === 'pornhub'; })[0];
  var favs = C.Fav.all().filter(function (v) { return v.source === 'pornhub'; }).slice(0, 5), out = [];
  function cap(p, ms) { return Promise.race([Promise.resolve(p).then(function (v) { return v; }, function (e) { return { err: String(e) }; }), new Promise(function (r) { setTimeout(function () { r({ err: 'cap' }); }, ms); })]); }
  for (var i = 0; i < favs.length; i++) {
    var v = favs[i], t0 = Date.now();
    var h = await cap(C.cherryFetch(v.url), 120000), t1 = Date.now();
    var st = await cap(ph.getStream(v), 180000), t2 = Date.now();
    out.push({ id: v.url.split('viewkey=')[1], pageMs: t1 - t0, pageLen: typeof h === 'string' ? h.length : h, streamMs: t2 - t1,
      q: st && Object.keys(st.quality || {}), err: st && st.err });
  }
  return out;
})
