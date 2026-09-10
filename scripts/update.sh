#!/usr/bin/env bash
#
# Daily rebuild on the Pi after you push from the PC.
# Pulls the current branch, rebuilds engine + UI, installs, restarts pimfx.
# Does not re-run OS tuning or apt. Use install.sh for a first-time setup.

set -euo pipefail

PREFIX="${PREFIX:-/usr/local}"
WEB_ROOT="/usr/share/pimfx/web"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m error\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run this with sudo:  sudo ./scripts/update.sh"

cd "$REPO_DIR"
# shellcheck source=clone-owner.inc.sh
. "$REPO_DIR/scripts/clone-owner.inc.sh"
ensure_clone_writable

if [[ "${SKIP_PULL:-0}" == "1" ]]; then
    log "Skipping git pull (using the files already in this folder)"
elif [[ -d .git ]]; then
    clone_owner
    branch="$(as_clone_owner git rev-parse --abbrev-ref HEAD)"
    log "Pulling ${branch}"

    # A failed UI build can leave npm's lockfile untracked. Once that file is
    # in the repo, git pull refuses to overwrite it.
    if [[ -e ui/package-lock.json ]] && ! git ls-files --error-unmatch ui/package-lock.json >/dev/null 2>&1; then
        log "  Removing leftover untracked ui/package-lock.json"
        rm -f ui/package-lock.json
    fi

    as_clone_owner git fetch origin
    # Copies from the PC (MobaXterm) dirty tracked files and block a merge.
    # This clone is a deployment copy; origin wins. Banks live in /var/lib/pimfx.
    if ! as_clone_owner git diff --quiet || ! as_clone_owner git diff --cached --quiet; then
        log "Local files differ from git (often a copy from the PC). Matching origin/${branch}."
        as_clone_owner git reset --hard "origin/${branch}"
    else
        as_clone_owner git merge --ff-only "origin/${branch}"
    fi
else
    die "this folder is not a git clone; clone the repo first (see docs/DEV_FLOW.md)"
fi

if ! command -v cmake >/dev/null 2>&1; then
    die "cmake is not installed. This Pi has not been set up yet. Run:  sudo bash ./scripts/pimfx.sh"
fi

log "Building the engine"
as_clone_owner cmake -S "$REPO_DIR/engine" -B "$REPO_DIR/engine/build" -DCMAKE_BUILD_TYPE=Release >/dev/null
as_clone_owner cmake --build "$REPO_DIR/engine/build" -j "$(nproc)"

if [[ -f "$REPO_DIR/ui/package.json" ]]; then
    log "Building the user interface"
    as_clone_owner bash -c 'cd "$1" && (npm ci --silent 2>/dev/null || npm install --silent) && npm run build --silent' bash "$REPO_DIR/ui"
fi

log "Installing files"
install -Dm755 "$REPO_DIR/engine/build/pimfx" "$PREFIX/bin/pimfx"
if [[ -d "$REPO_DIR/ui/dist" ]]; then
    rm -rf "$WEB_ROOT"
    install -d "$WEB_ROOT"
    cp -r "$REPO_DIR/ui/dist/." "$WEB_ROOT/"
fi

if [[ -f /etc/systemd/system/pimfx.service ]]; then
    PIMFX_USER="${PIMFX_USER:-$(awk -F= '/^User=/{print $2; exit}' /etc/systemd/system/pimfx.service)}"
    PIMFX_USER="${PIMFX_USER:-pimfx}"
    DATA_ROOT="${DATA_ROOT:-/var/lib/pimfx}"
    EXISTING_PORT="$(sed -n 's/.*--port \([0-9][0-9]*\).*/\1/p' /etc/systemd/system/pimfx.service | head -1)"
    PIMFX_PORT="${PIMFX_PORT:-${EXISTING_PORT:-8080}}"
    log "Refreshing the pimfx service unit"
    sed -e "s|@USER@|$PIMFX_USER|g" \
        -e "s|@PREFIX@|$PREFIX|g" \
        -e "s|@DATA_ROOT@|$DATA_ROOT|g" \
        -e "s|@WEB_ROOT@|$WEB_ROOT|g" \
        -e "s|@PORT@|$PIMFX_PORT|g" \
        "$REPO_DIR/systemd/pimfx.service.in" > /etc/systemd/system/pimfx.service
    if [[ -f "$REPO_DIR/scripts/plugin-helper.py" ]]; then
        log "Refreshing the plugin helper"
        install -d -o "$PIMFX_USER" -g "$PIMFX_USER" "$DATA_ROOT/lv2"
        install -Dm644 "$REPO_DIR/scripts/plugin-helper.py" "$PREFIX/libexec/pimfx/plugin-helper.py"
        sed -e "s|@USER@|$PIMFX_USER|g" \
            -e "s|@PREFIX@|$PREFIX|g" \
            -e "s|@DATA_ROOT@|$DATA_ROOT|g" \
            -e "s|@REPO@|$REPO_DIR|g" \
            "$REPO_DIR/systemd/pimfx-plugin-helper.service.in" > /etc/systemd/system/pimfx-plugin-helper.service
    fi
    PREFIX="$PREFIX" DATA_ROOT="$DATA_ROOT" PIMFX_USER="$PIMFX_USER" \
        bash "$REPO_DIR/scripts/install-hotspot.sh"
    if [[ -f "$REPO_DIR/scripts/mdns.py" ]]; then
        log "Refreshing pimfx.local"
        if ! command -v avahi-publish >/dev/null 2>&1; then
            apt-get install -y --no-install-recommends avahi-daemon avahi-utils >/dev/null \
                || warn "could not install Avahi; pimfx.local will be unavailable"
        fi
        install -Dm644 "$REPO_DIR/scripts/mdns.py" "$PREFIX/libexec/pimfx/mdns.py"
        if [[ -f "$REPO_DIR/systemd/pimfx-mdns.service.in" ]]; then
            sed -e "s|@PREFIX@|$PREFIX|g" \
                -e "s|@PORT@|$PIMFX_PORT|g" \
                -e "s|@USER@|$PIMFX_USER|g" \
                "$REPO_DIR/systemd/pimfx-mdns.service.in" > /etc/systemd/system/pimfx-mdns.service
        fi
    fi
    systemctl daemon-reload
    if [[ -f /etc/systemd/system/pimfx-mdns.service ]]; then
        systemctl enable avahi-daemon.service >/dev/null 2>&1 || true
        systemctl enable pimfx-mdns.service >/dev/null 2>&1 || true
        systemctl restart pimfx-mdns.service >/dev/null 2>&1 \
            || warn "pimfx-mdns did not start; open the UI by IP until Avahi is running"
    fi
    if [[ -f /etc/systemd/system/pimfx-plugin-helper.service ]]; then
        systemctl enable pimfx-plugin-helper.service >/dev/null 2>&1 || true
        if [[ "${PIMFX_UPDATE_FROM_HELPER:-0}" == "1" ]]; then
            log "Leaving the plugin helper running so Update progress can finish"
        else
            systemctl restart pimfx-plugin-helper.service \
                || warn "plugin helper did not start; apt installs from the UI will be unavailable"
        fi
    fi
    if [[ -f "$REPO_DIR/systemd/95-pimfx-audio.rules" ]]; then
        log "Refreshing audio udev rules"
        install -Dm644 "$REPO_DIR/systemd/95-pimfx-audio.rules" /etc/udev/rules.d/95-pimfx-audio.rules
        udevadm control --reload-rules >/dev/null 2>&1 || true
        udevadm trigger --subsystem-match=sound >/dev/null 2>&1 || true
        udevadm trigger --subsystem-match=usb >/dev/null 2>&1 || true
    fi
    if [[ -f "$REPO_DIR/systemd/95-pimfx-usbcore.conf" ]]; then
        install -Dm644 "$REPO_DIR/systemd/95-pimfx-usbcore.conf" /etc/modprobe.d/95-pimfx-audio.conf
        echo -1 > /sys/module/usbcore/parameters/autosuspend 2>/dev/null || true
    fi
    CMDLINE=/boot/firmware/cmdline.txt
    [[ -f "$CMDLINE" ]] || CMDLINE=/boot/cmdline.txt
    if [[ -f "$CMDLINE" ]] && ! grep -q 'usbcore.autosuspend' "$CMDLINE"; then
        log "Disabling USB autosuspend on the kernel command line (reboot once to apply)"
        [[ -f "$CMDLINE.pimfx-backup" ]] || cp "$CMDLINE" "$CMDLINE.pimfx-backup"
        sed -i '1 s/$/ usbcore.autosuspend=-1/' "$CMDLINE"
    fi
    log "Restarting pimfx"
    systemctl restart pimfx.service
    sleep 1
    systemctl --no-pager --full status pimfx.service || true
else
    die "pimfx is not installed yet. First time on this Pi: sudo bash ./scripts/pimfx.sh"
fi

ADDRESS="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [[ -f /var/lib/pimfx-touchscreen/configured-user ]]; then
    log "Refreshing the touchscreen session (Pi-MFX keyboard, no system popup)"
    bash "$REPO_DIR/scripts/pimfx.sh" display-refresh
fi
log "Done. Open http://pimfx.local:${PIMFX_PORT:-8080}"
log "     or http://${ADDRESS:-<this-pi>}:${PIMFX_PORT:-8080}"
