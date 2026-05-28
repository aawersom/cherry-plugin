# Lessons Learned — Cherry Plugin

## e2e-test-hardening · E2E Run + v.play() Gap · 2026-05-26

**Mode:** full — E2E run debugging
**Finding:** Spec gap — `preload='auto'` alone does not cause `timeupdate` to fire.

### Gap found during E2E run

REQ-3 spec said: "Set `v.preload = 'auto'` so the browser fetches data, not just headers." This implies `timeupdate` would fire once data is fetched. **It does not.** The HTML spec defines `timeupdate` to fire as the *current playback position* changes — which only happens when the video is *playing*. `preload='auto'` fetches data into the buffer, but `currentTime` stays at 0 until `play()` is called.

Fix applied: added `v.play().catch(() => {})` after event listeners are attached in both `rangeAndVideoSource` and `seekSource`'s `page.evaluate` blocks. The `.catch(() => {})` suppresses the "play() was interrupted" DOMException that fires when the element is cleaned up before playback starts.

### Pattern noted

The transition from `loadedmetadata` → `timeupdate + currentTime > 2` requires understanding two things: (1) `preload='auto'` loads bytes but does not play, (2) `--autoplay-policy=no-user-gesture-required` + `muted=true` permits play() to succeed. Both conditions must hold AND `play()` must be called. The spec and plan reviewers missed this gap because they reasoned about `preload` behavior but not about whether `currentTime` would advance without an active play() call.

**Rule for future:** whenever switching from a "fetch-event" (`loadedmetadata`, `canplay`) to a "playback-event" (`timeupdate`, `playing`), verify `play()` is called or `autoplay` attribute is set. These event families are in different parts of the media element lifecycle.

---

## e2e-test-hardening · Phase 2+3 Code Review Batch · 2026-05-26

**Mode:** full (arch + tech + security reviewers in parallel)
**Phase:** Phase 2 — E2E hardening (smoke, timeupdate, seek, search, labels) + Phase 3 — baseline v2

### Findings applied (5)

- **Arch+Tech MEDIUM → onSeeked removeEventListener**: `seekSource` success path was missing `v.removeEventListener('seeked', onSeeked)` — only the timeout path removed it. Added as first statement inside `onSeeked`. Named-handler invariant now symmetric across all exit paths.
- **Tech LOW → searchSource outer catch returns null**: Changed from `{ searchOk: false }` to `{ searchOk: null }` when `page.evaluate()` throws (infrastructure failure vs actual search failure). Consistent with `seekSource` and `rangeAndVideoSource` pattern.
- **Tech NIT → stale JSDoc**: File header still said `loadedmetadata checks` after REQ-3 switch. Updated to `video playback checks (timeupdate > 2s)`.
- **Arch LOW → seek loop comment**: Comment said "avoid parallel video load" (wrong — pages are isolated contexts). Changed to "avoid CF proxy saturation" (the actual reason for sequential execution).
- **Arch LOW → readBaseline cardsCount validation**: Check 12 now uses `Number.isFinite(...)` guard instead of bare `?.cardsCount`. Prevents `Infinity` or `NaN` injection from a malformed baseline.json from silently enabling the regression check.

### Findings parked (5)

- **Security MEDIUM — eval() of full plugin.js**: Pre-existing pattern (unchanged in this PR). Architectural decision for IIFE injection. The smoke assertions at module load partially mitigate by detecting transform failures early. Logged in backlog.
- **Security LOW — PROXY_KEY plaintext in git**: Pre-existing. Key rotation + `process.env` fallback is the fix. Backlog.
- **Arch MEDIUM — anonymous error handler**: `rangeAndVideoSource` error listener is an anonymous arrow (can't be `removeEventListener`'d). Element is destroyed immediately after, so no practical leak. Stated invariant is slightly over-specified for this case. Park.
- **Arch LOW — bootstrap page / batch isolation**: Bootstrap page opens, extracts `sources.length`, then closes before batch. Each batch opens fresh pages. Reviewers flagged it; it is intentional and correct per single-page lifecycle invariant. Not a finding.
- **Arch NIT — `{0,100}` regex span in transform 1**: Transform smoke assertion catches any regex miss immediately as `process.exit(2)`. No silent failure possible. Park.

### Patterns noted

- **Named-handler asymmetry**: Both arch and tech reviewers independently flagged `onSeeked` missing removal on the success path. The pattern "remove listener as first statement in its own handler" (vs "remove from the other path's handler") is more robust — always teardown your own handler before side effects.
- **null vs false semantics**: In all test phases, `null` means "not attempted / infrastructure N/A" and `false` means "attempted and failed." The original outer catch was collapsing these two semantics into `false`. Both reviewers caught this — it suggests the distinction should be documented as a code convention.

---

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

---

### multi-source-video-fix — Spec review batch (2026-05-28)

**Task:** Fix video playback for 8 broken sources, quality selection for 3, remove gayporntube, harden E2E.
**Mode:** full
**Stage:** Spec (2 reviewers, parallel)

**Key findings applied:**
- `px()` double-proxy bug: adapters pre-proxying CDN URLs via `buildProxyUrl()` produce URLs starting with `PROXY_URL_2`, but `px()` only skipped `PROXY_URL` (CF Worker prefix). Would have created double-proxied URLs. Fix: added a guard clause for `PROXY_URL_2` in `px()` — caught by both
- REQ-8 fetch context mismatch: spec prose said "Playwright's `request.fetch()` running in page context" but code used bare Node `fetch()`. Different CORS/cookie behavior. Fix: aligned prose to Node fetch, updated to fetch the proxy-wrapped URL (what Lampa actually plays), not the raw CDN URL — caught by both
- `jwArrRe` regex brittleness: single-regex using `[^{}]` fails on nested braces (drm config, `httpSourceOptions`); also had false positive risk outside JWPlayer context. Fix: replaced with two-step approach — bracket-depth scan to delimit sources array, then two independent simple regexes per object — caught by tech only
- eporner `src2` backtracking: proximity pattern `[\s\S]{0,2000}?` on 500KB HTML causes catastrophic backtracking and false pairings; CDN URL template also unknown at spec time. Fix: removed `src2` entirely, deferred to Open Question Q2 — caught by tech only
- lenporno "720p" fallback collision: two unlabeled URLs both falling back to `"720p"` key silently overwrite each other. Fix: unlabeled URLs captured as `url` candidate only, never inserted into quality map — caught by both

**Pattern notes for future tasks:**
- **Double-proxy blind spot in px()-style helpers:** whenever a new proxy prefix (e.g. `PROXY_URL_2`) is introduced, audit every URL-skipping helper that only guards against the original prefix. A guard list, not a single string comparison, is the correct pattern.
- **"Uses Playwright fetch" vs "uses Node fetch" is a meaningful distinction** — CORS origin, cookies, and TLS fingerprint differ. Spec must be explicit about fetch context; a prose error here is a CRITICAL behavioral mismatch.
- **`[^{}]` in regex is unsafe for nested-brace structures** (JWPlayer sources, JSON-like configs). Prefer bracket-depth scanners for structure delimiting, then flat regexes on the extracted flat segment.
- **Proximity patterns on large HTML (`[\s\S]{0,N}?`) are catastrophic on 500KB+ pages** — profile page size before using them; if page > ~100KB, use a two-pass approach (locate section anchor, then extract).
- **Two unlabeled quality URLs → silent map key collision** — whenever building a quality map with a fallback key, assert that the fallback is used at most once, or switch to an array accumulator and pick max at the end.

---

### multi-source-video-fix — Plan review batch (2026-05-28)

**Task:** Fix video playback for 8 broken sources, quality selection for 3, remove gayporntube, harden E2E.
**Mode:** full
**Stage:** Plan (2 reviewers, parallel)

**Key findings applied:**
- Bracket-depth escape check broken: `html[i-1] !== '\\'` fails for double-escaped `\\"` in JWPlayer sources-array scanner — count consecutive backslashes via parity instead — caught by tech only
- px() guard test in wrong phase: guard implemented in Phase 0 but test deferred to Phase 5, violating "each phase independently shippable" — moved test to Phase 0 — caught by both
- Pornhub fallback regex removal unauthorized: plan deleted existing fallback regex after adding simplified primary, but spec never authorized deletion — both regexes coexist pending fixture confirmation — caught by both
- Ebun outer fallback implicit preservation: plan didn't explicitly protect `return extractStreams(html)` on line 3341; an implementer could accidentally delete it — explicit preservation note added — caught by tech only
- Generic iframe regex fires on analytics/ads: perfektdamen pattern `/src="...(player|embed).../` matches googletagmanager/doubleclick iframes before the video — marked as PLACEHOLDER, gated behind Phase 2 fixture with anti-ad assertion — caught by tech only

**Pattern notes for future tasks:**
- **Escape-char parity in hand-rolled scanners:** `prev_char !== '\\'` is not a reliable escape check — the preceding char may itself be escaped. Correct pattern: count consecutive trailing backslashes, treat quote as escaped only if count is odd.
- **Test-phase discipline for guards added in earlier phases:** if a utility function (like `px()`) is added in Phase N, its unit test must ship in Phase N — not deferred to a later phase. Deferred tests violate the "independently shippable phase" invariant and are reliably missed in implementation.
- **Plan must not delete existing fallback without explicit spec authorization:** "simplify" is not the same as "remove". When a plan proposes deletion of existing production code that the spec doesn't mention, treat it as unauthorized — flag and park until fixture confirms the old code is truly dead.
- **Implicit preservation is not protection:** if a line of code (fallback, guard, return) is not mentioned in the plan, an implementer following the plan literally may delete it. Critical fall-through paths must be explicitly called out with "preserve as-is" notes.
- **Broad structural regexes need anti-false-positive fixtures:** a pattern like `(player|embed)` in an iframe src attribute can match ad/analytics frames. Any "generic" extraction regex must ship with a fixture that asserts it does NOT fire on known non-video iframes (googletagmanager, doubleclick, etc.).

---

### multi-source-video-fix — Phase 0 Code Review Batch (2026-05-28)

**Task:** Fix video playback for 8 broken sources, quality selection for 3, remove gayporntube, harden E2E.
**Mode:** full
**Stage:** Phase 0 — Foundations (3 reviewers: arch, tech, security; parallel)

**Key findings applied:**

| # | Severity | Reviewer | Finding | Fix |
|---|---|---|---|---|
| 1 | HIGH | tech+arch | pxTest in Group C had guard already present — test never catches regression in production px() | Rewrote Group C with two synthetic variants: `pxTestOld` (no guard, shows double-wrap) + `pxTestNew` (with guard, shows correct behavior); added note that production px() is a private closure |
| 2 | Medium | arch+tech | Stale RED-state comments in Group A+C describe blocks contradicted the GREEN implementation | Removed "RED tests — require REQ-2 impl" and "guard intentionally absent" comments |
| 3 | Medium | tech | jwRe sets `url` to first sources-array file even when quality map is populated — undocumented interaction | Added test case documenting that `url` comes from jwRe (first file), quality comes from sources-array branch; callers must use `bestQualityUrl()` |
| 4 | Low | arch | docs/CHERRY.md retained four stale '26' references and gayporntube rows | Updated to '25', removed gayporntube from adapter list and status table |
| 5 | Low | arch | E2E header comment still said '26 source adapters' | Changed to '25' |
| 6 | Low | tech | Group B test comment said "index 8" for `{drm:{}}` test but expected index 7 | Fixed comment |
| 7 | Nit | arch+tech+sec | findMatchingBracket: mixed bracket depth-tracking design (treats `{` and `[` symmetrically) not documented | Added comment: "Track depth for both bracket types — handles mixed [{...}, {...}] nesting" |
| 8 | Nit | tech | findMatchingBracket: `c === openCh` redundant in OR when openCh is always `[` or `{` | Simplified to `if (c === '{' \|\| c === '[')` |

**Findings parked:**

- **Security Medium — fileRe2 SSRF via compromised proxy response**: `[^'"]+` captures any URL content including `javascript:` or path-traversal sequences. Pre-existing across all extractStreams regex branches. Fix requires px() scheme validation (broader scope, touches frozen helper). Bugs backlog.
- **Security Medium — PROXY_KEY '1206' in E2E test**: Pre-existing, already public in plugin.js line 16 as default fallback. Low marginal risk. Bugs backlog.
- **Security Low — PROXY_URL guard prefix-spoofing**: Adding `/` suffix to PROXY_URL guard would create inconsistency with pre-existing PROXY_URL guard (frozen code). Fixing both requires touching frozen playVideo — out of scope.
- **Tech Nit — No m3u8 test in sources-array group**: Deferred to Phase 3 where .m3u8 handling is being fixed.

**Pattern notes for future tasks:**

- **Synthetic test copies can't catch regressions in their source**: a test that inlines a function and then verifies the copy's behavior does not protect the production function. Document this explicitly in the test comment. The real regression protection is the E2E test against the live plugin. For private closures (like `px()` inside `playVideo()`), the best unit-test strategy is: TWO copies — one without the fix (shows the bug), one with (shows the fix) — plus an E2E assertion.
- **Code-test-writer comment hygiene**: test-writer writes tests in RED state with comments like "guard intentionally absent". Code-writer applies the fix and turns tests GREEN — but must REMOVE the RED-state comments. If not cleaned up, the next reader will be confused about whether the tests are expected to pass.
- **jwRe + sources-array interaction**: after sources-array populates `quality`, the jwRe loop below still fires and sets `url` to the first sources-array file value. This is spec-acceptable but must be documented in a test. Callers expecting `url` to come from `bestQualityUrl(quality)` will be surprised.
- **Three-way convergence on findMatchingBracket mixed-bracket design**: all three reviewers independently flagged the same structural concern. High signal. When a design choice is non-obvious enough to confuse three reviewers, it needs a comment — not a fix.
- **Arch docs need updating on same commit as code**: docs/CHERRY.md adapter count and status table went stale on the same commit that deleted gayporntube. The arch reviewer caught it; the code-writer missed it. Checklist item: whenever an adapter is added/removed, update docs/CHERRY.md in the same commit.

---

### multi-source-video-fix — Phase 1 Code Review Batch (2026-05-28)

**Task:** Fix video playback for 8 broken sources, quality selection for 3, remove gayporntube, harden E2E.
**Mode:** full
**Stage:** Phase 1 — Quality map fixes for porndig, ebun, lenporno (3 adapters; 1 reviewer: tech; verdict: approve with one nit)

**Key findings applied:**

| # | Severity | Reviewer | Finding | Fix |
|---|---|---|---|---|
| 1 | Nit | tech | lenporno fixture file (`test/fixtures/lenporno-player.html`) was never read by any Phase 1 test — orphaned fixture | Added 5th lenporno test: reads fixture via `readFileSync`, runs `fileM` regex (same as real adapter), validates `lenpornoParseFixed` output: `quality['720p']` correct, no `mp4` key |

**Findings parked:** none.

**Pattern notes for future tasks:**

- **Fixture files must be exercised by at least one test that reads them from disk**: adding a fixture as "documentation" without a test that reads it creates orphaned assets. The code-test-writer should default to reading every fixture file in at least one test path — not just using hardcoded string equivalents.
- **Approve verdict + single nit = one apply pass before commit**: the nit was a genuine test coverage gap, not cosmetic. Even low-severity fixture gaps hide real behavior — a fixture that simulates the real adapter regex chain is more valuable than an inline string copy.
