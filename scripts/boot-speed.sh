#!/usr/bin/env bash
#
# Optional boot-time cuts. These do not change audio tuning. Bluetooth stays
# enabled because some MIDI controllers use it.
#
#   sudo bash ./scripts/boot-speed.sh skip-wait
#   sudo bash ./scripts/boot-speed.sh unused
#   sudo bash ./scripts/boot-speed.sh restore
#   sudo bash ./scripts/boot-speed.sh status

set -euo pipefail

STATE_DIR="/var/lib/pimfx-boot"
UNIT_STATE_DIR="$STATE_DIR/units"
ASSUME_YES=0
ACTION="status"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m error\033[0m %s\n' "$*" >&2; exit 1; }

confirm() {
    local prompt="$1" answer
    if [[ "$ASSUME_YES" -eq 1 ]]; then
        return 0
    fi
    [[ -t 0 ]] || die "a confirmation is required; rerun with --yes"
    read -r -p "$prompt [y/N] " answer
    case "$answer" in
        y|Y|yes|YES) return 0 ;;
        *) return 1 ;;
    esac
}

disable_unit_once() {
    local unit="$1"
    local state_file="$UNIT_STATE_DIR/${unit}.state"
    mkdir -p "$UNIT_STATE_DIR"
    if systemctl list-unit-files "$unit" >/dev/null 2>&1; then
        :
    else
        return 0
    fi
    if [[ ! -e "$state_file" ]]; then
        if systemctl is-enabled "$unit" >/dev/null 2>&1; then
            printf 'enabled\n' > "$state_file"
        elif systemctl is-enabled "$unit" 2>/dev/null | grep -q masked; then
            printf 'masked\n' > "$state_file"
        else
            printf 'disabled\n' > "$state_file"
        fi
    fi
    systemctl disable --now "$unit" >/dev/null 2>&1 || true
}

restore_unit() {
    local unit="$1"
    local state_file="$UNIT_STATE_DIR/${unit}.state"
    [[ -f "$state_file" ]] || return 0
    local previous
    previous="$(tr -d '\n' < "$state_file")"
    case "$previous" in
        enabled) systemctl enable "$unit" >/dev/null 2>&1 || true ;;
        masked) systemctl mask "$unit" >/dev/null 2>&1 || true ;;
        *) systemctl disable "$unit" >/dev/null 2>&1 || true ;;
    esac
    rm -f "$state_file"
}

do_skip_wait() {
    local dependency
    if grep -Eqs '^[[:space:]]*[^#].*[[:space:]](nfs|nfs4|cifs)[[:space:]]' /etc/fstab; then
        warn "a network filesystem is in /etc/fstab; leaving NetworkManager-wait-online enabled"
        return 0
    fi
    while read -r dependency _; do
        case "${dependency}" in
            ""|NetworkManager-wait-online.service|network-online.target|\
            cloud-init-local.service|cloud-init-main.service|\
            cloud-init-network.service|cloud-config.service|cloud-final.service|\
            pimfx.service|pimfx-plugin-helper.service|pimfx-hotspot.service)
                ;;
            *)
                warn "${dependency} wants network-online; leaving the wait service enabled"
                return 0
                ;;
        esac
    done < <(systemctl list-dependencies --reverse --plain --no-legend \
        NetworkManager-wait-online.service 2>/dev/null || true)

    confirm "Skip waiting for a network connection during boot?" || return 0
    mkdir -p "$STATE_DIR"
    disable_unit_once NetworkManager-wait-online.service
    touch "$STATE_DIR/skip-wait-applied"
    log "NetworkManager-wait-online is disabled. The Pi will no longer stall for DHCP before login."
}

do_unused() {
    local unit cloud_status=""
    local -a units=(
        cups.service cups.socket cups.path cups-browsed.service
        ModemManager.service
        packagekit.service packagekit-offline-update.service
        geoclue.service colord.service
        smbd.service nmbd.service winbind.service
        nfs-server.service rpcbind.service rpcbind.socket
        wayvnc.service vncserver-x11-serviced.service
    )
    confirm "Disable unused printer, modem, VNC and file-share services? Bluetooth is kept." || return 0
    mkdir -p "$STATE_DIR"

    if command -v cloud-init >/dev/null 2>&1; then
        cloud_status="$(cloud-init status 2>/dev/null || true)"
        if grep -Eq 'status:[[:space:]]*(done|disabled)' <<< "$cloud_status"; then
            mkdir -p /etc/cloud
            if [[ ! -e /etc/cloud/cloud-init.disabled ]]; then
                touch /etc/cloud/cloud-init.disabled
                touch "$STATE_DIR/cloud-init-disabled-by-pimfx"
            fi
            for unit in cloud-init-local.service cloud-init-main.service \
                        cloud-init-network.service cloud-config.service cloud-final.service; do
                disable_unit_once "$unit"
            done
        else
            warn "cloud-init has not finished; leaving it enabled"
        fi
    fi

    for unit in "${units[@]}"; do
        disable_unit_once "$unit"
    done
    touch "$STATE_DIR/unused-services-applied"
    log "Unused background services were disabled. Bluetooth was left alone."
}

do_restore() {
    local unit
    local -a units=(
        NetworkManager-wait-online.service
        cloud-init-local.service cloud-init-main.service
        cloud-init-network.service cloud-config.service cloud-final.service
        cups.service cups.socket cups.path cups-browsed.service
        ModemManager.service
        packagekit.service packagekit-offline-update.service
        geoclue.service colord.service
        smbd.service nmbd.service winbind.service
        nfs-server.service rpcbind.service rpcbind.socket
        wayvnc.service vncserver-x11-serviced.service
    )
    [[ -d "$STATE_DIR" ]] || {
        log "No boot-speed changes are recorded"
        return 0
    }
    confirm "Restore boot-speed service changes made by Pi-MFX?" || return 0
    for unit in "${units[@]}"; do
        restore_unit "$unit"
    done
    if [[ -f "$STATE_DIR/cloud-init-disabled-by-pimfx" ]]; then
        rm -f /etc/cloud/cloud-init.disabled "$STATE_DIR/cloud-init-disabled-by-pimfx"
    fi
    rm -f "$STATE_DIR/skip-wait-applied" "$STATE_DIR/unused-services-applied"
    rmdir "$UNIT_STATE_DIR" >/dev/null 2>&1 || true
    systemctl daemon-reload >/dev/null 2>&1 || true
    log "Boot-speed service changes were restored"
}

do_status() {
    if [[ -f "$STATE_DIR/skip-wait-applied" ]]; then
        echo "wait-online  disabled"
    else
        echo "wait-online  default"
    fi
    if [[ -f "$STATE_DIR/unused-services-applied" ]]; then
        echo "unused       disabled"
    else
        echo "unused       default"
    fi
}

usage() {
    cat <<'EOF'
Usage: sudo bash ./scripts/boot-speed.sh <skip-wait|unused|restore|status> [--yes]
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        skip-wait|unused|restore|status) ACTION="$1"; shift ;;
        -y|--yes) ASSUME_YES=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown option: $1" ;;
    esac
done

[[ $EUID -eq 0 ]] || die "run this with sudo"
case "$ACTION" in
    skip-wait) do_skip_wait ;;
    unused) do_unused ;;
    restore) do_restore ;;
    status) do_status ;;
esac
