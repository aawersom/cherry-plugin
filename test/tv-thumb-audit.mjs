// THUMB (poster) coverage audit — the visible card image is v.img = v.thumb (plugin.js:969).
// Measures thumb% per channel across browse / category / search / model, and reports
// sample cards that lack a thumb (id/title/url) so we can root-cause per parser.
//   node test/tv-thumb-audit.mjs [ids...]
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

const T = (cid) => `(async()=>{
  var s=window.__C.SOURCES.find(x=>x.id===${JSON.stringify(cid)});
  var sort0=(s.cfg&&s.cfg.sorts&&s.cfg.sorts[0]&&s.cfg.sorts[0].id)||'';
  var cat0=(s.cfg&&s.cfg.categories&&s.cfg.categories[0]&&s.cfg.categories[0].id)||'';
  var out={id:${JSON.stringify(cid)}};
  // thumb present = non-empty string that looks like a URL
  var ok=function(v){var t=v&&v.thumb;return !!(t&&String(t).trim()&&/^(https?:)?\\/\\//.test(String(t).trim()));};
  var pct=function(a){return a.length?Math.round(100*a.filter(ok).length/a.length):-1;};
  var miss=function(a){return a.filter(function(v){return !ok(v);}).slice(0,4).map(function(v){return {id:String(v.id||'').slice(-40),thumb:String(v.thumb||''),title:String(v.title||'').slice(0,30),url:String(v.url||'').slice(-60)};});};
  try{ var b=await s.browse('',1,sort0); var bi=(b&&b.items)||[]; out.nB=bi.length; out.pB=pct(bi); out.mB=miss(bi); }catch(e){out.pB='E:'+String(e).slice(0,40);}
  try{ if(cat0){ var c=await s.browse(cat0,1,sort0); var ci=(c&&c.items)||[]; out.nC=ci.length; out.pC=pct(ci); out.mC=miss(ci); } else {out.pC='-';} }catch(e){out.pC='E';}
  try{ if(s.search){ var r=await s.search('milf',1); var ri=(r&&r.items)||[]; out.nS=ri.length; out.pS=pct(ri); out.mS=miss(ri); } else out.pS='-'; }catch(e){out.pS='E';}
  try{ if(typeof s.getModels==='function'){ var mods=await s.getModels(1); if(mods&&mods[0]){ var mm=await s.browseByModel(mods[0].url,1); var mi=(mm&&mm.items)||[]; out.nM=mi.length; out.pM=pct(mi); out.mM=miss(mi);} else out.pM='nomod'; } else out.pM='-'; }catch(e){out.pM='E';}
  return out;
})()`;

console.log('id            | thumb%%: browse(n) cat(n) search(n) model(n)   [<100%% flagged]');
console.log('-'.repeat(92));
const problems = [];
for (const cid of ids) {
  let r; try { r = await evalJS(T(cid)); } catch (e) { r = { id: cid, pB: 'eval:' + String(e).slice(0, 30) }; }
  const P = (v, n) => { const s = (v === -1 ? '-' : String(v)); return (s + (n != null ? '(' + n + ')' : '')).padStart(9); };
  const bad = [r.pB, r.pC, r.pS, r.pM].some(v => typeof v === 'number' && v >= 0 && v < 100);
  console.log(`${cid.padEnd(13)} |  ${P(r.pB, r.nB)} ${P(r.pC, r.nC)} ${P(r.pS, r.nS)} ${P(r.pM, r.nM)}   ${bad ? '⚠' : ''}`);
  if (bad || [r.pB, r.pC, r.pS, r.pM].some(v => typeof v === 'string' && v[0] === 'E')) {
    problems.push({ id: cid, pB: r.pB, mB: r.mB, pC: r.pC, mC: r.mC, pS: r.pS, mS: r.mS, pM: r.pM, mM: r.mM });
  }
}
console.log('\n===== MISSING-THUMB SAMPLES (channels < 100%) =====');
for (const p of problems) {
  console.log(`\n### ${p.id}`);
  for (const [mode, pct, miss] of [['browse', p.pB, p.mB], ['category', p.pC, p.mC], ['search', p.pS, p.mS], ['model', p.pM, p.mM]]) {
    if (typeof pct === 'number' && pct < 100 && miss && miss.length) {
      console.log(`  ${mode} ${pct}%: ` + miss.map(m => `[thumb="${m.thumb}" id=${m.id} "${m.title}"]`).join(' '));
    }
  }
}
ws.close();
process.exit(0);
