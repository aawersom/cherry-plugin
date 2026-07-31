// Per-MODE audit (read-only): preview% in browse / category / search / model / related, and
// FILTER effectiveness (category changes the feed; sort changes order within a category).
//   node test/tv-audit5.mjs [ids...]
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
const evalJS = async (expr, t = 90000) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: t }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result.value; };
let code = readFileSync('D:/Works/Lampa/plugin.js', 'utf8').replace(/^\uFEFF/, '');
code = code.replace('if (window.plugin_cherry_ready) return;', 'window.plugin_cherry_ready = false;');
code = code.replace('if (window.appready) {', 'if (false) {');
const ix = code.lastIndexOf('})();');
code = code.slice(0, ix) + '\n;try{window.__C={SOURCES:SOURCES};}catch(e){window.__C_ERR=String(e);}\n' + code.slice(ix);
await send('Runtime.evaluate', { expression: code, returnByValue: false });
await new Promise(r => setTimeout(r, 700));
const ids = IDS.length ? IDS : JSON.parse(await evalJS('JSON.stringify(window.__C.SOURCES.map(s=>s.id))'));

const T = (cid) => `(async()=>{
  var s=window.__C.SOURCES.find(x=>x.id===${JSON.stringify(cid)});
  var sort0=(s.cfg&&s.cfg.sorts&&s.cfg.sorts[0]&&s.cfg.sorts[0].id)||'';
  var sort1=(s.cfg&&s.cfg.sorts&&s.cfg.sorts[1]&&s.cfg.sorts[1].id)||'';
  var cat0=(s.cfg&&s.cfg.categories&&s.cfg.categories[0]&&s.cfg.categories[0].id)||'';
  var out={id:${JSON.stringify(cid)},cat:cat0.slice(0,9),nSorts:(s.cfg&&s.cfg.sorts||[]).length,nCats:(s.cfg&&s.cfg.categories||[]).length};
  var pct=a=>a.length?Math.round(100*a.filter(v=>v.preview&&String(v.preview).trim()).length/a.length):-1;
  var idset=a=>a.map(v=>v.id);
  try{ var b=await s.browse('',1,sort0); var bi=(b&&b.items)||[]; out.pBrowse=pct(bi); out.bIds=idset(bi).slice(0,3); }catch(e){out.pBrowse='E';}
  try{ if(cat0){ var c=await s.browse(cat0,1,sort0); var ci=(c&&c.items)||[]; out.pCat=pct(ci); out.catN=ci.length; out.cIds=idset(ci).slice(0,3);
    // category filter effective? cat first-id differs from browse first-id
    out.catFilter=(out.bIds&&out.cIds&&out.bIds[0]&&out.cIds[0])?(out.bIds[0]!==out.cIds[0]?'ok':'SAME'):'?';
    // sort within category changes order?
    if(sort1){ var c2=await s.browse(cat0,1,sort1); var ci2=(c2&&c2.items)||[]; out.catSort=(ci[0]&&ci2[0])?(ci[0].id!==ci2[0].id?'ok':'NOOP'):'?'; } else out.catSort='-';
  } else { out.pCat='-'; out.catFilter='-'; out.catSort='-'; } }catch(e){out.pCat='E';}
  try{ if(s.search){ var r=await s.search('milf',1); out.pSearch=pct((r&&r.items)||[]); } else out.pSearch='-'; }catch(e){out.pSearch='E';}
  try{ if(typeof s.getModels==='function'){ var mods=await s.getModels(1); if(mods&&mods[0]){ var mm=await s.browseByModel(mods[0].url,1); out.pModel=pct((mm&&mm.items)||[]); } else out.pModel='nomod'; } else out.pModel='-'; }catch(e){out.pModel='E';}
  try{ if(s.getRelated&&out.bIds){ var b0=(await s.browse('',1,sort0)).items[0]; var rel=(await s.getRelated(b0,1))||[]; out.pRelated=pct(rel); } else out.pRelated='-'; }catch(e){out.pRelated='E';}
  return out;
})()`;

console.log('id           sorts/cats | preview%: browse cat  search model related | filters: catFilter catSort');
console.log('-'.repeat(104));
for (const cid of ids) {
  let r; try { r = await evalJS(T(cid)); } catch (e) { r = { id: cid, pBrowse: 'eval' }; }
  const P = v => (v === -1 ? ' - ' : String(v)).toString().padStart(4);
  const fl = (r.catFilter === 'SAME' ? ' ⚠CATFILTER' : '') + (r.catSort === 'NOOP' ? ' ⚠CATSORT' : '')
    + (typeof r.pBrowse === 'number' && r.pBrowse >= 50 && typeof r.pCat === 'number' && r.pCat < 50 ? ' ⚠CATPREV' : '')
    + (typeof r.pBrowse === 'number' && r.pBrowse >= 50 && typeof r.pModel === 'number' && r.pModel < 50 ? ' ⚠MODPREV' : '')
    + (typeof r.pBrowse === 'number' && r.pBrowse >= 50 && typeof r.pSearch === 'number' && r.pSearch < 50 ? ' ⚠SRCHPREV' : '');
  console.log(`${cid.padEnd(12)} ${String(r.nSorts).padStart(2)}/${String(r.nCats).padStart(3)}   |         ${P(r.pBrowse)} ${P(r.pCat)} ${P(r.pSearch)} ${P(r.pModel)} ${P(r.pRelated)} |         ${String(r.catFilter||'-').padEnd(6)}  ${String(r.catSort||'-')}${fl}`);
}
ws.close();
process.exit(0);
