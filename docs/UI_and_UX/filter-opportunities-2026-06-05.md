# Cherry — фильтры/дискавери, что можно добавить по каналам (2026-06-05)

Глубокий разбор 24 агентами реального фильтр-UI каждого сайта vs что Cherry отдаёт сейчас.
Только URL-адресуемые механизмы (без JS/AJAX-only). Это план возможностей; код не менялся.

## Сквозные возможности (повторяются на многих каналах)

### 1. ⏱ Time-window сортировки («Топ за сегодня/неделю/месяц/год») — САМЫЙ частый и ценный
Сейчас у нас плоская «По популярности». Сайты дают популярность по периодам:
- **KVS-сайты** (xozilla, analdin, hellporno, pornve, crocotube, ebun, pornobolt): `video_viewed_today/_week/_month` + `rating_week/_month` — это просто доп. значения в `cfg.sorts`, движок уже шлёт `?sort_by=`. **Очень дёшево** (правка данных).
- **pornhub**: `&period=daily/weekly/monthly/yearly` к webmasters API. **Дёшево**.
- **xvideos**: `&datef=today/week/month/3month/6month` (на поиске) + `/best/{YYYY-MM}` архивы. 
- **pornone**: 4-сегментный URL `/{slug}/{sort}/{window}/{page}/`.
- **3movs/porntrex**: `most-viewed/{today,week,month}`, `top-rated/{...}` (path-сегмент).
- **youjizz**: `top-rated-week`, `top-rated-month`.
- **xnxx**: `hits`/`month`/`year` сабroutes поиска.

### 2. 👤 Просмотр по МОДЕЛИ/порнозвезде (новая ось дискавери)
У нас модель только у pornhub (и то без индекса). Сайты с индексом моделей + per-model листингом:
- crocotube (`/pornstars/`, 5331), ebun (`/models/{slug}/`), jopaonline (`/models/`), porndig (`/pornstars/{id}/`), pornobolt (`/aktrisy`→`/models/`), pornhub (`/pornstars` индекс — есть browseByModel, нет «Обзор моделей»), xvideos (`/pornstars-index`).
- Паттерн: добавить «Модели» в меню канала → индекс → per-model грид. **medium** (новый парс индекса; per-model часто = существующий card-парсер).

### 3. 🏢 Просмотр по СТУДИИ/каналу/паблику
- **24rolika** `/movie/` (40+ паблик-студий — уникальная фишка канала), perfektdamen `/channels/`, pornhub channels (HTML), xvideos `/channels-index`.

### 4. 🔎 Поиск — где сломан/отсутствует (это фикс-как-фича)
- **tizam**: поиск ЕСТЬ — `/search-results/?search_string=QUERY` (сейчас у нас `/?s=` 404 даёт мусор). **Добавить — твой пример!**
- **hqporner**: текущий `/search/{slug}/` 404; рабочий — `/?q={query}&p={N}`. **Фикс.**
- **lenporno**: рабочий путь `/search/{query}/?page={p}`. **Фикс.**
- **spankbang**: добавить `?o=`(сорт) `?d=`(длит.) `?q=`(качество) к `/s/`.

### 5. ⏳🎚 Фильтр длительности / качества (где сайт даёт)
- **xvideos поиск**: `&durf=` (1-3/3-10/10-20/20min+) + `&quality=hd/1080P`.
- **spankbang**: `?d=` длительность, `?q=` качество.
- **pornhub** (HTML-ветка): `min_duration/max_duration`, `hd=1`, `p=professional/homemade`.

### 6. 📂 Расширить таксономию категорий/тегов
- **pornhub** 40 → до 241 (живой `/webmasters/categories`).
- **hellporno** 37 → ~120 (`/categories/`).
- **eporner**: распаковать хардкод `gay=0` в фильтр (gay=0/1/2 — натурал/гей/транс).

## Топ-рекомендация по каждому каналу

| Канал | Главное к добавлению | Усилие |
|---|---|---|
| pornhub | `period=` time-window + категории 40→241; убрать мёртвый сорт `longest` | easy |
| xvideos | sort+durf+quality+datef на поиске; `/best/{YYYY-MM}` архивы; теги/модели/каналы | easy→medium |
| xnxx | сорт-дропдаун (`hits`/`month`/`year`) | easy |
| eporner | распаковать `gay` (натурал/гей/транс) + сорты | easy |
| hqporner | **починить поиск** `/?q=&p=` | easy |
| youjizz | `top-rated-week/-month` + HD-фид | easy |
| spankbang | `?o=` сорт + `?d=` длит. + `?q=` качество | easy |
| pornone | time-scoped сорты (4-сегм. URL) | medium |
| porntrex | time-window сорты + `most-favourited` | easy |
| xozilla | time-window сорты (`video_viewed_week/_month`) | easy |
| analdin | time-window сорты | easy |
| hellporno | категории 37→~120 + HD | easy |
| pornobolt | модели (`/aktrisy`→`/models/`) | medium |
| crocotube | модели (`/pornstars/`) | medium |
| 3movs | time-window сорты (`most-viewed/{today,week,month}`) | easy |
| pornve | time-window сорты | easy |
| familyporn | починить сорт (KVS route-алиасы) | easy |
| perfektdamen | каналы/студии (`/channels/`) | medium |
| tizam | **починить поиск** `/search-results/?search_string=` | easy |
| ebun | модели (`/models/{slug}/`) | medium |
| lenporno | **починить поиск** `/search/{query}/?page=` | easy |
| 24rolika | студии/паблики (`/movie/`) | medium |
| jopaonline | модели (`/models/`) | medium |
| porndig | модели (`/pornstars/{id}/`) | medium |

## Тех-долг найден попутно
- **pornhub `longest`** — no-op (API молча отдаёт most-recent). Убрать из cfg.sorts.
- **familyporn** сорт не применяется (нужны route-алиасы вместо `?sort_by=`).

## Рекомендуемый порядок (по ценности/простоте)
1. **Батч «time-window сорты»** (easy, ~10 каналов): xozilla/analdin/hellporno/pornve/crocotube/ebun + 3movs/porntrex/youjizz/pornhub/xnxx — добавить «Топ за неделю/месяц». Огромный охват за правку данных + мелкие browse-правки.
2. **Батч «починить/добавить поиск»**: tizam, hqporner, lenporno (+ spankbang фильтры). Чинит сломанное.
3. **Батч «модели»**: единый паттерн «Модели» (индекс+per-model) для crocotube/ebun/jopaonline/porndig/pornobolt/pornhub-индекс/xvideos.
4. **Студии**: 24rolika `/movie/`, perfektdamen `/channels/`.
5. **Таксономия+фильтры**: pornhub 241 кат + duration/HD, hellporno 120, eporner gay, xvideos durf/quality.
