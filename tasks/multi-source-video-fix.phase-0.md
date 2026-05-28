# Phase 0 — Foundations

**From plan:** `tasks/multi-source-video-fix.plan.md` §Phase 0  
**Spec:** `tasks/multi-source-video-fix.spec.md` (REQ-1, REQ-2, REQ-7-PRE)  
**Primer:** `tasks/multi-source-video-fix.primer.md`  
**Mode:** FULL (no network required — pure code changes)

---

## Scope

Three surgical edits to `plugin.js` + test harness updates. No live network needed.

### REQ-1 — Delete gayporntube adapter

**plugin.js:**
- Delete lines 3633–3708 inclusive:
  - Lines 3633–3661: `// ---- 18. GayPornTube ----` + `SOURCES.push({ id: 'gayporntube', ... })`
  - Lines 3663–3696: `function _gayptCards(html) { ... }`
  - Lines 3698–3708: `function _gayptPages(html) { ... }`
- The adapter is NOT assigned to a named variable; no other references in plugin.js.

**test/cherry-lampa-e2e.mjs:**
- Line 36: remove `'gayporntube'` from the tier-B array
- Lines 528 and 691: change `!== 26` to `!== 25`
- Line 639: change `/26` display to `/25`

**tasks/cherry-e2e-baseline.json:** verify-only (gayporntube is not present — no change needed).

**Success criteria:** `Grep -n gayporntube plugin.js test/` returns zero matches. `SOURCES.length === 25`.

---

### REQ-7-PRE — px() double-proxy guard

**plugin.js:** Inside `playVideo()`, in the inner `px()` function at line 261, add after the existing `PROXY_URL` guard:

```js
if (PROXY_URL_2 && u.indexOf(PROXY_URL_2) === 0) return u; // also skip Deno-proxied URLs
```

Final `px()` body:
```js
function px(u) {
    if (!u) return u;
    if (u.indexOf('blob:') === 0) return u;
    if (u.indexOf(PROXY_URL) === 0) return u;
    if (PROXY_URL_2 && u.indexOf(PROXY_URL_2) === 0) return u; // also skip Deno-proxied URLs
    if (u.indexOf('//') === 0) u = 'https:' + u;
    return buildProxyUrl(u);
}
```

This is the ONLY edit allowed to `playVideo()` in the entire task.

---

### REQ-2 — extractStreams JWPlayer sources array branch

**plugin.js:** Insert new branch BEFORE the existing `jwRe` single-file scan (line 1227), as a purely additive addition. No existing branches are modified.

The new code:
1. Declares `function findMatchingBracket(str, openIdx, openCh, closeCh)` as a LOCAL function inside `extractStreams` (NOT module scope).
2. Detects `sources: [...]` array in HTML.
3. Uses bracket-depth scanner to delimit the array.
4. Walks each `{...}` object inside the array.
5. For each object, independently runs `fileRe2` and `labelRe2` regexes.
6. Inserts into `quality[label] = file` if both match and label is not already present (first-write wins).

**Backslash-parity rule (CRITICAL):** Must count consecutive backslashes before quote to detect real escape: `bs % 2 === 0` means quote is a real string boundary; `bs % 2 !== 0` means it's escaped. Single-char lookback `html[i-1] !== '\\'` is WRONG.

**test/plugin-helpers.test.js:** The inlined `extractStreams` copy (lines 40–60) must be updated to match. `findMatchingBracket` being local to `extractStreams` means it's automatically part of the copy.

---

## Files Changed

- `plugin.js` — 3 surgical edits (delete lines 3633–3708, insert px() guard, insert sources-array branch)
- `test/plugin-helpers.test.js` — sync `extractStreams` copy + add tests
- `test/cherry-lampa-e2e.mjs` — remove gayporntube from tier B + fix count guards

## Test Gate

All of the following must pass before Phase 1:
- `npx vitest run test/plugin-helpers.test.js` — all existing tests green + new tests:
  - 7 extractStreams sources-array cases
  - 1 escaped-backslash case
  - 4 findMatchingBracket unit cases
  - 1 px() guard unit case (using inline synthetic PROXY_URL_2)
- `Grep -n gayporntube` → zero matches across plugin.js + test/

## Architecture Invariants (from plan)

- `findMatchingBracket` is local to `extractStreams` — NOT module-scope
- No existing extractStreams branches are modified — additive only
- The `playVideo()` function is frozen except for the single px() guard line
- `PROXY_URL_2_HOSTS` is NOT extended in Phase 0 (that is Phase 5)
- All existing tests must stay green (regression guard)
