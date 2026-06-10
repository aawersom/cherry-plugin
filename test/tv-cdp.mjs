// Drive the REAL Lampa app (Android TV emulator) via RAW CDP over WebSocket — code, not screenshots.
// (Playwright connectOverCDP fails on Android WebView; raw CDP Runtime.evaluate works.)
// Prereq: emulator + debuggable Lampa + adb forward tcp:9229 localabstract:webview_devtools_remote_<pid>.
//   node test/tv-cdp.mjs inspect
//   node test/tv-cdp.mjs inject
//   node test/tv-cdp.mjs eval "<js-expression>"
import { readFileSync } from 'fs';

const CMD = process.argv[2] || 'inspect';
const ARG = process.argv[3] || '';

const list = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const target = list.find(t => t.type === 'page' && /lampa/i.test(t.url)) || list.find(t => t.type === 'page') || list[0];
if (!target) { console.log('no page target'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
function send(method, params = {}) {
  return new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
}
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
});
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
await send('Runtime.enable');

async function evalJS(expr, awaitPromise = true) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise, allowUnsafeEvalBlocklist: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

const STATE = `(() => ({
  url: location.href, title: document.title,
  hasLampa: typeof window.Lampa !== 'undefined',
  menuItems: [...document.querySelectorAll('.menu__item')].map(e=>(e.textContent||'').trim().slice(0,14)).filter(Boolean).slice(0,22),
  cherryInMenu: [...document.querySelectorAll('.menu__item')].some(e=>/cherry/i.test(e.textContent||'')),
  focus: (()=>{const f=[...document.querySelectorAll('.focus')].pop();return f?(f.textContent||'').trim().replace(/\\s+/g,' ').slice(0,40):null;})(),
  cherryReady: !!window.plugin_cherry_ready,
  cards: document.querySelectorAll('.card').length,
  bodyLen: document.body?document.body.innerHTML.length:0
}))()`;

try {
  if (CMD === 'inspect') {
    console.log(JSON.stringify(await evalJS(STATE), null, 1));
  } else if (CMD === 'inject') {
    const code = readFileSync('D:/Works/Lampa/plugin.js', 'utf8').replace(/^﻿/, '');
    await evalJS('window.appready = true;');
    // run the plugin IIFE in page context
    await send('Runtime.evaluate', { expression: code, returnByValue: false });
    await new Promise(r => setTimeout(r, 1500));
    console.log('injected. state:', JSON.stringify(await evalJS(STATE), null, 1));
  } else if (CMD === 'eval') {
    const v = await evalJS(ARG);
    console.log(typeof v === 'object' ? JSON.stringify(v, null, 1) : String(v));
  }
} catch (e) { console.log('ERR:', e.message); }
ws.close();
process.exit(0);
