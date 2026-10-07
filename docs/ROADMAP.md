# Pi-MFX feature roadmap

Pi-MFX has moved from a pedalboard-only UI to a performance, practice, and
recording workstation. Milestones 0-5 are complete and merged into `dev`,
which is the active development branch.

| Milestone | Current repository state |
| --- | --- |
| 0 · Shared transport | Complete in `dev` |
| 1 · Backing tracks | Complete in `dev` |
| 2 · Stereo looper | Complete in `dev` |
| 3 · Multitrack recorder | Complete in `dev` |
| 4 · Drum machine | Complete in `dev` |
| 5 · Community Presets | Complete in `dev` |
| 6 · External backing sources | Not started; requires provider-supported integration and licensing design |

## Development and release strategy

- `main` is the release branch and `dev` is the active development branch.
- Milestone branches were temporary development branches. Completed milestones
  0-5 have been merged into `dev`; new work continues from `dev` unless a
  short-lived feature branch is useful.
- New file formats stay versioned and backward compatible.
- File I/O, network access, decoding, persistence, waveform generation, export,
  and resampling stay outside `Engine::processAudio()`.
- A passing desktop UI build proves the web code compiles. It does not prove
  Raspberry Pi ALSA, LV2, touch, physical-controller, latency, or XRun behavior.

## Milestone 0: shared musical transport

Implemented:

- Engine-owned BPM, tap history, time signature, play state, beat/bar, and
  sample position
- Count-in, metronome, quantization preference, and hardware actions
- Shared transport state across connected UIs
- LV2 time-position delivery for compatible tempo-aware effects
- One clock for backing, looper, recorder, and drums

## Milestone 1: backing-track playback

Implemented:

- WAV, FLAC, MP3, and Ogg import; mono/multichannel conversion and resampling
- Play, pause, stop, seek, restart, waveform, metadata, level, and loop region
- Named set lists with reorderable entries and Previous/Next hardware actions
- Independent post-chain stereo routing and bounded decode buffers
- File management, rename/move/delete repair, and underrun reporting

## Milestone 2: stereo looper

Implemented:

- One stereo loop with record, finish/play, overdub, stop, restart, mute,
  undo/redo, and guarded clear
- Free, next-beat, and next-bar modes using the shared transport
- Count-in, loop level, overdub feedback, waveform, save/export, and library
- Hardware actions and performance-widget states

## Milestone 3: multitrack recorder

Implemented:

- Raw guitar, processed guitar, backing, drum, and master sources
- Project/take storage with independent arm, mute, solo, level, and pan
- Synchronized Record with Backing workflow
- Timeline editing, recovery metadata, stem export, and stereo mix export
- Remaining-storage and write-status reporting

## Milestone 4: drum machine

Implemented:

- User sample library and custom kits
- 16/32/64-step patterns with velocity, accents, swing, and humanization
- Fills, four variations, song-section chains, count-in, and transport sync
- Recorder/master routing plus hardware actions

Generated bass/keyboard accompaniment, intros/endings, and a full chord-chart
arranger remain future work.

## Milestone 5: community preset catalog

Implemented:

- Fixed reviewed catalog with cached offline browsing
- Strict declarative manifest validation, checksums, compatibility, and limits
- Trusted PluginStore and TONE3000 dependency resolution
- Short-lived reviewed installation plans and Community-bank provenance
- Share Preset manifest creation and human-reviewed GitHub submission flow
- Duplicate-name/content protection and uninstall cleanup

Security and publishing details are in [MILESTONE_5.md](MILESTONE_5.md).

## Milestone 6: external backing-track sources

Local backing-track import comes first. Direct WikiLoops or another provider is
only appropriate through a supported integration that preserves authentication,
download limits, attribution, licensing, and remix lineage.

If a direct integration is unavailable, Pi-MFX can still support a safe workflow
that opens the provider page and imports a file the signed-in user legitimately
downloaded. Imported media must pass through the same bounded local validation
path as ordinary backing tracks.

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
