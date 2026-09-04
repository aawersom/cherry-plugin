// Ground truth for global-search ranking: push a REAL all_sources search grid (components
// re-registered from the current plugin.js via startPlugin) and read the rendered card order.
//   node test/tv-verify-globalrank.mjs [query]
import { readFileSync } from 'fs';
const Q = process.argv[2] || 'blonde';
const list = await (await fetch('http://127.0.0.1:9229/json/list', { signal: AbortSignal.timeout(8000) })).json();
const target = list.find(t => t.type === 'page' && /lampa/i.test(t.url)) || list.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
await send('Runtime.enable');
const ev = async (expr, t = 60000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: t }), new Promise((_, rej) => setTimeout(() => rej(new Error('hard timeout')), t + 5000))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result.value; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let code = readFileSync('D:/Works/Lampa/plugin.js', 'utf8').replace(/^\uFEFF/, '');
code = code.replace('if (window.plugin_cherry_ready) return;', 'window.plugin_cherry_ready = false;');
code = code.replace('if (window.cherry_filter_btn_ready) return;', 'if (true) return;');
await ev('window.appready = true; true');
await send('Runtime.evaluate', { expression: code, returnByValue: false }); await sleep(1200);
await ev(`Lampa.Activity.push({component:'cherry_grid',title:'Поиск: ${Q}',source_id:'xvideos',query:${JSON.stringify(Q)},all_sources:true,page:1}); true`);
await sleep(12000);
const cards = JSON.parse(await ev(`JSON.stringify($(Lampa.Activity.active().activity.render()).find('.card').map(function(){var $c=$(this);return {src:$c.find('.cherry-src-badge').text(),title:$c.find('.card__title').text().slice(0,30)};}).get())`));
console.log('rendered cards:', cards.length);
const bySrc = {}; cards.forEach((c, i) => { (bySrc[c.src] = bySrc[c.src] || []).push(i + 1); });
Object.keys(bySrc).sort((a, b) => bySrc[a][0] - bySrc[b][0]).forEach(s => { const p = bySrc[s]; console.log('  ' + s.padEnd(13) + ' first=' + String(p[0]).padStart(3) + ' last=' + String(p[p.length - 1]).padStart(3) + ' n=' + p.length); });
console.log('top 15:'); cards.slice(0, 15).forEach((c, i) => console.log('  ' + String(i + 1).padStart(2) + '. ' + c.src.padEnd(12) + ' ' + c.title));
ws.close(); process.exit(0);
