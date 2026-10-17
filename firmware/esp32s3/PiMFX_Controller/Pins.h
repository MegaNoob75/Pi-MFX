#pragma once

// Default ESP32-S3 DevKitC-1 floorboard map. Change these to match your box,
// flash, then Learn in the Pi-MFX UI (or type the CC numbers in Hardware Setup).

#include <stddef.h>
#include <stdint.h>

namespace pimfx {

struct DigitalControl {
    uint8_t pin;
    uint8_t cc;
};

struct AnalogControl {
    uint8_t pin;
    uint8_t cc;
};

// Active-low footswitches to GND. Internal pull-ups are enabled in firmware.
constexpr DigitalControl kSwitches[] = {
    {6, 20},
    {7, 21},
    {15, 22},
    {16, 23},
    {1, 24},
    {2, 25},
    {4, 26},
    {5, 27},
};

constexpr AnalogControl kPots[] = {
    {8, 10},
    {12, 11},
    {13, 12},
    {11, 13},
};

struct EncoderControl {
    uint8_t pinA, pinB;
    int16_t buttonPin; // -1 for an encoder without a push switch
    uint8_t turnCc, buttonCc;
    uint8_t stepsPerDetent;
};
// Add one row per encoder. Give every turn/push a unique CC, and use
// GPIOs that are free on your particular board. Learn each row in Hardware Setup.
constexpr EncoderControl kEncoders[] = {
    {18, 17, 21, 30, 31, 4},
};

constexpr uint8_t kLedPin = 48;
constexpr uint16_t kLedCount = 8;

constexpr size_t kSwitchCount = sizeof(kSwitches) / sizeof(kSwitches[0]);
constexpr size_t kPotCount = sizeof(kPots) / sizeof(kPots[0]);
constexpr size_t kEncoderCount = sizeof(kEncoders) / sizeof(kEncoders[0]);
constexpr size_t reportedControlCount() {
    size_t count = kSwitchCount + kPotCount;
    for (const auto& encoder : kEncoders) count += encoder.buttonPin >= 0 ? 2 : 1;
    return count;
}
constexpr size_t kReportedControlCount = reportedControlCount();

constexpr uint32_t kSwitchDebounceMs = 20;
constexpr uint32_t kAnalogIntervalMs = 4;
constexpr uint8_t kAnalogHysteresis = 2;
constexpr uint8_t kAnalogFilterShift = 3;

} // namespace pimfx
