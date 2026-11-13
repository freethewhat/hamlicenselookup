#!/usr/bin/env bash
# Per-app setup (idempotent). Run as root after setup-server.sh:
#   bash setup-app.sh hams.example.org ghcr.io/<owner>/<repo>
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
DOMAIN="${1:?usage: setup-app.sh <domain> <image>}"
IMAGE="${2:?usage: setup-app.sh <domain> <image>}"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "bad domain" >&2; exit 1; }
[[ "$IMAGE" =~ ^[a-z0-9./_-]+$ ]] || { echo "bad image (must be lowercase, no tag)" >&2; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP=/srv/apps/ham-finder

mkdir -p "$APP/data" /srv/apps/caddy/sites
chown 1000:1000 "$APP/data"

sed "s|__IMAGE__|$IMAGE|" "$HERE/ham-finder/docker-compose.yml" > "$APP/docker-compose.yml"
install -m 755 -o root -g root "$HERE/ham-finder/deploy.sh" "$APP/deploy.sh"

sed "s|__DOMAIN__|$DOMAIN|" "$HERE/ham-finder.caddy" > /srv/apps/caddy/sites/ham-finder.caddy
docker compose -f /srv/apps/caddy/docker-compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile

for u in ham-finder-weekly.service ham-finder-weekly.timer ham-finder-daily.service \
         ham-finder-daily.timer ham-finder-setup.service; do
  install -m 644 "$HERE/$u" "/etc/systemd/system/$u"
done
systemctl daemon-reload
systemctl enable --now ham-finder-weekly.timer ham-finder-daily.timer

echo "App setup done for $DOMAIN."
