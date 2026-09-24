#pragma once

#include "audio/AudioTypes.h"

#include <array>
#include <atomic>
#include <cstddef>
#include <vector>

namespace pimfx {

class MasterOutputSafety {
public:
    enum class TransitionState : uint8_t { Running, FadingOut, Muted, FadingIn };

    void configure(const AudioSettings& settings, unsigned sampleRate) noexcept;
    void prepare(unsigned sampleRate);
    void resetTransition(bool muted) noexcept;
    void beginFadeOut() noexcept;
    void process(float* const* outputs, unsigned outputChannels, unsigned frames,
                 bool allowFadeIn) noexcept;

    TransitionState transitionState() const noexcept {
        return transitionState_.load(std::memory_order_relaxed);
    }
    float transitionGain() const noexcept { return transitionGain_; }
    bool limiterEnabled() const noexcept {
        return limiterEnabled_.load(std::memory_order_relaxed);
    }
    unsigned lookaheadFrames() const noexcept {
        return limiterLookaheadFrames_.load(std::memory_order_relaxed);
    }

private:
    void updateCoefficients(unsigned sampleRate) noexcept;

    static constexpr unsigned kMaxChannels = 64;
    static constexpr float kMaxLookaheadMs = 2.0f;

    std::atomic<bool> dcBlockerEnabled_{true};
    std::atomic<float> dcBlockerHz_{7.0f};
    std::atomic<bool> limiterEnabled_{true};
    std::atomic<float> limiterCeilingDb_{-1.0f};
    std::atomic<float> limiterLookaheadMs_{0.75f};
    std::atomic<float> limiterReleaseMs_{80.0f};
    std::atomic<float> fadeOutMs_{5.0f};
    std::atomic<float> fadeInMs_{8.0f};
    std::atomic<float> dcBlockerPole_{0.9991f};
    std::atomic<float> limiterCeilingGain_{0.8913f};
    std::atomic<float> limiterReleaseStep_{0.00026f};
    std::atomic<unsigned> limiterLookaheadFrames_{36};
    std::atomic<float> fadeOutStep_{1.0f / 240.0f};
    std::atomic<float> fadeInStep_{1.0f / 384.0f};
    std::atomic<TransitionState> transitionState_{TransitionState::Running};

    std::vector<float> limiterDelay_;
    size_t limiterDelayFrames_ = 1;
    size_t limiterWriteFrame_ = 0;
    std::array<float, kMaxChannels> dcPreviousInput_{};
    std::array<float, kMaxChannels> dcPreviousOutput_{};
    float limiterGain_ = 1.0f;
    unsigned limiterHoldFrames_ = 0;
    float transitionGain_ = 1.0f;
};

} // namespace pimfx
