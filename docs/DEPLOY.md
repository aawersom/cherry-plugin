# Cherry Plugin — Инструкция по деплою

## Архитектура: 4 прокси-тира

```
plugin.js  →  GitHub Pages (cherry-plugin)  →  пользователь в Lampa
                    ↓
   PROXY_URL    = https://cherry-proxy.aawersom.workers.dev   (CF Worker — основной; pornhub через SOCKS5)
   PROXY_URL_2  = https://185-36-141-21.sslip.io              (self-hosted VPS — стабильный IP; KVS/ASN-блок сайты)
   PROXY_URL_3  = ''                                          (резерв под residential VPS — не задействован)
   PROXY_URL_VT = https://aawersom--0d56e6a4….web.val.run     (бесплатный Val.town HTTP-val — ТОЛЬКО spankbang)
                    ↓
           целевые сайты (Pornhub, HellPorno, Xnxx, Spankbang, ...)
```

`buildProxyUrl()` роутит по hostname (приоритет: Val.town → PROXY_URL_3 → VPS → CF):
- **Val.town** — spankbang (CF-челлендж проходит только чистый IP Val.town; VPS/CF датацентр → 403).
- **VPS** (`PROXY_URL_2_HOSTS` + регексы `*.bigcdn.cc` / `*.pornone.com` / `*.youjizz.com` / `*.cdntrex.com`) —
  xnxx, youjizz, tizam, eporner, hqporner, pornone, porntrex, mydaddy, perfektdamen.
- **CF Worker** — всё остальное (pornhub идёт через CF + residential SOCKS5).

> **Изменения:** Deno Deploy (бывший PROXY_URL_2) выведен 2026-06-06 → VPS (квота Deno умирала на видео).
> spankbang переведён с VPS на Val.town 2026-06-08 (датацентр-IP ловит CF «Just a moment»).
> На Android есть доп. слой `_ANDROID_FORCE_PROXY` (см. docs/CHERRY.md → Android fetch model).

---

## 1. Плагин (`plugin.js`)

**Репо:** `d:\Works\Lampa\plugin-release\` → GitHub: `aawersom/cherry-plugin`  
**URL плагина:** `https://aawersom.github.io/cherry-plugin/plugin.js`

### Деплой

```powershell
# 1. Скопировать новый plugin.js
cp d:\Works\Lampa\plugin.js d:\Works\Lampa\plugin-release\plugin.js

# 2. Закоммитить и запушить
cd d:\Works\Lampa\plugin-release
git add plugin.js
git commit -m "fix: <описание>"
git push origin main
```

GitHub Pages деплоится автоматически через ~1 минуту после пуша.

### Проверка

```powershell
# Обновить URL с новым timestamp (иначе кэш):
curl "https://aawersom.github.io/cherry-plugin/plugin.js?t=$(Get-Date -UFormat %s)" -o $null -w "%{http_code}"
# Ожидаем: 200
```

---

## 2. Cloudflare Worker (`cherry-proxy`) — основной прокси

**Репо:** `d:\Works\Lampa\workers\cherry-proxy\` → GitHub: `aawersom/cherry-proxy`  
**URL воркера:** `https://cherry-proxy.aawersom.workers.dev`

> **Важно:** `wrangler deploy` деплоит локальный файл `src/index.js` напрямую на Cloudflare.  
> Пуш на GitHub — отдельная операция (для истории и бэкапа).

### Деплой

```powershell
cd d:\Works\Lampa\workers\cherry-proxy

# Деплой на Cloudflare
npx wrangler deploy

# Запушить изменения на GitHub (отдельно)
git add src/index.js
git commit -m "fix: <описание>"
git push origin main
```

### Первичная настройка секрета (один раз)

```powershell
cd d:\Works\Lampa\workers\cherry-proxy
npx wrangler secret put PROXY_KEY
# Введёт промпт — вставить ключ
```

> `PROXY_KEY` должен совпадать с тем, что прописан в `plugin.js` в переменной `PROXY_KEY`.

### Проверка

```powershell
# Проверить статус деплоев
cd d:\Works\Lampa\workers\cherry-proxy
npx wrangler deployments list

# Тест запроса через воркер (подставить реальный ключ)
curl "https://cherry-proxy.aawersom.workers.dev/proxy?url=https://example.com&key=ТВОЙ_КЛЮЧ"
```

### Локальная разработка

```powershell
cd d:\Works\Lampa\workers\cherry-proxy
npx wrangler dev
# Worker поднимается на http://localhost:8787
```

---

## 3. VPS-прокси (`PROXY_URL_2`) — вторичный прокси (заменил Deno Deploy)

**Сервер:** `185.36.141.21` (Ubuntu, стабильный IP, безлимит) · **URL:** `https://185-36-141-21.sslip.io`  
**Код:** `workers/cherry-proxy-deno/main.js` (Deno-скрипт) → на VPS `/opt/cherry-proxy/main.js`  
**Стек:** systemd `cherry-proxy.service` (Deno, `127.0.0.1:8787`) за Caddy/TLS (sslip.io). Доступы — в локальном vault.

> На VPS также крутится VPN (AmneziaWG, Docker) — **не трогать**. Прокси добавлен на свободных
> портах (80/443 Caddy, 8787 localhost). VPS→CF failover встроен в плагин (`_hasProxyFailover`).

### Передеплой VPS-скрипта (через SSH/paramiko)

> 2026-09-05: задеплоена правка `main.js` — `rewriteM3u8(text, baseUrl, proxyOrigin, key, referer)` пробрасывает
> `&referer=` во все переписанные URL плейлиста (сегменты pornhub требуют Referer pornhub.com), а `proxyOrigin`
> строится как `https://` (`X-Forwarded-Proto`, за Caddy `request.url` был `http://` → лишний 308 на каждый
> сегмент). Бэкап на VPS: `/opt/cherry-proxy/main.js.bak-20260905-1430`. Деплой: paramiko (root, пароль из
> локального vault) → `cp` бэкап → sftp `main.js` → `systemctl restart cherry-proxy.service` → `is-active`.
>
> Cloudflare-воркер: OAuth-токен wrangler истёк 2026-06-17, non-interactive деплой невозможен без
> `wrangler login` в интерактивной сессии (или `CLOUDFLARE_API_TOKEN`). Residential-SOCKS5 пул в воркере
> мёртв (оба порта не отвечают); pornhub с него снят маршрутом на VPS, поэтому воркер пока не трогали.

```powershell
# Изменить workers/cherry-proxy-deno/main.js, затем по SSH:
#   scp на /opt/cherry-proxy/main.js → systemctl restart cherry-proxy.service
# (детали и креды — в ACCESS-vault.md; см. также docs/vps-migration-plan-2026-06-06.md)
```

### Проверка

```powershell
curl "https://185-36-141-21.sslip.io/proxy?url=https://example.com&key=1206"   # → 200 HTML
```

---

## 3b. Val.town (`PROXY_URL_VT`) — бесплатный прокси для spankbang

**Назначение:** spankbang сидит за Cloudflare-челленджем, который проходит только «чистый» IP
(как был у Deno). Бесплатный Val.town HTTP-val его проходит. **Только лёгкий листинг** (видео — мимо).

**Код:** `workers/cherry-proxy-valtown/main.ts` · **val:** `cherryproxy` (public, файл main.tsx type=http)  
**Endpoint:** `https://aawersom--0d56e6a4635611f1a1321607ee4eb77e.web.val.run` (= `PROXY_URL_VT`)  
**Лимиты:** free tier 100k запусков/день (листинг = десятки/день → запас в тысячи раз).

### Передеплой через Val.town API (токен в vault)

```powershell
# Обновить файл main.tsx у val'а cherryproxy через v2 API:
#   PUT https://api.val.town/v2/vals/{valId}/files?path=main.tsx  { content, type:"http" }
#   (Authorization: Bearer <write-токен из ACCESS-vault.md>)
# v1 API закрыт (read-only); создание/правка — только v2. Приватных val'ов лимит → создавать public.
```

### Проверка

```powershell
curl "https://aawersom--0d56e6a4635611f1a1321607ee4eb77e.web.val.run/proxy?url=https://ru.spankbang.com/s/milf/1/&key=1206"
# Ожидаем: 200, есть class="video-item" (НЕ "Just a moment")
```

---

## 4. Тесты перед деплоем

```powershell
cd d:\Works\Lampa
npx vitest run
# Ожидаем: ~463 теста, все зелёные (5 файлов: plugin-helpers, worker-utils,
#                                    cherry-engine, cherry-stream-fix, cherry-ux-v2)
```

---

## Типичный цикл правки

```
1. Правка  →  d:\Works\Lampa\plugin.js
2. Тесты   →  npx vitest run  (~463 должны быть green)
3. Синк    →  cp plugin.js plugin-release\plugin.js
4. Пуш     →  cd plugin-release && git add . && git commit -m "..." && git push
5. Если менялся CF воркер (src/index.js):
              cd workers\cherry-proxy && npx wrangler deploy && git add . && git commit && git push
6. Если менялся Deno прокси (deno.js):
              cd workers\cherry-proxy && git add deno.js && git commit && git push
              (Deno Deploy задеплоится автоматически)
```

---

## Что НЕ деплоится автоматически

- Основной репо `d:\Works\Lampa` — **без remote**, только локальная история.  
  Если нужен бэкап — создать репо на GitHub и добавить: `git remote add origin <url>`
- CI/CD пайплайнов нет — всё ручной деплой.
