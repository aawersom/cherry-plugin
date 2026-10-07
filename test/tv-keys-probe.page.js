(function (arg) {
  // Records what real remote keys open on the current Cherry screen (Maker migration check):
  //   "arm"  — wrap Lampa.Select.show / Lampa.Player.play and reset the log
  //   "read" — report the log + focus index + card count + active component
  if (arg === 'arm') {
    window.__keysLog = [];
    if (!Lampa.Select.__k) { Lampa.Select.__k = Lampa.Select.show; Lampa.Select.show = function (p) { window.__keysLog.push('select: ' + (p.title || '') + ' [' + (p.items || []).map(function (i) { return i.title; }).slice(0, 5).join(' | ') + ']'); return Lampa.Select.__k.apply(this, arguments); }; }
    if (!Lampa.Player.__k) { Lampa.Player.__k = Lampa.Player.play; Lampa.Player.play = function (o) { window.__keysLog.push('play: ' + String(o && o.title).slice(0, 40)); return Lampa.Player.__k.apply(this, arguments); }; }
    return 'armed';
  }
  var act = Lampa.Activity.active(), $el = $(act && act.activity && act.activity.render());
  var cards = $el.find('.card'), idx = cards.index(cards.filter('.focus'));
  return { component: act && act.component, title: act && act.title, cards: cards.length, focusIdx: idx,
    focusTitle: cards.filter('.focus').find('.card__title').text().slice(0, 40), controller: Lampa.Controller.enabled() && Lampa.Controller.enabled().name,
    log: window.__keysLog || [] };
})
