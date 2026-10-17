# Third-party license texts

This folder records third-party license texts and dependency notices.
Pi-MFX does not vendor third-party source; these files exist so the licenses
travel with the repository and with any binary release.

| File | Component |
| --- | --- |
| `LV2-ISC.txt` | LV2 plugin ABI headers |
| `lilv-ISC.txt` | lilv, serd, sord, sratom, zix |
| `alsa-lib-LGPL.txt` | ALSA user-space library |
| `libsndfile-LGPL.txt` | Backing-track audio decoding |
| `libsamplerate-BSD.txt` | Backing-track sample-rate conversion |
| `curl-MIT.txt` | libcurl (HTTPS for TONE3000 and update checks) |
| `OpenSSL.md` | OpenSSL Crypto version/license notes; OpenSSL 3.x uses the included Apache-2.0 text |
| `react-MIT.txt` | React |
| `vite-MIT.txt` | Vite |
| `typescript-Apache-2.0.txt` | TypeScript |
| `esp-idf-Apache-2.0.txt` | ESP-IDF / Arduino-ESP32 firmware toolchain |
| `tinyusb-MIT.txt` | TinyUSB (USB MIDI on ESP32-S3) |
| `Apache-2.0.txt` | Full Apache License 2.0 text for the notices that reference it |

LGPL components are dynamically linked and are not modified. Their complete
license text is long and is also installed on Debian-based systems in
`/usr/share/common-licenses/`; the files here state the exact terms that apply
and where to obtain the full text and the corresponding source.

Adding a dependency means adding its license file here **and** a row in
[`../NOTICE.md`](../NOTICE.md). No silent vendoring.

The 2026-10-14 inventory identified remaining release work: collect notices
for the exact Control Surface and Adafruit NeoPixel versions used to build
firmware, inventory the resolved browser dependency licenses, and capture
the actual linked system-library notices. Existing short notice files and
this table are not a completed binary-distribution audit. Track that sign-off
in [1.0 readiness](../docs/V1_READINESS.md).
