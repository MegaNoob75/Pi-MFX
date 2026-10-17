#!/usr/bin/env bash
# Install recovery support without building or changing the saved rig.
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREFIX="${PREFIX:-/usr/local}"
DATA_ROOT="${DATA_ROOT:-/var/lib/pimfx}"
PIMFX_USER="${PIMFX_USER:-pimfx}"
missing=()
for package in python3-cryptography dpkg-repack binutils lilv-utils; do
    if ! dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
        missing+=("$package")
    fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
fi
install -Dm644 "$REPO_DIR/scripts/backup.py" "$PREFIX/libexec/pimfx/backup.py"
sed -e "s|@PREFIX@|$PREFIX|g" -e "s|@DATA_ROOT@|$DATA_ROOT|g" -e "s|@USER@|$PIMFX_USER|g" \
    "$REPO_DIR/systemd/pimfx-recovery-guard.service.in" > /etc/systemd/system/pimfx-recovery-guard.service
systemctl daemon-reload
