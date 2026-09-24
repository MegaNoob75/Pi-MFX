# Features

Pi-MFX is a headless guitar multi-effects and performance workstation for a
dedicated Raspberry Pi 5. The browser UI is designed for a 1024×600 touchscreen
but also works from phones, tablets, and computers on the same trusted network.

## Audio and effects

- Direct ALSA `hw:` capture and playback from one realtime thread
- USB class-compliant interfaces and I2S HATs
- User-selected input channel, sample rate, period size, and period count
- Measured driver round-trip latency, live meters, and XRun diagnostics
- In-process serial LV2 chain with bypass, input/output gain, and generic LV2 controls
- NAM, AIDA-X, and cabinet-IR file properties for compatible plugins
- Live, nonpersistent control and model audition followed by explicit persistence
- Tempo-link controls for compatible time-based effects

## Banks, presets, snapshots, and community

- Reorderable banks and presets with drag-and-drop between banks
- Per-preset chain, tempo, controller assignments, input/output, and snapshots
- Six-slot snapshot manager plus a dedicated Performance snapshot layout
- Reviewed Community Presets catalog with dependency plans and provenance
- Share Preset manifest creation without putting GitHub credentials on the Pi

## Performance and navigation

- Freeform Performance stage with status, meters, switches, pots, sliders, and encoders
- Named layout files, groups, resizing, pixel snapping, and separate snapshot layout
- Up to five shortcuts on each side of the header
- Reorderable navigation drawer and shared focus for touchscreen or physical encoder
- Full-screen tuner with reference frequency and mute/dry-passthrough behavior

## Musical workstation

- Engine-owned shared transport: BPM, tap history, time signature, count-in,
  metronome, sample position, and LV2 time-position delivery
- Backing-track import for WAV, FLAC, MP3, and Ogg, with metadata, waveform,
  seeking, loop region, set lists, and independent level
- One stereo looper with free/beat/bar operation, count-in, overdub, undo/redo,
  mute, save, export, and a saved-loop library
- Multitrack recorder for raw/processed guitar, backing, drums, and master,
  with projects, arming, mute/solo, level/pan, takes, and export
- Drum machine with user samples, kits, 16/32/64-step patterns, velocity,
  accents, swing, humanization, fills, four variations, and song chains
- Hardware actions and visible states for transport, backing, looper, recorder,
  drums, tuner, banks, presets, snapshots, and effects

## Models, plugins, and files

- TONE3000 catalog and authenticated downloads into the local model library
- Two-pane file manager for NAM, AIDA-X, IR, backing, drum, and related assets
- LV2 plugin inventory, hide/unhide, rescan, Raspberry Pi OS packages,
  recommended GitHub packs, and PatchStorage browsing
- Dependency-impact checks before deleting library content

## Controller and interface

- Optional ESP32-S3 USB-MIDI floorboard
- Learn and mapping for momentary/latching switches, pots, sliders, expression
  pedals, encoders, encoder buttons, and LEDs
- Custom themes, on-screen keyboard modes, interface feel, and backup/restore
- Multiple connected UIs share navigation and editor session state

## System

- Wi-Fi join and PI-MFX hotspot control
- In-app branch-aware updates for `main`, `dev`, and `workstation`
- Reboot/shutdown controls, audio-thread status, memory-lock and latency diagnostics
- Optional touchscreen session, boot logo, quiet boot, and OS realtime tuning

## Network and validation boundary

The LAN HTTP and WebSocket APIs do not have a login. Anyone on the same LAN or
hotspot can control audio and system settings, so use a trusted network.

Implementation in the repository is not the same as Raspberry Pi sign-off.
Actual audio formats, LV2 plugins, touch/encoder behavior, CPU load, latency,
storage performance, and XRuns must be validated on the target Pi.
