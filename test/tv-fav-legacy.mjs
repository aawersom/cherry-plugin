// Legacy favorites: a record saved before v0.13.11 can carry the xvideos/xnxx hover template
// (…/xv_THUMBNUM_t.jpg). Verify Fav.all() normalizes it so the poster loads. Force re-injects
// the plugin WITH startPlugin so the grid uses the current Fav.   node test/tv-fav-legacy.mjs
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
code = code.replace('if (window.cherry_filter_btn_ready) return;', 'if (true) return;');   // don't duplicate the header button
const ix = code.lastIndexOf('})();');
code = code.slice(0, ix) + "\n;try{window.__C={SOURCES:SOURCES};}catch(e){window.__C_ERR=String(e);}\n" + code.slice(ix);
await ev('window.appready = true; true');
await send('Runtime.evaluate', { expression: code, returnByValue: false }); await sleep(1200);

const seeded = await ev(`(async()=>{
  var S=window.__C.SOURCES; var now=Date.now(); var recs=[];
  function wt(p,ms){return Promise.race([p,new Promise(function(r){setTimeout(function(){r(null);},ms);})]);}
  var xv=S.filter(function(x){return x.id==='xvideos';})[0], xn=S.filter(function(x){return x.id==='xnxx';})[0];
  var bx=await wt(xv.browse('',1,'uploaddate'),15000), bn=await wt(xn.browse('',1,''),15000);
  var v=bx&&bx.items&&bx.items[0], n=bn&&bn.items&&bn.items[0];
  if(v) recs.push({id:v.id+'-legacy',source:'xvideos',title:'[LEGACY THUMBNUM] '+v.title,thumb:v.thumb.replace(/xv_\\d+_t\\.jpg/,'xv_THUMBNUM_t.jpg'),url:v.url,duration:v.duration||0,views:0,added:now,deleted:0});
  if(n) recs.push({id:n.id+'-legacy',source:'xnxx',title:'[LEGACY THUMBNUM] '+n.title,thumb:n.thumb.replace(/xn_\\d+_t\\.jpg/,'xn_THUMBNUM_t.jpg'),url:n.url,duration:n.duration||0,views:0,added:now-1,deleted:0});
  Lampa.Storage.set('cherry_favs',recs);
  return recs.map(function(r){return r.source+' → '+r.thumb.slice(-24);});
})()`);
console.log('seeded legacy records:', JSON.stringify(seeded));
await ev('Lampa.Activity.push({component:"cherry_grid",title:"Случайные",source_id:"xvideos",is_favorites:true,page:1}); true');
await sleep(7000);
const rep = await ev(`(function(){var $r=$(Lampa.Activity.active().activity.render()); var out=[]; $r.find('.card').each(function(){var img=$(this).find('.card__img')[0]; out.push({title:$(this).find('.card__title').text().slice(0,30), loaded:!!(img&&img.complete&&img.naturalWidth>1), src:(img?(img.currentSrc||img.src||''):'').slice(-22)});}); return JSON.stringify(out);})()`);
JSON.parse(rep).forEach(r => console.log('  ' + (r.loaded ? '✓' : '✗') + ' ' + r.title.padEnd(32) + ' …' + r.src));
shot('32-favorites-legacy');
await ev('Lampa.Storage.set("cherry_favs",[]); true');
ws.close(); process.exit(0);
