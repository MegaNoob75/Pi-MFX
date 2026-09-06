#!/usr/bin/env bash
#
# Pi-MFX installer for Raspberry Pi OS 64-bit.
#
# This assumes the Pi is dedicated to Pi-MFX. It changes system-wide audio
# behaviour: it masks the desktop sound servers, raises realtime limits, pins
# the CPU governor to performance, and installs a systemd service. Every change
# is listed in docs/LOW_LATENCY.md and every one is undone by uninstall.sh.
#
# It deliberately does NOT isolate CPU cores. NAM and convolution plugins use
# worker threads, and isolcpus starves them; the audio thread gets realtime
# priority and one pinned core instead, leaving the rest for plugin workers.

set -euo pipefail

PIMFX_USER="${PIMFX_USER:-pimfx}"
PIMFX_PORT="${PIMFX_PORT:-8080}"
PREFIX="${PREFIX:-/usr/local}"
DATA_ROOT="${DATA_ROOT:-/var/lib/pimfx}"
WEB_ROOT="/usr/share/pimfx/web"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

INSTALL_PLUGINS="ask"
SKIP_TUNING="no"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m error\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
    cat <<'EOF'
Usage: sudo ./scripts/install.sh [options]

  --with-plugins      Install a starter set of LV2 plugins from the distro
  --no-plugins        Do not install any plugins (default when non-interactive)
  --no-tuning         Install the service but make no system audio changes
  --port <n>          Port for the web UI (default 8080)
  --user <name>       Service account to create and run as (default pimfx)
  -h, --help          This text

Plugins are separate works under their own licenses; see docs/PLUGIN_LICENSES.md.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --with-plugins) INSTALL_PLUGINS="yes"; shift ;;
        --no-plugins)   INSTALL_PLUGINS="no"; shift ;;
        --no-tuning)    SKIP_TUNING="yes"; shift ;;
        --port)         PIMFX_PORT="$2"; shift 2 ;;
        --user)         PIMFX_USER="$2"; shift 2 ;;
        -h|--help)      usage; exit 0 ;;
        *)              die "unknown option: $1" ;;
    esac
done

[[ $EUID -eq 0 ]] || die "run this with sudo"

# ---------------------------------------------------------------------------
# 1. Sanity checks
# ---------------------------------------------------------------------------

log "Checking the machine"

if [[ -r /proc/device-tree/model ]]; then
    MODEL="$(tr -d '\0' < /proc/device-tree/model)"
    log "  $MODEL"
    case "$MODEL" in
        *"Raspberry Pi 5"*) : ;;
        *"Raspberry Pi"*)   warn "Pi-MFX targets the Pi 5; older boards will manage far fewer plugins" ;;
        *)                  warn "not a Raspberry Pi; continuing anyway" ;;
    esac
fi

[[ "$(uname -m)" == "aarch64" ]] || warn "not a 64-bit kernel; performance will suffer"

# ---------------------------------------------------------------------------
# 2. Dependencies
# ---------------------------------------------------------------------------

log "Installing build and runtime dependencies"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends \
    build-essential cmake pkg-config git \
    libasound2-dev liblilv-dev lv2-dev \
    libcurl4-openssl-dev libsndfile1-dev libsamplerate0-dev \
    nodejs npm

if [[ "$INSTALL_PLUGINS" == "ask" ]]; then
    if [[ -t 0 ]]; then
        cat <<'EOF'

Pi-MFX ships no effects of its own. A starter set is available from the
Raspberry Pi OS repositories, under each plugin's own license (mostly GPL):

  calf-plugins  x42-plugins  zam-plugins  guitarix-lv2  lsp-plugins-lv2

Pi-MFX works without them; you can install plugins yourself at any time.
EOF
        read -r -p "Install the starter plugin set? [y/N] " reply
        [[ "$reply" =~ ^[Yy]$ ]] && INSTALL_PLUGINS="yes" || INSTALL_PLUGINS="no"
    else
        INSTALL_PLUGINS="no"
    fi
fi

if [[ "$INSTALL_PLUGINS" == "yes" ]]; then
    log "Installing starter LV2 plugins (each under its own license)"
    apt-get install -y --no-install-recommends \
        calf-plugins x42-plugins zam-plugins guitarix-lv2 lsp-plugins-lv2 || \
        warn "some plugin packages were unavailable; Pi-MFX will run without them"
fi

# ---------------------------------------------------------------------------
# 3. Build
# ---------------------------------------------------------------------------

log "Building the engine"
cmake -S "$REPO_DIR/engine" -B "$REPO_DIR/engine/build" -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$REPO_DIR/engine/build" -j "$(nproc)"

log "Building the user interface"
(
    cd "$REPO_DIR/ui"
    npm ci --silent 2>/dev/null || npm install --silent
    npm run build --silent
)

# ---------------------------------------------------------------------------
# 4. Service account and files
# ---------------------------------------------------------------------------

log "Creating the $PIMFX_USER service account"
if ! id -u "$PIMFX_USER" >/dev/null 2>&1; then
    useradd --system --create-home --home-dir /var/lib/"$PIMFX_USER" \
            --shell /usr/sbin/nologin "$PIMFX_USER"
fi
# audio for the sound card, plugdev so a USB interface can be reopened after
# a replug without restarting the service.
usermod -aG audio,plugdev "$PIMFX_USER"

install -Dm755 "$REPO_DIR/engine/build/pimfx" "$PREFIX/bin/pimfx"

rm -rf "$WEB_ROOT"
install -d "$WEB_ROOT"
cp -r "$REPO_DIR/ui/dist/." "$WEB_ROOT/"

install -d -o "$PIMFX_USER" -g "$PIMFX_USER" \
    "$DATA_ROOT" "$DATA_ROOT/banks" "$DATA_ROOT/models" "$DATA_ROOT/irs" \
    "$DATA_ROOT/themes" "$DATA_ROOT/downloads"

# ---------------------------------------------------------------------------
# 5. System tuning
# ---------------------------------------------------------------------------

if [[ "$SKIP_TUNING" == "yes" ]]; then
    warn "skipping system tuning at your request; latency will be much worse"
else
    log "Tuning the system for low-latency audio"

    # Realtime scheduling and unlimited locked memory for the audio group. A
    # SCHED_FIFO audio thread that can be preempted or paged out is the single
    # most common cause of clicks on Linux.
    install -Dm644 /dev/stdin /etc/security/limits.d/95-pimfx-audio.conf <<'EOF'
# Installed by Pi-MFX. Lets the audio group run realtime threads and lock
# memory, which the engine needs to avoid xruns. Removed by uninstall.sh.
@audio   -  rtprio      95
@audio   -  memlock     unlimited
@audio   -  nice       -19
EOF

    # The Pi 5's ondemand governor reacts far too slowly for 64-frame periods:
    # the clock is still ramping up when the buffer is already late.
    install -Dm644 /dev/stdin /etc/systemd/system/pimfx-governor.service <<'EOF'
[Unit]
Description=Pin the CPU governor to performance for Pi-MFX
After=multi-user.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do echo performance > "$g" 2>/dev/null || true; done'
ExecStop=/bin/sh -c 'for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do echo ondemand > "$g" 2>/dev/null || true; done'

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable --now pimfx-governor.service >/dev/null

    # Swapping is fatal for realtime audio, and a dedicated Pi has no use for
    # it. dphys-swapfile is disabled rather than uninstalled so it can come
    # back if this machine is ever repurposed.
    install -Dm644 /dev/stdin /etc/sysctl.d/95-pimfx-audio.conf <<'EOF'
# Installed by Pi-MFX. Removed by uninstall.sh.
vm.swappiness = 1
# Larger dirty ratios keep writeback from stalling the audio thread when the
# UI saves a bank or a download lands.
vm.dirty_ratio = 20
vm.dirty_background_ratio = 5
# Allow more mapped regions: every plugin brings its own.
vm.max_map_count = 262144
fs.inotify.max_user_watches = 524288
EOF
    sysctl --system >/dev/null

    if systemctl is-enabled dphys-swapfile >/dev/null 2>&1; then
        log "  Disabling swap"
        systemctl disable --now dphys-swapfile >/dev/null 2>&1 || true
        swapoff -a || true
    fi

    # PipeWire and PulseAudio would grab the card and put a mixing server in
    # the path. Pi-MFX opens the hardware device directly, so they are masked
    # rather than merely stopped, because a desktop session would restart them.
    log "  Masking PipeWire and PulseAudio"
    for unit in pipewire.socket pipewire.service pipewire-pulse.socket \
                pipewire-pulse.service wireplumber.service \
                pulseaudio.socket pulseaudio.service; do
        systemctl --global mask "$unit" >/dev/null 2>&1 || true
    done
    systemctl --global daemon-reload >/dev/null 2>&1 || true

    # threadirqs lets the sound card's interrupt run at a realtime priority of
    # its own instead of in hard IRQ context. No isolcpus: see the note at the
    # top of this file.
    CMDLINE=/boot/firmware/cmdline.txt
    [[ -f "$CMDLINE" ]] || CMDLINE=/boot/cmdline.txt
    if [[ -f "$CMDLINE" ]] && ! grep -q threadirqs "$CMDLINE"; then
        log "  Adding threadirqs to the kernel command line (takes effect after reboot)"
        cp "$CMDLINE" "$CMDLINE.pimfx-backup"
        sed -i '1 s/$/ threadirqs/' "$CMDLINE"
    fi

    # Wi-Fi power saving introduces multi-millisecond stalls, which show up as
    # a stuttering UI and, on some boards, as USB latency.
    if command -v iw >/dev/null 2>&1; then
        install -Dm644 /dev/stdin /etc/systemd/system/pimfx-wifi-powersave.service <<'EOF'
[Unit]
Description=Disable Wi-Fi power saving for Pi-MFX
After=network.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'iw dev wlan0 set power_save off 2>/dev/null || true'

[Install]
WantedBy=multi-user.target
EOF
        systemctl enable --now pimfx-wifi-powersave.service >/dev/null 2>&1 || true
    fi
fi

# ---------------------------------------------------------------------------
# 6. Service
# ---------------------------------------------------------------------------

log "Installing the pimfx service"
sed -e "s|@USER@|$PIMFX_USER|g" \
    -e "s|@PREFIX@|$PREFIX|g" \
    -e "s|@DATA_ROOT@|$DATA_ROOT|g" \
    -e "s|@WEB_ROOT@|$WEB_ROOT|g" \
    -e "s|@PORT@|$PIMFX_PORT|g" \
    "$REPO_DIR/systemd/pimfx.service.in" > /etc/systemd/system/pimfx.service

systemctl daemon-reload
systemctl enable pimfx.service >/dev/null
systemctl restart pimfx.service

sleep 2
if ! systemctl is-active --quiet pimfx.service; then
    warn "the service did not start; recent log follows"
    journalctl -u pimfx.service -n 30 --no-pager || true
    exit 1
fi

ADDRESS="$(hostname -I 2>/dev/null | awk '{print $1}')"
cat <<EOF

Pi-MFX is installed and running.

  Open        http://${ADDRESS:-<this-pi>}:$PIMFX_PORT
  Service     systemctl status pimfx
  Logs        journalctl -u pimfx -f
  Data        $DATA_ROOT
  Remove      sudo ./scripts/uninstall.sh

First steps:
  1. Settings -> Audio: pick your interface or HAT, then set the sample rate,
     period size, and period count. Start at 48000 / 64 / 3 and work down
     while watching the xrun counter.
  2. Settings -> Controller: if you built a floorboard, connect it and use
     Learn to assign each switch. You do not need one; the browser is a
     complete control surface on its own.
  3. Add effects to the chain. Pi-MFX ships none; install LV2 plugins and they
     appear in the picker.

EOF

if grep -q threadirqs "${CMDLINE:-/dev/null}" 2>/dev/null; then
    warn "reboot to pick up the threadirqs kernel option"
fi
