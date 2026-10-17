# DIY universal ESP32-S3 controller

Flash the supplied universal firmware once, then configure the controller in
**Settings → Controller → Hardware Setup**. Rewiring or adding supported inputs
requires no firmware source edits or reflash.

The current source reports firmware **1.1**, for **ESP32-S3 DevKitC-1 with direct wiring**.
Firmware numbering restarted after the earlier 2.x images; capabilities identify
the current universal image separately from legacy 1.x firmware. Other
ESP32 families, expansion modules, plain LED outputs and arbitrary displays need
additional drivers/images. Firmware updates may still be necessary for fixes or
new component support. See [protocol](CONTROLLER_PROTOCOL.md) and
[validation checklist](CONTROLLER_VALIDATION.md).

## Flash once

After installing Pi-MFX, use **option 5 — First-time ESP32-S3 installation over
USB** in `pimfx.cmd` on Windows or `sudo bash ./scripts/pimfx.sh` on the Pi.
Arduino IDE is not required for this path. The sequence for a new rig is
**option 1 (or 2 without a touchscreen) → option 5 → Hardware Setup**.

1. Choose Main, Dev, Workstation, or your local firmware source.
2. Connect the target ESP32-S3 DevKitC-1 to the **Pi**, using a USB data cable
   and the board's native USB port. Hold BOOT, tap RESET, then release BOOT.
3. The script lists the Pi's USB serial ports and automatically selects a single
   matching Espressif download port. If there are multiple matches or a generic
   USB-to-serial adapter, select the controller's port from the list.
4. Check the selected port and type `INSTALL` to confirm. This replaces firmware
   and writes the bootloader and OTA partition layout. Existing board configuration
   may be incompatible; use options 6/7 for routine updates.
5. Wait for the build, USB upload and controller verification. First use needs
   internet and space for the ESP32 tools. If prompted, tap RESET or reconnect
   native USB to leave download mode. Then open Hardware Setup.

This new initial-install path still needs validation on a Pi and physical board.
It does not retry flashing automatically. A completed USB upload without the
expected MIDI identity, version and OTA capacity is reported as unverified/failed.

### Arduino IDE alternative

1. Install Arduino IDE 2 and Espressif's ESP32 board package.
2. Install **Control Surface** (Pieter P) and **Adafruit NeoPixel**.
3. Open `firmware/esp32s3/PiMFX_Controller/PiMFX_Controller.ino`.
4. Choose **ESP32S3 Dev Module**, **USB-OTG (TinyUSB)**, and disable USB CDC on Boot.
5. Choose **Minimal SPIFFS (1.9MB APP with OTA/190KB SPIFFS)** and keep Erase All Flash disabled.
6. Upload using the board's native USB port, then reconnect it to the Pi.

If upload mode is needed, hold BOOT, tap RST, then release BOOT. Use the port
labelled USB rather than the UART-only port. A serial/JTAG COM device alone is
not a USB-MIDI controller.

A fresh board has no assigned inputs or LED outputs. It still enumerates over
USB and responds to setup commands. Configuration is stored in ESP32 NVS;
normal restarts, reconnects and application updates retain it. A full flash erase
removes that configuration.

After this one-time upload, Pi-MFX updates can build and install newer controller
firmware automatically. See [firmware updates](CONTROLLER_FIRMWARE_UPDATES.md).

## Wire and Learn

Use active-low switches to ground and quadrature encoders with their common
connected to ground. Analog pots/sliders/expression inputs use 3.3 V and ground.
Never feed 5 V into an ESP32 input. Check the actual board's schematic before
wiring; software cannot make an electrically incompatible circuit safe.

1. Select the actual ESP32 USB-MIDI device in Hardware Setup and enable it.
   The board should report current firmware 1.1 and READY after configuration readback.
   This renumbered image retains guided calibration and reports its capabilities explicitly.
2. Add Momentary, Latching, Pot, Slider, Expression or Encoder. Choose the correct
   type first; Learn discovers its connection rather than guessing the type.
3. Select the control and press Learn. Keep everything still for one second.
4. Operate only the selected control:
   - Switch: press and release. Latching: change its position.
   - Analog: turn to 0/minimum and tap **Set Minimum**. Slowly turn to maximum
     and tap **Set Maximum**. Keep other controls still. Each step allows three
     minutes, and pausing does not automatically finish discovery.
   - Encoder: turn clockwise at least four clicks, then stop. Learn Button
     separately if a push switch is fitted.
5. Review the proposed GPIOs and choose **Save on Controller**. Pi-MFX waits for
   persistent save and verified readback before accepting the assignment.
6. Set actions/direction/hold behaviour, then show and arrange the control in
   Layout. Bind preset parameters in Preset Editor as usual.

MIDI addresses are allocated automatically. Performance messages are paused
throughout setup so Learn gestures do not change presets or execute actions.
The board times out abandoned transactions after 90 seconds. Pi-MFX times out
missing replies; Read Board reconciles what actually survived a connection loss.

A pin assigned to another control or the LED strip is excluded from discovery.
Remove the existing wiring first to reuse it. More than one moving input is
rejected as ambiguous. For noisy wiring or unsupported discovery behaviour, use
Advanced Wiring; do not repeatedly accept an unexpected pin.

## Advanced wiring and LEDs

Open **Wiring & Recovery**. Choose a control (encoder rotation or
its paired push), input pin(s), encoder transitions per click, switch debounce,
or analog endpoints. Review Wiring stages the change for confirmation.
Default encoder decoding is four quadrature transitions per detent; adjust for
your encoder. Leave Pi-MFX's additional Encoder Pulses per Click at 1.

The direct input allowlist is GPIO 1, 2, 4–18, 21, 38–42 and 47. Analog inputs
are the allowed pins within 1–18. GPIO 48 is additionally offered for NeoPixel
output. USB, flash/PSRAM, boot straps, UART and absent pins are excluded. The
allowlist is deliberately for this board profile, not every ESP32-S3 module.

Configure one WS2812/NeoPixel strip: data pin, pixel count (0 disables), GRB/RGB
order. Confirm the change, then use Test Pixel with a zero-based pixel index.
The test lights that saved pixel white briefly at low brightness. Logical LED
roles and links to controls remain in Hardware Setup; configure those separately
so theme/performance feedback follows the intended controls.

Current firmware limits: 32 input records and 127 NeoPixels, subject to pin and
physical electrical limits. An encoder turn and its push use separate records.
Adding logical controls in Pi-MFX does not create additional physical GPIOs.

## Existing controller and recovery

**Default Wiring Template** stages the former wiring example:

| Function | GPIO | MIDI |
| --- | --- | --- |
| Switches 1–8 | 6, 7, 15, 16, 1, 2, 4, 5 | Channel 1, CC 20–27 |
| Pots 1–4 | 8, 12, 13, 11 | Channel 1, CC 10–13 |
| Encoder A/B | 18, 17 | Channel 1, CC 30 |
| Encoder push | 21 | Channel 1, CC 31 |
| NeoPixel strip | 48, 8 pixels | RGB feedback |

Confirm only if the wiring matches. Then use **Use Board Controls** to recover
missing logical controls, assign actions and arrange Layout. Existing matching
legacy MIDI mappings are reused when possible.

Controller profiles version 2 include the last verified/adopted wiring. Older
version-1 profiles still load. Loading a profile or restoring an application
backup never silently drives the board's pins: **Review Saved Wiring** explicitly
stages the profile's wiring for confirmation. Read Board only reads; Use Board
Controls recovers logical controls without changing firmware configuration.

Remove Control stages removal of its physical wiring (including a paired push
when deleting an encoder), then removes the logical control after verified save.
Remove Wiring keeps the logical control but frees its GPIO assignment. Clear
Board Wiring stages an empty board; it requires confirmation and leaves USB
setup available. It does not erase application presets.

Invalid saved records fall back to the previous valid board configuration, or an
empty setup if neither record is valid. USB stays available because setup never
assigns its pins. If Pi-MFX stops midway through setup, Read Board discards any
abandoned unsaved draft; adopt or restore the desired configuration afterwards.
If communication is unavailable, the board also abandons setup after 90 seconds.
A reported save timeout
can mean the board saved successfully but its reply was lost: always read back.

Generic MIDI controllers and old firmware retain MIDI-message Learn. They do not
support physical GPIO discovery. Application rollback to v0.6.3 retains this
firmware's normal CC/relative-encoder messages, but cannot edit its wiring.
