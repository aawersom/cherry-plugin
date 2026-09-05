(function (arg) {
  // Open a channel grid the way the home tile does and report what rendered.
  //   node test/tv-eval.mjs test/tv-grid-open.page.js "<sourceId>"            (channel feed)
  //   node test/tv-eval.mjs test/tv-grid-open.page.js "favorites"             (favorites grid)
  var parts = String(arg).split(':'), sid = parts[0], waitMs = parseInt(parts[1], 10) || 9000;
  try { if (Lampa.Screensaver && Lampa.Screensaver.stop) Lampa.Screensaver.stop(); } catch (e) {}
  var ver = (window.Lampa && Lampa.Storage && Lampa.Storage.get('cherry_version_seen')) || '';
  var obj = sid === 'favorites'
    ? { component: 'cherry_grid', title: 'Избранное', source_id: 'pornhub', is_favorites: true, page: 1 }
    : { component: 'cherry_grid', title: sid, source_id: sid, page: 1 };
  Lampa.Activity.push(obj);
  return new Promise(function (res) {
    setTimeout(function () {
      var act = Lampa.Activity.active(), el = act && act.activity && act.activity.render();
      var $el = $(el);
      res({
        sid: sid,
        component: act && act.component,
        cards: $el.find('.card').length,
        imgs: $el.find('.card__img').filter(function () { return this.complete && this.naturalWidth > 0; }).length,
        empty: $el.find('.empty, .cherry-empty, .empty__title').text().trim().slice(0, 120),
        controller: Lampa.Controller.enabled() && Lampa.Controller.enabled().name,
        focused: $el.find('.card.focus').length,
        cherryVersion: (typeof CHERRY_VERSION !== 'undefined' ? CHERRY_VERSION : ver)
      });
    }, waitMs);
  });
})
