(async function () {
  // Which Cherry build is the stand ACTUALLY running (as-deployed, no injection)? Reads the plugin
  // script Lampa loaded and its version; read-only.   node test/tv-eval.mjs test/tv-live-version.page.js x
  var srcs = [].slice.call(document.scripts).map(function (x) { return x.src; }).filter(function (u) { return /cherry/i.test(u); });
  var ver = '';
  if (srcs[0]) {
    var t = await fetch(srcs[0], { cache: 'no-store' }).then(function (r) { return r.text(); }).catch(function () { return ''; });
    ver = (t.match(/CHERRY_VERSION = '([^']+)'/) || [])[1] || '';
  }
  return { scripts: srcs, ready: !!window.plugin_cherry_ready, version: ver };
})
