#pragma once

#include "core/Json.h"

#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <mutex>

namespace pimfx {

struct TransportBlock {
    double bpm = 120.0;
    double beatsPerBar = 4.0;
    int beatUnit = 4;
    double framesPerSecond = 48000.0;
    int64_t frame = 0;
    int64_t timelineFrame = 0;
    int64_t bar = 0;
    double barBeat = 0.0;
    double beat = 0.0;
    double speed = 0.0;
    double framesPerBeat = 24000.0;
    bool playing = false;
    bool countingIn = false;
    bool metronomeEnabled = false;
};

/// Engine-owned musical timebase. Control methods may be called from UI/MIDI
/// threads. beginAudioBlock() is wait-free and performs no allocation.
class MusicalTransport {
public:
    void setSampleRate(unsigned sampleRate) noexcept;
    void setBpm(double bpm) noexcept;
    void setTimeSignature(int beatsPerBar, int beatUnit) noexcept;
    void setCountInBars(int bars) noexcept;
    void setMetronomeEnabled(bool enabled) noexcept;
    void setQuantizationEnabled(bool enabled) noexcept;

    double tap();
    double tapAt(std::chrono::steady_clock::time_point now);
    void play(bool restart = false) noexcept;
    void stop() noexcept;
    void restart() noexcept;

    TransportBlock beginAudioBlock(unsigned frames) noexcept;
    float metronomeSample(const TransportBlock& block, unsigned frameOffset) const noexcept;
    Json state() const;

    double bpm() const noexcept { return bpmMilli_.load(std::memory_order_relaxed) / 1000.0; }
    bool playing() const noexcept { return playing_.load(std::memory_order_relaxed); }
    bool quantizationEnabled() const noexcept { return quantizationEnabled_.load(std::memory_order_relaxed); }
    bool beatPulse() const noexcept;

private:
    static double clampBpm(double bpm) noexcept;
    int64_t countInFrames(double bpm, int beatsPerBar, unsigned sampleRate) const noexcept;
    void publishTimeline(int64_t frame) noexcept;
    int64_t publishedTimeline() const noexcept;

    std::atomic<uint32_t> bpmMilli_{120000};
    std::atomic<int> beatsPerBar_{4};
    std::atomic<int> beatUnit_{4};
    std::atomic<int> countInBars_{0};
    std::atomic<bool> metronomeEnabled_{false};
    std::atomic<bool> quantizationEnabled_{false};
    std::atomic<bool> playing_{false};
    std::atomic<unsigned> sampleRate_{48000};
    std::atomic<uint32_t> restartRequest_{0};
    std::atomic<uint32_t> timelineSequence_{0};
    std::atomic<uint32_t> timelineLow_{0};
    std::atomic<uint32_t> timelineHigh_{0};
    uint32_t appliedRestart_ = 0; // audio thread only
    int64_t audioTimelineFrame_ = 0; // audio thread only

    std::array<std::chrono::steady_clock::time_point, 4> tapTimes_{};
    size_t tapCount_ = 0;
    mutable std::mutex tapMutex_;
};

} // namespace pimfx
