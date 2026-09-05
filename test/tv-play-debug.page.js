(function (arg) {
  // Deep playback debug through the plugin's OWN playVideo: full handed URL, hls.js error events
  // (constructor wrapped), <video> error, and on-device Range fetches of the handed URL with and
  // without a lampa.mx Referer (what the WebView <video> sends vs the external player).
  //   node test/tv-page-run.mjs test/tv-play-debug.page.js "<sourceId>:<waitMs>"
  var parts = String(arg).split(':'), sid = parts[0], waitMs = parseInt(parts[1], 10) || 25000;
  var C = window.__C, s = C.SOURCES.filter(function (x) { return x.id === sid; })[0];
  var prev = Lampa.Storage.get('player', 'inner');
  try { if (Lampa.Screensaver && Lampa.Screensaver.stop) Lampa.Screensaver.stop(); } catch (e) {}
  try { Lampa.Controller.toggle('content'); } catch (e) {}
  Lampa.Storage.set('player', 'inner');
  var hlsErrors = [], OrigHls = window.Hls;
  if (OrigHls && !OrigHls.__wrapped) {
    var W = function (cfg) { var h = new OrigHls(cfg); try { h.on(OrigHls.Events.ERROR, function (ev, d) { hlsErrors.push([d.type, d.details, d.fatal ? 'fatal' : '', d.response ? ('http ' + d.response.code) : '', (d.url || (d.frag && d.frag.url) || '').slice(0, 80)].join(' ')); }); } catch (e) {} return h; };
    for (var k in OrigHls) if (OrigHls.hasOwnProperty(k)) W[k] = OrigHls[k];
    W.prototype = OrigHls.prototype; W.__wrapped = true; W.__orig = OrigHls; window.Hls = W;
  }
  var sort0 = (s.cfg && s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '';
  var out = { id: sid }, handed = null, origPlay = Lampa.Player.play;
  Lampa.Player.play = function (o) { handed = o; return origPlay.apply(this, arguments); };
  function nat(u, hdrs) { return new Promise(function (res) { var r = new Lampa.Reguest(); r.native(u, function (d) { r.clear(); res('OK ' + String(d).length + 'B ' + String(d).slice(0, 40).replace(/[^\x20-\x7e]/g, '.')); }, function (e) { r.clear(); res('ERR ' + String(e && e.status || e)); }, false, { dataType: 'text', timeout: 12000, headers: hdrs }); }); }
  function finish() { Lampa.Player.play = origPlay; try { Lampa.Player.close && Lampa.Player.close(); } catch (e) {} Lampa.Storage.set('player', prev); if (window.Hls && window.Hls.__orig) window.Hls = window.Hls.__orig; }
  return s.browse('', 1, sort0).then(function (b) {
    var v = (b.items || [])[0];
    if (!v) { finish(); out.result = 'NO CARDS'; return out; }
    out.card = (v.title || '').slice(0, 40);
    C.playVideo(v, s);
    return new Promise(function (res) { setTimeout(res, waitMs); }).then(function () {
      var els = Array.prototype.slice.call(document.querySelectorAll('video')).filter(function (x) { return !/apple\.com|sylvan/.test(x.currentSrc || x.src || ''); });
      var el = els[els.length - 1];
      out.handed = handed ? String(handed.url || '') : null;
      out.hlsErrors = hlsErrors.slice(0, 6);
      if (el) { out.videoSrc = (el.currentSrc || el.src || '').slice(0, 60); out.err = el.error ? (el.error.code + ' ' + el.error.message) : ''; out.readyState = el.readyState; out.networkState = el.networkState; out.currentTime = Math.round(el.currentTime * 10) / 10; out.result = el.error ? 'ERROR' : (el.currentTime > 0 ? 'PLAYS' : 'NOT-STARTED'); }
      else out.result = 'NO PLAYER';
      if (!handed || !handed.url) return;
      var u = String(handed.url);
      return nat(u, { 'Range': 'bytes=0-1000' }).then(function (a) { out.fetchNoRef = a; return nat(u, { 'Range': 'bytes=0-1000', 'Referer': 'http://lampa.mx/' }); }).then(function (b2) { out.fetchLampaRef = b2; });
    }).then(function () { finish(); return out; });
  }).catch(function (e) { finish(); out.result = 'ERR ' + String(e).slice(0, 80); return out; });
})
