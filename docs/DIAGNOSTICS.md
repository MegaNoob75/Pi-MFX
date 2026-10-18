# Crash and reboot diagnostics

Install/update enables persistent system journal files under `/var/log/journal`.
This overrides Raspberry Pi OS's volatile-storage setting. The system journal
includes engine output, plugin stderr, helper errors, service exit signals,
kernel messages and OOM kills. Retention targets 64 MB and 14 days, reserving
256 MB free disk space. Rotation can temporarily exceed the size target.

To enable logging on an existing Pi without rebuilding or restarting Pi-MFX,
run from the updated source checkout:

```sh
sudo bash scripts/install-logging.sh
```

After a failure, including after reboot:

```sh
sudo pimfx-diagnostics > pimfx-diagnostics.txt
sudo journalctl -b -1 -u pimfx.service --no-pager
```

The report includes the current and previous boot, service exit status, kernel
and system warnings, available memory, disk space and Pi throttling flags.
An unavailable previous boot is reported rather than silently omitted.
It does not dump credentials or rig files, but logs may contain file paths,
device names, network addresses or plugin output; review before sharing.

Logs cannot recover failures that happened before persistent logging was
enabled. Abrupt power loss or a kernel lockup may still lose the final messages;
routine journal writes sync within 30 seconds. No crash handler or file writes
have been added to the audio callback. This does not enable core dumps.

Reboot/shutdown requests now queue a separate systemd timer for three seconds
later so the helper and engine can send their acknowledgement before stopping.
The response confirms scheduling; a later systemd failure appears in
`pimfx-power.service` logs. The browser's existing connection logic reconnects
after reboot. A disconnected/crashed engine cannot accept a reboot request;
use SSH or the Pi terminal in that case.

Pi validation: verify multiple retained boots after reboot, capture a report,
confirm both power buttons acknowledge before disconnecting, and inspect
`pimfx-power.service` if a scheduled power action fails. Hardware/crash testing
must be performed on the Pi.
