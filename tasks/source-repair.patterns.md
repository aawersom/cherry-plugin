# source-repair — Pattern Scan
Mode: FULL · Stage 1.5

---

## Q1: IP-locked CDN token handling via consistent proxy

**Current plan**: pornone CDN tokens are IP-bound. Strategy A: CDN hostname → PROXY_URL_2_HOSTS (Deno only). Strategy B: pornone.com + CDN both → Deno.

**Industry pattern**: IP-bound tokens require all token-sharing requests to originate from the same IP. Deno Deploy is an Anycast edge runtime (12+ regions) — two requests from the same user session will route to the same Deno POP (Anycast is geographically sticky) but this is probabilistic, not guaranteed. The only reliable fix for strict IP binding is a single static-IP proxy. Source: [Deno Deploy Regions](https://docs.deno.com/deploy/classic/regions/), [bunny.net token auth docs](https://docs.bunny.net/cdn/security/token-authentication).

**Verdict**: 🚨 Concrete gap. Strategy B reduces the problem (co-locates page and stream through same proxy class) but cannot guarantee same-POP routing.

**Recommended change**: Ship Strategy B (pornone.com + CDN both in PROXY_URL_2_HOSTS) as the primary approach. Add an explicit code comment: `// pornone CDN IP-bound tokens — routes via Deno; same-POP delivery is likely (Anycast) but not guaranteed`. If Strategy B fails in E2E, document pornone as Tier C infrastructure-blocked. A static-IP VPS proxy is the correct long-term fix but is out of scope for this task.

---

## Q2: Regional subdomain as Cloudflare challenge bypass

**Current plan**: Use `ru.spankbang.com` because empirical tests return real HTML from Deno Deploy IPs (607KB, no challenge). Main `spankbang.com` and `www.spankbang.com` are CF-challenge-gated from all datacenter IPs.

**Industry pattern**: This is an observed tactic: regional subdomains can have different Cloudflare Security Level settings (set per zone/route by the site operator), so `ru.` may genuinely have a lower challenge threshold. Professional scraping services (ZenRows, ScrapeOps) do not name this as a canonical technique — they focus on residential IPs and headless browsers. Risk: the site owner can enable the challenge on `ru.` at any moment; CF Bot Fight Mode enables at zone level (all subdomains). The bypass is fragile and opportunistic. Source: [ZenRows CF bypass guide](https://www.zenrows.com/blog/bypass-cloudflare), [ScrapeOps CF playbook](https://scrapeops.io/web-scraping-playbook/how-to-bypass-cloudflare/).

**Verdict**: ⚠️ OK but fragile. The empirical result is valid; the change is correctly isolated (one hostname swap, one PROXY_URL_2_HOSTS entry). Easy to revert.

**Recommended change**: Add code comment in plugin.js near the `ru.spankbang.com` PROXY_URL_2_HOSTS entry: `// ru.spankbang.com has lower CF security level than www — may break if site enables Bot Fight Mode`. Add backlog item: fallback to FlareSolverr or residential relay if ru. starts challenging.

---

## Q3: Promise chain for two-step fetch (page → XHR)

**Current plan**: `cherryFetch(pageUrl).then(html => { extract hash; return cherryFetch(xhrUrl); }).then(text => JSON.parse...).catch(() => empty)`.

**Industry pattern**: This is the idiomatic ES5 promise chain for two sequential dependent fetches. The chain is correct per Promise/A+ spec (section 2.3.2): returning a promise from inside `.then()` causes the next `.then()` to wait for it and receive its resolved value. The outer `.catch` covers both fetch rejections and any `throw` inside any `.then` callback (including `JSON.parse` on malformed JSON). `async/await` is ES2017 and not usable in the ES5-compatible IIFE (Lampa targets old Android TV WebViews). Source: [MDN Promise chaining](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises#chaining), Promises/A+ spec section 2.3.2.

**Verdict**: ✅ Aligned. Pattern is correct and the only practical form in this codebase.

**Recommended change**: None structural. Wrap `JSON.parse(text)` in try/catch for debuggability if logging is ever added. Currently the outer `.catch` silently returns empty — acceptable by design.

---

Sources:
- [Deno Deploy Regions](https://docs.deno.com/deploy/classic/regions/)
- [bunny.net Token Authentication](https://docs.bunny.net/cdn/security/token-authentication)
- [ZenRows: Bypass Cloudflare](https://www.zenrows.com/blog/bypass-cloudflare)
- [ScrapeOps: How to Bypass Cloudflare](https://scrapeops.io/web-scraping-playbook/how-to-bypass-cloudflare/)
