#!/usr/bin/env bash
#
# Quick health check on the Pi. Safe to run without sudo.

set -euo pipefail

printf 'branch   %s\n' "$(git -C "$(dirname "${BASH_SOURCE[0]}")/.." rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
printf 'commit   %s\n' "$(git -C "$(dirname "${BASH_SOURCE[0]}")/.." log -1 --oneline 2>/dev/null || echo none)"
echo
systemctl is-active --quiet pimfx.service && echo 'service  running' || echo 'service  not running'
systemctl --no-pager --full status pimfx.service 2>/dev/null | sed -n '1,12p' || true
echo
echo 'audio cards (arecord -l)'
arecord -l 2>/dev/null || echo '  none listed'
echo
echo 'open     http://pimfx.local:8080'
echo '         http://'"$(hostname -I 2>/dev/null | awk '{print $1}')"':8080'
if [[ -f /var/lib/pimfx-touchscreen/configured-user ]]; then
    printf 'screen   configured for %s\n' "$(cat /var/lib/pimfx-touchscreen/configured-user)"
else
    echo 'screen   not configured'
fi
if [[ -f /var/lib/pimfx-boot/quiet-splash-applied ]]; then
    echo 'splash   PI-MFX logo (quiet boot)'
else
    echo 'splash   not installed'
fi
if [[ -f /var/lib/pimfx-boot/skip-wait-applied ]]; then
    echo 'boot     network-wait disabled'
fi
if [[ -f /var/lib/pimfx-boot/unused-services-applied ]]; then
    echo 'boot     unused services disabled'
fi
if [[ -f /var/lib/pimfx/hotspot.json ]]; then
    python3 - <<'PY' 2>/dev/null || echo 'hotspot  configured'
import json
from pathlib import Path
data = json.loads(Path("/var/lib/pimfx/hotspot.json").read_text())
print(f"hotspot  mode={data.get('mode', 'off')} ssid={data.get('ssid', 'PI-MFX')}")
PY
else
    echo 'hotspot  off'
fi
