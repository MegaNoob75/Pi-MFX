#include "drums/DrumSequencer.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace pimfx {
namespace {

uint32_t toPermille(float amount) noexcept {
    if (!std::isfinite(amount)) return 0;
    return static_cast<uint32_t>(std::lround(std::max(0.0f, std::min(1.0f, amount)) * 1000.0f));
}

float fromPermille(uint32_t amount) noexcept {
    return static_cast<float>(amount) / 1000.0f;
}

} // namespace

DrumSequencer::DrumSequencer() {
    for (Pattern& variation : controlProgram_.variations) variation.length = 16;
    controlProgram_.fill.length = 16;
    audioProgram_ = controlProgram_;
}

bool DrumSequencer::validLength(unsigned length) noexcept {
    return length == 16 || length == 32 || length == 64;
}

bool DrumSequencer::setPattern(const Pattern& pattern, std::string& error) {
    if (!validLength(pattern.length)) {
        error = "drum patterns must contain 16, 32, or 64 steps";
        return false;
    }
    Program next = program();
    for (Pattern& variation : next.variations) variation = pattern;
    next.fill = pattern;
    return setProgram(next, error);
}

DrumSequencer::Pattern DrumSequencer::pattern() const {
    std::lock_guard<std::mutex> lock(producerMutex_);
    return controlProgram_.variations[0];
}

bool DrumSequencer::setProgram(const Program& programValue, std::string& error) {
    const unsigned length = programValue.variations[0].length;
    if (!validLength(length)) {
        error = "drum patterns must contain 16, 32, or 64 steps";
        return false;
    }
    for (const Pattern& variation : programValue.variations) {
        if (variation.length != length) {
            error = "all drum variations must use the same pattern length";
            return false;
        }
    }
    if (programValue.fill.length != length) {
        error = "the fill must use the same length as the variations";
        return false;
    }
    if (programValue.songLength > kMaxSongSections) {
        error = "the drum song chain is too long";
        return false;
    }
    for (size_t index = 0; index < programValue.songLength; ++index) {
        if (programValue.song[index].variation >= kVariationCount
            || programValue.song[index].repeats == 0) {
            error = "the drum song chain contains an invalid section";
            return false;
        }
    }

    std::lock_guard<std::mutex> lock(producerMutex_);
    Command command;
    command.program = programValue;
    if (!commands_.push(command)) {
        error = "drum program command queue is full";
        return false;
    }
    controlProgram_ = programValue;
    error.clear();
    return true;
}

DrumSequencer::Program DrumSequencer::program() const {
    std::lock_guard<std::mutex> lock(producerMutex_);
    return controlProgram_;
}

void DrumSequencer::requestVariation(unsigned variation) noexcept {
    requestedVariation_.store(std::min<unsigned>(variation, kVariationCount - 1), std::memory_order_relaxed);
    variationRequest_.fetch_add(1, std::memory_order_release);
}

void DrumSequencer::triggerFill() noexcept {
    fillRequest_.fetch_add(1, std::memory_order_release);
}

void DrumSequencer::setSongMode(bool enabled) noexcept {
    songMode_.store(enabled, std::memory_order_release);
}

bool DrumSequencer::songMode() const noexcept {
    return songMode_.load(std::memory_order_acquire);
}

void DrumSequencer::setSwing(float amount) noexcept {
    swingPermille_.store(toPermille(amount), std::memory_order_release);
}

void DrumSequencer::setHumanization(float amount) noexcept {
    humanizationPermille_.store(toPermille(amount), std::memory_order_release);
}

float DrumSequencer::swing() const noexcept {
    return fromPermille(swingPermille_.load(std::memory_order_acquire));
}

float DrumSequencer::humanization() const noexcept {
    return fromPermille(humanizationPermille_.load(std::memory_order_acquire));
}

uint32_t DrumSequencer::hash(uint64_t value) noexcept {
    value ^= value >> 30;
    value *= UINT64_C(0xbf58476d1ce4e5b9);
    value ^= value >> 27;
    value *= UINT64_C(0x94d049bb133111eb);
    value ^= value >> 31;
    return static_cast<uint32_t>(value ^ (value >> 32));
}

double DrumSequencer::centeredRandom(uint64_t value) noexcept {
    return static_cast<double>(hash(value) & 0xffffu) / 32767.5 - 1.0;
}

void DrumSequencer::insertTrigger(Trigger trigger, Trigger* triggers, size_t& count,
                                  size_t capacity) noexcept {
    if (!triggers || count >= capacity) {
        droppedTriggers_.fetch_add(1, std::memory_order_relaxed);
        return;
    }

    size_t position = count;
    while (position > 0 && triggers[position - 1].frameOffset > trigger.frameOffset) {
        triggers[position] = triggers[position - 1];
        --position;
    }
    triggers[position] = trigger;
    ++count;
}

size_t DrumSequencer::renderBlock(const TransportBlock& transport, unsigned frames,
                                  Trigger* triggers, size_t capacity) noexcept {
    Command command;
    while (commands_.pop(command)) {
        audioProgram_ = command.program;
        activePatternLength_.store(audioProgram_.variations[0].length, std::memory_order_release);
    }

    if (!transport.playing || transport.timelineFrame < 0 || frames == 0
        || !triggers || capacity == 0 || !std::isfinite(transport.framesPerBeat)
        || transport.framesPerBeat <= 0.0) {
        return 0;
    }

    const double framesPerStep = transport.framesPerBeat / 4.0;
    if (!std::isfinite(framesPerStep) || framesPerStep < 1.0) return 0;

    const int64_t blockStart = transport.timelineFrame;
    const int64_t blockEnd = blockStart + static_cast<int64_t>(frames);
    const unsigned patternLength = audioProgram_.variations[0].length;
    const int64_t startStep = static_cast<int64_t>(std::floor(static_cast<double>(blockStart) / framesPerStep));
    const int64_t startCycle = startStep / static_cast<int64_t>(patternLength);
    const uint32_t variationRequest = variationRequest_.load(std::memory_order_acquire);
    if (variationRequest != seenVariationRequest_) {
        pendingVariation_ = requestedVariation_.load(std::memory_order_relaxed);
        variationApplyCycle_ = startStep % static_cast<int64_t>(patternLength) == 0
            ? startCycle : startCycle + 1;
        seenVariationRequest_ = variationRequest;
    }
    const uint32_t fillRequest = fillRequest_.load(std::memory_order_acquire);
    if (fillRequest != seenFillRequest_) {
        fillCycle_ = startStep % static_cast<int64_t>(patternLength) == 0
            ? startCycle : startCycle + 1;
        seenFillRequest_ = fillRequest;
    }
    const double swingAmount = fromPermille(swingPermille_.load(std::memory_order_relaxed));
    const double humanAmount = fromPermille(humanizationPermille_.load(std::memory_order_relaxed));
    const double maximumHumanTiming = framesPerStep * 0.10 * humanAmount;
    const double swingDelay = framesPerStep * 0.45 * swingAmount;

    int64_t firstGlobalStep = static_cast<int64_t>(std::floor(
        static_cast<double>(blockStart) / framesPerStep)) - 2;
    if (firstGlobalStep < 0) firstGlobalStep = 0;
    const int64_t lastGlobalStep = static_cast<int64_t>(std::ceil(
        static_cast<double>(blockEnd) / framesPerStep)) + 2;

    size_t count = 0;
    for (int64_t globalStep = firstGlobalStep; globalStep <= lastGlobalStep; ++globalStep) {
        const int64_t cycle = globalStep / static_cast<int64_t>(patternLength);
        const size_t patternStep = static_cast<size_t>(globalStep)
                                 % static_cast<size_t>(patternLength);
        unsigned variation = audioVariation_;
        unsigned songSection = 0;
        if (songMode_.load(std::memory_order_relaxed) && audioProgram_.songLength > 0) {
            variation = variationForSongCycle(cycle, songSection);
        } else if (cycle >= variationApplyCycle_) {
            variation = pendingVariation_;
        }
        const bool useFill = cycle == fillCycle_;
        const Pattern& patternValue = useFill ? audioProgram_.fill : audioProgram_.variations[variation];
        const double baseFrame = static_cast<double>(globalStep) * framesPerStep
                               + ((globalStep & 1) ? swingDelay : 0.0);

        for (size_t voice = 0; voice < kVoiceCount; ++voice) {
            const Step& step = patternValue.steps[voice][patternStep];
            if (step.velocity == 0) continue;

            const uint64_t identity = static_cast<uint64_t>(globalStep) * UINT64_C(0x9e3779b97f4a7c15)
                                    ^ (static_cast<uint64_t>(voice) + UINT64_C(0x632be59bd9b4e019));
            const double timing = centeredRandom(identity) * maximumHumanTiming;
            const int64_t eventFrame = static_cast<int64_t>(std::llround(baseFrame + timing));
            if (eventFrame < blockStart || eventFrame >= blockEnd) continue;

            const double velocityVariation = centeredRandom(identity ^ UINT64_C(0xa0761d6478bd642f))
                                           * 0.12 * humanAmount;
            const float velocity = static_cast<float>(std::max(0.0, std::min(1.0,
                static_cast<double>(step.velocity) / 127.0 * (1.0 + velocityVariation))));
            Trigger trigger;
            trigger.frameOffset = static_cast<unsigned>(eventFrame - blockStart);
            trigger.voice = static_cast<uint8_t>(voice);
            trigger.velocity = velocity;
            trigger.accent = step.accent != 0;
            insertTrigger(trigger, triggers, count, capacity);
        }
    }
    const int64_t endStep = static_cast<int64_t>(std::floor(
        static_cast<double>(std::max<int64_t>(blockStart, blockEnd - 1)) / framesPerStep));
    const int64_t endCycle = endStep / static_cast<int64_t>(patternLength);
    if (!songMode_.load(std::memory_order_relaxed) && endCycle >= variationApplyCycle_) {
        audioVariation_ = pendingVariation_;
    }
    unsigned songSection = 0;
    const unsigned publishedVariation = songMode_.load(std::memory_order_relaxed) && audioProgram_.songLength > 0
        ? variationForSongCycle(endCycle, songSection) : audioVariation_;
    activeVariation_.store(publishedVariation, std::memory_order_release);
    activeSongSection_.store(songSection, std::memory_order_release);
    fillActive_.store(endCycle == fillCycle_, std::memory_order_release);
    if (endCycle > fillCycle_) fillCycle_ = -1;
    return count;
}

unsigned DrumSequencer::variationForSongCycle(int64_t cycle, unsigned& section) const noexcept {
    unsigned total = 0;
    for (size_t index = 0; index < audioProgram_.songLength; ++index) total += audioProgram_.song[index].repeats;
    if (total == 0) { section = 0; return 0; }
    unsigned position = static_cast<unsigned>(cycle >= 0 ? cycle : 0) % total;
    for (size_t index = 0; index < audioProgram_.songLength; ++index) {
        if (position < audioProgram_.song[index].repeats) {
            section = static_cast<unsigned>(index);
            return audioProgram_.song[index].variation;
        }
        position -= audioProgram_.song[index].repeats;
    }
    section = 0;
    return 0;
}

unsigned DrumSequencer::activePatternLength() const noexcept {
    return activePatternLength_.load(std::memory_order_acquire);
}

unsigned DrumSequencer::activeVariation() const noexcept {
    return activeVariation_.load(std::memory_order_acquire);
}

bool DrumSequencer::fillActive() const noexcept {
    return fillActive_.load(std::memory_order_acquire);
}

unsigned DrumSequencer::activeSongSection() const noexcept {
    return activeSongSection_.load(std::memory_order_acquire);
}

uint32_t DrumSequencer::droppedTriggers() const noexcept {
    return droppedTriggers_.load(std::memory_order_acquire);
}

void DrumSequencer::clearDroppedTriggers() noexcept {
    droppedTriggers_.store(0, std::memory_order_release);
}

} // namespace pimfx
