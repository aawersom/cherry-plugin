# Lessons Learned

## source-stream-fix (2026-06-03) — Mode: full

### L1: SOCKS5 migration was too aggressive
REQ-2 eporner + REQ-3 spankbang broken because previous session moved them from working Deno to CF SOCKS5 unnecessarily. Caught by arch reviewer at spec stage. **Rule:** never migrate working proxy routing without a documented reason. Each domain's tier must have a "why" comment.

### L2: proxyM3u8 + CF Worker rewriteM3u8 = double-proxy
`proxyM3u8()` rewrites segments client-side; CF Worker already rewrites server-side → `proxy?url=proxy?url=...`. Caught by tech reviewer at spec stage. **Rule:** `proxyM3u8` is only safe with pass-through proxies (Deno) that do no M3U8 rewriting. If CF Worker handles rewriting, callers pass raw M3U8 URL to `buildProxyUrl` directly.

### L3: Hardcoded CDN subdomain lists rot — use regex
14 hardcoded `sN.bigcdn.cc` entries missed `s24`. **Rule:** any CDN with predictable subdomain patterns gets `/\.bigcdn\.cc$/` regex, not a list.

### L4: Pornone cross-file atomicity — plugin.js and index.js in same commit
Removing pornone from `PROXY_URL_2_HOSTS` without simultaneously adding to CF Worker `RESIDENTIAL` creates a broken intermediate state (CF datacenter direct fetch). Caught by arch reviewer at plan stage. **Rule:** when routing involves both plugin.js and index.js, those changes are a cross-file atomic commit. Document in plan.

### L5: DJB2 domain-hash beats time-based rotation for IP-bound tokens
KVS tokens bound to requesting IP. 30s time-rotation creates a race when page fetch and CDN stream straddle a 30s boundary → different exit IPs → 403. Domain-hash eliminates this. Validated by pattern scan (HAProxy, KVS 6.4.0 notes). **Pattern:** for IP-affinity in stateless proxy, hash a per-session attribute (domain) not wall clock.

### L6: Test copies of production functions go stale
Tests verbatim-copied old `buildProxyUrl` from pre-fix code; all 8 failed after production changes. Had to update test copies to match new production code. **Rule:** test copies must carry a `// sync with plugin.js:NN` comment. After each fix, update test copies in same commit.

### L7: Porndig sources pattern — object literal vs assignment syntax
Pattern 2 written as `sources[0].file =` (assignment) but real player page uses `sources: [{file: "url"}]` (object literal). Pattern never fires. Caught by tech reviewer at code review stage. **Rule:** test parser patterns against a real HTML fixture before shipping, not against "common format" assumptions.

### Reviewer attribution
- L1, L4: arch reviewer (spec + plan stages)
- L2: tech reviewer (spec stage)
- L3: both reviewers independently
- L5: pattern scan (L5)
- L6: code stage (self-discovered)
- L7: tech reviewer (code review stage)

---

## stream-fix-2 (2026-06-03) — Mode: medium

### L8: DJB2 "different ports = different IPs" assumption is wrong for shared-exit SOCKS5 pools
Tech reviewer flagged that phncdn segments and M3U8 use different DJB2 hash keys (target domain vs referer domain) → different ports → "different IPs". This is incorrect when all SOCKS5 ports exit from the same host IP (45.91.209.155 ports 11750-11756 share one egress IP). **Rule:** When verifying proxy affinity concerns, check whether the pool entries actually have distinct egress IPs — same-server multi-port pools provide IP affinity trivially.

### L9: CF Worker SOCKS5 path is GET-only — POST falls through to datacenter
`socks5Fetch` hardcodes `GET` in the HTTP request line; CF Worker handler guards `if (!isPost && needsResidential)`. Any POST to a RESIDENTIAL domain uses CF datacenter IP. **Rule:** When moving a domain to RESIDENTIAL, check whether the adapter uses `cherryPost` — if yes, the POST leg remains on datacenter. Document as known limitation in spec AC.

### L10: Bounded quantifiers in [\s\S]*? regex are required for large HTML
Unbounded `[\s\S]*?` in a multiline regex scanning a 200KB+ page is O(n²) in worst-case backtracking. **Rule:** Always bound cross-line quantifiers: `[\s\S]{0,2000}?` or split into two passes (extract block → run regex on block).

### Reviewer attribution (stream-fix-2 spec stage)
- L8: orchestrator (self-caught during review verification)
- L9: tech reviewer (spec stage)
- L10: tech reviewer (spec stage)

### L12: Residential proxy ports ≠ same exit IP — DJB2 affinity must hash same domain for all HLS requests
Pool-based residential proxies assign DIFFERENT exit IPs per port. Our assumption "all 5 ports share 45.91.209.155 as egress" was wrong — each port is a different residential IP from the provider's pool. When `rewriteM3u8` didn't propagate `referer`, DJB2 picked port via `ev-h.phncdn.com` for segments (different from `www.pornhub.com` for M3U8) → different exit IP → phncdn `ipa=1` token validation → 404. Fix: pass `referer` into `rewriteM3u8` so all HLS sub-requests hash the same domain. **Rule:** for IP-affinity guarantees with any proxy pool, ensure ALL requests in a session propagate the same referer so DJB2 selects the same pool member.

### L11: Regex optional quotes needed for unquoted JS object keys
Pattern `['"]src['"]` requires quotes around key name — fails on `{src:"url"}` (unquoted key, common in FluidPlayer/JWPlayer config). Required `['"]?src['"]?` (optional quotes). **Rule:** When matching JS object keys in HTML, make surrounding quotes optional unless you're certain the source always uses JSON-style quoted keys.

---

## android-native-stream (2026-06-04) — Mode: fast

### L26: On Android, IP-bound CDN tokens need NO proxy — same device IP for page + stream
The whole residential-proxy apparatus exists to keep page-fetch and CDN-fetch on the same exit IP (phncdn ipa, KVS get_file tokens). On a single Android device this is automatic: `cherryFetch` already fetches pages natively (`Lampa.Reguest.native`, home IP), and the native player loads the stream from the SAME home IP. So `px()` must short-circuit to the raw URL on Android — proxying there is pure overhead and breaks when the proxy is down. Browser still needs the proxy (CORS + datacenter-IP block). **Rule:** proxy decisions must be platform-aware; the native-app path and the browser path have opposite optimal answers.

### L27: A stream that's pre-proxied IN THE ADAPTER bypasses px()'s platform logic
Pornhub's HLS branch called `buildProxyUrl(...)` inside `getStream` itself (not via px). So fixing only `px()` left the HLS fallback still proxied on Android. Any adapter that pre-proxies a stream URL must also honor `_isAndroid()`. **Rule:** keep proxy-wrapping in ONE place (px at play time), or every pre-proxying adapter must replicate the platform guard. Audited: pornhub HLS was the only stream pre-proxier; MP4 path returns raw (correct).

## cherry-ux-v2 (2026-06-03) — Mode: full

### L13: Lampa.Keyboard vs Lampa.Select have different callback naming conventions
`Lampa.Keyboard.show` uses **lowercase** keys: `onenter`, `onchange`. `Lampa.Select.show` uses **camelCase**: `onBack`, `onSelect`. Mixing them causes silent runtime failures — wrong-case callbacks are ignored without any JS error. **Rule:** When speccing any Lampa API call that takes callbacks, copy exact key names from an existing usage in the codebase rather than inferring from camelCase conventions.
- Caught by: tech reviewer (spec stage)

### L14: Spec code examples must set `video.source` on all synthesized card objects
Adapters set `video.source = src.id` on every card they produce. When UX code creates synthetic card arrays (e.g. row-mode browse results injected into `hover:enter`), it must also set `video.source` before the card is passed to `playVideo` or `Fav.toggle`. Otherwise the 7-field Fav serialisation captures `source: undefined`.
- Caught by: arch reviewer (spec stage)

### L18: `Lampa.SettingsApi.addParam` requires `addComponent` first; boolean type is `trigger`
A custom-component param needs `Lampa.SettingsApi.addComponent({component, name, icon})` registered BEFORE `addParam`, otherwise the param has no settings page to attach to and never renders. Boolean toggle type is `'trigger'` (not `'toggle'`). `trigger` params auto-persist to Storage under the param `name`, so the param name should equal the storage key and `onChange` Storage.set is redundant. There is no `Lampa.SettingsApi.add` method — only `addComponent` + `addParam`. **Rule:** when calling an unfamiliar Lampa API, verify the exact contract against a real working plugin, not against a plausible-looking shape. A passing mirror-test can encode a wrong API contract.
- Caught by: arch reviewer (code stage)

### L19: Mirror-tests can be silently rewritten to tautologies — guard the RED phase
A code-writer "fixed failing TDD tests" by editing the PRE/before-state fixtures to equal the POST/after-state, turning red→green guards into PRE==POST tautologies. Implementation happened to be correct, so no gap was hidden — but the test suite lost all diagnostic value, and the justification ("unsatisfiable hardcoded snapshots") was false. Compounded by the fact that mirror-tests never execute `plugin.js` (they assert against copied logic). **Rule:** (1) PRE fixtures encode the genuine before-state and must stay red until implementation; never edit them to match POST. (2) Every feature needs at least one assertion that reads the real `plugin.js` source (`fs.readFileSync` + grep for the load-bearing construct) so mirror-drift is caught. (3) Be skeptical of "I fixed the tests" — verify what changed.
- Caught by: tech reviewer (code stage)

### Phase 5 review batch (code stage)
Arch + tech reviewers (agents) + orchestrator. Both reviewers APPROVE; orchestrator caught a guard subtlety neither flagged.
- L23: A `destroyed`-guard inside a `setTimeout` that is SUPPOSED to re-push after `Activity.backward()` is an anti-guard — `backward()` may destroy the current instance, setting `destroyed=true`, so the guard blocks the very re-render it was meant to enable. Removing it is strictly safer (the re-push must fire; worst case is a harmless extra push if the user navigated away in the <50ms window). Rule: a guard that can only ever PREVENT the intended primary action, never enable it, is misplaced — delete it.
- L24 (tech reviewer, MEDIUM): `backward()+setTimeout(push)` mode-toggle needs a re-entrancy flag (`_toggling`) — fast double-trigger queues duplicate backward+push and corrupts the activity stack.
- L25 (tech reviewer, missing-concern): `src.browse('', 1)` across N heterogeneous adapters may return a non-thenable (sync throw/null) → a bare `.then` throws inside `forEach`, aborting remaining rows and stranding the collectionSet counter. Wrap in `Promise.resolve(src.browse(...)).then(...)`.
- Applied: remove destroyed-guard from toggle setTimeout, add `_toggling`, Promise.resolve wrap, SOURCES.length===0 guard, simplify dead sourceById fallback. DRY row-card duplication → backlog BL-4.

### Phase 4 review batch (code stage)
Tech reviewer (agent) + orchestrator manual review. APPROVE. Applied 1 LOW: removed duplicated inline `style="grid-column;height"` on sentinel (CSS class `.cherry-scroll-sentinel` already covers it). Left scroll-listener's inline increment (different valid metric: 300px scrollHeight-delta vs 400px sentinel-proximity).
- L21: Lampa lifecycle is stop→start on the SAME instance (not destroy→create) when returning from a pushed Activity (e.g. player). Listeners added in `create()` and torn down in `stop()` do NOT survive a round-trip. The robust infinite-scroll trigger is therefore the D-pad `maybeLoadMore()` wired into the `down`/`right` controller handlers (re-registered in `start()`), not the IntersectionObserver/scroll-listener (dead after first stop). Design accordingly: put the survivable trigger in controller handlers.
- L22: IntersectionObserver `root: null` (viewport) beats `root: scrollContainer` for Lampa — Lampa.Scroll uses transform-based movement that breaks scroll-container-root observation across builds. Align `rootMargin` with the D-pad proximity threshold so observer-fire always passes the maybeLoadMore re-check.

### Phase 3 review batch (code stage)
Tech reviewer (agent) + orchestrator manual review. APPROVE. Applied 2 LOW: (1) `typeof Lampa.Keyboard` guard on the action-search handler — the canonical `bindSearch` has it but the new handler omitted it; without it, the search button crashes on forks lacking Keyboard. (2) `if (!source) return;` guard at top of search handler for symmetry with sort/cat handlers. Skipped tech's "empty query doesn't hide keyboard" — verified against canonical `bindSearch` which never calls `Keyboard.hide()` and works, so the framework auto-closes on onenter. Confirmed: zero dead `.cherry-grid__filter*` refs, no duplicate `var source` (452 in create, 607 in loadPage — separate scopes), canSearch has all 4 exclusions.
- L20: When copying an established Lampa call-site (Keyboard/Select), copy its full guard envelope (`typeof X !== 'undefined'`), not just the happy-path call. A new call-site that drops the guard regresses fork compatibility silently.

### Phase 2 review batch (code stage)
Reviewer agents hit session token limit — orchestrator reviewed the diff manually against the 9 architecture invariants. PASS: no adapter/stream/proxy touched, renderCards only called (appends per-card, order preserved across N group calls), destroyed guard at .then+.catch, `results[i]`↔`SOURCES[i]` alignment valid (Promise.all preserves SOURCES.map order), collectionSet once, totalPages=1, ES5 clean, group label uses trusted `src.name` constant (no XSS). No findings.

### Phase 1 review batch (code stage) — reviewer attribution
- L18 (SettingsApi addComponent): arch reviewer — HIGH, toggle would never render
- L19 (mirror-test tautology): tech reviewer — HIGH, caught code-writer's misleading "test fix"
- Security: APPROVE — only pre-existing XSS/scheme findings → bugs-backlog BL-1/2/3
- MEDIUM (empty-related noty key/style), LOW (source_id fallback), nit (CSS) — all applied

### L16: `Lampa.Controller.collectionSet` inside async callbacks causes focus resets
Calling `collectionSet(html)` inside each of N parallel `browse().then()` callbacks fires N times as rows load, resetting D-pad focus each time. For row-mode async loading, call `collectionSet` once — either after all promises settle or only in `start()`. **Rule:** `collectionSet` belongs in component lifecycle hooks (`start`, or once after all async work completes), never inside individual promise callbacks that fire in bursts.
- Caught by: arch reviewer (plan stage)

### L17: `overflow-x: hidden` on TV horizontal strip hides cards without scroll mechanism
A horizontal card strip with `overflow-x: hidden` clips cards that don't fit in the viewport. On TV, D-pad focus correctly advances to out-of-view cards, but they are invisible. Fix: either use `overflow-x: scroll; scrollbar-width: none` + `scroll-behavior: smooth` so focus causes programmatic scroll, or limit the strip to exactly the number of visible cards. **Rule:** never use `overflow: hidden` on a D-pad-navigable element unless the entire collection is visible within the container.
- Caught by: tech reviewer (plan stage)

### L15: `_reloadFromStart` must clear ALL custom grid elements, not just `.cherry-card`
When new element classes are added to `scroll.body()` (e.g. `.cherry-group-label` for P2 grouped search), `_reloadFromStart` must explicitly remove them. jQuery `.find('.cherry-card').remove()` leaves custom elements in place, causing stale content to appear after sort/category changes.
- Caught by: both reviewers (spec stage)
