(async function (arg) {
  // Does the resolved stream belong to the card? For cards whose URL carries a numeric id, every
  // quality URL should contain it (KVS get_file/…/{id}/{id}_720p.mp4). Also counts DISTINCT ids
  // across the quality map — two ids = the map mixes two videos (a second player/trailer block
  // on the page) and Lampa may start the foreign one (it plays the highest map entry).
  //   node test/tv-page-run.mjs test/tv-stream-owner.page.js "<id,id,...>|all"
  var C = window.__C, out = {};
  var list = C.SOURCES.filter(function (s) { return !s.disabled && (arg === 'all' || String(arg).split(',').indexOf(s.id) !== -1); });
  for (var k = 0; k < list.length; k++) {
    var s = list[k];
    var sort0 = (s.cfg && s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '';
    var b = await Promise.race([s.browse('', 1, sort0).catch(function () { return null; }), new Promise(function (r) { setTimeout(function () { r(null); }, 20000); })]);
    var items = ((b && b.items) || []).slice(0, 3), res = [];
    for (var i = 0; i < items.length; i++) {
      var v = items[i];
      var st = await Promise.race([s.getStream(v).catch(function () { return null; }), new Promise(function (r) { setTimeout(function () { r(null); }, 30000); })]);
      if (!st) { res.push('timeout'); continue; }
      var urls = [st.url].concat(Object.keys(st.quality || {}).map(function (q) { return st.quality[q]; })).filter(Boolean).map(function (u) { try { return decodeURIComponent(u); } catch (e) { return u; } });
      if (!urls.length) { res.push('NOURL'); continue; }
      var cid = (String(v.url).match(/\d{4,}/g) || []).sort(function (a, c) { return c.length - a.length; })[0];
      var foreign = cid ? urls.filter(function (u) { return u.indexOf(cid) === -1; }).length : -1;
      res.push(!cid ? 'noid(' + urls.length + ')' : (foreign ? 'FOREIGN ' + foreign + '/' + urls.length + ' ' + urls.filter(function (u) { return u.indexOf(cid) === -1; })[0].slice(0, 90) : 'ok(' + urls.length + ')'));
    }
    out[s.id] = res.join(' | ');
  }
  return out;
})
