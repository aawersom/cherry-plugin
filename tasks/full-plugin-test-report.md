# Cherry — отчёт большого тестирования на реальном Google TV-стенде (2026-06-11)

Стенд: AOSP Android TV 14 эмулятор + Lampa(debuggable) + Cherry, прогон `browse()/getStream()`
каждого адаптера **на устройстве** (нативный fetch + домашний IP, `_isAndroid()=true`) через CDP
(`test/tv-test.mjs`). Проверены R1 (названия), R2/R3 (пагинация+дедуп), R4/R13 (стрим/качество).

## Матрица 24 канала (реальные условия)
**Чисто (R1✓ R2/R3✓ стрим✓): 17** — pornhub, xvideos(HLS), xnxx(HLS), eporner, youjizz(mp4),
pornone, **porntrex**, xozilla, 3movs, analdin, porndig, perfektdamen, hellporno, pornobolt,
lenporno, 24rolika, jopaonline. (porntrex — баг названий подтверждённо ПОЧИНЕН на устройстве.)

## Найденные баги и статус
| Канал | Баг (требование) | Корень | Статус |
|---|---|---|---|
| **ebun** | 0 карточек (R1) | домен карточек сменился `www1.ebun.tv` → **`x.ebun.top`**, hrefRx ждал старый | ✅ **ПОЧИНЕН** (domain-agnostic hrefRx) — стенд: 30 карточек |
| **tizam** | 7/32 пустых названия (R1) | у части карточек нет `<span class=title>`/`<h3>` в чанке | ✅ **ПОЧИНЕН** (фоллбэк `_titleFromUrl` из слага) — стенд: 0 пустых |
| **hqporner** | getStream EMPTY (R4) | плеер сайта редизайнут (нет mydaddy/bigcdn embed) | ⏳ RE новой схемы (бэклог BL-HQPORNER-STREAM) |
| **familyporn** | категория `sisters` = 1 карточка (R6) | разрежённый/битый слаг (стрим = картинка nubiles) | ⏳ чистка категории |
| **crocotube** | 19/79 дублей page1↔page2 (R3) | пагинация перекрывается; грид `_dedupNew` фильтрует → юзер видит новые, но меньше за скролл | ⚠ информационно (грид дедупит) |
| **spankbang/pornve/tizam** | 8/4/8 дублей page-overlap (R3) | то же — грид дедупит | ⚠ информационно |

## R-чек по требованиям
- **R1 названия** — 22/24 ✓ после фиксов (ebun+tizam); hqporner/familyporn — отдельные баги стрима/категории.
- **R2 бесконечный скролл** — ✓ у всех (page2 приносит карточки, total_pages растёт).
- **R3 дедуп** — грид-уровень `_dedupNew` работает; browse() у нескольких сайтов даёт частичный overlap (косметика).
- **R4 стрим** — ✓ у 22/24 (hqporner RE; pornhub каталог✓, буфер — playback-time, нужен logcat при игре).
- **R13 качество** — xvideos/xnxx = m3u8(HLS 1080p)✓, youjizz = mp4✓.
- **R5 сорт / R6 категории / R7-R12 UI** — частично покрыто (UI через DOM); pornhub weekly-дефолт в проде.

## Осталось (план фиксов — приоритет)
1. ✅ ebun, ✅ tizam — внедрено + верифицировано на стенде.
2. **familyporn `sisters`** — убрать/заменить разрежённую категорию (быстро).
3. **pornhub буфер** — запустить плеер на стенде + `logcat` ExoPlayer → причина (главная цель стенда).
4. **hqporner стрим** — RE нового плеера (крупно, бэклог).
5. crocotube/spankbang/pornve page-overlap — низкий приоритет (грид дедупит); при желании — выверить page-URL.
