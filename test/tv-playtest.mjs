// Phase 1 — PLAYBACK verification per channel on the Google TV stand.
// Sets Lampa to the internal player (so playback runs in an inspectable WebView <video>),
// then for each channel: browse → playVideo(first) → wait → read the stream <video> state →
// classify PLAYS / STALL / ERROR / NO-VIDEO, then close the player.
//   node test/tv-playtest.mjs [ids...]
import { readFileSync } from 'fs';
const IDS = process.argv.slice(2);
const WAIT = 9000;

const listing = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const target = listing.find(t => t.type === 'page' && /lampa/i.test(t.url)) || listing.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
await send('Runtime.enable');
const evalJS = async (expr, t = 60000) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: t }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result.value; };

// inject plugin with SOURCES + playVideo + force internal player
let code = readFileSync('D:/Works/Lampa/plugin.js', 'utf8').replace(/^﻿/, '');
code = code.replace('if (window.plugin_cherry_ready) return;', 'window.plugin_cherry_ready = false;');
const ix = code.lastIndexOf('})();');
code = code.slice(0, ix) + '\n;try{window.__CHERRY={SOURCES:SOURCES,playVideo:playVideo};}catch(e){window.__CHERRY_ERR=String(e);}\n' + code.slice(ix);
await evalJS('window.appready=true;');
await send('Runtime.evaluate', { expression: code, returnByValue: false });
await evalJS("Lampa.Storage.set('player','inner'); 'inner'");
await new Promise(r => setTimeout(r, 500));

const ids = IDS.length ? IDS : JSON.parse(await evalJS("JSON.stringify(window.__CHERRY.SOURCES.map(s=>s.id))"));

const PLAY = (cid) => `(async () => {
  const s = window.__CHERRY.SOURCES.find(x=>x.id===${JSON.stringify(cid)});
  const cat=(s.cfg.categories&&s.cfg.categories[0]&&s.cfg.categories[0].id)||'';
  const sort=(s.cfg.sorts&&s.cfg.sorts[0]&&s.cfg.sorts[0].id)||'';
  let r; try{ r=await s.browse(cat,1,sort);}catch(e){return {id:${JSON.stringify(cid)},err:'browse '+e.message.slice(0,30)};}
  const v=(r.items||[])[0];
  if(!v) return {id:${JSON.stringify(cid)},err:'no video'};
  try{ window.__CHERRY.playVideo(v, s); }catch(e){ return {id:${JSON.stringify(cid)},err:'play '+e.message.slice(0,30)}; }
  return new Promise(res=>setTimeout(()=>{
    const vids=[...document.querySelectorAll('video')].filter(x=>!/apple\\.com/.test(x.currentSrc||x.src||''));
    const pv=vids[vids.length-1];
    const st = pv ? {t:+pv.currentTime.toFixed(1), rs:pv.readyState, err:pv.error&&pv.error.code, host:((pv.currentSrc||pv.src||'').split('//')[1]||'').split('/')[0].slice(0,28)} : null;
    res({id:${JSON.stringify(cid)}, title:(v.title||'').slice(0,20), st});
  }, ${WAIT}));
})()`;

console.log('channel        verdict     t/readyState  err  stream-host');
console.log('-'.repeat(72));
const rows = [];
for (const cid of ids) {
  let r; try { r = await evalJS(PLAY(cid)); } catch (e) { r = { id: cid, err: 'eval ' + e.message.slice(0, 30) }; }
  // close player for next
  try { await evalJS("try{Lampa.Player.destroy&&Lampa.Player.destroy(); Lampa.Player.close&&Lampa.Player.close();}catch(e){}; Lampa.Controller&&Lampa.Controller.toggle&&Lampa.Controller.toggle('content'); 'closed'"); } catch (e) {}
  await new Promise(r2 => setTimeout(r2, 1200));
  rows.push(r);
  if (r.err) { console.log(`${cid.padEnd(14)} ERR ${r.err}`); continue; }
  const s = r.st || {};
  const verdict = !r.st ? 'NO-VIDEO⚠' : s.err ? 'ERROR⚠' : (s.t > 1 ? 'PLAYS✓' : (s.rs >= 1 ? 'STALL⚠' : 'NO-DATA⚠'));
  console.log(`${cid.padEnd(14)} ${verdict.padEnd(11)} t=${String(s.t).padEnd(4)} rs=${s.rs}      ${String(s.err||'-').padEnd(4)} ${s.host||''}`);
}
ws.close();
const plays = rows.filter(r => r.st && !r.st.err && r.st.t > 1).length;
console.log(`\nPLAYS: ${plays}/${rows.length}`);
process.exit(0);
