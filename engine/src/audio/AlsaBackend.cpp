#include "audio/AlsaBackend.h"

#include "audio/RtPriority.h"
#include "core/Log.h"

#include <alsa/asoundlib.h>

#include <algorithm>
#include <cctype>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace pimfx {
namespace {

/// Priority for the thread that feeds the card. Plugin workers run below this
/// so a slow convolution can never delay the next period.
constexpr int kAudioThreadPriority = 80;

/// Formats we try, best first. Float avoids conversion entirely; S32 keeps full
/// resolution on every interface worth using; S16 is the last resort.
const snd_pcm_format_t kFormats[] = {
    SND_PCM_FORMAT_FLOAT_LE,
    SND_PCM_FORMAT_S32_LE,
    SND_PCM_FORMAT_S24_LE,
    SND_PCM_FORMAT_S16_LE,
};

unsigned bytesPerSample(snd_pcm_format_t format) {
    const int bits = snd_pcm_format_physical_width(format);
    return bits > 0 ? static_cast<unsigned>(bits) / 8u : 0u;
}

float sampleToFloat(const uint8_t* data, snd_pcm_format_t format) {
    switch (format) {
        case SND_PCM_FORMAT_FLOAT_LE: {
            float value;
            std::memcpy(&value, data, sizeof(value));
            return value;
        }
        case SND_PCM_FORMAT_S32_LE:
        case SND_PCM_FORMAT_S24_LE: {
            int32_t value;
            std::memcpy(&value, data, sizeof(value));
            return static_cast<float>(value) * (1.0f / 2147483648.0f);
        }
        case SND_PCM_FORMAT_S16_LE: {
            int16_t value;
            std::memcpy(&value, data, sizeof(value));
            return static_cast<float>(value) * (1.0f / 32768.0f);
        }
        default:
            return 0.0f;
    }
}

void floatToSample(float value, uint8_t* data, snd_pcm_format_t format) {
    // Hard clip rather than wrap. A wrapped sample is a full-scale click
    // straight into an amplifier.
    value = std::max(-1.0f, std::min(1.0f, value));
    switch (format) {
        case SND_PCM_FORMAT_FLOAT_LE:
            std::memcpy(data, &value, sizeof(value));
            return;
        case SND_PCM_FORMAT_S32_LE:
        case SND_PCM_FORMAT_S24_LE: {
            const int32_t sample = static_cast<int32_t>(value * 2147483520.0f);
            std::memcpy(data, &sample, sizeof(sample));
            return;
        }
        case SND_PCM_FORMAT_S16_LE: {
            const int16_t sample = static_cast<int16_t>(value * 32767.0f);
            std::memcpy(data, &sample, sizeof(sample));
            return;
        }
        default:
            return;
    }
}

bool looksLikeHat(const std::string& driver, const std::string& name) {
    static const char* markers[] = {"i2s", "hifiberry", "audioinjector", "iqaudio",
                                    "wm8960", "pcm512", "pcm5102", "sndrpi", "googlevoicehat"};
    std::string haystack = driver + " " + name;
    std::transform(haystack.begin(), haystack.end(), haystack.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    for (const char* marker : markers) {
        if (haystack.find(marker) != std::string::npos) {
            return true;
        }
    }
    return false;
}

} // namespace

AlsaBackend::AlsaBackend() = default;

AlsaBackend::~AlsaBackend() {
    stop();
}

void AlsaBackend::setFailureHandler(std::function<void(const std::string&)> handler) {
    std::lock_guard<std::mutex> lock(failureMutex_);
    failureHandler_ = std::move(handler);
}

void AlsaBackend::reportFailure(const std::string& message) {
    std::function<void(const std::string&)> handler;
    {
        std::lock_guard<std::mutex> lock(failureMutex_);
        handler = failureHandler_;
    }
    logError("audio: " + message);
    if (handler) {
        handler(message);
    }
}

AudioSettings AlsaBackend::actualSettings() const {
    std::lock_guard<std::mutex> lock(settingsMutex_);
    return actual_;
}

bool AlsaBackend::openStream(Stream& stream,
                             const std::string& device,
                             bool capture,
                             AudioSettings& settings,
                             std::string& error) {
    const snd_pcm_stream_t direction = capture ? SND_PCM_STREAM_CAPTURE : SND_PCM_STREAM_PLAYBACK;
    const char* label = capture ? "capture" : "playback";

    int result = snd_pcm_open(&stream.pcm, device.c_str(), direction, 0);
    if (result < 0) {
        error = std::string("cannot open ") + label + " device '" + device + "': " + snd_strerror(result);
        stream.pcm = nullptr;
        return false;
    }

    snd_pcm_hw_params_t* hw = nullptr;
    snd_pcm_hw_params_alloca(&hw);
    snd_pcm_hw_params_any(stream.pcm, hw);

    // mmap access skips a copy through the kernel on every period. Some
    // drivers, especially older USB gadgets, only offer the read/write path,
    // so falling back is normal rather than an error.
    bool usingMmap = false;
    if (settings.useMmap
        && snd_pcm_hw_params_set_access(stream.pcm, hw, SND_PCM_ACCESS_MMAP_INTERLEAVED) >= 0) {
        usingMmap = true;
    } else {
        result = snd_pcm_hw_params_set_access(stream.pcm, hw, SND_PCM_ACCESS_RW_INTERLEAVED);
        if (result < 0) {
            error = std::string(label) + ": no usable access mode: " + snd_strerror(result);
            return false;
        }
        if (settings.useMmap) {
            logInfo(std::string("audio: ") + label + " device does not support mmap; using read/write");
        }
    }
    settings.useMmap = settings.useMmap && usingMmap;

    snd_pcm_format_t chosenFormat = SND_PCM_FORMAT_UNKNOWN;
    for (snd_pcm_format_t format : kFormats) {
        if (snd_pcm_hw_params_set_format(stream.pcm, hw, format) >= 0) {
            chosenFormat = format;
            break;
        }
    }
    if (chosenFormat == SND_PCM_FORMAT_UNKNOWN) {
        error = std::string(label) + ": device offers no format Pi-MFX can use";
        return false;
    }

    unsigned wanted = capture ? settings.inputChannels : settings.outputChannels;
    unsigned minChannels = 0;
    unsigned maxChannels = 0;
    snd_pcm_hw_params_get_channels_min(hw, &minChannels);
    snd_pcm_hw_params_get_channels_max(hw, &maxChannels);
    unsigned channels = std::max(minChannels, std::min(wanted, maxChannels));
    result = snd_pcm_hw_params_set_channels_near(stream.pcm, hw, &channels);
    if (result < 0) {
        error = std::string(label) + ": cannot set channel count: " + snd_strerror(result);
        return false;
    }

    // Refuse resampling outright. A hidden rate converter in the path is both
    // latency and quality loss the user never asked for.
    snd_pcm_hw_params_set_rate_resample(stream.pcm, hw, 0);

    unsigned rate = settings.sampleRate;
    result = snd_pcm_hw_params_set_rate_near(stream.pcm, hw, &rate, nullptr);
    if (result < 0) {
        error = std::string(label) + ": cannot set " + std::to_string(settings.sampleRate)
              + " Hz: " + snd_strerror(result);
        return false;
    }

    snd_pcm_uframes_t period = settings.periodFrames;
    result = snd_pcm_hw_params_set_period_size_near(stream.pcm, hw, &period, nullptr);
    if (result < 0) {
        error = std::string(label) + ": cannot set a period of " + std::to_string(settings.periodFrames)
              + " frames: " + snd_strerror(result);
        return false;
    }

    unsigned periods = settings.periodCount;
    result = snd_pcm_hw_params_set_periods_near(stream.pcm, hw, &periods, nullptr);
    if (result < 0) {
        error = std::string(label) + ": cannot set " + std::to_string(settings.periodCount)
              + " periods: " + snd_strerror(result);
        return false;
    }

    result = snd_pcm_hw_params(stream.pcm, hw);
    if (result < 0) {
        error = std::string(label) + ": the device rejected this combination: " + snd_strerror(result);
        return false;
    }

    snd_pcm_sw_params_t* sw = nullptr;
    snd_pcm_sw_params_alloca(&sw);
    snd_pcm_sw_params_current(stream.pcm, sw);
    snd_pcm_sw_params_set_avail_min(stream.pcm, sw, period);
    // Starting playback after a single period rather than a full buffer keeps
    // the output as close behind the input as the hardware allows.
    const snd_pcm_uframes_t startThreshold =
        (capture || settings.startImmediately) ? 1 : period * (periods - 1);
    snd_pcm_sw_params_set_start_threshold(stream.pcm, sw, startThreshold);
    snd_pcm_sw_params_set_stop_threshold(stream.pcm, sw, period * periods);
    result = snd_pcm_sw_params(stream.pcm, sw);
    if (result < 0) {
        error = std::string(label) + ": cannot apply software parameters: " + snd_strerror(result);
        return false;
    }

    stream.channels = channels;
    stream.format = static_cast<int>(chosenFormat);
    stream.sampleBytes = bytesPerSample(chosenFormat);
    stream.buffer.assign(static_cast<size_t>(period) * channels * stream.sampleBytes, 0);

    settings.sampleRate = rate;
    settings.periodFrames = static_cast<unsigned>(period);
    settings.periodCount = periods;
    if (capture) {
        settings.inputChannels = channels;
    } else {
        settings.outputChannels = channels;
    }

    logInfo(std::string("audio: ") + label + " " + device + " "
            + std::to_string(rate) + " Hz, " + std::to_string(period) + " frames x "
            + std::to_string(periods) + ", " + std::to_string(channels) + " ch, "
            + snd_pcm_format_name(chosenFormat) + (settings.useMmap ? ", mmap" : ", rw"));
    return true;
}

void AlsaBackend::closeStream(Stream& stream) {
    if (stream.pcm) {
        snd_pcm_drop(stream.pcm);
        snd_pcm_close(stream.pcm);
        stream.pcm = nullptr;
    }
    stream.buffer.clear();
}

bool AlsaBackend::start(const AudioSettings& settings,
                        AudioProcessor* processor,
                        AudioMetrics* metrics,
                        std::string& error) {
    stop();

    requested_ = settings;
    processor_ = processor;
    metrics_ = metrics;

    AudioSettings resolved = settings;
    if (resolved.device.empty()) {
        const std::vector<AudioDeviceInfo> devices = enumerateDevices();
        for (const AudioDeviceInfo& device : devices) {
            if (device.duplex) {
                resolved.device = device.id;
                break;
            }
        }
        if (resolved.device.empty()) {
            error = "no full-duplex audio device found; connect a USB interface or enable an audio HAT";
            return false;
        }
        logInfo("audio: no device configured, using " + resolved.device);
    }

    const std::string captureDevice =
        resolved.captureDevice.empty() ? resolved.device : resolved.captureDevice;

    if (!openStream(capture_, captureDevice, true, resolved, error)) {
        closeStream(capture_);
        return false;
    }
    if (!openStream(playback_, resolved.device, false, resolved, error)) {
        closeStream(capture_);
        closeStream(playback_);
        return false;
    }

    // Linking lets the driver start both directions on the same sample when
    // they share a card, which removes the drift between them entirely.
    if (resolved.captureDevice.empty()) {
        if (snd_pcm_link(capture_.pcm, playback_.pcm) < 0) {
            logDebug("audio: streams could not be linked; running them independently");
        }
    }

    const unsigned frames = resolved.periodFrames;
    inputChannels_.assign(capture_.channels, std::vector<float>(frames, 0.0f));
    outputChannels_.assign(playback_.channels, std::vector<float>(frames, 0.0f));
    inputPointers_.resize(capture_.channels);
    outputPointers_.resize(playback_.channels);
    for (size_t i = 0; i < inputChannels_.size(); ++i) {
        inputPointers_[i] = inputChannels_[i].data();
    }
    for (size_t i = 0; i < outputChannels_.size(); ++i) {
        outputPointers_[i] = outputChannels_[i].data();
    }

    if (processor_) {
        processor_->prepareToPlay(resolved.sampleRate, frames);
    }

    {
        std::lock_guard<std::mutex> lock(settingsMutex_);
        actual_ = resolved;
    }

    if (metrics_) {
        metrics_->reset();
    }

    stopRequested_.store(false, std::memory_order_release);
    running_.store(true, std::memory_order_release);
    thread_ = std::thread(&AlsaBackend::run, this);
    return true;
}

void AlsaBackend::stop() {
    if (!running_.load(std::memory_order_acquire) && !thread_.joinable()) {
        return;
    }
    stopRequested_.store(true, std::memory_order_release);
    if (thread_.joinable()) {
        thread_.join();
    }
    running_.store(false, std::memory_order_release);

    if (capture_.pcm && playback_.pcm) {
        snd_pcm_unlink(capture_.pcm);
    }
    closeStream(capture_);
    closeStream(playback_);

    if (processor_) {
        processor_->releaseResources();
    }
    if (metrics_) {
        metrics_->running.store(false, std::memory_order_relaxed);
    }
}

void AlsaBackend::deinterleave(const Stream& stream, unsigned frames) {
    const snd_pcm_format_t format = static_cast<snd_pcm_format_t>(stream.format);
    const unsigned channels = stream.channels;
    const unsigned stride = stream.sampleBytes;
    const uint8_t* data = stream.buffer.data();

    if (format == SND_PCM_FORMAT_FLOAT_LE) {
        const float* samples = reinterpret_cast<const float*>(data);
        for (unsigned channel = 0; channel < channels; ++channel) {
            float* destination = inputChannels_[channel].data();
            for (unsigned frame = 0; frame < frames; ++frame) {
                destination[frame] = samples[frame * channels + channel];
            }
        }
        return;
    }

    for (unsigned channel = 0; channel < channels; ++channel) {
        float* destination = inputChannels_[channel].data();
        for (unsigned frame = 0; frame < frames; ++frame) {
            destination[frame] = sampleToFloat(data + (frame * channels + channel) * stride, format);
        }
    }
}

void AlsaBackend::interleave(Stream& stream, unsigned frames) {
    const snd_pcm_format_t format = static_cast<snd_pcm_format_t>(stream.format);
    const unsigned channels = stream.channels;
    const unsigned stride = stream.sampleBytes;
    uint8_t* data = stream.buffer.data();

    if (format == SND_PCM_FORMAT_FLOAT_LE) {
        float* samples = reinterpret_cast<float*>(data);
        for (unsigned channel = 0; channel < channels; ++channel) {
            const float* source = outputChannels_[channel].data();
            for (unsigned frame = 0; frame < frames; ++frame) {
                samples[frame * channels + channel] = std::max(-1.0f, std::min(1.0f, source[frame]));
            }
        }
        return;
    }

    for (unsigned channel = 0; channel < channels; ++channel) {
        const float* source = outputChannels_[channel].data();
        for (unsigned frame = 0; frame < frames; ++frame) {
            floatToSample(source[frame], data + (frame * channels + channel) * stride, format);
        }
    }
}

void AlsaBackend::run() {
    rt::disableDenormals();

    std::string message;
    if (rt::setThreadRealtime(kAudioThreadPriority, message)) {
        logInfo("audio thread: " + message);
    } else {
        logWarn("audio thread: " + message + " (expect dropouts under load)");
    }

    AudioSettings settings;
    {
        std::lock_guard<std::mutex> lock(settingsMutex_);
        settings = actual_;
    }

    const unsigned frames = settings.periodFrames;
    const bool useMmap = settings.useMmap;
    const double periodSeconds = static_cast<double>(frames) / settings.sampleRate;

    // Pre-roll silence so the first real period does not land in an empty
    // buffer and start life with an underrun.
    std::fill(playback_.buffer.begin(), playback_.buffer.end(), 0);
    for (unsigned i = 0; i + 1 < settings.periodCount; ++i) {
        if (useMmap) {
            snd_pcm_mmap_writei(playback_.pcm, playback_.buffer.data(), frames);
        } else {
            snd_pcm_writei(playback_.pcm, playback_.buffer.data(), frames);
        }
    }

    int result = snd_pcm_start(capture_.pcm);
    if (result < 0 && result != -EBADFD) {
        reportFailure(std::string("cannot start capture: ") + snd_strerror(result));
        running_.store(false, std::memory_order_release);
        return;
    }

    if (metrics_) {
        metrics_->running.store(true, std::memory_order_relaxed);
    }

    float loadAverage = 0.0f;
    uint64_t periodIndex = 0;

    while (!stopRequested_.load(std::memory_order_acquire)) {
        snd_pcm_sframes_t got = useMmap
            ? snd_pcm_mmap_readi(capture_.pcm, capture_.buffer.data(), frames)
            : snd_pcm_readi(capture_.pcm, capture_.buffer.data(), frames);

        if (got < 0) {
            if (metrics_) {
                metrics_->xruns.fetch_add(1, std::memory_order_relaxed);
            }
            // snd_pcm_recover handles both underrun and a suspended device
            // (which happens when the Pi resumes from a power event).
            const int recovered = snd_pcm_recover(capture_.pcm, static_cast<int>(got), 1);
            if (recovered < 0) {
                reportFailure(std::string("capture failed: ") + snd_strerror(recovered));
                break;
            }
            snd_pcm_prepare(playback_.pcm);
            snd_pcm_start(capture_.pcm);
            continue;
        }

        const unsigned actualFrames = static_cast<unsigned>(got);
        const auto processStart = std::chrono::steady_clock::now();

        deinterleave(capture_, actualFrames);

        if (processor_) {
            processor_->processAudio(inputPointers_.data(),
                                     capture_.channels,
                                     outputPointers_.data(),
                                     playback_.channels,
                                     actualFrames);
        } else {
            for (auto& channel : outputChannels_) {
                std::fill(channel.begin(), channel.begin() + actualFrames, 0.0f);
            }
        }

        interleave(playback_, actualFrames);

        const auto processEnd = std::chrono::steady_clock::now();

        snd_pcm_sframes_t written = useMmap
            ? snd_pcm_mmap_writei(playback_.pcm, playback_.buffer.data(), actualFrames)
            : snd_pcm_writei(playback_.pcm, playback_.buffer.data(), actualFrames);

        if (written < 0) {
            if (metrics_) {
                metrics_->xruns.fetch_add(1, std::memory_order_relaxed);
            }
            const int recovered = snd_pcm_recover(playback_.pcm, static_cast<int>(written), 1);
            if (recovered < 0) {
                reportFailure(std::string("playback failed: ") + snd_strerror(recovered));
                break;
            }
            continue;
        }

        if (metrics_) {
            const double elapsed =
                std::chrono::duration<double>(processEnd - processStart).count();
            const float load = static_cast<float>(elapsed / periodSeconds);
            // A one-pole average is readable on screen; the peak below is what
            // actually tells you whether you are about to drop out.
            loadAverage = loadAverage * 0.95f + load * 0.05f;
            metrics_->dspLoad.store(loadAverage, std::memory_order_relaxed);
            if (load > metrics_->dspLoadPeak.load(std::memory_order_relaxed)) {
                metrics_->dspLoadPeak.store(load, std::memory_order_relaxed);
            }
            metrics_->periods.fetch_add(1, std::memory_order_relaxed);

            float inputPeak = 0.0f;
            for (const auto& channel : inputChannels_) {
                for (unsigned frame = 0; frame < actualFrames; ++frame) {
                    inputPeak = std::max(inputPeak, std::fabs(channel[frame]));
                }
            }
            float outputPeak = 0.0f;
            for (const auto& channel : outputChannels_) {
                for (unsigned frame = 0; frame < actualFrames; ++frame) {
                    outputPeak = std::max(outputPeak, std::fabs(channel[frame]));
                }
            }
            metrics_->inputPeak.store(inputPeak, std::memory_order_relaxed);
            metrics_->outputPeak.store(outputPeak, std::memory_order_relaxed);

            // The driver knows the true distance between the converter and the
            // buffer; asking it beats calculating from period size, which
            // ignores whatever the hardware adds.
            if ((periodIndex++ % 16) == 0) {
                snd_pcm_sframes_t captureDelay = 0;
                snd_pcm_sframes_t playbackDelay = 0;
                snd_pcm_delay(capture_.pcm, &captureDelay);
                snd_pcm_delay(playback_.pcm, &playbackDelay);
                const long total = std::max<long>(0, captureDelay) + std::max<long>(0, playbackDelay);
                metrics_->roundTripFrames.store(static_cast<uint32_t>(total), std::memory_order_relaxed);
            }
        }
    }

    if (metrics_) {
        metrics_->running.store(false, std::memory_order_relaxed);
    }
    running_.store(false, std::memory_order_release);
}

std::vector<AudioDeviceInfo> AlsaBackend::enumerateDevices() {
    std::vector<AudioDeviceInfo> devices;

    static const unsigned kCandidateRates[] = {44100, 48000, 88200, 96000, 176400, 192000};
    static const unsigned kCandidatePeriods[] = {16, 32, 64, 128, 256, 512, 1024};

    int card = -1;
    while (snd_card_next(&card) >= 0 && card >= 0) {
        char controlName[32];
        std::snprintf(controlName, sizeof(controlName), "hw:%d", card);

        snd_ctl_t* control = nullptr;
        if (snd_ctl_open(&control, controlName, 0) < 0) {
            continue;
        }

        snd_ctl_card_info_t* cardInfo = nullptr;
        snd_ctl_card_info_alloca(&cardInfo);
        if (snd_ctl_card_info(control, cardInfo) < 0) {
            snd_ctl_close(control);
            continue;
        }

        const std::string cardName = snd_ctl_card_info_get_name(cardInfo);
        const std::string driver = snd_ctl_card_info_get_driver(cardInfo);

        int device = -1;
        while (snd_ctl_pcm_next_device(control, &device) >= 0 && device >= 0) {
            AudioDeviceInfo info;
            char id[48];
            std::snprintf(id, sizeof(id), "hw:%d,%d", card, device);
            info.id = id;
            info.name = cardName;
            info.driver = driver;
            info.isHat = looksLikeHat(driver, cardName);

            // Probing both directions is the only reliable way to know whether
            // a card can do duplex; the name never tells you.
            for (int direction = 0; direction < 2; ++direction) {
                const bool capture = direction == 0;
                snd_pcm_t* pcm = nullptr;
                if (snd_pcm_open(&pcm, info.id.c_str(),
                                 capture ? SND_PCM_STREAM_CAPTURE : SND_PCM_STREAM_PLAYBACK,
                                 SND_PCM_NONBLOCK) < 0) {
                    continue;
                }

                snd_pcm_hw_params_t* hw = nullptr;
                snd_pcm_hw_params_alloca(&hw);
                if (snd_pcm_hw_params_any(pcm, hw) < 0) {
                    snd_pcm_close(pcm);
                    continue;
                }

                unsigned maxChannels = 0;
                snd_pcm_hw_params_get_channels_max(hw, &maxChannels);
                if (capture) {
                    info.maxInputChannels = maxChannels;
                } else {
                    info.maxOutputChannels = maxChannels;
                }

                if (!capture) {
                    info.supportsMmap =
                        snd_pcm_hw_params_test_access(pcm, hw, SND_PCM_ACCESS_MMAP_INTERLEAVED) == 0;

                    for (unsigned rate : kCandidateRates) {
                        if (snd_pcm_hw_params_test_rate(pcm, hw, rate, 0) == 0) {
                            info.sampleRates.push_back(rate);
                        }
                    }
                    for (unsigned period : kCandidatePeriods) {
                        if (snd_pcm_hw_params_test_period_size(pcm, hw, period, 0) == 0) {
                            info.periodSizes.push_back(period);
                        }
                    }
                    snd_pcm_hw_params_get_periods_min(hw, &info.minPeriods, nullptr);
                    snd_pcm_hw_params_get_periods_max(hw, &info.maxPeriods, nullptr);
                }

                snd_pcm_close(pcm);
            }

            info.duplex = info.maxInputChannels > 0 && info.maxOutputChannels > 0;
            if (info.maxInputChannels > 0 || info.maxOutputChannels > 0) {
                devices.push_back(std::move(info));
            }
        }

        snd_ctl_close(control);
    }

    // Duplex hardware first: it is the only kind that can actually run a
    // guitar rig, so it belongs at the top of the picker.
    std::stable_sort(devices.begin(), devices.end(),
                     [](const AudioDeviceInfo& a, const AudioDeviceInfo& b) {
                         return a.duplex && !b.duplex;
                     });
    return devices;
}

std::unique_ptr<AudioBackend> createAudioBackend() {
    return std::make_unique<AlsaBackend>();
}

} // namespace pimfx
