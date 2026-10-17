# Pi-MFX ESP32-S3 firmware

Arduino IDE sketch for the USB-MIDI floorboard.

- Sketch: [`esp32s3/PiMFX_Controller/PiMFX_Controller.ino`](esp32s3/PiMFX_Controller/PiMFX_Controller.ino)
- How to flash and wire: [`../docs/DIY_CONTROLLER.md`](../docs/DIY_CONTROLLER.md)
- SysEx: [`../docs/CONTROLLER_PROTOCOL.md`](../docs/CONTROLLER_PROTOCOL.md)

The current sketch reports firmware **1.1**. It uses Control Surface and
Adafruit NeoPixel, installed through Arduino IDE. Firmware is not flashed or
updated automatically by an application update. Validate switches, pots,
all encoder turns/pushes, identity, LEDs, and reconnect on the target Pi.
`Pins.h` uses arrays for switches, pots, and encoders; extend those arrays for your
board, flash it, then add/learn the controls in Hardware Setup and place them in
Layout. The stock counts do not impose an application limit.
