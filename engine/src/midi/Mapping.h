#pragma once

#include "midi/MidiInput.h"
#include "model/Model.h"

#include <chrono>
#include <mutex>
#include <string>
#include <vector>

namespace pimfx {

/// What the engine should do in response to a control being used.
struct ActionRequest {
    std::string action;
    std::string controlId;
    ControlBinding binding;
    /// Normalised position for continuous controls, already scaled into the
    /// binding's range.
    float value = 0.0f;
    bool pressed = false;
    bool fromHold = false;
};

/// The colour an LED should show, in the same 0-255 space as the theme.
struct LedState {
    std::string ledId;
    int pixelIndex = 0;
    uint8_t red = 0;
    uint8_t green = 0;
    uint8_t blue = 0;
    bool on = false;
};

/// Turns MIDI from the floorboard into engine actions, and engine state back
/// into LED colours.
///
/// The controller is described entirely by the user's configuration, so this
/// class has no notion of a fixed switch count or a fixed layout.
class ControllerRuntime {
public:
    void setConfig(ControllerConfig config);
    ControllerConfig config() const;

    /// Interprets one MIDI message. Returns the actions to run, which may be
    /// empty when the message belongs to a control the user has not bound.
    std::vector<ActionRequest> handleMessage(const MidiMessage& message);

    /// Anything that arrives while learn is active is assigned to
    /// `controlId` instead of being acted on.
    void beginLearn(const std::string& controlId);
    void cancelLearn();
    bool learning() const;
    std::string learningControlId() const;

    /// Called on a timer so a held switch fires its hold action without
    /// waiting for release.
    std::vector<ActionRequest> pollHolds();

    /// Encodes LED colours as the Pi-MFX SysEx message documented in
    /// `docs/CONTROLLER_PROTOCOL.md`.
    std::vector<uint8_t> encodeLedMessage(const std::vector<LedState>& leds, float brightness) const;

    /// Asks a newly connected controller to describe itself.
    static std::vector<uint8_t> encodeIdentityRequest();

    /// Parses an identity reply. Returns false for SysEx that is not ours.
    struct Identity {
        std::string firmwareVersion;
        int controlCount = 0;
        int ledCount = 0;
        bool rgbLeds = false;
    };
    static bool parseIdentity(const std::vector<uint8_t>& sysex, Identity& identity);

    /// The most recent physical position of each control, for the on-screen
    /// mirror of the board. Values are 0-1 as the hardware (or virtual) control
    /// is pointing, before invert is applied to the bound parameter.
    std::vector<std::pair<std::string, float>> controlPositions() const;
    void setPosition(const std::string& controlId, float normalised);

private:
    struct HeldControl {
        std::string controlId;
        std::chrono::steady_clock::time_point pressedAt;
        bool holdFired = false;
    };

    const ControllerControl* matchControl(const MidiMessage& message) const;

    mutable std::mutex mutex_;
    ControllerConfig config_;
    std::string learnControlId_;
    std::vector<HeldControl> held_;
    std::vector<std::pair<std::string, float>> positions_;
};

} // namespace pimfx
