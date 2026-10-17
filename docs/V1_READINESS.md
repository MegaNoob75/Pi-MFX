# Pi-MFX 1.0 readiness and validation

Updated: **2026-10-14**. The source audit began at `dev`, `9211c0e`.
The working changes now implement the remedies below. They have not been
compiled or runtime-tested here. Native compilation and device testing are
performed by the maintainer on the Pi 5. This is not a 1.0 release sign-off.

All current features are part of `dev`. Separate branches were used to test
individual features during development, not to define product release stages.
New feature work stays deferred while this candidate is stabilized.

## Audit remediation status

| Finding | Implemented behavior | Required Pi verification |
| --- | --- | --- |
| F1: media buffers during audio restart | Reconfiguration is serialized with media control, rejects active recording/finalization or loop file activity, and joins the media workers after stopping audio and before replacing buffers. Shutdown finishes audio before draining recorder files. | Reconfigure during save, loading, capture, finalization, idle and playback; no invalid access, lost take, or hung worker. |
| F2: recorder write/persistence failures | Writes and flushes are checked; a failure stops capture and reports an error. The writer counts accepted blocks, bounds final headers by actual file size, and retains recovery data until audio and project persistence succeed. Recovery uses actual take bytes and avoids duplicate imports. Project/recovery JSON saves request durable writes. | Constrained/full/read-only test volume; interrupted take, failed project save, restart recovery, no false success or duplicate clips. |
| F3: queued/quantized loop edits during file work | Save, Load and overdub-buffer copying acquire an audio-block buffer lease. An active recording/overdub or queued/scheduled edit rejects the lease. Saving retains it until the file worker finishes; fixed-delay guessing is removed. | Quantized Overdub then Save/Load before the boundary; rapid Undo/Redo/Clear; ordinary save/load and audio-off failure. |
| F4: draft lost on audio reopen | Audio restart rebuilds the effective audible working preset, capturing live controls/files/routing first. Explicit preset Reload still discards the draft and restores the saved base. | Unsaved control, model, routing and snapshot changes survive device/buffer restart; explicit Reload still discards edits. |
| F5: recording project clock | Project sample rate is retained. Mismatched open/play/export is rejected; changing rate with recorded clips requires an empty project. Buffer-only changes retain playback position. | 48 kHz project at 44.1/96 kHz; saved metadata, duration, pitch and exports must remain correct. |
| F6: Save As identity | Save As guards preparation and snapshots, builds/publishes a retained-processor chain with the new preset ID, and reports settings-save failure. | Immediately change controls, Save, use snapshots and switch presets after the API call. |
| F7: false persistence success | Preset rename saves a staged bank before changing live metadata. Settings and snapshot paths report failures; settings retry through housekeeping and expose a persistence error. Ordinary bank/settings saves request durable sync. | Block save targets and fill storage; no successful-looking rename/save, no inconsistent active bank after deletion, retry after storage recovery. |
| F8: stale Files results | Refresh generations guard listings, trees, errors and busy state; old rows/selections are cleared while navigating. Cleanup invalidates obsolete requests. | Navigate quickly between folders/categories with delayed responses; rows and file actions must match the current location. |
| F9: success after failure | Performance, Editor and Snapshot actions perform success notifications/navigation only inside the successful request path. Structural preparation timeout rejects instead of resolving as success. | Reject assignment, file-property, snapshot and structural requests; no success toast or success-only navigation. |
| F10: HTTP thread blocked by media work | Heavy media/library handlers use the bounded worker queue, including binary uploads, exports and recorder details. Queued HTTP/socket body bytes are capped. Recorder export mixes an immutable metadata snapshot without holding its state lock for the export duration. Frequent state uses nonblocking recorder status; Stop/Pause stay available while Play/Seek use the worker queue. | Import/export while operating another browser and the floorboard; commands/meters remain usable, memory stays bounded. |

The main implementation is in [Engine](../engine/src/Engine.cpp),
[looper](../engine/src/looper/StereoLooper.cpp),
[recorder](../engine/src/recorder/MultitrackRecorder.cpp),
[API router](../engine/src/control/ApiRouter.cpp),
[browser client](../ui/src/api.ts), and the affected view components.

## Additional hardening and cleanup

- Full/performance state includes an engine epoch and monotonic revision.
  Clients reject old replies, admit a restarted engine, and overlay a newer
  performance update without losing unrelated full-state fields.
- Performance switch assignments send per-control patches. The engine merges
  them under its state lock, preserving unrelated changes from other browsers.
- General state-changing HTTP API commands require POST; unsupported methods
  return 405. Authentication/origin checks remain separate protections.
- Drum-kit retirement retains a deferred pointer and delays another swap if
  its retirement queue is full; ownership is not lost.
- A 30-second model-preparation timeout is visible in state/meters and the UI,
  with Reload/select-another-preset guidance. The existing muted transition
  fallback is retained. A native plugin that never returns can still require
  a service restart; in-process hosting cannot forcibly terminate its thread.
- Shared confirmation dialogs have modal labeling, keyboard focus handling,
  Escape behavior and focus return. Verify these with the physical encoder,
  keyboard, nested dialogs and on-screen keyboard.
- Removed the unused controller-file accessor and corrected controller-storage
  and starter-bank comments. Queue payloads enforce trivial copyability; lock
  ordering and audio-buffer ownership contracts are documented near the code.
- Existing startup/service availability checks remain. No temporary System
  feature switches were added. Broad class extraction, dependency upgrades,
  typography redesign and a release-version bump are outside this repair.
- Backing playback invalidates prefilled old-rate audio after device rate
  changes. Confirm the transition on hardware.

Keep user-data formats explicit: current routing is version 1, preset/bank
exports version 2, Community manifests version 3, and catalog cache version 2.
Older development chains without `routingFormat: 1` are not migrated. Back up
before that upgrade. No application version or Git tag was changed here.

## Regression checks prepared for the Pi

The existing `stereo_looper` CTest now exercises audio-block file/edit leases
and rejection of save/load over a quantized pending overdub. The existing
`multitrack_recorder` test covers sample-rate rejection, an admitted capture
finishing after Stop, and a blocked project save preserving the stored file.

`ui/tests/stateOrdering.test.cjs` exercises the actual public EngineClient
against controlled HTTP/WebSocket deliveries: old full/partial updates,
full-only metadata under a newer partial update, recorder-detail retention,
and engine restart epochs.
Run it from `ui/` with:

```sh
node tests/stateOrdering.test.cjs
```

Build the engine on the Pi with `BUILD_TESTING=ON`, then run its CTest suite
with failure output. Registered tests include `startup_guard`, `access_control`,
`audio_safety_transition`, `community_preset_package`, `musical_transport`,
`drum_sequencer`, `drum_machine`, `stereo_looper`, `multitrack_recorder`, and
`backing_track_player` when decoder dependencies are available. Run frontend
type checking/build and the existing UI regressions as well, including:

```sh
node scripts/routing-cables-regression.mjs
node scripts/test-cabinet-blend.mjs
```

These checks are prepared, not recorded as passing. A clean diff or a matching
source-text assertion is not behavioral or audio evidence.

## Device release checklist — pending

1. Record commit/build SHA, OS/kernel, interface, negotiated rate/period/count,
   plugin versions, model/IR files and duration. Keep a full recovery copy of
   the data root and a known working build. Capture failed state/logs before
   rebooting. No GitHub publication or deployment was performed by this repair.
2. Complete every row of the remediation table, including constrained-storage
   tests on disposable data. Inspect actual saved JSON and WAV content after
   restarting, not only the UI status.
3. Run [routing/mixer validation](ROUTING_VALIDATION.md), including repeated
   plugin construction/retirement, disconnected/bypassed branches, model loads,
   structural edits and rejected cycles while workstation services are active.
4. Exercise backing seek/loop/set lists, quantized looper overdub/undo/save/load,
   multitrack capture/playback/export/recovery, drums and shared transport,
   separately and together. Check stereo channels, lengths, pitch, last-block
   capture and transport ownership.
5. Test Save/Reload, Save As, rename/reorder/move/delete and library dependency
   protection. Restore configuration/setup profiles and banks/assets on a
   disposable setup. Validate full/selective recovery archives on a fresh OS
   using [BACKUP_RESTORE.md](BACKUP_RESTORE.md), including corruption and rollback.
6. Run the [remote-access checklist](REMOTE_ACCESS.md), offline startup/use,
   Wi-Fi/hotspot transitions, two-browser concurrent edits/reconnects and
   password revocation during pending operations.
7. Test 1024x600, 800x480, tablet and phone layouts with long names, dense
   routing, large libraries and the keyboard open. Keep primary actions visible
   without unwanted vertical scrolling. Compare all built-in themes, focus,
   active/disabled/error states, labels, reduced motion and touch targets.
8. Verify pop-outs close on outside interaction and replacing a pop-out lets
   the new control work on the first tap. Check Editor, Performance, Virtual
   Controls, mixers and physical encoder navigation. Test firmware 1.1 controls
   and LEDs plus unplug/reconnect and clean/crash startup recovery.
9. Proposed soak: two hours with the intended worst-case supported rig, then
   an overnight idle/reconnect cycle. Record DSP peak, process CPU, memory,
   temperature, XRuns and media underruns before/after. Require no crash/hang,
   no unexplained memory growth, no lost acknowledged saves, and zero
   steady-state XRuns at the advertised configuration. Classify deliberate
   device-reconfiguration interruptions separately.
10. After fixes and device sign-off, review exact dependency notices and release
    contents, clean install, update/rollback from supported versions, format
    compatibility and release notes. Set application release metadata and
    tag/publish only after explicit approval.

| Build / setup | Scenario / duration | Expected | Observed / logs | Pass / owner |
| --- | --- | --- | --- | --- |
| Pending | Pending | Pending | Not run in this repair | Pending |

## Validation boundaries

Local static checks passed: whitespace/error checks for the diff, syntax
parsing of all seven changed TypeScript/TSX files, syntax checking of the new
JavaScript regression, and 122 local documentation targets across 22 Markdown
files with no missing targets. Excluded image/workflow targets were skipped.
These checks do not compile C++ or type-check/run the UI.

The root `.gptignore` and additional exclusions apply. Images, branding,
cache/dependency/build directories and `.github/` are outside inspection;
images were not regenerated and publishing workflows were not revalidated.
No native build, runtime tests, touchscreen/audio tests, deployment, commit,
push or tag was performed on Windows. Static source/diff and documentation
link checks are the local verification boundary. Raspberry Pi sign-off remains
required before treating the repairs as validated or publishing 1.0.0.
