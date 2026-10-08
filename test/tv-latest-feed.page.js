(async function () {
  // «Все видео» = latest: for channels whose sorts[0] is popular, the «Свежее» listing must load
  // and differ from the popular one (read-only).   node test/tv-page-run.mjs test/tv-latest-feed.page.js x
  var C = window.__C, ids = ['youjizz', 'xhamster', 'huyamba', 'ebalovo', 'porno666', 'lenkino', 'pornobriz', 'ebun'], out = {};
  function cap(p) { return Promise.race([Promise.resolve(p).catch(function (e) { return { err: String(e) }; }), new Promise(function (r) { setTimeout(function () { r({ err: 'cap' }); }, 30000); })]); }
  for (var i = 0; i < ids.length; i++) {
    var s = C.SOURCES.filter(function (x) { return x.id === ids[i]; })[0];
    var fresh = (s.cfg.sorts || []).filter(function (x) { return x.label === 'Свежее'; })[0];
    var a = await cap(s.browse('', 1, fresh ? fresh.id : '')), b = await cap(s.browse('', 1, s.cfg.sorts[0].id));
    var ai = (a.items || []).map(function (v) { return v.id; }), bi = (b.items || []).map(function (v) { return v.id; });
    out[ids[i]] = { latestSort: fresh && fresh.id, latestN: ai.length, popularN: bi.length,
      overlapTop10: ai.slice(0, 10).filter(function (x) { return bi.slice(0, 10).indexOf(x) >= 0; }).length, err: a.err };
  }
  return out;
})
