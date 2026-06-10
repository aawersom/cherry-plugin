# Cherry — stream-matrix: первый прогон (Фаза 1), диагноз флагов

**Дата:** 2026-06-10 · harness: `test/stream-matrix.cjs` · прогон: `--platform=android` (24 канала)
Отчёт-таблица регенерируется в `tasks/stream-matrix-report.md` каждым прогоном.

## Зелёные (карточки + валидный URL плеера): 18
xvideos (m3u8 — HLS-fix), youjizz, pornone, porntrex, xozilla, 3movs, analdin, pornve, porndig,
perfektdamen, hellporno (proxied/CF), pornobolt, crocotube, ebun, lenporno, 24rolika, jopaonline,
spankbang (mp4 + Val.town).

## Флаги (6) и диагноз
| Канал | Флаг | Диагноз | Действие |
|---|---|---|---|
| **pornhub** | cards=0, EMPTY | **Артефакт egress-IP + CF-блок.** Webmasters API: via **VPS=30** ✓, via **CF=0**, direct(этот хост)=0. На устройстве (Android, домашний IP) каталог работает. НО pornhub теперь блокирует CF-датацентр → на браузере/при фолбэке на CF каталог пуст. | Латентно: рассмотреть роут pornhub-листинга на VPS (стрим остаётся CF-residential — на Android всё равно device-IP). Не критично для Android. |
| **eporner** | EMPTY (стрим) | getStream hash/xhr-цепочка пуста (сайт сменил схему) | RE getStream (бэклог) |
| **hqporner** | EMPTY (стрим) | embed-плеер редизайнут (нет mydaddy/bigcdn) | RE getStream (бэклог) |
| **familyporn** | cards=1 | категория `sisters` (categories[0]) разрежена/неверный слаг; др. категории дают 24 | Фаза 2: проверить/почистить категории |
| **xnxx, tizam** | affinity DIFF | page→VPS, stream-CDN на др. домене (xnxx-cdn / video5.tizam) не роутится. **На Android оба = device-IP raw (реально same).** Флаг значим в browser-режиме. | Информационно; в browser-режиме — кандидат на co-location регекс |
| **spankbang** | affinity DIFF | page→Val.town, stream `sb-cd.com` подписанный-токен (НЕ IP-bound) → DIFF безвреден | OK, ложно-положительный |

## Вывод по weekly-сорту (регресс-чек)
Мой pornhub weekly-дефолт **НЕ сломал** browse: webmasters с `&period=weekly` via VPS = 30 (как и
all-time). pornhub=0 в матрице — из-за CF-блока/IP хоста, не из-за сорта.

## Ограничение харнеса (известное)
- **Affinity-проверка использует `buildProxyUrl` (browser-тиры)** даже в android-режиме. На Android
  не-force-proxy хосты идут device-IP raw (page+stream = один device-IP) → DIFF там ложный. Для точной
  android-affinity нужно сверять с `_forceProxyAndroid`/px-логикой. → улучшение харнеса (TODO).
- Egress-IP = этот хост → IP-bound токены к device-IP не воспроизводятся (Фаза 4, device-чек-лист).

## Следующее
- Прогон `--reach` (достижимость стримов: Range/m3u8-цепочка + throughput) — в работе.
- `--platform=browser` прогон — affinity-проверка станет содержательной.
- Фаза 2: перебор всех категорий/сортов (мёртвые слаги: pornhub `ai-straight`, familyporn `sisters`).
