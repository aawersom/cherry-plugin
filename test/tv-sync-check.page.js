(async function (arg) {
  // Run the favorites sync with the PIN stored on the device and report what happened —
  // console lines from Sync.run, record counts before/after, and Fav.all() health.
  //   node test/tv-page-run.mjs test/tv-sync-check.page.js run
  var C = window.__C, logs = [], orig = console.log, origW = console.warn;
  console.log = function () { var s = Array.prototype.slice.call(arguments).join(' '); if (s.indexOf('[Cherry]') === 0) logs.push(s.slice(0, 200)); orig.apply(console, arguments); };
  console.warn = function () { var s = Array.prototype.slice.call(arguments).join(' '); if (s.indexOf('[Cherry]') === 0) logs.push('WARN ' + s.slice(0, 200)); origW.apply(console, arguments); };
  var out = { pin: Lampa.Storage.get('cherry_sync_pin', ''), before: C.Fav._records().length, running: C.Sync._running };
  var t0 = Date.now();
  try { await Promise.race([C.Sync.run(true), new Promise(function (r) { setTimeout(function () { r('timeout'); }, 15000); })]); } catch (e) { out.err = String(e); }
  out.ms = Date.now() - t0;
  out.after = C.Fav._records().length;
  try { var all = C.Fav.all(); out.active = all.length; out.first = all[0] && { id: all[0].id, source: all[0].source, title: (all[0].title || '').slice(0, 30), thumb: (all[0].thumb || '').slice(0, 60) }; } catch (e) { out.favAllErr = String(e); }
  out.logs = logs;
  console.log = orig; console.warn = origW;
  return out;
})
