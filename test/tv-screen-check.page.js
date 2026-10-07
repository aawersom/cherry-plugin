(function (arg) {
  // Screen check for the Maker migration (v0.13.27): opens a Cherry screen the way the user does
  // and reports which framework built it, card count, Cherry decorations, focus and errors.
  //   node test/tv-ui-run.mjs test/tv-screen-check.page.js "main"
  //   node test/tv-ui-run.mjs test/tv-screen-check.page.js "grid:<sourceId>"
  //   node test/tv-ui-run.mjs test/tv-screen-check.page.js "fav" | "hist" | "search:<q>" | "empty"
  var parts = String(arg).split(':'), kind = parts[0], val = parts.slice(1).join(':');
  try { if (Lampa.Screensaver && Lampa.Screensaver.stop) Lampa.Screensaver.stop(); } catch (e) {}
  var first = (window.__cherrySources && window.__cherrySources[0]) || 'pornhub';
  var obj = kind === 'main' ? { component: 'cherry_main', title: 'Cherry', page: 1 }
    : kind === 'fav' ? { component: 'cherry_grid', title: 'Избранное', source_id: 'pornhub', is_favorites: true, page: 1 }
    : kind === 'hist' ? { component: 'cherry_grid', title: 'Продолжить', source_id: 'pornhub', is_history: true, page: 1 }
    : kind === 'search' ? { component: 'cherry_grid', title: 'Поиск: ' + val, source_id: 'pornhub', query: val, all_sources: true, page: 1 }
    : kind === 'empty' ? { component: 'cherry_grid', title: 'empty', source_id: 'pornhub', query: 'zzqqxxnotfound', page: 1 }
    : { component: 'cherry_grid', title: val, source_id: val, page: 1 };
  var errs = []; var oe = window.onerror; window.onerror = function (m) { errs.push(String(m).slice(0, 120)); };
  Lampa.Activity.push(obj);
  return new Promise(function (res) {
    setTimeout(function () {
      window.onerror = oe;
      var act = Lampa.Activity.active(), comp = act && act.activity && act.activity.component;
      var $el = $(act && act.activity && act.activity.render());
      res({
        kind: kind, maker: !!(comp && comp.use && comp.emit), component: act && act.component,
        cards: $el.find('.card').length,
        srcBadges: $el.find('.cherry-src-badge').length, durPills: $el.find('.cherry-dur').length,
        tiles: $el.find('.cherry-tile').length, dots: $el.find('.cherry-dot').length,
        cherryCat: $el.find('.cherry-cat').length + $el.filter('.cherry-cat').length,
        cols: ($el.find('[class*="cols--"]').attr('class') || '').match(/cols--\d+/),
        empty: $el.find('.empty__descr, .empty__title').map(function () { return $(this).text().trim(); }).get().join(' | ').slice(0, 120),
        emptyButtons: $el.find('.empty .selector, .empty__footer .selector').length,
        focused: $el.find('.card.focus').length, controller: Lampa.Controller.enabled() && Lampa.Controller.enabled().name,
        skeleton: $el.find('.cherry-skeleton').length, imgsLoaded: $el.find('.card__img').filter(function () { return this.complete && this.naturalWidth > 0; }).length,
        errors: errs
      });
    }, parseInt(parts[parts.length - 1], 10) > 1000 ? parseInt(parts[parts.length - 1], 10) : 10000);
  });
})
