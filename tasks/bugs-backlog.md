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

## Search-quality overhaul 2026-06-25 (эмулятор + ruflo + OmniRoute) — v0.13.10
Полная проверка качества поиска на стенде (baseline релевантности EN vs RU по каналам) + ремонт.
НАЙДЕНО+ПОЧИНЕНО:
- **xozilla/analdin search СЛОМАН** — searchUrl `?s=` игнорировался (возвращал фид, 110 карточек,
  match 23%). Исправлено на KVS-путь `/search/{q}/` (page1 omit) → milf-релевантность 23%→48-54%,
  analdin пагинируется.
- **RU-поиск (главный рычаг для рус.пользователя)** — кириллица уходила на англо-title сайты
  (мусор), а merge отключал фильтр/ранг для не-Latin. Внедрено:
  * `_RU_EN` концепт-карта (~70 терминов) + `_translateQuery` (greedy phrase-first): «большие
    сиськи»→"big tits", «мамка»→"milf", «молодая блондинка»→"teen blonde", «русская мамка»→"russian milf".
  * per-source роутинг: англо-сайты получают перевод, рус-сайты (`_RU_SOURCES`: tizam/lenporno/
    24rolika/ebun/jopaonline/pornobolt/crocotube) — оригинал.
  * `_searchGroups` теперь ДВУЯЗЫЧНЫЙ ([ru,…EN]) → фильтр+ранг работают и для кириллицы (isLatin-гейт снят).
  * Верифицировано на стенде: топ-20 релевантность RU-запросов ~0-40% → **100%**; EN остались 100%.
- «Похожие по названию» улучшены автоматически (идут через тот же all_sources merge + RU→EN).
  `_searchKeywords` уже дропает порно-филлеры (video/scene/hd/…), не менялся.
- «Похожие» (getRelated+фид) — не query-based, не трогали.
vitest 736 pass (+RU→EN функциональные + анти-дрейф). vitest/эмулятор без регрессий.

## 2026-07-31 — Blank posters (~30% in «Все видео») — RESOLVED (v0.13.11)

**Symptom (owner):** «нет некоторых превью (30% нет вообще) в разделе "все видео" и почти во
всех каналах». The visible card image is `v.img = v.thumb`; the thumb *string* was present on
100% of cards (old audits passed) but the `<img>` failed to render → blank card.

**Root cause (emulator, real `Image()` load test):**
- xvideos/xnxx: listing `data-src` sometimes holds the unsubstituted hover template
  `xv_THUMBNUM_t.jpg` / `xn_THUMBNUM_t.jpg` → 404 as static poster (xv 5/27, xn 36/47 bad).
- pornhub: `_mapVideo` picked `v.thumbs[last].src` = a `hash&validto` (pix-cdn77) URL that is
  IP-bound to the fetching host → 404 in the device `<img>` (~18/30 blank). The API also ships an
  `hdnea` (pix-fl, Akamai token) variant that renders from any IP.

**Fix:** xv/xn `_parseCards` substitute `THUMBNUM`→`1`; pornhub `_mapVideo` prefers the first
`hdnea`-signed candidate across `thumb`/`default_thumb`/`thumbs[]`.

**Verification (emulator):** `test/tv-thumb-load-all.mjs` browse/cat/search/model/related = 100%
for all 24 channels (24rolika down = HTTP 530 site outage, unfixable). «Все видео» merged feed:
230/230 cards loaded = 100%, zero blanks. vitest 743 pass (+8 new regression tests).

## 2026-09-04 — Relevance + preview + favorites pass (v0.13.12)

Owner report (6 pts): (1) previews missing in search/all_videos; (2) search not relevant enough;
(3) related/related-by-title not always relevant; (4) global search not always relevant; (5)
favorites missing previews. Diagnosed + fixed on the Google-TV emulator (cherryRoot AVD).

**RESOLVED:**
- **Search relevance (2,4)** — new shared `_relScore`/`_rankByRelevance`, applied to BOTH
  all_sources and single-channel search (per-page, before explicit client sort). Emulator:
  exact-phrase in top-5 0–40% → 100% (teen anal, blonde massage, russian mature, большие сиськи);
  strong-match top-10 0→100%.
- **«Похожие» page 2+ (3)** — was the generic newest feed (~0% relevant). Now a title-keyword
  search on the same source. Emulator: page-2 seed token-overlap 0→75–92%; pornhub (getRelated=1
  item) now yields 30 relevant results.
- **Favorites poster (5)** — pornhub thumbs are IP-bound signed URLs (24h TTL) → blank after a
  day (only pornhub; others store stable URLs). Fix: cardRender one-shot `<img>` onerror →
  `source.refreshThumb()`; pornhub re-fetches the video page for a fresh hdnea poster (verified
  loads). Generic self-heal for any expired/broken poster.

**Posters (1):** already 100% in browse/search/model/related/all_videos after v0.13.11 (re-confirmed).
The remaining "не везде превью" is the HOVER-PREVIEW CLIP (plays on focus), missing on ~10 channels.

**DEFERRED / inherent (low priority):**
- Hover-preview clip absent on: hqporner, eporner (embed-only, no direct mp4), pornhub (webmasters
  API returns none), pornone/tizam/ebun/porndig (no clean card-level preview attr). porntrex/
  lenporno expose partial markers but not cleanly in the listing card chunk — revisit if a clean
  per-card preview URL is confirmed. NOT fixable without a preview URL the site actually serves.
- xvideos titles keep rare named HTML entities (e.g. `&iexcl;`) — `_decodeHtml` covers common +
  numeric entities only; pollutes «Похожие по названию» keywords for such titles (~minor).
- spankbang browse returned 0 cards this session; 24rolika HTTP 530 (site outage) — both env/site.

## 2026-09-04 (b) — follow-ups on the 3 improvement proposals (v0.13.13)

Owner asked to try/fix the 3 backlog items. Verified on the cherryRoot emulator.

**RESOLVED:**
- **HTML entities in titles (#2)** — `_decodeHtml` rewritten as a single-pass decoder (numeric
  `&#233;` + hex `&#xE9;` + a named-entity map: iexcl/iquest/ndash/mdash/accented Latin/…);
  unknown named entities left literal. `stripTags` now delegates to it, so EVERY parser's titles
  decode (root-cause fix, not per-site). Emulator: xvideos titles with entities 6 → 0
  ("&iexcl;MUY TIERNA" → "¡MUY TIERNA"). Improves display AND «Похожие по названию» keywords.

**NOT FIXABLE IN-PLUGIN (verified, deferred with reason):**
- **Hover-preview clip for porntrex/lenporno/pornone (#1)** — TRIED. Their listing HTML exposes
  NO per-card video preview (porntrex's 6 `data-preview` are photo-ALBUM thumbs on
  albums.cdntrex.com, not the 170 video cards; KVS loads the hover clip via JS on hover). Adding
  it would require URL-guessing (removed earlier as unreliable) or per-hover AJAX. Not worth a
  костыль. Poster is already 100%; the clip is optional focus polish.
- **spankbang browse (#3)** — RE-CHECKED. All three proxy tiers (Val.town / CF worker / VPS) AND
  the device-native residential IP get Cloudflare's "Just a moment…" MANAGED JS challenge (403).
  Plain HTTP proxies can't pass it (needs JS exec + cf_clearance). Fix requires a headless-browser
  solver (FlareSolverr) on the VPS — an infra task, out of scope for a plugin code change. Until
  then spankbang stays dark. (Was passing on Val.town's IP before; CF has since tightened it.)

## 2026-09-04 (c) — deep UI/functional audit follow-ups (v0.13.14)

Owner triage of the interface audit: 1 (empty-favorites blank screen) — NO; 2 — DO; 3 (Случайные/RP
labels) — intentional camouflage, keep; 4 — analyse both sorts, recommend; 5 — recents, masked;
6 — no channel enable/disable, but a small health dot on tiles; 7 (grid cache) — NO; 8 (source
badge in single-channel grid) — keep.

**DONE (stand-verified, real components):**
- **Hover-preview on Android (2):** the `!_isAndroid()` gate in `cardRender.onFocus` removed —
  the TV WebView autoplays muted `<video>` (probe: `playing` event, currentTime 3.6 s in 4 s;
  in-grid: focused card `paused:false, t:1.8`). Force-proxy hosts get the clip via the proxy.
  Settings toggle now actually means something on TV.
- **RU quick-picks + discreet recents (5):** `_POPULAR_TERMS` Russian; recents (last 10) shown
  only in Cherry's picker with a clear item; verified «↺ мамка» after a pick.
- **Health dots (6):** green/gray/ring on source tiles, 6 h cache, background re-probe 4-wide/8 s.
  Stand: 22 green, 2 gray (spankbang, 24rolika) within ~3 s.

**SORTS (4) — measured, recommendation pending owner OK:**
- Server «Сортировка» changes the PLAIN FEED only on: pornhub, eporner, hqporner, youjizz,
  perfektdamen, hellporno, pornobolt, crocotube. It is a NO-OP on the feed for: xvideos, xnxx,
  pornone, porntrex, xozilla, 3movs, analdin, pornve, familyporn, ebun, lenporno, jopaonline
  (their "latest" list is fixed) — but WORKS INSIDE A CATEGORY for all of those except
  hqporner/youjizz/lenporno/jopaonline (category sort no-op there). porndig/tizam: no sorts.
- «Сортировка (точная)» = client per-page (duration/title) — always works, page-local.
- Recommendation: ONE «Сортировка» menu. List server sorts only where they take effect in the
  current mode (feed / category / search — per-adapter capability derived from the table above),
  then the exact client options as plain items («Длинные сначала», «Короткие сначала», «По
  названию»). No "(точная)" wording; header keeps showing the active sort. ~40 lines: merge
  `_openSort` + `_openClientSort`, add a feed-sort allowlist. Not implemented — awaiting go.

**STILL OPEN (from the audit, not triaged):**
- Search ignores the query on 5 channels (3movs `?s=` → `/search/{q}/`; pornone, jopaonline,
  ebun, lenporno need URL investigation) — pollutes global search with fallback cards.
- Empty-favorites blank screen: owner said no; root cause documented (sync resolve before the
  activity is in `Lampa.Activity.all()` → `comp.empty()` appends nowhere). Also affects the
  «Повторить» retry affordance only on that sync path.

## 2026-09-04 (d) — search ignored the query on 5 channels — RESOLVED (v0.13.15)

Owner: «делай». Method: for each site, discover the real search `<form>` (action/method/field)
from its homepage, then score every candidate URL with the adapter's OWN card parser (title-stem
match %, two queries → different first card, page 2 disjoint). All on the emulator, via the
adapters' real fetch path (lenporno is a force-proxy host — probing it natively hits a mirror
redirect and misleads; use cherryFetch).

| site | was (ignored query) | now (stand-verified) |
|---|---|---|
| 3movs | `/?s=` | `/search_videos/?q=` + `&from_videos={p}` — 83–96%, p2 differs (10 tie repeats, grid dedups) |
| pornone | WP REST → 0 posts → `?s=` fallback | `/search/?q=&page=` — 100%, p2 disjoint; 11/page device-IP, 35 via proxy |
| ebun | `/search/?s=` | `/search/{q}/{p}/` — 83%, p2 disjoint |
| lenporno | `/search/{q}/?page=` (= homepage) | `/search/?text=&page=` — 92%, p1/p2/p3 disjoint |
| jopaonline | DLE `?do=search` (404 + generic block) | `/search/{q}/{p}/` — 92–100%, paginates |

Dead code removed: pornone `_fromApi`. Tests: anti-drift for all 5 endpoints; 2 legacy tests
updated (lenporno URL; single-page-search count 3→2 since jopaonline now paginates).

## 2026-09-04 (e) — favorites posters: verified end-to-end + legacy THUMBNUM records (v0.13.16)

Owner: «превью в избранном везде есть, не пропадает?». Stand (components registered by Lampa
itself): seeded favorites from pornhub/xvideos/xnxx/eporner/xozilla/tizam/pornone/hellporno + a
pornhub card with a deliberately broken hdnea token → 9/9 posters loaded; the broken one was
self-healed (data-cherry-refreshed, 640 px). Remaining gap closed: records saved before v0.13.11
could hold `xv_THUMBNUM_t.jpg` / `xn_THUMBNUM_t.jpg` (no refreshThumb for those sources) → `Fav.all()`
now normalizes THUMBNUM→1 on read. Harnesses: test/tv-fav-posters.mjs, test/tv-fav-legacy.mjs.

## 2026-09-04 (f) — favorites: sync-merged records sank to the bottom; pull on open (v0.13.17)

Owner added a video to the sync bucket (PIN 1206) and did not see it on the TV. Root cause:
Fav.all() returned records in STORAGE order — local toggles unshift (newest first) but
_merge APPENDS records pulled from another device, so a merged newest record rendered as the
LAST card. Plus the bucket was only pulled on Cherry-home open, not when opening favorites.
Fix: Fav.all() sorts by added desc; the favorites grid runs Sync.run() first (capped 2.5 s,
no PIN / failure -> local list) and renders on a later tick. Side effect: the empty-favorites
blank screen (sync resolve before the activity was registered) is gone — the hint box now
mounts (stand: emptyBox 1, selector 1). Harness: test/tv-fav-order.mjs. vitest 763.

## 2026-09-04 (g) — full 24-channel matrix (test/tv-audit6.mjs) + crocotube RU misclassification (v0.13.18)

Matrix: catalog p1/p2, category set-overlap, search (EN or RU by source) honour/match/p2,
posters, clip, durations, related, models, device-IP playback, latency. All 22 live channels:
posters 100%, playback MP4/HLS OK (ebun hotlink 403 = external player only; spankbang CF;
24rolika down), search honours the query everywhere.

FIXED: crocotube was in _RU_SOURCES but its titles are English (stand: 0 Cyrillic titles;
search 'blonde' → 60 results 58% match, 'блондинка' → 0). Russian global searches lost the
channel entirely. Removed from the map.

OPEN (data-backed, for triage):
- Single-channel SEARCH page 2 broken/absent: xozilla (p2 empty), analdin (10% new), pornve
  (p2 empty), familyporn / porndig / perfektdamen (p2 == p1). Global search is p1-only so it
  is unaffected; in-channel search scroll ends after one page there. tizam/pornobolt = known
  single-page search.
- Category filter ignored on tizam (100% overlap with the plain feed) and weak on perfektdamen
  (80%); lenporno 42%, pornve 35%, xozilla 30% (partial).
- Feed pagination repeats: pornobolt 62% new on p2, tizam 75%, hellporno 85%.
- pornhub first screen 6.2 s (webmasters API empty-retry loop up to 4×).
- Tag-based searches (hqporner 0% title match, perfektdamen 5%, porndig 17%, eporner/pornhub
  23%, analdin 26%, xozilla 39%) are RELEVANT by site tag but the global ranker scores them
  by title words → they sink to the bottom. Consider a per-source "tag search" baseline.
- Models index size: crocotube 5679, familyporn 1642 tiles in one grid → paginate/cap.
- Hover clip absent on 9 channels (inherent, no per-card clip in listings).

## 2026-09-04 (h) — items 1–3 of the matrix triage (v0.13.19)

**1. Single-channel search page 2 — FIXED.** Discovered each site's real pager with the adapter
transport and scored candidates by NEW cards on page 2: xozilla, analdin, familyporn,
perfektdamen -> `?from_videos=N` (KVS search-block pager; the /{q}/{p}/ path came back empty or
re-served page 1) — stand: p2/p3 100% new on all four. porndig -> DLE pager
(index.php?do=search&search_start=N&result_from=…, status-tolerant fetch) — p2 80% new, p3
repeats (2 pages). pornve — no working pager exists (every form blocked or page 1) -> declared
single-page (total_pages 1).

**2. Global ranking for tag-search sources — DONE.** `_TAG_SEARCH` (hqporner, perfektdamen,
porndig, eporner, pornhub, analdin, xozilla): taken UNFILTERED in site order, marked
`_siteRelevant`, scored as a plain full match (groups×10); score ties interleave across sources
via `_srcRank`. Real grid («blonde», 197 cards): these sources now sit at positions 26–99
(was 130+ for hqporner); title-boosted matches stay on top, non-matching RU sites at the end.

**3. Categories — no defect.** tizam: the first category `all_sex` IS the plain feed (100% overlap
by construction); its other categories filter normally (25–35% overlap). perfektdamen: 37–75%
overlap (small site, `hd` ≈ everything) — works. Nothing to fix; cosmetic option: drop `all_sex`.

## 2026-09-04 (вечер) — аудит мёртвых/убранных каналов (docs/channels-revival-2026-09-04.md)
- (i) **ebun — видео 403 только во внутреннем плеере (WebView шлёт `Referer: lampa.mx`), внешний играет.** Причина: CDN `666-emded.com`/`nl.videofile.me` режет чужой Referer; токен привязан к IP запросившего embed. Фикс: `'666-emded.com'` → `PROXY_URL_2_HOSTS` + `_ANDROID_FORCE_PROXY` (2 строки). Severity: medium. **Сделано v0.13.20** (стенд: inner player currentTime 4.2 с).
- (j) **Харнесс `tv-audit6.page.js` слал Referer страницы в пробе воспроизведения** → ложный `ERR 403` для ebun. Исправлено 2026-09-04: две попытки (без Referer / с Referer страницы), метки `MP4(noref)`/`MP4(ref)`.
- (k) **24rolika мёртв** (`w2.huyalkino.com` 0 байт, `love.24rolika.ru` DNS не резолвится) — снять плитку, адаптер оставить. Severity: low. **Сделано v0.13.20** (`disabled: true` + `_activeSources`).
- (l) **spankbang** — CF managed challenge на всех выходах, включая Val.town. Только FlareSolverr на VPS или снять плитку. Severity: low (решение владельца).

## 2026-09-05 — регрессии после партии каналов (владелец: «не открывается pornhub», «навигация в избранном не работает»)
- (m) **Избранное: сломанная навигация — корень в v0.13.17.** `Sync.run()` стал вызываться при каждом открытии избранного (pull-on-open), а внутри `Sync.run` остался старый хук `_refreshGrid()` → `comp.create()`: грид пересобирался поверх уже построенного (второй набор карточек / оставшийся блок «Здесь пусто», фокус уезжал на кнопку «Обновить»). Воспроизведено на стенде с реальным бакетом (79 записей): после открытия ни одна карточка не в фокусе, стрелки уводят на элемент №80. **Исправлено v0.13.24:** `_refreshGrid` удалён, синк только мёржит; грид строится один раз из смёрженного списка. Стенд: фокус на карточке 1, стрелки 0→7, тёплый и холодный сценарии.
- (n) **Pornhub «не открывается».** На стенде грид открывается (30 карточек), но первый экран 6–9 с: webmasters API с IP устройства отдаёт 200-HTML/пусто → адаптер 4 раза повторял ТОТ ЖЕ нативный запрос. **v0.13.24:** `_apiFetch` чередует натив ↔ прокси между попытками (VPS и CF отдают JSON — проверено). Симптом на ТВ владельца ещё не подтверждён фактами (нужно: спиннер / «Здесь пусто» / ошибка).
- (o) Харнессы: `tv-eval.mjs` (без инъекции, как в проде, ловит JS-исключения), `tv-grid-open.page.js`, `tv-state.page.js`, `tv-sync-check.page.js`, `tv-ph-timing.page.js`. `tv-page-run` дополнительно отдаёт `Sync/Fav/Hist`.
- (p) **Pornhub «не открывается» — настоящий корень найден и починен (v0.13.25).** webmasters отдаёт только HLS; residential-SOCKS5 пул воркера мёртв → страница и сегменты шли с разных IP (470); плюс 2/3 рендеров страницы несут мёртвую схему `hv-h`/`h=`. Фикс: страница+phncdn через VPS (один IP), Deno-прокси пробрасывает referer в плейлист, `getStream` перезапрашивает страницу до схемы `ev-h`/`validfrom`, hv-h→ev-h swap + проверка плейлиста. Стенд: реальный `playVideo` играет. Остаточный риск: ~7 % рендеров без схемы A за 7 попыток → «Не удалось» на этом видео (повтор помогает).
- (q) **Воркер CF: истёк OAuth wrangler (2026-06-17) + мёртвый residential-пул с утёкшими кредами в исходнике.** Нужен интерактивный `wrangler login` от владельца; после — убрать пул (PROXIES=[]) и phncdn/pornhub из RESIDENTIAL. Severity: medium (сейчас pornhub через VPS, воркер для него не используется).
- (r) **Харнесс воспроизведения:** `tv-verify-play.page.js` — штатный `playVideo`, HLS→inner+hls.js (с `play()`-толчком: без жеста пользователя autoplay может не стартовать), MP4→Range-фетч с Referer страницы (внешний плеер). `tv-play-state.page.js` — отладка hls.js событий/буфера. Урок: форсировать inner-плеер для MP4-каналов нельзя — «Format error» там артефакт.
