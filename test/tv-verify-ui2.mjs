// Verify v0.13.14 UI changes on the stand with the REAL components (force re-inject with
// startPlugin so the edited CherryMain/CherryGrid replace the registered ones):
//   (a) home tiles get health dots (ring → green/gray as probes settle)
//   (b) hover-preview <video> plays on card focus on Android
//   (c) search picker shows Russian quick-picks; a performed query shows up as ↺ recent
// Shots → D:/tmp/ui/2*.png.   node test/tv-verify-ui2.mjs
import { execSync } from 'child_process';
import { readFileSync, mkdirSync } from 'fs';
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
const ev = async (expr, t = 30000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: t }), new Promise((_, rej) => setTimeout(() => rej(new Error('hard timeout')), t + 5000))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result.value; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = (name) => { try { execSync(`"${ADB}" exec-out screencap -p > "${OUT}/${name}.png"`, { shell: 'cmd.exe', timeout: 20000 }); console.log('shot:', name); } catch (e) { console.log('shot failed', name); } };
const key = (k) => { try { execSync(`"${ADB}" shell input keyevent ${k}`, { timeout: 15000 }); } catch (e) { console.log('key failed', k); } };
const push = async (obj) => { await ev(`Lampa.Activity.push(${JSON.stringify(obj)}); true`); };

// force re-inject WITH startPlugin (Component.add overrides the previously registered ctors)
let code = readFileSync('D:/Works/Lampa/plugin.js', 'utf8').replace(/^\uFEFF/, '');
code = code.replace('if (window.plugin_cherry_ready) return;', 'window.plugin_cherry_ready = false;');
code = code.replace("if (window.cherry_filter_btn_ready) return;", "if (false) return;"); // let addFilterButton re-run harmlessly
await ev('window.appready = true; try{Lampa.Storage.set("cherry_src_health",{});Lampa.Storage.set("cherry_rq",[]);}catch(e){} true'); // fresh caches
await send('Runtime.evaluate', { expression: code, returnByValue: false });
await sleep(1200);
console.log('re-injected; version:', await ev('(function(){var s=document.querySelector("#cherry-plugin-styles");return s?"styles ok":"no styles"})()'));

// (a) home + health dots
await push({ component: 'cherry_main', title: 'Cherry', page: 1 }); await sleep(2500); shot('20-home-dots-initial');
const dots0 = await ev('JSON.stringify({ok:$(".cherry-dot--ok").length,bad:$(".cherry-dot--bad").length,unk:$(".cherry-dot--unk").length})');
console.log('dots @2.5s:', dots0);
await sleep(40000);
const dots1 = await ev('JSON.stringify({ok:$(".cherry-dot--ok").length,bad:$(".cherry-dot--bad").length,unk:$(".cherry-dot--unk").length, cache:Object.keys(Lampa.Storage.get("cherry_src_health",{})).length})');
console.log('dots @42s:', dots1); shot('21-home-dots-settled');
const badIds = await ev('JSON.stringify(Object.keys(Lampa.Storage.get("cherry_src_health",{})).filter(function(k){return !Lampa.Storage.get("cherry_src_health",{})[k].ok;}))');
console.log('gray (down) channels:', badIds);

// (b) preview on focus
await push({ component: 'cherry_grid', title: 'Xvideos', source_id: 'xvideos', page: 1 }); await sleep(7000);
key('KEYCODE_DPAD_RIGHT'); await sleep(2500);
const pv = await ev('(function(){var v=document.querySelector(".card.focus video.cherry-card__preview")||document.querySelector("video.cherry-card__preview");if(!v)return JSON.stringify({video:false});return JSON.stringify({video:true,src:(v.currentSrc||v.src||"").slice(0,60),paused:v.paused,t:v.currentTime,ready:v.readyState,display:v.style.display,opacity:v.style.opacity});})()');
console.log('preview on focus:', pv); shot('22-grid-preview-playing');
await sleep(1500);
const pv2 = await ev('(function(){var v=document.querySelector("video.cherry-card__preview");return v?String(v.currentTime):"none";})()');
console.log('preview currentTime +1.5s:', pv2);
key('KEYCODE_DPAD_RIGHT'); await sleep(300); key('KEYCODE_DPAD_RIGHT'); await sleep(300); // scroll through — dwell timer must not fire mid-scroll
const pv3 = await ev('(function(){var vs=document.querySelectorAll("video.cherry-card__preview");var playing=0;vs.forEach(function(v){if(!v.paused&&v.style.display!=="none")playing++;});return JSON.stringify({videos:vs.length,playing:playing});})()');
console.log('after quick scroll (expect ≤1 playing):', pv3);

// (c) search picker RU picks + recents
await push({ component: 'cherry_main', title: 'Cherry', page: 1 }); await sleep(2500);
key('KEYCODE_DPAD_CENTER'); await sleep(1800); shot('23-search-picker-ru');
const picks0 = await ev('JSON.stringify($(".selectbox-item__title").map(function(){return $(this).text();}).get().slice(0,8))');
console.log('picker items:', picks0);
// choose the first popular term: DOWN past "Ввести" (+"Голосом" if present)
const hasVoice = /Голосом/.test(picks0);
key('KEYCODE_DPAD_DOWN'); await sleep(300); if (hasVoice) { key('KEYCODE_DPAD_DOWN'); await sleep(300); }
key('KEYCODE_DPAD_CENTER'); await sleep(9000); shot('24-search-ru-result');
const title = await ev('(function(){var a=Lampa.Activity.active();return a&&a.activity&&a.activity.render?$(a.activity.render()).find(".head__title, .activity__title").text().slice(0,40):"?"})()');
console.log('search activity title:', title, '| recents:', await ev('JSON.stringify(Lampa.Storage.get("cherry_rq",[]))'));
key('KEYCODE_BACK'); await sleep(2000);
key('KEYCODE_DPAD_CENTER'); await sleep(1800); shot('25-search-picker-recent');
console.log('picker items now:', await ev('JSON.stringify($(".selectbox-item__title").map(function(){return $(this).text();}).get().slice(0,6))'));
key('KEYCODE_BACK'); await sleep(500);
ws.close(); process.exit(0);
