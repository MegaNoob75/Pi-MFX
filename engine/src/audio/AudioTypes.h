#pragma once

#include <atomic>
#include <cstdint>
#include <string>
#include <vector>

namespace pimfx {

/// Everything the user can change about the audio path.
///
/// These map directly onto ALSA hardware parameters. The UI exposes all of
/// them, because on a guitar rig the difference between 64 x 3 and 128 x 2 is
/// the difference between playable and not.
struct AudioSettings {
    /// ALSA device name, e.g. "hw:CARD=Audio,DEV=0". Empty means "pick the
    /// first usable duplex device".
    std::string device;

    /// Separate capture device, for the rare rig that splits input and output
    /// across two cards. Empty means use `device` for both.
    std::string captureDevice;

    unsigned sampleRate = 48000;
    unsigned periodFrames = 64;   ///< ALSA period size: the callback quantum
    unsigned periodCount = 3;     ///< ALSA periods per buffer

    unsigned inputChannels = 2;
    unsigned outputChannels = 2;

    /// Guitar is mono. This is the capture channel that feeds the chain and
    /// both headphone/amp outputs. Two-channel USB boxes (Scarlett Solo)
    /// usually put the instrument jack on input 2, which is offset 1.
    unsigned inputChannelOffset = 1;
    unsigned outputChannelOffset = 0;

    /// mmap access avoids a copy per period. Falls back automatically on
    /// hardware whose driver does not support it.
    bool useMmap = true;

    /// Ask ALSA to start the stream as soon as one period is queued rather
    /// than waiting for the whole buffer.
    bool startImmediately = true;

    float inputGainDb = 0.0f;
    float outputGainDb = 0.0f;

    /// Mutes output whenever the chain is being rebuilt, so a plugin swap
    /// cannot produce a click through an amp.
    bool muteOnChange = true;

    /// Theoretical one-way buffering, in milliseconds, for display next to the
    /// measured figure.
    double bufferMs() const {
        return sampleRate == 0 ? 0.0
                               : (1000.0 * periodFrames * periodCount) / static_cast<double>(sampleRate);
    }

    bool operator==(const AudioSettings& other) const {
        return device == other.device
            && captureDevice == other.captureDevice
            && sampleRate == other.sampleRate
            && periodFrames == other.periodFrames
            && periodCount == other.periodCount
            && inputChannels == other.inputChannels
            && outputChannels == other.outputChannels
            && useMmap == other.useMmap
            && startImmediately == other.startImmediately;
    }

    bool operator!=(const AudioSettings& other) const { return !(*this == other); }
};

/// What a card actually supports, discovered by probing rather than guessed,
/// so the UI can grey out combinations the hardware will refuse.
struct AudioDeviceInfo {
    std::string id;          ///< ALSA device string used to open it
    std::string name;        ///< human-readable card + device name
    std::string driver;      ///< "USB-Audio", "HiFiBerry", ...
    bool isHat = false;      ///< I2S board rather than USB
    bool isHdmi = false;     ///< Pi onboard HDMI; not a guitar path
    bool duplex = false;     ///< can capture and play back at once
    unsigned maxInputChannels = 0;
    unsigned maxOutputChannels = 0;
    std::vector<unsigned> sampleRates;
    std::vector<unsigned> periodSizes;
    unsigned minPeriods = 2;
    unsigned maxPeriods = 8;
    bool supportsMmap = false;
};

/// Live numbers from the audio thread.
///
/// Every field is written by the audio thread with relaxed stores and read by
/// the control thread. Approximate reads are fine; the point is a meter, and
/// no lock may ever be taken on the audio side.
struct AudioMetrics {
    std::atomic<uint64_t> xruns{0};
    std::atomic<uint64_t> periods{0};

    /// Fraction of one period spent inside the processing callback, smoothed.
    /// 1.0 means the engine is exactly keeping up and about to fail.
    std::atomic<float> dspLoad{0.0f};
    std::atomic<float> dspLoadPeak{0.0f};

    /// Measured round trip, from the driver's own reported delay, in frames.
    std::atomic<uint32_t> roundTripFrames{0};

    std::atomic<float> inputPeak{0.0f};
    std::atomic<float> outputPeak{0.0f};

    /// Set when the stream is running and processing.
    std::atomic<bool> running{false};

    void reset() {
        xruns.store(0, std::memory_order_relaxed);
        periods.store(0, std::memory_order_relaxed);
        dspLoad.store(0.0f, std::memory_order_relaxed);
        dspLoadPeak.store(0.0f, std::memory_order_relaxed);
        roundTripFrames.store(0, std::memory_order_relaxed);
        inputPeak.store(0.0f, std::memory_order_relaxed);
        outputPeak.store(0.0f, std::memory_order_relaxed);
    }
};

} // namespace pimfx
