(function (arg) {
  // «Похожие» grid as the user gets it (after tv-page-run stored a seed card):
  //   node test/tv-page-run.mjs test/tv-related-grid.page.js "seed:<sourceId>[:<idx>]"   → stores window.__relSeed
  //   node test/tv-ui-run.mjs   test/tv-related-grid.page.js "open"                     → pushes the related grid, reports
  var parts = String(arg).split(':');
  if (parts[0] === 'seed') {
    var s = window.__C.SOURCES.filter(function (x) { return x.id === parts[1]; })[0], idx = parseInt(parts[2], 10) || 0;
    return s.browse('', 1, (s.cfg && s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '').then(function (b) {
      var v = b.items[idx]; window.__relSeed = { video: v, source: s.id };
      return { seed: v.title, url: v.url };
    });
  }
  try { if (Lampa.Screensaver && Lampa.Screensaver.stop) Lampa.Screensaver.stop(); } catch (e) {}
  var seed = window.__relSeed;
  Lampa.Activity.push({ component: 'cherry_grid', title: 'Похожие', source_id: seed.source, related_video: seed.video, related_video_source: seed.source, page: 1 });
  return new Promise(function (res) {
    setTimeout(function () {
      var $el = $(Lampa.Activity.active().activity.render());
      var titles = $el.find('.card').map(function () { return $(this).find('.card__title').text().trim(); }).get();
      var norm = function (t) { return t.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, ' ').trim(); };
      var seen = {}, dups = 0; titles.forEach(function (t) { var k = norm(t); if (seen[k]) dups++; seen[k] = 1; });
      res({ seed: seed.video.title, cards: titles.length, sameAsSeed: titles.filter(function (t) { return norm(t) === norm(seed.video.title); }).length,
            dupTitles: dups, first: titles.slice(0, 6).map(function (t) { return t.slice(0, 50); }) });
    }, 12000);
  });
})
