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

### L11: Regex optional quotes needed for unquoted JS object keys
Pattern `['"]src['"]` requires quotes around key name — fails on `{src:"url"}` (unquoted key, common in FluidPlayer/JWPlayer config). Required `['"]?src['"]?` (optional quotes). **Rule:** When matching JS object keys in HTML, make surrounding quotes optional unless you're certain the source always uses JSON-style quoted keys.
