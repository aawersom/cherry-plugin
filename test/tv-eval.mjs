// Plain CDP runner: NO plugin injection — evaluates a page-side JS file against whatever plugin the
// stand has loaded (the LIVE one, as the owner's TV sees it) and prints its JSON result together
// with every JS exception / console.error raised meanwhile. Use to reproduce "as-deployed" bugs.
//   node test/tv-eval.mjs <page.js> [json-arg]
import { readFileSync } from 'fs';
const PAGE = process.argv[2]; const ARG = process.argv[3];
if (!PAGE) { console.log('usage: node test/tv-eval.mjs <page.js> [json-arg]'); process.exit(1); }
const list = await (await fetch('http://127.0.0.1:9229/json/list', { signal: AbortSignal.timeout(8000) })).json();
const target = list.find(t => t.type === 'page' && /lampa/i.test(t.url)) || list.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const errors = [];
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 300));
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) errors.push(m.params.type.toUpperCase() + ' ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
});
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
await send('Runtime.enable');
const evalJS = async (expr, t = 120000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: t }), new Promise((_, rej) => setTimeout(() => rej(new Error('hard timeout')), t + 5000))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result.value; };
const page = readFileSync(PAGE, 'utf8').trim();
const expr = ARG ? '(' + page + ')(' + JSON.stringify(ARG) + ')' : page;
const out = await evalJS(expr).catch(e => ({ err: String(e).slice(0, 400) }));
console.log(JSON.stringify(out, null, 1));
if (errors.length) console.log('JS ERRORS:\n' + errors.join('\n'));
ws.close(); process.exit(0);
