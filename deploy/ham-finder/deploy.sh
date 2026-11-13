#!/usr/bin/env bash
# Usage: deploy.sh <tag>. Runs as root (via deploy-dispatch). Never touches ./data.
set -euo pipefail
APP_DIR="${APP_DIR:-/srv/apps/ham-finder}"
TAG="${1:?usage: deploy.sh <tag>}"
[[ "$TAG" =~ ^[0-9a-f]{7,40}$ ]] || { echo "bad tag: $TAG" >&2; exit 2; }
cd "$APP_DIR"

PREV=$(cat last-good-tag 2>/dev/null || true)
echo "IMAGE_TAG=$TAG" > .env
docker compose pull
docker compose up -d

healthy() {
  docker compose exec -T app node -e "fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
}

ok=0
for _ in $(seq 1 10); do
  if healthy >/dev/null 2>&1; then ok=1; break; fi
  sleep "${HEALTH_SLEEP:-3}"
done

if [ "$ok" != 1 ]; then
  echo "Health check failed for $TAG" >&2
  if [ -n "$PREV" ]; then
    echo "IMAGE_TAG=$PREV" > .env
    docker compose up -d
    echo "Rolled back to $PREV"
  fi
  exit 1
fi

echo "$TAG" > last-good-tag

rc=0
out=$(docker compose exec -T app node scripts/check-schema.js) || rc=$?
echo "$out"
if [ "$rc" = 3 ]; then
  if [[ "$out" == *geo=outdated* || "$out" == *geo=missing* ]]; then
    systemctl start --no-block ham-finder-setup.service
  else
    systemctl start --no-block ham-finder-weekly.service
  fi
fi

# Remove old images of this app, keeping the new and previous tag.
REPO=$(docker compose config --images | head -n1)
REPO=${REPO%:*}
docker image ls --format '{{.Repository}}:{{.Tag}}' \
  | grep -F "${REPO}:" \
  | grep -vxF -e "${REPO}:${TAG}" -e "${REPO}:${PREV:-none}" \
  | xargs -r docker image rm || true
docker image prune -f >/dev/null
echo "Deployed $TAG"
