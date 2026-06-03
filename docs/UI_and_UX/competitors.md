# Анализ конкурентов — Lampa Adult Plugins

Дата анализа: 2026-06-03  
Источники: живые JS-файлы плагинов + веб-исследование

---

## 1. AdultJS (`adultjs.onrender.com`)

**Архитектура:** Клиентский JS (~125KB, Babel-compiled). Скрапинг — в браузере через proxy. Аналог Cherry по архитектуре, но с Nexthub-движком для конфигурируемых адаптеров.

### Источники (33 активных + 1 отключён)

**Класс-ориентированные (хардкод-парсеры):**
| Источник | Хост | Тип |
|---|---|---|
| xvideos.com | www.xvideos.com | VOD |
| spankbang.com | ru.spankbang.com | VOD |
| eporner.com | www.eporner.com | VOD |
| xnxx.com | www.xnxx-ru.com | VOD |
| bongacams.com | ukr.bongacams.com | Live-камеры |
| chaturbate.com | chaturbate.com | Live-камеры |

**NextHub-конфигурируемые (33 адаптера):**
PornHub, Xhamster, Lenkino, Lenporno, 24video, BigBoss, Ebasos, Ebun, JopaOnline, NoodleMagazine, Porndig, Pornk, Porno365, Porno666, PornoBriz, Sosushka, Youjizz, Vporno, Pornobolt, PornoAkt, PornOne, Rusvideos, Veporn, Porntrex, GayPornTube, Vtrahe, VtraheTV *(+ SemBatsa — отключён)*

### Сортировка (выборочно)
- **PornHub:** Недавно в Избранном / Новые / Популярные / Лучшие / Горячие
- **Xhamster:** В тренде / Новейшее / Лучшие (+ catsort внутри категории)
- **SpankBang:** Новое / Трендовое / Популярное
- **EPorner/XVideos:** Новинки / Топ просмотра / Топ рейтинга / Длинные / Короткие
- **Youjizz:** Новинки / Популярные / Топ рейтинга / В тренде
- **BongaCams:** Новые / Пары / Девушки / Русские модели / Парни / Транссексуалы
- **Chaturbate:** Лучшие / Девушки / Пары / Парни / Транссексуалы
- **GayPornTube:** 7 опций сортировки включая Длинные / Обсуждаемые
- Большинство nexthub-адаптеров: Новинки / Популярное / Топ рейтинга

### Категории
Большие каталоги для PornHub (60+), Xhamster, EPorner/XVideos (все на английском, 60+ категорий), PornOne. Многие nexthub-адаптеры имеют категории. **Поддержка matrix category × sort** для части адаптеров (catsort).

### Навигация пультом
- **Вправо в гриде:** открывает панель фильтра/сортировки напрямую (`onRight = filter`)
- **OK на карточке:** немедленное воспроизведение
- **Долгое нажатие:** контекстное меню "Меню" → Похожие / [Имя модели]
- **Пагинация:** seamless infinite-scroll через `InteractionCategory.nextPageReuest` — автодозагрузка при фокусе на последней карточке (управляется фреймворком Lampa)

### Функции
- **Избранное:** отсутствует на уровне плагина (только sort-опция "Недавно в Избранном" у PornHub)
- **Поиск:** per-source через кнопку в фильтре, `Lampa.Input.edit`, `nosave:true`
- **Качество:** автовыбор по `video_quality_default` (1080 по умолчанию), без диалога
- **Предпросмотр:** 1500мс задержка после фокуса, `<video>` overlay с border-radius, toggle в настройках Lampa Settings
- **Related:** через контекстное меню "Похожие" + `Lampa.Player.playlist()` для playlist-во-время-воспроизведения
- **Модели:** через контекстное меню → открывает грид с видео модели
- **Настройки:** только "Предпросмотр" в Lampa Settings (`SettingsApi.addParam`)
- **Родительский контроль:** `Lampa.ParentalControl.query()` перед открытием источников
- **Кнопка фильтра в шапке:** SVG-иконка, появляется только для AdultJS-вью
- **Значок "JS"** на иконке в сайдбаре (визуальное отличие)
- **Charset:** поддержка windows-1251 для Vtrahe
- **Два компонента** на источник: главный грид + список-вью (раздельная история навигации)
- **Экран выбора источников:** `Lampa.Select` "Сайты" с опцией "Все"

---

## 2. Sisi.js / Клубничка (`bylampa.github.io/sisi.js` → `ab2024.ru/sisi.js`)

**Архитектура:** Lampac-frontend (45KB). Тонкий клиент поверх C#/.NET бэкенда. Всё содержимое, скрапинг, прокси — на сервере. Источники динамические (JSON от бэкенда).

### Источники
Полностью серверные — в JS не захардкожены. Список через API `/sisi/channels`. Известные из Lampac SISI-модуля: PornHub, Xvideos, Xhamster, XNXX, SpankBang, Eporner, HQPorner, PornTrex, Redtube, YouPorn и 50+ других.

### Сортировка / Фильтры
Полностью серверные. Бэкенд возвращает `menu[]` с иерархическими опциями (2 уровня). Клиент рендерит их как `Lampa.Select` — заголовок `"Метка: ТекущееЗначение"`, подзаголовок — текущий выбор. "all" → "Любой".

### Навигация пультом
- **Вправо в гриде:** открывает панель фильтра (`onRight = filter`)
- **OK на карточке:** немедленное воспроизведение
- **Долгое нажатие:** "В закладки" / "Удалить из закладок" / "Удалить из истории" / "Похожие" / [Имя модели] / "Плеер Lampa" (на Android)
- **Пагинация:** `pg=N` параметр, `nextPageReuest` framework, default total_pages=30

### Функции
- **Закладки:** серверные (SQLite), POST/GET к `/bookmark/add|remove`. Подсказка при пустом списке: *"Удерживайте ОК на видео для добавления в закладки."*
- **История:** серверная (add — dead code, только remove работает)
- **Поиск:** per-source в фильтре + интеграция в глобальный поиск Lampa (`Search` component)
- **Качество:** автовыбор по `video_quality_default` + `qualitys_proxy` как fallback
- **Предпросмотр:** 1500мс задержка, `<video>` overlay, toggle в Lampa Settings
- **Related:** через контекстное меню (если `card.related=true`), открывает новый грид
- **Модели:** через контекстное меню (если `card.model` установлен)
- **Настройки:** Предпросмотр + История в Lampa Settings (`SettingsApi`)
- **RCH (Remote Client Helper):** WebSocket-мост — бэкенд просит браузер выполнить CORS-запрос и вернуть результат. Прозрачно для пользователя.
- **VIP контент:** если `video` URL содержит `/vip.mp4/` — показывает модальное окно "Доступ ограничен" с device ID для регистрации у администратора
- **Идентификаторы:** `lampac_unic_id` + `sisi_unic_id` (box_mac) добавляются к каждому запросу
- **Кнопка фильтра в шапке:** появляется только для sisi-вью
- **Многоязычие:** ru/en/uk/zh
- **Длительность как лейбл качества:** если нет `quality`, подставляет `time`
- **Два режима входа:** стандартный (Сайты picker) vs app-mode (кнопка в сайдбаре на каждый источник)

---

## 3. xsena.red / Клубничка (Lampac Next Generation)

**Архитектура:** Серверный Lampac C#/.NET (ASP.NET Core). Клиент — динамически генерируемый JS (`/sisi/{token}`). Backend-as-a-service для Lampa.

**Статус:** `api.xsena.red` — down. Endpoints: `e.xsena.red`, `cf.xsena.red`, `pl.xsena.red`, `nl.xsena.red`.

### Источники
60+ источников. Обновление 2026-04-28: добавлены 12 новых. Включает: PornHub, PornhubPremium, Xvideos, XvideosRED, Xhamster, XNXX, Ebalovo, Eporner, HQPorner, PornTrex, SpankBang, BongaCams, Chaturbate, Cam4 и другие. Отдельные тиры для LGBT контента (displayindex 10000+).

### Функции
- **Закладки:** серверные SQLite, мультидевайс синк
- **История:** серверная
- **Live-камеры:** BongaCams, Chaturbate, Cam4
- **VIP / доступ:** токен-авторизация, регистрация устройств на `xsena.red/devices`
- **Настройки источника:** зеркало / CORS / VPN per-source
- **LGBT toggle:** отключение LGBT-контента глобально
- **Гео-фильтрация:** источники фильтруются по гео-ограничениям
- **Веб-каталог:** отдельный SPA `wpl.xsena.red` ("Каталог 18+ фильмов")
- **Android APK:** нативный враппер (выпущен 2026-02-05)
- **CorsProxy:** встроенный (добавлен 2026-02-13)
- **Группы доступа:** premium-тиры
- **NextHUB YAML:** параметры `search/sort/category/model/page` на уровне схемы источника
