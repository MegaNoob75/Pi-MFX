# DIY ESP32-S3 controller

Optional USB-MIDI floorboard for Pi-MFX. Firmware lives in this repo:

```
firmware/esp32s3/PiMFX_Controller/PiMFX_Controller.ino
```

Flash the sketch in this repository so the engine can identify the board and
drive RGB LEDs. Protocol details: [CONTROLLER_PROTOCOL.md](CONTROLLER_PROTOCOL.md).
The checked-in firmware reports **1.1**. Firmware protocol/version is separate
from the planned Pi-MFX application release **1.0.0**; this documentation
review did not flash or validate a controller.

## What you need

- ESP32-S3 DevKitC-1 (use the port labelled **USB**, not UART)
- Footswitches to ground (active-low; firmware enables pull-ups)
- Optional pots between 3.3 V and GND
- Optional WS2812 / NeoPixel strip on GPIO 48
- Arduino IDE 2 with the Espressif **esp32** core, **Control Surface**
  (by Pieter P), and **Adafruit NeoPixel**

## Flash with Arduino IDE

The sketch will not compile until both libraries are installed.

1. Open `firmware/esp32s3/PiMFX_Controller/PiMFX_Controller.ino`.
2. Board: **ESP32S3 Dev Module**.
3. USB Mode: **USB-OTG (TinyUSB)**. USB CDC on Boot: **Disabled**.
   Hardware CDC and JTAG makes a serial port, not MIDI.
4. Sketch → Include Library → Manage Libraries, then install:
   - **Control Surface** (by Pieter P)
   - **Adafruit NeoPixel** (by Adafruit)
5. Upload.

If the serial port does not appear: hold **BOOT**, tap **RST**, release **BOOT**.

Windows and the Pi should list a MIDI device named something like **ESP32**,
**ESP32S3**, or **TinyUSB**.
If they show a COM / “USB JTAG” serial device instead, USB Mode was wrong:
re-select USB-OTG (TinyUSB) and upload again, then unplug and replug.

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
2. Settings → Controller → Hardware Setup: pick the **ESP32** MIDI device
   (not Midi Through) and press SELECT. Hardware buttons stay dead until
   a device is selected.
3. Add a switch, pot or encoder, press **LEARN**, then use the matching control.
   Encoders also have **LEARN BUTTON** for the built-in click. Reverse a pot or
   encoder in Hardware Setup if it is wired or turning backwards.
4. Assign an encoder’s turn to **Navigate menus** and its click to **Select**
   to scroll lists (menus, banks, presets, themes) and confirm the highlight.
5. Assign presets by holding a Performance tile — not from Hardware Setup.

## Expand the controls

The wiring table is an example, not a Pi-MFX limit. Add entries to `kSwitches`,
`kPots`, and `kEncoders` in `Pins.h` for the controls your board can support.
Each encoder row is `{pinA, pinB, buttonPin, turnCc, buttonCc, stepsPerDetent}`.
Use `-1` for `buttonPin` when no push switch exists. For example:

```cpp
constexpr EncoderControl kEncoders[] = {
    {18, 17, 21, 30, 31, 4}, // stock encoder and push
    {9, 10, -1, 32, 33, 4}, // example extra encoder, no push
};
```

Pins 9/10 are examples only: check they are actually free and usable on your board.
Give every switch, analog control, encoder turn and push a unique CC. The supplied
sketch uses channel 1, with CC numbers 0–127. A custom controller can use other MIDI
channels or notes, which Learn also records. GPIO/ADC capacity, electrical design,
scan speed, USB bandwidth, and expanders remain hardware constraints. Pi-MFX does
not read GPIOs or configure expanders through the Learn button.

Flash the changed firmware. In Hardware Setup add the appropriate logical control,
select Learn Turn, operate the encoder, and separately Learn Button if it has a
push. Repeat for every added control. Learn transfers a reused MIDI address from
its previous owner; two controls need distinct addresses to work independently.
Open Layout to show/place and size the new controls, then save the layout and a
controller profile. Bind preset parameters in Preset Editor. Nothing requires all
encoders to perform navigation; each can control a different assigned parameter.

## Check your controller

On the candidate Pi build, verify all eight switch press/releases, four pots
including endpoints/catch behavior, both encoder directions, encoder push,
hold/double actions, and every RGB LED. Unplug/reconnect the controller and
restart the engine, then confirm mappings and LED states recover. Test the
touchscreen and floorboard together. Include every additional control from your
custom arrays. Review the exact installed library notices
before distributing compiled firmware; see [THIRD_PARTY.md](THIRD_PARTY.md).
