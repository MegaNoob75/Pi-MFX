# User guide

Open `http://pimfx.local:8080` (or the Pi's IP on port 8080) from the optional
touchscreen or any phone, tablet, or computer on the same network. Remote
browsers require a Pi-MFX password; first setup creates it. The attached
loopback touchscreen stays unlocked. Use a trusted network or the dedicated
PI-MFX hotspot because HTTP is unencrypted. See [REMOTE_ACCESS.md](REMOTE_ACCESS.md).

Use this guide as a reference or follow the examples to build your rig.
The browser edition is available from **About → User Guide**, with linked
contents, search, and printing. It is included on the Pi for offline use.
Screenshots illustrate the features throughout both editions; your theme,
control layout, and library contents may differ from the examples.

## Contents

- [First sound and everyday concepts](#first-sound-and-everyday-concepts)
- [Navigation and touch gestures](#navigation-and-touch-gestures)
- [Performance](#performance)
- [Tap Tempo and transport](#tap-tempo-and-transport)
- [Backing Tracks](#backing-tracks)
- [Looper](#looper)
- [Recorder](#recorder)
- [Drum Machine](#drum-machine)
- [Tuner](#tuner)
- [Banks / Presets](#banks--presets)
- [Preset Editor](#preset-editor)
- [Snapshots](#snapshots)
- [Virtual Controls](#virtual-controls)
- [Community Presets](#community-presets)
- [Model Library](#model-library)
- [Plugins](#plugins)
- [Files](#files)
- [Settings, hardware, layout, and appearance](#settings)
- [Backup and restore](#backup-and-restore)
- [System, audio, networking, and updates](#system)
- [About](#about)
- [Troubleshooting and practical checklists](#troubleshooting-and-practical-checklists)
- [Optional hardware](#optional-hardware)

## First sound and everyday concepts

Connect a compatible audio interface to the Pi and your guitar to the interface's
instrument input. Connect headphones or powered monitoring to its outputs. Start
with the monitoring volume low. Open **Settings → System → Audio**, select capture
and playback devices, and select the guitar input channel. Match the channel
number to the socket you actually used. Play and check the input meter.

Create a bank and preset from **Banks / Presets**. A new empty preset connects
Input directly to Output. Raise the monitoring volume gradually and confirm the
clean guitar is audible before adding effects. If the interface has direct
monitoring, its dry sound can play alongside Pi-MFX; account for that when
checking bypass or comparing processed tones.

| Item | What it means | Example |
| --- | --- | --- |
| Bank | A named collection of presets | A set or group of amp sounds |
| Preset | A saved sound with blocks, connections, and assignments | Clean chorus or lead |
| Live draft | Your current unsaved preset edits | A changed delay time during rehearsal |
| Snapshot | An alternate state of the same preset's blocks and mix | Rhythm and lead versions |
| Hardware profile | The controls and MIDI messages on your controller | Your particular floorboard |
| Performance layout | Where those controls and status widgets appear | An enclosure-matching screen |
| Virtual Controls | A separate touchscreen surface with preset bindings | Extra tone controls on a tablet |
| Setup profile | A reusable configuration of setup options | Different interface/controller setups |
| System backup | A recovery archive of selected or complete rig data | Recovering after replacing a drive |

Preset edits are live immediately. **SAVE** writes the base preset to storage;
**RELOAD** returns to the saved sound. Drafts can survive switching away and back
during the same engine session, but do not rely on drafts surviving a restart.
Saving a layout, drum pattern, or recording project is separate from saving a
guitar preset. A bank export exchanges tones; a system backup protects the rig
before reinstalling the Pi.

## Navigation and touch gestures

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

### Set up a playing screen

The physical control, its onscreen position, and its action are separate choices.
Create controls in **Layout** or **Hardware Setup**, learn them in Hardware Setup,
and assign their actions or preset parameters. Hiding a control in Layout does not
disconnect its physical MIDI input.

Hold or right-click a preset switch for its context menu. Assign an existing
preset, create a new one, edit or rename its target, or remove the assignment.
Removing a preset from a switch keeps it in the bank. Deleting the preset removes
its switch assignments too. An empty switch opens the create/assign menu when
tapped. The bank can remain empty, and deleting every bank is allowed; use
**Banks / Presets → New** or import a bank to start again.

For a four-song set, create one bank and four presets, then assign them to four
switches. Add separate switches for Tuner and Tap Tempo. Use hold/double actions
for less frequent commands, rather than making the primary press hard to predict.
The encoder behavior selected under **PI-MFX UI** chooses Browse (turn to highlight,
press to load), Live (load while turning), or Session Tiles. Browsing follows the
bank-list order and wraps through the preset catalog. In session mode, visible preset
switches can follow the browse position instead of fixed assignments.

## Tap Tempo and transport

![Tap Tempo](images/transport.png)

Tap **TAP** three or four times, or type a BPM. **PLAY** runs the shared musical
clock; it does not mute or stop the guitar chain. Set the time signature,
count-in, metronome, and beat-synchronized-change preference here. Tempo Link
controls and compatible LV2 plugins follow this transport.

### Example: a tempo-linked delay

1. In Preset Editor, add a delay plugin and open its controls.
2. Enable **Tempo Link** on a compatible time control and choose a musical
   division, such as 1/4 or dotted 1/8. The option appears only where supported.
3. Open Tap Tempo and set or tap the song's BPM. Listen as the delay follows it.
4. Choose the time signature and count-in if you will record or play drums.
5. Save the preset to retain its delay/link settings.

The clock, metronome, and audio players have different jobs. Starting the clock
does not automatically start a backing track or silence your guitar. Likewise,
setting the beat-synchronized-change preference does not guarantee that arbitrary
preset/snapshot changes will wait for a beat. Use each feature's visible timing
options and state to confirm what is armed or playing.

## Backing Tracks

![Backing Tracks](images/backing-tracks.png)

Import WAV, FLAC, MP3, or Ogg files. The player provides play/pause, stop,
restart, seek, level, manual BPM, editable metadata, a waveform, and an optional
loop region. Imported audio is mixed independently after the guitar chain.

Set lists do not duplicate or delete audio files. Create a named set list, add
tracks from **Track Files**, reorder them, then use Previous/Next from the UI or
controller. The buffer indicator should remain **READY**; underruns mean the Pi
could not feed the realtime player in time.

### Import, practice, and build a set list

1. Open Backing Tracks and import a supported local audio file. On the touchscreen,
   choose an available Pi-MFX library/USB path through the file browser; from a
   remote browser, upload the file from your device where offered.
2. Select the track and wait until its buffer is ready. Set its level while
   playing guitar so the backing does not mask the instrument or overload Master.
3. Enter BPM manually if you know it. Track metadata does not detect or stretch
   the recording to match a newly chosen tempo.
4. For a difficult solo, enable a loop region and set its start/end points around
   the passage. Seek or restart to hear the same section again.
5. Create a named set list, add tracks from Track Files, and put them in playing
   order. Previous/Next steps through that list; it does not remove the originals.

For hands-free practice, assign Backing Play/Pause, Stop, Previous, or Next to
learned switches. The backing is independent of your guitar preset, so changing
the amp sound does not require importing the track again. A buffer underrun
indicates playback starvation; check storage and system load before a performance.

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

### Example: rhythm bed with an overdub

1. Set the guitar tone you want to record and open Looper.
2. Choose **Free** timing for an immediate start, or **Next beat / Next bar** to
   line the operation up with the musical clock. Set BPM and count-in first when
   using clock timing. Watch the armed/recording state before starting to play.
3. Start Record, play the rhythm part, and finish recording into playback at the
   desired loop length. The one stereo loop becomes your repeating rhythm bed.
4. Start Overdub and add a harmony. End overdubbing to return to playback.
5. Use Undo to remove the current overdub session if it was a mistake; Redo puts
   it back while that undo state remains available. This is separate from Preset
   Editor's ten-change history.
6. Save the loop as a named WAV before clearing it or changing audio settings.

**Loop level** controls the loop against your live guitar. **Overdub feedback**
controls how much existing loop material carries into an overdub; lowering it
lets older layers fade as new ones are added. Stop retains the current loop,
Mute silences its playback, and Clear discards the in-memory loop after
confirmation. Loading another saved loop replaces the current working loop.

Assign Looper Record/Overdub/Stop and other available looper actions to switches
in Hardware Setup for foot control. Verify the switch's press/hold/double behavior
before using it to end a precisely timed take.

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

### Record a project

1. Open **Project Files**, create a named project, and confirm its sample rate
   matches Audio settings before recording.
2. In **Record**, choose the source of each track and arm only the tracks you want.
   Raw guitar records the unprocessed source, processed guitar records the effect
   sound, and Master captures the combined output. Recording Master alongside
   its component stems is useful, but playing all of them together doubles sound.
3. Set count-in/click if needed and choose **Record Armed Tracks**. Watch recording
   time, available space, and any write warning.
4. Stop to finalize the take before navigating file operations or changing devices.
5. Play back the project and open **Mix** to adjust track mute, solo, level, and pan.

To capture a guitar part against a song, first load the song in Backing Tracks,
then choose **Record with Backing**. The song rewinds and the guitar/backing are
captured as synchronized stems. Start a new take deliberately rather than
assuming the player will continue from its old seek position.

### Edit takes without losing track of the source

Choose a clip in **Edit**. The numeric fields use seconds:

| Field | Meaning | Example |
| --- | --- | --- |
| Start | Where the clip begins on the project timeline | Move a phrase to 8 seconds |
| In | Where playback begins inside the original recording | Skip 0.5 seconds of handling noise |
| Length | How much source audio the clip plays | Retain a 4-second phrase |
| Fade In / Fade Out | Transition length at either end | Add a short fade to avoid an abrupt edge |

Place the playhead inside the selected clip to enable **Split at Playhead**.
Select each resulting clip to move or trim it independently. A field change is
committed when you leave that field. Review playback after an edit, especially
when changing In and Length together.

### Mix, export, and recover

Use **Export Stem** in Mix for an individual track or **Export Stereo Mix** in
Files for the combined project. Track level/pan and mute/solo affect your mix;
check them before exporting. Open the result on your computer to confirm it is
the intended take. Retain the project and source recordings if you want to make
different edits later; a stereo export is not an editable multitrack project.

If recording stops because storage becomes unavailable, restore storage access
and reopen the project after restarting Pi-MFX. Keep recovery data until you have
listened to the recovered audio. A device-rate change is not a conversion of old
takes; choose the project's original rate or create a new empty project.

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

### Example: build a verse/chorus drum arrangement

1. On **Kit**, load a kit or create one. Add drum voices from WAV samples and set
   each voice's level/pan and the available playback controls. A kit selects sounds;
   it does not automatically create a rhythm.
2. On **Pattern**, choose variation A. For a simple 16-step beat, place kick hits
   on 1 and 9, snare on 5 and 13, and hi-hat on alternate steps. Tap a hit again
   for an accent and again to clear it. Select a step for exact velocity.
3. Choose variation B and create a busier chorus. Select Fill and program a short
   transition. For 32/64 steps, use the step-page buttons to reach later steps.
4. Save the pattern and kit under recognizable names. They are separate files.
5. On **Song**, add a variation A section repeated four times, then a variation B
   section repeated four times. Save the song, enable Song mode, and start playback.
6. Use Fill during playback for a transition and watch the active variation/step
   display to follow the arrangement.

**Swing** changes rhythmic feel; **humanization** varies the available timing or
velocity settings. Start with small values and compare against the guitar part.
The main level balances drums against guitar/backing. Use **Project Files** to
save/open the broader drum setup, and the separate kit/pattern/song pickers when
reusing one part in another project. Drum start/stop, fill, and variation actions
can be assigned in Hardware Setup.

## Tuner

![Tuner](images/tuner.png)

The Settings tab chooses chromatic/standard behavior, reference frequency, input
filtering, and whether opening the tuner mutes output or passes dry guitar.

Open **Tuner** from the drawer or a learned control. Play one string at a time
and let the display settle. Use the displayed note and tuning indication rather
than a chord. Review the tuner's reference pitch and output/mute options to match
your instrument and whether the audience should hear tuning. A switch assigned
to Tuner is useful between songs; confirm that leaving Tuner restores the output
behavior you expect.

## Banks / Presets

![Banks and Presets](images/banks.png)

Select the current bank and preset, create new entries, rename, reorder, clone,
save, import/export, or delete. Drag an entire preset row to reorder it or move
it into another bank. The active preset is what Performance and Preset Editor
show; the Community holding area is managed by the Community workflow.

### Build a bank and move sounds between banks

Create a named bank, then create a preset in it. Select the preset before editing
its sound. A preset name is a label, so use descriptive names such as "Verse clean"
and "Lead delay" instead of relying on a tile's position to identify it.

Drag a preset row within its bank to reorder it, or onto another bank to move it.
Clone a bank when you want an independent starting point for a different set.
Check the active bank after a move and review your Performance switch assignments;
an assignment is not the same thing as the row's numeric position.

Use bank/preset export for portable tone packages and import to bring them back.
Review plugin and model/IR requirements on the destination Pi. Installing a bank
does not make a missing paid plugin or unavailable model appear automatically.
Export and keep a copy before reorganizing a large library.

An empty bank is valid. If the last active sound is deleted and no other preset
remains, the active chain clears and output is silent. Create or import a preset
to play again. Deleted presets are removed from switches; removing a switch
assignment alone keeps the preset available in the bank.

## Preset Editor

![Preset Editor](images/editor.png)

Add plugins or mixers to the routing canvas. Drag their headings to arrange
them, then tap **OUT** on a source and **IN** on a destination to connect audio.
Placement does not change the sound. Connect one output to several blocks to
split, or several outputs to one block to merge. There is no fixed path count;
available processing power determines how many plugins you can run. Feedback
connections are rejected. New plugins begin disconnected.

The compact editor row keeps **CONNECTIONS**, **OPTIONS**, the preset selector,
and Save/Reload visible. **CONNECTIONS** lists numbered wires with a remove
button for each. **OPTIONS** contains preset tools, plugins, mixers, layout,
zoom, and grid/wiring settings. Menus scroll to fit smaller screens and close
when you tap outside them.

Tap a block's body to open its controls. **OPTIONS → ARRANGE** spaces the graph by signal
flow; zoom buttons and scrolling make larger rigs accessible on a touchscreen.
Open **OPTIONS → GRID & WIRING** to choose grid spacing (20–100 pixels), turn snapping
on or off, or **ALIGN TO GRID** to snap existing blocks. **ARRANGE** also
aligns the signal-flow layout to the chosen grid. The dots follow the spacing
and zoom, and cover the whole visible canvas. These editor preferences are
remembered in the browser.

Choose **Drag between connectors** to drag from OUT to IN, or from IN to OUT.
A preview wire follows your finger or pointer and highlights the destination.
Release over the opposite connector to connect; release elsewhere to cancel.
The original tap-to-connect gesture remains available as an option.

Select a block's heading and use **OPTIONS → REMOVE SELECTED BLOCK** to delete
it and its connections.

**OPTIONS → SHOW MIXERS** shows branch mixing on the left and cabinet mixing on the right.
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

Use **SAVE** to keep base-preset changes or **RELOAD** to discard them. Presets
from older installations that predate the routing grid may retain their names
but need their audio chains rebuilt. Back up before upgrading and keep the old
backup until the rebuilt tones are saved and working.

![Preset controls](images/editor-controls.png)

The control page renders generic LV2 metadata: toggles, enumerations, stepped or
continuous values, logarithmic ranges, units, trigger ports, and plugin file
properties. **BIND** assigns a physical control. Highlighting a supported model
file previews it live; **Use** accepts it into the live draft and Cancel
restores the original. **SAVE** then writes the base preset to disk.

![Preset input and output](images/editor-io.png)

Input/output pages expose the same global gain and guitar-channel settings as
**Settings → Audio**. These settings affect the whole rig and are outside preset
undo/redo. Use **Options → Snapshots** to open the current preset's captures.

### Example: create an amp and cabinet preset

1. Create/select a preset. Hold empty grid space (or right-click with a mouse)
   and choose **Add Plugin**. Select an installed amp/NAM loader.
2. Add a cabinet IR loader. Arrange the blocks by dragging their headings.
   Moving a block changes presentation; the cables determine the sound.
3. Connect **Input OUT → Amp IN**, **Amp OUT → Cabinet IN**, and **Cabinet OUT →
   Output IN**. Remove a direct Input → Output cable if you do not want dry guitar
   mixed with the processed path. Use **Connections** to review/remove cables.
4. Open the amp block, choose its model file, and use the cabinet block's file
   control to choose an IR. A head-only capture normally needs a separate cabinet;
   a full-rig capture can already contain the cabinet sound. Avoid unintentionally
   filtering a full rig through another cabinet.
5. Adjust gain, EQ, and level while playing. Check the output meter and compare
   against bypass at a similar listening level. Save the completed preset.

The grid supports snapping and spacing under Options. Choose tap-to-connect or
drag-between-connectors there. Hold empty space to open additions at that point;
drag empty space to pan on touch, and pinch to zoom. Arrange lays out the graph.
Keep cables directed from OUT to IN; a feedback loop is not a valid audio route.
Source-only plugins may have only OUT; monitoring plugins can have only IN.

### Parallel routing and cabinet blends

For a clean/dirty blend, connect Input to both a clean amp/cab branch and a dirty
amp/cab branch. Connect both branches to a Mixer, and Mixer to Output. In **Show
Mixers**, choose that mixer and balance the two named inputs. Lower both branch
levels before combining loud signals; adding branches can increase the peak.
Pan places the branch in stereo, Mute removes it, and Solo lets you audition it.

For a three-amp blend, connect three independently processed branches to a Mixer
and use its triangle to explore their proportions. **Mix level** raises/lowers
the combined blend while keeping its balance within each input's allowed range.
The cabinet triangle inside a single TooB Cab IR block controls that plugin's
three cabinet slots. It is separate from the branch mixer even when both look
like triangles. Save the preset when both balances sound right.

### Block LEDs, signal lights, and undo/redo

Every effect and mixer has a small active/bypass LED in its upper-right corner.
Tap its button to toggle it: green means active, red means bypassed. The block
stays in the graph with its settings. An effect passes audio without processing
while bypassed. A bypassed Mixer passes its incoming branches at unity level and
center pan; mute/solo gates remain in force. Re-enabling restores its saved mix.
Bypassing a mixer can change level substantially, so compare at low volume first.

Input/Output have a signal LED next to the label and a live dB reading. No signal
leaves the LED off; green indicates signal, amber a high level, and red a peak at
or above digital full scale. These are peak indicators, not loudness averages.
Input is the engine input meter and Output is the master output meter, including
other active playback sources. Use plugin meters when tracing one branch.

The Output block also shows **AUDIO** and **CPU** to the right of IN. AUDIO is
the percentage of each audio buffer's processing deadline being used: this is
the main indication of how much more processing the current rig can handle.
Its small bar turns amber at 70% and red at 90%; these are advance warnings,
not guarantees that a sound will or will not glitch. Leave room for load spikes
and watch XRuns when adding demanding plugins or changing models.

CPU is Pi-MFX engine usage across all cores, including its helper threads; it
is not total system CPU. A low CPU reading does not guarantee audio headroom
when one audio deadline is nearly full. AUDIO can exceed 100% when a deadline
is missed. A dash means the reading is unavailable or, for AUDIO, audio is
stopped. The display does not predict a fixed number of additional blocks.

Hold/right-click empty grid space and use **↶ Undo / ↷ Redo** beside Close. They
are also available in Options. History keeps up to ten editor changes, including
block add/remove/replace, wiring/positions/mix, bypass, plugin parameters/files,
Tempo Link, and preset bindings. A continuously dragged parameter is one gesture.
A new edit after Undo replaces the redo path. Undo/redo restores the live draft;
use Save to keep the result. Save, Reload, snapshot operations, deleting the preset,
restarting, or editing a different preset resets the applicable history. Global Audio settings,
bank organization, and recorder/looper operations have separate lifecycles.
Return to the base preset before using preset undo/redo.

### Bind a physical control to a useful range

Learn the control in Hardware Setup first. In the plugin control page, hold the
parameter name (or use Bind), choose the physical pot/encoder, and set its minimum
and maximum. For example, bind an expression pedal to delay mix over a modest
range so heel is nearly dry and toe adds repeats without overwhelming the dry
guitar. Reverse changes direction. Hold an effect's bypass LED to bind a switch
to toggle that effect. Several controls can target the same parameter where the
binding picker allows it. Bindings are preset-specific, so the same pot can
control amp gain in one preset and delay mix in another.

File pickers can audition supported model/IR choices live. Use accepts the
selection into the live draft, Cancel restores the original, and Save retains
the chosen file in the preset. Keep the underlying model/IR file available;
renaming or deleting dependencies can make a saved preset incomplete.

## Snapshots

![Snapshots](images/snapshots.png)

A snapshot stores the current routing mix, plugin bypass, and parameter state without
overwriting the base preset. Recall, capture/update, rename, edit, or delete up
to six slots. The Performance snapshot stage is arranged separately under
**Settings → Layout → Snapshots**.

### Example: rhythm and lead snapshots

1. Build and save the base preset, including every block you need in either sound.
2. Set rhythm gain and mix, then capture a snapshot into an available slot and
   name it "Rhythm".
3. Increase the lead level or gain and enable the existing delay block. Capture
   another snapshot named "Lead".
4. Recall Rhythm and Lead while playing. Update the chosen snapshot when you want
   to replace its captured settings; merely recalling it is not a new capture.
5. Place snapshot tiles under **Layout → Snapshots** and assign learned controls
   to snapshot slots where needed.

In snapshot mode, preset footswitches select Snapshot 1, Snapshot 2, and so on
in controller order. **Hardware Setup → Snapshot mode slot** can override that
order for each switch. Press the active snapshot's switch again to return to
the base sound. The switch LEDs follow the active snapshot; leaving snapshot
mode restores their preset indications.

Snapshots reuse the preset's topology. They change parameters, bypass, and mix
without adding/replacing plugins. Return to the base sound before restructuring
the rig or saving base-preset changes. The last chosen snapshot can be remembered
for Performance re-press behavior; watch the BASE PRESET / active snapshot status
to know which sound you are editing. Empty snapshot slots stay empty instead of
silently moving later captures into a different footswitch position.

## Virtual Controls

Virtual Controls is an additional touchscreen surface, separate from the physical
controller's Performance layout. Use it for controls that do not fit the enclosure,
or for a tablet beside the Pi. It supports multiple pages and configurable control
types, labels, placement, size, and preset-specific bindings.

Open its layout editor, add a page, then add buttons/toggles or continuous controls
as appropriate. Drag/resize them and choose their target/action. A continuous
control needs a compatible parameter; a button can recall an available snapshot,
toggle an effect, or run an offered action. Missing targets are shown explicitly.

Choose a **shared layout** when the same surface should work across your presets,
with each preset supplying its own bindings. Choose a **preset-owned layout**
for a sound that needs a different surface. Generating controls from the current
effects is a starting point; review names, ranges, and page organization before
saving. Replacing a layout can discard existing layout edits, so review the
confirmation.

For example, create a shared "Tone" page with Gain, Delay Mix, and Reverb controls.
In each preset bind those controls to its actual plugin parameters. Create a
second "Live" page with large snapshot buttons. Changing page does not require
relearning MIDI. If using an encoder proxy/fine mode, select the virtual control
and then turn the configured hardware encoder to adjust it; inspect the selected
control and fine-mode indicator before making a large change.

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

### Example: download and use a NAM capture

1. Sign in to TONE3000 under Settings → Model Library, then open Model Library.
2. Search and open a tone. Read whether it is a head/preamp capture or a complete
   rig and check the available model architecture/calibration information.
3. Select the files you want, or Download All for the listing. Choose a named
   destination folder, such as an amp name, so variants remain easy to identify.
4. Wait for the download job's final report. Inspect saved/failed totals rather
   than assuming a started job means every file is installed.
5. Open a compatible plugin in Preset Editor and choose the downloaded model.
   Add a cabinet IR when the capture is head-only, then save the preset.

Use Files for models/IRs you already own. Put NAM, AIDA-X, and IR content in the
matching library rather than selecting an arbitrary host path. Calibration and
input gain influence the response of a capture: compare at matched input levels
and use the model author's guidance where provided. A model file does not install
its playback plugin. An IR is a cabinet/filter response and does not supply amp
nonlinearity by itself.

## Plugins

![Installed plugins](images/plugins-installed.png)

**Installed** shows the LV2 plugins the engine can see. Rescan after an external
install, hide plugins you do not want in the picker, or unhide them later.

![Install plugins](images/plugins-install.png)

**Install** combines Raspberry Pi OS packages, recommended GitHub packs, and
PatchStorage. Install helpers work outside the audio callback and report job
progress. Plugins keep their own licenses; see
[PLUGIN_LICENSES.md](PLUGIN_LICENSES.md).

### Install and make a plugin available

Open the Install tab, choose a supported package/source, and read its description
and license before installing. Wait for the job's final status, then rescan if it
does not appear in Installed. Add it to a preset using the plugin picker. Installed
means the engine discovered it; it does not mean the plugin is already in the
active chain. Hidden plugins stay installed and can be made visible again.

Review dependency warnings before uninstalling. A preset referring to an unavailable
plugin cannot reproduce its original sound. Different plugins expose different
ports and file properties; Pi-MFX renders those controls from plugin metadata.
Use the plugin's own documentation to interpret unfamiliar DSP parameters.

## Files

![Files](images/files.png)

The two-pane manager is rooted inside Pi-MFX's allowed libraries. Browse NAM,
AIDA-X, and IR content; create folders; upload; drag between panes; rename; or
delete after the dependency-impact review. The same browser is reused for
backing tracks, drum samples, and plugin file properties.

### Organize libraries and understand references

Use one pane as a source and the other as a destination when arranging files.
Create folders such as Models/Amp Name and Cabinets/Cab Name, then upload or move
the appropriate files. The browser stays inside the allowed Pi-MFX libraries.
Long names can scroll in their row; select the item to check it before changing it.

Presets can refer to a model or IR path. When a rename/delete impact review lists
presets, read it before continuing: a file operation can change more than the
visible folder. Deleting a model does not delete the preset that used it, but
that preset can then report a missing dependency. Export or back up valuable
content before bulk organization.

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

### Add and learn any supported mix of hardware controls

Pi-MFX does not impose a stock count of switches, pots, sliders, expression pedals,
or encoders. Add as many logical controls as your hardware and unique MIDI
addresses support. The stock board's eight switches, four pots, and one encoder
are a wiring example, not an application limit. Generic MIDI controllers use
MIDI Learn. With current universal ESP32-S3 firmware, Learn discovers the physical
GPIO connection for the control type you selected.

1. Wire the controls and install universal firmware onto a supported ESP32-S3
   DevKitC-1 once, using **option 5 — First-time ESP32-S3 installation over USB**
   in the setup script menu (see [Flash once](DIY_CONTROLLER.md#flash-once)).
   Configure subsequent wiring changes in Hardware Setup. A fresh
   board starts empty. Other MIDI controllers need firmware that already emits
   distinct messages for their controls.
2. Select the actual USB-MIDI input under Hardware Setup and enable the controller.
3. Choose Add Momentary, Latching, Pot, Slider, Expression, or Encoder. Set a useful
   label and the correct kind; Learn does not infer it automatically.
4. Select the new control, press Learn (Learn Rotation for an encoder), wait one
   second, and operate only that physical control. Hold a switch for half a second;
   turn an encoder clockwise at least four clicks and stop; slowly sweep an analog
   control through its full range and back, then stop. Review the detected wiring
   and Save on Controller. MIDI addresses are allocated automatically. Generic
   MIDI Learn captures the device's existing CC/note and channel as before.
5. For an encoder with a push switch, enable its paired button and use Learn Button
   separately. Disable the paired button for an encoder without one.
6. Choose the action, range/direction, and any hold/double action/timing. For an
   encoder, Navigate Menus plus a paired Select button is a useful starting point.
7. Open Layout, place/show the new control, arrange it, and save the layout.
8. Bind preset parameters from Preset Editor, then exercise the full range and
   switch to another preset to verify the intended per-preset behavior.

Under Wiring & Recovery you can select pins manually when Learn
is ambiguous, adjust encoder transitions per click, debounce and analog endpoints,
configure/test a NeoPixel strip, read the board or recover its controls. The
current universal image supports direct-wired inputs and one NeoPixel strip;
expansion modules require additional drivers. USB, memory and boot-sensitive pins
are excluded. Firmware and Pi-MFX both validate assignments before applying them.

Each learned MIDI address consists of message type (CC or note), MIDI channel, and
number. CC 30 on channel 1 differs from CC 30 on channel 2. Each MIDI channel has
128 CC numbers and 128 note numbers; there are 16 channels on the selected MIDI
port. Universal firmware supports CCs on all 16 channels and Pi-MFX allocates
addresses for you. Its current limit is 32 input records; encoder rotation and
push use separate records. The board's pins, ADC inputs, CPU,
USB/MIDI bandwidth, and any expanders/multiplexers remain physical limits.

Learning an address already owned by another control transfers it to the selected
control and unlearns the previous owner. It does not make two logical controls
independent if the firmware emits the same address for both. Save a controller
profile after learning. Version-2 profiles retain mappings, feel and verified
wiring; version-1 profiles still load. They do not flash firmware or replace the
separately saved Performance layout. Loading a profile never writes board GPIO
settings automatically: select Review Saved Wiring, check the changes and confirm.
Use Board Controls reads an existing board into Pi-MFX. Board identity and verified
wiring prevent another enclosure's stale mappings from running until reconciled.
The ESP32's saved configuration survives a power cycle.

The stock firmware sends relative encoder values 63/65, and also supports the
runtime's small-step 1/127 convention from other controllers. An absolute knob
should be added as a Pot rather than treated as an encoder. Reverse corrects
direction; encoder pulses per click filters duplicate messages. Leave it at 1
with the supplied firmware, which already converts quadrature transitions to
one MIDI message per detent. Extra pot deadband filters wobble; extra switch
debounce filters double firing. Use only as much filtering as needed.

LEDs are separate outputs. Add an LED, configure its pixel index/role, and link it
to a control as appropriate. RGB Theme makes supported board LEDs follow theme
colors. A generic MIDI device can send usable CC/note input without implementing
Pi-MFX identity/RGB messages; those feedback features require matching firmware.
Only the selected input port is connected by this controller setup.

### Layout

![Performance layout](images/layout.png)

Drag and resize status widgets and hardware controls. Toggle visibility, group
items, match sizes, and choose the snap grid. **Save Layout**, **Save As**, and
**Load** update the named file and the live controller layout.

The optional **Memory** widget shows Linux-reported installed, used, and free
RAM (free includes reclaimable cache). **Bank Preload** shows preparation status,
prepared/total preset counts, estimated cache memory, and whether the last preset
selection used a prepared chain. Both widgets can be resized and saved normally.

![Snapshot layout](images/layout-snapshots.png)

The Snapshots stage separately arranges snapshot tiles. It changes appearance,
not the control that recalls each slot; assign that in Hardware Setup.

### Match the screen to your enclosure

In the Performance stage's Controls palette, choose **New hardware control** and
press **Add Control**. This creates the logical control and places it where space
is available. Encoders include a paired push button that can be disabled in
Hardware Setup. There is no fixed count of additions. If the screen is full,
make room and show/place the new control from the palette. Save Layout, then open
Hardware Setup, select its label, and Learn Turn / Learn Button or Learn as
appropriate. Creating a control saves its hardware definition immediately;
Save Layout retains its arrangement. You can also learn/create in Hardware Setup
first and arrange the same controls here afterwards.

Choose Performance or Snapshots before moving items. Select a control/status
widget, show/place it if hidden, drag it into position, and resize its rectangle.
Use the snap grid for consistent spacing. Group related items to move them
together; match sizes when several switches should look identical.

For an enclosure with six switches and three encoders, first create/learn all nine
controls in Hardware Setup, then place the six switches along the lower edge and
the encoders above them. Keep bank/preset widgets and meters visible without
overlapping the control labels. Save Layout, or Save As to preserve another
enclosure's arrangement. Load selects a saved layout. Layout changes appearance;
it does not teach the engine a new MIDI address or change a preset's parameter
binding. Snapshot tiles have their own arrangement on the Snapshots stage.

### Theme, Keyboard, and PI-MFX UI

![Theme Manager](images/theme.png)

Choose a built-in theme or customize colors, typography, control states, and
performance switches. Import/export and save custom themes from this page.

![Keyboard](images/keyboard.png)

Select when the on-screen keyboard appears plus its layout, key size, placement,
and theme.

![PI-MFX UI](images/ui.png)

Set touchscreen/floorboard behavior, UI scale, encoder feel, pop-out duration,
and other interface preferences. Browse highlights then loads on encoder press;
Live loads while turning; Session Tiles changes visible switch names for this
session. Save custom themes for different lighting conditions. Keyboard choices
control whether it appears automatically, and its size, placement, and appearance.
These appearance choices do not change hardware MIDI mappings.

**Settings → Backup & Restore** exports or restores the rig:

![Backup](images/backup.png)

See the [Backup and restore chapter](#backup-and-restore) for destination-first
export, passwords, complete/selective recovery, and worked recovery examples.

### Save setup and controller profiles

Use **Save Profile As** in Hardware Setup to retain the hardware mappings and feel
settings. Loading a hardware profile keeps the current visual layout. A setup
profile covers broader choices, including Audio, controller/layout, Virtual
Controls, UI/system settings, transport/looper preferences, and keyboard behavior.
Review the confirmation before loading one, particularly when it changes the
audio interface. Finish recording and file operations before changing setups.

For example, save a Home setup for headphones and a second Stage setup for your
live interface/controller. A profile selects configuration, while a system backup
also preserves libraries/media. Keep both when moving to a new Pi.

### Model Library account

![TONE3000 settings](images/model-library-settings.png)

Configure the publishable key and redirect URL, then sign in or complete the
OAuth callback manually. Account credentials stay in the Pi-MFX data root, not
in banks or preset exports.

## Backup and restore

### Make a recoverable copy before reinstalling

1. Finish recordings, model downloads, and file operations. Open **Settings →
   Backup & Restore**. Choose the destination before starting the job.
2. On the Pi touchscreen, select a mounted USB drive on a different physical disk
   from the OS/data drive. Refresh the drive list after mounting it.
3. From another device, choose a file location on that device when a writable
   browser save picker is available. The picker requires browser support and a
   secure connection. On ordinary HTTP connections, choose **Download to this
   computer / tablet**. The browser asks where to save or uses its Downloads folder;
   enable its "Ask where to save each file" setting beforehand if you want a folder
   prompt. Pi-local browser downloads are not recovery destinations.
4. Choose Full Backup for the whole rig or Choose Content for selected categories.
   Enter and confirm the password. Full backups and categories containing secrets
   or executable package payloads require at least eight characters. Keep the
   password separately; it cannot be recovered from the backup.
5. For plugins, choose Smaller Backup to record exact downloadable package versions,
   or Self-contained Backup to include their installers. Choose self-contained for
   recovery without depending on repository availability. Manual plugins are
   included with either mode when the Plugins category is selected.
6. Choose Create & Export and keep the page open. Audio pauses for the consistent
   copy, then resumes while later archive work continues. The page stays open
   through engine reconnection and reports the final result.
7. Check that the file is saved off the Pi. USB exports are read back and
   checksum-verified. A writable save picker confirms file completion automatically.
   With a standard browser download, wait for the download to finish, check the
   saved filename and size, then press **I Have Checked the Saved Backup**. Only
   then does Pi-MFX remove its temporary archive. The report retains filename,
   size, categories, package recovery information, and checksum. File count and
   duration appear when the backup provides those values.

New standard browser downloads are requested automatically when the archive is
ready. If blocked, use **Download Backup**; that link also exports an existing
prepared archive without creating another backup. If saving fails or the page is
refreshed before export finishes, the temporary archive remains available to
retry. A prepared
archive alone is not a completed off-Pi backup. Do not format the Pi until the
destination file is present and the success report has been reviewed.

Full backups can include banks/presets/snapshots, model/IR libraries, installed
plugins and dependencies, settings, layouts, profiles, tracks, loops, recording
projects, drums, exports, connection credentials, and Pi-MFX installation options.
They are not full operating-system disk images. Choose Content makes the scope
explicit. File hashing uses up to four worker threads; snapshot copying and ZIP
writing remain serial, avoiding simultaneous writes to one archive.

### Restore everything or recover one item

Install Pi-MFX on the replacement OS first, open Restore, choose/import the archive,
and enter its password. Wait for verification and review the preview before
applying anything. Select Restore Everything for the complete compatible rig or
choose categories and individual files/banks/presets where offered.

For a selective restore, review conflict handling: Keep retains existing content,
Replace applies the selected backup content, and Import as Copies is available
for supported library types. It is not available for every media/project type.
A different hardware/system identity can restrict which categories can be applied;
use the available preview choices rather than forcing incompatible settings.

For example, to recover one deleted preset, inspect the backup, select its bank
category and individual preset, and use a supported copy/import choice so you can
compare it with current sounds. Include its models/IRs and required plugins when
they are missing. Replacing the whole rig would also replace unrelated work.

Confirm that the archive is trusted before applying executable plugin packages.
Audio stops while restore applies. Review the final report, reconnect credentials
or audio devices if changed, and reboot when recommended. The rollback action
recovers retained Pi-MFX data after a restore; it does not undo operating-system
package changes. Old configuration JSON import remains available for older
settings backups. See [Backup and restore reference](BACKUP_RESTORE.md) for the
fresh-OS procedure and recovery/working-space details.


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

### Input setup, calibration, and output safety

Device settings select the interface, sample rate, period frames/count, and guitar
input. Apply device changes only after stopping recordings and finishing file
operations. The resulting negotiated settings, not just the requested numbers,
determine the active buffer. A smaller period gives the Pi less time for each
callback and may increase XRuns on a heavy preset.

Digital Input Gain is after the interface's converter. Set it to 0 dB while
adjusting the physical gain; it cannot repair clipping that already happened in
the interface. For **Input Level Setup**, mute strings for the first three seconds,
then play normal chords and your hardest realistic attacks for eight seconds.
Read maximum, RMS, noise estimate, and headroom. Adjust the interface's physical
gain as advised and repeat. Keep the same guitar volume and input mode for a
meaningful comparison.

NAM calibration describes the guitar's analog level in dBu, whereas the meters
show digital level in dBFS. If unmeasured, use the recommended unmeasured starting
profile and −6 dBu rather than guessing the interface specification. Measured
setup requires the correct maximum input level for the actual Instrument/Hi-Z
mode and the hardware gain above minimum. The wizard estimate combines those
known values with its measurement. A calibration profile can manage all TooB NAM
instances, or management can be off so each uses its saved calibration value.
Calibration changes model response; it is not a master loudness control.

Output gain sets final listening level. Review the Output and Safety controls
for the limiter/gate and their displayed ranges. Limiter look-ahead adds to the
audio path's delay; changing it is a sound/latency tradeoff. Compare levels before
and after safety changes, and leave room for guitar plus loops/backing/drums.
Reset XRuns before comparing one controlled change, then play the heaviest
sound you actually use. Driver latency estimates are not an external loopback
measurement of your full rig.

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

**Bank Preloading · Experimental** prepares fresh LV2 instances, settings, models,
and IRs only for presets currently assigned to switches in the active bank.
The target count is dynamic (8, 15, or any other configured count), duplicate
assignments share one target, and unassigned presets are excluded. Session switch
assignments take priority over saved assignments. Reassignment updates the cache,
retaining compatible prepared instances and releasing obsolete targets.
It is enabled by default for this experiment and can
be switched off here without restarting audio. It does not reserve a fixed RAM
block: only prepared chains occupy extra memory. The ceiling is the smaller of
half the installed RAM and startup available RAM minus the safety reserve. That
reserve is the larger of 512 MiB and 20% of installed RAM. The startup baseline is
measured after audio/media buffers exist, before the startup preset is loaded;
Pi-MFX never unloads your sound just to measure memory.

Live available RAM and estimated/measured allocation growth are checked as the
assigned set is prepared. If that entire set cannot fit, its extra chains are discarded
and ordinary loading continues. A plugin's allocations cannot be predicted
exactly, so this is a conservative experimental policy, not a hard memory sandbox.
Preloading runs outside audio, pauses for high audio load or recording, and stops
the bank attempt if an XRun occurs during preparation. Cached instances do not
process audio, and their host LV2 worker threads sleep until selected.

Once the bank is ready, selecting a preset consumes its fresh prepared instance;
the cache prepares a fresh copy of the sound you left in the background. The
currently selected chain counts toward the prepared total; there is no extra
cached copy of that sound. Played instances are not recycled,
avoiding old delay/reverb tails on recall. Browsing a bank does not preload it or
change the current sound; selecting a preset in another bank releases the old
bank cache and begins preparing the new one. Edits, remembered snapshots, tempo,
audio settings, catalog updates, and library-file changes invalidate incompatible
prepared chains. Toggle preloading off and on to retry a rejected bank.

## About

![About](images/about.png)

Shows version, commit, backend, and plugin count. **About / Legal** contains the
network warning, MIT notice, linked-library licenses, TONE3000/NAM credits, and
source links:

![About and Legal](images/about-legal.png)

## Troubleshooting and practical checklists

### No guitar or the wrong sound

- Check the physical input socket, selected capture device/channel, and input
  meter. An inactive input LED means there is no measurable signal at that meter.
- Check that the current preset has a continuous connected path from Input to
  Output. A nearby block is not connected merely because it is drawn in the row.
- Inspect block bypass LEDs, mixer mute/solo, gains, Master, tuner mute, and any
  missing-plugin/file warning. Confirm which preset and snapshot are active.
- If a very dry sound plays alongside effects, check for an Input → Output cable
  and the interface's direct-monitor path.
- If an imported sound is incomplete, install its exact plugin and locate the
  required model/IR before comparing it with the original.

### A learned control does nothing or moves the wrong item

Check that the actual controller port is selected, the controller is enabled,
and the control's kind is correct. Learn again while moving only that control.
Verify turn and push separately for encoders. If two controls emit the same
type/channel/number, change the firmware addresses; Learn cannot distinguish
physically different controls with identical messages. Check the action and the
current preset's binding. A hidden Layout tile does not disable the physical
control, and a visible tile is not proof that a MIDI message has been learned.

For reversed movement, use Reverse. For skipping list entries, check encoder
pulses per click and firmware detents. For pot wobble, try a small deadband and
check wiring. Save the hardware profile once the behavior is right.

### Audio crackles, pauses, or loading takes time

Observe XRuns, Audio/DSP load, and CPU while reproducing the issue. Audio load is
the fraction of the callback deadline used, while CPU describes broader engine
work; they are different measurements. Increase the audio buffer conservatively
if needed, then compare using the same preset and activity. Model/IR loading and
changing the audio device can cause an intentional transition. Avoid starting a
backup or heavy library operation during a performance.

If recording or backing reports a storage error/underrun, check available space,
the drive connection, and competing disk activity. Keep recording recovery files
until you have confirmed the recovered take. Do not overwrite the only good bank
or backup while investigating a failure.

### Before a rehearsal or show

- Save the presets, snapshots, layouts, and workstation files you intend to use.
- Exercise each learned switch and encoder in the intended bank/snapshot mode.
- Check relative volumes of clean, rhythm, lead, loop, backing, and drums.
- Confirm tuner mute and the path back to Performance.
- Keep a recent completed backup on a separate physical drive.
- If using a tablet, test the connection and remote password before relying on it.

### Before formatting or replacing the Pi drive

Confirm that the backup's destination is another physical disk or a remote
computer. Check the saved file's name/size against the report and retain its
password. Prefer a self-contained plugin backup when future network/repository
availability is uncertain. Export particularly valuable banks or recordings as
additional copies. Keep the old drive intact until the replacement installation
has restored the archive and you have listened to the recovered rig.

## Optional hardware

Touchscreen kiosk, boot logo, and DIY floorboard setup are covered in
[INSTALL.md](INSTALL.md) and [DIY_CONTROLLER.md](DIY_CONTROLLER.md).
