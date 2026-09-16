#include "drums/DrumMachine.h"

#include "core/Paths.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstring>
#include <fstream>
#include <limits>

namespace pimfx {
namespace {

constexpr const char* kVoiceNames[] = {
    "Kick", "Snare", "Closed Hat", "Open Hat", "Tom", "Clap", "Ride", "Percussion"
};

uint16_t u16(const unsigned char* p) {
    return static_cast<uint16_t>(p[0]) | static_cast<uint16_t>(p[1] << 8);
}

uint32_t u32(const unsigned char* p) {
    return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8)
         | (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}

float clampUnit(float value) {
    return std::max(0.0f, std::min(1.0f, std::isfinite(value) ? value : 0.0f));
}

} // namespace

DrumMachine::DrumMachine(std::string root)
    : root_(std::move(root)), samplesRoot_(joinPath(root_, "samples")), kitsRoot_(joinPath(root_, "kits")),
      statePath_(joinPath(root_, "drum-machine.json")) {
    for (auto& variation : program_.variations) variation.length = 16;
    program_.fill.length = 16;
    makeDirectories(root_);
    makeDirectories(samplesRoot_);
    makeDirectories(kitsRoot_);
    for (const std::string& file : listDirectory(kitsRoot_, ".json")) savedKits_.push_back(fileStem(file));
    std::lock_guard<std::mutex> lock(stateMutex_);
    loadStateUnlocked();
    std::string ignored;
    sequencer_.setProgram(program_, ignored);
    sequencer_.setSwing(controlSwing_);
    sequencer_.setHumanization(controlHumanization_);
}

DrumMachine::~DrumMachine() {
    KitCommand pending;
    while (kitCommands_.pop(pending)) delete pending.kit;
    collectRetired();
    delete activeKit_;
}

void DrumMachine::prepare(unsigned sampleRate) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    sampleRate_ = std::max(1u, sampleRate);
    Kit loaded;
    for (size_t voice = 0; voice < controlKit_.voices.size(); ++voice) {
        const std::string file = controlKit_.voices[voice].file;
        if (file.empty()) continue;
        loaded.voices[voice].file = file;
        loaded.voices[voice].name = fileStem(file);
        std::string bytes;
        std::string error;
        Sample sample;
        if (readFile(joinPath(samplesRoot_, file), bytes)
            && decodeWave(bytes, sampleRate_, sample, error)) {
            sample.file = file;
            sample.name = fileStem(file);
            loaded.voices[voice] = std::move(sample);
        }
    }
    controlKit_ = std::move(loaded);
    std::string ignored;
    publishKitUnlocked(ignored);
}

bool DrumMachine::safeWaveName(const std::string& name, std::string& safe) {
    safe = sanitizeFileName(fileName(name));
    const auto dot = safe.find_last_of('.');
    std::string extension = dot == std::string::npos ? std::string() : safe.substr(dot);
    std::transform(extension.begin(), extension.end(), extension.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return extension == ".wav";
}

bool DrumMachine::importSample(unsigned voice, const std::string& name,
                               const std::string& bytes, std::string& error) {
    if (voice >= DrumSequencer::kVoiceCount) { error = "invalid drum voice"; return false; }
    if (bytes.empty() || bytes.size() > 32u * 1024u * 1024u) {
        error = "drum samples must be WAV files no larger than 32 MB";
        return false;
    }
    std::string safe;
    if (!safeWaveName(name, safe)) { error = "drum samples must be WAV files"; return false; }
    const std::string storedName = std::to_string(voice + 1) + "-" + safe;
    Sample decoded;
    if (!decodeWave(bytes, sampleRate_, decoded, error)) return false;
    if (!writeFileAtomic(joinPath(samplesRoot_, storedName), bytes)) {
        error = "could not save the drum sample";
        return false;
    }

    std::lock_guard<std::mutex> lock(stateMutex_);
    decoded.file = storedName;
    decoded.name = fileStem(safe);
    controlKit_.voices[voice] = std::move(decoded);
    if (!publishKitUnlocked(error)) return false;
    if (!saveStateUnlocked()) { error = "could not save the drum kit"; return false; }
    return true;
}

bool DrumMachine::publishKitUnlocked(std::string& error) {
    collectRetired();
    KitCommand command;
    command.kit = new Kit(controlKit_);
    if (!kitCommands_.push(command)) {
        delete command.kit;
        error = "drum kit command queue is full";
        return false;
    }
    return true;
}

bool DrumMachine::publishProgramUnlocked(std::string& error) {
    sequencer_.setSwing(controlSwing_);
    sequencer_.setHumanization(controlHumanization_);
    return sequencer_.setProgram(program_, error);
}

bool DrumMachine::updateStep(const Json& payload, std::string& error) {
    const bool fill = payload["fill"].asBool(false);
    const unsigned variation = static_cast<unsigned>(payload["variation"].asInt(0));
    const unsigned voice = static_cast<unsigned>(payload["voice"].asInt(-1));
    const unsigned step = static_cast<unsigned>(payload["step"].asInt(-1));
    if (voice >= DrumSequencer::kVoiceCount || step >= program_.variations[0].length
        || (!fill && variation >= DrumSequencer::kVariationCount)) {
        error = "invalid drum step";
        return false;
    }
    auto& target = fill ? program_.fill : program_.variations[variation];
    target.steps[voice][step].velocity = static_cast<uint8_t>(
        std::max(0, std::min(127, payload["velocity"].asInt(0))));
    target.steps[voice][step].accent = payload["accent"].asBool(false) ? 1 : 0;
    if (!publishProgramUnlocked(error)) return false;
    if (!saveStateUnlocked()) { error = "could not save the drum pattern"; return false; }
    return true;
}

bool DrumMachine::updateSong(const Json& payload, std::string& error) {
    const Json& sections = payload["sections"];
    if (!sections.isArray() || sections.size() > DrumSequencer::kMaxSongSections) {
        error = "the drum song chain must contain at most 32 sections";
        return false;
    }
    DrumSequencer::Program next = program_;
    next.songLength = static_cast<uint8_t>(sections.size());
    for (size_t index = 0; index < sections.size(); ++index) {
        next.song[index].variation = static_cast<uint8_t>(sections.at(index)["variation"].asInt(-1));
        next.song[index].repeats = static_cast<uint8_t>(sections.at(index)["repeats"].asInt(0));
    }
    if (!sequencer_.setProgram(next, error)) return false;
    program_ = next;
    if (!saveStateUnlocked()) { error = "could not save the drum song"; return false; }
    return true;
}

bool DrumMachine::updateSettings(const Json& payload, std::string& error) {
    const unsigned length = static_cast<unsigned>(payload["length"].asInt(program_.variations[0].length));
    if (length != 16 && length != 32 && length != 64) {
        error = "drum pattern length must be 16, 32, or 64 steps";
        return false;
    }
    for (auto& variation : program_.variations) variation.length = static_cast<uint8_t>(length);
    program_.fill.length = static_cast<uint8_t>(length);
    controlLevel_ = std::max(0.0f, std::min(1.5f, payload["level"].asFloat(controlLevel_)));
    controlSwing_ = clampUnit(payload["swing"].asFloat(controlSwing_));
    controlHumanization_ = clampUnit(payload["humanization"].asFloat(controlHumanization_));
    levelPermille_.store(static_cast<uint32_t>(std::lround(controlLevel_ * 1000.0f)), std::memory_order_release);
    if (!publishProgramUnlocked(error)) return false;
    if (!saveStateUnlocked()) { error = "could not save the drum settings"; return false; }
    return true;
}

bool DrumMachine::saveKit(const Json& payload, std::string& error) {
    const std::string safe = sanitizeFileName(payload["name"].asString("kit"));
    Json manifest = Json::object(); manifest.set("schemaVersion", 1); manifest.set("name", safe);
    Json files = Json::array(); for (const Sample& sample : controlKit_.voices) files.push(sample.file);
    manifest.set("samples", std::move(files));
    if (!writeFileAtomic(joinPath(kitsRoot_, safe + ".json"), manifest.dump(2))) {
        error = "could not save the drum kit"; return false;
    }
    kitName_ = safe;
    if (std::find(savedKits_.begin(), savedKits_.end(), safe) == savedKits_.end()) savedKits_.push_back(safe);
    if (!saveStateUnlocked()) { error = "could not remember the saved drum kit"; return false; }
    return true;
}

bool DrumMachine::loadKit(const Json& payload, std::string& error) {
    const std::string safe = sanitizeFileName(fileStem(payload["name"].asString()));
    std::string text;
    if (!readFile(joinPath(kitsRoot_, safe + ".json"), text)) { error = "that drum kit was not found"; return false; }
    std::string parseError; const Json manifest = Json::parse(text, &parseError);
    if (!parseError.empty() || manifest["schemaVersion"].asInt(0) != 1 || !manifest["samples"].isArray()) {
        error = "that drum kit file is invalid"; return false;
    }
    Kit loaded;
    for (size_t voice = 0; voice < std::min(manifest["samples"].size(), DrumSequencer::kVoiceCount); ++voice) {
        const std::string file = sanitizeFileName(fileName(manifest["samples"].at(voice).asString()));
        if (file.empty() || manifest["samples"].at(voice).asString().empty()) continue;
        std::string bytes; Sample sample;
        if (!readFile(joinPath(samplesRoot_, file), bytes) || !decodeWave(bytes, sampleRate_, sample, error)) return false;
        sample.file = file; sample.name = fileStem(file); loaded.voices[voice] = std::move(sample);
    }
    controlKit_ = std::move(loaded); kitName_ = manifest["name"].asString(safe);
    if (!publishKitUnlocked(error)) return false;
    if (!saveStateUnlocked()) { error = "could not remember the selected drum kit"; return false; }
    return true;
}

bool DrumMachine::deleteKit(const Json& payload, std::string& error) {
    if (!payload["confirmed"].asBool(false)) { error = "deleting a drum kit requires confirmation"; return false; }
    const std::string safe = sanitizeFileName(fileStem(payload["name"].asString()));
    if (!removeFile(joinPath(kitsRoot_, safe + ".json"))) { error = "could not delete the drum kit"; return false; }
    savedKits_.erase(std::remove(savedKits_.begin(), savedKits_.end(), safe), savedKits_.end());
    if (kitName_ == safe) kitName_ = "Custom";
    if (!saveStateUnlocked()) { error = "could not update the drum-kit library"; return false; }
    return true;
}

bool DrumMachine::command(const std::string& commandName, const Json& payload, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    if (commandName == "settings") return updateSettings(payload, error);
    if (commandName == "start") { playing_.store(true, std::memory_order_release); return true; }
    if (commandName == "stop") { playing_.store(false, std::memory_order_release); return true; }
    if (commandName == "toggle") {
        playing_.store(!playing_.load(std::memory_order_acquire), std::memory_order_release); return true;
    }
    if (commandName == "step") return updateStep(payload, error);
    if (commandName == "song/set") return updateSong(payload, error);
    if (commandName == "variation") {
        const unsigned variation = static_cast<unsigned>(payload["variation"].asInt(-1));
        if (variation >= DrumSequencer::kVariationCount) { error = "invalid drum variation"; return false; }
        sequencer_.requestVariation(variation); return true;
    }
    if (commandName == "fill") { sequencer_.triggerFill(); return true; }
    if (commandName == "song/mode") { sequencer_.setSongMode(payload["enabled"].asBool(false)); return true; }
    if (commandName == "kit/save") return saveKit(payload, error);
    if (commandName == "kit/load") return loadKit(payload, error);
    if (commandName == "kit/delete") return deleteKit(payload, error);
    if (commandName == "sample/clear") {
        const unsigned voice = static_cast<unsigned>(payload["voice"].asInt(-1));
        if (voice >= DrumSequencer::kVoiceCount) { error = "invalid drum voice"; return false; }
        controlKit_.voices[voice] = Sample{};
        if (!publishKitUnlocked(error)) return false;
        if (!saveStateUnlocked()) { error = "could not save the drum kit"; return false; }
        return true;
    }
    if (commandName == "clear") {
        const bool fill = payload["fill"].asBool(false);
        const unsigned variation = static_cast<unsigned>(payload["variation"].asInt(0));
        if (!fill && variation >= DrumSequencer::kVariationCount) { error = "invalid drum variation"; return false; }
        DrumSequencer::Pattern empty; empty.length = program_.variations[0].length;
        if (fill) program_.fill = empty; else program_.variations[variation] = empty;
        if (!publishProgramUnlocked(error)) return false;
        if (!saveStateUnlocked()) { error = "could not save the cleared drum pattern"; return false; }
        return true;
    }
    error = "unknown drum-machine command";
    return false;
}

void DrumMachine::render(float* const* master, unsigned masterChannels,
                         float* const* sourceTap, unsigned tapChannels, unsigned frames,
                         const TransportBlock& transport) noexcept {
    if (sourceTap) {
        for (unsigned channel = 0; channel < tapChannels; ++channel)
            std::fill(sourceTap[channel], sourceTap[channel] + frames, 0.0f);
    }
    KitCommand command;
    while (kitCommands_.pop(command)) {
        Kit* previous = activeKit_;
        activeKit_ = command.kit;
        for (Playback& voice : playback_) voice = Playback{};
        if (previous && !retiredKits_.push(previous)) droppedKitChanges_.fetch_add(1, std::memory_order_relaxed);
        kitGeneration_.fetch_add(1, std::memory_order_relaxed);
    }
    if (!activeKit_ || !master || masterChannels == 0) return;
    if (!playing_.load(std::memory_order_acquire)) {
        for (Playback& voice : playback_) voice = Playback{};
        return;
    }

    std::array<DrumSequencer::Trigger, kMaximumTriggersPerBlock> triggers{};
    const size_t triggerCount = sequencer_.renderBlock(transport, frames, triggers.data(), triggers.size());
    size_t triggerIndex = 0;
    const float level = levelPermille_.load(std::memory_order_relaxed) / 1000.0f;
    for (unsigned frame = 0; frame < frames; ++frame) {
        while (triggerIndex < triggerCount && triggers[triggerIndex].frameOffset == frame) {
            const auto& trigger = triggers[triggerIndex++];
            Playback& voice = playback_[trigger.voice];
            if (trigger.voice == 2) playback_[3] = Playback{};
            if (trigger.voice == 3) playback_[2] = Playback{};
            voice.sample = &activeKit_->voices[trigger.voice];
            voice.position = 0;
            voice.gain = trigger.velocity * (trigger.accent ? 1.2f : 1.0f);
        }
        float left = 0.0f, right = 0.0f;
        for (Playback& voice : playback_) {
            if (!voice.sample || voice.position >= voice.sample->left.size()) continue;
            left += voice.sample->left[voice.position] * voice.gain;
            right += voice.sample->right[voice.position] * voice.gain;
            if (++voice.position >= voice.sample->left.size()) voice.sample = nullptr;
        }
        left = std::max(-1.5f, std::min(1.5f, left * level));
        right = std::max(-1.5f, std::min(1.5f, right * level));
        master[0][frame] += left;
        if (masterChannels > 1) master[1][frame] += right;
        if (sourceTap && tapChannels > 0) {
            sourceTap[0][frame] = left;
            if (tapChannels > 1) sourceTap[1][frame] = right;
        }
    }
}

void DrumMachine::collectRetired() const {
    Kit* retired = nullptr;
    while (retiredKits_.pop(retired)) delete retired;
}

Json DrumMachine::patternToJson(const DrumSequencer::Pattern& pattern) {
    Json out = Json::object(); out.set("length", pattern.length);
    Json voices = Json::array();
    for (const auto& voice : pattern.steps) {
        Json row = Json::object(); Json velocities = Json::array(); std::string accents;
        for (size_t step = 0; step < pattern.length; ++step) {
            velocities.push(static_cast<int>(voice[step].velocity));
            accents.push_back(voice[step].accent ? '1' : '0');
        }
        row.set("velocities", std::move(velocities)); row.set("accents", accents); voices.push(std::move(row));
    }
    out.set("voices", std::move(voices)); return out;
}

bool DrumMachine::patternFromJson(const Json& json, DrumSequencer::Pattern& pattern) {
    const unsigned length = static_cast<unsigned>(json["length"].asInt(16));
    if (length != 16 && length != 32 && length != 64) return false;
    pattern = DrumSequencer::Pattern{}; pattern.length = static_cast<uint8_t>(length);
    const Json& voices = json["voices"];
    for (size_t voice = 0; voice < std::min(voices.size(), DrumSequencer::kVoiceCount); ++voice) {
        const Json& velocities = voices.at(voice)["velocities"];
        const std::string accents = voices.at(voice)["accents"].asString();
        for (size_t step = 0; step < std::min<size_t>(velocities.size(), length); ++step) {
            pattern.steps[voice][step].velocity = static_cast<uint8_t>(std::max(0, std::min(127, velocities.at(step).asInt(0))));
            pattern.steps[voice][step].accent = step < accents.size() && accents[step] == '1' ? 1 : 0;
        }
    }
    return true;
}

bool DrumMachine::saveStateUnlocked() const {
    Json root = Json::object(); root.set("schemaVersion", 1); root.set("level", controlLevel_);
    root.set("swing", controlSwing_); root.set("humanization", controlHumanization_); root.set("kitName", kitName_);
    Json variations = Json::array(); for (const auto& variation : program_.variations) variations.push(patternToJson(variation));
    root.set("variations", std::move(variations)); root.set("fill", patternToJson(program_.fill));
    Json song = Json::array();
    for (size_t index = 0; index < program_.songLength; ++index) {
        Json section = Json::object(); section.set("variation", program_.song[index].variation);
        section.set("repeats", program_.song[index].repeats); song.push(std::move(section));
    }
    root.set("song", std::move(song)); Json kit = Json::array();
    for (const Sample& sample : controlKit_.voices) kit.push(sample.file); root.set("kit", std::move(kit));
    return writeFileAtomic(statePath_, root.dump(2));
}

bool DrumMachine::loadStateUnlocked() {
    std::string text;
    if (!readFile(statePath_, text)) return true;
    std::string error; const Json root = Json::parse(text, &error);
    if (!error.empty() || root["schemaVersion"].asInt(0) != 1) return false;
    controlLevel_ = std::max(0.0f, std::min(1.5f, root["level"].asFloat(0.8f)));
    controlSwing_ = clampUnit(root["swing"].asFloat(0.0f));
    controlHumanization_ = clampUnit(root["humanization"].asFloat(0.0f));
    kitName_ = root["kitName"].asString("Custom");
    levelPermille_.store(static_cast<uint32_t>(std::lround(controlLevel_ * 1000.0f)));
    const Json& variations = root["variations"];
    for (size_t index = 0; index < std::min(variations.size(), DrumSequencer::kVariationCount); ++index)
        patternFromJson(variations.at(index), program_.variations[index]);
    patternFromJson(root["fill"], program_.fill);
    const unsigned length = program_.variations[0].length;
    for (auto& variation : program_.variations) variation.length = static_cast<uint8_t>(length);
    program_.fill.length = static_cast<uint8_t>(length);
    const Json& song = root["song"]; program_.songLength = static_cast<uint8_t>(std::min(song.size(), DrumSequencer::kMaxSongSections));
    for (size_t index = 0; index < program_.songLength; ++index) {
        program_.song[index].variation = static_cast<uint8_t>(std::max(0, std::min(3, song.at(index)["variation"].asInt(0))));
        program_.song[index].repeats = static_cast<uint8_t>(std::max(1, std::min(16, song.at(index)["repeats"].asInt(1))));
    }
    const Json& kit = root["kit"];
    for (size_t index = 0; index < std::min(kit.size(), DrumSequencer::kVoiceCount); ++index)
        controlKit_.voices[index].file = kit.at(index).asString();
    return true;
}

Json DrumMachine::state() const {
    std::lock_guard<std::mutex> lock(stateMutex_); collectRetired();
    Json out = Json::object(); out.set("type", "drums"); out.set("available", true);
    out.set("playing", playing_.load(std::memory_order_acquire));
    out.set("kitName", kitName_);
    out.set("level", controlLevel_); out.set("swing", controlSwing_); out.set("humanization", controlHumanization_);
    out.set("length", program_.variations[0].length); out.set("activeVariation", sequencer_.activeVariation());
    out.set("fillActive", sequencer_.fillActive()); out.set("songMode", sequencer_.songMode());
    out.set("activeSongSection", sequencer_.activeSongSection());
    out.set("droppedTriggers", static_cast<int64_t>(sequencer_.droppedTriggers()));
    out.set("droppedKitChanges", static_cast<int64_t>(droppedKitChanges_.load()));
    Json voices = Json::array();
    for (size_t index = 0; index < DrumSequencer::kVoiceCount; ++index) {
        Json voice = Json::object(); voice.set("id", static_cast<int>(index)); voice.set("name", kVoiceNames[index]);
        voice.set("sample", controlKit_.voices[index].file); voice.set("loaded", !controlKit_.voices[index].left.empty());
        voices.push(std::move(voice));
    }
    out.set("voices", std::move(voices));
    Json savedKits = Json::array(); for (const std::string& name : savedKits_) savedKits.push(name);
    out.set("savedKits", std::move(savedKits)); Json variations = Json::array();
    for (const auto& variation : program_.variations) variations.push(patternToJson(variation));
    out.set("variations", std::move(variations)); out.set("fill", patternToJson(program_.fill));
    Json song = Json::array(); for (size_t index = 0; index < program_.songLength; ++index) {
        Json section = Json::object(); section.set("variation", program_.song[index].variation);
        section.set("repeats", program_.song[index].repeats); song.push(std::move(section));
    }
    out.set("song", std::move(song)); return out;
}

bool DrumMachine::decodeWave(const std::string& bytes, unsigned outputRate,
                             Sample& sample, std::string& error) {
    if (bytes.size() < 44 || std::memcmp(bytes.data(), "RIFF", 4) != 0
        || std::memcmp(bytes.data() + 8, "WAVE", 4) != 0) {
        error = "the drum sample is not a valid RIFF/WAV file"; return false;
    }
    const auto* raw = reinterpret_cast<const unsigned char*>(bytes.data());
    uint16_t format = 0, channels = 0, bits = 0; uint32_t rate = 0; size_t dataOffset = 0, dataBytes = 0;
    for (size_t offset = 12; offset + 8 <= bytes.size();) {
        const uint32_t size = u32(raw + offset + 4); const size_t body = offset + 8;
        if (body + size > bytes.size()) break;
        if (std::memcmp(raw + offset, "fmt ", 4) == 0 && size >= 16) {
            format = u16(raw + body); channels = u16(raw + body + 2); rate = u32(raw + body + 4); bits = u16(raw + body + 14);
        } else if (std::memcmp(raw + offset, "data", 4) == 0) { dataOffset = body; dataBytes = size; }
        offset = body + size + (size & 1u);
    }
    if ((format != 1 && format != 3) || channels < 1 || channels > 2 || rate < 8000 || rate > 384000
        || (bits != 16 && bits != 24 && bits != 32) || dataOffset == 0) {
        error = "use mono or stereo PCM/float WAV samples at 16, 24, or 32 bits"; return false;
    }
    const size_t bytesPerSample = bits / 8; const size_t frameBytes = bytesPerSample * channels;
    const size_t sourceFrames = dataBytes / frameBytes;
    if (sourceFrames == 0 || sourceFrames > static_cast<size_t>(rate) * kMaximumSampleSeconds) {
        error = "drum samples must be between one frame and 30 seconds"; return false;
    }
    std::vector<float> left(sourceFrames), right(sourceFrames);
    for (size_t frame = 0; frame < sourceFrames; ++frame) {
        for (unsigned channel = 0; channel < channels; ++channel) {
            const unsigned char* p = raw + dataOffset + frame * frameBytes + channel * bytesPerSample;
            float value = 0.0f;
            if (format == 3 && bits == 32) std::memcpy(&value, p, sizeof(value));
            else if (bits == 16) value = static_cast<int16_t>(u16(p)) / 32768.0f;
            else if (bits == 24) { int32_t v = p[0] | (p[1] << 8) | (p[2] << 16); if (v & 0x800000) v |= ~0xffffff; value = v / 8388608.0f; }
            else { int32_t v = static_cast<int32_t>(u32(p)); value = v / 2147483648.0f; }
            if (!std::isfinite(value)) value = 0.0f;
            value = std::max(-1.0f, std::min(1.0f, value));
            if (channel == 0) left[frame] = value; else right[frame] = value;
        }
        if (channels == 1) right[frame] = left[frame];
    }
    const size_t outputFrames = std::max<size_t>(1, static_cast<size_t>(std::llround(
        static_cast<double>(sourceFrames) * outputRate / rate)));
    sample.left.resize(outputFrames); sample.right.resize(outputFrames);
    for (size_t frame = 0; frame < outputFrames; ++frame) {
        const double source = static_cast<double>(frame) * rate / outputRate;
        const size_t first = std::min(sourceFrames - 1, static_cast<size_t>(source));
        const size_t second = std::min(sourceFrames - 1, first + 1); const float mix = static_cast<float>(source - first);
        sample.left[frame] = left[first] + (left[second] - left[first]) * mix;
        sample.right[frame] = right[first] + (right[second] - right[first]) * mix;
    }
    return true;
}

} // namespace pimfx
