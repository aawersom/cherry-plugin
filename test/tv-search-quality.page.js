(async function (arg) {
  // Search QUALITY as the owner sees it: the global search screen for typical queries; per query the
  // first 12 cards (title + channel) and how many of them name every query word (after RU→EN).
  //   node test/tv-ui-run.mjs test/tv-search-quality.page.js x   (working copy; titleHits12 needs window.__C)
  var Q = ['Little Caprice', 'Sasha Foxx', 'двойное проникновение', 'блондинка анал', 'русское домашнее', 'азиатка массаж', 'first time dp', 'SSIS-839', 'stepsister', 'лесбиянки'];
  if (arg && arg !== 'x') Q = String(arg).split('|');
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function act() { var a = Lampa.Activity.active(); return $(a && a.activity && a.activity.render()); }
  try { if (Lampa.Screensaver && Lampa.Screensaver.stop) Lampa.Screensaver.stop(); } catch (e) {}
  var out = [];
  for (var i = 0; i < Q.length; i++) {
    Lampa.Activity.push({ component: 'cherry_grid', title: 'q', source_id: 'pornhub', query: Q[i], all_sources: true, page: 1 });
    await wait(6500);
    var cards = act().find('.card').slice(0, 12).map(function () {
      var $c = $(this), d = $c.data('card') || {};
      return ($c.find('.card__title').text().trim().slice(0, 48)) + ' [' + ($c.find('.cherry-src, .card__source, .card__type').first().text().trim() || '') + ']';
    }).get();
    // titleHits: of the first 12, how many name EVERY query group (the plugin's own RU/EN groups)
    var hits = null;
    if (window.__C && window.__C._searchGroups) {
      var groups = window.__C._searchGroups(Q[i]), N = window.__C._normText;
      hits = act().find('.card').slice(0, 12).filter(function () {
        var t = N($(this).find('.card__title').text());
        return groups.every(function (g) { return g.some(function (m) { return m && t.indexOf(m) !== -1; }); });
      }).length;
    }
    out.push({ q: Q[i], total: act().find('.card').length, titleHits12: hits, top: cards, empty: act().find('.empty').text().replace(/\s+/g, ' ').trim().slice(0, 60) });
    Lampa.Activity.backward();
    await wait(1200);
  }
  return out;
})
