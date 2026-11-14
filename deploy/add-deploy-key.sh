#!/usr/bin/env bash
# Give one app its own CI deploy key. Run as root (setup-server.sh installs this as
# /srv/apps/bin/add-deploy-key):
#   add-deploy-key <app> "<public-key>"
# The key can only run `deploy <app> <tag>`. Running it again for the same app
# replaces that app's key and leaves other apps' keys alone.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
APP="${1:?usage: add-deploy-key <app> <public-key>}"
PUBKEY="${2:?usage: add-deploy-key <app> <public-key>}"
[[ "$APP" =~ ^[a-z0-9-]+$ ]] || { echo "bad app name" >&2; exit 2; }
# One line only: a newline would let the argument add a second, unrestricted key.
case "$PUBKEY" in *$'\n'*|*$'\r'*) echo "public key must be a single line" >&2; exit 2 ;; esac
[[ "$PUBKEY" =~ ^ssh-[a-z0-9-]+\ [A-Za-z0-9+/=]+( .*)?$ ]] || { echo "not an SSH public key" >&2; exit 2; }

KEYS=/home/deploy/.ssh/authorized_keys
[ -f "$KEYS" ] || { echo "run setup-server.sh first" >&2; exit 1; }
LINE="restrict,command=\"/srv/apps/bin/deploy-dispatch $APP\" $PUBKEY"

TMP="$(mktemp)"
grep -vF "command=\"/srv/apps/bin/deploy-dispatch $APP\" " "$KEYS" > "$TMP" || true
printf '%s\n' "$LINE" >> "$TMP"
install -m 600 -o deploy -g deploy "$TMP" "$KEYS"
rm -f "$TMP"
echo "Deploy key set for $APP."
