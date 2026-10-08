(async function () {
  // Are the owner's favorites still alive on their sites? Read-only: reads Fav.all() on the stand
  // (synced with the bucket) and resolves each card's stream through its own adapter, 6 at a time.
  //   node test/tv-page-run.mjs test/tv-fav-liveness.page.js x
  var C = window.__C, favs = C.Fav.all(), out = { total: favs.length, ok: 0, dead: [], bySource: {} };
  function S(id) { return C.SOURCES.filter(function (x) { return x.id === id; })[0]; }
  var i = 0;
  async function worker() {
    while (i < favs.length) {
      var v = favs[i++], s = S(v.source), ok = false, why = '';
      if (!s) why = 'no adapter';
      else {
        var st = await Promise.race([s.getStream(v).catch(function (e) { return { err: String(e) }; }), new Promise(function (r) { setTimeout(function () { r(null); }, 30000); })]);
        ok = !!(st && (st.url || Object.keys(st.quality || {}).length));
        why = st ? (st.err || (ok ? '' : 'no stream')) : 'timeout';
      }
      var b = out.bySource[v.source] = out.bySource[v.source] || { ok: 0, dead: 0 };
      if (ok) { out.ok++; b.ok++; } else { b.dead++; out.dead.push(v.source + ' | ' + String(v.title).slice(0, 50) + ' | ' + why + ' | ' + v.url); }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
  return out;
})
