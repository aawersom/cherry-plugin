(function (arg) {
  // Push the REAL Cherry home (cherry_main) and list the rendered tile titles — proves which
  // channels are offered to the user (e.g. Huyamba present, 24Rolika hidden).
  //   node test/tv-page-run.mjs test/tv-main-tiles.page.js run   (plugin injected by the runner)
  try { if (Lampa.Screensaver && Lampa.Screensaver.stop) Lampa.Screensaver.stop(); } catch (e) {}
  Lampa.Activity.push({ component: 'cherry_main', title: 'Cherry', page: 1 });
  return new Promise(function (res) {
    setTimeout(function () {
      var el = Lampa.Activity.active().activity.render();
      var titles = $(el).find('.card__title').map(function () { return $(this).text().trim(); }).get();
      res({ tiles: titles.length, titles: titles, hasHuyamba: titles.indexOf('Huyamba') !== -1, has24rolika: titles.indexOf('24Rolika') !== -1 });
    }, 3500);
  });
})
