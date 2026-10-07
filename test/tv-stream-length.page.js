(async function (arg) {
  // Is the resolved stream the FULL video? Range-fetch the start of the MP4 and read the moov/mvhd
  // duration (when moov is up front), compare with the card duration. Also flags preview/trailer
  // names. A 10–30 s file for a 20-min card = a hover clip handed over as the video.
  //   node test/tv-page-run.mjs test/tv-stream-length.page.js "<id,id,...>"
  var C = window.__C, out = {};
  function bin(u) {
    return new Promise(function (res) {
      var x = new XMLHttpRequest(); x.open('GET', u); x.responseType = 'arraybuffer'; x.setRequestHeader('Range', 'bytes=0-262143');
      x.timeout = 15000; x.onload = function () { res(new Uint8Array(x.response || new ArrayBuffer(0))); }; x.onerror = x.ontimeout = function () { res(null); }; x.send();
    });
  }
  function mvhd(b) {
    if (!b) return -1;
    for (var i = 0; i < b.length - 32; i++) {
      if (b[i] === 0x6d && b[i + 1] === 0x76 && b[i + 2] === 0x68 && b[i + 3] === 0x64) {
        var v = b[i + 4], o = i + 8; var ts, du;
        if (v === 1) { ts = (b[o + 16] << 24 | b[o + 17] << 16 | b[o + 18] << 8 | b[o + 19]) >>> 0; du = ((b[o + 24] << 24 | b[o + 25] << 16 | b[o + 26] << 8 | b[o + 27]) >>> 0); }
        else { ts = (b[o + 8] << 24 | b[o + 9] << 16 | b[o + 10] << 8 | b[o + 11]) >>> 0; du = (b[o + 12] << 24 | b[o + 13] << 16 | b[o + 14] << 8 | b[o + 15]) >>> 0; }
        return ts ? Math.round(du / ts) : -1;
      }
    }
    return -2;  // moov not in the first 256 KB (moov at end) — can't tell
  }
  var ids = String(arg).split(',');
  for (var k = 0; k < ids.length; k++) {
    var s = C.SOURCES.filter(function (x) { return x.id === ids[k]; })[0]; if (!s) continue;
    var sort0 = (s.cfg && s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '';
    var b = await s.browse('', 1, sort0).catch(function () { return null; });
    var items = ((b && b.items) || []).slice(0, 2), res = [];
    for (var i = 0; i < items.length; i++) {
      var v = items[i];
      var st = await Promise.race([s.getStream(v).catch(function () { return null; }), new Promise(function (r) { setTimeout(function () { r(null); }, 30000); })]);
      var u = st && (st.url || C.bestQualityUrl(st.quality || {}));
      if (!u) { res.push('NOURL'); continue; }
      if (/m3u8/i.test(u)) { res.push('hls card=' + v.duration + 's'); continue; }
      if (u.indexOf('//') === 0) u = 'https:' + u;
      var fin = (C._forceProxyAndroid(u) || s.androidProxyStream) ? C.buildProxyUrl(u) : u;
      var d = mvhd(await bin(fin));
      var flag = /preview|trailer/i.test(u) ? ' PREVIEW-NAME' : '';
      res.push('card=' + v.duration + 's file=' + d + 's' + (d > 0 && v.duration > 120 && d < v.duration * 0.5 ? ' SHORT!' : '') + flag);
    }
    out[s.id] = res.join(' | ');
  }
  return out;
})
