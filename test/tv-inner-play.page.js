(async function (arg) {
  // Does a channel's video REALLY start in Lampa's inner player? playVideo(card #idx) through the plugin,
  // then read the <video> element: src, readyState, currentTime, MediaError.
  //   node test/tv-page-run.mjs test/tv-inner-play.page.js "youjizz:0:20000"
  var p = String(arg).split(':'), sid = p[0], idx = parseInt(p[1], 10) || 0, waitMs = parseInt(p[2], 10) || 20000;
  var C = window.__C, s = C.SOURCES.filter(function (x) { return x.id === sid; })[0];
  try { if (Lampa.Screensaver && Lampa.Screensaver.stop) Lampa.Screensaver.stop(); } catch (e) {}
  var b = await s.browse('', 1, (s.cfg.sorts[0] || {}).id || ''), v = b.items[idx];
  var handed = null, orig = Lampa.Player.play;
  Lampa.Player.play = function (o) { handed = o; return orig.apply(this, arguments); };
  C.playVideo(v, s);
  await new Promise(function (r) { setTimeout(r, waitMs); });
  Lampa.Player.play = orig;
  var vids = [].slice.call(document.querySelectorAll('video')).map(function (el) {
    return { src: String(el.currentSrc || el.src || '').slice(0, 100), readyState: el.readyState, networkState: el.networkState,
      currentTime: Math.round(el.currentTime * 10) / 10, paused: el.paused, error: el.error ? (el.error.code + ':' + (el.error.message || '')) : null,
      w: el.videoWidth, h: el.videoHeight };
  });
  // what the media element actually got (Resource Timing: status, bytes, type)
  var res = performance.getEntriesByType('resource').filter(function (e) { return handed && e.name.indexOf(String(handed.url).split('?')[0].slice(0, 60)) === 0; })
    .map(function (e) { return { type: e.initiatorType, status: e.responseStatus, bytes: e.transferSize, dur: Math.round(e.duration), mime: e.contentType }; });
  var out = { card: (v.title || '').slice(0, 34), player: Lampa.Storage.get('player', 'inner'), mediaRequests: res, fullUrl: handed && String(handed.url),
    handed: handed && String(handed.url).slice(0, 100), qualities: handed && Object.keys(handed.quality || {}), videos: vids,
    playerOpen: !!document.querySelector('.player'), errText: ($('.player-info__error, .player .error, .player__error').text() || '').trim().slice(0, 100) };
  try { Lampa.Player.close(); } catch (e) {}
  return out;
})
