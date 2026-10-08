(async function () {
  // «Все видео» must be the LATEST feed. For channels without a «Свежее» sort: does browse('', 1, '')
  // (the site's own default listing) work, and is it different from sorts[0] (popular)? Read-only.
  //   node test/tv-page-run.mjs test/tv-latest-sort.page.js x
  var C = window.__C, ids = ['xnxx', 'porntrex', 'lenporno', 'jopaonline', 'youjizz', 'xhamster'], out = {};
  function cap(p) { return Promise.race([Promise.resolve(p).catch(function (e) { return { err: String(e) }; }), new Promise(function (r) { setTimeout(function () { r({ err: 'cap' }); }, 30000); })]); }
  for (var i = 0; i < ids.length; i++) {
    var s = C.SOURCES.filter(function (x) { return x.id === ids[i]; })[0];
    var sorts = (s.cfg && s.cfg.sorts || []).map(function (x) { return x.id + ':' + x.label; });
    var d = await cap(s.browse('', 1, '')), p = await cap(s.browse('', 1, (s.cfg.sorts[0] || {}).id || ''));
    var di = (d.items || []).map(function (v) { return v.id; }), pi = (p.items || []).map(function (v) { return v.id; });
    out[ids[i]] = { sorts: sorts.join(' | '), defaultN: di.length, popularN: pi.length,
      overlapTop10: di.slice(0, 10).filter(function (x) { return pi.slice(0, 10).indexOf(x) >= 0; }).length,
      defaultTop: (d.items || []).slice(0, 3).map(function (v) { return (v.title || '').slice(0, 30); }), err: d.err };
  }
  return out;
})
