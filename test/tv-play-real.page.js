(function (arg) {
  // End-to-end playback through the plugin's OWN playVideo (stream resolve → px() routing →
  // HLS/inner switch → Lampa.Player) in the inner WebView player; reports the <video> element
  // state after N seconds plus the URL that was handed to the player and what it serves.
  // This is the production path, not a harness re-implementation.
  //   node test/tv-page-run.mjs test/tv-play-real.page.js "<sourceId>:<waitMs>[:<cardIndex>]"
  var parts = String(arg).split(':'), sid = parts[0], waitMs = parseInt(parts[1], 10) || 20000, idx = parseInt(parts[2], 10) || 0;
  var C = window.__C, s = C.SOURCES.filter(function (x) { return x.id === sid; })[0];
  var prev = Lampa.Storage.get('player', 'inner');
  try { if (Lampa.Screensaver && Lampa.Screensaver.stop) Lampa.Screensaver.stop(); } catch (e) {}
  try { Lampa.Controller.toggle('content'); } catch (e) {}
  Lampa.Storage.set('player', 'inner');
  var sort0 = (s.cfg && s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '';
  var t0 = Date.now(), out = { id: sid }, handed = null;
  var origPlay = Lampa.Player.play;
  Lampa.Player.play = function (o) { handed = o; return origPlay.apply(this, arguments); };
  function nat(u) { return new Promise(function (res) { var r = new Lampa.Reguest(); r.native(u, function (d) { r.clear(); res({ ok: true, d: String(d) }); }, function (e) { r.clear(); res({ ok: false, e: String(e && e.status || e) }); }, false, { dataType: 'text', timeout: 12000, headers: { 'Range': 'bytes=0-2000' } }); }); }
  function finish() { Lampa.Player.play = origPlay; try { Lampa.Player.close && Lampa.Player.close(); } catch (e) {} Lampa.Storage.set('player', prev); }
  return s.browse('', 1, sort0).then(function (b) {
    var v = (b.items || [])[idx];
    out.cards = (b.items || []).length;
    if (!v) { finish(); out.result = 'NO CARDS'; return out; }
    out.card = (v.title || '').slice(0, 40);
    C.playVideo(v, s);   // production path
    return Promise.resolve().then(function () {
      return new Promise(function (res) {
        setTimeout(function () {
          var els = Array.prototype.slice.call(document.querySelectorAll('video')).filter(function (x) { return !/apple\.com|sylvan/.test(x.currentSrc || x.src || ''); });
          var el = els[els.length - 1];
          out.ms = Date.now() - t0;
          out.handed = handed ? String(handed.url || '').slice(0, 130) : null;
          out.via = !handed ? '' : (/sslip\.io/.test(handed.url) ? 'VPS' : (/workers\.dev/.test(handed.url) ? 'CF' : 'raw'));
          out.kind = handed && /m3u8|mpegurl/i.test(handed.url) ? 'hls' : 'mp4';
          out.hlsjs = typeof window.Hls !== 'undefined';
          if (el) {
            out.videoSrc = (el.currentSrc || el.src || '').slice(0, 60);
            out.err = el.error ? (el.error.code + ' ' + el.error.message) : '';
            out.readyState = el.readyState; out.networkState = el.networkState; out.currentTime = Math.round(el.currentTime * 10) / 10;
            out.result = el.error ? 'ERROR' : (el.currentTime > 0 ? 'PLAYS' : (el.readyState >= 2 ? 'LOADED-NOT-PLAYING' : 'NOT-STARTED'));
          } else out.result = 'NO PLAYER';
          res();
        }, waitMs);
      });
    }).then(function () {
      if (!handed || !handed.url) return out;
      return nat(String(handed.url)).then(function (r) {
        out.handedFetch = r.ok ? ('OK ' + r.d.slice(0, 160).replace(/\s+/g, ' ')) : ('ERR ' + r.e);
        return out;
      });
    }).then(function () { finish(); return out; });
  }).catch(function (e) { finish(); out.result = 'ERR ' + String(e).slice(0, 80); return out; });
})
