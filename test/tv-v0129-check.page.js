(async function () {
  // Live check of v0.13.29 on the stand (injected plugin.js). Read-only for the bucket: no Fav
  // toggles, no Sync writes.   node test/tv-page-run.mjs test/tv-v0129-check.page.js x
  var C = window.__C, out = {};
  function S(id) { return C.SOURCES.filter(function (x) { return x.id === id; })[0]; }
  function cap(p, ms) { return Promise.race([Promise.resolve(p).catch(function (e) { return { err: String(e) }; }), new Promise(function (r) { setTimeout(function () { r({ err: 'cap' }); }, ms || 40000); })]); }

  // 1. Title repair on read: raw stored titles vs what the grid shows.
  var raw = {}; C.Fav._records().forEach(function (r) { raw[r.id + '@' + r.source] = r.title; });
  out.titles = C.Fav.all().filter(function (v) { return raw[v.id + '@' + v.source] !== v.title; })
    .map(function (v) { return { was: String(raw[v.id + '@' + v.source]).slice(0, 40), now: v.title.slice(0, 40) }; });

  // 2. xvideos / xnxx related ids carry the feed prefix; a feed card and its related twin match.
  out.related = {};
  var pairs = [['xvideos', /^xv/], ['xnxx', /^xnxx-/]];
  for (var i = 0; i < pairs.length; i++) {
    var s = S(pairs[i][0]), feed = await cap(s.browse('', 1, (s.cfg.sorts[0] || {}).id || ''));
    var card = feed && feed.items && feed.items[0];
    var rel = card ? await cap(s.getRelated(card, 1)) : [];
    rel = Array.isArray(rel) ? rel : [];
    var tokenOk = rel.filter(function (v) { var t = (v.url.match(/video[.-]([a-z0-9]+)/) || [])[1]; return t && v.id === (pairs[i][0] === 'xvideos' ? 'xv' : 'xnxx-') + t; }).length;
    out.related[pairs[i][0]] = { feedId: card && card.id, n: rel.length, prefixed: rel.filter(function (v) { return pairs[i][1].test(v.id); }).length, idMatchesUrlToken: tokenOk, sample: rel[0] && rel[0].id };
  }

  // 3. Page cache: the second fetch of the same page is served from memory.
  var u = 'https://www.xvideos.com/', t0 = Date.now(); await cap(C.cherryFetch(u)); var t1 = Date.now(); await cap(C.cherryFetch(u)); var t2 = Date.now();
  out.cache = { firstMs: t1 - t0, secondMs: t2 - t1 };

  // 4. spankbang hidden from channels, still resolvable for saved cards.
  out.spankbang = { registered: !!S('spankbang'), disabled: !!(S('spankbang') || {}).disabled };

  // 5. Double Enter: two playVideo calls in a row → the player opens ONCE, for the second card.
  var px = S('xvideos'), feed2 = await cap(px.browse('', 1, (px.cfg.sorts[0] || {}).id || '')), a = feed2.items[1], b = feed2.items[2];
  var opened = [], orig = Lampa.Player.play;
  Lampa.Player.play = function (o) { opened.push(o.title); };
  C.playVideo(a, px); C.playVideo(b, px);
  await new Promise(function (r) { setTimeout(r, 15000); });
  Lampa.Player.play = orig;
  out.doubleEnter = { opened: opened, expected: b.title, ok: opened.length === 1 && opened[0] === b.title };
  return out;
})
