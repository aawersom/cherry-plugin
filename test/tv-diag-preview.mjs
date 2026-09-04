// DIAGNOSTIC: preview-clip (hover mp4) coverage + thumb-expiry (favorites) + merged-feed thumb LOAD.
//   node test/tv-diag-preview.mjs
import { readFileSync } from 'fs';
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
const ids = JSON.parse(await evalJS('JSON.stringify(window.__C.SOURCES.map(s=>s.id))'));

const EXPIRY = "/(?:[?&](?:exp|validto|expires|st|e|oe|token|hash)=|hdnea=|hmac=|vts:)/i";
const T = (cid) => `(async()=>{
  var s=window.__C.SOURCES.find(x=>x.id===${JSON.stringify(cid)});
  var sort0=(s.cfg&&s.cfg.sorts&&s.cfg.sorts[0]&&s.cfg.sorts[0].id)||'';
  var out={id:${JSON.stringify(cid)}};
  var prevPct=function(a){return a.length?Math.round(100*a.filter(function(v){return v.preview&&String(v.preview).trim();}).length/a.length):-1;};
  var expPct=function(a){var rx=${EXPIRY};var w=a.filter(function(v){return v.thumb;});return w.length?Math.round(100*w.filter(function(v){return rx.test(v.thumb);}).length/w.length):-1;};
  try{ var b=await s.browse('',1,sort0); var bi=(b&&b.items)||[]; out.nB=bi.length; out.prevB=prevPct(bi); out.expB=expPct(bi);}catch(e){out.prevB='E';}
  try{ if(s.search){ var r=await s.search('milf',1); var ri=(r&&r.items)||[]; out.nS=ri.length; out.prevS=prevPct(ri);} else out.prevS='-'; }catch(e){out.prevS='E';}
  return out;
})()`;

console.log('id            | preview%(hover mp4): browse  search | thumb-expiring%(fav risk) browse');
console.log('-'.repeat(85));
for (const cid of ids) {
  let r; try { r = await evalJS(T(cid)); } catch (e) { r = { id: cid, prevB: 'ev' }; }
  const P = v => String(v).padStart(6);
  console.log(`${cid.padEnd(13)} | ${P(r.prevB)}${r.nB!=null?'('+r.nB+')':''}  ${P(r.prevS)}${r.nS!=null?'('+r.nS+')':''}   |   ${P(r.expB)}`);
}

// merged feeds thumb LOAD (search + all_videos) — the gap from last round. Heavy (240+
// concurrent Image loads) → gated so a crash can't lose the per-channel data above.
if (!process.argv.includes('--merged')) { ws.close(); process.exit(0); }
const merged = await evalJS(`(async()=>{
  function tryLoad(u){return new Promise(function(res){if(!u)return res(false);var img=new Image();var d=false;var to=setTimeout(function(){if(!d){d=true;res(false);}},9000);img.onload=function(){if(!d){d=true;clearTimeout(to);res(img.naturalWidth>1);}};img.onerror=function(){if(!d){d=true;clearTimeout(to);res(false);}};img.src=u;});}
  var SRC=window.__C.SOURCES;
  async function feed(isSearch){
    var proms=SRC.map(function(src){
      var p= isSearch ? src.search('milf',1) : src.browse('',1,(src.cfg&&src.cfg.sorts&&src.cfg.sorts[0]&&src.cfg.sorts[0].id)||'');
      return Promise.race([p.then(function(r){r=r||{items:[]};r._id=src.id;return r;}).catch(function(){return {items:[],_id:src.id};}), new Promise(function(res){setTimeout(function(){res({items:[],_id:src.id});},7000);})]);
    });
    var results=await Promise.all(proms); var flat=[];
    results.forEach(function(r){(r.items||[]).slice(0,10).forEach(function(v){flat.push({src:r._id,thumb:v.thumb,preview:v.preview});});});
    var wt=flat.filter(function(v){return v.thumb;});
    var loads=await Promise.all(wt.map(function(v){return tryLoad(v.thumb);}));
    var failBy={}; wt.forEach(function(v,i){if(!loads[i])failBy[v.src]=(failBy[v.src]||0)+1;});
    var prev=flat.filter(function(v){return v.preview;}).length;
    return {cards:flat.length, thumbLoad:Math.round(100*loads.filter(Boolean).length/wt.length), previewPct:Math.round(100*prev/flat.length), blankBySrc:failBy};
  }
  return {allVideos:await feed(false), allSearch:await feed(true)};
})()`).catch(e => ({ err: String(e).slice(0, 200) }));
console.log('\n===== MERGED FEEDS =====');
console.log('«Все видео» (browse) :', JSON.stringify(merged.allVideos));
console.log('Общий поиск (search) :', JSON.stringify(merged.allSearch));
ws.close();
process.exit(0);
