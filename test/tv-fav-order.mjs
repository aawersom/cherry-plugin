// v0.13.17 checks on the stand (force re-inject WITH startPlugin so the grid uses the current
// Fav/_gridLoad): (a) a record that arrived via sync-merge (appended LAST in storage) renders
// FIRST when it is the newest; (b) empty favorites now shows the hint (render on a later tick).
//   node test/tv-fav-order.mjs
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
const ADB = 'D:/Android/Sdk/platform-tools/adb.exe';
const list = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const target = list.find(t => t.type === 'page' && /lampa/i.test(t.url)) || list.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
await send('Runtime.enable');
const ev = async (expr, t = 60000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: t }), new Promise((_, rej) => setTimeout(() => rej(new Error('hard timeout')), t + 5000))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result.value; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = (n) => { try { execSync(`"${ADB}" exec-out screencap -p > "D:/tmp/ui/${n}.png"`, { shell: 'cmd.exe', timeout: 20000 }); console.log('shot:', n); } catch (e) { console.log('shot failed'); } };

let code = readFileSync('D:/Works/Lampa/plugin.js', 'utf8').replace(/^\uFEFF/, '');
code = code.replace('if (window.plugin_cherry_ready) return;', 'window.plugin_cherry_ready = false;');
code = code.replace('if (window.cherry_filter_btn_ready) return;', 'if (true) return;');
const ix = code.lastIndexOf('})();');
code = code.slice(0, ix) + "\n;try{window.__C={SOURCES:SOURCES};}catch(e){window.__C_ERR=String(e);}\n" + code.slice(ix);
await ev('window.appready = true; Lampa.Storage.set("cherry_sync_pin",""); true');   // no PIN on the stand → local-only, must render immediately
await send('Runtime.evaluate', { expression: code, returnByValue: false }); await sleep(1200);

// (a) storage order: [old local unshifted first ... merged-newest appended LAST]
// synthetic records (no network): storage order = local unshifts (newer first) … then a
// sync-merged record APPENDED last — exactly what _merge produces.
const seeded = await ev('(function(){' +
  'var now=Date.now(); var mk=function(id,src,title,added){return {id:id,source:src,title:title,thumb:"",url:"https://example.invalid/"+id,duration:600,views:0,added:added,deleted:0};};' +
  'var recs=[mk("l2","xvideos","[2d ago local]",now-2*86400000), mk("l3","xnxx","[3d ago local]",now-3*86400000), mk("legacy","eporner","[legacy no date]",1), mk("m0","pornhub","[MERGED NEWEST]",now)];' +
  'Lampa.Storage.set("cherry_favs",recs); return recs.map(function(r){return r.title;});' +
  '})()');
console.log('storage order:', JSON.stringify(seeded));
const t0 = Date.now();
await ev('Lampa.Activity.push({component:"cherry_grid",title:"Случайные",source_id:"xvideos",is_favorites:true,page:1}); true');
await sleep(4000);
console.log('grid order:', await ev(`JSON.stringify($(Lampa.Activity.active().activity.render()).find('.card__title').map(function(){return $(this).text().slice(0,18);}).get())`));
shot('34-fav-order');
// (b) empty favorites → hint box must mount now
await ev('Lampa.Storage.set("cherry_favs",[]); Lampa.Activity.push({component:"cherry_grid",title:"Случайные",source_id:"xvideos",is_favorites:true,page:1}); true');
await sleep(4000);
console.log('empty favorites:', await ev(`(function(){var $r=$(Lampa.Activity.active().activity.render());return JSON.stringify({emptyBox:$r.find('.empty').length,text:$r.find('.empty__descr').text().slice(0,60),selectors:$r.find('.selector').length});})()`));
shot('35-fav-empty-hint');
ws.close(); process.exit(0);
