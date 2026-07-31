// FULL thumb-LOAD audit across ALL modes (browse/search/model/related), all channels.
// Loads each thumb as a real Image() in the emulator page (== Lampa card.img).
//   node test/tv-thumb-load-all.mjs [ids...]
import { readFileSync } from 'fs';
const IDS = process.argv.slice(2);
const list = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const target = list.find(t => t.type === 'page' && /lampa/i.test(t.url)) || list.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
await send('Runtime.enable');
const evalJS = async (expr, t = 150000) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: t }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result.value; };
let code = readFileSync('D:/Works/Lampa/plugin.js', 'utf8').replace(/^\uFEFF/, '');
code = code.replace('if (window.plugin_cherry_ready) return;', 'window.plugin_cherry_ready = false;');
code = code.replace('if (window.appready) {', 'if (false) {');
const ix = code.lastIndexOf('})();');
code = code.slice(0, ix) + '\n;try{window.__C={SOURCES:SOURCES,cherryFetch:cherryFetch};}catch(e){window.__C_ERR=String(e);}\n' + code.slice(ix);
await send('Runtime.evaluate', { expression: code, returnByValue: false });
await new Promise(r => setTimeout(r, 700));
const ids = IDS.length ? IDS : JSON.parse(await evalJS('JSON.stringify(window.__C.SOURCES.map(s=>s.id))'));

const T = (cid) => `(async()=>{
  function tryLoad(u){return new Promise(function(res){if(!u)return res(false);var img=new Image();var done=false;var to=setTimeout(function(){if(!done){done=true;res(false);}},9000);img.onload=function(){if(!done){done=true;clearTimeout(to);res(img.naturalWidth>1);}};img.onerror=function(){if(!done){done=true;clearTimeout(to);res(false);}};img.src=u;});}
  async function loadPct(items){ var th=(items||[]).map(function(v){return v.thumb;}).filter(Boolean).slice(0,10); if(!th.length)return {p:-1,n:0}; var r=await Promise.all(th.map(tryLoad)); return {p:Math.round(100*r.filter(Boolean).length/r.length),n:th.length}; }
  var s=window.__C.SOURCES.find(x=>x.id===${JSON.stringify(cid)});
  var sort0=(s.cfg&&s.cfg.sorts&&s.cfg.sorts[0]&&s.cfg.sorts[0].id)||'';
  var cat0=(s.cfg&&s.cfg.categories&&s.cfg.categories[0]&&s.cfg.categories[0].id)||'';
  var out={id:${JSON.stringify(cid)}};
  var browse0=null;
  try{ var b=await s.browse('',1,sort0); browse0=(b&&b.items)||[]; out.B=await loadPct(browse0); }catch(e){out.B={p:'E'};}
  try{ if(cat0){ var c=await s.browse(cat0,1,sort0); out.C=await loadPct((c&&c.items)||[]); } else out.C={p:'-'}; }catch(e){out.C={p:'E'};}
  try{ if(s.search){ var r=await s.search('milf',1); out.S=await loadPct((r&&r.items)||[]); } else out.S={p:'-'}; }catch(e){out.S={p:'E'};}
  try{ if(typeof s.getModels==='function'){ var mods=await s.getModels(1); if(mods&&mods[0]){ var mm=await s.browseByModel(mods[0].url,1); out.M=await loadPct((mm&&mm.items)||[]);} else out.M={p:'nomod'};} else out.M={p:'-'}; }catch(e){out.M={p:'E'};}
  try{ if(s.getRelated&&browse0&&browse0[0]){ var rel=await s.getRelated(browse0[0],1); out.R=await loadPct(rel||[]);} else out.R={p:'-'}; }catch(e){out.R={p:'E'};}
  return out;
})()`;

console.log('id            | LOAD%: browse   cat   search  model  related');
console.log('-'.repeat(70));
const bad = [];
for (const cid of ids) {
  let r; try { r = await evalJS(T(cid)); } catch (e) { r = { id: cid, B: { p: 'eval' } }; }
  const P = o => { const v = o && o.p; const s = (v === -1 ? '-' : String(v)); return (s + (o && o.n ? '(' + o.n + ')' : '')).padStart(8); };
  const vals = [r.B, r.C, r.S, r.M, r.R];
  const isBad = vals.some(o => o && typeof o.p === 'number' && o.p >= 0 && o.p < 100);
  console.log(`${cid.padEnd(13)} | ${P(r.B)} ${P(r.C)} ${P(r.S)} ${P(r.M)} ${P(r.R)}  ${isBad ? '⚠' : ''}`);
  if (isBad) bad.push(cid);
}
console.log('\nBELOW 100% (any mode): ' + (bad.length ? bad.join(', ') : 'NONE ✓'));
ws.close();
process.exit(0);
