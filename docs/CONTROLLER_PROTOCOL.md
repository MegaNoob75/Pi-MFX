# Pi-MFX controller protocol

USB-MIDI between the Pi engine and a DIY floorboard. Manufacturer byte `0x7D`
(non-commercial / educational) plus `'M'` `'F'` so other `0x7D` devices on the
same bus are ignored.

This is **not** the earlier MultiFX SysEx (`7D 4D 46 58` plus profile/config
commands). A MultiFX-flashed board will still send ordinary CC, but identity
and RGB LEDs only work with Pi-MFX firmware.

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
custom firmware does not need this table.

## Device name

USB product string should contain `Pi-MFX`, `pimfx`, or `esp32` so the engine
can pick the port automatically when Hardware Setup leaves the port blank.
