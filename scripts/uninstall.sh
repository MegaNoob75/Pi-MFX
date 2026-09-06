#!/usr/bin/env bash
#
# Removes Pi-MFX and every system change install.sh made.
#
# User data is kept by default: banks, downloaded models, and impulse responses
# are the user's, not the installer's. Pass --purge to delete those too.

set -euo pipefail

PIMFX_USER="${PIMFX_USER:-pimfx}"
PREFIX="${PREFIX:-/usr/local}"
DATA_ROOT="${DATA_ROOT:-/var/lib/pimfx}"
PURGE="no"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn\033[0m %s\n' "$*"; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --purge) PURGE="yes"; shift ;;
        -h|--help)
            echo "Usage: sudo ./scripts/uninstall.sh [--purge]"
            echo "  --purge  also delete $DATA_ROOT (banks, models, IRs)"
            exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 1 ;;
    esac
done

[[ $EUID -eq 0 ]] || { echo "run this with sudo" >&2; exit 1; }

log "Stopping services"
systemctl disable --now pimfx.service          >/dev/null 2>&1 || true
systemctl disable --now pimfx-governor.service >/dev/null 2>&1 || true
systemctl disable --now pimfx-wifi-powersave.service >/dev/null 2>&1 || true

log "Removing files"
rm -f /etc/systemd/system/pimfx.service
rm -f /etc/systemd/system/pimfx-governor.service
rm -f /etc/systemd/system/pimfx-wifi-powersave.service
rm -f /etc/security/limits.d/95-pimfx-audio.conf
rm -f /etc/sysctl.d/95-pimfx-audio.conf
rm -f "$PREFIX/bin/pimfx"
rm -rf /usr/share/pimfx
systemctl daemon-reload

log "Restoring the sound servers"
for unit in pipewire.socket pipewire.service pipewire-pulse.socket \
            pipewire-pulse.service wireplumber.service \
            pulseaudio.socket pulseaudio.service; do
    systemctl --global unmask "$unit" >/dev/null 2>&1 || true
done

CMDLINE=/boot/firmware/cmdline.txt
[[ -f "$CMDLINE" ]] || CMDLINE=/boot/cmdline.txt
if [[ -f "$CMDLINE.pimfx-backup" ]]; then
    log "Restoring the kernel command line"
    mv "$CMDLINE.pimfx-backup" "$CMDLINE"
elif [[ -f "$CMDLINE" ]] && grep -q threadirqs "$CMDLINE"; then
    sed -i 's/ threadirqs//' "$CMDLINE"
fi

# Swap and the governor return to their defaults on the next boot now that the
# units and sysctl drop-ins are gone; nothing else to undo.

if [[ "$PURGE" == "yes" ]]; then
    warn "Deleting $DATA_ROOT and the $PIMFX_USER account"
    rm -rf "$DATA_ROOT"
    userdel "$PIMFX_USER" 2>/dev/null || true
else
    log "Keeping your data in $DATA_ROOT (use --purge to remove it)"
fi

echo
echo "Pi-MFX has been removed. Reboot to restore the default kernel options."
