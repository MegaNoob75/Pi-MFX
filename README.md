# Pi-MFX

**An original guitar multi-effects pedalboard for the Raspberry Pi 5.**

Pi-MFX turns a dedicated, headless Raspberry Pi 5 into a low-latency guitar
processor: an in-process LV2 effect chain (including NAM captures and cabinet
impulse responses) driven from a touchscreen, tablet, phone, or PC browser, with
an optional DIY footswitch controller you build and wire yourself.

- **Lowest latency is the point.** Direct ALSA `hw:` mmap access from one
  realtime thread. No JACK, no PipeWire, no extra process hop.
- **Your audio hardware.** USB class-compliant interfaces and I2S audio HATs are
  both first-class.
- **No floorboard required.** A browser on the LAN is a complete control surface.
- **Build any controller you can wire.** Switches, buttons, pots, sliders,
  expression pedals, encoders, and optional mono or RGB LEDs — mapped in the UI,
  not hardcoded in firmware.
- **Original code.** Not a PiPedal or MODEP fork. See [NOTICE.md](NOTICE.md).

## Status

Early development. The repository is organised by the phases in the project
plan; see [Roadmap](#roadmap).

## Hardware

| Part | Notes |
| --- | --- |
| Raspberry Pi 5 | Dedicated to Pi-MFX. Headless Raspberry Pi OS 64-bit. |
| Audio interface | USB class-compliant **or** an I2S HAT (HiFiBerry, Audio Injector, IQaudIO, ...). Needs a real instrument input. |
| Display | Optional touchscreen for kiosk mode. Any browser works instead. |
| Foot controller | Optional. ESP32-S3 DevKit + your switches/pots/LEDs. See [docs/DIY_CONTROLLER.md](docs/DIY_CONTROLLER.md). |

Pi 5 has no analog audio output and HDMI is not a guitar path, so an interface
or HAT is required.

## Latency

Latency is treated as a product requirement, not a tuning afterthought.

- Sample rate, period size (frames), and period count are user settings —
  for example **44100 Hz / 64 frames / 3 periods**, or 32 × 2 on hardware that
  allows it.
- The UI shows the measured round trip and the xrun count, so the number on
  screen is real rather than theoretical.
- `scripts/install.sh` hardens the OS for audio (governor, RT limits, PipeWire
  masked). It deliberately does **not** isolate CPU cores by default, because
  NAM and similar plugins use worker threads.

Details and every OS change are documented in [docs/LOW_LATENCY.md](docs/LOW_LATENCY.md).

## Install

On the Pi:

```bash
git clone https://github.com/<your-account>/Pi-MFX.git
cd Pi-MFX
sudo ./scripts/install.sh
```

Then open `http://<pi-address>:8080` from any browser on the network. Full
instructions, including audio HAT overlays and kiosk mode, are in
[docs/INSTALL.md](docs/INSTALL.md).

## Repository layout

| Path | Contents |
| --- | --- |
| `engine/` | C++17 audio engine: ALSA backend, LV2 host, control server |
| `ui/` | Vite + React browser UI |
| `firmware/` | ESP32-S3 USB-MIDI controller firmware (PlatformIO) |
| `scripts/` | `install.sh`, `uninstall.sh`, OS hardening |
| `systemd/` | `pimfx.service` |
| `docs/` | Install, low latency, DIY controller, protocol, licenses |
| `licenses/` | Verbatim third-party license texts |

## Development

The engine builds on Linux against ALSA and lilv. On Windows or macOS it builds
with a mock audio backend so the control protocol and UI can be developed off
the Pi.

```bash
# engine
cmake -S engine -B engine/build -DCMAKE_BUILD_TYPE=Release
cmake --build engine/build

# ui
cd ui
npm install
npm run dev
```

## Roadmap

1. **Phase 1** — ALSA thru with rate/frames/periods UI, round-trip and xrun
   meters, OS hardening scripts.
2. **Phase 2** — LV2 host, serial chain, preset JSON.
3. **Phase 3** — Full UI: Performance, Banks, Editor, Settings, Theme, Keyboard.
4. **Phase 4** — DIY controller firmware and Hardware Setup.
5. **Phase 5** — Snapshots, NAM/IR library, TONE3000 integration, image polish.

## License

MIT — see [LICENSE](LICENSE). Credits and third-party notices are in
[NOTICE.md](NOTICE.md).
