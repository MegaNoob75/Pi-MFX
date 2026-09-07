#pragma once

#include "audio/AudioBackend.h"

#include <atomic>
#include <mutex>
#include <thread>

struct _snd_pcm;

namespace pimfx {

/// Talks to the card directly through ALSA, with no server in the path.
///
/// One thread owns both streams: it reads a period from the capture device,
/// runs the processor, and writes a period to the playback device. That is the
/// shortest path the OS offers, and it is why Pi-MFX does not use JACK or
/// PipeWire for the realtime path.
class AlsaBackend final : public AudioBackend {
public:
    AlsaBackend();
    ~AlsaBackend() override;

    std::string name() const override { return "ALSA"; }

    bool start(const AudioSettings& settings,
               AudioProcessor* processor,
               AudioMetrics* metrics,
               std::string& error) override;

    void stop() override;
    bool isRunning() const override { return running_.load(std::memory_order_acquire); }

    AudioSettings actualSettings() const override;

    std::vector<AudioDeviceInfo> enumerateDevices() override;

    void setFailureHandler(std::function<void(const std::string&)> handler) override;
    void configureRealtime(int fifoPriority) override;

private:
    struct Stream {
        _snd_pcm* pcm = nullptr;
        unsigned channels = 0;
        int format = 0;         ///< snd_pcm_format_t, kept opaque in the header
        unsigned sampleBytes = 0;
        bool mmap = false;
        std::vector<uint8_t> buffer;
    };

    bool openStream(Stream& stream,
                    const std::string& device,
                    bool capture,
                    AudioSettings& settings,
                    std::string& error);

    void closeStream(Stream& stream);
    void run();
    void reportFailure(const std::string& message);
    void writeSilence(unsigned frames, unsigned periodCount);
    bool resyncAfterXrun(unsigned frames, unsigned periodCount);

    void deinterleave(const Stream& stream, unsigned frames);
    void interleave(Stream& stream, unsigned frames);

    AudioSettings requested_;
    AudioSettings actual_;
    mutable std::mutex settingsMutex_;

    Stream capture_;
    Stream playback_;
    bool streamsLinked_ = false;
    int fifoPriority_ = 80;

    AudioProcessor* processor_ = nullptr;
    AudioMetrics* metrics_ = nullptr;

    std::vector<std::vector<float>> inputChannels_;
    std::vector<std::vector<float>> outputChannels_;
    std::vector<const float*> inputPointers_;
    std::vector<float*> outputPointers_;

    std::thread thread_;
    std::atomic<bool> running_{false};
    std::atomic<bool> stopRequested_{false};

    std::function<void(const std::string&)> failureHandler_;
    std::mutex failureMutex_;
};

} // namespace pimfx
