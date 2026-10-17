#pragma once

// Pi-MFX USB-MIDI SysEx. Keep these in lockstep with engine/src/midi/Mapping.cpp.

#include <stdint.h>

namespace pimfx {

constexpr uint8_t kSysExStart = 0xF0;
constexpr uint8_t kSysExEnd = 0xF7;
constexpr uint8_t kManufacturer = 0x7D;
constexpr uint8_t kSignatureA = 0x4D; // 'M'
constexpr uint8_t kSignatureB = 0x46; // 'F'

constexpr uint8_t kCommandIdentityRequest = 0x01;
constexpr uint8_t kCommandSetLeds = 0x02;
constexpr uint8_t kCommandIdentityReply = 0x10;

constexpr uint8_t kFirmwareMajor = 1;
constexpr uint8_t kFirmwareMinor = 1;

constexpr uint8_t kMidiChannel = 0; // USB / MIDI channel 1

} // namespace pimfx
