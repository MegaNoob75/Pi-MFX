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
    /// Port symbol -> duration in quarter-note beats. Missing means the port
    /// remains in its native millisecond/second mode.
    Json tempoLinks = Json::object();

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
    /// Layout slot (Snapshot 1 = 0). Empty holes stay empty instead of shifting.
    int slot = -1;

    Json toJson() const;
    static Snapshot fromJson(const Json& json);
};

/// Maps a physical control onto one parameter or bypass of this preset.
struct ParameterBinding {
    std::string controlId;
    std::string action;     ///< setParameter or toggleEffect
    std::string slotId;
    std::string portSymbol; ///< for setParameter
    float minimum = 0.0f;
    float maximum = 1.0f;
    bool inverted = false;

    Json toJson() const;
    static ParameterBinding fromJson(const Json& json);
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
    std::vector<ParameterBinding> parameterBindings;
    /// Provenance and completion state for an imported community preset.
    /// Empty for presets created locally.
    Json community = Json::object();
    /// Layout slot of the snapshot currently applied to the live chain, or -1.
    int activeSnapshot = -1;
    /// Last Snapshot-view choice for this preset. Performance re-press toggles it.
    int rememberedSnapshotSlot = -1;
    bool rememberedSnapshotEnabled = false;

    const EffectSlot* findSlot(const std::string& slotId) const;
    EffectSlot* findSlot(const std::string& slotId);
    const ParameterBinding* findParameterBinding(const std::string& controlId) const;
    ParameterBinding* findParameterBinding(const std::string& controlId);

    Json toJson() const;
    static Preset fromJson(const Json& json);
};

/// Banks are the unit the foot controller steps through, and the unit the user
/// exports and shares.
struct Bank {
    std::string id;
    std::string name = "Bank";
    int order = 0; ///< user-facing list order; lower values appear first
    bool communityHolding = false; ///< staging only; excluded from performance use
    /// Last preset loaded in this bank, so returning to it restores that slot.
    std::string lastPresetId;
    std::vector<Preset> presets;

    Json toJson() const;
    static Bank fromJson(const Json& json);
};

// ---------------------------------------------------------------------------
// DIY controller
// ---------------------------------------------------------------------------

enum class ControlKind {
    Momentary,    ///< tap while pressed (typical footswitch)
    Latching,     ///< stays ON/OFF with the physical toggle
    Pot,          ///< rotary potentiometer
    Slider,       ///< linear fader
    Encoder,      ///< rotary encoder, relative MIDI (63 CCW / 65 CW)
    EncoderPush,  ///< optional click built into an encoder
    Expression    ///< expression pedal input
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
    /// Snapshot-view slot for this switch (0 = Snapshot 1). -1 = none.
    int snapshotSlot = -1;
    /// Legacy hardware bind fields. Migrated onto Preset::parameterBindings on load.
    std::string slotId;
    std::string portSymbol;

    float minimum = 0.0f;   ///< range a pot or pedal sweeps across
    float maximum = 1.0f;
    bool inverted = false;

    /// Held-switch alternative action, so one footswitch can do two jobs.
    std::string holdAction;
    int holdMilliseconds = 600;
    /// Second tap within `doubleTapMilliseconds`. Preset switches default to
    /// reloading the stored preset with bypass and snapshot cleared.
    std::string doubleAction;
    int doubleTapMilliseconds = 320;

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
    ControlKind kind = ControlKind::Momentary;

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
    /// Encoder turn ↔ encoder push. Empty when the control is unpaired.
    std::string pairId;
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

    /// Always freeform. Older controller.json may still say "grid"; the UI
    /// ignores that and packs with rects.
    std::string layoutMode = "freeform";
    int gridRows = 2;
    int gridColumns = 4;

    /// ALSA raw MIDI id the floorboard is attached to, e.g. "hw:2,0,0". Empty
    /// means the user still has to pick a device in Settings → Controller,
    /// unless exactly one MIDI input is present.
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
    std::string themeId = "Pi-MFX Purple";
    Json customThemes = Json::array();
    Json ledColors = Json::object();
    double scale = 1.0;
    /// Stable menu ids and header shortcuts. Stored on the Pi so every
    /// connected screen sees the same workstation navigation.
    Json menuOrder = Json::array();
    Json shortcuts = Json::object();
    std::string startupView = "performance";
    /// Number of on-screen performance switches when no physical controller is
    /// connected, so a tablet alone is still a complete control surface.
    int virtualSwitchCount = 8;
    /// Performance encoder: browse (click to load), live (load while turning),
    /// or session (remap switch tiles until reboot).
    std::string performanceEncoder = "browse";
    /// Firmware already groups quadrature pulses into one MIDI message per
    /// tactile click. Leave at 1 unless an ungrouped encoder jumps items.
    int encoderStepsPerDetent = 1;
    /// Extra MIDI steps a pot must move before the value is accepted. 0 leaves
    /// firmware hysteresis as the only filter.
    int analogDeadband = 0;
    /// Extra milliseconds to ignore after a switch or encoder click. Firmware
    /// already debounces; this is for noisy MIDI or cheap switches.
    int switchDebounceMs = 0;
    /// Default author for Community Preset manifests. Stored on the Pi so it
    /// follows the rig across browsers, while remaining editable per share.
    std::string communityAuthor;
    Json tuner = Json::object();

    Json toJson() const;
    static UiSettings fromJson(const Json& json);
};

/// Realtime tuning the user can change without editing files on the Pi.
struct SystemSettings {
    /// Do not pin the audio thread or isolate cores. NAM, convolution, and
    /// other LV2s spawn worker threads and need the scheduler to place them
    /// on every core. SCHED_FIFO on the audio thread is what keeps them from
    /// delaying a period.
    bool pinAudioThread = false;
    int audioCpu = 3;
    int audioThreadPriority = 80;
    int workerThreadPriority = 70;
    bool lockMemory = true;
    bool holdCpuLatency = true;
    /// Retained in the settings schema for backward compatibility. Completed
    /// workstation services are enabled automatically rather than by debug UI.
    bool sharedTransportEnabled = true;
    bool backingTracksEnabled = true;
    Json toJson() const;
    static SystemSettings fromJson(const Json& json);
};

struct TransportSettings {
    int beatsPerBar = 4;
    int beatUnit = 4;
    int countInBars = 0;
    bool metronomeEnabled = false;
    bool quantizationEnabled = false;

    Json toJson() const;
    static TransportSettings fromJson(const Json& json);
};

struct LooperSettings {
    std::string quantization = "free";
    bool countIn = false;
    float level = 1.0f;
    float feedback = 1.0f;

    Json toJson() const;
    static LooperSettings fromJson(const Json& json);
};

struct Settings {
    AudioSettings audio;
    UiSettings ui;
    SystemSettings system;
    TransportSettings transport;
    LooperSettings looper;
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
