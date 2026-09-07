#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <thread>
#include <atomic>
#include <mutex>
#include <vector>

namespace pimfx {

struct MidiPortInfo {
    std::string id;    ///< ALSA raw MIDI device, e.g. "hw:2,0,0"
    std::string name;
    bool input = true;
    bool output = false;
    /// Set when the name looks like a Pi-MFX / ESP32 board, so the UI can
    /// highlight it. The user still has to select the device.
    bool looksLikeController = false;
};

struct MidiMessage {
    uint8_t status = 0;
    uint8_t data1 = 0;
    uint8_t data2 = 0;

    uint8_t type() const { return status & 0xF0; }
    uint8_t channel() const { return status & 0x0F; }

    bool isControlChange() const { return type() == 0xB0; }
    bool isNoteOn() const { return type() == 0x90 && data2 > 0; }
    bool isNoteOff() const { return type() == 0x80 || (type() == 0x90 && data2 == 0); }
    bool isProgramChange() const { return type() == 0xC0; }
};

/// Reads the foot controller.
///
/// The controller is a standard USB-MIDI device, so anything that speaks MIDI
/// works: the Pi-MFX ESP32 firmware, a commercial floorboard, or an expression
/// pedal through a MIDI interface. Nothing about the protocol is specific to
/// our hardware.
class MidiInput {
public:
    using MessageHandler = std::function<void(const MidiMessage&)>;
    using SysExHandler = std::function<void(const std::vector<uint8_t>&)>;

    ~MidiInput();

    /// Opens `port`. If `port` is empty and exactly one MIDI input exists, that
    /// device is used. Otherwise the UI must pick a port.
    bool start(const std::string& port, std::string& error);
    void stop();
    bool isRunning() const { return running_.load(std::memory_order_acquire); }
    std::string activePort() const;

    void setMessageHandler(MessageHandler handler) { messageHandler_ = std::move(handler); }
    void setSysExHandler(SysExHandler handler) { sysexHandler_ = std::move(handler); }

    /// Sends bytes back to the controller, which is how LED colours and
    /// display text reach the board.
    bool send(const std::vector<uint8_t>& bytes);

    static std::vector<MidiPortInfo> enumeratePorts();

private:
    bool startRaw(const std::string& port, std::string& error);
    bool startSeq(int client, int port, std::string& error);
    void run();
    void runRaw();
    void runSeq();

    void* input_ = nullptr;   ///< snd_rawmidi_t*
    void* output_ = nullptr;  ///< snd_rawmidi_t*
    void* seq_ = nullptr;     ///< snd_seq_t*
    int seqOurPort_ = -1;
    int seqPeerClient_ = -1;
    int seqPeerPort_ = -1;
    std::string port_;
    mutable std::mutex portMutex_;
    std::mutex sendMutex_;

    std::thread thread_;
    std::atomic<bool> running_{false};
    std::atomic<bool> stopRequested_{false};

    MessageHandler messageHandler_;
    SysExHandler sysexHandler_;
};

} // namespace pimfx
