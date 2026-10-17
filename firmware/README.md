# Pi-MFX ESP32-S3 firmware

Arduino IDE sketch for the USB-MIDI floorboard.

- Sketch: [`esp32s3/PiMFX_Controller/PiMFX_Controller.ino`](esp32s3/PiMFX_Controller/PiMFX_Controller.ino)
- How to flash and wire: [`../docs/DIY_CONTROLLER.md`](../docs/DIY_CONTROLLER.md)
- SysEx: [`../docs/CONTROLLER_PROTOCOL.md`](../docs/CONTROLLER_PROTOCOL.md)

The current sketch reports universal firmware **2.1** for direct-wired
**ESP32-S3 DevKitC-1** controllers. It uses Control Surface and Adafruit NeoPixel,
installed through Arduino IDE, plus the ESP32 core's Preferences storage.

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
it over USB-MIDI. Firmware 2.0 and earlier need one manual upload of the current
sketch with an OTA partition scheme to enable this. See
[firmware updates](../docs/CONTROLLER_FIRMWARE_UPDATES.md) for setup and recovery.
This implementation has not
been compiled, flashed or tested on hardware in the Windows implementation
session. Follow [controller validation](../docs/CONTROLLER_VALIDATION.md) on the
Pi and physical controller before relying on it.
