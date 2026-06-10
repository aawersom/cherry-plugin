// Cherry — UI/UX E2E harness (Phase 3, Playwright/Chromium, FREE + local).
//   node test/ui-e2e.mjs
//
// Loads a REAL Lampa (lampa.stream) in headless Chromium, injects the LOCAL plugin.js,
// renders the actual Cherry UI (cherry_main → cherry_grid), then drives it with the
// keyboard (= TV remote D-pad: arrows / Enter / Backspace) and asserts what's on screen
// + saves screenshots. Catches UI/UX regressions (focus, menus, rendering, navigation)
// that vitest and the Node stream-matrix can't see. FREE: Playwright is local, no quota.
//
// Note: tests the BROWSER UI (same Cherry component code), not the native Android player.

import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'fs';

const LAMPA = 'https://lampa.stream/';
const PLUGIN = 'D:/Works/Lampa/plugin.js';
const SHOTS = 'D:/Works/Lampa/tasks/ui-screenshots';
mkdirSync(SHOTS, { recursive: true });

const pluginCode = readFileSync(PLUGIN, 'utf-8').replace(/^﻿/, '');
const results = [];
function check(name, pass, info) { results.push({ name, pass, info: info || '' }); console.log(`${pass ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`); }

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  ignoreHTTPSErrors: true,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0',
});
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 120)));

async function key(k, n = 1) { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(180); } }

try {
  // 1. Load Lampa
  await page.goto(LAMPA, { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForFunction(() => typeof window.Lampa !== 'undefined' && !!window.Lampa.Storage && !!window.Lampa.Component, { timeout: 30000 });
  check('Lampa loaded', true, await page.evaluate(() => 'keys=' + Object.keys(window.Lampa).length));

  // First-run onboarding = language pick ("Добро пожаловать"). Russian is focused → Enter
  // renders the full main menu (the app layout, so Activity.push has a container).
  await page.waitForTimeout(3500);
  await key('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.menu__item').length > 0, { timeout: 15000 });
  check('onboarding passed → main menu', true, await page.evaluate(() => document.querySelectorAll('.menu__item').length + ' menu items'));

  // 2. Inject local plugin.js → registers cherry_main / cherry_grid + Cherry menu button.
  await page.evaluate(() => { window.appready = true; });
  await page.addScriptTag({ content: pluginCode });
  await page.waitForTimeout(1200);
  const registered = await page.evaluate(() => ({
    ready: !!window.plugin_cherry_ready,
    cherryInMenu: [...document.querySelectorAll('.menu__item')].some(e => /cherry/i.test(e.textContent || '')),
  }));
  check('plugin injected + Cherry in menu', registered.ready && registered.cherryInMenu, JSON.stringify(registered));

  // 3. Open the real Cherry UI (cherry_main)
  await page.evaluate(() => {
    Lampa.Activity.push({ url: '', title: 'Cherry', component: 'cherry_main', page: 1 });
  });
  // wait for Cherry render: its container / cards / letter tiles
  let rendered = false;
  try {
    await page.waitForFunction(() => {
      const a = document.querySelector('.cherry-cat, .cherry-main, [class*="cherry"]');
      return !!a && document.querySelectorAll('.card, .selector, [class*="cherry"] .card').length >= 0;
    }, { timeout: 20000 });
    rendered = true;
  } catch (e) {}
  await page.waitForTimeout(2500); // let cards/tiles load
  const dom = await page.evaluate(() => ({
    cherryEls: document.querySelectorAll('[class*="cherry"]').length,
    cards: document.querySelectorAll('.card').length,
    selectors: document.querySelectorAll('.selector').length,
    activity: (Lampa.Activity.active() && Lampa.Activity.active().component) || '?',
    focused: !!document.querySelector('.focus, .selector.focus, .card.focus'),
  }));
  check('Cherry UI rendered', rendered && dom.cherryEls > 0, JSON.stringify(dom));
  await page.screenshot({ path: SHOTS + '/01-cherry-main.png' });

  // 4. D-pad navigation: focus ring visible + arrows move focus to a different tile.
  // Multiple activities stack (background Lampa main + Cherry on top), each with a `.focus`.
  // Read the TOPMOST one (the Cherry activity) — the last .focus in document order.
  const ftext = () => page.evaluate(() => { const fs = [...document.querySelectorAll('.focus')]; const f = fs[fs.length - 1]; return f ? (f.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30) : null; });
  const ringVisible = await page.evaluate(() => {
    const f = document.querySelector('.card.focus .card__view, .focus .card__view, .selector.focus');
    if (!f) return false; const s = getComputedStyle(f);
    return s.transform !== 'none' || (s.boxShadow && s.boxShadow !== 'none') || parseFloat(s.outlineWidth || '0') > 0;
  });
  check('focus ring visible', ringVisible);
  const fBefore = await ftext();
  await key('ArrowRight', 2); await key('ArrowDown');
  const fAfter = await ftext();
  check('D-pad moves focus', !!fAfter && fBefore !== fAfter, `from="${fBefore}" → to="${fAfter}"`);
  await page.screenshot({ path: SHOTS + '/02-after-dpad.png' });

  // 5. Enter a tile/source → grid should open
  await key('Enter');
  await page.waitForTimeout(3000);
  const afterEnter = await page.evaluate(() => ({
    activity: (Lampa.Activity.active() && Lampa.Activity.active().component) || '?',
    cards: document.querySelectorAll('.card').length,
  }));
  check('Enter opens grid/cards', afterEnter.cards > 0 || afterEnter.activity === 'cherry_grid', JSON.stringify(afterEnter));
  await page.screenshot({ path: SHOTS + '/03-grid.png' });

  check('no fatal page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (e) {
  check('harness ran', false, String(e).slice(0, 140));
  try { await page.screenshot({ path: SHOTS + '/ERROR.png' }); } catch (_) {}
}

await browser.close();
const passed = results.filter(r => r.pass).length;
console.log(`\nUI E2E: ${passed}/${results.length} passed · screenshots → tasks/ui-screenshots/`);
process.exit(passed === results.length ? 0 : 1);
