(function () {
  // What the stand's WebView can do with HLS and how Lampa's inner player picks its engine.
  var v = document.createElement('video');
  var out = {
    ua: navigator.userAgent.slice(0, 90),
    hlsjs: typeof window.Hls !== 'undefined',
    hlsjsSupported: (typeof window.Hls !== 'undefined' && window.Hls.isSupported) ? window.Hls.isSupported() : null,
    nativeHls: v.canPlayType('application/vnd.apple.mpegurl') || v.canPlayType('application/x-mpegURL') || '(none)',
    mse: typeof window.MediaSource !== 'undefined',
    player: Lampa.Storage.get('player', 'inner'),
    lampaVersion: (Lampa.Manifest && Lampa.Manifest.app_digital) || (window.lampa_settings && window.lampa_settings.version) || ''
  };
  return out;
})()
