# User guide

Open `http://pimfx.local:8080` (or the Pi's IP on port 8080) from the optional
touchscreen or any phone, tablet, or computer on the same network. Remote
browsers require a Pi-MFX password; first setup creates it. The attached
loopback touchscreen stays unlocked. Use a trusted network or the dedicated
PI-MFX hotspot because HTTP is unencrypted. See [REMOTE_ACCESS.md](REMOTE_ACCESS.md).

This guide describes the current `dev` implementation. Release validation and
known issues are tracked in [V1_READINESS.md](V1_READINESS.md).

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
- Turn or drag an analog control to change the live sound. Releasing a base
  preset control does not save the preset to disk; use **SAVE** explicitly.
- Use the bank and preset widgets to browse without leaving Performance.
- Base-preset drafts are held by the engine during the current session,
  including when switching away and back. **SAVE** keeps the changes;
  **RELOAD** discards them. Unsaved drafts do not survive an engine restart.

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

Saved-loop loading currently requires the WAV sample rate to match the audio
device rate. Save before changing audio settings: reopening the audio stream
clears the in-memory loop. Audio reconfiguration is rejected while a loop file
operation or recording/finalization is active. Finish those operations before
applying Audio, Realtime, backup, or setup-profile changes.

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

Projects retain their recording sample rate. Set the device to that rate
before opening a project. To change device rate while a project contains
audio, first choose a new empty project; existing takes are not silently
reinterpreted at the new rate. A storage error stops recording and retains
recovery data. Restore storage access, restart Pi-MFX, and reopen the project
to recover the available audio before making another take.

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

Add plugins or mixers to the routing canvas. Drag their headings to arrange
them, then tap **OUT** on a source and **IN** on a destination to connect audio.
Placement does not change the sound. Connect one output to several blocks to
split, or several outputs to one block to merge. There is no fixed path count;
available processing power determines how many plugins you can run. Feedback
connections are rejected. New plugins begin disconnected.

The compact editor row keeps **CONNECTIONS**, **ACTIONS**, the preset selector,
and Save/Reload visible. **CONNECTIONS** lists numbered wires with a remove
button for each. **ACTIONS** contains preset tools, plugins, mixers, layout,
zoom, and grid/wiring settings. Menus scroll to fit smaller screens and close
when you tap outside them.

Tap a block's body to open its controls. **ACTIONS → ARRANGE** spaces the graph by signal
flow; zoom buttons and scrolling make larger rigs accessible on a touchscreen.
Open **ACTIONS → GRID & WIRING** to choose grid spacing (10–100 pixels), turn snapping
on or off, or **ALIGN TO GRID** to snap existing blocks. **ARRANGE** also
aligns the signal-flow layout to the chosen grid. The dots follow the spacing
and zoom, and cover the whole visible canvas. These editor preferences are
remembered in the browser.

Choose **Drag between connectors** to drag from OUT to IN, or from IN to OUT.
A preview wire follows your finger or pointer and highlights the destination.
Release over the opposite connector to connect; release elsewhere to cancel.
The original tap-to-connect gesture remains available as an option.

Select a block's heading and use **ACTIONS → REMOVE SELECTED BLOCK** to delete
it and its connections.

**ACTIONS → SHOW MIXERS** shows branch mixing on the left and cabinet mixing on the right.
The Graphical/Sliders buttons sit beside each section title. Branch names follow
upstream NAM models through effects; cabinet names show IR filenames without
extensions. Choose a mixer or the final output, then adjust each incoming
branch's volume, pan, mute, and solo. Volume and pan sliders remain available
in either view. Graphical view adds a two-input blend strip or a three-input
triangle; three-input blend sliders also allow keyboard adjustment. **Mix
level** changes the combined gain while preserving the chosen proportions,
subject to each connection's gain limits. Blend and pan are separate controls.
Larger rigs can scroll. Verify fit and touch targets on your actual display;
Back from mixers returns to the routing canvas, and Back from the canvas
leaves the editor.

Choose any TooB Cab IR instance on the right. One loaded IR has a named volume
slider and no blend graphic, because there is nothing to blend. Two cabinets
get a blend strip, and three get a triangle. Both have a **Blend level** slider
in Graphical view, plus visible individual cabinet volume sliders in either view.
Blend level scales the cabinet volumes together, preserving the chosen
balance. Its range follows the loaded cabinets' gain limits, with mute at
the lowest endpoint. The blend dot holds this level as you move it, subject
to the individual cabinets' maximum gains. Muting and raising Blend level
again restores the chosen balance while this mixer remains open.
Individual cabinet levels remain available for precise adjustment.

The current engine uses one native TooB Cab IR instance per block, with that
plugin's three cabinet slots. Its volume controls are updated together by the
mixer. Native cabinet-gain changes may rebuild the plugin's combined IR;
loading a different file also requires a loading transition. Check loading
behavior, tone continuity, DSP load, and XRuns with the installed plugin build.

This automatic cabinet panel supports TooB Cab IR. With another IR loader,
place separate loader blocks on parallel branches and connect them to a Mixer
to blend their outputs using the same routing tools.

Use **SAVE** to keep base-preset changes or **RELOAD** to discard them. This
development format replaces the old chain/parallel format: presets without
`routingFormat: 1` keep their names but their old chains are not migrated.
Back up the data root before upgrading an older installation; rebuild the
tones you want to retain without overwriting your only old-format copy.

![Preset controls](images/editor-controls.png)

The control page renders generic LV2 metadata: toggles, enumerations, stepped or
continuous values, logarithmic ranges, units, trigger ports, and plugin file
properties. **BIND** assigns a physical control. Highlighting a supported model
file previews it live; **Use** accepts it into the live draft and Cancel
restores the original. **SAVE** then writes the base preset to disk.

![Preset input and output](images/editor-io.png)

Input/output pages hold per-preset gain and guitar-channel choices. Use the
**Snapshots** button in the editor header to open this preset's captures.

## Snapshots

![Snapshots](images/snapshots.png)

A snapshot stores the current routing mix, plugin bypass, and parameter state without
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

This is a configuration backup: UI, controller, Virtual Controls, system,
keyboard, and theme preferences. It excludes banks, models, IRs, plugins,
backing tracks, loops, recordings, drum assets, and credentials. Export banks
separately and keep a complete copy of `/var/lib/pimfx` for device recovery.
Setup profiles are separate and can also change audio, transport, and looper
settings. Stop recording and finish file operations before restoring either.

### Model Library account

![TONE3000 settings](images/model-library-settings.png)

Configure the publishable key and redirect URL, then sign in or complete the
OAuth callback manually. Account credentials stay in the Pi-MFX data root, not
in banks or preset exports.

## System

![System hub](images/system.png)

System contains Audio, Wi-Fi/Hotspot, Updates, Realtime, Remote Access Password,
and guarded reboot and shutdown actions. Changing the remote password forgets
all remote browsers; **LOCK THIS BROWSER** forgets only the current remote
browser. The touchscreen can recover a forgotten password.

### Audio

![Audio](images/audio.png)

Pick the capture/playback device and guitar input channel, then set sample rate,
period size, and period count. Start conservatively (for example 48000 / 128 / 3),
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

Choose Main for the released build or Dev for the current development build,
check the selected branch, and run the background update/rebuild. Workstation
is a historical branch retained for compatibility. The controller remains
connected while the job runs; the service restarts when the build finishes.
`/var/lib/pimfx` user data is not replaced.

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
