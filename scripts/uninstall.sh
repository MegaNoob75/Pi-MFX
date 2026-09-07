#!/usr/bin/env bash
#
# Removes Pi-MFX and every system change install.sh made.
#
# User data is kept by default: banks, downloaded models, and impulse responses
# are the user's, not the installer's. Pass --purge to delete those too.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
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

DISPLAY_STATE_DIR="/var/lib/pimfx-touchscreen"

restore_display_file() {
    local target="$1" name="$2"
    rm -f "$target"
    if [[ -f "$DISPLAY_STATE_DIR/${name}.was-present" && -e "$DISPLAY_STATE_DIR/${name}.backup" ]]; then
        cp -a "$DISPLAY_STATE_DIR/${name}.backup" "$target"
    fi
}

if [[ -d "$DISPLAY_STATE_DIR" ]]; then
    log "Restoring the console login (undoing the touchscreen session)"
    configured_user="$(cat "$DISPLAY_STATE_DIR/configured-user" 2>/dev/null || true)"
    restore_display_file /etc/xdg/labwc/rc.xml labwc-rc.xml
    restore_display_file /etc/xdg/labwc/autostart labwc-autostart
    if [[ -n "${configured_user:-}" ]] && id "$configured_user" >/dev/null 2>&1; then
        display_home="$(getent passwd "$configured_user" | cut -d: -f6)"
        display_group="$(id -gn "$configured_user")"
        restore_display_file "$display_home/.bash_profile" bash-profile
        [[ ! -e "$display_home/.bash_profile" ]] || chown "$configured_user:$display_group" "$display_home/.bash_profile"
    fi
    if command -v raspi-config >/dev/null 2>&1; then
        raspi-config nonint do_boot_behaviour B1 || true
    fi
    rm -rf "$DISPLAY_STATE_DIR"
fi

log "Stopping services"
systemctl disable --now pimfx.service          >/dev/null 2>&1 || true
systemctl disable --now pimfx-plugin-helper.service >/dev/null 2>&1 || true
systemctl disable --now pimfx-hotspot.service  >/dev/null 2>&1 || true
systemctl disable --now pimfx-governor.service >/dev/null 2>&1 || true
systemctl disable --now pimfx-wifi-powersave.service >/dev/null 2>&1 || true

if [[ -f "$PREFIX/libexec/pimfx/hotspot.py" ]]; then
    log "Removing the Wi-Fi hotspot connection"
    /usr/bin/python3 "$PREFIX/libexec/pimfx/hotspot.py" uninstall >/dev/null 2>&1 || true
elif [[ -f "$REPO_DIR/scripts/hotspot.py" ]]; then
    /usr/bin/python3 "$REPO_DIR/scripts/hotspot.py" uninstall >/dev/null 2>&1 || true
fi

if [[ -f "$REPO_DIR/scripts/boot-splash.sh" ]]; then
    log "Removing the PI-MFX boot logo"
    bash "$REPO_DIR/scripts/boot-splash.sh" remove --yes >/dev/null 2>&1 || true
fi
if [[ -f "$REPO_DIR/scripts/boot-speed.sh" ]]; then
    log "Restoring boot-speed service changes"
    bash "$REPO_DIR/scripts/boot-speed.sh" restore --yes >/dev/null 2>&1 || true
fi

log "Removing files"
rm -f /etc/systemd/system/pimfx.service
rm -f /etc/systemd/system/pimfx-plugin-helper.service
rm -f /etc/systemd/system/pimfx-hotspot.service
rm -f /etc/systemd/system/pimfx-governor.service
rm -f /etc/systemd/system/pimfx-wifi-powersave.service
rm -f /etc/NetworkManager/dispatcher.d/90-pimfx-hotspot
rm -f /etc/security/limits.d/95-pimfx-audio.conf
rm -f /etc/udev/rules.d/95-pimfx-audio.rules
rm -f /etc/sysctl.d/95-pimfx-audio.conf
rm -f /etc/modprobe.d/95-pimfx-audio.conf
rm -f "$PREFIX/bin/pimfx"
rm -f "$PREFIX/libexec/pimfx/plugin-helper.py"
rm -f "$PREFIX/libexec/pimfx/hotspot.py"
rmdir "$PREFIX/libexec/pimfx" >/dev/null 2>&1 || true
rm -rf /usr/share/pimfx
rm -rf /var/lib/pimfx-boot
rm -f /etc/apt/sources.list.d/pimfx-*.list /etc/apt/sources.list.d/pimfx-*.sources
rm -f /usr/share/keyrings/pimfx-*.gpg
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
elif [[ -f "$CMDLINE" ]]; then
    grep -q threadirqs "$CMDLINE" && sed -i 's/ threadirqs//' "$CMDLINE"
    grep -q 'usbcore.autosuspend' "$CMDLINE" && sed -i -E 's/ usbcore.autosuspend[=-][^ ]*//' "$CMDLINE"
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
