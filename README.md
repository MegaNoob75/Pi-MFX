# Pi-MFX

**An original guitar multi-effects and performance workstation for Raspberry Pi 5.**

[![Raspberry Pi 5](https://img.shields.io/badge/Raspberry%20Pi-5-C51A4A?logo=raspberrypi&logoColor=white)](https://www.raspberrypi.com/products/raspberry-pi-5/)
[![LV2](https://img.shields.io/badge/plugins-LV2-6c5ce7)](https://lv2plug.in/)
[![NAM](https://img.shields.io/badge/amp%20models-NAM-e17055)](https://www.neuralampmodeler.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An open-source C++ and React audio-DSP project combining LV2 plugins, Neural
Amp Modeler (NAM) captures, cabinet impulse responses, low-latency ALSA audio,
touchscreen control, backing tracks, a stereo looper, multitrack recording, a
drum machine, and an optional ESP32-S3 MIDI foot controller.

Pi-MFX turns a dedicated, headless Raspberry Pi 5 into a low-latency guitar
processor: an in-process LV2 effect chain (including NAM captures and cabinet
impulse responses) driven from a touchscreen, tablet, phone, or PC browser,
with an optional DIY footswitch controller you build and wire yourself. A
shared musical transport keeps tap tempo, tempo-aware LV2 effects, backing,
looping, recording, and drums on one engine-owned clock.

![Performance at 1024×600](docs/images/performance.png)

- **Lowest latency is the point.** Direct ALSA `hw:` mmap access from one
  realtime thread. No JACK, no PipeWire, no extra process hop.
- **Your audio hardware.** USB class-compliant interfaces and I2S audio HATs
  are both first-class.
- **No floorboard required.** A browser on the LAN is a complete control surface.
- **Build any controller you can wire.** Switches, pots, sliders, expression
  pedals, encoders, and optional LEDs — mapped in the UI, not hardcoded in
  firmware.
- **A complete practice and performance rig.** Import set lists, record a
  stereo loop, capture multitrack projects, program drum patterns, and browse
  the reviewed Community Presets catalog without leaving the touchscreen UI.

Anyone on the same local network or hotspot can open the UI and control the Pi.
There is no login on the LAN HTTP or WebSocket APIs.

## Documentation

| | |
| --- | --- |
| [User guide](docs/USER_GUIDE.md) | How to use every screen |
| [Screenshots](docs/SCREENSHOTS.md) | Current views at 1024×600 (7" LCD) |
| [Features](docs/FEATURES.md) | What Pi-MFX does |
| [Install](docs/INSTALL.md) | First Pi, audio HAT, kiosk, hotspot |
| [Development](docs/DEV_FLOW.md) | PC edit → Pi rebuild loop |
| [Technical](docs/TECHNICAL.md) | Engine, UI, firmware, data files |
| [Low latency](docs/LOW_LATENCY.md) | OS tuning and round-trip |
| [DIY controller](docs/DIY_CONTROLLER.md) | ESP32-S3 floorboard |
| [Controller protocol](docs/CONTROLLER_PROTOCOL.md) | USB-MIDI SysEx |
| [License](LICENSE) · [Notice](NOTICE.md) | MIT, credits |
| [Third-party](docs/THIRD_PARTY.md) · [Plugin licenses](docs/PLUGIN_LICENSES.md) | Linked libraries and LV2 |

## Hardware

| Part | Notes |
| --- | --- |
| Raspberry Pi 5 | Dedicated to Pi-MFX. Headless Raspberry Pi OS 64-bit. |
| Audio interface | USB class-compliant **or** an I2S HAT (HiFiBerry, Audio Injector, IQaudIO, …). Needs a real instrument input. |
| Display | Optional 7" 1024×600 touchscreen for kiosk mode. Any browser works instead. |
| Foot controller | Optional. ESP32-S3 DevKit + your switches/pots/LEDs. See [docs/DIY_CONTROLLER.md](docs/DIY_CONTROLLER.md). |

Pi 5 has no analog audio output and HDMI is not a guitar path, so an interface
or HAT is required.

## Install

On the Pi, clone the public repository over HTTPS:

```bash
git clone https://github.com/MegaNoob75/Pi-MFX.git
cd Pi-MFX
sudo bash ./scripts/pimfx.sh
```

Then open `http://pimfx.local:8080` (or `http://<pi-address>:8080`) from any
browser on the network. Full instructions, including audio HAT overlays and
kiosk mode, are in [docs/INSTALL.md](docs/INSTALL.md).

To update, choose **Main**, **Dev**, or **Workstation** under
**Settings → System → Updates**, run `sudo bash ./scripts/pimfx.sh update
--branch <name>` on the Pi, or use **`pimfx.cmd` item 3** from Windows. The
screens shown in this repository are from the current `workstation` feature
set. Day-to-day editing from a PC is described in
[docs/DEV_FLOW.md](docs/DEV_FLOW.md) (double-click `pimfx.cmd`; login is stored
only in gitignored `.pimfx-remote`).

## License

MIT — see [LICENSE](LICENSE). Credits and third-party notices are in
[NOTICE.md](NOTICE.md).
