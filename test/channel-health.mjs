// Channel output health-check (manual smoke test): node test/channel-health.mjs
//
// For each channel, fetches a real browse page via the proxy the plugin uses and
// counts matches of THAT adapter's PARSER MARKER (the exact class/href/JSON key the
// adapter keys on) — NOT a generic heuristic. So EMPTY here means the plugin's own
// parser would also find nothing ("нет выдачи"), e.g. after a site redesign.
//
// NB: authoritative output verification is the rendered E2E (cherry-lampa-e2e.mjs);
// this is a fast pre-check to spot a channel that suddenly stops returning cards.

const CF = 'https://cherry-proxy.aawersom.workers.dev/proxy';
const DENO = 'https://cherry-proxy.aawersom.deno.net/proxy';
const KEY = '1206';

// id → { url, proxy, marker }  — marker mirrors the adapter's real parse key.
const CH = {
  pornhub:      { url: 'https://www.pornhub.com/webmasters/search?search=&page=1&ordering=mostviewed&thumbsize=medium_hd&category=milf', proxy: 'direct', marker: /"video_id"/g },
  xvideos:      { url: 'https://www.xvideos.com/c/Amateur-12', proxy: 'deno', marker: /class="[^"]*thumb-block/g },
  xnxx:         { url: 'https://www.xnxx.com/search/amateur/0', proxy: 'deno', marker: /class="[^"]*thumb-block/g },
  eporner:      { url: 'https://www.eporner.com/api/v2/video/search/?query=milf&per_page=30&page=1&order=latest&format=json', proxy: 'direct', marker: /"id"\s*:/g },
  hqporner:     { url: 'https://hqporner.com/hdporn', proxy: 'deno', marker: /\/hdporn\/[a-z0-9-]/g },
  youjizz:      { url: 'https://www.youjizz.com/most-popular/1.html', proxy: 'deno', marker: /class="video-thumb/g },
  spankbang:    { url: 'https://ru.spankbang.com/new_videos/1/', proxy: 'deno', marker: /href="\/[\w-]+\/video\//g },
  pornone:      { url: 'https://pornone.com/amateur/', proxy: 'deno', marker: /\/\d{5,}\/(?:"|')/g },
  porntrex:     { url: 'https://www.porntrex.com/latest-updates/', proxy: 'deno', marker: /\/video\/\d+\//g },
  xozilla:      { url: 'https://xozilla.com/categories/amateur/', proxy: 'cf', marker: /\/videos\/\d+\//g },
  analdin:      { url: 'https://www.analdin.com/categories/amateur/1/', proxy: 'cf', marker: /\/videos\/\d+\//g },
  hellporno:    { url: 'https://hellporno.com/categories/amateur/', proxy: 'cf', marker: /\/videos\/\d+\//g },
  pornobolt:    { url: 'https://sex.pornobolt.in/anal', proxy: 'cf', marker: /\/video\/[a-z0-9-]/g },
  crocotube:    { url: 'https://crocotube.com/categories/amateur/', proxy: 'cf', marker: /\/videos\/\d+\//g },
  '3movs':      { url: 'https://3movs.com/categories/amateur/most-viewed/all-time/', proxy: 'cf', marker: /\/videos\/\d+\//g },
  pornve:       { url: 'https://pornve.com/categories/teens/', proxy: 'cf', marker: /\/video\/\d+\//g },
  familyporn:   { url: 'https://familyporn.tv/categories/stepmom-stepson/', proxy: 'cf', marker: /\/videos\/[a-z0-9][a-z0-9-]+\//g },
  perfektdamen: { url: 'https://www.perfektdamen.co/popular', proxy: 'deno', marker: /\/video\/\d+\//g },
  tizam:        { url: 'https://tv4.tizam.org/fil_my_dlya_vzroslyh/s_russkim_perevodom/', proxy: 'deno', marker: /\/\d+-[a-z0-9-]+\.html/g },
  ebun:         { url: 'https://www1.ebun.tv/categories/amateur/', proxy: 'cf', marker: /\/videos\/\d+\//g },
  lenporno:     { url: 'https://www.lenporno.net/russkoye/', proxy: 'cf', marker: /\/[a-z0-9-]{10,}\.html/g },
  '24rolika':   { url: 'https://w2.huyalkino.com/russian/', proxy: 'cf', marker: /\/\d+-[a-z0-9-]+\.html/g },
  jopaonline:   { url: 'https://jopaonline.mobi/categories/mamki/', proxy: 'cf', marker: /\/porno-video\/\d+/g },
  porndig:      { url: 'https://porndig.com/channels/33/anal', proxy: 'cf', marker: /\/videos\/\d+\/[a-z0-9-]+\.html/g },
};

function proxied(url, proxy) {
  if (proxy === 'direct') return url;
  return (proxy === 'deno' ? DENO : CF) + '?url=' + encodeURIComponent(url) + '&key=' + KEY;
}

async function probe(id, cfg) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 25000);
    const r = await fetch(proxied(cfg.url, cfg.proxy), { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    clearTimeout(t);
    const body = await r.text();
    const m = body.match(cfg.marker);
    const distinct = m ? new Set(m).size : 0;
    return { id, http: r.status, bytes: body.length, cards: m ? m.length : 0, distinct };
  } catch (e) {
    return { id, http: 'ERR', bytes: 0, cards: 0, distinct: 0, err: e.message };
  }
}

const ids = Object.keys(CH);
const results = [];
for (let i = 0; i < ids.length; i += 6) {
  results.push(...await Promise.all(ids.slice(i, i + 6).map((id) => probe(id, CH[id]))));
}
results.sort((a, b) => a.cards - b.cards);
let bad = 0;
for (const r of results) {
  const verdict = r.cards >= 5 ? 'PASS' : (r.http === 'ERR' ? 'ERROR' : 'EMPTY ⚠ (нет выдачи)');
  if (verdict !== 'PASS') bad++;
  console.log(String(r.id).padEnd(13), 'HTTP', String(r.http).padEnd(4), 'distinct', String(r.distinct).padStart(4), 'bytes', String(r.bytes).padStart(7), ' ', verdict, r.err ? '(' + r.err + ')' : '');
}
console.log('\n' + (results.length - bad) + '/' + results.length + ' channels have output; ' + bad + ' EMPTY/ERROR');
