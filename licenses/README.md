# Third-party license texts

Every third-party component Pi-MFX links against has its license recorded here.
Pi-MFX does not vendor third-party source; these files exist so the licenses
travel with the repository and with any binary release.

| File | Component |
| --- | --- |
| `LV2-ISC.txt` | LV2 plugin ABI headers |
| `lilv-ISC.txt` | lilv, serd, sord, sratom, zix |
| `alsa-lib-LGPL.txt` | ALSA user-space library |
| `libsndfile-LGPL.txt` | Impulse-response file reading |
| `libsamplerate-BSD.txt` | Optional sample-rate conversion for IRs |
| `curl-MIT.txt` | libcurl (HTTPS for TONE3000 and update checks) |
| `react-MIT.txt` | React |
| `vite-MIT.txt` | Vite |
| `typescript-Apache-2.0.txt` | TypeScript |
| `esp-idf-Apache-2.0.txt` | ESP-IDF / Arduino-ESP32 firmware toolchain |
| `tinyusb-MIT.txt` | TinyUSB (USB MIDI on ESP32-S3) |
| `Apache-2.0.txt` | Full Apache License 2.0 text, referenced by the two files above |

LGPL components are dynamically linked and are not modified. Their complete
license text is long and is also installed on Debian-based systems in
`/usr/share/common-licenses/`; the files here state the exact terms that apply
and where to obtain the full text and the corresponding source.

Adding a dependency means adding its license file here **and** a row in
[`../NOTICE.md`](../NOTICE.md). No silent vendoring.
