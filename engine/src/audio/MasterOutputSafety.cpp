#include "audio/MasterOutputSafety.h"

#include <algorithm>
#include <cmath>

namespace pimfx {
namespace {

float dbToGain(float db) noexcept {
    return std::pow(10.0f, db / 20.0f);
}

} // namespace

void MasterOutputSafety::configure(const AudioSettings& settings, unsigned sampleRate) noexcept {
    dcBlockerEnabled_.store(settings.dcBlockerEnabled, std::memory_order_relaxed);
    dcBlockerHz_.store(settings.dcBlockerHz, std::memory_order_relaxed);
    limiterEnabled_.store(settings.limiterEnabled, std::memory_order_relaxed);
    limiterCeilingDb_.store(settings.limiterCeilingDb, std::memory_order_relaxed);
    limiterLookaheadMs_.store(settings.limiterLookaheadMs, std::memory_order_relaxed);
    limiterReleaseMs_.store(settings.limiterReleaseMs, std::memory_order_relaxed);
    fadeOutMs_.store(settings.patchFadeOutMs, std::memory_order_relaxed);
    fadeInMs_.store(settings.patchFadeInMs, std::memory_order_relaxed);
    updateCoefficients(sampleRate);
}

void MasterOutputSafety::prepare(unsigned sampleRate) {
    updateCoefficients(sampleRate);
    limiterDelayFrames_ = std::max<size_t>(2, static_cast<size_t>(
        std::ceil(static_cast<double>(sampleRate) * kMaxLookaheadMs / 1000.0)) + 1);
    limiterDelay_.assign(limiterDelayFrames_ * kMaxChannels, 0.0f);
    limiterWriteFrame_ = 0;
    dcPreviousInput_.fill(0.0f);
    dcPreviousOutput_.fill(0.0f);
    limiterGain_ = 1.0f;
    limiterHoldFrames_ = 0;
}

void MasterOutputSafety::updateCoefficients(unsigned sampleRate) noexcept {
    const float rate = static_cast<float>(std::max(1u, sampleRate));
    dcBlockerPole_.store(std::exp(-6.28318530718f
        * dcBlockerHz_.load(std::memory_order_relaxed) / rate), std::memory_order_relaxed);
    limiterCeilingGain_.store(dbToGain(limiterCeilingDb_.load(std::memory_order_relaxed)),
                              std::memory_order_relaxed);
    const float releaseSeconds = limiterReleaseMs_.load(std::memory_order_relaxed) * 0.001f;
    limiterReleaseStep_.store(1.0f - std::exp(-1.0f /
        std::max(1.0f, releaseSeconds * rate)), std::memory_order_relaxed);
    limiterLookaheadFrames_.store(static_cast<unsigned>(std::lround(
        limiterLookaheadMs_.load(std::memory_order_relaxed) * rate / 1000.0f)),
        std::memory_order_relaxed);
    fadeOutStep_.store(1.0f / std::max(1.0f,
        fadeOutMs_.load(std::memory_order_relaxed) * rate / 1000.0f),
        std::memory_order_relaxed);
    fadeInStep_.store(1.0f / std::max(1.0f,
        fadeInMs_.load(std::memory_order_relaxed) * rate / 1000.0f),
        std::memory_order_relaxed);
}

void MasterOutputSafety::resetTransition(bool muted) noexcept {
    transitionGain_ = muted ? 0.0f : 1.0f;
    transitionState_.store(muted ? TransitionState::Muted : TransitionState::Running,
                           std::memory_order_relaxed);
}

void MasterOutputSafety::beginFadeOut() noexcept {
    const TransitionState state = transitionState_.load(std::memory_order_relaxed);
    if (state == TransitionState::Running || state == TransitionState::FadingIn) {
        transitionState_.store(TransitionState::FadingOut, std::memory_order_relaxed);
    }
}

void MasterOutputSafety::process(float* const* outputs, unsigned outputChannels,
                                 unsigned frames, bool allowFadeIn) noexcept {
    const unsigned channels = std::min(outputChannels, kMaxChannels);
    const bool dcEnabled = dcBlockerEnabled_.load(std::memory_order_relaxed);
    const float dcPole = dcBlockerPole_.load(std::memory_order_relaxed);
    const bool limiterEnabled = limiterEnabled_.load(std::memory_order_relaxed);
    const float ceiling = limiterCeilingGain_.load(std::memory_order_relaxed);
    const float releaseStep = limiterReleaseStep_.load(std::memory_order_relaxed);
    const size_t requestedLookahead = limiterLookaheadFrames_.load(std::memory_order_relaxed);
    const size_t lookahead = limiterDelay_.empty() ? 0
        : std::min(requestedLookahead, limiterDelayFrames_ - 1);
    TransitionState transition = transitionState_.load(std::memory_order_relaxed);
    if (transition == TransitionState::Muted && allowFadeIn) {
        transition = TransitionState::FadingIn;
    }
    const float fadeOutStep = fadeOutStep_.load(std::memory_order_relaxed);
    const float fadeInStep = fadeInStep_.load(std::memory_order_relaxed);

    for (unsigned frame = 0; frame < frames; ++frame) {
        float linkedPeak = 0.0f;
        for (unsigned channel = 0; channel < channels; ++channel) {
            float sample = outputs[channel][frame];
            if (!std::isfinite(sample)) sample = 0.0f;
            const float blocked = sample - dcPreviousInput_[channel]
                                + dcPole * dcPreviousOutput_[channel];
            dcPreviousInput_[channel] = sample;
            dcPreviousOutput_[channel] = std::isfinite(blocked) ? blocked : 0.0f;
            const float safeSample = dcEnabled ? dcPreviousOutput_[channel] : sample;
            outputs[channel][frame] = safeSample;
            linkedPeak = std::max(linkedPeak, std::fabs(safeSample));
            if (!limiterDelay_.empty()) {
                limiterDelay_[limiterWriteFrame_ * kMaxChannels + channel] = safeSample;
            }
        }

        if (limiterEnabled) {
            const float requiredGain = linkedPeak > ceiling && linkedPeak > 0.0f
                ? ceiling / linkedPeak : 1.0f;
            if (requiredGain < limiterGain_) limiterGain_ = requiredGain;
            if (requiredGain < 0.999999f) limiterHoldFrames_ = static_cast<unsigned>(lookahead);
            else if (limiterHoldFrames_ > 0) --limiterHoldFrames_;
            else limiterGain_ += (1.0f - limiterGain_) * releaseStep;
        } else {
            limiterGain_ = 1.0f;
            limiterHoldFrames_ = 0;
        }

        if (transition == TransitionState::FadingOut) {
            transitionGain_ = std::max(0.0f, transitionGain_ - fadeOutStep);
            if (transitionGain_ <= 0.0f) {
                transitionGain_ = 0.0f;
                transition = TransitionState::Muted;
            }
        } else if (transition == TransitionState::FadingIn) {
            transitionGain_ = std::min(1.0f, transitionGain_ + fadeInStep);
            if (transitionGain_ >= 1.0f) {
                transitionGain_ = 1.0f;
                transition = TransitionState::Running;
            }
        } else if (transition == TransitionState::Muted) transitionGain_ = 0.0f;
        else transitionGain_ = 1.0f;

        const size_t readFrame = limiterDelay_.empty() ? 0
            : (limiterWriteFrame_ + limiterDelayFrames_ - lookahead) % limiterDelayFrames_;
        for (unsigned channel = 0; channel < channels; ++channel) {
            float sample = outputs[channel][frame];
            if (limiterEnabled && !limiterDelay_.empty()) {
                sample = limiterDelay_[readFrame * kMaxChannels + channel] * limiterGain_;
                sample = std::max(-ceiling, std::min(ceiling, sample));
            }
            outputs[channel][frame] = sample * transitionGain_;
        }
        for (unsigned channel = channels; channel < outputChannels; ++channel) {
            const float sample = outputs[channel][frame];
            outputs[channel][frame] = std::isfinite(sample) ? sample * transitionGain_ : 0.0f;
        }
        if (!limiterDelay_.empty()) {
            limiterWriteFrame_ = (limiterWriteFrame_ + 1) % limiterDelayFrames_;
        }
    }
    transitionState_.store(transition, std::memory_order_relaxed);
}

} // namespace pimfx
