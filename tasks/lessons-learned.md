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

---

## cherry-e2e-verify · Plan Review Batch · 2026-05-26

**Mode:** full (arch-reviewer + tech-reviewer параллельно)  
**Task:** Спецификация + план переписывания `test/cherry-lampa-e2e.mjs` — E2E верификация 26 адаптеров

### Batch: два параллельных ревьювера (arch, tech)

**Applied findings:**

| # | Severity | Reviewer | Finding | Fix |
|---|---|---|---|---|
| 1 | CRITICAL | tech | Phase 2 закрывает страницы, Phase 3 пытается их переиспользовать — страницы уже закрыты | Убрана ранняя закрытость из Phase 2; унифицированный batch loop: browse→stream→rangeVideo→close в одной итерации |
| 2 | CRITICAL | tech | Phase 4 имела ту же проблему — тоже после закрытия страниц | Закрытие вынесено в конец Phase 4, после всех трёх фаз |
| 3 | HIGH | tech | `import { readFileSync }` в середине файла (Phase 5 snippet) — недопустимо в ES-модулях | Все imports вынесены в Phase 1 (top of file) |
| 4 | HIGH | arch | Exit code 2 из spec §5 vs "exit 1" из spec §4 — конфликт | Документировано: §5 приоритетнее; exit 2 = infrastructure failure, exit 1 = content failure |
| 5 | MEDIUM | tech | `intercepted206` Map не прикреплялась к каждому новому context в makeTestPage() | В описании Phase 2 явно указано: attach response listener к каждому новому context |
| 6 | MEDIUM | arch | Tier C absent rangeVideoResult трактовался как null (N/A) вместо false | Tier C пропущен → videoOk: false (ожидаемый fail), не null |
| 7 | MEDIUM | tech | Phase 4 нет fallback если streamUrls[0] — blob — тест падал без диагностики | Добавлен blob-fallback: итерировать streamUrls[1..] в поиске первого non-blob |

**Паттерны для будущих задач:**

- Multi-phase test с batch pages: **все фазы на одних страницах**, закрытие только после последней фазы — нарушение этого = CRITICAL architectural defect
- ES module imports обязаны быть в начале файла — все `readFileSync`/`path` импорты в Phase 1, не в Phase 5
- "Absent result = null" неправильно для known-limitation источников — если источник ожидаемо ломается (Tier C video), результат = false, а не null; null = N/A (не применимо, не сломан)
- Два ревьювера поймали **7 непересекающихся находок** (0 дублей) — параллельный run обязателен
