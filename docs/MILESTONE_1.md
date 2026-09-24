# Milestone 1: Backing-track playback foundation

The backing-track feature is implemented in the current `workstation` tree.
This historical checklist now separates completed implementation from the
remaining Raspberry Pi runtime sign-off.

## Implemented foundation

- [x] Dedicated backing-track library under the Pi-MFX data root
- [x] Binary WAV, FLAC, MP3, and Ogg upload path
- [x] Decode and file work outside the realtime callback
- [x] Bounded decoder-to-audio buffer
- [x] Independent backing-track level and master mix
- [x] Play, pause, stop, restart, seek, previous, and next commands
- [x] Backing Tracks view with automatic decoder-availability gating
- [x] Position, duration, format, sample rate, channel count, and waveform state
- [x] Scroll-bounded set-list panel
- [x] Integrated backing-track file manager
- [x] Basic controller actions for play/pause, stop, previous, and next

## Implemented detail

### Library and set lists

- [x] Separate the complete track library from curated performance set lists
- [x] Add named set lists with versioned persistent storage
- [x] Add/remove tracks without deleting their audio files
- [x] Reorder set-list entries and use that order for Previous/Next
- [x] Allow a track to appear more than once and in multiple set lists
- [x] Keep set lists valid after file rename, move, or deletion
- [x] Add import progress, duplicate-name handling, and clear size/storage errors

### Playback correctness

- [x] Correctly convert mono, stereo, and multichannel files to stereo
- [x] Resample files whose sample rate differs from the active audio device
- [x] Make loop-region end restart at loop start instead of looping only at EOF
- [x] Clamp seeks and loop points to the decoded track duration
- [x] Define end-of-track behavior: playback stops at the end
- [x] Prevent stale decoded frames after seek, stop, or track changes
- [x] Count position from frames actually consumed, including underrun behavior
- [x] Make all command producers safe; do not use an SPSC queue from multiple threads

### State, metadata, and waveform

- [x] Persist manual BPM and editable title, artist, album, and notes per track
- [x] Persist level and loop region per track
- [x] Generate waveform peaks only after decoder prefill
- [x] Expose empty, paused, playing, ended, and error states
- [x] Count and display decoder-buffer underruns
- [x] Throttle position updates without blocking the control or realtime threads

### Routing and hardware

- [x] Route backing tracks after the guitar effect chain
- [x] Route backing stereo to output channels 1-2 only
- [x] Add the Backing Tracks view action to Hardware Setup
- [x] Add controller LED feedback for play/pause
- [x] Make hardware Previous/Next follow the selected set-list order

### Tests and Pi validation

- [x] Add ring-buffer boundary and wraparound tests
- [x] Add playback-state, seek, loop-region, and end-of-track tests
- [x] Add mono/stereo conversion and sample-rate conversion tests
- [x] Add basic set-list persistence and playback-order tests
- [ ] Test WAV, FLAC, MP3, and Ogg on the Raspberry Pi
- [ ] Test import, waveform generation, seek, and track changes while guitar audio is active
- [ ] Run sustained playback and confirm stable CPU, bounded memory, and no xruns
- [ ] Verify imported tracks continue working with network access removed
- [ ] Verify normal effects and presets remain unchanged while backing playback is idle

## Still out of scope

- Tempo-stretching, key-shifting, and automatic tempo/key analysis
- Direct WikiLoops integration
