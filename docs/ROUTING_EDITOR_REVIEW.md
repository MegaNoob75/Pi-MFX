# Routing editor review on Raspberry Pi 5

This development change replaces the serial/two-lane preset format. The
v0.5.1 tag is the previous baseline. Existing presets open as blank routing
with their names preserved; model and IR library files are retained.

The main repository changes are uncommitted for review. Community packages
now use format version 3, bank exports version 2, and routing version 1.
The old community development sample was removed and the submission
validator/schema updated. Community packages require Pi-MFX 0.6.0.

## Device checks

### Startup recovery before crash testing

The engine now creates `/var/lib/pimfx/engine-running` before startup and
flushes the file and directory to disk on Linux. It removes the marker only
after the web server and engine finish shutting down. A crash, forced kill,
watchdog reboot or power cut leaves the marker behind. The next launch creates
and selects a new **Recovery / Safe startup** preset with no plugins and no
audio connections, before building the startup chain. Existing presets and
banks are preserved; select the test preset manually when ready. Each recovery
creates a fresh bank so an edited recovery preset cannot become the next
automatic startup hazard. The safe selection is also saved in settings.

This requires rebuilding/deploying the updated engine on the Pi. It does not
prevent the initial native freeze or protect against failures outside preset
loading. The first launch arms protection; it cannot detect a crash from an
older executable that never created the marker. If the marker cannot be
persisted, startup fails before loading preset plugins. An ordinary graceful
restart restores the selected preset as before.

Run `ctest -R '^startup_guard$' --output-on-failure` on the Pi with testing
enabled. Before selecting a suspect preset, verify normal startup creates the
marker, an orderly service stop removes it, and a controlled forced engine
stop with a harmless preset leaves it behind. On restart, verify the active
Recovery preset has an empty chain and no wires, the original preset remains
available, and the recovery message appears in the service log. Do not power
cut the device merely to check the marker. No C++ build or runtime checks of
this safeguard were performed on Windows.

1. Build on the Pi with the usual workflow. Run the existing community preset
   package test target; its graph checks cover round trips, split/merge,
   duplicate edges, unknown blocks, cycles, and snapshot mixing.
2. Start a blank preset. Remove the input-to-output wire; output should be
   silent. Add NAM and Cab IR, then connect Input → NAM → Cab IR → Output.
   Load files in the plugin controls and confirm the normal tone.
3. Add another branch with any plugins. Connect both branches to a Mixer
   and the Mixer to Output. Remove unintended dry wires. Adjust volume sliders,
   pan, mute, and solo. Change to sliders and back; settings should agree.
   Add more than four branches to confirm there is no fixed path count.
   Check loaded NAM names (without extensions), including branches with
   effects after the NAM. Match each colored pan dot to its named branch.
   Moving a pan dot must change only pan, leaving volume unchanged.
   Switch to Sliders and check the matching pan position; change pan there
   and check the graphical dot. Volume sliders stay visible in both views. Back from mixers must
   return to the routing canvas, including when opened through Actions.
4. Select each Cab IR instance in the right panel. Test one, two, and three
   loaded cabinets, individual volume sliders, Blend level, and both views.
   One cabinet must show only its named volume slider, with no blend dot.
   Moving a blend dot must update the individual sliders; adjusting those
   sliders must update the blend dot.
   A minimum cabinet level means muted. Adjusting one instance must leave
   the others unchanged.
   Check cabinet names at the graphic edges/corners and view buttons beside
   both headings. Two branches and three cabinets should fit at 800×480 in
   either view; larger rigs retain scrolling.
   Diagnostic configuration: each Cab IR tile currently uses one native TooB
   instance with three cabinet slots. Separate cabinet processors are disabled
   in normal engine use while investigating freezes when connecting a second
   Cab IR branch. After rebuilding, connect two NAM → Cab IR branches to one
   mixer and check preset switching and restart stability. Existing cabinet
   filenames and levels must survive. Native cabinet-volume changes may
   rebuild the combined IR and bring back pumping/bouncing during blending;
   this test isolates that tradeoff from the reboot problem. Lower Blend level
   through its range: mute should occur only at the lowest endpoint, and
   raising it should restore the selected balance. Save/reload and check
   the three plugin volume controls match the final mixer settings.
   Repeat from the generic plugin controls and a bound physical control.
   Check DSP load and XRuns with one, two, and three loaded IRs. Test dry mix,
   bypass, file replacement/clearing and preset/snapshot recall as well.
5. Save and reload, restart the engine, duplicate the preset, and export/import
   a bank. Check connections, positions, plugin files, bindings, and levels.
   Capture two snapshots with different mix settings; recall each, then
   return to the base preset. Snapshot edits must not change its saved mix.
6. Remove a wire/block and replace a plugin. Confirm other connections and
   bindings still refer to the intended blocks. Try a feedback wire; the
   request should fail while the previous routing continues to run.
7. Check the actual 7-inch display and a tablet/PC: headings drag, connectors
   tap, larger rigs scroll/zoom, and each mixer panel scrolls independently.
   Confirm the compact row keeps the preset selector and Save/Reload visible.
   Open Connections to remove a wire; use Actions for preset tools, plugins,
   mixers, layout, zoom, and grid settings. Scroll the menu on the 7-inch
   display, and check that an outside tap closes it and activates the target.
   Set grid spacing through the touch keyboard, test snapping on/off,
   Align to Grid and Arrange, and zoom out to confirm the dots fill the
   viewport. Select drag wiring and connect in both directions; dropping
   on empty space should cancel without changing routing.
   While editing and switching presets, monitor DSP load and XRuns and check
   stereo output plus looper, backing tracks, recorder, and drums.

## Checks completed on Windows

Frontend type checking, browser layout/interaction checks, the community UI
regression check, community validator tests, and GitHub catalog validation.
No C++ compilation or live audio/device testing was performed on Windows.

## Native cabinet regression test

With `BUILD_TESTING=ON` and lilv available, the engine build includes
`pimfx_cab_ir_live_mix_test`. Run `ctest -R cab_ir_live_mix --output-on-failure`
from that build directory on the Pi. It skips if TooB Cab IR is absent.
The test creates temporary IRs, compares steady output against the native
TooB instance (including dry signal and one/two/three cabinets), checks the
saved logical slots/levels, and repeatedly changes mix gains while requiring
the IR loader to stay idle. It also retires processors during loading and
after audio-buffer rebinding. It has not been compiled or run on Windows.

## Block removal regression

On the Pi, remove a NAM, Cab IR, and mixer separately from a multi-branch
preset. Confirm the selected block and its wires disappear, remaining model
and cabinet settings survive, and the preparing indicator clears. Repeat
with a branch that becomes disconnected and a bypassed plugin. Removal now
retains unaffected processors instead of loading fresh copies. Check that
removing during a file load is rejected with a wait message, and succeeds
once loading finishes. Verify Reload restores the saved routing, and Save
persists removal. Monitor audio, XRuns, and device uptime throughout.

The October 12 live investigation confirmed a Pi-wide freeze followed by a
one-minute hardware watchdog reboot. A temporary debugger trace reached the
end of removal and routing publication before the freeze. The native cause
inside the subsequent transition/retirement was not established. The local
changes to retain processors, rebind their buffers, and shut them down before
buffer destruction were reported to fix block removal after the Pi rebuild.

## Connection change regression

Connection changes now retain the running processors using the same chain
replacement path as block removal. On the Pi, add and remove wires between
NAM, Cab IR, and mixer blocks, including a disconnected/bypassed branch that
becomes connected again. Add a mixer and connect multiple branches to it.
Confirm model/cabinet files and controls survive, the preparing indicator
clears, and audio continues without a freeze or reboot. Repeat with click
and drag wiring. Check that edits during file loading are rejected with a
wait message and succeed after loading. Verify Save/Reload, cycle rejection,
and unchanged volume/pan/mute/solo updates. These connection changes still
require a Pi rebuild and retest; the Windows machine has not compiled them.

## Structural edit audit

Adding and replacing plugins now retain unaffected processors as removal and
wiring do. A shared validation check rejects all four operations while the
graph or any model/cabinet is loading. Replacement explicitly recreates the
selected block, including when choosing the same plugin again. Background
chain preparation skips retained processors and only runs new instances.
The routing editor waits for publication after adding a plugin or mixer.
Preparing status is now included in full editor state as well as meter
updates, so the existing editing lock actually sees it. Save and both saved
preset reload endpoints reject requests while graph publication is pending;
their editor buttons are disabled during preparation too.

Pi checks: add ordinary LV2 effects, NAM and Cab IR to a populated preset;
replace a block with another plugin and then with the same plugin; confirm
unaffected assets and controls survive. Try fast repeated additions, edits
during a file load, bypassed/disconnected branches, and loading a file into
a newly added block. Repeat removal, wiring, and mixer additions. Monitor
uptime, audio, DSP load and XRuns, then Save/Reload, change presets/banks and
recall snapshots. Include looper, backing tracks, recorder and drums.
Move the active preset to another bank and verify uninterrupted audio:
bank membership no longer triggers a redundant reload of every processor.

## New block placement and attention

Add plugins and mixers to a crowded canvas with manually moved tiles, at
different zoom levels and grid spacings (including snap off). Every new
block must have a saved position clear of existing blocks and their rings.
Input/Output and other existing blocks must keep their positions. Prefer
free visible space; if the view is full, expand the canvas and reveal the
new block. Save/Reload should preserve that placement. A new block pulses
until touched, clicked, moved, or connected on either side. Interacting with
another block must not dismiss its pulse. Check multiple additions and
switching presets: existing loaded blocks should not pulse. Reduced-motion
users receive a steady highlight instead.

## Cable identification

Each cable has its own color, also shown on its number, the IN/OUT port
markers, and its Connections menu entry. Color assignments are remembered
per preset in browser storage; moving tiles or adding/removing another wire
must not change existing cable colors. Check crossing wires and wires hidden
behind other blocks, including multiple connections on one port. Numeric
labels and the named Connections list remain available alongside color.
Committed cables use separate lanes with curved bends, fan out at shared ports,
and prefer paths around tiles. Cables may cross, but must not share a stretch
that hides another cable. Verify aligned branches, reverse connections,
manual irregular layouts, and dragging blocks at different zoom levels.
The frontend geometry regression can be run with
`node scripts/routing-cables-regression.mjs` from `ui/`.

The audit also reviewed full preset reload/switch, snapshots, audio restart,
and chain retirement. Full preset reload/switch and audio restart create new
processors because their state or audio configuration changes; they do not
reuse running instances. Save and snapshot recall do not rebuild the graph.
No Pi-native compilation or runtime checks of these latest changes were
performed on Windows.
