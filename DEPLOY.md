# Lampa — Деплой и конфигурация

## Архитектура стека

```
[Lampa SPA] ──настройки──> [CUB (cub.watch)] или [self-hosted sync]
      │
      ├──плагин──> [Lampac :9118]
      │                  └──> 70+ стриминг-источников (CORS прокси)
      │                  └──> KinoPub (токен в init.conf)
      │                  └──> TorrServer
      │
      └──торрент──> [TorrServer :8090] ──> [Jackett/Jacred/Prowlarr]
```

**Минимальный рабочий стек:**
1. nginx → `yumata/lampa` статика
2. Lampac (Docker) на порту 9118, настроенный `init.conf`
3. TorrServer для торрентов
4. Jacred как индексатор торрентов
5. CUB аккаунт (cub.watch) или self-hosted sync

## Вариант A: Простой nginx (только фронтенд)

```bash
git clone https://github.com/yumata/lampa.git /var/www/lampa
```

```nginx
server {
    listen 80;
    server_name lampa.yourdomain.com;
    root /var/www/lampa;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

После клонирования обязательно: заменить `{domain}` в `msx/start.json` на реальный домен/IP.

## Вариант B: serezhia/lampa_selfhosted (Docker Compose, full stack)

Репозиторий: https://github.com/serezhia/lampa_selfhosted

**Включает:**
- Lampa frontend контейнер
- Dart Frog бэкенд (синхронизация закладок/профилей/истории)
- nginx reverse proxy + Let's Encrypt
- TorrServer интеграция
- Telegram Bot для управления устройствами
- Hot-reload плагинов из `data/plugins/` без перестройки контейнера

```bash
git clone https://github.com/serezhia/lampa_selfhosted
cd lampa_selfhosted
# Положить свои плагины в data/plugins/
docker-compose up -d --build
docker-compose logs -f

# HTTPS:
./init-letsencrypt.sh

# Перезапустить фронтенд после изменения плагинов:
docker compose restart lampa-frontend
```

## Вариант C: dhvcc/lampa-stack (JWT защита)

Репозиторий: https://github.com/dhvcc/lampa-stack  
Документация: https://dhvcc.github.io/lampa-stack/

**Включает:**
- Lampa frontend с кастомными патчами
- TorrServer глубокая интеграция
- qBittorrent интеграция (запуск загрузок прямо из Lampa)
- nginx с JWT аутентификацией для TorrServer, qBittorrent, Lampac
- Автоматический парсер торрентов
- Встроенный набор плагинов

```bash
git clone https://github.com/dhvcc/lampa-stack
cd lampa-stack
docker compose up
./add_user.sh       # добавить пользователей
```

> **Примечание:** Предназначен для локальной сети. Не рекомендуется выставлять в интернет без понимания последствий. Задайте статический LAN IP.

## Lampac — бэкенд агрегатор стримов

Отдельный проект, обязательный для онлайн-стриминга. Агрегирует 70+ источников, решает CORS.

**Два форка:**
- `immisterio/Lampac` — оригинал
- `lampac-nextgen/lampac` — активно поддерживаемый форк (2025-2026)

### Docker Compose (минимальный)

```yaml
services:
  lampac:
    image: ghcr.io/lampac-nextgen/lampac
    ports:
      - "9118:9118"
    shm_size: 1024mb
    volumes:
      - ./passwd:/app/passwd
      - ./init.conf:/app/init.conf
      - ./lampainit.js:/app/lampainit.js
```

```bash
docker compose up -d
```

### Конфигурация `init.conf` (hot-reload без перезапуска)

```json
{
  "port": 9118,
  "serverproxy": {
    "enable": true
  },
  "KinoPub": {
    "enable": true,
    "token": "YOUR_KINOPUB_TOKEN"
  },
  "Rezka": {
    "enable": true
  },
  "Filmix": {
    "enable": true
  }
}
```

Каждый провайдер: блок с `enable`, `token`, `host`, `priority`.  
`example.init.conf` в репозитории — все возможные опции.

### Подключить Lampac к Lampa

1. В настройках Lampa указать адрес Lampac: `http://your-server:9118`
2. Установить плагин: Настройки → Расширения → Добавить плагин → `http://your-server:9118/online.js`

## Конфигурация Lampa

### Нет settings.json

У Lampa нет файла конфигурации в традиционном смысле. Все настройки:
- **`msx/start.json`** — заменить `{domain}` после клонирования
- **В приложении (UI)** — Settings > ... (сохраняются в localStorage устройства)
- **Плагины** — расширяют функционал через URL

### Ключевые настройки в UI

| Настройка | Описание |
|---|---|
| Основной источник | TMDB (default), IVI, OKKO |
| Адрес TorrServer | `http://IP:8090` |
| Парсер | Jackett/Jacred адрес (`jacred.xyz` или `jacred.pro`) |
| Адрес Lampac | `http://your-server:9118` |
| Прокси TMDB | `proxy_tmdb`, `tmdb_proxy_api` |
| Синхронизация | CUB аккаунт или self-hosted |

### Storage keys (программный доступ)

```javascript
Lampa.Storage.get('source', 'tmdb')           // активный источник каталога
Lampa.Storage.get('torrserver_url', '')        // адрес TorrServer
Lampa.Storage.get('online_balanser', 'videocdn') // активный балансер онлайн
Lampa.Storage.get('proxy_tmdb', false)         // включить прокси TMDB
```

## CORS — решение проблемы

Lampa — браузерное SPA, внешние источники часто блокируют CORS-запросы.

### Решение 1: Встроенный прокси Lampac (рекомендуется)

В `init.conf`:
```json
"serverproxy": { "enable": true }
```
Доступен на `http://your-server:9118/proxy`. Настроить Lampa указывать через него.

### Решение 2: nginx CORS заголовки

```nginx
add_header 'Access-Control-Allow-Origin' '*';
add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS';
```

### GitHub Pages / Cloudflare Pages

GitHub Pages не поддерживает кастомные CORS заголовки.  
Обходные пути: Cloudflare Workers или Netlify `_headers` файл.

**Рекомендуемый паттерн:** самохостинг Lampac на том же сервере что и Lampa, CORS-проблем не возникает внутри стека.

## Синхронизация (закладки, история, профили)

### CUB (официальный облачный сервис)

- Регистрация: https://cub.watch
- Telegram канал: @cub_watch
- Бесплатный тариф: базовая синхронизация
- Платный тариф: множественные профили, полная синхронизация тайм-кода

### Self-hosted без CUB

- **serezhia/lampa_selfhosted** — включает Dart Frog sync сервер
- **Lampa UNCENSORED** — форк без зависимости от CUB: https://tv-ch.ru/lampa-uncensored-with-an-alternative-plugin-store/
- **my.bylampa.online** — альтернативный sync, регистрация через @bylampa_sync_bot

## Версии и каналы

| Проект | Версия | Канал |
|---|---|---|
| Lampa frontend | v1.4.1 | `main` branch = release |
| Lampac NextGen | 1.5.0-dev1 (май 2025) | `lampac-nextgen/lampac` |
| Lampa Lite | параллельно с основной | `yumata/lampa-lite` |

## Сообщество

| Ресурс | Тип | Описание |
|---|---|---|
| @lampa_channel | Telegram канал | Официальный, 28.9K участников |
| @lampa_group | Telegram чат | Общее обсуждение (все платформы) |
| @lampa_android | Telegram чат | Android-специфично |
| @lampa_plugins | Telegram канал | Плагины и анонсы |
| @cub_watch | Telegram канал | CUB сервер |
| 4PDA основной тред | Форум | https://4pda.to/forum/index.php?showtopic=1084306 |
| 4PDA клуб | Форум | https://4pda.to/forum/index.php?showtopic=1085044 |
| tv-ch.ru | Сайт | Гайды, плагины, обзоры (актуальные 2025-2026) |
| lampa.nnslvp.io | Сайт | Каталог плагинов, FAQ |
