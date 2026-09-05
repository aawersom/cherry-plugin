(function () {
  // Snapshot of the active activity: controller name, focused card index/title, card count.
  var act = Lampa.Activity.active(), el = act && act.activity && act.activity.render(), $el = $(el);
  var f = $el.find('.card.focus, .selector.focus').first();
  return {
    component: act && act.component,
    controller: Lampa.Controller.enabled() && Lampa.Controller.enabled().name,
    cards: $el.find('.card').length,
    focusIndex: f.length ? $el.find('.card, .selector').index(f) : -1,
    focusTitle: f.find('.card__title').text().trim().slice(0, 40),
    scrollTop: $el.find('.scroll__body').first().css('transform') || ''
  };
})()
