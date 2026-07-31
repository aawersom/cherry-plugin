// REAL thumb-LOAD audit. thumb% string-present is 100%, but user sees blank cards →
// the <img> fails to LOAD (hotlink/referer, dead CDN, http-on-https, wrong host).
// This loads each browse-p1 thumb as an actual Image() IN THE EMULATOR PAGE — exactly
// how Lampa renders card.img — and reports true load success per channel.
//   node test/tv-thumb-load.mjs [ids...]
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
const evalJS = async (expr, t = 120000) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: t }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result.value; };
let code = readFileSync('D:/Works/Lampa/plugin.js', 'utf8').replace(/^\uFEFF/, '');
code = code.replace('if (window.plugin_cherry_ready) return;', 'window.plugin_cherry_ready = false;');
code = code.replace('if (window.appready) {', 'if (false) {');
const ix = code.lastIndexOf('})();');
code = code.slice(0, ix) + '\n;try{window.__C={SOURCES:SOURCES,cherryFetch:cherryFetch};}catch(e){window.__C_ERR=String(e);}\n' + code.slice(ix);
await send('Runtime.evaluate', { expression: code, returnByValue: false });
await new Promise(r => setTimeout(r, 700));
const ids = IDS.length ? IDS : JSON.parse(await evalJS('JSON.stringify(window.__C.SOURCES.map(s=>s.id))'));

// mode: which feed to sample. default browse.
const T = (cid) => `(async()=>{
  var s=window.__C.SOURCES.find(x=>x.id===${JSON.stringify(cid)});
  var sort0=(s.cfg&&s.cfg.sorts&&s.cfg.sorts[0]&&s.cfg.sorts[0].id)||'';
  var out={id:${JSON.stringify(cid)}};
  var thumbs=[];
  try{ var b=await s.browse('',1,sort0); var bi=(b&&b.items)||[]; thumbs=bi.map(function(v){return v.thumb;}).filter(Boolean).slice(0,12); }catch(e){out.err=String(e).slice(0,50);}
  out.n=thumbs.length;
  if(!thumbs.length){out.load=-1;return out;}
  function tryLoad(u){return new Promise(function(res){
    var img=new Image(); var done=false;
    var to=setTimeout(function(){if(!done){done=true;res({u:u,ok:false,r:'timeout'});}},9000);
    img.onload=function(){if(!done){done=true;clearTimeout(to);res({u:u,ok:img.naturalWidth>1,r:img.naturalWidth+'x'+img.naturalHeight});}};
    img.onerror=function(){if(!done){done=true;clearTimeout(to);res({u:u,ok:false,r:'error'});}};
    img.src=u;
  });}
  var results=await Promise.all(thumbs.map(tryLoad));
  var okN=results.filter(function(r){return r.ok;}).length;
  out.load=Math.round(100*okN/results.length);
  out.fail=results.filter(function(r){return !r.ok;}).slice(0,3).map(function(r){return {u:String(r.u).slice(0,80),r:r.r};});
  out.sampleOk=results.filter(function(r){return r.ok;}).slice(0,1).map(function(r){return {u:String(r.u).slice(0,80),r:r.r};});
  return out;
})()`;

console.log('id            | thumbLOAD% (n)   [failures]');
console.log('-'.repeat(80));
const bad = [];
for (const cid of ids) {
  let r; try { r = await evalJS(T(cid)); } catch (e) { r = { id: cid, load: 'eval:' + String(e).slice(0, 30) }; }
  const mark = (typeof r.load === 'number' && r.load >= 0 && r.load < 100) ? ' ⚠' : '';
  console.log(`${cid.padEnd(13)} |  ${String(r.load).padStart(4)}% (${r.n || 0})${mark}` + (r.err ? '  ERR:' + r.err : ''));
  if (typeof r.load === 'number' && r.load < 100 && r.load >= 0) bad.push(r);
}
console.log('\n===== FAILURES (load < 100%) =====');
for (const r of bad) {
  console.log(`\n### ${r.id} — ${r.load}% loaded`);
  (r.fail || []).forEach(f => console.log(`  FAIL[${f.r}] ${f.u}`));
  (r.sampleOk || []).forEach(f => console.log(`  OK  [${f.r}] ${f.u}`));
}
ws.close();
process.exit(0);
