# Routing and mixer validation on Pi 5

Routing is part of the normal `dev` feature set. Run this checklist against
the exact build under test and record results in [V1_READINESS.md](V1_READINESS.md).
No device result is implied by the checklist.

## Routing and plugin ownership

1. Create a blank preset. Disconnect Input from Output and verify silence.
   Add NAM, Cab IR, and an ordinary effect; connect Input through them to Output.
2. Split into multiple branches, merge through a mixer, and verify stereo
   output. Add more than four branches. Reject cycles/duplicate connections
   while retaining the previous working sound.
3. Repeatedly add, replace (including the same plugin), remove, bypass,
   reconnect, and disconnect blocks. Unaffected model/IR files, controls, and
   bindings must survive. Include bypassed and disconnected processors.
4. Attempt edits while a model is loading. Rejected operations must leave the
   graph intact. Test a missing/stalled model: the timeout must be visible and
   selecting another preset or Reload must provide a recovery path. Capture
   logs and failed state before restarting the service.
5. Save/Reload, switch banks/presets, move the active preset between banks,
   and export/import individual presets and banks. Check routing positions,
   files, parameter bindings, snapshots, and gains after service restart.
6. Change an unsaved parameter, model, and connection mix, then change the
   audio buffer/device configuration. The working sound must survive the
   audio reopen. Explicit Reload must discard the draft and restore the saved
   base preset. Exercise the Save As API and immediately edit/save its result.

## Mixer consistency

- Graphical and Sliders views must agree on per-input volume, pan, mute, and
  solo. Two-input blend uses a strip; three-input blend uses a triangle and
  accessible per-input sliders. Blend must preserve the requested combined
  level within gain limits; pan changes only pan.
- Branch labels follow upstream NAM files through intervening effects. Check
  long and identical filenames. Confirm each selected mixer/output changes
  only its own incoming connections.
- Each TooB Cab IR block uses one native instance with up to three cabinets.
  Check one/two/three loaded IRs, mute endpoints, level restoration, generic
  controls, hardware bindings, snapshots, and Save/Reload. Native gain changes
  may rebuild its combined IR: check tone continuity, loading, DSP peak, and
  XRuns with the installed plugin build.
- The frontend regressions are `ui/scripts/routing-cables-regression.mjs` and
  `ui/scripts/test-cabinet-blend.mjs`. There is no separate native split-cabinet
  test target in the current engine.

## Touch, keyboard, and navigation

- At 1024×600 and 800×480, keep preset selection and Save/Reload reachable.
  Check Actions/Connections scrolling, outside-tap dismissal, and first-tap
  activation of the intended new control. Back from mixers returns to routing.
- Check tap/drag wiring in both directions, canceling on empty space, zoom,
  scrolling, grid spacing/snap, Align to Grid, and Arrange. New blocks must
  have usable positions and remain highlighted until interacted with.
- Crossing cables remain distinguishable using colors, numbers, and the named
  Connections list. Geometry must not hide overlapping cable stretches.
- Test physical encoder focus, keyboard traversal, reduced motion, and every
  built-in theme with long names and the on-screen keyboard open.
- Repeat structural edits with backing playback, looper, recorder, and drums
  active. Record uptime, DSP peak, XRuns, stereo behavior, and saved results.

Presets without `routingFormat: 1` are an older development format and their
chains are not migrated. Retain a backup before upgrading such an installation.
