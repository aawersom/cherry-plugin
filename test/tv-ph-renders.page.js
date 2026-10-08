(async function (arg) {
  // How do repeated renders of ONE pornhub page sign their HLS, and which edge delivers each?
  // For browse card #arg: fetch the page N times (uncached), per render report the signing scheme
  // (A = validfrom/ipa, B = h/e), host, and master/media/segment status on the own and the other edge.
  // Read-only.   node test/tv-page-run.mjs test/tv-ph-renders.page.js 3
  var C = window.__C, ph = C.SOURCES.filter(function (x) { return x.id === 'pornhub'; })[0];
  var b = await ph.browse('', 1, (ph.cfg.sorts[0] || {}).id || ''), v = b.items[parseInt(arg, 10) || 0];
  var REF = 'https://www.pornhub.com/', out = { card: (v.title || '').slice(0, 40), renders: [] };
  async function st(u, range) { try { var r = await fetch(u, range ? { headers: { Range: 'bytes=0-1' } } : {}); return { s: r.status, t: range ? '' : await r.text() }; } catch (e) { return { s: 'ERR', t: '' }; } }
  function first(t) { return (String(t).split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l && l[0] !== '#'; })[0]) || ''; }
  async function chain(master) {
    var m = await st(C.buildProxyUrl(master, REF)), media = first(m.t);
    if (!media) return m.s + '';
    var mt = await st(media), seg = first(mt.t);
    var sg = seg ? await st(seg, true) : { s: '-' };
    return m.s + '/' + mt.s + '/' + sg.s;
  }
  for (var i = 0; i < 5; i++) {
    var page = await st(C.buildProxyUrl(v.url + (v.url.indexOf('?') < 0 ? '?' : '&') + 'r=' + i + Date.now(), REF));
    var fm = page.t.match(/var\s+flashvars_\d+\s*=\s*(\{[\s\S]+?\});\s*\n/);
    if (!fm) { out.renders.push({ page: page.s, flashvars: false }); continue; }
    var hls = (JSON.parse(fm[1]).mediaDefinitions || []).filter(function (d) { return d.format === 'hls' && d.videoUrl; })
      .sort(function (a, c) { return (parseInt(c.quality, 10) || 0) - (parseInt(a.quality, 10) || 0); });
    var top = hls[0] && hls[0].videoUrl.replace(/\\\//g, '/');
    if (!top) { out.renders.push({ page: page.s, hls: 0 }); continue; }
    var other = top.replace(/^https?:\/\/(hv-h|ev-h)\.phncdn\.com\//, function (m, e) { return 'https://' + (e === 'hv-h' ? 'ev-h' : 'hv-h') + '.phncdn.com/'; });
    out.renders.push({ scheme: /validfrom=/.test(top) ? 'A' : (/[?&]h=/.test(top) ? 'B' : '?'), host: top.split('/')[2], own: await chain(top), other: await chain(other) });
  }
  return out;
})
