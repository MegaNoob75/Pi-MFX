#pragma once

#include "core/Json.h"
#include "core/SpscQueue.h"
#include "drums/DrumSequencer.h"

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <mutex>
#include <string>
#include <vector>

namespace pimfx {

/// Sample-based drum instrument. Disk access, WAV decoding, resampling and
/// JSON persistence occur on control threads. render() is wait-free and uses
/// only immutable sample data published through bounded SPSC queues.
class DrumMachine {
public:
    explicit DrumMachine(std::string root);
    ~DrumMachine();

    void prepare(unsigned sampleRate);
    bool importSample(unsigned voice, const std::string& name,
                      const std::string& bytes, std::string& error);
    bool command(const std::string& command, const Json& payload, std::string& error);

    void render(float* const* master, unsigned masterChannels,
                float* const* sourceTap, unsigned tapChannels, unsigned frames,
                const TransportBlock& transport) noexcept;

    Json state() const;
    bool playing() const noexcept { return playing_.load(std::memory_order_acquire); }

private:
    static constexpr unsigned kMaximumSampleSeconds = 30;
    static constexpr size_t kMaximumTriggersPerBlock = 256;

    struct Sample {
        std::vector<float> left;
        std::vector<float> right;
        std::string file;
        std::string name;
    };
    struct Kit {
        std::array<Sample, DrumSequencer::kVoiceCount> voices;
    };
    struct KitCommand { Kit* kit = nullptr; };
    struct Playback {
        const Sample* sample = nullptr;
        size_t position = 0;
        float gain = 0.0f;
    };

    bool updateStep(const Json& payload, std::string& error);
    bool updateSong(const Json& payload, std::string& error);
    bool updateSettings(const Json& payload, std::string& error);
    bool saveKit(const Json& payload, std::string& error);
    bool loadKit(const Json& payload, std::string& error);
    bool deleteKit(const Json& payload, std::string& error);
    bool publishProgramUnlocked(std::string& error);
    bool publishKitUnlocked(std::string& error);
    bool loadStateUnlocked();
    bool saveStateUnlocked() const;
    void collectRetired() const;
    static Json patternToJson(const DrumSequencer::Pattern& pattern);
    static bool patternFromJson(const Json& json, DrumSequencer::Pattern& pattern);
    static bool decodeWave(const std::string& bytes, unsigned outputRate,
                           Sample& sample, std::string& error);
    static bool safeWaveName(const std::string& name, std::string& safe);

    std::string root_;
    std::string samplesRoot_;
    std::string kitsRoot_;
    std::string statePath_;
    unsigned sampleRate_ = 48000;

    mutable std::mutex stateMutex_;
    DrumSequencer sequencer_;
    DrumSequencer::Program program_{};
    Kit controlKit_{};
    std::string kitName_ = "Custom";
    std::vector<std::string> savedKits_;
    float controlLevel_ = 0.8f;
    float controlSwing_ = 0.0f;
    float controlHumanization_ = 0.0f;

    SpscQueue<KitCommand> kitCommands_{16};
    mutable SpscQueue<Kit*> retiredKits_{16};
    Kit* activeKit_ = nullptr; // audio thread only
    std::array<Playback, DrumSequencer::kVoiceCount> playback_{};
    std::atomic<uint32_t> levelPermille_{800};
    std::atomic<bool> playing_{false};
    std::atomic<uint32_t> kitGeneration_{0};
    std::atomic<uint32_t> droppedKitChanges_{0};
};

} // namespace pimfx
