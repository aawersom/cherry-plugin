// UI screenshot tour of the REAL Cherry plugin on the emulator. Pushes real activities via
// CDP, waits for render, captures via `adb exec-out screencap`, and exercises the card
// long-press menu + the actions (filter) menu with D-pad. Output: D:/tmp/ui/*.png
//   node test/tv-ui-shots.mjs
import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
const ADB = 'D:/Android/Sdk/platform-tools/adb.exe';
const OUT = 'D:/tmp/ui'; mkdirSync(OUT, { recursive: true });
const list = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const target = list.find(t => t.type === 'page' && /lampa/i.test(t.url)) || list.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
await send('Runtime.enable');
const ev = async (expr, t = 30000) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: t }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result.value; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = (name) => { execSync(`"${ADB}" exec-out screencap -p > "${OUT}/${name}.png"`, { shell: 'cmd.exe' }); console.log('shot:', name); };
const key = (k, long = false) => execSync(`"${ADB}" shell input keyevent ${long ? '--longpress ' : ''}${k}`);
const push = async (obj) => { await ev(`Lampa.Activity.push(${JSON.stringify(obj)}); true`); };

// The stand's Lampa has no Cherry in its plugin list (AVD was wiped) → inject the FULL plugin
// INCLUDING startPlugin() (keep the appready branch, force appready=true) so components, lang,
// styles, settings and the menu button register exactly as in production.
import { readFileSync } from 'fs';
if (!(await ev('!!(Lampa.Component && Lampa.Component.get && Lampa.Component.get("cherry_grid"))'))) {
  let code = readFileSync('D:/Works/Lampa/plugin.js', 'utf8').replace(/^\uFEFF/, '');
  code = code.replace('if (window.plugin_cherry_ready) return;', 'window.plugin_cherry_ready = false;');
  await ev('window.appready = true; true');
  await send('Runtime.evaluate', { expression: code, returnByValue: false });
  await sleep(1500);
  console.log('injected with startPlugin → cherry_grid registered:', await ev('!!(Lampa.Component.get && Lampa.Component.get("cherry_grid"))'));
}

console.log('plugin version in page:', await ev('(function(){try{return Lampa.Storage.get("cherry_version")||"?"}catch(e){return "?"}})()'));
console.log('cherry components:', await ev('JSON.stringify([!!Lampa.Component.get("cherry_main"), !!Lampa.Component.get("cherry_grid")])'));

// 1) Home picker
await push({ component: 'cherry_main', title: 'Cherry', page: 1 }); await sleep(3500); shot('01-home');
// 2) Channel grid (xvideos browse)
await push({ component: 'cherry_grid', title: 'Xvideos', source_id: 'xvideos', page: 1 }); await sleep(6000); shot('02-grid-xvideos');
// focus moves: a card focused state + hover preview (if enabled)
key('KEYCODE_DPAD_RIGHT'); await sleep(2500); shot('03-grid-card-focus');
// 3) Long-press OK → card menu
key('KEYCODE_DPAD_CENTER', true); await sleep(2000); shot('04-card-menu');
key('KEYCODE_BACK'); await sleep(1200);
// 4) Actions/filter menu (Поиск/Сортировка/Категории/Модели)
try { await ev('(function(){var a=Lampa.Activity.active();var c=a&&a.activity&&a.activity.component;if(c&&c.openActionsMenu){c.openActionsMenu();return "opened"}return "no-openActionsMenu"})()').then(r=>console.log('actions menu:', r)); } catch (e) { console.log('actions menu err', String(e).slice(0,80)); }
await sleep(1800); shot('05-actions-menu');
key('KEYCODE_BACK'); await sleep(1000);
// 5) All videos
await push({ component: 'cherry_grid', title: 'Все видео', source_id: 'xvideos', all_videos: true, page: 1 }); await sleep(9000); shot('06-all-videos');
// 6) Global search result
await push({ component: 'cherry_grid', title: 'Поиск: milf', source_id: 'xvideos', query: 'milf', all_sources: true, page: 1 }); await sleep(9000); shot('07-search-milf');
// 7) Favorites (likely empty on this stand) + history
await push({ component: 'cherry_grid', title: 'Избранное', source_id: 'xvideos', is_favorites: true, page: 1 }); await sleep(3000); shot('08-favorites');
await push({ component: 'cherry_grid', title: 'Продолжить', source_id: 'xvideos', is_history: true, page: 1 }); await sleep(3000); shot('09-history');
// 8) Search picker (popular terms / voice / keyboard) — open from home tile
await push({ component: 'cherry_main', title: 'Cherry', page: 1 }); await sleep(3000);
key('KEYCODE_DPAD_CENTER'); await sleep(2000); shot('10-search-picker');
key('KEYCODE_BACK'); await sleep(800);
// 9) Settings → Cherry section
try { await ev('Lampa.Settings.open ? (Lampa.Settings.open("cherry"),"open") : (Lampa.Activity.push({component:"settings",title:"Settings"}),"push")').then(r=>console.log('settings:', r)); } catch (e) { console.log('settings err', String(e).slice(0,80)); }
await sleep(3000); shot('11-settings');
key('KEYCODE_BACK'); await sleep(800);
ws.close(); process.exit(0);
