// Comprehensive per-channel coverage audit on the stand: preview/duration/hd/source %,
// categories, and INFINITE SCROLL (page2/3 bring new cards) across browse/category/models/related.
//   node test/tv-audit3.mjs [ids...]
import { readFileSync } from 'fs';
const IDS = process.argv.slice(2);
const listing = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const target = listing.find(t => t.type === 'page' && /lampa/i.test(t.url)) || listing.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
await send('Runtime.enable');
const evalJS = async (expr, t = 90000) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: t }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result.value; };
let code = readFileSync('D:/Works/Lampa/plugin.js', 'utf8').replace(/^﻿/, '');
code = code.replace('if (window.plugin_cherry_ready) return;', 'window.plugin_cherry_ready = false;');
const ix = code.lastIndexOf('})();');
code = code.slice(0, ix) + '\n;try{window.__CHERRY={SOURCES:SOURCES};}catch(e){window.__CHERRY_ERR=String(e);}\n' + code.slice(ix);
await evalJS('window.appready=true;');
await send('Runtime.evaluate', { expression: code, returnByValue: false });
await new Promise(r => setTimeout(r, 600));
const ids = IDS.length ? IDS : JSON.parse(await evalJS("JSON.stringify(window.__CHERRY.SOURCES.map(s=>s.id))"));

const T = (cid) => `(async () => {
  const s = window.__CHERRY.SOURCES.find(x=>x.id===${JSON.stringify(cid)});
  const sort0=(s.cfg.sorts&&s.cfg.sorts[0]&&s.cfg.sorts[0].id)||'';
  const cat0=(s.cfg.categories&&s.cfg.categories[0]&&s.cfg.categories[0].id)||'';
  const out={id:${JSON.stringify(cid)}};
  const pct=(a,f)=>a.length?Math.round(100*a.filter(f).length/a.length):0;
  const idset=a=>new Set(a.map(v=>v.id));
  const fresh=(a,prev)=>{const ps=idset(prev);return a.filter(v=>!ps.has(v.id)).length;};
  try{
    const b1=await s.browse('',1,sort0); const i1=(b1&&b1.items)||[];
    out.bn=i1.length; out.prev=pct(i1,v=>v.preview&&String(v.preview).trim()); out.dur=pct(i1,v=>v.duration>0);
    out.hd=pct(i1,v=>v.hd); out.src=pct(i1,v=>v.source);
    const b2=await s.browse('',2,sort0); out.s2=fresh((b2&&b2.items)||[],i1);
    const b3=await s.browse('',3,sort0); out.s3=fresh((b3&&b3.items)||[],((b2&&b2.items)||[]));
  }catch(e){out.bErr=String(e).slice(0,22);}
  try{ if(cat0){ const c1=await s.browse(cat0,1,sort0); const ci1=(c1&&c1.items)||[]; const c2=await s.browse(cat0,2,sort0); out.cat=cat0.slice(0,10); out.cn=ci1.length; out.cs2=fresh((c2&&c2.items)||[],ci1);} }catch(e){out.cErr=1;}
  try{ if(typeof s.getModels==='function'){ const mods=await s.getModels(1); out.mod=(mods||[]).length; if(mods&&mods[0]){ const m1=await s.browseByModel(mods[0].url,1); const m2=await s.browseByModel(mods[0].url,2); out.mn=((m1&&m1.items)||[]).length; out.ms2=fresh((m2&&m2.items)||[],((m1&&m1.items)||[]));} } }catch(e){out.mErr=1;}
  return out;
})()`;

console.log('id           browse prev dur hd src | scrl2/3 | cat        cn cs2 | models mn ms2');
console.log('-'.repeat(96));
for (const cid of ids) {
  let r; try { r = await evalJS(T(cid)); } catch (e) { r = { id: cid, bErr: 'eval' }; }
  if (r.bErr) { console.log(`${cid.padEnd(12)} BROWSE-ERR ${r.bErr}`); continue; }
  const fl = (r.prev === 0 ? 'P' : '') + (r.dur === 0 ? 'D' : '') + (r.src < 100 ? 'S' : '') + (r.s2 === 0 ? '✗SCROLL2' : '') + (r.cn === 0 && r.cat ? '✗CAT' : '') + (r.cat && r.cs2 === 0 ? '✗CATSCRL' : '') + (r.mod > 0 && r.ms2 === 0 ? '✗MODSCRL' : '');
  console.log(`${cid.padEnd(12)} ${String(r.bn).padStart(3)}   ${String(r.prev).padStart(3)} ${String(r.dur).padStart(3)} ${String(r.hd).padStart(3)} ${String(r.src).padStart(3)} | +${r.s2}/+${r.s3}  | ${(r.cat||'-').padEnd(10)} ${String(r.cn??'-').padStart(2)} +${r.cs2??'-'} | ${String(r.mod??'-').padStart(3)} ${String(r.mn??'-').padStart(3)} +${r.ms2??'-'}  ${fl}`);
}
ws.close();
process.exit(0);
