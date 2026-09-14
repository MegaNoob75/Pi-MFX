#pragma once

#include "core/Json.h"
#include "host/UridMap.h"

#include <atomic>
#include <memory>
#include <string>
#include <vector>

namespace pimfx {

struct TransportBlock;

/// One point on a control's scale that the plugin gave a name to, e.g. the
/// positions of a mode switch. The UI renders these as a picker instead of a
/// meaningless 0-4 knob.
struct ScalePoint {
    float value = 0.0f;
    std::string label;
};

struct PortInfo {
    uint32_t index = 0;
    std::string symbol;
    std::string name;
    std::string unit;
    std::string unitUri;

    bool input = true;
    bool control = false;
    bool audio = false;
    bool atom = false;
    bool cv = false;
    bool supportsTimePosition = false;

    float minimum = 0.0f;
    float maximum = 1.0f;
    float defaultValue = 0.0f;

    bool toggled = false;
    bool integer = false;
    bool enumerated = false;
    bool logarithmic = false;
    /// Ports the plugin marks as output-only meters: level, gain reduction,
    /// tuner pitch. The UI polls these instead of trying to edit them.
    bool meter = false;
    /// True for delay-like time inputs whose LV2 unit can be converted from
    /// musical note lengths without plugin-specific code.
    bool tempoLinkCandidate = false;
    /// Number of seconds represented by one port unit (0.001 for ms, 1 for s).
    double secondsPerUnit = 0.0;

    std::vector<ScalePoint> scalePoints;

    Json toJson() const;
};

/// A `patch:writable` property, which is how modern plugins take file paths.
/// NAM captures and cabinet impulse responses both arrive this way rather than
/// as control ports.
struct PatchProperty {
    std::string uri;
    std::string label;
    std::string range;                  ///< atom type URI, e.g. atom:Path
    std::vector<std::string> fileTypes; ///< ".nam", ".wav", ...
    bool isPath = false;

    Json toJson() const;
};

struct PluginInfo {
    std::string uri;
    std::string name;
    std::string brand;
    std::string className;   ///< LV2 class, e.g. "Distortion Plugin"
    std::string author;
    std::string homepage;
    std::string comment;

    unsigned audioInputs = 0;
    unsigned audioOutputs = 0;
    bool hasMidiInput = false;

    /// Set when the plugin takes a `.nam` capture or an impulse response, so
    /// the UI can offer the model browser directly on the effect.
    bool takesNamModel = false;
    bool takesImpulseResponse = false;

    std::vector<PortInfo> ports;
    std::vector<PatchProperty> properties;

    Json toJson(bool includePorts) const;
};

/// Everything lilv can find on this machine, read once at startup and on
/// demand when the user installs new plugins.
class Lv2Catalog {
public:
    Lv2Catalog();
    ~Lv2Catalog();

    Lv2Catalog(const Lv2Catalog&) = delete;
    Lv2Catalog& operator=(const Lv2Catalog&) = delete;

    /// Scans the LV2 path. Safe to call again; the previous catalog stays
    /// usable until the new one is ready.
    bool rescan(std::string& error);

    /// Extra bundle directory owned by Pi-MFX (`/var/lib/pimfx/lv2`). Loaded
    /// in addition to the system LV2 path after each rescan.
    void setUserBundleDirectory(std::string directory);

    bool available() const;

    const std::vector<PluginInfo>& plugins() const { return plugins_; }
    const PluginInfo* find(const std::string& uri) const;

    /// Distinct plugin classes present, for the category rail in the picker.
    std::vector<std::string> categories() const;

    UridMap& urids() { return urids_; }

    struct Impl;
    Impl* impl() { return impl_.get(); }

private:
    std::unique_ptr<Impl> impl_;
    std::vector<PluginInfo> plugins_;
    UridMap urids_;
    std::string userBundleDirectory_;
};

/// A live plugin.
///
/// Instantiation, activation, and property changes happen on the control
/// thread. Only `process()` and `setControl()` may be called from the audio
/// thread, and both are wait-free.
class PluginInstance {
public:
    ~PluginInstance();

    static std::unique_ptr<PluginInstance> create(Lv2Catalog& catalog,
                                                  const std::string& uri,
                                                  unsigned sampleRate,
                                                  unsigned maxFrames,
                                                  std::string& error);

    const PluginInfo& info() const { return info_; }
    const std::string& uri() const { return info_.uri; }

    /// Audio-thread safe: stores the value for the next `run()`.
    void setControl(uint32_t portIndex, float value);
    float control(uint32_t portIndex) const;

    /// Current value of an output control port, for meters and tuners.
    float readOutput(uint32_t portIndex) const;

    /// Sends a `patch:Set` for a property. Control thread only: it touches the
    /// filesystem, and loading a NAM capture can take tens of milliseconds.
    bool setProperty(const std::string& propertyUri, const std::string& value, std::string& error);
    std::string property(const std::string& propertyUri) const;

    /// Queues a MIDI event for the next `run()`. Audio-thread safe.
    void pushMidi(const uint8_t* data, uint32_t size, uint32_t frameOffset);

    /// Runs the plugin for `frames`. Buffers are the host's scratch channels;
    /// unconnected plugin inputs receive silence and extra outputs are ignored.
    void process(const float* const* inputs, unsigned inputCount,
                 float* const* outputs, unsigned outputCount,
                 unsigned frames, const TransportBlock* transport = nullptr);

    unsigned audioInputs() const { return info_.audioInputs; }
    unsigned audioOutputs() const { return info_.audioOutputs; }

    /// Serialises control values and properties for a preset.
    Json saveState() const;
    void loadState(const Json& state);

private:
    PluginInstance();

    struct Impl;
    std::unique_ptr<Impl> impl_;
    PluginInfo info_;
};

} // namespace pimfx
