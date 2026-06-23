// Deeper per-channel audit (read-only): stream liveness, sort-effectiveness, cross-page +
// in-page dedup, per-channel search, thumb validity. Complements tv-audit3 (coverage/scroll).
//   node test/tv-audit4.mjs [ids...]
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
const evalJS = async (expr, t = 80000) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: t }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result.value; };
let code = readFileSync('D:/Works/Lampa/plugin.js', 'utf8').replace(/^﻿/, '');
code = code.replace('if (window.plugin_cherry_ready) return;', 'window.plugin_cherry_ready = false;');
const ix = code.lastIndexOf('})();');
code = code.slice(0, ix) + '\n;try{window.__C={SOURCES:SOURCES,cherryFetch:cherryFetch,buildProxyUrl:buildProxyUrl,_isAndroid:_isAndroid,_forceProxyAndroid:(typeof _forceProxyAndroid!=="undefined"?_forceProxyAndroid:function(){return false;}),bestQualityUrl:bestQualityUrl,PROXY:PROXY_URL};}catch(e){window.__C_ERR=String(e);}\n' + code.slice(ix);
await evalJS('window.appready=true;');
await send('Runtime.evaluate', { expression: code, returnByValue: false });
await new Promise(r => setTimeout(r, 700));
const ids = IDS.length ? IDS : JSON.parse(await evalJS('JSON.stringify(window.__C.SOURCES.map(s=>s.id))'));

const T = (cid) => `(async()=>{
  var C=window.__C, s=C.SOURCES.find(x=>x.id===${JSON.stringify(cid)});
  var out={id:${JSON.stringify(cid)}};
  var sorts=(s.cfg&&s.cfg.sorts)||[]; var sort0=(sorts[0]&&sorts[0].id)||'';
  // px replica (mirrors playVideo.px)
  function px(u){ if(!u)return u; if(u.indexOf('//')===0)u='https:'+u; if(u.indexOf('blob:')===0)return u;
    if(u.indexOf(C.PROXY)===0)return u;
    if(C._isAndroid())return C._forceProxyAndroid(u)?C.buildProxyUrl(u):u; return C.buildProxyUrl(u); }
  try{
    var b1=await s.browse('',1,sort0); var i1=(b1&&b1.items)||[];
    out.n=i1.length;
    // dedup within page1
    var seen={},dupIn=0; i1.forEach(v=>{ if(seen[v.id])dupIn++; else seen[v.id]=1; });
    out.dupIn=dupIn;
    // thumbs valid
    out.thumbOk=i1.length?Math.round(100*i1.filter(v=>v.thumb&&v.thumb.indexOf('http')===0&&v.thumb.indexOf('data:')<0).length/i1.length):-1;
    // cross-page dedup
    var b2=await s.browse('',2,sort0); var i2=(b2&&b2.items)||[]; var s1={}; i1.forEach(v=>s1[v.id]=1);
    out.dupX=i2.filter(v=>s1[v.id]).length;
    // sort effectiveness (first id differs for sorts[1] vs sorts[0])
    if(sorts[1]){ var bb=await s.browse('',1,sorts[1].id); var ib=(bb&&bb.items)||[];
      out.sort=(i1[0]&&ib[0])?(i1[0].id!==ib[0].id?'ok':'NOOP'):'?'; } else out.sort='-';
    // per-channel search
    if(s.search){ var sr=await s.search('milf',1); var si=(sr&&sr.items)||[];
      out.searchN=si.length; out.searchMatch=si.length?Math.round(100*si.filter(v=>(v.title||'').toLowerCase().indexOf('milf')>=0).length/si.length):0; }
    else { out.searchN='-'; out.searchMatch='-'; }
    // stream liveness on card[0]
    if(i1[0]&&s.getStream){ var st=await s.getStream(i1[0]); var q=(st&&st.quality)||{}; var u=C.bestQualityUrl(q)||(st&&st.url)||'';
      if(!u){ out.stream='EMPTY'; }
      else { var uu=u.indexOf('//')===0?'https:'+u:u;
        out.kind=(/\\.m3u8/.test(uu)?'m3u8':(/\\.mp4/.test(uu)?'mp4':'other'));
        out.host=(uu.split('//')[1]||'').split('/')[0].slice(0,26);
        var fin=px(u); var testUrl=(fin.indexOf(C.PROXY)===0)?fin:C.buildProxyUrl(fin);
        try{ var resp=await fetch(testUrl,{method:'GET',headers:{Range:'bytes=0-1'}}); out.live=resp.status; out.ctype=(resp.headers.get('content-type')||'').split(';')[0].slice(0,18); }
        catch(e){ out.live='ERR'; } }
    } else out.stream='noGetStream';
  }catch(e){ out.err=String(e).slice(0,30); }
  return out;
})()`;

console.log('id           n  thumb dupIn dupX | sort  | search(n/match) | stream kind  host                       live  ctype');
console.log('-'.repeat(118));
for (const cid of ids) {
  let r; try { r = await evalJS(T(cid)); } catch (e) { r = { id: cid, err: 'eval ' + e.message.slice(0, 30) }; }
  if (r.err) { console.log(`${cid.padEnd(12)} ERR ${r.err}`); continue; }
  const flag = (r.dupIn > 0 ? ' ⚠DUPIN' : '') + (r.dupX > 0 ? ' ⚠DUPX' : '') + (r.sort === 'NOOP' ? ' ⚠SORT' : '') + (r.searchN === 0 ? ' ⚠SEARCH0' : '') + (r.thumbOk >= 0 && r.thumbOk < 90 ? ' ⚠THUMB' : '') + (r.stream === 'EMPTY' ? ' ⚠NOSTREAM' : '') + (typeof r.live === 'number' && r.live >= 400 ? ' ⚠LIVE' + r.live : '');
  console.log(`${cid.padEnd(12)} ${String(r.n).padStart(2)}  ${String(r.thumbOk).padStart(3)}%  ${String(r.dupIn).padStart(2)}   ${String(r.dupX).padStart(2)}  | ${String(r.sort).padEnd(5)} | ${String(r.searchN).padStart(3)}/${String(r.searchMatch).padStart(3)}%      | ${String(r.kind||r.stream||'-').padEnd(5)} ${String(r.host||'').padEnd(26)} ${String(r.live??'-').toString().padStart(4)}  ${r.ctype||''}${flag}`);
}
ws.close();
process.exit(0);
