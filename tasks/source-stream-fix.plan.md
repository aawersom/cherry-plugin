# Plan: source-stream-fix
**Task slug:** source-stream-fix
**Date:** 2026-06-03
**Files:** `plugin.js`, `workers/cherry-proxy/src/index.js`
**Constraint:** ES5 only in `plugin.js`; ESM in `index.js`

---

## Commit structure (4 commits)

| Commit | Files | Steps |
|--------|-------|-------|
| **A** | `plugin.js` | 1.3a (add bigcdn regex), 1.1 (eporner/spankbang in + bigcdn dict out, pornone kept), 1.2, 1.4, 1.5 |
| **B (cross-file atomic)** | `plugin.js` + `index.js` | 1.3b (remove pornone regex), 1.1-pornone (remove pornone entries), 2.1 (RESIDENTIAL add pornone), 2.3 (wildcard routing) |
| **C** | `plugin.js` | 1.6 (porntrex), 1.7 (porndig), 1.8 (24rolika) |
| **D** | `index.js` | 2.2 (DJB2 hash), 2.4 (TODO comment) |

> **Within Commit A edit session:** Apply Step 1.3a (add bigcdn regex to `buildProxyUrl`) BEFORE Step 1.1 bigcdn dict removal. Never remove dict entries first — doing so leaves a window with no bigcdn coverage.

> **Commit B rationale:** pornone cannot be removed from `plugin.js` (PROXY_URL_2_HOSTS + buildProxyUrl) until `index.js` simultaneously adds it to RESIDENTIAL + wildcard routing. A split across commits would route pornone to CF Worker direct datacenter fetch (banned IP) between Commit A and B. Both files land together.

---

## Commit A — eporner/spankbang routing + bigcdn regex

### Step 1.3a — buildProxyUrl: add bigcdn regex (keep pornone regex; Commit B removes it)
**Line 65** — apply FIRST in the edit session.

**Before:**
```javascript
        if (PROXY_URL_2_HOSTS[h] || /\.pornone\.com$/.test(h)) base = PROXY_URL_2;
```
**After:**
```javascript
        // bigcdn wildcard covers all *.bigcdn.cc CDN subdomains
        if (PROXY_URL_2_HOSTS[h] || /\.pornone\.com$/.test(h) || /\.bigcdn\.cc$/.test(h)) base = PROXY_URL_2;
```

### Step 1.1 — PROXY_URL_2_HOSTS: add eporner+spankbang, remove bigcdn dict entries (REQ-2, REQ-3, REQ-4)
**Lines 17–36** — apply AFTER Step 1.3a. Pornone entries remain; Commit B removes them.

**Before (complete, lines 17–36):**
```javascript
var PROXY_URL_2_HOSTS = {
    'xnxx.com': 1, 'www.xnxx.com': 1,
    'www.youjizz.com': 1, 'youjizz.com': 1,
    'tv4.tizam.org': 1,
    'pornone.com': 1, 'www.pornone.com': 1,
    'gallery.vcmdiawe.com': 1, 'galleryn2.vcmdiawe.com': 1,
    // NOTE: pornhub/eporner/spankbang intentionally NOT here —
    //       they go to CF Worker which routes them via SOCKS5 Dutch residential proxies
    // bigcdn.cc — LeaseWeb NL CDN used by KVS-based sites; 13 confirmed subdomains
    's1.bigcdn.cc': 1, 's4.bigcdn.cc': 1, 's16.bigcdn.cc': 1, 's18.bigcdn.cc': 1,
    's25.bigcdn.cc': 1, 's30.bigcdn.cc': 1, 's33.bigcdn.cc': 1, 's38.bigcdn.cc': 1,
    's39.bigcdn.cc': 1, 's41.bigcdn.cc': 1, 's43.bigcdn.cc': 1, 's47.bigcdn.cc': 1,
    's50.bigcdn.cc': 1, 's61.bigcdn.cc': 1,
    'www.perfektdamen.co': 1
};
```
**After (Commit A — pornone kept, bigcdn dict removed, eporner+spankbang added):**
```javascript
var PROXY_URL_2_HOSTS = {
    'xnxx.com': 1, 'www.xnxx.com': 1,
    'www.youjizz.com': 1, 'youjizz.com': 1,
    'tv4.tizam.org': 1,
    'pornone.com': 1, 'www.pornone.com': 1,   // kept until Commit B
    'gallery.vcmdiawe.com': 1, 'galleryn2.vcmdiawe.com': 1,
    'www.eporner.com': 1,   // SOCKS5 instability — revert to Deno
    'ru.spankbang.com': 1,  // SOCKS5 403 (www.spankbang.com JS-gated, not added)
    // bigcdn.cc covered by wildcard regex in buildProxyUrl
    'www.perfektdamen.co': 1
};
```

### Step 1.2 — PROXY_URL_3_HOSTS: remove eporner + both spankbang entries (REQ-2, REQ-3)
**Lines 39–45**

**Before:**
```javascript
var PROXY_URL_3_HOSTS = {
    'www.pornhub.com': 1, 'rt.pornhub.com': 1,
    'www.eporner.com': 1,
    'ru.spankbang.com': 1, 'www.spankbang.com': 1
};
```
**After:**
```javascript
var PROXY_URL_3_HOSTS = {
    'www.pornhub.com': 1,
    'rt.pornhub.com': 1
};
```

### Step 1.4 — px() guard: add PROXY_URL_3 check (REQ-1 sub-requirement)
**Lines 334–335**

**Before:**
```javascript
        if (u.indexOf(PROXY_URL) === 0) return u;
        if (PROXY_URL_2 && u.indexOf(PROXY_URL_2) === 0) return u;
```
**After:**
```javascript
        if (u.indexOf(PROXY_URL) === 0) return u;
        if (PROXY_URL_2 && u.indexOf(PROXY_URL_2) === 0) return u;
        if (PROXY_URL_3 && u.indexOf(PROXY_URL_3) === 0) return u; // skip residential-proxied URLs
```

### Step 1.5 — pornhub getStream: remove proxyM3u8, replace with buildProxyUrl (REQ-1)
**Lines 1863–1874**

**Before:**
```javascript
      if (Object.keys(hlsUrls).length) {
        var labels = Object.keys(hlsUrls);
        return Promise.all(labels.map(function(lbl) {
          return proxyM3u8(hlsUrls[lbl], 'https://www.pornhub.com/').then(function(blob) {
            return { lbl: lbl, blob: blob };
          }).catch(function() { return { lbl: lbl, blob: hlsUrls[lbl] }; });
        })).then(function(results) {
          var quality = {};
          results.forEach(function(r) { quality[r.lbl] = r.blob; });
          return { url: bestQualityUrl(quality), quality: quality };
        });
      }
```
**After:**
```javascript
      if (Object.keys(hlsUrls).length) {
        var quality = {};
        Object.keys(hlsUrls).forEach(function(lbl) {
          quality[lbl] = buildProxyUrl(hlsUrls[lbl], 'https://www.pornhub.com/');
        });
        return { url: bestQualityUrl(quality), quality: quality };
      }
```

**Commit A success criteria:**
- `grep -n "bigcdn" plugin.js` — zero in `PROXY_URL_2_HOSTS`; one `\.bigcdn\.cc` in `buildProxyUrl`
- `grep -n "eporner\|spankbang" plugin.js` — present in `PROXY_URL_2_HOSTS`; absent in `PROXY_URL_3_HOSTS`
- `grep -n "pornone" plugin.js` — still present (both in PROXY_URL_2_HOSTS and buildProxyUrl — removed in Commit B)
- `grep -n "proxyM3u8" plugin.js` — zero inside pornhub getStream
- `grep -n "PROXY_URL_3" plugin.js` inside `px()` — grep shows exactly three guard lines in px(): PROXY_URL, PROXY_URL_2, and PROXY_URL_3 (one added by this step, two already present)
- `npx vitest run` — all existing tests pass

---

## Commit B — pornone atomic cross-file

Four sub-changes in one commit; any partial application leaves pornone broken.

**B.1 — plugin.js `buildProxyUrl`:** remove `/\.pornone\.com$/` from the condition added in Step 1.3a.
> pornone regex removed (not kept as dead code) per atomicity requirement — both regex and PROXY_URL_2_HOSTS entries must be removed in the same commit (Commit B).

**Before (post-Commit-A state):**
```javascript
        if (PROXY_URL_2_HOSTS[h] || /\.pornone\.com$/.test(h) || /\.bigcdn\.cc$/.test(h)) base = PROXY_URL_2;
```
**After:**
```javascript
        if (PROXY_URL_2_HOSTS[h] || /\.bigcdn\.cc$/.test(h)) base = PROXY_URL_2; // bigcdn wildcard covers all *.bigcdn.cc CDN subdomains
```

**B.2 — plugin.js `PROXY_URL_2_HOSTS`:** remove the four pornone/vcmdiawe lines from the Commit A After block (lines `'pornone.com': 1, 'www.pornone.com': 1, 'gallery.vcmdiawe.com': 1, 'galleryn2.vcmdiawe.com': 1`).

**B.3 — index.js `RESIDENTIAL`: add pornone entries (REQ-5)**
**Lines 27–31**

**Before:**
```javascript
const RESIDENTIAL = new Set([
  'www.pornhub.com', 'rt.pornhub.com',
  'www.eporner.com',
  'ru.spankbang.com', 'www.spankbang.com',
]);
```
**After:**
```javascript
const RESIDENTIAL = new Set([
  'www.pornhub.com', 'rt.pornhub.com',
  // pornone + CDN: Deno IP banned; routed via SOCKS5 residential
  // gallery/galleryn2 are static — not matched by /\.pornone\.com$/ wildcard
  'pornone.com', 'www.pornone.com',
  'gallery.vcmdiawe.com', 'galleryn2.vcmdiawe.com',
]);
```

**B.4 — index.js routing line 291: add pornone wildcard (REQ-5)**

**Before:**
```javascript
    if (!isPost && RESIDENTIAL.has(parsedTarget.hostname)) {
```
**After:**
```javascript
    if (!isPost && (RESIDENTIAL.has(parsedTarget.hostname) || /\.pornone\.com$/.test(parsedTarget.hostname))) {
```

**Commit B success criteria:**
- `grep -n "pornone" plugin.js` — zero occurrences in both `PROXY_URL_2_HOSTS` and `buildProxyUrl`
- `grep -n "pornone\|vcmdiawe" index.js` — four entries in `RESIDENTIAL`; wildcard present in routing condition
- `grep -n "eporner\|spankbang" index.js` — zero occurrences in `RESIDENTIAL`
- `npx vitest run` — all tests pass

**Commit B regression:**
- pornone must route to CF Worker (PROXY_URL), not Deno (PROXY_URL_2). Verify `buildProxyUrl('https://www.pornone.com/x.mp4')` returns `PROXY_URL`-prefixed URL.
- `RESIDENTIAL.has('www.pornhub.com')` still true.

---

## Commit C — adapter fixes

### Step 1.6 — porntrex getStream: wrap buildProxyUrl with referer (REQ-7)
**Lines 2715 and 2723**

Line 2715 Before: `if (found.length) return _kvsPickBest(found);`
After:
```javascript
            if (found.length) {
                var r1 = _kvsPickBest(found);
                var q1 = {};
                Object.keys(r1.quality).forEach(function(k) { q1[k] = buildProxyUrl(r1.quality[k], 'https://www.porntrex.com/'); });
                return { url: buildProxyUrl(r1.url, 'https://www.porntrex.com/'), quality: q1 };
            }
```

Line 2723 Before: `if (varUrls.length) return _kvsPickBest(varUrls);`
After:
```javascript
            if (varUrls.length) {
                var r2 = _kvsPickBest(varUrls);
                var q2 = {};
                Object.keys(r2.quality).forEach(function(k) { q2[k] = buildProxyUrl(r2.quality[k], 'https://www.porntrex.com/'); });
                return { url: buildProxyUrl(r2.url, 'https://www.porntrex.com/'), quality: q2 };
            }
```

### Step 1.7 — porndig getStream: direct-pattern extraction before extractStreams (REQ-8)
**Lines 3252–3253**

**Before:**
```javascript
                return cherryFetch(m[1]).then(function (ihtml) {
                    var result = extractStreams(ihtml);
```
**After:**
```javascript
                return cherryFetch(m[1]).then(function (ihtml) {
                    var directUrl = '', dm;
                    dm = /(?:file|src)\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))/i.exec(ihtml);
                    if (dm) directUrl = dm[1];
                    if (!directUrl) { dm = /sources\s*\[\s*0\s*\]\s*[=.]\s*(?:file\s*[:=]\s*)?['"]([^'"]+\.(?:mp4|m3u8))/i.exec(ihtml); if (dm) directUrl = dm[1]; }
                    if (!directUrl) { dm = /<(?:video|source)[^>]+data-src="([^"]+\.(?:mp4|m3u8))"/i.exec(ihtml); if (dm) directUrl = dm[1]; }
                    if (directUrl) return { url: directUrl, quality: {} };
                    var result = extractStreams(ihtml);
```

### Step 1.8 — 24rolika getStream: wrap JWPlayer URL with buildProxyUrl (REQ-9)
**Line 3950**

Before: `if (m) return { url: m[1], quality: {} };`
After: `if (m) return { url: buildProxyUrl(m[1], 'https://w2.huyalkino.com/'), quality: {} };`

---

## Commit D — CF Worker hash rotation

### Step 2.2 — fetchViaResidential: replace time-based rotation with DJB2 hash (REQ-6)
**Lines 168–171**

**Before:**
```javascript
// ---- Rotation: try all proxies starting from time-based index -----------------
async function fetchViaResidential(targetUrl, referer) {
  // Rotate every 30s so load spreads across proxies; no persistent state needed
  const startIdx = Math.floor(Date.now() / 30000) % PROXIES.length;
```
**After:**
```javascript
// ---- Rotation: deterministic per referer domain so IP-bound KVS tokens stay valid ----------
async function fetchViaResidential(targetUrl, referer) {
  // DJB2 hash over referer domain → same domain always starts at same proxy.
  // Time-based rotation anti-pattern: manifest+segments straddling 30s boundary hit different
  // SOCKS5 exit IPs → KVS token 403. Hash eliminates boundary-crossing failures.
  // Residual risk: proxy failure → fallback increments index → IP switch; accepted (no KV state).
  // TODO: referer not propagated to rewriteM3u8 segment URLs — safe for phncdn (signed params).
  // Update if adding RESIDENTIAL domains with Referer-validated CDNs.
  const domain = referer
    ? (() => { try { return new URL(referer).hostname; } catch(_){} return new URL(targetUrl).hostname; })()
    : new URL(targetUrl).hostname;
  let h = 5381;
  for (let i = 0; i < domain.length; i++) h = ((h << 5) + h) ^ domain.charCodeAt(i);
  const startIdx = Math.abs(h) % PROXIES.length;
```

**Commit D success criteria:**
- `grep -n "Date.now" index.js` — zero occurrences in `fetchViaResidential`
- Same domain input always produces identical `startIdx` (pure math, no state) — verify by inspection
- `npx vitest run` — all tests pass

**Commit D regression:**
- `fetchViaResidential` fallback loop unchanged; only `startIdx` computation differs.
- `rewriteM3u8` phncdn segment URLs unaffected (not RESIDENTIAL, no pornone match).
