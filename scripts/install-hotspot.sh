#!/usr/bin/env bash
#
# Installs the Pi-MFX hotspot helper, systemd unit, and NetworkManager hook.
# Safe to run on every install or update. Does not start an access point until
# Settings -> System -> Hotspot is enabled.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PREFIX="${PREFIX:-/usr/local}"
DATA_ROOT="${DATA_ROOT:-/var/lib/pimfx}"
PIMFX_USER="${PIMFX_USER:-pimfx}"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m error\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run this with sudo"

if [[ -f /etc/systemd/system/pimfx.service ]]; then
    found="$(awk -F= '/^User=/{print $2; exit}' /etc/systemd/system/pimfx.service)"
    [[ -n "${found:-}" ]] && PIMFX_USER="$found"
fi

log "Installing Wi-Fi hotspot support"
export DEBIAN_FRONTEND=noninteractive
apt-get install -y --no-install-recommends network-manager dnsmasq-base iw python3

install -d "$PREFIX/libexec/pimfx"
install -Dm644 "$REPO_DIR/scripts/hotspot.py" "$PREFIX/libexec/pimfx/hotspot.py"

sed -e "s|@USER@|$PIMFX_USER|g" \
    -e "s|@PREFIX@|$PREFIX|g" \
    -e "s|@DATA_ROOT@|$DATA_ROOT|g" \
    "$REPO_DIR/systemd/pimfx-hotspot.service.in" > /etc/systemd/system/pimfx-hotspot.service

if [[ -d /etc/NetworkManager/dispatcher.d || -d /etc/NetworkManager ]]; then
    mkdir -p /etc/NetworkManager/dispatcher.d
    sed -e "s|@PREFIX@|$PREFIX|g" \
        "$REPO_DIR/systemd/90-pimfx-hotspot.in" > /etc/NetworkManager/dispatcher.d/90-pimfx-hotspot
    chown root:root /etc/NetworkManager/dispatcher.d/90-pimfx-hotspot
    chmod 0755 /etc/NetworkManager/dispatcher.d/90-pimfx-hotspot
else
    warn "NetworkManager is not installed; the hotspot dispatcher was skipped"
fi

systemctl daemon-reload
systemctl enable pimfx-hotspot.service >/dev/null
log "Hotspot helper is installed. Configure it in Settings -> System -> Hotspot."
