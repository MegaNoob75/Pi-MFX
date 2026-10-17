#pragma once
#include "model/Model.h"
#include "midi/MidiInput.h"
#include "../../../firmware/esp32s3/PiMFX_Controller/HardwareProtocol.h"
#include <chrono>
#include <functional>
#include <string>
#include <vector>

namespace pimfx {
// Control-thread protocol state. Engine serializes every call with stateMutex_.
// Device wiring is never overwritten on connect or profile/backup load.
class ControllerHardware {
public:
    ControllerHardware();
    using Sender = std::function<bool(const std::vector<uint8_t>&)>;
    void reset();
    bool command(const std::string& action, const Json& payload, ControllerConfig& config,
                 const Sender& send, std::string& error);
    bool receive(const std::vector<uint8_t>& bytes, ControllerConfig& config,
                 const Sender& send, bool& configChanged);
    bool tick(const Sender& send);
    bool busy() const { return phase_ == "searching" || phase_ == "review"
        || phase_ == "proposing" || phase_ == "saving" || phase_ == "reading"; }
    bool ready() const { return ready_; }
    std::string phase() const { return phase_; }
    std::string target() const { return target_; }
    Json state() const;
    bool accepts(const MidiMessage& message, const ControllerConfig& config) const;
private:
    bool sendPacket(uint8_t command, const std::vector<uint8_t>& payload, const Sender& send);
    void fail(const std::string& message, const Sender& send);
    bool start(const std::string& phase, const Sender& send);
    Json describe(const pimfxhw::Config& config) const;
    void bindConfirmed(ControllerConfig& config);
    uint16_t token_ = 0, revision_ = 0, incomingRevision_ = 0;
    bool ready_ = false, storageReady_ = false, assembling_ = false, incomingPreview_ = false;
    unsigned expectedCount_ = 0, receivedCount_ = 0;
    bool seen_[pimfxhw::Slots] = {};
    int slot_ = -1;
    pimfxhw::Config active_, proposed_, incoming_, expected_;
    std::string device_, incomingDevice_, phase_ = "idle", message_, target_, operation_;
    std::chrono::steady_clock::time_point deadline_;
};
} // namespace pimfx
