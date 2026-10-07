// Stand readiness probe used by tv-reset.sh: prints "<typeof Lampa>|<appready?1:0>" ("object|1" = ready).
// Lives in the repo (it used to sit in %TEMP% and vanished on cleanup).
const list = await (await fetch('http://127.0.0.1:9229/json/list', { signal: AbortSignal.timeout(6000) })).json();
const t = list.find(x => x.type === 'page' && /lampa/i.test(x.url)) || list.find(x => x.type === 'page');
if (!t) { console.log('nopage'); process.exit(0); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id === 1) { console.log(m.result?.result?.value ?? 'err'); ws.close(); process.exit(0); } });
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: "typeof Lampa + '|' + (window.appready ? 1 : 0)", returnByValue: true } }));
setTimeout(() => { console.log('timeout'); process.exit(0); }, 5000);
