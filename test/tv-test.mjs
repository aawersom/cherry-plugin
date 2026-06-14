// Full-plugin test on the REAL Google TV stand via CDP. Runs browse/getStream of each adapter
// ON THE DEVICE (native fetch + home IP, _isAndroid()=true). Checks R1 titles, R2/R3 pagination+dedup,
// R4 stream URL, R13 quality.  node test/tv-test.mjs [ids...]
import { readFileSync } from 'fs';

const IDS = process.argv.slice(2);
const list = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const target = list.find(t => t.type === 'page' && /lampa/i.test(t.url)) || list.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
await send('Runtime.enable');
async function evalJS(expr, t = 45000) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: t });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

// (re)inject plugin WITH __CHERRY export (strip the ready-guard so it re-runs + exposes SOURCES)
let code = readFileSync('D:/Works/Lampa/plugin.js', 'utf8').replace(/^﻿/, '');
code = code.replace('if (window.plugin_cherry_ready) return;', 'window.plugin_cherry_ready = false;');
const i = code.lastIndexOf('})();');
code = code.slice(0, i) + '\n;try{window.__CHERRY={SOURCES:SOURCES,cherryFetch:cherryFetch,buildProxyUrl:buildProxyUrl,_isAndroid:_isAndroid,_nativeFetch:(typeof _nativeFetch!=="undefined"?_nativeFetch:null),_forceProxyAndroid:(typeof _forceProxyAndroid!=="undefined"?_forceProxyAndroid:null)};}catch(e){window.__CHERRY_ERR=String(e);}\n' + code.slice(i);
await evalJS('window.appready=true;');
await send('Runtime.evaluate', { expression: code, returnByValue: false });
await new Promise(r => setTimeout(r, 800));
const ready = await evalJS("!!(window.__CHERRY && window.__CHERRY.SOURCES) ? window.__CHERRY.SOURCES.length+'' : ('ERR '+window.__CHERRY_ERR)");
console.error('__CHERRY sources:', ready, '| android:', await evalJS("String(window.__CHERRY._isAndroid())"));

const ids = IDS.length ? IDS : await evalJS("JSON.stringify(window.__CHERRY.SOURCES.map(s=>s.id))").then(s => JSON.parse(s));
const TEST = (cid) => `(async () => {
  const s = window.__CHERRY.SOURCES.find(x=>x.id===${JSON.stringify(cid)});
  if(!s) return {id:${JSON.stringify(cid)},err:'no source'};
  const cat=(s.cfg&&s.cfg.categories&&s.cfg.categories[0]&&s.cfg.categories[0].id)||'';
  const sort=(s.cfg&&s.cfg.sorts&&s.cfg.sorts[0]&&s.cfg.sorts[0].id)||'';
  const out={id:${JSON.stringify(cid)},cat,sort};
  try{
    const p1=await s.browse(cat,1,sort); const it1=(p1&&p1.items)||[];
    out.cards1=it1.length; out.total=p1&&p1.total_pages;
    out.emptyTitles=it1.filter(v=>!v.title||!String(v.title).trim()).length;
    out.distinctTitles=new Set(it1.map(v=>(v.title||'').trim())).size;
    out.junkTitles=it1.filter(v=>/^(add to fav|favorit|избранн)/i.test((v.title||'').trim())).length;
    out.sampleTitle=(it1[0]&&it1[0].title||'').slice(0,32);
    const p2=await s.browse(cat,2,sort); const it2=(p2&&p2.items)||[];
    out.cards2=it2.length;
    const ids1=new Set(it1.map(v=>v.id)); out.dupP1P2=it2.filter(v=>ids1.has(v.id)).length;
    if(it1[0]&&s.getStream){ const st=await s.getStream(it1[0]); let u=(st&&(st.url||''))||''; const uu=u.indexOf('//')===0?'https:'+u:u; out.streamKind=!u?'EMPTY':((/\\.m3u8/.test(uu)?'m3u8':(/\\.mp4/.test(uu)?'mp4':'other'))+(u.indexOf('/proxy?url=')!==-1?'/proxied':'/raw')); out.streamHost=(uu.split('//')[1]||'').split('/')[0].slice(0,30); }
  }catch(e){ out.err=String(e).slice(0,60); }
  return out;
})()`;

console.log('id            cards1/2 distinct total empty dup  stream        host');
console.log('-'.repeat(95));
const rows = [];
for (const cid of ids) {
  let r; try { r = await evalJS(TEST(cid)); } catch (e) { r = { id: cid, err: 'eval ' + e.message.slice(0, 40) }; }
  rows.push(r);
  if (r.err) { console.log(`${cid.padEnd(13)} ERR: ${r.err}`); continue; }
  const sameTitle = r.cards1 >= 5 && r.distinctTitles <= 2;
  const flag = (r.emptyTitles > 0 ? ' ⚠EMPTY' : '') + (sameTitle ? ' ⚠SAMETITLE' : '') + (r.junkTitles > 0 ? ' ⚠JUNKTITLE' : '') + (r.dupP1P2 > 0 ? ' ⚠DUP' : '') + (r.cards2 === 0 && r.cards1 > 0 ? ' ⚠NOPAGE2' : '') + (/EMPTY|PROTO/.test(r.streamKind || '') ? ' ⚠STREAM' : '');
  console.log(`${cid.padEnd(13)} ${String(r.cards1).padStart(3)}/${String(r.cards2).padEnd(3)} ${String(r.distinctTitles).padStart(3)}dt ${String(r.total).padStart(4)}  ${String(r.emptyTitles).padStart(5)}  ${String(r.dupP1P2).padStart(3)}  ${(r.streamKind||'-').padEnd(12)} ${(r.streamHost||'').padEnd(20)}${flag}`);
}
ws.close();
process.exit(0);
