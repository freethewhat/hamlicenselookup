#!/usr/bin/env bash
# Usage: deploy.sh <tag>. Runs as root (via deploy-dispatch). Never touches ./data.
set -euo pipefail
APP_DIR="${APP_DIR:-/srv/apps/ham-finder}"
TAG="${1:?usage: deploy.sh <tag>}"
[[ "$TAG" =~ ^[0-9a-f]{7,40}$ ]] || { echo "bad tag: $TAG" >&2; exit 2; }
cd "$APP_DIR"

PREV=$(cat last-good-tag 2>/dev/null || true)

# Point .env at an image tag, keeping any other settings (such as AUTO_UPDATE=0) the owner added.
set_tag() {
  local tmp
  tmp=$(mktemp .env.XXXXXX)
  { grep -v '^IMAGE_TAG=' .env 2>/dev/null || true; echo "IMAGE_TAG=$1"; } > "$tmp"
  chmod 644 "$tmp"
  mv "$tmp" .env
}

healthy() {
  docker compose exec -T app node -e "fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1
}

# Pull, switch .env, start, and wait for two consecutive good health checks
# (one is not enough: a crash-looping container can answer once).
deploy_new() {
  IMAGE_TAG="$TAG" docker compose pull || return 1
  set_tag "$TAG"
  docker compose up -d || return 1
  local streak=0 i
  for i in $(seq 1 15); do
    if healthy; then streak=$((streak + 1)); else streak=0; fi
    [ "$streak" -ge 2 ] && return 0
    sleep "${HEALTH_SLEEP:-3}"
  done
  return 1
}

rollback() {
  if [ -n "$PREV" ]; then
    set_tag "$PREV"
    docker compose up -d || true
    echo "Rolled back to $PREV"
  fi
}

if ! deploy_new; then
  echo "Deploy of $TAG failed" >&2
  rollback
  exit 1
fi

echo "$TAG" > last-good-tag

rc=0
out=$(docker compose exec -T app node scripts/check-schema.js) || rc=$?
echo "$out"
# Anything not ok: the setup job runs `auto`, which rebuilds what is missing or outdated and
# exits quietly if the app's own start-up update already holds the update lock.
if [ "$rc" != 0 ]; then
  systemctl start --no-block ham-finder-setup.service
fi

# Remove old images of this app, keeping the new and previous tag.
REPO=$(docker compose config --images | head -n1)
REPO=${REPO%:*}
docker image ls --format '{{.Repository}}:{{.Tag}}' \
  | grep "^${REPO}:" \
  | grep -vxF -e "${REPO}:${TAG}" -e "${REPO}:${PREV:-none}" \
  | xargs -r docker image rm || true
docker image prune -f >/dev/null || true
echo "Deployed $TAG"
