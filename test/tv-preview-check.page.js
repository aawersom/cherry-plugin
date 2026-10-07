(function () {
  // Hover clip after focus dwell: is a <video> playing inside the focused card?
  var $f = $('.card.focus');
  var v = $f.find('video')[0];
  return { focused: $f.length, title: $f.find('.card__title').text().slice(0, 40), video: !!v,
    src: v ? String(v.currentSrc || v.src).slice(0, 80) : '', t: v ? Math.round(v.currentTime * 10) / 10 : null, paused: v ? v.paused : null };
})()
