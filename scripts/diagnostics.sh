#!/usr/bin/env bash
# Read-only report. Redirect stdout to keep a portable text copy.
# No settings, credentials, preset contents, or model contents are read.
set -uo pipefail
export SYSTEMD_PAGER=cat
export SYSTEMD_COLORS=0
report() {
    printf '\n===== %s =====\n' "$1"
    shift
    "$@" 2>&1 || true
}
printf 'Pi-MFX diagnostic report: %s\n' "$(date --iso-8601=seconds)"
if [[ $EUID -ne 0 ]]; then
    echo "Run with sudo for complete system and kernel logs."
fi
report "Uptime" uptime
report "Memory" free -h
report "Disk space" df -h / /var/log
report "Pi power / thermal flags" vcgencmd get_throttled
report "Service exit status" systemctl show pimfx.service pimfx-plugin-helper.service \
    -p Id -p ActiveState -p SubState -p Result -p NRestarts \
    -p ExecMainCode -p ExecMainStatus -p ActiveEnterTimestamp -p MemoryCurrent
report "Retained boots" journalctl --list-boots --no-pager
report "Journal configuration" systemd-analyze cat-config systemd/journald.conf
for boot in 0 -1; do
    report "Pi-MFX logs (boot $boot, last 1500 entries)" journalctl -b "$boot" \
        -u pimfx.service -u pimfx-plugin-helper.service -u pimfx-recovery-guard.service \
        -u pimfx-power.service -u pimfx-power.timer --no-pager -o short-iso-precise -n 1500
    report "Kernel logs (boot $boot, last 500 entries)" journalctl -b "$boot" -k \
        --no-pager -o short-iso-precise -n 500
    report "System warnings (boot $boot, last 200 entries)" journalctl -b "$boot" \
        -p warning --no-pager -o short-iso-precise -n 200
done
if command -v coredumpctl >/dev/null 2>&1; then
    report "Recorded engine crashes" coredumpctl --no-pager list pimfx
fi
