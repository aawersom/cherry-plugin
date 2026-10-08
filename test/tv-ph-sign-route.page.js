(async function (arg) {
  // pornhub CDN answers 470 to segments signed for a flagged egress. Which page route gives tokens the
  // CDN accepts? For browse card #arg: fetch the page via VPS (current) and via the CF worker, pull the
  // HLS master from flashvars, then fetch master → media → first segment (always via VPS, referer set).
  // Read-only.   node test/tv-page-run.mjs test/tv-ph-sign-route.page.js 0
  var C = window.__C, ph = C.SOURCES.filter(function (x) { return x.id === 'pornhub'; })[0];
  var b = await ph.browse('', 1, (ph.cfg.sorts[0] || {}).id || ''), v = b.items[parseInt(arg, 10) || 0];
  var REF = 'https://www.pornhub.com/';
  async function txt(u) { var r = await fetch(u); return { s: r.status, t: await r.text() }; }
  function firstUri(m3u8) { return (m3u8.split('\n').filter(function (l) { return l && l.charAt(0) !== '#'; })[0] || '').trim(); }
  async function probe(pageViaCF) {
    var page = await txt(C.buildProxyUrl(v.url, REF, pageViaCF));
    var fm = page.t.match(/var\s+flashvars_\d+\s*=\s*(\{[\s\S]+?\});\s*\n/);
    if (!fm) return { page: page.s, err: 'no flashvars', len: page.t.length };
    var defs = JSON.parse(fm[1]).mediaDefinitions || [], hls = defs.filter(function (d) { return d.format === 'hls' && d.videoUrl; });
    var best = hls.sort(function (a, c) { return (parseInt(c.quality, 10) || 0) - (parseInt(a.quality, 10) || 0); })[0];
    if (!best) return { page: page.s, err: 'no hls', defs: defs.length };
    var orig = best.videoUrl, rewritten = orig.replace(/^https?:\/\/hv-h\.phncdn\.com\//, 'https://ev-h.phncdn.com/');
    var out = { page: page.s, q: best.quality, host: orig.split('/')[2] };
    var masters = { orig: orig, ev: rewritten };
    for (var k in masters) {
      var m = await txt(C.buildProxyUrl(masters[k], REF));
      var media = firstUri(m.t), mt = media ? await txt(media) : { s: 'none', t: '' };
      var seg = firstUri(mt.t), st = seg ? await txt(seg) : { s: 'none' };
      out[k] = m.s + '/' + mt.s + '/' + st.s;
    }
    return out;
  }
  return { card: (v.title || '').slice(0, 40), pageVPS: await probe(false), pageCF: await probe(true) };
})
