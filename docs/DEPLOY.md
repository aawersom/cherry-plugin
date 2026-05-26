# Cherry Plugin — Инструкция по деплою

## Архитектура: два компонента

```
plugin.js  →  GitHub Pages (cherry-plugin)  →  пользователь в Lampa
                    ↓
           PROXY_URL = https://cherry-proxy.aawersom.workers.dev
                    ↓
           Cloudflare Worker (cherry-proxy)
                    ↓
           целевые сайты (Pornhub, HellPorno, ...)
```

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

## 2. Cloudflare Worker (`cherry-proxy`)

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

## 3. Тесты перед деплоем

```powershell
cd d:\Works\Lampa
npx vitest run
# Ожидаем: 51 тестов, все зелёные
```

---

## Типичный цикл правки

```
1. Правка  →  d:\Works\Lampa\plugin.js
2. Тесты   →  npx vitest run  (51 должны быть green)
3. Синк    →  cp plugin.js plugin-release\plugin.js
4. Пуш     →  cd plugin-release && git add . && git commit -m "..." && git push
5. Если менялся воркер:
              cd workers\cherry-proxy && npx wrangler deploy && git add . && git commit && git push
```

---

## Что НЕ деплоится автоматически

- Основной репо `d:\Works\Lampa` — **без remote**, только локальная история.  
  Если нужен бэкап — создать репо на GitHub и добавить: `git remote add origin <url>`
- CI/CD пайплайнов нет — всё ручной деплой.
