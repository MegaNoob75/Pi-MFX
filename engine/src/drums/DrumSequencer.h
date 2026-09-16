#pragma once

#include "core/SpscQueue.h"
#include "transport/MusicalTransport.h"

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <mutex>
#include <string>
#include <type_traits>

namespace pimfx {

/// Realtime-safe step scheduler for the drum machine. Pattern edits are copied
/// into a bounded command queue on the control thread. renderBlock() consumes
/// only fixed-size POD data and never allocates, locks, logs, or performs I/O.
class DrumSequencer {
public:
    static constexpr size_t kVoiceCount = 8;
    static constexpr size_t kMaxSteps = 64;
    static constexpr size_t kVariationCount = 4;
    static constexpr size_t kMaxSongSections = 32;

    struct Step {
        uint8_t velocity = 0; // 0 is off; 1..127 is a triggered hit
        uint8_t accent = 0;
    };

    struct Pattern {
        uint8_t length = 16;
        std::array<std::array<Step, kMaxSteps>, kVoiceCount> steps{};
    };

    struct SongSection {
        uint8_t variation = 0;
        uint8_t repeats = 1;
    };

    struct Program {
        std::array<Pattern, kVariationCount> variations{};
        Pattern fill{};
        std::array<SongSection, kMaxSongSections> song{};
        uint8_t songLength = 0;
    };

    struct Trigger {
        unsigned frameOffset = 0;
        uint8_t voice = 0;
        float velocity = 0.0f;
        bool accent = false;
    };

    DrumSequencer();

    bool setPattern(const Pattern& pattern, std::string& error);
    Pattern pattern() const;
    bool setProgram(const Program& program, std::string& error);
    Program program() const;
    void requestVariation(unsigned variation) noexcept;
    void triggerFill() noexcept;
    void setSongMode(bool enabled) noexcept;
    bool songMode() const noexcept;

    void setSwing(float amount) noexcept;
    void setHumanization(float amount) noexcept;
    float swing() const noexcept;
    float humanization() const noexcept;

    /// Generates triggers for [timelineFrame, timelineFrame + frames). The
    /// caller supplies fixed storage so the audio callback never allocates.
    size_t renderBlock(const TransportBlock& transport, unsigned frames,
                       Trigger* triggers, size_t capacity) noexcept;

    unsigned activePatternLength() const noexcept;
    unsigned activeVariation() const noexcept;
    bool fillActive() const noexcept;
    unsigned activeSongSection() const noexcept;
    uint32_t droppedTriggers() const noexcept;
    void clearDroppedTriggers() noexcept;

private:
    struct Command {
        Program program;
    };

    static bool validLength(unsigned length) noexcept;
    static uint32_t hash(uint64_t value) noexcept;
    static double centeredRandom(uint64_t value) noexcept;
    unsigned variationForSongCycle(int64_t cycle, unsigned& section) const noexcept;
    void insertTrigger(Trigger trigger, Trigger* triggers, size_t& count,
                       size_t capacity) noexcept;

    SpscQueue<Command> commands_{4};
    mutable std::mutex producerMutex_;
    Program controlProgram_{};

    // Audio-thread-owned copy. Only renderBlock() reads or writes it.
    Program audioProgram_{};
    uint32_t seenVariationRequest_ = 0;
    uint32_t seenFillRequest_ = 0;
    unsigned audioVariation_ = 0;
    unsigned pendingVariation_ = 0;
    int64_t variationApplyCycle_ = 0;
    int64_t fillCycle_ = -1;

    std::atomic<uint32_t> swingPermille_{0};
    std::atomic<uint32_t> humanizationPermille_{0};
    std::atomic<uint32_t> requestedVariation_{0};
    std::atomic<uint32_t> variationRequest_{0};
    std::atomic<uint32_t> fillRequest_{0};
    std::atomic<bool> songMode_{false};
    std::atomic<uint32_t> activePatternLength_{16};
    std::atomic<uint32_t> activeVariation_{0};
    std::atomic<bool> fillActive_{false};
    std::atomic<uint32_t> activeSongSection_{0};
    std::atomic<uint32_t> droppedTriggers_{0};
};

static_assert(std::atomic<uint32_t>::is_always_lock_free,
              "DrumSequencer requires lock-free 32-bit atomics");
static_assert(std::is_trivially_copyable<DrumSequencer::Pattern>::value,
              "Drum patterns must remain safe for the realtime command queue");
static_assert(std::is_trivially_copyable<DrumSequencer::Program>::value,
              "Drum programs must remain safe for the realtime command queue");

} // namespace pimfx
