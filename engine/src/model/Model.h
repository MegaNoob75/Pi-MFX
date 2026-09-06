#pragma once

#include "audio/AudioTypes.h"
#include "core/Json.h"

#include <string>
#include <vector>

namespace pimfx {

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/// One effect in the chain.
///
/// `state` holds the plugin's control values and file properties, so a preset
/// is self-contained apart from the model and IR files it points at.
struct EffectSlot {
    std::string id;        ///< stable within the preset, used by controller bindings
    std::string uri;       ///< LV2 plugin URI
    std::string name;      ///< user-visible name, defaults to the plugin's own
    bool enabled = true;
    Json state = Json::object();

    Json toJson() const;
    static EffectSlot fromJson(const Json& json);
};

/// A snapshot captures the whole chain: which slots are on, and every control
/// value. Switching between snapshots is instant because nothing is
/// re-instantiated, only re-parameterised.
struct Snapshot {
    std::string id;
    std::string name;
    Json slots = Json::object();
    std::string color;

    Json toJson() const;
    static Snapshot fromJson(const Json& json);
};

struct Preset {
    std::string id;
    std::string name = "Untitled";
    std::string author;
    double tempo = 120.0;
    float inputGainDb = 0.0f;
    float outputGainDb = 0.0f;

    std::vector<EffectSlot> chain;
    std::vector<Snapshot> snapshots;
    int activeSnapshot = -1;

    const EffectSlot* findSlot(const std::string& slotId) const;
    EffectSlot* findSlot(const std::string& slotId);

    Json toJson() const;
    static Preset fromJson(const Json& json);
};

/// Banks are the unit the foot controller steps through, and the unit the user
/// exports and shares.
struct Bank {
    std::string id;
    std::string name = "Bank";
    int order = 0; ///< user-facing list order; lower values appear first
    std::vector<Preset> presets;

    Json toJson() const;
    static Bank fromJson(const Json& json);
};

// ---------------------------------------------------------------------------
// DIY controller
// ---------------------------------------------------------------------------

enum class ControlKind {
    Switch,      ///< latching footswitch
    Momentary,   ///< momentary button
    Pot,         ///< rotary potentiometer
    Slider,      ///< linear fader
    Encoder,     ///< rotary encoder, relative
    Expression   ///< expression pedal input
};

std::string controlKindToString(ControlKind kind);
ControlKind controlKindFromString(const std::string& text);

/// What a control does when it is used.
///
/// Actions are strings rather than an enum on the wire so the firmware and the
/// UI can gain new ones without a protocol version bump.
struct ControlBinding {
    std::string action = "none";

    std::string bankId;
    std::string presetId;
    std::string snapshotId;
    std::string slotId;     ///< for toggleEffect and setParameter
    std::string portSymbol; ///< for setParameter

    float minimum = 0.0f;   ///< range a pot or pedal sweeps across
    float maximum = 1.0f;
    bool inverted = false;

    /// Held-switch alternative action, so one footswitch can do two jobs.
    std::string holdAction;
    int holdMilliseconds = 600;

    Json toJson() const;
    static ControlBinding fromJson(const Json& json);
};

/// A physical control on the user's floorboard.
///
/// There is no limit on how many of these a controller may declare. The UI
/// draws exactly what the hardware reports, in the layout the user arranges.
struct ControllerControl {
    std::string id;
    std::string label;
    ControlKind kind = ControlKind::Switch;

    /// Where the firmware reads it. `module` names an expander board when the
    /// user has more controls than the ESP32 has pins.
    std::string module;
    int channel = -1;       ///< MIDI CC or note number assigned by Learn
    int midiChannel = 0;
    bool useNoteMessages = false;

    /// Position in the on-screen layout. Grid mode uses row/column; freeform
    /// mode uses the normalised x/y/width/height so a drawn layout can match a
    /// real enclosure.
    int row = 0;
    int column = 0;
    double x = 0.0;
    double y = 0.0;
    double width = 0.12;
    double height = 0.18;

    std::string ledId;      ///< LED that follows this control, if any
    ControlBinding binding;

    Json toJson() const;
    static ControllerControl fromJson(const Json& json);
};

/// An indicator on the floorboard.
///
/// RGB LEDs take their colour from the same theme roles the on-screen
/// indicators use, so the board and the screen always agree.
struct ControllerLed {
    std::string id;
    std::string label;
    bool rgb = true;
    int pixelIndex = 0;     ///< position in the addressable strip
    std::string module;
    int pin = -1;           ///< for a plain single-colour LED

    /// Theme role this LED follows: "preset", "navigation", "utility",
    /// "snapshot", "bypass", or "danger".
    std::string role = "preset";
    float brightness = 1.0f;

    Json toJson() const;
    static ControllerLed fromJson(const Json& json);
};

/// The whole floorboard as the user described it.
struct ControllerConfig {
    bool enabled = false;
    std::string name = "My Controller";

    /// "grid" arranges controls in rows and columns; "freeform" places them
    /// exactly where the user dragged them.
    std::string layoutMode = "grid";
    int gridRows = 2;
    int gridColumns = 4;

    /// Which USB-MIDI port the controller appears on. Empty means "accept the
    /// first Pi-MFX controller that identifies itself".
    std::string midiPort;

    /// Mirror the controller's layout on screen so a tablet shows the same
    /// arrangement as the board under the user's feet.
    bool mirrorLayoutOnScreen = true;

    /// Push theme colours to the board's RGB LEDs.
    bool syncLedColours = true;
    float ledBrightness = 0.7f;

    std::vector<ControllerControl> controls;
    std::vector<ControllerLed> leds;

    /// Freeform status widgets, unplaced ids, and layout defaults. Opaque JSON
    /// so the UI can grow without a protocol bump.
    Json performanceLayout;
    Json layoutDefaults;
    /// Per-bank switch -> preset assignments: { bankId: { controlId: presetId } }
    Json presetAssignments;

    Json toJson() const;
    static ControllerConfig fromJson(const Json& json);
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/// UI preferences that live on the Pi rather than in the browser, so every
/// device that connects sees the same rig.
struct UiSettings {
    std::string themeId = "MultiFX Purple";
    Json customThemes = Json::array();
    Json ledColors = Json::object();
    double scale = 1.0;
    bool showTuner = true;
    bool showLatencyMeter = true;
    bool confirmPresetOverwrite = true;
    std::string startupView = "performance";
    /// Number of on-screen performance switches when no physical controller is
    /// connected, so a tablet alone is still a complete control surface.
    int virtualSwitchCount = 8;

    Json toJson() const;
    static UiSettings fromJson(const Json& json);
};

/// Realtime tuning the user can change without editing files on the Pi.
struct SystemSettings {
    /// Pin the audio thread to one core. Worker threads are deliberately left
    /// free to use the others, because NAM and convolution rely on them.
    bool pinAudioThread = true;
    int audioCpu = 3;
    int audioThreadPriority = 80;
    int workerThreadPriority = 70;
    bool lockMemory = true;
    bool holdCpuLatency = true;

    Json toJson() const;
    static SystemSettings fromJson(const Json& json);
};

struct Settings {
    AudioSettings audio;
    UiSettings ui;
    SystemSettings system;
    ControllerConfig controller;

    std::string activeBankId;
    std::string activePresetId;

    Json toJson() const;
    static Settings fromJson(const Json& json);
};

Json audioSettingsToJson(const AudioSettings& settings);
AudioSettings audioSettingsFromJson(const Json& json, const AudioSettings& fallback);
Json audioDeviceToJson(const AudioDeviceInfo& device);

/// A short random identifier for a new preset, slot, or control.
std::string newId(const std::string& prefix);

} // namespace pimfx
