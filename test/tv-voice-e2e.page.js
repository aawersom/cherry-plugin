(function (arg) {
  // Voice-search end-to-end through the REAL UI (2026-10-07, owner: «поиск голосом не всегда работает»).
  // Only the native recognizer is stubbed: Lampa.Android.voiceStart() «hears» PHRASE and calls
  // window.voiceResult(PHRASE) exactly like the LAMPA app does. Menus are auto-picked (Поиск →
  // Голосом) by wrapping Lampa.Select.show; everything else is the plugin's own code path.
  //   start:global:<phrase>   — home «Поиск» tile → picker → voice → all-sources grid
  //   start:<sourceId>:<phrase> — channel grid; then press RIGHT (adb) to open the actions menu
  //   read                    — report the active grid (title, cards, sample titles)
  var parts = String(arg).split(':'), mode = parts[0];
  try { if (Lampa.Screensaver && Lampa.Screensaver.stop) Lampa.Screensaver.stop(); } catch (e) {}
  if (mode === 'read') {
    var act = Lampa.Activity.active(), $el = $(act && act.activity && act.activity.render());
    var titles = $el.find('.card').slice(0, 8).map(function () { return $(this).find('.card__title').text().trim().slice(0, 50); }).get();
    return { component: act && act.component, title: act && act.title, query: act && act.query, all: !!(act && act.all_sources),
             cards: $el.find('.card').length, titles: titles, log: window.__voiceLog || [] };
  }
  var target = parts[1], phrase = parts.slice(2).join(':') || 'Блондинки';
  window.__voiceLog = [];
  var log = function (m) { window.__voiceLog.push(m); };
  Lampa.Android.voiceStart = function () { log('voiceStart'); setTimeout(function () { log('voiceResult ' + typeof window.voiceResult); if (window.voiceResult) window.voiceResult(phrase); }, 900); };
  if (!Lampa.Select.__origShow) Lampa.Select.__origShow = Lampa.Select.show;
  Lampa.Select.show = function (p) {
    Lampa.Select.__origShow.apply(this, arguments);
    var pick = (p.items || []).filter(function (i) { return i.action === 'search' || i.id === '__voice__'; })[0];
    log('select: ' + (p.items || []).map(function (i) { return i.id || i.action || i.title; }).slice(0, 4).join(',') + ' → ' + (pick ? (pick.id || pick.action) : 'none'));
    if (pick) setTimeout(function () { try { Lampa.Select.close(); } catch (e) {} p.onSelect(pick); }, 400);
  };
  if (target === 'global') {
    Lampa.Activity.push({ component: 'cherry_main', title: 'Cherry', page: 1 });
    return new Promise(function (res) {
      setTimeout(function () {
        var $root = $(Lampa.Activity.active().activity.render());
        var card = $root.find('.card').filter(function () { return /Поиск/.test($(this).text()); }).first();
        // Focus the tile through Lampa's navigator; the caller then presses ENTER via adb.
        try { Lampa.Controller.toggle('content'); Lampa.Controller.collectionFocus(card[0], $root[0]); } catch (e) { log('focus err ' + e); }
        log('search tile: ' + card.length + ' focused=' + card.hasClass('focus'));
        res({ started: 'global', tile: card.length, focused: card.hasClass('focus') });
      }, 5000);
    });
  }
  Lampa.Activity.push({ component: 'cherry_grid', title: target, source_id: target, page: 1 });
  return new Promise(function (res) { setTimeout(function () { res({ started: target }); }, 7000); });
})
