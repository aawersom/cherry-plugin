# Spec — Adapter Preview Population
**Slug:** `adapter-preview-quality`
**Date:** 2026-05-29
**Status:** Draft

---

## 1. Goal

Populate `video.preview` (short MP4 clip URL) in the xvideos, xnxx, and pornhub adapters
inside `plugin.js` so that the hover-preview player introduced in Phase 2 actually has a
URL to play. All data is already present in browse HTML; no new HTTP requests are needed.

## 2. Non-Goals

- **SpankBang** — explicitly out of scope. Two distinct statuses:
  - Quality-map regex (`qRe` pattern in Phase 1 of `getStream`): done (committed 2026-05-28).
  - `video.preview` in `_parseCards`: **not done** — SpankBang CDN has no equivalent
    `_169.mp4` preview clip system. Deferred to a future task pending CDN investigation.
- `getStream` / stream resolution logic — not touched.
- `_isAndroid()` guard in the hover handler — not touched (already correct).
- Fav persistence list — stays at 7 fields; `preview` remains excluded.
- PROXY layer (`cherryFetch`, `buildProxyUrl`, `PROXY_URL_2_HOSTS`) — read-only. Adding CDN
  hostnames to `PROXY_URL_2_HOSTS` has no effect on preview delivery — `<video src>` requests
  are made directly by WebView and bypass `cherryFetch` entirely.

---

## 3. VideoCard Typedef Reminder

```
preview  — URL of short preview clip (mp4/hls). Not persisted in Fav.
           May be empty string; hover handler guards: if (video.preview && ...).
```

The Fav engine serialises exactly 7 fields: `id, source, title, thumb, url, duration, views`.
`preview` (and `model`) are dropped on Fav round-trip by design. Setting `preview` on a card
that later enters Fav storage is safe — it degrades gracefully to `undefined` on restore, which
the `if (video.preview && ...)` guard already handles.

---

## 4. Requirements

### REQ-1 — xvideos `_parseCards()` (lines ~1866–1906)

**What:** Derive `preview` from `thumb` using the `_169.mp4` transform. Add `preview` field
to the `items.push({...})` call.

**Transform (ES5, applied after `thumb` is extracted):**

```javascript
var preview = '';
if (thumb) {
  preview = thumb
    .replace('.THUMBNUM.', '.1.')
    .replace(/\/thumbs[^\/]+\//, '/videopreview/')
    .replace(/\/[^\/]+$/, '')
    .replace(/-[0-9]+$/, '') + '_169.mp4';
}
```

**Placement in `_parseCards`:** immediately after the `thumb` assignment, before `items.push`.

**Push call change — add one field:**

```javascript
items.push({
  id: 'xv' + numId,
  source: 'xvideos',
  title: title,
  thumb: thumb,
  preview: preview,        // ← ADD
  url: videoUrl,
  duration: duration,
  views: 0
});
```

---

### REQ-2 — xnxx `_parseCards()` (lines ~1988–2031)

**What:** Apply the same `_169.mp4` transform to the xnxx thumb, but only when the thumb URL
contains a `/thumbsXXX/` path segment — otherwise set `preview = ''`.

**Transform (ES5, guarded):**

```javascript
var preview = '';
if (thumb && /\/thumbs[^\/]+\//.test(thumb)) {
  preview = thumb
    .replace('.THUMBNUM.', '.1.')
    .replace(/\/thumbs[^\/]+\//, '/videopreview/')
    .replace(/\/[^\/]+$/, '')
    .replace(/-[0-9]+$/, '') + '_169.mp4';
}
```

**Placement:** immediately after the `thumb` assignment, before `items.push`.

**Push call change:**

```javascript
items.push({
  id: 'xnxx-' + rawId,
  source: 'xnxx',
  title: title,
  thumb: thumb,
  preview: preview,        // ← ADD
  url: videoUrl,
  duration: duration,
  views: 0
});
```

**Note:** If the produced URL resolves to a 404 (URL structure mismatch), the `<video>` element
will simply fail silently — acceptable per CORS degradation policy in §5.

---

### REQ-3 — pornhub `_parseHtmlCards()` (lines ~1755–1781)

**What:** Extract `data-mediabook` attribute from the same `chunk` window already used for
`data-mediumthumb` / `data-thumb_url`. The `chunk` window is `html.slice(m.index - 200,
m.index + 800)` — `data-mediabook` is on the `<a>` wrapper tag which sits within that window.

**Extraction (ES5):**

```javascript
var preview = _attr(chunk, /data-mediabook="([^"]+)"/) || '';
```

**Placement:** after the `thumb` line (line ~1768), before `items.push`.

**Push call change:**

```javascript
items.push({
  id: vkey,
  source: 'pornhub',
  title: title,
  thumb: thumb,
  preview: preview,        // ← ADD
  url: videoUrl,
  duration: duration,
  views: views
});
```

**Chunk window risk:** The `data-mediabook` attribute must fall within ±200/+800 chars of the
`href` match. Verify against a real pornhub browse HTML sample before implementation. If the
attribute is outside the window, the spec requires bumping the slice tail from `m.index + 800`
to `m.index + 1200` — this is a spec-required code change, not implementer discretion.

---

## 5. CORS Graceful Degradation (applies to all 3 adapters)

`_startPreview` sets `videoEl.src` directly — the browser's own `<video>` element makes the
request, **not** `cherryFetch`. If the CDN serving the preview clip lacks a
`Access-Control-Allow-Origin` response header, the browser will block the load silently.
The `play()` promise rejection is caught by the existing guard:

```javascript
videoEl.play().catch(function() {
  if (!videoEl.parentNode) return;
  // ... stops preview
});
```

This is acceptable — graceful degradation. A card with `preview` set but a CORS-blocked
CDN is indistinguishable from a card with `preview: ''` from the user's perspective.

**Note:** Adding CDN hostnames to `PROXY_URL_2_HOSTS` has no effect on preview delivery —
`<video src>` requests are made directly by WebView and bypass `cherryFetch` entirely.

**CORS pre-check required (open item — see §7):** Before merging, verify each adapter's CDN:
- Run `curl -I -H 'Origin: null' <sample-preview-url>` — Lampa may run with a null or
  `file://` origin in TV WebView environments; some CDNs reject non-https origins even when
  returning `ACAO: *` for normal requests.
- If `Access-Control-Allow-Origin` is absent, that adapter's `preview` must be set to `''`
  until a proxy path is confirmed.

**Android:** `_isAndroid()` guard at line ~746 already prevents `_startPreview()` from being
called. Setting `video.preview` on Android is harmless.

---

## 6. ES5 Constraints (hard rules, entire file)

- `var` only — no `let`, `const`.
- No arrow functions, no template literals, no destructuring.
- Regex flags: only `g`, `i`, `m` — no `s`, `u`, `y`.
- No `Object.assign`, `Array.from`, `for...of`, spread.
- String concatenation instead of template literals.
- `Array.isArray` is **not allowed** — use `x instanceof Array`.
- `.finally()` on Promises is **not allowed** — Lampa's runtime may use a polyfill lacking `.finally()`.

---

## 7. Open Questions (must resolve before implementation)

| # | Question | Owner | Impact |
|---|----------|-------|--------|
| OQ-1 | xvideos preview CDN CORS: does `cdn77.xvideos-cdn.com` serve `Access-Control-Allow-Origin: *` on `_169.mp4` URLs? Verify with `curl -H 'Origin: null'` — Lampa may run with a null or file:// origin in TV WebView. | implementer | If no CORS → set `preview: ''` |
| OQ-2 | xnxx preview CDN CORS. Sub-question A: Is CDN CORS-open (`curl -H 'Origin: null'` check)? Sub-question B: Is CDN IP-reachable from Cloudflare/Deno egress IPs (independent of CORS)? Both must pass. Verify with `curl -H 'Origin: null'` as Lampa may run with null/file:// origin. | implementer | If no CORS → set `preview: ''` |
| OQ-3 | pornhub `data-mediabook` CDN CORS: is `di.phncdn.com` or similar CORS-open for `<video src>` direct use? Verify with `curl -H 'Origin: null'`. | implementer | If no CORS → set `preview: ''` |
| OQ-4 | pornhub chunk window: confirm `data-mediabook` attribute is within 200 chars before `href` match or 800 chars after. If outside window, bump slice tail to +1200 (spec-required). | implementer | May require slice tail bump to +1200 |
| OQ-5 | xnxx `_169.mp4` URL construction: verify the guarded transform produces a valid URL against live xnxx browse HTML (thumb URL must contain `/thumbsXXX/` segment). | implementer | If thumb lacks segment → preview stays `''` |

---

## 8. Acceptance Criteria

### Unit tests (vitest, `test/cherry-engine.test.mjs`)

**AC-P1 — xvideos preview field populated:**
Given browse HTML:
```html
<div class="thumb-block"><a href="/video.abc123/slug"><img data-src="https://cdn.xvideos-cdn.com/thumbs169lll/12/34/56/thumb.THUMBNUM.jpg"></a></div>
```
`_parseCards()` must return a card where `preview` matches `/_169\.mp4$/`.

**AC-P2 — xvideos preview empty when no thumb:**
Given a thumb-block with a valid `/video.TOKEN/` href but no `data-src` attribute,
`_parseCards()` returns a card with `preview === ''`. No exception thrown.

**AC-P3 — xnxx preview field populated:**
Given browse HTML with an xnxx thumb block:
```html
<div class="thumb-block"><a href="/video1234567/slug"><img data-src="https://cdn.xnxx-cdn.com/thumbs169lll/12/34/56/thumb.THUMBNUM.jpg"></a></div>
```
`_parseCards()` returns a card with `preview` ending in `_169.mp4` or `preview === ''`
(transform defensive — no exception thrown either way).

**AC-P4 — pornhub preview from `data-mediabook`:**
Given a pornhub HTML chunk:
```html
<a href="/view_video.php?viewkey=abc123" data-mediabook="https://cdn.phncdn.com/foo.mp4"><img data-mediumthumb="https://cdn.phncdn.com/thumb.jpg"></a>
```
`_parseHtmlCards()` returns a card where `preview === 'https://cdn.phncdn.com/foo.mp4'`.

**AC-P5 — pornhub preview empty when attribute absent:**
Given a pornhub chunk with no `data-mediabook`, `_parseHtmlCards()` returns a card with
`preview === ''`. No exception thrown.

**AC-P6 — Fav invariant unchanged:**
Call `Fav.toggle` with a VideoCard that has `preview` set. Call `Fav.all()[0]` and assert
`result.preview === undefined`. (Runtime assertion, not a grep.)

### E2E / manual verification

**AC-E1:** Browse xvideos → hover a card → `<video>` element `src` attribute is non-empty
and ends in `_169.mp4`. (Requires OQ-1 CORS check to pass.)

**AC-E2:** Browse pornhub → hover a card → `<video>` element `src` attribute is non-empty.
(Requires OQ-3 CORS check to pass.)

**AC-E2b:** Browse xnxx → hover a card → `<video>` src ends in `_169.mp4`. (Conditional on
OQ-2 and OQ-5 resolution; if CDN unreachable, src stays empty and no JS error.)

**AC-E3:** No regression on existing E2E suite (`node test/cherry-lampa-e2e.mjs`) — all
previously-passing sources remain passing. Preview fields are best-effort; absence of
`video.preview` in E2E results is not a failure unless AC-E1/E2/E2b are explicitly added.

---

## 9. SpankBang Exclusion — Explicit Confirmation

SpankBang is explicitly out of scope for this task with two distinct statuses:
- **Quality-map regex** (`qRe` pattern in Phase 1 of `getStream`): done (committed 2026-05-28).
- **`video.preview` in `_parseCards`**: not done — SpankBang CDN has no equivalent `_169.mp4`
  preview clip system. Deferred to a future task pending CDN investigation.

The `ru.spankbang.com` adapter is **read-only** for this task.
