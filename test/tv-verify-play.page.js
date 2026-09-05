(function (arg) {
  // FAITHFUL per-channel playback check: calls the plugin's OWN playVideo with the device's
  // ACTUAL player setting (not forced), captures the URL handed to Lampa.Player, then:
  //   • HLS  → the plugin switched to the inner player, so read <video> + hls.js state.
  //   • MP4  → the external player receives the URL; verify it with an on-device Range fetch
  //            (Referer = card page, mirroring the external player) → ftyp/valid = OPENS.
  // Verdict: PLAYS (inner currentTime>0 or readyState>=3) / OPENS (mp4 Range = video) / FAIL.
  //   node test/tv-page-run.mjs test/tv-verify-play.page.js "<sourceId>:<waitMs>[:<idx>]"
  var parts = String(arg).split(':'), sid = parts[0], waitMs = parseInt(parts[1], 10) || 16000, idx = parseInt(parts[2], 10) || 0;
  var C = window.__C, s = C.SOURCES.filter(function (x) { return x.id === sid; })[0];
  try { if (Lampa.Screensaver && Lampa.Screensaver.stop) Lampa.Screensaver.stop(); } catch (e) {}
  try { Lampa.Controller.toggle('content'); } catch (e) {}
  var sort0 = (s.cfg && s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '';
  var out = { id: sid }, handed = null, origPlay = Lampa.Player.play, hlsErr = [];
  var OrigHls = window.Hls;
  if (OrigHls && !OrigHls.__w) { var W = function (c) { var h = new OrigHls(c); try { h.on(OrigHls.Events.ERROR, function (e, d) { if (d.fatal) hlsErr.push(d.type + '/' + d.details + (d.response ? ' http' + d.response.code : '')); }); } catch (x) {} return h; }; for (var k in OrigHls) if (OrigHls.hasOwnProperty(k)) W[k] = OrigHls[k]; W.prototype = OrigHls.prototype; W.__w = 1; W.__o = OrigHls; window.Hls = W; }
  var handedUrl0 = null;
  Lampa.Player.play = function (o) { handed = o; handedUrl0 = o && o.url; return origPlay.apply(this, arguments); };
  function nat(u, ref) { return new Promise(function (res) { var r = new Lampa.Reguest(); r.native(u, function (d) { r.clear(); res({ ok: true, head: String(d).slice(0, 30) }); }, function (e) { r.clear(); res({ ok: false, e: String(e && e.status || e) }); }, false, { dataType: 'text', timeout: 12000, headers: ref ? { 'Range': 'bytes=0-2000', 'Referer': ref } : { 'Range': 'bytes=0-2000' } }); }); }
  function finish() { Lampa.Player.play = origPlay; try { Lampa.Player.close && Lampa.Player.close(); } catch (e) {} if (window.Hls && window.Hls.__o) window.Hls = window.Hls.__o; }
  return s.browse('', 1, sort0).then(function (b) {
    var v = (b.items || [])[idx];
    if (!v) { out.result = 'NO CARDS'; return out; }
    out.card = (v.title || '').slice(0, 34); out.player = Lampa.Storage.get('player', 'inner');
    C.playVideo(v, s);
    return new Promise(function (r) { setTimeout(r, waitMs); }).then(function () {
      out.handed = handed ? String(handed.url || '').slice(0, 90) : null;
      out.handedAtCall = handedUrl0 ? String(handedUrl0).slice(0, 90) : null; out.lampaQualityPref = Lampa.Storage.get('video_quality_default', '');
      out.via = !handed ? '' : (/sslip\.io/.test(handed.url) ? 'VPS' : (/workers\.dev/.test(handed.url) ? 'CF' : 'raw'));
      out.kind = handed && /m3u8|mpegurl/i.test(handed.url) ? 'hls' : 'mp4';
      if (out.kind === 'hls') {
        var els = Array.prototype.slice.call(document.querySelectorAll('video')).filter(function (x) { return !/apple\.com|sylvan/.test(x.currentSrc || x.src || ''); });
        var el = els[els.length - 1];
        out.hlsErr = hlsErr.slice(0, 3);
        if (el) { out.readyState = el.readyState; out.currentTime = Math.round(el.currentTime * 10) / 10; }
        // No user gesture in a CDP-driven run → autoplay may be withheld while data is buffered;
        // a real remote press grants it. Nudge play() once and re-read.
        if (el && !hlsErr.length && el.paused && el.currentTime === 0 && el.readyState >= 2) {
          try { var pp = el.play(); if (pp && pp.catch) pp.catch(function () {}); } catch (e) {}
          return new Promise(function (r) { setTimeout(r, 4000); }).then(function () {
            out.readyState = el.readyState; out.currentTime = Math.round(el.currentTime * 10) / 10; out.nudged = true;
            out.result = el.currentTime > 0 ? 'PLAYS' : 'NOT-READY';
            finish(); return out;
          });
        }
        out.result = hlsErr.length ? 'FAIL' : ((el && el.currentTime > 0) ? 'PLAYS' : 'NOT-READY');
        finish(); return out;
      }
      // mp4 → external player path: Range-fetch the handed url with the card's page Referer.
      finish();
      if (!handed || !handed.url) { out.result = 'NO URL'; return out; }
      return nat(String(handed.url), v.url).then(function (f) {
        out.fetch = f.ok ? f.head.replace(/[^\x20-\x7e]/g, '.') : ('ERR ' + f.e);
        out.result = f.ok ? (/ftyp|#EXTM3U/.test(f.head) ? 'OPENS' : 'BYTES?') : 'FAIL';
        return out;
      });
    });
  }).catch(function (e) { finish(); out.result = 'ERR ' + String(e).slice(0, 70); return out; });
})
