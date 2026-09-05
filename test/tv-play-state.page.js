(function (arg) {
  // Why does an HLS stream buffer but not play? Runs the plugin's playVideo, then reports the
  // <video> paused/buffered/hls.js state; if paused with data, calls play() and re-reads.
  //   node test/tv-page-run.mjs test/tv-play-state.page.js "<sourceId>:<waitMs>"
  var parts = String(arg).split(':'), sid = parts[0], waitMs = parseInt(parts[1], 10) || 15000;
  var C = window.__C, s = C.SOURCES.filter(function (x) { return x.id === sid; })[0];
  try { if (Lampa.Screensaver && Lampa.Screensaver.stop) Lampa.Screensaver.stop(); } catch (e) {}
  try { Lampa.Controller.toggle('content'); } catch (e) {}
  var evts = [], OrigHls = window.Hls;
  if (OrigHls && !OrigHls.__w2) { var W = function (c) { var h = new OrigHls(c); try { h.on(OrigHls.Events.ERROR, function (e, d) { evts.push('ERR ' + d.type + '/' + d.details + (d.fatal ? ' FATAL' : '') + (d.response ? ' http' + d.response.code : '')); }); h.on(OrigHls.Events.MANIFEST_PARSED, function () { evts.push('MANIFEST_PARSED'); }); h.on(OrigHls.Events.LEVEL_LOADED, function () { evts.push('LEVEL_LOADED'); }); h.on(OrigHls.Events.FRAG_LOADED, function () { if (evts.indexOf('FRAG_LOADED') < 0) evts.push('FRAG_LOADED'); }); h.on(OrigHls.Events.BUFFER_APPENDED, function () { if (evts.indexOf('BUFFER_APPENDED') < 0) evts.push('BUFFER_APPENDED'); }); } catch (x) {} return h; }; for (var k in OrigHls) if (OrigHls.hasOwnProperty(k)) W[k] = OrigHls[k]; W.prototype = OrigHls.prototype; W.__w2 = 1; W.__o = OrigHls; window.Hls = W; }
  var sort0 = (s.cfg && s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '';
  var out = { id: sid }, handed = null, origPlay = Lampa.Player.play;
  Lampa.Player.play = function (o) { handed = o; return origPlay.apply(this, arguments); };
  function snap(el) { var b = []; try { for (var i = 0; i < el.buffered.length; i++) b.push([Math.round(el.buffered.start(i) * 10) / 10, Math.round(el.buffered.end(i) * 10) / 10]); } catch (e) {} return { paused: el.paused, ended: el.ended, muted: el.muted, rs: el.readyState, ns: el.networkState, t: Math.round(el.currentTime * 10) / 10, dur: Math.round(el.duration || 0), buffered: JSON.stringify(b), err: el.error ? el.error.code + ' ' + el.error.message : '', src: (el.currentSrc || el.src || '').slice(0, 40) }; }
  function finish() { Lampa.Player.play = origPlay; try { Lampa.Player.close && Lampa.Player.close(); } catch (e) {} if (window.Hls && window.Hls.__o) window.Hls = window.Hls.__o; }
  return s.browse('', 1, sort0).then(function (b) {
    var v = (b.items || [])[0]; if (!v) { finish(); out.result = 'NO CARDS'; return out; }
    out.card = (v.title || '').slice(0, 30); out.player = Lampa.Storage.get('player', 'inner');
    C.playVideo(v, s);
    return new Promise(function (r) { setTimeout(r, waitMs); }).then(function () {
      out.handed = handed ? String(handed.url || '').slice(0, 100) : null; out.hasQualityMap = !!(handed && handed.quality && Object.keys(handed.quality).length);
      var els = Array.prototype.slice.call(document.querySelectorAll('video')).filter(function (x) { return !/apple\.com|sylvan/.test(x.currentSrc || x.src || ''); });
      out.videoCount = els.length; var el = els[els.length - 1];
      out.hls = evts.slice(0, 8);
      if (!el) { out.result = 'NO PLAYER'; finish(); return out; }
      out.state1 = snap(el);
      if (el.paused && !el.error) { var p = el.play(); if (p && p.then) p.catch(function (e) { out.playErr = String(e).slice(0, 80); }); }
      return new Promise(function (r) { setTimeout(r, 5000); }).then(function () { out.state2 = snap(el); out.result = out.state2.t > 0 ? 'PLAYS' : (out.state1.paused ? 'PAUSED-NO-AUTOPLAY' : 'STALLED'); finish(); return out; });
    });
  }).catch(function (e) { finish(); out.result = 'ERR ' + String(e).slice(0, 60); return out; });
})
