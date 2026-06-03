# stream-fix-2 · Implementation Plan

## Phase A — Cross-file atomic (CF Worker + plugin.js, one commit)

**Why atomic**: REQ-3 removes `ru.spankbang.com` from PROXY_URL_2_HOSTS. Without the simultaneous CF Worker addition it would fall to plain CF datacenter with no proxy — broken intermediate state.

### TDD (append to `test/cherry-stream-fix.test.mjs` before code)
- `ru.spankbang.com` routes to PROXY_URL (CF Worker), not PROXY_URL_2, using post-A HOSTS table
- `www.eporner.com` / `tv4.tizam.org` still route to PROXY_URL_2 (regression)

### `workers/cherry-proxy/src/index.js`

```js
// RESIDENTIAL set — add spankbang (line ~28):
  'ru.spankbang.com',         // ← add

// needsResidential (line ~309) — add phncdn wildcard:
// BEFORE:
const needsResidential = RESIDENTIAL.has(parsedTarget.hostname) || /\.pornone\.com$/.test(parsedTarget.hostname);
// AFTER:
const needsResidential = RESIDENTIAL.has(parsedTarget.hostname)
  || /\.pornone\.com$/.test(parsedTarget.hostname)
  || /\.phncdn\.com$/.test(parsedTarget.hostname);
```

### `plugin.js` — PROXY_URL_2_HOSTS

```js
// DELETE lines ~27-28 entirely:
    // spankbang ru: SOCKS5 403 on ru subdomain; Deno works (www remains JS-challenge gated)
    'ru.spankbang.com': 1,
```

**Commit**: `fix(proxy): spankbang+phncdn → CF SOCKS5 residential (REQ-1, REQ-3)`

---

## Phase B — plugin.js only (one commit)

### TDD (append to `test/cherry-stream-fix.test.mjs` before code)
- `s24.bigcdn.cc` / `s1.bigcdn.cc` route to PROXY_URL (not PROXY_URL_2) after regex removal
- pornone: FluidPlayer `sources=[{…,src:"url.mp4"}]` → extracted URL (not empty)
- porntrex: `get_file/abc/1080p.mp4/` stripped to `get_file/abc/1080p.mp4`
- porndig: HTML with `sources:[{file:"full.mp4"}]` + `preview:"short.mp4"` → `full.mp4` wins
- 24rolika: `/film-porno/12345-slug.html` and `/xxx-18/99-slug.html` match hrefRx

### REQ-2 — buildProxyUrl (~line 58-59)

```js
// BEFORE:
        // bigcdn wildcard covers all *.bigcdn.cc CDN subdomains
        if (PROXY_URL_2_HOSTS[h] || /\.bigcdn\.cc$/.test(h)) base = PROXY_URL_2;
// AFTER:
        if (PROXY_URL_2_HOSTS[h]) base = PROXY_URL_2;
```

### REQ-4 — pornone getStream (~line 2597, before `var result = extractStreams(clean)`)

```js
            var fpRx = /sources\s*[=:]\s*\[[\s\S]{0,2000}?['"]src['"]\s*:\s*['"]([^'"]+\.(?:mp4|m3u8)[^'"]{0,200})['"]/i;
            var fpM = fpRx.exec(clean);
            if (fpM) return { url: buildProxyUrl(fpM[1], 'https://pornone.com/'), quality: {} };
```

### REQ-5 — porntrex getStream (~line 2698)

```js
// BEFORE:  var candidate = m[0].replace(/['">\s]+$/, '');
// AFTER:   var candidate = m[0].replace(/['">\/\s]+$/, '');
```

### REQ-6 — porndig getStream (~lines 3255-3259): swap P1 and P2

```js
// BEFORE: P1 (generic file/src) then P2 (sources array)
// AFTER:
                    dm = /sources\s*[=:]\s*\[[\s\S]*?(?:file|src)\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))/i.exec(ihtml);
                    if (dm) directUrl = dm[1];
                    // fallback: generic file/src
                    if (!directUrl) { dm = /(?:file|src)\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))/i.exec(ihtml); if (dm) directUrl = dm[1]; }
                    // Pattern 3 unchanged (data-src)
```

### REQ-7 — _rolikaCards (~line 3969)

```js
// BEFORE: /href="((?:https?:\/\/w2\.huyalkino\.com)?\/[a-z]+\/\d+[^"]+\.html)"/g
// AFTER:  /href="((?:https?:\/\/w2\.huyalkino\.com)?\/[a-z0-9][a-z0-9\-]*\/\d+[^"]+\.html)"/g
```

**Commit**: `fix(adapters): hqporner/pornone/porntrex/porndig/24rolika stream fixes (REQ-2,4,5,6,7)`

---

## Files affected
- `plugin.js` — buildProxyUrl, PROXY_URL_2_HOSTS, pornone/porntrex/porndig getStream, _rolikaCards
- `workers/cherry-proxy/src/index.js` — RESIDENTIAL set, needsResidential
- `test/cherry-stream-fix.test.mjs` — new test blocks appended (Phase A + B)

## Success criteria
- Phase A: `npm test` green; `ru.spankbang.com` absent from PROXY_URL_2_HOSTS; phncdn wildcard in needsResidential
- Phase B: `npm test` green; all five REQ-2/4/5/6/7 test assertions pass; no existing tests broken

## Rollback
- Either phase: `git revert HEAD` (single-file or cross-file commit, both atomic)

## NOT in scope
- Playwright for spankbang · porntrex CF Worker content-type guard · pornone WP REST API · any adapter outside REQ-1–REQ-7
