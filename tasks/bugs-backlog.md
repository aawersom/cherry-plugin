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
