# cherry-proxy on VPS (replaces Deno Deploy)

Deno Deploy free egress quota kept dying on video streaming → moved to a self-hosted VPS.

**VPS:** 185.36.141.21 (vaultvpn, Ubuntu 24.04) — also runs AmneziaWG VPN (Docker, UDP 35367; untouched).

**Stack:**
- `deno run --allow-net --allow-env /opt/cherry-proxy/main.js` (this file) on 127.0.0.1:8787 via systemd `cherry-proxy.service` (env PROXY_KEY=1206, PORT=8787).
- Caddy on :80/:443 → reverse_proxy 127.0.0.1:8787, auto-TLS for `185-36-141-21.sslip.io` (no domain needed).
- 2 GB swap added.

**Plugin:** `PROXY_URL_2 = https://185-36-141-21.sslip.io` (VPS→CF failover stays as backstop).

**Update:** edit this file → scp to /opt/cherry-proxy/main.js → `systemctl restart cherry-proxy`.
**VPN:** never touch /opt/amnezia or the amnezia-awg container.
