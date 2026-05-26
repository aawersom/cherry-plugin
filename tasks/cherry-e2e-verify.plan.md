# Cherry E2E Verify — Implementation Plan

**Date:** 2026-05-26
**Target file:** `test/cherry-lampa-e2e.mjs`
**Run command:** `node test/cherry-lampa-e2e.mjs`
**Spec:** `tasks/cherry-e2e-verify.spec.md`
**Estimated run time:** 8–15 minutes

---

## Pre-Implementation Answers

**Zачем?** The existing test has six structural gaps versus the spec: tests only 1 card (not 5), uses a shared browser context (race conditions on concurrent same-origin pages), lacks structured per-source result records, has no exit code, no tier-aware verdict, and no regression baseline guard.

**Как проверим?** After each phase: run `node test/cherry-lampa-e2e.mjs` and observe the specific output lines described in each phase's success criteria. Phase 5 final proof: `VERDICT: PASS` line followed by process exit 0.

**Что тестируем?** All 26 Cherry source adapters across browse, getStream (5 cards), Range-206, and video loadedmetadata checks. No unit tests — this is a live E2E runner.

**Что можем сломать?** Only `test/cherry-lampa-e2e.mjs` and the new `tasks/cherry-e2e-baseline.json` are modified. `plugin.js` is read-only input. No other test files reference this runner.

---

## Phases

---

### Phase 1: Bootstrap + Setup

**Goal:** Replace shared-context page factory with per-context pages; verify plugin loads 26 sources cleanly.

#### What changes

**`test/cherry-lampa-e2e.mjs` — full rewrite of the file header and `makeLampaPage()`:**

1. Keep all constants (`LAMPA_URL`, `PLUGIN_URL`, `PROXY_BASE`, `PROXY_KEY`, `VIDEO_TIMEOUT_MS`, `CONCURRENCY=3`).
2. Keep `reinjectionScript` construction (the three `.replace()` transforms on `plugin.js` source — they are correct and must not change).
3. Remove the module-level `const context = await browser.newContext(...)` and the module-level `context.on('response', ...)` interceptor. The shared context is the root of the race condition.
4. Add a module-level `intercepted206` Map that accumulates counts; it will be populated from per-context listeners in Phase 2.
5. Rewrite `makeLampaPage()` to accept no arguments and return `{ page, context }`:
   - Call `browser.newContext({ bypassCSP: true })` inside the function (new context per call).
   - Attach the `response` listener to the new context, not a shared one. Push matches into the module-level `intercepted206` Map.
   - All existing init-script, navigation, keyboard Enter × 2, force-init, `waitForFunction`, and reinjection logic stays exactly as-is.
   - On reinjection failure (`exposed <= 0`): close the page AND the context, return `null`.
   - On success: return `{ page, context }`.
6. In the bootstrap block (currently `const page = await makeLampaPage()`):
   - Destructure: `const { page: bootstrapPage, context: bootstrapCtx } = await makeLampaPage()`.
   - On null: `await browser.close(); process.exit(2);` (exit code 2 = infrastructure failure).
   - After reading source list, close `bootstrapPage` and `bootstrapCtx` (they are not reused in the main loop).

#### Files changed

- `test/cherry-lampa-e2e.mjs`

#### Success criteria

Run `node test/cherry-lampa-e2e.mjs` and observe within the first 30 seconds:

```
Cherry plugin loaded in real Lampa — 26 sources
```

No `Failed to load Cherry plugin` line. No unhandled JS exceptions. Exit continues past bootstrap (does not stop at exit 2). The number printed is exactly `26`.

#### Verification command

```
node test/cherry-lampa-e2e.mjs 2>&1 | Select-String "sources|Failed|bootstrap"
```

Expected: one line containing `26 sources`, nothing containing `Failed`.

---

### Phase 2: Browse Test — All 26 Sources

**Goal:** Collect structured per-source browse records for all 26 sources, with 5-card minimum and field validation on first 3 items. Each batch tab uses a separate `browser.newContext()`.

#### What changes

**`test/cherry-lampa-e2e.mjs`:**

1. Define the tier classification map at module level (constant, not derived at runtime). Structure:

   ```javascript
   const TIERS = {
     A: ['pornhub','xvideos','youjizz','xozilla','analdin','porndig','tizam',
         'hellporno','pornobolt','crocotube','24rolika','jopaonline'],
     B: ['porntrex','3movs','pornve','familyporn','ebun','perfektdamen',
         'huyamba','lenporno','gayporntube'],
     C: ['hqporner','pornone'],
     D: ['xnxx','eporner','spankbang'],
   };
   // Reverse lookup: id → tier letter
   const SOURCE_TIER = Object.fromEntries(
     Object.entries(TIERS).flatMap(([t, ids]) => ids.map(id => [id, t]))
   );
   ```

2. Rewrite the main batch loop. The existing loop calls `context.newPage()` for batch pages — it must be replaced with `browser.newContext({ bypassCSP: true })` per page. Concretely:

   - For each item in the batch, create a new context and page using the same init-script + navigation + Enter + force-init + waitForFunction + reinjection sequence that `makeLampaPage()` already uses. Extract this sequence into a shared helper `async function makeTestPage()` that returns `{ page, context }` (same logic as Phase 1's updated `makeLampaPage`, but without logging). The initial bootstrap call also uses this helper.
   - **Pages are NOT closed after browse.** The page and context remain open for Phase 3 (stream) and Phase 4 (range+video). Closing happens only after Phase 4 completes — see unified batch loop note at end of this section.
   - The `intercepted206` listener must be attached to **each new context** created inside `makeTestPage()`, not just the bootstrap context. Push matches into the module-level `intercepted206` Map.

3. Replace `testSource()` with a separate `browsSource()` function that returns a structured record:

   ```javascript
   {
     id: string,
     tier: string,             // 'A'|'B'|'C'|'D'
     cardsCount: number,       // items.length from browse result
     fieldValid: boolean,      // all field rules satisfied on first min(3, cardsCount) items
     browseOk: boolean,        // cardsCount meets tier threshold AND fieldValid
     browseError: string,      // error message or ''
     cards: VideoCard[],       // items.slice(0, 5) — kept for Phase 3
   }
   ```

4. Field validation logic (inline, no external dependency):

   ```javascript
   function validateFields(items, count) {
     const check = items.slice(0, count);
     return check.every(c =>
       typeof c.id === 'string' && c.id.trim().length > 0 &&
       typeof c.source === 'string' && c.source.trim().length > 0 &&
       typeof c.title === 'string' && c.title.trim().length > 0 &&
       typeof c.url === 'string' && (c.url.startsWith('http://') || c.url.startsWith('https://'))
     );
   }
   ```

5. `browseOk` computation per tier:
   - Tier A / B: `cardsCount >= 5 && fieldValid`
   - Tier C: `cardsCount >= 1 && fieldValid`
   - Tier D: `cardsCount === 0` (zero cards is pass; exception = fail)

6. Per-source console line (spec §6 format, browse-only columns at this phase):

   ```
   PASS  ---  ---  [analdin           ]  cards:100  dur:N/A
   FAIL  ---  ---  [xnxx              ]  cards:0    (expected: Tier D bot-blocked)
   ```

   Use plain ASCII `PASS`/`FAIL` (not emoji) to match spec §6 output.

7. The `reinjectionScript` construction (the three `.replace()` transforms) moves to the top of the file, before `makeLampaPage`, so it is available to all page-creation helpers.

#### Files changed

- `test/cherry-lampa-e2e.mjs`

#### Success criteria

Run completes all 26 sources. Console shows per-source lines. Inspect output for counts:

```
node test/cherry-lampa-e2e.mjs 2>&1 | Select-String "cards:"
```

Expected observable counts (from spec §3 thresholds):
- Tier A (12 sources): each line shows `cards:` with a number >= 5
- Tier B (9 sources): most show >= 5
- Tier C (2 sources): >= 1
- Tier D (3 sources): `cards:0`

No crash. All 26 lines print. `browseResults` array has length 26.

---

### Phase 3: getStream × 5 (Tier A / B / C)

**Goal:** For each applicable source, call `getStream` on the first 5 cards sequentially and record structured stream results.

#### What changes

**`test/cherry-lampa-e2e.mjs`:**

1. Add `bestQualityUrl` helper at module level (exact algorithm from spec §8):

   ```javascript
   function bestQualityUrl(quality) {
     const keys = Object.keys(quality);
     if (!keys.length) return '';
     const best = keys.reduce((a, b) => {
       const na = parseInt(a, 10), nb = parseInt(b, 10);
       if (!isNaN(na) && !isNaN(nb)) return na >= nb ? a : b;
       if (!isNaN(na)) return a;
       if (!isNaN(nb)) return b;
       return a >= b ? a : b; // lexicographic fallback
     });
     return quality[best];
   }
   ```

2. Add `buildProxyUrl` helper at module level (double-proxy guard + protocol-relative guard):

   ```javascript
   function buildProxyUrl(streamUrl) {
     if (!streamUrl) return '';
     if (streamUrl.startsWith(PROXY_BASE)) return streamUrl;
     let u = streamUrl.startsWith('//') ? 'https:' + streamUrl : streamUrl;
     return `${PROXY_BASE}/proxy?url=${encodeURIComponent(u)}&key=${PROXY_KEY}`;
   }
   ```

3. Add `streamSource(page, browseRecord)` function that:
   - Returns early with a skip record if tier is `'D'` (no cards) or `browseRecord.cards.length === 0`.
   - Iterates `browseRecord.cards.slice(0, 5)` sequentially (not `Promise.all`) inside a single `page.evaluate` call that returns all 5 results, or via sequential `page.evaluate` calls — either is acceptable, but sequential within a source.
   - Collects per-call: `url` (string or `''`), `quality` (object or `{}`), error message.
   - Returns record:
     ```javascript
     {
       id: string,
       streamUrls: string[],          // length <= 5
       urlPresentCount: number,
       qualityKeys: number[],         // key count per call
       bestQualityMatch: boolean[],   // per non-empty quality map call
       streamErrors: string[],        // per call, '' if no error
     }
     ```

4. Run `streamSource` for all non-Tier-D sources using the **same pages from Phase 2** — pages are not closed between phases (see Phase 2, item 2). Stream calls happen on the same page that did browse. No additional page creation in this phase.

5. After all stream calls for the batch complete, pages are still open — they remain open for Phase 4.

6. The per-source console line gains stream status: `urlPresentCount` printed as `stream:N/5`.

#### Files changed

- `test/cherry-lampa-e2e.mjs`

#### Success criteria

```
node test/cherry-lampa-e2e.mjs 2>&1 | Select-String "stream:"
```

Expected: 23 lines (26 total minus 3 Tier D). Each line contains `stream:N/5`. Tier A sources show `stream:4/5` or `stream:5/5`. No unhandled exceptions.

Spot-check multi-quality sources — `hellporno`, `pornobolt`, `crocotube`, `xvideos` — must show `qualityKeys` > 1 in debug output (add a single `console.log` line for sources with quality maps in this phase, removed in Phase 5 cleanup).

---

### Phase 4: Range-206 + Video Test (Tier A / B)

**Goal:** For each Tier A and Tier B source, run the Range-206 fetch and video `loadedmetadata` test on `cards[0]` (the first card). Fresh `getStream` is called immediately before the video element test.

#### What changes

**`test/cherry-lampa-e2e.mjs`:**

1. Add `rangeAndVideoSource(page, browseRecord, streamRecord)` function. This runs on the **same page** as Phase 2 and 3 — no new page creation. Skip logic:
   - Skip entirely if tier is `'C'` or `'D'`. Tier C: absent rangeVideoResult → treat as `rangeOk: null, videoOk: false` (not null — Tier C video is expected to fail, per spec §5 check 5).
   - For each card, skip Range + video if `streamUrls[i]` starts with `'blob:'` or ends with `.m3u8` — mark `rangeOk: null, videoOk: null` (N/A = pass).
   - Only test `cards[0]` for Range + video (spec §4 Phase 4 says "per card tested in Phase 3" but spec §3 thresholds reference per-source pass/fail, not per-card; testing card[0] satisfies the threshold checks and keeps runtime bounded — documented deviation from spec §4 wording).
   - **Blob fallback:** if `streamUrls[0]` is empty or starts with `'blob:'`, check `streamUrls[1]`, then `streamUrls[2]` etc. before declaring N/A. Use first non-blob, non-empty URL found.

2. Range fetch (inside `page.evaluate`):

   ```javascript
   const proxiedUrl = buildProxyUrl(streamUrl);
   const r = await fetch(proxiedUrl, {
     headers: { 'Range': 'bytes=0-65535' },
     signal: AbortSignal.timeout(10000),
   });
   return { status: r.status, contentRange: r.headers.get('Content-Range') || '' };
   ```

   Record: `rangeStatus`, `contentRangeHeader`, `rangeOk` (`status === 206 && /bytes 0-\d+\/\d+/.test(contentRange)`).

3. Fresh `getStream` call (inside `page.evaluate`, sequential after Range):

   ```javascript
   const freshStream = await adapter.getStream(card);
   ```

   Apply `buildProxyUrl` to the fresh URL. This call must be the immediately preceding operation before `video.src =` assignment — no awaits between them inside the evaluate call.

4. Video test: exact implementation from spec §2 Check 4 (14s timeout, `loadedmetadata` listener, `error` listener, cleanup on both paths). Record: `videoOk`, `videoDuration`, `videoReadyState` (on fail), `videoNetworkState` (on fail).

5. Return per-source record:

   ```javascript
   {
     id: string,
     rangeStatus: number | null,
     contentRangeHeader: string,
     rangeOk: boolean | null,       // null = N/A
     videoOk: boolean | null,       // null = N/A
     videoDuration: number | null,
     videoReadyState: number | null,
     videoNetworkState: number | null,
   }
   ```

5. **After all `rangeAndVideoSource` calls for a batch complete**, close all pages and contexts:

   ```javascript
   for (const { page, ctx } of batchPages) {
     await page.close();
     await ctx.close();
   }
   ```

   This is the **only** place pages are closed in the main batch loop — after browse + stream + rangeAndVideo have all run.

6. Update per-source console line to full spec §6 format:

   ```
   PASS  206  meta  [analdin           ]  cards:100  dur:8:34  https://cherry-proxy…
   PASS  N/A  N/A   [pornhub           ]  cards:30   dur:N/A   blob:https://...
   FAIL  ---  ---   [xnxx              ]  cards:0    (expected: Tier D bot-blocked)
   ```

   - Column 1: `PASS` / `FAIL` (browse result for Tier C/D; combined result for Tier A/B)
   - Column 2: `206` / `---` / `N/A` (rangeOk true/false/null)
   - Column 3: `meta` / `---` / `N/A` (videoOk true/false/null)
   - id padded to 18 chars in brackets
   - `dur:` is `M:SS` or `N/A`
   - Stream URL truncated to 52 chars

#### Files changed

- `test/cherry-lampa-e2e.mjs`

#### Success criteria

Full run completes. Check the per-source lines:

```
node test/cherry-lampa-e2e.mjs 2>&1 | Select-String "\[.*\]"
```

Tier A sources show `206` and `meta` in columns 2 and 3. `pornhub` and `xvideos` show `N/A  N/A`. Tier D sources show `cards:0`. No Playwright timeout crashes. Run time under 20 minutes.

Narrow check for Range column:

```
node test/cherry-lampa-e2e.mjs 2>&1 | Select-String "PASS.*206"
```

Expected: at least 9 lines for Tier A (excluding pornhub and xvideos).

---

### Phase 5: Verdict + Output + Baseline

**Goal:** Implement all 12 verdict checks from spec §5, produce the full spec §6 summary block, write/read the regression baseline, and call `process.exit(0|1|2)`.

#### What changes

**`test/cherry-lampa-e2e.mjs`:**

1. The Phase 1 file header must include all top-level imports at the top of the file (ES module `import` statements cannot appear mid-file). The complete import block, placed at the very top of `test/cherry-lampa-e2e.mjs` in Phase 1:

   ```javascript
   import { chromium } from '@playwright/test';
   import { readFileSync, writeFileSync, existsSync } from 'fs';
   import { fileURLToPath } from 'url';
   import { dirname, join } from 'path';
   ```

   Add `readBaseline()` and `writeBaseline(sources)` helpers using `fs.readFileSync` / `fs.writeFileSync` on `tasks/cherry-e2e-baseline.json` (absolute path resolved relative to `import.meta.url` so it works regardless of cwd):

   ```javascript
   const __dirname = dirname(fileURLToPath(import.meta.url));
   const BASELINE_PATH = join(__dirname, '..', 'tasks', 'cherry-e2e-baseline.json');
   ```

   `readBaseline()` returns `null` if file does not exist. `writeBaseline` writes JSON with `updated` date + `sources` map of `{ id: cardsCount }` for Tier A sources only.

2. Implement the `evaluateVerdict(browseResults, streamResults, rangeVideoResults, baseline)` function. It evaluates all 12 checks in order and returns `{ pass: boolean, failCheck: number|null, failMessage: string|null, warnings: string[] }`.

   The 12 checks, mapped to the verdict evaluation rules from spec §5:

   | # | Data source | Condition |
   |---|---|---|
   | 1 | Phase 1 result | `window.__CHERRY_SOURCES.length === 26` — captured as `sourcesLength` in bootstrap |
   | 2 | Phase 1 result | Idempotency: after second eval, length still 26 (captured at bootstrap time) |
   | 3 | browseResults (Tier D) | xnxx, eporner, spankbang each return `cardsCount === 0` AND no `browseError` exception string; if any returns > 0 push WARNING, do not fail |
   | 4 | browseResults (Tier C) | hqporner and pornone each return `cardsCount >= 1` |
   | 5 | rangeVideoResults (Tier C) | hqporner and pornone must NOT have `videoOk === true`; if either does, push INFO warning, do not fail |
   | 6 | browseResults (Tier A) | All 12: `browseOk === true` |
   | 7 | streamResults (Tier A) | All 12: `urlPresentCount >= 4` |
   | 8 | rangeVideoResults (Tier A, excl. pornhub+xvideos) | Count of `rangeOk === true` >= 9 out of 10 |
   | 9 | rangeVideoResults (Tier A, excl. pornhub+xvideos) | Count of `videoOk === true` >= 9 out of 10 |
   | 10 | browseResults (Tier B) | At least 9 of 10: `browseOk === true` — note spec §5 says threshold 9/10 but Tier B has 9 sources; apply as "at least 8 of 9" |
   | 11 | streamResults (Tier B) | At least 7 of 9: `urlPresentCount >= 4` |
   | 12 | browseResults (Tier A) + baseline | No Tier A source that had `cardsCount >= 5` in baseline now returns `cardsCount === 0`; additionally warn if any Tier A source dropped below 50% of baseline count |

   > **Note on check 10 threshold:** Spec §3 table says "Tier B browse >= 9/10" and spec §5 check 10 says "at least 9 of 10 Tier B sources". Tier B has exactly 9 sources. Interpret as >= 8 of 9 (allow 1 failure). Add a code comment citing the spec discrepancy.

3. Print the summary block (spec §6 format) after all per-source lines:

   ```
   === CHERRY E2E SUMMARY ===
   Total sources : 26
   Browse OK     : {n}/26
     Tier A      : {n}/12  (threshold: 12/12)
     Tier B      : {n}/9   (threshold: >=8/9)
     Tier C      : {n}/2   (threshold: 2/2)
     Tier D      : {n}/3   (expected 0/3)
   Stream URL OK : {n}/{applicable}
     Tier A      : {n}/12  (threshold: 12/12)
     Tier B      : {n}/9   (threshold: >=7/9)
   Range-206     : {n}/{applicable}
     Tier A      : {n}/10  (threshold: >=9/10)
   Video meta    : {n}/{applicable}
     Tier A      : {n}/10  (threshold: >=9/10)
   Playwright 206 intercepts: {n} URLs

   VERDICT: PASS | FAIL
   ```

4. Print failure detail block if verdict is FAIL: for each failing check, print the check number, failure message, and the IDs of the offending sources.

5. Print KNOWN LIMITATION annotations for all sources listed in spec §7 that had expected failures (Tier C video fail, Tier D browse 0). Format:

   ```
   [KNOWN LIMITATION] hqporner: bigcdn.cc blocks all CF datacenter IPs — video fail expected
   [KNOWN LIMITATION] xnxx: CF IP bot-block — 0 cards expected
   ```

6. Baseline write: if all tiers pass (verdict PASS), write updated baseline with Tier A card counts.

7. Final exit:

   ```javascript
   await browser.close();
   process.exit(exitCode); // 0 = PASS, 1 = FAIL, 2 = infrastructure (set in bootstrap)
   ```

   `exitCode` defaults to `2` at the top of the file. Set to `1` if verdict fails. Set to `0` if verdict passes. The bootstrap block sets it to `2` on plugin-load failure and calls `process.exit(2)` immediately — this matches spec §5 check 1 failure mode (plugin didn't load = infrastructure failure, not a content failure). Exit code 2 is declared in spec §5 and takes precedence over spec §4's informal "exit 1 on failure" phrasing.

#### Files changed

- `test/cherry-lampa-e2e.mjs`
- `tasks/cherry-e2e-baseline.json` (created on first passing run — do not create manually)

#### Success criteria

On a clean run with all adapters working:

```
node test/cherry-lampa-e2e.mjs
```

Final two lines of output:

```
VERDICT: PASS
```

Exit code is 0:

```
node test/cherry-lampa-e2e.mjs; echo "Exit: $LASTEXITCODE"
```

Expected: `Exit: 0`.

Baseline file created at `tasks/cherry-e2e-baseline.json` with 12 Tier A entries and today's date.

On a simulated failure (manually break one source ID in the tier map): output shows `VERDICT: FAIL`, the failing check number and message, and exit code is 1.

---

## Implementation Order Notes

Each phase touches only `test/cherry-lampa-e2e.mjs` and adds code to the bottom or replaces specific functions. The file grows incrementally — no phase requires discarding work from a prior phase.

The full-file rewrite strategy (write the complete new file in one pass after planning all phases) is preferred over incremental edits because the existing file's structure (single shared context, `testSource` combining all checks) conflicts with the Phase 2+ architecture at a structural level. Write the file from scratch in Phase 1 with stubs for Phases 2–5, then fill in each stub.

**Stub structure after Phase 1 (to be filled in Phases 2–5):**

```javascript
// Phase 1: constants, TIERS map, SOURCE_TIER lookup, reinjectionScript, buildProxyUrl,
//          bestQualityUrl, readBaseline, writeBaseline, makeTestPage, bootstrap block

async function browseSource(page, srcId)  { /* Phase 2 */ }
async function streamSource(page, browseRecord) { /* Phase 3 */ }
async function rangeAndVideoSource(page, browseRecord, streamRecord) { /* Phase 4 */ }
function evaluateVerdict(...)             { /* Phase 5 */ }
function printSummary(...)                { /* Phase 5 */ }

// ── UNIFIED BATCH LOOP (Phases 2–4 execute on the same pages before close) ──
for (let i = 0; i < sources.length; i += CONCURRENCY) {
  const batch = sources.slice(i, i + CONCURRENCY);

  // 1. Open one page per batch item (each in its own context)
  const batchPages = await Promise.all(batch.map(() => makeTestPage()));

  // 2. Browse (Phase 2) — all in parallel
  const browseRecs = await Promise.all(
    batch.map((src, idx) => browseSource(batchPages[idx].page, src.id))
  );

  // 3. Stream (Phase 3) — pages still open
  const streamRecs = await Promise.all(
    browseRecs.map((br, idx) => streamSource(batchPages[idx].page, br))
  );

  // 4. Range + Video (Phase 4) — pages still open
  const rvRecs = await Promise.all(
    browseRecs.map((br, idx) => rangeAndVideoSource(batchPages[idx].page, br, streamRecs[idx]))
  );

  // 5. NOW close pages (after all three phases complete)
  await Promise.all(batchPages.map(({ page, ctx }) => page.close().then(() => ctx.close())));

  // 6. Collect + print results
  batch.forEach((_, idx) => { /* print line, push to allResults */ });
}
```

This structure guarantees pages are open throughout all three test phases and closed exactly once per batch.

---

## File Change Summary

| Phase | Files written | Files read |
|-------|--------------|-----------|
| 1 | `test/cherry-lampa-e2e.mjs` (full rewrite) | `plugin.js` (reinjectionScript) |
| 2 | `test/cherry-lampa-e2e.mjs` | — |
| 3 | `test/cherry-lampa-e2e.mjs` | — |
| 4 | `test/cherry-lampa-e2e.mjs` | — |
| 5 | `test/cherry-lampa-e2e.mjs`, `tasks/cherry-e2e-baseline.json` (created) | `tasks/cherry-e2e-baseline.json` (if exists) |

No new npm dependencies. `@playwright/test` (chromium) is the only runtime dependency, already installed.
