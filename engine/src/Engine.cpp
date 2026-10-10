#include "Engine.h"
#include "community/CommunityPresetPackage.h"

#include "core/Log.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <filesystem>

namespace pimfx {
namespace {

constexpr size_t kTunerRingSize = 16384;
constexpr float kTunerMinFrequency = 20.0f;   // covers low-F# extended-range bass
constexpr float kTunerMaxFrequency = 1400.0f; // above the 24th fret of a high E
constexpr int kRequiredControllerFirmwareMajor = 1;
constexpr int kRequiredControllerFirmwareMinor = 1;
constexpr const char* kRequiredControllerFirmwareVersion = "1.1";
static_assert(std::atomic<float>::is_always_lock_free,
              "tuner handoff requires lock-free float atomics");

float dbToGain(float db) {
    return std::pow(10.0f, db / 20.0f);
}

float audioBufferPeak(const std::vector<float*>& buffers, unsigned channels,
                      unsigned frames) noexcept {
    float peak = 0.0f;
    const unsigned count = std::min(channels, static_cast<unsigned>(buffers.size()));
    for (unsigned channel = 0; channel < count; ++channel) {
        const float* samples = buffers[channel];
        for (unsigned frame = 0; frame < frames; ++frame) {
            peak = std::max(peak, std::fabs(samples[frame]));
        }
    }
    return peak;
}

const char* audioFailureDescription(AudioFailureCategory category) {
    switch (category) {
        case AudioFailureCategory::PrimePlayback:
            return "cannot prime playback";
        case AudioFailureCategory::StartCapture:
            return "cannot start capture";
        case AudioFailureCategory::PreparePlaybackAfterXrun:
            return "cannot prepare playback after xrun";
        case AudioFailureCategory::PrepareCaptureAfterXrun:
            return "cannot prepare capture after xrun";
        case AudioFailureCategory::RelinkAfterXrun:
            return "cannot re-link capture and playback after xrun";
        case AudioFailureCategory::PrimePlaybackAfterXrun:
            return "cannot prime playback after xrun";
        case AudioFailureCategory::RestartCaptureAfterXrun:
            return "cannot restart capture after xrun";
        case AudioFailureCategory::None:
            break;
    }
    return "audio stream failed";
}

std::string formatAudioFailure(const AudioFailure& failure) {
    std::string message = audioFailureDescription(failure.category);
    if (failure.errorCode != 0) {
        message += ": ";
        message += std::strerror(failure.errorCode);
    }
    return message;
}

bool tempoLinkedPortValue(const PortInfo& port, double quarterNoteBeats,
                          double bpm, float& value) {
    if (!port.tempoLinkCandidate || port.secondsPerUnit <= 0.0
        || !std::isfinite(quarterNoteBeats) || quarterNoteBeats <= 0.0
        || !std::isfinite(bpm) || bpm <= 0.0) {
        return false;
    }
    const double seconds = 60.0 * quarterNoteBeats / bpm;
    value = static_cast<float>(std::max<double>(port.minimum,
        std::min<double>(port.maximum, seconds / port.secondsPerUnit)));
    return true;
}

void applyTempoLinksToPlugin(const EffectSlot& slot, PluginInstance& plugin, double bpm) {
    if (!slot.tempoLinks.isObject()) {
        return;
    }
    for (const Json::Member& link : slot.tempoLinks.members()) {
        for (const PortInfo& port : plugin.info().ports) {
            float value = 0.0f;
            if (port.symbol == link.first
                && tempoLinkedPortValue(port, link.second.asDouble(), bpm, value)) {
                plugin.setControl(port.index, value);
                break;
            }
        }
    }
}

bool isToobNam(const PluginInstance& plugin) {
    return plugin.uri() == "http://two-play.com/plugins/toob-nam";
}

void applyManagedNamCalibration(const AudioSettings& audio, PluginInstance& plugin) {
    if (!audio.namCalibrationManaged || !isToobNam(plugin)) {
        return;
    }
    for (const PortInfo& port : plugin.info().ports) {
        if (port.control && port.input && port.symbol == "calibration") {
            plugin.setControl(port.index, audio.instrumentLevelDbU);
            return;
        }
    }
}

bool namCalibrationChanged(const AudioSettings& before, const AudioSettings& after) {
    return before.namCalibrationManaged != after.namCalibrationManaged
        || before.instrumentLevelDbU != after.instrumentLevelDbU;
}

std::string sanitizeRelDir(const std::string& text) {
    std::filesystem::path out;
    for (const auto& part : std::filesystem::path(text)) {
        const std::string raw = part.string();
        if (raw.empty() || raw == "." || raw == "..") {
            continue;
        }
        out /= sanitizeFileName(raw);
    }
    return out.generic_string();
}

std::string libraryRootForKind(const Paths& paths, const std::string& kind) {
    if (kind == "drumsample") return joinPath(paths.drumsDir, "samples");
    if (kind == "drumkit") return joinPath(paths.drumsDir, "kits");
    if (kind == "ir") {
        return paths.irsDir;
    }
    if (kind == "aidax") {
        return paths.aidaxDir;
    }
    if (kind == "plugin") {
        return paths.lv2Dir;
    }
    if (kind == "layout") {
        return paths.layoutsDir;
    }
    if (kind == "virtuallayout") return paths.virtualLayoutsDir;
    if (kind == "controllerprofile") return paths.controllerProfilesDir;
    if (kind == "setupprofile") return paths.setupProfilesDir;
    if (kind == "theme") {
        return paths.themesDir();
    }
    if (kind == "backup") {
        return paths.backupsDir;
    }
    if (kind == "bank") {
        return paths.bankExportsDir;
    }
    if (kind == "backing") {
        return paths.backingTracksDir;
    }
    if (kind == "loop") return paths.loopsDir;
    if (kind == "recording") return paths.recordingsDir;
    if (kind == "drumproject") return joinPath(paths.drumsDir, "projects");
    return paths.modelsDir;
}

std::string libraryKindName(const std::string& kind) {
    if (kind == "ir" || kind == "aidax" || kind == "plugin"
        || kind == "layout" || kind == "virtuallayout" || kind == "theme" || kind == "backup" || kind == "bank"
        || kind == "controllerprofile" || kind == "setupprofile"
        || kind == "backing" || kind == "loop" || kind == "recording"
        || kind == "drumsample" || kind == "drumkit" || kind == "drumproject") {
        return kind;
    }
    return "model";
}

bool isLibraryRootPath(const Paths& paths, const std::string& path) {
    std::error_code pathEc;
    const auto candidate = std::filesystem::weakly_canonical(std::filesystem::path(path), pathEc);
    if (pathEc) {
        return false;
    }
    for (const std::string& root : {
             paths.modelsDir, paths.aidaxDir, paths.irsDir, paths.lv2Dir,
             paths.layoutsDir, paths.virtualLayoutsDir, paths.controllerProfilesDir, paths.setupProfilesDir,
             paths.backupsDir, paths.bankExportsDir, paths.backingTracksDir,
             paths.loopsDir, paths.recordingsDir, paths.drumsDir,
             joinPath(paths.drumsDir, "samples"), joinPath(paths.drumsDir, "kits"),
             joinPath(paths.drumsDir, "projects"), paths.themesDir()}) {
        std::error_code rootEc;
        const auto base = std::filesystem::weakly_canonical(std::filesystem::path(root), rootEc);
        if (!rootEc && candidate == base) {
            return true;
        }
    }
    return false;
}

bool hiddenLibraryName(const std::string& name) {
    return name.empty() || name[0] == '.';
}

std::string lowerCopy(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
}

bool libraryExtensionAllowed(const std::string& kind, const std::filesystem::path& path) {
    const std::string extension = lowerCopy(path.extension().string());
    if (kind == "theme" || kind == "layout" || kind == "virtuallayout" || kind == "backup" || kind == "bank"
        || kind == "controllerprofile" || kind == "setupprofile" || kind == "drumkit") {
        return extension == ".json";
    }
    if (kind == "drumsample" || kind == "loop") return extension == ".wav";
    if (kind == "backing") {
        return extension == ".wav" || extension == ".flac" || extension == ".mp3" || extension == ".ogg";
    }
    return true;
}

bool propertyLooksLikeIr(const std::string& uri) {
    const std::string hay = lowerCopy(uri);
    return hay.find("impulse") != std::string::npos
        || hay.find("convolution") != std::string::npos
        || hay.find("cabir") != std::string::npos
        || hay.find("#ir") != std::string::npos
        || hay.find("/ir") != std::string::npos;
}

bool propertyLooksLikeNam(const std::string& uri) {
    if (propertyLooksLikeIr(uri)) {
        return false;
    }
    const std::string hay = lowerCopy(uri);
    return hay.find("nam") != std::string::npos
        || hay.find("model") != std::string::npos
        || hay.find("neural") != std::string::npos
        || hay.find("capture") != std::string::npos
        || hay.find("profile") != std::string::npos
        || hay.find("aidax") != std::string::npos;
}

std::string resolvePluginFilePath(Storage& storage, const std::string& propertyUri,
                                  const std::string& path, std::string& error) {
    if (path.empty()) {
        return path;
    }
    const std::string resolved = storage.resolveLibraryFile(path, error);
    if (resolved.empty() || !fileExists(resolved) || !storage.isPathInLibrary(resolved)) {
        if (error.empty()) {
            error = "can't find that file in the library (" + fileName(path) + ")";
        }
        logError("plugin file missing: " + propertyUri + " " + path + " (" + error + ")");
        return std::string();
    }
    if (propertyLooksLikeNam(propertyUri)) {
        const std::string why = namModelRejectReason(resolved);
        if (!why.empty()) {
            error = why;
            logError("plugin file rejected: " + resolved + " (" + why + ")");
            return std::string();
        }
    }
    const std::string described = describeModelFile(resolved);
    logInfo("plugin file: " + propertyUri + " -> " + resolved + " (" + described + ")");
    return resolved;
}

Json rewritePluginStateFiles(Storage& storage, const Json& state,
                             std::vector<std::string>* missing = nullptr) {
    if (!state.isObject() || !state["properties"].isObject()) {
        return state;
    }
    Json properties = Json::object();
    for (const Json::Member& member : state["properties"].members()) {
        const std::string incoming = member.second.asString();
        if (incoming.empty()) {
            properties.set(member.first, Json(""));
            continue;
        }
        std::string error;
        const std::string resolved = resolvePluginFilePath(storage, member.first, incoming, error);
        if (resolved.empty()) {
            properties.set(member.first, Json(incoming));
            if (missing) {
                missing->push_back(fileName(incoming) + ": " + (error.empty()
                    ? std::string("file is missing") : error));
            }
            continue;
        }
        properties.set(member.first, Json(resolved));
    }
    Json out = state;
    out.set("properties", properties);
    return out;
}

bool pathInsideRoot(const std::string& path, const std::string& root) {
    std::string baseText, candidateText;
    if (!resolveLibraryPath(root, baseText) || !resolveLibraryPath(path, candidateText)) return false;
    const std::filesystem::path base(baseText), candidate(candidateText);
    auto a = base.begin(), b = candidate.begin();
    for (; a != base.end(); ++a, ++b) if (b == candidate.end() || *a != *b) return false;
    return true;
}

Json libraryDirNode(const std::string& abs, const std::string& rel, bool locked = false) {
    Json node = Json::object();
    node.set("name", rel.empty() ? std::string() : fileName(abs));
    node.set("relative", rel);
    node.set("path", abs);
    Json children = Json::array();
    std::error_code ec;
    std::vector<std::filesystem::directory_entry> entries;
    for (const auto& entry : std::filesystem::directory_iterator(abs, ec)) {
        if (ec) {
            break;
        }
        entries.push_back(entry);
    }
    std::sort(entries.begin(), entries.end(), [](const auto& a, const auto& b) {
        return a.path().filename().string() < b.path().filename().string();
    });
    for (const auto& entry : entries) {
        const std::string name = entry.path().filename().string();
        if (hiddenLibraryName(name) || (locked && entry.is_symlink(ec)) || !entry.is_directory(ec)) {
            continue;
        }
        const std::string childRel = rel.empty() ? name : rel + "/" + name;
        children.push(libraryDirNode(entry.path().string(), childRel, locked));
    }
    node.set("children", children);
    return node;
}

/// Performance stores switch → preset as { bankId: { controlId: presetId } }.
/// MIDI selectPreset used to ignore that map and only read binding.presetId,
/// which Learn never fills, so learned footswitches did nothing.
std::string assignedPresetForControl(const ControllerConfig& config,
                                     const std::string& bankId,
                                     const std::string& controlId) {
    if (bankId.empty() || controlId.empty() || !config.presetAssignments.isObject()) {
        return {};
    }
    if (!config.presetAssignments.has(bankId)) {
        return {};
    }
    const Json& bankMap = config.presetAssignments[bankId];
    if (!bankMap.isObject() || !bankMap.has(controlId)) {
        return {};
    }
    return bankMap[controlId].asString();
}

const char* kNoteNames[] = {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"};

TunerReading analysePitch(const std::vector<float>& samples, unsigned sampleRate, float threshold) {
    TunerReading reading;
    if (samples.size() < 1024 || sampleRate == 0) {
        return reading;
    }

    // YIN-style cumulative mean normalized difference. Choosing the first
    // strong periodic minimum avoids the octave/subharmonic jumps caused by
    // selecting the globally strongest autocorrelation lag.
    double energy = 0.0;
    double mean = 0.0;
    for (float sample : samples) {
        energy += static_cast<double>(sample) * sample;
        mean += sample;
    }
    const double rms = std::sqrt(energy / samples.size());
    reading.inputLevel = static_cast<float>(rms);
    if (rms < threshold) {
        return reading; // silence, or noise floor
    }

    const size_t minLag = static_cast<size_t>(sampleRate / kTunerMaxFrequency);
    const size_t maxLag = std::min(samples.size() / 2, static_cast<size_t>(sampleRate / kTunerMinFrequency));
    if (maxLag <= minLag) {
        return reading;
    }

    mean /= static_cast<double>(samples.size());
    std::vector<double> difference(maxLag + 1, 0.0);
    for (size_t lag = 1; lag < maxLag; ++lag) {
        double sum = 0.0;
        for (size_t i = 0; i + lag < samples.size(); ++i) {
            const double delta = (static_cast<double>(samples[i]) - mean)
                               - (static_cast<double>(samples[i + lag]) - mean);
            sum += delta * delta;
        }
        difference[lag] = sum;
    }

    double cumulative = 0.0;
    size_t bestLag = 0;
    double bestValue = 1.0;
    for (size_t lag = 1; lag < maxLag; ++lag) {
        cumulative += difference[lag];
        difference[lag] = cumulative > 0.0
            ? difference[lag] * static_cast<double>(lag) / cumulative
            : 1.0;
    }
    for (size_t lag = minLag; lag < maxLag; ++lag) {
        if (difference[lag] < bestValue) {
            bestValue = difference[lag];
            bestLag = lag;
        }
        if (difference[lag] < 0.18) {
            while (lag + 1 < maxLag && difference[lag + 1] < difference[lag]) ++lag;
            bestLag = lag;
            bestValue = difference[lag];
            break;
        }
    }

    if (bestLag == 0 || bestValue > 0.32) {
        return reading;
    }

    double refinedLag = static_cast<double>(bestLag);
    if (bestLag > minLag && bestLag + 1 < maxLag) {
        const double left = difference[bestLag - 1];
        const double center = difference[bestLag];
        const double right = difference[bestLag + 1];
        const double denominator = left - 2.0 * center + right;
        if (std::abs(denominator) > 1.0e-12) {
            refinedLag += 0.5 * (left - right) / denominator;
        }
    }
    const double frequency = static_cast<double>(sampleRate) / refinedLag;
    if (frequency < kTunerMinFrequency || frequency > kTunerMaxFrequency) {
        return reading;
    }

    const double midi = 69.0 + 12.0 * std::log2(frequency / 440.0);
    const int nearest = static_cast<int>(std::lround(midi));

    reading.valid = true;
    reading.confidence = static_cast<float>(std::max(0.0, std::min(1.0, 1.0 - bestValue)));
    reading.frequency = static_cast<float>(frequency);
    reading.midiNote = nearest;
    reading.cents = static_cast<float>((midi - nearest) * 100.0);
    reading.noteName = std::string(kNoteNames[((nearest % 12) + 12) % 12])
                     + std::to_string(nearest / 12 - 1);
    return reading;
}

bool isContinuousKind(ControlKind kind) {
    return kind == ControlKind::Pot
        || kind == ControlKind::Slider
        || kind == ControlKind::Expression;
}

bool presetActionAllowed(const std::string& action) {
    static const std::vector<std::string> actions = {
        "setParameter", "toggleEffect", "selectPreset", "selectSnapshot", "reloadPreset",
        "presetUp", "presetDown", "bankUp", "bankDown", "snapshotMode", "bypassAll",
        "tapTempo", "tuner", "backingPlayPause", "backingStop", "backingPrevious",
        "backingNext", "backingView", "looperRecord", "looperToggle", "looperPlay",
        "looperPlayStop", "looperOverdub", "looperStop", "looperRestart", "looperMute",
        "looperUndo", "looperRedo", "looperView", "recorderToggle",
        "recorderStop", "recorderView", "drumToggle", "drumFill", "drumVariationNext",
        "drumVariationPrevious", "drumPatternNext", "drumPatternPrevious", "drumView",
        "navigate", "select"
    };
    return std::find(actions.begin(), actions.end(), action) != actions.end();
}

bool followLatchPosition(const std::string& action) {
    return action == "bypassAll"
        || action == "snapshotMode"
        || action == "toggleEffect"
        || action == "setParameter";
}

float mappedBindingValue(const ActionRequest& request, const PortInfo* port = nullptr) {
    float visual = isContinuousKind(request.kind) ? request.value
                 : (request.pressed ? 1.0f : 0.0f);
    visual = std::max(0.0f, std::min(1.0f, visual));
    // Hardware reverse is applied when MIDI is decoded. This flag is the
    // per-parameter reverse from the editor overlay.
    if (request.fromPresetBind && request.binding.inverted) {
        visual = 1.0f - visual;
    }
    const float minimum = request.binding.minimum;
    const float maximum = request.binding.maximum;
    if (port && port->logarithmic && minimum != 0.0f && maximum != 0.0f
        && ((minimum > 0.0f) == (maximum > 0.0f))) {
        return static_cast<float>(minimum * std::pow(
            static_cast<double>(maximum) / minimum, visual));
    }
    return minimum + visual * (maximum - minimum);
}

bool latchOn(const ActionRequest& request) {
    return request.binding.inverted ? !request.pressed : request.pressed;
}

} // namespace

Engine::Engine(Paths paths)
    : storage_(std::move(paths)),
      tunerRing_(kTunerRingSize),
      backing_(std::make_unique<BackingTrackPlayer>(storage_.paths().backingTracksDir)),
      looper_(std::make_unique<StereoLooper>(storage_.paths().loopsDir)) {
    for (auto& sample : tunerRing_) sample.store(0.0f, std::memory_order_relaxed);
#ifdef PIMFX_ENABLE_MULTITRACK_RECORDER
    recorder_ = std::make_unique<MultitrackRecorder>(storage_.paths().recordingsDir);
    recorderEnabled_.store(true, std::memory_order_relaxed);
#endif
#ifdef PIMFX_ENABLE_DRUM_MACHINE
    drums_ = std::make_unique<DrumMachine>(storage_.paths().drumsDir);
    drumsEnabled_.store(true, std::memory_order_relaxed);
#endif
}

Engine::~Engine() {
    stop();
}

void Engine::setStateListener(StateListener listener) {
    std::lock_guard<std::mutex> lock(listenerMutex_);
    listener_ = std::move(listener);
}

bool Engine::start(std::string& error) {
    settings_ = storage_.loadSettings();
    tunerThreshold_.store(std::max(0.0005f, std::min(0.05f,
        settings_.ui.tuner["threshold"].asFloat(0.0025f))), std::memory_order_relaxed);
    tunerAutoBoost_.store(settings_.ui.tuner["detectionBoostMode"].asString("auto") != "manual", std::memory_order_relaxed);
    tunerAnalysisBoost_.store(dbToGain(std::max(0.0f, std::min(24.0f,
        settings_.ui.tuner["detectionBoostDb"].asFloat(0.0f)))), std::memory_order_relaxed);
    const std::string tunerInstrument = settings_.ui.tuner["instrument"].asString("guitar6");
    tunerExtendedRange_.store(tunerInstrument == "guitar8" || tunerInstrument == "guitar9"
        || tunerInstrument == "bass5" || tunerInstrument == "bass6" || tunerInstrument == "bass7",
        std::memory_order_relaxed);
    configureAudioSafety(settings_.audio);
    backingEnabled_.store(settings_.system.backingTracksEnabled && backing_->available(), std::memory_order_release);
    if (backingEnabled_.load(std::memory_order_acquire)) backing_->start();
    looper_->configure(settings_.looper.quantization, settings_.looper.countIn,
                       settings_.looper.level, settings_.looper.feedback);
    looper_->start();
    if (recorder_) recorder_->start();
    banks_ = storage_.loadBanks();
    brokenBankFiles_ = storage_.brokenBankFiles();

    activeBankId_ = settings_.activeBankId;
    activePresetId_ = settings_.activePresetId;
    if (!activeBank() && !banks_.empty()) {
        activeBankId_ = banks_.front().id;
        activePresetId_.clear();
    }
    if (!activePreset()) {
        const Bank* bank = activeBank();
        if (bank && !bank->presets.empty()) {
            activePresetId_ = bank->presets.front().id;
        }
    }

    transportEnabled_.store(settings_.system.sharedTransportEnabled, std::memory_order_release);
    transport_.setTimeSignature(settings_.transport.beatsPerBar, settings_.transport.beatUnit);
    transport_.setCountInBars(settings_.transport.countInBars);
    transport_.setMetronomeEnabled(settings_.transport.metronomeEnabled);
    transport_.setQuantizationEnabled(settings_.transport.quantizationEnabled);
    if (const Preset* preset = activePreset()) {
        transport_.setBpm(preset->tempo);
    }

    std::string catalogError;
    catalog_.setUserBundleDirectory(storage_.paths().lv2Dir);
    if (!catalog_.rescan(catalogError)) {
        logWarn("lv2: " + catalogError);
    }

    if (settings_.system.lockMemory) {
        std::string message;
        if (rt::lockMemory(message)) {
            logInfo("rt: " + message);
        } else {
            logWarn("rt: " + message);
        }
    }
    if (settings_.system.holdCpuLatency) {
        latencyGuard_ = std::make_unique<rt::CpuLatencyGuard>();
        logInfo("rt: " + latencyGuard_->status());
    }

    backend_ = createAudioBackend();
    startChainPreparationThread();

    inputGain_.store(dbToGain(settings_.audio.inputGainDb), std::memory_order_relaxed);
    const Preset* gainPreset = activePreset();
    targetOutputGain_.store(dbToGain(settings_.audio.outputGainDb
        + (gainPreset ? gainPreset->outputGainDb : 0.0f)), std::memory_order_relaxed);
    outputGain_.store(targetOutputGain_.load(std::memory_order_relaxed), std::memory_order_relaxed);
    guitarInputChannel_.store(settings_.audio.inputChannelOffset, std::memory_order_relaxed);

    migrateHardwareParameterBinds();
    std::string audioError;
    if (!restartAudio(audioError)) {
        // Not fatal. The UI needs to come up so the user can choose a device
        // that works instead of being locked out with a dead service.
        audioError_ = audioError;
        logWarn("audio: " + audioError);
    }

    controller_.setConfig(settings_.controller);
    applyControllerFeel();
    midi_.setMessageHandler([this](const MidiMessage& message) { handleMidiMessage(message); });
    midi_.setSysExHandler([this](const std::vector<uint8_t>& sysex) { handleSysEx(sysex); });
    if (settings_.controller.enabled) {
        std::string midiError;
        if (!midi_.start(settings_.controller.midiPort, midiError)) {
            controllerError_ = midiError;
            logInfo("midi: " + midiError);
        } else if (settings_.controller.midiPort != midi_.activePort()) {
            settings_.controller.midiPort = midi_.activePort();
            persistSettings();
        }
    }

    armAnalogCatchUnlocked();

    shuttingDown_.store(false);
    tunerThread_ = std::thread(&Engine::tunerThread, this);
    housekeepingThread_ = std::thread(&Engine::housekeepingThread, this);

    error.clear();
    return true;
}

void Engine::stop() {
    shuttingDown_.store(true);
    logInfo("shutdown: stopping chain preparation");
    stopChainPreparationThread();
    logInfo("shutdown: stopping backing tracks");
    if (backing_) backing_->stop();
    logInfo("shutdown: stopping looper");
    if (looper_) looper_->stop();
    logInfo("shutdown: stopping recorder");
    if (recorder_) recorder_->stop();
    logInfo("shutdown: joining control workers");
    if (tunerThread_.joinable()) {
        tunerThread_.join();
    }
    if (housekeepingThread_.joinable()) {
        housekeepingThread_.join();
    }

    logInfo("shutdown: saving active preset");
    {
        std::lock_guard<std::recursive_mutex> lock(stateMutex_);
        persistActiveBankUnlocked();
        flushPendingPersistence(true);
    }

    logInfo("shutdown: stopping MIDI");
    midi_.stop();
    logInfo("shutdown: stopping audio");
    if (backend_) {
        backend_->stop();
    }

    Chain* chain = activeChain_.exchange(nullptr);
    delete chain;
    delete pendingChain_.clear();
    delete deferredRetiredChain_;
    deferredRetiredChain_ = nullptr;
    RetiredChain retired;
    while (retiredChainQueue_.pop(retired)) {
        delete retired.chain;
    }
    retiredChains_.clear();
    latencyGuard_.reset();
    logInfo("shutdown: engine stopped");
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

bool Engine::restartAudio(std::string& error) {
    if (!backend_) {
        error = "no audio backend";
        return false;
    }

    backend_->stop();

    // A chain's scratch buffers are sized for the old period. With audio
    // stopped it is safe to dispose of every published/retired chain before
    // opening a stream that may negotiate a different block size.
    {
        // The preparation worker takes this mutex before its final publish.
        // Holding it across the chain clear prevents an old-rate chain from
        // appearing after the restart has disposed of the old generation.
        std::lock_guard<std::mutex> preparationLock(chainPreparationMutex_);
        cancelChainPreparationsLocked();
        std::lock_guard<std::mutex> lock(chainMutex_);
        delete activeChain_.exchange(nullptr, std::memory_order_acq_rel);
        delete pendingChain_.clear();
        delete deferredRetiredChain_;
        deferredRetiredChain_ = nullptr;
        RetiredChain retired;
        while (retiredChainQueue_.pop(retired)) delete retired.chain;
        retiredChains_.clear();
    }
    const bool awaitingChain = activePreset() != nullptr;
    chainPublicationExpected_.store(awaitingChain, std::memory_order_release);
    outputSafety_.resetTransition(awaitingChain);
    transitionRequested_.store(false, std::memory_order_relaxed);

    backend_->configureRealtime(settings_.system.audioThreadPriority);

    if (!backend_->start(settings_.audio, this, &metrics_, error)) {
        return false;
    }

    const AudioSettings actual = backend_->actualSettings();
    sampleRate_.store(actual.sampleRate, std::memory_order_release);
    maxFrames_.store(actual.periodFrames, std::memory_order_release);

    // ALSA is allowed to round what we asked for. Storing what we actually got
    // means the UI never shows a number the hardware is not using.
    settings_.audio.sampleRate = actual.sampleRate;
    settings_.audio.periodFrames = actual.periodFrames;
    settings_.audio.periodCount = actual.periodCount;
    settings_.audio.useMmap = actual.useMmap;
    settings_.audio.device = actual.device;
    settings_.audio.inputChannels = actual.inputChannels;
    settings_.audio.outputChannels = actual.outputChannels;
    audioDeviceName_ = actual.device;
    for (const AudioDeviceInfo& device : backend_->enumerateDevices()) {
        if (device.id == actual.device) {
            audioDeviceName_ = device.name.empty() ? device.id : device.name;
            break;
        }
    }
    if (settings_.audio.inputChannelOffset >= settings_.audio.inputChannels) {
        settings_.audio.inputChannelOffset = settings_.audio.inputChannels - 1;
    }
    guitarInputChannel_.store(settings_.audio.inputChannelOffset, std::memory_order_relaxed);

    if (const Preset* preset = activePreset()) {
        std::string chainError;
        if (std::unique_ptr<Chain> chain = buildChain(*preset, chainError)) {
            publishChain(std::move(chain));
        } else if (!chainError.empty()) {
            logWarn("chain: " + chainError);
        }
    }

    audioError_.clear();
    return true;
}

bool Engine::applyAudioSettings(const Json& json, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);

    const AudioSettings previous = settings_.audio;
    settings_.audio = audioSettingsFromJson(json, settings_.audio);
    configureAudioSafety(settings_.audio);

    inputGain_.store(dbToGain(settings_.audio.inputGainDb), std::memory_order_relaxed);
    const Preset* currentPreset = activePreset();
    targetOutputGain_.store(dbToGain(settings_.audio.outputGainDb
        + (currentPreset ? currentPreset->outputGainDb : 0.0f)), std::memory_order_relaxed);
    guitarInputChannel_.store(settings_.audio.inputChannelOffset, std::memory_order_relaxed);

    const bool needsRestart = previous != settings_.audio;
    const bool rebuildForCalibration = namCalibrationChanged(previous, settings_.audio);
    if (needsRestart) {
        std::string restartError;
        if (!restartAudio(restartError)) {
            // Put the working configuration back rather than leaving the user
            // with silence and a dialog.
            settings_.audio = previous;
            configureAudioSafety(settings_.audio);
            inputGain_.store(dbToGain(settings_.audio.inputGainDb), std::memory_order_relaxed);
            targetOutputGain_.store(dbToGain(settings_.audio.outputGainDb
                + (currentPreset ? currentPreset->outputGainDb : 0.0f)), std::memory_order_relaxed);
            guitarInputChannel_.store(settings_.audio.inputChannelOffset, std::memory_order_relaxed);
            std::string recoveryError;
            if (!restartAudio(recoveryError)) {
                audioError_ = restartError;
            }
            error = restartError;
            persistSettings();
            notify();
            return false;
        }
    } else if (rebuildForCalibration && currentPreset) {
        std::string chainError;
        if (std::unique_ptr<Chain> chain = buildChain(*currentPreset, chainError)) {
            publishChain(std::move(chain));
        } else if (!chainError.empty()) {
            error = chainError;
            return false;
        }
    }

    persistSettings();
    notify();
    return true;
}

void Engine::previewAudioSettings(const Json& json) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);

    // Preview only values backed by atomics. Hardware stream fields in the
    // payload are deliberately ignored so dragging a control can never reopen
    // ALSA or persist settings on every pointer event.
    const AudioSettings preview = audioSettingsFromJson(json, settings_.audio);
    configureAudioSafety(preview);
    inputGain_.store(dbToGain(preview.inputGainDb), std::memory_order_relaxed);
    const Preset* currentPreset = activePreset();
    targetOutputGain_.store(dbToGain(preview.outputGainDb
        + (currentPreset ? currentPreset->outputGainDb : 0.0f)), std::memory_order_relaxed);
}

bool Engine::applySystemSettings(const Json& json, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    const bool wasTransportEnabled = transportEnabled_.load(std::memory_order_acquire);
    const bool wasBackingEnabled = backingEnabled_.load(std::memory_order_acquire);
    settings_.system = SystemSettings::fromJson(json);
    transportEnabled_.store(settings_.system.sharedTransportEnabled, std::memory_order_release);
    backingEnabled_.store(settings_.system.backingTracksEnabled && backing_->available(), std::memory_order_release);
    if (recorder_) recorder_->setSourceAvailable(MultitrackRecorder::Source::Backing,
        backingEnabled_.load(std::memory_order_acquire));
    if (backingEnabled_.load(std::memory_order_acquire) && !wasBackingEnabled) {
        backing_->start();
    } else if (!backingEnabled_.load(std::memory_order_acquire) && wasBackingEnabled) {
        backing_->stopPlayback();
        backing_->stop();
    }
    if (!settings_.system.sharedTransportEnabled) {
        transport_.stop();
    } else if (!wasTransportEnabled) {
        transport_.setTimeSignature(settings_.transport.beatsPerBar, settings_.transport.beatUnit);
        transport_.setCountInBars(settings_.transport.countInBars);
        transport_.setMetronomeEnabled(settings_.transport.metronomeEnabled);
        transport_.setQuantizationEnabled(settings_.transport.quantizationEnabled);
        if (const Preset* preset = activePreset()) transport_.setBpm(preset->tempo);
    }

    if (settings_.system.holdCpuLatency && !latencyGuard_) {
        latencyGuard_ = std::make_unique<rt::CpuLatencyGuard>();
    } else if (!settings_.system.holdCpuLatency) {
        latencyGuard_.reset();
    }

    // Thread priority and affinity are read when the audio thread starts, so
    // changing them means restarting the stream.
    std::string restartError;
    if (!restartAudio(restartError)) {
        error = restartError;
    }
    persistSettings();
    notify();
    return error.empty();
}

bool Engine::applyTransportSettings(const Json& json, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    if (!transportEnabled_.load(std::memory_order_acquire)) {
        error = "shared transport is disabled";
        return false;
    }
    TransportSettings next = TransportSettings::fromJson(json);
    const double nextBpm = json.has("bpm") ? json["bpm"].asDouble(transport_.bpm()) : transport_.bpm();
    settings_.transport = next;
    transport_.setBpm(nextBpm);
    transport_.setTimeSignature(next.beatsPerBar, next.beatUnit);
    transport_.setCountInBars(next.countInBars);
    transport_.setMetronomeEnabled(next.metronomeEnabled);
    transport_.setQuantizationEnabled(next.quantizationEnabled);
    if (Preset* stored = activePreset(); stored && stored->activeSnapshot < 0) {
        if (Preset* draft = activeSessionDraft(true)) {
            draft->tempo = transport_.bpm();
            applyTempoLinksUnlocked(*draft);
        }
    }
    persistSettings();
    notifyPerformance();
    return true;
}

bool Engine::transportPlay(bool restart, std::string& error) {
    if (!transportEnabled_.load(std::memory_order_acquire)) {
        error = "shared transport is disabled";
        return false;
    }
    transport_.play(restart);
    return true;
}

bool Engine::transportStop(std::string& error) {
    if (!transportEnabled_.load(std::memory_order_acquire)) {
        error = "shared transport is disabled";
        return false;
    }
    transport_.stop();
    return true;
}

bool Engine::transportRestart(std::string& error) {
    if (!transportEnabled_.load(std::memory_order_acquire)) {
        error = "shared transport is disabled";
        return false;
    }
    transport_.restart();
    return true;
}

void Engine::resetMeters() {
    metrics_.xruns.store(0, std::memory_order_relaxed);
    metrics_.captureXruns.store(0, std::memory_order_relaxed);
    metrics_.playbackXruns.store(0, std::memory_order_relaxed);
    metrics_.shortCaptureTransfers.store(0, std::memory_order_relaxed);
    metrics_.shortPlaybackTransfers.store(0, std::memory_order_relaxed);
    metrics_.lastXrunDirection.store(0, std::memory_order_relaxed);
    metrics_.lastXrunError.store(0, std::memory_order_relaxed);
    metrics_.lastXrunPeriod.store(0, std::memory_order_relaxed);
    metrics_.lastXrunTransitionPhase.store(0, std::memory_order_relaxed);
    metrics_.lastXrunWorkerTransitions.store(0, std::memory_order_relaxed);
    metrics_.lastXrunChainPreparationActive.store(false, std::memory_order_relaxed);
    metrics_.lastXrunChainGeneration.store(0, std::memory_order_relaxed);
    metrics_.lastXrunDspLoad.store(0.0f, std::memory_order_relaxed);
    metrics_.dspLoadPeak.store(0.0f, std::memory_order_relaxed);
}

void Engine::prepareToPlay(unsigned sampleRate, unsigned maxFrames) {
    sampleRate_.store(sampleRate, std::memory_order_release);
    maxFrames_.store(maxFrames, std::memory_order_release);
    outputSafety_.prepare(sampleRate);
    transport_.setSampleRate(sampleRate);
    if (backing_) backing_->prepare(sampleRate);
    looper_->prepare(sampleRate);
    if (recorder_) {
        recorder_->prepare(sampleRate, maxFrames);
        recorder_->setSourceAvailable(MultitrackRecorder::Source::Backing,
            backingEnabled_.load(std::memory_order_acquire));
        recorder_->setSourceAvailable(MultitrackRecorder::Source::Drum,
            drumsEnabled_.load(std::memory_order_acquire));
        recorderBackingBus_.assign(2, std::vector<float>(maxFrames, 0.0f));
        recorderBackingPointers_.clear();
        for (auto& channel : recorderBackingBus_) recorderBackingPointers_.push_back(channel.data());
        recorderDrumBus_.assign(2, std::vector<float>(maxFrames, 0.0f));
        recorderDrumPointers_.clear();
        for (auto& channel : recorderDrumBus_) recorderDrumPointers_.push_back(channel.data());
    }
    if (drums_) drums_->prepare(sampleRate);
}

void Engine::releaseResources() {}

void Engine::applyMasterOutputSafety(float* const* outputs, unsigned outputChannels,
                                     unsigned frames, const float* dryInput, float dryGain) {
    const bool tunerOpen = tunerViewOpen_.load(std::memory_order_relaxed);
    const bool tunerMuted = tunerOutputMuted_.load(std::memory_order_relaxed);
    const float dryTarget = tunerOpen && !tunerMuted && dryInput ? 1.0f : 0.0f;
    const float target = tunerOpen && tunerMuted ? 0.0f : 1.0f;
    const float step = 1.0f / std::max(1.0f,
        static_cast<float>(sampleRate_.load(std::memory_order_relaxed)) * 0.005f);
    for (unsigned frame = 0; frame < frames; ++frame) {
        if (tunerDryMix_ < dryTarget) tunerDryMix_ = std::min(dryTarget, tunerDryMix_ + step);
        else if (tunerDryMix_ > dryTarget) tunerDryMix_ = std::max(dryTarget, tunerDryMix_ - step);
        for (unsigned channel = 0; channel < outputChannels; ++channel) {
            if (dryInput && tunerDryMix_ > 0.0f) {
                const float dry = dryInput[frame] * dryGain;
                outputs[channel][frame] += (dry - outputs[channel][frame]) * tunerDryMix_;
            }
        }
    }
    // Dry tuner audio and independent playback still pass through the final
    // DC blocker and limiter, but not the preset-chain transition gain.
    outputSafety_.processProtection(outputs, outputChannels, frames);
    for (unsigned frame = 0; frame < frames; ++frame) {
        if (tunerOutputGain_ < target) tunerOutputGain_ = std::min(target, tunerOutputGain_ + step);
        else if (tunerOutputGain_ > target) tunerOutputGain_ = std::max(target, tunerOutputGain_ - step);
        for (unsigned channel = 0; channel < outputChannels; ++channel) {
            outputs[channel][frame] *= tunerOutputGain_;
        }
    }
}

void Engine::applyPresetTransition(float* const* outputs, unsigned outputChannels,
                                   unsigned frames) {
    const bool allowFadeIn = outputSafety_.transitionState() == MasterOutputSafety::TransitionState::Muted
        && pendingChain_.peek() == nullptr
        && !chainPublicationExpected_.load(std::memory_order_acquire)
        && deferredRetiredChain_ == nullptr
        && !transitionRequested_.load(std::memory_order_acquire)
        && !activeChainTransitionPending();
    outputSafety_.processTransition(outputs, outputChannels, frames, allowFadeIn);
    metrics_.transitionPhase.store(
        static_cast<uint32_t>(outputSafety_.transitionState()), std::memory_order_relaxed);
}

void Engine::processAudio(const float* const* inputs, unsigned inputChannels,
                          float* const* outputs, unsigned outputChannels,
                          unsigned frames) {
    audioGeneration_.fetch_add(1, std::memory_order_release);
    beginAudioTransitionBlock();
    metrics_.transitionPhase.store(
        static_cast<uint32_t>(outputSafety_.transitionState()), std::memory_order_relaxed);

    const bool transportEnabled = transportEnabled_.load(std::memory_order_acquire);
    const TransportBlock transportBlock = transportEnabled
        ? transport_.beginAudioBlock(frames) : TransportBlock{};

    Chain* chain = activeChain_.load(std::memory_order_acquire);
    uint32_t workerTransitions = 0;
    if (chain) {
        for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
            if (slot->enabled.load(std::memory_order_relaxed) && slot->plugin
                && slot->plugin->propertyTransitionPending()) {
                ++workerTransitions;
            }
        }
    }
    metrics_.activeWorkerTransitions.store(workerTransitions, std::memory_order_relaxed);

    const unsigned channels = chain ? chain->channels : std::min(outputChannels, 2u);
    const float inputGain = inputGain_.load(std::memory_order_relaxed);
    unsigned guitar = guitarInputChannel_.load(std::memory_order_relaxed);
    if (inputChannels == 0) {
        guitar = 0;
    } else if (guitar >= inputChannels) {
        guitar = inputChannels - 1;
    }

    const bool recorderCapturing = recorder_ && recorderEnabled_.load(std::memory_order_relaxed)
        && recorder_->beginCapture(frames, transportEnabled ? transportBlock.timelineFrame : 0);
    float selectedPeak = 0.0f;
    double selectedSquares = 0.0;
    if (inputChannels > 0) {
        const float* selectedInput = inputs[guitar];
        for (unsigned frame = 0; frame < frames; ++frame) {
            const float sample = selectedInput[frame];
            selectedPeak = std::max(selectedPeak, std::fabs(sample));
            selectedSquares += static_cast<double>(sample) * sample;
        }
    }
    guitarInputPeak_.store(selectedPeak, std::memory_order_relaxed);
    guitarInputRms_.store(frames > 0
        ? static_cast<float>(std::sqrt(selectedSquares / frames)) : 0.0f,
        std::memory_order_relaxed);
    if (recorderCapturing && inputChannels > 0) {
        const float* rawInput = inputs[guitar];
        recorder_->captureSource(MultitrackRecorder::Source::Raw, &rawInput, 1, frames);
    }

    const auto copyGuitar = [&](float* destination) {
        const float* source = inputs[guitar];
        for (unsigned frame = 0; frame < frames; ++frame) {
            destination[frame] = source[frame] * inputGain;
        }
    };

    const auto feedTuner = [&]() {
        if (!tunerEnabled_.load(std::memory_order_relaxed) || inputChannels == 0) {
            return;
        }
        const float* source = inputs[guitar];
        size_t write = tunerWrite_.load(std::memory_order_relaxed);
        for (unsigned frame = 0; frame < frames; ++frame) {
            // Analyse the same gain-adjusted guitar signal used by the dry
            // tuner passthrough. Otherwise a quiet interface input remains
            // close to the detector noise floor even after Input Gain is set.
            tunerRing_[write].store(source[frame] * inputGain, std::memory_order_relaxed);
            write = (write + 1) % kTunerRingSize;
        }
        tunerWrite_.store(write, std::memory_order_release);
    };

    if (!chain || chain->bufferA.empty()) {
        feedTuner();
        for (unsigned channel = 0; channel < outputChannels; ++channel) {
            if (inputChannels > 0) {
                copyGuitar(outputs[channel]);
            } else {
                std::fill(outputs[channel], outputs[channel] + frames, 0.0f);
            }
        }
        if (recorderCapturing) {
            recorder_->captureSource(MultitrackRecorder::Source::Processed,
                reinterpret_cast<const float* const*>(outputs), outputChannels, frames);
        }
        applyPresetTransition(outputs, outputChannels, frames);
        looper_->process(reinterpret_cast<const float* const*>(outputs), outputChannels,
                         outputs, outputChannels, frames,
                         transportEnabled ? &transportBlock : nullptr);
        if (transportEnabled) {
            for (unsigned channel = 0; channel < outputChannels; ++channel) {
                for (unsigned frame = 0; frame < frames; ++frame) {
                    outputs[channel][frame] += transport_.metronomeSample(transportBlock, frame);
                }
            }
        }
        if (backingEnabled_.load(std::memory_order_relaxed)) {
            backing_->render(outputs, outputChannels, frames,
                recorderCapturing ? recorderBackingPointers_.data() : nullptr,
                recorderCapturing ? static_cast<unsigned>(recorderBackingPointers_.size()) : 0);
            if (recorderCapturing) recorder_->captureSource(MultitrackRecorder::Source::Backing,
                reinterpret_cast<const float* const*>(recorderBackingPointers_.data()),
                static_cast<unsigned>(recorderBackingPointers_.size()), frames);
        }
        if (drumsEnabled_.load(std::memory_order_relaxed) && drums_) {
            drums_->render(outputs, outputChannels,
                recorderCapturing ? recorderDrumPointers_.data() : nullptr,
                recorderCapturing ? static_cast<unsigned>(recorderDrumPointers_.size()) : 0,
                frames, transportBlock);
            if (recorderCapturing) recorder_->captureSource(MultitrackRecorder::Source::Drum,
                reinterpret_cast<const float* const*>(recorderDrumPointers_.data()),
                static_cast<unsigned>(recorderDrumPointers_.size()), frames);
        }
        if (recorderEnabled_.load(std::memory_order_relaxed) && recorder_) {
            recorder_->renderPlayback(outputs, outputChannels, frames);
        }
        applyMasterOutputSafety(outputs, outputChannels, frames,
            inputChannels > 0 ? inputs[guitar] : nullptr, inputGain);
        if (recorderCapturing) {
            recorder_->captureSource(MultitrackRecorder::Source::Master,
                reinterpret_cast<const float* const*>(outputs), outputChannels, frames);
            recorder_->finishCapture();
        }
        return;
    }

    for (unsigned channel = 0; channel < channels; ++channel) {
        float* destination = chain->bufferA[channel].data();
        if (inputChannels > 0) {
            copyGuitar(destination);
        } else {
            std::fill(destination, destination + frames, 0.0f);
        }
    }

    feedTuner();

    std::vector<float*>* rendered = &chain->pointersA;

    if (!bypassAll_.load(std::memory_order_relaxed)) {
        std::vector<float*>* source = &chain->pointersA;
        std::vector<float*>* destination = &chain->pointersB;
        float sourcePeak = audioBufferPeak(*source, channels, frames);

        for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
            slot->inputPeak.store(sourcePeak, std::memory_order_relaxed);

            if (!slot->enabled.load(std::memory_order_relaxed) || !slot->plugin) {
                slot->outputPeak.store(sourcePeak, std::memory_order_relaxed);
                continue;
            }

            const unsigned pluginInputs = slot->plugin->audioInputs();
            const unsigned pluginOutputs = slot->plugin->audioOutputs();
            if (pluginInputs == 0 && pluginOutputs == 0) {
                slot->outputPeak.store(sourcePeak, std::memory_order_relaxed);
                continue; // a plugin with no audio ports has nothing to do here
            }

            slot->plugin->process(reinterpret_cast<const float* const*>(source->data()),
                                  std::min(pluginInputs, channels),
                                  destination->data(),
                                  std::min(pluginOutputs, channels),
                                  frames, transportEnabled ? &transportBlock : nullptr);

            // A mono plugin in a stereo chain feeds both sides rather than
            // silencing the right channel.
            if (pluginOutputs == 1 && channels > 1) {
                for (unsigned channel = 1; channel < channels; ++channel) {
                    std::memcpy((*destination)[channel], (*destination)[0], frames * sizeof(float));
                }
            }

            sourcePeak = audioBufferPeak(*destination, channels, frames);
            slot->outputPeak.store(sourcePeak, std::memory_order_relaxed);

            std::swap(source, destination);
        }

        rendered = source;
    } else {
        const float bypassPeak = audioBufferPeak(chain->pointersA, channels, frames);
        for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
            slot->inputPeak.store(bypassPeak, std::memory_order_relaxed);
            slot->outputPeak.store(bypassPeak, std::memory_order_relaxed);
        }
    }

    // Ramp ordinary output-level changes rather than stepping the fader. The
    // separate final master transition below handles preset/property muting.
    const float target = targetOutputGain_.load(std::memory_order_relaxed);
    float gain = outputGain_.load(std::memory_order_relaxed);
    const float step = (target - gain) / static_cast<float>(std::max(1u, frames));

    for (unsigned frame = 0; frame < frames; ++frame) {
        gain += step;
        for (unsigned channel = 0; channel < outputChannels; ++channel) {
            const unsigned sourceChannel = std::min(channel, channels - 1);
            outputs[channel][frame] = (*rendered)[sourceChannel][frame] * gain;
        }
    }
    outputGain_.store(target, std::memory_order_relaxed);
    if (recorderCapturing) {
        recorder_->captureSource(MultitrackRecorder::Source::Processed,
            reinterpret_cast<const float* const*>(outputs), outputChannels, frames);
    }
    applyPresetTransition(outputs, outputChannels, frames);
    looper_->process(reinterpret_cast<const float* const*>(rendered->data()), channels,
                     outputs, outputChannels, frames,
                     transportEnabled ? &transportBlock : nullptr);
    if (transportEnabled) {
        for (unsigned channel = 0; channel < outputChannels; ++channel) {
            for (unsigned frame = 0; frame < frames; ++frame) {
                outputs[channel][frame] += transport_.metronomeSample(transportBlock, frame);
            }
        }
    }
    if (backingEnabled_.load(std::memory_order_relaxed)) {
        backing_->render(outputs, outputChannels, frames,
            recorderCapturing ? recorderBackingPointers_.data() : nullptr,
            recorderCapturing ? static_cast<unsigned>(recorderBackingPointers_.size()) : 0);
        if (recorderCapturing) recorder_->captureSource(MultitrackRecorder::Source::Backing,
            reinterpret_cast<const float* const*>(recorderBackingPointers_.data()),
            static_cast<unsigned>(recorderBackingPointers_.size()), frames);
    }
    if (drumsEnabled_.load(std::memory_order_relaxed) && drums_) {
        drums_->render(outputs, outputChannels,
            recorderCapturing ? recorderDrumPointers_.data() : nullptr,
            recorderCapturing ? static_cast<unsigned>(recorderDrumPointers_.size()) : 0,
            frames, transportBlock);
        if (recorderCapturing) recorder_->captureSource(MultitrackRecorder::Source::Drum,
            reinterpret_cast<const float* const*>(recorderDrumPointers_.data()),
            static_cast<unsigned>(recorderDrumPointers_.size()), frames);
    }
    if (recorderEnabled_.load(std::memory_order_relaxed) && recorder_) {
        recorder_->renderPlayback(outputs, outputChannels, frames);
    }
    applyMasterOutputSafety(outputs, outputChannels, frames,
        inputChannels > 0 ? inputs[guitar] : nullptr, inputGain);
    if (recorderCapturing) {
        recorder_->captureSource(MultitrackRecorder::Source::Master,
            reinterpret_cast<const float* const*>(outputs), outputChannels, frames);
        recorder_->finishCapture();
    }
}

// ---------------------------------------------------------------------------
// Chain lifecycle
// ---------------------------------------------------------------------------

std::unique_ptr<Engine::Chain> Engine::buildChain(const Preset& preset, std::string& error) {
    auto chain = std::make_unique<Chain>();
    const unsigned channels = std::max(1u, std::min(settings_.audio.outputChannels, 2u));
    const unsigned frames = std::max(1u, maxFrames_.load(std::memory_order_acquire));

    chain->presetId = preset.id;
    chain->channels = channels;
    chain->outputGain = dbToGain(settings_.audio.outputGainDb + preset.outputGainDb);
    chain->bufferA.assign(channels, std::vector<float>(frames, 0.0f));
    chain->bufferB.assign(channels, std::vector<float>(frames, 0.0f));
    chain->pointersA.resize(channels);
    chain->pointersB.resize(channels);
    for (unsigned channel = 0; channel < channels; ++channel) {
        chain->pointersA[channel] = chain->bufferA[channel].data();
        chain->pointersB[channel] = chain->bufferB[channel].data();
    }

    std::string failures;
    missingPluginFiles_.clear();
    for (const EffectSlot& slot : preset.chain) {
        std::string slotError;
        std::unique_ptr<PluginInstance> plugin = PluginInstance::create(
            catalog_, slot.uri, sampleRate_.load(std::memory_order_acquire), frames, slotError);

        if (!plugin) {
            // A preset that names a plugin the user has not installed still
            // loads; the missing effect is reported and skipped rather than
            // taking the whole preset down.
            failures += (failures.empty() ? "" : "; ") + slotError;
            continue;
        }
        plugin->loadState(rewritePluginStateFiles(storage_, slot.state, &missingPluginFiles_));
        applyManagedNamCalibration(settings_.audio, *plugin);
        if (transportEnabled_.load(std::memory_order_acquire)) {
            applyTempoLinksToPlugin(slot, *plugin, transport_.bpm());
        }

        auto chainSlot = std::make_unique<ChainSlot>();
        chainSlot->id = slot.id;
        chainSlot->plugin = std::move(plugin);
        chainSlot->enabled.store(slot.enabled, std::memory_order_relaxed);
        chain->slots.push_back(std::move(chainSlot));
    }

    error = failures;
    return chain;
}

void Engine::publishChain(std::unique_ptr<Chain> chain) {
    if (!chain) {
        return;
    }
    chainPublicationExpected_.store(true, std::memory_order_release);

    std::unique_lock<std::mutex> preparationLock(chainPreparationMutex_);
    const uint64_t requestGeneration =
        chainPreparationRequestGeneration_.fetch_add(1, std::memory_order_acq_rel) + 1;
    chainAwaitingPreparation_.reset();
    if (chainNeedsPreparation(*chain) && chainPreparationWorker_.joinable()
        && !chainPreparationStopping_.load(std::memory_order_acquire)) {
        chainAwaitingPreparation_ = std::move(chain);
        preparationLock.unlock();
        chainPreparationWake_.notify_one();
        return;
    }

    (void)requestGeneration;
    // Publish while holding the preparation mutex so an older preparation
    // request cannot win the final race and replace this newer chain.
    publishPreparedChain(std::move(chain));
}

void Engine::publishPreparedChain(std::unique_ptr<Chain> chain) {
    if (!chain) return;
    chain->publicationGeneration =
        chainPublicationGeneration_.fetch_add(1, std::memory_order_acq_rel) + 1;
    std::lock_guard<std::mutex> lock(chainMutex_);
    // Only the latest unpublished chain matters. Superseded chains have never
    // been visible to the audio thread, so they can be destroyed here.
    pendingChain_.publish(std::move(chain));
    transitionRequested_.store(true, std::memory_order_release);
}

bool Engine::chainNeedsPreparation(const Chain& chain) const noexcept {
    for (const std::unique_ptr<ChainSlot>& slot : chain.slots) {
        if (slot->plugin && slot->plugin->propertyTransitionPending()) return true;
    }
    return false;
}

bool Engine::prepareChainForPublication(Chain& chain, uint64_t requestGeneration) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(30);
    const unsigned frames = std::max(1u, maxFrames_.load(std::memory_order_acquire));
    while (chainNeedsPreparation(chain)) {
        if (chainPreparationStopping_.load(std::memory_order_acquire)
            || chainPreparationRequestGeneration_.load(std::memory_order_acquire)
                != requestGeneration) {
            return false;
        }
        if (std::chrono::steady_clock::now() >= deadline) {
            logWarn("chain: preparation timed out; using the muted transition fallback");
            return true;
        }

        for (auto& buffer : chain.bufferA) std::fill(buffer.begin(), buffer.end(), 0.0f);
        for (auto& buffer : chain.bufferB) std::fill(buffer.begin(), buffer.end(), 0.0f);
        for (const std::unique_ptr<ChainSlot>& slot : chain.slots) {
            if (!slot->plugin || !slot->plugin->propertyTransitionPending()) continue;
            slot->plugin->process(
                reinterpret_cast<const float* const*>(chain.pointersA.data()),
                std::min(slot->plugin->audioInputs(), chain.channels),
                chain.pointersB.data(),
                std::min(slot->plugin->audioOutputs(), chain.channels),
                frames, nullptr);
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    return true;
}

void Engine::chainPreparationThread() {
    while (!chainPreparationStopping_.load(std::memory_order_acquire)) {
        std::unique_ptr<Chain> chain;
        uint64_t requestGeneration = 0;
        {
            std::unique_lock<std::mutex> lock(chainPreparationMutex_);
            chainPreparationWake_.wait(lock, [&]() {
                return chainPreparationStopping_.load(std::memory_order_acquire)
                    || chainAwaitingPreparation_ != nullptr;
            });
            if (chainPreparationStopping_.load(std::memory_order_acquire)) break;
            chain = std::move(chainAwaitingPreparation_);
            requestGeneration = chainPreparationRequestGeneration_.load(std::memory_order_acquire);
        }

        metrics_.chainPreparationActive.store(true, std::memory_order_release);
        const bool publish = chain && prepareChainForPublication(*chain, requestGeneration);
        metrics_.chainPreparationActive.store(false, std::memory_order_release);

        std::lock_guard<std::mutex> lock(chainPreparationMutex_);
        if (publish && !chainPreparationStopping_.load(std::memory_order_acquire)
            && chainPreparationRequestGeneration_.load(std::memory_order_acquire)
                == requestGeneration) {
            publishPreparedChain(std::move(chain));
        }
    }
    metrics_.chainPreparationActive.store(false, std::memory_order_release);
}

void Engine::startChainPreparationThread() {
    if (chainPreparationWorker_.joinable()) return;
    chainPreparationStopping_.store(false, std::memory_order_release);
    chainPreparationWorker_ = std::thread(&Engine::chainPreparationThread, this);
}

void Engine::stopChainPreparationThread() {
    {
        std::lock_guard<std::mutex> lock(chainPreparationMutex_);
        chainPreparationStopping_.store(true, std::memory_order_release);
        chainPreparationRequestGeneration_.fetch_add(1, std::memory_order_acq_rel);
        chainAwaitingPreparation_.reset();
    }
    chainPreparationWake_.notify_all();
    if (chainPreparationWorker_.joinable()) chainPreparationWorker_.join();
}

void Engine::cancelChainPreparationsLocked() {
    chainPreparationRequestGeneration_.fetch_add(1, std::memory_order_acq_rel);
    chainAwaitingPreparation_.reset();
    metrics_.chainPreparationActive.store(false, std::memory_order_release);
}

void Engine::collectRetiredChains() {
    std::lock_guard<std::mutex> lock(chainMutex_);
    RetiredChain retired;
    while (retiredChainQueue_.pop(retired)) {
        if (retired.chain) {
            retiredChains_.emplace_back(std::unique_ptr<Chain>(retired.chain), retired.generation);
        }
    }
    const uint64_t now = audioGeneration_.load(std::memory_order_acquire);
    const bool audioRunning = backend_ && backend_->isRunning();

    if (chainReaders_.load(std::memory_order_acquire) != 0) {
        return;
    }

    retiredChains_.erase(
        std::remove_if(retiredChains_.begin(), retiredChains_.end(),
                       [&](const std::pair<std::unique_ptr<Chain>, uint64_t>& entry) {
                           return !audioRunning || now > entry.second + 2;
                       }),
        retiredChains_.end());
}

bool Engine::swapPendingChainFromAudio() {
    if (deferredRetiredChain_) {
        const RetiredChain deferred{deferredRetiredChain_,
                                    audioGeneration_.load(std::memory_order_relaxed)};
        if (!retiredChainQueue_.push(deferred)) {
            return false;
        }
        deferredRetiredChain_ = nullptr;
    }

    Chain* next = pendingChain_.take();
    if (!next) {
        return true;
    }

    Chain* previous = activeChain_.exchange(next, std::memory_order_acq_rel);
    chainPublicationExpected_.store(false, std::memory_order_release);
    metrics_.chainGeneration.store(next->publicationGeneration, std::memory_order_relaxed);
    targetOutputGain_.store(next->outputGain, std::memory_order_relaxed);
    // Serializing and broadcasting state is not realtime-safe. Let the
    // housekeeping thread publish the newly active chain after this block.
    chainStateDirty_.store(true, std::memory_order_release);
    if (previous) {
        const RetiredChain retired{previous, audioGeneration_.load(std::memory_order_relaxed)};
        if (!retiredChainQueue_.push(retired)) {
            // Never destroy on the realtime thread. A further swap is held
            // until this single deferred pointer enters the bounded queue.
            deferredRetiredChain_ = previous;
        }
    }
    return true;
}

bool Engine::activeChainReadyForPreset(const Preset& preset) const noexcept {
    if (chainPublicationExpected_.load(std::memory_order_acquire)) return false;
    ActiveChainReadGuard chainGuard(*this);
    const Chain* chain = chainGuard.get();
    return chain && chain->presetId == preset.id;
}

void Engine::beginAudioTransitionBlock() {
    const bool requested = transitionRequested_.exchange(false, std::memory_order_acq_rel);
    if (!muteOnChangeEnabled_.load(std::memory_order_acquire)) {
        outputSafety_.resetTransition(false);
        swapPendingChainFromAudio();
        applyDeferredTransitionStateFromAudio();
        return;
    }

    if (requested) outputSafety_.beginFadeOut();

    if (outputSafety_.transitionState() == MasterOutputSafety::TransitionState::Muted) {
        const bool chainReady = swapPendingChainFromAudio();
        if (chainReady) applyDeferredTransitionStateFromAudio();
    }
}

bool Engine::applyDeferredTransitionStateFromAudio() {
    bool changed = false;
    const int bypass = pendingBypassAll_.exchange(-1, std::memory_order_acq_rel);
    if (bypass >= 0) {
        bypassAll_.store(bypass != 0, std::memory_order_relaxed);
        changed = true;
    }
    if (Chain* chain = activeChain_.load(std::memory_order_acquire)) {
        for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
            const int enabled = slot->pendingEnabled.exchange(-1, std::memory_order_acq_rel);
            if (enabled >= 0) {
                slot->enabled.store(enabled != 0, std::memory_order_relaxed);
                changed = true;
            }
            if (slot->plugin) {
                changed = slot->plugin->applyDeferredStateChanges() || changed;
            }
        }
    }
    if (changed) chainStateDirty_.store(true, std::memory_order_release);
    return changed;
}

bool Engine::activeChainTransitionPending() const {
    if (bypassAll_.load(std::memory_order_relaxed)) {
        return false;
    }
    const Chain* chain = activeChain_.load(std::memory_order_acquire);
    if (!chain) {
        return false;
    }
    for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
        if (slot->enabled.load(std::memory_order_relaxed)
            && slot->plugin && slot->plugin->propertyTransitionPending()) {
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Presets and banks
// ---------------------------------------------------------------------------

Bank* Engine::findBank(const std::string& bankId) {
    for (Bank& bank : banks_) {
        if (bank.id == bankId) {
            return &bank;
        }
    }
    return nullptr;
}

Bank* Engine::findBankForPreset(const std::string& presetId) {
    for (Bank& bank : banks_) {
        for (const Preset& preset : bank.presets) {
            if (preset.id == presetId) {
                return &bank;
            }
        }
    }
    return nullptr;
}

Preset* Engine::findPresetAnywhere(const std::string& presetId) {
    for (Bank& bank : banks_) {
        for (Preset& preset : bank.presets) {
            if (preset.id == presetId) {
                return &preset;
            }
        }
    }
    return nullptr;
}

Bank* Engine::activeBank() { return findBank(activeBankId_); }

const Bank* Engine::activeBank() const {
    return const_cast<Engine*>(this)->findBank(activeBankId_);
}

Preset* Engine::activePreset() {
    Bank* bank = activeBank();
    if (!bank) {
        return nullptr;
    }
    for (Preset& preset : bank->presets) {
        if (preset.id == activePresetId_) {
            return &preset;
        }
    }
    return nullptr;
}

const Preset* Engine::activePreset() const {
    return const_cast<Engine*>(this)->activePreset();
}

Preset* Engine::activeSessionDraft(bool create) {
    Preset* stored = activePreset();
    if (!stored) return nullptr;
    auto found = sessionPresetDrafts_.find(stored->id);
    if (found != sessionPresetDrafts_.end()) return &found->second;
    if (!create) return nullptr;
    auto inserted = sessionPresetDrafts_.emplace(stored->id, *stored);
    return &inserted.first->second;
}

const Preset* Engine::activeSessionDraft() const {
    auto found = sessionPresetDrafts_.find(activePresetId_);
    return found == sessionPresetDrafts_.end() ? nullptr : &found->second;
}

const Preset* Engine::effectiveActivePreset() const {
    if (const Preset* draft = activeSessionDraft()) return draft;
    return activePreset();
}

void Engine::captureChainIntoPreset(Preset& preset) {
    std::lock_guard<std::recursive_mutex> stateLock(stateMutex_);
    ActiveChainReadGuard chainGuard(*this);
    Chain* chain = chainGuard.get();
    if (!chain || chainPublicationExpected_.load(std::memory_order_acquire)
        || chain->presetId != preset.id || preset.activeSnapshot >= 0) return;
    for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
        EffectSlot* working = preset.findSlot(slot->id);
        if (!working || !slot->plugin) continue;
        working->state = slot->plugin->saveState();
        const int pendingEnabled = slot->pendingEnabled.load(std::memory_order_acquire);
        working->enabled = pendingEnabled >= 0
            ? pendingEnabled != 0 : slot->enabled.load(std::memory_order_relaxed);
    }
}

void Engine::captureActiveSessionDraft() {
    if (Preset* draft = activeSessionDraft(true)) captureChainIntoPreset(*draft);
}

void Engine::clearSessionDraft(const std::string& presetId) {
    sessionPresetDrafts_.erase(presetId);
}

void Engine::syncPresetFromChain() {
    captureActiveSessionDraft();
}

void Engine::persistBankUnlocked(Bank* bank, bool syncFromChain) {
    if (syncFromChain) {
        Preset* preset = activePreset();
        if (preset && preset->activeSnapshot < 0) {
            syncPresetFromChain();
        }
    }
    if (bank) {
        if (storage_.saveBank(*bank)) pendingBankPersistIds_.erase(bank->id);
    }
    bankPersistPending_.store(!pendingBankPersistIds_.empty() || settingsPersistPending_,
                              std::memory_order_relaxed);
}

void Engine::persistActiveBankUnlocked() {
    persistBankUnlocked(activeBank(), false);
}

void Engine::writeStoredControlUnlocked(const std::string& slotId, const std::string& portSymbol, float value) {
    if (const Preset* stored = activePreset(); !stored || stored->activeSnapshot >= 0) return;
    Preset* preset = activeSessionDraft(true);
    if (!preset) return;
    EffectSlot* stored = preset->findSlot(slotId);
    if (!stored) {
        return;
    }
    Json state = stored->state;
    if (!state.isObject()) {
        state = Json::object();
    }
    Json controls = state["controls"];
    if (!controls.isObject()) {
        controls = Json::object();
    }
    controls.set(portSymbol, Json(static_cast<double>(value)));
    state.set("controls", std::move(controls));
    stored->state = std::move(state);
}

void Engine::armAnalogCatchUnlocked() {
    analogCatch_.clear();
    const ControllerConfig config = controller_.config();
    for (const ControllerControl& control : config.controls) {
        if (control.kind == ControlKind::Pot || control.kind == ControlKind::Slider) {
            analogCatch_[control.id] = AnalogCatch{};
        }
    }
}

bool Engine::analogCatchAllows(const ActionRequest& request) {
    auto found = analogCatch_.find(request.controlId);
    if (found == analogCatch_.end() || !found->second.waiting) {
        return true;
    }
    AnalogCatch& catchState = found->second;
    const float incoming = std::max(0.0f, std::min(1.0f, request.value));
    if (catchState.lastVisual < 0.0f) {
        catchState.lastVisual = incoming;
        return false;
    }
    // A few MIDI ticks of motion takes over. Crossing the stored value is
    // not required — that forced a sweep across the whole pot.
    constexpr float kUnlock = 4.0f / 127.0f;
    if (std::fabs(incoming - catchState.lastVisual) < kUnlock) {
        return false;
    }
    catchState.lastVisual = incoming;
    catchState.waiting = false;
    return true;
}

void Engine::flushPendingBasePresetUnlocked() {
    // Preserve the current live base before a snapshot temporarily replaces
    // it. The working copy remains memory-only until the user presses Save.
    Preset* preset = activePreset();
    if (preset && preset->activeSnapshot < 0 && activeSessionDraft()) captureActiveSessionDraft();
}

void Engine::requestBankPersist(const std::string& bankId) {
    if (bankId.empty()) return;
    pendingBankPersistIds_.insert(bankId);
    const auto due = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count() + 400;
    bankPersistDueMs_.store(due, std::memory_order_relaxed);
    bankPersistPending_.store(true, std::memory_order_relaxed);
}

void Engine::requestSettingsPersist() {
    settingsPersistPending_ = true;
    const auto due = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count() + 400;
    bankPersistDueMs_.store(due, std::memory_order_relaxed);
    bankPersistPending_.store(true, std::memory_order_relaxed);
}

void Engine::flushPendingPersistence(bool force) {
    if (!bankPersistPending_.load(std::memory_order_relaxed)) {
        return;
    }
    const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
    if (!force && now < bankPersistDueMs_.load(std::memory_order_relaxed)) {
        return;
    }
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    if (!bankPersistPending_.load(std::memory_order_relaxed)) {
        return;
    }
    std::vector<std::string> bankIds(pendingBankPersistIds_.begin(),
                                     pendingBankPersistIds_.end());
    for (const std::string& bankId : bankIds) {
        Bank* bank = findBank(bankId);
        if (!bank || storage_.saveBank(*bank)) pendingBankPersistIds_.erase(bankId);
    }
    if (settingsPersistPending_ && persistSettings()) settingsPersistPending_ = false;

    const bool pending = !pendingBankPersistIds_.empty() || settingsPersistPending_;
    bankPersistPending_.store(pending, std::memory_order_relaxed);
    if (pending) bankPersistDueMs_.store(now + 1000, std::memory_order_relaxed);
}

bool Engine::selectPreset(const std::string& bankId, const std::string& presetId, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);

    Bank* bank = findBank(bankId.empty() ? activeBankId_ : bankId);
    if (!bank) {
        error = "no such bank";
        return false;
    }

    Preset* target = nullptr;
    for (Preset& preset : bank->presets) {
        if (preset.id == presetId) {
            target = &preset;
            break;
        }
    }
    if (!target) {
        error = "no such preset";
        return false;
    }

    const Preset* outgoing = activePreset();
    Bank* outgoingBank = activeBank();
    if (outgoing && activeSessionDraft()) {
        captureActiveSessionDraft();
    }
    if (outgoingBank && outgoingBank->id != bank->id) {
        outgoingBank->lastPresetId = activePresetId_;
        requestBankPersist(outgoingBank->id);
    }
    if (outgoing && outgoing->id != target->id && outgoingBank && outgoingBank->id == bank->id) {
        requestBankPersist(outgoingBank->id);
    }

    activeBankId_ = bank->id;
    activePresetId_ = target->id;
    bank->lastPresetId = target->id;
    // Build the remembered snapshot directly into the unpublished chain. Once
    // publication is deferred until silence, applying it through activeChain_
    // would otherwise modify the outgoing preset during the fade.
    const auto draft = sessionPresetDrafts_.find(target->id);
    Preset effectivePreset = draft == sessionPresetDrafts_.end() ? *target : draft->second;
    effectivePreset.snapshots = target->snapshots;
    effectivePreset.rememberedSnapshotSlot = target->rememberedSnapshotSlot;
    effectivePreset.rememberedSnapshotEnabled = target->rememberedSnapshotEnabled;
    if (transportEnabled_.load(std::memory_order_acquire)) {
        transport_.setBpmIfStopped(effectivePreset.tempo);
    }
    if (target->rememberedSnapshotEnabled && target->rememberedSnapshotSlot >= 0) {
        if (Snapshot* snapshot = findSnapshotBySlot(*target, target->rememberedSnapshotSlot)) {
            for (EffectSlot& slot : effectivePreset.chain) {
                if (!snapshot->slots.has(slot.id)) continue;
                const Json& state = snapshot->slots[slot.id];
                slot.state = state;
                slot.enabled = state["enabled"].asBool(true);
            }
            target->activeSnapshot = snapshot->slot;
        } else {
            forgetRememberedSnapshot(*target);
            target->activeSnapshot = -1;
        }
    } else {
        target->activeSnapshot = -1;
    }

    std::string chainError;
    std::unique_ptr<Chain> chain = buildChain(effectivePreset, chainError);
    if (!chainError.empty()) {
        logWarn("preset '" + target->name + "': " + chainError);
    }
    publishChain(std::move(chain));

    settings_.activeBankId = activeBankId_;
    settings_.activePresetId = activePresetId_;
    requestSettingsPersist();
    requestBankPersist(bank->id);
    armAnalogCatchUnlocked();
    refreshLeds();
    notify();
    return true;
}

bool Engine::stepPreset(int delta, std::string& error) {
    const Bank* bank = activeBank();
    if (!bank || bank->presets.empty()) {
        error = "no presets in this bank";
        return false;
    }
    int index = 0;
    for (size_t i = 0; i < bank->presets.size(); ++i) {
        if (bank->presets[i].id == activePresetId_) {
            index = static_cast<int>(i);
            break;
        }
    }
    const int count = static_cast<int>(bank->presets.size());
    index = ((index + delta) % count + count) % count;
    return selectPreset(bank->id, bank->presets[static_cast<size_t>(index)].id, error);
}

bool Engine::selectBank(const std::string& bankId, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Bank* current = activeBank();
    int slot = 0;
    if (current) {
        for (size_t i = 0; i < current->presets.size(); ++i) {
            if (current->presets[i].id == activePresetId_) {
                slot = static_cast<int>(i);
                break;
            }
        }
    }
    Bank* next = findBank(bankId);
    if (!next) {
        error = "no such bank";
        return false;
    }
    if (next->presets.empty()) {
        error = "that bank is empty";
        return false;
    }
    std::string presetId;
    if (!next->lastPresetId.empty()) {
        for (const Preset& preset : next->presets) {
            if (preset.id == next->lastPresetId) {
                presetId = preset.id;
                break;
            }
        }
    }
    if (presetId.empty()) {
        const int index = std::min(slot, static_cast<int>(next->presets.size()) - 1);
        presetId = next->presets[static_cast<size_t>(std::max(0, index))].id;
    }
    return selectPreset(next->id, presetId, error);
}

bool Engine::stepBank(int delta, std::string& error) {
    std::vector<const Bank*> playable;
    for (const Bank& bank : banks_) {
        if (!bank.communityHolding && !bank.presets.empty()) playable.push_back(&bank);
    }
    if (playable.empty()) {
        error = "no banks";
        return false;
    }
    int index = 0;
    for (size_t i = 0; i < playable.size(); ++i) {
        if (playable[i]->id == activeBankId_) {
            index = static_cast<int>(i);
            break;
        }
    }
    const int count = static_cast<int>(playable.size());
    index = ((index + delta) % count + count) % count;
    return selectBank(playable[static_cast<size_t>(index)]->id, error);
}

void Engine::configureAudioSafety(const AudioSettings& settings) {
    muteOnChangeEnabled_.store(settings.muteOnChange, std::memory_order_release);
    outputSafety_.configure(settings, sampleRate_.load(std::memory_order_acquire));
}

bool Engine::stepSnapshot(int delta, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    if (!preset) {
        error = "no active preset";
        return false;
    }
    std::vector<int> slots;
    for (const Snapshot& snapshot : preset->snapshots) {
        const int slot = snapshot.slot >= 0 ? snapshot.slot : static_cast<int>(slots.size());
        if (std::find(slots.begin(), slots.end(), slot) == slots.end()) {
            slots.push_back(slot);
        }
    }
    std::sort(slots.begin(), slots.end());
    if (slots.empty()) {
        error = "no snapshots";
        return false;
    }
    int index = 0;
    for (size_t i = 0; i < slots.size(); ++i) {
        if (slots[i] == preset->activeSnapshot) {
            index = static_cast<int>(i);
            break;
        }
    }
    if (preset->activeSnapshot < 0) {
        index = delta > 0 ? -1 : 0;
    }
    const int count = static_cast<int>(slots.size());
    index = ((index + delta) % count + count) % count;
    if (!pressSnapshotSlotUnlocked(*preset, slots[static_cast<size_t>(index)], error)) {
        return false;
    }
    persistActiveBankUnlocked();
    refreshLeds();
    notify();
    return true;
}

bool Engine::reloadStoredPreset(std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    if (!preset) {
        error = "no active preset";
        return false;
    }
    bypassAll_.store(false, std::memory_order_relaxed);
    std::string chainError;
    std::unique_ptr<Chain> chain = buildChain(*preset, chainError);
    if (!chain) {
        error = chainError.empty() ? "could not restore the saved preset" : chainError;
        return false;
    }
    clearSessionDraft(preset->id);
    publishChain(std::move(chain));
    preset->activeSnapshot = -1;
    forgetRememberedSnapshot(*preset);
    presetReloadCount_ += 1;
    armAnalogCatchUnlocked();
    persistActiveBankUnlocked();
    refreshLeds();
    notify();
    return true;
}

bool Engine::savePreset(std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    if (!preset) {
        error = "no active preset";
        return false;
    }
    if (preset->activeSnapshot >= 0) {
        error = "return to the base preset before saving";
        return false;
    }
    const Preset previous = *preset;
    if (Preset* draft = activeSessionDraft(false)) {
        captureChainIntoPreset(*draft);
        draft->name = preset->name;
        draft->author = preset->author;
        draft->snapshots = preset->snapshots;
        draft->community = preset->community;
        draft->rememberedSnapshotSlot = preset->rememberedSnapshotSlot;
        draft->rememberedSnapshotEnabled = preset->rememberedSnapshotEnabled;
        draft->activeSnapshot = -1;
        *preset = *draft;
    } else {
        captureChainIntoPreset(*preset);
    }
    Bank* bank = activeBank();
    if (!bank) {
        error = "no active bank";
        return false;
    }
    if (!storage_.saveBank(*bank)) {
        *preset = previous;
        error = "could not write the bank file";
        return false;
    }
    clearSessionDraft(preset->id);
    notify();
    return true;
}

bool Engine::savePresetAs(const std::string& name, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Bank* bank = activeBank();
    const Preset* source = activePreset();
    if (!bank || !source) {
        error = "nothing to save";
        return false;
    }

    Preset copy = activeSessionDraft() ? *activeSessionDraft() : *source;
    captureChainIntoPreset(copy);
    copy.author = source->author;
    copy.snapshots = source->snapshots;
    copy.community = source->community;
    copy.rememberedSnapshotSlot = -1;
    copy.rememberedSnapshotEnabled = false;
    copy.activeSnapshot = -1;
    copy.id = newId("preset");
    copy.name = name.empty() ? source->name + " copy" : name;
    const std::string previousPresetId = activePresetId_;
    bank->presets.push_back(copy);
    activePresetId_ = copy.id;

    if (!storage_.saveBank(*bank)) {
        bank->presets.pop_back();
        activePresetId_ = previousPresetId;
        error = "could not write the bank file";
        return false;
    }
    settings_.activePresetId = activePresetId_;
    persistSettings();
    notify();
    return true;
}

bool Engine::createPreset(const std::string& name, std::string& error) {
    return createPreset(name, std::string(), error);
}

bool Engine::createPreset(const std::string& name, const std::string& bankId, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    persistActiveBankUnlocked();

    Bank* bank = bankId.empty() ? activeBank() : findBank(bankId);
    if (!bank) {
        error = "no active bank";
        return false;
    }

    Preset preset;
    preset.id = newId("preset");
    preset.name = name.empty() ? "Untitled" : name;
    bank->presets.push_back(preset);
    activePresetId_ = preset.id;

    if (!storage_.saveBank(*bank)) {
        error = "could not write the bank file";
        return false;
    }

    std::string chainError;
    publishChain(buildChain(bank->presets.back(), chainError));
    settings_.activePresetId = activePresetId_;
    persistSettings();
    notify();
    return true;
}

bool Engine::renamePreset(const std::string& presetId, const std::string& name, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Bank* bank = findBankForPreset(presetId);
    if (!bank) {
        error = "no such preset";
        return false;
    }
    for (Preset& preset : bank->presets) {
        if (preset.id == presetId) {
            preset.name = name;
            if (auto draft = sessionPresetDrafts_.find(presetId); draft != sessionPresetDrafts_.end()) {
                draft->second.name = name;
            }
            storage_.saveBank(*bank);
            notify();
            return true;
        }
    }
    error = "no such preset";
    return false;
}

bool Engine::deletePreset(const std::string& presetId, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Bank* bank = findBankForPreset(presetId);
    if (!bank) {
        error = "no such preset";
        return false;
    }
    const auto found = std::find_if(bank->presets.begin(), bank->presets.end(),
                                    [&](const Preset& preset) { return preset.id == presetId; });
    if (found == bank->presets.end()) {
        error = "no such preset";
        return false;
    }
    if (bank->presets.size() <= 1 && !bank->communityHolding
        && (!found->community.isObject() || found->community.members().empty())) {
        error = "a bank must keep at least one preset";
        return false;
    }

    const Json removedCommunity = found->community;
    const bool wasActive = presetId == activePresetId_;
    bank->presets.erase(found);
    clearSessionDraft(presetId);
    storage_.saveBank(*bank);

    auto dependencyStillUsed = [&](const std::string& group, const std::string& name) {
        for (const Bank& candidateBank : banks_) {
            for (const Preset& candidatePreset : candidateBank.presets) {
                for (const Json& dependency : candidatePreset.community["dependencies"][group].items()) {
                    if (dependency["expectedFilename"].asString() == name) return true;
                }
            }
        }
        return false;
    };
    auto removeDependencies = [&](const std::string& group) {
        for (const Json& dependency : removedCommunity["dependencies"][group].items()) {
            const std::string name = dependency["expectedFilename"].asString();
            if (name.empty() || fileName(name) != name || dependencyStillUsed(group, name)) continue;
            const std::string kind = dependency["kind"].asString(group == "irs" ? "ir" : "model");
            const std::string root = kind == "ir" ? storage_.paths().irsDir : storage_.paths().modelsDir;
            removeFile(joinPath(joinPath(root, "Community"), name));
        }
    };
    removeDependencies("tone3000");
    removeDependencies("irs");

    if (wasActive) {
        if (bank->presets.empty()) {
            const auto playable = std::find_if(banks_.begin(), banks_.end(), [&](const Bank& candidate) {
                return candidate.id != bank->id && !candidate.communityHolding && !candidate.presets.empty();
            });
            if (playable != banks_.end()) {
                activeBankId_ = playable->id;
                activePresetId_ = playable->presets.front().id;
            } else {
                activePresetId_.clear();
            }
        } else {
            activePresetId_ = bank->presets.front().id;
        }
        std::string chainError;
        if (Preset* next = activePreset()) {
            const auto draft = sessionPresetDrafts_.find(next->id);
            const Preset& effective = draft == sessionPresetDrafts_.end() ? *next : draft->second;
            if (transportEnabled_.load(std::memory_order_acquire)) transport_.setBpmIfStopped(effective.tempo);
            publishChain(buildChain(effective, chainError));
        }
        settings_.activeBankId = activeBankId_;
        settings_.activePresetId = activePresetId_;
        persistSettings();
    }
    notify();
    return true;
}

bool Engine::reorderPreset(const std::string& presetId, int newIndex, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Bank* bank = findBankForPreset(presetId);
    if (!bank) {
        error = "no such preset";
        return false;
    }
    const auto found = std::find_if(bank->presets.begin(), bank->presets.end(),
                                    [&](const Preset& preset) { return preset.id == presetId; });
    if (found == bank->presets.end()) {
        error = "no such preset";
        return false;
    }
    Preset moved = *found;
    bank->presets.erase(found);
    newIndex = std::max(0, std::min(newIndex, static_cast<int>(bank->presets.size())));
    bank->presets.insert(bank->presets.begin() + newIndex, std::move(moved));
    storage_.saveBank(*bank);
    notify();
    return true;
}

bool Engine::movePresetToBank(const std::string& presetId, const std::string& targetBankId, int newIndex, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    if (presetId == activePresetId_ && activeSessionDraft()) captureActiveSessionDraft();
    Bank* source = nullptr;
    auto found = std::vector<Preset>::iterator();
    for (Bank& bank : banks_) {
        auto it = std::find_if(bank.presets.begin(), bank.presets.end(),
                               [&](const Preset& preset) { return preset.id == presetId; });
        if (it != bank.presets.end()) {
            source = &bank;
            found = it;
            break;
        }
    }
    if (!source) {
        error = "no such preset";
        return false;
    }
    Bank* target = findBank(targetBankId);
    if (!target) {
        error = "no such bank";
        return false;
    }
    if (source->id == target->id) {
        Preset moved = *found;
        source->presets.erase(found);
        newIndex = std::max(0, std::min(newIndex, static_cast<int>(source->presets.size())));
        source->presets.insert(source->presets.begin() + newIndex, std::move(moved));
        storage_.saveBank(*source);
        notify();
        return true;
    }
    if (source->presets.size() < 2 && !source->communityHolding) {
        error = "a bank must keep at least one preset";
        return false;
    }
    Preset moved = *found;
    source->presets.erase(found);
    newIndex = std::max(0, std::min(newIndex, static_cast<int>(target->presets.size())));
    target->presets.insert(target->presets.begin() + newIndex, std::move(moved));
    ControllerConfig config = controller_.config();
    if (config.presetAssignments.has(source->id)) {
        const Json& current = config.presetAssignments[source->id];
        Json cleaned = Json::object();
        for (const Json::Member& member : current.members()) {
            if (member.second.asString() != presetId) {
                cleaned.set(member.first, member.second);
            }
        }
        config.presetAssignments.set(source->id, cleaned);
    }
    controller_.setConfig(config);
    settings_.controller = config;
    if (activePresetId_ == presetId) {
        activeBankId_ = target->id;
        settings_.activeBankId = activeBankId_;
        std::string chainError;
        const auto draft = sessionPresetDrafts_.find(presetId);
        const Preset& effective = draft == sessionPresetDrafts_.end()
            ? target->presets[static_cast<size_t>(newIndex)] : draft->second;
        publishChain(buildChain(effective, chainError));
    }
    storage_.saveBank(*source);
    storage_.saveBank(*target);
    persistSettings();
    notify();
    return true;
}

bool Engine::createBank(const std::string& name, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Bank bank;
    bank.id = newId("bank");
    bank.name = name.empty() ? "New Bank" : name;
    bank.order = static_cast<int>(banks_.size());
    Preset preset;
    preset.id = newId("preset");
    preset.name = "Preset 1";
    bank.presets.push_back(std::move(preset));

    if (!storage_.saveBank(bank)) {
        error = "could not write the bank file";
        return false;
    }
    banks_.push_back(std::move(bank));
    notify();
    return true;
}

bool Engine::renameBank(const std::string& bankId, const std::string& name, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Bank* bank = findBank(bankId);
    if (!bank) {
        error = "no such bank";
        return false;
    }
    bank->name = name;
    storage_.saveBank(*bank);
    notify();
    return true;
}

bool Engine::deleteBank(const std::string& bankId, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    if (banks_.size() <= 1) {
        error = "at least one bank has to remain";
        return false;
    }
    const auto found = std::find_if(banks_.begin(), banks_.end(),
                                    [&](const Bank& bank) { return bank.id == bankId; });
    if (found == banks_.end()) {
        error = "no such bank";
        return false;
    }

    for (const Preset& preset : found->presets) clearSessionDraft(preset.id);
    storage_.deleteBank(bankId);
    const bool wasActive = bankId == activeBankId_;
    banks_.erase(found);

    ControllerConfig config = controller_.config();
    if (config.presetAssignments.isObject() && config.presetAssignments.has(bankId)) {
        Json next = Json::object();
        for (const Json::Member& member : config.presetAssignments.members()) {
            if (member.first != bankId) {
                next.set(member.first, member.second);
            }
        }
        config.presetAssignments = next;
        controller_.setConfig(config);
        settings_.controller = config;
        persistSettings();
    }

    if (wasActive) {
        activeBankId_ = banks_.front().id;
        activePresetId_ = banks_.front().presets.empty() ? "" : banks_.front().presets.front().id;
        if (const Preset* preset = activePreset()) {
            std::string chainError;
            const auto draft = sessionPresetDrafts_.find(preset->id);
            const Preset& effective = draft == sessionPresetDrafts_.end() ? *preset : draft->second;
            if (transportEnabled_.load(std::memory_order_acquire)) transport_.setBpmIfStopped(effective.tempo);
            publishChain(buildChain(effective, chainError));
        }
        settings_.activeBankId = activeBankId_;
        settings_.activePresetId = activePresetId_;
        persistSettings();
    }
    notify();
    return true;
}

bool Engine::reorderBank(const std::string& bankId, int newIndex, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    const auto found = std::find_if(banks_.begin(), banks_.end(),
                                    [&](const Bank& bank) { return bank.id == bankId; });
    if (found == banks_.end()) {
        error = "no such bank";
        return false;
    }
    Bank moved = *found;
    banks_.erase(found);
    newIndex = std::max(0, std::min(newIndex, static_cast<int>(banks_.size())));
    banks_.insert(banks_.begin() + newIndex, std::move(moved));
    for (size_t i = 0; i < banks_.size(); ++i) {
        banks_[i].order = static_cast<int>(i);
        storage_.saveBank(banks_[i]);
    }
    notify();
    return true;
}

Json Engine::exportBank(const std::string& bankId) const {
    for (const Bank& bank : banks_) {
        if (bank.id == bankId) {
            Json json = bank.toJson();
            json.set("format", "pimfx-bank");
            json.set("formatVersion", 1);
            return json;
        }
    }
    return Json();
}

bool Engine::importBank(const Json& json, std::string& error) {
    if (json["format"].asString() != "pimfx-bank") {
        error = "that file is not a Pi-MFX bank";
        return false;
    }
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);

    Bank bank = Bank::fromJson(json);
    // Fresh identifiers, so importing a bank twice gives two banks rather than
    // silently replacing the first.
    bank.id = newId("bank");
    bank.order = static_cast<int>(banks_.size());
    for (Preset& preset : bank.presets) {
        preset.id = newId("preset");
        for (EffectSlot& slot : preset.chain) {
            slot.id = newId("slot");
        }
    }

    if (!storage_.saveBank(bank)) {
        error = "could not write the imported bank";
        return false;
    }
    banks_.push_back(std::move(bank));
    notify();
    return true;
}

static float normalizePortValue(const PortInfo& port, float value) {
    float normalized = std::max(port.minimum, std::min(port.maximum, value));
    if (port.toggled) {
        const float off = std::max(port.minimum, std::min(port.maximum, 0.0f));
        const float on = std::max(port.minimum, std::min(port.maximum, 1.0f));
        normalized = value > 0.0f ? on : off;
    } else if (port.enumerated && !port.scalePoints.empty()) {
        const ScalePoint* closest = &port.scalePoints.front();
        for (const ScalePoint& point : port.scalePoints) {
            if (std::abs(point.value - value) < std::abs(closest->value - value)) {
                closest = &point;
            }
        }
        normalized = closest->value;
    } else if (port.integer) {
        normalized = std::round(normalized);
    }
    return std::max(port.minimum, std::min(port.maximum, normalized));
}

bool Engine::exportPresetForCommunity(const std::string& bankId, const std::string& presetId,
                                      Preset& exported, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Preset* preset = nullptr;
    for (Bank& bank : banks_) {
        if (bank.id != bankId) continue;
        for (Preset& candidate : bank.presets) {
            if (candidate.id == presetId) { preset = &candidate; break; }
        }
        break;
    }
    if (!preset) {
        error = "that local preset was not found";
        return false;
    }
    if (preset->community.isObject() && !preset->community.members().empty()) {
        error = "community-installed presets cannot be submitted again";
        return false;
    }
    exported = *preset;
    exported.activeSnapshot = -1;
    exported.rememberedSnapshotSlot = -1;
    exported.rememberedSnapshotEnabled = false;
    exported.community = Json::object();
    return true;
}

bool Engine::importCommunityPreset(const Json& manifest, bool incomplete,
                                   std::string& bankId, std::string& error) {
    if (!CommunityPresetPackage::validate(manifest, error)) return false;
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);

    Preset preset = CommunityPresetPackage::presetFromManifest(manifest);
    preset.id = newId("preset");
    Json provenance = Json::object();
    provenance.set("catalogId", manifest["id"].asString());
    provenance.set("author", manifest["author"].asString());
    provenance.set("license", manifest["license"].asString());
    provenance.set("manifestSha256", CommunityPresetPackage::checksum(manifest));
    provenance.set("incomplete", incomplete);
    provenance.set("dependencies", manifest["dependencies"]);
    preset.community = provenance;

    Bank* bank = nullptr;
    for (Bank& candidate : banks_) {
        if (candidate.communityHolding) { bank = &candidate; break; }
    }
    if (!bank) {
        Bank created;
        created.id = newId("bank");
        created.name = "Community";
        created.order = static_cast<int>(banks_.size());
        created.communityHolding = true;
        banks_.push_back(std::move(created));
        bank = &banks_.back();
    }
    bank->lastPresetId = preset.id;
    bank->presets.push_back(std::move(preset));
    if (!storage_.saveBank(*bank)) {
        error = "could not write the community bank";
        return false;
    }
    bankId = bank->id;
    notify();
    return true;
}

bool Engine::uninstallCommunityPreset(const std::string& catalogId, int& removed, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    removed = 0;
    std::vector<std::string> presetIds;
    for (const Bank& bank : banks_) {
        for (const Preset& preset : bank.presets) {
            if (preset.community["catalogId"].asString() == catalogId) presetIds.push_back(preset.id);
        }
    }
    if (presetIds.empty()) { error = "that community preset is not installed"; return false; }
    for (const std::string& presetId : presetIds) {
        Bank* bank = findBankForPreset(presetId);
        if (bank && bank->presets.size() <= 1 && !bank->communityHolding) {
            Preset placeholder;
            placeholder.id = newId("preset");
            placeholder.name = "Preset 1";
            bank->presets.push_back(std::move(placeholder));
            storage_.saveBank(*bank);
        }
        if (!deletePreset(presetId, error)) return false;
        ++removed;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Chain editing
// ---------------------------------------------------------------------------

bool Engine::addEffect(const std::string& uri, int index, std::string& slotId, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Preset* stored = activePreset();
    if (!stored) {
        error = "no active preset";
        return false;
    }
    if (snapshotMode_.load(std::memory_order_relaxed) || stored->activeSnapshot >= 0) {
        error = "snapshot editing cannot add, remove or reorder effects";
        return false;
    }
    Preset* preset = activeSessionDraft(true);
    const PluginInfo* info = catalog_.find(uri);
    if (!info) {
        error = "that plugin is not installed";
        return false;
    }

    syncPresetFromChain();

    EffectSlot slot;
    slot.id = newId("slot");
    slot.uri = uri;
    slot.name = info->name;
    slot.enabled = true;

    index = index < 0 ? static_cast<int>(preset->chain.size())
                      : std::min(index, static_cast<int>(preset->chain.size()));
    preset->chain.insert(preset->chain.begin() + index, slot);
    slotId = slot.id;

    std::string chainError;
    std::unique_ptr<Chain> chain = buildChain(*preset, chainError);
    if (!chainError.empty()) {
        error = chainError;
    }
    publishChain(std::move(chain));
    notify();
    return true;
}

bool Engine::replaceEffect(const std::string& slotId, const std::string& uri, std::string& newSlotId, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Preset* stored = activePreset();
    if (!stored) {
        error = "no active preset";
        return false;
    }
    if (snapshotMode_.load(std::memory_order_relaxed) || stored->activeSnapshot >= 0) {
        error = "snapshot editing cannot add, remove or reorder effects";
        return false;
    }
    Preset* preset = activeSessionDraft(true);
    const PluginInfo* info = catalog_.find(uri);
    if (!info) {
        error = "that plugin is not installed";
        return false;
    }
    syncPresetFromChain();
    const auto found = std::find_if(preset->chain.begin(), preset->chain.end(),
                                    [&](const EffectSlot& slot) { return slot.id == slotId; });
    if (found == preset->chain.end()) {
        error = "no such effect";
        return false;
    }
    const int index = static_cast<int>(found - preset->chain.begin());
    EffectSlot next;
    next.id = newId("slot");
    next.uri = uri;
    next.name = info->name;
    next.enabled = true;
    preset->chain.insert(preset->chain.begin() + index, next);
    newSlotId = next.id;

    std::string chainError;
    std::unique_ptr<Chain> chain = buildChain(*preset, chainError);
    if (!chain) {
        error = chainError.empty() ? "could not load that plugin" : chainError;
        preset->chain.erase(preset->chain.begin() + index);
        return false;
    }
    bool loaded = false;
    for (const auto& slot : chain->slots) {
        if (slot->id == next.id && slot->plugin) {
            loaded = true;
            break;
        }
    }
    if (!loaded) {
        error = chainError.empty() ? "could not load that plugin" : chainError;
        preset->chain.erase(preset->chain.begin() + index);
        return false;
    }

    const auto old = std::find_if(preset->chain.begin(), preset->chain.end(),
                                  [&](const EffectSlot& slot) { return slot.id == slotId; });
    if (old != preset->chain.end()) {
        preset->chain.erase(old);
    }
    preset->parameterBindings.erase(
        std::remove_if(preset->parameterBindings.begin(), preset->parameterBindings.end(),
                       [&](const ParameterBinding& binding) { return binding.slotId == slotId; }),
        preset->parameterBindings.end());
    chain = buildChain(*preset, chainError);
    publishChain(std::move(chain));
    notify();
    return true;
}

bool Engine::removeEffect(const std::string& slotId, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Preset* stored = activePreset();
    if (!stored) {
        error = "no active preset";
        return false;
    }
    if (snapshotMode_.load(std::memory_order_relaxed) || stored->activeSnapshot >= 0) {
        error = "snapshot editing cannot add, remove or reorder effects";
        return false;
    }
    Preset* preset = activeSessionDraft(true);
    syncPresetFromChain();

    const auto found = std::find_if(preset->chain.begin(), preset->chain.end(),
                                    [&](const EffectSlot& slot) { return slot.id == slotId; });
    if (found == preset->chain.end()) {
        error = "no such effect";
        return false;
    }
    preset->chain.erase(found);
    preset->parameterBindings.erase(
        std::remove_if(preset->parameterBindings.begin(), preset->parameterBindings.end(),
                       [&](const ParameterBinding& binding) { return binding.slotId == slotId; }),
        preset->parameterBindings.end());

    std::string chainError;
    publishChain(buildChain(*preset, chainError));
    notify();
    return true;
}

bool Engine::moveEffect(const std::string& slotId, int newIndex, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Preset* stored = activePreset();
    if (!stored) {
        error = "no active preset";
        return false;
    }
    if (snapshotMode_.load(std::memory_order_relaxed) || stored->activeSnapshot >= 0) {
        error = "snapshot editing cannot add, remove or reorder effects";
        return false;
    }
    Preset* preset = activeSessionDraft(true);
    syncPresetFromChain();

    const auto found = std::find_if(preset->chain.begin(), preset->chain.end(),
                                    [&](const EffectSlot& slot) { return slot.id == slotId; });
    if (found == preset->chain.end()) {
        error = "no such effect";
        return false;
    }
    EffectSlot moved = *found;
    preset->chain.erase(found);
    newIndex = std::max(0, std::min(newIndex, static_cast<int>(preset->chain.size())));
    preset->chain.insert(preset->chain.begin() + newIndex, std::move(moved));

    std::string chainError;
    publishChain(buildChain(*preset, chainError));
    notify();
    return true;
}

bool Engine::setEffectEnabled(const std::string& slotId, bool enabled, std::string& error,
                              bool persist) {
    std::lock_guard<std::recursive_mutex> stateLock(stateMutex_);
    (void)persist; // All sound changes remain in the session draft until Save.
    ActiveChainReadGuard chainGuard(*this);
    Chain* chain = chainGuard.get();
    if (!chain) {
        error = "no chain is running";
        return false;
    }
    if (chainPublicationExpected_.load(std::memory_order_acquire)
        || chain->presetId != activePresetId_) {
        error = "preset is still preparing";
        return false;
    }
    for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
        if (slot->id == slotId) {
            if (muteOnChangeEnabled_.load(std::memory_order_acquire)) {
                slot->pendingEnabled.store(enabled ? 1 : 0, std::memory_order_release);
                transitionRequested_.store(true, std::memory_order_release);
            } else {
                slot->enabled.store(enabled, std::memory_order_relaxed);
            }
            {
                std::lock_guard<std::recursive_mutex> lock(stateMutex_);
                Preset* storedPreset = activePreset();
                if (storedPreset && storedPreset->activeSnapshot < 0) {
                    Preset* preset = activeSessionDraft(true);
                    if (EffectSlot* working = preset->findSlot(slotId)) {
                        working->enabled = enabled;
                    }
                }
            }
            refreshLeds();
            notifyPerformance();
            return true;
        }
    }
    error = "no such effect";
    return false;
}

bool Engine::setControlValue(const std::string& slotId, const std::string& portSymbol,
                             float value, std::string& error, bool persist) {
    std::lock_guard<std::recursive_mutex> stateLock(stateMutex_);
    (void)persist; // Preview and release both update the same live session draft.
    ActiveChainReadGuard chainGuard(*this);
    Chain* chain = chainGuard.get();
    if (!chain) {
        error = "no chain is running";
        return false;
    }
    if (chainPublicationExpected_.load(std::memory_order_acquire)
        || chain->presetId != activePresetId_) {
        error = "preset is still preparing";
        return false;
    }

    for (size_t index = 0; index < chain->slots.size(); ++index) {
        ChainSlot& slot = *chain->slots[index];
        if (slot.id != slotId || !slot.plugin) {
            continue;
        }
        for (const PortInfo& port : slot.plugin->info().ports) {
            if (!port.control || !port.input || port.symbol != portSymbol) {
                continue;
            }
            const float clamped = normalizePortValue(port, value);
            // setControl only updates the atomic value consumed at the start
            // of the next plugin run. Updating it here also makes the immediate
            // state acknowledgement report the requested toggle/slider value.
            slot.plugin->setControl(port.index, clamped);
            bool clearedTempoLink = false;
            if (!port.trigger) {
                std::lock_guard<std::recursive_mutex> lock(stateMutex_);
                writeStoredControlUnlocked(slotId, portSymbol, clamped);
                if (Preset* preset = activeSessionDraft(false); preset && preset->activeSnapshot < 0) {
                    if (EffectSlot* working = preset->findSlot(slotId);
                        working && working->tempoLinks.has(portSymbol)) {
                        working->tempoLinks.remove(portSymbol);
                        clearedTempoLink = true;
                    }
                }
            }
            if (clearedTempoLink) notify();
            else notifyPerformance();
            return true;
        }
        error = "no such control on this effect";
        return false;
    }
    error = "no such effect";
    return false;
}

bool Engine::setTempoLink(const std::string& slotId, const std::string& portSymbol,
                          double quarterNoteBeats, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    if (!transportEnabled_.load(std::memory_order_acquire)) {
        error = "Tap Tempo Clock is disabled";
        return false;
    }
    Preset* storedPreset = activePreset();
    if (!storedPreset) {
        error = "no active preset";
        return false;
    }
    if (storedPreset->activeSnapshot >= 0) {
        error = "return to the base preset before changing Tempo Link";
        return false;
    }
    Preset* preset = activeSessionDraft(true);
    EffectSlot* stored = preset->findSlot(slotId);
    ActiveChainReadGuard chainGuard(*this);
    Chain* chain = chainGuard.get();
    if (!stored || !chain) {
        error = "no such effect";
        return false;
    }
    if (chainPublicationExpected_.load(std::memory_order_acquire)
        || chain->presetId != activePresetId_) {
        error = "preset is still preparing";
        return false;
    }
    for (size_t slotIndex = 0; slotIndex < chain->slots.size(); ++slotIndex) {
        ChainSlot& live = *chain->slots[slotIndex];
        if (live.id != slotId || !live.plugin) continue;
        for (const PortInfo& port : live.plugin->info().ports) {
            if (port.symbol != portSymbol || !port.control || !port.input) continue;
            if (quarterNoteBeats <= 0.0) {
                writeStoredControlUnlocked(slotId, portSymbol, live.plugin->control(port.index));
                stored->tempoLinks.remove(portSymbol);
            } else {
                float value = 0.0f;
                if (!tempoLinkedPortValue(port, quarterNoteBeats, transport_.bpm(), value)) {
                    error = "that control does not provide compatible LV2 time units";
                    return false;
                }
                stored->tempoLinks.set(portSymbol, Json(quarterNoteBeats));
                live.plugin->setControl(port.index, value);
            }
            notify();
            return true;
        }
        error = "no such control on this effect";
        return false;
    }
    error = "no such effect";
    return false;
}

void Engine::applyTempoLinksUnlocked(const Preset& preset, bool deferControls) {
    if (!transportEnabled_.load(std::memory_order_acquire)) return;
    ActiveChainReadGuard chainGuard(*this);
    Chain* chain = chainGuard.get();
    if (!chain || chainPublicationExpected_.load(std::memory_order_acquire)
        || chain->presetId != preset.id) return;
    const double bpm = transport_.bpm();
    for (size_t slotIndex = 0; slotIndex < chain->slots.size(); ++slotIndex) {
        ChainSlot& live = *chain->slots[slotIndex];
        const EffectSlot* stored = preset.findSlot(live.id);
        if (!stored || !live.plugin || !stored->tempoLinks.isObject()) continue;
        for (const Json::Member& link : stored->tempoLinks.members()) {
            for (const PortInfo& port : live.plugin->info().ports) {
                float value = 0.0f;
                if (port.symbol == link.first
                    && tempoLinkedPortValue(port, link.second.asDouble(), bpm, value)) {
                    if (deferControls) live.plugin->setControlDeferred(port.index, value);
                    else live.plugin->setControl(port.index, value);
                    break;
                }
            }
        }
    }
}

bool Engine::nudgeEncoderParameter(const ActionRequest& request, std::string& error) {
    std::lock_guard<std::recursive_mutex> stateLock(stateMutex_);
    ActiveChainReadGuard chainGuard(*this);
    Chain* chain = chainGuard.get();
    if (!chain) {
        error = "no chain is running";
        return false;
    }
    if (chainPublicationExpected_.load(std::memory_order_acquire)
        || chain->presetId != activePresetId_) {
        error = "preset is still preparing";
        return false;
    }
    int delta = request.delta != 0 ? request.delta : (request.value >= 0.0f ? 1 : -1);
    if (request.fromPresetBind && request.binding.inverted) {
        delta = -delta;
    }
    for (size_t index = 0; index < chain->slots.size(); ++index) {
        ChainSlot& slot = *chain->slots[index];
        if (slot.id != request.binding.slotId || !slot.plugin) {
            continue;
        }
        for (const PortInfo& port : slot.plugin->info().ports) {
            if (!port.control || !port.input || port.symbol != request.binding.portSymbol) {
                continue;
            }
            const float current = slot.plugin->control(port.index);
            const float span = port.maximum - port.minimum;
            float step = span == 0.0f ? 0.01f : span / 64.0f;
            if (port.enumerated && !port.scalePoints.empty()) {
                size_t selected = 0;
                for (size_t point = 1; point < port.scalePoints.size(); ++point) {
                    if (std::abs(port.scalePoints[point].value - current)
                        < std::abs(port.scalePoints[selected].value - current)) {
                        selected = point;
                    }
                }
                // Encoder acceleration is useful for continuous ranges, but an
                // enumerated selector must visit every adjacent choice.  A
                // burst delta of two would otherwise skip the middle option.
                const long direction = delta < 0 ? -1L : 1L;
                const long nextIndex = std::max<long>(0, std::min<long>(
                    static_cast<long>(port.scalePoints.size()) - 1,
                    static_cast<long>(selected) + direction));
                return setControlValue(request.binding.slotId, request.binding.portSymbol,
                                       port.scalePoints[static_cast<size_t>(nextIndex)].value,
                                       error, false);
            }
            if (port.integer) {
                step = 1.0f;
            } else if (port.rangeSteps > 1) {
                step = span / static_cast<float>(port.rangeSteps - 1);
            } else if (request.fine) {
                step *= 0.25f;
            }
            if (port.toggled) {
                return setControlValue(request.binding.slotId, request.binding.portSymbol,
                                       delta > 0 ? port.maximum : port.minimum, error, false);
            }
            float next = current + static_cast<float>(delta) * step;
            if (port.logarithmic && port.minimum != 0.0f && port.maximum != 0.0f
                && ((port.minimum > 0.0f) == (port.maximum > 0.0f))) {
                const unsigned steps = port.rangeSteps > 1 ? port.rangeSteps : 65;
                const double ratio = static_cast<double>(port.maximum) / port.minimum;
                const double position = std::log(static_cast<double>(current) / port.minimum)
                                      / std::log(ratio);
                const double detents = static_cast<double>(delta) * (request.fine ? 0.25 : 1.0);
                const double nextPosition = std::max(0.0, std::min(1.0,
                    position + detents / static_cast<double>(steps - 1)));
                next = static_cast<float>(port.minimum * std::pow(ratio, nextPosition));
            }
            if (!setControlValue(request.binding.slotId, request.binding.portSymbol, next, error, false)) {
                return false;
            }
            notifyPerformance();
            return true;
        }
        error = "no such control on this effect";
        return false;
    }
    error = "no such effect";
    return false;
}

bool Engine::setEffectProperty(const std::string& slotId, const std::string& propertyUri,
                               const std::string& path, std::string& error, bool persist) {
    std::lock_guard<std::recursive_mutex> stateLock(stateMutex_);
    std::string resolved = path;
    if (!path.empty()) {
        resolved = resolvePluginFilePath(storage_, propertyUri, path, error);
        if (resolved.empty()) {
            return false;
        }
    }

    ActiveChainReadGuard chainGuard(*this);
    Chain* chain = chainGuard.get();
    if (!chain) {
        error = "no chain is running";
        return false;
    }
    if (chainPublicationExpected_.load(std::memory_order_acquire)
        || chain->presetId != activePresetId_) {
        error = "preset is still preparing";
        return false;
    }
    for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
        if (slot->id != slotId || !slot->plugin) {
            continue;
        }
        const bool mutedTransition = muteOnChangeEnabled_.load(std::memory_order_acquire);
        if (mutedTransition) {
            // Hold the patch:Set inside the plugin host until the master has
            // reached absolute silence. The audio thread releases it from the
            // Muted state without taking a lock.
            slot->plugin->holdPropertyChanges();
        }
        if (!slot->plugin->setProperty(propertyUri, resolved, error)) {
            if (mutedTransition) slot->plugin->releasePropertyChanges();
            return false;
        }
        if (mutedTransition) {
            transitionRequested_.store(true, std::memory_order_release);
        }
        if (persist) {
            Preset* storedPreset = activePreset();
            if (storedPreset && storedPreset->activeSnapshot < 0) {
                Preset* preset = activeSessionDraft(true);
                if (EffectSlot* working = preset->findSlot(slotId)) {
                    Json properties = working->state["properties"].isObject()
                                    ? working->state["properties"] : Json::object();
                    properties.set(propertyUri, Json(resolved));
                    Json state = working->state.isObject() ? working->state : Json::object();
                    state.set("properties", properties);
                    working->state = state;
                }
            }
        }
        if (backing_) backing_->refreshPlaylist();
        notify();
        return true;
    }
    error = "no such effect";
    return false;
}

bool Engine::setBypassAll(bool bypassed) {
    if (muteOnChangeEnabled_.load(std::memory_order_acquire)) {
        pendingBypassAll_.store(bypassed ? 1 : 0, std::memory_order_release);
        transitionRequested_.store(true, std::memory_order_release);
    } else {
        bypassAll_.store(bypassed, std::memory_order_relaxed);
    }
    refreshLeds();
    notifyPerformance();
    return true;
}

bool Engine::bypassAll() const {
    return bypassAll_.load(std::memory_order_relaxed);
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

Snapshot Engine::captureCurrentChain(const std::string& name) const {
    Snapshot snapshot;
    snapshot.id = newId("snap");
    snapshot.name = name.empty() ? "Snapshot" : name;

    ActiveChainReadGuard chainGuard(*this);
    Chain* chain = chainGuard.get();
    if (!chain || chainPublicationExpected_.load(std::memory_order_acquire)
        || chain->presetId != activePresetId_) {
        return snapshot;
    }
    Json slots = Json::object();
    for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
        if (!slot->plugin) {
            continue;
        }
        Json state = slot->plugin->saveState();
        state.set("enabled", slot->enabled.load(std::memory_order_relaxed));
        slots.set(slot->id, state);
    }
    snapshot.slots = slots;
    return snapshot;
}

Snapshot* Engine::findSnapshotBySlot(Preset& preset, int slot) {
    if (slot < 0) {
        return nullptr;
    }
    for (Snapshot& snapshot : preset.snapshots) {
        if (snapshot.slot == slot) {
            return &snapshot;
        }
    }
    return nullptr;
}

const Snapshot* Engine::findSnapshotBySlot(const Preset& preset, int slot) const {
    if (slot < 0) {
        return nullptr;
    }
    for (const Snapshot& snapshot : preset.snapshots) {
        if (snapshot.slot == slot) {
            return &snapshot;
        }
    }
    return nullptr;
}

void Engine::restoreStoredPresetToChainUnlocked(Preset& preset) {
    ActiveChainReadGuard chainGuard(*this);
    Chain* chain = chainGuard.get();
    if (!chain || chainPublicationExpected_.load(std::memory_order_acquire)
        || chain->presetId != preset.id) {
        return;
    }
    const bool mutedTransition = muteOnChangeEnabled_.load(std::memory_order_acquire);
    bool stateLoaded = false;
    for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
        if (!slot->plugin) {
            continue;
        }
        const EffectSlot* stored = preset.findSlot(slot->id);
        if (!stored) {
            continue;
        }
        if (mutedTransition) slot->plugin->beginDeferredStateChanges();
        slot->plugin->loadState(rewritePluginStateFiles(storage_, stored->state), mutedTransition);
        if (mutedTransition) slot->pendingEnabled.store(stored->enabled ? 1 : 0, std::memory_order_release);
        else slot->enabled.store(stored->enabled, std::memory_order_relaxed);
        stateLoaded = true;
    }
    if (mutedTransition && stateLoaded) transitionRequested_.store(true, std::memory_order_release);
    applyTempoLinksUnlocked(preset, mutedTransition);
    preset.activeSnapshot = -1;
    armAnalogCatchUnlocked();
}

void Engine::restoreSessionOrStoredPresetToChainUnlocked(Preset& preset) {
    auto draft = sessionPresetDrafts_.find(preset.id);
    if (draft != sessionPresetDrafts_.end()) {
        restoreStoredPresetToChainUnlocked(draft->second);
        preset.activeSnapshot = -1;
        return;
    }
    restoreStoredPresetToChainUnlocked(preset);
}

void Engine::forgetRememberedSnapshot(Preset& preset) {
    preset.rememberedSnapshotSlot = -1;
    preset.rememberedSnapshotEnabled = false;
}

void Engine::rememberSnapshot(Preset& preset, int slot, bool enabled) {
    preset.rememberedSnapshotSlot = slot;
    preset.rememberedSnapshotEnabled = enabled;
}

bool Engine::toggleRememberedSnapshotUnlocked(Preset& preset, std::string& error) {
    if (!activeChainReadyForPreset(preset)) {
        error = "preset is still preparing";
        return false;
    }
    if (preset.rememberedSnapshotSlot < 0) {
        return true;
    }
    if (preset.rememberedSnapshotEnabled) {
        restoreSessionOrStoredPresetToChainUnlocked(preset);
        preset.rememberedSnapshotEnabled = false;
        return true;
    }
    Snapshot* snapshot = findSnapshotBySlot(preset, preset.rememberedSnapshotSlot);
    if (!snapshot) {
        forgetRememberedSnapshot(preset);
        error = "snapshot is empty";
        return false;
    }
    applySnapshotToChain(*snapshot);
    preset.activeSnapshot = snapshot->slot;
    preset.rememberedSnapshotEnabled = true;
    return true;
}

bool Engine::applyRememberedSnapshotUnlocked(Preset& preset) {
    if (!preset.rememberedSnapshotEnabled || preset.rememberedSnapshotSlot < 0) {
        preset.activeSnapshot = -1;
        return true;
    }
    Snapshot* snapshot = findSnapshotBySlot(preset, preset.rememberedSnapshotSlot);
    if (!snapshot) {
        forgetRememberedSnapshot(preset);
        preset.activeSnapshot = -1;
        return true;
    }
    flushPendingBasePresetUnlocked();
    applySnapshotToChain(*snapshot);
    preset.activeSnapshot = snapshot->slot;
    return true;
}

bool Engine::pressSnapshotSlotUnlocked(Preset& preset, int slot, std::string& error) {
    if (!activeChainReadyForPreset(preset)) {
        error = "preset is still preparing";
        return false;
    }
    Snapshot* snapshot = findSnapshotBySlot(preset, slot);
    if (!snapshot) {
        error = "snapshot is empty";
        return false;
    }
    if (preset.activeSnapshot == slot && preset.rememberedSnapshotEnabled) {
        restoreSessionOrStoredPresetToChainUnlocked(preset);
        forgetRememberedSnapshot(preset);
        return true;
    }
    flushPendingBasePresetUnlocked();
    applySnapshotToChain(*snapshot);
    preset.activeSnapshot = slot;
    rememberSnapshot(preset, slot, true);
    return true;
}

void Engine::applySnapshotToChain(const Snapshot& snapshot) {
    ActiveChainReadGuard chainGuard(*this);
    Chain* chain = chainGuard.get();
    if (!chain || chainPublicationExpected_.load(std::memory_order_acquire)
        || chain->presetId != activePresetId_) {
        return;
    }
    const bool mutedTransition = muteOnChangeEnabled_.load(std::memory_order_acquire);
    bool stateLoaded = false;
    for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
        if (!slot->plugin || !snapshot.slots.has(slot->id)) {
            continue;
        }
        const Json& state = snapshot.slots[slot->id];
        if (mutedTransition) slot->plugin->beginDeferredStateChanges();
        slot->plugin->loadState(rewritePluginStateFiles(storage_, state, &missingPluginFiles_),
                                mutedTransition);
        const bool enabled = state["enabled"].asBool(true);
        if (mutedTransition) slot->pendingEnabled.store(enabled ? 1 : 0, std::memory_order_release);
        else slot->enabled.store(enabled, std::memory_order_relaxed);
        stateLoaded = true;
    }
    if (mutedTransition && stateLoaded) transitionRequested_.store(true, std::memory_order_release);
    if (const Preset* preset = effectiveActivePreset()) applyTempoLinksUnlocked(*preset, mutedTransition);
    armAnalogCatchUnlocked();
}

bool Engine::captureSnapshot(const std::string& name, int slot, std::string& snapshotId, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    if (!preset) {
        error = "no active preset";
        return false;
    }
    if (!activeChainReadyForPreset(*preset)) {
        error = "preset is still preparing";
        return false;
    }
    int targetSlot = slot;
    if (targetSlot < 0) {
        targetSlot = 0;
        while (findSnapshotBySlot(*preset, targetSlot)) {
            targetSlot += 1;
        }
    }
    Snapshot captured = captureCurrentChain(name.empty() ? ("Snapshot " + std::to_string(targetSlot + 1)) : name);
    captured.slot = targetSlot;
    if (Snapshot* existing = findSnapshotBySlot(*preset, targetSlot)) {
        existing->slots = captured.slots;
        if (!name.empty()) {
            existing->name = name;
        }
        snapshotId = existing->id;
    } else {
        snapshotId = captured.id;
        preset->snapshots.push_back(std::move(captured));
    }
    preset->activeSnapshot = targetSlot;
    rememberSnapshot(*preset, targetSlot, true);

    if (Bank* bank = activeBank()) {
        storage_.saveBank(*bank);
    }
    notify();
    return true;
}

bool Engine::selectSnapshot(const std::string& snapshotId, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    if (!preset) {
        error = "no active preset";
        return false;
    }
    if (!activeChainReadyForPreset(*preset)) {
        error = "preset is still preparing";
        return false;
    }
    for (Snapshot& snapshot : preset->snapshots) {
        if (snapshot.id != snapshotId) {
            continue;
        }
        const int slot = snapshot.slot >= 0 ? snapshot.slot : 0;
        if (!pressSnapshotSlotUnlocked(*preset, slot, error)) {
            return false;
        }
        persistActiveBankUnlocked();
        refreshLeds();
        notify();
        return true;
    }
    error = "no such snapshot";
    return false;
}

bool Engine::updateSnapshot(const std::string& snapshotId, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    if (!preset) {
        error = "no active preset";
        return false;
    }
    if (!activeChainReadyForPreset(*preset)) {
        error = "preset is still preparing";
        return false;
    }
    for (Snapshot& snapshot : preset->snapshots) {
        if (snapshot.id != snapshotId) {
            continue;
        }
        const Snapshot captured = captureCurrentChain(snapshot.name);
        snapshot.slots = captured.slots;
        if (Bank* bank = activeBank()) {
            storage_.saveBank(*bank);
        }
        notify();
        return true;
    }
    error = "no such snapshot";
    return false;
}

bool Engine::renameSnapshot(const std::string& snapshotId, const std::string& name, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    if (!preset) {
        error = "no active preset";
        return false;
    }
    for (Snapshot& snapshot : preset->snapshots) {
        if (snapshot.id != snapshotId) {
            continue;
        }
        snapshot.name = name.empty() ? snapshot.name : name;
        storage_.saveBank(*activeBank());
        notify();
        return true;
    }
    error = "no such snapshot";
    return false;
}

bool Engine::colorSnapshot(const std::string& snapshotId, const std::string& color, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    if (!preset) {
        error = "no active preset";
        return false;
    }
    for (Snapshot& snapshot : preset->snapshots) {
        if (snapshot.id != snapshotId) {
            continue;
        }
        snapshot.color = color;
        storage_.saveBank(*activeBank());
        notify();
        return true;
    }
    error = "no such snapshot";
    return false;
}

bool Engine::setSnapshotMode(bool enabled) {
    snapshotMode_.store(enabled, std::memory_order_relaxed);
    notify();
    notifyPerformance();
    return true;
}

bool Engine::restoreLiveFromStoredPreset(std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    ActiveChainReadGuard chainGuard(*this);
    Chain* chain = chainGuard.get();
    if (!preset || !chain) {
        error = "no active preset";
        return false;
    }
    std::string chainError;
    std::unique_ptr<Chain> restored = buildChain(*preset, chainError);
    if (!restored) {
        error = chainError.empty() ? "could not restore the saved preset" : chainError;
        return false;
    }
    clearSessionDraft(preset->id);
    publishChain(std::move(restored));
    preset->activeSnapshot = -1;
    preset->rememberedSnapshotEnabled = false;
    refreshLeds();
    notify();
    return true;
}

bool Engine::deleteSnapshot(const std::string& snapshotId, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Preset* preset = activePreset();
    if (!preset) {
        error = "no active preset";
        return false;
    }
    const auto found = std::find_if(preset->snapshots.begin(), preset->snapshots.end(),
                                    [&](const Snapshot& snapshot) { return snapshot.id == snapshotId; });
    if (found == preset->snapshots.end()) {
        error = "no such snapshot";
        return false;
    }
    if (preset->rememberedSnapshotSlot == found->slot) {
        forgetRememberedSnapshot(*preset);
    }
    if (preset->activeSnapshot == found->slot) {
        if (!activeChainReadyForPreset(*preset)) {
            error = "preset is still preparing";
            return false;
        }
        restoreSessionOrStoredPresetToChainUnlocked(*preset);
        forgetRememberedSnapshot(*preset);
        preset->activeSnapshot = -1;
    }
    preset->snapshots.erase(found);
    if (Bank* bank = activeBank()) {
        storage_.saveBank(*bank);
    }
    notify();
    return true;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

bool Engine::applyControllerConfig(const Json& json, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    const std::string previousPort = settings_.controller.midiPort;
    const bool wasEnabled = settings_.controller.enabled;
    settings_.controller = ControllerConfig::fromJson(json);
    migrateHardwareParameterBinds();
    controller_.setConfig(settings_.controller);

    const bool portChanged = settings_.controller.midiPort != previousPort;

    if (settings_.controller.enabled) {
        if (!midi_.isRunning() || portChanged || !wasEnabled) {
            std::string midiError;
            if (!midi_.start(settings_.controller.midiPort, midiError)) {
                controllerError_ = midiError;
                persistSettings();
                refreshLeds();
                notify();
                error = midiError;
                return false;
            }
            controllerError_.clear();
            settings_.controller.midiPort = midi_.activePort();
            controller_.setConfig(settings_.controller);
            midi_.send(ControllerRuntime::encodeIdentityRequest());
        }
    } else if (midi_.isRunning()) {
        midi_.stop();
    }

    persistSettings();
    armAnalogCatchUnlocked();
    refreshLeds();
    notify();
    error.clear();
    return true;
}

bool Engine::connectController(const std::string& port, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    if (!midi_.start(port, error)) {
        controllerError_ = error;
        notify();
        return false;
    }
    settings_.controller.enabled = true;
    settings_.controller.midiPort = midi_.activePort();
    controller_.setConfig(settings_.controller);
    controllerError_.clear();
    persistSettings();

    midi_.send(ControllerRuntime::encodeIdentityRequest());
    refreshLeds();
    notify();
    return true;
}

void Engine::disconnectController() {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    midi_.stop();
    settings_.controller.enabled = false;
    persistSettings();
    notify();
}

void Engine::beginControlLearn(const std::string& controlId) {
    controller_.beginLearn(controlId);
    notify();
}

void Engine::cancelControlLearn() {
    controller_.cancelLearn();
    notify();
}

void Engine::overlayPresetBind(ActionRequest& request) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    const Preset* preset = effectiveActivePreset();
    if (!preset) {
        return;
    }
    const ParameterBinding* bind = preset->findParameterBinding(request.controlId);
    if (!bind) {
        return;
    }
    request.fromPresetBind = true;
    request.action = bind->action;
    request.binding.action = bind->action;
    request.binding.slotId = bind->slotId;
    request.binding.portSymbol = bind->portSymbol;
    request.binding.bankId = bind->bankId;
    request.binding.presetId = bind->presetId;
    request.binding.snapshotId = bind->snapshotId;
    request.binding.snapshotSlot = bind->snapshotSlot;
    request.binding.minimum = bind->minimum;
    request.binding.maximum = bind->maximum;
    // Physical direction is owned by Hardware Setup. Per-preset reversal is
    // reserved for preset-owned virtual controls and is edited with the
    // Virtual Controls layout.
    request.binding.inverted = findVirtualControl(request.controlId).has_value() && bind->inverted;
}

void Engine::migrateHardwareParameterBinds() {
    Preset* preset = activePreset();
    bool changedSettings = false;
    bool changedPreset = false;
    for (ControllerControl& control : settings_.controller.controls) {
        const std::string action = control.binding.action;
        if (action != "setParameter" && action != "toggleEffect") {
            continue;
        }
        if (preset && !control.id.empty()) {
            ParameterBinding bind;
            bind.controlId = control.id;
            bind.action = action;
            bind.slotId = control.binding.slotId;
            bind.portSymbol = control.binding.portSymbol;
            bind.minimum = control.binding.minimum;
            bind.maximum = control.binding.maximum;
            bind.inverted = control.binding.inverted;
            if (ParameterBinding* existing = preset->findParameterBinding(control.id)) {
                *existing = std::move(bind);
            } else {
                preset->parameterBindings.push_back(std::move(bind));
            }
            changedPreset = true;
            control.binding.action = "none";
            control.binding.slotId.clear();
            control.binding.portSymbol.clear();
            changedSettings = true;
        }
    }
    for (ControllerControl& control : settings_.controller.controls) {
        if (!isContinuousKind(control.kind)) {
            continue;
        }
        const std::string action = control.binding.action;
        if (action.empty() || action == "none" || action == "setParameter" || action == "toggleEffect"
            || action == "virtualControlProxy") {
            continue;
        }
        control.binding.action = "none";
        changedSettings = true;
    }
    if (changedSettings) {
        controller_.setConfig(settings_.controller);
        persistSettings();
    }
    if (changedPreset) {
        if (Bank* bank = activeBank()) {
            storage_.saveBank(*bank);
        }
    }
}

bool Engine::bindPresetControl(const Json& json, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    const std::string requestedPresetId = json["ownerPresetId"].asString();
    Preset* preset = requestedPresetId.empty() ? activePreset() : findPresetAnywhere(requestedPresetId);
    if (!preset) {
        error = requestedPresetId.empty() ? "no active preset" : "no such preset";
        return false;
    }
    Bank* owner = requestedPresetId.empty() ? activeBank() : findBankForPreset(requestedPresetId);
    const std::string requestedBankId = json["ownerBankId"].asString();
    if (!requestedBankId.empty() && (!owner || owner->id != requestedBankId)) {
        error = "preset is not in that bank";
        return false;
    }

    const std::string controlId = json["controlId"].asString();
    const std::string action = json["action"].asString("none");
    if (controlId.empty()) {
        error = "controlId required";
        return false;
    }
    const std::optional<VirtualControl> virtualControl = findVirtualControl(controlId);

    ParameterBinding bind;
    bind.controlId = controlId;
    bind.action = action;
    bind.slotId = json["slotId"].asString();
    bind.portSymbol = json["portSymbol"].asString();
    bind.bankId = json["targetBankId"].asString();
    bind.presetId = json["targetPresetId"].asString();
    bind.snapshotId = json["snapshotId"].asString();
    bind.snapshotSlot = json["snapshotSlot"].asInt(-1);
    bind.minimum = json["min"].asFloat(0.0f);
    bind.maximum = json["max"].asFloat(1.0f);
    bind.inverted = virtualControl && json["inverted"].asBool(false);

    if (action == "setParameter" || action == "toggleEffect") {
        if (bind.slotId.empty()) {
            error = "slotId required";
            return false;
        }
        if (action == "setParameter" && bind.portSymbol.empty()) {
            error = "portSymbol required";
            return false;
        }
        if (!preset->findSlot(bind.slotId)) {
            error = "no such effect";
            return false;
        }
        if (action == "setParameter") {
            const EffectSlot* slot = preset->findSlot(bind.slotId);
            const PluginInfo* plugin = slot ? catalog_.find(slot->uri) : nullptr;
            if (plugin) {
                const auto port = std::find_if(plugin->ports.begin(), plugin->ports.end(),
                    [&](const PortInfo& item) {
                        return item.symbol == bind.portSymbol && item.control && item.input && !item.notOnGui;
                    });
                if (port == plugin->ports.end()) {
                    error = "no such bindable parameter";
                    return false;
                }
                if (virtualControl) {
                    const ControlKind kind = virtualControl->kind;
                    const bool compatible = kind == ControlKind::Momentary ? port->trigger
                        : kind == ControlKind::Latching ? port->toggled
                        : (kind == ControlKind::Pot || kind == ControlKind::Slider
                            || kind == ControlKind::Expression) ? !port->trigger && !port->toggled
                        : kind == ControlKind::Encoder ? !port->trigger
                        : false;
                    if (!compatible) {
                        error = "parameter is incompatible with that virtual control type";
                        return false;
                    }
                }
            }
        }
    } else if (action != "none" && !action.empty() && !presetActionAllowed(action)) {
        error = "unsupported preset control action";
        return false;
    }
    if (action == "selectPreset") {
        Preset* targetPreset = bind.presetId.empty() ? nullptr : findPresetAnywhere(bind.presetId);
        Bank* targetBank = bind.presetId.empty() ? nullptr : findBankForPreset(bind.presetId);
        if (!targetPreset || (!bind.bankId.empty() && (!targetBank || targetBank->id != bind.bankId))) {
            error = "no such target preset";
            return false;
        }
    }
    if (action == "selectSnapshot" && (!virtualControl || virtualControl->kind != ControlKind::Encoder)) {
        const bool foundSnapshot = std::any_of(preset->snapshots.begin(), preset->snapshots.end(),
            [&](const Snapshot& snapshot) {
                return (bind.snapshotSlot >= 0 && snapshot.slot == bind.snapshotSlot)
                    || (!bind.snapshotId.empty() && snapshot.id == bind.snapshotId);
            });
        if (!foundSnapshot) {
            error = "no such target snapshot";
            return false;
        }
    }
    if (virtualControl && action != "none" && !action.empty()) {
        if ((virtualControl->kind == ControlKind::Pot || virtualControl->kind == ControlKind::Slider
             || virtualControl->kind == ControlKind::Expression) && action != "setParameter") {
            error = "continuous virtual controls require a parameter target";
            return false;
        }
        if (action == "toggleEffect" && virtualControl->kind != ControlKind::Momentary
            && virtualControl->kind != ControlKind::Latching
            && virtualControl->kind != ControlKind::Encoder) {
            error = "effect bypass is incompatible with that virtual control type";
            return false;
        }
    }

    const std::vector<ParameterBinding> previousBindings = preset->parameterBindings;
    preset->parameterBindings.erase(
        std::remove_if(preset->parameterBindings.begin(), preset->parameterBindings.end(),
                       [&](const ParameterBinding& item) { return item.controlId == controlId; }),
        preset->parameterBindings.end());
    if (action != "none" && !action.empty()) {
        preset->parameterBindings.push_back(std::move(bind));
    }

    if (owner && !storage_.saveBank(*owner)) {
        preset->parameterBindings = previousBindings;
        error = "could not save preset bindings";
        return false;
    }
    if (auto draft = sessionPresetDrafts_.find(preset->id); draft != sessionPresetDrafts_.end()) {
        draft->second.parameterBindings = preset->parameterBindings;
    }
    proxyCatch_.clear();
    refreshLeds();
    notify();
    return true;
}

VirtualControlsConfig Engine::effectiveVirtualControlsConfig() const {
    const Preset* preset = effectiveActivePreset();
    if (preset && preset->virtualControlSurface.isObject()
        && preset->virtualControlSurface["mode"].asString("shared") != "shared"
        && preset->virtualControlSurface["layout"].isObject()) {
        return VirtualControlsConfig::fromJson(preset->virtualControlSurface["layout"]);
    }
    return settings_.virtualControls;
}

std::optional<VirtualControl> Engine::findVirtualControl(const std::string& controlId) const {
    const VirtualControlsConfig config = effectiveVirtualControlsConfig();
    for (const VirtualControl& control : config.controls) {
        if (control.id == controlId) return control;
    }
    return std::nullopt;
}

bool Engine::applyVirtualControlsConfig(const Json& json, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    const bool preserveBindings = json["preserveBindings"].asBool(false);
    const bool presetScope = json["scope"].asString() == "preset";
    const std::string requestedMode = json["mode"].asString(presetScope ? "custom" : "shared");
    if (presetScope && requestedMode != "shared" && requestedMode != "custom" && requestedMode != "auto") {
        error = "invalid virtual controls surface mode";
        return false;
    }
    VirtualControlsConfig next = requestedMode == "shared"
        ? settings_.virtualControls : VirtualControlsConfig::fromJson(json);
    std::vector<std::string> ids;
    ids.reserve(next.controls.size());
    for (const VirtualControl& control : next.controls) {
        if (control.id.empty()) {
            error = "virtual control id required";
            return false;
        }
        if (control.kind != ControlKind::Momentary && control.kind != ControlKind::Latching
            && control.kind != ControlKind::Pot && control.kind != ControlKind::Encoder
            && control.kind != ControlKind::Slider) {
            error = "unsupported virtual control type";
            return false;
        }
        if (std::find(ids.begin(), ids.end(), control.id) != ids.end()) {
            error = "duplicate virtual control id";
            return false;
        }
        for (const ControllerControl& physical : settings_.controller.controls) {
            if (physical.id == control.id) {
                error = "virtual control id conflicts with hardware";
                return false;
            }
        }
        ids.push_back(control.id);
    }

    if (presetScope) {
        Preset* preset = activePreset();
        Bank* owner = activeBank();
        if (!preset || !owner) {
            error = "no active preset";
            return false;
        }
        const VirtualControlsConfig previous = effectiveVirtualControlsConfig();
        const Json previousSurface = preset->virtualControlSurface;
        std::vector<ParameterBinding> previousBindings = preset->parameterBindings;
        Json surface = Json::object();
        surface.set("mode", requestedMode);
        if (requestedMode != "shared") surface.set("layout", next.toJson());
        preset->virtualControlSurface = std::move(surface);

        if (!preserveBindings) {
            std::vector<std::string> removed;
            for (const VirtualControl& old : previous.controls) {
                if (std::find(ids.begin(), ids.end(), old.id) == ids.end()) removed.push_back(old.id);
            }
            preset->parameterBindings.erase(std::remove_if(
                preset->parameterBindings.begin(), preset->parameterBindings.end(),
                [&](const ParameterBinding& binding) {
                    return std::find(removed.begin(), removed.end(), binding.controlId) != removed.end();
                }), preset->parameterBindings.end());
            if (std::find(removed.begin(), removed.end(), activeVirtualControlId_) != removed.end()) {
                activeVirtualControlId_.clear();
            }
        }
        if (!storage_.saveBank(*owner)) {
            preset->virtualControlSurface = previousSurface;
            preset->parameterBindings = std::move(previousBindings);
            error = "could not save preset virtual controls";
            return false;
        }
        if (auto draft = sessionPresetDrafts_.find(preset->id); draft != sessionPresetDrafts_.end()) {
            draft->second.virtualControlSurface = preset->virtualControlSurface;
            draft->second.parameterBindings = preset->parameterBindings;
        }
        proxyCatch_.clear();
        notify();
        error.clear();
        return true;
    }

    std::vector<std::string> removed;
    for (const VirtualControl& old : settings_.virtualControls.controls) {
        if (std::find(ids.begin(), ids.end(), old.id) == ids.end()) removed.push_back(old.id);
    }
    const VirtualControlsConfig previousConfig = settings_.virtualControls;
    const std::vector<Bank> previousBanks = banks_;
    const std::string previousActiveControl = activeVirtualControlId_;
    settings_.virtualControls = std::move(next);
    if (!removed.empty() && !preserveBindings) {
        for (Bank& bank : banks_) {
            bool changed = false;
            for (Preset& preset : bank.presets) {
                if (preset.virtualControlSurface["mode"].asString("shared") != "shared") continue;
                const size_t before = preset.parameterBindings.size();
                preset.parameterBindings.erase(std::remove_if(
                    preset.parameterBindings.begin(), preset.parameterBindings.end(),
                    [&](const ParameterBinding& binding) {
                        return std::find(removed.begin(), removed.end(), binding.controlId) != removed.end();
                    }), preset.parameterBindings.end());
                changed = changed || before != preset.parameterBindings.size();
            }
            if (changed && !storage_.saveBank(bank)) {
                settings_.virtualControls = previousConfig;
                banks_ = previousBanks;
                activeVirtualControlId_ = previousActiveControl;
                for (const Bank& restore : banks_) storage_.saveBank(restore);
                error = "could not remove obsolete virtual bindings";
                return false;
            }
        }
    }
    if (std::find(removed.begin(), removed.end(), activeVirtualControlId_) != removed.end()) {
        activeVirtualControlId_.clear();
    }
    proxyCatch_.clear();
    if (!persistSettings()) {
        settings_.virtualControls = previousConfig;
        banks_ = previousBanks;
        activeVirtualControlId_ = previousActiveControl;
        for (const Bank& restore : banks_) storage_.saveBank(restore);
        persistSettings();
        error = "could not save virtual controls";
        return false;
    }
    notify();
    error.clear();
    return true;
}

bool Engine::selectVirtualSurfaceControl(const std::string& controlId, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    if (controlId.empty()) {
        activeVirtualControlId_.clear();
        proxyCatch_.clear();
        ++virtualControlRevision_;
        notifyPerformance();
        error.clear();
        return true;
    }
    if (!findVirtualControl(controlId)) {
        error = "no such virtual control";
        return false;
    }
    activeVirtualControlId_ = controlId;
    proxyCatch_.clear();
    ++virtualControlRevision_;
    notifyPerformance();
    return true;
}

bool Engine::toggleBoundParameter(const ParameterBinding& binding, std::string& error) {
    std::lock_guard<std::recursive_mutex> stateLock(stateMutex_);
    ActiveChainReadGuard chainGuard(*this);
    Chain* chain = chainGuard.get();
    if (!chain) {
        error = "no chain is running";
        return false;
    }
    if (chainPublicationExpected_.load(std::memory_order_acquire)
        || chain->presetId != activePresetId_) {
        error = "preset is still preparing";
        return false;
    }
    for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
        if (slot->id != binding.slotId || !slot->plugin) continue;
        for (const PortInfo& port : slot->plugin->info().ports) {
            if (!port.control || !port.input || port.symbol != binding.portSymbol) continue;
            const float current = slot->plugin->control(port.index);
            const float low = binding.minimum;
            const float high = binding.maximum;
            const float next = current > low + (high - low) * 0.5f ? low : high;
            return setControlValue(binding.slotId, binding.portSymbol, next, error, false);
        }
        error = "no such control on this effect";
        return false;
    }
    error = "no such effect";
    return false;
}

bool Engine::pressVirtualSurfaceControl(const std::string& controlId, bool pressed, std::string& error) {
    const std::optional<VirtualControl> control = findVirtualControl(controlId);
    if (!control) {
        error = "no such virtual control";
        return false;
    }
    selectVirtualSurfaceControl(controlId, error);
    const Preset* preset = effectiveActivePreset();
    const ParameterBinding* binding = preset ? preset->findParameterBinding(controlId) : nullptr;
    if (!binding) return true;
    if (control->kind == ControlKind::Latching && pressed && binding->action == "setParameter") {
        const bool ok = toggleBoundParameter(*binding, error);
        if (ok) { ++virtualControlRevision_; notifyPerformance(); }
        return ok;
    }
    ActionRequest request;
    request.controlId = controlId;
    request.action = "none";
    request.kind = control->kind == ControlKind::Latching ? ControlKind::Momentary : control->kind;
    request.pressed = pressed;
    request.value = pressed ? 1.0f : 0.0f;
    request.fromScreen = true;
    request.persist = false;
    runAction(request);
    ++virtualControlRevision_;
    return true;
}

bool Engine::setVirtualSurfaceControlValue(const std::string& controlId, float value, std::string& error) {
    const std::optional<VirtualControl> control = findVirtualControl(controlId);
    if (!control || !isContinuousKind(control->kind)) {
        error = control ? "virtual control is not continuous" : "no such virtual control";
        return false;
    }
    selectVirtualSurfaceControl(controlId, error);
    ActionRequest request;
    request.controlId = controlId;
    request.action = "none";
    request.kind = control->kind;
    request.pressed = true;
    request.value = std::max(0.0f, std::min(1.0f, value));
    request.fromScreen = true;
    request.persist = false;
    runAction(request);
    ++virtualControlRevision_;
    return true;
}

bool Engine::turnVirtualSurfaceEncoder(const std::string& controlId, int delta, std::string& error) {
    const std::optional<VirtualControl> control = findVirtualControl(controlId);
    if (!control || control->kind != ControlKind::Encoder) {
        error = control ? "virtual control is not an encoder" : "no such virtual control";
        return false;
    }
    selectVirtualSurfaceControl(controlId, error);
    ActionRequest request;
    request.controlId = controlId;
    request.action = "none";
    request.kind = ControlKind::Encoder;
    request.pressed = true;
    request.delta = delta < 0 ? -1 : 1;
    request.value = static_cast<float>(request.delta);
    request.fromScreen = true;
    request.persist = false;
    runAction(request);
    ++virtualControlRevision_;
    return true;
}

bool Engine::turnSelectedVirtualControl(int delta, std::string& error) {
    ActionRequest request;
    request.controlId = "contextualVirtualControlEncoder";
    request.action = "virtualControlProxy";
    request.kind = ControlKind::Encoder;
    request.pressed = true;
    request.delta = delta < 0 ? -1 : 1;
    request.value = static_cast<float>(request.delta);
    request.persist = false;
    runAction(request);
    error.clear();
    return true;
}

bool Engine::toggleVirtualControlFine(std::string& error) {
    ActionRequest request;
    request.controlId = "contextualVirtualControlEncoderPush";
    request.action = "virtualControlProxyFine";
    request.kind = ControlKind::EncoderPush;
    request.pressed = true;
    runAction(request);
    error.clear();
    return true;
}

bool Engine::validatePresetEvent(const std::string& expectedPresetId, std::string& error) const {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    if (!expectedPresetId.empty() && expectedPresetId != activePresetId_) {
        error = "that control event belongs to a preset that is no longer active";
        return false;
    }
    return true;
}

bool Engine::pressVirtualControl(const std::string& controlId, bool pressed, std::string& error) {
    const ControllerConfig config = controller_.config();
    for (const ControllerControl& control : config.controls) {
        if (control.id != controlId) {
            continue;
        }
        const bool continuous = control.kind == ControlKind::Pot
                             || control.kind == ControlKind::Slider
                             || control.kind == ControlKind::Expression;
        if (continuous) {
            return true;
        }
        for (const ActionRequest& request : controller_.virtualPress(controlId, pressed)) {
            runAction(request);
        }
        return true;
    }
    error = "no such control";
    return false;
}

bool Engine::fireVirtualAction(const std::string& controlId, const std::string& fire, std::string& error) {
    const ControllerConfig config = controller_.config();
    for (const ControllerControl& control : config.controls) {
        if (control.id != controlId) {
            continue;
        }
        ActionRequest request;
        request.controlId = control.id;
        request.binding = control.binding;
        request.pressed = true;
        request.value = 1.0f;
        request.kind = control.kind;
        if (fire == "hold") {
            if (control.binding.holdAction.empty() || control.binding.holdAction == "none") {
                error = "no hold action";
                return false;
            }
            request.action = control.binding.holdAction;
            request.fromHold = true;
        } else if (fire == "double") {
            if (control.binding.doubleAction.empty() || control.binding.doubleAction == "none") {
                error = "no double-tap action";
                return false;
            }
            request.action = control.binding.doubleAction;
            request.fromDouble = true;
        } else {
            request.action = control.binding.action;
        }
        runAction(request);
        return true;
    }
    error = "no such control";
    return false;
}

void Engine::cancelVirtualHold(const std::string& controlId) {
    controller_.cancelHold(controlId);
}

bool Engine::setVirtualControlValue(const std::string& controlId, float value, std::string& error) {
    const ControllerConfig config = controller_.config();
    for (const ControllerControl& control : config.controls) {
        if (control.id != controlId) {
            continue;
        }
        const float visual = std::max(0.0f, std::min(1.0f, value));
        controller_.setPosition(control.id, visual);
        ActionRequest request;
        request.controlId = control.id;
        request.binding = control.binding;
        request.action = control.binding.action;
        request.pressed = true;
        request.value = visual;
        request.kind = control.kind;
        request.fromScreen = true;
        request.persist = false;
        runAction(request);
        return true;
    }
    error = "no such control";
    return false;
}

bool Engine::turnVirtualEncoder(const std::string& controlId, int delta, std::string& error) {
    const ControllerConfig config = controller_.config();
    for (const ControllerControl& control : config.controls) {
        if (control.id != controlId) continue;
        if (control.kind != ControlKind::Encoder) {
            error = "control is not an encoder";
            return false;
        }
        ActionRequest request;
        request.controlId = control.id;
        request.binding = control.binding;
        request.action = control.binding.action;
        request.pressed = true;
        request.kind = control.kind;
        request.delta = delta < 0 ? -1 : 1;
        request.fromScreen = true;
        request.persist = false;
        runAction(request);
        return true;
    }
    error = "no such control";
    return false;
}

void Engine::handleMidiMessage(const MidiMessage& message) {
    bool encoderUi = false;
    for (const ActionRequest& request : controller_.handleMessage(message)) {
        if (request.kind == ControlKind::Encoder || request.kind == ControlKind::EncoderPush) {
            encoderUi = true;
        }
        if (request.action == "learned") {
            // Learning changed the runtime copy of the config; persist it so a
            // reboot does not lose the assignment.
            settings_.controller = controller_.config();
            persistSettings();
            notify();
            continue;
        }
        runAction(request);
    }
    if (encoderUi) {
        notifyPerformance();
    }
}

void Engine::handleSysEx(const std::vector<uint8_t>& sysex) {
    ControllerRuntime::Identity identity;
    if (!ControllerRuntime::parseIdentity(sysex, identity)) {
        return;
    }
    logInfo("controller: firmware " + identity.firmwareVersion + ", "
            + std::to_string(identity.controlCount) + " controls, "
            + std::to_string(identity.ledCount) + (identity.rgbLeds ? " RGB LEDs" : " LEDs"));
    {
        std::lock_guard<std::recursive_mutex> lock(stateMutex_);
        controllerFirmwareVersion_ = identity.firmwareVersion;
        controllerFirmwareUpdateRequired_ = identity.firmwareMajor < kRequiredControllerFirmwareMajor
            || (identity.firmwareMajor == kRequiredControllerFirmwareMajor
                && identity.firmwareMinor < kRequiredControllerFirmwareMinor);
    }
    refreshLeds();
    notify();
}

bool Engine::bindingTargetPosition(const ParameterBinding& binding, float& position) const {
    std::lock_guard<std::recursive_mutex> stateLock(stateMutex_);
    ActiveChainReadGuard chainGuard(*this);
    Chain* chain = chainGuard.get();
    if (!chain || binding.action != "setParameter"
        || chainPublicationExpected_.load(std::memory_order_acquire)
        || chain->presetId != activePresetId_) return false;
    for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
        if (slot->id != binding.slotId || !slot->plugin) continue;
        for (const PortInfo& port : slot->plugin->info().ports) {
            if (!port.control || !port.input || port.symbol != binding.portSymbol) continue;
            const float value = slot->plugin->control(port.index);
            const float minimum = binding.minimum;
            const float maximum = binding.maximum;
            if (maximum == minimum) return false;
            double normal = 0.0;
            if (port.logarithmic && minimum != 0.0f && maximum != 0.0f
                && ((minimum > 0.0f) == (maximum > 0.0f)) && value != 0.0f) {
                normal = std::log(static_cast<double>(value) / minimum)
                       / std::log(static_cast<double>(maximum) / minimum);
            } else {
                normal = (static_cast<double>(value) - minimum) / (maximum - minimum);
            }
            position = static_cast<float>(std::max(0.0, std::min(1.0, normal)));
            if (binding.inverted) position = 1.0f - position;
            return true;
        }
    }
    return false;
}

bool Engine::proxyCatchAllows(const ActionRequest& request, const ParameterBinding& binding) {
    float target = 0.0f;
    if (!bindingTargetPosition(binding, target)) return false;
    ProxyCatch& state = proxyCatch_[request.controlId];
    if (state.virtualControlId != activeVirtualControlId_ || state.presetId != activePresetId_) {
        state = ProxyCatch{};
        state.virtualControlId = activeVirtualControlId_;
        state.presetId = activePresetId_;
    }
    if (state.acquired) return true;
    const float incoming = std::max(0.0f, std::min(1.0f, request.value));
    constexpr float kTolerance = 4.0f / 127.0f;
    const bool close = std::fabs(incoming - target) <= kTolerance;
    const bool crossed = state.lastVisual >= 0.0f
        && ((state.lastVisual <= target && incoming >= target)
            || (state.lastVisual >= target && incoming <= target));
    state.lastVisual = incoming;
    if (!close && !crossed) return false;
    state.acquired = true;
    return true;
}

void Engine::runVirtualControlProxy(const ActionRequest& request) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    const std::optional<VirtualControl> target = findVirtualControl(activeVirtualControlId_);
    const Preset* preset = effectiveActivePreset();
    const ParameterBinding* binding = preset && target
        ? preset->findParameterBinding(activeVirtualControlId_) : nullptr;
    if (!target || !binding) return;

    const bool encoder = request.kind == ControlKind::Encoder;
    const bool absolute = request.kind == ControlKind::Pot
        || request.kind == ControlKind::Slider || request.kind == ControlKind::Expression;
    const bool targetContinuous = target->kind == ControlKind::Pot
        || target->kind == ControlKind::Slider || target->kind == ControlKind::Expression
        || target->kind == ControlKind::Encoder;
    if ((!encoder && !absolute) || !targetContinuous) return;
    if (absolute && (target->kind == ControlKind::Encoder || target->kind == ControlKind::Latching)) return;
    if (absolute && !proxyCatchAllows(request, *binding)) return;

    ActionRequest forwarded = request;
    forwarded.controlId = activeVirtualControlId_;
    forwarded.action = "none";
    forwarded.binding = ControlBinding{};
    forwarded.fromScreen = absolute;
    forwarded.persist = false;
    forwarded.fine = proxyFineMode_;
    if (encoder && binding->action == "setParameter" && !proxyFineMode_) {
        const auto now = std::chrono::steady_clock::now();
        const auto found = proxyEncoderAt_.find(request.controlId);
        const auto elapsed = found == proxyEncoderAt_.end()
            ? std::chrono::milliseconds(1000)
            : std::chrono::duration_cast<std::chrono::milliseconds>(now - found->second);
        proxyEncoderAt_[request.controlId] = now;
        int& burst = proxyEncoderBurst_[request.controlId];
        burst = elapsed.count() < 90 ? std::min(4, burst + 1) : elapsed.count() < 180 ? 2 : 1;
        forwarded.delta = (request.delta < 0 ? -1 : 1) * burst;
    }
    runAction(forwarded);
    ++virtualControlRevision_;
    notifyPerformance();
}

void Engine::runAction(const ActionRequest& incoming) {
    if (incoming.action == "navigateOrVirtualControlProxy") {
        const int delta = incoming.delta != 0 ? incoming.delta : (incoming.value >= 0.0f ? 1 : -1);
        notifyUiNav(delta < 0 ? -1 : 1, false, "turn");
        return;
    }
    if (incoming.action == "selectOrVirtualControlFine") {
        if (incoming.pressed) notifyUiNav(0, true, "fine");
        return;
    }
    if (incoming.action == "virtualControlProxy") {
        runVirtualControlProxy(incoming);
        return;
    }
    if (incoming.action == "virtualControlProxyFine") {
        if (incoming.pressed) {
            proxyFineMode_ = !proxyFineMode_;
            ++virtualControlRevision_;
            notifyPerformance();
        }
        return;
    }
    ActionRequest request = incoming;
    overlayPresetBind(request);

    const bool catchKind = request.kind == ControlKind::Pot || request.kind == ControlKind::Slider;
    if (catchKind && request.action == "setParameter" && !request.fromScreen) {
        std::lock_guard<std::recursive_mutex> lock(stateMutex_);
        if (!analogCatchAllows(request)) {
            return;
        }
    }

    if (!request.pressed && request.kind != ControlKind::Latching) {
        return;
    }
    if (!request.pressed && request.kind == ControlKind::Latching
        && !followLatchPosition(request.action)) {
        return;
    }
    if (isContinuousKind(request.kind) && !request.fromPresetBind
        && request.action != "setParameter") {
        return;
    }

    std::string error;
    const ControlBinding& binding = request.binding;
    const bool latching = request.kind == ControlKind::Latching;
    const bool snapshotView = snapshotMode_.load(std::memory_order_relaxed);
    const int encoderDelta = request.delta != 0
        ? request.delta
        : (request.kind == ControlKind::Encoder
            ? (request.value >= 0.0f ? 1 : -1)
            : 0);
    const bool presetNav = request.action == "selectPreset"
        || request.action == "presetUp"
        || request.action == "presetDown"
        || request.action == "bankUp"
        || request.action == "bankDown"
        || request.action == "selectSnapshot";

    if (!request.fromPresetBind && snapshotView && request.action != "setParameter"
        && request.action != "snapshotMode"
        && request.action != "bypassAll" && request.action != "tapTempo"
        && request.action != "tuner" && request.action != "toggleEffect"
        && request.action != "reloadPreset"
        && request.action != "backingPlayPause"
        && request.action != "backingStop"
        && request.action != "backingPrevious"
        && request.action != "backingNext"
        && request.action != "backingView"
        && request.action != "looperRecord"
        && request.action != "looperToggle"
        && request.action != "looperPlay"
        && request.action != "looperPlayStop"
        && request.action != "looperOverdub"
        && request.action != "looperStop"
        && request.action != "looperRestart"
        && request.action != "looperMute"
        && request.action != "looperUndo"
        && request.action != "looperRedo"
        && request.action != "looperClear"
        && request.action != "looperView"
        && request.action != "recorderToggle"
        && request.action != "recorderStop"
        && request.action != "recorderView"
        && request.action != "drumToggle"
        && request.action != "drumFill"
        && request.action != "drumVariationNext"
        && request.action != "drumVariationPrevious"
        && request.action != "drumPatternNext"
        && request.action != "drumPatternPrevious"
        && request.action != "drumView"
        && request.action != "navigate"
        && request.action != "select") {
        if (binding.snapshotSlot >= 0) {
            std::lock_guard<std::recursive_mutex> lock(stateMutex_);
            Preset* preset = activePreset();
            if (preset) {
                pressSnapshotSlotUnlocked(*preset, binding.snapshotSlot, error);
                persistActiveBankUnlocked();
                refreshLeds();
                notify();
            }
            if (!error.empty()) {
                logDebug("controller snapshot slot: " + error);
            }
            return;
        }
        if (presetNav || request.action == "none") {
            return;
        }
    }

    if (request.action == "navigate") {
        notifyUiNav(encoderDelta != 0 ? encoderDelta : 1, false);
        return;
    } else if (request.action == "select") {
        notifyUiNav(0, true);
        return;
    } else if (request.action == "presetUp") {
        stepPreset(encoderDelta != 0 ? encoderDelta : 1, error);
    } else if (request.action == "presetDown") {
        stepPreset(encoderDelta != 0 ? -encoderDelta : -1, error);
    } else if (request.action == "bankUp") {
        stepBank(encoderDelta != 0 ? encoderDelta : 1, error);
    } else if (request.action == "bankDown") {
        stepBank(encoderDelta != 0 ? -encoderDelta : -1, error);
    } else if (request.action == "selectPreset") {
        const ControllerConfig config = controller_.config();
        std::string bankId = binding.bankId.empty() ? activeBankId_ : binding.bankId;
        std::string presetId = binding.presetId;
        sessionPresetForControl(request.controlId, bankId, presetId);
        if (presetId.empty()) {
            presetId = assignedPresetForControl(config, bankId, request.controlId);
        }
        if (!presetId.empty() && presetId == activePresetId_
            && (bankId.empty() || bankId == activeBankId_)) {
            std::lock_guard<std::recursive_mutex> lock(stateMutex_);
            Preset* preset = activePreset();
            if (preset) {
                toggleRememberedSnapshotUnlocked(*preset, error);
                persistActiveBankUnlocked();
                refreshLeds();
                notify();
            }
        } else {
            selectPreset(bankId, presetId, error);
        }
    } else if (request.action == "selectSnapshot") {
        if (request.kind == ControlKind::Encoder) {
            stepSnapshot(encoderDelta != 0 ? encoderDelta : 1, error);
        } else if (binding.snapshotSlot >= 0) {
            std::lock_guard<std::recursive_mutex> lock(stateMutex_);
            Preset* preset = activePreset();
            if (preset) {
                pressSnapshotSlotUnlocked(*preset, binding.snapshotSlot, error);
                persistActiveBankUnlocked();
                refreshLeds();
                notify();
            }
        } else {
            selectSnapshot(binding.snapshotId, error);
        }
    } else if (request.action == "reloadPreset") {
        const ControllerConfig config = controller_.config();
        std::string bankId = binding.bankId.empty() ? activeBankId_ : binding.bankId;
        std::string presetId = binding.presetId;
        if (presetId.empty()) {
            presetId = assignedPresetForControl(config, bankId, request.controlId);
        }
        if (!presetId.empty()
            && (presetId != activePresetId_ || (!bankId.empty() && bankId != activeBankId_))) {
            if (!selectPreset(bankId, presetId, error)) {
                return;
            }
        }
        reloadStoredPreset(error);
    } else if (request.action == "toggleEffect") {
        if (latching) {
            setEffectEnabled(binding.slotId, latchOn(request), error, request.persist);
        } else {
            bool enabled = true;
            {
                std::lock_guard<std::recursive_mutex> stateLock(stateMutex_);
                ActiveChainReadGuard chainGuard(*this);
                if (Chain* chain = chainGuard.get()) {
                    for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
                        if (slot->id == binding.slotId) {
                            const int pending = slot->pendingEnabled.load(std::memory_order_acquire);
                            const bool current = pending >= 0
                                ? pending != 0 : slot->enabled.load(std::memory_order_relaxed);
                            enabled = !current;
                            break;
                        }
                    }
                }
            }
            setEffectEnabled(binding.slotId, enabled, error, request.persist);
        }
    } else if (request.action == "setParameter") {
        if (request.kind == ControlKind::Encoder) {
            nudgeEncoderParameter(request, error);
        } else {
            const bool persist = request.persist && !isContinuousKind(request.kind);
            std::optional<PortInfo> boundPort;
            {
                std::lock_guard<std::recursive_mutex> stateLock(stateMutex_);
                ActiveChainReadGuard chainGuard(*this);
                if (Chain* chain = chainGuard.get()) {
                    for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
                        if (slot->id != binding.slotId || !slot->plugin) continue;
                        for (const PortInfo& port : slot->plugin->info().ports) {
                            if (port.control && port.input && port.symbol == binding.portSymbol) {
                                boundPort = port;
                                break;
                            }
                        }
                        break;
                    }
                }
            }
            setControlValue(binding.slotId, binding.portSymbol,
                            mappedBindingValue(request, boundPort ? &*boundPort : nullptr),
                            error, persist);
            notifyPerformance();
        }
    } else if (request.action == "bypassAll") {
        if (latching) {
            setBypassAll(latchOn(request));
        } else {
            setBypassAll(!bypassAll_.load(std::memory_order_relaxed));
        }
    } else if (request.action == "snapshotMode") {
        if (latching) {
            setSnapshotMode(latchOn(request));
        } else {
            setSnapshotMode(!snapshotMode_.load(std::memory_order_relaxed));
        }
    } else if (request.action == "tapTempo") {
        tapTempo();
    } else if (request.action == "tuner") {
        notifyUiView("tunerToggle");
    } else if (request.action == "backingPlayPause") {
        if (backingEnabled_.load(std::memory_order_acquire)) {
            if (backing_->state()["playing"].asBool()) backing_->pause(); else backing_->play();
            refreshLeds();
        }
    } else if (request.action == "backingStop") {
        if (backingEnabled_.load(std::memory_order_acquire)) { backing_->stopPlayback(); refreshLeds(); }
    } else if (request.action == "backingNext") {
        if (backingEnabled_.load(std::memory_order_acquire)) {
            if (request.kind == ControlKind::Encoder && encoderDelta < 0) backing_->previous(); else backing_->next();
        }
    } else if (request.action == "backingPrevious") {
        if (backingEnabled_.load(std::memory_order_acquire)) {
            if (request.kind == ControlKind::Encoder && encoderDelta < 0) backing_->next(); else backing_->previous();
        }
    } else if (request.action == "backingView") {
        if (backingEnabled_.load(std::memory_order_acquire)) notifyUiView("backingTracks");
    } else if (request.action.rfind("looper", 0) == 0) {
        if (request.action == "looperView") {
            notifyUiView("looper");
        } else {
            std::string command;
            if (request.action == "looperRecord") command = "record";
            else if (request.action == "looperToggle") command = "toggle";
            else if (request.action == "looperPlay") command = "play";
            else if (request.action == "looperPlayStop") command = "playStop";
            else if (request.action == "looperOverdub") command = "overdub";
            else if (request.action == "looperStop") command = "stop";
            else if (request.action == "looperRestart") command = "restart";
            else if (request.action == "looperMute") command = "mute";
            else if (request.action == "looperUndo") command = "undo";
            else if (request.action == "looperRedo") command = "redo";
            else if (request.action == "looperClear" && request.fromHold) command = "clear";
            if (!command.empty()) {
                Json payload = Json::object();
                if (command == "clear") payload.set("confirmed", true);
                looperCommand(command, payload, error);
                refreshLeds();
            } else if (request.action == "looperClear") {
                error = "looper clear must be assigned as a hold action";
            }
        }
    } else if (request.action.rfind("recorder", 0) == 0 && recorder_) {
        if (request.action == "recorderView") {
            notifyUiView("recorder");
        } else {
            const bool active = recorder_->recording();
            const std::string command = request.action == "recorderStop"
                ? "record/stop" : active ? "record/stop" : "record/start";
            recorderCommand(command, Json::object(), error);
            refreshLeds();
        }
    } else if (request.action.rfind("drum", 0) == 0 && drums_) {
        if (request.action == "drumView") {
            notifyUiView("drums");
        } else if (request.action == "drumToggle") {
            drumCommand("toggle", Json::object(), error);
        } else if (request.action == "drumFill") {
            drumCommand("fill", Json::object(), error);
        } else {
            const int current = drumState()["activeVariation"].asInt(0);
            const bool previous = request.action == "drumVariationPrevious"
                               || request.action == "drumPatternPrevious"
                               || (request.kind == ControlKind::Encoder && encoderDelta < 0);
            Json payload = Json::object();
            payload.set("variation", (current + (previous ? 3 : 1)) % 4);
            drumCommand("variation", payload, error);
        }
        refreshLeds();
    } else if (request.action == "none") {
        return;
    }

    if (!error.empty()) {
        logDebug("controller action '" + request.action + "': " + error);
    }
}

void Engine::refreshLeds() {
    std::lock_guard<std::recursive_mutex> stateLock(stateMutex_);
    const ControllerConfig config = controller_.config();
    if (!config.enabled || !config.syncLedColours || config.leds.empty()) {
        return;
    }

    // LED colours come from the same theme roles the on-screen indicators use,
    // so the board and the screen always agree. The UI pushes the resolved RGB
    // for each role; until it does, these defaults match the stock theme.
    struct RoleColour { const char* role; uint8_t r, g, b; };
    static const RoleColour kRoles[] = {
        {"preset", 0x22, 0xD3, 0xEE},
        {"navigation", 0xA7, 0x70, 0xE4},
        {"utility", 0xF5, 0xF3, 0xF7},
        {"snapshot", 0xFB, 0xBF, 0x24},
        {"bypass", 0x64, 0x74, 0x8B},
        {"danger", 0xF8, 0x71, 0x71},
    };

    ActiveChainReadGuard chainGuard(*this);
    Chain* chain = chainGuard.get();
    std::vector<LedState> states;
    states.reserve(config.leds.size());

    for (const ControllerLed& led : config.leds) {
        LedState state;
        state.ledId = led.id;
        state.pixelIndex = led.pixelIndex;
        state.on = true;

        std::string colourRole = led.role;

        // An LED tied to a control follows what that control currently does,
        // so a switch bound to an effect lights only while that effect is on.
        const Preset* preset = effectiveActivePreset();
        for (const ControllerControl& control : config.controls) {
            if (control.ledId != led.id) {
                continue;
            }
            const ParameterBinding* presetBind = preset
                ? preset->findParameterBinding(control.id) : nullptr;
            const std::string effectSlot = (presetBind && presetBind->action == "toggleEffect")
                ? presetBind->slotId
                : (control.binding.action == "toggleEffect" ? control.binding.slotId : std::string());
            if (!effectSlot.empty() && chain) {
                state.on = false;
                for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
                    if (slot->id == effectSlot) {
                        state.on = slot->enabled.load(std::memory_order_relaxed);
                        break;
                    }
                }
            } else if (snapshotMode_.load(std::memory_order_relaxed) && control.binding.snapshotSlot >= 0) {
                state.on = preset
                    && preset->rememberedSnapshotEnabled
                    && preset->activeSnapshot == control.binding.snapshotSlot;
                colourRole = "snapshot";
            } else if (control.binding.action == "selectPreset") {
                std::string bankId = activeBankId_;
                std::string presetId = control.binding.presetId;
                sessionPresetForControl(control.id, bankId, presetId);
                if (presetId.empty()) {
                    presetId = assignedPresetForControl(config, activeBankId_, control.id);
                    bankId = activeBankId_;
                }
                state.on = !presetId.empty() && presetId == activePresetId_
                    && (bankId.empty() || bankId == activeBankId_);
                if (state.on && bypassAll_.load(std::memory_order_relaxed)) {
                    colourRole = "bypass";
                } else if (state.on && preset && preset->rememberedSnapshotEnabled
                           && preset->activeSnapshot >= 0) {
                    colourRole = "snapshot";
                }
            } else if (control.binding.action == "selectSnapshot") {
                state.on = preset
                    && preset->rememberedSnapshotEnabled
                    && control.binding.snapshotSlot >= 0
                    && preset->activeSnapshot == control.binding.snapshotSlot;
                colourRole = "snapshot";
            } else if (control.binding.action == "bypassAll") {
                state.on = bypassAll_.load(std::memory_order_relaxed);
                colourRole = "bypass";
            } else if (control.binding.action == "tapTempo"
                       && transportEnabled_.load(std::memory_order_acquire)) {
                state.on = transport_.beatPulse();
                colourRole = "utility";
            } else if (control.binding.action == "backingPlayPause"
                       && backingEnabled_.load(std::memory_order_acquire)) {
                state.on = backing_->state()["playing"].asBool(false);
                colourRole = "utility";
            } else if (control.binding.action.rfind("looper", 0) == 0) {
                const Json looperState = looper_->state();
                const std::string looperStatus = looperState["status"].asString("empty");
                if (control.binding.action == "looperRecord" || control.binding.action == "looperToggle") {
                    state.on = looperStatus == "armed" || looperStatus == "recording";
                    colourRole = looperStatus == "armed" || looperStatus == "recording" ? "danger"
                        : looperStatus == "overdubbing" ? "snapshot" : "utility";
                } else if (control.binding.action == "looperOverdub") {
                    state.on = looperStatus == "overdubbing";
                    colourRole = "snapshot";
                } else if (control.binding.action == "looperPlay" || control.binding.action == "looperPlayStop") {
                    state.on = looperStatus == "playing" || looperStatus == "overdubbing";
                    colourRole = "utility";
                } else if (control.binding.action == "looperStop") {
                    state.on = looperStatus == "stopped";
                    colourRole = "bypass";
                } else if (control.binding.action == "looperMute") {
                    state.on = looperState["muted"].asBool(false);
                    colourRole = "bypass";
                } else if (control.binding.action == "looperRestart") {
                    state.on = looperState["hasLoop"].asBool(false);
                    colourRole = "navigation";
                } else if (control.binding.action == "looperUndo") {
                    state.on = looperState["canUndo"].asBool(false);
                    colourRole = "utility";
                } else if (control.binding.action == "looperRedo") {
                    state.on = looperState["canRedo"].asBool(false);
                    colourRole = "utility";
                } else if (control.binding.action == "looperClear") {
                    state.on = looperState["hasLoop"].asBool(false);
                    colourRole = "danger";
                }
            } else if (control.binding.action.rfind("recorder", 0) == 0 && recorder_) {
                const bool active = recorder_->recording();
                state.on = control.binding.action == "recorderStop" ? !active : active;
                colourRole = active ? "danger" : "utility";
            } else if (control.binding.action.rfind("drum", 0) == 0 && drums_) {
                const Json drums = drumState();
                state.on = control.binding.action == "drumFill"
                    ? drums["fillActive"].asBool(false) : drums["playing"].asBool(false);
                colourRole = control.binding.action == "drumFill" ? "snapshot" : "utility";
            }
            break;
        }

        for (const RoleColour& role : kRoles) {
            if (colourRole == role.role) {
                state.red = role.r;
                state.green = role.g;
                state.blue = role.b;
                break;
            }
        }
        const Json& themeColor = settings_.ui.ledColors[colourRole];
        if (themeColor.isString()) {
            const std::string hex = themeColor.asString();
            if (hex.size() == 7 && hex[0] == '#') {
                state.red = static_cast<uint8_t>(std::strtol(hex.substr(1, 2).c_str(), nullptr, 16));
                state.green = static_cast<uint8_t>(std::strtol(hex.substr(3, 2).c_str(), nullptr, 16));
                state.blue = static_cast<uint8_t>(std::strtol(hex.substr(5, 2).c_str(), nullptr, 16));
            }
        }

        states.push_back(std::move(state));
    }

    midi_.send(controller_.encodeLedMessage(states, config.ledBrightness));
}

// ---------------------------------------------------------------------------
// Preferences, library, tempo, tuner
// ---------------------------------------------------------------------------

bool Engine::applyUiSettings(const Json& json, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Json merged = settings_.ui.toJson();
    if (json.isObject()) {
        for (const auto& member : json.members()) {
            merged.set(member.first, member.second);
        }
    }
    settings_.ui = UiSettings::fromJson(merged);
    tunerThreshold_.store(std::max(0.0005f, std::min(0.05f,
        settings_.ui.tuner["threshold"].asFloat(0.0025f))), std::memory_order_relaxed);
    tunerAutoBoost_.store(settings_.ui.tuner["detectionBoostMode"].asString("auto") != "manual", std::memory_order_relaxed);
    tunerAnalysisBoost_.store(dbToGain(std::max(0.0f, std::min(24.0f,
        settings_.ui.tuner["detectionBoostDb"].asFloat(0.0f)))), std::memory_order_relaxed);
    const std::string tunerInstrument = settings_.ui.tuner["instrument"].asString("guitar6");
    tunerExtendedRange_.store(tunerInstrument == "guitar8" || tunerInstrument == "guitar9"
        || tunerInstrument == "bass5" || tunerInstrument == "bass6" || tunerInstrument == "bass7",
        std::memory_order_relaxed);
    applyControllerFeel();
    if (settings_.ui.performanceEncoder != "session") {
        sessionPresets_.clear();
    }
    if (!persistSettings()) {
        error = "could not save settings";
        return false;
    }
    refreshLeds();
    notify();
    return true;
}

void Engine::applyControllerFeel() {
    controller_.setFeel(
        settings_.ui.encoderStepsPerDetent,
        settings_.ui.analogDeadband,
        settings_.ui.switchDebounceMs);
}

bool Engine::sessionPresetForControl(const std::string& controlId, std::string& bankId, std::string& presetId) const {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    auto found = sessionPresets_.find(controlId);
    if (found == sessionPresets_.end() || found->second.presetId.empty()) {
        return false;
    }
    if (!found->second.bankId.empty()) {
        bankId = found->second.bankId;
    }
    presetId = found->second.presetId;
    return true;
}

bool Engine::applySessionPresets(const Json& json, std::string& error) {
    {
        std::lock_guard<std::recursive_mutex> lock(stateMutex_);
        sessionPresets_.clear();
        if (json["enabled"].asBool(false)) {
            for (const Json& item : json["assignments"].items()) {
                const std::string controlId = item["controlId"].asString();
                const std::string presetId = item["presetId"].asString();
                if (controlId.empty() || presetId.empty()) {
                    continue;
                }
                sessionPresets_[controlId] = SessionPreset{
                    item["bankId"].asString(),
                    presetId
                };
            }
        }
    }
    refreshLeds();
    error.clear();
    return true;
}

bool Engine::storeLibraryFile(const std::string& kind, const std::string& name,
                              const std::string& contents, std::string& storedPath,
                              std::string& error) {
    return storeLibraryFile(kind, name, contents, std::string(), false, storedPath, error);
}

bool Engine::storeLibraryFile(const std::string& kind, const std::string& name,
                              const std::string& contents, const std::string& directory,
                              bool overwrite, std::string& storedPath, std::string& error) {
    if (kind == "backing") {
        error = "backing tracks must use the binary import endpoint";
        return false;
    }
    if (kind == "drumsample") {
        error = "use the drum sample importer"; return false;
    }
    const std::string root = libraryRootForKind(storage_.paths(), kind);

    const std::string safeName = sanitizeFileName(name);
    if (safeName.empty()) {
        error = "that file name cannot be used";
        return false;
    }
    if (contents.size() > 64u * 1024u * 1024u) {
        error = "that file is too large";
        return false;
    }
    if (!libraryExtensionAllowed(kind, std::filesystem::path(safeName))) {
        error = "that file type is not allowed in this file-manager location";
        return false;
    }

    const std::string rel = sanitizeRelDir(directory);
    const std::string destDir = rel.empty() ? root : joinPath(root, rel);
    if (!makeDirectories(destDir)) {
        error = "could not create that folder";
        return false;
    }
    storedPath = joinPath(destDir, safeName);
    if (!storage_.isPathInLibrary(storedPath)) {
        error = "that folder is not in the library";
        return false;
    }
    std::error_code existingEc;
    if (std::filesystem::exists(storedPath, existingEc)) {
        if (existingEc || std::filesystem::is_directory(storedPath, existingEc)) {
            error = "that destination cannot be replaced";
            return false;
        }
        if (!overwrite) {
            error = "a file with that name already exists; confirm overwrite to replace it";
            return false;
        }
    }
    if (!writeFileAtomic(storedPath, contents)) {
        error = "could not write the file";
        return false;
    }
    notify();
    return true;
}

Json Engine::readLibraryFile(const std::string& kind, const std::string& path, std::string& error) {
    const std::string root = libraryRootForKind(storage_.paths(), kind);
    if (!storage_.isPathInLibrary(path) || !pathInsideRoot(path, root)) {
        error = "that path is outside this file-manager location";
        return Json();
    }
    std::string contents;
    if (!readFile(path, contents)) {
        error = "could not read that file";
        return Json();
    }
    Json json = Json::object();
    json.set("path", path);
    json.set("name", fileName(path));
    json.set("contents", contents);
    error.clear();
    return json;
}

bool Engine::deleteLibraryFile(const std::string& kind, const std::string& path, std::string& error) {
    const std::string root = libraryRootForKind(storage_.paths(), kind);
    if (!pathInsideRoot(path, root)) {
        error = "that path is outside this file-manager location";
        return false;
    }
    if (drums_ && !drums_->canEditLibraryPath(path, error)) return false;
    if (!storage_.isPathInLibrary(path)) {
        error = "that file is not in the Pi-MFX library";
        return false;
    }
    if (isLibraryRootPath(storage_.paths(), path)) {
        error = "cannot delete the library root";
        return false;
    }
    std::error_code ec;
    if (std::filesystem::is_directory(path, ec)) {
        std::filesystem::remove_all(path, ec);
        if (ec) {
            error = "could not delete that folder";
            return false;
        }
        notify();
        return true;
    }
    if (!removeFile(path)) {
        error = "could not delete the file";
        return false;
    }
    if (backing_) {
        backing_->fileDeleted(path);
        backing_->refreshPlaylist();
    }
    notify();
    return true;
}

Json Engine::libraryList(const std::string& kind, const std::string& directory, std::string& error) {
    const std::string root = libraryRootForKind(storage_.paths(), kind);
    const std::string rel = sanitizeRelDir(directory);
    const std::string dir = rel.empty() ? root : joinPath(root, rel);
    if (!pathInsideRoot(dir, root)) {
        error = "folder is outside this file-manager location"; return Json();
    }
    if (!storage_.isPathInLibrary(dir) && dir != root) {
        error = "that folder is not in the library";
        return Json();
    }
    std::error_code ec;
    if (!std::filesystem::is_directory(dir, ec)) {
        error = "that folder does not exist";
        return Json();
    }

    Json folders = Json::array();
    Json files = Json::array();
    for (const auto& entry : std::filesystem::directory_iterator(dir, ec)) {
        if (ec) {
            break;
        }
        const std::string name = entry.path().filename().string();
        if ((kind == "drumsample" || kind == "drumkit") && entry.is_symlink(ec)) continue;
        if (hiddenLibraryName(name)) {
            continue;
        }
        Json item = Json::object();
        const std::string childRel = rel.empty() ? name : rel + "/" + name;
        item.set("name", name);
        item.set("path", entry.path().string());
        item.set("relative", childRel);
        if (entry.is_directory(ec)) {
            item.set("type", "dir");
            folders.push(item);
        } else if (entry.is_regular_file(ec)) {
            if (!libraryExtensionAllowed(kind, entry.path())) continue;
            item.set("type", "file");
            item.set("bytes", static_cast<int64_t>(std::filesystem::file_size(entry.path(), ec)));
            files.push(item);
        }
    }

    Json json = Json::object();
    json.set("kind", libraryKindName(kind));
    json.set("directory", rel);
    json.set("root", root);
    json.set("folders", folders);
    json.set("files", files);
    error.clear();
    return json;
}

Json Engine::libraryTree(const std::string& kind, std::string& error) {
    const std::string root = libraryRootForKind(storage_.paths(), kind);
    std::error_code ec;
    if (!std::filesystem::is_directory(root, ec)) {
        if (!makeDirectories(root)) {
            error = "that library folder does not exist";
            return Json();
        }
    }
    Json json = Json::object();
    json.set("kind", libraryKindName(kind));
    json.set("root", libraryDirNode(root, std::string(), kind == "drumsample" || kind == "drumkit"));
    error.clear();
    return json;
}

bool Engine::libraryMkdir(const std::string& kind, const std::string& directory, std::string& error) {
    const std::string root = libraryRootForKind(storage_.paths(), kind);
    const std::string rel = sanitizeRelDir(directory);
    if (rel.empty()) {
        error = "give the folder a name";
        return false;
    }
    const std::string dir = joinPath(root, rel);
    if (!pathInsideRoot(dir, root)) {
        error = "folder is outside this file-manager location"; return false;
    }
    if (!makeDirectories(dir) || !storage_.isPathInLibrary(dir)) {
        error = "could not create that folder";
        return false;
    }
    notify();
    return true;
}

bool Engine::libraryRename(const std::string& kind, const std::string& path,
                           const std::string& newName, std::string& error) {
    const std::string root = libraryRootForKind(storage_.paths(), kind);
    if (!pathInsideRoot(path, root)) {
        error = "that path is outside this file-manager location"; return false;
    }
    if (isLibraryRootPath(storage_.paths(), path)) { error = "cannot rename a library root"; return false; }
    if (drums_ && !drums_->canEditLibraryPath(path, error)) return false;
    if (!storage_.isPathInLibrary(path)) {
        error = "that path is not in the library";
        return false;
    }
    const std::string safe = sanitizeFileName(newName);
    if (safe.empty()) {
        error = "that name cannot be used";
        return false;
    }
    const std::string dest = joinPath(parentPath(path), safe);
    std::error_code typeEc;
    if (std::filesystem::is_regular_file(path, typeEc)
        && !libraryExtensionAllowed(kind, std::filesystem::path(dest))) {
        error = "that file type is not allowed in this file-manager location"; return false;
    }
    if (pathInsideRoot(path, joinPath(storage_.paths().drumsDir, "samples"))) {
        std::error_code sampleEc;
        if (std::filesystem::is_regular_file(path, sampleEc) && lowerCopy(std::filesystem::path(dest).extension().string()) != ".wav") {
            error = "drum samples must keep the WAV extension"; return false;
        }
        if (std::filesystem::exists(dest, sampleEc) || sampleEc) {
            error = "that name already exists in the sample library"; return false;
        }
    }
    if (!storage_.isPathInLibrary(dest)) {
        error = "that name cannot be used";
        return false;
    }
    std::error_code ec;
    std::filesystem::rename(path, dest, ec);
    if (ec) {
        error = "could not rename that";
        return false;
    }
    if (backing_) backing_->fileMoved(path, dest);
    notify();
    return true;
}

bool Engine::libraryMove(const std::string& path, const std::string& kind, const std::string& directory,
                         std::string& error) {
    if (drums_ && !drums_->canEditLibraryPath(path, error)) return false;
    if (!storage_.isPathInLibrary(path)) {
        error = "that path is not in the library";
        return false;
    }
    const std::string root = libraryRootForKind(storage_.paths(), kind);
    const std::string rel = sanitizeRelDir(directory);
    const std::string destDir = rel.empty() ? root : joinPath(root, rel);
    if (!pathInsideRoot(path, root) || !pathInsideRoot(destDir, root)) {
        error = "moves must stay inside this file-manager location"; return false;
    }
    if (!makeDirectories(destDir) || !storage_.isPathInLibrary(destDir)) {
        error = "that folder is not in the library";
        return false;
    }
    const std::string dest = joinPath(destDir, fileName(path));
    std::error_code destinationEc;
    if (std::filesystem::exists(dest, destinationEc) || destinationEc) {
        error = "destination already exists; library moves never overwrite files"; return false;
    }
    if (!storage_.isPathInLibrary(dest)) {
        error = "could not move that there";
        return false;
    }
    std::error_code ec;
    std::filesystem::rename(path, dest, ec);
    if (ec) {
        error = "could not move that";
        return false;
    }
    if (backing_) backing_->fileMoved(path, dest);
    notify();
    return true;
}

void Engine::tapTempo() {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    if (!transportEnabled_.load(std::memory_order_acquire)) {
        if (const Preset* preset = effectiveActivePreset()) transport_.setBpm(preset->tempo);
    }
    const double bpm = transport_.tap();
    if (Preset* stored = activePreset(); stored && stored->activeSnapshot < 0) {
        if (Preset* draft = activeSessionDraft(true)) {
            draft->tempo = bpm;
            applyTempoLinksUnlocked(*draft);
        }
    }
    notifyPerformance();
}

TunerReading Engine::tuner() const {
    std::lock_guard<std::mutex> lock(tunerMutex_);
    return tunerReading_;
}

void Engine::setTunerEnabled(bool enabled) {
    tunerEnabled_.store(enabled, std::memory_order_relaxed);
}

void Engine::setTunerViewState(bool open, bool muted) {
    tunerViewOpen_.store(open, std::memory_order_relaxed);
    tunerOutputMuted_.store(muted, std::memory_order_relaxed);
}

void Engine::tunerThread() {
    std::vector<float> captured(8192, 0.0f);
    std::vector<float> window(4096, 0.0f);
    TunerReading stable;
    int pendingMidi = -1;
    int pendingCount = 0;
    int invalidCount = 0;

    while (!shuttingDown_.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(60));
        if (!tunerEnabled_.load(std::memory_order_relaxed)) {
            continue;
        }

        const size_t write = tunerWrite_.load(std::memory_order_acquire);
        const bool extendedRange = tunerExtendedRange_.load(std::memory_order_relaxed);
        const size_t captureCount = extendedRange ? captured.size() : window.size();
        for (size_t i = 0; i < captureCount; ++i) {
            const size_t index = (write + kTunerRingSize - captureCount + i) % kTunerRingSize;
            captured[i] = tunerRing_[index].load(std::memory_order_relaxed);
        }
        if (extendedRange) {
            for (size_t i = 0; i < window.size(); ++i) {
                window[i] = 0.5f * (captured[i * 2] + captured[i * 2 + 1]);
            }
        } else {
            std::copy(captured.begin(), captured.begin() + static_cast<std::ptrdiff_t>(window.size()), window.begin());
        }
        double rmsEnergy = 0.0;
        for (float sample : window) rmsEnergy += static_cast<double>(sample) * sample;
        const float rms = static_cast<float>(std::sqrt(rmsEnergy / window.size()));
        const float analysisBoost = tunerAutoBoost_.load(std::memory_order_relaxed)
            ? std::max(1.0f, std::min(15.8489f, 0.12f / std::max(rms, 0.000001f)))
            : tunerAnalysisBoost_.load(std::memory_order_relaxed);
        for (float& sample : window) {
            sample *= analysisBoost;
        }

        const unsigned analysisRate = sampleRate_.load(std::memory_order_acquire) / (extendedRange ? 2u : 1u);
        TunerReading reading = analysePitch(window, analysisRate,
            tunerThreshold_.load(std::memory_order_relaxed));
        if (reading.valid && stable.valid) {
            if (reading.midiNote == stable.midiNote) {
                reading.frequency = stable.frequency * 0.62f + reading.frequency * 0.38f;
                const double midi = 69.0 + 12.0 * std::log2(reading.frequency / 440.0);
                reading.cents = static_cast<float>((midi - reading.midiNote) * 100.0);
                pendingMidi = -1;
                pendingCount = 0;
                stable = reading;
                invalidCount = 0;
            } else {
                if (pendingMidi == reading.midiNote) ++pendingCount;
                else { pendingMidi = reading.midiNote; pendingCount = 1; }
                if (pendingCount >= 3) {
                    stable = reading;
                    invalidCount = 0;
                    pendingMidi = -1;
                    pendingCount = 0;
                } else {
                    reading = stable;
                }
            }
        } else if (reading.valid) {
            stable = reading;
            invalidCount = 0;
        } else {
            ++invalidCount;
            if (stable.valid && invalidCount < 5) {
                reading = stable;
            } else {
                stable = reading;
                pendingMidi = -1;
                pendingCount = 0;
            }
        }
        {
            std::lock_guard<std::mutex> lock(tunerMutex_);
            tunerReading_ = reading;
        }
    }
}

void Engine::housekeepingThread() {
    int ticks = 0;
    int audioRetryLog = 0;
    uint64_t reportedXruns = metrics_.xruns.load(std::memory_order_relaxed);
    while (!shuttingDown_.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(25));

        AudioRealtimeStatus realtimeStatus;
        if (backend_ && backend_->takeRealtimeStatus(realtimeStatus)) {
            if (realtimeStatus.errorCode == 0) {
                logInfo("audio thread: SCHED_FIFO priority "
                        + std::to_string(realtimeStatus.priority));
            } else {
                logWarn("audio thread: SCHED_FIFO priority "
                        + std::to_string(realtimeStatus.priority) + " refused: "
                        + std::strerror(realtimeStatus.errorCode)
                        + " (expect dropouts under load)");
            }
        }

        AudioFailure failure;
        if (backend_ && backend_->takeFailure(failure)) {
            const std::string message = formatAudioFailure(failure);
            logError("audio: " + message);
            {
                std::lock_guard<std::recursive_mutex> lock(stateMutex_);
                audioError_ = message;
                notify();
            }
            audioRetryLog = 0;
        }

        const uint64_t xruns = metrics_.xruns.load(std::memory_order_relaxed);
        if (xruns < reportedXruns) {
            reportedXruns = xruns; // the user reset the counters
        } else if (xruns > reportedXruns) {
            const uint64_t added = xruns - reportedXruns;
            reportedXruns = xruns;
            const uint32_t direction =
                metrics_.lastXrunDirection.load(std::memory_order_relaxed);
            const uint32_t transition =
                metrics_.lastXrunTransitionPhase.load(std::memory_order_relaxed);
            const int errorCode = metrics_.lastXrunError.load(std::memory_order_relaxed);
            const char* directionName = direction == static_cast<uint32_t>(
                AudioXrunDirection::Capture) ? "capture" : "playback";
            const char* transitionName = transition == static_cast<uint32_t>(
                MasterOutputSafety::TransitionState::FadingOut) ? "fading-out"
                : transition == static_cast<uint32_t>(MasterOutputSafety::TransitionState::Muted)
                ? "muted"
                : transition == static_cast<uint32_t>(MasterOutputSafety::TransitionState::FadingIn)
                ? "fading-in" : "running";
            logWarn("audio: " + std::to_string(added) + " xrun(s), last="
                + directionName + ", transition=" + transitionName
                + ", chain=" + std::to_string(
                    metrics_.lastXrunChainGeneration.load(std::memory_order_relaxed))
                + ", workers=" + std::to_string(
                    metrics_.lastXrunWorkerTransitions.load(std::memory_order_relaxed))
                + ", preparing=" + (metrics_.lastXrunChainPreparationActive.load(
                    std::memory_order_relaxed) ? "yes" : "no")
                + (errorCode != 0 ? ", error=" + std::string(std::strerror(errorCode)) : ""));
        }

        for (const ActionRequest& request : controller_.pollHolds()) {
            runAction(request);
        }
        collectRetiredChains();
        if (chainStateDirty_.exchange(false, std::memory_order_acq_rel)) {
            refreshLeds();
            notify();
        }
        flushPendingPersistence();
        if (recorderOwnsTransport_.load(std::memory_order_acquire) && recorder_
            && !recorder_->recording() && !recorder_->playing()) {
            transport_.stop();
            recorderOwnsTransport_.store(false, std::memory_order_release);
        }
        if (recorderOwnsBacking_.load(std::memory_order_acquire) && recorder_
            && !recorder_->recording()) {
            backing_->stopPlayback();
            recorderOwnsBacking_.store(false, std::memory_order_release);
        }

        // Meters update several times a second; the full state only changes
        // when something actually changes, so it is not sent on a timer.
        if (++ticks % 4 == 0) {
            StateListener listener;
            {
                std::lock_guard<std::mutex> lock(listenerMutex_);
                listener = listener_;
            }
            if (listener) {
                listener(meterState());
                if (transportEnabled_.load(std::memory_order_acquire)) {
                    listener(transportState());
                }
                if (backingEnabled_.load(std::memory_order_acquire)) {
                    listener(backing_->state());
                }
                listener(looperState());
                if (recorderEnabled_.load(std::memory_order_acquire) && recorder_) {
                    listener(recorderState());
                }
                if (drumsEnabled_.load(std::memory_order_acquire) && drums_) {
                    listener(drumState());
                }
            }
            if (transportEnabled_.load(std::memory_order_acquire)
                || backingEnabled_.load(std::memory_order_acquire)
                || recorderEnabled_.load(std::memory_order_acquire)
                || drumsEnabled_.load(std::memory_order_acquire)) refreshLeds();
        }

        // USB interfaces often appear after the service has already started.
        // Retry every two seconds until a guitar card is there.
        if (ticks % 80 == 0 && backend_ && !backend_->isRunning()
            && !shuttingDown_.load()) {
            std::lock_guard<std::recursive_mutex> lock(stateMutex_);
            if (backend_ && !backend_->isRunning() && !shuttingDown_.load()) {
                std::string err;
                if (restartAudio(err)) {
                    audioError_.clear();
                    persistSettings();
                    notify();
                    logInfo("audio: interface appeared, stream started");
                    audioRetryLog = 0;
                } else {
                    audioError_ = err;
                    if (audioRetryLog++ % 15 == 0) {
                        logWarn("audio: waiting for interface (" + err + ")");
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// State reporting
// ---------------------------------------------------------------------------

bool Engine::persistSettings() {
    settings_.activeBankId = activeBankId_;
    settings_.activePresetId = activePresetId_;
    ControllerConfig config = controller_.config();
    config.enabled = settings_.controller.enabled;
    config.midiPort = midi_.isRunning() ? midi_.activePort() : settings_.controller.midiPort;
    settings_.controller = std::move(config);
    return storage_.saveSettings(settings_);
}

void Engine::notify() {
    // publishChain() now hands ownership to the audio thread. Broadcasting
    // before that swap would serialize the outgoing chain alongside the new
    // preset metadata. The swap marks chainStateDirty_, and housekeeping sends
    // one coherent state as soon as the new chain is active.
    if (pendingChain_.peek() != nullptr
        || chainPublicationExpected_.load(std::memory_order_acquire)) {
        return;
    }
    StateListener listener;
    {
        std::lock_guard<std::mutex> lock(listenerMutex_);
        listener = listener_;
    }
    if (listener) listener(fullState());
}

void Engine::publishState() {
    notify();
}

void Engine::notifyPerformance() {
    if (pendingChain_.peek() != nullptr
        || chainPublicationExpected_.load(std::memory_order_acquire)) {
        return;
    }
    StateListener listener;
    {
        std::lock_guard<std::mutex> lock(listenerMutex_);
        listener = listener_;
    }
    if (listener) listener(performanceState());
}

void Engine::notifyUiNav(int delta, bool select, const std::string& virtualControlAction) {
    StateListener listener;
    {
        std::lock_guard<std::mutex> lock(listenerMutex_);
        listener = listener_;
    }
    if (!listener) return;
    Json json = Json::object();
    json.set("type", "uiNav");
    if (!virtualControlAction.empty()) json.set("virtualControlAction", virtualControlAction);
    if (select) {
        json.set("select", true);
    } else {
        json.set("delta", delta);
    }
    listener(json);
}

Json Engine::fullState() const {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    Json json = Json::object();
    json.set("type", "state");
    json.set("version", PIMFX_VERSION);
#ifdef PIMFX_GIT_SHA
    json.set("gitSha", PIMFX_GIT_SHA);
#endif

    Json bankArray = Json::array();
    for (const Bank& bank : banks_) {
        bankArray.push(bank.toJson());
    }
    json.set("banks", bankArray);
    json.set("activeBankId", activeBankId_);
    json.set("activePresetId", activePresetId_);

    json.set("audio", audioSettingsToJson(settings_.audio));
    if (backend_) json.set("actualAudio", audioSettingsToJson(backend_->actualSettings()));
    json.set("audioInterface", audioDeviceName_.empty() ? settings_.audio.device : audioDeviceName_);
    json.set("ui", settings_.ui.toJson());
    json.set("system", settings_.system.toJson());
    json.set("transportSettings", settings_.transport.toJson());
    json.set("transportFeatureEnabled", transportEnabled_.load(std::memory_order_acquire));
    if (transportEnabled_.load(std::memory_order_acquire)) json.set("transport", transport_.state());
    json.set("backingTrackFeatureEnabled", backingEnabled_.load(std::memory_order_acquire));
    if (backingEnabled_.load(std::memory_order_acquire)) json.set("backing", backing_->state());
    json.set("looper", looperState());
    json.set("recorderFeatureEnabled", recorderEnabled_.load(std::memory_order_acquire));
    if (recorderEnabled_.load(std::memory_order_acquire) && recorder_) json.set("recorder", recorderState());
    json.set("drumFeatureEnabled", drumsEnabled_.load(std::memory_order_acquire));
    if (drumsEnabled_.load(std::memory_order_acquire) && drums_) json.set("drums", drumState());
#if defined(PIMFX_ENABLE_COMMUNITY_CATALOG)
    json.set("communityCatalogFeatureEnabled", true);
#else
    json.set("communityCatalogFeatureEnabled", false);
#endif
    json.set("controller", describeControllerRuntime());
    json.set("virtualControls", effectiveVirtualControlsConfig().toJson());
    json.set("sharedVirtualControls", settings_.virtualControls.toJson());
    if (const Preset* preset = effectiveActivePreset()) {
        json.set("virtualControlsMode", preset->virtualControlSurface["mode"].asString("shared"));
    } else {
        json.set("virtualControlsMode", "shared");
    }
    json.set("activeVirtualControlId", activeVirtualControlId_);
    json.set("virtualControlRevision", static_cast<double>(virtualControlRevision_));
    json.set("virtualControlFine", proxyFineMode_);
    json.set("sessionPresetDirty", sessionPresetDrafts_.find(activePresetId_) != sessionPresetDrafts_.end());
    json.set("sessionPresetDirtyCount", static_cast<int>(sessionPresetDrafts_.size()));
    Json dirtyPresetIds = Json::array();
    for (const auto& entry : sessionPresetDrafts_) dirtyPresetIds.push(Json(entry.first));
    json.set("sessionPresetDirtyIds", std::move(dirtyPresetIds));

    json.set("bypassAll", bypassAll_.load(std::memory_order_relaxed));
    json.set("snapshotMode", snapshotMode_.load(std::memory_order_relaxed));
    json.set("presetReloadCount", presetReloadCount_);
    json.set("audioRunning", backend_ && backend_->isRunning());
    json.set("audioBackend", backend_ ? backend_->name() : std::string("none"));
    if (!audioError_.empty()) {
        json.set("audioError", audioError_);
    }
    if (!controllerError_.empty()) {
        json.set("controllerError", controllerError_);
    }
    json.set("lv2Available", catalog_.available());
    json.set("pluginCount", static_cast<int>(catalog_.plugins().size()));

    // Live chain contents, which can differ from the stored preset when a
    // plugin named by the preset is not installed.
    Json chainArray = Json::array();
    ActiveChainReadGuard chainGuard(*this);
    if (Chain* chain = chainGuard.get()) {
        json.set("activeChainPresetId", chain->presetId);
        for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
            if (!slot->plugin) {
                continue;
            }
            Json slotJson = Json::object();
            slotJson.set("id", slot->id);
            slotJson.set("uri", slot->plugin->uri());
            slotJson.set("enabled", slot->enabled.load(std::memory_order_relaxed));
            if (const Preset* preset = effectiveActivePreset()) {
                if (const EffectSlot* stored = preset->findSlot(slot->id)) {
                    slotJson.set("name", stored->name);
                    slotJson.set("tempoLinks", stored->tempoLinks);
                }
            }
            slotJson.set("plugin", slot->plugin->info().toJson(true));
            slotJson.set("state", slot->plugin->saveState());
            chainArray.push(slotJson);
        }
    }
    json.set("chain", chainArray);

    Json missing = Json::array();
    for (const std::string& item : missingPluginFiles_) {
        missing.push(Json(item));
    }
    json.set("missingFiles", missing);
    Json broken = Json::array();
    for (const std::string& item : brokenBankFiles_) {
        broken.push(Json(item));
    }
    json.set("brokenBanks", broken);

    Json positions = Json::object();
    for (const auto& entry : controller_.controlPositions()) {
        positions.set(entry.first, Json(entry.second));
    }
    json.set("controlPositions", positions);
    return json;
}

Json Engine::performanceState() const {
    std::lock_guard<std::recursive_mutex> stateLock(stateMutex_);
    Json json = Json::object();
    json.set("type", "performance");
    json.set("activeBankId", activeBankId_);
    json.set("activePresetId", activePresetId_);
    json.set("bypassAll", bypassAll_.load(std::memory_order_relaxed));
    json.set("snapshotMode", snapshotMode_.load(std::memory_order_relaxed));
    json.set("presetReloadCount", presetReloadCount_);
    json.set("activeVirtualControlId", activeVirtualControlId_);
    json.set("virtualControlRevision", static_cast<double>(virtualControlRevision_));
    json.set("virtualControlFine", proxyFineMode_);
    json.set("sessionPresetDirty", sessionPresetDrafts_.find(activePresetId_) != sessionPresetDrafts_.end());
    json.set("sessionPresetDirtyCount", static_cast<int>(sessionPresetDrafts_.size()));
    Json dirtyPresetIds = Json::array();
    for (const auto& entry : sessionPresetDrafts_) dirtyPresetIds.push(Json(entry.first));
    json.set("sessionPresetDirtyIds", std::move(dirtyPresetIds));

    if (const Preset* preset = activePreset()) {
        const Preset* effective = effectiveActivePreset();
        json.set("tempo", transportEnabled_.load(std::memory_order_acquire)
            ? transport_.bpm() : (effective ? effective->tempo : preset->tempo));
        json.set("activeSnapshot", preset->activeSnapshot);
    }

    Json slotArray = Json::array();
    ActiveChainReadGuard chainGuard(*this);
    if (Chain* chain = chainGuard.get()) {
        for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
            Json slotJson = Json::object();
            slotJson.set("id", slot->id);
            slotJson.set("enabled", slot->enabled.load(std::memory_order_relaxed));
            if (slot->plugin) {
                slotJson.set("state", slot->plugin->saveState());
            }
            slotArray.push(slotJson);
        }
    }
    json.set("slots", slotArray);

    Json positions = Json::object();
    for (const auto& entry : controller_.controlPositions()) {
        positions.set(entry.first, Json(entry.second));
    }
    json.set("controlPositions", positions);
    return json;
}

Json Engine::transportState() const {
    return transport_.state();
}

void Engine::notifyUiView(const std::string& view) {
    StateListener listener;
    {
        std::lock_guard<std::mutex> lock(listenerMutex_);
        listener = listener_;
    }
    if (!listener) return;
    Json json = Json::object();
    json.set("type", "uiView");
    json.set("view", view);
    listener(json);
}

Json Engine::backingState() const { return backing_ ? backing_->state() : Json::object(); }

bool Engine::backingImport(const std::string& name, const std::string& bytes, std::string& error) {
    if (!backingEnabled_.load(std::memory_order_acquire)) { error = "backing tracks are disabled"; return false; }
    return backing_->importFile(name, bytes, error);
}

bool Engine::backingCommand(const std::string& command, const Json& payload, std::string& error) {
    if (!backingEnabled_.load(std::memory_order_acquire)) { error = "backing tracks are disabled"; return false; }
    if (command == "play") backing_->play();
    else if (command == "pause") backing_->pause();
    else if (command == "stop") backing_->stopPlayback();
    else if (command == "restart") backing_->restart();
    else if (command == "seek") backing_->seek(payload["seconds"].asDouble(0.0));
    else if (command == "level") return backing_->updateTrackSettings(Json::object({{"level", payload["level"]}}), error);
    else if (command == "bpm") return backing_->updateTrackSettings(Json::object({{"bpm", payload["bpm"]}}), error);
    else if (command == "loop") return backing_->updateTrackSettings(Json::object({
        {"loopEnabled", payload["enabled"]}, {"loopStart", payload["start"]}, {"loopEnd", payload["end"]}
    }), error);
    else if (command == "metadata") return backing_->updateTrackSettings(payload, error);
    else if (command == "next") backing_->next();
    else if (command == "previous") backing_->previous();
    else if (command == "rescan") backing_->refreshPlaylist();
    else if (command == "load") return backing_->load(payload["path"].asString(), error);
    else if (command == "setlist/load") return backing_->loadSetListEntry(payload["index"].asInt(-1), error);
    else if (command.rfind("setlist/", 0) == 0) return backing_->setListCommand(command.substr(8), payload, error);
    else { error = "unknown backing-track command"; return false; }
    return true;
}

Json Engine::looperState() const {
    Json state = looper_->state();
    const double bpm = transport_.bpm();
    const double beatSeconds = 60.0 / bpm * 4.0 / std::max(1, settings_.transport.beatUnit);
    const double beats = state["duration"].asDouble(0.0) / beatSeconds;
    state.set("bpm", bpm);
    state.set("beats", beats);
    state.set("bars", beats / std::max(1, settings_.transport.beatsPerBar));
    return state;
}

bool Engine::applyLooperSettings(const Json& json, std::string& error) {
    std::lock_guard<std::recursive_mutex> lock(stateMutex_);
    settings_.looper = LooperSettings::fromJson(json);
    looper_->configure(settings_.looper.quantization, settings_.looper.countIn,
                       settings_.looper.level, settings_.looper.feedback);
    if (!persistSettings()) {
        error = "could not save looper settings";
        return false;
    }
    return true;
}

bool Engine::looperCommand(const std::string& command, const Json& payload, std::string& error) {
    std::string resolved = command;
    if (resolved == "toggle") {
        const Json current = looper_->state();
        const std::string status = current["status"].asString("empty");
        if (status == "recording" || status == "armed") resolved = "finish";
        else if (status == "playing" || status == "overdubbing") resolved = "overdub";
        else resolved = current["hasLoop"].asBool(false) ? "play" : "record";
    } else if (resolved == "playStop") {
        const std::string status = looper_->state()["status"].asString("empty");
        resolved = status == "playing" || status == "overdubbing"
            || status == "recording" || status == "armed" ? "stop" : "play";
    }

    StereoLooper::Action action;
    if (resolved == "record") action = StereoLooper::Action::Record;
    else if (resolved == "finish") action = StereoLooper::Action::Finish;
    else if (resolved == "play") action = StereoLooper::Action::Play;
    else if (resolved == "overdub") action = StereoLooper::Action::Overdub;
    else if (resolved == "stop") action = StereoLooper::Action::Stop;
    else if (resolved == "restart") action = StereoLooper::Action::Restart;
    else if (resolved == "mute") action = StereoLooper::Action::Mute;
    else if (resolved == "undo") action = StereoLooper::Action::Undo;
    else if (resolved == "redo") action = StereoLooper::Action::Redo;
    else if (resolved == "clear") {
        if (!payload["confirmed"].asBool(false)) {
            error = "clear requires confirmation";
            return false;
        }
        action = StereoLooper::Action::Clear;
    } else if (resolved == "save") {
        return looper_->save(payload["name"].asString("loop"), payload["overwrite"].asBool(false), error);
    } else if (resolved == "load") {
        return looper_->load(payload["name"].asString(), error);
    } else if (resolved == "rename") {
        return looper_->renameSaved(payload["name"].asString(), payload["nextName"].asString(), error);
    } else if (resolved == "delete") {
        if (!payload["confirmed"].asBool(false)) { error = "delete requires confirmation"; return false; }
        return looper_->deleteSaved(payload["name"].asString(), error);
    } else {
        error = "unknown looper command";
        return false;
    }

    if ((action == StereoLooper::Action::Record || action == StereoLooper::Action::Overdub)
        && looper_->wantsTransport() && transportEnabled_.load(std::memory_order_acquire)) {
        const bool restart = action == StereoLooper::Action::Record && looper_->wantsCountIn();
        transport_.play(restart);
    }
    return looper_->enqueue(action, error);
}

bool Engine::looperExport(const std::string& requestedName, std::string& contents,
                          std::string& name, std::string& error) const {
    std::string path = looper_->savedPath();
    if (!requestedName.empty()) {
        const std::string safe = sanitizeFileName(fileName(requestedName));
        if (safe != requestedName || safe.size() < 4 || safe.substr(safe.size() - 4) != ".wav") {
            error = "that saved loop name cannot be exported";
            return false;
        }
        path = joinPath(storage_.paths().loopsDir, safe);
    }
    if (path.empty() || !readFile(path, contents)) {
        error = "save the loop before exporting it";
        return false;
    }
    name = fileName(path);
    return true;
}

Json Engine::recorderState() const {
    if (!recorderEnabled_.load(std::memory_order_acquire) || !recorder_) {
        Json state = Json::object();
        state.set("type", "recorder");
        state.set("status", "disabled");
        return state;
    }
    Json state = recorder_->state();
    if (backingEnabled_.load(std::memory_order_acquire) && backing_) {
        const Json backing = backing_->state();
        state.set("backingAvailable", backing["available"]);
        state.set("backingLoaded", backing["loaded"]);
        state.set("backingPlaying", backing["playing"]);
        state.set("backingName", backing["name"]);
    }
    return state;
}

bool Engine::recorderCommand(const std::string& command, const Json& payload, std::string& error) {
    if (!recorderEnabled_.load(std::memory_order_acquire) || !recorder_) {
        error = "multitrack recorder is disabled";
        return false;
    }
    const bool transportWasPlaying = transport_.playing();
    const bool recordWithBacking = command == "record/start" && payload["playBacking"].asBool();
    if (recordWithBacking) {
        if (!backingEnabled_.load(std::memory_order_acquire) || !backing_) {
            error = "backing tracks are disabled";
            return false;
        }
        if (!backing_->state()["loaded"].asBool()) {
            error = "load a backing track before using Record With Backing";
            return false;
        }
        backing_->prepareRestart();
        for (int attempt = 0; attempt < 150 && !backing_->bufferedToPlay(); ++attempt)
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
        if (!backing_->bufferedToPlay()) {
            error = "backing track did not become ready in time";
            return false;
        }
    }
    const bool ok = recorder_->command(command, payload, error);
    if (!ok) return false;
    if (recordWithBacking) {
        backing_->play();
        recorderOwnsBacking_.store(true, std::memory_order_release);
    }
    if ((command == "record/start" || command == "playback/play")
        && transportEnabled_.load(std::memory_order_acquire) && !transportWasPlaying) {
        transport_.play(false);
        recorderOwnsTransport_.store(true, std::memory_order_release);
    }
    if ((command == "record/stop" || command == "playback/pause" || command == "playback/stop")
        && recorderOwnsTransport_.load(std::memory_order_acquire)
        && !recorder_->recording() && !recorder_->playing()) {
        transport_.stop();
        recorderOwnsTransport_.store(false, std::memory_order_release);
    }
    if (command == "record/stop" && recorderOwnsBacking_.load(std::memory_order_acquire)) {
        backing_->stopPlayback();
        recorderOwnsBacking_.store(false, std::memory_order_release);
    }
    return true;
}

bool Engine::recorderExport(const std::string& kind, const std::string& trackId,
                            std::string& path, std::string& name, std::string& error) {
    if (!recorderEnabled_.load(std::memory_order_acquire) || !recorder_) {
        error = "multitrack recorder is disabled";
        return false;
    }
    return recorder_->exportFile(kind, trackId, path, name, error);
}

Json Engine::drumState() const {
    if (!drumsEnabled_.load(std::memory_order_acquire) || !drums_) {
        Json state = Json::object(); state.set("type", "drums"); state.set("available", false); return state;
    }
    return drums_->state();
}

bool Engine::drumImport(unsigned voice, const std::string& name,
                        const std::string& bytes, std::string& error) {
    if (!drumsEnabled_.load(std::memory_order_acquire) || !drums_) {
        error = "drum machine is disabled"; return false;
    }
    return drums_->importSample(voice, name, bytes, error);
}

bool Engine::drumLibraryImport(const std::string& relative, const std::string& bytes, Json& result, std::string& error) {
    if (!drums_) { error = "drum machine is disabled"; return false; }
    return drums_->importLibrarySample(relative, bytes, result, error);
}

bool Engine::drumLibraryRead(const std::string& relative, std::string& bytes, std::string& error) const {
    if (!drums_) { error = "drum machine is disabled"; return false; }
    return drums_->readLibrarySample(relative, bytes, error);
}

bool Engine::drumCommand(const std::string& command, const Json& payload, std::string& error) {
    if (!drumsEnabled_.load(std::memory_order_acquire) || !drums_) {
        error = "drum machine is disabled"; return false;
    }
    const bool wasPlaying = drums_->playing();
    const bool ok = drums_->command(command, payload, error);
    if (!ok) return false;
    const bool isPlaying = drums_->playing();
    if (!wasPlaying && isPlaying && transportEnabled_.load(std::memory_order_acquire)) {
        if (!transport_.playing()) {
            transport_.play(payload["restart"].asBool(true));
            drumsOwnTransport_.store(true, std::memory_order_release);
        }
    } else if (wasPlaying && !isPlaying && drumsOwnTransport_.load(std::memory_order_acquire)) {
        transport_.stop();
        drumsOwnTransport_.store(false, std::memory_order_release);
    }
    return true;
}

Json Engine::meterState() const {
    std::lock_guard<std::recursive_mutex> stateLock(stateMutex_);
    Json json = Json::object();
    json.set("type", "meters");
    json.set("xruns", static_cast<int64_t>(metrics_.xruns.load(std::memory_order_relaxed)));
    json.set("captureXruns", static_cast<int64_t>(
        metrics_.captureXruns.load(std::memory_order_relaxed)));
    json.set("playbackXruns", static_cast<int64_t>(
        metrics_.playbackXruns.load(std::memory_order_relaxed)));
    json.set("shortCaptureTransfers", static_cast<int64_t>(
        metrics_.shortCaptureTransfers.load(std::memory_order_relaxed)));
    json.set("shortPlaybackTransfers", static_cast<int64_t>(
        metrics_.shortPlaybackTransfers.load(std::memory_order_relaxed)));
    json.set("dspLoad", metrics_.dspLoad.load(std::memory_order_relaxed));
    json.set("dspLoadPeak", metrics_.dspLoadPeak.load(std::memory_order_relaxed));
    json.set("inputPeak", metrics_.inputPeak.load(std::memory_order_relaxed));
    json.set("outputPeak", metrics_.outputPeak.load(std::memory_order_relaxed));
    json.set("guitarInputPeak", guitarInputPeak_.load(std::memory_order_relaxed));
    json.set("guitarInputRms", guitarInputRms_.load(std::memory_order_relaxed));
    Json effectMeters = Json::array();
    ActiveChainReadGuard chainGuard(*this);
    if (Chain* chain = chainGuard.get()) {
        for (const std::unique_ptr<ChainSlot>& slot : chain->slots) {
            Json meter = Json::object();
            meter.set("slotId", slot->id);
            meter.set("inputPeak", slot->inputPeak.load(std::memory_order_relaxed));
            meter.set("outputPeak", slot->outputPeak.load(std::memory_order_relaxed));
            effectMeters.push(std::move(meter));
        }
    }
    json.set("effects", std::move(effectMeters));
    json.set("running", metrics_.running.load(std::memory_order_relaxed));
    json.set("chainPreparing",
        chainPublicationExpected_.load(std::memory_order_acquire)
            || pendingChain_.peek() != nullptr
            || metrics_.chainPreparationActive.load(std::memory_order_relaxed));

    const uint32_t lastDirection = metrics_.lastXrunDirection.load(std::memory_order_relaxed);
    const uint32_t lastTransition =
        metrics_.lastXrunTransitionPhase.load(std::memory_order_relaxed);
    Json lastXrun = Json::object();
    lastXrun.set("direction", lastDirection == static_cast<uint32_t>(AudioXrunDirection::Capture)
        ? "capture" : lastDirection == static_cast<uint32_t>(AudioXrunDirection::Playback)
        ? "playback" : "none");
    lastXrun.set("error", metrics_.lastXrunError.load(std::memory_order_relaxed));
    lastXrun.set("period", static_cast<int64_t>(
        metrics_.lastXrunPeriod.load(std::memory_order_relaxed)));
    lastXrun.set("transition", lastTransition == static_cast<uint32_t>(
        MasterOutputSafety::TransitionState::FadingOut) ? "fadingOut"
        : lastTransition == static_cast<uint32_t>(MasterOutputSafety::TransitionState::Muted)
        ? "muted"
        : lastTransition == static_cast<uint32_t>(MasterOutputSafety::TransitionState::FadingIn)
        ? "fadingIn" : "running");
    lastXrun.set("workerTransitions", static_cast<int>(
        metrics_.lastXrunWorkerTransitions.load(std::memory_order_relaxed)));
    lastXrun.set("chainPreparing",
        metrics_.lastXrunChainPreparationActive.load(std::memory_order_relaxed));
    lastXrun.set("chainGeneration", static_cast<int64_t>(
        metrics_.lastXrunChainGeneration.load(std::memory_order_relaxed)));
    lastXrun.set("dspLoad", metrics_.lastXrunDspLoad.load(std::memory_order_relaxed));
    json.set("lastXrun", std::move(lastXrun));

    const unsigned rate = sampleRate_.load(std::memory_order_acquire);
    const uint32_t hardwareFrames = metrics_.roundTripFrames.load(std::memory_order_relaxed);
    const uint32_t lookaheadFrames = outputSafety_.limiterEnabled()
        ? outputSafety_.lookaheadFrames() : 0;
    const uint32_t totalFrames = hardwareFrames + lookaheadFrames;
    json.set("hardwareRoundTripFrames", static_cast<int>(hardwareFrames));
    json.set("safetyLookaheadFrames", static_cast<int>(lookaheadFrames));
    json.set("roundTripFrames", static_cast<int>(totalFrames));
    json.set("hardwareRoundTripMs", rate > 0 ? (1000.0 * hardwareFrames) / rate : 0.0);
    json.set("safetyLookaheadMs", rate > 0 ? (1000.0 * lookaheadFrames) / rate : 0.0);
    json.set("roundTripMs", rate > 0 ? (1000.0 * totalFrames) / rate : 0.0);
    json.set("bufferMs", settings_.audio.bufferMs());
    json.set("separateClockDomains", !settings_.audio.captureDevice.empty()
        && settings_.audio.captureDevice != settings_.audio.device);

    const TunerReading reading = tuner();
    Json tunerJson = Json::object();
    tunerJson.set("enabled", tunerEnabled_.load(std::memory_order_relaxed));
    tunerJson.set("outputMuted", tunerOutputMuted_.load(std::memory_order_relaxed));
    tunerJson.set("dryPassthrough", tunerViewOpen_.load(std::memory_order_relaxed)
        && !tunerOutputMuted_.load(std::memory_order_relaxed));
    tunerJson.set("valid", reading.valid);
    tunerJson.set("frequency", reading.frequency);
    tunerJson.set("inputLevel", reading.inputLevel);
    tunerJson.set("confidence", reading.confidence);
    tunerJson.set("note", reading.noteName);
    tunerJson.set("cents", reading.cents);
    json.set("tuner", tunerJson);
    return json;
}

Json Engine::catalogState(bool includePorts) const {
    Json json = Json::object();
    json.set("type", "catalog");
    json.set("available", catalog_.available());

    Json pluginArray = Json::array();
    for (const PluginInfo& info : catalog_.plugins()) {
        pluginArray.push(info.toJson(includePorts));
    }
    json.set("plugins", pluginArray);

    Json categoryArray = Json::array();
    for (const std::string& category : catalog_.categories()) {
        categoryArray.push(Json(category));
    }
    json.set("categories", categoryArray);
    return json;
}

Json Engine::audioDevicesState() {
    Json json = Json::object();
    json.set("type", "audioDevices");
    Json deviceArray = Json::array();
    if (backend_) {
        for (const AudioDeviceInfo& device : backend_->enumerateDevices()) {
            deviceArray.push(audioDeviceToJson(device));
        }
    }
    json.set("devices", deviceArray);
    return json;
}

Json Engine::midiPortsState() const {
    Json json = Json::object();
    json.set("type", "midiPorts");
    Json portArray = Json::array();
    for (const MidiPortInfo& port : MidiInput::enumeratePorts()) {
        Json portJson = Json::object();
        portJson.set("id", port.id);
        portJson.set("name", port.name);
        portJson.set("input", port.input);
        portJson.set("output", port.output);
        portJson.set("looksLikeController", port.looksLikeController);
        portArray.push(portJson);
    }
    json.set("ports", portArray);
    json.set("activePort", midi_.activePort());
    json.set("connected", midi_.isRunning());
    return json;
}

Json Engine::libraryState() const {
    Json json = Json::object();
    json.set("type", "library");

    auto describe = [](const std::vector<Storage::LibraryEntry>& entries) {
        Json array = Json::array();
        for (const Storage::LibraryEntry& entry : entries) {
            Json item = Json::object();
            item.set("path", entry.path);
            item.set("name", entry.name);
            item.set("category", entry.category);
            item.set("bytes", static_cast<int64_t>(entry.bytes));
            item.set("source", entry.source);
            array.push(item);
        }
        return array;
    };

    json.set("models", describe(storage_.listModels()));
    json.set("aidax", describe(storage_.listAidax()));
    json.set("impulseResponses", describe(storage_.listImpulseResponses()));
    return json;
}

Json Engine::diagnosticsState() const {
    Json json = Json::object();
    json.set("type", "diagnostics");
    json.set("tuning", rt::describeSystemTuning());
    json.set("cpuLatency", latencyGuard_ ? latencyGuard_->status() : std::string("not held"));
    json.set("audioBackend", backend_ ? backend_->name() : std::string("none"));
    if (backend_) {
        json.set("actualAudio", audioSettingsToJson(backend_->actualSettings()));
    }
    json.set("dataRoot", storage_.paths().dataRoot);
    json.set("webRoot", storage_.paths().webRoot);
    Json broken = Json::array();
    for (const std::string& item : brokenBankFiles_) {
        broken.push(Json(item));
    }
    json.set("brokenBanks", broken);
    Json missing = Json::array();
    for (const std::string& item : missingPluginFiles_) {
        missing.push(Json(item));
    }
    json.set("missingFiles", missing);
    return json;
}

Json Engine::describeControllerRuntime() const {
    Json json = controller_.config().toJson();
    json.set("connected", midi_.isRunning());
    json.set("activePort", midi_.activePort());
    json.set("learning", controller_.learning());
    json.set("learningControlId", controller_.learningControlId());
    if (!controllerFirmwareVersion_.empty()) {
        json.set("firmwareVersion", controllerFirmwareVersion_);
        json.set("requiredFirmwareVersion", kRequiredControllerFirmwareVersion);
        json.set("firmwareUpdateRequired", controllerFirmwareUpdateRequired_);
    }
    return json;
}

} // namespace pimfx
