(function (arg) {
  // v0.13.28 recent-queries sync, as the TV sees it (local plugin via tv-ui-run):
  //   "seed"  — back up cherry_rq / cherry_favs, write a LEGACY string history + one leaked __rq
  //             record into favorites (what a v0.13.27 device merged), arm a Select.show recorder
  //   "read"  — picker items seen, favorites cards / storage after the heal, cherry_rq after migration
  //   "restore" — put the backed-up storage back
  if (arg === 'seed') {
    window.__rqBak = { rq: Lampa.Storage.get('cherry_rq', []), favs: Lampa.Storage.get('cherry_favs', []) };
    Lampa.Storage.set('cherry_rq', ['старый запрос', 'SSIS-839']);
    var favs = (window.__rqBak.favs || []).slice();
    favs.push({ id: 'leak', source: '__rq', title: 'утёкший запрос', added: Date.now(), deleted: 0 });
    Lampa.Storage.set('cherry_favs', favs);
    window.__rqSel = [];
    if (!Lampa.Select.__rq) { Lampa.Select.__rq = Lampa.Select.show; Lampa.Select.show = function (p) { window.__rqSel.push((p.items || []).map(function (i) { return i.title; }).slice(0, 6)); return Lampa.Select.__rq.apply(this, arguments); }; }
    Lampa.Activity.push({ component: 'cherry_main', title: 'Cherry', page: 1 });
    return new Promise(function (res) {
      setTimeout(function () {
        var $root = $(Lampa.Activity.active().activity.render());
        var card = $root.find('.card').filter(function () { return /Поиск/.test($(this).text()); }).first();
        try { Lampa.Controller.toggle('content'); Lampa.Controller.collectionFocus(card[0], $root[0]); } catch (e) {}
        res({ seeded: true, favsBefore: favs.length, focused: card.hasClass('focus') });
      }, 5000);
    });
  }
  if (arg === 'restore') {
    if (window.__rqBak) { Lampa.Storage.set('cherry_rq', window.__rqBak.rq); Lampa.Storage.set('cherry_favs', window.__rqBak.favs); }
    return 'restored ' + JSON.stringify(Lampa.Storage.get('cherry_rq', [])).slice(0, 80);
  }
  Lampa.Activity.push({ component: 'cherry_grid', title: 'Избранное', source_id: 'pornhub', is_favorites: true, page: 1 });
  return new Promise(function (res) {
    setTimeout(function () {
      var $el = $(Lampa.Activity.active().activity.render());
      var titles = $el.find('.card .card__title').map(function () { return $(this).text(); }).get();
      var stored = Lampa.Storage.get('cherry_favs', []);
      res({ pickerItems: window.__rqSel, favCards: titles.length, leakedCardShown: titles.indexOf('утёкший запрос') !== -1,
            favsStoredLeak: stored.filter(function (r) { return r && r.source === '__rq'; }).length, favsStored: stored.length,
            rqStored: JSON.stringify(Lampa.Storage.get('cherry_rq', [])).slice(0, 260) });
    }, 6000);
  });
})
