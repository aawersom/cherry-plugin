(async function (arg) {
  // Isolate an inner-player «Format error»: play the SAME stream in a bare <video> element several ways
  // (direct / via the VPS / via the CF worker / a lower quality) and report each element's fate.
  //   node test/tv-page-run.mjs test/tv-video-direct.page.js "youjizz:0"
  var p = String(arg).split(':'), sid = p[0], idx = parseInt(p[1], 10) || 0;
  var C = window.__C, s = C.SOURCES.filter(function (x) { return x.id === sid; })[0];
  var b = await s.browse('', 1, (s.cfg.sorts[0] || {}).id || ''), v = b.items[idx];
  var st = await s.getStream(v), q = st.quality || {};
  var keys = Object.keys(q).sort(function (a, c) { return parseInt(c, 10) - parseInt(a, 10); });
  function abs(u) { return u.indexOf('//') === 0 ? 'https:' + u : u; }
  var top = abs(q[keys[0]]), low = abs(q[keys[keys.length - 1]]);
  var tries = { direct: top, vps: C.buildProxyUrl(top), cf: C.buildProxyUrl(top, '', true), directLow: low };
  function play(url) {
    return new Promise(function (resolve) {
      var el = document.createElement('video'), t0 = Date.now(), ev = [];
      el.muted = true; el.preload = 'auto'; el.style.cssText = 'position:fixed;left:-2000px;width:10px;height:10px';
      ['loadedmetadata', 'canplay', 'playing', 'error', 'stalled'].forEach(function (n) { el.addEventListener(n, function () { ev.push(n + '@' + (Date.now() - t0)); }); });
      document.body.appendChild(el);
      el.src = url; el.play().catch(function () {});
      setTimeout(function () {
        var r = { readyState: el.readyState, t: Math.round(el.currentTime * 10) / 10, w: el.videoWidth, error: el.error ? el.error.code + ':' + el.error.message : null, events: ev.join(' ') };
        el.pause(); el.removeAttribute('src'); el.load(); el.remove();
        resolve(r);
      }, 12000);
    });
  }
  var out = { card: (v.title || '').slice(0, 34), quality: keys.join(','), url: top.slice(0, 90) };
  for (var k in tries) out[k] = await play(tries[k]);
  return out;
})
