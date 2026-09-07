#!/usr/bin/env bash
#
# PI-MFX boot and shutdown logo. Hides kernel and systemd text so the attached
# screen only shows the PI-MFX mark. Original artwork; there is no PiPedal logo.
#
#   sudo bash ./scripts/boot-splash.sh install
#   sudo bash ./scripts/boot-splash.sh remove
#   sudo bash ./scripts/boot-splash.sh status

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STATE_DIR="/var/lib/pimfx-boot"
THEME_NAME="pimfx"
THEME_DIR="/usr/share/plymouth/themes/${THEME_NAME}"
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

boot_config() {
    if [[ -f /boot/firmware/config.txt ]]; then
        printf '%s\n' /boot/firmware/config.txt
    elif [[ -f /boot/config.txt ]]; then
        printf '%s\n' /boot/config.txt
    else
        die "Raspberry Pi boot configuration was not found"
    fi
}

boot_cmdline() {
    if [[ -f /boot/firmware/cmdline.txt ]]; then
        printf '%s\n' /boot/firmware/cmdline.txt
    elif [[ -f /boot/cmdline.txt ]]; then
        printf '%s\n' /boot/cmdline.txt
    else
        die "Raspberry Pi kernel command line was not found"
    fi
}

package_installed() {
    dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'
}

set_config_value() {
    local file="$1" key="$2" value="$3"
    if grep -qE "^${key}=" "$file"; then
        sed -i -E "s|^${key}=.*|${key}=${value}|" "$file"
    else
        printf '\n%s=%s\n' "$key" "$value" >> "$file"
    fi
}

save_config_before() {
    local file="$1" key="$2" dest="$3"
    if [[ -e "$dest" ]]; then
        return 0
    fi
    local existing
    existing="$(sed -n -E "s|^${key}=(.*)|\1|p" "$file" | tail -1 || true)"
    if [[ -n "$existing" ]]; then
        printf '%s\n' "$existing" > "$dest"
    else
        printf '\n' > "$dest"
        printf 'absent\n' > "${dest}.absent"
    fi
}

restore_config_value() {
    local file="$1" key="$2" dest="$3"
    [[ -e "$dest" ]] || return 0
    if [[ -f "${dest}.absent" ]]; then
        sed -i -E "/^${key}=/d" "$file"
        return 0
    fi
    local value
    value="$(tr -d '\n' < "$dest")"
    [[ -n "$value" ]] || return 0
    set_config_value "$file" "$key" "$value"
}

cmdline_add() {
    local file="$1"
    shift
    python3 - "$file" "$@" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
added = sys.argv[2:]
text = path.read_text(encoding="utf-8") if path.exists() else ""
parts = text.splitlines()[0].split() if text.strip() else []
by_key = {}
order = []
for token in parts:
    key = token.split("=", 1)[0]
    if key not in by_key:
        order.append(key)
    by_key[key] = token
for token in added:
    key = token.split("=", 1)[0]
    if key not in by_key:
        order.append(key)
    by_key[key] = token
path.write_text(" ".join(by_key[key] for key in order) + "\n", encoding="utf-8")
PY
}

cmdline_remove_keys() {
    local file="$1"
    shift
    python3 - "$file" "$@" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
remove = set(sys.argv[2:])
if not path.exists():
    raise SystemExit(0)
text = path.read_text(encoding="utf-8")
parts = text.splitlines()[0].split() if text.strip() else []
kept = []
seen = set()
for token in parts:
    key = token.split("=", 1)[0]
    if key in remove:
        continue
    if token in seen:
        continue
    seen.add(token)
    kept.append(token)
path.write_text((" ".join(kept) + "\n") if kept else "", encoding="utf-8")
PY
}

install_logo_png() {
    local dest="$THEME_DIR/pimfx-splash.png"
    mkdir -p "$THEME_DIR"
    if [[ -f "$REPO_DIR/branding/pimfx-splash.png" ]]; then
        install -Dm644 "$REPO_DIR/branding/pimfx-splash.png" "$dest"
        return 0
    fi
    if [[ -f "$REPO_DIR/branding/pimfx-splash.svg" ]] && command -v rsvg-convert >/dev/null 2>&1; then
        rsvg-convert -w 1920 -h 1080 "$REPO_DIR/branding/pimfx-splash.svg" -o "$dest"
        return 0
    fi
    if [[ -f "$REPO_DIR/branding/pimfx-splash.svg" ]] && command -v convert >/dev/null 2>&1; then
        convert -background black -resize 1920x1080 "$REPO_DIR/branding/pimfx-splash.svg" "$dest"
        return 0
    fi
    python3 "$SCRIPT_DIR/render-splash.py" "$dest"
}

do_install() {
    local config cmdline old_theme="" option
    config="$(boot_config)"
    cmdline="$(boot_cmdline)"

    if [[ -f /etc/crypttab ]] && grep -Eqs '^[[:space:]]*[^#[:space:]]' /etc/crypttab; then
        die "the text-free splash is not enabled on encrypted-root systems because it could hide an unlock prompt"
    fi
    confirm "Install the PI-MFX boot and shutdown logo and hide boot text?" || return 0

    mkdir -p "$STATE_DIR"
    save_config_before "$config" disable_splash "$STATE_DIR/disable_splash.before"
    save_config_before "$config" auto_initramfs "$STATE_DIR/auto_initramfs.before"
    if command -v plymouth-set-default-theme >/dev/null 2>&1; then
        old_theme="$(plymouth-set-default-theme 2>/dev/null || true)"
    fi
    if [[ ! -e "$STATE_DIR/plymouth-theme-before" ]]; then
        printf '%s\n' "$old_theme" > "$STATE_DIR/plymouth-theme-before"
    fi
    for option in plymouth plymouth-themes librsvg2-bin; do
        if ! package_installed "$option"; then
            touch "$STATE_DIR/package-${option}.was-absent"
        fi
    done

    log "Installing Plymouth and the PI-MFX theme"
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        plymouth plymouth-themes librsvg2-bin

    install_logo_png
    install -Dm644 "$REPO_DIR/branding/plymouth/pimfx.plymouth" "$THEME_DIR/pimfx.plymouth"
    install -Dm644 "$REPO_DIR/branding/plymouth/pimfx.script" "$THEME_DIR/pimfx.script"
    chmod 0644 "$THEME_DIR/pimfx.plymouth" "$THEME_DIR/pimfx.script" "$THEME_DIR/pimfx-splash.png"

    plymouth-set-default-theme "$THEME_NAME"

    set_config_value "$config" disable_splash 1
    set_config_value "$config" auto_initramfs 1
    cmdline_add "$cmdline" \
        quiet splash loglevel=3 \
        systemd.show_status=false rd.systemd.show_status=false \
        udev.log_level=3 rd.udev.log_level=3 \
        vt.global_cursor_default=0 logo.nologo plymouth.ignore-serial-consoles

    log "Rebuilding the initramfs so the logo is available before the root filesystem"
    update-initramfs -u -k all
    touch "$STATE_DIR/quiet-splash-applied"
    log "The display will show only the PI-MFX logo during boot, reboot and shutdown"
    log "Boot details remain in the journal. Reboot to use the new splash."
}

do_remove() {
    local config cmdline old_theme=""
    [[ -f "$STATE_DIR/quiet-splash-applied" ]] || {
        log "No PI-MFX boot logo is installed"
        return 0
    }
    confirm "Remove the PI-MFX boot logo and restore boot text?" || return 0

    config="$(boot_config)"
    cmdline="$(boot_cmdline)"
    restore_config_value "$config" disable_splash "$STATE_DIR/disable_splash.before"
    restore_config_value "$config" auto_initramfs "$STATE_DIR/auto_initramfs.before"
    cmdline_remove_keys "$cmdline" \
        quiet splash loglevel systemd.show_status rd.systemd.show_status \
        udev.log_level rd.udev.log_level vt.global_cursor_default logo.nologo \
        plymouth.ignore-serial-consoles

    if [[ -f "$STATE_DIR/plymouth-theme-before" ]]; then
        old_theme="$(tr -d '\n' < "$STATE_DIR/plymouth-theme-before")"
    fi
    if command -v plymouth-set-default-theme >/dev/null 2>&1; then
        if [[ -n "$old_theme" && "$old_theme" != "$THEME_NAME" ]]; then
            plymouth-set-default-theme "$old_theme" || true
        elif [[ -d /usr/share/plymouth/themes/details ]]; then
            plymouth-set-default-theme details || true
        fi
    fi
    rm -rf -- "$THEME_DIR"
    update-initramfs -u -k all || true

    local -a remove_packages=()
    for old_theme in librsvg2-bin plymouth-themes plymouth; do
        if [[ -f "$STATE_DIR/package-${old_theme}.was-absent" ]] && package_installed "$old_theme"; then
            remove_packages+=("$old_theme")
        fi
    done
    if [[ ${#remove_packages[@]} -gt 0 ]]; then
        DEBIAN_FRONTEND=noninteractive apt-get purge -y "${remove_packages[@]}" || true
    fi
    rm -f "$STATE_DIR/quiet-splash-applied" \
        "$STATE_DIR/disable_splash.before" "$STATE_DIR/disable_splash.before.absent" \
        "$STATE_DIR/auto_initramfs.before" "$STATE_DIR/auto_initramfs.before.absent" \
        "$STATE_DIR/plymouth-theme-before" \
        "$STATE_DIR/package-plymouth.was-absent" \
        "$STATE_DIR/package-plymouth-themes.was-absent" \
        "$STATE_DIR/package-librsvg2-bin.was-absent"
    log "Boot logo removed. Reboot to restore the console messages."
}

do_status() {
    if [[ -f "$STATE_DIR/quiet-splash-applied" ]]; then
        echo "splash    installed (PI-MFX logo, quiet boot)"
    else
        echo "splash    not installed"
    fi
    if command -v plymouth-set-default-theme >/dev/null 2>&1; then
        echo "plymouth  $(plymouth-set-default-theme 2>/dev/null || echo none)"
    fi
}

usage() {
    cat <<'EOF'
Usage: sudo bash ./scripts/boot-splash.sh <install|remove|status> [--yes]
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        install|remove|status) ACTION="$1"; shift ;;
        -y|--yes) ASSUME_YES=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown option: $1" ;;
    esac
done

[[ $EUID -eq 0 ]] || die "run this with sudo"
case "$ACTION" in
    install) do_install ;;
    remove) do_remove ;;
    status) do_status ;;
esac
