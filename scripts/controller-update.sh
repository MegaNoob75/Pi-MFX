#!/usr/bin/env bash
# Firmware-only entry point for the Windows menu. Never replaces the app checkout.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
DATA_ROOT="${DATA_ROOT:-/var/lib/pimfx}"
PIMFX_USER="${PIMFX_USER:-pimfx}"
PREFIX="${PREFIX:-/usr/local}"
RUNNER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mode="${1:-}"
source_arg="${2:-}"
[[ "$mode" == github || "$mode" == local ]] || { echo "Use github BRANCH or local SOURCE_FOLDER." >&2; exit 1; }
id "$PIMFX_USER" >/dev/null
install -d /run/pimfx "$DATA_ROOT"
exec 9>/run/pimfx/update-build.lock
flock -n -x 9 || { echo "Another Pi-MFX or controller update is running. Wait and retry." >&2; exit 1; }
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
if [[ "$mode" == github ]]; then
    case "$source_arg" in main|dev|workstation) ;; *) echo "Choose main, dev or workstation." >&2; exit 1;; esac
    echo "Downloading controller source from GitHub ($source_arg)..."
    git clone --depth 1 --single-branch --branch "$source_arg" --no-checkout \
        https://github.com/MegaNoob75/Pi-MFX.git "$stage/repo"
    git -C "$stage/repo" archive HEAD firmware | tar -x -C "$stage"
    mkdir -p "$stage/scripts"
    cp "$RUNNER_DIR/controller_firmware.py" "$stage/scripts/controller_firmware.py"
    source_arg="$stage"
fi
[[ -f "$source_arg/firmware/controller-build.json" && -f "$source_arg/scripts/controller_firmware.py" ]] || {
    echo "This source does not include the controller firmware updater." >&2; exit 1;
}
missing=()
for package in python3-mido python3-rtmidi python3-serial; do
    if ! dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
        missing+=("$package")
    fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
fi
# Retain the selected source so a disconnected controller can update later.
destination="$DATA_ROOT/controller-source"
install -d -m 755 "$destination/firmware" "$destination/scripts"
cp -a "$source_arg/firmware/." "$destination/firmware/"
install -m 644 "$source_arg/scripts/controller_firmware.py" "$destination/scripts/controller_firmware.py"
chmod -R a+rX "$destination"
# The helper must understand the retained source when retrying a pending job.
install -Dm644 "$destination/scripts/controller_firmware.py" "$PREFIX/libexec/pimfx/controller_firmware.py"
systemctl try-restart pimfx-plugin-helper.service
python3 "$destination/scripts/controller_firmware.py" --arm --repo "$destination" \
    --data "$DATA_ROOT" --user "$PIMFX_USER"
