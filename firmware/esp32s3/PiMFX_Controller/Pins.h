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

constexpr uint8_t kEncoderPinA = 18;
constexpr uint8_t kEncoderPinB = 17;
constexpr uint8_t kEncoderPinButton = 21;
constexpr uint8_t kEncoderTurnCc = 30;
constexpr uint8_t kEncoderButtonCc = 31;

constexpr uint8_t kLedPin = 48;
constexpr uint16_t kLedCount = 8;

constexpr uint8_t kSwitchCount = sizeof(kSwitches) / sizeof(kSwitches[0]);
constexpr uint8_t kPotCount = sizeof(kPots) / sizeof(kPots[0]);
constexpr uint8_t kReportedControlCount = kSwitchCount + kPotCount + 2; // encoder turn + push

constexpr uint32_t kSwitchDebounceMs = 20;
constexpr uint32_t kAnalogIntervalMs = 4;
constexpr uint8_t kAnalogHysteresis = 2;
constexpr uint8_t kAnalogFilterShift = 3;

} // namespace pimfx
