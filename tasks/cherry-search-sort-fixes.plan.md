# Cherry — search/categories/sort/UI fixes (spec + plan)

**Mode:** medium · **Arch source of truth:** `docs/CHERRY.md` · **Date:** 2026-06-04

Driven by on-device feedback. Root causes confirmed by 3 read-only investigations.
Freeze on "card formation / playback" is **lifted by explicit user instruction**
for items touching parsers/titles/preview (J, D, B, C).

## Decisions (from user feedback)
- Titles: use the **original scraped title** as-is (English stays English, Russian
  stays Russian). No translation. → already the behavior; only fix EMPTY titles.
- Default sort = **popular/most-viewed** where the site supports it.
- Focus frame: **one** frame, simplest reliable way; pink only if trivially reliable.
- Home tiles: smaller still.

## Root causes (investigation results)
- **J (preview/play = neighbor):** adapter parser off-by-one — xnxx `_parseCards`
  splits on inner `thumb-under` caption, so `thumb` belongs to card i+1 while
  `href`/`title` belong to card i. Other split-based parsers (video-item,
  video-thumb, box-feature) must be audited for the same pattern. Fix = split on
  the OUTER card wrapper (xvideos already does: `thumb-block`).
- **I (badge missing on 1st card):** `.cherry-src-badge` has no z-index; the
  focus-injected preview `<video>` paints over it on the focused (initially first) card.
- **A1 (no nav in search results):** `Lampa.Controller.toggle('content')` runs
  BEFORE `Activity.push` in both Input.edit callbacks (home search tile + `_openSearch`);
  source/favorites tiles don't toggle and nav works there. Remove the premature toggle.
- **A2 (no sort in search):** action-menu flags are single-source bound; all_sources
  has no single source. Single-source search already supports sort.
- **A3 (poor relevance, e.g. "woodman"):** query encoding is fine. eporner forces
  `most-popular` in search; all_sources takes unranked `slice(0,10)`. Fix = relevance
  order for eporner search + title-match filter before slice.
- **B (BBW/redhead empty):** eporner category browse uses JSON keyword search instead
  of the HTML `/cat/{slug}/{page}/` page → sparse single-word categories return empty.
- **C (sort):** only pornhub + kvs engines apply sort; default is "latest" nearly
  everywhere. kvs default → `cfg.sorts[0].id` (Популярное). Path-sort sites
  (crocotube/eporner/pornone/ebun/lenporno) need their researched path sorts re-added.
- **D/H2 (empty card titles):** ~17 parsers lack a final fallback → `title=''`.
  Add a shared `_titleFromUrl(url)` slug fallback (hqporner/pornone/hellporno already do).
- **H3 (English titles):** already satisfied — no adapter translates. No work.

## Review revisions applied (architect-reviewer, needs_revision)
- **J scope corrected:** xnxx `_parseCards` is the ONLY off-by-one (splits on inner
  `thumb-under`). **DO NOT TOUCH** xvideos(thumb-block)/spankbang(video-item)/
  youjizz·hellporno(video-thumb)/hqporner(box feature) — all confirmed split on the
  OUTER wrapper and are correct. Changing them breaks working channels.
- **Tests run on INLINE parser copies**, not plugin.js (IIFE). Fix BOTH plugin.js AND
  the inline copy; the existing xnxx test fixture is non-representative (img inside
  thumb-under) — replace with REAL markup (`<div class=thumb><img></div><div class=thumb-under><a href><title></div>`, 2+ cards).
- **kvs default-sort re-targeted:** sort is currently appended ONLY in the category
  branch (`cfg.categoryFmt`), never to the default `browseUrl(p)`. Default popular must
  be threaded into `browseUrl` (or build a sort-aware default URL). Verify each KVS
  engine accepts `?sort_by=` on its DEFAULT page before defaulting; category pages
  already take it. Don't blindly add to category URLs (may 404).
- **all_sources title filter:** make PER-SOURCE-aware (if a source's filtered slice is
  empty, keep its unfiltered top-N), apply only when query is Latin/ASCII or title
  non-empty; sequence AFTER the empty-title fix so it doesn't drop title-less cards.
- **eporner /cat/ rewrite:** keep the JSON API path as a FALLBACK when the HTML parser
  yields 0 cards; capture a real `/cat/` listing fixture first.
- **Drop** the unjustified `return this.render()` from A1 unless `create` doesn't already
  return html (A1 fix is ONLY removing the premature toggle; no compensating focus).
- **A2 honesty:** most adapters' `search(query,page)` ignore sort → scope search-sort to
  adapters that honor it (xvideos/pornhub/kvs) or label best-effort.
- **Default-sort = popular** is a product change → apply where safe; consider persisting
  last-chosen sort per source (deferred).

## Phases (reordered: critical correctness first; each shippable + verified)

### Phase 1 — Correctness: parser off-by-one (J) + empty titles (D/H2)
- J: fix **xnxx ONLY** — split on outer `thumb-block` wrapper (like xvideos). Apply to
  plugin.js AND the inline test copy. Explicit no-touch list above.
- D: shared `_titleFromUrl(url)` helper → last meaningful path segment, strip extension +
  leading numeric id, decodeURIComponent, `[-_]`→space, trim; return `''` (NOT a number)
  if purely numeric so callers keep their better fallback. Apply as final fallback in the
  ~17 medium-risk parsers (xvideos/xnxx/spankbang/youjizz/porntrex/3movs/pornve/familyporn/
  perfektdamen/xozilla/analdin/crocotube/pornobolt/ebun/lenporno/jopaonline/porndig).
- **Tests (fixture-backed, REAL markup):** new `test/fixtures/xnxx-list.html` (2+ cards,
  real layout); assert xnxx `items[0].url` & `items[0].thumb` share the video id and
  `items[1]` too; every parsed card has non-empty title; `_titleFromUrl` unit table per
  URL shape (incl. numeric-only → ''). Inline copy kept in sync with plugin.js.
- **Security review:** new/changed regex (ReDoS), scraped-HTML handling. **Verify:** device.

### Phase 2 — UI/CSS quick wins (low risk, pure presentation)
- F: single focus frame — remove the competing custom pink ring; rely on the native
  single frame (keep a subtle `scale`). (Pink deferred — needs DevTools of native rule.)
- G: smaller home tiles — `cols--7` → `cols--8`.
- H4: card title font slightly smaller.
- I: `.cherry-src-badge { z-index:2 }`.
- E: source badge also in FAVORITES grid (extend badge condition to favorites).
- **Tests:** anti-drift CSS assertions. **Verify:** node check + load + device.

### Phase 3 — Search correctness
- A1: remove `Lampa.Controller.toggle('content')` from the two Input.edit callbacks
  (home search tile + `_openSearch`). No compensating focus (cherry_grid.start re-binds).
- A3: eporner `search` uses relevance/default order (not most-popular); add a PER-SOURCE
  title-match filter before `slice(0,10)` in the all_sources merge (keep source's
  unfiltered top-N if its filtered slice empties; skip filter for non-ASCII queries).
- A2: expose Sort in single-source search scoped to adapters that honor sort; optional
  client-side post-sort for all_sources.
- **Tests:** no `toggle('content')` in search callbacks; per-source filter present;
  eporner search has no forced most-popular. **Verify:** device (nav + relevance).

### Phase 4 — Categories + default sort (B, C) — biggest data phase
- B: eporner category browse → HTML `/cat/{slug}/{page}/` + small HTML card parser,
  with JSON API as fallback on 0 cards. Real `/cat/` fixture first.
- C: thread default popular sort into kvs `browseUrl` (re-targeted per review); verify
  each KVS default page accepts `?sort_by=`. Re-add path-segment sorts for crocotube/
  eporner/pornone/ebun/lenporno from `cherry-categories.json` so `_hasSorts` exposes them.
- spankbang: verify `/s/` category coverage (BBW/redhead) live; switch route if sparse.
- **Tests:** eporner category URL is `/cat/` not API (with fallback); kvs default browse
  appends sort. **Verify:** DEVICE-CRITICAL — user confirms BBW/redhead/sort per channel.

### Phase 5 — Active filter in grid header (H1)
- Show active sort/category in the grid header after a filter change (InteractionCategory
  header may need explicit set, not just `build({title})`).
- **Tests:** assert header reflects `_titleWithFilters`. **Verify:** device.

## Out of scope / deferred
- HD/4K badge (needs per-adapter data). Lampa global-search registration (API unverified).
- Pink focus frame (needs DevTools inspection of the native rule on the user's skin).

## Verification reality
No dev server / Playwright (TV plugin). Gate = `node --check` + load harness + vitest
(unit + fixture) + **user device validation** for per-adapter data (categories/sort/relevance).
