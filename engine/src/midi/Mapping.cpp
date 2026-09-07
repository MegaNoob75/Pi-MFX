#include "midi/Mapping.h"

#include <algorithm>

namespace pimfx {
namespace {

/// SysEx header for Pi-MFX. 0x7D is the ID reserved for non-commercial and
/// educational use, which is exactly what a DIY floorboard is. "MF" identifies
/// our messages so other 0x7D devices on the same bus are ignored.
constexpr uint8_t kSysExStart = 0xF0;
constexpr uint8_t kSysExEnd = 0xF7;
constexpr uint8_t kManufacturer = 0x7D;
constexpr uint8_t kSignatureA = 0x4D; // 'M'
constexpr uint8_t kSignatureB = 0x46; // 'F'

constexpr uint8_t kCommandIdentityRequest = 0x01;
constexpr uint8_t kCommandSetLeds = 0x02;
constexpr uint8_t kCommandIdentityReply = 0x10;

/// MIDI data bytes only carry seven bits, so 0-255 colour components are
/// scaled rather than truncated: dividing by two would lose the top of the
/// range on every channel.
uint8_t to7Bit(uint8_t value) {
    return static_cast<uint8_t>((static_cast<int>(value) * 127) / 255);
}

} // namespace

void ControllerRuntime::setConfig(ControllerConfig config) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_ = std::move(config);
    held_.clear();
}

ControllerConfig ControllerRuntime::config() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return config_;
}

void ControllerRuntime::beginLearn(const std::string& controlId) {
    std::lock_guard<std::mutex> lock(mutex_);
    learnControlId_ = controlId;
}

void ControllerRuntime::cancelLearn() {
    std::lock_guard<std::mutex> lock(mutex_);
    learnControlId_.clear();
}

bool ControllerRuntime::learning() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return !learnControlId_.empty();
}

std::string ControllerRuntime::learningControlId() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return learnControlId_;
}

const ControllerControl* ControllerRuntime::matchControl(const MidiMessage& message) const {
    for (const ControllerControl& control : config_.controls) {
        if (control.channel < 0) {
            continue;
        }
        if (control.midiChannel != 0 && control.midiChannel - 1 != message.channel()) {
            continue;
        }
        if (control.useNoteMessages) {
            if ((message.isNoteOn() || message.isNoteOff()) && message.data1 == control.channel) {
                return &control;
            }
        } else if (message.isControlChange() && message.data1 == control.channel) {
            return &control;
        }
    }
    return nullptr;
}

std::vector<ActionRequest> ControllerRuntime::handleMessage(const MidiMessage& message) {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<ActionRequest> actions;

    // Learn takes priority: while it is active the user is telling us which
    // physical control is which, not asking for anything to happen.
    if (!learnControlId_.empty()) {
        const bool usable = message.isControlChange() || message.isNoteOn();
        if (!usable) {
            return actions;
        }
        for (ControllerControl& control : config_.controls) {
            if (control.id == learnControlId_) {
                control.channel = message.data1;
                control.midiChannel = message.channel() + 1;
                control.useNoteMessages = message.isNoteOn();
                break;
            }
        }
        ActionRequest learned;
        learned.action = "learned";
        learned.controlId = learnControlId_;
        learnControlId_.clear();
        actions.push_back(std::move(learned));
        return actions;
    }

    const ControllerControl* control = matchControl(message);
    if (!control) {
        return actions;
    }

    const bool continuous = control->kind == ControlKind::Pot
                         || control->kind == ControlKind::Slider
                         || control->kind == ControlKind::Expression;

    float visual = static_cast<float>(message.data2) / 127.0f;
    auto position = std::find_if(positions_.begin(), positions_.end(),
                                 [&](const std::pair<std::string, float>& entry) {
                                     return entry.first == control->id;
                                 });
    if (position == positions_.end()) {
        positions_.emplace_back(control->id, visual);
    } else {
        position->second = visual;
    }

    ActionRequest request;
    request.controlId = control->id;
    request.binding = control->binding;
    request.action = control->binding.action;
    request.kind = control->kind;

    if (continuous) {
        request.value = visual;
        request.pressed = true;
        actions.push_back(std::move(request));
        return actions;
    }

    const bool pressed = message.isNoteOn() || (message.isControlChange() && message.data2 >= 64);
    request.pressed = pressed;
    request.value = pressed ? 1.0f : 0.0f;

    if (control->kind == ControlKind::Latching) {
        actions.push_back(std::move(request));
        return actions;
    }

    if (pressed) {
        if (!control->binding.holdAction.empty()) {
            // With a hold action configured the press is not acted on until we
            // know whether it was a tap or a hold.
            held_.push_back({control->id, std::chrono::steady_clock::now(), false});
            return actions;
        }
        actions.push_back(std::move(request));
        return actions;
    }

    // Release: a momentary with a hold action fires its tap action here, unless
    // the hold already fired.
    for (size_t i = 0; i < held_.size(); ++i) {
        if (held_[i].controlId != control->id) {
            continue;
        }
        const bool alreadyFired = held_[i].holdFired;
        held_.erase(held_.begin() + static_cast<long>(i));
        if (!alreadyFired) {
            request.pressed = true;
            actions.push_back(std::move(request));
        }
        return actions;
    }

    return actions;
}

std::vector<ActionRequest> ControllerRuntime::pollHolds() {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<ActionRequest> actions;
    const auto now = std::chrono::steady_clock::now();

    for (HeldControl& held : held_) {
        if (held.holdFired) {
            continue;
        }
        const ControllerControl* control = nullptr;
        for (const ControllerControl& candidate : config_.controls) {
            if (candidate.id == held.controlId) {
                control = &candidate;
                break;
            }
        }
        if (!control || control->kind == ControlKind::Latching || control->binding.holdAction.empty()) {
            continue;
        }

        const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - held.pressedAt);
        if (elapsed.count() < control->binding.holdMilliseconds) {
            continue;
        }

        held.holdFired = true;
        ActionRequest request;
        request.controlId = control->id;
        request.binding = control->binding;
        request.action = control->binding.holdAction;
        request.pressed = true;
        request.fromHold = true;
        request.kind = control->kind;
        actions.push_back(std::move(request));
    }
    return actions;
}

std::vector<std::pair<std::string, float>> ControllerRuntime::controlPositions() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return positions_;
}

void ControllerRuntime::setPosition(const std::string& controlId, float normalised) {
    std::lock_guard<std::mutex> lock(mutex_);
    const float clamped = std::max(0.0f, std::min(1.0f, normalised));
    for (std::pair<std::string, float>& entry : positions_) {
        if (entry.first == controlId) {
            entry.second = clamped;
            return;
        }
    }
    positions_.emplace_back(controlId, clamped);
}

std::vector<uint8_t> ControllerRuntime::encodeLedMessage(const std::vector<LedState>& leds,
                                                         float brightness) const {
    std::vector<uint8_t> message;
    message.reserve(8 + leds.size() * 4);
    message.push_back(kSysExStart);
    message.push_back(kManufacturer);
    message.push_back(kSignatureA);
    message.push_back(kSignatureB);
    message.push_back(kCommandSetLeds);
    message.push_back(to7Bit(static_cast<uint8_t>(std::max(0.0f, std::min(1.0f, brightness)) * 255.0f)));

    // The count is split across two seven-bit bytes so a board with more than
    // 127 LEDs is not an protocol edge case.
    const uint16_t count = static_cast<uint16_t>(leds.size());
    message.push_back(static_cast<uint8_t>(count & 0x7F));
    message.push_back(static_cast<uint8_t>((count >> 7) & 0x7F));

    for (const LedState& led : leds) {
        message.push_back(static_cast<uint8_t>(led.pixelIndex & 0x7F));
        if (led.on) {
            message.push_back(to7Bit(led.red));
            message.push_back(to7Bit(led.green));
            message.push_back(to7Bit(led.blue));
        } else {
            message.push_back(0);
            message.push_back(0);
            message.push_back(0);
        }
    }

    message.push_back(kSysExEnd);
    return message;
}

std::vector<uint8_t> ControllerRuntime::encodeIdentityRequest() {
    return {kSysExStart, kManufacturer, kSignatureA, kSignatureB, kCommandIdentityRequest, kSysExEnd};
}

bool ControllerRuntime::parseIdentity(const std::vector<uint8_t>& sysex, Identity& identity) {
    if (sysex.size() < 10 || sysex.front() != kSysExStart || sysex.back() != kSysExEnd) {
        return false;
    }
    if (sysex[1] != kManufacturer || sysex[2] != kSignatureA || sysex[3] != kSignatureB) {
        return false;
    }
    if (sysex[4] != kCommandIdentityReply) {
        return false;
    }

    identity.firmwareVersion = std::to_string(sysex[5]) + "." + std::to_string(sysex[6]);
    identity.controlCount = sysex[7] | (sysex[8] << 7);
    identity.ledCount = sysex[9] | (sysex.size() > 10 ? (sysex[10] << 7) : 0);
    identity.rgbLeds = sysex.size() > 11 && sysex[11] != 0;
    return true;
}

} // namespace pimfx
