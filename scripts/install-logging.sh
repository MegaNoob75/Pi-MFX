#!/usr/bin/env bash
# Can also be run alone on an existing Pi; no build or engine restart.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run with sudo" >&2; exit 1; }
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREFIX="${PREFIX:-/usr/local}"
# Sort after Raspberry Pi OS's 40-rpi-volatile-storage.conf.
install -Dm644 "$REPO_DIR/systemd/90-pimfx-persistent.conf" \
    /etc/systemd/journald.conf.d/90-pimfx-persistent.conf
install -Dm755 "$REPO_DIR/scripts/diagnostics.sh" "$PREFIX/bin/pimfx-diagnostics"
systemd-tmpfiles --create --prefix /var/log/journal
systemctl restart systemd-journald.service
journalctl --flush
echo "Persistent system logs enabled (64 MB target, up to 14 days)."
