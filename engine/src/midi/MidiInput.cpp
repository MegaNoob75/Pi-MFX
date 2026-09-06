#include "midi/MidiInput.h"

#include "core/Log.h"

#include <algorithm>
#include <cctype>
#include <cerrno>
#include <chrono>
#include <cstdio>
#include <cstring>

#if defined(PIMFX_HAVE_ALSA)
#include <alsa/asoundlib.h>
#endif

namespace pimfx {
namespace {

bool nameLooksLikeController(const std::string& name) {
    std::string lower = name;
    std::transform(lower.begin(), lower.end(), lower.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return lower.find("pi-mfx") != std::string::npos
        || lower.find("pimfx") != std::string::npos
        || lower.find("esp32") != std::string::npos;
}

} // namespace

MidiInput::~MidiInput() {
    stop();
}

std::string MidiInput::activePort() const {
    std::lock_guard<std::mutex> lock(portMutex_);
    return port_;
}

#if defined(PIMFX_HAVE_ALSA)

std::vector<MidiPortInfo> MidiInput::enumeratePorts() {
    std::vector<MidiPortInfo> ports;

    int card = -1;
    while (snd_card_next(&card) >= 0 && card >= 0) {
        char controlName[32];
        std::snprintf(controlName, sizeof(controlName), "hw:%d", card);

        snd_ctl_t* control = nullptr;
        if (snd_ctl_open(&control, controlName, 0) < 0) {
            continue;
        }

        int device = -1;
        while (snd_ctl_rawmidi_next_device(control, &device) >= 0 && device >= 0) {
            snd_rawmidi_info_t* info = nullptr;
            snd_rawmidi_info_alloca(&info);
            snd_rawmidi_info_set_device(info, static_cast<unsigned>(device));

            for (int direction = 0; direction < 2; ++direction) {
                const bool input = direction == 0;
                snd_rawmidi_info_set_stream(info, input ? SND_RAWMIDI_STREAM_INPUT
                                                        : SND_RAWMIDI_STREAM_OUTPUT);
                snd_rawmidi_info_set_subdevice(info, 0);
                if (snd_ctl_rawmidi_info(control, info) < 0) {
                    continue;
                }

                char id[48];
                std::snprintf(id, sizeof(id), "hw:%d,%d,0", card, device);

                const std::string name = snd_rawmidi_info_get_name(info);
                auto existing = std::find_if(ports.begin(), ports.end(),
                                             [&](const MidiPortInfo& port) { return port.id == id; });
                if (existing == ports.end()) {
                    MidiPortInfo port;
                    port.id = id;
                    port.name = name;
                    port.input = input;
                    port.output = !input;
                    port.looksLikeController = nameLooksLikeController(name);
                    ports.push_back(std::move(port));
                } else {
                    existing->input = existing->input || input;
                    existing->output = existing->output || !input;
                }
            }
        }
        snd_ctl_close(control);
    }

    std::stable_sort(ports.begin(), ports.end(), [](const MidiPortInfo& a, const MidiPortInfo& b) {
        return a.looksLikeController && !b.looksLikeController;
    });
    return ports;
}

bool MidiInput::start(const std::string& port, std::string& error) {
    stop();

    std::string target = port;
    if (target.empty()) {
        for (const MidiPortInfo& candidate : enumeratePorts()) {
            if (candidate.input && candidate.looksLikeController) {
                target = candidate.id;
                break;
            }
        }
    }
    if (target.empty()) {
        error = "no MIDI controller found";
        return false;
    }

    snd_rawmidi_t* input = nullptr;
    snd_rawmidi_t* output = nullptr;
    const int result = snd_rawmidi_open(&input, &output, target.c_str(), SND_RAWMIDI_NONBLOCK);
    if (result < 0) {
        // Output-only failure is common and harmless: the board still sends
        // switch presses, it just cannot receive LED updates.
        if (snd_rawmidi_open(&input, nullptr, target.c_str(), SND_RAWMIDI_NONBLOCK) < 0) {
            error = std::string("cannot open MIDI port ") + target + ": " + snd_strerror(result);
            return false;
        }
        logWarn("midi: " + target + " opened for input only; LED feedback is unavailable");
    }

    input_ = input;
    output_ = output;
    {
        std::lock_guard<std::mutex> lock(portMutex_);
        port_ = target;
    }

    stopRequested_.store(false, std::memory_order_release);
    running_.store(true, std::memory_order_release);
    thread_ = std::thread(&MidiInput::run, this);

    logInfo("midi: listening on " + target);
    return true;
}

void MidiInput::stop() {
    if (thread_.joinable()) {
        stopRequested_.store(true, std::memory_order_release);
        thread_.join();
    }
    running_.store(false, std::memory_order_release);

    if (input_) {
        snd_rawmidi_close(static_cast<snd_rawmidi_t*>(input_));
        input_ = nullptr;
    }
    if (output_) {
        snd_rawmidi_close(static_cast<snd_rawmidi_t*>(output_));
        output_ = nullptr;
    }
}

bool MidiInput::send(const std::vector<uint8_t>& bytes) {
    std::lock_guard<std::mutex> lock(sendMutex_);
    if (!output_ || bytes.empty()) {
        return false;
    }
    const ssize_t written = snd_rawmidi_write(static_cast<snd_rawmidi_t*>(output_),
                                              bytes.data(), bytes.size());
    if (written < 0) {
        return false;
    }
    snd_rawmidi_drain(static_cast<snd_rawmidi_t*>(output_));
    return true;
}

void MidiInput::run() {
    uint8_t buffer[256];
    std::vector<uint8_t> sysex;
    bool inSysEx = false;

    // Running status: a controller may send only the data bytes after the
    // first message of a run, so the last status byte has to be remembered.
    uint8_t runningStatus = 0;
    uint8_t pending[2] = {0, 0};
    int pendingCount = 0;
    int expected = 0;

    while (!stopRequested_.load(std::memory_order_acquire)) {
        const ssize_t received = snd_rawmidi_read(static_cast<snd_rawmidi_t*>(input_),
                                                  buffer, sizeof(buffer));
        if (received == -EAGAIN || received == 0) {
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
            continue;
        }
        if (received < 0) {
            logWarn(describeError("midi: read failed", static_cast<int>(received)));
            break;
        }

        for (ssize_t i = 0; i < received; ++i) {
            const uint8_t byte = buffer[i];

            if (byte == 0xF0) {
                inSysEx = true;
                sysex.clear();
                sysex.push_back(byte);
                continue;
            }
            if (inSysEx) {
                sysex.push_back(byte);
                if (byte == 0xF7) {
                    inSysEx = false;
                    if (sysexHandler_) {
                        sysexHandler_(sysex);
                    }
                } else if (sysex.size() > 4096) {
                    inSysEx = false; // runaway message; drop it
                }
                continue;
            }

            if (byte >= 0xF8) {
                continue; // realtime clock messages are not used
            }

            if (byte & 0x80) {
                runningStatus = byte;
                pendingCount = 0;
                const uint8_t type = byte & 0xF0;
                expected = (type == 0xC0 || type == 0xD0) ? 1 : 2;
                continue;
            }

            if (runningStatus == 0) {
                continue;
            }
            pending[pendingCount++] = byte;
            if (pendingCount < expected) {
                continue;
            }

            MidiMessage message;
            message.status = runningStatus;
            message.data1 = pending[0];
            message.data2 = expected > 1 ? pending[1] : 0;
            pendingCount = 0;

            if (messageHandler_) {
                messageHandler_(message);
            }
        }
    }

    running_.store(false, std::memory_order_release);
}

#else // no ALSA: MIDI is unavailable, and the UI says so rather than pretending

std::vector<MidiPortInfo> MidiInput::enumeratePorts() { return {}; }

bool MidiInput::start(const std::string&, std::string& error) {
    error = "MIDI requires ALSA; this build has none";
    return false;
}

void MidiInput::stop() {}

bool MidiInput::send(const std::vector<uint8_t>&) { return false; }

void MidiInput::run() {}

#endif

} // namespace pimfx
