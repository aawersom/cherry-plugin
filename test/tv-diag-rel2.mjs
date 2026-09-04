// DIAGNOSTIC 2: getRelated relevance, «Похожие» page2 feed relevance, pornhub unsigned thumb,
// and preview-availability in raw source for the 0%-preview channels.
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
code = code.slice(0, ix) + '\n;try{window.__C={SOURCES:SOURCES,cherryFetch:cherryFetch,_normText:_normText,_searchKeywords:_searchKeywords};}catch(e){window.__C_ERR=String(e);}\n' + code.slice(ix);
await send('Runtime.evaluate', { expression: code, returnByValue: false });
await new Promise(r => setTimeout(r, 700));

// 1) pornhub thumb WITHOUT signature — does phncdn allow unsigned resized image?
const ph = await evalJS(`(async()=>{
  function tryLoad(u){return new Promise(function(res){if(!u)return res('none');var img=new Image();var d=false;var to=setTimeout(function(){if(!d){d=true;res('timeout');}},8000);img.onload=function(){if(!d){d=true;clearTimeout(to);res(img.naturalWidth>1?'OK '+img.naturalWidth+'x'+img.naturalHeight:'0x0');}};img.onerror=function(){if(!d){d=true;clearTimeout(to);res('error');}};img.src=u;});}
  var s=window.__C.SOURCES.find(x=>x.id==='pornhub');
  var b=await s.browse('',1,'mostrecent'); var v=(b.items||[])[0]; if(!v)return {err:'no card'};
  var signed=v.thumb;
  var noQuery=signed.split('?')[0];
  return {signed:signed.slice(0,60), signedLoad:await tryLoad(signed), noQueryLoad:await tryLoad(noQuery), noQuery:noQuery.slice(0,80)};
})()`).catch(e => ({ err: String(e).slice(0, 120) }));
console.log('===== PORNHUB thumb unsigned test =====');
console.log(JSON.stringify(ph, null, 1));

// 2) getRelated relevance: token overlap of related items with the seed title (3 channels)
const rel = await evalJS(`(async()=>{
  var C=window.__C;
  function toks(t){return C._normText(t).split(' ').filter(function(w){return w.length>3;});}
  async function one(cid){
    var s=C.SOURCES.find(x=>x.id===cid); if(!s||!s.getRelated)return {id:cid,skip:1};
    var b=await s.browse('',1,(s.cfg&&s.cfg.sorts&&s.cfg.sorts[0]&&s.cfg.sorts[0].id)||''); var seed=(b.items||[])[0]; if(!seed)return {id:cid,noseed:1};
    var rel=await s.getRelated(seed,1)||[];
    var st=toks(seed.title);
    var overlap=rel.slice(0,12).map(function(r){var rt=toks(r.title);var sh=rt.filter(function(w){return st.indexOf(w)!==-1;}).length;return sh;});
    var withShared=overlap.filter(function(n){return n>0;}).length;
    return {id:cid, seed:String(seed.title).slice(0,40), relN:rel.length, sharePct:overlap.length?Math.round(100*withShared/overlap.length):-1};
  }
  var r=[]; var ids=['pornhub','xvideos','eporner','xozilla','analdin','porntrex'];
  for(var i=0;i<ids.length;i++){ try{r.push(await one(ids[i]));}catch(e){r.push({id:ids[i],err:String(e).slice(0,40)});} }
  return r;
})()`).catch(e => ({ err: String(e).slice(0, 120) }));
console.log('\n===== getRelated relevance (token overlap with seed) =====');
if (rel.err) console.log('ERR', rel.err); else rel.forEach(r => console.log('  ' + JSON.stringify(r)));

// 3) preview availability in raw source for 0%-preview channels
const prev = await evalJS(`(async()=>{
  var C=window.__C;
  var checks={
    eporner:{url:'https://www.eporner.com/api/v2/video/search/?query=milf&per_page=5&page=1&thumbsize=medium&format=json', keys:['preview','embed','default_thumb']},
    hqporner:{url:'https://hqporner.com/', rx:['data-preview','preview','webm','\\\\.mp4','trailer']},
    porntrex:{url:'https://www.porntrex.com/', rx:['data-preview','data-trailer','preview_url','\\\\.mp4/preview','videoContent']},
    pornone:{url:'https://pornone.com/', rx:['data-preview','preview','\\\\.mp4','trailer']},
    tizam:{url:'https://tizam.tv/', rx:['data-preview','preview','\\\\.mp4','trailer','video']},
    lenporno:{url:'https://lenporno.net/', rx:['data-preview','preview','\\\\.mp4','trailer']}
  };
  var out={};
  for(var k in checks){
    try{
      var html=await C.cherryFetch(checks[k].url);
      if(checks[k].keys){ var d=JSON.parse(html); var v=(d.videos||[])[0]||{}; out[k]={apiKeys:Object.keys(v).filter(function(x){return /prev|embed|trailer|mp4|thumb/i.test(x);})}; }
      else { var hits={}; checks[k].rx.forEach(function(p){var re=new RegExp(p,'i');hits[p]=re.test(html);}); out[k]=hits; }
    }catch(e){out[k]='ERR '+String(e).slice(0,40);}
  }
  return out;
})()`).catch(e => ({ err: String(e).slice(0, 120) }));
console.log('\n===== preview availability in raw source (0%-preview channels) =====');
console.log(JSON.stringify(prev, null, 1));
ws.close();
process.exit(0);
