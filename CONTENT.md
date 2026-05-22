# Lampa — Источники контента и каталог

## Архитектура контента

Три независимых pipeline:

```
[Lampa SPA]
    │
    ├── Pipeline A: Метаданные/каталог
    │       └── Lampa.Api.sources { tmdb (default), cub }
    │               └── api.themoviedb.org/3/ (key: 4ef0d7355d9ffb5151e987764708ce96)
    │
    ├── Pipeline B: Online стриминг
    │       └── plugins/online/ → балансеры
    │               ├── VideoCDN, HDRezka, Kinobase, Collaps, CDNMovies, Filmix
    │               └── Lampac (self-hosted, 70+ источников)
    │
    └── Pipeline C: Торренты
            └── TorrServer + Jackett/Prowlarr/Jacred
```

## Модель данных карточки

Поля объекта фильма/сериала (extends TMDB API response):

```typescript
interface LampaCard {
    // Идентификация
    id: number;                  // TMDB ID
    media_type: 'movie' | 'tv';
    source: string;              // 'tmdb' | 'cub' | 'kp' | ...

    // Отображение
    title: string;               // Локализованное название (фильмы)
    name: string;                // Локализованное название (сериалы)
    original_title: string;
    original_name: string;
    tagline: string;
    overview: string;
    poster_path: string;         // TMDB относительный путь (/abc.jpg)
    backdrop_path: string;
    background_image?: string;   // Альтернативный фон

    // Рейтинги
    vote_average: number;        // TMDB (0–10)
    vote_count: number;
    imdb_rating?: number;        // добавляется Lampa/CUB
    kp_rating?: number;          // добавляется плагинами
    quality?: string;            // '4K' | '1080p' | ...

    // Даты
    release_date: string;        // 'YYYY-MM-DD' (фильмы)
    first_air_date: string;      // 'YYYY-MM-DD' (сериалы)
    next_episode_to_air?: { air_date: string };

    // Классификация
    genres: Array<{ id: number; name: string }>;
    keywords: Array<{ id: number; name: string }>;
    adult: boolean;
    lgbt?: boolean;              // Lampa-специфичный флаг
    blocked?: boolean;

    // Длительность
    runtime?: number;            // минуты (фильмы)
    number_of_seasons?: number;
    number_of_episodes?: number;
    status?: string;             // 'Returning Series' | 'Ended' | ...

    // Связи
    collection?: object;
    recommendations?: { results: LampaCard[] };
    similar?: { results: LampaCard[] };
    persons?: Array<{ name, job, department, profile_path, character }>;
    external_ids?: { imdb_id: string; tvdb_id: string };

    // Вычисляется Lampa
    img?: string;                // полный URL постера
}
```

## TMDB интеграция

**API ключ (встроен в исходники):** `4ef0d7355d9ffb5151e987764708ce96`

Все запросы идут на `api.themoviedb.org/3/`. Изображения: `image.tmdb.org/t/p/`.

Прокси (storage keys): `proxy_tmdb`, `tmdb_proxy_api`, `tmdb_proxy_image`

| Назначение | Endpoint |
|---|---|
| Сейчас в кино | `movie/now_playing` |
| Популярные | `movie/popular`, `tv/top_rated` |
| Тренды | `trending/movie/day`, `trending/tv/week` |
| Скоро | `movie/upcoming` |
| Поиск | `search/movie`, `search/tv`, `search/person` |
| Детали | `{type}/{id}?append_to_response=content_ratings,release_dates,external_ids,keywords,alternative_titles` |
| Сезон | `tv/{id}/season/{season}` |
| Рекомендации | `{type}/{id}/recommendations` |
| Видео/трейлеры | `{type}/{id}/videos` |
| Коллекция | `collection/{id}` |

## Регистрация кастомного источника контента

```javascript
(function () {
    if (window.my_source_loaded) return;
    window.my_source_loaded = true;

    const SOURCE_NAME = 'mysource';

    const MySource = {
        SOURCE_NAME,

        // Главный экран — массив строк с карточками
        main(params, oncomplite, onerror) {
            fetch('https://my-api.example.com/popular')
                .then(r => r.json())
                .then(data => {
                    oncomplite([{
                        title:       'Популярное',
                        results:     data.items.map(convertCard),
                        url:         'popular',
                        page:        params.page || 1,
                        total_pages: data.total_pages
                    }]);
                })
                .catch(onerror);
        },

        // Страница деталей фильма
        full(params, oncomplite, onerror) {
            var id = params.id;
            fetch(`https://my-api.example.com/movie/${id}`)
                .then(r => r.json())
                .then(data => oncomplite(convertCard(data)))
                .catch(onerror);
        },

        // Поиск
        search(params, oncomplite, onerror) {
            // params.query — строка поиска
            fetch(`https://my-api.example.com/search?q=${encodeURIComponent(params.query)}`)
                .then(r => r.json())
                .then(data => oncomplite({ results: data.items.map(convertCard), total_results: data.total }))
                .catch(onerror);
        },

        category(params, oncomplite, onerror) { /* ... */ },
        list(params, oncomplite, onerror)     { /* ... */ },
        person(params, oncomplite, onerror)   { /* ... */ },

        // Участие в глобальном поиске
        discovery() {
            return {
                title: 'My Source',
                search: (params, oncomplite) => { /* ... */ },
                onCancel: () => {},
                params: { lazy: true, save: true }
            };
        }
    };

    function convertCard(item) {
        return {
            id:             item.tmdb_id || item.id,
            media_type:     item.type === 'series' ? 'tv' : 'movie',
            title:          item.title_ru || item.title_en,
            original_title: item.title_en,
            vote_average:   item.rating || 0,
            release_date:   item.year + '-01-01',
            poster_path:    item.poster,   // может быть полный URL
            source:         SOURCE_NAME
        };
    }

    // Инжектировать в реестр источников
    Lampa.Api.sources[SOURCE_NAME] = MySource;

    // Защита от перезаписи
    Object.defineProperty(Lampa.Api.sources, SOURCE_NAME, {
        get: () => MySource
    });

    // Добавить в настройки выбора источника
    Lampa.Params.select('source', {
        tmdb:       'TMDB',
        cub:        'CUB',
        [SOURCE_NAME]: 'My Source'
    }, 'tmdb');

    if (window.appready) init();
    else Lampa.Listener.follow('app', e => { if (e.type === 'ready') init(); });

    function init() {
        // Регистрация — уже сделана выше, доп. инициализация если нужна
    }
})();
```

## Добавить строку на главный экран

```javascript
Lampa.ContentRows.add({
    name:   'my_feed',           // уникальный ключ (для toggle в настройках)
    title:  'Моя лента',
    screen: 'main',
    index:  2,                   // позиция вставки
    call: function (params, oncomplite) {
        loadMyFeed(params.page || 1, function (data) {
            oncomplite([{
                title:       'Моя лента',
                results:     data.items,
                url:         'my_feed',
                page:        data.page,
                total_pages: data.total_pages
            }]);
        });
    }
});
```

## TorrServer — торрент-стриминг

### REST API

```
POST   {host}/torrents              { action: "add", link: "magnet:?..." }
GET    {host}/torrents/{hash}       — статус торрента, список файлов
GET    {host}/cache?link={hash}     — состояние буфера
DELETE {host}/torrents              { action: "rem", hash: "..." }
```

### Stream URL

```
{host}/stream/{url_encoded_filename}?link={infohash}&index={file_id}&play
```

### Пример: запустить торрент

```javascript
// 1. Добавить торрент
Lampa.Storage.set('torrserver_url', 'http://localhost:8090');

// 2. Использовать встроенный модуль
// Lampa.Activity.push({ component: 'torrents', movie: cardData })
// Пользователь выбирает → Torrent.start(element, movie)
// → TorrServer API → Player.play({ url: streamUrl })
```

## Lampac — бэкенд агрегатор

Lampac (порт 9118) решает проблему CORS и агрегирует 70+ источников.

### Эндпоинты

| URL | Назначение |
|---|---|
| `/online.js` | Установить плагин агрегатора в Lampa |
| `/lite/{provider}` | Ответ конкретного провайдера |
| `/tmdb` | TMDB прокси |
| `/externalids?id={tmdb_id}` | Кросс-маппинг TMDB↔KP↔IMDB |

### Категории провайдеров

| Категория | Количество | Примеры |
|---|---|---|
| OnlineRUS | 21 | Rezka, Filmix, Kinobase, Videocdn |
| OnlinePaid | 9 | KinoPub, Kodik |
| OnlineAnime | 12 | — |
| OnlineENG | 10 | — |
| OnlineUKR | 8 | — |

## Поиск

`Lampa.Api.search()` фанаутится на активный источник.

TMDB параллельно запрашивает: `search/movie` + `search/tv` + `search/person`.

Торрент-поиск (включается настройкой `parse_in_search`):
- Jackett: `GET /api/v2.0/indexers/all/results?Query={q}&Categories[]=2000`
- Prowlarr: `GET /api/v1/search?query={q}&categories[]=2000`
- Дедупликация по `MagnetUri` / `downloadUrl` / hash
- Топ-20 результатов по сидам

## 4 уровня интеграции контента

| Уровень | API | Что даёт |
|---|---|---|
| **1. Строка** | `Lampa.ContentRows.add()` | Ряд на главном экране |
| **2. Компонент** | `Lampa.Component.add()` + `Activity.push()` | Полноэкранный экран |
| **3. Источник каталога** | `Lampa.Api.sources['name'] = source` | Заменяет TMDB во всех экранах |
| **4. Балансер стримов** | Класс по образцу `videocdn.js` | Добавляет источник стримов на странице фильма |

## Внешние API вызовы Lampa

| Хост | Назначение | Прокси-поддержка |
|---|---|---|
| `api.themoviedb.org` | Метаданные и каталог | `proxy_tmdb` |
| `image.tmdb.org` | Постеры и фоны | `tmdb_proxy_image` |
| `cub.rip/api/` | CUB альтернативный каталог | — |
| `{torrserver}:8090/` | Торрент-стриминг | — |
| `{jackett}/api/v2.0/` | Поиск торрентов | — |
| `{lampac}:9118/` | Агрегация стримов + CORS прокси | встроен в Lampac |
