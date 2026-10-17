# Controller firmware updates

Status: **NOT RUN on Pi or ESP32-S3**. No compilation or flashing was performed
on Windows. Validate the complete path below before relying on automatic updates.

## User workflow

Settings → Updates includes Controller Firmware. Updating Pi-MFX also checks the
bundled source version against the supported USB-MIDI controller. Only a newer
version is built and flashed. Arduino IDE is not needed for subsequent updates.
The controller temporarily stops sending input while its firmware is written.
Keep the USB connection and power connected until the version is verified.

When disconnected, the update remains pending. The helper checks for connection
every 30 seconds after the first combined update or Check / Retry action enables
automatic updates. Failures stop automatic retries; use Check / Retry after
resolving the problem. Firmware failures do not roll back the installed Pi-MFX
application and are shown separately. A newer installed controller is not
downgraded when switching Pi-MFX branches.

## One-time receiver installation

Firmware 2.0 and earlier cannot receive firmware over MIDI. Upload the current
sketch once in Arduino IDE, with all sketch-folder files present, including
FirmwareUpdate.h. Select ESP32S3 Dev Module, USB-OTG (TinyUSB), CDC on Boot
disabled, and **Minimal SPIFFS (1.9MB APP with OTA/190KB SPIFFS)** on a board with
at least 4MB flash. Keep Erase All Flash disabled to retain NVS wiring. Confirm
the controller reports 2.1 or newer and Hardware Setup reads its saved wiring.
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

The transfer is local USB-MIDI. Its checksum detects corruption; it is not a
firmware signature or an authentication mechanism. Only use trusted Pi-MFX source.
