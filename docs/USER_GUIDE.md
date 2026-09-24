# User guide

Open `http://pimfx.local:8080` (or the Pi's IP on port 8080) from the optional
touchscreen or any phone, tablet, or computer on the same network. There is no
LAN login, so use a trusted network or the dedicated PI-MFX hotspot.

The header title names the current page. The short bar above it is cyan when the
engine is connected and audio is running. Use the back arrow on the right for
the previous page. Tap **PI-MFX** at the upper left for the full drawer:

![Navigation drawer](images/menu.png)

Long-press PI-MFX to unlock navigation editing. Drag drawer rows to reorder
them or into either header shortcut area; lock the drawer when finished. A
touchscreen, mouse, keyboard, and the configured hardware encoder all use the
same navigation focus.

## Performance

![Performance](images/performance.png)

This is the main playing screen. Bank, preset, meters, workstation status,
switches, pots, sliders, and encoders come from **Settings → Layout**. The
controls do what Hardware Setup or the current preset assigns to them.

- Tap a switch for its normal action. Momentary controls may also have hold and
  double-tap actions.
- Turn or drag an analog control for a live preview; releasing it commits the
  value to the active preset or snapshot.
- Use the bank and preset widgets to browse without leaving Performance.
- A modified preset is kept live until you reload, save, change preset, or
  choose how to handle it.

Snapshot mode replaces the normal switch stage with snapshot tiles while
keeping the configured status widgets:

![Performance snapshot mode](images/performance-snapshots.png)

## Tap Tempo and transport

![Tap Tempo](images/transport.png)

Tap **TAP** three or four times, or type a BPM. **PLAY** runs the shared musical
clock; it does not mute or stop the guitar chain. Set the time signature,
count-in, metronome, and beat-synchronized-change preference here. Tempo Link
controls and compatible LV2 plugins follow this transport.

## Backing Tracks

![Backing Tracks](images/backing-tracks.png)

Import WAV, FLAC, MP3, or Ogg files. The player provides play/pause, stop,
restart, seek, level, manual BPM, editable metadata, a waveform, and an optional
loop region. Imported audio is mixed independently after the guitar chain.

Set lists do not duplicate or delete audio files. Create a named set list, add
tracks from **Track Files**, reorder them, then use Previous/Next from the UI or
controller. The buffer indicator should remain **READY**; underruns mean the Pi
could not feed the realtime player in time.

## Looper

![Looper](images/looper.png)

The looper holds one stereo loop. Record, finish into playback, overdub, stop,
restart, mute, undo/redo the current overdub session, or clear after confirmation.
The status strip and waveform make recording and playback state visible.

![Looper options](images/looper-options.png)

**Options** selects free, next-beat, or next-bar operation, count-in, loop level,
and overdub feedback. Save useful loops as WAV files. **Library** loads, exports,
renames, or deletes saved loops:

![Saved loops](images/looper-library.png)

## Recorder

![Recorder](images/recorder.png)

Create a project, arm sources, and record raw guitar, processed guitar, backing,
drums, or the stereo master. The Recorder has four working areas:

- **Record** arms tracks and starts/stops takes, with optional click and count-in.
- **Mix** sets mute, solo, level, and pan without resetting playback.
- **Edit** manages the project timeline and take edits.
- **Files** manages projects, stems, recovery data, and exports.

**Record with Backing** requires a loaded backing track; it rewinds and records
processed guitar and backing as synchronized stems. Watch remaining storage and
write warnings during long sessions.

## Drum Machine

![Drum Machine](images/drum-machine.png)

The Play page controls start/stop, fills, song mode, variation A-D, pattern
length, count-in, level, swing, and humanization.

![Drum pattern editor](images/drum-pattern.png)

On **Pattern**, select a variation or fill and tap the 16-step grid. Repeated
taps set a normal hit, accent, and then off; the step editor gives exact
velocity and accent control. Patterns may be 16, 32, or 64 steps.

![Drum kit](images/drum-kit.png)

**Kit** assigns user WAV samples and per-voice settings. Use Pi-MFX's sample
browser rather than a system file dialog. **Song** chains variations with repeat
counts into a performance arrangement:

![Drum song chain](images/drum-song.png)

## Tuner

![Tuner](images/tuner.png)

Play a single note and tune against the center marker. The Settings tab chooses
chromatic/standard behavior, reference frequency, input filtering, and whether
opening the tuner mutes the processed output or passes dry guitar.

## Banks / Presets

![Banks and Presets](images/banks.png)

Select the current bank and preset, create new entries, rename, reorder, clone,
save, import/export, or delete. Drag an entire preset row to reorder it or move
it into another bank. The active preset is what Performance and Preset Editor
show; the Community holding area is managed by the Community workflow.

## Preset Editor

![Preset Editor](images/editor.png)

The signal chain runs from input to output in a serpentine path. Tap an effect
to edit it, drag cards to reorder, use **+** between nodes to insert a plugin,
and use the card menu to replace, bypass, or remove it. The picker lists LV2
plugins already visible to the engine.

![Preset controls](images/editor-controls.png)

The control page renders generic LV2 metadata: toggles, enumerations, stepped or
continuous values, logarithmic ranges, units, trigger ports, and plugin file
properties. **BIND** assigns a physical control. Highlighting a supported model
file previews it live; **Use** persists it and Cancel restores the original.

![Preset input and output](images/editor-io.png)

Input/output pages hold per-preset gain and guitar-channel choices. Use the
**Snapshots** button in the editor header to open this preset's captures.

## Snapshots

![Snapshots](images/snapshots.png)

A snapshot stores the current chain's bypass and parameter state without
overwriting the base preset. Recall, capture/update, rename, edit, or delete up
to six slots. The Performance snapshot stage is arranged separately under
**Settings → Layout → Snapshots**.

## Community Presets

![Community Presets](images/community-presets.png)

Browse reviewed presets, inspect the author, description, tags, and every
plugin/model/IR requirement, then choose **Review & Install**. Pi-MFX builds an
installation plan before changing anything. Missing trusted dependencies can be
installed through the existing Plugins and TONE3000 paths; unsupported assets
must be supplied manually and are never silently substituted.

![Share Preset](images/community-share.png)

**Share Preset** creates a sanitized declarative manifest from one of your local
presets. It excludes executable content and local absolute paths. Download the
JSON and open the community submission workflow; catalog publication still
requires automated checks and human review.

## Model Library

![Model Library](images/library.png)

Browse local models and the hosted TONE3000 catalog. Sign in under
**Settings → Model Library**, choose a tone and model architecture, then select
a destination folder. Downloads are validated and appear in Files and in
compatible plugin file pickers.

## Plugins

![Installed plugins](images/plugins-installed.png)

**Installed** shows the LV2 plugins the engine can see. Rescan after an external
install, hide plugins you do not want in the picker, or unhide them later.

![Install plugins](images/plugins-install.png)

**Install** combines Raspberry Pi OS packages, recommended GitHub packs, and
PatchStorage. Install helpers work outside the audio callback and report job
progress. Plugins keep their own licenses; see
[PLUGIN_LICENSES.md](PLUGIN_LICENSES.md).

## Files

![Files](images/files.png)

The two-pane manager is rooted inside Pi-MFX's allowed libraries. Browse NAM,
AIDA-X, and IR content; create folders; upload; drag between panes; rename; or
delete after the dependency-impact review. The same browser is reused for
backing tracks, drum samples, and plugin file properties.

## Settings

![Settings hub](images/settings.png)

The hub groups Controller, Theme, Keyboard, PI-MFX UI, Model Library, and System.

### Controller and Hardware Setup

![Controller](images/controller.png)

Choose the USB-MIDI controller, open Hardware Setup, inspect diagnostics, or
restore the default visual layout. Firmware compatibility warnings appear here.

![Hardware Setup](images/hardware.png)

Add momentary/latching switches, pots, sliders, expression pedals, encoders, and
encoder buttons. Learn their MIDI messages, choose tap/hold/double actions, and
bind preset parameters. Workstation actions include transport, tuner, backing,
looper, recorder, and drums.

### Layout

![Performance layout](images/layout.png)

Drag and resize status widgets and hardware controls. Toggle visibility, group
items, match sizes, and choose the snap grid. **Save Layout**, **Save As**, and
**Load** update the named file and the live controller layout.

![Snapshot layout](images/layout-snapshots.png)

The Snapshots stage separately arranges snapshot tiles. It changes appearance,
not the control that recalls each slot; assign that in Hardware Setup.

### Theme, Keyboard, and PI-MFX UI

![Theme Manager](images/theme.png)

Choose a built-in theme or customize colors, typography, control states, and
performance switches. Import/export and save custom themes from this page.

![Keyboard](images/keyboard.png)

Select when the on-screen keyboard appears plus its layout, key size, placement,
and theme.

![PI-MFX UI](images/ui.png)

Set touchscreen/floorboard behavior, encoder feel, pop-out timing, and other
interface preferences. **Backup** exports or restores Pi-MFX configuration:

![Backup](images/backup.png)

### Model Library account

![TONE3000 settings](images/model-library-settings.png)

Configure the publishable key and redirect URL, then sign in or complete the
OAuth callback manually. Account credentials stay in the Pi-MFX data root, not
in banks or preset exports.

## System

![System hub](images/system.png)

System contains Audio, Wi-Fi/Hotspot, Updates, Realtime, and guarded reboot and
shutdown actions.

### Audio

![Audio](images/audio.png)

Pick the capture/playback device and guitar input channel, then set sample rate,
period size, and period count. Start conservatively (for example 48000 / 64 / 4),
reset XRuns, play hard, and lower the buffer only after the target Pi is stable.
The displayed latency comes from the negotiated driver settings. See
[LOW_LATENCY.md](LOW_LATENCY.md).

### Wi-Fi / Hotspot

![Wi-Fi and Hotspot](images/hotspot.png)

Join a home network or run the PI-MFX access point for a dedicated tablet. The
Pi radio cannot normally be an access point and station at once. After joining
the hotspot, open the URL shown on the page (commonly `http://10.42.0.1:8080`).

### Updates

![Updates](images/updates.png)

Choose Main (release), Dev, or Workstation, check the selected branch, and run
the background update/rebuild. The controller remains connected while the job
runs; the service restarts when the build finishes. `/var/lib/pimfx` user data
is not replaced.

### Realtime

![Realtime diagnostics](images/realtime.png)

Shows audio-thread scheduling, CPU/memory-lock controls, and diagnostic state.
Use it with the live meters and service logs when diagnosing XRuns; desktop
screenshots cannot validate Pi scheduling or audio stability.

## About

![About](images/about.png)

Shows version, commit, backend, and plugin count. **About / Legal** contains the
network warning, MIT notice, linked-library licenses, TONE3000/NAM credits, and
source links:

![About and Legal](images/about-legal.png)

## Optional hardware

Touchscreen kiosk, boot logo, and DIY floorboard setup are covered in
[INSTALL.md](INSTALL.md) and [DIY_CONTROLLER.md](DIY_CONTROLLER.md).
