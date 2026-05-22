# Lampa — Документация

Lampa — open-source Smart TV медиафронтенд (GPL-2.0). Статическое SPA на чистом JavaScript, без бэкенда. Работает в браузере, LG WebOS, Samsung Tizen, Android TV, MSX.

## Репозитории

| Репозиторий | Назначение |
|---|---|
| [yumata/lampa](https://github.com/yumata/lampa) | Скомпилированный dist (готов к деплою) |
| [yumata/lampa-source](https://github.com/yumata/lampa-source) | Исходный код для разработки |
| [yumata/lampa-lite](https://github.com/yumata/lampa-lite) | Облегчённая версия |
| [lampa-app/LAMPA](https://github.com/lampa-app/LAMPA/releases) | Android APK |
| [immisterio/Lampac](https://github.com/immisterio/Lampac) | Бэкенд-агрегатор стримов |
| [lampac-nextgen/lampac](https://github.com/lampac-nextgen/lampac) | Форк Lampac (активно поддерживается) |

## Официальные URL

- **Веб-приложение:** http://lampa.mx / http://lampa.app
- **Cloudflare mirror:** http://cf.lampa.mx
- **Telegram канал:** @lampa_channel (28.9K участников)
- **Telegram чат:** @lampa_group
- **Плагины:** @lampa_plugins
- **Синхронизация:** https://cub.watch
- **4PDA тред:** https://4pda.to/forum/index.php?showtopic=1084306
- **DeepWiki API:** https://deepwiki.com/yumata/lampa-source

## Документация

- [ARCHITECTURE.md](./ARCHITECTURE.md) — архитектура, стек, устройство кода
- [PLUGINS.md](./PLUGINS.md) — разработка плагинов, полный API справочник
- [CONTENT.md](./CONTENT.md) — источники контента, каталог, торренты
- [DEPLOY.md](./DEPLOY.md) — деплой, самохостинг, конфигурация

## Быстрый старт (разработка)

```bash
git clone https://github.com/yumata/lampa-source.git
cd lampa-source
npm install
npm start          # http://localhost:3000 с livereload
npm test           # vitest
npm run doc        # JSDoc → build/doc/index.html
```

## Стек технологий

- **JS:** ES6+, без фреймворка, jQuery только в shell
- **CSS:** SCSS → app.min.css
- **Build:** Gulp 4 + Rollup + Babel + BrowserSync
- **Тесты:** Vitest
- **Видео:** HTMLVideoElement + hls.js (HLS) + dash.js (DASH)
