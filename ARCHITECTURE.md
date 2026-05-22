# Lampa — Архитектура

## Структура исходного кода

```
lampa-source/
├── src/
│   ├── index.js                    # Entry point (Rollup entry)
│   ├── core/
│   │   ├── component.js            # Реестр компонентов (add/create)
│   │   ├── controller.js           # Диспетчер фокуса (TV-пульт/клавиатура)
│   │   ├── content_rows.js         # Реестр строк главного экрана
│   │   ├── plugins.js              # Загрузчик плагинов (script inject)
│   │   ├── manifest.js             # Манифест приложения
│   │   ├── lang.js                 # i18n
│   │   ├── storage/
│   │   │   └── storage.js          # 3-уровневое хранилище
│   │   └── api/
│   │       ├── api.js              # Фасад API, источники контента
│   │       └── sources/
│   │           ├── tmdb.js         # TMDB источник
│   │           ├── cub.js          # CUB источник
│   │           ├── parser.js       # Поиск торрентов (Jackett/Prowlarr)
│   │           └── ai.js           # AI поиск (CUB)
│   ├── interaction/
│   │   ├── activity/
│   │   │   ├── activity.js         # Стек экранов (центральный роутер)
│   │   │   └── slide.js            # ActivitySlide — lifecycle wrapper
│   │   ├── player/
│   │   │   ├── video.js            # HTMLVideoElement + hls.js/dash.js
│   │   │   ├── panel.js            # UI панель плеера
│   │   │   ├── playlist.js         # Плейлист эпизодов
│   │   │   └── subs.js             # Субтитры (subsrt)
│   │   ├── torrent.js              # Торрент-поток: выбор файла, preload
│   │   ├── torserver.js            # TorrServer REST API клиент
│   │   ├── modal.js                # Модальные диалоги
│   │   ├── noty.js                 # Toast уведомления
│   │   ├── template.js             # Реестр HTML-шаблонов
│   │   ├── select.js               # Выпадающие списки
│   │   ├── player.js               # Фасад плеера
│   │   └── settings/
│   │       ├── api.js              # addComponent / addParam
│   │       └── params.js           # select / trigger / bind
│   ├── components/
│   │   ├── main.js                 # Главный экран
│   │   ├── full.js                 # Страница фильма/сериала
│   │   │   └── full/
│   │   │       ├── start.js        # Hero: постер, рейтинги, кнопки
│   │   │       ├── description.js  # Описание
│   │   │       ├── persons.js      # Актёры и создатели
│   │   │       ├── cards.js        # Похожие/рекомендации
│   │   │       └── episodes.js     # Эпизоды сериала
│   │   ├── category.js             # Категория/список
│   │   ├── torrents.js             # Список торрентов
│   │   └── feed.js                 # Лента (CUB)
│   ├── utils/
│   │   └── reguest.js              # HTTP клиент (Lampa.Reguest)
│   └── sass/                       # SCSS источники
└── plugins/
    └── online/
        ├── component.js            # Online plugin: Activity + Controller
        ├── videocdn.js             # Балансер VideoCDN
        ├── rezka.js                # Балансер HDRezka
        ├── kinobase.js             # Балансер Kinobase
        ├── collaps.js              # Балансер Collaps
        ├── cdnmovies.js            # Балансер CDNMovies
        └── filmix.js               # Балансер Filmix
```

## `window.Lampa` — глобальное пространство имён

Собирается в `src/index.js`, экспонирует 80+ модулей:

### Навигация и компоненты
| Объект | Назначение |
|---|---|
| `Lampa.Activity` | Стек экранов: `push`, `backward`, `replace`, `active`, `own` |
| `Lampa.Component` | Реестр: `add(name, Ctor)`, `create(obj)` |
| `Lampa.Controller` | TV-навигация: `add`, `toggle`, `collectionSet`, `collectionFocus` |
| `Lampa.Router` | URL-based маршрутизация |

### UI
| Объект | Назначение |
|---|---|
| `Lampa.Template` | HTML-шаблоны: `add(name, html)`, `get(name, vars)` |
| `Lampa.Modal` | Модальные диалоги: `open`, `close`, `update` |
| `Lampa.Select` | Выпадающие списки |
| `Lampa.Noty` | Toast уведомления: `show(text, opts)` |
| `Lampa.Menu` | Боковое меню: `addButton`, `addElement` |
| `Lampa.Head` | Верхняя навигация |
| `Lampa.Scroll` | TV-оптимизированный скролл |
| `Lampa.Layer` | Управление слоями/масштабированием |

### События
| Объект | Назначение |
|---|---|
| `Lampa.Listener` | Глобальная шина событий: `follow(event, fn)`, `send(event, data)` |
| `Lampa.Subscribe` | Фабрика локальных шин событий |

### Хранилище
| Объект | Назначение |
|---|---|
| `Lampa.Storage` | KV-хранилище: `get`, `set`, `field`, `cache`, `add` |
| `Lampa.Favorite` | Закладки/избранное |
| `Lampa.Timeline` | Прогресс просмотра |

### Контент и API
| Объект | Назначение |
|---|---|
| `Lampa.Api` | Фасад источников: `sources`, `main`, `search`, `full` |
| `Lampa.TMDB` | TMDB утилиты |
| `Lampa.Parser` | Конфигурация парсера/прокси |
| `Lampa.ContentRows` | Строки главного экрана |

### Плеер
| Объект | Назначение |
|---|---|
| `Lampa.Player` | Фасад плеера: `play`, `playlist`, `subtitles` |
| `Lampa.PlayerVideo` | HTMLVideoElement обёртка |
| `Lampa.PlayerPanel` | UI панель плеера |

### Настройки
| Объект | Назначение |
|---|---|
| `Lampa.Settings` | Панель настроек: `addComponent`, `addParam` |
| `Lampa.SettingsApi` | Устаревший: `addParam` (v2) |
| `Lampa.Params` | Низкоуровневые параметры: `select`, `trigger` |

### Платформа
| Объект | Назначение |
|---|---|
| `Lampa.Platform` | Определение платформы: `is('webos')`, `is('android')` |
| `Lampa.Lang` | i18n: `add({key:{ru,en}})`, `translate(key)` |
| `Lampa.Reguest` | HTTP клиент (класс, создавать через `new`) |

## Навигационная система

Lampa использует **стек Activity**, не URL-роутер:

```javascript
Lampa.Activity.push({
    component: 'full',      // зарегистрированный компонент
    title: 'Название',
    id: movieId,
    page: 1
});

Lampa.Activity.backward();   // назад
Lampa.Activity.active();     // текущий Activity объект
Lampa.Activity.own(comp);    // проверить, активен ли компонент
```

## Жизненный цикл компонента

```
Component.create(activity)
    → new ComponentClass(activity)  // конструктор
    → component.create()            // строит DOM, возвращает корневой элемент
    → component.start()             // регистрирует Controller, устанавливает фокус
    ↓ (другой экран поверх)
    → component.pause()             // теряет фокус
    → component.stop()              // глубокая заморозка
    ↓ (пользователь уходит)
    → component.destroy()           // удаляет DOM, отменяет запросы
```

## Система событий

```javascript
// Глобальная шина
Lampa.Listener.follow('app', (e) => {
    if (e.type === 'ready') { /* приложение готово */ }
});

Lampa.Listener.follow('full', (e) => {
    if (e.type === 'complite') { /* страница фильма загружена */ }
    if (e.type === 'destroy')  { /* страница фильма закрыта */ }
});

// Локальная шина (в компоненте)
var listener = Lampa.Subscribe();
listener.follow('loaded', (e) => renderData(e.data));
listener.send('loaded', { data: result });
listener.destroy(); // в destroy()
```

### Ключевые события

| Событие | `e.type` | Когда |
|---|---|---|
| `app` | `ready` | Приложение полностью инициализировано |
| `full` | `complite` | Страница фильма отрендерена |
| `full` | `destroy` | Страница фильма закрыта |
| `player` | `start` | Плеер открыт |
| `player` | `destroy` | Плеер закрыт |
| `storage` | `change` | Изменилось значение в хранилище |

## Плеер

### Поддерживаемые движки

| Движок | Протокол | Условие |
|---|---|---|
| Native `<video>` | MP4, WebM, native HLS | Apple/WebOS/Tizen |
| hls.js | HLS (.m3u8) | Браузер, Android |
| dash.js | MPEG-DASH (.mpd) | DASH стримы |
| TorrServer HTTP | HLS/MP4 через `/stream/` | Торренты |
| Platform native | Платформо-специфичный | WebOS системный плеер |

### TorrServer URL

```
{host}/stream/{url_encoded_filename}?link={infohash}&index={file_id}&play
```

## Хранилище (`Lampa.Storage`)

3 уровня, прозрачно для вызывающего кода:
1. **Memory** — быстрый, сессионный
2. **localStorage** — основное персистентное хранилище  
3. **IndexedDB** — fallback при переполнении localStorage

```javascript
Lampa.Storage.set('key', value);
Lampa.Storage.get('key', defaultValue);
Lampa.Storage.cache('key', maxItems, []);  // FIFO массив с ограничением
Lampa.Storage.add('key', item);            // добавить в массив без дубликатов
```

## Система плагинов

Плагины загружаются через динамический `<script>` inject:
1. `Plugins.task()` — скачивает blacklist, фильтрует список
2. `Plugins.load()` — итерирует плагины
3. `Plugins.push(plug)` — проверяет blacklist, добавляет `<script async>`
4. Кэш в localStorage для оффлайн-fallback

**Blacklist блокирует:** `t.me/`, `4pda.`, `teletype.in`, IP-адреса

## Build System

```
npm start    → Gulp watch + BrowserSync (http://localhost:3000)
npm run debug → + sourcemaps
npm test     → vitest
npm run doc  → JSDoc → build/doc/index.html
```

**Pipeline:**
```
src/index.js → Rollup (ES modules) → Babel → dest/app.js
→ Gulp uglify → build/app.min.js

src/**/*.scss → Sass → Autoprefixer → cssnano → build/app.min.css
```

**Платформенные таргеты:** `gulp github`, `gulp webos`, `gulp tizen`
