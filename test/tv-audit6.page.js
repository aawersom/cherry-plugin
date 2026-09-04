(async function (cid) {
  var C = window.__C, s = C.SOURCES.filter(function (x) { return x.id === cid; })[0];
  var out = { id: cid };
  function wt(p, ms, fb) { return Promise.race([Promise.resolve().then(function () { return p; }), new Promise(function (r) { setTimeout(function () { r(fb); }, ms); })]); }
  function ids(a) { return (a || []).map(function (v) { return String(v.id); }); }
  function overlapPct(a, b) { if (!a.length || !b.length) return -1; var m = {}; a.forEach(function (x) { m[x] = 1; }); var n = b.filter(function (x) { return m[x]; }).length; return Math.round(100 * n / Math.min(a.length, b.length)); }
  function pct(a, f) { return a.length ? Math.round(100 * a.filter(f).length / a.length) : -1; }
  var sort0 = (s.cfg && s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '';
  var cat0 = (s.cfg && s.cfg.categories && s.cfg.categories[0] && s.cfg.categories[0].id) || '';
  var isRu = !!C._RU_SOURCES[cid];
  var q1 = isRu ? 'блондинка' : 'blonde', q2 = isRu ? 'азиатка' : 'asian', stem1 = isRu ? 'блондин' : 'blond', stem2 = isRu ? 'азиат' : 'asian';

  // browse p1/p2
  var t0 = Date.now(); var b1 = await wt(s.browse('', 1, sort0), 20000, null); out.ms = Date.now() - t0;
  var i1 = (b1 && b1.items) || []; out.n = i1.length;
  out.thumb = pct(i1, function (v) { return /^https?:\/\//.test(v.thumb || ''); });
  out.clip = pct(i1, function (v) { return !!(v.preview && String(v.preview).trim()); });
  out.dur = pct(i1, function (v) { return v.duration > 0; });
  var b2 = await wt(s.browse('', 2, sort0), 20000, null); var i2 = (b2 && b2.items) || [];
  out.p2 = i2.length ? (100 - overlapPct(ids(i1), ids(i2))) : -1;   // % NEW cards on page 2
  // category filter (set-overlap with the plain feed; low = real filter)
  if (cat0) { var c1 = await wt(s.browse(cat0, 1, sort0), 20000, null); var ci = (c1 && c1.items) || []; out.catN = ci.length; out.catOv = overlapPct(ids(i1), ids(ci)); } else { out.catN = '-'; out.catOv = '-'; }
  // search: query honoured? relevance? page 2?
  if (s.search) {
    var sa = (await wt(s.search(q1, 1), 20000, null)); var a = (sa && sa.items) || [];
    var sb = (await wt(s.search(q2, 1), 20000, null)); var b = (sb && sb.items) || [];
    var sa2 = (await wt(s.search(q1, 2), 20000, null)); var a2 = (sa2 && sa2.items) || [];
    out.sN = a.length; out.sMatch = pct(a, function (v) { return String(v.title || '').toLowerCase().indexOf(stem1) !== -1; });
    out.sHonour = (a.length && b.length) ? (a[0].id !== b[0].id ? 'ok' : 'SAME') : '?';
    out.sP2 = a2.length ? (100 - overlapPct(ids(a), ids(a2))) : -1;
  } else { out.sN = '-'; out.sMatch = '-'; out.sHonour = '-'; out.sP2 = '-'; }
  // related + models
  try { if (s.getRelated && i1[0]) { var rel = await wt(s.getRelated(i1[0], 1), 20000, null); out.rel = (rel || []).length; } else out.rel = '-'; } catch (e) { out.rel = 'E'; }
  try { if (typeof s.getModels === 'function') { var mods = await wt(s.getModels(1), 20000, null); out.models = (mods || []).length; } else out.models = '-'; } catch (e) { out.models = 'E'; }
  // playback: device-IP fetch (Range + Referer) of the resolved stream
  try {
    if (i1[0] && s.getStream) {
      var st = await wt(s.getStream(i1[0]), 25000, null);
      var url = st ? (C.bestQualityUrl(st.quality || {}) || st.url) : '';
      if (!url) out.play = 'nourl';
      else {
        var u = url.indexOf('//') === 0 ? 'https:' + url : url;
        var fin = C._forceProxyAndroid(u) ? C.buildProxyUrl(u) : u;
        out.kind = /m3u8|mpegurl/i.test(u) ? 'hls' : 'mp4';
        var f = await wt(new Promise(function (res) { var req = new Lampa.Reguest(); req.native(fin, function (d) { req.clear(); res({ ok: true, d: String(d) }); }, function (e) { req.clear(); res({ ok: false, e: String(e && e.status || e) }); }, false, { dataType: 'text', timeout: 12000, headers: { 'Range': 'bytes=0-63', 'Referer': i1[0].url } }); }), 15000, { ok: false, e: 'timeout' });
        if (!f.ok) out.play = 'ERR ' + f.e; else { var h = f.d.slice(0, 80); out.play = h.indexOf('ftyp') >= 0 ? 'MP4' : (h.indexOf('#EXTM3U') >= 0 ? 'HLS' : (/^\s*</.test(h) ? 'HTML' : 'bytes' + f.d.length)); }
      }
    } else out.play = '-';
  } catch (e) { out.play = 'E ' + String(e).slice(0, 20); }
  return out;
})
