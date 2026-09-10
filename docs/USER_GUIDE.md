# User guide

Open `http://pimfx.local:8080` (or the Pi’s IP on port 8080) from a phone,
tablet, PC, or the optional 7" kiosk. Anyone on that LAN or hotspot can control
the board — there is no login.

Tap **PI-MFX** in the top-left for the menu. The title in the header is the
current page. The status dot is green when the engine is connected and audio is
running.

## Performance

![Performance](images/performance.png)

The gig screen. Current bank and active preset sit in the header; the rest is
the freeform layout from **Settings → Layout** (bank/preset widgets, meters,
switches, pots). Tap a switch to fire its action. Snapshot mode replaces the
switch grid with snapshot tiles (arranged in Layout → Snapshots):

![Snapshot tiles](images/layout-snapshots.png)

BANK±, PRESET±, BYPASS, SNAPS, TAP, and similar live as **layout widgets** or
switch actions, not as a second chrome row.

## Banks / Presets

![Banks / Presets](images/banks.png)

Pick the current bank and preset. Create a **NEW** bank or preset, rename,
reorder, and delete. The active preset is what Performance and the Editor
show.

## Preset Editor

![Preset Editor](images/editor.png)

The signal chain is a serpentine row: tap an effect to edit it, drag to
reorder, tap **+** between plugins to insert. The picker lists LV2 plugins
already on the Pi. If it is empty, install from **Plugins**, then rescan.

From the chain you can open **Snapshots** for this preset.

## Snapshots

![Snapshots](images/snapshots.png)

Named captures of the current chain (bypass and parameters). Create, rename,
recall, and delete. Snapshot **tiles** on Performance are arranged in Layout →
Snapshots; Hardware Setup chooses which footswitch recalls each slot.

## Model Library

![Model Library](images/library.png)

Download NAM, AIDA-X, and IR files from TONE3000 after signing in under
**Settings → Model Library**. Files land in the Pi library and show up on
effects that take a capture or IR.

## Plugins

![Plugins — Installed](images/plugins-installed.png)

**INSTALLED** lists LV2 plugins the engine can see. Hide ones you do not want
in the Editor picker.

![Plugins — Install](images/plugins-install.png)

**INSTALL** adds Raspberry Pi OS packages, recommended GitHub packs, and
PatchStorage builds. Plugins keep their own licenses; see
[PLUGIN_LICENSES.md](PLUGIN_LICENSES.md).

## Files

![Files](images/files.png)

Browse NAM, AIDA-X, and IR folders on the Pi. Upload and delete files used by
the library and by plugin file buttons.

## Settings

![Settings hub](images/settings.png)

Hub for Controller, Theme, Keyboard, PI-MFX UI, Model Library, and System.

### Controller

![Controller](images/controller.png)

MIDI device, layout shortcut, hardware diagnostics. **Hardware Setup** adds
switches, pots, sliders, expression pedals, and encoders, and assigns actions
(preset up/down, bypass, tap, snapshot mode, parameter, …):

![Hardware Setup](images/hardware.png)

### Layout

![Layout — Performance](images/layout.png)

Freeform stage for Performance widgets and analog controls. Drag to move,
use corner handles to resize. **SNAP** quantizes to pixels.

- The title shows the current file (`PERFORMANCE LAYOUT · default`).
- **SAVE LAYOUT** writes that named file (or creates `default` if none) and
  pushes the same arrangement to the live controller (PC, Pi, and floorboard).
- **SAVE AS** picks a new name, then does the same sync.
- **LOAD** applies a file (including groups) and syncs the controller.
- Groups: add a group, select widgets, **ADD TO GROUP**. Groups are stored in
  the named file and in `controller.json`.

Snapshot tiles have their own stage:

![Layout — Snapshots](images/layout-snapshots.png)

Unhiding a control shrinks it into leftover space so four pots can sit beside
status widgets. If there is no gap, make one first.

### Theme, Keyboard, PI-MFX UI

![Theme](images/theme.png)

Built-in and custom themes, import/export.

![Keyboard](images/keyboard.png)

On-screen keyboard mode and overlay look.

![PI-MFX UI](images/ui.png)

Backup/restore and interface options.

## System

![System hub](images/system.png)

### Audio

![Audio](images/audio.png)

Pick the USB interface or I2S HAT, then sample rate, period size, and period
count. Start at 48000 / 64 / 3. The round-trip number is measured from the
driver. Reset xruns, play hard, then step down only if the count stays at zero.
Details: [LOW_LATENCY.md](LOW_LATENCY.md).

### Wi-Fi / Hotspot

![Wi-Fi / Hotspot](images/hotspot.png)

Join a home network or raise the **PI-MFX** access point for a gig tablet.
Join the hotspot, then open the URL shown on the page (often
`http://10.42.0.1:8080`). The Pi radio cannot be an access point and a station
at once.

### Updates

![Updates](images/updates.png)

Check git on this Pi and rebuild. Same job as `sudo bash ./scripts/pimfx.sh update`.
Banks and settings in `/var/lib/pimfx` are not touched.

### Realtime

![Realtime](images/realtime.png)

Audio thread, memory lock, and diagnostics.

## About

![About](images/about.png)

Version, engine backend, plugin count.

![About / Legal](images/about-legal.png)

MIT license, third-party libraries, TONE3000 / NAM credits, and the LAN
no-login notice.

## Optional hardware

Touchscreen kiosk, boot logo, and DIY floorboard: [INSTALL.md](INSTALL.md)
and [DIY_CONTROLLER.md](DIY_CONTROLLER.md).
