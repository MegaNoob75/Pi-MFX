# DIY ESP32-S3 controller

Optional USB-MIDI floorboard for Pi-MFX. Firmware lives in this repo:

```
firmware/esp32s3/PiMFX_Controller/PiMFX_Controller.ino
```

Do **not** flash the MultiFX Arduino sketch from the other project. That board
uses a different SysEx header, so Pi-MFX cannot identify it or drive RGB LEDs.

Protocol details: [CONTROLLER_PROTOCOL.md](CONTROLLER_PROTOCOL.md).

## What you need

- ESP32-S3 DevKitC-1 (use the port labelled **USB**, not UART)
- Footswitches to ground (active-low; firmware enables pull-ups)
- Optional pots between 3.3 V and GND
- Optional WS2812 / NeoPixel strip on GPIO 48
- [PlatformIO](https://platformio.org/) **or** Arduino IDE 2 with the Espressif
  **esp32** core, **Adafruit TinyUSB**, and **Adafruit NeoPixel**

## Flash with PlatformIO

On the Windows PC, from the Pi-MFX clone:

```text
cd firmware/esp32s3
pio run -t upload
```

If the serial port does not appear: hold **BOOT**, tap **RST**, release **BOOT**.

## Flash with Arduino IDE

The sketch will not compile until both Adafruit libraries are installed.
PlatformIO pulls them automatically; Arduino IDE does not.

1. Open `firmware/esp32s3/PiMFX_Controller/PiMFX_Controller.ino`.
2. Board: **ESP32S3 Dev Module**.
3. USB Mode: **USB-OTG (TinyUSB)**. USB CDC on Boot: **Disabled**.
4. Sketch → Include Library → Manage Libraries, then install:
   - **Adafruit TinyUSB Library** (by Adafruit)
   - **Adafruit NeoPixel** (by Adafruit)
5. Upload.

Windows and the Pi should show a MIDI device named **Pi-MFX Controller**.

## Default wiring (ESP32-S3 DevKitC-1)

Edit `Pins.h` if your enclosure uses different GPIOs, then flash again.

| Function | GPIO | MIDI |
| --- | --- | --- |
| Switch 1–8 | 6, 7, 15, 16, 1, 2, 4, 5 | CC 20–27 |
| Pot 1–4 | 8, 12, 13, 11 | CC 10–13 |
| Encoder A / B / push | 18, 17, 21 | CC 30 relative / CC 31 |
| LED data | 48 | SysEx set-LED |

## On the Pi

1. Plug the ESP32 into the Pi.
2. Settings → Controller → Hardware Setup: enable the floorboard and pick
   **Pi-MFX Controller** (or leave the port blank and let it match by name).
3. Add a switch or pot, press **LEARN**, then use the matching control.
4. Assign presets by holding a Performance tile — not from Hardware Setup.
