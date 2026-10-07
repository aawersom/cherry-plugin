(function (sid) {
  // After an HLS play (playVideo forces the inner player) the user's player setting must come back
  // (else every later MP4 opens in the inner player). Samples Lampa.Storage 'player' for 12 s.
  //   node test/tv-page-run.mjs test/tv-player-restore.page.js "<hls sourceId>"
  var C = window.__C, s = C.SOURCES.filter(function (x) { return x.id === sid; })[0];
  Lampa.Storage.set('player', 'android');
  var log = [];
  return s.browse('', 1, (s.cfg && s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '').then(function (b) {
    var t0 = Date.now();
    C.playVideo(b.items[0], s);
    return new Promise(function (res) {
      var iv = setInterval(function () {
        log.push(Math.round((Date.now() - t0) / 1000) + 's:' + Lampa.Storage.get('player'));
        if (Date.now() - t0 > 12000) {
          clearInterval(iv);
          try { Lampa.Player.close(); } catch (e) {}
          setTimeout(function () { log.push('afterClose:' + Lampa.Storage.get('player')); res(log); }, 1500);
        }
      }, 1000);
    });
  });
})
