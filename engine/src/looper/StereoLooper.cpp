#include "looper/StereoLooper.h"

#include "core/Paths.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>

namespace pimfx {
namespace {

uint32_t toMilli(float value) {
    return static_cast<uint32_t>(std::lround(std::max(0.0f, std::min(2.0f, value)) * 1000.0f));
}

void writeU16(std::ostream& out, uint16_t value) {
    const char bytes[] = {static_cast<char>(value), static_cast<char>(value >> 8)};
    out.write(bytes, 2);
}

void writeU32(std::ostream& out, uint32_t value) {
    const char bytes[] = {static_cast<char>(value), static_cast<char>(value >> 8),
                          static_cast<char>(value >> 16), static_cast<char>(value >> 24)};
    out.write(bytes, 4);
}

uint16_t readU16(const unsigned char* bytes) {
    return static_cast<uint16_t>(bytes[0]) | static_cast<uint16_t>(bytes[1] << 8);
}

uint32_t readU32(const unsigned char* bytes) {
    return static_cast<uint32_t>(bytes[0]) | (static_cast<uint32_t>(bytes[1]) << 8)
        | (static_cast<uint32_t>(bytes[2]) << 16) | (static_cast<uint32_t>(bytes[3]) << 24);
}

} // namespace

StereoLooper::StereoLooper(std::string root) : root_(std::move(root)) {}

StereoLooper::~StereoLooper() { stop(); }

void StereoLooper::start() {
    if (worker_.joinable()) return;
    {
        std::lock_guard<std::mutex> lock(saveMutex_);
        refreshSavedFilesUnlocked();
    }
    stopping_.store(false, std::memory_order_release);
    worker_ = std::thread(&StereoLooper::worker, this);
}

void StereoLooper::stop() {
    stopping_.store(true, std::memory_order_release);
    saveWake_.notify_all();
    if (worker_.joinable()) worker_.join();
}

void StereoLooper::prepare(unsigned sampleRate, unsigned maximumSeconds) {
    sampleRate_.store(std::max(1u, sampleRate), std::memory_order_release);
    capacityFrames_ = static_cast<size_t>(std::max(1u, sampleRate)) * std::max(1u, maximumSeconds);
    for (auto& buffer : buffers_) buffer.assign(capacityFrames_ * 2, 0.0f);
    audioLoopFrames_ = audioPosition_ = audioWritePosition_ = 0;
    activeBuffer_ = 0;
    workingBuffer_ = 1;
    undoBuffer_ = -1;
    undoAvailable_ = redoAvailable_ = pending_ = false;
    audioMode_ = Mode::Empty;
    for (auto& peak : waveform_) peak.store(0, std::memory_order_relaxed);
    mode_.store(Mode::Empty, std::memory_order_release);
    loopFrames_.store(0, std::memory_order_release);
    position_.store(0, std::memory_order_release);
    canUndo_.store(false, std::memory_order_release);
    canRedo_.store(false, std::memory_order_release);
}

void StereoLooper::configure(const std::string& quantization, bool countIn, float level, float feedback) {
    quantization_.store(quantization == "bar" ? 2 : quantization == "beat" ? 1 : 0,
                        std::memory_order_release);
    countIn_.store(countIn, std::memory_order_release);
    levelMilli_.store(toMilli(level), std::memory_order_release);
    feedbackMilli_.store(toMilli(feedback), std::memory_order_release);
}

bool StereoLooper::enqueue(Action action, std::string& error) {
    if (buffers_[0].empty()) { error = "looper audio buffers are not ready"; return false; }
    if ((saving_.load(std::memory_order_acquire) || loading_.load(std::memory_order_acquire))
        && action != Action::Play && action != Action::Stop) {
        error = "wait for the loop file operation to finish";
        return false;
    }
    std::lock_guard<std::mutex> lock(commandMutex_);
    Command command{action};
    const Mode current = mode_.load(std::memory_order_acquire);
    if (action == Action::Overdub && current != Mode::Overdubbing) {
        const size_t frames = loopFrames_.load(std::memory_order_acquire);
        if (frames == 0 || (current != Mode::Playing && current != Mode::Stopped)) {
            error = "record a loop before overdubbing";
            return false;
        }
        const int active = publishedActiveBuffer_.load(std::memory_order_acquire);
        command.preparedBuffer = 1 - active;
        std::copy_n(buffers_[active].data(), frames * 2, buffers_[command.preparedBuffer].data());
    }
    if (!commands_.push(command)) {
        error = "looper command queue is full";
        return false;
    }
    return true;
}

bool StereoLooper::save(const std::string& name, std::string& error) {
    if (loading_.load(std::memory_order_acquire)) {
        error = "wait for the saved loop to finish loading";
        return false;
    }
    const Mode current = mode_.load(std::memory_order_acquire);
    if (current == Mode::Empty || loopFrames_.load(std::memory_order_acquire) == 0) {
        error = "record a loop before saving";
        return false;
    }
    if (current == Mode::Recording || current == Mode::Overdubbing || current == Mode::Armed) {
        error = "stop recording before saving";
        return false;
    }
    bool expected = false;
    if (!saving_.compare_exchange_strong(expected, true, std::memory_order_acq_rel)) {
        error = "a loop save is already running";
        return false;
    }
    std::string safe = sanitizeFileName(name.empty() ? "loop" : name);
    if (safe.empty()) safe = "loop";
    if (safe.size() < 4 || safe.substr(safe.size() - 4) != ".wav") safe += ".wav";
    {
        std::lock_guard<std::mutex> lock(saveMutex_);
        pendingSaveName_ = safe;
        saveError_.clear();
    }
    saveWake_.notify_one();
    return true;
}

bool StereoLooper::safeSavedName(const std::string& name, std::string& safe) const {
    safe = sanitizeFileName(fileName(name));
    if (safe.empty()) return false;
    if (safe.size() < 4 || safe.substr(safe.size() - 4) != ".wav") safe += ".wav";
    return safe == fileName(safe);
}

bool StereoLooper::load(const std::string& name, std::string& error) {
    const Mode current = mode_.load(std::memory_order_acquire);
    if (current == Mode::Recording || current == Mode::Armed || current == Mode::Overdubbing) {
        error = "finish recording or overdubbing before loading a saved loop";
        return false;
    }
    if (saving_.load(std::memory_order_acquire) || loading_.load(std::memory_order_acquire)) {
        error = "wait for the loop file operation to finish";
        return false;
    }
    std::string safe;
    if (!safeSavedName(name, safe)) { error = "that loop name cannot be used"; return false; }
    std::lock_guard<std::mutex> lock(commandMutex_);
    loadReady_.store(false, std::memory_order_release);
    loading_.store(true, std::memory_order_release);
    const int target = 1 - publishedActiveBuffer_.load(std::memory_order_acquire);
    size_t frames = 0;
    const std::string path = joinPath(root_, safe);
    if (!readWaveFile(path, target, frames, error)) {
        loading_.store(false, std::memory_order_release);
        return false;
    }
    if (!commands_.push(Command{Action::LoadPrepared, target, frames})) {
        error = "looper command queue is full";
        loading_.store(false, std::memory_order_release);
        return false;
    }
    {
        std::lock_guard<std::mutex> saveLock(saveMutex_);
        savedPath_ = path;
        saveError_.clear();
    }
    loadReady_.store(true, std::memory_order_release);
    return true;
}

bool StereoLooper::renameSaved(const std::string& name, const std::string& nextName, std::string& error) {
    if (saving_.load(std::memory_order_acquire) || loading_.load(std::memory_order_acquire)) {
        error = "wait for the loop file operation to finish";
        return false;
    }
    std::string from;
    std::string to;
    if (!safeSavedName(name, from) || !safeSavedName(nextName, to)) {
        error = "that loop name cannot be used";
        return false;
    }
    const std::string fromPath = joinPath(root_, from);
    const std::string toPath = joinPath(root_, to);
    if (!fileExists(fromPath)) { error = "saved loop not found"; return false; }
    if (fileExists(toPath)) { error = "a saved loop already has that name"; return false; }
    std::error_code ec;
    std::filesystem::rename(fromPath, toPath, ec);
    if (ec) { error = "could not rename the saved loop"; return false; }
    std::lock_guard<std::mutex> lock(saveMutex_);
    if (savedPath_ == fromPath) savedPath_ = toPath;
    refreshSavedFilesUnlocked();
    return true;
}

bool StereoLooper::deleteSaved(const std::string& name, std::string& error) {
    if (saving_.load(std::memory_order_acquire) || loading_.load(std::memory_order_acquire)) {
        error = "wait for the loop file operation to finish";
        return false;
    }
    std::string safe;
    if (!safeSavedName(name, safe)) { error = "that loop name cannot be used"; return false; }
    const std::string path = joinPath(root_, safe);
    std::error_code ec;
    if (!std::filesystem::remove(path, ec) || ec) { error = "could not delete the saved loop"; return false; }
    std::lock_guard<std::mutex> lock(saveMutex_);
    if (savedPath_ == path) savedPath_.clear();
    refreshSavedFilesUnlocked();
    return true;
}

bool StereoLooper::wantsTransport() const noexcept {
    return quantization_.load(std::memory_order_relaxed) != 0
        || countIn_.load(std::memory_order_relaxed);
}

const char* StereoLooper::modeName(Mode mode) noexcept {
    switch (mode) {
        case Mode::Empty: return "empty";
        case Mode::Armed: return "armed";
        case Mode::Recording: return "recording";
        case Mode::Playing: return "playing";
        case Mode::Overdubbing: return "overdubbing";
        case Mode::Stopped: return "stopped";
    }
    return "empty";
}

int64_t StereoLooper::boundaryFrame(const TransportBlock* transport, bool strictlyNext) const noexcept {
    if (transport && countIn_.load(std::memory_order_relaxed) && transport->timelineFrame < 0) return 0;
    if (!transport || !transport->playing || quantization_.load(std::memory_order_relaxed) == 0) {
        return transport ? transport->timelineFrame : 0;
    }
    double interval = transport->framesPerBeat;
    if (quantization_.load(std::memory_order_relaxed) == 2) interval *= transport->beatsPerBar;
    const double now = static_cast<double>(transport->timelineFrame);
    double multiple = std::ceil(now / interval);
    if (strictlyNext && multiple * interval <= now + 0.5) multiple += 1.0;
    return static_cast<int64_t>(std::llround(multiple * interval));
}

void StereoLooper::receiveCommand(const Command& command, const TransportBlock* transport) noexcept {
    const Action action = command.action;
    const Mode current = audioMode_;
    if ((action == Action::Stop || action == Action::Finish) && pending_) pending_ = false;
    if (action == Action::Clear || action == Action::LoadPrepared) {
        beginAction(action, command.preparedBuffer, command.preparedFrames);
        return;
    }
    if (action == Action::Record && current != Mode::Empty) return;
    if ((action == Action::Play || action == Action::Overdub) && audioLoopFrames_ == 0) return;
    if (action == Action::Undo && !undoAvailable_) return;
    if (action == Action::Redo && !redoAvailable_) return;
    if (action == Action::Finish && current != Mode::Recording && current != Mode::Armed) return;

    const bool quantized = quantization_.load(std::memory_order_relaxed) != 0;
    const bool countingIn = action == Action::Record && countIn_.load(std::memory_order_relaxed)
        && transport && transport->timelineFrame < 0;
    const bool shouldSchedule = countingIn || (quantized && (action == Action::Record || action == Action::Overdub
        || ((action == Action::Stop || action == Action::Finish)
            && (current == Mode::Recording || current == Mode::Overdubbing))));
    if (shouldSchedule) {
        pending_ = true;
        pendingAction_ = action;
        pendingPreparedBuffer_ = command.preparedBuffer;
        pendingFrame_ = boundaryFrame(transport, action == Action::Stop);
        if (action == Action::Record) {
            audioMode_ = Mode::Armed;
            mode_.store(Mode::Armed, std::memory_order_release);
        }
        return;
    }
    beginAction(action, command.preparedBuffer);
}

void StereoLooper::beginAction(Action action, int preparedBuffer, size_t preparedFrames) noexcept {
    switch (action) {
        case Action::Record:
            for (auto& peak : waveform_) peak.store(0, std::memory_order_relaxed);
            workingBuffer_ = 0;
            audioWritePosition_ = 0;
            audioPosition_ = 0;
            undoBuffer_ = -1;
            undoAvailable_ = redoAvailable_ = false;
            audioMode_ = Mode::Recording;
            break;
        case Action::Play:
            audioPosition_ = audioPosition_ < audioLoopFrames_ ? audioPosition_ : 0;
            audioMode_ = Mode::Playing;
            break;
        case Action::Finish:
            if (audioMode_ == Mode::Recording) finishRecording();
            else if (audioMode_ == Mode::Armed) audioMode_ = Mode::Empty;
            break;
        case Action::Overdub:
            if (audioMode_ == Mode::Overdubbing) {
                audioMode_ = Mode::Playing;
            } else if (preparedBuffer >= 0) {
                undoBuffer_ = preparedBuffer;
                undoAvailable_ = true;
                redoAvailable_ = false;
                audioMode_ = Mode::Overdubbing;
            }
            break;
        case Action::Stop:
            if (audioMode_ == Mode::Recording || (audioMode_ == Mode::Armed && audioLoopFrames_ == 0)) {
                finishRecording();
            }
            audioMode_ = audioLoopFrames_ ? Mode::Stopped : Mode::Empty;
            break;
        case Action::Restart:
            if (audioLoopFrames_ > 0) {
                audioPosition_ = 0;
                audioMode_ = Mode::Playing;
            }
            break;
        case Action::Mute:
            muted_.store(!muted_.load(std::memory_order_relaxed), std::memory_order_relaxed);
            break;
        case Action::Undo:
            if (undoAvailable_ && undoBuffer_ >= 0) {
                std::swap(activeBuffer_, undoBuffer_);
                undoAvailable_ = false;
                redoAvailable_ = true;
                if (audioMode_ == Mode::Overdubbing) audioMode_ = Mode::Playing;
                audioPosition_ %= std::max<size_t>(1, audioLoopFrames_);
            }
            break;
        case Action::Redo:
            if (redoAvailable_ && undoBuffer_ >= 0) {
                std::swap(activeBuffer_, undoBuffer_);
                undoAvailable_ = true;
                redoAvailable_ = false;
                audioPosition_ %= std::max<size_t>(1, audioLoopFrames_);
            }
            break;
        case Action::Clear:
            audioLoopFrames_ = audioPosition_ = audioWritePosition_ = 0;
            undoBuffer_ = -1;
            undoAvailable_ = redoAvailable_ = pending_ = false;
            audioMode_ = Mode::Empty;
            muted_.store(false, std::memory_order_relaxed);
            break;
        case Action::LoadPrepared:
            if (preparedBuffer >= 0 && preparedFrames > 0) {
                activeBuffer_ = preparedBuffer;
                audioLoopFrames_ = preparedFrames;
                audioPosition_ = 0;
                undoBuffer_ = -1;
                undoAvailable_ = redoAvailable_ = pending_ = false;
                muted_.store(false, std::memory_order_relaxed);
                audioMode_ = Mode::Stopped;
            }
            loadReady_.store(false, std::memory_order_release);
            loading_.store(false, std::memory_order_release);
            break;
    }
    mode_.store(audioMode_, std::memory_order_release);
    publishedActiveBuffer_.store(activeBuffer_, std::memory_order_release);
    loopFrames_.store(audioLoopFrames_, std::memory_order_release);
    position_.store(audioMode_ == Mode::Recording ? audioWritePosition_ : audioPosition_,
                    std::memory_order_release);
    canUndo_.store(undoAvailable_, std::memory_order_release);
    canRedo_.store(redoAvailable_, std::memory_order_release);
}

void StereoLooper::finishRecording() noexcept {
    if (audioWritePosition_ == 0) return;
    activeBuffer_ = workingBuffer_;
    audioLoopFrames_ = audioWritePosition_;
    audioPosition_ = 0;
    audioMode_ = Mode::Playing;
}

void StereoLooper::process(const float* const* input, unsigned inputChannels,
                           float* const* output, unsigned outputChannels, unsigned frames,
                           const TransportBlock* transport) noexcept {
    Command command;
    if (!loading_.load(std::memory_order_acquire) || loadReady_.load(std::memory_order_acquire)) {
        while (commands_.pop(command)) receiveCommand(command, transport);
    }

    const float level = levelMilli_.load(std::memory_order_relaxed) / 1000.0f;
    const float feedback = feedbackMilli_.load(std::memory_order_relaxed) / 1000.0f;
    const unsigned rate = sampleRate_.load(std::memory_order_relaxed);
    for (unsigned frame = 0; frame < frames; ++frame) {
        const int64_t timeline = transport ? transport->timelineFrame + static_cast<int64_t>(frame) : frame;
        if (pending_ && timeline >= pendingFrame_) {
            pending_ = false;
            beginAction(pendingAction_, pendingPreparedBuffer_);
        }

        const float inLeft = inputChannels > 0 ? input[0][frame] : 0.0f;
        const float inRight = inputChannels > 1 ? input[1][frame] : inLeft;

        if (audioMode_ == Mode::Recording) {
            if (audioWritePosition_ < capacityFrames_) {
                const size_t index = audioWritePosition_ * 2;
                buffers_[workingBuffer_][index] = inLeft;
                buffers_[workingBuffer_][index + 1] = inRight;
                const size_t bucketFrames = std::max<size_t>(1, rate / 2);
                const size_t bucket = std::min(waveform_.size() - 1, audioWritePosition_ / bucketFrames);
                const uint16_t peak = static_cast<uint16_t>(std::min(1000.0f,
                    std::max(std::abs(inLeft), std::abs(inRight)) * 1000.0f));
                if (peak > waveform_[bucket].load(std::memory_order_relaxed)) {
                    waveform_[bucket].store(peak, std::memory_order_relaxed);
                }
                ++audioWritePosition_;
            }
            if (audioWritePosition_ >= capacityFrames_) finishRecording();
        }

        if (audioLoopFrames_ > 0 && (audioMode_ == Mode::Playing || audioMode_ == Mode::Overdubbing)) {
            const size_t index = audioPosition_ * 2;
            const float loopLeft = buffers_[activeBuffer_][index];
            const float loopRight = buffers_[activeBuffer_][index + 1];
            float playLeft = loopLeft;
            float playRight = loopRight;
            const size_t fadeFrames = std::min(audioLoopFrames_ / 2,
                static_cast<size_t>(std::max(1u, rate / 200))); // 5 ms seam crossfade
            if (audioMode_ == Mode::Playing && fadeFrames > 1
                && audioPosition_ >= audioLoopFrames_ - fadeFrames) {
                const size_t headFrame = audioPosition_ - (audioLoopFrames_ - fadeFrames);
                const float mix = static_cast<float>(headFrame) / static_cast<float>(fadeFrames - 1);
                playLeft = loopLeft * (1.0f - mix) + buffers_[activeBuffer_][headFrame * 2] * mix;
                playRight = loopRight * (1.0f - mix) + buffers_[activeBuffer_][headFrame * 2 + 1] * mix;
            }
            if (!muted_.load(std::memory_order_relaxed)) {
                if (outputChannels > 0) output[0][frame] += playLeft * level;
                if (outputChannels > 1) output[1][frame] += playRight * level;
            }
            if (audioMode_ == Mode::Overdubbing) {
                buffers_[activeBuffer_][index] = loopLeft * feedback + inLeft;
                buffers_[activeBuffer_][index + 1] = loopRight * feedback + inRight;
            }
            audioPosition_ = (audioPosition_ + 1) % audioLoopFrames_;
        }
    }
    mode_.store(audioMode_, std::memory_order_release);
    publishedActiveBuffer_.store(activeBuffer_, std::memory_order_release);
    loopFrames_.store(audioLoopFrames_, std::memory_order_release);
    position_.store(audioMode_ == Mode::Recording ? audioWritePosition_ : audioPosition_,
                    std::memory_order_release);
    canUndo_.store(undoAvailable_, std::memory_order_release);
    canRedo_.store(redoAvailable_, std::memory_order_release);
}

Json StereoLooper::state() const {
    Json out = Json::object();
    out.set("type", "looper");
    const Mode current = mode_.load(std::memory_order_acquire);
    const size_t frames = loopFrames_.load(std::memory_order_acquire);
    const size_t currentPosition = position_.load(std::memory_order_acquire);
    const size_t visibleFrames = current == Mode::Recording ? currentPosition : frames;
    const unsigned rate = sampleRate_.load(std::memory_order_acquire);
    out.set("status", saving_.load(std::memory_order_acquire) ? "saving"
        : loading_.load(std::memory_order_acquire) ? "loading" : modeName(current));
    out.set("hasLoop", frames > 0);
    out.set("duration", static_cast<double>(visibleFrames) / std::max(1u, rate));
    out.set("position", static_cast<double>(currentPosition) / std::max(1u, rate));
    out.set("remainingSeconds", static_cast<double>(capacityFrames_ - std::min(capacityFrames_, visibleFrames))
        / std::max(1u, rate));
    out.set("canUndo", canUndo_.load(std::memory_order_acquire));
    out.set("canRedo", canRedo_.load(std::memory_order_acquire));
    out.set("muted", muted_.load(std::memory_order_acquire));
    out.set("quantization", quantization_.load() == 2 ? "bar" : quantization_.load() == 1 ? "beat" : "free");
    out.set("countIn", countIn_.load());
    out.set("level", levelMilli_.load() / 1000.0);
    out.set("feedback", feedbackMilli_.load() / 1000.0);
    out.set("maximumSeconds", capacityFrames_ / static_cast<double>(std::max(1u, rate)));
    Json peaks = Json::array();
    if (frames > 0 && current != Mode::Recording) {
        const size_t buckets = std::min(waveform_.size(),
            std::max<size_t>(1, (frames + std::max<size_t>(1, rate / 2) - 1) / std::max<size_t>(1, rate / 2)));
        for (size_t i = 0; i < buckets; ++i) {
            peaks.push(waveform_[i].load(std::memory_order_relaxed) / 1000.0);
        }
    }
    out.set("waveform", peaks);
    {
        std::lock_guard<std::mutex> lock(saveMutex_);
        out.set("savedPath", savedPath_);
        out.set("saveError", saveError_);
        Json files = Json::array();
        for (const std::string& file : savedFiles_) files.push(file);
        out.set("savedLoops", files);
    }
    return out;
}

std::string StereoLooper::savedPath() const {
    std::lock_guard<std::mutex> lock(saveMutex_);
    return savedPath_;
}

bool StereoLooper::writeWaveFile(const std::string& path, int buffer, size_t frames, std::string& error) const {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out) { error = "could not create the loop file"; return false; }
    const uint32_t dataBytes = static_cast<uint32_t>(frames * 2 * sizeof(int16_t));
    out.write("RIFF", 4); writeU32(out, 36 + dataBytes); out.write("WAVEfmt ", 8);
    writeU32(out, 16); writeU16(out, 1); writeU16(out, 2);
    const uint32_t rate = sampleRate_.load(std::memory_order_acquire);
    writeU32(out, rate); writeU32(out, rate * 4); writeU16(out, 4); writeU16(out, 16);
    out.write("data", 4); writeU32(out, dataBytes);
    for (size_t i = 0; i < frames * 2; ++i) {
        const float value = std::max(-1.0f, std::min(1.0f, buffers_[buffer][i]));
        writeU16(out, static_cast<uint16_t>(static_cast<int16_t>(std::lround(value * 32767.0f))));
    }
    out.flush();
    if (!out) { error = "could not finish writing the loop file"; return false; }
    return true;
}

bool StereoLooper::readWaveFile(const std::string& path, int buffer, size_t& frames, std::string& error) {
    std::ifstream in(path, std::ios::binary);
    std::array<unsigned char, 44> header{};
    if (!in.read(reinterpret_cast<char*>(header.data()), header.size())) {
        error = "could not read the saved loop";
        return false;
    }
    if (std::memcmp(header.data(), "RIFF", 4) != 0
        || std::memcmp(header.data() + 8, "WAVEfmt ", 8) != 0
        || std::memcmp(header.data() + 36, "data", 4) != 0
        || readU16(header.data() + 20) != 1
        || readU16(header.data() + 22) != 2
        || readU16(header.data() + 34) != 16) {
        error = "the saved loop is not a supported stereo PCM WAV";
        return false;
    }
    if (readU32(header.data() + 24) != sampleRate_.load(std::memory_order_acquire)) {
        error = "the saved loop sample rate does not match the current audio rate";
        return false;
    }
    const uint32_t dataBytes = readU32(header.data() + 40);
    frames = dataBytes / 4;
    if (frames == 0 || frames > capacityFrames_ || dataBytes % 4 != 0) {
        error = "the saved loop is empty or longer than the current loop capacity";
        return false;
    }
    for (auto& peak : waveform_) peak.store(0, std::memory_order_relaxed);
    std::array<int16_t, 4096> samples{};
    size_t offset = 0;
    while (offset < frames * 2) {
        const size_t count = std::min(samples.size(), frames * 2 - offset);
        if (!in.read(reinterpret_cast<char*>(samples.data()), static_cast<std::streamsize>(count * sizeof(int16_t)))) {
            error = "the saved loop ended unexpectedly";
            return false;
        }
        for (size_t i = 0; i < count; ++i) {
            buffers_[buffer][offset + i] = samples[i] / 32768.0f;
            const size_t frame = (offset + i) / 2;
            const size_t bucketFrames = std::max<size_t>(1, sampleRate_.load(std::memory_order_relaxed) / 2);
            const size_t bucket = std::min(waveform_.size() - 1, frame / bucketFrames);
            const uint16_t peak = static_cast<uint16_t>(std::min(1000.0f, std::abs(samples[i] / 32.768f)));
            if (peak > waveform_[bucket].load(std::memory_order_relaxed)) waveform_[bucket].store(peak);
        }
        offset += count;
    }
    return true;
}

void StereoLooper::refreshSavedFilesUnlocked() {
    savedFiles_.clear();
    for (const std::string& path : listDirectory(root_, ".wav")) savedFiles_.push_back(fileName(path));
    std::sort(savedFiles_.begin(), savedFiles_.end());
}

void StereoLooper::worker() {
    while (!stopping_.load(std::memory_order_acquire)) {
        std::string name;
        {
            std::unique_lock<std::mutex> lock(saveMutex_);
            saveWake_.wait_for(lock, std::chrono::milliseconds(100), [&] {
                return stopping_.load(std::memory_order_acquire) || !pendingSaveName_.empty();
            });
            if (stopping_.load(std::memory_order_acquire)) break;
            name.swap(pendingSaveName_);
        }
        if (name.empty()) continue;
        makeDirectories(root_);
        std::string finalPath = joinPath(root_, name);
        if (fileExists(finalPath)) {
            const std::string stem = fileStem(name);
            for (int copy = 2; copy < 10000 && fileExists(finalPath); ++copy) {
                finalPath = joinPath(root_, stem + "-" + std::to_string(copy) + ".wav");
            }
        }
        const std::string temporary = finalPath + ".partial";
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
        const int buffer = publishedActiveBuffer_.load(std::memory_order_acquire);
        const size_t frames = loopFrames_.load(std::memory_order_acquire);
        std::string error;
        const bool wrote = writeWaveFile(temporary, buffer, frames, error);
        if (wrote) {
            std::error_code ec;
            std::filesystem::rename(temporary, finalPath, ec);
            if (ec) error = "could not finalize the loop file";
        }
        if (!error.empty()) {
            std::error_code ignored;
            std::filesystem::remove(temporary, ignored);
        }
        {
            std::lock_guard<std::mutex> lock(saveMutex_);
            saveError_ = error;
            if (error.empty()) savedPath_ = finalPath;
            refreshSavedFilesUnlocked();
        }
        saving_.store(false, std::memory_order_release);
    }
}

} // namespace pimfx
