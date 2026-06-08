# Cherry — миграция прокси на VPS (vaultvpn), сосуществуя с VPN (2026-06-06)

VPS: 185.36.141.21 · Ubuntu 24.04 · 1 vCPU / 1 GB / 20 GB. На нём поднят **VPN — НЕ удалять, не ломать**.
Цель: перенести прокси-роль Deno (cherry-proxy.aawersom.deno.net) на этот VPS → стабильный IP + без квоты.
Режим: medium с повышенной осторожностью. Код-бэкап сделан (backups/2026-06-06).

## Принцип безопасности для VPN
Только ДОБАВЛЯЕМ сервисы на свободных портах. НЕ трогаем конфиг/маршруты/интерфейс VPN.
Перед любыми изменениями — бэкап /etc/wireguard и /etc/openvpn и проверка egress-IP.

## Этап 0 — Pre-checks (read-only по SSH)
1. Тип VPN: `wg show` / `ls /etc/wireguard /etc/openvpn` / `systemctl --type=service --state=running`.
2. **Egress-IP:** `curl -s https://ifconfig.me` → должно быть **185.36.141.21**. Если другой — VPS гонит свой трафик через ВНЕШНИЙ VPN (policy-routing) → нужно исключить трафик прокси из тоннеля (иначе сломается IP-affinity и/или egress). Решается через `ip rule`/fwmark для процесса прокси.
3. Свободны ли TCP **80/443** (для Caddy/TLS): `ss -tlnp`. VPN обычно UDP (51820/1194) — конфликта нет, подтвердить.
4. Ресурсы: `free -m`, `df -h /`. 1 ГБ — прокси лёгкий (I/O-bound), но добавить **1 ГБ swap** для запаса при стримах.
5. Firewall: `ufw status` / `iptables -S`.

## Этап 1 — Бэкап VPS (до изменений)
- `tar czf /root/vpn-backup.tgz /etc/wireguard /etc/openvpn 2>/dev/null` + `wg showconf` → скачать к себе (SCP) в backups/2026-06-06/vps/.
- Снимок списка пакетов/служб: `dpkg -l`, `systemctl list-unit-files --state=enabled`.

## Этап 2 — Установка прокси (coexist)
1. Deno: `curl -fsSL https://deno.land/install.sh | sh` (или Node). Переиспользуем `workers/cherry-proxy-deno/main.js`.
2. Каталог `/opt/cherry-proxy/`, туда main.js.
3. systemd-юнит `cherry-proxy.service`: слушает **127.0.0.1:8787**, env `PROXY_KEY=1206` (+ SYNC_SECRET если /favs нужен; иначе /favs остаётся на CF). Restart=always.
4. **VPN не трогаем** — это отдельный сервис на своих портах.

## Этап 3 — TLS (плагин требует https, lampa.mx — https)
- **Caddy** на :443 → reverse_proxy 127.0.0.1:8787, auto-HTTPS.
- Домена нет → **sslip.io**: `185-36-141-21.sslip.io` резолвится в IP, Caddy берёт реальный Let's Encrypt сертификат. Итог: `PROXY_URL_2 = https://185-36-141-21.sslip.io`.
- `ufw allow 80,443/tcp` (нужно для выдачи/обновления сертификата + клиентов).

## Этап 4 — Переключение плагина
- В plugin.js: `var PROXY_URL_2 = 'https://185-36-141-21.sslip.io';` (вместо deno.net).
- CF Worker остаётся (лёгкие запросы) + уже добавленный **Deno→CF failover** превращается в **VPS→CF failover** (страховка).
- Деплой плагина (как обычно).

## Этап 5 — Тесты
1. Через VPS-прокси отдают карточки: xnxx, youjizz, tizam, pornone, porntrex, spankbang, perfektdamen (+ eporner direct не зависит).
2. **Стримы** играют: pornone, porntrex, hqporner (видео через VPS, стабильный IP).
3. **VPN жив:** подключить клиента / `wg show` handshake свежий / ping через тоннель.
4. Нагрузка: `htop` при 1-2 стримах (1 ГБ RAM — следим).

## Этап 6 — Вывод Deno
- После подтверждения — Deno Deploy можно забросить (failover на CF останется).

## Открытое (нужно от владельца)
- ⚠ **Root-пароль со скриншота (`BlbU?5py!+ko`) НЕ подошёл** (OCR? l/I, o/0). Прислать точный текстом или сбросить в панели.
- ASN-блок (xnxx/spankbang): IP VPS 185.36.141.21 — датацентровый; если xnxx его блокирует, эти 1-2 сайта оставить на residential (`PROXY_URL_3`) — проверим на Этапе 5.
