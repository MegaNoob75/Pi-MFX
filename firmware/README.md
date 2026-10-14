# Pi-MFX ESP32-S3 firmware

Arduino IDE sketch for the USB-MIDI floorboard.

- Sketch: [`esp32s3/PiMFX_Controller/PiMFX_Controller.ino`](esp32s3/PiMFX_Controller/PiMFX_Controller.ino)
- How to flash and wire: [`../docs/DIY_CONTROLLER.md`](../docs/DIY_CONTROLLER.md)
- SysEx: [`../docs/CONTROLLER_PROTOCOL.md`](../docs/CONTROLLER_PROTOCOL.md)

The current sketch reports firmware **1.1**. It uses Control Surface and
Adafruit NeoPixel, installed through Arduino IDE. Firmware is not flashed or
updated automatically by an application update. Validate switches, pots,
encoder/push, identity, LEDs, and reconnect on the target Pi before signing off
the application release; see [`../docs/V1_READINESS.md`](../docs/V1_READINESS.md).
