# Pi-MFX feature roadmap

This roadmap extends Pi-MFX from a guitar multi-effects unit into a performance,
practice, recording, and community-sharing workstation. The existing low-latency
guitar path remains the priority: new playback and recording work must not block
the realtime audio callback or destabilize normal preset use.

## Development strategy

- Keep `main` for releases and `dev` for the current usable development version.
- Develop this roadmap on a separate long-lived feature branch.
- Divide the work into milestones that can be tested and merged independently.
- Keep new file formats versioned and backward compatible.
- Feature-gate incomplete views and engine services so ordinary effects use stays
  unchanged while a milestone is under development.
- Validate latency, CPU use, xruns, storage behavior, and hardware controls on a
  Raspberry Pi before calling an audio milestone complete.

## Milestone 0: shared musical transport and completed tap tempo

Tap tempo is already available in the engine, API, Performance View, and Hardware
Setup. It currently calculates and stores a preset BPM, but it is not yet a shared
clock for effects and other musical features.

Add one engine-owned transport containing:

- BPM, tap history, time signature, play state, beat, bar, and sample position
- sample-accurate clock information for the audio engine
- LV2 time-position delivery for compatible tempo-aware effects
- count-in, metronome, and optional quantization settings
- future MIDI clock input/output support
- state messages for all connected UIs and hardware indicators

This transport becomes the sole timing authority for the looper, backing tracks,
recorder, drum machine, and future accompaniment engine.

Completion criteria:

- Tap tempo remains assignable in Hardware Setup.
- The displayed BPM and transport agree across connected UIs.
- Compatible time-based effects follow tempo without interrupting audio.
- Tempo changes cannot allocate memory or perform disk/network work in the realtime
  callback.

## Milestone 1: backing-track playback foundation

Add an engine-owned player and a Backing Tracks view:

- WAV, FLAC, MP3, and Ogg import and playback
- play, pause, stop, seek, restart, and loop-region controls
- waveform, duration, position, level, and track metadata
- manual BPM plus later tempo/key analysis
- independent routing and level so tracks do not pass through the guitar chain
- set-list and playlist support
- hardware actions for transport, previous/next track, and backing-track view

Audio must be decoded and streamed outside the realtime callback into bounded
buffers. Loss of network access must not affect already imported tracks.

## Milestone 2: stereo looper

Add an engine looper and dedicated Looper View:

- record, play, overdub, stop, undo, redo, and clear
- free-length and beat/bar-quantized operation
- optional count-in, loop level, and overdub feedback
- waveform and unmistakable armed/recording/playing/overdubbing states
- safe save and export
- hardware actions and LED states for all performance-critical commands
- hold or confirmation for destructive clear operations

The first release is one stereo loop. Multiple synchronized loops can be evaluated
after the single-loop implementation is stable on the Pi.

## Milestone 3: multitrack recorder

Reuse the transport, buffering, waveform, and file-writing foundations to add:

- raw guitar input, processed guitar output, backing-track, drum, and master sources
- multiple independently armed tracks
- WAV recording, mute, solo, level, pan, rename, and delete
- timeline with basic trim, split, move, and fades
- individual stem export and stereo mix export
- remaining-storage and write-speed warnings
- recovery metadata for interrupted recordings or power loss

This is initially a performance recorder, not a complete DAW. Per-track effect
chains and advanced editing are later features.

## Milestone 4: drum machine

First release:

- sample-based kits and a 16/32/64-step pattern editor
- velocity, accents, swing, fills, and humanization
- pattern variations and song-section chains
- transport synchronization and count-in
- start/stop, fill, variation, and pattern hardware actions
- routing to the recorder and master output

Later accompaniment release:

- chord chart and song-section editor
- generated drum, bass, and optional keyboard parts
- intros, endings, fills, variations, key changes, and tempo changes
- an original Pi-MFX workflow and implementation rather than reused JJazzLab code

## Milestone 5: community preset catalog

### Package contents

A shared preset package is declarative data only:

- versioned Pi-MFX preset, snapshot, assignment, tempo, and gain settings
- effect LV2 URIs and identifiers from the trusted Pi-MFX plugin catalog
- TONE3000 model IDs, architecture, and expected filenames
- IR source identifiers where a supported provider offers stable identifiers
- author, description, tags, license, compatibility information, and checksums
- optional safely re-encoded preview image and audio

Packages must never contain plugins, models, IRs, executables, scripts, installer
commands, HTML, JavaScript, SVG, symlinks, or arbitrary download URLs.

### Submission and publishing

- The Pi-MFX UI creates the manifest from the active preset and provides a
  **SHARE PRESET** flow.
- A signed-in user submits to a quarantine service, not directly to the public
  repository.
- Apply account verification, rate limits, size/count limits, archive safety,
  schema validation, malware scanning, duplicate checks, and content review.
- Safely decode/re-encode preview media and reconstruct a clean package rather
  than publishing the uploaded archive.
- Test-load the declarative preset in an isolated Pi-MFX environment without
  executing uploader-supplied code.
- Require human approval initially. A publishing bot is the only writer to the
  protected public catalog repository.

### Installation

The UI displays an installation plan before making changes:

1. Validate compatibility and list all requirements.
2. Match effects only against the trusted Plugins catalog.
3. Install approved missing effects through the existing Plugins code.
4. Resolve supported NAM and IR references through the existing TONE3000 code,
   respecting authentication, licensing, and availability.
5. Ask the user to locate unavailable assets; never silently substitute them.
6. Import into a new community bank without overwriting user data.
7. Roll back cleanly or mark the preset incomplete if a dependency cannot be
   installed.

No GitHub credential or shared publishing secret is stored on the Pi.

## Milestone 6: WikiLoops and other backing-track sources

First establish local backing-track import. Direct WikiLoops access is added only
through an official supported integration that preserves user authentication,
download limits, attribution, licensing, and remix lineage.

If direct integration is not available, Pi-MFX can still:

- open a selected track on WikiLoops
- import a file the signed-in user legitimately downloaded
- retain track ID, creator attribution, source link, and collaboration lineage

Provider downloads must pass through the same safe local media-import path used by
ordinary backing tracks.

## Cross-feature requirements

- One engine transport and sample clock; no competing timers in individual views
- Explicit audio routing for guitar, loop, backing track, drums, recorder, and master
- No filesystem, network, decoding, allocation, or locking hazards in realtime code
- Bounded memory and disk queues with visible overrun/error reporting
- Versioned project, recording, and community-preset formats
- Recoverable destructive operations wherever practical
- Hardware Setup actions and visible feedback for every live-performance command
- Backups include user-created loops, recordings, songs, and imported presets, with
  large media made optional when necessary
- Existing effects, presets, snapshots, controller behavior, and offline operation
  remain usable throughout development

