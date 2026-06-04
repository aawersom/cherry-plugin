# Cherry — redesign "Похожие" (spec)

**Mode:** medium · **Date:** 2026-06-04 · freeze on playback stays; this is related-discovery, additive.

## Intent (user)
Two distinct menu items on a card:
- **«Похожие»** = the site's OWN recommended/related videos (the block under the player that
  almost every site renders on the video page). Today only pornhub/xvideos have this.
- **«Похожие названия»** = keyword search by the title's words (the CURRENT "Похожие видео"),
  just renamed.

## Key design (feasibility CONFIRMED)
The video page already contains a "Related Videos" block using the SAME card markup as the
listing (verified: xozilla video page → 10 related cards in `/videos/{id}/` markup). `getStream`
already fetches the video-page HTML. So generalize related by **reusing each adapter's existing
card parser on the video-page HTML**, filtering out the current video.

## Changes
1. **Labels:** `cherry_related` "Похожие" (site related). NEW `cherry_similar_titles`
   "Похожие названия" for the keyword-search item (was `cherry_similar` "Похожие видео").
2. **Generalize getRelated:**
   - Add `getRelated(video)` to the `_kvsEngine` factory → `cherryFetch(video.url)` →
     `_kvsParseCards(html, cfg)` → drop the current video (by id/url) → slice(~20). Covers
     xozilla/analdin/hellporno/pornobolt/crocotube at once.
   - For custom HTML adapters that have a standalone card parser (`_3movsCards`, `_porntrexCards`,
     `_pornveCards`, `_familyCards`, `_lenpornoCards`, `_jopaCards`, `_rolikaCards`, `_porndigCards`,
     `_perfektCards`, `_tizamCards`, youjizz `_parseCards`, etc.): add `getRelated(video)` that runs
     that parser on the video-page HTML and filters the current video. Only where the parser is
     reusable on the video page; skip (note) where the video page uses different markup or the
     adapter is JSON-API (eporner — its API has no related; leave keyword-only).
   - Keep pornhub/xvideos existing getRelated.
3. **onMenu order:** «Похожие» (when adapter.getRelated exists) → «Похожие названия» (always) →
   «Избранное» (keep fav too). Empty related → Noty "ничего не найдено", don't push empty grid.
4. Auto-related-after-player (REQ-4) already keys off `source.getRelated` → now fires on more channels; no change.

## Constraints
- Do NOT touch getStream/playback/proxy. getRelated may reuse the SAME page fetch but must not
  alter stream extraction.
- Reuse existing parsers — do NOT write new card regexes per channel.
- `_titleFromUrl`/title fallbacks already ensure related cards have titles.

## Tests
- Label keys: cherry_related="Похожие", cherry_similar_titles="Похожие названия"; old cherry_similar
  keyword item renamed.
- _kvsEngine.getRelated parses related from a fixture video page (kvs markup) and excludes current.
- onMenu builds «Похожие» only when getRelated present, «Похожие названия» always; keyword search
  uses title words; related pushes _related_items grid.

## Verify
node check + load + vitest; device: long-press a card → «Похожие» shows real site recommendations
on kvs channels; «Похожие названия» does keyword search.
