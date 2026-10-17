# Pi-MFX controller protocol

USB-MIDI connects the Pi engine to the optional floorboard. Normal performance
input remains CC messages. Universal ESP32-S3 firmware **2.0** adds physical-input
Learn and persistent wiring setup. Application and firmware versions are separate.
The authoritative shared wire definitions and validation rules are in
`firmware/esp32s3/PiMFX_Controller/HardwareProtocol.h`.

## Legacy identity and LED commands

Wrapper: `F0 7D 4D 46 <command> <payload> F7`. MIDI data bytes are seven-bit.
The existing identity request (`01`), identity reply (`10`) and set-LED (`02`)
remain compatible with firmware 1.1. Identity reply payload is:

`major minor controlCountLo controlCountHi ledCountLo ledCountHi rgbFlag`

Firmware 2.0 reports its actual configured counts (zero on a fresh board), not
fixed wiring. The Pi requests identity when connecting and on engine startup.
A recognized firmware major of 2 enables the new handshake; unsupported protocol
or board identifiers are rejected before configuration is accepted.

Legacy set-LED payload: `brightness countLo countHi {index r g b}*`.
RGB and brightness are 0–127. Values scale to 0–255 at the output. Legacy
messages must fit the firmware library's receive buffer.

## Setup transport

Setup wrapper: `F0 7D 4D 46 command tokenLo tokenHi payload F7`.
Tokens and configuration revisions are 14-bit, little-endian base 128. Zero
tokens are reserved. Every configuration message fits in a complete SysEx smaller
than 64 bytes. There is no dependency on a large library SysEx buffer, native
struct layout, JSON parsing in the ESP32, or multipart SysEx callbacks.

| Command | Direction | Payload |
| --- | --- | --- |
| `20` Read | Pi → board | None |
| `21` Learn | Pi → board | expectedRevisionLo/Hi, slot, control record |
| `22` Cancel | Pi → board | None; must match active token |
| `23` Commit | Pi → board | proposedConfigChecksumLo/Hi |
| `24` Begin | Pi → board | expectedRevisionLo/Hi, mode (0 copy / 1 empty) |
| `25` Set | Pi → board | slot, control record |
| `26` LEDs | Pi → board | pin, count, colourOrder |
| `27` Preview | Pi → board | None |
| `28` Test LED | Pi → board | configured pixel index |
| `30` Header | board → Pi | described below |
| `31` Entry | board → Pi | slot, control record |
| `32` End | board → Pi | complete configuration checksumLo/Hi |
| `33` Status | board → Pi | error code |

Header is exactly 22 payload bytes:

`protocol=1 board=1 previewFlag deviceId[12] revisionLo revisionHi ledPin ledCount ledOrder recordCount storageReadyFlag`

Board 1 is the ESP32-S3 DevKitC-1 direct-wiring profile. The stable device ID is
12 uppercase hexadecimal characters derived from the chip ID. It identifies a
physical device; it is not an authentication credential.

A snapshot is Header, one Entry per active record, then End. Record order is
irrelevant. Pi-MFX rejects duplicate slots, incorrect counts, invalid wiring,
wrong identity/token/revision, unsupported formats, malformed payloads and CRC
mismatches. An incomplete snapshot never replaces the last verified state.

## Configuration records and checksum

There are 32 input slots, independent of application control IDs. Each control
record contains exactly 11 seven-bit bytes:

`kind pinA pinB cc channel steps debounce minimumLo minimumHi maximumLo maximumHi`

- Kind: 0 unused, 1 active-low switch, 2 analog input, 3 quadrature encoder.
- `pinB=127` means absent and is required for a non-encoder.
- CC: 0–127; channel: 1–16. Pi-MFX allocates CCs 0–119, avoiding existing
  physical and logical mappings, rather than using channel-mode CCs 120–127.
- Steps: 1–8 quadrature transitions per MIDI increment (default 4).
- Debounce: 5–80 ms (default 20).
- Analog endpoints: 0–4095, increasing and separated by at least 256 counts.
- `ledPin=127, ledCount=0` disables the strip; enabled strips use 1–127 pixels.
  Order 0 is GRB, 1 RGB, at 800 kHz.

Canonical configuration bytes are:

`version=1 ledPin ledCount ledOrder {11-byte record}*32`

Unused records use the default Control values from HardwareProtocol.h; they are
not omitted from the canonical bytes. The CRC is 14-bit, polynomial `0x0805`,
initial zero, MSB first, eight input bits per canonical byte, without a final
XOR. Revisions are excluded from the wire CRC. Persisted board records append a
revision and a CRC covering configuration plus revision. Native padding is never
serialized.

Only allowlisted direct pins can be assigned. Firmware and Pi-MFX reject shared
pins (including LED/input conflicts), illegal ADC inputs and duplicate CC/channel
addresses. Board limits are resource limits, not limits on Pi-MFX logical controls.

## Discovery, staging and confirmation

Read never changes saved wiring. It cancels an abandoned unsaved transaction so
a restarted host can recover immediately. Begin/Set/LEDs/Preview create a draft;
Preview validates it and returns a candidate snapshot with previewFlag=1.
Learn also creates a draft based on the expected revision, scans eligible pins
not owned by other inputs/outputs, and proposes only the selected record.

Discovery uses a baseline interval, switch debounce, analog movement/noise
qualification and quadrature sequence evidence. More than one qualifying analog
or switch input, or more than two encoder inputs, is rejected. Encoder discovery
expects clockwise movement and normalizes that direction. Analog discovery uses
a weak pulldown while scanning unassigned ADC pins to reduce floating-input
candidates. It still requires physical validation; manual selection is provided
for noisy, high-impedance or ambiguous circuits.

A proposed connection is not saved merely because it was detected. Pi-MFX checks
the proposed snapshot, shows the before/after wiring, and sends Commit only after
confirmation. Commit requires the same token and the reviewed configuration CRC.
The firmware writes one complete versioned NVS record, checks persistent readback,
then changes active wiring and returns a normal snapshot at the next revision.
Pi-MFX updates mappings and its backup copy only after matching that snapshot.
A reboot uses the saved configuration without any automatic Pi-side rewrite.

The previous valid configuration is retained separately. An invalid current
record falls back to the previous valid record or empty setup. USB/boot/memory
pins are never configured; a new/empty board remains reachable for setup.

Performance input and normal LED updates pause during setup. Firmware abandons
transactions after 90 seconds without activity; Pi-MFX bounds reply/discovery/
review waits. Errors invalidate host readiness until another Read. A missing
Commit reply is ambiguous: the board may have saved, so always Read before
retrying. Read also recovers an abandoned transaction after the Pi restarts.

Errors: 1 invalid, 2 pin/address conflict, 3 persistent storage/readback failure,
4 timeout, 5 ambiguous discovery, 6 stale revision/token, 7 busy.

## Bounded LED frames

Firmware 2.0 uses command `29` with the legacy wrapper (no setup token):

`brightness flags count {index r g b}*`

Count is at most 24. Flag bit 0 clears the frame first; bit 1 shows it after the
last chunk. This keeps each message below 128 bytes even for long strips. Test
LED uses a setup-wrapped `28` packet, temporarily shows one configured pixel at
low brightness, and ignores theme frames for 1.5 seconds. Missing final chunks
never display a partially assembled frame. Plain/discrete LED outputs are not
implemented by this firmware.

## Mapping, profiles and compatibility

Ordinary controller input is CC 0/127 for switch state, 0–127 for analog, and
relative 63/65 for encoder decrement/increment. Every turn, push and analog input
has its own address. Encoders already group transitions; the application's extra
Encoder Pulses per Click should remain 1 with this firmware.

Logical controls retain their own IDs, labels, actions and layout. Their verified
`hardware` metadata records board identity, firmware slot and physical settings.
`boardHardware` retains the last explicitly saved/adopted snapshot for profile
export and application backups. Host performance input is accepted only for a
matching verified record; stale cross-board/profile metadata is not trusted.

Version-2 controller profiles carry wiring; version-1 profiles still import.
Connect, Read, profile load and application restore never push GPIO settings
silently. Use Board Controls explicitly recovers logical controls; Review Saved
Wiring explicitly stages stored connections for a replacement board. Generic
MIDI devices and firmware 1.1 retain ordinary MIDI Learn, including notes and
channels. They do not gain GPIO discovery without compatible firmware.

No extension-module scanning/drivers are advertised by this board profile.
Future expanders or board families need advertised capabilities, driver support,
validation rules and hardware qualification before exposure in the UI.

## Firmware transfer (firmware 2.1+)

USB-MIDI updater protocol 1 is implemented in the sketch's FirmwareUpdate.h.
All frames start `F0 7D 4D 46 command tokenLow tokenHigh` and end `F7`.
Tokens are nonzero 14-bit values. Integers below are little-endian 7-bit groups.

| Command | Payload |
| --- | --- |
| 44 Query | Empty |
| 45 Info | Protocol=1, board=1, firmware major/minor, inactive-slot capacity (28 bits), 12 ASCII device-ID bytes, busy flag |
| 40 Begin | Image length (28 bits), 32 ASCII lowercase MD5 bytes, protocol=1, board=1 |
| 41 Data | Byte offset (28 bits), up to 42 firmware bytes packed into 7-bit groups |
| 42 Finish | Empty; validate full image/digest, select next application, ACK and reboot |
| 43 ACK | Original command, error code, accepted byte count (28 bits) |
| 46 Abort | Empty; cancel the matching active transfer |

Command numbers in the table are hexadecimal. Packing uses one high-bit mask
followed by up to seven low-7-bit bytes; mask bit i restores data byte i's bit 7.
A complete Data frame is at most 60 bytes. The receiver accepts only sequential
offsets, acknowledges a repeated most-recent chunk without rewriting, and aborts
after 30 seconds without a valid active-token request. ACK errors are 1 busy or
bad Begin, 2 capacity, 3 malformed, 4 write/begin, 5 token/state, 6 offset, 7 end
validation. The host must check same-device identity and version after reboot;
a Finish ACK alone is not success. MD5 detects transport corruption, not origin.
See [update setup and validation](CONTROLLER_FIRMWARE_UPDATES.md).
