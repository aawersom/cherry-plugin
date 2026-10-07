(async function () {
  // Poster / hover-clip alignment per channel: when the card URL carries a numeric id (≥4 digits)
  // and the thumb / preview URL carries numeric ids too, they should share the card's id. A
  // mismatch means the parser took the NEIGHBOUR card's poster/clip — the user sees (and hovers)
  // one video and opens another («не то видео»). Feed page 1 of every active channel.
  //   node test/tv-page-run.mjs test/tv-card-align.page.js x
  var C = window.__C, out = {};
  function ids(u) { return (String(u || '').match(/\d{4,}/g) || []); }
  await Promise.all(C.SOURCES.filter(function (s) { return !s.disabled; }).map(function (s) {
    var sort0 = (s.cfg && s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '';
    return Promise.race([s.browse('', 1, sort0), new Promise(function (r) { setTimeout(function () { r(null); }, 25000); })]).then(function (b) {
      var items = (b && b.items) || [], tChk = 0, tBad = [], pChk = 0, pBad = [];
      items.forEach(function (v) {
        var cid = ids(v.url).sort(function (a, c) { return c.length - a.length; })[0];
        if (!cid) return;
        var ti = ids(v.thumb), pi = ids(v.preview);
        if (ti.length) { tChk++; if (ti.indexOf(cid) === -1 && !ti.some(function (x) { return x.indexOf(cid) !== -1 || cid.indexOf(x) !== -1 && x.length >= 5; })) tBad.push(cid + '≠' + ti.join(',')); }
        if (pi.length) { pChk++; if (pi.indexOf(cid) === -1 && !pi.some(function (x) { return x.indexOf(cid) !== -1; })) pBad.push(cid + '≠' + pi.join(',')); }
      });
      out[s.id] = 'n=' + items.length + ' thumb ' + (tChk - tBad.length) + '/' + tChk + ' clip ' + (pChk - pBad.length) + '/' + pChk + (tBad.length ? ' T:' + tBad.slice(0, 2).join(' ') : '') + (pBad.length ? ' P:' + pBad.slice(0, 2).join(' ') : '');
    }).catch(function (e) { out[s.id] = 'ERR ' + e; });
  }));
  return out;
})
