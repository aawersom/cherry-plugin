# Phase 1 — Quality Map Fixes

**From plan:** `tasks/multi-source-video-fix.plan.md` §Phase 1  
**Spec:** `tasks/multi-source-video-fix.spec.md` REQ-3  
**Primer:** `tasks/multi-source-video-fix.primer.md`  
**Mode:** FULL (no network required — pure code changes)
**Depends on:** Phase 0 merged ✓ (extractStreams sources-array branch now in plugin.js)

---

## Scope

Three adapter `getStream` fixes so they use `bestQualityUrl(quality)` instead of returning a
minimum-quality URL. Plus fixture files and unit tests.

### REQ-3a — porndig.getStream (plugin.js ~line 2693)

Inside the `m` (iframe URL matched) branch, replace the inner fetch-then body with:

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

The outer `extractStreams(html)` fallback stays unchanged.

### REQ-3b — ebun.getStream (plugin.js ~line 3332)

Inside the `iframeM` branch, replace the inner result-handling with:

```js
var result = extractStreams(ihtml);
if (result.url || Object.keys(result.quality).length) {
    var qKeys = Object.keys(result.quality);
    var best  = qKeys.length ? bestQualityUrl(result.quality) : result.url;
    return { url: best, quality: result.quality };
}
return { url: '', quality: {} };
```

**CRITICAL:** PRESERVE the outer fallback `return extractStreams(html)` at the outer no-iframe code
path. Only the inner iframe-match body changes.

### REQ-3c — lenporno.getStream (plugin.js ~line 3406)

Inside the `pjRe` while-loop body, change the label-handling:
- If `lbl` does NOT match `/^\d{3,4}p?$/i` (non-numeric labels like `'mp4'`, `'4k'`, `'HD'`) →
  do NOT insert into `quality`; record `if (!best) best = m[2]` but skip quality map insertion.
- If `lbl` matches the regex → insert `quality[lbl] = m[2]` and `if (!best) best = m[2]`.
- Post-loop: `return { url: bestQualityUrl(quality) || best, quality: quality }` stays unchanged.

No redundant second-pass strip needed — the in-loop guard prevents non-numeric keys.

---

## Fixtures

Add under `test/fixtures/` (synthetic HTML is acceptable per plan):

- `porndig-iframe.html` — JWPlayer sources array with ≥2 quality levels
- `ebun-iframe.html` — same shape
- `lenporno-player.html` — PlayerJS format with:
  - At least one unlabeled URL (bug case)
  - At least one labeled numeric URL
  - A second unlabeled URL (to verify no shared key collision)

---

## Tests (test/plugin-helpers.test.js)

Add 4 test cases:
1. `porndig: multi-quality → url === bestQualityUrl(quality), quality has ≥2 numeric keys`
2. `ebun: multi-quality → url === bestQualityUrl(quality), quality has ≥2 numeric keys`
3. `lenporno: fixture with two unlabeled URLs + one labeled → no key === 'mp4'; first unlabeled URL preserved as best when no labeled URL is higher`
4. `lenporno: all keys in quality match /^\d{3,4}p?$/i`

Tests should exercise the parsing logic as pure functions (inline the regex/parsing, mock the network part).

---

## Files Changed

- `plugin.js` — MODIFY (3 adapter bodies)
- `test/plugin-helpers.test.js` — MODIFY (4 new tests)
- `test/fixtures/porndig-iframe.html` — ADD
- `test/fixtures/ebun-iframe.html` — ADD
- `test/fixtures/lenporno-player.html` — ADD

## Test Gate

- `npx vitest run` — all 66+ tests green (zero regressions)
- `url === bestQualityUrl(quality)` whenever quality map is non-empty (for all 3 adapters)
- No lenporno quality key fails `/^\d{3,4}p?$/i`
