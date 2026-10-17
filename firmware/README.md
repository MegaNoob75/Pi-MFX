# Pi-MFX ESP32-S3 firmware

Firmware sketch for the USB-MIDI floorboard. For a blank ESP32-S3, the setup
menus provide **option 5 — First-time ESP32-S3 installation over USB** after
Pi-MFX is installed. This builds and flashes through the Pi without Arduino IDE;
the new path still needs physical validation. Arduino IDE remains an alternative.

- Sketch: [`esp32s3/PiMFX_Controller/PiMFX_Controller.ino`](esp32s3/PiMFX_Controller/PiMFX_Controller.ino)
- How to flash and wire: [`../docs/DIY_CONTROLLER.md`](../docs/DIY_CONTROLLER.md)
- SysEx: [`../docs/CONTROLLER_PROTOCOL.md`](../docs/CONTROLLER_PROTOCOL.md)

The current sketch reports universal firmware **1.1** for direct-wired
**ESP32-S3 DevKitC-1** controllers. It uses Control Surface and Adafruit NeoPixel,
installed automatically by the script's pinned Arduino CLI toolchain, plus the
ESP32 core's Preferences storage. Arduino IDE users install those libraries
manually. Firmware numbering restarted after the earlier 2.x images.

Flash once, then configure switches, analog controls, encoder turns/pushes and
NeoPixel wiring entirely in Pi-MFX Hardware Setup. Learn discovers eligible GPIO
inputs; confirm the proposed connection to save it on the board. There is no
enclosure-specific pin header. A new board starts empty with no configured
outputs. The Default Wiring Template restores the former wiring example.

Hardware Setup can read the board, recover logical controls, select pins
manually, calibrate analog inputs, set encoder detents/debounce, test pixels and
explicitly restore saved wiring. Configuration is retained across power loss.
The image supports 32 input records and one GRB/RGB NeoPixel strip of up to 127
pixels, subject to available pins. Expansion modules, arbitrary displays, plain
LED outputs and other ESP32 families require additional drivers/images.

Pi-MFX updates build newer bundled controller source on the Pi and transfer
it over USB-MIDI. Legacy images without a MIDI update receiver need one initial
USB installation using option 5 or Arduino IDE with an OTA partition scheme. See
[firmware updates](../docs/CONTROLLER_FIRMWARE_UPDATES.md) for setup and recovery.
This implementation has not
been compiled, flashed or tested on hardware in the Windows implementation
session. Follow [controller validation](../docs/CONTROLLER_VALIDATION.md) on the
Pi and physical controller before relying on it.
