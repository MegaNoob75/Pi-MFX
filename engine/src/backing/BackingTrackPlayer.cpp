#include "backing/BackingTrackPlayer.h"
#include "core/Paths.h"

#if defined(PIMFX_HAVE_SNDFILE) && defined(PIMFX_HAVE_SAMPLERATE)
#include <samplerate.h>
#include <sndfile.h>
#endif

#include <algorithm>
#include <chrono>
#include <cctype>
#include <cmath>
#include <filesystem>
#include <limits>
#include <unordered_set>

namespace pimfx {
namespace {

constexpr size_t kRingFrames = 1u << 18;
constexpr size_t kDecodeFrames = 4096;
constexpr size_t kResampleFrames = 16384;
static_assert(std::atomic<uint32_t>::is_always_lock_free,
              "backing-track realtime state requires lock-free 32-bit atomics");
static_assert(std::atomic<size_t>::is_always_lock_free,
              "backing-track ring indexes require lock-free native atomics");

uint32_t toMilli(double value) {
    if (!std::isfinite(value) || value <= 0.0) return 0;
    return static_cast<uint32_t>(std::min<double>(std::numeric_limits<uint32_t>::max(),
                                                  std::llround(value * 1000.0)));
}

double fromMilli(uint32_t value) { return static_cast<double>(value) / 1000.0; }

std::string lowerExtension(const std::string& path) {
    std::string extension = std::filesystem::path(path).extension().string();
    std::transform(extension.begin(), extension.end(), extension.begin(),
                   [](unsigned char value) { return static_cast<char>(std::tolower(value)); });
    return extension;
}

bool supportedExtension(const std::string& path) {
    const std::string extension = lowerExtension(path);
    return extension == ".wav" || extension == ".flac"
        || extension == ".mp3" || extension == ".ogg";
}

std::string setListId() {
    return "set-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count());
}

}

BackingTrackPlayer::BackingTrackPlayer(std::string root)
    : root_(std::move(root)), ring_(kRingFrames * 2, 0.0f), ringFrameMask_(kRingFrames - 1) {
    makeDirectories(root_);
    state_.set("type", "backing");
    state_.set("error", "");
    loadTrackSettings();
    loadSetLists();
    refreshPlaylist();
}

BackingTrackPlayer::~BackingTrackPlayer() { stop(); }

bool BackingTrackPlayer::available() const {
#if defined(PIMFX_HAVE_SNDFILE) && defined(PIMFX_HAVE_SAMPLERATE)
    return true;
#else
    return false;
#endif
}

void BackingTrackPlayer::start() {
    if (thread_.joinable()) return;
    stopping_.store(false, std::memory_order_release);
    thread_ = std::thread(&BackingTrackPlayer::worker, this);
    std::string path;
    { std::lock_guard<std::mutex> lock(stateMutex_); path = state_["path"].asString(); }
    if (!path.empty()) { std::string ignored; load(path, ignored); }
}

void BackingTrackPlayer::stop() {
    stopping_.store(true, std::memory_order_release);
    wake_.notify_all();
    if (thread_.joinable()) thread_.join();
}

void BackingTrackPlayer::prepare(unsigned outputSampleRate) {
    outputSampleRate_.store(std::max(1u, outputSampleRate), std::memory_order_release);
}

void BackingTrackPlayer::enqueue(Command command) {
    {
        std::lock_guard<std::mutex> lock(commandMutex_);
        if (command.type == CommandType::Seek) {
            commands_.erase(std::remove_if(commands_.begin(), commands_.end(), [](const Command& queued) {
                return queued.type == CommandType::Seek;
            }), commands_.end());
        }
        if (commands_.size() >= 64) commands_.pop_front();
        commands_.push_back(std::move(command));
    }
    wake_.notify_one();
}

bool BackingTrackPlayer::safeLibraryPath(const std::string& path, std::string& canonical) const {
    if (path.empty() || !supportedExtension(path)) return false;
    std::error_code ec;
    const auto candidate = std::filesystem::weakly_canonical(path, ec);
    if (ec) return false;
    const auto root = std::filesystem::weakly_canonical(root_, ec);
    if (ec) return false;
    const auto relative = std::filesystem::relative(candidate, root, ec);
    if (ec || relative.empty() || relative == "." || *relative.begin() == "..") return false;
    canonical = candidate.string();
    return fileExists(canonical);
}

bool BackingTrackPlayer::importFile(const std::string& name, const std::string& bytes,
                                    std::string& error) {
    const std::string safeName = sanitizeFileName(fileName(name));
    if (safeName.empty() || !supportedExtension(safeName)) {
        error = "choose a WAV, FLAC, MP3, or Ogg audio file";
        return false;
    }
    if (bytes.empty()) { error = "that audio file is empty"; return false; }
    if (bytes.size() > 64u * 1024u * 1024u) { error = "that track is larger than the 64 MB import limit"; return false; }
    std::error_code ec;
    const auto space = std::filesystem::space(root_, ec);
    if (!ec && space.available < bytes.size() + 16u * 1024u * 1024u) {
        error = "not enough free storage to import that track";
        return false;
    }
    std::filesystem::path requested(safeName);
    std::string path = joinPath(root_, safeName);
    for (unsigned copy = 2; fileExists(path); ++copy) {
        const std::string candidate = requested.stem().string() + " (" + std::to_string(copy) + ")" + requested.extension().string();
        path = joinPath(root_, candidate);
    }
    if (!writeFileAtomic(path, bytes)) {
        error = "could not store backing track";
        return false;
    }
    refreshPlaylist();
    return load(path, error);
}

bool BackingTrackPlayer::load(const std::string& path, std::string& error) {
    std::string safePath;
    if (!safeLibraryPath(path, safePath)) {
        error = "backing track does not exist in the track library";
        return false;
    }
    {
        std::lock_guard<std::mutex> lock(playlistMutex_);
        const auto found = std::find(playlist_.begin(), playlist_.end(), safePath);
        if (found == playlist_.end()) {
            playlist_.push_back(safePath);
            playlistIndex_ = playlist_.size() - 1;
            savePlaylistUnlocked();
        } else {
            playlistIndex_ = static_cast<size_t>(std::distance(playlist_.begin(), found));
        }
    }
    playing_.store(false, std::memory_order_release);
    loaded_.store(false, std::memory_order_release);
    loadPending_.store(true, std::memory_order_release);
    playbackStarted_.store(false, std::memory_order_release);
    {
        std::lock_guard<std::mutex> lock(stateMutex_);
        state_.set("path", safePath); state_.set("name", fileName(safePath));
        state_.set("status", "loading"); state_.set("error", "");
    }
    enqueue(Command{CommandType::Load, safePath, 0.0});
    error.clear();
    return true;
}

void BackingTrackPlayer::next() {
    const bool resume = playing_.load(std::memory_order_acquire);
    std::string path;
    {
        std::lock_guard<std::mutex> lock(playlistMutex_);
        const auto active = std::find_if(setLists_.begin(), setLists_.end(), [&](const SetList& list) { return list.id == activeSetListId_; });
        if (active != setLists_.end() && !active->entries.empty()) {
            setListIndex_ = (setListIndex_ + 1) % active->entries.size();
            path = active->entries[setListIndex_];
        } else {
            if (playlist_.empty()) return;
            playlistIndex_ = (playlistIndex_ + 1) % playlist_.size();
            path = playlist_[playlistIndex_];
        }
    }
    std::string ignored;
    load(path, ignored);
    if (resume) play();
}

void BackingTrackPlayer::previous() {
    const bool resume = playing_.load(std::memory_order_acquire);
    std::string path;
    {
        std::lock_guard<std::mutex> lock(playlistMutex_);
        const auto active = std::find_if(setLists_.begin(), setLists_.end(), [&](const SetList& list) { return list.id == activeSetListId_; });
        if (active != setLists_.end() && !active->entries.empty()) {
            setListIndex_ = setListIndex_ == 0 ? active->entries.size() - 1 : setListIndex_ - 1;
            path = active->entries[setListIndex_];
        } else {
            if (playlist_.empty()) return;
            playlistIndex_ = playlistIndex_ == 0 ? playlist_.size() - 1 : playlistIndex_ - 1;
            path = playlist_[playlistIndex_];
        }
    }
    std::string ignored;
    load(path, ignored);
    if (resume) play();
}

void BackingTrackPlayer::savePlaylistUnlocked() {
    Json list = Json::array();
    for (const std::string& path : playlist_) list.push(path);
    writeFileAtomic(joinPath(root_, "playlist.json"), list.dump(2));
}

void BackingTrackPlayer::loadSetLists() {
    std::string contents;
    if (!readFile(joinPath(root_, "setlists.json"), contents)) return;
    std::string error;
    const Json root = Json::parse(contents, &error);
    if (!error.empty() || !root.isObject() || root["version"].asInt(0) != 1) return;
    std::lock_guard<std::mutex> lock(playlistMutex_);
    activeSetListId_ = root["activeId"].asString();
    for (const Json& raw : root["setLists"].items()) {
        SetList list;
        list.id = raw["id"].asString();
        list.name = raw["name"].asString();
        if (list.id.empty() || list.name.empty()) continue;
        for (const Json& entry : raw["entries"].items()) if (entry.isString()) list.entries.push_back(entry.asString());
        setLists_.push_back(std::move(list));
    }
    if (setLists_.empty()) {
        activeSetListId_.clear();
    } else if (std::none_of(setLists_.begin(), setLists_.end(), [&](const SetList& list) { return list.id == activeSetListId_; })) {
        activeSetListId_ = setLists_.front().id;
    }
}

void BackingTrackPlayer::saveSetListsUnlocked() {
    Json root = Json::object();
    root.set("version", 1);
    root.set("activeId", activeSetListId_);
    Json lists = Json::array();
    for (const SetList& list : setLists_) {
        Json raw = Json::object(); raw.set("id", list.id); raw.set("name", list.name);
        Json entries = Json::array(); for (const std::string& path : list.entries) entries.push(path);
        raw.set("entries", entries); lists.push(raw);
    }
    root.set("setLists", lists);
    writeFileAtomic(joinPath(root_, "setlists.json"), root.dump(2));
}

void BackingTrackPlayer::loadTrackSettings() {
    std::string contents;
    if (!readFile(joinPath(root_, "track-metadata.json"), contents)) return;
    std::string error;
    const Json root = Json::parse(contents, &error);
    if (!error.empty() || root["version"].asInt(0) != 1) return;
    std::lock_guard<std::mutex> lock(metadataMutex_);
    for (const Json& raw : root["tracks"].items()) {
        const std::string path = raw["path"].asString();
        if (path.empty()) continue;
        TrackSettings settings;
        settings.title = raw["title"].asString(); settings.artist = raw["artist"].asString();
        settings.album = raw["album"].asString(); settings.notes = raw["notes"].asString();
        settings.bpm = raw["bpm"].asDouble(0.0); settings.level = raw["level"].asFloat(1.0f);
        settings.loopEnabled = raw["loopEnabled"].asBool(false);
        settings.loopStart = raw["loopStart"].asDouble(0.0); settings.loopEnd = raw["loopEnd"].asDouble(0.0);
        trackSettings_[path] = std::move(settings);
    }
}

void BackingTrackPlayer::saveTrackSettingsUnlocked() {
    Json root = Json::object(); root.set("version", 1); Json tracks = Json::array();
    for (const auto& item : trackSettings_) {
        Json raw = Json::object(); raw.set("path", item.first); raw.set("title", item.second.title);
        raw.set("artist", item.second.artist); raw.set("album", item.second.album); raw.set("notes", item.second.notes);
        raw.set("bpm", item.second.bpm); raw.set("level", item.second.level);
        raw.set("loopEnabled", item.second.loopEnabled); raw.set("loopStart", item.second.loopStart); raw.set("loopEnd", item.second.loopEnd);
        tracks.push(raw);
    }
    root.set("tracks", tracks); writeFileAtomic(joinPath(root_, "track-metadata.json"), root.dump(2));
}

bool BackingTrackPlayer::updateTrackSettings(const Json& payload, std::string& error) {
    std::string path;
    {
        std::lock_guard<std::mutex> lock(stateMutex_);
        path = state_["path"].asString();
    }
    if (path.empty()) { error = "load a track first"; return false; }
    TrackSettings settings;
    {
        std::lock_guard<std::mutex> lock(metadataMutex_);
        settings = trackSettings_[path];
        if (payload.has("title")) settings.title = payload["title"].asString();
        if (payload.has("artist")) settings.artist = payload["artist"].asString();
        if (payload.has("album")) settings.album = payload["album"].asString();
        if (payload.has("notes")) settings.notes = payload["notes"].asString();
        if (payload.has("bpm")) settings.bpm = std::max(0.0, std::min(300.0, payload["bpm"].asDouble()));
        if (payload.has("level")) settings.level = std::max(0.0f, std::min(1.5f, payload["level"].asFloat()));
        if (payload.has("loopEnabled")) settings.loopEnabled = payload["loopEnabled"].asBool();
        if (payload.has("loopStart")) settings.loopStart = std::max(0.0, payload["loopStart"].asDouble());
        if (payload.has("loopEnd")) settings.loopEnd = std::max(settings.loopStart, payload["loopEnd"].asDouble());
        trackSettings_[path] = settings;
        saveTrackSettingsUnlocked();
    }
    if (payload.has("bpm")) manualBpmMilli_.store(toMilli(settings.bpm), std::memory_order_release);
    if (payload.has("level")) levelMilli_.store(toMilli(settings.level), std::memory_order_release);
    if (payload.has("loopEnabled") || payload.has("loopStart") || payload.has("loopEnd")) {
        setLoop(settings.loopEnabled, settings.loopStart, settings.loopEnd);
    }
    {
        std::lock_guard<std::mutex> lock(stateMutex_);
        state_.set("title", settings.title); state_.set("artist", settings.artist);
        state_.set("album", settings.album); state_.set("notes", settings.notes);
    }
    error.clear(); return true;
}

bool BackingTrackPlayer::setListCommand(const std::string& command, const Json& payload, std::string& error) {
    std::lock_guard<std::mutex> lock(playlistMutex_);
    if (command == "create") {
        const std::string name = payload["name"].asString();
        if (name.empty()) { error = "give the set list a name"; return false; }
        setLists_.push_back(SetList{setListId(), name, {}});
        activeSetListId_ = setLists_.back().id; setListIndex_ = 0;
    } else {
        const std::string id = payload["id"].asString(activeSetListId_);
        if (command == "select" && id.empty()) {
            activeSetListId_.clear();
            setListIndex_ = 0;
            saveSetListsUnlocked();
            error.clear();
            return true;
        }
        auto found = std::find_if(setLists_.begin(), setLists_.end(), [&](const SetList& list) { return list.id == id; });
        if (found == setLists_.end()) { error = "set list not found"; return false; }
        if (command == "select") { activeSetListId_ = found->id; setListIndex_ = 0; }
        else if (command == "rename") { const std::string name = payload["name"].asString(); if (name.empty()) { error = "give the set list a name"; return false; } found->name = name; }
        else if (command == "delete") { setLists_.erase(found); activeSetListId_ = setLists_.empty() ? "" : setLists_.front().id; setListIndex_ = 0; }
        else if (command == "add") { std::string path; if (!safeLibraryPath(payload["path"].asString(), path)) { error = "track not found"; return false; } found->entries.push_back(path); }
        else if (command == "remove") { const int index = payload["index"].asInt(-1); if (index < 0 || static_cast<size_t>(index) >= found->entries.size()) { error = "set-list entry not found"; return false; } found->entries.erase(found->entries.begin() + index); if (setListIndex_ >= found->entries.size()) setListIndex_ = found->entries.empty() ? 0 : found->entries.size() - 1; }
        else if (command == "move") { const int from = payload["from"].asInt(-1); const int to = payload["to"].asInt(-1); if (from < 0 || to < 0 || static_cast<size_t>(from) >= found->entries.size() || static_cast<size_t>(to) >= found->entries.size()) { error = "set-list position is invalid"; return false; } const std::string path = found->entries[static_cast<size_t>(from)]; found->entries.erase(found->entries.begin() + from); found->entries.insert(found->entries.begin() + to, path); setListIndex_ = static_cast<size_t>(to); }
        else { error = "unknown set-list command"; return false; }
    }
    saveSetListsUnlocked(); error.clear(); return true;
}

bool BackingTrackPlayer::loadSetListEntry(int index, std::string& error) {
    const bool resume = playing_.load(std::memory_order_acquire);
    std::string path;
    {
        std::lock_guard<std::mutex> lock(playlistMutex_);
        const auto found = std::find_if(setLists_.begin(), setLists_.end(), [&](const SetList& list) { return list.id == activeSetListId_; });
        if (found == setLists_.end() || index < 0 || static_cast<size_t>(index) >= found->entries.size()) {
            error = "set-list entry not found";
            return false;
        }
        setListIndex_ = static_cast<size_t>(index);
        path = found->entries[setListIndex_];
    }
    const bool loaded = load(path, error);
    if (loaded && resume) play();
    return loaded;
}

void BackingTrackPlayer::refreshPlaylist() {
    std::vector<std::string> found;
    std::error_code ec;
    for (const auto& entry : std::filesystem::recursive_directory_iterator(root_, ec)) {
        if (ec) break;
        if (entry.is_regular_file(ec) && supportedExtension(entry.path().string())) {
            found.push_back(std::filesystem::weakly_canonical(entry.path(), ec).string());
        }
    }
    std::sort(found.begin(), found.end());
    const std::unordered_set<std::string> available(found.begin(), found.end());
    std::lock_guard<std::mutex> lock(playlistMutex_);
    playlist_.erase(std::remove_if(playlist_.begin(), playlist_.end(), [&](const std::string& path) {
        return available.find(path) == available.end();
    }), playlist_.end());
    for (const std::string& path : found) {
        if (std::find(playlist_.begin(), playlist_.end(), path) == playlist_.end()) playlist_.push_back(path);
    }
    for (SetList& list : setLists_) {
        for (std::string& path : list.entries) {
            if (available.find(path) != available.end()) continue;
            const std::string name = fileName(path);
            const auto replacement = std::find_if(found.begin(), found.end(), [&](const std::string& candidate) { return fileName(candidate) == name; });
            if (replacement != found.end()) path = *replacement;
        }
        list.entries.erase(std::remove_if(list.entries.begin(), list.entries.end(), [&](const std::string& path) { return available.find(path) == available.end(); }), list.entries.end());
    }
    if (playlistIndex_ >= playlist_.size()) playlistIndex_ = playlist_.empty() ? 0 : playlist_.size() - 1;
    savePlaylistUnlocked();
    saveSetListsUnlocked();
}

void BackingTrackPlayer::fileMoved(const std::string& oldPath, const std::string& newPath) {
    std::error_code ec;
    const std::string oldPrefix = std::filesystem::absolute(oldPath, ec).lexically_normal().string();
    const std::string newPrefix = std::filesystem::weakly_canonical(newPath, ec).string();
    if (ec) return;
    std::string checked;
    if (std::filesystem::is_regular_file(newPrefix, ec) && !safeLibraryPath(newPrefix, checked)) return;
    auto remap = [&](std::string& path) {
        if (path == oldPrefix) path = newPrefix;
        else if (path.size() > oldPrefix.size() && path.compare(0, oldPrefix.size(), oldPrefix) == 0
                 && (path[oldPrefix.size()] == '/' || path[oldPrefix.size()] == '\\')) {
            path = newPrefix + path.substr(oldPrefix.size());
        }
    };
    {
        std::lock_guard<std::mutex> lock(playlistMutex_);
        for (std::string& path : playlist_) remap(path);
        for (SetList& list : setLists_) for (std::string& path : list.entries) remap(path);
        savePlaylistUnlocked(); saveSetListsUnlocked();
    }
    {
        std::lock_guard<std::mutex> lock(metadataMutex_);
        std::unordered_map<std::string, TrackSettings> remapped;
        for (auto& item : trackSettings_) { std::string path = item.first; remap(path); remapped[path] = std::move(item.second); }
        trackSettings_ = std::move(remapped); saveTrackSettingsUnlocked();
    }
    {
        std::lock_guard<std::mutex> lock(stateMutex_);
        std::string path = state_["path"].asString(); remap(path);
        if (path != state_["path"].asString()) { state_.set("path", path); state_.set("name", fileName(path)); }
    }
}

void BackingTrackPlayer::fileDeleted(const std::string& path) {
    std::error_code ec;
    const std::string deleted = std::filesystem::absolute(path, ec).lexically_normal().string();
    if (ec || deleted.empty()) return;
    const auto matches = [&](const std::string& candidate) {
        return candidate == deleted
            || (candidate.size() > deleted.size()
                && candidate.compare(0, deleted.size(), deleted) == 0
                && (candidate[deleted.size()] == '/' || candidate[deleted.size()] == '\\'));
    };

    {
        std::lock_guard<std::mutex> lock(playlistMutex_);
        playlist_.erase(std::remove_if(playlist_.begin(), playlist_.end(), matches), playlist_.end());
        for (SetList& list : setLists_) {
            list.entries.erase(std::remove_if(list.entries.begin(), list.entries.end(), matches), list.entries.end());
        }
        if (playlistIndex_ >= playlist_.size()) playlistIndex_ = playlist_.empty() ? 0 : playlist_.size() - 1;
        savePlaylistUnlocked();
        saveSetListsUnlocked();
    }
    {
        std::lock_guard<std::mutex> lock(metadataMutex_);
        for (auto item = trackSettings_.begin(); item != trackSettings_.end();) {
            if (matches(item->first)) item = trackSettings_.erase(item); else ++item;
        }
        saveTrackSettingsUnlocked();
    }

    bool unload = false;
    {
        std::lock_guard<std::mutex> lock(stateMutex_);
        unload = matches(state_["path"].asString());
        if (unload) {
            waveform_.clear();
            state_ = Json::object();
            state_.set("type", "backing");
            state_.set("error", "");
            state_.set("status", "empty");
        }
    }
    if (unload) {
        playing_.store(false, std::memory_order_release);
        loaded_.store(false, std::memory_order_release);
        loadPending_.store(false, std::memory_order_release);
        playbackStarted_.store(false, std::memory_order_release);
        durationMillis_.store(0, std::memory_order_release);
        positionMillis_.store(0, std::memory_order_release);
        loopEnabled_.store(false, std::memory_order_release);
        enqueue(Command{CommandType::Unload, {}, 0.0});
    }
}

void BackingTrackPlayer::play() {
    if (!loaded_.load(std::memory_order_acquire) && !loadPending_.load(std::memory_order_acquire)) return;
    playbackStarted_.store(true, std::memory_order_release);
    playing_.store(true, std::memory_order_release);
    wake_.notify_one();
}

void BackingTrackPlayer::pause() {
    if (loaded_.load(std::memory_order_acquire) || loadPending_.load(std::memory_order_acquire)) {
        playing_.store(false, std::memory_order_release);
    }
}

void BackingTrackPlayer::stopPlayback() {
    if (!loaded_.load(std::memory_order_acquire) && !loadPending_.load(std::memory_order_acquire)) return;
    playing_.store(false, std::memory_order_release);
    playbackStarted_.store(false, std::memory_order_release);
    enqueue(Command{CommandType::Stop, {}, 0.0});
    std::lock_guard<std::mutex> lock(stateMutex_); state_.set("status", "ready");
}

void BackingTrackPlayer::restart() {
    if (!loaded_.load(std::memory_order_acquire) && !loadPending_.load(std::memory_order_acquire)) return;
    enqueue(Command{CommandType::Restart, {}, 0.0});
    playbackStarted_.store(true, std::memory_order_release);
    playing_.store(true, std::memory_order_release);
    std::lock_guard<std::mutex> lock(stateMutex_); state_.set("status", "seeking");
}

void BackingTrackPlayer::seek(double seconds) {
    if (!loaded_.load(std::memory_order_acquire) && !loadPending_.load(std::memory_order_acquire)) return;
    const double bounded = std::max(0.0, std::min(fromMilli(durationMillis_.load(std::memory_order_acquire)), seconds));
    enqueue(Command{CommandType::Seek, {}, bounded});
    std::lock_guard<std::mutex> lock(stateMutex_); state_.set("status", "seeking");
}

void BackingTrackPlayer::setLevel(float level) {
    levelMilli_.store(toMilli(std::max(0.0f, std::min(1.5f, level))), std::memory_order_release);
}

void BackingTrackPlayer::setManualBpm(double bpm) {
    manualBpmMilli_.store(toMilli(std::max(0.0, std::min(300.0, bpm))), std::memory_order_release);
}

void BackingTrackPlayer::setLoop(bool enabled, double start, double end) {
    const double trackDuration = fromMilli(durationMillis_.load(std::memory_order_acquire));
    const double boundedStart = std::max(0.0, std::min(trackDuration, start));
    const double boundedEnd = std::max(boundedStart, std::min(trackDuration, end));
    loopStartMillis_.store(toMilli(boundedStart), std::memory_order_release);
    loopEndMillis_.store(toMilli(boundedEnd), std::memory_order_release);
    loopEnabled_.store(enabled && boundedEnd > boundedStart, std::memory_order_release);
    if (loaded_.load(std::memory_order_acquire)) {
        double refillAt = fromMilli(positionMillis_.load(std::memory_order_acquire));
        if (loopEnabled_.load(std::memory_order_acquire)
            && (refillAt < boundedStart || refillAt >= boundedEnd)) refillAt = boundedStart;
        enqueue(Command{CommandType::Seek, {}, refillAt});
    }
}

void BackingTrackPlayer::resetProducerBuffer(double positionSeconds) {
    bufferResetting_.store(true, std::memory_order_release);
    writeFrame_.store(0, std::memory_order_relaxed);
    resetPositionMillis_.store(toMilli(positionSeconds), std::memory_order_relaxed);
    decodeEof_.store(false, std::memory_order_relaxed);
    bufferGeneration_.fetch_add(1, std::memory_order_release);
}

size_t BackingTrackPlayer::writableFrames() {
    if (acknowledgedGeneration_.load(std::memory_order_acquire)
        != bufferGeneration_.load(std::memory_order_acquire)) return 0;
    bufferResetting_.store(false, std::memory_order_release);
    const size_t write = writeFrame_.load(std::memory_order_relaxed);
    const size_t read = readFrame_.load(std::memory_order_acquire);
    return (read - write - 1) & ringFrameMask_;
}

size_t BackingTrackPlayer::writeStereo(const float* stereo, size_t frames) {
    const size_t count = std::min(frames, writableFrames());
    size_t write = writeFrame_.load(std::memory_order_relaxed);
    for (size_t frame = 0; frame < count; ++frame) {
        const size_t index = ((write + frame) & ringFrameMask_) * 2;
        ring_[index] = stereo[frame * 2];
        ring_[index + 1] = stereo[frame * 2 + 1];
    }
    writeFrame_.store((write + count) & ringFrameMask_, std::memory_order_release);
    return count;
}

void BackingTrackPlayer::render(float* const* outputs, unsigned channels, unsigned frames) {
    const uint32_t generation = bufferGeneration_.load(std::memory_order_acquire);
    if (generation != realtimeGeneration_) {
        realtimeGeneration_ = generation;
        readFrame_.store(0, std::memory_order_relaxed);
        realtimePosition_ = fromMilli(resetPositionMillis_.load(std::memory_order_relaxed));
        realtimeHasPlayed_ = false;
        positionMillis_.store(toMilli(realtimePosition_), std::memory_order_relaxed);
        acknowledgedGeneration_.store(generation, std::memory_order_release);
    }
    if (bufferResetting_.load(std::memory_order_acquire)) return;
    if (!loaded_.load(std::memory_order_acquire) || !playing_.load(std::memory_order_relaxed)) return;

    size_t read = readFrame_.load(std::memory_order_relaxed);
    const size_t write = writeFrame_.load(std::memory_order_acquire);
    unsigned consumed = 0;
    const float gain = static_cast<float>(fromMilli(levelMilli_.load(std::memory_order_relaxed)));
    while (consumed < frames && read != write) {
        const size_t index = read * 2;
        if (channels > 0) outputs[0][consumed] += ring_[index] * gain;
        if (channels > 1) outputs[1][consumed] += ring_[index + 1] * gain;
        read = (read + 1) & ringFrameMask_;
        ++consumed;
    }
    readFrame_.store(read, std::memory_order_release);
    if (consumed > 0) { realtimeUnderrunActive_ = false; realtimeHasPlayed_ = true; }

    const unsigned rate = outputSampleRate_.load(std::memory_order_relaxed);
    realtimePosition_ += static_cast<double>(consumed) / std::max(1u, rate);
    const double loopStart = fromMilli(loopStartMillis_.load(std::memory_order_relaxed));
    const double loopEnd = fromMilli(loopEndMillis_.load(std::memory_order_relaxed));
    if (loopEnabled_.load(std::memory_order_relaxed) && loopEnd > loopStart) {
        while (realtimePosition_ >= loopEnd) realtimePosition_ = loopStart + (realtimePosition_ - loopEnd);
    }
    positionMillis_.store(toMilli(realtimePosition_), std::memory_order_relaxed);

    if (consumed < frames) {
        if (decodeEof_.load(std::memory_order_acquire)) {
            playing_.store(false, std::memory_order_release);
            if (!loopEnabled_.load(std::memory_order_relaxed)) {
                realtimePosition_ = fromMilli(durationMillis_.load(std::memory_order_relaxed));
                positionMillis_.store(toMilli(realtimePosition_), std::memory_order_relaxed);
            }
        } else if (consumed == 0 && realtimeHasPlayed_ && !realtimeUnderrunActive_) {
            underruns_.fetch_add(1, std::memory_order_relaxed);
            realtimeUnderrunActive_ = true;
        }
    }
}

Json BackingTrackPlayer::state() const {
    Json out;
    {
        std::lock_guard<std::mutex> lock(stateMutex_);
        out = state_;
        Json peaks = Json::array();
        for (float peak : waveform_) peaks.push(peak);
        out.set("waveform", peaks);
    }
    const bool loaded = loaded_.load(std::memory_order_acquire);
    const bool playing = playing_.load(std::memory_order_acquire);
    const bool ended = decodeEof_.load(std::memory_order_acquire) && !playing
        && positionMillis_.load(std::memory_order_acquire) >= durationMillis_.load(std::memory_order_acquire);
    const std::string pendingStatus = out["status"].asString();
    out.set("available", available());
    out.set("loaded", loaded);
    out.set("playing", playing);
    out.set("status", pendingStatus == "loading" || pendingStatus == "seeking" || pendingStatus == "error"
        ? pendingStatus : !loaded ? "empty" : playing ? "playing" : ended ? "ended"
        : playbackStarted_.load(std::memory_order_acquire) ? "paused" : "ready");
    out.set("position", fromMilli(positionMillis_.load()));
    out.set("duration", fromMilli(durationMillis_.load()));
    out.set("level", fromMilli(levelMilli_.load()));
    out.set("loopEnabled", loopEnabled_.load());
    out.set("loopStart", fromMilli(loopStartMillis_.load()));
    out.set("loopEnd", fromMilli(loopEndMillis_.load()));
    out.set("manualBpm", fromMilli(manualBpmMilli_.load()));
    out.set("underruns", static_cast<int64_t>(underruns_.load()));
    {
        std::lock_guard<std::mutex> lock(playlistMutex_);
        out.set("playlistIndex", static_cast<int>(playlistIndex_));
        Json list = Json::array();
        for (const std::string& path : playlist_) {
            Json item = Json::object();
            item.set("path", path);
            item.set("name", fileName(path));
            list.push(item);
        }
        out.set("playlist", list);
        out.set("activeSetListId", activeSetListId_);
        out.set("setListIndex", static_cast<int>(setListIndex_));
        Json setLists = Json::array();
        for (const SetList& setList : setLists_) {
            Json raw = Json::object(); raw.set("id", setList.id); raw.set("name", setList.name);
            Json entries = Json::array();
            for (const std::string& path : setList.entries) {
                Json entry = Json::object(); entry.set("path", path); entry.set("name", fileName(path)); entries.push(entry);
            }
            raw.set("entries", entries); setLists.push(raw);
        }
        out.set("setLists", setLists);
    }
    return out;
}

void BackingTrackPlayer::worker() {
#if defined(PIMFX_HAVE_SNDFILE) && defined(PIMFX_HAVE_SAMPLERATE)
    SNDFILE* file = nullptr;
    SF_INFO info{};
    SRC_STATE* resampler = nullptr;
    std::vector<float> raw;
    std::vector<float> stereo(kDecodeFrames * 2);
    std::vector<float> resampled(kResampleFrames * 2);
    size_t stereoFrames = 0;
    size_t stereoOffset = 0;
    sf_count_t sourceCursor = 0;
    bool sourceEof = false;
    std::string waveformPending;

    auto closeDecoder = [&]() {
        if (resampler) { src_delete(resampler); resampler = nullptr; }
        if (file) { sf_close(file); file = nullptr; }
        stereoFrames = stereoOffset = 0;
        sourceEof = false;
    };

    auto seekDecoder = [&](double seconds) {
        if (!file) return;
        const sf_count_t frame = static_cast<sf_count_t>(seconds * info.samplerate);
        sourceCursor = std::max<sf_count_t>(0, std::min(info.frames, frame));
        sf_seek(file, sourceCursor, SEEK_SET);
        if (resampler) src_reset(resampler);
        stereoFrames = stereoOffset = 0;
        sourceEof = false;
        resetProducerBuffer(static_cast<double>(sourceCursor) / std::max(1, info.samplerate));
    };

    while (!stopping_.load(std::memory_order_acquire)) {
        std::deque<Command> pending;
        {
            std::lock_guard<std::mutex> lock(commandMutex_);
            pending.swap(commands_);
        }
        for (const Command& command : pending) {
            if (command.type == CommandType::Load) {
                closeDecoder();
                info = SF_INFO{};
                file = sf_open(command.path.c_str(), SFM_READ, &info);
                if (!file || info.channels < 1 || info.samplerate < 1) {
                    closeDecoder();
                    loadPending_.store(false, std::memory_order_release);
                    loaded_.store(false, std::memory_order_release);
                    playing_.store(false, std::memory_order_release);
                    std::lock_guard<std::mutex> lock(stateMutex_);
                    state_.set("error", "unsupported or corrupt audio file");
                    state_.set("status", "error");
                    continue;
                }
                int srcError = 0;
                resampler = src_new(SRC_SINC_FASTEST, 2, &srcError);
                if (!resampler) {
                    closeDecoder();
                    loadPending_.store(false, std::memory_order_release);
                    loaded_.store(false, std::memory_order_release);
                    playing_.store(false, std::memory_order_release);
                    std::lock_guard<std::mutex> lock(stateMutex_);
                    state_.set("error", src_strerror(srcError));
                    state_.set("status", "error");
                    continue;
                }
                raw.assign(kDecodeFrames * static_cast<size_t>(info.channels), 0.0f);
                durationMillis_.store(toMilli(static_cast<double>(info.frames) / info.samplerate), std::memory_order_release);
                TrackSettings settings;
                settings.title = sf_get_string(file, SF_STR_TITLE) ? sf_get_string(file, SF_STR_TITLE) : "";
                settings.artist = sf_get_string(file, SF_STR_ARTIST) ? sf_get_string(file, SF_STR_ARTIST) : "";
                settings.album = sf_get_string(file, SF_STR_ALBUM) ? sf_get_string(file, SF_STR_ALBUM) : "";
                settings.loopEnd = fromMilli(durationMillis_.load());
                {
                    std::lock_guard<std::mutex> lock(metadataMutex_);
                    const auto saved = trackSettings_.find(command.path);
                    if (saved != trackSettings_.end()) {
                        const std::string fileTitle = settings.title, fileArtist = settings.artist, fileAlbum = settings.album;
                        settings = saved->second;
                        if (settings.title.empty()) settings.title = fileTitle;
                        if (settings.artist.empty()) settings.artist = fileArtist;
                        if (settings.album.empty()) settings.album = fileAlbum;
                    }
                }
                manualBpmMilli_.store(toMilli(settings.bpm), std::memory_order_release);
                levelMilli_.store(toMilli(settings.level), std::memory_order_release);
                const double loadedDuration = fromMilli(durationMillis_.load());
                loopStartMillis_.store(toMilli(std::max(0.0, std::min(loadedDuration, settings.loopStart))), std::memory_order_release);
                loopEndMillis_.store(toMilli(settings.loopEnd > 0.0 ? std::min(loadedDuration, settings.loopEnd) : loadedDuration), std::memory_order_release);
                loopEnabled_.store(settings.loopEnabled && loopEndMillis_.load() > loopStartMillis_.load(), std::memory_order_release);
                underruns_.store(0, std::memory_order_release);
                loaded_.store(true, std::memory_order_release);
                loadPending_.store(false, std::memory_order_release);
                sourceCursor = 0;
                seekDecoder(0.0);

                {
                    std::lock_guard<std::mutex> lock(stateMutex_);
                    waveform_.clear();
                    state_.set("path", command.path);
                    state_.set("name", fileName(command.path));
                    state_.set("format", lowerExtension(command.path).substr(1));
                    state_.set("sampleRate", info.samplerate);
                    state_.set("channels", info.channels);
                    state_.set("title", settings.title);
                    state_.set("artist", settings.artist);
                    state_.set("album", settings.album);
                    state_.set("notes", settings.notes);
                    state_.set("error", "");
                    state_.set("status", "ready");
                }
                waveformPending = command.path;
            } else if (command.type == CommandType::Seek) {
                seekDecoder(command.seconds);
                std::lock_guard<std::mutex> lock(stateMutex_); state_.set("status", "ready");
            } else if (command.type == CommandType::Restart) {
                seekDecoder(0.0);
                std::lock_guard<std::mutex> lock(stateMutex_); state_.set("status", "ready");
            } else if (command.type == CommandType::Stop) {
                seekDecoder(0.0);
                std::lock_guard<std::mutex> lock(stateMutex_); state_.set("status", "ready");
            } else if (command.type == CommandType::Unload) {
                closeDecoder();
                waveformPending.clear();
                loadPending_.store(false, std::memory_order_release);
                resetProducerBuffer(0.0);
            }
        }

        if (file && !decodeEof_.load(std::memory_order_acquire) && writableFrames() > 0) {
            if (stereoOffset >= stereoFrames) {
                const bool looping = loopEnabled_.load(std::memory_order_acquire);
                const sf_count_t loopStartFrame = static_cast<sf_count_t>(fromMilli(loopStartMillis_.load()) * info.samplerate);
                const sf_count_t loopEndFrame = static_cast<sf_count_t>(fromMilli(loopEndMillis_.load()) * info.samplerate);
                if (looping && loopEndFrame > loopStartFrame && sourceCursor >= loopEndFrame) {
                    sourceCursor = loopStartFrame;
                    sf_seek(file, sourceCursor, SEEK_SET);
                    src_reset(resampler);
                    sourceEof = false;
                }
                sf_count_t wanted = kDecodeFrames;
                if (looping && loopEndFrame > sourceCursor) wanted = std::min(wanted, loopEndFrame - sourceCursor);
                const sf_count_t got = wanted > 0 ? sf_readf_float(file, raw.data(), wanted) : 0;
                if (got <= 0) {
                    if (looping && loopEndFrame > loopStartFrame) {
                        sourceCursor = loopStartFrame;
                        sf_seek(file, sourceCursor, SEEK_SET);
                        src_reset(resampler);
                        sourceEof = false;
                    } else {
                        sourceEof = true;
                    }
                } else {
                    for (sf_count_t frame = 0; frame < got; ++frame) {
                        const float* input = raw.data() + static_cast<size_t>(frame) * info.channels;
                        float left = input[0];
                        float right = info.channels > 1 ? input[1] : input[0];
                        if (info.channels > 2) {
                            const float extraGain = 0.5f / static_cast<float>(info.channels - 2);
                            for (int channel = 2; channel < info.channels; ++channel) {
                                left += input[channel] * extraGain;
                                right += input[channel] * extraGain;
                            }
                        }
                        stereo[static_cast<size_t>(frame) * 2] = std::max(-1.0f, std::min(1.0f, left));
                        stereo[static_cast<size_t>(frame) * 2 + 1] = std::max(-1.0f, std::min(1.0f, right));
                    }
                    sourceCursor += got;
                    if (!looping && sourceCursor >= info.frames) sourceEof = true;
                    stereoFrames = static_cast<size_t>(got);
                    stereoOffset = 0;
                }
            }

            if (stereoOffset < stereoFrames || sourceEof) {
                SRC_DATA data{};
                data.data_in = stereo.data() + stereoOffset * 2;
                data.input_frames = static_cast<long>(stereoFrames - stereoOffset);
                data.data_out = resampled.data();
                data.output_frames = static_cast<long>(std::min(writableFrames(), kResampleFrames));
                data.src_ratio = static_cast<double>(outputSampleRate_.load(std::memory_order_acquire)) / info.samplerate;
                data.end_of_input = sourceEof ? 1 : 0;
                const int result = src_process(resampler, &data);
                if (result != 0) {
                    std::lock_guard<std::mutex> lock(stateMutex_);
                    state_.set("error", src_strerror(result));
                    state_.set("status", "error");
                    playing_.store(false, std::memory_order_release);
                } else {
                    stereoOffset += static_cast<size_t>(data.input_frames_used);
                    writeStereo(resampled.data(), static_cast<size_t>(data.output_frames_gen));
                    if (sourceEof && stereoOffset >= stereoFrames && data.output_frames_gen == 0) {
                        decodeEof_.store(true, std::memory_order_release);
                    }
                }
            }
        }

        // Decode is always given priority. Waveform scanning starts only after
        // at least half of the bounded playback buffer has been prefetched, or
        // immediately while paused.
        if (!waveformPending.empty() && writableFrames() < kRingFrames / 2) {
            SF_INFO scanInfo{};
            SNDFILE* scan = sf_open(waveformPending.c_str(), SFM_READ, &scanInfo);
            std::vector<float> peaks(160, 0.0f);
            if (scan && scanInfo.channels > 0) {
                std::vector<float> scanBlock(kDecodeFrames * static_cast<size_t>(scanInfo.channels));
                sf_count_t cursor = 0;
                while (cursor < scanInfo.frames) {
                    const sf_count_t got = sf_readf_float(scan, scanBlock.data(), kDecodeFrames);
                    if (got <= 0) break;
                    for (sf_count_t frame = 0; frame < got; ++frame) {
                        const size_t peakIndex = std::min(peaks.size() - 1,
                            static_cast<size_t>((cursor + frame) * peaks.size() / std::max<sf_count_t>(1, scanInfo.frames)));
                        for (int channel = 0; channel < scanInfo.channels; ++channel) {
                            peaks[peakIndex] = std::max(peaks[peakIndex],
                                std::abs(scanBlock[static_cast<size_t>(frame) * scanInfo.channels + channel]));
                        }
                    }
                    cursor += got;
                }
            }
            if (scan) sf_close(scan);
            {
                std::lock_guard<std::mutex> lock(stateMutex_);
                if (state_["path"].asString() == waveformPending) waveform_ = std::move(peaks);
            }
            waveformPending.clear();
        }

        std::unique_lock<std::mutex> lock(commandMutex_);
        wake_.wait_for(lock, std::chrono::milliseconds(5), [&]() {
            return stopping_.load(std::memory_order_acquire) || !commands_.empty();
        });
    }
    closeDecoder();
#else
    while (!stopping_.load(std::memory_order_acquire)) {
        std::unique_lock<std::mutex> lock(commandMutex_);
        wake_.wait_for(lock, std::chrono::milliseconds(100));
    }
#endif
}

}
