# Bugs Backlog

Out-of-scope bugs spotted during tasks. Critical/high → fix in flight. Medium/low → here for a separate conversation.

---

## Resolved / obsolete (2026-06-04, InteractionCategory migration)

- **BL-1 — RESOLVED/OBSOLETE.** The `cherry_card` template was deleted in the dead-code purge; cards now render via Lampa's stock `.card`, which sets the title as TEXT (not innerHTML). Security review (2026-06-04) confirmed no scraped value reaches innerHTML. No XSS path.
- **BL-3 — RESOLVED.** All `getRelated` paths now `.slice(0, 20)` (incl. pornhub relatedVideosJSON and the per-site getRelated added 2026-06-04).
- **BL-4 — OBSOLETE.** Row mode (`renderRows`/`cherry_home_mode`) was removed in the InteractionCategory migration; CherryMain is now a single picker. No duplicate card-creation path.

---

## cherry-ux-v2 (2026-06-03)

### BL-2 (low, pre-existing, STILL OPEN) — thumb/preview src set without scheme allowlist
**Where:** card thumb (via stock card `img`/`poster`) + `_startPreview` videoEl.src.
**Risk:** Low (javascript:/data: inert for img/video media loads), but malformed values could trigger unexpected requests.
**Fix:** validate `https?://`/`//` prefix before assignment. (Note: cards now use the stock `.card` renderer for thumbs; preview `<video>.src` is still set directly in `_startPreview`.)

### BL-1 (RESOLVED — see top) — `video.title` interpolated into cherry_card template without confirmed escaping
**Where:** `plugin.js` renderCards `Lampa.Template.get('cherry_card', {title:...})` + template `<div class="cherry-card__title">{title}</div>`
**Risk:** `title` comes from untrusted scraped HTML. `_parseHtmlCards` runs `_decodeHtml` on it, which can turn `&lt;img&gt;` back into live `<img>`. If `Lampa.Template.get` does naive string replacement without HTML-escaping → stored-DOM XSS in the card grid.
**Scope:** Pre-existing — affects ALL cards (browse/search/related), not introduced by Phase 1. The model badge already uses the safe `.text()` pattern (`modelBadge.text(...)`).
**Fix (fundamental):** set title via `card.find('.cherry-card__title').text(video.title)` after template instantiation, remove `{title}` from template. Same for any other interpolated untrusted field. Caught by: security reviewer (Phase 1).

### BL-2 (low, pre-existing) — thumb/preview src set without scheme allowlist
**Where:** `plugin.js` renderCards `.attr('src', video.thumb)`, `_startPreview` videoEl.src
**Risk:** Low (javascript:/data: URLs inert for img/video media loads), but malformed values could trigger unexpected requests.
**Fix:** validate `https?://` or `//` prefix centrally in renderCards before assignment. Caught by: security reviewer (Phase 1).

### BL-4 (low) — row-mode card creation duplicates CherryGrid.renderCards
**Where:** `plugin.js` `renderRows()` (CherryMain) vs `renderCards()` (CherryGrid)
**Risk:** cherry_card instantiation (title/duration/views/thumb) + hover:enter→playVideo wiring exist in two places. A future card-markup or play-wiring change must be made twice.
**Scope:** Acceptable for v1 (row cards intentionally minimal — no fav/preview/long-press). If row cards later gain those, extract a shared `buildCard(video, src, opts)` helper rather than a third copy. Caught by: arch reviewer (Phase 5).

### BL-3 (nit) — getRelated relatedVideosJSON branch has no result cap
**Where:** `plugin.js` pornhub getRelated — JSON path returns full array; HTML fallback caps at `.slice(0,20)`.
**Risk:** malicious page with huge relatedVideosJSON → unbounded card render (mild client resource exhaustion).
**Fix:** apply consistent `.slice(0, N)` cap before rendering related results. Caught by: security reviewer (Phase 1).

## BL-SPANKBANG — «нет выдачи» на устройстве (2026-06-05)
**Статус:** требует device-лога. **Вывод проверки:** листинг spankbang НЕ сломан —
парсер выдаёт 72 карточки с живого сайта через Deno-прокси (`/s/{slug}/`, `/most_popular/`,
`/new_videos/`), thumb/title извлекаются (проверено `test/channel-health.mjs` + ручной парс).
Значит «нет выдачи» у пользователя — НЕ парсер. Кандидаты: (1) кэш старого плагина на устройстве
(hard-reload); (2) device-specific прокси/CORS; (3) превью с tbi.sb-cd.com (hotlink/referer) →
карточки пустые на вид; (4) это СТРИМ spankbang (давно сломан, нужен Playwright), а не листинг.
**Действие:** получить console-лог spankbang с устройства (как для синка) → точечно добить.

## BL-PORNHUB-STREAM — pornhub видео не играет (2026-06-08)
**Не VPS-проблема и не роутинг.** pornhub корректно идёт на CF→residential (НЕ в PROXY_URL_2_HOSTS).
Проверено: лист webmasters работает (30 карточек VPS/CF/direct); flashvars парсятся; hls master.m3u8
и variant-плейлисты отдают 200; НО **.ts-сегменты = 404 с ЛЮБОГО IP** (CF и напрямую), а **get_media
endpoint возвращает `[]`**. → pornhub защищает стрим сессией (cookies + тот же IP + свежие токены),
которую текущий прокси не реплицирует. Inline-hls токен протухает → сегменты 404.
**Нет уверенного фикса** простым изменением. Опции на будущее: (1) воспроизвести сессию pornhub
(get_media с cookies/referer с того же IP, что и страница) — крупно; (2) Playwright-извлечение;
(3) принять pornhub-стрим нестабильным. На устройстве плеер шлёт иные заголовки/cookies — возможно
ведёт себя иначе, чем curl; нужен device-console для подтверждения.

## BL-PORNHUB-STREAM — РЕШЕНО (2026-06-08)
На Android воспроизводится: getStream отдаёт m3u8 RAW → нативный плеер тянет страницу+m3u8+
сегменты с ОДНОГО домашнего residential-IP устройства → IP-bound токен phncdn сходится.
(Browser/proxy путь остаётся нестабильным — ротация SOCKS5 рвёт affinity; VPS датацентр → phncdn 410.
Но целевая платформа Android — работает. Подтверждено владельцем.)

## BL-SPANKBANG — нужен flaresolverr (2026-06-08, обновлено)
Все домены (ru/www/.com/.party/m.) отдают **Cloudflare «Just a moment» 403** (managed challenge,
требует JS/Turnstile). spankbang.mobi мёртв (502). Простой прокси (CF/VPS) и нативный fetch с
устройства не проходят. Зеркала без челленджа нет.
**Единственный фикс:** headless-солвер (flaresolverr / Playwright-Chrome). На текущем 1ГБ-VPS
ставить НЕЛЬЗЯ — Chrome (~400-600МБ) рискует OOM-убить контейнер AmneziaWG (VPN трогать нельзя).
**Нужно:** VPS 2-4ГБ под flaresolverr ИЛИ отдельный бокс → тогда маршрутизировать spankbang
(и любой CF-challenge сайт) через него. Альтернатива: скрыть spankbang до появления солвера.

## BL-SPANKBANG — РЕШЕНО (2026-06-08)
spankbang снова работает: страница идёт через бесплатный **Val.town HTTP-val** (PROXY_URL_VT),
чей egress-IP проходит Cloudflare-челлендж (VPS/CF датацентр-IP его не проходят → 403).
Эмулятор: 72 карточки + стрим (sb-cd.com/...mp4?secure=, подписанный токен) извлекается.
Конфиг: PROXY_URL_VT + PROXY_URL_VT_HOSTS{spankbang} в buildProxyUrl; spankbang убран из
PROXY_URL_2_HOSTS; добавлен в _ANDROID_FORCE_PROXY (device-IP тоже челленджится → форс прокси).
Деплой val: workers/cherry-proxy-valtown/main.ts; доступы в ACCESS-vault. Только листинг (КБ) —
free tier 100k/день с огромным запасом, видео не через Val.town.

## BL-PORNHUB-RELATED — низкий (2026-06-17)
pornhub `getRelated(video)` для части видео возвращает 0 (парсер related-блока на странице видео).
На бесконечный скролл «Похожих» НЕ влияет (v0.13.4: пустой related → фид канала с 1-й страницы),
но релевантность первой страницы для таких видео теряется (показывается сразу фид, без блока
«рекомендованного сайтом»). Чинить = поправить парсер related на странице pornhub. Приоритет низкий.

## BL-RELATED-PREVIEW — низкий (2026-06-17)
В «Похожие» превью-клип (hover) есть НЕ на всех карточках: блок «related» на странице видео несёт
только миниатюру, без preview-поля (xvideos `video_related` JSON = thumb only; KVS related-блоки
без data-preview), а у части каналов листинг вообще без превью (pornhub webmasters API не отдаёт
mediabook — только thumbs-кадры). Грид показывает миниатюры всегда; hover-превью — только на
страницах-фид каналов, которые отдают его в листинге. Это ограничение данных сайтов, не баг
парсера. Альтернатива (если важна консистентность превью > релевантность): вести «Похожие» сразу
фидом канала вместо блока getRelated — обсудить с владельцем.

## BL-PORNHUB-MODEL — РЕШЕНО (2026-06-17, v0.13.6)
pornhub browseByModel переведён с ненадёжного HTML-скрейпа /pornstar/{slug}/videos (слаг угадывался
из имени → 404 на «Lisa Canon»; _parseHtmlCards иногда давал 1 мусорную карточку) на webmasters API
search по де-слаг-имени → 30/стр., пагинируется, карточки играбельны (m3u8/proxied). Чинит баги
«поиск по модели не работает» + «видео из модели не открывается».

## tv-audit4 (2026-06-17) — глубокий аудит разделов (liveness/sort/dedup/search/thumb)
РЕШЕНО в v0.13.7:
- **xnxx воспроизведение сломано** — listing-href нёс плейсхолдер `/{num}/THUMBNUM/`, страница =
  77-байтная заглушка → getStream пуст. Парсер сворачивает URL к каноническому /video-{id}/{slug}.
- **youjizz битые миниатюры** — протокол-относительные `//cdne-pics…` → нормализованы к `https:`.

Найдено, НЕ баг / смягчено (не трогаем):
- **stream 403 через прокси**: pornone/3movs/pornve/familyporn/ebun — это НЕ force-proxy каналы,
  плеер берёт их с device-IP (резидентный), а CDN блокирует датацентр-IP прокси (потому они и не
  force-proxy). 403 — артефакт пробы через прокси, не слом на устройстве. Проверить на ТВ.
- **pornhub stream 410**: протухший ipa-токен на момент пробы (timing); реальное воспроизведение
  m3u8/proxied работает.
- **SORT no-op на глобальном фиде** (xvideos/pornone/xnxx/spankbang/porntrex/xozilla/analdin/pornve/
  familyporn/ebun/lenporno/jopaonline): серверный сорт игнорится домашним фидом канала. Смягчено:
  client-sort (длительность/название) работает всегда + сорты внутри категорий рабочие. Для
  xvideos/pornone это следствие фикса бесконечного скролла (фид = newest). Низкий приоритет.
- **DUPX (overlap p1∩p2)**: spankbang/porntrex/pornve/tizam/perfektdamen/hellporno — база грида
  дедупит по id визуально; влияет лишь на плотность новых карточек. Низкий.
- **search**: все 24 возвращают результаты; низкий %-match у русских каналов на латинский «milf» —
  ожидаемо (язык), не баг.

## Превью в «Все видео» + поиске (2026-06-17, v0.13.8)
Жалоба: «не во всех карточках превью в Все видео и после поиска». Проверено руками на стенде
(browse-preview% vs search-preview% по всем 24):
- **search НЕ теряет превью** — те же парсеры, что browse (нигде browse%>search%; pornve даже 20→90).
  toCard сохраняет поле. Значит дело не в пути «Все видео»/поиск, а в per-channel доступности.
ПОЧИНЕНО (превью БЫЛО в разметке, парсер промахивался):
- **perfektdamen** 0%→100% — атрибут `data-preview-custom="…_preview360p.mp4"` (читался не из того окна).
- **3movs** 3%→100% — `data-preview="…_preview.mp4"` сидит за 600-симв. окном тайтла → читаем durChunk.
Тех.лимит (hover-клипа НЕТ в источнике — не чинимо): pornhub (API только кадры), eporner (API
embed+thumbs, без клипа), hqporner (нет атрибутов), pornone (только рекламный ливкам), porntrex
(data-preview только в JS-hover, не на карточке), porndig (JS-lazy, инлайн только в сайдбаре), tizam,
ebun (нет атрибутов), lenporno (класс has-trailer без inline-URL), 24rolika (сайт отдаёт 530).
Итог: в «Все видео»/поиске превью теперь у ~14 каналов из 24; остальные физически без hover-клипа.

## Полная верификация 2026-06-25 (эмулятор + OmniRoute GPT-5.5 + ruflo) — v0.13.8
Прогон tv-audit3+tv-audit4 по всем 24 + device-IP liveness (техника OmniRoute: Range bytes=0-15 →
магия mp4 `ftyp`). ИТОГ: плагин ЗДОРОВ, прежние фиксы держатся (xnxx playback, youjizz thumb,
perfektdamen+3movs preview 100%, pornhub models 30+30, бесконечный скролл везде).

Playback перепроверен по device-IP (не через прокси!): **pornone/3movs/familyporn/pornve = LIVE**
(играют с резидентного device-IP; их 403 через прокси — ложный негатив, датацентр-ASN блокируется).

ДВА site-side проблемных канала (безопасно плагином НЕ чинятся):
- **24rolika — РЕШЕНО НЕЛЬЗЯ (site outage)**: все домены отдают HTTP 530 (Cloudflare origin down).
  OmniRoute: скрейпер-сайд фикса нет, только retry/mirror. Канал уже деградирует gracefully (0 карточек).
  Стоит понаблюдать — если 530 навсегда, отключить канал (сейчас добавляет ~7s таймаут к «Все видео»).
- **ebun — hotlink на стриме**: mp4 `666-emded.com/get_file/...` играет с device-IP + NO-Referer ИЛИ
  Referer=embed; 403 при Referer=lampa.mx (inner WebView-плеер) И 403 через ОБА прокси (CF+VPS — все
  датацентр-IP заблокированы). Дефолтный внешний/нативный плеер шлёт no-referer → ebun играет у
  большинства; проблема только у пользователей inner-плеера. OmniRoute-фикс = форс внешнего плеера
  для ebun, НО нативный запуск плеера не тестируется через CDP → вслепую в прод не катим. На реальном ТВ.

Превью: максимизировано — каналы с 0% (pornhub/eporner/hqporner/pornone/porntrex/porndig/tizam/ebun/
lenporno) физически не отдают hover-клип (API/разметка). Поиск: возвращает результаты на всех живых
каналах. Модели: работают; ✗MODSCRL = артефакт выборки model[0] (малонаполненный) или лимит сайта.

Харнесс: tv-audit3/tv-audit4 теперь глушат вызов startPlugin() (appready→false) — ре-инъекция
переживает состояние «Lampa не на главном меню» (иначе Lampa.Menu.addButton крашит до экспорта SOURCES).

## Per-mode верификация фильтров+превью 2026-06-25 (tv-audit5, эмулятор+ruflo) — v0.13.9
Проверены ВСЕ режимы каждого канала: превью в browse/категория/поиск/модели/похожие + эффективность
фильтров (строго по пересечению id-множеств, не первой карточке).
- **Категории РАБОТАЮТ на всех 24** ✓ (browse∩категория = 0-29%, категория0∩категория1 <40% → фильтр реально меняет контент).
  Флаги CATFILTER=SAME из первого прохода = совпадение первой карточки, не баг.
- **Сорты**: серверный сорт — no-op на глобальном фиде (~12 каналов) и в категориях spankbang/youjizz/
  lenporno/hqporner (их category-эндпоинты не имеют sort-параметра — подтверждено в коде: `no sort`).
  Работает у xozilla/perfektdamen/pornobolt/analdin. Смягчено гарантированным client-sort (длит./назв.)
  во всех видео-режимах. Это лимиты сайтов, не баг плагина.
- **Превью по режимам**: консистентно (browse==категория==поиск==модели) у превью-каналов ✓; related =
  thumb-only у xvideos/xnxx (в разметке видео-страницы нет клипа); 9 каналов без клипа в источнике.
ПОЧИНЕНО (v0.13.9): **pornve** — data-preview сидит ~+536..+609 от href на /latest-updates/, у края
600-символьного окна → флапало 10-85%. Читаем durChunk (+1200) → 100% превью во ВСЕХ режимах.
