#pragma once

#include "audio/AudioBackend.h"

#include <atomic>
#include <mutex>
#include <thread>

namespace pimfx {

/// A backend with no hardware behind it.
///
/// It calls the processor on a timer at the configured period rate and feeds it
/// silence, so the control API, preset handling, and the whole UI can be
/// developed on a laptop. It is also what runs on the Pi when the configured
/// interface is unplugged, which keeps the web UI alive so the user can pick a
/// different device instead of being locked out.
class MockBackend final : public AudioBackend {
public:
    ~MockBackend() override;

    std::string name() const override { return "Offline"; }

    bool start(const AudioSettings& settings,
               AudioProcessor* processor,
               AudioMetrics* metrics,
               std::string& error) override;

    void stop() override;
    bool isRunning() const override { return running_.load(std::memory_order_acquire); }

    AudioSettings actualSettings() const override;
    std::vector<AudioDeviceInfo> enumerateDevices() override;
    void setFailureHandler(std::function<void(const std::string&)> handler) override;

private:
    void run();

    AudioSettings settings_;
    mutable std::mutex settingsMutex_;

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
};

} // namespace pimfx
