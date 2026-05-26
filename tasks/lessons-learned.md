# Lessons Learned — Cherry Plugin

## e2e-test-hardening · Phase 1 Code Review Batch · 2026-05-26

**Mode:** full (arch + tech + security reviewers in parallel)
**Phase:** Phase 1 — bestQualityUrl alignment + 3 new unit tests

### Findings applied (1)

- **Tech nit → added 4th test** (`picks numeric key over non-numeric label in mixed map`): Mixed NaN+numeric input `{ 'hd': 'url-hd', '720': 'url-720' }` — confirms the numeric winner correctly overrides the non-numeric label even when it is not `keys[0]`. Reviewer (technical): this closes a genuine gap where the fallback path fires for wrong reasons.

### Findings parked (5)

- **Arch HIGH — Three copies of bestQualityUrl with no drift guard**: plugin.js, plugin-helpers.test.js, cherry-lampa-e2e.mjs. Structural concern; fixing requires either a shared test utility module or a vm.runInNewContext extraction from the IIFE. Beyond Phase 1 scope — tracked in open-questions.
- **Arch MEDIUM — Key '0' edge case**: `parseInt('0')||0` = 0, never beats `best=0`, falls to `keys[0]` fallback. Degenerate input; no adapter emits quality key `'0'`. Parked.
- **Arch MEDIUM — Winner at keys[0]**: Reviewer asked for a test where the winning key is the first insertion. Already covered by existing test `{ '1080p': 'url-1080', '720p': 'url-720' }` where `keys[0]='1080p'` wins. Finding not confirmed.
- **Style NIT — var vs const/let**: e2e.mjs uses const/let, plugin-helpers.test.js uses var (matching plugin.js literally). Acceptable divergence; aligning would require touching plugin-helpers.test.js for cosmetic reasons only. Parked.
- **Tech NIT — undefined URL value**: quality values could be `undefined` if adapter has a bug. `undefined || quality[keys[0]]` still falls back correctly; `!!bestQualityUrl()` at call site masks it. A defense for an impossible case — parked.

### Pattern noted

All three reviewers independently flagged the **copy-proliferation / drift risk** for bestQualityUrl (arch HIGH, security NIT, tech missing_concern). High signal-to-noise: three-way convergence on the same concern. This pattern — "we fixed drift by hand, drift will happen again" — should trigger a Phase 2+ work item rather than an inline fix here.

---

## e2e-test-hardening · Spec Review Batch · 2026-05-26

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

---

## e2e-test-hardening · Spec Review Batch · 2026-05-26

**Mode:** full (arch-reviewer + tech-reviewer parallel)
**Task:** Spec for hardening cherry-lampa-e2e.mjs — 9 requirements across 3 files (E2E test, vitest unit tests, baseline JSON)

### Batch: два параллельных ревьювера (arch, tech)

**Applied findings:**

| # | Severity | Reviewer | Finding | Fix |
|---|---|---|---|---|
| F1 | CRITICAL | tech | `bestQualityUrl` в e2e-тесте использует `reduce()` с NaN-guard, а в `plugin.js` и `plugin-helpers.test.js` — `forEach` с `parseInt||0`; расходятся на all-NaN multi-key case | REQ-8-SYNC: явно указать выравнивание e2e-копии под `plugin.js` в реализации |
| F2 | HIGH | both | REQ-6 fallback `.browse('teen', 1)` — мёртвый код, все 26 адаптеров реализуют `.search()` | Убран fallback, вызов `.search('teen', 1)` напрямую |
| F3 | HIGH | tech | REQ-2 (4th transform `window.__cherry_playVideo`) — forward-looking, нет test coverage в этом iteration | Убран из scope, перенесён в Out of Scope |
| F4 | HIGH | tech | REQ-5 seek: timeupdate listener не убирается на seeked-timeout path — stale listener остаётся | Добавлен explicit cleanup в spec |
| F5 | MEDIUM | tech | `VIDEO_TIMEOUT_MS = 30000` — слишком тонкий margin (worst-case 25s + IPC overhead) | Raised to 35000 |
| F6 | MEDIUM | tech | REQ-9 Check 12 регрессии сломается: `prev >= 5` после v2 нормализации = `{cardsCount:N} >= 5` = false | Добавлена явная note о переходе на `.cardsCount` |
| F7 | MEDIUM | arch | REQ-6 не специфицировал, что вызов идёт через `page.evaluate` + `window.__CHERRY_SOURCES` | Добавлена explicit спецификация execution context |
| F8 | MEDIUM | arch | REQ-5 `VIDEO_TIMEOUT_MS` не передаётся как аргумент в `page.evaluate` — Node-константа недоступна в браузере | Добавлен explicit argument-passing pattern |
| F9 | MEDIUM | tech | printLine показывает 'meta' после перехода на `currentTime > 2` — семантически неверно | REQ-9 переименование 'meta' → 'play' |
| F10 | LOW | arch | Smoke assertion: `before.length !== after.length || before !== after` — length check redundant | Упрощено до `before !== after` |

**Парковка (не применено):**
- Arch reviewer предложил использовать `.browse()` вместо `.search()` — отклонено: код подтверждает что все 26 адаптеров имеют `.search()`, arch brief был неверно интерпретирован ревьювером
- Arch reviewer: field name mismatch `videoOk`/`videoDuration` — не подтверждено: outer result от `rangeAndVideoSource` уже использует эти имена (строки 358-366)

**Паттерны для будущих задач:**
- Node.js-константы (`VIDEO_TIMEOUT_MS`, таймауты) в `page.evaluate` — всегда передавать как аргументы, не захватывать из closure (браузерный контекст не видит Node scope)
- `reduce()` vs `forEach()` copies: если функция копируется в несколько файлов — unit тесты должны явно покрывать the canonical copy (`plugin.js`), и все copies должны быть выровнены до того как тесты написаны
- "Forward-looking" transforms без test coverage в текущей итерации → Out of Scope; не шипить untested infrastructure
- Dead fallback code (`typeof fn === 'function'` guard) — проверять grep-ом перед написанием; если 100% адаптеров имеют метод, guard = cognitive noise

---

## e2e-test-hardening · Plan Review Batch · 2026-05-26

**Mode:** full (arch-reviewer + tech-reviewer parallel)
**Task:** План реализации hardening cherry-lampa-e2e.mjs — 3 фазы, 5 новых функций

### Batch: два параллельных ревьювера (arch, tech)

**Applied findings:**

| # | Severity | Reviewer | Finding | Fix |
|---|---|---|---|---|
| P1 | CRITICAL | tech | Step 2.6 `seekSource` тело ссылается на `allStream.find()` (module-level, не заполнен на момент вызова), но Step 2.9 говорит изменить сигнатуру — внутреннее противоречие плана | Переписан Step 2.6: `seekSource(page, browseRecord, rangeVideoResult, streamRecord)` — `streamRecord` как параметр, `allStream.find()` убран |
| P2 | CRITICAL | arch | seekSource seeked-timeout path не убирает `timeupdate` listener — нарушение spec | Добавлен `v.removeEventListener('timeupdate', onTU)` перед cleanup |
| P3 | HIGH | tech | Step 2.4 `timeupdate` handler анонимная стрелка — не может убрать себя, срабатывает при каждом timetick после currentTime>2 | Named function `onTU` с самоудалением |
| P4 | HIGH | arch | seekSource не отслеживает cardIdx — всегда `cards[0]`, неверная карточка для fresh token | Resolved through P1: `for` loop с `cardIdx`, `cards[cardIdx] \|\| cards[0]` |
| P5 | HIGH | tech | printLine `seekRes === null` строгая проверка — не ловит `undefined` | `== null` + default params `seekRes = null, searchRes = null` |
| P6 | MEDIUM | both | readBaseline normalization слабый guard: non-number val без `.cardsCount` проходит насквозь | Расширен до `val && typeof val.cardsCount === 'number' ? val : { cardsCount: 0 }` |
| P7 | MEDIUM | tech | Check 9 evaluateVerdict fail message остаётся 'Video meta' после rename | Step 2.1 добавлен sub-step для line 416 |
| P8 | MEDIUM | arch | printSummary не показывает seek/search агрегаты — данные собраны но не отображаются в summary | Step 2.10 добавлен: signature + seek/search totals + call site update |
| P9 | MEDIUM | arch | Step 2.9 дублирует batch loop pseudo-code — противоречит канонической секции | Step 2.9 сокращён до 2-х предложений, ссылка на канон |

**Паттерны для будущих задач:**

- **Internal plan contradiction rule:** если функция написана в Step 2.6 и исправление сигнатуры написано в Step 2.9 — `critical`. Вся функция должна быть в одном шаге в финальном виде, не "и ещё поправьте вот это потом"
- **Anonymous vs named event handlers:** `addEventListener` с функцией, которую нужно убрать — всегда named (`function onXxx() {}`), никогда стрелка. Anonymous listener = guaranteed memory leak / multiple-fire bug
- **Module-scope accumulator timing:** `allStream`, `allBrowse` и др. заполняются в конце batch loop. Функции, которые нужны внутри batch loop (до collect step), НЕ ДОЛЖНЫ читать эти массивы — передавать текущие записи как параметры
- **Loose vs strict null in optional columns:** параметры со значением по умолчанию `null` должны использовать `== null` (не `=== null`) для гвардов — при не передаче значения получают `undefined`, не `null`
