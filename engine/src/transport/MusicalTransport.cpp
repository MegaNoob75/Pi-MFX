#include "transport/MusicalTransport.h"

#include <algorithm>
#include <cmath>

namespace pimfx {
namespace {

constexpr double kMinBpm = 30.0;
constexpr double kMaxBpm = 300.0;
constexpr double kPi = 3.14159265358979323846;
static_assert(std::atomic<uint32_t>::is_always_lock_free,
              "MusicalTransport requires lock-free 32-bit atomics");

}

double MusicalTransport::clampBpm(double bpm) noexcept {
    if (!std::isfinite(bpm)) return 120.0;
    return std::max(kMinBpm, std::min(kMaxBpm, bpm));
}

void MusicalTransport::setSampleRate(unsigned sampleRate) noexcept {
    sampleRate_.store(std::max(1u, sampleRate), std::memory_order_release);
}

void MusicalTransport::setBpm(double bpm) noexcept {
    bpmMilli_.store(static_cast<uint32_t>(std::llround(clampBpm(bpm) * 1000.0)),
                    std::memory_order_release);
}

void MusicalTransport::setTimeSignature(int beatsPerBar, int beatUnit) noexcept {
    beatsPerBar_.store(std::max(1, std::min(32, beatsPerBar)), std::memory_order_release);
    const int validUnit = beatUnit == 1 || beatUnit == 2 || beatUnit == 4
                       || beatUnit == 8 || beatUnit == 16 || beatUnit == 32
                        ? beatUnit : 4;
    beatUnit_.store(validUnit, std::memory_order_release);
}

void MusicalTransport::setCountInBars(int bars) noexcept {
    countInBars_.store(std::max(0, std::min(8, bars)), std::memory_order_release);
}

void MusicalTransport::setMetronomeEnabled(bool enabled) noexcept {
    metronomeEnabled_.store(enabled, std::memory_order_release);
}

void MusicalTransport::setQuantizationEnabled(bool enabled) noexcept {
    quantizationEnabled_.store(enabled, std::memory_order_release);
}

double MusicalTransport::tap() {
    return tapAt(std::chrono::steady_clock::now());
}

double MusicalTransport::tapAt(std::chrono::steady_clock::time_point now) {
    std::lock_guard<std::mutex> lock(tapMutex_);
    if (tapCount_ > 0) {
        const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
            now - tapTimes_[tapCount_ - 1]).count();
        // A 100 ms interval is far above normal switch bounce and still below
        // the 200 ms interval at the supported 300 BPM maximum.
        if (elapsed < 100) return bpm();
        if (elapsed > 2000) tapCount_ = 0;
    }
    if (tapCount_ == tapTimes_.size()) {
        std::move(tapTimes_.begin() + 1, tapTimes_.end(), tapTimes_.begin());
        --tapCount_;
    }
    tapTimes_[tapCount_++] = now;
    if (tapCount_ < 2) return bpm();

    double seconds = 0.0;
    for (size_t i = 1; i < tapCount_; ++i) {
        seconds += std::chrono::duration<double>(tapTimes_[i] - tapTimes_[i - 1]).count();
    }
    const double average = seconds / static_cast<double>(tapCount_ - 1);
    if (average > 0.0) setBpm(60.0 / average);
    return bpm();
}

int64_t MusicalTransport::countInFrames(double bpm, int beatsPerBar, unsigned sampleRate) const noexcept {
    const double beats = static_cast<double>(countInBars_.load(std::memory_order_relaxed) * beatsPerBar);
    return static_cast<int64_t>(std::llround(beats * 60.0 * sampleRate / bpm));
}

void MusicalTransport::play(bool restartTimeline) noexcept {
    if (restartTimeline) restart();
    playing_.store(true, std::memory_order_release);
}

void MusicalTransport::stop() noexcept {
    playing_.store(false, std::memory_order_release);
}

void MusicalTransport::restart() noexcept {
    restartRequest_.fetch_add(1, std::memory_order_release);
}

TransportBlock MusicalTransport::beginAudioBlock(unsigned frames) noexcept {
    TransportBlock block;
    block.bpm = bpm();
    block.beatsPerBar = static_cast<double>(beatsPerBar_.load(std::memory_order_acquire));
    block.beatUnit = beatUnit_.load(std::memory_order_acquire);
    block.framesPerSecond = static_cast<double>(sampleRate_.load(std::memory_order_acquire));
    block.framesPerBeat = block.framesPerSecond * 60.0 / block.bpm * 4.0 / block.beatUnit;
    block.playing = playing_.load(std::memory_order_acquire);
    block.speed = block.playing ? 1.0 : 0.0;

    const uint32_t requestedRestart = restartRequest_.load(std::memory_order_acquire);
    if (requestedRestart != appliedRestart_) {
        const int64_t preRoll = countInFrames(block.bpm, static_cast<int>(block.beatsPerBar),
                                             static_cast<unsigned>(block.framesPerSecond));
        audioTimelineFrame_ = -preRoll;
        appliedRestart_ = requestedRestart;
    }

    block.timelineFrame = audioTimelineFrame_;
    block.countingIn = block.playing && block.timelineFrame < 0;
    block.metronomeEnabled = metronomeEnabled_.load(std::memory_order_acquire) || block.countingIn;
    block.frame = std::max<int64_t>(0, block.timelineFrame);
    const double musicalBeat = static_cast<double>(block.timelineFrame) / block.framesPerBeat;
    block.bar = static_cast<int64_t>(std::floor(musicalBeat / block.beatsPerBar));
    block.barBeat = musicalBeat - static_cast<double>(block.bar) * block.beatsPerBar;
    block.beat = musicalBeat;

    if (block.playing) {
        audioTimelineFrame_ = block.timelineFrame + static_cast<int64_t>(frames);
    }
    publishTimeline(audioTimelineFrame_);
    return block;
}

void MusicalTransport::publishTimeline(int64_t frame) noexcept {
    timelineSequence_.fetch_add(1, std::memory_order_seq_cst);
    const uint64_t bits = static_cast<uint64_t>(frame);
    timelineLow_.store(static_cast<uint32_t>(bits), std::memory_order_relaxed);
    timelineHigh_.store(static_cast<uint32_t>(bits >> 32), std::memory_order_relaxed);
    timelineSequence_.fetch_add(1, std::memory_order_seq_cst);
}

int64_t MusicalTransport::publishedTimeline() const noexcept {
    for (;;) {
        const uint32_t before = timelineSequence_.load(std::memory_order_acquire);
        if (before & 1u) continue;
        const uint32_t low = timelineLow_.load(std::memory_order_relaxed);
        const uint32_t high = timelineHigh_.load(std::memory_order_relaxed);
        const uint32_t after = timelineSequence_.load(std::memory_order_acquire);
        if (before == after) {
            return static_cast<int64_t>((static_cast<uint64_t>(high) << 32) | low);
        }
    }
}

float MusicalTransport::metronomeSample(const TransportBlock& block, unsigned frameOffset) const noexcept {
    if (!block.playing || !block.metronomeEnabled) return 0.0f;
    const double absoluteFrame = static_cast<double>(block.timelineFrame + static_cast<int64_t>(frameOffset));
    const double beatNumber = std::floor(absoluteFrame / block.framesPerBeat);
    const double beatStart = beatNumber * block.framesPerBeat;
    const double intoBeat = absoluteFrame - beatStart;
    const double clickFrames = std::min(block.framesPerBeat * 0.18, block.framesPerSecond * 0.035);
    if (intoBeat < 0.0 || intoBeat >= clickFrames) return 0.0f;
    const int beatInBar = static_cast<int>(beatNumber) % static_cast<int>(block.beatsPerBar);
    const bool accent = beatInBar == 0;
    const double frequency = accent ? 1760.0 : 1320.0;
    const double envelope = 1.0 - intoBeat / clickFrames;
    return static_cast<float>((accent ? 0.22 : 0.15) * envelope * envelope
        * std::sin(2.0 * kPi * frequency * intoBeat / block.framesPerSecond));
}

bool MusicalTransport::beatPulse() const noexcept {
    if (!playing()) return false;
    const double bpmValue = bpm();
    const int unit = beatUnit_.load(std::memory_order_relaxed);
    const unsigned rate = sampleRate_.load(std::memory_order_relaxed);
    const double framesPerBeat = static_cast<double>(rate) * 60.0 / bpmValue * 4.0 / unit;
    double phase = std::fmod(static_cast<double>(publishedTimeline()), framesPerBeat);
    if (phase < 0.0) phase += framesPerBeat;
    return phase < rate * 0.08;
}

Json MusicalTransport::state() const {
    const double bpmValue = bpm();
    const int beats = beatsPerBar_.load(std::memory_order_acquire);
    const int unit = beatUnit_.load(std::memory_order_acquire);
    const unsigned rate = sampleRate_.load(std::memory_order_acquire);
    const int64_t timeline = publishedTimeline();
    const double framesPerBeat = static_cast<double>(rate) * 60.0 / bpmValue * 4.0 / unit;
    const double musicalBeat = static_cast<double>(timeline) / framesPerBeat;
    const int64_t bar = static_cast<int64_t>(std::floor(musicalBeat / beats));
    const double barBeat = musicalBeat - static_cast<double>(bar * beats);

    Json json = Json::object();
    json.set("type", "transport");
    json.set("bpm", bpmValue);
    json.set("playing", playing());
    json.set("countingIn", playing() && timeline < 0);
    json.set("samplePosition", std::max<int64_t>(0, timeline));
    json.set("timelineSamplePosition", timeline);
    json.set("bar", bar + 1);
    json.set("beat", barBeat + 1.0);
    json.set("beatsPerBar", beats);
    json.set("beatUnit", unit);
    json.set("countInBars", countInBars_.load(std::memory_order_acquire));
    json.set("metronomeEnabled", metronomeEnabled_.load(std::memory_order_acquire));
    json.set("quantizationEnabled", quantizationEnabled());
    json.set("beatPulse", beatPulse());
    json.set("clockSource", "internal");
    return json;
}

} // namespace pimfx
