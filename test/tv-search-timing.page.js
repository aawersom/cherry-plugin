(function (q) {
  // Global search timing: card count on screen every 500 ms for 10 s after opening the grid.
  //   node test/tv-ui-run.mjs test/tv-search-timing.page.js "блондинка"   (local plugin)
  //   node test/tv-eval.mjs   test/tv-search-timing.page.js "блондинка"   (as deployed)
  try { if (Lampa.Screensaver && Lampa.Screensaver.stop) Lampa.Screensaver.stop(); } catch (e) {}
  Lampa.Activity.push({ component: 'cherry_grid', title: 'Поиск: ' + q, source_id: 'pornhub', query: q, all_sources: true, page: 1 });
  var t0 = Date.now(), samples = [], firstAt = null;
  return new Promise(function (res) {
    var iv = setInterval(function () {
      var act = Lampa.Activity.active(), n = $(act.activity.render()).find('.card').length;
      if (n && firstAt === null) firstAt = Date.now() - t0;
      samples.push(n);
      if (Date.now() - t0 > 10000) {
        clearInterval(iv);
        res({ firstCardsMs: firstAt, final: n, per500ms: samples.join(','), focused: $(act.activity.render()).find('.card.focus').length });
      }
    }, 500);
  });
})
