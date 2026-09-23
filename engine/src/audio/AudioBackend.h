#pragma once

#include "audio/AudioTypes.h"

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace pimfx {

enum class AudioFailureCategory : uint32_t {
    None = 0,
    StartCapture,
    PreparePlaybackAfterXrun,
    PrepareCaptureAfterXrun,
    RelinkAfterXrun,
    RestartCaptureAfterXrun,
};

struct AudioFailure {
    AudioFailureCategory category = AudioFailureCategory::None;
    int errorCode = 0;
};

struct AudioRealtimeStatus {
    int priority = 0;
    int errorCode = 0;
};

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

    /// Consumed by the engine's housekeeping thread. The realtime thread only
    /// publishes fixed-size numeric records and never formats or logs them.
    virtual bool takeFailure(AudioFailure& failure) = 0;

    /// Reports whether the audio thread acquired its requested scheduling
    /// priority. Text formatting and logging belong to the consumer.
    virtual bool takeRealtimeStatus(AudioRealtimeStatus& status) = 0;

    /// Applied the next time the realtime thread starts.
    virtual void configureRealtime(int fifoPriority) {
        (void)fifoPriority;
    }
};

/// Creates the ALSA backend on Linux and the mock backend elsewhere.
std::unique_ptr<AudioBackend> createAudioBackend();

} // namespace pimfx
