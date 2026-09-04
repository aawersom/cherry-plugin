// VERIFY relevance fixes: (a) new _rankByRelevance surfaces stronger matches higher than the
// raw per-source interleave; (b) «Похожие» page-2 (title-search) is far more relevant to the
// seed than the old newest-feed fallback.  node test/tv-verify-relevance.mjs
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
code = code.slice(0, ix) + '\n;try{window.__C={SOURCES:SOURCES,cherryFetch:cherryFetch,_searchGroups:_searchGroups,_translateQuery:_translateQuery,_normText:_normText,_RU_SOURCES:_RU_SOURCES,_searchKeywords:_searchKeywords,_rankByRelevance:_rankByRelevance};}catch(e){window.__C_ERR=String(e);}\n' + code.slice(ix);
await send('Runtime.evaluate', { expression: code, returnByValue: false });
await new Promise(r => setTimeout(r, 700));

const QUERIES = ['big tits', 'teen anal', 'blonde massage', 'russian mature', 'большие сиськи', 'зрелая мамка'];
const out = await evalJS(`(async()=>{
  var C=window.__C, SRC=C.SOURCES;
  function strong(title,query){ // all query words present as whole words (words are normalized: no regex specials)
    var t=C._normText(title); var ws=C._normText(query).split(' ').filter(Boolean);
    return ws.every(function(w){return new RegExp('(^| )'+w+'($| )').test(t);});
  }
  function phrase(title,query){var p=C._normText(query);return p.indexOf(' ')!==-1 && C._normText(title).indexOf(p)!==-1;}
  async function build(query){
    var enQuery=C._translateQuery(query), groups=C._searchGroups(query);
    function gh(t){t=C._normText(t);var n=0;for(var g=0;g<groups.length;g++){for(var k=0;k<groups[g].length;k++){if(t.indexOf(groups[g][k])!==-1){n++;break;}}}return n;}
    var proms=SRC.map(function(src){var q=(enQuery&&!C._RU_SOURCES[src.id])?enQuery:query;var p=src.search?src.search(q,1):Promise.resolve({items:[]});return Promise.race([p.then(function(r){r=r||{items:[]};return r;}).catch(function(){return{items:[]};}),new Promise(function(res){setTimeout(function(){res({items:[]});},7000);})]);});
    var results=await Promise.all(proms), flat=[];
    results.forEach(function(r){if(r.items&&r.items.length){var picked=r.items;if(groups.length){var m=r.items.filter(function(v){return gh(v.title)===groups.length;});if(m.length)picked=m;}flat=flat.concat(picked.slice(0,10));}});
    return flat;
  }
  var res=[];
  for(var i=0;i<${JSON.stringify(QUERIES)}.length;i++){
    var q=${JSON.stringify(QUERIES)}[i];
    var flat=await build(q);
    var ranked=C._rankByRelevance(flat.slice(),q);
    function top(arr,n,fn){var t=arr.slice(0,n);return t.length?Math.round(100*t.filter(fn).length/t.length):-1;}
    var isStrong=function(v){return strong(v.title,q);}, isPhrase=function(v){return phrase(v.title,q);};
    res.push({q:q, n:flat.length,
      before_strongTop10:top(flat,10,isStrong), after_strongTop10:top(ranked,10,isStrong),
      before_phraseTop5:top(flat,5,isPhrase), after_phraseTop5:top(ranked,5,isPhrase),
      top3:ranked.slice(0,3).map(function(v){return (v.source||'?')+':'+String(v.title||'').slice(0,34);})});
  }
  return res;
})()`).catch(e => ({ err: String(e).slice(0, 200) }));
console.log('===== SEARCH RANKING: before(interleave) vs after(_rankByRelevance) =====');
if (out.err) console.log('ERR', out.err); else out.forEach(r => {
  console.log(`\n"${r.q}" (n=${r.n})`);
  console.log(`  strong-match top10:  ${r.before_strongTop10}%  →  ${r.after_strongTop10}%`);
  console.log(`  exact-phrase top5:   ${r.before_phraseTop5}%  →  ${r.after_phraseTop5}%`);
  r.top3.forEach(s => console.log('   1-3· ' + s));
});

// «Похожие» page2 relevance: seed → title-keyword search → token overlap with seed
const rel = await evalJS(`(async()=>{
  var C=window.__C;
  function toks(t){return C._normText(t).split(' ').filter(function(w){return w.length>3;});}
  async function one(cid){
    var s=C.SOURCES.find(x=>x.id===cid); if(!s)return{id:cid,skip:1};
    var b=await s.browse('',1,(s.cfg&&s.cfg.sorts&&s.cfg.sorts[0]&&s.cfg.sorts[0].id)||''); var seed=(b.items||[])[0]; if(!seed)return{id:cid,noseed:1};
    var kw=C._searchKeywords(seed.title,4);
    var page2 = s.search ? (await s.search(kw,1).catch(function(){return{items:[]}})).items||[] : [];
    var st=toks(seed.title);
    var ov=page2.slice(0,12).map(function(r){return toks(r.title).filter(function(w){return st.indexOf(w)!==-1;}).length;});
    return {id:cid, seed:String(seed.title).slice(0,38), kw:kw, page2N:page2.length, page2SharePct:ov.length?Math.round(100*ov.filter(function(n){return n>0;}).length/ov.length):-1};
  }
  var r=[], ids=['pornhub','xozilla','xvideos','analdin'];
  for(var i=0;i<ids.length;i++){try{r.push(await one(ids[i]));}catch(e){r.push({id:ids[i],err:String(e).slice(0,40)});}}
  return r;
})()`).catch(e => ({ err: String(e).slice(0, 120) }));
console.log('\n===== «Похожие» PAGE-2 (title-search) relevance vs seed =====');
if (rel.err) console.log('ERR', rel.err); else rel.forEach(r => console.log('  ' + JSON.stringify(r)));
ws.close();
process.exit(0);
