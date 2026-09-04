// Real-path check of the EMPTY favorites screen with the plugin loaded by Lampa itself
// (no injection): open Cherry home, D-pad to the favorites tile («Случайные»), press OK,
// then inspect the DOM (empty box? focusable?) and screenshot. Run right after tv-reset.sh.
import { execSync } from 'child_process';
const ADB = 'D:/Android/Sdk/platform-tools/adb.exe';
const list = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const target = list.find(t => t.type === 'page' && /lampa/i.test(t.url)) || list.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
await send('Runtime.enable');
const ev = async (expr, t = 30000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: t }), new Promise((_, rej) => setTimeout(() => rej(new Error('hard timeout')), t + 5000))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result.value; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const key = (k) => { try { execSync(`"${ADB}" shell input keyevent ${k}`, { timeout: 15000 }); } catch (e) { console.log('key failed', k); } };
const shot = (n) => { try { execSync(`"${ADB}" exec-out screencap -p > "D:/tmp/ui/${n}.png"`, { shell: 'cmd.exe', timeout: 20000 }); console.log('shot:', n); } catch (e) { console.log('shot failed'); } };

console.log('plugin loaded by Lampa itself:', await ev('JSON.stringify({grid:!!(Lampa.Component.get&&Lampa.Component.get("cherry_grid")), injected:!!window.__C, plugins:(Lampa.Storage.get("plugins",[])||[]).map(function(p){return p.url;})})'));
console.log('favorites count:', await ev('(Lampa.Storage.get("cherry_favs",[])||[]).length'));
await ev('Lampa.Activity.push({component:"cherry_main",title:"Cherry",page:1}); true'); await sleep(3000);
// tiles: [Поиск][Все видео][Случайные]... → RIGHT ×2 then OK
key('KEYCODE_DPAD_RIGHT'); await sleep(500); key('KEYCODE_DPAD_RIGHT'); await sleep(500);
console.log('focused tile:', await ev('$(".card.focus .card__title").text()||$(".card.focus").find(".card__title,.card__name").text()||"?"'));
key('KEYCODE_DPAD_CENTER'); await sleep(3500);
const dom = await ev('(function(){var a=Lampa.Activity.active();var $r=$(a.activity.render());return JSON.stringify({component:a.component,is_favorites:!!(a.activity&&a.activity.object&&a.activity.object.is_favorites)||!!a.is_favorites,title:$(".head__title").text().slice(0,30),emptyBox:$r.find(".empty").length,emptyText:$r.find(".empty__descr").text().slice(0,70),selectors:$r.find(".selector").length,cards:$r.find(".card").length,htmlLen:$r.html().length,focusedAny:$(".focus").length});})()');
console.log('favorites screen DOM:', dom); shot('30-favorites-real-path');
// can the user get out / is anything focusable? press DOWN then BACK
key('KEYCODE_DPAD_DOWN'); await sleep(600);
console.log('after DOWN focused:', await ev('$(".focus").length+"|"+$(".focus").attr("class")'));
key('KEYCODE_BACK'); await sleep(1500);
console.log('after BACK active:', await ev('(Lampa.Activity.active()||{}).component'));
ws.close(); process.exit(0);
