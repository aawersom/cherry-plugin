// Owner-complaint audit across channels (see tv-full-audit.page.js). Injects LOCAL plugin.js.
//   node test/tv-full-audit.mjs [ids...]   → rows on stdout, full JSON in D:/tmp/full-audit.json
import { readFileSync, writeFileSync } from 'fs';
const IDS = process.argv.slice(2);
const OUT = process.env.AUDIT_OUT || 'D:/tmp/full-audit.json';
const list = await (await fetch('http://127.0.0.1:9229/json/list', { signal: AbortSignal.timeout(8000) })).json();
const target = list.find(t => t.type === 'page' && /lampa/i.test(t.url)) || list.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
await send('Runtime.enable');
const evalJS = async (expr, t = 240000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: t }), new Promise((_, rej) => setTimeout(() => rej(new Error('hard timeout')), t + 5000))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result.value; };
let code = readFileSync('D:/Works/Lampa/plugin.js', 'utf8').replace(/^\uFEFF/, '');
code = code.replace('if (window.plugin_cherry_ready) return;', 'window.plugin_cherry_ready = false;');
code = code.replace('if (window.appready) {', 'if (false) {');
const ix = code.lastIndexOf('})();');
code = code.slice(0, ix) + "\n;try{window.__C={SOURCES:SOURCES,_activeSources:_activeSources,cherryFetch:cherryFetch,_proxyTextAny:_proxyTextAny,_RU_SOURCES:_RU_SOURCES,_translateQuery:_translateQuery,_normText:_normText,_decodeHtml:_decodeHtml,bestQualityUrl:bestQualityUrl};}catch(e){window.__C_ERR=String(e);}\n" + code.slice(ix);
await send('Runtime.evaluate', { expression: 'window.__C_ERR="";', returnByValue: true });
await send('Runtime.evaluate', { expression: code, returnByValue: false });
await new Promise(r => setTimeout(r, 800));
const e0 = await evalJS('window.__C_ERR||""'); if (e0) console.log('__C_ERR', e0);
const ids = IDS.length ? IDS : JSON.parse(await evalJS('JSON.stringify(window.__C._activeSources().map(s=>s.id))'));
const PAGE = readFileSync('D:/Works/Lampa/test/tv-full-audit.page.js', 'utf8').trim();
const rows = [];
for (const cid of ids) {
  let r; try { r = await evalJS('(' + PAGE + ')(' + JSON.stringify(cid) + ')'); } catch (e) { r = { id: cid, err: String(e).slice(0, 80) }; }
  rows.push(r); writeFileSync(OUT, JSON.stringify(rows, null, 1));
  console.log([cid.padEnd(12), 'n=' + r.n, 'dupUrl=' + r.dupUrl, 'feedInt=' + JSON.stringify(r.feedInt), 'sNat=' + r.sNat, 'sCyrRaw=' + r.sCyrRaw, 'sCyrTr=' + r.sCyrTr, 'sInt=' + JSON.stringify(r.searchInt), 'rel=' + r.rel, 'self=' + r.relSelf, 'dup=' + r.relDup, 'feedOv=' + r.relFeedOv, 'topical=' + r.relTopical, 'relInt=' + JSON.stringify(r.relInt), 'foreign=' + JSON.stringify(r.relForeign), 'stream=' + r.stream, r.err || ''].join(' '));
}
ws.close(); process.exit(0);
