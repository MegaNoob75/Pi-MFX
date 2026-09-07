#pragma once

#include "audio/AudioBackend.h"
#include "audio/RtPriority.h"
#include "core/Json.h"
#include "core/SpscQueue.h"
#include "host/Lv2Host.h"
#include "midi/Mapping.h"
#include "midi/MidiInput.h"
#include "model/Storage.h"

#include <atomic>
#include <chrono>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace pimfx {

/// Reading of the input signal's pitch, for the on-screen tuner.
struct TunerReading {
    bool valid = false;
    float frequency = 0.0f;
    int midiNote = 0;
    float cents = 0.0f;
    std::string noteName;
};

/// The whole instrument.
///
/// Engine owns the audio device, the plugin chain, the preset library, and the
/// controller link, and is the only thing the control API talks to. Everything
/// that must not block the audio thread happens here on the control thread;
/// the audio thread only reads what has already been published.
class Engine : public AudioProcessor {
public:
    explicit Engine(Paths paths);
    ~Engine() override;

    /// Loads settings, scans plugins, opens the audio device, and connects the
    /// controller. Returns false only for failures that make the engine
    /// useless; a missing audio device is reported through the state instead,
    /// so the user can fix it from the UI.
    bool start(std::string& error);
    void stop();

    /// Invoked whenever anything the UI shows has changed. The listener is
    /// called on the control thread, never from audio.
    using StateListener = std::function<void(const Json&)>;
    void setStateListener(StateListener listener);

    // --- state -----------------------------------------------------------
    Json fullState() const;
    Json performanceState() const;   ///< the small, frequent update
    Json meterState() const;
    Json catalogState(bool includePorts) const;
    Json audioDevicesState();
    Json midiPortsState() const;
    Json libraryState() const;
    Json diagnosticsState() const;

    // --- audio -----------------------------------------------------------
    bool applyAudioSettings(const Json& json, std::string& error);
    bool applySystemSettings(const Json& json, std::string& error);
    void resetMeters();

    // --- banks and presets -----------------------------------------------
    bool selectPreset(const std::string& bankId, const std::string& presetId, std::string& error);
    bool stepPreset(int delta, std::string& error);
    bool stepBank(int delta, std::string& error);
    bool savePreset(std::string& error);
    bool savePresetAs(const std::string& name, std::string& error);
    bool renamePreset(const std::string& presetId, const std::string& name, std::string& error);
    bool deletePreset(const std::string& presetId, std::string& error);
    bool reorderPreset(const std::string& presetId, int newIndex, std::string& error);
    bool movePresetToBank(const std::string& presetId, const std::string& targetBankId, int newIndex, std::string& error);
    bool createBank(const std::string& name, std::string& error);
    bool renameBank(const std::string& bankId, const std::string& name, std::string& error);
    bool deleteBank(const std::string& bankId, std::string& error);
    bool reorderBank(const std::string& bankId, int newIndex, std::string& error);
    Json exportBank(const std::string& bankId) const;
    bool importBank(const Json& json, std::string& error);

    // --- chain -----------------------------------------------------------
    bool addEffect(const std::string& uri, int index, std::string& slotId, std::string& error);
    bool removeEffect(const std::string& slotId, std::string& error);
    bool moveEffect(const std::string& slotId, int newIndex, std::string& error);
    bool setEffectEnabled(const std::string& slotId, bool enabled, std::string& error);
    bool setEffectName(const std::string& slotId, const std::string& name, std::string& error);
    bool setControlValue(const std::string& slotId, const std::string& portSymbol,
                         float value, std::string& error);
    bool setEffectProperty(const std::string& slotId, const std::string& propertyUri,
                           const std::string& path, std::string& error);
    bool setBypassAll(bool bypassed);
    bool bypassAll() const;

    // --- snapshots -------------------------------------------------------
    bool captureSnapshot(const std::string& name, std::string& snapshotId, std::string& error);
    bool selectSnapshot(const std::string& snapshotId, std::string& error);
    bool updateSnapshot(const std::string& snapshotId, std::string& error);
    bool renameSnapshot(const std::string& snapshotId, const std::string& name, std::string& error);
    bool colorSnapshot(const std::string& snapshotId, const std::string& color, std::string& error);
    bool deleteSnapshot(const std::string& snapshotId, std::string& error);
    bool setSnapshotMode(bool enabled);
    /// Puts the live chain back to the stored base preset, discarding a
    /// snapshot that is being auditioned or edited.
    bool restoreLiveFromStoredPreset(std::string& error);

    // --- controller ------------------------------------------------------
    bool applyControllerConfig(const Json& json, std::string& error);
    bool connectController(const std::string& port, std::string& error);
    void disconnectController();
    void beginControlLearn(const std::string& controlId);
    void cancelControlLearn();
    /// Presses a control from the browser. This is what makes a tablet a
    /// complete control surface with no hardware attached.
    bool pressVirtualControl(const std::string& controlId, bool pressed, std::string& error);
    /// Sets a pot, slider or expression pedal from the screen. `value` is 0-1
    /// as the on-screen control is pointing.
    bool setVirtualControlValue(const std::string& controlId, float value, std::string& error);

    // --- UI preferences --------------------------------------------------
    bool applyUiSettings(const Json& json, std::string& error);

    // --- library ---------------------------------------------------------
    bool storeLibraryFile(const std::string& kind, const std::string& name,
                          const std::string& contents, std::string& storedPath, std::string& error);
    bool deleteLibraryFile(const std::string& path, std::string& error);

    Storage& storage() { return storage_; }
    Lv2Catalog& catalog() { return catalog_; }
    const Settings& settings() const { return settings_; }

    /// Pushes full state to UI listeners. Used after a catalog rescan so
    /// pluginCount updates without restarting audio.
    void publishState();

    void tapTempo();
    TunerReading tuner() const;
    void setTunerEnabled(bool enabled);

    // --- AudioProcessor --------------------------------------------------
    void processAudio(const float* const* inputs, unsigned inputChannels,
                      float* const* outputs, unsigned outputChannels,
                      unsigned frames) override;
    void prepareToPlay(unsigned sampleRate, unsigned maxFrames) override;
    void releaseResources() override;

private:
    /// One live plugin plus the flag the audio thread reads to decide whether
    /// to run it.
    struct ChainSlot {
        std::string id;
        std::unique_ptr<PluginInstance> plugin;
        std::atomic<bool> enabled{true};
    };

    /// A whole signal chain. Chains are built on the control thread and handed
    /// to the audio thread by pointer swap, never edited in place.
    struct Chain {
        std::vector<std::unique_ptr<ChainSlot>> slots;
        std::vector<std::vector<float>> bufferA;
        std::vector<std::vector<float>> bufferB;
        std::vector<float*> pointersA;
        std::vector<float*> pointersB;
        unsigned channels = 2;
    };

    /// Values changed from the UI while audio is running, applied at the top
    /// of the next period so a knob move never tears across a buffer.
    struct ControlUpdate {
        uint32_t slotIndex;
        uint32_t portIndex;
        float value;
    };

    bool restartAudio(std::string& error);
    void publishChain(std::unique_ptr<Chain> chain);
    void collectRetiredChains();
    std::unique_ptr<Chain> buildChain(const Preset& preset, std::string& error);
    void applySnapshotToChain(const Snapshot& snapshot);
    Snapshot captureCurrentChain(const std::string& name) const;

    Preset* activePreset();
    const Preset* activePreset() const;
    Bank* activeBank();
    const Bank* activeBank() const;
    Bank* findBank(const std::string& bankId);
    void syncPresetFromChain();
    bool persistSettings();
    void notify();
    void notifyPerformance();

    void handleMidiMessage(const MidiMessage& message);
    void handleSysEx(const std::vector<uint8_t>& sysex);
    void runAction(const ActionRequest& request);
    void refreshLeds();
    Json describeControllerRuntime() const;

    void tunerThread();
    void housekeepingThread();

    Storage storage_;
    Settings settings_;
    std::vector<Bank> banks_;
    std::string activeBankId_;
    std::string activePresetId_;

    Lv2Catalog catalog_;
    std::unique_ptr<AudioBackend> backend_;
    AudioMetrics metrics_;
    std::unique_ptr<rt::CpuLatencyGuard> latencyGuard_;

    std::atomic<Chain*> activeChain_{nullptr};
    std::vector<std::pair<std::unique_ptr<Chain>, uint64_t>> retiredChains_;
    std::atomic<uint64_t> audioGeneration_{0};
    mutable std::mutex chainMutex_;

    SpscQueue<ControlUpdate> controlUpdates_{2048};

    std::atomic<bool> bypassAll_{false};
    std::atomic<bool> snapshotMode_{false};
    std::atomic<float> inputGain_{1.0f};
    std::atomic<float> outputGain_{1.0f};
    std::atomic<float> targetOutputGain_{1.0f};
    std::atomic<unsigned> guitarInputChannel_{1};

    MidiInput midi_;
    ControllerRuntime controller_;
    std::string audioError_;
    std::string controllerError_;

    // Tuner: the audio thread copies a decimated mono signal into this ring
    // and a background thread does the analysis, so pitch detection can never
    // affect the audio path.
    std::vector<float> tunerRing_;
    std::atomic<size_t> tunerWrite_{0};
    std::atomic<bool> tunerEnabled_{true};
    mutable std::mutex tunerMutex_;
    TunerReading tunerReading_;

    std::thread tunerThread_;
    std::thread housekeepingThread_;
    std::atomic<bool> shuttingDown_{false};

    std::atomic<unsigned> sampleRate_{48000};
    std::atomic<unsigned> maxFrames_{64};

    std::vector<std::chrono::steady_clock::time_point> tapTimes_;
    std::mutex tapMutex_;

    StateListener listener_;
    mutable std::mutex listenerMutex_;
    mutable std::mutex stateMutex_;
};

} // namespace pimfx
