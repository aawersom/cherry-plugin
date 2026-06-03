# Patterns — source-stream-fix

## Q1: Hash-based proxy affinity for IP-bound sessions

**Current plan:** time-based `Math.floor(Date.now() / 30000) % 5` rotation. REQ-6 replaces with DJB2/charcode-sum hash over referer domain.

**Industry pattern:** Deterministic hash-based upstream affinity is standard. nginx uses `hash $variable [consistent]`; HAProxy offers `balance uri` / `balance source`. The time-counter approach is an anti-pattern for session affinity — it creates rotation events independent of request attributes. The hash approach requires no shared state, which is the only viable option in the CF Worker stateless model. DJB2 is preferred over charcode-sum for better avalanche, though for a 5-bucket pool either is adequate.

**Verdict:** ✅ Domain-hash is strictly correct. Domain-hash reduces KVS 403 rate from "any pair straddling a 30s boundary" to "only on proxy outage".

**Recommendation:** Keep linear fallback-on-failure rotation. Add comment: (a) domain-hash guarantees consistent startIdx, (b) KVS tokens are IP-bound with 1–2h default TTL, (c) proxy failure mid-session still causes IP switch — accepted residual risk. Source: HAProxy sticky sessions blog; nginx hash upstream docs.

---

## Q2: M3U8 rewriting — referer propagation to segment proxy URLs

**Current plan:** `rewriteM3u8` rewrites segment URLs to `/proxy?url=<enc>&key=<key>` with NO `&referer=` param on rewritten segment URLs.

**Industry pattern:** Open-source HLS proxy rewriters propagate the original referer into rewritten segment URLs. warren-bank/HLS-Proxy base64-encodes `video_url|referer_url` into the proxy path. MHSanaei/HLS-Proxy-Worker passes `&referer=<encoded>` on all rewritten child URLs. CDNs often validate Referer on segment requests under the same policy as manifest requests. Exception: CDNs that authenticate via signed token params embedded in the segment URL itself (`ev-h.phncdn.com` — each segment already carries `validfrom/validto/hash` query params).

**Verdict:** ⚠️ Safe for pornhub/phncdn specifically because segment auth is via signed URL params, not Referer. Would break if other RESIDENTIAL domains whose CDNs validate Referer were added.

**Recommendation:** Add a TODO comment at the `proxify` return in `rewriteM3u8` (index.js line ~247): "Referer not propagated — safe for phncdn signed-token CDN. Update if adding RESIDENTIAL domains with Referer-validated CDNs." Source: stream-proxy-worker (CF Worker HLS proxy).

---

## Q3: Removing client-side proxyM3u8 in favour of server-side rewriting

**Current plan:** REQ-1 replaces `proxyM3u8(hlsUrl, referer)` with `buildProxyUrl(hlsUrl, referer)` for pornhub, delegating segment rewriting to CF Worker `rewriteM3u8`. `proxyM3u8` retained for Deno-proxied adapters.

**Industry pattern:** Three approaches in order of prevalence:
1. **Server-side proxy rewriter** (dominant): backend rewrites manifest, player issues plain GETs. Used by all CF Worker HLS proxy implementations. Zero client complexity.
2. **Service Worker intercept** (modern browser/OTT): SW injects headers transparently. Not applicable — Lampa targets Smart TV WebViews and Android TV where SWs are unavailable.
3. **Client-side blob rewriter** (legacy/fallback): fetch manifest via proxy, rewrite client-side, blob URL. Fragile, adds latency on multi-level HLS. Exactly what `proxyM3u8` does.

Lampac/xsena returns direct CDN URLs only via `Lampa.Reguest.native()` on Android. Inapplicable in browser where user IP triggers CORS.

**Verdict:** ✅ REQ-1 is correct architectural direction. Retaining `proxyM3u8` for non-RESIDENTIAL adapters using Deno is correct. Source: Mux blog (Service Workers); MHSanaei/HLS-Proxy-Worker.

---

## Q4: KVS token IP-binding and proxy affinity window

**Current plan:** 30s time-window replaced by domain-hash. RISK-2 acknowledges hash cannot prevent IP divergence on proxy failure.

**Industry pattern:** KVS 6.4.0 introduced configurable stream URL TTL; operator reports confirm default 1–2h. Token is bound to IP that initiates the session — segments from a different IP return 403. The 30s rotation window is directly harmful: manifest and first segment straddling a 30s boundary hit different SOCKS5 exit IPs → immediate 403. Domain-hash eliminates this boundary-crossing failure mode entirely for the common case. Residual case (proxy outage → fallback to N+1) still causes IP switch, unavoidable without server-side KV state (which adds async I/O + per-request cost + consistency race).

**Verdict:** ✅ Hash is strictly better than time-window for KVS IP-bound tokens. Source: KVS 6.4.0 release notes; HAProxy consistent hashing.
