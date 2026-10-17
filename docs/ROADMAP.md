# Pi-MFX feature roadmap

Pi-MFX has moved from a pedalboard-only UI to a performance, practice, and
recording workstation. All implemented features below are part of `dev`,
the active development branch.

The current priority is **1.0.0 stabilization**. Keep the present feature scope
fixed while resolving defects, tightening failure handling, checking UI
consistency, and validating the actual Pi 5. The findings and release criteria
live in [V1_READINESS.md](V1_READINESS.md). Implemented does not mean the latest
revision has passed fresh device sign-off.

| Area | Current repository state |
| --- | --- |
| Shared transport | Implemented in `dev`; current-build sign-off pending |
| Backing tracks | Implemented in `dev`; current-build sign-off pending |
| Stereo looper | Implemented in `dev`; current-build sign-off pending |
| Multitrack recorder | Implemented in `dev`; current-build sign-off pending |
| Drum machine | Implemented in `dev`; current-build sign-off pending |
| Community Presets | Implemented in `dev`; current-build sign-off pending |
| 1.0 · Stabilization | Active priority; see readiness report |

## Development and release strategy

- `main` is the release branch and `dev` is the active development branch.
- Current features are developed together on `dev`; use a short-lived branch
  when isolation helps test a change. Branch history is not a release gate.
- Freeze and document the supported file formats for 1.0. The existing
  development routing break does not migrate old chains; back up before that
  upgrade. Future compatibility promises need explicit migration tests.
- File I/O, network access, decoding, persistence, waveform generation, export,
  and resampling stay outside `Engine::processAudio()`.
- A passing desktop UI build proves the web code compiles. It does not prove
  Raspberry Pi ALSA, LV2, touch, physical-controller, latency, or XRun behavior.

## Shared musical transport

Implemented:

- Engine-owned BPM, tap history, time signature, play state, beat/bar, and
  sample position
- Count-in, metronome, quantization preference, and hardware actions
- Shared transport state across connected UIs
- LV2 time-position delivery for compatible tempo-aware effects
- One clock for backing, looper, recorder, and drums

## Backing-track playback

Implemented:

- WAV, FLAC, MP3, and Ogg import; mono/multichannel conversion and resampling
- Play, pause, stop, seek, restart, waveform, metadata, level, and loop region
- Named set lists with reorderable entries and Previous/Next hardware actions
- Independent post-chain stereo routing and bounded decode buffers
- File management, rename/move/delete repair, and underrun reporting

## Stereo looper

Implemented:

- One stereo loop with record, finish/play, overdub, stop, restart, mute,
  undo/redo, and guarded clear
- Free, next-beat, and next-bar modes using the shared transport
- Count-in, loop level, overdub feedback, waveform, save/export, and library
- Hardware actions and performance-widget states

## Multitrack recorder

Implemented:

- Raw guitar, processed guitar, backing, drum, and master sources
- Project/take storage with independent arm, mute, solo, level, and pan
- Synchronized Record with Backing workflow
- Timeline editing, recovery metadata, stem export, and stereo mix export
- Remaining-storage and write-status reporting

## Drum machine

Implemented:

- User sample library and custom kits
- 16/32/64-step patterns with velocity, accents, swing, and humanization
- Fills, four variations, song-section chains, count-in, and transport sync
- Recorder/master routing plus hardware actions

Generated bass/keyboard accompaniment, intros/endings, and a full chord-chart
arranger remain future work.

## Community Presets

Implemented:

- Fixed reviewed catalog with cached offline browsing
- Strict declarative manifest validation, checksums, compatibility, and limits
- Trusted PluginStore and TONE3000 dependency resolution
- Short-lived reviewed installation plans and Community-bank provenance
- Share Preset manifest creation and human-reviewed GitHub submission flow
- Duplicate-name/content protection and uninstall cleanup

Security and publishing details are in [COMMUNITY_PRESETS.md](COMMUNITY_PRESETS.md).

## Cross-feature release requirements

- One engine transport and sample clock; no competing timers in individual views
- Explicit routing for guitar, loop, backing, drums, recorder, and master
- No filesystem, network, decode, allocation, persistence, export, resample, or
  waveform work in the realtime callback
- Bounded queues with visible overrun/underrun and recovery behavior
- Versioned, recoverable project, recording, drum, and community formats
- Hardware Setup actions and visible feedback for live-performance commands
- Backups that account for large user media without silently omitting data
- Existing effects, presets, snapshots, controller behavior, and offline use
  remain stable when workstation services are idle
