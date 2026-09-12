# Hard-refresh the attached Labwc/Chromium window. The Pi uses --app= (not
# Chromium --kiosk). Do not pkill Chromium: that races the GPU and can freeze
# the Pi. Source this file, then call reload_kiosk_browser.

if ! declare -F log >/dev/null 2>&1; then
    log() { printf '==> %s\n' "$*"; }
fi
if ! declare -F warn >/dev/null 2>&1; then
    warn() { printf ' warn %s\n' "$*"; }
fi

# Print the first matching PID, preferring the browser process over helpers.
_chromium_pid_for_user() {
    local user="$1" pid cmdline
    local list=""
    if [[ -n "$user" ]]; then
        list="$(pgrep -u "$user" -x chromium 2>/dev/null || true)"$'\n'
        list+="$(pgrep -u "$user" -x chromium-browser 2>/dev/null || true)"$'\n'
        list+="$(pgrep -u "$user" -x chrome 2>/dev/null || true)"
    else
        list="$(pgrep -x chromium 2>/dev/null || true)"$'\n'
        list+="$(pgrep -x chromium-browser 2>/dev/null || true)"$'\n'
        list+="$(pgrep -x chrome 2>/dev/null || true)"
    fi
    while IFS= read -r pid; do
        [[ -n "$pid" && -r "/proc/${pid}/cmdline" ]] || continue
        cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true)"
        case "$cmdline" in
            *"--type="*) continue ;;
        esac
        printf '%s\n' "$pid"
        return 0
    done <<< "$list"
    while IFS= read -r pid; do
        [[ -n "$pid" ]] || continue
        printf '%s\n' "$pid"
        return 0
    done <<< "$list"
    return 1
}

# Print: user<TAB>runtime<TAB>display
_wayland_session() {
    local preferred="$1" dir uid user sock display runtime
    if [[ -n "$preferred" ]]; then
        uid="$(id -u "$preferred" 2>/dev/null || true)"
        runtime="/run/user/${uid}"
        if [[ -n "$uid" && -d "$runtime" ]]; then
            for sock in "$runtime"/wayland-*; do
                [[ -S "$sock" ]] || continue
                printf '%s\t%s\t%s\n' "$preferred" "$runtime" "${sock##*/}"
                return 0
            done
        fi
    fi
    for dir in /run/user/*; do
        uid="${dir##*/}"
        [[ "$uid" =~ ^[0-9]+$ ]] || continue
        user="$(getent passwd "$uid" | cut -d: -f1 || true)"
        [[ -n "$user" ]] || continue
        for sock in "$dir"/wayland-*; do
            [[ -S "$sock" ]] || continue
            printf '%s\t%s\t%s\n' "$user" "$dir" "${sock##*/}"
            return 0
        done
    done
    return 1
}

reload_kiosk_browser() {
    local configured user pid uid runtime display session
    configured="$(cat /var/lib/pimfx-touchscreen/configured-user 2>/dev/null || true)"
    user="$configured"
    pid="$(_chromium_pid_for_user "$user" || true)"
    if [[ -z "$pid" ]]; then
        pid="$(_chromium_pid_for_user "" || true)"
        if [[ -n "$pid" ]]; then
            user="$(ps -o user= -p "$pid" 2>/dev/null | awk '{ print $1; exit }' || true)"
        fi
    fi
    if [[ -n "$pid" ]]; then
        uid="$(id -u "$user" 2>/dev/null || true)"
        runtime="/run/user/${uid}"
        display="$(tr '\0' '\n' < "/proc/${pid}/environ" 2>/dev/null | sed -n 's/^WAYLAND_DISPLAY=//p' | head -1 || true)"
        display="${display:-wayland-0}"
        if [[ -z "$uid" || ! -S "${runtime}/${display}" ]]; then
            pid=""
        fi
    fi
    if [[ -z "$pid" ]]; then
        session="$(_wayland_session "$configured" || true)"
        if [[ -z "$session" ]]; then
            log "No Chromium or Wayland session found; skip screen refresh"
            return 0
        fi
        user="${session%%$'\t'*}"
        runtime="$(printf '%s\n' "$session" | cut -f2)"
        display="$(printf '%s\n' "$session" | cut -f3)"
        log "No Chromium process match; refreshing the focused Wayland window (${user})"
    fi
    if ! command -v wtype >/dev/null 2>&1; then
        log "Installing wtype so the Pi screen can hard-refresh"
        if ! DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a NEEDRESTART_SUSPEND=1 \
                apt-get install -y --no-install-recommends wtype; then
            warn "Could not install wtype; reboot the Pi or press Ctrl+Shift+R on that screen"
            return 0
        fi
    fi
    log "Hard-refreshing the Pi screen browser"
    if ! timeout 5 sudo -u "$user" env XDG_RUNTIME_DIR="$runtime" WAYLAND_DISPLAY="$display" \
            wtype -M ctrl -M shift -k r -m shift -m ctrl >/dev/null 2>&1; then
        warn "Could not refresh the Pi screen. Reboot or press Ctrl+Shift+R on that display."
    fi
    timeout 5 sudo -u "$user" env XDG_RUNTIME_DIR="$runtime" WAYLAND_DISPLAY="$display" \
        wtype -M alt -M logo -k h -m logo -m alt >/dev/null 2>&1 || true
    return 0
}
