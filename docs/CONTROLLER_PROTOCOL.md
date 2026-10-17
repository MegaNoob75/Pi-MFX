# Pi-MFX controller protocol

USB-MIDI between the Pi engine and a DIY floorboard. Manufacturer byte `0x7D`
(non-commercial / educational) plus `'M'` `'F'` so other `0x7D` devices on the
same bus are ignored. Identity and RGB LEDs require the Pi-MFX firmware in this
repository.

The current sketch advertises firmware **1.1**, 14 controls (8 switches,
4 pots, encoder turn and push), 8 LEDs, and RGB support. These are the stock
`Pins.h`/`Protocol.h` values, not negotiated requirements for a custom board.
Application and firmware version numbers are independent.

## SysEx wrapper

```
F0  7D  4D  46  <command>  …payload…  F7
```

MIDI data bytes are seven-bit. 8-bit colours are scaled: `byte * 127 / 255`.

## Commands

| Byte | Direction | Name |
| --- | --- | --- |
| `0x01` | Pi → board | Identity request |
| `0x10` | board → Pi | Identity reply |
| `0x02` | Pi → board | Set LED colours |

### Identity request

```
F0 7D 4D 46 01 F7
```

Sent when the engine opens the MIDI port. The board should reply immediately
and may also announce itself a few times after USB enumerates.

### Identity reply

```
F0 7D 4D 46 10
  <major> <minor>
  <controlCount lo> <controlCount hi>
  <ledCount lo> <ledCount hi>
  <rgb flag>
F7
```

Counts are 14-bit (`lo | (hi << 7)`). RGB flag is `1` when pixels take colour.

### Set LEDs

```
F0 7D 4D 46 02
  <brightness>
  <count lo> <count hi>
  { <pixelIndex> <r> <g> <b> } × count
F7
```

Brightness and RGB are 0–127. Pixel index matches `pixelIndex` on each LED in
Hardware Setup. Missing pixels stay off.

## Performance MIDI (board → Pi)

Not SysEx. Channel 1 unless you change it.

The stock firmware uses:

| Control | Message |
| --- | --- |
| Switches | CC 20–27, 0 released / 127 pressed |
| Pots | CC 10–13, 0–127 |
| Encoder turn | CC 30, 63 = one step CCW, 65 = one step CW |
| Encoder push | CC 31, 0 / 127 |

Learn in the UI captures whatever CC or note the board actually sends, so
custom firmware does not need this table. Hardware Setup can reverse a pot or
encoder in software if it is wired or turning the wrong way.

There is no application control-count limit tied to the stock wiring. Add logical
controls in Layout or Hardware Setup, then Learn in Hardware Setup. Each physical turn/push/pot/
switch needs a distinct message type, channel, and number on the selected input
port. Learn records that address; it does not identify GPIOs or infer control kind.
Relearning an address transfers it from the previous logical owner. MIDI CC and
note numbers are 0–127 on each of 16 channels; the supplied sketch uses channel 1.
Identity counts are descriptive, not a cap and not an auto-discovery of control
types. Firmware must implement any multiplexers/expanders used by the enclosure.

`Pins.h` contains switch, pot, and encoder arrays. Add encoder rows with independent
A/B pins, turn CC, optional push pin/CC, and steps per detent. Use `-1` for a missing
push pin. The identity count is calculated from the arrays, including only pushes
that exist. See [DIY controller](DIY_CONTROLLER.md) for the setup workflow.

## Device name

Use a recognizable USB-MIDI name such as `Pi-MFX`, `pimfx`, or `esp32`.
Enumeration and selection also depend on the available MIDI ports and saved
configuration. Confirm the selected port under Settings → Controller rather
than treating its product name as proof that the controller is connected.
