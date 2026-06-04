# Cherry Plugin — Инструкция по деплою

## Архитектура: три компонента

```
plugin.js  →  GitHub Pages (cherry-plugin)  →  пользователь в Lampa
                    ↓
           PROXY_URL = https://cherry-proxy.aawersom.workers.dev   (основной)
           PROXY_URL_2 = https://cherry-proxy.aawersom.deno.net    (для xnxx/spankbang)
                    ↓
           Cloudflare Worker (cherry-proxy) / Deno Deploy (cherry-proxy)
                    ↓
           целевые сайты (Pornhub, HellPorno, Xnxx, ...)
```

`buildProxyUrl()` автоматически роутит запросы к хостам из `PROXY_URL_2_HOSTS` (xnxx, youjizz, tizam, eporner, ru.spankbang, pornone, porntrex, mydaddy, perfektdamen) и к `*.bigcdn.cc` / `*.pornone.com` через Deno Deploy, все остальные — через CF Worker.

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

## 3. Deno Deploy (`cherry-proxy`) — резервный прокси

**Репо:** `d:\Works\Lampa\workers\cherry-proxy\deno.js` → GitHub: `aawersom/cherry-proxy` (файл `deno.js`)  
**URL прокси:** `https://cherry-proxy.aawersom.deno.net`  
**Console:** `console.deno.com/aawersom` → Apps → cherry-proxy

> Deno Deploy деплоится автоматически при каждом пуше в `aawersom/cherry-proxy` (GitHub Integration).
> Отдельная команда `wrangler deploy` не нужна.

### Деплой (автоматический через GitHub)

```powershell
# Изменить deno.js в репо воркера
cd d:\Works\Lampa\workers\cherry-proxy
git add deno.js
git commit -m "fix: <описание>"
git push origin main
# Deno Deploy задеплоится автоматически через ~30 секунд
```

### Ручной передеплой (если нужно)

`console.deno.com/aawersom` → Apps → cherry-proxy → Overview → **Deploy Default Branch**

### Настройки (один раз)

- **Entrypoint:** `deno.js`
- **Env variable:** `PROXY_KEY = 1206` (тот же что у CF Worker)
- **Region:** All Regions (free tier: ord, ams)

### Проверка

```powershell
curl "https://cherry-proxy.aawersom.deno.net/proxy?url=https://example.com&key=1206"
# Ожидаем: HTML example.com (200)
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
