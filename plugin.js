(function () {
  'use strict';

  if (window.plugin_cherry_ready) return;
  window.plugin_cherry_ready = true;

  // ============================================================
  // CONFIG — user sets these after deploying their proxy
  // ============================================================
  var PROXY_URL = 'https://cherry-proxy.aawersom.workers.dev';
  // Secondary proxy on Deno Deploy — used for sites that block Cloudflare datacenter IPs
  var PROXY_URL_2 = 'https://cherry-proxy.aawersom.deno.net';
  // Tertiary proxy — VPS with rotating residential IPs (set to '' if not deployed)
  // Deploy workers/cherry-proxy-vps/index.js on Beget VPS, then fill in your IP:PORT
  var PROXY_URL_3 = '';

  var PROXY_URL_2_HOSTS = {
    // xnxx: CF Worker IPs blocked at ASN level; Deno works
    'xnxx.com': 1, 'www.xnxx.com': 1,
    // youjizz: rate-limits CF datacenter IPs
    'www.youjizz.com': 1, 'youjizz.com': 1,
    // tizam.org: rate-limits rapid sequential CF datacenter requests
    'tv4.tizam.org': 1,
    // pornone/porntrex: Deno — KVS IP-bound tokens require page+CDN on same fixed IP
    'pornone.com': 1, 'www.pornone.com': 1,
    'porntrex.com': 1, 'www.porntrex.com': 1,
    // eporner: SOCKS5 instability — revert to Deno
    'www.eporner.com': 1,
    // spankbang ru: Deno for browse (SOCKS5 blocks even browse); stream remains broken (needs Playwright)
    'ru.spankbang.com': 1,
    // mydaddy.cc: bigcdn tokens IP-bound to mydaddy.cc fetch IP — must use same proxy as bigcdn
    'mydaddy.cc': 1,
    // bigcdn.cc all subdomains covered by /\.bigcdn\.cc$/ regex in buildProxyUrl
    // perfektdamen KVS CDN — IP-bound tokens require consistent egress IP
    'www.perfektdamen.co': 1
  };

  // Domains that need residential IP — routed via PROXY_URL_3 when available
  var PROXY_URL_3_HOSTS = {
    'www.pornhub.com': 1,
    'rt.pornhub.com': 1
  };

  function getProxyKey() {
    return Lampa.Storage.get('cherry_proxy_key', '1206');
  }

  // ============================================================
  // PROXY HELPERS
  // ============================================================

  /** @param {string} url @param {string=} referer @returns {string} */
  function buildProxyUrl(url, referer) {
    var key = getProxyKey();
    var base = PROXY_URL;
    if (PROXY_URL_3) {
      try { if (PROXY_URL_3_HOSTS[new URL(url).hostname]) base = PROXY_URL_3; } catch (e) {}
    }
    if (base === PROXY_URL && PROXY_URL_2) {
      try {
        var h = new URL(url).hostname;
        if (PROXY_URL_2_HOSTS[h] || /\.bigcdn\.cc$/.test(h) || /(?:^|\.)pornone\.com$/.test(h)) base = PROXY_URL_2;
      } catch (e) {}
    }
    var p = base + '/proxy?url=' + encodeURIComponent(url);
    if (key)     p += '&key=' + encodeURIComponent(key);
    if (referer) p += '&referer=' + encodeURIComponent(referer);
    return p;
  }

  function _isAndroid() {
    try {
      return !!(window.Lampa && window.Lampa.Platform &&
                typeof window.Lampa.Platform.is === 'function' &&
                window.Lampa.Platform.is('android'));
    } catch (e) { return false; }
  }

  function _nativeFetch(url) {
    return new Promise(function(resolve, reject) {
      var req = new window.Lampa.Reguest();
      req.native(url, function(data) {
        resolve(typeof data === 'object' ? JSON.stringify(data) : String(data));
        req.clear();
      }, function(err) {
        req.clear();
        reject(err);
      }, false, { dataType: 'text', timeout: 4000 });
    });
  }

  /** @param {string} url @param {string=} referer @returns {Promise<string>} */
  function cherryFetch(url, referer) {
    if (_isAndroid()) {
      return _nativeFetch(url).catch(function() {
        return fetch(buildProxyUrl(url, referer)).then(function(r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        });
      });
    }
    return fetch(buildProxyUrl(url, referer)).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  }

  /**
   * Status-tolerant fetch: returns body text regardless of HTTP status.
   * Needed for sites (e.g. 3movs) that serve a valid full page body with a
   * 404 status header on category pagination (page > 1).
   * @param {string} url @param {string=} referer @returns {Promise<string>}
   */
  function _fetchAny(url, referer) {
    if (_isAndroid()) {
      return _nativeFetch(url).catch(function () {
        return fetch(buildProxyUrl(url, referer)).then(function (r) { return r.text(); });
      });
    }
    return fetch(buildProxyUrl(url, referer)).then(function (r) { return r.text(); });
  }

  /**
   * POST via proxy using native fetch (Lampa.Reguest does not expose POST).
   * @param {string} url
   * @param {string} body  application/x-www-form-urlencoded string
   * @returns {Promise<string>}
   */
  function cherryPost(url, body) {
    return fetch(buildProxyUrl(url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  }


  // Picks the best available quality URL (highest numeric label wins).
  function bestQualityUrl(quality) {
    var keys = Object.keys(quality || {});
    if (!keys.length) return '';
    var best = 0, bestUrl = '';
    keys.forEach(function (k) {
      var n = parseInt(k, 10) || 0;
      if (n > best) { best = n; bestUrl = quality[k]; }
    });
    return bestUrl || quality[keys[0]];
  }

  // Track blob URLs created by proxyM3u8 so they can be revoked on player close.
  var _blobUrls = [];

  // Related video panel state (REQ-4).
  var _relatedGeneration = 0;
  var _pendingRelated    = [];
  var _relatedSrc        = null;

  // Fetches an HLS m3u8 through the proxy and rewrites all non-comment lines:
  //   - Sub-playlist lines (.m3u8) → recursively proxied → inner blob URL
  //   - Segment lines (.ts, etc.) → direct proxy URL
  // Handles multi-level HLS (master → index → segments) so hls.js resolves
  // segment paths against a blob URL that already has correct proxied paths.
  function proxyM3u8(m3u8Url, referer) {
    if (_isAndroid()) return Promise.resolve(m3u8Url);
    return cherryFetch(m3u8Url, referer).then(function (content) {
      var basePath = m3u8Url.split('?')[0];
      var baseUrl = basePath.substring(0, basePath.lastIndexOf('/') + 1);

      var lines = content.split('\n');
      var promises = lines.map(function (line) {
        var l = line.trim();
        if (!l || l[0] === '#') return Promise.resolve(line);
        var abs = (l.indexOf('http') === 0) ? l : baseUrl + l;
        // Sub-playlist: proxy recursively so its segments are also rewritten.
        if (/\.m3u8/.test(abs.split('?')[0])) {
          return proxyM3u8(abs, referer).catch(function () {
            return buildProxyUrl(abs, referer);
          });
        }
        return Promise.resolve(buildProxyUrl(abs, referer));
      });

      return Promise.all(promises).then(function (rewrittenLines) {
        var blob = new Blob([rewrittenLines.join('\n')], { type: 'application/vnd.apple.mpegurl' });
        var blobUrl = URL.createObjectURL(blob);
        _blobUrls.push(blobUrl);
        return blobUrl;
      });
    });
  }

  // ============================================================
  // SOURCES — adapters register here
  // ============================================================

  /**
   * @typedef {Object} VideoCard
   * @property {string} id
   * @property {string} source
   * @property {string} title
   * @property {string} thumb
   * @property {string} url
   * @property {number} [duration]
   * @property {number} [views]
   */

  /**
   * @typedef {Object} BrowseResult
   * @property {VideoCard[]} items
   * @property {number} total_pages
   */

  /**
   * @typedef {Object} StreamResult
   * @property {string} url
   * @property {Object.<string,string>} quality  e.g. { '1080p': 'https://...' }
   */

  /**
   * @typedef {Object} SourceAdapter
   * @property {string} id
   * @property {string} name
   * @property {string} host
   * @property {function(string, number): Promise<BrowseResult>} search
   * @property {function(string, number): Promise<BrowseResult>} browse
   * @property {function(VideoCard): Promise<StreamResult>}     getStream
   */

  /** @type {SourceAdapter[]} */
  var SOURCES = [
    // Adapters are defined at the bottom of this file and push themselves here.
  ];

  // ============================================================
  // FAVORITES
  // ============================================================
  var Fav = {
    _key: 'cherry_favs',

    /** @returns {VideoCard[]} */
    all: function () {
      return Lampa.Storage.get(this._key, []);
    },

    /** @param {VideoCard} video @returns {boolean} */
    has: function (video) {
      return this.all().some(function (v) {
        return v.id === video.id && v.source === video.source;
      });
    },

    /**
     * Toggle favorite status.
     * @param {VideoCard} video
     * @returns {boolean} true if added, false if removed
     */
    toggle: function (video) {
      var list = this.all();
      var idx = -1;
      list.forEach(function (v, i) {
        if (v.id === video.id && v.source === video.source) idx = i;
      });
      if (idx >= 0) {
        list.splice(idx, 1);
      } else {
        list.unshift({
          id:       video.id,
          source:   video.source,
          title:    video.title   || '',
          thumb:    video.thumb   || '',
          url:      video.url     || '',
          duration: video.duration || 0,
          views:    video.views    || 0
        });
      }
      Lampa.Storage.set(this._key, list);
      return idx < 0;
    }
  };

  // ============================================================
  // UTILS
  // ============================================================

  /**
   * Convert seconds to M:SS string.
   * @param {number|string} s
   * @returns {string}
   */
  function secToTime(s) {
    s = parseInt(s, 10) || 0;
    var m   = Math.floor(s / 60);
    var sec = s % 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  /**
   * Format view count for display (e.g. 1200 → "1K").
   * @param {number} n
   * @returns {string}
   */
  function formatViews(n) {
    if (!n || isNaN(n)) return '';
    if (n >= 1000000) return Math.floor(n / 1000000) + 'M';
    if (n >= 1000)    return Math.floor(n / 1000) + 'K';
    return String(n);
  }

  /**
   * Lookup adapter by id.
   * @param {string} id
   * @returns {SourceAdapter|null}
   */
  function sourceById(id) {
    for (var i = 0; i < SOURCES.length; i++) {
      if (SOURCES[i].id === id) return SOURCES[i];
    }
    return null;
  }

  /**
   * Resolve stream for a video and hand off to Lampa.Player,
   * showing a quality picker when multiple streams exist.
   * @param {VideoCard}     video
   * @param {SourceAdapter} source
   */
  function playVideo(video, source) {
    Lampa.Noty.show(Lampa.Lang.translate('cherry_loading'));

    source.getStream(video).then(function (stream) {
      var quality = stream.quality || {};
      var url = bestQualityUrl(quality) || stream.url;

      if (!url) {
        Lampa.Noty.show(Lampa.Lang.translate('cherry_error'), { style: 'warn' });
        return;
      }

      // Proxy non-blob stream URLs so that tokens bound to the proxy IP stay valid.
      function px(u) {
        if (!u) return u;
        // Android: native player loads the stream directly from the device's
        // home (residential) IP. Since the page was also fetched natively from
        // the same IP, IP-bound CDN tokens (phncdn, KVS get_file) stay valid
        // with NO proxy. Hand the raw URL to the native player.
        if (_isAndroid()) return u;
        if (u.indexOf('blob:') === 0) return u;
        if (PROXY_URL_3 && u.indexOf(PROXY_URL_3) === 0) return u; // skip VPS-proxied URLs
        if (PROXY_URL_2 && u.indexOf(PROXY_URL_2) === 0) return u; // skip Deno-proxied URLs
        if (u.indexOf(PROXY_URL) === 0) return u; // skip CF Worker-proxied URLs
        // Normalize protocol-relative URLs (e.g. YouJizz returns //cdne-mobile.youjizz.com/...)
        if (u.indexOf('//') === 0) u = 'https:' + u;
        return buildProxyUrl(u);
      }
      var proxiedQuality = {};
      Object.keys(quality).forEach(function(k) { proxiedQuality[k] = px(quality[k]); });

      Lampa.Player.play({
        title:   video.title,
        url:     px(url),
        poster:  video.thumb,
        quality: proxiedQuality
      });

      // REQ-4: reset state and kick off background related fetch.
      _relatedGeneration++;
      var myGen       = _relatedGeneration;
      _pendingRelated = [];
      _relatedSrc     = null;

      if (source.getRelated) {
        source.getRelated(video).then(function (items) {
          if (myGen !== _relatedGeneration) return;
          if (items && items.length) {
            _pendingRelated = items;
            _relatedSrc     = source;
          }
        }).catch(function () {});
      }
    }).catch(function (err) {
      console.warn('[Cherry] getStream error:', err);
      Lampa.Noty.show(Lampa.Lang.translate('cherry_error'), { style: 'warn' });
    });
  }

  // ============================================================
  // CHERRY GRID COMPONENT
  // Shows a paginated, infinite-scroll grid of video cards.
  //
  // object properties:
  //   source_id   {string}  — adapter id
  //   query       {string}  — search query (omit for browse)
  //   all_sources {boolean} — search ALL sources in parallel
  //   is_favorites{boolean} — show favorites list
  //   title       {string}  — screen title
  //   page        {number}  — initial page (currently unused; scroll drives paging)
  // ============================================================

  /**
   * @constructor
   * @param {Object} object  Activity params
   */
  function CherryGrid(object) {

    /** @type {jQuery} */
    var html;
    /** @type {Lampa.Scroll} */
    var scroll;

    var currentPage = 1;
    var totalPages  = 1;
    var loading     = false;
    var destroyed   = false;

    var _currentPreviewEl   = null;
    var _currentPreviewCard = null;

    var currentSort     = '';
    var currentCategory = '';

    var sentinel          = null;
    var _sentinelObserver = null;

    // Action-menu state (P0): computed in create(), consumed by the right-edge
    // handler in start() to open the Поиск → Сортировка → Категории menu.
    var _source    = null;
    var _canSearch = false;
    var _hasSorts  = false;
    var _hasCats   = false;
    // Re-entrancy guard shared by ALL directional handlers. On some Lampa builds
    // Lampa.Controller.move(dir) re-dispatches into the same-direction handler at
    // an edge — without this guard that recurses to a stack overflow and kills the
    // controller (arrows stop responding). The nested call bails immediately; the
    // outer call completes. For 'right' the "focus didn't change" check then opens
    // the action menu at the right edge.
    var _navMoving = false;

    function _stopCurrentPreview() {
      if (_currentPreviewEl) {
        _currentPreviewEl.pause();
        _currentPreviewEl.removeAttribute('src');
        _currentPreviewEl.load();
        _currentPreviewEl.style.display = 'none';
        _currentPreviewEl   = null;
        _currentPreviewCard = null;
      }
    }

    function _startPreview(card, url) {
      var videoEl = card.find('.cherry-card__preview')[0];
      if (!videoEl) return;
      videoEl.src = url;
      videoEl.load();
      videoEl.style.display = 'block';
      _currentPreviewEl   = videoEl;
      _currentPreviewCard = card;
      videoEl.play().catch(function () {
        if (!videoEl.parentNode) return;
        videoEl.style.display = 'none';
      });
    }

    function _reloadFromStart() {
      html.find('.cherry-grid__empty').hide();
      currentPage = 1;
      totalPages  = 1;
      loading     = false;
      scroll.body().find('.cherry-card, .cherry-group-label').remove();
      if (sentinel) scroll.body().append(sentinel);
      loadPage(1);
    }

    /**
     * D-pad infinite-scroll fallback. The IntersectionObserver is the primary
     * trigger for D-pad navigation; this proximity check covers cases where the
     * observer callback hasn't fired yet (large focus jumps) and is also invoked
     * directly by the observer callback (it re-checks the loading/page guards).
     */
    function maybeLoadMore() {
      if (loading || currentPage >= totalPages) return;
      if (!sentinel || !sentinel[0]) return;
      var rect  = sentinel[0].getBoundingClientRect();
      var viewH = window.innerHeight || document.documentElement.clientHeight;
      // 400px lookahead — D-pad focus steps are large, so trigger earlier than
      // the 300px pointer/scroll listener.
      if (rect.top < viewH + 400) {
        currentPage++;
        loadPage(currentPage);
      }
    }

    // Geometric right-edge test: is the focused card the rightmost in its row?
    // (no other card on the same row sits to its right). Independent of how
    // Lampa.Controller.move reflects focus — robust across builds.
    function _atRightEdge() {
      var focused = html.find('.cherry-card.focus')[0];
      if (!focused) return false;
      var r = focused.getBoundingClientRect();
      var cards = html.find('.cherry-card');
      for (var i = 0; i < cards.length; i++) {
        var o = cards[i].getBoundingClientRect();
        // same row (tops within half a card height) AND to the right
        if (Math.abs(o.top - r.top) < r.height / 2 && o.left > r.left + 2) return false;
      }
      return true;
    }

    function _findLabel(arr, id) {
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === id) return arr[i].label;
      }
      return id;
    }

    // ---- P0 right-edge action menu: Поиск → Сортировка → Категории ----------

    function _openSearch() {
      if (!_source) return;
      // Guard for forks without Lampa.Keyboard (mirrors bindSearch in CherryMain).
      if (typeof Lampa.Keyboard === 'undefined' || !Lampa.Keyboard.show) return;
      Lampa.Keyboard.show({
        title:   Lampa.Lang.translate('cherry_search'),
        value:   object.query || '',
        onenter: function (text) {
          var q = (text || '').trim();
          if (!q) { Lampa.Controller.toggle('cherry_grid'); return; }
          Lampa.Activity.push({
            component: 'cherry_grid',
            title:     _source.name + ': ' + q,
            source_id: object.source_id,
            query:     q,
            page:      1
          });
        },
        onback: function () { Lampa.Controller.toggle('cherry_grid'); }
      });
    }

    function _openSort() {
      if (!_source || !_source.cfg || !_source.cfg.sorts) return;
      var items = _source.cfg.sorts.map(function (s) { return { title: s.label, id: s.id }; });
      items.unshift({ title: Lampa.Lang.translate('cherry_sort_default'), id: '' });
      Lampa.Select.show({
        title: Lampa.Lang.translate('cherry_sort'),
        items: items,
        onSelect: function (item) {
          currentSort = item.id;
          _reloadFromStart();
          Lampa.Controller.toggle('cherry_grid');
        },
        onBack: function () { Lampa.Controller.toggle('cherry_grid'); }
      });
    }

    function _openCat() {
      if (!_source || !_source.cfg || !_source.cfg.categories) return;
      var items = _source.cfg.categories.map(function (c) { return { title: c.label, id: c.id }; });
      items.unshift({ title: Lampa.Lang.translate('cherry_category_default'), id: '' });
      Lampa.Select.show({
        title: Lampa.Lang.translate('cherry_category'),
        items: items,
        onSelect: function (item) {
          currentCategory = item.id;
          _reloadFromStart();
          Lampa.Controller.toggle('cherry_grid');
        },
        onBack: function () { Lampa.Controller.toggle('cherry_grid'); }
      });
    }

    /**
     * Right-edge action menu. Opened by pressing RIGHT at the right edge of the
     * card grid (Lampa's native filter idiom). Items appear in fixed order:
     * Поиск → Сортировка → Категории, each only when applicable to this screen.
     * @returns {boolean} true if a menu was shown
     */
    function openActionsMenu() {
      var items = [];
      if (_canSearch) items.push({ title: Lampa.Lang.translate('cherry_search'),   action: 'search' });
      if (_hasSorts)  items.push({ title: Lampa.Lang.translate('cherry_sort'),     action: 'sort'   });
      if (_hasCats)   items.push({ title: Lampa.Lang.translate('cherry_category'), action: 'cat'    });
      if (!items.length) return false;
      Lampa.Select.show({
        title: _source ? _source.name : 'Cherry',
        items: items,
        onSelect: function (item) {
          if      (item.action === 'search') _openSearch();
          else if (item.action === 'sort')   _openSort();
          else if (item.action === 'cat')    _openCat();
        },
        onBack: function () { Lampa.Controller.toggle('cherry_grid'); }
      });
      return true;
    }

    // ---- lifecycle --------------------------------------------------

    this.create = function () {
      currentPage = 1;
      totalPages  = 1;
      loading     = false;

      var source = object.is_favorites ? null : sourceById(object.source_id);
      var screenTitle = object.title
        || (source ? source.name : 'Cherry');

      html = Lampa.Template.get('cherry_grid', { title: screenTitle });

      scroll = new Lampa.Scroll({ mask: true, over: true });

      // Secondary scroll trigger for pointer/mouse users.
      // IntersectionObserver is primary for D-pad (see sentinel setup + maybeLoadMore).
      scroll.body().on('scroll', function () {
        var el = this;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) {
          if (!loading && currentPage < totalPages) {
            currentPage++;
            loadPage(currentPage);
          }
        }
      });

      scroll.body().addClass('cherry-cards-wrap');
      html.find('.cherry-grid__body').append(scroll.render());

      // P1: sentinel at list bottom + IntersectionObserver as primary D-pad trigger.
      // Observe against the viewport (root: null) so it works regardless of
      // Lampa.Scroll's transform-based internals across builds.
      sentinel = $('<div class="cherry-scroll-sentinel"></div>');
      scroll.body().append(sentinel);
      if (typeof IntersectionObserver !== 'undefined') {
        _sentinelObserver = new IntersectionObserver(function (entries) {
          if (entries[0] && entries[0].isIntersecting) maybeLoadMore();
        }, { root: null, rootMargin: '400px' });
        _sentinelObserver.observe(sentinel[0]);
      }

      // P0: right-edge action menu state. The menu (Поиск → Сортировка →
      // Категории) opens when RIGHT is pressed at the grid's right edge — see
      // openActionsMenu() and the `right` controller handler in start().
      // model_url excluded: model browse is already filtered to a performer.
      _source    = source;
      _canSearch = !object.is_favorites && !object.all_sources && !object._related_items && !object.model_url;
      _hasSorts  = !!(source && source.cfg && source.cfg.sorts && source.cfg.sorts.length);
      _hasCats   = !!(source && source.cfg && source.cfg.categories && source.cfg.categories.length);

      if (object.is_favorites) {
        var favItems = Fav.all();
        if (favItems.length) {
          renderCards(favItems, scroll.body());
          if (sentinel) scroll.body().append(sentinel);
        } else {
          // Children first, then parent — avoids a flash of the generic message.
          html.find('.cherry-grid__empty-generic').hide();
          html.find('.cherry-grid__empty-fav-hint').show();
          html.find('.cherry-grid__empty').show();
        }
      } else if (object._related_items) {
        renderCards(object._related_items, scroll.body());
        if (sentinel) scroll.body().append(sentinel);
        totalPages  = 1;
        currentPage = 1;
      } else if (object.all_sources && object.query) {
        loadAllSources(object.query);
      } else {
        loadPage(1);
      }

      return html;
    };

    this.start = function () {
      Lampa.Controller.add('cherry_grid', {
        toggle: function () {
          Lampa.Controller.collectionSet(html);
          Lampa.Controller.collectionFocus(false, html);
        },
        // All directions share _navMoving: move(dir) can re-dispatch into the
        // same handler at an edge; the nested call bails to avoid stack overflow.
        up:    function () { if (_navMoving) return; _navMoving = true; Lampa.Controller.move('up');   _navMoving = false; },
        down:  function () { if (_navMoving) return; _navMoving = true; Lampa.Controller.move('down'); _navMoving = false; maybeLoadMore(); },
        left:  function () { if (_navMoving) return; _navMoving = true; Lampa.Controller.move('left'); _navMoving = false; },
        // Right moves between cards; only at the geometric right edge (no card
        // to the right in this row) does it open the action menu. Geometric test
        // avoids relying on move()'s focus-update timing.
        right: function () {
          if (_navMoving) return;            // nested edge re-dispatch — bail out
          if (_atRightEdge()) { openActionsMenu(); return; }
          _navMoving = true;
          Lampa.Controller.move('right');
          _navMoving = false;
          maybeLoadMore();
        },
        back:  function () { Lampa.Activity.backward(); }
      });
      Lampa.Controller.toggle('cherry_grid');
    };

    this.render  = function () { return html; };
    this.pause   = function () {};
    this.stop    = function () {
      if (scroll) scroll.body().off('scroll');
      if (_sentinelObserver) { _sentinelObserver.disconnect(); _sentinelObserver = null; }
      _stopCurrentPreview();
    };

    this.destroy = function () {
      if (_sentinelObserver) { _sentinelObserver.disconnect(); _sentinelObserver = null; }
      _stopCurrentPreview();
      destroyed = true;
      if (html) html.remove();
    };

    // ---- data loading -----------------------------------------------

    /**
     * Load a single page from the current source adapter.
     * @param {number} page
     */
    function loadPage(page) {
      var source = sourceById(object.source_id);
      if (!source) {
        html.find('.cherry-grid__empty').show();
        return;
      }

      loading = true;
      setLoading(true);

      var promise;
      if (object.model_url) {
        if (!source || !source.browseByModel) {
          html.find('.cherry-grid__empty').show();
          loading = false;
          setLoading(false);
          return;
        }
        promise = source.browseByModel(object.model_url, page);
      } else if (object.query) {
        promise = source.search(object.query, page, currentSort);
      } else {
        promise = source.browse(currentCategory, page, currentSort);
      }

      promise.then(function (result) {
        if (destroyed) return;
        loading = false;
        setLoading(false);

        if (result && result.items && result.items.length) {
          totalPages = result.total_pages || 1;
          renderCards(result.items, scroll.body());
          if (sentinel) scroll.body().append(sentinel);
          Lampa.Controller.collectionSet(html);
        } else if (page === 1) {
          html.find('.cherry-grid__empty').show();
        }
      }).catch(function (err) {
        if (destroyed) return;
        console.warn('[Cherry] loadPage error (page ' + page + '):', err);
        loading = false;
        setLoading(false);
        if (page === 1) {
          Lampa.Noty.show(Lampa.Lang.translate('cherry_error'), { style: 'warn' });
          html.find('.cherry-grid__empty').show();
        }
      });
    }

    /**
     * Search ALL registered sources in parallel, merge and sort results.
     * Infinite scroll is disabled for this mode (all results load at once).
     * @param {string} query
     */
    function loadAllSources(query) {
      if (!SOURCES.length) {
        html.find('.cherry-grid__empty').show();
        return;
      }

      loading = true;
      setLoading(true);

      var promises = SOURCES.map(function (src) {
        return src.search(query, 1).catch(function (err) {
          console.warn('[Cherry] all_sources search error from ' + src.id + ':', err);
          return { items: [], total_pages: 1 };
        });
      });

      Promise.all(promises).then(function (results) {
        if (destroyed) return;
        loading = false;
        setLoading(false);

        // Group results per source (SOURCES order), capped at 10 cards each.
        // results[i] aligns with SOURCES[i] because promises was built via SOURCES.map(...).
        var groups = [];
        SOURCES.forEach(function (src, i) {
          var r = results[i];
          if (!r || !r.items || !r.items.length) return;
          groups.push({ src: src, items: r.items.slice(0, 10) });
        });

        if (!groups.length) {
          html.find('.cherry-grid__empty').show();
          return;
        }

        // Disable infinite scroll — we already have everything.
        totalPages  = 1;
        currentPage = 1;

        // Render label + its cards sequentially so order is:
        // label A, A-cards, label B, B-cards, ...
        groups.forEach(function (g) {
          var label = Lampa.Template.get('cherry_group_label', { name: g.src.name });
          scroll.body().append(label);
          renderCards(g.items, scroll.body());
        });

        if (sentinel) scroll.body().append(sentinel);

        Lampa.Controller.collectionSet(html);
      }).catch(function (err) {
        if (destroyed) return;
        console.warn('[Cherry] loadAllSources error:', err);
        loading = false;
        setLoading(false);
        Lampa.Noty.show(Lampa.Lang.translate('cherry_error'), { style: 'warn' });
      });
    }

    // ---- rendering --------------------------------------------------

    /**
     * Show / hide the loading indicator.
     * @param {boolean} state
     */
    function setLoading(state) {
      if (!html) return;
      html.find('.cherry-grid__loading').toggle(state);
    }

    /**
     * Create card elements for the given video list and append to container.
     * @param {VideoCard[]} items
     * @param {jQuery}      container
     */
    function renderCards(items, container) {
      items.forEach(function (video) {
        var src = sourceById(video.source) || sourceById(object.source_id);

        var card = Lampa.Template.get('cherry_card', {
          title:    video.title    || '',
          duration: video.duration ? secToTime(video.duration) : '',
          views:    formatViews(video.views)
        });

        // Lazy-load thumbnail.
        if (video.thumb) {
          card.find('.cherry-card__img').attr('src', video.thumb);
        }

        // Set initial fav indicator state.
        if (Fav.has(video)) {
          card.find('.cherry-card__fav').show();
        }

        // REQ-3: model/performer badge.
        if (video.model && video.model.name) {
          var modelBadge = card.find('.cherry-card__model');
          modelBadge.text(video.model.name).show();
          modelBadge.on('hover:enter', function () {
            var badgeSrc = sourceById(video.source);
            if (!badgeSrc || !badgeSrc.browseByModel) {
              Lampa.Noty.show(video.model.name, { style: 'info' });
              return;
            }
            Lampa.Activity.push({
              component:  'cherry_grid',
              title:      video.model.name,
              source_id:  video.source,
              model_url:  video.model.url,
              model_name: video.model.name,
              page:       1
            });
          });
        }

        // OK / Enter: play.
        card.on('hover:enter', function () {
          if (!src) {
            Lampa.Noty.show(Lampa.Lang.translate('cherry_error'), { style: 'warn' });
            return;
          }
          playVideo(video, src);
        });

        // Focus: refresh fav badge + animated preview (REQ-2).
        card.on('hover:focus', function () {
          card.find('.cherry-card__fav').toggle(Fav.has(video));
          _stopCurrentPreview();
          if (video.preview && Lampa.Storage.get('cherry_preview_enabled', true)) {
            if (!_isAndroid()) {
              _startPreview(card, video.preview);
            }
          }
        });

        // Long-press: context menu (favorites + similar search + adapter related).
        card.on('hover:long', function () {
          var isFav   = Fav.has(video);
          var cardSrc = sourceById(video.source) || sourceById(object.source_id);
          var items = [
            {
              title: isFav
                ? Lampa.Lang.translate('cherry_rem_fav_action')
                : Lampa.Lang.translate('cherry_add_fav_action'),
              action: 'fav'
            },
            {
              title: Lampa.Lang.translate('cherry_similar'),
              action: 'similar'
            }
          ];
          // 'similar' = keyword search across all sources; 'related' = adapter.getRelated() curated list.
          if (cardSrc && cardSrc.getRelated) {
            items.push({
              title: Lampa.Lang.translate('cherry_related'),
              action: 'related'
            });
          }
          Lampa.Select.show({
            title: video.title,
            items: items,
            onSelect: function (item) {
              if (item.action === 'fav') {
                var added = Fav.toggle(video);
                card.find('.cherry-card__fav').toggle(added);
                Lampa.Noty.show(
                  added
                    ? Lampa.Lang.translate('cherry_add_fav')
                    : Lampa.Lang.translate('cherry_rem_fav')
                );
                Lampa.Controller.toggle('cherry_grid');
              } else if (item.action === 'similar') {
                var words = (video.title || '').replace(/[^a-zа-яё0-9\s]/gi, '').trim().split(/\s+/).slice(0, 4);
                var query = words.join(' ');
                Lampa.Activity.push({
                  component:   'cherry_grid',
                  title:       Lampa.Lang.translate('cherry_similar') + ': ' + video.title,
                  source_id:   video.source,
                  query:       query,
                  all_sources: true,
                  page:        1
                });
                Lampa.Controller.toggle('cherry_grid');
              } else if (item.action === 'related') {
                setLoading(true);
                cardSrc.getRelated(video).then(function (rel) {
                  if (destroyed) return;
                  setLoading(false);
                  if (rel && rel.length) {
                    Lampa.Controller.toggle('cherry_grid');
                    Lampa.Activity.push({
                      component:      'cherry_grid',
                      title:          Lampa.Lang.translate('cherry_related') + ': ' + video.title,
                      source_id:      cardSrc.id,
                      _related_items: rel,
                      page:           1
                    });
                  } else {
                    Lampa.Noty.show(Lampa.Lang.translate('cherry_no_results'), { style: 'info' });
                    Lampa.Controller.toggle('cherry_grid');
                  }
                }).catch(function () {
                  if (destroyed) return;
                  setLoading(false);
                  Lampa.Noty.show(Lampa.Lang.translate('cherry_error'), { style: 'warn' });
                  Lampa.Controller.toggle('cherry_grid');
                });
              }
            },
            onBack: function () { Lampa.Controller.toggle('cherry_grid'); }
          });
        });

        container.append(card);
      });

      Lampa.Controller.collectionSet(html);
    }
  }

  // ============================================================
  // CHERRY MAIN COMPONENT
  // Source list + global search bar + favorites button.
  // ============================================================

  /**
   * @constructor
   * @param {Object} object  Activity params
   */
  function CherryMain(object) {
    /** @type {jQuery} */
    var html;
    var destroyed = false;
    var _toggling = false; // re-entrancy guard for view_toggle re-render
    var _navMoving = false; // re-entrancy guard: move(dir) can re-dispatch at an edge → stack overflow
    var mode; // 'tiles' | 'rows'

    // ---- lifecycle --------------------------------------------------

    this.create = function () {
      mode = Lampa.Storage.get('cherry_home_mode', 'tiles');
      html = Lampa.Template.get('cherry_main', {});

      if (mode === 'rows') {
        renderRows();
      } else {
        renderSources();
        bindSearch();
      }

      // Long-press on title: preview toggle + view mode toggle.
      // SettingsApi fallback — primary toggle is in Lampa settings page if SettingsApi is available.
      html.find('.cherry-main__title').on('hover:long', function () {
        var previewVal = Lampa.Storage.get('cherry_preview_enabled', true);
        var modeLabel  = mode === 'rows'
          ? Lampa.Lang.translate('cherry_view_tiles')
          : Lampa.Lang.translate('cherry_view_rows');
        Lampa.Select.show({
          title: 'Cherry',
          items: [
            {
              title: Lampa.Lang.translate('cherry_preview_setting') + ': ' + (previewVal ? 'ON' : 'OFF'),
              action: 'preview_toggle'
            },
            {
              title: modeLabel,
              action: 'view_toggle'
            }
          ],
          onSelect: function (item) {
            if (item.action === 'preview_toggle') {
              var val = !Lampa.Storage.get('cherry_preview_enabled', true);
              Lampa.Storage.set('cherry_preview_enabled', val);
              Lampa.Noty.show(Lampa.Lang.translate('cherry_preview_setting') + ': ' + (val ? 'ON' : 'OFF'));
            } else if (item.action === 'view_toggle') {
              if (_toggling) return;          // re-entrancy: ignore fast double-toggle
              _toggling = true;
              Lampa.Storage.set('cherry_home_mode', mode === 'rows' ? 'tiles' : 'rows');
              // backward() + re-push is the established Lampa re-render idiom.
              // No destroyed-guard here: the re-push MUST fire even though backward()
              // tears down this instance; Lampa.Activity.push is a global call, safe
              // to invoke from a torn-down component's timer.
              Lampa.Activity.backward();
              setTimeout(function () {
                Lampa.Activity.push({ component: 'cherry_main', title: 'Cherry', page: 1 });
              }, 50); // 50ms for the activity stack to settle after backward() — do not reduce.
            }
            Lampa.Controller.toggle('cherry_main');
          },
          onBack: function () { Lampa.Controller.toggle('cherry_main'); }
        });
      });

      return html;
    };

    this.start = function () {
      Lampa.Controller.add('cherry_main', {
        toggle: function () {
          Lampa.Controller.collectionSet(html);
          Lampa.Controller.collectionFocus(false, html);
        },
        // Guard against move(dir) re-dispatching into the same handler at an edge.
        up:    function () { if (_navMoving) return; _navMoving = true; Lampa.Controller.move('up');    _navMoving = false; },
        down:  function () { if (_navMoving) return; _navMoving = true; Lampa.Controller.move('down');  _navMoving = false; },
        left:  function () { if (_navMoving) return; _navMoving = true; Lampa.Controller.move('left');  _navMoving = false; },
        right: function () { if (_navMoving) return; _navMoving = true; Lampa.Controller.move('right'); _navMoving = false; },
        back:  function () { Lampa.Activity.backward(); }
      });
      Lampa.Controller.toggle('cherry_main');
    };

    this.render  = function () { return html; };
    this.pause   = function () {};
    this.stop    = function () {};
    this.destroy = function () { destroyed = true; if (html) html.remove(); };

    // ---- source tiles -----------------------------------------------

    function renderSources() {
      var grid = html.find('.cherry-main__sources');

      // Favorites tile — always first.
      var favCard = Lampa.Template.get('cherry_source_card', {
        name:    Lampa.Lang.translate('cherry_favorites'),
        initial: '♥'
      });
      favCard.addClass('cherry-source--fav');
      favCard.on('hover:enter', function () {
        Lampa.Activity.push({
          component:    'cherry_grid',
          title:        Lampa.Lang.translate('cherry_favorites'),
          source_id:    SOURCES.length ? SOURCES[0].id : '',
          is_favorites: true,
          page:         1
        });
      });
      grid.append(favCard);

      // One tile per registered adapter.
      SOURCES.forEach(function (src) {
        var card = Lampa.Template.get('cherry_source_card', {
          name:    src.name,
          initial: src.name.charAt(0).toUpperCase()
        });
        card.on('hover:enter', function () {
          Lampa.Activity.push({
            component: 'cherry_grid',
            title:     src.name,
            source_id: src.id,
            page:      1
          });
        });
        grid.append(card);
      });
    }

    // ---- source rows (row mode) -------------------------------------

    /**
     * Row mode: one horizontal strip of popular cards per source.
     * Async — each source's browse('', 1) resolves independently.
     */
    function renderRows() {
      var container     = html.find('.cherry-main__sources');
      var resolvedCount = 0; // Counter gate: collectionSet fires once when the last source resolves.
      container.addClass('cherry-main__sources--rows');
      html.find('.cherry-main__search').hide();
      html.find('.cherry-main__sources-label').hide();

      if (!SOURCES.length) { Lampa.Controller.collectionSet(html); return; }

      SOURCES.forEach(function (src) {
        var rowEl = Lampa.Template.get('cherry_source_row', { name: src.name });

        // Row label → push the full grid for this source.
        rowEl.find('.cherry-source-row__label').on('hover:enter', function () {
          Lampa.Activity.push({
            component: 'cherry_grid',
            title:     src.name,
            source_id: src.id,
            page:      1
          });
        });

        container.append(rowEl);
        rowEl.find('.cherry-source-row__loading').show();

        // Promise.resolve wraps adapters that throw synchronously or return a
        // non-thenable (null) — such a source lands in .catch instead of aborting
        // the whole forEach, so the resolvedCount gate keeps progressing.
        Promise.resolve(src.browse('', 1)).then(function (result) {
          if (destroyed) return;
          rowEl.find('.cherry-source-row__loading').hide();
          if (result && result.items && result.items.length) {
            var cardsEl = rowEl.find('.cherry-source-row__cards');
            result.items.slice(0, 12).forEach(function (video) {
              video.source = src.id; // Required: 7-field Fav invariant — source field must be set.
              var card = Lampa.Template.get('cherry_card', {
                title:    video.title    || '',
                duration: video.duration ? secToTime(video.duration) : '',
                views:    formatViews(video.views)
              });
              if (video.thumb) card.find('.cherry-card__img').attr('src', video.thumb);
              // Row cards intentionally minimal: no fav badge, no preview, no long-press (v1 scope).
              card.on('hover:enter', function () {
                if (destroyed) return;
                playVideo(video, src);
              });
              cardsEl.append(card);
            });
          }
          // ONE collectionSet call, fired when the last source resolves (success or empty).
          resolvedCount++;
          if (resolvedCount === SOURCES.length) Lampa.Controller.collectionSet(html);
        }).catch(function (err) {
          if (destroyed) return;
          rowEl.find('.cherry-source-row__loading').hide();
          console.warn('[Cherry] rows browse error for ' + src.id + ':', err);
          // Count errors toward resolution so collectionSet is not permanently deferred.
          resolvedCount++;
          if (resolvedCount === SOURCES.length) Lampa.Controller.collectionSet(html);
        });
      });
    }

    // ---- search bar -------------------------------------------------

    function bindSearch() {
      var input = html.find('.cherry-main__search-input');
      var btn   = html.find('.cherry-main__search-btn');

      /**
       * Commit the current query and open a CherryGrid for all sources.
       */
      function doSearch() {
        var query = (input.val() || '').trim();
        if (!query) {
          Lampa.Noty.show(Lampa.Lang.translate('cherry_search_hint'), { style: 'warn' });
          return;
        }
        Lampa.Activity.push({
          component:   'cherry_grid',
          title:       Lampa.Lang.translate('cherry_search') + ': ' + query,
          source_id:   SOURCES.length ? SOURCES[0].id : '',
          query:       query,
          all_sources: true,
          page:        1
        });
      }

      // Search button (OK on remote when focused).
      btn.on('hover:enter', doSearch);

      // Input field focused via remote OK: open Lampa keyboard if available,
      // otherwise fall back to native focus + keydown handling.
      input.on('hover:enter', function () {
        if (typeof Lampa.Keyboard !== 'undefined' && Lampa.Keyboard.show) {
          Lampa.Keyboard.show({
            title:    Lampa.Lang.translate('cherry_search'),
            value:    input.val() || '',
            onchange: function (value) { input.val(value); },
            onenter:  function (value) {
              input.val(value);
              doSearch();
            }
          });
        } else {
          // Fallback: native browser input focus.
          var el = input[0];
          if (el) {
            el.focus();
            // Enter key commits the search.
            $(el).one('keydown', function (e) {
              if (e.key === 'Enter' || e.keyCode === 13) {
                doSearch();
              }
            });
          }
        }
      });
    }
  }

  // ============================================================
  // TEMPLATES
  // ============================================================
  function addTemplates() {

    Lampa.Template.add('cherry_main', [
      '<div class="cherry-main layer--wheight">',
        '<div class="cherry-main__head">',
          '<div class="cherry-main__logo">',
            '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">',
              '<path d="M12 21.593c-5.63-5.539-11-10.297-11-14.402 0-3.791 3.068-5.191',
              ' 5.281-5.191 1.312 0 4.151.501 5.719 4.457 1.59-3.968 4.464-4.447',
              ' 5.726-4.447 2.54 0 5.274 1.621 5.274 5.181 0 4.069-5.136',
              ' 8.625-11 14.402z"/>',
            '</svg>',
          '</div>',
          '<div class="cherry-main__title">Cherry</div>',
          '<div class="cherry-main__search">',
            '<input class="cherry-main__search-input selector" type="text" placeholder="#{cherry_search}&#8230;" autocomplete="off" />',
            '<div class="cherry-main__search-btn selector">#{cherry_search}</div>',
          '</div>',
        '</div>',
        '<div class="cherry-main__sources-label">#{cherry_sources}</div>',
        '<div class="cherry-main__sources"></div>',
      '</div>'
    ].join(''));

    Lampa.Template.add('cherry_source_card', [
      '<div class="cherry-source-card selector">',
        '<div class="cherry-source-card__initial">{initial}</div>',
        '<div class="cherry-source-card__name">{name}</div>',
      '</div>'
    ].join(''));

    Lampa.Template.add('cherry_grid', [
      '<div class="cherry-grid layer--wheight">',
        '<div class="cherry-grid__head">',
          '<div class="cherry-grid__title">{title}</div>',
        '</div>',
        '<div class="cherry-grid__body"></div>',
        '<div class="cherry-grid__loading">',
          '<div class="cherry-grid__loading-spinner"></div>',
          '<span>#{cherry_loading}</span>',
        '</div>',
        '<div class="cherry-grid__empty" style="display:none">',
          '<div class="cherry-grid__empty-icon">&#9785;</div>',
          '<div class="cherry-grid__empty-generic">#{cherry_no_results}</div>',
          '<div class="cherry-grid__empty-fav-hint" style="display:none">#{cherry_fav_empty_hint}</div>',
        '</div>',
      '</div>'
    ].join(''));

    Lampa.Template.add('cherry_card', [
      '<div class="cherry-card selector">',
        '<div class="cherry-card__thumb">',
          '<img class="cherry-card__img" src="" alt="" loading="lazy" />',
          '<video class="cherry-card__preview" muted playsinline loop></video>',
          '<div class="cherry-card__duration">{duration}</div>',
          '<div class="cherry-card__fav" style="display:none" aria-label="Favorite">&#9829;</div>',
          '<div class="cherry-card__model selector" style="display:none"></div>',
        '</div>',
        '<div class="cherry-card__info">',
          '<div class="cherry-card__title">{title}</div>',
          '<div class="cherry-card__views">{views}</div>',
        '</div>',
      '</div>'
    ].join(''));

    Lampa.Template.add('cherry_group_label', '<div class="cherry-group-label">{name}</div>');

    Lampa.Template.add('cherry_source_row', [
      '<div class="cherry-source-row">',
        '<div class="cherry-source-row__label selector">{name}</div>',
        '<div class="cherry-source-row__cards"></div>',
        '<div class="cherry-source-row__loading">#{cherry_loading}</div>',
      '</div>'
    ].join(''));
  }

  // ============================================================
  // CSS  — optimised for 1080p TV (1920×1080)
  // Base font-size on most Lampa skins ≈ 20px.
  // All em values are relative to that context.
  // ============================================================
  function addStyles() {
    var rules = [
      /* ---- Main screen ----------------------------------------- */
      '.cherry-main {',
      '  padding: 2.4em 3em;',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 2em;',
      '  min-height: 100%;',
      '  box-sizing: border-box;',
      '}',

      '.cherry-main__head {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 1.5em;',
      '}',

      '.cherry-main__logo {',
      '  color: #e75480;',
      '  flex-shrink: 0;',
      '  line-height: 0;',
      '}',

      '.cherry-main__title {',
      '  font-size: 2.2em;',
      '  font-weight: 700;',
      '  color: #e75480;',
      '  letter-spacing: .04em;',
      '  flex-shrink: 0;',
      '}',

      '.cherry-main__search {',
      '  display: flex;',
      '  gap: .6em;',
      '  flex: 1;',
      '  align-items: center;',
      '}',

      '.cherry-main__search-input {',
      '  flex: 1;',
      '  padding: .5em 1em;',
      '  border-radius: .5em;',
      '  border: 2px solid rgba(255,255,255,.15);',
      '  background: rgba(255,255,255,.07);',
      '  color: #fff;',
      '  font-size: 1.1em;',
      '  outline: none;',
      '  transition: border-color .15s;',
      '}',

      '.cherry-main__search-input.focus,',
      '.cherry-main__search-input:focus {',
      '  border-color: #e75480;',
      '}',

      '.cherry-main__search-btn {',
      '  padding: .5em 1.6em;',
      '  border-radius: .5em;',
      '  background: #e75480;',
      '  color: #fff;',
      '  font-weight: 700;',
      '  font-size: 1.05em;',
      '  cursor: pointer;',
      '  transition: background .15s, transform .1s;',
      '  white-space: nowrap;',
      '}',

      '.cherry-main__search-btn.focus {',
      '  background: #ff6b9d;',
      '  transform: scale(1.04);',
      '}',

      '.cherry-main__sources-label {',
      '  font-size: .9em;',
      '  text-transform: uppercase;',
      '  letter-spacing: .12em;',
      '  color: rgba(255,255,255,.4);',
      '  padding-bottom: .3em;',
      '  border-bottom: 1px solid rgba(255,255,255,.08);',
      '}',

      '.cherry-main__sources {',
      '  display: flex;',
      '  flex-wrap: wrap;',
      '  gap: 1.2em;',
      '}',

      /* ---- Source tile ----------------------------------------- */
      '.cherry-source-card {',
      '  width: 9em;',
      '  min-height: 6em;',
      '  display: flex;',
      '  flex-direction: column;',
      '  align-items: center;',
      '  justify-content: center;',
      '  border-radius: .7em;',
      '  background: rgba(255,255,255,.06);',
      '  border: 2px solid transparent;',
      '  padding: 1em .8em;',
      '  cursor: pointer;',
      '  transition: border-color .15s, background .15s, transform .1s;',
      '}',

      '.cherry-source-card.focus {',
      '  border-color: #e75480;',
      '  background: rgba(231,84,128,.12);',
      '  transform: scale(1.05);',
      '}',

      '.cherry-source-card__initial {',
      '  font-size: 2em;',
      '  font-weight: 700;',
      '  color: #e75480;',
      '  line-height: 1;',
      '}',

      '.cherry-source-card__name {',
      '  font-size: .8em;',
      '  text-align: center;',
      '  color: rgba(255,255,255,.7);',
      '  margin-top: .4em;',
      '  word-break: break-word;',
      '}',

      '.cherry-source--fav .cherry-source-card__initial {',
      '  color: #ff6b9d;',
      '}',

      /* ---- Grid screen ----------------------------------------- */
      '.cherry-grid {',
      '  padding: 1.6em 2.5em;',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 1.2em;',
      '  min-height: 100%;',
      '  box-sizing: border-box;',
      '}',

      '.cherry-grid__head {',
      '  flex-shrink: 0;',
      '}',

      '.cherry-grid__title {',
      '  font-size: 1.6em;',
      '  font-weight: 700;',
      '  color: #fff;',
      '}',

      '.cherry-grid__body {',
      '  flex: 1;',
      '}',

      /* Loading spinner */
      '.cherry-grid__loading {',
      '  display: none;',        /* toggled by JS */
      '  align-items: center;',
      '  justify-content: center;',
      '  gap: .8em;',
      '  padding: 3em;',
      '  color: rgba(255,255,255,.5);',
      '  font-size: 1em;',
      '}',

      '.cherry-grid__loading[style*="block"] {',
      '  display: flex !important;',
      '}',

      '@keyframes cherry-spin {',
      '  to { transform: rotate(360deg); }',
      '}',

      '.cherry-grid__loading-spinner {',
      '  width: 2em;',
      '  height: 2em;',
      '  border: .22em solid rgba(255,255,255,.15);',
      '  border-top-color: #e75480;',
      '  border-radius: 50%;',
      '  animation: cherry-spin .8s linear infinite;',
      '  flex-shrink: 0;',
      '}',

      /* Empty state */
      '.cherry-grid__empty {',
      '  flex: 1;',
      '  display: flex;',
      '  flex-direction: column;',
      '  align-items: center;',
      '  justify-content: center;',
      '  gap: .6em;',
      '  color: rgba(255,255,255,.35);',
      '  font-size: 1.1em;',
      '}',

      '.cherry-grid__empty-icon {',
      '  font-size: 3em;',
      '  line-height: 1;',
      '}',

      '.cherry-grid__empty-fav-hint {',
      '  font-size: .9em;',
      '  opacity: .75;',
      '  text-align: center;',
      '  max-width: 24em;',
      '  line-height: 1.5;',
      '  margin: 0 auto;',
      '}',

      /* ---- Video card ------------------------------------------ */
      /*
       * Target 4 cards per row on 1920px with sidebar ~260px ≈ 1660px wide.
       * (1660 - 4*16gap) / 4 ≈ 403px. At 20px base that is ~20.15em.
       * We use 19.5em so cards breathe a little.
       */
      /* Grid wrapper — fills scroll body, auto-flow responsive columns */
      '.cherry-cards-wrap {',
      '  display: grid;',
      '  grid-template-columns: repeat(auto-fill, minmax(13em, 1fr));',
      '  gap: .9em;',
      '  padding: .4em 0;',
      '  width: 100%;',
      '  box-sizing: border-box;',
      '}',

      '.cherry-card {',
      '  width: 100%;',
      '  border-radius: .6em;',
      '  overflow: hidden;',
      '  background: rgba(255,255,255,.05);',
      '  border: 2px solid transparent;',
      '  cursor: pointer;',
      '  transition: border-color .15s, transform .12s, box-shadow .15s;',
      '}',

      '.cherry-card.focus {',
      '  border-color: #e75480;',
      '  transform: scale(1.04);',
      '  box-shadow: 0 .4em 2em rgba(231,84,128,.35);',
      '  z-index: 2;',
      '  position: relative;',
      '}',

      /* Thumbnail area — 16:9 */
      '.cherry-card__thumb {',
      '  position: relative;',
      '  width: 100%;',
      '  padding-top: 56.25%;',  /* 9/16 */
      '  background: #111;',
      '  overflow: hidden;',
      '}',

      '.cherry-card__img {',
      '  position: absolute;',
      '  inset: 0;',
      '  width: 100%;',
      '  height: 100%;',
      '  object-fit: cover;',
      '  display: block;',
      '}',

      /* Duration badge */
      '.cherry-card__duration {',
      '  position: absolute;',
      '  bottom: .35em;',
      '  right: .45em;',
      '  background: rgba(0,0,0,.75);',
      '  color: #fff;',
      '  font-size: .72em;',
      '  padding: .12em .4em;',
      '  border-radius: .25em;',
      '  font-weight: 600;',
      '  pointer-events: none;',
      '}',

      /* Favourite heart badge */
      '.cherry-card__fav {',
      '  position: absolute;',
      '  top: .35em;',
      '  right: .45em;',
      '  color: #e75480;',
      '  font-size: 1.2em;',
      '  text-shadow: 0 1px 4px rgba(0,0,0,.6);',
      '  pointer-events: none;',
      '}',

      /* Info row */
      '.cherry-card__info {',
      '  padding: .55em .7em .65em;',
      '}',

      '.cherry-card__title {',
      '  font-size: .88em;',
      '  color: rgba(255,255,255,.92);',
      '  overflow: hidden;',
      '  display: -webkit-box;',
      '  -webkit-line-clamp: 2;',
      '  -webkit-box-orient: vertical;',
      '  line-height: 1.35;',
      '  word-break: break-word;',
      '}',

      '.cherry-card__views {',
      '  font-size: .75em;',
      '  color: rgba(255,255,255,.4);',
      '  margin-top: .25em;',
      '}',

      /* REQ-2: Preview video overlay */
      '.cherry-card__preview {',
      '  position: absolute;',
      '  top: 0; left: 0;',
      '  width: 100%; height: 100%;',
      '  object-fit: cover;',
      '  display: none;',
      '}',

      /* REQ-3: Model/performer badge */
      '.cherry-card__model {',
      '  display: none;',
      '  position: absolute;',
      '  bottom: .35em;',
      '  left: .45em;',
      '  background: rgba(0,0,0,.75);',
      '  color: #fff;',
      '  font-size: .68em;',
      '  padding: .1em .35em;',
      '  border-radius: .25em;',
      '  max-width: 8em;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '  white-space: nowrap;',
      '  cursor: pointer;',
      '}',
      '.cherry-card__model.focus {',
      '  outline: 1px solid #e75480;',
      '}',

      '.cherry-group-label {',
      '  grid-column: 1 / -1;',
      '  font-size: .8em;',
      '  text-transform: uppercase;',
      '  letter-spacing: .1em;',
      '  color: rgba(255,255,255,.4);',
      '  padding: .8em 0 .3em;',
      '  border-bottom: 1px solid rgba(255,255,255,.08);',
      '  margin-bottom: .3em;',
      '}',
      '.cherry-scroll-sentinel {',
      '  width: 100%;',
      '  height: 1px;',
      '  grid-column: 1 / -1;',
      '  pointer-events: none;',
      '}',
      /* ---- Row mode (UX-A) ------------------------------------- */
      '.cherry-main__sources--rows {',
      '  flex-direction: column;',
      '  gap: 2em;',
      '}',
      '.cherry-source-row {',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: .6em;',
      '}',
      '.cherry-source-row__label {',
      '  font-size: .85em;',
      '  font-weight: 600;',
      '  text-transform: uppercase;',
      '  letter-spacing: .1em;',
      '  color: rgba(255,255,255,.5);',
      '  cursor: pointer;',
      '  border: 1px solid transparent;',
      '  border-radius: .3em;',
      '  padding: .2em .4em;',
      '  align-self: flex-start;',
      '}',
      '.cherry-source-row__label.focus {',
      '  border-color: #e75480;',
      '  color: #fff;',
      '}',
      // overflow-x:scroll (not hidden) makes the strip scrollable so D-pad focus on
      // out-of-view cards causes the browser to auto-scroll the element into view.
      '.cherry-source-row__cards {',
      '  display: flex;',
      '  gap: .7em;',
      '  overflow-x: scroll;',
      '  scrollbar-width: none;',
      '  -ms-overflow-style: none;',
      '  padding: .3em 0;',
      '}',
      '.cherry-source-row__cards::-webkit-scrollbar { display: none; }',
      '.cherry-source-row__cards .cherry-card {',
      '  width: 12em;',
      '  flex-shrink: 0;',
      '}',
      '.cherry-source-row__loading {',
      '  display: none;',
      '  font-size: .8em;',
      '  color: rgba(255,255,255,.4);',
      '  padding: .4em 0;',
      '}',
    ];

    var style = document.createElement('style');
    style.id  = 'cherry-plugin-styles';
    style.textContent = rules.join('\n');
    document.head.appendChild(style);
  }

  // ============================================================
  // LANG
  // ============================================================
  function addLang() {
    Lampa.Lang.add({
      cherry_search:      { ru: 'Поиск',               en: 'Search'             },
      cherry_search_hint: { ru: 'Введите запрос',      en: 'Enter a query'      },
      cherry_sources:     { ru: 'Источники',           en: 'Sources'            },
      cherry_favorites:   { ru: 'Избранное',           en: 'Favorites'          },
      cherry_no_results:  { ru: 'Нет результатов',     en: 'No results'         },
      cherry_fav_empty_hint: { ru: 'Удерживайте ОК на видео чтобы добавить в избранное', en: 'Hold OK on a video to add it to favorites' },
      cherry_loading:     { ru: 'Загрузка…',           en: 'Loading…'           },
      cherry_error:       { ru: 'Ошибка загрузки',     en: 'Load error'         },
      cherry_add_fav:        { ru: 'Добавлено в избранное',  en: 'Added to favorites'    },
      cherry_rem_fav:        { ru: 'Убрано из избранного',   en: 'Removed from favorites' },
      cherry_add_fav_action: { ru: 'Добавить в избранное',   en: 'Add to favorites'       },
      cherry_rem_fav_action: { ru: 'Убрать из избранного',   en: 'Remove from favorites'  },
      cherry_quality:     { ru: 'Выбор качества',      en: 'Select quality'     },
      cherry_similar:          { ru: 'Похожие видео',       en: 'Similar videos'     },
      cherry_sort:             { ru: 'Сортировка',          en: 'Sort'               },
      cherry_sort_default:     { ru: 'По умолчанию',        en: 'Default'            },
      cherry_category:         { ru: 'Категория',           en: 'Category'           },
      cherry_category_default: { ru: 'Все категории',       en: 'All categories'     },
      cherry_model_videos:     { ru: 'Видео модели',        en: 'Model videos'       },
      cherry_preview_setting:  { ru: 'Предпросмотр',        en: 'Preview'            },
      cherry_related:          { ru: 'Похожее',             en: 'Related'            },
      cherry_view_rows:        { ru: 'Вид: Ряды',           en: 'View: Rows'         },
      cherry_view_tiles:       { ru: 'Вид: Тайлы',          en: 'View: Tiles'        },
      cherry_proxy_key_init:   { ru: 'Cherry: ключ прокси — 1206. Для смены — измените cherry_proxy_key в хранилище Lampa.', en: 'Cherry: proxy key — 1206. To change, update cherry_proxy_key in Lampa Storage.' }
    });
  }

  // ============================================================
  // INIT
  // ============================================================
  function startPlugin() {
    // First run: if key was never explicitly saved, store the default and notify user.
    if (Lampa.Storage.get('cherry_proxy_key', null) === null) {
      Lampa.Storage.set('cherry_proxy_key', '1206');
      setTimeout(function () {
        Lampa.Noty.show(Lampa.Lang.translate('cherry_proxy_key_init'), { time: 7000 });
      }, 1500);
    }

    addLang();
    addTemplates();
    addStyles();

    // UX-C: register preview toggle in Lampa settings. Long-press on the main
    // title remains as a fallback when SettingsApi is unavailable.
    if (Lampa.SettingsApi && Lampa.SettingsApi.addComponent && Lampa.SettingsApi.addParam) {
      Lampa.SettingsApi.addComponent({
        component: 'cherry',
        name: 'Cherry',
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 21s-7-4.35-9.5-8.5C0.5 9 2 5 5.5 5c2 0 3.5 1.5 4 2.5C10 6.5 11.5 5 13.5 5 17 5 18.5 9 16.5 12.5 14 16.65 12 21 12 21z" fill="#e75480"/></svg>'
      });
      Lampa.SettingsApi.addParam({
        component: 'cherry',
        param: { name: 'cherry_preview_enabled', type: 'trigger', default: true },
        field: { name: Lampa.Lang.translate('cherry_preview_setting'), description: '' }
        // 'trigger' params auto-persist to Lampa.Storage under param.name (== our storage key),
        // so no onChange handler is needed — read path Lampa.Storage.get('cherry_preview_enabled') works.
      });
    } else if (Lampa.SettingsApi) {
      console.warn('[Cherry] SettingsApi present but addComponent/addParam unavailable — using long-press fallback');
    }

    Lampa.Component.add('cherry_main', CherryMain);
    Lampa.Component.add('cherry_grid', CherryGrid);

    var cherryIcon = [
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">',
        '<path d="M12 21.593c-5.63-5.539-11-10.297-11-14.402 0-3.791 3.068-5.191 5.281-5.191',
        ' 1.312 0 4.151.501 5.719 4.457 1.59-3.968 4.464-4.447 5.726-4.447 2.54 0 5.274 1.621',
        ' 5.274 5.181 0 4.069-5.136 8.625-11 14.402z"/>',
      '</svg>'
    ].join('');

    Lampa.Menu.addButton(
      cherryIcon,
      'Cherry',
      function () {
        Lampa.Activity.push({
          component: 'cherry_main',
          title:     'Cherry',
          page:      1
        });
      }
    );

    // Revoke HLS blob URLs on player close; push related panel if available (REQ-4).
    Lampa.Listener.follow('player', function (e) {
      if (e.type === 'destroy') {
        if (_blobUrls.length) {
          _blobUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (_) {} });
          _blobUrls = [];
        }
        // REQ-4: invalidate any in-flight getRelated then push related grid if ready.
        _relatedGeneration++;
        if (_pendingRelated.length) {
          var items = _pendingRelated;
          var rSrc  = _relatedSrc;
          _pendingRelated = [];
          _relatedSrc     = null;
          Lampa.Activity.push({
            component:      'cherry_grid',
            title:          Lampa.Lang.translate('cherry_related'),
            source_id:      rSrc ? rSrc.id : '',
            _related_items: items,
            page:           1
          });
        }
      }
    });
  }

  // Handle both early-load (before app:ready) and late-load cases.
  if (window.appready) {
    startPlugin();
  } else {
    Lampa.Listener.follow('app', function (e) {
      if (e.type === 'ready') startPlugin();
    });
  }

  // ============================================================
  // SOURCE ADAPTERS
  // ============================================================

// ============================================================
// CHERRY — SOURCE ADAPTERS TIER 1
// Eporner, Pornhub, Xvideos, Xnxx, Spankbang,
// Hqporner, Youjizz, Tizam, Ebalovo, HellPorno, NoodleMagazine
// ============================================================

// ---- Shared helpers ----

function parseDur(str) {
  if (!str) return 0;
  str = ('' + str).trim();
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  var mms = str.match(/(\d+)m\s*(\d+)s/i);
  if (mms) return parseInt(mms[1], 10) * 60 + parseInt(mms[2], 10);
  var mm = str.match(/(\d+)m/i);
  if (mm) return parseInt(mm[1], 10) * 60;
  var p = str.split(':').map(Number);
  if (p.length === 2) return p[0] * 60 + p[1];
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  return 0;
}

function parseViews(str) {
  if (!str) return 0;
  str = ('' + str).replace(/[,\s]/g, '');
  if (/k$/i.test(str)) return parseInt(str) * 1000;
  if (/m$/i.test(str)) return parseInt(str) * 1000000;
  return parseInt(str, 10) || 0;
}

function extractStreams(html) {
  var quality = {};
  var url = '';
  var m;
  // KVS get_file pattern
  var kvs = html.match(/https?:\/\/[^"'\s]+get_file[^"'\s]+\.mp4[^"'\s]*/g);
  if (kvs) kvs.forEach(function(u) { var q = (u.match(/(\d{3,4}p)/i) || ['', 'mp4'])[1]; quality[q] = u; });
  // Source tags with res/label/title attribute (both orders)
  var srcRe = /<source\s[^>]*src="([^"]+)"[^>]*(?:res|label|title)="([^"]+)"/gi;
  while ((m = srcRe.exec(html)) !== null) quality[m[2]] = m[1];
  var srcRe2 = /<source\s[^>]*(?:res|label|title)="([^"]+)"[^>]*src="([^"]+)"/gi;
  while ((m = srcRe2.exec(html)) !== null) quality[m[1]] = m[2];
  // JWPlayer sources:[...] array multi-quality branch
  function findMatchingBracket(str, openIdx, openCh, closeCh) {
    var depth = 0, inStr = false, strCh = '';
    for (var i = openIdx; i < str.length; i++) {
      var c = str[i];
      if (inStr) {
        if (c === strCh) {
          var bs = 0;
          for (var j = i - 1; j >= 0 && str[j] === '\\'; j--) bs++;
          if (bs % 2 === 0) inStr = false;
        }
        continue;
      }
      if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
      // Track depth for both bracket types — handles mixed [{...}, {...}] nesting
      if (c === '{' || c === '[') { depth++; continue; }
      if (c === closeCh || c === '}' || c === ']') {
        if (--depth === 0) return i;
      }
    }
    return -1;
  }
  var srcArrayM = /sources\s*:\s*\[/i.exec(html);
  if (srcArrayM) {
    var arrOpen = html.indexOf('[', srcArrayM.index + srcArrayM[0].length - 1);
    if (arrOpen !== -1) {
      var arrClose = findMatchingBracket(html, arrOpen, '[', ']');
      if (arrClose !== -1) {
        var block = html.slice(arrOpen + 1, arrClose);
        var fileRe2  = /['"]file['"]\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))['"]/i;
        var labelRe2 = /['"]label['"]\s*:\s*['"]([^'"]+)['"]/i;
        var bi = 0;
        while (bi < block.length) {
          var objStart = block.indexOf('{', bi);
          if (objStart === -1) break;
          var objEnd = findMatchingBracket(block, objStart, '{', '}');
          if (objEnd === -1) break;
          var obj = block.slice(objStart, objEnd + 1);
          var fm2 = fileRe2.exec(obj);
          var lm2 = labelRe2.exec(obj);
          if (fm2 && lm2 && !quality[lm2[1]]) quality[lm2[1]] = fm2[1];
          bi = objEnd + 1;
        }
      }
    }
  }
  // JWPlayer / generic file
  var jwRe = /['"]file['"]\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))['"]/g;
  while ((m = jwRe.exec(html)) !== null) { if (!url) url = m[1]; }
  // Plain source tags
  var plainRe = /<source\s[^>]*src="([^"]+\.(?:mp4|m3u8)[^"']*)"/gi;
  while ((m = plainRe.exec(html)) !== null) { if (!url) url = m[1]; }
  // Fallback: find any mp4 URL (http/https or protocol-relative)
  if (!url && !Object.keys(quality).length) {
    var any = html.match(/(?:https?:)?\/\/[^"'\s]+\.mp4[^"'\s]*/);
    if (any) url = any[0];
  }
  if (!url && Object.keys(quality).length) url = quality[Object.keys(quality)[0]];
  // Normalize protocol-relative URLs to https://
  function fixProto(u) { return (u && u.slice(0, 2) === '//') ? 'https:' + u : u; }
  url = fixProto(url);
  Object.keys(quality).forEach(function(k) { quality[k] = fixProto(quality[k]); });
  return { url: url, quality: quality };
}

// Strip HTML tags from a string
function stripTags(str) {
  return (str || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
}

// ============================================================
// CHERRY — SOURCE ADAPTERS TIER 2
// Porntrex, Xozilla, 3Movs, Analdin, PornVe, FamilyPorn,
// Porndig, CrocoTube, Huyamba, VePorn, Ebun, LenPorno,
// 24Rolika, JopaOnline, PornOne, Pornobolt, PerfektDamen, GayPornTube
// ============================================================

// ---------------------------------------------------------------------------
// Shared card parser utilities
// ---------------------------------------------------------------------------

/**
 * Extract text content from an HTML attribute or tag region.
 * @param {string} html
 * @param {RegExp} rx
 * @param {number} [group=1]
 * @returns {string}
 */
function _attr(html, rx, group) {
    var m = rx.exec(html);
    return m ? (m[group != null ? group : 1] || '').trim() : '';
}

/**
 * Decode common HTML entities found in title strings.
 * @param {string} str
 * @returns {string}
 */
function _decodeHtml(str) {
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .trim();
}

/**
 * Split an HTML string into per-card chunks.
 * @param {string} html
 * @param {RegExp} splitRx  — pattern that marks the start of each card block
 * @returns {string[]}
 */
function _splitCards(html, splitRx) {
    var parts = html.split(splitRx);
    parts.shift(); // first element is content before first match
    return parts;
}

/**
 * Pick the highest MP4 quality label from a set of KVS stream URLs.
 * Labels found in filename portion: _480p, _720p, _1080p, _2160p.
 * @param {string[]} urls
 * @returns {{url: string, quality: Object}}
 */
function _kvsPickBest(urls) {
    var order = ['2160p', '1080p', '720p', '480p', '360p', '240p'];
    var quality = {};
    var best = '';
    var bestIdx = order.length;

    urls.forEach(function (u) {
        var labelMatch = /[_-](\d+p)\./i.exec(u);
        var label = labelMatch ? labelMatch[1].toLowerCase() : 'default';
        quality[label] = u;
        var idx = order.indexOf(label);
        if (idx === -1) idx = order.length - 1;
        if (idx < bestIdx) {
            bestIdx = idx;
            best = u;
        }
    });

    if (!best && urls.length) best = urls[0];
    return { url: best, quality: quality };
}

// ---- Pornhub ----
SOURCES.push({
  id: 'pornhub',
  name: 'Pornhub',
  host: 'pornhub.com',

  _mapVideo: function(v) {
    var thumb = '';
    if (v.thumbs && v.thumbs.length) thumb = v.thumbs[v.thumbs.length - 1].src || v.thumbs[0].src || '';
    // Extract video ID from URL for stable id
    var idMatch = (v.url || '').match(/viewkey=([a-z0-9]+)/i);
    var id = idMatch ? idMatch[1] : (v.video_id ? String(v.video_id) : String(Math.random()));
    return {
      id: id,
      source: 'pornhub',
      title: v.title || '',
      thumb: thumb,
      url: v.url ? (v.url.indexOf('http') === 0 ? v.url : 'https://www.pornhub.com' + v.url) : '',
      duration: parseDur(v.duration),
      views: parseViews(String(v.views || 0))
    };
  },

  cfg: {
    sorts: [
      { id: 'mv',   label: 'Популярное'  },
      { id: 'tr',   label: 'Трендовое'   },
      { id: 'mr',   label: 'Свежее'      }
    ],
    // Pornhub categories are numeric ids passed to the webmasters API (&category=).
    categories: _cats('1:Азиатки,3:Любительское,4:Большая жопа,5:Красотки,6:BBW,7:Анал,8:Большой член,9:Большие сиськи,11:Блондинки,13:Минет,14:Бондаж,15:Брюнетки,17:Кремпай,18:Камшот,19:Чёрные,20:Фетиш,21:Волосатые,22:Дрочка,23:Жёсткое,24:Латинки,25:Лесбиянки,26:Зрелые,27:MILF,28:Порнозвёзды,29:От первого лица,30:На публике,31:Рыжие,35:Маленькие сиськи,36:Сквирт,38:Молодые 18+,39:Втроём,40:Игрушки,41:Межрасовое,72:Групповуха,73:Японское,75:Русское,84:Вебкам')
  },

  search: function(query, page, sort) {
    var self = this;
    var p = page || 1;
    var ordering = (sort && sort !== 'mv') ? sort : 'mostviewed';
    var url = 'https://www.pornhub.com/webmasters/search?search=' + encodeURIComponent(query) +
      '&page=' + p + '&ordering=' + ordering + '&thumbsize=medium_hd';
    return cherryFetch(url).then(function(text) {
      var data = JSON.parse(text);
      var videos = data.videos || (data.data && data.data.videos) || [];
      var items = videos.map(function(v) { return self._mapVideo(v); });
      return { items: items, total_pages: parseInt(data.total_pages || data.pagesTotal || 1, 10) };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  browse: function(category, page, sort) {
    var self = this;
    var p = page || 1;
    var ordering = (sort && sort !== 'mv') ? sort : 'mostviewed';
    var url = 'https://www.pornhub.com/webmasters/search?search=&page=' + p +
      '&ordering=' + ordering + '&thumbsize=medium_hd' +
      (category ? '&category=' + encodeURIComponent(category) : '');
    return cherryFetch(url).then(function(text) {
      var data = JSON.parse(text);
      var videos = data.videos || (data.data && data.data.videos) || [];
      var items = videos.map(function(v) { return self._mapVideo(v); });
      return { items: items, total_pages: parseInt(data.total_pages || data.pagesTotal || 1, 10) };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  _parseHtmlCards: function(html) {
    var items = [];
    var seen = {};
    var hrefRx = /href="(\/view_video\.php\?viewkey=([a-z0-9]+)[^"]*)"/g;
    var m;
    while ((m = hrefRx.exec(html)) !== null) {
      var href = m[1];
      var vkey = m[2];
      if (!vkey || seen[vkey]) continue;
      seen[vkey] = true;
      var videoUrl = 'https://www.pornhub.com' + href;
      var chunk = html.slice(Math.max(0, m.index - 200), m.index + 800);
      var thumb = _attr(chunk, /data-mediumthumb="([^"]+)"/) ||
                  _attr(chunk, /data-thumb_url="([^"]+)"/) || '';
      var preview = _attr(chunk, /data-mediabook="([^"]+)"/);
      var title = _decodeHtml(
        _attr(chunk, /class="[^"]*videoTitle[^"]*"[^>]*>([^<]+)/) ||
        _attr(chunk, /title="([^"]+)"/)
      );
      var duration = parseDur(_attr(chunk, /<var class="duration">([^<]+)</));
      var views    = parseViews(_attr(chunk, /class="[^"]*videoViewCount[^"]*"[^>]*>([^<]+)</));
      if (title || thumb) {
        items.push({ id: vkey, source: 'pornhub', title: title, thumb: thumb,
                     preview: preview, url: videoUrl, duration: duration, views: views });
      }
    }
    return items;
  },

  browseByModel: function(modelUrl, page) {
    var self = this;
    var p = page || 1;
    var url = modelUrl.replace(/\/$/, '') + '/videos?page=' + p;
    return cherryFetch(url).then(function(html) {
      var items = self._parseHtmlCards(html);
      var totalMatch = html.match(/paginationCount[^>]*>[^<]*<strong>([^<]+)<\/strong>/);
      var total = totalMatch
        ? Math.ceil(parseInt((totalMatch[1] || '0').replace(/[^0-9]/g, ''), 10) / 30)
        : (p + 5);
      return { items: items, total_pages: total || 1 };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  getRelated: function(video) {
    var self = this;
    return cherryFetch(video.url).then(function(html) {
      // Try to find relatedVideosJSON block first
      var jsonMatch = html.match(/var\s+relatedVideosJSON\s*=\s*(\[[\s\S]+?\]);\s*\n/);
      if (jsonMatch) {
        var arr;
        try { arr = JSON.parse(jsonMatch[1]); } catch(e) { arr = []; }
        var items = arr.map(function(v) { return self._mapVideo(v); }).filter(function(v) { return v.id; });
        if (items.length) return items;
      }
      // Fallback: parse HTML card links from the page (reuse _parseHtmlCards)
      return self._parseHtmlCards(html).slice(0, 20);
    }).catch(function() { return []; });
  },

  getStream: function(video) {
    var pageUrl = video.url;
    if (!pageUrl) return Promise.resolve({ url: '', quality: {} });

    return cherryFetch(pageUrl).then(function(html) {
      var fvMatch = html.match(/var\s+flashvars_\d+\s*=\s*(\{[\s\S]+?\});\s*\n/);
      if (!fvMatch) return { url: '', quality: {} };

      var flashvars;
      try { flashvars = JSON.parse(fvMatch[1]); } catch (e) { return { url: '', quality: {} }; }

      var defs = flashvars.mediaDefinitions || [];
      var hlsUrls = {};
      var mp4Urls = {};

      defs.forEach(function(def) {
        var qNum = parseInt(def.quality, 10) || 0;
        if (!qNum) return;
        var vUrl = (def.videoUrl || '').replace(/\\\//g, '/').replace(/\/\/\//g, '//');
        if (!vUrl) return;
        var label = def.quality + 'p';
        if (def.format === 'hls')      hlsUrls[label] = vUrl;
        else if (def.format === 'mp4') mp4Urls[label] = vUrl;
      });

      if (Object.keys(mp4Urls).length) {
        return { url: bestQualityUrl(mp4Urls), quality: mp4Urls };
      }

      if (Object.keys(hlsUrls).length) {
        var quality = {};
        Object.keys(hlsUrls).forEach(function(lbl) {
          // Android: hand raw HLS m3u8 to the native player — it fetches the
          // playlist + phncdn segments from the home IP, keeping ipa-bound
          // tokens valid without a proxy. Browser: proxy (CORS + IP affinity).
          quality[lbl] = _isAndroid() ? hlsUrls[lbl] : buildProxyUrl(hlsUrls[lbl], 'https://www.pornhub.com/');
        });
        return { url: bestQualityUrl(quality), quality: quality };
      }

      return { url: '', quality: {} };
    }).catch(function() { return { url: '', quality: {} }; });
  }
});

// ---- Xvideos ----
SOURCES.push({
  id: 'xvideos',
  name: 'Xvideos',
  host: 'xvideos2.com',

  _parseCards: function(html, page) {
    var items = [];
    // Split on thumb-block divs (handles double-space and modifier classes)
    var blocks = html.split(/<div[^>]+class="[^"]*thumb-block[^"]*"/);
    // Skip first element (it's content before the first block)
    for (var i = 1; i < blocks.length; i++) {
      var block = blocks[i];
      // New URL format: /video.TOKEN/slug  (TOKEN is alphanumeric, replaces old /video{numId}/)
      var hrefMatch = block.match(/href="(\/video\.([a-z0-9]+)\/[^"]+)"/);
      if (!hrefMatch) continue;
      var href = hrefMatch[1];
      var numId = hrefMatch[2];
      var videoUrl = 'https://www.xvideos2.com' + href;

      var thumbMatch = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+\.jpg[^"]*)"/);
      var thumb = thumbMatch ? thumbMatch[1] : '';
      var preview = thumb ? thumb.replace(/\/[^\/]+$/, '/preview.mp4') : '';

      var titleMatch = block.match(/<p[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)/) ||
                       block.match(/title="([^"]+)"/);
      var title = titleMatch ? stripTags(titleMatch[1]) : '';

      var durMatch = block.match(/<span[^>]*class="[^"]*duration[^"]*"[^>]*>([^<]+)/);
      var duration = durMatch ? parseDur(durMatch[1].trim()) : 0;

      if (!numId && href) {
        var idFromHref = href.match(/video(\d+)\//);
        numId = idFromHref ? idFromHref[1] : String(i);
      }

      items.push({
        id: 'xv' + numId,
        source: 'xvideos',
        title: title,
        thumb: thumb,
        preview: preview,
        url: videoUrl,
        duration: duration,
        views: 0
      });
    }
    return items;
  },

  cfg: {
    sorts: [
      { id: 'new',   label: 'Свежее'           },
      { id: 'views', label: 'По просмотрам'    }
    ],
    categories: _cats('Anal-12:Анал,Teen-13:Молодые,Ass-14:Жопа,Blowjob-15:Минет,Latina-16:Латинки,Cumshot-18:Камшот,Milf-19:MILF,Blonde-20:Блондинки,Big_Tits-23:Большие сиськи,Big_Ass-24:Большая жопа,Brunette-25:Брюнетки,Lesbian-26:Лесбиянки,Interracial-27:Межрасовое,Stockings-28:Чулки,Redhead-31:Рыжие,Asian_Woman-32:Азиатки,Big_Cock-34:Большой член,Mature-38:Зрелые,Creampie-40:Кремпай,bbw-51:BBW,Squirting-56:Сквирт,Amateur-65:Любительское,Gangbang-69:Групповуха,Indian-89:Индийское,Arab-159:Арабское')
  },

  search: function(query, page, sort) {
    var self = this;
    var p = page || 1;
    // Xvideos p is 0-indexed
    var url = 'https://www.xvideos2.com/?k=' + encodeURIComponent(query) + '&p=' + (p - 1);
    return cherryFetch(url).then(function(html) {
      var items = self._parseCards(html, p);
      return { items: items, total_pages: p + 10 };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  browse: function(category, page, sort) {
    var self = this;
    var p = page || 1;
    var pageIdx = p - 1;
    var url;
    if (category) {
      // /c/{Label-id}/{page} — page is 0-based, omitted on page 1
      url = _buildCatUrl('https://www.xvideos.com/c/{slug}/{page}', category, p, 0, true);
    } else {
      // sort='views': use /best/ prefix; sort='new' or default: /new/
      var base = (sort === 'views') ? 'https://www.xvideos2.com/best/' : 'https://www.xvideos2.com/';
      url = pageIdx === 0 ? base : base + pageIdx;
    }
    return cherryFetch(url).then(function(html) {
      var items = self._parseCards(html, p);
      return { items: items, total_pages: p + 10 };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  browseByModel: function(modelUrl, page) {
    var self = this;
    var p = page || 1;
    var pageIdx = p - 1;
    var baseUrl = modelUrl.replace(/\/$/, '');
    // xvideos model pages: baseUrl for page 1, baseUrl/{pageIdx} for subsequent
    var url = pageIdx === 0 ? baseUrl : baseUrl + '/' + pageIdx;
    return cherryFetch(url).then(function(html) {
      var items = self._parseCards(html, p);
      return { items: items, total_pages: p + 5 };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  getRelated: function(video) {
    var self = this;
    return cherryFetch(video.url).then(function(html) {
      // xvideos video pages include a related videos section with thumb-block cards
      return self._parseCards(html, 1).slice(0, 20);
    }).catch(function() { return []; });
  },

  getStream: function(video) {
    return cherryFetch(video.url).then(function(html) {
      var hlsMatch = html.match(/(?:html5player\.)?setVideoHLS\s*\(\s*['"]([^'"]+)['"]\)/);
      var highMatch = html.match(/(?:html5player\.)?setVideoUrlHigh\s*\(\s*['"]([^'"]+)['"]\)/);
      var lowMatch = html.match(/(?:html5player\.)?setVideoUrlLow\s*\(\s*['"]([^'"]+)['"]\)/);

      var hlsUrl = hlsMatch ? hlsMatch[1] : '';
      var highUrl = highMatch ? highMatch[1] : '';
      var lowUrl = lowMatch ? lowMatch[1] : '';

      var quality = {};
      // HLS carries 720p/1080p variants; prefer it over single-bitrate SD MP4
      if (hlsUrl) quality['HLS'] = hlsUrl;
      if (highUrl) quality['High'] = highUrl;
      if (lowUrl && lowUrl !== highUrl) quality['Low'] = lowUrl;

      var url = hlsUrl || highUrl || lowUrl;
      return url ? { url: url, quality: quality } : { url: '', quality: {} };
    }).catch(function() { return { url: '', quality: {} }; });
  }
});

// ---- Xnxx ----
SOURCES.push({
  id: 'xnxx',
  name: 'Xnxx',
  host: 'xnxx.com',

  _parseCards: function(html) {
    var items = [];
    // Narrow to the mozaique container
    var mozParts = html.split('<div class="mozaique"');
    var content = mozParts.length > 1 ? mozParts[mozParts.length - 1] : html;

    var blocks = content.split(/<div[^>]+class="[^"]*thumb-under[^"]*"/);
    for (var i = 1; i < blocks.length; i++) {
      var block = blocks[i];
      var hrefMatch = block.match(/href="(\/video-?([^/]+)\/[^"]+)"/);
      if (!hrefMatch) {
        hrefMatch = block.match(/href="(\/video([a-z0-9]+)[^"]*)"/) ;
      }
      if (!hrefMatch) continue;

      var href = hrefMatch[1];
      var rawId = hrefMatch[2] || '';
      var videoUrl = 'https://www.xnxx.com' + href;

      var thumbMatch = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+\.jpg[^"]*)"/);
      var thumb = thumbMatch ? thumbMatch[1] : '';
      var preview = thumb ? thumb.replace(/\/[^\/]+$/, '/preview.mp4') : '';

      var titleMatch = block.match(/class="title"[^>]*>([^<]+)/) ||
                       block.match(/title="([^"]+)"/) ||
                       block.match(/<a[^>]+>([^<]{5,})/);
      var title = titleMatch ? stripTags(titleMatch[1]) : '';

      // Duration often in a metadata span
      var durMatch = block.match(/<span[^>]*class="[^"]*metadata[^"]*"[^>]*>([\d:]+)/) ||
                     block.match(/<span[^>]+>([\d:]+)<\/span>/);
      var duration = durMatch ? parseDur(durMatch[1].trim()) : 0;

      items.push({
        id: 'xnxx-' + rawId,
        source: 'xnxx',
        title: title,
        thumb: thumb,
        preview: preview,
        url: videoUrl,
        duration: duration,
        views: 0
      });
    }
    return items;
  },

  search: function(query, page) {
    var self = this;
    var p = page || 1;
    // Space → + in URL, page appended as /{p}
    var q = encodeURIComponent(query).replace(/%20/g, '+');
    var url = 'https://www.xnxx.com/search/' + q + '/' + p;
    return cherryFetch(url).then(function(html) {
      var items = self._parseCards(html);
      return { items: items, total_pages: p + 10 };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  cfg: { categories: _cats('amateur:Любительское,anal:Анал,asian:Азиатки,bbw:BBW,big-ass:Большая жопа,big-tits:Большие сиськи,blonde:Блондинки,blowjob:Минет,brunette:Брюнетки,creampie:Кремпай,cumshot:Камшот,ebony:Чёрные,hardcore:Жёсткое,hentai:Хентай,interracial:Межрасовое,japanese:Японское,latina:Латинки,lesbian:Лесбиянки,mature:Зрелые,milf:MILF,pov:От первого лица,public:На публике,redhead:Рыжие,teen:Молодые,threesome:Втроём'), sorts: [] },

  browse: function(category, page) {
    var self = this;
    var p = page || 1;
    // xnxx has no category pages — browse-by-category is tag search /search/{slug}/{page} (0-based page)
    var url = category
      ? _buildCatUrl('https://www.xnxx.com/search/{slug}/{page}', category, p, 0, false)
      : 'https://www.xnxx.com/?k=new&p=' + (p - 1);
    return cherryFetch(url).then(function(html) {
      var items = self._parseCards(html);
      return { items: items, total_pages: p + 10 };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  getStream: function(video) {
    return cherryFetch(video.url).then(function(html) {
      var hlsMatch = html.match(/(?:html5player\.)?setVideoHLS\s*\(\s*['"]([^'"]+)['"]\)/);
      var highMatch = html.match(/(?:html5player\.)?setVideoUrlHigh\s*\(\s*['"]([^'"]+)['"]\)/);
      var lowMatch = html.match(/(?:html5player\.)?setVideoUrlLow\s*\(\s*['"]([^'"]+)['"]\)/);

      var hlsUrl = hlsMatch ? hlsMatch[1] : '';
      var highUrl = highMatch ? highMatch[1] : '';
      var lowUrl = lowMatch ? lowMatch[1] : '';

      var quality = {};
      if (hlsUrl) quality['HLS'] = hlsUrl;
      if (highUrl) quality['MP4 High'] = highUrl;
      if (lowUrl) quality['MP4 Low'] = lowUrl;

      var url = hlsUrl || highUrl || lowUrl || '';
      return { url: url, quality: quality };
    }).catch(function() { return { url: '', quality: {} }; });
  }
});

// ---- Eporner ----
SOURCES.push({
  id: 'eporner',
  name: 'Eporner',
  host: 'eporner.com',
  cfg: { categories: _cats('4k-porn:4K,amateur:Любительское,anal:Анал,asian:Азиатки,bbw:BBW,bdsm:БДСМ,big-ass:Большая жопа,big-dick:Большой член,big-tits:Большие сиськи,blonde:Блондинки,blowjob:Минет,brunette:Брюнетки,creampie:Кремпай,cumshot:Камшот,double-penetration:Двойное,ebony:Чёрные,fetish:Фетиш,group-sex:Групповое,handjob:Дрочка,hardcore:Жёсткое,hentai:Хентай,interracial:Межрасовое,japanese:Японское,latina:Латинки,lesbians:Лесбиянки,massage:Массаж,mature:Зрелые,milf:MILF,public:На публике,redhead:Рыжие,squirt:Сквирт,teens:Молодые,threesome:Втроём,toys:Игрушки,webcam:Вебкам'), sorts: [] },

  _apiFetch: function(url) {
    // eporner JSON search/browse API has Access-Control-Allow-Origin: * — direct fetch is safe here.
    // Do NOT use for HTML page fetches (video pages, XHR endpoint) — use cherryFetch() for those.
    return fetch(url).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  },

  _mapVideo: function(v) {
    return {
      id: String(v.id),
      source: 'eporner',
      title: v.title || '',
      thumb: (v.default_thumb && v.default_thumb.src) ? v.default_thumb.src : '',
      url: v.url || ('https://www.eporner.com/video-' + v.id + '/'),
      duration: parseInt(v.length_sec, 10) || 0,
      views: parseInt(v.views, 10) || 0
    };
  },

  search: function(query, page) {
    var self = this;
    var p = page || 1;
    var url = 'https://www.eporner.com/api/v2/video/search/?query=' + encodeURIComponent(query) +
      '&per_page=30&page=' + p + '&thumbsize=medium&order=most-popular&gay=0&format=json';
    return self._apiFetch(url).then(function(text) {
      var data = JSON.parse(text);
      return { items: (data.videos || []).map(self._mapVideo), total_pages: parseInt(data.total_pages, 10) || 1 };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  browse: function(category, page) {
    var self = this;
    var p = page || 1;
    // Category via the JSON API search (slug → keyword); reuses _mapVideo. Hyphen → space.
    var q = category ? encodeURIComponent(category.replace(/-/g, ' ')) : '';
    var url = 'https://www.eporner.com/api/v2/video/search/?query=' + q + '&per_page=30&page=' + p +
      '&thumbsize=medium&order=most-popular&gay=0&format=json';
    return self._apiFetch(url).then(function(text) {
      var data = JSON.parse(text);
      return { items: (data.videos || []).map(self._mapVideo), total_pages: parseInt(data.total_pages, 10) || 1 };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  getStream: function(video) {
    var pageUrl = video.url;
    if (!pageUrl) return Promise.resolve({ url: '', quality: {} });
    return cherryFetch(pageUrl).then(function(html) {
      var hashM = html.match(/(?:EHH|hash)\s*[=:]\s*['"]([0-9a-f]{32})['"]/i);
      if (!hashM) throw new Error('eporner: hash not found');
      var raw = hashM[1];
      var computed = [raw.slice(0,8), raw.slice(8,16), raw.slice(16,24), raw.slice(24,32)]
        .map(function(c) { return parseInt(c, 16).toString(36); }).join('');
      var xhrUrl = 'https://www.eporner.com/xhr/video/' + video.id +
        '?hash=' + computed + '&device=generic&domain=www.eporner.com&fallback=false';
      return cherryFetch(xhrUrl);
    }).then(function(text) {
      var data = JSON.parse(text);
      var mp4 = data.sources && data.sources.mp4;
      if (!mp4) return { url: '', quality: {} };
      var quality = {};
      Object.keys(mp4).forEach(function(lbl) {
        if (mp4[lbl] && mp4[lbl].src) quality[lbl] = mp4[lbl].src;
      });
      return { url: bestQualityUrl(quality), quality: quality };
    }).catch(function() {
      return { url: '', quality: {} };
    });
  }
});

// ---- Spankbang ----
SOURCES.push({
  id: 'spankbang',
  name: 'Spankbang',
  cfg: { categories: _cats('amateur:Любительское,anal:Анал,anime:Аниме,arab:Арабское,asian:Азиатки,ass:Жопа,babe:Красотки,bbc:BBC,bbw:BBW,bdsm:БДСМ,blonde:Блондинки,blowjob:Минет,bondage:Бондаж,british:Британское,brunette:Брюнетки,busty:Грудастые,casting:Кастинг,compilation:Компиляция,cosplay:Косплей,creampie:Кремпай,cuckold:Куколд,cumshot:Камшот,ebony:Чёрные,feet:Ножки,femdom:Фемдом,fetish:Фетиш,gangbang:Групповуха,hentai:Хентай,indian:Индийское,japanese:Японское,latina:Латинки,massage:Массаж'), sorts: [] },
  host: 'ru.spankbang.com',

  _parseCards: function(html) {
    var items = [];
    // Splits AFTER class="...video-item..." quote — data-video attr remains in each block
    var blocks = html.split(/<div[^>]+class="[^"]*video-item[^"]*"/);
    for (var i = 1; i < blocks.length; i++) {
      var block = blocks[i];
      // href pattern: /{id}/video/
      var hrefMatch = block.match(/href="\/([\w-]+)\/video\//);
      if (!hrefMatch) continue;
      var id = hrefMatch[1];
      var videoUrl = 'https://ru.spankbang.com/' + id + '/video/';

      // Only accept absolute https:// URLs — skips data: placeholders from lazy-loaders
      var thumb = '';
      var tM = block.match(/data-(?:src|original|lazy|thumb)="(https?:\/\/[^"]+\.(?:jpg|jpeg|webp|png)[^"]*)"/i) ||
               block.match(/src="(https?:\/\/tbi\.sb-cd\.com\/[^"]+)"/i) ||
               block.match(/src="(https?:\/\/[^"]+\.(?:jpg|jpeg|webp)(?:\?[^"]*)?)"/i);
      if (tM) thumb = tM[1];

      // Preview: data-video on the card div, or <source>/<video> inside card
      var previewMatch = block.match(/data-video="([^"]+)"/) ||
                         block.match(/<source[^>]+src="([^"]+\.(?:mp4|webm))"/) ||
                         block.match(/<video[^>]+src="([^"]+\.(?:mp4|webm))"/);
      var preview = previewMatch ? previewMatch[1] : '';

      // Title: class with "n" or similar label
      var titleMatch = block.match(/<div[^>]*class="[^"]*\bn\b[^"]*"[^>]*>([\s\S]*?)<\/div>/) ||
                       block.match(/title="([^"]+)"/) ||
                       block.match(/<a[^>]+title="([^"]+)"/);
      var title = titleMatch ? stripTags(titleMatch[1]) : '';

      // Duration: span class "i-f" or similar
      var durMatch = block.match(/<span[^>]*class="[^"]*i-f[^"]*"[^>]*>([^<]+)/) ||
                     block.match(/<span[^>]*class="[^"]*duration[^"]*"[^>]*>([^<]+)/);
      var duration = durMatch ? parseDur(durMatch[1].trim()) : 0;

      items.push({
        id: 'sb-' + id,
        source: 'spankbang',
        title: title,
        thumb: thumb,
        preview: preview,
        url: videoUrl,
        duration: duration,
        views: 0
      });
    }
    return items;
  },

  _parseTotalPages: function(html) {
    // Look for last page number in pagination links
    var pageNums = [];
    var re = /href="[^"]*\/(\d+)\/"[^>]*>[^<]*\d/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var n = parseInt(m[1], 10);
      if (!isNaN(n) && n > 0) pageNums.push(n);
    }
    if (pageNums.length) return Math.max.apply(null, pageNums);
    return 20;
  },

  search: function(query, page) {
    var self = this;
    var p = page || 1;
    var q = encodeURIComponent(query);
    var url = 'https://ru.spankbang.com/s/' + q + '/' + p + '/';
    return cherryFetch(url).then(function(html) {
      var items = self._parseCards(html);
      var total = self._parseTotalPages(html);
      return { items: items, total_pages: total };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  browse: function(category, page) {
    var self = this;
    var p = page || 1;
    var url = category
      ? _buildCatUrl('https://ru.spankbang.com/s/{slug}/{page}/', category, p, 1, true)
      : 'https://ru.spankbang.com/new/' + p + '/';
    return cherryFetch(url).then(function(html) {
      var items = self._parseCards(html);
      var total = self._parseTotalPages(html);
      return { items: items, total_pages: total };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  getStream: function(video) {
    return cherryFetch(video.url).then(function(html) {
      // Phase 1 (PRIMARY): quality map JS literal
      var qMap = {};
      var qRe = /'([0-9]+(?:p|k))'\s*:\s*\['(https?:\/\/[^']+)'/gi;
      var qm;
      while ((qm = qRe.exec(html)) !== null) {
        qMap[qm[1]] = qm[2];
      }
      if (Object.keys(qMap).length) {
        return { url: bestQualityUrl(qMap), quality: qMap };
      }

      // Phase 2 (FALLBACK): streamkey POST
      var skMatch = html.match(/data-streamkey="([^"]+)"/);
      if (skMatch) {
        var streamkey = skMatch[1];
        return cherryPost(
          'https://ru.spankbang.com/api/videos/stream',
          'id=' + streamkey + '&data=0'
        ).then(function(text) {
          var data;
          try { data = JSON.parse(text); } catch (e) { return extractStreams(html); }
          var q = {};
          Object.keys(data).forEach(function(k) {
            if (typeof data[k] === 'string' && data[k].indexOf('http') === 0) q[k] = data[k];
          });
          var best = bestQualityUrl(q);
          if (best) return { url: best, quality: q };
          return extractStreams(html);
        }).catch(function() { return extractStreams(html); });
      }

      // Phase 3: generic extractStreams
      return extractStreams(html);
    }).catch(function() { return { url: '', quality: {} }; });
  }
});


// ---- HQPorner ----
SOURCES.push({
  id: 'hqporner',
  name: 'HQPorner',
  host: 'hqporner.com',

  _parseCards: function(html) {
    var items = [];
    var seen = {};
    // Cards are in <section class="box feature"> blocks; skip first (site header)
    var raw = html.split('<section class="box feature"');
    for (var i = 2; i < raw.length; i++) {
      var block = raw[i];
      var hrefMatch = block.match(/href="((?:https?:\/\/hqporner\.com)?\/hdporn\/[^"]+)"/);
      if (!hrefMatch) continue;
      var videoUrl = hrefMatch[1].charAt(0) === '/'
        ? 'https://hqporner.com' + hrefMatch[1]
        : hrefMatch[1];

      var idMatch = videoUrl.match(/\/hdporn\/([^/]+?)(?:\.html)?(?:\/)?$/);
      var id = idMatch ? idMatch[1] : videoUrl;
      if (seen[id]) continue;
      seen[id] = true;

      // Thumbnail: in defaultImage(...) or first img
      var thumbMatch = block.match(/defaultImage\("(\/\/[^"]+_main\.jpg)"/) ||
                       block.match(/<img[^>]*src="([^"]+)"/);
      var rawThumb = thumbMatch ? (thumbMatch[1].charAt(0) === '/' ? 'https:' + thumbMatch[1] : thumbMatch[1]) : '';
      // CDN blocks direct hotlink access — route through proxy
      var thumb = rawThumb ? buildProxyUrl(rawThumb) : '';

      // Title: in <h3 class="meta-data-title"><a>TITLE</a></h3>
      var titleMatch = block.match(/<h3[^>]*meta-data-title[^>]*><a[^>]*>([^<]+)<\/a>/) ||
                       block.match(/<h3[^>]*><a[^>]*>([^<]+)<\/a>/);
      var slug = id.replace(/^\d+-/, '').replace(/_/g, ' ');
      var title = titleMatch ? stripTags(titleMatch[1]) : slug;

      // Duration: "12m 28s" format in <span class="icon fa-clock-o...">
      var durMatch = block.match(/fa-clock-o[^>]*>([^<]+)/) ||
                     block.match(/([\d]+:[\d]{2})/);
      var duration = durMatch ? parseDur(durMatch[1].trim()) : 0;

      items.push({
        id: 'hqp-' + id,
        source: 'hqporner',
        title: title,
        thumb: thumb,
        url: videoUrl,
        duration: duration,
        views: 0
      });
    }
    return items;
  },

  search: function(query, page) {
    var self = this;
    var p = page || 1;
    var slug = query.toLowerCase().replace(/\s+/g, '-');
    var url = p > 1
      ? 'https://hqporner.com/search/' + slug + '/' + p + '/'
      : 'https://hqporner.com/search/' + slug + '/';
    return cherryFetch(url).then(function(html) {
      var items = self._parseCards(html);
      // Try to find total pages from pagination
      var pgRe2 = new RegExp('\\/search\\/' + slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\/(\\d+)\\/', 'g');
      var total = 1;
      var pgm;
      while ((pgm = pgRe2.exec(html)) !== null) {
        var n2 = parseInt(pgm[1], 10);
        if (n2 > total) total = n2;
      }
      if (total < p) total = p + 5;
      return { items: items, total_pages: total };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  cfg: { categories: _cats('4k-porn:4K,amateur:Любительское,anal-sex-hd:Анал HD,asian:Азиатки,babe:Красотки,bdsm:БДСМ,big-ass:Большая жопа,big-dick:Большой член,big-tits:Большие сиськи,blonde:Блондинки,blowjob:Минет,brunette:Брюнетки,casting:Кастинг,creampie:Кремпай,cumshot:Камшот,ebony:Чёрные,fetish:Фетиш,gangbang:Групповуха,group-sex:Групповое,handjob:Дрочка,hentai:Хентай,interracial:Межрасовое,latina:Латинки,lesbian:Лесбиянки,mature:Зрелые,milf:MILF,pov:От первого лица,public:На публике,redhead:Рыжие,russian:Русское,shemale:Трансы,small-tits:Маленькие сиськи,squirt:Сквирт,stockings:Чулки,teen-porn:Молодые,threesome:Втроём'), sorts: [] },

  browse: function(category, page) {
    var self = this;
    var p = page || 1;
    var url = category
      ? _buildCatUrl('https://hqporner.com/category/{slug}/{page}', category, p, 1, true)
      : (p > 1 ? 'https://hqporner.com/hdporn/' + p : 'https://hqporner.com/');
    return cherryFetch(url).then(function(html) {
      var items = self._parseCards(html);
      // Pagination: look for highest page number in /hdporn/N links
      var pgNums = [];
      var pgRe = /\/hdporn\/(\d+)/g;
      var m;
      while ((m = pgRe.exec(html)) !== null) {
        var n = parseInt(m[1], 10);
        if (!isNaN(n)) pgNums.push(n);
      }
      var total = pgNums.length ? Math.max.apply(null, pgNums) : p + 5;
      return { items: items, total_pages: total };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  getStream: function(video) {
    return cherryFetch(video.url).then(function(html) {
      // HQPorner loads its player via AJAX: url: '/blocks/altplayer.php?i=//mydaddy.cc/video/ID/'
      var embedM = /url:\s*['"]\/blocks\/altplayer\.php\?i=\/\/mydaddy\.cc\/video\/([^'"\/]+)\//i.exec(html);
      if (embedM) {
        return cherryFetch('https://mydaddy.cc/video/' + embedM[1] + '/').then(function(embedHtml) {
          var clean = embedHtml.replace(/\\"/g, '"');
          // bigcdn.cc serves multi-quality: //sN.bigcdn.cc/pubs/HASH/HEIGHT.mp4
          // Hash may contain dots (e.g. "6a14af53d51110.31758800") — use [^/\s"']+ instead of hex
          var bigRe = /(?:https?:)?\/\/(s\d+\.bigcdn\.cc)\/pubs\/([^\/\s"']+)\/(\d{3,4})\.mp4/gi;
          var hashM = bigRe.exec(clean);
          if (hashM) {
            var cdnHost = hashM[1], hash = hashM[2];
            // Collect all heights present in the HTML to only offer existing qualities
            bigRe.lastIndex = 0;
            var seenHeights = {};
            var hm2;
            while ((hm2 = bigRe.exec(clean)) !== null) {
              if (hm2[2] === hash) seenHeights[hm2[3]] = true;
            }
            var heights = Object.keys(seenHeights).length ? Object.keys(seenHeights) : [hashM[3]];
            heights.sort(function(a, b) { return parseInt(a, 10) - parseInt(b, 10); });
            var quality = {};
            heights.forEach(function(h) {
              quality[h + 'p'] = buildProxyUrl('https://' + cdnHost + '/pubs/' + hash + '/' + h + '.mp4', 'https://mydaddy.cc/');
            });
            var best = quality[heights[heights.length - 1] + 'p'];
            return { url: best, quality: quality };
          }
          var result = extractStreams(clean);
          return result.url ? result : { url: '', quality: {} };
        }).catch(function() { return { url: '', quality: {} }; });
      }
      return extractStreams(html);
    }).catch(function() { return { url: '', quality: {} }; });
  }
});

// ---- YouJizz ----
SOURCES.push({
  id: 'youjizz',
  name: 'YouJizz',
  cfg: { categories: _cats('amateur:Любительское,anal:Анал,asian:Азиатки,bbc:BBC,big-ass:Большая жопа,big-tits:Большие сиськи,blonde:Блондинки,blowjob:Минет,casting:Кастинг,compilation:Компиляция,creampie:Кремпай,ebony:Чёрные,gangbang:Групповуха,hentai:Хентай,homemade:Домашнее,interracial:Межрасовое,japanese:Японское,latina:Латинки,massage:Массаж,mature:Зрелые,milf:MILF,pov:От первого лица,stepmom:Мачеха,teen:Молодые,threesome:Втроём'), sorts: [] },
  host: 'youjizz.com',

  _parseCards: function(html) {
    var items = [];
    var blocks = html.split('<div class="video-thumb"');

    for (var i = 1; i < blocks.length; i++) {
      var block = blocks[i];
      var hrefMatch = block.match(/href="(\/videos\/[^"]+\.html)"/);
      if (!hrefMatch) continue;
      var href = hrefMatch[1];
      var videoUrl = 'https://www.youjizz.com' + href;

      // ID: digits from /videos/{slug}-{id}.html
      var idMatch = href.match(/(\d+)\.html/);
      var id = idMatch ? idMatch[1] : String(i);

      var thumbMatch = block.match(/data-original="([^"?#]+\.jpe?g)/i) ||
                       block.match(/data-src="([^"?#]+\.jpe?g)/i) ||
                       block.match(/src="([^"?#]+\.jpe?g)/i);
      var thumb = thumbMatch ? thumbMatch[1] : '';

      var titleMatch = block.match(/<div[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      var title = titleMatch ? stripTags(titleMatch[1]) : '';
      if (!title) {
        var altTitle = block.match(/title="([^"]+)"/);
        title = altTitle ? altTitle[1] : '';
      }

      var durMatch = block.match(/<div[^>]*class="[^"]*duration[^"]*"[^>]*>([^<]+)/);
      var duration = durMatch ? parseDur(durMatch[1].trim()) : 0;

      items.push({
        id: 'yj-' + id,
        source: 'youjizz',
        title: title,
        thumb: thumb,
        url: videoUrl,
        duration: duration,
        views: 0
      });
    }
    return items;
  },

  search: function(query, page) {
    var self = this;
    var p = page || 1;
    var q = encodeURIComponent(query);
    var url = 'https://www.youjizz.com/search/videos/' + q + '-' + p + '.html';
    return cherryFetch(url).then(function(html) {
      var items = self._parseCards(html);
      // Pagination: look for highest page link
      var pgNums = [];
      var pgRe = /\/search\/videos\/[^"]*-(\d+)\.html/g;
      var m;
      while ((m = pgRe.exec(html)) !== null) {
        var n = parseInt(m[1], 10);
        if (!isNaN(n)) pgNums.push(n);
      }
      var total = pgNums.length ? Math.max.apply(null, pgNums) : p + 5;
      return { items: items, total_pages: total };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  browse: function(category, page) {
    var self = this;
    var p = page || 1;
    if (category) {
      // page number baked into the filename: {slug}-{page}.html (1-based)
      var curl = _buildCatUrl('https://www.youjizz.com/categories/{slug}-{page}.html', category, p, 1, false);
      return cherryFetch(curl).then(function(html) {
        return { items: self._parseCards(html), total_pages: p + 5 };
      }).catch(function() { return { items: [], total_pages: 0 }; });
    }
    // youjizz.com/videos/newest-N.html returns 500; use homepage instead
    var url = 'https://www.youjizz.com/';
    return cherryFetch(url).then(function(html) {
      var items = self._parseCards(html);
      return { items: items, total_pages: 1 };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  getStream: function(video) {
    return cherryFetch(video.url).then(function(html) {
      var encMatch = html.match(/Encodings\s*=\s*(\[[\s\S]+?\]);/);
      if (!encMatch) return extractStreams(html);

      var encodings;
      try { encodings = JSON.parse(encMatch[1]); } catch (e) { return extractStreams(html); }

      if (!encodings || !encodings.length) return extractStreams(html);

      var quality = {};
      var firstUrl = '';

      encodings.forEach(function(enc) {
        // Each entry: { filename: 'url', quality: '720', ... }
        var u = enc.filename || enc.url || enc.file || '';
        if (!u) return;
        if (!firstUrl) firstUrl = u;
        var label = enc.quality ? enc.quality + 'p' : (enc.label || enc.format || 'mp4');
        quality[label] = u;
      });

      return { url: firstUrl, quality: quality };
    }).catch(function() { return { url: '', quality: {} }; });
  }
});

// ---- 15. PornOne ----
SOURCES.push({
    id: 'pornone',
    name: 'PornOne',
    host: 'pornone.com',
    cfg: { categories: _cats('amateur:Любительское,anal:Анал,arab:Арабское,asian:Азиатки,ass:Жопа,babes:Красотки,bbc:BBC,bbw:BBW,bdsm:БДСМ,big-boobs:Большие сиськи,big-dick:Большой член,blonde:Блондинки,blowjob:Минет,brunette:Брюнетки,busty:Грудастые,casting:Кастинг,creampie:Кремпай,cumshot:Камшот,ebony:Чёрные,fetish:Фетиш,gangbang:Групповуха,granny:Бабушки,hairy:Волосатые,hardcore:Жёсткое,interracial:Межрасовое,japanese:Японское,latina:Латинки,lesbian:Лесбиянки,massage:Массаж,mature:Зрелые,milf:MILF,mom:Мамки,pov:От первого лица,public:На публике,russian:Русское,teen:Молодые,threesome:Втроём'), sorts: [] },

    // WP REST API is tried first; HTML scraping is the fallback.
    _fromApi: function (text) {
        var posts;
        try { posts = JSON.parse(text); } catch (e) { return null; }
        if (!Array.isArray(posts) || !posts.length) return null;
        return posts.map(function (p) {
            var thumb = '';
            try { thumb = p._embedded['wp:featuredmedia'][0].source_url || ''; } catch (e) {}
            return {
                id:       String(p.id),
                source:   'pornone',
                title:    _decodeHtml((p.title && p.title.rendered) || ''),
                thumb:    thumb,
                url:      p.link || '',
                duration: 0,
                views:    0
            };
        });
    },

    search: function (query, page) {
        var self = this;
        var p = page || 1;
        var apiUrl = 'https://pornone.com/wp-json/wp/v2/posts?search=' +
            encodeURIComponent(query) + '&per_page=20&page=' + p +
            '&_embed=wp%3Afeaturedmedia&_fields=id,title,link,_embedded';
        return cherryFetch(apiUrl).then(function (text) {
            var items = self._fromApi(text);
            if (items) return { items: items, total_pages: p + 5 };
            throw new Error('api-empty');
        }).catch(function () {
            var url = 'https://pornone.com/?s=' + encodeURIComponent(query) + '&paged=' + p;
            return cherryFetch(url).then(function (html) {
                return { items: _pornoneCards(html), total_pages: _pornonePages(html) };
            }).catch(function () { return { items: [], total_pages: 0 }; });
        });
    },

    browse: function (category, page) {
        var self = this;
        var p = page || 1;
        if (category) {
            // Category browses at ROOT /{slug}/{page}/ (HTML); reuse _pornoneCards parser.
            var curl = _buildCatUrl('https://pornone.com/{slug}/{page}/', category, p, 1, true);
            return cherryFetch(curl).then(function (html) {
                return { items: _pornoneCards(html), total_pages: _pornonePages(html) };
            }).catch(function () { return { items: [], total_pages: 0 }; });
        }
        var apiUrl = 'https://pornone.com/wp-json/wp/v2/posts?orderby=date&order=desc' +
            '&per_page=20&page=' + p +
            '&_embed=wp%3Afeaturedmedia&_fields=id,title,link,_embedded';
        return cherryFetch(apiUrl).then(function (text) {
            var items = self._fromApi(text);
            if (items) return { items: items, total_pages: p + 10 };
            throw new Error('api-empty');
        }).catch(function () {
            var url = p > 1
                ? 'https://pornone.com/page/' + p + '/'
                : 'https://pornone.com/';
            return cherryFetch(url).then(function (html) {
                return { items: _pornoneCards(html), total_pages: _pornonePages(html) };
            }).catch(function () { return { items: [], total_pages: 0 }; });
        });
    },

    getStream: function (video) {
        return cherryFetch(video.url).then(function (html) {
            var clean = html.replace(/\\\//g, '/').replace(/\\"/g, '"');
            var fpRx = /sources\s*[=:]\s*\[[\s\S]{0,2000}?['"]?src['"]?\s*:\s*['"]([^'"]+\.(?:mp4|m3u8)[^'"]{0,200})['"]/i;
            var fpM = fpRx.exec(clean);
            if (fpM) return { url: buildProxyUrl(fpM[1], 'https://pornone.com/'), quality: {} };
            var result = extractStreams(clean);
            if (result.url) {
                var q = {};
                Object.keys(result.quality).forEach(function(k) {
                    q[k] = buildProxyUrl(result.quality[k], 'https://pornone.com/');
                });
                return { url: buildProxyUrl(result.url, 'https://pornone.com/'), quality: q };
            }
            var m = clean.match(/['"](?:file|src|source|video_url|videoUrl)['"][\s:,]+['"]([^'"]+\.(?:mp4|m3u8)[^'"]*)['"]/i) ||
                    clean.match(/["'](https?:\/\/[^"'\s]+\.mp4[^"'\s]*)['"]/i);
            if (m) return { url: buildProxyUrl(m[1], 'https://pornone.com/'), quality: {} };
            return { url: '', quality: {} };
        }).catch(function () { return { url: '', quality: {} }; });
    }
});

function _pornoneCards(html) {
    var items = [];
    // Video URLs on pornone end with / and contain a slug — filter out pure nav links
    var hrefRx = /href="(https?:\/\/pornone\.com\/([^"?#]+)\/)"/g;
    var seen = {};
    var m;
    while ((m = hrefRx.exec(html)) !== null) {
        var videoUrl = m[1];
        var slug = m[2];
        // Skip single-segment nav URLs: reserved words, 2-letter lang codes, bare numbers
        if (!slug || (slug.indexOf('/') === -1 && /^(?:page|category|tag|search|feed|wp-content|[a-z]{2}|\d+)$/i.test(slug))) continue;
        // Extract numeric ID from slug (pornone: category/title-slug/ID)
        var slugParts = slug.split('/');
        var numId = '';
        for (var pi = slugParts.length - 1; pi >= 0; pi--) {
            if (/^\d+$/.test(slugParts[pi])) { numId = slugParts[pi]; break; }
        }
        var id = numId || slug.replace(/[^a-z0-9]/gi, '_');
        if (!id || seen[id]) continue;
        seen[id] = true;
        // Title derived from URL slug (segment before the numeric ID)
        var titleSlug = slugParts.length >= 2 ? slugParts[slugParts.length - (numId ? 2 : 1)] : slug;
        var derivedTitle = titleSlug ? titleSlug.replace(/-/g, ' ') : '';

        // Chunk: pornone img+title appear ~1200+ chars AFTER the href → need 2500 forward
        var chunk = html.slice(m.index, m.index + 2500);

        // Thumb: CDN img at th-eu4.pornone.com/t/{id%100}/{id}/d{n}.jpg
        var thumb = _attr(chunk, /src="(https:\/\/th-eu4\.pornone\.com\/t\/\d+\/\d+\/d\d+\.jpe?g)"/i) ||
                    _attr(chunk, /src="(https?:\/\/th-eu4\.pornone\.com\/[^"]+\.jpe?g)"/i);

        var title = _decodeHtml(
            _attr(chunk, /<div[^>]*class="[^"]*videotitle[^"]*"[^>]*>([^<]+)<\/div>/) ||
            _attr(chunk, /th-eu4\.pornone\.com\/t\/[^"]+"\s+alt="([^"]{10,})"/) ||
            derivedTitle
        );

        var duration = parseDur(_attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</));
        var views    = parseViews(_attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));

        if (title || thumb) {
            items.push({ id: id, source: 'pornone', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views });
        }
    }
    return items;
}

function _pornonePages(html) {
    // WP pagination uses ?paged=N (search) or /page/N/ (browse)
    var m = /paged=(\d+)["'][^>]*(?:last|>>)/i.exec(html) ||
            /\/page\/(\d+)\/["'][^>]*(?:last|>>)/i.exec(html);
    return m ? (parseInt(m[1], 10) || 10) : 10;
}

// ---- 1. Porntrex ----
SOURCES.push({
    id: 'porntrex',
    name: 'Porntrex',
    host: 'porntrex.com',
    cfg: { categories: _cats('milf:MILF,teen:Молодые,blowjob:Минет,lesbian:Лесбиянки,hardcore:Жёсткое,pov:От первого лица,blonde:Блондинки,brunette:Брюнетки,busty:Грудастые,hairy:Волосатые,handjob:Дрочка,cumshots:Камшоты,doggystyle:Раком,small-tits:Маленькие сиськи,fetish:Фетиш,college:Колледж,petite:Миниатюрные,russian:Русское,hentai:Хентай'), sorts: [] },

    search: function (query, page) {
        var url = 'https://www.porntrex.com/?s=' + encodeURIComponent(query) + '&page=' + page;
        return cherryFetch(url).then(function (html) {
            return { items: _porntrexCards(html), total_pages: _porntrexPages(html) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    browse: function (category, page) {
        var p = page || 1;
        var url = category
            ? _buildCatUrl('https://www.porntrex.com/categories/{slug}/{page}/', category, p, 1, true)
            : 'https://www.porntrex.com/latest-updates/' + (p > 1 ? p + '/' : '');
        return cherryFetch(url).then(function (html) {
            return { items: _porntrexCards(html), total_pages: _porntrexPages(html) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getStream: function (video) {
        return cherryFetch(video.url).then(function (html) {
            // KVS get_file — collect all MP4 URLs from get_file paths
            var kvsRx = /get_file\/[^\s"'<>]+\.mp4[^\s"'<>]*/g;
            var found = [];
            var m;
            while ((m = kvsRx.exec(html)) !== null) {
                var candidate = m[0].replace(/['">\/\s]+$/, '');
                // Reconstruct absolute URL if the match lacks scheme
                var full = /^https?:\/\//i.test(candidate)
                    ? candidate
                    : 'https://www.porntrex.com/' + candidate.replace(/^\//, '');
                if (found.indexOf(full) === -1) found.push(full);
            }
            if (found.length) {
                var r1 = _kvsPickBest(found);
                var q1 = {};
                Object.keys(r1.quality).forEach(function(k) { q1[k] = buildProxyUrl(r1.quality[k], 'https://www.porntrex.com/'); });
                return { url: buildProxyUrl(r1.url, 'https://www.porntrex.com/'), quality: q1 };
            }

            // Fallback: JS variable assignment
            var varRx = /(video_url|video_alt_url)\s*[=:]\s*['"]([^'"]+)['"]/g;
            var varUrls = [];
            while ((m = varRx.exec(html)) !== null) {
                if (varUrls.indexOf(m[2]) === -1) varUrls.push(m[2]);
            }
            if (varUrls.length) {
                var r2 = _kvsPickBest(varUrls);
                var q2 = {};
                Object.keys(r2.quality).forEach(function(k) { q2[k] = buildProxyUrl(r2.quality[k], 'https://www.porntrex.com/'); });
                return { url: buildProxyUrl(r2.url, 'https://www.porntrex.com/'), quality: q2 };
            }

            return extractStreams(html);
        }).catch(function () { return { url: '', quality: {} }; });
    }
});

function _porntrexCards(html) {
    var items = [];
    var hrefRx = /href="(https?:\/\/www\.porntrex\.com\/video\/[^"]+)"/g;
    var seen = {};
    var m;
    while ((m = hrefRx.exec(html)) !== null) {
        var videoUrl = m[1];
        var idMatch = /\/video\/(\d+)\//.exec(videoUrl);
        var id = idMatch ? idMatch[1] : videoUrl;
        if (seen[id]) continue;
        seen[id] = true;

        // Forward-only chunk: thumb and title appear AFTER the href in KVS markup
        var chunk = html.slice(m.index, m.index + 800);

        // PornTrex uses data-src="//ptx.cdntrex.com/...jpg?v=3" — strip query string, force https:
        // http://ptx.cdntrex.com redirects to porntrex.com homepage; TV browsers resolve // as http://
        var thumb = _attr(chunk, /(?:data-original|data-src|src)="([^"?#]+\.jpe?g)/i) ||
                    _attr(chunk, /(?:data-original|data-src|src)="([^"?#]+\.(?:webp|png))/i);
        if (thumb && thumb.charAt(0) === '/' && thumb.charAt(1) === '/') thumb = 'https:' + thumb;

        var title = _decodeHtml(
            _attr(chunk, /title="([^"]+)"/) ||
            _attr(chunk, /<span[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/span>/) ||
            _attr(chunk, /alt="([^"]+)"/)
        );

        var duration = parseDur(
            _attr(chunk, /<span[^>]*class="[^"]*time[^"]*"[^>]*>([^<]+)<\/span>/) ||
            _attr(chunk, /(?:duration|time)[^>]*>([^<]+)</)
        );

        var views = parseViews(
            _attr(chunk, /(?:views|view_count)[^>]*>([^<]+)</) ||
            _attr(chunk, /(\d[\d,. kKmM]+)\s*(?:views|Views)/)
        );

        if (title || thumb) {
            items.push({ id: id, source: 'porntrex', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views });
        }
    }
    return items;
}

function _porntrexPages(html) {
    var m = /last_page=(\d+)|\/page=(\d+)"[^>]*>[^<]*>>/i.exec(html) ||
            /page=(\d+)"[^>]*(?:last|next|>>)/i.exec(html);
    if (m) return parseInt(m[1] || m[2], 10) || 10;
    return 10;
}

  // ============================================================
  // KVS ENGINE — generic browse/search/card-parse for KVS sites
  // ============================================================

  function _kvsPages(html, pagesRxOrFn, page) {
    if (typeof pagesRxOrFn === 'function') {
      return pagesRxOrFn(html, page) || 10;
    }
    if (pagesRxOrFn instanceof RegExp) {
      var m = pagesRxOrFn.exec(html);
      if (m) return parseInt(m[1], 10) || 10;
      return 10;
    }
    return 10;
  }

  function _kvsParseCards(html, cfg) {
    if (cfg.parseCards) {
      return cfg.parseCards(html);
    }
    if (!cfg.hrefRxSrc) return [];

    var clean = cfg.stripBase64 ? html.replace(/\bsrc="data:[^"]+"/g, 'src=""') : html;
    var before = (cfg.chunkWindow && cfg.chunkWindow.before) || 0;
    var after  = (cfg.chunkWindow && cfg.chunkWindow.after !== undefined) ? cfg.chunkWindow.after : 800;

    var hrefRx = new RegExp(cfg.hrefRxSrc, 'g');
    var seen   = {};
    var items  = [];
    var m;

    while ((m = hrefRx.exec(clean)) !== null) {
      var rawUrl   = m[1];
      var videoUrl = cfg.normalizeUrl ? cfg.normalizeUrl(rawUrl, m) : rawUrl;
      var id       = cfg.idFromUrl(videoUrl, m);

      if (!id || seen[id]) continue;
      seen[id] = true;

      var chunk = clean.slice(Math.max(0, m.index - before), m.index + after);

      var thumb = '';
      var thumbRxList = cfg.thumbRx || [];
      for (var ti = 0; ti < thumbRxList.length; ti++) {
        thumb = _attr(chunk, thumbRxList[ti]);
        if (thumb) break;
      }
      if (!thumb && cfg.thumbFallback) {
        thumb = cfg.thumbFallback(id);
      }

      var titleRaw = '';
      var titleRxList = cfg.titleRx || [];
      for (var ri = 0; ri < titleRxList.length; ri++) {
        titleRaw = _attr(chunk, titleRxList[ri]);
        if (titleRaw) break;
      }
      var title = _decodeHtml(titleRaw);

      var durStr   = _attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</);
      var duration = parseDur(durStr);

      var viewsStr = _attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</);
      var views    = parseViews(viewsStr);

      if (title || thumb) {
        items.push({ id: id, source: cfg.id, title: title, thumb: thumb,
                     url: videoUrl, duration: duration, views: views });
      }
    }

    return items;
  }

  // Build a category-browse URL from a {slug}/{page} template + flags.
  // pageBase: page number for page 1 (0 or 1). page1Omit: drop the page segment on page 1.
  // Handles all site formats: /categories/{slug}/{page}/, root /{slug}/{page}/,
  // no-trailing-slash, 0-based pages, page-in-filename ({slug}-{page}.html), query (&page={page}).
  function _buildCatUrl(fmt, slug, page, pageBase, page1Omit) {
    var p = page || 1;
    var out;
    if (page1Omit && p === 1) {
      out = fmt.replace(/[-/]?\{page\}/, '');     // drop "-{page}" or "/{page}" on page 1
    } else {
      var n = (pageBase === 0) ? (p - 1) : p;
      out = fmt.replace(/\{page\}/, n);
    }
    out = out.replace(/\{slug\}/, slug);
    out = out.replace(/([^:])\/\/+/g, '$1/');     // collapse double slashes (keep scheme ://)
    return out;
  }

  // Compact category list: "slug:Label,slug:Label" → [{id,label}]. Label may contain spaces.
  function _cats(s) {
    return s.split(',').map(function (pair) {
      var i = pair.indexOf(':');
      return { id: pair.slice(0, i), label: pair.slice(i + 1) };
    });
  }

  function _kvsEngine(cfg) {
    if (cfg.id && !/^[a-z0-9_-]+$/i.test(cfg.id)) {
      throw new Error('Cherry _kvsEngine: cfg.id must be alphanumeric/hyphen/underscore, got: ' + cfg.id);
    }
    return {
      id:   cfg.id,
      name: cfg.name,
      host: cfg.host,
      // Expose categories/sorts so the right-edge action menu (openActionsMenu) shows them.
      cfg: { categories: cfg.categories || [], sorts: cfg.sorts || [] },

      search: function(query, page) {
        return cherryFetch(cfg.searchUrl(query, page)).then(function(html) {
          var items = _kvsParseCards(html, cfg);
          var total = typeof cfg.searchTotalPages === 'number'
            ? cfg.searchTotalPages
            : _kvsPages(html, cfg.pagesRx, page);
          return { items: items, total_pages: total };
        }).catch(function() { return { items: [], total_pages: 0 }; });
      },

      browse: function(category, page, sort) {
        var p = page || 1;
        var url;
        if (category && cfg.categoryFmt) {
          url = _buildCatUrl(cfg.categoryFmt, category, p, cfg.catPageBase || 1, cfg.catPage1Omit !== false);
          if (sort) url += (url.indexOf('?') >= 0 ? '&' : '?') + (cfg.sortParam || 'sort_by') + '=' + sort;
        } else {
          url = cfg.browseUrl(p);
        }
        return cherryFetch(url).then(function(html) {
          return {
            items:       _kvsParseCards(html, cfg),
            total_pages: _kvsPages(html, cfg.pagesRx, p)
          };
        }).catch(function() { return { items: [], total_pages: 0 }; });
      },

      getStream: cfg.getStream
    };
  }

// ---- 2. Xozilla ----
SOURCES.push(_kvsEngine({
    id: 'xozilla',
    name: 'Xozilla',
    host: 'xozilla.com',
    categoryFmt: 'https://www.xozilla.com/categories/{slug}/{page}/',
    catPageBase: 1, catPage1Omit: true,
    categories: _cats('amateur:Любительское,anal:Анал,asian:Азиатки,bbw:BBW,big-tits:Большие сиськи,blonde:Блондинки,blowjob:Минет,creampie:Кремпай,hairy:Волосатые,hardcore:Жёсткое,indian:Индийское,interracial:Межрасовое,japanese:Японское,lesbian:Лесбиянки,milf:MILF,pov:От первого лица,stockings:Чулки,teen:Молодые,threesome:Втроём,young:Юные'),
    sorts: [{id:'video_viewed',label:'Популярное'},{id:'rating',label:'Топ рейтинга'},{id:'post_date',label:'Новое'}],
    searchUrl: function(query, page) {
        return 'https://xozilla.com/?s=' + encodeURIComponent(query) + '&p=' + page;
    },
    browseUrl: function(page) {
        return page > 1
            ? 'https://www.xozilla.com/latest-updates/' + page + '/'
            : 'https://www.xozilla.com/latest-updates/';
    },
    hrefRxSrc: 'href="(https?://(?:www\\.)?xozilla\\.com/videos/[0-9]+/[^"]+)"',
    idFromUrl: function(url) {
        return url.replace(/^https?:\/\/[^/]+/, '').replace(/[^a-z0-9]/gi, '_');
    },
    chunkWindow: { before: 0, after: 800 },
    stripBase64: true,
    thumbRx: [
        /(?:data-original|data-src|src)="([^"?#]+\.jpe?g)/i,
        /(?:data-original|data-src|src)="([^"?#]+\.(?:webp|png))/i
    ],
    titleRx: [
        /<strong[^>]*class="[^"]*title[^"]*"[^>]*>\s*([^<]+)/,
        /title="([^"]+)"/,
        /alt="([^"]+)"/
    ],
    pagesRx: /p=(\d+)"[^>]*(?:last|>>|&raquo;)/i,
    getStream: function(video) {
        return cherryFetch(video.url).then(function(html) {
            var varM = /(video_url|video_alt_url2|video_alt_url)\s*[=:]\s*['"]([^'"]+)['"]/g;
            var best = '', quality = {};
            var labels = { video_url: '480p', video_alt_url: '720p', video_alt_url2: '1080p' };
            var fm;
            while ((fm = varM.exec(html)) !== null) {
                quality[labels[fm[1]] || fm[1]] = fm[2];
                if (!best || fm[1] === 'video_alt_url2') best = fm[2];
            }
            if (best) return { url: best, quality: quality };
            return extractStreams(html);
        }).catch(function() { return { url: '', quality: {} }; });
    }
}));

// ---- 3. 3Movs ----
SOURCES.push({
    id: '3movs',
    name: '3Movs',
    host: '3movs.com',
    cfg: { categories: _cats('milf:MILF,teen:Молодые,anal:Анал,blowjob:Минет,big-tits:Большие сиськи,amateur:Любительское,mature:Зрелые,asian:Азиатки,japanese:Японское,lesbian:Лесбиянки,pov:От первого лица,hardcore:Жёсткое,threesome:Втроём,interracial:Межрасовое,ebony:Чёрные,big-cock:Большой член,cumshot:Камшот,creampie:Кремпай,public:На публике,casting:Кастинг,mom:Мамки,squirting:Сквирт,gangbang:Групповуха,russian:Русское,german:Немецкое,big-ass:Большая жопа,bdsm:БДСМ,massage:Массаж,toys:Игрушки'), sorts: [] },

    search: function (query, page) {
        var url = 'https://www.3movs.com/?s=' + encodeURIComponent(query) + '&p=' + page;
        return cherryFetch(url).then(function (html) {
            return { items: _3movsCards(html), total_pages: _3movsPages(html) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    browse: function (category, page) {
        var p = page || 1;
        if (category) {
            // 3movs serves a valid body with a 404 status on category page>1 —
            // use status-tolerant _fetchAny so pagination isn't dropped.
            var curl = _buildCatUrl('https://3movs.com/categories/{slug}/{page}/', category, p, 1, true);
            return _fetchAny(curl).then(function (html) {
                return { items: _3movsCards(html), total_pages: _3movsPages(html) };
            }).catch(function () { return { items: [], total_pages: 0 }; });
        }
        var url = p > 1
            ? 'https://www.3movs.com/latest-updates/' + p + '/'
            : 'https://www.3movs.com/latest-updates/';
        return cherryFetch(url).then(function (html) {
            return { items: _3movsCards(html), total_pages: _3movsPages(html) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getStream: function (video) {
        return cherryFetch(video.url).then(function (html) {
            // kt_player flashvars: video_url: 'url', video_alt_url: '720p', video_alt_url2: '1080p'
            var varM = /(video_url|video_alt_url2|video_alt_url)\s*[=:]\s*['"]([^'"]+)['"]/g;
            var best = '', quality = {};
            var labels = { video_url: '480p', video_alt_url: '720p', video_alt_url2: '1080p' };
            var fm;
            while ((fm = varM.exec(html)) !== null) {
                quality[labels[fm[1]] || fm[1]] = fm[2];
                if (!best || fm[1] === 'video_alt_url2') best = fm[2];
            }
            if (best) return { url: best, quality: quality };
            return extractStreams(html);
        }).catch(function () { return { url: '', quality: {} }; });
    }
});

function _3movsCards(html) {
    var items = [];
    var hrefRx = /href="(https?:\/\/(?:www\.)?3movs\.com\/[^"?#]+)"/g;
    var seen = {};
    var m;
    while ((m = hrefRx.exec(html)) !== null) {
        var videoUrl = m[1];
        // Skip category/index pages — video URLs typically contain a numeric ID or 'videos'
        if (/\/$/.test(videoUrl) && !/\/videos\//.test(videoUrl) && !/\/\d+/.test(videoUrl)) continue;
        var id = videoUrl.replace(/^https?:\/\/[^/]+\//, '').replace(/[^a-z0-9]/gi, '_');
        if (!id || seen[id]) continue;
        seen[id] = true;

        var chunk = html.slice(Math.max(0, m.index - 800), m.index + 600);

        var thumb = _attr(chunk, /(?:data-src|src)="([^"]+\.jpe?g)"/i) ||
                    _attr(chunk, /(?:data-src|src)="([^"]+\.(?:webp|png))"/i);

        var title = _decodeHtml(
            _attr(chunk, /title="([^"]+)"/) ||
            _attr(chunk, /alt="([^"]+)"/) ||
            _attr(chunk, /<h\d[^>]*>([^<]+)<\/h\d>/)
        );

        var duration = parseDur(_attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</));
        var views    = parseViews(_attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));

        if (title || thumb) {
            items.push({ id: id, source: '3movs', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views });
        }
    }
    return items;
}

function _3movsPages(html) {
    var m = /p=(\d+)"[^>]*(?:last|>>|&raquo;)/i.exec(html);
    return m ? (parseInt(m[1], 10) || 10) : 10;
}

// ---- 4. Analdin ----
SOURCES.push(_kvsEngine({
    id: 'analdin',
    name: 'Analdin',
    host: 'analdin.com',
    categoryFmt: 'https://www.analdin.com/categories/{slug}/{page}/',
    catPageBase: 1, catPage1Omit: true,
    categories: _cats('18-years-old:18 лет,69:69,anal:Анал,anal-toys:Анальные игрушки,arab:Арабское,asian:Азиатки,ass:Жопа,ass-licking:Лизание жопы,babes:Красотки,bbc:BBC,bbw:BBW,bdsm:БДСМ,blowjob:Минет'),
    sorts: [{id:'video_viewed',label:'Популярное'},{id:'rating',label:'Топ рейтинга'},{id:'duration',label:'Длинные'}],
    searchUrl: function(query, page) {
        return 'https://analdin.com/?s=' + encodeURIComponent(query) + '&p=' + page;
    },
    browseUrl: function(page) {
        return page > 1
            ? 'https://analdin.com/latest-updates/' + page + '/'
            : 'https://analdin.com/latest-updates/';
    },
    hrefRxSrc: 'href="(https?://(?:www\\.)?analdin\\.com/videos/[0-9]+/[^"]+)"',
    idFromUrl: function(url) {
        return url.replace(/^https?:\/\/[^/]+\//, '').replace(/[^a-z0-9]/gi, '_');
    },
    chunkWindow: { before: 0, after: 1400 },
    stripBase64: true,
    thumbRx: [
        /\bthumb="([^"]+\.jpe?g)"/i,
        /data-original="([^"]+\.jpe?g)"/i,
        /(?:data-src|src)="([^"]+\.jpe?g)"/i,
        /(?:data-src|src)="([^"]+\.(?:webp|png))"/i
    ],
    titleRx: [
        /<strong[^>]*class="[^"]*title[^"]*"[^>]*>\s*([^<]+)/,
        /alt="([^"]+)"/,
        /title="([^"]+)"/
    ],
    pagesRx: /p=(\d+)"[^>]*(?:last|>>|&raquo;)/i,
    getStream: function(video) {
        return cherryFetch(video.url).then(function(html) {
            var varM = /(video_url|video_alt_url2|video_alt_url)\s*[=:]\s*['"]([^'"]+)['"]/g;
            var best = '', quality = {};
            var labels = { video_url: '480p', video_alt_url: '720p', video_alt_url2: '1080p' };
            var fm;
            while ((fm = varM.exec(html)) !== null) {
                quality[labels[fm[1]] || fm[1]] = fm[2];
                if (!best || fm[1] === 'video_alt_url2') best = fm[2];
            }
            if (best) return { url: best, quality: quality };
            return extractStreams(html);
        }).catch(function() { return { url: '', quality: {} }; });
    }
}));

// ---- 5. PornVe ----
SOURCES.push({
    id: 'pornve',
    name: 'PornVe',
    host: 'pornve.com',
    cfg: { categories: _cats('saggy-tits:Обвисшие сиськи,twerking:Тверк,bareback:Без резинки,triple-penetration:Тройное проникновение,spring-break:Весенние каникулы,camel-toe:Camel toe,ex-girlfriend:Бывшая,sex-slave:Секс-рабыня,submissive:Покорные,tribbing:Трибба,gilf:GILF'), sorts: [] },

    search: function (query, page) {
        var q = encodeURIComponent(query).replace(/%20/g, '+');
        // page 1: /search/{q}/, page N: /search/{q}/page{N}/
        var url = page > 1
            ? 'https://pornve.com/search/' + q + '/page' + page + '/'
            : 'https://pornve.com/search/' + q + '/';
        return cherryFetch(url).then(function (html) {
            return { items: _pornveCards(html), total_pages: _pornvePages(html) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    browse: function (category, page) {
        var p = page || 1;
        var url = category
            ? _buildCatUrl('https://pornve.com/categories/{slug}/{page}/', category, p, 1, true)
            : (p > 1 ? 'https://pornve.com/latest-updates/?page=' + p
                     : 'https://pornve.com/latest-updates/');
        return cherryFetch(url).then(function (html) {
            return { items: _pornveCards(html), total_pages: _pornvePages(html) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getStream: function (video) {
        return cherryFetch(video.url).then(function (html) {
            // kt_player flashvars: video_url: 'url', video_alt_url: '720p', video_alt_url2: '1080p'
            var varM = /(video_url|video_alt_url2|video_alt_url)\s*[=:]\s*['"]([^'"]+)['"]/g;
            var best = '', quality = {};
            var labels = { video_url: '480p', video_alt_url: '720p', video_alt_url2: '1080p' };
            var fm;
            while ((fm = varM.exec(html)) !== null) {
                quality[labels[fm[1]] || fm[1]] = fm[2];
                if (!best || fm[1] === 'video_alt_url2') best = fm[2];
            }
            if (best) return { url: best, quality: quality };
            return extractStreams(html);
        }).catch(function () { return { url: '', quality: {} }; });
    }
});

function _pornveCards(html) {
    var items = [];
    var hrefRx = /href="(https?:\/\/pornve\.com\/video\/[^"]+)"/g;
    var seen = {};
    var m;
    while ((m = hrefRx.exec(html)) !== null) {
        var videoUrl = m[1];
        var idMatch = /\/video\/(\d+)\//.exec(videoUrl);
        var id = idMatch ? idMatch[1] : videoUrl;
        if (seen[id]) continue;
        seen[id] = true;

        var chunk = html.slice(Math.max(0, m.index - 800), m.index + 600);

        // SisiStyle thumb: cdn.pornve.com/contents/videos_screenshots/...
        var thumb = _attr(chunk, /(?:data-src|src)="(https?:\/\/cdn\.pornve\.com\/contents\/videos_screenshots\/[^"]+)"/i) ||
                    _attr(chunk, /(?:data-src|src)="([^"]+\.jpe?g)"/i);

        var title = _decodeHtml(
            _attr(chunk, /<(?:h\d|div)[^>]*class="[^"]*(?:title|name)[^"]*"[^>]*>([^<]+)<\//) ||
            _attr(chunk, /title="([^"]+)"/) ||
            _attr(chunk, /alt="([^"]+)"/)
        );

        var duration = parseDur(
            _attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</) ||
            _attr(chunk, /(\d+:\d+)/)
        );

        var views = parseViews(_attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));

        if (title || thumb) {
            items.push({ id: id, source: 'pornve', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views });
        }
    }
    return items;
}

function _pornvePages(html) {
    var m = /page(\d+)\/?["'<][^>]*(?:last|next|>>)/i.exec(html) ||
            /[?&]page=(\d+)["'][^>]*(?:last|>>)/i.exec(html);
    return m ? (parseInt(m[1], 10) || 10) : 10;
}

// ---- 6. FamilyPorn ----
SOURCES.push({
    id: 'familyporn',
    name: 'FamilyPorn',
    host: 'familyporn.tv',
    cfg: { categories: _cats('sisters:Сёстры,cousin:Кузены,virgin:Девственницы,stepbrother-stepsister:Сводные брат и сестра,stepdaughter-stepdad:Отчим и падчерица,brother-sister:Брат и сестра,stepmom-stepson:Мачеха и пасынок,dad-daughter:Папа и дочь,mother-daughter:Мать и дочь'), sorts: [] },

    search: function (query, page) {
        var url = 'https://familyporn.tv/search/?q=' + encodeURIComponent(query) + '&page=' + page;
        return cherryFetch(url).then(function (html) {
            return { items: _familypornCards(html), total_pages: _familypornPages(html) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    browse: function (category, page) {
        var p = page || 1;
        var url = category
            ? _buildCatUrl('https://familyporn.tv/categories/{slug}/{page}/', category, p, 1, true)
            : 'https://familyporn.tv/latest-updates/' + p + '/';
        return cherryFetch(url).then(function (html) {
            return { items: _familypornCards(html), total_pages: _familypornPages(html) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getStream: function (video) {
        return cherryFetch(video.url).then(function (html) {
            // kt_player flashvars: video_url: 'url', video_alt_url: '720p', video_alt_url2: '1080p'
            var varM = /(video_url|video_alt_url2|video_alt_url)\s*[=:]\s*['"]([^'"]+)['"]/g;
            var best = '', quality = {};
            var labels = { video_url: '480p', video_alt_url: '720p', video_alt_url2: '1080p' };
            var fm;
            while ((fm = varM.exec(html)) !== null) {
                quality[labels[fm[1]] || fm[1]] = fm[2];
                if (!best || fm[1] === 'video_alt_url2') best = fm[2];
            }
            if (best) return { url: best, quality: quality };
            return extractStreams(html);
        }).catch(function () { return { url: '', quality: {} }; });
    }
});

function _familypornCards(html) {
    var items = [];
    var hrefRx = /href="(https?:\/\/familyporn\.tv\/videos\/[^"]+)"/g;
    var seen = {};
    var m;
    while ((m = hrefRx.exec(html)) !== null) {
        var videoUrl = m[1];
        // ID is derived from the slug after /videos/
        var slugMatch = /\/videos\/([^/"?]+)/.exec(videoUrl);
        var id = slugMatch ? slugMatch[1] : videoUrl;
        if (seen[id]) continue;
        seen[id] = true;

        // Look only FORWARD from href — title is in title="" attr on same <a> tag
        var chunk = html.slice(m.index, m.index + 800);

        // SisiStyle thumb path (data-original = KVS lazy-load)
        var thumb = _attr(chunk, /(?:data-original|data-src|src)="([^"?#]+\/contents\/videos_screenshots\/[^"?#]+)/i) ||
                    _attr(chunk, /(?:data-original|data-src|src)="([^"?#]+\.jpe?g)/i);

        var title = _decodeHtml(
            _attr(chunk, /title="([^"]+)"/) ||
            _attr(chunk, /<strong[^>]*class="[^"]*title[^"]*"[^>]*>\s*([^<]+)/) ||
            _attr(chunk, /alt="([^"]+)"/)
        );

        var duration = parseDur(_attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</));
        var views    = parseViews(_attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));

        if (title || thumb) {
            items.push({ id: id, source: 'familyporn', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views });
        }
    }
    return items;
}

function _familypornPages(html) {
    var m = /[?&]page=(\d+)["'][^>]*(?:last|>>)|\/(\d+)\/["'][^>]*(?:last|>>)/i.exec(html);
    return m ? (parseInt(m[1] || m[2], 10) || 10) : 10;
}

// ---- 7. Porndig ----
SOURCES.push({
    id: 'porndig',
    name: 'Porndig',
    host: 'porndig.com',
    // Composite slug "{id}/{name}" (porndig channels need both). Browse: /channels/{id}/{name}/page/{n}.
    cfg: { categories: _cats('33/anal:Анал,34/young:Юные,36/blonde:Блондинки,38/asian:Азиатки,39/milf:MILF,40/lesbian:Лесбиянки,41/mature:Зрелые,42/orgy:Оргия,43/big-boobs:Большие сиськи,45/black:Чёрные,46/bbw:BBW,47/creampie:Кремпай,48/masturbation:Мастурбация,51/hentai:Хентай,52/blowjob:Минет,53/interracial:Межрасовое,54/latina:Латинки,55/bondage-bdsm:БДСМ,57/fetish:Фетиш,58/pov:От первого лица,60/redhead:Рыжие,63/brunette:Брюнетки,64/double-penetration:Двойное,67/small-tits:Маленькие сиськи,74/massage:Массаж,799/cumshot:Камшот,802/big-dick:Большой член,816/stockings:Чулки,82/gangbang:Групповуха,1198/big-ass:Большая жопа'), sorts: [] },

    search: function (query, page) {
        var q = encodeURIComponent(query);
        var url = page > 1
            ? 'https://porndig.com/search/' + q + '/page/' + page
            : 'https://porndig.com/search/' + q + '/';
        return cherryFetch(url).then(function (html) {
            return { items: _porndigCards(html), total_pages: _porndigPages(html) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    browse: function (category, page) {
        var p = page || 1;
        // category is a composite "{id}/{name}" channel slug.
        var url = category
            ? 'https://porndig.com/channels/' + category + (p > 1 ? '/page/' + p : '')
            : 'https://porndig.com/channels/33/anal/page/' + p;
        return cherryFetch(url).then(function (html) {
            return { items: _porndigCards(html), total_pages: _porndigPages(html) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getStream: function (video) {
        return cherryFetch(video.url).then(function (html) {
            var m = /src="(https?:\/\/videos\.porndig\.com\/[^"]+)"/i.exec(html);
            if (m) {
                return cherryFetch(m[1]).then(function (ihtml) {
                    // Player uses srcSet:[{src,label}] JSON — keys are double-quoted, slashes escaped as \/
                    var quality = {};
                    var sRx = /"srcSet"\s*:\s*\[([\s\S]{0,3000}?)\]/g, sm;
                    while ((sm = sRx.exec(ihtml)) !== null) {
                        var eRx = /\{[^{}]{0,600}\}/g, em;
                        while ((em = eRx.exec(sm[1])) !== null) {
                            var ent = em[0];
                            var fm = /"src"\s*:\s*"([^"]+\.mp4[^"]*)"/i.exec(ent);
                            var lm = /"label"\s*:\s*"(\d+)/i.exec(ent);
                            if (fm && lm) {
                                var u = fm[1].replace(/\\\//g, '/');
                                if (!quality[lm[1]]) quality[lm[1]] = u;
                            }
                        }
                    }
                    if (Object.keys(quality).length) return { url: bestQualityUrl(quality), quality: quality };
                    return { url: '', quality: {} };
                }).catch(function () { return { url: '', quality: {} }; });
            }
            return { url: '', quality: {} };
        }).catch(function () { return { url: '', quality: {} }; });
    }
});

function _porndigCards(html) {
    var items = [];
    var hrefRx = /href="((?:https?:\/\/porndig\.com)?\/videos\/(\d+)\/[^"]+\.html)"/g;
    var seen = {};
    var m;
    while ((m = hrefRx.exec(html)) !== null) {
        var videoUrl = m[1].charAt(0) === '/' ? 'https://porndig.com' + m[1] : m[1];
        var id = m[2];
        if (seen[id]) continue;
        seen[id] = true;

        var chunk = html.slice(m.index, m.index + 900);

        // image-cdn.porndig.com/thumbs/YYYY/MM/ID/...
        var thumb = _attr(chunk, /(?:data-original|data-src|src)="(https?:\/\/image-cdn\.porndig\.com\/thumbs\/[^"?#]+)/i) ||
                    _attr(chunk, /(?:data-original|data-src|src)="([^"?#]+\.jpe?g)/i);

        var title = _decodeHtml(
            _attr(chunk, /<div[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/div>/) ||
            _attr(chunk, /title="([^"]+)"/) ||
            _attr(chunk, /alt="([^"]+)"/)
        );

        var duration = parseDur(_attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</));
        var views    = parseViews(_attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));

        if (title || thumb) {
            items.push({ id: id, source: 'porndig', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views });
        }
    }
    return items;
}

function _porndigPages(html) {
    var m = /\/page\/(\d+)["'][^>]*(?:last|>>)/i.exec(html);
    return m ? (parseInt(m[1], 10) || 10) : 10;
}

// ---- Tizam ----
SOURCES.push({
  id: 'tizam',
  name: 'Tizam',
  host: 'tv4.tizam.org',
  // Category pages render one page in static HTML (pagination is JS-only) → total_pages 1.
  cfg: { categories: _cats('all_sex:Все,anal_seks_bol_shie_popki:Анал,aziatki:Азиатки,bol_shaya_grud:Большая грудь,dominirovanie:Доминирование,groupvideo:Групповое,incest:Инцест,italyan_porn:Итальянское,klassika:Классика,minet:Минет,nemeckie_pornofil_my:Немецкое,novinki:Новинки,podrostki_18:Подростки 18+,polnometrazhnye:Полнометражные,pyshechki:Пышечки,russkoe_porno:Русское,s_russkim_perevodom:С переводом,svingery:Свингеры,temnokozhie:Темнокожие,zhenskaya_masturbaciya:Мастурбация,zrelye:Зрелые'), sorts: [] },

  _parseCards: function(html) {
    var items = [];
    var seen = {};
    // Match only 3-segment video URLs: /category/subcategory/slug/
    // [^/?#"]+ excludes ? # / " so ?p=N pagination links are never matched
    var hrefRx = /href="((?:https?:\/\/tv4\.tizam\.org)?\/fil_my_dlya_vzroslyh\/[^/?#"]+\/[^/?#"]+\/)"/g;
    var m;
    while ((m = hrefRx.exec(html)) !== null) {
      var cardUrl = m[1].charAt(0) === '/' ? 'https://tv4.tizam.org' + m[1] : m[1];
      var slugMatch = cardUrl.replace(/\/$/, '').match(/\/([^/]+)$/);
      var id = slugMatch ? slugMatch[1] : cardUrl;
      if (seen[id]) continue;
      seen[id] = true;

      // Look FORWARD from href: chunk covers the <a> and the <h3> title that follows it
      var chunk = html.slice(m.index, m.index + 1200);

      var rawThumb = _attr(chunk, /src="([^"]+\/images\/cms\/thumbs\/[^"]+)"/) ||
                     _attr(chunk, /src="([^"?#]+\.jpe?g)"/);
      var thumb = rawThumb && rawThumb.charAt(0) === '/' ? 'https://tv4.tizam.org' + rawThumb : rawThumb;

      // Title: prefer <span class="title"> (actual video name) or <h3>, then img alt
      var title = _decodeHtml(
        _attr(chunk, /<span[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([^<]+)/) ||
        _attr(chunk, /<h[23][^>]*>([^<]+)<\/h[23]>/) ||
        _attr(chunk, /itemprop="name"[^>]*>([^<]+)/) ||
        _attr(chunk, /alt="([^"]+)"/)
      );

      if (!title && !thumb) continue;

      items.push({
        id: 'tizam-' + id,
        source: 'tizam',
        title: title,
        thumb: thumb,
        url: cardUrl,
        duration: 0,
        views: 0
      });
    }
    return items;
  },

  search: function(query, page) {
    // Tizam has no keyword search; attempt generic ?s= and return empty on failure
    return cherryFetch('https://tv4.tizam.org/?s=' + encodeURIComponent(query))
      .then(function(html) {
        var items = [];
        // Simple link scan
        var re = /href="(https?:\/\/tv4\.tizam\.org\/[^"]+)"/g;
        var m;
        var seen = {};
        while ((m = re.exec(html)) !== null) {
          var u = m[1];
          if (seen[u] || !/tv4\.tizam\.org\/[^/]+\/[^/]+\/[^/]+/.test(u)) continue;
          seen[u] = true;
          var slugM = u.match(/\/([^/]+)\/?$/);
          items.push({
            id: 'tizam-' + (slugM ? slugM[1] : items.length),
            source: 'tizam',
            title: slugM ? slugM[1].replace(/-/g, ' ') : '',
            thumb: '',
            url: u,
            duration: 0,
            views: 0
          });
        }
        return { items: items, total_pages: items.length ? 1 : 0 };
      })
      .catch(function() { return { items: [], total_pages: 0 }; });
  },

  browse: function(category, page) {
    var self = this;
    var p = page || 1;
    if (category) {
      // Category page is a single static page (pagination is JS-rendered) → total_pages 1.
      var curl = 'https://tv4.tizam.org/fil_my_dlya_vzroslyh/' + category + '/';
      return cherryFetch(curl).then(function(html) {
        return { items: self._parseCards(html), total_pages: 1 };
      }).catch(function() { return { items: [], total_pages: 0 }; });
    }
    // Zero-indexed: page 1 → ?p=0
    var url = 'https://tv4.tizam.org/fil_my_dlya_vzroslyh/s_russkim_perevodom/?p=' + (p - 1);
    return cherryFetch(url).then(function(html) {
      var items = self._parseCards(html);
      return { items: items, total_pages: 50 };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  getStream: function(video) {
    return cherryFetch(video.url).then(function(html) {
      var res = extractStreams(html);
      return res.url ? res : { url: '', quality: {} };
    }).catch(function() { return { url: '', quality: {} }; });
  }
});

// ---- 17. PerfektDamen ----
SOURCES.push({
    id: 'perfektdamen',
    name: 'PerfektDamen',
    host: 'perfektdamen.co',
    cfg: { categories: _cats('anal:Анал,18-year-old:18 лет,3d-porn:3D,3some:Втроём'), sorts: [] },

    search: function (query, page) {
        var url = page > 1
            ? 'https://perfektdamen.co/search/' + page + '/?q=' + encodeURIComponent(query)
            : 'https://perfektdamen.co/search/1/?q=' + encodeURIComponent(query);
        return cherryFetch(url).then(function (html) {
            return { items: _perfektCards(html), total_pages: _perfektPages(html) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    browse: function (category, page) {
        var p = page || 1;
        if (category) {
            var curl = _buildCatUrl('https://www.perfektdamen.co/tags/{slug}/{page}/', category, p, 1, true);
            return cherryFetch(curl).then(function (html) {
                return { items: _perfektCards(html), total_pages: _perfektPages(html) };
            }).catch(function () { return { items: [], total_pages: 0 }; });
        }
        // Popular / front page; pagination handled via browse page number if site supports it
        var url = 'https://perfektdamen.co/popular/';
        return cherryFetch(url).then(function (html) {
            return { items: _perfektCards(html), total_pages: 1 };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getStream: function (video) {
        return cherryFetch(video.url).then(function (html) {
            return extractStreams(html);
        }).catch(function () { return { url: '', quality: {} }; });
    }
});

function _perfektCards(html) {
    var items = [];
    var hrefRx = /href="((?:https?:\/\/(?:www\.)?perfektdamen\.co)?\/video\/(\d+)\/)"/g;
    var seen = {};
    var m;
    while ((m = hrefRx.exec(html)) !== null) {
        var videoUrl = m[1].charAt(0) === '/' ? 'https://www.perfektdamen.co' + m[1] : m[1];
        var id = m[2];
        if (seen[id]) continue;
        seen[id] = true;

        // Forward-only: PerfektDamen uses data-original="//static.perfektdamen.co/...jpg"
        var chunk = html.slice(m.index, m.index + 1000);

        var thumb = _attr(chunk, /(?:data-original|data-src|src)="([^"?#]+\.jpe?g)/i) ||
                    _attr(chunk, /(?:data-original|data-src|src)="([^"?#]+\.(?:webp|png))/i);

        var title = _decodeHtml(
            _attr(chunk, /title="([^"]+)"/) ||
            _attr(chunk, /<(?:h\d|div)[^>]*class="[^"]*(?:title|name)[^"]*"[^>]*>([^<]+)<\//) ||
            _attr(chunk, /alt="([^"]+)"/)
        );

        var duration = parseDur(_attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</));
        var views    = parseViews(_attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));

        if (title || thumb) {
            items.push({ id: id, source: 'perfektdamen', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views });
        }
    }
    return items;
}

function _perfektPages(html) {
    var m = /\/search\/(\d+)\/["'][^>]*(?:last|>>)/i.exec(html);
    return m ? (parseInt(m[1], 10) || 10) : 10;
}

// ---- HellPorno ----
SOURCES.push(_kvsEngine({
  id: 'hellporno',
  name: 'HellPorno',
  host: 'hellporno.com',
  categoryFmt: 'https://hellporno.com/{slug}/{page}/',
  catPageBase: 1, catPage1Omit: true,
  categories: _cats('anal:Анал,arab:Арабское,asian:Азиатки,bbw:BBW,bdsm:БДСМ,big-ass:Большая жопа,big-tits:Большие сиськи,casting:Кастинг,creampie:Кремпай,ebony:Чёрные,gangbang:Групповуха,granny:Бабушки,hairy:Волосатые,handjob:Дрочка,indian:Индийское,interracial:Межрасовое,japanese:Японское,milf:MILF,massage:Массаж,mature:Зрелые,mom:Мамки,pov:От первого лица,public:На публике,russian:Русское,teen:Молодые,threesome:Втроём'),
  sorts: [{id:'video_viewed',label:'Популярное'}],
  searchUrl: function(query, page) {
    return 'https://hellporno.com/search/' + (page || 1) + '/?q=' + encodeURIComponent(query);
  },
  browseUrl: function(page) {
    return 'https://hellporno.com/' + (page || 1) + '/';
  },
  pagesRx: function(html, p) {
    var nums = [];
    var m;
    var brRe = /href="https?:\/\/hellporno\.com\/(\d+)\/"/g;
    while ((m = brRe.exec(html)) !== null) {
      var n = parseInt(m[1], 10);
      if (!isNaN(n)) nums.push(n);
    }
    var srRe = /\/search\/(\d+)\//g;
    while ((m = srRe.exec(html)) !== null) {
      var n = parseInt(m[1], 10);
      if (!isNaN(n)) nums.push(n);
    }
    return nums.length ? Math.max.apply(null, nums) : (p + 5);
  },
  parseCards: function(html) {
    var items = [];
    var seen = {};
    var blocks = html.split('<div class="video-thumb"');
    for (var i = 1; i < blocks.length; i++) {
      var block = blocks[i];
      var hrefMatch = block.match(/href="(https?:\/\/hellporno\.com\/videos\/([^"]+))"/);
      if (!hrefMatch) continue;
      var videoUrl = hrefMatch[1];
      var slug = hrefMatch[2].replace(/\/$/, '');
      var id = slug;
      if (seen[id]) continue;
      seen[id] = true;

      var thumbMatch = block.match(/poster="([^"]+\.jpg[^"]*)"/) ||
                       block.match(/data-src="([^"]+)"/) ||
                       block.match(/src="([^"]+img\d+-hp\.hellcdn[^"]+)"/) ||
                       block.match(/src="([^"]+\.jpg[^"]*)"/);
      var thumb = thumbMatch ? thumbMatch[1] : '';

      var titleMatch = block.match(/<a[^>]*class="title"[^>]*>([^<]+)/) ||
                       block.match(/<div[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/div>/) ||
                       block.match(/title="([^"]+)"/);
      var title = titleMatch ? stripTags(titleMatch[1]) : slug.replace(/-/g, ' ');

      var durMatch = block.match(/<span[^>]*class="[^"]*time[^"]*"[^>]*>([^<]+)/) ||
                     block.match(/<span[^>]*class="[^"]*duration[^"]*"[^>]*>([^<]+)/) ||
                     block.match(/([\d]+:[\d]{2})/);
      var duration = durMatch ? parseDur(durMatch[1].trim()) : 0;

      items.push({
        id: 'hp-' + id,
        source: 'hellporno',
        title: title,
        thumb: thumb,
        url: videoUrl,
        duration: duration,
        views: 0
      });
    }
    return items;
  },
  getStream: function(video) {
    return cherryFetch(video.url).then(function(html) {
      var quality = {};
      var url = '';
      var m;

      var chsM = html.match(/var\s+chs_object\s*=\s*(\{[\s\S]+?\});/);
      if (chsM) {
        try {
          var chs = JSON.parse(chsM[1]);
          var playerUrl = chs.urlPlayer || chs.url_player || '';
          if (playerUrl && playerUrl.indexOf('http') === 0) {
            if (/\.mp4/.test(playerUrl)) {
              return { url: playerUrl, quality: {} };
            }
            return cherryFetch(playerUrl).then(function(ihtml) {
              var iResult = extractStreams(ihtml);
              return iResult.url ? iResult : extractStreams(html);
            }).catch(function() { return extractStreams(html); });
          }
        } catch (e) {}
      }

      var srcRe = /<source\s([^>]+)>/gi;
      while ((m = srcRe.exec(html)) !== null) {
        var attrs = m[1];
        if (!/type="video\/mp4"/i.test(attrs)) continue;
        var srcM = /src="([^"]+)"/.exec(attrs);
        if (!srcM) continue;
        var labelM = /(?:res|label|title)="([^"]+)"/.exec(attrs);
        var lbl = labelM ? labelM[1] : (_kvsPickBest([srcM[1]]).quality['default'] ? 'default' : 'mp4');
        quality[lbl] = srcM[1];
        if (!url) url = srcM[1];
      }

      if (!url && !Object.keys(quality).length) {
        return extractStreams(html);
      }

      if (Object.keys(quality).length) {
        var best = Object.keys(quality).reduce(function(a, b) {
          return (parseInt(a, 10) || 0) >= (parseInt(b, 10) || 0) ? a : b;
        });
        url = quality[best];
      }

      return { url: url, quality: quality };
    }).catch(function() { return { url: '', quality: {} }; });
  }
}));

// ---- 16. Pornobolt ----
SOURCES.push(_kvsEngine({
    id: 'pornobolt',
    name: 'Pornobolt',
    host: 'sex.pornobolt.in',
    categoryFmt: 'https://sex.pornobolt.in/{slug}/{page}',
    catPageBase: 1, catPage1Omit: true, sortParam: 'sort',
    categories: _cats('anal:Анал,milf:Милфа,granny:Бабушки,big-ass:Большая жопа,china:Китайское,japan:Японское,indian:Индийское,arab:Арабское,shkola:Школа,otchim:Отчим,izmena:Измена,cuckold:Куколд,incest:Инцест,zrelye:Зрелые,pickup:Пикап,kasting:Кастинг,molodenkie:Молоденькие,lyubitelskoe:Любительское,gruppovuha:Групповуха,aziatki:Азиатки,latinki:Латинки,russkoe-porno:Русские'),
    sorts: [{id:'mv',label:'Популярное'},{id:'mc',label:'Обсуждаемое'}],
    searchUrl: function(query) {
        return 'https://sex.pornobolt.in/search/' + encodeURIComponent(query);
    },
    browseUrl: function(page) {
        return page > 1
            ? 'https://sex.pornobolt.in/' + page + '?sort=mv'
            : 'https://sex.pornobolt.in/?sort=mv';
    },
    searchTotalPages: 1,
    hrefRxSrc: 'href="((?:https?://sex\\.pornobolt\\.in)?/video/([^/"]+)\\.html)"',
    idFromUrl: function(url, m) { return m[2]; },
    normalizeUrl: function(rawUrl) {
        return rawUrl.charAt(0) === '/' ? 'https://sex.pornobolt.in' + rawUrl : rawUrl;
    },
    chunkWindow: { before: 800, after: 600 },
    thumbRx: [
        /(?:data-src|src)="(https?:\/\/pbcdn\.tv\/pornobolt-kartinki\/huge-[^"]+\.jpe?g)"/i
    ],
    thumbFallback: function(id) {
        return 'https://pbcdn.tv/pornobolt-kartinki/huge-' + id + '.jpg';
    },
    titleRx: [
        /<(?:h\d|div)[^>]*class="[^"]*(?:title|name)[^"]*"[^>]*>([^<]+)<\//,
        /title="([^"]+)"/,
        /alt="([^"]+)"/
    ],
    pagesRx: function(html) {
        var m = /["']\/(\d+)\?sort["'][^>]*(?:last|>>)/i.exec(html) ||
                /["']\/(\d+)["'][^>]*(?:last|>>)/i.exec(html);
        return m ? (parseInt(m[1], 10) || 10) : 10;
    },
    getStream: function(video) {
        return cherryFetch(video.url).then(function(html) {
            var pjRx = /Playerjs\s*\(\s*\{[^}]*?file\s*:\s*["']([^"']+)["']/i;
            var pm = pjRx.exec(html);
            if (pm) {
                var filePath = pm[1];
                var fileUrl = filePath.charAt(0) === '/' ? 'https://sex.pornobolt.in' + filePath : filePath;
                return { url: fileUrl, quality: {} };
            }
            var cdnRx = /['"]?(https?:\/\/pbcdn\.tv\/[^"'\s]+\.(?:mp4|m3u8))['"]/gi;
            var found = [], m;
            while ((m = cdnRx.exec(html)) !== null) {
                if (found.indexOf(m[1]) === -1) found.push(m[1]);
            }
            if (found.length) return _kvsPickBest(found);
            return extractStreams(html);
        }).catch(function() { return { url: '', quality: {} }; });
    }
}));

// ---- 8. CrocoTube ----
SOURCES.push(_kvsEngine({
    id: 'crocotube',
    name: 'CrocoTube',
    host: 'crocotube.com',
    categoryFmt: 'https://crocotube.com/categories/{slug}/{page}/',
    catPageBase: 1, catPage1Omit: true,
    categories: _cats('amateur:Любительское,anal:Анал,arab:Арабское,asian:Азиатки,ass:Жопа,babes:Красотки,bbw:BBW,big-ass:Большая жопа,big-black-cock:Большой чёрный член,big-cock:Большой член,big-tits:Большие сиськи,hairy:Волосатые,natural-tits:Натуральные сиськи,perfect-body:Идеальное тело'),
    sorts: [],
    searchUrl: function(query, page) {
        return page > 1
            ? 'https://crocotube.com/search/' + page + '/?q=' + encodeURIComponent(query)
            : 'https://crocotube.com/search/1/?q=' + encodeURIComponent(query);
    },
    browseUrl: function(page) {
        return 'https://crocotube.com/' + (page || 1) + '/';
    },
    hrefRxSrc: 'href="(https?://crocotube\\.com/videos/[^"]+)"',
    idFromUrl: function(url) {
        return url.replace(/^https?:\/\/[^/]+\/videos\//, '').replace(/[^a-z0-9]/gi, '_');
    },
    chunkWindow: { before: 0, after: 1000 },
    thumbRx: [
        /(?:data-src|src)="(https?:\/\/img\d*-ct\.alphaxcdn\.com\/[^"]+)"/i,
        /(?:data-src|src)="([^"]+\.jpe?g)"/i
    ],
    titleRx: [
        /title="([^"]+)"/,
        /alt="([^"]+)"/,
        /<h\d[^>]*>([^<]+)<\/h\d>/
    ],
    pagesRx: function(html) {
        var m = /\/search\/(\d+)\/?["'][^>]*(?:last|>>)/i.exec(html) ||
                /\/(\d+)\/["'][^>]*(?:last|>>)/i.exec(html);
        return m ? (parseInt(m[1], 10) || 10) : 10;
    },
    getStream: function(video) {
        return cherryFetch(video.url).then(function(html) {
            var cdnRx = /['"]?(https?:\/\/cdn[^"'\s]*alphaxcdn\.com\/[^"'\s]+\.(?:mp4|m3u8))['"]/gi;
            var found = [], m;
            while ((m = cdnRx.exec(html)) !== null) {
                if (found.indexOf(m[1]) === -1) found.push(m[1]);
            }
            if (found.length) return _kvsPickBest(found);
            return extractStreams(html);
        }).catch(function() { return { url: '', quality: {} }; });
    }
}));

// ---- 9. Huyamba — DISABLED (fuq.huyamba.mobi returns 404, site dead as of 2026-06) ----
// SOURCES.push({
//     id: 'huyamba',
//     name: 'Huyamba',
//     host: 'fuq.huyamba.mobi',
//
//     search: function (query, page) {
//         var url = 'https://fuq.huyamba.mobi/search/' + encodeURIComponent(query) + '/';
//         return cherryFetch(url).then(function (html) {
//             return { items: _huyambaCards(html), total_pages: 1 };
//         }).catch(function () { return { items: [], total_pages: 0 }; });
//     },

//     browse: function (category, page) {
//         var url = 'https://fuq.huyamba.mobi/videos/?by=post_date&page=' + page;
//         return cherryFetch(url).then(function (html) {
//             return { items: _huyambaCards(html), total_pages: _huyambaPages(html) };
//         }).catch(function () { return { items: [], total_pages: 0 }; });
//     },
//
//     getStream: function (video) {
//         return cherryFetch(video.url).then(function (html) {
//             return extractStreams(html);
//         }).catch(function () { return { url: '', quality: {} }; });
//     }
// });

function _huyambaCards(html) {
    var items = [];
    var hrefRx = /href="(https?:\/\/fuq\.huyamba\.mobi\/video\/(\d+)\/)"/g;
    var seen = {};
    var m;
    while ((m = hrefRx.exec(html)) !== null) {
        var videoUrl = m[1];
        var id = m[2];
        if (seen[id]) continue;
        seen[id] = true;

        // Forward-only: title is in title="" on the <a> tag, thumb in data-original
        var chunk = html.slice(m.index, m.index + 1000);

        var thumb = _attr(chunk, /(?:data-original|data-webp|data-src|src)="([^"?#]+\.jpe?g)/i) ||
                    _attr(chunk, /(?:data-original|data-src|src)="([^"?#]+\.(?:webp|png))/i);

        var title = _decodeHtml(
            _attr(chunk, /title="([^"]+)"/) ||
            _attr(chunk, /alt="([^"]+)"/) ||
            _attr(chunk, /<h\d[^>]*>([^<]+)<\/h\d>/)
        );

        var duration = parseDur(_attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</));
        var views    = parseViews(_attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));

        if (title || thumb) {
            items.push({ id: id, source: 'huyamba', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views });
        }
    }
    return items;
}

function _huyambaPages(html) {
    var m = /[?&]page=(\d+)["'][^>]*(?:last|>>)/i.exec(html);
    return m ? (parseInt(m[1], 10) || 10) : 10;
}

// VePorn removed — veporn.net returns 504 (site dead)

// ---- 11. Ebun ----
SOURCES.push({
    id: 'ebun',
    name: 'Ebun',
    host: 'www1.ebun.tv',
    cfg: { categories: _cats('molodye:Молодые,amerikanskoe:Американское,bryunetki:Брюнетки,russkoe:Русское,krasivye-devushki:Красивые девушки,domashnee:Домашнее,anal:Анал,hudye:Худые,blondinki:Блондинки,chulki-i-kolgotki:Чулки,ot-pervogo-lica:От первого лица,bolshie-siski:Большие сиськи,seks-vtroem:Втроём,bolshie-chleny:Большие члены,jopy:Жопы,studenty:Студенты,minet:Минет,kasting:Кастинг,gruppovoe:Групповое,zrelye:Зрелые,negry:Негры,mejrassovoe:Межрассовое,jmj:ЖМЖ,mjm:МЖМ,zheny:Жёны'), sorts: [] },

    search: function (query, page) {
        var url = 'https://www1.ebun.tv/search/?q=' + encodeURIComponent(query) + '&page=' + page;
        return cherryFetch(url).then(function (html) {
            return { items: _ebunCards(html), total_pages: _ebunPages(html) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    browse: function (category, page) {
        var p = page || 1;
        var url = category
            ? _buildCatUrl('https://www1.ebun.tv/categories/{slug}/{page}/', category, p, 1, true)
            : 'https://www1.ebun.tv/latest-updates/?page=' + p;
        return cherryFetch(url).then(function (html) {
            return { items: _ebunCards(html), total_pages: _ebunPages(html) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getStream: function (video) {
        return cherryFetch(video.url).then(function (html) {
            var iframeM = /src="(https?:\/\/666-emded\.com\/embed\/[^"]+)"/i.exec(html);
            if (iframeM) {
                return cherryFetch(iframeM[1]).then(function (ihtml) {
                    var result = extractStreams(ihtml);
                    if (result.url || Object.keys(result.quality).length) {
                        var qKeys = Object.keys(result.quality);
                        var best  = qKeys.length ? bestQualityUrl(result.quality) : result.url;
                        return { url: best, quality: result.quality };
                    }
                    return { url: '', quality: {} };
                }).catch(function () { return { url: '', quality: {} }; });
            }
            return extractStreams(html);
        }).catch(function () { return { url: '', quality: {} }; });
    }
});

function _ebunCards(html) {
    var items = [];
    var hrefRx = /href="(https?:\/\/www1\.ebun\.tv\/videos\/(\d+)\/)"/g;
    var seen = {};
    var m;
    while ((m = hrefRx.exec(html)) !== null) {
        var videoUrl = m[1];
        var id = m[2];
        if (seen[id]) continue;
        seen[id] = true;

        // Look only FORWARD from href — title in alt="" and data-src in img after the href
        var chunk = html.slice(m.index, m.index + 900);

        var thumb = _attr(chunk, /(?:data-src|src)="([^"]+\.jpe?g)"/i) ||
                    _attr(chunk, /(?:data-src|src)="([^"]+\.(?:webp|png))"/i);

        var title = _decodeHtml(
            _attr(chunk, /<div[^>]*class="[^"]*item-title[^"]*"[^>]*>([^<]+)<\/div>/) ||
            _attr(chunk, /alt="([^"]+)"/) ||
            _attr(chunk, /title="([^"]+)"/)
        );

        var duration = parseDur(_attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</));
        var views    = parseViews(_attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));

        if (title || thumb) {
            items.push({ id: id, source: 'ebun', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views });
        }
    }
    return items;
}

function _ebunPages(html) {
    var m = /[?&]page=(\d+)["'][^>]*(?:last|>>)/i.exec(html);
    return m ? (parseInt(m[1], 10) || 10) : 10;
}

// ---- 12. LenPorno ----
SOURCES.push({
    id: 'lenporno',
    name: 'LenPorno',
    host: 'www.lenporno.net',
    cfg: { categories: _cats('aziatskoye:Азиатское,analnoye:Анальное,bdsm:БДСМ,blondinki:Блондинки,bolshiye-dojki:Большие дойки,bolshiye-popki:Большие попки,bolshiye-chleny:Большие члены,bryunetki:Брюнетки,v-chulkakh:В чулках,volosatyye:Волосатые,gruppovoye:Групповое,domashneye:Домашнее,zhestkoye:Жёсткое,zrelyye:Зрелые,izmena:Измена,kasting:Кастинг,krasotki:Красотки,lesbiyanki:Лесбиянки,mamki:Мамки,massazh:Массаж,minet:Минет,molodyye:Молодые,blacked:Негры,orgazmy:Оргазмы,ot-pervogo-litsa:От первого лица,russkoye:Русское,studenty:Студенты,yaponskoye:Японское'), sorts: [] },

    search: function (query, page) {
        var url = 'https://www.lenporno.net/search/?q=' + encodeURIComponent(query);
        return cherryFetch(url).then(function (html) {
            return { items: _lenpornoCards(html), total_pages: 1 };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    browse: function (category, page) {
        var p = page || 1;
        if (category) {
            var curl = _buildCatUrl('https://www.lenporno.net/{slug}/{page}/', category, p, 1, true);
            return cherryFetch(curl).then(function (html) {
                return { items: _lenpornoCards(html), total_pages: _lenpornoPages(html) };
            }).catch(function () { return { items: [], total_pages: 0 }; });
        }
        var url = page > 1
            ? 'https://www.lenporno.net/the-best/?page=' + page
            : 'https://www.lenporno.net/the-best/';
        return cherryFetch(url).then(function (html) {
            return { items: _lenpornoCards(html), total_pages: _lenpornoPages(html) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getStream: function (video) {
        return cherryFetch(video.url).then(function (html) {
            // PlayerJS multi-quality format: [label1]url1.mp4,[label2]url2.mp4
            // or unlabeled first: url1.mp4,[label2]url2.mp4
            var fileM = /(?:file|src)\s*[:=]\s*['"]([^'"]*cdnv365[^'"]+\.mp4[^'"]*)['"]/i.exec(html) ||
                        /Playerjs\s*\([^)]*file\s*:\s*['"]([^'"]+\.mp4[^'"]*)['"]/i.exec(html);
            if (fileM) {
                var pjStr = fileM[1];
                var quality = {};
                var best = '';
                var pjRe = /(?:\[([^\]]+)\])?(https?:\/\/[^,\[\]<>\s"']+\.mp4)/gi;
                var m;
                while ((m = pjRe.exec(pjStr)) !== null) {
                    var lbl = m[1] ? m[1].trim() : null;
                    if (lbl && /^\d{3,4}p?$/i.test(lbl)) {
                        quality[lbl] = m[2];
                        if (!best) best = m[2];
                    } else {
                        if (!best) best = m[2];
                    }
                }
                if (best) return { url: bestQualityUrl(quality) || best, quality: quality };
            }
            return extractStreams(html);
        }).catch(function () { return { url: '', quality: {} }; });
    }
});

function _lenpornoCards(html) {
    var items = [];
    var hrefRx = /href="(https?:\/\/(?:xxx\.lenporno\.xyz|www\.lenporno\.net)\/video\/([^/"?]+))"/g;
    var seen = {};
    var m;
    while ((m = hrefRx.exec(html)) !== null) {
        var videoUrl = m[1];
        var slug = m[2];
        if (!slug || seen[slug]) continue;
        seen[slug] = true;

        var chunk = html.slice(Math.max(0, m.index - 800), m.index + 600);

        var thumb = _attr(chunk, /(?:data-src|src)="([^"]+\.jpe?g)"/i) ||
                    _attr(chunk, /(?:data-src|src)="([^"]+\.(?:webp|png))"/i);

        var title = _decodeHtml(
            _attr(chunk, /<(?:h\d|div)[^>]*class="[^"]*(?:title|name)[^"]*"[^>]*>([^<]+)<\//) ||
            _attr(chunk, /title="([^"]+)"/) ||
            _attr(chunk, /alt="([^"]+)"/)
        );

        var duration = parseDur(_attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</));
        var views    = parseViews(_attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));

        if (title || thumb) {
            items.push({ id: slug, source: 'lenporno', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views });
        }
    }
    return items;
}

function _lenpornoPages(html) {
    var m = /[?&]page=(\d+)["'][^>]*(?:last|>>|&raquo;)/i.exec(html);
    return m ? (parseInt(m[1], 10) || 10) : 10;
}

// ---- 13. 24Rolika / Huyalkino ----
SOURCES.push({
    id: '24rolika',
    name: '24Rolika',
    host: 'w2.huyalkino.com',
    cfg: { categories: _cats('russian:С русской озвучкой,russia:Русское порно,gopa:Анал,retro:Ретро,asian-girl:Азиатки,bdsm:БДСМ,big-cock:Большие члены,big-tits:Большие сиськи,group:Групповуха,lesbi:Лесбиянки,teen:Молодые,solo:Мастурбация,beautiful:Красивый секс,black:Межрасовое,homemade:Домашнее,incest:Инцест,orgasms:Оргазмы'), sorts: [] },

    search: function (query, page) {
        // DLE search does not paginate natively — page param is advisory
        var url = 'https://w2.huyalkino.com/index.php?do=search&subaction=search&story=' + encodeURIComponent(query);
        return cherryFetch(url).then(function (html) {
            return { items: _rolikaCards(html), total_pages: 1 };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    browse: function (category, page) {
        var p = page || 1;
        var url = category
            ? _buildCatUrl('https://w2.huyalkino.com/{slug}/page/{page}/', category, p, 1, true)
            : (p > 1 ? 'https://w2.huyalkino.com/page/' + p + '/' : 'https://w2.huyalkino.com/');
        return cherryFetch(url).then(function (html) {
            return { items: _rolikaCards(html), total_pages: _rolikaPages(html) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getStream: function (video) {
        return cherryFetch(video.url).then(function (html) {
            var m;
            // Playerjs (DLE plugin): new Playerjs({file:"url"})
            m = /Playerjs\s*\(\s*\{[^{}]*['"]?file['"]?\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))['"]/i.exec(html);
            if (m) return { url: buildProxyUrl(m[1], 'https://w2.huyalkino.com/'), quality: {} };
            // JWPlayer fallback
            m = /jwplayer\s*\([^)]*\)\s*\.setup\s*\(\s*\{[\s\S]{0,500}?['"]?file['"]?\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))['"]/i.exec(html);
            if (m) return { url: buildProxyUrl(m[1], 'https://w2.huyalkino.com/'), quality: {} };
            return extractStreams(html);
        }).catch(function () { return { url: '', quality: {} }; });
    }
});

function _rolikaCards(html) {
    var items = [];
    var hrefRx = /href="((?:https?:\/\/w2\.huyalkino\.com)?\/[a-z0-9][a-z0-9\-]*\/\d+[^"]+\.html)"/g;
    var seen = {};
    var m;
    while ((m = hrefRx.exec(html)) !== null) {
        var videoUrl = m[1].charAt(0) === '/' ? 'https://w2.huyalkino.com' + m[1] : m[1];
        // DLE URL: /{category}/{id}-{slug}.html
        var idMatch = /\/(\d+)-[^/]+\.html/.exec(videoUrl);
        var id = idMatch ? idMatch[1] : videoUrl;
        if (seen[id]) continue;
        seen[id] = true;

        // Look FORWARD from href — DLE cards: img inside the <a>, title in <a class="th-title"> after
        var chunk = html.slice(m.index, m.index + 900);

        // DLE/KVS thumb: relative /uploads/posts/... URLs (may have no extension or .webp)
        var thumb = _attr(chunk, /(?:data-original|data-src|src)="([^"?#]*\/uploads\/posts\/\d{4}-\d{2}\/[^"?#]+)/i) ||
                    _attr(chunk, /(?:data-original|data-src|src)="([^"?#]+\.(?:jpe?g|webp))/i);
        if (thumb && thumb.charAt(0) === '/') thumb = 'https://w2.huyalkino.com' + thumb;

        var title = _decodeHtml(
            _attr(chunk, /<a[^>]*class="[^"]*th-title[^"]*"[^>]*>([^<]+)<\/a>/) ||
            _attr(chunk, /<h2[^>]*>([^<]+)<\/h2>/) ||
            _attr(chunk, /title="([^"]+)"/) ||
            _attr(chunk, /alt="([^"]+)"/)
        );

        var duration = parseDur(_attr(chunk, /class="[^"]*(?:duration|time|th-time)[^"]*"[^>]*>([^<]+)</));
        var views    = parseViews(_attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));

        if (title || thumb) {
            items.push({ id: id, source: '24rolika', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views });
        }
    }
    return items;
}

function _rolikaPages(html) {
    var m = /\/page\/(\d+)\/["'][^>]*(?:last|>>)/i.exec(html);
    return m ? (parseInt(m[1], 10) || 10) : 10;
}

// ---- 14. JopaOnline ----
SOURCES.push({
    id: 'jopaonline',
    name: 'JopaOnline',
    host: 'jopaonline.mobi',
    cfg: { categories: _cats('mamki:Мамки,russkoe:Русское,zhestkoe:Жёсткое,zrelye:Зрелые,izmena:Измена,krasotki:Красотки,domashnee:Домашнее,big-cock:Большие члены,gruppovoe:Групповое,anal:Анал,asian:Азиатки,studenty:Студенты'), sorts: [] },

    search: function (query, page) {
        var url = 'https://jopaonline.mobi/?do=search&subaction=search&story=' + encodeURIComponent(query);
        return cherryFetch(url).then(function (html) {
            return { items: _jopaCards(html), total_pages: 1 };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    browse: function (category, page) {
        var p = page || 1;
        // category → /categories/{slug}/{n} (no trailing slash); else home pagination /{n}.
        var url = category
            ? _buildCatUrl('https://jopaonline.mobi/categories/{slug}/{page}', category, p, 1, true)
            : (p > 1 ? 'https://jopaonline.mobi/' + p : 'https://jopaonline.mobi/');
        return cherryFetch(url).then(function (html) {
            return { items: _jopaCards(html), total_pages: _jopaPages(html) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getStream: function (video) {
        return cherryFetch(video.url).then(function (html) {
            // Playerjs multi-quality: new Playerjs({file:'[360p]url,[720p]url,...'})
            var pjRx = /new\s+Playerjs\s*\(\s*\{[^}]*?file\s*:\s*['"]([^'"]+)['"]/i;
            var pm = pjRx.exec(html);
            if (pm) {
                var fileStr = pm[1];
                var quality = {}, best = '';
                var qRx = /\[([^\]]+)\](https?:\/\/[^,\s'"[\]]+)/g;
                var qm;
                while ((qm = qRx.exec(fileStr)) !== null) {
                    quality[qm[1]] = qm[2];
                    best = qm[2];
                }
                if (best) return { url: best, quality: quality };
                if (/^https?:/.test(fileStr)) return { url: fileStr, quality: {} };
            }
            // DLE JWPlayer pattern
            var jwRx = /jwplayer\s*\(\s*['"]?\w+['"]?\s*\)\s*\.setup\s*\(\s*\{[\s\S]*?['"]?file['"]?\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))['"]/;
            var m = jwRx.exec(html);
            if (m) return { url: m[1], quality: {} };
            return extractStreams(html);
        }).catch(function () { return { url: '', quality: {} }; });
    }
});

function _jopaCards(html) {
    var items = [];
    var hrefRx = /href="(https?:\/\/jopaonline\.mobi\/porno-video\/(\d+))"/g;
    var seen = {};
    var m;
    while ((m = hrefRx.exec(html)) !== null) {
        var videoUrl = m[1];
        var id = m[2];
        if (seen[id]) continue;
        seen[id] = true;

        var chunk = html.slice(m.index, m.index + 900);

        var thumb = _attr(chunk, /(?:data-original|data-src|src)="([^"?#]+\/uploads\/posts\/\d{4}-\d{2}\/[^"?#]+)/i) ||
                    _attr(chunk, /(?:data-original|data-src|src)="([^"?#]+\.jpe?g)/i);

        var title = _decodeHtml(
            _attr(chunk, /title="([^"]+)"/) ||
            _attr(chunk, /alt="([^"]+)"/) ||
            _attr(chunk, /<h2[^>]*>\s*([^<]+)/) ||
            _attr(chunk, /<h\d[^>]*>\s*([^<]+)/)
        );

        var duration = parseDur(_attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</));
        var views    = parseViews(_attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));

        if (title || thumb) {
            items.push({ id: id, source: 'jopaonline', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views });
        }
    }
    return items;
}

function _jopaPages(html) {
    var m = /href="https?:\/\/jopaonline\.mobi\/(\d+)"[^>]*(?:last|>>)/i.exec(html) ||
            /["']\/(\d+)["'][^>]*(?:last|>>)/i.exec(html);
    return m ? (parseInt(m[1], 10) || 10) : 10;
}

})();
