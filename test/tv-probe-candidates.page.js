(async function (arg) {
  // Device-IP (Android native) reachability of candidate/mirror hosts + the ebun stream
  // chain with the Referer variants the real player may send. Run:
  //   node test/tv-page-run.mjs test/tv-probe-candidates.page.js
  var out = { hosts: {}, ebun: {} };
  function nat(url, headers, ms) {
    return new Promise(function (res) {
      var req = new Lampa.Reguest();
      var t0 = Date.now();
      req.native(url, function (d) { req.clear(); res({ ok: true, ms: Date.now() - t0, len: String(d).length, d: String(d) }); },
        function (e) { req.clear(); var ee = {}; try { ee.status = e && e.status; ee.txt = e && e.statusText; ee.body = e && e.responseText ? String(e.responseText).slice(0, 120) : ''; } catch (x) {} res({ ok: false, ms: Date.now() - t0, e: JSON.stringify(ee) }); },
        false, { dataType: 'text', timeout: ms || 15000, headers: headers || {} });
    });
  }
  var hosts = {
    xhamster: 'https://ru.xhamster.com/newest',
    huyamba: 'https://play.huyamba.mobi/videos/?by=post_date&from=1',
    ebalovo: 'https://wec.epalovo.com/porno-online/',
    porno365: 'https://porno365.pw/',
    ebasos: 'https://wel.ebasos.club/latest-updates/1/',
    porno666: 'https://wwwp.porno666.news/latest-updates/1/',
    pornobriz: 'https://pornobriz.com/?page=1',
    pornk: 'https://ps.pornk.top/latest-updates/1/',
    lenkino: 'https://wes.lenkino.adult/',
    redtube: 'https://www.redtube.com/',
    youporn: 'https://www.youporn.com/',
    pornhat: 'https://www.pornhat.com/',
    spankbang: 'https://ru.spankbang.com/new_videos/1/',
    rolika_w2: 'https://w2.huyalkino.com/',
    rolika_love: 'https://love.24rolika.ru/'
  };
  var marks = { xhamster: /href="https:\/\/ru\.xhamster\.com\/videos\//g, huyamba: /\/video\/\d+\//g, ebalovo: /wec\.epalovo\.com\/video\//g,
    porno365: /\/\d+-\d+\.html"/g, ebasos: /\/videos\/\d+\//g, porno666: /\/video\/\d+\//g, pornobriz: /href="\/video\//g,
    pornk: /href="\/video\/\d+/g, lenkino: /wes\.lenkino\.adult\/\d+"/g, redtube: /href="\/\d{6,}"/g, youporn: /href="\/watch\/\d+/g,
    pornhat: /href="\/video\//g, spankbang: /video-item/g, rolika_w2: /\.html"/g, rolika_love: /\.html"/g };
  var keys = Object.keys(hosts);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i]; var r = await nat(hosts[k]);
    var cards = r.ok ? ((r.d.match(marks[k]) || []).length) : -1; var loose = r.ok ? ((r.d.match(/href="[^"]*\/(?:video|videos|watch)\/[^"]*"/g) || []).length) : -1;
    var cf = r.ok && /cf_chl_opt|Just a moment/.test(r.d);
    out.hosts[k] = { ok: r.ok, ms: r.ms, len: r.ok ? r.len : r.e, cards: cards, loose: loose, cf: cf, fin: r.ok ? (r.d.match(/<link rel="canonical" href="([^"]+)"/) || [])[1] : '' };
    if (!r.ok) { var pr = await nat(window.__C.buildProxyUrl(hosts[k]), {}, 25000); out.hosts[k].viaProxy = pr.ok ? ('OK len=' + pr.len + ' cards=' + ((pr.d.match(marks[k]) || []).length)) : ('ERR ' + pr.e); }
  }
  // xhamster HLS master from device
  var xv = await nat('https://ru.xhamster.com/videos/smoking-menthol-120s-xhS7Ov2');
  if (xv.ok) {
    var m = /https:\/\/video-nss\.xhcdn\.com\/[^"]+\.m3u8/.exec(xv.d);
    if (m) { var mm = await nat(m[0]); out.xh_m3u8 = { ok: mm.ok, len: mm.ok ? mm.len : mm.e, head: mm.ok ? mm.d.slice(0, 60) : '' }; }
  }
  // ebun: page -> 666-emded iframe -> video_alt_url; then Range GET with 3 Referer variants
  var C = window.__C, eb = C.SOURCES.filter(function (s) { return s.id === 'ebun'; })[0];
  var b = await eb.browse('', 1, 'most-popular'); var v = b.items && b.items[0];
  out.ebun.card = v ? v.url : null;
  if (v) {
    var st = await eb.getStream(v); out.ebun.stream = (st.url || '').slice(0, 90); out.ebun.q = Object.keys(st.quality || {});
    if (st.url) {
      var variants = { none: {}, emded: { 'Referer': 'https://666-emded.com/' }, ebun: { 'Referer': v.url } };
      var vk = Object.keys(variants);
      for (var j = 0; j < vk.length; j++) {
        var h = variants[vk[j]]; h['Range'] = 'bytes=0-63';
        var rr = await nat(st.url, h, 15000);
        out.ebun[vk[j]] = rr.ok ? ('OK len=' + rr.len) : ('ERR ' + rr.e);
      }
    }
  }
  return out;
})
