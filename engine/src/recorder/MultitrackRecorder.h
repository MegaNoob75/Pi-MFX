#pragma once

#include "core/Json.h"

#include <array>
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <fstream>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

namespace pimfx {

/// Bounded, disk-streaming multitrack recorder. All callback-facing storage is
/// allocated by prepare(); the worker owns WAV writes and project persistence.
class MultitrackRecorder {
public:
    enum class Source : uint8_t { Raw = 0, Processed, Backing, Drum, Master, Count };

    explicit MultitrackRecorder(std::string root);
    ~MultitrackRecorder();

    void start();
    void stop();
    void prepare(unsigned sampleRate, unsigned maximumFrames);
    void setSourceAvailable(Source source, bool available) noexcept;

    bool command(const std::string& command, const Json& payload, std::string& error);
    Json state() const;
    bool exportFile(const std::string& kind, const std::string& trackId,
                    std::string& path, std::string& name, std::string& error);

    /// Realtime API. One block is reserved, populated in signal-flow order,
    /// then published to the writer. Every method is wait-free and noexcept.
    bool beginCapture(unsigned frames, int64_t timelineFrame) noexcept;
    void captureSource(Source source, const float* const* input,
                       unsigned channels, unsigned frames) noexcept;
    void finishCapture() noexcept;
    void renderPlayback(float* const* output, unsigned channels, unsigned frames) noexcept;
    bool recording() const noexcept { return recording_.load(std::memory_order_acquire); }
    bool playing() const noexcept { return playbackPlaying_.load(std::memory_order_acquire); }

private:
    static constexpr size_t kSourceCount = static_cast<size_t>(Source::Count);
    static constexpr size_t kRingBlocks = 128;
    static constexpr size_t kPlaybackRingBlocks = 4;
    static constexpr size_t kWaveformBuckets = 160;

    struct Clip {
        std::string id;
        std::string file;
        int64_t start = 0;
        int64_t offset = 0;
        int64_t length = 0;
        int64_t fadeIn = 0;
        int64_t fadeOut = 0;
    };
    struct Track {
        std::string id;
        std::string name;
        Source source = Source::Processed;
        bool armed = false;
        bool muted = false;
        bool solo = false;
        float level = 1.0f;
        float pan = 0.0f;
        std::vector<Clip> clips;
        std::array<float, kWaveformBuckets> waveform{};
        size_t waveformCount = 0;
    };
    struct RingBlock {
        std::vector<float> samples;
        unsigned frames = 0;
        int64_t timelineFrame = 0;
        uint32_t mask = 0;
    };
    struct ActiveFile {
        size_t track = 0;
        std::string path;
        std::string relative;
        std::ofstream stream;
        uint64_t frames = 0;
        float peak = 0.0f;
    };

    static const char* sourceName(Source source) noexcept;
    static bool parseSource(const std::string& text, Source& source) noexcept;
    static std::string uniqueId(const char* prefix);
    static void writeWaveHeader(std::ostream& out, unsigned sampleRate, uint32_t frames);
    static bool patchWaveHeader(const std::string& path, unsigned sampleRate, uint64_t frames);

    bool createProject(const std::string& name, std::string& error);
    bool openProject(const std::string& id, std::string& error);
    bool addTrack(const Json& payload, std::string& error);
    bool updateTrack(const Json& payload, std::string& error);
    bool deleteTrack(const Json& payload, std::string& error);
    bool editClip(const std::string& operation, const Json& payload, std::string& error);
    bool startRecording(const Json& payload, std::string& error);
    bool stopRecording(std::string& error);
    bool playbackCommand(const std::string& command, const Json& payload, std::string& error);
    bool deleteProject(const Json& payload, std::string& error);
    bool writeExport(const std::string& kind, const std::string& trackId,
                     std::string& path, std::string& name, std::string& error);
    void saveProjectUnlocked();
    void saveRecoveryUnlocked();
    void refreshProjectsUnlocked();
    void recoverInterruptedProjects();
    void finalizeRecordingUnlocked();
    int64_t timelineFramesUnlocked() const;
    void requestPlaybackReset(int64_t frame) noexcept;
    unsigned renderTimelineBlock(int64_t start, unsigned frames, float* output);
    void worker();
    Track* findTrackUnlocked(const std::string& id);
    Clip* findClipUnlocked(const std::string& id, Track** owner = nullptr);

    std::string root_;
    std::string projectId_;
    std::string projectName_;
    std::vector<std::string> projects_;
    std::vector<Track> tracks_;
    std::vector<ActiveFile> activeFiles_;
    int64_t recordStartFrame_ = 0;

    std::vector<RingBlock> ring_;
    unsigned maxFrames_ = 0;
    std::atomic<unsigned> sampleRate_{48000};
    std::atomic<size_t> writeBlock_{0};
    std::atomic<size_t> readBlock_{0};
    RingBlock* currentBlock_ = nullptr;
    uint32_t currentMask_ = 0;
    std::atomic<uint32_t> armedMask_{0};
    std::atomic<uint32_t> availableMask_{0};
    std::atomic<bool> recording_{false};
    std::atomic<bool> finalizing_{false};
    std::atomic<uint64_t> droppedBlocks_{0};
    std::atomic<uint64_t> writtenFrames_{0};
    std::atomic<uint32_t> queuePermille_{0};
    std::atomic<uint32_t> writeKbps_{0};

    std::vector<RingBlock> playbackRing_;
    unsigned playbackBlockFrames_ = 0;
    std::atomic<size_t> playbackWriteBlock_{0};
    std::atomic<size_t> playbackReadBlock_{0};
    size_t realtimePlaybackOffset_ = 0;
    uint32_t realtimePlaybackGeneration_ = 0;
    uint32_t workerPlaybackGeneration_ = 0;
    int64_t workerPlaybackFrame_ = 0;
    std::atomic<int64_t> requestedPlaybackFrame_{0};
    std::atomic<int64_t> playbackPositionFrame_{0};
    std::atomic<uint32_t> playbackGeneration_{1};
    std::atomic<uint32_t> playbackAcknowledgedGeneration_{0};
    std::atomic<bool> playbackResetting_{false};
    std::atomic<bool> playbackPlaying_{false};
    std::atomic<bool> playbackPaused_{false};
    std::atomic<bool> playbackEof_{false};
    std::atomic<uint64_t> playbackUnderruns_{0};
    std::unordered_map<std::string, std::array<float, 2>> playbackTrackGains_;

    std::thread worker_;
    std::atomic<bool> stopping_{false};
    mutable std::mutex stateMutex_;
    std::condition_variable wake_;
    std::string lastError_;
    std::string warning_;
    std::vector<std::string> recoveredFiles_;
};

} // namespace pimfx
