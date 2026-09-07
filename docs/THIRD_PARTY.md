# Third-party components and originality policy

This document explains what Pi-MFX depends on, how it depends on it, and the
rules contributors must follow. `[../NOTICE.md](../NOTICE.md)` is the short
credit list; this is the reasoning behind it. Verbatim license texts are in
`[../licenses/](../licenses/)`.

## 1. Originality rules

Pi-MFX is MIT-licensed original work. These rules are not optional.

1. **Do not copy source from another project.** Not "adapted", not "with the
   variables renamed". This includes build files, systemd units, udev rules,
   ALSA configs, and JSON schemas.
2. **Reimplementing observable behaviour is fine.** Interoperable file formats,
  published protocols, and standard APIs (LV2, ALSA, MIDI, HTTP, WebSocket,
   TONE3000's REST API) may be implemented from their specifications.
3. **Write original UI.** Screens, theme, and interaction are implemented as
   TypeScript against the Pi-MFX API.
4. **Link, do not vendor.** Dependencies are consumed as system libraries or
  package-manager packages. If something genuinely must be vendored, it goes in
   `third_party/<name>/` with its unmodified license file and a NOTICE row.
5. **Ship no content you do not own.** No factory presets lifted from another
  product, no bundled NAM captures, no bundled impulse responses, no vendor
   device-tree overlays.
6. **Adding a dependency is a licensing decision.** New dependency means: a file
  in `licenses/`, a row in `NOTICE.md`, and a check that the license is
   compatible with MIT distribution.



## 2. What Pi-MFX links against



### LV2 (ISC)

The plugin ABI. Pi-MFX includes the LV2 headers at build time and implements the
host side itself: feature negotiation, URID mapping, `run()` scheduling, worker
threads, and state extension support.

### lilv / serd / sord / sratom / zix (ISC, David Robillard)

Plugin discovery, metadata queries, instantiation, and state save/restore. These
are the reference libraries for reading an LV2 world and there is no reason to
reimplement them. Linked dynamically from the distribution packages
(`liblilv-dev`).

### ALSA — libasound (LGPL-2.1-or-later)

The audio and MIDI path. Pi-MFX opens `hw:` devices directly, configures rate,
period size, and period count from user settings, and prefers mmap access.
Dynamically linked against the unmodified system library, so the LGPL's
relinking requirement is satisfied without further obligation.

### libsndfile (LGPL-2.1-or-later), libsamplerate (BSD-2-Clause)

Reading impulse-response files and, when an IR's rate does not match the engine,
converting it. Both dynamically linked, unmodified.

### libcurl (curl license, MIT/X-derivative)

HTTPS for the TONE3000 integration and for update checks. Dynamically linked.
Using a maintained TLS client is the responsible choice; hand-rolling HTTPS is
not.

### React, Vite, TypeScript (MIT, MIT, Apache-2.0)

The browser UI. Standard tooling, consumed through npm, listed in
`ui/package.json`. Transitive npm licenses are recorded by `npm ls --json` at
release time.

### ESP-IDF / Arduino-ESP32 (Apache-2.0) and Control Surface (GPL-3.0)

The optional controller firmware toolchain. USB MIDI uses the Control Surface
library. Pi-MFX distributes firmware **source** only; Arduino IDE supplies the
ESP32 core and libraries.

## 3. Services, formats, and hardware named in Pi-MFX



### TONE3000

Pi-MFX talks to the published TONE3000 API at [https://www.tone3000.com/api](https://www.tone3000.com/api) so
a signed-in user can browse and download **their own** models and impulse
responses. The client is written from the API documentation. Pi-MFX does not
bundle, mirror, cache for redistribution, or re-host TONE3000 content, and it
does not reuse any other project's downloader. Users authenticate with their own
account; downloaded files are governed by the licence each capture author chose
and by TONE3000's API Terms of Service, Design Requirements, and Commercial
Terms. Credit and thanks to TONE3000 and to the capture authors.

### Neural Amp Modeler

`.nam` is a published capture format from Steven Atkinson's Neural Amp Modeler
project. Pi-MFX contains no NAM DSP code; it hosts whichever NAM LV2 plugin the
user installs and passes it a model path. Model files belong to whoever made
them.

### Audio HAT vendors

HiFiBerry, Audio Injector, IQaudIO and others are named in documentation so
users can identify their board and enable the correct overlay. Those are the
vendors' trademarks, used descriptively. Pi-MFX ships no vendor files and
implies no endorsement.

## 4. LV2 plugins are not part of Pi-MFX

Plugins are independent works, frequently GPL-licensed, that the user installs.
Pi-MFX loads them at runtime through the LV2 ABI, exactly as any LV2 host does.
It does not include, modify, statically link, or relicense them, and it ships no
plugin binaries. See `[PLUGIN_LICENSES.md](PLUGIN_LICENSES.md)`.

## 5. Release checklist

Before tagging a release:

- [ ] `licenses/` covers every linked dependency, including new ones.
- [ ] `NOTICE.md` matches `licenses/`.
- [ ] `npm ls --json` reviewed for a license that MIT distribution cannot carry.
- [ ] No plugin binaries, NAM models, IR files, or third-party presets in the
  ```
  tree or in the release artifact.
  ```
- [ ] No file in the tree originates from another project's repository.