# Technical overview

Pi-MFX is three original pieces that talk over HTTP, WebSocket, and USB-MIDI:

| Piece | Path | Role |
| --- | --- | --- |
| Engine | `engine/` | C++17 process: ALSA I/O, LV2 host, HTTP/WebSocket API |
| UI | `ui/` | Vite + React, served by the engine (or `npm run dev` on a PC) |
| Firmware | `firmware/esp32s3/PiMFX_Controller/` | ESP32-S3 USB-MIDI floorboard |

The engine, protocol, firmware, and browser UI are maintained in this repository.
This describes the current `dev` implementation; audit repairs and pending
release validation are recorded in [V1_READINESS.md](V1_READINESS.md).

## Data on the Pi

Runtime state lives in `/var/lib/pimfx` (not in the git clone). Updates and
reinstalls leave it alone unless you `--purge`.

| Path | What |
| --- | --- |
| `banks/*.json` | One file per bank |
| `settings.json` | Version 4: audio, UI, system, transport, looper, controller config/layout, Virtual Controls, active bank/preset IDs |
| `banks-transaction.json` | Durable roll-forward journal for multi-bank writes; retained if completion fails |
| `access.json` | Password hash and remembered browser-token hashes; separate from exported settings |
| `credentials.json` | TONE3000 configuration and authentication material |
| `layouts/*.json` | Named visual layouts (`format: pimfx-layout`), applied to controller settings |
| `virtual-control-layouts/` | Named Virtual Controls layouts |
| `controller-profiles/`, `setup-profiles/` | Controller-only profiles and broader setup profiles |
| `lv2/` | User-installed LV2 bundles (PatchStorage) |
| `models/`, `aidax/`, `irs/` | NAM / AIDA-X / IR files |
| `backups/`, `themes/`, `bank-exports/` | Legacy configuration JSON, custom themes, and preset/bank JSON exports |
| `backing-tracks/` | Imported backing-track audio, metadata, and set lists |
| `loops/` | Saved stereo-looper WAV files |
| `recordings/` | Multitrack projects, takes, recovery data, and exports |
| `drums/` | User samples, kits, patterns, variations, and song chains |
| `community/` | Trusted catalog cache, provenance, and install journals |
| `tone3000-assets.json` | Installed model/IR provenance |
| `engine-running` | Startup guard marker; an unclean exit triggers a safe recovery preset |

`layouts/*.json` is visual only: widget geometry, hidden controls, and groups.
It does not store MIDI ports or switch actions. Those stay in the `controller`
section of `settings.json`; `controller.json` is not an active persistence
store in this revision. The unused legacy accessor has been removed.
LOAD applies the visual JSON, then POSTs `controller/config` so Performance and
the ESP32 match immediately.

Base-preset edits live in `sessionPresetDrafts_`, owned by the engine. They
survive preset navigation in that process but are excluded from bank
serialization. Save promotes the draft and Reload discards it. Snapshot
capture/update is a separate operation. The `persist` parameter retained on
control APIs does not make a base-preset drag/release a disk save.

Bank exports use `formatVersion: 2`, individual preset exports use version 2,
routing uses `routingFormat: 1`, and Community manifests use version 3 (the
catalog index/cache remains version 2). Old preset chains without the routing
marker are not migrated. These format numbers are independent of the planned
application version 1.0.0.

## Engine

- One process, one realtime audio thread, `hw:` mmap
- Mock ALSA backend when built off the Pi (Windows/macOS) so the API still runs
- HTTP command endpoints under `/api/<command>`, WebSocket at `/ws`
- Library upload for layouts, banks, models, IRs
- `system/update/status` and install job used by **Settings → System → Updates**
- `system/reboot` and `system/shutdown` used by **Settings → System** power buttons
- Helpers: `scripts/plugin-helper.py`, `scripts/hotspot.py`, `scripts/mdns.py`
- Engine-owned transport, backing, looper, recorder, and drum services publish
  compact state messages without doing file, decode, network, or export work in
  the realtime callback.

Avahi publishes `pimfx.local`. Default port is **8080** (`PIMFX_PORT` / install
`--port`). `AccessControl` gates remote HTTP and WebSocket access using a
password and persistent browser sessions. Actual loopback clients using the
expected host remain unlocked for the kiosk. HTTP does not provide encryption.
See [REMOTE_ACCESS.md](REMOTE_ACCESS.md).

### Ownership and thread boundaries

- The audio callback processes a prepared graph, transport, and media buses.
  Graph topology and plugin construction stay off that callback.
- A preparation worker pumps newly created LV2 instances while their model/IR
  workers load. It skips retained instances and cancels obsolete generations.
- `LatestPointerMailbox` holds the newest unpublished chain. Audio swaps it at
  the transition boundary; housekeeping reclaims retired chains after a grace
  period and after control readers release their guards.
- Structural edits retain unaffected plugin instances and rebind audio buffers
  on publication. Model/IR changes and snapshots use staged transitions.
- Each TooB Cab IR block currently hosts one native instance. There is no
  separate-processor cabinet blend implementation in this revision.
- The API has a bounded background work queue for catalog, plugin, Community,
  most TONE3000 commands, and heavy library/media operations. Queued request
  bodies have an aggregate byte limit. Immediate performance commands remain
  outside that queue; state-changing HTTP commands require POST.
- Backing decoding, loop saves, and recorder writes use background workers.
  Device reconfiguration joins the loop/recorder workers after stopping audio
  and before replacing buffers. Recording/finalization and loop file activity
  block unsafe reconfiguration. Loop save/load and overdub preparation require
  an audio-block buffer lease; queued/scheduled edits prevent that lease.

Full/performance snapshots carry an engine epoch and revision. Browsers reject
stale snapshots while retaining newer partial updates over unrelated full-state
fields. Performance assignments use per-switch patches under the engine state
lock, avoiding whole-controller replacement for assignment changes.

Frequent engine/recorder state publishes nonblocking recorder status. Full
recorder details are requested through the API worker or periodically published;
the browser merges status-only updates without discarding project details.
Recorder Stop/Pause avoid the file-work queue and metadata scans.

These are implementation contracts; native builds, race checks, and device
stress validation remain with the maintainer on the Pi 5.

### Persistence guarantees and limits

`writeFileAtomic` writes a sibling temporary file and renames it. Its optional
durable mode also syncs file and directory on Linux. Settings, single-bank,
multi-bank, and recorder project/recovery saves request that mode. The recorder
checks audio writes/flushes, waits for an admitted final capture block, and
retains recovery metadata if audio finalization or project persistence fails.
Recovery uses actual file length and avoids importing an already stored take
twice. Validate these paths on the target filesystem; hardware-level power-loss
behavior is not established by source inspection.

Recorder projects retain their own sample rate. Opening/playing/exporting a
mismatched project is rejected; changing device rate with recorded clips
requires choosing an empty project first. Buffer-only changes preserve the
recording playback position. Explicit preset Reload discards the draft;
audio-device reopen preserves the audible working preset/snapshot state.

`scripts/backup.py` implements versioned ZIP64 recovery archives (DEFLATE level
6) with file checksums, optional password encryption, exact plugin inventory,
selective restore and a durable root-directory replacement journal. Smaller
archives record repository package URLs/sizes/SHA-256 for verified downloads
before restore; self-contained archives include the installers. Manual plugins
and packages without reproducible download records remain bundled. Format 2
supports these records and the reader retains format-1 compatibility.
The privileged helper launches independent systemd jobs; the engine prepares
unsaved drafts/current loops and pauses for the consistent copy or restore.
Kiosk keyboard/behavior preferences migrate into `ui.browserPreferences`.
The root recovery workspace is beside the data root, and a boot guard resolves
unfinished restores before the engine starts. Data rollback does not undo apt
or OS-setup changes. See [BACKUP_RESTORE.md](BACKUP_RESTORE.md) for the format,
operational limits and required Pi validation.

## UI

- Built into `ui/dist` and served by the engine
- Dev: `cd ui && npm run dev` proxies `/access`, `/api`, and `/ws` to `127.0.0.1:8080`
- Designed around a 7" **1024×600** kiosk; phones and tablets scale
- Shared UI-session state keeps navigation, editors, scroll positions, and
  hardware focus coherent across connected browsers and the physical encoder.
- `ui/docs.html` supplies representative read-only state for regenerating the
  documentation gallery without a connected Pi.

## Firmware

USB-MIDI SysEx, manufacturer `0x7D` + `'M'` `'F'`. Commands and identity are
documented in [CONTROLLER_PROTOCOL.md](CONTROLLER_PROTOCOL.md). Build notes
are in [DIY_CONTROLLER.md](DIY_CONTROLLER.md).

## Updates

`sudo bash ./scripts/pimfx.sh update` (or the Updates page) pulls the current
branch (`dev` in day-to-day use), rebuilds the engine and UI, copies binaries,
and restarts `pimfx.service`. Data under `/var/lib/pimfx`, including banks and
`settings.json`, stays put. Format compatibility still matters on development
upgrades; retain a backup before crossing a format break.

The engine currently declares version `0.6.0`, the UI package `0.1.0`, and the
controller firmware `1.1`. About uses the engine's version and build commit.
Align application release metadata intentionally when the 1.0 candidate is
approved; controller and data-format versions can remain independent.

## Related

- [LOW_LATENCY.md](LOW_LATENCY.md) — OS changes and round-trip
- [INSTALL.md](INSTALL.md) — first-time Pi
- [DEV_FLOW.md](DEV_FLOW.md) — PC ↔ Pi loop
