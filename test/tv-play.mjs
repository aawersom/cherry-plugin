// Trigger NATIVE playback of a channel's first video on the Google TV stand (via CDP) so logcat
// captures the real ExoPlayer/network behavior.  node test/tv-play.mjs <channel> [categoryIndex]
import { readFileSync } from 'fs';
const CH = process.argv[2] || 'pornhub';
const CATI = parseInt(process.argv[3] || '0', 10);

const list = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const target = list.find(t => t.type === 'page' && /lampa/i.test(t.url)) || list.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
await send('Runtime.enable');
const evalJS = async (expr, t = 45000) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: t }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result.value; };

let code = readFileSync('D:/Works/Lampa/plugin.js', 'utf8').replace(/^﻿/, '');
code = code.replace('if (window.plugin_cherry_ready) return;', 'window.plugin_cherry_ready = false;');
const i = code.lastIndexOf('})();');
code = code.slice(0, i) + '\n;try{window.__CHERRY={SOURCES:SOURCES,playVideo:playVideo,_isAndroid:_isAndroid};}catch(e){window.__CHERRY_ERR=String(e);}\n' + code.slice(i);
await evalJS('window.appready=true;');
await send('Runtime.evaluate', { expression: code, returnByValue: false });
await new Promise(r => setTimeout(r, 800));

const info = await evalJS(`(async () => {
  const s = window.__CHERRY.SOURCES.find(x=>x.id===${JSON.stringify(CH)});
  const cat=(s.cfg.categories&&s.cfg.categories[${CATI}]&&s.cfg.categories[${CATI}].id)||'';
  const sort=(s.cfg.sorts&&s.cfg.sorts[0]&&s.cfg.sorts[0].id)||'';
  const r=await s.browse(cat,1,sort); const v=(r.items||[])[0];
  if(!v) return {err:'no video', cat};
  window.__PLAYV = v; window.__PLAYS = s;
  return {title:(v.title||'').slice(0,40), url:v.url, cat, sort};
})()`);
console.log('VIDEO:', JSON.stringify(info));
if (info.err) { ws.close(); process.exit(1); }

// fire native playback
await evalJS('try{ window.__CHERRY.playVideo(window.__PLAYV, window.__PLAYS); "fired" }catch(e){ "ERR "+e.message }');
console.log('playVideo fired → native ExoPlayer should start. Capture logcat now.');
await new Promise(r => setTimeout(r, 2000));
ws.close();
process.exit(0);
