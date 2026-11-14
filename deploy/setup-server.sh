#!/usr/bin/env bash
# One-time (idempotent) setup of the shared app server. Run as root:
#   bash setup-server.sh
# Must be run from a copy of the repo's deploy/ folder. It holds nothing app-specific:
# each app adds its own deploy key later with /srv/apps/bin/add-deploy-key.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get -y upgrade
apt-get -y install ufw unattended-upgrades ca-certificates curl sudo

# Docker Engine + Compose plugin from Docker's official apt repo.
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  . /etc/os-release
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# Default log cap for every container, so an app that forgets its own `logging:` block
# cannot fill the disk. Applies to containers created after this. Written only once.
if [ ! -f /etc/docker/daemon.json ]; then
  install -d -m 755 /etc/docker
  printf '%s\n' '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }' \
    > /etc/docker/daemon.json
  systemctl restart docker
fi
systemctl enable --now docker

docker network inspect web >/dev/null 2>&1 || docker network create web

# 2 GB swap file.
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Firewall. Docker-published ports bypass ufw; that is fine because only Caddy publishes.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# Shared Caddy.
mkdir -p /srv/apps/caddy/sites /srv/apps/bin
cp "$HERE/caddy/docker-compose.yml" /srv/apps/caddy/docker-compose.yml
cp "$HERE/caddy/Caddyfile" /srv/apps/caddy/Caddyfile
docker compose -f /srv/apps/caddy/docker-compose.yml up -d

# Deploy user: no password, no sudo group, not in the docker group. Keys are added per
# app by add-deploy-key; existing keys are kept.
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

# Forced command. Each key passes the one app it may deploy as $1.
cat > /srv/apps/bin/deploy-dispatch <<'EOF'
#!/usr/bin/env bash
# Forced command for the deploy user: deploy-dispatch <allowed-app>.
# Accepts only: deploy <allowed-app> <tag>
set -euo pipefail
allowed="${1:-}"
read -r verb app tag extra <<< "${SSH_ORIGINAL_COMMAND:-}"
if [ "${verb:-}" != deploy ] || [ -n "${extra:-}" ] \
   || ! [[ "$allowed" =~ ^[a-z0-9-]+$ ]] || [ "${app:-}" != "$allowed" ] \
   || ! [[ "${tag:-}" =~ ^[0-9a-f]{7,40}$ ]] \
   || [ ! -f "/srv/apps/$app/deploy.sh" ]; then
  echo "usage: deploy <app> <tag>" >&2
  exit 2
fi
exec sudo "/srv/apps/$app/deploy.sh" "$tag"
EOF
chown root:root /srv/apps/bin/deploy-dispatch
chmod 755 /srv/apps/bin/deploy-dispatch

install -m 755 -o root -g root "$HERE/add-deploy-key.sh" /srv/apps/bin/add-deploy-key

SUDOERS_TMP="$(mktemp)"
echo 'deploy ALL=(root) NOPASSWD: /srv/apps/*/deploy.sh' > "$SUDOERS_TMP"
visudo -cf "$SUDOERS_TMP"
install -m 440 -o root -g root "$SUDOERS_TMP" /etc/sudoers.d/deploy
rm -f "$SUDOERS_TMP"

echo "Server setup done."
