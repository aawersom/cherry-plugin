# Primer: source-stream-fix
**Generated:** 2026-06-03  
**Purpose:** Give the code writer exact current state of every section being changed. No re-reading required.

---

## 1. plugin.js — Proxy config block (lines 8–72)

### Lines 8–15 — Three proxy URL vars

```javascript
  var PROXY_URL = 'https://cherry-proxy.aawersom.workers.dev';
  var PROXY_URL_2 = 'https://cherry-proxy.aawersom.deno.net';
  var PROXY_URL_3 = '';
```

### Lines 17–36 — PROXY_URL_2_HOSTS (CURRENT STATE — target of Steps 1.1 and B.2)

```javascript
  var PROXY_URL_2_HOSTS = {
    // xnxx: CF Worker IPs blocked at ASN level; Deno works
    'xnxx.com': 1, 'www.xnxx.com': 1,
    // youjizz: rate-limits CF datacenter IPs
    'www.youjizz.com': 1, 'youjizz.com': 1,
    // tizam.org: rate-limits rapid sequential CF datacenter requests
    'tv4.tizam.org': 1,
    // pornone: page + CDN must share same proxy IP so KVS token stays valid
    'pornone.com': 1, 'www.pornone.com': 1,
    'gallery.vcmdiawe.com': 1, 'galleryn2.vcmdiawe.com': 1,
    // NOTE: pornhub/eporner/spankbang intentionally NOT here —
    //       they go to CF Worker which routes them via SOCKS5 Dutch residential proxies
    // bigcdn.cc — LeaseWeb NL CDN used by KVS-based sites; 13 confirmed subdomains
    's1.bigcdn.cc': 1, 's4.bigcdn.cc': 1, 's16.bigcdn.cc': 1, 's18.bigcdn.cc': 1,
    's25.bigcdn.cc': 1, 's30.bigcdn.cc': 1, 's33.bigcdn.cc': 1, 's38.bigcdn.cc': 1,
    's39.bigcdn.cc': 1, 's41.bigcdn.cc': 1, 's43.bigcdn.cc': 1, 's47.bigcdn.cc': 1,
    's50.bigcdn.cc': 1, 's61.bigcdn.cc': 1,
    // perfektdamen KVS CDN — IP-bound tokens require consistent egress IP
    'www.perfektdamen.co': 1
  };
```

### Lines 39–45 — PROXY_URL_3_HOSTS (target of Step 1.2)

```javascript
  var PROXY_URL_3_HOSTS = {
    'www.pornhub.com': 1,
    'rt.pornhub.com': 1,
    'www.eporner.com': 1,
    'ru.spankbang.com': 1,
    'www.spankbang.com': 1
  };
```

### Lines 56–72 — buildProxyUrl (target of Steps 1.3a, B.1)

```javascript
  /** @param {string} url @param {string=} referer @returns {string} */
  function buildProxyUrl(url, referer) {
    var key = getProxyKey();
    var base = PROXY_URL;
    if (PROXY_URL_3) {
      try { if (PROXY_URL_3_HOSTS[new URL(url).hostname]) base = PROXY_URL_3; } catch (e) {}
    }
    if (base === PROXY_URL && PROXY_URL_2) {
      try {
        var h = new URL(url).hostname;
        if (PROXY_URL_2_HOSTS[h] || /\.pornone\.com$/.test(h)) base = PROXY_URL_2;
      } catch (e) {}
    }
    var p = base + '/proxy?url=' + encodeURIComponent(url);
    if (key)     p += '&key=' + encodeURIComponent(key);
    if (referer) p += '&referer=' + encodeURIComponent(referer);
    return p;
  }
```

**Exact line 65 compound condition (Step 1.3a target):**
```javascript
        if (PROXY_URL_2_HOSTS[h] || /\.pornone\.com$/.test(h)) base = PROXY_URL_2;
```

---

## 2. plugin.js — proxyM3u8 (lines 154–181)

```javascript
  function proxyM3u8(m3u8Url, referer) {
    if (_isAndroid()) return Promise.resolve(m3u8Url);
    return cherryFetch(m3u8Url, referer).then(function (content) {
      var basePath = m3u8Url.split('?')[0];
      var baseUrl = basePath.substring(0, basePath.lastIndexOf('/') + 1);

      var lines = content.split('\n');
      var promises = lines.map(function (line) {
        var l = line.trim();
        if (!l || l[0] === '#') return Promise.resolve(line);
        var abs = (l.indexOf('http') === 0) ? l : baseUrl + l;
        if (/\.m3u8/.test(abs.split('?')[0])) {
          return proxyM3u8(abs, referer).catch(function () {
            return buildProxyUrl(abs, referer);
          });
        }
        return Promise.resolve(buildProxyUrl(abs, referer));
      });

      return Promise.all(promises).then(function (rewrittenLines) {
        var blob = new Blob([rewrittenLines.join('\n')], { type: 'application/vnd.apple.mpegurl' });
        var blobUrl = URL.createObjectURL(blob);
        _blobUrls.push(blobUrl);
        return blobUrl;
      });
    });
  }
```

Note: `proxyM3u8` returns a Promise resolving to a blob URL. The pornhub block currently depends on this. Step 1.5 eliminates that dependency.

---

## 3. plugin.js — playVideo + px() (lines 318–369)

```javascript
  function playVideo(video, source) {
    Lampa.Noty.show(Lampa.Lang.translate('cherry_loading'));

    source.getStream(video).then(function (stream) {
      var quality = stream.quality || {};
      var url = bestQualityUrl(quality) || stream.url;

      if (!url) {
        Lampa.Noty.show(Lampa.Lang.translate('cherry_error'), { style: 'warn' });
        return;
      }

      // Proxy non-blob stream URLs so that tokens bound to the proxy IP stay valid.
      function px(u) {
        if (!u) return u;
        if (u.indexOf('blob:') === 0) return u;
        if (u.indexOf(PROXY_URL) === 0) return u; // already proxied with custom referer — skip
        if (PROXY_URL_2 && u.indexOf(PROXY_URL_2) === 0) return u; // also skip Deno-proxied URLs
        // Normalize protocol-relative URLs (e.g. YouJizz returns //cdne-mobile.youjizz.com/...)
        if (u.indexOf('//') === 0) u = 'https:' + u;
        return buildProxyUrl(u);
      }
      var proxiedQuality = {};
      Object.keys(quality).forEach(function(k) { proxiedQuality[k] = px(quality[k]); });
      ...
    })
  }
```

**Lines 334–335 (target of Step 1.4):**
```javascript
        if (u.indexOf(PROXY_URL) === 0) return u; // already proxied with custom referer — skip
        if (PROXY_URL_2 && u.indexOf(PROXY_URL_2) === 0) return u; // also skip Deno-proxied URLs
```

The new line goes immediately after line 335 (after the PROXY_URL_2 guard), before the `//` normalization comment.

---

## 4. plugin.js — pornhub HLS block (lines 1859–1877)

```javascript
      if (Object.keys(mp4Urls).length) {
        return { url: bestQualityUrl(mp4Urls), quality: mp4Urls };
      }

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

      return { url: '', quality: {} };
    }).catch(function() { return { url: '', quality: {} }; });
  }
```

Target lines for Step 1.5: lines 1863–1874 (the entire `if (Object.keys(hlsUrls).length)` block). The replacement is synchronous — no Promise.all.

---

## 5. plugin.js — _kvsPickBest (lines 1694–1714)

```javascript
function _kvsPickBest(urls) {
    var order = ['2160p', '1080p', '720p', '480p', '360p', '240p'];
    var quality = {};
    var best = '';
    var bestIdx = order.length;

    urls.forEach(function (u) {
        var labelMatch = /[_-](\d+p)\./i.exec(u);
        var label = labelMatch ? labelMatch[1].toLowerCase() : 'default';
        quality[label] = u;
        var idx = order.indexOf(label);
        if (idx === -1) idx = order.length - 1;
        if (idx < bestIdx) {
            bestIdx = idx;
            best = u;
        }
    });

    if (!best && urls.length) best = urls[0];
    return { url: best, quality: quality };
}
```

**Return shape:** `{ url: string, quality: { [label]: rawUrl } }` — quality values are **raw CDN URLs**, not proxied. The wrapper pattern (Steps 1.6) must iterate `r.quality` and call `buildProxyUrl` on each value, and also wrap `r.url`.

---

## 6. plugin.js — porntrex getStream (lines 2701–2727)

```javascript
    getStream: function (video) {
        return cherryFetch(video.url).then(function (html) {
            var kvsRx = /get_file\/[^\s"'<>]+\.mp4[^\s"'<>]*/g;
            var found = [];
            var m;
            while ((m = kvsRx.exec(html)) !== null) {
                var candidate = m[0].replace(/['">\s]+$/, '');
                var full = /^https?:\/\//i.test(candidate)
                    ? candidate
                    : 'https://www.porntrex.com/' + candidate.replace(/^\//, '');
                if (found.indexOf(full) === -1) found.push(full);
            }
            if (found.length) return _kvsPickBest(found);

            var varRx = /(video_url|video_alt_url)\s*[=:]\s*['"]([^'"]+)['"]/g;
            var varUrls = [];
            while ((m = varRx.exec(html)) !== null) {
                if (varUrls.indexOf(m[2]) === -1) varUrls.push(m[2]);
            }
            if (varUrls.length) return _kvsPickBest(varUrls);

            return extractStreams(html);
        }).catch(function () { return { url: '', quality: {} }; });
    }
```

**Step 1.6 targets:** line 2715 (`if (found.length) return _kvsPickBest(found);`) and line 2723 (`if (varUrls.length) return _kvsPickBest(varUrls);`). Both get the same wrap pattern using separate variable names `r1`/`q1` and `r2`/`q2`.

---

## 7. plugin.js — porndig getStream (lines 3247–3264)

```javascript
    getStream: function (video) {
        return cherryFetch(video.url).then(function (html) {
            var m = /src="(https?:\/\/videos\.porndig\.com\/player\/index\/[^"]+)"/i.exec(html);
            if (m) {
                return cherryFetch(m[1]).then(function (ihtml) {
                    var result = extractStreams(ihtml);
                    if (result.url || Object.keys(result.quality).length) {
                        var qKeys = Object.keys(result.quality);
                        var best  = qKeys.length ? bestQualityUrl(result.quality) : result.url;
                        return { url: best, quality: result.quality };
                    }
                    return extractStreams(html);
                }).catch(function () { return extractStreams(html); });
            }
            return extractStreams(html);
        }).catch(function () { return { url: '', quality: {} }; });
    }
```

**Step 1.7 insertion point:** lines 3252–3253. Insert `directUrl` extraction block before `var result = extractStreams(ihtml);`. The new code goes at the very top of the `function (ihtml)` callback body; `var result = extractStreams(ihtml);` becomes the fallback line (not removed, just moved after the `if (directUrl) return` guard).

---

## 8. plugin.js — 24rolika getStream (lines 3945–3954)

```javascript
    getStream: function (video) {
        return cherryFetch(video.url).then(function (html) {
            // DLE + JWPlayer: file: "url.mp4"
            var jwRx = /jwplayer\s*\(\s*['"]?\w+['"]?\s*\)\s*\.setup\s*\(\s*\{[\s\S]*?['"]?file['"]?\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))['"]/;
            var m = jwRx.exec(html);
            if (m) return { url: m[1], quality: {} };

            return extractStreams(html);
        }).catch(function () { return { url: '', quality: {} }; });
    }
```

**Step 1.8 target:** line 3950, `if (m) return { url: m[1], quality: {} };`. Replace `m[1]` with `buildProxyUrl(m[1], 'https://w2.huyalkino.com/')`.

---

## 9. index.js — PROXIES + RESIDENTIAL (lines 14–31)

```javascript
const TIMEOUT_MS = 20000;

// ---- Rotating Dutch residential proxies ----------------------------------------
const PROXIES = [
  { host: '45.91.209.155', port: 11750, user: 'hgTr0m', pass: '6H3nY1' },
  { host: '45.91.209.155', port: 11751, user: 'hgTr0m', pass: '6H3nY1' },
  { host: '45.91.209.155', port: 11752, user: 'hgTr0m', pass: '6H3nY1' },
  { host: '45.91.209.155', port: 11753, user: 'hgTr0m', pass: '6H3nY1' },
  { host: '45.91.209.155', port: 11756, user: 'hgTr0m', pass: '6H3nY1' },
];

// Domains that need residential IP (blocked by CF datacenter IPs)
const RESIDENTIAL = new Set([
  'www.pornhub.com', 'rt.pornhub.com',
  'www.eporner.com',
  'ru.spankbang.com', 'www.spankbang.com',
]);
```

**PROXIES.length = 5** — used by `% PROXIES.length` in rotation; DJB2 hash must use same expression.

**Exact RESIDENTIAL.has line (Step B.4 target, line 291):**
```javascript
    if (!isPost && RESIDENTIAL.has(parsedTarget.hostname)) {
```

---

## 10. index.js — fetchViaResidential (lines 168–183)

```javascript
// ---- Rotation: try all proxies starting from time-based index -----------------
async function fetchViaResidential(targetUrl, referer) {
  // Rotate every 30s so load spreads across proxies; no persistent state needed
  const startIdx = Math.floor(Date.now() / 30000) % PROXIES.length;
  let lastError;
  for (let i = 0; i < PROXIES.length; i++) {
    const proxy = PROXIES[(startIdx + i) % PROXIES.length];
    try {
      return await socks5Fetch(targetUrl, referer, proxy);
    } catch (e) {
      lastError = e;
      console.warn('cherry-proxy: SOCKS5 port ' + proxy.port + ' failed:', e.message);
    }
  }
  throw lastError || new Error('All proxies failed');
}
```

**Exact startIdx line (Step 2.2 target):**
```javascript
  const startIdx = Math.floor(Date.now() / 30000) % PROXIES.length;
```

The fallback `for` loop (`let i = 0; i < PROXIES.length; i++`) is unchanged in Commit D.

---

## 11. index.js — rewriteM3u8 (lines 241–255)

```javascript
function rewriteM3u8(text, baseUrl, proxyOrigin, key) {
  const base = new URL(baseUrl);
  function proxify(rawUrl) {
    let abs;
    try { abs = new URL(rawUrl, base).toString(); } catch { return rawUrl; }
    if (abs.startsWith(proxyOrigin)) return rawUrl;
    return proxyOrigin + '/proxy?url=' + encodeURIComponent(abs) + '&key=' + encodeURIComponent(key);
  }
  return text.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, u) => 'URI="' + proxify(u) + '"');
    return proxify(trimmed);
  }).join('\n');
}
```

Note: `rewriteM3u8` does **not** pass referer to segment proxify calls — acknowledged in plan TODO comment for Step 2.2. Not a change target.

---

## 12. index.js — main handler routing (lines 285–310)

```javascript
    if (!['http:', 'https:'].includes(parsedTarget.protocol)) throw new Error();
  } catch { return corsResponse('Invalid target URL', 400); }

  if (isPrivateHostname(parsedTarget.hostname)) return corsResponse('Target not allowed', 403);

  // ---- Route residential-blocked domains via SOCKS5 -------------------------
  if (!isPost && RESIDENTIAL.has(parsedTarget.hostname)) {
    try {
      return await fetchViaResidential(targetUrl, referer);
    } catch (e) {
      console.error('cherry-proxy: residential fetch failed, fallback to direct:', e.message);
      // fall through to direct fetch as last resort
    }
  }

  // ---- Direct CF Worker fetch (all other domains) ---------------------------
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);
  ...
```

---

## ES5 Conventions in plugin.js

- `var` everywhere — no `let`/`const`
- Named `function` declarations and `function` expressions; no arrow functions
- Error handling: `.catch(function () { return { url: '', quality: {} }; })` pattern (catch at adapter boundary)
- No template literals — string concatenation only
- `try { ... } catch (e) {}` with named `e` (never bare `catch`)
- Indentation: 4-space in adapter methods, 2-space in top-level plugin scope
- Object patterns: `var q = {}; Object.keys(...).forEach(function(k) { q[k] = ...; });` then separate `return`

---

## buildProxyUrl Call Patterns (reference examples from existing adapters)

**Without referer** (px() fallback — line 338):
```javascript
        return buildProxyUrl(u);
```

**With referer — quality map wrap (pornone getStream, lines 2611–2615):**
```javascript
                var q = {};
                Object.keys(result.quality).forEach(function(k) {
                    q[k] = buildProxyUrl(result.quality[k], 'https://pornone.com/');
                });
                return { url: buildProxyUrl(result.url, 'https://pornone.com/'), quality: q };
```

**With referer — single URL (pornone fallback, line 2620):**
```javascript
            if (m) return { url: buildProxyUrl(m[1], 'https://pornone.com/'), quality: {} };
```

**With referer — quality built inline (mydaddy/hqporner, lines 2418–2422):**
```javascript
            heights.forEach(function(h) {
              quality[h + 'p'] = buildProxyUrl('https://' + cdnHost + '/pubs/' + hash + '/' + h + '.mp4', 'https://mydaddy.cc/');
            });
            var best = quality[heights[heights.length - 1] + 'p'];
            return { url: best, quality: quality };
```

**Pattern for _kvsPickBest wrapping (Steps 1.6)** — use pornone model exactly:
```javascript
            if (found.length) {
                var r1 = _kvsPickBest(found);
                var q1 = {};
                Object.keys(r1.quality).forEach(function(k) { q1[k] = buildProxyUrl(r1.quality[k], 'https://www.porntrex.com/'); });
                return { url: buildProxyUrl(r1.url, 'https://www.porntrex.com/'), quality: q1 };
            }
```

---

## Key Invariants

1. `buildProxyUrl` checks PROXY_URL_3 first, then PROXY_URL_2 — only if `base === PROXY_URL` still.
2. `px()` in `playVideo` re-proxies all quality URLs; adapters that already call `buildProxyUrl` must guard with the `PROXY_URL` prefix check — that guard exists at lines 334–335. After Step 1.4 adds the PROXY_URL_3 guard, all three proxied prefixes are safe.
3. `_kvsPickBest` returns raw CDN URLs — caller must always wrap if the domain needs proxying.
4. `proxyM3u8` is Promise-based (async blob creation). Replacing it with synchronous `buildProxyUrl` in pornhub (Step 1.5) removes the async chain; the parent `.then()` still works because returning a plain object from a `.then()` callback is valid.
5. PROXIES array has 5 entries; `% PROXIES.length` = `% 5`. DJB2 `Math.abs(h) % PROXIES.length` is the only expression that changes in Commit D.
