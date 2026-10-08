(async function (arg) {
  // Does a pornhub VIDEO page come back with the player (flashvars) via the VPS and via the CF worker?
  // One request per route per card, spaced 3 s — a cheap health check (read-only).
  //   node test/tv-page-run.mjs test/tv-ph-page-health.page.js 3
  var C = window.__C, ph = C.SOURCES.filter(function (x) { return x.id === 'pornhub'; })[0];
  var b = await ph.browse('', 1, (ph.cfg.sorts[0] || {}).id || ''), n = parseInt(arg, 10) || 2, out = [];
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  for (var i = 0; i < n; i++) {
    var v = b.items[i], row = { card: (v.title || '').slice(0, 30) };
    for (var cf = 0; cf < 2; cf++) {
      var r = await fetch(C.buildProxyUrl(v.url, 'https://www.pornhub.com/', !!cf)).then(function (x) { return x.text().then(function (t) { return { s: x.status, fv: t.indexOf('flashvars_') !== -1, len: t.length, title: (t.match(/<title>([^<]{0,40})/) || [])[1] }; }); }).catch(function (e) { return { err: String(e) }; });
      row[cf ? 'cf' : 'vps'] = r;
      await wait(3000);
    }
    out.push(row);
  }
  return out;
})
