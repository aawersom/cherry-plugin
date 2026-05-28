# Phase 2 Fixtures Report — multi-source-video-fix

Date: 2026-05-28  
Mode: full

---

## 1. Tizam

**Source URL:** `https://tv4.tizam.org/fil_my_dlya_vzroslyh/...`  
**Fixture:** `test/fixtures/tizam-page.html` (258,347 chars — real fetch via CF proxy)  
**Status:** Real fixture ✅

**Markers found in HTML:**
```html
<source src="https://video5.tizam.cc/films/hands-on-teaching-1.mp4" type="video/mp4" data-res="480">
<source src="https://video5.tizam.cc/films/hands-on-teaching-2.mp4" type="video/mp4" data-res="720">
```

**extractStreams() result:**
- `quality`: `{480: url1, 720: url2}` — via `srcRe2` (`data-res="N"` before `src=`)
- `bestQualityUrl`: 720p URL ✅

**Concrete recommendation:**  
Replace tizam Pattern1+Pattern2 logic with `return extractStreams(html)`. The `srcRe2` regex already matches `data-res` as it looks for the substring `res=` within attribute names. Result: multi-quality map + correct 720p selection instead of the current single-URL no-quality return.

**Current bug:** Pattern1 (`src="URL"\s+type="video/mp4"`) returns `{url, quality:{}}` — correct URL but no quality selection. `bestQualityUrl` on empty quality map returns `''`, forcing fallback to `url`. This works but wastes available quality data.

---

## 2. PerfektDamen

**Source URL:** `https://www.perfektdamen.co/video/724992/`  
**Fixture:** `test/fixtures/perfektdamen-page.html` (460,035 chars — real fetch via CF proxy)  
**Status:** Real fixture ✅

**Markers found in HTML:**
- 19 absolute KVS `get_file` URLs
- `<source>` tags with `label="Auto"`, `label="480p"`, etc.
- Quality filenames: `724992_360p.mp4`, `724992_720p.mp4`, `724992.mp4` (bare = no quality tag)

**extractStreams() result:**
- `quality`: `{360p: 360url, mp4: bareurl, 720p: 720url, Auto: 360url, 480p: bareurl}`
- `bestQualityUrl`: 720p URL ✅

**Concrete recommendation:**  
No code change needed. `perfektdamen.getStream` already calls `return extractStreams(html)`. Result is correct: 720p selected. The duplicate entries (Auto, mp4, 480p overlapping) are harmless since `bestQualityUrl` picks highest numeric key.

---

## 3. Huyamba

**Source URL:** `https://fuq.huyamba.mobi/video/8588/`  
**Fixture:** `test/fixtures/huyamba-page.html` (141,121 chars — real fetch via CF proxy)  
**Status:** Real fixture ✅

**Markers found in HTML:**
```js
video_url: 'https://fuq.huyamba.mobi/get_file/1/d73ccae2b56f6e6d561e81ab6029edfb/8000/8588/8588sd.mp4/?v-acctoken=NjE1fDN8MH...'
// (also present: 8588.mp4 variant without "sd" suffix)
```

**extractStreams() result:**
- `quality`: `{mp4: "https://fuq.huyamba.mobi/get_file/1/.../8588.mp4/?v-acctoken=MTA4OX..."}` ✅ (token preserved)
- `url`: same URL ✅

**Current bug (confirmed):** `gfRx = /get_file\/(\d+\/[^"'\s<>]+\.(?:mp4|m3u8))/g` captures relative path only (strips `?v-acctoken=...`), then prepends hardcoded `https://fuq.huyamba.mobi/get_file/`. The `?v-acctoken=...` is lost → server returns 403.

**Concrete recommendation:**  
Replace entire gfRx block with `return extractStreams(html)`. The KVS branch regex (`/https?:\/\/[^"'\s]+get_file[^"'\s]+\.mp4[^"'\s]*/g`) captures the full absolute URL including the token query param. Direct drop-in fix.

---

## 4. 24Rolika (Huyalkino)

**Source URL:** `https://w2.huyalkino.com/russian/29106-....html`  
**Fixture:** `test/fixtures/24rolika-page.html` (56,675 chars — real fetch via CF proxy)  
**Status:** Real fixture ✅

**Markers found in HTML:**
```js
new Playerjs({id:"player", file:"https://videosdrop.com/.../170.mp4", poster:"..."})
```

**extractStreams() result:**
- `url`: `"https://videosdrop.com/B5WcckmsqqOfurN63fkuwezz-Video/2026-01/170.mp4"` ✅
- `quality`: `{}` (no labeled qualities in PlayerJS single-file format)

**Current behavior:** `jwRx` (matches `jwplayer(...).setup({file:...})`) doesn't match `new Playerjs({file:...})`. Falls to `extractStreams(html)` which catches it via `jwRe` (`'file':"URL"` generic pattern). Works correctly.

**Concrete recommendation:**  
No code change needed. Falls through to `extractStreams` which works. PlayerJS single-file format → no quality map, single URL returned. This is correct behavior for this page format.

---

## 5. Pornhub

**Source URL:** `https://www.pornhub.com/view_video.php?viewkey=...` (age-gated, CF proxy blocked)  
**Fixture:** `test/fixtures/pornhub-page.html` (SYNTHETIC)  
**Flashvars JSON:** `test/fixtures/pornhub-flashvars.json` (SYNTHETIC — normalized `\/` → `/`)  
**Status:** Synthetic ⚠️

**Known HTML structure (from prior session research):**
```js
var flashvars_8675309 = {
  "mediaDefinitions": [
    {"quality":"1080","videoUrl":"https:\/\/ev-h.phncdn.com\/...\/1080P_4000K_8675309.mp4?..."},
    {"quality":"720","videoUrl":"..."},
    {"quality":"hls","videoUrl":"...master.m3u8?...", "defaultQuality":1}
  ]
};
```

**Current bug:** CF proxy returns Russian age-gate wall; flashvars never injected into response. Regex IS correct (matches `flashvars_\d+`) but the data isn't there.

**Concrete recommendation (Phase 4):**  
Add age-bypass via `Cookie: age_verified=1; platform=tv` header in `cherryFetch` for pornhub domain. The flashvars parsing and mp4/hls branching logic is already correct — only the fetch needs the bypass cookie. Alternatively: try Deno proxy which may bypass the age gate.

---

## 6. Eporner

**Source URL:** `https://www.eporner.com/video/ABCD1234/...` (IP-blocked on CF proxy)  
**Fixture:** `test/fixtures/eporner-page.html` (SYNTHETIC)  
**Status:** Synthetic ⚠️

**Known HTML structure (from prior session research):**
- Page HTML has zero direct mp4 URLs
- Contains `hash = "a1b2c3d4..."` (32-char hex)
- Video ID in URL slug
- XHR endpoint: `/xhr/video/{id}?hash={computed}&device=generic&domain=www.eporner.com&fallback=false`
- XHR response: `{sources: {mp4: {"1080p": {src, type}, "720p": {src, type}}}}`

**Hash computation:**
```
split 32-char hex into 4×8-char chunks
computed = chunks.map(c => parseInt(c,16).toString(36)).join('')
```

**Concrete recommendation (Phase 4):**  
Implement XHR-based getStream: (1) extract `id` from `video.url`, (2) fetch page to extract hash, (3) compute hash, (4) XHR to `/xhr/video/{id}?hash={computed}...`, (5) parse sources.mp4 into quality map. Also: add `eporner.com` to `PROXY_URL_2_HOSTS` so page fetch routes through Deno proxy.

---

## Q7 — bigcdn.cc CDN routing (REQ-7)

**Method:** DNS enumeration + HTTP probe via Bash/curl  
**Result:**

| Subdomain | IP | HTTP status (CF Worker) | Notes |
|---|---|---|---|
| s1.bigcdn.cc | LeaseWeb NL | 403 | Normal CDN behaviour (no path) |
| s4.bigcdn.cc | LeaseWeb NL | 403 | |
| s16.bigcdn.cc | LeaseWeb NL | 403 | |
| s25.bigcdn.cc | LeaseWeb NL | 403 | |
| s30.bigcdn.cc | LeaseWeb NL | 403 | |
| s33.bigcdn.cc | LeaseWeb NL | 403 | |
| s38.bigcdn.cc | LeaseWeb NL | 403 | |
| s39.bigcdn.cc | LeaseWeb NL | 403 | |
| s41.bigcdn.cc | LeaseWeb NL | 403 | |
| s43.bigcdn.cc | LeaseWeb NL | 403 | |
| s47.bigcdn.cc | LeaseWeb NL | 403 | |
| s50.bigcdn.cc | LeaseWeb NL | 403 | |
| s61.bigcdn.cc | LeaseWeb NL | 403 | |

**Verdict:** All 13 confirmed subdomains (s1–s61, non-consecutive) resolve to LeaseWeb Netherlands. Root-level 403 is normal CDN behaviour. No fresh signed URLs available to test actual video delivery. Recommendation (Phase 5): add all 13 to `PROXY_URL_2_HOSTS` as Candidate A — Deno proxy may have better LeaseWeb routing than CF Worker.

---

## Q8 — pornone CDN IP-token binding (REQ-8)

**Method:** HTTP probe of CDN edge nodes via Deno proxy  
**Nodes probed:** `cdn-eu-g10N.pornone.com`, `cdn-us-o10N.pornone.com`

| Request | Via Deno | Status |
|---|---|---|
| `cdn-eu-g101.pornone.com/robots.txt` | Yes | **200** |
| `cdn-us-o101.pornone.com/robots.txt` | Yes | **200** |

**Verdict:** Deno proxy reaches pornone CDN edge nodes (HTTP 200). However, primary obstacle is **IP-token binding**: the signed stream token is bound to the IP that fetched the page. If the stream fetch uses a different Deno node than the page fetch, the request fails. This is not a proxy routing problem but a token architecture problem. Recommendation: fetch page AND stream through the same proxy endpoint (same CF Worker or same Deno deploy request context). Currently `cherryFetch` already routes consistently, so pornone may work if PROXY_URL_2_HOSTS is extended with pornone CDN hostnames.

---

## Phase 2 Gate: All criteria met ✅

- [x] 4 real HTML fixtures (tizam, perfektdamen, huyamba, 24rolika) — all >1KB
- [x] 2 synthetic HTML fixtures (pornhub, eporner) — documented structure
- [x] pornhub flashvars JSON parseable (valid JSON, normalized slashes)
- [x] Concrete regex recommendation per adapter (not 'TBD')
- [x] Q7 HTTP status recorded (403 on all 13 bigcdn.cc subdomains — normal)
- [x] Q8 HTTP status recorded (200 via Deno on pornone CDN edges)
