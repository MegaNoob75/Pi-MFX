#!/usr/bin/env bash
#
# Pi-MFX setup menu. One entry point for install, update, touchscreen, status
# and remove. The older scripts (install.sh, update.sh, uninstall.sh, status.sh)
# still work; this file is what you run day to day.
#
#   sudo bash ./scripts/pimfx.sh
#   sudo bash ./scripts/pimfx.sh update
#   sudo bash ./scripts/pimfx.sh display --display-user YOUR_LOGIN

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DISPLAY_STATE_DIR="/var/lib/pimfx-touchscreen"
PIMFX_PORT="${PIMFX_PORT:-8080}"

ACTION="menu"
ASSUME_YES=0
PURGE="no"
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
  install          First-time setup: packages, engine, UI, service
  update           Pull, rebuild, restart
  rebuild          Rebuild from files already on the Pi (no git pull)
  display          Fullscreen touchscreen (Labwc + Chromium)
  display-refresh  Re-apply Chromium flags and hide the system keyboard
  display-remove   Undo the touchscreen session
  status           Branch, service, audio cards
  remove           Stop the service and undo OS changes

Options:
  --with-plugins         Install the starter LV2 set (install only)
  --no-plugins           Skip those packages
  --no-tuning            Install the service but leave the OS alone
  --port <n>             Web UI port (default 8080)
  --display-user USER    Account that auto-logs in on the screen
  --purge                Also delete /var/lib/pimfx (remove only)
  -y, --yes              Accept confirmation prompts
  -h, --help             This text

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
            --with-plugins|--no-plugins|--no-tuning)
                INSTALL_ARGS+=("$1"); shift ;;
            --port)
                [[ $# -ge 2 ]] || die "--port needs a number"
                PIMFX_PORT="$2"
                INSTALL_ARGS+=(--port "$2")
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
        menu|install|update|rebuild|display|display-refresh|display-remove|status|remove) ;;
        *) die "unknown action: $ACTION" ;;
    esac
}

draw_banner() {
    printf '\033[2J\033[H'
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

disable_system_keyboard() {
    local user home file
    pkill -x squeekboard >/dev/null 2>&1 || true
    pkill -x onboard >/dev/null 2>&1 || true
    user="$(cat "$DISPLAY_STATE_DIR/configured-user" 2>/dev/null || true)"
    home=""
    if [[ -n "$user" ]]; then
        home="$(getent passwd "$user" | cut -d: -f6 || true)"
    fi
    for file in /etc/xdg/labwc/autostart ${home:+$home/.config/labwc/autostart}; do
        [[ -f "$file" ]] || continue
        sed -i -E '/squeekboard|onboard/d' "$file" || true
    done
}

write_chromium_autostart() {
    local url
    url="$(ui_url)"
    mkdir -p /etc/xdg/labwc
    cat > /etc/xdg/labwc/autostart <<AUTOSTART
#!/bin/bash
exec /usr/bin/chromium \\
    --ozone-platform=wayland \\
    --start-maximized \\
    --disable-features=WaylandWindowDecorations,VirtualKeyboard \\
    --app=${url} \\
    --password-store=basic
AUTOSTART
    chmod 0755 /etc/xdg/labwc/autostart
}

refresh_touchscreen_session() {
    [[ -f "$DISPLAY_STATE_DIR/configured-user" ]] || return 0
    log "Keeping the system keyboard off the touchscreen"
    disable_system_keyboard
    write_chromium_autostart
    if dpkg-query -W -f='${Status}' squeekboard 2>/dev/null | grep -q 'install ok installed'; then
        log "Removing the system on-screen keyboard so Pi-MFX can use its own"
        DEBIAN_FRONTEND=noninteractive apt-get purge -y squeekboard || true
    fi
}

configure_touchscreen() {
    local profile
    resolve_display_user
    command -v raspi-config >/dev/null 2>&1 || \
        die "touchscreen setup needs Raspberry Pi OS and raspi-config"

    log "Setting up a fullscreen Pi-MFX session for $DISPLAY_USER"
    apt-get update
    apt-get install -y --no-install-recommends labwc chromium
    [[ -x /usr/bin/chromium ]] || die "chromium did not install at /usr/bin/chromium"

    mkdir -p "$DISPLAY_STATE_DIR" /etc/xdg/labwc
    profile="$DISPLAY_HOME/.bash_profile"
    backup_display_file /etc/xdg/labwc/rc.xml labwc-rc.xml
    backup_display_file /etc/xdg/labwc/autostart labwc-autostart
    backup_display_file "$profile" bash-profile

    raspi-config nonint do_boot_behaviour B2

    cat > /etc/xdg/labwc/rc.xml <<'RCXML'
<?xml version="1.0"?>
<labwc_config>
  <windowRules>
    <windowRule identifier="*">
      <serverDecoration>no</serverDecoration>
    </windowRule>
  </windowRules>
</labwc_config>
RCXML

    write_chromium_autostart
    printf '%s\n' "$DISPLAY_USER" > "$DISPLAY_STATE_DIR/configured-user"
    disable_system_keyboard
    if dpkg-query -W -f='${Status}' squeekboard 2>/dev/null | grep -q 'install ok installed'; then
        log "Removing the system on-screen keyboard so Pi-MFX can use its own"
        DEBIAN_FRONTEND=noninteractive apt-get purge -y squeekboard || true
    fi

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
    run_script update.sh
}

do_rebuild() {
    SKIP_PULL=1 run_script update.sh
}

do_status() {
    run_script status.sh
    if [[ -f "$DISPLAY_STATE_DIR/configured-user" ]]; then
        echo
        echo "touchscreen  configured for $(cat "$DISPLAY_STATE_DIR/configured-user")"
    else
        echo
        echo "touchscreen  not configured"
    fi
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
    do_install --with-plugins
    configure_touchscreen
}

show_menu() {
    local choice
    while true; do
        draw_banner
        cat <<'MENU'
  1) Complete setup  (install + plugins + touchscreen)
  2) Install / first-time setup
  3) Update  (pull, rebuild, restart)
  4) Rebuild local files  (after MobaXterm copy, no git pull)
  5) Set up touchscreen display
  6) Remove touchscreen display
  7) Status
  8) Remove Pi-MFX
  9) Exit
MENU
        echo
        read -r -p "Choose [1-9]: " choice
        case "$choice" in
            1) do_complete || warn "complete setup did not finish" ;;
            2) do_install || warn "install did not finish" ;;
            3) do_update || warn "update did not finish" ;;
            4) do_rebuild || warn "rebuild did not finish" ;;
            5) configure_touchscreen || warn "touchscreen setup did not finish" ;;
            6) remove_touchscreen || warn "touchscreen remove did not finish" ;;
            7) do_status || warn "status failed" ;;
            8)
                PURGE="no"
                if confirm "Also delete /var/lib/pimfx (banks, models, IRs)?"; then
                    PURGE="yes"
                fi
                do_remove confirmed || warn "remove did not finish"
                ;;
            9|q|Q) return 0 ;;
            *) warn "pick a number from 1 to 9"; pause_for_menu; continue ;;
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
        install) do_install ;;
        update) do_update ;;
        rebuild) do_rebuild ;;
        display) configure_touchscreen ;;
        display-refresh) refresh_touchscreen_session ;;
        display-remove) remove_touchscreen ;;
        remove) do_remove ;;
    esac
    [[ "$ACTION" == "menu" ]] || offer_reboot
}

main "$@"
