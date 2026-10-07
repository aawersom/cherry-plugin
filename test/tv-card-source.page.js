(async function () {
  // card.source must equal the adapter id for feed, search and related cards: the grid opens a card
  // with sourceById(card.source) — a wrong value runs ANOTHER channel's getStream on the page
  // («не то видео» / error). Also flags unstable ids (Math.random fallbacks break Fav/Hist keys).
  var C = window.__C, out = {};
  await Promise.all(C.SOURCES.filter(function (s) { return !s.disabled; }).map(function (s) {
    var sort0 = (s.cfg && s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '';
    function cap(p) { return Promise.race([Promise.resolve(p).catch(function () { return null; }), new Promise(function (r) { setTimeout(function () { r(null); }, 25000); })]); }
    return cap(s.browse('', 1, sort0)).then(function (b) {
      var feed = (b && b.items) || [];
      return Promise.all([cap(s.search ? s.search(C._RU_SOURCES[s.id] ? 'блондинка' : 'blonde', 1) : null), cap(s.getRelated && feed[0] ? s.getRelated(feed[0], 1) : null)]).then(function (r) {
        var srch = (r[0] && r[0].items) || [], rel = r[1] || [];
        function bad(list) { return list.filter(function (v) { return v.source && v.source !== s.id; }).map(function (v) { return v.source; }); }
        function rnd(list) { return list.filter(function (v) { return /^0\.\d{6,}$/.test(String(v.id)); }).length; }
        var b1 = bad(feed), b2 = bad(srch), b3 = bad(rel);
        out[s.id] = (b1.length + b2.length + b3.length ? 'WRONG-SOURCE feed:' + b1.slice(0, 2) + ' search:' + b2.slice(0, 2) + ' rel:' + b3.slice(0, 2) : 'ok') +
          ' | noSource feed/search/rel=' + feed.filter(function (v) { return !v.source; }).length + '/' + srch.filter(function (v) { return !v.source; }).length + '/' + rel.filter(function (v) { return !v.source; }).length +
          ' | randomIds=' + (rnd(feed) + rnd(srch) + rnd(rel));
      });
    }).catch(function (e) { out[s.id] = 'ERR ' + e; });
  }));
  return out;
})
