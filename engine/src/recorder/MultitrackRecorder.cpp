#include "recorder/MultitrackRecorder.h"

#include "core/Paths.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <limits>

namespace fs = std::filesystem;

namespace pimfx {
namespace {

void putU16(std::ostream& out, uint16_t value) {
    const char bytes[2] = {static_cast<char>(value), static_cast<char>(value >> 8)};
    out.write(bytes, 2);
}

void putU32(std::ostream& out, uint32_t value) {
    const char bytes[4] = {static_cast<char>(value), static_cast<char>(value >> 8),
        static_cast<char>(value >> 16), static_cast<char>(value >> 24)};
    out.write(bytes, 4);
}

uint32_t sourceBit(MultitrackRecorder::Source source) {
    return 1u << static_cast<unsigned>(source);
}

float clampSample(float value) {
    return std::max(-1.0f, std::min(1.0f, value));
}

} // namespace

MultitrackRecorder::MultitrackRecorder(std::string root) : root_(std::move(root)) {
    availableMask_.store(sourceBit(Source::Raw) | sourceBit(Source::Processed)
        | sourceBit(Source::Master), std::memory_order_relaxed);
}

MultitrackRecorder::~MultitrackRecorder() { stop(); }

const char* MultitrackRecorder::sourceName(Source source) noexcept {
    switch (source) {
    case Source::Raw: return "raw";
    case Source::Processed: return "processed";
    case Source::Backing: return "backing";
    case Source::Drum: return "drum";
    case Source::Master: return "master";
    default: return "unknown";
    }
}

bool MultitrackRecorder::parseSource(const std::string& text, Source& source) noexcept {
    for (unsigned i = 0; i < static_cast<unsigned>(Source::Count); ++i) {
        const Source candidate = static_cast<Source>(i);
        if (text == sourceName(candidate)) { source = candidate; return true; }
    }
    return false;
}

std::string MultitrackRecorder::uniqueId(const char* prefix) {
    static std::atomic<uint64_t> counter{0};
    const auto now = std::chrono::steady_clock::now().time_since_epoch().count();
    return std::string(prefix) + "-" + std::to_string(now) + "-" + std::to_string(counter.fetch_add(1));
}

void MultitrackRecorder::start() {
    if (worker_.joinable()) return;
    makeDirectories(root_);
    recoverInterruptedProjects();
    {
        std::lock_guard<std::mutex> lock(stateMutex_);
        refreshProjectsUnlocked();
    }
    stopping_.store(false, std::memory_order_release);
    worker_ = std::thread(&MultitrackRecorder::worker, this);
}

void MultitrackRecorder::stop() {
    recording_.store(false, std::memory_order_release);
    finalizing_.store(true, std::memory_order_release);
    stopping_.store(true, std::memory_order_release);
    wake_.notify_all();
    if (worker_.joinable()) worker_.join();
    std::lock_guard<std::mutex> lock(stateMutex_);
    if (!activeFiles_.empty()) finalizeRecordingUnlocked();
}

void MultitrackRecorder::prepare(unsigned sampleRate, unsigned maximumFrames) {
    sampleRate_.store(std::max(1u, sampleRate), std::memory_order_release);
    maxFrames_ = std::max(1u, maximumFrames);
    ring_.clear();
    ring_.resize(kRingBlocks);
    for (RingBlock& block : ring_) block.samples.assign(kSourceCount * 2 * maxFrames_, 0.0f);
    writeBlock_.store(0, std::memory_order_relaxed);
    readBlock_.store(0, std::memory_order_relaxed);
    playbackBlockFrames_ = std::max(4096u, maxFrames_);
    playbackRing_.clear();
    playbackRing_.resize(kPlaybackRingBlocks);
    for (RingBlock& block : playbackRing_) block.samples.assign(2 * playbackBlockFrames_, 0.0f);
    requestPlaybackReset(0);
}

void MultitrackRecorder::setSourceAvailable(Source source, bool available) noexcept {
    const uint32_t bit = sourceBit(source);
    if (available) availableMask_.fetch_or(bit, std::memory_order_release);
    else availableMask_.fetch_and(~bit, std::memory_order_release);
}

bool MultitrackRecorder::beginCapture(unsigned frames, int64_t timelineFrame) noexcept {
    currentBlock_ = nullptr;
    currentMask_ = 0;
    if (!recording_.load(std::memory_order_acquire) || ring_.empty() || frames > maxFrames_) return false;
    const size_t write = writeBlock_.load(std::memory_order_relaxed);
    const size_t next = (write + 1) % ring_.size();
    if (next == readBlock_.load(std::memory_order_acquire)) {
        droppedBlocks_.fetch_add(1, std::memory_order_relaxed);
        return false;
    }
    currentBlock_ = &ring_[write];
    currentBlock_->frames = frames;
    currentBlock_->timelineFrame = timelineFrame;
    currentBlock_->mask = 0;
    return true;
}

void MultitrackRecorder::captureSource(Source source, const float* const* input,
                                       unsigned channels, unsigned frames) noexcept {
    const uint32_t bit = sourceBit(source);
    if (!currentBlock_ || !(armedMask_.load(std::memory_order_relaxed) & bit)
        || !input || channels == 0 || frames != currentBlock_->frames) return;
    const size_t base = static_cast<size_t>(source) * 2 * maxFrames_;
    for (unsigned frame = 0; frame < frames; ++frame) {
        currentBlock_->samples[base + frame] = input[0][frame];
        currentBlock_->samples[base + maxFrames_ + frame] = input[std::min(1u, channels - 1)][frame];
    }
    currentMask_ |= bit;
}

void MultitrackRecorder::finishCapture() noexcept {
    if (!currentBlock_) return;
    currentBlock_->mask = currentMask_;
    const size_t write = writeBlock_.load(std::memory_order_relaxed);
    writeBlock_.store((write + 1) % ring_.size(), std::memory_order_release);
    currentBlock_ = nullptr;
}

void MultitrackRecorder::requestPlaybackReset(int64_t frame) noexcept {
    playbackResetting_.store(true, std::memory_order_release);
    requestedPlaybackFrame_.store(std::max<int64_t>(0, frame), std::memory_order_relaxed);
    playbackEof_.store(false, std::memory_order_relaxed);
    playbackGeneration_.fetch_add(1, std::memory_order_release);
}

void MultitrackRecorder::renderPlayback(float* const* output, unsigned channels, unsigned frames) noexcept {
    const uint32_t generation = playbackGeneration_.load(std::memory_order_acquire);
    if (generation != realtimePlaybackGeneration_) {
        realtimePlaybackGeneration_ = generation;
        realtimePlaybackOffset_ = 0;
        playbackReadBlock_.store(0, std::memory_order_relaxed);
        playbackPositionFrame_.store(requestedPlaybackFrame_.load(std::memory_order_relaxed), std::memory_order_relaxed);
        playbackAcknowledgedGeneration_.store(generation, std::memory_order_release);
    }
    if (playbackResetting_.load(std::memory_order_acquire)
        || !playbackPlaying_.load(std::memory_order_relaxed) || channels == 0) return;

    unsigned rendered = 0;
    while (rendered < frames) {
        size_t read = playbackReadBlock_.load(std::memory_order_relaxed);
        if (read == playbackWriteBlock_.load(std::memory_order_acquire)) {
            if (playbackEof_.load(std::memory_order_acquire)) {
                playbackPlaying_.store(false, std::memory_order_release);
                playbackPaused_.store(false, std::memory_order_release);
            } else if (rendered == 0) {
                playbackUnderruns_.fetch_add(1, std::memory_order_relaxed);
            }
            return;
        }
        RingBlock& block = playbackRing_[read];
        const unsigned available = block.frames - static_cast<unsigned>(realtimePlaybackOffset_);
        const unsigned count = std::min(frames - rendered, available);
        for (unsigned frame = 0; frame < count; ++frame) {
            const size_t source = realtimePlaybackOffset_ + frame;
            output[0][rendered + frame] += block.samples[source];
            if (channels > 1) output[1][rendered + frame] += block.samples[playbackBlockFrames_ + source];
        }
        rendered += count;
        realtimePlaybackOffset_ += count;
        playbackPositionFrame_.fetch_add(count, std::memory_order_relaxed);
        if (realtimePlaybackOffset_ >= block.frames) {
            realtimePlaybackOffset_ = 0;
            playbackReadBlock_.store((read + 1) % playbackRing_.size(), std::memory_order_release);
        }
    }
}

void MultitrackRecorder::writeWaveHeader(std::ostream& out, unsigned sampleRate, uint32_t frames) {
    const uint32_t bytes = frames * 4;
    out.write("RIFF", 4); putU32(out, 36 + bytes); out.write("WAVEfmt ", 8);
    putU32(out, 16); putU16(out, 1); putU16(out, 2);
    putU32(out, sampleRate); putU32(out, sampleRate * 4); putU16(out, 4); putU16(out, 16);
    out.write("data", 4); putU32(out, bytes);
}

bool MultitrackRecorder::patchWaveHeader(const std::string& path, unsigned sampleRate, uint64_t frames) {
    if (frames > (std::numeric_limits<uint32_t>::max() - 36u) / 4u) return false;
    std::fstream stream(path, std::ios::binary | std::ios::in | std::ios::out);
    if (!stream) return false;
    writeWaveHeader(stream, sampleRate, static_cast<uint32_t>(frames));
    stream.flush();
    return static_cast<bool>(stream);
}

bool MultitrackRecorder::createProject(const std::string& requested, std::string& error) {
    if (recording() || finalizing_.load()) { error = "stop recording before changing projects"; return false; }
    const std::string name = sanitizeFileName(requested.empty() ? "Recording" : requested);
    std::string id = name;
    for (int copy = 2; fs::exists(joinPath(root_, id)); ++copy) id = name + "-" + std::to_string(copy);
    if (!makeDirectories(joinPath(joinPath(root_, id), "audio"))
        || !makeDirectories(joinPath(joinPath(root_, id), "exports"))) {
        error = "could not create the recording project"; return false;
    }
    playbackPlaying_.store(false, std::memory_order_release);
    playbackPaused_.store(false, std::memory_order_release);
    requestPlaybackReset(0);
    std::lock_guard<std::mutex> lock(stateMutex_);
    projectId_ = id; projectName_ = name; tracks_.clear(); lastError_.clear(); warning_.clear();
    Track input;
    input.id = uniqueId("track");
    input.name = "Processed Input";
    input.source = Source::Processed;
    input.armed = true;
    tracks_.push_back(std::move(input));
    saveProjectUnlocked(); refreshProjectsUnlocked();
    return true;
}

bool MultitrackRecorder::openProject(const std::string& id, std::string& error) {
    if (recording() || finalizing_.load()) { error = "stop recording before changing projects"; return false; }
    const std::string safe = sanitizeFileName(id);
    if (safe != id) { error = "invalid project name"; return false; }
    std::string contents;
    if (!readFile(joinPath(joinPath(root_, safe), "project.json"), contents)) {
        error = "recording project was not found"; return false;
    }
    std::string parseError;
    const Json json = Json::parse(contents, &parseError);
    if (!parseError.empty() || json["format"].asString() != "pimfx-recording-project") {
        error = "recording project is invalid"; return false;
    }
    std::vector<Track> loaded;
    for (const Json& item : json["tracks"].items()) {
        Source source;
        if (!parseSource(item["source"].asString(), source)) continue;
        Track track;
        track.id = item["id"].asString(); track.name = item["name"].asString(); track.source = source;
        track.armed = item["armed"].asBool(); track.muted = item["muted"].asBool();
        track.solo = item["solo"].asBool(); track.level = item["level"].asFloat(1.0f);
        track.pan = item["pan"].asFloat();
        for (const Json& raw : item["clips"].items()) {
            Clip clip;
            clip.id = raw["id"].asString(); clip.file = raw["file"].asString();
            clip.start = raw["start"].asInt64(); clip.offset = raw["offset"].asInt64();
            clip.length = raw["length"].asInt64(); clip.fadeIn = raw["fadeIn"].asInt64();
            clip.fadeOut = raw["fadeOut"].asInt64();
            if (!clip.id.empty() && !clip.file.empty() && clip.length > 0) track.clips.push_back(std::move(clip));
        }
        if (!track.id.empty()) loaded.push_back(std::move(track));
    }
    bool importedRecovery = false;
    std::string recoveredText;
    const std::string recoveredPath = joinPath(joinPath(root_, safe), "recovered.json");
    if (readFile(recoveredPath, recoveredText)) {
        std::string recoveredError;
        const Json recovered = Json::parse(recoveredText, &recoveredError);
        if (recoveredError.empty() && recovered["format"].asString() == "pimfx-recorder-recovery") {
            for (const Json& item : recovered["files"].items()) {
                const std::string trackId = item["trackId"].asString();
                for (Track& track : loaded) if (track.id == trackId) {
                    Clip clip; clip.id = uniqueId("recovered");
                    clip.file = sanitizeFileName(item["file"].asString());
                    clip.start = std::max<int64_t>(0, item["start"].asInt64());
                    clip.length = std::max<int64_t>(0, item["frames"].asInt64());
                    if (clip.length > 0) { track.clips.push_back(std::move(clip)); importedRecovery = true; }
                }
            }
        }
    }
    playbackPlaying_.store(false, std::memory_order_release);
    playbackPaused_.store(false, std::memory_order_release);
    requestPlaybackReset(0);
    std::lock_guard<std::mutex> lock(stateMutex_);
    projectId_ = safe; projectName_ = json["name"].asString(safe); tracks_ = std::move(loaded);
    lastError_.clear(); warning_.clear();
    if (importedRecovery) {
        saveProjectUnlocked();
        removeFile(recoveredPath);
        recoveredFiles_.erase(std::remove_if(recoveredFiles_.begin(), recoveredFiles_.end(),
            [&](const std::string& item) { return item.rfind(safe + "/", 0) == 0; }), recoveredFiles_.end());
    }
    return true;
}

MultitrackRecorder::Track* MultitrackRecorder::findTrackUnlocked(const std::string& id) {
    for (Track& track : tracks_) if (track.id == id) return &track;
    return nullptr;
}

MultitrackRecorder::Clip* MultitrackRecorder::findClipUnlocked(const std::string& id, Track** owner) {
    for (Track& track : tracks_) for (Clip& clip : track.clips) if (clip.id == id) {
        if (owner) *owner = &track; return &clip;
    }
    return nullptr;
}

bool MultitrackRecorder::addTrack(const Json& payload, std::string& error) {
    if (recording() || finalizing_.load()) { error = "stop recording before adding tracks"; return false; }
    Source source;
    if (!parseSource(payload["source"].asString("processed"), source)) { error = "unknown recorder source"; return false; }
    if (!(availableMask_.load(std::memory_order_acquire) & sourceBit(source))) {
        error = std::string(sourceName(source)) + " source is not available"; return false;
    }
    std::lock_guard<std::mutex> lock(stateMutex_);
    if (projectId_.empty()) { error = "create a recording project first"; return false; }
    if (tracks_.size() >= 16) { error = "a project can contain at most 16 tracks"; return false; }
    Track track; track.id = uniqueId("track"); track.source = source; track.armed = true;
    track.name = sanitizeFileName(payload["name"].asString(sourceName(source)));
    tracks_.push_back(std::move(track)); saveProjectUnlocked();
    return true;
}

bool MultitrackRecorder::updateTrack(const Json& payload, std::string& error) {
    if (finalizing_.load()) { error = "wait for recording files to finish"; return false; }
    if (recording() && (payload.has("name") || payload.has("armed"))) {
        error = "stop recording before changing track names or arming";
        return false;
    }
    std::lock_guard<std::mutex> lock(stateMutex_);
    Track* track = findTrackUnlocked(payload["id"].asString());
    if (!track) { error = "recorder track was not found"; return false; }
    if (payload.has("name")) track->name = sanitizeFileName(payload["name"].asString());
    if (payload.has("armed")) track->armed = payload["armed"].asBool();
    if (payload.has("muted")) track->muted = payload["muted"].asBool();
    if (payload.has("solo")) track->solo = payload["solo"].asBool();
    if (payload.has("level")) track->level = std::max(0.0f, std::min(1.5f, payload["level"].asFloat(1.0f)));
    if (payload.has("pan")) track->pan = std::max(-1.0f, std::min(1.0f, payload["pan"].asFloat()));
    saveProjectUnlocked();
    return true;
}

bool MultitrackRecorder::deleteTrack(const Json& payload, std::string& error) {
    if (!payload["confirmed"].asBool()) { error = "track deletion requires confirmation"; return false; }
    if (recording() || finalizing_.load()) { error = "stop recording before deleting tracks"; return false; }
    std::lock_guard<std::mutex> lock(stateMutex_);
    const std::string id = payload["id"].asString();
    const auto found = std::find_if(tracks_.begin(), tracks_.end(), [&](const Track& t) { return t.id == id; });
    if (found == tracks_.end()) { error = "recorder track was not found"; return false; }
    tracks_.erase(found); saveProjectUnlocked();
    requestPlaybackReset(playbackPositionFrame_.load(std::memory_order_relaxed));
    return true;
}

bool MultitrackRecorder::editClip(const std::string& operation, const Json& payload, std::string& error) {
    if (recording() || finalizing_.load()) { error = "stop recording before editing clips"; return false; }
    std::lock_guard<std::mutex> lock(stateMutex_);
    Track* owner = nullptr;
    Clip* clip = findClipUnlocked(payload["id"].asString(), &owner);
    if (!clip || !owner) { error = "recording clip was not found"; return false; }
    if (operation == "delete") {
        if (!payload["confirmed"].asBool()) { error = "clip deletion requires confirmation"; return false; }
        const std::string id = clip->id;
        owner->clips.erase(std::remove_if(owner->clips.begin(), owner->clips.end(),
            [&](const Clip& candidate) { return candidate.id == id; }), owner->clips.end());
    } else if (operation == "set") {
        const std::string safeFile = sanitizeFileName(clip->file);
        std::error_code sizeError;
        const uintmax_t bytes = fs::file_size(joinPath(joinPath(joinPath(root_, projectId_), "audio"), safeFile), sizeError);
        const int64_t fileFrames = sizeError || bytes < 44 ? 0 : static_cast<int64_t>((bytes - 44) / 4);
        const int64_t offset = std::max<int64_t>(0, payload["offset"].asInt64(clip->offset));
        const int64_t length = std::max<int64_t>(1, payload["length"].asInt64(clip->length));
        if (fileFrames <= 0 || offset + length > fileFrames) { error = "clip range exceeds its recorded take"; return false; }
        clip->start = std::max<int64_t>(0, payload["start"].asInt64(clip->start));
        clip->offset = offset; clip->length = length;
        clip->fadeIn = std::max<int64_t>(0, std::min(length, payload["fadeIn"].asInt64(clip->fadeIn)));
        clip->fadeOut = std::max<int64_t>(0, std::min(length, payload["fadeOut"].asInt64(clip->fadeOut)));
    } else if (operation == "move") {
        clip->start = std::max<int64_t>(0, payload["start"].asInt64(clip->start));
    } else if (operation == "trim") {
        const int64_t trimStart = std::max<int64_t>(0, payload["trimStart"].asInt64());
        const int64_t trimEnd = std::max<int64_t>(0, payload["trimEnd"].asInt64());
        if (trimStart + trimEnd >= clip->length) { error = "trim would remove the whole clip"; return false; }
        clip->start += trimStart; clip->offset += trimStart; clip->length -= trimStart + trimEnd;
        clip->fadeIn = std::min(clip->fadeIn, clip->length); clip->fadeOut = std::min(clip->fadeOut, clip->length);
    } else if (operation == "fades") {
        clip->fadeIn = std::max<int64_t>(0, std::min(clip->length, payload["fadeIn"].asInt64()));
        clip->fadeOut = std::max<int64_t>(0, std::min(clip->length, payload["fadeOut"].asInt64()));
    } else if (operation == "split") {
        const int64_t position = payload["position"].asInt64();
        if (position <= clip->start || position >= clip->start + clip->length) {
            error = "split position must be inside the clip"; return false;
        }
        const int64_t left = position - clip->start;
        Clip right = *clip; right.id = uniqueId("clip"); right.start = position;
        right.offset += left; right.length -= left; right.fadeIn = 0; clip->length = left; clip->fadeOut = 0;
        owner->clips.push_back(std::move(right));
    } else { error = "unknown clip edit"; return false; }
    saveProjectUnlocked();
    requestPlaybackReset(playbackPositionFrame_.load(std::memory_order_relaxed));
    return true;
}

bool MultitrackRecorder::startRecording(const Json& payload, std::string& error) {
    if (recording() || finalizing_.load()) { error = "recorder is already active"; return false; }
    if (ring_.empty()) { error = "recorder audio buffers are not ready"; return false; }
    std::lock_guard<std::mutex> lock(stateMutex_);
    if (projectId_.empty()) { error = "create a recording project first"; return false; }
    if (payload["playBacking"].asBool()) {
        if (!(availableMask_.load(std::memory_order_acquire) & sourceBit(Source::Backing))) {
            error = "backing-track capture is not available";
            return false;
        }
        Track* inputTrack = nullptr;
        for (Track& track : tracks_) if (track.source == Source::Processed) { inputTrack = &track; break; }
        if (!inputTrack) for (Track& track : tracks_) if (track.source == Source::Raw) { inputTrack = &track; break; }
        if (!inputTrack) {
            if (tracks_.size() >= 16) { error = "a project can contain at most 16 tracks"; return false; }
            Track track;
            track.id = uniqueId("track");
            track.name = "Processed Input";
            track.source = Source::Processed;
            track.armed = true;
            tracks_.push_back(std::move(track));
        } else {
            inputTrack->armed = true;
        }
        Track* backingTrack = nullptr;
        for (Track& track : tracks_) if (track.source == Source::Backing) { backingTrack = &track; break; }
        if (!backingTrack) {
            if (tracks_.size() >= 16) { error = "a project can contain at most 16 tracks"; return false; }
            Track track;
            track.id = uniqueId("track");
            track.name = "Backing Track";
            track.source = Source::Backing;
            track.armed = true;
            tracks_.push_back(std::move(track));
        } else {
            backingTrack->armed = true;
        }
        saveProjectUnlocked();
    }
    uint32_t mask = 0;
    for (const Track& track : tracks_) if (track.armed) mask |= sourceBit(track.source);
    mask &= availableMask_.load(std::memory_order_acquire);
    if (mask == 0) { error = "arm at least one available track"; return false; }
    const std::string audioRoot = joinPath(joinPath(root_, projectId_), "audio");
    makeDirectories(audioRoot); activeFiles_.clear();
    recordStartFrame_ = playbackPlaying_.load(std::memory_order_acquire)
        ? playbackPositionFrame_.load(std::memory_order_relaxed) : 0;
    if (!playbackPlaying_.load(std::memory_order_relaxed)) {
        for (const Track& track : tracks_) for (const Clip& clip : track.clips)
            recordStartFrame_ = std::max(recordStartFrame_, clip.start + clip.length);
    }
    for (size_t i = 0; i < tracks_.size(); ++i) {
        if (!tracks_[i].armed || !(mask & sourceBit(tracks_[i].source))) continue;
        ActiveFile file; file.track = i;
        file.relative = tracks_[i].id + "-" + uniqueId("take") + ".wav";
        file.path = joinPath(audioRoot, file.relative);
        file.stream.open(file.path, std::ios::binary | std::ios::trunc);
        if (!file.stream) { error = "could not create recorder take"; activeFiles_.clear(); return false; }
        writeWaveHeader(file.stream, sampleRate_.load(), 0); activeFiles_.push_back(std::move(file));
    }
    writtenFrames_.store(0); droppedBlocks_.store(0); writeKbps_.store(0); queuePermille_.store(0);
    armedMask_.store(mask, std::memory_order_release);
    finalizing_.store(false, std::memory_order_release);
    saveRecoveryUnlocked();
    recording_.store(true, std::memory_order_release);
    return true;
}

bool MultitrackRecorder::stopRecording(std::string& error) {
    if (!recording()) { error = "recorder is not recording"; return false; }
    recording_.store(false, std::memory_order_release);
    armedMask_.store(0, std::memory_order_release);
    finalizing_.store(true, std::memory_order_release);
    wake_.notify_one(); return true;
}

bool MultitrackRecorder::deleteProject(const Json& payload, std::string& error) {
    if (!payload["confirmed"].asBool()) { error = "project deletion requires confirmation"; return false; }
    if (recording() || finalizing_.load()) { error = "stop recording before deleting a project"; return false; }
    const std::string id = sanitizeFileName(payload["id"].asString());
    const fs::path target = fs::weakly_canonical(fs::path(joinPath(root_, id)));
    const fs::path base = fs::weakly_canonical(fs::path(root_));
    if (target.parent_path() != base || !fs::is_directory(target)) { error = "recording project was not found"; return false; }
    playbackPlaying_.store(false, std::memory_order_release);
    playbackPaused_.store(false, std::memory_order_release);
    requestPlaybackReset(0);
    std::error_code ec; fs::remove_all(target, ec);
    if (ec) { error = "could not delete the recording project"; return false; }
    std::lock_guard<std::mutex> lock(stateMutex_);
    if (projectId_ == id) { projectId_.clear(); projectName_.clear(); tracks_.clear(); }
    refreshProjectsUnlocked(); return true;
}

bool MultitrackRecorder::command(const std::string& command, const Json& payload, std::string& error) {
    if (command == "project/new") return createProject(payload["name"].asString(), error);
    if (command == "project/open") return openProject(payload["id"].asString(), error);
    if (command == "project/delete") return deleteProject(payload, error);
    if (command == "track/add") return addTrack(payload, error);
    if (command == "track/update") return updateTrack(payload, error);
    if (command == "track/delete") return deleteTrack(payload, error);
    if (command == "record/start") return startRecording(payload, error);
    if (command == "record/stop") return stopRecording(error);
    if (command.rfind("playback/", 0) == 0) return playbackCommand(command.substr(9), payload, error);
    if (command.rfind("clip/", 0) == 0) return editClip(command.substr(5), payload, error);
    error = "unknown recorder command"; return false;
}

int64_t MultitrackRecorder::timelineFramesUnlocked() const {
    int64_t total = 0;
    for (const Track& track : tracks_) for (const Clip& clip : track.clips)
        total = std::max(total, clip.start + clip.length);
    return total;
}

bool MultitrackRecorder::playbackCommand(const std::string& command, const Json& payload, std::string& error) {
    if (playbackRing_.empty()) { error = "recorder playback buffers are not ready"; return false; }
    int64_t total = 0;
    {
        std::lock_guard<std::mutex> lock(stateMutex_);
        total = timelineFramesUnlocked();
    }
    if (total <= 0) { error = "there is no recorded audio to play"; return false; }
    if (command == "play") {
        int64_t frame = playbackPositionFrame_.load(std::memory_order_relaxed);
        if (frame >= total || playbackEof_.load(std::memory_order_acquire)) frame = 0;
        playbackPaused_.store(false, std::memory_order_release);
        playbackUnderruns_.store(0, std::memory_order_relaxed);
        requestPlaybackReset(frame);
        playbackPlaying_.store(true, std::memory_order_release);
    } else if (command == "pause") {
        playbackPlaying_.store(false, std::memory_order_release);
        playbackPaused_.store(true, std::memory_order_release);
    } else if (command == "stop") {
        playbackPlaying_.store(false, std::memory_order_release);
        playbackPaused_.store(false, std::memory_order_release);
        requestPlaybackReset(0);
    } else if (command == "seek") {
        int64_t frame = payload.has("frame") ? payload["frame"].asInt64()
            : static_cast<int64_t>(payload["seconds"].asDouble() * sampleRate_.load());
        frame = std::max<int64_t>(0, std::min(total, frame));
        requestPlaybackReset(frame);
    } else {
        error = "unknown recorder playback command";
        return false;
    }
    wake_.notify_one();
    return true;
}

unsigned MultitrackRecorder::renderTimelineBlock(int64_t start, unsigned frames, float* output) {
    std::fill(output, output + playbackBlockFrames_ * 2, 0.0f);
    std::lock_guard<std::mutex> lock(stateMutex_);
    const int64_t total = timelineFramesUnlocked();
    if (start >= total) return 0;
    const unsigned count = static_cast<unsigned>(std::min<int64_t>(frames, total - start));
    bool anySolo = false;
    for (const Track& track : tracks_) anySolo = anySolo || track.solo;
    float* left = output;
    float* right = output + playbackBlockFrames_;
    for (const Track& track : tracks_) {
        const bool audible = !track.muted && (!anySolo || track.solo);
        const float leftGain = audible ? track.level * (track.pan > 0 ? 1.0f - track.pan : 1.0f) : 0.0f;
        const float rightGain = audible ? track.level * (track.pan < 0 ? 1.0f + track.pan : 1.0f) : 0.0f;
        const auto previous = playbackTrackGains_.find(track.id);
        const float previousLeft = previous == playbackTrackGains_.end() ? leftGain : previous->second[0];
        const float previousRight = previous == playbackTrackGains_.end() ? rightGain : previous->second[1];
        for (const Clip& clip : track.clips) {
            const int64_t begin = std::max(start, clip.start);
            const int64_t end = std::min(start + count, clip.start + clip.length);
            if (begin >= end) continue;
            const std::string safeFile = sanitizeFileName(clip.file);
            if (safeFile != clip.file) continue;
            std::ifstream in(joinPath(joinPath(joinPath(root_, projectId_), "audio"), safeFile), std::ios::binary);
            if (!in) continue;
            in.seekg(44 + (clip.offset + begin - clip.start) * 4);
            for (int64_t frame = begin; frame < end; ++frame) {
                char bytes[4];
                if (!in.read(bytes, 4)) break;
                const int16_t l = static_cast<int16_t>(static_cast<uint8_t>(bytes[0])
                    | (static_cast<uint16_t>(static_cast<uint8_t>(bytes[1])) << 8));
                const int16_t r = static_cast<int16_t>(static_cast<uint8_t>(bytes[2])
                    | (static_cast<uint16_t>(static_cast<uint8_t>(bytes[3])) << 8));
                const int64_t local = frame - clip.start;
                float fade = 1.0f;
                if (clip.fadeIn > 0 && local < clip.fadeIn) fade *= static_cast<float>(local) / clip.fadeIn;
                if (clip.fadeOut > 0 && clip.length - local < clip.fadeOut)
                    fade *= static_cast<float>(clip.length - local) / clip.fadeOut;
                const size_t target = static_cast<size_t>(frame - start);
                const float ramp = std::min(1.0f, static_cast<float>(target + 1) / 256.0f);
                const float smoothLeft = previousLeft + (leftGain - previousLeft) * ramp;
                const float smoothRight = previousRight + (rightGain - previousRight) * ramp;
                left[target] += l / 32768.0f * smoothLeft * fade;
                right[target] += r / 32768.0f * smoothRight * fade;
            }
        }
        playbackTrackGains_[track.id] = {leftGain, rightGain};
    }
    for (unsigned frame = 0; frame < count; ++frame) {
        left[frame] = clampSample(left[frame]);
        right[frame] = clampSample(right[frame]);
    }
    return count;
}

void MultitrackRecorder::saveProjectUnlocked() {
    if (projectId_.empty()) return;
    Json root = Json::object(); root.set("format", "pimfx-recording-project"); root.set("version", 1);
    root.set("id", projectId_); root.set("name", projectName_); root.set("sampleRate", sampleRate_.load());
    Json tracks = Json::array();
    for (const Track& track : tracks_) {
        Json item = Json::object(); item.set("id", track.id); item.set("name", track.name);
        item.set("source", sourceName(track.source)); item.set("armed", track.armed);
        item.set("muted", track.muted); item.set("solo", track.solo);
        item.set("level", track.level); item.set("pan", track.pan);
        Json clips = Json::array();
        for (const Clip& clip : track.clips) {
            Json raw = Json::object(); raw.set("id", clip.id); raw.set("file", clip.file);
            raw.set("start", clip.start); raw.set("offset", clip.offset); raw.set("length", clip.length);
            raw.set("fadeIn", clip.fadeIn); raw.set("fadeOut", clip.fadeOut); clips.push(std::move(raw));
        }
        item.set("clips", std::move(clips)); tracks.push(std::move(item));
    }
    root.set("tracks", std::move(tracks));
    writeFileAtomic(joinPath(joinPath(root_, projectId_), "project.json"), root.dump(2));
}

void MultitrackRecorder::saveRecoveryUnlocked() {
    if (projectId_.empty() || activeFiles_.empty()) return;
    Json root = Json::object(); root.set("format", "pimfx-recorder-recovery"); root.set("version", 1);
    root.set("sampleRate", sampleRate_.load()); Json files = Json::array();
    for (const ActiveFile& file : activeFiles_) {
        Json item = Json::object(); item.set("file", file.relative);
        item.set("trackId", tracks_[file.track].id); item.set("start", recordStartFrame_);
        item.set("frames", static_cast<int64_t>(file.frames));
        files.push(std::move(item));
    }
    root.set("files", std::move(files));
    writeFileAtomic(joinPath(joinPath(root_, projectId_), "recovery.json"), root.dump(2));
}

void MultitrackRecorder::refreshProjectsUnlocked() {
    projects_.clear(); std::error_code ec;
    for (const fs::directory_entry& entry : fs::directory_iterator(root_, ec)) {
        if (entry.is_directory(ec) && fileExists(joinPath(entry.path().string(), "project.json")))
            projects_.push_back(entry.path().filename().string());
    }
    std::sort(projects_.begin(), projects_.end());
}

void MultitrackRecorder::recoverInterruptedProjects() {
    std::error_code ec;
    for (const fs::directory_entry& entry : fs::directory_iterator(root_, ec)) {
        if (!entry.is_directory(ec)) continue;
        const std::string recovery = joinPath(entry.path().string(), "recovery.json");
        const std::string retained = joinPath(entry.path().string(), "recovered.json");
        std::string text;
        const bool interrupted = readFile(recovery, text);
        if (!interrupted && !readFile(retained, text)) continue;
        std::string parseError; const Json json = Json::parse(text, &parseError);
        if (!parseError.empty() || json["format"].asString() != "pimfx-recorder-recovery") continue;
        const unsigned rate = std::max(1, json["sampleRate"].asInt(48000));
        bool repaired = true;
        for (const Json& item : json["files"].items()) {
            const std::string name = sanitizeFileName(item["file"].asString());
            repaired = patchWaveHeader(joinPath(joinPath(entry.path().string(), "audio"), name), rate,
                                       static_cast<uint64_t>(std::max<int64_t>(0, item["frames"].asInt64()))) && repaired;
        }
        if (repaired) {
            for (const Json& item : json["files"].items()) {
                recoveredFiles_.push_back(entry.path().filename().string() + "/"
                    + sanitizeFileName(item["file"].asString()));
            }
            if (interrupted) {
                std::error_code renameError;
                fs::rename(recovery, retained, renameError);
                if (renameError) removeFile(recovery);
            }
        }
    }
}

void MultitrackRecorder::finalizeRecordingUnlocked() {
    for (ActiveFile& file : activeFiles_) {
        file.stream.flush(); file.stream.close();
        if (!patchWaveHeader(file.path, sampleRate_.load(), file.frames)) {
            lastError_ = "could not finalize a recorder WAV header"; continue;
        }
        Track& track = tracks_[file.track]; Clip clip; clip.id = uniqueId("clip"); clip.file = file.relative;
        clip.start = recordStartFrame_; clip.length = static_cast<int64_t>(file.frames);
        track.clips.push_back(std::move(clip));
    }
    activeFiles_.clear(); saveProjectUnlocked();
    removeFile(joinPath(joinPath(root_, projectId_), "recovery.json"));
    finalizing_.store(false, std::memory_order_release);
    if (playbackPlaying_.load(std::memory_order_acquire)) {
        requestPlaybackReset(playbackPositionFrame_.load(std::memory_order_relaxed));
    }
}

void MultitrackRecorder::worker() {
    auto speedStart = std::chrono::steady_clock::now(); uint64_t speedBytes = 0; unsigned journalBlocks = 0;
    while (true) {
        size_t read = readBlock_.load(std::memory_order_relaxed);
        const size_t write = writeBlock_.load(std::memory_order_acquire);
        if (read == write) {
            if (finalizing_.load(std::memory_order_acquire)) {
                std::lock_guard<std::mutex> lock(stateMutex_); finalizeRecordingUnlocked();
            }
            if (stopping_.load(std::memory_order_acquire)) break;
            const uint32_t generation = playbackGeneration_.load(std::memory_order_acquire);
            if (generation != workerPlaybackGeneration_) {
                workerPlaybackGeneration_ = generation;
                workerPlaybackFrame_ = requestedPlaybackFrame_.load(std::memory_order_relaxed);
                playbackWriteBlock_.store(0, std::memory_order_relaxed);
                playbackEof_.store(false, std::memory_order_release);
            }
            if (playbackAcknowledgedGeneration_.load(std::memory_order_acquire) == generation) {
                if (playbackPlaying_.load(std::memory_order_acquire) && !playbackRing_.empty()) {
                    const size_t playbackWrite = playbackWriteBlock_.load(std::memory_order_relaxed);
                    const size_t next = (playbackWrite + 1) % playbackRing_.size();
                    if (next != playbackReadBlock_.load(std::memory_order_acquire)) {
                        RingBlock& playback = playbackRing_[playbackWrite];
                        const unsigned count = renderTimelineBlock(workerPlaybackFrame_, playbackBlockFrames_, playback.samples.data());
                        if (count > 0) {
                            playback.frames = count;
                            playback.timelineFrame = workerPlaybackFrame_;
                            workerPlaybackFrame_ += count;
                            playbackWriteBlock_.store(next, std::memory_order_release);
                            playbackResetting_.store(false, std::memory_order_release);
                            continue;
                        }
                        playbackEof_.store(true, std::memory_order_release);
                        playbackResetting_.store(false, std::memory_order_release);
                    }
                } else {
                    playbackResetting_.store(false, std::memory_order_release);
                }
            }
            std::unique_lock<std::mutex> lock(stateMutex_);
            wake_.wait_for(lock, std::chrono::milliseconds(20));
            continue;
        }
        RingBlock& block = ring_[read];
        {
            std::lock_guard<std::mutex> lock(stateMutex_);
            for (ActiveFile& file : activeFiles_) {
                const Source source = tracks_[file.track].source; const uint32_t bit = sourceBit(source);
                if (!(block.mask & bit)) continue;
                const size_t base = static_cast<size_t>(source) * 2 * maxFrames_;
                for (unsigned frame = 0; frame < block.frames; ++frame) {
                    const float left = block.samples[base + frame];
                    const float right = block.samples[base + maxFrames_ + frame];
                    putU16(file.stream, static_cast<uint16_t>(static_cast<int16_t>(std::lround(clampSample(left) * 32767.0f))));
                    putU16(file.stream, static_cast<uint16_t>(static_cast<int16_t>(std::lround(clampSample(right) * 32767.0f))));
                    file.peak = std::max(file.peak, std::max(std::abs(left), std::abs(right)));
                }
                file.frames += block.frames; speedBytes += block.frames * 4;
                const size_t bucket = static_cast<size_t>(file.frames / std::max(1u, sampleRate_.load() / 2));
                Track& track = tracks_[file.track];
                if (bucket < kWaveformBuckets) {
                    track.waveform[bucket] = std::max(track.waveform[bucket], file.peak);
                    track.waveformCount = std::max(track.waveformCount, bucket + 1); file.peak = 0.0f;
                }
            }
            if (++journalBlocks % 128 == 0) saveRecoveryUnlocked();
        }
        writtenFrames_.fetch_add(block.frames, std::memory_order_relaxed);
        readBlock_.store((read + 1) % ring_.size(), std::memory_order_release);
        const size_t queued = (write + ring_.size() - read) % ring_.size();
        queuePermille_.store(static_cast<uint32_t>(queued * 1000 / ring_.size()), std::memory_order_relaxed);
        const auto now = std::chrono::steady_clock::now();
        const auto millis = std::chrono::duration_cast<std::chrono::milliseconds>(now - speedStart).count();
        if (millis >= 1000) {
            writeKbps_.store(static_cast<uint32_t>(speedBytes * 1000 / static_cast<uint64_t>(millis) / 1024));
            speedBytes = 0; speedStart = now;
        }
    }
}

Json MultitrackRecorder::state() const {
    std::lock_guard<std::mutex> lock(stateMutex_);
    Json out = Json::object(); out.set("type", "recorder");
    out.set("status", recording() ? "recording" : finalizing_.load() ? "finalizing" : "stopped");
    out.set("projectId", projectId_); out.set("projectName", projectName_);
    out.set("sampleRate", sampleRate_.load()); out.set("recordedFrames", static_cast<int64_t>(writtenFrames_.load()));
    const int64_t timelineFrames = timelineFramesUnlocked();
    out.set("timelineFrames", timelineFrames);
    out.set("duration", timelineFrames / static_cast<double>(std::max(1u, sampleRate_.load())));
    out.set("playbackFrame", playbackPositionFrame_.load(std::memory_order_relaxed));
    out.set("position", playbackPositionFrame_.load(std::memory_order_relaxed)
        / static_cast<double>(std::max(1u, sampleRate_.load())));
    out.set("playbackStatus", playbackPlaying_.load(std::memory_order_acquire) ? "playing"
        : playbackPaused_.load(std::memory_order_acquire) ? "paused" : "stopped");
    out.set("playbackUnderruns", static_cast<int64_t>(playbackUnderruns_.load(std::memory_order_relaxed)));
    out.set("droppedBlocks", static_cast<int64_t>(droppedBlocks_.load()));
    out.set("queueLevel", queuePermille_.load() / 1000.0); out.set("writeKbps", static_cast<int>(writeKbps_.load()));
    std::error_code ec; const fs::space_info space = fs::space(root_, ec);
    const uint64_t freeBytes = ec ? 0 : static_cast<uint64_t>(space.available);
    size_t armedTracks = 0;
    for (const Track& track : tracks_) if (track.armed) ++armedTracks;
    const uint64_t requiredBytesPerSecond = armedTracks * static_cast<uint64_t>(sampleRate_.load()) * 4;
    const uint64_t remainingSeconds = requiredBytesPerSecond > 0 ? freeBytes / requiredBytesPerSecond : 0;
    std::string warning = warning_;
    if (droppedBlocks_.load() > 0) warning = "Recorder storage could not keep up; one or more blocks were dropped.";
    else if (playbackUnderruns_.load() > 0) warning = "Recorder playback storage could not keep up; audio was protected.";
    else if (queuePermille_.load() >= 750) warning = "Recorder write queue is nearly full.";
    else if (freeBytes > 0 && freeBytes < 512ull * 1024 * 1024) warning = "Recording storage is running low.";
    else if (recording() && writeKbps_.load() > 0 && requiredBytesPerSecond > 0
        && static_cast<uint64_t>(writeKbps_.load()) * 1024 * 10 < requiredBytesPerSecond * 9) {
        warning = "Storage write speed is below the current armed-track rate.";
    }
    out.set("error", lastError_); out.set("warning", warning);
    out.set("freeBytes", static_cast<int64_t>(std::min<uint64_t>(freeBytes,
        static_cast<uint64_t>(std::numeric_limits<int64_t>::max()))));
    out.set("remainingSeconds", static_cast<int64_t>(std::min<uint64_t>(remainingSeconds,
        static_cast<uint64_t>(std::numeric_limits<int64_t>::max()))));
    Json sources = Json::array(); const uint32_t available = availableMask_.load();
    for (unsigned i = 0; i < static_cast<unsigned>(Source::Count); ++i) {
        Json item = Json::object(); item.set("id", sourceName(static_cast<Source>(i)));
        item.set("available", (available & (1u << i)) != 0); sources.push(std::move(item));
    }
    out.set("sources", std::move(sources));
    Json projects = Json::array(); for (const std::string& id : projects_) projects.push(id); out.set("projects", std::move(projects));
    Json recovered = Json::array(); for (const std::string& file : recoveredFiles_) recovered.push(file); out.set("recoveredFiles", std::move(recovered));
    Json tracks = Json::array();
    for (const Track& track : tracks_) {
        Json item = Json::object(); item.set("id", track.id); item.set("name", track.name);
        item.set("source", sourceName(track.source)); item.set("armed", track.armed);
        item.set("muted", track.muted); item.set("solo", track.solo); item.set("level", track.level); item.set("pan", track.pan);
        Json peaks = Json::array(); for (size_t i = 0; i < track.waveformCount; ++i) peaks.push(track.waveform[i]);
        item.set("waveform", std::move(peaks)); Json clips = Json::array();
        for (const Clip& clip : track.clips) {
            Json raw = Json::object(); raw.set("id", clip.id); raw.set("start", clip.start);
            raw.set("offset", clip.offset); raw.set("length", clip.length); raw.set("fadeIn", clip.fadeIn);
            raw.set("fadeOut", clip.fadeOut); raw.set("file", clip.file); clips.push(std::move(raw));
        }
        item.set("clips", std::move(clips)); tracks.push(std::move(item));
    }
    out.set("tracks", std::move(tracks)); return out;
}

bool MultitrackRecorder::writeExport(const std::string& kind, const std::string& trackId,
                                     std::string& path, std::string& name, std::string& error) {
    if (recording() || finalizing_.load()) { error = "stop recording before exporting"; return false; }
    std::lock_guard<std::mutex> lock(stateMutex_);
    if (projectId_.empty()) { error = "open a recording project first"; return false; }
    const Track* stem = nullptr; if (kind == "stem") {
        for (const Track& track : tracks_) if (track.id == trackId) stem = &track;
        if (!stem) { error = "recorder track was not found"; return false; }
    }
    bool anySolo = false; int64_t totalFrames = 0;
    for (const Track& track : tracks_) { anySolo = anySolo || track.solo; for (const Clip& clip : track.clips) totalFrames = std::max(totalFrames, clip.start + clip.length); }
    if (totalFrames <= 0) { error = "there is no recorded audio to export"; return false; }
    name = sanitizeFileName(kind == "stem" ? stem->name : projectName_) + (kind == "stem" ? "-stem.wav" : "-mix.wav");
    path = joinPath(joinPath(joinPath(root_, projectId_), "exports"), name); std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out) { error = "could not create recorder export"; return false; }
    writeWaveHeader(out, sampleRate_.load(), static_cast<uint32_t>(std::min<int64_t>(totalFrames, (std::numeric_limits<uint32_t>::max() - 36u) / 4u)));
    constexpr int64_t kChunk = 2048; std::vector<float> left(kChunk), right(kChunk);
    for (int64_t baseFrame = 0; baseFrame < totalFrames; baseFrame += kChunk) {
        const int64_t count = std::min(kChunk, totalFrames - baseFrame); std::fill(left.begin(), left.end(), 0.0f); std::fill(right.begin(), right.end(), 0.0f);
        for (const Track& track : tracks_) {
            if ((stem && &track != stem) || track.muted || (!stem && anySolo && !track.solo)) continue;
            const float leftGain = track.level * (track.pan > 0 ? 1.0f - track.pan : 1.0f);
            const float rightGain = track.level * (track.pan < 0 ? 1.0f + track.pan : 1.0f);
            for (const Clip& clip : track.clips) {
                const int64_t begin = std::max(baseFrame, clip.start), end = std::min(baseFrame + count, clip.start + clip.length);
                if (begin >= end) continue;
                std::ifstream in(joinPath(joinPath(joinPath(root_, projectId_), "audio"), clip.file), std::ios::binary);
                if (!in) continue;
                const int64_t source = clip.offset + begin - clip.start; in.seekg(44 + source * 4);
                for (int64_t frame = begin; frame < end; ++frame) {
                    char bytes[4]; if (!in.read(bytes, 4)) break;
                    const int16_t l = static_cast<int16_t>(static_cast<uint8_t>(bytes[0]) | (static_cast<uint16_t>(static_cast<uint8_t>(bytes[1])) << 8));
                    const int16_t r = static_cast<int16_t>(static_cast<uint8_t>(bytes[2]) | (static_cast<uint16_t>(static_cast<uint8_t>(bytes[3])) << 8));
                    const int64_t local = frame - clip.start; float fade = 1.0f;
                    if (clip.fadeIn > 0 && local < clip.fadeIn) fade *= static_cast<float>(local) / clip.fadeIn;
                    if (clip.fadeOut > 0 && clip.length - local < clip.fadeOut) fade *= static_cast<float>(clip.length - local) / clip.fadeOut;
                    left[frame - baseFrame] += l / 32768.0f * leftGain * fade;
                    right[frame - baseFrame] += r / 32768.0f * rightGain * fade;
                }
            }
        }
        for (int64_t frame = 0; frame < count; ++frame) {
            putU16(out, static_cast<uint16_t>(static_cast<int16_t>(std::lround(clampSample(left[frame]) * 32767.0f))));
            putU16(out, static_cast<uint16_t>(static_cast<int16_t>(std::lround(clampSample(right[frame]) * 32767.0f))));
        }
    }
    out.flush(); if (!out) { error = "could not finish recorder export"; return false; } return true;
}

bool MultitrackRecorder::exportFile(const std::string& kind, const std::string& trackId,
                                    std::string& path, std::string& name, std::string& error) {
    return writeExport(kind == "stem" ? "stem" : "mix", trackId, path, name, error);
}

} // namespace pimfx
