#pragma once

#include "core/Json.h"

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

namespace pimfx {

class BackingTrackPlayer {
public:
    explicit BackingTrackPlayer(std::string root);
    ~BackingTrackPlayer();

    void start();
    void stop();
    void prepare(unsigned outputSampleRate);
    bool importFile(const std::string& name, const std::string& bytes, std::string& error);
    bool load(const std::string& path, std::string& error);
    void next();
    void previous();
    void refreshPlaylist();
    void fileMoved(const std::string& oldPath, const std::string& newPath);
    void fileDeleted(const std::string& path);
    bool setListCommand(const std::string& command, const Json& payload, std::string& error);
    bool loadSetListEntry(int index, std::string& error);
    bool updateTrackSettings(const Json& payload, std::string& error);
    void play();
    void pause();
    void stopPlayback();
    void restart();
    void seek(double seconds);
    void setLevel(float level);
    void setManualBpm(double bpm);
    void setLoop(bool enabled, double start, double end);

    /// Realtime callback entry: atomics and preallocated memory only.
    void render(float* const* outputs, unsigned channels, unsigned frames);
    Json state() const;
    bool available() const;

private:
    enum class CommandType { Load, Seek, Stop, Restart, Unload };
    struct Command {
        CommandType type = CommandType::Stop;
        std::string path;
        double seconds = 0.0;
    };

    void enqueue(Command command);
    void worker();
    void resetProducerBuffer(double positionSeconds);
    size_t writableFrames();
    size_t writeStereo(const float* stereo, size_t frames);
    void savePlaylistUnlocked();
    void loadSetLists();
    void saveSetListsUnlocked();
    void loadTrackSettings();
    void saveTrackSettingsUnlocked();
    bool safeLibraryPath(const std::string& path, std::string& canonical) const;

    std::string root_;
    std::thread thread_;
    std::mutex commandMutex_;
    std::condition_variable wake_;
    std::deque<Command> commands_;
    std::atomic<bool> stopping_{false};

    std::vector<float> ring_;
    size_t ringFrameMask_ = 0;
    std::atomic<size_t> readFrame_{0};
    std::atomic<size_t> writeFrame_{0};
    std::atomic<uint32_t> bufferGeneration_{1};
    std::atomic<uint32_t> acknowledgedGeneration_{0};
    std::atomic<bool> bufferResetting_{false};
    uint32_t realtimeGeneration_ = 0;
    double realtimePosition_ = 0.0;
    bool realtimeUnderrunActive_ = false;
    bool realtimeHasPlayed_ = false;
    std::atomic<uint32_t> resetPositionMillis_{0};

    std::atomic<unsigned> outputSampleRate_{48000};
    std::atomic<bool> loaded_{false};
    std::atomic<bool> loadPending_{false};
    std::atomic<bool> playing_{false};
    std::atomic<bool> playbackStarted_{false};
    std::atomic<bool> decodeEof_{false};
    std::atomic<bool> loopEnabled_{false};
    std::atomic<uint32_t> levelMilli_{1000};
    std::atomic<uint32_t> positionMillis_{0};
    std::atomic<uint32_t> durationMillis_{0};
    std::atomic<uint32_t> loopStartMillis_{0};
    std::atomic<uint32_t> loopEndMillis_{0};
    std::atomic<uint32_t> manualBpmMilli_{0};
    std::atomic<uint32_t> underruns_{0};

    mutable std::mutex stateMutex_;
    Json state_ = Json::object();
    std::vector<float> waveform_;
    mutable std::mutex playlistMutex_;
    std::vector<std::string> playlist_;
    size_t playlistIndex_ = 0;
    struct SetList {
        std::string id;
        std::string name;
        std::vector<std::string> entries;
    };
    std::vector<SetList> setLists_;
    std::string activeSetListId_;
    size_t setListIndex_ = 0;
    struct TrackSettings {
        std::string title;
        std::string artist;
        std::string album;
        std::string notes;
        double bpm = 0.0;
        float level = 1.0f;
        bool loopEnabled = false;
        double loopStart = 0.0;
        double loopEnd = 0.0;
    };
    mutable std::mutex metadataMutex_;
    std::unordered_map<std::string, TrackSettings> trackSettings_;
};

}
