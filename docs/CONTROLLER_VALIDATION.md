# Universal controller validation

Status: **NOT RUN**. Source implementation only. No Windows compilation,
firmware upload, deployment or runtime tests were performed in this change.
The user will compile and validate on the Pi 5 and physical ESP32-S3 controller.
Application fallback: the user-created **v0.6.3** tag. Keep an exported backup and
controller profile before changing the live installation.

## Build and protocol regression tests on the Pi

From the repository root, use your normal native build workflow with
`BUILD_TESTING=ON`. The added CTest test is `controller_hardware`.
For an isolated test build, the equivalent commands are:

```sh
cmake -S engine -B build-controller -DBUILD_TESTING=ON
cmake --build build-controller --target pimfx_controller_hardware_test -j2
ctest --test-dir build-controller -R '^controller_hardware$' --output-on-failure
```

This tests GPIO/address/range validation, canonical encoding/CRC, stale and
malformed replies, confirmation before host persistence, verified save/readback,
storage failure, adoption, profile roundtrip/replacement, template and removal,
and the legacy MIDI Learn path. It does not prove electrical discovery or USB
transport, Arduino compilation, NVS power-loss behaviour, or LED timing.

Build the application/UI with your normal Pi workflow. Compile the Arduino sketch
for ESP32S3 Dev Module with USB-OTG (TinyUSB), CDC disabled, Control Surface and
Adafruit NeoPixel installed. The protocol header stays inside the sketch folder.

## Physical checks

Record PASS/FAIL plus board revision, firmware/library versions and observed
behaviour for each row. The following rows are all **NOT RUN**.

| Check | Expected result |
| --- | --- |
| Fresh firmware / erased NVS | USB-MIDI enumerates; identity matches current source (1.1), including wiring/guided-analog capability bits; no inputs or outputs assigned; Read Board succeeds |
| Existing NVS after power cycle | Same pins, CCs, calibration and LED setup without a Pi configuration upload |
| Add Momentary → Learn | Wait one second, press/hold; only correct GPIO is proposed; no preset/action during setup |
| Cancel discovery and cancel candidate | Active configuration and host mapping remain unchanged |
| Confirm candidate | Saved on Controller appears only after NVS verification and matching readback |
| Relearn same switch | Its own pins can be rediscovered; other configured inputs remain untouched |
| Relearn after host wiring metadata was lost | A unique matching board MIDI address reuses the original slot and pin; cancel preserves host settings; confirm restores the wiring record |
| Edit actions/layout after a verified board save | A stale browser snapshot cannot clear saved wiring or replace board-assigned MIDI addresses |
| Add Latching | Toggle input learns; subsequent on/off follows physical state; inspect initial/reconnect state |
| Add Pot / Slider / Expression (guided-capable firmware, including current 1.1) | Set Minimum, slowly turn to maximum, Set Maximum, review, save; verify live 0–127 endpoints and smooth movement |
| Guided calibration timing and retry | Pause at either position without auto-finishing; each step allows three minutes; too-small range stays on maximum with retry; Cancel leaves all saved wiring unchanged |
| 7-inch Wiring & Recovery | Full-area Control/LEDs/Saved Wiring/Recovery sections; several wiring rows visible; one main scroller; calibration prompts/capture and cancel remain reachable |
| Analog noise / floating inputs | Keep other controls still; no spurious candidate; ambiguity/timeouts produce useful messages; manual fallback works |
| Add Encoder | Turn clockwise at least four detents then stop; both correct A/B pins proposed; one menu step per detent in both directions |
| Encoder push | Learn Button separately; press/hold/double behaviour and paired Select work |
| Mixed activity during Learn | Two switches/analog inputs or more than two encoder inputs are rejected rather than arbitrarily assigned |
| Manual input assignment | Legal free pins accepted; USB 19/20, boot/memory/UART and non-ADC analog pins rejected |
| Pin and CC conflicts | Existing input/output pins cannot be reused without removing previous wiring |
| Encoder steps 1/2/4/8 | Appropriate grouping for the actual encoder; extra app pulses per click remains 1 |
| Debounce 5–80 ms | No bounce double firing; hold and double tap remain application actions |
| LED strip configuration | Pin/count/order read back exactly; 0 count disables; strip/input conflict rejected |
| Test Pixel | Correct zero-based pixel flashes white briefly, then normal theme/performance feedback resumes |
| More than 24 pixels | Chunked LED frames update together without truncated SysEx or half frames |
| Remove Wiring | Board pin freed only after confirmation; logical control remains unlearned |
| Remove Control / encoder pair | Board records and logical controls removed together only after verified save |
| Disable encoder push | Only push record removed; rotation and remaining controls keep working |
| Default template | Before/after preview matches documented pins; after save, Use Board Controls recovers correct logical inputs |
| Read / Use Board Controls | Read is read-only; adoption is idempotent and reuses compatible legacy logical mappings |
| Save/load version-2 profile | Wiring and feel roundtrip; load does not drive pins; Review Saved Wiring explicitly applies connections |
| Import version-1 profile | Legacy mapping import works; missing board wiring is handled honestly |
| Replacement ESP32 / another Pi | Stable device ID prevents stale mappings; Read/Use Board Controls or explicit restore recovers desired setup |
| Unplug during discovery/candidate | No partial configuration saved; timeout/error; reconnect/read recovers |
| Unplug during Commit | Read Board reveals whichever complete record survived; host does not claim success from a missing reply |
| Restart Pi-MFX with board powered | Identity request detects firmware; board wiring is read without relying on boot announcements |
| Abandoned setup / server restart | Read cancels an unsaved draft immediately; without communication, board releases setup after 90 seconds |
| Power interruption during NVS write | Current complete record, previous valid record, or safe empty mode; USB setup always accessible |
| Clear Board Wiring | Confirmation required; inputs and LEDs cleared; USB setup and application presets remain available |
| Generic commercial MIDI controller | Existing CC/note Learn still works; physical GPIO controls are not offered |
| Legacy 1.x firmware without capability bits | Existing MIDI Learn still works; firmware notice explains that physical GPIO discovery requires the current universal image; option 5 or Arduino IDE provisions its receiver |
| 7-inch touchscreen and browser together | Large usable targets, shared setup state/confirmation, scrollable review and advanced settings |

Do not claim universal/controller completion from protocol tests alone. If Learn
cannot reliably distinguish the real wiring, keep the failed state and record
candidate pins, movement and timing before resetting. Fix discovery rather than
masking a false candidate with defaults.
