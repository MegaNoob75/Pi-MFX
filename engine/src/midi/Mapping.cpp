#include "midi/Mapping.h"

#include <algorithm>
#include <chrono>
#include <cmath>

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

bool assignedAction(const std::string& action) {
    return !action.empty() && action != "none";
}

int holdDelayMs(const ControlBinding& binding) {
    return binding.holdMilliseconds < 250 ? 600 : binding.holdMilliseconds;
}

int doubleDelayMs(const ControlBinding& binding) {
    return binding.doubleTapMilliseconds < 80 ? 320 : binding.doubleTapMilliseconds;
}

/// MIDI data bytes only carry seven bits, so 0-255 colour components are
/// scaled rather than truncated: dividing by two would lose the top of the
/// range on every channel.
uint8_t to7Bit(uint8_t value) {
    return static_cast<uint8_t>((static_cast<int>(value) * 127) / 255);
}

/// One tactile click is one list step. MIDI relative encodings vary (63/65
/// offset, or 1/127 two's complement). Never treat the raw offset as a count.
int encoderPulse(uint8_t data2) {
    if (data2 == 0 || data2 == 64) {
        return 0;
    }
    if (data2 >= 125) {
        return -1;
    }
    if (data2 <= 3) {
        return 1;
    }
    return data2 > 64 ? 1 : -1;
}

} // namespace

void ControllerRuntime::setConfig(ControllerConfig config) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_ = std::move(config);
    held_.clear();
    encoders_.clear();
}

void ControllerRuntime::setFeel(int encoderStepsPerDetent, int analogDeadband, int switchDebounceMs) {
    std::lock_guard<std::mutex> lock(mutex_);
    encoderStepsPerDetent_ = std::max(1, std::min(8, encoderStepsPerDetent));
    analogDeadband_ = std::max(0, std::min(16, analogDeadband));
    switchDebounceMs_ = std::max(0, std::min(80, switchDebounceMs));
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
    if (control->kind == ControlKind::Encoder) {
        int pulse = encoderPulse(message.data2);
        if (pulse == 0) {
            return actions;
        }
        if (control->binding.inverted) {
            pulse = -pulse;
        }
        auto position = std::find_if(positions_.begin(), positions_.end(),
                                     [&](const std::pair<std::string, float>& entry) {
                                         return entry.first == control->id;
                                     });
        float knob = position == positions_.end() ? 0.5f : position->second;
        knob += static_cast<float>(pulse) / 24.0f;
        while (knob < 0.0f) {
            knob += 1.0f;
        }
        while (knob > 1.0f) {
            knob -= 1.0f;
        }
        if (position == positions_.end()) {
            positions_.emplace_back(control->id, knob);
        } else {
            position->second = knob;
        }

        auto state = std::find_if(encoders_.begin(), encoders_.end(),
                                  [&](const EncoderState& entry) {
                                      return entry.controlId == control->id;
                                  });
        if (state == encoders_.end()) {
            encoders_.push_back({control->id, 0});
            state = encoders_.end() - 1;
        }

        const int needed = encoderStepsPerDetent_;
        if ((state->accum > 0 && pulse < 0) || (state->accum < 0 && pulse > 0)) {
            state->accum = 0;
        }
        state->accum += pulse;
        if (std::abs(state->accum) < needed) {
            return actions;
        }

        const int step = state->accum > 0 ? 1 : -1;
        state->accum = 0;

        ActionRequest request;
        request.controlId = control->id;
        request.binding = control->binding;
        request.action = control->binding.action;
        request.kind = control->kind;
        request.pressed = true;
        request.delta = step;
        request.value = static_cast<float>(step);
        actions.push_back(std::move(request));
        return actions;
    }

    if (continuous && control->binding.inverted) {
        visual = 1.0f - visual;
    }
    if (continuous && analogDeadband_ > 0) {
        auto previous = std::find_if(positions_.begin(), positions_.end(),
                                     [&](const std::pair<std::string, float>& entry) {
                                         return entry.first == control->id;
                                     });
        if (previous != positions_.end()) {
            const int lastMidi = static_cast<int>(std::lround(previous->second * 127.0f));
            const int midiNow = static_cast<int>(std::lround(visual * 127.0f));
            const int gap = std::abs(midiNow - lastMidi);
            if (gap < analogDeadband_ && midiNow != 0 && midiNow != 127) {
                return actions;
            }
        }
    }
    if (!continuous && !switchDebouncedUnlocked(control->id)) {
        return actions;
    }
    const bool pressed = message.isNoteOn() || (message.isControlChange() && message.data2 >= 64);
    if (control->kind == ControlKind::EncoderPush) {
        visual = pressed ? 1.0f : 0.0f;
    }
    auto position = std::find_if(positions_.begin(), positions_.end(),
                                 [&](const std::pair<std::string, float>& entry) {
                                     return entry.first == control->id;
                                 });
    if (position == positions_.end()) {
        positions_.emplace_back(control->id, visual);
    } else {
        position->second = visual;
    }

    if (continuous) {
        ActionRequest request;
        request.controlId = control->id;
        request.binding = control->binding;
        request.action = control->binding.action;
        request.kind = control->kind;
        request.value = visual;
        request.pressed = true;
        actions.push_back(std::move(request));
        return actions;
    }

    if (control->kind == ControlKind::EncoderPush) {
        std::vector<ActionRequest> pressActions = discretePressUnlocked(*control, pressed);
        if (pressActions.empty()) {
            ActionRequest tick;
            tick.controlId = control->id;
            tick.binding = control->binding;
            tick.action = "none";
            tick.kind = control->kind;
            tick.pressed = pressed;
            tick.value = visual;
            pressActions.push_back(std::move(tick));
        }
        return pressActions;
    }
    return discretePressUnlocked(*control, pressed);
}

bool ControllerRuntime::switchDebouncedUnlocked(const std::string& controlId) {
    if (switchDebounceMs_ <= 0) {
        return true;
    }
    const auto now = std::chrono::steady_clock::now();
    auto found = std::find_if(lastSwitchAt_.begin(), lastSwitchAt_.end(),
                              [&](const std::pair<std::string, std::chrono::steady_clock::time_point>& entry) {
                                  return entry.first == controlId;
                              });
    if (found == lastSwitchAt_.end()) {
        lastSwitchAt_.emplace_back(controlId, now);
        return true;
    }
    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - found->second).count();
    if (elapsed < switchDebounceMs_) {
        return false;
    }
    found->second = now;
    return true;
}

std::vector<ActionRequest> ControllerRuntime::discretePressUnlocked(
        const ControllerControl& control, bool pressed) {
    std::vector<ActionRequest> actions;
    ActionRequest request;
    request.controlId = control.id;
    request.binding = control.binding;
    request.action = control.binding.action;
    request.kind = control.kind;
    request.pressed = pressed;
    request.value = pressed ? 1.0f : 0.0f;

    if (control.kind == ControlKind::Latching) {
        actions.push_back(std::move(request));
        return actions;
    }

    const bool hold = assignedAction(control.binding.holdAction);
    const bool dbl = assignedAction(control.binding.doubleAction);

    if (pressed) {
        for (auto it = swallowRelease_.begin(); it != swallowRelease_.end(); ++it) {
            if (*it == control.id) {
                swallowRelease_.erase(it);
                break;
            }
        }
        for (size_t i = 0; i < pendingTaps_.size(); ++i) {
            if (pendingTaps_[i].controlId != control.id) {
                continue;
            }
            pendingTaps_.erase(pendingTaps_.begin() + static_cast<long>(i));
            if (dbl) {
                request.action = control.binding.doubleAction;
                request.fromDouble = true;
                request.pressed = true;
                swallowRelease_.push_back(control.id);
                actions.push_back(std::move(request));
            }
            return actions;
        }
        for (const HeldControl& held : held_) {
            if (held.controlId == control.id) {
                return actions;
            }
        }
        if (hold || dbl) {
            held_.push_back({control.id, std::chrono::steady_clock::now(), false});
            return actions;
        }
        actions.push_back(std::move(request));
        return actions;
    }

    for (auto it = swallowRelease_.begin(); it != swallowRelease_.end(); ++it) {
        if (*it == control.id) {
            swallowRelease_.erase(it);
            return actions;
        }
    }

    for (size_t i = 0; i < held_.size(); ++i) {
        if (held_[i].controlId != control.id) {
            continue;
        }
        const bool alreadyFired = held_[i].holdFired;
        held_.erase(held_.begin() + static_cast<long>(i));
        if (alreadyFired) {
            return actions;
        }
        if (dbl) {
            pendingTaps_.push_back({
                control.id,
                std::chrono::steady_clock::now() + std::chrono::milliseconds(doubleDelayMs(control.binding))
            });
            return actions;
        }
        request.pressed = true;
        actions.push_back(std::move(request));
        return actions;
    }

    return actions;
}

void ControllerRuntime::cancelPendingTapUnlocked(const std::string& controlId) {
    pendingTaps_.erase(std::remove_if(pendingTaps_.begin(), pendingTaps_.end(),
                                      [&](const PendingTap& tap) { return tap.controlId == controlId; }),
                       pendingTaps_.end());
}

std::vector<ActionRequest> ControllerRuntime::virtualPress(const std::string& controlId, bool pressed) {
    std::lock_guard<std::mutex> lock(mutex_);
    for (const ControllerControl& control : config_.controls) {
        if (control.id != controlId) {
            continue;
        }
        const bool continuous = control.kind == ControlKind::Pot
                             || control.kind == ControlKind::Slider
                             || control.kind == ControlKind::Expression;
        if (continuous) {
            return {};
        }
        return discretePressUnlocked(control, pressed);
    }
    return {};
}

void ControllerRuntime::cancelHold(const std::string& controlId) {
    std::lock_guard<std::mutex> lock(mutex_);
    held_.erase(std::remove_if(held_.begin(), held_.end(),
                               [&](const HeldControl& held) { return held.controlId == controlId; }),
                held_.end());
    cancelPendingTapUnlocked(controlId);
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
        if (!control || control->kind == ControlKind::Latching
            || control->binding.holdAction.empty()
            || control->binding.holdAction == "none") {
            continue;
        }

        int holdMs = control->binding.holdMilliseconds;
        if (holdMs < 250) {
            holdMs = 600;
        }
        const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - held.pressedAt);
        if (elapsed.count() < holdMs) {
            continue;
        }

        held.holdFired = true;
        cancelPendingTapUnlocked(control->id);
        ActionRequest request;
        request.controlId = control->id;
        request.binding = control->binding;
        request.action = control->binding.holdAction;
        request.pressed = true;
        request.fromHold = true;
        request.kind = control->kind;
        actions.push_back(std::move(request));
    }

    for (size_t i = 0; i < pendingTaps_.size();) {
        if (pendingTaps_[i].due > now) {
            ++i;
            continue;
        }
        const std::string controlId = pendingTaps_[i].controlId;
        pendingTaps_.erase(pendingTaps_.begin() + static_cast<long>(i));
        const ControllerControl* control = nullptr;
        for (const ControllerControl& candidate : config_.controls) {
            if (candidate.id == controlId) {
                control = &candidate;
                break;
            }
        }
        if (!control) {
            continue;
        }
        ActionRequest request;
        request.controlId = control->id;
        request.binding = control->binding;
        request.action = control->binding.action;
        request.pressed = true;
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

    identity.firmwareMajor = sysex[5];
    identity.firmwareMinor = sysex[6];
    identity.firmwareVersion = std::to_string(identity.firmwareMajor) + "."
        + std::to_string(identity.firmwareMinor);
    identity.controlCount = sysex[7] | (sysex[8] << 7);
    identity.ledCount = sysex[9] | (sysex.size() > 10 ? (sysex[10] << 7) : 0);
    identity.rgbLeds = sysex.size() > 11 && sysex[11] != 0;
    return true;
}

} // namespace pimfx
