# Каналы: мёртвые/убранные, как их оживить, что добавить (аудит 2026-09-04)

> **Статус (v0.13.20, тот же день):** §3.1 ebun и §3.2 huyamba сделаны и проверены на стенде (внутренний плеер ebun: currentTime 4.2 с вместо «Format error»; huyamba: 20 карточек, 100 % постеров/клипов/длительностей, категория/поиск фильтруют, стр. 2 новая, стрим MP4 с IP устройства, внутренний плеер 14.8 с за 20 с); 24rolika скрыт с плиток (`disabled: true`, `_activeSources`). **v0.13.21:** xhamster добавлен (стенд: 50 карточек за 1.3 с, 100 % постеров/клипов/длительностей, категория фильтрует (2 % пересечения), поиск 46, похожие 11, модели 60, HLS играет во внутреннем плеере с IP устройства — currentTime 4.6 с). **v0.13.22:** ebalovo добавлен (стенд: 24 карточки/1.5 с, 100 % постеров/длительностей, поиск 36 со 100 % совпадением, похожие 12, модели 30; стрим MP4 — токены оказались привязаны к UA (мобильное зеркало отдаёт 404), поэтому на Android страница и стрим идут через прокси (`androidProxyStream`), внутренний плеер currentTime 12.1 с). **v0.13.23:** porno666, lenkino, pornobriz добавлены (стенд: 24/37/42 карточки, постеры 100/97/100 %, категории и поиск фильтруют, похожие 12/13/9, модели 20/36/56, стрим MP4 с устройства; внутренний плеер porno666 13 с и lenkino 12.8 с через прокси; pornobriz — WebView отвергает прямой ответ CDN («Format error» даже на финальном URL), через прокси играет (17 с) → `androidProxyStream`). **porno365 НЕ добавлен:** все файлы `*.cdnde.com` отдают 404 с любого IP/UA/Referer (в т.ч. с Referer сайта, свежий токен) — стримы сайта мертвы снаружи РФ или требуют JS-челлендж. Партия каналов закрыта; остался spankbang (решение владельца).

Прод: v0.13.19. Все выводы проверены живыми запросами с трёх точек (машина EE-датацентр,
VPS `185.36.141.21`, CF-воркер) **и со стенда** (эмулятор `cherryRoot`, нативный Android-стек
Lampa, `test/tv-probe-candidates.page.js`, `tv-play-inner.page.js`, `tv-play-ebun.page.js`).
Конкуренты: живой JS AdultJS (33 источника, хосты извлечены), Lampac (14 нативных модулей +
60 YAML-рецептов NextHUB, `immisterio/Lampac`), xsena/sisi (тот же Lampac). OmniRoute (GPT-5.5)
недоступен («no available server»).

## 1. Что было убрано раньше и что не работает сейчас

| Канал | Когда/почему убран | Сейчас | Вердикт |
|---|---|---|---|
| **huyamba** | 2026-06-03, `fuq.huyamba.mobi` 404 (адаптер закомментирован) | `huyamba.mobi` отдаёт сырой PHP-исходник (сломан), но живое зеркало **`play.huyamba.mobi`** (его же использует Lampac, рецепт обновлён 2026-08-08). Чистый KVS, 33 RU-категории, hover-клип `data-preview` (webm), модели `/models/`, поиск. Стрим: flashvars `video_url/alt/alt2` = 480/720/1080, токен `v-acctoken` **не привязан к IP** (через VPS 206 ✓). С Android-UA сайт редиректит на мёртвое `rt.huyamba.xyz` → нативный фетч страницы падает (status 0), через прокси 20 карточек ✓ | **Оживить** (см. §3.2) |
| **24rolika** | не убран; лежит с июня (530) | `w2.huyalkino.com` — 200 и **0 байт** на всех путях (EE/VPS/CF/устройство); «текущий адрес» по whois `love.24rolika.ru` — DNS не резолвится (CF error 1016), таймаут отовсюду. Рецепт Lampac (апрель 2026) всё ещё смотрит на пустой w2 | **Мёртв** — снять с плиток (адаптер оставить: DLE+Playerjs, вернётся — включим) |
| **VePorn** | 2026-05-25, `veporn.net` 504 | Переехал на **`veporn.com`** (живой, 200 КБ). Стрим — прямой `cdn.veporn.com/{slug}.mp4` без токена. Контент: рипы пейсайтов (Brazzers…), EN | Можно вернуть за ~40 мин; ценность средняя (дублирует porntrex/hqporner) |
| **NoodleMagazine** | 2026-05-25, «Vimeo арт-фильмы, стрим сломан» | Живой (`noodlemagazine.com`) | Не возвращать (контент не тот) |
| **GayPornTube** | 2026-05-28, REQ-1 владельца | Живой | Не возвращать (решение владельца) |
| **spankbang** | не убран; серая точка | Cloudflare **managed challenge** (`cf_chl_opt`, `challenge-platform`) на всех выходах: IP устройства, CF-воркер, VPS, **Val.town** (в июне проходил — теперь тоже 403), `spankbang.com/www/m/.party`, `/api/videos/*`. Lampac решает **только** headless-браузером (коммит «Playwright CDP stream», 2026-05-28) | Либо FlareSolverr на VPS (инфра 1–2 ч), либо снять плитку. Клиентским кодом не лечится |
| **ebun** | не убран; «видео 403 → только внешний плеер» | **Не мёртв.** Цепочка на устройстве: `www1.ebun.tv` → карточка `x.ebun.top/videos/{id}/` → iframe `666-emded.com/embed/{id}` → `get_file/…mp4?v-acctoken` (302 → `nl.videofile.me`) → **206 video/mp4** без Referer и с Referer `666-emded.com`; **403 с любым чужим Referer** (`ebun.tv`, `lampa.mx`, `github.io`). Внутренний плеер WebView шлёт `Referer: lampa.mx` → `MEDIA_ELEMENT_ERROR: Format error` (стенд; контроль hellporno играет). Внешний плеер (без Referer) играет. Матрица audit6 слала Referer страницы → ложный «ERR 403» (харнесс исправлен: две попытки) | **Чинится 2 строками** (§3.1) |

## 2. Кандидаты на добавление (проверены: curl + нативный фетч со стенда)

Нет в Cherry, есть у конкурентов. «Двиг» = как парсить; «Стрим» = откуда видео; «Android» =
нативный фетч со стенда.

### Tier A — высокая ценность, дёшево

| Сайт | Хост (актуальный) | Язык | Двиг | Листинг/поиск | Стрим | Android | Оценка |
|---|---|---|---|---|---|---|---|
| **xhamster** | `ru.xhamster.com` | EN-заголовки (ru = только UI) | JSON `window.initials` в HTML (`videoThumbProps`: title, pageURL, duration, views, thumbURL, **trailerURL** = hover-клип, `maxPages` 1771) | `/newest/{p}`, `/best/{p}`, `/categories/{slug}[/newest]` (655 категорий), `/search/{q}?page=N` | Страница видео: `video-nss.xhcdn.com/…/_TPL_.h264.mp4.m3u8` — мастер-HLS 144→1080p, **не привязан к IP** (VPS ✓, устройство ✓); mp4-источники привязаны (`data={ip}-dvp`) — не брать | Нативный фетч листинга упал на HTTP 103 (Early Hints), страница видео ок; CF-воркер один раз 503, VPS ✓ → страницу через VPS (`PROXY_URL_2_HOSTS` + force-proxy), HLS → inner-плеер (уже так для m3u8) | ~1.5 ч. Топ-3 сайт мира, есть у всех конкурентов |
| **ebalovo** | `www.ebalovo.porn` → `wec.epalovo.com` | RU | KVS (kt_player), карточки `<a href=…/video/{slug}/ data-id data-eb="13:55;…">` (длительность в `data-eb`), thumbs `img.ebacdn.com` | `/porno-online/{p}/` (24/стр), сорты (Lampac): `porno-online`=лучшее, `xxx-top`=популярное; категории `/porno/{slug}/` (28+, RU ярлыки в Lampac `Modules/Adult/Ebalovo`), поиск `/search/{q}/{p}/` (36) | `video_file/…mp4/?v-acctoken` — **не привязан к IP** (VPS 206 ✓) | ✓ | ~1 ч. Классика RU-сегмента, есть в Lampac/xsena |
| **porno666** | `wwwp.porno666.news` → `porno666.link` | RU | KVS стандартный (23× get_file) | `latest-updates/{p}/`, `search/{q}/{p}/`, категории KVS | get_file KVS | ✓ (24 карточки) | ~20 мин через `_kvsEngine`. Это та же ферма, что кормит ebun (`666-emded`) |
| **lenkino** | `wes.lenkino.adult` | RU | KVS (flashvars `video_url`/`video_alt_url` + `video_file` токены, CDN `lencdn.com`) | `/page/{p}`, `/search/{q}/page/{p}`, карточки `/{id}` | flashvars 480/720 | ✓ | ~45 мин |
| **porno365** | `porno365.pw` (Lampac: `porno365x.blue`; `porno365x.me` → 451 гео) | RU | DLE | `/page/{p}/` (36), категории `/{slug}/page/{p}/`, поиск DLE `index.php?do=search…` (RU-запросы) | Playerjs-список `url_240p.mp4,[360p]url,[480p]…` на `v5.cdnde.com` — **тот же формат, что lenporno** (парсер есть) | ✓ | ~45 мин |
| **pornobriz** | `pornobriz.com` | RU | свой | `/?page=N` (42), `/new/page{p}/`, `/best/`, `/top/`, `/category/`, `/stars/`; поиск `/search/{q}/page{p}/` | `<source src="pornobriz.com/video_full_hd/{slug}.mp4" size="1080">` + 720, без токена; hover-mp4 `m.pornobriz.cloud/preview/…` | ✓ | ~45 мин |

### Tier B — EN, крупные, просто

| Сайт | Хост | Двиг/стрим | Примечание |
|---|---|---|---|
| **redtube**, **youporn** | `www.redtube.com`, `www.youporn.com` | PH-семейство: `data-mediabook` превью в листинге, `mediaDefinitions` (mp4/hls, `validfrom/validto`) на странице | Нативно ✓ (138/118 карточек). В РФ заблокированы (РКН) → на реальном ТВ понадобится прокси, как pornhub. Общий парсер на двоих ~1.5 ч |
| **pornhat** | `www.pornhat.com` | KVS, `<source>` теги (видны Auto/360p — выше, вероятно, за логином) | ✓; ценность средняя |
| **veporn** | `veporn.com` | прямой `cdn.veporn.com/{slug}.mp4` | см. §1 |

### Tier C — не брать (причина)

`ebasos` (стрим через чужой iframe `slavnoe.net/embed` — medium), `pornk` (`ps.pornk.top`, KVS, стрим в
первом проходе не найден), `bigboss.video` / `rusvideos` (Playerjs с обфусцированным file),
Tubecorp-семейство `txxx/hdzog/vjav/upornia/hclips/vxxx` (защищённый JSON-API), `sxyprn` (обфускация),
`beeg` (только API), `4tube` 403, `motherless`/`pornk.tv`/`porno365x.me` (гео/таймаут), `sosushka/24video/
vporno/pornoakt` (мелкие DLE), `tnaflix` (XML-API), live-камеры BongaCams/Chaturbate/Cam4 (другой UX,
владелец не просил), `anysex/drtuber/nuvid/sunporno/pornoxo/zbporn/sexvid/xfreehd` (EN середняки — резерв).

### Разница с конкурентами (по источникам)
- **Есть у AdultJS, нет у нас:** xhamster, lenkino, ebasos, pornk, porno365, porno666, pornobriz, 24video,
  bigboss, sosushka, vporno, pornoakt, rusvideos, veporn, vtrahe(+tv), batsa, noodle, gayporntube,
  bongacams, chaturbate.
- **Есть у Lampac/xsena, нет у нас:** xhamster, ebalovo, runetki/bongacams/chaturbate/cam4, + все 60
  YAML NextHUB (в т.ч. huyamba на `play.huyamba.mobi`).
- **Только у нас:** 24rolika, tizam, perfektdamen, hellporno, crocotube, analdin, 3movs, pornve,
  familyporn, xozilla (+ hqporner vs AdultJS).

## 3. Как чинить (готовые рецепты)

### 3.1 ebun — 2 строки
Причина: токен `v-acctoken` привязан к IP, который запросил embed; CDN режет чужой Referer.
Внутренний плеер (WebView) всегда шлёт `Referer: lampa.mx` → 403. Решение по образцу hqporner/mydaddy:
`'666-emded.com': 1` в `PROXY_URL_2_HOSTS` (стабильный IP VPS, безлимит) **и** в `_ANDROID_FORCE_PROXY`
→ embed и `get_file` идут с одного IP VPS, прокси без параметра `referer` Referer не шлёт → 206.
В браузере путь и так через прокси. Проверка: `tv-play-inner.page.js ebun` → `currentTime > 0`,
`tv-audit6.mjs ebun` → `play: MP4`.

### 3.2 huyamba — вернуть через `_kvsEngine` (как xozilla), ~25 строк
- `browseUrl`: `https://play.huyamba.mobi/videos/?by={sort}&from={p}` (`page=` игнорируется —
  страницы дублируются, только `from=`); сорты `post_date` / `video_viewed_week` / `rating_week`
  (+ стандартные KVS `video_viewed`, `rating`, `duration`).
- `categoryFmt`: `https://play.huyamba.mobi/categories/{slug}/videos/?from={page}` (33 слага и RU-ярлыки —
  в `Modules/NextHUB/sites/huyamba.yaml` Lampac); `searchUrl`: `/search/{q}/?from_videos={p}`.
- `hrefRxSrc`: `href="(https?://play\.huyamba\.mobi/video/\d+/)"`; превью-клип из `data-preview`.
- `getStream`: flashvars `video_url/video_alt_url/video_alt_url2` = 480/720/1080 (как xozilla).
- Android: `'play.huyamba.mobi': 1` в `_ANDROID_FORCE_PROXY` (мобильный UA → редирект на мёртвый
  `rt.huyamba.xyz`); стрим — сырой с устройства (токен не IP-bound). Маршрут страницы → VPS.
- `_RU_SOURCES` += huyamba; удалить закомментированный старый адаптер и `_huyambaCards/_huyambaPages`.

### 3.3 xhamster — новый адаптер
Парсить `window.initials` (JSON до `;</script>`), карточки из `layoutPage.videoListProps.videoThumbProps`
/ `searchResult.videoThumbProps` / `pagesCategoryComponent.trendingVideoListProps.videoThumbProps`
(так делает Lampac). `thumb`=thumbURL, `preview`=trailerURL, страницы из `maxPages`. Стрим — regex
`https://video-nss\.xhcdn\.com/[^"]+\.m3u8` на странице видео (мастер-плейлист, качества внутри).
Маршрут: `ru.xhamster.com` → `PROXY_URL_2_HOSTS` + `_ANDROID_FORCE_PROXY`; m3u8 — inner-плеер.
Похожие: `relatedVideos` есть в JSON страницы видео; модели: `/pornstars`.

### 3.4 RU-пачка через `_kvsEngine`
porno666 (стандартный KVS), lenkino (flashvars + `/{id}`-карточки), ebalovo (кастомный `hrefRx`
`/video/{slug}/`, длительность из `data-eb`, thumbs `img.ebacdn.com`), porno365 (DLE, переиспользовать
Playerjs-разбор lenporno), pornobriz (`<source size=…>`). Все — в `_RU_SOURCES`.

### 3.5 spankbang — только инфраструктура
FlareSolverr (Docker) на VPS, прокси VPS запрашивает решение → получает `cf_clearance`+UA, кэширует
(~30 мин), подставляет в запросы к spankbang. `cf_clearance` привязан к IP+UA — потому решать надо
именно на VPS-IP. Стрим `sb-cd.com` — подписанный mp4, без Cloudflare. Если не хочется держать
браузер на VPS — снять плитку (сейчас серая точка).

### Что можем сломать при добавлении каналов
- `_RU_SOURCES` (маршрутизация RU-запросов) и `_TAG_SEARCH` — новые RU-сайты добавлять в первый.
- Общий поиск/«Все видео»: fan-out по всем источникам с `ALL_SRC_TIMEOUT_MS` 7 с и по 10 карточек с
  источника — +7 каналов = +70 карточек и больше параллельных запросов; прогрессивная отрисовка (п.7
  плана) становится актуальнее.
- Точки-статусы (`_healthRefresh`, LIMIT 4 параллельных проб) — просто длиннее фоновый опрос.
- Тесты: anti-drift тесты проверяют строки кода конкретных адаптеров; счётчик источников в тестах
  не захардкожен (только логи).

## 4. Рекомендуемый порядок
1. ebun — 2 строки (§3.1). 2. huyamba — оживить (§3.2). 3. xhamster (§3.3). 4. ebalovo. 5. porno666 +
lenkino + porno365 + pornobriz. 6. 24rolika — снять плитку. 7. spankbang — решение владельца
(FlareSolverr / снять). 8. redtube/youporn/veporn/pornhat — по желанию.
