# Plan — Multi-Source Video Playback Fix

**Spec:** `tasks/multi-source-video-fix.spec.md`
**Target:** `plugin.js` (~3700 lines, single-file IIFE)
**Mode:** spec-plan-code-loop FULL

---

## 1. Overview

Deliver the 8 REQs from the spec across **7 phases** in dependency order. Phases 0–1 are pure-code refactors (no live network needed) and ship first as a small, low-risk batch. Phase 2 is a dedicated **investigation phase** that produces the HTML fixtures and curl-confirmed answers blocking the regex/routing work in Phases 3–5. Phase 6 hardens the E2E gate so that all prior phases are verified by reachability — not just "url is a non-empty string". Each phase is independently shippable, has its own test gate, and updates `docs/CHERRY.md` lessons when it lands.

---

## 2. Phases

### Phase 0 — Foundations (no network)

**Covers:** REQ-1 (remove gayporntube) + REQ-7-PRE (px() double-proxy guard) + REQ-2 (extractStreams JWPlayer sources array branch).

**Why first:** All three are pure code-analysis changes. None require live HTML or curl confirmation. REQ-2 is a prereq for Phase 1 (porndig/ebun depend on a populated `quality` map from `extractStreams`). REQ-7-PRE is a prereq for Phase 5 (Candidate A double-wraps without it). REQ-1 is a trivial deletion that simplifies all later test runs.

**Steps:**

1. **REQ-1 — delete gayporntube** (`plugin.js`):
   - Delete the entire `SOURCES.push({ id: 'gayporntube', ... })` block at lines ~3633–3661.
   - Delete the orphaned helpers `_gayptCards` (~3663–3696) and `_gayptPages` (~3698–3708).
   - Open `test/cherry-lampa-e2e.mjs` and remove `'gayporntube'` from the tier-B array (currently line 36).
   - Open `tasks/cherry-e2e-baseline.json` and confirm `gayporntube` is **not** present (baseline already excludes it — verify only).
   - Sanity-check: `Grep -n gayporntube plugin.js test/` must return zero matches after this step.
   - Sanity-check: `SOURCES.length === 25` (was 26).

2. **REQ-7-PRE — px() guard for PROXY_URL_2** (`plugin.js:258`):
   - Inside the inner `px()` helper of `playVideo()`, immediately after the existing line `if (u.indexOf(PROXY_URL) === 0) return u;` (line 261), insert:
     ```js
     if (PROXY_URL_2 && u.indexOf(PROXY_URL_2) === 0) return u; // also skip Deno-proxied URLs
     ```
   - No other change to `playVideo`. This is the ONLY edit allowed to `playVideo()` in this task.

3. **REQ-2 — extractStreams sources-array branch** (`plugin.js:1214`):
   - Insert a new branch **before** the existing `jwRe` single-file scan (line 1227), implementing the two-step delimited extraction from spec §REQ-2:
     - Step 1: locate `/sources\s*:\s*\[/i` start, then walk the string with a bracket-depth + string-state scanner to find the matching `]`. Capture inner substring as `block`.
     - Step 2: walk each `{...}` object inside `block` with the same depth scanner. For each object substring, run independent `fileRe` and `labelRe` regexes. If both match and `!quality[label]`, insert into `quality`.
     - Skip objects whose `label` is missing — those contribute to `url` fallback only via the legacy `jwRe` scan below.
   - Do NOT remove or modify the existing `jwRe`, `srcRe`, `srcRe2`, `plainRe`, `kvs`, or the `if (!url && Object.keys(quality).length)` final-url selection. The new branch is purely additive.
   - Implementation detail: keep the scanner as a small inline function (e.g. `function findMatchingBracket(str, openIdx, openCh, closeCh)`) returning the closing index; reuse it for both Step 1 and Step 2.
   - **Scanner contract:** `findMatchingBracket(str, openIdx, openCh, closeCh)` — **precondition:** `str[openIdx] === openCh` (the scanner starts AT the opening bracket itself, NOT after it). Returns `closeIdx` where `str[closeIdx] === closeCh`. The scanner increments depth on the opener at `openIdx` (depth becomes 1) and returns when depth drops back to 0.
   - **Constraint:** `findMatchingBracket` MUST be declared as a local function inside `extractStreams`, NOT at module scope. This keeps it adapter-private and avoids creating a new module-level shared helper, consistent with the spec's "no new shared abstractions" constraint.
   - **String-escape rule (CRITICAL):** A single-character lookback like `if (c === strCh && html[i-1] !== '\\') inStr = false;` is **broken** because it falsely treats sequences like `\\"` (an escaped backslash followed by a real closing quote) as escaped quotes. Use a **backslash-parity** check instead:
     ```js
     // Count consecutive backslashes immediately before position i
     var bs = 0;
     for (var j = i - 1; j >= 0 && str[j] === '\\'; j--) bs++;
     // Quote is escaped only if backslash count is ODD; even (including 0) means a real string boundary
     if (bs % 2 === 0) { inStr = false; }
     ```

4. **Mirror the change in the test harness's copy of `extractStreams`** at `test/plugin-helpers.test.js:40` (the test file inlines the helper — keep it in sync with plugin.js).

5. **Add unit tests** to `test/plugin-helpers.test.js`:
   - `extractStreams: sources array file-then-label, 3 qualities` → `Object.keys(quality).length === 3`.
   - `extractStreams: sources array label-then-file, 2 qualities` → 2 keys.
   - `extractStreams: legacy single 'file': 'x.mp4' no array` → `quality === {}` and `url === 'x.mp4'` (back-compat).
   - `extractStreams: mixed sources array + standalone <source> tag` → both captured.
   - `extractStreams: source object with nested drm:{...}` → outer object correctly extracted, no break.
   - `extractStreams: duplicate label "720p"` → first wins.
   - `extractStreams: source object missing label` → not in `quality` map (`url` may still be set by legacy `jwRe`).
   - `extractStreams: source object whose 'file' value contains escaped backslashes (e.g. "https:\\/\\/cdn...")` → correctly parsed; the closing quote after `\\` is NOT misread as escaped. (Covers H1 — the backslash-parity escape rule.)
   - `findMatchingBracket: empty '[]'` → returns index of the adjacent `]` (precondition: input position is the `[`).
   - `findMatchingBracket: nested '[[]]'` → returns index of the OUTER `]`.
   - `findMatchingBracket: object with nested drm '{drm:{}}'` → correctly delimits the OUTER `{}`.
   - `findMatchingBracket: source string containing ']' inside a quoted value` → scanner is not confused by it; returns the real outer closing index.
   - **px() guard unit test (REQ-7-PRE):** inline-mirror `px()` and `buildProxyUrl()` from `playVideo` using a synthetic `PROXY_URL_2_HOSTS` map (no actual plugin mutation needed — the test constructs both helpers as local closures over a small in-test map). Assert: a URL whose result starts with the `PROXY_URL_2` prefix is returned UNCHANGED by `px()` — i.e. the returned string contains exactly ONE `/proxy?url=` occurrence and ZERO `%2Fproxy%3Furl%3D` (no double-wrap, no encoded `/proxy?url=` inside another `/proxy?url=`).

**Files changed:**
- `plugin.js` — MODIFY (3 surgical edits)
- `test/plugin-helpers.test.js` — MODIFY (sync extractStreams + add tests)
- `test/cherry-lampa-e2e.mjs` — MODIFY (drop gayporntube from tier B)

**Test gate (must all pass before Phase 1):**
- `npx vitest run test/plugin-helpers.test.js` — all existing tests pass + the new extractStreams tests (7 sources-array cases + 1 escaped-backslash case), the 4 new `findMatchingBracket` tests, and the new px() guard unit test all pass.
- `Grep -n gayporntube` across repo returns zero.
- Note: the px() guard is tested at the **unit** level here against a synthetic in-test `PROXY_URL_2_HOSTS` map. No mutation of `plugin.js`'s real `PROXY_URL_2_HOSTS` is required in Phase 0 — that extension lands in Phase 5. Phase 5 retains an integration-level assertion against the live map; the unit test for the guard logic lives here.

---

### Phase 1 — Quality map fixes (no network)

**Covers:** REQ-3 (porndig, ebun, lenporno best-quality selection).

**Depends on:** Phase 0 (REQ-2 must be merged — porndig and ebun rely on the new sources-array branch in `extractStreams`).

**Steps:**

1. **porndig.getStream** (`plugin.js:2693`):
   - Replace the body of the `m` branch (lines 2697–2702) with:
     ```js
     return cherryFetch(m[1]).then(function (ihtml) {
       var result = extractStreams(ihtml);
       if (result.url || Object.keys(result.quality).length) {
         var qKeys = Object.keys(result.quality);
         var best  = qKeys.length ? bestQualityUrl(result.quality) : result.url;
         return { url: best, quality: result.quality };
       }
       return extractStreams(html);
     }).catch(function () { return extractStreams(html); });
     ```
   - The outer `extractStreams(html)` fallback (line 2703) stays unchanged.

2. **ebun.getStream** (`plugin.js:3332`):
   - Inside the `iframeM` branch (lines 3336–3340), change:
     ```js
     var result = extractStreams(ihtml);
     return result.url ? result : { url: '', quality: {} };
     ```
     to:
     ```js
     var result = extractStreams(ihtml);
     if (result.url || Object.keys(result.quality).length) {
       var qKeys = Object.keys(result.quality);
       var best  = qKeys.length ? bestQualityUrl(result.quality) : result.url;
       return { url: best, quality: result.quality };
     }
     return { url: '', quality: {} };
     ```
   - **PRESERVE the outer fallback:** the outer `return extractStreams(html);` at line 3341 (which handles the no-iframe case where `iframeM` did not match) MUST remain unchanged. Only the iframe-branch inner return logic changes — do not touch the no-iframe code path.

3. **lenporno.getStream** (`plugin.js:3406`):
   - Inside the `pjRe` loop (lines 3417–3422), replace the body with a version that:
     - Computes `lbl` the same way as today (label-or-filename-extraction).
     - **If `lbl` does NOT match `/^\d{3,4}p?$/i`** (any non-numeric-quality label — covers `'mp4'`, `'4k'`, `'HD'`, `'SD'`, and any other malformed label) → do NOT insert into `quality`; instead, record `if (!best) best = m[2];` and skip.
     - Otherwise, insert `quality[lbl] = m[2]` and `if (!best) best = m[2]`.
   - The post-loop defensive strip is **not needed** — the in-loop regex guard above already prevents non-numeric keys from ever entering `quality`. Do not add a redundant second pass.
   - The existing `return { url: bestQualityUrl(quality) || best, quality: quality };` stays.

4. **Save fixtures** under `test/fixtures/`:
   - `porndig-iframe.html` — JWPlayer sources array with ≥2 qualities (can be a synthetic stripped-down fixture if a real save is blocked; the spec accepts any fixture that exercises the new branch).
   - `ebun-iframe.html` — same shape, from `666-emded.com/embed/`.
   - `lenporno-player.html` — must include at least one entry that exercises the unlabeled-URL fallback path (the bug case) AND one labeled multi-quality entry. Include TWO unlabeled URLs to verify the second does not overwrite the first via a shared fallback key.

5. **Add unit tests** to `test/plugin-helpers.test.js` (inline-mirror the three `getStream` bodies as needed, or test the post-`extractStreams` transformation as a pure function):
   - `porndig: multi-quality fixture → url === bestQualityUrl(quality), quality has ≥2 numeric keys`.
   - `ebun: multi-quality fixture → url === bestQualityUrl(quality), quality has ≥2 numeric keys`.
   - `lenporno: fixture with two unlabeled URLs + one labeled → no key === 'mp4'; first unlabeled URL is preserved as best when no labeled URL is higher`.
   - `lenporno: all keys match /^\d{3,4}p?$/i`.

**Files changed:**
- `plugin.js` — MODIFY (3 adapter bodies)
- `test/plugin-helpers.test.js` — MODIFY (4 new tests)
- `test/fixtures/porndig-iframe.html` — ADD
- `test/fixtures/ebun-iframe.html` — ADD
- `test/fixtures/lenporno-player.html` — ADD

**Test gate:**
- `npx vitest run test/plugin-helpers.test.js` — all green.
- `npx vitest run` (FULL unit suite) — zero regressions across the whole test directory.
- For each of the 3 adapters: `url === bestQualityUrl(quality)` whenever quality map is non-empty.
- No lenporno quality key equals `"mp4"` (and no key fails `/^\d{3,4}p?$/i`).

---

### Phase 2 — Live fixture investigation (no plugin code changes)

**Covers:** Investigation answers for Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8 from spec §4. Produces concrete inputs for Phases 3, 4, 5.

**Why a separate phase:** REQ-4, REQ-5, REQ-6 all require live HTML to write correct regexes. Writing speculative regexes from documentation would be wasted work. REQ-7 Candidate A cannot ship without curl confirmation that Deno actually reaches the CDN hosts.

**Steps:**

1. **Fetch and save HTML fixtures** for 6 adapters. Three acceptable methods (per fixture; use whichever works):

   - **Method A — via Cherry proxy from a shell** (preferred for hosts that already work through the CF Worker):
     ```
     curl "https://cherry-proxy.aawersom.workers.dev/proxy?url=<encoded-page-url>&key=1206" > test/fixtures/<adapter>-page.html
     ```
     **Handling non-200 responses from Method A:** if the curl returns a non-200 status code or an empty body, log the HTTP code into `tasks/multi-source-video-fix.fixtures-report.md` for that adapter and **switch to Method C** (do not silently retry Method A).
   - **Method B — via Playwright headed browser** (use when the page needs JS-rendered HTML or is blocked at the worker): launch a Playwright script that navigates to the page, waits for `networkidle`, and dumps `await page.content()` to the fixture file.
   - **Method C — direct browser save** (use when Methods A and B both return non-200 or empty HTML, i.e. the page is proxy-blocked but accessible from a normal residential browser): open the URL in a regular browser (Chrome/Firefox), use View Source (Ctrl+U), then save the raw view-source content as `test/fixtures/<adapter>-page.html`. This bypasses any proxy/automation block.

   Target URLs (one fresh real video per adapter):
   - `pornhub` — any `/view_video.php?viewkey=<key>` page. Save raw HTML AND a separate JSON file `test/fixtures/pornhub-flashvars.json` containing the parsed `flashvars_*` object so REQ-6 work can grep it directly.
   - `eporner` — `https://www.eporner.com/hd-porn/<id>/` for a fresh recent video.
   - `tizam` — `https://tv4.tizam.org/fil_my_dlya_vzroslyh/<sub>/<slug>/`.
   - `perfektdamen` — `https://perfektdamen.co/video/<id>/`.
   - `huyamba` — `https://fuq.huyamba.mobi/video/<id>/`.
   - `24rolika` — `https://w2.huyalkino.com/<cat>/<id>-<slug>.html`.

**Phase 5 input — enumerate all `sN.bigcdn.cc` hosts.** While saving the hqporner fixture (and during the Q7 investigation), grep for the COMPLETE set of `sN.bigcdn.cc` hostnames observed across the fixture and any companion CDN responses:
```
grep -oE 's[0-9]+\.bigcdn\.cc' hqporner-page.html | sort -u
```
Record the full deduplicated list in `tasks/multi-source-video-fix.fixtures-report.md` under the hqporner section. **Phase 5 will add EVERY observed hostname at once to `PROXY_URL_2_HOSTS`** — do NOT add only `s1` and `s2` and wait to discover `s3..sN` later in production. The enumeration happens here, in Phase 2.

2. **For each saved fixture, grep for stream surface markers** and record findings in `tasks/multi-source-video-fix.fixtures-report.md`. Use Grep tool with the following patterns per adapter:
   - `pornhub`: `flashvars_`, `mediaDefinitions`, `videoUrl`, `qualityItems`, `.m3u8`, `.mp4`. Confirm whether `videoUrl` is a direct `.mp4`/`.m3u8` string or a JSON-indirection endpoint.
   - `eporner`: `\.mp4`, `cdnAlias`, `EpornerVideo`, `EP.video`, `sources\s*:`, `_(\d{3,4})p?_`. Identify which regex Pattern (1 or 3 from spec §REQ-4) matches the live HTML.
   - `tizam`: `<source`, `<video`, `<iframe`, `\.mp4`, `\.m3u8`, `file\s*[:=]`, `data-src`. Decide whether `tizam.cc` CDN is still in use or replaced.
   - `perfektdamen`: `<iframe`, `player`, `embed`, `jwplayer`, `Playerjs`, `sources\s*:`. Decide if iframe-fetch is needed.
   - `huyamba`: `get_file/`, hostname of the CDN, `.mp4`, `.m3u8`. Confirm whether `get_file` paths are absolute or relative.
   - `24rolika`: `jwplayer`, `Playerjs`, `new Player`, `videoConfig`, `playerConfig`, `<iframe`, `file\s*[:=]`. Identify the player init style.

3. **Curl Q7 + Q8** through Deno proxy:
   ```
   # Q7 — bigcdn.cc through Deno
   curl -I "https://cherry-proxy.aawersom.deno.net/proxy?url=https%3A%2F%2Fs1.bigcdn.cc%2Fpubs%2F<hash>%2F720.mp4&key=1206"
   # Q8 — pornone CDN through Deno (replace <cdn-host>/<path> from Phase 2 step 1 pornone investigation)
   curl -I "https://cherry-proxy.aawersom.deno.net/proxy?url=https%3A%2F%2F<pornone-cdn-host>%2F<path>&key=1206"
   ```
   - Q7 needs a fresh `hqporner → mydaddy.cc → bigcdn.cc` URL extracted from a live hqporner video page. Either run `hqporner.getStream` manually in a browser console, or curl the chain by hand.
   - Q8 needs a fresh pornone CDN URL extracted from a live pornone video page (look for the actual stream host in the page's player config — likely `cdn.pornone.com` or similar).
   - **Concrete recipe to obtain a real bigcdn.cc URL for `<bigcdn-url>`:** open `https://hqporner.com/` in a browser, click any video, open DevTools → Network tab → filter by `.mp4`, copy the full URL of the first matching request.
   - **Concrete recipe to obtain a real pornone CDN URL for `<pornone-cdn-url>`:** same process on `https://pornone.com/` — open a video, DevTools → Network → filter by `.mp4`, copy the full URL.
   - Paste these URLs as the `<bigcdn-url>` / `<pornone-cdn-url>` placeholders in the curl commands above.
   - Record the exact CDN hostname(s) confirmed working through Deno in the fixtures-report. These hostnames feed Phase 5 directly.

4. **Write `tasks/multi-source-video-fix.fixtures-report.md`** with one section per adapter containing:
   - Source URL fetched
   - File path of saved fixture
   - Marker patterns found (excerpts)
   - Concrete regex(es) recommended for the Phase 3/4 adapter fix
   - For Q7/Q8 sections: curl command run, HTTP status returned, content-type, CDN hostname confirmed.

**Files created:**
- `test/fixtures/pornhub-page.html` — ADD
- `test/fixtures/pornhub-flashvars.json` — ADD
- `test/fixtures/eporner-page.html` — ADD
- `test/fixtures/tizam-page.html` — ADD
- `test/fixtures/perfektdamen-page.html` — ADD
- `test/fixtures/huyamba-page.html` — ADD
- `test/fixtures/24rolika-page.html` — ADD
- `tasks/multi-source-video-fix.fixtures-report.md` — ADD

**Test gate:**
- All 6 adapter HTML fixtures saved and non-empty (>1KB each).
- pornhub flashvars JSON parseable.
- Fixtures-report contains a concrete regex recommendation per adapter (not "TBD").
- Q7 and Q8 each have a recorded HTTP status code. If Q7 fails (403), Phase 5 Candidate A is downgraded to documented-block for hqporner only. If Q8 fails, same for pornone.

---

### Phase 3 — Simple parser fixes (after Phase 2)

**Covers:** REQ-5 (`tizam`, `perfektdamen`, `huyamba`, `24rolika`).

**Depends on:** Phase 2 fixtures-report (regex recommendations per adapter) + Phase 0 (REQ-2 extractStreams may be reused by `perfektdamen`).

**Steps:**

1. **tizam.getStream** (`plugin.js:2838`):
   - Read the recommended regex from fixtures-report §tizam.
   - Insert it as the FIRST attempt in the regex chain, before the existing `m` (line 2841).
   - **HLS invariant:** if the extracted URL ends in `.m3u8`, wrap it with `proxyM3u8(url, 'https://tv4.tizam.org/')` and return `{ url: blob, quality: {} }`. Return the raw MP4 URL only for `.mp4` URLs.
   - If the fixture shows the stream is now behind an iframe, add an iframe detect + `cherryFetch` + `extractStreams` chain before the local regex chain; apply the same m3u8 wrapping to any HLS result from `extractStreams`.
   - Existing `m2` (tizam.cc CDN fallback) and `fb = extractStreams(html)` stay; add m3u8 branch to the `fb` result: `if (fb.url && fb.url.endsWith('.m3u8')) return proxyM3u8(fb.url, 'https://tv4.tizam.org/').then(function(b) { return { url: b, quality: {} }; });`.

2. **perfektdamen.getStream** (`plugin.js:2878`):
   - Add an explicit iframe detection before `extractStreams(html)`:
     ```js
     var iframeM = /src="(https?:\/\/[^"]*(?:player|embed)[^"]*)"/i.exec(html);
     if (iframeM) {
       return cherryFetch(iframeM[1]).then(function (ihtml) {
         var result = extractStreams(ihtml);
         if (result.url || Object.keys(result.quality).length) {
           var qKeys = Object.keys(result.quality);
           var best  = qKeys.length ? bestQualityUrl(result.quality) : result.url;
           // HLS invariant: wrap any m3u8 through proxyM3u8 before returning
           if (best && best.indexOf('.m3u8') !== -1)
             return proxyM3u8(best, iframeM[1]).then(function(b) { return { url: b, quality: {} }; });
           return { url: best, quality: result.quality };
         }
         return extractStreams(html);
       }).catch(function () { return extractStreams(html); });
     }
     // HLS invariant for outer fallback
     var fb = extractStreams(html);
     if (fb.url && fb.url.indexOf('.m3u8') !== -1)
       return proxyM3u8(fb.url, video.url).then(function(b) { return { url: b, quality: {} }; });
     return fb;
     ```
   - **HLS invariant:** any `.m3u8` URL from either the iframe or the fallback path must go through `proxyM3u8()` before being returned.
   - **IMPORTANT — the `(?:player|embed)` iframe regex above is a PLACEHOLDER** until the Phase 2 perfektdamen fixture is available. After Phase 2 saves `test/fixtures/perfektdamen-page.html`, replace the generic `(?:player|embed)` pattern with a **host-specific** pattern that matches the actual video-player host found in the fixture (e.g. a specific subdomain or CDN host). The generic pattern risks picking up advertising/analytics iframes whose URLs happen to contain `player` or `embed`.
   - **Anti-ad-iframe unit test:** add a fixture-based unit test that asserts the chosen iframe URL is the real video player. Specifically: the extracted iframe URL MUST NOT contain `googletagmanager`, `doubleclick`, or `facebook` (case-insensitive). This guards against accidentally fetching a tracker/ad iframe.

3. **huyamba.getStream** (`plugin.js:3255`):
   - Replace the regex `/get_file\/(\d+\/[^"'\s<>]+\.(?:mp4|m3u8))/g` (line 3258) with the absolute-host pattern:
     ```js
     var gfRx = /(https?:\/\/[^"'\s<>]+\/get_file\/[^"'\s<>]+\.(?:mp4|m3u8)[^"'\s<>]*)/gi;
     ```
   - Update the loop body — `m[1]` is now the FULL URL, so drop the `'https://fuq.huyamba.mobi/get_file/' +` prefix concatenation.
   - The `_kvsPickBest(found)` call stays for MP4 URLs.
   - **HLS invariant:** after `_kvsPickBest(found)`, check if the best URL ends in `.m3u8`. If so, call `proxyM3u8(bestUrl, video.url)` and return `{ url: blob, quality: {} }` instead of returning the raw `.m3u8` URL.
   - The fallback `extractStreams(html)` stays; apply the same m3u8 branch to its result.
   - If Phase 2 fixture reveals relative-only paths, reopen this step to add a relative branch with explicit host-prepend (per spec REQ-5 §huyamba note).

4. **24rolika.getStream** (`plugin.js:3490`):
   - If Phase 2 fixture reveals one specific player init style (e.g. PlayerJS-only), replace the existing JWPlayer regex with a single targeted pattern for that style.
   - Otherwise, prepend two additional patterns before the existing `jwRx`:
     - `Playerjs(...)` style: `/Playerjs\s*\([^)]*file\s*[:=]\s*['"]([^'"]+\.(?:mp4|m3u8))['"]/i`
     - Scoped player-config: for each keyword in `[playerjs, jwplayer, 'new Player', 'Playerjs', videoConfig, playerConfig]` (case-insensitive), find its first index in `html`, slice 500 chars forward, and run `/['"]?file['"]?\s*[:=]\s*['"]([^'"]+\.(?:mp4|m3u8)[^'"]*)['"]/i` against the slice. First non-empty match wins.
     - Iframe-then-extract: detect `<iframe src="...">` and recurse via `cherryFetch` + `extractStreams`.
   - Loose generic `(?:file|source|src)` fallback is intentionally NOT added (per spec §REQ-5).
   - **HLS invariant:** for any extracted URL ending in `.m3u8` (from JWPlayer, Playerjs, or scoped pattern), call `proxyM3u8(url, video.url)` and return the blob URL instead of the raw `.m3u8` URL.

5. **Add unit tests per adapter** in `test/plugin-helpers.test.js`, each loading the corresponding fixture from `test/fixtures/<adapter>-page.html` via `readFileSync`, running the adapter-internal regex chain (or a pure-function extraction extracted from `getStream`), and asserting:
   - `url` is non-empty
   - `url` starts with `http`
   - `url` does NOT end in `.html` (no HTML-as-stream regression)

**Files changed:**
- `plugin.js` — MODIFY (4 adapter bodies)
- `test/plugin-helpers.test.js` — MODIFY (5 new tests: 4 per-adapter extraction + 1 perfektdamen anti-ad-iframe assertion)

**Test gate:**
- `npx vitest run test/plugin-helpers.test.js` — all green.
- `npx vitest run` (FULL unit suite) — zero regressions across the whole test directory.
- E2E (full run) shows tizam/perfektdamen/huyamba/24rolika each return non-empty `url` and pass the Phase 6 reachability check (when Phase 6 lands).

---

### Phase 4 — API / complex parser fixes (after Phase 2)

**Covers:** REQ-4 (`eporner`) + REQ-6 (`pornhub`).

**Depends on:** Phase 2 fixtures-report (Q1 + Q2 answers).

**Steps:**

1. **eporner.getStream** (`plugin.js:1661`):
   - Replace the body. New structure:
     ```js
     var pageUrl = 'https://www.eporner.com/hd-porn/' + video.id + '/';
     return cherryFetch(pageUrl).then(function (html) {
       var result = _epornerExtract(html);
       if (result.url) return result;
       // Embed-HTML fallback
       return cherryFetch('https://www.eporner.com/embed/' + video.id + '/').then(function (ehtml) {
         var r2 = _epornerExtract(ehtml);
         return r2.url ? r2 : { url: '', quality: {} };
       }).catch(function () { return { url: '', quality: {} }; });
     }).catch(function () { return { url: '', quality: {} }; });
     ```
   - The bug-fix nut: **never return an HTML page URL as `result.url`**. The final fallback is `{ url: '', quality: {} }`.
   - Add a new module-private helper `_epornerExtract(html)` near eporner adapter body:
     - **Gating check (run BEFORE implementing Pattern 1):** confirm via the Phase 2 fixtures-report that at least one quoted `.mp4` URL with an embedded resolution label appears in the saved `eporner-page.html` fixture. Concrete grep:
       ```
       grep -oE 'eporner\.com[^"'"'"' ]*_[0-9]+p[^"'"'"' ]*\.mp4' test/fixtures/eporner-page.html
       ```
       - If the grep returns at least one match → **proceed with Pattern 1 below.**
       - If the grep returns empty (URLs are JS-concatenated at runtime, never literal in the static HTML) → **skip Pattern 1 entirely** and implement an API-based approach per the Q2 resolution in the fixtures-report instead. Document the chosen branch (Pattern 1 vs API) explicitly in `tasks/multi-source-video-fix.fixtures-report.md` under the eporner section so reviewers can trace the decision.
     - Pattern 1 (only if gating check passed): `var src1 = /["'](https?:\/\/[^"'\s]+eporner\.com\/[^"'\s]+_(\d{3,4})p?_[^"'\s]+\.mp4[^"'\s]*)["']/gi;`
     - Loop with `src1.exec`; group 2 → `quality[g2 + 'p'] = g1`.
     - If `quality` is empty, run Pattern 3: `var src3 = /(https?:\/\/[^"'\s]*eporner[^"'\s]*\/(\d{3,4})p?[^"'\s]*\.mp4[^"'\s]*)/gi;` (broader; gated behind Pattern 1 failure).
     - Wrap each URL in `buildProxyUrl(rawUrl, 'https://www.eporner.com/')` so the eporner CDN sees a proper referer.
     - Return `{ url: bestQualityUrl(quality), quality: quality }`.
   - Pattern 2 from spec is intentionally NOT implemented; defer if Q2 reveals a JSON API endpoint, in which case replace the page-scrape path with an API fetch.

2. **pornhub.getStream** (`plugin.js:1378`):
   - Drop the `\s*\n` requirement in the primary flashvars regex (line 1380): change `/var\s+flashvars_\d+\s*=\s*(\{[\s\S]+?\});\s*\n/` to `/var\s+flashvars_\d+\s*=\s*(\{[\s\S]+?\})\s*;/`.
   - **Keep the existing fallback regex in place** (line 1381) alongside the simplified primary regex — both coexist. After the Phase 2 pornhub fixture confirms which regex actually fires on current Pornhub HTML, the unused one can be pruned in a follow-up task. Do not delete the fallback in this task.
   - **If Q1 confirms `mediaDefinitions[*].videoUrl` is now a JSON indirection** (the URL returns `application/json` instead of an `.mp4`/`.m3u8`):
     - After the current `defs.forEach` loop builds `hlsUrls` and `mp4Urls`, add a resolution step: for each def with `videoUrl` that does NOT end in `.mp4`/`.m3u8`, `cherryFetch(def.videoUrl)`, parse the JSON for the real URL field, replace the entry. Wrap in `Promise.all`.
     - This step is gated on Q1 — do NOT add it if Q1 shows `videoUrl` is still a direct URL.
   - **If Q1 reveals `qualityItems` is the new shape**: add a second extraction path after `if (!fvMatch) return ...` that handles `qualityItems` arrays. Build the same `mp4Urls`/`hlsUrls` maps from that shape.
   - Keep the existing `proxyM3u8` HLS path unchanged.

3. **Add unit tests:**
   - `eporner: fixture extraction → quality has ≥1 numeric key, url ends in .mp4, url contains '/proxy?url='` (since `_epornerExtract` wraps via `buildProxyUrl`).
   - `eporner: empty fixture → returns { url: '', quality: {} }` (no HTML URL leak).
   - `pornhub: fixture extraction → mediaDefinitions parsed, quality has ≥2 numeric keys`.
   - If Q1 reveals JSON indirection: add a mock for `cherryFetch` returning JSON; assert real `.mp4` URL is extracted.
   - If Q1 reveals `qualityItems`: add a fixture-based test that exercises that branch.

**Files changed:**
- `plugin.js` — MODIFY (2 adapter bodies, add `_epornerExtract` helper)
- `test/plugin-helpers.test.js` — MODIFY (3–5 new tests)

**Test gate:**
- `npx vitest run test/plugin-helpers.test.js` — all green.
- `npx vitest run` (FULL unit suite) — zero regressions across the whole test directory.
- **Tier-A non-regression check:** run `node test/cherry-lampa-e2e.mjs` with tier-A sources only (use an env flag like `CHERRY_E2E_TIER=A` or write a minimal driver that invokes `getStream` for pornhub + xvideos) to confirm the pornhub flashvars regex change does not regress existing tier-A behavior.
- eporner: `getStream` for a real video ID returns either a video/* URL (success) or empty (no false-positive HTML URL).
- pornhub: `getStream` returns `quality` with ≥2 keys for a real viewkey.

---

### Phase 5 — Infrastructure routing (after Phase 2 + Phase 0)

**Covers:** REQ-7 Candidate A (route bigcdn.cc + pornone CDN through Deno Deploy) + fallback to D if Q7/Q8 show Deno also blocked.

**Depends on:** Phase 0 (REQ-7-PRE px() guard MUST be merged) + Phase 2 (Q7/Q8 curl confirmation + pornone CDN hostname).

**Steps:**

1. **Verify Phase 2 Q7/Q8 results** in `tasks/multi-source-video-fix.fixtures-report.md`:
   - If Q7 returned HTTP 200 + binary body for bigcdn.cc through Deno → proceed with bigcdn routing.
   - If Q7 returned 403 → skip bigcdn routing; mark hqporner as known-blocked (Candidate D) and document.
   - Same gate for Q8 / pornone CDN.

2. **For each CDN host confirmed working through Deno**, add to `PROXY_URL_2_HOSTS` (`plugin.js:13`). Concrete hosts (subject to Phase 2 confirmation):
   - **All `sN.bigcdn.cc` hostnames enumerated in Phase 2** (see Phase 2 step 1 — the deduplicated list from `grep -oE 's[0-9]+\.bigcdn\.cc' hqporner-page.html | sort -u`). Add every observed entry here at once — e.g. `'s1.bigcdn.cc': 1, 's2.bigcdn.cc': 1, 's3.bigcdn.cc': 1, ...`. Do NOT use a wildcard (`PROXY_URL_2_HOSTS` is a flat-string lookup).
   - The pornone CDN subdomain from Q8 (e.g. `'cdn.pornone.com': 1`).

3. **Do NOT add** `mydaddy.cc` or `pornone.com` (page/embed hosts work through CF Worker and don't need Deno routing; spec §REQ-7 explicit constraint).

4. **Integration-level assertion** in `test/plugin-helpers.test.js`:
   - The **unit test** for the px() guard logic itself lives in Phase 0 (against a synthetic `PROXY_URL_2_HOSTS` map). Do NOT duplicate it here.
   - The Phase 5 test extends `PROXY_URL_2_HOSTS` with the **real** confirmed hosts from this phase, then runs the same px()/buildProxyUrl flow against one of the newly-added hosts (e.g. `'https://s1.bigcdn.cc/x.mp4'`) and asserts: result starts with `PROXY_URL_2` prefix; result contains exactly ONE `/proxy?url=` occurrence; result contains zero `%2Fproxy%3Furl%3D` occurrences. This verifies the **map extension** (not the guard logic) is wired correctly.

5. **Update `docs/CHERRY.md` lessons** with:
   - Why CDN hosts (not page hosts) route through Deno.
   - Which exact hosts are in `PROXY_URL_2_HOSTS`.
   - Any host that remained blocked even through Deno (Candidate D fallback).

**Files changed:**
- `plugin.js` — MODIFY (one line: extend `PROXY_URL_2_HOSTS`)
- `test/plugin-helpers.test.js` — MODIFY (1 new test for px guard)
- `docs/CHERRY.md` — MODIFY (lessons section)

**Test gate:**
- `npx vitest run test/plugin-helpers.test.js` — all green including the new Phase 5 integration assertion for the extended `PROXY_URL_2_HOSTS` map.
- `npx vitest run` (FULL unit suite) — zero regressions across the whole test directory.
- Manual curl through Deno of one bigcdn.cc URL via the new routing returns HTTP 200 + `video/mp4`.
- Same for pornone CDN.
- If either CDN remains blocked, document in CHERRY.md and downgrade the corresponding source to tier C with `known-blocked` reason in the E2E summary.

---

### Phase 6 — E2E hardening (after Phases 0–5)

**Covers:** REQ-8 (validateStreamReachable).

**Why last:** Runs against the fully-fixed adapters from prior phases so the new pass/fail gate reflects real state, not partial work.

**Steps:**

1. **Add `wrapLikePxHelper(url)`** to `test/cherry-lampa-e2e.mjs` mirroring the inner `px()` from `playVideo()`:
   ```js
   const PROXY_BASE_2 = 'https://cherry-proxy.aawersom.deno.net';
   // Mirrors plugin.js buildProxyUrl with hardcoded defaults.
   // Update in sync with PROXY_URL_2_HOSTS in plugin.js (see sync-check assertion below).
   const PROXY_URL_2_HOSTS = { /* mirror plugin.js list */ };
   const PROXY_KEY = '1206'; // hardcoded default; mirrors plugin.js
   function wrapLikePxHelper(streamUrl) {
     if (!streamUrl) return '';
     if (streamUrl.startsWith('blob:')) return streamUrl;
     if (streamUrl.startsWith(PROXY_BASE)) return streamUrl;
     if (streamUrl.startsWith(PROXY_BASE_2)) return streamUrl;
     const u = streamUrl.startsWith('//') ? 'https:' + streamUrl : streamUrl;
     try {
       const host = new URL(u).hostname;
       const base = PROXY_URL_2_HOSTS[host] ? PROXY_BASE_2 : PROXY_BASE;
       return `${base}/proxy?url=${encodeURIComponent(u)}&key=${PROXY_KEY}`;
     } catch { return `${PROXY_BASE}/proxy?url=${encodeURIComponent(u)}&key=${PROXY_KEY}`; }
   }
   ```
   - **Document the hardcoded defaults explicitly** in the source file via the comment above: `wrapLikePxHelper` hardcodes `PROXY_KEY = '1206'` (the default key) AND duplicates the `PROXY_URL_2_HOSTS` map. Both must be kept in sync with `plugin.js` manually.
   - **Sync-check assertion** (add to `test/plugin-helpers.test.js`): parse `plugin.js` PROXY_URL_2_HOSTS source text via regex, extract the host keys, and assert the extracted set equals the test's inline copy in `wrapLikePxHelper`. Example:
     ```js
     const pluginSrc = readFileSync('plugin.js', 'utf8');
     const m = pluginSrc.match(/var\s+PROXY_URL_2_HOSTS\s*=\s*\{([^}]+)\}/);
     const pluginHosts = new Set([...m[1].matchAll(/['"]([^'"]+)['"]\s*:/g)].map(x => x[1]));
     const testHosts = new Set(Object.keys(PROXY_URL_2_HOSTS_INLINE_COPY));
     expect(pluginHosts).toEqual(testHosts);
     ```
     This test fails loudly if anyone updates one map without updating the other.

2. **Add `validateStreamReachable(streamResult)`** to `test/cherry-lampa-e2e.mjs`:
   - Implementation per spec §REQ-8: HEAD first, fallback to ranged GET on 405/501.
   - Accept HTTP 200 or 206.
   - Accept content-type starting `video/`, `audio/`, containing `mpegurl` (HLS), or containing `octet-stream`.
   - Return `{ ok, contentType, status, reason }`.
   - Wrap fetched URL through `wrapLikePxHelper` (NOT the raw CDN URL).
   - Cache results in a `Map<url, result>` within a single E2E run.
   - **Retry policy:** on `fetch-error` (network error / DNS failure / connection reset) or any 5xx response, retry the request ONCE after a 2000ms backoff before classifying as a final failure. Transient CDN errors (503 under load, intermittent DNS) should not cause permanent E2E failure. After the single retry, the final classification (`ok: true` or `ok: false` with the appropriate `reason`) stands.

3. **Wire the check into the per-source flow:**
   - After every `getStream` call (all tiers), call `validateStreamReachable` on the returned `{ url, quality }`.
   - For tier A/B/C: failure of reachability downgrades source to FAIL with `reason` in summary.
   - For tier D (`xnxx`, `eporner`, `spankbang`): keep soft-fail behavior; log the reachability `reason` for visibility but do not exit-fail.
   - Each per-source summary line includes `contentType: <ct>` or `reason: <reason>`.

4. **Add unit test** in `test/plugin-helpers.test.js`:
   - Inline-mirror `validateStreamReachable` and mock `fetch`.
   - Test cases:
     - `200 + video/mp4` → `ok: true`
     - `200 + text/html` → `ok: false`, reason `content-type:text/html`
     - `403` → `ok: false`, reason `http-403`
     - `206 + video/mp4` → `ok: true`
     - `405 → GET retry → 200 + application/vnd.apple.mpegurl` → `ok: true`
     - Network error → `ok: false`, reason `fetch-error:...`
     - `validateStreamReachable({ url: '' })` → `{ ok: false, reason: 'empty-url' }` (guards against the legacy "non-empty string" check passing on accidentally-stripped URLs).

5. **Run the full E2E** `node test/cherry-lampa-e2e.mjs` after all phases. Confirm:
   - Exit code 0.
   - eporner either PASSES with `contentType: video/*` or FAILS with a precise reason (no silent HTML-URL pass).
   - All previously-passing tier-A sources still pass with content-type logged.
   - Summary lines include content-type per source.

6. **Update `tasks/cherry-e2e-baseline.json`** only if real `cardsCount` drift is observed (the schema does not change — `cardsCount` is unchanged by this task). Note in the plan's run notes if any baseline diffs were committed.

**Files changed:**
- `test/cherry-lampa-e2e.mjs` — MODIFY (add wrapLikePxHelper + validateStreamReachable + per-source wiring + retry policy)
- `test/plugin-helpers.test.js` — MODIFY (7 new tests: 6 validateStreamReachable cases — incl. empty-URL — plus 1 sync-check assertion for PROXY_URL_2_HOSTS)
- `tasks/cherry-e2e-baseline.json` — MODIFY only if drift observed

**Test gate:**
- `npx vitest run test/plugin-helpers.test.js` — all green.
- `node test/cherry-lampa-e2e.mjs` — exit 0, summary includes content-type per source, eporner regression specifically blocked.

---

## 3. File change map

| Phase | File | Change type |
|---|---|---|
| 0 | `plugin.js` | MODIFY (delete gayporntube block + helpers; add px() guard; add extractStreams sources-array branch with backslash-parity escape rule) |
| 0 | `test/plugin-helpers.test.js` | MODIFY (sync extractStreams + 8 new extractStreams tests + 4 findMatchingBracket tests + 1 px() guard unit test) |
| 0 | `test/cherry-lampa-e2e.mjs` | MODIFY (remove 'gayporntube' from tier B) |
| 1 | `plugin.js` | MODIFY (porndig, ebun, lenporno getStream bodies) |
| 1 | `test/plugin-helpers.test.js` | MODIFY (4 new tests) |
| 1 | `test/fixtures/porndig-iframe.html` | ADD |
| 1 | `test/fixtures/ebun-iframe.html` | ADD |
| 1 | `test/fixtures/lenporno-player.html` | ADD |
| 2 | `test/fixtures/pornhub-page.html` | ADD |
| 2 | `test/fixtures/pornhub-flashvars.json` | ADD |
| 2 | `test/fixtures/eporner-page.html` | ADD |
| 2 | `test/fixtures/tizam-page.html` | ADD |
| 2 | `test/fixtures/perfektdamen-page.html` | ADD |
| 2 | `test/fixtures/huyamba-page.html` | ADD |
| 2 | `test/fixtures/24rolika-page.html` | ADD |
| 2 | `tasks/multi-source-video-fix.fixtures-report.md` | ADD |
| 3 | `plugin.js` | MODIFY (tizam, perfektdamen, huyamba, 24rolika getStream bodies) |
| 3 | `test/plugin-helpers.test.js` | MODIFY (5 new tests using fixtures: 4 per-adapter extraction + 1 perfektdamen anti-ad-iframe assertion) |
| 4 | `plugin.js` | MODIFY (eporner, pornhub getStream bodies; add `_epornerExtract` helper) |
| 4 | `test/plugin-helpers.test.js` | MODIFY (3–5 new tests) |
| 5 | `plugin.js` | MODIFY (extend `PROXY_URL_2_HOSTS` with all enumerated CDN hosts from Phase 2) |
| 5 | `test/plugin-helpers.test.js` | MODIFY (1 new integration assertion for the extended map; unit-level px guard test lives in Phase 0) |
| 5 | `docs/CHERRY.md` | MODIFY (lessons section) |
| 6 | `test/cherry-lampa-e2e.mjs` | MODIFY (add wrapLikePxHelper + validateStreamReachable + per-source wiring + retry policy) |
| 6 | `test/plugin-helpers.test.js` | MODIFY (7 new tests: 6 validateStreamReachable cases + 1 sync-check assertion for PROXY_URL_2_HOSTS) |
| 6 | `tasks/cherry-e2e-baseline.json` | MODIFY (only if cardsCount drift) |

---

## 4. Risk register

| Risk | Mitigation | Fallback phase |
|---|---|---|
| Phase 2 fetch fails for one or more adapters (page returns 403, blocks Playwright, or returns minimal HTML for JS-rendered sites). | Try Method B (Playwright headed) when Method A (curl through proxy) returns empty/minimal HTML. If still empty, capture HAR from devtools manually and save the relevant response. | Per-adapter REQ delivers a documented "investigation-blocked" note in fixtures-report; the affected adapter stays unchanged and is logged as known-broken in `docs/CHERRY.md`. |
| Phase 5 Q7/Q8 both fail (Deno also blocked at bigcdn.cc or pornone CDN). | Phase 2 must record the failure precisely (HTTP status + body excerpt). Spec already names Candidate D (skip gracefully) as the documented fallback. | Phase 5 step 2 conditional: do NOT extend `PROXY_URL_2_HOSTS` for that host; mark adapter as known-blocked in CHERRY.md + tier C/D in E2E. |
| Phase 4 eporner CDN requires session cookies (Pattern 1 + 3 both yield empty). | Phase 2 fixture grep includes `Set-Cookie`/`document.cookie`/`token` markers; if cookies are needed, fixtures-report flags this and Phase 4 downgrades eporner to "best-effort" tier D status. | eporner stays tier D with `infrastructure-cookies` reason; no further code change. |
| Phase 6 reachability check causes false-positive E2E flakes (CDN returns 503 under load). | Per-URL Map cache prevents duplicate fetches; failures are categorized so flake (`fetch-error`) is distinguishable from real regression (`http-403`, `content-type:text/html`). | Tier D keeps soft-fail; transient `fetch-error` on tier A/B reruns once before exit-fail. |
| Phase 0 REQ-2 (extractStreams new branch) breaks an existing passing test because the new branch finds extra qualities where the old code returned just a `url`. | All existing extractStreams tests in `test/plugin-helpers.test.js` are run as the gate. The new branch only ADDS to `quality`; it does NOT modify `url` (the legacy `if (!url && Object.keys(quality).length)` line at the end still picks first-key URL if no other path set it). Back-compat preserved by construction. | If a test fails, restrict the new branch to only trigger when an existing `quality` map is empty before the branch runs (extra guard at top of new branch). |

---

## 5. Definition of Done

Before declaring the task complete, all of the following must be true:

- [ ] **Phase 0:** `Grep -n gayporntube` across the entire repo returns zero matches. `SOURCES.length === 25` (was 26). `npx vitest run test/plugin-helpers.test.js` passes including: 8 new extractStreams tests (7 sources-array cases + 1 escaped-backslash case for H1), 4 new `findMatchingBracket` precondition/nesting tests (H2), and 1 new px() guard unit test (M1 — uses a synthetic in-test `PROXY_URL_2_HOSTS` map; integration assertion against the real map lands in Phase 5).
- [ ] **Phase 1:** porndig, ebun, lenporno each have a unit-test on a saved fixture that asserts `url === bestQualityUrl(quality)` when the quality map is non-empty. lenporno has no `"mp4"` literal key and unlabeled URLs don't collide.
- [ ] **Phase 2:** `tasks/multi-source-video-fix.fixtures-report.md` exists with one section per adapter, each containing a concrete regex recommendation (not "TBD"). Q7 and Q8 each have a recorded HTTP status code from a real curl run.
- [ ] **Phase 3:** Each of tizam, perfektdamen, huyamba, 24rolika returns a non-empty `url` for a known-good video ID (unit-tested against the saved fixture; E2E reachability confirms in Phase 6).
- [ ] **Phase 4:** eporner never returns an HTML page URL as `url` (verified by unit test); fixture extraction yields ≥1 quality key. pornhub fixture extraction yields ≥2 quality keys.
- [ ] **Phase 5:** Either both hqporner and pornone return media content-type via the Deno-routed CDN paths (Candidate A success) OR the failing one is documented in `docs/CHERRY.md` as known-blocked with the curl evidence from Phase 2. The integration assertion for the extended `PROXY_URL_2_HOSTS` map passes (single `/proxy?url=` occurrence in result, zero `%2Fproxy%3Furl%3D`). All enumerated `sN.bigcdn.cc` hosts from the Phase 2 grep are present in the map (not just `s1`/`s2`).
- [ ] **Phase 6:** `node test/cherry-lampa-e2e.mjs` exits 0. Summary lines include content-type per source. Adding a synthetic `eporner` adapter that returns an HTML URL would now FAIL the E2E (regression-blocked).
- [ ] **Overall:** Total source count = 25. At least 6 of the 8 originally-broken sources (the 6 parser-fix REQs) confirmed playing in real Lampa via a headed Playwright run; the remaining 2 (hqporner, pornone) either pass (Candidate A success) or are documented as known-blocked. `tasks/cherry-e2e-baseline.json` reflects the final state.
- [ ] **`docs/CHERRY.md`** updated: lessons section gets new entries for REQ-2 (multi-quality JWPlayer sources array), REQ-7 (Deno routing for bigcdn/pornone CDN hosts), REQ-8 (reachability gate replaces non-empty-string check).
