#!/usr/bin/env bash
#
# Daily rebuild on the Pi after you push from the PC.
# Pulls the current branch, rebuilds engine + UI, installs, restarts pimfx.
# Does not re-run OS tuning or apt. Use install.sh for a first-time setup.

set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export NEEDRESTART_SUSPEND=1

PREFIX="${PREFIX:-/usr/local}"
WEB_ROOT="/usr/share/pimfx/web"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OFFICIAL_REPO_URL="https://github.com/MegaNoob75/Pi-MFX.git"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m error\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run this with sudo:  sudo ./scripts/update.sh"

cd "$REPO_DIR"
export GIT_TERMINAL_PROMPT=0
log "Starting update in $REPO_DIR"
# shellcheck source=clone-owner.inc.sh
. "$REPO_DIR/scripts/clone-owner.inc.sh"
ensure_clone_writable

if [[ "${SKIP_PULL:-0}" == "1" ]]; then
    if [[ -f "$REPO_DIR/.pimfx-build-commit" ]]; then
        PIMFX_GIT_SHA="$(tr -d '\r\n' < "$REPO_DIR/.pimfx-build-commit")"
        rm -f "$REPO_DIR/.pimfx-build-commit"
    fi
    if [[ -n "${PIMFX_GIT_SHA:-}" && ! "${PIMFX_GIT_SHA}" =~ ^[0-9a-fA-F]+-local$ ]]; then
        die "local deployment commit metadata is invalid"
    fi
    if [[ -z "${PIMFX_GIT_SHA:-}" && ! -d .git ]]; then
        die "local deployment commit metadata is missing"
    fi
    log "Skipping git pull (using the files already in this folder)"
elif [[ -d .git ]]; then
    clone_owner
    requested="${PIMFX_BRANCH:-}"
    if [[ -n "$requested" ]]; then
        case "$requested" in
            main|dev) ;;
            *) die "branch must be main or dev" ;;
        esac
        log "Switching to ${requested}"
        origin_url="$(as_clone_owner git remote get-url origin 2>/dev/null || true)"
        case "$origin_url" in
            "")
                log "Configuring the Pi-MFX GitHub remote"
                as_clone_owner git remote add origin "$OFFICIAL_REPO_URL"
                ;;
            git@github.com:MegaNoob75/Pi-MFX.git|ssh://git@github.com/MegaNoob75/Pi-MFX.git|http://github.com/MegaNoob75/Pi-MFX.git)
                log "Using the public Pi-MFX GitHub remote"
                as_clone_owner git remote set-url origin "$OFFICIAL_REPO_URL"
                ;;
        esac
        log "Fetching origin/${requested}"
        if ! as_clone_owner timeout 60 git fetch --prune origin \
            "+refs/heads/${requested}:refs/remotes/origin/${requested}" --progress
        then
            die "git fetch timed out or failed; the installed files were not changed"
        fi
        log "Replacing the Pi source folder with origin/${requested}"
        as_clone_owner git reset --hard HEAD
        as_clone_owner git clean -fd
        as_clone_owner git checkout -B "$requested" "origin/${requested}"
        as_clone_owner git reset --hard "origin/${requested}"
        branch="$requested"
    else
        branch="$(as_clone_owner git rev-parse --abbrev-ref HEAD)"
        log "Pulling ${branch}"

        # A failed UI build can leave npm's lockfile untracked. Once that file is
        # in the repo, git pull refuses to overwrite it.
        if [[ -e ui/package-lock.json ]] && ! git ls-files --error-unmatch ui/package-lock.json >/dev/null 2>&1; then
            log "  Removing leftover untracked ui/package-lock.json"
            rm -f ui/package-lock.json
        fi

        as_clone_owner timeout 60 git fetch origin --progress
        # Copies from the PC (MobaXterm) dirty tracked files and block a merge.
        # This clone is a deployment copy; origin wins. Banks live in /var/lib/pimfx.
        if ! as_clone_owner git diff --quiet || ! as_clone_owner git diff --cached --quiet; then
            log "Local files differ from git (often a copy from the PC). Matching origin/${branch}."
            as_clone_owner git reset --hard "origin/${branch}"
        else
            as_clone_owner git merge --ff-only "origin/${branch}"
        fi
    fi
else
    die "this folder is not a git clone; clone the repo first (see docs/DEV_FLOW.md)"
fi

if ! command -v cmake >/dev/null 2>&1; then
    die "cmake is not installed. This Pi has not been set up yet. Run:  sudo bash ./scripts/pimfx.sh"
fi

jobs="$(nproc)"
# Leave one core when the pedal or kiosk is live so SSH and audio stay up.
# A stopped engine can use every core.
if { pgrep -x chromium >/dev/null 2>&1 || systemctl is-active --quiet pimfx.service; } && [[ "$jobs" -gt 1 ]]; then
    jobs=$((jobs - 1))
fi
log "Building the engine (${jobs} cores)"
as_clone_owner env PIMFX_GIT_SHA="${PIMFX_GIT_SHA:-}" \
    nice -n 10 cmake -S "$REPO_DIR/engine" -B "$REPO_DIR/engine/build" \
        -DCMAKE_BUILD_TYPE=Release -DPIMFX_BUILD_COMMIT="${PIMFX_GIT_SHA:-}" >/dev/null
as_clone_owner nice -n 10 cmake --build "$REPO_DIR/engine/build" -j "$jobs"

if [[ -f "$REPO_DIR/ui/package.json" ]]; then
    log "Building the user interface"
    as_clone_owner nice -n 10 bash -c \
        'export VITE_PIMFX_GIT_SHA="$2"; cd "$1" && (npm ci --silent 2>/dev/null || npm install --silent) && npm run build --silent' \
        bash "$REPO_DIR/ui" "${PIMFX_GIT_SHA:-}"
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
    printf '%s\n' "$REPO_DIR" > "$DATA_ROOT/source-repo"
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
    sleep 2
    systemctl --no-pager --full status pimfx.service || true
    # Rewrite Labwc autostart (hide pointer) and Ctrl+Shift+R. Do not pkill Chromium.
    if [[ -f /var/lib/pimfx-touchscreen/configured-user ]]; then
        bash "$REPO_DIR/scripts/pimfx.sh" display-refresh -y
    elif [[ -f "$REPO_DIR/scripts/kiosk-reload.inc.sh" ]]; then
        # shellcheck source=kiosk-reload.inc.sh
        . "$REPO_DIR/scripts/kiosk-reload.inc.sh"
        reload_kiosk_browser
    fi
else
    die "pimfx is not installed yet. First time on this Pi: sudo bash ./scripts/pimfx.sh"
fi

ADDRESS="$(hostname -I 2>/dev/null | awk '{print $1}')"
log "Done. Open http://pimfx.local:${PIMFX_PORT:-8080}"
log "     or http://${ADDRESS:-<this-pi>}:${PIMFX_PORT:-8080}"
log "     The Pi screen was hard-refreshed if a graphical browser session is running."
