# Features

Pi-MFX is a headless guitar multi-effects system for a dedicated Raspberry Pi 5.

## Audio

- Direct ALSA `hw:` capture and playback from one realtime thread
- USB class-compliant interfaces and I2S HATs
- User-set sample rate, period size, and period count
- Measured round-trip latency and xrun count in **Settings → System → Audio**
- OS hardening (governor, RT limits, PipeWire masked) from `scripts/pimfx.sh`

## Effects

- In-process LV2 host (serial chain)
- NAM captures and cabinet IRs through plugins you install
- **Plugins** installs LV2 packages from Raspberry Pi OS, recommended GitHub
  packs, and PatchStorage
- Hide unused plugins without uninstalling apt packages
- Per-preset I/O, bypass, and parameter assignment

## Banks, presets, snapshots

- Banks of presets with NEW bank / NEW preset
- Snapshot manager and snapshot mode on Performance
- Snapshot tiles are part of the freeform layout

## Performance and layout

- Freeform Performance stage: bank, preset, status, analog, and switch widgets
- Named layout files under `/var/lib/pimfx/layouts/`
- **SAVE LAYOUT** writes the current named file (or creates `default`) and
  syncs the live controller so the Pi and floorboard match
- **SAVE AS** / **LOAD** use the same sync, including widget groups
- Groups persist with the named file and `controller.json`

## Library and files

- Model Library for TONE3000 NAM / AIDA-X / IR downloads
- **Files** browser for local NAM, AIDA-X, and IR folders
- TONE3000 API key lives in **Settings → Model Library**

## Controller

- Optional ESP32-S3 USB-MIDI floorboard
- Hardware Setup maps switches, pots, sliders, expression, encoders, LEDs
- Layout is visual only; actions stay in Hardware Setup / the preset

## System

- Wi-Fi join and **PI-MFX** hotspot from **Settings → System → WIFI / HOTSPOT**
- **Settings → System → Updates** checks git and rebuilds on the Pi
- Themes, on-screen keyboard, backup/restore
- Optional 7" 1024×600 kiosk, boot logo, and faster boot

## Network

The UI is an unauthenticated control surface. Anyone on the same LAN or
hotspot can change presets, audio, and system settings. Put the Pi on a
trusted network.
