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

## Прогон с достижимостью (`--reach`) — выполнено
**Стримы играют (206 + throughput):** xvideos и xnxx — **m3u8-цепочка master✓ variant✓ seg=206✓**
(HLS-фикс работает, полное качество); spankbang 2.07, youjizz 0.26 (throttle, но ≤720 кап = играет),
pornone 0.80, porntrex 0.74, xozilla 1.09, 3movs 1.02, analdin 1.09, pornve 1.39, porndig 3.03,
tizam 1.78, hellporno 0.25, pornobolt 0.47, crocotube 0.96, ebun 2.12, lenporno 1.55, jopaonline 1.71,
24rolika 1.44 МБ/с. → **20 каналов воспроизводятся.**

**Reach-флаги и диагноз:**
| Канал | reach | Диагноз |
|---|---|---|
| **24rolika** | 403 → **206 с Referer** | Артефакт harness (нативный плеер шлёт Referer; добавил Referer в `fetchRange` → 206 ✓). Канал рабочий. |
| **familyporn** | 403, host `images.nubiles-porn.com` | Категория `sisters` отдаёт 1 битую карточку, «стрим» = картинка. Категория-баг (Фаза 2). |
| **perfektdamen** | 200 **1KB** (и с Referer) | Вместо видео — 1KB. Вероятно KVS IP-bound токен отвергнут с датацентр-IP этого хоста; на device residential-IP должен играть → device-чек-лист (Фаза 4). |
| pornhub/eporner/hqporner | no-url | стрим не извлечён (pornhub=CF-блок/IP; eporner/hqporner=RE getStream) |

**Улучшение harness:** `fetchRange` теперь шлёт `Referer` (страница) — убрало ложный 403 (24rolika).

## Следующее
- `--platform=browser` прогон — affinity-проверка станет содержательной (xnxx/tizam co-location).
- Фаза 2: перебор всех категорий/сортов (мёртвые слаги: pornhub `ai-straight`, familyporn `sisters`).
- Фаза 4 (device): perfektdamen 1KB, pornhub-буфер — подтвердить на residential-IP.
