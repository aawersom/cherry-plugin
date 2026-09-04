(function (arg) {
  // Resolve an ebun stream through the real adapter and hand it to the real Lampa player
  // (whatever the stand is configured with), so `adb logcat` shows the true HTTP outcome.
  //   node test/tv-page-run.mjs test/tv-play-ebun.page.js ebun   (or any source id)
  var C = window.__C, s = C.SOURCES.filter(function (x) { return x.id === arg; })[0];
  return s.browse('', 1, (s.cfg && s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '').then(function (b) {
    var v = b.items[0];
    return s.getStream(v).then(function (st) {
      var url = st.url;
      if (C._forceProxyAndroid(url)) url = C.buildProxyUrl(url);
      Lampa.Player.play({ url: url, title: v.title || arg });
      return { player: Lampa.Storage.get('player', 'inner'), page: v.url, stream: st.url.slice(0, 100), handed: url.slice(0, 100), ua: navigator.userAgent };
    });
  });
})
