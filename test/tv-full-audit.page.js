(async function (cid) {
  // Owner-complaint audit for ONE channel (2026-10-07): «не то видео», «поиск не везде»,
  // «похожие не везде корректно», «голосом не всегда». Runs the ADAPTER exactly as the grid does.
  //   integrity — fetch each card's page and compare its <title>/og:title/h1 with the card title
  //               (a mis-split parser shows title A but plays page B → «не то видео»)
  //   search    — native-language query, a Cyrillic plural (what a RU voice recognizer returns)
  //               sent RAW (today's per-channel path) and through _translateQuery
  //   related   — count, self/dupes, overlap with the plain feed (= not really related),
  //               seed-title token overlap, and integrity of related cards
  //   stream    — does the stream URL carry the card's numeric video id (when the card URL has one)
  var C = window.__C, s = C.SOURCES.filter(function (x) { return x.id === cid; })[0];
  var out = { id: cid };
  function wt(p, ms, fb) { return Promise.race([Promise.resolve().then(function () { return p; }).catch(function () { return fb; }), new Promise(function (r) { setTimeout(function () { r(fb); }, ms); })]); }
  var N = C._normText;
  function toks(t) { return N(t).split(' ').filter(function (w) { return w.length >= 3 && !/^\d+$/.test(w); }); }
  function overlap(cardTitle, pageText) { var a = toks(cardTitle); if (!a.length) return -1; var p = ' ' + N(pageText) + ' '; return Math.round(100 * a.filter(function (w) { return p.indexOf(w) !== -1; }).length / a.length); }
  function dec(x) { try { return C._decodeHtml ? C._decodeHtml(x) : x; } catch (e) { return x; } }
  function pageTitles(html) {
    var t = [];
    var m = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title/i); if (m) t.push(m[1]);
    m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); if (m) t.push(m[1]);
    m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i); if (m) t.push(m[1].replace(/<[^>]+>/g, ' '));
    return dec(t.join(' | ')).replace(/\s+/g, ' ').slice(0, 400);
  }
  function getPage(u) {
    return wt(C.cherryFetch(u).then(function (h) { if (!h || h.length < 500) throw 0; return h; }).catch(function () { return C._proxyTextAny(u); }), 15000, '');
  }
  async function integrity(cards, k) {
    var res = [];
    for (var i = 0; i < Math.min(k, cards.length); i++) {
      var v = cards[i]; if (!v || !v.url) continue;
      var html = await getPage(v.url); var pt = html ? pageTitles(html) : '';
      var sc = pt ? overlap(v.title, pt) : -2;
      res.push({ sc: sc, card: String(v.title || '').slice(0, 50), page: pt.slice(0, 80), url: v.url });
    }
    return res;
  }
  function bad(r) { return r.filter(function (x) { return x.sc >= 0 && x.sc < 50; }); }
  function matchPct(items, stems) { if (!items.length) return -1; return Math.round(100 * items.filter(function (v) { var t = N(v.title); return stems.some(function (st) { return t.indexOf(st) !== -1; }); }).length / items.length); }

  var sort0 = (s.cfg && s.cfg.sorts && s.cfg.sorts[0] && s.cfg.sorts[0].id) || '';
  var isRu = !!C._RU_SOURCES[cid];
  var b1 = await wt(s.browse('', 1, sort0), 25000, null); var feed = (b1 && b1.items) || [];
  out.n = feed.length;
  var byUrl = {}; feed.forEach(function (v) { (byUrl[v.url] = byUrl[v.url] || []).push(v.title); });
  out.dupUrl = Object.keys(byUrl).filter(function (u) { return byUrl[u].length > 1; }).length;
  var ig = await integrity(feed, 4); out.feedInt = ig.map(function (x) { return x.sc; }); out.feedBad = bad(ig);

  // search
  if (s.search) {
    var qNat = isRu ? 'блондинка' : 'blonde', stems = ['blond', 'блондин'];
    var r1 = await wt(s.search(qNat, 1), 25000, null); var a = (r1 && r1.items) || [];
    out.sNat = a.length + '/' + matchPct(a, stems) + '%';
    var cyr = 'блондинки';                                     // plural: what a RU recognizer returns
    var r2 = await wt(s.search(cyr, 1), 25000, null); var c = (r2 && r2.items) || [];
    out.sCyrRaw = c.length + '/' + matchPct(c, stems) + '%';
    var tq = C._translateQuery(cyr); out.trPlural = tq || '-none-';
    var tq1 = C._translateQuery('блондинка');
    if (!isRu && tq1) { var r3 = await wt(s.search(tq1, 1), 25000, null); var d = (r3 && r3.items) || []; out.sCyrTr = d.length + '/' + matchPct(d, stems) + '%'; } else out.sCyrTr = '-';
    var si = await integrity(a, 2); out.searchBad = bad(si); out.searchInt = si.map(function (x) { return x.sc; });
  } else { out.sNat = out.sCyrRaw = out.sCyrTr = '-'; }

  // related
  if (s.getRelated && feed[0]) {
    var seed = feed[0];
    var rel = await wt(s.getRelated(seed, 1), 25000, null); rel = rel || [];
    out.rel = rel.length;
    out.relSelf = rel.filter(function (v) { return v.url === seed.url; }).length;
    var seen = {}, dup = 0; rel.forEach(function (v) { if (seen[v.url]) dup++; seen[v.url] = 1; }); out.relDup = dup;
    var feedUrls = {}; feed.forEach(function (v) { feedUrls[v.url] = 1; });
    out.relFeedOv = rel.length ? Math.round(100 * rel.filter(function (v) { return feedUrls[v.url]; }).length / rel.length) : -1;
    var host = function (u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return '?'; } };
    var sh = host(seed.url); out.relForeign = rel.filter(function (v) { return host(v.url) !== sh; }).map(function (v) { return host(v.url); }).slice(0, 3);
    out.relNoThumb = rel.filter(function (v) { return !/^https?:/.test(v.thumb || ''); }).length;
    var st = toks(seed.title); var p = rel.slice(0, 20).map(function (v) { var t = ' ' + N(v.title) + ' '; return st.some(function (w) { return t.indexOf(w) !== -1; }) ? 1 : 0; });
    out.relTopical = p.length ? Math.round(100 * p.reduce(function (x, y) { return x + y; }, 0) / p.length) : -1;
    var ri = await integrity(rel, 3); out.relInt = ri.map(function (x) { return x.sc; }); out.relBad = bad(ri);
    out.seed = String(seed.title || '').slice(0, 40); out.relSample = rel.slice(0, 3).map(function (v) { return String(v.title || '').slice(0, 40); });
  } else out.rel = '-';

  // stream <-> card
  if (feed[0] && s.getStream) {
    var v0 = feed[0];
    var stm = await wt(s.getStream(v0), 30000, null);
    var su = stm ? (stm.url || C.bestQualityUrl(stm.quality || {}) || '') : '';
    var ids = (String(v0.url).match(/\d{4,}/g) || []).sort(function (x, y) { return y.length - x.length; });
    var dsu = ''; try { dsu = decodeURIComponent(su); } catch (e) { dsu = su; }
    out.stream = !su ? 'NOURL' : (!ids.length ? 'noid' : (dsu.indexOf(ids[0]) !== -1 ? 'id-ok' : 'id?'));
    out.streamUrl = String(su).slice(0, 110);
  }
  return out;
})
