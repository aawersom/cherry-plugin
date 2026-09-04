(function (arg) {
  // Play a source's first card in Lampa's INNER (WebView <video>) player and report the
  // element's real outcome (error code / networkState) after 9 s — evidence of hotlink/
  // Referer policies that the external player never hits. Restores the player setting.
  //   node test/tv-page-run.mjs test/tv-play-inner.page.js <sourceId>
  var C = window.__C, s = C.SOURCES.filter(function (x) { return x.id === arg; })[0];
  var prev = Lampa.Storage.get('player', 'inner');
  try { if (Lampa.Screensaver && Lampa.Screensaver.stop) Lampa.Screensaver.stop(); } catch (e) {}
  try { Lampa.Controller.toggle('content'); } catch (e) {}
  Lampa.Storage.set('player', 'inner');
  return s.browse('', 1, (s.cfg && s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '').then(function (b) {
    var v = b.items[0];
    return s.getStream(v).then(function (st) {
      var url = st.url;
      if (C._forceProxyAndroid(url)) url = C.buildProxyUrl(url);
      Lampa.Player.play({ url: url, title: v.title || arg });
      return new Promise(function (res) {
        setTimeout(function () {
          var els = Array.prototype.slice.call(document.querySelectorAll('video')).filter(function (x) { return !/apple\.com|sylvan/.test(x.currentSrc || x.src || ''); }); var el = els[els.length - 1];
          var out = { prevPlayer: prev, stream: st.url.slice(0, 90), handed: url.slice(0, 90), hasVideoEl: !!el };
          if (el) { out.err = el.error ? el.error.code : 0; out.errMsg = el.error ? el.error.message : ''; out.readyState = el.readyState; out.networkState = el.networkState; out.currentTime = el.currentTime; out.src = (el.currentSrc || el.src || '').slice(0, 90); }
          try { Lampa.Player.close && Lampa.Player.close(); } catch (e) {}
          Lampa.Storage.set('player', prev);
          res(out);
        }, 9000);
      });
    });
  });
})
