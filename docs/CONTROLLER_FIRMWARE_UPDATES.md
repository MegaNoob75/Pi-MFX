# Controller firmware updates

Status: **NOT RUN on Pi or ESP32-S3**. No compilation or flashing was performed
on Windows. Validate the complete path below before relying on automatic updates.

## User workflow

Firmware numbering restarted at **1.0**; the current image is **1.1**, retaining
the features developed in the earlier 2.x images. Its extended identity advertises wiring and guided analog
capabilities independently of release numbers. Install the updated Pi-MFX host
alongside it. Existing 2.x controllers are not automatically downgraded to 1.0;
use one manual Arduino upload to move to this numbering sequence.

Settings → Updates shows **Installed** and **Latest** for Controller Firmware.
Latest is checked against GitHub using the app's selected Main or Dev channel;
it is not inferred from the firmware source already on the Pi. Opening the page
starts a background check (cached for ten minutes); **Check GitHub** refreshes it
immediately. An offline/error result is displayed and cannot authorize installing
a stale cached version. Only a newer version is built and flashed. Arduino IDE
is not needed for subsequent updates.
The controller temporarily stops sending input while its firmware is written.
Keep the USB connection and power connected until the version is verified.

**Update Controller To…** downloads the firmware files from the exact GitHub
commit used by the latest-version check, then builds, transfers and verifies them
without rebuilding Pi-MFX. The app checkout and its installed version do not
change. GitHub checks alone do not enable installation; the button authorizes an
update. Pending reconnects retry that same checked commit, even if a newer one is
published meanwhile. A subsequent check can offer the newer version afterward.
Downloaded sources are cached under `/var/lib/pimfx/controller-github/<commit>`
and excluded from backups. The worker never downloads/replaces updater code from
GitHub; it uses the installed updater and validates the firmware recipe's board
and protocol. Checking and writing firmware have distinct progress states.

Combined Pi-MFX updates continue to install newer firmware from their bundled
source, and the Windows/Pi local-source menu remains available for development.

If Pi-MFX uses the controller's exclusive raw-MIDI address, the updater moves
that same device to its shared ALSA sequencer connection before probing. Other
selected devices are left alone. Finish or cancel Hardware Setup first. A failed
connection change attempts to restore the original address; the audio engine is
not restarted. A visible MIDI port that fails identification is reported as such,
rather than claiming the controller is unplugged.

RtMidi ports must be opened as physical connections. Passing `client_name` to
Mido's RtMidi backend creates virtual ports, even when a hardware port name is
provided; the worker must not pass that option. Discovery excludes software ports
such as Pi-MFX's own controller endpoint. A read-only query on the user's Pi
confirmed that the physical connection receives the 2.1 receiver reply and OTA
capacity. This does not validate firmware compilation, transfer or reboot.

When disconnected, the update remains pending. The helper checks for connection
every 30 seconds after a combined update or explicit firmware update enables
pending retries. Failures stop automatic retries; use Update Controller after
resolving the problem. Firmware failures do not roll back the installed Pi-MFX
application and are shown separately. A newer installed controller is not
downgraded when switching Pi-MFX branches.

## One-time receiver installation

### Firmware-only menus

Run `pimfx.cmd` and choose **5** to download firmware from GitHub (Main,
Dev or Workstation), or **6** to copy firmware from this PC, including local
edits. Both build on the Pi and use the same version check, MIDI transfer and
verification as the combined updater. They do not rebuild the Pi-MFX application.
On the Pi, `sudo bash ./scripts/pimfx.sh` uses the same **5** and **6**
choices; option 6 uses the source checkout already on that Pi.
Both firmware-only paths stream the build/download output into the terminal,
followed by transfer percentages and verification. Quiet build periods print an
elapsed-time message every 15 seconds. Output is also retained in
`/var/lib/pimfx/controller-firmware.log` and displayed on the Updates page.
The Arduino CLI download timeout is set to 600 seconds for large ESP32 packages.
Only newer firmware is flashed; increment the firmware version for local changes.
Older branches without the updater show an error without flashing.

The selected source is retained in `/var/lib/pimfx/controller-source` so a pending
update can finish when the controller connects. A later combined Pi-MFX update
selects the app checkout's bundled firmware again. First-time Arduino setup below
is still required. The Pi must already have Pi-MFX and its helper installed.

Legacy images without the MIDI update receiver need a manual upload. Upload the current
sketch once in Arduino IDE, with all sketch-folder files present, including
FirmwareUpdate.h. Select ESP32S3 Dev Module, USB-OTG (TinyUSB), CDC on Boot
disabled, and **Minimal SPIFFS (1.9MB APP with OTA/190KB SPIFFS)** on a board with
at least 4MB flash. Keep Erase All Flash disabled to retain NVS wiring. Confirm
the controller reports the current version and Hardware Setup reads its saved wiring.
A device without a second OTA application partition needs this manual setup.

## Maintaining firmware source

- Change firmware source normally. Increment kFirmwareMajor/kFirmwareMinor in
  Protocol.h whenever delivering firmware changes. This is the update identity;
  changing source without a version bump deliberately does not trigger flashing.
- firmware/controller-build.json pins Arduino CLI, its SHA-256 digests, ESP32
  core, board options, libraries, board ID and MIDI update protocol version.
  Review this configuration when changing supported hardware or dependencies.
- No compiled firmware is maintained in Git. Builds run as the Pi-MFX service
  user, with a persistent tool/dependency cache at
  /var/lib/pimfx/controller-build. First use needs internet and disk space for
  the ESP32 toolchain. Following builds reuse pinned dependencies.
- Only the application .bin is transferred. Bootloader, partition table and
  NVS are not flashed. The active firmware remains selected until a complete
  image passes ESP32 Update validation and the MD5 transfer checksum. This is
  interruption recovery, not guaranteed rollback after a bad application boots.
- MIDI identity/version readback must match the same device ID after restart.
  Exactly one supported controller must be connected during an update.

## Pi validation

Run host regression checks without downloading or flashing:

```sh
python3 -B -m unittest discover -s scripts/tests -p test_controller_firmware.py
```

Then build the application/UI and Arduino sketch on the Pi using your normal
validation workflow. Use a spare controller and retain an Arduino recovery path.
For the upgrade test, bootstrap the receiver with a lower firmware version,
then restore the bundled target version before running the combined update.

1. Same/newer controller: no build, no flash, version unchanged.
2. Older receiver: source build, progress, checksum validation, reboot and same
   device/version verification. Test switches, encoder, analog and LEDs afterward.
3. Compare saved hardware wiring before and after; reboot both devices and recheck.
4. Start the Pi update with no controller; connect afterward and confirm the
   pending update completes automatically. Repeat across a Pi/helper restart.
5. Disconnect internet during first tool download or fail compilation: no Begin
   firmware message may be sent. Restore access and retry from Updates.
6. Disconnect USB during writing: reconnect, wait at least 30 seconds if needed,
   confirm old firmware still runs, then retry. No false success is permitted.
7. Corrupt a transfer/digest or use an oversized image in an isolated test:
   receiver rejects it and keeps the previous boot selection.
8. Lose the final ACK: success requires post-reboot identity/version readback.
9. Connect two controllers, use a generic MIDI device, or enter Hardware Setup:
   no firmware write may begin. Legacy firmware must show bootstrap instructions.
10. Try a Pi-MFX update during firmware work and vice versa. Source replacement
    and controller builds/transfers must serialize, including CLI updates.
11. Restart the helper during transfer: status must report interruption and wait
    for Retry, rather than repeatedly reflashing on connection.
12. With the ESP32 selected through `hw:CARD=ESP32S3DEV,DEV=0`, start a firmware-only
    update. Confirm it switches to the matching shared port, identifies 2.1,
    updates to 2.2, verifies readback and retains wiring. Repeat with Hardware
    Setup active and with a different selected MIDI device: neither may be changed.
13. Seed an old attempt status with target 1.1 while the source is 2.2. Bundled
    is no longer displayed: Latest must come from GitHub. Confirm checks say Checking Controller and a standalone firmware
    update never starts an application build.
14. Publish a higher firmware version on Dev with the Pi checkout unchanged.
    Check GitHub must show that version; updating must use its checked commit,
    leave the app version/source unchanged, and verify controller readback.
15. Change Main/Dev channels, disconnect internet, and simulate an absent recipe
    or incompatible board/protocol. No stale/unsupported source may be installed.
    A background check without pressing Update must never start a flash.

The transfer is local USB-MIDI. Its checksum detects corruption; it is not a
firmware signature or an authentication mechanism. Only use trusted Pi-MFX source.
