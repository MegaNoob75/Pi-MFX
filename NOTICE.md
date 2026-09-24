# Pi-MFX notices and credits

Pi-MFX is copyright (c) 2026 Ross Morgenstern and is released under the
[MIT License](https://opensource.org/licenses/MIT) ([LICENSE](LICENSE)).

This file records third-party credits for Pi-MFX. Full license texts live in
[`licenses/`](licenses/). See [`docs/THIRD_PARTY.md`](docs/THIRD_PARTY.md) for
how those components are used, and [`docs/PLUGIN_LICENSES.md`](docs/PLUGIN_LICENSES.md)
for the LV2 plugins users install themselves.

## Pi-MFX

Pi-MFX is a headless guitar multi-effects system for the Raspberry Pi 5.
Source: <https://github.com/MegaNoob75/Pi-MFX>

Anyone on the same local network or hotspot can open the UI and control the Pi.
There is no login on the LAN HTTP or WebSocket APIs.

## Third-party components (linked, not pasted)

| Component | Use | License |
| --- | --- | --- |
| LV2 headers | Plugin hosting ABI | ISC — see [`licenses/LV2-ISC.txt`](licenses/LV2-ISC.txt) |
| lilv, serd, sord, sratom, zix | Plugin discovery and state | ISC (David Robillard) — see [`licenses/lilv-ISC.txt`](licenses/lilv-ISC.txt) |
| ALSA (`libasound`) | Audio and MIDI I/O | LGPL-2.1-or-later, dynamically linked — see [`licenses/alsa-lib-LGPL.txt`](licenses/alsa-lib-LGPL.txt) |
| libsndfile | Impulse-response file reading | LGPL-2.1-or-later, dynamically linked — see [`licenses/libsndfile-LGPL.txt`](licenses/libsndfile-LGPL.txt) |
| libsamplerate | Optional IR rate conversion | BSD-2-Clause — see [`licenses/libsamplerate-BSD.txt`](licenses/libsamplerate-BSD.txt) |
| libcurl | HTTPS for TONE3000 and update checks | curl license (MIT/X derivative) — see [`licenses/curl-MIT.txt`](licenses/curl-MIT.txt) |
| React, Vite, TypeScript | Browser UI | MIT — see [`licenses/react-MIT.txt`](licenses/react-MIT.txt), [`licenses/vite-MIT.txt`](licenses/vite-MIT.txt), [`licenses/typescript-Apache-2.0.txt`](licenses/typescript-Apache-2.0.txt) |
| ESP-IDF / Arduino-ESP32 | Controller firmware toolchain | Apache-2.0 — see [`licenses/esp-idf-Apache-2.0.txt`](licenses/esp-idf-Apache-2.0.txt) |
| Control Surface | USB MIDI on the ESP32-S3 floorboard | GPL-3.0, compiled by the user in Arduino IDE |

Pi-MFX links against these libraries as installed by the operating system or the
firmware toolchain. It does not vendor their source. If a small header ever has
to be vendored it goes in `third_party/<name>/` together with its license.

## Services and formats

- **TONE3000** — Pi-MFX can browse and download a signed-in user's NAM captures
  and impulse responses through the published TONE3000 API
  (<https://www.tone3000.com/api>). Use of that API is governed by TONE3000's API
  Terms of Service, Design Requirements, and Commercial Terms. Credit and thanks
  to TONE3000 and to the individual capture authors who publish there. Pi-MFX
  ships **no** TONE3000 content; models arrive only when a user downloads them
  with their own account. Community manifests retain the provider's tone/model
  IDs, creator, source license, filename, and checksum but never copy the asset.
  Pi-MFX is non-commercial open-source software. TONE3000's published free tier
  permits that class of integration through its OAuth selection/load flows and
  bounded lists; commercial distribution requires a separate agreement.
- **Neural Amp Modeler** — the `.nam` capture format and the NAM ecosystem are
  the work of Steven Atkinson and the NAM community. Pi-MFX hosts third-party
  NAM LV2 plugins; it does not include NAM DSP source and does not relicense any
  model.
- **Impulse responses** — supplied by the user or downloaded from TONE3000.
  Pi-MFX bundles none.
- **Patchstorage** — not used as an automatic Community Preset asset source.
  Patch licenses are selected by their individual authors and cannot be assumed
  compatible merely because a file is publicly downloadable.

## Audio HAT vendors

HiFiBerry, Audio Injector, IQaudIO, and similar boards are named in
documentation only so users can identify their hardware and find the correct
device-tree overlay from the vendor. Pi-MFX ships no vendor overlay files or
vendor code.

## LV2 plugins

Plugins are separate works with their own licenses (frequently GPL). Pi-MFX
hosts them through the LV2 ABI; it does not include, modify, or relicense them.
Users install plugins themselves. See [`docs/PLUGIN_LICENSES.md`](docs/PLUGIN_LICENSES.md).
Community manifests refer to exact LV2 URIs and an allowlisted installer ID;
they do not contain or redistribute plugin binaries. Community NAM and cabinet
IR slots are restricted to TooB Neural Amp Modeler and TooB Cab IR respectively.
