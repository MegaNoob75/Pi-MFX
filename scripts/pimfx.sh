#!/usr/bin/env bash
#
# Pi-MFX setup menu. One entry point for install, update, touchscreen, boot
# logo, hotspot, status and remove. The older scripts (install.sh, update.sh,
# uninstall.sh, status.sh) still work; this file is what you run day to day.
#
#   sudo bash ./scripts/pimfx.sh
#   sudo bash ./scripts/pimfx.sh update
#   sudo bash ./scripts/pimfx.sh update --branch dev
#   sudo bash ./scripts/pimfx.sh update --branch main
#   sudo bash ./scripts/pimfx.sh update --branch workstation
#   sudo bash ./scripts/pimfx.sh display --display-user YOUR_LOGIN

# Print before touching the clone. If this never appears, the disk is wedged
# (leftover chown/git) and this script must not be started again until reboot.
printf 'Pi-MFX setup starting...\n' >&2

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DISPLAY_STATE_DIR="/var/lib/pimfx-touchscreen"
PIMFX_PORT="${PIMFX_PORT:-8080}"

ACTION="menu"
ASSUME_YES=0
PURGE="no"
UPDATE_BRANCH=""
DISPLAY_USER_OVERRIDE=""
REBOOT_NEEDED=0
REBOOT_REASON=""
INSTALL_ARGS=()

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m error\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
    cat <<'EOF'
Pi-MFX setup

Usage:
  sudo bash ./scripts/pimfx.sh [action] [options]

Actions:
  menu             Interactive menu (default)
  complete         Install plus touchscreen
  install          First-time setup: packages, engine, UI, service
  update           Pull, rebuild, restart
  rebuild          Rebuild from files already on the Pi (no git pull)
  firmware-update  Controller firmware from GitHub (--branch, default dev)
  firmware-local   Controller firmware from this Pi's source checkout
  display          Fullscreen touchscreen (Labwc + Chromium)
  display-refresh  Re-apply Chromium flags, hide the pointer, hide the system keyboard, hard-refresh
  kiosk-reload     Hard-refresh the attached Chromium kiosk (no Chromium restart)
  display-remove   Undo the touchscreen session
  splash           PI-MFX boot / shutdown logo, hide boot text
  splash-remove    Restore console boot messages
  boot-speed       Skip waiting for network at boot
  boot-speed-unused Disable unused printer/VNC/file-share services
  boot-speed-restore Undo boot-speed service changes
  hotspot          Install Wi-Fi hotspot support
  status           Branch, service, audio cards
  restore          Restore an exported Pi-MFX backup (interactive file selection)
  reboot           Reboot the Pi
  remove           Stop the service and undo OS changes

Options:
  --no-tuning            Install the service but leave the OS alone
  --branch main|dev|workstation
                         App or controller firmware source branch
  --port <n>             Web UI port (default 8080)
  --display-user USER    Account that auto-logs in on the screen
  --purge                Also delete /var/lib/pimfx (remove only)
  -y, --yes              Accept confirmation prompts
  -h, --help             This text

LV2 plugins are installed from Settings -> Plugins after the engine is running.
Banks and models in /var/lib/pimfx are left alone unless you pass --purge.
EOF
}

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

require_root() {
    [[ $EUID -eq 0 ]] || die "run this with sudo:  sudo bash ./scripts/pimfx.sh"
}

parse_args() {
    if [[ $# -gt 0 && "$1" != -* ]]; then
        ACTION="$1"
        shift
    fi
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --with-plugins|--no-plugins)
                warn "plugin packages are installed from Settings -> Plugins, not the installer"
                shift ;;
            --no-tuning)
                INSTALL_ARGS+=("$1"); shift ;;
            --port)
                [[ $# -ge 2 ]] || die "--port needs a number"
                PIMFX_PORT="$2"
                INSTALL_ARGS+=(--port "$2")
                shift 2 ;;
            --branch)
                [[ $# -ge 2 ]] || die "--branch needs main, dev or workstation"
                UPDATE_BRANCH="$2"
                case "$UPDATE_BRANCH" in
                    main|dev|workstation) ;;
                    *) die "--branch must be main, dev or workstation" ;;
                esac
                shift 2 ;;
            --display-user)
                [[ $# -ge 2 ]] || die "--display-user needs a username"
                DISPLAY_USER_OVERRIDE="$2"
                shift 2 ;;
            --purge) PURGE="yes"; shift ;;
            -y|--yes) ASSUME_YES=1; shift ;;
            -h|--help) usage; exit 0 ;;
            *) die "unknown option: $1" ;;
        esac
    done
    case "$ACTION" in
        menu|complete|install|update|rebuild|firmware-update|firmware-local|display|display-refresh|kiosk-reload|display-remove|splash|splash-remove|boot-speed|boot-speed-unused|boot-speed-restore|hotspot|status|restore|reboot|remove) ;;
        *) die "unknown action: $ACTION" ;;
    esac
}

draw_banner() {
    printf '\033[38;5;141m'
    cat <<'BANNER'
  +--------------------------------------------------+
  |  PI-MFX                                          |
  |  Raspberry Pi guitar multi-effects               |
  +--------------------------------------------------+
BANNER
    printf '\033[0m'
    echo
}

pause_for_menu() {
    [[ -t 0 ]] || return 0
    echo
    read -r -p "Press Enter to return to the menu..." _
}

mark_reboot() {
    REBOOT_NEEDED=1
    REBOOT_REASON="$1"
}

offer_reboot() {
    [[ "$REBOOT_NEEDED" -eq 1 ]] || return 0
    echo
    echo "A reboot is recommended: $REBOOT_REASON"
    if confirm "Reboot now?"; then
        systemctl reboot
    else
        echo "Reboot later with: sudo reboot"
    fi
    REBOOT_NEEDED=0
    REBOOT_REASON=""
}

run_script() {
    local script="$1"
    shift
    bash "$SCRIPT_DIR/$script" "$@"
}

ui_url() {
    local port="$PIMFX_PORT" found
    if [[ -f /etc/systemd/system/pimfx.service ]]; then
        found="$(sed -n 's/.*--port \([0-9][0-9]*\).*/\1/p' /etc/systemd/system/pimfx.service | head -1)"
        [[ -n "$found" ]] && port="$found"
    fi
    printf 'http://127.0.0.1:%s/?kiosk=1' "$port"
}

resolve_display_user() {
    local user="${DISPLAY_USER_OVERRIDE:-}"
    if [[ -z "$user" && -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
        user="$SUDO_USER"
    fi
    if [[ -z "$user" ]]; then
        user="$(awk -F: '$3 >= 1000 && $3 < 65534 { print $1; exit }' /etc/passwd)"
    fi
    [[ -n "$user" ]] || die "no normal login user found; pass --display-user NAME"
    id "$user" >/dev/null 2>&1 || die "no such user: $user"
    DISPLAY_USER="$user"
    DISPLAY_HOME="$(getent passwd "$user" | cut -d: -f6)"
    DISPLAY_GROUP="$(id -gn "$user")"
    [[ -d "$DISPLAY_HOME" ]] || die "home directory missing for $user"
}

backup_display_file() {
    local source="$1" name="$2"
    mkdir -p "$DISPLAY_STATE_DIR"
    if [[ -e "$DISPLAY_STATE_DIR/${name}.was-present" || -e "$DISPLAY_STATE_DIR/${name}.was-absent" ]]; then
        return 0
    fi
    if [[ -e "$source" ]]; then
        cp -a "$source" "$DISPLAY_STATE_DIR/${name}.backup"
        touch "$DISPLAY_STATE_DIR/${name}.was-present"
    else
        touch "$DISPLAY_STATE_DIR/${name}.was-absent"
    fi
}

restore_display_file() {
    local target="$1" name="$2"
    rm -f "$target"
    if [[ -f "$DISPLAY_STATE_DIR/${name}.was-present" && -e "$DISPLAY_STATE_DIR/${name}.backup" ]]; then
        cp -a "$DISPLAY_STATE_DIR/${name}.backup" "$target"
    fi
}

write_labwc_rc() {
    mkdir -p /etc/xdg/labwc
    cat > /etc/xdg/labwc/rc.xml <<'RCXML'
<?xml version="1.0"?>
<labwc_config>
  <keyboard>
    <keybind key="A-W-h">
      <action name="HideCursor"/>
      <action name="WarpCursor" x="-1" y="-1"/>
    </keybind>
  </keyboard>
  <windowRules>
    <windowRule identifier="*">
      <serverDecoration>no</serverDecoration>
    </windowRule>
  </windowRules>
</labwc_config>
RCXML
}

write_chromium_autostart() {
    local url
    url="$(ui_url)"
    mkdir -p /etc/xdg/labwc
    cat > /etc/xdg/labwc/autostart <<AUTOSTART
#!/bin/bash
# Labwc draws a pointer until the first touch. Hide it before Chromium paints,
# then once more after the window maps.
(
    wtype -M alt -M logo -k h -m logo -m alt >/dev/null 2>&1 || true
    sleep 1
    wtype -M alt -M logo -k h -m logo -m alt >/dev/null 2>&1 || true
) &
squeekboard >/dev/null 2>&1 &
AUTOSTART
    cat >> /etc/xdg/labwc/autostart <<'HOSTNAME_RECOVERY'
# Chromium's profile lock contains the hostname. After a Pi rename, discard
# the old host's singleton links only when this user's browser is not running.
profile="${XDG_CONFIG_HOME:-$HOME/.config}/chromium"
lock="$(readlink "$profile/SingletonLock" 2>/dev/null || true)"
lock_host="${lock%-*}"
lock_pid="${lock##*-}"
if [[ -n "$lock" && "$lock_host" != "$(hostname)" && "$lock_pid" =~ ^[0-9]+$ ]] \
    && ! pgrep -u "$(id -u)" -x chromium >/dev/null 2>&1 \
    && ! pgrep -u "$(id -u)" -x chromium-browser >/dev/null 2>&1; then
    for name in SingletonLock SingletonSocket SingletonCookie; do
        [[ ! -L "$profile/$name" ]] || rm -f -- "$profile/$name"
    done
fi
HOSTNAME_RECOVERY
    cat >> /etc/xdg/labwc/autostart <<AUTOSTART
exec /usr/bin/chromium \\
    --ozone-platform=wayland \\
    --start-maximized \\
    --overscroll-history-navigation=0 \\
    --disable-features=WaylandWindowDecorations,TouchDragAndContextMenu \\
    --app='${url}' \\
    --password-store=basic
AUTOSTART
    chmod 0755 /etc/xdg/labwc/autostart
}

restart_touchscreen_browser() {
    # Do not pkill Chromium here. On a live Labwc kiosk that races the GPU
    # and freezes the whole Pi (SSH, audio, and the attached screen).
    # shellcheck source=kiosk-reload.inc.sh
    . "$SCRIPT_DIR/kiosk-reload.inc.sh"
    reload_kiosk_browser
}

refresh_touchscreen_session() {
    [[ -f "$DISPLAY_STATE_DIR/configured-user" ]] || return 0
    log "Keeping the touchscreen keyboard available for hosted browser flows"
    if ! dpkg-query -W -f='${Status}' squeekboard 2>/dev/null | grep -q 'install ok installed'; then
        DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a NEEDRESTART_SUSPEND=1 \
            apt-get install -y --no-install-recommends squeekboard
    fi
    write_labwc_rc
    write_chromium_autostart
    pkill -HUP -x labwc >/dev/null 2>&1 || true
    sleep 0.4
    restart_touchscreen_browser
}

configure_touchscreen() {
    local profile
    resolve_display_user
    command -v raspi-config >/dev/null 2>&1 || \
        die "touchscreen setup needs Raspberry Pi OS and raspi-config"

    log "Setting up a fullscreen Pi-MFX session for $DISPLAY_USER"
    if [[ "${PIMFX_RECOVERY_OFFLINE:-0}" == "1" ]]; then
        for package in labwc chromium wtype squeekboard; do
            dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed' \
                || die "recovery needs the archived $package package; include Plugins and dependencies"
        done
    else
        apt-get update
        apt-get install -y --no-install-recommends labwc chromium wtype squeekboard
    fi
    [[ -x /usr/bin/chromium ]] || die "chromium did not install at /usr/bin/chromium"

    mkdir -p "$DISPLAY_STATE_DIR" /etc/xdg/labwc
    profile="$DISPLAY_HOME/.bash_profile"
    backup_display_file /etc/xdg/labwc/rc.xml labwc-rc.xml
    backup_display_file /etc/xdg/labwc/autostart labwc-autostart
    backup_display_file "$profile" bash-profile

    raspi-config nonint do_boot_behaviour B2

    write_labwc_rc
    write_chromium_autostart
    printf '%s\n' "$DISPLAY_USER" > "$DISPLAY_STATE_DIR/configured-user"

    cat > "$profile" <<'PROFILE'
# Pi-MFX fullscreen session on the attached screen.
if [ -f ~/.bashrc ]; then
    . ~/.bashrc
fi
if [ -z "${DISPLAY:-}" ] && [ "$(tty)" = "/dev/tty1" ]; then
    exec labwc
fi
PROFILE
    chown "$DISPLAY_USER:$DISPLAY_GROUP" "$profile"

    log "Touchscreen will open $(ui_url) after reboot (console auto-login as $DISPLAY_USER)"
    mark_reboot "console auto-login and the Labwc session were configured"
}

remove_touchscreen() {
    local configured_user home group profile
    [[ -d "$DISPLAY_STATE_DIR" ]] || {
        log "No touchscreen configuration is installed"
        return 0
    }

    configured_user="$(cat "$DISPLAY_STATE_DIR/configured-user" 2>/dev/null || true)"
    restore_display_file /etc/xdg/labwc/rc.xml labwc-rc.xml
    restore_display_file /etc/xdg/labwc/autostart labwc-autostart
    if [[ -n "$configured_user" ]] && id "$configured_user" >/dev/null 2>&1; then
        home="$(getent passwd "$configured_user" | cut -d: -f6)"
        group="$(id -gn "$configured_user")"
        profile="$home/.bash_profile"
        restore_display_file "$profile" bash-profile
        [[ ! -e "$profile" ]] || chown "$configured_user:$group" "$profile"
    fi
    if command -v raspi-config >/dev/null 2>&1; then
        raspi-config nonint do_boot_behaviour B1 || true
    fi
    rm -rf "$DISPLAY_STATE_DIR"
    log "Touchscreen auto-start was removed"
    mark_reboot "the console login screen was restored"
}

do_install() {
    local extra=("$@")
    if [[ ${#INSTALL_ARGS[@]} -gt 0 ]]; then
        extra+=("${INSTALL_ARGS[@]}")
    fi
    run_script install.sh "${extra[@]}"
}

do_update() {
    local branch="${UPDATE_BRANCH:-dev}"
    case "$branch" in
        main|dev|workstation) ;;
        *) branch="dev" ;;
    esac
    PIMFX_BRANCH="$branch" run_script update.sh
}

do_rebuild() {
    SKIP_PULL=1 run_script update.sh
}

do_status() {
    run_script status.sh
}

do_restore_backup() {
    local archive
    [[ -t 0 ]] || die "restore needs an interactive terminal for the backup password"
    read -r -p "Exported backup file (full path, without quotes): " archive
    [[ -f "$archive" ]] || die "backup file not found"
    [[ -f /etc/systemd/system/pimfx.service ]] || die "install Pi-MFX first, then restore your backup"
    PIMFX_USER="$(awk -F= '/^User=/{print $2; exit}' /etc/systemd/system/pimfx.service)" \
        PIMFX_DATA_ROOT="${DATA_ROOT:-/var/lib/pimfx}" PIMFX_PREFIX="${PREFIX:-/usr/local}" \
        python3 "${PREFIX:-/usr/local}/libexec/pimfx/backup.py" restore "$archive"
}

do_remove() {
    local already_confirmed="${1:-}"
    local args=()
    if [[ "$already_confirmed" != "confirmed" ]]; then
        if [[ "$PURGE" == "yes" ]]; then
            confirm "Delete banks, models and IRs in /var/lib/pimfx as well?" || return 0
        else
            confirm "Remove Pi-MFX? Banks and models in /var/lib/pimfx will be kept." || return 0
        fi
    fi
    [[ "$PURGE" == "yes" ]] && args+=(--purge)
    remove_touchscreen
    run_script uninstall.sh "${args[@]}"
}

do_complete() {
    do_install
    configure_touchscreen
}

do_splash() {
    run_script boot-splash.sh install "$@"
    if [[ -f /var/lib/pimfx-boot/quiet-splash-applied ]]; then
        mark_reboot "the PI-MFX boot logo was installed"
    fi
}

do_splash_remove() {
    local was=0
    [[ -f /var/lib/pimfx-boot/quiet-splash-applied ]] && was=1
    run_script boot-splash.sh remove "$@"
    [[ "$was" -eq 1 ]] && mark_reboot "the PI-MFX boot logo was removed"
}

do_boot_speed() {
    run_script boot-speed.sh skip-wait "$@"
}

do_boot_speed_unused() {
    run_script boot-speed.sh unused "$@"
}

do_boot_speed_restore() {
    run_script boot-speed.sh restore "$@"
}

do_hotspot() {
    run_script install-hotspot.sh
}

boot_screen_menu() {
    local choice
    draw_banner
    cat <<'MENU'
  Boot screen

  1) Install PI-MFX logo and hide boot / shutdown text
  2) Remove logo and restore console messages
  3) Back
MENU
    echo
    read -r -p "Choose [1-3]: " choice
    case "$choice" in
        1) do_splash ;;
        2) do_splash_remove ;;
        3) return 0 ;;
        *) warn "pick 1, 2 or 3" ;;
    esac
}

faster_boot_menu() {
    local choice
    draw_banner
    cat <<'MENU'
  Faster boot

  These options hide work the Pi does not need as a pedalboard. Bluetooth
  is left enabled. Audio tuning is not changed.

  1) Skip waiting for a network connection at boot
  2) Disable unused printer, modem, VNC and file-share services
  3) Restore those boot-speed changes
  4) Back
MENU
    echo
    read -r -p "Choose [1-4]: " choice
    case "$choice" in
        1) do_boot_speed ;;
        2) do_boot_speed_unused ;;
        3) do_boot_speed_restore ;;
        4) return 0 ;;
        *) warn "pick a number from 1 to 4" ;;
    esac
}

update_branch_menu() {
    local choice branch mode="${1:-app}"
    draw_banner
    cat <<'MENU'
  Update from GitHub

  1) Main         (stable release)
  2) Dev          (development)
  3) Workstation  (workstation features)
  4) Back
MENU
    echo
    read -r -p "Choose [1-4]: " choice
    case "$choice" in
        1) branch="main" ;;
        2) branch="dev" ;;
        3) branch="workstation" ;;
        4) return 0 ;;
        *) warn "pick a number from 1 to 4"; return 0 ;;
    esac
    if [[ "$mode" == controller ]]; then
        run_script controller-update.sh github "$branch"
    else
        UPDATE_BRANCH="$branch" do_update
    fi
}

do_reboot() {
    if confirm "Reboot this Pi now?"; then
        log "Rebooting"
        systemctl reboot
    fi
}

show_menu() {
    local choice
    while true; do
        draw_banner
        cat <<'MENU'
  Install and update Pi-MFX
  1) Complete setup  (install + touchscreen)
  2) Install / first-time setup
  3) Update from GitHub  (choose main, dev or workstation)
  4) Rebuild local files  (no git pull)

  Controller firmware only
  5) Update firmware from GitHub  (choose branch)
  6) Update firmware from this Pi's source checkout

  Display and system setup
  7) Set up touchscreen display
  8) Refresh touchscreen display
  9) Remove touchscreen display
  10) Boot screen  (PI-MFX logo, hide boot text)
  11) Faster boot  (network wait, unused services)
  12) Wi-Fi hotspot support

  Maintenance and recovery
  13) Status
  14) Reboot now
  15) Restore an exported backup
  16) Remove Pi-MFX

  0) Exit
MENU
        echo
        read -r -p "Choose [0-16]: " choice
        case "$choice" in
            1) do_complete || warn "complete setup did not finish" ;;
            2) do_install || warn "install did not finish" ;;
            3) update_branch_menu || warn "update did not finish" ;;
            4) do_rebuild || warn "rebuild did not finish" ;;
            5) update_branch_menu controller || warn "controller update did not finish" ;;
            6) run_script controller-update.sh local "$REPO_DIR" || warn "controller update did not finish" ;;
            7) configure_touchscreen || warn "touchscreen setup did not finish" ;;
            8) refresh_touchscreen_session || warn "touchscreen refresh did not finish" ;;
            9) remove_touchscreen || warn "touchscreen remove did not finish" ;;
            10) boot_screen_menu || warn "boot screen change did not finish" ;;
            11) faster_boot_menu || warn "boot-speed change did not finish" ;;
            12) do_hotspot || warn "hotspot install did not finish" ;;
            13) do_status || warn "status failed" ;;
            16)
                PURGE="no"
                if confirm "Also delete /var/lib/pimfx (banks, models, IRs)?"; then
                    PURGE="yes"
                fi
                do_remove confirmed || warn "remove did not finish"
                ;;
            14) do_reboot ;;
            0|q|Q) return 0 ;;
            15) do_restore_backup || warn "restore did not finish" ;;
            *) warn "pick a number from 0 to 16"; pause_for_menu; continue ;;
        esac
        offer_reboot
        pause_for_menu
    done
}

main() {
    parse_args "$@"
    if [[ "$ACTION" == "status" ]]; then
        do_status
        return 0
    fi
    require_root
    cd "$REPO_DIR"
    case "$ACTION" in
        menu) show_menu ;;
        complete) do_complete ;;
        install) do_install ;;
        update) do_update ;;
        rebuild) do_rebuild ;;
        firmware-update) run_script controller-update.sh github "${UPDATE_BRANCH:-dev}" ;;
        firmware-local) run_script controller-update.sh local "$REPO_DIR" ;;
        display) configure_touchscreen ;;
        display-refresh) refresh_touchscreen_session ;;
        kiosk-reload)
            # shellcheck source=kiosk-reload.inc.sh
            . "$SCRIPT_DIR/kiosk-reload.inc.sh"
            reload_kiosk_browser
            ;;
        display-remove) remove_touchscreen ;;
        splash) do_splash ${ASSUME_YES:+--yes} ;;
        splash-remove) do_splash_remove ${ASSUME_YES:+--yes} ;;
        boot-speed) do_boot_speed ${ASSUME_YES:+--yes} ;;
        boot-speed-unused) do_boot_speed_unused ${ASSUME_YES:+--yes} ;;
        boot-speed-restore) do_boot_speed_restore ${ASSUME_YES:+--yes} ;;
        hotspot) do_hotspot ;;
        restore) do_restore_backup ;;
        remove) do_remove ;;
        reboot) do_reboot ;;
    esac
    [[ "$ACTION" == "menu" ]] || offer_reboot
}

main "$@"
