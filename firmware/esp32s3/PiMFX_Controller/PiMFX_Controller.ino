/*
 * Pi-MFX USB-MIDI floorboard for ESP32-S3.
 *
 * Speaks the protocol in docs/CONTROLLER_PROTOCOL.md:
 *   identity request 0x01 / reply 0x10, set-LED 0x02, CC for switches and pots.
 * Flash this sketch, not the earlier MultiFX controller firmware.
 *
 * USB MIDI uses the same Control Surface transport as the old MultiFX .ino.
 * The SysEx and Learn protocol are Pi-MFX, not MultiFX.
 *
 * Arduino IDE needs these libraries installed:
 *   Control Surface (by Pieter P)
 *   Adafruit NeoPixel
 * Tools → USB Mode must be USB-OTG (TinyUSB).
 */

#include <Control_Surface.h>
#include <Adafruit_NeoPixel.h>

#include "Pins.h"
#include "Protocol.h"

USBMIDI_Interface midi;
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

uint32_t lastIdentityAt = 0;
uint8_t identityBurstsLeft = 8;

void sendControlChange(uint8_t cc, uint8_t value) {
    midi.sendControlChange({cc, Channel_1}, value & 0x7F);
}

void sendIdentityReply();
void handleIncomingSysEx(SysExMessage sysex);

struct PiMfxMidiCallbacks : MIDI_Callbacks {
    void onSysExMessage(MIDI_Interface &, SysExMessage sysex) override {
        handleIncomingSysEx(sysex);
    }
} midiCallbacks;

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
    midi.sendSysEx(message);
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

void handleIncomingSysEx(SysExMessage sysex) {
    const uint8_t* data = sysex.data;
    uint16_t start = 0;
    uint16_t end = sysex.length;
    if (end > 0 && data[0] == pimfx::kSysExStart) {
        start = 1;
    }
    if (end > start && data[end - 1] == pimfx::kSysExEnd) {
        --end;
    }
    if (end - start < 4) {
        return;
    }
    if (data[start] != pimfx::kManufacturer
        || data[start + 1] != pimfx::kSignatureA
        || data[start + 2] != pimfx::kSignatureB) {
        return;
    }
    const uint8_t command = data[start + 3];
    if (command == pimfx::kCommandIdentityRequest) {
        sendIdentityReply();
        return;
    }
    if (command == pimfx::kCommandSetLeds) {
        applyLedMessage(data + start + 4, static_cast<size_t>(end - start - 4));
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
    const uint8_t midiValue = static_cast<uint8_t>((filtered * 127UL) / 4095UL);
    analogFiltered[i] = midiValue;
    const int delta = static_cast<int>(midiValue) - static_cast<int>(analogLastSent[i]);
    if (delta > static_cast<int>(pimfx::kAnalogHysteresis)
        || delta < -static_cast<int>(pimfx::kAnalogHysteresis)
        || (midiValue == 0 && analogLastSent[i] != 0)
        || (midiValue == 127 && analogLastSent[i] != 127)) {
        analogLastSent[i] = midiValue;
        sendControlChange(pimfx::kPots[i].cc, midiValue);
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
    Control_Surface.begin();
    midi.setCallbacks(midiCallbacks);

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
    Control_Surface.loop();
    pollSwitches();
    pollPots();
    pollEncoder();

    const uint32_t now = millis();
    if (identityBurstsLeft > 0 && now - lastIdentityAt >= 400) {
        sendIdentityReply();
        --identityBurstsLeft;
    }
}
