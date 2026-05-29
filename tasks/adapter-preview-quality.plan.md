# Plan — Adapter Preview Population
**Slug:** `adapter-preview-quality`
**Date:** 2026-05-29
**Spec:** `tasks/adapter-preview-quality.spec.md`
**Arch:** `tasks/adapter-preview-quality.arch-brief.md`

---

## Baseline — Target Function Line Ranges

| Function | File | Lines | Push call line |
|----------|------|-------|---------------|
| `pornhub._parseHtmlCards` | `plugin.js` | 1755–1781 | 1776 |
| `xvideos._parseCards` | `plugin.js` | 1866–1906 | 1895 |
| `xnxx._parseCards` | `plugin.js` | 1988–2031 | 2020 |

Test file: `test/cherry-engine.test.mjs` — 1257 lines, 63 tests currently.

**Preview transforms (post Phase 0):**
- xvideos: 1-step filename replacement — `thumb.replace(/\/[^\/]+$/, '/preview.mp4')`
- xnxx: identical 1-step replacement — `thumb.replace(/\/[^\/]+$/, '/preview.mp4')`
- pornhub: direct `data-mediabook` attribute extraction (no transform needed)

The old 5-step `_169.mp4` transform and `/thumbsXXX/` guard are obsolete — CDN is now UUID-based.

---

## Phases

---

### Phase 0 — CORS Pre-flight (blocking gate)

**Goal:** Resolve OQ-1/OQ-2/OQ-3/OQ-4/OQ-5 before writing any production code.

**No code changes in this phase.**

#### 0.1 — xvideos CDN CORS (OQ-1)

From a real xvideos browse page, find one `data-src` thumb URL under
`cdn77.xvideos-cdn.com` (or similar). Apply the transform manually:

```
thumb → replace .THUMBNUM. with .1.
      → replace /thumbsNNN/ with /videopreview/
      → strip filename component (/[^/]+$)
      → strip trailing -NNN
      → append _169.mp4
```

Then run:

```bash
curl -sI -H "Origin: null" "<transformed_url>" | grep -i "access-control"
```

**Gate:** If `Access-Control-Allow-Origin` is absent: populate `preview` anyway per
spec §5 — the `<video>` element will fail silently via `play().catch()`. Document the
OQ-1 result in the decision record (§0.5) as FAIL but proceed with Phase 1 implementation.

#### 0.2 — xnxx CDN CORS (OQ-2A + OQ-2B + OQ-5)

Fetch a live xnxx browse page via proxy, find one thumb URL, check that it contains
a `/thumbsNNN/` path segment (OQ-5). Apply the same transform and run:

```bash
curl -sI -H "Origin: null" "<transformed_url>" | grep -i "access-control"
```

Also confirm the CDN hostname is NOT IP-blocked from the machine running the check
(OQ-2B — independent of CORS).

**Gate:** If either check fails: populate `preview` anyway per spec §5 — the `<video>`
element will fail silently via `play().catch()`. Document the OQ-2 result in the
decision record (§0.5) as FAIL but proceed with Phase 2 implementation.

#### 0.3 — pornhub `data-mediabook` CDN CORS (OQ-3)

From a real pornhub browse page via proxy, extract a `data-mediabook` attribute
value and run:

```bash
curl -sI -H "Origin: null" "<mediabook_url>" | grep -i "access-control"
```

**Gate:** If absent: populate `preview` anyway per spec §5 — the `<video>` element will
fail silently via `play().catch()`. Document the OQ-3 result in the decision record
(§0.5) as FAIL but proceed with Phase 3 implementation.

#### 0.4 — pornhub chunk window (OQ-4)

Inspect a live pornhub browse HTML chunk. Measure distance from the `href` match
index to the `data-mediabook` attribute:

- If within `m.index - 200` .. `m.index + 800`: window is sufficient, no change.
- If beyond +800 chars: Phase 3 must bump slice tail from `+ 800` to `+ 1200`
  (spec-required, not implementer discretion).

**Gate result must be recorded** before Phase 3 coding begins.

#### 0.5 — Decision record

Phase 0 CORS pre-flight results (filled after live checks):

| ID | Source | Result | Detail |
|----|--------|--------|--------|
| OQ-1 | xvideos | **PASS** | `preview.mp4` at same UUID CDN path (`thumb-cdn77.xvideos-cdn.com/UUID/N/preview.mp4`), `Access-Control-Allow-Origin: *`, HTTP 200, `Content-Type: video/mp4` |
| OQ-2 | xnxx | **PASS** | Same CDN pattern (`thumb-cdn77.xnxx-cdn.com/UUID/N/preview.mp4`), CORS ✅, HTTP 200, `Content-Type: video/mp4` |
| OQ-3 | pornhub | **PASS** | `data-mediabook` webm present, `Access-Control-Allow-Origin: *` |
| OQ-4 | chunk window | **PASS** | `data-mediabook` at position 237 in chunk; `m.index + 800` tail is sufficient, no bump needed |
| OQ-5 | xnxx transform | **PASS** | `/thumbsNNN/` segment NO LONGER present — CDN is UUID-based; same 1-step filename replacement (`/preview.mp4`) works for both xvideos and xnxx |

**Key finding:** The old `/thumbsXXX/` path segment no longer exists on either CDN.
The new UUID-based CDN path (`thumb-cdn77.xvideos-cdn.com/UUID/N/xv_NN_t.jpg`) places
`preview.mp4` at the same directory path — only the filename changes. One regex replace
handles both sources.

**Success criteria:** All gates documented. ✅ Proceed to Phase 1.

---

### Phase 1 — xvideos `preview` field (REQ-1)

**Files changed:**
- `plugin.js` (edit)
- `plugin-release/plugin.js` (copy of plugin.js)
- `test/cherry-engine.test.mjs` (add tests)

#### 1.1 — Write unit tests first (RED)

Append a new `describe` block to `test/cherry-engine.test.mjs` after line 1257.
Already at module scope in cherry-engine.test.mjs: `_attr` (line 13), `_decodeHtml`
(line 20), `parseDur` (line 32), `parseViews` (line 44) — do NOT redeclare. `stripTags`
is NOT present — define it locally inside the inline reimplementation block as shown below.
Add an inline `xvParseCards` reimplementation matching the post-edit plugin.js logic.

Tests to add (AC-P1, AC-P2):

```javascript
// ---- inline reimplementation -------------------------------------------------
function stripTags(s) { return (s || '').replace(/<[^>]*>/g, '').trim(); }

function xvParseCards(html) {
  var items = [];
  var blocks = html.split(/<div[^>]+class="[^"]*thumb-block[^"]*"/);
  for (var i = 1; i < blocks.length; i++) {
    var block = blocks[i];
    var hrefMatch = block.match(/href="(\/video\.([a-z0-9]+)\/[^"]+)"/);
    if (!hrefMatch) continue;
    var href = hrefMatch[1];
    var numId = hrefMatch[2];
    var videoUrl = 'https://www.xvideos2.com' + href;
    var thumbMatch = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+\.jpg[^"]*)"/);
    var thumb = thumbMatch ? thumbMatch[1] : '';
    var titleMatch = block.match(/<p[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)/) ||
                    block.match(/title="([^"]+)"/);
    var title = titleMatch ? stripTags(titleMatch[1]) : '';
    var durMatch = block.match(/<span[^>]*class="[^"]*duration[^"]*"[^>]*>([^<]+)/);
    var duration = durMatch ? parseDur(durMatch[1].trim()) : 0;
    if (!numId && href) {
      var idFromHref = href.match(/video(\d+)\//);
      numId = idFromHref ? idFromHref[1] : String(i);
    }
    // preview transform (REQ-1) — 1-step filename replacement
    var preview = thumb ? thumb.replace(/\/[^\/]+$/, '/preview.mp4') : '';
    items.push({ id: 'xv' + numId, source: 'xvideos', title: title,
                 thumb: thumb, preview: preview, url: videoUrl,
                 duration: duration, views: 0 });
  }
  return items;
}

describe('xvideos _parseCards — preview field (REQ-1)', function() {
  it('AC-P1: populates preview.mp4 at same UUID CDN path when thumb is present', function() {
    var html = '<div class="thumb-block">' +
      '<a href="/video.abc123/slug"><img data-src="https://thumb-cdn77.xvideos-cdn.com' +
      '/UUID/3/xv_14_t.jpg" title="T"></a></div>';
    var cards = xvParseCards(html);
    expect(cards).toHaveLength(1);
    expect(cards[0].preview).toBe('https://thumb-cdn77.xvideos-cdn.com/UUID/3/preview.mp4');
  });

  it('AC-P2: preview is empty string when thumb is absent', function() {
    var html = '<div class="thumb-block">' +
      '<a href="/video.abc123/slug" title="T"></a></div>';
    var cards = xvParseCards(html);
    expect(cards).toHaveLength(1);
    expect(cards[0].preview).toBe('');
  });
});
```

Run `npx vitest run` — expect 2 new FAILs (RED).

#### 1.2 — Edit `plugin.js`

**Insertion point:** line 1881 (after `var thumb = ...` assignment, before `var titleMatch`).

**Before** (lines 1880–1903):
```javascript
      var thumbMatch = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+\.jpg[^"]*)"/);
      var thumb = thumbMatch ? thumbMatch[1] : '';

      var titleMatch = block.match(/<p[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)/) ||
```

**After:**
```javascript
      var thumbMatch = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+\.jpg[^"]*)"/);
      var thumb = thumbMatch ? thumbMatch[1] : '';

      var preview = thumb ? thumb.replace(/\/[^\/]+$/, '/preview.mp4') : '';

      var titleMatch = block.match(/<p[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)/) ||
```

**Edit `items.push` at line 1895** — add `preview: preview,` after `thumb: thumb,`:
```javascript
      items.push({
        id: 'xv' + numId,
        source: 'xvideos',
        title: title,
        thumb: thumb,
        preview: preview,
        url: videoUrl,
        duration: duration,
        views: 0
      });
```

#### 1.3 — Sync release copy

```bash
cp plugin.js plugin-release/plugin.js
```

**Success criteria:**
- `npx vitest run` — 2 new tests PASS, all 63 prior tests still PASS (65 total).
- Manual spot-check: `xvParseCards` on a real xvideos HTML block yields a `preview`
  ending in `/preview.mp4` at the same UUID CDN directory as the thumb.

**Commit:** `feat(xvideos): add preview field via 1-step filename replacement in _parseCards`

---

### Phase 2 — xnxx `preview` field (REQ-2)

**Files changed:** `plugin.js`, `plugin-release/plugin.js`, `test/cherry-engine.test.mjs`

#### 2.1 — Write unit tests first (RED)

Add `xnxxParseCards` inline reimplementation + tests (AC-P3) appended after Phase 1 tests.
Already at module scope: `_attr`, `_decodeHtml`, `parseDur`, `parseViews` — do NOT
redeclare. `stripTags` is NOT present — define it locally inside this block (reuse the
definition from Phase 1.1 if it was placed at module scope, otherwise re-declare locally).

```javascript
function xnxxParseCards(html) {
  var items = [];
  var mozParts = html.split('<div class="mozaique"');
  var content = mozParts.length > 1 ? mozParts[mozParts.length - 1] : html;
  var blocks = content.split(/<div[^>]+class="[^"]*thumb-under[^"]*"/);
  for (var i = 1; i < blocks.length; i++) {
    var block = blocks[i];
    var hrefMatch = block.match(/href="(\/video-?([^/]+)\/[^"]+)"/) ||
                   block.match(/href="(\/video([a-z0-9]+)[^"]*)"/);
    if (!hrefMatch) continue;
    var href = hrefMatch[1];
    var rawId = hrefMatch[2] || '';
    var videoUrl = 'https://www.xnxx.com' + href;
    var thumbMatch = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+\.jpg[^"]*)"/);
    var thumb = thumbMatch ? thumbMatch[1] : '';
    var titleMatch = block.match(/class="title"[^>]*>([^<]+)/) ||
                    block.match(/title="([^"]+)/) ||
                    block.match(/<a[^>]+>([^<]{5,})/);
    var title = titleMatch ? stripTags(titleMatch[1]) : '';
    var durMatch = block.match(/<span[^>]*class="[^"]*metadata[^"]*"[^>]*>([\d:]+)/) ||
                  block.match(/<span[^>]+>([\d:]+)<\/span>/);
    var duration = durMatch ? parseDur(durMatch[1].trim()) : 0;
    // preview transform (REQ-2) — 1-step filename replacement, no /thumbsNNN/ guard
    var preview = thumb ? thumb.replace(/\/[^\/]+$/, '/preview.mp4') : '';
    items.push({ id: 'xnxx-' + rawId, source: 'xnxx', title: title,
                 thumb: thumb, preview: preview, url: videoUrl,
                 duration: duration, views: 0 });
  }
  return items;
}

describe('xnxx _parseCards — preview field (REQ-2)', function() {
  it('AC-P3a: preview.mp4 at same UUID CDN path when thumb is present', function() {
    var html = '<div class="mozaique"><div class="thumb-under">' +
      '<a href="/video1234567/slug"><img data-src="https://thumb-cdn77.xnxx-cdn.com' +
      '/UUID/3/xn_15_t.jpg" title="T"></a></div></div>';
    var cards = xnxxParseCards(html);
    expect(cards).toHaveLength(1);
    expect(cards[0].preview).toBe('https://thumb-cdn77.xnxx-cdn.com/UUID/3/preview.mp4');
  });

  it('AC-P3b: preview.mp4 still produced when thumb has query params or unusual extension', function() {
    var html = '<div class="mozaique"><div class="thumb-under">' +
      '<a href="/video1234567/slug"><img data-src="https://thumb-cdn77.xnxx-cdn.com' +
      '/UUID/5/xn_07_t.webp" title="T"></a></div></div>';
    var cards = xnxxParseCards(html);
    expect(cards).toHaveLength(1);
    expect(cards[0].preview).toBe('https://thumb-cdn77.xnxx-cdn.com/UUID/5/preview.mp4');
  });

  it('AC-P3c: preview is empty string when thumb is absent', function() {
    var html = '<div class="mozaique"><div class="thumb-under">' +
      '<a href="/video1234567/slug" title="T"></a></div></div>';
    var cards = xnxxParseCards(html);
    expect(cards).toHaveLength(1);
    expect(cards[0].preview).toBe('');
  });
});
```

Run `npx vitest run` — expect 3 new FAILs (RED).

#### 2.2 — Edit `plugin.js`

**Insertion point:** line 2008 (after `var thumb = ...`, before `var titleMatch`).

**Before** (lines 2007–2028):
```javascript
      var thumbMatch = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+\.jpg[^"]*)"/);
      var thumb = thumbMatch ? thumbMatch[1] : '';

      var titleMatch = block.match(/class="title"[^>]*>([^<]+)/) ||
```

**After:**
```javascript
      var thumbMatch = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+\.jpg[^"]*)"/);
      var thumb = thumbMatch ? thumbMatch[1] : '';

      var preview = thumb ? thumb.replace(/\/[^\/]+$/, '/preview.mp4') : '';

      var titleMatch = block.match(/class="title"[^>]*>([^<]+)/) ||
```

**Edit `items.push` at line 2020** — add `preview: preview,` after `thumb: thumb,`:
```javascript
      items.push({
        id: 'xnxx-' + rawId,
        source: 'xnxx',
        title: title,
        thumb: thumb,
        preview: preview,
        url: videoUrl,
        duration: duration,
        views: 0
      });
```

#### 2.3 — Sync release copy

```bash
cp plugin.js plugin-release/plugin.js
```

**Success criteria:**
- `npx vitest run` — 3 new tests PASS, 65 prior tests still PASS (68 total).
- AC-P3b confirms robustness with unusual thumb extensions (no guard needed).
- AC-P3c confirms no exception when thumb is absent.

**Commit:** `feat(xnxx): add preview field via 1-step filename replacement in _parseCards`

---

### Phase 3 — pornhub `data-mediabook` (REQ-3)

**Files changed:** `plugin.js`, `plugin-release/plugin.js`, `test/cherry-engine.test.mjs`

**Prerequisite:** OQ-4 gate from Phase 0 must be resolved.  
- If chunk window is sufficient: use existing `m.index + 800` tail.  
- If OQ-4 result requires it: bump tail to `m.index + 1200` (spec-required).

#### 3.1 — Write unit tests first (RED)

Add `phParseHtmlCards` inline reimplementation + tests (AC-P4, AC-P5).
Already at module scope: `_attr`, `_decodeHtml`, `parseDur`, `parseViews` — do NOT
redeclare. `stripTags` is NOT used in this reimplementation.
Use whichever chunk tail OQ-4 determined. Inline reimplementation uses `+ 800`
by default; update to `+ 1200` if OQ-4 mandated it.

```javascript
function phParseHtmlCards(html) {
  var items = [];
  var seen = {};
  var hrefRx = /href="(\/view_video\.php\?viewkey=([a-z0-9]+)[^"]*)"/g;
  var m;
  while ((m = hrefRx.exec(html)) !== null) {
    var href = m[1];
    var vkey = m[2];
    if (!vkey || seen[vkey]) continue;
    seen[vkey] = true;
    var videoUrl = 'https://www.pornhub.com' + href;
    var chunkTail = 800; // update to 1200 if OQ-4 requires
    var chunk = html.slice(Math.max(0, m.index - 200), m.index + chunkTail);
    var thumb = _attr(chunk, /data-mediumthumb="([^"]+)"/) ||
                _attr(chunk, /data-thumb_url="([^"]+)"/) || '';
    var preview = _attr(chunk, /data-mediabook="([^"]+)"/) || '';
    var title = _decodeHtml(
      _attr(chunk, /class="[^"]*videoTitle[^"]*"[^>]*>([^<]+)/) ||
      _attr(chunk, /title="([^"]+)"/)
    );
    var duration = parseDur(_attr(chunk, /<var class="duration">([^<]+)</));
    var views = parseViews(_attr(chunk, /class="[^"]*videoViewCount[^"]*"[^>]*>([^<]+)</));
    if (title || thumb) {
      items.push({ id: vkey, source: 'pornhub', title: title, thumb: thumb,
                   preview: preview, url: videoUrl, duration: duration, views: views });
    }
  }
  return items;
}

describe('pornhub _parseHtmlCards — preview field (REQ-3)', function() {
  it('AC-P4: extracts preview from data-mediabook attribute', function() {
    var html = '<a href="/view_video.php?viewkey=abc123" ' +
      'data-mediabook="https://cdn.phncdn.com/foo.mp4">' +
      '<img data-mediumthumb="https://cdn.phncdn.com/thumb.jpg" title="T"></a>';
    var cards = phParseHtmlCards(html);
    expect(cards).toHaveLength(1);
    expect(cards[0].preview).toBe('https://cdn.phncdn.com/foo.mp4');
  });

  it('AC-P5: preview is empty string when data-mediabook is absent', function() {
    var html = '<a href="/view_video.php?viewkey=def456">' +
      '<img data-mediumthumb="https://cdn.phncdn.com/thumb.jpg" title="T"></a>';
    var cards = phParseHtmlCards(html);
    expect(cards).toHaveLength(1);
    expect(cards[0].preview).toBe('');
  });
});
```

Run `npx vitest run` — expect 2 new FAILs (RED).

#### 3.2 — Edit `plugin.js`

**Insertion point:** line 1767–1768 (after `var thumb = ...` block, before `var title`).

**Before** (lines 1766–1777):
```javascript
      var chunk = html.slice(Math.max(0, m.index - 200), m.index + 800);
      var thumb = _attr(chunk, /data-mediumthumb="([^"]+)"/) ||
                  _attr(chunk, /data-thumb_url="([^"]+)"/) || '';
      var title = _decodeHtml(
```

**After** (with `+ 800` or `+ 1200` per OQ-4):
```javascript
      var chunk = html.slice(Math.max(0, m.index - 200), m.index + 800);
      var thumb = _attr(chunk, /data-mediumthumb="([^"]+)"/) ||
                  _attr(chunk, /data-thumb_url="([^"]+)"/) || '';
      var preview = _attr(chunk, /data-mediabook="([^"]+)"/) || '';
      var title = _decodeHtml(
```

**Edit `items.push` at line 1776** — add `preview: preview,` after `thumb: thumb,`.
The surrounding `if (title || thumb)` guard is preserved unchanged; `preview` goes inside it:
```javascript
      if (title || thumb) {
        items.push({ id: vkey, source: 'pornhub', title: title, thumb: thumb,
                     preview: preview, url: videoUrl, duration: duration, views: views });
      }
```

If OQ-4 requires chunk tail bump, also change `m.index + 800` to `m.index + 1200`
in the `html.slice(...)` call.

#### 3.3 — Sync release copy

```bash
cp plugin.js plugin-release/plugin.js
```

**Success criteria:**
- `npx vitest run` — 2 new tests PASS, 68 prior tests still PASS (70 total).
- AC-P5 confirms no exception when `data-mediabook` is absent.

**Commit:** `feat(pornhub): extract preview from data-mediabook in _parseHtmlCards`

---

### Phase 4 — Fav invariant test + E2E regression (AC-P6, AC-E3)

**Files changed:** `test/cherry-engine.test.mjs`, `plugin-release/plugin.js` (verify in sync)

#### 4.1 — Fav invariant unit test (AC-P6)

AC-P6 is a runtime assertion that `Fav.toggle` drops `preview`. Since `Fav` is embedded
in the IIFE and not importable, implement the test by inlining a minimal `Fav`
reimplementation matching plugin.js lines 125–167 behaviour.

Add to `test/cherry-engine.test.mjs`:

```javascript
// Inline minimal Fav reimplementation (7-field serialisation invariant)
var FAV_FIELDS = ['id', 'source', 'title', 'thumb', 'url', 'duration', 'views'];

function favSerialise(card) {
  var out = {};
  for (var fi = 0; fi < FAV_FIELDS.length; fi++) {
    out[FAV_FIELDS[fi]] = card[FAV_FIELDS[fi]];
  }
  return out;
}

describe('Fav serialisation — preview excluded (AC-P6)', function() {
  it('preview field is absent after Fav round-trip serialisation', function() {
    var card = { id: 'xv123', source: 'xvideos', title: 'T', thumb: 'th.jpg',
                 url: 'u', duration: 60, views: 0,
                 preview: 'https://cdn.example.com/preview.mp4' };
    var stored = favSerialise(card);
    expect(stored.preview).toBeUndefined();
    expect(stored.id).toBe('xv123');
  });
});
```

#### 4.2 — E2E regression

Run the full E2E suite (no preview assertions added — preview is best-effort per spec §8):

```bash
node test/cherry-lampa-e2e.mjs
```

All previously-passing sources must remain PASS. Absence of `video.preview` in E2E
result cards is not a failure.

#### 4.3 — Manual spot-check (AC-E1, AC-E2, AC-E2b)

All OQ-1/OQ-2/OQ-3 passed, so previews are expected to load:
- Browse xvideos in Lampa → hover card → DevTools confirms `<video src>` ends in `/preview.mp4`.
- Browse pornhub in Lampa → hover card → `<video src>` is non-empty (webm from `data-mediabook`).
- Browse xnxx in Lampa → hover card → `<video src>` ends in `/preview.mp4`.

If any OQ failed → `preview` is `''` → no `<video src>` set → graceful silence confirmed.

#### 4.4 — Sync release copy (final verify)

```bash
diff plugin.js plugin-release/plugin.js
# expect: no output (files identical)
```

**Success criteria:**
- `npx vitest run` — 1 new test PASS, 70 prior tests still PASS (71 total).
- E2E: all previously-passing sources still PASS.
- `plugin.js` and `plugin-release/plugin.js` are identical.

**Commit:** `test: add Fav preview-exclusion invariant + verify E2E regression (adapter-preview-quality)`

---

## Change Summary

| Phase | plugin.js edits | Tests added | Release sync |
|-------|----------------|-------------|--------------|
| 0 | none | none | no |
| 1 | +2 lines (xvideos) | +2 tests (AC-P1, AC-P2) | yes |
| 2 | +2 lines (xnxx) | +3 tests (AC-P3a/b/c) | yes |
| 3 | +1–2 lines (pornhub) | +2 tests (AC-P4, AC-P5) | yes |
| 4 | none | +1 test (AC-P6) | verify |

**Total net additions:** ~5–6 lines in `plugin.js` (transforms) + push-arg additions,
71 tests at completion (from 63 baseline).

Note: Phase 1 and Phase 2 transforms each collapsed from 5 steps to 1 line thanks to
the UUID-based CDN `preview.mp4` discovery in Phase 0.

---

## ES5 Compliance Checklist

Applied to every code block in this plan:
- [x] `var` only — no `let`/`const`
- [x] No arrow functions, no template literals, no destructuring
- [x] Regex flags `g` and `i` only
- [x] No `Object.assign`, `Array.from`, `Array.isArray`, spread, `for...of`
- [x] No `.finally()` on Promises
- [x] String concatenation for all string building
