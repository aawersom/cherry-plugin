// Full per-channel matrix (catalog / search / preview / playback / related / models / latency).
//   node test/tv-audit6.mjs [ids...]   → also writes D:/tmp/audit6.json
import { readFileSync, writeFileSync } from 'fs';
const IDS = process.argv.slice(2);
const list = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const target = list.find(t => t.type === 'page' && /lampa/i.test(t.url)) || list.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
await send('Runtime.enable');
const evalJS = async (expr, t = 200000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: t }), new Promise((_, rej) => setTimeout(() => rej(new Error('hard timeout')), t + 5000))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result.value; };
let code = readFileSync('D:/Works/Lampa/plugin.js', 'utf8').replace(/^\uFEFF/, '');
code = code.replace('if (window.plugin_cherry_ready) return;', 'window.plugin_cherry_ready = false;');
code = code.replace('if (window.appready) {', 'if (false) {');
const ix = code.lastIndexOf('})();');
code = code.slice(0, ix) + "\n;try{window.__C={SOURCES:SOURCES,_RU_SOURCES:_RU_SOURCES,bestQualityUrl:bestQualityUrl,_forceProxyAndroid:_forceProxyAndroid,buildProxyUrl:buildProxyUrl};}catch(e){window.__C_ERR=String(e);}\n" + code.slice(ix);
await send('Runtime.evaluate', { expression: code, returnByValue: false });
await new Promise(r => setTimeout(r, 600));
const ids = IDS.length ? IDS : JSON.parse(await evalJS('JSON.stringify(window.__C.SOURCES.map(s=>s.id))'));
const PAGE = readFileSync('D:/Works/Lampa/test/tv-audit6.page.js', 'utf8').trim();
const rows = [];
console.log('id           |  n   ms  thumb clip dur | p2new catN catOv | search: n match honour p2new | rel models | play');
console.log('-'.repeat(118));
for (const cid of ids) {
  let r; try { r = await evalJS('(' + PAGE + ')(' + JSON.stringify(cid) + ')'); } catch (e) { r = { id: cid, play: 'EVAL ' + String(e).slice(0, 30) }; }
  rows.push(r);
  const P = (v, w = 4) => String(v === undefined ? '' : v).padStart(w);
  const flags = [];
  if (r.sHonour === 'SAME') flags.push('⚠SEARCH-IGNORES-QUERY'); if (typeof r.sMatch === 'number' && r.sMatch >= 0 && r.sMatch < 50) flags.push('⚠LOW-MATCH');
  if (typeof r.catOv === 'number' && r.catOv > 60) flags.push('⚠CAT-NOFILTER'); if (typeof r.p2 === 'number' && r.p2 >= 0 && r.p2 < 50) flags.push('⚠PAGINATION');
  if (typeof r.play === 'string' && !/^(MP4|HLS)$/.test(r.play)) flags.push('⚠PLAY'); if (r.ms > 4000) flags.push('⚠SLOW');
  console.log(`${cid.padEnd(12)} | ${P(r.n, 3)} ${P(r.ms, 5)} ${P(r.thumb)} ${P(r.clip)} ${P(r.dur)} | ${P(r.p2, 5)} ${P(r.catN)} ${P(r.catOv, 5)} | ${P(r.sN, 8)} ${P(r.sMatch, 5)} ${P(r.sHonour, 6)} ${P(r.sP2, 5)} | ${P(r.rel)} ${P(r.models, 6)} | ${String(r.kind || '').padEnd(3)} ${r.play} ${flags.join(' ')}`);
}
writeFileSync('D:/tmp/audit6.json', JSON.stringify(rows, null, 1));
ws.close(); process.exit(0);
