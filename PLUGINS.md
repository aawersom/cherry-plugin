# Lampa — Разработка плагинов

## Основы

Плагин — самовыполняющийся JavaScript файл (IIFE), загружаемый по URL.  
Установка: **Настройки → Расширения → Добавить плагин → вставить URL**.

Нет TypeScript, нет SDK, нет sandbox. Плагин получает полный доступ к `window.Lampa.*`.

## Минимальный boilerplate

```javascript
(function () {
    'use strict';

    // Защита от двойной загрузки (обязательно!)
    if (window.plugin_myplugin_ready) return;
    window.plugin_myplugin_ready = true;

    function MyComponent(object) {
        var network  = new Lampa.Reguest();
        var listener = Lampa.Subscribe();
        var html;

        this.create = function () {
            html = Lampa.Template.get('myplugin_main', {
                title: object.title || Lampa.Lang.translate('myplugin_title')
            });
            loadData();
            return html;
        };

        this.start = function () {
            Lampa.Controller.add('myplugin', {
                toggle: function () {
                    Lampa.Controller.collectionSet(html);
                    Lampa.Controller.collectionFocus(false, html);
                },
                up:    function () { Lampa.Controller.move('up'); },
                down:  function () { Lampa.Controller.move('down'); },
                left:  function () { Lampa.Controller.move('left'); },
                right: function () { Lampa.Controller.move('right'); },
                back:  function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('myplugin');
        };

        this.pause   = function () {};
        this.stop    = function () {};

        this.destroy = function () {
            network.clear();
            listener.destroy();
            if (html) html.remove();
        };

        function loadData() {
            network.silent(
                'https://api.example.com/data',
                function (data) { renderItems(data.results); },
                function ()     { Lampa.Noty.show(Lampa.Lang.translate('myplugin_error')); }
            );
        }

        function renderItems(items) {
            var container = html.find('.myplugin__content').empty();
            items.forEach(function (item) {
                var card = Lampa.Template.get('myplugin_card', { title: item.title });
                card.on('hover:enter', function () {
                    Lampa.Player.play({ title: item.title, url: item.stream_url });
                });
                container.append(card);
            });
            Lampa.Controller.toggle('myplugin');
        }
    }

    function startPlugin() {
        Lampa.Lang.add({
            myplugin_title: { ru: 'Мой плагин',      en: 'My Plugin' },
            myplugin_error: { ru: 'Ошибка загрузки', en: 'Load error' }
        });

        Lampa.Template.add('myplugin_main', '<div class="myplugin"><div class="myplugin__content"></div></div>');
        Lampa.Template.add('myplugin_card', '<div class="myplugin-card selector"><div class="myplugin-card__title">{title}</div></div>');

        Lampa.Component.add('myplugin', MyComponent);

        Lampa.Menu.addButton(
            '<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/></svg>',
            Lampa.Lang.translate('myplugin_title'),
            function () {
                Lampa.Activity.push({ component: 'myplugin', title: Lampa.Lang.translate('myplugin_title'), page: 1 });
            }
        );

        Lampa.Settings.addComponent({
            component: 'myplugin',
            icon: '<svg width="24" height="24"><circle cx="12" cy="12" r="10"/></svg>',
            name: Lampa.Lang.translate('myplugin_title')
        });

        Lampa.Settings.addParam({
            component: 'myplugin',
            param: { name: 'myplugin_quality', type: 'select', values: { '1080': '1080p', '720': '720p' }, default: '720' },
            field: { name: 'Качество' }
        });

        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite') return;
            var btn = $('<div class="full-start__button selector">My Plugin</div>');
            btn.on('hover:enter', function () {
                Lampa.Activity.push({ component: 'myplugin', movie: e.card });
            });
            e.body.find('.full-start__buttons').append(btn);
        });
    }

    // Обработка обоих случаев: ранняя и поздняя загрузка плагина
    if (window.appready) startPlugin();
    else Lampa.Listener.follow('app', function (e) {
        if (e.type === 'ready') startPlugin();
    });

})();
```

## Жизненный цикл компонента

| Метод | Вызывается | Что делать |
|---|---|---|
| `constructor(object)` | При создании | Инициализировать переменные |
| `create()` | До добавления в DOM | Строить DOM, запускать запросы. **Вернуть корневой элемент** |
| `start()` | Экран становится активным | Регистрировать Controller, установить фокус |
| `pause()` | Другой экран поверх | Можно оставить пустым |
| `stop()` | Потеря фокуса | Можно оставить пустым |
| `destroy()` | Пользователь ушёл | **Обязательно:** cancel requests, unbind, remove DOM |
| `background()` | Опционально | Вернуть URL фонового изображения |

## API справочник

### `Lampa.Listener` — глобальные события

```javascript
Lampa.Listener.follow('app',     (e) => { if (e.type === 'ready') init(); });
Lampa.Listener.follow('full',    (e) => { if (e.type === 'complite') injectButton(e); });
Lampa.Listener.follow('player',  (e) => { if (e.type === 'start') trackView(); });
Lampa.Listener.follow('storage', (e) => { if (e.name === 'my_key') update(e.value); });
```

### `Lampa.Storage` — хранилище

```javascript
Lampa.Storage.set('key', value);               // записать
Lampa.Storage.get('key', defaultValue);        // читать
Lampa.Storage.field('key');                    // прочитать начальное/дефолтное значение
Lampa.Storage.add('key', item);                // добавить в массив (без дубликатов)
Lampa.Storage.cache('key', maxItems, []);      // FIFO-массив с ограничением размера
Lampa.Storage.listener.follow('change', fn);   // следить за изменениями
```

### `Lampa.Template` — HTML-шаблоны

**Синтаксис подстановок:**
- `{varName}` — строковая подстановка
- `#{lang_key}` — i18n перевод
- `{{nested.path}}` — вложенный путь объекта
- `{@templateName}` — встроить другой шаблон

```javascript
Lampa.Template.add('my_card', '<div class="card"><h3>{title}</h3><span>#{my_year}</span></div>');
var elem = Lampa.Template.get('my_card', { title: movie.title });
container.append(elem);
```

### `Lampa.Reguest` — HTTP клиент

> Важно: создавать **один экземпляр на компонент**, не на запрос!

```javascript
var network = new Lampa.Reguest();
network.timeout(10000);

// silent — отменяет предыдущий при новом запросе
network.silent(url, onSuccess, onError, postData, { headers: {} });

// quiet — всегда завершается
network.quiet(url, onSuccess, onError);

// get — показывает глобальный loading
network.get(url, onSuccess, onError);

// native — предпочитает Android native HTTP
network.native(url, onSuccess, onError);

network.clear();                        // отменить все запросы
network.errorDecode(jqXHR, err);        // человекочитаемая ошибка
```

### `Lampa.Activity` — навигация

```javascript
Lampa.Activity.push({ component: 'name', title: 'Title', page: 1 });
Lampa.Activity.backward();              // назад
Lampa.Activity.replace(params);         // заменить без пуша в историю
Lampa.Activity.active();                // текущий activity объект
Lampa.Activity.own(component);          // проверить активность компонента
Lampa.Activity.all();                   // массив всего стека
```

### `Lampa.Controller` — TV-навигация

```javascript
Lampa.Controller.add('myctrl', {
    toggle: function () {
        Lampa.Controller.collectionSet(html);           // задать навигируемые элементы
        Lampa.Controller.collectionFocus(false, html);  // установить начальный фокус
    },
    up:    function () { Lampa.Controller.move('up'); },
    down:  function () { Lampa.Controller.move('down'); },
    left:  function () { Lampa.Controller.move('left'); },
    right: function () { Lampa.Controller.move('right'); },
    enter: function () { Lampa.Controller.enter(); },
    back:  function () { Lampa.Activity.backward(); }
});
Lampa.Controller.toggle('myctrl');     // активировать этот контроллер
Lampa.Controller.focus(elem);          // сфокусировать конкретный элемент
Lampa.Controller.collectionAppend(el); // добавить элементы в коллекцию
Lampa.Controller.toContent();          // вернуться к контент-контроллеру
```

### `Lampa.Player` — плеер

```javascript
Lampa.Player.play({
    title:    'Название фильма',
    url:      'https://cdn.example.com/video.m3u8',
    poster:   'https://cdn.example.com/poster.jpg',
    quality:  { '1080p': 'https://...', '720p': 'https://...' },
    timeline: viewObject,                // для resume-позиции
    playlist: [                          // для серий
        { title: 'S01E01', url: '...' }
    ]
});

// Субтитры (после play)
Lampa.Player.subtitles([{ label: 'Russian', url: 'https://.../ru.srt' }]);

// Внешний плеер
Lampa.Player.runas('android'); // 'android'|'ios'|'webos'|'apple'|'desktop'
```

### `Lampa.Noty` — уведомления

```javascript
Lampa.Noty.show('Сообщение');
Lampa.Noty.show('Предупреждение', { style: 'warn', time: 5000 });
```

### `Lampa.Modal` — модальные диалоги

```javascript
Lampa.Modal.open({
    title:   'Подтверждение',
    html:    $('<div>Вы уверены?</div>'),
    size:    'medium',        // 'small' | 'medium' | 'large'
    buttons: [
        { name: 'Да',    onSelect: function () { doIt(); Lampa.Modal.close(); } },
        { name: 'Отмена',onSelect: function () { Lampa.Modal.close(); } }
    ]
});
Lampa.Modal.close();
Lampa.Modal.update(newHtml);
```

### `Lampa.Select` — выпадающий список

```javascript
Lampa.Select.show({
    title: 'Выберите качество',
    items: [
        { title: '1080p', value: '1080' },
        { title: '720p',  value: '720', picked: true },
        { title: '',      separator: true },
        { title: 'Авто', value: 'auto', ghost: true }
    ],
    onSelect: function (item) { applyQuality(item.value); },
    onBack:   function () {}
});
```

### `Lampa.Lang` — переводы

```javascript
Lampa.Lang.add({
    my_key: { ru: 'Текст', en: 'Text', uk: 'Текст', zh: '文本' }
});
var text = Lampa.Lang.translate('my_key');
// В шаблонах: #{my_key}
```

### `Lampa.Settings` — настройки

```javascript
// Добавить раздел настроек
Lampa.Settings.addComponent({
    component: 'myplugin',
    icon:      '<svg>...</svg>',
    name:      'My Plugin'
});

// Добавить параметр (тип: select | trigger | input)
Lampa.Settings.addParam({
    component: 'myplugin',
    param: {
        name:    'myplugin_quality',
        type:    'select',
        values:  { '1080': '1080p', '720': '720p' },
        default: '720'
    },
    field: { name: 'Качество' },
    onChange: function (value) { /* реакция */ }
});

// Реакция на открытие панели
Lampa.Settings.listener.follow('open', function (e) {
    if (e.name === 'myplugin') { /* кастомный UI */ }
});
```

### `Lampa.Menu` — боковое меню

```javascript
Lampa.Menu.addButton(
    '<svg width="24" height="24">...</svg>',  // SVG иконка
    'Мой плагин',                              // текст
    function () {                              // обработчик
        Lampa.Activity.push({ component: 'myplugin' });
    }
);
```

### `Lampa.ContentRows` — строки главного экрана

```javascript
Lampa.ContentRows.add({
    name:  'myplugin_feed',
    title: 'Моя лента',
    screen: 'main',
    index: 2,
    call: function (params, oncomplite) {
        fetchData(function (items) {
            oncomplite([{
                title:       'Моя лента',
                results:     items,  // массив карточек
                url:         'myplugin_feed',
                page:        1,
                total_pages: 1
            }]);
        });
    }
});
```

## Антипаттерны

| Антипаттерн | Последствие | Как правильно |
|---|---|---|
| Вызывать `Lampa.*` API до `app:ready` | API не инициализировано | Ждать `Lampa.Listener.follow('app', e => e.type==='ready')` |
| Не чистить в `destroy()` | Утечки памяти | Всегда: `network.clear()`, `listener.destroy()`, `html.remove()` |
| Не ставить guard `window.plugin_X_ready` | Двойная инициализация | Первая строка IIFE: `if (window.X) return; window.X = true;` |
| `new Lampa.Reguest()` на каждый запрос | Неуправляемые очереди | Один экземпляр на компонент |

## Известные плагины (референсы)

| Плагин | Репозиторий | Что делает |
|---|---|---|
| online (встроен) | `yumata/lampa-source/plugins/online/` | 6 балансеров стримов — **canonical reference** |
| Lampac | `immisterio/Lampac` | Бэкенд-агрегатор 70+ источников |
| rating.js | `nb557/plugins` | Рейтинги Кинопоиска + IMDb на карточках |
| kp_source.js | `nb557/plugins` | Кинопоиск как источник каталога |
| alt_search.js | `nb557/plugins` | Поиск через IMDb v3 API |
| bookmarks-sync.js | `levende/lampa-plugins` | Облачная синхронизация закладок |
| profiles.js | `levende/lampa-plugins` | Мультипользовательские профили |
| Kinopoisk | `and7ey/lampa` | Списки Кинопоиска |

## DeepWiki API Reference

Лучший публичный API-справочник: https://deepwiki.com/yumata/lampa-source/12.2-plugin-api-and-integration-points
