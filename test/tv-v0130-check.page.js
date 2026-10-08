(async function (arg) {
  // Live UI check of v0.13.30 (tv-ui-run: the working-copy plugin with real components).
  //   node test/tv-ui-run.mjs test/tv-v0130-check.page.js x
  // A. no network → «Не удалось загрузить» + «Обновить»; network back + «Обновить» → cards
  // B. a search with no hits → «ничего не найдено» (NOT the error)
  // C. favorites: a card marked dead shows «Недоступно»; the background check fills cherry_avail
  // D. long press on a dead favorite → «Найти копию» first; choosing it opens an all-channels search
  // E. a dead saved video (spankbang) → «Видео недоступно» dialog with Найти копию / Убрать / Закрыть
  // Leaves no trace: cherry_avail is restored; no favorite is toggled; no bucket write beyond the
  // normal favorites-open sync.
  var out = {};
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function act() { var a = Lampa.Activity.active(); return $(a && a.activity && a.activity.render()); }
  function emptyText() { return act().find('.empty__title, .empty__descr, .empty').first().text().replace(/\s+/g, ' ').trim().slice(0, 90); }
  function buttons() { return act().find('.empty .simple-button, .empty .selector, .empty__footer .selector').map(function () { return $(this).text().trim(); }).get(); }
  function selectItems() { return $('.selectbox-item__title').map(function () { return $(this).text().trim(); }).get(); }
  try { if (Lampa.Screensaver && Lampa.Screensaver.stop) Lampa.Screensaver.stop(); } catch (e) {}
  var availBackup = Lampa.Storage.get('cherry_avail', {});

  // ---- A. offline channel grid ----
  // Lampa assigns Reguest methods in the constructor, so wrap the constructor (not the prototype).
  var realFetch = window.fetch, RealReguest = Lampa.Reguest;
  window.fetch = function () { return Promise.reject(new TypeError('Failed to fetch')); };
  Lampa.Reguest = function () { var r = new RealReguest(); r.native = function (u, ok, err) { setTimeout(function () { if (err) err({ status: 0 }); }, 50); }; return r; };
  Lampa.Activity.push({ component: 'cherry_grid', title: 'xvideos (offline test)', source_id: 'xvideos', page: 1 });
  await wait(9000);
  out.A_offline = { cards: act().find('.card').length, text: emptyText(), buttons: buttons() };
  window.fetch = realFetch; Lampa.Reguest = RealReguest;
  var $btn = act().find('.empty .selector, .empty .simple-button').filter(function () { return /Обновить/.test($(this).text()); }).first();
  if ($btn.length) { $btn.trigger('hover:enter'); await wait(10000); }
  out.A_retry = { pressed: !!$btn.length, cards: act().find('.card').length };
  Lampa.Activity.backward();
  await wait(1500);

  // ---- B. really empty search ----
  Lampa.Activity.push({ component: 'cherry_grid', title: 'xvideos search', source_id: 'xvideos', query: 'qzxqzx wvvqk nonexistentword', page: 1 });
  await wait(9000);
  out.B_empty = { cards: act().find('.card').length, text: emptyText() };
  Lampa.Activity.backward();
  await wait(1500);

  // ---- C/D. favorites with one card marked dead ----
  var favs = window.__C ? window.__C.Fav.all() : [];
  var target = favs.filter(function (v) { return v.source === 'xvideos'; })[0] || favs[0];
  var seeded = {}; seeded[target.id + '@' + target.source] = { f: 2, t: Date.now() };
  Lampa.Storage.set('cherry_avail', seeded);
  Lampa.Activity.push({ component: 'cherry_grid', title: 'Избранное', source_id: target.source, is_favorites: true, page: 1 });
  await wait(8000);
  out.C_badges = { cards: act().find('.card').length, deadBadges: act().find('.cherry-dead').length, badgeText: act().find('.cherry-dead').first().text() };
  await wait(45000);   // background check runs (2 at a time, ≤ 20)
  var av = Lampa.Storage.get('cherry_avail', {});
  out.C_check = { checked: Object.keys(av).length, dead: Object.keys(av).filter(function (k) { return av[k].f >= 2; }) };
  // D. long press on the dead card (it was re-checked meanwhile: re-seed so the menu shows the dead order)
  av[target.id + '@' + target.source] = { f: 2, t: Date.now() };
  Lampa.Storage.set('cherry_avail', av);
  var $cards = act().find('.card'), idx = -1;
  $cards.each(function (i) { if ($(this).find('.cherry-dead').length && idx < 0) idx = i; });
  if (idx >= 0) {
    Lampa.Controller.collectionFocus($cards[idx], act()[0]);
    await wait(500);
    Lampa.Controller.long();
    await wait(1500);
    out.D_menu = selectItems();
    var $copy = $('.selectbox-item').filter(function () { return /Найти копию/.test($(this).text()); }).first();
    if ($copy.length) { $copy.trigger('hover:enter'); await wait(12000); }
    var a = Lampa.Activity.active();
    var o = (a && (a.object || a)) || {};
    out.D_copy = { title: o.title, query: o.query, all_sources: !!o.all_sources, cards: act().find('.card').length };
    Lampa.Activity.backward();
    await wait(1500);
  } else out.D_menu = 'no dead card rendered';
  Lampa.Activity.backward();
  await wait(1500);

  // ---- E. a dead saved video → dialog ----
  var sb = favs.filter(function (v) { return v.source === 'spankbang'; })[0];
  if (sb && window.__C) {
    var src = window.__C.SOURCES.filter(function (x) { return x.id === 'spankbang'; })[0];
    window.__C.playVideo(sb, src);
    await wait(14000);
    out.E_dialog = { items: selectItems(), title: $('.selectbox__title').text().trim() };
    try { Lampa.Select.close(); } catch (e) {}
    try { Lampa.Controller.toggle('content'); } catch (e) {}
  } else out.E_dialog = 'no spankbang favorite';

  Lampa.Storage.set('cherry_avail', availBackup);
  return out;
})
