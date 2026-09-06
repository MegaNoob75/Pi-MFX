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
    log "Pulling $(git rev-parse --abbrev-ref HEAD)"

    # A failed UI build can leave npm's lockfile untracked. Once that file is
    # in the repo, git pull refuses to overwrite it.
    if [[ -e ui/package-lock.json ]] && ! git ls-files --error-unmatch ui/package-lock.json >/dev/null 2>&1; then
        log "  Removing leftover untracked ui/package-lock.json"
        rm -f ui/package-lock.json
    fi

    as_clone_owner git pull --ff-only
else
    die "this folder is not a git clone; clone the repo first (see docs/DEV_FLOW.md)"
fi

if ! command -v cmake >/dev/null 2>&1; then
    die "cmake is not installed. This Pi has not been set up yet. Run:  sudo bash ./scripts/install.sh --with-plugins"
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
    systemctl daemon-reload
    if [[ -f "$REPO_DIR/systemd/95-pimfx-audio.rules" ]]; then
        log "Refreshing audio udev rules"
        install -Dm644 "$REPO_DIR/systemd/95-pimfx-audio.rules" /etc/udev/rules.d/95-pimfx-audio.rules
        udevadm control --reload-rules >/dev/null 2>&1 || true
        udevadm trigger --subsystem-match=sound >/dev/null 2>&1 || true
    fi
    log "Restarting pimfx"
    systemctl restart pimfx.service
    sleep 1
    systemctl --no-pager --full status pimfx.service || true
else
    die "pimfx is not installed yet. First time on this Pi: sudo bash ./scripts/install.sh --with-plugins"
fi

ADDRESS="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [[ -f /var/lib/pimfx-touchscreen/configured-user ]]; then
    log "Refreshing the touchscreen session (Pi-MFX keyboard, no system popup)"
    bash "$REPO_DIR/scripts/pimfx.sh" display-refresh
fi
log "Done. Open http://${ADDRESS:-<this-pi>}:8080"
