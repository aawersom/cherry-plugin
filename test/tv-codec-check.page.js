(async function (arg) {
  // Which codec does a channel actually serve per quality? Resolves the first card's stream via the
  // adapter, then Range-fetches the first 4 KB of every quality from the device and reports the
  // MP4 sample entry (avc1 = H.264, av01 = AV1, hev1/hvc1 = HEVC). Old TVs decode only H.264.
  //   node test/tv-page-run.mjs test/tv-codec-check.page.js "<sourceId>"
  var C = window.__C, s = C.SOURCES.filter(function (x) { return x.id === arg; })[0];
  var sort0 = (s.cfg && s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '';
  var b = await s.browse('', 1, sort0); var v = (b.items || [])[0];
  var st = await s.getStream(v);
  var q = Object.keys(st.quality || {}).length ? st.quality : { 'default': st.url };
  function nat(u) { return new Promise(function (res) { var r = new Lampa.Reguest(); r.native(u, function (d) { r.clear(); res(String(d)); }, function (e) { r.clear(); res('ERR ' + (e && e.status)); }, false, { dataType: 'text', timeout: 12000, headers: { 'Range': 'bytes=0-4000', 'Referer': v.url } }); }); }
  var out = { id: arg, card: (v.title || '').slice(0, 30), best: (st.url || '').slice(0, 70), qualities: {} };
  var keys = Object.keys(q);
  for (var i = 0; i < keys.length; i++) {
    var u = q[keys[i]]; if (C._forceProxyAndroid(u) || s.androidProxyStream) u = C.buildProxyUrl(u);
    var d = await nat(u);
    var codec = /av01/.test(d) ? 'AV1' : (/hev1|hvc1/.test(d) ? 'HEVC' : (/avc1/.test(d) ? 'H264' : (/#EXTM3U/.test(d) ? 'HLS' : (d.indexOf('ERR') === 0 ? d : 'unknown'))));
    out.qualities[keys[i]] = codec;
  }
  return out;
})
