# Bugs Backlog

Out-of-scope bugs spotted during tasks. Critical/high → fix in flight. Medium/low → here for a separate conversation.

---

## cherry-ux-v2 (2026-06-03)

### BL-1 (low, pre-existing) — `video.title` interpolated into cherry_card template without confirmed escaping
**Where:** `plugin.js` renderCards `Lampa.Template.get('cherry_card', {title:...})` + template `<div class="cherry-card__title">{title}</div>`
**Risk:** `title` comes from untrusted scraped HTML. `_parseHtmlCards` runs `_decodeHtml` on it, which can turn `&lt;img&gt;` back into live `<img>`. If `Lampa.Template.get` does naive string replacement without HTML-escaping → stored-DOM XSS in the card grid.
**Scope:** Pre-existing — affects ALL cards (browse/search/related), not introduced by Phase 1. The model badge already uses the safe `.text()` pattern (`modelBadge.text(...)`).
**Fix (fundamental):** set title via `card.find('.cherry-card__title').text(video.title)` after template instantiation, remove `{title}` from template. Same for any other interpolated untrusted field. Caught by: security reviewer (Phase 1).

### BL-2 (low, pre-existing) — thumb/preview src set without scheme allowlist
**Where:** `plugin.js` renderCards `.attr('src', video.thumb)`, `_startPreview` videoEl.src
**Risk:** Low (javascript:/data: URLs inert for img/video media loads), but malformed values could trigger unexpected requests.
**Fix:** validate `https?://` or `//` prefix centrally in renderCards before assignment. Caught by: security reviewer (Phase 1).

### BL-3 (nit) — getRelated relatedVideosJSON branch has no result cap
**Where:** `plugin.js` pornhub getRelated — JSON path returns full array; HTML fallback caps at `.slice(0,20)`.
**Risk:** malicious page with huge relatedVideosJSON → unbounded card render (mild client resource exhaustion).
**Fix:** apply consistent `.slice(0, N)` cap before rendering related results. Caught by: security reviewer (Phase 1).
