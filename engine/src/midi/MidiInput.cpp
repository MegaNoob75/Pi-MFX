#include "midi/MidiInput.h"

#include "core/Log.h"

#include <algorithm>
#include <cctype>
#include <cerrno>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#if defined(PIMFX_HAVE_ALSA)
#include <alsa/asoundlib.h>
#include <dirent.h>
#endif

namespace pimfx {
namespace {

bool nameLooksLikeController(const std::string& name) {
    std::string lower = name;
    std::transform(lower.begin(), lower.end(), lower.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return lower.find("pi-mfx") != std::string::npos
        || lower.find("pimfx") != std::string::npos
        || lower.find("esp32") != std::string::npos
        || lower.find("tinyusb") != std::string::npos;
}

std::string tidyLabel(std::string text) {
    for (char& ch : text) {
        if (ch == '\n' || ch == '\r') {
            ch = ' ';
        }
    }
    return text;
}

std::string normalizeRawMidiId(const std::string& id) {
    int card = 0;
    int device = 0;
    int sub = 0;
    const int matched = std::sscanf(id.c_str(), "hw:%d,%d,%d", &card, &device, &sub);
    if (matched == 2) {
        char normalized[64];
        std::snprintf(normalized, sizeof(normalized), "hw:%d,%d,0", card, device);
        return normalized;
    }
    return id;
}

void mergePort(std::vector<MidiPortInfo>& ports, MidiPortInfo incoming) {
    incoming.id = normalizeRawMidiId(incoming.id);
    auto existing = std::find_if(ports.begin(), ports.end(),
                                 [&](const MidiPortInfo& port) { return port.id == incoming.id; });
    if (existing == ports.end()) {
        ports.push_back(std::move(incoming));
        return;
    }
    existing->input = existing->input || incoming.input;
    existing->output = existing->output || incoming.output;
    existing->looksLikeController = existing->looksLikeController || incoming.looksLikeController;
    if (existing->name.empty() && !incoming.name.empty()) {
        existing->name = std::move(incoming.name);
    }
}

#if defined(PIMFX_HAVE_ALSA)

bool skipAutoPick(const MidiPortInfo& port) {
    std::string lower = port.name + " " + port.id;
    std::transform(lower.begin(), lower.end(), lower.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return lower.find("midi through") != std::string::npos
        || lower.find("through port") != std::string::npos
        || lower.find("announce") != std::string::npos;
}

bool parseSeqId(const std::string& id, int& client, int& port) {
    return id.rfind("seq:", 0) == 0 && std::sscanf(id.c_str(), "seq:%d:%d", &client, &port) == 2;
}

void addDevSndPorts(std::vector<MidiPortInfo>& ports) {
    DIR* dir = opendir("/dev/snd");
    if (!dir) {
        return;
    }
    while (dirent* entry = readdir(dir)) {
        int card = 0;
        int device = 0;
        if (std::sscanf(entry->d_name, "midiC%dD%d", &card, &device) != 2) {
            continue;
        }
        char id[64];
        std::snprintf(id, sizeof(id), "hw:%d,%d,0", card, device);
        MidiPortInfo port;
        port.id = id;
        port.name = std::string("ALSA MIDI ") + id;
        port.input = true;
        port.output = true;
        port.looksLikeController = nameLooksLikeController(port.name);
        mergePort(ports, std::move(port));
    }
    closedir(dir);
}

void addSeqPorts(std::vector<MidiPortInfo>& ports) {
    snd_seq_t* seq = nullptr;
    if (snd_seq_open(&seq, "default", SND_SEQ_OPEN_INPUT, 0) < 0) {
        return;
    }
    snd_seq_set_client_name(seq, "Pi-MFX enumerator");

    snd_seq_client_info_t* clientInfo = nullptr;
    snd_seq_client_info_alloca(&clientInfo);
    snd_seq_port_info_t* portInfo = nullptr;
    snd_seq_port_info_alloca(&portInfo);

    snd_seq_client_info_set_client(clientInfo, -1);
    while (snd_seq_query_next_client(seq, clientInfo) >= 0) {
        const int client = snd_seq_client_info_get_client(clientInfo);
        const char* clientName = snd_seq_client_info_get_name(clientInfo);
        if (client == SND_SEQ_CLIENT_SYSTEM) {
            continue;
        }
        if (clientName && (std::strcmp(clientName, "Pi-MFX") == 0
                           || std::strcmp(clientName, "Pi-MFX enumerator") == 0)) {
            continue;
        }

        snd_seq_port_info_set_client(portInfo, client);
        snd_seq_port_info_set_port(portInfo, -1);
        while (snd_seq_query_next_port(seq, portInfo) >= 0) {
            const unsigned caps = snd_seq_port_info_get_capability(portInfo);
            const bool canRead = (caps & SND_SEQ_PORT_CAP_READ) && (caps & SND_SEQ_PORT_CAP_SUBS_READ);
            const bool canWrite = (caps & SND_SEQ_PORT_CAP_WRITE) && (caps & SND_SEQ_PORT_CAP_SUBS_WRITE);
            if (!canRead && !canWrite) {
                continue;
            }

            char id[64];
            std::snprintf(id, sizeof(id), "seq:%d:%d", client, snd_seq_port_info_get_port(portInfo));

            std::string label = clientName && clientName[0] != '\0' ? clientName : id;
            const char* portName = snd_seq_port_info_get_name(portInfo);
            if (portName && portName[0] != '\0' && label != portName) {
                label.append(" · ");
                label.append(portName);
            }

            MidiPortInfo port;
            port.id = id;
            port.name = tidyLabel(label);
            port.input = canRead;
            port.output = canWrite;
            port.looksLikeController = nameLooksLikeController(port.name);
            mergePort(ports, std::move(port));
        }
    }

    snd_seq_close(seq);
}

#endif // PIMFX_HAVE_ALSA

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

        snd_ctl_card_info_t* cardInfo = nullptr;
        snd_ctl_card_info_alloca(&cardInfo);
        std::string cardName = std::string("MIDI ") + std::to_string(card);
        if (snd_ctl_card_info(control, cardInfo) >= 0) {
            const char* name = snd_ctl_card_info_get_name(cardInfo);
            if (name && name[0] != '\0') {
                cardName = name;
            }
        }

        int device = -1;
        while (snd_ctl_rawmidi_next_device(control, &device) >= 0 && device >= 0) {
            for (int direction = 0; direction < 2; ++direction) {
                const bool isInput = direction == 0;
                snd_rawmidi_info_t* info = nullptr;
                snd_rawmidi_info_alloca(&info);
                snd_rawmidi_info_set_device(info, static_cast<unsigned>(device));
                snd_rawmidi_info_set_stream(info, isInput ? SND_RAWMIDI_STREAM_INPUT
                                                          : SND_RAWMIDI_STREAM_OUTPUT);
                snd_rawmidi_info_set_subdevice(info, 0);
                if (snd_ctl_rawmidi_info(control, info) < 0) {
                    continue;
                }

                unsigned subCount = snd_rawmidi_info_get_subdevices_count(info);
                if (subCount == 0) {
                    subCount = 1;
                }

                for (unsigned sub = 0; sub < subCount; ++sub) {
                    snd_rawmidi_info_set_subdevice(info, sub);
                    if (snd_ctl_rawmidi_info(control, info) < 0) {
                        continue;
                    }

                    char id[64];
                    std::snprintf(id, sizeof(id), "hw:%d,%d,%u", card, device, sub);

                    const char* deviceName = snd_rawmidi_info_get_name(info);
                    const char* subName = snd_rawmidi_info_get_subdevice_name(info);

                    std::string label = cardName;
                    if (deviceName && deviceName[0] != '\0' && cardName != deviceName) {
                        label.append(" · ");
                        label.append(deviceName);
                    }
                    if (subName && subName[0] != '\0' && (!deviceName || std::string(subName) != deviceName)) {
                        label.append(" · ");
                        label.append(subName);
                    }

                    MidiPortInfo port;
                    port.id = id;
                    port.name = label;
                    port.input = isInput;
                    port.output = !isInput;
                    port.looksLikeController = nameLooksLikeController(label);
                    mergePort(ports, std::move(port));
                }
            }
        }
        snd_ctl_close(control);
    }

    void** hints = nullptr;
    if (snd_device_name_hint(-1, "rawmidi", &hints) >= 0 && hints) {
        for (void** entry = hints; *entry; ++entry) {
            char* name = snd_device_name_get_hint(*entry, "NAME");
            char* desc = snd_device_name_get_hint(*entry, "DESC");
            char* ioid = snd_device_name_get_hint(*entry, "IOID");
            if (name && name[0] != '\0') {
                MidiPortInfo port;
                port.id = name;
                port.name = tidyLabel(desc && desc[0] != '\0' ? desc : name);
                port.input = ioid == nullptr || std::strcmp(ioid, "Output") != 0;
                port.output = ioid == nullptr || std::strcmp(ioid, "Input") != 0;
                port.looksLikeController = nameLooksLikeController(port.name + " " + port.id);
                mergePort(ports, std::move(port));
            }
            std::free(name);
            std::free(desc);
            std::free(ioid);
        }
        snd_device_name_free_hint(hints);
    }

    addDevSndPorts(ports);
    addSeqPorts(ports);

    std::stable_sort(ports.begin(), ports.end(), [](const MidiPortInfo& a, const MidiPortInfo& b) {
        if (a.looksLikeController != b.looksLikeController) {
            return a.looksLikeController && !b.looksLikeController;
        }
        return a.name < b.name;
    });
    return ports;
}

bool MidiInput::start(const std::string& port, std::string& error) {
    stop();

    std::string target = port;
    if (target.empty()) {
        std::vector<MidiPortInfo> inputs;
        for (const MidiPortInfo& candidate : enumeratePorts()) {
            if (candidate.input && !skipAutoPick(candidate)) {
                inputs.push_back(candidate);
            }
        }
        if (inputs.size() == 1) {
            target = inputs.front().id;
            logInfo("midi: using the only input " + target);
        } else if (inputs.empty()) {
            error = "no MIDI devices found";
            return false;
        } else {
            error = "select a MIDI device in Settings → Controller";
            return false;
        }
    }

    int seqClient = 0;
    int seqPort = 0;
    const bool opened = parseSeqId(target, seqClient, seqPort)
        ? startSeq(seqClient, seqPort, error)
        : startRaw(target, error);
    if (!opened) {
        return false;
    }

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

bool MidiInput::startRaw(const std::string& port, std::string& error) {
    snd_rawmidi_t* input = nullptr;
    snd_rawmidi_t* output = nullptr;
    const int result = snd_rawmidi_open(&input, &output, port.c_str(), SND_RAWMIDI_NONBLOCK);
    if (result < 0) {
        // Output-only failure is common and harmless: the board still sends
        // switch presses, it just cannot receive LED updates.
        if (snd_rawmidi_open(&input, nullptr, port.c_str(), SND_RAWMIDI_NONBLOCK) < 0) {
            error = std::string("cannot open MIDI port ") + port + ": " + snd_strerror(result);
            return false;
        }
        logWarn("midi: " + port + " opened for input only; LED feedback is unavailable");
    }
    input_ = input;
    output_ = output;
    return true;
}

bool MidiInput::startSeq(int client, int port, std::string& error) {
    snd_seq_t* seq = nullptr;
    int result = snd_seq_open(&seq, "default", SND_SEQ_OPEN_DUPLEX, SND_SEQ_NONBLOCK);
    if (result < 0) {
        result = snd_seq_open(&seq, "default", SND_SEQ_OPEN_INPUT, SND_SEQ_NONBLOCK);
        if (result < 0) {
            error = std::string("cannot open ALSA sequencer: ") + snd_strerror(result);
            return false;
        }
    }
    snd_seq_set_client_name(seq, "Pi-MFX");
    const int ourPort = snd_seq_create_simple_port(
        seq,
        "controller",
        SND_SEQ_PORT_CAP_WRITE | SND_SEQ_PORT_CAP_SUBS_WRITE
            | SND_SEQ_PORT_CAP_READ | SND_SEQ_PORT_CAP_SUBS_READ,
        SND_SEQ_PORT_TYPE_MIDI_GENERIC | SND_SEQ_PORT_TYPE_APPLICATION);
    if (ourPort < 0) {
        error = std::string("cannot create sequencer port: ") + snd_strerror(ourPort);
        snd_seq_close(seq);
        return false;
    }
    result = snd_seq_connect_from(seq, ourPort, client, port);
    if (result < 0) {
        error = std::string("cannot subscribe to sequencer port: ") + snd_strerror(result);
        snd_seq_close(seq);
        return false;
    }
    if (snd_seq_connect_to(seq, ourPort, client, port) < 0) {
        logWarn("midi: sequencer port opened for input only; LED feedback is unavailable");
    }

    seq_ = seq;
    seqOurPort_ = ourPort;
    seqPeerClient_ = client;
    seqPeerPort_ = port;
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
    if (seq_) {
        snd_seq_close(static_cast<snd_seq_t*>(seq_));
        seq_ = nullptr;
    }
    seqOurPort_ = -1;
    seqPeerClient_ = -1;
    seqPeerPort_ = -1;
}

bool MidiInput::send(const std::vector<uint8_t>& bytes) {
    std::lock_guard<std::mutex> lock(sendMutex_);
    if (bytes.empty()) {
        return false;
    }
    if (seq_ && seqOurPort_ >= 0 && seqPeerClient_ >= 0) {
        snd_midi_event_t* coder = nullptr;
        if (snd_midi_event_new(bytes.size() + 16, &coder) < 0) {
            return false;
        }
        snd_midi_event_init(coder);
        snd_midi_event_no_status(coder, 1);
        size_t offset = 0;
        bool ok = true;
        while (offset < bytes.size()) {
            snd_seq_event_t event;
            snd_seq_ev_clear(&event);
            const long encoded = snd_midi_event_encode(
                coder, bytes.data() + offset, bytes.size() - offset, &event);
            if (encoded <= 0) {
                ok = false;
                break;
            }
            offset += static_cast<size_t>(encoded);
            snd_seq_ev_set_source(&event, seqOurPort_);
            snd_seq_ev_set_dest(&event, seqPeerClient_, seqPeerPort_);
            snd_seq_ev_set_direct(&event);
            if (snd_seq_event_output(static_cast<snd_seq_t*>(seq_), &event) < 0) {
                ok = false;
                break;
            }
        }
        snd_seq_drain_output(static_cast<snd_seq_t*>(seq_));
        snd_midi_event_free(coder);
        return ok;
    }
    if (!output_) {
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
    if (seq_) {
        runSeq();
        return;
    }
    runRaw();
}

void MidiInput::runSeq() {
    auto* seq = static_cast<snd_seq_t*>(seq_);
    while (!stopRequested_.load(std::memory_order_acquire)) {
        snd_seq_event_t* event = nullptr;
        const int received = snd_seq_event_input(seq, &event);
        if (received == -EAGAIN || received == 0) {
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
            continue;
        }
        if (received < 0) {
            logWarn(describeError("midi: sequencer read failed", received));
            break;
        }
        if (!event) {
            continue;
        }

        if (event->type == SND_SEQ_EVENT_SYSEX && event->data.ext.ptr && sysexHandler_) {
            const auto* data = static_cast<const uint8_t*>(event->data.ext.ptr);
            sysexHandler_(std::vector<uint8_t>(data, data + event->data.ext.len));
            continue;
        }

        MidiMessage message;
        switch (event->type) {
        case SND_SEQ_EVENT_NOTEON:
            message.status = static_cast<uint8_t>(0x90 | (event->data.note.channel & 0x0F));
            message.data1 = event->data.note.note;
            message.data2 = event->data.note.velocity;
            break;
        case SND_SEQ_EVENT_NOTEOFF:
            message.status = static_cast<uint8_t>(0x80 | (event->data.note.channel & 0x0F));
            message.data1 = event->data.note.note;
            message.data2 = event->data.note.velocity;
            break;
        case SND_SEQ_EVENT_CONTROLLER:
            message.status = static_cast<uint8_t>(0xB0 | (event->data.control.channel & 0x0F));
            message.data1 = static_cast<uint8_t>(event->data.control.param);
            message.data2 = static_cast<uint8_t>(event->data.control.value);
            break;
        case SND_SEQ_EVENT_PGMCHANGE:
            message.status = static_cast<uint8_t>(0xC0 | (event->data.control.channel & 0x0F));
            message.data1 = static_cast<uint8_t>(event->data.control.value);
            break;
        default:
            continue;
        }
        if (messageHandler_) {
            messageHandler_(message);
        }
    }
    running_.store(false, std::memory_order_release);
}

void MidiInput::runRaw() {
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

bool MidiInput::startRaw(const std::string&, std::string& error) {
    error = "MIDI requires ALSA; this build has none";
    return false;
}

bool MidiInput::startSeq(int, int, std::string& error) {
    error = "MIDI requires ALSA; this build has none";
    return false;
}

void MidiInput::runRaw() {}

void MidiInput::runSeq() {}

#endif

} // namespace pimfx
