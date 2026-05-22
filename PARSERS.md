# Cherry Plugin — Документация парсеров

Источники данных: yt-dlp extractors, Lampac source code (immisterio/Lampac), urlscan.io, SimilarWeb/Semrush, прямые fetch-тесты.

---

## Статус источников

| Сайт | Рабочий домен | Сложность | Статус | Метод |
|------|--------------|-----------|--------|-------|
| Pornhub | pornhub.com | Средняя | ✅ | Webmasters API + flashvars JSON |
| Xvideos | xvideos.com | Лёгкая | ✅ | html5player JS setters |
| Xhamster | xhamster.com | **СЛОЖНАЯ** | ⚠️ | window.initials + XOR-дешифровка (7 алгоритмов) |
| Xnxx | xnxx.com | Лёгкая | ✅ | html5player JS setters |
| Eporner | eporner.com | **Тривиальная** | ✅ | Официальный публичный REST API |
| Spankbang | spankbang.com | Средняя | ✅ | POST /api/videos/stream |
| NoodleMagazine | noodlemagazine.com | Средняя | ⚠️ | Embedded JSON (частые 403) |
| Hqporner | hqporner.com | Лёгкая | ✅ | `<source src>` в HTML |
| Youjizz | youjizz.com | Лёгкая | ✅ | JS массив `Encodings` |
| PornOne | pornone.com | Неизвестная | ❓ | Требует live-инспекции |
| Porntrex | porntrex.com | Средняя | ✅ | KVS `get_file/` URL |
| Xozilla | xozilla.com | Средняя | ✅ | JWPlayer setup block |
| 3Movs | 3movs.com | Средняя | ✅ | KVS / `<source>` |
| Analdin | analdin.com | Средняя | ✅ | JWPlayer setup block |
| PornVe | pornve.com | Средняя | ✅ | Динамический JS, cdn.pornve.com |
| FamilyPorn | familyporn.tv | Средняя | ✅ | SisiStyle CMS cluster |
| Porndig | porndig.com | Лёгкая | ✅ | iframe `videos.porndig.com/player/index/{id}/` |
| Tizam | tv4.tizam.org | Лёгкая | ✅ | `<source type="video/mp4" src>` (Lampac verified) |
| PerfektDamen | perfektdamen.co | Неизвестная | ❓ | Динамический JS |
| HellPorno | hellporno.com | Лёгкая | ✅ | HTML5 `<video>/<source>` (yt-dlp verified) |
| Ebalovo | web.epalovo.com | Лёгкая | ✅ | JS var `video_url`/`video_alt_url` (Lampac verified) |
| Pornobolt | sex.pornobolt.in | Средняя | ⚠️ | Динамический JS, pbcdn.tv CDN |
| CrocoTube | crocotube.com | Средняя | ✅ | alphaxcdn.com CDN (кластер с HellPorno) |
| Huyamba | fuq.huyamba.mobi | Средняя | ⚠️ | `get_file/` endpoint, динамически |
| VePorn | veporn.net | Средняя | ⚠️ | 403 без Referer, cdn.pornve.com |
| Ebun | www1.ebun.tv | Средняя | ⚠️ | AJAX "show more", динамически |
| LenPorno | my.lenporno.live | Лёгкая | ✅ | `/uploads/{id}/video.mp4` (вероятно) |
| 24Rolika | w2.huyalkino.com | Средняя | ✅ | DLE CMS, JWPlayer в `<script>` |
| Jopa Online | jopaonline.mobi | Средняя | ⚠️ | Динамический JS |
| **Pornk** | pornk.one | ❓ | ❓ | Требует инспекции |
| **GayPornTube** | www.gayporntube.com | Средняя | ⚠️ | Динамический JS |
| ~~SexxxHub~~ | мёртвый | — | ❌ | Исключить |
| ~~Sosushka~~ | заглушка | — | ❌ | Исключить |
| ~~Porn4days~~ | porn4days.pw | — | ❌ | 403 на всех запросах |

---

## Кластеры CMS (общая реализация)

### Кластер A — AlphaXCDN/HellCDN (один оператор)
Сайты: **HellPorno**, **CrocoTube**
- Поиск: `/search/{N}/?q={query}`
- Пагинация browse: `/{category}/{N}/`
- Thumbnail CDN: `img{1-3}-hp.hellcdn.net` (HellPorno) / `img{1-3}-ct.alphaxcdn.com` (CrocoTube)
- Стрим: HTML5 `<video>/<source src>` в HTML страницы — самый простой метод

### Кластер B — SisiStyle Custom PHP
Сайты: **FamilyPorn**, **PornVe**, **VePorn**, **Ebun**
- Thumbnail path: `/contents/videos_screenshots/{range}/{id}/{resolution}/1.jpg`
- CDN: `cdn.pornve.com` (PornVe/VePorn), self-hosted (FamilyPorn, Ebun)
- Плеер динамический — требует network inspection

### Кластер C — Epalovo/EbaCDN
Сайты: **Ebalovo**
- Live домен: `web.epalovo.com`, CDN: `img.ebacdn.com`
- Стрим: regex `/(video_alt_url|video_url):([\t ]+)?('|")(?<link>[^"']+)/` по HTML страницы видео
- **Самый документированный** — Lampac source code доступен

### Кластер D — DLE (DataLife Engine)
Сайты: **24Rolika** (redirect → w2.huyalkino.com), **JopaOnline** (похожий)
- Поиск: `?do=search&subaction=search&story={query}`
- Видео URL: `/{category}/{id}-{slug}.html`
- Пагинация: `/page/{N}/`
- Стрим: JWPlayer в `<script>`: `file: "https://...mp4"`

### Кластер E — KVS (Kernel Video Sharing)
Сайты: **Porntrex**, **Xozilla**, **3Movs**, **Analdin** (вероятно)
- Detect: `<script src="...kt_player.js?v=`
- Stream URL паттерн: `/get_file/{number}/{hash}/{folder}/{video_id}/{video_id}_{quality}.mp4/`
- Regex: `(?:video_url|file)\s*[=:]\s*['"]([^'"]+(?:\.mp4|\.m3u8)[^'"]*?)['"]`

---

## Детальные парсеры

### 1. Eporner — Официальный API ⭐

```
GET https://www.eporner.com/api/v2/video/search/?query={q}&per_page=30&page={p}&thumbsize=medium&order=top-rated&gay=0&format=json

Ответ:
{
  "total_pages": 1523,
  "videos": [{
    "id": "E02n1A4KRBD",  // 11 символов
    "title": "...",
    "views": 1234567,
    "rate": 4.75,
    "url": "https://www.eporner.com/video-E02n1A4KRBD/slug/",
    "length_sec": 1234,
    "embed": "https://www.eporner.com/embed/E02n1A4KRBD/",
    "default_thumb": { "src": "https://static-ca-cdn.eporner.com/thumbs/..." }
  }]
}

Параметр order: latest | longest | shortest | top-rated | most-popular | top-weekly | top-monthly
per_page: 1–1000, page: 1–1000000
```

**Получение стрима:** страница видео содержит `<video>` элемент или `<source>`. Embed URL (`/embed/{id}/`) — запасной вариант.

---

### 2. Pornhub — Webmasters API

```
GET https://www.pornhub.com/webmasters/search?search={q}&page={p}&ordering=mostviewed&thumbsize=medium_hd

Ответ: { "videos": [{ "title", "thumbs":[{"src"}], "url", "duration", "video_id" }] }

Стрим: fetch страницы видео → regex: var\s+flashvars_\d+\s*=\s*({.+?});
→ parse JSON → mediaDefinitions[].videoUrl (MP4) или format:"hls"

Качества: "240", "480", "720", "1080" в mediaDefinitions[].quality
```

---

### 3. Xvideos — html5player

```
Поиск: https://www.xvideos.com/?k={q}&p={p}  (p — 0-indexed)
Видео: https://www.xvideos.com/video{ID}/{slug}

Стрим regex из HTML страницы:
setVideoHLS\s*\(\s*['"]([^'"]+)['"]\)    → HLS m3u8 URL (preferred)
setVideoUrlHigh\s*\(\s*['"]([^'"]+)['"]\) → MP4 high
setVideoUrlLow\s*\(\s*['"]([^'"]+)['"]\)  → MP4 low
setThumbUrl\s*\(\s*['"]([^'"]+)['"]\)     → thumbnail

CDN: *.xvideos-cdn.com
```

---

### 4. Xhamster — window.initials (СЛОЖНО: шифрование)

```
Поиск: https://xhamster.com/search/{q}?page={p}

Стрим: window\.initials\s*=\s*({.+?})\s*; → JSON parse
→ initials.xplayerSettings.sources.hls.url  (ЗАШИФРОВАНО)
→ initials.xplayerSettings.sources.standard["720p"][0].url  (ЗАШИФРОВАНО)

Расшифровка: 7 алгоритмов XOR (LCG, XORshift, Weyl, MurmurHash3)
Первый байт hex-строки = номер алгоритма (1-7)
Байты 1-4 = little-endian seed
Остаток = XOR-зашифрованный URL

⚠️ Реализация: нужно портировать yt-dlp/extractor/xhamster.py на JS (~150 строк)
```

---

### 5. Xnxx — html5player (аналогично Xvideos)

```
Поиск: https://www.xnxx.com/search/{url-encoded-q}/{p}  (p — 0-indexed)
Видео: https://www.xnxx.com/video-{id}/{slug}

Стрим (тот же html5player):
setVideoHLS\s*\(\s*['"]([^'"]+)['"]\)     → HLS (есть timestamp-токен)
setVideoUrlHigh\s*\(\s*['"]([^'"]+)['"]\) → MP4

CDN: *.xnxx-cdn.com
```

---

### 6. Spankbang — двухфазный

```
Поиск: https://spankbang.com/s/{query}/{page}/
Видео: https://spankbang.com/{id}/video/{slug}

Фаза 1 — regex на HTML: stream_url_\w+\s*=\s*["']([^"']+)["']
Фаза 2 — если пусто:
  1. Извлечь stream_key: data-streamkey="([^"]+)"
  2. POST https://spankbang.com/api/videos/stream
     Body: id={stream_key}&data=0
     Headers: Referer, X-Requested-With: XMLHttpRequest
  3. Ответ JSON: {"720p": "https://...mp4", "1080p": "..."}

⚠️ Строгая защита от ботов с февраля 2024. Нужны реалистичные headers.
```

---

### 7. YouJizz — массив Encodings

```
Поиск: https://www.youjizz.com/search/videos/{query}-{page}.html
Видео: https://www.youjizz.com/videos/{slug}-{id}.html

Стрим regex: Encodings\s*=\s*(\[[\s\S]+?\]);\n
→ JSON.parse() → каждый объект .filename = URL стрима
Формат: MP4 или m3u8
```

---

### 8. HQPorner — source теги

```
Поиск: https://hqporner.com/search/{query}/
Видео: https://hqporner.com/hdporn/{slug}.html

Стрим: парсить <source src="https://...mp4"> в <video> элементе
CDN: аналогичен Eporner (static-ca-cdn.eporner.com)
Качества: 360p, 480p, 720p, 1080p, 2160p
```

---

### 9. NoodleMagazine — embedded JSON

```
Поиск: https://noodlemagazine.com/search/{query}/
Видео: https://noodlemagazine.com/watch/{video_id}

Стрим: найти JSON blob с "sources" в <script> теге страницы
⚠️ Обязателен Referer: https://noodlemagazine.com/
⚠️ Частые 403 — нужен cookie jar
```

---

### 10. Porntrex — KVS get_file

```
Поиск: https://www.porntrex.com/?s={query}
Видео: https://www.porntrex.com/video/{id}/{slug}/

Стрим regex: get_file\/[^"']+\.mp4
URL паттерн: https://www.porntrex.com/get_file/{N}/{hash}/{folder}/{id}/{id}_{quality}.mp4/
HLS: https://www.porntrex.com/get_file/{hash}/{id}/playlist.m3u8
```

---

### 11. Tizam — HTML5 source (Lampac verified) ✅

```
Live host: https://tv4.tizam.org
Browse: https://tv4.tizam.org/fil_my_dlya_vzroslyh/s_russkim_perevodom/?p={page}
Видео: https://tv4.tizam.org/fil_my_dlya_vzroslyh/{category}/{slug}/

Стрим regex: /src="(https?:\/\/[^"]+\.mp4)"\s+type="video\/mp4"/
CDN: http://video2.tizam.cc/files/{id}/{filename}.mp4
Thumbnail: /images/cms/thumbs/{hash}/{id}_{title}_280_397_jpg_0_90.jpg
Пагинация: ?p={N-1} (0-indexed)
```

---

### 12. Ebalovo — video_url var (Lampac verified) ✅

```
Live host: https://web.epalovo.com
Поиск: https://web.epalovo.com/search/{query}/{page}/
Видео: https://web.epalovo.com/video/{slug}/

Стрим regex: /(video_alt_url|video_url):([\t ]+)?('|")(?<link>[^"']+)/
CDN thumbnail: https://img.ebacdn.com/videos_screenshots/{range}/{id}/640x360/5.jpg
```

---

### 13. HellPorno — HTML5 source (yt-dlp verified) ✅

```
Поиск: https://hellporno.com/search/{page}/?q={query}
Видео: https://hellporno.com/videos/{slug}/

Метод: _parse_html5_media_entries() — стандартные <video>/<source> теги
Thumbnail CDN: https://img{1-3}-hp.hellcdn.net/{range}/{id}/640x360/{N}.jpg
```

---

### 14. CrocoTube — alphaxcdn (кластер HellPorno)

```
Поиск: https://crocotube.com/search/{N}/?q={query}
Видео: https://crocotube.com/videos/{slug}/

Thumbnail CDN: https://img{1-3}-ct.alphaxcdn.com/{range}/{id}/640x360/{N}.jpg
Стрим: динамически загружается, alphaxcdn CDN — нужна network inspection
Одна реализация с HellPorno, параметр: суффикс CDN (-hp / -ct)
```

---

### 15. Porndig — iframe src

```
Поиск: https://porndig.com/channels/{id}/{slug}/page/{N}
Видео: https://porndig.com/videos/{id}/{slug}.html

Стрим: regex из HTML → src="(https:\/\/videos\.porndig\.com\/player\/index\/[^"]+)"
→ этот URL передаётся плееру как iframe или парсится дальше
Thumbnail: https://image-cdn.porndig.com/thumbs/{YYYY}/{MM}/{id}/{res}/{N}.jpg
Качества: 360p, 540p, 720p, 1080p
```

---

### 16. LenPorno — uploads path

```
Live host: https://my.lenporno.live
Поиск: https://my.lenporno.live/search/?text={query}
Browse: https://my.lenporno.live/new-update/{page}/
Видео: https://my.lenporno.live/video/{slug}

Стрим (вероятно): https://my.lenporno.live/uploads/{video_id}/video.mp4
Thumbnail: https://my.lenporno.live/uploads/{video_id}/thumb1.1.jpg
```

---

### 17. 24Rolika / Huyalkino — DLE + JWPlayer

```
Live host: https://w2.huyalkino.com  (24rolika.ru → redirect)
Поиск: https://w2.huyalkino.com/?do=search&subaction=search&story={query}
Browse: https://w2.huyalkino.com/page/{N}/
Видео: https://w2.huyalkino.com/{category}/{id}-{slug}.html

Стрим regex: jwplayer\(\w+\)\.setup\(\{[\s\S]*?file:\s*["']([^"']+)["']
Thumbnail: /uploads/posts/{YYYY-MM}/{id}.jpg
```

---

### 18. GayPornTube — в конец списка

```
Домен: https://www.gayporntube.com
Поиск: /search/videos/{query}/{sort}/page{N}.html
  sort: most-relevant | most-recent | top-rated | most-viewed | longest
Browse: /channels/{id}/{slug}/page{N}.html
Видео: /video/{id}/{slug}  ⚠️ без trailing slash!

Стрим: динамически загружается — нужна network inspection
Thumbnail CDN: cdn.gayporntube.com (вероятно)
```

---

## Обязательные HTTP-заголовки для всех запросов

```javascript
{
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.5',
  'Referer': 'https://{site-domain}/'
}
```

VePorn, Spankbang — особенно критичен Referer.

---

## Исключённые источники

| Источник | Причина |
|----------|---------|
| SexxxHub | Домен мёртвый / продаётся |
| Sosushka | Сайт показывает ISPsystem placeholder |
| Porn4days | 403 на всех запросах, anti-bot protection |
| Vporno | Все домены мертвы или нестабильны |

---

## Домены с нестабильным положением (мониторить)

| Источник | Текущий домен | Альтернатива |
|----------|--------------|-------------|
| Ebalovo | web.epalovo.com | ebalovo.pro → ebalovo.porn → web.epalovo.com |
| ProstoPorno | prostoporno1.co | prostoporno.info (redirect) |
| Pornk | pornk.one | pornk.com (мёртв) |
| Tizam | tv4.tizam.org | tizam.video, tizam.ru |
| Huyamba | fuq.huyamba.mobi | hub.huyamba.mobi, tube.huyamba.mobi |
| Pornobolt | sex.pornobolt.in | pornobolt.tv (redirect) |
