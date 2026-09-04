// Do favorites posters load — everywhere, and after a token expires? Seeds cherry_favs with one
// card per channel (+ a pornhub card whose thumb token is deliberately broken), opens the
// favorites grid with the components Lampa itself registered, and checks each <img>.
//   node test/tv-fav-posters.mjs     (stand must be up; LIVE plugin loaded by Lampa)
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
const ev = async (expr, t = 120000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: t }), new Promise((_, rej) => setTimeout(() => rej(new Error('hard timeout')), t + 5000))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result.value; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = (n) => { try { execSync(`"${ADB}" exec-out screencap -p > "D:/tmp/ui/${n}.png"`, { shell: 'cmd.exe', timeout: 20000 }); console.log('shot:', n); } catch (e) { console.log('shot failed'); } };

// SOURCES only (no re-registration): patched copy exposes window.__C
let code = readFileSync('D:/Works/Lampa/plugin.js', 'utf8').replace(/^\uFEFF/, '');
code = code.replace('if (window.plugin_cherry_ready) return;', 'window.plugin_cherry_ready = false;');
code = code.replace('if (window.appready) {', 'if (false) {');
const ix = code.lastIndexOf('})();');
code = code.slice(0, ix) + "\n;try{window.__C={SOURCES:SOURCES};}catch(e){window.__C_ERR=String(e);}\n" + code.slice(ix);
await send('Runtime.evaluate', { expression: code, returnByValue: false }); await sleep(600);
console.log('components by Lampa:', await ev('!!(Lampa.Component.get&&Lampa.Component.get("cherry_grid"))'), '| __C:', await ev('!!window.__C'));

// seed favorites: 1 fresh card per channel + a pornhub card with a BROKEN (expired-style) token
const seeded = await ev(`(async()=>{
  var S=window.__C.SOURCES, ids=['pornhub','xvideos','xnxx','eporner','porntrex','xozilla','tizam','pornone','hellporno'];
  function wt(p,ms){return Promise.race([p,new Promise(function(r){setTimeout(function(){r(null);},ms);})]);}
  var recs=[], now=Date.now();
  for(var i=0;i<ids.length;i++){ var s=S.filter(function(x){return x.id===ids[i];})[0]; if(!s) continue;
    try{ var b=await wt(s.browse('',1,(s.cfg&&s.cfg.sorts&&s.cfg.sorts[0]&&s.cfg.sorts[0].id)||''),15000); var v=b&&b.items&&b.items[0]; if(!v) continue;
      recs.push({id:v.id,source:s.id,title:v.title,thumb:v.thumb,url:v.url,duration:v.duration||0,views:v.views||0,added:now-i,deleted:0});
      if(s.id==='pornhub'){ recs.push({id:v.id+'-expired',source:'pornhub',title:'[EXPIRED TOKEN] '+v.title,thumb:v.thumb.replace(/hdnea=[^&]*/,'hdnea=st=1~exp=2~hdl=-1~hmac=deadbeef').replace(/hash=[^&]*/,'hash=dead'),url:v.url,duration:v.duration||0,views:0,added:now+1,deleted:0}); }
    }catch(e){}
  }
  Lampa.Storage.set('cherry_favs',recs);
  return recs.map(function(r){return r.source+(r.id.indexOf('-expired')>0?'(expired-token)':'');});
})()`);
console.log('seeded favorites:', JSON.stringify(seeded));

await ev('Lampa.Activity.push({component:"cherry_grid",title:"Случайные",source_id:"xvideos",is_favorites:true,page:1}); true');
await sleep(9000);   // images + self-heal refetch
const report = await ev(`(function(){
  var a=Lampa.Activity.active(); var $r=$(a.activity.render()); var out=[];
  $r.find('.card').each(function(){ var $c=$(this); var img=$c.find('.card__img')[0]; var src=img?(img.currentSrc||img.src||img.getAttribute('data-src')||''):'';
    out.push({title:$c.find('.card__title').text().slice(0,28), loaded:!!(img&&img.complete&&img.naturalWidth>1), nw:img?img.naturalWidth:-1, healed:!!(img&&img.getAttribute('data-cherry-refreshed')), src:src.slice(0,48)}); });
  return JSON.stringify({cards:out.length, loaded:out.filter(function(x){return x.loaded;}).length, rows:out});
})()`);
const R = JSON.parse(report);
console.log('favorites grid: cards=' + R.cards + ' loaded=' + R.loaded);
R.rows.forEach(r => console.log('  ' + (r.loaded ? '✓' : '✗') + ' ' + (r.healed ? '[healed] ' : '') + r.title.padEnd(30) + ' ' + r.nw + 'px  ' + r.src));
shot('31-favorites-posters');
// leave the stand clean
await ev('Lampa.Storage.set("cherry_favs",[]); true');
ws.close(); process.exit(0);
