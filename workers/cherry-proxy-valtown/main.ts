// Cherry proxy — Val.town HTTP val (free tier) for CF-challenged light listings (spankbang).
// Val.town's egress IP tends to pass Cloudflare's bot-check (like Deno did), so this is
// used ONLY for the spankbang LISTING (KB). Video stays on the VPS — keeps usage tiny.
//
// Deploy: val.town → New val → HTTP → paste this → Save. Set the env var PROXY_KEY=1206
// (val Settings → Environment Variables). The public URL looks like
//   https://<user>-cherryproxy.web.val.run
// Same interface as the other proxies: GET /proxy?url=<ENC>&key=<PROXY_KEY>

const KEY = Deno.env.get("PROXY_KEY") || "1206";

function cors(body: BodyInit | null, status = 200, ct = "text/plain"): Response {
  return new Response(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Range",
      "Content-Type": ct,
    },
  });
}

function isPrivate(host: string): boolean {
  const h = (host || "").toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const p = h.split(".").map(Number);
  if (p.length === 4 && !p.some(isNaN)) {
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return cors("", 204);
  const url = new URL(req.url);
  const target = url.searchParams.get("url");
  if (!target) return cors("Missing ?url=", 400);
  if (url.searchParams.get("key") !== KEY) return cors("Forbidden", 403);
  let t: URL;
  try { t = new URL(target); } catch { return cors("Bad url", 400); }
  if (isPrivate(t.hostname)) return cors("Not allowed", 403);

  const r = await fetch(t.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,*/*",
      "Accept-Language": "ru,en;q=0.9",
    },
    redirect: "follow",
  });
  const headers = new Headers(r.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.delete("content-security-policy");
  headers.delete("x-frame-options");
  return new Response(r.body, { status: r.status, headers });
}
