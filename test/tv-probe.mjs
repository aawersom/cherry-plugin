// Probe candidate paginating URLs for the 4 default-feed channels via cherryFetch on the stand.
// Extracts video ids per-channel regex; prints count + first ids so we can see which URL paginates.
//   node test/tv-probe.mjs
import { readFileSync } from 'fs';
const list = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const target = list.find(t => t.type === 'page' && /lampa/i.test(t.url)) || list.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
await send('Runtime.enable');
const evalJS = async (expr, t = 60000) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: t }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result.value; };
let code = readFileSync('D:/Works/Lampa/plugin.js', 'utf8').replace(/^﻿/, '');
code = code.replace('if (window.plugin_cherry_ready) return;', 'window.plugin_cherry_ready = false;');
const ix = code.lastIndexOf('})();');
code = code.slice(0, ix) + '\n;try{window.__CHERRY={SOURCES:SOURCES,cherryFetch:cherryFetch};}catch(e){window.__CHERRY_ERR=String(e);}\n' + code.slice(ix);
await evalJS('window.appready=true;');
await send('Runtime.evaluate', { expression: code, returnByValue: false });
await new Promise(r => setTimeout(r, 700));

const RX = {
  xvideos: String.raw`\/video\.([a-z0-9]+)\/`,
  pornone: String.raw`href="https?:\/\/pornone\.com\/[^"]*?\/(\d{4,})\/`,
  tizam: String.raw`\/fil_my_dlya_vzroslyh\/[^\/?#"]+\/([^\/?#"]+)\/`,
  hellporno: String.raw`hellporno\.com\/videos\/([^"\/]+)`,
};
const CANDS = [
  ['xvideos', 'best/', 'https://www.xvideos2.com/best/'],
  ['xvideos', 'best/1', 'https://www.xvideos2.com/best/1'],
  ['xvideos', 'new/0', 'https://www.xvideos2.com/new/0'],
  ['xvideos', 'new/1', 'https://www.xvideos2.com/new/1'],
  ['xvideos', 'new/2', 'https://www.xvideos2.com/new/2'],
  ['pornone', '/', 'https://pornone.com/'],
  ['pornone', 'page/2/', 'https://pornone.com/page/2/'],
  ['pornone', 'latest-videos/2/', 'https://pornone.com/latest-videos/2/'],
  ['pornone', 'recent-videos/2/', 'https://pornone.com/recent-videos/2/'],
  ['pornone', 'newest/2/', 'https://pornone.com/newest/2/'],
  ['tizam', '?p=0', 'https://tv4.tizam.org/?p=0'],
  ['tizam', '?p=1', 'https://tv4.tizam.org/?p=1'],
  ['tizam', 'all_sex/?p=0', 'https://tv4.tizam.org/fil_my_dlya_vzroslyh/all_sex/?p=0'],
  ['tizam', 'all_sex/?p=1', 'https://tv4.tizam.org/fil_my_dlya_vzroslyh/all_sex/?p=1'],
  ['hellporno', '1/?sort=date', 'https://hellporno.com/1/?sort_by=post_date'],
  ['hellporno', '2/?sort=date', 'https://hellporno.com/2/?sort_by=post_date'],
  ['hellporno', 'latest-updates/', 'https://hellporno.com/latest-updates/'],
  ['hellporno', 'latest-updates/2/', 'https://hellporno.com/latest-updates/2/'],
];

const probe = (chan, url, rxSrc) => `(async()=>{
  try{
    var html = await window.__CHERRY.cherryFetch(${JSON.stringify(url)});
    if(!html) return {n:0,ids:[],len:0};
    var rx = new RegExp(${JSON.stringify(rxSrc)}, 'g'); var seen={}, ids=[], m;
    while((m=rx.exec(html))!==null){ if(!seen[m[1]]){seen[m[1]]=1; ids.push(m[1]);} }
    return {n:ids.length, ids:ids.slice(0,3), len:html.length};
  }catch(e){ return {err:String(e).slice(0,40)}; }
})()`;

console.log('chan       label              n    first ids');
console.log('-'.repeat(80));
for (const [chan, label, url] of CANDS) {
  let r; try { r = await evalJS(probe(chan, url, RX[chan])); } catch (e) { r = { err: e.message.slice(0, 40) }; }
  if (r.err) { console.log(`${chan.padEnd(10)} ${label.padEnd(18)} ERR ${r.err}`); continue; }
  console.log(`${chan.padEnd(10)} ${label.padEnd(18)} ${String(r.n).padStart(3)}  ${(r.ids || []).join(', ')}`);
}
ws.close();
process.exit(0);
