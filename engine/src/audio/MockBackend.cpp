#include "audio/MockBackend.h"

#include "audio/RtPriority.h"
#include "core/Log.h"

#include <algorithm>
#include <chrono>
#include <cmath>

namespace pimfx {

MockBackend::~MockBackend() {
    stop();
}

bool MockBackend::takeFailure(AudioFailure&) { return false; }

bool MockBackend::takeRealtimeStatus(AudioRealtimeStatus&) { return false; }

AudioSettings MockBackend::actualSettings() const {
    std::lock_guard<std::mutex> lock(settingsMutex_);
    return settings_;
}

bool MockBackend::start(const AudioSettings& settings,
                        AudioProcessor* processor,
                        AudioMetrics* metrics,
                        std::string& error) {
    stop();
    (void)error;

    {
        std::lock_guard<std::mutex> lock(settingsMutex_);
        settings_ = settings;
        settings_.useMmap = false;
    }

    runPeriodFrames_ = std::max(1u, settings.periodFrames);
    runPeriodCount_ = settings.periodCount;
    runSampleRate_ = std::max(1u, settings.sampleRate);

    processor_ = processor;
    metrics_ = metrics;

    const unsigned frames = std::max(1u, settings.periodFrames);
    inputChannels_.assign(std::max(1u, settings.inputChannels), std::vector<float>(frames, 0.0f));
    outputChannels_.assign(std::max(1u, settings.outputChannels), std::vector<float>(frames, 0.0f));
    inputPointers_.resize(inputChannels_.size());
    outputPointers_.resize(outputChannels_.size());
    for (size_t i = 0; i < inputChannels_.size(); ++i) {
        inputPointers_[i] = inputChannels_[i].data();
    }
    for (size_t i = 0; i < outputChannels_.size(); ++i) {
        outputPointers_[i] = outputChannels_[i].data();
    }

    if (processor_) {
        processor_->prepareToPlay(settings.sampleRate, frames);
    }
    if (metrics_) {
        metrics_->reset();
    }

    stopRequested_.store(false, std::memory_order_release);
    running_.store(true, std::memory_order_release);
    thread_ = std::thread(&MockBackend::run, this);

    logInfo("audio: offline backend running (" + std::to_string(settings.sampleRate) + " Hz, "
            + std::to_string(frames) + " frames); no hardware in the path");
    return true;
}

void MockBackend::stop() {
    if (!thread_.joinable()) {
        running_.store(false, std::memory_order_release);
        return;
    }
    stopRequested_.store(true, std::memory_order_release);
    thread_.join();
    running_.store(false, std::memory_order_release);

    if (processor_) {
        processor_->releaseResources();
    }
    if (metrics_) {
        metrics_->running.store(false, std::memory_order_relaxed);
    }
}

void MockBackend::run() {
    rt::disableDenormals();

    const unsigned frames = runPeriodFrames_;
    const auto period = std::chrono::duration<double>(
        static_cast<double>(frames) / runSampleRate_);
    auto next = std::chrono::steady_clock::now();

    if (metrics_) {
        metrics_->running.store(true, std::memory_order_relaxed);
        metrics_->roundTripFrames.store(frames * runPeriodCount_, std::memory_order_relaxed);
    }

    float loadAverage = 0.0f;
    while (!stopRequested_.load(std::memory_order_acquire)) {
        next += std::chrono::duration_cast<std::chrono::steady_clock::duration>(period);

        for (auto& channel : inputChannels_) {
            std::fill(channel.begin(), channel.end(), 0.0f);
        }

        const auto start = std::chrono::steady_clock::now();
        if (processor_) {
            processor_->processAudio(inputPointers_.data(),
                                     static_cast<unsigned>(inputChannels_.size()),
                                     outputPointers_.data(),
                                     static_cast<unsigned>(outputChannels_.size()),
                                     frames);
        }
        const auto end = std::chrono::steady_clock::now();

        if (metrics_) {
            const double elapsed = std::chrono::duration<double>(end - start).count();
            const float load = static_cast<float>(elapsed / period.count());
            loadAverage = loadAverage * 0.95f + load * 0.05f;
            metrics_->dspLoad.store(loadAverage, std::memory_order_relaxed);
            metrics_->periods.fetch_add(1, std::memory_order_relaxed);

            float outputPeak = 0.0f;
            for (const auto& channel : outputChannels_) {
                for (float sample : channel) {
                    outputPeak = std::max(outputPeak, std::fabs(sample));
                }
            }
            metrics_->outputPeak.store(outputPeak, std::memory_order_relaxed);
        }

        std::this_thread::sleep_until(next);
    }

    if (metrics_) {
        metrics_->running.store(false, std::memory_order_relaxed);
    }
}

std::vector<AudioDeviceInfo> MockBackend::enumerateDevices() {
    AudioDeviceInfo info;
    info.id = "offline";
    info.name = "Offline (no audio hardware)";
    info.driver = "mock";
    info.duplex = true;
    info.maxInputChannels = 2;
    info.maxOutputChannels = 2;
    info.sampleRates = {44100, 48000, 88200, 96000};
    info.periodSizes = {32, 64, 128, 256, 512};
    info.minPeriods = 2;
    info.maxPeriods = 4;
    return {info};
}

#if !defined(PIMFX_HAVE_ALSA)
std::unique_ptr<AudioBackend> createAudioBackend() {
    return std::make_unique<MockBackend>();
}
#endif

} // namespace pimfx
