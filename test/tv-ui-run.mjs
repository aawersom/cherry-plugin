// UI runner: inject the CURRENT plugin.js WITH startPlugin (re-registers cherry_main /
// cherry_grid components from the working copy), then evaluate a page-side JS file and print
// its JSON result. Use this (not tv-page-run.mjs) when the probe renders real components.
//   node test/tv-ui-run.mjs <page.js> [json-arg]
import { readFileSync } from 'fs';
const PAGE = process.argv[2]; const ARG = process.argv[3];
if (!PAGE) { console.log('usage: node test/tv-ui-run.mjs <page.js> [json-arg]'); process.exit(1); }
const list = await (await fetch('http://127.0.0.1:9229/json/list', { signal: AbortSignal.timeout(8000) })).json();
const target = list.find(t => t.type === 'page' && /lampa/i.test(t.url)) || list.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
await send('Runtime.enable');
const evalJS = async (expr, t = 120000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: t }), new Promise((_, rej) => setTimeout(() => rej(new Error('hard timeout')), t + 5000))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result.value; };
let code = readFileSync('D:/Works/Lampa/plugin.js', 'utf8').replace(/^\uFEFF/, '');
code = code.replace('if (window.plugin_cherry_ready) return;', 'window.plugin_cherry_ready = false;');
code = code.replace('if (window.cherry_filter_btn_ready) return;', 'if (true) return;');
await evalJS('window.appready = true; true');
await send('Runtime.evaluate', { expression: code, returnByValue: false });
await new Promise(r => setTimeout(r, 1200));
const page = readFileSync(PAGE, 'utf8').trim();
const expr = ARG ? '(' + page + ')(' + JSON.stringify(ARG) + ')' : page;
const out = await evalJS(expr).catch(e => ({ err: String(e).slice(0, 300) }));
console.log(JSON.stringify(out, null, 1));
ws.close(); process.exit(0);
