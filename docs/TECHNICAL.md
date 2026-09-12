# Technical overview

Pi-MFX is three original pieces that talk over HTTP, WebSocket, and USB-MIDI:

| Piece | Path | Role |
| --- | --- | --- |
| Engine | `engine/` | C++17 process: ALSA I/O, LV2 host, HTTP/WebSocket API |
| UI | `ui/` | Vite + React, served by the engine (or `npm run dev` on a PC) |
| Firmware | `firmware/esp32s3/PiMFX_Controller/` | ESP32-S3 USB-MIDI floorboard |

The screens match the MultiFX product next to this repo. The engine, protocol,
and firmware are not a fork.

## Data on the Pi

Runtime state lives in `/var/lib/pimfx` (not in the git clone). Updates and
reinstalls leave it alone unless you `--purge`.

| Path | What |
| --- | --- |
| `banks/*.json` | One file per bank |
| `settings.json` | Audio device, rate, UI, TONE3000, etc. |
| `controller.json` | Live controller: MIDI device, control bindings, **and** the current freeform layout (rects, widgets, groups, `layoutName`) |
| `layouts/*.json` | Named visual layouts (`format: pimfx-layout`). SAVE LAYOUT / SAVE AS write these, then copy the same arrangement into `controller.json` |
| `lv2/` | User-installed LV2 bundles (PatchStorage) |
| `models/`, IRs | NAM / AIDA-X / IR files |
| `backups/`, `themes/` | Backup archives and custom themes |

`layouts/*.json` is visual only: widget geometry, hidden controls, and groups.
It does not store MIDI ports or switch actions. Those stay in `controller.json`.
LOAD applies the visual JSON, then POSTs `controller/config` so Performance and
the ESP32 match immediately.

## Engine

- One process, one realtime audio thread, `hw:` mmap
- Mock ALSA backend when built off the Pi (Windows/macOS) so the API still runs
- HTTP JSON-RPC under `/api`, WebSocket at `/ws`
- Library upload for layouts, banks, models, IRs
- `system/update/status` and install job used by **Settings → System → Updates**
- `system/reboot` and `system/shutdown` used by **Settings → System** power buttons
- Helpers: `scripts/plugin-helper.py`, `scripts/hotspot.py`, `scripts/mdns.py`

Avahi publishes `pimfx.local`. Default port is **8080** (`PIMFX_PORT` / install
`--port`). There is no LAN login.

## UI

- Built into `ui/dist` and served by the engine
- Dev: `cd ui && npm run dev` is UI-only. Set `PIMFX_ENGINE=http://<pi>:8080` to proxy `/api` and `/ws`
- Designed around a 7" **1024×600** kiosk; phones and tablets scale

## Firmware

USB-MIDI SysEx, manufacturer `0x7D` + `'M'` `'F'`. Commands and identity are
documented in [CONTROLLER_PROTOCOL.md](CONTROLLER_PROTOCOL.md). Build notes
are in [DIY_CONTROLLER.md](DIY_CONTROLLER.md).

## Updates

`sudo bash ./scripts/pimfx.sh update` (or the Updates page) pulls the current
branch (`dev` in day-to-day use), rebuilds the engine and UI, copies binaries,
and restarts `pimfx.service`. Banks and `controller.json` stay put.

## Related

- [LOW_LATENCY.md](LOW_LATENCY.md) — OS changes and round-trip
- [INSTALL.md](INSTALL.md) — first-time Pi
- [DEV_FLOW.md](DEV_FLOW.md) — PC ↔ Pi loop
