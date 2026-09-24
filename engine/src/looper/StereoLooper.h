#pragma once

#include "core/Json.h"
#include "core/SpscQueue.h"
#include "transport/MusicalTransport.h"

#include <array>
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace pimfx {

/// One bounded stereo performance loop. All buffers are allocated by prepare()
/// before audio starts. process() is wait-free and performs no allocation or I/O.
class StereoLooper {
public:
    enum class Action : uint8_t {
        Record, Finish, Play, Overdub, Stop, Restart, Mute, Undo, Redo, Clear, LoadPrepared
    };

    explicit StereoLooper(std::string root);
    ~StereoLooper();

    void start();
    void stop();
    void prepare(unsigned sampleRate, unsigned maximumSeconds = 120);
    void configure(const std::string& quantization, bool countIn, float level, float feedback);
    bool enqueue(Action action, std::string& error);
    bool save(const std::string& name, std::string& error);
    bool load(const std::string& name, std::string& error);
    bool renameSaved(const std::string& name, const std::string& nextName, std::string& error);
    bool deleteSaved(const std::string& name, std::string& error);

    /// Realtime entry. input is processed guitar only; output is the independent
    /// master bus that receives loop playback.
    void process(const float* const* input, unsigned inputChannels,
                 float* const* output, unsigned outputChannels, unsigned frames,
                 const TransportBlock* transport) noexcept;

    Json state() const;
    std::string savedPath() const;
    bool wantsTransport() const noexcept;
    bool wantsCountIn() const noexcept { return countIn_.load(std::memory_order_relaxed); }

private:
    enum class Mode : uint8_t { Empty, Armed, Recording, Playing, Overdubbing, Stopped };
    struct Command {
        Action action = Action::Stop;
        int preparedBuffer = -1;
        size_t preparedFrames = 0;
    };

    static const char* modeName(Mode mode) noexcept;
    int64_t boundaryFrame(const TransportBlock* transport, bool strictlyNext) const noexcept;
    void receiveCommand(const Command& command, const TransportBlock* transport) noexcept;
    void beginAction(Action action, int preparedBuffer = -1, size_t preparedFrames = 0) noexcept;
    void finishRecording() noexcept;
    void worker();
    bool writeWaveFile(const std::string& path, int buffer, size_t frames, std::string& error) const;
    bool readWaveFile(const std::string& path, int buffer, size_t& frames, std::string& error);
    void refreshSavedFilesUnlocked();
    bool safeSavedName(const std::string& name, std::string& safe) const;

    std::string root_;
    std::array<std::vector<float>, 2> buffers_;
    size_t capacityFrames_ = 0;
    std::atomic<unsigned> sampleRate_{48000};

    SpscQueue<Command> commands_{64};
    std::mutex commandMutex_;

    // Audio-thread-owned playback/edit state, mirrored through atomics.
    int activeBuffer_ = 0;
    int workingBuffer_ = 1;
    int undoBuffer_ = -1;
    size_t audioLoopFrames_ = 0;
    size_t audioPosition_ = 0;
    size_t audioWritePosition_ = 0;
    bool undoAvailable_ = false;
    bool redoAvailable_ = false;
    bool pending_ = false;
    Action pendingAction_ = Action::Stop;
    int pendingPreparedBuffer_ = -1;
    int64_t pendingFrame_ = 0;
    Mode audioMode_ = Mode::Empty;

    std::atomic<Mode> mode_{Mode::Empty};
    std::atomic<size_t> loopFrames_{0};
    std::atomic<size_t> position_{0};
    std::atomic<bool> canUndo_{false};
    std::atomic<bool> canRedo_{false};
    std::atomic<bool> muted_{false};
    std::atomic<int> quantization_{0}; // 0 free, 1 beat, 2 bar
    std::atomic<bool> countIn_{false};
    std::atomic<uint32_t> levelMilli_{1000};
    std::atomic<uint32_t> feedbackMilli_{1000};
    std::array<std::atomic<uint16_t>, 240> waveform_{};
    std::atomic<int> publishedActiveBuffer_{0};

    std::thread worker_;
    std::atomic<bool> stopping_{false};
    std::atomic<bool> saving_{false};
    std::atomic<bool> loading_{false};
    std::atomic<bool> loadReady_{false};
    mutable std::mutex saveMutex_;
    std::condition_variable saveWake_;
    std::string pendingSaveName_;
    std::string savedPath_;
    std::string saveError_;
    std::vector<std::string> savedFiles_;
};

} // namespace pimfx
