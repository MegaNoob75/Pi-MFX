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
echo 'open     http://'"$(hostname -I 2>/dev/null | awk '{print $1}')"':8080'
if [[ -f /var/lib/pimfx-touchscreen/configured-user ]]; then
    printf 'screen   configured for %s\n' "$(cat /var/lib/pimfx-touchscreen/configured-user)"
else
    echo 'screen   not configured'
fi
