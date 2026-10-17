/* Pi-MFX universal ESP32-S3 USB-MIDI controller.
 * Open this sketch in Arduino IDE. All files in this folder are required.
 * Libraries: Control Surface and Adafruit NeoPixel.
 * Board: ESP32S3 Dev Module; USB-OTG (TinyUSB); CDC on Boot disabled.
 * Partition: Minimal SPIFFS (1.9MB APP with OTA/190KB SPIFFS), >=4MB flash.
 * Wiring is configured in Pi-MFX Hardware Setup, not in this sketch.
 * Implementation is in ordinary C++ to avoid Arduino auto-prototype rewriting
 * of the protocol's namespace-local types and default arguments.
 */
void pimfxControllerSetup();
void pimfxControllerLoop();
void setup() { pimfxControllerSetup(); }
void loop() { pimfxControllerLoop(); }
