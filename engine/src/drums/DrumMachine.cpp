#include "drums/DrumMachine.h"

#include "core/Paths.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstring>
#include <fstream>
#include <filesystem>
#include <limits>

namespace pimfx {
namespace {

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
      projectsRoot_(joinPath(root_, "projects")) {
    for (auto& variation : program_.variations) variation.length = 16;
    program_.fill.length = 16;
    makeDirectories(root_);
    makeDirectories(samplesRoot_);
    makeDirectories(kitsRoot_);
    makeDirectories(projectsRoot_);
    for (const std::string& file : listDirectory(kitsRoot_, ".json")) savedKits_.push_back(fileStem(file));
    std::lock_guard<std::mutex> lock(stateMutex_);
    refreshProjectListsUnlocked();
    if (!projects_.empty()) projectId_ = projects_.front();
    projectName_ = projectId_;
    projectRoot_ = joinPath(projectsRoot_, projectId_);
    makeDirectories(joinPath(projectRoot_, "patterns"));
    makeDirectories(joinPath(projectRoot_, "songs"));
    statePath_ = joinPath(projectRoot_, "project.json");
    refreshProjectListsUnlocked();
    loadStateUnlocked();
    if (!fileExists(statePath_)) saveStateUnlocked();
    std::string ignored;
    sequencer_.setProgram(program_, ignored);
    sequencer_.setSwing(controlSwing_);
    sequencer_.setHumanization(controlHumanization_);
}

void DrumMachine::refreshProjectListsUnlocked() {
    projects_.clear();
    savedPatterns_.clear();
    std::error_code ec;
    for (const auto& entry : std::filesystem::directory_iterator(projectsRoot_, ec)) {
        if (entry.is_directory(ec)) projects_.push_back(entry.path().filename().string());
    }
    std::sort(projects_.begin(), projects_.end());
    const std::string patterns = joinPath(projectRoot_, "patterns");
    for (const std::string& file : listDirectory(patterns, ".json")) savedPatterns_.push_back(fileStem(file));
    std::sort(savedPatterns_.begin(), savedPatterns_.end());
}

bool DrumMachine::loadSamplesUnlocked(std::string& error) {
    Kit loaded;
    for (size_t voice = 0; voice < controlKit_.voices.size(); ++voice) {
        const std::string file = controlKit_.voices[voice].file;
        if (file.empty()) continue;
        std::string bytes; Sample sample;
        if (!readLibrarySample(file, bytes, error) || !decodeWave(bytes, sampleRate_, sample, error)) return false;
        sample.file = file; sample.name = fileStem(file); loaded.voices[voice] = std::move(sample);
    }
    controlKit_ = std::move(loaded);
    return publishKitUnlocked(error);
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
        if (readLibrarySample(file, bytes, error)
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
    Json result;
    if (!importLibrarySample(safe, bytes, result, error)) return false;
    Json load = Json::object(); load.set("voice", voice); load.set("relative", result["relative"].asString());
    return command("sample/load", load, error);
}

bool DrumMachine::samplePath(const std::string& relative, std::string& path, std::string& error) const {
    namespace fs = std::filesystem;
    const fs::path rel(relative);
    for (unsigned char c : relative) if (c < 32 || c == 127) { error = "invalid drum sample path"; return false; }
    if (relative.empty() || rel.is_absolute() || rel.has_root_name() || relative.find('\\') != std::string::npos) {
        error = "use a relative path inside drum samples"; return false;
    }
    for (const auto& part : rel) {
        if (part == ".." || part == "." || part.string().find(':') != std::string::npos) {
            error = "invalid drum sample path"; return false;
        }
    }
    std::string safe;
    if (!safeWaveName(rel.filename().string(), safe)) { error = "select a WAV sample"; return false; }
    std::string rootText, targetText;
    if (!resolveLibraryPath(samplesRoot_, rootText)) { error = "could not resolve samples folder"; return false; }
    const fs::path root(rootText);
    if (!resolveLibraryPath((root / rel).string(), targetText)) { error = "could not resolve sample path"; return false; }
    const fs::path target(targetText);
    auto a = root.begin(), b = target.begin();
    for (; a != root.end(); ++a, ++b) {
        if (b == target.end() || *a != *b) { error = "sample is outside the drum library"; return false; }
    }
    path = target.string(); return true;
}

bool DrumMachine::readLibrarySample(const std::string& relative, std::string& bytes, std::string& error) const {
    std::string path;
    if (!samplePath(relative, path, error)) return false;
    std::error_code ec;
    const auto size = std::filesystem::file_size(path, ec);
    if (ec || size > 32u * 1024u * 1024u || !readFile(path, bytes)) {
        error = "could not read that drum sample"; return false;
    }
    return true;
}

bool DrumMachine::canEditLibraryPath(const std::string& path, std::string& error) const {
    std::lock_guard<std::mutex> lock(stateMutex_);
    namespace fs = std::filesystem;
    std::error_code ec;
    const auto root = fs::weakly_canonical(samplesRoot_, ec);
    const auto target = fs::weakly_canonical(path, ec);
    if (ec) { error = "could not resolve library path"; return false; }
    const auto linked = [&](const std::string& file) {
        if (file.empty()) return false;
        const auto sample = fs::weakly_canonical(root / file, ec);
        if (ec) return true;
        auto a = target.begin(), b = sample.begin();
        for (; a != target.end(); ++a, ++b) if (b == sample.end() || *a != *b) return false;
        return true;
    };
    for (const auto& sample : controlKit_.voices) if (linked(sample.file)) {
        error = "sample is used by the current kit; remove it from the kit first"; return false;
    }
    for (const auto& name : savedKits_) {
        std::string text;
        if (!readFile(joinPath(kitsRoot_, name + ".json"), text)) continue;
        std::string parseError; const Json manifest = Json::parse(text, &parseError);
        if (!parseError.empty()) { error = "could not check saved kit references"; return false; }
        for (size_t i = 0; i < manifest["samples"].size(); ++i) if (linked(manifest["samples"].at(i).asString())) {
            error = "sample is used by saved kit " + name + "; update or delete that kit first"; return false;
        }
    }
    return true;
}

bool DrumMachine::importLibrarySample(const std::string& relative, const std::string& bytes,
                                     Json& result, std::string& error) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    if (bytes.empty() || bytes.size() > 32u * 1024u * 1024u) { error = "WAV limit is 32 MB"; return false; }
    std::string path;
    if (!samplePath(relative, path, error)) return false;
    Sample decoded;
    if (!decodeWave(bytes, sampleRate_, decoded, error)) return false;
    namespace fs = std::filesystem;
    std::error_code ec;
    // Compare content, not names: identical WAVs in different folders are not imported twice.
    for (fs::recursive_directory_iterator it(samplesRoot_, fs::directory_options::skip_permission_denied, ec), end;
         it != end && !ec; it.increment(ec)) {
        if (it->is_symlink(ec)) { it.disable_recursion_pending(); continue; }
        if (!it->is_regular_file(ec) || it->file_size(ec) != bytes.size()) continue;
        std::string existing;
        if (readFile(it->path().string(), existing) && existing == bytes) {
            result = Json::object(); result.set("duplicate", true);
            result.set("relative", fs::relative(it->path(), samplesRoot_, ec).generic_string()); return true;
        }
    }
    if (ec) { error = "could not scan drum samples for duplicates"; return false; }
    if (fs::exists(path, ec)) { error = "a different sample already has that name; rename it before importing"; return false; }
    fs::create_directories(fs::path(path).parent_path(), ec);
    if (ec || !writeFileAtomic(path, bytes)) { error = "could not save drum sample"; return false; }
    result = Json::object(); result.set("duplicate", false); result.set("relative", relative); return true;
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
    const DrumSequencer::Program& editable = patternPreviewActive_ ? patternPreviewBackup_ : program_;
    if (voice >= DrumSequencer::kVoiceCount || step >= editable.variations[0].length
        || (!fill && variation >= DrumSequencer::kVariationCount)) {
        error = "invalid drum step";
        return false;
    }
    if (patternPreviewActive_) { program_ = patternPreviewBackup_; patternPreviewActive_ = false; }
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
    if (patternPreviewActive_) { program_ = patternPreviewBackup_; patternPreviewActive_ = false; }
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
    const DrumSequencer::Program& editable = patternPreviewActive_ ? patternPreviewBackup_ : program_;
    const unsigned length = static_cast<unsigned>(payload["length"].asInt(editable.variations[0].length));
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
    return applyKitManifest(manifest, safe, error);
}

bool DrumMachine::applyKitManifest(const Json& manifest, const std::string& fallbackName, std::string& error) {
    if (manifest["schemaVersion"].asInt(0) != 1 || !manifest["samples"].isArray()) {
        error = "that drum kit file is invalid"; return false;
    }
    Kit loaded;
    for (size_t voice = 0; voice < std::min(manifest["samples"].size(), DrumSequencer::kVoiceCount); ++voice) {
        const std::string file = manifest["samples"].at(voice).asString();
        if (file.empty() || manifest["samples"].at(voice).asString().empty()) continue;
        std::string bytes; Sample sample;
        if (!readLibrarySample(file, bytes, error) || !decodeWave(bytes, sampleRate_, sample, error)) return false;
        sample.file = file; sample.name = fileStem(file); loaded.voices[voice] = std::move(sample);
    }
    controlKit_ = std::move(loaded); kitName_ = manifest["name"].asString(fallbackName);
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

bool DrumMachine::newProject(const Json& payload, std::string& error) {
    const std::string safe = sanitizeFileName(payload["name"].asString("New Drum Project"));
    if (safe.empty()) { error = "give the drum project a name"; return false; }
    const std::string nextRoot = joinPath(projectsRoot_, safe);
    std::error_code ec;
    if (std::filesystem::exists(nextRoot, ec)) { error = "a drum project already has that name"; return false; }
    if (!makeDirectories(joinPath(nextRoot, "patterns")) || !makeDirectories(joinPath(nextRoot, "songs"))) {
        error = "could not create the drum project"; return false;
    }
    patternPreviewActive_ = false;
    projectId_ = safe; projectName_ = safe; projectRoot_ = nextRoot;
    statePath_ = joinPath(projectRoot_, "project.json");
    program_ = DrumSequencer::Program{};
    for (auto& variation : program_.variations) variation.length = 16;
    program_.fill.length = 16;
    controlKit_ = Kit{}; kitName_ = "Custom";
    playing_.store(false, std::memory_order_release);
    sequencer_.setSongMode(false);
    controlLevel_ = 0.8f; controlSwing_ = 0.0f; controlHumanization_ = 0.0f;
    levelPermille_.store(800, std::memory_order_release);
    if (!publishProgramUnlocked(error) || !publishKitUnlocked(error) || !saveStateUnlocked()) {
        if (error.empty()) error = "could not save the drum project";
        return false;
    }
    if (patternPreviewActive_) { program_ = patternPreviewBackup_; patternPreviewActive_ = false; }
    refreshProjectListsUnlocked();
    return true;
}

bool DrumMachine::openProject(const Json& payload, std::string& error) {
    const std::string requested = payload["id"].asString();
    const std::string safe = sanitizeFileName(requested);
    const std::string nextRoot = joinPath(projectsRoot_, safe);
    std::error_code ec;
    if (safe != requested || !std::filesystem::is_directory(nextRoot, ec)) {
        error = "that drum project was not found"; return false;
    }
    patternPreviewActive_ = false;
    projectId_ = safe; projectName_ = safe; projectRoot_ = nextRoot;
    statePath_ = joinPath(projectRoot_, "project.json");
    program_ = DrumSequencer::Program{};
    for (auto& variation : program_.variations) variation.length = 16;
    program_.fill.length = 16;
    controlKit_ = Kit{}; kitName_ = "Custom";
    playing_.store(false, std::memory_order_release);
    sequencer_.setSongMode(false);
    if (!loadStateUnlocked()) { error = "that drum project is invalid"; return false; }
    if (!publishProgramUnlocked(error) || !loadSamplesUnlocked(error)) return false;
    refreshProjectListsUnlocked();
    return true;
}

bool DrumMachine::deleteProject(const Json& payload, std::string& error) {
    if (!payload["confirmed"].asBool(false)) { error = "deleting a drum project requires confirmation"; return false; }
    const std::string requested = payload["id"].asString();
    const std::string safe = sanitizeFileName(requested);
    if (safe != requested) { error = "that drum project name is invalid"; return false; }
    if (safe == projectId_) { error = "open another drum project before deleting this one"; return false; }
    const std::string target = joinPath(projectsRoot_, safe);
    std::error_code ec;
    if (!std::filesystem::is_directory(target, ec)) { error = "that drum project was not found"; return false; }
    std::filesystem::remove_all(target, ec);
    if (ec) { error = "could not delete the drum project"; return false; }
    refreshProjectListsUnlocked();
    return true;
}

bool DrumMachine::savePattern(const Json& payload, std::string& error) {
    const std::string safe = sanitizeFileName(payload["name"].asString("Pattern"));
    if (safe.empty()) { error = "give the pattern a name"; return false; }
    Json root = Json::object(); root.set("schemaVersion", 1);
    Json variations = Json::array();
    for (const auto& variation : program_.variations) variations.push(patternToJson(variation));
    root.set("variations", std::move(variations)); root.set("fill", patternToJson(program_.fill));
    if (!writeFileAtomic(joinPath(joinPath(projectRoot_, "patterns"), safe + ".json"), root.dump(2))) {
        error = "could not save the drum pattern"; return false;
    }
    refreshProjectListsUnlocked(); return true;
}

bool DrumMachine::loadPattern(const Json& payload, std::string& error) {
    const std::string safe = sanitizeFileName(fileStem(payload["name"].asString()));
    std::string text;
    if (!readFile(joinPath(joinPath(projectRoot_, "patterns"), safe + ".json"), text)) {
        error = "that drum pattern was not found"; return false;
    }
    std::string parseError; const Json root = Json::parse(text, &parseError);
    if (!parseError.empty()) { error = "that drum pattern file is invalid"; return false; }
    return applyPattern(root, true, error);
}

bool DrumMachine::applyPattern(const Json& root, bool persist, std::string& error) {
    if (root["schemaVersion"].asInt(0) != 1 || !root["variations"].isArray()) {
        error = "that drum pattern file is invalid"; return false;
    }
    DrumSequencer::Program next = program_;
    for (size_t index = 0; index < std::min(root["variations"].size(), DrumSequencer::kVariationCount); ++index)
        if (!patternFromJson(root["variations"].at(index), next.variations[index])) {
            error = "that drum pattern file is invalid"; return false;
        }
    if (!patternFromJson(root["fill"], next.fill)) { error = "that drum fill is invalid"; return false; }
    program_ = next;
    if (!publishProgramUnlocked(error) || (persist && !saveStateUnlocked())) {
        if (error.empty()) error = "could not load the drum pattern";
        return false;
    }
    if (persist) patternPreviewActive_ = false;
    return true;
}

bool DrumMachine::applySong(const Json& root, std::string& error) {
    if (root["schemaVersion"].asInt(0) != 1 || !root["variations"].isArray()
        || root["variations"].size() != DrumSequencer::kVariationCount
        || !root["song"].isArray() || !root["kit"].isObject()
        || !root["kit"]["samples"].isArray()) {
        error = "that drum song file is invalid";
        return false;
    }
    DrumSequencer::Program next = program_;
    for (size_t index = 0; index < std::min(root["variations"].size(), DrumSequencer::kVariationCount); ++index) {
        if (!patternFromJson(root["variations"].at(index), next.variations[index])) {
            error = "that drum song contains an invalid pattern";
            return false;
        }
    }
    if (!patternFromJson(root["fill"], next.fill)
        || root["song"].size() > DrumSequencer::kMaxSongSections) {
        error = "that drum song arrangement is invalid";
        return false;
    }
    next.songLength = static_cast<uint8_t>(root["song"].size());
    for (size_t index = 0; index < root["song"].size(); ++index) {
        const int variation = root["song"].at(index)["variation"].asInt(-1);
        const int repeats = root["song"].at(index)["repeats"].asInt(0);
        if (variation < 0 || variation >= static_cast<int>(DrumSequencer::kVariationCount)
            || repeats < 1 || repeats > 16) {
            error = "that drum song section is invalid";
            return false;
        }
        next.song[index].variation = static_cast<uint8_t>(variation);
        next.song[index].repeats = static_cast<uint8_t>(repeats);
    }
    Kit loaded;
    const Json& samples = root["kit"]["samples"];
    if (samples.size() > DrumSequencer::kVoiceCount) {
        error = "that drum song contains too many drum voices";
        return false;
    }
    for (size_t voice = 0; voice < samples.size(); ++voice) {
        const std::string file = samples.at(voice).asString();
        if (file.empty()) continue;
        std::string bytes; Sample sample;
        if (!readLibrarySample(file, bytes, error) || !decodeWave(bytes, sampleRate_, sample, error)) return false;
        sample.file = file; sample.name = fileStem(file); loaded.voices[voice] = std::move(sample);
    }
    program_ = std::move(next);
    controlKit_ = std::move(loaded);
    kitName_ = root["kit"]["name"].asString("Custom");
    controlLevel_ = std::max(0.0f, std::min(1.5f, root["level"].asFloat(controlLevel_)));
    controlSwing_ = clampUnit(root["swing"].asFloat(controlSwing_));
    controlHumanization_ = clampUnit(root["humanization"].asFloat(controlHumanization_));
    levelPermille_.store(static_cast<uint32_t>(std::lround(controlLevel_ * 1000.0f)), std::memory_order_release);
    patternPreviewActive_ = false;
    if (!publishProgramUnlocked(error) || !publishKitUnlocked(error)) return false;
    sequencer_.setSongMode(true);
    if (!saveStateUnlocked()) { error = "could not save the loaded drum song"; return false; }
    return true;
}

bool DrumMachine::deletePattern(const Json& payload, std::string& error) {
    if (!payload["confirmed"].asBool(false)) { error = "deleting a drum pattern requires confirmation"; return false; }
    const std::string safe = sanitizeFileName(fileStem(payload["name"].asString()));
    if (!removeFile(joinPath(joinPath(projectRoot_, "patterns"), safe + ".json"))) {
        error = "could not delete the drum pattern"; return false;
    }
    refreshProjectListsUnlocked(); return true;
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
    if (commandName == "song/apply") return applySong(payload["song"], error);
    if (commandName == "variation") {
        const unsigned variation = static_cast<unsigned>(payload["variation"].asInt(-1));
        if (variation >= DrumSequencer::kVariationCount) { error = "invalid drum variation"; return false; }
        sequencer_.requestVariation(variation); return true;
    }
    if (commandName == "fill") { sequencer_.triggerFill(); return true; }
    if (commandName == "song/mode") { sequencer_.setSongMode(payload["enabled"].asBool(false)); return true; }
    if (commandName == "project/new") return newProject(payload, error);
    if (commandName == "project/open") return openProject(payload, error);
    if (commandName == "project/delete") return deleteProject(payload, error);
    if (commandName == "pattern/save") return savePattern(payload, error);
    if (commandName == "pattern/load") return loadPattern(payload, error);
    if (commandName == "pattern/apply") return applyPattern(payload["pattern"], true, error);
    if (commandName == "pattern/delete") return deletePattern(payload, error);
    if (commandName == "pattern/preview") {
        if (!patternPreviewActive_) { patternPreviewBackup_ = program_; patternPreviewActive_ = true; }
        return applyPattern(payload["pattern"], false, error);
    }
    if (commandName == "pattern/cancel-preview") {
        if (!patternPreviewActive_) return true;
        program_ = patternPreviewBackup_; patternPreviewActive_ = false;
        return publishProgramUnlocked(error);
    }
    if (commandName == "kit/save") return saveKit(payload, error);
    if (commandName == "kit/load") return loadKit(payload, error);
    if (commandName == "kit/apply") return applyKitManifest(payload["kit"], payload["name"].asString("Custom"), error);
    if (commandName == "kit/delete") return deleteKit(payload, error);
    if (commandName == "kit/new") {
        controlKit_ = Kit{}; kitName_ = "Custom";
        if (!publishKitUnlocked(error)) return false;
        return saveStateUnlocked();
    }
    if (commandName == "sample/load") {
        unsigned voice = static_cast<unsigned>(payload["voice"].asInt(-1));
        if (voice >= DrumSequencer::kVoiceCount) {
            voice = 0;
            while (voice < DrumSequencer::kVoiceCount && !controlKit_.voices[voice].file.empty()) ++voice;
        }
        if (voice >= DrumSequencer::kVoiceCount) { error = "the realtime drum voice capacity is full"; return false; }
        const std::string file = payload["relative"].asString();
        std::string bytes; Sample sample;
        if (!readLibrarySample(file, bytes, error) || !decodeWave(bytes, sampleRate_, sample, error)) return false;
        sample.file = file; sample.name = fileStem(fileName(file)); controlKit_.voices[voice] = std::move(sample);
        if (!publishKitUnlocked(error)) return false;
        return saveStateUnlocked();
    }
    if (commandName == "sample/clear") {
        const unsigned voice = static_cast<unsigned>(payload["voice"].asInt(-1));
        if (voice >= DrumSequencer::kVoiceCount) { error = "invalid drum voice"; return false; }
        if (patternPreviewActive_) { program_ = patternPreviewBackup_; patternPreviewActive_ = false; }
        controlKit_.voices[voice] = Sample{};
        for (auto& variation : program_.variations) variation.steps[voice] = {};
        program_.fill.steps[voice] = {};
        if (!publishProgramUnlocked(error)) return false;
        if (!publishKitUnlocked(error)) return false;
        if (!saveStateUnlocked()) { error = "could not save the drum kit"; return false; }
        return true;
    }
    if (commandName == "clear") {
        const bool fill = payload["fill"].asBool(false);
        const unsigned variation = static_cast<unsigned>(payload["variation"].asInt(0));
        if (!fill && variation >= DrumSequencer::kVariationCount) { error = "invalid drum variation"; return false; }
        if (patternPreviewActive_) { program_ = patternPreviewBackup_; patternPreviewActive_ = false; }
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
    root.set("name", projectName_);
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
    projectName_ = root["name"].asString(projectId_);
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
    out.set("projectId", projectId_); out.set("projectName", projectName_);
    out.set("playing", playing_.load(std::memory_order_acquire));
    out.set("kitName", kitName_);
    out.set("level", controlLevel_); out.set("swing", controlSwing_); out.set("humanization", controlHumanization_);
    out.set("length", program_.variations[0].length); out.set("activeVariation", sequencer_.activeVariation());
    out.set("activeStep", sequencer_.activeStep());
    out.set("fillActive", sequencer_.fillActive()); out.set("songMode", sequencer_.songMode());
    out.set("activeSongSection", sequencer_.activeSongSection());
    out.set("droppedTriggers", static_cast<int64_t>(sequencer_.droppedTriggers()));
    out.set("droppedKitChanges", static_cast<int64_t>(droppedKitChanges_.load()));
    Json voices = Json::array();
    for (size_t index = 0; index < DrumSequencer::kVoiceCount; ++index) {
        Json voice = Json::object(); voice.set("id", static_cast<int>(index));
        voice.set("name", controlKit_.voices[index].file.empty() ? "" : fileStem(fileName(controlKit_.voices[index].file)));
        voice.set("sample", controlKit_.voices[index].file); voice.set("loaded", !controlKit_.voices[index].left.empty());
        voices.push(std::move(voice));
    }
    out.set("voices", std::move(voices));
    Json savedKits = Json::array(); for (const std::string& name : savedKits_) savedKits.push(name);
    out.set("savedKits", std::move(savedKits));
    Json projects = Json::array(); for (const std::string& name : projects_) projects.push(name);
    out.set("projects", std::move(projects));
    Json savedPatterns = Json::array(); for (const std::string& name : savedPatterns_) savedPatterns.push(name);
    out.set("savedPatterns", std::move(savedPatterns));
    Json variations = Json::array();
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
        || (bits != 16 && bits != 24 && bits != 32) || (format == 3 && bits != 32) || dataOffset == 0) {
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
