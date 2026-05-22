# Lessons Learned — Cherry Plugin

## cherry-verify · Code Review Batch · 2026-05-22

**Mode:** medium (architecture + security reviewers; no Codex)  
**Task:** Полная верификация работоспособности, архитектуры и тестирования плагина

---

### Batch: three parallel agents (architecture-guardian, code-reviewer, security-reviewer)

**Applied findings:**

| # | Severity | Reviewer | Finding | Fix |
|---|---|---|---|---|
| 1 | CRITICAL | arch+tech | `proxyM3u8` создаёт Blob URL, который никогда не освобождается → утечка памяти на TV-девайсах | Добавлен `_blobUrls[]` + `Lampa.Listener.follow('player', destroy)` → `revokeObjectURL` |
| 2 | HIGH | arch+tech | `PROXY_KEY` читается один раз при загрузке IIFE — изменение в Storage не применяется | Заменён на lazy `getProxyKey()` → `Lampa.Storage.get()` при каждом `buildProxyUrl()` |
| 3 | HIGH | security | `if (secret)` в Worker — пустой/отсутствующий ключ = открытый прокси | `if (!secret) return 500`; теперь ключ обязателен |
| 4 | HIGH | security | `!==` сравнение ключей уязвимо к timing attack | `timingSafeEqual()` через Web Crypto HMAC |
| 5 | HIGH | security | SSRF: нет дэниалиста hostname в Worker | `isPrivateHostname()` блокирует 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, ::1, localhost |
| 6 | HIGH | arch | `CherryGrid.stop()` пустой — scroll listener не убирается | `scroll.body().off('scroll')` в stop() |
| 7 | HIGH | tech | `Tizam.search()` возвращает `total_pages: 0` даже при найденных результатах | `items.length ? 1 : 0` — пагинация теперь работает |
| 8 | MEDIUM | arch+tech | `Porndig.getStream()` возвращает URL iframe, а не прямой медиа-поток | Fetch iframe страницы → `extractStreams()` |
| 9 | LOW | tech | `_pornoneCards` — неявный приоритет операторов `||` vs `&&` | Добавлены явные скобки |
| 10 | LOW | security | Worker отдавал `err.message` в 502-ответе — утечка деталей upstream | Заменено на `'Upstream error'` |
| 11 | LOW | security | `Access-Control-Allow-Methods` не включал POST | Добавлен `POST` в оба заголовка CORS |

**Парковка (не применено):**

- Глобальные `cherryFetch` вызовы без AbortController timeout — medium, требует рефакторинга всех 29 адаптеров; добавить в backlog отдельной задачей

**Паттерны для будущих задач:**

- Параллельный запуск arch + security reviewer экономит ~2/3 времени vs sequential, а находки почти не пересекаются (1 из 11 дубль — Blob URL leak)
- `PROXY_KEY` на уровне модуля — классический antipattern для конфигурации, которую пользователь может менять в рантайме; всегда читать из Storage лениво
- Worker без `isPrivateHostname()` + `timingSafeEqual()` — недопустимо даже для dev-прокси
- `total_pages: 0` в success-ветке (не catch) — молчаливо ломает бесконечный скролл; всегда проверять что success-ветка возвращает `>= 1`
