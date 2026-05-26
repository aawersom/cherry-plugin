# Cherry Plugin — Testing Methodology

## Текущая архитектура тестов

```
npx vitest run                      → 51 unit-тестов (mock-based, ~5s)
node test/cherry-lampa-e2e.mjs     → 26 источников в реальном lampa.mx (~10-15 min)
```

### Что делает E2E-тест сейчас

| Шаг | Что проверяется | Что это гарантирует |
|---|---|---|
| Smoke (при запуске) | 3 transform'а reinjectionScript ≠ исходник | Трансформация не сломалась незаметно |
| Proxy key | `Lampa.Storage.get('cherry_proxy_key')` непустой | Ключ прокси доступен внутри страницы |
| Browse → cards | `items.length >= N`, поля `id/source/title/url` | Адаптер возвращает карточки правильного формата |
| getStream × 5 | URL непустой, `urlPresentCount >= 4` | Функция не падает, возвращает ссылку стабильно |
| Range-206 | `fetch(bytes=0-65535)` → статус 206 + `Content-Range` | Прокси доставляет первые 64KB с правильными заголовками |
| Video play | `timeupdate` с `currentTime > 2` (35s таймаут) | Видео реально воспроизводится ≥2 секунды |
| Seek | Перемотка на 50% + ожидание `seeked` | CDN поддерживает range-запросы с произвольного offset |
| Search | `s.search('teen', 1)` → `count >= 1` | Поисковая функция работает независимо от browse |
| Baseline | Tier A card counts vs. прошлый запуск | Регрессия по количеству карточек |

---

## Реализованные улучшения (задача e2e-test-hardening)

### REQ-1 — Smoke-ассерты на reinjectionScript

При запуске E2E файл проверяет, что все 3 `.replace()` трансформации в `reinjectionScript` дали результат, отличный от исходника:

```javascript
const _t1 = _pluginSource.replace(/* IIFE guard swap */);
if (_t1 === _pluginSource) { console.error('[FATAL] transform 1 ...'); process.exit(2); }
const _t2 = _t1.replace(/* SOURCES exposure */);
if (_t2 === _t1) { console.error('[FATAL] transform 2 ...'); process.exit(2); }
const _t3 = _t2.replace(/* startPlugin stub */);
if (_t3 === _t2) { console.error('[FATAL] transform 3 ...'); process.exit(2); }
```

**Ловит:** незаметное изменение формата plugin.js (например, переименование функции или изменение паттерна IIFE guard), которое привело бы к тому, что `window.__CHERRY_SOURCES` не экспортируется, но тест молча продолжает работать.

---

### REQ-2 — Таймаут видео 35s

`VIDEO_TIMEOUT_MS = 35000`. Ранее было 15s — CDN-буферизация перед стартом реально требует 20–30s на медленных источниках.

---

### REQ-3 — `timeupdate + currentTime > 2` вместо `loadedmetadata`

**Проблема с `loadedmetadata`:** браузер получает первые ~64KB и распознаёт длительность. Не означает, что поток реально играет — CDN может обрезаться сразу после метаданных.

**Проблема с `preload='auto'` + `timeupdate`:** `preload='auto'` буферизирует данные, но не переводит элемент в "playing" state. `timeupdate` с прогрессом `currentTime` начинает приходить **только во время активного воспроизведения**. Без `v.play()` — таймаут.

**Текущая реализация:**

```javascript
v.addEventListener('timeupdate', onTU);
function onTU() {
  if (v.currentTime > 2) {
    v.removeEventListener('timeupdate', onTU);
    clearTimeout(t);
    resolve({ ok: true, dur: v.duration });
  }
}
v.play().catch(() => {});  // обязательно — иначе timeupdate не придёт с прогрессом
```

Именованные обработчики (`onTU`, `onSeeked`) — не анонимные стрелки — обязательны для `removeEventListener`.

---

### REQ-4 — Seek-тест (Tier A)

`seekSource()` запускается для Tier A источников с `videoDuration > 120s`. Алгоритм:

1. Ждёт `currentTime > 2` (как REQ-3)
2. Устанавливает `v.currentTime = v.duration * 0.5`
3. Ждёт событие `seeked` (10s таймаут)

Запускается последовательно (не `Promise.all`) во избежание насыщения CF прокси параллельными byte-range запросами.

---

### REQ-5 — Search-тест (non-D sources)

`searchSource()` вызывает `s.search('teen', 1)` через `page.evaluate`. Считает `success` если `items.length >= 1`. Инфраструктурные сбои (таймаут страницы, crash) возвращают `null` (N/A), не `false` — чтобы отличить "поиск вернул 0 результатов" от "браузер упал".

---

### REQ-6 — Проверка proxy key

После инъекции скрипта — проверка `Lampa.Storage.get('cherry_proxy_key', '')` внутри страницы. Пустой ключ → `[WARN]` в лог (не FAIL, ключ мог быть не выставлен в конкретной сессии хранилища).

---

### REQ-8 — Baseline v2

Формат `tasks/cherry-e2e-baseline.json` v2:

```json
{
  "version": 2,
  "updated": "2026-05-26",
  "sources": {
    "pornhub":  { "cardsCount": 30 },
    "xvideos":  { "cardsCount": 42 }
  }
}
```

`readBaseline()` нормализует v1 (`{ sources: { id: number } }`) в v2 shape автоматически — обратная совместимость. Check 12 (`evaluateVerdict`) читает `.cardsCount` через `Number.isFinite()` guard.

---

## Оставшиеся пробелы

### Пробел 1 — Lampa.Player path (LOW)

Текущий тест вызывает `s.browse()` и `s.getStream()` напрямую — минует `playVideo()`, которая применяет `bestQualityUrl()` и `px()`. Реальный путь: меню → карточка → кнопка Play → `playVideo()` → `Lampa.Player.play()`.

**Статус:** не реализован. Требует `headful`-верификации событий `Lampa.Listener` перед реализацией. Низкий приоритет — `bestQualityUrl` покрыта unit-тестами (51 тест), `px()` покрыта worker-тестами.

### Пробел 2 — URL-паттерн в baseline (LOW)

Baseline хранит только `cardsCount`. Смена CDN-домена проходит незамеченной до полного отказа.

**Фикс (при необходимости):** добавить `streamUrlPattern` и `streamCdnDomain` в baseline; при следующем запуске сравнивать домен + предупреждать (не FAIL — домен мог измениться легитимно).

### Пробел 3 — KVS-токены (структурный, не решается тестом)

KVS-источники (Tier B) выдают токены, привязанные к IP и TTL ~30-60s. CF Worker меняет edge IP → mismatch. В реальном Lampa это не проблема (воспроизведение сразу). В автотесте — видео `N/A` для этих источников. Принято как неизбежное.

---

## Известные нестабильности

| Источник | Симптом | Причина |
|---|---|---|
| `pornhub` | Browse → 0 карточек (случайно) | CF datacenter IP rate-limiting на стороне pornhub |
| `tizam` | `urlPresentCount < 4` при отдельных прогонах | Медленный CDN, stream иногда не успевает ответить × 5 |

Оба случая — pre-existing сетевые проблемы, не регрессии кода.

---

## Unit-тесты (vitest)

51 тест в 2 файлах:

| Файл | Тестируемые функции | Тестов |
|---|---|---|
| `test/plugin-helpers.test.js` | `parseDur`, `parseViews`, `bestQualityUrl`, `extractStreams`, `_kvsPickBest` | 29 |
| `test/worker-utils.test.js` | `isPrivateHostname`, `timingSafeEqual` | 22 |

```
npx vitest run
# Ожидаем: 51 passed
```

---

## Что тест никогда не заменит

- **Проверку на реальном TV-девайсе** — другой браузерный движок, DRM, кодеки
- **Проверку после смены IP** — если CDN блокирует Cloudflare IP, меняет токены
- **KVS-источники через прокси** — IP-locked токены = структурное ограничение
- **Новый аккаунт пользователя** — настройки Lampa.Storage могут отличаться

После любой правки адаптера — ручная проверка конкретного источника в браузере на той же машине остаётся обязательной.
