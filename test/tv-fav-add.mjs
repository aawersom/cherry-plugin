// Build a favorites record for a pornhub video from its real page (via the plugin's own fetch
// path on the stand), verify the poster renders in the favorites grid, then merge it into the
// sync bucket (PIN) with the newest `added` timestamp.   node test/tmp-addfav.mjs <url> <pin>
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
const URL_ = process.argv[2]; const PIN = process.argv[3];
if (!URL_ || !PIN) { console.log('usage: node test/tmp-addfav.mjs <video url> <pin>'); process.exit(1); }
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
code = code.replace('if (window.appready) {', 'if (false) {');
const ix = code.lastIndexOf('})();');
code = code.slice(0, ix) + "\n;try{window.__C={SOURCES:SOURCES,cherryFetch:cherryFetch,_decodeHtml:_decodeHtml,parseDur:parseDur,parseViews:parseViews};}catch(e){window.__C_ERR=String(e);}\n" + code.slice(ix);
await send('Runtime.evaluate', { expression: code, returnByValue: false }); await sleep(600);

// 1) build the record from the real page (device fetch path) + the adapter's refreshThumb (loadable hdnea poster)
const rec = await ev(`(async()=>{
  var C=window.__C, url=${JSON.stringify(URL_)}; var s=C.SOURCES.filter(function(x){return x.id==='pornhub';})[0];
  var html=await C.cherryFetch(url);
  var vk=(url.match(/viewkey=([a-z0-9]+)/i)||[])[1]||'';
  var title=C._decodeHtml((html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)||[])[1]||(html.match(/<title>([^<]*)<\\/title>/i)||[])[1]||'').replace(/\\s*-\\s*Pornhub\\.com\\s*$/i,'').trim();
  var thumb=await s.refreshThumb({url:url});
  var dur=parseInt((html.match(/<meta[^>]+property="video:duration"[^>]+content="(\\d+)"/i)||[])[1]||'0',10);
  if(!dur){ var iso=(html.match(/"duration"\\s*:\\s*"PT(\\d+)M(\\d+)S"/i)||[]); if(iso[1]) dur=parseInt(iso[1],10)*60+parseInt(iso[2]||'0',10); }
  var views=C.parseViews(((html.match(/<span[^>]*class="count"[^>]*>([^<]+)</i)||[])[1]||'0'));
  return {id:vk, source:'pornhub', title:title, thumb:thumb, url:url, duration:dur, views:views, added:Date.now(), deleted:0};
})()`);
console.log('record:', JSON.stringify({ ...rec, thumb: (rec.thumb || '').slice(0, 70) + '…' }));
if (!rec.id || !rec.title || !rec.thumb) { console.log('ABORT: incomplete record'); ws.close(); process.exit(1); }

// 2) render it in the favorites grid on the stand (real components) — poster must load
await ev(`Lampa.Storage.set('cherry_favs', [${JSON.stringify(rec)}]); Lampa.Activity.push({component:'cherry_grid',title:'Случайные',source_id:'pornhub',is_favorites:true,page:1}); true`);
await sleep(6000);
console.log('grid:', await ev(`(function(){var $r=$(Lampa.Activity.active().activity.render()); var img=$r.find('.card__img')[0]; return JSON.stringify({cards:$r.find('.card').length, title:$r.find('.card__title').text().slice(0,50), posterLoaded:!!(img&&img.complete&&img.naturalWidth>1), px:img?img.naturalWidth:-1, dur:$r.find('.cherry-dur').text()});})()`));
shot('33-fav-added');
await ev("Lampa.Storage.set('cherry_favs', []); true");
ws.close();

// 3) merge into the sync bucket with the newest timestamp
const resp = await fetch(`https://cherry-proxy.aawersom.workers.dev/favs?pin=${encodeURIComponent(PIN)}&key=1206`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records: [rec] }) });
const j = await resp.json().catch(() => null);
const recs = (j && j.records) || [];
const act = recs.filter(r => r && (r.added || 0) > (r.deleted || 0)).sort((a, b) => (b.added || 0) - (a.added || 0));
const mine = act.find(r => r.id === rec.id && r.source === 'pornhub');
console.log('bucket after merge: HTTP ' + resp.status + ', active=' + act.length + ', newest=' + (act[0] ? act[0].source + ':' + String(act[0].title).slice(0, 40) : '-') + ', ours present=' + !!mine + ', ours is newest=' + (act[0] && act[0].id === rec.id));
process.exit(0);
