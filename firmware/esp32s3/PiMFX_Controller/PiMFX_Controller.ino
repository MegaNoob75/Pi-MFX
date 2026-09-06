/*
 * Pi-MFX USB-MIDI floorboard for ESP32-S3.
 *
 * Speaks the protocol in docs/CONTROLLER_PROTOCOL.md:
 *   identity request 0x01 / reply 0x10, set-LED 0x02, CC for switches and pots.
 * Flash this sketch, not the earlier MultiFX controller firmware.
 *
 * Arduino IDE needs these libraries installed (PlatformIO already lists them):
 *   Adafruit TinyUSB Library
 *   Adafruit NeoPixel
 * Tools → USB Mode must be USB-OTG (TinyUSB).
 */

#include "Adafruit_TinyUSB.h"
#include <Adafruit_NeoPixel.h>

#include "Pins.h"
#include "Protocol.h"

Adafruit_USBD_MIDI usbMidi;
Adafruit_NeoPixel pixels(pimfx::kLedCount, pimfx::kLedPin, NEO_GRB + NEO_KHZ800);

namespace {

uint8_t analogFiltered[pimfx::kPotCount] = {};
uint8_t analogLastSent[pimfx::kPotCount] = {};
bool analogPrimed[pimfx::kPotCount] = {};
uint32_t analogAccum[pimfx::kPotCount] = {};

bool switchStable[pimfx::kSwitchCount] = {};
bool switchRaw[pimfx::kSwitchCount] = {};
uint32_t switchChangedAt[pimfx::kSwitchCount] = {};

uint8_t encoderPreviousAb = 0;
bool encoderButtonStable = false;
bool encoderButtonRaw = false;
uint32_t encoderButtonChangedAt = 0;

uint8_t sysexIn[128];
size_t sysexInLength = 0;
bool sysexInActive = false;
uint32_t lastIdentityAt = 0;
uint8_t identityBurstsLeft = 8;

void sendPacket(uint8_t cin, uint8_t b0, uint8_t b1 = 0, uint8_t b2 = 0) {
    uint8_t packet[4] = {static_cast<uint8_t>(cin & 0x0F), b0, b1, b2};
    usbMidi.writePacket(packet);
}

void sendControlChange(uint8_t cc, uint8_t value) {
    sendPacket(0x0B, static_cast<uint8_t>(0xB0 | pimfx::kMidiChannel), cc, value & 0x7F);
}

void sendSysEx(const uint8_t* data, size_t length) {
    size_t offset = 0;
    while (offset < length) {
        const size_t remain = length - offset;
        if (remain > 3) {
            sendPacket(0x04, data[offset], data[offset + 1], data[offset + 2]);
            offset += 3;
        } else if (remain == 3) {
            sendPacket(0x07, data[offset], data[offset + 1], data[offset + 2]);
            offset += 3;
        } else if (remain == 2) {
            sendPacket(0x06, data[offset], data[offset + 1], 0);
            offset += 2;
        } else {
            sendPacket(0x05, data[offset], 0, 0);
            offset += 1;
        }
    }
}

void sendIdentityReply() {
    const uint8_t message[] = {
        pimfx::kSysExStart,
        pimfx::kManufacturer,
        pimfx::kSignatureA,
        pimfx::kSignatureB,
        pimfx::kCommandIdentityReply,
        pimfx::kFirmwareMajor,
        pimfx::kFirmwareMinor,
        static_cast<uint8_t>(pimfx::kReportedControlCount & 0x7F),
        static_cast<uint8_t>((pimfx::kReportedControlCount >> 7) & 0x7F),
        static_cast<uint8_t>(pimfx::kLedCount & 0x7F),
        static_cast<uint8_t>((pimfx::kLedCount >> 7) & 0x7F),
        1,
        pimfx::kSysExEnd
    };
    sendSysEx(message, sizeof(message));
    lastIdentityAt = millis();
}

uint8_t from7Bit(uint8_t value) {
    return static_cast<uint8_t>((static_cast<uint16_t>(value) * 255) / 127);
}

void applyLedMessage(const uint8_t* payload, size_t length) {
    if (length < 3) {
        return;
    }
    const uint8_t brightness = payload[0];
    const uint16_t count = static_cast<uint16_t>(payload[1] | (payload[2] << 7));
    pixels.setBrightness(from7Bit(brightness));
    pixels.clear();
    size_t offset = 3;
    for (uint16_t i = 0; i < count && offset + 4 <= length; ++i) {
        const uint16_t index = payload[offset];
        const uint8_t red = from7Bit(payload[offset + 1]);
        const uint8_t green = from7Bit(payload[offset + 2]);
        const uint8_t blue = from7Bit(payload[offset + 3]);
        offset += 4;
        if (index < pimfx::kLedCount) {
            pixels.setPixelColor(index, pixels.Color(red, green, blue));
        }
    }
    pixels.show();
}

bool isOurs(const uint8_t* message, size_t length) {
    return length >= 6
        && message[0] == pimfx::kSysExStart
        && message[1] == pimfx::kManufacturer
        && message[2] == pimfx::kSignatureA
        && message[3] == pimfx::kSignatureB
        && message[length - 1] == pimfx::kSysExEnd;
}

void handleSysEx(const uint8_t* message, size_t length) {
    if (!isOurs(message, length)) {
        return;
    }
    const uint8_t command = message[4];
    if (command == pimfx::kCommandIdentityRequest) {
        sendIdentityReply();
        return;
    }
    if (command == pimfx::kCommandSetLeds) {
        applyLedMessage(message + 5, length - 6);
    }
}

void takeMidiByte(uint8_t byte) {
    if (byte == pimfx::kSysExStart) {
        sysexInActive = true;
        sysexInLength = 0;
        sysexIn[sysexInLength++] = byte;
        return;
    }
    if (!sysexInActive) {
        return;
    }
    if (sysexInLength < sizeof(sysexIn)) {
        sysexIn[sysexInLength++] = byte;
    }
    if (byte == pimfx::kSysExEnd) {
        handleSysEx(sysexIn, sysexInLength);
        sysexInActive = false;
        sysexInLength = 0;
    }
}

void pollUsbMidi() {
    uint8_t packet[4];
    while (usbMidi.readPacket(packet)) {
        const uint8_t cin = packet[0] & 0x0F;
        const uint8_t bytes = (cin == 0x5 || cin == 0xF) ? 1
            : (cin == 0x2 || cin == 0x6 || cin == 0xC || cin == 0xD) ? 2
            : (cin == 0x0 || cin == 0x1) ? 0
            : 3;
        for (uint8_t i = 0; i < bytes; ++i) {
            takeMidiByte(packet[1 + i]);
        }
    }
}

void setupDigital(uint8_t pin) {
    pinMode(pin, INPUT_PULLUP);
}

void pollSwitches() {
    const uint32_t now = millis();
    for (uint8_t i = 0; i < pimfx::kSwitchCount; ++i) {
        const bool pressed = digitalRead(pimfx::kSwitches[i].pin) == LOW;
        if (pressed != switchRaw[i]) {
            switchRaw[i] = pressed;
            switchChangedAt[i] = now;
        }
        if (pressed == switchStable[i]) {
            continue;
        }
        if (now - switchChangedAt[i] < pimfx::kSwitchDebounceMs) {
            continue;
        }
        switchStable[i] = pressed;
        sendControlChange(pimfx::kSwitches[i].cc, pressed ? 127 : 0);
    }
}

void pollPots() {
    static uint8_t next = 0;
    static uint32_t lastSample = 0;
    const uint32_t now = millis();
    if (now - lastSample < pimfx::kAnalogIntervalMs) {
        return;
    }
    lastSample = now;

    const uint8_t i = next;
    next = static_cast<uint8_t>((next + 1) % pimfx::kPotCount);
    const uint32_t raw = analogRead(pimfx::kPots[i].pin);
    analogAccum[i] = analogPrimed[i]
        ? analogAccum[i] - (analogAccum[i] >> pimfx::kAnalogFilterShift) + raw
        : (raw << pimfx::kAnalogFilterShift);
    analogPrimed[i] = true;
    const uint32_t filtered = analogAccum[i] >> pimfx::kAnalogFilterShift;
    const uint8_t midi = static_cast<uint8_t>((filtered * 127UL) / 4095UL);
    analogFiltered[i] = midi;
    const int delta = static_cast<int>(midi) - static_cast<int>(analogLastSent[i]);
    if (delta > static_cast<int>(pimfx::kAnalogHysteresis)
        || delta < -static_cast<int>(pimfx::kAnalogHysteresis)
        || (midi == 0 && analogLastSent[i] != 0)
        || (midi == 127 && analogLastSent[i] != 127)) {
        analogLastSent[i] = midi;
        sendControlChange(pimfx::kPots[i].cc, midi);
    }
}

void pollEncoder() {
    const uint8_t a = digitalRead(pimfx::kEncoderPinA) == HIGH ? 1 : 0;
    const uint8_t b = digitalRead(pimfx::kEncoderPinB) == HIGH ? 1 : 0;
    const uint8_t ab = static_cast<uint8_t>((a << 1) | b);
    static const int8_t kTable[] = {0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0};
    const int8_t step = kTable[(encoderPreviousAb << 2) | ab];
    encoderPreviousAb = ab;
    if (step > 0) {
        sendControlChange(pimfx::kEncoderTurnCc, 65);
    } else if (step < 0) {
        sendControlChange(pimfx::kEncoderTurnCc, 63);
    }

    const uint32_t now = millis();
    const bool pressed = digitalRead(pimfx::kEncoderPinButton) == LOW;
    if (pressed != encoderButtonRaw) {
        encoderButtonRaw = pressed;
        encoderButtonChangedAt = now;
    }
    if (pressed != encoderButtonStable && now - encoderButtonChangedAt >= pimfx::kSwitchDebounceMs) {
        encoderButtonStable = pressed;
        sendControlChange(pimfx::kEncoderButtonCc, pressed ? 127 : 0);
    }
}

} // namespace

void setup() {
    analogReadResolution(12);

    TinyUSBDevice.setManufacturerDescriptor("Pi-MFX");
    TinyUSBDevice.setProductDescriptor("Pi-MFX Controller");
    usbMidi.begin();
#if defined(ARDUINO_ARCH_ESP32)
    if (TinyUSBDevice.mounted()) {
        TinyUSBDevice.detach();
        delay(10);
        TinyUSBDevice.attach();
    }
#endif

    for (uint8_t i = 0; i < pimfx::kSwitchCount; ++i) {
        setupDigital(pimfx::kSwitches[i].pin);
        switchRaw[i] = digitalRead(pimfx::kSwitches[i].pin) == LOW;
        switchStable[i] = switchRaw[i];
    }
    setupDigital(pimfx::kEncoderPinA);
    setupDigital(pimfx::kEncoderPinB);
    setupDigital(pimfx::kEncoderPinButton);
    encoderPreviousAb = static_cast<uint8_t>(
        ((digitalRead(pimfx::kEncoderPinA) == HIGH) << 1)
        | (digitalRead(pimfx::kEncoderPinB) == HIGH ? 1 : 0)
    );

    pixels.begin();
    pixels.clear();
    pixels.show();
}

void loop() {
    pollUsbMidi();
    pollSwitches();
    pollPots();
    pollEncoder();

    const uint32_t now = millis();
    if (TinyUSBDevice.mounted() && identityBurstsLeft > 0 && now - lastIdentityAt >= 400) {
        sendIdentityReply();
        --identityBurstsLeft;
    }
}
