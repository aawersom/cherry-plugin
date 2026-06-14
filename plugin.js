(function () {
  'use strict';

  if (window.plugin_cherry_ready) return;
  window.plugin_cherry_ready = true;

  // ============================================================
  // CONFIG — user sets these after deploying their proxy
  // ============================================================
  var PROXY_URL = 'https://cherry-proxy.aawersom.workers.dev';
  // Secondary proxy on a self-hosted VPS (stable IP, unmetered bandwidth) — replaces
  // Deno Deploy (free egress quota kept dying on video streaming). Runs the Deno proxy
  // script via systemd behind Caddy/TLS (sslip.io). Used for sites that block CF
  // datacenter IPs + KVS sites whose CDN tokens are IP-bound (need one stable egress IP).
  var PROXY_URL_2 = 'https://185-36-141-21.sslip.io';
  // Tertiary proxy — VPS with rotating residential IPs (set to '' if not deployed)
  // Deploy workers/cherry-proxy-vps/index.js on Beget VPS, then fill in your IP:PORT
  var PROXY_URL_3 = '';
  // Val.town free HTTP val (workers/cherry-proxy-valtown/main.ts) — its egress IP passes
  // Cloudflare's bot-challenge (like Deno did) where the VPS/CF datacenter IPs get a
  // "Just a moment" 403. Used ONLY for spankbang's light LISTING (KB) — keeps usage far
  // under the free tier; spankbang video stays off it (and is broken anyway / needs a browser).
  var PROXY_URL_VT = 'https://aawersom--0d56e6a4635611f1a1321607ee4eb77e.web.val.run';
  var PROXY_URL_VT_HOSTS = {
    'ru.spankbang.com': 1, 'spankbang.com': 1, 'www.spankbang.com': 1
  };

  var PROXY_URL_2_HOSTS = {
    // xnxx: CF Worker IPs blocked at ASN level; Deno works
    'xnxx.com': 1, 'www.xnxx.com': 1,
    // youjizz: rate-limits CF datacenter IPs (page + all *.youjizz.com CDN via regex below)
    'www.youjizz.com': 1, 'youjizz.com': 1,
    // hqporner: CF datacenter IPs are intermittently blocked (catalog drops to 0).
    // Streams are on mydaddy.cc / *.bigcdn.cc (both already → VPS), so page+stream
    // co-locate on the VPS egress IP.
    'hqporner.com': 1, 'www.hqporner.com': 1,
    // tizam.org: rate-limits rapid sequential CF datacenter requests
    'tv4.tizam.org': 1,
    // pornone/porntrex: Deno — KVS IP-bound tokens require page+CDN on same fixed IP
    'pornone.com': 1, 'www.pornone.com': 1,
    'porntrex.com': 1, 'www.porntrex.com': 1,
    // eporner: SOCKS5 instability — revert to Deno
    'www.eporner.com': 1,
    // spankbang: now routed to Val.town (PROXY_URL_VT) — the VPS datacenter IP gets
    // Cloudflare's "Just a moment" 403; Val.town's IP passes it. (Was here on Deno.)
    // mydaddy.cc: bigcdn tokens IP-bound to mydaddy.cc fetch IP — must use same proxy as bigcdn
    'mydaddy.cc': 1,
    // bigcdn.cc all subdomains covered by /\.bigcdn\.cc$/ regex in buildProxyUrl
    // perfektdamen KVS CDN — IP-bound tokens require consistent egress IP
    'www.perfektdamen.co': 1
    // NB: hellporno stays on CF (Deno returns 0 cards for it even when up; CF gives 60).
    // hqporner is blocked on CF datacenter IPs and Deno doesn't help — it needs a
    // residential route (PROXY_URL_3). Neither is routed to Deno.
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
  function buildProxyUrl(url, referer, forceCF) {
    var key = getProxyKey();
    var base = PROXY_URL;
    // forceCF: failover path — ignore secondary routing, go straight to the CF worker.
    if (!forceCF) {
      if (PROXY_URL_VT) {
        try { if (PROXY_URL_VT_HOSTS[new URL(url).hostname]) base = PROXY_URL_VT; } catch (e) {}
      }
      if (base === PROXY_URL && PROXY_URL_3) {
        try { if (PROXY_URL_3_HOSTS[new URL(url).hostname]) base = PROXY_URL_3; } catch (e) {}
      }
      if (base === PROXY_URL && PROXY_URL_2) {
        try {
          var h = new URL(url).hostname;
          // Registered-domain regexes co-locate a site's page + its stream-CDN
          // subdomains on the same VPS egress IP. KVS/CDN tokens are IP-bound: if the
          // page is fetched from the VPS but the stream CDN goes via CF (different IP),
          // the token mismatches → 410/buffering. youjizz streams on *.youjizz.com
          // (e.g. cdne-mobile.youjizz.com); porntrex streams on *.cdntrex.com.
          if (PROXY_URL_2_HOSTS[h] || /\.bigcdn\.cc$/.test(h) || /(?:^|\.)pornone\.com$/.test(h) ||
              /(?:^|\.)youjizz\.com$/.test(h) || /\.cdntrex\.com$/.test(h)) base = PROXY_URL_2;
        } catch (e) {}
      }
    }
    var p = base + '/proxy?url=' + encodeURIComponent(url);
    if (key)     p += '&key=' + encodeURIComponent(key);
    if (referer) p += '&referer=' + encodeURIComponent(referer);
    return p;
  }

  // True when this URL is routed to a SECONDARY proxy (Deno/VPS), so a failover to
  // the primary CF worker is meaningful (e.g. when Deno is over-quota / 503).
  function _hasProxyFailover(url, referer) {
    return buildProxyUrl(url, referer) !== buildProxyUrl(url, referer, true);
  }

  // Hosts that block the device's home IP (so on Android the native device-IP fetch
  // returns empty/challenge) AND whose stream co-locates with the page proxy — so we
  // can safely force BOTH page and stream through the proxy on Android without an
  // IP-affinity mismatch. hqporner → VPS (its bigcdn stream is already VPS-routed);
  // hellporno → CF (page + get_file stream share the same host). NOT general: sites
  // whose CDN lives on a separate unrouted domain (xnxx-cdn, youjizz CDN) must stay
  // native device-IP for page+stream, so they are deliberately excluded.
  var _ANDROID_FORCE_PROXY = {
    'hqporner.com': 1, 'www.hqporner.com': 1,
    'hellporno.com': 1, 'www.hellporno.com': 1,
    // lenporno + eporner: the device-IP native fetch of the PAGE gets redirected/blocked
    // (lenporno → mirror redirect, 0 cards; eporner → 369-byte block, no stream hash), but
    // the page loads via the proxy. Only the page host is forced — their stream CDNs
    // (cdnv365 / eporner CDN) are on separate hosts → stay raw device-IP (signed-token,
    // not IP-bound) so playback still works.
    'www.lenporno.net': 1, 'lenporno.net': 1,
    'www.eporner.com': 1, 'eporner.com': 1,
    // spankbang: Cloudflare challenges the device home IP too → force the page through
    // the proxy (routes to Val.town via PROXY_URL_VT, which passes the challenge).
    'ru.spankbang.com': 1, 'spankbang.com': 1, 'www.spankbang.com': 1,
    // porntrex: the device native fetch returns a degraded page (empty card titles → Lampa
    // shows the "add to favorites" fallback) and the KVS get_file stream token is bound to
    // that device IP → no playback. Browser (proxy→VPS) works. porntrex's get_file stream is
    // on the SAME host (www.porntrex.com), so forcing the page → VPS co-locates page+stream
    // on one IP, matching the working browser path.
    'www.porntrex.com': 1, 'porntrex.com': 1,
    // pornhub: HLS-only (get_media MP4 returns empty) + IP-bound (the m3u8 carries ipa=1).
    // The page, the m3u8 manifest, and the .ts segments MUST all exit from ONE proxy IP,
    // and the CF worker's rewriteM3u8 (workers/cherry-proxy) adds CORS + keeps segment IP
    // affinity — required so Cherry's inner/built-in player can actually play the stream
    // (raw phncdn m3u8 → native picks external chooser; inner hls.js → CORS fail). The page
    // hosts are exact-matched here; the *.phncdn.com stream CDN is matched by suffix below.
    'www.pornhub.com': 1, 'pornhub.com': 1
  };
  function _forceProxyAndroid(url) {
    try {
      var h = new URL(url).hostname;
      if (_ANDROID_FORCE_PROXY[h]) return true;
      // pornhub: the video PAGE is served from rt.pornhub.com (not www), and the stream CDN
      // subdomains vary (em-h, im-h, ev-h, hm-h…) on *.phncdn.com. Suffix-match BOTH pornhub.com
      // and phncdn.com so the page + m3u8 + segments ALL route through the SAME proxy exit IP —
      // otherwise the page (device IP) and the proxied stream (proxy IP) disagree and the
      // ipa=1 IP-bound token fails (404/load error). Exact-match alone missed rt./*.phncdn.
      if (/(^|\.)(phncdn|pornhub)\.com$/.test(h)) return true;
    } catch (e) {}
    return false;
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
      // Sites that block the device home IP → fetch the page via the proxy (clean IP)
      // instead of native, so it co-locates with the (also proxied) stream.
      if (_forceProxyAndroid(url)) return _proxyText(url, referer);
      return _nativeFetch(url).catch(function() { return _proxyText(url, referer); });
    }
    return _proxyText(url, referer);
  }

  // Proxy GET → text, with one Deno→CF failover. If the URL routes to a secondary
  // proxy (Deno) and that fails (e.g. 503 over-quota), retry via the CF worker so a
  // dead secondary proxy doesn't take down its channels.
  function _proxyText(url, referer) {
    return fetch(buildProxyUrl(url, referer)).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).catch(function(err) {
      if (!_hasProxyFailover(url, referer)) throw err;
      return fetch(buildProxyUrl(url, referer, true)).then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      });
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
      return _nativeFetch(url).catch(function () { return _proxyTextAny(url, referer); });
    }
    return _proxyTextAny(url, referer);
  }

  // Status-tolerant proxy GET with the same Deno→CF failover as _proxyText.
  function _proxyTextAny(url, referer) {
    return fetch(buildProxyUrl(url, referer)).then(function (r) {
      if (r.ok) return r.text();
      if (_hasProxyFailover(url, referer)) return fetch(buildProxyUrl(url, referer, true)).then(function (r2) { return r2.text(); });
      return r.text();
    }).catch(function (err) {
      if (!_hasProxyFailover(url, referer)) throw err;
      return fetch(buildProxyUrl(url, referer, true)).then(function (r) { return r.text(); });
    });
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

  /**
   * POST a JSON body DIRECTLY to a worker-origin URL (NOT wrapped in /proxy?url=).
   * Used by Sync for `${PROXY_URL}/favs` — the worker is CORS-open (sends `*`),
   * so a plain fetch works on web/TV. On Android plain fetch may be blocked, so
   * fall back to Lampa.Reguest's native POST when available.
   * @param {string} url   absolute worker URL (already carries pin/key params)
   * @param {Object} obj   JSON-serialisable body
   * @returns {Promise<Object>}  parsed JSON response
   */
  function cherryPostJson(url, obj) {
    var payload = JSON.stringify(obj || {});
    if (_isAndroid() && window.Lampa && typeof window.Lampa.Reguest === 'function') {
      return new Promise(function (resolve, reject) {
        try {
          var req = new window.Lampa.Reguest();
          req.timeout(8000);
          req.native(url, function (data) {
            req.clear();
            try { resolve(typeof data === 'object' ? data : JSON.parse(data)); }
            catch (e) { reject(e); }
          }, function (err) {
            req.clear();
            reject(err);
          }, payload, { dataType: 'json', headers: { 'Content-Type': 'application/json' } });
        } catch (e) { reject(e); }
      });
    }
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
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
  var _pendingRelated    = [];   // non-empty marker that page-1 related exists
  var _relatedSrc        = null;
  var _relatedVideo      = null; // the video whose related grid we push on close

  // Watch-history state: the video currently in the player + its timeline hash.
  // On player progress/destroy we snapshot the native timeline into Hist so the
  // home «Продолжить» surface and on-card progress bars reflect the real position.
  var _histVideo = null;
  var _histHash  = null;

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
  // FAVORITES  (timestamped records + tombstones, for cross-device sync)
  // ============================================================
  // Storage key `cherry_favs` now holds an array of RECORDS:
  //   { id, source, title, thumb, url, duration, views, added, deleted }
  // A record is ACTIVE when added > deleted. Deleting keeps the record and
  // stamps `deleted` (a tombstone) so a later remote pull can't resurrect it
  // and so last-write-wins merges resolve deterministically across devices.
  // The PUBLIC API (all/has/toggle) keeps its old contract — callers
  // (_gridLoad is_favorites path, cardRender, onMenu) are unchanged.
  var Fav = {
    _key: 'cherry_favs',

    /**
     * Raw record array, migrating the legacy plain-item format on first read.
     * Legacy items lack `added`/`deleted`; wrap each as {added:1, deleted:0}.
     * added=1 ("old, low priority") loses to any real remote action's Date.now()
     * stamp, so a deletion made on another device wins after a sync.
     * @returns {Array}
     */
    _records: function () {
      var list = Lampa.Storage.get(this._key, []);
      if (!Array.isArray(list)) return [];
      var migrated = false;
      var recs = list.map(function (v) {
        if (v && typeof v.added === 'number' && typeof v.deleted === 'number') return v;
        migrated = true;
        return {
          id:       v.id,
          source:   v.source,
          title:    v.title    || '',
          thumb:    v.thumb    || '',
          url:      v.url      || '',
          duration: v.duration || 0,
          views:    v.views    || 0,
          added:    1,
          deleted:  0
        };
      });
      if (migrated) Lampa.Storage.set(this._key, recs);
      return recs;
    },

    /** @returns {VideoCard[]} ACTIVE records mapped to the card shape. */
    all: function () {
      return this._records()
        .filter(function (r) { return r.added > r.deleted; })
        .map(function (r) {
          return {
            id:       r.id,
            source:   r.source,
            title:    r.title    || '',
            thumb:    r.thumb    || '',
            url:      r.url      || '',
            duration: r.duration || 0,
            views:    r.views    || 0
          };
        });
    },

    /** @param {VideoCard} video @returns {boolean} active (added>deleted) check. */
    has: function (video) {
      return this._records().some(function (r) {
        return r.id === video.id && r.source === video.source && r.added > r.deleted;
      });
    },

    /**
     * Toggle favorite status.
     * @param {VideoCard} video
     * @returns {boolean} true if now active (added), false if removed (tombstoned)
     */
    toggle: function (video) {
      var list = this._records();
      var rec = null;
      list.forEach(function (r) {
        if (r.id === video.id && r.source === video.source) rec = r;
      });
      var now = Date.now();
      var active;
      if (rec && rec.added > rec.deleted) {
        // Currently active → tombstone (keep the record).
        rec.deleted = now;
        active = false;
      } else {
        // Absent or tombstoned → (re)activate + refresh fields.
        if (!rec) {
          rec = { id: video.id, source: video.source };
          list.unshift(rec);
        }
        rec.title    = video.title    || '';
        rec.thumb    = video.thumb    || '';
        rec.url      = video.url      || '';
        rec.duration = video.duration || 0;
        rec.views    = video.views    || 0;
        rec.added    = now;
        rec.deleted  = 0;
        active = true;
      }
      Lampa.Storage.set(this._key, list);
      try { Sync.schedule(); } catch (e) {}
      return active;
    },

    /**
     * Merge remote records into local by id@source, last-write-wins on the
     * newer of max(added,deleted). Persists the merged set.
     * @param {Array} remote
     */
    _merge: function (remote) {
      if (!Array.isArray(remote) || !remote.length) return;
      var local = this._records();
      var index = {};
      local.forEach(function (r) { index[r.id + '@' + r.source] = r; });
      remote.forEach(function (rr) {
        if (!rr || rr.id == null) return;
        var key = rr.id + '@' + rr.source;
        var cur = index[key];
        if (!cur) {
          local.push(rr);
          index[key] = rr;
          return;
        }
        var curT = Math.max(cur.added || 0, cur.deleted || 0);
        var remT = Math.max(rr.added || 0, rr.deleted || 0);
        if (remT >= curT) {
          // Remote is newer (or equal) → take its state.
          cur.title    = rr.title    || cur.title    || '';
          cur.thumb    = rr.thumb    || cur.thumb    || '';
          cur.url      = rr.url      || cur.url      || '';
          cur.duration = rr.duration || cur.duration || 0;
          cur.views    = rr.views    || cur.views    || 0;
          cur.added    = rr.added    || 0;
          cur.deleted  = rr.deleted  || 0;
        }
      });
      Lampa.Storage.set(this._key, local);
    }
  };

  // ============================================================
  // WATCH HISTORY  (Resume / «Продолжить» / progress bars)
  // ============================================================
  // Storage key `cherry_history` holds an array of RECORDS:
  //   { id, source, title, thumb, url, duration, position, ts }
  // Resume position itself is owned by Lampa's NATIVE timeline (see playVideo:
  // it passes timeline:Lampa.Timeline.view(hash) so Lampa auto-persists and
  // restores the scrubber). `Hist` is the SURFACE layer — it powers the home
  // «Продолжить» tile + grid and the on-card progress bar. We snapshot the
  // timeline's position/duration on player progress/destroy. Mirrors Fav's
  // record/migration robustness (legacy entries lacking ts are tolerated).
  var Hist = {
    _key: 'cherry_history',
    _cap: 100,

    /** Stable per-video key shared with the native timeline hash. */
    _hashKey: function (element) {
      return (element.source || '') + ':' + (element.id != null ? element.id : (element.url || ''));
    },

    /**
     * Raw record array. Tolerates legacy/partial shapes by defaulting fields;
     * drops entries without an id (unusable as a key).
     * @returns {Array}
     */
    _records: function () {
      var list = Lampa.Storage.get(this._key, []);
      if (!Array.isArray(list)) return [];
      return list.filter(function (r) {
        return r && r.id != null;
      }).map(function (r) {
        return {
          id:       r.id,
          source:   r.source   || '',
          title:    r.title    || '',
          thumb:    r.thumb    || '',
          url:      r.url      || '',
          duration: r.duration || 0,
          position: r.position || 0,
          ts:       r.ts       || 0
        };
      });
    },

    /**
     * Upsert a watch record (by source+id), stamping ts = now. Capped to _cap
     * most-recent entries so storage can't grow unbounded.
     * @param {VideoCard} element
     * @param {number} position  seconds watched
     * @param {number} duration  total seconds
     */
    mark: function (element, position, duration) {
      if (!element || element.id == null) return;
      var list = this._records();
      var key  = this._hashKey(element);
      var self = this;
      var rec  = null;
      list.forEach(function (r) { if (self._hashKey(r) === key) rec = r; });
      if (!rec) {
        rec = { id: element.id, source: element.source || '' };
        list.unshift(rec);
      }
      rec.title    = element.title || rec.title || '';
      rec.thumb    = element.thumb || rec.thumb || '';
      rec.url      = element.url   || rec.url   || '';
      rec.position = position || 0;
      if (duration) rec.duration = duration;
      else rec.duration = rec.duration || 0;
      rec.ts       = Date.now();
      // Keep newest first; cap.
      list.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
      if (list.length > this._cap) list = list.slice(0, this._cap);
      Lampa.Storage.set(this._key, list);
    },

    /** @returns {VideoCard[]} records sorted by ts desc (newest first). */
    all: function () {
      return this._records()
        .sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); })
        .slice(0, this._cap);
    },

    /** @param {VideoCard} element @returns {Object|null} the matching record. */
    get: function (element) {
      if (!element || element.id == null) return null;
      var key  = this._hashKey(element);
      var self = this;
      var hit  = null;
      this._records().forEach(function (r) { if (self._hashKey(r) === key) hit = r; });
      return hit;
    },

    /** @param {VideoCard} element @returns {number} 0..100 watched percent. */
    percent: function (element) {
      var r = this.get(element);
      if (!r || !r.duration) return 0;
      var p = Math.round((r.position / r.duration) * 100);
      if (p < 0) p = 0;
      if (p > 100) p = 100;
      return p;
    }
  };

  // ============================================================
  // SYNC  — PIN-based cross-device favorites sync via the CF Worker.
  // ============================================================
  // One POST to `${PROXY_URL}/favs?pin=<pin>&key=<proxyKey>` does pull+merge+push:
  // the worker merges the body's records with its stored bucket (last-write-wins)
  // and returns the merged set, which we merge locally too (idempotent / safe).
  // Local-first: any network failure leaves local favorites fully working.
  var Sync = {
    _running: false,
    _timer:   null,

    /**
     * @returns {string} the sync PIN. EMPTY by default → sync is OFF until the user
     * enters a PIN via the «Синхронизация» tile. No auto-sync, so favorites stay
     * purely local (untouched) unless the user opts in.
     */
    getPin: function () {
      return Lampa.Storage.get('cherry_sync_pin', '');
    },

    /** @param {string} p 4–12 digits. Persists + triggers a REPORTED run. */
    setPin: function (p) {
      p = ('' + (p || '')).trim();
      if (!/^[0-9]{4,12}$/.test(p)) return false;
      Lampa.Storage.set('cherry_sync_pin', p);
      this.run(true);   // report result to the user via Noty
      return true;
    },

    /** Debounced run — batches rapid toggles (~1500ms). */
    schedule: function () {
      var self = this;
      if (self._timer) clearTimeout(self._timer);
      self._timer = setTimeout(function () {
        self._timer = null;
        self.run();
      }, 1500);
    },

    /**
     * Pull+merge+push in one POST. Swallows network errors (stays local).
     * Guards against concurrent runs.
     */
    run: function (report) {
      var self = this;
      if (self._running) return Promise.resolve();
      var pin = self.getPin();
      if (!/^[0-9]{4,12}$/.test('' + pin)) {
        if (report) Lampa.Noty.show(Lampa.Lang.translate('cherry_sync') + ': PIN 4–12 цифр');
        return Promise.resolve();
      }
      self._running = true;
      var url = PROXY_URL + '/favs?pin=' + encodeURIComponent(pin) +
                '&key=' + encodeURIComponent(getProxyKey());
      var localCount = Fav._records().length;
      console.log('[Cherry] Sync.run: POST', url, '| local records =', localCount);
      return cherryPostJson(url, { records: Fav._records() })
        .then(function (res) {
          var got = (res && Array.isArray(res.records)) ? res.records.length : -1;
          console.log('[Cherry] Sync.run: server responded, records =', got);
          if (res && Array.isArray(res.records)) {
            Fav._merge(res.records);
            Sync._refreshGrid();
          }
          if (report) {
            var n = Fav.all().length;
            Lampa.Noty.show(Lampa.Lang.translate('cherry_sync_ok') + ' (' + n + ')');
          }
        })
        .catch(function (err) {
          console.warn('[Cherry] Sync.run FAILED:', err && err.message ? err.message : err);
          if (report) Lampa.Noty.show(Lampa.Lang.translate('cherry_sync_err'));
        })
        .then(function () { self._running = false; });
    },

    /** Best-effort: repaint the favorites grid if it's the active activity. */
    _refreshGrid: function () {
      try {
        var act = Lampa.Activity.active();
        if (!act || !act.is_favorites) return;
        var comp = act.activity && act.activity.component;
        // InteractionCategory exposes create() — re-run it to rebuild cards from
        // the merged Fav.all(). Guarded: a missing/odd shape is silently ignored.
        if (comp && typeof comp.create === 'function') comp.create();
      } catch (e) {}
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
        // Normalize protocol-relative URLs (e.g. YouJizz returns //cdne-mobile.youjizz.com/...)
        // BEFORE any early return — the native Android player can't resolve a bare
        // `//host/...` URL (shows the "choose player" dialog), so it must get a
        // proper `https://` URL too.
        if (u.indexOf('//') === 0) u = 'https:' + u;
        if (u.indexOf('blob:') === 0) return u;
        if (PROXY_URL_3 && u.indexOf(PROXY_URL_3) === 0) return u; // skip VPS-proxied URLs
        if (PROXY_URL_2 && u.indexOf(PROXY_URL_2) === 0) return u; // skip Deno-proxied URLs
        if (u.indexOf(PROXY_URL) === 0) return u; // skip CF Worker-proxied URLs
        // Android: native player loads the stream directly from the device's home
        // (residential) IP. Since the page was also fetched natively from the same IP,
        // IP-bound CDN tokens (KVS get_file) stay valid with NO proxy → hand raw URL.
        // EXCEPT force-proxy hosts (device IP blocked): proxy the stream so it
        // co-locates with the proxied page on the same egress IP.
        if (_isAndroid()) return _forceProxyAndroid(u) ? buildProxyUrl(u) : u;
        return buildProxyUrl(u);
      }
      var proxiedQuality = {};
      Object.keys(quality).forEach(function(k) { proxiedQuality[k] = px(quality[k]); });

      // RESUME (native): a stable hash per video lets Lampa's timeline persist
      // and restore the scrubber position automatically. We hash on source+id
      // (falling back to url), mirror it as Hist's key, and hand the timeline
      // VIEW object to the player so it resumes at the saved spot and auto-saves
      // progress as the user watches — no hand-rolled timeupdate persistence.
      var histHash = Hist._hashKey(video);
      var hashId   = (Lampa.Utils && Lampa.Utils.hash)
        ? Lampa.Utils.hash(histHash)
        : histHash;
      var timeline = (Lampa.Timeline && Lampa.Timeline.view)
        ? Lampa.Timeline.view(hashId)
        : undefined;

      // Remember the active video so the player progress/destroy hook can snapshot
      // the timeline position into Hist (the «Продолжить» + progress-bar surface).
      _histVideo = video;
      _histHash  = hashId;

      // HLS on Android can't play in the native/external player: Android hands a raw `.m3u8`
      // to the system → the "choose player" dialog (or it never opens). Force Lampa's inner
      // WebView player (hls.js) JUST for HLS streams, then restore the user's global choice a
      // moment later — so pornhub (HLS-only) and xvideos/xnxx play inline at full quality
      // without the external chooser, while MP4 channels keep the user's native player.
      var _finalUrl = px(url);
      var _restorePlayer;
      if (_isAndroid() && /\.m3u8|mpegurl/i.test(_finalUrl)) {
        _restorePlayer = Lampa.Storage.get('player');
        if (_restorePlayer !== 'inner') Lampa.Storage.set('player', 'inner');
      }

      Lampa.Player.play({
        title:    video.title,
        url:      _finalUrl,
        poster:   video.thumb,
        quality:  proxiedQuality,
        id:       hashId,
        timeline: timeline
      });

      if (_restorePlayer !== undefined && _restorePlayer !== 'inner') {
        setTimeout(function () { try { Lampa.Storage.set('player', _restorePlayer); } catch (e) {} }, 2500);
      }

      // Seed a history record immediately (position 0) so a video opened but
      // closed before any progress event still surfaces under «Продолжить».
      try { Hist.mark(video, (timeline && timeline.time) || 0, (timeline && timeline.duration) || video.duration || 0); } catch (e) {}

      // REQ-4: reset state and kick off background related fetch.
      _relatedGeneration++;
      var myGen       = _relatedGeneration;
      _pendingRelated = [];
      _relatedSrc     = null;
      _relatedVideo   = null;

      // Probe whether this video HAS related (page 1). On player close we push a
      // PAGINATED related grid (carrying the video + source), not a fixed snapshot,
      // so the panel scrolls. We only remember the video/source when page 1 has
      // cards — an empty related means no panel.
      if (source.getRelated) {
        source.getRelated(video, 1).then(function (items) {
          if (myGen !== _relatedGeneration) return;
          if (items && items.length) {
            _pendingRelated = items;          // non-empty marker: related exists
            _relatedSrc     = source;
            _relatedVideo   = video;
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
    var comp = new Lampa.InteractionCategory(object);

    // Paging + filter state (the base class owns scroll/focus/nav; we own data).
    // Filters live in the activity params so a change reloads via Activity.push
    // (InteractionCategory does NOT re-render on a second create() call).
    var currentPage     = 1;
    var currentSort     = object.sort || '';
    var currentCategory = object.category || '';

    var _currentPreviewEl = null;
    var _previewTimer     = null;   // dwell-timer handle (gates preview start on D-pad scroll)

    // Cross-page dedup guard. Some sites don't return empty past the last page —
    // they CLAMP (always serve a full page, e.g. pornhub API), WRAP to page 1, or
    // ignore the page param (e.g. xnxx /tags/, xvideos /best/). With a generous
    // total_pages that would scroll forever feeding DUPLICATES. So we track seen
    // id@source and drop already-seen cards; when a page yields ZERO new cards we
    // treat it as end-of-list and stop. Universal — fixes every clamp/wrap channel.
    var _seenIds = {};
    function _dedupNew(items) {
      var out = [];
      (items || []).forEach(function (v) {
        if (!v) return;
        var k = v.id + '@' + (v.source || '');
        if (_seenIds[k]) return;
        _seenIds[k] = 1;
        out.push(v);
      });
      return out;
    }

    var source      = (object.is_favorites || object.is_history) ? null : sourceById(object.source_id);
    var screenTitle = object.title || (source ? source.name : 'Cherry');

    // Right-edge action-menu applicability (Поиск → Сортировка → Категории).
    // model_url excluded: model browse is already filtered to a performer.
    // is_history (like is_favorites) is a flat local list → no menu axes.
    var _source    = source;
    var _canSearch = !object.is_favorites && !object.is_history && !object.all_sources && !object.related_video && !object.model_url && !object.models_index && !object.studio_url && !object.studios_index;
    // Server sort applies only to a single-source grid. In all-sources search the
    // resolved `source` is SOURCES[0] (which HAS cfg.sorts), so without this guard the
    // menu showed BOTH «Сортировка» (server) AND «Сортировка» (client) — a duplicate.
    // Keep ALL sorting in one entry: server-sort for single source, client-sort for all-sources.
    var _hasSorts  = !!(source && source.cfg && source.cfg.sorts && source.cfg.sorts.length
                        && !object.all_sources && !object.models_index && !object.studios_index);
    var _hasCats   = !!(source && source.cfg && source.cfg.categories && source.cfg.categories.length
                        && !object.all_sources && !object.models_index && !object.studios_index);
    // «Модели»: offered only when the adapter can list a model index, and only on a
    // normal browse grid (not inside model browse / search / favorites / all-sources).
    var _hasModels = !!(source && source.getModels &&
                        !object.is_favorites && !object.is_history && !object.all_sources &&
                        !object.related_video && !object.model_url && !object.models_index &&
                        !object.studio_url && !object.studios_index);
    // «Студии»: offered when the adapter can list a studio/channel index, on a
    // normal browse grid only (mirrors _hasModels exclusions).
    var _hasStudios = !!(source && source.getStudios &&
                        !object.is_favorites && !object.is_history && !object.all_sources &&
                        !object.related_video && !object.model_url && !object.models_index &&
                        !object.studio_url && !object.studios_index);
    // A2: all_sources search has no single source to honor a server sort, so offer
    // a lightweight CLIENT-side sort (relevance/duration) applied in _gridLoad.
    var _hasClientSort = !!(object.all_sources && object.query);

    // ---- card mapping (adapter VideoCard → base-renderer card_data) -------
    // Mutate in place so id/url/source/preview/model/views/duration ride along
    // and surface as `element` in cardRender. source MUST be set (Fav 7-field).
    function toCard(v) {
      v.img    = v.thumb;
      v.poster = v.thumb;
      // HD/4K no longer rides Lampa's native quality slot — it is merged into the
      // bottom-right duration pill in cardRender (e.g. "HD · 12:34"). Keeping a card
      // to at most 3 badges (source TL, views BL, dur/HD BR). v.hd stays on the
      // element so the .cherry-dur overlay can prefix it.
      v.source = v.source || object.source_id;
      return v;
    }

    function mapResult(result) {
      var items = (result && result.items) ? result.items.map(toCard) : [];
      return { items: items, total_pages: (result && result.total_pages) || 1 };
    }

    /**
     * Reproduces the legacy loading logic for every grid mode and calls
     * resolve(items, total_pages). reject() on hard failure / no source.
     * @param {Object}   object
     * @param {number}   page
     * @param {Function} resolve  (items, total_pages)
     * @param {Function} reject
     */
    function _gridLoad(object, page, resolve, reject) {
      // Favorites — single page, no paging.
      if (object.is_favorites) {
        var favs = Fav.all().map(toCard);
        resolve(favs, 1);
        return;
      }

      // History («Продолжить») — single page, newest-first, like favorites.
      if (object.is_history) {
        var hist = Hist.all().map(toCard);
        resolve(hist, 1);
        return;
      }

      // «Похожие»: a PAGINATED grid of the card's source-site related videos.
      // Carries the VIDEO (related_video) + its source, not a pre-fetched list, so
      // it scrolls like any other grid. getRelated(video, page) returns an array;
      // we map it through toCard and derive pages generously via _derivePages.
      // Adapters whose related is the video-page's fixed block ignore `page` and
      // re-serve the same cards → the cross-page dedup guard yields ZERO new cards
      // on page 2 → the grid stops cleanly after page 1 (honest, no infinite dupes).
      // Any adapter that threads `page` (reusing a listing parser) keeps scrolling.
      if (object.related_video) {
        var relSrc = sourceById(object.related_video_source || object.source_id);
        if (!relSrc || !relSrc.getRelated) { resolve([], 1); return; }
        relSrc.getRelated(object.related_video, page).then(function (rel) {
          rel = rel || [];
          // Stamp each related card with the source it came from so nested
          // «Похожие» on these cards re-opens the same channel.
          rel.forEach(function (v) { if (v && !v.source) v.source = relSrc.id; });
          resolve(rel.map(toCard), _derivePages(rel.length, page, 20));
        }).catch(function (err) {
          console.warn('[Cherry] related load error (page ' + page + '):', err);
          reject();
        });
        return;
      }

      // All-sources search — parallel, FLAT concat (drop group labels). Paginates:
      // each source is queried for the SAME `page`; if ANY source returns a full
      // batch this page there's likely more (→ page+1), else this is the last page.
      if (object.all_sources && object.query) {
        if (!SOURCES.length) { resolve([], 1); return; }
        // First-screen-fast: one slow/hung source (or a stalled proxy) must NOT
        // block the whole page. Each source races its search against a hard cap,
        // resolving to an empty batch on timeout so Promise.all settles in ≤cap.
        // A timed-out source contributes [] → not counted toward anyFull/pages.
        var ALL_SRC_TIMEOUT_MS = 7000;
        var promises = SOURCES.map(function (src) {
          var search = src.search(object.query, page).then(function (r) {
            r = r || { items: [] };
            r._srcId = src.id;
            return r;
          }).catch(function (err) {
            console.warn('[Cherry] all_sources search error from ' + src.id + ':', err);
            return { items: [], total_pages: 1, _srcId: src.id };
          });
          var timeout = new Promise(function (r) {
            setTimeout(function () {
              r({ items: [], total_pages: 1, _srcId: src.id });
            }, ALL_SRC_TIMEOUT_MS);
          });
          return Promise.race([search, timeout]);
        });
        Promise.all(promises).then(function (results) {
          var flat = [];
          // Track whether any source still has more pages to come: a source's raw
          // batch reaching the slice cap (>=10) means it likely has another page.
          var anyFull = false;
          // A3(b): per-source title-match filter BEFORE slice(0,10). Unranked top-N
          // from each source let irrelevant results dominate; keep only cards whose
          // title contains the query. Skip the filter for non-ASCII (Cyrillic)
          // queries — scraped titles are often English so a Cyrillic substring would
          // wrongly empty every source. If a source's filtered slice is empty, fall
          // back to its unfiltered top-N (don't drop a whole source).
          var ql = (object.query || '').toLowerCase();
          var isLatin = /^[\x00-\x7F]*$/.test(ql);
          results.forEach(function (r) {
            if (r && r.items && r.items.length) {
              // Stamp each card with ITS originating source so «Похожие» opens the
              // exact channel the card came from (don't clobber an existing source).
              r.items.forEach(function (v) { if (v && !v.source) v.source = r._srcId; });
              // A full raw batch (>=10) from any source implies a further page exists.
              if (r.items.length >= 10) anyFull = true;
              var picked = r.items;
              if (ql && isLatin) {
                var matched = r.items.filter(function (v) { return (v.title || '').toLowerCase().indexOf(ql) !== -1; });
                if (matched.length) picked = matched;
              }
              flat = flat.concat(picked.slice(0, 10));
            }
          });
          // A2: client-side sort for all_sources search (no single source to honor
          // a server sort). Only duration is uniformly available across adapters;
          // 'relevance' keeps the natural per-source-interleaved order (default).
          // Sort is applied to the CURRENT page's flat only (per-page sort).
          if (object.client_sort === 'duration') {
            flat.sort(function (a, b) { return (b.duration || 0) - (a.duration || 0); });
          }
          resolve(flat.map(toCard), anyFull ? (page + 50) : page);
        }).catch(function (err) {
          console.warn('[Cherry] loadAllSources error:', err);
          reject();
        });
        return;
      }

      // Paged modes need a source adapter.
      var src = sourceById(object.source_id);
      if (!src) { resolve([], 1); return; }

      // Models INDEX mode — a grid of model cards (not videos). Each becomes a
      // _model card whose onEnter opens that model's videos via model_url.
      if (object.models_index) {
        if (!src.getModels) { resolve([], 1); return; }
        src.getModels(page).then(function (models) {
          models = models || [];
          var cards = models.map(function (m) {
            return {
              id:        'model_' + (m.url || m.name),
              source:    src.id,
              title:     m.name || _titleFromUrl(m.url),
              thumb:     m.thumb || '',
              url:       m.url,
              _model:    true,
              model_url: m.url
            };
          });
          resolve(cards.map(toCard), _derivePages(cards.length, page, 20));
        }).catch(function (err) {
          console.warn('[Cherry] models_index load error (page ' + page + '):', err);
          reject();
        });
        return;
      }

      // Studios INDEX mode — a grid of studio/channel cards (not videos). Each
      // becomes a _studio card whose onEnter opens that studio's videos via
      // studio_url. Mirrors the models_index branch above.
      if (object.studios_index) {
        if (!src.getStudios) { resolve([], 1); return; }
        src.getStudios(page).then(function (studios) {
          studios = studios || [];
          var cards = studios.map(function (s) {
            return {
              id:         'studio_' + (s.url || s.name),
              source:     src.id,
              title:      s.name || _titleFromUrl(s.url),
              thumb:      s.thumb || '',
              url:        s.url,
              _studio:    true,
              studio_url: s.url
            };
          });
          resolve(cards.map(toCard), _derivePages(cards.length, page, 20));
        }).catch(function (err) {
          console.warn('[Cherry] studios_index load error (page ' + page + '):', err);
          reject();
        });
        return;
      }

      var promise;
      if (object.studio_url) {
        if (!src.browseByStudio) { resolve([], 1); return; }
        promise = src.browseByStudio(object.studio_url, page);
      } else if (object.model_url) {
        if (!src.browseByModel) { resolve([], 1); return; }
        promise = src.browseByModel(object.model_url, page);
      } else if (object.query) {
        promise = src.search(object.query, page, currentSort);
      } else {
        promise = src.browse(currentCategory, page, currentSort);
      }

      promise.then(function (result) {
        var m = mapResult(result);
        resolve(m.items, m.total_pages);
      }).catch(function (err) {
        console.warn('[Cherry] grid load error (page ' + page + '):', err);
        reject();
      });
    }

    // ---- preview (best-effort, adapted to the base card's DOM node) -------

    function _stopCurrentPreview() {
      // Cancel a pending dwell-timer so a card scrolled THROUGH never starts video.
      if (_previewTimer) { clearTimeout(_previewTimer); _previewTimer = null; }
      if (_currentPreviewEl) {
        try {
          _currentPreviewEl.pause();
          _currentPreviewEl.removeAttribute('src');
          _currentPreviewEl.load();
          _currentPreviewEl.style.display = 'none';
        } catch (e) {}
        _currentPreviewEl = null;
      }
    }

    // `node` is the base card's DOM element (cardRender's `target`). The base
    // card has no <video>, so inject one on first use. Best-effort: any failure
    // is swallowed — preview is non-critical.
    function _startPreview(node, url) {
      try {
        var $node = $(node);
        var videoEl = $node.find('video.cherry-card__preview')[0];
        if (!videoEl) {
          videoEl = document.createElement('video');
          videoEl.className = 'cherry-card__preview';
          videoEl.muted = true;
          videoEl.loop = true;
          videoEl.setAttribute('playsinline', '');
          videoEl.style.position = 'absolute';
          videoEl.style.top = '0';
          videoEl.style.left = '0';
          videoEl.style.width = '100%';
          videoEl.style.height = '100%';
          videoEl.style.objectFit = 'cover';
          var holder = $node.find('.card__img, .card__view')[0] || node;
          holder.appendChild(videoEl);
        }
        videoEl.src = url;
        videoEl.load();
        videoEl.style.display = 'block';
        videoEl.style.opacity = '0';   // fade-in: start transparent, ramp to 1 on play
        _currentPreviewEl = videoEl;
        var p = videoEl.play();
        if (p && p.then) {
          p.then(function () {
            // .25s opacity transition is defined in addStyles(); flip after play starts.
            videoEl.style.opacity = '1';
          }).catch(function () {
            if (videoEl.parentNode) videoEl.style.display = 'none';
          });
        } else {
          videoEl.style.opacity = '1';
        }
      } catch (e) {}
    }

    // ---- right-edge action menu: Поиск → Сортировка → Категории -----------

    function _findLabel(arr, id) {
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === id) return arr[i].label;
      }
      return id;
    }

    // P3.1: surface the active sort/category in the grid header. Filters are
    // otherwise invisible once the action menu closes. Resolves labels via the
    // source cfg so the header reads e.g. "Pornhub  ·  MILF  ·  Most recent".
    // Reload with a changed filter by pushing a fresh activity. Calling
    // comp.create() again does NOT re-render an InteractionCategory grid, so
    // sort/category changes were silently ignored — push the new params instead.
    // The ACTIVITY title (top bar) carries the active filter so it stays visible
    // after the menu closes (build()'s title alone isn't shown in the header).
    function _filteredTitle(sort, category) {
      var base = _source ? _source.name : screenTitle;
      var parts = [base];
      if (_source && _source.cfg) {
        if (category && _source.cfg.categories) parts.push(_findLabel(_source.cfg.categories, category));
        if (sort     && _source.cfg.sorts)      parts.push(_findLabel(_source.cfg.sorts, sort));
      }
      return parts.join('  ·  ');
    }
    function _pushFiltered(sort, category) {
      Lampa.Activity.push({
        component: 'cherry_grid',
        source_id: object.source_id,
        title:     _filteredTitle(sort, category),
        query:     object.query || '',
        sort:      sort,
        category:  category,
        page:      1
      });
      Lampa.Controller.toggle('content');
    }

    function _openSearch() {
      if (!_source) return;
      if (typeof Lampa.Input === 'undefined' || !Lampa.Input.edit) return;
      Lampa.Input.edit({
        title: Lampa.Lang.translate('cherry_search'),
        value: object.query || '',
        free:  true,
        nosave: true
      }, function (text) {
        var q = (text || '').trim();
        // A1: toggle ONLY on the empty-query path (no push). On the push path the
        // pushed cherry_grid's own start() re-binds the controller — toggling here
        // first would bind to the OLD activity and leave focus nowhere (dead nav).
        if (!q) { Lampa.Controller.toggle('content'); return; }
        Lampa.Activity.push({
          component: 'cherry_grid',
          title:     _source.name + ': ' + q,
          source_id: object.source_id,
          query:     q,
          page:      1
        });
      });
    }

    // Index of the item whose id matches `id` (for Select.show active-state).
    function _selectedIndex(items, id) {
      for (var i = 0; i < items.length; i++) if (items[i].id === id) return i;
      return -1;
    }

    function _openSort() {
      if (!_source || !_source.cfg || !_source.cfg.sorts) return;
      var items = _source.cfg.sorts.map(function (s) { return { title: s.label, id: s.id }; });
      Lampa.Select.show({
        title: Lampa.Lang.translate('cherry_sort'),
        items: items,
        selected: _selectedIndex(items, currentSort),   // mark the active sort on reopen
        onSelect: function (item) {
          _pushFiltered(item.id, currentCategory);
        },
        onBack: function () { Lampa.Controller.toggle('content'); }
      });
    }

    function _openCat() {
      if (!_source || !_source.cfg || !_source.cfg.categories) return;
      var items = _source.cfg.categories.map(function (c) { return { title: c.label, id: c.id }; });
      items.unshift({ title: Lampa.Lang.translate('cherry_category_default'), id: '' });
      Lampa.Select.show({
        title: Lampa.Lang.translate('cherry_category'),
        items: items,
        selected: _selectedIndex(items, currentCategory),   // mark the active category on reopen
        onSelect: function (item) {
          _pushFiltered(currentSort, item.id);
        },
        onBack: function () { Lampa.Controller.toggle('content'); }
      });
    }

    // «Модели» — open this source's model INDEX grid (models_index mode).
    function _openModels() {
      if (!_source || !_source.getModels) return;
      Lampa.Activity.push({
        component:    'cherry_grid',
        title:        Lampa.Lang.translate('cherry_models') + ' · ' + _source.name,
        source_id:    object.source_id,
        models_index: true,
        page:         1
      });
      Lampa.Controller.toggle('content');
    }

    // «Студии» — open this source's studio/channel INDEX grid (studios_index mode).
    function _openStudios() {
      if (!_source || !_source.getStudios) return;
      Lampa.Activity.push({
        component:     'cherry_grid',
        title:         Lampa.Lang.translate('cherry_studios') + ' · ' + _source.name,
        source_id:     object.source_id,
        studios_index: true,
        page:          1
      });
      Lampa.Controller.toggle('content');
    }

    // A2: client-side sort for all_sources search. Re-pushes the same all_sources
    // activity with a client_sort param that _gridLoad applies after building flat.
    // Only metadata that exists on every adapter card is offered (duration);
    // 'relevance' is the natural per-source-interleaved order (client_sort unset).
    // NOTE: per-adapter search(query,page) mostly IGNORES the sort param (only
    // xvideos/pornhub/kvs honor it) — single-source search-sort is best-effort.
    function _openClientSort() {
      var items = [
        { title: Lampa.Lang.translate('cherry_sort_relevance'), id: '' },
        { title: Lampa.Lang.translate('cherry_sort_duration'),  id: 'duration' }
      ];
      Lampa.Select.show({
        title: Lampa.Lang.translate('cherry_sort'),
        items: items,
        onSelect: function (item) {
          Lampa.Activity.push({
            component:   'cherry_grid',
            title:       object.title,
            source_id:   object.source_id,
            query:       object.query,
            all_sources: true,
            client_sort: item.id,
            page:        1
          });
        },
        onBack: function () { Lampa.Controller.toggle('content'); }
      });
    }

    /**
     * Right-edge action menu. Opened by pressing RIGHT at the grid's right edge
     * (Lampa's native filter idiom). Items appear in fixed order:
     * Поиск → Сортировка → Категории, each only when applicable to this screen.
     * @returns {boolean} true if a menu was shown
     */
    function openActionsMenu() {
      var items = [];
      if (_canSearch)     items.push({ title: Lampa.Lang.translate('cherry_search'),   action: 'search'     });
      if (_hasSorts)      items.push({ title: Lampa.Lang.translate('cherry_sort'),     action: 'sort'       });
      if (_hasClientSort) items.push({ title: Lampa.Lang.translate('cherry_sort'),     action: 'clientsort' });
      if (_hasCats)       items.push({ title: Lampa.Lang.translate('cherry_category'), action: 'cat'        });
      if (_hasModels)     items.push({ title: Lampa.Lang.translate('cherry_models'),   action: 'models'     });
      if (_hasStudios)    items.push({ title: Lampa.Lang.translate('cherry_studios'),  action: 'studios'    });
      if (!items.length) return false;
      Lampa.Select.show({
        // Title reflects the active filter (source · category · sort) so the menu
        // header shows the current state, matching the grid header.
        title: _source ? _filteredTitle(currentSort, currentCategory) : 'Cherry',
        items: items,
        onSelect: function (item) {
          if      (item.action === 'search')     _openSearch();
          else if (item.action === 'sort')       _openSort();
          else if (item.action === 'clientsort') _openClientSort();
          else if (item.action === 'cat')        _openCat();
          else if (item.action === 'models')     _openModels();
          else if (item.action === 'studios')    _openStudios();
        },
        onBack: function () { Lampa.Controller.toggle('content'); }
      });
      return true;
    }

    // ---- InteractionCategory overrides ------------------------------------

    comp.create = function () {
      var _this = this;
      currentPage = 1;
      this.activity.loader(true);

      _seenIds = {};                 // reset dedup tracking for a fresh grid
      _gridLoad(object, 1, function (items, total) {
        currentPage = 1;
        items = _dedupNew(items);    // seed seen-set (page 1 is all new)
        // P3.2: empty favorites shows a PERSISTENT hint (not a transient toast).
        if (!items.length && object.is_favorites) {
          _this.activity.loader(false);
          _this.empty(Lampa.Lang.translate('cherry_fav_empty_hint'));
          return;
        }
        // P3.1: header reflects the active sort/category filter.
        _this.build({ title: screenTitle, results: items, total_pages: total });
        _this.activity.loader(false);
        // 16:9 landscape cards, 5 per row (CSS scoped via .cherry-cat + Lampa cols--5)
        try {
          var root = _this.render();
          root.addClass('cherry-cat');
          root.find('.category-full').addClass('mapping--grid cols--5');
        } catch (e) {}
      }, function () {
        // P3.2: a load failure is DISTINCT from "no results". A focusable «Повторить»
        // re-runs create() so a transient network failure is recoverable on the remote.
        _this.activity.loader(false);
        _this.empty(Lampa.Lang.translate('cherry_load_error'), function () {
          _this.create();
        });
      });
    };

    comp.nextPageReuest = function (object, resolve, reject) {
      // Favorites + history are the single-page local-list modes (no pages).
      // «Похожие» (related_video) now paginates through _gridLoad like every other
      // grid — the dedup guard caps fixed-block adapters after page 1. all_sources
      // also falls through to _gridLoad.
      if (object.is_favorites || object.is_history) {
        resolve({ title: screenTitle, results: [], total_pages: 1 });
        return;
      }
      var nextPage = currentPage + 1;
      _gridLoad(object, nextPage, function (items, total) {
        currentPage = nextPage;
        var fresh = _dedupNew(items);
        // No new cards on this page → the site clamped/wrapped/ignored the page →
        // end of list. Resolve empty + cap total_pages so the base class stops.
        if (!fresh.length) {
          resolve({ title: screenTitle, results: [], total_pages: nextPage });
          return;
        }
        resolve({ title: screenTitle, results: fresh, total_pages: total });
      }, reject);
    };

    // P3.2: custom empty() that honours a message arg. Mirrors sisi_full.js's
    // proven override (Lampa.Empty descr). The base InteractionCategory.empty
    // may ignore a message on this build, so we own it to guarantee a distinct
    // error vs no-results message and a persistent favorites hint.
    // onRetry (optional): when provided, a focusable «Повторить» button is added
    // so the error state is recoverable with the D-pad (otherwise the only way out
    // is Back). On Enter it re-runs the load via onRetry().
    comp.empty = function (msg, onRetry) {
      var _this = this;
      var descr = typeof msg === 'string'
        ? msg
        : Lampa.Lang.translate('cherry_no_results');
      try {
        var box = new Lampa.Empty({ descr: descr });
        var emptyEl = box.render(true);
        // Append a focusable retry action into the empty box. class="selector" makes
        // Lampa's controller collect it when start() focuses the empty area.
        if (onRetry) {
          try {
            var $btn = $('<div class="selector cherry-retry-btn" style="display:inline-block;margin-top:1em;padding:.6em 1.4em;border-radius:.4em;background:#e75480;color:#fff;font-size:1.3em;font-weight:700;">'
              + Lampa.Lang.translate('cherry_retry') + '</div>');
            $btn.on('hover:enter', function () { onRetry(); });
            $(emptyEl).append($btn);
          } catch (e) {}
        }
        Lampa.Activity.all().forEach(function (active) {
          if (_this.activity === active.activity) {
            var body = active.activity.render().find('.activity__body > div')[0];
            if (body) body.appendChild(emptyEl);
          }
        });
        this.start = box.start.bind(box);
        this.activity.loader(false);
        this.activity.toggle();
      } catch (e) {
        // Last-resort fallback if Lampa.Empty is unavailable on this build.
        Lampa.Noty.show(descr, { time: 8000 });
      }
    };

    comp.cardRender = function (object, element, card) {
      card.onEnter = function () {
        _stopCurrentPreview();
        // Model card → open that performer's videos via the model_url grid path.
        if (element._model) {
          Lampa.Activity.push({
            component: 'cherry_grid',
            title:     element.title,
            source_id: element.source,
            model_url: element.model_url,
            page:      1
          });
          return;
        }
        // Studio card → open that studio's videos via the studio_url grid path.
        if (element._studio) {
          Lampa.Activity.push({
            component:  'cherry_grid',
            title:      element.title,
            source_id:  element.source,
            studio_url: element.studio_url,
            page:       1
          });
          return;
        }
        var s = sourceById(element.source);
        if (s) playVideo(element, s);
        else Lampa.Noty.show(Lampa.Lang.translate('cherry_error'), { style: 'warn' });
      };

      // Tag EVERY card with its origin channel (owner requirement: source must be
      // visible in all scenarios without exception — search, favorites, history,
      // related, and single-source grids alike). Visual overlay via element.source.
      if (element.source) {
        try {
          var os = sourceById(element.source);
          if (os) {
            var $v = card.render().find('.card__view');
            if ($v.length) $v.append('<div class="cherry-src-badge">' + os.name + '</div>');
          }
        } catch (e) {}
      }

      // Metadata overlays on every card: dur/HD pill (bottom-right) + views (bottom-left).
      // HD is merged INTO the duration pill ("HD · 12:34"), or shown alone if there is
      // no duration — so a card carries at most 3 badges (source TL, views BL, dur/HD BR).
      try {
        var $v2 = card.render().find('.card__view');
        if ($v2.length) {
          if (element.duration) {
            $v2.append('<div class="cherry-dur">' + (element.hd ? element.hd + ' · ' : '') + secToTime(element.duration) + '</div>');
          } else if (element.hd) {
            $v2.append('<div class="cherry-dur">' + element.hd + '</div>');
          }
          var vstr = formatViews(element.views);
          if (vstr) {
            $v2.append('<div class="cherry-views">' + vstr + '</div>');
          }
          // RESUME progress bar: if this video has a watch record, draw a thin
          // bottom bar (width = watched %) over a faint track + dim the thumb so
          // a glance reads "seen / 60%". Shown on every grid (browse + history).
          try {
            if (Hist.get(element)) {
              var pct = Hist.percent(element);
              $v2.addClass('cherry-watched');
              $v2.append('<div class="cherry-progress-track"></div>');
              $v2.append('<div class="cherry-progress" style="width:' + pct + '%"></div>');
            }
          } catch (_p) {}
        }
      } catch (e) {}

      card.onMenu = function (target, card_data) {
        var isFav   = Fav.has(element);
        var cardSrc = sourceById(element.source) || sourceById(object.source_id);
        // Order: «Похожие» (site's own related, only when adapter.getRelated exists)
        //        → «Похожие названия» (keyword search, always) → «Избранное».
        var items = [];
        // 'related' = adapter.getRelated() curated list from the video page.
        if (cardSrc && cardSrc.getRelated) {
          items.push({
            title: Lampa.Lang.translate('cherry_related'),
            action: 'related'
          });
        }
        // 'similar' = keyword search across all sources by title words.
        items.push({
          title: Lampa.Lang.translate('cherry_similar_titles'),
          action: 'similar'
        });
        items.push({
          title: isFav
            ? Lampa.Lang.translate('cherry_rem_fav_action')
            : Lampa.Lang.translate('cherry_add_fav_action'),
          action: 'fav'
        });
        // Browse all videos of the card's performer (only sources that surface
        // a listing-level model field — currently pornhub).
        if (element.model && element.model.name) {
          items.push({
            title: Lampa.Lang.translate('cherry_model') + ': ' + element.model.name,
            action: 'model'
          });
        }
        Lampa.Select.show({
          title: element.title,
          items: items,
          onSelect: function (item) {
            if (item.action === 'fav') {
              Fav.toggle(element);
              Lampa.Noty.show(
                Fav.has(element)
                  ? Lampa.Lang.translate('cherry_add_fav')
                  : Lampa.Lang.translate('cherry_rem_fav')
              );
              Lampa.Controller.toggle('content');
            } else if (item.action === 'similar') {
              var query = _searchKeywords(element.title, 4);
              Lampa.Activity.push({
                component:   'cherry_grid',
                title:       Lampa.Lang.translate('cherry_similar_titles') + ': ' + element.title,
                source_id:   element.source,
                query:       query,
                all_sources: true,
                page:        1
              });
              Lampa.Controller.toggle('content');
            } else if (item.action === 'related') {
              // «Похожие» = the card's SOURCE-site related, opened as a PAGINATED
              // grid (carry the video + its source; the grid fetches getRelated per
              // page). On all_sources/related result cards, cardSrc resolves from
              // element.source so it opens the exact channel the card came from.
              Lampa.Controller.toggle('content');
              Lampa.Activity.push({
                component:            'cherry_grid',
                title:                Lampa.Lang.translate('cherry_related') + ': ' + element.title,
                source_id:            cardSrc.id,
                related_video:        element,
                related_video_source: cardSrc.id,
                page:                 1
              });
            } else if (item.action === 'model') {
              Lampa.Controller.toggle('content');
              Lampa.Activity.push({
                component: 'cherry_grid',
                title:     element.model.name,
                source_id: element.source,
                model_url: element.model.url,
                page:      1
              });
            }
          },
          onBack: function () { Lampa.Controller.toggle('content'); }
        });
        return false;
      };

      var f = card.onFocus;
      card.onFocus = function (target, card_data) {
        if (f) f(target, card_data);
        _stopCurrentPreview();
        // Dwell-timer: only start preview after the focus rests ~600ms on a card.
        // D-pad scrolling through a row clears the timer (in _stopCurrentPreview)
        // before it fires, so passing-through cards never trigger video.load()+play().
        if (element.preview && Lampa.Storage.get('cherry_preview_enabled', true) && !_isAndroid()) {
          _previewTimer = setTimeout(function () {
            _startPreview(target, element.preview);
          }, 600);
        }
      };
    };

    comp.onRight = function () {
      openActionsMenu();
    };

    // P3.4: exposed so the persistent header filter button (addFilterButton)
    // can open the same Поиск → Сортировка → Категории menu as the right edge.
    comp.openActionsMenu = openActionsMenu;

    // Stop any playing preview when the component pauses / stops / dies.
    var _baseStop  = comp.stop  ? comp.stop.bind(comp)  : null;
    var _basePause = comp.pause ? comp.pause.bind(comp) : null;
    comp.stop  = function () { _stopCurrentPreview(); if (_baseStop)  _baseStop(); };
    comp.pause = function () { _stopCurrentPreview(); if (_basePause) _basePause(); };

    return comp;
  }

  // ============================================================
  // CHERRY MAIN COMPONENT
  // Source list + global search bar + favorites button.
  // ============================================================

  // Stable brand hue from a string seed → consistent per-source tile colour.
  function _tileColor(seed) {
    var h = 0, str = String(seed || '');
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return 'hsl(' + h + ',55%,38%)';
  }

  /**
   * @constructor
   * @param {Object} object  Activity params
   */
  function CherryMain(object) {
    var comp = new Lampa.InteractionCategory(object);

    // ---- InteractionCategory overrides ------------------------------------
    // Home is a single-page source picker: [Поиск] + [Избранное] + one card per
    // registered source. Enter routes to the right activity. Nav/scroll come
    // free from the base class (same proven pattern as CherryGrid).

    comp.create = function () {
      this.activity.loader(true);

      var results = [];
      // 1) Search entry — opens keyboard, then all-sources search grid.
      results.push({ title: Lampa.Lang.translate('cherry_search'), img: '', _kind: 'search', _initial: '⌕', _action: true });
      // 2) Favorites entry.
      results.push({ title: Lampa.Lang.translate('cherry_favorites'), img: '', _kind: 'favorites', _initial: '♥', _action: true });
      // 3) Sync entry — set the cross-device PIN; opening Cherry also auto-syncs.
      results.push({ title: Lampa.Lang.translate('cherry_sync'), img: '', _kind: 'sync', _initial: '⟲', _action: true });
      // 4) One card per registered source — stable brand colour + first letter.
      SOURCES.forEach(function (src) {
        results.push({
          title:      src.name,
          img:        '',
          _kind:      'source',
          _source_id: src.id,
          _initial:   (src.name || '?').charAt(0).toUpperCase(),
          _color:     _tileColor(src.id)
        });
      });
      // 5) Watch history («РП») — resume surface, placed LAST (after all sources).
      // Shown only when history exists.
      if (Hist.all().length) {
        results.push({ title: Lampa.Lang.translate('cherry_continue'), img: '', _kind: 'continue', _initial: '▶', _action: true });
      }

      this.build({ title: 'Cherry', results: results, total_pages: 1 });
      this.activity.loader(false);
      // Picker = small square tiles, 7 per row, so all 26 sources fit on screen.
      // .cherry-cat → tile + focus styling; .cherry-home → square aspect override.
      try {
        var root = this.render();
        root.addClass('cherry-cat cherry-home');
        root.find('.category-full').addClass('mapping--grid cols--8');
      } catch (e) {}

      // Opening Cherry pulls the shared bucket (non-blocking, local-first).
      try { Sync.run(); } catch (e) {}
    };

    comp.cardRender = function (object, element, card) {
      card.onEnter = function () {
        if (element._kind === 'search') {
          if (typeof Lampa.Input !== 'undefined' && Lampa.Input.edit) {
            Lampa.Input.edit({
              title: Lampa.Lang.translate('cherry_search'),
              value: '',
              free:  true,
              nosave: true
            }, function (value) {
              var q = (value || '').trim();
              // A1: toggle ONLY on the empty-query path (no push). On the push path
              // the pushed cherry_grid's start() re-binds the controller; toggling
              // here first would bind the OLD activity and kill arrow nav.
              if (!q) { Lampa.Controller.toggle('content'); return; }
              Lampa.Activity.push({
                component:   'cherry_grid',
                title:       Lampa.Lang.translate('cherry_search') + ': ' + q,
                source_id:   (SOURCES[0] && SOURCES[0].id) || '',
                query:       q,
                all_sources: true,
                page:        1
              });
            });
          }
        } else if (element._kind === 'continue') {
          Lampa.Activity.push({
            component:  'cherry_grid',
            title:      Lampa.Lang.translate('cherry_continue'),
            source_id:  (SOURCES[0] && SOURCES[0].id) || '',
            is_history: true,
            page:       1
          });
        } else if (element._kind === 'favorites') {
          Lampa.Activity.push({
            component:    'cherry_grid',
            title:        Lampa.Lang.translate('cherry_favorites'),
            source_id:    (SOURCES[0] && SOURCES[0].id) || '',
            is_favorites: true,
            page:         1
          });
        } else if (element._kind === 'sync') {
          if (typeof Lampa.Input !== 'undefined' && Lampa.Input.edit) {
            Lampa.Input.edit({
              title:  Lampa.Lang.translate('cherry_sync'),
              value:  Sync.getPin(),
              free:   true,
              nosave: true
            }, function (v) {
              Lampa.Controller.toggle('content');
              // v may arrive as a string or, on some builds, an object — coerce safely.
              var p = String(v == null ? '' : (v.value != null ? v.value : v)).trim();
              console.log('[Cherry] sync tile: entered value =', v, '→ pin =', p);
              if (/^[0-9]{4,12}$/.test(p)) {
                Lampa.Noty.show(Lampa.Lang.translate('cherry_sync') + '… (PIN ' + p + ')');
                Sync.setPin(p);   // runs a REPORTED sync → shows result/error Noty
              } else {
                Lampa.Noty.show('PIN — 4–12 цифр');
              }
            });
          }
        } else if (element._kind === 'source') {
          Lampa.Activity.push({
            component: 'cherry_grid',
            title:     element.title,
            source_id: element._source_id,
            page:      1
          });
        }
      };

      // Letter tile: the picker has no thumbnails, so paint a coloured initial
      // into .card__view. Search/Favorites get the brand action tint; sources
      // get a stable per-source hue. Visual only — routing above is untouched.
      try {
        var $view = card.render().find('.card__view');
        if ($view.length) {
          var cls = 'cherry-tile' + (element._action ? ' cherry-tile--action' : '');
          var bg  = element._action ? '' : ' style="background:' + (element._color || '#444') + '"';
          $view.append('<div class="' + cls + '"' + bg + '><span>' + (element._initial || '?') + '</span></div>');
        }
      } catch (e) {}
    };

    return comp;
  }

  // ============================================================
  // CSS  — optimised for 1080p TV (1920×1080)
  // Base font-size on most Lampa skins ≈ 20px.
  // All em values are relative to that context.
  // ============================================================
  function addStyles() {
    var rules = [
      /* ---- 16:9 landscape cards for Cherry (override Lampa's poster card) ---- */
      /* Scoped to .cherry-cat so the rest of Lampa keeps its poster layout.    */
      '.cherry-cat .card__view {',
      '  padding-bottom: 56.25% !important;',  /* 9/16 → 16:9 box */
      '  height: 0 !important;',
      '  position: relative;',
      '}',
      '.cherry-cat .card__img {',
      '  position: absolute; top: 0; left: 0;',
      '  width: 100%; height: 100%;',
      '  object-fit: cover;',
      '}',

      /* ---- Focus: brand ring + zoom on the INNER box (.card__view), so it does */
      /* NOT double up with Lampa's outer focus frame. Larger scale + pink ring + */
      /* drop shadow make the focused card unmistakable at 10-foot distance. */
      '.cherry-cat .card{transform-origin:center;}',
      '.cherry-cat .card.focus .card__view{transform:scale(1.07);box-shadow:0 0 0 .22em #e75480, 0 .6em 1.4em rgba(0,0,0,.6);border-radius:.4em;transition:transform .18s ease, box-shadow .18s ease;}',
      /* Suppress Lampa\'s native white focus frame (.card.focus .card__view::after = 0.3em solid #fff) */
      /* so ONLY our pink ring shows — kills the double-highlight. */
      '.cherry-cat .card.focus .card__view::after, .cherry-cat .card.hover .card__view::after{display:none !important;}',

      /* ---- Home picker: small SQUARE tiles, all sources visible -- */
      '.cherry-home .card__view{padding-bottom:100% !important;height:0 !important;position:relative;}',

      /* ---- P2.2 Title legibility (2-line clamp, full white) ----- */
      '.cherry-cat .card__title{color:#fff;font-size:.9em;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal;overflow:hidden;max-height:2.6em;}',

      /* ---- P2.3 Home letter tiles ------------------------------ */
      '.cherry-cat .cherry-tile{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;border-radius:.6em;}',
      '.cherry-cat .cherry-tile span{font-size:2.6em;font-weight:800;color:#fff;text-shadow:0 .05em .2em rgba(0,0,0,.4);}',
      '.cherry-cat .cherry-tile--action{background:#e75480 !important;}',

      /* ---- Bottom gradient scrim: lifts badge contrast over light thumbnails. */
      /* Sits at z-index:1, BELOW the badges (z-index:2), pointer-events:none.   */
      '.cherry-cat .card__view::after{content:\'\';position:absolute;left:0;right:0;bottom:0;height:42%;background:linear-gradient(transparent, rgba(0,0,0,.55));pointer-events:none;z-index:1;}',

      /* ---- Preview <video> fade-in (motion) + object-fit so non-16:9 sources */
      /* (e.g. eporner medium thumbs) cover the card box instead of stretching.  */
      '.cherry-cat .cherry-card__preview, .cherry-card__preview{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;transition:opacity .25s ease;}',

      /* ---- P3.3 Source attribution badge + duration/views (3 corners max) --- */
      /* Larger + bolder for 10-foot legibility; sit above the scrim (z-index:2). */
      '.cherry-cat .cherry-src-badge{position:absolute;top:.4em;left:.5em;z-index:2;background:rgba(0,0,0,.85);color:#fff;font-size:.85em;font-weight:700;padding:.12em .5em;border-radius:.25em;max-width:80%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.cherry-cat .cherry-dur{position:absolute;bottom:.4em;right:.5em;z-index:2;background:rgba(0,0,0,.8);color:#fff;font-size:1em;font-weight:700;padding:.18em .55em;border-radius:.25em;}',
      '.cherry-cat .cherry-views{position:absolute;bottom:.4em;left:.5em;z-index:2;background:rgba(0,0,0,.8);color:#fff;font-size:1em;font-weight:700;padding:.18em .55em;border-radius:.25em;}',

      /* ---- Larger empty/error text for 10-foot readability ----------------- */
      '.activity .empty__descr{font-size:1.5em;line-height:1.4;}',

      /* ---- P3.4 Cherry header filter button -------------------- */
      '.cherry-filter-btn{color:#fff;}',
      '.cherry-filter-btn.focus{color:#e75480;}',

      /* ---- Resume progress bar (watch history) ----------------- */
      /* Thin bottom bar over a faint full-width track; the brand-pink fill width */
      /* is the watched %. .cherry-watched dims the thumb slightly ("seen"). */
      '.cherry-cat .cherry-progress-track{position:absolute;left:0;right:0;bottom:0;height:.3em;background:rgba(255,255,255,.25);z-index:2;}',
      '.cherry-cat .cherry-progress{position:absolute;left:0;bottom:0;height:.3em;background:#e75480;z-index:3;}',
      '.cherry-cat .card__view.cherry-watched .card__img{opacity:.8;}',
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
      cherry_favorites:   { ru: 'Случайные',           en: 'Favorites'          },
      cherry_continue:    { ru: 'RP',                  en: 'Continue'           },
      cherry_sync:        { ru: 'Синхронизация',       en: 'Sync'               },
      cherry_sync_ok:     { ru: 'Избранное синхронизировано', en: 'Favorites synced' },
      cherry_sync_err:    { ru: 'Синхронизация не удалась — проверьте сеть', en: 'Sync failed — check connection' },
      cherry_no_results:  { ru: 'Нет результатов',     en: 'No results'         },
      cherry_fav_empty_hint: { ru: 'Удерживайте ОК на видео чтобы добавить в избранное', en: 'Hold OK on a video to add it to favorites' },
      cherry_loading:     { ru: 'Загрузка…',           en: 'Loading…'           },
      cherry_error:       { ru: 'Ошибка загрузки',     en: 'Load error'         },
      cherry_load_error:  { ru: 'Не удалось загрузить. Проверьте соединение.', en: 'Failed to load. Check your connection.' },
      cherry_retry:       { ru: 'Повторить',           en: 'Retry'              },
      cherry_add_fav:        { ru: 'Добавлено в избранное',  en: 'Added to favorites'    },
      cherry_rem_fav:        { ru: 'Убрано из избранного',   en: 'Removed from favorites' },
      cherry_add_fav_action: { ru: 'Добавить в избранное',   en: 'Add to favorites'       },
      cherry_rem_fav_action: { ru: 'Убрать из избранного',   en: 'Remove from favorites'  },
      cherry_quality:     { ru: 'Выбор качества',      en: 'Select quality'     },
      cherry_similar_titles:   { ru: 'Похожие названия',     en: 'Similar titles'     },
      cherry_sort:             { ru: 'Сортировка',          en: 'Sort'               },
      cherry_sort_default:     { ru: 'По умолчанию',        en: 'Default'            },
      cherry_sort_relevance:   { ru: 'Релевантность',       en: 'Relevance'          },
      cherry_sort_duration:    { ru: 'По длительности',     en: 'By duration'        },
      cherry_category:         { ru: 'Категория',           en: 'Category'           },
      cherry_category_default: { ru: 'Все категории',       en: 'All categories'     },
      cherry_model_videos:     { ru: 'Видео модели',        en: 'Model videos'       },
      cherry_model:            { ru: 'Модель',              en: 'Model'              },
      cherry_models:           { ru: 'Модели',              en: 'Models'             },
      cherry_studios:          { ru: 'Студии',              en: 'Studios'            },
      cherry_preview_setting:  { ru: 'Предпросмотр',        en: 'Preview'            },
      cherry_related:          { ru: 'Похожие',             en: 'Related'            },
      cherry_proxy_key_init:   { ru: 'Cherry: ключ прокси — 1206. Для смены — измените cherry_proxy_key в хранилище Lampa.', en: 'Cherry: proxy key — 1206. To change, update cherry_proxy_key in Lampa Storage.' }
    });
  }

  // ============================================================
  // P3.4 — Persistent header filter button (Cherry grids only)
  // Mirrors sisi_full.js addFilter: a focusable header action that opens the
  // same Поиск → Сортировка → Категории menu as the right edge, so filters are
  // discoverable without hunting for the right-edge gesture. Shown only while a
  // cherry_grid activity is on top; hidden everywhere else in Lampa.
  //
  // NOTE (global search): Lampa's global-search registration API
  // (Lampa.Search component) is NOT exercised by the reference (sisi defines a
  // `Search` object but never registers it — addSourceSearch() is commented
  // out). Registering Cherry into the system-wide search bar is therefore
  // unverified and risky; left as a TODO rather than guessed. The header button
  // below is the safe, clear win that satisfies the discoverability goal.
  // TODO(global-search): register Cherry into Lampa.Search once the API is
  // confirmed on a live runtime (open the all-sources search grid for the query).
  // ============================================================
  function addFilterButton() {
    if (window.cherry_filter_btn_ready) return;
    if (!$('.head .open--search').length) return; // header not present
    window.cherry_filter_btn_ready = true;

    var activi;
    var timer;
    var button = $(
      '<div class="head__action selector cherry-filter-btn">' +
        '<svg height="36" viewBox="0 0 38 36" fill="none" xmlns="http://www.w3.org/2000/svg">' +
          '<rect x="1.5" y="1.5" width="35" height="33" rx="1.5" stroke="currentColor" stroke-width="3"></rect>' +
          '<rect x="7" y="8" width="24" height="3" rx="1.5" fill="currentColor"></rect>' +
          '<rect x="7" y="16" width="24" height="3" rx="1.5" fill="currentColor"></rect>' +
          '<rect x="7" y="25" width="24" height="3" rx="1.5" fill="currentColor"></rect>' +
          '<circle cx="13.5" cy="17.5" r="3.5" fill="currentColor"></circle>' +
          '<circle cx="23.5" cy="26.5" r="3.5" fill="currentColor"></circle>' +
          '<circle cx="21.5" cy="9.5" r="3.5" fill="currentColor"></circle>' +
        '</svg>' +
      '</div>'
    );

    button.hide().on('hover:enter', function () {
      // Resolve the live component instance (Manifest digital quirk: in newer
      // builds activity.component is the instance; in older it is a factory).
      if (!activi) return;
      var inst = (Lampa.Manifest && Lampa.Manifest.app_digital >= 300)
        ? activi.activity.component
        : (typeof activi.activity.component === 'function' ? activi.activity.component() : activi.activity.component);
      if (inst && inst.openActionsMenu) inst.openActionsMenu();
    });

    $('.head .open--search').after(button);

    Lampa.Listener.follow('activity', function (e) {
      if (e.type === 'start') activi = e.object;
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (activi && activi.component !== 'cherry_grid') {
          button.hide();
          activi = false;
        }
      }, 1000);

      if (e.type === 'start' && e.component === 'cherry_grid') {
        button.show();
        activi = e.object;
      }
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

    // P3.4: persistent header filter button for cherry_grid screens.
    try { addFilterButton(); } catch (e) { console.warn('[Cherry] addFilterButton failed', e); }

    // Startup sync — only if the user has set a PIN (no default). Sync.run()
    // no-ops on an empty/invalid PIN, so favorites stay purely local until opt-in.
    // Non-blocking, local-first: a slow/failed sync never delays the UI.
    setTimeout(function () { try { Sync.run(); } catch (e) {} }, 2000);

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
      // RESUME surface: snapshot the native timeline position into Hist as the
      // user watches (timeupdate) and once more on close (destroy). Lampa OWNS
      // the canonical position via the timeline VIEW it persists; we just mirror
      // it so «Продолжить» + on-card progress bars stay accurate. Coexists with
      // the related-panel destroy logic below (both run on the same destroy).
      if ((e.type === 'timeupdate' || e.type === 'destroy') && _histVideo && _histHash) {
        try {
          var view = (Lampa.Timeline && Lampa.Timeline.view)
            ? Lampa.Timeline.view(_histHash) : null;
          if (view) {
            var pos = view.time     || e.time     || 0;
            var dur = view.duration || e.duration || _histVideo.duration || 0;
            if (pos > 0 || dur > 0) Hist.mark(_histVideo, pos, dur);
          }
        } catch (_h) {}
      }
      if (e.type === 'destroy') {
        _histVideo = null;
        _histHash  = null;
        if (_blobUrls.length) {
          _blobUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (_) {} });
          _blobUrls = [];
        }
        // REQ-4: invalidate any in-flight getRelated then push a PAGINATED related
        // grid if page-1 related existed. We push the video + source (not the
        // snapshot) so the panel scrolls via _gridLoad's related_video branch.
        _relatedGeneration++;
        if (_pendingRelated.length && _relatedVideo && _relatedSrc) {
          var rSrc  = _relatedSrc;
          var rVid  = _relatedVideo;
          _pendingRelated = [];
          _relatedSrc     = null;
          _relatedVideo   = null;
          Lampa.Activity.push({
            component:            'cherry_grid',
            title:                Lampa.Lang.translate('cherry_related'),
            source_id:            rSrc.id,
            related_video:        rVid,
            related_video_source: rSrc.id,
            page:                 1
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
  // ISO-8601 duration (schema.org itemprop="duration" content="PT13M10S" / "PT790S").
  var iso = str.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (iso && (iso[1] || iso[2] || iso[3])) {
    return (iso[1] ? parseInt(iso[1], 10) * 3600 : 0) +
           (iso[2] ? parseInt(iso[2], 10) * 60 : 0) +
           (iso[3] ? parseInt(iso[3], 10) : 0);
  }
  // Colon form (12:34 / 1:02:03) — handle before the h/m/s scan so it isn't shadowed.
  if (str.indexOf(':') !== -1) {
    var p = str.split(':').map(Number);
    if (p.length === 2) return p[0] * 60 + p[1];
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  }
  // Unit form: any of h / m(in) / s, in any combination, spaces tolerated.
  // Examples handled: "7min", "7 min", "1h2min", "1h 2m", "1h", "12m34s".
  var h = str.match(/(\d+)\s*h/i);
  var m = str.match(/(\d+)\s*m(?:in)?(?![a-z])/i);
  var s = str.match(/(\d+)\s*s(?![a-z])/i);
  if (h || m || s) {
    return (h ? parseInt(h[1], 10) * 3600 : 0) +
           (m ? parseInt(m[1], 10) * 60 : 0) +
           (s ? parseInt(s[1], 10) : 0);
  }
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

// Final title fallback: derive a readable title from a video URL's last slug
// segment. Strips extension + leading numeric id, decodes, hyphens→spaces.
// Returns '' for purely-numeric slugs so callers keep their own fallback.
function _titleFromUrl(url) {
  if (!url) return '';
  try {
    var seg = String(url).split('?')[0].split('#')[0].replace(/\/+$/, '').split('/').pop() || '';
    seg = seg.replace(/\.(html?|php)$/i, '').replace(/^\d+[-_]/, '');
    seg = decodeURIComponent(seg).replace(/[-_]+/g, ' ').trim();
    if (/^\d+$/.test(seg)) return '';
    return seg.charAt(0).toUpperCase() + seg.slice(1);
  } catch (e) { return ''; }
}

// Generic words that dilute «Похожие по названию» relevance (the "woodman"
// effect: keeping 'casting' over the model's name keys the search on the genre
// instead of the distinctive subject). Stripped BEFORE picking top keywords so
// the query leans on names/acts. EN + RU high-frequency fillers + porn-generic.
var STOP_WORDS = (function () {
  var list = ('the a an and or of to in on at for with from by as is are be ' +
    'his her she he it its they them you your my our this that these those ' +
    'hot sex porn porno video videos girl girls guy guys teen milf babe babes ' +
    'amateur scene clip full hd new free' + ' ' +
    'и в во на с со по для она его ее их они ты вы мой моя наш это эта эти тот ' +
    'как что так все всё за из от до о об у не да нет porno секс порно видео ' +
    'девушка девушки парень молодая молодые любительское сцена новое').split(/\s+/);
  var set = {};
  for (var i = 0; i < list.length; i++) if (list[i]) set[list[i]] = true;
  return set;
})();

// Build the «Похожие по названию» query from a card title: drop punctuation,
// remove STOP_WORDS, then take the top distinctive words. Robust fallback: if
// filtering empties the list, use the unfiltered top words (never empty query).
function _searchKeywords(title, limit) {
  var n = limit || 4;
  var all = (title || '').replace(/[^a-zа-яё0-9\s]/gi, '').trim().split(/\s+/).filter(Boolean);
  var kept = all.filter(function (w) { return !STOP_WORDS[w.toLowerCase()]; });
  var words = (kept.length ? kept : all).slice(0, n);
  return words.join(' ');
}

// Infinite-scroll pagination without fragile markup parsing: a full page implies
// there's a next one; a short page is the last. `full` = the per-source page size
// (or a low floor). Returns the page number to report as total_pages.
function _derivePages(itemsLen, page, full) {
  // "Has more pages" if this page came back at least half-full (tolerant to per-site
  // count variance). When it does, promise a GENEROUS window ahead so the base
  // InteractionCategory keeps requesting on scroll — returning page+1 made it stop
  // after a single extra page (the infinite-scroll bug). A short/empty page caps it.
  // nextPageReuest re-derives each page, so the window re-extends as long as pages
  // stay full → effectively infinite while the site has content.
  var f = full || 12;
  var hasMore = itemsLen >= Math.max(1, Math.floor(f / 2));
  return hasMore ? (page + 50) : page;
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
        .replace(/&apos;/g, "'")
        .replace(/&excl;/g, '!')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
        .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
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
 * Humanize a URL slug into a display name: "abella-danger" → "Abella Danger".
 * Used for model index entries whose markup carries no clean name text.
 * @param {string} slug
 * @returns {string}
 */
function _humanizeName(slug) {
    var s = String(slug || '').replace(/\.(html?|php)$/i, '').replace(/[-_]+/g, ' ').trim();
    return s.replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); });
}

/**
 * Generic model-INDEX scraper shared by HTML adapters. Walks each href matching
 * `hrefRx`, derives the model page url + display name (+ optional thumb) from the
 * surrounding chunk, and dedups by url. Mirrors the per-card parser pattern but
 * returns [{name, url, thumb}] for the "Модели" discovery grid.
 *
 * @param {string} html
 * @param {Object} opts
 * @param {RegExp} opts.hrefRx       global regex; group1 = href (group used for url)
 * @param {Function} [opts.normalizeUrl]  (rawHref) → absolute model url
 * @param {Function} [opts.exclude]  (url) → true to skip (nav/pagination/sort links)
 * @param {RegExp[]} [opts.nameRx]   title/alt/span patterns tried against the chunk
 * @param {RegExp[]} [opts.thumbRx]  thumb patterns tried against the chunk
 * @param {number} [opts.window]     chunk size after the href (default 500)
 * @returns {Array<{name:string,url:string,thumb:string}>}
 */
function _parseModelIndex(html, opts) {
    var items = [];
    var seen  = {};
    var win   = opts.window || 500;
    var m;
    opts.hrefRx.lastIndex = 0;
    while ((m = opts.hrefRx.exec(html)) !== null) {
        var raw = m[1];
        var url = opts.normalizeUrl ? opts.normalizeUrl(raw, m) : raw;
        if (!url || seen[url]) continue;
        if (opts.exclude && opts.exclude(url)) continue;
        seen[url] = true;

        var chunk = html.slice(m.index, m.index + win);

        var name = '';
        var nameRx = opts.nameRx || [];
        for (var ni = 0; ni < nameRx.length; ni++) {
            name = _decodeHtml(_attr(chunk, nameRx[ni]));
            if (name) break;
        }
        if (!name) name = _humanizeName(url.replace(/\/+$/, '').split('/').pop());

        var thumb = '';
        var thumbRx = opts.thumbRx || [];
        for (var ti = 0; ti < thumbRx.length; ti++) {
            thumb = _attr(chunk, thumbRx[ti]);
            if (thumb) break;
        }

        items.push({ name: name, url: url, thumb: thumb });
    }
    return items;
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
    var card = {
      id: id,
      source: 'pornhub',
      title: v.title || '',
      thumb: thumb,
      url: v.url ? (v.url.indexOf('http') === 0 ? v.url : 'https://www.pornhub.com' + v.url) : '',
      duration: parseDur(v.duration),
      views: parseViews(String(v.views || 0))
    };
    // Surface the performer so the card onMenu can offer "browse by model".
    // browseByModel() appends "/videos?page=P" itself, so model.url is the
    // pornstar page BASE (/pornstar/{slug}) WITHOUT a trailing /videos.
    if (v.pornstars && v.pornstars[0] && v.pornstars[0].pornstar_name) {
      var pn = v.pornstars[0].pornstar_name;
      card.model = {
        name: pn,
        url: 'https://www.pornhub.com/pornstar/' +
             pn.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      };
    }
    return card;
  },

  cfg: {
    // Valid webmasters API orderings (verified distinct): mostviewed, mostrecent, rating.
    // `longest` dropped — the API silently ignored it (returned byte-identical to mostrecent).
    // Time-window sorts are COMPOSITE ids `ordering:period` (id itself carries a ':' so they
    // are appended as literal objects, NOT via _cats which splits on the first ':'). browse()/
    // search() split the id on ':' → &ordering= + &period= (no ':' = all-time, no period param).
    // Default (sorts[0]) = "popular THIS WEEK" so the listing refreshes weekly instead of
    // showing the same all-time top videos every time. All-time + rating + recent stay available.
    sorts: [{ id: 'mostviewed:weekly', label: 'Популярное за неделю' }].concat(
      _cats('mostviewed:По популярности (всё время),rating:По рейтингу,mostrecent:Свежее')).concat([
      { id: 'mostviewed:monthly', label: 'Популярное за месяц' }
    ]),
    // Pornhub categories are SLUGS passed to the webmasters API (&category=), not numeric ids.
    // Slugs verified against the webmasters/categories endpoint.
    categories: _cats('18-25:Teen 18-25,ai:AI,ai-straight:AI Straight,amateur:Amateur,anal:Anal,arab:Arab,asian:Asian,babe:Babe,babysitter-18:Babysitter 18+,bbw:BBW,behind-the-scenes:Behind The Scenes,big-ass:Big Ass,big-dick:Big Dick,big-tits:Big Tits,bisexual-male:Bisexual Male,black:Black,blonde:Blonde,blowjob:Blowjob,bondage:Bondage,brazilian:Brazilian,british:British,brunette:Brunette,bukkake:Bukkake,cartoon:Cartoon,casting:Casting,celebrity:Celebrity,college-18:College 18+,compilation:Compilation,cosplay:Cosplay,creampie:Creampie,cuckold:Cuckold,cumshot:Cumshot,czech:Czech,deepthroat:Deepthroat,double-penetration:Double Penetration,ebony:Ebony,euro:Euro,exclusive:Exclusive,feet:Feet,female-orgasm:Female Orgasm,fetish:Fetish,ffm:FFM,fingering:Fingering,fisting:Fisting,fmm:FMM,french:French,gangbang:Gangbang,gay:Gay,german:German,golden-shower:Golden Shower,handjob:Handjob,hardcore:Hardcore,hd-porn:HD Porn,hentai:Hentai,indian:Indian,interracial:Interracial,italian:Italian,japanese:Japanese,korean:Korean,latina:Latina,lesbian:Lesbian,lipstick:Lipstick,massage:Massage,masturbation:Masturbation,mature:Mature,milf:MILF,muscular-men:Muscular Men,old-young-18:Old/Young 18+,orgy:Orgy,parody:Parody,party:Party,pissing:Pissing,pornstar:Pornstar,pov:POV,public:Public,pussy-licking:Pussy Licking,real-couples:Real Couples,reality:Reality,red-head:Red Head,role-play:Role Play,romantic:Romantic,rough-sex:Rough Sex,russian:Russian,school-18:School 18+,scissoring:Scissoring,small-tits:Small Tits,smoking:Smoking,solo-female:Solo Female,solo-male:Solo Male,squirt:Squirt,step-fantasy:Step Fantasy,strap-on:Strap On,striptease:Striptease,tattooed-women:Tattooed Women,threesome:Threesome,toys:Toys,trans-male:Trans Male,trans-with-girl:Trans With Girl,trans-with-guy:Trans With Guy,transgender:Transgender,twink-18:Twink 18+,uncensored:Uncensored,verified-amateurs:Verified Amateurs,verified-couples:Verified Couples,verified-models:Verified Models,vintage:Vintage,vr:VR,webcam:Webcam,wet-pussy:Wet Pussy')
  },

  // Webmasters API returns {videos:[...]} with NO total_pages key. It serves a
  // full batch of PAGE_SIZE per page, so a full batch => assume next page exists.
  _PAGE_SIZE: 30,

  // Split a (possibly composite) sort id "ordering:period" into the two API params.
  // No ':' → all-time (no &period=). Verified: &period=weekly|monthly changes results.
  _sortParams: function(sort) {
    var parts = String(sort || 'mostviewed').split(':');
    return { ordering: parts[0] || 'mostviewed', period: parts[1] || '' };
  },

  search: function(query, page, sort) {
    var self = this;
    var p = page || 1;
    var sp = self._sortParams(sort);
    var url = 'https://www.pornhub.com/webmasters/search?search=' + encodeURIComponent(query) +
      '&page=' + p + '&ordering=' + sp.ordering +
      (sp.period ? '&period=' + sp.period : '') + '&thumbsize=medium_hd';
    return cherryFetch(url).then(function(text) {
      var data = JSON.parse(text);
      var videos = data.videos || (data.data && data.data.videos) || [];
      var items = videos.map(function(v) { return self._mapVideo(v); });
      var total_pages = _derivePages(items.length, p, self._PAGE_SIZE);
      return { items: items, total_pages: total_pages };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  browse: function(category, page, sort) {
    var self = this;
    var p = page || 1;
    var sp = self._sortParams(sort);
    var url = 'https://www.pornhub.com/webmasters/search?search=&page=' + p +
      '&ordering=' + sp.ordering + (sp.period ? '&period=' + sp.period : '') +
      '&thumbsize=medium_hd' +
      (category ? '&category=' + encodeURIComponent(category) : '');
    return cherryFetch(url).then(function(text) {
      var data = JSON.parse(text);
      var videos = data.videos || (data.data && data.data.videos) || [];
      var items = videos.map(function(v) { return self._mapVideo(v); });
      var total_pages = _derivePages(items.length, p, self._PAGE_SIZE);
      return { items: items, total_pages: total_pages };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  // Parse pornhub video-listing HTML (model /videos pages AND related blocks).
  // Iterate by the canonical card container <li class="…videoblock…"> so each
  // card's thumb/preview/duration are bound to ITS block — a fixed char-window
  // around the href clipped the deeply-nested mediabook (+~1500) / duration
  // (+~3000) and yielded bare cards inside models. Field regexes mirror the API
  // _mapVideo output (source/thumb/title/url/duration/views) plus data-mediabook
  // preview, so model cards render IDENTICALLY to listing cards (now WITH preview).
  _parseHtmlCards: function(html) {
    var items = [];
    var seen = {};
    // Split into per-card blocks by the videoblock <li> boundaries. Append the
    // tail so the last card gets a full block.
    var liRx = /<li[^>]*class="[^"]*videoblock[^"]*"/g;
    var starts = [];
    var lm;
    while ((lm = liRx.exec(html)) !== null) starts.push(lm.index);
    // Fallback: no videoblock containers (markup change) → degrade to href scan
    // over the whole document so we still surface SOMETHING rather than nothing.
    if (!starts.length) starts.push(0);
    starts.push(html.length);
    for (var i = 0; i < starts.length - 1; i++) {
      var block = html.slice(starts[i], starts[i + 1]);
      var vk = block.match(/viewkey=([a-z0-9]+)/);
      if (!vk) continue;
      var vkey = vk[1];
      if (seen[vkey]) continue;
      seen[vkey] = true;
      var href = _attr(block, /href="(\/view_video\.php\?viewkey=[a-z0-9]+[^"]*)"/);
      var videoUrl = href ? 'https://www.pornhub.com' + href
                          : 'https://www.pornhub.com/view_video.php?viewkey=' + vkey;
      var thumb = _attr(block, /data-mediumthumb="([^"]+)"/) ||
                  _attr(block, /data-thumb_url="([^"]+)"/) ||
                  _attr(block, /data-image="([^"]+)"/) ||
                  _attr(block, /<img[^>]+(?:data-src|src)="(https?:\/\/[^"]*phncdn[^"]+\.jpg[^"]*)"/) || '';
      var preview = _attr(block, /data-mediabook="([^"]+)"/);
      var title = _decodeHtml(
        _attr(block, /class="[^"]*videoTitle[^"]*"[^>]*>([^<]+)/) ||
        _attr(block, /title="([^"]+)"/)
      );
      // Duration class varies (`duration` vs `bgShadeEffect duration tooltipTrig`),
      // so match the word `duration` anywhere in the <var> class.
      var duration = parseDur(_attr(block, /<var class="[^"]*\bduration\b[^"]*"[^>]*>([^<]+)</));
      var views    = parseViews(_attr(block, /class="[^"]*videoViewCount[^"]*"[^>]*>([^<]+)</));
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

  // Models: /pornstars HTML index (paginated ?page=N). Links /pornstar/{slug};
  // name in alt=, thumb in data-image. modelUrl = /pornstar/{slug} (NO /videos —
  // the existing browseByModel appends "/videos?page=P" itself).
  getModels: function(page) {
    var p = page || 1;
    var url = 'https://www.pornhub.com/pornstars' + (p > 1 ? '?page=' + p : '');
    return cherryFetch(url).then(function(html) {
      return _parseModelIndex(html, {
        hrefRx: /href="(\/pornstar\/[^"\/?#]+)"/g,
        normalizeUrl: function(raw) { return 'https://www.pornhub.com' + raw; },
        nameRx: [/alt="([^"]+)"/, /title="([^"]+)"/],
        // Most performer cards render a plain <img class="pornstarThumb" src="…phncdn…">
        // (no data-image). Fall back to the first <img src|data-thumb_url> after the href.
        thumbRx: [/data-image="(https?:\/\/[^"]+)"/i, /data-mediumthumb="(https?:\/\/[^"]+)"/i,
                  /<img[^>]+(?:data-thumb_url|src)="(https?:\/\/[^"]+\.jpg[^"]*)"/i]
      });
    }).catch(function() { return []; });
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
          // Always proxy WITH referer=pornhub.com. pornhub is force-proxied on Android too
          // (its page is fetched via the proxy, so the ipa=1 token binds to the proxy exit IP,
          // NOT the home IP). The referer makes the worker route the m3u8 + (rewritten) segments
          // through DJB2(pornhub.com) — the SAME SOCKS5 exit as the page fetch — so the token
          // stays valid, and the proxy adds CORS so the inner/built-in player (hls.js) can load it.
          quality[lbl] = buildProxyUrl(hlsUrls[lbl], 'https://www.pornhub.com/');
        });
        // pornhub's per-quality HLS goes through the proxy (residential exit) which caps
        // throughput; 1080p (~4 Mbps) can out-run it and buffer. Default to 720p on Android
        // for smooth start (it still fits the proxy bandwidth) — 1080p stays in the quality
        // menu for users on a fast link. Browser keeps best (direct/faster path).
        var defUrl = (_isAndroid() && quality['720p']) ? quality['720p'] : bestQualityUrl(quality);
        return { url: defUrl, quality: quality };
      }

      return { url: '', quality: {} };
    }).catch(function() { return { url: '', quality: {} }; });
  }
});

// xvideos/xnxx video pages embed related as a JSON array `video_related=[...]`.
function _xvideosRelated(html, host, sourceId) {
  var m = html.match(/video_related\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!m) return [];
  var arr;
  try { arr = JSON.parse(m[1]); } catch (e) { return []; }
  var out = [];
  arr.forEach(function (o) {
    if (!o || !o.u) return;
    var dur;
    var dm = o.d && String(o.d).match(/(\d+)\s*min/);
    if (dm) dur = parseInt(dm[1], 10) * 60;
    out.push({
      id:     o.eid || o.id,
      title:  o.tf || o.t || '',
      thumb:  o.i || o.il || '',
      url:    host + o.u,
      source: sourceId,
      duration: dur,
      hd:     o.hm ? 'HD' : undefined
    });
  });
  return out;
}

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
      // Real preview: the data-pvv attr on the card (a .../preview.mp4 CDN URL).
      // Confirmed via curl on xvideos.com listing markup. No /preview.mp4 guess.
      var pvvMatch = block.match(/data-pvv="([^"]+)"/);
      var preview = pvvMatch ? pvvMatch[1].replace(/\\\//g, '/') : '';

      var titleMatch = block.match(/<p[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)/) ||
                       block.match(/title="([^"]+)"/);
      var title = titleMatch ? stripTags(titleMatch[1]) : '';
      if (!title) title = _titleFromUrl(videoUrl);

      var durMatch = block.match(/<span[^>]*class="[^"]*duration[^"]*"[^>]*>([^<]+)/);
      var duration = durMatch ? parseDur(durMatch[1].trim()) : 0;

      // HD/4K badge: real per-card marker <span class="video-hd-mark">1080p</span>
      // (also 720p/1440p/2160p). Confirmed via curl. 2160 → '4K', else 'HD'.
      var hdMatch = block.match(/class="video-hd-mark"[^>]*>\s*(\d+)/);
      var hd = hdMatch ? (parseInt(hdMatch[1], 10) >= 2160 ? '4K' : 'HD') : '';

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
        hd: hd,
        url: videoUrl,
        duration: duration,
        views: 0
      });
    }
    return items;
  },

  cfg: {
    // Base sorts (map 1:1 to /c/ category path segments AND to search &sort=).
    // The faceted entries below are SEARCH-ONLY (duration/quality/date facets exist
    // only on /?k=); browse() strips the ~facet suffix so they degrade to the base
    // sort if ever chosen on a category. All combos curl-verified (HTTP 200+cards).
    sorts: _cats('views:По популярности,uploaddate:Свежее,rating:По рейтингу,length:Длинные').concat([
      { id: 'rating~quality=hd',                 label: 'Поиск: HD по рейтингу' },
      { id: 'rating~quality=1080P',              label: 'Поиск: 1080p по рейтингу' },
      { id: 'relevance~durf=10min_more',         label: 'Поиск: длинные (10+ мин)' },
      { id: 'relevance~durf=20min_more',         label: 'Поиск: длинные (20+ мин)' },
      { id: 'relevance~durf=1-3min',             label: 'Поиск: короткие (1-3 мин)' },
      { id: 'uploaddate~datef=today',            label: 'Поиск: за сегодня' },
      { id: 'uploaddate~datef=week',             label: 'Поиск: за неделю' },
      { id: 'uploaddate~datef=month',            label: 'Поиск: за месяц' }
    ]),
    categories: _cats('AI-239:AI,Amateur-65:Amateur,Anal-12:Anal,Arab-159:Arab,Asian_Woman-32:Asian,ASMR-229:ASMR,Ass-14:Ass,bbw-51:BBW,Bi_Sexual-62:Bi,Big_Ass-24:Big Ass,Big_Cock-34:Big Cock,Big_Tits-23:Big Tits,Black_Woman-30:Black,Blonde-20:Blonde,Blowjob-15:Blowjob,Brunette-25:Brunette,Cam_Porn-58:Cam Porn,Creampie-40:Creampie,Cuckold-237:Cuckold/Hotwife,Cumshot-18:Cumshot,Femdom-235:Femdom,Fisting-165:Fisting,Fucked_Up_Family-81:Fucked Up Family,Gangbang-69:Gangbang,Gapes-167:Gapes,Indian-89:Indian,Interracial-27:Interracial,Latina-16:Latina,Lesbian-26:Lesbian,Lingerie-83:Lingerie,Mature-38:Mature,Milf-19:Milf,Oiled-22:Oiled,Redhead-31:Redhead,Solo_and_Masturbation-33:Solo,Squirting-56:Squirting,Stockings-28:Stockings,Teen-13:Teen')
  },

  // Parse a (possibly faceted) search sort id into the xvideos /?k= query params.
  // Plain sort ids (views/uploaddate/rating/length) come from the shared sort
  // dropdown and map 1:1 to &sort=. SEARCH-ONLY facets (duration/quality/date)
  // ride along as a `~durf=…~quality=…~datef=…` suffix on the id (no ':' so _cats
  // keeps the id intact). All combos curl-verified (HTTP 200 + cards) on /?k=.
  _searchFacets: function(sort) {
    var s = String(sort || '');
    var parts = s.split('~');
    var out = { sort: parts[0] || '' };
    for (var i = 1; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv[0] && kv[1]) out[kv[0]] = kv[1];   // durf | quality | datef
    }
    return out;
  },

  search: function(query, page, sort) {
    var self = this;
    var p = page || 1;
    // Xvideos p is 0-indexed. Search HONOURS sort + the search-only duration/
    // quality/date facets (previously the sort param was received but ignored).
    var f = self._searchFacets(sort);
    var url = 'https://www.xvideos2.com/?k=' + encodeURIComponent(query) + '&p=' + (p - 1) +
      (f.sort    ? '&sort='    + f.sort    : '') +
      (f.durf    ? '&durf='    + f.durf    : '') +
      (f.quality ? '&quality=' + f.quality : '') +
      (f.datef   ? '&datef='   + f.datef   : '');
    return cherryFetch(url).then(function(html) {
      var items = self._parseCards(html, p);
      // xvideos grid serves ~27 cards/page; full batch ⇒ next page exists.
      return { items: items, total_pages: _derivePages(items.length, p, 20) };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  browse: function(category, page, sort) {
    var self = this;
    var p = page || 1;
    var pageIdx = p - 1;
    var url;
    // Category/homepage listings accept ONLY the base sort (duration/quality/date
    // facets are search-only on xvideos), so strip any ~facet suffix here.
    var baseSort = self._searchFacets(sort).sort;
    if (category) {
      // /c/s:{value}/{Label-id}/{page} — sort is a path segment BEFORE the slug;
      // page is 0-based, omitted on page 1. Default sort = views (По популярности).
      var s = baseSort || 'views';
      url = _buildCatUrl('https://www.xvideos.com/c/s:' + s + '/{slug}/{page}', category, p, 0, true);
    } else {
      // Non-category homepage: sort='views' → /best/ prefix; else /
      var base = (baseSort === 'views') ? 'https://www.xvideos2.com/best/' : 'https://www.xvideos2.com/';
      url = pageIdx === 0 ? base : base + pageIdx;
    }
    return cherryFetch(url).then(function(html) {
      var items = self._parseCards(html, p);
      return { items: items, total_pages: _derivePages(items.length, p, 20) };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  // Map ONE xvideos profile-videos JSON object to a card identical in shape to
  // _parseCards output (id/source/title/thumb/preview/hd/url/duration). The model
  // page does NOT server-render thumb-block cards — it loads them from the JSON
  // endpoint /profiles/{slug}/videos/best/{page}. The video URL is built from the
  // `eid` token as /video.{eid}/{slug} (same canonical form _parseCards yields, so
  // getStream is unchanged); preview is the per-card ipu (…/preview.mp4) attr.
  _mapModelVideo: function(o) {
    if (!o || !o.eid) return null;
    var dur = 0;
    var dm = o.d && String(o.d).match(/(\d+)\s*min/);
    if (dm) dur = parseInt(dm[1], 10) * 60;
    return {
      id:       'xv' + o.eid,
      source:   'xvideos',
      title:    _decodeHtml(o.tf || o.t || ''),
      thumb:    o.il || o.i || o.ip || '',
      preview:  o.ipu || '',
      hd:       o.hm ? (/2160|4k/i.test(String(o.h || '')) ? '4K' : 'HD') : '',
      // /video.{eid}/{slug}: slug is cosmetic (token resolves the page), but pull
      // the real slug from `u` (…/{eid}/{slug}) when present for a clean URL.
      url:      'https://www.xvideos.com/video.' + o.eid + '/' +
                ((String(o.u || '').match(/\/[a-z0-9]+\/([^\/?#]+)\/?$/) || [, o.eid])[1]),
      duration: dur,
      views:    parseViews(String(o.n || 0))
    };
  },

  browseByModel: function(modelUrl, page) {
    var self = this;
    var p = page || 1;
    var pageIdx = p - 1;
    // modelUrl is the /pornstars/{slug} (or /profiles/{slug}) page. Its videos are
    // served from a sibling JSON endpoint /profiles/{slug}/videos/best/{pageIdx}.
    // Normalize ANY /pornstars|/models|/profiles base to /profiles/{slug}.
    var slugM = modelUrl.replace(/\/$/, '').match(/\/(?:pornstars|models|profiles)\/([^\/?#]+)/);
    var slug = slugM ? slugM[1] : modelUrl.replace(/\/$/, '').split('/').pop();
    var url = 'https://www.xvideos.com/profiles/' + slug + '/videos/best/' + pageIdx;
    return cherryFetch(url).then(function(text) {
      var data;
      try { data = JSON.parse(text); } catch (e) { data = null; }
      var vids = (data && data.videos) || [];
      var items = [];
      vids.forEach(function(o) { var c = self._mapModelVideo(o); if (c) items.push(c); });
      // total_pages from nb_videos / nb_per_page when present, else derive.
      var total = (data && data.nb_videos && data.nb_per_page)
        ? Math.ceil(data.nb_videos / data.nb_per_page)
        : _derivePages(items.length, p, 20);
      return { items: items, total_pages: total || 1 };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  // Models: /pornstars-index → /pornstars/{slug} links. ONLY the /pornstars/
  // links are used (they render thumb-block cards parseable by _parseCards via
  // browseByModel); /models/{slug} pages use a non-thumb-block markup _parseCards
  // misses, so they are skipped. Each card carries the avatar in an <img src=
  // "…xvideos-cdn…"> (inside a document.write) and the name as the <a> link text.
  getModels: function() {
    return cherryFetch('https://www.xvideos.com/pornstars-index').then(function(html) {
      return _parseModelIndex(html, {
        hrefRx: /href="(\/pornstars\/[^"\/?#]+)"/g,
        normalizeUrl: function(raw) { return 'https://www.xvideos.com' + raw; },
        nameRx: [/<a[^>]*href="\/pornstars\/[^"]+"[^>]*>([^<]{2,60})<\/a>/],
        thumbRx: [/<img[^>]+src="(https?:\/\/[^"]+xvideos-cdn[^"]+\.jpg)"/i,
                  /(?:data-src|src)="(https?:\/\/[^"]+\.jpg)"/i]
      });
    }).catch(function() { return []; });
  },

  getRelated: function(video) {
    if (!video || !video.url) return Promise.resolve([]);
    return cherryFetch(video.url).then(function(html) {
      return _xvideosRelated(html, 'https://www.xvideos.com', 'xvideos').filter(function(v) {
        return v.url !== video.url;
      }).slice(0, 20);
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

      // Prefer HLS everywhere: its adaptive ladder carries 1080p/4K, while xvideos'
      // progressive `setVideoUrlHigh` MP4 caps at ~720p → looked "low quality" on a 4K TV.
      // Modern Android players (Google TV / ExoPlayer) play the HLS master inline. The MP4
      // High/Low entries stay in the quality map as a manual fallback for any player that
      // can't do HLS (so they're never stranded), but the default is HLS.
      var quality = {};
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

    // Split on the OUTER card wrapper (thumb-block) — like xvideos — so each
    // block holds BOTH this card's .thumb image and its .thumb-under caption.
    // Splitting on the inner thumb-under caused an off-by-one: data-src (in
    // .thumb of the NEXT card) was paired with the href/title of the current.
    var blocks = content.split(/<div[^>]+class="[^"]*thumb-block[^"]*"/);
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
      // Real preview: the data-pvv attr on the card (a .../preview.mp4 CDN URL).
      // Confirmed via curl on xnxx.com/search listing markup. No /preview.mp4 guess.
      var pvvMatch = block.match(/data-pvv="([^"]+)"/);
      var preview = pvvMatch ? pvvMatch[1].replace(/\\\//g, '/') : '';

      var titleMatch = block.match(/class="title"[^>]*>([^<]+)/) ||
                       block.match(/title="([^"]+)"/) ||
                       block.match(/<a[^>]+>([^<]{5,})/);
      var title = titleMatch ? stripTags(titleMatch[1]) : '';
      if (!title) title = _titleFromUrl(videoUrl);

      // Duration is BARE text inside <p class="metadata"> (after the views <span>,
      // before the <span class="video-hd">): e.g. `…</span>\n5min\n<span class="video-hd">`.
      // It is NOT wrapped in its own span, so grab the first bare HH:MM / Nmin / NhNm
      // token within this card's metadata paragraph (anchored to the block chunk).
      var metaMatch = block.match(/class="metadata"[^>]*>([\s\S]*?)<\/p>/);
      var metaTxt = metaMatch ? metaMatch[1] : block;
      var durMatch = metaTxt.match(/(\d+h\s*)?\d+\s*min\b|\d+:\d+/i);
      var duration = durMatch ? parseDur(durMatch[0].trim()) : 0;

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
      // xnxx grid serves ~27 cards/page; full batch ⇒ next page exists.
      return { items: items, total_pages: _derivePages(items.length, p, 20) };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  cfg: { categories: _cats('amateur:Amateur,anal:Anal,asian:Asian,bbw:BBW,big-ass:Big Ass,big-tits:Big Tits,blonde:Blonde,blowjob:Blowjob,brunette:Brunette,creampie:Creampie,cumshot:Cumshot,ebony:Ebony,gangbang:Gangbang,hardcore:Hardcore,hentai:Hentai,interracial:Interracial,japanese:Japanese,latina:Latina,lesbian:Lesbian,massage:Massage,mature:Mature,milf:MILF,pov:POV,public:Public,redhead:Redhead,step-mom:Step Mom,teen:Teen,threesome:Threesome'),
    // Sort is a FILTER prefix on the paginating /search/{filter}/{slug}/{page} route
    // (the abandoned /tags/{slug}/{sort} route ignored the page param). Verified: this
    // route returns 200 + distinct first-ids per filter AND paginates (page2 ≠ page1).
    // hits = most-viewed (популярность); month/year = top of period.
    sorts: _cats('hits:По популярности,month:Топ за месяц,year:Топ за год') },

  browse: function(category, page, sort) {
    var self = this;
    var p = page || 1;
    // xnxx categories via the /search/{slug}/{page} route, which DOES paginate
    // (the /tags/ route ignores the page number → infinite page-1 duplicates).
    // With a sort chosen, prepend it as a filter segment: /search/{sort}/{slug}/{page}.
    var prefix = sort ? encodeURIComponent(sort) + '/' : '';
    // NO category → /todays-selection (xnxx's curated cross-topic homepage feed).
    // Was /?k=new&p=N — a KEYWORD SEARCH for the word "new" (videos with "new" in the
    // title), NOT a recency feed. /todays-selection paginates /todays-selection/{p}
    // (p1 = bare, real p1≠p2), 48 cards/page, and is month-INDEPENDENT (never goes stale,
    // unlike /best/{YYYY-MM}). Curl-verified 200 + distinct paginated cross-topic cards.
    var url = category
      ? 'https://www.xnxx.com/search/' + prefix + encodeURIComponent(category) + '/' + p
      : (p > 1 ? 'https://www.xnxx.com/todays-selection/' + p : 'https://www.xnxx.com/todays-selection');
    return cherryFetch(url).then(function(html) {
      var items = self._parseCards(html);
      return { items: items, total_pages: _derivePages(items.length, p, 20) };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  getRelated: function(video) {
    if (!video || !video.url) return Promise.resolve([]);
    return cherryFetch(video.url).then(function(html) {
      return _xvideosRelated(html, 'https://www.xnxx.com', 'xnxx').filter(function(v) {
        return v.url !== video.url;
      }).slice(0, 20);
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

      // Prefer HLS everywhere: its adaptive ladder carries 1080p/4K, while the progressive
      // `setVideoUrlHigh` MP4 caps at ~720p → "low quality" on a 4K TV. Google TV / ExoPlayer
      // plays the HLS master inline; MP4 High/Low stay in the map as a manual fallback.
      var quality = {};
      if (hlsUrl) quality['HLS'] = hlsUrl;
      if (highUrl) quality['MP4 High'] = highUrl;
      if (lowUrl) quality['MP4 Low'] = lowUrl;

      var url = hlsUrl || highUrl || lowUrl || '';
      return { url: url, quality: quality };
    }).catch(function() { return { url: '', quality: {} }; });
  }
});

// eporner VIDEO pages embed related as `mbcontent` HTML cards (the JSON API,
// used by browse/_mapVideo, returns none for a video page). Each card:
//   <div class="mbcontent"><a href="/video-XXX/slug/">
//     <img ... data-src="THUMB" alt="TITLE" /></a> ... <div class="mvhdico"><span>720p</span>
// Confirmed via curl on a real video page (2026-06).
function _epornerRelated(html) {
  var out = [];
  var seen = {};
  var rx = /<div class="mbcontent"><a href="(\/video-([^/"]+)\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  var m;
  while ((m = rx.exec(html)) !== null) {
    var path = m[1];
    var id = m[2];
    var inner = m[3];
    if (seen[id]) continue;
    seen[id] = true;
    var url = 'https://www.eporner.com' + path;
    var thumb = _attr(inner, /data-src="([^"]+)"/) || _attr(inner, /src="(https?:\/\/[^"]+\.jpe?g[^"]*)"/i) || '';
    var title = _decodeHtml(_attr(inner, /alt="([^"]+)"/)) || _titleFromUrl(url);
    out.push({ id: id, source: 'eporner', title: title, thumb: thumb, url: url });
  }
  return out;
}

// ---- Eporner ----
SOURCES.push({
  id: 'eporner',
  name: 'Eporner',
  host: 'eporner.com',
  cfg: { categories: _cats('4k-porn:4K Ultra HD,vr-porn:VR Porn,amateur:Amateur,anal:Anal,asian:Asian,asmr:ASMR,bbw:BBW,bdsm:BDSM,big-ass:Big Ass,big-dick:Big Dick,big-tits:Big Tits,bisexual:Bisexual,blonde:Blonde,blowjob:Blowjob,bondage:Bondage,brunette:Brunette,bukkake:Bukkake,creampie:Creampie,cumshot:Cumshot,double-penetration:Double Penetration,ebony:Ebony,fetish:Fetish,fisting:Fisting,footjob:Footjob,for-women:For Women,gay:Gay,group-sex:Group Sex,handjob:Handjob,hardcore:Hardcore,hentai:Hentai,homemade:Homemade,indian:Indian,interracial:Interracial,japanese:Japanese,latina:Latina,lesbians:Lesbian,lingerie:Lingerie,massage:Massage,masturbation:Masturbation,mature:Mature,milf:MILF,orgy:Orgy,outdoor:Outdoor,petite:Petite,pornstar:Pornstar,pov-porn:POV,public:Public,redhead:Redhead,shemale:Shemale,small-tits:Small Tits,squirt:Squirt,striptease:Striptease,students:Students,swingers:Swinger,teens:Teen,threesome:Threesome,toys:Toys,uniform:Uniform,vintage:Vintage,webcam:Webcam'), sorts: _cats('latest:Свежее,most-popular:По популярности,top-rated:По рейтингу,longest:Длинные,top-weekly:За неделю,top-monthly:За месяц').concat([
    // Orientation filter via the API `gay` param (0=straight default, 1=gay, 2=trans).
    // Encoded as a `~gayN` suffix on the order id (no ':' so _cats keeps it intact);
    // _orient() splits it back into {order, gay}. Curl-verified each value returns a
    // distinct content vertical. Straight is the default everywhere (gay omitted).
    { id: 'latest~gay1', label: 'Гей' },
    { id: 'latest~gay2', label: 'Транс' }
  ]) },

  // Split a (possibly orientation-suffixed) sort id "order~gayN" into the order +
  // gay API params. No suffix → straight (gay=0). Mirrors pornhub's _sortParams.
  _orient: function(sort) {
    var m = String(sort || '').match(/^(.*?)~gay([012])$/);
    if (m) return { order: m[1] || 'most-popular', gay: m[2] };
    return { order: sort || 'most-popular', gay: '0' };
  },

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

  search: function(query, page, sort) {
    var self = this;
    var p = page || 1;
    // A3(a): SEARCH uses eporner's default/relevance order (NO order param) so real
    // title matches surface instead of being drowned by all-time-popular videos.
    // browse() below keeps order=most-popular intentionally (category = popularity sort).
    // Orientation (&gay=) is honoured from the sort id's ~gayN suffix (default straight=0).
    var gay = self._orient(sort).gay;
    var url = 'https://www.eporner.com/api/v2/video/search/?query=' + encodeURIComponent(query) +
      '&per_page=30&page=' + p + '&thumbsize=medium&gay=' + gay + '&format=json';
    return self._apiFetch(url).then(function(text) {
      var data = JSON.parse(text);
      return { items: (data.videos || []).map(self._mapVideo), total_pages: parseInt(data.total_pages, 10) || 1 };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  browse: function(category, page, sort) {
    var self = this;
    var p = page || 1;
    // Category via the JSON API search (slug → keyword); reuses _mapVideo. Hyphen → space.
    var q = category ? encodeURIComponent(category.replace(/-/g, ' ')) : '';
    // Native API order param (default popular). All values curl-verified.
    // Orientation (&gay=) is carried in the sort id's ~gayN suffix (default straight=0);
    // _orient() returns the bare order for normal sorts so existing behaviour is unchanged.
    var o = self._orient(sort);
    var url = 'https://www.eporner.com/api/v2/video/search/?query=' + q + '&per_page=30&page=' + p +
      '&thumbsize=medium&order=' + o.order + '&gay=' + o.gay + '&format=json';
    return self._apiFetch(url).then(function(text) {
      var data = JSON.parse(text);
      return { items: (data.videos || []).map(self._mapVideo), total_pages: parseInt(data.total_pages, 10) || 1 };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  getRelated: function(video) {
    if (!video || !video.url) return Promise.resolve([]);
    return cherryFetch(video.url).then(function(html) {
      return _epornerRelated(html).filter(function(v) {
        return v.url !== video.url;
      }).slice(0, 20);
    }).catch(function() { return []; });
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
  cfg: { categories: _cats('amateur:Любительское,anal:Анал,anime:Аниме,arab:Арабское,asian:Азиатки,ass:Жопа,babe:Красотки,bbc:BBC,bbw:BBW,bdsm:БДСМ,blonde:Блондинки,blowjob:Минет,bondage:Бондаж,british:Британское,brunette:Брюнетки,busty:Грудастые,cam:Вебкам,casting:Кастинг,cheating:Измена,chinese:Китайское,compilation:Компиляция,cosplay:Косплей,creampie:Кремпай,cuckold:Куколд,cumshot:Камшот,ebony:Чёрные,feet:Ножки,femdom:Фемдом,fetish:Фетиш,gangbang:Групповуха,hentai:Хентай,indian:Индийское,japanese:Японское,latina:Латинки,massage:Массаж,milf:MILF,pov:POV,shemale:Трансы,solo:Соло,squirt:Сквирт,stepmom:Мачеха,teen:Молодые,big+tits:Большие сиськи,big+ass:Большая жопа'),
    // GLOBAL-feed sorts: per-category sort unsupported; sort is a separate listing root /{sort}/{page}/.
    sorts: _cats('new_videos:Свежее,most_popular:По популярности,trending_videos:В тренде,upcoming:Скоро') },
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
      if (!title) title = _titleFromUrl(videoUrl);

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

  browse: function(category, page, sort) {
    var self = this;
    var p = page || 1;
    // CATEGORY (search-as-category) → /s/{slug}/{page}/ (no sort — site has no per-category sort).
    // NO category → GLOBAL sorted feed /{sort}/{page}/, defaulting to most_popular (По популярности).
    var url = category
      ? _buildCatUrl('https://ru.spankbang.com/s/{slug}/{page}/', category, p, 1, true)
      : 'https://ru.spankbang.com/' + (sort || 'most_popular') + '/' + p + '/';
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
    // Canonical GET search: form is <form method="get" action="/"> → /?q={query}&p={N}
    // with a real paginator (?q=...&p=2, &p=3). The old /search/{slug}/ route soft-404s
    // (falls back to the "anal" category → wrong cards). 50 cards/page → _derivePages(50).
    var self = this;
    var p = page || 1;
    var url = 'https://hqporner.com/?q=' + encodeURIComponent(query) + '&p=' + p;
    return cherryFetch(url).then(function(html) {
      var items = self._parseCards(html);
      return { items: items, total_pages: _derivePages(items.length, p, 50) };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  cfg: { categories: _cats('4k-porn:4K porn,1080p-porn:1080p porn,60fps-porn:60 FPS porn,amateur:Amateur,anal-sex-hd:Anal,asian:Asian,babe:Babe,bdsm:BDSM,beach-porn:Beach,big-ass:Big ass,big-dick:Big dick,big-tits:Big tits,bisexual:Bisexual,blonde:Blonde,blowjob:Blowjob,bondage:Bondage,brunette:Brunette,casting:Casting,creampie:Creampie,cumshot:Cumshot,deepthroat:Deepthroat,ebony:Ebony,fetish:Fetish,fingering:Fingering,fisting:Fisting,gangbang:Gangbang,group-sex:Group sex,hairy-pussy:Hairy pussy,handjob:Handjob,hentai:Hentai,interracial:Interracial,japanese-girls-porn:Japanese,latina:Latina,lesbian:Lesbian,long-hair:Long hair,masturbation:Masturbation,mature:Mature,milf:MILF,old-and-young:Old and young,orgasm:Orgasm,orgy:Orgy,outdoor:Outdoor,pickup:Pickup,pov:POV,public:Public,pussy-licking:Pussy licking,redhead:Redhead,russian:Russian,porn-massage:Sex massage,sex-parties:Sex party,shaved-pussy:Shaved pussy,shemale:Shemale,small-tits:Small tits,squirt:Squirt,stockings:Stockings,tattooed:Tattooed,teen-porn:Teen porn,threesome:Threesome,vintage:Vintage'),
    // GLOBAL-feed sorts: per-category sort unsupported; sorts are base-path swaps.
    // 'top/week'/'top/month' are slash-bearing path bases → https://hqporner.com/top/week/{p}.
    sorts: _cats('hdporn:Свежее,top:По популярности,top/week:За неделю,top/month:За месяц') },

  browse: function(category, page, sort) {
    var self = this;
    var p = page || 1;
    // CATEGORY → /category/{slug}/{page} (no sort — site has no per-category sort).
    // NO category → GLOBAL feed base /{sort} (default top = По популярности); page appended as /{p} when p>1.
    var url;
    if (category) {
      url = _buildCatUrl('https://hqporner.com/category/{slug}/{page}', category, p, 1, true);
    } else {
      var base = 'https://hqporner.com/' + (sort || 'top');
      url = p > 1 ? base + '/' + p : base;
    }
    return cherryFetch(url).then(function(html) {
      var items = self._parseCards(html);
      // Generous forward window; the cross-page dedup guard caps it cleanly at the real
      // end. (The old `/hdporn/N` page-number scrape matched the leading digits of video
      // SLUGS, e.g. /hdporn/82041-... → 82041, producing a huge bogus total_pages.)
      return { items: items, total_pages: _derivePages(items.length, p, 50) };
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
            // Return RAW stream URLs — px() in playVideo is the single proxy-decision
            // point (browser → proxied via buildProxyUrl, Android → raw device-IP fetch).
            var quality = {};
            heights.forEach(function(h) {
              quality[h + 'p'] = 'https://' + cdnHost + '/pubs/' + hash + '/' + h + '.mp4';
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
  cfg: { categories: _cats('amateur:Amateur,anal:Anal,asian:Asian,bbc:BBC,big-ass:Big Ass,big-tits:Big Tits,blonde:Blonde,blowjob:Blowjob,casting:Casting,compilation:Compilation,creampie:Creampie,daddy:Daddy,ebony:Ebony,gangbang:Gangbang,hentai:Hentai,homemade:Homemade,interracial:Interracial,japanese:Japanese,japanese-uncensored:Japanese Uncensored,japanese-wife:Japanese Wife,latina:Latina,massage:Massage,mature:Mature,milf:MILF,mind-control:Mind Control,pinay:Pinay,pov:POV,sister:Sister,sleeping:Sleeping,stepdaughter:Stepdaughter,stepmom:Stepmom,stepmom-and-son:Stepmom And Son,stepsister:Stepsister,superheroine:Superheroine,taboo:Taboo,teen:Teen,threesome:Threesome,ai-generated:AI Generated,czech-streets:Czech Streets,private-society:Private Society'),
    // GLOBAL-feed sorts: per-category sort unsupported; sort is a separate listing root /{sort}/{page}.html.
    sorts: _cats('most-popular:По популярности,trending:В тренде,top-rated:По рейтингу,top-rated-week:Топ за неделю,top-rated-month:Топ за месяц,highdefinition:Только HD,newest-clips:Свежее') },
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
      // Decode HTML entities (&amp; etc.) like other adapters before the URL fallback.
      if (title) title = _decodeHtml(title);
      if (!title) title = _titleFromUrl(videoUrl);

      // Duration: real markup is <span class="time"><i class="fa fa-clock-o"></i>&nbsp;11:23</span>
      // (NOT class="duration"). Capture the bare HH:MM / Nmin token after the icon+&nbsp;.
      var durMatch = block.match(/class="time"[^>]*>(?:\s*<[^>]+>)*\s*(?:&nbsp;)?\s*([\d:]+(?:\s*min)?)/i) ||
                     block.match(/<div[^>]*class="[^"]*duration[^"]*"[^>]*>([^<]+)/);
      var duration = durMatch ? parseDur(durMatch[1].trim()) : 0;

      // HD badge: real per-card marker <span class="i-hd" ...>HD</span>.
      // Confirmed via curl on youjizz.com. No resolution exposed → 'HD' only.
      var hd = /class="i-hd"/.test(block) ? 'HD' : '';

      // Views: real per-card marker <span class="format-views">236827</span>.
      var viewsMatch = block.match(/class="[^"]*format-views[^"]*"[^>]*>\s*([\d.,]+)/);
      var views = viewsMatch ? parseViews(viewsMatch[1]) : 0;

      // Hover-preview mp4 — the <a class="frame video"> carries data-clip="…-clip.mp4?…".
      // URL is protocol-relative (//cdne-mobile.youjizz.com/…); prefix https:.
      var pvM = block.match(/data-clip="([^"]+\.mp4[^"]*)"/i);
      var preview = pvM ? pvM[1].replace(/^\/\//, 'https://') : '';

      items.push({
        id: 'yj-' + id,
        source: 'youjizz',
        title: title,
        thumb: thumb,
        hd: hd,
        url: videoUrl,
        duration: duration,
        views: views,
        preview: preview || undefined
      });
    }
    return items;
  },

  search: function(query, page) {
    var self = this;
    var p = page || 1;
    var q = encodeURIComponent(query);
    var url = 'https://www.youjizz.com/search/videos/' + q + '-' + p + '.html';
    // Status-tolerant: this search route can return a non-200 whose body still holds
    // result cards (datacenter IP saw a 404); cherryFetch would throw and drop them.
    return _fetchAny(url).then(function(html) {
      var items = self._parseCards(html);
      // Pagination: look for highest page link
      var pgNums = [];
      var pgRe = /\/search\/videos\/[^"]*-(\d+)\.html/g;
      var m;
      while ((m = pgRe.exec(html)) !== null) {
        var n = parseInt(m[1], 10);
        if (!isNaN(n)) pgNums.push(n);
      }
      // Prefer the real last-page link; fall back to batch fullness (~30/page).
      var total = pgNums.length ? Math.max.apply(null, pgNums) : _derivePages(items.length, p, 20);
      return { items: items, total_pages: total };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  browse: function(category, page, sort) {
    var self = this;
    var p = page || 1;
    if (category) {
      // CATEGORY → /categories/{slug}-{page}.html (1-based page baked into filename; no sort).
      var curl = _buildCatUrl('https://www.youjizz.com/categories/{slug}-{page}.html', category, p, 1, false);
      return cherryFetch(curl).then(function(html) {
        var items = self._parseCards(html);
        return { items: items, total_pages: _derivePages(items.length, p, 20) };
      }).catch(function() { return { items: [], total_pages: 0 }; });
    }
    // NO category → GLOBAL sorted feed /{sort}/{page}.html (1-based), default most-popular (По популярности).
    // (Replaces the old paginationless homepage browse, which also fixes its missing pagination.)
    var url = 'https://www.youjizz.com/' + (sort || 'most-popular') + '/' + p + '.html';
    return cherryFetch(url).then(function(html) {
      var items = self._parseCards(html);
      return { items: items, total_pages: _derivePages(items.length, p, 20) };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  getRelated: function(video) {
    var self = this;
    if (!video || !video.url) return Promise.resolve([]);
    return cherryFetch(video.url).then(function(html) {
      return self._parseCards(html).filter(function(v) {
        return v.url !== video.url;
      }).slice(0, 20);
    }).catch(function() { return []; });
  },

  getStream: function(video) {
    return cherryFetch(video.url).then(function(html) {
      var encMatch = html.match(/Encodings\s*=\s*(\[[\s\S]+?\]);/);
      if (!encMatch) return extractStreams(html);

      var encodings;
      try { encodings = JSON.parse(encMatch[1]); } catch (e) { return extractStreams(html); }

      if (!encodings || !encodings.length) return extractStreams(html);

      // Encodings carries BOTH progressive MP4 (cdne-mobile…-h264.mp4) and HLS
      // (abre-videos…/_hls/…/master.m3u8) entries under IDENTICAL quality labels
      // (240p…1080p). Taking them indiscriminately let the later HLS entries clobber
      // the MP4 ones in the quality map, so Lampa got handed an .m3u8 it can't play
      // inline → external-player picker. Prefer the directly-playable MP4 set; the
      // px() layer normalizes //protocol-relative and proxies it for inline playback.
      var quality = {};
      var firstUrl = '';

      function isHls(u) { return /\.m3u8(\?|$)/i.test(u) || /\/_hls\//i.test(u); }

      encodings.forEach(function(enc) {
        // Each entry: { filename: 'url', quality: '720', ... }
        var u = enc.filename || enc.url || enc.file || '';
        if (!u || isHls(u)) return;            // skip HLS — keep direct MP4 only
        // youjizz's cdne-mobile CDN PACES each progressive MP4 to ~1.5× its own bitrate,
        // so 1080p (≈3.6 Mbps, served at only ~5.5 Mbps) starts/buffers slowly on a TV.
        // On Android the player defaults to the highest quality → cap at ≤720p (≈1.35 Mbps,
        // ~1.6× headroom = smooth). Browser keeps all qualities. If a video somehow has
        // only >720p, the fallback block below still surfaces it.
        if (_isAndroid() && parseInt(enc.quality, 10) > 720) return;
        var label = enc.quality ? enc.quality + 'p' : (enc.label || enc.format || 'mp4');
        if (!firstUrl) firstUrl = u;
        quality[label] = u;
      });

      // Fallback: if a video somehow exposes ONLY HLS, surface it rather than nothing.
      if (!firstUrl) {
        encodings.forEach(function(enc) {
          var u = enc.filename || enc.url || enc.file || '';
          if (!u) return;
          var label = enc.quality ? enc.quality + 'p' : (enc.label || enc.format || 'mp4');
          if (!firstUrl) firstUrl = u;
          quality[label] = u;
        });
      }

      return { url: firstUrl, quality: quality };
    }).catch(function() { return { url: '', quality: {} }; });
  }
});

// ---- 15. PornOne ----
SOURCES.push({
    id: 'pornone',
    name: 'PornOne',
    host: 'pornone.com',
    cfg: { categories: _cats('amateur:Amateur,anal:Anal,asian:Asian,ass:Ass,babes:Babes,bbc:Bbc,bbw:BBW,bdsm:Bdsm,big-boobs:Big Boobs,big-dick:Big Dick,blonde:Blonde,blowjob:Blowjob,brunette:Brunette,bukkake:Bukkake,busty:Busty,cougar:Cougar,creampie:Creampie,cuckold:Cuckold,cumshot:Cumshot,deepthroat:Deepthroat,ebony:Ebony,fetish:Fetish,gangbang:Gangbang,granny:Granny,hairy:Hairy,handjob:Handjob,hardcore:Hardcore,hentai:Hentai,homemade:Homemade,interracial:Interracial,japanese:Japanese,latin:Latin,lesbian:Lesbian,massage:Massage,mature:Mature,milf:MILF,mom:Mom,pawg:Pawg,petite:Petite,pov:POV,public:Public,redhead:Redhead,russian:Russian,squirting:Squirting,stepmom:Stepmom,teen:Teen,threesome:Threesome,toys:Toys,webcams:Webcams,young:Young'), sorts: _cats('newest:Свежее,views:По популярности,views/week:Популярное за неделю,views/month:Популярное за месяц,rating:По рейтингу') },

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
            // WP API per_page=20 → full batch implies a next page.
            if (items) return { items: items, total_pages: _derivePages(items.length, p, 20) };
            throw new Error('api-empty');
        }).catch(function () {
            var url = 'https://pornone.com/?s=' + encodeURIComponent(query) + '&paged=' + p;
            return cherryFetch(url).then(function (html) {
                var items = _pornoneCards(html);
                return { items: items, total_pages: _pornonePages(html, p, items.length) };
            }).catch(function () { return { items: [], total_pages: 0 }; });
        });
    },

    browse: function (category, page, sort) {
        var self = this;
        var p = page || 1;
        if (category) {
            // Category browses at ROOT /{slug}/{sort}/{page}/ (HTML); reuse _pornoneCards parser.
            // Sort is a path segment after the slug. Default = newest (Свежее) — matches the
            // site homepage's "New Porn Videos" ordering; /{slug}/newest/ curl-verified distinct.
            var s = sort || 'newest';
            var curl = _buildCatUrl('https://pornone.com/{slug}/' + s + '/{page}/', category, p, 1, true);
            return cherryFetch(curl).then(function (html) {
                var items = _pornoneCards(html);
                return { items: items, total_pages: _pornonePages(html, p, items.length) };
            }).catch(function () { return { items: [], total_pages: 0 }; });
        }
        var apiUrl = 'https://pornone.com/wp-json/wp/v2/posts?orderby=date&order=desc' +
            '&per_page=20&page=' + p +
            '&_embed=wp%3Afeaturedmedia&_fields=id,title,link,_embedded';
        return cherryFetch(apiUrl).then(function (text) {
            var items = self._fromApi(text);
            if (items) return { items: items, total_pages: _derivePages(items.length, p, 20) };
            throw new Error('api-empty');
        }).catch(function () {
            var url = p > 1
                ? 'https://pornone.com/page/' + p + '/'
                : 'https://pornone.com/';
            return cherryFetch(url).then(function (html) {
                var items = _pornoneCards(html);
                return { items: items, total_pages: _pornonePages(html, p, items.length) };
            }).catch(function () { return { items: [], total_pages: 0 }; });
        });
    },

    getRelated: function (video) {
        if (!video || !video.url) return Promise.resolve([]);
        return cherryFetch(video.url).then(function (html) {
            return _pornoneCards(html).filter(function (v) { return v.url !== video.url; }).slice(0, 20);
        }).catch(function () { return []; });
    },

    getStream: function (video) {
        return cherryFetch(video.url).then(function (html) {
            var clean = html.replace(/\\\//g, '/').replace(/\\"/g, '"');
            // The player's <source> tags carry the REAL stream:
            //   <source src="https://sNNNN.pornone.com/vid2/.../{id}_WxH_Nk.mp4?lang=en" res="720">
            // Anchor strictly on the pornone CDN host so we never pick up the
            // gallery.vcmdiawe.com livecam ad clips (the "short video that closes fast" bug).
            var srcRx = /<source\s+src="(https?:\/\/s\d+\.pornone\.com\/vid2\/[^"]+?\.mp4[^"]*)"[^>]*?(?:res|label)="(\d+)p?"/gi;
            // Return RAW stream URLs — px() in playVideo is the single proxy-decision
            // point (browser → proxied, Android → raw device-IP fetch so IP-bound
            // KVS tokens match the natively-fetched page).
            var quality = {};
            var best = '', bestRes = -1, sm;
            while ((sm = srcRx.exec(clean)) !== null) {
                var url = sm[1], res = parseInt(sm[2], 10) || 0;
                quality[res + 'p'] = url;
                if (res > bestRes) { bestRes = res; best = url; }
            }
            if (best) {
                return { url: best, quality: quality };
            }
            // Fallback: JSON-LD contentUrl (always the real pornone CDN, never the ad clip).
            var ld = clean.match(/"contentUrl"\s*:\s*"(https?:\/\/s\d+\.pornone\.com\/vid2\/[^"]+?\.mp4[^"]*)"/i) ||
                     clean.match(/(https?:\/\/s\d+\.pornone\.com\/vid2\/[^"'\s]+?\.mp4[^"'\s]*)/i);
            if (ld) return { url: ld[1], quality: {} };
            return { url: '', quality: {} };
        }).catch(function () { return { url: '', quality: {} }; });
    }
});

function _pornoneCards(html) {
    var items = [];
    // Real video cards are <a class="…videocard…"> anchors whose href is the canonical
    // video URL  https://pornone.com/{cat}/{title-slug}/{id}/[?rr=NNN]  (34–35 per page).
    // Anchor ON the videocard class — this skips nav/lang/pagination links AND the
    // viewsIcon stat elements that the old slug-windowing parser turned into junk cards.
    var cardRx = /<a\s+href="(https?:\/\/pornone\.com\/[^"]*?\/(\d{4,})\/[^"]*)"[^>]*class="[^"]*videocard[^"]*"/gi;
    var seen = {};
    var m;
    while ((m = cardRx.exec(html)) !== null) {
        var videoUrl = m[1].replace(/[?&]rr=\d+/, '');   // strip the rotation tracker param
        var id = m[2];
        if (!id || seen[id]) continue;
        seen[id] = true;

        // Card body runs to the closing </a>; cap the lookahead so cards can't bleed.
        var end = html.indexOf('</a>', m.index);
        var chunk = html.slice(m.index, end === -1 ? m.index + 2500 : end + 4);

        // Thumb: poster .jpg lives in data-src (lazy) or a populated src; either way it
        // sits under /t/.../{b|d}NNN.jpg — match the FILE, not the data-path directory.
        // data-path + first data-thumbs frame is the final fallback.
        var thumb = _attr(chunk, /(?:data-src|src)="(https?:\/\/th-eu4\.pornone\.com\/t\/[^"]+\.jpe?g)"/i);
        if (!thumb) {
            var base = _attr(chunk, /data-path="(https?:\/\/th-eu4\.pornone\.com\/[^"]+?)"/i);
            var frame = _attr(chunk, /data-thumbs="\[(\d+)/);
            if (base && frame) thumb = base + 'b' + frame + '.jpg';
        }

        var title = _decodeHtml(
            _attr(chunk, /<div[^>]*class="[^"]*videotitle[^"]*"[^>]*>([^<]+)<\/div>/i) ||
            _attr(chunk, /th-eu4\.pornone\.com\/[^"]+"\s+alt="([^"]{6,})"/i)
        );
        if (!title) title = _titleFromUrl(videoUrl);

        // Duration sits in the .durlabel span as MM:SS (HD svg precedes the digits).
        var duration = parseDur(_attr(chunk, /class="[^"]*durlabel[^"]*"[\s\S]*?(\d{1,2}:\d{2}(?::\d{2})?)/i));
        // Views follow the <i class="…viewsIcon"></i> marker.
        var views    = parseViews(_attr(chunk, /viewsIcon[^>]*><\/i>\s*([\d.,KkMm]+)/));

        items.push({ id: id, source: 'pornone', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views });
    }
    return items;
}

function _pornonePages(html, page, itemsLen) {
    // WP pagination uses ?paged=N (search) or /page/N/ (browse)
    var m = /paged=(\d+)["'][^>]*(?:last|>>)/i.exec(html) ||
            /\/page\/(\d+)\/["'][^>]*(?:last|>>)/i.exec(html);
    return m ? (parseInt(m[1], 10) || _derivePages(itemsLen, page, 20)) : _derivePages(itemsLen, page, 20);
}

// ---- 1. Porntrex ----
SOURCES.push({
    id: 'porntrex',
    name: 'Porntrex',
    host: 'porntrex.com',
    cfg: { categories: _cats('milf:Milf,teen:Teen,mature:Mature,amateur:Amateur,anal:Anal,big-tits:Big Tits,big-ass:Big Ass,blowjob:Blowjob,lesbian:Lesbian,hardcore:Hardcore,pov:POV,blonde:Blonde,brunette:Brunette,busty:Busty,hairy:Hairy,handjob:Handjob,cumshots:Cumshots,doggystyle:Doggystyle,small-tits:Small tits,petite:Petite,fetish:Fetish,bondage:Bondage,college:College,russian:Russian,hentai:Hentai,asian:Asian,japanese:Japanese,indian:Indian,latina:Latina,ebony:Ebony,black:Black,interracial:Interracial,german:German,czech:Czech,arab:Arab,homemade:Homemade,solo:Solo,masturbation:Masturbation,toys:Toys,creampie:Creampie,deepthroat:Deepthroat,gangbang:Gangbang,threesome:Threesome,orgy:Orgy,public:Public,outdoor:Outdoor,massage:Massage,casting:Casting,compilation:Compilation,squirt:Squirt,fisting:Fisting,footjob:Footjob,cuckold:Cuckold,gloryhole:Gloryhole,bukkake:Bukkake,pussy-licking:Pussy licking,ass-licking:Ass licking,double-penetration:Double Penetration (DP),red-head:Red Head,school-girl:School Girl,bbw:BBW,skinny:Skinny,lingerie:Lingerie,uniform:Uniform,office:Office,old-and-young:Old and Young,riding:Riding,fingering:Fingering,strap-on:Strap-on,celebrities:Celebrities,virtual-reality:Virtual Reality (VR)'), sorts: _cats('most-popular:По популярности,most-popular/weekly:Популярное за неделю,most-popular/monthly:Популярное за месяц,top-rated:По рейтингу,longest:Длинные,most-commented:По комментариям') },

    search: function (query, page) {
        var p = page || 1;
        // Path pagination — the site ignores ?s=…&page=N (page2 = page1). /search/{q}/{p}/.
        var url = 'https://www.porntrex.com/search/' + encodeURIComponent(query) + (p > 1 ? '/' + p + '/' : '/');
        return cherryFetch(url).then(function (html) {
            var items = _porntrexCards(html);
            return { items: items, total_pages: _porntrexPages(html, p, items.length) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    browse: function (category, page, sort) {
        var p = page || 1;
        // Sort is a path segment AFTER the slug, before page: /categories/{slug}/{sort}/{page}/
        // Default sort = most-popular (По популярности).
        var s = sort || 'most-popular';
        var url = category
            ? _buildCatUrl('https://www.porntrex.com/categories/{slug}/' + s + '/{page}/', category, p, 1, true)
            : 'https://www.porntrex.com/latest-updates/' + (p > 1 ? p + '/' : '');
        return cherryFetch(url).then(function (html) {
            var items = _porntrexCards(html);
            return { items: items, total_pages: _porntrexPages(html, p, items.length) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getRelated: _relatedFrom(_porntrexCards),

    // Models: /models/ index — cards <a href="/models/{slug}/" title="…"> with an
    // <img class="thumb" data-src="//ptx.cdntrex.com/contents/models/…"> avatar.
    // Grid paginates via AJAX (not URL-addressable) but a single fetch exposes the
    // full roster, so `page` is ignored. Exclude letter-nav /models/{letter}/.
    // Per-model /models/{slug}/{N}/ renders listing cards (reuse _porntrexCards).
    getModels: function () {
        return cherryFetch('https://www.porntrex.com/models/').then(function (html) {
            return _parseModelIndex(html, {
                hrefRx: /href="(https?:\/\/(?:www\.)?porntrex\.com\/models\/[a-z0-9][a-z0-9-]+\/)"/g,
                exclude: function (u) { return /\/models\/[a-z0-9]\/$/i.test(u); },
                nameRx: [/title="([^"]+)"/, /alt="([^"]+)"/, /class="info"[^>]*>([^<]+)</],
                thumbRx: [/(?:data-original|data-src|src)="((?:https?:)?\/\/[^"]+\/contents\/models\/[^"?#]+\.jpe?g)/i, /(?:data-original|data-src|src)="((?:https?:)?\/\/[^"?#]+\.jpe?g)/i]
            });
        }).catch(function () { return []; });
    },

    browseByModel: function (modelUrl, page) {
        var p = page || 1;
        var u = modelUrl.replace(/\/+$/, '');
        var url = p > 1 ? u + '/' + p + '/' : u + '/';
        return cherryFetch(url).then(function (html) {
            var items = _porntrexCards(html);
            return { items: items, total_pages: _porntrexPages(html, p, items.length) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getStream: function (video) {
        return cherryFetch(video.url).then(function (html) {
            // KVS get_file — collect all MP4 URLs. Capture the FULL absolute URL
            // (scheme+host) when present so a CDN host (e.g. *.cdntrex.com) is NOT
            // dropped; only fall back to the page host for host-relative matches.
            var kvsRx = /((?:https?:)?\/\/[^\s"'<>]+\/)?get_file\/[^\s"'<>]+\.mp4[^\s"'<>]*/g;
            var found = [];
            var m;
            while ((m = kvsRx.exec(html)) !== null) {
                var candidate = m[0].replace(/['">\s]+$/, '');
                // Reconstruct absolute URL only if the match lacks scheme/host.
                // Keep the captured host (e.g. *.cdntrex.com); normalize protocol-relative.
                var full = /^\/\//.test(candidate)
                    ? 'https:' + candidate
                    : (/^https?:\/\//i.test(candidate)
                        ? candidate
                        : 'https://www.porntrex.com/' + candidate.replace(/^\//, ''));
                if (found.indexOf(full) === -1) found.push(full);
            }
            if (found.length) {
                // Return RAW stream URLs — px() in playVideo is the single proxy-decision
                // point (browser → proxied, Android → raw device-IP so IP-bound KVS
                // get_file tokens match the natively-fetched page).
                var r1 = _kvsPickBest(found);
                return { url: r1.url, quality: r1.quality };
            }

            // Fallback: JS variable assignment
            var varRx = /(video_url|video_alt_url)\s*[=:]\s*['"]([^'"]+)['"]/g;
            var varUrls = [];
            while ((m = varRx.exec(html)) !== null) {
                if (varUrls.indexOf(m[2]) === -1) varUrls.push(m[2]);
            }
            if (varUrls.length) {
                var r2 = _kvsPickBest(varUrls);
                return { url: r2.url, quality: r2.quality };
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

        // Forward-only chunk. Window 2600: the screenshots-list rotator (~10 <li>)
        // sits between the href and the <div class="durations">/<div class="viewsthumb">
        // meta — the old 800 cap clipped both, so cards lost duration/views overlay.
        var chunk = html.slice(m.index, m.index + 2600);

        // PornTrex uses data-src="//ptx.cdntrex.com/...jpg?v=3" — strip query string, force https:
        // http://ptx.cdntrex.com redirects to porntrex.com homepage; TV browsers resolve // as http://
        var thumb = _attr(chunk, /(?:data-original|data-src|src)="([^"?#]+\.jpe?g)/i) ||
                    _attr(chunk, /(?:data-original|data-src|src)="([^"?#]+\.(?:webp|png))/i);
        if (thumb && thumb.charAt(0) === '/' && thumb.charAt(1) === '/') thumb = 'https:' + thumb;

        // The real title lives in the thumbnail's <img alt="…"> (the <a> has no title=). A
        // generic title="Add to Favourites" sits later in the chunk on the favourite button —
        // so the old `title="…"`-first order grabbed "Add to Favourites" for every card. Prefer
        // the img alt; fall back to title= only if it's not the favourites-button text.
        var title = _decodeHtml(
            _attr(chunk, /<img[^>]+\balt="([^"]+)"/) ||
            _attr(chunk, /<span[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/span>/) ||
            _attr(chunk, /title="(?!Add to [Ff]av)([^"]+)"/)
        );
        if (!title) title = _titleFromUrl(videoUrl);

        // KVS markup: <div class="durations"><i .../> 10:11</div> (icon <i> precedes
        // the value → skip leading tags) and <div class="viewsthumb">1 views</div>.
        var duration = parseDur(
            _attr(chunk, /class="durations"[^>]*>(?:\s*<[^>]+>)*\s*([^<]+)</) ||
            _attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>(?:\s*<[^>]+>)*\s*([^<]+)</)
        );

        var views = parseViews(
            _attr(chunk, /class="viewsthumb"[^>]*>\s*([^<]+)</) ||
            _attr(chunk, /class="[^"]*views?[^"]*"[^>]*>\s*([^<]+)</)
        );

        if (title || thumb) {
            items.push({ id: id, source: 'porntrex', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views });
        }
    }
    return items;
}

function _porntrexPages(html, page, itemsLen) {
    var m = /last_page=(\d+)|\/page=(\d+)"[^>]*>[^<]*>>/i.exec(html) ||
            /page=(\d+)"[^>]*(?:last|next|>>)/i.exec(html);
    if (m) return parseInt(m[1] || m[2], 10) || _derivePages(itemsLen, page, 24);
    // Regex miss: derive from batch fullness (~24 cards/page) instead of a hardcoded cap.
    return _derivePages(itemsLen, page, 24);
}

  // «Похожие» helper: build a getRelated(video) from an adapter's EXISTING
  // standalone card parser. Almost every site renders a "Related videos" block
  // on the video page using the same card markup as its listing, so running the
  // listing parser on the video-page HTML yields the site's own recommendations.
  // Drops the current video (by url) and caps at 20. Reuses the SAME page fetch
  // getStream uses but never touches stream extraction; degrades to [] on error.
  function _relatedFrom(parser) {
    return function (video) {
      if (!video || !video.url) return Promise.resolve([]);
      return cherryFetch(video.url).then(function (html) {
        return parser(html).filter(function (v) {
          return v.url !== video.url;
        }).slice(0, 20);
      }).catch(function () { return []; });
    };
  }

  // ============================================================
  // KVS ENGINE — generic browse/search/card-parse for KVS sites
  // ============================================================

  // Prefer a real last-page number from the markup; when none is found, derive from
  // batch fullness (KVS grids serve ~24-30 cards/page) instead of a constant cap.
  function _kvsPages(html, pagesRxOrFn, page, itemsLen) {
    var fallback = _derivePages(itemsLen || 0, page || 1, 20);
    if (typeof pagesRxOrFn === 'function') {
      return pagesRxOrFn(html, page) || fallback;
    }
    if (pagesRxOrFn instanceof RegExp) {
      var m = pagesRxOrFn.exec(html);
      if (m) return parseInt(m[1], 10) || fallback;
      return fallback;
    }
    return fallback;
  }

  function _kvsParseCards(html, cfg) {
    if (cfg.parseCards) {
      return cfg.parseCards(html);
    }
    if (!cfg.hrefRxSrc) return [];

    var clean = cfg.stripBase64 ? html.replace(/\bsrc="data:[^"]+"/g, 'src=""') : html;
    // Optional per-site pre-slice: drop everything before the real listing container
    // so header/menu dropdowns (identical on every page) aren't harvested as cards.
    if (cfg.listScopeRx) {
      var scopeM = cfg.listScopeRx.exec(clean);
      if (scopeM) clean = clean.slice(scopeM.index);
    }
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
      if (!title) title = _titleFromUrl(videoUrl);

      // Prefer the schema.org itemprop="duration" content="PT…S" attr (precise, locale-
      // free) over the visible text — some KVS skins render the text localized
      // (e.g. pornobolt "13 мин", which parseDur can't read). Fall back to the
      // class="duration|time" text for skins that omit the itemprop.
      var durStr   = _attr(chunk, /itemprop="duration"[^>]*content="([^"]+)"/i) ||
                     _attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</);
      var duration = parseDur(durStr);

      var viewsStr = _attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</);
      var views    = parseViews(viewsStr);

      // HD/4K badge — KVS listing cards expose a per-card quality marker.
      var hd = '';
      if (/2160|\b4k\b/i.test(chunk)) hd = '4K';
      else if (/class="[^"]*\bhd\b[^"]*"|>\s*HD\s*<|is_hd|hd-(?:button|mark)/i.test(chunk)) hd = 'HD';

      // Hover-preview mp4 — KVS cards expose it via one of several per-site attrs.
      // A per-site cfg.previewRx wins; otherwise probe the known KVS variants in
      // order: data-preview, vthumb, data-trailer, data-video, then an inline
      // <video class="...trailer..." src="…mp4">. Absolute URL guaranteed by source
      // markup (all confirmed full https:// in the verification curls).
      var preview = '';
      if (cfg.previewRx) {
        preview = _attr(chunk, cfg.previewRx);
      }
      if (!preview) preview = _attr(chunk, /data-preview="([^"]+\.mp4[^"]*)"/i);
      if (!preview) preview = _attr(chunk, /\bvthumb="([^"]+\.mp4[^"]*)"/i);
      if (!preview) preview = _attr(chunk, /data-trailer="([^"]+\.mp4[^"]*)"/i);
      if (!preview) preview = _attr(chunk, /data-video="([^"]+\.mp4[^"]*)"/i);
      // Inline <video> trailer: attribute order varies (class before OR after src,
      // e.g. hellporno emits src= then class="trailer_video"), so match the trailer
      // mp4 URL directly — these are always named "…_trailer[_360p].mp4".
      if (!preview) preview = _attr(chunk, /src="([^"]+_trailer[^"]*\.mp4[^"]*)"/i);
      if (!preview) preview = _attr(chunk, /<video[^>]*class="[^"]*trailer[^"]*"[^>]*src="([^"]+\.mp4[^"]*)"/i);

      if (title || thumb) {
        items.push({ id: id, source: cfg.id, title: title, thumb: thumb,
                     url: videoUrl, duration: duration, views: views, hd: hd || undefined,
                     preview: preview || undefined });
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
            : _kvsPages(html, cfg.pagesRx, page, items.length);
          return { items: items, total_pages: total };
        }).catch(function() { return { items: [], total_pages: 0 }; });
      },

      browse: function(category, page, sort) {
        var p = page || 1;
        // Default to the first configured sort (Популярное) when the user hasn't
        // chosen one. Verified: KVS accepts ?sort_by= on BOTH category and default
        // pages (xozilla/analdin return cards either way).
        var s  = sort || (cfg.sorts && cfg.sorts[0] && cfg.sorts[0].id) || '';
        var sp = cfg.sortParam || 'sort_by';
        var url;
        if (cfg.sortMode === 'path' && category && cfg.categoryFmt) {
          // PATH sort (crocotube/ebun): /categories/{slug}/{sort}/{page}/ — sort segment
          // injected after the slug, before the page. categoryFmt MUST carry {slug}/{page}.
          // The «Свежее» default (globalLatestSort) is NOT a valid category sort segment —
          // a category's bare /categories/{slug}/{page}/ IS its latest order — so omit it.
          var fmt = (s && s !== cfg.globalLatestSort)
            ? cfg.categoryFmt.replace('{slug}', '{slug}/' + s)
            : cfg.categoryFmt;
          url = _buildCatUrl(fmt, category, p, cfg.catPageBase || 1, cfg.catPage1Omit !== false);
        } else if (category && cfg.categoryFmt) {
          url = _buildCatUrl(cfg.categoryFmt, category, p, cfg.catPageBase || 1, cfg.catPage1Omit !== false);
          // Append sort unless the URL already carries that param (avoids ?sort=mv dupes).
          if (s && url.indexOf(sp + '=') === -1) {
            url += (url.indexOf('?') >= 0 ? '&' : '?') + sp + '=' + s;
          }
        } else if (cfg.sortMode === 'path') {
          // PATH sort, NO category (crocotube/ebun GLOBAL feed): the sort is a root
          // path segment /{sort}/{page}/, NOT a query param. The «Свежее» default
          // (cfg.globalLatestSort) is the bare latest feed → use browseUrl(p) as-is;
          // any other sort builds https://host/{sort}/{page}/ (e.g. /most-popular/{p}/).
          if (!s || s === cfg.globalLatestSort) {
            url = cfg.browseUrl(p);
          } else {
            var origin = cfg.browseUrl(1).replace(/^(https?:\/\/[^/]+).*/, '$1');
            url = p > 1 ? origin + '/' + s + '/' + p + '/' : origin + '/' + s + '/';
          }
        } else {
          url = cfg.browseUrl(p);
          if (s && url.indexOf(sp + '=') === -1) {
            url += (url.indexOf('?') >= 0 ? '&' : '?') + sp + '=' + s;
          }
        }
        return cherryFetch(url).then(function(html) {
          var items = _kvsParseCards(html, cfg);
          return {
            items:       items,
            total_pages: _kvsPages(html, cfg.pagesRx, p, items.length)
          };
        }).catch(function() { return { items: [], total_pages: 0 }; });
      },

      // «Похожие»: reuse this engine's own card parser on the video-page HTML.
      // KVS video pages render a "Related videos" block in the SAME card markup
      // as the listing, so the existing parser picks them up. Drop the current
      // video (by url) and cap at 20. Never touches stream extraction.
      getRelated: function (video) {
        var url = video && video.url;
        if (!url) return Promise.resolve([]);
        return cherryFetch(url).then(function (html) {
          var items = _kvsParseCards(html, cfg);
          return items.filter(function (v) { return v.url !== video.url; }).slice(0, 20);
        }).catch(function () { return []; });
      },

      // «Модели» — model INDEX scrape (only when the cfg declares one). Returns
      // [{name,url,thumb}] for the models_index grid. Reuses _parseModelIndex.
      getModels: cfg.modelIndex ? function (page) {
        return cherryFetch(cfg.modelIndex.url(page || 1)).then(function (html) {
          return _parseModelIndex(html, cfg.modelIndex);
        }).catch(function () { return []; });
      } : undefined,

      // browseByModel — a model's videos, reusing THIS engine's card parser
      // (KVS model pages render listing-identical cards). Never touches getStream.
      browseByModel: cfg.modelIndex ? function (modelUrl, page) {
        var p = page || 1;
        var url = cfg.modelIndex.videosUrl
          ? cfg.modelIndex.videosUrl(modelUrl, p)
          : _buildCatUrl(modelUrl.replace(/\/+$/, '') + '/{page}', '', p, 1, true);
        return cherryFetch(url).then(function (html) {
          var items = _kvsParseCards(html, cfg);
          return { items: items, total_pages: _kvsPages(html, cfg.pagesRx, p, items.length) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
      } : undefined,

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
    categories: _cats('amateur:Amateur,anal:Anal,asian:Asian,bbw:BBW,big-tits:Big Tits,blonde:Blonde,blowjob:Blowjob,creampie:Creampie,hairy:Hairy,hardcore:Hardcore,indian:Indian,interracial:Interracial,japanese:Japanese,lesbian:Lesbian,milf:MILF,pov:POV,stockings:Stockings,teen:Teen,threesome:Threesome,mature:Mature,granny-anal:Granny Anal,russian-anal:Russian Anal,russian-teens:Russian Teens 18+,teen-girls-18:Teen Girls 18+,muslim:Muslim,hijab:Hijab,top-rated:Top Rated,classic:Classic,milf-creampie:MILF Creampie'),
    sorts: _cats('post_date:Свежее,video_viewed:По популярности,video_viewed_today:Популярное за день,video_viewed_week:Популярное за неделю,video_viewed_month:Популярное за месяц,rating_week:Рейтинг за неделю,rating:По рейтингу,duration:Длинные,most_commented:По комментариям'),
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
    // Models: /models/ index — clean KVS cards (href + title= + <img class="thumb">).
    // Per-model /models/{slug}/{page}/ renders listing cards (auto via browseByModel).
    modelIndex: {
        url: function(p) { return p > 1 ? 'https://www.xozilla.com/models/' + p + '/' : 'https://www.xozilla.com/models/'; },
        hrefRx: /href="(https?:\/\/(?:www\.)?xozilla\.com\/models\/[^"\/]+\/)"/g,
        nameRx: [/title="([^"]+)"/, /alt="([^"]+)"/],
        thumbRx: [/(?:data-src|src)="(https?:\/\/[^"]+\.jpe?g)"/i]
    },
    // after:1000 — the per-card duration <div class="duration"> sits at ~+786 from
    // the href (right past the old 800 cap), so listing AND model cards were losing
    // their duration overlay. Widened so duration is captured (thumb +409, preview
    // vthumb right after href all still inside). Applies to browse + browseByModel.
    chunkWindow: { before: 0, after: 1000 },
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
            }
            best = quality['1080p'] || quality['720p'] || quality['480p'] || best;
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
    cfg: { categories: _cats('milf:MILF,teen:Teens 18+,18-year-old:18 Year Old,anal:Anal,blowjob:Blowjob,big-tits:Big Tits,big-natural-tits:Big Natural Tits,amateur:Amateur,mature:Mature,asian:Asian,japanese:Japanese,lesbian:Lesbian,pov:POV,hardcore:Hardcore,threesome:Threesome,interracial:Interracial,ebony:Ebony,big-cock:Big Cock,cumshot:Cumshot,public:Public,casting:Casting,mom:Mom,squirting:Squirting,gangbang:Gangbang,russian:Russian,german:German,big-ass:Big Ass,bdsm:BDSM,massage:Massage,toys:Toys,deepthroat:Deepthroat,double-penetration:Double Penetration,handjob:Handjob,outdoor:Outdoor,pornstar:Pornstar,small-tits:Small Tits,group:Group,czech:Czech,homemade:Homemade'), sorts: _cats('latest-updates:Свежее,most-viewed/all-time:По популярности,most-viewed/week:Популярное за неделю,most-viewed/month:Популярное за месяц,top-rated/all-time:По рейтингу,top-rated/week:Топ за неделю,top-rated/month:Топ за месяц,longest:Длинные') },

    search: function (query, page) {
        var p = page || 1;
        var url = 'https://www.3movs.com/?s=' + encodeURIComponent(query) + '&p=' + p;
        return cherryFetch(url).then(function (html) {
            var items = _3movsCards(html);
            return { items: items, total_pages: _3movsPages(html, p, items.length) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    browse: function (category, page, sort) {
        var p = page || 1;
        if (category) {
            // 3movs serves a valid body with a 404 status on category page>1 —
            // use status-tolerant _fetchAny so pagination isn't dropped.
            // Sort is a path segment after the slug (e.g. most-viewed/all-time);
            // default = most-viewed/all-time (По популярности).
            var s = sort || 'most-viewed/all-time';
            var curl = _buildCatUrl('https://3movs.com/categories/{slug}/' + s + '/{page}/', category, p, 1, true);
            return _fetchAny(curl).then(function (html) {
                var items = _3movsCards(html);
                return { items: items, total_pages: _3movsPages(html, p, items.length) };
            }).catch(function () { return { items: [], total_pages: 0 }; });
        }
        var url = p > 1
            ? 'https://www.3movs.com/latest-updates/' + p + '/'
            : 'https://www.3movs.com/latest-updates/';
        return cherryFetch(url).then(function (html) {
            var items = _3movsCards(html);
            return { items: items, total_pages: _3movsPages(html, p, items.length) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getRelated: _relatedFrom(_3movsCards),

    // Models: /pornstars/ index (25/page, paginated /pornstars/{N}/). Cards are
    // <a class="thumb album item model" title="…"> with a data-src avatar. Exclude
    // the sort-control links (title/top-rated/most-viewed/videos*). Per-model
    // /pornstars/{slug}/{N}/ renders listing cards (reuse _3movsCards).
    getModels: function (page) {
        var p = page || 1;
        var url = p > 1 ? 'https://www.3movs.com/pornstars/' + p + '/'
                        : 'https://www.3movs.com/pornstars/';
        return cherryFetch(url).then(function (html) {
            return _parseModelIndex(html, {
                hrefRx: /href="(https?:\/\/(?:www\.)?3movs\.com\/pornstars\/[a-z][a-z0-9-]+\/)"/g,
                exclude: function (u) {
                    return /\/pornstars\/(?:title|top-rated|most-viewed|videos|videos-rating|videos-views)\/$/.test(u);
                },
                nameRx: [/title="([^"]+)"/, /alt="([^"]+)"/],
                thumbRx: [/(?:data-src|data-webp|src)="(https?:\/\/[^"]+\.jpe?g)"/i]
            });
        }).catch(function () { return []; });
    },

    browseByModel: function (modelUrl, page) {
        var p = page || 1;
        var u = modelUrl.replace(/\/+$/, '');
        var url = p > 1 ? u + '/' + p + '/' : u + '/';
        return cherryFetch(url).then(function (html) {
            var items = _3movsCards(html);
            return { items: items, total_pages: _3movsPages(html, p, items.length) };
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
            // Always prefer the highest quality actually present.
            best = quality['1080p'] || quality['720p'] || quality['480p'] || best;
            if (best) return { url: best, quality: quality };
            return extractStreams(html);
        }).catch(function () { return { url: '', quality: {} }; });
    }
});

function _3movsCards(html) {
    var items = [];
    // Only real video URLs — /videos/{digits}/{slug}. The old broad rx matched nav
    // links like /videos/ (the index), /categories/ and /pornstars/, producing an
    // empty leading card titled "video". Requiring the numeric id drops them.
    var hrefRx = /href="(https?:\/\/(?:www\.)?3movs\.com\/videos\/\d+\/[^"?#]+)"/g;
    var seen = {};
    var m;
    while ((m = hrefRx.exec(html)) !== null) {
        var videoUrl = m[1];
        var id = videoUrl.replace(/^https?:\/\/[^/]+\//, '').replace(/[^a-z0-9]/gi, '_');
        if (!id || seen[id]) continue;
        seen[id] = true;

        // Start the chunk AT the href (back-window 0) so the title comes from the
        // card's own <a class="wrap_image"…title="…">/<a class="title">, not the
        // PREVIOUS card's "Watch Later" button (which sits before the href).
        var chunk = html.slice(m.index, m.index + 600);

        var thumb = _attr(chunk, /(?:data-src|src)="([^"]+\.jpe?g)"/i) ||
                    _attr(chunk, /(?:data-src|src)="([^"]+\.(?:webp|png))"/i);

        // Reject the watch-later / favourites button titles with a negative lookahead.
        var title = _decodeHtml(
            _attr(chunk, /title="(?!Watch Later|Add to [Ff]av)([^"]+)"/) ||
            _attr(chunk, /alt="([^"]+)"/) ||
            _attr(chunk, /<h\d[^>]*>([^<]+)<\/h\d>/)
        );
        if (!title) title = _titleFromUrl(videoUrl);

        // Duration (<div class="time">6:36</div>) sits ~945 chars past the href —
        // inside THIS card's <a class="wrap_image"> but beyond the 600-char title
        // window. Use a wider forward window (bounded by the NEXT card href, min
        // inter-card gap ~1600) so it stays card-anchored and never grabs a neighbour.
        var durChunk = html.slice(m.index, m.index + 1500);
        var duration = parseDur(_attr(durChunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</));
        var views    = parseViews(_attr(durChunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));

        // Hover-preview mp4 — every 3movs card carries data-preview="…_preview.mp4/".
        var preview = _attr(chunk, /data-preview="([^"]+\.mp4[^"]*)"/i);

        if (title || thumb) {
            items.push({ id: id, source: '3movs', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views, preview: preview || undefined });
        }
    }
    return items;
}

function _3movsPages(html, page, itemsLen) {
    var m = /p=(\d+)"[^>]*(?:last|>>|&raquo;)/i.exec(html);
    return m ? (parseInt(m[1], 10) || _derivePages(itemsLen, page, 20)) : _derivePages(itemsLen, page, 20);
}

// ---- 4. Analdin ----
SOURCES.push(_kvsEngine({
    id: 'analdin',
    name: 'Analdin',
    host: 'analdin.com',
    categoryFmt: 'https://www.analdin.com/categories/{slug}/{page}/',
    catPageBase: 1, catPage1Omit: true,
    categories: _cats('sex:Sex,blowjobs:Blowjobs,hot:Hot,pussy:Pussy,ass:Ass,sexy:Sexy,hardcore:Hardcore,babes:Babes,big-tits:Big Tits,tits:Tits,brunettes:Brunettes,teens:Teens 18+,big-ass:Big Ass,amateurs:Amateurs,blondes:Blondes,doggy-style:Doggy Style,anal:Anal,big-cock:Big Cock,cumshots:Cumshots,sluts:Sluts,pussy-licking:Pussy Licking,crazy:Crazy,pornstars:Pornstars,masturbation:Masturbation,young:Young,cowgirl:Cowgirl,oral:Oral,milfs:MILFs,pov:POV,hd:HD,small-tits:Small Tits,tattoos:Tattoos,lesbians:Lesbians,homemade:Homemade,interracial:Interracial,busty:Busty,natural-tits:Natural Tits,reverse-cowgirl:Reverse Cowgirl,facial:Facial,mature:Mature'),
    sorts: _cats('post_date:Свежее,video_viewed:По популярности,video_viewed_today:Популярное за день,video_viewed_week:Популярное за неделю,video_viewed_month:Популярное за месяц,rating_week:Рейтинг за неделю,rating:По рейтингу,duration:Длинные'),
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
    // Models: /models/ index — clean KVS cards (href + title= + <img class="thumb">).
    // Per-model /models/{slug}/{page}/ renders listing cards (auto via browseByModel).
    modelIndex: {
        url: function(p) { return p > 1 ? 'https://analdin.com/models/' + p + '/' : 'https://analdin.com/models/'; },
        hrefRx: /href="(https?:\/\/(?:www\.)?analdin\.com\/models\/[^"\/]+\/)"/g,
        nameRx: [/title="([^"]+)"/, /alt="([^"]+)"/],
        thumbRx: [/(?:data-src|src)="(https?:\/\/[^"]+\.jpe?g)"/i]
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
            }
            best = quality['1080p'] || quality['720p'] || quality['480p'] || best;
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
    cfg: { categories: _cats('blowjob:Blowjob,japanese:Japanese,big-tits:Big Tits,teens:Teens,asian:Asian,brunette:Brunette,hardcore:Hardcore,blonde:Blonde,milf:MILF,big-cock:Big Cock,cumshot:Cumshot,anal:Anal,big-ass:Big Ass,babes:Babes,amateur:Amateur,small-tits:Small Tits,petite:Petite,one-on-one:One on One,creampie:Creampie,threesome:Threesome,masturbation:Masturbation,lesbian:Lesbian,interracial:Interracial,facial:Facial,handjob:Handjob,pov:POV,lingerie:Lingerie,cowgirl:Cowgirl,pussy-licking:Pussy Licking,fingering:Fingering,toys:Toys,deepthroat:Deepthroat,latina:Latina,doggy:Doggy,tattoo:Tattoo,shaved-pussy:Shaved Pussy,webcam:Webcam,natural-tits:Natural Tits,fetish:Fetish,redhead:Redhead'), sorts: _cats('video_viewed:По популярности,video_viewed_today:Популярное за день,video_viewed_week:Популярное за неделю,video_viewed_month:Популярное за месяц,rating_week:Рейтинг за неделю,rating_month:Рейтинг за месяц,post_date:Свежее,rating:По рейтингу,duration:Длинные,most_commented:По комментариям') },

    search: function (query, page) {
        var q = encodeURIComponent(query).replace(/%20/g, '+');
        // page 1: /search/{q}/, page N: /search/{q}/page{N}/
        var url = page > 1
            ? 'https://pornve.com/search/' + q + '/page' + page + '/'
            : 'https://pornve.com/search/' + q + '/';
        return cherryFetch(url).then(function (html) {
            var items = _pornveCards(html);
            return { items: items, total_pages: _pornvePages(items.length, page) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    browse: function (category, page, sort) {
        var p = page || 1;
        var s = sort || (this.cfg.sorts[0] && this.cfg.sorts[0].id) || '';
        var url = category
            ? _buildCatUrl('https://pornve.com/categories/{slug}/{page}/', category, p, 1, true)
            // Default feed paginates by PATH (/latest-updates/{N}/), NOT ?page=N
            // (the query param is ignored → same 20 cards → no scroll). Path style
            // serves fresh cards per page (curl-verified p1/p2/p3 all unique).
            : (p > 1 ? 'https://pornve.com/latest-updates/' + p + '/'
                     : 'https://pornve.com/latest-updates/');
        if (s && url.indexOf('sort_by=') === -1) {
            url += (url.indexOf('?') >= 0 ? '&' : '?') + 'sort_by=' + s;
        }
        return cherryFetch(url).then(function (html) {
            var items = _pornveCards(html);
            return { items: items, total_pages: _pornvePages(items.length, p) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getRelated: _relatedFrom(_pornveCards),

    // Models: /models/ index (20/page, paginated /models/{N}/). Cards are
    // <a class="item" href="/models/{slug}/" title="…"> with an <img> avatar at
    // cdn.pornve.com/contents/models/…. Per-model /models/{slug}/{N}/ renders
    // listing cards (reuse _pornveCards).
    getModels: function (page) {
        var p = page || 1;
        var url = p > 1 ? 'https://pornve.com/models/' + p + '/'
                        : 'https://pornve.com/models/';
        return cherryFetch(url).then(function (html) {
            return _parseModelIndex(html, {
                hrefRx: /href="(https?:\/\/pornve\.com\/models\/[a-z][a-z0-9-]+\/)"/g,
                nameRx: [/title="([^"]+)"/, /alt="([^"]+)"/],
                thumbRx: [/(?:data-src|src)="(https?:\/\/[^"]+\/contents\/models\/[^"]+\.jpe?g)"/i, /(?:data-src|src)="(https?:\/\/[^"]+\.jpe?g)"/i]
            });
        }).catch(function () { return []; });
    },

    browseByModel: function (modelUrl, page) {
        var p = page || 1;
        var u = modelUrl.replace(/\/+$/, '');
        var url = p > 1 ? u + '/' + p + '/' : u + '/';
        return cherryFetch(url).then(function (html) {
            var items = _pornveCards(html);
            return { items: items, total_pages: _pornvePages(items.length, p) };
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
            }
            best = quality['1080p'] || quality['720p'] || quality['480p'] || best;
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
        if (!title) title = _titleFromUrl(videoUrl);

        // Duration (<div class="time">11:10</div>) sits ~768 chars past the href —
        // beyond the 600-char forward window. Use a wider forward-only window (min
        // inter-card gap ~2700) so it stays this card's value. Match the duration
        // class explicitly (the bare \d+:\d+ fallback is dropped: it could otherwise
        // catch an unrelated timestamp in the wider span).
        var durChunk = html.slice(m.index, m.index + 1200);
        var duration = parseDur(_attr(durChunk, /class="[^"]*(?:duration|time)"[^>]*>([^<]+)</));

        var views = parseViews(_attr(durChunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));

        // Hover-preview mp4 — every pornve card carries data-preview="…_preview.mp4/".
        var preview = _attr(chunk, /data-preview="([^"]+\.mp4[^"]*)"/i);

        if (title || thumb) {
            items.push({ id: id, source: 'pornve', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views, preview: preview || undefined });
        }
    }
    return items;
}

// PornVe paginates via KVS (category /categories/{slug}/{N}/, latest ?page=N) with no
// reliable last-page link in the markup, so the old page=/N/-last regex never matched
// and returned a hardcoded 10, capping infinite scroll at ~10 pages (same class of bug
// as familyporn). Derive a generous window from page fill instead (24 cards/page) so
// scroll keeps requesting while the site still serves a full page.
function _pornvePages(itemsLen, page) {
    return _derivePages(itemsLen, page || 1, 24);
}

// ---- 6. FamilyPorn ----
SOURCES.push({
    id: 'familyporn',
    name: 'FamilyPorn',
    host: 'familyporn.tv',
    cfg: { categories: _cats('cousin:Cousin,grandma-grandson:Grandma & Grandson,virgin:Virgin,stepbrother-stepsister:Stepbrother & Stepsister,stepdaughter-stepdad:Stepdad & Stepdaughter,brother-sister:Brother & Sister,grandpa-granddaughter:Grandpa & Granddaughter,stepmom-stepson:Stepmom & Stepson,dad-daughter:Dad & Daughter,mother-daughter:Mother & Daughter'), sorts: _cats('video_viewed:По популярности,post_date:Свежее,rating:По рейтингу,duration:Длинные,most_commented:По комментариям') },

    search: function (query, page) {
        var p = page || 1;
        var url = 'https://familyporn.tv/search/?q=' + encodeURIComponent(query) + '&page=' + p;
        return cherryFetch(url).then(function (html) {
            var items = _familypornCards(html);
            return { items: items, total_pages: _familypornPages(html, p, items.length) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    browse: function (category, page, sort) {
        var p = page || 1;
        var s = sort || (this.cfg.sorts[0] && this.cfg.sorts[0].id) || '';
        var url = category
            ? _buildCatUrl('https://familyporn.tv/categories/{slug}/{page}/', category, p, 1, true)
            : 'https://familyporn.tv/latest-updates/' + p + '/';
        if (s && url.indexOf('sort_by=') === -1) {
            url += (url.indexOf('?') >= 0 ? '&' : '?') + 'sort_by=' + s;
        }
        return cherryFetch(url).then(function (html) {
            var items = _familypornCards(html);
            return { items: items, total_pages: _familypornPages(html, p, items.length) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getRelated: _relatedFrom(_familypornCards),

    // Models: single-page /models/ index lists the FULL A-Z roster (~1600) as
    // <a class="link models-link" href="/models/{slug}/" title="…"> with NO avatar
    // (name + "N video" only) → letter-tile fallback. One page, so ignore `page`.
    // Per-model /models/{slug}/{N}/ renders listing cards (reuse _familypornCards).
    getModels: function () {
        return cherryFetch('https://familyporn.tv/models/').then(function (html) {
            return _parseModelIndex(html, {
                hrefRx: /href="(https?:\/\/familyporn\.tv\/models\/[a-z][a-z0-9-]+\/)"/g,
                nameRx: [/title="([^"]+)"/, /class="name"[^>]*>([^<]+)</],
                thumbRx: [/(?:data-original|data-src|src)="(https?:\/\/[^"]+\.(?:jpe?g|webp|png))"/i]
            });
        }).catch(function () { return []; });
    },

    browseByModel: function (modelUrl, page) {
        var p = page || 1;
        var u = modelUrl.replace(/\/+$/, '');
        var url = p > 1 ? u + '/' + p + '/' : u + '/';
        return cherryFetch(url).then(function (html) {
            var items = _familypornCards(html);
            return { items: items, total_pages: _familypornPages(html, p, items.length) };
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
            }
            best = quality['1080p'] || quality['720p'] || quality['480p'] || best;
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
        if (!title) title = _titleFromUrl(videoUrl);

        var duration = parseDur(_attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</));
        var views    = parseViews(_attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));

        // Hover-preview mp4 — KVS cards carry data-preview="…_preview.mp4/" (same as 3movs/pornve).
        var preview = _attr(chunk, /data-preview="([^"]+\.mp4[^"]*)"/i);

        if (title || thumb) {
            items.push({ id: id, source: 'familyporn', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views, preview: preview || undefined });
        }
    }
    return items;
}

// FamilyPorn paginates via KVS AJAX (data-parameters="…;from:N") — no page-numbered
// URLs or a last-link in the markup, so the old page=/N/-last regex never matched and
// returned a hardcoded 10, capping infinite scroll at ~10 pages. Derive a generous
// window from the page fill instead (24 cards/page) so scroll keeps requesting while
// the site still serves a full page.
function _familypornPages(html, page, itemsLen) {
    return _derivePages(itemsLen, page || 1, 24);
}

// ---- 7. Porndig ----
SOURCES.push({
    id: 'porndig',
    name: 'Porndig',
    host: 'porndig.com',
    // Composite slug "{id}/{name}" (porndig channels need both). Browse: /channels/{id}/{name}/page/{n}.
    cfg: { categories: _cats('33/anal:Anal,34/young:Young,35/cum-swallowing:Cum Swallowing,36/blonde:Blonde,38/asian:Asian,39/milf:MILF,40/lesbian:Lesbian,41/mature:Mature,42/orgy:Orgy,43/big-boobs:Big Boobs,45/black:Black,46/bbw:BBW,47/creampie:Creampie,48/masturbation:Masturbation,50/facial-ejaculation:Facial Ejaculation,51/hentai:Hentai,52/blowjob:Blowjob,53/interracial:Interracial,54/latina:Latina,55/bondage-bdsm:BDSM,57/fetish:Fetish,58/pov:POV,59/bukkake:Bukkake,60/redhead:Redhead,63/brunette:Brunette,64/double-penetration:Double Penetration,67/small-tits:Small Tits,68/squirters:Squirting,70/webcam:Webcam,74/massage:Massage,75/sexy-lingerie:Sexy Lingerie,799/cumshot:Cumshot,802/big-dick:Big Dick,816/stockings:Stockings,82/gangbang:GangBang,1043/threesome:Threesome,1117/european:European,1198/big-ass:Big Ass,1235/hardcore:Hardcore,1236/cuckold:Cuckold'), sorts: [] /* sort not URL-addressable (DLE/AJAX POST) */ },

    search: function (query, page) {
        var p = page || 1;
        var q = encodeURIComponent(query);
        var url = p > 1
            ? 'https://porndig.com/search/' + q + '/page/' + p
            : 'https://porndig.com/search/' + q + '/';
        return cherryFetch(url).then(function (html) {
            var items = _porndigCards(html);
            return { items: items, total_pages: _porndigPages(html, p, items.length) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    browse: function (category, page) {
        var p = page || 1;
        // category is a composite "{id}/{name}" channel slug.
        // NO category → site-wide latest feed /video/ (paginates /video/page/{n}/) —
        // curl-verified cross-topic recent cards. (The old default fetched the ANAL
        // channel /channels/33/anal/ — a single category, not the homepage. /latest-updates/
        // and /most-recent/ both 404 on porndig; /video/ is the real all-topic feed.)
        var url = category
            ? 'https://porndig.com/channels/' + category + (p > 1 ? '/page/' + p : '')
            : 'https://porndig.com/video/' + (p > 1 ? 'page/' + p + '/' : '');
        return cherryFetch(url).then(function (html) {
            var items = _porndigCards(html);
            return { items: items, total_pages: _porndigPages(html, p, items.length) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    // «Похожие» IS paginated: the video page bootstraps related via a DLE AJAX
    // loader (data-loader_first_url="/posts/load_related_posts/{page}/{id}") that
    // returns {success,data:{content:"<escaped HTML grid>"}} — 35 distinct cards
    // per page (curl-verified p1=236098, p2=254139… no overlap). Thread `page` into
    // that endpoint and parse data.content with the listing parser so the related
    // grid scrolls instead of stopping after the single bootstrapped block.
    getRelated: function (video, page) {
        if (!video || !video.id) return Promise.resolve([]);
        var p = page || 1;
        var url = 'https://porndig.com/posts/load_related_posts/' + p + '/' + video.id;
        return cherryFetch(url).then(function (text) {
            var content = '';
            try { content = (JSON.parse(text).data || {}).content || ''; } catch (e) { content = text; }
            return _porndigCards(content).filter(function (v) {
                return v.url !== video.url;
            });
        }).catch(function () { return []; });
    },

    // Models: /pornstars/ index (30/page, paginated /pornstars/page/{N}/). Model
    // links /pornstars/{id}/{slug}.html (relative); name in title=. Per-model page
    // renders 30 listing cards (reuse _porndigCards). Pagination /page/{N}/.
    getModels: function (page) {
        var p = page || 1;
        var url = p > 1
            ? 'https://porndig.com/pornstars/page/' + p + '/'
            : 'https://porndig.com/pornstars/';
        return cherryFetch(url).then(function (html) {
            return _parseModelIndex(html, {
                hrefRx: /href="((?:https?:\/\/porndig\.com)?\/pornstars\/\d+\/[^"]+\.html)"/g,
                normalizeUrl: function (raw) {
                    return raw.charAt(0) === '/' ? 'https://porndig.com' + raw : raw;
                },
                nameRx: [/title="([^"]+)"/, /<h3>([^<]+)<\/h3>/],
                thumbRx: [/(?:data-src|src)="(https?:\/\/[^"]+\.jpe?g[^"]*)"/i]
            });
        }).catch(function () { return []; });
    },

    browseByModel: function (modelUrl, page) {
        var p = page || 1;
        var u = modelUrl.replace(/\.html$/i, '');
        var url = p > 1 ? u + '/page/' + p + '/' : modelUrl;
        return cherryFetch(url).then(function (html) {
            var items = _porndigCards(html);
            return { items: items, total_pages: _porndigPages(html, p, items.length) };
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
    // Collect card start offsets FIRST so each card's chunk can extend to the NEXT
    // card boundary. porndig renders the duration bubble ~2-3k chars past the href
    // (well beyond a fixed window), so a card-bounded chunk is the only safe reach.
    var cards = [];
    var seen = {};
    var m;
    while ((m = hrefRx.exec(html)) !== null) {
        if (seen[m[2]]) continue;
        seen[m[2]] = true;
        cards.push({ index: m.index, url: m[1], id: m[2] });
    }
    for (var c = 0; c < cards.length; c++) {
        var videoUrl = cards[c].url.charAt(0) === '/' ? 'https://porndig.com' + cards[c].url : cards[c].url;
        var id = cards[c].id;
        var end = (c + 1 < cards.length) ? cards[c + 1].index : cards[c].index + 3500;
        var chunk = html.slice(cards[c].index, Math.min(cards[c].index + 900, end));
        var durChunk = html.slice(cards[c].index, end);

        // image-cdn.porndig.com/thumbs/YYYY/MM/ID/...
        var thumb = _attr(chunk, /(?:data-original|data-src|src)="(https?:\/\/image-cdn\.porndig\.com\/thumbs\/[^"?#]+)/i) ||
                    _attr(chunk, /(?:data-original|data-src|src)="([^"?#]+\.jpe?g)/i);

        var title = _decodeHtml(
            _attr(chunk, /<div[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/div>/) ||
            _attr(chunk, /title="([^"]+)"/) ||
            _attr(chunk, /alt="([^"]+)"/)
        );
        if (!title) title = _titleFromUrl(videoUrl);

        // Duration: <div class="bubble bubble_duration"><span>08:00</span></div> —
        // the value is in an inner <span>, so step past the leading inner tags.
        var duration = parseDur(_attr(durChunk, /class="[^"]*duration[^"]*"[^>]*>(?:\s*<[^>]+>)*\s*([\d:]+(?:\s*min)?)/i));
        var views    = parseViews(_attr(durChunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));

        if (title || thumb) {
            items.push({ id: id, source: 'porndig', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views });
        }
    }
    return items;
}

function _porndigPages(html, page, itemsLen) {
    var m = /\/page\/(\d+)["'][^>]*(?:last|>>)/i.exec(html);
    return m ? (parseInt(m[1], 10) || _derivePages(itemsLen, page, 20)) : _derivePages(itemsLen, page, 20);
}

// ---- Tizam ----
SOURCES.push({
  id: 'tizam',
  name: 'Tizam',
  host: 'tv4.tizam.org',
  // Category pages take the same zero-indexed ?p= pagination as the default feed
  // (curl-verified ?p=0..2 return distinct cards) — see browse() for the wiring.
  cfg: { categories: _cats('all_sex:Фильмы xxx,s_russkim_perevodom:С Русским переводом,russkoe_porno:Русские порнофильмы,novinki:Новинки по выбору года,polnometrazhnye:Полнометражные с сюжетом,zrelye:Зрелые женщины,podrostki_18:Молодые девушки +18,anal_seks_bol_shie_popki:Анал и Большие попки,bol_shaya_grud:Большие сиськи,minet:Оральный секс,groupvideo:Групповой секс,incest:Семейное порно,svingery:Свингеры и Измена,dominirovanie:Доминирование,zhenskaya_masturbaciya:Соло девушки,pyshechki:Пышечки,aziatki:Азиатские порнофильмы,temnokozhie:Темнокожие,italyan_porn:Итальянские порнофильмы,nemeckie_pornofil_my:Немецкие порнофильмы,klassika:Классика и Ретро'), sorts: [] /* sort not URL-addressable (DLE/AJAX POST) */ },

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

      // Look FORWARD from href: chunk covers the <a> and the <h3> title that follows it.
      // Title element sits at ~+1200-1400, so 1200 cut it off (17/32 empty titles) —
      // 1600 captures it (0/32 empty). _titleFromUrl(cardUrl) remains the fallback.
      var chunk = html.slice(m.index, m.index + 1600);

      var rawThumb = _attr(chunk, /src="([^"]+\/images\/cms\/thumbs\/[^"]+)"/) ||
                     _attr(chunk, /src="([^"?#]+\.jpe?g)"/);
      var thumb = rawThumb && rawThumb.charAt(0) === '/' ? 'https://tv4.tizam.org' + rawThumb : rawThumb;

      // Title: prefer <span class="title"> (actual video name) or <h3>, then img alt.
      // Some cards (e.g. /…_s_russkim_perevodom/{slug}/) carry no title element in the chunk —
      // fall back to a humanized slug from the URL so the card never renders title-less.
      var title = _decodeHtml(
        _attr(chunk, /<span[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([^<]+)/) ||
        _attr(chunk, /<h[23][^>]*>([^<]+)<\/h[23]>/) ||
        _attr(chunk, /itemprop="name"[^>]*>([^<]+)/) ||
        _attr(chunk, /alt="([^"]+)"/)
      ) || _titleFromUrl(cardUrl);

      if (!title && !thumb) continue;

      // Duration: <li ... umi:field-name="prodolzhitelnost"><meta itemprop="duration"
      // content="1:42:49">1:42:49</li> inside <ul class="item__meta">. Prefer the
      // clean itemprop content attr; the bare H:MM:SS text is the fallback.
      var duration = parseDur(
        _attr(chunk, /itemprop="duration"[^>]*content="([^"]+)"/i) ||
        _attr(chunk, /umi:field-name="prodolzhitelnost"[^>]*>(?:\s*<[^>]+>)*\s*([\d:]+)/i)
      );

      items.push({
        id: 'tizam-' + id,
        source: 'tizam',
        title: title,
        thumb: thumb,
        url: cardUrl,
        duration: duration,
        views: 0
      });
    }
    return items;
  },

  search: function(query, page) {
    // Real GET search form: action="/search-results/" method="GET", input name="search_string".
    // (Old /?s= generic-DLE scan returned junk slug-as-title links with no thumbs.)
    // Search results render the same 3-segment video cards as browse → reuse _parseCards.
    // No page param exists in the search form (single result set) → total_pages 1.
    var self = this;
    var url = 'https://tv4.tizam.org/search-results/?search_string=' + encodeURIComponent(query);
    return cherryFetch(url).then(function(html) {
      var items = self._parseCards(html);
      return { items: items, total_pages: items.length ? 1 : 0 };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  browse: function(category, page) {
    var self = this;
    var p = page || 1;
    if (category) {
      // Category pages take the SAME zero-indexed ?p= pagination as the default feed
      // (page 1 → ?p=0). Curl-verified: ?p=0 == base, ?p=1/?p=2 return distinct cards
      // (32/page, ~8 overlap p1↔p2). The prior "JS-only, single page" note was wrong —
      // the static ?p= URL exists, so thread it + derive a generous window for scroll.
      var curl = 'https://tv4.tizam.org/fil_my_dlya_vzroslyh/' + category + '/?p=' + (p - 1);
      return cherryFetch(curl).then(function(html) {
        var items = self._parseCards(html);
        return { items: items, total_pages: _derivePages(items.length, p, 12) };
      }).catch(function() { return { items: [], total_pages: 0 }; });
    }
    // NO category → site homepage cross-category "Последние поступления" (all-category
    // newest). Was the SINGLE category /s_russkim_perevodom/. Curl-verified: the bare
    // root /?p={n} spans many categories (s_russkim_perevodom, klassika, all_sex,
    // incest, italyan_porn…) and paginates (?p=0 ≠ ?p=1). Same zero-indexed ?p= scheme.
    var url = 'https://tv4.tizam.org/?p=' + (p - 1);
    return cherryFetch(url).then(function(html) {
      var items = self._parseCards(html);
      return { items: items, total_pages: _derivePages(items.length, p, 12) };
    }).catch(function() { return { items: [], total_pages: 0 }; });
  },

  getRelated: function(video) {
    var self = this;
    if (!video || !video.url) return Promise.resolve([]);
    return cherryFetch(video.url).then(function(html) {
      return self._parseCards(html).filter(function(v) {
        return v.url !== video.url;
      }).slice(0, 20);
    }).catch(function() { return []; });
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
    cfg: { categories: _cats('hd:HD,blowjob:Blowjob,big-tits:Big Tits,big-ass:Big Ass,big-cock:Big Cock,brunette:Brunette,doggystyle:Doggystyle,cowgirl:Cowgirl,oral:Oral,missionary:Missionary,hardcore:Hardcore,pornstar:Pornstar,blonde:Blonde,milf:MILF,amateur:Amateur,babe:Babe,masturbation:Masturbation,cumshot:Cumshot,natural-tits:Natural Tits,small-tits:Small Tits,pussy-licking:Pussy Licking,fingering:Fingering,handjob:Handjob,shaved:Shaved,anal:Anal,skinny:Skinny,pov:POV,asian:Asian,deep-throat:Deep Throat,toys:Toys,reverse-cowgirl:Reverse Cowgirl,japanese:Japanese,fetish:Fetish,lesbian:Lesbian,interracial:Interracial,petite:Petite,threesome:Threesome,solo:Solo,creampie:Creampie,lingerie:Lingerie,mature:Mature,stockings:Stockings,mom:Mom,redhead:Redhead,facial:Facial,latina:Latina,ebony:Ebony,bbw:BBW,homemade:Homemade,step-fantasy:Step Fantasy,bbc:BBC,busty:Busty'), sorts: _cats('post_date:Свежее,video_viewed:По популярности,rating:По рейтингу,duration:Длинные,most_commented:По комментариям') },

    search: function (query, page) {
        var p = page || 1;
        var url = p > 1
            ? 'https://perfektdamen.co/search/' + p + '/?q=' + encodeURIComponent(query)
            : 'https://perfektdamen.co/search/1/?q=' + encodeURIComponent(query);
        return cherryFetch(url).then(function (html) {
            var items = _perfektCards(html);
            return { items: items, total_pages: _perfektPages(html, p, items.length) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    browse: function (category, page, sort) {
        var p = page || 1;
        var s = sort || (this.cfg.sorts[0] && this.cfg.sorts[0].id) || '';
        if (category) {
            var curl = _buildCatUrl('https://www.perfektdamen.co/tags/{slug}/{page}/', category, p, 1, true);
            if (s && curl.indexOf('sort_by=') === -1) {
                curl += (curl.indexOf('?') >= 0 ? '&' : '?') + 'sort_by=' + s;
            }
            return cherryFetch(curl).then(function (html) {
                var items = _perfektCards(html);
                return { items: items, total_pages: _perfektPages(html, p, items.length) };
            }).catch(function () { return { items: [], total_pages: 0 }; });
        }
        // NO category → /videos/ feed (paginated, 60 cards/page) sorted by sorts[0]
        // (post_date «Свежее» by default) — matches the homepage's recent content.
        // Was /popular/ (single-page best). /videos/{p}/?sort_by=post_date curl-verified.
        var url = (p > 1
            ? 'https://www.perfektdamen.co/videos/' + p + '/'
            : 'https://www.perfektdamen.co/videos/');
        if (s) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'sort_by=' + s;
        return cherryFetch(url).then(function (html) {
            var items = _perfektCards(html);
            return { items: items, total_pages: _perfektPages(html, p, items.length) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getRelated: _relatedFrom(_perfektCards),

    // Studios/channels: /channels/ index (60/page, real paysite brands w/ logos).
    // Per-channel /channels/{slug}/{page}/ renders 60 listing cards (_perfektCards).
    getStudios: function (page) {
        var p = page || 1;
        var url = p > 1 ? 'https://www.perfektdamen.co/channels/' + p + '/'
                        : 'https://www.perfektdamen.co/channels/';
        return cherryFetch(url).then(function (html) {
            return _parseModelIndex(html, {
                hrefRx: /href="((?:https?:\/\/(?:www\.)?perfektdamen\.co)?\/channels\/([a-z0-9][a-z0-9-]*)\/)"/g,
                exclude: function (u) {
                    // Drop nav (abc/favorites/videos/updated) + numeric pagination links.
                    return /\/channels\/(?:abc|favorites|videos|updated|page|\d+)\/?$/.test(u);
                },
                normalizeUrl: function (raw) {
                    return raw.charAt(0) === '/' ? 'https://www.perfektdamen.co' + raw : raw;
                },
                nameRx: [/alt="([^"]+)"/, /<p>\s*([^<]+)/],
                thumbRx: [/<img[^>]+(?:data-original|data-src|src)="([^"?#]+\.(?:jpe?g|webp|png))/i]
            });
        }).catch(function () { return []; });
    },

    browseByStudio: function (studioUrl, page) {
        var p = page || 1;
        var u = studioUrl.replace(/\/+$/, '');
        var url = p > 1 ? u + '/' + p + '/' : studioUrl;
        return cherryFetch(url).then(function (html) {
            var items = _perfektCards(html);
            return { items: items, total_pages: _perfektPages(html, p, items.length) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    // Models: /pornstars/ index (paginated /pornstars/{N}/). Relative links
    // /pornstars/{slug}/ with an <img data-original avatar. Exclude sort-nav
    // (abc/favorites/videos/updated) + numeric pagination links. Per-model
    // /pornstars/{slug}/{N}/ renders listing cards (reuse _perfektCards).
    getModels: function (page) {
        var p = page || 1;
        var url = p > 1 ? 'https://www.perfektdamen.co/pornstars/' + p + '/'
                        : 'https://www.perfektdamen.co/pornstars/';
        return cherryFetch(url).then(function (html) {
            return _parseModelIndex(html, {
                hrefRx: /href="((?:https?:\/\/(?:www\.)?perfektdamen\.co)?\/pornstars\/([a-z0-9][a-z0-9-]*)\/)"/g,
                exclude: function (u) {
                    return /\/pornstars\/(?:abc|favorites|videos|updated|page|\d+)\/?$/.test(u);
                },
                normalizeUrl: function (raw) {
                    return raw.charAt(0) === '/' ? 'https://www.perfektdamen.co' + raw : raw;
                },
                nameRx: [/title="([^"]+)"/, /alt="([^"]+)"/, /<p>\s*([^<]+)/],
                thumbRx: [/<img[^>]+(?:data-original|data-src|src)="([^"?#]+\.(?:jpe?g|webp|png))/i]
            });
        }).catch(function () { return []; });
    },

    browseByModel: function (modelUrl, page) {
        var p = page || 1;
        var u = modelUrl.replace(/\/+$/, '');
        var url = p > 1 ? u + '/' + p + '/' : modelUrl;
        return cherryFetch(url).then(function (html) {
            var items = _perfektCards(html);
            return { items: items, total_pages: _perfektPages(html, p, items.length) };
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
    // Collect card start offsets FIRST so each card's duration chunk can extend to the
    // NEXT card boundary: the <ul class="video-meta"> duration <span> renders ~2.3k
    // chars past the href (beyond a fixed window), so a card-bounded chunk is required.
    var cards = [];
    var seen = {};
    var m;
    while ((m = hrefRx.exec(html)) !== null) {
        if (seen[m[2]]) continue;
        seen[m[2]] = true;
        cards.push({ index: m.index, url: m[1], id: m[2] });
    }
    for (var c = 0; c < cards.length; c++) {
        var videoUrl = cards[c].url.charAt(0) === '/' ? 'https://www.perfektdamen.co' + cards[c].url : cards[c].url;
        var id = cards[c].id;
        var end = (c + 1 < cards.length) ? cards[c + 1].index : cards[c].index + 3000;

        // Forward-only: PerfektDamen uses data-original="//static.perfektdamen.co/...jpg"
        var chunk = html.slice(cards[c].index, Math.min(cards[c].index + 1000, end));
        var durChunk = html.slice(cards[c].index, end);

        var thumb = _attr(chunk, /(?:data-original|data-src|src)="([^"?#]+\.jpe?g)/i) ||
                    _attr(chunk, /(?:data-original|data-src|src)="([^"?#]+\.(?:webp|png))/i);

        var title = _decodeHtml(
            _attr(chunk, /title="([^"]+)"/) ||
            _attr(chunk, /<(?:h\d|div)[^>]*class="[^"]*(?:title|name)[^"]*"[^>]*>([^<]+)<\//) ||
            _attr(chunk, /alt="([^"]+)"/)
        );
        if (!title) title = _titleFromUrl(videoUrl);

        // Duration: <ul class="video-meta"><li><i class="fa fa-clock-o"></i> <span>24:14</span>…
        // No duration/time class — anchor to the clock icon, then the H:MM(:SS) <span>.
        // class="...duration..." kept as a fallback for any future markup variant.
        var duration = parseDur(
            _attr(durChunk, /fa-clock-o[^>]*>(?:\s*<[^>]*>)*\s*<span[^>]*>\s*([\d:]+)/i) ||
            _attr(durChunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</)
        );
        var views    = parseViews(_attr(durChunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));

        if (title || thumb) {
            items.push({ id: id, source: 'perfektdamen', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views });
        }
    }
    return items;
}

function _perfektPages(html, page, itemsLen) {
    var m = /\/search\/(\d+)\/["'][^>]*(?:last|>>)/i.exec(html);
    return m ? (parseInt(m[1], 10) || _derivePages(itemsLen, page, 20)) : _derivePages(itemsLen, page, 20);
}

// ---- HellPorno ----
SOURCES.push(_kvsEngine({
  id: 'hellporno',
  name: 'HellPorno',
  host: 'hellporno.com',
  categoryFmt: 'https://hellporno.com/{slug}/{page}/',
  catPageBase: 1, catPage1Omit: true,
  categories: _cats('mature:Mature,teen:Teen,japanese:Japanese,granny:Granny,anal:Anal,mom:Mom,solo-girl:Solo girl,group-sex:Group sex,missionary:Missionary,threesome:Threesome,masturbation:Masturbation,milf:MILF,bdsm:BDSM,russian:Russian,pissing:Pissing,gangbang:Gangbang,big-tits:Big tits,skinny:Skinny,ebony:Ebony,hairy:Hairy,asian:Asian,creampie:Creampie,interracial:Interracial,handjob:Handjob,casting:Casting,arab:Arab,teacher:Teacher,bbw:BBW,spread-legs:Spread legs,public:Public,massage:Massage,stockings:Stockings,solo:Solo,party:Party,big-ass:Big ass,old-and-young:Old and young,indian:Indian,amateur:Amateur,pov:POV,blowjob:Blowjob,office:Office,pantyhose:Pantyhose,pussy-licking:Pussy licking,doggy-style:Doggy style,cum-in-mouth:Cum in mouth,ffm:FFM,small-tits:Small tits,hd:HD,cumshot:Cumshot,double-penetration:Double penetration,outdoor:Outdoor,moaning:Moaning,babes:Babes,pornstar:Pornstar,femdom:Femdom,reality:Reality,reverse-cowgirl:Reverse cowgirl,hardcore:Hardcore,cuckold:Cuckold,riding:Riding,cartoon:Cartoon,nun:Nun,nurse:Nurse,catfight:Catfight,nylon:Nylon,catsuit:Catsuit,caught:Caught,objects:Objects,cbt:CBT,celebrity:Celebrity,oil:Oil,cfnm:CFNM,chain:Chain,old-man:Old man,chained:Chained,on-stage:On stage,chair:Chair,oral:Oral,cheating:Cheating,orgasm:Orgasm,cheerleader:Cheerleader,orgy:Orgy,chinese:Chinese,christmas:Christmas,pain:Pain,chubby-guy:Chubby guy,pakistani:Pakistani,cigar:Cigar,pale:Pale,cigarette:Cigarette,panties:Panties,classroom:Classroom,cleaning:Cleaning,park:Park,clit:Clit,parking:Parking,close-up:Close up,parody:Parody,clothed:Clothed,clothespins:Clothespins,club:Club,collar:Collar,peaches:Peaches,college:College,perfect-body:Perfect body,periwig:Periwig,comics:Comics,persian:Persian,compilation:Compilation,pervert:Pervert,condom:Condom,pickup:Pickup,corset:Corset,pierced-clit:Pierced clit,costume:Costume,pierced-cock:Pierced cock,coach:Coach,pierced-nipples:Pierced nipples,country:Country,pierced-tongue:Pierced tongue,voyeur:Voyeur'),
  sorts: _cats('post_date:Свежее,video_viewed:По популярности,video_viewed_today:Популярное за день,video_viewed_week:Популярное за неделю,video_viewed_month:Популярное за месяц,rating_week:Рейтинг за неделю,rating:По рейтингу,duration:Длинные,most_commented:По комментариям'),
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
      // 2257 is the U.S.C. 2257 legal-code footer link (/2257/), present on EVERY
      // page — never a real pager page. Excluding it stops total_pages=2257.
      if (!isNaN(n) && n !== 2257) nums.push(n);
    }
    var srRe = /\/search\/(\d+)\//g;
    while ((m = srRe.exec(html)) !== null) {
      var n = parseInt(m[1], 10);
      if (!isNaN(n) && n !== 2257) nums.push(n);
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

      // Hover-preview mp4 — each card has <video … src="…_trailer_360p.mp4" class="trailer_video">.
      // The class follows src in the live markup, so match the "_trailer_" filename directly.
      var pvM = block.match(/src="([^"]+_trailer[^"]*\.mp4[^"]*)"/i) ||
                block.match(/<video[^>]*class="[^"]*trailer[^"]*"[^>]*src="([^"]+\.mp4[^"]*)"/i);
      var preview = pvM ? pvM[1] : '';

      items.push({
        id: 'hp-' + id,
        source: 'hellporno',
        title: title,
        thumb: thumb,
        url: videoUrl,
        duration: duration,
        views: 0,
        preview: preview || undefined
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
    categories: _cats('russkoe-porno:Русские,incest:Инцест,zrelye:Зрелые,pickup:Пикап,kasting:Кастинг,vzroslye-s-molodymi:Взрослые с молодыми,molodenkie:Молоденькие,lyubitelskoe:Любительское,gruppovuha:Групповуха,anal:Анал,aziatki:Азиатки,latinki:Латинки,mezhrassovyj-seks:Межрассовый секс,tolstye:Толстые,sperma:Сперма,igrushki:Игрушки,krasotki:Красотки,lesbiyanki:Лесбиянки,minet:Минет,blondinki:Блондинки,bryunetki:Брюнетки,ryzhie:Рыжие,fetish-i-bdsm:Фетиш и БДСМ,bolshie-siski:Большие сиськи,bolshoj-chlen:Большой член,masturbaciya:Мастурбация,volosatye:Волосатые,dvojnoe-proniknovenie:Двойное проникновение,na-ulice:На улице,zhestkij-seks:Жесткий секс,china:Китайское,starushki:Старушки,milf:Милфа,korean:Корейское,granny:Бабушки,mama-druga:Мама друга,doiki:Дойки,huge-cock:Огромный член,shkola:Школа,big-ass:Большая жопа'),
    // 'date' = the site's bare homepage order (curl-verified: bare === ?sort=date,
    // and ?sort=mv differs). Default «Свежее» so page-1 lands on the newest feed,
    // not the old all-time-popular ?sort=mv. mv/mc kept after for opt-in.
    sorts: _cats('date:Свежее,mv:По популярности,mc:По комментариям'),
    // single-page search (site): /search/{q} takes no page param.
    searchUrl: function(query) {
        return 'https://sex.pornobolt.in/search/' + encodeURIComponent(query);
    },
    // BARE homepage (no ?sort=) = date order. The KVS engine appends ?sort={sorts[0].id}
    // → ?sort=date by default (≡ bare), or the user-chosen mv/mc.
    browseUrl: function(page) {
        return page > 1
            ? 'https://sex.pornobolt.in/' + page
            : 'https://sex.pornobolt.in/';
    },
    searchTotalPages: 1,
    hrefRxSrc: 'href="((?:https?://sex\\.pornobolt\\.in)?/video/([^/"]+)\\.html)"',
    idFromUrl: function(url, m) { return m[2]; },
    normalizeUrl: function(rawUrl) {
        return rawUrl.charAt(0) === '/' ? 'https://sex.pornobolt.in' + rawUrl : rawUrl;
    },
    // Models: /aktrisy index (36 models, relative /models/{name} links, name in
    // .dropdown-title, thumb in data-orig). Per-model /models/{name}/{page} cards.
    modelIndex: {
        url: function() { return 'https://sex.pornobolt.in/aktrisy'; },
        hrefRx: /href="((?:https?:\/\/sex\.pornobolt\.in)?\/models\/[^"\/]+)"/g,
        normalizeUrl: function(raw) {
            return raw.charAt(0) === '/' ? 'https://sex.pornobolt.in' + raw : raw;
        },
        nameRx: [/class="dropdown-title">([^<]+)</],
        // Featured cards lazy-load via data-orig; the rest expose the avatar as a
        // plain src= — try both so every card in the index gets a thumb.
        thumbRx: [/data-orig="(https?:\/\/[^"]+\.jpe?g)"/i, /(?:data-src|src)="(https?:\/\/[^"]+\.jpe?g)"/i],
        videosUrl: function(modelUrl, p) {
            var u = modelUrl.replace(/\/+$/, '');
            return p > 1 ? u + '/' + p : u;
        }
    },
    // after:900 (was 600) so the per-card duration block — <span class="vid-info
    // duration" itemprop="duration" content="PT…S">…</span> sits ~590-660 chars past
    // the href and was being truncated — is fully inside the chunk (min inter-card gap ~1174).
    chunkWindow: { before: 800, after: 900 },
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
        // Pager renders numbered links /{N}?sort=… (last visible page = real max),
        // e.g. <li class="dots">…<li><a href="/771?sort=mv">771</a>. The old
        // last/>>-adjacent regex missed them and returned a hardcoded 10. Collect all
        // numbered ?sort= links and take the max; return 0 on miss so _kvsPages falls
        // back to _derivePages(items.length, …) instead of capping at 10.
        var re = /\/(\d+)\?sort=/gi;
        var nums = [], m;
        while ((m = re.exec(html)) !== null) {
            var n = parseInt(m[1], 10);
            if (!isNaN(n)) nums.push(n);
        }
        return nums.length ? Math.max.apply(null, nums) : 0;
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
    categories: _cats('amateur:Amateur,anal:Anal,arab:Arab,asian:Asian,ass:Ass,babes:Babes,bbw:BBW,big-ass:Big ass,big-black-cock:Big black cock,big-cock:Big dick,big-tits:Big tits,blonde:Blonde,blowjob:Blowjob,brunette:Brunette,creampie:Creampie,cumshot:Cumshot,deepthroat:Deepthroat,double-penetration:Double penetration,ebony:Ebony,fake-tits:Fake tits,gangbang:Gangbang,granny:Granny,group-sex:Group sex,hairy:Hairy,handjob:Handjob,hardcore:Hardcore,hd:HD,indian:Indian,interracial:Interracial,japanese:Japanese,latina:Latina,mature:Mature,milf:MILF,mom:Mom,natural-tits:Natural tits,perfect-body:Perfect body,pov:POV,public:Public,pussy:Pussy,redhead:Redhead,russian:Russian,small-tits:Small tits,stockings:Stockings,teen:Teen,threesome:Threesome,webcam:Webcam'),
    sortMode: 'path',
    // GLOBAL feed «Свежее» = the bare /{page}/ root (browseUrl already serves latest).
    // globalLatestSort marks the sort id that maps to that bare root; any other sort
    // (e.g. most-popular) builds the path-based global feed /{sort}/{page}/.
    globalLatestSort: 'latest-updates',
    sorts: _cats('latest-updates:Свежее,most-popular:По популярности,top-rated:По рейтингу,longest:Длинные'),
    searchUrl: function(query, page) {
        return page > 1
            ? 'https://crocotube.com/search/' + page + '/?q=' + encodeURIComponent(query)
            : 'https://crocotube.com/search/1/?q=' + encodeURIComponent(query);
    },
    browseUrl: function(page) {
        return 'https://crocotube.com/' + (page || 1) + '/';
    },
    hrefRxSrc: 'href="(https?://crocotube\\.com/videos/[^"]+)"',
    // Pre-slice to the real listing container so the header mega-menu dropdown
    // (#menu-tab-free-videos "Last Added", identical on every page) isn't harvested
    // as ~19 duplicate cards. Start parsing at the first ct-videos-list.
    listScopeRx: /ct-videos-list/,
    idFromUrl: function(url) {
        return url.replace(/^https?:\/\/[^/]+\/videos\//, '').replace(/[^a-z0-9]/gi, '_');
    },
    // Models: /pornstars/ index (single-page, 5331 models inline). Per-model page
    // /pornstars/{slug}/ renders listing cards (reuse _kvsParseCards via browseByModel).
    modelIndex: {
        url: function() { return 'https://crocotube.com/pornstars/'; },
        hrefRx: /href="(https?:\/\/crocotube\.com\/pornstars\/[^"\/]+\/)"/g,
        nameRx: [/<span>([^<]+)<\/span>/, /alt="([^"]+)"/],
        thumbRx: [/(?:data-src|src)="(https?:\/\/[^"]+\.jpe?g)"/i],
        videosUrl: function(modelUrl, p) {
            var u = modelUrl.replace(/\/+$/, '');
            return p > 1 ? u + '/' + p + '/' : u + '/';
        }
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
    cfg: { categories: _cats('russkoe:Русское,molodye:Молодые,zrelye:Зрелые,mamki:Мамки,anal:Анал,minet:Минет,domashnee:Домашнее,krasivye-devushki:Красивые девушки,bryunetki:Брюнетки,blondinki:Блондинки,bolshie-siski:Большие сиськи,bolshie-chleny:Большие члены,jopy:Жопы,hudye:Худые,chulki-i-kolgotki:Чулки и колготки,ot-pervogo-lica:От первого лица,seks-vtroem:Секс втроем,gruppovoe:Групповое,kasting:Кастинг,kasting-vudmana:Кастинг Вудмана,studenty:Студенты,izmena:Измена,jeny:Жены,jmj:ЖМЖ,mjm:МЖМ,negry:Негры,mejrassovoe:Межрассовое,aziatki:Азиатки,latinki:Латинки,eblya:Ебля,rakom:Раком,krempay:Кремпай,sperma:Сперма,glubokaya-glotka:Глубокая глотка,skvirting:Сквиртинг,bdsm:БДСМ,fetish:Фетиш,masturbaciya:Мастурбация,pikap:Пикап,za-dengi:За деньги'), sorts: _cats('most-popular:По популярности,new:Свежее,top-rated:По рейтингу') },

    search: function (query, page) {
        var p = page || 1;
        // Site search param is ?s= (?q= returns 0 results).
        var url = 'https://www1.ebun.tv/search/?s=' + encodeURIComponent(query) + '&page=' + p;
        return cherryFetch(url).then(function (html) {
            var items = _ebunCards(html);
            return { items: items, total_pages: _ebunPages(html, p, items.length) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    browse: function (category, page, sort) {
        var p = page || 1;
        // Sort is a KVS path segment after the slug: /categories/{slug}/{sort}/{page}/
        // Default = most-popular (По популярности).
        var s = sort || 'most-popular';
        // NO-category branch uses path pagination — the site ignores ?page=N.
        var url = category
            ? _buildCatUrl('https://www1.ebun.tv/categories/{slug}/' + s + '/{page}/', category, p, 1, true)
            : (p > 1 ? 'https://www1.ebun.tv/latest-updates/' + p + '/' : 'https://www1.ebun.tv/latest-updates/');
        return cherryFetch(url).then(function (html) {
            var items = _ebunCards(html);
            return { items: items, total_pages: _ebunPages(html, p, items.length) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    // Models: /models/ index lists real model links /models/{slug}/ (excluding
    // single-letter section nav and /{xx}-model/total-videos/ country filters).
    // Per-model /models/{slug}/ renders listing cards (reuse _ebunCards). Model
    // pages appear single-page (/{slug}/2/ → 404), so total_pages derives small.
    getModels: function () {
        return cherryFetch('https://www1.ebun.tv/models/').then(function (html) {
            return _parseModelIndex(html, {
                hrefRx: /href="(https?:\/\/www1\.ebun\.tv\/models\/[^"]+\/)"/g,
                exclude: function (url) {
                    return /\/models\/[A-Za-z0-9]\/$/.test(url) || /\/total-videos\//.test(url);
                },
                nameRx: [/title="([^"]+)"/],
                thumbRx: [/(?:data-src|src)="(https?:\/\/[^"]+\.(?:jpe?g|webp|png))"/i]
            });
        }).catch(function () { return []; });
    },

    browseByModel: function (modelUrl, page) {
        var p = page || 1;
        var u = modelUrl.replace(/\/+$/, '');
        var url = p > 1 ? u + '/' + p + '/' : u + '/';
        return cherryFetch(url).then(function (html) {
            var items = _ebunCards(html);
            return { items: items, total_pages: _ebunPages(html, p, items.length) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getStream: function (video) {
        // ebun labels the FULL file with a bare 'mp4' key (no res → bestQualityUrl
        // ranks it 0) and a smaller file as '360p' → bestQualityUrl wrongly picks 360.
        // Prefer the unlabeled/bare-mp4 full file when present; else fall back to the
        // generic ranker. Scoped to ebun (does not touch the shared bestQualityUrl).
        function ebunBest(quality, fallbackUrl) {
            var keys = Object.keys(quality || {});
            if (!keys.length) return fallbackUrl;
            for (var i = 0; i < keys.length; i++) {
                if (!/\d{3,4}/.test(keys[i])) return quality[keys[i]]; // bare/unlabeled = full file
            }
            return bestQualityUrl(quality);
        }
        return cherryFetch(video.url).then(function (html) {
            var iframeM = /src="(https?:\/\/666-emded\.com\/embed\/[^"]+)"/i.exec(html);
            if (iframeM) {
                return cherryFetch(iframeM[1]).then(function (ihtml) {
                    var result = extractStreams(ihtml);
                    if (result.url || Object.keys(result.quality).length) {
                        return { url: ebunBest(result.quality, result.url), quality: result.quality };
                    }
                    return { url: '', quality: {} };
                }).catch(function () { return { url: '', quality: {} }; });
            }
            var res = extractStreams(html);
            return { url: ebunBest(res.quality, res.url), quality: res.quality };
        }).catch(function () { return { url: '', quality: {} }; });
    }
});

function _ebunCards(html) {
    var items = [];
    // ebun moved its video cards to a new domain (x.ebun.top) while the listing page stays
    // on www1.ebun.tv — match any ebun host so card links keep resolving across mirror changes.
    var hrefRx = /href="(https?:\/\/[a-z0-9.-]*ebun[a-z0-9.-]*\/videos\/(\d+)\/)"/g;
    var seen = {};
    var m;
    while ((m = hrefRx.exec(html)) !== null) {
        var videoUrl = m[1];
        var id = m[2];
        if (seen[id]) continue;
        seen[id] = true;

        // Look only FORWARD from href. Window 1100: the duration/views meta block
        // (<div class="meta-time">) sits at ~+950 from the href — the old 900 cap
        // clipped it, so listing AND model cards lost their duration overlay.
        var chunk = html.slice(m.index, m.index + 1100);

        var thumb = _attr(chunk, /(?:data-src|src)="([^"]+\.jpe?g)"/i) ||
                    _attr(chunk, /(?:data-src|src)="([^"]+\.(?:webp|png))"/i);

        var title = _decodeHtml(
            _attr(chunk, /<div[^>]*class="[^"]*item-title[^"]*"[^>]*>([^<]+)<\/div>/) ||
            _attr(chunk, /alt="([^"]+)"/) ||
            _attr(chunk, /title="([^"]+)"/)
        );
        if (!title) title = _titleFromUrl(videoUrl);

        // Duration/views render as <div class="meta-time"><span.../>28:50</div> —
        // an inner <span> icon precedes the value, so skip leading tags before the
        // captured text (the bare >([^<]+)< form matched the empty span instead).
        var duration = parseDur(_attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>(?:\s*<[^>]+>)*\s*([^<]+)</));
        var views    = parseViews(_attr(chunk, /class="[^"]*views?[^"]*"[^>]*>(?:\s*<[^>]+>)*\s*([^<]+)</));

        if (title || thumb) {
            items.push({ id: id, source: 'ebun', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views });
        }
    }
    return items;
}

function _ebunPages(html, page, itemsLen) {
    var m = /[?&]page=(\d+)["'][^>]*(?:last|>>)/i.exec(html);
    if (m) return parseInt(m[1], 10) || _derivePages(itemsLen, page, 30);
    // Regex miss: derive from batch fullness (~30 cards/page) instead of a hardcoded cap.
    return _derivePages(itemsLen, page, 30);
}

// ---- 12. LenPorno ----
SOURCES.push({
    id: 'lenporno',
    name: 'LenPorno',
    host: 'www.lenporno.net',
    cfg: { sorts: _cats('2:По популярности,3:По рейтингу'), categories: _cats('russkoye:Русское,molodyye:Молодые,zrelyye:Зрелые,mamki:Мамки,analnoye:Анальное,minet:Минет,domashneye:Домашнее,krasotki:Красотки,bryunetki:Брюнетки,blondinki:Блондинки,bolshiye-dojki:Большие дойки,bolshiye-popki:Большие попки,bolshiye-chleny:Большие члены,khudyye:Худые,v-chulkakh:В чулках,ot-pervogo-litsa:От первого лица,gruppovoye:Групповое,kasting:Кастинг,studenty:Студенты,izmena:Измена,gheny:Жены,mzhm:МЖМ,blacked:Негры,aziatskoye:Азиатское,yaponskoye:Японское,mulatki:Мулатки,rakom:Раком,sperma:Сперма,bdsm:БДСМ,masturbatsiya:Мастурбация,lesbiyanki:Лесбиянки,massazh:Массаж,volosatyye:Волосатые,dvoynoye-proniknoveniye:Двойное проникновение,dominirovaniye:Доминирование,orgazmy:Оргазмы,zhestkoye:Жесткое,na-prirode:На природе,na-publike:На публике,pikap:Пикап') },

    search: function (query, page) {
        // Path-style search: /search/{query}/?page={p} (24 cards/page, real pagination).
        // The old /search/?q= returned 0 cards (and /search/{q}/{n}/ + /page/{n}/ both
        // yield 0 — must use ?page=). 24 cards/page → _derivePages(24).
        var p = page || 1;
        var url = 'https://www.lenporno.net/search/' + encodeURIComponent(query) + '/?page=' + p;
        return cherryFetch(url).then(function (html) {
            var items = _lenpornoCards(html);
            return { items: items, total_pages: _derivePages(items.length, p, 24) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    browse: function (category, page, sort) {
        var p = page || 1;
        // Default to popular (?sort=2) when no sort chosen; bare URL = Новые.
        var s = sort || (this.cfg.sorts[0] && this.cfg.sorts[0].id) || '';
        if (category) {
            var curl = _buildCatUrl('https://www.lenporno.net/{slug}/{page}/', category, p, 1, true);
            if (s && curl.indexOf('sort=') === -1) {
                curl += (curl.indexOf('?') >= 0 ? '&' : '?') + 'sort=' + s;
            }
            return cherryFetch(curl).then(function (html) {
                var items = _lenpornoCards(html);
                return { items: items, total_pages: _lenpornoPages(html, p, items.length) };
            }).catch(function () { return { items: [], total_pages: 0 }; });
        }
        // NO category → /hdvideo/ = the site homepage (newest/«свежое»; bare root 301s
        // here). Was /the-best/ (best/popular). lenporno is in _ANDROID_FORCE_PROXY so the
        // proxy follows the mirror redirect on-device; /hdvideo/ paginates via ?page=N.
        var url = p > 1
            ? 'https://www.lenporno.net/hdvideo/?page=' + p
            : 'https://www.lenporno.net/hdvideo/';
        return cherryFetch(url).then(function (html) {
            var items = _lenpornoCards(html);
            return { items: items, total_pages: _lenpornoPages(html, p, items.length) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getRelated: _relatedFrom(_lenpornoCards),

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
                // Allow whitespace between the [label] and the URL — lenporno emits
                // "[240p] https://...mp4,[480p] https://...mp4"; without \s* the label
                // failed to bind, every url fell to the unlabeled branch, and best
                // stayed the FIRST (240p). With it, the quality map fills → max wins.
                var pjRe = /(?:\[([^\]]+)\]\s*)?(https?:\/\/[^,\[\]<>\s"']+\.mp4)/gi;
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
        if (!title) title = _titleFromUrl(videoUrl);

        var duration = parseDur(_attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</));
        var views    = parseViews(_attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));

        if (title || thumb) {
            items.push({ id: slug, source: 'lenporno', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views });
        }
    }
    return items;
}

function _lenpornoPages(html, page, itemsLen) {
    var m = /[?&]page=(\d+)["'][^>]*(?:last|>>|&raquo;)/i.exec(html);
    return m ? (parseInt(m[1], 10) || _derivePages(itemsLen, page, 20)) : _derivePages(itemsLen, page, 20);
}

// ---- 13. 24Rolika / Huyalkino ----
SOURCES.push({
    id: '24rolika',
    name: '24Rolika',
    host: 'w2.huyalkino.com',
    cfg: { categories: _cats('russia:Русское порно,russian:С переводом,gopa:Анал,retro:Ретро,asian-girl:Азиатки,bdsm:БДСМ,big-cock:Большие члены,big-tits:Большие сиськи,group:Групповуха,lesbi:Лесбиянки,teen:Молодые девушки,solo:Женская мастурбация,beautiful:Красивый секс,black:Межрасовое,homemade:Домашнее,incest:Инцест,orgasms:Оргазмы,movie:Порно фильмы,ok:Одноклассники,youtube-porno:Ютуб'), sorts: [] /* sort not URL-addressable (DLE/AJAX POST) */ },

    search: function (query, page) {
        // single-page search (site): DLE search does not paginate natively (no page param).
        var url = 'https://w2.huyalkino.com/index.php?do=search&subaction=search&story=' + encodeURIComponent(query);
        return cherryFetch(url).then(function (html) {
            return { items: _rolikaCards(html), total_pages: 1 };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    browse: function (category, page) {
        var p = page || 1;
        // DLE category: page1 = /{slug}/ (NOT /{slug}/page/ — the bare /page/ segment
        // is a malformed URL; _buildCatUrl's page1Omit leaves an orphan /page/). page>1
        // = /{slug}/page/{N}/. No-category home is /{}/ then /page/{N}/.
        var url = category
            ? (p > 1 ? 'https://w2.huyalkino.com/' + category + '/page/' + p + '/'
                     : 'https://w2.huyalkino.com/' + category + '/')
            : (p > 1 ? 'https://w2.huyalkino.com/page/' + p + '/' : 'https://w2.huyalkino.com/');
        return cherryFetch(url).then(function (html) {
            var items = _rolikaCards(html);
            return { items: items, total_pages: _rolikaPages(html, p, items.length) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getRelated: _relatedFrom(_rolikaCards),

    // Studios: the /movie/ taxonomy is a side-menu of /movie/{slug}/ sections
    // (paysite brands like Brazzers/Blacked + country/type feeds). Text links, no
    // logos → letter-tile fallback. Single index page (no pagination needed).
    getStudios: function (page) {
        if ((page || 1) > 1) return Promise.resolve([]);
        return cherryFetch('https://w2.huyalkino.com/movie/').then(function (html) {
            return _parseModelIndex(html, {
                hrefRx: /href="((?:https?:\/\/w2\.huyalkino\.com)?\/movie\/([a-z0-9][a-z0-9-]*)\/)"/g,
                exclude: function (u) { return /\/movie\/page\//.test(u); },
                normalizeUrl: function (raw) {
                    return raw.charAt(0) === '/' ? 'https://w2.huyalkino.com' + raw : raw;
                },
                nameRx: [/>([^<]+)<\/a>/],
                thumbRx: []
            });
        }).catch(function () { return []; });
    },

    // A studio's videos — /movie/{slug}/page/{N}/ (two-segment cards, widened rx).
    browseByStudio: function (studioUrl, page) {
        var p = page || 1;
        var u = studioUrl.replace(/\/+$/, '');
        var url = p > 1 ? u + '/page/' + p + '/' : studioUrl;
        return cherryFetch(url).then(function (html) {
            var items = _rolikaCards(html);
            return { items: items, total_pages: _rolikaPages(html, p, items.length) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getStream: function (video) {
        return cherryFetch(video.url).then(function (html) {
            var m;
            // Return RAW stream URLs — px() in playVideo is the single proxy-decision
            // point (browser → proxied, Android → raw device-IP fetch).
            // Playerjs (DLE plugin): new Playerjs({file:"url"})
            m = /Playerjs\s*\(\s*\{[^{}]*['"]?file['"]?\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))['"]/i.exec(html);
            if (m) return { url: m[1], quality: {} };
            // JWPlayer fallback
            m = /jwplayer\s*\([^)]*\)\s*\.setup\s*\(\s*\{[\s\S]{0,500}?['"]?file['"]?\s*:\s*['"]([^'"]+\.(?:mp4|m3u8))['"]/i.exec(html);
            if (m) return { url: m[1], quality: {} };
            return extractStreams(html);
        }).catch(function () { return { url: '', quality: {} }; });
    }
});

function _rolikaCards(html) {
    var items = [];
    // One- OR two-segment card URLs: normal categories use /{cat}/{id}-slug.html,
    // /movie/{studio}/ studio pages use /movie/{studio}/{id}-slug.html. The {1,2}
    // segment repetition matches both (verified card-count parity on 1-seg pages).
    var hrefRx = /href="((?:https?:\/\/w2\.huyalkino\.com)?(?:\/[a-z0-9][a-z0-9\-]*){1,2}\/\d+[^"]+\.html)"/g;
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
        if (!title) title = _titleFromUrl(videoUrl);

        // Duration: <div class="th-time icon-l"><span class="fa fa-clock-o"></span>39:20</div>
        // — the time follows an inner <span> icon, so step past any leading inner tags.
        var duration = parseDur(_attr(chunk, /class="[^"]*(?:duration|time|th-time)[^"]*"[^>]*>(?:\s*<[^>]+>)*\s*([\d:]+(?:\s*min)?)/i));
        var views    = parseViews(_attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));

        if (title || thumb) {
            items.push({ id: id, source: '24rolika', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views });
        }
    }
    return items;
}

function _rolikaPages(html, page, itemsLen) {
    var m = /\/page\/(\d+)\/["'][^>]*(?:last|>>)/i.exec(html);
    return m ? (parseInt(m[1], 10) || _derivePages(itemsLen, page, 20)) : _derivePages(itemsLen, page, 20);
}

// ---- 14. JopaOnline ----
SOURCES.push({
    id: 'jopaonline',
    name: 'JopaOnline',
    host: 'jopaonline.mobi',
    cfg: { categories: _cats('mamki:Мамки,russkoe:Русское,zhestkoe:Жесткое,zrelye:Зрелые,izmena:Измена,krasotki:Красотки,domashnee:Домашнее,big-cock:Большие члены,gruppovoe:Групповое,anal:Анал,asian:Азиатки,studenty:Студенты,blonde:Блондинки,bolshie-siski:Большие сиськи,bryunetki:Брюнетки,dvoynoe-proniknovenie:Двойное проникновение,hudenkie:Худые,krasiviy-seks:Красивый секс,lesbiyanki:Лесбиянки,masturbation:Мастурбация,mejrassovyy:Межрасовое,minet:Минет,molodye:Молодые,mulatki:Мулатки,pickap:Пикап,rakom:Раком,redhead:Рыжие,s-negrami:Негры,stockings:Чулки,v-vannoi:В ванной,zhopy:Жопы'), sorts: _cats('popular:По популярности,toprated:По рейтингу') },

    search: function (query, page) {
        // single-page search (site): DLE ?do=search returns one page (no page param) → total_pages 1.
        // DLE search responds HTTP 404 but the body DOES contain result cards, so use
        // the status-tolerant _fetchAny (cherryFetch would throw on !ok and drop them).
        var url = 'https://jopaonline.mobi/?do=search&subaction=search&story=' + encodeURIComponent(query);
        return _fetchAny(url).then(function (html) {
            return { items: _jopaCards(html), total_pages: 1 };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    browse: function (category, page, sort) {
        var p = page || 1;
        // category → /categories/{slug}/{sort}/{n} (DLE path, no trailing slash); else home /{n}.
        // Sort is a path segment after the slug; default = popular (По популярности).
        var s = sort || 'popular';
        var url = category
            ? _buildCatUrl('https://jopaonline.mobi/categories/{slug}/' + s + '/{page}', category, p, 1, true)
            : (p > 1 ? 'https://jopaonline.mobi/' + p : 'https://jopaonline.mobi/');
        return cherryFetch(url).then(function (html) {
            var items = _jopaCards(html);
            return { items: items, total_pages: _jopaPages(html, p, items.length) };
        }).catch(function () { return { items: [], total_pages: 0 }; });
    },

    getRelated: _relatedFrom(_jopaCards),

    // Models: /models index (24 real models/page; excludes numeric pagination
    // links and /models/sort-by-* sort links). Per-model /models/{slug}/{page}
    // renders listing cards (reuse _jopaCards). Index name markup is garbled
    // Cyrillic → derive name from slug via _humanizeName (default in helper).
    getModels: function (page) {
        var p = page || 1;
        var url = p > 1 ? 'https://jopaonline.mobi/models/' + p : 'https://jopaonline.mobi/models';
        return cherryFetch(url).then(function (html) {
            return _parseModelIndex(html, {
                hrefRx: /href="(https?:\/\/jopaonline\.mobi\/models\/[a-z0-9-]+)"/g,
                exclude: function (u) {
                    return /\/models\/\d+$/.test(u) || /\/models\/sort-by-/.test(u);
                },
                thumbRx: [/(?:data-src|src|class="lazylodsrc"[^>]*src)="(https?:\/\/[^"]+\.(?:jpe?g|webp|png))"/i]
            });
        }).catch(function () { return []; });
    },

    browseByModel: function (modelUrl, page) {
        var p = page || 1;
        var u = modelUrl.replace(/\/+$/, '');
        var url = p > 1 ? u + '/' + p : u;
        return cherryFetch(url).then(function (html) {
            var items = _jopaCards(html);
            return { items: items, total_pages: _jopaPages(html, p, items.length) };
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
        if (!title) title = _titleFromUrl(videoUrl);

        var duration = parseDur(_attr(chunk, /class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]+)</));
        var views    = parseViews(_attr(chunk, /class="[^"]*views?[^"]*"[^>]*>([^<]+)</));

        // Hover-preview mp4: each card's <img data-preview="…/prev_{id}.mp4"> (CDN
        // absolute URL on yourstream.pro) — consistent with 3movs/pornve preview.
        var preview = _attr(chunk, /data-preview="([^"]+\.mp4[^"]*)"/i);

        if (title || thumb) {
            items.push({ id: id, source: 'jopaonline', title: title, thumb: thumb, url: videoUrl, duration: duration, views: views, preview: preview || undefined });
        }
    }
    return items;
}

function _jopaPages(html, page, itemsLen) {
    var m = /href="https?:\/\/jopaonline\.mobi\/(\d+)"[^>]*(?:last|>>)/i.exec(html) ||
            /["']\/(\d+)["'][^>]*(?:last|>>)/i.exec(html);
    return m ? (parseInt(m[1], 10) || _derivePages(itemsLen, page, 20)) : _derivePages(itemsLen, page, 20);
}

})();
