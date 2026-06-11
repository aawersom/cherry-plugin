# Cherry — большое тестирование плагина на реальном стенде (Google TV)

**Дата:** 2026-06-11 · режим: medium / максимальное покрытие · стенд: AOSP Android TV 14 эмулятор,
Lampa(debuggable) + Cherry, управление кодом через CDP (`test/tv-cdp.mjs`) + `logcat`.
Достоверность: нативный WebView/ExoPlayer/HTTP + домашний IP (`_isAndroid()=true`).

## Сопоставление требований ↔ документация ↔ сценарии

| # | Требование (источник) | Док-якорь | Сценарий теста на стенде |
|---|---|---|---|
| R1 | **Названия видео на карточках** (владелец: «названий видео на карточках») | CHERRY.md «Card title» (`.card__title`, 2-line clamp) | по каждому каналу: открыть категорию → прочитать `.card__title` всех карточек → ни одного пустого/«добавить в избранное» |
| R2 | **Бесконечный скролл / пагинация** (владелец; CHERRY.md «Pagination — infinite scroll») | `nextPageReuest`, `_derivePages` (page+1 пока ≥half-full) | browse page1 → page2 → page3: карточек прибавляется, `total_pages` растёт; конец списка не зацикливается |
| R3 | **Дедуп между страницами** (нет дублей) | `_dedupNew`/`_seenIds` в CherryGrid | собрать id page1∪page2∪page3 → уникальность; нет повторов на стыке страниц |
| R4 | **Воспроизведение** (играет, без чузера/буфер-виса) | getStream → `Lampa.Player.play`; px Android raw/proxied | per-channel: получить URL плеера → `logcat` ExoPlayer/net → 200/206 поток, без вечной буферизации |
| R5 | **Сорты** (дефолт осмысленный; pornhub=за неделю) | CHERRY.md Sorts; pornhub `mostviewed:weekly` дефолт | первый экран ≠ между разными сортами; pornhub дефолт = weekly |
| R6 | **Категории** (нет мёртвых) | cfg.categories | каждая категория → cards>0 (Val.town-каналы изолированно) |
| R7 | **Поиск** (результаты, не виснет) | all_sources search, progressive | ввод запроса → cards>0, без зависания (таймаут) |
| R8 | **Похожие** (2 пункта: Похожие / Похожие названия) | CHERRY.md «Related» | из меню карточки → грид похожих, скроллится |
| R9 | **История/«РП»** (запись + resume + прогресс-бар) | Hist, is_history, cherry-progress | сыграть → запись в cherry_history → тайл «РП» последним → resume позиция |
| R10 | **Избранное/«Случайные»** (add/remove, sync) | Fav store, cherry_favs | добавить/убрать → персист; тайл «Случайные» |
| R11 | **Навигация/фокус** (D-pad, фокус-рамка, нет ловушек, Back) | InteractionCategory nav | по гриду стрелками: фокус движется, Enter открывает, Back возвращает |
| R12 | **Home-плитки** (порядок/названия) | CHERRY.md CherryMain | Поиск, Случайные, Синхронизация, каналы, РП (последним) |
| R13 | **Качество** (xvideos/xnxx HLS 1080p; youjizz ≤720) | CHERRY.md Android quality | default URL = HLS (xvideos/xnxx) / ≤720 mp4 (youjizz) |
| R14 | **Модели/студии** (где есть) | getModels/browseByModel | индекс парсится, browseBy* → cards |
| R15 | **force-proxy на Android** (hqporner/hellporno/lenporno/eporner/spankbang/porntrex) | `_ANDROID_FORCE_PROXY` | эти каналы: страница+стрим проксированы → cards+playback |

## Метод прогона
1. **Инжект плагина с экспортом `__CHERRY`** (SOURCES/cherryFetch) в реальную Lampa через CDP →
   вызываю `browse()/getStream()` каждого адаптера на устройстве (нативный fetch + домашний IP).
2. Per-channel: R1 (titles), R2/R3 (3 страницы + дедуп), R5/R6 (сорт/категории), R13 (качество URL),
   R4 (достижимость default-URL + `logcat`).
3. UI-слой (R8/R9/R11/R12) — через DOM-чтение активностей (push + querySelector).
4. R4 для pornhub — отдельно с `logcat` (главная цель: причина буфера).

## Выход
- `tasks/full-plugin-test-report.md` — матрица 24 канала × R1-R15: pass/fail + причина (реальные логи).
- `tasks/full-plugin-fixes.plan.md` — приоритизированный план фиксов.
- Внедрение фиксов → повторный прогон на стенде = верификация.
