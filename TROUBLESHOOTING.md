# Cherry Plugin — Troubleshooting & Engineering Log

Фиксирует все нетривиальные проблемы, с которыми столкнулись при разработке, и их решения.

---

## 1. `this.component.render is not a function`

**Симптом:** При открытии любого экрана Lampa кидает TypeError в `ActivitySlide.create`.

**Причина:** Lampa вызывает `component.render()` чтобы получить DOM-элемент экрана. Метод не был реализован в `CherryGrid` и `CherryMain`.

**Решение:**
```javascript
this.render = function () { return html; };
```
Добавить в каждый компонент. `html` заполняется в `create()`, который Lampa вызывает перед `render()`.

---

## 2. `scroll.listener.follow` / `scroll.follow` — not a function

**Симптом:** TypeError при открытии CherryGrid.

**Причина:** `Lampa.Scroll` в этой версии не экспонирует ни `.listener`, ни `.follow()`. Обе формы — неверные предположения о Lampa API.

**Решение:** Использовать нативный jQuery scroll-event напрямую на `scroll.body()`:
```javascript
scroll.body().on('scroll', function () {
  var el = this;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) {
    if (!loading && currentPage < totalPages) { currentPage++; loadPage(currentPage); }
  }
});
```

---

## 3. `Lampa.Reguest` до `app:ready`

**Симптом:** Плагин не запускается при раннем старте (до события `app:ready`).

**Причина:** `new Lampa.Reguest()` на уровне модуля (вне `startPlugin()`) вызывался до инициализации Lampa-объектов.

**Решение:** Перенести инициализацию внутрь `startPlugin()`. В итоге `Lampa.Reguest` был удалён полностью — заменили на нативный `fetch`.

---

## 4. `cherryFetch` через `Lampa.Reguest.quiet()` возвращает пустые результаты

**Симптом:** Все источники показывают «Нет результатов».

**Причина:** `Lampa.Reguest.quiet()` авто-парсит JSON-ответы в объекты. После этого `JSON.parse(object)` → `JSON.parse("[object Object]")` → бросает исключение → `.catch` → пустой список.

**Решение:** Заменить `Lampa.Reguest` на нативный `fetch` — всегда возвращает raw text:
```javascript
function cherryFetch(url) {
  return fetch(buildProxyUrl(url)).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  });
}
```

---

## 5. Сломанные HTML-парсеры адаптеров

**Симптом:** Все адаптеры кроме Pornhub/Eporner (JSON API) возвращают пустые карточки.

**Причины:**
- **Точный сплит по классу:** `html.split('<div class="thumb-block"')` ломается при любом изменении — `class="thumb-block  "` (двойной пробел), `class="thumb-block thumb-block-big"` и т.д.
- **Абсолютный URL в href-паттерне:** `href="(https?://hqporner\.com/hdporn/[^"]+)"` — сайт отдаёт относительные ссылки `/hdporn/...`
- **Неверный URL пагинации KVS:** `?page=N` и `?p=N` не работают на KVS-движке — правильный паттерн: `/videos/newest/N/`
- **WordPress главная с `?paged=N`:** WordPress на главной странице игнорирует `?paged=N`, правильно: `/page/N/`

**Решения:**
- Заменить `split('строка')` на `split(/regex с [^"]*/)`
- Для href — добавить `(?:https?://host\.com)?` (хост опциональный)
- KVS: `page > 1 ? '/videos/newest/' + page + '/' : '/videos/newest/'`
- WP: `page > 1 ? '/page/' + page + '/' : '/'`

---

## 6. Pornhub video: `fragLoadError fatal [true]`

**Симптом:** Видео не воспроизводится, HLS.js выбрасывает `fragLoadError`.

**Причины:**
1. `video.url` из Pornhub webmaster API — **относительный URL** (`/view_video.php?viewkey=...`). Прокси не знает хост → неверный запрос.
2. Pornhub отдаёт HLS (m3u8). Браузер загружает HLS-сегменты напрямую с CDN `ev-h.phncdn.com` — CDN не выставляет CORS-заголовков → `fragLoadError`.
3. URL в flashvars содержит экранированные слеши (`\/`) — требуется `.replace(/\\\//g, '/')`.

**Решения:**
```javascript
// 1. Абсолютный URL
url: v.url.indexOf('http') === 0 ? v.url : 'https://www.pornhub.com' + v.url

// 2. Очистка URL
vUrl = (def.videoUrl || '').replace(/\\\//g, '/').replace(/\/\/\//g, '//')

// 3. m3u8 proxy-rewriting (обход CORS на HLS-сегментах)
function proxyM3u8(m3u8Url) {
  return cherryFetch(m3u8Url).then(function(content) {
    var baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
    var rewritten = content.split('\n').map(function(line) {
      var l = line.trim();
      if (!l || l[0] === '#') return line;
      var abs = l.indexOf('http') === 0 ? l : baseUrl + l;
      return buildProxyUrl(abs);  // каждый сегмент идёт через Cloudflare Worker
    }).join('\n');
    var blob = new Blob([rewritten], { type: 'application/vnd.apple.mpegurl' });
    return URL.createObjectURL(blob);
  });
}
```

**Приоритет:** MP4 > HLS. Если доступны прямые MP4-ссылки — использовать их (нет CORS-проблем). HLS прокси — фолбэк.

> ⚠️ Однуровневый `proxyM3u8` (выше) недостаточен — см. раздел 14 для рекурсивной реализации.

---

## 7. Карточки прижаты влево, один ряд

**Симптом:** Все видео-карточки в одну строку слева.

**Причина:** `scroll.body()` (куда добавляются карточки) не имеет grid/flex-wrap стилей. Карточки имели фиксированную ширину `19.5em`.

**Решение:** Добавить класс на `scroll.body()` и задать CSS-grid:
```javascript
scroll.body().addClass('cherry-cards-wrap');
```
```css
.cherry-cards-wrap {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(13em, 1fr));
  gap: .9em;
  width: 100%;
}
.cherry-card { width: 100%; }
```

---

## 8. GitHub Pages — вопросы деплоя

- **Pages API**: поле `source` нужно передавать как `-f 'source[branch]=main' -f 'source[path]=/'`, а не через JSON
- **`wrangler-account.json`** случайно попал в git — убирается через `git rm --cached .wrangler/wrangler-account.json`
- **workers.dev subdomain**: нужно зайти в Cloudflare Dashboard и активировать вручную перед первым деплоем

---

## 9. PROXY_KEY — хранение и первый запуск

**Ситуация:** Ключ был захардкожен в коде. Пользователь ожидал промпт при установке.

**Решение:** Читать из `Lampa.Storage`, при первом запуске — уведомление:
```javascript
var PROXY_KEY = Lampa.Storage.get('cherry_proxy_key', '1206');

// В startPlugin():
if (Lampa.Storage.get('cherry_proxy_key', null) === null) {
  Lampa.Storage.set('cherry_proxy_key', '1206');
  Lampa.Noty.show('Cherry: ключ прокси — 1206', { time: 7000 });
}
```

---

## 10. Lampa API — что работает и что нет

| Что пробовали | Результат |
|---|---|
| `scroll.listener.follow('end', fn)` | ❌ `listener` = undefined |
| `scroll.follow('end', fn)` | ❌ метод не существует |
| `scroll.body().on('scroll', fn)` | ✅ работает |
| `Lampa.Reguest.quiet(url, resolve, reject)` | ❌ авто-парсит JSON, нет reject на HTTP ошибках |
| `fetch(url).then(r => r.text())` | ✅ работает |
| `Lampa.Player.play({ url, title, poster, quality })` | ✅ quality-dict передаётся в плеер |
| `card.on('hover:enter', fn)` | ✅ нажатие OK на пульте |
| `card.on('hover:long', fn)` | ✅ долгое нажатие |
| `card.on('hover:focus', fn)` | ✅ фокус на карточке |
| `Lampa.Select.show({ title, items, onSelect, onBack })` | ✅ выпадающее меню |
| `Lampa.Activity.push({ component, ... })` | ✅ открыть новый экран |
| `Lampa.Activity.backward()` | ✅ назад |
| `Lampa.Controller.toggle('name')` | ✅ переключить контроллер |
| `Lampa.Storage.get(key, default)` | ✅ читает localStorage |
| `Lampa.Storage.set(key, value)` | ✅ пишет localStorage |
| `Lampa.Component.add('name', Ctor)` | ✅ регистрация компонента |
| `Lampa.Menu.addButton(icon, title, fn)` | ✅ кнопка в главном меню |

---

## 11. Публичные API адаптеров — итоги исследования

**Подтверждённые JSON API:**

| Сайт | Тип | Endpoint | Статус |
|---|---|---|---|
| Pornhub | Webmaster REST API | `https://www.pornhub.com/webmasters/search` | ✅ Реализован |
| Eporner | JSON API v2 | `https://www.eporner.com/api/v2/video/search/` | ✅ Реализован |
| PornOne | WordPress REST API | `https://pornone.com/wp-json/wp/v2/posts` | ✅ Реализован (+ HTML fallback) |

**SpankBang stream API (browse сломан, getStream работает):**
- Видео листинги — React SPA (статический HTML пустой)
- Отдельные страницы видео — SSR, `data-streamkey="..."` в HTML
- getStream: `POST https://spankbang.com/api/videos/stream` с `id={streamkey}&data=0`
- Browse/search обречены на пустой результат без браузера

**SPA-сайты (без headless browser не работают):**
- Xvideos (листинг), SpankBang (листинг) — React SPA возвращает `<div id="root"></div>`

**HTML scraping (нет публичного API):**
- Xnxx, HQPorner, YouJizz, PornDig, PornoBolt, CrocoTube, GayPornTube
- KVS CMS: Porntrex, Xozilla, 3Movs, Analdin, Huyamba
- SisiStyle CMS: FamilyPorn ✅ работает, VePorn (403), Ebun (parked)
- DLE CMS: 24Rolika/huyalkino.com, JopaOnline
- Российские кастомные: HellPorno, Ebalovo, LenPorno, Tizam

---

## 12. Pornhub fragLoadError — Referer CDN

**Симптом:** HLS-сегменты не грузятся (`fragLoadError fatal`).

**Причина:** CDN `ev-h.phncdn.com` требует `Referer: https://www.pornhub.com/`, но Worker без параметра `?referer=` отправлял `Referer: https://ev-h.phncdn.com/` (hostname таргета).

**Решение:**
1. Worker расширен: `GET /proxy?url=...&referer=https://www.pornhub.com/` — кастомный `Referer` перекрывает дефолт.
2. `proxyM3u8(m3u8Url, 'https://www.pornhub.com/')` — все сегменты через прокси с правильным Referer.
3. Приоритет MP4 > HLS: MP4 не имеет CORS-проблем на CDN, используется как первичный формат.

---

## 13. HellPorno — chs_object JS паттерн

---

## 14. Pornhub HLS: двухуровневый плейлист — hls.js теряет base URL сегментов

**Симптом:** Видео не воспроизводится (hls.js запрашивает сегменты по неверным URL).

**Причина:** Pornhub HLS использует двухуровневую иерархию:
```
master.m3u8  →  index-v1-a1.m3u8  →  seg-001.ts, seg-002.ts, ...
```
Первая версия `proxyM3u8` переписывала только `master.m3u8`, превращая ссылку на `index.m3u8` в прокси-URL. Когда hls.js загружал `index.m3u8` через прокси (получая сырой контент с относительными путями `.ts`), он пытался разрешать сегменты относительно прокси-URL — и получал URL вида `https://cherry-proxy.workers.dev/seg-001.ts` вместо реального CDN-пути.

**Решение:** Рекурсивный `proxyM3u8` — при обнаружении `.m3u8` в теле плейлиста сам вызывает себя:
```javascript
function proxyM3u8(m3u8Url, referer) {
  return cherryFetch(m3u8Url, referer).then(function (content) {
    var basePath = m3u8Url.split('?')[0];
    var baseUrl = basePath.substring(0, basePath.lastIndexOf('/') + 1);
    var promises = content.split('\n').map(function (line) {
      var l = line.trim();
      if (!l || l[0] === '#') return Promise.resolve(line);
      var abs = (l.indexOf('http') === 0) ? l : baseUrl + l;
      // Sub-playlist → рекурсивный blob
      if (/\.m3u8/.test(abs.split('?')[0])) {
        return proxyM3u8(abs, referer).catch(function() { return buildProxyUrl(abs, referer); });
      }
      return Promise.resolve(buildProxyUrl(abs, referer));
    });
    return Promise.all(promises).then(function (lines) {
      var blob = new Blob([lines.join('\n')], { type: 'application/vnd.apple.mpegurl' });
      var blobUrl = URL.createObjectURL(blob);
      _blobUrls.push(blobUrl);
      return blobUrl;
    });
  });
}
```
Каждый уровень плейлиста получает свой blob URL. hls.js всегда разрешает сегменты относительно blob URL, в котором все пути уже проксированы.

---

## 15. Stream URL привязан к IP прокси (токены v-acctoken, signed URL)

**Симптом:** Плагин находит видео, но при нажатии Play ничего не происходит (или мгновенная ошибка). Актуально для KVS-сайтов (FamilyPorn, Porntrex и др.).

**Причина:** При фетче страницы видео через прокси (IP Cloudflare Worker) сайт генерирует подписанный URL с токеном, привязанным к IP запроса. Когда плеер Lampa пытается воспроизвести этот URL напрямую с IP пользователя — токен невалиден → 403.

**Решение:** Все stream URL перед передачей в `Lampa.Player.play` проксировать, кроме blob-URL (которые уже содержат проксированные сегменты):
```javascript
function px(u) { return (!u || u.indexOf('blob:') === 0) ? u : buildProxyUrl(u); }
var proxiedQuality = {};
Object.keys(quality).forEach(function(k) { proxiedQuality[k] = px(quality[k]); });
Lampa.Player.play({ url: px(url), quality: proxiedQuality, ... });
```

yt-dlp extractor для HellPorno использует JS-переменную `chs_object`:
```javascript
var chs_object = {"urlPlayer":"https://...","vid":"12345", ...};
```

Если `urlPlayer` заканчивается на `.mp4` — прямой URL. Если это embed-страница — подгружаем её через прокси и извлекаем поток из неё. Реализовано как Pattern 0 в `getStream` HellPorno-адаптера.
