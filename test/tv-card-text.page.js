(async function () {
  // Card text hygiene per channel (feed, search, related): raw HTML entities (&amp; &#039; &quot;),
  // leftover tags, empty titles. These are what the owner reads on screen.
  var C = window.__C, out = {};
  var ENT = /&(?:#x?[0-9a-f]+|[a-z]{2,8});|<\/?[a-z][^>]*>|[\u00C2\u00C3\u00D0\u00D1][\u0080-\u00BF\u0152-\u0178\u02C6\u02DC\u2013-\u203A\u20AC\u2122]/i;   // entities, tags, UTF-8 misread as cp1252
  await Promise.all(C.SOURCES.filter(function (s) { return !s.disabled; }).map(function (s) {
    var sort0 = (s.cfg && s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '';
    function cap(p) { return Promise.race([Promise.resolve(p).catch(function () { return null; }), new Promise(function (r) { setTimeout(function () { r(null); }, 25000); })]); }
    return cap(s.browse('', 1, sort0)).then(function (b) {
      var feed = (b && b.items) || [];
      return Promise.all([cap(s.search ? s.search(C._RU_SOURCES[s.id] ? 'блондинка' : 'blonde', 1) : null), cap(s.getRelated && feed[0] ? s.getRelated(feed[0], 1) : null)]).then(function (r) {
        var lists = { feed: feed, search: (r[0] && r[0].items) || [], rel: r[1] || [] }, bad = [];
        Object.keys(lists).forEach(function (k) {
          lists[k].forEach(function (v) {
            if (!String(v.title || '').trim()) bad.push(k + ':EMPTY');
            else if (ENT.test(v.title)) bad.push(k + ':' + String(v.title).match(ENT)[0] + ' «' + String(v.title).slice(0, 40) + '»');
          });
        });
        out[s.id] = bad.length ? bad.length + ' ' + bad.slice(0, 3).join(' | ') : 'ok';
      });
    }).catch(function (e) { out[s.id] = 'ERR ' + e; });
  }));
  return out;
})
