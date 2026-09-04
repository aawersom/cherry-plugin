// DIAGNOSTIC: search relevance (single + all_sources) and related-by-title quality.
//   node test/tv-diag-relevance.mjs
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
code = code.slice(0, ix) + '\n;try{window.__C={SOURCES:SOURCES,cherryFetch:cherryFetch,_searchGroups:_searchGroups,_translateQuery:_translateQuery,_normText:_normText,_RU_SOURCES:_RU_SOURCES,_searchKeywords:_searchKeywords};}catch(e){window.__C_ERR=String(e);}\n' + code.slice(ix);
await send('Runtime.evaluate', { expression: code, returnByValue: false });
await new Promise(r => setTimeout(r, 700));

const QUERIES = ['milf', 'big tits', 'teen anal', 'blonde massage', 'stepmom', 'большие сиськи', 'зрелая мамка', 'минет'];

// Replicate the REAL all_sources search pipeline (plugin.js:1069-1152) and score top-20.
const out = await evalJS(`(async()=>{
  var C=window.__C, SRC=C.SOURCES;
  function scoreFeed(query){
    var enQuery=C._translateQuery(query);
    var groups=C._searchGroups(query);
    var phrase=C._normText(query);
    function groupHits(title){var t=C._normText(title),n=0;for(var g=0;g<groups.length;g++){for(var k=0;k<groups[g].length;k++){if(t.indexOf(groups[g][k])!==-1){n++;break;}}}return n;}
    var proms=SRC.map(function(src){
      var q=(enQuery&&!C._RU_SOURCES[src.id])?enQuery:query;
      var p=src.search?src.search(q,1):Promise.resolve({items:[]});
      return Promise.race([p.then(function(r){r=r||{items:[]};r._id=src.id;return r;}).catch(function(){return{items:[],_id:src.id};}), new Promise(function(res){setTimeout(function(){res({items:[],_id:src.id});},7000);})]);
    });
    return Promise.all(proms).then(function(results){
      var flat=[];
      results.forEach(function(r){if(r&&r.items&&r.items.length){r.items.forEach(function(v){if(v&&!v.source)v.source=r._id;});var picked=r.items;if(groups.length){var matched=r.items.filter(function(v){return groupHits(v.title)===groups.length;});if(matched.length)picked=matched;}flat=flat.concat(picked.slice(0,10));}});
      if(groups.length){flat=flat.map(function(v,i){return{v:v,h:groupHits(v.title)+(C._normText(v.title).indexOf(phrase)!==-1?0.5:0),i:i};}).sort(function(a,b){return b.h-a.h||a.i-b.i;}).map(function(x){return x.v;});}
      var seen={};flat=flat.filter(function(v){if(!v.title)return true;var key=C._normText(v.title).slice(0,40)+'|'+(Math.round((v.duration||0)/15)*15);if(seen[key])return false;seen[key]=true;return true;});
      var top=flat.slice(0,20);
      var full=top.filter(function(v){return groupHits(v.title)===groups.length;}).length;
      var any=top.filter(function(v){return groupHits(v.title)>0;}).length;
      return {q:query,en:enQuery,total:flat.length,top:top.length,fullMatch:top.length?Math.round(100*full/top.length):-1,anyMatch:top.length?Math.round(100*any/top.length):-1,sample:top.slice(0,4).map(function(v){return (v.source||'?')+':'+String(v.title||'').slice(0,32);})};
    });
  }
  var res=[];
  for(var i=0;i<${JSON.stringify(QUERIES)}.length;i++){ res.push(await scoreFeed(${JSON.stringify(QUERIES)}[i])); }
  return res;
})()`).catch(e => ({ err: String(e).slice(0, 200) }));

console.log('===== ALL-SOURCES SEARCH relevance (top-20) =====');
if (out.err) console.log('ERR', out.err);
else for (const r of out) {
  console.log(`\n"${r.q}"${r.en?' →EN "'+r.en+'"':''}  total=${r.total} top=${r.top}  fullMatch=${r.fullMatch}%  anyMatch=${r.anyMatch}%`);
  (r.sample || []).forEach(s => console.log('   · ' + s));
}

// related-by-title: what query does _searchKeywords build from real titles?
const rel = await evalJS(`(async()=>{
  var C=window.__C;
  var titles=[
    'Busty MILF Stepmom Seduces Her Stepson in the Kitchen',
    'Hot Blonde Teen First Time Anal Casting',
    'Русская зрелая мамка в чулках',
    'Mia Khalifa Full Video HD',
    'Amateur Homemade Sex Tape Compilation'
  ];
  return titles.map(function(t){return {title:t.slice(0,45), kw:C._searchKeywords(t,4)};});
})()`).catch(e => ({ err: String(e) }));
console.log('\n===== «Похожие по названию» query generation (_searchKeywords) =====');
if (rel.err) console.log('ERR', rel.err); else rel.forEach(r => console.log(`  "${r.title}" → "${r.kw}"`));
ws.close();
process.exit(0);
