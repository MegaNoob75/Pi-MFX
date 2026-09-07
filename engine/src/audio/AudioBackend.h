#pragma once

#include "audio/AudioTypes.h"

#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace pimfx {

/// Called once per period on the realtime thread.
///
/// Rules for anything reached from here: no allocation, no locks, no file or
/// socket I/O, no logging. Communicate with the rest of the engine through
/// SpscQueue and atomics only.
class AudioProcessor {
public:
    virtual ~AudioProcessor() = default;

    /// `inputs` and `outputs` are arrays of `frames` de-interleaved samples,
    /// one pointer per channel. Buffers may alias between calls but not within
    /// one call.
    virtual void processAudio(const float* const* inputs,
                              unsigned inputChannels,
                              float* const* outputs,
                              unsigned outputChannels,
                              unsigned frames) = 0;

    /// Called from the control thread before the stream starts, so the
    /// processor can resize buffers and re-instantiate plugins for the new
    /// rate and block size.
    virtual void prepareToPlay(unsigned sampleRate, unsigned maxFrames) = 0;

    /// Called from the control thread after the stream stops.
    virtual void releaseResources() {}
};

/// A running audio stream. One implementation per platform: ALSA on the Pi,
/// a mock that runs the same callback on a timer everywhere else.
class AudioBackend {
public:
    virtual ~AudioBackend() = default;

    virtual std::string name() const = 0;

    /// Opens the device and starts the realtime thread. On failure `error`
    /// explains what the hardware refused, in terms the UI can show.
    virtual bool start(const AudioSettings& settings,
                       AudioProcessor* processor,
                       AudioMetrics* metrics,
                       std::string& error) = 0;

    virtual void stop() = 0;
    virtual bool isRunning() const = 0;

    /// What the device actually granted. ALSA is allowed to round the period
    /// size or rate, and the user needs to see the real numbers.
    virtual AudioSettings actualSettings() const = 0;

    /// Enumerates devices with their real capabilities.
    virtual std::vector<AudioDeviceInfo> enumerateDevices() = 0;

    /// Reported when the stream dies on its own, for example when a USB
    /// interface is unplugged mid-set. Invoked on a non-realtime thread.
    virtual void setFailureHandler(std::function<void(const std::string&)> handler) = 0;

    /// Applied the next time the realtime thread starts.
    virtual void configureRealtime(int fifoPriority) {
        (void)fifoPriority;
    }
};

/// Creates the ALSA backend on Linux and the mock backend elsewhere.
std::unique_ptr<AudioBackend> createAudioBackend();

} // namespace pimfx
