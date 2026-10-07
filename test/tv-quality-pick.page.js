(async function () {
  // Which quality does the user actually get? Mirrors Lampa.Player.play: with a quality map, the
  // entry whose label == Storage.field('video_quality_default') (default 1080) wins; otherwise the
  // url handed by playVideo stays. Reports, per channel (card 0): map labels, the label of
  // stream.url, the best label, and what Lampa plays → flags «LOW» when a better entry is ignored.
  var C = window.__C, out = {};
  var pref = parseInt(Lampa.Storage.field ? Lampa.Storage.field('video_quality_default') : 1080, 10) || 1080;
  var list = C.SOURCES.filter(function (s) { return !s.disabled; });
  await Promise.all(list.map(function (s) {
    var sort0 = (s.cfg && s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '';
    function cap(p, ms) { return Promise.race([Promise.resolve(p).catch(function () { return null; }), new Promise(function (r) { setTimeout(function () { r(null); }, ms || 30000); })]); }
    return cap(s.browse('', 1, sort0)).then(function (b) {
      var v = b && b.items && b.items[0]; if (!v) { out[s.id] = 'no cards'; return; }
      return cap(s.getStream(v), 40000).then(function (st) {
        if (!st) { out[s.id] = 'timeout'; return; }
        var q = st.quality || {}, labels = Object.keys(q);
        var handed = C.bestQualityUrl(q) || st.url;                      // playVideo (v0.13.26)
        var lab = function (u) { var k = labels.filter(function (l) { return q[l] === u; })[0]; return k || (u ? 'not-in-map' : 'none'); };
        var best = C.bestQualityUrl(q);
        var match = labels.filter(function (l) { return parseInt(l, 10) === pref && q[l]; })[0];
        var plays = labels.length > 1 && match ? match : lab(handed);
        var low = labels.length > 1 && lab(best) !== plays && parseInt(lab(best), 10) > (parseInt(plays, 10) || 0);
        out[s.id] = 'map=[' + labels.join(',') + '] url=' + lab(handed) + ' best=' + lab(best) + ' → plays ' + plays + (low ? '  LOW' : '');
      });
    });
  }));
  out._pref = pref;
  return out;
})
