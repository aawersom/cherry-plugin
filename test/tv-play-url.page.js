(function (arg) {
  // Play an arbitrary stream URL in Lampa's INNER (WebView <video>) player and report the element
  // state after N seconds — for A/B checks of stream hosts/qualities without an adapter.
  //   node test/tv-page-run.mjs test/tv-play-url.page.js "<url>|<waitMs>"
  var parts = String(arg).split('|'), url = parts[0], waitMs = parseInt(parts[1], 10) || 12000;
  var prev = Lampa.Storage.get('player', 'inner');
  try { if (Lampa.Screensaver && Lampa.Screensaver.stop) Lampa.Screensaver.stop(); } catch (e) {}
  try { Lampa.Controller.toggle('content'); } catch (e) {}
  Lampa.Storage.set('player', 'inner');
  Lampa.Player.play({ url: url, title: 'probe' });
  return new Promise(function (res) {
    setTimeout(function () {
      var els = Array.prototype.slice.call(document.querySelectorAll('video')).filter(function (x) { return (x.currentSrc || x.src || '').indexOf(url.slice(0, 60)) === 0; });
      var el = els[els.length - 1];
      var out = { url: url.slice(0, 100), matched: els.length };
      if (el) { out.err = el.error ? el.error.code : 0; out.errMsg = el.error ? el.error.message : ''; out.readyState = el.readyState; out.networkState = el.networkState; out.currentTime = el.currentTime; }
      try { Lampa.Player.close && Lampa.Player.close(); } catch (e) {}
      Lampa.Storage.set('player', prev);
      res(out);
    }, waitMs);
  });
})
