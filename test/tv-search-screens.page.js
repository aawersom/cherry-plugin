(async function (arg) {
  // Search / global search / «Похожие» as SCREENS (what the owner sees), on whatever plugin the stand
  // runs (tv-eval = as deployed; tv-ui-run = working copy). Per screen: cards, time to first cards,
  // empty/error text, first titles.   node test/tv-eval.mjs test/tv-search-screens.page.js x
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function act() { var a = Lampa.Activity.active(); return $(a && a.activity && a.activity.render()); }
  try { if (Lampa.Screensaver && Lampa.Screensaver.stop) Lampa.Screensaver.stop(); } catch (e) {}
  async function screen(obj) {
    var t0 = Date.now(), first = 0;
    Lampa.Activity.push(obj);
    for (var i = 0; i < 40; i++) {
      await wait(500);
      if (!first && act().find('.card').length) first = Date.now() - t0;
      if (first && i > 6) break;
    }
    var $a = act(), r = { title: obj.title, cards: $a.find('.card').length, firstMs: first,
      empty: $a.find('.empty').text().replace(/\s+/g, ' ').trim().slice(0, 80),
      titles: $a.find('.card .card__title').slice(0, 4).map(function () { return $(this).text().trim().slice(0, 28); }).get() };
    Lampa.Activity.backward();
    await wait(1200);
    return r;
  }
  var out = [];
  out.push(await screen({ component: 'cherry_grid', title: 'xvideos: blonde', source_id: 'xvideos', query: 'blonde', page: 1 }));
  out.push(await screen({ component: 'cherry_grid', title: 'pornhub: блондинка', source_id: 'pornhub', query: 'блондинка', page: 1 }));
  out.push(await screen({ component: 'cherry_grid', title: 'eporner: milf', source_id: 'eporner', query: 'milf', page: 1 }));
  out.push(await screen({ component: 'cherry_grid', title: 'ALL: blonde milf', source_id: 'pornhub', query: 'blonde milf', all_sources: true, page: 1 }));
  out.push(await screen({ component: 'cherry_grid', title: 'ALL: русское', source_id: 'pornhub', query: 'русское', all_sources: true, page: 1 }));
  // «Похожие» for the first card of two channels
  var C = window.__C;
  var srcs = (C && C.SOURCES) || [];
  for (var k = 0; k < 2; k++) {
    var id = ['xvideos', 'eporner'][k];
    out.push(await screen({ component: 'cherry_grid', title: 'feed ' + id, source_id: id, page: 1 }));
  }
  return out;
})
